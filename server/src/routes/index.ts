import { Router } from 'express';
import authRoutes from './auth';
import userRoutes from './users';
import skillRoutes from './skills';
import kitchenRoutes from './kitchen';
import timeBankRoutes from './time-bank';
import emergencyRoutes from './emergency';
import messageRoutes from './messages';
import notificationRoutes from './notifications';
import adminRoutes from './admin';
import reportRoutes from './reports';
import uploadRoutes from './upload';
import addressRoutes from './address';
import aiRoutes from './ai';
import abTestRoutes from './ab-test';
import metricsRoutes from './metrics';
import publicRoutes from './public';
import { SUCCESS_CODE } from '../utils/errorCodes';

const router = Router();

// 注册子路由
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/skills', skillRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/time-bank', timeBankRoutes);
router.use('/emergency', emergencyRoutes);
router.use('/messages', messageRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);
router.use('/reports', reportRoutes);
router.use('/upload', uploadRoutes);
router.use('/addresses', addressRoutes);
router.use('/ai', aiRoutes);
router.use('/metrics', metricsRoutes);
router.use('/ab-tests', abTestRoutes);
router.use('/public', publicRoutes);

// API版本信息
router.get('/', (req, res) => {
  res.json({
    code: SUCCESS_CODE,
    message: '邻里圈API v1.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      skills: '/api/skills',
      kitchen: '/api/kitchen',
      timeBank: '/api/time-bank',
      emergency: '/api/emergency',
      messages: '/api/messages',
      notifications: '/api/notifications',
      admin: '/api/admin',
      reports: '/api/reports',
      upload: '/api/upload',
      ai: '/api/ai',
      abTests: '/api/ab-tests'
    }
  });
});

export default router;
