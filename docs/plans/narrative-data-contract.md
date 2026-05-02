---
title: Narrative 数据契约 v1
status: locked
phase: 2 / 4
created: 2026-04-30
owner: GeoLoom Narrative Team
---

# Narrative 数据契约 v1

本文件锁定阶段 2 Mock UI 已验证的数据契约，作为阶段 3 后端算法替换的前端兼容边界。

阶段 3 可以替换数据来源和算法实现，但不得破坏本文定义的字段、坐标约定、渲染语义和 UI 隐藏规则。

## 1. 契约来源

- **规范来源**：`docs/plans/2026-04-29-narrative-engine-rebuild-spec.md` §8
- **前端类型**：`src/views/narrative/types.ts`
- **Mock 响应**：`src/views/narrative/mock/narrativeMockData.ts`
- **前端适配器**：`src/views/narrative/narrativeResponseAdapter.ts`
- **当前页面**：`src/views/NarrativeMode.vue`

## 2. 坐标约定

- **请求 viewport**：WGS84，经纬度 bbox
- **响应 region boundary / core_anchor / POI 点位**：GCJ02，经纬度
- **前端地图投影**：OpenLayers 内部转为 EPSG:3857
- **禁止**：后端混用未标注的 WGS84 / GCJ02 坐标

## 3. 顶层响应

```ts
interface NarrativeResponse {
  session_id: string
  state_version: number
  scene_profile: SceneProfile
  lod: LODLevel
  viewport: ViewportBBox
  dominant_coverage: number
  candidate_count: number
  poi_density: number
  semantic_diversity: number
  regions: NarrativeRegion[]
  path: {
    nodes: NarrativePathNode[]
    seed: string
    alternatives_count: number
  }
  narration: {
    chapters: NarrativeChapter[]
    tone: NarrationTone
  }
  user_context: UserContext
  debug?: Record<string, unknown>
}
```

### 3.1 必填闭环字段

- **session_id**：同一次 narrative 会话的稳定 ID
- **state_version**：后端 narrative state 版本号，每次重规划或状态更新递增
- **regions**：前端地图、章节、路径的共同实体来源
- **path.nodes**：章节播放顺序，不允许由前端自行排序
- **narration.chapters**：文本内容，必须通过 `region_id` 对齐 region

### 3.2 开发字段

`debug` 只允许开发模式使用，默认 UI 不展示。

## 4. Region 契约

```ts
interface NarrativeRegion {
  id: string
  display_name: string
  role: NarrativeRoleInternal
  core_anchor: { id: string; lon: number; lat: number }
  boundary: NarrativeBoundaryGeometry
  visual_layer: NarrativeVisualLayer
  pois: NarrativePoi[]
  narrative_facts: NarrativeFact[]
}
```

### 4.1 Region 约束

- **id**：必须稳定，可被 `path.nodes[].region_id` 和 `chapters[].region_id` 引用
- **display_name**：用户可见名称，禁止输出内部机器术语
- **role**：内部字段，前端类型可接收，但 UI 不直接展示
- **core_anchor**：镜头定位和标签锚点
- **boundary**：真实或可解释区域边界；阶段 3 不得把 `point_halo` 作为正式结果
- **pois**：区域内核心/支撑/背景 POI 样本
- **narrative_facts**：LLM 和 Assistant 可引用的事实白名单

## 5. Visual Layer 契约

```ts
interface NarrativeVisualLayer {
  mode: 'region_glow' | 'poi_heat'
  region_glow?: NarrativeRegionGlowLayer
  poi_heat?: NarrativePoiHeatLayer
}
```

### 5.1 当前阶段 2 渲染解释

当前 Mock UI 使用 `visual_layer.region_glow.color` 作为片区色相来源，但不直接绘制 polygon 椭圆环。

前端实际视觉为：

- **底层密度热力雾**：由 POI 点云生成，按 region 独立 HeatmapLayer 渲染
- **片区色相**：来自 `region.visual_layer.region_glow.color`
- **POI 散点层**：按 `poi.tier` 渲染普通散点
- **禁止**：前端用户面展示 `score`、`weight`、`role`、`seed`、`debug`

### 5.2 region_glow

```ts
interface NarrativeRegionGlowLayer {
  core: NarrativeBoundaryGeometry
  inner?: NarrativeBoundaryGeometry
  outer?: NarrativeBoundaryGeometry
  color: string
  opacity_profile: {
    core: number
    inner: number
    outer: number
  }
}
```

阶段 3 后端仍必须输出该结构，原因：

- `color` 是前端片区色相来源
- `core / inner / outer` 是区域语义边界来源
- 前端可选择 heatmap、soft field 或 polygon glow 的任一种表现方式，但字段契约不变

### 5.3 poi_heat

```ts
interface NarrativePoiHeatLayer {
  radius: number
  points: Array<{ lon: number; lat: number; tier: VisualTier }>
}
```

`poi_heat` 是降级或补充渲染层，不替代 region 主体边界。

## 6. POI 契约

```ts
interface NarrativePoi {
  id: string
  lon: number
  lat: number
  display_name: string
  tier: VisualTier
  role: NarrativeRoleInternal
  category_main?: string
}
```

### 6.1 VisualTier

```text
core      — 主讲或核心可见对象
strong    — 强相关支撑对象
medium    — 中相关生态对象
weak      — 背景氛围对象
excluded  — 不渲染
```

### 6.2 POI 约束

- **tier** 决定前端是否渲染和散点视觉强度
- **role** 是内部字段，前端不得直接显示
- **excluded** 不进入主图层
- **noise / micro_facility** 不得进入主讲链

## 7. Path 与章节契约

```ts
interface NarrativePathNode {
  region_id: string
  narration_role: PathNarrationRole
  transition_reason: string
}

interface NarrativeChapter {
  region_id: string
  text: string
  web_source?: { title: string; url: string }
  length_ms?: number
}
```

### 7.1 前端适配器派生字段

前端 adapter 会派生：

- `chapter_label`
- `display_name`
- `regionMap`
- `tierStats`
- `allRenderablePois`

这些字段不是后端响应字段，后端不得依赖前端派生字段。

### 7.2 path 约束

- `path.nodes[].region_id` 必须能在 `regions` 中找到
- `narration.chapters[].region_id` 必须能在 `regions` 中找到
- 同一次 response 中路径顺序由后端确定
- `path.seed` 可用于复现，但 UI 不展示

## 8. Fact 契约

```ts
interface NarrativeFact {
  claim: string
  source: 'postgis' | 'web_verified' | 'web_snippet' | 'spatial_encoder' | 'aoi_entity'
  confidence: number
  verified: boolean
  related_entity: { type: 'poi' | 'aoi' | 'region'; id: string }
}
```

阶段 3.6 之前，允许 skeleton 文案只使用确定性模板。

阶段 3.6 开始，主解说必须只使用符合规范过滤后的事实：

- 主解说默认 `confidence >= 0.70`
- 数字 / 年份 / 人名必须来自 allowed facts
- forbidden dictionary 命中内容不得进入前端

## 9. Assistant 契约

```ts
interface NarrativeAssistantRequest {
  session_id: string
  state_version: number
  message: string
  client_state: {
    active_chapter_index: number
    playing: boolean
    visible_region_ids: string[]
  }
}

interface NarrativeAssistantResponse {
  text: string
  citations: Array<{ kind: 'web' | 'postgis' | 'narrative'; ref: string; snippet?: string }>
  ui_actions: NarrativeAssistantUiAction[]
  follow_up_suggestions: string[]
  memory_updates?: {
    user_interests?: string[]
    skipped_chapters?: string[]
  }
}
```

Assistant 与 narrative endpoint 独立。`ui_actions` 是建议，不是命令，前端可拒绝执行。

## 10. UI 隐藏规则

用户面不得显示以下字段或概念：

- `role`
- `score`
- `weight`
- `seed`
- `debug`
- 英文内部枚举名
- “片区节点”等机器术语

允许显示：

- `display_name`
- adapter 派生的中文 `chapter_label`
- 自然语言章节文本
- 用户可理解的事实来源标题

## 11. 阶段 3 最小兼容目标

阶段 3.1 的后端最小目标不是完整 LLM 解说，而是输出一个可被当前 adapter 消费的真实数据 skeleton：

```text
真实 viewport request
→ 后端生成 session_id / state_version
→ 输出 GCJ02 regions / pois / visual_layer / path / deterministic chapters
→ 前端不改 adapter 即可渲染
```

验收标准：

- `npm run typecheck:frontend` 通过
- 后端类型检查通过
- 当前 `NarrativeMode.vue` 只替换数据来源，不重写展示逻辑
- response 不暴露 UI 禁止字段
- 坐标系符合第 2 节

## 12. 变更规则

任何后续阶段若需要修改本契约，必须同时：

- 更新本文件
- 更新 `src/views/narrative/types.ts`
- 更新 mock response
- 更新 adapter 或说明为什么不需要
- 在 PR / 变更记录中说明契约变更原因
