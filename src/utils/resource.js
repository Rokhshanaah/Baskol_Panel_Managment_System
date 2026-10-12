import { hasColumn, hasTable, one, query } from '../db.js';
import { int, padCode, paginateMeta, text } from './format.js';
import { getCodeDigits } from './settings.js';

export async function generateSequentialCode(table, column, prefix, width) {
  const digitWidth = width ?? getCodeDigits();
  const rows = await query(`SELECT \`${column}\` AS code FROM \`${table}\` WHERE \`${column}\` LIKE ?`, [`${prefix}%`]);
  let next = 1;
  for (const row of rows) {
    const match = String(row?.code || '').match(/(\d+)$/);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  let code = padCode(prefix, next, digitWidth);
  while (await one(`SELECT id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`, [code])) {
    next += 1;
    code = padCode(prefix, next, digitWidth);
  }
  return code;
}

export async function paginateQuery({ countSql, dataSql, params = [], page = 1, perPage = 10 }) {
  const totalRow = await one(countSql, params);
  const total = Number(totalRow?.total || 0);
  const meta = paginateMeta(total, int(page, 1), int(perPage, 10));
  const offset = (meta.page - 1) * meta.perPage;
  const rows = await query(`${dataSql} LIMIT ${meta.perPage} OFFSET ${offset}`, params);
  return { rows, pagination: meta };
}

export async function relationCount(table, column, id) {
  if (!(await hasTable(table)) || !(await hasColumn(table, column))) return 0;
  const row = await one(`SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${column}\` = ?`, [id]);
  return Number(row?.c || 0);
}

export async function activeRelationCount(table, column, id, statusColumn = 'status') {
  if (!(await hasTable(table)) || !(await hasColumn(table, column))) return 0;
  let sql = `SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${column}\` = ?`;
  if (await hasColumn(table, statusColumn)) sql += ` AND COALESCE(\`${statusColumn}\`,'') NOT IN ('delivered','completed','closed','cancelled','canceled')`;
  if (await hasColumn(table, 'deleted_at')) sql += ' AND deleted_at IS NULL';
  const row = await one(sql, [id]);
  return Number(row?.c || 0);
}

export async function softDelete(table, id) {
  if (await hasColumn(table, 'deleted_at')) {
    await query(`UPDATE \`${table}\` SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?`, [id]);
  } else {
    await query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
  }
}

export function pageNumber(req) { return Math.max(1, int(req.query.page, 1)); }
export function searchText(req) { return text(req.query.search); }
