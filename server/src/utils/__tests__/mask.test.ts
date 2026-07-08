/**
 * PII 脱敏工具单元测试
 *
 * 测试目标：手机号、身份证号脱敏逻辑
 * 测试策略：纯函数无外部依赖，直接断言输入输出映射，重点覆盖边界（空值、长度不足）
 */

import { describe, it, expect } from 'vitest';
import { maskPhone, maskIdCard } from '../mask';

describe('maskPhone - 手机号脱敏', () => {
  it('正常 11 位手机号应保留前 3 后 4，中间 4 个 *', () => {
    // 13812345678 -> 138****5678
    expect(maskPhone('13812345678')).toBe('138****5678');
  });

  it('长度正好 7 位应正常脱敏（边界值）', () => {
    // head=123 tail=4567，结果 123****4567
    expect(maskPhone('1234567')).toBe('123****4567');
  });

  it('长度不足 7 位应全部替换为 *（避免泄露部分号码）', () => {
    // 5 位输入全部脱敏为 5 个 *
    expect(maskPhone('12345')).toBe('*****');
  });

  it('空字符串应返回空字符串', () => {
    expect(maskPhone('')).toBe('');
  });

  it('null/undefined 应返回空字符串（防御性处理）', () => {
    // phone?.length 对 null/undefined 为 undefined，Math.max(undefined||0,0)=0，repeat(0)=''
    expect(maskPhone(null as unknown as string)).toBe('');
    expect(maskPhone(undefined as unknown as string)).toBe('');
  });
});

describe('maskIdCard - 身份证号脱敏', () => {
  it('正常 18 位身份证应保留前 3 后 4，中间 11 个 *', () => {
    // 110101199001011234 -> 110***********1234（3 + 11* + 4）
    expect(maskIdCard('110101199001011234')).toBe('110***********1234');
  });

  it('长度正好 7 位应无中间 *（middleLen=0）', () => {
    // head=123 tail=4567，middleLen=7-3-4=0，结果 1234567
    expect(maskIdCard('1234567')).toBe('1234567');
  });

  it('长度不足 7 位应全部替换为 *', () => {
    expect(maskIdCard('12345')).toBe('*****');
  });

  it('空字符串应返回空字符串', () => {
    expect(maskIdCard('')).toBe('');
  });

  it('null 应返回空字符串（防御性处理）', () => {
    expect(maskIdCard(null as unknown as string)).toBe('');
  });

  it('15 位老身份证应正确脱敏（middleLen=15-3-4=8）', () => {
    // head=110 tail=1123（后4位），middle 8 个 *，结果 110********1123
    expect(maskIdCard('110101900101123')).toBe('110********1123');
  });
});
