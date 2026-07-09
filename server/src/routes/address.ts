import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { success } from '../utils/response';
import { addressService } from '../services/address.service';

const router = Router();

// 地址请求体类型定义
// 设计原因：与 address.service 的 create/update 入参类型对齐，编译期校验 req.body 字段
interface CreateAddressBody {
  recipient: string;
  phone: string;
  address: string;
  isDefault?: boolean;
}

interface UpdateAddressBody {
  recipient?: string;
  phone?: string;
  address?: string;
  isDefault?: boolean;
}

// 所有接口需登录
router.use(authenticate);

// 获取地址列表
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const list = await addressService.listByUser(req.user!.id);
  success(res, list);
}));

// 创建地址
router.post('/', validate([
  body('recipient').isString().isLength({ min: 1, max: 32 }).withMessage('收件人姓名必填'),
  body('phone').matches(/^1[3-9]\d{9}$/).withMessage('手机号格式不正确'),
  body('address').isString().isLength({ min: 1 }).withMessage('详细地址必填'),
  body('isDefault').optional().isBoolean(),
]), asyncHandler(async (req: Request<Record<string, string>, any, CreateAddressBody>, res: Response) => {
  const result = await addressService.create(req.user!.id, req.body);
  success(res, result, '地址已添加');
}));

// 更新地址
router.put('/:id', validate([
  body('recipient').optional().isString().isLength({ min: 1, max: 32 }),
  body('phone').optional().matches(/^1[3-9]\d{9}$/),
  body('address').optional().isString().isLength({ min: 1 }),
  body('isDefault').optional().isBoolean(),
]), asyncHandler(async (req: Request<Record<string, string>, any, UpdateAddressBody>, res: Response) => {
  const result = await addressService.update(req.params.id, req.user!.id, req.body);
  success(res, result, '地址已更新');
}));

// 删除地址
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await addressService.remove(req.params.id, req.user!.id);
  success(res, null, '地址已删除');
}));

// 设为默认地址
router.put('/:id/default', asyncHandler(async (req: Request, res: Response) => {
  await addressService.setDefault(req.params.id, req.user!.id);
  success(res, null, '已设为默认地址');
}));

export default router;
