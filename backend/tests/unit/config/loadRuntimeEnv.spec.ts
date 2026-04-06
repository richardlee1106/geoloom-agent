import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { loadRuntimeEnv } from '../../../src/config/loadRuntimeEnv.js'

const tempDirs: string[] = []

function createTempWorkspace() {
  const rootDir = mkdtempSync(join(tmpdir(), 'v4-env-loader-'))
  const appDir = join(rootDir, 'V4-GeoLoom-beta')
  mkdirSync(appDir, { recursive: true })
  tempDirs.push(rootDir)
  return { rootDir, appDir }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('loadRuntimeEnv', () => {
  it('loads root .env and .env.v4 for the V4 app while keeping explicit env precedence', () => {
    const { rootDir, appDir } = createTempWorkspace()
    writeFileSync(join(rootDir, '.env'), 'LLM_BASE_URL=https://legacy.example/v1\nREDIS_URL=redis://root\n')
    writeFileSync(join(rootDir, '.env.v4'), 'LLM_BASE_URL=https://api.minimaxi.com/anthropic\nLLM_MODEL=MiniMax-M2.7\n')
    writeFileSync(join(appDir, '.env'), 'REDIS_URL=redis://app\nROUTING_BASE_URL=http://routing.service\n')

    const env: NodeJS.ProcessEnv = {
      LLM_MODEL: 'process-model-wins',
    }

    const result = loadRuntimeEnv({
      appDir,
      env,
    })

    expect(env.LLM_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(env.LLM_MODEL).toBe('process-model-wins')
    expect(env.REDIS_URL).toBe('redis://app')
    expect(env.ROUTING_BASE_URL).toBe('http://routing.service')
    expect(result.loadedFiles.map((file) => file.replaceAll('\\', '/'))).toEqual([
      `${rootDir.replaceAll('\\', '/')}/.env`,
      `${rootDir.replaceAll('\\', '/')}/.env.v4`,
      `${appDir.replaceAll('\\', '/')}/.env`,
    ])
  })

  it('returns cleanly when no runtime env files exist', () => {
    const { appDir } = createTempWorkspace()
    const env: NodeJS.ProcessEnv = {}

    const result = loadRuntimeEnv({
      appDir,
      env,
    })

    expect(result.loadedFiles).toEqual([])
    expect(env).toEqual({})
  })
})
