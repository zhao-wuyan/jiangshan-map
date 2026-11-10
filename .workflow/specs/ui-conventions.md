---
title: "UI Conventions"
readMode: optional
priority: medium
category: ui
keywords:
  - ui
  - design
  - color
  - typography
  - layout
  - animation
  - component
---

# UI Conventions

## Color & Theme

## Typography

## Layout & Spacing

## Motion & Animation

## Component Patterns

## Entries



<spec-entry category="ui" keywords="ui,theme,i18n,svg,layout" date="2026-11-10" sid="S-20261110-6j1v" title="表现层约定（主题/三语/SVG）" sourceRef="feat/offline-desktop@a801119">

### 表现层约定（主题/三语/SVG）

- 样式集中在单文件 `css/style.css`；主题与配色走 `:root` 自定义属性，暗色在媒体查询内覆盖同一组变量
- 地图渲染为原生 SVG + 自研投影/相机（`js/app.js`），不引入第三方地图库或 UI 框架
- 文案以简体中文为源；英文在 `js/i18n_dict.js`，繁中在 `js/zh_hant.js`，新增 UI 字符串三处必须同步
- 布局/断点改动必须通过 `node scripts/audit_layout.js --check`（多视口几何与非重叠）
- 首屏同步脚本受 gzip 预算约束：新增体积大的数据或模块只能走懒加载 bundle

</spec-entry>