# 邻里圈自动迭代进度 — 2026-07-11

## 历史脉络
- 2026-07-09 11:30 调度：Phase 1 收尾 2 项 P0 任务（应急资源地图页、CD 流水线）全部落地验收通过
- 2026-07-09 13:51 调度：Phase 2 全部 8 项 P1 落地，自动切换至 Phase 3 队列
- 2026-07-09 17:25 调度：Phase 3 技术债清理，前端 any 收紧完结
- 2026-07-09 18:13 调度：Phase 3 P3 测试补全，Auth/Login 8 用例已补
- 2026-07-10 00:30 调度：修复 ForgotPassword 超时 + 补全 ResetPassword + 入库 Auth 玻璃态源码
- 2026-07-10 01:00 调度：补全 4 个测试缺口（FoodReview/HomepageImage/AdminLayout/Metrics）
- 2026-07-10 01:30 调度：补全 7 个测试文件（ProtectedRoute/AdminRoute/Toast/ErrorBoundary/ImageUpload/useFormValidation/useMediaQuery/useScrollReveal）
- 2026-07-10 续作调度：补全剩余未测试组件全覆盖，3 批共 8 个测试文件，前端测试 995 → 1180
- 2026-07-11 调度：后端测试目录 `no-explicit-any` 警告清零，3 批共 39 文件清理（services 16 + routes 18 + services 类型注解 5）
- 2026-07-11 续作调度：Phase 3 技术债清理 5 单元（flaky test 修复 + lint 规则统一 + any 防退化 + gitignore 完善）
- 2026-07-11 续作调度：数据库生产阻塞 BUG 修复 3 单元（deletion_requests 表补建 + credit_transactions.updated_at + messages 索引重复声明移除）
- 2026-07-11 续作调度：CD 流水线修复 6 单元（GHCR_OWNER 回退值 + docker-compose 填充 + 测试门禁 + 备份持久化 + 路由安全 + Nginx 硬性约束）

## 阶段判定
- Phase 1/Phase 2 均已完成（与上轮记录一致，无需重复开发）
- 当前阶段：Phase 3 技术债清理 + 测试补全
- 本轮聚焦：service 层 SQL 表/字段审计 + 3 个生产阻塞 BUG 修复

---

## 本轮迭代摘要（2026-07-11 续 — service 层 SQL 审计 + 3 个生产阻塞 BUG 修复 + 日志分级合理化）
- 健康度预检：后端 tsc ✅（零错误）| 后端 vitest 73 文件 1445/1445 ✅ | 前端 build ✅（7.82s 零错误零警告）
- 后端测试覆盖率复核：95.46% ✅（远超 70% 生产就绪标准），各模块覆盖率均健康
- 本轮完成 4 个最小迭代单元（3 个生产阻塞 BUG 修复 + 1 个日志分级技术债清理），4 次 git 提交均 push 到 origin/main：
  - `f239611 fix: 修复审计日志导出引用不存在的 metadata 字段 BUG`
  - `fd26b41 fix: 移除用户匿名化 SQL 中不存在的 id_card_hash 字段`
  - `2ddf785 fix: 补建 users.email 字段修复邮件通知通道阻塞 BUG`
  - `b38aafd refactor: 调整 AI 服务降级场景日志级别 error/warn 合理化`

### 审计工作：service 层 SQL 表/字段交叉比对
- 启动 search 子代理深度审计所有 service 生产代码（28 个文件 + scheduler.ts）中的 SQL 语句
- 与全部 25 个 .sql 迁移 + 关键 .ts 迁移文件交叉比对，识别 3 个严重生产阻塞 BUG
- 审计模式延续上轮 deletion_requests 和 credit_transactions.updated_at 的发现方式

### 最小迭代单元 1：修复 audit_logs.metadata 字段不存在 BUG
- 提交：`f239611`（已 push）
- 问题根因：admin.service.ts 第 1173 行导出 audit-logs 时 `SELECT ... metadata FROM audit_logs`，但 audit_logs 表（007_audit_log.sql）实际字段名为 `request_body`，无 metadata 字段。生产环境导出审计日志会报 `column "metadata" does not exist`，审计日志导出功能完全不可用
- 修复方案：SQL 中 `metadata` → `request_body`，columns 表头 `元数据` → `请求体` 保持语义一致
- 修改文件：[server/src/services/admin.service.ts](file:///e:/work/auto-community/server/src/services/admin.service.ts)

### 最小迭代单元 2：移除 users.id_card_hash 字段不存在 BUG
- 提交：`fd26b41`（已 push）
- 问题根因：data-deletion.service.ts 第 302 行 `UPDATE users SET ... id_card_hash = NULL`，但 users 表（001_init.sql）无 id_card_hash 字段（该字段在 verification_requests 表，012_verification.ts）。生产环境执行账号匿名化时会报 `column "id_card_hash" does not exist"`，账号注销功能完全不可用
- 修复方案：从 UPDATE users 中移除 `id_card_hash = NULL,`，因第 311-314 行已通过 `DELETE FROM verification_requests WHERE user_id = $1` 清理了 verification_requests 表中的 id_card_hash
- 修改文件：[server/src/services/data-deletion.service.ts](file:///e:/work/auto-community/server/src/services/data-deletion.service.ts)

### 最小迭代单元 3：补建 users.email 字段修复邮件通知通道阻塞 BUG
- 提交：`2ddf785`（已 push）
- 问题根因：notification-channels.ts 第 309 行 `SELECT email, phone FROM users WHERE id = $1` 查询用户联系信息用于邮件通知，但 users 表（001_init.sql）从未创建 email 字段。生产环境启用邮件通知通道时会报 `column "email" does not exist`，外部通知分发功能完全不可用
- 修复方案：新建迁移文件为 users 表补建 email 字段（VARCHAR(255)，可选，允许 NULL，不加 UNIQUE 约束以兼容历史数据）
- 修改文件：
  - [server/src/migrations/1704067200028_users_email.ts](file:///e:/work/auto-community/server/src/migrations/1704067200028_users_email.ts)（新建）
  - [database/migrations/026_users_email.sql](file:///e:/work/auto-community/database/migrations/026_users_email.sql)（新建）

### 最小迭代单元 4：AI 服务降级场景日志级别合理化
- 提交：`b38aafd`（已 push）
- 问题根因：ai.service.ts 中 7 处降级场景日志级别不合理：
  1. 第 343 行 `logger.debug` — A/B 测试变体分配失败，生产环境应可观测（debug 在 prod 不输出）
  2. 6 处 `logger.error` 用于"降级为类别匹配/关键词匹配/规则评分/默认值/空数组"场景 — 这些是"主流程失败但有降级方案，业务未中断"的场景，用 error 会在生产环境触发告警噪音，掩盖真正需要人工介入的故障
- 修复方案：
  - 第 343 行：`logger.debug` → `logger.warn`（A/B 测试分配失败在生产环境应记录）
  - 6 处降级场景：`logger.error` → `logger.warn`（业务降级不触发 error 告警）
- 日志分级复查结论：其他 service 文件（scheduler/backup/redis/map/group-order/storage-adapter/notification-channels/metrics/data-deletion）日志级别使用合理，无需调整
  - redis.ts 首次连接失败用 warn 合理：设计内降级，运行时错误已由 on('error') 监听
  - map.service.ts warn/error 区分有逻辑依据：warn=API返回错误状态，error=网络请求异常
- 修改文件：[server/src/services/ai.service.ts](file:///e:/work/auto-community/server/src/services/ai.service.ts)

## 验证结果
- 后端 `npx tsc --noEmit` ✅（零错误）
- 后端 `npx vitest run` ✅（73 文件 1445/1445 通过）
- 后端测试覆盖率 ✅（95.46%，远超 70% 生产就绪标准）
- 前端 `npm run build` ✅（7.53s，零错误零警告）

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页运行在降级模式（静态点位 + 列表）
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，需运维侧确认
- 迁移文件时间戳冲突（012 和 018 各有 2 个文件共享同一时间戳），不影响功能但不规范，修改时间戳可能导致迁移记录不一致，暂不处理

## 下一轮迭代建议
按规范优先级排序：
1. PostgreSQL 慢查询优化：对 P2 级低频查询补充索引（如 audit_logs 多条件动态过滤、time_transactions 按类型查询等）
2. 前端 `Record<string, any>` 收紧（如有剩余，参照后端清理模式）
3. 生产就绪最终复检（7 项验收标准全部达标后可判定生产就绪）
4. 日志分级改造复查（本轮已处理 ai.service.ts，其他 service 经核查合理）
