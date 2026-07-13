/**
 * config/database 单元测试
 *
 * 测试目标：
 * - isSqlParam：类型守卫，校验值是否为 SqlParam 合法类型
 *   - null/undefined/boolean/string/number/Date/string[]/object 各种类型的边界校验
 *   - NaN/Infinity 拒绝（避免 pg 序列化异常）
 *   - 非字符串数组拒绝
 *   - class 实例拒绝（仅允许普通对象）
 *   - 函数/Symbol 拒绝
 *
 * 测试策略：isSqlParam 是纯函数无副作用，直接断言返回值。
 *           query/transaction/closePool 依赖 pg.Pool 真实连接，
 *           单元测试中难以隔离（所有 service 测试已 mock database 模块覆盖调用路径），
 *           本测试文件聚焦 isSqlParam 的运行时类型守卫逻辑。
 */
import { describe, it, expect } from 'vitest';
import { isSqlParam } from '../database';

describe('config/database isSqlParam - 合法类型放行', () => {
  it('null 放行（用于清空字段）', () => {
    expect(isSqlParam(null)).toBe(true);
  });

  it('string 放行', () => {
    expect(isSqlParam('hello')).toBe(true);
    expect(isSqlParam('')).toBe(true);
  });

  it('boolean 放行', () => {
    expect(isSqlParam(true)).toBe(true);
    expect(isSqlParam(false)).toBe(true);
  });

  it('有限 number 放行', () => {
    expect(isSqlParam(42)).toBe(true);
    expect(isSqlParam(0)).toBe(true);
    expect(isSqlParam(-1.5)).toBe(true);
    expect(isSqlParam(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('Date 实例放行（用于 timestamp 列）', () => {
    expect(isSqlParam(new Date())).toBe(true);
    expect(isSqlParam(new Date('2026-07-13T00:00:00Z'))).toBe(true);
  });

  it('string[] 放行（用于 images/tags 等数组字段）', () => {
    expect(isSqlParam(['a', 'b', 'c'])).toBe(true);
    expect(isSqlParam([])).toBe(true); // 空数组元素全部为字符串（vacuous truth）
  });

  it('普通对象放行（用于 JSONB 列）', () => {
    expect(isSqlParam({})).toBe(true);
    expect(isSqlParam({ key: 'value' })).toBe(true);
    expect(isSqlParam({ nested: { a: 1 } })).toBe(true);
    expect(isSqlParam(JSON.parse('{}'))).toBe(true);
  });
});

describe('config/database isSqlParam - 非法类型拒绝', () => {
  it('undefined 拒绝（避免 SQL 参数意外缺失）', () => {
    expect(isSqlParam(undefined)).toBe(false);
  });

  it('NaN 拒绝（避免 pg 序列化异常）', () => {
    expect(isSqlParam(NaN)).toBe(false);
  });

  it('Infinity 拒绝（避免 pg 序列化异常）', () => {
    expect(isSqlParam(Infinity)).toBe(false);
    expect(isSqlParam(-Infinity)).toBe(false);
  });

  it('非字符串数组拒绝（数组元素必须全部为字符串）', () => {
    expect(isSqlParam([1, 2, 3] as unknown as string[])).toBe(false);
    expect(isSqlParam(['a', 1, 'b'] as unknown as string[])).toBe(false);
    expect(isSqlParam([true, false] as unknown as string[])).toBe(false);
    expect(isSqlParam([null] as unknown as string[])).toBe(false);
    expect(isSqlParam([{ a: 1 }] as unknown as string[])).toBe(false);
  });

  it('class 实例拒绝：prototype 链检查严格区分普通对象与 class 实例', () => {
    // 改进说明：原实现用 Object.prototype.toString.call 无法区分 class 实例与普通对象
    // （均返回 '[object Object]'），导致 class 实例被错误放行。
    // 改用 prototype 链检查后，class 实例的 proto 为自定义原型链，
    // 不等于 Object.prototype 也不等于 null，被严格拒绝。
    class MyClass {
      constructor(public value: number) {}
    }
    // 改进后行为：class 实例被拒绝（proto 为 MyClass.prototype）
    expect(isSqlParam(new MyClass(1))).toBe(false);
  });

  it('Object.create(null) 放行：proto 为 null 的无原型对象视为普通对象', () => {
    // 补充覆盖：Object.create(null) 创建的对象没有原型链，proto 为 null，
    // 视为普通对象放行（JSON 友好，无方法污染）
    expect(isSqlParam(Object.create(null))).toBe(true);
    expect(isSqlParam(Object.create(null, { a: { value: 1, enumerable: true } }))).toBe(true);
  });

  it('函数拒绝', () => {
    expect(isSqlParam(() => {})).toBe(false);
    expect(isSqlParam(function () {})).toBe(false);
    expect(isSqlParam(async () => {})).toBe(false);
  });

  it('Symbol 拒绝', () => {
    expect(isSqlParam(Symbol('test'))).toBe(false);
  });

  it('BigInt 拒绝（typeof bigint 不在合法类型列表）', () => {
    expect(isSqlParam(BigInt(42))).toBe(false);
  });

  it('Map 拒绝（非普通对象）', () => {
    expect(isSqlParam(new Map())).toBe(false);
  });

  it('Set 拒绝（非普通对象）', () => {
    expect(isSqlParam(new Set())).toBe(false);
  });

  it('Buffer 拒绝（非普通对象）', () => {
    expect(isSqlParam(Buffer.from('test'))).toBe(false);
  });

  it('Error 实例拒绝（非普通对象）', () => {
    expect(isSqlParam(new Error('test'))).toBe(false);
  });
});

describe('config/database isSqlParam - 类型收窄验证', () => {
  it('通过 isSqlParam 后值可作为 SqlParam 使用（编译期收窄）', () => {
    // 验证 isSqlParam 作为 Type Guard 的语义：返回 true 时 TS 应将 unknown 收窄为 SqlParam
    const unknown: unknown = 'test';
    if (isSqlParam(unknown)) {
      // 此处 unknown 已被收窄为 SqlParam，可安全传给 SQL 查询
      // 测试逻辑：直接断言 unknown 为 string 类型
      expect(unknown).toBe('test');
    } else {
      // 不应进入此分支
      expect.unreachable('string 应通过 isSqlParam 校验');
    }
  });

  it('混合数组中过滤出合法 SqlParam', () => {
    // 实际场景：service 从客户端入参拿到 unknown[]，需过滤出合法 SQL 参数
    const mixed: unknown[] = ['valid', 42, null, NaN, undefined, { obj: true }, () => {}];
    const valid = mixed.filter(isSqlParam);
    // 期望保留：'valid' / 42 / null / { obj: true }
    // 期望排除：NaN / undefined / 函数
    expect(valid).toHaveLength(4);
    expect(valid).toContain('valid');
    expect(valid).toContain(42);
    expect(valid).toContain(null);
    expect(valid).toContainEqual({ obj: true });
  });
});
