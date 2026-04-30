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

    expect(postgis?.promptSnippet).toMatch(/先区分问题类型|普通片区总结|区域主语|结构分布|代表性样本/)
    expect(spatialEncoder?.promptSnippet).toMatch(/语义辅助证据|不能冒充硬事实/)
    expect(spatialVector?.promptSnippet).toMatch(/候选集|不是最终确定性结论/)
  })
})
