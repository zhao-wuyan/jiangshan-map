---
title: jiangshan-map — 数据与检索索引构建
type: recipe
explicitId: rcp-20261110-build-workflow
created: 2026-11-10T10:03:43.080Z
keywords:
  - workflow
  - build-workflow
  - geojson
  - pinyin
  - auto-generated
lifecycleStatus: active
relatedPaths:
  - scripts/build_atlas.js
---

# Historical Atlas Data Build

## Goal
Regenerate the checked-in data bundles from source GeoJSON and the pinyin search index after editing data.

## Prerequisites
- Node.js 20+
- For pinyin only: `npm ci --prefix scripts/search-pinyin --ignore-scripts --no-audit --no-fund`

## Steps
1. Edit GeoJSON sources under `data/atlas/<dynasty>/<snapshot>.geojson` (never the generated bundles), then `node scripts/build_atlas.js`
2. Edit milestone/landmark titles in `js/map_data.js` or `js/lore_detail.js`, then rebuild pinyin: `npm run build --prefix scripts/search-pinyin`
3. Verify pinyin output is current: `npm run check --prefix scripts/search-pinyin`
4. Sync asset hashes after any `css/` or `js/` change: `node scripts/sync_version.js`
5. Verify the build is canonical: `node scripts/build_atlas.js --check`

## Expected Outcome
`js/atlas_snapshots.js` and `js/atlas_boot.js` regenerated, `js/event_pinyin.js` current, `index.html` hashes updated, `--check` exits 0.

## Common Pitfalls
- `validate_atlas.js --fast` also verifies hashes — skipping `sync_version.js` fails the suite
- Each feature is stored once in the earliest snapshot that uses it; editing it changes every snapshot that references it
- pinyin rows follow source event order; CI rejects stale or reordered output

## Related
- [[architecture-constraints]] / [[test-conventions]]
