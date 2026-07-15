/**
 * notification-channels 单元测试
 *
 * 测试目标：
 * - dispatchExternalChannels：通道未启用时不查库、启用时查询用户信息并分发、用户不存在时返回、单通道失败不影响整体
 * - emailChannel.send：无邮箱跳过、无 SMTP 走本地 mock 日志、有 SMTP 走 nodemailer 真实发送、SMTP_FROM 显式发件人
 * - smsChannel.send：无手机号跳过、无 provider 走本地 mock 日志、aliyun/tencent 凭证齐全走真实发送、凭证不全走 warn
 *
 * 测试策略：mock env / database / logger / nodemailer / @alicloud/dysmsapi20170525，通过 __setChannelsForTest 动态注入通道测试分发逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 可变 mock env：测试中动态修改 SMTP_HOST/SMS_PROVIDER 等字段，验证通道分支逻辑
// 所有被 vi.mock 引用的变量必须用 vi.hoisted 提升，避免 TDZ 错误
const {
  mockEnv,
  mockQuery,
  mockLogger,
  mockTransporter,
  mockCreateTransport,
  mockSmsClient,
  mockSmsConstructor,
  mockSendSmsRequest,
  mockTencentSmsClient,
  mockTencentSmsConstructor,
} = vi.hoisted(() => ({
  mockEnv: {
    NOTIFICATION_EMAIL_ENABLED: false,
    NOTIFICATION_SMS_ENABLED: false,
    SMTP_HOST: '',
    SMTP_PORT: 587,
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
    SMS_PROVIDER: '',
    SMS_ACCESS_KEY: '',
    SMS_ACCESS_SECRET: '',
    SMS_SIGN_NAME: '',
    SMS_TEMPLATE_CODE: '',
    SMS_ENDPOINT: 'dysmsapi.aliyuncs.com',
    SMS_TENCENT_SECRET_ID: '',
    SMS_TENCENT_SECRET_KEY: '',
    SMS_TENCENT_SDK_APP_ID: '',
    SMS_TENCENT_SIGN_NAME: '',
    SMS_TENCENT_TEMPLATE_ID: '',
    SMS_TENCENT_REGION: 'ap-guangzhou',
  },
  mockQuery: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  // mock nodemailer transporter 实例，由 createTransport 返回
  mockTransporter: {
    sendMail: vi.fn(),
  },
  // 记录 createTransport 调用参数，便于断言 transporter 配置正确性
  mockCreateTransport: vi.fn(() => mockTransporter),
  // mock 阿里云短信 client 实例，由 Dysmsapi20170525 构造函数返回
  mockSmsClient: {
    sendSms: vi.fn(),
  },
  // 普通函数（非箭头函数）才能用 new 调用，构造函数显式返回 mockSmsClient
  // 设计原因：与 storage-adapter.test.ts 的 OssStorage mock 一致
  mockSmsConstructor: vi.fn(function () {
    return mockSmsClient;
  }),
  // mock SendSmsRequest 构造函数：将 map 字段赋值到 this，便于测试断言请求参数
  mockSendSmsRequest: vi.fn(function (this: Record<string, unknown>, map?: Record<string, unknown>) {
    Object.assign(this, map || {});
  }),
  // mock 腾讯云短信 client 实例，由 Client 构造函数返回
  // 设计原因：腾讯云 client.SendSms 用大写开头（与阿里云 sendSms 小写开头不同），mock 对齐 SDK 实际方法名
  mockTencentSmsClient: {
    SendSms: vi.fn(),
  },
  // 普通函数（非箭头函数）才能用 new 调用，构造函数显式返回 mockTencentSmsClient
  // 设计原因：与阿里云 mockSmsConstructor 模式一致
  mockTencentSmsConstructor: vi.fn(function () {
    return mockTencentSmsClient;
  }),
}));

// mock env 模块：返回可变对象，测试中动态修改字段值
vi.mock('../../config/env', () => ({ env: mockEnv }));

// mock database 模块：query 返回可控，验证分发逻辑是否查库
vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

// mock logger：验证通道的日志输出分支
vi.mock('../../utils/logger', () => ({ logger: mockLogger }));

// mock crypto：dispatchExternalChannels 会调用 decryptPhone 解密手机号密文，
// 测试中透传返回原值即可验证分发逻辑，避免依赖真实 PII_ENCRYPT_KEY
vi.mock('../../utils/crypto', () => ({
  decryptPhone: vi.fn((phone: string) => phone),
}));

// mock nodemailer：避免真实 SMTP 连接，通过 mockTransporter 验证 sendMail 调用
vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

// mock @alicloud/dysmsapi20170525：避免真实阿里云调用，通过 mockSmsClient 验证 sendSms 调用
// default 导出 Client 类（构造函数），命名导出 SendSmsRequest 类
vi.mock('@alicloud/dysmsapi20170525', () => ({
  default: mockSmsConstructor,
  SendSmsRequest: mockSendSmsRequest,
}));

// mock @alicloud/openapi-core：提供 Config 类供 Dysmsapi20170525 构造使用
// Config 必须是可 new 的类，toMap 方法返回空对象（测试不依赖其返回值）
vi.mock('@alicloud/openapi-core', () => {
  class MockConfig {
    constructor(map?: Record<string, unknown>) {
      Object.assign(this, map || {});
    }
    toMap() {
      return {};
    }
  }
  return {
    $OpenApiUtil: { Config: MockConfig },
  };
});

// mock tencentcloud-sdk-nodejs-sms：避免真实腾讯云调用，通过 mockTencentSmsClient 验证 SendSms 调用
// 命名空间结构：sms.v20210111.Client 为构造函数（与阿里云 default 导出 Client 类不同）
vi.mock('tencentcloud-sdk-nodejs-sms', () => ({
  sms: {
    v20210111: {
      Client: mockTencentSmsConstructor,
    },
  },
}));

import {
  emailChannel,
  smsChannel,
  dispatchExternalChannels,
  __setChannelsForTest,
  __resetEmailTransporterForTest,
  __resetSmsClientForTest,
  __resetTencentSmsClientForTest,
  type NotificationChannel,
} from '../notification-channels';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  // 每个测试前重置 env 为默认值（通道关闭、无凭证）
  mockEnv.NOTIFICATION_EMAIL_ENABLED = false;
  mockEnv.NOTIFICATION_SMS_ENABLED = false;
  mockEnv.SMTP_HOST = '';
  mockEnv.SMTP_PORT = 587;
  mockEnv.SMTP_USER = '';
  mockEnv.SMTP_PASS = '';
  mockEnv.SMTP_FROM = '';
  mockEnv.SMS_PROVIDER = '';
  mockEnv.SMS_ACCESS_KEY = '';
  mockEnv.SMS_ACCESS_SECRET = '';
  mockEnv.SMS_SIGN_NAME = '';
  mockEnv.SMS_TEMPLATE_CODE = '';
  // 重置腾讯云凭证为默认值（无凭证），避免上个用例残留
  mockEnv.SMS_TENCENT_SECRET_ID = '';
  mockEnv.SMS_TENCENT_SECRET_KEY = '';
  mockEnv.SMS_TENCENT_SDK_APP_ID = '';
  mockEnv.SMS_TENCENT_SIGN_NAME = '';
  mockEnv.SMS_TENCENT_TEMPLATE_ID = '';
  mockEnv.SMS_TENCENT_REGION = 'ap-guangzhou';
  // 重置 transporter 与短信 client 单例，避免跨用例污染
  __resetEmailTransporterForTest();
  __resetSmsClientForTest();
  __resetTencentSmsClientForTest();
  mockTransporter.sendMail.mockReset();
  mockCreateTransport.mockClear();
  mockSmsClient.sendSms.mockReset();
  mockSmsConstructor.mockClear();
  mockSendSmsRequest.mockClear();
  mockTencentSmsClient.SendSms.mockReset();
  mockTencentSmsConstructor.mockClear();
});

// ==================== dispatchExternalChannels 测试 ====================

describe('dispatchExternalChannels - 外部通道分发', () => {
  it('所有通道未启用时直接返回，不查询数据库', async () => {
    __setChannelsForTest([]);

    await dispatchExternalChannels({
      userId: 'user-1',
      type: 'order_status',
      title: '测试通知',
    });

    // 未启用通道时不应有任何 DB 查询（性能保护）
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('启用通道时查询用户联系信息并分发', async () => {
    const mockChannel: NotificationChannel = {
      name: 'email',
      enabled: true,
      send: vi.fn().mockResolvedValue(undefined),
    };
    __setChannelsForTest([mockChannel]);

    // mock 用户查询返回 email 和 phone
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'test@example.com', phone: '13800000000' }],
    });

    await dispatchExternalChannels({
      userId: 'user-1',
      type: 'order_status',
      title: '订单已完成',
      content: '您的订单已处理',
    });

    // 验证查询了 users 表
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT email, phone FROM users WHERE id = $1',
      ['user-1'],
    );
    // 验证通道收到含联系信息的 payload
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'test@example.com',
        userPhone: '13800000' + '000',
      }),
    );
  });

  it('用户不存在时直接返回，不调用通道', async () => {
    const mockChannel: NotificationChannel = {
      name: 'email',
      enabled: true,
      send: vi.fn(),
    };
    __setChannelsForTest([mockChannel]);

    mockQuery.mockResolvedValueOnce({ rows: [] });

    await dispatchExternalChannels({
      userId: 'nonexistent',
      type: 'system',
      title: '通知',
    });

    expect(mockChannel.send).not.toHaveBeenCalled();
  });

  it('单个通道失败不影响其他通道（allSettled）', async () => {
    const failingChannel: NotificationChannel = {
      name: 'email',
      enabled: true,
      send: vi.fn().mockRejectedValue(new Error('SMTP 连接失败')),
    };
    const successChannel: NotificationChannel = {
      name: 'sms',
      enabled: true,
      send: vi.fn().mockResolvedValue(undefined),
    };
    __setChannelsForTest([failingChannel, successChannel]);

    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'a@b.com', phone: '13800000000' }],
    });

    // 不应抛出异常（allSettled 吞掉单个通道的 rejection）
    await expect(
      dispatchExternalChannels({ userId: 'user-1', type: 'system', title: '通知' }),
    ).resolves.toBeUndefined();

    // 两个通道都被调用
    expect(failingChannel.send).toHaveBeenCalled();
    expect(successChannel.send).toHaveBeenCalled();
  });

  it('多通道并发分发时共享同一次用户查询', async () => {
    const ch1: NotificationChannel = { name: 'email', enabled: true, send: vi.fn().mockResolvedValue(undefined) };
    const ch2: NotificationChannel = { name: 'sms', enabled: true, send: vi.fn().mockResolvedValue(undefined) };
    __setChannelsForTest([ch1, ch2]);

    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'a@b.com', phone: '13800000000' }],
    });

    await dispatchExternalChannels({ userId: 'user-1', type: 'system', title: '通知' });

    // 只查询一次 users 表（避免重复查库）
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ==================== emailChannel.send 测试 ====================

describe('emailChannel.send - 邮件通道', () => {
  it('无 userEmail 时跳过，不输出日志也不调用 sendMail', async () => {
    await emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userEmail: undefined,
    });

    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('有 userEmail 但未配置 SMTP 时走本地 mock 日志', async () => {
    mockEnv.SMTP_HOST = '';

    await emailChannel.send({
      userId: 'user-1',
      type: 'order_status',
      title: '订单已完成',
      userEmail: 'test@example.com',
    });

    // 降级模式：记录本地 mock 日志
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        type: 'order_status',
        title: '订单已完成',
      }),
      expect.stringContaining('本地mock'),
    );
    // 降级模式不应调用 sendMail
    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('配置 SMTP_HOST 时调用 nodemailer 真实发送', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_PORT = 587;
    mockEnv.SMTP_USER = 'user';
    mockEnv.SMTP_PASS = 'pass';
    mockEnv.SMTP_FROM = 'noreply@example.com';
    mockTransporter.sendMail.mockResolvedValue({ messageId: 'msg-1' });

    await emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知标题',
      content: '通知内容',
      userEmail: 'test@example.com',
    });

    // 验证 createTransport 被调用且参数正确（587 端口用 STARTTLS，secure=false）
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
    // 验证 sendMail 被调用且参数正确，from 显式使用 SMTP_FROM
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@example.com',
        to: 'test@example.com',
        subject: '通知标题',
        text: '通知内容',
      }),
    );
    // 真实发送模式不应走 mock 日志
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('SMTP_FROM 未配置时 from 回退到 SMTP_USER（向后兼容）', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_USER = 'fallback@example.com';
    mockEnv.SMTP_PASS = 'pass';
    mockEnv.SMTP_FROM = '';
    mockTransporter.sendMail.mockResolvedValue({});

    await emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userEmail: 'test@example.com',
    });

    // SMTP_FROM 为空时 from 回退到 SMTP_USER，保证向后兼容
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'fallback@example.com',
        to: 'test@example.com',
      }),
    );
  });

  it('465 端口用 SSL 直连（secure=true）', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_PORT = 465;
    mockEnv.SMTP_USER = 'user';
    mockEnv.SMTP_PASS = 'pass';
    mockTransporter.sendMail.mockResolvedValue({});

    await emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userEmail: 'test@example.com',
    });

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
        secure: true,
      }),
    );
  });

  it('SMTP_USER 为空时 auth 为 undefined（支持匿名 SMTP）', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_PORT = 25;
    mockEnv.SMTP_USER = '';
    mockEnv.SMTP_PASS = '';
    mockTransporter.sendMail.mockResolvedValue({});

    await emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userEmail: 'test@example.com',
    });

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: undefined,
      }),
    );
  });

  it('content 为空时 text 回退到 title，避免空邮件正文', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_USER = 'user';
    mockEnv.SMTP_PASS = 'pass';
    mockTransporter.sendMail.mockResolvedValue({});

    await emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '只有标题',
      content: undefined,
      userEmail: 'test@example.com',
    });

    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '只有标题',
        text: '只有标题',
      }),
    );
  });

  it('sendMail 失败时抛错（由 dispatchExternalChannels 的 allSettled 兜底）', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_USER = 'user';
    mockEnv.SMTP_PASS = 'pass';
    mockTransporter.sendMail.mockRejectedValue(new Error('SMTP 连接失败'));

    await expect(
      emailChannel.send({
        userId: 'user-1',
        type: 'system',
        title: '通知',
        userEmail: 'test@example.com',
      }),
    ).rejects.toThrow('SMTP 连接失败');
  });

  it('sendMail 超时时抛出超时错误（SMTP 服务器挂起保护）', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_USER = 'user';
    mockEnv.SMTP_PASS = 'pass';
    // 模拟 sendMail 永不返回（SMTP 服务器挂起）
    mockTransporter.sendMail.mockReturnValue(new Promise(() => {}));

    vi.useFakeTimers();
    const sendPromise = emailChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userEmail: 'test@example.com',
    });
    // 预先附加 catch handler，防止推进定时器期间 sendPromise 被 reject 时
    // 因尚未附加 expect().rejects 处理器而被 Node.js 标记为 unhandled rejection
    sendPromise.catch(() => {});
    // 推进 10 秒触发超时
    await vi.advanceTimersByTimeAsync(10000);
    await expect(sendPromise).rejects.toThrow('超时');
    vi.useRealTimers();
  });

  it('transporter 单例复用：多次 send 只创建一次 createTransport', async () => {
    mockEnv.SMTP_HOST = 'smtp.example.com';
    mockEnv.SMTP_USER = 'user';
    mockEnv.SMTP_PASS = 'pass';
    mockTransporter.sendMail.mockResolvedValue({});

    await emailChannel.send({ userId: 'u1', type: 'system', title: 'A', userEmail: 'a@b.com' });
    await emailChannel.send({ userId: 'u2', type: 'system', title: 'B', userEmail: 'c@d.com' });

    // 单例缓存：createTransport 只调用一次，sendMail 调用两次
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
  });
});

// ==================== smsChannel.send 测试 ====================

describe('smsChannel.send - 短信通道', () => {
  it('无 userPhone 时跳过，不输出日志', async () => {
    await smsChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userPhone: undefined,
    });

    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('有 userPhone 但未配置 SMS_PROVIDER 时走本地 mock 日志', async () => {
    mockEnv.SMS_PROVIDER = '';

    await smsChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userPhone: '13800000000',
    });

    // 降级模式：只记录 userId 与摘要，不打印手机号（PII 保护）
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'system',
      }),
      expect.stringContaining('本地mock'),
    );
    // 日志中不应包含完整手机号
    const infoCall = mockLogger.info.mock.calls[0][0];
    expect(JSON.stringify(infoCall)).not.toContain('13800000000');
  });

  it('SMS_PROVIDER=aliyun 且凭证齐全时调用阿里云 SDK 真实发送', async () => {
    mockEnv.SMS_PROVIDER = 'aliyun';
    mockEnv.SMS_ACCESS_KEY = 'ak';
    mockEnv.SMS_ACCESS_SECRET = 'sk';
    mockEnv.SMS_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TEMPLATE_CODE = 'SMS_123456';
    mockSmsClient.sendSms.mockResolvedValue({ body: { code: 'OK' } });

    await smsChannel.send({
      userId: 'user-1',
      type: 'order_status',
      title: '订单已完成',
      content: '您的订单已处理',
      userPhone: '13800000000',
    });

    // 验证 Dysmsapi20170525 构造函数被调用且 Config 参数正确
    expect(mockSmsConstructor).toHaveBeenCalledTimes(1);
    // 验证 sendSms 被调用，且 SendSmsRequest 参数正确
    expect(mockSendSmsRequest).toHaveBeenCalledTimes(1);
    expect(mockSendSmsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumbers: '13800000000',
        signName: '邻里圈',
        templateCode: 'SMS_123456',
      }),
    );
    expect(mockSmsClient.sendSms).toHaveBeenCalledTimes(1);
    // 真实发送模式不应走 mock 日志或 warn
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('SMS_PROVIDER=aliyun 但凭证不全时输出 warn 提示', async () => {
    mockEnv.SMS_PROVIDER = 'aliyun';
    mockEnv.SMS_ACCESS_KEY = 'ak';
    // 故意不配置 SMS_ACCESS_SECRET/SMS_SIGN_NAME/SMS_TEMPLATE_CODE，触发凭证不全分支

    await smsChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userPhone: '13800000000',
    });

    // 凭证不全应输出 warn，不应调用 sendSms
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'aliyun' }),
      expect.stringContaining('凭证不全'),
    );
    expect(mockSmsClient.sendSms).not.toHaveBeenCalled();
  });

  it('SMS_PROVIDER=tencent 且凭证齐全时调用腾讯云 SDK 真实发送', async () => {
    mockEnv.SMS_PROVIDER = 'tencent';
    mockEnv.SMS_TENCENT_SECRET_ID = 'sid';
    mockEnv.SMS_TENCENT_SECRET_KEY = 'skey';
    mockEnv.SMS_TENCENT_SDK_APP_ID = '1400006666';
    mockEnv.SMS_TENCENT_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TENCENT_TEMPLATE_ID = '100001';
    mockTencentSmsClient.SendSms.mockResolvedValue({ SendStatusSet: [{ Code: 'Ok' }] });

    await smsChannel.send({
      userId: 'user-1',
      type: 'order_status',
      title: '订单已完成',
      content: '您的订单已处理',
      userPhone: '13800000000',
    });

    // 验证腾讯云 Client 构造函数被调用且配置正确（credential/region/endpoint）
    expect(mockTencentSmsConstructor).toHaveBeenCalledTimes(1);
    // 验证 SendSms 被调用，且请求参数正确（PhoneNumberSet 为 E.164 格式 +8613800000000）
    expect(mockTencentSmsClient.SendSms).toHaveBeenCalledTimes(1);
    expect(mockTencentSmsClient.SendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        PhoneNumberSet: ['+8613800000000'],
        SmsSdkAppId: '1400006666',
        SignName: '邻里圈',
        TemplateId: '100001',
        TemplateParamSet: ['订单已完成', '您的订单已处理'],
      }),
    );
    // 真实发送模式不应走 mock 日志或 warn
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    // 不应调用阿里云 sendSms
    expect(mockSmsClient.sendSms).not.toHaveBeenCalled();
  });

  it('SMS_PROVIDER=tencent 但凭证不全时输出 warn 提示', async () => {
    mockEnv.SMS_PROVIDER = 'tencent';
    mockEnv.SMS_TENCENT_SECRET_ID = 'sid';
    // 故意不配置其他凭证，触发凭证不全分支

    await smsChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userPhone: '13800000000',
    });

    // 凭证不全应输出 warn，不应调用 SendSms
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'tencent' }),
      expect.stringContaining('凭证不全'),
    );
    expect(mockTencentSmsClient.SendSms).not.toHaveBeenCalled();
  });

  it('腾讯云 SendSms 失败时抛错（由 dispatchExternalChannels 的 allSettled 兜底）', async () => {
    mockEnv.SMS_PROVIDER = 'tencent';
    mockEnv.SMS_TENCENT_SECRET_ID = 'sid';
    mockEnv.SMS_TENCENT_SECRET_KEY = 'skey';
    mockEnv.SMS_TENCENT_SDK_APP_ID = '1400006666';
    mockEnv.SMS_TENCENT_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TENCENT_TEMPLATE_ID = '100001';
    mockTencentSmsClient.SendSms.mockRejectedValue(new Error('腾讯云调用失败'));

    await expect(
      smsChannel.send({
        userId: 'user-1',
        type: 'system',
        title: '通知',
        userPhone: '13800000000',
      }),
    ).rejects.toThrow('腾讯云调用失败');
  });

  it('腾讯云 SendSms 超时时抛出超时错误（网关挂起保护）', async () => {
    mockEnv.SMS_PROVIDER = 'tencent';
    mockEnv.SMS_TENCENT_SECRET_ID = 'sid';
    mockEnv.SMS_TENCENT_SECRET_KEY = 'skey';
    mockEnv.SMS_TENCENT_SDK_APP_ID = '1400006666';
    mockEnv.SMS_TENCENT_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TENCENT_TEMPLATE_ID = '100001';
    // 模拟 SendSms 永不返回（短信网关挂起）
    mockTencentSmsClient.SendSms.mockReturnValue(new Promise(() => {}));

    vi.useFakeTimers();
    const sendPromise = smsChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userPhone: '13800000000',
    });
    // 预先附加 catch handler，防止推进定时器期间 sendPromise 被 reject 时
    // 因尚未附加 expect().rejects 处理器而被 Node.js 标记为 unhandled rejection
    sendPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10000);
    await expect(sendPromise).rejects.toThrow('超时');
    vi.useRealTimers();
  });

  it('tencentSmsClient 单例复用：多次 send 只创建一次腾讯云 Client 实例', async () => {
    mockEnv.SMS_PROVIDER = 'tencent';
    mockEnv.SMS_TENCENT_SECRET_ID = 'sid';
    mockEnv.SMS_TENCENT_SECRET_KEY = 'skey';
    mockEnv.SMS_TENCENT_SDK_APP_ID = '1400006666';
    mockEnv.SMS_TENCENT_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TENCENT_TEMPLATE_ID = '100001';
    mockTencentSmsClient.SendSms.mockResolvedValue({});

    await smsChannel.send({ userId: 'u1', type: 'system', title: 'A', userPhone: '13800000001' });
    await smsChannel.send({ userId: 'u2', type: 'system', title: 'B', userPhone: '13800000002' });

    // 单例缓存：Client 构造函数只调用一次，SendSms 调用两次
    expect(mockTencentSmsConstructor).toHaveBeenCalledTimes(1);
    expect(mockTencentSmsClient.SendSms).toHaveBeenCalledTimes(2);
  });

  it('sendSms 失败时抛错（由 dispatchExternalChannels 的 allSettled 兜底）', async () => {
    mockEnv.SMS_PROVIDER = 'aliyun';
    mockEnv.SMS_ACCESS_KEY = 'ak';
    mockEnv.SMS_ACCESS_SECRET = 'sk';
    mockEnv.SMS_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TEMPLATE_CODE = 'SMS_123456';
    mockSmsClient.sendSms.mockRejectedValue(new Error('阿里云调用失败'));

    await expect(
      smsChannel.send({
        userId: 'user-1',
        type: 'system',
        title: '通知',
        userPhone: '13800000000',
      }),
    ).rejects.toThrow('阿里云调用失败');
  });

  it('阿里云 sendSms 超时时抛出超时错误（网关挂起保护）', async () => {
    mockEnv.SMS_PROVIDER = 'aliyun';
    mockEnv.SMS_ACCESS_KEY = 'ak';
    mockEnv.SMS_ACCESS_SECRET = 'sk';
    mockEnv.SMS_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TEMPLATE_CODE = 'SMS_123456';
    // 模拟 sendSms 永不返回（短信网关挂起）
    mockSmsClient.sendSms.mockReturnValue(new Promise(() => {}));

    vi.useFakeTimers();
    const sendPromise = smsChannel.send({
      userId: 'user-1',
      type: 'system',
      title: '通知',
      userPhone: '13800000000',
    });
    // 预先附加 catch handler，防止推进定时器期间 sendPromise 被 reject 时
    // 因尚未附加 expect().rejects 处理器而被 Node.js 标记为 unhandled rejection
    sendPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10000);
    await expect(sendPromise).rejects.toThrow('超时');
    vi.useRealTimers();
  });

  it('smsClient 单例复用：多次 send 只创建一次 Dysmsapi20170525 实例', async () => {
    mockEnv.SMS_PROVIDER = 'aliyun';
    mockEnv.SMS_ACCESS_KEY = 'ak';
    mockEnv.SMS_ACCESS_SECRET = 'sk';
    mockEnv.SMS_SIGN_NAME = '邻里圈';
    mockEnv.SMS_TEMPLATE_CODE = 'SMS_123456';
    mockSmsClient.sendSms.mockResolvedValue({});

    await smsChannel.send({ userId: 'u1', type: 'system', title: 'A', userPhone: '13800000001' });
    await smsChannel.send({ userId: 'u2', type: 'system', title: 'B', userPhone: '13800000002' });

    // 单例缓存：Dysmsapi20170525 构造函数只调用一次，sendSms 调用两次
    expect(mockSmsConstructor).toHaveBeenCalledTimes(1);
    expect(mockSmsClient.sendSms).toHaveBeenCalledTimes(2);
  });
});

export {};
