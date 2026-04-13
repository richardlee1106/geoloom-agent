# Viewport 区界 ReAct MVP 实施计划

> **给后续执行者：** 这份计划只服务一个单一场景：用户已经在左侧地图框定了 `viewport` 矩形区域，然后提问“这块区域有哪些高分推荐的 XX”。不要在这一版里顺手恢复或扩展到显式锚点、最近地铁站、区域总览、多场景 fallback。

**目标：** 用一个单一、可验证、可清理旧逻辑的 MVP，替换当前宏观、分支过多、fallback 过多的旧链路。新链路只做四件事：1）LLM 理解用户要找的类别；2）用 `viewport` 命中的区名作为联网搜索锚点；3）将联网结果与 `viewport` 内本地 PostGIS POI 做实体对齐；4）返回前 20 条稳定对齐后的结果，供地图和标签云渲染。

**架构：** 采用一个“受限版 ReAct”工作流。外部程序负责循环控制、节点调度、工具执行、Observation 汇总；LLM 只负责类别理解、网页结构化提取、最终 Markdown 润色，不再承担大范围 queryType 判断、fallback 兜底、近邻/大视图/区域分析分流。

**技术栈：** Fastify 后端、PostGIS、区界矢量层、现有 `multi_search_engine`/`tavily_search`、现有 `entity_alignment`、现有向量化/rerank 能力、SSE 流式输出。

---

## 一、MVP 边界

### 1. 仅支持的场景
- 用户已经在左侧地图上定位好一个矩形 `viewport`
- 用户发问形式为：`这块区域有哪些高分推荐的 XX`
- 当前版本只要求系统理解：`XX` 是什么类别
- 系统默认：
  - 这是 `viewport-only`
  - 必须联网搜索
  - 必须查询本地 PostGIS
  - 必须做实体对齐
  - 最终返回前 20 条稳定结果

### 2. 当前版本明确不做
- 显式锚点问法，如“武汉大学附近……”
- `nearby_poi / area_overview / compare / nearest_station` 的多分支意图判定
- 大 viewport / 小 viewport 的分流判断
- “这里 / 这边 / 这块” 的正则兜底恢复
- queryType fallback、toolIntent fallback、embedding-first 兜底
- 任何“理解不了就继续靠旧规则硬跑”的行为

### 3. 硬失败策略
- 如果 LLM 没有理解出用户要找的类别，直接返回：
  - `llm_unrecognized_category`
- 不允许回退到：
  - 正则猜类别
  - embedding classifier 猜 queryType
  - 旧的宏观 prompt 兜底

---

## 二、受限版 ReAct 工作流

这版依然是 ReAct，但我们刻意把它做得很窄，先跑通一个单一场景。

### Round 1：类别理解
- **Thought：** LLM 读取用户问题，只输出 `target_category`
- **Action：** 外部程序校验 JSON Schema
- **Observation：**
  - 成功：进入下一步
  - 失败：直接返回 `llm_unrecognized_category`

### Round 2：区界命中
- **Thought：** 不交给 LLM，外部程序固定执行
- **Action：** 用 `viewport` 与区界矢量相交，保留 `相交面积 / viewport面积 >= 0.10` 的区
- **Observation：** 得到 1 到 N 个命中的区名

### Round 3：联网搜索 Query 生成
- **Thought：** 这版不让 LLM自由发明搜索策略，采用固定模板
- **Action：** 对每个命中的区生成：
  - `"{区名}有哪些高分推荐的{类别}"`
- **Observation：** 得到待搜索 query 列表

### Round 4：联网抓取 + 本地候选
- **Thought：** 不交给 LLM，外部程序固定执行
- **Action：**
  - 并行执行联网搜索与正文抓取
  - 并行查询 `viewport` 内该类别的本地候选 POI
- **Observation：**
  - `web_raw_pool`
  - `local_candidates`

### Round 5：结构化提取 + 去重校验 + 实体对齐
- **Thought：** LLM 仅用于正文结构化提取，不参与“要不要检索/检索哪类工具”决策
- **Action：**
  - 从网页正文中抽实体
  - 做语义去重、地理校验、状态校验
  - 做 web ↔ local POI 实体对齐
- **Observation：** 得到 `validated_candidates` 与 `aligned_top_20`

### Round 6：最终输出
- **Thought：** LLM 用结构化对齐结果生成最终 Markdown
- **Action：** 输出 SSE `refined_result`
- **Observation：** 前端接收 Markdown + 对齐后的 POI 列表，供地图和标签云渲染

---

## 三、节点级 DAG 设计

为了后续实现清晰，建议按 6 个核心节点落地。

### Node 0：类别解析与约束提取

**输入：**
- 用户问题，例如：`这块区域有哪些高分推荐的咖啡店？`

**处理：**
- 用一个极窄 prompt 的 LLM/函数调用，只解析用户要找的类别
- 不解析 queryType，不解析是否联网，不解析 fallback

**输出：**
```json
{
  "status": "ok",
  "targetCategoryLabel": "咖啡店",
  "categoryKey": "coffee"
}
```

**失败输出：**
```json
{
  "status": "unrecognized_category",
  "message": "llm未能理解用户要查询的类别"
}
```

**工具暴露策略：**
- 此节点只暴露类别解析相关函数/Schema
- 不暴露 PostGIS、搜索、alignment 工具

---

### Node 1：区界命中与搜索锚点生成

**输入：**
- `viewport polygon`
- Node 0 输出的 `targetCategory`

**处理：**
- 查询区界矢量层
- 计算区界地块与 `viewport` 的相交占比
- 只保留占比 `>= 10%` 的区
- 为每个区生成一个固定 query

**输出：**
```json
{
  "hitDistricts": [
    { "name": "武昌区", "intersectionRatio": 0.63 },
    { "name": "江岸区", "intersectionRatio": 0.18 }
  ],
  "queries": [
    "武昌区有哪些高分推荐的咖啡店",
    "江岸区有哪些高分推荐的咖啡店"
  ]
}
```

**关键原则：**
- 第一版不要把多个区名拼成一条超长 query
- 一区一搜，后续再 merge

---

### Node 2：联网搜索 + 正文抓取

**输入：**
- Node 1 生成的 district queries

**处理：**
- 默认走 `multi_search_engine`（DDG 主力）
- 保留 `tavily` 作为可选后备，但不要在清理旧链路时误删
- 每个搜索结果 URL 进入正文抓取链路：
  - `@mozilla/readability` 优先
  - 正文不足时 `Firecrawl` fallback

**输出：**
- `raw_data_pool: [{source, query, title, url, snippet, main_content}]`

**超时与降级：**
- 单 URL 抓取超过阈值则跳过正文，仅保留 snippet
- Readability 提取正文长度明显不足时，才调用 Firecrawl

---

### Node 3：实体抽取与网页噪音清洗

**输入：**
- Node 2 的网页正文/摘要池

**处理：**
- 先做规则去噪：
  - 导航栏
  - 广告区
  - 评论区
  - Cookie 弹窗
  - 站点模板壳
- 再用 LLM 做结构化抽取：
  - name
  - district
  - score_text
  - price
  - tags
  - raw evidence
- 用 JSON Schema 强校验，校验失败的页面直接丢弃

**输出：**
```json
[
  {
    "name": "咖啡店A",
    "district": "武昌区",
    "scoreText": "4.8/5",
    "price": "¥38/人",
    "tags": ["精品咖啡", "适合办公"],
    "url": "...",
    "rawSnippet": "..."
  }
]
```

---

### Node 4：语义去重 + 地理/状态校验

**这是本版本唯一允许系统性使用 Embedding 的地方。**

**输入：**
- Node 3 抽出的网页候选实体

**处理：**
1. 语义去重
   - 对 `{name, district/address_snippet}` 做向量化
   - `cosine_sim > 阈值` 则视为重复并合并
2. 地理校验
   - 只保留区名与命中区一致，或地理描述与命中区强相关的候选
3. 状态校验
   - 文本含 `歇业 / 搬迁 / 暂停营业 / 已关 / closed` 时打状态标记

**输出：**
- `validated_web_candidates`

**关键边界：**
- Embedding 不用于工具路由
- Embedding 不用于 query 生成
- Embedding 不用于跨全库语义召回
- Embedding 只用于：
  - 去重
  - 弱别名归并
  - Web 到本地实体匹配增强

---

### Node 5：实体对齐与启发式重排

**输入：**
- `validated_web_candidates`
- `viewport` 内本地类别候选 POI

**处理：**
- 对齐：web candidate ↔ local POI
- 重排：采用可解释的规则加权

建议的核心评分项：
- 评分归一化
- 多源提及频次
- 时效性
- 区界一致性
- viewport 内本地存在性
- 对齐置信度

**输出：**
- `aligned_top_20`

**关键原则：**
- 排序引擎主导应是规则，而不是“黑盒神经排序”
- LLM 只允许做：
  - 模糊评分文本归一化
  - 价格/标签标准化
- 最终得分必须可解释

---

### Node 6：Markdown 输出与免责声明

**输入：**
- Node 5 的前 20 条结果

**处理：**
- 生成用户可读的 Markdown
- 明确写出：
  - 数据来源
  - 数据局限性
  - 是否存在状态不确定项

**输出：**
- 最终 Markdown
- 结构化 aligned POI 列表（给地图/标签云）

---

## 四、关键设计判断

这一节专门回答当前 MVP 最关键的取舍。

### 1. 工具召回是否靠 LLM Function Calling + 配置过滤，不用 Embedding？

**结论：是，且应该更强一点。**

当前 MVP 下，工具路由不应该靠 embedding。

建议：
- 采用 **LLM Function Calling + 节点级工具白名单**
- 更进一步，部分节点根本不开放自由选工具，直接由外部程序固定调用

也就是说：
- Node 0：只允许类别解析
- Node 1：固定走区界相交
- Node 2：固定走搜索与正文抓取
- Node 3：固定走结构化抽取
- Node 4：固定走去重/校验
- Node 5：固定走 alignment + scoring

**不要让 LLM 再决定：**
- 我该不该用 PostGIS
- 我该不该联网
- 我现在是不是 nearby_poi
- 要不要 fallback

在这个 MVP 里，这些都应该是外部程序的固定 DAG。

---

### 2. Embedding 是否只用于结果去重，不用于检索和路由？

**结论：基本同意，但我会稍微放宽一点。**

对这个 MVP 来说，Embedding 应该：
- 不参与工具路由
- 不参与 query 生成
- 不参与全库召回

但不应该只限于“纯去重”。

建议它只在 Node 4 / Node 5 这类后处理节点里使用，范围包括：
- 网页候选去重
- 网页候选弱别名归并
- Web 结果和本地 POI 的相似度辅助对齐

所以更准确的表述是：

> Embedding 仅用于结果层的“去重 + 归并 + 对齐增强”，不用于路由，不用于检索入口决策。

---

### 3. 网页内容是否靠 Readability / Firecrawl + LLM 结构化来处理噪音？

**结论：是，这条路非常适合当前 MVP。**

建议顺序：
1. 先 `Readability`
2. 如果正文长度太短或提取质量明显差，再 `Firecrawl`
3. 再交给 LLM 做结构化抽取
4. 再做 JSON Schema 校验

推荐原则：
- `Readability` 作为主力，低成本
- `Firecrawl` 作为 fallback，不要默认全站都走
- LLM 永远不要直接读原始 HTML

---

### 4. 重排是否靠规则加权 + LLM 语义归一化，并明确标注数据局限性？

**结论：是，这也是当前 MVP 最稳的方式。**

建议：
- 排序主干必须是可解释规则
- LLM 只做模糊文本归一化

例如：
- `4.8分 / 大众点评高分 / 本地人推荐` → 归一成标准评分信号
- `人均 50 左右 / 性价比高 / 适合约会` → 归一成 price/tags

但最终排序一定要落回规则引擎：
- `评分`
- `多源提及`
- `时效性`
- `区界一致性`
- `本地 POI 对齐置信度`

并且输出时必须明确：
- 数据来源
- 更新时间
- 数据局限性
- 原始链接

---

## 五、旧逻辑清理原则

最大的风险不是“做不出功能”，而是**旧逻辑还在活动路径里偷偷生效**。

### 必须保留的能力
- `backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts`
- `backend/src/skills/tavily_search/TavilySearchSkill.ts`
- `backend/src/skills/search_router/SearchRouter.ts`
- `backend/src/skills/entity_alignment/EntityAlignmentSkill.ts`
- 现有向量化/rerank 基础设施
- SSE 输出链路
- 前端渲染 aligned POI 的能力

### 必须从活动路径清除的逻辑
- 多场景 queryType 判定
- `nearby / area overview / compare / nearest station` 的统一大 prompt
- deictic fallback 恢复
- 旧的 `toolIntent / searchIntentHint` 大分支
- 旧的大 viewport prompt 和区域骨架 prompt
- 旧的宏观 deterministic evidence runtime 主路径

### 清理顺序
1. 先写替代测试
2. 再切活动路径
3. 再做真实 replay
4. 确认安全后再删旧代码

不要反过来。

---

## 六、文件影响范围

### 需要重点修改
- `backend/src/agent/GeoLoomAgent.ts`
- `backend/src/chat/types.ts`
- `backend/src/skills/postgis/PostGISSkill.ts`
- `backend/src/skills/postgis/actions/executeSQL.ts`
- `backend/src/skills/postgis/templates/*.sql`
- `backend/src/skills/entity_alignment/EntityAlignmentSkill.ts`
- `backend/tests/integration/routes/chat.spec.ts`

### 预计从活动路径退役
- `backend/src/evidence/RequirementResolver.ts`
- `backend/src/evidence/DeterministicEvidenceRuntime.ts`
- `backend/src/evidence/Renderer.ts`
- `backend/src/evidence/views/AreaOverviewView.ts`
- `backend/src/agent/IntentAlignmentGuard.ts`
- `backend/tests/unit/agent/GeoLoomAgent.spec.ts` 中大部分宏观断言

### 需要新增
- `backend/src/agent/ViewportCategoryPlanner.ts`
- `backend/src/agent/ViewportDistrictReactLoop.ts`
- `backend/src/skills/postgis/templates/viewportDistrictIntersection.sql`
- `backend/tests/unit/agent/ViewportCategoryPlanner.spec.ts`
- `backend/tests/unit/agent/ViewportDistrictReactLoop.spec.ts`
- `backend/tests/unit/postgis/ViewportDistrictIntersection.spec.ts`
- `scripts/test-viewport-district-react.mjs`

### 实施前必须确认
- 区界表 / 视图的真实名字
- 区界数据当前坐标系 / 投影修复方式

---

## 七、详细开发 TODO

### Task 0：冻结 MVP 契约，先补测试

**文件：**
- 新建：`backend/tests/integration/routes/chat.viewport-mvp.spec.ts`
- 新建：`scripts/test-viewport-district-react.mjs`

**步骤：**
1. 写一个失败中的集成测试
   - 输入：viewport + `这块区域有哪些高分推荐的咖啡店？`
   - 断言：
     - 走的是 viewport-only 路径
     - 类别理解成功
     - 生成区名搜索 query
     - 最终输出是 Markdown
     - aligned 结果 `<= 20`
2. 运行测试，确认当前旧链路下失败
3. 加一个手动 replay 脚本
   - 输出：
     - 识别到的类别
     - 命中的区
     - 生成的 query
     - aligned 结果数

---

### Task 1：实现区界相交与 10% 规则

**文件：**
- 新建：`backend/src/skills/postgis/templates/viewportDistrictIntersection.sql`
- 修改：`backend/src/skills/postgis/actions/executeSQL.ts`
- 修改：`backend/src/skills/postgis/PostGISSkill.ts`
- 新建：`backend/tests/unit/postgis/ViewportDistrictIntersection.spec.ts`

**步骤：**
1. 先写 failing test
2. SQL 模板必须输出：
   - `district_name`
   - `intersection_area`
   - `viewport_area`
   - `intersection_ratio`
3. 过滤掉 `< 0.10` 的区
4. 按 `intersection_ratio desc` 排序
5. 运行单测
6. 手动验证一个已知 viewport

---

### Task 2：实现“只做类别理解”的 LLM Planner

**文件：**
- 新建：`backend/src/agent/ViewportCategoryPlanner.ts`
- 修改：`backend/src/chat/types.ts`
- 新建：`backend/tests/unit/agent/ViewportCategoryPlanner.spec.ts`

**步骤：**
1. 写 failing test
2. 输出 schema 只包含：
   - `status`
   - `targetCategoryLabel`
   - `categoryKey`
3. Prompt 只问一件事：
   - 用户要找什么类别
4. 禁止它输出：
   - `queryType`
   - `toolIntent`
   - `needsWebSearch`
   - fallback 相关字段
5. 运行单测

---

### Task 3：实现固定的 Viewport District ReAct Loop

**文件：**
- 新建：`backend/src/agent/ViewportDistrictReactLoop.ts`
- 修改：`backend/src/agent/GeoLoomAgent.ts`
- 新建：`backend/tests/unit/agent/ViewportDistrictReactLoop.spec.ts`

**步骤：**
1. 写 failing test
2. 固定节点顺序：
   - 类别解析
   - 区界命中
   - 本地候选查询
   - 区名联网搜索
   - 实体抽取/校验/对齐
   - Markdown 输出
3. 外部程序控制循环，不把 while-loop 交给 LLM
4. 把 viewport 场景接到新 loop
5. 跑单测

---

### Task 4：接入网页抓取与结构化提取

**文件：**
- 修改：`backend/src/agent/ViewportDistrictReactLoop.ts`
- 保留：`backend/src/skills/multi_search_engine/MultiSearchEngineSkill.ts`
- 保留：`backend/src/skills/tavily_search/TavilySearchSkill.ts`
- 新建或修改：正文抓取工具封装

**步骤：**
1. 搜索仍然以 DDG/multi_search 为主
2. 对 URL 先走 Readability
3. Readability 不足时再走 Firecrawl
4. 再用 LLM 做 JSON Schema 结构化抽取
5. 抽取失败页面直接丢弃，不污染后续对齐

---

### Task 5：把 Embedding 限制在“去重 + 对齐增强”

**文件：**
- 修改：`backend/src/skills/entity_alignment/EntityAlignmentSkill.ts`
- 新建或修改：`dedup_module`

**步骤：**
1. 先对网页抽取实体做语义去重
2. 再做地理校验与状态校验
3. 再把它们与 `viewport` 内本地 POI 对齐
4. 不允许 embedding 参与：
   - 工具路由
   - Query 生成
   - 跨全库召回
5. 跑单测和手动 replay

---

### Task 6：实现规则主导的重排与 Top 20 输出

**文件：**
- 修改：`backend/src/agent/ViewportDistrictReactLoop.ts`
- 新建：`scoring_engine`
- 修改：`backend/tests/integration/routes/chat.viewport-mvp.spec.ts`

**步骤：**
1. 写 failing test
2. 排序项至少包含：
   - 评分归一化
   - 多源提及频次
   - 时效性
   - 区界一致性
   - 对齐置信度
3. LLM 只负责归一化模糊文本
4. 输出前 20 条 aligned 结果
5. 跑测试

---

### Task 7：逐步退役旧宏观链路

**文件：**
- 修改：`backend/src/agent/GeoLoomAgent.ts`
- 逐步退役：
  - `backend/src/evidence/RequirementResolver.ts`
  - `backend/src/evidence/DeterministicEvidenceRuntime.ts`
  - `backend/src/evidence/Renderer.ts`
  - `backend/src/evidence/views/AreaOverviewView.ts`
- 修改：旧单测

**步骤：**
1. 替代测试先补齐
2. 切换 viewport-only 活动路径
3. 每删一块旧逻辑都跑一轮定向测试 + 手动 replay
4. 确认安全后再继续删

---

## 八、每一轮清理后的安全验证

每清理掉一个关键环节，都必须执行：

```bash
npm --prefix backend run test -- tests/unit/agent/ViewportCategoryPlanner.spec.ts tests/unit/agent/ViewportDistrictReactLoop.spec.ts tests/unit/postgis/ViewportDistrictIntersection.spec.ts tests/integration/routes/chat.viewport-mvp.spec.ts
```

```bash
node scripts/test-viewport-district-react.mjs
```

并逐项确认：
- 类别理解还正常
- 区界 10% 过滤还正常
- 区名搜索 query 还正常
- aligned POI 还能正常返回
- 最终答案还是 Markdown
- 旧 fallback 没有悄悄复活

---

## 九、完成定义

当且仅当下面都满足时，这个 MVP 算完成：

- viewport-only 成为这个场景的唯一活动路径
- LLM 只负责理解类别，不再做宏观任务分流
- 区界命中采用 10% 占比规则
- 联网搜索以区名为锚点，不再裸搜“这块区域……”
- 网页结果通过正文提取、结构化抽取、去重、校验、实体对齐后再进入最终结果
- Embedding 只存在于结果层，不介入路由/检索入口决策
- 排序是规则主导、可解释的
- 最终返回前 20 条 aligned POI + Markdown
- 每轮清理后的测试和 replay 都通过

---

## 十、补充说明

- 这份计划刻意不处理显式锚点问题
- 这份计划刻意不提供 fallback
- 这份计划刻意保留既有搜索、alignment、向量化技能，不要误删
- 当前最危险的不是“功能没做好”，而是“旧逻辑还在活动路径里同时跑”

