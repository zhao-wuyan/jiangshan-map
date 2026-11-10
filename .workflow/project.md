# Project: 江山时序 (jiangshan-map)

## What This Is

中国历史交互地图时间轴，覆盖公元前 403 年（三家分晋）至 2026 年：历代疆域与州郡道省政区、黄河改道、古今地名沿革（点地溯源）、二十座名关、以及 125+ 位历史人物与古诗词行迹（点人溯事）。纯静态网页，浏览器直开；同时对外提供深链接 URL 协议、`window.atlasAPI`、WebMCP、本地 MCP Server 与 Agent Skill。

## Core Value

任意「年份 + 地名/人物」组合都能落到正确的历史阶段，并展开可考证的资料卡与轨迹——把两千年时空压缩成一次可验证的定位。

## Requirements

### Validated

<!-- 已上线并由发布版本验证。 -->

- 18 个历史时期、197 幅多阶段疆域/政区快照，时间轴拖动即切换
- 525 条编年大事、726 处城池地标，含在位帝王与年号时间轴
- 点地溯源：古城两千四百年政区沿革卡片（`?year=<year>&place=<name>`）
- 点人溯事：人物生平行迹与诗词路线（`?person=<name>`，多人物同途相逢）
- 零坐标深链协议：单点 / 同年路线 / 跨年路线（`year` 与 `place` 逗号配对、`;` 汇聚路线）
- 多语言 UI：简体（源） / 英文 `lang=en` / 繁体 `lang=zh-tw`
- 舆图寻址挑战彩蛋、古琴音轨、地形晕渲底图
- GeoJSON 导出（RFC 7946）与 `geojson/jiangshan-locate.js` 按坐标反查
- MCP Server（Stdio JSON-RPC 2.0，`scripts/mcp_server.js`）与 Agent Skill（`skills/jiangshan-atlas`）
- 完整性 CI：多边形拓扑、政区互斥、数据引用、首屏 gzip 预算、响应式布局几何、拼音检索回归

### Active

<!-- 下一阶段范围由 roadmap 决定，init 不预判路线图结构。 -->

- [ ] 待 `roadmap` 生成后填写

### Out of Scope

- 精确测绘边界 — 历史疆域与政区为示意性近似，不作为权威边界依据
- 运行时后端/数据库 — 站点纯静态托管，无服务端依赖

## Context

- 规模：`js/app.js` 428 KB、`js/atlas_snapshots.js` 2.2 MB（生成物）、`js/i18n_dict.js` 399 KB、`js/lore_detail.js` 502 KB；`js/` 共 15 个 bundle，`css/style.css` 124 KB。
- 数据流：`data/atlas/<dynasty>/<snapshot>.geojson`（源）→ `node scripts/build_atlas.js` → VLQ 拓扑去重编码 → `js/atlas_snapshots.js` + `js/atlas_boot.js`（勿手改）。
- 检索：`js/map_data.js` / `js/lore_detail.js` 的标题改动后需重建 `js/event_pinyin.js`（`npm run build --prefix scripts/search-pinyin`）。
- 缓存：`index.html` 为每个 CSS/JS 资源写入 8 位内容哈希，改 `css/` 或 `js/` 后跑 `node scripts/sync_version.js`。
- 校验：`node scripts/validate_atlas.js --fast`（约 6 秒，语法/哈希/schema/i18n/UI CUJ）与全量套件（含拓扑与子进程检查）。
- GitNexus 已索引本仓库（2799 symbols / 8864 relationships / 173 execution flows），改动符号前先跑 `impact`，提交前跑 `detect-changes`。
- 文档：`README*.md`（4 语）、`CONTRIBUTING.md` / `CONTRIBUTING_ZH.md`、`llms.txt`（AI 深链协议说明）、`docs/`（相机性能与繁化工作记录）。

## Constraints

- **静态交付**: 运行时零依赖、无构建步骤，`index.html` 直接服务即可 — 保证 GitHub Pages / Docker nginx 均可直开
- **体积预算**: 首屏同步脚本有 gzip 预算阈值，`scripts/perf_budget.js --check` 把关 — 数据只能懒加载
- **生成物不可手改**: `js/atlas_snapshots.js`、`js/atlas_boot.js` 由 `scripts/build_atlas.js` 产出；`js/event_pinyin.js` 由 `scripts/search-pinyin/build.cjs` 产出
- **语言**: 简体中文为内容源语言，英文/繁体经 `js/i18n_dict.js` 与 `js/zh_hant.js` 映射，新增文案需三语同步
- **CI 即门禁**: 拓扑/区划/引用/预算/布局/拼音任一基线偏移即失败，基线文件需随改动同步更新

## Tech Stack

- **Language**: JavaScript（ES6，IIFE + 全局对象，无打包器）、HTML、CSS；Node.js 20+（构建与校验脚本）、Python（地形瓦片渲染）
- **Framework**: 无框架 — 原生 DOM + SVG 渲染，自研相机/投影/布局
- **Database**: 无 — 静态 GeoJSON + JS 数据 bundle

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 纯静态、零运行时依赖 | 站点可托管于任意静态服务与 Docker nginx，离线可用 | 已验证 |
| 原生 SVG + 自研相机，不用地图库 | 需要 2000 年跨度的自定义投影、图层与标注排布 | 已验证 |
| 快照由 `data/atlas` 单向生成（VLQ 拓扑去重） | 单要素跨快照复用，避免数据重复与不一致 | 已验证 |
| 深链 URL 协议 `?year&place&person` | 让搜索/AI/分享都走同一可复现入口 | 已验证 |
| 内容三语以简中为源 | 翻译集中在字典，避免内容文件分叉 | 已验证 |

## Stakeholders

- 项目作者与维护者（DeanChensj）
- 历史地理贡献者（史料校勘、地名沿革、人物年谱）
- 访客与 AI Agent（深链协议、MCP、Skill 消费者）

---
*Last updated: 2026-11-10 after initialization*
