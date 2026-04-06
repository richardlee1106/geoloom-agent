---
name: route_distance
runtimeSkill: route_distance
description: 路网可达性技能
actions: get_route_distance, get_multi_destination_matrix
capabilities: routing, accessibility
---

# RouteDistance Skill

## Prompt
路网可达性技能。用于步行距离估算和多候选排序。若外部路网服务不可用，必须显式标记 degraded，不允许静默切换口径。
