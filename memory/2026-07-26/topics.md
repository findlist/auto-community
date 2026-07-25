# 邻里圈项目迭代进度 - 2026-07-26

## 本轮迭代摘要（2026-07-26）

承接 2026-07-25 六轮迭代收尾（routes 层 :id UUID 校验清零 + 枚举查询参数白名单补全），本轮进入 **Phase3 技术债清理** 下一站：service 层防御性 bug 修复 + routes 层剩余参数校验补全。

本轮聚焦 P2 bug-check 遗留的「map 模块参数校验与 service 层防御」线，处理两类问题：

1. **service 层 falsy 判断误判 bug**：map.service.ts regeo 方法用 `!lng || !lat` 误判经纬度 0 值为本初子午线/赤道时为「缺失」，与 emergency.ts /map/regeo 路由层已修复的同源 bug 不一致
2. **routes 层无长度限制的字符串查询参数**：/map/geocode 接口接受任意长度 address 拼入高德 API URL，存在超长文本攻击风险

### 已完成任务（1 个最小迭代单元）

1. **修复 map.service regeo 经纬度 0 值误判 bug + 补 /map/geocode address 长度上限校验**（commit 885623a）
   - 文件：
     - `server/src/services/map.service.ts`（regeo 方法 falsy 判断修复）
     - `server/src/services/__tests__/map.service.test.ts`（测试用例同步更新）
     - `server/src/routes/emergency.ts`（/map/geocode 路由补 address 长度校验）
     - `server/src/routes/__tests__/emergency.test.ts`（新增 422 防御用例）
   - 改动点（2 处独立修复合并为一个最小迭代单元，因同属 map 模块参数校验线）：
     - **regeo 0 值误判 bug**：
       - 原代码 `if (!lng || !lat)` 在 `lng=0`（本初子午线）或 `lat=0`（赤道）时误判为缺失返回 null
       - 修复为 `if (!Number.isFinite(lng) || !Number.isFinite(lat))`，与 emergency.ts /map/regeo 路由层校验逻辑一致
       - 设计原因：0 是合法经纬度值（赤道/本初子午线），不应被 falsy 判断误判为缺失；Number.isFinite 显式校验 NaN/undefined，语义清晰
     - **/map/geocode address 长度校验**：
       - 新增 `query('address').optional().isLength({ max: 200 }).withMessage('地址长度不能超过 200 字符')`
       - 设计原因：原代码无长度限制，超长 address 会直接拼入高德 API URL，可能导致 URL 过长或请求超时；200 字符覆盖中国最长地址（约 50 字符）+ 国际化场景
   - 测试同步更新：
     - `map.service.test.ts`：原「经度或纬度为 0 时返回 null」改为「经度或纬度为 NaN 时返回 null」+ 新增「经度为 0（本初子午线）时为合法值不被拦截」回归用例
     - `emergency.test.ts`：新增「address 超长（>200 字符）返回 422，不调用 mapService」防御用例
   - 验收：
     - 后端 tsc --noEmit ✅ 通过
     - 后端全量 vitest run ✅ 通过（基线保持 1832 测试 + 新增 2 个 = 1834 测试）
     - 前端 build ✅ 通过

### 本轮总结

本轮共完成 1 个迭代单元（commit 885623a），属于 Phase3 技术债清理的 map 模块参数校验线。

| 文件 | 改动类型 | commit |
| --- | --- | --- |
| server/src/services/map.service.ts | regeo 0 值误判 bug 修复 | 885623a |
| server/src/services/__tests__/map.service.test.ts | 测试用例同步更新 | 885623a |
| server/src/routes/emergency.ts | /map/geocode address 长度校验 | 885623a |
| server/src/routes/__tests__/emergency.test.ts | 新增 422 防御用例 | 885623a |

### 验证结果

- 后端类型检查：✅ tsc --noEmit 通过
- 后端单元测试：✅ 全量通过（含新增 2 个用例）
- 前端构建：本轮无前端改动，基线保持

### 关键技术决策

1. **falsy 判断 vs Number.isFinite 显式校验**：
   - `!lng || !lat` 是 JavaScript 常见 falsy 判断模式，但对 0 值存在语义陷阱
   - 经纬度 0 是合法值（赤道/本初子午线），不应被 falsy 误判
   - `Number.isFinite` 显式校验 NaN/undefined，语义清晰，与 emergency.ts 路由层校验逻辑一致
   - 修复原则：service 层防御逻辑应与路由层校验逻辑对齐，避免「路由层放行 → service 层误判」的语义错位
2. **address 长度上限 200 字符的选择**：
   - 中国最长地址约 50 字符（省市区街道门牌号全称）
   - 200 字符覆盖国际化场景（含国家名、多语言地址）
   - 200 字符也是常见 Web 表单 address 字段的上限值（如 Stripe/Shopify 默认值）
   - 不影响正常业务，仅拦截明显异常的超长文本
3. **0 值 bug 与长度校验合并为一个迭代单元**：
   - 同属 map 模块参数校验线，逻辑相关
   - 改动文件重叠（emergency.ts 同时涉及 regeo 路由与 geocode 路由的测试）
   - 合并提交避免碎片化，但保留独立 commit message 描述两类修复
4. **测试用例必须同步更新避免回归**：
   - 原 map.service.test.ts 的「0 返回 null」用例在修复后会失败
   - 必须改为「NaN 返回 null」+ 新增「0 合法不被拦截」回归用例
   - 测试应跟随 bug 修复同步更新，否则会引入假阴性（测试通过但 bug 仍存在）或假阳性（测试失败但功能正确）

### Git 提交记录

- `885623a` fix: 修复 map.service regeo 经纬度 0 值误判 bug + 补 /map/geocode address 长度上限校验

### 遗留问题

无阻塞性遗留问题。剩余技术债清理项：

1. **service 层兜底校验复核**：确认所有 service 层对 :id 的 NotFoundError 兜底是否仍保留（路由层校验不应替代 service 层防御），本轮已复核 map.service，剩余 service 待抽查
2. **其他 routes 模块的字符串查询参数长度校验扫描**：本轮已补 /map/geocode address，其他 routes 是否存在无长度限制的字符串查询参数（如 search/keyword 等）
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）：
   - 5.1 P0 安全遗留：.env 历史 commit 含泄露凭据，需运维轮换 DB/Redis 密码与 JWT 密钥，并清理 git 历史
   - 5.2 P1 生产就绪验收：全页面移动端适配、CD 流水线 GitHub Secrets、高德地图 Key 配置等运维侧确认

### 下一轮建议

继续推进 Phase3 技术债清理：

1. **service 层兜底校验复核**：抽查 user.service/skill.service/kitchen.service 等关键 service 的 getById 等方法是否仍保留 NotFoundError 兜底，确认路由层前置校验未替代 service 层防御
2. **routes 层字符串查询参数长度校验扫描**：扫描所有 routes 中 `req.query.*` 用法，识别无长度限制的字符串查询参数（如 search/keyword/keyword 等），补 isLength 校验
3. **运维侧 P0/P1**（非 Agent 可推进，需用户介入）
