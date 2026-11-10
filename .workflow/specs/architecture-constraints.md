---
title: "Architecture Constraints"
readMode: required
priority: high
category: arch
keywords:
  - architecture
  - module
  - layer
  - boundary
  - dependency
  - structure
---

# Architecture Constraints

Auto-generated from project structure. Update manually as architecture evolves.

## Module Structure

- Type: single-package static site（无 monorepo、无打包器）
- Key modules:
  - `index.html` — 唯一入口，按序加载 bundle，写入资源内容哈希
  - `js/app.js` — 控制中枢（投影、相机、图层、交互）
  - `js/atlas_boot.js` / `js/atlas_snapshots.js` — **生成物**：VLQ 拓扑去重后的快照数据
  - `js/map_data.js` — 朝代、快照阶段、编年大事、城池
  - `js/lore_core.js` / `js/lore_detail.js` — 年号、帝王、地名沿革、人物年谱
  - `js/atlas_api.js` / `js/atlas_search.js` / `js/atlas_trace.js` / `js/atlas_narrator.js` / `js/atlas_quiz.js` — API、检索、溯源、叙述、彩蛋
  - `js/i18n_dict.js` / `js/zh_hant.js` — 英文与繁中映射
  - `data/atlas/` — GeoJSON 源数据（编辑入口）
  - `scripts/` — Node 构建/审计脚本（`build_atlas.js`、`sync_version.js`、`audit_*.js`、`validate_atlas.js`、`mcp_server.js`）
  - `scripts/tests/` — 自研零依赖校验 harness 与 5 个 suite
  - `topics/` — 静态 SEO 专题页；`geojson/` — 导出产物与按坐标反查 helper
  - `skills/jiangshan-atlas/` — Agent Skill 定义

## Layer Boundaries

```
data/atlas/*.geojson  →  scripts/build_atlas.js  →  js/atlas_snapshots.js + js/atlas_boot.js
js/map_data.js, js/lore_detail.js  →  scripts/search-pinyin/build.cjs  →  js/event_pinyin.js
index.html  →  js bundles（按序）→  window.* 全局 API  →  页面 UI / WebMCP / MCP Server
```

- 源数据只朝一个方向流动：**编辑源文件，不编辑产物**
- `index.html` 是资源清单的唯一真源；新增/重命名 bundle 必须同步 `scripts/sync_version.js` 的 `CONTROLLER_SCRIPTS`

## Dependency Rules

- 浏览器 bundle 之间不互相 `import`；依赖方向由 `index.html` 的加载顺序保证
- Node 脚本可以 require 浏览器 bundle（`scripts/tests/harness.js` 在 `vm` 沙箱里按顺序求值）
- `scripts/mcp_server.js` 依赖静态数据与 `scripts/tests/harness.js` 的求值环境
- 禁止反向依赖：`js/` 不得 require `scripts/`

## Technology Constraints

- Runtime: Node.js 20+（CI 固定 20）；Python 3（仅 `build_terrain_tiles.py`）
- Module system: 浏览器 IIFE / Node CommonJS
- Strict mode: yes（每个浏览器 bundle 的 IIFE 内 `'use strict'`）
- 运行时零依赖；`scripts/search-pinyin` 是唯一带 npm 依赖的隔离包（`pinyin-pro` 固定版本）

## Entries
