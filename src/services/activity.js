import { hasColumn, hasTable, query } from '../db.js';

export async function logActivity(req, moduleName, action, description, properties = null) {
  if (!(await hasTable('activity_logs'))) return;
  const columns = [];
  const values = [];
  const params = [];
  const add = (name, value) => { columns.push(`\`${name}\``); values.push('?'); params.push(value); };

  if (await hasColumn('activity_logs', 'user_id')) add('user_id', req.user?.id ?? null);
  if (await hasColumn('activity_logs', 'module_name')) add('module_name', moduleName);
  if (await hasColumn('activity_logs', 'module')) add('module', moduleName);
  if (await hasColumn('activity_logs', 'action')) add('action', action);
  if (await hasColumn('activity_logs', 'description')) add('description', description);
  if (await hasColumn('activity_logs', 'properties')) add('properties', properties ? JSON.stringify(properties) : null);
  if (await hasColumn('activity_logs', 'ip_address')) add('ip_address', req.ip ?? null);
  if (await hasColumn('activity_logs', 'user_agent')) add('user_agent', req.get('user-agent') ?? null);
  if (await hasColumn('activity_logs', 'created_at')) add('created_at', new Date());
  if (await hasColumn('activity_logs', 'updated_at')) add('updated_at', new Date());

  if (!columns.length) return;
  await query(`INSERT INTO activity_logs (${columns.join(', ')}) VALUES (${values.join(', ')})`, params);
}
