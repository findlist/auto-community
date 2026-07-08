# 技能交换模块 - 规格说明

## 1. 模块概述

### 1.1 定位
技能交换模块是「邻里圈」的核心模块，旨在让社区居民通过技能分享建立连接，实现"人人都是老师，人人都是学生"的互助理念。

### 1.2 核心价值
- **价值发现**：让每个人的技能都有价值
- **技能流通**：用技能换技能，用技能换积分
- **邻里连接**：通过互助建立真实的人际关系

### 1.3 典型场景
- 小王会修电脑 → 帮李阿姨修电脑 → 获得50积分
- 小王需要学吉他 → 用积分请张老师教课
- 张老师教吉他 → 获得积分 → 请小王帮忙搬家

---

## 2. 功能清单

### 2.1 用户功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 发布"我能帮" | P0 | 用户发布自己可以提供的技能 |
| 发布"我需要" | P0 | 用户发布自己需要的帮助 |
| 浏览技能列表 | P0 | 查看社区内的技能供需 |
| 搜索技能 | P0 | 关键词搜索特定技能 |
| 智能推荐 | P1 | AI 推荐匹配的技能/需求 |
| 发起互助 | P0 | 选择对象发起互助请求 |
| 接受/拒绝 | P0 | 响应互助请求 |
| 即时通讯 | P0 | 互助双方在线沟通（WebSocket） |
| 互助确认 | P0 | 完成互助后双方确认 |
| 积分结算 | P0 | 自动完成积分转移 |
| 互评打分 | P0 | 互助完成后互相评价 |
| 举报功能 | P1 | 举报虚假或违规信息 |

### 2.2 管理功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 技能分类管理 | P0 | 管理技能类别 |
| 内容审核 | P0 | 审核发布的技能信息 |
| 用户管理 | P0 | 管理用户账号 |
| 数据统计 | P1 | 互助数据统计分析 |

---

## 3. 数据模型

### 3.1 技能表 (skills)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 发布用户 |
| type | ENUM | 是 | offer(提供) / need(需求) |
| category_id | UUID | 是 | 技能类别 |
| title | VARCHAR(100) | 是 | 标题 |
| description | TEXT | 是 | 描述 |
| credit_price | INTEGER | 否 | 积分价格（提供时） |
| location | POINT | 是 | 地理位置 |
| address | VARCHAR(200) | 是 | 详细地址 |
| images | JSON | 否 | 图片列表 |
| status | ENUM | 是 | active / closed / expired |
| view_count | INTEGER | 是 | 浏览次数，默认0 |
| contact_count | INTEGER | 是 | 联系次数，默认0 |
| expires_at | TIMESTAMP | 否 | 过期时间 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |
| deleted_at | TIMESTAMP | 否 | 软删除时间 |

### 3.2 技能类别表 (skill_categories)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| name | VARCHAR(50) | 是 | 类别名称 |
| icon | VARCHAR(200) | 否 | 图标 URL |
| parent_id | UUID | 否 | 父类别（支持二级分类） |
| sort_order | INTEGER | 是 | 排序顺序 |

### 3.3 互助记录表 (help_records)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| skill_id | UUID | 是 | 关联技能 |
| requester_id | UUID | 是 | 请求方 |
| provider_id | UUID | 是 | 提供方 |
| credit_amount | INTEGER | 是 | 积分金额 |
| status | ENUM | 是 | pending/accepted/rejected/completed/cancelled |
| request_message | TEXT | 否 | 请求留言 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |
| completed_at | TIMESTAMP | 否 | 完成时间 |

### 3.4 评价表 (reviews)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| help_record_id | UUID | 是 | 关联互助记录 |
| reviewer_id | UUID | 是 | 评价人 |
| reviewee_id | UUID | 是 | 被评价人 |
| rating | INTEGER | 是 | 评分(1-5) |
| content | TEXT | 否 | 评价内容 |
| created_at | TIMESTAMP | 是 | 创建时间 |

### 3.5 消息表 (messages)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| help_record_id | UUID | 是 | 关联互助记录 |
| sender_id | UUID | 是 | 发送者 |
| receiver_id | UUID | 是 | 接收者 |
| content | TEXT | 是 | 消息内容 |
| type | ENUM | 是 | text/image/system |
| is_read | BOOLEAN | 是 | 是否已读，默认false |
| created_at | TIMESTAMP | 是 | 创建时间 |

---

## 4. API 设计

### 4.1 技能相关接口

#### 发布技能
```
POST /api/skills
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "type": "offer",  // offer: 提供, need: 需求
  "category_id": "uuid",
  "title": "专业电脑维修",
  "description": "10年电脑维修经验，擅长系统重装、硬件维修...",
  "credit_price": 50,  // 提供技能时的价格
  "location": {
    "lat": 39.9042,
    "lng": 116.4074
  },
  "address": "北京市朝阳区xxx小区",
  "images": ["url1", "url2"]
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

#### 获取技能列表
```
GET /api/skills?type=offer&category_id=uuid&page=1&page_size=20
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "total": 100,
    "page": 1,
    "page_size": 20,
    "list": [
      {
        "id": "uuid",
        "type": "offer",
        "title": "专业电脑维修",
        "description": "...",
        "credit_price": 50,
        "user": {
          "id": "uuid",
          "nickname": "小王",
          "avatar": "url",
          "reputation_score": 4.8
        },
        "distance": 500
      }
    ]
  }
}
```

### 4.2 互助相关接口

#### 发起互助请求
```
POST /api/help-requests
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "skill_id": "uuid",
  "message": "您好，我家电脑开不了机，能帮忙看看吗？"
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

#### 响应互助请求
```
PUT /api/help-requests/:id/response
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "action": "accept",  // accept: 接受, reject: 拒绝
  "message": "好的，我下午过去看看"
}
```

#### 确认完成互助
```
PUT /api/help-requests/:id/complete
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "rating": 5,  // 评分 1-5
  "review": "非常专业，修得很好！"
}
```

### 4.3 消息接口

#### 发送消息
```
POST /api/messages
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "help_record_id": "uuid",
  "content": "好的，我下午2点过去",
  "type": "text"  // text/image/system
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "created_at": "2026-06-16T10:00:00Z"
  }
}
```

#### 获取聊天记录
```
GET /api/messages?help_record_id=uuid&page=1&page_size=50
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "total": 20,
    "list": [
      {
        "id": "uuid",
        "sender_id": "uuid",
        "content": "好的，我下午2点过去",
        "type": "text",
        "is_read": true,
        "created_at": "2026-06-16T10:00:00Z"
      }
    ]
  }
}
```

---

## 5. 业务流程

### 5.1 技能提供流程

```
用户发布技能 → 技能上架 → 等待匹配 → 收到请求 → 接受/拒绝 → 完成互助 → 获得积分
```

### 5.2 技能需求流程

```
用户发布需求 → 需求上架 → AI推荐匹配 → 发起请求 → 等待响应 → 完成互助 → 消耗积分
```

### 5.3 完整交互流程

```
┌─────────┐                    ┌─────────┐
│  用户A  │                    │  用户B  │
│(技能提供)│                    │(技能需求)│
└────┬────┘                    └────┬────┘
     │                              │
     │  1.发布"我能帮修电脑"          │
     │─────────────────────────────→│
     │                              │
     │  2.搜索"电脑维修"             │
     │←─────────────────────────────│
     │                              │
     │  3.发起互助请求               │
     │←─────────────────────────────│
     │                              │
     │  4.接受请求                   │
     │─────────────────────────────→│
     │                              │
     │  5.即时通讯沟通细节            │
     │←────────────────────────────→│
     │                              │
     │  6.线下完成互助               │
     │←────────────────────────────→│
     │                              │
     │  7.双方确认完成               │
     │←────────────────────────────→│
     │                              │
     │  8.积分自动结算               │
     │←────────────────────────────→│
     │                              │
     │  9.互评打分                   │
     │←────────────────────────────→│
```

---

## 6. AI 能力应用

### 6.1 智能匹配算法

```python
def calculate_match_score(skill_a, skill_b):
    """计算两个技能的匹配分数"""
    
    # 1. 语义相似度（权重40%）
    semantic_score = calculate_semantic_similarity(
        skill_a.description, 
        skill_b.description
    )
    
    # 2. 距离权重（权重30%）
    distance = calculate_distance(skill_a.location, skill_b.location)
    distance_score = max(0, 1 - distance / 5000)  # 5公里内满分
    
    # 3. 信誉分权重（权重20%）
    reputation_score = (skill_a.user.reputation + skill_b.user.reputation) / 10
    
    # 4. 价格匹配度（权重10%）
    price_score = 1 if skill_a.credit_price <= skill_b.budget else 0.5
    
    # 综合得分
    total_score = (
        semantic_score * 0.4 +
        distance_score * 0.3 +
        reputation_score * 0.2 +
        price_score * 0.1
    )
    
    return total_score
```

### 6.2 防刷机制

```python
def check_rate_limit(user_id, action):
    """检查用户操作频率"""
    
    # 限制规则
    limits = {
        'publish_skill': {'count': 10, 'period': 3600},  # 每小时最多发布10个
        'send_request': {'count': 20, 'period': 3600},   # 每小时最多发起20个请求
        'send_message': {'count': 100, 'period': 3600},  # 每小时最多发送100条消息
    }
    
    limit = limits.get(action)
    if not limit:
        return True
    
    # 查询 Redis 计数
    key = f"rate_limit:{user_id}:{action}"
    count = redis.get(key) or 0
    
    if count >= limit['count']:
        return False
    
    # 增加计数
    redis.incr(key)
    redis.expire(key, limit['period'])
    
    return True
```

---

## 7. 页面设计

### 7.1 核心页面列表

| 页面 | 功能 | 路由 |
|------|------|------|
| 技能广场 | 浏览所有技能 | /skills |
| 技能详情 | 查看技能详情 | /skills/:id |
| 发布技能 | 发布技能/需求 | /skills/create |
| 我的技能 | 管理我的技能 | /my/skills |
| 互助记录 | 查看互助历史 | /my/helps |
| 消息中心 | 查看消息通知 | /messages |
| 聊天页面 | 即时通讯 | /chat/:id |

### 7.2 技能广场页面布局

```
┌─────────────────────────────────────┐
│  搜索框                    [筛选]    │
├─────────────────────────────────────┤
│  [提供] [需求] [全部]               │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ 技能卡片 1                      ││
│  │ 用户头像 + 昵称 + 信誉分        ││
│  │ 技能标题 + 描述                 ││
│  │ 距离: 500m  积分: 50            ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 技能卡片 2                      ││
│  │ ...                            ││
│  └─────────────────────────────────┘│
│  ...                               │
├─────────────────────────────────────┤
│  [首页] [技能] [+] [消息] [我的]    │
└─────────────────────────────────────┘
```

---

## 8. 积分规则

### 8.1 积分获取
| 行为 | 积分 | 说明 |
|------|------|------|
| 完成互助 | +技能定价 | 提供技能获得积分 |
| 被好评 | +5 | 获得5星好评 |
| 首次发布 | +10 | 鼓励发布 |
| 邀请好友 | +20 | 邀请新用户注册 |

### 8.2 积分消耗
| 行为 | 积分 | 说明 |
|------|------|------|
| 请求帮助 | -技能定价 | 使用技能消耗积分 |
| 置顶发布 | -20 | 让技能信息置顶 |

### 8.3 积分保护
- 最低余额：10积分（新手保护）
- 每日上限：最多获得500积分
- 退款机制：互助取消可退还积分

---

## 9. 安全策略

### 9.1 内容审核
- 发布内容自动敏感词过滤
- 图片 AI 审核
- 人工复审可疑内容

### 9.2 用户认证
- 手机号实名认证
- 身份证信息验证（可选）
- 社区地址验证

### 9.3 交易安全
- 积分托管机制
- 互助完成后自动结算
- 争议仲裁机制

---

## 10. MVP 范围

### 第一阶段（P0）
- [ ] 用户注册登录
- [ ] 发布技能/需求
- [ ] 技能列表浏览
- [ ] 发起互助请求
- [ ] 接受/拒绝请求
- [ ] 基础即时通讯（WebSocket）
- [ ] 确认完成 + 积分结算
- [ ] 基础评价功能

### 第二阶段（P1）
- [ ] AI 智能匹配推荐
- [ ] 智能分类
- [ ] 高级搜索筛选
- [ ] 消息推送
- [ ] 数据统计
- [ ] 防刷机制
