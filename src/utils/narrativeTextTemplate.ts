export const NARRATIVE_UI_ONLY_NOTICE = '当前为前端展示模式，后端接入中。'

export const NARRATIVE_TEXT_TEMPLATE_MARKDOWN = `
## 区域概览
- **空间范围**：描述本次分析覆盖区域（如视口范围或自定义选区）。
- **核心结论**：用 1-2 句总结区域总体特征与主导功能。
- **证据锚点**：列出可验证的地标、道路、商圈或公共设施。

## 区域洞察
1. **功能结构**：说明区域内主要功能分区及其相对关系。
2. **人群与活动**：概述客流、停留行为或时段差异（如有证据）。
3. **边界不确定性**：说明区域边界可能的模糊带及影响范围。

## 行动建议
1. 给出 1 条短期可执行动作（例如选址验证、路线优化）。
2. 给出 1 条中期策略建议（例如业态组合、服务半径调整）。
3. 标注 1 条需补充数据的风险点（例如夜间客流、工作日差异）。

## narrative_flow Schema
\`\`\`json
{
  "narrative_flow": [
    {
      "focus": "overview",
      "voice_text": "用于播报的解说文本。",
      "duration": 4000,
      "region_id": null,
      "region_index": -1,
      "center": [114.3000, 30.5200]
    },
    {
      "focus": "光谷步行街",
      "voice_text": "该片区商业密度高，夜间活力显著。",
      "duration": 5000,
      "region_id": "region_1",
      "region_index": 0,
      "center": [114.4000, 30.5100]
    }
  ]
}
\`\`\`
`.trim()
