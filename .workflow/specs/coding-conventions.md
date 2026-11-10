---
title: "Coding Conventions"
readMode: required
priority: high
category: coding
keywords:
  - style
  - naming
  - import
  - pattern
  - convention
  - formatting
---

# Coding Conventions

Auto-generated from project analysis. Update manually as patterns evolve.

## Formatting

- Indentation: 2 spaces (JS, CSS, JSON)
- Line length: not configured
- Trailing commas: mixed — preserved as written; follow the surrounding block
- Semicolons: always
- Quotes: single quotes in JS; double quotes inside data literals
- Every bundle starts with a block comment stating its purpose and ownership

## Naming

- Variables/functions: `camelCase`
- Classes/types: `PascalCase`（如 `HistoricalAtlasController`，多数控制逻辑仍以 IIFE 内函数实现）
- Constants: `UPPER_SNAKE_CASE`，声明在 IIFE 顶部
- Files: `snake_case.js`（`map_data.js`、`atlas_api.js`、`validate_atlas.js`）
- Topic pages: `kebab-case.html`（`battle-chibi.html`、`journey-libai.html`）
- Test suites: `suite_<area>.js` + `harness.js` + `boundary_worker.js`

## Imports

- Style: 浏览器侧**无 import** — 每个文件是 IIFE（`(function () { 'use strict'; ... })()`），通过 `window.*` 全局对象与其他 bundle 通信
- Node 脚本: CommonJS `require`；无 ESM
- Path aliases: none
- Load order: 由 `index.html` 显式 script 标签决定；懒加载 bundle 通过 `#atlas-app-script` 的 data 属性声明

## Patterns

- **生成物标记**: `js/atlas_snapshots.js`、`js/atlas_boot.js`、`js/event_pinyin.js` 由脚本生成，文件头注明来源，禁止手改
- **缓存**: 热路径用 `WeakMap`（`RING_BBOX_WEAK`、`SHAPE_BBOX_WEAK`、`PREF_BOUNDARY_MESH_CACHE`）
- **DOM 写入**: 先比较再写（`setSvgAttribute` 只在值变化时 `setAttribute`）
- **数据即代码**: 史料以 JS 字面量/GeoJSON 维护，字段命名与 `CONTRIBUTING.md` 的约定一致
- **`--check` 双模**: 每个审计脚本既有生成模式，也有 `--check` 基线比对模式（CI 用）
- **零外部依赖**: 运行时代码不引入任何库；Node 脚本只用标准库（唯一的 npm 依赖在 `scripts/search-pinyin/`，且仅构建期使用）

## Entries
