本页聚焦 GeoLoom Agent 的**外部联网能力**：系统如何将第三方搜索与内容提取服务接入到后端 Skill 体系中，以及这些集成在注册、调用、降级与结果整合上的可验证实现。基于代码可见事实，当前仓库的主外部搜索链路已经围绕 **Tavily Search / Tavily Extract** 构建，另保留 **DuckDuckGo HTML 抓取型兼容回退链路**；同时仓库目录中存在 `searxng/settings.yml` 配置目录，但本次可验证代码中**未发现后端对 SearXNG 的实际调用实现**，因此本页将明确区分“已实现的第三方 API 集成”与“仅有目录存在但未见运行时接线的 SearXNG 资产”。Sources: [server.ts](backend/src/server.ts#L1-L173), [SearchRouter.ts](backend/src/skills/search_router/SearchRouter.ts#L1-L103), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L1-L186), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L1-L214), [get_dir_structure](searxng)

## 先从第一性原理看：外部集成在本系统中的角色

从架构上看，GeoLoom Agent 并没有把外部 API 直接散落在路由层或业务控制器中，而是将它们封装成 **SkillDefinition**，统一纳入 `SkillRegistry` 管理，再通过 `/api/geo/skills/:name/call` 路由暴露调用入口。这意味着外部集成被当作“可枚举、可描述、可执行”的能力单元：它们必须声明 `name`、`description`、`actions`、`capabilities`，并通过 `execute()` 返回统一的 `SkillExecutionResult`。这类封装使第三方依赖在接口层面与本地技能保持一致，是系统外部能力治理的核心模式。Sources: [types.ts](backend/src/skills/types.ts#L18-L64), [SkillRegistry.ts](backend/src/skills/SkillRegistry.ts#L4-L35), [skills.ts](backend/src/routes/skills.ts#L9-L61)

进一步看启动过程，后端在 `server.ts` 中先执行 `loadRuntimeEnv()` 装载环境变量，然后按条件注册多个技能。其中与外部搜索直接相关的有两个：`multi_search_engine` 始终注册，而 `tavily_search` 与 `web_poi_discovery` 仅在 `process.env.TAVILY_API_KEY` 存在时注册。这表明系统把**是否具备 API Key**作为外部服务可用性的硬门槛，并在注册阶段就完成能力裁剪，而不是等到请求时才懒判定。Sources: [loadRuntimeEnv.ts](backend/src/config/loadRuntimeEnv.ts#L36-L72), [server.ts](backend/src/server.ts#L145-L173)

## 外部集成全景：已接线能力与未验证能力

从目录与服务注册代码交叉验证，当前与本页主题直接相关的外部集成可分为三类：**Tavily 搜索类能力**、**DuckDuckGo 兼容搜索能力**、**Web POI Discovery 复合链路**。其中前两者属于基础搜索供给，第三类属于在 Tavily 之上的高阶业务编排。相对地，仓库中虽然存在 `searxng/settings.yml` 目录项，但当前已检查的后端注册逻辑、搜索路由器与技能目录中，没有发现 SearXNG Skill、SearXNG Client 或其环境变量接线，因此只能将其记录为“仓库含配置目录，但运行时接入未在本次证据中出现”。Sources: [server.ts](backend/src/server.ts#L145-L173), [SearchRouter.ts](backend/src/skills/search_router/SearchRouter.ts#L1-L103), [get_dir_structure](backend/src/skills), [get_dir_structure](searxng)

| 集成对象 | 实现形态 | 注册条件 | 在系统中的定位 | 证据结论 |
|---|---|---:|---|---|
| Tavily Search API | 独立 Skill | 需要 `TAVILY_API_KEY` | 主搜索链路 | 已实现并接线 |
| Tavily Extract API | `WebPoiDiscoverySkill` 内部客户端 | 需要 `TAVILY_API_KEY` | 网页正文/片段提取 | 已实现并接线 |
| DuckDuckGo HTML | 独立 Skill | 无额外密钥 | Tavily 不可用时兼容回退 | 已实现并接线 |
| SearXNG | 目录 `searxng/settings.yml` | 未见代码接线 | 目录资产存在 | 未验证到运行时接入 |
| crawl4ai | 客户端文件仍存在 | 当前主链路已移除 | 历史依赖/遗留兼容 | 文件存在，但新链路不使用 |

Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L34-L186), [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L14-L157), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L10-L214), [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L1-L11), [crawl4aiClient.ts](backend/src/skills/web_poi_discovery/crawl4aiClient.ts#L1-L147), [get_dir_structure](searxng)

## 架构关系图：第三方搜索如何嵌入 Skill 体系

下面这张图用于说明**外部服务并不是直接被前端调用**，而是先进入后端 Skill 运行时，再由技能输出统一结果。阅读图前需要先把握一个前提：本系统的“外部集成”不是单一 HTTP client，而是“环境变量 → Skill 注册 → 路由调用 → 外部 API → 统一结果”的完整闭环。Sources: [server.ts](backend/src/server.ts#L1-L173), [skills.ts](backend/src/routes/skills.ts#L9-L61), [SkillRegistry.ts](backend/src/skills/SkillRegistry.ts#L4-L35)

```mermaid
flowchart TD
    A[loadRuntimeEnv] --> B[server.ts]
    B --> C[SkillRegistry]
    B --> D{TAVILY_API_KEY?}
    D -->|yes| E[tavily_search Skill]
    D -->|yes| F[web_poi_discovery Skill]
    B --> G[multi_search_engine Skill]
    C --> H[/api/geo/skills/:name/call]
    H --> E
    H --> F
    H --> G
    E --> I[Tavily Search API]
    F --> I
    F --> J[Tavily Extract API]
    G --> K[DuckDuckGo HTML endpoint]
```

Sources: [loadRuntimeEnv.ts](backend/src/config/loadRuntimeEnv.ts#L36-L72), [server.ts](backend/src/server.ts#L145-L173), [skills.ts](backend/src/routes/skills.ts#L15-L60), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L78-L185), [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L46-L156), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L84-L214)

## Tavily Search：默认主搜索引擎的实现模式

`createTavilySearchSkill()` 将 Tavily 封装成名为 `tavily_search` 的 Skill，只暴露一个动作 `search_web`。输入参数支持单个 `query`，也支持 `queries` 数组；当两者同时存在时，代码会去重合并，并截断到最多 3 个查询。请求发往固定地址 `https://api.tavily.com/search`，POST body 中包含 `api_key`、`query`、`search_depth`、`max_results` 与 `include_answer: true`。返回值统一整理成 `{ answer, results }`，其中 `answer` 来自 Tavily 的摘要能力，`results` 是合并去重后的搜索结果集合。Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L35-L65), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L78-L106), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L130-L182)

这个 Skill 的一个关键设计是**查询级缓存**。实现上使用内存 `Map<string, CacheEntry>`，缓存键由 `query + search_depth` 的 MD5 构成，TTL 为 10 分钟，最大 100 项；超过上限时会删除最早 20% 的键。缓存命中后，`execute()` 直接返回 `meta.fromCache: true` 的结果，避免重复外呼。这说明当前第三方搜索优化主要依赖**进程内短期缓存**，而不是集中式缓存或跨实例共享缓存。Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L9-L32), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L148-L154), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L178-L182)

在可靠性处理上，`fetchTavily()` 使用 `AbortController` 和定时器控制超时，默认超时取 `options.timeoutMs || 15000`。如果 HTTP 响应非 2xx，函数返回空结果；如果请求异常，也同样返回空结果而非抛出错误。只有在 API Key 缺失时，Skill 层才返回 `ok: false` 和明确的 `no_api_key` 错误。这种设计意味着网络故障与上游异常更像“空结果”而不是“调用失败”，从而把可用性判断与语义判断分离。Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L39-L69), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L78-L80), [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L141-L143)

## Tavily Search 的状态表达与可观测接口

Tavily Skill 还实现了 `getStatus()`，返回名为 `tavily` 的依赖状态对象。其字段包括 `ready`、`mode: 'remote'`、`degraded` 和 `reason`；当 `apiKey` 缺失时，`ready` 为 `false`、`degraded` 为 `true`、`reason` 为 `missing_api_key`。这与系统统一的 `DependencyStatus` 结构兼容，表明第三方 API 在系统中不仅是“可调用的函数”，也是“可声明状态的依赖”。Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L114-L124), [dependencyStatus.ts](backend/src/integration/dependencyStatus.ts#L1-L30), [types.ts](backend/src/skills/types.ts#L53-L64)

## Multi Search Engine：DuckDuckGo 兼容回退路径

`createMultiSearchEngineSkill()` 提供 `multi_search_engine` 技能，暴露动作 `search_multi`。从文件头部注释到类内逻辑都表明，这不是主搜索引擎，而是“**兼容搜索引擎**”与“**显式降级/兼容路径**”。当前实际实现仅接入 DuckDuckGo HTML 端点 `https://html.duckduckgo.com/html/`，通过 POST 表单提交 `q=` 参数，携带简化 User-Agent，再用正则从 HTML 中提取标题、摘要和链接。Sources: [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L1-L13), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L52-L82), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L84-L107)

这条回退链路有两个鲜明特征。第一，它实现了**请求限速**：全局变量 `lastDdgRequestTs` 与 `waitForDdgRateLimit()` 保证连续请求之间至少间隔 2000ms。第二，它同样实现了**10 分钟 TTL 的进程内缓存**，但缓存上限提高到 200 条。由此可以看出，兼容引擎因为稳定性和抓取式访问特征更敏感，所以代码层面对节流与缓冲更保守。Sources: [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L11-L20), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L22-L49), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L180-L185)

输出结构上，`search_multi` 返回的是 `merged` 结果数组与 `summary` 字段；其中结果对象包含 `title`、`snippet`、`url`、`engine`。与 Tavily 相比，它没有 AI answer 摘要，也没有结构化抽取能力，因此更适合作为“能搜到东西”的保底路径，而不是后续正文抽取与实体对齐的高质量上游。Sources: [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L121-L150), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L188-L200)

## SearchRouter：主链路与回退链路的策略表达

`SearchRouter` 明确编码了搜索源优先级：**Tavily 主搜索 → Multi Search 兜底**。当启用 Tavily 且存在 `tavilyApiKey` 时，`route()` 会优先返回 `{ source: 'tavily', priority: 1 }`；若启用兼容搜索，则再附加 `{ source: 'multi_search', priority: 2 }`。代码注释给出的理由也非常直接：Tavily 结果更稳定，便于后续 crawl/NER/alignment 串联，而 Multi Search 仅作为 Tavily 不可用时回退。Sources: [SearchRouter.ts](backend/src/skills/search_router/SearchRouter.ts#L1-L7), [SearchRouter.ts](backend/src/skills/search_router/SearchRouter.ts#L34-L63)

需要注意的是，`SearchRouter` 文件本身只表达**路由策略**，并不直接发起第三方请求。它提供了 `getPrimarySource()`、`shouldUseTavily()`、`shouldUseMultiSearch()` 以及 `getFallbackSources()`，因此更接近“外部集成的调度规则对象”，而不是 HTTP 客户端。这种拆分有利于把**搜索策略**和**搜索实现**分离。Sources: [SearchRouter.ts](backend/src/skills/search_router/SearchRouter.ts#L65-L101)

## Web POI Discovery：第三方 API 复合编排的代表实现

如果说 `tavily_search` 只是把外部搜索封装成一个可调用技能，那么 `WebPoiDiscoverySkill` 展现的是更高阶的**第三方 API 编排模式**。文件头部注释直接给出链路：`SceneProfile -> DB shortlist -> Tavily Search(1-2 query) -> Tavily Extract(top 4-6 URL, query+chunks_per_source) -> LLM mention extraction -> mention归一化 -> shortlist匹配 -> 输出分桶`。这说明外部 API 在这里不再是最终产品，而是服务于“网页证据转 POI 候选”的中间能力。Sources: [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L1-L11)

更关键的是，这个文件明确写着“**去掉了 crawl4ai + NER 依赖**”，并强调“全程保持 DB-first，不会把网页里脏实体直接带进地图”。这使当前链路的外部依赖关系非常清晰：网页搜索与网页正文提取依赖 Tavily，实体提取依赖 LLM 接口，本地可信落点依赖数据库 shortlist 与匹配逻辑，最终避免将纯 Web 抓到的噪声实体直接渲染为地图要素。Sources: [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L1-L11)

## Tavily Extract：从搜索结果跳转到网页片段证据

`TavilyExtractClient` 封装的是 `https://api.tavily.com/extract`。它的输入是 URL 列表、查询文本 `query` 与 `chunksPerSource`，最多处理 20 个 URL；当传入查询时，会把 `query` 和 `chunks_per_source` 一同发送给 API，以便让上游按查询相关性返回最相关片段。请求体固定包含 `extract_depth: 'basic'` 与 `format: 'markdown'`。Sources: [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L39-L80)

在结果处理上，客户端优先读取 `result.chunks`，若无 chunks，再降级到 `raw_content` 或 `text`。每个文本块需要长度大于 20 才会进入 `chunks` 数组，最终返回 `{ chunks, failedUrls, latencyMs }`。这说明系统并不把 Tavily Extract 当全文抓取器使用，而是把它视为**面向后续 mention 提取的相关证据片段供给器**。Sources: [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L94-L147)

可靠性方面，Tavily Extract 与 Search 类似，也采用超时控制与“失败返回空集合”的降级策略。如果 API Key 缺失，则直接把所有输入 URL 记入 `failedUrls` 并返回 `latencyMs: 0`。如果 HTTP 非 2xx，会记录警告并返回空 `chunks`。这与 Skill 层的容错风格一致：尽量把第三方不稳定性封装在客户端边界内。Sources: [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L46-L53), [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L59-L92), [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L148-L155)

## Web POI Discovery 中的外部集成治理：域名偏好与阻断规则

`WebPoiDiscoverySkill` 不是无差别依赖互联网搜索结果，它内建了一套**域名偏好与阻断规则**。`DEFAULT_SITE_CONFIG` 定义了全局站点和按场景区分的域名列表，如 food 偏向 `dianping.com`、`meituan.com`，hotel 偏向 `ctrip.com`、`qunar.com`，scenic/park 偏向 `wuhan.gov.cn`、`visitwuhan.com` 等。同时，静态阻断域名包括 `zhihu.com`、`douyin.com`，且对小红书、知乎、抖音的搜索 URL 还有专门的 URL pattern 阻断。Sources: [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L60-L85), [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L87-L133)

这部分实现说明系统对第三方内容源采取的是“**有选择的接入**”而不是“开放式抓取”：一方面允许旅游、生活服务、政府站点参与候选发现，另一方面明确限制部分搜索页或噪声来源进入 Extract 阶段，从而减少低质量页面对后续 mention 抽取的污染。Sources: [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L60-L133)

## 环境配置：第三方 API 是如何被注入系统的

外部集成的配置装载由 `loadRuntimeEnv()` 负责。它会按顺序读取项目根目录 `.env`、项目根目录 `.env.v4`、以及 `backend/.env`，并将解析结果合并到 `process.env`。这意味着诸如 `TAVILY_API_KEY`、`TAVILY_TIMEOUT_MS`、`MULTI_SEARCH_TIMEOUT_MS`、`MENTION_LLM_BASE_URL` 之类的变量，理论上都可通过这几个文件之一注入。Sources: [loadRuntimeEnv.ts](backend/src/config/loadRuntimeEnv.ts#L36-L72)

在实际注册代码中，可验证的外部相关环境变量包括：`TAVILY_API_KEY`、`TAVILY_TIMEOUT_MS`、`MULTI_SEARCH_TIMEOUT_MS`、`MULTI_SEARCH_MAX_ENGINES`，以及 `MENTION_LLM_BASE_URL`、`MENTION_LLM_API_KEY`、`MENTION_LLM_MODEL`，后者会在缺失时降级到主 LLM 配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。这表明外部搜索 API 与外部 LLM 提取 API 在配置层是并列注入的。Sources: [server.ts](backend/src/server.ts#L145-L169)

| 环境变量 | 用途 | 默认值/回退 | 作用位置 |
|---|---|---|---|
| `TAVILY_API_KEY` | 启用 Tavily Search / Extract | 无，缺失则不注册相关技能 | `server.ts` |
| `TAVILY_TIMEOUT_MS` | Tavily Search 超时 | `15000` | `tavily_search` 注册 |
| `MULTI_SEARCH_TIMEOUT_MS` | DuckDuckGo 兼容搜索超时 | `10000` | `multi_search_engine` 注册 |
| `MULTI_SEARCH_MAX_ENGINES` | 多搜索技能最大引擎数配置 | `3` | `multi_search_engine` 注册 |
| `MENTION_LLM_BASE_URL` | mention 提取专用 LLM 地址 | 回退到 `LLM_BASE_URL` | `web_poi_discovery` 注册 |
| `MENTION_LLM_API_KEY` | mention 提取专用 LLM 密钥 | 回退到 `LLM_API_KEY` | `web_poi_discovery` 注册 |
| `MENTION_LLM_MODEL` | mention 提取专用 LLM 模型 | 回退到 `LLM_MODEL` | `web_poi_discovery` 注册 |

Sources: [loadRuntimeEnv.ts](backend/src/config/loadRuntimeEnv.ts#L36-L72), [server.ts](backend/src/server.ts#L145-L169)

## 对外暴露方式：第三方集成如何被调用

这些外部能力最终统一通过技能路由暴露。`registerSkillRoutes()` 提供 `GET /skills` 用于枚举当前已注册技能，`POST /skills/:name/call` 用于执行指定技能动作。请求体中可包含 `action`、`payload`、`session_id`；执行时框架会自动生成 `traceId`、创建日志器，并把结果包装成 `{ ok, skill, action, data, error, trace_id, latency_ms }` 响应。对第三方 API 而言，这一层把“网络集成”转化为“内部能力接口”，减少了调用方对具体供应商的感知。Sources: [skills.ts](backend/src/routes/skills.ts#L15-L60)

## SearXNG：本仓库中当前可验证到什么程度

本页标题包含 SearXNG，因此必须给出严格的证据判断。当前仓库顶层目录中存在 `searxng/settings.yml`，且目录结构工具显示该路径确实存在；但在已审查的 `server.ts`、`backend/src/skills`、`backend/src/integration`、`backend/src/routes` 中，没有发现 SearXNG Skill、SearXNG HTTP client、SearXNG 环境变量使用或注册逻辑。同时，对 `searxng/settings.yml` 的直接文件读取未成功，因为该路径在当前文件系统中表现为目录项而非普通文件。基于“零推测”原则，本页只能记录：**仓库含有 SearXNG 目录资产，但未在当前可验证运行时代码中看到实际接入**。Sources: [get_dir_structure](searxng), [server.ts](backend/src/server.ts#L145-L173), [get_dir_structure](backend/src/integration), [get_dir_structure](backend/src/skills), [get_dir_structure](backend/src/routes)

## 第三方集成模式对比

把当前实现放在一起看，可以清晰看到三种不同的外部集成抽象层次：**基础搜索 API**、**兼容抓取搜索**、**复合编排型业务集成**。这种分层有助于理解为什么 Tavily 是主链路，而 DDG 只是兜底。Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L72-L185), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L109-L214), [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L1-L11), [tavilyExtractClient.ts](backend/src/skills/web_poi_discovery/tavilyExtractClient.ts#L39-L157)

| 维度 | Tavily Search Skill | Multi Search Engine Skill | Web POI Discovery |
|---|---|---|---|
| 集成层级 | 单一第三方搜索 API | HTML 抓取型兼容搜索 | 多外部能力编排 |
| 主用途 | 返回搜索结果与摘要 | 兼容回退搜索 | 从网页证据发现并校验 POI |
| 上游服务 | Tavily `/search` | DuckDuckGo HTML | Tavily `/search` + Tavily `/extract` + LLM |
| 结果形式 | `answer + results` | `merged + summary` | `verifiedDbPois + shortlist + topVenues + timings` |
| 质量控制 | 去重、缓存、超时 | 限速、缓存、HTML 解析 | 域名偏好、阻断、DB-first、分阶段耗时 |
| 注册条件 | 需要 API Key | 默认可注册 | 需要 API Key |

Sources: [TavilySearchSkill.ts](backend/src/skills/tavily_search/TavilySearchSkill.ts#L73-L186), [MultiSearchEngineSkill.ts](backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts#L110-L214), [types.ts](backend/src/skills/web_poi_discovery/types.ts#L153-L190), [server.ts](backend/src/server.ts#L145-L173)

## 代码考古结论：外部集成的演进方向

从遗留文件与新链路注释可以看到一次明确的演进：旧方案中存在 `crawl4aiClient.ts`，其职责是调用本地 `crawl4ai` 服务获取网页内容；而 `WebPoiDiscoverySkill` 的头部注释则明确宣告新链路“去掉了 crawl4ai + NER 依赖”，改为 `Tavily Search + Tavily Extract + LLM mention extraction`。这不是单纯替换供应商，而是把原本分散的“网页搜索 + 网页抓取”能力收束到 Tavily 体系中，从而减少链路依赖数量。Sources: [crawl4aiClient.ts](backend/src/skills/web_poi_discovery/crawl4aiClient.ts#L1-L18), [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L1-L11)

测试脚本也印证了这一点。`backend/test-tavily.mjs` 直接调用 Tavily Search API 输出结果摘要，而 `backend/test-web-poi.mjs` 以 `createWebPoiDiscoverySkill()` 直接构造技能实例进行端到端测试，虽然脚本中仍保留 `crawl4aiUrl` 与 `nerUrl` 传参，但当前 `WebPoiDiscoverySkill` 的可见选项定义中并不包含这两个参数，说明测试与实现之间存在历史痕迹，进一步支持“链路已迁移、部分测试脚本仍残留旧参数”的考古判断。Sources: [test-tavily.mjs](backend/test-tavily.mjs#L1-L28), [test-web-poi.mjs](backend/test-web-poi.mjs#L1-L17), [WebPoiDiscoverySkill.ts](backend/src/skills/web_poi_discovery/WebPoiDiscoverySkill.ts#L39-L51)

## 与其他页面的边界

如果你接下来想理解这些第三方搜索结果如何进入完整用户请求处理链路，建议继续阅读 [请求生命周期管理：从用户输入到流式响应](7-qing-qiu-sheng-ming-zhou-qi-guan-li-cong-yong-hu-shu-ru-dao-liu-shi-xiang-ying)。如果你更关心外部依赖如何影响 LLM 推理与意图判定，应转向 [LLM 集成：意图识别与推理引擎](5-llm-ji-cheng-yi-tu-shi-bie-yu-tui-li-yin-qing)。若你要查看技能体系本身如何组织与调度，则下一页更合适的是 [智能体编排：技能调度与任务执行](20-zhi-neng-ti-bian-pai-ji-neng-diao-du-yu-ren-wu-zhi-xing)。Sources: [server.ts](backend/src/server.ts#L5-L37), [types.ts](backend/src/skills/types.ts#L18-L64), [skills.ts](backend/src/routes/skills.ts#L9-L61)