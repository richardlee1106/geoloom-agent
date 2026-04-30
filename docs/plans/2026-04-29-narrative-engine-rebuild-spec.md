---
title: Narrative 解说引擎重建规范（阶段 1：宪法）
status: locked
phase: 1 / 4
created: 2026-04-29
owner: GeoLoom Narrative Team
---

# Narrative 解说引擎重建规范

> **本规范是阶段 1 的产出，是后续所有 narrative 算法、UI、LLM 串讲、数据契约的强制依据。**
> 任何代码、UI、文案如果与本规范冲突，必须立即改正，不允许"先实现再回头修"。
> 任何对本规范的修改必须显式更新本文件，并在 PR 中说明动机。

---

## 0. 总纲

### 0.1 我们要做的是什么

GeoLoom narrative 是一个 **空间解说引擎**，不是地图介绍 demo，也不是 AOI 轮播。

核心定义：

> 在一个真实的地图 viewport 内，结合用户上下文与空间语义，自主判断"什么值得讲、什么只是背景、什么不应该讲"，并以有节奏、有随机性、有依据的方式串讲。

### 0.2 三条不可违反的底线

- **L1：本质上仍然是 POI 驱动**
  - 不允许凭空生成虚构地点
  - 不允许 LLM 决定主讲对象
  - 所有渲染对象必须可追溯到真实 POI / AOI / region entity

- **L2：viewport 是真实地图边界**
  - 后端拿到的 viewport 必须是浏览器当前整屏地图 bbox
  - safe zone 仅用于前端 UI 避让，不参与算法判断
  - 任何最终呈现节点必须在 viewport 内可见

- **L3：UI 不暴露算法痕迹**
  - 不显示英文字段、score、weight、role 内部值
  - 不出现"片区节点"这种泛化机器术语
  - 用户面只看到自然语言、地图、节奏、片区光晕

---

## 1. 叙事对象分级（Narrative Entity Taxonomy）

每个候选对象（POI / AOI / region）必须被打上一个 `narrative_role`。
该字段是后续所有渲染和讲解决策的基础。

### 1.1 角色定义

```text
primary_region        — 区域主体，可单独成为章节主角
support_region        — 区域支撑，可串讲，但通常不抢主线
landmark_anchor       — 地标锚点，可作为转场或核心节点
scene_evidence        — 场景证据，用于解释片区性质，可不讲
background_ecology    — 背景生态，仅用于渲染氛围，不进入主链
micro_facility        — 微设施，原则上不讲（除非用户明确问）
noise                 — 噪声，永远不讲、不渲染主层
```

### 1.2 典型映射（非穷举，仅约束方向）

- **primary_region**
  - 综合性大学、5A/4A 景区、大型公园、历史街区、商圈、产业园、大型医院主体、交通枢纽

- **support_region**
  - 中等公园、文化广场、博物馆、独立学院、专业学院、知名街区

- **landmark_anchor**
  - 黄鹤楼、知名地标、纪念性建筑、显著观景点

- **scene_evidence**
  - 餐饮、咖啡、书店、商店等具有"画像意义"的 POI 集群

- **background_ecology**
  - 普通门店、便利店、小型设施

- **micro_facility**
  - 停车场、ATM、公厕、门岗、收费亭

- **noise**
  - 宿舍楼、家属区、服务中心、楼栋号、分店附属点、内部 POI

### 1.3 分级硬规则

- **不允许**
  - 把宿舍 / 家属区 / 服务中心 / 楼栋 / 分店内部点判为 primary_region
  - 把宗教教育机构判为高校 primary_region
  - 把单点连锁分店冒充品牌 primary_region

- **必须**
  - primary_region 必须可解释为"代表一个真实区域"
  - support_region 必须有独立辨识度，不能只是 primary 内部组件
  - background_ecology 即使数量大也不进入主讲链

### 1.4 角色判定来源（优先级从高到低）

- **AOI / region 实体直接命中**（最强）
- **OSM fclass / category_main + name 词典**
- **品牌聚合规则**（count ≥ 2 或 name 等于品牌核心尾词）
- **embedding 语义相似度**
- **fallback 规则**（保守降级，宁可降级为 background）

---

## 2. POI 渲染分层（Visual Tier）

每个进入 viewport 的对象在渲染层有 5 档：

```text
core      — 不透明、最醒目、主色饱和
strong    — 较高不透明度，暖色系
medium    — 中等不透明度，黄/橙
weak      — 低不透明度，冷色系（蓝/灰蓝）
excluded  — 不渲染
```

### 2.1 渲染层与叙事层必须分离

- 渲染层决定"看得见"
- 叙事层决定"被讲到"

允许出现：

- 渲染为 strong，但本轮不讲
- 渲染为 weak，仅用于氛围
- 进入讲解链的节点必然渲染为 core 或 strong

不允许出现：

- 进入讲解链却渲染为 weak / excluded
- excluded 对象出现在镜头飞行路径上

### 2.2 分层判定输入

```text
narrative_role
scene_relevance
spatial_relevance（与当前 dominant_region 的关系）
viewport_position（核心区 / 边缘 / 外溢）
density_context（是否在密集生态中）
```

### 2.3 颜色语义约束

颜色不是装饰，而是语义：

- **暖色系**：与当前主线高相关
- **冷色系**：边缘 / 弱相关 / 背景
- **不允许**：用颜色暗示"分数高低"，颜色只表达"叙事角色和相关性"

---

## 3. 尺度策略（LOD Policy）

LOD 不等同于 zoom level，而是由以下变量综合判断：

```text
dominant_coverage   — 当前最大候选区域占 viewport 面积比例
candidate_count     — viewport 内可成为 primary 的候选数
poi_density         — 单位面积有效 POI 数
semantic_diversity  — 候选间语义类别多样性（高校/公园/商圈/历史…）
user_context        — 用户上一轮关注、当前主题
```

### 3.1 三档基本策略

#### LOD-Micro（深挖单核心）

触发条件：

- `dominant_coverage ≥ 0.5`
- `candidate_count ≤ 2`

行为：

- 主体作为唯一主线
- 大量调用 support_region / landmark_anchor 扩充章节
- 周边 background_ecology 用于解释片区生活
- 讲法侧重"内部结构 + 与城市的边界"

#### LOD-Meso（横向多片区）

触发条件：

- `0.2 ≤ dominant_coverage < 0.5`
- `2 < candidate_count ≤ 5`

行为：

- 多个 primary_region 并列
- 注重转场逻辑和片区之间关系
- 每个片区给少量代表点
- 讲法侧重"关系 / 对比 / 走廊"

#### LOD-Macro（合并城市片区）

触发条件：

- `dominant_coverage < 0.2`
- `candidate_count > 5` 或 `semantic_diversity` 高

行为：

- 内部允许将多个 primary_region 合并为城市功能区
- 不讲单点，讲"区域性质"
- 前端文案不可机械说"某某片区"，而是用自然描述
  - 允许："这一带以高校和湖泊为主"
  - 禁止："武昌北部教育文化生活片区节点"

### 3.2 重心切换硬规则

- 当 `dominant_coverage` 超过 60% 时，主线必须围绕该主体展开
- 当不到 20% 时，该主体只能作为候选之一，不能强行成为主线
- 用户上下文可以**调整权重**，但不能违反 coverage 硬规则

---

## 4. 片区候选生成（Region Candidate）

### 4.1 片区不是输入，而是中间产物

错误顺序：

```text
找 AOI → 介绍 AOI
```

正确顺序：

```text
理解 viewport → 评估可讲性 → 生成片区 → 渲染分层 → 路径采样 → LLM 串讲
```

### 4.2 片区构造方式

每个 primary_region 通过以下方式吸附形成 region：

```text
core            — 主锚点（primary_region 本身）
inner_support   — 强相关 support_region / landmark_anchor
outer_support   — 中等相关 scene_evidence 集群
background      — 弱相关 background_ecology
excluded        — 完全无关或与其他片区冲突的对象
```

### 4.3 片区合并与拆分

- LOD-Macro 下允许多个 primary_region 合并
  - 合并必须基于空间连续性 + 语义相近
  - 合并后必须给出新的口语化描述（不是"片区节点"）

- LOD-Micro 下允许 primary_region 内部拆分章节
  - 例如湖北大学拆为"主校区"、"沙湖侧"、"生活区"
  - 拆分必须有真实空间锚点支撑，不允许虚构子区域

### 4.4 视口契约

- 任何最终输出 region 的 boundary 都必须**与 viewport 有可见交集**
- boundary 在 viewport 内裁剪后面积过小（< 阈值）必须淘汰
- node.center 必须落在裁剪后 boundary 的视觉中心，不允许飞出 viewport

---

## 5. 场景画像（Scene Profile）

不同场景下，相同 POI 价值不同。系统必须先识别 scene profile，再决定权重。

### 5.1 场景枚举（初版）

```text
education_culture    — 高校文化教育
tourism_leisure      — 城市游览休闲
commercial_life      — 商业生活
urban_history        — 历史人文
ecology_waterfront   — 公园生态水岸
transport_access     — 交通枢纽可达性
mixed_exploration    — 混合探索（默认）
```

### 5.2 场景识别输入

- 用户 query
- 历史上下文（最近几轮关注点）
- viewport 内 primary_region 类型分布
- 时间 / 偏好（可选）

### 5.3 场景对权重的影响

每个 scene profile 提供一组权重：

```text
role_weight        — 不同 narrative_role 的相对优先级
category_weight    — 不同 POI 类别的相对优先级
transition_pref    — 转场偏好（如"由文化到自然"）
narration_tone     — 讲述风格倾向（科普/导览/人文）
```

权重是**软影响**，不能违反第 1、3、4 章的硬规则。

---

## 6. 叙事路径采样（Path Sampler）

### 6.1 随机性原则

- 同一个 viewport，第一次和第二次讲解**应该**不同
- 不同体现在：路径选择、侧重点、转场说法、讲述风格
- 不允许在以下维度上随机：
  - 是否选择真实 POI
  - 是否违反 viewport 契约
  - 是否违反 narrative_role 硬规则

### 6.2 路径生成步骤

- **生成多条候选路径**
  - core_first：先讲主体再扩散
  - scenic_route：风景优先
  - history_route：历史文化优先
  - contrast_route：对比型
  - context_route：跟随用户上下文

- **每条路径打分**
  - 与 scene profile 的契合度
  - 转场合理性
  - 覆盖多样性
  - 与上一轮路径的差异度（鼓励差异）

- **softmax 抽样**
  - 概率 ∝ exp(score / temperature)
  - temperature 越高，随机性越强
  - 允许配置但有上下界

### 6.3 路径硬约束

- 不允许连续讲两个同质点（如两个连锁咖啡店）
- 不允许出现"飞出 viewport 又飞回"的镜头跳动
- 不允许在 LOD-Macro 下讲单个 micro_facility
- 路径长度受 LOD 控制：
  - Micro：3–6 节
  - Meso：4–7 节
  - Macro：3–5 节（多为合并描述）

---

## 7. LLM 在系统中的位置

> **本系统使用两个相互隔离的 LLM Channel**：
> - **Narrator Channel（§7.1-§7.3）**：被动生成解说文本，不与用户对话
> - **Assistant Channel（§7.4-§7.7）**：响应用户的打断 / 追问 / 自由提问
>
> 两个 Channel 共享一套上下文（narrative state + 解说记忆），但**职责完全隔离**：
> Narrator 只输出 chapter 文本，Assistant 只回应用户问题。
> 两者绝不互相调用，绝不复用提示词，绝不共享输出通道。

### 7.1 Narrator Channel：LLM 不决定结构

- **不允许**
  - 让 LLM 选讲谁
  - 让 LLM 决定顺序
  - 让 LLM 决定 POI 在哪个片区
  - 让 LLM 自由发挥讲不存在的地点

- **允许**
  - LLM 把结构化骨架变为自然语言
  - LLM 加入轻微风格变化
  - LLM 生成转场句
  - LLM 生成口语化表达

### 7.2 Narrator 输入契约

每次串讲，LLM 收到的是结构化骨架：

```text
scene_profile
lod
path_nodes[]
  - role
  - reason_to_include
  - relation_to_previous
  - allowed_facts
  - forbidden_facts
narration_tone
random_seed
```

LLM 输出文本，但事实必须落在 `allowed_facts` 范围内。

### 7.3 Narrator 输出审查

后端必须在输出前做一轮事实校验：

- 不出现 viewport 外的地名
- 不出现 forbidden 词典命中（广告、营销、宿舍、营销中心等）
- 不出现机器术语（节点、片区节点、score、role 名称）

---

### 7.4 Assistant Channel：交互式助手定位

Assistant 是与用户**直接对话**的 LLM channel，作用是让用户在解说过程中
随时打断、追问、要求搜索、要求镜头跳转，而不打断 narrator 主流程。

**用一句话概括**：
> 普通 LLM 助手 + GeoLoom 系统的个性化融合 ——
> 它知道你正在 narrative 的哪一章，已经讲过什么、还没讲什么，
> 也能调用本系统的搜索、空间查询、镜头控制能力为你解答。

#### 7.4.1 角色边界（与 Narrator 隔离）

- **不允许**
  - Assistant 直接修改 `narrative.path / regions / chapters`
  - Assistant 触发新的 narrative 重算（这是后端 narrative endpoint 的职责）
  - Assistant 输出文本被混入 `narration.chapters` 当作解说
  - Narrator 调用 Assistant，或反向

- **允许**
  - Assistant **只读**当前 narrative state（path、当前章节、已播章节、剩余章节）
  - Assistant **只读**用户的解说历史与对话记忆
  - Assistant 通过定义好的工具（§7.5）发起搜索 / 空间查询 / UI 副作用动作
  - Assistant 触发轻量副作用：暂停解说、跳到指定章节、飞行到某 POI、高亮区域
    （这些副作用作为响应中的 `ui_actions` 字段返回，前端决定是否执行）

#### 7.4.2 Assistant 输入契约

每次用户发问，Assistant 收到：

```text
user_message              // 用户原始提问

narrative_state           // 当前解说状态（只读快照）
  - scene_profile
  - lod
  - active_chapter_index
  - chapters_played: [region_id, summary][]
  - chapters_pending: [region_id, display_name][]
  - viewport.bbox
  - playing: boolean

memory                    // 跨会话记忆（仅本次 narrative session）
  - past_questions: [{ q, a_summary, ts }]
  - user_interests: string[]   // 由前几轮提问推断的兴趣
  - skipped_chapters: region_id[]

available_tools           // 详见 §7.5
preferences               // tone / language / 详尽度等用户偏好
```

#### 7.4.3 Assistant 工具能力（Tools）

Assistant 通过 function calling 能调用的工具集（不是无限制访问）：

```text
search_web(query, profile?)
  - 复用现有 MultiSearchEngine + Tavily
  - 用于回答"附近有没有 X"、"这家店怎么样"

query_postgis(query_type, params)
  - query_type ∈ { nearby_poi | poi_detail | category_count | distance }
  - 不暴露 SQL，仅暴露受控参数
  - 复用主路由 QA agent 已有的 PostGIS 能力

inspect_narrative_node(region_id)
  - 读取当前 narrative 中某节点的 allowed_facts、boundary 摘要

map_action(action, params)
  - action ∈ { fly_to | highlight | pause | resume | jump_to_chapter }
  - 不直接执行，仅作为 ui_actions 返回，前端决定是否生效
```

**禁止**：
- Assistant 调用任意 SQL（必须走 query_postgis 受控参数）
- Assistant 修改数据库
- Assistant 持久化用户数据（除 memory 字段）

#### 7.4.4 Assistant 输出契约

```text
assistant_response {
  text                   // 给用户看的回答（已通过事实校验）
  citations: [           // 引用来源（如有搜索/空间查询）
    { kind: 'web' | 'postgis' | 'narrative', ref, snippet? }
  ]
  ui_actions: [          // 可选副作用，前端决定是否执行
    { action, params, reason }
  ]
  follow_up_suggestions  // 给用户的快捷追问按钮（最多 3 条）
}
```

#### 7.4.5 Assistant 输出审查

与 Narrator 一样，Assistant 输出前必须经过事实校验：

- 不出现 viewport 外的地名（除非用户明确询问外部）
- 不出现 forbidden 词典命中
- 引用的 web/postgis 结果必须真实存在
- ui_actions 中 `region_id / poi_id` 必须是 narrative state 中的合法 ID

---

## 8. 前后端数据契约（Contract v1）

### 8.1 后端输出（v1 草案）

```text
narrative_response {
  scene_profile
  lod
  viewport
  regions: [
    {
      id
      display_name           // 自然语言，不允许出现内部代号
      role                   // primary_region / support_region / ...
      core_anchor: { id, lon, lat }
      boundary: GeoJSON      // 已裁剪到 viewport
      glow_layers: { core, inner, outer }
      pois: [ { id, lon, lat, tier, role } ]
      narrative_facts: [...] // 允许 LLM 使用的事实
    }
  ]
  path: {
    nodes: [ { region_id, narration_role, transition_reason } ]
    seed
    alternatives_count
  }
  narration: {
    chapters: [ { region_id, text, web_source?, length_ms? } ]
    tone
  }
  debug?: { ... }            // 仅开发模式
}
```

### 8.2 前端可见字段白名单

前端 UI 仅允许使用以下字段渲染：

- `display_name`
- `boundary` / `glow_layers`
- `pois.lon/lat/tier`
- `path.nodes.region_id`
- `narration.chapters.text` / `web_source`

**禁止暴露给用户**：

- `role` 原始英文值
- 任何 `score` / `weight`
- `seed`
- `debug`

### 8.3 调试字段

`debug` 仅在开发模式可见，用于：

- 算法调参
- 路径多样性观察
- 角色判定追溯

### 8.4 Assistant 数据契约

Assistant 与前端的请求 / 响应格式（与 narrative endpoint 完全独立的接口）：

```text
POST /api/narrative/assistant

assistant_request {
  session_id            // 当前 narrative session 的 ID
  message               // 用户输入文本
  client_state {        // 前端把当前 UI 状态打包传过来
    active_chapter_index
    playing
    visible_region_ids  // 当前 viewport 实际渲染的 region
  }
}

assistant_response {
  text
  citations: [...]
  ui_actions: [...]     // 前端决定是否执行
  follow_up_suggestions: string[]
  memory_updates?: {    // 由后端决定是否回写到 session memory
    user_interests?: string[]
    skipped_chapters?: region_id[]
  }
}
```

**字段约束**：

- `session_id` 必须与之前 `/api/narrative` 调用返回的 session 一致
- `client_state.active_chapter_index` 用来对齐 LLM 看到的当前章节
- `ui_actions` 是建议而非命令；前端可以拒绝（如用户禁用了自动镜头跳转）
- `memory_updates` 由后端推断后返回，前端原样回传到下一次请求

---

## 9. 禁止事项清单（Forbidden List）

以下行为在任何阶段都被禁止：

- **算法**
  - 让 LLM 决定主讲对象或顺序
  - 把 viewport 内不可见的对象作为最终节点
  - 用 safe zone 替代真实 viewport
  - 单点连锁分店冒充品牌主体
  - 宗教 / 教育词典命中后仍判为高校 primary

- **UI**
  - 显示 score、weight、role 英文
  - 出现"片区节点"等机器术语
  - 镜头飞到 viewport 外又飞回
  - 在用户面板出现调试字段

- **数据**
  - 后端 viewport 与前端 viewport 不同步
  - 坐标系混用（GCJ02 / WGS84 必须按既有约定明确转换）
  - 输出包含 LLM 编造的不存在地名

- **流程**
  - 跳过阶段门禁直接合并
  - 修改本规范但不更新文档
  - 通过 hardcoded 特判绕过规范

---

## 10. 阶段门禁（Phase Gates）

### 10.1 阶段 1：规范（本文件）

完成标准：

- 用户认可本规范
- 文档 status = locked
- 所有后续 PR 必须显式引用本规范条款

### 10.2 阶段 2：Mock UI

完成标准：

- mock 数据驱动的 narrative 页面接近设计图
- 包含：点分层渲染、片区光晕、讲解序列、随机性提示
- 数据结构与 §8 契约一致
- 无任何真实算法依赖

### 10.3 阶段 3：算法替换

完成标准：

- 替换顺序固定：POI 分层 → 片区候选 → LOD → 路径采样 → LLM 串讲
- 每一步替换不破坏前端契约
- 单测覆盖每一层关键判定

### 10.4 阶段 4：打磨

完成标准：

- 镜头、节奏、颜色、随机性体验稳定
- 调试面板与用户面板分离
- 不再依赖单点 hack 修 bug

### 10.5 偏离处理

任何阶段如果出现以下情况，**立即停下并改正**：

- 违反第 0、9 章硬规则
- 修改契约但未更新本规范
- 用 hardcoded 特判绕过算法
- UI 暴露内部字段

改正方式优先级：

- 回滚违规改动
- 更新本规范并记录原因
- 不允许"下次再修"

---

## 11. 术语表（Glossary）

- **viewport**：浏览器当前整屏地图 bbox，真实 WGS84 坐标
- **safe zone**：前端 UI 避让矩形，不参与算法
- **primary_region**：可成为章节主角的区域主体
- **glow_layers**：核心 / 内圈 / 外圈三层片区视觉光晕
- **scene_profile**：当前 viewport 的主题画像
- **LOD**：综合 coverage / density / diversity 决定的尺度档位
- **softmax 抽样**：用概率分布选路径，而非取最大
- **allowed_facts**：LLM 可以使用的结构化事实清单
- **forbidden_facts**：LLM 不允许提及的内容（广告、营销、宿舍等）
- **Narrator Channel**：负责把结构化骨架变成解说文本的 LLM 通道（被动、不与用户对话）
- **Assistant Channel**：响应用户打断与追问的 LLM 通道（主动、与用户对话），可调用受控工具
- **chat session memory**：单次 narrative 会话内的对话历史 + 用户兴趣推断 + 已跳过章节
- **ui_actions**：Assistant 返回给前端的副作用建议（如 fly_to / pause），前端决定是否执行

---

## 12. 后续文档计划

- `narrative-ui-mock-spec.md`（阶段 2）
- `narrative-data-contract.md`（阶段 2 末尾锁定 v1）
- `narrative-implementation-roadmap.md`（阶段 3 起）
- `narrative-polish-checklist.md`（阶段 4）

---

**本规范一旦锁定，必须按此推进。任何偏离立即改正。**
