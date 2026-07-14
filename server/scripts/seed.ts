/**
 * 测试数据种子脚本
 *
 * 用法（在 server/ 目录下执行）：
 *   npx tsx scripts/seed.ts
 *
 * 功能：
 *   1. 插入 4 个测试用户（1 管理员 + 3 普通用户），密码统一为 123456
 *   2. 为每个用户插入积分交易记录
 *   3. 插入技能交换、共享厨房、时间银行示例帖子
 *
 * 幂等：按 phone_hash 去重，重复执行不会报错也不会创建重复用户
 */

import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { encryptPhone, hashPhone } from '../src/utils/crypto';

// 加载 .env（与 env.ts 相同的候选路径）
const envCandidates = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
  try {
    dotenv.config({ path: envPath });
    break;
  } catch {
    // continue
  }
}

// 测试用户定义
interface TestUser {
  phone: string;
  password: string;
  nickname: string;
  role: 'user' | 'admin';
  credit: number;
  time: number;
}

const testUsers: TestUser[] = [
  { phone: '13800138000', password: '123456', nickname: '张三', role: 'user', credit: 200, time: 50 },
  { phone: '13800138001', password: '123456', nickname: '李四', role: 'user', credit: 150, time: 80 },
  { phone: '13800138002', password: '123456', nickname: '王五', role: 'user', credit: 100, time: 120 },
  { phone: '13800138003', password: '123456', nickname: '管理员', role: 'admin', credit: 500, time: 200 },
];

// 示例技能帖子
const skillPosts = [
  { authorIdx: 0, category: '生活技能', type: 'offer', title: '教你做家常红烧肉', description: '十年厨艺，手把手教你做正宗红烧肉', creditPrice: 20, tags: [' cooking', '美食'] },
  { authorIdx: 1, category: '数码', type: 'offer', title: '电脑维修与系统重装', description: '各类电脑故障排查、系统安装、软件调试', creditPrice: 30, tags: ['电脑', '维修'] },
  { authorIdx: 2, category: '语言', type: 'request', title: '求英语口语陪练', description: '备考雅思，寻找口语陪练伙伴', creditPrice: 25, tags: ['英语', '口语'] },
  { authorIdx: 0, category: '运动', type: 'offer', title: '羽毛球陪练', description: '国家二级运动员，周末羽毛球陪练', creditPrice: 35, tags: ['羽毛球', '运动'] },
];

// 示例厨房帖子
const kitchenPosts = [
  { authorIdx: 0, type: 'share', title: '手工饺子分享', description: '妈妈包的韭菜鸡蛋饺子，新鲜出锅', foodType: '面食', portions: 4, creditPrice: 5, pickupAddress: '3栋101室', tags: ['饺子', '面食'] },
  { authorIdx: 1, type: 'group_buy', title: '有机蔬菜团购', description: '直采有机农场，新鲜配送', foodType: '蔬菜', portions: 10, creditPrice: 15, pickupAddress: '小区南门', tags: ['蔬菜', '团购'] },
];

// 示例时间银行服务
const timeServices = [
  { authorIdx: 0, category: '家政', type: 'provide', title: '日常保洁服务', description: '专业保洁，两小时起约', duration: 120, address: '本小区' },
  { authorIdx: 1, category: '陪伴', type: 'provide', title: '老人陪聊散步', description: '陪伴独居老人聊天散步', duration: 60, address: '本小区' },
  { authorIdx: 2, category: '学业', type: 'request', title: '小学数学辅导', description: '三年级数学周末辅导', duration: 90, address: '社区活动室' },
];

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'linli_circle',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  const client = await pool.connect();
  let createdCount = 0;
  let skippedCount = 0;

  try {
    await client.query('BEGIN');

    // ==================== 1. 插入测试用户 ====================
    const userIds: string[] = [];

    for (const u of testUsers) {
      const phoneHash = hashPhone(u.phone);

      // 检查是否已存在（按 phone_hash 去重）
      const existing = await client.query('SELECT id FROM users WHERE phone_hash = $1', [phoneHash]);
      if (existing.rows.length > 0) {
        userIds.push(existing.rows[0].id);
        skippedCount++;
        console.log(`[跳过] 用户 ${u.nickname} (${u.phone}) 已存在`);
        continue;
      }

      const encryptedPhone = encryptPhone(u.phone);
      const passwordHash = await bcrypt.hash(u.password, 10);

      const result = await client.query(
        `INSERT INTO users (phone, phone_hash, password_hash, nickname, credit_balance, time_balance,
          reputation_score, role, privacy_consent_version, privacy_consent_at)
         VALUES ($1, $2, $3, $4, $5, $6, 5.00, $7, 'v1.0', NOW())
         RETURNING id`,
        [encryptedPhone, phoneHash, passwordHash, u.nickname, u.credit, u.time, u.role]
      );

      const userId = result.rows[0].id;
      userIds.push(userId);
      createdCount++;

      // 插入注册奖励积分记录
      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
         VALUES ($1, 'earn', $2, $3, $4)`,
        [userId, u.credit, u.credit, '测试数据初始积分']
      );

      console.log(`[创建] 用户 ${u.nickname} (${u.phone}) / 密码: ${u.password} / 角色: ${u.role}`);
    }

    // ==================== 2. 插入技能交换帖子 ====================
    for (const post of skillPosts) {
      const userId = userIds[post.authorIdx];
      if (!userId) continue;

      await client.query(
        `INSERT INTO skill_posts (user_id, category, type, title, description, credit_price, tags, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         ON CONFLICT DO NOTHING`,
        [userId, post.category, post.type, post.title, post.description, post.creditPrice, post.tags]
      );
    }
    console.log(`[创建] ${skillPosts.length} 条技能交换帖子`);

    // ==================== 3. 插入共享厨房帖子 ====================
    for (const post of kitchenPosts) {
      const userId = userIds[post.authorIdx];
      if (!userId) continue;

      await client.query(
        `INSERT INTO kitchen_posts (user_id, type, title, description, food_type, portions,
          remaining_portions, credit_price, pickup_type, pickup_address, tags, status)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'self_pickup', $8, $9, 'active')`,
        [userId, post.type, post.title, post.description, post.foodType, post.portions,
         post.creditPrice, post.pickupAddress, post.tags]
      );
    }
    console.log(`[创建] ${kitchenPosts.length} 条共享厨房帖子`);

    // ==================== 4. 插入时间银行服务 ====================
    for (const svc of timeServices) {
      const userId = userIds[svc.authorIdx];
      if (!userId) continue;

      await client.query(
        `INSERT INTO time_services (user_id, category, type, title, description, duration_minutes, address, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
        [userId, svc.category, svc.type, svc.title, svc.description, svc.duration, svc.address]
      );
    }
    console.log(`[创建] ${timeServices.length} 条时间银行服务`);

    await client.query('COMMIT');

    console.log('\n========== 种子数据创建完成 ==========');
    console.log(`新建用户: ${createdCount}  已存在跳过: ${skippedCount}`);
    console.log('测试账号列表:');
    testUsers.forEach(u => {
      console.log(`  ${u.nickname.padEnd(6)} ${u.phone} / ${u.password} (${u.role})`);
    });
    console.log('======================================');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[错误] 种子数据创建失败:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('未捕获异常:', err);
  process.exit(1);
});
