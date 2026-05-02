---
title: Narrative 解说引擎重建规范（阶段 1：宪法候选稿）
status: reviewing
phase: 1 / 4
created: 2026-04-29
owner: GeoLoom Narrative Team
---

# Narrative 解说引擎重建规范

> **本规范是阶段 1 的产出，是后续所有 narrative 算法、UI、LLM 串讲、数据契约的强制依据候选稿。**
> 在 `status = reviewing` 期间，原则性底线立即生效；字段级契约、阈值和阶段门禁允许根据阶段 2 Mock UI 与阶段 3 算法实测修订。
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

### 3.3 量化公式

#### 3.3.1 dominant_coverage

```text
dominant_coverage = area(largest_candidate ∩ viewport) / area(viewport)
```

- 面积用 EPSG:3857 投影面积（平方米）
- 候选区域取 boundary 与 viewport 的交集，不是原始 boundary
- viewport 面积 = bbox 宽 × 高（投影后）

#### 3.3.2 poi_density

```text
poi_density = count(effective_pois) / area(viewport_km²)
```

- `effective_pois` = viewport 内 tier ∈ {core, strong, medium} 的 POI
- 单位：个/km²
- 阈值参考：> 200 为密集城区，50–200 为一般城区，< 50 为郊区/水域

#### 3.3.3 semantic_diversity

```text
semantic_diversity = Shannon_entropy(category_main 分布 over candidates)
  = -Σ (p_i × log2(p_i))

其中 p_i = count(candidates with category_main=i) / total_candidates
```

- 值域 [0, log2(N)]，N = 候选 category 种类数
- > 1.5 为高多样性（多种功能区并存），< 0.8 为低多样性（单一功能区主导）

#### 3.3.4 LOD 判定（分类器而非单一分数）

LOD 不能用一个“越高越 Micro”的综合分直接判定，因为 `candidate_count` 与 `semantic_diversity` 越高，往往越接近 Macro，而不是 Micro。

正确做法是先用硬规则切走确定场景，再比较三档候选分：

```text
硬规则 1：
  dominant_coverage ≥ 0.5 且 candidate_count ≤ 2
  → LOD-Micro

硬规则 2：
  dominant_coverage < 0.2 且 (candidate_count > 5 或 semantic_diversity > 1.5)
  → LOD-Macro

否则计算：
  micro_score =
    0.55 × coverage_norm
  + 0.25 × (1 - count_norm)
  + 0.20 × (1 - diversity_norm)

  meso_score =
    0.35 × mid_coverage_score
  + 0.35 × mid_count_score
  + 0.30 × diversity_norm

  macro_score =
    0.45 × (1 - coverage_norm)
  + 0.30 × count_norm
  + 0.25 × diversity_norm

coverage_norm      = clamp(dominant_coverage, 0, 1)
count_norm         = clamp(candidate_count / 8, 0, 1)
diversity_norm     = clamp(semantic_diversity / 2.0, 0, 1)
mid_coverage_score = 1 - abs(dominant_coverage - 0.35) / 0.35
mid_count_score    = 1 - abs(candidate_count - 4) / 4

最终 LOD = argmax(micro_score, meso_score, macro_score)
```

阶段 3 必须用 golden viewport 覆盖三类典型样例：

- 单一主体占据大半屏幕 → Micro
- 多个清晰主体并列 → Meso
- 大范围、多功能、高候选数量 → Macro

### 3.4 滞后机制（Hysteresis）

LOD 切换不能随 zoom 微调反复跳档。必须使用滞后区间：

```text
当前 LOD = Micro
  → 切到 Meso 的条件：分类器连续 2 帧输出 Meso，且 meso_score 比 micro_score 高 ≥ 0.08
  → 切到 Macro 的条件：分类器连续 2 帧输出 Macro，且 macro_score 比 micro_score 高 ≥ 0.12

当前 LOD = Meso
  → 切到 Micro 的条件：分类器连续 2 帧输出 Micro，且 micro_score 比 meso_score 高 ≥ 0.08
  → 切到 Macro 的条件：分类器连续 2 帧输出 Macro，且 macro_score 比 meso_score 高 ≥ 0.08

当前 LOD = Macro
  → 切到 Meso 的条件：分类器连续 2 帧输出 Meso，且 meso_score 比 macro_score 高 ≥ 0.08
  → 切到 Micro 的条件：分类器连续 2 帧输出 Micro，且 micro_score 比 macro_score 高 ≥ 0.12
```

"连续 2 帧" 指连续 2 次 viewport 变更计算（通常对应 zoom 变化 ≥ 0.5 级或平移 > 30% 视口宽度）。

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

### 4.5 候选评分公式

每个候选 region 的可讲性评分：

```text
region_score = w_c × coverage_score
             + w_d × density_score
             + w_v × diversity_score
             + w_a × anchor_score
             + w_s × scene_relevance_score

coverage_score  = area(region ∩ viewport) / area(viewport)
                 值域 [0, 1]，越大说明该 region 在 viewport 中越显眼

density_score   = count(effective_pois_in_region) / area(region_km²)
                 归一化：clamp(density / 150, 0, 1)
                 effective_pois = tier ∈ {core, strong, medium}

diversity_score = Shannon_entropy(category_main 分布 over region_pois)
                 归一化：clamp(entropy / 1.5, 0, 1)
                 防止"100 家奶茶店凑出一个 region"

anchor_score    = anchor_quality(anchor_poi)
                 = 1.0  如果 anchor ∈ {primary_region, landmark_anchor} 且有 AOI 实体命中
                 = 0.7  如果 anchor ∈ {primary_region} 且仅有 OSM fclass 命中
                 = 0.4  如果 anchor ∈ {support_region}
                 = 0.0  如果 anchor 不在白名单（直接淘汰，见 §4.6）

scene_relevance_score = cosine_similarity(region_feature_vector, scene_profile_vector)
                       值域 [0, 1]；由 spatial_encoder.encode_region_snapshot 提供

默认权重：
  w_c = 0.30  （coverage 是最直观的"值不值得讲"信号）
  w_d = 0.20  （密度反映信息量）
  w_v = 0.20  （多样性防止伪片区）
  w_a = 0.20  （anchor 质量是 L1 底线）
  w_s = 0.10  （场景相关性是软影响）
```

### 4.6 门槛与淘汰规则

AOI / region 主体与点云聚合片区必须使用不同门禁。大型真实区域不能因为内部 POI 少或品类单一被误杀；点云聚合则必须严格防止伪片区。

```text
共同硬门禁：
  1. anchor 不在白名单 role（§1.1 的 primary_region / support_region / landmark_anchor）
     → 淘汰。不允许"商业聚合"或"住宅集群"成为 anchor
  2. area(region ∩ viewport) / area(viewport) < 0.02
     → 淘汰。在 viewport 中不可见
  3. anchor 的 category_main 在黑名单中，且不满足 §4.7 例外
     → 淘汰

AOI / region 主体门禁：
  1. 必须有可解释 boundary，且裁剪后面积 ≥ 500 m²
  2. name / fclass / category 至少有一个能支撑 primary_region、support_region 或 landmark_anchor
  3. 不强制 effective_pois ≥ 3
  4. 不强制多品类 diversity，但若 diversity 很低，章节文案必须围绕主体自身，不得虚构生态

点云聚合门禁：
  1. region 内 effective_pois ≥ 3
  2. diversity_gate 必须通过（见 §4.7）
  3. 不允许纯餐饮、纯住宅、纯连锁门店聚合成 anchor

通过对应硬门禁后：
  region_score < 0.25 → 降级为 background_ecology，不进入主讲链
  region_score ≥ 0.25 → 正式候选
  region_score ≥ 0.60 → 核心候选（LOD-Micro 下必进主线）
```

### 4.7 多样性门禁与品类黑名单

**品类黑名单**（anchor 的 category_main 命中以下任意项则直接淘汰）：

```text
anchor_category_blacklist = [
  "餐饮美食",       # 单点餐饮不能当 anchor（但 scene_evidence 可以）
  "购物服务",       # 单点购物不能当 anchor
  "生活服务",       # 理发、洗衣等
  "医疗保健服务",   # 诊所、药店（大型医院主体除外，需 AOI 命中）
  "汽车服务",       # 加油站、洗车、维修
  "体育休闲服务",   # 健身房、KTV（大型体育场馆除外，需 AOI 命中）
  "住宿服务",       # 宾馆酒店
  "公司企业",       # 写字楼内部分公司
  "通行设施",       # 停车场出入口、收费站
  "室内设施",       # ATM、快递柜、公厕
]
```

**例外**：如果 POI 同时满足以下条件，可以豁免黑名单：
- 有 AOI 实体命中（即 PostGIS aoi 表中有对应面状实体）
- `brand_chain_count ≤ 1`（非连锁品牌分店）
- `business_area > 5000 m²`（面积足够大，代表真实区域）

**多样性门禁**（防止伪片区）：

```text
diversity_gate:
  region 内 POI 的 category_main 种类数 ≥ 2   → 通过
  region 内 POI 的 category_main 种类数 = 1   → 仅当该品类是
    "科教文化" / "风景名胜" / "政府机构" 时通过
  否则 → 淘汰
```

---

## 5. 场景画像（Scene Profile）

不同场景下，相同 POI 价值不同。系统必须先识别 scene profile，再决定权重。
### 5.1 场景枚举（初版）

```text
education_culture    — 高校文化教育
heritage_tourism     — 历史文旅
commercial_leisure   — 商业休闲
natural_ecology      — 自然生态
mixed_urban          — 混合城区
```

### 5.2 场景检测算法

场景由 viewport 内 POI 的 category_main 分布自动推断，不需要 LLM。

```text
步骤 1：统计 viewport 内 effective_pois 的 category_main 分布
  cat_dist = { category_main: count } over effective_pois

步骤 2：计算各场景的匹配度
  scene_score(s) = Σ_{c ∈ scene_keywords(s)} cat_dist[c] × keyword_weight(s, c)

  其中 scene_keywords 定义如下：
    education_culture:  { "科教文化": 1.0, "风景名胜": 0.3 }
    heritage_tourism:   { "风景名胜": 1.0, "科教文化": 0.2, "购物服务": 0.1 }
    commercial_leisure: { "购物服务": 1.0, "餐饮美食": 0.8, "体育休闲服务": 0.3 }
    natural_ecology:    { "风景名胜": 1.0, "政府机构": 0.1 }
    mixed_urban:        { 所有品类: 0.3 }  # 保底场景

步骤 3：归一化
  scene_score(s) = scene_score(s) / total_pois

步骤 4：选择
  top_scene = argmax(scene_score)
  如果 top_scene == mixed_urban 且 max(非 mixed 场景) > 0.15
    → 选择该非 mixed 场景（mixed_urban 只是保底）

步骤 5：混合场景
  如果 top-2 场景的 score 差 < 0.10
    → 标记为混合场景，权重按 score 比例分配
    → 例如 education_culture: 0.35, heritage_tourism: 0.30 → 混合权重 54%/46%
```

### 5.3 场景权重表

不同场景下，各 tier 的角色权重不同。以下权重用于 `region_score` 和 `node_score` 的场景相关性调整：

```text
                    education_culture  heritage_tourism  commercial_leisure  natural_ecology  mixed_urban
primary_region           1.00              1.00              0.90             1.00           0.85
support_region           0.60              0.70              0.80             0.50           0.70
landmark_anchor          0.90              1.00              0.70             0.80           0.75
scene_evidence           0.50              0.40              0.60             0.30           0.55
background_ecology       0.20              0.15              0.30             0.40           0.25
micro_facility           0.10              0.05              0.15             0.05           0.10
```

**品类权重**（同一 tier 内，品类也影响可讲性）：

```text
                    education_culture  heritage_tourism  commercial_leisure  natural_ecology  mixed_urban
科教文化                  1.00              0.30              0.10             0.15           0.40
风景名胜                  0.30              1.00              0.15             1.00           0.40
购物服务                  0.10              0.15              1.00             0.05           0.50
餐饮美食                  0.10              0.10              0.80             0.05           0.40
体育休闲服务              0.15              0.10              0.30             0.20           0.25
医疗保健服务              0.20              0.05              0.05             0.05           0.15
政府机构                  0.15              0.10              0.05             0.05           0.20
生活服务                  0.05              0.05              0.15             0.05           0.10
住宿服务                  0.05              0.20              0.30             0.10           0.15
公司企业                  0.05              0.05              0.20             0.05           0.10
```

**使用方式**：`scene_relevance_score = role_weight(role, scene) × category_weight(cat, scene)`，值域 [0, 1]。

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
  - 每种 route strategy 最多生成 3 条候选
  - 总候选路径数 ≤ 20
  - 使用 beam search，默认 beam_width = 4
  - 路径长度由 LOD 控制，不允许全排列暴涨

- **每条路径打分**
  - 与 scene profile 的契合度
  - 转场合理性
  - 覆盖多样性
  - 与上一轮路径的差异度（鼓励差异）

- **softmax 抽样**
  - 概率 ∝ exp(score × beta / temperature)
  - temperature 越高，随机性越强
  - beta 默认 4.0，用于放大 0–1 分数差异，避免抽样接近均匀
  - 允许配置但有上下界

### 6.3 路径硬约束

- 不允许连续讲两个同质点（如两个连锁咖啡店）
- 不允许出现"飞出 viewport 又飞回"的镜头跳动
- 不允许在 LOD-Macro 下讲单个 micro_facility
- 路径长度受 LOD 控制：
  - Micro：3–6 节
  - Meso：4–7 节
  - Macro：3–5 节（多为合并描述）

### 6.4 路径评分公式

```text
path_score = w_scene × scene_fit
           + w_trans × transition_smoothness
           + w_div  × coverage_diversity
           + w_diff × difference_from_last

scene_fit = Σ_{node ∈ path} scene_relevance_score(node)
            / len(path)
            # 路径中各节点与场景的契合度均值

transition_smoothness = Σ_{i=1}^{n-1} trans_score(node_i, node_{i+1})
                       / (n - 1)
  trans_score(a, b) =
    0.3 × (1 - normalized_spatial_distance(a, b))   # 空间距离越近越顺
    + 0.3 × category_complementarity(a, b)           # 品类互补加分
    + 0.2 × role_transition_score(a.role, b.role)    # 角色转场合理性
    + 0.2 × (1 - name_similarity(a, b))              # 名称越不同越多样

  category_complementarity(a, b):
    不同 category_main → 1.0
    同 category_main 不同 category_sub → 0.5
    完全相同 → 0.0

  role_transition_score:
    primary → landmark → 0.9
    primary → support → 0.7
    primary → scene_evidence → 0.6
    landmark → scene_evidence → 0.8
    同 role 连续 → 0.3
    background → primary → 0.2（跨度过大）

coverage_diversity = Shannon_entropy(category_main 分布 over path_nodes)
                    / log2(len(path))
                    # 归一化到 [0, 1]

difference_from_last = 1 - jaccard_similarity(path, last_path)
                      # 与上一轮路径的差异度

默认权重：
  w_scene = 0.30
  w_trans = 0.30
  w_div   = 0.20
  w_diff  = 0.20
```

### 6.5 Softmax 温度策略

```text
P(path_i) = exp(path_score_i × beta / T) / Σ exp(path_score_j × beta / T)

温度 T 的自适应规则：
  T = T_base × T_lod × T_repeat

  T_base = 1.0（默认）
  beta = 4.0（默认）

  T_lod 调整：
    LOD-Micro  → T_lod = 0.8  （信息密集，倾向高分路径）
    LOD-Meso   → T_lod = 1.0  （标准）
    LOD-Macro  → T_lod = 1.2  （信息稀疏，允许更多探索）

  T_repeat 调整：
    首次讲解   → T_repeat = 1.0
    第 2 次    → T_repeat = 1.3  （增大随机性，避免重复）
    第 3+ 次   → T_repeat = 1.5  （最大随机性）

  T 的硬边界：0.5 ≤ T ≤ 2.0
```

### 6.6 多样性约束

路径采样后必须通过以下约束检查，不通过则重新采样（最多 3 次，3 次都不通过则取最高分路径）：

```text
约束 1：品类多样性
  LOD-Micro：
    不强制 category_main 多样性
    但必须满足空间子区或角色差异，避免同一主体内重复讲同一种点
  LOD-Meso：
    path 内 category_main 种类数 ≥ min(3, ceil(len(path) / 2))
  LOD-Macro：
    path 内 region 语义类型种类数 ≥ 2，不讲 micro_facility

约束 2：角色多样性
  LOD-Micro：
    允许同一 primary_region 内部多章节，但章节锚点必须不同
  LOD-Meso / LOD-Macro：
    path 内至少包含 2 种不同 narrative_role
    且 primary_region / landmark_anchor 至少出现 1 次

约束 3：空间连续性
  相邻节点的空间距离 ≤ viewport 对角线 × 0.6
  （防止镜头跳跃）

约束 4：同质去重
  path 内不允许连续 2 个节点满足以下任一：
    - 同 category_main + 同 category_sub
    - 同 brand（连锁品牌）
    - name 编辑距离相似度 > 0.8
```

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

### 7.6 事实源结构（Fact Source Structure）

`allowed_facts` 中每条事实必须携带来源与置信度：

```text
allowed_fact {
  claim: string              // 事实陈述（如"武汉大学创建于 1893 年"）
  source: enum               // 来源类型
    = 'postgis'              // PostGIS 数据库直接查询结果（最高可信度）
    | 'web_verified'         // 联网搜索 + 实体对齐 dual_verified（高可信度）
    | 'web_snippet'          // 联网搜索 snippet（中等可信度，需交叉验证）
    | 'spatial_encoder'      // 空间编码器推断（如语义相似度、anchor 关联）
    | 'aoi_entity'           // AOI 面状实体属性（如学校面积、建成年份）
  confidence: float          // [0, 1] 置信度
  verified: boolean          // 是否经过交叉验证
  related_entity: {          // 关联实体
    type: 'poi' | 'aoi' | 'region'
    id: string
  }
}
```

**置信度默认值**：

```text
source              默认 confidence   需要 verified
postgis             0.95              否（数据库即事实）
aoi_entity          0.90              否
web_verified        0.80              是（dual_verified 已交叉验证）
web_snippet         0.50              是（必须与 postgis/aoi 交叉验证）
spatial_encoder     0.40              是（推断性结论，需至少 1 个其他源佐证）
```

**置信度阈值**：
- `confidence ≥ 0.70`：LLM 可直接引用
- `0.40 ≤ confidence < 0.70`：默认不进入主解说，只能进入来源卡片、调试信息或 Assistant 补充回答；若必须进入主解说，必须有产品显式批准并加模糊修饰
- `confidence < 0.40`：禁止引用，从 `allowed_facts` 中移除

### 7.7 五道过滤管线（5-Stage Fact Filter）

所有事实在进入 `allowed_facts` 之前，必须通过以下 5 道过滤：

```text
Stage 1：字典过滤（Dictionary Filter）
  输入：所有候选事实
  规则：命中 forbidden_dictionary 的 claim 直接丢弃
  forbidden_dictionary 包含：
    - 广告营销词：["营销中心", "售楼处", "优惠", "特价", "限时", "折扣"]
    - 住宅噪音词：["宿舍", "家属区", "小区", "住宅楼", "居民楼", "安置房"]
    - 低价值设施：["公厕", "ATM", "快递柜", "充电桩", "停车位", "垃圾站"]
    - 机器痕迹：["节点", "片区节点", "score", "role", "tier", "weight"]
  输出：通过 Stage 1 的事实

Stage 2：Anchor 聚合过滤（Anchor Aggregation Filter）
  输入：Stage 1 输出
  规则：同一 anchor 实体下，仅保留 confidence 最高的 N 条事实
    N = 3（LOD-Micro）/ 2（LOD-Meso）/ 1（LOD-Macro）
  目的：防止某个 anchor 的细节淹没其他 anchor
  输出：每个 anchor 最多 N 条事实

Stage 3：置信度过滤（Confidence Filter）
  输入：Stage 2 输出
  规则：confidence < 0.40 的直接丢弃
  输出：confidence ≥ 0.40 的事实

Stage 4：交叉验证过滤（Cross-Validation Filter）
  输入：Stage 3 输出
  规则：
    - source = 'web_snippet' 的事实必须至少有 1 个其他 source 佐证
      佐证条件：related_entity 相同 或 claim 语义相似度 > 0.7
    - source = 'spatial_encoder' 的事实必须至少有 1 个非 spatial_encoder 源佐证
    - 无佐证 → 降级 confidence × 0.5，若低于 0.40 则丢弃
  输出：经验证的事实

Stage 5：LLM 输出审查（Output Review Filter）
  输入：LLM 生成的最终文本
  V1 必做规则：
    - 不出现 viewport 外的地名（除非用户明确询问）
    - 不出现 forbidden_dictionary 命中
    - 不出现 allowed_facts 之外的数字、年份、人名（硬约束）
    - 输出中出现的地名必须能在 allowed_facts 或 response.regions/pois 中找到对应实体
  V2 增强规则：
    - 每个句子绑定 allowed_fact id 或 region_id
    - 不出现"据说"等模糊修饰用于 confidence ≥ 0.70 的事实
    - 不出现确定性表述用于 confidence < 0.70 的事实
  V3 增强规则：
    - 使用 embedding / NLI 审查句子与 allowed_facts 的语义一致性
  输出：最终可发布文本
```

### 7.8 Forbidden 词典（扩展版）

```text
forbidden_dictionary = {
  // 广告营销（任何 source 均禁止）
  ads: [
    "营销中心", "售楼处", "优惠", "特价", "限时", "折扣", "促销",
    "旗舰店", "加盟", "代理", "招商", "认购", "开盘"
  ],

  // 住宅噪音（anchor 级别禁止，scene_evidence 允许但不主讲）
  residential_noise: [
    "宿舍", "家属区", "小区", "住宅楼", "居民楼", "安置房",
    "物业管理", "业主", "居委会", "业委会"
  ],

  // 低价值设施（任何 role 均禁止主讲）
  low_value: [
    "公厕", "ATM", "快递柜", "充电桩", "停车位", "垃圾站",
    "配电房", "水泵房", "消防栓", "井盖", "路牌"
  ],

  // 机器痕迹（输出文本禁止出现）
  machine_trace: [
    "节点", "片区节点", "score", "role", "tier", "weight",
    "primary_region", "support_region", "landmark_anchor",
    "scene_evidence", "background_ecology", "micro_facility",
    "softmax", "entropy", "coverage"
  ],

  // 虚构地名（LLM 编造的常见模式）
  fabricated_pattern: [
    // 正则匹配：形容词 + 路/街/巷/道 且不在 postgis/aoi 中
    // 如"文化长廊"、"美食大道"等 LLM 常见编造
    // 实现方式：输出中出现的地名必须能在 allowed_facts 中找到对应实体
  ]
}
```

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
  - Assistant 直接触发新的 narrative 重算（重算必须交给 narrative orchestrator 决策）
  - Assistant 输出文本被混入 `narration.chapters` 当作解说
  - Narrator 调用 Assistant，或反向

- **允许**
  - Assistant **只读**当前 narrative state（path、当前章节、已播章节、剩余章节）
  - Assistant **只读**用户的解说历史与对话记忆
  - Assistant 通过定义好的工具（§7.5）发起搜索 / 空间查询 / UI 副作用动作
  - Assistant 触发轻量副作用：暂停解说、跳到指定章节、飞行到某 POI、高亮区域
    （这些副作用作为响应中的 `ui_actions` 字段返回，前端决定是否执行）
  - Assistant 返回 `request_replan` 建议，由 narrative orchestrator 判断是否重算或局部重排

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
  - action ∈ { fly_to | highlight | pause | resume | jump_to_chapter | request_replan }
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

### 8.1 坐标系约定

所有接口字段必须显式遵守以下坐标系约定：

```text
request.viewport.bbox       → WGS84，经纬度，来自浏览器当前整屏地图 bbox
backend internal geometry   → WGS84 / PostGIS SRID 4326
response.viewport           → WGS84，回显请求视口
response.boundary           → GCJ02，已裁剪到 viewport，供高德底图直接渲染
response.core_anchor        → GCJ02
response.pois               → GCJ02
ui_actions.fly_to           → GCJ02
debug.raw_boundary_wgs84    → 仅开发模式可选
```

禁止在同一个 public response 字段中混用 WGS84 与 GCJ02。

### 8.2 后端输出（v1 草案）

```text
narrative_response {
  session_id                 // 后端生成的 narrative session ID
  state_version              // 每次 narrative 重算或局部重排递增
  scene_profile
  lod
  viewport                   // WGS84 回显
  regions: [
    {
      id
      display_name           // 自然语言，不允许出现内部代号
      role                   // primary_region / support_region / ...
      core_anchor: { id, lon, lat } // GCJ02
      boundary: GeoJSON      // GCJ02，已裁剪到 viewport
      visual_layer: {
        mode: 'region_glow' | 'poi_heat'
        region_glow?: {
          core: GeoJSON      // GCJ02
          inner?: GeoJSON    // GCJ02
          outer?: GeoJSON    // GCJ02
          color: string
          opacity_profile: { core: number, inner: number, outer: number }
        }
        poi_heat?: {
          radius: number
          points: [ { lon, lat, tier } ] // GCJ02
        }
      }
      pois: [ { id, lon, lat, tier, role } ] // GCJ02
      narrative_facts: [     // 允许 LLM 使用的事实（结构化，见 §7.6）
        {
          claim: string
          source: 'postgis' | 'web_verified' | 'web_snippet' | 'spatial_encoder' | 'aoi_entity'
          confidence: float  // [0, 1]
          verified: boolean
          related_entity: { type: 'poi' | 'aoi' | 'region', id: string }
        }
      ]
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

### 8.3 前端可见字段白名单

前端 UI 仅允许使用以下字段渲染：

- `display_name`
- `boundary` / `visual_layer`
- `pois.lon/lat/tier`
- `path.nodes.region_id`
- `narration.chapters.text` / `web_source`

**禁止暴露给用户**：

- `role` 原始英文值
- 任何 `score` / `weight`
- `seed`
- `debug`

### 8.4 调试字段

`debug` 仅在开发模式可见，用于：

- 算法调参
- 路径多样性观察
- 角色判定追溯

### 8.5 Assistant 数据契约

Assistant 与前端的请求 / 响应格式（与 narrative endpoint 完全独立的接口）：

```text
POST /api/narrative/assistant

assistant_request {
  session_id            // 当前 narrative session 的 ID
  state_version         // 前端最后一次看到的 narrative state version
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
  memory_updates?: {    // 仅用于前端展示，不作为下一轮可信输入
    user_interests?: string[]
    skipped_chapters?: region_id[]
  }
}
```

**字段约束**：

- `session_id` 必须与之前 `/api/narrative` 调用返回的 session 一致
- `state_version` 必须与后端当前 session state 对齐；不一致时后端应返回 stale_state 错误或降级为只读回答
- `client_state.active_chapter_index` 用来对齐 LLM 看到的当前章节
- `ui_actions` 是建议而非命令；前端可以拒绝（如用户禁用了自动镜头跳转）
- session memory 由后端持有；前端不得作为可信 memory 来源

---

## 9. 禁止事项清单（Forbidden List）

以下行为在任何阶段都被禁止：

- **算法**
  - 让 LLM 决定主讲对象或顺序
  - 把 viewport 内不可见的对象作为最终节点
  - 用 safe zone 替代真实 viewport
  - 单点连锁分店冒充品牌主体
  - 宗教 / 教育词典命中后仍判为高校 primary
  - anchor 品类在黑名单中但仍进入主讲链（§4.7）
  - 同质连续节点未触发多样性约束（§6.6）
  - LOD 切换未使用滞后机制（§3.4）

- **UI**
  - 显示 score、weight、role 英文
  - 出现"片区节点"等机器术语
  - 镜头飞到 viewport 外又飞回
  - 在用户面板出现调试字段
  - 直接暴露旧版 `glow_layers` 内部字段；区域光簇必须走 §8.2 的 `visual_layer.region_glow`

- **数据**
  - 后端 viewport 与前端 viewport 不同步
  - 坐标系混用（GCJ02 / WGS84 必须按既有约定明确转换）
  - 输出包含 LLM 编造的不存在地名
  - `allowed_facts` 中出现 `confidence < 0.40` 的事实（§7.7 Stage 3）
  - `web_snippet` 事实未经交叉验证进入 `allowed_facts`（§7.7 Stage 4）
  - LLM 输出中出现 `allowed_facts` 之外的数字/年份/人名（§7.7 Stage 5）
  - `narrative_facts` 中出现 forbidden_dictionary 命中（§7.7 Stage 1）

- **流程**
  - 跳过阶段门禁直接合并
  - 修改本规范但不更新文档
  - 通过 hardcoded 特判绕过规范
  - 跳过五道过滤管线中任何一道（§7.7）
  - LLM 输出未经 Stage 5 审查直接发送给前端

---

## 10. 阶段门禁（Phase Gates）

### 10.1 阶段 1：规范（本文件）

完成标准：

- 用户认可本规范的原则性底线
- 文档 status = reviewing，允许阶段 2 / 阶段 3 根据实测修订字段级契约
- 所有后续 PR 必须显式引用本规范条款，并说明是否修改契约

### 10.2 阶段 2：Mock UI

完成标准：

- mock 数据驱动的 narrative 页面接近设计图
- 包含：点分层渲染、片区光晕、讲解序列、随机性提示
- mock response 与 §8 契约一致，并可被同一个前端 adapter 消费
- 页面不得出现 `role`、`score`、`weight`、`seed`、`debug`
- 明确 `visual_layer.region_glow` 与 `poi_heat` 的渲染边界
- 无任何真实算法依赖
- 阶段 2 结束后单独锁定 `narrative-data-contract.md`

### 10.3 阶段 3：算法替换

完成标准：

- 替换顺序采用两阶段估计：
  - 粗召回 → 角色初判 → 粗 scene_profile → 粗 region candidates → LOD 判定
  - 按 LOD 重算 region / tier / path → fact grounding → LLM narration
- 每一步替换不破坏 §8 前端契约
- 每个子阶段必须有 golden viewport、单测和失败回退策略

子阶段门禁：

```text
阶段 3.1：数据与坐标契约
  - request.viewport 为 WGS84
  - response.boundary / pois / core_anchor 为 GCJ02
  - session_id / state_version 可闭环

阶段 3.2：角色与 tier 判定
  - 宿舍 / 家属区 / 服务中心 / 楼栋不会进主链
  - 大型 AOI 可成为 primary_region
  - 单点连锁分店不会变成 primary_region

阶段 3.3：Region candidate
  - boundary 必须裁剪到 viewport
  - AOI 主体不因 POI 少或品类单一被误杀
  - 点云聚合必须通过 diversity_gate

阶段 3.4：LOD
  - Micro / Meso / Macro golden viewport 测试通过
  - 滞后机制测试通过

阶段 3.5：Path sampler
  - 同 seed 可复现
  - 不同 seed 有可观察差异
  - 不连续同质节点
  - 不飞出 viewport

阶段 3.6：Fact grounding + narration
  - LLM 不决定结构
  - 主解说只使用 confidence ≥ 0.70 的事实
  - 输出不含 forbidden_dictionary 命中
  - 数字 / 年份 / 人名必须来自 allowed_facts
```

### 10.4 阶段 4：打磨

完成标准：

- 镜头、节奏、颜色、随机性体验稳定
- 调试面板与用户面板分离
- 不再依赖单点 hack 修 bug
- Assistant 打断、暂停、跳转、`request_replan` 行为稳定
- 有性能预算：首屏 narrative、web 搜索、LLM narration 均有超时降级
- 覆盖高校、公园、商圈、历史街区、混合城区、稀疏郊区回归场景

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
- **visual_layer**：前端渲染语义层，包含 `region_glow` 与 `poi_heat`
- **region_glow**：区域光簇渲染层，用 core / inner / outer 表达主体、生态位与外围相关性
- **poi_heat**：点状热力补充层，仅用于缺少可解释区域边界的降级展示
- **scene_profile**：当前 viewport 的主题画像
- **LOD**：由 coverage / candidate_count / density / diversity 等信号分类得到的尺度档位
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

**本规范当前处于 reviewing 状态；原则性底线立即生效，字段级契约在阶段 2 末尾锁定。**
