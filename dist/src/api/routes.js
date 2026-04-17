import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { signSession, verifyUser } from '../utils/auth.js';
import { sendPush, getPushPublicKey } from '../utils/push.js';
import { fail, ok } from '../utils/http.js';
const resourceConfigs = {
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
};
function sanitizeFileName(name) {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return cleaned || 'certificate-file';
}
function formatBytes(size) {
    if (!Number.isFinite(size) || size <= 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / 1024 ** index;
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
async function getActiveUserIds() {
    const [rows] = await pool.query('SELECT id FROM users WHERE is_active = 1');
    return rows.map((row) => row.id);
}
async function insertNotifications(userIds, type, title, body) {
    if (!userIds.length)
        return;
    const placeholders = userIds.map(() => '(?, ?, ?, ?, 0)').join(', ');
    const values = userIds.flatMap((userId) => [userId, type, title, body]);
    await pool.query(`INSERT INTO notifications (user_id, type, title, body, is_read) VALUES ${placeholders}`, values);
}
async function pushToUsers(userIds, payload) {
    if (!userIds.length)
        return;
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await pool.query(`SELECT id, endpoint, subscription_json FROM push_subscriptions WHERE user_id IN (${placeholders})`, userIds);
    for (const row of rows) {
        try {
            await sendPush(JSON.parse(row.subscription_json), payload);
        }
        catch (error) {
            const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
            if (statusCode === 404 || statusCode === 410) {
                await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
            }
            else {
                console.error(`Push delivery failed for subscription ${row.id}`, error);
            }
        }
    }
}
async function notifyUsers(type, title, body, userIds) {
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
function getErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return 'Unknown error';
}
function getMySqlErrorCode(error) {
    if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') {
        return error.code;
    }
    return null;
}
async function resolveCertificatePayload(payload) {
    const nextPayload = { ...payload };
    const assetReference = String(nextPayload.asset_id ?? '').trim();
    if (!assetReference) {
        return nextPayload;
    }
    const numericAssetId = Number(assetReference);
    if (Number.isInteger(numericAssetId) && numericAssetId > 0) {
        const [assetRows] = await pool.query('SELECT id, asset_number, client_id FROM assets WHERE id = ? LIMIT 1', [numericAssetId]);
        if (!assetRows.length) {
            throw new Error(`Asset "${assetReference}" was not found.`);
        }
        nextPayload.asset_id = assetRows[0].id;
        if ((nextPayload.client_id === undefined || nextPayload.client_id === '') && assetRows[0].client_id) {
            nextPayload.client_id = assetRows[0].client_id;
        }
        return nextPayload;
    }
    const [assetRows] = await pool.query('SELECT id, asset_number, client_id FROM assets WHERE asset_number = ? LIMIT 1', [assetReference]);
    if (!assetRows.length) {
        throw new Error(`Asset "${assetReference}" was not found.`);
    }
    nextPayload.asset_id = assetRows[0].id;
    if ((nextPayload.client_id === undefined || nextPayload.client_id === '') && assetRows[0].client_id) {
        nextPayload.client_id = assetRows[0].client_id;
    }
    return nextPayload;
}
function handleResourceWriteError(response, error) {
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
function resourceRouter(resource, config) {
    const router = Router();
    router.get('/', requireAuth, async (request, response) => {
        const query = String(request.query.q ?? '').trim();
        const columns = config.listColumns.join(', ');
        const order = config.defaultOrder ?? 'id DESC';
        if (resource === 'notifications') {
            const params = [request.user?.sub ?? 0];
            let sql = `SELECT ${columns} FROM ${config.table} WHERE user_id = ?`;
            if (query) {
                const where = config.searchColumns.map((column) => `${column} LIKE ?`).join(' OR ');
                sql += ` AND (${where})`;
                params.push(...config.searchColumns.map(() => `%${query}%`));
            }
            sql += ` ORDER BY ${order} LIMIT 100`;
            const [rows] = await pool.query(sql, params);
            return ok(response, rows);
        }
        if (!query) {
            const [rows] = await pool.query(`SELECT ${columns} FROM ${config.table} ORDER BY ${order} LIMIT 100`);
            return ok(response, rows);
        }
        const where = config.searchColumns.map((column) => `${column} LIKE ?`).join(' OR ');
        const params = config.searchColumns.map(() => `%${query}%`);
        const [rows] = await pool.query(`SELECT ${columns} FROM ${config.table} WHERE ${where} ORDER BY ${order} LIMIT 100`, params);
        return ok(response, rows);
    });
    router.post('/', requireAuth, async (request, response) => {
        try {
            const body = config.normalize ? config.normalize(request.body) : request.body;
            let payload = Object.fromEntries(config.writableColumns
                .filter((column) => body[column] !== undefined && body[column] !== '')
                .map((column) => [column, body[column]]));
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
            const [result] = await pool.query(`INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`, values);
            const [rows] = await pool.query(`SELECT ${config.listColumns.join(', ')} FROM ${config.table} WHERE id = ? LIMIT 1`, [result.insertId]);
            if (resource === 'certificates') {
                const created = rows[0];
                await notifyUsers('certificate-created', `Certificate ${String(created?.cert_number ?? result.insertId)} created`, `${String(created?.name ?? 'A certificate')} is now in the system with status ${String(created?.approval_status ?? 'pending')}.`);
            }
            return ok(response, rows[0], 201);
        }
        catch (error) {
            return handleResourceWriteError(response, error);
        }
    });
    router.put('/:id', requireAuth, async (request, response) => {
        try {
            const body = config.normalize ? config.normalize(request.body) : request.body;
            let payload = Object.fromEntries(config.writableColumns
                .filter((column) => body[column] !== undefined && body[column] !== '')
                .map((column) => [column, body[column]]));
            if (Object.keys(payload).length === 0) {
                return fail(response, 400, 'No data provided.');
            }
            if (resource === 'certificates') {
                payload = await resolveCertificatePayload(payload);
                const [existingRows] = await pool.query('SELECT created_at, uploaded_by FROM certificates WHERE id = ? LIMIT 1', [request.params.id]);
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
            await pool.query(`UPDATE ${config.table} SET ${fields.join(', ')} WHERE id = ?`, values);
            const [rows] = await pool.query(`SELECT ${config.listColumns.join(', ')} FROM ${config.table} WHERE id = ? LIMIT 1`, [request.params.id]);
            if (resource === 'certificates') {
                const updated = rows[0];
                await notifyUsers('certificate-updated', `Certificate ${String(updated?.cert_number ?? request.params.id)} updated`, `${String(updated?.name ?? 'Certificate')} is now ${String(updated?.approval_status ?? 'updated')}.`);
            }
            return ok(response, rows[0]);
        }
        catch (error) {
            return handleResourceWriteError(response, error);
        }
    });
    router.delete('/:id', requireAuth, async (request, response) => {
        if (resource === 'notifications') {
            await pool.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [request.params.id, request.user?.sub ?? 0]);
            return ok(response, { deleted: true });
        }
        await pool.query(`DELETE FROM ${config.table} WHERE id = ?`, [request.params.id]);
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
    const [assets] = await pool.query('SELECT COUNT(*) AS count FROM assets');
    const [certificates] = await pool.query('SELECT COUNT(*) AS count FROM certificates');
    const [jobs] = await pool.query('SELECT COUNT(*) AS count FROM jobs');
    const [notifications] = await pool.query('SELECT COUNT(*) AS count FROM notifications');
    const [clients] = await pool.query('SELECT COUNT(*) AS count FROM clients');
    const [inspectors] = await pool.query('SELECT COUNT(*) AS count FROM inspectors');
    const [expiringCertificates] = await pool.query('SELECT COUNT(*) AS count FROM certificates WHERE expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)');
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
    const [assetRows] = await pool.query(`SELECT id, asset_number, name, asset_type, status, client_id, functional_location, serial_number, manufacturer, model, description, notes, created_at, updated_at
     FROM assets WHERE id = ? LIMIT 1`, [assetId]);
    if (!assetRows.length) {
        return fail(response, 404, 'Asset not found.');
    }
    const [certificateRows] = await pool.query(`SELECT c.id, c.cert_number, c.name, c.cert_type, c.asset_id, c.client_id, c.functional_location, c.inspector_id, i.name AS inspector_name,
            c.issued_by, c.issue_date, c.expiry_date, c.approval_status, c.notes, c.file_name, c.file_url, c.file_size, c.mime_type,
            c.uploaded_at, c.created_at, c.updated_at,
            DATEDIFF(c.expiry_date, CURDATE()) AS days_until_expiry
     FROM certificates c
     LEFT JOIN inspectors i ON c.inspector_id = i.id
     WHERE c.asset_id = ?
     ORDER BY c.expiry_date ASC`, [assetId]);
    const [transferRows] = await pool.query(`SELECT at.id, at.from_client_id, at.to_client_id, at.from_functional_location, at.to_functional_location,
            at.transferred_by, at.transfer_date, at.notes, u.name AS user_name
     FROM asset_transfers at
     LEFT JOIN users u ON at.transferred_by = u.id
     WHERE at.asset_id = ?
     ORDER BY at.transfer_date DESC`, [assetId]);
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
    const [transferRows] = await pool.query(`SELECT ct.id, ct.from_client_id, ct.to_client_id, ct.from_functional_location, ct.to_functional_location,
            ct.transferred_by, ct.transfer_date, ct.notes, u.name AS user_name
     FROM certificate_transfers ct
     LEFT JOIN users u ON ct.transferred_by = u.id
     WHERE ct.certificate_id = ?
     ORDER BY ct.transfer_date DESC`, [certificateId]);
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
    const [certRows] = await pool.query('SELECT client_id, functional_location FROM certificates WHERE id = ? LIMIT 1', [certificateId]);
    if (!certRows.length) {
        return fail(response, 404, 'Certificate not found.');
    }
    const currentCert = certRows[0];
    await pool.query(`INSERT INTO certificate_transfers (certificate_id, from_client_id, to_client_id, from_functional_location, to_functional_location, transferred_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, [certificateId, currentCert.client_id, to_client_id, currentCert.functional_location, to_functional_location || null, request.user?.sub ?? 0, notes || null]);
    await pool.query('UPDATE certificates SET client_id = ?, functional_location = ? WHERE id = ?', [to_client_id, to_functional_location || null, certificateId]);
    const [updatedRows] = await pool.query(`SELECT ${resourceConfigs.certificates.listColumns.join(', ')} FROM certificates WHERE id = ? LIMIT 1`, [certificateId]);
    await notifyUsers('certificate-transferred', `Certificate transferred`, `Certificate has been transferred to a new client/location.`);
    return ok(response, updatedRows[0]);
});
apiRouter.get('/inspectors/with-users', requireAuth, async (_request, response) => {
    const [rows] = await pool.query(`SELECT i.id, i.inspector_number, i.name, i.title, i.email, i.phone, i.status, i.experience_years,
            u.id AS user_id, u.username
     FROM inspectors i
     LEFT JOIN users u ON i.id = u.inspector_id
     ORDER BY i.name ASC`);
    return ok(response, rows);
});
apiRouter.get('/certificates/inspector/:inspectorId', requireAuth, async (request, response) => {
    const inspectorId = Number(request.params.inspectorId);
    if (!Number.isInteger(inspectorId) || inspectorId <= 0) {
        return fail(response, 400, 'Invalid inspector id.');
    }
    const [rows] = await pool.query(`SELECT c.id, c.cert_number, c.name, c.cert_type, c.asset_id, c.client_id, c.functional_location, c.inspector_id, i.name AS inspector_name,
            c.issued_by, c.issue_date, c.expiry_date, c.approval_status, c.notes, c.file_name, c.file_url, c.file_size, c.mime_type,
            c.uploaded_at, c.created_at, c.updated_at,
            DATEDIFF(c.expiry_date, CURDATE()) AS days_until_expiry
     FROM certificates c
     LEFT JOIN inspectors i ON c.inspector_id = i.id
     WHERE c.inspector_id = ?
     ORDER BY c.expiry_date ASC`, [inspectorId]);
    return ok(response, rows);
});
apiRouter.post('/certificates/log/download', requireAuth, async (request, response) => {
    const { asset_id, format } = request.body;
    if (!asset_id) {
        return fail(response, 400, 'Asset ID is required.');
    }
    const [certRows] = await pool.query(`SELECT c.id, c.cert_number, c.name, c.cert_type, c.asset_id, c.client_id, c.functional_location, c.inspector_id, i.name AS inspector_name,
            c.issued_by, c.issue_date, c.expiry_date, c.approval_status, c.notes, c.file_name, c.file_url, c.file_size, c.mime_type,
            c.uploaded_at, c.created_at, c.updated_at,
            DATEDIFF(c.expiry_date, CURDATE()) AS days_until_expiry
     FROM certificates c
     LEFT JOIN inspectors i ON c.inspector_id = i.id
     WHERE c.asset_id = ?
     ORDER BY c.expiry_date ASC`, [asset_id]);
    const [transferRows] = await pool.query(`SELECT ct.id, ct.from_client_id, ct.to_client_id, ct.from_functional_location, ct.to_functional_location,
            ct.transferred_by, ct.transfer_date, ct.notes, u.name AS user_name
     FROM certificate_transfers ct
     LEFT JOIN users u ON ct.transferred_by = u.id
     WHERE ct.certificate_id IN (SELECT id FROM certificates WHERE asset_id = ?)
     ORDER BY ct.transfer_date DESC`, [asset_id]);
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
        didDrawPage: (data) => {
            doc.setFontSize(9);
            doc.setTextColor(121, 135, 153);
            doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 12);
        },
    });
    const finalY = doc.lastAutoTable?.finalY || 144;
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
    const params = [];
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
    const [rows] = await pool.query(sql, params);
    const mapped = rows.map((row) => ({
        ...row,
        file_size: formatBytes(Number(row.file_size ?? 0)),
    }));
    return ok(response, mapped);
});
apiRouter.post('/notifications/mark-all-read', requireAuth, async (request, response) => {
    await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [request.user?.sub ?? 0]);
    return ok(response, { updated: true });
});
apiRouter.delete('/notifications', requireAuth, async (request, response) => {
    await pool.query('DELETE FROM notifications WHERE user_id = ?', [request.user?.sub ?? 0]);
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
    await pool.query(`
      INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, user_agent)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        subscription_json = VALUES(subscription_json),
        user_agent = VALUES(user_agent)
    `, [request.user?.sub ?? 0, subscription.endpoint, JSON.stringify(subscription), String(request.headers['user-agent'] ?? '').slice(0, 255)]);
    return ok(response, { subscribed: true });
});
apiRouter.delete('/push/subscriptions', requireAuth, async (request, response) => {
    const endpoint = String(request.body?.endpoint ?? '').trim();
    if (endpoint) {
        await pool.query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [request.user?.sub ?? 0, endpoint]);
    }
    else {
        await pool.query('DELETE FROM push_subscriptions WHERE user_id = ?', [request.user?.sub ?? 0]);
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
    upload.single('file')(request, response, (error) => {
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
    const [existingRows] = await pool.query('SELECT file_path FROM certificates WHERE id = ? LIMIT 1', [certificateId]);
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
        }
        catch {
            // Ignore stale files; we are replacing the stored asset.
        }
    }
    await fs.writeFile(absolutePath, file.buffer);
    await pool.query(`
      UPDATE certificates
      SET file_name = ?, file_path = ?, file_url = ?, file_size = ?, mime_type = ?, uploaded_at = NOW(), uploaded_by = ?
      WHERE id = ?
    `, [file.originalname, absolutePath, fileUrl, file.size, file.mimetype || 'application/octet-stream', request.user?.sub ?? null, certificateId]);
    const [rows] = await pool.query(`SELECT ${resourceConfigs.certificates.listColumns.join(', ')} FROM certificates WHERE id = ? LIMIT 1`, [certificateId]);
    const certificate = rows[0];
    await notifyUsers('certificate-file-uploaded', `Certificate file uploaded for ${String(certificate?.cert_number ?? certificateId)}`, `${String(certificate?.name ?? 'A certificate')} now has an attached file (${file.originalname}).`);
    return ok(response, certificate);
});
for (const [resource, config] of Object.entries(resourceConfigs)) {
    apiRouter.use(`/${resource}`, resourceRouter(resource, config));
}
