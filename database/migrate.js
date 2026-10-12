import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, clearSchemaCache, hasColumn, hasTable } from '../src/db.js';
import { n } from '../src/utils/format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runPatch(name, sql) {
  try {
    await pool.query(sql);
    console.log(`Patch applied: ${name}`);
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME' || error.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log(`Patch skipped (already applied): ${name}`);
      return;
    }
    throw error;
  }
}

const schemaSql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
const statements = schemaSql
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);

try {
  for (const statement of statements) await pool.query(statement);

  if (!(await hasColumn('cash_transactions', 'payment_id'))) {
    await runPatch('cash_transactions.payment_id', 'ALTER TABLE cash_transactions ADD COLUMN payment_id BIGINT UNSIGNED NULL AFTER expense_id');
    await runPatch('cash_transactions.payment_id_index', 'ALTER TABLE cash_transactions ADD INDEX idx_cash_transactions_payment_id (payment_id)');
  }

  if (!(await hasColumn('users', 'photo_path'))) {
    await runPatch('users.photo_path', 'ALTER TABLE users ADD COLUMN photo_path VARCHAR(255) NULL AFTER role');
  }

  if (!(await hasColumn('customers', 'photo_path'))) {
    await runPatch('customers.photo_path', 'ALTER TABLE customers ADD COLUMN photo_path VARCHAR(255) NULL AFTER notes');
  }

  if (!(await hasColumn('cash_transactions', 'partner_withdrawal_id'))) {
    await runPatch('cash_transactions.partner_withdrawal_id', 'ALTER TABLE cash_transactions ADD COLUMN partner_withdrawal_id BIGINT UNSIGNED NULL AFTER payment_id');
  }

  if (!(await hasColumn('weighbridge_tickets', 'vehicle_id'))) {
    await runPatch('weighbridge_tickets.vehicle_id', 'ALTER TABLE weighbridge_tickets ADD COLUMN vehicle_id BIGINT UNSIGNED NULL AFTER cargo_item_id');
  }

  if (!(await hasColumn('expenses', 'vehicle_trip_id'))) {
    await runPatch('expenses.vehicle_trip_id', 'ALTER TABLE expenses ADD COLUMN vehicle_trip_id BIGINT UNSIGNED NULL AFTER shipping_container_id');
  }

  if (!(await hasColumn('vehicle_trip_expenses', 'expense_id'))) {
    await runPatch('vehicle_trip_expenses.expense_id', 'ALTER TABLE vehicle_trip_expenses ADD COLUMN expense_id BIGINT UNSIGNED NULL AFTER vehicle_trip_id');
    await runPatch('vehicle_trip_expenses.expense_id_index', 'ALTER TABLE vehicle_trip_expenses ADD INDEX idx_vte_expense (expense_id)');
  }

  clearSchemaCache();

  // Link existing trip expenses to expenses table + cashbox
  if (await hasColumn('vehicle_trip_expenses', 'expense_id') && await hasColumn('expenses', 'vehicle_trip_id')) {
    const [orphans] = await pool.query(`
      SELECT vte.*, vt.trip_no, v.plate_no
      FROM vehicle_trip_expenses vte
      JOIN vehicle_trips vt ON vt.id = vte.vehicle_trip_id
      JOIN vehicles v ON v.id = vt.vehicle_id
      WHERE vte.expense_id IS NULL
    `);
    const [boxRows] = await pool.query('SELECT id FROM cash_boxes ORDER BY id LIMIT 1');
    const boxId = boxRows[0]?.id;
    for (const vte of orphans) {
      const expenseNo = `TRP-${String(vte.trip_no).replace(/^TRP-/, '')}-${vte.id}`;
      const tripRef = `${vte.trip_no} / ${vte.plate_no}`;
      const notes = vte.notes ? `${vte.notes}\n${tripRef}` : tripRef;
      const [ins] = await pool.query(
        'INSERT INTO expenses (expense_no,scope,title,category,vehicle_trip_id,amount,currency,rate_to_usd,amount_usd,expense_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',
        [expenseNo, 'vehicle_trip', vte.title, vte.stage, vte.vehicle_trip_id, vte.amount, vte.currency, vte.rate_to_usd, vte.amount_usd, vte.expense_date, notes],
      );
      const expenseId = ins.insertId;
      await pool.query('UPDATE vehicle_trip_expenses SET expense_id=? WHERE id=?', [expenseId, vte.id]);
      if (boxId && n(vte.amount) > 0) {
        const [cashRows] = await pool.query("SELECT COUNT(*) c FROM cash_transactions WHERE expense_id=? AND source_type='expense'", [expenseId]);
        if (!Number(cashRows[0]?.c)) {
          const cashNo = `CASH-TRP-${vte.id}`;
          await pool.query(
            "INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,expense_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())",
            [boxId, cashNo, 'expense', `هزینه: ${vte.title}`, vte.amount, vte.currency, vte.rate_to_usd, vte.amount_usd, vte.expense_date || new Date().toISOString().slice(0, 10), 'expense', expenseId, notes],
          );
        }
      }
    }
    if (orphans.length) console.log(`Backfilled ${orphans.length} vehicle trip expense(s) into expenses + cashbox.`);
  }

  const currencyPatches = [
    ['partners.equity_currency', 'ALTER TABLE partners ADD COLUMN equity_currency VARCHAR(255) NOT NULL DEFAULT \'USD\' AFTER equity_usd'],
    ['cargo_locations.cost_currency', 'ALTER TABLE cargo_locations ADD COLUMN cost_currency VARCHAR(255) NOT NULL DEFAULT \'USD\' AFTER cost_usd'],
    ['vehicle_trips.freight_currency', 'ALTER TABLE vehicle_trips ADD COLUMN freight_currency VARCHAR(255) NOT NULL DEFAULT \'USD\' AFTER freight_usd'],
    ['vehicle_trip_cargo.freight_currency', 'ALTER TABLE vehicle_trip_cargo ADD COLUMN freight_currency VARCHAR(255) NOT NULL DEFAULT \'USD\' AFTER freight_usd'],
    ['shipping_containers.freight_currency', 'ALTER TABLE shipping_containers ADD COLUMN freight_currency VARCHAR(255) NOT NULL DEFAULT \'USD\' AFTER freight_usd'],
  ];
  for (const [name, sql] of currencyPatches) {
    const table = name.split('.')[0];
    const column = name.split('.')[1];
    if (!(await hasColumn(table, column))) await runPatch(name, sql);
  }

  const billingPatches = [
    ['cargo_items.billing_mode', "ALTER TABLE cargo_items ADD COLUMN billing_mode VARCHAR(255) NOT NULL DEFAULT 'itemized' AFTER description"],
    ['cargo_items.contract_amount', 'ALTER TABLE cargo_items ADD COLUMN contract_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER billing_mode'],
    ['cargo_items.contract_currency', "ALTER TABLE cargo_items ADD COLUMN contract_currency VARCHAR(255) NOT NULL DEFAULT 'USD' AFTER contract_amount"],
    ['cargo_items.commission_percent', 'ALTER TABLE cargo_items ADD COLUMN commission_percent DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER contract_currency'],
    ['cargo_items.contract_route', 'ALTER TABLE cargo_items ADD COLUMN contract_route VARCHAR(255) NULL AFTER commission_percent'],
    ['expenses.route_from', 'ALTER TABLE expenses ADD COLUMN route_from VARCHAR(255) NULL AFTER notes'],
    ['expenses.route_to', 'ALTER TABLE expenses ADD COLUMN route_to VARCHAR(255) NULL AFTER route_from'],
    ['expenses.billable_to_customer', 'ALTER TABLE expenses ADD COLUMN billable_to_customer TINYINT(1) NOT NULL DEFAULT 1 AFTER route_to'],
    ['cargo_locations.route_from', 'ALTER TABLE cargo_locations ADD COLUMN route_from VARCHAR(255) NULL AFTER notes'],
    ['cargo_locations.route_to', 'ALTER TABLE cargo_locations ADD COLUMN route_to VARCHAR(255) NULL AFTER route_from'],
    ['cargo_locations.expense_id', 'ALTER TABLE cargo_locations ADD COLUMN expense_id BIGINT UNSIGNED NULL AFTER route_to'],
  ];
  for (const [name, sql] of billingPatches) {
    const table = name.split('.')[0];
    const column = name.split('.')[1];
    if (!(await hasColumn(table, column))) await runPatch(name, sql);
  }

  if (!(await hasTable('express_sessions'))) {
    await runPatch('express_sessions', `CREATE TABLE express_sessions (
      session_id VARCHAR(128) NOT NULL,
      expires INT UNSIGNED NOT NULL,
      data MEDIUMTEXT NULL,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  clearSchemaCache();
  console.log(`Database ready. ${statements.length} schema statements checked.`);
} finally {
  await pool.end();
}
