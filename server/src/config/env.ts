import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

// 加载环境变量：从多个候选路径查找 .env，兼容 tsx dev 和编译后运行
const envCandidates = [
  path.resolve(__dirname, '../../.env'),       // src/config/ → 项目根目录（编译后）
  path.resolve(__dirname, '../../../.env'),    // src/config/ → 项目根目录（tsx 运行时）
  path.resolve(process.cwd(), '.env'),         // 工作目录
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

// 敏感变量校验：JWT_SECRET 与 DB_PASSWORD 必须显式配置，避免使用不安全的默认值导致生产环境风险
// 校验后赋值给局部变量实现类型收窄（string | undefined → string），避免后续 as string 断言
// 设计原因：若后续重构移动了校验代码，as string 会静默将 undefined 当作 string 传递，
// 收窄后编译器即可在调用方捕获未校验的访问
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  logger.error('JWT_SECRET 环境变量必须配置，请参考 .env.example 并在 .env 中设置高强度随机字符串');
  process.exit(1);
}

const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) {
  logger.error('DB_PASSWORD 环境变量必须配置，请参考 .env.example 并在 .env 中设置数据库密码');
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

// 生产环境关键配置校验规则：每项包含校验函数与对应的错误提示
interface ConfigCheck {
  name: string;
  isValid: () => boolean;
  message: string;
}

const productionChecks: ConfigCheck[] = [
  {
    name: 'REDIS_PASSWORD',
    isValid: () => !!process.env.REDIS_PASSWORD,
    message: 'REDIS_PASSWORD 未配置：生产环境必须设置 Redis 密码，否则缓存数据可被任意读写',
  },
  {
    name: 'CORS_ORIGIN',
    isValid: () => {
      const origin = process.env.CORS_ORIGIN || '';
      // 生产环境不允许使用 localhost / 127.0.0.1，否则任意本地开发环境都可访问生产 API
      return !!origin && !origin.includes('localhost') && !origin.includes('127.0.0.1');
    },
    message: 'CORS_ORIGIN 配置不安全：生产环境不能使用 localhost 或 127.0.0.1',
  },
  {
    name: 'JWT_SECRET',
    isValid: () => {
      // 常见不安全默认值清单：命中任一即视为未替换
      const defaultSecrets = ['your-secret-key', 'secret', 'jwt-secret', 'change-me'];
      return !defaultSecrets.includes(jwtSecret);
    },
    message: 'JWT_SECRET 使用了默认值：生产环境必须使用高强度随机字符串',
  },
  {
    name: 'PII_ENCRYPT_KEY',
    isValid: () => !!process.env.PII_ENCRYPT_KEY,
    message: 'PII_ENCRYPT_KEY 未配置：生产环境必须设置 PII 加密密钥（32 字节 hex 字符串）',
  },
];

if (isProduction) {
  // 生产环境：任一校验失败即终止启动，避免带病上线造成安全隐患
  const failures = productionChecks.filter((check) => !check.isValid());
  if (failures.length > 0) {
    logger.error({ failures: failures.map((f) => f.message) }, '生产环境配置校验失败，请修复以下问题后重启');
    process.exit(1);
  }
} else {
  // 开发环境：仅输出 warn 提示，不阻止启动以便快速调试
  productionChecks.forEach((check) => {
    if (!check.isValid()) {
      logger.warn({ check: check.name, message: check.message }, '[配置提示]');
    }
  });
}

// JWT_EXPIRES_IN 默认值：生产环境 2h（降低令牌泄露风险），开发环境 7d（便于调试）
// 显式配置 JWT_EXPIRES_IN 时优先使用配置值
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || (isProduction ? '2h' : '7d');

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // 数据库配置
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_NAME: process.env.DB_NAME || 'linli_circle',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: dbPassword,

  // Redis配置（共享实例时 community 用 DB 0，emotion 用 DB 1）
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  REDIS_DB: parseInt(process.env.REDIS_DB || '0', 10),

  // JWT配置
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: jwtExpiresIn,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  // CORS配置
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // 限流配置
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),

  // 备份配置
  BACKUP_DIR: process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups'),

  // 高德地图配置
  AMAP_KEY: process.env.AMAP_KEY || '',

  // 通知通道配置：站内信+WebSocket 默认启用（由 notification.service.ts 处理）
  // 邮件/短信为外部通道，默认关闭，配置启用开关 + 凭证后由 notification-channels.ts 分发
  // 降级策略：未配置凭证时仅记录本地日志，符合规范第六章第三方依赖降级方案
  NOTIFICATION_EMAIL_ENABLED: process.env.NOTIFICATION_EMAIL_ENABLED === 'true',
  NOTIFICATION_SMS_ENABLED: process.env.NOTIFICATION_SMS_ENABLED === 'true',
  // SMTP 凭证（nodemailer 已接入，凭证齐全时真实发送，否则降级本地日志）
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  // SMTP_FROM 发件人地址：显式配置避免依赖 nodemailer 默认值（SMTP_USER）
  // 未配置时回退到 SMTP_USER，保证向后兼容；生产环境建议显式设置专用发件人地址
  SMTP_FROM: process.env.SMTP_FROM || '',
  // 短信服务商配置（阿里云 dysmsapi + 腾讯云 sms 双 provider 均已接入）
  // SMS_PROVIDER 取值：'aliyun' / 'tencent' / ''（降级 mock 日志）
  // 凭证齐全时由 notification-channels.ts 创建对应 provider 的真实 client 发送短信，否则降级本地日志
  SMS_PROVIDER: process.env.SMS_PROVIDER || '',
  // 阿里云短信凭证（SMS_PROVIDER='aliyun' 时使用）
  SMS_ACCESS_KEY: process.env.SMS_ACCESS_KEY || '',
  SMS_ACCESS_SECRET: process.env.SMS_ACCESS_SECRET || '',
  SMS_SIGN_NAME: process.env.SMS_SIGN_NAME || '',
  // 阿里云短信模板 CODE：控制台预审批的模板编号（如 SMS_123456789）
  // 模板内容建议格式："${title}：${content}"，业务侧将通知 title/content 包装为模板参数
  SMS_TEMPLATE_CODE: process.env.SMS_TEMPLATE_CODE || '',
  // 阿里云短信 API endpoint：默认 dysmsapi.aliyuncs.com，可按需替换为地域 endpoint
  SMS_ENDPOINT: process.env.SMS_ENDPOINT || 'dysmsapi.aliyuncs.com',
  // 腾讯云短信凭证（SMS_PROVIDER='tencent' 时使用）
  // 腾讯云使用 SecretId/SecretKey 鉴权（非阿里云的 AccessKey 模式），需在访问管理 CAM 创建
  SMS_TENCENT_SECRET_ID: process.env.SMS_TENCENT_SECRET_ID || '',
  SMS_TENCENT_SECRET_KEY: process.env.SMS_TENCENT_SECRET_KEY || '',
  // 腾讯云短信 SdkAppId：在短信控制台添加应用后生成（如 1400006666），与阿里云的签名/模板体系不同
  SMS_TENCENT_SDK_APP_ID: process.env.SMS_TENCENT_SDK_APP_ID || '',
  // 腾讯云短信签名内容（非签名 ID）与模板 ID，模板参数用位置数组 TemplateParamSet 传递
  // 模板内容建议格式："{1}：{2}"，业务侧按位置传入 [title, content]
  SMS_TENCENT_SIGN_NAME: process.env.SMS_TENCENT_SIGN_NAME || '',
  SMS_TENCENT_TEMPLATE_ID: process.env.SMS_TENCENT_TEMPLATE_ID || '',
  // 腾讯云地域：默认 ap-guangzhou，短信服务为全球服务，地域仅影响接入点
  SMS_TENCENT_REGION: process.env.SMS_TENCENT_REGION || 'ap-guangzhou',

  // OSS 云存储配置（预留接入，默认关闭）
  // 未启用时使用本地磁盘存储，配置凭证后由 storage-adapter 切换到云存储
  // 降级策略：OSS_ENABLED=true 但凭证不全时仍使用本地存储，避免服务启动失败
  OSS_ENABLED: process.env.OSS_ENABLED === 'true',
  OSS_ENDPOINT: process.env.OSS_ENDPOINT || '',
  OSS_BUCKET: process.env.OSS_BUCKET || '',
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID || '',
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET || '',
  // OSS 自定义域名（CDN 加速域名），未配置时使用默认 OSS Endpoint
  OSS_CUSTOM_DOMAIN: process.env.OSS_CUSTOM_DOMAIN || '',

  // 图片 URL 域名白名单（逗号分隔），供 sanitize.validateImageUrl 校验外链
  // 本地上传返回的 /uploads/ 相对路径无需走白名单，由 sanitize 内部直接放行
  IMAGES_WHITELIST_DOMAINS: process.env.IMAGES_WHITELIST_DOMAINS || 'trae-api-cn.mchost.guru',
};
