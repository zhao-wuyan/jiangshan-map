---
title: jiangshan-map — 校验套件
type: recipe
explicitId: rcp-20261110-test-workflow
created: 2026-11-10T10:03:43.459Z
keywords:
  - workflow
  - test-workflow
  - validation
  - auto-generated
lifecycleStatus: active
relatedPaths:
  - scripts/validate_atlas.js
---

# Validation Suite

## Goal
Run the project's integrity and regression checks, fast during iteration and full before a PR.

## Prerequisites
- Node.js 20+ (CI version)

## Steps
1. Fast pass (~6s): `node scripts/validate_atlas.js --fast`
2. Full pass before PR: `node scripts/validate_atlas.js` (adds polygon topology, territorial exclusivity, CLI/MCP subprocess checks)
3. Baseline audits as needed:
   - `node scripts/audit_topology.js --check`
   - `node scripts/audit_prefectures.js --check`
   - `node scripts/audit_sources.js --check`
   - `node scripts/build_atlas.js --check`
   - `node scripts/perf_budget.js --check`
   - `node scripts/audit_layout.js --check`
4. Pinyin package tests: `npm test --prefix scripts/search-pinyin`

## Expected Outcome
All suites exit 0; a `--check` mismatch names the offending snapshot/feature for data repair.

## Common Pitfalls
- A stale asset hash surfaces as a fast-suite failure, not a topology failure
- Layout audit failures come from responsive breakpoint geometry — inspect the reported viewport
- CI runs the exact same commands on Node 20; a local Node 24-only syntax will pass locally and fail in CI

## Related
- [[test-conventions]] / [[architecture-constraints]]
