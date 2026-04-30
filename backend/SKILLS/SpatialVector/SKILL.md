---
name: spatial_vector
runtimeSkill: spatial_vector
description: 空间向量召回技能
actions: search_semantic_pois, search_similar_regions
capabilities: retrieval, semantic_candidates
---

# SpatialVector Skill

## Prompt
空间向量召回技能。用于模糊空间候选召回和相似片区检索。召回结果是候选集，不是最终确定性结论。
在片区洞察题里，它更适合补充相似片区、模糊业态候选和语义对照，不能替代 postgis 结构证据来直接回答区域结构、经营机会、供给或竞争问题。
在“相似片区 / 相似区域”工作流里，应该把它当作候选召回层，再交给 `spatial_encoder` 做参考片区快照编码、查询复核与相似维度拆解，最终输出整体相似度和 2-4 个最有解释力的相似维度。
