# 微信小程序实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有网页本地版的基础上，新增一个由微信云开发提供跨设备数据同步的年卡打卡小程序。

**Architecture:** 新建原生小程序前端，复用现有年卡业务规则，使用 `wx.cloud` 调用云函数。云函数从调用上下文读取用户身份并读写按用户隔离的 `userSettings` 与 `visits` 集合；小程序用本地缓存支持断网查看，网页与小程序通过兼容 JSON 文件迁移数据。

**Tech Stack:** 微信原生小程序（WXML、WXSS、JavaScript）、微信云开发云函数与云数据库；无新增第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-03-wechat-mini-program-design.md`

## Global Constraints

- 现有网页继续作为独立的本地版保留，不读取或写入小程序云端数据。
- 不建设独立服务器或网页端云同步。
- 不做多张年卡/家庭共享/多人协作。
- 每次小程序重新打开/进入前台时刷新云端数据；另一台设备已打开的页面不要求即时推送更新。
- 断网时允许查看缓存，云端写入需要联网。
- 客户端数据库权限不允许直接读写集合；云端操作通过云函数校验当前调用者身份。
- AppID 与云环境 ID 使用占位配置，不提交真实账号配置。

## Review Focus

- 恶意或错误导入的 JSON：结构、日期、数值必须校验，不能写入不完整数据。
- 云函数传入其他用户的记录 ID：所有读写均限定为调用者自己的数据。
- 云端设置缺失、集合为空或部分读取失败：首次默认值与缓存回退行为明确。
- 云端写入失败或断网：界面不能把未保存操作显示为成功。
- 同一天多次打卡、历史补记、跨月修改日期：统计必须和现网页规则一致。

---

## 文件结构

- Create `miniprogram/app.js`, `miniprogram/app.json`, `miniprogram/app.wxss`: 小程序入口、页面注册和全局样式。
- Create `miniprogram/pages/home/index.{js,json,wxml,wxss}`: 年卡总览、月度列表、历史记录、设置、打卡、导入导出交互。
- Create `miniprogram/utils/tracker.js`: 纯年卡计算与格式化规则。
- Create `miniprogram/services/cloud-data.js`: 云函数调用和本地缓存读写封装。
- Create `cloudfunctions/tracker/index.js` and `cloudfunctions/tracker/package.json`: 身份隔离的数据读写云函数。
- Create `miniprogram/config.example.js` or equivalent documented placeholder: 云环境 ID 配置说明，不含真实值。
- Create `README.md`: 微信开发者工具导入、云环境开通、集合初始化/权限、云函数部署、迁移与运行说明。
- Existing website files remain unchanged.

### Task 1: 小程序骨架与业务计算

**Files:**
- Create: `miniprogram/app.js`, `miniprogram/app.json`, `miniprogram/app.wxss`
- Create: `miniprogram/pages/home/index.js`, `index.json`, `index.wxml`, `index.wxss`
- Create: `miniprogram/utils/tracker.js`
- Modify: `project.config.json` (create minimal WeChat project settings with placeholder AppID)

**Interfaces:**
- `tracker.js` exports `DEFAULT_STATE`, `monthKeys(settings)`, `targetForMonth(settings, key)`, `summarize(state, today)`, `makeVisit(date, id, createdAt)`, `normalizeBackup(input)`.
- `normalizeBackup(input)` returns validated `{ settings, visits }` or throws a readable validation error.

- [ ] Implement the pure month, target, count, average cost, break-even, and normalization logic to match `app.js` existing rules.
- [ ] Build native home view containing today's check-in, statistics, monthly goals, break-even progress, month rows, and visit history.
- [ ] Wire interactions for check-in, date entry, edit/delete, monthly target edits, and settings modal using wx APIs.
- [ ] Provide minimal project configuration with a placeholder AppID and explain it must be replaced locally.
- [ ] Manually compare representative calculations against existing website behavior: defaults; zero target; same-day duplicates; visit count beyond break-even; changed month target.

### Task 2: Cloud identity, storage, and sync

**Files:**
- Create: `miniprogram/services/cloud-data.js`
- Create: `cloudfunctions/tracker/index.js`, `cloudfunctions/tracker/package.json`
- Modify: `miniprogram/app.js`, `miniprogram/pages/home/index.js`

**Interfaces:**
- Cloud function action names: `load`, `saveSettings`, `addVisit`, `updateVisit`, `deleteVisit`, `replaceAll`.
- Frontend service exports matching async methods; none accept a user ID.
- Cloud records use `owner` from `cloud.getWXContext().OPENID`; client-supplied owner fields are ignored.

- [ ] Initialize `wx.cloud` only when a non-empty environment ID is configured; show setup guidance if missing.
- [ ] Implement `load` to return the current caller's settings and visits, creating default settings if missing.
- [ ] Implement settings and visit mutations with owner scoping and input validation; return success only after cloud write succeeds.
- [ ] Implement `replaceAll` to validate a complete import, then replace only caller-owned settings and visits.
- [ ] Add local cache for last successful load; load cloud on app launch and foreground; use cache for read-only offline viewing.
- [ ] Surface cloud errors without optimistic success; retain the previous cached state on failures.
- [ ] Manually verify user scoping, missing environment behavior, cloud failures, and same-account reload from another device.

### Task 3: Backup migration and handoff documentation

**Files:**
- Modify: `miniprogram/pages/home/index.{js,wxml,wxss}`
- Modify: `miniprogram/services/cloud-data.js`
- Create: `README.md`

- [ ] Implement JSON export matching `{ app, version, exportedAt, settings, visits }` and use mini-program file APIs.
- [ ] Implement JSON selection, parsing, validation, record-count preview, and explicit replace confirmation before calling `replaceAll`.
- [ ] Keep cancellation and validation errors side-effect free; show completion only after cloud replacement succeeds.
- [ ] Document importing into WeChat Developer Tools, filling AppID/environment ID, creating `userSettings` and `visits` collections with client access disabled, deploying the cloud function, and using web JSON export to migrate.
- [ ] Manually verify valid export/import round trip, malformed files, empty records, cancel, and replacement of the signed-in account only.

## Coverage Check

- Native UI and interactions: Task 1.
- Cloud identity isolation, synchronization and cache/offline behavior: Task 2.
- Web JSON migration and configuration steps: Task 3.
- Existing web local behavior: preserved by adding separate mini-program files only.
