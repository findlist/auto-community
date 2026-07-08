# 共享厨房模块 - 规格说明

## 1. 模块概述

### 1.1 定位
共享厨房模块是「邻里圈」最具温度的模块，通过美食连接邻里，让每家每户的厨房都成为社区的"中央厨房"，重建有烟火气的邻里关系。

### 1.2 核心价值
- **解决吃饭难**：独居青年、双职工家庭、独居老人的日常餐饮
- **减少浪费**：多做的饭菜分享给邻居，避免食物浪费
- **重建连接**：从"吃"开始，建立真实的邻里关系
- **传承美食**：让家常菜、拿手菜被更多人品尝

### 1.3 典型场景
- 张阿姨今天包了100个饺子，分享20份给邻居
- 5个家庭拼单买海鲜，一起分摊运费
- 小王想吃红烧肉，发布需求，李叔叔接单制作
- 社区美食达人排行榜，谁家的包子最好吃一目了然

---

## 2. 功能清单

### 2.1 核心功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 今日分享 | P0 | 发布今天多做的饭菜，邻居可预约领取 |
| 美食需求 | P0 | 发布想吃什么，邻居可接单制作 |
| 拼单买菜 | P1 | 多家一起买菜，分摊成本 |
| 美食地图 | P1 | 社区美食达人排行，谁家什么好吃 |
| 预约领取 | P0 | 预约邻居分享的美食 |
| 订单管理 | P0 | 查看我的分享/领取记录 |
| 评价系统 | P0 | 对美食进行评价打分 |
| 食安提醒 | P1 | AI 提醒食品安全信息 |
| 过敏原标注 | P1 | 标注食品过敏原信息 |

### 2.2 管理功能

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 食品安全审核 | P0 | 审核分享者的健康证等资质 |
| 内容审核 | P0 | 审核发布的美食信息 |
| 用户管理 | P0 | 管理用户账号 |
| 数据统计 | P1 | 美食分享数据统计 |

---

## 3. 数据模型

### 3.1 美食分享表 (food_shares)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| user_id | UUID | 是 | 分享者 |
| type | ENUM | 是 | offer(分享) / need(需求) |
| title | VARCHAR(100) | 是 | 美食名称 |
| description | TEXT | 否 | 美食描述 |
| category | VARCHAR(50) | 是 | 美食类别（家常菜/烘焙/饮品等） |
| price | INTEGER | 否 | 价格（积分），0表示免费 |
| quantity | INTEGER | 是 | 可分享份数 |
| remaining | INTEGER | 是 | 剩余份数 |
| images | JSON | 否 | 美食图片列表 |
| pickup_time | VARCHAR(100) | 是 | 可领取时间 |
| pickup_location | VARCHAR(200) | 是 | 领取地点 |
| pickup_type | ENUM | 是 | self_pickup(自取) / delivery(配送) |
| location | POINT | 是 | 地理位置 |
| allergens | JSON | 否 | 过敏原列表 |
| status | ENUM | 是 | active/sold_out/closed/expired |
| health_cert | BOOLEAN | 是 | 是否有健康证 |
| expires_at | TIMESTAMP | 是 | 过期时间 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |
| deleted_at | TIMESTAMP | 否 | 软删除时间 |

### 3.2 美食订单表 (food_orders)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| food_share_id | UUID | 是 | 关联美食分享 |
| buyer_id | UUID | 是 | 买家 |
| seller_id | UUID | 是 | 卖家 |
| quantity | INTEGER | 是 | 购买份数 |
| total_price | INTEGER | 是 | 总价格 |
| status | ENUM | 是 | pending/confirmed/completed/cancelled/timeout |
| pickup_time | TIMESTAMP | 否 | 预约领取时间 |
| pickup_type | ENUM | 是 | self_pickup(自取) / delivery(配送) |
| delivery_address | VARCHAR(200) | 否 | 配送地址 |
| remark | TEXT | 否 | 备注 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |
| completed_at | TIMESTAMP | 否 | 完成时间 |
| timeout_at | TIMESTAMP | 否 | 超时时间 |

### 3.3 美食评价表 (food_reviews)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| order_id | UUID | 是 | 关联订单 |
| reviewer_id | UUID | 是 | 评价人 |
| rating | INTEGER | 是 | 评分(1-5) |
| taste_rating | INTEGER | 否 | 口味评分(1-5) |
| portion_rating | INTEGER | 否 | 份量评分(1-5) |
| content | TEXT | 否 | 评价内容 |
| images | JSON | 否 | 评价图片 |
| created_at | TIMESTAMP | 是 | 创建时间 |

### 3.4 拼单表 (group_orders)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| initiator_id | UUID | 是 | 发起人 |
| title | VARCHAR(100) | 是 | 拼单标题 |
| description | TEXT | 否 | 拼单描述 |
| target_amount | INTEGER | 是 | 目标金额 |
| current_amount | INTEGER | 是 | 当前金额 |
| min_participants | INTEGER | 是 | 最少参与人数 |
| max_participants | INTEGER | 是 | 最多参与人数 |
| current_participants | INTEGER | 是 | 当前参与人数 |
| location | POINT | 是 | 地理位置 |
| address | VARCHAR(200) | 是 | 集合地点 |
| deadline | TIMESTAMP | 是 | 截止时间 |
| status | ENUM | 是 | open/full/ongoing/completed/cancelled |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |

### 3.5 拼单参与表 (group_order_participants)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | UUID | 是 | 主键 |
| group_order_id | UUID | 是 | 关联拼单 |
| user_id | UUID | 是 | 参与者 |
| amount | INTEGER | 是 | 分摊金额 |
| status | ENUM | 是 | pending/paid/refunded |
| created_at | TIMESTAMP | 是 | 创建时间 |

---

## 4. API 设计

### 4.1 美食分享接口

#### 发布美食分享
```
POST /api/food-shares
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "type": "offer",  // offer: 分享, need: 需求
  "title": "手工水饺",
  "description": "韭菜鸡蛋馅，今天包了100个，分享20份",
  "category": "家常菜",
  "price": 30,  // 积分，0表示免费
  "quantity": 20,
  "pickup_time": "今天17:00-19:00",
  "pickup_location": "3号楼1单元102",
  "pickup_type": "self_pickup",  // self_pickup: 自取, delivery: 配送
  "location": {
    "lat": 39.9042,
    "lng": 116.4074
  },
  "images": ["url1", "url2"],
  "health_cert": true,
  "allergens": ["鸡蛋", "面粉"]  // 过敏原
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

#### 获取美食列表
```
GET /api/food-shares?type=offer&category=家常菜&page=1&page_size=20
Authorization: Bearer <token>

响应：
{
  "code": 200,
  "data": {
    "total": 50,
    "page": 1,
    "page_size": 20,
    "list": [
      {
        "id": "uuid",
        "type": "offer",
        "title": "手工水饺",
        "description": "韭菜鸡蛋馅...",
        "price": 30,
        "quantity": 20,
        "remaining": 15,
        "images": ["url1"],
        "pickup_time": "今天17:00-19:00",
        "pickup_type": "self_pickup",
        "allergens": ["鸡蛋", "面粉"],
        "user": {
          "id": "uuid",
          "nickname": "张阿姨",
          "avatar": "url",
          "reputation_score": 4.9
        },
        "distance": 200
      }
    ]
  }
}
```

### 4.2 订单接口

#### 预约领取
```
POST /api/food-orders
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "food_share_id": "uuid",
  "quantity": 2,
  "pickup_time": "今天18:00",
  "pickup_type": "self_pickup",
  "remark": "少放点辣椒"
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "total_price": 60,
    "status": "pending",
    "timeout_at": "2026-06-16T18:30:00Z"  // 30分钟超时
  }
}
```

#### 确认订单
```
PUT /api/food-orders/:id/confirm
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

#### 完成订单
```
PUT /api/food-orders/:id/complete
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "rating": 5,
  "taste_rating": 5,
  "portion_rating": 4,
  "review": "饺子很好吃，皮薄馅大！"
}
```

### 4.3 拼单接口

#### 创建拼单
```
POST /api/group-orders
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "title": "拼单买海鲜",
  "description": "一起买海鲜，分摊运费",
  "target_amount": 500,
  "min_participants": 3,
  "max_participants": 10,
  "location": {
    "lat": 39.9042,
    "lng": 116.4074
  },
  "address": "小区南门集合",
  "deadline": "2026-06-16T18:00:00Z"
}

响应：
{
  "code": 200,
  "data": {
    "id": "uuid",
    "status": "open"
  }
}
```

#### 参与拼单
```
POST /api/group-orders/:id/join
Content-Type: application/json
Authorization: Bearer <token>

请求体：
{
  "amount": 100  // 分摊金额
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

### 5.1 美食分享流程

```
用户发布美食 → 设置领取时间地点 → 等待邻居预约 → 确认订单 → 线下领取 → 完成评价
```

### 5.2 美食需求流程

```
用户发布需求 → 等待邻居接单 → 确认订单 → 制作完成 → 领取 → 完成评价
```

### 5.3 拼单流程

```
发起拼单 → 邻居参与 → 达到目标金额 → 线下集合 → 一起购买 → 分摊费用 → 完成
```

### 5.4 订单超时处理流程

```
订单创建 → 30分钟内未确认 → 自动取消 → 积分退还 → 通知买家
```

### 5.5 完整交互流程

```
┌─────────┐                    ┌─────────┐
│  张阿姨  │                    │  小王   │
│ (分享者) │                    │ (领取者) │
└────┬────┘                    └────┬────┘
     │                              │
     │  1.发布"今天包了饺子，分享20份" │
     │─────────────────────────────→│
     │                              │
     │  2.浏览美食，发现饺子          │
     │←─────────────────────────────│
     │                              │
     │  3.预约领取2份，18:00         │
     │←─────────────────────────────│
     │                              │
     │  4.确认订单                   │
     │─────────────────────────────→│
     │                              │
     │  5.线下领取                   │
     │←────────────────────────────→│
     │                              │
     │  6.完成订单，积分结算          │
     │←────────────────────────────→│
     │                              │
     │  7.评价"饺子很好吃"           │
     │←─────────────────────────────│
```

---

## 6. AI 能力应用

### 6.1 食品安全提醒

```python
def check_food_safety(food_share):
    """检查食品安全信息"""
    
    warnings = []
    
    # 1. 检查健康证
    if not food_share.user.health_cert:
        warnings.append("分享者未上传健康证")
    
    # 2. 检查制作时间
    if food_share.pickup_time > 4 * 60:  # 超过4小时
        warnings.append("食品制作时间较长，建议注意保鲜")
    
    # 3. 检查食品类别高风险提示
    high_risk_categories = ["海鲜", "生食", "乳制品"]
    if food_share.category in high_risk_categories:
        warnings.append(f"{food_share.category}类食品请注意保存温度")
    
    # 4. 过敏原提醒
    if food_share.allergens:
        warnings.append(f"含有过敏原：{', '.join(food_share.allergens)}")
    
    return warnings
```

### 6.2 美食推荐算法

```python
def recommend_food(user, food_list):
    """为用户推荐美食"""
    
    scored_food = []
    
    for food in food_list:
        score = 0
        
        # 1. 距离权重（40%）
        distance = calculate_distance(user.location, food.location)
        distance_score = max(0, 1 - distance / 2000)  # 2公里内满分
        score += distance_score * 0.4
        
        # 2. 口味偏好（30%）
        taste_match = calculate_taste_preference(user, food)
        score += taste_match * 0.3
        
        # 3. 分享者信誉（20%）
        reputation_score = food.user.reputation_score / 5
        score += reputation_score * 0.2
        
        # 4. 新鲜度（10%）
        freshness_score = 1 - (food.remaining / food.quantity)
        score += freshness_score * 0.1
        
        scored_food.append((food, score))
    
    # 按分数排序返回
    return sorted(scored_food, key=lambda x: x[1], reverse=True)
```

---

## 7. 页面设计

### 7.1 核心页面列表

| 页面 | 功能 | 路由 |
|------|------|------|
| 美食广场 | 浏览所有美食 | /food |
| 美食详情 | 查看美食详情 | /food/:id |
| 发布美食 | 分享/需求 | /food/create |
| 拼单广场 | 浏览拼单 | /group-orders |
| 拼单详情 | 查看拼单详情 | /group-orders/:id |
| 我的订单 | 查看订单历史 | /my/food-orders |
| 美食地图 | 社区美食分布 | /food-map |

### 7.2 美食广场页面布局

```
┌─────────────────────────────────────┐
│  搜索框                    [筛选]    │
├─────────────────────────────────────┤
│  [分享] [需求] [拼单] [地图]        │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ 🥟 手工水饺 - 张阿姨            ││
│  │ 韭菜鸡蛋馅，今天包了100个       ││
│  │ 价格: 30积分  剩余: 15份        ││
│  │ 📍 3号楼1单元102  🕐 17:00-19:00││
│  │ ⭐ 4.9分  📏 200m               ││
│  │ ⚠️ 过敏原: 鸡蛋, 面粉           ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 🍰 自制蛋糕 - 李叔叔            ││
│  │ ...                            ││
│  └─────────────────────────────────┘│
│  ...                               │
├─────────────────────────────────────┤
│  [首页] [美食] [+] [消息] [我的]    │
└─────────────────────────────────────┘
```

---

## 8. 积分规则

### 8.1 美食分享积分
| 行为 | 积分 | 说明 |
|------|------|------|
| 分享美食 | +分享价格 | 分享者获得积分 |
| 领取美食 | -分享价格 | 领取者消耗积分 |
| 被好评 | +5 | 获得5星好评 |
| 首次分享 | +10 | 鼓励首次分享 |

### 8.2 拼单积分
| 行为 | 积分 | 说明 |
|------|------|------|
| 发起拼单 | +5 | 发起人获得奖励 |
| 参与拼单 | -分摊金额 | 参与者消耗积分 |

### 8.3 特殊规则
- 免费分享不消耗积分
- 互助取消可退还积分
- 新用户首次领取享受5折优惠
- 订单超时自动取消并退还积分

---

## 9. 安全策略

### 9.1 食品安全
- 分享者需上传健康证
- AI 检测高风险食品
- 食品制作时间限制（建议4小时内）
- 保留食品来源追溯记录
- 过敏原标注提醒

### 9.2 内容审核
- 美食图片 AI 审核
- 敏感词过滤
- 人工复审可疑内容

### 9.3 交易安全
- 积分托管机制
- 订单确认后自动结算
- 订单超时自动取消
- 争议仲裁机制

---

## 10. MVP 范围

### 第一阶段（P0）
- [ ] 发布美食分享/需求
- [ ] 美食列表浏览
- [ ] 预约领取功能
- [ ] 订单管理（含超时处理）
- [ ] 基础评价功能
- [ ] 积分结算

### 第二阶段（P1）
- [ ] 拼单买菜功能
- [ ] 美食地图
- [ ] AI 推荐算法
- [ ] 食品安全提醒
- [ ] 过敏原标注
- [ ] 消息推送
