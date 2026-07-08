# 时间银行模块 - 规格说明

## 1. 模块概述

### 1.1 定位
时间银行模块是「邻里圈」最具社会价值的模块，通过"时间货币"概念实现跨代互助养老，让年轻时的付出在年老时得到回报。

### 1.2 核心价值
- **跨代互助**：年轻人帮老人，老人传授经验
- **时间储蓄**：年轻时存时间，年老时取时间
- **亲情联动**：子女可为父母远程尽孝
- **社会价值**：缓解老龄化社会的养老压力

### 1.3 典型场景
- 大学生小陈陪王奶奶聊天2小时 → 存入2小时时间币
- 小陈把时间币转赠给外地工作的父母
- 父母用时间币兑换邻居提供的陪诊服务
- 李爷爷教小朋友们书法，获得时间币，兑换年轻人的买菜服务

---

## 2. 功能清单

### 2.1 核心功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 发布服务 | P0 | 发布可提供的服务（陪聊、教课、买菜等） |
| 发布需求 | P0 | 发布需要的服务 |
| 时间存取 | P0 | 完成服务后存入/取出时间币 |
| 时间转赠 | P1 | 将时间币转赠给他人（如父母） |
| 亲情绑定 | P1 | 子女绑定父母账号，远程管理 |
| 服务匹配 | P0 | AI 智能匹配服务供需 |
| 服务记录 | P0 | 查看服务历史记录 |
| 评价系统 | P0 | 对服务进行评价打分 |
| 资质认证 | P1 | 服务者资质认证 |

### 2.2 管理功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 服务审核 | P0 | 审核发布的服务信息 |
| 用户管理 | P0 | 管理用户账号 |
| 资质审核 | P1 | 审核服务者资质 |
| 数据统计 | P1 | 服务数据统计分析 |

---

## 3. 数据模型

### 3.1 服务表 (time_services)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 发布者 |
| type | ENUM | 是 | offer(提供) / need(需求) |
| category | VARCHAR(50) | 是 | 服务类别（陪聊/教课/买菜/陪诊等） |
| title | VARCHAR(100) | 是 | 服务标题 |
| description | TEXT | 否 | 服务描述 |
| duration | INTEGER | 是 | 预计时长（分钟） |
| location | POINT | 是 | 地理位置 |
| address | VARCHAR(200) | 是 | 详细地址 |
| certification | JSON | 否 | 资质证明 |
| status | ENUM | 是 | active/matched/completed/closed |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |
| deleted_at | TIMESTAMP | 否 | 软删除时间 |

### 3.2 时间账户表 (time_accounts)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 用户 |
| balance | INTEGER | 是 | 时间余额（分钟） |
| total_earned | INTEGER | 是 | 累计获得 |
| total_spent | INTEGER | 是 | 累计消费 |
| updated_at | TIMESTAMP | 是 | 更新时间 |

### 3.3 时间交易表 (time_transactions)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| service_id | UUID | 否 | 关联服务（转赠时为空） |
| from_user_id | UUID | 是 | 支付方 |
| to_user_id | UUID | 是 | 接收方 |
| amount | INTEGER | 是 | 时间数量（分钟） |
| type | ENUM | 是 | earn/spend/transfer/donate |
| status | ENUM | 是 | pending/completed/cancelled |
| remark | TEXT | 否 | 备注 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| completed_at | TIMESTAMP | 否 | 完成时间 |

### 3.4 亲情绑定表 (family_bindings)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 子女账号 |
| parent_id | UUID | 是 | 父母账号 |
| relationship | VARCHAR(20) | 是 | 关系（父亲/母亲） |
| status | ENUM | 是 | pending/confirmed/rejected |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |

### 3.5 服务评价表 (time_reviews)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| service_id | UUID | 是 | 关联服务 |
| reviewer_id | UUID | 是 | 评价人 |
| reviewee_id | UUID | 是 | 被评价人 |
| rating | INTEGER | 是 | 评分(1-5) |
| content | TEXT | 否 | 评价内容 |
| created_at | TIMESTAMP | 是 | 创建时间 |

### 3.6 服务纠纷表 (service_disputes)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| service_id | UUID | 是 | 关联服务 |
| reporter_id | UUID | 是 | 举报人 |
| reason | VARCHAR(200) | 是 | 纠纷原因 |
| description | TEXT | 否 | 详细描述 |
| evidence | JSON | 否 | 证据材料 |
| status | ENUM | 是 | pending/processing/resolved/rejected |
| resolution | TEXT | 否 | 处理结果 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| resolved_at | TIMESTAMP | 否 | 解决时间 |

---

## 4. API 设计

### 4.1 服务接口

#### 发布服务
```
POST /api/time-services
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "type": "offer",  // offer: 提供, need: 需求
  "category": "陪聊",
  "title": "陪老人聊天解闷",
  "description": "有耐心，会聊天，可以陪老人散步、下棋",
  "duration": 120,  // 2小时
  "location": {
    "lat": 39.9042,
    "lng": 116.4074
  },
  "address": "北京市朝阳区xxx小区",
  "certification": {  // 可选，资质证明
    "type": "health_care",
    "number": "123456",
    "image": "url"
  }
}

响应：
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "uuid",
    "created_at": "2026-06-16T10:00:00Z"
  }
}
```

#### 获取服务列表
```
GET /api/time-services?type=offer&category=陪聊&page=1&page_size=20
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "total": 30,
    "page": 1,
    "page_size": 20,
    "list": [
      {
        "id": "uuid",
        "type": "offer",
        "category": "陪聊",
        "title": "陪老人聊天解闷",
        "duration": 120,
        "certification": {
          "type": "health_care",
          "verified": true
        },
        "user": {
          "id": "uuid",
          "nickname": "小陈",
          "avatar": "url",
          "reputation_score": 4.8
        },
        "distance": 300
      }
    ]
  }
}
```

### 4.2 时间账户接口

#### 查询时间余额
```
GET /api/time-accounts/balance
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "balance": 480,  // 分钟
    "total_earned": 1200,
    "total_spent": 720
  }
}
```

#### 时间转赠
```
POST /api/time-accounts/transfer
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "to_user_id": "uuid",
  "amount": 120,  // 分钟
  "message": "给爸妈存的时间"
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

### 4.3 亲情绑定接口

#### 发起绑定请求
```
POST /api/family-bindings
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "parent_phone": "13800138000",
  "relationship": "母亲"
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

#### 确认绑定
```
PUT /api/family-bindings/:id/confirm
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "status": "confirmed"
  }
}
```

### 4.4 服务完成接口

#### 确认服务完成
```
PUT /api/time-services/:id/complete
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "actual_duration": 120,  // 实际时长（分钟）
  "rating": 5,
  "review": "小陈很耐心，陪我妈聊了2小时"
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "time_earned": 120,
    "status": "completed"
  }
}
```

### 4.5 纠纷接口

#### 提交纠纷
```
POST /api/service-disputes
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "service_id": "uuid",
  "reason": "服务质量问题",
  "description": "服务者迟到1小时，且服务态度不好",
  "evidence": ["image_url1", "image_url2"]
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

### 5.1 服务提供流程

```
用户发布服务 → 等待匹配 → 收到请求 → 接受 → 完成服务 → 存入时间币
```

### 5.2 服务需求流程

```
用户发布需求 → AI匹配 → 发起请求 → 等待响应 → 完成服务 → 支付时间币
```

### 5.3 亲情联动流程

```
子女绑定父母 → 父母确认 → 子女转赠时间币 → 父母使用时间币 → 兑换服务
```

### 5.4 纠纷处理流程

```
发现问题 → 提交纠纷 → 平台审核 → 调解协商 → 仲裁结果 → 执行
```

### 5.5 完整交互流程

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  小陈   │                    │  王奶奶  │                    │  小陈妈  │
│ (年轻人) │                    │ (老人)   │                    │ (外地)   │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │  1.小陈发布"陪聊服务"         │                              │
     │─────────────────────────────→│                              │
     │                              │                              │
     │  2.王奶奶发布"需要人陪聊"     │                              │
     │←─────────────────────────────│                              │
     │                              │                              │
     │  3.AI匹配，小陈发起请求       │                              │
     │←────────────────────────────→│                              │
     │                              │                              │
     │  4.线下陪聊2小时              │                              │
     │←────────────────────────────→│                              │
     │                              │                              │
     │  5.完成服务，小陈获得120分钟   │                              │
     │←────────────────────────────→│                              │
     │                              │                              │
     │  6.小陈转赠时间币给妈妈       │                              │
     │────────────────────────────────────────────────────────────→│
     │                              │                              │
     │  7.妈妈用时间币兑换邻居服务   │                              │
     │←────────────────────────────────────────────────────────────│
```

---

## 6. AI 能力应用

### 6.1 服务匹配算法

```python
def match_time_service(user_need, service_list):
    """匹配时间服务"""
    
    scored_services = []
    
    for service in service_list:
        score = 0
        
        # 1. 服务类别匹配（权重40%）
        if service.category == user_need.category:
            category_score = 1.0
        else:
            category_score = calculate_category_similarity(
                service.category, 
                user_need.category
            )
        score += category_score * 0.4
        
        # 2. 距离权重（权重30%）
        distance = calculate_distance(user_need.location, service.location)
        distance_score = max(0, 1 - distance / 3000)  # 3公里内满分
        score += distance_score * 0.3
        
        # 3. 服务者信誉（权重20%）
        reputation_score = service.user.reputation_score / 5
        score += reputation_score * 0.2
        
        # 4. 时间匹配度（权重10%）
        time_match = 1 - abs(service.duration - user_need.duration) / max(service.duration, user_need.duration)
        score += time_match * 0.1
        
        scored_services.append((service, score))
    
    return sorted(scored_services, key=lambda x: x[1], reverse=True)
```

### 6.2 智能分类

```
输入："需要人陪老人聊天，每周2次，每次2小时"
输出：
{
  "category": "陪聊",
  "frequency": "weekly",
  "times_per_week": 2,
  "duration_per_session": 120,
  "urgency": "normal"
}
```

---

## 7. 页面设计

### 7.1 核心页面列表

| 页面 | 功能 | 路由 |
|------|------|------|
| 服务广场 | 浏览所有服务 | /time-services |
| 服务详情 | 查看服务详情 | /time-services/:id |
| 发布服务 | 发布服务/需求 | /time-services/create |
| 时间账户 | 查看时间余额和记录 | /time-accounts |
| 亲情绑定 | 管理亲情绑定 | /family |
| 服务记录 | 查看服务历史 | /my/time-services |
| 纠纷处理 | 查看纠纷记录 | /my/disputes |

### 7.2 服务广场页面布局

```
┌─────────────────────────────────────┐
│  搜索框                    [筛选]    │
├─────────────────────────────────────┤
│  [提供] [需求] [全部]               │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ 👴 陪老人聊天 - 小陈            ││
│  │ 有耐心，会聊天，可以陪散步      ││
│  │ 时长: 2小时  📍 300m            ││
│  │ ⭐ 4.8分  ✅ 已认证              ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 📚 教书法 - 李爷爷              ││
│  │ ...                            ││
│  └─────────────────────────────────┘│
│  ...                               │
├─────────────────────────────────────┤
│  [首页] [服务] [+] [消息] [我的]    │
└─────────────────────────────────────┘
```

---

## 8. 时间币规则

### 8.1 时间币获取
| 行为 | 时间币 | 说明 |
|------|--------|------|
| 完成服务 | +服务时长 | 提供服务获得时间币 |
| 被好评 | +10分钟 | 获得5星好评 |
| 首次服务 | +30分钟 | 鼓励首次服务 |

### 8.2 时间币消耗
| 行为 | 时间币 | 说明 |
|------|--------|------|
| 使用服务 | -服务时长 | 使用服务消耗时间币 |
| 转赠他人 | -转赠金额 | 转赠给他人 |

### 8.3 特殊规则
- 最低余额：0分钟
- 每日上限：最多获得480分钟（8小时）
- 转赠无限制
- 时间币永不过期

---

## 9. 安全策略

### 9.1 服务安全
- 服务者需实名认证
- 服务过程可追溯
- 紧急联系人机制
- 服务者资质认证

### 9.2 内容审核
- 服务信息 AI 审核
- 敏感词过滤
- 人工复审可疑内容

### 9.3 交易安全
- 时间币托管机制
- 服务完成后自动结算
- 争议仲裁机制
- 纠纷处理流程

---

## 10. MVP 范围

### 第一阶段（P0）
- [ ] 用户注册登录
- [ ] 发布服务/需求
- [ ] 服务列表浏览
- [ ] 服务匹配
- [ ] 服务完成 + 时间币结算
- [ ] 基础评价功能
- [ ] 时间账户查询

### 第二阶段（P1）
- [ ] 亲情绑定功能
- [ ] 时间转赠功能
- [ ] AI 智能匹配
- [ ] 资质认证功能
- [ ] 纠纷处理流程
- [ ] 消息推送
- [ ] 数据统计
