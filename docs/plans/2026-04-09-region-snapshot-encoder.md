# Region Snapshot Encoder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `cell-level` 片区特征编码真正接入 V4 `area_overview` 主链，让编码器消费结构化区域快照而不是一句标签文本。

**Architecture:** 在 `spatial_encoder` 新增 `encode_region_snapshot` action，输入为 area insight 已验证的结构化快照。`GeoLoomAgent` 在收齐 `area_overview` 核心证据后自动调用该 action，把返回的片区特征标签、摘要和语义证据写回 `EvidenceView`，再让 renderer / synthesis 基于这些特征组织最终回答。

**Tech Stack:** TypeScript, Vitest, Fastify agent loop, PostGIS evidence pipeline, local/remote Python bridge fallback.

---

### Task 1: 定义区域快照与特征标签契约

**Files:**
- Create: `backend/src/evidence/areaInsight/regionSnapshot.ts`
- Modify: `backend/src/chat/types.ts`
- Modify: `backend/src/integration/pythonBridge.ts`

**Step 1: 写失败测试**

- 为 `pythonBridge` 和 `spatial_encoder` 增加针对 `encode_region_snapshot` 的测试，先断言接口尚未支持。

**Step 2: 定义类型**

- 增加 `RegionSnapshotInput`
- 增加 `RegionFeatureTag`
- 给 `EvidenceView` 增加 `regionFeatures` / `regionFeatureSummary`

**Step 3: 定义桥接契约**

- `PythonBridge` 增加 `encodeRegionSnapshot(snapshot)`
- 远程桥接允许独立 region endpoint
- 本地桥接提供结构化 fallback

**Step 4: 跑测试确认失败点转移**

- Run: `cd backend && npx vitest run tests/unit/integration/pythonBridge.spec.ts tests/unit/skills/spatial_encoder/SpatialEncoderSkill.spec.ts`

### Task 2: 实现结构化区域特征抽取

**Files:**
- Create: `backend/src/evidence/areaInsight/regionSnapshot.ts`
- Modify: `backend/src/integration/pythonBridge.ts`

**Step 1: 写失败测试**

- 断言本地 snapshot fallback 不再只返回原始 label 命中，而会输出校园/混合/热点/竞争等特征标签。

**Step 2: 实现最小特征抽取**

- 从 dominant categories / ring / hotspot / AOI / landuse / competition 推导 feature tags
- 生成稳定 summary
- 生成可用于向量化的 feature tokens

**Step 3: 跑测试验证通过**

- Run: `cd backend && npx vitest run tests/unit/integration/pythonBridge.spec.ts`

### Task 3: 接入 spatial_encoder skill

**Files:**
- Modify: `backend/src/skills/spatial_encoder/SpatialEncoderSkill.ts`
- Modify: `backend/src/skills/spatial_encoder/actions/encodeRegion.ts`
- Create: `backend/src/skills/spatial_encoder/actions/encodeRegionSnapshot.ts`
- Modify: `backend/tests/unit/skills/spatial_encoder/SpatialEncoderSkill.spec.ts`

**Step 1: 写失败测试**

- 断言 skill 支持 `encode_region_snapshot`
- 断言返回 `feature_tags` 和 `summary`

**Step 2: 实现 action**

- 保存 snapshot 向量引用
- 透传语义证据状态
- 返回结构化特征标签与摘要

**Step 3: 跑测试验证通过**

- Run: `cd backend && npx vitest run tests/unit/skills/spatial_encoder/SpatialEncoderSkill.spec.ts`

### Task 4: 接入 GeoLoomAgent area_overview 主链

**Files:**
- Modify: `backend/src/agent/GeoLoomAgent.ts`
- Modify: `backend/src/evidence/Renderer.ts`
- Modify: `backend/tests/integration/routes/chat.spec.ts`

**Step 1: 写失败测试**

- 断言 `area_overview` 会自动触发 `spatial_encoder.encode_region_snapshot`
- 断言 `evidence_view` 带上 `regionFeatures`
- 断言回答会围绕片区特征，而不是退回纯计数摘要

**Step 2: 实现最小接入**

- 在 `area_overview` evidence view 生成后补调 snapshot encoder
- 把结果写回 `EvidenceView`
- renderer / synthesis 吸收 region features

**Step 3: 跑测试验证通过**

- Run: `cd backend && npx vitest run tests/integration/routes/chat.spec.ts tests/unit/evidence/Renderer.spec.ts`

### Task 5: 全链路验证

**Files:**
- Modify: `backend/tests/smoke/minimaxPhase8_3.smoke.spec.ts`（如需要）

**Step 1: 跑回归**

- Run: `cd backend && npx vitest run tests/unit/chat/DeterministicRouter.spec.ts tests/unit/agent/GeoLoomAgent.spec.ts tests/unit/evidence/Renderer.spec.ts tests/unit/evidence/EvidenceViewFactory.spec.ts tests/unit/llm/FunctionCallingLoop.spec.ts tests/unit/skills/spatial_encoder/SpatialEncoderSkill.spec.ts tests/unit/skills/spatial_vector/SpatialVectorSkill.spec.ts tests/unit/integration/pythonBridge.spec.ts tests/unit/integration/faissIndex.spec.ts tests/integration/routes/chat.spec.ts`

**Step 2: 跑 smoke**

- Run: `cd backend && $env:MINIMAX_SMOKE_TIMEOUT_MS='90000'; npx vitest run tests/smoke/minimaxPhase8_3.smoke.spec.ts -t "smoke_area_current_summary"`

**Step 3: 记录残余限制**

- 明确 remote cell model endpoint 是否真实可用
- 明确本地 fallback 仍然是启发式特征抽取，不等于训练好的区域模型
