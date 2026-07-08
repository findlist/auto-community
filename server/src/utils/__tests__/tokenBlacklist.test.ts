/**
 * Token 黑名单 Redis 实现集成测试
 *
 * 说明：本项目 package.json 中未配置任何测试框架（jest / mocha / vitest 均未安装），
 * 因此以下测试用例使用 Node.js 内置 assert 模块，
 * 可通过 `npx tsx server/src/utils/__tests__/tokenBlacklist.test.ts` 直接运行，无需额外安装测试框架。
 *
 * 运行前提：
 * - 需要可访问的 Redis 实例（默认 localhost:6379，可通过环境变量 REDIS_HOST/REDIS_PORT 配置）
 * - 由于 tokenBlacklist 依赖 env 模块，需提前设置 JWT_SECRET 与 DB_PASSWORD 环境变量
 *
 * 测试范围：
 * - addToBlacklist 写入后 isBlacklisted 应返回 true
 * - TTL 过期后 isBlacklisted 应返回 false
 * - 未加入黑名单的 token 应返回 false
 * - 已过期的 exp（ttl <= 0）应跳过写入，查询返回 false
 */

import assert from 'node:assert';
import crypto from 'node:crypto';

// 测试前设置必需的环境变量（env 模块加载时校验）
process.env.JWT_SECRET = 'test-jwt-secret-for-blacklist-test';
process.env.DB_PASSWORD = 'test-db-password';
// 使用默认 Redis localhost:6379，如需自定义可通过环境变量覆盖

import { tokenBlacklist } from '../tokenBlacklist';
import { redisClient, connectRedis, disconnectRedis } from '../../config/redis';

let passed = 0;
let failed = 0;

// 支持异步的测试函数：等待 fn 完成后统计结果
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

// 生成唯一的测试 token，避免并发或重复运行时互相干扰
function genTestToken(): string {
  return `test-token-${crypto.randomUUID()}`;
}

// 等待指定毫秒数，用于 TTL 过期测试
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('\nToken 黑名单 Redis 实现集成测试\n');

  // 连接 Redis
  await connectRedis();

  try {
    // ===================== 正常写入与查询 =====================
    await test('addToBlacklist 写入后 isBlacklisted 应返回 true', async () => {
      const token = genTestToken();
      // exp 设为当前时间 + 60 秒
      const exp = Math.floor(Date.now() / 1000) + 60;
      await tokenBlacklist.addToBlacklist(token, exp);
      const result = await tokenBlacklist.isBlacklisted(token);
      assert.strictEqual(result, true, '写入黑名单后应返回 true');
      // 清理测试数据
      await redisClient.del(`blacklist:token:${token}`);
    });

    await test('未加入黑名单的 token 应返回 false', async () => {
      const token = genTestToken();
      const result = await tokenBlacklist.isBlacklisted(token);
      assert.strictEqual(result, false, '未加入黑名单的 token 应返回 false');
    });

    // ===================== TTL 过期 =====================
    await test('TTL 过期后 isBlacklisted 应返回 false', async () => {
      const token = genTestToken();
      // exp 设为当前时间 + 1 秒（TTL = 1 秒）
      const exp = Math.floor(Date.now() / 1000) + 1;
      await tokenBlacklist.addToBlacklist(token, exp);

      // 写入后立即查询应为 true
      const resultBefore = await tokenBlacklist.isBlacklisted(token);
      assert.strictEqual(resultBefore, true, 'TTL 未过期前应返回 true');

      // 等待 1.5 秒确保 TTL 已过期
      await sleep(1500);

      const resultAfter = await tokenBlacklist.isBlacklisted(token);
      assert.strictEqual(resultAfter, false, 'TTL 过期后应返回 false');
    });

    // ===================== 边界情况 =====================
    await test('exp 已过期的 token 应跳过写入，查询返回 false', async () => {
      const token = genTestToken();
      // exp 设为当前时间 - 10 秒（已过期）
      const exp = Math.floor(Date.now() / 1000) - 10;
      await tokenBlacklist.addToBlacklist(token, exp);
      const result = await tokenBlacklist.isBlacklisted(token);
      assert.strictEqual(result, false, '已过期的 token 不应写入黑名单');
    });

    await test('同一 token 重复写入不应报错', async () => {
      const token = genTestToken();
      const exp = Math.floor(Date.now() / 1000) + 60;
      // 重复写入两次
      await tokenBlacklist.addToBlacklist(token, exp);
      await tokenBlacklist.addToBlacklist(token, exp);
      const result = await tokenBlacklist.isBlacklisted(token);
      assert.strictEqual(result, true, '重复写入后仍应返回 true');
      // 清理测试数据
      await redisClient.del(`blacklist:token:${token}`);
    });
  } finally {
    // 确保测试结束（无论成功失败）都断开 Redis 连接
    await disconnectRedis();
  }

  // ===================== 汇总 =====================
  console.log(`\n测试结果: ${passed} 通过, ${failed} 失败\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

// 执行测试，捕获未处理的异常
main().catch((error) => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
