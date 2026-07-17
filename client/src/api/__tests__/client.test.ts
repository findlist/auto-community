import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import client, { ApiError } from '../client';

// mock window.location，以便断言 401 时的跳转行为
const mockAssign = vi.fn();
Object.defineProperty(window, 'location', {
  value: {
    href: '',
    assign: mockAssign,
    reload: vi.fn(),
  },
  writable: true,
});

describe('api client', () => {
  beforeEach(() => {
    // 每个用例前清空 localStorage 和 mock 调用记录
    localStorage.clear();
    mockAssign.mockClear();
  });

  describe('基础配置', () => {
    it('baseURL 应配置为 /api', () => {
      expect(client.defaults.baseURL).toBe('/api');
    });

    it('timeout 应配置为 10000ms', () => {
      expect(client.defaults.timeout).toBe(10000);
    });
  });

  describe('请求拦截器', () => {
    it('当 localStorage 存在 token 时，应正确注入 Authorization header', async () => {
      const token = 'my-secret-token';
      localStorage.setItem('token', token);

      // 使用适配器直接拿到拦截器处理后的 config，避免发起真实请求
      const config = await client.interceptors.request.handlers![0]!.fulfilled!({
        url: '/test',
        method: 'get',
        headers: new AxiosHeaders(),
      });

      expect(config.headers.Authorization).toBe(`Bearer ${token}`);
    });

    it('当 localStorage 无 token 时，不应设置 Authorization header', async () => {
      const config = await client.interceptors.request.handlers![0]!.fulfilled!({
        url: '/test',
        method: 'get',
        headers: new AxiosHeaders(),
      });

      expect(config.headers.Authorization).toBeUndefined();
    });
  });

  describe('响应拦截器 - 401 处理', () => {
    it('收到 401 响应时，应清除 token 并跳转到 /login', async () => {
      localStorage.setItem('token', 'expired-token');
      localStorage.setItem('auth-storage', 'some-data');

      const error = {
        response: {
          status: 401,
          data: { message: '登录已过期' },
        },
      };

      // 捕获 reject，避免未处理的 Promise 拒绝
      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toThrow('登录已过期');

      // 验证 token 和 auth-storage 都被清除
      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('auth-storage')).toBeNull();
      // 验证跳转到登录页
      expect(window.location.href).toBe('/login');
    });

    it('401 响应应抛出 ApiError 且 code 为 401', async () => {
      const error = {
        response: {
          status: 401,
          data: { message: '未授权' },
        },
      };

      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toMatchObject({
        name: 'ApiError',
        code: 401,
        message: '未授权',
      });
    });

    it('当 401 响应无 message 时，应使用默认提示文案', async () => {
      const error = {
        response: {
          status: 401,
          data: {},
        },
      };

      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toThrow('登录已过期，请重新登录');
    });
  });

  describe('响应拦截器 - 其他错误', () => {
    it('非 401 错误应抛出 ApiError 并携带状态码', async () => {
      const error = {
        response: {
          status: 500,
          data: { message: '服务器内部错误' },
        },
      };

      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toMatchObject({
        name: 'ApiError',
        code: 500,
        message: '服务器内部错误',
      });
    });

    it('无 response 的错误应使用 500 作为默认状态码', async () => {
      const error = new Error('Network Error');

      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toMatchObject({
        name: 'ApiError',
        code: 500,
      });
    });

    it('422 验证错误应正确提取字段级错误', async () => {
      const error = {
        response: {
          status: 422,
          data: {
            message: '参数校验失败',
            errors: [
              { field: 'phone', message: '手机号格式不正确' },
              { field: 'password', message: '密码长度不足' },
            ],
          },
        },
      };

      try {
        await client.interceptors.response.handlers![0]!.rejected!(error);
        // 如果没有抛出，测试应失败
        expect.unreachable('应该抛出 ApiError');
      } catch (e) {
        const apiError = e as ApiError;
        expect(apiError.code).toBe(422);
        expect(apiError.fieldErrors).toEqual([
          { field: 'phone', message: '手机号格式不正确' },
          { field: 'password', message: '密码长度不足' },
        ]);
      }
    });
  });

  describe('字段命名转换拦截器', () => {
    it('请求拦截器应将 data 的 camelCase 键转为 snake_case', async () => {
      const config = await client.interceptors.request.handlers![0]!.fulfilled!({
        url: '/test',
        method: 'post',
        headers: new AxiosHeaders(),
        data: { durationMinutes: 30, toUserId: 'u1' },
      });
      expect(config.data).toEqual({ duration_minutes: 30, to_user_id: 'u1' });
    });

    it('请求拦截器应递归转换嵌套 data 的键名', async () => {
      const config = await client.interceptors.request.handlers![0]!.fulfilled!({
        url: '/test',
        method: 'post',
        headers: new AxiosHeaders(),
        data: { service: { parentPhone: '13800138000' }, images: ['a.jpg'] },
      });
      expect(config.data).toEqual({
        service: { parent_phone: '13800138000' },
        images: ['a.jpg'],
      });
    });

    it('请求拦截器无 data 时不应报错', async () => {
      const config = await client.interceptors.request.handlers![0]!.fulfilled!({
        url: '/test',
        method: 'get',
        headers: new AxiosHeaders(),
      });
      expect(config.data).toBeUndefined();
    });

    it('请求拦截器应原样保留 FormData（不转换二进制表单）', async () => {
      const formData = new FormData();
      formData.append('userName', 'test');
      const config = await client.interceptors.request.handlers![0]!.fulfilled!({
        url: '/test',
        method: 'post',
        headers: new AxiosHeaders(),
        data: formData,
      });
      // FormData 是类实例，isPlainObject 返回 false，原样返回避免破坏表单语义
      expect(config.data).toBe(formData);
    });

    it('响应拦截器应将 response.data 的 snake_case 键转为 camelCase', async () => {
      const result = await client.interceptors.response.handlers![0]!.fulfilled!({
        data: { service_id: 's1', duration_minutes: 60, created_at: '2026-01-01' },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config: { url: '/test', headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      });
      expect(result).toEqual({
        serviceId: 's1',
        durationMinutes: 60,
        createdAt: '2026-01-01',
      });
    });

    it('响应拦截器应递归转换嵌套响应数据', async () => {
      const result = await client.interceptors.response.handlers![0]!.fulfilled!({
        data: {
          code: 0,
          data: {
            user_id: 'u1',
            nickname: '张三',
            orders: [{ order_id: 'o1', total_amount: 100 }],
          },
        },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config: { url: '/test', headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      });
      expect(result).toEqual({
        code: 0,
        data: {
          userId: 'u1',
          nickname: '张三',
          orders: [{ orderId: 'o1', totalAmount: 100 }],
        },
      });
    });

    it('响应拦截器应原样返回 Blob 响应（CSV 导出场景）', async () => {
      const blob = new Blob(['csv,data\n1,2'], { type: 'text/csv' });
      const result = await client.interceptors.response.handlers![0]!.fulfilled!({
        data: blob,
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config: { url: '/test', headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      });
      // Blob 是类实例，不转换，原样返回避免破坏二进制数据
      expect(result).toBe(blob);
    });

    it('响应拦截器对已是 camelCase 的响应应幂等不变', async () => {
      const result = await client.interceptors.response.handlers![0]!.fulfilled!({
        data: { durationMinutes: 30, createdAt: '2026-01-01' },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config: { url: '/test', headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      });
      expect(result).toEqual({ durationMinutes: 30, createdAt: '2026-01-01' });
    });
  });

  describe('响应拦截器 - GET 请求重试', () => {
    // 重试逻辑测试：验证 5xx/网络错误下 GET 请求自动重试，非 GET 不重试
    // 设计原因：重试通过 client.request(config) 递归调用，mock 其返回值避免真实网络请求
    const retryConfig = {
      url: '/test',
      method: 'get',
      headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig;

    afterEach(() => {
      // 恢复 client.request 的 mock，避免影响后续测试
      vi.restoreAllMocks();
    });

    it('GET 请求遇 5xx 应触发重试（调用 client.request）', async () => {
      const error = {
        config: retryConfig,
        response: { status: 503, data: { message: '服务不可用' } },
      };

      // mock client.request 返回成功响应，模拟重试后成功
      const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true });

      await client.interceptors.response.handlers![0]!.rejected!(error);

      expect(requestSpy).toHaveBeenCalledTimes(1);
      // 重试时 _retryCount 应递增为 1
      expect(retryConfig._retryCount).toBe(1);
    });

    it('GET 请求遇网络错误（无 response）应触发重试', async () => {
      const config = { ...retryConfig, _retryCount: undefined } as InternalAxiosRequestConfig;
      const error = { config, message: 'Network Error' };

      const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true });

      await client.interceptors.response.handlers![0]!.rejected!(error);

      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('POST 请求遇 5xx 不应触发重试', async () => {
      const postConfig = {
        url: '/test',
        method: 'post',
        headers: new AxiosHeaders(),
      } as InternalAxiosRequestConfig;
      const error = {
        config: postConfig,
        response: { status: 500, data: { message: '服务器错误' } },
      };

      const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true });

      // POST 不重试，应直接 reject 为 ApiError
      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toMatchObject({ name: 'ApiError', code: 500 });

      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('GET 请求遇 4xx 不应触发重试', async () => {
      const error = {
        config: retryConfig,
        response: { status: 404, data: { message: '资源不存在' } },
      };

      const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true });

      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toMatchObject({ name: 'ApiError', code: 404 });

      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('重试次数达上限后不再重试，直接抛出 ApiError', async () => {
      // _retryCount 已达 MAX_RETRY(2)，不再重试
      const config = { ...retryConfig, _retryCount: 2 } as InternalAxiosRequestConfig;
      const error = {
        config,
        response: { status: 500, data: { message: '服务器错误' } },
      };

      const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({ ok: true });

      await expect(
        client.interceptors.response.handlers![0]!.rejected!(error)
      ).rejects.toMatchObject({ name: 'ApiError', code: 500 });

      expect(requestSpy).not.toHaveBeenCalled();
    });
  });
});
