import type { Response } from 'express';

export function ok(response: Response, data: unknown, status = 200) {
  return response.status(status).json({ success: true, data });
}

export function fail(response: Response, status: number, error: string) {
  return response.status(status).json({ success: false, error });
}