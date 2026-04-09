import { describe, expect, it } from 'vitest'

import { SkillManifestLoader } from '../../../src/skills/SkillManifestLoader.js'

describe('SkillManifestLoader', () => {
  it('loads markdown skill manifests from the SKILLS directory', async () => {
    const loader = new SkillManifestLoader({
      rootDir: new URL('../../../SKILLS/', import.meta.url),
    })

    const manifests = await loader.loadAll()
    const postgis = manifests.find((item) => item.name === 'postgis')

    expect(manifests.length).toBeGreaterThanOrEqual(4)
    expect(postgis).toMatchObject({
      name: 'postgis',
      runtimeSkill: 'postgis',
    })
    expect(postgis?.actions).toContain('resolve_anchor')
    expect(postgis?.promptSnippet).toMatch(/只读空间事实技能/)
  })

  it('loads area-insight orchestration guidance from skill prompts', async () => {
    const loader = new SkillManifestLoader({
      rootDir: new URL('../../../SKILLS/', import.meta.url),
    })

    const manifests = await loader.loadAll()
    const postgis = manifests.find((item) => item.name === 'postgis')
    const spatialEncoder = manifests.find((item) => item.name === 'spatial_encoder')
    const spatialVector = manifests.find((item) => item.name === 'spatial_vector')

    expect(postgis?.promptSnippet).toMatch(/先拿结构证据|主导业态|热点|异常点|机会/)
    expect(spatialEncoder?.promptSnippet).toMatch(/语义辅助证据|不能冒充硬事实/)
    expect(spatialVector?.promptSnippet).toMatch(/候选集|不是最终确定性结论/)
  })
})
