import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { query } from '../config/database';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { tokenBlacklist } from '../utils/tokenBlacklist';

// JWT Payload接口
// 安全考虑：JWT 中不再携带 phone，避免 token 泄露后暴露 PII
// 仅保留 id 与 nickname，phone 在需要时通过数据库查询并解密获取
interface JwtPayload {
  id: string;
  nickname: string;
  iat?: number;
  exp?: number;
}

// 扩展Request类型
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// 认证中间件
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      throw new UnauthorizedError('未提供认证令牌');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('认证令牌格式错误');
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      throw new UnauthorizedError('认证令牌为空');
    }

    // 显式锁定算法为 HS256：依赖库默认值虽已阻 alg:none，但显式声明可在升级库或改用非对称密钥时
    // 第一时间暴露 alg 混淆攻击面，是安全基线的纵深防御
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    // 校验 token 是否已在黑名单中（用户已登出）
    // Redis 实现为异步操作，需要 await
    if (await tokenBlacklist.isBlacklisted(token)) {
      throw new UnauthorizedError('认证令牌已失效');
    }

    // 安全权衡：每次请求查询数据库以校验用户状态，
    // 确保被禁用或删除的用户立即失去访问权限，代价是增加一次 DB 查询
    const userResult = await query(
      'SELECT deleted_at, status FROM users WHERE id = $1',
      [decoded.id]
    );
    const userRow = userResult.rows[0];
    if (!userRow || userRow.deleted_at !== null || userRow.status !== 'active') {
      throw new UnauthorizedError('用户账号已被禁用或删除');
    }

    req.user = decoded;
    
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('无效的认证令牌'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('认证令牌已过期'));
    } else {
      next(error);
    }
  }
}

// 可选认证中间件（不强制要求登录）
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token) {
        // 显式锁定算法为 HS256，与 authenticate 保持一致的安全契约
        const decoded = jwt.verify(token, env.JWT_SECRET, {
          algorithms: ['HS256'],
        }) as JwtPayload;
        req.user = decoded;
      }
    }
    
    next();
  } catch (error) {
    // 可选认证，忽略错误继续执行
    next();
  }
}

// 角色检查中间件（需要先使用authenticate）
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new UnauthorizedError('未登录'));
    }

    try {
      // 从数据库实时查询用户角色，避免使用 JWT 中可能过时的角色信息
      const result = await query(
        'SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL',
        [req.user.id]
      );
      if (result.rows.length === 0) {
        return next(new UnauthorizedError('用户不存在'));
      }
      const userRole = result.rows[0].role;
      if (!roles.includes(userRole)) {
        return next(new ForbiddenError('权限不足'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

// 生成访问令牌
// expiresIn 用 unknown 双重断言：@types/jsonwebtoken 的 SignOptions.expiresIn 是 number | StringValue（字面量联合），
// env.JWT_EXPIRES_IN 是 string，需双重断言绕过字面量检查，比 as any 更精确表达意图
export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] });
}

// 生成刷新令牌
export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] });
}

// 验证刷新令牌
export function verifyRefreshToken(token: string): JwtPayload {
  // 显式锁定算法为 HS256，与 authenticate 保持一致的安全契约
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
  }) as JwtPayload;
}
