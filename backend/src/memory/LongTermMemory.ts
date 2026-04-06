import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LongTermMemoryOptions {
  dataDir: URL | string
}

export class LongTermMemory {
  private readonly dataDir: string

  constructor(options: LongTermMemoryOptions) {
    this.dataDir = typeof options.dataDir === 'string'
      ? options.dataDir
      : fileURLToPath(options.dataDir)
  }

  async appendSessionSummary(sessionId: string, summary: string) {
    await mkdir(this.dataDir, { recursive: true })
    const filepath = join(this.dataDir, `${sessionId}.json`)
    const payload = {
      sessionId,
      summary,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(filepath, JSON.stringify(payload, null, 2), 'utf8')
  }

  async readSessionSummary(sessionId: string) {
    try {
      const filepath = join(this.dataDir, `${sessionId}.json`)
      const content = await readFile(filepath, 'utf8')
      const parsed = JSON.parse(content) as { summary?: string }
      return parsed.summary || ''
    } catch {
      return ''
    }
  }
}
