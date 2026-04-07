import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolveResourceUrl(moduleUrl: string, candidates: string[]) {
  for (const relativePath of candidates) {
    const candidate = new URL(relativePath, moduleUrl)
    if (existsSync(fileURLToPath(candidate))) {
      return candidate
    }
  }

  return new URL(candidates[0], moduleUrl)
}
