# LLM-First Intent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make provider-ready requests use LLM-first intent understanding, with `DeterministicRouter` serving only as fallback.

**Architecture:** `GeoLoomAgent` should always try to derive intent from the LLM first when the upstream provider is available, including anchor text extraction from raw NL. Deterministic routing remains only as a backup when the provider is unavailable or the LLM returns unusable intent JSON.

**Tech Stack:** TypeScript, Vitest, Fastify SSE chat pipeline, custom LLM provider abstraction

---

### Task 1: Document the new intent contract in tests

**Files:**
- Modify: `backend/tests/unit/agent/GeoLoomAgent.spec.ts`

**Step 1: Write the failing tests**

- Add a test that proves provider-ready flow accepts an LLM intent even when the deterministic router would have classified the query differently.
- Add a test that proves the LLM intent payload may provide `placeName` directly and that the agent uses it instead of the router-derived anchor text.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/agent/GeoLoomAgent.spec.ts`

Expected: FAIL because current implementation only trusts LLM when router returned `unsupported` or `needsClarification`, and it still reuses router `placeName`.

**Step 3: Write minimal implementation**

- Extend the internal LLM intent type to include:
  - `placeName`
  - `secondaryPlaceName`
  - `targetCategory`
- Update the LLM-first intent resolution flow so provider-ready requests no longer gate on router failure first.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/agent/GeoLoomAgent.spec.ts`

Expected: PASS

### Task 2: Make `GeoLoomAgent` LLM-first

**Files:**
- Modify: `backend/src/agent/GeoLoomAgent.ts`

**Step 1: Refactor the intent resolution entrypoint**

- Keep `routerIntent` as fallback context only.
- When provider is ready:
  - always call LLM intent understanding first
  - only fall back to `routerIntent` if LLM parsing fails or returns unusable output

**Step 2: Refactor `inferIntentWithLlm`**

- Remove `router_hint` from the prompt as a primary steering device.
- Ask the model to return structured fields:
  - `queryType`
  - `anchorSource`
  - `placeName`
  - `secondaryPlaceName`
  - `needsClarification`
  - `clarificationHint`
- Parse and validate those fields.

**Step 3: Update resolved intent assembly**

- Use LLM-provided `placeName` for `anchorSource=place`.
- Use `当前区域` only for `anchorSource=map_view`.
- Preserve router fallback only when LLM inference is unavailable or invalid.

**Step 4: Update parser telemetry**

- Ensure `parserModel` / `parserProvider` reflect that provider-ready flow is now LLM-first.

**Step 5: Run focused tests**

Run: `npm test -- tests/unit/agent/GeoLoomAgent.spec.ts`

Expected: PASS

### Task 3: Align in-memory fallback behavior with the new contract

**Files:**
- Modify: `backend/src/llm/InMemoryLLMProvider.ts`
- Modify: `backend/tests/unit/llm/InMemoryLLMProvider.spec.ts`

**Step 1: Write or extend failing tests**

- Ensure the in-memory intent-classifier JSON can return direct `placeName` values for explicit-place queries.

**Step 2: Implement the minimal update**

- Extend `buildIntentClassifierJson` so the returned JSON includes `placeName` / `secondaryPlaceName` where applicable.

**Step 3: Run focused tests**

Run: `npm test -- tests/unit/llm/InMemoryLLMProvider.spec.ts`

Expected: PASS

### Task 4: Re-run the surrounding regression suite

**Files:**
- No production file changes expected

**Step 1: Run all focused unit coverage for this change**

Run: `npm test -- tests/unit/chat/DeterministicRouter.spec.ts tests/unit/chat/DeterministicRouterCurrentArea.spec.ts tests/unit/llm/AnthropicCompatibleProvider.spec.ts tests/unit/llm/InMemoryLLMProvider.spec.ts tests/unit/agent/GeoLoomAgent.spec.ts`

Expected: PASS

**Step 2: Restart the local backend and do live checks**

Run the local backend, then verify at least:
- `这片区域是什么？`
- `解读一下这片区域`
- `解读一下武汉大学周边的业态结构`
- `解读一下湖北大学周边的业态结构`

Expected:
- provider-ready flow does not get blocked by rule-first unsupported replies
- explicit-place questions no longer depend on router-specific phrasing cleanup
- `answer_source` more often lands in `llm_direct` or `llm_synthesized`, with deterministic fallback reserved for true guardrail cases
