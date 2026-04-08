// @vitest-environment node

import { describe, expect, it } from 'vitest'
import viteConfig from '../../../vite.config.js'

describe('child process browser shim wiring', () => {
  it('aliases child_process to the TypeScript browser shim', () => {
    const config = viteConfig({
      mode: 'test',
      command: 'build',
      isSsrBuild: false,
      isPreview: false
    })

    expect(config.resolve.alias.child_process).toMatch(/child-process-browser\.ts$/)
    expect(config.resolve.alias['node:child_process']).toMatch(/child-process-browser\.ts$/)
  })
})
