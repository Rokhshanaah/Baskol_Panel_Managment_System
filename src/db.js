import mysql from 'mysql2/promise';
import { env } from './config/env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
  charset: 'utf8mb4',
});

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

export async function scalar(sql, params = [], key = null) {
  const row = await one(sql, params);
  if (!row) return null;
  if (key) return row[key] ?? null;
  return Object.values(row)[0] ?? null;
}

export async function transaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback({
      query: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      one: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows[0] ?? null;
      },
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const tableCache = new Map();
const columnCache = new Map();

export async function hasTable(table) {
  if (tableCache.has(table)) return tableCache.get(table);
  const row = await one(
    `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [env.db.database, table],
  );
  const exists = Number(row?.c || 0) > 0;
  tableCache.set(table, exists);
  return exists;
}

export async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  const row = await one(
    `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [env.db.database, table, column],
  );
  const exists = Number(row?.c || 0) > 0;
  columnCache.set(key, exists);
  return exists;
}

export function clearSchemaCache() {
  tableCache.clear();
  columnCache.clear();
}
