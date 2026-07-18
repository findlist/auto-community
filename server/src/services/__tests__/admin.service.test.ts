/**
 * admin.service 单元测试
 *
 * 测试目标：覆盖用户管理（getUsers/banUser/unbanUser/updateUserRole）、
 *           内容审核（getContent/updateContentStatus/getContentDetail/updateContent）、
 *           首页图片（getHomepageImage/setHomepageImage）等核心方法
 * 测试策略：mock database 模块，验证 SQL 拼装、字段白名单、驼峰转下划线映射、XSS 清洗调用等。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 使用 importOriginal 保留 isSqlParam 等纯函数的真实实现，
// 仅 mock query/transaction/pool 这些会触发真实 DB 连接的部分
// 设计原因：isSqlParam 是无副作用的类型守卫，复用真实实现可让测试覆盖到运行时类型校验逻辑
vi.mock('../../config/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/database')>();
  return {
    ...actual,
    query: vi.fn(),
    transaction: vi.fn(),
    pool: {},
  };
});

// mock logger，避免测试输出干扰
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// mock cache.service，避免 userCache 调用真实 Redis
vi.mock('../cache.service', () => ({
  userCache: { get: vi.fn(), invalidate: vi.fn() },
  kitchenPostCache: { get: vi.fn(), invalidate: vi.fn() },
}));

// mock crypto：getUsers 现在调用 hashPhone/decryptPhone，需隔离加解密副作用
// 设计原因：原测试 mock 数据为明文手机号，decryptPhone 解密非密文会抛错；
// 提供 hashPhone 返回固定哈希便于断言、decryptPhone 返回明文模拟解密成功
vi.mock('../../utils/crypto', () => ({
  hashPhone: vi.fn((phone: string) => `hash-${phone}`),
  decryptPhone: vi.fn((phone: string) => phone),
  encryptPhone: vi.fn((phone: string) => phone),
  hashIdCard: vi.fn((id: string) => `hash-${id}`),
  encryptIdCard: vi.fn((id: string) => id),
  decryptIdCard: vi.fn((id: string) => id),
}));

import { adminService } from '../admin.service';
import { query } from '../../config/database';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { hashPhone, decryptPhone } from '../../utils/crypto';

const mockedQuery = vi.mocked(query);
const mockedHashPhone = vi.mocked(hashPhone);
const mockedDecryptPhone = vi.mocked(decryptPhone);

// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows
// 用 as unknown as DbResult 替代 as unknown as DbResult 以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;

beforeEach(() => {
  mockedQuery.mockReset();
  // mockClear 仅清除调用记录与 instances，保留默认实现（hashPhone/decryptPhone 的固定返回）
  mockedHashPhone.mockClear();
  mockedDecryptPhone.mockClear();
});

describe('admin.service - 用户管理', () => {
  it('getUsers 非手机号搜索仅匹配 nickname（phone 加密无法 LIKE）', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 'u1', phone: '13800000000', nickname: '张三', role: 'user', status: 'active', created_at: new Date(), reputation_score: 80, credit_balance: 100 }],
      } as unknown as DbResult);

    const result = await adminService.getUsers(1, 20, '张三');

    expect(result.total).toBe(1);
    expect(result.list[0].nickname).toBe('张三');
    // 非完整手机号仅匹配 nickname，不再有 phone LIKE（phone 加密字段无法 LIKE）
    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).not.toContain('phone LIKE');
    expect(countSql).toContain('nickname LIKE');
    // phone 字段经 decryptPhone 解密后返回明文
    expect(mockedDecryptPhone).toHaveBeenCalledWith('13800000000');
    expect(result.list[0].phone).toBe('13800000000');
  });

  it('getUsers 完整手机号搜索用 phone_hash 等值查询', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 'u2', phone: '13900139000', nickname: '李四', role: 'user', status: 'active', created_at: new Date(), reputation_score: 90, credit_balance: 200 }],
      } as unknown as DbResult);

    const result = await adminService.getUsers(1, 20, '13900139000');

    expect(result.total).toBe(1);
    // 完整手机号经 hashPhone 后等值查询 phone_hash，不再 LIKE
    expect(mockedHashPhone).toHaveBeenCalledWith('13900139000');
    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('phone_hash = $1');
    expect(countSql).not.toContain('LIKE');
    // query 参数第 1 个为 hash 后的手机号
    expect(mockedQuery.mock.calls[0][1]).toEqual(['hash-13900139000']);
  });

  it('getUsers 解密失败时回退占位符不影响整页', async () => {
    mockedDecryptPhone.mockImplementationOnce(() => {
      throw new Error('decrypt failed');
    });
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 'u3', phone: 'invalid-cipher', nickname: '王五', role: 'user', status: 'active', created_at: new Date(), reputation_score: 70, credit_balance: 50 }],
      } as unknown as DbResult);

    const result = await adminService.getUsers(1, 20, '王五');

    // 解密失败回退 '******'，不抛错
    expect(result.list[0].phone).toBe('******');
    expect(result.list[0].nickname).toBe('王五');
  });

  it('banUser 更新用户状态为 banned', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', status: 'banned' }],
    } as unknown as DbResult);

    const result = await adminService.banUser('u1');

    expect(result.status).toBe('banned');
    expect(mockedQuery.mock.calls[0][0]).toContain("SET status = 'banned'");
  });

  it('banUser 用户不存在时抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(adminService.banUser('u-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('unbanUser 更新用户状态为 active', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', status: 'active' }],
    } as unknown as DbResult);

    const result = await adminService.unbanUser('u1');
    expect(result.status).toBe('active');
  });

  it('updateUserRole 更新用户角色', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', role: 'admin' }],
    } as unknown as DbResult);

    const result = await adminService.updateUserRole('u1', 'admin');
    expect(result.role).toBe('admin');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['admin', 'u1']);
  });
});

describe('admin.service - 内容审核', () => {
  it('getContent 按类型查询内容列表', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '技能帖', status: 'active', created_at: new Date(), user_id: 'u1', credit_price: 50 }],
      } as unknown as DbResult);

    const result = await adminService.getContent('skill', undefined, 1, 20);

    expect(result.total).toBe(1);
    expect(result.list[0].title).toBe('技能帖');
    // skill 类型别名应为 creditsRequired
    expect(result.list[0].creditsRequired).toBe(50);
  });

  it('getContent kitchen 类型使用 price 别名', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 'k1', title: '美食帖', status: 'active', created_at: new Date(), user_id: 'u1', credit_price: 30 }],
      } as unknown as DbResult);

    const result = await adminService.getContent('kitchen', undefined, 1, 20);
    expect(result.list[0].price).toBe(30);
  });

  it('updateContentStatus 状态更新成功', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 's1', status: 'rejected' }],
    } as unknown as DbResult);

    const result = await adminService.updateContentStatus('skill', 's1', 'rejected');
    expect(result.status).toBe('rejected');
  });

  it('updateContentStatus 内容不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(adminService.updateContentStatus('skill', 's-x', 'rejected')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('admin.service - getContentDetail', () => {
  it('按 skill 类型查询内容详情', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 's1',
        title: '技能帖',
        description: '描述',
        credit_price: 50,
        images: ['https://example.com/1.png'],
        tags: ['编程'],
        address: '北京',
        status: 'active',
        created_at: new Date(),
      }],
    } as unknown as DbResult);

    const result = await adminService.getContentDetail('skill', 's1');

    expect(result.title).toBe('技能帖');
    expect(result.creditPrice).toBe(50);
    expect(result.images).toHaveLength(1);
    expect(result.tags).toEqual(['编程']);
  });

  it('内容不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(adminService.getContentDetail('skill', 's-x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('admin.service - updateContent', () => {
  it('驼峰字段名应映射为下划线列名（creditPrice → credit_price）', async () => {
    // 第一次校验存在性，第二次实际 UPDATE，第三次返回详情
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as unknown as DbResult) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '新标题', description: '', credit_price: 80, images: [], tags: [], address: null, status: 'active', created_at: new Date() }],
      } as unknown as DbResult);

    // data 参数不再需要类型断言：对象字面量天然可赋给 Record<string, unknown>
    await adminService.updateContent('skill', 's1', {
      title: '新标题',
      creditPrice: 80,
    }, 'admin-1');

    // UPDATE 调用应包含 title 和 credit_price 字段
    const updateSql = mockedQuery.mock.calls[1][0];
    expect(updateSql).toContain('title = $1');
    expect(updateSql).toContain('credit_price = $2');
    // 参数顺序：[title, creditPrice, id]
    expect(mockedQuery.mock.calls[1][1]).toEqual(['新标题', 80, 's1']);
  });

  it('字段不在白名单时被忽略', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as unknown as DbResult) // SELECT id
      // 字段不在白名单 → 没有有效字段 → 走 getById 分支，返回 getContentDetail
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '原标题', description: '', credit_price: 50, images: [], tags: [], address: null, status: 'active', created_at: new Date() }],
      } as unknown as DbResult);

    // 传入白名单外字段（如 user_id 不在 skill.editableFields 中）
    const result = await adminService.updateContent('skill', 's1', {
      user_id: '不该被更新的字段',
    }, 'admin-1');

    // 应直接走 getContentDetail 分支，不触发 UPDATE
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(result.title).toBe('原标题');
  });

  it('内容不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(
      adminService.updateContent('skill', 's-x', { title: '新标题' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('字段类型不合法（如函数）时抛 BadRequestError', async () => {
    // 内容存在，但字段值类型非法（function 不是 SqlParam 联合成员）
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] } as unknown as DbResult);

    // title 字段为函数，type guard 应拒绝；as unknown as string 仅测试入参类型断言
    await expect(
      adminService.updateContent('skill', 's1', { title: (() => {}) as unknown as string }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('NaN 数值类型不合法时抛 BadRequestError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] } as unknown as DbResult);

    // credit_price 字段为 NaN，type guard 应拒绝（避免 pg 序列化异常）
    await expect(
      adminService.updateContent('skill', 's1', { creditPrice: NaN }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('字符串数组类型字段可正常写入（images/tags）', async () => {
    // 覆盖 string[] 类型的 type guard 通过路径，确保数组字段不被误拒
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as unknown as DbResult) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '标题', description: '', credit_price: 50, images: ['a.png', 'b.png'], tags: ['编程'], address: null, status: 'active', created_at: new Date() }],
      } as unknown as DbResult);

    await adminService.updateContent('skill', 's1', {
      images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
      tags: ['编程', '设计'],
    }, 'admin-1');

    // UPDATE 参数应包含字符串数组
    const updateParams = mockedQuery.mock.calls[1][1] as unknown[];
    expect(updateParams[0]).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']);
    expect(updateParams[1]).toEqual(['编程', '设计']);
  });

  // XSS 不变式：address 字段必须被纳入 textFields 清洗字段列表
  // 设计原因：管理员编辑入口与业务侧 create/update 入口清洗行为对齐，避免遗漏导致存储型 XSS
  it('skill type 的 address 含 XSS 片段时被清洗后入库', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as unknown as DbResult) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: 't', description: '', credit_price: 50, images: [], tags: [], address: '北京市朝阳区', status: 'active', created_at: new Date() }],
      } as unknown as DbResult);

    await adminService.updateContent('skill', 's1', {
      address: '<script>alert(1)</script>北京市朝阳区',
    }, 'admin-1');

    const updateParams = mockedQuery.mock.calls[1][1] as unknown[];
    const addressArg = updateParams.find((v: unknown) => typeof v === 'string' && v.includes('北京市朝阳区'));
    expect(addressArg).not.toContain('<script>');
  });

  it('kitchen type 的 pickupAddress（驼峰映射 pickup_address）含 XSS 片段时被清洗后入库', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'k1' }] } as unknown as DbResult) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 'k1', title: 't', description: '', credit_price: 50, images: [], category: 'c', portions: 1, pickup_address: '北京市海淀区', allergens: [], status: 'active', created_at: new Date() }],
      } as unknown as DbResult);

    await adminService.updateContent('kitchen', 'k1', {
      pickupAddress: '<script>alert(1)</script>北京市海淀区',
    }, 'admin-1');

    const updateParams = mockedQuery.mock.calls[1][1] as unknown[];
    const pickupAddressArg = updateParams.find((v: unknown) => typeof v === 'string' && v.includes('北京市海淀区'));
    expect(pickupAddressArg).not.toContain('<script>');
  });
});

describe('admin.service - 首页展示图片', () => {
  it('getHomepageImage 返回已配置的图片 URL', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ value: 'https://cdn.example.com/hero.png' }],
    } as unknown as DbResult);

    const url = await adminService.getHomepageImage();
    expect(url).toBe('https://cdn.example.com/hero.png');
    // SQL 应使用 site_settings 表与 homepage_hero_image 键
    expect(mockedQuery.mock.calls[0][0]).toContain('site_settings');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['homepage_hero_image']);
  });

  it('getHomepageImage 未配置时返回 null', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    const url = await adminService.getHomepageImage();
    expect(url).toBeNull();
  });

  it('setHomepageImage 使用 UPSERT 写入', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await adminService.setHomepageImage('https://cdn.example.com/hero.png', 'admin-1');

    expect(result.url).toBe('https://cdn.example.com/hero.png');
    expect(result.updatedBy).toBe('admin-1');
    // SQL 应包含 ON CONFLICT (key) DO UPDATE
    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
  });

  it('setHomepageImage URL 为空时抛 BadRequestError', async () => {
    await expect(adminService.setHomepageImage('', 'admin-1')).rejects.toBeInstanceOf(BadRequestError);
    await expect(adminService.setHomepageImage(null as unknown as string, 'admin-1')).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('admin.service - 举报处理', () => {
  it('createReport 入库前清洗 reason 中的 XSS 节点，避免存储型 XSS 污染管理员审核界面', async () => {
    // 模拟 INSERT RETURNING：回显清洗后的 reason，验证 service 层确实把清洗后的值写入 DB
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r1',
        reporter_id: 'u1',
        target_type: 'skill',
        target_id: 's1',
        reason: '举报理由',
        status: 'pending',
        created_at: new Date(),
      }],
    } as unknown as DbResult);

    // payload 包含 <script> 与 onerror 事件处理器两类常见 XSS 向量
    const xssPayload = '<script>alert("xss")</script>正常举报理由<img src=x onerror=alert(1)>';
    await adminService.createReport('u1', 'skill', 's1', xssPayload);

    // 不变式：传入 query 的第 4 个参数（reason）不得包含可执行的 <script> 与 onerror 危险节点
    // xss 库默认将 <script> 转义为 HTML entity（&lt;script&gt;）而非剥离，同时剥离 onerror 属性
    const insertCall = mockedQuery.mock.calls[0];
    const reasonParam = (insertCall[1] as unknown[])[3] as string;
    expect(reasonParam).not.toContain('<script>');
    expect(reasonParam).not.toContain('</script>');
    expect(reasonParam).not.toContain('onerror');
    // 正常举报文本应被保留，便于管理员阅读
    expect(reasonParam).toContain('正常举报理由');
  });
});
