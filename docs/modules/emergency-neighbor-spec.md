# 应急邻里模块 - 规格说明

## 1. 模块概述

### 1.1 定位
应急邻里模块是「邻里圈」最具社会价值的模块，聚焦社区紧急互助场景，让"远亲不如近邻"在关键时刻真正发挥作用。

### 1.2 核心价值
- **快速响应**：紧急时刻，邻居第一时间响应
- **资源整合**：社区应急资源地图，一目了然
- **安全保障**：为独居老人、有娃家庭提供安全保障
- **政府合作**：符合社区治理方向，有政策支持潜力

### 1.3 典型场景
- 深夜孩子发烧，一键求助附近邻居帮忙送医
- 家中水管爆裂，紧急寻找会修水管的邻居
- 独居老人突发疾病，邻居第一时间发现并救助
- 台风天气，社区互助排查安全隐患

---

## 2. 功能清单

### 2.1 核心功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 一键求助 | P0 | 紧急情况下一键发布求助 |
| 附近响应 | P0 | 300米内邻居即时收到推送 |
| 资源地图 | P0 | 社区应急资源位置（AED、灭火器等） |
| AI 分级 | P1 | 自动判断紧急程度，优先推送 |
| 日常互助 | P1 | 非紧急的日常帮忙需求 |
| 响应确认 | P0 | 邻居确认响应，避免重复响应 |
| 求助记录 | P0 | 查看求助历史记录 |
| 评价系统 | P0 | 对互助进行评价打分 |
| 紧急联系人 | P1 | 自动通知紧急联系人 |

### 2.2 管理功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 资源管理 | P0 | 管理社区应急资源 |
| 用户管理 | P0 | 管理用户账号 |
| 数据统计 | P1 | 互助数据统计分析 |
| 政府对接 | P2 | 与社区/街道数据对接 |

---

## 3. 数据模型

### 3.1 求助表 (emergency_requests)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 求助者 |
| type | ENUM | 是 | emergency(紧急) / daily(日常) |
| category | VARCHAR(50) | 是 | 类别（医疗/维修/安全/其他） |
| title | VARCHAR(100) | 是 | 求助标题 |
| description | TEXT | 否 | 求助描述 |
| urgency | ENUM | 是 | critical/high/medium/low |
| location | POINT | 是 | 地理位置 |
| address | VARCHAR(200) | 是 | 详细地址 |
| images | JSON | 否 | 现场图片 |
| is_anonymous | BOOLEAN | 是 | 是否匿名发布 |
| status | ENUM | 是 | open/responding/resolved/closed/false_report |
| resolved_at | TIMESTAMP | 否 | 解决时间 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |
| deleted_at | TIMESTAMP | 否 | 软删除时间 |

### 3.2 响应表 (emergency_responses)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| request_id | UUID | 是 | 关联求助 |
| user_id | UUID | 是 | 响应者 |
| message | TEXT | 否 | 响应留言 |
| eta | INTEGER | 否 | 预计到达时间（分钟） |
| status | ENUM | 是 | pending/accepted/arrived/completed/timeout |
| created_at | TIMESTAMP | 是 | 创建时间 |
| arrived_at | TIMESTAMP | 否 | 到达时间 |
| completed_at | TIMESTAMP | 否 | 完成时间 |
| timeout_at | TIMESTAMP | 否 | 超时时间 |

### 3.3 应急资源表 (emergency_resources)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| community_id | UUID | 是 | 所属社区 |
| type | VARCHAR(50) | 是 | 资源类型（AED/灭火器/工具箱等） |
| name | VARCHAR(100) | 是 | 资源名称 |
| description | TEXT | 否 | 资源描述 |
| location | POINT | 是 | 地理位置 |
| address | VARCHAR(200) | 是 | 详细地址 |
| contact_phone | VARCHAR(20) | 否 | 联系电话 |
| status | ENUM | 是 | available/maintenance/unavailable |
| last_check | TIMESTAMP | 否 | 最后检查时间 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |

### 3.4 互助评价表 (emergency_reviews)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| request_id | UUID | 是 | 关联求助 |
| reviewer_id | UUID | 是 | 评价人 |
| reviewee_id | UUID | 是 | 被评价人 |
| rating | INTEGER | 是 | 评分(1-5) |
| content | TEXT | 否 | 评价内容 |
| created_at | TIMESTAMP | 是 | 创建时间 |

### 3.5 社区表 (communities)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| name | VARCHAR(100) | 是 | 社区名称 |
| location | POINT | 是 | 社区中心位置 |
| address | VARCHAR(200) | 是 | 社区地址 |
| contact_phone | VARCHAR(20) | 否 | 社区联系电话 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |

### 3.6 虚假举报记录表 (false_reports)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 被举报用户 |
| request_id | UUID | 是 | 关联求助 |
| reason | VARCHAR(200) | 是 | 举报原因 |
| penalty | VARCHAR(50) | 是 | 处罚措施（warning/ban_7d/ban_30d/permanent） |
| created_at | TIMESTAMP | 是 | 创建时间 |

---

## 4. API 设计

### 4.1 求助接口

#### 发布求助
```
POST /api/emergency-requests
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "type": "emergency",  // emergency: 紧急, daily: 日常
  "category": "医疗",
  "title": "孩子发烧39度，需要帮忙送医",
  "description": "孩子突然发烧，家里没车，需要邻居帮忙送到医院",
  "urgency": "critical",
  "location": {
    "lat": 39.9042,
    "lng": 116.4074
  },
  "address": "北京市朝阳区xxx小区3号楼",
  "images": ["url1"],
  "is_anonymous": false
}

响应：
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "uuid",
    "status": "open",
    "push_count": 15,  // 推送人数
    "created_at": "2026-06-16T22:30:00Z"
  }
}
```

#### 获取附近求助
```
GET /api/emergency-requests/nearby?lat=39.9042&lng=116.4074&radius=500
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "list": [
      {
        "id": "uuid",
        "type": "emergency",
        "category": "医疗",
        "title": "孩子发烧39度，需要帮忙送医",
        "urgency": "critical",
        "user": {
          "id": "uuid",
          "nickname": "张先生",
          "avatar": "url"
        },
        "distance": 200,
        "status": "open",
        "created_at": "2026-06-16T22:30:00Z"
      }
    ]
  }
}
```

### 4.2 响应接口

#### 响应求助
```
POST /api/emergency-responses
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "request_id": "uuid",
  "message": "我马上开车过来，5分钟到",
  "eta": 5  // 预计到达时间（分钟）
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "status": "pending",
    "timeout_at": "2026-06-16T22:45:00Z"  // 15分钟超时
  }
}
```

#### 确认到达
```
PUT /api/emergency-responses/:id/arrive
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "status": "arrived"
  }
}
```

#### 完成互助
```
PUT /api/emergency-responses/:id/complete
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "rating": 5,
  "review": "非常感谢，及时送孩子去医院"
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "status": "completed"
  }
}
```

### 4.3 资源接口

#### 获取附近资源
```
GET /api/emergency-resources/nearby?lat=39.9042&lng=116.4074&radius=1000&type=AED
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "list": [
      {
        "id": "uuid",
        "type": "AED",
        "name": "小区物业AED",
        "description": "位于物业办公室门口",
        "location": {
          "lat": 39.9045,
          "lng": 116.4078
        },
        "address": "小区物业办公室",
        "distance": 300,
        "status": "available"
      }
    ]
  }
}
```

### 4.4 举报接口

#### 举报虚假求助
```
POST /api/false-reports
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "request_id": "uuid",
  "reason": "虚假求助",
  "description": "这个人经常发虚假求助，浪费大家时间"
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "status": "pending"
  }
}
```

---

## 5. 业务流程

### 5.1 紧急求助流程

```
用户发布求助 → AI分级 → 推送附近邻居 → 邻居响应 → 确认到达 → 完成互助 → 评价
```

### 5.2 日常互助流程

```
用户发布需求 → 等待邻居响应 → 接受响应 → 线下互助 → 完成 → 评价
```

### 5.3 响应超时处理流程

```
邻居响应 → 15分钟内未确认到达 → 自动取消响应 → 通知求助者 → 推送其他邻居
```

### 5.4 虚假举报处理流程

```
发现虚假求助 → 举报 → 平台审核 → 确认虚假 → 处罚用户 → 通知举报人
```

### 5.5 完整交互流程

```
┌─────────┐                    ┌─────────┐
│  张先生  │                    │  李女士  │
│ (求助者) │                    │ (响应者) │
└────┬────┘                    └────┬────┘
     │                              │
     │  1.发布紧急求助               │
     │  "孩子发烧，需要送医"         │
     │─────────────────────────────→│
     │                              │
     │  2.AI分级为"紧急"             │
     │  推送300米内15位邻居          │
     │─────────────────────────────→│
     │                              │
     │  3.李女士响应"5分钟到"        │
     │←─────────────────────────────│
     │                              │
     │  4.李女士到达，确认           │
     │←─────────────────────────────│
     │                              │
     │  5.送孩子去医院               │
     │←────────────────────────────→│
     │                              │
     │  6.完成互助                   │
     │←─────────────────────────────│
     │                              │
     │  7.评价"非常感谢"             │
     │─────────────────────────────→│
```

---

## 6. AI 能力应用

### 6.1 紧急程度分级

```python
def classify_urgency(request):
    """AI 判断紧急程度"""
    
    # 关键词匹配
    critical_keywords = ["发烧", "骨折", "出血", "昏迷", "火灾", "地震", "心脏"]
    high_keywords = ["漏水", "停电", "困住", "受伤", "中毒"]
    medium_keywords = ["帮忙", "修理", "搬运", "买药"]
    
    text = request.title + " " + request.description
    
    # 检查关键词
    if any(keyword in text for keyword in critical_keywords):
        return "critical"
    elif any(keyword in text for keyword in high_keywords):
        return "high"
    elif any(keyword in text for keyword in medium_keywords):
        return "medium"
    else:
        return "low"
```

### 6.2 智能推送策略

```python
def push_to_neighbors(request, radius=300):
    """推送求助给附近邻居"""
    
    # 1. 获取范围内邻居
    neighbors = get_neighbors_in_radius(request.location, radius)
    
    # 2. 按紧急程度调整推送范围
    if request.urgency == "critical":
        # 紧急情况，扩大推送范围
        radius = 500
        neighbors = get_neighbors_in_radius(request.location, radius)
    
    # 3. 筛选有能力响应的邻居
    capable_neighbors = []
    for neighbor in neighbors:
        # 检查是否有相关技能
        if has_relevant_skill(neighbor, request.category):
            capable_neighbors.append(neighbor)
    
    # 4. 优先推送给有技能的邻居
    push_order = capable_neighbors + [n for n in neighbors if n not in capable_neighbors]
    
    return push_order
```

### 6.3 虚假求助检测

```python
def detect_false_report(user, request):
    """检测虚假求助"""
    
    risk_score = 0
    
    # 1. 检查用户历史
    false_report_count = get_false_report_count(user.id)
    if false_report_count > 0:
        risk_score += false_report_count * 20
    
    # 2. 检查发布频率
    recent_requests = get_recent_requests(user.id, hours=24)
    if len(recent_requests) > 5:
        risk_score += 30
    
    # 3. 检查内容相似度
    for recent in recent_requests:
        similarity = calculate_text_similarity(request.description, recent.description)
        if similarity > 0.8:
            risk_score += 40
    
    # 4. 检查地理位置异常
    if is_location_anomaly(user.id, request.location):
        risk_score += 20
    
    return risk_score >= 60  # 风险分数超过60视为可疑
```

---

## 7. 页面设计

### 7.1 核心页面列表

| 页面 | 功能 | 路由 |
|------|------|------|
| 求助广场 | 浏览附近求助 | /emergency |
| 求助详情 | 查看求助详情 | /emergency/:id |
| 发布求助 | 发布求助/需求 | /emergency/create |
| 资源地图 | 查看应急资源 | /emergency/resources |
| 我的求助 | 查看求助历史 | /my/emergencies |
| 我的响应 | 查看响应历史 | /my/responses |

### 7.2 求助广场页面布局

```
┌─────────────────────────────────────┐
│  [紧急求助]              [资源地图]  │
├─────────────────────────────────────┤
│  [紧急] [日常] [全部]               │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ 🚨 孩子发烧39度 - 张先生        ││
│  │ 需要帮忙送医                    ││
│  │ 📍 200m  🕐 2分钟前             ││
│  │ 紧急程度: ⚠️ 紧急               ││
│  │ [立即响应]                      ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🔧 水管漏水 - 王阿姨            ││
│  │ ...                            ││
│  └─────────────────────────────────┘│
│  ...                               │
├─────────────────────────────────────┤
│  [首页] [求助] [+] [消息] [我的]    │
└─────────────────────────────────────┘
```

---

## 8. 推送策略

### 8.1 推送范围
| 紧急程度 | 推送范围 | 推送方式 |
|----------|---------|---------|
| critical | 500米内 | 即时推送 + 电话提醒 |
| high | 300米内 | 即时推送 |
| medium | 200米内 | 延迟推送 |
| low | 100米内 | 普通推送 |

### 8.2 推送优先级
1. 有相关技能的邻居
2. 信誉分高的邻居
3. 距离最近的邻居
4. 最近响应过的邻居

### 8.3 推送限制
- 每个用户每天最多接收20条推送
- 紧急求助无推送限制
- 避免打扰：23:00-7:00 只推送紧急求助

---

## 9. 积分规则

### 9.1 紧急互助积分
| 行为 | 积分 | 说明 |
|------|------|------|
| 完成紧急互助 | +100 | 响应紧急求助 |
| 完成日常互助 | +50 | 响应日常互助 |
| 被好评 | +10 | 获得5星好评 |

### 9.2 特殊奖励
| 行为 | 奖励 | 说明 |
|------|------|------|
| 月度之星 | +500 | 当月响应次数最多 |
| 急救英雄 | +1000 | 成功救助危急情况 |
| 社区贡献 | +200 | 录入应急资源信息 |

### 9.3 虚假举报处罚
| 次数 | 处罚 |
|------|------|
| 第1次 | 警告 |
| 第2次 | 禁言7天 |
| 第3次 | 禁言30天 |
| 第4次 | 永久封号 |

---

## 10. 安全策略

### 10.1 身份验证
- 所有用户需实名认证
- 紧急求助可匿名发布
- 响应者需验证身份

### 10.2 内容审核
- 求助信息 AI 审核
- 敏感词过滤
- 人工复审可疑内容

### 10.3 安全保障
- 紧急联系人机制
- 服务过程可追溯
- 争议仲裁机制
- 虚假举报惩罚机制

---

## 11. MVP 范围

### 第一阶段（P0）
- [ ] 用户注册登录
- [ ] 发布紧急求助
- [ ] 求助列表浏览
- [ ] 响应求助
- [ ] 响应确认（含超时处理）
- [ ] 基础评价功能
- [ ] 应急资源地图

### 第二阶段（P1）
- [ ] AI 紧急程度分级
- [ ] 智能推送策略
- [ ] 日常互助功能
- [ ] 紧急联系人自动通知
- [ ] 虚假举报处理
- [ ] 消息推送
- [ ] 数据统计

### 第三阶段（P2）
- [ ] 政府数据对接
- [ ] 社区管理系统
- [ ] 数据分析报表
