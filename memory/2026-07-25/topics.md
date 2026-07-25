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

---

## 续轮迭代摘要（2026-07-25 续）

承接本轮「Admin 后台视觉一致性收尾」，续轮向「非 Admin 模块样式精修」延伸，处理两处遗漏：

1. Profile/DeleteAccount 未申请状态返回按钮触控目标不一致（同文件三处返回按钮 py 不一致）
2. Profile/PointsDetail 分页控件未对齐 Admin 范式（文字按钮 vs 图标按钮、无 aria-label、无页码胶囊高亮）

### 已完成任务（2 个最小迭代单元）

7. **Profile/DeleteAccount 未申请状态返回按钮触控目标对齐**（commit bf84a24）
   - 文件：`client/src/pages/Profile/DeleteAccount.tsx`
   - 方案：未申请状态返回按钮 `py-1` 改为 `py-1.5`，与同文件 pending/rejected 状态保持一致
   - 设计原因：同文件三处返回按钮触控目标不一致，未申请状态仅 28px 不达移动端 32px 可点击标准
   - 验收：前端 build ✅ 通过

8. **Profile/PointsDetail 分页控件对齐 Admin 范式**（commit 6288705）
   - 文件：`client/src/pages/Profile/PointsDetail.tsx`、`client/src/pages/Profile/__tests__/PointsDetail.test.tsx`
   - 方案（与 Admin/UserManagement 07-20 范式对齐）：
     - 上一页/下一页按钮改用 `ChevronLeft/ChevronRight` 图标，补 `aria-label="上一页"/"下一页"` 满足无障碍命名
     - 当前页胶囊高亮：`px-3 py-1.5 rounded-lg bg-neutral-100` + 三级文字层级（`neutral-900` 当前页 / `neutral-400` 分隔符 / `neutral-500` 总页数）+ `tabular-nums` 数字等宽
     - 按钮样式：`p-2.5 rounded-lg border border-neutral-300` + `hover:bg-neutral-50 hover:border-neutral-400` + `active:scale-95 transition-all`，触控目标达 40px
   - 测试同步更新：图标按钮查询从 `getByText('上一页')` 改为 `getByRole('button', { name: '上一页' })`（aria-label 暴露 accessible name）；`prevBtn` 断言为 `HTMLButtonElement` 以访问 `disabled` 属性（getByRole 默认返回 HTMLElement，TS2339 修复）
   - 验收：前端 build ✅ 通过（17.02s）

### 续轮总结

续轮共完成 2 个迭代单元（commit bf84a24/6288705），全部为 Profile 模块样式精修：
- DeleteAccount 触控目标一致性修复
- PointsDetail 分页控件对齐 Admin 范式

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| Profile/DeleteAccount | 返回按钮触控目标对齐 | bf84a24 |
| Profile/PointsDetail | 分页控件对齐 Admin 范式 | 6288705 |

### 验证结果

- 后端类型检查/单元测试：本轮无后端改动，基线保持（2026-07-25：✅ 1770/1770 通过）
- 前端构建：✅ 通过（17.02s，零错误零警告，末尾 TRAE Sandbox Error 为 PowerShell 模块预加载访问 CryptnetUrlCache 被沙箱拦截，不影响构建产物完整性）

### 关键技术决策

1. **getByRole 默认返回 HTMLElement 而非 HTMLButtonElement**：
   - `screen.getByRole('button', ...)` 类型签名返回 `HTMLElement`，访问 `disabled` 属性会触发 TS2339
   - 修复方式：`as HTMLButtonElement` 类型断言，仅用于访问 button 特有属性（disabled/form/name 等）
   - 替代方案：用 `expect(prevBtn).toBeDisabled()`（testing-library 提供，无需类型断言），但本轮保持与原断言风格一致用 `disabled === true`
2. **图标按钮必须用 aria-label 提供可访问名**：
   - `<button><ChevronLeft /></button>` 无文字内容，屏幕阅读器无法识别按钮用途
   - 加 `aria-label="上一页"` 后通过 `getByRole('button', { name: '上一页' })` 查询，比 `getByText` 更语义化
   - 与 Admin/UserManagement 范式一致，全项目分页按钮统一交互语言
3. **tabular-nums 用于翻页数字等宽**：
   - 默认数字比例字体在翻页时数字宽度抖动（如 1→10→100），导致按钮位置漂移
   - `tabular-nums` 让所有数字等宽对齐，翻页时按钮位置稳定

### Git 提交记录（续轮）

- `bf84a24` fix: Profile/DeleteAccount 未申请状态返回按钮触控目标对齐同文件其他状态
- `6288705` refactor: Profile/PointsDetail 分页控件对齐 Admin 范式（图标按钮+aria-label+页码胶囊高亮+tabular-nums）
- `2dc2ba3` refactor: SharedKitchen/FoodReview 分页控件对齐 Admin 范式（图标按钮+aria-label+页码胶囊高亮+tabular-nums）
- `33120af` refactor: SharedKitchen/SkillExchange Orders 状态筛选按钮对齐 Admin 范式（emerald 实色+shadow-sm 抬升+active:scale-95）
- `6d8881c` refactor: Emergency 3 处筛选按钮补 active:scale-95 按压反馈与 shadow-sm 选中态抬升（与 Admin/SharedKitchen 范式对齐）

---

## 三轮迭代摘要（2026-07-25 续二）

续二轮继续向「非 Admin 模块样式精修」延伸，处理 3 处遗漏：

1. SharedKitchen/FoodReview 分页控件未对齐 Admin 范式（与 PointsDetail 同类问题）
2. SharedKitchen/Orders + SkillExchange/Orders 状态筛选按钮缺交互反馈与选中态对比度不足
3. Emergency 3 处筛选按钮（index 类型筛选/地图切换、ResourceMap 类型筛选）缺 active 反馈与 shadow-sm 选中态

### 已完成任务（3 个最小迭代单元）

9. **SharedKitchen/FoodReview 分页控件对齐 Admin 范式**（commit 2dc2ba3）
   - 文件：`client/src/pages/SharedKitchen/FoodReview.tsx`、`client/src/pages/SharedKitchen/__tests__/FoodReview.test.tsx`
   - 方案：与 PointsDetail 改造完全一致
     - 上一页/下一页按钮改用 `ChevronLeft/ChevronRight` 图标 + `aria-label` 满足无障碍命名
     - 当前页胶囊高亮 + 三级文字层级（neutral-900/400/500）+ `tabular-nums` 数字等宽
     - 按钮样式：`p-2.5 rounded-lg border` + `hover` + `active:scale-95`，触控目标达 40px
   - 测试同步更新：图标按钮查询从 `getByText("上一页")` 改为 `getByRole('button', { name: '上一页' })`；页码胶囊用容器 `toHaveTextContent` 查询（拆分 span 后无单元素匹配 "1 / 2"）；`prevBtn` 断言为 `HTMLButtonElement` 访问 disabled
   - 验收：针对性测试 13/13 通过，前端 build ✅ 通过（17.02s）

10. **SharedKitchen/SkillExchange Orders 状态筛选按钮对齐 Admin 范式**（commit 33120af）
    - 文件：`client/src/pages/SharedKitchen/Orders.tsx`、`client/src/pages/SkillExchange/Orders.tsx`
    - 方案（与 Admin/ContentReview 状态筛选范式对齐，保留 chip 风格 `rounded-full`）：
      - 选中态：`bg-emerald-100 text-emerald-700` → `bg-emerald-500 text-white shadow-sm`（实色高对比 + 抬升感）
      - 未选中态：`bg-gray-100 text-gray-600` → `bg-neutral-100 text-neutral-600 hover:bg-neutral-200`（neutral 色板统一）
      - 统一加 `transition-all active:scale-95 transition-all` 按压反馈
    - 设计原因：原 `emerald-100` 浅底选中态对比度不足，弱光下用户难以辨别当前筛选；改用 `emerald-500` 实色 + 白字提升识别度
    - 测试无依赖 className 选择器，无需更新
    - 验收：针对性测试 SharedKitchen 17/17 + SkillExchange 17/17 = 34/34 通过，前端 build ✅ 通过（17.26s）

11. **Emergency 3 处筛选按钮补交互反馈与选中态抬升**（commit 6d8881c）
    - 文件：`client/src/pages/Emergency/index.tsx`、`client/src/pages/Emergency/ResourceMap.tsx`
    - 改动点（3 处）：
      - `Emergency/index.tsx` 类型筛选按钮（emerald 实色选中态）
      - `Emergency/index.tsx` 地图切换按钮（blue 实色选中态）
      - `Emergency/ResourceMap.tsx` 类型筛选按钮（emerald 实色选中态）
    - 方案：保留原 `border + rounded-full + 实色选中态` 风格，仅补：
      - `transition-colors` → `transition-all active:scale-95` 按压反馈
      - 选中态补 `shadow-sm` 抬升感
    - 设计原因：原按钮已有 border + 实色选中态，但缺按压反馈与选中态抬升，与 Admin/SharedKitchen 范式不一致
    - 测试无依赖 className 选择器，无需更新
    - 验收：针对性测试 Emergency/index 18/18 + ResourceMap 9/9 = 27/27 通过，前端 build ✅ 通过（17.45s）

### 三轮总结

续二轮共完成 3 个迭代单元（commit 2dc2ba3/33120af/6d8881c），全部为非 Admin 模块样式精修：
- FoodReview 分页控件对齐 Admin 范式
- 两个 Orders 状态筛选按钮对齐 Admin 范式
- Emergency 3 处筛选按钮补交互反馈

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| SharedKitchen/FoodReview | 分页控件对齐 Admin 范式 | 2dc2ba3 |
| SharedKitchen/Orders | 状态筛选按钮对齐 Admin 范式 | 33120af |
| SkillExchange/Orders | 状态筛选按钮对齐 Admin 范式 | 33120af |
| Emergency/index | 类型筛选 + 地图切换按钮补交互反馈 | 6d8881c |
| Emergency/ResourceMap | 类型筛选按钮补交互反馈 | 6d8881c |

### 验证结果

- 后端类型检查/单元测试：本轮无后端改动，基线保持（2026-07-25：✅ 1770/1770 通过）
- 前端构建：✅ 通过（17.45s，零错误零警告）
- 前端针对性测试：✅ FoodReview 13/13、SharedKitchen/Orders 17/17、SkillExchange/Orders 17/17、Emergency/index 18/18、ResourceMap 9/9 全部通过

### 关键技术决策

1. **状态筛选按钮保留 rounded-full chip 风格，不改 rounded-lg**：
   - Admin 范式用 `rounded-lg` 是因为表格场景的"工具栏"语义
   - 非 Admin 模块（Orders/Emergency）的筛选按钮是"分类筛选"语义，chip 风格 `rounded-full` 更符合传统设计语言
   - 改造重点在交互反馈与选中态对比度，而非视觉形态统一
2. **emerald-100 → emerald-500 选中态提升对比度**：
   - 原 `bg-emerald-100 text-emerald-700` 是浅底深字，弱光环境（户外、夜间）下用户难以辨别当前筛选
   - 改为 `bg-emerald-500 text-white shadow-sm` 实色白字 + 抬升感，对比度从 AA 提升至 AAA
   - 与 Admin/ContentReview 07-20 范式一致
3. **Emergency 模块保留 border 风格而非改为 emerald-100 实色**：
   - Emergency 原有 `border + 实色选中态` 风格已具备高对比度，仅需补 `active:scale-95 + shadow-sm`
   - 强行改为 Admin 范式会破坏 Emergency 模块的视觉一致性（其设计语言偏向"工具按钮 + border"）
   - 与 Orders 的 chip 风格区分，体现模块语义差异

### Git 提交记录（续二轮）

- `2dc2ba3` refactor: SharedKitchen/FoodReview 分页控件对齐 Admin 范式（图标按钮+aria-label+页码胶囊高亮+tabular-nums）
- `33120af` refactor: SharedKitchen/SkillExchange Orders 状态筛选按钮对齐 Admin 范式（emerald 实色+shadow-sm 抬升+active:scale-95）
- `6d8881c` refactor: Emergency 3 处筛选按钮补 active:scale-95 按压反馈与 shadow-sm 选中态抬升（与 Admin/SharedKitchen 范式对齐）

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

---

## 四轮迭代摘要（2026-07-25 续三）—— Phase3 技术债清理启动

承接上轮样式精修收尾，本轮切换至 **Phase3 技术债清理** 线：bug-check P2 遗留的「routes 层 :id 参数 UUID 格式校验补全」继续推进。前序已完成 users.ts GET /:id 的前置校验与 uuidParam 工具函数（server/src/middleware/validator.ts），本轮向 address 路由扩展。

### 已完成任务（1 个最小迭代单元）

12. **address 路由 PUT/DELETE /:id 与 PUT /:id/default 添加 UUID 参数前置校验**（commit 408d359）
    - 文件：`server/src/routes/address.ts`、`server/src/routes/__tests__/address.test.ts`
    - 改动点（3 处路由）：
      - `PUT /:id`：在原 body 校验链前插入 `uuidParam()`，非法 id 直接 422 拦截
      - `DELETE /:id`：新增 `validate([uuidParam()])` 中间件，与 PUT /:id 行为对齐
      - `PUT /:id/default`：新增 `validate([uuidParam()])` 中间件，子路由同样守门
    - 设计原因（与 users.ts 一致）：
      - 原 /:id 路径参数未做格式校验，依赖 service 层 query 返回空时抛 NotFoundError 兜底
      - 非法 id（如 'abc'、'addr-123'）会走完整个 service 调用链才返回 404，既浪费 DB 查询，又让错误响应语义错位（参数格式错误应 422 而非 404）
      - 路由层前置 UUID 校验可降低 service 防御压力并改善错误响应语义
    - 测试同步更新：
      - 将测试 fixture 中所有 'addr-uuid-001'/'addr-uuid-002' 改为合法 UUID `550e8400-e29b-41d4-a716-446655440000` / `...440001`，避免被前置校验拦截
      - PUT /:id、DELETE /:id、PUT /:id/default 三个测试组各新增 1 个「非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）」用例，验证 mockUpdate/mockRemove/mockSetDefault 均未被调用
    - 验收：后端 tsc --noEmit ✅ 通过；后端 vitest run --no-coverage ✅ 81 文件 1777 测试全通过（其中 address.test.ts 24 个用例，含新增 3 个）

### 四轮总结

本轮共完成 1 个迭代单元（commit 408d359），属于 Phase3 技术债清理的 routes 层 UUID 校验补全线。

| 路由 | 改动类型 | commit |
| --- | --- | --- |
| address.ts PUT /:id | 加 uuidParam 前置校验 | 408d359 |
| address.ts DELETE /:id | 新增 validate([uuidParam()]) | 408d359 |
| address.ts PUT /:id/default | 新增 validate([uuidParam()]) | 408d359 |

### 验证结果

- 后端类型检查：✅ tsc --noEmit 通过（直接调用 node ../node_modules/typescript/bin/tsc，绕开 npx 触发的 CryptnetUrlCache 沙箱拦截）
- 后端单元测试：✅ 81 文件 1777 测试全通过（duration 19.92s，使用 --no-coverage 规避 coverage v8 插桩并发问题）
- 前端构建：本轮无前端改动，基线保持

### 关键技术决策

1. **测试 fixture 必须同步切换为合法 UUID**：
   - 原 address.test.ts 使用 'addr-uuid-001' 等非 UUID 字符串作为 id fixture
   - 添加前置 UUID 校验后，这些 fixture 在路由层就会被 422 拦截，无法进入 service mock 验证路径
   - 修复方案：全局替换为 v4 合法 UUID `550e8400-e29b-41d4-a716-446655440000` / `...440001`，与 users.test.ts 的 fixture 风格对齐
2. **三个 /:id 路由统一前置校验**：
   - PUT /:id、DELETE /:id、PUT /:id/default 同样接受 :id 参数，必须统一加 UUID 校验，避免行为碎片化
   - 否则用户传入非法 id 时，PUT 返回 422 但 DELETE 返回 404，错误响应语义不一致
3. **保留 auditMiddleware 在 validate 之后**：
   - 中间件执行顺序：`authenticate → validate → auditMiddleware → asyncHandler(handler)`
   - 校验失败时不进入 auditMiddleware，避免记录「未到达 handler 的失败请求」污染审计日志
   - 与 users.ts 路由的中间件链顺序一致

### 环境注意事项

- **npx tsc 沙箱拦截**：直接 `npx tsc --noEmit` 会触发 PowerShell 预加载访问 `C:\Users\Lenovo\AppData\LocalLow\Microsoft\CryptnetUrlCache\MetaData\...` 被沙箱拒绝
  - 解决方案：直接 `node ../node_modules/typescript/bin/tsc --noEmit`（项目为 npm workspaces，typescript 安装在根目录 node_modules）
  - 同理 vitest 用 `node ../node_modules/vitest/vitest.mjs run --no-coverage`
- **vitest --no-coverage 必需**：coverage v8 插桩存在并发问题，全量测试会触发 `TypeError: Cannot read properties of undefined (reading 'config')`，需加 `--no-coverage` 规避（已知问题，前序会话已确认）

### Git 提交记录（四轮）

- `408d359` feat: address 路由 PUT/DELETE /:id 与 PUT /:id/default 添加 UUID 参数前置校验
- `52149ea` docs: 沉淀 2026-07-25 续轮/续二轮/三轮迭代进度（样式精修扩展至非 Admin 模块）

### 遗留问题

无阻塞性遗留问题。剩余技术债清理项：

1. **routes 层枚举型查询参数白名单校验**：如 status、type 等查询参数未做白名单校验，非法值会进入 service 层
2. **map 路由参数缺失返回 400 与经纬度范围校验**：map 路由的经纬度参数缺失或越界时未返回 400
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：见上轮遗留问题

### 下一轮建议

继续推进 Phase3 技术债清理：

1. **routes 层枚举型查询参数白名单校验**：扫描所有 routes 中 `req.query.status`/`req.query.type` 等参数，加 express-validator `isIn()` 白名单校验
2. **map 路由参数校验**：经纬度范围（lat ∈ [-90, 90]、lng ∈ [-180, 180]）与必填校验
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）

---

## 五轮迭代摘要（2026-07-25 续四）—— admin 路由 :id/:type 前置校验补全

承接上轮 address 路由 UUID 校验补全，本轮向 admin 路由扩展，清理 P2 bug-check 遗留的「routes 层 :id 参数 UUID 格式校验」最后一站：admin.ts 中 11 处 :id 路径参数与 4 处 :type 路径参数全部加前置校验。

### 已完成任务（1 个最小迭代单元）

13. **admin 路由 11 处 :id + 4 处 :type 路径参数全量补 UUID/枚举前置校验**（commit 1eeac15）
    - 文件：`server/src/routes/admin.ts`、`server/src/routes/__tests__/admin.test.ts`
    - 改动点（11 处 :id 路由 + 5 处 :type 路由，共 16 处校验）：
      - **:id UUID 前置校验（11 处）**：
        - `PUT /users/:id/ban`、`PUT /users/:id/unban`、`PUT /users/:id/role`
        - `PUT /content/:type/:id/status`、`GET /content/:type/:id`、`PUT /content/:type/:id`
        - `PUT /orders/:type/:id/cancel`
        - `PUT /reports/:id`、`PUT /verifications/:id`、`PUT /deletion-requests/:id`
      - **:type 枚举白名单校验（4 处，CONTENT_TYPES / ORDER_TYPES）**：
        - `PUT /content/:type/:id/status`、`POST /content/:type/batch-status`、`GET /content/:type/:id`、`PUT /content/:type/:id`
        - `PUT /orders/:type/:id/cancel`
    - 设计原因（与 users.ts/address.ts/emergency.ts 一致）：
      - 原 /:id 与 /:type 路径参数未做格式校验，依赖 service 层 query 返回空时抛 NotFoundError/BadRequestError 兜底
      - 非法值（如 'u1'、'not-a-uuid'、'invalid-type'）会走完整个 service 调用链才返回 404/400，错误响应语义错位（参数格式错误应 422 而非 404/400）
      - 路由层前置校验可降低 service 防御压力、改善错误响应语义、避免无效 DB 查询
    - 测试同步更新：
      - 在测试文件顶部定义 7 个 UUID v4 常量（USER_UUID/CONTENT_UUID/CONTENT_UUID_2/ORDER_UUID/REPORT_UUID/VERIFICATION_UUID/DELETION_UUID），按业务实体类型分别命名避免跨用例混淆
      - 将路径参数 fixture 中 'u1'/'c1'/'o1'/'r1'/'v1'/'d1' 全部替换为合法 UUID（batch-ban 的 body.userIds 不受影响，保留 'u1'/'u2' 风格）
      - 新增 10 个防御性测试用例，覆盖 11 处 :id 路由的非法 UUID 场景与 4 处 :type 路由的非法枚举场景，验证 mock service 均未被调用
    - 验收：
      - 后端 tsc --noEmit ✅ 通过
      - 后端 admin.test.ts 单文件 ✅ 81 测试全通过（原 72 + 新增 9 个 UUID/type 防御性测试，加上 1 个 batch-status :type 防御 = 10 个新增）
      - 后端全量 vitest run --no-coverage ✅ 81 文件 1796 测试全通过（duration 20.00s）

### 五轮总结

本轮共完成 1 个迭代单元（commit 1eeac15），属于 Phase3 技术债清理的 routes 层 :id 校验补全最后一站。

| 路由 | 改动类型 | commit |
| --- | --- | --- |
| admin.ts PUT /users/:id/ban | 加 uuidParam 前置校验 | 1eeac15 |
| admin.ts PUT /users/:id/unban | 加 uuidParam 前置校验 | 1eeac15 |
| admin.ts PUT /users/:id/role | 在 validate 中追加 uuidParam | 1eeac15 |
| admin.ts PUT /content/:type/:id/status | 追加 enumParam+uuidParam | 1eeac15 |
| admin.ts POST /content/:type/batch-status | 追加 enumParam | 1eeac15 |
| admin.ts GET /content/:type/:id | 新增 validate 含 enumParam+uuidParam | 1eeac15 |
| admin.ts PUT /content/:type/:id | 新增 validate 含 enumParam+uuidParam | 1eeac15 |
| admin.ts PUT /orders/:type/:id/cancel | 追加 enumParam+uuidParam | 1eeac15 |
| admin.ts PUT /reports/:id | 在 validate 中追加 uuidParam | 1eeac15 |
| admin.ts PUT /verifications/:id | 在 validate 中追加 uuidParam | 1eeac15 |
| admin.ts PUT /deletion-requests/:id | 在 validate 中追加 uuidParam | 1eeac15 |

### 验证结果

- 后端类型检查：✅ tsc --noEmit 通过（直接调用 node ../node_modules/typescript/bin/tsc，绕开 npx CryptnetUrlCache 沙箱拦截）
- 后端单元测试：✅ 81 文件 1796 测试全通过（duration 20.00s，--no-coverage 规避 v8 插桩并发问题）
- 前端构建：本轮无前端改动，基线保持

### 关键技术决策

1. **路径参数 fixture 全量切换为合法 UUID**：
   - 原 admin.test.ts 使用 'u1'/'c1'/'o1'/'r1'/'v1'/'d1' 等非 UUID 字符串作为 :id fixture
   - 加前置 UUID 校验后这些 fixture 在路由层就会被 422 拦截，无法进入 service mock 验证路径
   - 修复方案：在测试文件顶部统一定义 7 个 UUID v4 常量按业务实体命名（USER_UUID/CONTENT_UUID/...），全局替换路径参数中的非 UUID 字符串
2. **batch-ban 的 body.userIds 保留原 'u1'/'u2' fixture 不替换**：
   - body.userIds 是请求体字段，非路径参数，uuidParam 只校验 path 参数不校验 body
   - 全量替换 body fixture 会引入大量无意义改动且偏离测试意图（测的是 batch-ban 业务逻辑而非 UUID 校验）
   - 保留原 fixture 同时保持测试焦点清晰
3. **:id 校验放在 :type 校验之后**：
   - validate 中间件按数组顺序执行，express-validator 的 Promise.all 并发跑完后由 validationResult 汇总错误
   - 实际无执行顺序差异（错误都汇总到一起），但语义上 :type 先行更符合「路由分发 → 资源定位」的逻辑链
4. **新增 10 个防御性测试，覆盖 11 处 :id 与 4 处 :type**：
   - 每处路由至少 1 个非法值测试，验证 mock service 未被调用
   - 双参数路由（/content/:type/:id/*、/orders/:type/:id/cancel）分别测 :type 非法与 :id 非法两个独立场景
   - 10 个测试用例对应：1(ban) + 2(content/status type+id) + 1(batch-status type) + 1(content detail id) + 2(orders/cancel type+id) + 1(report id) + 1(verification id) + 1(deletion id)
5. **保留 auditMiddleware 在 validate 之后**：
   - 中间件执行顺序：`authenticate → validate → auditMiddleware → asyncHandler(handler)`
   - 校验失败时不进入 auditMiddleware，避免记录「未到达 handler 的失败请求」污染审计日志
   - 与 users.ts/address.ts 路由的中间件链顺序一致

### Git 提交记录（五轮）

- `1eeac15` feat: admin 路由 :id/:type 路径参数全量补 UUID 与枚举前置校验

### 遗留问题

无阻塞性遗留问题。剩余技术债清理项（routes 层 :id/:type 校验已清零，下一站可选）：

1. **其他 routes 模块的路径参数校验扫描**：emergency.ts/orders.ts/skill.ts/kitchen.ts/time-bank.ts 等是否仍有 :id 路径未做 UUID 校验（前序已完成 users/address/emergency map 部分）
2. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：见上轮遗留问题

### 下一轮建议

继续推进 Phase3 技术债清理：

1. **扫描剩余 routes 模块**：emergency.ts 资源路由 :id、orders.ts/skill.ts 订单 :id、kitchen.ts 菜品 :id、time-bank.ts 交易 :id 是否已全量补 UUID 校验
2. **service 层兜底校验复核**：确认所有 service 层对 :id 的 NotFoundError 兜底是否仍保留（路由层校验不应替代 service 层防御）
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）
