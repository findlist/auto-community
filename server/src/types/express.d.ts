declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        phone: string;
        nickname: string;
        iat?: number;
        exp?: number;
      };
    }
  }
}

export {};
