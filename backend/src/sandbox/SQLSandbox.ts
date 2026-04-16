import { createHash } from 'node:crypto'

import { parse } from 'pgsql-ast-parser'

import { AppError } from '../utils/errors.js'
import type { PostgisCatalog } from '../skills/postgis/sqlSecurity.js'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  meta: {
    tables: string[]
    functions: string[]
    limit: number | null
  }
}

export interface ExecutorInput {
  sql: string
  timeoutMs: number
}

export interface ExecutorResult {
  rows: Record<string, unknown>[]
  rowCount: number
}

export interface SQLExecutionResult {
  rows: Record<string, unknown>[]
  meta: {
    limit: number | null
    tables: string[]
    functions: string[]
    truncated: boolean
    statementTimeoutMs: number
  }
  audit: {
    sqlHash: string
    rowCount: number
  }
}

export interface SQLSandboxOptions {
  catalog: PostgisCatalog
  maxRows: number
  statementTimeoutMs: number
}

export class SQLSandbox {
  constructor(private readonly options: SQLSandboxOptions) {}

  validate(sql: string): ValidationResult {
    const errors: string[] = []
    const normalizedSql = String(sql || '').trim()
    const scrubbedSql = this.stripStringLiterals(normalizedSql)
    const lowerSql = scrubbedSql.toLowerCase()
    const tables = this.extractTables(lowerSql)
    const functions = this.extractFunctions(lowerSql)
    const limit = this.extractLimit(lowerSql)

    try {
      const ast = parse(normalizedSql)
      if (ast.length !== 1) {
        errors.push('Only one SQL statement is allowed')
      } else {
        const statement = ast[0] as { type?: string }
        if (statement.type !== 'select') {
          errors.push(`Only SELECT statements are allowed, received ${statement.type || 'unknown'}`)
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'SQL parse error')
    }

    if (/[;].+\S/.test(normalizedSql.replace(/;\s*$/, ''))) {
      errors.push('Multiple SQL statements are not allowed')
    }

    if (/\b(insert|update|delete|drop|alter|truncate|create)\b/.test(lowerSql)) {
      errors.push('Mutation statements are not allowed')
    }

    if (/\bselect\s+\*/.test(lowerSql)) {
      errors.push('Wildcard column selection is not allowed')
    }

    const isAggregating = functions.some((fn) => 
      ['count', 'sum', 'avg', 'min', 'max', 'st_hexagongrid', 'st_squaregrid'].includes(fn)
    )

    if (!isAggregating && limit === null) {
      errors.push('明细查询必须包含 LIMIT 约束')
    } else if (limit !== null && limit > this.options.catalog.maxLimit) {
      errors.push(`LIMIT exceeds the configured max of ${this.options.catalog.maxLimit}`)
    }

    const hasSpatialFilter = functions.some((fn) => this.options.catalog.requiredSpatialFunctions.includes(fn))
    
    if (!hasSpatialFilter && !isAggregating) {
      errors.push('高危查询被防爆盾拦截：缺少空间索引过滤条件，全局明细提取已被驳回。若是大范围宏观统计分布，请使用 COUNT 或栅格降维聚合查询 (ST_HexagonGrid等)！')
    }

    for (const table of tables) {
      if (!(table in this.options.catalog.tables)) {
        errors.push(`Table "${table}" is not allowed`)
      }
    }

    const selectedColumns = this.extractSelectedColumns(lowerSql)
    for (const [table, columns] of Object.entries(selectedColumns)) {
      const allowedColumns = this.options.catalog.tables[table] || []
      for (const column of columns) {
        if (column === 'limit') continue
        if (!allowedColumns.includes(column)) {
          errors.push(`Column "${column}" is not allowed on table "${table}"`)
        }
      }
    }

    for (const fn of functions) {
      if (!this.options.catalog.functions.includes(fn)) {
        errors.push(`Function "${fn}" is not allowed`)
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      meta: {
        tables,
        functions,
        limit,
      },
    }
  }

  async execute({
    sql,
    executor,
  }: {
    sql: string
    executor: (statement: ExecutorInput) => Promise<ExecutorResult>
  }): Promise<SQLExecutionResult> {
    const validation = this.validate(sql)
    if (!validation.ok) {
      throw new AppError('sql_validation_failed', `SQL validation failed: ${validation.errors.join('; ')}`, 400, validation)
    }

    const execution = await executor({
      sql,
      timeoutMs: this.options.statementTimeoutMs,
    })

    const rows = execution.rows.slice(0, this.options.maxRows)
    const truncated = execution.rows.length > rows.length

    return {
      rows,
      meta: {
        ...validation.meta,
        truncated,
        statementTimeoutMs: this.options.statementTimeoutMs,
      },
      audit: {
        sqlHash: createHash('sha256').update(sql).digest('hex'),
        rowCount: execution.rowCount,
      },
    }
  }

  private extractTables(sql: string) {
    const matches = [
      ...sql.matchAll(/\bfrom\s+(?![a-z_][a-z0-9_]*\s*\()([a-z_][a-z0-9_]*)/g),
      ...sql.matchAll(/\bjoin\s+(?![a-z_][a-z0-9_]*\s*\()([a-z_][a-z0-9_]*)/g),
    ]
    return [...new Set(matches.map((match) => match[1]))]
  }

  private extractFunctions(sql: string) {
    const ignoredNames = new Set([
      'select',
      'from',
      'where',
      'limit',
      'and',
      'or',
      'over',
      'exists',
      'in',
    ])
    return [...new Set(
      [...sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)]
        .map((match) => match[1].toLowerCase())
        .filter((name) => !ignoredNames.has(name)),
    )]
  }

  private extractLimit(sql: string) {
    const match = sql.match(/\blimit\s+(\d+)/)
    return match ? Number(match[1]) : null
  }

  private extractSelectedColumns(sql: string) {
    const columnsByTable: Record<string, string[]> = {}
    if (/\b(from|join)\s+\(/.test(sql)) {
      return columnsByTable
    }

    const table = this.extractTables(sql)[0]
    const selectMatch = sql.match(/\bselect\s+(.+?)\s+from\s+/s)
    if (!selectMatch || !table) {
      return columnsByTable
    }

    const rawColumns = selectMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    columnsByTable[table] = rawColumns
      .map((entry) => {
        const simpleRef = entry.match(/^(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)$/)
        if (simpleRef) return simpleRef[1]
        return null
      })
      .filter((entry): entry is string => Boolean(entry))

    return columnsByTable
  }

  private stripStringLiterals(sql: string) {
    return sql.replace(/'(?:''|[^'])*'/g, '\'\'')
  }
}

