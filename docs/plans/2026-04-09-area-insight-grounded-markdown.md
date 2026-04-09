# Area Insight Grounded Markdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 V4 area insight 的最终回答稳定围绕真实区域主语展开，强制补齐 AOI/landuse 语义证据，并输出以特征为中心的 Markdown 回答范式，摆脱“当前区域 + 报数腔”的兜底体验。

**Architecture:** 继续保留 `LLM orchestration -> postgis evidence -> grounded answer` 的 V4 主链路，但把 `map_view` 片区主语提炼、AOI/landuse 必取规则、Markdown 回答范式和 grounded gate 一起收束到 agent/evidence/renderer 层。主语和回答结构来自真实证据，不把 renderer 重新做成硬模板写手。

**Tech Stack:** TypeScript, Fastify, Vitest, V4 GeoLoom Agent, PostGIS evidence views

---

### Task 1: 用 failing tests 锁定目标行为

**Files:**
- Modify: `backend/tests/unit/evidence/Renderer.spec.ts`
- Modify: `backend/tests/unit/evidence/EvidenceViewFactory.spec.ts`
- Modify: `backend/tests/integration/routes/chat.spec.ts`

**Steps:**
1. 写失败测试，覆盖 area insight 最终回答必须是 Markdown 小节结构，而不是单段播报。
2. 写失败测试，覆盖当前区域在 AOI 明显指向高校主体时，答案需要出现类似“湖北大学”这样的区域主语。
3. 写失败测试，覆盖总结题 / 机会题 / 语义题都会默认补齐 `area_aoi_context` 与 `area_landuse_context`。
4. 写失败测试，覆盖无解释力数字如“范围内 xx 个”“xx 个高密点位”不应默认出现在答案里。
5. 运行定向测试，确认先红。

**验证命令:**
- `cd backend && npx vitest run tests/unit/evidence/Renderer.spec.ts tests/unit/evidence/EvidenceViewFactory.spec.ts tests/integration/routes/chat.spec.ts`

---

### Task 2: 提炼 area insight 的区域主语

**Files:**
- Modify: `backend/src/evidence/views/AreaOverviewView.ts`
- Modify: `backend/src/chat/types.ts`
- Modify: `backend/src/agent/GeoLoomAgent.ts`

**Steps:**
1. 给 `area_overview` evidence 增加主语字段，承载“区域围绕谁/什么展开”的 grounded subject。
2. 基于 AOI、landuse、代表样本和学校/园区类名称，提炼优先主语，避免默认只落成“当前区域”。
3. 让 grounded gate 把主语字段纳入判断，避免“只说当前区域”的答案被误判为合格。
4. 运行相关单测。

**验证命令:**
- `cd backend && npx vitest run tests/unit/evidence/EvidenceViewFactory.spec.ts tests/integration/routes/chat.spec.ts`

---

### Task 3: 让 AOI / landuse 变成 area insight 的默认核心证据

**Files:**
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/src/llm/InMemoryLLMProvider.ts`
- Modify: `backend/src/agent/AlivePromptBuilder.ts`

**Steps:**
1. 把总结题、机会题、语义题统一收敛为默认需要 `area_aoi_context` 和 `area_landuse_context`。
2. 调整 fallback 补证据逻辑，不再只在 provider 不可用时才补语义上下文。
3. 调整 prompt contract，让真实 provider 也更明确知道这两类证据是 area insight 的默认核心证据。
4. 运行 agent / integration 测试。

**验证命令:**
- `cd backend && npx vitest run tests/unit/agent/GeoLoomAgent.spec.ts tests/integration/routes/chat.spec.ts`

---

### Task 4: 把最终回答升级为 Markdown 范式并去掉报数腔

**Files:**
- Modify: `backend/src/evidence/Renderer.ts`
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/tests/unit/evidence/Renderer.spec.ts`

**Steps:**
1. 将 area insight 的 deterministic answer 升级为 Markdown 小节范式，不再输出单段播报。
2. 让回答按“区域主语 / 关键特征 / 热点与结构 / 机会与风险”这类范式组织，但仍允许根据题型裁剪。
3. 去掉默认的 `范围内 xx 个`、`xx 个高密点位` 报数腔，只保留能解释集中、稀缺、过密的少量数字。
4. 调整 synthesis prompt，让 LLM 重写时也遵守 Markdown 范式，而不是回落到模板串句。
5. 运行 renderer 与 integration 测试。

**验证命令:**
- `cd backend && npx vitest run tests/unit/evidence/Renderer.spec.ts tests/integration/routes/chat.spec.ts`

---

### Task 5: 做一轮端到端验证

**Files:**
- Modify: `backend/tests/smoke/minimaxPhase8_3.corpus.ts`
- Modify: `backend/tests/smoke/minimaxPhase8_3.smoke.spec.ts`

**Steps:**
1. 补一条对 Markdown 回答范式和主语表达更敏感的 smoke expectation。
2. 跑后端单测、集成测试和至少一条 MiniMax smoke。
3. 记录通过项与剩余风险。

**验证命令:**
- `cd backend && npx vitest run tests/unit/agent/GeoLoomAgent.spec.ts tests/unit/evidence/Renderer.spec.ts tests/unit/evidence/EvidenceViewFactory.spec.ts tests/integration/routes/chat.spec.ts`
- `cd backend && $env:MINIMAX_SMOKE_TIMEOUT_MS='90000'; npx vitest run tests/smoke/minimaxPhase8_3.smoke.spec.ts -t "smoke_area_current_summary"`

---

## Acceptance Checklist

- [ ] 当前区域类回答能稳定出现 grounded 主语，而不是只说“当前区域”
- [ ] 总结题 / 开店题 / 语义题默认补齐 AOI 与 landuse 证据
- [ ] area insight 最终回答采用 Markdown 范式而不是单段播报
- [ ] 默认报数腔已明显下降，只保留少量有解释力数字
- [ ] grounded gate 不再放过“只提当前区域”的答案
