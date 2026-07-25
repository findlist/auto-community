# 邻里圈项目迭代进度 - 2026-07-25

## 本轮迭代摘要（2026-07-25）

承接 2026-07-24「假 label 批量修复清零」与「setState 卸载泄漏清零」两条收尾线，本轮处理三批遗漏：

1. 上轮遗留未提交的 TimeBank 三件套（DonateModal/TransferModal/FamilyBinding）共 7 处假 label 修复
2. 扫描发现 SharedKitchen 模块仍有 3 个文件 8 处假 label 违规未修（AddressBook 3 处 + Detail 3 处 + FoodReview 2 处），本轮全部清零
3. Admin 后台视觉一致性收尾：5 个列表页分页控件统一规范 + 6 个文件状态筛选/查询/分段按钮补按压反馈与选中态

### 已完成任务（6 个最小迭代单元）

1. **TimeBank 弹窗与亲情绑定修复 7 处假 label 无障碍违规**（commit eb5da63）
   - 文件：`client/src/pages/TimeBank/DonateModal.tsx`、`client/src/pages/TimeBank/TransferModal.tsx`、`client/src/pages/TimeBank/FamilyBinding.tsx`
   - 方案：全部为标准表单元素，统一补 `htmlFor/id` 关联
     - DonateModal：受赠用户ID/捐赠金额/备注
     - TransferModal：对方用户ID/转赠金额/备注
     - FamilyBinding：家长手机号/关系（select）
   - 验收：前端 build ✅（18.08s）

2. **SharedKitchen/AddressBook 修复 3 处假 label 无障碍违规**（commit f3e3bed）
   - 文件：`client/src/pages/SharedKitchen/AddressBook.tsx`
   - 方案：3 处标准表单（收件人 input/手机号 input/详细地址 textarea）补 `htmlFor/id`
   - 评估确认无需修改：默认地址 label 包裹 checkbox（`<label><input type="checkbox">...</label>`）是 WCAG 合法模式，点击文字触发 checkbox
   - 验收：针对性测试 26/26 通过，无需更新测试（测试用 getByPlaceholderText 选择器，不依赖 label 关联）

3. **SharedKitchen/Detail 修复 3 处假 label 无障碍违规**（commit 6a9d997）
   - 文件：`client/src/pages/SharedKitchen/Detail.tsx`、`client/src/pages/SharedKitchen/__tests__/Detail.test.tsx`
   - 方案（按控件类型分 3 种）：
     - **份数（自定义计数器）**：label 改 `<span id>` + 容器加 `role="group"` + `aria-labelledby`；+/- 按钮加 `aria-label="减少份数"/"增加份数"`；数量 span 加 `aria-live="polite"` 让屏幕阅读器播报份数变化
     - **领取方式（自定义单选 button 组）**：label 改 `<span id>` + 容器加 `role="radiogroup"` + `aria-labelledby` + 每个 button 加 `role="radio"` + `aria-checked`
     - **备注（标准 textarea）**：用 `htmlFor/id`
   - 测试同步更新：7 处 `getByRole('button', { name: '自取'/'配送' })` 改为 `getByRole('radio', ...)`（role="radio" 覆盖隐式 button 角色，APG 规范行为）
   - 测试用 `findPlusMinusButtons()` 通过 `button.rounded-full` + textContent 选择 +/- 按钮，直接 DOM 查询不依赖 role，无需更新
   - 验收：针对性测试 28/28 通过

4. **SharedKitchen/FoodReview 修复 2 处假 label 无障碍违规**（commit a9f7c0c）
   - 文件：`client/src/pages/SharedKitchen/FoodReview.tsx`、`client/src/pages/SharedKitchen/__tests__/FoodReview.test.tsx`
   - 方案：
     - **评分（星级单选）**：label 改 `<span id>` + 容器加 `role="radiogroup"` + `aria-labelledby` + 星按钮加 `role="radio"` + `aria-checked` + `aria-label={`${n} 星`}`（星形 svg 无文字，必须加 aria-label 提供可访问名）
     - **评价内容（标准 textarea）**：用 `htmlFor/id`
   - 测试同步更新：`getAllByRole("button").filter(btn => btn.querySelector("svg.lucide-star"))` 改为 `getAllByRole("radio").filter(...)`（同 Detail，role="radio" 覆盖隐式 button 角色）
   - 验收：针对性测试 13/13 通过

5. **Admin 5 个列表页分页控件视觉规范统一**（commit f51dec3）
   - 文件：`client/src/pages/Admin/ContentReview.tsx`、`OrderManagement.tsx`、`ReportManagement.tsx`、`AuditLog.tsx`、`UserManagement.tsx`（参照基准）
   - 方案（与 07-20 UserManagement 范式对齐）：
     - **当前页胶囊高亮**：`px-3 py-1.5 rounded-lg bg-neutral-100` + `font-semibold text-neutral-900` 当前页 / `text-neutral-500` 总页数 / `text-neutral-400` 分隔符，形成三级文字层级
     - **前后翻页按钮补 `aria-label`**：`aria-label="上一页"/"下一页"`，屏幕阅读器可识别
     - **active 反馈**：`active:scale-95 transition-all`，移动端按压有缩放反馈
     - **总数统计 tabular-nums**：`tabular-nums` 让数字等宽对齐，避免翻页时数字宽度抖动
   - 验收：前端 build ✅ 通过

6. **Admin 6 个文件状态筛选/查询/分段按钮补按压反馈与选中态**（commit 97a66a3）
   - 文件：`client/src/pages/Admin/ContentReview.tsx`、`OrderManagement.tsx`、`ReportManagement.tsx`、`VerificationReview.tsx`、`AuditLog.tsx`、`SystemConfig.tsx`
   - 方案（统一交互反馈语言）：
     - **状态筛选按钮**：选中态 `bg-emerald-500 text-white shadow-sm`（轻微抬升感），未选中态 `bg-neutral-100 text-neutral-600 hover:bg-neutral-200`，统一加 `active:scale-95 transition-all` 按压反馈
     - **查询按钮（AuditLog）**：补 `active:scale-95 transition-all`
     - **值类型分段选择器（SystemConfig）**：string/int/float 三选一按钮补 `active:scale-95` + 选中态 `shadow-sm` 抬升
   - 设计原因：Admin 后台原有按钮交互反馈不一致（部分有 active 反馈部分无，部分选中态无视觉抬升），统一后视觉语言一致，用户操作有明确感知
   - 验收：前端 build ✅ 通过（16.86s）

### 本轮总结

本轮共完成 6 个迭代单元，分两条线：

**线条一：无障碍假 label 修复清零**（4 个单元，commit eb5da63/f3e3bed/6a9d997/a9f7c0c）
- 累计修复 **15 处假 label 违规**，覆盖 6 个文件
- 加上 2026-07-24 累计 43 处，**全项目「假 label」违规累计清零 58 处**

| 文件 | 违规数 | commit |
| --- | --- | --- |
| TimeBank/DonateModal | 3 | eb5da63 |
| TimeBank/TransferModal | 3 | eb5da63 |
| TimeBank/FamilyBinding | 2 | eb5da63 |
| SharedKitchen/AddressBook | 3 | f3e3bed |
| SharedKitchen/Detail | 3 | 6a9d997 |
| SharedKitchen/FoodReview | 2 | a9f7c0c |

**线条二：Admin 后台视觉一致性收尾**（2 个单元，commit f51dec3/97a66a3）
- 5 个列表页分页控件统一规范（当前页胶囊高亮 + 三级文字层级 + active 反馈 + aria-label）
- 6 个文件状态筛选/查询/分段按钮统一交互反馈语言（active:scale-95 + shadow-sm 选中态）

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| ContentReview/OrderManagement/ReportManagement/AuditLog/UserManagement | 分页控件统一 | f51dec3 |
| ContentReview/OrderManagement/ReportManagement/VerificationReview/AuditLog/SystemConfig | 按钮反馈统一 | 97a66a3 |

### 验证结果

- 后端类型检查/单元测试：本轮无后端改动，基线保持（2026-07-24：✅ 1731/1731 通过）
- 前端构建：✅ 通过（16.86s，零错误零警告）
- 前端针对性测试：✅ AddressBook 26/26、Detail 28/28、FoodReview 13/13 全部通过

### 关键技术决策

1. **role="radio" 覆盖隐式 button 角色 → 测试选择器必须同步**：
   - ARIA 规范：显式 `role="radio"` 优先于 button 的隐式 role
   - 影响：`getByRole('button', { name: '自取' })` 不再匹配，需改为 `getByRole('radio', { name: '自取' })`
   - 测试应跟随语义变化，这是 ARIA 规范行为，不是测试 bug
2. **星级按钮必须加 aria-label**：
   - 星形 svg（lucide-star）无文字内容，按钮无 accessible name
   - 加 `role="radio"` 后屏幕阅读器会播报"单选按钮，未选中"，但无法播报"几星"
   - 加 `aria-label={`${n} 星`}` 后播报"3 星，单选按钮，已选中"，符合评分语义
3. **数量计数器的 aria-live**：
   - 数量 span 加 `aria-live="polite"`，用户点击 +/- 后屏幕阅读器自动播报新份数
   - "polite" 模式不打断当前播报，等用户操作完成后再播报变化，符合计数器语义
4. **label 包裹 checkbox 是合法模式**：
   - `<label><input type="checkbox">...</label>` 是 WCAG 标准做法，点击文字触发 checkbox
   - AddressBook 默认地址 checkbox 用此模式，无需修改
   - 与「假 label」（label 与 input 视觉同级但无 htmlFor/id 关联）不同，包裹模式天然存在 DOM 嵌套关系，屏幕阅读器可识别
5. **分页控件统一参照 UserManagement 07-20 范式**：
   - 不重新设计，直接对齐项目内已有的最优实现，降低视觉碎片化
   - 关键元素：当前页 `bg-neutral-100` 胶囊高亮 + 三级文字层级（neutral-900/500/400）+ `tabular-nums` 数字等宽 + `aria-label` 无障碍
6. **shadow-sm 用于选中态抬升，active:scale-95 用于按压反馈**：
   - 选中态加 `shadow-sm` 营造轻微抬升感，比单纯改色更具层次
   - `active:scale-95` 是 95% 缩放，配合 `transition-all` 形成「按下去」的物理反馈
   - 两者结合让状态筛选按钮的「选中」与「按压」两个状态有明确区分

### Git 提交记录

- `eb5da63` fix: TimeBank 弹窗与亲情绑定修复 7 处假 label 无障碍违规
- `f3e3bed` fix: SharedKitchen/AddressBook 修复 3 处假 label 无障碍违规
- `6a9d997` fix: SharedKitchen/Detail 修复 3 处假 label 无障碍违规
- `a9f7c0c` fix: SharedKitchen/FoodReview 修复 2 处假 label 无障碍违规
- `f51dec3` refactor: Admin 5 个列表页分页控件视觉规范统一（当前页胶囊高亮+三级文字层级+active 反馈+补 aria-label）
- `97a66a3` refactor: Admin 6 个文件状态筛选/查询/分段按钮补 active:scale-95 按压反馈与 shadow-sm 选中态

### 遗留问题

无阻塞性遗留问题。剩余运维侧任务（非 Agent 可推进）：

1. **5.1 P0 安全遗留**：.env 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
2. **5.2 P1 生产就绪验收**：
   - 全页面移动端适配、交互体验、状态提示完整性人工最终复查
   - CD 流水线 GitHub Secrets 与远程服务器 GHCR 登录态运维确认
   - 高德地图 Key 配置（清理逻辑已完备）

### 下一轮建议

「假 label」批量修复任务全部清零（含本轮 SharedKitchen 模块收尾），Admin 后台视觉一致性收尾完成。后续可选方向：

1. **样式精修扩展**：扫描非 Admin 模块（TimeBank/SharedKitchen/SkillMarket 等）是否有分页控件/状态筛选按钮交互反馈不一致问题
2. **测试补全**：未覆盖的关键路径补全测试用例
3. **运维侧 P0/P1 遗留**（非 Agent 可推进，需用户介入）：见上方「遗留问题」
