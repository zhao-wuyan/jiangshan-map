---
title: "Review Standards"
readMode: required
priority: medium
category: review
keywords:
  - review
  - checklist
  - gate
  - approval
  - standard
---

# Review Standards

## Entries



<spec-entry category="review" keywords="ci,qc,gate,validate,perf" date="2026-11-10" sid="S-20261110-5ee4" title="CI 门禁与提交前检查" sourceRef="feat/offline-desktop@a801119">

### CI 门禁与提交前检查

- 改 `css/` 或 `js/` 后先跑 `node scripts/sync_version.js`，再跑 `node scripts/validate_atlas.js --fast`
- 提交 PR 前跑全量 `node scripts/validate_atlas.js`（含拓扑、互斥、CLI/MCP 子进程）
- 数据层改动后同步基线并跑 `--check`：`build_atlas.js --check`、`audit_topology.js --check`、`audit_prefectures.js --check`、`audit_sources.js --check`
- 标题/地名改动后重建拼音索引并跑 `npm run check --prefix scripts/search-pinyin` 与 `npm test --prefix scripts/search-pinyin`
- 首屏同步脚本 gzip 必须守住预算（`scripts/perf_budget.js --check`）
- 响应式布局几何不得重叠（`scripts/audit_layout.js --check`）
- CHGIS 郡/州/府图层不得进入导出产物或公开分发
- `js/atlas_snapshots.js`、`js/atlas_boot.js`、`js/event_pinyin.js` 为生成物，禁止手改

</spec-entry>