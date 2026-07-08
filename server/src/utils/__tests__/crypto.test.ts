import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 导入被测模块：使用真实 Node.js crypto，不 mock 任何依赖
import {
  encryptPhone,
  decryptPhone,
  hashPhone,
  encryptIdCard,
  decryptIdCard,
  hashIdCard,
  _resetKeyCacheForTest,
} from '../crypto';

// 合法的 PII_ENCRYPT_KEY：64 位 hex 字符（32 字节），满足 getKey 的格式校验
const VALID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeEach(() => {
  // 每个测试前重置密钥缓存并配置合法密钥，避免上一个测试的缓存影响下一个测试
  _resetKeyCacheForTest();
  vi.stubEnv('PII_ENCRYPT_KEY', VALID_KEY);
});

afterEach(() => {
  // 恢复所有 stub 的环境变量，避免环境状态泄漏到后续测试
  vi.unstubAllEnvs();
});

describe('crypto 工具模块', () => {
  describe('getKey（通过 encryptPhone 间接测试）', () => {
    it('PII_ENCRYPT_KEY 未配置时应抛错', () => {
      // 模拟密钥未配置：空字符串为 falsy，getKey 会抛错
      vi.stubEnv('PII_ENCRYPT_KEY', '');
      expect(() => encryptPhone('13800138000')).toThrow('PII_ENCRYPT_KEY 环境变量未配置');
    });

    it('PII_ENCRYPT_KEY 格式错误时应抛错', () => {
      // 非 64 位 hex 字符串，不满足正则校验
      vi.stubEnv('PII_ENCRYPT_KEY', 'invalid-key');
      expect(() => encryptPhone('13800138000')).toThrow('PII_ENCRYPT_KEY 格式错误');
    });

    it('PII_ENCRYPT_KEY 含非 hex 字符时应抛错', () => {
      // 长度 64 但含非 hex 字符（g/h/i 不在 0-9a-f 范围）
      vi.stubEnv('PII_ENCRYPT_KEY', 'g'.repeat(64));
      expect(() => encryptPhone('13800138000')).toThrow('PII_ENCRYPT_KEY 格式错误');
    });
  });

  describe('encryptPhone', () => {
    it('应返回 base64(iv).base64(authTag).base64(cipherText) 三段格式', () => {
      const cipher = encryptPhone('13800138000');
      const parts = cipher.split('.');
      expect(parts).toHaveLength(3);
      // 每段都应是合法 base64（可被 Buffer.from 解析）
      parts.forEach((part) => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });

    it('相同明文多次加密应产生不同密文（IV 随机）', () => {
      // GCM 模式每次加密使用随机 IV，相同明文产生不同密文，防止重放攻击
      const c1 = encryptPhone('13800138000');
      const c2 = encryptPhone('13800138000');
      expect(c1).not.toBe(c2);
    });

    it('密钥缓存生效后不重复派生（连续调用不抛错）', () => {
      // 第一次调用后 cachedKey 已设置，后续调用即使删除环境变量也能正常工作
      encryptPhone('13800138000');
      vi.stubEnv('PII_ENCRYPT_KEY', '');
      // 缓存命中，不重新读取环境变量
      expect(() => encryptPhone('13900139000')).not.toThrow();
    });
  });

  describe('decryptPhone', () => {
    it('加密后解密应还原明文', () => {
      const phone = '13800138000';
      const cipher = encryptPhone(phone);
      expect(decryptPhone(cipher)).toBe(phone);
    });

    it('密文格式错误（段数不为 3）应抛错', () => {
      expect(() => decryptPhone('invalid')).toThrow('密文格式错误');
      expect(() => decryptPhone('a.b')).toThrow('密文格式错误');
      expect(() => decryptPhone('a.b.c.d')).toThrow('密文格式错误');
    });

    it('authTag 被篡改应抛错（GCM 认证失败）', () => {
      const cipher = encryptPhone('13800138000');
      const parts = cipher.split('.');
      // 篡改 authTag 段：替换为另一个合法 base64 字符串
      parts[1] = Buffer.from('tampered-tag').toString('base64');
      expect(() => decryptPhone(parts.join('.'))).toThrow();
    });

    it('密文段被篡改应抛错（GCM 认证失败）', () => {
      const cipher = encryptPhone('13800138000');
      const parts = cipher.split('.');
      // 篡改密文段：修改最后一个 base64 字符
      const last = parts[2];
      parts[2] = last.slice(0, -1) + (last.slice(-1) === 'A' ? 'B' : 'A');
      expect(() => decryptPhone(parts.join('.'))).toThrow();
    });

    it('IV 被篡改应抛错（GCM 认证失败）', () => {
      const cipher = encryptPhone('13800138000');
      const parts = cipher.split('.');
      // 篡改 IV 段
      parts[0] = Buffer.from('tampered-iv').toString('base64');
      expect(() => decryptPhone(parts.join('.'))).toThrow();
    });
  });

  describe('hashPhone', () => {
    it('应返回 64 字符 hex 字符串', () => {
      const hash = hashPhone('13800138000');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('相同输入应产生相同哈希（确定性）', () => {
      // 哈希函数必须是确定性的，用于等值查询与唯一性约束
      expect(hashPhone('13800138000')).toBe(hashPhone('13800138000'));
    });

    it('不同输入应产生不同哈希', () => {
      expect(hashPhone('13800138000')).not.toBe(hashPhone('13900139000'));
    });
  });

  describe('encryptIdCard / decryptIdCard', () => {
    it('加密后解密应还原明文（复用手机号加密逻辑）', () => {
      const idCard = '110101199001011234';
      const cipher = encryptIdCard(idCard);
      expect(decryptIdCard(cipher)).toBe(idCard);
    });

    it('encryptIdCard 产生的密文可被 decryptPhone 解密（同一加密算法）', () => {
      // 验证身份证加密与手机号解密共用同一套 AES-256-GCM 逻辑
      const idCard = '110101199001011234';
      const cipher = encryptIdCard(idCard);
      expect(decryptPhone(cipher)).toBe(idCard);
    });
  });

  describe('hashIdCard', () => {
    it('应返回 64 字符 hex 字符串', () => {
      const hash = hashIdCard('110101199001011234');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('相同输入应产生相同哈希（确定性）', () => {
      expect(hashIdCard('110101199001011234')).toBe(hashIdCard('110101199001011234'));
    });

    it('不同身份证应产生不同哈希', () => {
      expect(hashIdCard('110101199001011234')).not.toBe(hashIdCard('110101199001011235'));
    });
  });

  describe('_resetKeyCacheForTest', () => {
    it('重置缓存后下次加密会重新派生密钥', () => {
      // 先产生一次缓存
      const cipher1 = encryptPhone('13800138000');
      // 重置缓存
      _resetKeyCacheForTest();
      // 重新加密应正常工作（重新读取环境变量派生密钥）
      const cipher2 = encryptPhone('13800138000');
      // 两次密文不同（IV 随机），但都能被解密还原
      expect(cipher1).not.toBe(cipher2);
      expect(decryptPhone(cipher1)).toBe('13800138000');
      expect(decryptPhone(cipher2)).toBe('13800138000');
    });

    it('重置缓存后删除环境变量应导致加密抛错', () => {
      // 先产生缓存
      encryptPhone('13800138000');
      // 重置缓存
      _resetKeyCacheForTest();
      // 删除环境变量后应抛错（缓存已清空，需重新读取）
      vi.stubEnv('PII_ENCRYPT_KEY', '');
      expect(() => encryptPhone('13800138000')).toThrow('PII_ENCRYPT_KEY 环境变量未配置');
    });
  });
});
