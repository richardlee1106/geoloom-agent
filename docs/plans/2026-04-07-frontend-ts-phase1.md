# Frontend TypeScript Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a minimal TypeScript toolchain for the frontend and migrate the highest-leverage shared protocol and utility modules without touching the largest Vue components.

**Architecture:** Keep the UI surface mostly unchanged for this first pass. Add frontend TypeScript infrastructure, convert shared protocol and utility modules to `.ts`, remove duplicate schema definitions, and keep regression coverage on the migrated modules.

**Tech Stack:** Vue 3, Vite, Vitest, TypeScript, vue-tsc

---

### Task 1: Add frontend TypeScript infrastructure

**Files:**
- Create: `tsconfig.json`
- Create: `src/env.d.ts`
- Modify: `package.json`
- Modify: `vite.config.js`

**Intent:**
- Enable `TypeScript` and `vue-tsc` for the frontend without forcing a full repo migration.
- Add a dedicated frontend type-check command.

### Task 2: Consolidate shared SSE schema and migrate core protocol helpers

**Files:**
- Delete: `src/lib/sseEventSchema.js`
- Modify/Create: `shared/sseEventSchema.ts`
- Modify/Create: `src/lib/geoloomApi.ts`
- Modify: `src/lib/geoloomApi.spec.js`
- Modify: `src/utils/__tests__/sseEventSchema.spec.js`

**Intent:**
- Make the shared event contract a single source of truth.
- Ensure frontend helpers consume the shared TypeScript module directly.

### Task 3: Migrate high-value utility modules to TypeScript

**Files:**
- Modify/Create: `src/utils/aiEvidencePayload.ts`
- Modify/Create: `src/utils/contextBinding.ts`
- Modify: `src/utils/__tests__/aiEvidencePayload.spec.js`
- Modify: `src/utils/__tests__/contextBinding.spec.js`

**Intent:**
- Add explicit types for fuzzy region payloads, context binding state, viewport hashing, and protocol normalization.
- Preserve runtime behavior and existing test coverage.

### Task 4: Verify the first migration slice

**Files:**
- Modify: `package.json`

**Intent:**
- Run targeted `Vitest` coverage for migrated modules.
- Run frontend type checking and capture any remaining gaps for phase 2.
