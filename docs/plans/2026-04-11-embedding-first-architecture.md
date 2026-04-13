# Embedding-First 架构升级开发计划

> 日期：2026-04-11
> 目标：充分利用 Embedding 能力，减少 LLM 依赖，提升响应速度和匹配质量

## 背景

当前系统的瓶颈：
- **品类解析**依赖 LLM 结构化输出（3-9s），不稳定（categoryKey 经常为 null）
- **品类 Embedding 输入太粗**：rawQuery 整句传入，被约束条件干扰（"靠近地铁站"导致品类匹配到交通设施）
- **web 搜索结果与 POI 匹配**停留在 name matching 层面，没有深度语义匹配
- **PostGIS 查询**只做空间过滤 + 品类过滤，不具备语义排序能力
- **DDG 搜索查询词**包含无意义前缀（"当前区域"），搜索效果差

### 现有 Embedding 基础设施
- **Jina API**：jina-embeddings-v5-text-small（1024维）+ jina-reranker-v3
- **CategoryEmbeddingIndex**：221 个品类预计算 embedding，cosine top-1 匹配
- **EntityAlignmentSkill**：embedding recall + reranker 精排（web↔POI 对齐）
- **空间编码器**：H3 cell 级别 88 维特征向量（point/line/polygon/population）

### 新增业务约束：大 viewport 的代表锚点优先级

这份方案要解决的，不是“把 viewport 里所有 POI 都看一遍”，而是把 viewport 压缩成少量**人一眼会先注意到的代表锚点**，再围绕这些锚点做语义判断、代表样本挑选和 web grounding。

新增约束：
- **大 viewport 下，代表性区域 / 点优先从 4 类主锚点里选**：`高校 → 景点景区 → 商圈 → 地铁站`
- 当 viewport 已经明显超出“步行生活圈”尺度时，这 4 类主锚点在候选池中应当是**绝对优先级**；必要时甚至可以作为**唯一优先级**
- 普通 POI（餐馆、便利店、酒店、单店商铺）在大 viewport 下不再承担“区域主语”职责，只能作为这些主锚点周边的**支撑样本**
- 换句话说，`representative sample` 在大 viewport 场景里不应该等价于“抽几个分散 POI”，而应该优先等价于“抽几个足够代表这片区域结构的主锚点”

这条约束会影响后续所有阶段：
- **PostGIS 候选生成**：先产出 AOI / 交通 / 商圈类主锚点，再补普通 POI 样本
- **AOI/Subject 选择**：区域主语必须优先从这 4 类主锚点中归纳，不应被随机样本带偏
- **Embedding rerank**：优先重排的是“主锚点描述”，不是全量普通 POI
- **Web fan-out**：联网 query 应优先围绕主锚点扩写，而不是围绕“当前区域”或随机代表样本扩写

---

## 阶段 0：Bug 修复（已完成 ✅）

### 0.1 品类 Embedding 输入预处理
- **问题**：`resolve(rawQuery)` 拿整句做 embedding，被"地铁站"拐跑
- **修复**：新增 `extractCategoryFocus()` 函数，从 rawQuery 提取主句品类名词
  - 按分隔符（，、最好、同时）取第一个子句
  - 去掉修饰前缀（这附近、高分推荐的）
  - `"这附近高分推荐的酒店，最好靠近地铁站"` → `"酒店"` → ✅ 住宿服务
- **文件**：`catalog/categoryEmbeddingIndex.ts`

### 0.2 DDG 搜索查询词清理
- **问题**：`intent.placeName = "当前区域"` 被拼进搜索词，DDG 返回 0 条
- **修复**：过滤掉无意义 anchor（当前区域、我的位置、这附近等）
- **文件**：`evidence/DeterministicEvidenceRuntime.ts`

---

## 阶段 1：POI Embedding 索引（pgvector）

> 预计工时：4-6 小时 | 影响范围：PostGIS 表结构 + 查询模板 + 启动脚本

### 1.1 安装 pgvector 扩展
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE pois ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS idx_pois_embedding ON pois USING hnsw (embedding vector_cosine_ops);
```
- pgvector 与 PostGIS 完全兼容，同一张表可同时有 `geometry` 和 `vector` 列
- HNSW 索引支持高效近似最近邻搜索

### 1.2 POI Embedding 预计算脚本
```
新增：scripts/compute-poi-embeddings.mjs
```
- 从 `pois` 表读取所有 POI（id, name, category_main, category_sub, address）
- 构造 embedding 文本：`"{name} {category_main} {category_sub}"` 
  - 示例：`"希尔顿酒店 住宿服务 宾馆酒店"`
- 批量调用 Jina embed API（每批 100 条，~50K POI 约 5 分钟）
- 写回 `UPDATE pois SET embedding = $vec WHERE id = $id`
- 支持增量更新（只处理 `embedding IS NULL` 的行）

### 1.3 启动时验证
- `server.ts` 启动检查：`SELECT COUNT(*) FROM pois WHERE embedding IS NULL`
- 如果缺失比例 > 5%，打印警告建议运行预计算脚本
- 不阻塞启动

### 1.4 改写 PostGIS 查询模板
```sql
-- 当前：纯空间 + 品类过滤
SELECT id, name, category_main, distance_m
FROM pois
WHERE ST_DWithin(geom, anchor, radius)
  AND category_main = '住宿服务'
ORDER BY distance_m
LIMIT 10

-- 升级：空间过滤 + 语义排序融合
SELECT id, name, category_main,
       ST_Distance(geom::geography, $anchor) AS distance_m,
       embedding <=> $query_vec AS semantic_dist
FROM pois
WHERE ST_DWithin(geom::geography, $anchor, $radius)
  AND embedding IS NOT NULL
ORDER BY 
  0.5 * (embedding <=> $query_vec) 
  + 0.5 * LEAST(ST_Distance(geom::geography, $anchor) / $radius, 1.0)
LIMIT 10
```
- 空间过滤用 PostGIS 空间索引（快速剪枝）
- 语义排序用 pgvector cosine 距离
- 融合权重可配置（空间 vs 语义）
- 品类过滤变为**可选**——语义相似度本身就能区分品类

### 验收标准
- [ ] `pois` 表有 `embedding` 列且 HNSW 索引生效
- [ ] 预计算脚本能在 10 分钟内处理全量 POI
- [ ] 查询 "高分酒店" 返回的 top-10 全是住宿类 POI（不靠 category_main 硬过滤）
- [ ] 查询延迟 < 200ms（空间+语义融合）

---

## 阶段 2：Web Snippet Embedding 对齐

> 预计工时：3-4 小时 | 影响范围：EntityAlignmentSkill

### 2.1 Snippet 向量化
- web 搜索结果的 `title + snippet` 拼接后 embed
- 示例：`"武汉光谷希尔顿酒店 4.8分 紧邻光谷广场地铁站 商务五星级"` → 1024维向量
- 与 POI embedding 直接做 cosine 相似度

### 2.2 简化 EntityAlignmentSkill
当前多阶段流程：
```
确定性 name matching → embedding recall → reranker 精排 → fusion rank
```
简化为：
```
web snippet embed → cosine vs POI embedding → reranker 精排 top-K → 输出
```
- 去掉确定性 name matching 阶段（embedding cosine 已经覆盖了名字相似度）
- 保留 reranker 作为精排（Jina reranker 对中文效果好）
- 保留 spatial proximity 加权（距离衰减）

### 2.3 POI Embedding 直接在 SQL 中做 recall
```sql
-- 用 web snippet embedding 在 PostGIS 里直接召回最相似的 POI
SELECT id, name, category_main, distance_m,
       embedding <=> $snippet_vec AS semantic_dist
FROM pois
WHERE ST_DWithin(geom::geography, $anchor, 3000)
  AND embedding IS NOT NULL
ORDER BY embedding <=> $snippet_vec
LIMIT 5
```
- 每条 web 结果对应一条 SQL 查询（10 条 web → 10 次查询，可并行）
- 或批量：先 embed 所有 snippet，再在 SQL 中用 `ANY` 做批量匹配

### 验收标准
- [ ] EntityAlignmentSkill 代码行数减少 30%+
- [ ] 对齐准确率不低于当前方案（用已有 5 题测试集验证）
- [ ] 端到端延迟 < 3s（web搜索 + snippet embed + POI recall + rerank）

---

## 阶段 3：Embedding-First 意图理解（替代 LLM 结构化输出）

> 预计工时：4-5 小时 | 影响范围：GeoLoomAgent 意图识别链路

### 3.1 queryType 向量分类
预计算 queryType 原型向量：
```typescript
const QUERY_TYPE_PROTOTYPES = {
  nearby_poi: [
    "附近有什么好吃的餐厅",
    "这附近的酒店推荐",
    "周边有咖啡店吗",
  ],
  area_overview: [
    "光谷的商业发展怎么样",
    "这个区域的整体情况",
    "汉口的餐饮分布",
  ],
  compare: [
    "光谷和汉口哪个餐饮更多",
    "对比这两个区域的商业密度",
  ],
  nearest_station: [
    "最近的地铁站在哪",
    "附近有公交站吗",
  ],
}
```
- 启动时 embed 所有原型文本，取每个 queryType 的**质心向量**
- 查询时 embed rawQuery → cosine vs 质心 → argmax → queryType
- 置信度不够时（top-2 差距 < 0.05）再 fallback 到 LLM

### 3.2 needsWebSearch 向量判断
预计算正反原型：
```typescript
const WEB_SEARCH_PROTOTYPES = {
  needs_web: [
    "高分推荐的酒店",
    "口碑好的餐厅",
    "最近新开的商场",
    "网红打卡地",
  ],
  no_web: [
    "附近有什么",
    "这个区域的POI分布",
    "最近的地铁站",
  ],
}
```
- cosine vs 正/反原型 → sigmoid → needsWebSearch 概率
- 阈值 > 0.6 → true，< 0.4 → false，中间走 LLM 或正则兜底

### 3.3 一次 embed 调用搞定全部
```typescript
// 1 次 Jina API 调用（~50ms），同时获得：
const queryEmbed = await bridge.embed([rawQuery])
const queryVec = queryEmbed.embeddings[0]

// 品类匹配（已有）
const category = categoryIndex.resolveWithEmbedding(queryVec)

// queryType 分类（新增）
const queryType = queryTypeIndex.resolveWithEmbedding(queryVec)

// needsWebSearch 判断（新增）
const needsWeb = webSearchIndex.resolveWithEmbedding(queryVec)
```
- **1 次 API 调用 + 3 次内存 cosine 计算** 替代 **1 次 LLM 调用（3-9s）**
- Fast Track 真正实现零 LLM

### 验收标准
- [ ] queryType 分类准确率 ≥ 90%（用已有回归测试集验证）
- [ ] needsWebSearch 判断准确率 ≥ 85%
- [ ] 意图识别总延迟 < 100ms（1 次 embed + 内存 cosine）
- [ ] LLM fallback 比例 < 15%

---

## 阶段 4：空间编码器 + POI Embedding 融合（探索性）

> 预计工时：评估后再定 | 前置条件：阶段 1-3 完成

### 4.1 场景
```
"在光谷找一家像武大附近那种安静的咖啡店"
```
- **POI embedding**：语义匹配"安静的咖啡店"
- **空间编码器**：找"像武大附近"的区域特征向量
- **融合**：在空间特征相似的区域里优先返回语义匹配的 POI

### 4.2 实现思路
- 空间编码器输出 88 维 cell 向量 → 降维或投影到与 POI embedding 同一空间
- 或简单方案：空间编码器做候选区域筛选 → POI embedding 做区域内排序
- 不需要把两种向量强行融合，用级联（cascade）即可

### 4.3 决策点
- 如果阶段 1-3 效果足够好，此阶段可能不需要做
- 仅在"跨区域推荐"场景有明显需求时才推进

---

## 补充实施要求：Viewport Anchor Synthesizer

在进入阶段 1-4 的具体实现前，先明确一个前置模块目标：

```text
viewport
→ 主锚点候选（高校 / 景点景区 / 商圈 / 地铁站）
→ 普通 POI 作为支撑样本挂载到主锚点
→ query-conditioned rerank
→ top anchors
→ web grounding
```

建议拆成两层：

### A. 主锚点层（必须优先）
- 输入：viewport / boundary / drawn region
- 候选来源：AOI、多边形景区、商圈面、地铁站及站区
- 排序规则：先按主锚点类型优先级，再按覆盖度、显著性、交通可达性、query 相关性排序
- 输出：`anchor_type`、`anchor_name`、`anchor_center`、`salience_score`

### B. 支撑样本层（只做辅助，不做主语）
- 仅在主锚点确定后，再从每个主锚点周边挂 2-5 个普通 POI 作为“代表样本”
- 这些 POI 负责解释“为什么这个锚点值得关注”，不负责定义“这片区域是谁”

### 大 viewport 特殊规则
- 当 viewport 足够大时，不允许普通 POI 直接进入 top anchor
- 当 viewport 足够大时，允许只保留“高校 / 景点景区 / 商圈 / 地铁站”四类主锚点，不再展示普通 POI 级别代表点
- “大”的具体阈值可后续通过 bbox 对角线、面积、热点数量共同判定，但约束本身先固定下来

### 验收标准补充
- [ ] 大 viewport 下，top anchors 不再出现随机单店 POI 充当区域主语
- [ ] 大 viewport 下，区域主语优先稳定落在高校 / 景点景区 / 商圈 / 地铁站
- [ ] 代表样本与热点描述围绕主锚点展开，不再出现“未命名地点”“普通单店”主导整段结论
- [ ] web 搜索扩写词优先采用主锚点名称，不再使用“当前区域”这类弱锚点

---

## 技术约束与风险

| 风险 | 缓解措施 |
|------|---------|
| Jina API 调用量增加（POI 预计算） | 批量调用 + 本地缓存，一次性成本 |
| pgvector HNSW 索引内存占用 | 50K × 1024 × 4B ≈ 200MB，可接受 |
| POI 数据更新后 embedding 失效 | 增量脚本 + 启动时检查 NULL 比例 |
| queryType 向量分类边界模糊 | 保留 LLM fallback，中间地带走 LLM |
| DDG 搜索不稳定 | Tavily 作为后备已覆盖 |

## 依赖关系

```
阶段 0（Bug 修复）✅
    ↓
阶段 1（POI Embedding + pgvector）
    ↓
阶段 2（Snippet Embedding 对齐） ←── 依赖阶段 1 的 POI embedding
    ↓
阶段 3（Embedding-First 意图理解） ←── 独立，可与阶段 1 并行
    ↓
阶段 4（空间编码器融合） ←── 可选，依赖阶段 1-3 效果评估
```

## 预期效果

| 指标 | 当前 | 阶段 1-3 完成后 |
|------|------|----------------|
| 意图识别延迟 | 3-9s（LLM） | < 100ms（Embedding） |
| 品类匹配准确率 | ~80%（被修饰语干扰） | > 95%（聚焦提取） |
| POI 排序质量 | 纯距离排序 | 空间 + 语义融合 |
| Web↔POI 对齐 | 多阶段 name matching | 向量 cosine + reranker |
| LLM 调用次数 | 2-3 次/请求 | 0-1 次/请求 |
| Fast Track 端到端 | ~15s | < 5s |
