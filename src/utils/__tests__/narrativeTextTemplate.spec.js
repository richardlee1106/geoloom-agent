import { describe, expect, it } from 'vitest'
import { NARRATIVE_TEXT_TEMPLATE_MARKDOWN } from '../narrativeTextTemplate'

describe('narrativeTextTemplate', () => {
  it('contains three-section narrative template', () => {
    expect(NARRATIVE_TEXT_TEMPLATE_MARKDOWN).toContain('## 区域概览')
    expect(NARRATIVE_TEXT_TEMPLATE_MARKDOWN).toContain('## 区域洞察')
    expect(NARRATIVE_TEXT_TEMPLATE_MARKDOWN).toContain('## 行动建议')
  })

  it('contains narrative_flow schema keys and example', () => {
    const content = NARRATIVE_TEXT_TEMPLATE_MARKDOWN
    expect(content).toContain('narrative_flow')
    expect(content).toContain('focus')
    expect(content).toContain('voice_text')
    expect(content).toContain('duration')
    expect(content).toContain('region_id')
    expect(content).toContain('region_index')
    expect(content).toContain('center')
  })
})
