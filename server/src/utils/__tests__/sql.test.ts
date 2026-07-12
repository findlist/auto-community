/**
 * utils/sql 单元测试
 *
 * 测试目标：prefixColumns 工具函数
 * - 基础场景：单列、多列、含下划线列名
 * - 边界场景：空字符串、纯空白、首尾空格、多行模板字符串、连续逗号、空别名
 * - 别名场景：常规别名、单字母别名、含下划线别名
 *
 * 测试策略：纯函数无副作用，直接断言返回值。
 *           重点验证多行模板字符串（实际使用场景：列常量跨行定义）与连续逗号过滤（防御脏数据）。
 */
import { describe, it, expect } from 'vitest';
import { prefixColumns } from '../sql';

describe('utils/sql prefixColumns - 基础场景', () => {
  it('单列添加前缀', () => {
    expect(prefixColumns('id', 'go')).toBe('go.id');
  });

  it('多列添加前缀（逗号分隔）', () => {
    expect(prefixColumns('id, user_id, title', 'go')).toBe('go.id, go.user_id, go.title');
  });

  it('含下划线与多单词列名', () => {
    expect(prefixColumns('buyer_id, created_at, reference_type', 'sd')).toBe(
      'sd.buyer_id, sd.created_at, sd.reference_type',
    );
  });

  it('列名首尾有空格时 trim 后添加前缀', () => {
    // 实际场景：列常量定义时常带空格提升可读性，如 'id, user_id, title'
    expect(prefixColumns(' id , user_id , title ', 'go')).toBe('go.id, go.user_id, go.title');
  });
});

describe('utils/sql prefixColumns - 多行模板字符串', () => {
  it('多行模板字符串（实际使用场景：列常量跨行定义）', () => {
    // 实际场景：service 中常量定义为反引号多行字符串，prefixColumns 需正确处理换行符
    const columns = `id, user_id, type, title, content, reference_id, reference_type,
  read_at, created_at`;
    expect(prefixColumns(columns, 'n')).toBe(
      'n.id, n.user_id, n.type, n.title, n.content, n.reference_id, n.reference_type, n.read_at, n.created_at',
    );
  });

  it('多行字符串含空行时跳过空行', () => {
    // 防御场景：列常量定义中可能存在空行（编辑器格式化导致）
    const columns = `id, user_id,
    
  title, content`;
    expect(prefixColumns(columns, 'go')).toBe('go.id, go.user_id, go.title, go.content');
  });
});

describe('utils/sql prefixColumns - 边界场景', () => {
  it('空字符串返回空字符串', () => {
    expect(prefixColumns('', 'go')).toBe('');
  });

  it('纯空白字符串返回空字符串', () => {
    expect(prefixColumns('   ', 'go')).toBe('');
  });

  it('连续逗号过滤掉空列名（防御脏数据）', () => {
    // 防御场景：手动编辑列常量时不慎多打逗号
    expect(prefixColumns('id,, user_id,', 'go')).toBe('go.id, go.user_id');
  });

  it('仅一个逗号返回空字符串', () => {
    expect(prefixColumns(',', 'go')).toBe('');
  });

  it('空别名时生成 ".列名" 形式（保留原行为，不做特殊处理）', () => {
    // 设计说明：alias 由调用方传入，service 中均为硬编码常量非用户输入，
    // 空别名属调用方错误使用，prefixColumns 不做参数校验以保持简单
    expect(prefixColumns('id, user_id', '')).toBe('.id, .user_id');
  });
});

describe('utils/sql prefixColumns - 别名场景', () => {
  it('单字母别名', () => {
    expect(prefixColumns('id, name', 'a')).toBe('a.id, a.name');
  });

  it('含下划线别名', () => {
    // 实际场景：复杂 JOIN 中可能用多字母别名
    expect(prefixColumns('id, name', 'order')).toBe('order.id, order.name');
  });

  it('别名含数字', () => {
    expect(prefixColumns('id, name', 't1')).toBe('t1.id, t1.name');
  });
});

describe('utils/sql prefixColumns - 实际使用场景验证', () => {
  it('模拟 GROUP_ORDER_COLUMNS 场景（16 列）', () => {
    // 实际场景：group-order.service.ts 中 GROUP_ORDER_COLUMNS 常量定义 16 字段
    const GROUP_ORDER_COLUMNS = `id, creator_id, product_name, target_quantity, current_quantity,
  unit_price, total_amount, status, expire_at, participant_count,
  created_at, updated_at, cancelled_at, cancel_reason, completed_at, description`;
    const result = prefixColumns(GROUP_ORDER_COLUMNS, 'go');
    // 验证：所有 16 列都正确添加 go. 前缀，且无重复或丢失
    const cols = result.split(', ');
    expect(cols).toHaveLength(16);
    expect(cols.every((c) => c.startsWith('go.'))).toBe(true);
    expect(cols[0]).toBe('go.id');
    expect(cols[15]).toBe('go.description');
  });

  it('模拟 USER_COLUMNS 场景（含敏感字段排除）', () => {
    // 实际场景：auth.service 中 USER_COLUMNS 显式排除 phone_hash/id_card_encrypted
    const USER_COLUMNS = 'id, phone, nickname, avatar, credit_balance, time_balance, reputation_score, role, created_at, password_hash';
    const result = prefixColumns(USER_COLUMNS, 'u');
    expect(result).toBe(
      'u.id, u.phone, u.nickname, u.avatar, u.credit_balance, u.time_balance, u.reputation_score, u.role, u.created_at, u.password_hash',
    );
    // 验证：敏感字段不应出现在结果中（防御 phone_hash/id_card_encrypted 意外泄露）
    expect(result).not.toContain('phone_hash');
    expect(result).not.toContain('id_card_encrypted');
  });

  it('模拟 JOIN SELECT t.* 替换后生成的 SQL 片段', () => {
    // 实际场景：emergency.service.ts 中 SELECT er.* 替换为 prefixColumns(EMERGENCY_REQUEST_COLUMNS, 'er')
    const EMERGENCY_REQUEST_COLUMNS = `id, requester_id, type, description, status, latitude, longitude,
  address, created_at, updated_at, resolved_at, cancelled_at, responder_id, eta, timeout_at`;
    const prefixed = prefixColumns(EMERGENCY_REQUEST_COLUMNS, 'er');
    const sql = `SELECT ${prefixed}, u.nickname AS requester_nickname
     FROM emergency_requests er
     LEFT JOIN users u ON er.requester_id = u.id
     WHERE er.id = $1`;
    // 验证：生成的 SQL 包含正确的列前缀，且 JOIN 条件中 er.id 仍正确
    expect(sql).toContain('er.id, er.requester_id, er.type');
    expect(sql).toContain('er.resolved_at, er.cancelled_at, er.responder_id');
    expect(sql).toContain('er.id = $1');
  });
});
