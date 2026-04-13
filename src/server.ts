import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api/routes.js';
import { env } from './config/env.js';
import { ensureBootstrapData, ensureSchema, waitForDatabase } from './db/bootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRootCandidates = [
  path.resolve(__dirname, '../web'),
  path.resolve(__dirname, '../dist/web'),
];
const staticRoot = staticRootCandidates.find((candidate) => fs.existsSync(candidate)) ?? staticRootCandidates[0];

async function start() {
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
    console.log(`Serving frontend from ${staticRoot}`);
  });

  try {
    await waitForDatabase();
    await ensureSchema();
    await ensureBootstrapData();
    console.log('Database bootstrap completed.');
  } catch (error) {
    console.error('Database bootstrap failed after extended retries.', error);
  }
}

start().catch((error) => {
  console.error('Failed to start application', error);
  process.exit(1);
});