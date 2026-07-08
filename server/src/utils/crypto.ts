import crypto from 'crypto';

/**
 * 手机号加密 / 哈希工具
 *
 * 设计说明：
 * - 加密算法：AES-256-GCM（带认证标签，可检测密文是否被篡改）
 * - 密钥来源：环境变量 PII_ENCRYPT_KEY（32 字节 hex 字符串，64 个 hex 字符）
 * - 密钥派生：使用 scryptSync 从 hex 字符串派生 32 字节密钥，增加破解成本
 * - 密文格式：base64(iv).base64(authTag).base64(cipherText)，便于存储与可逆解析
 * - phone_hash：SHA-256 哈希，用于唯一性约束与等值查询（不可逆，无法还原手机号）
 */

// IV 长度：GCM 推荐使用 12 字节
const IV_LENGTH = 12;
// 密钥长度：AES-256 需要 32 字节
const KEY_LENGTH = 32;
// scrypt 派生参数（N=16384, r=8, p=1 为 OWASP 推荐的合理强度）
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// 缓存派生出的密钥，避免每次加解密都重复执行 scrypt（scrypt 本身就是为抵抗暴力破解而设计，重复执行无意义）
let cachedKey: Buffer | null = null;

/**
 * 从环境变量读取并派生密钥
 * 失败时直接抛错：缺少密钥时应用不应继续运行（PII 加密是合规底线）
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const rawKey = process.env.PII_ENCRYPT_KEY;
  if (!rawKey) {
    throw new Error('PII_ENCRYPT_KEY 环境变量未配置，请参考 .env.example 设置 32 字节 hex 字符串');
  }

  // 校验格式：必须是 64 位 hex 字符（即 32 字节）
  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error('PII_ENCRYPT_KEY 格式错误，应为 32 字节 hex 字符串（64 个 hex 字符）');
  }

  // 用固定 salt + scrypt 派生密钥：salt 与密钥本身绑定，攻击者拿到密钥文件仍需暴力 scrypt
  // 注意：salt 不需要随机化，因为密钥本身已是高熵随机值
  const salt = Buffer.from('linli-circle-pii-salt', 'utf8');
  cachedKey = crypto.scryptSync(rawKey, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return cachedKey;
}

/**
 * 加密手机号
 * @param phone 明文手机号
 * @returns 密文字符串，格式：base64(iv).base64(authTag).base64(cipherText)
 */
export function encryptPhone(phone: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(phone, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

/**
 * 解密手机号
 * @param cipherText 密文字符串，格式：base64(iv).base64(authTag).base64(cipherText)
 * @returns 明文手机号
 */
export function decryptPhone(cipherText: string): string {
  const parts = cipherText.split('.');
  if (parts.length !== 3) {
    throw new Error('密文格式错误，应为 base64(iv).base64(authTag).base64(cipherText)');
  }

  const [ivB64, authTagB64, dataB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  // 若 authTag 不匹配（密文被篡改 / 密钥错误），此处会抛错
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * 计算手机号的哈希值（用于唯一性约束与等值查询）
 * 使用 SHA-256，输出 64 位 hex 字符串
 * @param phone 明文手机号
 * @returns 64 字符 hex 哈希
 */
export function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone, 'utf8').digest('hex');
}

/**
 * 加密身份证号（复用手机号加密逻辑）
 * @param idCard 明文身份证号
 * @returns 密文字符串，格式：base64(iv).base64(authTag).base64(cipherText)
 */
export function encryptIdCard(idCard: string): string {
  return encryptPhone(idCard); // 复用相同的加密逻辑
}

/**
 * 解密身份证号（复用手机号解密逻辑）
 * @param cipherText 密文字符串
 * @returns 明文身份证号
 */
export function decryptIdCard(cipherText: string): string {
  return decryptPhone(cipherText); // 复用相同的解密逻辑
}

/**
 * 计算身份证号的哈希值（用于唯一性约束与等值查询）
 * 使用 SHA-256，输出 64 位 hex 字符串
 * @param idCard 明文身份证号
 * @returns 64 字符 hex 哈希
 */
export function hashIdCard(idCard: string): string {
  return crypto.createHash('sha256').update(idCard, 'utf8').digest('hex');
}

/**
 * 重置缓存的密钥（仅供测试使用，避免内存中残留旧密钥影响后续测试）
 */
export function _resetKeyCacheForTest(): void {
  cachedKey = null;
}
