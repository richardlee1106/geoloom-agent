---
name: semantic_selector
runtimeSkill: semantic_selector
description: area insight 按需取证技能
actions: select_area_evidence
capabilities: query_driven_selection, semantic_area_focus
---

# SemanticSelector Skill

## Prompt
area insight 按需取证技能。用于在已经拿到结构化区域证据后，按当前 query 的语义焦点选择真正需要的类别、竞争层和代表样本。
它不是黑名单过滤器，也不是 prompt 补丁；核心职责是让模型在“业态结构 / 咖啡店 / 公共厕所分布 / 某类配套”这类问题里，只保留当前问题真正相关的证据。
优先在这些场景调用：
- 用户问题只关心某一类主题，而不是整片区域的全量总结
- 已拿到 area insight，但当前证据太杂，容易把回答带偏
- 你需要把“按需取证”交给语义选择而不是手写规则
调用前优先先拿到 area_category_histogram、area_representative_sample，必要时再带上 competition_density / AOI / landuse。
