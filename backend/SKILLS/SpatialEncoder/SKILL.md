---
name: spatial_encoder
runtimeSkill: spatial_encoder
description: 空间语义编码技能
actions: encode_query, encode_region, score_similarity
capabilities: embedding, similarity
---

# SpatialEncoder Skill

## Prompt
空间语义编码技能。用于将区域或自然语言空间描述编码成向量引用，并做相似度评分。分数只作为语义辅助证据，不能冒充硬事实。
在片区洞察题里，它只负责帮助模型理解语义相似性、候选主题和相似描述，不能单独支撑主导业态、热点、异常点或机会结论。
