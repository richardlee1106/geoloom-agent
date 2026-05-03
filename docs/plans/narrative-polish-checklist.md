---
title: Narrative 阶段 4 打磨清单
status: active
phase: 4 / 4
created: 2026-05-02
owner: GeoLoom Narrative Team
---

# Narrative 阶段 4 打磨清单

本清单承接 `2026-04-29-narrative-engine-rebuild-spec.md` 的阶段 4。阶段 3 已完成空间结构算法替换；阶段 4 聚焦城市认知片区、叙事连贯性、自然讲解、异步事实补强与用户体验 polish。

## 1. 当前真实边界

- **DeepSeek Search**：不是默认强依赖；只在 `DEEPSEEK_SEARCH_BASE_URL`、`DEEPSEEK_SEARCH_API_KEY`、`DEEPSEEK_SEARCH_MODEL` 同时存在时接入。当前同步补充 `web_sources`，不决定候选、排序、LOD 或主讲链路；阶段 4.4 仍需升级为缓存 / 异步补强。
- **章节文案**：事实、片区和路径来自真实算法；启用 `NARRATIVE_LLM_NARRATION_ENABLED=true` 且 LLM 可用时，由 `llmNarrator.ts` 基于 GraphRAG 上下文生成自然解说。`factGrounding.ts` 模板保留为失败 fallback。
- **路径顺序**：`pathSampler.ts` 已支持代表性优先、空间邻近转场、同质节点惩罚和 `transition_reason`；阶段 4.2 已开始接入 deterministic 片区关系图谱。
- **抽象片区**：已从自由 token 抽取收敛为武汉大众认知 profile 白名单 + POI/AOI 真实证据门禁，江汉路步行街、水塔街、徐东商圈等城市认知片区进入回归覆盖。
- **UI 控件**：左侧透明度调节已删除；尺度滑杆已真实控制地图 zoom；重心策略当前影响地图聚焦，后续应升级为后端 ranking 参数。

## 2. 阶段 4.1：抽象片区发现与命名

目标：让系统稳定识别商圈、街区、步行街、道路走廊、生活片区等非标准 AOI。

第一轮 MVP（2026-05-02）：

- `regionCandidate.ts` 已在 AOI 候选与普通点云候选之间接入 `abstract_region` 候选。
- 抽象片区发现逻辑已拆分到 `backend/src/narrative/abstractRegionDiscovery.ts`。
- 已支持从 POI 名称中提取步行街、商业街、商圈、街区、道路走廊、商业综合体等抽象片区 token。
- 已补充江汉路步行街、徐东商圈、水塔街、同名 AOI 抑制四类单测。
- 已在 `goldenViewportAcceptance.spec.ts` 增加城市认知抽象片区 golden viewport。
- 已保留真实 AOI 优先级：同名 AOI 存在时，不重复生成抽象片区抢占主体。
- 已补充道路走廊边界估计：道路型抽象片区使用更收敛的 corridor boundary。
- 已补充行政边界 hint：街道 / 社区级 AOI 可作为边界线索，但不抑制更具体的抽象片区。
- 已补充 DeepSeek Search 来源质量评分：`web_sources` 增加 `quality` / `quality_score`，并优先展示官方、百科、权威媒体来源。
- 已补充 DeepSeek Search 候选地名 debug-only 探针：仅在 `debug: true` 时写入 `web_name_candidates`，不改变候选、排序、LOD 或主讲链路。
- 当前仍未让 DeepSeek Search 决定候选、排序、LOD 或主讲链路；后续如需结构接入，必须另设人工可解释门禁。
- 第二轮收口已完成：抽象片区命名改为武汉 profile 白名单，不再从任意 POI 名称自由拼接不存在或不大众的商圈名。

验收对象：

- 江汉路步行街
- 水塔街
- 徐东商圈
- 楚河汉街
- 武昌江滩
- 光谷步行街

候选来源：

- **AOI / 行政边界**：优先使用已有真实边界。
- **POI 密度**：用高密度商业、餐饮、休闲、文化 POI 聚类生成候选。
- **名称 token**：从 POI 名称、道路名、商场名中提取高频地名词。
- **道路走廊**：沿街型对象可用道路轴线 + 周边 POI buffer 估计。
- **DeepSeek Search / 地名词典**：只用于候选命名和事实补强，不能凭空创建不可追溯对象。

硬约束：

- 每个抽象片区必须能追溯到真实 POI / AOI / region evidence。
- 抽象片区不能覆盖整个 viewport，必须有可解释边界或边界估计。
- 抽象片区不得吞并更高优先级 AOI 主体，例如大学、公园、医院、交通枢纽。
- 命名置信度不足时降级为普通点云片区，不展示不可靠地名。

建议产物：

- 后端新增 `abstractRegionDiscovery.ts`。（已完成 MVP）
- 新增 `AbstractRegionCandidate` 内部类型。
- `buildRegionCandidates` 在 AOI 与点云之间插入抽象片区候选。
- golden viewport 增加江汉路 / 徐东 / 水塔街回归。（已完成 MVP）

## 3. 阶段 4.2：叙事关系图谱与路径打磨

目标：从“空间邻近”升级为“为什么从 A 讲到 B”。

关系类型：

- **空间邻近**：地理上相邻或路径自然。
- **主从关系**：核心片区与支撑片区。
- **功能互补**：商业、交通、文化、生态互补。
- **时间线关系**：历史到现代、老街到新商圈。
- **入口关系**：交通节点到消费 / 游览腹地。

验收标准：

- `transition_reason` 必须自然解释转场原因。
- 不能连续堆叠同类型片区造成单调。
- 同一 viewport 的路径应稳定，但允许在同等候选之间有轻微变化。

第一轮 MVP（2026-05-03）：

- 新增 deterministic `regionRelations.ts`，只使用片区名称、角色、来源、POI 品类、事实和空间距离判定关系。
- `pathSampler.ts` 在空间邻近基础上加入关系强度小权重，不让关系图谱破坏稳定邻近路径。
- `debug.path.relations` 输出转场关系类型、强度和证据，用户面仍只展示自然 `transition_reason`。

## 4. 阶段 4.3：Narrator LLM 自然讲解

目标：把模板文案升级为自然叙事，同时保持结构由算法决定。

输入白名单：

- `path.nodes`
- `regions[].display_name`
- `regions[].narrative_facts`
- `chapters[].web_sources`
- `scene_profile`
- `user_context`

输出约束：

- LLM 不允许新增主讲对象。
- LLM 不允许改变讲解顺序。
- 数字、年份、人名必须来自 allowed facts 或 web sources。
- 命中 forbidden dictionary 的文本必须回退到模板文案。

第一轮 MVP（2026-05-03）：

- 新增 `llmNarrator.ts`，把 path、relations、region facts、supporting places 和 web sources 组装为外部 geograph / GraphRAG 上下文。
- `NarrativePhase3Runtime` 在模板文案和 web sources 完成后调用 LLM narrator；LLM 只生成同顺序章节文本，不能修改 `region_id` 或路径结构。
- 输出校验失败、LLM 未配置或请求失败时自动回退到 `factGrounding.ts` 模板文案。
- `debug.llm_narrator` 输出 provider、是否使用、耗时和 fallback 原因。

实测收口（2026-05-03）：

- DeepSeek NewAPI 端点确认为 `https://api.deepsb.com/v1/chat/completions`，模型名为 `deepseek-v4-flash-search-nothinking`。
- 新增 narrative 专属 `NARRATIVE_LLM_BASE_URL`、`NARRATIVE_LLM_API_KEY`、`NARRATIVE_LLM_MODEL`，避免机器全局 `LLM_*` 聊天模型覆盖 narrator。
- `DEEPSEEK_SEARCH_TIMEOUT_MS` 调整为 `18000`，武汉样例 viewport 中 3 个区域共返回 9 条 `web_sources`。
- `NARRATIVE_LLM_NARRATION_TIMEOUT_MS` 调整为 `45000`，武汉样例 viewport 中 `debug.llm_narrator.used=true`，实际 provider 为 `deepseek-v4-flash-search-nothinking @ https://api.deepsb.com/v1`。
- `.env.example` 与 `.env.v4.example` 已保留空 key 占位，不提交真实 API key。

## 5. 阶段 4.4：DeepSeek Search 异步事实补强

目标：联网事实补强不阻塞首屏 narrative。

开发项：

- region query cache。
- 来源质量评分。
- 官方站点、百科、权威媒体优先。
- 论坛、营销、软文、低质聚合站降权或过滤。
- 搜索失败时保留模板文案和结构结果。

当前状态（2026-05-03）：

- 已完成第一轮异步化：`POST /api/narrative` 支持 `enrichment_mode=async`，首包只读缓存并返回 `enrichment.job_id`，不再同步等待 DeepSeek Search 和 narrator。
- 新增 `GET /api/narrative/enrichment/:jobId`，前端轮询后台 job；job 完成后用增强版 narrative response 回填章节、来源和 LLM 解说。
- 新增进程内 `NarrativeWebFactCache`，支持成功结果 TTL、失败短 TTL、防御性复制、debug cache status；后续如需跨进程 / 重启保留，可迁移到 Postgres。
- 前端 `NarrativeMode.vue` 已接入 async 首包和 enrichment 轮询，用户面显示“正在补充资料 / 已增强 / 资料补强失败”。
- DeepSeek 单次搜索在实测中约 11-16 秒，异步化后首包实测约 1.1 秒；后台完成后武汉样例 viewport 仍可回填 9 条 `web_sources`。
- `llmNarrator.ts` 已从 all-or-nothing 校验升级为按 `region_id` 对齐的部分采纳：可用章节采用 LLM 文案，异常章节单独 fallback 到模板。
- `debug.web_facts.items[].error` 已能暴露 timeout / upstream failure，`debug.llm_narrator.partial_fallback_count` 可观察按章 fallback 数。
- DeepSeek Search 已支持 primary/fallback endpoint：优先使用 `DEEPSEEK_SEARCH_PRIMARY_*`（当前本地配置为 `https://ciyuanshen.top/v1` + `deepseek-chat-search`），失败后回退到 `DEEPSEEK_SEARCH_*` / `NEWAPI_SEARCH_*`。

## 6. 阶段 4.5：调试面板与用户面板分离

目标：用户面保持干净，开发面可解释。

用户面禁止展示：

- role
- score
- weight
- seed
- debug

开发面展示：

- recall
- candidates
- lod
- path
- facts
- web_facts
- golden viewport 回放

当前状态（2026-05-03）：

- 已完成第一轮 UI 分离：用户面只保留主题、章节顺序、上下文、播放状态、引用来源等产品信息。
- 开发调试入口仅在 `import.meta.env.DEV` 且响应包含 `debug` 时展示，集中显示 recall、candidates、lod、path、facts、web_facts 与 golden viewport 回放参数。
- 新增复制调试快照和复制回放参数能力，便于复现 golden viewport；用户面不直接暴露 `debug`、`seed`、`score`、`weight` 等内部字段。

## 7. 阶段 4.6：UI 播放与交互 polish

已完成：

- 删除左侧透明度调节。
- 尺度滑杆真实控制地图 zoom。
- 重心策略按钮影响当前地图聚焦。
- 分析完成后的播放启动策略：自动解说开启时自动播放，关闭时停在第一章并展示完整文案，可手动开始。
- 来源引用 hover 与摘要展示：章节角标和来源列表均可展示来源类型、域名、标题与摘要。

待打磨：

- 片区光晕层级与地图底图融合。
- 时间线跳转手感。
- Assistant 打断、暂停、跳转、重规划。

## 8. 第一轮推荐开工顺序

1. **抽象片区发现与命名**：先解决城市认知片区缺失。（已完成第一轮）
2. **叙事关系图谱**：再解决讲解顺序与连贯性。（已完成第一轮）
3. **Narrator LLM**：结构稳定后再做自然文案。（已完成第一轮并完成 DeepSeek 实测）
4. **DeepSeek 异步缓存**：补来源质量与速度。（已完成第一轮：async job + cache + 前端轮询）
5. **DeepSeek 候选地名补强**：在不改变主链结构的前提下，作为低优先级命名候选进入人工可解释 debug。（已完成 debug-only MVP）
6. **Debug 面板与 UI polish**：Debug 分离和播放 / 引用第一轮已完成，下一步继续光晕融合、时间线手感和 Assistant 控制。
