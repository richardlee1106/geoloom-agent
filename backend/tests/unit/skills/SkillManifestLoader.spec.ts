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
})
