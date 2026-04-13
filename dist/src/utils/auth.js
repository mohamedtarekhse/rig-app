import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
export async function verifyUser(username, password) {
    const [rows] = await pool.query(`
      SELECT id, username, name, role, customer_id, password_hash, is_active
      FROM users
      WHERE username = ?
      LIMIT 1
    `, [username]);
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
export function signSession(user) {
    const payload = {
        sub: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        customer_id: user.customer_id,
    };
    return jwt.sign(payload, env.jwtSecret, { expiresIn: '12h' });
}
export function verifyToken(token) {
    return jwt.verify(token, env.jwtSecret);
}
