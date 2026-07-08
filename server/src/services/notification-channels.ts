import nodemailer, { type Transporter } from 'nodemailer';
import Dysmsapi20170525, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { $OpenApiUtil } from '@alicloud/openapi-core';
// 腾讯云短信 SDK：仅引入 sms 子包（非完整 tencentcloud-sdk-nodejs），控制依赖体积
// 命名空间结构：sms.v20210111.Client 为短信发送客户端类
import { sms as tencentSms } from 'tencentcloud-sdk-nodejs-sms';
import { query } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// 外部通道统一载荷：站内信已由 notification.service.ts 落库 + WS 推送，
// 此处仅承载外部通道（邮件/短信）所需的最小字段，避免与站内信逻辑耦合
export interface ExternalNotificationPayload {
  userId: string;
  type: string;
  title: string;
  content?: string;
  // 用户联系信息由 dispatchExternalChannels 统一查询后填充，
  // 通道本身不查库，职责单一便于测试与替换
  userEmail?: string;
  userPhone?: string;
}

// 通知通道抽象接口：每个外部通道实现 send 方法
// 设计原因：后续接入真实 SMTP/短信 SDK 时，只需替换 send 实现，无需改动调用方
export interface NotificationChannel {
  name: 'email' | 'sms';
  enabled: boolean;
  send(payload: ExternalNotificationPayload): Promise<void>;
}

// 邮件 transporter 单例：避免每次发送都重建连接，提升性能
// 凭证不全时为 null，emailChannel.send 走降级日志路径
let emailTransporter: Transporter | null = null;

/**
 * 获取邮件 transporter 单例
 * 设计原因：
 * 1. 单例缓存避免重复 createTransport 的连接开销
 * 2. 凭证齐全（SMTP_HOST 有值）时创建真实 transporter，否则返回 null 走降级
 * 3. 465 端口用 SSL 直连，其他端口用 STARTTLS（nodemailer 惯例）
 */
function getEmailTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (emailTransporter) return emailTransporter;
  emailTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    // SMTP_USER 为空时无需 auth（部分内网 SMTP 允许匿名）
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return emailTransporter;
}

/**
 * 供测试重置 transporter 单例，避免跨用例污染
 */
export function __resetEmailTransporterForTest(): void {
  emailTransporter = null;
}

// 邮件通道
// 未配置 SMTP 时降级为本地日志输出（mock 模式），符合规范第六章降级策略
// 配置 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS 后通过 nodemailer 真实发送
// 发件人地址优先使用 SMTP_FROM，未配置时回退到 SMTP_USER（向后兼容）
export const emailChannel: NotificationChannel = {
  name: 'email',
  enabled: env.NOTIFICATION_EMAIL_ENABLED,
  async send(payload: ExternalNotificationPayload): Promise<void> {
    // 无有效邮箱直接跳过，避免无效调用
    if (!payload.userEmail) return;

    const transporter = getEmailTransporter();
    if (transporter) {
      // 真实发送：调用 nodemailer transporter.sendMail
      // from 显式使用 SMTP_FROM，未配置时回退到 SMTP_USER，避免依赖 nodemailer 默认值
      // content 为空时回退到 title，避免空邮件正文
      const fromAddress = env.SMTP_FROM || env.SMTP_USER;
      await transporter.sendMail({
        from: fromAddress,
        to: payload.userEmail,
        subject: payload.title,
        text: payload.content || payload.title,
      });
    } else {
      // 降级模式：本地日志输出通知内容，便于开发调试观察
      // 不打印用户邮箱完整值，避免日志泄露 PII（与 mask.ts 原则一致）
      logger.info(
        {
          to: payload.userEmail,
          type: payload.type,
          title: payload.title,
        },
        '[邮件通知-本地mock] 已记录通知内容',
      );
    }
  },
};

// 短信 client 单例：避免每次发送都重建连接，提升性能
// 凭证不全时为 null，smsChannel.send 走降级日志路径
let smsClient: Dysmsapi20170525 | null = null;

/**
 * 获取阿里云短信 client 单例
 * 设计原因：
 * 1. 单例缓存避免重复创建 client 的开销
 * 2. SMS_PROVIDER='aliyun' 且凭证齐全（ACCESS_KEY/ACCESS_SECRET/SIGN_NAME/TEMPLATE_CODE）时创建真实 client
 * 3. 其他 provider 或凭证不全返回 null，由 smsChannel.send 走腾讯云分支或降级/warn 路径
 */
function getSmsClient(): Dysmsapi20170525 | null {
  // 仅处理阿里云 provider，腾讯云由 getTencentSmsClient 处理
  if (env.SMS_PROVIDER !== 'aliyun') return null;
  // 凭证完整性校验：缺任一必要凭证即返回 null，避免运行时崩溃
  if (!env.SMS_ACCESS_KEY || !env.SMS_ACCESS_SECRET || !env.SMS_SIGN_NAME || !env.SMS_TEMPLATE_CODE) {
    return null;
  }
  if (smsClient) return smsClient;
  // 阿里云 dysmsapi client 构造：endpoint 默认 dysmsapi.aliyuncs.com
  // Config 类继承自 darabonba Model，必须用 new Config({...}) 构造（含 toMap 方法），不能直接传字面量对象
  smsClient = new Dysmsapi20170525(
    new $OpenApiUtil.Config({
      accessKeyId: env.SMS_ACCESS_KEY,
      accessKeySecret: env.SMS_ACCESS_SECRET,
      endpoint: env.SMS_ENDPOINT,
    }),
  );
  return smsClient;
}

/**
 * 供测试重置阿里云 smsClient 单例，避免跨用例污染
 */
export function __resetSmsClientForTest(): void {
  smsClient = null;
}

// 腾讯云短信 Client 类型：约束 SendSms 方法签名，避免测试 mock 依赖 SDK 内部复杂类型
// 设计原因：与阿里云 Dysmsapi20170525 类型对齐，测试只需 mock SendSms 方法即可
type TencentSmsClient = {
  SendSms: (req: {
    PhoneNumberSet: string[];
    SmsSdkAppId: string;
    TemplateId: string;
    SignName?: string;
    TemplateParamSet?: string[];
  }) => Promise<unknown>;
};

// 腾讯云短信 client 单例：避免每次发送都重建连接，提升性能
// 凭证不全时为 null，smsChannel.send 走降级日志或 warn 路径
let tencentSmsClient: TencentSmsClient | null = null;

/**
 * 将手机号格式化为腾讯云要求的 E.164 标准格式（+[国家码][手机号]）
 * 设计原因：腾讯云 SendSms 接口要求 PhoneNumberSet 为 E.164 格式（如 +8613800000000），
 * 而数据库存储的手机号通常为 11 位裸号（13800000000），需统一加 +86 前缀；
 * 若号码已带 + 前缀则原样返回，避免重复拼接
 */
function formatPhoneForTencent(phone: string): string {
  if (phone.startsWith('+')) return phone;
  // 国内 11 位手机号补 +86 前缀，其他情况兜底补 +86（业务场景以国内为主）
  return phone.startsWith('86') ? `+${phone}` : `+86${phone}`;
}

/**
 * 获取腾讯云短信 client 单例
 * 设计原因：
 * 1. 单例缓存避免重复创建 client 的开销（对齐阿里云 smsClient 模式）
 * 2. SMS_PROVIDER='tencent' 且凭证齐全（SECRET_ID/SECRET_KEY/SDK_APP_ID/SIGN_NAME/TEMPLATE_ID）时创建真实 client
 * 3. 其他 provider 或凭证不全返回 null，由 smsChannel.send 走降级或 warn 路径
 * 4. 通过类型断言将 SDK Client 收敛为 TencentSmsClient 接口，隔离 SDK 内部类型变动影响
 */
function getTencentSmsClient(): TencentSmsClient | null {
  if (env.SMS_PROVIDER !== 'tencent') return null;
  // 凭证完整性校验：腾讯云需 5 项凭证（SecretId/SecretKey/SdkAppId/SignName/TemplateId），缺任一即返回 null
  if (
    !env.SMS_TENCENT_SECRET_ID ||
    !env.SMS_TENCENT_SECRET_KEY ||
    !env.SMS_TENCENT_SDK_APP_ID ||
    !env.SMS_TENCENT_SIGN_NAME ||
    !env.SMS_TENCENT_TEMPLATE_ID
  ) {
    return null;
  }
  if (tencentSmsClient) return tencentSmsClient;
  // 腾讯云 sms Client 构造：credential 鉴权 + region 地域 + httpProfile.endpoint 接入点
  // 短信服务为全球服务，endpoint 固定 sms.tencentcloudapi.com，region 仅影响接入点选择
  const SmsClient = tencentSms.v20210111.Client;
  tencentSmsClient = new SmsClient({
    credential: {
      secretId: env.SMS_TENCENT_SECRET_ID,
      secretKey: env.SMS_TENCENT_SECRET_KEY,
    },
    region: env.SMS_TENCENT_REGION,
    profile: {
      httpProfile: {
        endpoint: 'sms.tencentcloudapi.com',
      },
    },
  }) as TencentSmsClient;
  return tencentSmsClient;
}

/**
 * 供测试重置腾讯云 smsClient 单例，避免跨用例污染
 */
export function __resetTencentSmsClientForTest(): void {
  tencentSmsClient = null;
}

// 短信通道
// 未配置 SMS_PROVIDER 时降级为本地日志输出（mock 模式），符合规范第六章降级策略
// SMS_PROVIDER='aliyun' 且凭证齐全时通过阿里云 dysmsapi SDK 真实发送
// SMS_PROVIDER='tencent' 且凭证齐全时通过腾讯云 sms SDK 真实发送
export const smsChannel: NotificationChannel = {
  name: 'sms',
  enabled: env.NOTIFICATION_SMS_ENABLED,
  async send(payload: ExternalNotificationPayload): Promise<void> {
    // 无有效手机号直接跳过
    if (!payload.userPhone) return;

    // 优先尝试阿里云 client（getSmsClient 内部已校验 SMS_PROVIDER='aliyun' 与凭证完整性）
    const aliyunClient = getSmsClient();
    if (aliyunClient) {
      // 阿里云真实发送：构造 SendSmsRequest 调用 client.sendSms
      // 模板参数将通知 title/content 包装为 JSON，业务方在阿里云控制台配置模板如 "${title}：${content}"
      const request = new SendSmsRequest({
        phoneNumbers: payload.userPhone,
        signName: env.SMS_SIGN_NAME,
        templateCode: env.SMS_TEMPLATE_CODE,
        templateParam: JSON.stringify({
          title: payload.title,
          content: payload.content || '',
        }),
      });
      await aliyunClient.sendSms(request);
      return;
    }

    // 阿里云未命中，尝试腾讯云 client（getTencentSmsClient 内部已校验 SMS_PROVIDER='tencent' 与凭证完整性）
    const tencentClient = getTencentSmsClient();
    if (tencentClient) {
      // 腾讯云真实发送：构造 SendSms 请求调用 client.SendSms
      // 模板参数用位置数组 TemplateParamSet（与阿里云的 JSON 对象不同），业务方在腾讯云控制台配置模板如 "{1}：{2}"
      // 手机号需转为 E.164 格式（+8613800000000），腾讯云接口强制要求
      await tencentClient.SendSms({
        PhoneNumberSet: [formatPhoneForTencent(payload.userPhone)],
        SmsSdkAppId: env.SMS_TENCENT_SDK_APP_ID,
        SignName: env.SMS_TENCENT_SIGN_NAME,
        TemplateId: env.SMS_TENCENT_TEMPLATE_ID,
        TemplateParamSet: [payload.title, payload.content || ''],
      });
      return;
    }

    // 两个 provider 均未命中真实 client，按 provider 类型输出对应的降级提示
    if (env.SMS_PROVIDER === 'tencent') {
      // 腾讯云已配置但凭证不全：输出 warn 提示补全凭证
      logger.warn(
        { provider: env.SMS_PROVIDER, type: payload.type },
        '[短信通道] 腾讯云 SMS_PROVIDER 已配置但凭证不全（需 SMS_TENCENT_SECRET_ID/SMS_TENCENT_SECRET_KEY/SMS_TENCENT_SDK_APP_ID/SMS_TENCENT_SIGN_NAME/SMS_TENCENT_TEMPLATE_ID），降级为本地日志',
      );
    } else if (env.SMS_PROVIDER === 'aliyun') {
      // 阿里云已配置但凭证不全：输出 warn 提示补全凭证
      logger.warn(
        { provider: env.SMS_PROVIDER, type: payload.type },
        '[短信通道] 阿里云 SMS_PROVIDER 已配置但凭证不全（需 SMS_ACCESS_KEY/SMS_ACCESS_SECRET/SMS_SIGN_NAME/SMS_TEMPLATE_CODE），降级为本地日志',
      );
    } else {
      // 降级模式：只记录 userId 与通知摘要，不打印手机号（PII 保护）
      logger.info(
        {
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
        },
        '[短信通知-本地mock] 已记录通知内容',
      );
    }
  },
};

// 启用的外部通道列表：根据配置动态组装，未启用的通道不参与分发
const externalChannels: NotificationChannel[] = [emailChannel, smsChannel].filter(
  (channel) => channel.enabled,
);

/**
 * 外部通道分发：在站内信落库 + WS 推送之后调用
 * 设计要点：
 * 1. 两个外部通道均未启用时直接返回，避免无谓的 DB 查询（性能保护）
 * 2. 单次查询 users 表获取 email/phone，供所有通道复用（避免重复查库）
 * 3. 并发分发 + allSettled，单个通道失败不影响其他通道与主业务流程
 * 4. 调用方应使用 .catch(() => {}) 吞掉异常，确保通知不阻塞主事务
 */
export async function dispatchExternalChannels(notification: {
  userId: string;
  type: string;
  title: string;
  content?: string;
}): Promise<void> {
  // 任一外部通道未启用则直接返回，避免无谓的 DB 查询
  if (externalChannels.length === 0) return;

  // 查询用户联系信息（单次查询，供 email/sms 通道复用）
  const { rows } = await query(
    'SELECT email, phone FROM users WHERE id = $1',
    [notification.userId],
  );
  if (rows.length === 0) return;

  const user = rows[0];
  const payload: ExternalNotificationPayload = {
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    content: notification.content,
    userEmail: user.email,
    userPhone: user.phone,
  };

  // 并发分发，单个通道失败不影响其他通道
  await Promise.allSettled(externalChannels.map((channel) => channel.send(payload)));
}

// 仅供单元测试使用：重置通道列表（测试动态启停场景）
export function __setChannelsForTest(channels: NotificationChannel[]): void {
  (externalChannels as NotificationChannel[]).splice(0, externalChannels.length, ...channels);
}
