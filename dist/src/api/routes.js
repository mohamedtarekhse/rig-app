import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { signSession, verifyUser } from '../utils/auth.js';
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
        searchColumns: ['cert_number', 'name', 'cert_type', 'client_id', 'issued_by', 'approval_status'],
        listColumns: ['id', 'cert_number', 'name', 'cert_type', 'asset_id', 'client_id', 'issued_by', 'issue_date', 'expiry_date', 'approval_status', 'notes', 'created_at'],
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
function resourceRouter(resource, config) {
    const router = Router();
    router.get('/', requireAuth, async (request, response) => {
        const query = String(request.query.q ?? '').trim();
        const columns = config.listColumns.join(', ');
        const order = config.defaultOrder ?? 'id DESC';
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
        const body = config.normalize ? config.normalize(request.body) : request.body;
        const payload = Object.fromEntries(config.writableColumns
            .filter((column) => body[column] !== undefined && body[column] !== '')
            .map((column) => [column, body[column]]));
        if (Object.keys(payload).length === 0) {
            return fail(response, 400, 'No data provided.');
        }
        if (resource === 'notifications') {
            payload.user_id = request.user?.sub;
        }
        const columns = Object.keys(payload);
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((column) => payload[column]);
        const [result] = await pool.query(`INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`, values);
        const [rows] = await pool.query(`SELECT ${config.listColumns.join(', ')} FROM ${config.table} WHERE id = ? LIMIT 1`, [result.insertId]);
        return ok(response, rows[0], 201);
    });
    router.put('/:id', requireAuth, async (request, response) => {
        const body = config.normalize ? config.normalize(request.body) : request.body;
        const payload = Object.fromEntries(config.writableColumns
            .filter((column) => body[column] !== undefined && body[column] !== '')
            .map((column) => [column, body[column]]));
        if (Object.keys(payload).length === 0) {
            return fail(response, 400, 'No data provided.');
        }
        const fields = Object.keys(payload).map((column) => `${column} = ?`);
        const values = [...Object.values(payload), request.params.id];
        await pool.query(`UPDATE ${config.table} SET ${fields.join(', ')} WHERE id = ?`, values);
        const [rows] = await pool.query(`SELECT ${config.listColumns.join(', ')} FROM ${config.table} WHERE id = ? LIMIT 1`, [request.params.id]);
        return ok(response, rows[0]);
    });
    router.delete('/:id', requireAuth, async (request, response) => {
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
    return ok(response, {
        assets: assets[0]?.count ?? 0,
        certificates: certificates[0]?.count ?? 0,
        jobs: jobs[0]?.count ?? 0,
        notifications: notifications[0]?.count ?? 0,
        clients: clients[0]?.count ?? 0,
        inspectors: inspectors[0]?.count ?? 0,
    });
});
for (const [resource, config] of Object.entries(resourceConfigs)) {
    apiRouter.use(`/${resource}`, resourceRouter(resource, config));
}
