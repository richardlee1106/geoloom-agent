import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseEnv } from 'dotenv'

export interface LoadRuntimeEnvOptions {
  appDir?: string
  env?: NodeJS.ProcessEnv
}

export interface LoadRuntimeEnvResult {
  appDir: string
  rootDir: string
  loadedFiles: string[]
}

function defaultAppDir() {
  const thisFile = fileURLToPath(import.meta.url)
  const thisDir = dirname(thisFile)
  // src/config → 向上两级 = backend
  // dist/src/config → 向上两级 = backend/dist，需要再向上一级 = backend
  const upTwo = resolve(thisDir, '..', '..')
  const isDist = upTwo.endsWith('dist') || upTwo.endsWith('\\dist') || upTwo.endsWith('/dist')
  return isDist ? resolve(upTwo, '..') : upTwo
}

function readEnvFile(filepath: string) {
  if (!existsSync(filepath)) {
    return null
  }

  return parseEnv(readFileSync(filepath, 'utf8'))
}

export function loadRuntimeEnv(options: LoadRuntimeEnvOptions = {}): LoadRuntimeEnvResult {
  const appDir = resolve(options.appDir || defaultAppDir())
  const rootDir = resolve(appDir, '..')
  const env = options.env || process.env
  const candidates = [
    join(rootDir, '.env'),
    join(rootDir, '.env.v4'),
    join(appDir, '.env'),
  ]

  const loadedFiles: string[] = []
  const merged: Record<string, string> = {}

  for (const filepath of candidates) {
    const parsed = readEnvFile(filepath)
    if (!parsed) continue
    loadedFiles.push(filepath)
    Object.assign(merged, parsed)
  }

  const effective = {
    ...merged,
    ...env,
  }

  for (const [key, value] of Object.entries(effective)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  return {
    appDir,
    rootDir,
    loadedFiles,
  }
}
