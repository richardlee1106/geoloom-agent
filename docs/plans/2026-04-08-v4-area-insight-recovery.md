# V4 LLM-First Area Insight Recovery Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 V4 的片区泛型问题真正回到 `LLM 主导编排 -> 原子 skills 出证据 -> 基于证据直接回答` 的主路径，不再把 `area_overview` 做成规则驱动的查询器。

**Architecture:** 保留 V4 单次 LLM 短链路，不回退到 V1/V3 长流水线。把 `DeterministicRouter / Renderer / fallback SQL` 都降级为护栏层和降级层，把“任务理解、工具选择、调用顺序、停止时机、最终回答”重新交还给强模型；同时继续用 `postgis`、`spatial_encoder`、`spatial_vector` 提供真实证据，禁止无证据脑补。

**Tech Stack:** Fastify, TypeScript, PostGIS, V4 SkillRegistry, OpenAI-compatible function calling, Evidence View, SSE, Vitest

---

## Core Principles

- **编排权归 LLM**：用户问题属于什么分析任务、先调什么工具、调几轮、何时停止，都由 LLM 决定。
- **事实权归 tools**：空间事实、统计结果、候选召回、竞争密度都必须来自技能结果。
- **安全权归护栏**：SQL 白名单、toy fallback 降权、降级策略、最低置信门槛不能交给 LLM 自由发挥。
- **确定性组件只做压缩与兜底**：`DeterministicRouter` 只保留 hint/fallback，`Renderer` 只保留保底摘要。
- **V1 只借能力，不借架构**：可以轻量迁移 `livelihood_profile / region view / h3 summary` 等证据生成逻辑，但不能把长链 planner/writer 搬回 V4。

---

### Task 1: 先锁住“真正 agent 化”的目标行为

**Files:**
- Modify: `backend/tests/unit/agent/GeoLoomAgent.spec.ts`
- Modify: `backend/tests/unit/chat/DeterministicRouter.spec.ts`
- Modify: `backend/tests/integration/routes/chat.spec.ts`
- Modify: `backend/tests/smoke/minimaxPhase8_3.corpus.ts`

**TODO:**
- 新增 4 类片区问题回归题：
  - “请快速读懂当前区域，总结主导业态、活力热点、异常点、机会”
  - “如果要在当前区域开店，哪些业态更值得优先考虑，请结合供给、需求和竞争关系说明”
  - “武汉大学附近适合补什么配套”
  - “当前区域最大的异常点是什么”
- 为这些题补“期望链路”断言：
  - LLM 应有机会自主发起多轮 tool calling
  - 不能由 router 直接把复杂题压成固定模板 SQL
  - 不能把 deterministic renderer 文本当复杂题主回答
  - 没有分析级证据时不能输出高置信结论
- 在 smoke corpus 中加入 2 条 area insight 题，作为真编排验收样本。

**验证命令:**
- `cd backend && npx vitest run tests/unit/agent/GeoLoomAgent.spec.ts tests/unit/chat/DeterministicRouter.spec.ts`
- `cd backend && npx vitest run tests/integration/routes/chat.spec.ts`

**完成标准:**
- 测试先以 FAIL 形式锁定“当前不是 agent 编排”的错误行为。

---

### Task 2: 把 `DeterministicRouter` 从主决策器降级成 hint / fallback 层

**Files:**
- Modify: `backend/src/chat/DeterministicRouter.ts`
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/tests/unit/chat/DeterministicRouter.spec.ts`
- Modify: `backend/tests/unit/agent/GeoLoomAgent.spec.ts`

**TODO:**
- 保留 router 的强项：
  - 锚点抽取
  - `user_location` / `map_view` 识别
  - clarification hint
  - provider 不可用时的 deterministic fallback
- 拿掉 router 的越权部分：
  - 不再把 `area_overview` 的证据链和回答路径提前写死
  - 不再让 queryType 命中后直接把复杂题导向固定 SQL 模板
- 让 `GeoLoomAgent` 在 provider ready 时把原始 query、router hint、spatial context 一起交给 LLM，由 LLM 决定 tool sequence。

**验证命令:**
- `cd backend && npx vitest run tests/unit/chat/DeterministicRouter.spec.ts tests/unit/agent/GeoLoomAgent.spec.ts`

**完成标准:**
- `DeterministicRouter` 不再主导 area insight 的分析路线，只提供上下文 hint 和兜底能力。

---

### Task 3: 让强模型真正接管 area insight 的编排权

**Files:**
- Modify: `backend/src/agent/AlivePromptBuilder.ts`
- Modify: `backend/SKILLS/PostGIS/SKILL.md`
- Modify: `backend/SKILLS/SpatialEncoder/SKILL.md`
- Modify: `backend/SKILLS/SpatialVector/SKILL.md`
- Modify: `backend/tests/unit/agent/AlivePromptBuilder.spec.ts`
- Modify: `backend/tests/unit/skills/SkillManifestLoader.spec.ts`

**TODO:**
- 在 system prompt 和 skill snippet 中明确 area insight 的 agent contract：
  - 先判断用户要的是结构、热点、异常、机会、供给、竞争中的哪几类证据
  - 再决定先调用 `postgis` 还是补语义召回
  - 证据不足时继续调用，不足够就坦诚降级
  - 最终回答必须引用证据，不允许只凭常识猜
- 在 prompt 中明确各 skill 的角色边界：
  - `postgis`: 硬事实和结构统计主引擎
  - `spatial_encoder`: 语义编码与相似度辅助
  - `spatial_vector`: 模糊候选与相似片区辅助
- 把 area insight 的停止规则也交给 LLM：
  - 已覆盖结构 + 热点 + 异常 + 机会所需核心证据即可停止
  - 不要无意义多轮调用

**验证命令:**
- `cd backend && npx vitest run tests/unit/agent/AlivePromptBuilder.spec.ts tests/unit/skills/SkillManifestLoader.spec.ts`

**完成标准:**
- 强模型看到的不是“静态工具说明”，而是一套可执行的 area insight 编排契约。

---

### Task 4: 让 `GeoLoomAgent` 支持真正的 LLM-first orchestration

**Files:**
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/src/llm/functionCallingLoop.ts`
- Modify: `backend/src/chat/types.ts`
- Modify: `backend/tests/unit/agent/GeoLoomAgent.spec.ts`
- Modify: `backend/tests/unit/llm/FunctionCallingLoop.spec.ts`

**TODO:**
- 调整 `GeoLoomAgent` 的 area insight 主链路：
  - provider ready 时，优先走 LLM function calling loop
  - `recoverCoreSpatialEvidenceIfNeeded()` 对 area insight 只做缺口兜底，不再抢编排权
  - `shouldPreferRenderedAnswer` 对 area insight 默认改为 `false`
- 给 function calling loop 补强 agent 运行特性：
  - 记录每轮“已经拿到什么证据”
  - 防止重复调用同一 action + 参数
  - 支持 area insight 多轮调用但要有合理停止
- 把 deterministic renderer 降级成：
  - provider 不可用时兜底
  - tool 调用失败时保底摘要

**验证命令:**
- `cd backend && npx vitest run tests/unit/agent/GeoLoomAgent.spec.ts tests/unit/llm/FunctionCallingLoop.spec.ts`

**完成标准:**
- 复杂片区题的真实主链路已经是“LLM 规划并驱动 tool calling”，而不是 fallback SQL。

---

### Task 5: 在现有 `postgis` skill 里补最小分析级原子动作

**Files:**
- Modify: `backend/src/skills/postgis/PostGISSkill.ts`
- Modify: `backend/src/skills/postgis/sqlSecurity.ts`
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Create: `backend/src/skills/postgis/templates/areaCategoryHistogram.sql`
- Create: `backend/src/skills/postgis/templates/areaRingDistribution.sql`
- Create: `backend/src/skills/postgis/templates/areaRepresentativeSample.sql`
- Create: `backend/src/skills/postgis/templates/areaCompetitionDensity.sql`
- Create: `backend/src/skills/postgis/templates/areaH3Hotspots.sql`
- Modify: `backend/tests/unit/skills/postgis/executeSQL.spec.ts`
- Modify: `backend/tests/unit/sandbox/SQLSandbox.spec.ts`

**TODO:**
- 继续坚持“原子 skill”原则，不新增大而全 `area_analysis skill`。
- 在现有 `postgis.execute_spatial_sql` 体系下补最小分析动作：
  - `area_category_histogram`: 主导业态、次主导业态、集中度
  - `area_ring_distribution`: 距离环带分布
  - `area_representative_sample`: 代表性 POI 样本
  - `area_competition_density`: 指定业态竞争密度
  - `area_h3_hotspots`: 热点网格/高密单元
- 这些动作只负责产出证据，不负责写结论。
- 继续走 SQL 安全三层锁，只开放白名单字段和函数。

**验证命令:**
- `cd backend && npx vitest run tests/unit/skills/postgis/executeSQL.spec.ts tests/unit/sandbox/SQLSandbox.spec.ts`

**完成标准:**
- LLM 已经有足够的原子事实块可编排，不需要退回“查附近 80 个 POI”这种单一做法。

---

### Task 6: 升级 `area_overview` Evidence View，让它承载“分析结果”而不是“查询结果”

**Files:**
- Modify: `backend/src/chat/types.ts`
- Modify: `backend/src/evidence/EvidenceViewFactory.ts`
- Modify: `backend/src/evidence/views/AreaOverviewView.ts`
- Modify: `backend/src/evidence/Renderer.ts`
- Modify: `backend/tests/unit/evidence/EvidenceViewFactory.spec.ts`
- Modify: `backend/tests/unit/evidence/Renderer.spec.ts`

**TODO:**
- 扩展 `EvidenceView` 的 `area_overview` 结构，至少携带：
  - `areaProfile`
  - `hotspots`
  - `anomalySignals`
  - `opportunitySignals`
  - `representativeSamples`
  - `confidence`
  - `semanticHints`
- `Renderer` 重新定位为 area insight 的保底摘要器：
  - provider 不可用时能给清楚但保守的 deterministic 摘要
  - provider 可用时不再承担复杂题主回答
- 避免继续把“示例 POI + 计数”硬写成“活力热点”。

**验证命令:**
- `cd backend && npx vitest run tests/unit/evidence/EvidenceViewFactory.spec.ts tests/unit/evidence/Renderer.spec.ts`

**完成标准:**
- evidence 层已经能承载 LLM 编排后的分析证据，而不是只承载查询列表。

---

### Task 7: 轻量迁移 V1 里真正有价值的证据计算逻辑

**Files:**
- Create: `backend/src/evidence/areaInsight/livelihoodProfile.ts`
- Create: `backend/src/evidence/areaInsight/opportunitySignals.ts`
- Modify: `backend/src/evidence/views/AreaOverviewView.ts`
- Create: `backend/tests/unit/evidence/livelihoodProfile.spec.ts`

**TODO:**
- 参考 V1 的 `_build_livelihood_profile`，把“主导类目”从简单 secondary category 计数升级为：
  - preferred primary category
  - dominant primary
  - dominant secondary
  - low-signal ratio
  - ranking_applied
- `opportunitySignals` 至少输出：
  - 稀缺型机会
  - 竞争过密警告
  - 结构单一风险
  - 互补配套缺口
- 强调这一步是迁移“证据算法”，不是迁移“planner + writer”架构。

**验证命令:**
- `cd backend && npx vitest run tests/unit/evidence/livelihoodProfile.spec.ts tests/unit/evidence/EvidenceViewFactory.spec.ts`

**完成标准:**
- “主导业态 / 机会”开始来自结构化信号，不再是 renderer 猜句子。

---

### Task 8: 让编码器 / 双塔成为 LLM 可用的辅助证据，而不是摆设

**Files:**
- Modify: `backend/src/integration/pythonBridge.ts`
- Modify: `backend/src/integration/faissIndex.ts`
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/src/skills/spatial_encoder/SpatialEncoderSkill.ts`
- Modify: `backend/src/skills/spatial_vector/SpatialVectorSkill.ts`
- Modify: `backend/tests/unit/integration/pythonBridge.spec.ts`
- Modify: `backend/tests/unit/integration/faissIndex.spec.ts`
- Modify: `backend/tests/unit/skills/spatial_encoder/SpatialEncoderSkill.spec.ts`
- Modify: `backend/tests/unit/skills/spatial_vector/SpatialVectorSkill.spec.ts`

**TODO:**
- 增加 semantic evidence 状态门控：
  - `remote_unconfigured` 或 toy fallback 时，LLM 只能把结果当弱证据
  - remote ready 时，LLM 才能把它们用于相似片区、模糊业态、命名辅助
- 对 prompt / tool result 显式暴露状态：
  - `semantic_evidence: available | degraded | unavailable`
- 在 area insight 场景增加两类可选辅助调用：
  - `search_similar_regions`
  - `search_semantic_pois`
- 禁止 local toy vector 的结果直接进入最终“机会推荐”主证据。

**验证命令:**
- `cd backend && npx vitest run tests/unit/integration/pythonBridge.spec.ts tests/unit/integration/faissIndex.spec.ts`
- `cd backend && npx vitest run tests/unit/skills/spatial_encoder/SpatialEncoderSkill.spec.ts tests/unit/skills/spatial_vector/SpatialVectorSkill.spec.ts`

**完成标准:**
- LLM 已经能在正确边界内使用 encoder / 双塔，而不是“看起来有接口，实际没价值”。

---

### Task 9: 分阶段把 AOI / EULUC / landuse 接到 agent 主链路

**Files:**
- Modify: `backend/src/skills/postgis/sqlSecurity.ts`
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/src/chat/types.ts`
- Modify: `backend/tests/unit/sandbox/SQLSandbox.spec.ts`
- Modify: `backend/tests/integration/routes/chat.spec.ts`

**TODO:**
- 先确认真实数据库里 AOI / EULUC / landuse 表与字段是否可用。
- 如果可用，再逐步开放只读 catalog：
  - AOI 名称 / 类型
  - landuse / euluc 类型
  - map view boundary 内聚合
- 让这些信号作为 LLM 的增强证据：
  - 片区命名
  - 语义校正
  - 异常解释
- 不能让 AOI/EULUC 阻塞 P0 的 agent 编排主路径。

**验证命令:**
- `cd backend && npx vitest run tests/unit/sandbox/SQLSandbox.spec.ts tests/integration/routes/chat.spec.ts`

**完成标准:**
- AOI/EULUC 开始服务于 agent 的解释力，但不是当前阶段的刚性依赖。

---

### Task 10: 做一轮真正面向“agent 感”的验收

**Files:**
- Modify: `backend/tests/smoke/minimaxPhase8_3.smoke.spec.ts`
- Modify: `backend/tests/smoke/minimaxPhase8_3.corpus.ts`
- Modify: `backend/tests/integration/e2e/phase8_3_regression.spec.ts`
- Create: `backend/tests/fixtures/areaInsightGoldenCases.json`

**TODO:**
- 新增 golden cases，覆盖：
  - 片区泛型总结
  - 开店机会判断
  - 锚点型片区判断
  - 当前区域 map_view 分析
- 验收维度升级为：
  - 是否由 LLM 真实驱动了工具编排
  - 是否显式引用了真实证据
  - 是否区分高置信和弱证据
  - 是否摆脱“查询播报腔”
  - degraded 时是否老实降级
- 产出一份简短验收记录：
  - 通过题
  - 失败题
  - 失败时是“编排错了”还是“证据不够”

**验证命令:**
- `cd backend && npx vitest run tests/integration/e2e/phase8_3_regression.spec.ts`
- `cd backend && npm run test:smoke:phase8-3`

**完成标准:**
- 片区题的最终体验已经像 agent，而不是像一个会拼模板的查询器。

---

## Priority Order

### P0 本周必须做
- Task 1
- Task 2
- Task 3
- Task 4
- Task 5
- Task 6

### P1 下一轮增强
- Task 7
- Task 8

### P2 条件成熟后接入
- Task 9
- Task 10

---

## Acceptance Checklist

- [ ] `DeterministicRouter` 已降级为 hint / fallback 层，不再主导 area insight
- [ ] 强模型已真正接管 area insight 的 tool orchestration
- [ ] `GeoLoomAgent` 对复杂片区题默认优先走 LLM 编排，不再默认抢回 deterministic renderer
- [ ] PostGIS 已提供最小分析级原子动作，而不只是附近 POI 列表
- [ ] `area_overview` 的 evidence 已能表达结构、热点、异常、机会等分析信号
- [ ] encoder / 双塔只在真实可用时进入主链路，且只作为辅助证据
- [ ] area insight 的回答明显更像 GeoLoom agent，而不是模板查询器
- [ ] 至少 4 条片区题回归样本通过
