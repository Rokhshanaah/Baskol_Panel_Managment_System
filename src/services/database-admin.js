import { env } from '../config/env.js';
import { clearSchemaCache, query, one, transaction } from '../db.js';
import { loadSettings } from '../utils/settings.js';

const RESET_CONFIRM_PHRASE = 'حذف همه';

export function getResetConfirmPhrase() {
  return RESET_CONFIRM_PHRASE;
}

function escapeSqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

async function listTables() {
  const rows = await query(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [env.db.database],
  );
  return rows.map((row) => row.name);
}

export async function createDatabaseBackup() {
  const tables = await listTables();
  const settings = loadSettings();
  const lines = [
    '-- Baskol Panel Database Backup',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Database: ${env.db.database}`,
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ];

  for (const tableName of tables) {
    const createRow = await one(`SHOW CREATE TABLE \`${tableName}\``);
    const createSql = createRow?.['Create Table'];
    if (!createSql) continue;

    lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
    lines.push(`${createSql};`);
    lines.push('');

    const rows = await query(`SELECT * FROM \`${tableName}\``);
    if (!rows.length) continue;

    const columns = Object.keys(rows[0]).map((col) => `\`${col}\``).join(', ');
    for (const row of rows) {
      const values = Object.values(row).map(escapeSqlValue).join(', ');
      lines.push(`INSERT INTO \`${tableName}\` (${columns}) VALUES (${values});`);
    }
    lines.push('');
  }

  lines.push('SET FOREIGN_KEY_CHECKS = 1;');
  lines.push('');
  lines.push('-- BASKOL_APP_SETTINGS_JSON');
  lines.push(JSON.stringify(settings, null, 2));
  lines.push('-- END_BASKOL_APP_SETTINGS_JSON');

  return `${lines.join('\n')}\n`;
}

export async function resetAllDatabaseData(preserveUserId) {
  const admin = await one('SELECT * FROM users WHERE id = ? LIMIT 1', [preserveUserId]);
  if (!admin) {
    throw new Error('کاربر مدیر برای حفظ حساب یافت نشد.');
  }

  const tables = await listTables();

  await transaction(async (tx) => {
    await tx.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const tableName of tables) {
      await tx.query(`TRUNCATE TABLE \`${tableName}\``);
    }

    const columns = Object.keys(admin);
    const placeholders = columns.map(() => '?').join(', ');
    await tx.query(
      `INSERT INTO users (${columns.map((col) => `\`${col}\``).join(', ')}) VALUES (${placeholders})`,
      columns.map((col) => admin[col]),
    );

    await tx.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  clearSchemaCache();
}

export function isValidResetConfirmPhrase(phrase) {
  return String(phrase || '').trim() === RESET_CONFIRM_PHRASE;
}
