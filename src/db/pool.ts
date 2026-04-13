import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const pool = mysql.createPool({
  host: env.databaseHost,
  port: env.databasePort,
  user: env.databaseUser,
  password: env.databasePassword,
  database: env.databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});