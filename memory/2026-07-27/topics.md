# 邻里圈项目迭代进度 - 2026-07-27

## 本轮迭代摘要（2026-07-27 第 4 轮）

承接 2026-07-27 第 3 轮 routes 层 req.body 字段白名单校验扫描 + time-bank createDispute evidence 字段校验补全，本轮进入 **Phase3 技术债清理** 下一站：service 层 SQL 注入面扫描 + admin /export/:type orderType 白名单校验补全。

本轮聚焦上轮 topics.md「下一轮建议」第 4.1 项「service 层 SQL 注入面扫描」，共完成 2 个任务（1 个纯调研 + 1 个代码改动）：

### 已完成任务（2 个迭代单元）

1. **service 层 SQL 注入面扫描**（纯调研，无代码改动）
   - 调研目标：确认所有动态 SQL 构造（`${fields.join(', ')}` / `${conditions.join(' AND ')}` / `${cfg.table}` 等模板插值）的字段名均来自白名单常量或硬编码字符串，而非用户输入，防止 SQL 注入
   - 调研方法：
     - Grep 扫描 `server/src/services/**` 下所有 `${...}` 模板插值（230 处）
     - 重点关注 `${fields.join}` / `${setClauses.join}` / `${updates.join}` UPDATE SET 拼接（9 处）+ `${conditions.join(' AND ')}` WHERE 拼接（13 处）+ `${config.table}` / `${cfg.table}` 表名插值（6 处）+ `'${truncUnit}'` 单字段插值（1 处）
     - 逐一读取每处动态 SQL 的上下文，确认字段名来源
   - 扫描结果（13 个 service 文件，22 处动态 SQL 构造，发现 1 处缺口）：

     | service 文件 | 动态 SQL 类型 | 字段名来源 | 安全性 |
     | --- | --- | --- | --- |
     | address.service.ts | UPDATE SET `${fields.join}` | fieldMap 硬编码常量 | ✅ |
     | admin.service.ts updateContent | UPDATE SET `${fields.join}` | config.editableFields 白名单 + isSqlParam type guard | ✅ |
     | admin.service.ts EXPORT_CONFIG | `${cfg.table}` / `${cfg.buyerColumn}` | ORDER_EXPORT_SUB_CONFIG 硬编码（但 orderType 未校验） | ⚠️ 缺口 |
     | emergency-resource.service.ts | UPDATE SET `${setClauses.join}` / INSERT `${fullColumns}` | pickResourceFields 白名单过滤 | ✅ |
     | kitchen.service.ts | UPDATE SET `${updates.join}` | 硬编码字段名（if 分支） | ✅ |
     | skill.service.ts | UPDATE SET `${fields.join}` | allowedFields 白名单 + isSqlParam type guard | ✅ |
     | time-bank.service.ts updateService | UPDATE SET `${fields.join}` | UPDATABLE_SERVICE_FIELDS 白名单 + 可疑字段告警 | ✅ |
     | user.service.ts | UPDATE SET `${fields.join}` | 硬编码字段名（if 分支） | ✅ |
     | metrics-collector.service.ts | `DATE_TRUNC('${truncUnit}', ...)` | ALLOWED_GRANULARITIES 白名单 + 防御性回退 'day' | ✅ |
     | audit.service.ts | WHERE `${conditions.join(' AND ')}` | 硬编码字段名（a.user_id/a.action 等） | ✅ |
     | admin.service.ts getUsers/getContent/getReports | WHERE `${whereClause}` | 硬编码字段名（deleted_at/status/created_at 等） | ✅ |
     | data-deletion.service.ts | WHERE `${whereClause}` | 硬编码字段名（dr.created_at/dr.status） | ✅ |
     | emergency.service.ts | WHERE `${where}` | 硬编码字段名（er.deleted_at/er.type/er.status） | ✅ |
     | group-order.service.ts | WHERE `${whereClause}` | 硬编码字段名（go.deleted_at/go.status） | ✅ |
     | kitchen-order.service.ts | WHERE `${whereClause}` | 硬编码字段名（ko.user_id/ko.seller_id/ko.status） | ✅ |
     | kitchen.service.ts | WHERE `${whereClause}` | 硬编码字段名（kp.type/kp.category/kp.title） | ✅ |
     | metrics-collector.service.ts | WHERE `${whereClause}` | 硬编码字段名（name/recorded_at） | ✅ |
     | emergency-resource.service.ts | WHERE `${whereClause}` | 硬编码字段名（deleted_at/type） | ✅ |

   - 关键发现：
     - **22 处动态 SQL 构造全部为白名单常量或硬编码字段名**：所有 UPDATE SET / WHERE / ORDER BY / 表名插值的字段名均来自硬编码常量或白名单过滤，无用户输入直接拼入 SQL
     - **3 种白名单模式并存**：
       - 模式 1：硬编码 fieldMap / if 分支（address/kitchen/user）—— 字段名直接写在代码里
       - 模式 2：白名单常量数组 + isSqlParam type guard（admin.updateContent / skill / time-bank）—— 字段名来自 const 数组，type guard 校验值类型
       - 模式 3：pickResourceFields 函数白名单过滤（emergency-resource）—— 字段名通过 ALLOWED_FIELDS.includes 校验
     - **CONTENT_CONFIG / ORDER_EXPORT_SUB_CONFIG 表名硬编码**：admin.service.ts 的 `${config.table}` / `${cfg.table}` 来自硬编码常量对象，键为 ContentType/ExportType 枚举，值为字符串字面量
     - **metrics truncUnit 白名单 + 防御性回退**：ALLOWED_GRANULARITIES 白名单校验，未匹配回退 'day'，避免 undefined 拼入 DATE_TRUNC
     - **1 处缺口**：admin.service.ts EXPORT_CONFIG.orders buildQuery 中 `cfg = ORDER_EXPORT_SUB_CONFIG[orderType]`，若 orderType 为非法值（如 `evil`），cfg 为 undefined，后续 `cfg.buyerColumn` 抛 TypeError → 500 错误（非 SQL 注入，但属输入校验缺口）
   - 验收：纯调研任务，无代码改动，无需 tsc/vitest/build 验收

2. **admin /export/:type orderType 白名单校验补全**（代码改动 + 测试，commit 1561ff2）
   - 调研目标：修复 service 层 SQL 注入面扫描发现的 1 处缺口 —— orderType 未校验导致非法值触发 500 错误
   - 文件：
     - `server/src/routes/admin.ts`（新增 ORDER_EXPORT_TYPES 常量 + handler 内加 orderType 白名单校验）
     - `server/src/services/admin.service.ts`（buildQuery + getExportData orders 分支加 `if (!cfg) throw new BadRequestError` 防御性校验）
     - `server/src/routes/__tests__/admin.test.ts`（新增 2 个用例：非法 orderType 返回 400 + 未传 orderType 正常通过）
   - 改动点：
     - **routes 层白名单前置拦截**：新增 `ORDER_EXPORT_TYPES = ['skill', 'kitchen', 'time_bank'] as const` 常量，与 service 层 ORDER_EXPORT_SUB_CONFIG 键集合对齐；handler 内 `if (orderType !== undefined && !ORDER_EXPORT_TYPES.includes(orderType as ...))` 校验，非法值返回 400 BAD_REQUEST
     - **service 层防御性校验（defense-in-depth）**：buildQuery 内 `if (!cfg) throw new BadRequestError('无效的订单类型')`，防止 service 被其他入口调用时传入非法 orderType；getExportData orders 分支同样加校验，与 buildQuery 风格一致
     - **与现有 type 校验风格对齐**：admin.ts /export/:type 路由已有 `if (!EXPORT_TYPES.includes(type as ExportType))` 手工校验，orderType 校验采用相同范式（手工 if + error 响应），保持代码风格一致
   - 测试同步更新：
     - 新增 2 个用例：
       - `GET /export/orders 非法 orderType 返回 400，不调用 service`（验证 HTTP 400 + code=BAD_REQUEST + service 未被调用）
       - `GET /export/orders 未传 orderType 时正常通过（回退 skill）`（验证 orderType 可选，未传时 service 层 filter.orderType || 'skill' 回退默认值）
   - 验收：
     - 后端 tsc --noEmit ✅ 通过
     - 后端 vitest run 全量通过 ✅（81 文件 1845 用例，含新增 2 个）
     - 前端无改动，基线保持

### 本轮总结（2 个迭代单元）

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| （13 个 service 文件，22 处动态 SQL） | SQL 注入面扫描（纯调研，无改动） | 无 commit |
| server/src/routes/admin.ts | 新增 ORDER_EXPORT_TYPES 常量 + handler 内 orderType 白名单校验 | 1561ff2 |
| server/src/services/admin.service.ts | buildQuery + getExportData orders 分支加防御性校验 | 1561ff2 |
| server/src/routes/__tests__/admin.test.ts | 新增非法 orderType 400 + 未传 orderType 正常用例 | 1561ff2 |

### 验证结果（本轮）

- 后端类型检查：✅ tsc --noEmit 通过
- 后端单元测试：✅ 81 文件 1845 用例全量通过（含新增 2 个）
- 前端构建：本轮无前端改动，基线保持

### 关键技术决策（本轮）

1. **SQL 注入面扫描的「全表盘点」方法论**：
   - 不孤立检查已知动态 SQL，而是先 Grep 全量 `${...}` 模板插值（230 处），再分类筛选 UPDATE SET / WHERE / 表名 / ORDER BY 等高危模式
   - 避免遗漏：仅检查「已知有动态 SQL 的位置」会漏掉「应该用参数化但用了插值」的位置；全表盘点可识别所有缺口
   - 调研结论：22 处动态 SQL 构造全部为白名单常量或硬编码字段名，仅 1 处输入校验缺口（orderType 未校验）
2. **3 种白名单模式的识别与归类**：
   - 模式 1（硬编码 fieldMap / if 分支）：最简单，字段名直接写在代码里，适合字段数少且固定的场景（address 4 字段、user 2 字段、kitchen 9 字段）
   - 模式 2（白名单常量数组 + isSqlParam type guard）：字段名来自 const 数组，type guard 校验值类型，适合字段数多且需统一校验的场景（admin.updateContent / skill 7 字段 / time-bank UPDATABLE_SERVICE_FIELDS）
   - 模式 3（pickResourceFields 函数白名单过滤）：字段名通过 ALLOWED_FIELDS.includes 校验，适合动态字段集合需函数式提取的场景（emergency-resource）
   - 三种模式均能保证字段名为受控常量，杜绝用户输入直接拼入 SQL
3. **orderType 缺口的「非 SQL 注入」定性**：
   - orderType 不直接拼入 SQL，而是通过 `ORDER_EXPORT_SUB_CONFIG[orderType]` 索引取硬编码值
   - 非法 orderType 不会导致 SQL 注入，但会导致 cfg 为 undefined，后续 `cfg.buyerColumn` 抛 TypeError → 500 错误
   - 属于输入校验缺口而非 SQL 注入漏洞，但同样需要修复（避免 500 错误 + 信息泄露）
4. **orderType 校验的「routes 前置 + service 防御」双层范式**：
   - routes 层白名单前置拦截：与 type 校验风格一致（手工 if + error 响应），非法值返回 400 而非 500
   - service 层防御性校验：buildQuery + getExportData orders 分支均加 `if (!cfg) throw new BadRequestError`，防止 service 被其他入口调用时传入非法 orderType
   - 与 time-bank createDispute evidence 校验范式一致：routes 层校验结构（isArray），service 层校验内容（validateImageUrls 白名单）
5. **测试用例「未传 orderType 正常通过」的重要性**：
   - 仅测非法值返回 400 无法验证「orderType 可选」语义
   - 补测「未传 orderType 时正常通过（回退 skill）」确认 orderType 为可选参数，未传时 service 层 `filter.orderType || 'skill'` 回退默认值
   - 与现有「GET /export/orders 透传 orderType 筛选参数」用例形成「合法值 / 非法值 / 未传」三态完整覆盖

### Git 提交记录（本轮）

- `1561ff2` fix: 补全 admin /export/:type orderType 白名单校验（routes 层前置拦截 + service 层防御性校验）

### 遗留问题（本轮）

无阻塞性遗留问题。剩余技术债清理项：

1. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：
   - 5.1 P0 安全遗留：.env 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
   - 5.2 P1 生产就绪验收：全页面移动端适配、CD 流水线 GitHub Secrets、高德地图 Key 配置等运维侧确认

### 下一轮建议（本轮）

继续推进 Phase3 技术债清理：

1. **service 层 SQL 注入面已确认无 SQL 注入风险**：本轮扫描确认 22 处动态 SQL 构造全部为白名单常量或硬编码字段名，仅 1 处输入校验缺口（orderType，已修复），无需继续扫描
2. **可选下一站**（按优先级）：
   - 2.1 routes 层 req.body 字段类型校验补全扫描：确认所有 POST/PUT 路由的 req.body 字段均有类型校验（isString/isInt/isBoolean/isArray），避免非法类型穿透到 service 层
   - 2.2 service 层错误处理边界复核：抽查关键 service 的 catch 块，确认错误类型正确（NotFoundError/PermissionDeniedError/BadRequestError 等），避免抛出 500 错误
   - 2.3 routes 层 req.params 字段校验扫描：确认所有带路径参数的路由均使用 uuidParam 或 enumParam 前置校验，避免非法 id 穿透到 service 层
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）

---

## 上轮迭代摘要（2026-07-27 第 3 轮）

承接 2026-07-27 第 2 轮 routes 层 category 长度校验补全 + service 层兜底校验复核，本轮进入 **Phase3 技术债清理** 下一站：service 层 sanitizeObject 清洗覆盖面扫描 + service 层事务边界复核 + routes 层 req.body 字段白名单校验扫描。

本轮聚焦上轮 topics.md「下一轮建议」第 3 项「可选下一站」的 3.1、3.2、3.3 三个子项，共完成 3 个任务（2 个纯调研 + 1 个代码改动）：

### 已完成任务（3 个迭代单元）

1. **service 层 sanitizeObject 清洗覆盖面扫描**（纯调研，无代码改动）
   - 调研目标：确认所有用户输入的富文本字段（title/description/content/address/name 等）入库前均已调用 sanitizeObject/sanitizeXss 清洗，防止存储型 XSS
   - 调研方法：
     - Grep 扫描 `server/src/services/**` 下所有 `sanitizeObject|sanitizeStringValues|sanitizeXss` 调用位置（100+ 处）
     - Grep 扫描所有 `INSERT INTO|UPDATE ... SET` 语句（100+ 处）
     - 逐一比对每个 INSERT/UPDATE 的字段与 sanitize 调用，识别未清洗的富文本字段
   - 扫描结果（22 个 service 文件，全部覆盖，**无缺口**）：

     | service 文件 | 写入表 | 富文本字段 | 清洗方式 |
     | --- | --- | --- | --- |
     | ab-test.service.ts | ab_test_results | metadata | sanitizeStringValues ✅ |
     | admin.service.ts | site_settings/reports/credit_transactions | value/description/reason | sanitizeObject+sanitizeXss ✅ |
     | address.service.ts | delivery_addresses | recipient/address | sanitizeObject ✅ |
     | ai.service.ts | post_embeddings | 内部生成 | 无需清洗 ✅ |
     | audit.service.ts | audit_logs | action/resourceType/userAgent/errorMessage/requestBody | sanitizeXss ✅ |
     | auth.service.ts | users/credit_transactions | nickname | sanitizeXss ✅ |
     | credit.service.ts | credit_transactions | description（内部生成） | 无需清洗 ✅ |
     | data-deletion.service.ts | deletion_requests | reason | sanitizeXss ✅ |
     | emergency-resource.service.ts | emergency_resources | name/description/address | sanitizeObject ✅ |
     | emergency.service.ts | emergency_requests/emergency_responses/reviews/false_reports | title/description/address/message/review/reason/resolution | sanitizeObject+sanitizeXss ✅ |
     | group-order.service.ts | group_orders/group_order_participants | title/description/address/reason | sanitizeObject+sanitizeXss ✅ |
     | kitchen-order.service.ts | kitchen_orders/reviews | remark/deliveryAddress/content | sanitizeXss ✅ |
     | kitchen.service.ts | kitchen_posts | title/description/pickupLocation | sanitizeObject ✅ |
     | message.service.ts | messages | content | sanitizeXss ✅ |
     | metrics-collector.service.ts | metrics | name/value/tags（内部生成） | 无需清洗 ✅ |
     | notification.service.ts | notifications | title/content | sanitizeXss ✅ |
     | reputation.service.ts | users | reputation_score（内部计算） | 无需清洗 ✅ |
     | review.service.ts | reviews | content | sanitizeXss ✅ |
     | skill-order.service.ts | skill_orders/reviews/false_reports/service_disputes | review/reason/resolution | sanitizeXss ✅ |
     | skill.service.ts | skill_posts | title/description/address | sanitizeObject ✅ |
     | time-bank.service.ts | time_services/time_orders/reviews/time_transactions/family_bindings/service_disputes | title/description/address/review/remark/relationship/reason | sanitizeObject+sanitizeXss ✅ |
     | user.service.ts | users/verification_requests | nickname/real_name | sanitizeXss ✅ |

   - 关键发现：
     - **22 个 service 文件全部覆盖，无未清洗的富文本字段**：所有用户输入的 title/description/content/address/name/reason/review/remark/relationship 等字段均已通过 sanitizeObject 或 sanitizeXss 清洗
     - **清洗方式分层设计合理**：sanitizeObject 用于具名字段（如 title/description/address），sanitizeXss 用于单字段调用（如 reason/review），sanitizeStringValues 用于动态字段名场景（如 ab-test metadata），三种工具函数分工清晰
     - **内部生成字段无需清洗**：credit_transactions.description（'注册赠送时间币'等）、metrics name/value/tags、post_embeddings embedding 等内部生成字段未清洗，符合预期
     - **create + update 入口双清洗**：kitchen.service.ts、skill.service.ts、emergency-resource.service.ts、time-bank.service.ts、address.service.ts 等均 create 和 update 双入口清洗，避免 PUT 路由绕过清洗
   - 验收：纯调研任务，无代码改动，无需 tsc/vitest/build 验收

2. **service 层事务边界复核**（纯调研，无代码改动）
   - 调研目标：确认关键写操作（如 emergency.service createRequest+recordEvent、time-bank.service transfer+记录流水、admin.service 强制取消订单+退款）是否使用 transaction 包裹，保证数据一致性
   - 调研方法：
     - Grep 扫描 `server/src/services/**` 下所有 `transaction(async` 调用位置（42 处）
     - Grep 扫描所有 `INSERT INTO|UPDATE ... SET` 语句，识别多 SQL 写操作
     - 逐一比对多 SQL 写操作是否用 transaction 包裹，识别事务缺口
   - 复核结果（42 处 transaction 调用，覆盖所有多 SQL 写操作，**无缺口**）：

     | service 文件 | transaction 调用数 | 关键事务场景 |
     | --- | --- | --- |
     | address.service.ts | 4 | 创建/更新/删除地址 + 默认地址切换 |
     | admin.service.ts | 4 | 强制取消技能/厨房订单（退款+扣回+恢复份数）+ 审核认证 |
     | auth.service.ts | 1 | 注册（创建用户+赠送积分+流水） |
     | data-deletion.service.ts | 2 | 注销申请审批 + 数据清理 |
     | emergency.service.ts | 3 | 创建响应（INSERT+UPDATE status）+ 完成响应 + 审核虚假举报 |
     | group-order.service.ts | 5 | 创建拼单+发起人参与+计数 / 加入/退出/取消/完成 |
     | kitchen-order.service.ts | 4 | 下单（扣库存+INSERT）/ 确认 / 完成+评价 / 取消+退款 |
     | review.service.ts | 2 | 创建评价 + 更新信誉分 |
     | skill-order.service.ts | 7 | 创建/接受/拒绝/完成/取消/评价/申诉 |
     | time-bank.service.ts | 8 | 完成订单+结算+评价+流水 / 转账+流水 / 捐赠+流水 / 家庭绑定/解绑/拒绝 / 申诉 |
     | user.service.ts | 1 | 提交认证（INSERT verification_requests+UPDATE users.verify_status） |

   - 关键发现：
     - **42 处 transaction 调用覆盖所有多 SQL 写操作**：所有涉及 2 条及以上 SQL 写操作的关键方法均已用 transaction 包裹
     - **行锁设计完善**：admin.service.ts forceCancelSkillOrder/forceCancelKitchenOrder、emergency.service.ts resolveFalseReport、credit.service.ts freezeCredits/unfreezeCredits/settleCredits 等均使用 `SELECT ... FOR UPDATE` 行锁，防止并发双花与重复处理
     - **credit.service.ts 采用 client 注入模式**：freezeCredits/unreezeCredits/settleCredits 等方法接收 `client: PoolClient` 参数，由调用方事务内调用，避免嵌套事务，设计良好
     - **单条 INSERT/UPDATE 无需事务**：emergency.service.ts createRequest（单条 INSERT）、message.service.ts sendMessage（单条 INSERT）、notification.service.ts notify（单条 INSERT）、kitchen.service.ts createPost（单条 INSERT）、skill.service.ts createPost（单条 INSERT）等单条写操作无需事务包裹，符合预期
     - **emergency.service.ts createFalseReport 是单条 INSERT 无需事务**：举报记录仅 INSERT 一条记录，无关联更新，无需事务
   - 验收：纯调研任务，无代码改动，无需 tsc/vitest/build 验收

3. **routes 层 req.body 字段白名单校验扫描 + time-bank createDispute evidence 字段校验补全**（代码改动 + 测试，commit 52ef56f）
   - 调研目标：确认所有 POST/PUT 路由的 req.body 字段均经过 express-validator 校验，避免越权字段写入（如 is_admin、credit_balance 等敏感字段）
   - 调研方法：
     - Grep 扫描 `server/src/routes/**` 下所有 `req.body` 用法（82 处）
     - 逐一比对每个 req.body 字段解构与 validate 中间件的 body() 校验链，识别未校验字段
   - 扫描结果（11 个 routes 文件，发现 1 处缺口）：
     - **address.ts / auth.ts / emergency.ts / kitchen.ts / skills.ts / time-bank.ts / users.ts / admin.ts / ab-test.ts / ai.ts / reports.ts / messages.ts**：大部分 req.body 字段已通过 body() 校验链覆盖
     - **admin.ts:334 updateContent**：req.body 整体透传，但 service 层有 `config.editableFields` 白名单 + `isSqlParam` type guard + `sanitizeObject` 三重防御，安全性足够，无需 routes 层重复校验
     - **emergency.ts:277/291 create/update resource**：req.body 整体透传，但 service 层有 `pickResourceFields` 白名单过滤，安全性足够
     - **time-bank.ts:487 createDispute**：**发现缺口** —— `evidence` 字段在 req.body 中解构后直接传入 service 层，routes 层未校验 isArray，service 层未校验 validateImageUrls
   - 缺口修复（time-bank createDispute evidence 字段）：
     - 文件：
       - `server/src/routes/time-bank.ts`（POST /disputes 新增 `body('evidence').optional().isArray()` 校验）
       - `server/src/services/time-bank.service.ts`（createDispute 新增 `validateImageUrls(evidence)` 调用）
       - `server/src/routes/__tests__/time-bank.test.ts`（新增 422 防御用例 + 修正现有用例 evidence 值为合法 /uploads/ 路径）
       - `server/src/services/__tests__/time-bank.service.test.ts`（新增 2 个用例：URL 白名单拦截 + 空数组透传）
     - 改动点：
       - **routes 层 isArray 前置校验**：与 createService images 字段范式对齐，routes 层只校验结构（数组），service 层校验内容（URL 白名单）
       - **service 层 validateImageUrls 白名单校验**：evidence 是用户上传的图片 URL 数组，未校验会允许外链任意域名图片，可能被恶意用户用于追踪访问者 IP 或注入恶意内容；validateImageUrls 强制仅允许 /uploads/ 相对路径或白名单 HTTPS 域名
       - **现有测试用例修正**：原「正常创建争议」用例的 evidence 值 `['ev-1']` 不是合法图片 URL（不以 /uploads/ 开头，也不是 HTTPS URL），加了 validateImageUrls 后会失败，修正为 `['/uploads/ev-1.png']`
     - 测试同步更新：
       - routes 层新增 1 个 422 防御用例：`evidence 非数组时返回 422，不调用 service`（验证 HTTP 422 + service 未被调用）
       - service 层新增 2 个用例：
         - `evidence URL 不合法时抛 BadRequestError，不写入 DB`（验证仅 SELECT 被调用，INSERT 未被调用）
         - `evidence 为空数组时正常通过`（验证 validateImageUrls 对空数组直接返回，不触发校验）
     - 验收：
       - 后端 tsc --noEmit ✅ 通过
       - 后端 vitest run 全量通过 ✅（81 文件 1843 用例，含新增 3 个）
       - 前端无改动，基线保持

### 本轮总结（3 个迭代单元）

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| （22 个 service 文件） | sanitizeObject 清洗覆盖面扫描（纯调研，无改动） | 无 commit |
| （11 个 service 文件） | 事务边界复核（纯调研，无改动） | 无 commit |
| server/src/routes/time-bank.ts | POST /disputes 新增 evidence isArray 校验 | 52ef56f |
| server/src/services/time-bank.service.ts | createDispute 新增 validateImageUrls 校验 | 52ef56f |
| server/src/routes/__tests__/time-bank.test.ts | 新增 422 防御用例 + 修正现有用例 evidence 值 | 52ef56f |
| server/src/services/__tests__/time-bank.service.test.ts | 新增 URL 白名单拦截 + 空数组透传用例 | 52ef56f |

### 验证结果（本轮）

- 后端类型检查：✅ tsc --noEmit 通过
- 后端单元测试：✅ 81 文件 1843 用例全量通过（含新增 3 个）
- 前端构建：本轮无前端改动，基线保持

### 关键技术决策（本轮）

1. **sanitizeObject 清洗覆盖面扫描的「全表盘点」方法论**：
   - 不孤立检查每个 service，而是先 Grep 全量 `sanitizeObject|sanitizeXss|sanitizeStringValues` 调用位置，再 Grep 全量 `INSERT INTO|UPDATE ... SET` 语句，最后交叉比对
   - 避免遗漏：仅检查「已知有 sanitize 的位置」会漏掉「应该有但没有」的位置；全表盘点可识别所有缺口
   - 调研结论：22 个 service 文件全部覆盖，无未清洗的富文本字段，证明历史清洗改造已完整落地
2. **事务边界复核的「多 SQL 写操作」聚焦**：
   - 单条 INSERT/UPDATE 天然原子，无需事务；事务的核心价值在多 SQL 写操作的一致性
   - 复核聚焦「2 条及以上写操作」的方法：forceCancelSkillOrder（UPDATE order+UPDATE users+INSERT transactions）、createGroupOrder（INSERT group_orders+INSERT participants+UPDATE count）等
   - 复核结论：42 处 transaction 调用覆盖所有多 SQL 写操作，行锁设计完善，credit.service.ts 采用 client 注入模式避免嵌套事务
3. **routes 层 req.body 字段白名单校验的「service 层兜底」识别**：
   - admin.ts:334 updateContent 与 emergency.ts:277/291 create/update resource 虽 routes 层未做完整 body 校验，但 service 层有白名单 + type guard + sanitize 三重防御，安全性足够
   - 避免过度工程化：动态字段场景（4 种内容类型 × 7-8 字段）在 routes 层写白名单会冗长且重复维护，service 层兜底是合理设计
   - time-bank.ts:487 createDispute evidence 是真实缺口：service 层无白名单过滤，evidence 数组直接写入 DB，必须补 routes + service 双层校验
4. **evidence 校验的「routes 结构 + service 内容」分层范式**：
   - 与 createService images 字段范式对齐：routes 层 `body('evidence').optional().isArray()` 校验结构，service 层 `validateImageUrls(evidence)` 校验内容
   - routes 层只校验结构避免重复维护 URL 白名单（白名单在 validateImageUrls 内通过 env.IMAGES_WHITELIST_DOMAINS 配置）
   - service 层校验内容确保所有图片 URL 入口（create/update/dispute）统一走 validateImageUrls
5. **测试用例「不调用 service」与「不写入 DB」双层断言**：
   - routes 层 422 用例：`expect(mockCreateDispute).not.toHaveBeenCalled()` 验证前置拦截生效
   - service 层 URL 白名单用例：`expect(mockQuery).toHaveBeenCalledTimes(1)` 验证仅 SELECT 被调用，INSERT 未被调用
   - 与上轮 category 长度校验的测试范式一致，确保校验中间件确实在路由层短路返回

### Git 提交记录（本轮）

- `52ef56f` fix: 补全 time-bank createDispute evidence 字段校验（routes 层 isArray + service 层 validateImageUrls 白名单）

### 遗留问题（本轮）

无阻塞性遗留问题。剩余技术债清理项：

1. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：
   - 5.1 P0 安全遗留：.env 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
   - 5.2 P1 生产就绪验收：全页面移动端适配、CD 流水线 GitHub Secrets、高德地图 Key 配置等运维侧确认

### 下一轮建议（本轮）

继续推进 Phase3 技术债清理：

1. **service 层 sanitize 清洗覆盖面已确认无缺口**：本轮扫描确认 22 个 service 文件全部覆盖，无需继续扫描
2. **service 层事务边界已确认无缺口**：本轮复核确认 42 处 transaction 调用覆盖所有多 SQL 写操作，无需继续复核
3. **routes 层 req.body 字段白名单校验已收尾**：本轮扫描确认 11 个 routes 文件除 time-bank createDispute evidence（已修复）外全部覆盖，admin.updateContent / emergency.resource 等 req.body 整体透传场景由 service 层白名单兜底，无需继续补全
4. **可选下一站**（按优先级）：
   - 4.1 service 层 SQL 注入面扫描：抽查关键 service 的动态 SQL 构造（如 admin.updateContent 的 `${fields.join(', ')}`、address.update 的 `${fields.join(', ')}`），确认字段名均来自白名单常量而非用户输入
   - 4.2 routes 层 req.body 字段类型校验补全扫描：确认所有 POST/PUT 路由的 req.body 字段均有类型校验（isString/isInt/isBoolean/isArray），避免非法类型穿透到 service 层
   - 4.3 service 层错误处理边界复核：抽查关键 service 的 catch 块，确认错误类型正确（NotFoundError/PermissionDeniedError/BadRequestError 等），避免抛出 500 错误
5. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）

---

## 上轮迭代摘要（2026-07-27 第 2 轮）

承接 2026-07-27 第 1 轮 routes 层字符串查询参数长度校验收尾（search/keyword 三处），本轮进入 **Phase3 技术债清理** 下一站：routes 层 category 查询参数长度校验补全 + service 层兜底校验复核。

本轮聚焦上轮 topics.md「下一轮建议」第 1 项「routes 层字符串查询参数长度校验收尾扫描」的延伸 + 第 2 项「service 层兜底校验复核」，共完成 2 个任务：
1. 扫描所有 routes 的 `req.query.*` 用法后，发现 3 处自由文本 category 查询参数无长度校验（代码改动 + 测试）
2. service 层兜底校验复核：抽查 9 个关键 service 的 getById 方法，确认全部保留 NotFoundError 兜底（纯调研，无代码改动）

### 已完成任务（2 个最小迭代单元）

1. **routes 层 category 查询参数长度校验补全（kitchen/skills/time-bank 三处，对齐 VARCHAR(50) schema）**（commit 7cd2551）
   - 文件：
     - `server/src/routes/kitchen.ts`（/posts category 加 50 字符上限）
     - `server/src/routes/skills.ts`（/posts category 加 50 字符上限）
     - `server/src/routes/time-bank.ts`（/services category 加 50 字符上限 + import 补 queryStringLength）
     - `server/src/routes/__tests__/kitchen.test.ts`（新增 422 防御用例）
     - `server/src/routes/__tests__/skills.test.ts`（新增 422 防御用例）
     - `server/src/routes/__tests__/time-bank.test.ts`（新增 422 防御用例）
   - 改动点：
     - **扫描全 routes 的 req.query 用法**：36 处 req.query 解构中，识别出 3 处自由文本 category 查询参数无长度校验（kitchen.ts /posts、skills.ts /posts、time-bank.ts /services），其余均为 UUID/枚举/数字/日期参数，已有校验或由 service 层兜底
     - **3 处 category 补 queryStringLength('category', 50)**：
       - 长度上限 50 对齐数据库 schema（skill_posts.category / kitchen_posts.category / time_services.category 均为 VARCHAR(50)）
       - 超长 category 即使穿透到 service 层也无法命中任何记录（DB schema 约束），属无效查询，前置拦截避免 DB 资源浪费
       - 与 keyword 的 100 字符形成差异化：keyword 是搜索关键词（可能含多个词，需更长冗余），category 是分类名（受 DB schema 约束，50 字符足够）
     - **time-bank.ts import 补 queryStringLength**：原 import 为 `{ getPagination, validate, uuidParam, enumQuery }`，补全为 `{ getPagination, validate, uuidParam, enumQuery, queryStringLength }`
   - 测试同步更新：
     - 三个 routes 测试文件各新增 1 个 422 防御用例（共 3 个）：
       - kitchen.test.ts: `category 超长（>50 字符）返回 422，不调用 service`
       - skills.test.ts: `category 超长（>50 字符）返回 422，不调用 service`
       - time-bank.test.ts: `category 超长（>50 字符）返回 422，不调用 service`
     - 每个用例验证两点：① HTTP 状态码为 422 ② service 方法未被调用（确认前置拦截生效）
   - 验收：
     - 后端 tsc --noEmit ✅ 通过
     - 后端 vitest run 全量通过 ✅（81 文件 1840 用例，含新增 3 个）
     - 前端无改动，基线保持

2. **service 层兜底校验复核（纯调研，无代码改动，无 commit）**
   - 调研目标：确认本轮 routes 层前置校验补全（category 长度）未替代 service 层防御，关键 getById 方法仍保留 NotFoundError 兜底，保证「前置校验 + service 兜底」双层防御完整
   - 调研方法：Grep 扫描 `server/src/services/**` 下所有 `throw new NotFoundError` 与 `async function (get|find)\w*ById` 定义，逐一比对 8 个核心 getById 方法是否保留兜底
   - 复核结果（8 个核心 getById 方法 + 1 个辅助方法，全部保留 NotFoundError 兜底）：

     | service 文件 | 方法 | 兜底位置 | NotFoundError 文案 |
     | --- | --- | --- | --- |
     | user.service.ts | getUserById (L116) | L124 | '用户' |
     | user.service.ts | getUserProfile (辅助) | L209/L281 | '用户' |
     | skill.service.ts | getPostById (L170) | L181 | '技能帖子' |
     | skill.service.ts | updatePost (前置) | L199/L251 | '技能帖子' |
     | kitchen.service.ts | getById (L193) | L206/L239/L334 | '美食' |
     | time-bank.service.ts | getServiceById (L347) | L359/L417/L488 | '服务' |
     | emergency.service.ts | getRequestById (L345) | L355/L428/L537/L631/L707 | '求助信息'/'响应记录' |
     | emergency-resource.service.ts | getResourceById (L141) | L148/L211/L248 | '应急资源' |
     | group-order.service.ts | getById (L437) | L447/L486/L575 | '拼单' |
     | skill-order.service.ts | getOrderById (L581) | L595 | '订单' |

   - 关键发现：
     - **8 个核心 getById 方法全部保留 NotFoundError 兜底**：路由层前置校验（如 category 长度）只是第一道防线，service 层兜底校验仍是独立的第二道防线，两层防御无替代关系
     - **service 层 NotFoundError 文案统一为业务实体名**（'用户'/'技能帖子'/'美食'/'服务'/'求助信息'/'应急资源'/'拼单'/'订单'），便于前端通过 message 字段区分错误来源
     - **部分 service 在 update/delete/状态变更等方法中也保留前置 NotFoundError 校验**（如 kitchen.service L239、emergency-resource.service L211、emergency.service L537）：避免对不存在资源做无意义 UPDATE，与 getById 兜底形成一致性防御
   - 验收：
     - 纯调研任务，无代码改动，无需 tsc/vitest/build 验收
     - 复核结果记录于本轮 topics.md，作为后续 routes 层校验补全的安全保障依据

### 本轮总结（2 个迭代单元）

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| server/src/routes/kitchen.ts | /posts category 加 50 字符上限 | 7cd2551 |
| server/src/routes/skills.ts | /posts category 加 50 字符上限 | 7cd2551 |
| server/src/routes/time-bank.ts | /services category 加 50 字符上限 + import 补全 | 7cd2551 |
| server/src/routes/__tests__/kitchen.test.ts | 新增 422 防御用例 | 7cd2551 |
| server/src/routes/__tests__/skills.test.ts | 新增 422 防御用例 | 7cd2551 |
| server/src/routes/__tests__/time-bank.test.ts | 新增 422 防御用例 | 7cd2551 |
| （service 层 8 个文件） | 兜底校验复核（纯调研，无改动） | 无 commit |

### 验证结果（本轮）

- 后端类型检查：✅ tsc --noEmit 通过
- 后端单元测试：✅ 81 文件全量通过（1840 用例，含新增 3 个）
- 前端构建：本轮无前端改动，基线保持

### 关键技术决策（本轮）

1. **category 长度上限对齐 DB schema VARCHAR(50) 而非默认 100**：
   - skill_posts.category / kitchen_posts.category / time_services.category 均为 VARCHAR(50)
   - 超长 category 即使穿透到 service 层也无法命中任何记录（DB schema 约束），属无效查询
   - 与 keyword 的 100 字符形成差异化：keyword 是搜索关键词（ILIKE 模糊匹配，可能含多个词），category 是分类名（= 精确匹配，受 DB schema 约束）
   - 对齐 DB schema 的好处：前端可从 DB schema 推导查询参数长度上限，保持一致性
2. **扫描全 routes 的 req.query 用法而非孤立修补**：
   - 用 Grep 扫描所有 routes 的 `req.query` 用法（36 处），逐一分类：UUID（service 层校验兜底）/ 枚举（enumQuery/enumParam 白名单）/ 数字（parseInt）/ 日期（service 层校验）/ 自由文本（需补长度）
   - 仅 kitchen.ts /posts category、skills.ts /posts category、time-bank.ts /services category 三处自由文本无长度校验，其余均已覆盖
   - 避免遗漏，杜绝「修一处漏一处」的碎片化修补
3. **测试用例验证「不调用 service」的重要性**（与上轮范式一致）：
   - 仅断言 HTTP 422 状态码无法验证「前置拦截」是否生效
   - 同步断言 `mockXxxService.not.toHaveBeenCalled()` 确认 service 层未被调用，验证校验中间件确实在路由层短路返回
4. **service 层兜底校验复核的「纯调研」定位**：
   - 调研目标聚焦「确认前置校验未替代 service 层防御」，而非「补充 service 层防御」
   - 复核结果：8 个核心 getById 方法全部保留 NotFoundError 兜底，无需补改
   - 调研结论记录于 topics.md，作为后续 routes 层校验补全的安全保障依据，避免后续迭代误以为「routes 层有校验就足够」而移除 service 层兜底

### Git 提交记录（本轮）

- `7cd2551` fix: routes 层 category 查询参数长度校验补全（kitchen/skills/time-bank 三处，对齐 VARCHAR(50) schema）

### 遗留问题（本轮）

无阻塞性遗留问题。剩余技术债清理项：

1. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：
   - 5.1 P0 安全遗留：.env 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
   - 5.2 P1 生产就绪验收：全页面移动端适配、CD 流水线 GitHub Secrets、高德地图 Key 配置等运维侧确认

### 下一轮建议（本轮）

继续推进 Phase3 技术债清理：

1. **routes 层字符串查询参数长度校验已收尾**：search/keyword/category 三类自由文本查询参数已全覆盖，剩余 routes 查询参数均为 UUID/枚举/数字/日期，已有校验或由 service 层兜底，无需继续补全
2. **service 层兜底校验已复核完成**：8 个核心 getById 方法全部保留 NotFoundError 兜底，无需补改
3. **可选下一站**（按优先级）：
   - 3.1 service 层 sanitizeObject 清洗覆盖面扫描：确认所有用户输入的富文本字段（title/description/content/address 等）入库前均已调用 sanitizeObject 清洗，防止存储型 XSS
   - 3.2 service 层事务边界复核：抽查关键写操作（如 emergency.service createRequest + recordEvent、time-bank.service transfer + 记录流水）是否使用 transaction 包裹，保证数据一致性
   - 3.3 routes 层 req.body 字段白名单校验扫描：确认所有 POST/PUT 路由的 req.body 字段均经过 express-validator 校验，避免越权字段写入
4. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）

---

## 上轮迭代摘要（2026-07-27 第 1 轮）

承接 2026-07-26 map 模块参数校验线收尾，本轮进入 **Phase3 技术债清理** 下一站：routes 层字符串查询参数长度校验全量补全。

本轮聚焦上轮 topics.md「下一轮建议」第 2 项「routes 层字符串查询参数长度校验扫描」，处理一类问题：

1. **routes 层无长度限制的字符串搜索/keyword 类参数**：admin.ts /users search、kitchen.ts /posts keyword、skills.ts /posts keyword 三处直接解构 `req.query` 传入 service 层，无长度上限校验，超长文本可能拼入 ILIKE 查询造成 DB 全表扫描压力
2. **缺少统一字符串查询参数长度校验工具函数**：emergency.ts /map/geocode address 已用 `query('address').optional().isLength({ max: 200 })` 直写校验链，但缺少与 enumQuery 同级的可复用工具函数，三处新增长度校验若各自直写会导致范式分散

### 已完成任务（1 个最小迭代单元）

1. **routes 层字符串查询参数长度校验补全 + emergency 重构使用 queryStringLength 工具函数**（commit 0af2dc7）
   - 文件：
     - `server/src/middleware/validator.ts`（新增 `queryStringLength` 工具函数）
     - `server/src/routes/admin.ts`（/users search 加 100 字符上限 + import 补 queryStringLength）
     - `server/src/routes/kitchen.ts`（/posts keyword 加 100 字符上限 + import 补 queryStringLength）
     - `server/src/routes/skills.ts`（/posts keyword 加 100 字符上限 + import 补 queryStringLength）
     - `server/src/routes/emergency.ts`（/map/geocode address 重构为使用 queryStringLength，清理未使用 query import）
     - `server/src/routes/__tests__/admin.test.ts`（新增 422 防御用例）
     - `server/src/routes/__tests__/kitchen.test.ts`（新增 422 防御用例）
     - `server/src/routes/__tests__/skills.test.ts`（新增 422 防御用例）
   - 改动点：
     - **新增 `queryStringLength(queryName, max=100, optional=true)` 工具函数**：
       - 与 `enumQuery` 同范式，统一字符串查询参数长度上限校验
       - 默认 max=100：覆盖常见搜索关键词/地址场景（中文姓名 ≤ 10 字符，最长中国地址约 50 字符，100 字符既保留国际化冗余又足以拦截明显异常的超长文本）
       - 默认 optional=true：查询参数天然可选，未传时不触发校验
     - **admin.ts /users search 加 100 字符上限**：防止超长搜索关键词穿透到 service 层拼入 ILIKE 查询
     - **kitchen.ts /posts keyword 加 100 字符上限**：同上
     - **skills.ts /posts keyword 加 100 字符上限**：同上
     - **emergency.ts /map/geocode address 重构**：原 `query('address').optional().isLength({ max: 200 }).withMessage('地址长度不能超过 200 字符')` 改为 `queryStringLength('address', 200)`，保持全 routes 范式一致；同时清理 emergency.ts 顶部未使用的 `query` import
   - 测试同步更新：
     - 三个 routes 测试文件各新增 1 个 422 防御用例（共 3 个）：
       - admin.test.ts: `GET /users search 超长（>100 字符）返回 422，不调用 service`
       - kitchen.test.ts: `keyword 超长（>100 字符）返回 422，不调用 service`
       - skills.test.ts: `keyword 超长（>100 字符）返回 422，不调用 service`
     - 每个用例验证两点：① HTTP 状态码为 422 ② service 方法未被调用（确认前置拦截生效）
   - 验收：
     - 后端 tsc --noEmit ✅ 通过
     - 后端 vitest run 5 个测试文件全量通过 ✅（222 用例：validator.test.ts 26 + skills.test.ts 26 + emergency.test.ts 39 + kitchen.test.ts 47 + admin.test.ts 84，含新增 3 个 422 防御用例）
     - 前端 npm run build ✅ 通过（1732 模块，零错误零警告）

### 本轮总结（上轮）

本轮共完成 1 个迭代单元（commit 0af2dc7），属于 Phase3 技术债清理的 routes 层字符串查询参数长度校验线。

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| server/src/middleware/validator.ts | 新增 queryStringLength 工具函数 | 0af2dc7 |
| server/src/routes/admin.ts | /users search 加 100 字符上限 | 0af2dc7 |
| server/src/routes/kitchen.ts | /posts keyword 加 100 字符上限 | 0af2dc7 |
| server/src/routes/skills.ts | /posts keyword 加 100 字符上限 | 0af2dc7 |
| server/src/routes/emergency.ts | /map/geocode address 重构为 queryStringLength | 0af2dc7 |
| server/src/routes/__tests__/admin.test.ts | 新增 422 防御用例 | 0af2dc7 |
| server/src/routes/__tests__/kitchen.test.ts | 新增 422 防御用例 | 0af2dc7 |
| server/src/routes/__tests__/skills.test.ts | 新增 422 防御用例 | 0af2dc7 |

### 验证结果（上轮）

- 后端类型检查：✅ tsc --noEmit 通过
- 后端单元测试：✅ 5 个测试文件全量通过（222 用例，含新增 3 个）
- 前端构建：✅ 1732 模块零错误零警告

### 关键技术决策（上轮）

1. **抽象 queryStringLength 工具函数而非各自直写校验链**：
   - emergency.ts 原本已直写 `query('address').optional().isLength({ max: 200 }).withMessage(...)`，本轮新增 3 处若各自直写会导致范式分散、维护成本上升
   - 抽象为 `queryStringLength(queryName, max=100, optional=true)` 后，4 处使用方统一一行调用，与 `enumQuery` 同范式
   - 同时重构 emergency.ts 使用新函数，避免「新代码用新范式、老代码用旧范式」的分裂状态
   - 抽象收益：未来新增字符串查询参数长度校验只需一行 `queryStringLength('xxx', N)`，无需重复写 `.optional().isLength().withMessage()` 三段链式
2. **默认 max=100 的选择依据**：
   - 中文姓名 ≤ 10 字符，最长中国地址约 50 字符（省市区街道门牌号全称）
   - 100 字符覆盖国际化场景（含国家名、多语言地址），且足以拦截明显异常的超长文本
   - 与 emergency.ts /map/geocode address 的 200 字符上限形成差异化：address 是地理编码地址（需更长冗余），search/keyword 是搜索关键词（100 字符足够）
3. **测试用例验证「不调用 service」的重要性**：
   - 仅断言 HTTP 422 状态码无法验证「前置拦截」是否生效（可能存在 service 内部抛错被 errorHandler 标准化为 422 的歧义）
   - 同步断言 `mockXxxService.not.toHaveBeenCalled()` 确认 service 层未被调用，验证校验中间件确实在路由层短路返回
   - 与 emergency.test.ts 既有的 `expect(mockGeocode).not.toHaveBeenCalled()` 范式对齐
4. **emergency.ts 重构时同步清理未使用 query import**：
   - 重构后 `query` 从 express-validator 的 import 不再被使用（剩余 `req.query` 是 Express Request 属性，与 import 无关）
   - 清理未使用 import 避免编译警告，符合规范「无未使用变量/导入」要求

### Git 提交记录（上轮）

- `0af2dc7` fix: routes 层字符串查询参数长度校验补全（search/keyword 三处 + emergency 重构使用 queryStringLength）

### 遗留问题（上轮）

无阻塞性遗留问题。剩余技术债清理项：

1. **routes 层字符串查询参数长度校验全量扫描收尾**：本轮已补 admin/kitchen/skills 三处 search/keyword + emergency address 已有，剩余 routes 中是否存在其他无长度限制的字符串查询参数（如 messages.ts order_id/cursor、time-bank.ts type/category 等），需逐一评估是否需要补长度校验
2. **service 层兜底校验复核**（承接 2026-07-26 遗留）：抽查 user.service/skill.service/kitchen.service 等关键 service 的 getById 等方法是否仍保留 NotFoundError 兜底
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：
   - 5.1 P0 安全遗留：.env 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
   - 5.2 P1 生产就绪验收：全页面移动端适配、CD 流水线 GitHub Secrets、高德地图 Key 配置等运维侧确认

### 下一轮建议（上轮）

继续推进 Phase3 技术债清理：

1. **routes 层字符串查询参数长度校验收尾扫描**：扫描 messages.ts、time-bank.ts、metrics.ts、admin.ts 其他 search 类参数，评估是否需补长度校验（注意：order_id/cursor 等 UUID 形式参数已有 service 层 UUID 校验兜底，可不必补；startDate/endDate 等日期参数由 service 层校验）
2. **service 层兜底校验复核**：抽查 user.service/skill.service/kitchen.service 等关键 service 的 getById 等方法是否仍保留 NotFoundError 兜底
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）
