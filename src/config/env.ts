import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

function readInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readInt('PORT', 8080),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  databaseHost: process.env.DB_HOST ?? 'mysql',
  databasePort: readInt('DB_PORT', 3306),
  databaseUser: process.env.DB_USER ?? 'rigways',
  databasePassword: process.env.DB_PASSWORD ?? 'rigways_password',
  databaseName: process.env.DB_NAME ?? 'rigways',
  uploadsDir: process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads'),
  maxUploadSizeMb: readInt('MAX_UPLOAD_SIZE_MB', 8),
  pushSubject: process.env.PUSH_SUBJECT ?? 'mailto:admin@rigways.local',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
};
