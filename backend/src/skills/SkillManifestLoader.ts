import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SkillManifest {
  name: string
  runtimeSkill: string
  description: string
  actions: string[]
  capabilities: string[]
  promptSnippet: string
  path: string
}

export interface SkillManifestLoaderOptions {
  rootDir: URL | string
}

function parseCsv(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export class SkillManifestLoader {
  private readonly rootDir: string

  constructor(options: SkillManifestLoaderOptions) {
    this.rootDir = typeof options.rootDir === 'string'
      ? options.rootDir
      : fileURLToPath(options.rootDir)
  }

  async loadAll(): Promise<SkillManifest[]> {
    const entries = await readdir(this.rootDir, { withFileTypes: true })
    const manifests = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const filepath = join(this.rootDir, entry.name, 'SKILL.md')
        const content = await readFile(filepath, 'utf8')
        return this.parse(filepath, content)
      }))

    return manifests
  }

  private parse(path: string, content: string): SkillManifest {
    const sections = content.split(/\r?\n/)
    const metadata: Record<string, string> = {}
    let inMeta = false
    const promptLines: string[] = []
    let inPrompt = false

    for (const line of sections) {
      const trimmed = line.trim()
      if (trimmed === '---') {
        inMeta = !inMeta
        continue
      }

      if (inMeta) {
        const separator = trimmed.indexOf(':')
        if (separator > 0) {
          const key = trimmed.slice(0, separator).trim()
          const value = trimmed.slice(separator + 1).trim()
          metadata[key] = value
        }
        continue
      }

      if (/^##\s+Prompt/i.test(trimmed)) {
        inPrompt = true
        continue
      }

      if (/^##\s+/i.test(trimmed)) {
        inPrompt = false
      }

      if (inPrompt && trimmed) {
        promptLines.push(trimmed)
      }
    }

    return {
      name: metadata.name || '',
      runtimeSkill: metadata.runtimeSkill || metadata.name || '',
      description: metadata.description || '',
      actions: parseCsv(metadata.actions),
      capabilities: parseCsv(metadata.capabilities),
      promptSnippet: promptLines.join(' '),
      path,
    }
  }
}
