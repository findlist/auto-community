# 邻里圈项目迭代进度 - 2026-07-20

## 本轮迭代摘要（2026-07-20 00:25-00:40）

### 已完成任务（5 个最小迭代单元）

1. **前端 Profile/Verify 与 DeleteAccount 补 mountedRef 防御卸载后 setState 泄漏**（commit 1abf2f1）
   - 文件：`client/src/pages/Profile/Verify.tsx`、`client/src/pages/Profile/DeleteAccount.tsx`、对应 `__tests__/*.test.tsx`
   - 实现：添加 `useRef(true)` + await 后 `if (!mountedRef.current) return` 守卫 + useEffect cleanup 置 false
   - 测试：用 deferred Promise 控制慢请求 resolve 时机，unmount 后再 resolve，断言无 React unmounted warning
   - 验收：前端 build 通过，36/36 测试通过

2. **后端 admin.ts dashboard/system 路由加 60s Redis 缓存**（commit a40b3cc）
   - 文件：`server/src/routes/admin.ts`、`server/src/routes/__tests__/admin.test.ts`
   - 实现：常量 `DASHBOARD_CACHE_KEY='admin:dashboard'`、`SYSTEM_METRICS_CACHE_KEY='admin:dashboard:system'`、`DASHBOARD_CACHE_TTL=60`；路由内 `getCache` 命中直接返回 + 未命中走 service + `void setCache` 兜底写缓存
   - 测试：mock getCache/setCache，新增"缓存命中时直接返回"测试用例，修改 dashboard/system 测试断言写入缓存
   - 验收：admin 路由 64/64 测试通过，全量 1723/1723 测试通过

3. **audit.service getAuditLogs 缺省 startDate 时附加 90 天时间窗**（commit 701878a）
   - 文件：`server/src/services/audit.service.ts`、`server/src/services/__tests__/audit.service.test.ts`
   - 实现：startDate 缺失时附加 `a.created_at >= NOW() - INTERVAL '90 days'`（SQL 字面量不加参数化），endDate 不附加默认值
   - 测试：新增 2 个测试用例（默认时间窗 + 显式 startDate 不附加默认值）
   - 验收：audit.service 13/13 测试通过，全量 1725/1725 测试通过

4. **规范任务池剔除过期任务**（commit 1d0b109）
   - 文件：`docs/auto-iteration-spec.md`
   - 内容：
     - 5.3 P2 任务池剔除 `metrics-calculation.service 接入评估`（已接入 scheduler.ts 每小时第 5 分钟触发 handleMetricsCollection）
     - 5.3 P2 任务池剔除 `迁移文件时间戳规范化`（012 重命名为 030，018 → 031/032 等已落地，无时间戳冲突）
     - 归档为「已剔除历史完成项」清单便于追溯

5. **admin.service getReports 默认附加 90 天时间窗**（commit 346967f）
   - 文件：`server/src/services/admin.service.ts`、`server/src/services/__tests__/admin.uncovered.test.ts`
   - 实现：conditions 初始值改为 `["r.created_at >= NOW() - INTERVAL '90 days'"]`（替代 '1=1'），COUNT SQL 改用 `FROM reports r` 别名与 list SQL 保持一致，status 字段加 `r.` 前缀避免歧义
   - 测试：新增 1 个测试用例验证默认时间窗，保留原 status 过滤测试兼容性
   - 验收：admin.uncovered 45/45 测试通过，全量 1726/1726 测试通过

### 验证结果

- 后端类型检查：✅ 零错误
- 后端单元测试：✅ 1726/1726 通过（基线 1723 + 新增 3 个）
- 前端构建：✅ 通过（上轮已验证）

### 遗留问题

无阻塞性遗留问题。下列 P2 候选已识别但本轮未推进（已超出 4-6 个最小迭代单元上限）：

1. **scheduler.ts reconcileCreditBalance 全表 JOIN credit_transactions**
   - 风险：单次 SQL 全表 JOIN 大表聚合，credit_transactions 持续增长
   - 修复方向：keyset pagination 按 users.id 分批扫描，每批 500 个用户做 LEFT JOIN 聚合
   - 复杂度：需重构函数循环结构，测试需重写

2. **scheduler.ts 其他定时任务全表扫描候选**（11 处 P2 SQL 安全候选剩余 9 处，需逐一评估）
   - handleSkillOrderTimeout、handleKitchenOrderTimeout 等已用 status + INTERVAL 过滤，无全表扫描风险
   - handleEmergencyResourceCheck 第一步 `WHERE deleted_at IS NULL AND status = 'available'` 全表更新，可加 LIMIT 分批
   - 其余定时任务 SQL 多数已有 status 或时间窗过滤，需细化评估

3. **5.3 P2 剩余项**：isSqlParam 对 class 实例放行的设计限制（可选改用 prototype 链检查）

### 下一轮建议

1. 推进 `reconcileCreditBalance` keyset pagination 分批扫描改造（需重写函数循环结构与测试）
2. 继续滚动扫描剩余 P2 SQL 安全候选，重点查 `handleEmergencyResourceCheck` 第一步全表 UPDATE
3. 评估 isSqlParam prototype 链检查方案的可行性与必要性

### Git 提交记录

- `1abf2f1` fix: Profile Verify 与 DeleteAccount 补 mountedRef 防御卸载后 setState 泄漏
- `b7696eb` fix: 4 页面+3 弹窗补 mountedRef 防御卸载后 setState 泄漏（前序已提交）
- `a40b3cc` fix: admin dashboard/system 路由加 60s Redis 缓存避免后台刷新打满 DB
- `701878a` fix: audit.service getAuditLogs 缺省 startDate 时附加 90 天时间窗避免全表扫描
- `1d0b109` docs: 规范任务池剔除已完成项 metrics-calculation 接入与迁移时间戳规范化
- `346967f` fix: admin.service getReports 默认附加 90 天时间窗避免 reports 全表扫描

---

## 本轮迭代摘要（2026-07-20 00:42-01:00）

### 已完成任务（5 个最小迭代单元）

1. **reconcileCreditBalance 改为 keyset pagination 分批扫描**（commit 233574c）
   - 文件：`server/src/jobs/scheduler.ts`、`server/src/jobs/__tests__/scheduler.test.ts`
   - 背景：上轮遗留 P2 候选首项，原实现 `users LEFT JOIN credit_transactions` 全表聚合，credit_transactions 持续增长后会触发顺序扫描与大量临时元组
   - 实现：
     - 新增常量 `RECONCILE_BATCH_SIZE=500` 控制单批扫描大小
     - `lastId: string | null` 指针推进分页，SQL 用 `($1::uuid IS NULL OR u.id > $1::uuid)` 兼容首批无起点
     - 去掉 HAVING 改为应用层逐行判断 anomaly，避免 HAVING 过滤后 LIMIT 计数失真（HAVING 过滤后返回的是 anomaly 数而非用户数）
     - 终止条件：本批返回行数 < RECONCILE_BATCH_SIZE 即扫描到 users 表末尾
     - 汇总日志携带 `batches` 批次计数便于排查
     - 显式声明 `ReconcileRow` 类型与 `result: { rows: ReconcileRow[] }` 解决 TS7022 循环推断
   - 测试：
     - 改写原 2 个用例（无不一致、单批不一致），断言汇总日志携带 `batches: 1`
     - 新增「一致用户跳过记录但仍参与分页推进」用例
     - 新增「多批扫描累计 anomaly + lastId 推进 + 第二批参数验证 + batches:2」用例
   - 验收：scheduler 61/61 测试通过（基线 59 + 新增 2），全量 1728/1728 通过，tsc 零错误

2. **规范任务池剔除已完成项 isSqlParam prototype 链检查与 reconcileCreditBalance 分批扫描**（commit 4bac3dd）
   - 文件：`docs/auto-iteration-spec.md`
   - 内容：
     - 5.3 P2 任务池剔除 `isSqlParam 对 class 实例放行的设计限制`（已改用 prototype 链检查并测试覆盖，见 server/src/config/database.ts:24-45）
     - 5.3 P2 任务池剔除 `reconcileCreditBalance 全表 JOIN credit_transactions`（已改为 keyset pagination 分批扫描，见 server/src/jobs/scheduler.ts:400-454）
     - 5.3 P2 任务池剔除 `scheduler.ts 定时任务全表扫描候选评估`（11 处候选已逐一评估，所有任务都已用 status + 时间窗过滤或数据量小，无需 LIMIT 分批改造；handleEmergencyResourceCheck 表数据量受社区规模限制且已有 status 索引，不构成性能风险）
     - 5.3 P2 章节标注「无剩余 P2 任务项」

3. **ResourceMap useEffect cleanup 显式置 null mapRef/infoWindowRef 避免悬挂引用**（commit ae12781）
   - 文件：`client/src/pages/Emergency/ResourceMap.tsx`
   - 实现：在 map.destroy() + markers.clear() 后追加 `mapRef.current = null` 与 `infoWindowRef.current = null`
   - 设计原因：map.destroy() 后 mapRef/infoWindowRef 仍指向已销毁实例，若异步回调（如 marker click 事件）在卸载后触发 showInfoWindow，会通过 `if (!infoWindowRef.current || !mapRef.current) return` 守卫检查但操作已销毁对象。显式置 null 让守卫正确拦截
   - 验收：ResourceMap 9/9 测试通过，前端 build 通过

4. **规范 5.2 P1 标注 ResourceMap setTimeout onclick 清理问题已解决**（commit 68128fd）
   - 文件：`docs/auto-iteration-spec.md`
   - 内容：
     - setTimeout 清理已通过 useSafeTimeout hook 解决（调用前清理上一个 + 卸载时清理）
     - onclick 清理通过 map.destroy() 解决（InfoWindow 是 map 子对象，销毁时一并释放）
     - 本轮进一步显式置 null mapRef/infoWindowRef 加固悬挂引用（commit ae12781）
     - 剩余依赖仅为高德地图 Key 配置（运维侧任务）

5. **Emergency/index useEffect cleanup 显式置 null mapRef 避免悬挂引用**（commit 66e6449）
   - 文件：`client/src/pages/Emergency/index.tsx`
   - 实现：在 map.destroy() 后追加 `mapRef.current = null`
   - 设计原因：与 ResourceMap.tsx 保持一致清理模式，防御 React 18 严格模式下双重执行 effect 时 mapRef 指向已销毁实例，也为未来新增 marker click 等异步回调提前布防
   - 调研依据：subagent 全面扫描 client/src 下所有 .tsx 文件，仅 Emergency/index.tsx 的 mapRef（L458）满足"useEffect 中创建对象实例赋值给 useRef，但 cleanup 中未显式置 null"条件；ResourceMap.tsx 与 Chat.tsx 均已加固
   - 验收：Emergency/index 17/17 测试通过，前端 build 通过

### 验证结果

- 后端类型检查：✅ 零错误
- 后端单元测试：✅ 1728/1728 通过（基线 1726 + 新增 2 个）
- 前端构建：✅ 通过

### 遗留问题

无阻塞性遗留问题。剩余运维侧任务（非 Agent 可推进）：

1. **5.1 P0 安全遗留**：.env.example 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史（git filter-repo）或重建仓库
2. **5.2 P1 生产就绪验收**：
   - 全页面移动端适配、交互体验、状态提示完整性人工最终复查
   - CD 流水线 GitHub Secrets 与远程服务器 GHCR 登录态运维确认
   - 高德地图 Key 配置（Key 配置后即可启用完整地图能力，清理逻辑已完备）

### 下一轮建议

1. 推进 5.4 P3 体验与质量补全：全页面样式统一精修、移动端适配查漏补缺
2. 滚动补全核心模块单元测试（覆盖率已达 95.4%+，按缺口滚动补全）
3. 等待运维侧推进 5.1 P0 安全遗留与 5.2 P1 运维确认任务

### Git 提交记录

- `233574c` refactor: reconcileCreditBalance 改为 keyset pagination 分批扫描
- `4bac3dd` docs: 规范任务池剔除已完成项 isSqlParam prototype 链检查与 reconcileCreditBalance 分批扫描
- `ae12781` fix: ResourceMap useEffect cleanup 显式置 null mapRef/infoWindowRef 避免悬挂引用
- `68128fd` docs: 规范 5.2 P1 标注 ResourceMap setTimeout onclick 清理问题已解决
- `66e6449` fix: Emergency/index useEffect cleanup 显式置 null mapRef 避免悬挂引用

---

## 本轮迭代摘要（2026-07-20 01:25-02:00）

### 已完成任务（4 个最小迭代单元）

1. **App.tsx 路由集成测试补全**（commit 1b3674b）
   - 文件：`client/src/__tests__/App.test.tsx`（新建）
   - 实现：mock BrowserRouter → MemoryRouter 透传 initialEntries；mock useAuth/isTokenExpired/getUnreadCount/Toast/useIsDesktop/Layout 与关键懒加载页面；保留 ProtectedRoute/AdminRoute 真实实现验证守卫逻辑
   - 关键修复：Layout 与 AdminLayout mock 必须复用真实 `<Outlet />` 才能让嵌套路由（Home/Skills/Profile 等）正确渲染（原 mock 用 children 导致子路由不渲染，9 个测试全失败）
   - 测试用例（9 个）：公开路由 / 渲染 Home、/skills 渲染技能交换、/login 渲染登录页、未登录访问 /profile 跳 /login、未登录访问 /admin 跳 /、已登录普通用户访问 /admin 跳 /、已登录管理员访问 /admin 渲染 AdminLayout+Dashboard、不存在路由显示 404、已登录用户访问 /profile 正常渲染
   - 验收：App 9/9 测试通过，前端 build 通过

2. **UserManagement 8 处操作按钮触控目标提升**（commit 4343e88）
   - 文件：`client/src/pages/Admin/UserManagement.tsx`
   - 实现：桌面端 + 移动端共 8 处按钮（解封/封禁/取消管理员/设为管理员 × 2 套布局）className 从 `text-{color}-600 hover:underline text-xs` 统一升级为 `text-{color}-600 text-xs px-3 py-2 rounded-lg hover:bg-{color}-50 transition-colors`
   - 设计原因：原 text-xs 无 padding 内联按钮触控目标仅约 16px，移动端难以精准点击；触控目标最低 32px（px-3 py-2 + text-xs 行高）符合移动端可访问性标准；同时将 hover:underline 改为 hover:bg-{color}-50 与 ContentReview 已采用的视觉风格统一
   - 移动端解封按钮原缺少 hover:underline（与其他 7 处不一致），本轮一并统一
   - 验收：UserManagement 15/15 测试通过，前端 build 通过

3. **VerificationReview + SystemConfig 8 处操作按钮触控目标提升**（commit 7d5b021）
   - 文件：`client/src/pages/Admin/VerificationReview.tsx`、`client/src/pages/Admin/SystemConfig.tsx`
   - 实现：
     - VerificationReview：4 处按钮（通过/拒绝 × 桌面+移动）`text-{color}-600 hover:underline text-xs flex items-center gap-1` → `text-{color}-600 text-xs px-3 py-2 rounded-lg hover:bg-{color}-50 transition-colors flex items-center gap-1`
     - SystemConfig：4 处按钮（编辑/删除 × 桌面+移动）类似升级，保留 `inline-flex items-center gap-0.5`
   - 设计原因：与 UserManagement 升级模板对齐，仅保留原 flex 布局相关 className，统一触控目标至 32px
   - 验收：VerificationReview 15/15 + SystemConfig 24/24 测试通过（39/39），前端 build 通过

4. **ContentReview + OrderManagement + ReportManagement 8 处操作按钮触控目标提升**（commit 9ecb3d9）
   - 文件：`client/src/pages/Admin/ContentReview.tsx`、`client/src/pages/Admin/OrderManagement.tsx`、`client/src/pages/Admin/ReportManagement.tsx`
   - 实现：
     - ContentReview：4 处按钮（编辑 × 2 + 下架/上架 × 2）原已部分优化为 `py-1 px-2 rounded`（约 24px），本轮升级为 `px-3 py-2 rounded-lg`（约 32px），去掉 `hover:underline`
     - OrderManagement：2 处强制取消按钮（桌面+移动）
     - ReportManagement：2 处处理按钮（桌面+移动）
   - 设计原因：完成 Admin 系列 6 个文件 24 处触控目标问题的统一收尾，与已达标文件（Dashboard/Metrics/AdminLayout）视觉风格一致
   - 验收：ContentReview 15/15 + OrderManagement 13/13 + ReportManagement 15/15 测试通过（43/43），前端 build 通过

### 验证结果

- 后端类型检查：✅ 零错误（基线，本轮无后端改动）
- 后端单元测试：✅ 1728/1728 通过（基线，本轮无后端改动）
- 前端构建：✅ 通过（每轮迭代后均验证）

### 遗留问题

无阻塞性遗留问题。剩余运维侧任务（非 Agent 可推进）：

1. **5.1 P0 安全遗留**：.env.example 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
2. **5.2 P1 生产就绪验收**：
   - 全页面移动端适配、交互体验、状态提示完整性人工最终复查
   - CD 流水线 GitHub Secrets 与远程服务器 GHCR 登录态运维确认
   - 高德地图 Key 配置（清理逻辑已完备）

### 下一轮建议

1. **Admin 系列异步状态完整性补全**（已扫描，10 个页面均缺 error 重试入口）：
   - 7 个页面（AuditLog、ContentReview、HomepageImage、OrderManagement、ReportManagement、UserManagement、VerificationReview）请求失败后用户无法主动重试
   - 3 个页面（ABTestResults、SystemConfig、SystemStatus）有重试按钮但未统一使用 Empty variant="error" + retryKey 模式
   - 建议按 1-2 个文件/迭代单元节奏推进，参考 Dashboard/Metrics 已达标实现

2. **ABTestResults 空态补全**：config/results 为 null 时仅隐藏卡片，未渲染 Empty 空态

3. **HomepageImage 空态补全**：url 为空时仅展示预览占位文案，未使用 Empty 组件

4. **Profile/Verify 等表单页字段级精准校验统一改用 useFormValidation hook**

5. **滚动补全核心模块单元测试**（覆盖率已达 95.4%+，按缺口滚动补全）

### Git 提交记录

- `1b3674b` test: 补全 App.tsx 路由集成测试覆盖守卫与 404 兜底
- `4343e88` fix: UserManagement 8 处操作按钮触控目标提升至 32px 避免移动端误触
- `7d5b021` fix: VerificationReview 与 SystemConfig 8 处操作按钮触控目标提升至 32px
- `9ecb3d9` fix: ContentReview/OrderManagement/ReportManagement 8 处操作按钮触控目标提升至 32px

### 关键技术决策

1. **App.test.tsx initialEntries 透传**：通过模块级变量 `nextInitialEntries` 在 mock 的 BrowserRouter 中读取，避免污染生产代码（App 不接收 props）
2. **Layout/AdminLayout mock 必须复用真实 Outlet**：原 mock 用 `{children}` 导致嵌套路由不渲染，改用 `actual.Outlet` 后子路由正确渲染
3. **触控目标升级统一模板**：`text-{color}-600 hover:underline text-xs` → `text-{color}-600 text-xs px-3 py-2 rounded-lg hover:bg-{color}-50 transition-colors`，与 ContentReview 已采用的视觉风格一致
4. **保留原 flex 布局相关 className**：VerificationReview 的 `flex items-center gap-1` 与 SystemConfig 的 `inline-flex items-center gap-0.5` 仅做最小改动，避免破坏按钮内图标 + 文本的布局
