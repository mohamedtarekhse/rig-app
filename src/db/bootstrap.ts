import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2';
import { pool } from './pool.js';

type CountRow = RowDataPacket & { count: number };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaCandidates = [
  path.resolve(__dirname, '../../docker/mysql/init.sql'),
  path.resolve(__dirname, '../../../docker/mysql/init.sql'),
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSchemaSql() {
  for (const candidate of schemaCandidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      continue;
    }
  }

  throw new Error(`Schema file not found. Looked in: ${schemaCandidates.join(', ')}`);
}

export async function waitForDatabase(retries = 120, delayMs = 2000) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      console.log(`Database connection established after ${attempt} attempt(s).`);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Database not ready yet (attempt ${attempt}/${retries}): ${message}`);
      await delay(delayMs);
    }
  }

  throw lastError;
}

export async function ensureSchema() {
  const sql = await loadSchemaSql();
  await pool.query(sql);
  console.log('Database schema ensured from init.sql.');
}

export async function ensureBootstrapData() {
  const [userRows] = await pool.query<CountRow[]>('SELECT COUNT(*) AS count FROM users');
  if ((userRows[0]?.count ?? 0) > 0) {
    return;
  }

  const passwordHash = await bcrypt.hash('admin123', 10);

  await pool.query(`
    INSERT INTO clients (client_id, name, industry, contact, email, country, city, status)
    VALUES
      ('C001', 'Acme Drilling', 'Energy', 'Nora Blake', 'ops@acmedrilling.test', 'Egypt', 'Cairo', 'active'),
      ('C002', 'Delta Marine', 'Marine', 'Youssef Nabil', 'fleet@deltamarine.test', 'UAE', 'Dubai', 'active')
  `);

  await pool.query(
    `
      INSERT INTO users (username, name, role, customer_id, password_hash, is_active)
      VALUES
        ('admin', 'Rigways Administrator', 'admin', NULL, ?, 1),
        ('manager', 'Operations Manager', 'manager', 'C001', ?, 1),
        ('tech', 'Field Technician', 'technician', 'C001', ?, 1)
    `,
    [passwordHash, passwordHash, passwordHash],
  );

  await pool.query(`
    INSERT INTO functional_locations (fl_id, name, type, client_id, status, notes)
    VALUES
      ('FL-001', 'North Yard', 'Yard', 'C001', 'active', 'Primary storage yard'),
      ('FL-002', 'Rig Floor A', 'Rig', 'C002', 'active', 'High pressure equipment zone')
  `);

  await pool.query(`
    INSERT INTO inspectors (inspector_number, name, title, email, phone, status, experience_years)
    VALUES
      ('INS-001', 'Karim Adel', 'Senior Inspector', 'karim@rigways.test', '+201000000001', 'active', 9),
      ('INS-002', 'Maya Samir', 'Inspection Specialist', 'maya@rigways.test', '+201000000002', 'active', 6)
  `);

  await pool.query(`
    INSERT INTO assets
      (asset_number, name, asset_type, status, client_id, functional_location, serial_number, manufacturer, notes)
    VALUES
      ('AST-001', 'Main Hoist', 'Hoisting Equipment', 'operation', 'C001', 'FL-001', 'MH-2026-01', 'Rigways', 'Seed asset'),
      ('AST-002', 'Mud Pump', 'Mud System', 'operation', 'C002', 'FL-002', 'MP-2026-02', 'Delta Works', 'Active pump')
  `);

  await pool.query(`
    INSERT INTO certificates
      (cert_number, name, cert_type, asset_id, client_id, issued_by, issue_date, expiry_date, approval_status, notes)
    SELECT
      'CERT-0001', 'Hoist CAT III', 'CAT III', a.id, a.client_id, 'Rigways QA', '2026-01-10', '2026-10-10', 'approved', 'Seed certificate'
    FROM assets a
    WHERE a.asset_number = 'AST-001'
    LIMIT 1
  `);

  await pool.query(`
    INSERT INTO jobs (job_number, client_id, functional_location, title, status, notes)
    VALUES
      ('JOB-0001', 'C001', 'FL-001', 'Monthly inspection cycle', 'active', 'Seed workflow job')
  `);

  await pool.query(`
    INSERT INTO notifications (user_id, type, title, body, is_read)
    SELECT id, 'system', 'Welcome to the rebuild', 'React, Node.js, MySQL, and Docker are now wired together.', 0
    FROM users
    WHERE username = 'admin'
    LIMIT 1
  `);
}