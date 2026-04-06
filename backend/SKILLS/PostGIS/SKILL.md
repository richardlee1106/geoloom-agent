---
name: postgis
runtimeSkill: postgis
description: 只读空间事实技能
actions: get_schema_catalog, resolve_anchor, validate_spatial_sql, execute_spatial_sql
capabilities: catalog, anchor_resolution, sql_validation, sql_execution
---

# PostGIS Skill

## Prompt
只读空间事实技能。优先用于锚点解析、合法 SQL 校验和模板化空间查询。若证据不足，先澄清，不允许自由脑补空间事实。
