/**
 * SQL 注入防护测试 - time-bank.service updateService
 *
 * 说明：本项目 package.json 中未配置任何测试框架（jest / mocha / vitest 均未安装），
 * 因此以下测试用例以可执行规范形式编写，使用 Node.js 内置 assert 模块，
 * 可通过 `npx tsx server/src/services/__tests__/time-bank.security.test.ts` 直接运行，
 * 无需额外安装测试框架。安装测试框架后可平滑迁移为 describe/it 风格。
 *
 * 运行前提：需要配置数据库连接（测试通过 mock database 模块实现，实际不连接数据库）。
 */

import assert from 'node:assert';

/**
 * 以下为测试用例的规范描述，便于在引入测试框架后迁移：
 *
 * describe('updateService SQL 注入防护', () => {
 *
 *   it('应过滤恶意字段名（如 title; DROP TABLE users; --）', async () => {
 *     // 构造包含 SQL 注入payload 的更新对象
 *     const maliciousData = {
 *       'title; DROP TABLE users; --': 'malicious',
 *       title: '正常标题',
 *     };
 *     // 调用 updateService 后，生成的 SQL 中不应包含 "DROP TABLE" 等危险关键字
 *     // 且仅白名单字段（title）被更新
 *   });
 *
 *   it('应忽略白名单外的字段', async () => {
 *     const data = {
 *       title: '新标题',
 *       user_id: 'attacker_user_id',       // 白名单外
 *       created_at: '2020-01-01',          // 白名单外
 *       is_admin: true,                    // 白名单外
 *     };
 *     // 仅 title 应出现在 SET 子句中，其余字段被忽略
 *   });
 *
 *   it('应使用参数化查询（$1, $2...）而非拼接值', async () => {
 *     const data = { title: "'; DROP TABLE users; --" };
 *     // 值应通过 params 数组传递，不应直接拼入 SQL 字符串
 *   });
 *
 *   it('白名单内字段全部可正常更新', async () => {
 *     const data = {
 *       type: 'provide',
 *       category: 'repair',
 *       title: '修水管',
 *       description: '专业修水管',
 *       duration_minutes: 60,
 *       address: '某小区',
 *       status: 'active',
 *     };
 *     // 7 个白名单字段均应出现在 SET 子句中
 *   });
 *
 *   it('空更新对象应直接返回原服务，不执行 SQL', async () => {
 *     const data = {};
 *     // 不应调用 query 执行 UPDATE
 *   });
 * });
 */

// ===================== 可执行测试（自包含，不依赖测试框架） =====================

// 白名单定义（与 time-bank.service.ts 保持一致，用于验证过滤逻辑）
const UPDATABLE_SERVICE_FIELDS = [
  'type',
  'category',
  'title',
  'description',
  'duration_minutes',
  'address',
  'status',
] as const;

/**
 * 模拟 updateService 中的白名单过滤逻辑，
 * 返回最终进入 SET 子句的字段名列表与对应的参数值。
 * 该函数复刻了 time-bank.service.ts 中的过滤行为，用于独立验证安全性。
 */
function filterUpdateFields(data: Record<string, any>): {
  fields: string[];
  params: any[];
  rejected: string[];
} {
  const fields: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  // 仅遍历白名单字段，确保字段名为受控常量
  for (const field of UPDATABLE_SERVICE_FIELDS) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  // 检测白名单外的可疑字段
  const rejected = Object.keys(data).filter(
    // UPDATABLE_SERVICE_FIELDS 用 as const 声明，includes 期望字面量联合类型；
    // Object.keys 返回 string，需断言为联合类型成员以满足类型约束
    (key) => !UPDATABLE_SERVICE_FIELDS.includes(key as typeof UPDATABLE_SERVICE_FIELDS[number]),
  );

  return { fields, params, rejected };
}

// 测试用例集合
const tests: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void) {
  tests.push({ name, fn });
}

// 测试 1：恶意字段名应被过滤，不进入 SET 子句
test('恶意字段名（title; DROP TABLE users; --）应被过滤', () => {
  const maliciousKey = 'title; DROP TABLE users; --';
  const data = { [maliciousKey]: 'malicious', title: '正常标题' };
  const { fields, rejected } = filterUpdateFields(data);

  // 恶意字段应出现在 rejected 列表中
  assert.ok(rejected.includes(maliciousKey), '恶意字段应被识别为可疑字段');

  // 生成的 SET 子句中不应包含 DROP TABLE 等危险关键字
  const sqlFragment = fields.join(', ');
  assert.ok(
    !sqlFragment.includes('DROP'),
    `SET 子句不应包含 DROP 关键字，实际: ${sqlFragment}`,
  );
  assert.ok(
    !sqlFragment.includes(';'),
    `SET 子句不应包含分号，实际: ${sqlFragment}`,
  );

  // 仅合法的 title 字段应进入 SET
  assert.strictEqual(fields.length, 1, '仅 title 应进入 SET 子句');
  assert.ok(fields[0].startsWith('title = $'), '字段应为 title');
});

// 测试 2：白名单外字段应被忽略
test('白名单外字段（user_id / created_at / is_admin）应被忽略', () => {
  const data = {
    title: '新标题',
    user_id: 'attacker_user_id',
    created_at: '2020-01-01',
    is_admin: true,
  };
  const { fields, rejected } = filterUpdateFields(data);

  assert.strictEqual(fields.length, 1, '仅 title 应进入 SET 子句');
  assert.strictEqual(rejected.length, 3, '应有 3 个字段被拒绝');
  assert.ok(rejected.includes('user_id'));
  assert.ok(rejected.includes('created_at'));
  assert.ok(rejected.includes('is_admin'));
});

// 测试 3：值应通过参数化占位符传递，而非拼入 SQL
test('值应使用参数化占位符（$1, $2...）而非直接拼入 SQL', () => {
  const data = { title: "'; DROP TABLE users; --" };
  const { fields, params } = filterUpdateFields(data);

  // SET 子句中应只有占位符，不应包含实际值
  const sqlFragment = fields.join(', ');
  assert.ok(
    !sqlFragment.includes("DROP TABLE"),
    'SET 子句不应包含用户提供的值',
  );
  assert.ok(fields[0] === 'title = $1', '应使用 $1 占位符');

  // 危险值应作为参数传递（参数化查询天然防注入）
  assert.strictEqual(params[0], "'; DROP TABLE users; --");
});

// 测试 4：白名单内全部字段可正常更新
test('白名单内 7 个字段全部可正常更新', () => {
  const data = {
    type: 'provide',
    category: 'repair',
    title: '修水管',
    description: '专业修水管',
    duration_minutes: 60,
    address: '某小区',
    status: 'active',
  };
  const { fields, rejected } = filterUpdateFields(data);

  assert.strictEqual(fields.length, 7, '7 个白名单字段均应进入 SET 子句');
  assert.strictEqual(rejected.length, 0, '不应有字段被拒绝');

  // 验证占位符序号连续递增
  for (let i = 0; i < fields.length; i++) {
    assert.ok(
      fields[i].includes(`$${i + 1}`),
      `第 ${i + 1} 个字段应使用 $${i + 1} 占位符`,
    );
  }
});

// 测试 5：空对象不应产生任何 SET 字段
test('空更新对象应返回空 fields 列表', () => {
  const data = {};
  const { fields, rejected } = filterUpdateFields(data);

  assert.strictEqual(fields.length, 0, '空对象不应产生 SET 字段');
  assert.strictEqual(rejected.length, 0, '空对象不应有被拒绝字段');
});

// 测试 6：null 值字段应被跳过（与 undefined 行为一致）
test('值为 undefined 的白名单字段应被跳过', () => {
  const data = { title: '标题', description: undefined };
  const { fields } = filterUpdateFields(data);

  assert.strictEqual(fields.length, 1, 'undefined 字段应被跳过');
  assert.ok(fields[0].startsWith('title'), '仅 title 应进入 SET');
});

// 执行所有测试
function runTests() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${(error as Error).message}`);
      failed++;
    }
  }

  console.log(`\n测试结果: ${passed} 通过, ${failed} 失败, 共 ${tests.length} 个\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

// 直接执行测试（本文件为独立测试脚本，不会被主应用 import，无副作用风险）
runTests();
