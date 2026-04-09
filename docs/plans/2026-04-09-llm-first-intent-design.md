# LLM-First Intent Design

**Date:** 2026-04-09

**Goal**

在 provider ready 的正常路径下，把 GeoLoom Agent 的入口改成 “LLM 先理解 -> LLM 编排工具 -> LLM 基于证据输出”，不再让 `DeterministicRouter` 主导自然语言理解。

**Current Problem**

- 当前入口先跑 `DeterministicRouter`，先由规则决定 `queryType / placeName / anchorSource`。
- LLM 只在 router 判成 `unsupported` 或 `needsClarification` 时才补救。
- 这导致自然语言写法一旦没被规则覆盖，用户会先看到“当前 V4 已支持……”这种规则式拦截，而不是进入真正的 agent 理解链路。
- 当上游 LLM 编排阶段偶发失败时，fallback 还会复用一部分规则抽锚思路，进一步放大不稳定感。

**Approved Direction**

- provider ready 时：
  - LLM 直接理解原始 NL。
  - LLM 直接输出结构化 intent，包括 `queryType / anchorSource / placeName / secondaryPlaceName / needsClarification / clarificationHint`。
  - `DeterministicRouter` 只作为 fallback，不再作为主入口。
- provider unavailable 或 LLM intent 解析失败时：
  - 才回退到 `DeterministicRouter`。
- 工具编排仍由 LLM 驱动。
- 证据回收后由 LLM 做 Markdown 组织输出。
- `deterministic_renderer` 仅保留为最终保命网，不再承担“理解用户在说什么”的职责。

**Architecture Change**

1. 在 `GeoLoomAgent` 中新增 LLM-first 的 intent 解析路径。
2. `inferIntentWithLlm` 的输出结构扩展为可返回显式锚点文本，而不再只返回 `queryType` 和 `anchorSource`。
3. `routerIntent` 改为 fallback intent，不再作为主 intent 的前置门槛。
4. parser telemetry 中区分：
   - `agent-intent-understanding`：LLM-first 成功
   - `deterministic-router`：provider unavailable 或 LLM intent 失败后的 fallback
5. `InMemoryLLMProvider` 的 intent-classifier mock 与 fallback tool planner 保持同样的 LLM-first 契约，避免测试和兜底链路继续绑死在旧规则上。

**Behavioral Expectations**

- “这片区域是什么 / 解读一下这片区域 / 看看这个区域” 这类 NL，在 map view 存在时直接进入 `area_overview + map_view`。
- “解读一下武汉大学周边的业态结构” 这类显式地点问法，由 LLM 直接给出 `placeName=武汉大学`，而不是依赖 router 预清洗。
- 即便 router 规则未来没有覆盖新的自然语言写法，provider ready 时也不应该先被规则挡住。

**Risk Control**

- 仍保留 router fallback，避免上游不可用时整条链断掉。
- 仍保留 confidence gate 与 deterministic renderer，避免证据不足时幻觉输出。
- 先通过 unit tests 固化入口契约，再跑 live smoke，防止出现“局部 case 变好但架构没改正”的假进展。
