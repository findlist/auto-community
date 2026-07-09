# 邻里圈自动迭代进度 — 2026-07-09

## 本轮迭代摘要
- 调度时间：2026-07-09 11:30 起
- 健康度预检：后端 tsc ✅ | 后端 vitest 1445 用例全过 ✅ | 前端 build ✅
- 核心结论：Phase 1 收尾 2 项 P0 任务落地完成

## 完成任务清单

### P0-1 应急资源地图页（已落地，本轮核查确认）
- 文件：[client/src/pages/Emergency/ResourceMap.tsx](file:///e:/work/auto-community/client/src/pages/Emergency/ResourceMap.tsx)
- 已实现能力：
  - 高德地图点位渲染（用户定位 + 资源点位 + 自动 fitView）
  - 信息窗体（资源名称/类型/距离/地址/联系方式 + 导航按钮）
  - 一键唤起高德导航 URI（uri.amap.com/navigation）
  - **降级模式**：无 `window._AMAP_KEY` 时跳过脚本加载，列表占满宽度展示，完整保留距离/导航/筛选业务逻辑
  - Haversine 球面距离计算（不依赖高德几何插件）
  - 类型筛选、骨架屏、空状态、错误重试完整状态覆盖
- 测试：[client/src/pages/Emergency/__tests__/ResourceMap.test.tsx](file:///e:/work/auto-community/client/src/pages/Emergency/__tests__/ResourceMap.test.tsx) 8 用例全过
- 路由注册：`/emergency/resources/map` 已挂载（App.tsx 第 80 行）

### P0-2 CD 流水线闭环补全
- 既有问题：cd.yml 引用 `docker compose pull` 但仅 docker-compose.yml 用 `build:` 而非 `image:`，远程 pull 会失败；docker-compose.yml 缺 REDIS_DB 等环境变量传递
- 修复内容：
  1. 新增 [docker-compose.prod.yml](file:///e:/work/auto-community/docker-compose.prod.yml)：使用 GHCR 镜像（`image:` 字段），支持 `SERVER_IMAGE_TAG`/`CLIENT_IMAGE_TAG`/`GHCR_OWNER` 变量；生产环境不暴露 DB/Redis 端口
  2. [docker-compose.yml](file:///e:/work/auto-community/docker-compose.yml) 补 REDIS_DB、PII_ENCRYPT_KEY、AI_API_KEY、AI_API_BASE、AI_MODEL、AMAP_KEY 环境变量
  3. [.env.example](file:///e:/work/auto-community/.env.example) 补 REDIS_DB 配置说明
  4. [.github/workflows/cd.yml](file:///e:/work/auto-community/.github/workflows/cd.yml) 调整：
     - staging 部署显式 `-f docker-compose.prod.yml`，统一拉 latest tag
     - production 部署支持 tag 推送（自动去 'v' 前缀）与 workflow_dispatch 手动指定版本号
     - 新增 `version` workflow_dispatch 输入参数，便于手动回滚
     - GHCR_OWNER 变量化，从 vars.GHCR_OWNER 取值，fallback 到 github.repository_owner

## 修改文件清单
- 新增：`docker-compose.prod.yml`
- 修改：`docker-compose.yml`、`.env.example`、`.github/workflows/cd.yml`
- 既有未提交（上轮遗留，本轮合并提交）：`server/src/config/env.ts`、`server/src/config/redis.ts`（REDIS_DB 支持）

## 验证结果
- 后端 tsc --noEmit ✅
- 后端 vitest run 1445/1445 ✅
- 前端 npm run build ✅
- 前端 ResourceMap.test.tsx 8/8 ✅

## 遗留问题
- 高德地图 Key 实际未配置（AMAP_KEY 为空），生产部署后地图页将运行在降级模式，需运维方在 .env 中配置 AMAP_KEY 与前端 `window._AMAP_KEY` 后启用地图渲染
- CD 流水线依赖 GitHub Secrets 与远程服务器 GHCR 登录态，部署前需在仓库 Settings → Secrets 配置 STAGING_*/PRODUCTION_* 凭据，并完成 `docker login ghcr.io`
- GHCR_OWNER 建议在仓库 Variables 中显式配置，避免依赖默认 repository_owner（含大小写敏感问题）

## 下一轮迭代建议
Phase 1 已全部收尾验收通过，可进入 Phase 2 P1 任务队列，建议优先级：
1. 管理后台数据报表图表可视化（Dashboard 接入 recharts）—— 视觉价值高，快速产出
2. 后端数据 CSV/Excel 导出能力（ExportButton 组件已就绪，需补后端导出接口）
3. 系统配置管理页面完善（已有 SystemConfig 页面骨架，需对接后端 site_settings）
4. 技能交换 AI 推荐前端入口（后端 /api/ai/match 已就绪）
5. 时间银行家庭绑定管理页（已存在 FamilyBinding 页面，需对接解绑 API）
6. 时间币捐赠业务逻辑完善（DonateModal 已存在，需补全事务）
7. 邮件/短信通知通道接入（notification-channels.ts 已就绪，需对接第三方）
8. OSS 图片上传集成（storage-adapter.ts 已就绪，需对接云存储）

## 阶段判定
- ✅ Phase 1 完成（2 项 P0 全部落地 + 后端零类型错误 + 全量测试通过 + 前端构建零错误）
- 下一轮自动切换至 Phase 2 迭代队列
