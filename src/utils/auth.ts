import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RowDataPacket } from 'mysql2';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

export type SessionPayload = {
  sub: number;
  username: string;
  name: string;
  role: string;
  customer_id: string | null;
};

export async function verifyUser(username: string, password: string) {
  const [rows] = await pool.query<
    Array<
      RowDataPacket & {
        id: number;
        username: string;
        name: string;
        role: string;
        customer_id: string | null;
        password_hash: string;
        is_active: number;
      }
    >
  >(
    `
      SELECT id, username, name, role, customer_id, password_hash, is_active
      FROM users
      WHERE username = ?
      LIMIT 1
    `,
    [username],
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    customer_id: user.customer_id,
  };
}

export function signSession(user: {
  id: number;
  username: string;
  name: string;
  role: string;
  customer_id: string | null;
}) {
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    customer_id: user.customer_id,
  };

  return jwt.sign(payload, env.jwtSecret, { expiresIn: '12h' });
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.jwtSecret) as unknown as SessionPayload;
}