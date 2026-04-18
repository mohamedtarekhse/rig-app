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
type AssetLookupRow = RowDataPacket & { id: number; asset_number: string; client_id: string | null };
type AssetDetailRow = RowDataPacket & {
  id: number;
  asset_number: string;
  name: string;
  asset_type: string;
  status: string;
  client_id: string | null;
  functional_location: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type CertificateDetailRow = RowDataPacket & {
  id: number;
  cert_number: string;
  name: string;
  cert_type: string;
  asset_id: number;
  client_id: string | null;
  functional_location: string | null;
  inspector_id: number | null;
  inspector_name: string | null;
  issued_by: string;
  issue_date: string;
  expiry_date: string;
  approval_status: string;
  notes: string | null;
  file_name: string | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  created_at: string;
  updated_at: string;
  days_until_expiry: number;
};
type TransferRow = RowDataPacket & {
  id: number;
  from_client_id: string | null;
  to_client_id: string | null;
  from_functional_location: string | null;
  to_functional_location: string | null;
  transferred_by: number;
  transfer_date: string;
  notes: string | null;
  user_name: string | null;
};
type InspectorWithUser = RowDataPacket & {
  id: number;
  inspector_number: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  experience_years: number | null;
  user_id: number | null;
  username: string | null;
};
type InspectorWithUserRow = InspectorWithUser;

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
    listColumns: ['id', 'cert_number', 'name', 'cert_type', 'asset_id', 'client_id', 'functional_location', 'inspector_id', 'issued_by', 'issue_date', 'expiry_date', 'approval_status', 'notes', 'file_name', 'file_url', 'file_size', 'mime_type', 'uploaded_at', 'created_at', 'updated_at'],
    writableColumns: ['cert_number', 'name', 'cert_type', 'asset_id', 'client_id', 'functional_location', 'inspector_id', 'issued_by', 'issue_date', 'expiry_date', 'approval_status', 'notes'],
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
  'certificate-renewals': {
    table: 'certificate_renewals',
    searchColumns: ['renewal_status', 'renewal_notes'],
    listColumns: ['id', 'certificate_id', 'old_expiry_date', 'new_expiry_date', 'renewal_status', 'requested_by', 'approved_by', 'renewal_notes', 'rejection_reason', 'requested_at', 'approved_at', 'completed_at'],
    writableColumns: ['certificate_id', 'old_expiry_date', 'new_expiry_date', 'renewal_status', 'renewal_notes', 'rejection_reason'],
    defaultOrder: 'requested_at DESC',
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
function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function getMySqlErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  return null;
}

async function resolveCertificatePayload(payload: Record<string, unknown>) {
  const nextPayload = { ...payload };
  const assetReference = String(nextPayload.asset_id ?? '').trim();

  if (!assetReference) {
    return nextPayload;
  }

  const numericAssetId = Number(assetReference);
  if (Number.isInteger(numericAssetId) && numericAssetId > 0) {
    const [assetRows] = await pool.query<AssetLookupRow[]>('SELECT id, asset_number, client_id FROM assets WHERE id = ? LIMIT 1', [numericAssetId]);
    if (!assetRows.length) {
      throw new Error(`Asset "${assetReference}" was not found.`);
    }

    nextPayload.asset_id = assetRows[0].id;
    if ((nextPayload.client_id === undefined || nextPayload.client_id === '') && assetRows[0].client_id) {
      nextPayload.client_id = assetRows[0].client_id;
    }
    return nextPayload;
  }

  const [assetRows] = await pool.query<AssetLookupRow[]>('SELECT id, asset_number, client_id FROM assets WHERE asset_number = ? LIMIT 1', [assetReference]);
  if (!assetRows.length) {
    throw new Error(`Asset "${assetReference}" was not found.`);
  }

  nextPayload.asset_id = assetRows[0].id;
  if ((nextPayload.client_id === undefined || nextPayload.client_id === '') && assetRows[0].client_id) {
    nextPayload.client_id = assetRows[0].client_id;
  }

  return nextPayload;
}

function handleResourceWriteError(response: Parameters<typeof fail>[0], error: unknown) {
  const code = getMySqlErrorCode(error);

  if (code === 'ER_DUP_ENTRY') {
    return fail(response, 409, 'A record with the same unique value already exists.');
  }

  if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') {
    return fail(response, 400, getErrorMessage(error));
  }

  const message = getErrorMessage(error);
  if (message.includes('was not found')) {
    return fail(response, 400, message);
  }

  console.error('Resource write failed', error);
  return fail(response, 500, 'Unable to save the record right now.');
}
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
    try {
      const body = config.normalize ? config.normalize(request.body) : request.body;
      let payload = Object.fromEntries(
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

      if (resource === 'certificates') {
        payload = await resolveCertificatePayload(payload);
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
    } catch (error) {
      return handleResourceWriteError(response, error);
    }
  });

  router.put('/:id', requireAuth, async (request, response) => {
    try {
      const body = config.normalize ? config.normalize(request.body) : request.body;
      let payload = Object.fromEntries(
        config.writableColumns
          .filter((column) => body[column] !== undefined && body[column] !== '')
          .map((column) => [column, body[column]]),
      ) as Record<string, unknown>;

      if (Object.keys(payload).length === 0) {
        return fail(response, 400, 'No data provided.');
      }

      if (resource === 'certificates') {
        payload = await resolveCertificatePayload(payload);
        
        const [existingRows] = await pool.query<RowDataPacket[]>(
          'SELECT created_at, uploaded_by FROM certificates WHERE id = ? LIMIT 1',
          [request.params.id],
        );
        
        if (existingRows.length > 0) {
          const existing = existingRows[0];
          const createdAt = new Date(existing.created_at);
          const now = new Date();
          const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
          
          const userRole = request.user?.role;
          const isOwner = existing.uploaded_by === request.user?.sub;
          
          if (hoursSinceCreation > 24 && userRole !== 'admin') {
            if (!isOwner || userRole !== 'admin') {
              return fail(response, 403, 'Editing is only allowed within 24 hours of creation. Please contact an admin for approval.');
            }
          }
        }
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
    } catch (error) {
      return handleResourceWriteError(response, error);
    }
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
  const [expiringCertificates] = await pool.query<CountRow[]>(
    'SELECT COUNT(*) AS count FROM certificates WHERE expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)',
  );

  return ok(response, {
    assets: assets[0]?.count ?? 0,
    certificates: certificates[0]?.count ?? 0,
    jobs: jobs[0]?.count ?? 0,
    notifications: notifications[0]?.count ?? 0,
    clients: clients[0]?.count ?? 0,
    inspectors: inspectors[0]?.count ?? 0,
    expiring_certificates: expiringCertificates[0]?.count ?? 0,
  });
});

apiRouter.get('/assets/:id/detail', requireAuth, async (request, response) => {
  const assetId = Number(request.params.id);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    return fail(response, 400, 'Invalid asset id.');
  }

  const [assetRows] = await pool.query<AssetDetailRow[]>(
    `SELECT id, asset_number, name, asset_type, status, client_id, functional_location, serial_number, manufacturer, model, description, notes, created_at, updated_at
     FROM assets WHERE id = ? LIMIT 1`,
    [assetId],
  );

  if (!assetRows.length) {
    return fail(response, 404, 'Asset not found.');
  }

  const [certificateRows] = await pool.query<CertificateDetailRow[]>(
    `SELECT c.id, c.cert_number, c.name, c.cert_type, c.asset_id, c.client_id, c.functional_location, c.inspector_id, i.name AS inspector_name,
            c.issued_by, c.issue_date, c.expiry_date, c.approval_status, c.notes, c.file_name, c.file_url, c.file_size, c.mime_type,
            c.uploaded_at, c.created_at, c.updated_at,
            DATEDIFF(c.expiry_date, CURDATE()) AS days_until_expiry
     FROM certificates c
     LEFT JOIN inspectors i ON c.inspector_id = i.id
     WHERE c.asset_id = ?
     ORDER BY c.expiry_date ASC`,
    [assetId],
  );

  const [transferRows] = await pool.query<TransferRow[]>(
    `SELECT at.id, at.from_client_id, at.to_client_id, at.from_functional_location, at.to_functional_location,
            at.transferred_by, at.transfer_date, at.notes, u.name AS user_name
     FROM asset_transfers at
     LEFT JOIN users u ON at.transferred_by = u.id
     WHERE at.asset_id = ?
     ORDER BY at.transfer_date DESC`,
    [assetId],
  );

  return ok(response, {
    asset: assetRows[0],
    certificates: certificateRows,
    transfers: transferRows,
  });
});

apiRouter.get('/certificates/:id/transfers', requireAuth, async (request, response) => {
  const certificateId = Number(request.params.id);
  if (!Number.isInteger(certificateId) || certificateId <= 0) {
    return fail(response, 400, 'Invalid certificate id.');
  }

  const [transferRows] = await pool.query<TransferRow[]>(
    `SELECT ct.id, ct.from_client_id, ct.to_client_id, ct.from_functional_location, ct.to_functional_location,
            ct.transferred_by, ct.transfer_date, ct.notes, u.name AS user_name
     FROM certificate_transfers ct
     LEFT JOIN users u ON ct.transferred_by = u.id
     WHERE ct.certificate_id = ?
     ORDER BY ct.transfer_date DESC`,
    [certificateId],
  );

  return ok(response, transferRows);
});

apiRouter.post('/certificates/:id/transfer', requireAuth, async (request, response) => {
  const certificateId = Number(request.params.id);
  if (!Number.isInteger(certificateId) || certificateId <= 0) {
    return fail(response, 400, 'Invalid certificate id.');
  }

  const { to_client_id, to_functional_location, notes } = request.body;
  if (!to_client_id) {
    return fail(response, 400, 'Target client is required.');
  }

  const [certRows] = await pool.query<CertificateDetailRow[]>(
    'SELECT client_id, functional_location FROM certificates WHERE id = ? LIMIT 1',
    [certificateId],
  );

  if (!certRows.length) {
    return fail(response, 404, 'Certificate not found.');
  }

  const currentCert = certRows[0];
  await pool.query<ResultSetHeader>(
    `INSERT INTO certificate_transfers (certificate_id, from_client_id, to_client_id, from_functional_location, to_functional_location, transferred_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [certificateId, currentCert.client_id, to_client_id, currentCert.functional_location, to_functional_location || null, request.user?.sub ?? 0, notes || null],
  );

  await pool.query<ResultSetHeader>(
    'UPDATE certificates SET client_id = ?, functional_location = ? WHERE id = ?',
    [to_client_id, to_functional_location || null, certificateId],
  );

  const [updatedRows] = await pool.query<CertificateDetailRow[]>(
    `SELECT ${resourceConfigs.certificates.listColumns.join(', ')} FROM certificates WHERE id = ? LIMIT 1`,
    [certificateId],
  );

  await notifyUsers(
    'certificate-transferred',
    `Certificate transferred`,
    `Certificate has been transferred to a new client/location.`,
  );

  return ok(response, updatedRows[0]);
});

apiRouter.get('/inspectors/with-users', requireAuth, async (_request, response) => {
  const [rows] = await pool.query<InspectorWithUserRow[]>(
    `SELECT i.id, i.inspector_number, i.name, i.title, i.email, i.phone, i.status, i.experience_years,
            u.id AS user_id, u.username
     FROM inspectors i
     LEFT JOIN users u ON i.id = u.inspector_id
     ORDER BY i.name ASC`,
  );

  return ok(response, rows);
});

apiRouter.get('/certificates/inspector/:inspectorId', requireAuth, async (request, response) => {
  const inspectorId = Number(request.params.inspectorId);
  if (!Number.isInteger(inspectorId) || inspectorId <= 0) {
    return fail(response, 400, 'Invalid inspector id.');
  }

  const [rows] = await pool.query<CertificateDetailRow[]>(
    `SELECT c.id, c.cert_number, c.name, c.cert_type, c.asset_id, c.client_id, c.functional_location, c.inspector_id, i.name AS inspector_name,
            c.issued_by, c.issue_date, c.expiry_date, c.approval_status, c.notes, c.file_name, c.file_url, c.file_size, c.mime_type,
            c.uploaded_at, c.created_at, c.updated_at,
            DATEDIFF(c.expiry_date, CURDATE()) AS days_until_expiry
     FROM certificates c
     LEFT JOIN inspectors i ON c.inspector_id = i.id
     WHERE c.inspector_id = ?
     ORDER BY c.expiry_date ASC`,
    [inspectorId],
  );

  return ok(response, rows);
});

apiRouter.post('/certificates/log/download', requireAuth, async (request, response) => {
  const { asset_id, format } = request.body;
  if (!asset_id) {
    return fail(response, 400, 'Asset ID is required.');
  }

  const [certRows] = await pool.query<CertificateDetailRow[]>(
    `SELECT c.id, c.cert_number, c.name, c.cert_type, c.asset_id, c.client_id, c.functional_location, c.inspector_id, i.name AS inspector_name,
            c.issued_by, c.issue_date, c.expiry_date, c.approval_status, c.notes, c.file_name, c.file_url, c.file_size, c.mime_type,
            c.uploaded_at, c.created_at, c.updated_at,
            DATEDIFF(c.expiry_date, CURDATE()) AS days_until_expiry
     FROM certificates c
     LEFT JOIN inspectors i ON c.inspector_id = i.id
     WHERE c.asset_id = ?
     ORDER BY c.expiry_date ASC`,
    [asset_id],
  );

  const [transferRows] = await pool.query<TransferRow[]>(
    `SELECT ct.id, ct.from_client_id, ct.to_client_id, ct.from_functional_location, ct.to_functional_location,
            ct.transferred_by, ct.transfer_date, ct.notes, u.name AS user_name
     FROM certificate_transfers ct
     LEFT JOIN users u ON ct.transferred_by = u.id
     WHERE ct.certificate_id IN (SELECT id FROM certificates WHERE asset_id = ?)
     ORDER BY ct.transfer_date DESC`,
    [asset_id],
  );

  if (format === 'csv') {
    let csv = 'Type,ID,Cert Number,Name,Type,Client,Location,Inspector,Issued By,Issue Date,Expiry Date,Status,Days Until Expiry\n';
    certRows.forEach((row) => {
      csv += `Certificate,${row.id},${row.cert_number},${row.name},${row.cert_type},${row.client_id || ''},${row.functional_location || ''},${row.inspector_name || ''},${row.issued_by},${row.issue_date},${row.expiry_date},${row.approval_status},${row.days_until_expiry}\n`;
    });
    transferRows.forEach((row) => {
      csv += `Transfer,${row.id},,,Transfer,,${row.from_functional_location || ''} -> ${row.to_functional_location || ''},,${row.user_name || ''},,${row.transfer_date},,${row.notes || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    return response.send(Buffer.from(await blob.arrayBuffer()));
  }

  const jsPDF = (await import('jspdf')).default;
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFillColor(20, 41, 63);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 74, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RG', 34, 34);
  doc.setFontSize(17);
  doc.text('Rigways Group', 72, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Certificate Log Report', 72, 46);

  doc.setTextColor(47, 55, 66);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`Asset ${asset_id} - Certificate Log`, 34, 108);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, doc.internal.pageSize.getWidth() - 180, 108);
  doc.text(`Certificates: ${certRows.length}`, doc.internal.pageSize.getWidth() - 180, 126);

  autoTable(doc, {
    startY: 144,
    head: [['Cert #', 'Name', 'Type', 'Client', 'Location', 'Inspector', 'Issue Date', 'Expiry Date', 'Status', 'Days Left']],
    body: certRows.map((row) => [
      row.cert_number,
      row.name,
      row.cert_type,
      row.client_id || '-',
      row.functional_location || '-',
      row.inspector_name || '-',
      row.issue_date,
      row.expiry_date,
      row.approval_status,
      String(row.days_until_expiry),
    ]),
    styles: { fontSize: 8, cellPadding: 6, textColor: [47, 55, 66], lineColor: [224, 230, 238], lineWidth: 0.5 },
    headStyles: { fillColor: [20, 41, 63], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' },
    alternateRowStyles: { fillColor: [248, 251, 255] },
    margin: { left: 34, right: 34, bottom: 30 },
    didDrawPage: (data: any) => {
      doc.setFontSize(9);
      doc.setTextColor(121, 135, 153);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 12);
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 144;
  if (transferRows.length > 0) {
    autoTable(doc, {
      startY: finalY + 20,
      head: [['Transfer Date', 'From Location', 'To Location', 'By User', 'Notes']],
      body: transferRows.map((row) => [row.transfer_date, row.from_functional_location || '-', row.to_functional_location || '-', row.user_name || '-', row.notes || '-']),
      styles: { fontSize: 8, cellPadding: 6, textColor: [47, 55, 66], lineColor: [224, 230, 238], lineWidth: 0.5 },
      headStyles: { fillColor: [20, 41, 63], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      margin: { left: 34, right: 34, bottom: 30 },
    });
  }

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  return response.send(pdfBuffer);
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

// Maintenance Schedules API Routes
apiRouter.get('/maintenance-schedules', requireAuth, async (request, response) => {
  const query = String(request.query.q ?? '').trim();
  const params: unknown[] = [];
  let sql = `
    SELECT 
      ms.id,
      ms.asset_id,
      a.asset_number,
      a.name AS asset_name,
      ms.title,
      ms.description,
      ms.scheduled_date,
      ms.completed_date,
      ms.status,
      ms.priority,
      ms.assigned_to,
      u.name AS assigned_to_name,
      ms.created_by,
      cu.name AS created_by_name,
      ms.created_at,
      ms.updated_at
    FROM maintenance_schedules ms
    LEFT JOIN assets a ON a.id = ms.asset_id
    LEFT JOIN users u ON u.id = ms.assigned_to
    LEFT JOIN users cu ON cu.id = ms.created_by
  `;
  
  const conditions: string[] = [];
  if (query) {
    conditions.push('(ms.title LIKE ? OR ms.description LIKE ? OR a.asset_number LIKE ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  
  sql += ' ORDER BY ms.scheduled_date DESC, ms.created_at DESC LIMIT 100';
  
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return ok(response, rows);
});

apiRouter.post('/maintenance-schedules', requireAuth, async (request, response) => {
  try {
    const { asset_id, title, description, scheduled_date, priority, assigned_to } = request.body;
    
    if (!asset_id || !title || !scheduled_date) {
      return fail(response, 400, 'Asset ID, title, and scheduled date are required.');
    }
    
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO maintenance_schedules (asset_id, title, description, scheduled_date, priority, assigned_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [asset_id, title, description || null, scheduled_date, priority || 'medium', assigned_to || null, request.user?.sub]
    );
    
    // Log audit
    await pool.query<ResultSetHeader>(
      `INSERT INTO audit_logs (user_id, action_type, resource_type, resource_id, new_values)
       VALUES (?, ?, ?, ?, ?)`,
      [request.user?.sub, 'CREATE', 'maintenance_schedule', result.insertId, JSON.stringify({ asset_id, title, scheduled_date })]
    );
    
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM maintenance_schedules WHERE id = ? LIMIT 1',
      [result.insertId]
    );
    
    return ok(response, rows[0], 201);
  } catch (error) {
    console.error('Create maintenance schedule failed', error);
    return fail(response, 500, 'Unable to create maintenance schedule.');
  }
});

apiRouter.put('/maintenance-schedules/:id', requireAuth, async (request, response) => {
  try {
    const { id } = request.params;
    const { status, completed_date, priority, assigned_to, title, description } = request.body;
    
    // Get existing record for audit
    const [existingRows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM maintenance_schedules WHERE id = ? LIMIT 1',
      [id]
    );
    
    if (existingRows.length === 0) {
      return fail(response, 404, 'Maintenance schedule not found.');
    }
    
    const existing = existingRows[0];
    const updates: string[] = [];
    const values: unknown[] = [];
    
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (completed_date !== undefined) {
      updates.push('completed_date = ?');
      values.push(completed_date);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      values.push(priority);
    }
    if (assigned_to !== undefined) {
      updates.push('assigned_to = ?');
      values.push(assigned_to);
    }
    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    
    if (updates.length === 0) {
      return fail(response, 400, 'No data provided.');
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    await pool.query<ResultSetHeader>(
      `UPDATE maintenance_schedules SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    // Log audit
    await pool.query<ResultSetHeader>(
      `INSERT INTO audit_logs (user_id, action_type, resource_type, resource_id, old_values, new_values)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [request.user?.sub, 'UPDATE', 'maintenance_schedule', id, JSON.stringify(existing), JSON.stringify(request.body)]
    );
    
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM maintenance_schedules WHERE id = ? LIMIT 1',
      [id]
    );
    
    return ok(response, rows[0]);
  } catch (error) {
    console.error('Update maintenance schedule failed', error);
    return fail(response, 500, 'Unable to update maintenance schedule.');
  }
});

apiRouter.delete('/maintenance-schedules/:id', requireAuth, async (request, response) => {
  try {
    const { id } = request.params;
    
    // Log audit before delete
    const [existingRows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM maintenance_schedules WHERE id = ? LIMIT 1',
      [id]
    );
    
    if (existingRows.length > 0) {
      await pool.query<ResultSetHeader>(
        `INSERT INTO audit_logs (user_id, action_type, resource_type, resource_id, old_values)
         VALUES (?, ?, ?, ?, ?)`,
        [request.user?.sub, 'DELETE', 'maintenance_schedule', id, JSON.stringify(existingRows[0])]
      );
    }
    
    await pool.query<ResultSetHeader>('DELETE FROM maintenance_schedules WHERE id = ?', [id]);
    return ok(response, { deleted: true });
  } catch (error) {
    console.error('Delete maintenance schedule failed', error);
    return fail(response, 500, 'Unable to delete maintenance schedule.');
  }
});

// Certificate Renewal API Routes
apiRouter.get('/certificate-renewals', requireAuth, async (request, response) => {
  const query = String(request.query.q ?? '').trim();
  const params: unknown[] = [];
  let sql = `
    SELECT 
      cr.id,
      cr.certificate_id,
      c.cert_number,
      c.name AS certificate_name,
      cr.old_expiry_date,
      cr.new_expiry_date,
      cr.renewal_status,
      cr.requested_by,
      ru.name AS requested_by_name,
      cr.approved_by,
      au.name AS approved_by_name,
      cr.renewal_notes,
      cr.rejection_reason,
      cr.requested_at,
      cr.approved_at,
      cr.completed_at
    FROM certificate_renewals cr
    LEFT JOIN certificates c ON c.id = cr.certificate_id
    LEFT JOIN users ru ON ru.id = cr.requested_by
    LEFT JOIN users au ON au.id = cr.approved_by
  `;
  
  const conditions: string[] = [];
  if (query) {
    conditions.push('(c.cert_number LIKE ? OR c.name LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }
  
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  
  sql += ' ORDER BY cr.requested_at DESC LIMIT 100';
  
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return ok(response, rows);
});

apiRouter.post('/certificate-renewals', requireAuth, async (request, response) => {
  try {
    const { certificate_id, new_expiry_date, renewal_notes } = request.body;
    
    if (!certificate_id) {
      return fail(response, 400, 'Certificate ID is required.');
    }
    
    // Get current certificate expiry
    const [certRows] = await pool.query<RowDataPacket[]>(
      'SELECT expiry_date FROM certificates WHERE id = ? LIMIT 1',
      [certificate_id]
    );
    
    if (certRows.length === 0) {
      return fail(response, 404, 'Certificate not found.');
    }
    
    const oldExpiryDate = certRows[0].expiry_date;
    
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO certificate_renewals (certificate_id, old_expiry_date, new_expiry_date, renewal_notes, requested_by)
       VALUES (?, ?, ?, ?, ?)`,
      [certificate_id, oldExpiryDate, new_expiry_date || null, renewal_notes || null, request.user?.sub]
    );
    
    // Log audit
    await pool.query<ResultSetHeader>(
      `INSERT INTO audit_logs (user_id, action_type, resource_type, resource_id, new_values)
       VALUES (?, ?, ?, ?, ?)`,
      [request.user?.sub, 'CREATE', 'certificate_renewal', result.insertId, JSON.stringify({ certificate_id, new_expiry_date })]
    );
    
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM certificate_renewals WHERE id = ? LIMIT 1',
      [result.insertId]
    );
    
    return ok(response, rows[0], 201);
  } catch (error) {
    console.error('Create certificate renewal failed', error);
    return fail(response, 500, 'Unable to create certificate renewal request.');
  }
});

apiRouter.put('/certificate-renewals/:id', requireAuth, async (request, response) => {
  try {
    const { id } = request.params;
    const { renewal_status, new_expiry_date, approved_by, rejection_reason, renewal_notes } = request.body;
    
    const updates: string[] = [];
    const values: unknown[] = [];
    
    if (renewal_status !== undefined) {
      updates.push('renewal_status = ?');
      values.push(renewal_status);
      
      if (renewal_status === 'approved') {
        updates.push('approved_at = CURRENT_TIMESTAMP');
        updates.push('approved_by = ?');
        values.push(request.user?.sub);
      } else if (renewal_status === 'rejected') {
        updates.push('rejection_reason = ?');
        values.push(rejection_reason || null);
      } else if (renewal_status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }
    }
    
    if (new_expiry_date !== undefined) {
      updates.push('new_expiry_date = ?');
      values.push(new_expiry_date);
    }
    
    if (renewal_notes !== undefined) {
      updates.push('renewal_notes = ?');
      values.push(renewal_notes);
    }
    
    if (updates.length === 0) {
      return fail(response, 400, 'No data provided.');
    }
    
    values.push(id);
    
    await pool.query<ResultSetHeader>(
      `UPDATE certificate_renewals SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    // If approved and has new expiry date, update the certificate
    if (renewal_status === 'approved' && new_expiry_date) {
      const [renewalRows] = await pool.query<RowDataPacket[]>(
        'SELECT certificate_id FROM certificate_renewals WHERE id = ? LIMIT 1',
        [id]
      );
      
      if (renewalRows.length > 0) {
        await pool.query<ResultSetHeader>(
          'UPDATE certificates SET expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [new_expiry_date, renewalRows[0].certificate_id]
        );
        
        // Log audit for certificate update
        await pool.query<ResultSetHeader>(
          `INSERT INTO audit_logs (user_id, action_type, resource_type, resource_id, new_values)
           VALUES (?, ?, ?, ?, ?)`,
          [request.user?.sub, 'RENEWAL', 'certificate', renewalRows[0].certificate_id, JSON.stringify({ new_expiry_date })]
        );
      }
    }
    
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM certificate_renewals WHERE id = ? LIMIT 1',
      [id]
    );
    
    return ok(response, rows[0]);
  } catch (error) {
    console.error('Update certificate renewal failed', error);
    return fail(response, 500, 'Unable to update certificate renewal.');
  }
});

// Audit Logs API Route
apiRouter.get('/audit-logs', requireAuth, async (request, response) => {
  // Only admins can view audit logs
  if (request.user?.role !== 'admin') {
    return fail(response, 403, 'Access denied. Admin privileges required.');
  }
  
  const query = String(request.query.q ?? '').trim();
  const resourceType = String(request.query.resourceType ?? '');
  const userId = request.query.userId ? Number(request.query.userId) : null;
  const startDate = String(request.query.startDate ?? '');
  const endDate = String(request.query.endDate ?? '');
  
  const params: unknown[] = [];
  let sql = `
    SELECT 
      al.id,
      al.user_id,
      u.name AS user_name,
      al.action_type,
      al.resource_type,
      al.resource_id,
      al.old_values,
      al.new_values,
      al.ip_address,
      al.created_at
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE 1=1
  `;
  
  if (query) {
    sql += ' AND (al.action_type LIKE ? OR al.resource_type LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }
  
  if (resourceType) {
    sql += ' AND al.resource_type = ?';
    params.push(resourceType);
  }
  
  if (userId) {
    sql += ' AND al.user_id = ?';
    params.push(userId);
  }
  
  if (startDate) {
    sql += ' AND al.created_at >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    sql += ' AND al.created_at <= ?';
    params.push(endDate);
  }
  
  sql += ' ORDER BY al.created_at DESC LIMIT 500';
  
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return ok(response, rows);
});

// Bulk Operations API Routes
apiRouter.post('/bulk-operations', requireAuth, async (request, response) => {
  try {
    const { operation_type, resource_type, records } = request.body;
    
    if (!operation_type || !resource_type || !Array.isArray(records)) {
      return fail(response, 400, 'Operation type, resource type, and records array are required.');
    }
    
    // Create bulk operation record
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO bulk_operations (operation_type, resource_type, total_records, initiated_by, status, started_at)
       VALUES (?, ?, ?, ?, 'processing', CURRENT_TIMESTAMP)`,
      [operation_type, resource_type, records.length, request.user?.sub]
    );
    
    const bulkOpId = result.insertId;
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];
    
    // Process based on operation type
    if (operation_type === 'delete' && resource_type === 'assets') {
      for (const record of records) {
        try {
          await pool.query<ResultSetHeader>('DELETE FROM assets WHERE id = ?', [record.id]);
          successful++;
        } catch (err) {
          failed++;
          errors.push(`Failed to delete asset ${record.id}: ${(err as Error).message}`);
        }
      }
    } else if (operation_type === 'delete' && resource_type === 'certificates') {
      for (const record of records) {
        try {
          await pool.query<ResultSetHeader>('DELETE FROM certificates WHERE id = ?', [record.id]);
          successful++;
        } catch (err) {
          failed++;
          errors.push(`Failed to delete certificate ${record.id}: ${(err as Error).message}`);
        }
      }
    } else {
      return fail(response, 400, `Unsupported bulk operation: ${operation_type} on ${resource_type}`);
    }
    
    // Update bulk operation record
    await pool.query<ResultSetHeader>(
      `UPDATE bulk_operations 
       SET successful_records = ?, failed_records = ?, error_log = ?, status = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [successful, failed, errors.join('\n') || null, failed > 0 ? 'failed' : 'completed', bulkOpId]
    );
    
    // Log audit
    await pool.query<ResultSetHeader>(
      `INSERT INTO audit_logs (user_id, action_type, resource_type, new_values)
       VALUES (?, ?, ?, ?)`,
      [request.user?.sub, 'BULK_OPERATION', resource_type, JSON.stringify({ operation_type, total: records.length, successful, failed })]
    );
    
    return ok(response, {
      id: bulkOpId,
      operation_type,
      resource_type,
      total_records: records.length,
      successful_records: successful,
      failed_records: failed,
      status: failed > 0 ? 'failed' : 'completed',
      errors: failed > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Bulk operation failed', error);
    return fail(response, 500, 'Unable to perform bulk operation.');
  }
});

apiRouter.get('/bulk-operations', requireAuth, async (request, response) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT bo.*, u.name AS initiated_by_name
     FROM bulk_operations bo
     LEFT JOIN users u ON u.id = bo.initiated_by
     ORDER BY bo.created_at DESC
     LIMIT 50`
  );
  
  return ok(response, rows);
});




