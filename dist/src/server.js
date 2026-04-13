import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api/routes.js';
import { env } from './config/env.js';
import { ensureBootstrapData, waitForDatabase } from './db/bootstrap.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRoot = path.resolve(__dirname, '../dist/web');
async function start() {
    await waitForDatabase();
    await ensureBootstrapData();
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '2mb' }));
    app.use('/api', apiRouter);
    app.use(express.static(staticRoot));
    app.get('*', (_request, response) => {
        response.sendFile(path.join(staticRoot, 'index.html'));
    });
    app.listen(env.port, () => {
        console.log(`Rigways rebuild is listening on port ${env.port}`);
    });
}
start().catch((error) => {
    console.error('Failed to start application', error);
    process.exit(1);
});
