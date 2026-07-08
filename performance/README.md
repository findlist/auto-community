# k6 性能测试指南

本目录包含项目性能测试相关的脚本、配置和报告模板。

## 目录结构

```
performance/
├── config/
│   └── test-config.json          # 测试配置文件
├── scripts/
│   ├── api-load-test.js          # API 接口负载测试脚本
│   └── websocket-test.js         # WebSocket 并发测试脚本
├── reports/
│   └── report-template.md        # 测试报告模板
└── README.md                     # 本文件
```

## 1. k6 安装

### Windows

使用 Chocolatey：
```bash
choco install k6
```

或者使用 Scoop：
```bash
scoop install k6
```

或者直接下载二进制文件：
1. 访问 https://github.com/grafana/k6/releases
2. 下载最新的 Windows 64-bit 版本
3. 解压并将 k6.exe 添加到 PATH

### macOS

使用 Homebrew：
```bash
brew install k6
```

### Linux

使用包管理器：

**Debian/Ubuntu：**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**RHEL/CentOS：**
```bash
sudo rpm --import https://dl.k6.io/repomd.txt
sudo tee /etc/yum.repos.d/k6.repo <<EOF
[k6]
name=k6
baseurl=https://dl.k6.io/rpm/
enabled=1
gpgcheck=1
gpgkey=https://dl.k6.io/repomd.txt
EOF
sudo yum install k6
```

### 验证安装

```bash
k6 version
```

## 2. 配置说明

测试配置文件位于 `config/test-config.json`，包含以下内容：

- **baseUrl**: 后端服务地址，默认 `http://localhost:3000`
- **testUser**: 测试用户凭据
- **scenarios**: 测试场景配置
  - `smoke`: 冒烟测试，5 个虚拟用户，持续 30 秒
  - `load`: 负载测试，阶梯式增加用户
  - `stress`: 压力测试，高负载测试系统极限
- **thresholds**: 性能阈值
  - 95% 请求响应时间 < 500ms
  - 错误率 < 1%

可以通过环境变量 `BASE_URL` 覆盖配置文件中的 baseUrl。

## 3. 执行测试

### API 接口负载测试

**运行冒烟测试：**
```bash
k6 run --env BASE_URL=http://localhost:3000 scripts/api-load-test.js
```

**运行负载测试：**
```bash
k6 run --env BASE_URL=http://localhost:3000 --config config/test-config.json scripts/api-load-test.js
```

**运行压力测试：**
```bash
k6 run --env BASE_URL=http://localhost:3000 --config config/test-config.json scripts/api-load-test.js
```

### WebSocket 并发测试

**运行 WebSocket 测试：**
```bash
k6 run --env BASE_URL=http://localhost:3000 scripts/websocket-test.js
```

### 输出测试报告

**生成 JSON 报告：**
```bash
k6 run --out json=results.json scripts/api-load-test.js
```

**生成 HTML 报告（需要额外工具）：**
```bash
k6 run --out json=results.json scripts/api-load-test.js
# 然后使用 k6-reporter 将 JSON 转换为 HTML
```

## 4. 测试报告解读

### 关键指标说明

- **http_req_duration**: HTTP 请求响应时间
  - `avg`: 平均响应时间
  - `med` (P50): 中位数响应时间
  - `p(90)`: 90% 请求的响应时间
  - `p(95)`: 95% 请求的响应时间（重点关注）
  - `p(99)`: 99% 请求的响应时间
  - `max`: 最大响应时间

- **http_reqs**: 每秒请求数 (RPS)，反映系统吞吐量

- **http_req_failed**: 请求失败率，应低于 1%

- **vus`: 虚拟用户数，反映并发负载

- **iterations`: 完成的测试迭代次数

### 性能基准

| 指标 | 优秀 | 良好 | 需要优化 |
|------|------|------|----------|
| P95 响应时间 | < 200ms | 200-500ms | > 500ms |
| 错误率 | < 0.1% | 0.1-1% | > 1% |
| 吞吐量 | > 1000 RPS | 500-1000 RPS | < 500 RPS |

## 5. 常见性能瓶颈及优化建议

### 数据库瓶颈

**症状：**
- 响应时间随并发增加而显著上升
- 数据库 CPU 使用率高
- 慢查询日志中有大量超时查询

**优化建议：**
1. 添加适当的索引
2. 优化查询语句，避免全表扫描
3. 使用连接池
4. 考虑读写分离
5. 对热点数据使用缓存

### 应用服务器瓶颈

**症状：**
- 服务器 CPU 使用率持续高于 80%
- 内存使用率持续增长
- 请求队列堆积

**优化建议：**
1. 代码性能分析，找出热点函数
2. 优化算法复杂度
3. 使用异步处理非关键任务
4. 增加服务器实例（水平扩展）
5. 使用负载均衡

### 网络瓶颈

**症状：**
- 响应时间波动大
- 带宽使用率高
- 连接超时增多

**优化建议：**
1. 启用 gzip 压缩
2. 使用 CDN
3. 优化数据传输大小
4. 使用 HTTP/2
5. 连接复用

### Redis 缓存瓶颈

**症状：**
- 缓存命中率低
- Redis 延迟高
- 内存使用率高

**优化建议：**
1. 优化缓存策略
2. 设置合理的过期时间
3. 使用缓存预热
4. 监控缓存命中率
5. 考虑集群部署

### WebSocket 连接瓶颈

**症状：**
- 连接建立缓慢
- 消息延迟高
- 连接频繁断开

**优化建议：**
1. 优化连接握手过程
2. 使用心跳机制保持连接
3. 合理设置超时时间
4. 使用连接池
5. 考虑使用消息队列解耦

## 6. 持续集成

可以将性能测试集成到 CI/CD 流程中：

```yaml
# GitHub Actions 示例
- name: Run Performance Tests
  run: |
    k6 run --env BASE_URL=${{ secrets.BASE_URL }} scripts/api-load-test.js
```

## 7. 注意事项

1. **测试环境**：确保测试环境与生产环境配置相似
2. **测试数据**：使用真实的测试数据，避免使用生产数据
3. **网络环境**：确保测试机与服务器网络稳定
4. **监控**：测试时同时监控服务器资源使用情况
5. **逐步加压**：避免一次性施加过大压力
6. **清理数据**：测试后清理测试数据，避免影响其他测试

## 8. 扩展阅读

- [k6 官方文档](https://k6.io/docs/)
- [k6 最佳实践](https://k6.io/docs/testing-guides/best-practices/)
- [性能测试指标详解](https://k6.io/docs/using-k6/metrics/)