---
title: "Test Conventions"
readMode: required
priority: high
category: test
keywords:
  - test
  - coverage
  - mock
  - fixture
  - assertion
  - framework
---

# Test Conventions

Auto-generated from project analysis. Update manually as patterns evolve.

## Framework

- Framework: 自研零依赖 harness（`scripts/tests/harness.js`，Node `assert` + `vm` 沙箱），由 `scripts/validate_atlas.js` 统一调度
- 附加：拼音构建包内用 Node 内置测试运行器（`node --test search.test.cjs`，仅在 `scripts/search-pinyin/`）
- Run command:
  - `node scripts/validate_atlas.js --fast` — 约 6 秒：语法、资源哈希、schema、i18n、UI CUJ
  - `node scripts/validate_atlas.js` — 全量：另含多边形拓扑、政区互斥、CLI/MCP 子进程检查
  - `npm test --prefix scripts/search-pinyin` — 拼音检索回归

## Directory Structure

- Pattern: `scripts/tests/` 集中存放 harness 与 suite；`--check` 审计脚本放在 `scripts/` 根部
- 基线/黄金数据由 `audit_*.js`、`build_atlas.js --check` 比对，不在单独 fixtures 目录

## Naming Conventions

- Test files: `suite_<area>.js`（`suite_core_data.js`、`suite_api_search.js`、`suite_trace_genealogy.js`、`suite_cartography_ui.js`、`suite_search_runtime.js`）
- Helper: `harness.js`（创建 `vm` 上下文并载入 bundle）、`boundary_worker.js`（拓扑扫描 worker）
- Audit entry points: `<verb>_<subject>.js`（`audit_topology.js`、`audit_prefectures.js`、`audit_sources.js`、`audit_layout.js`、`perf_budget.js`）

## Patterns

- 浏览器 bundle 在 `vm` 沙箱内按 `index.html` 顺序求值，断言直接打全局对象（`window.DYNASTY_DATA` 等）
- 空间/拓扑断言用真实坐标，不用 mock；边界扫描走 `boundary_worker.js` 并行
- 每个审计脚本必须同时支持生成模式与 `--check` 模式；CI 只跑 `--check`
- 用例失败信息需指出具体快照/要素 id，便于定位数据行

## Entries
