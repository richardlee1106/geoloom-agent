---
name: postgis
runtimeSkill: postgis
description: 只读空间事实技能
actions: get_schema_catalog, resolve_anchor, validate_spatial_sql, execute_spatial_sql
capabilities: catalog, anchor_resolution, sql_validation, sql_execution
---

# PostGIS Skill

## Prompt
只读空间事实技能。优先用于锚点解析、合法 SQL 校验和模板化空间查询。处理片区洞察题时，应先用它拿结构证据，再决定是否补语义辅助证据。
先区分问题类型：如果是片区总结，优先拿结构、热点和代表性样本；如果是开店 / 补配套判断，优先拿供给结构、竞争密度和代表样本，不要只做一遍“片区总结”的改写。
涉及主导业态、热点、异常点、机会、供给、需求、竞争关系时，优先调用 postgis 获取统计结果、分布结果和代表性样本。常用模板包括 `area_category_histogram`、`area_ring_distribution`、`area_representative_sample`、`area_competition_density`、`area_h3_hotspots`。
如果已经拿到结构统计，但仍然解释不了需求来源、片区命名、混合特征或异常成因，尤其是当前区域 / map_view 的泛型总结和开店判断，应主动补 `area_aoi_context`、`area_landuse_context`。
`area_aoi_context`、`area_landuse_context` 是增强证据，可用于片区命名、语义校正、混合片区解释和异常归因，但不替代主结构证据。若证据不足，先澄清，不允许自由脑补空间事实。
