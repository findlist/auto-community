/**
 * api/address 地址簿 API 层单元测试
 *
 * 测试目标：覆盖 5 个导出函数（getAddresses/createAddress/updateAddress/deleteAddress/
 *           setDefaultAddress）
 *           验证 HTTP 方法、URL 路径、body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post/put/delete，断言调用参数与返回值
 *
 * 设计原因：address API 涉及默认地址设置（影响下单时收货地址选择），
 * URL 错误会导致误删地址或默认地址错乱，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse } from '@/types';
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  type Address,
  type CreateAddressParams,
  type UpdateAddressParams,
} from '../address';

// mock client 模块，覆盖 get/post/put/delete 4 种方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条地址
const mockAddress: Address = {
  id: 'addr-uuid-001',
  userId: 'user-uuid-001',
  recipient: '张三',
  phone: '13800138000',
  address: '北京市朝阳区某小区',
  isDefault: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('api/address - 地址簿 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAddresses - 获取地址列表', () => {
    it('应使用 GET /addresses 返回数组（非分页）', async () => {
      // 设计原因：getAddresses 返回当前用户全部地址（不分页），后端按 JWT 取 userId 过滤
      const mockRes: ApiResponse<Address[]> = { code: 0, message: 'ok', data: [mockAddress] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getAddresses();

      expect(client.get).toHaveBeenCalledWith('/addresses');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.recipient).toBe('张三');
    });

    it('无地址时应返回空数组', async () => {
      const mockRes: ApiResponse<Address[]> = { code: 0, message: 'ok', data: [] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getAddresses();

      expect(result.data).toHaveLength(0);
    });
  });

  describe('createAddress - 创建地址', () => {
    it('应使用 POST /addresses 且透传 body', async () => {
      const params: CreateAddressParams = {
        recipient: '李四', phone: '13900139000', address: '上海市浦东新区', isDefault: false,
      };
      const mockRes: ApiResponse<Address> = { code: 0, message: '创建成功', data: { ...mockAddress, ...params, id: 'addr-uuid-002' } };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createAddress(params);

      expect(client.post).toHaveBeenCalledWith('/addresses', params);
      expect(result.data.id).toBe('addr-uuid-002');
    });

    it('isDefault 省略时应传 undefined（后端默认 false）', async () => {
      const params: CreateAddressParams = {
        recipient: '王五', phone: '13700137000', address: '广州市天河区',
      };
      const mockRes: ApiResponse<Address> = { code: 0, message: 'ok', data: { ...mockAddress, ...params, isDefault: false, id: 'addr-uuid-003' } };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await createAddress(params);

      const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(body.isDefault).toBeUndefined();
    });
  });

  describe('updateAddress - 更新地址', () => {
    it('应使用 PUT /addresses/:id 且透传 body（部分字段）', async () => {
      // 设计原因：updateAddress 是 PATCH 语义但用 PUT，body 仅传更新字段（非全量）
      const params: UpdateAddressParams = { recipient: '张三（更新）' };
      const mockRes: ApiResponse<Address> = { code: 0, message: 'ok', data: { ...mockAddress, recipient: '张三（更新）' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await updateAddress('addr-uuid-001', params);

      expect(client.put).toHaveBeenCalledWith('/addresses/addr-uuid-001', params);
      expect(result.data.recipient).toBe('张三（更新）');
    });
  });

  describe('deleteAddress - 删除地址', () => {
    it('应使用 DELETE /addresses/:id', async () => {
      // 设计原因：deleteAddress 是软删除，后端将记录标记为 deleted，避免外键约束失败
      const mockRes: ApiResponse<null> = { code: 0, message: '已删除', data: null };
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await deleteAddress('addr-uuid-001');

      expect(client.delete).toHaveBeenCalledWith('/addresses/addr-uuid-001');
      expect(result.data).toBeNull();
    });
  });

  describe('setDefaultAddress - 设为默认地址', () => {
    it('应使用 PUT /addresses/:id/default 且无 body', async () => {
      // 设计原因：setDefaultAddress 是状态切换操作，后端会自动取消其他地址的默认标记，
      // 保证唯一默认地址（事务内完成）
      const mockRes: ApiResponse<null> = { code: 0, message: '已设为默认', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await setDefaultAddress('addr-uuid-001');

      expect(client.put).toHaveBeenCalledWith('/addresses/addr-uuid-001/default');
      expect(result.data).toBeNull();
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 4 种方法各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: [mockAddress] });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockAddress });
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockAddress });
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });

      await getAddresses();
      await createAddress({ recipient: 'a', phone: '1', address: 'b' });
      await updateAddress('a1', { recipient: 'c' });
      await deleteAddress('a1');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledTimes(1);
    });
  });
});
