import type { NextFunction, Request, Response } from 'express';
import { fail } from '../utils/http.js';
import { verifyToken } from '../utils/auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: number;
        username: string;
        name: string;
        role: string;
        customer_id: string | null;
      };
    }
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return fail(response, 401, 'Unauthorized');
  }

  try {
    request.user = verifyToken(header.slice(7));
    return next();
  } catch {
    return fail(response, 401, 'Unauthorized');
  }
}