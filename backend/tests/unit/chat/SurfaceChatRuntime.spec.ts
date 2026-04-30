import { describe, expect, it } from 'vitest'

import { SurfaceChatRuntime } from '../../../src/chat/SurfaceChatRuntime.js'

describe('SurfaceChatRuntime.getHealth', () => {
  it('exposes default-runtime health at the top level', async () => {
    const runtime = new SurfaceChatRuntime({
      defaultRuntime: {
        createWriter() {
          throw new Error('not used in health tests')
        },
        async handle() {
          throw new Error('not used in health tests')
        },
        async getHealth() {
          return {
            provider_ready: true,
            llm: {
              ready: true,
              provider: 'openai-compatible',
              model: 'astron-code-latest',
            },
          }
        },
      },
    })

    const health = await runtime.getHealth()

    expect(health.provider_ready).toBe(true)
    expect(health.llm).toEqual({
      ready: true,
      provider: 'openai-compatible',
      model: 'astron-code-latest',
    })
  })
})
