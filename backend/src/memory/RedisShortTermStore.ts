import net from 'node:net'
import tls from 'node:tls'

import type { ShortTermMemoryStore, ShortTermRecordData } from './ShortTermMemory.js'

type RedisValue = string | number | null | RedisValue[]

class IncompleteRedisResponseError extends Error {}

function encodeCommand(parts: Array<string | number>) {
  const normalized = parts.map((part) => String(part))
  return `*${normalized.length}\r\n${normalized.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`
}

function readLine(buffer: Buffer, offset: number) {
  const end = buffer.indexOf('\r\n', offset)
  if (end === -1) {
    throw new IncompleteRedisResponseError('Incomplete redis response line')
  }
  return {
    line: buffer.subarray(offset, end).toString('utf8'),
    nextOffset: end + 2,
  }
}

function parseRedisValue(buffer: Buffer, offset = 0): { value: RedisValue, nextOffset: number } {
  if (offset >= buffer.length) {
    throw new IncompleteRedisResponseError('Incomplete redis response')
  }

  const type = String.fromCharCode(buffer[offset])
  const header = readLine(buffer, offset + 1)

  if (type === '+') {
    return { value: header.line, nextOffset: header.nextOffset }
  }

  if (type === '-') {
    throw new Error(header.line)
  }

  if (type === ':') {
    return { value: Number(header.line), nextOffset: header.nextOffset }
  }

  if (type === '$') {
    const length = Number(header.line)
    if (length === -1) {
      return { value: null, nextOffset: header.nextOffset }
    }

    const end = header.nextOffset + length
    if (buffer.length < end + 2) {
      throw new IncompleteRedisResponseError('Incomplete redis bulk string')
    }

    return {
      value: buffer.subarray(header.nextOffset, end).toString('utf8'),
      nextOffset: end + 2,
    }
  }

  if (type === '*') {
    const count = Number(header.line)
    if (count === -1) {
      return { value: null, nextOffset: header.nextOffset }
    }

    const values: RedisValue[] = []
    let nextOffset = header.nextOffset
    for (let index = 0; index < count; index += 1) {
      const parsed = parseRedisValue(buffer, nextOffset)
      values.push(parsed.value)
      nextOffset = parsed.nextOffset
    }
    return {
      value: values,
      nextOffset,
    }
  }

  throw new Error(`Unsupported redis response type: ${type}`)
}

export interface RedisShortTermStoreOptions {
  url: string
  keyPrefix?: string
  connectTimeoutMs?: number
}

function createSocket(url: URL) {
  if (url.protocol === 'rediss:') {
    return tls.connect({
      host: url.hostname,
      port: Number(url.port || 6380),
      servername: url.hostname,
    })
  }

  return net.createConnection({
    host: url.hostname,
    port: Number(url.port || 6379),
  })
}

export class RedisShortTermStore implements ShortTermMemoryStore {
  private readonly target: URL

  private readonly keyPrefix: string

  private readonly connectTimeoutMs: number

  constructor(options: RedisShortTermStoreOptions) {
    this.target = new URL(options.url)
    this.keyPrefix = options.keyPrefix || 'v4:short-term:'
    this.connectTimeoutMs = options.connectTimeoutMs || 2000
  }

  async ping() {
    const [result] = await this.runCommands([['PING']])
    return result
  }

  async getRecord(sessionId: string): Promise<ShortTermRecordData | null> {
    const [result] = await this.runCommands([['GET', this.key(sessionId)]])
    if (typeof result !== 'string' || !result) {
      return null
    }
    return JSON.parse(result) as ShortTermRecordData
  }

  async setRecord(sessionId: string, record: ShortTermRecordData, ttlMs: number) {
    await this.runCommands([
      ['SET', this.key(sessionId), JSON.stringify(record), 'PX', Math.max(1000, Math.floor(ttlMs))],
    ])
  }

  private key(sessionId: string) {
    return `${this.keyPrefix}${sessionId}`
  }

  private async runCommands(commands: Array<Array<string | number>>): Promise<RedisValue[]> {
    const authPassword = this.target.password ? decodeURIComponent(this.target.password) : ''
    const authUsername = this.target.username ? decodeURIComponent(this.target.username) : ''
    const dbIndex = Number(this.target.pathname.replace('/', '') || '0')
    const setupCommands: Array<Array<string | number>> = []

    if (authPassword) {
      setupCommands.push(authUsername ? ['AUTH', authUsername, authPassword] : ['AUTH', authPassword])
    }
    if (dbIndex > 0) {
      setupCommands.push(['SELECT', dbIndex])
    }

    const allCommands = [...setupCommands, ...commands]

    return new Promise((resolve, reject) => {
      const socket = createSocket(this.target)
      const chunks: Buffer[] = []
      let settled = false

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        socket.removeAllListeners()
        socket.destroy()
        callback()
      }

      const timeout = setTimeout(() => {
        finish(() => reject(new Error('redis_timeout')))
      }, this.connectTimeoutMs)

      socket.on('error', (error) => {
        clearTimeout(timeout)
        finish(() => reject(error))
      })

      socket.on('connect', () => {
        socket.write(allCommands.map((command) => encodeCommand(command)).join(''))
      })

      socket.on('data', (chunk) => {
        chunks.push(chunk)
        try {
          const buffer = Buffer.concat(chunks)
          const results: RedisValue[] = []
          let offset = 0
          for (let index = 0; index < allCommands.length; index += 1) {
            const parsed = parseRedisValue(buffer, offset)
            results.push(parsed.value)
            offset = parsed.nextOffset
          }

          clearTimeout(timeout)
          finish(() => resolve(results.slice(setupCommands.length)))
        } catch (error) {
          if (error instanceof IncompleteRedisResponseError) {
            return
          }
          clearTimeout(timeout)
          finish(() => reject(error))
        }
      })
    })
  }
}

export function createRedisShortTermStoreFromEnv() {
  const redisUrl = String(process.env.REDIS_URL || '').trim()
  if (!redisUrl) {
    return null
  }

  return new RedisShortTermStore({
    url: redisUrl,
    keyPrefix: String(process.env.SHORT_TERM_MEMORY_PREFIX || 'v4:short-term:'),
    connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || '2000'),
  })
}
