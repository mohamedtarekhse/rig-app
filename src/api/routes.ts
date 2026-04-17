import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { signSession, verifyUser } from '../utils/auth.js';
import { sendPush, getPushPublicKey } from '../utils/push.js';
import { fail, ok } from '../utils/http.js';

type CountRow = RowDataPacket & { count: number };
type UserRow = RowDataPacket & { id: number };
type PushSubscriptionRow = RowDataPacket & { id: number; endpoint: string; subscription_json: string };
type CertificateFileRow = RowDataPacket & { file_path: string | null };

type ResourceConfig = {
  table: string;
  searchColumns: string[];
  listColumns: string[];
  writableColumns: string[];
  defaultOrder?: string;
  normalize?: (body: Record<string, unknown>) => Record<string, unknown>;
};

const resourceConfigs: Record<string, ResourceConfig> = {
  clients: {
    table: 'clients',
    searchColumns: ['client_id', 'name', 'industry', 'city'],
    listColumns: ['id', 'client_id', 'name', 'industry', 'contact', 'email', 'country', 'city', 'status', 'created_at'],
    writableColumns: ['client_id', 'name', 'industry', 'contact', 'email', 'phone', 'country', 'city', 'status'],
    defaultOrder: 'name ASC',
  },
  inspectors: {
    table: 'inspectors',
    searchColumns: ['inspector_number', 'name', 'title', 'email'],
    listColumns: ['id', 'inspector_number', 'name', 'title', 'email', 'phone', 'status', 'experience_years', 'created_at'],
    writableColumns: ['inspector_number', 'name', 'title', 'email', 'phone', 'status', 'experience_years'],
    defaultOrder: 'created_at DESC',
  },
  'functional-locations': {
    table: 'functional_locations',
    searchColumns: ['fl_id', 'name', 'type', 'client_id'],
    listColumns: ['id', 'fl_id', 'name', 'type', 'client_id', 'status', 'notes', 'created_at'],
    writableColumns: ['fl_id', 'name', 'type', 'client_id', 'status', 'notes'],
    defaultOrder: 'created_at DESC',
  },
  assets: {
    table: 'assets',
    searchColumns: ['asset_number', 'name', 'asset_type', 'client_id', 'functional_location'],
    listColumns: ['id', 'asset_number', 'name', 'asset_type', 'status', 'client_id', 'functional_location', 'serial_number', 'manufacturer', 'notes', 'created_at'],
    writableColumns: ['asset_number', 'name', 'asset_type', 'status', 'client_id', 'functional_location', 'serial_number', 'manufacturer', 'model', 'description', 'notes'],
    defaultOrder: 'created_at DESC',
  },
  certificates: {
    table: 'certificates',
    searchColumns: ['cert_number', 'name', 'cert_type', 'client_id', 'issued_by', 'approval_status', 'file_name'],
    listColumns: ['id', 'cert_number', 'name', 'cert_type', 'asset_id', 'client_id', 'issued_by', 'issue_date', 'expiry_date', 'approval_status', 'notes', 'file_name', 'file_url', 'file_size', 'mime_type', 'uploaded_at', 'created_at'],
    writableColumns: ['cert_number', 'name', 'cert_type', 'asset_id', 'client_id', 'issued_by', 'issue_date', 'expiry_date', 'approval_status', 'notes'],
    defaultOrder: 'created_at DESC',
  },
  jobs: {
    table: 'jobs',
    searchColumns: ['job_number', 'title', 'client_id', 'functional_location', 'status'],
    listColumns: ['id', 'job_number', 'client_id', 'functional_location', 'title', 'status', 'notes', 'created_at'],
    writableColumns: ['job_number', 'client_id', 'functional_location', 'title', 'status', 'notes'],
    defaultOrder: 'created_at DESC',
  },
  notifications: {
    table: 'notifications',
    searchColumns: ['type', 'title', 'body'],
    listColumns: ['id', 'user_id', 'type', 'title', 'body', 'is_read', 'created_at'],
    writableColumns: ['type', 'title', 'body', 'is_read'],
    defaultOrder: 'created_at DESC',
    normalize: (body) => ({
      ...body,
      is_read: body.is_read === '1' || body.is_read === 1 || body.is_read === true ? 1 : 0,
    }),
  },
};

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'certificate-file';
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

async function getActiveUserIds() {
  const [rows] = await pool.query<UserRow[]>('SELECT id FROM users WHERE is_active = 1');
  return rows.map((row) => row.id);
}

async function insertNotifications(userIds: number[], type: string, title: string, body: string) {
  if (!userIds.length) return;
  const placeholders = userIds.map(() => '(?, ?, ?, ?, 0)').join(', ');
  const values = userIds.flatMap((userId) => [userId, type, title, body]);
  await pool.query<ResultSetHeader>(
    `INSERT INTO notifications (user_id, type, title, body, is_read) VALUES ${placeholders}`,
    values,
  );
}

async function pushToUsers(userIds: number[], payload: Record<string, unknown>) {
  if (!userIds.length) return;

  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query<PushSubscriptionRow[]>(
    `SELECT id, endpoint, subscription_json FROM push_subscriptions WHERE user_id IN (${placeholders})`,
    userIds,
  );

  for (const row of rows) {
    try {
      await sendPush(JSON.parse(row.subscription_json), payload);
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await pool.query<ResultSetHeader>('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
      } else {
        console.error(`Push delivery failed for subscription ${row.id}`, error);
      }
    }
  }
}

async function notifyUsers(type: string, title: string, body: string, userIds?: number[]) {
  const targetUserIds = userIds ?? await getActiveUserIds();
  await insertNotifications(targetUserIds, type, title, body);
  await pushToUsers(targetUserIds, {
    type,
    title,
    body,
    tag: type,
    url: '/notifications',
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadSizeMb * 1024 * 1024 },
});

function resourceRouter(resource: string, config: ResourceConfig) {
  const router = Router();

  router.get('/', requireAuth, async (request, response) => {
    const query = String(request.query.q ?? '').trim();
    const columns = config.listColumns.join(', ');
    const order = config.defaultOrder ?? 'id DESC';

    if (resource === 'notifications') {
      const params: unknown[] = [request.user?.sub ?? 0];
      let sql = `SELECT ${columns} FROM ${config.table} WHERE user_id = ?`;

      if (query) {
        const where = config.searchColumns.map((column) => `${column} LIKE ?`).join(' OR ');
        sql += ` AND (${where})`;
        params.push(...config.searchColumns.map(() => `%${query}%`));
      }

      sql += ` ORDER BY ${order} LIMIT 100`;
      const [rows] = await pool.query<RowDataPacket[]>(sql, params);
      return ok(response, rows);
    }

    if (!query) {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${columns} FROM ${config.table} ORDER BY ${order} LIMIT 100`);
      return ok(response, rows);
    }

    const where = config.searchColumns.map((column) => `${column} LIKE ?`).join(' OR ');
    const params = config.searchColumns.map(() => `%${query}%`);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${columns} FROM ${config.table} WHERE ${where} ORDER BY ${order} LIMIT 100`,
      params,
    );

    return ok(response, rows);
  });

  router.post('/', requireAuth, async (request, response) => {
    const body = config.normalize ? config.normalize(request.body) : request.body;
    const payload = Object.fromEntries(
      config.writableColumns
        .filter((column) => body[column] !== undefined && body[column] !== '')
        .map((column) => [column, body[column]]),
    ) as Record<string, unknown>;

    if (Object.keys(payload).length === 0) {
      return fail(response, 400, 'No data provided.');
    }

    if (resource === 'notifications') {
      payload.user_id = request.user?.sub;
    }

    const columns = Object.keys(payload);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((column) => payload[column]);

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${config.listColumns.join(', ')} FROM ${config.table} WHERE id = ? LIMIT 1`,
      [result.insertId],
    );

    if (resource === 'certificates') {
      const created = rows[0];
      await notifyUsers(
        'certificate-created',
        `Certificate ${String(created?.cert_number ?? result.insertId)} created`,
        `${String(created?.name ?? 'A certificate')} is now in the system with status ${String(created?.approval_status ?? 'pending')}.`,
      );
    }

    return ok(response, rows[0], 201);
  });

  router.put('/:id', requireAuth, async (request, response) => {
    const body = config.normalize ? config.normalize(request.body) : request.body;
    const payload = Object.fromEntries(
      config.writableColumns
        .filter((column) => body[column] !== undefined && body[column] !== '')
        .map((column) => [column, body[column]]),
    ) as Record<string, unknown>;

    if (Object.keys(payload).length === 0) {
      return fail(response, 400, 'No data provided.');
    }

    const fields = Object.keys(payload).map((column) => `${column} = ?`);
    const values = [...Object.values(payload), request.params.id];
    await pool.query<ResultSetHeader>(`UPDATE ${config.table} SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${config.listColumns.join(', ')} FROM ${config.table} WHERE id = ? LIMIT 1`,
      [request.params.id],
    );

    if (resource === 'certificates') {
      const updated = rows[0];
      await notifyUsers(
        'certificate-updated',
        `Certificate ${String(updated?.cert_number ?? request.params.id)} updated`,
        `${String(updated?.name ?? 'Certificate')} is now ${String(updated?.approval_status ?? 'updated')}.`,
      );
    }

    return ok(response, rows[0]);
  });

  router.delete('/:id', requireAuth, async (request, response) => {
    if (resource === 'notifications') {
      await pool.query<ResultSetHeader>('DELETE FROM notifications WHERE id = ? AND user_id = ?', [request.params.id, request.user?.sub ?? 0]);
      return ok(response, { deleted: true });
    }

    await pool.query<ResultSetHeader>(`DELETE FROM ${config.table} WHERE id = ?`, [request.params.id]);
    return ok(response, { deleted: true });
  });

  return router;
}

export const apiRouter = Router();

apiRouter.get('/health', (_request, response) => {
  return ok(response, { healthy: true });
});

apiRouter.post('/auth/login', async (request, response) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return fail(response, 400, 'Username and password are required.');
  }

  const user = await verifyUser(parsed.data.username, parsed.data.password);
  if (!user) {
    return fail(response, 401, 'Invalid username or password.');
  }

  const token = signSession(user);
  return ok(response, { token, user });
});

apiRouter.get('/auth/me', requireAuth, (request, response) => {
  return ok(response, {
    id: request.user?.sub,
    username: request.user?.username,
    name: request.user?.name,
    role: request.user?.role,
    customer_id: request.user?.customer_id ?? null,
  });
});

apiRouter.get('/dashboard/summary', requireAuth, async (_request, response) => {
  const [assets] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM assets');
  const [certificates] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM certificates');
  const [jobs] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM jobs');
  const [notifications] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM notifications');
  const [clients] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM clients');
  const [inspectors] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM inspectors');

  return ok(response, {
    assets: assets[0]?.count ?? 0,
    certificates: certificates[0]?.count ?? 0,
    jobs: jobs[0]?.count ?? 0,
    notifications: notifications[0]?.count ?? 0,
    clients: clients[0]?.count ?? 0,
    inspectors: inspectors[0]?.count ?? 0,
  });
});

apiRouter.get('/files', requireAuth, async (request, response) => {
  const query = String(request.query.q ?? '').trim();
  const params: unknown[] = [];
  let sql = `
    SELECT
      c.id,
      NULL AS job_id,
      c.client_id,
      c.cert_type,
      c.file_name,
      c.file_size,
      COALESCE(u.name, u.username, 'System') AS uploaded_by,
      c.uploaded_at,
      c.approval_status AS status
    FROM certificates c
    LEFT JOIN users u ON u.id = c.uploaded_by
    WHERE c.file_name IS NOT NULL
  `;

  if (query) {
    sql += ' AND (c.file_name LIKE ? OR c.cert_type LIKE ? OR c.client_id LIKE ? OR c.cert_number LIKE ?)';
    params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  }

  sql += ' ORDER BY c.uploaded_at DESC, c.created_at DESC LIMIT 100';

  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  const mapped = rows.map((row) => ({
    ...row,
    file_size: formatBytes(Number(row.file_size ?? 0)),
  }));

  return ok(response, mapped);
});

apiRouter.post('/notifications/mark-all-read', requireAuth, async (request, response) => {
  await pool.query<ResultSetHeader>('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [request.user?.sub ?? 0]);
  return ok(response, { updated: true });
});

apiRouter.delete('/notifications', requireAuth, async (request, response) => {
  await pool.query<ResultSetHeader>('DELETE FROM notifications WHERE user_id = ?', [request.user?.sub ?? 0]);
  return ok(response, { deleted: true });
});

apiRouter.get('/push/public-key', requireAuth, (_request, response) => {
  return ok(response, { publicKey: getPushPublicKey() });
});

apiRouter.post('/push/subscriptions', requireAuth, async (request, response) => {
  const schema = z.object({
    subscription: z.object({
      endpoint: z.string().url(),
      expirationTime: z.number().nullable().optional(),
      keys: z.object({
        p256dh: z.string(),
        auth: z.string(),
      }),
    }),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return fail(response, 400, 'A valid push subscription is required.');
  }

  const { subscription } = parsed.data;
  await pool.query<ResultSetHeader>(
    `
      INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, user_agent)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        subscription_json = VALUES(subscription_json),
        user_agent = VALUES(user_agent)
    `,
    [request.user?.sub ?? 0, subscription.endpoint, JSON.stringify(subscription), String(request.headers['user-agent'] ?? '').slice(0, 255)],
  );

  return ok(response, { subscribed: true });
});

apiRouter.delete('/push/subscriptions', requireAuth, async (request, response) => {
  const endpoint = String(request.body?.endpoint ?? '').trim();
  if (endpoint) {
    await pool.query<ResultSetHeader>('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [request.user?.sub ?? 0, endpoint]);
  } else {
    await pool.query<ResultSetHeader>('DELETE FROM push_subscriptions WHERE user_id = ?', [request.user?.sub ?? 0]);
  }

  return ok(response, { deleted: true });
});

apiRouter.post('/push/test', requireAuth, async (request, response) => {
  const broadcast = request.user?.role === 'admin' && Boolean(request.body?.broadcast);
  const targets = broadcast ? await getActiveUserIds() : [request.user?.sub ?? 0];
  const title = broadcast ? 'Rigways broadcast test' : 'Rigways push test';
  const body = broadcast
    ? `${request.user?.name ?? 'An admin'} sent a test push to all active users.`
    : 'Push notifications are now connected to this browser.';

  await notifyUsers(broadcast ? 'push-test-broadcast' : 'push-test', title, body, targets);
  return ok(response, { sent: true, recipients: targets.length });
});

apiRouter.post('/certificates/:id/upload', requireAuth, (request, response, next) => {
  upload.single('file')(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(400).json({ success: false, error: `The uploaded file exceeds the ${env.maxUploadSizeMb} MB limit.` });
      return;
    }

    response.status(400).json({ success: false, error: 'Certificate file upload failed.' });
  });
}, async (request, response) => {
  const certificateId = Number(request.params.id);
  if (!Number.isInteger(certificateId) || certificateId <= 0) {
    return fail(response, 400, 'Invalid certificate id.');
  }

  const file = request.file;
  if (!file?.buffer?.length) {
    return fail(response, 400, 'Please choose a certificate file to upload.');
  }

  const [existingRows] = await pool.query<CertificateFileRow[]>('SELECT file_path FROM certificates WHERE id = ? LIMIT 1', [certificateId]);
  if (!existingRows.length) {
    return fail(response, 404, 'Certificate not found.');
  }

  const extension = path.extname(file.originalname) || '';
  const baseName = sanitizeFileName(path.basename(file.originalname, extension));
  const storedFileName = `${Date.now()}-${baseName}${extension.toLowerCase()}`;
  const relativeDir = path.posix.join('certificates', String(certificateId));
  const absoluteDir = path.join(env.uploadsDir, 'certificates', String(certificateId));
  const absolutePath = path.join(absoluteDir, storedFileName);
  const fileUrl = `/${path.posix.join('uploads', relativeDir, storedFileName)}`;

  await fs.mkdir(absoluteDir, { recursive: true });

  const previousPath = existingRows[0]?.file_path;
  if (previousPath) {
    try {
      await fs.unlink(previousPath);
    } catch {
      // Ignore stale files; we are replacing the stored asset.
    }
  }

  await fs.writeFile(absolutePath, file.buffer);

  await pool.query<ResultSetHeader>(
    `
      UPDATE certificates
      SET file_name = ?, file_path = ?, file_url = ?, file_size = ?, mime_type = ?, uploaded_at = NOW(), uploaded_by = ?
      WHERE id = ?
    `,
    [file.originalname, absolutePath, fileUrl, file.size, file.mimetype || 'application/octet-stream', request.user?.sub ?? null, certificateId],
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${resourceConfigs.certificates.listColumns.join(', ')} FROM certificates WHERE id = ? LIMIT 1`,
    [certificateId],
  );

  const certificate = rows[0];
  await notifyUsers(
    'certificate-file-uploaded',
    `Certificate file uploaded for ${String(certificate?.cert_number ?? certificateId)}`,
    `${String(certificate?.name ?? 'A certificate')} now has an attached file (${file.originalname}).`,
  );

  return ok(response, certificate);
});
for (const [resource, config] of Object.entries(resourceConfigs)) {
  apiRouter.use(`/${resource}`, resourceRouter(resource, config));
}



