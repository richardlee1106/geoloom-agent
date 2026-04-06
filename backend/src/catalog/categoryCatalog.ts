import type { QueryResultLike } from '../integration/postgisPool.js'

export interface CategoryTreeNode {
  value: string
  label: string
  count: number
  children?: CategoryTreeNode[]
}

interface CategoryTreeRow {
  big?: unknown
  mid?: unknown
  small?: unknown
  count?: unknown
}

function toSafeLabel(value: unknown) {
  const text = String(value || '').trim()
  return text || '未分类'
}

function sortNodes(nodes: CategoryTreeNode[] = []) {
  nodes.sort((left, right) => {
    if ((right.count || 0) !== (left.count || 0)) {
      return (right.count || 0) - (left.count || 0)
    }
    return String(left.label || '').localeCompare(String(right.label || ''), 'zh-Hans-CN')
  })

  nodes.forEach((node) => {
    if (Array.isArray(node.children)) {
      sortNodes(node.children)
    }
  })

  return nodes
}

export function buildCategoryTree(rows: CategoryTreeRow[] = []): CategoryTreeNode[] {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const bigMap = new Map<string, {
    value: string
    label: string
    count: number
    children: Array<{
      value: string
      label: string
      count: number
      children: CategoryTreeNode[]
      _smallSet: Set<string>
    }>
    _midMap: Map<string, {
      value: string
      label: string
      count: number
      children: CategoryTreeNode[]
      _smallSet: Set<string>
    }>
  }>()

  rows.forEach((row) => {
    const big = toSafeLabel(row.big)
    const mid = toSafeLabel(row.mid)
    const small = toSafeLabel(row.small)
    const count = Math.max(0, Number(row.count) || 0)

    let bigNode = bigMap.get(big)
    if (!bigNode) {
      bigNode = {
        value: big,
        label: big,
        count: 0,
        children: [],
        _midMap: new Map(),
      }
      bigMap.set(big, bigNode)
    }
    bigNode.count += count

    let midNode = bigNode._midMap.get(mid)
    if (!midNode) {
      midNode = {
        value: mid,
        label: mid,
        count: 0,
        children: [],
        _smallSet: new Set(),
      }
      bigNode._midMap.set(mid, midNode)
      bigNode.children.push(midNode)
    }
    midNode.count += count

    if (!midNode._smallSet.has(small)) {
      midNode._smallSet.add(small)
      midNode.children.push({
        value: small,
        label: small,
        count,
      })
      return
    }

    const existingSmall = midNode.children.find((item) => item.value === small)
    if (existingSmall) {
      existingSmall.count += count
    }
  })

  const tree = Array.from(bigMap.values()).map((bigNode) => ({
    value: bigNode.value,
    label: bigNode.label,
    count: bigNode.count,
    children: bigNode.children.map((midNode) => ({
      value: midNode.value,
      label: midNode.label,
      count: midNode.count,
      children: midNode.children.map((smallNode) => ({
        value: smallNode.value,
        label: smallNode.label,
        count: smallNode.count,
      })),
    })),
  }))

  return sortNodes(tree)
}

export function flattenCategoryTree(tree: CategoryTreeNode[] = []) {
  const result: string[] = []

  const traverse = (nodes: CategoryTreeNode[]) => {
    nodes.forEach((node) => {
      if (Array.isArray(node.children) && node.children.length > 0) {
        traverse(node.children)
        return
      }
      result.push(node.value)
    })
  }

  traverse(tree)
  return result
}

export async function loadCategoryTreeFromDatabase(
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>,
) {
  const sql = `
    SELECT
      COALESCE(NULLIF(TRIM(category_main), ''), '未分类') AS big,
      COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类')) AS mid,
      COALESCE(NULLIF(TRIM(brand_category), ''), COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类'))) AS small,
      COUNT(*)::int AS count
    FROM public.pois
    GROUP BY 1, 2, 3
    ORDER BY big, mid, small
  `

  const result = await query(sql)
  return buildCategoryTree(result.rows as CategoryTreeRow[])
}
