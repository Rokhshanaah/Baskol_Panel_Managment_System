import { hasColumn, hasTable, one, query } from '../db.js';
import { generateSequentialCode, softDelete } from '../utils/resource.js';
import { n, text, today } from '../utils/format.js';

async function ensureCashBox(req) {
  let box = await one('SELECT * FROM cash_boxes ORDER BY id LIMIT 1');
  if (!box) {
    const name = req?.t ? req.t('fields.mainCashbox') : 'Main Cashbox';
    const r = await query("INSERT INTO cash_boxes (name,currency,opening_balance,is_active,notes,created_at,updated_at) VALUES (?,?,?,?,?,NOW(),NOW())", [name, 'USD', 0, 1, '']);
    box = await one('SELECT * FROM cash_boxes WHERE id=?', [r.insertId]);
  }
  return box;
}

export async function createCargoRouteExpense(req, {
  cargoId,
  customerId,
  title,
  category = null,
  amount,
  currency,
  rate,
  amountUsd,
  expenseDate = null,
  notes = null,
  routeFrom = null,
  routeTo = null,
  billable = 1,
}) {
  const expenseNo = await generateSequentialCode('expenses', 'expense_no', 'EXP-');
  const hasRoute = await hasColumn('expenses', 'route_from');
  let expenseId;
  if (hasRoute) {
    const r = await query(`
      INSERT INTO expenses (expense_no, scope, title, category, customer_id, cargo_item_id, amount, currency, rate_to_usd, amount_usd, expense_date, notes, route_from, route_to, billable_to_customer, created_at, updated_at)
      VALUES (?, 'cargo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      expenseNo, text(title), category, customerId, cargoId,
      amount, currency, rate, amountUsd, expenseDate, notes,
      routeFrom, routeTo, billable ? 1 : 0,
    ]);
    expenseId = r.insertId;
  } else {
    const r = await query(`
      INSERT INTO expenses (expense_no, scope, title, category, customer_id, cargo_item_id, amount, currency, rate_to_usd, amount_usd, expense_date, notes, created_at, updated_at)
      VALUES (?, 'cargo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      expenseNo, text(title), category, customerId, cargoId,
      amount, currency, rate, amountUsd, expenseDate, notes,
    ]);
    expenseId = r.insertId;
  }
  await syncExpenseCashbox(expenseId, req);
  return expenseId;
}

export async function syncExpenseCashbox(expenseId, req) {
  if (!(await hasTable('cash_transactions')) || !(await hasColumn('cash_transactions', 'expense_id'))) return;
  const expense = await one('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL', [expenseId]);
  if (!expense) return;
  const box = await ensureCashBox(req);
  const amount = n(expense.amount);
  const currency = expense.currency || 'USD';
  const rate = 1;
  const amountUsd = n(expense.amount_usd ?? amount);
  if (amount <= 0) {
    await query("DELETE FROM cash_transactions WHERE expense_id=? AND source_type='expense'", [expenseId]);
    return;
  }
  let tx = await one("SELECT * FROM cash_transactions WHERE expense_id=? AND source_type='expense' LIMIT 1", [expenseId]);
  const notes = req.t('sync.expenseNote', { no: expense.expense_no || '-', scope: expense.scope || '-', notes: expense.notes || '' });
  const title = req.t('sync.expenseTitle', { title: expense.title || expense.expense_no });
  if (tx) {
    await query("UPDATE cash_transactions SET cash_box_id=?, type='expense', title=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, transaction_date=?, source_type='expense', notes=?, updated_at=NOW() WHERE id=?", [box.id, title, amount, currency, rate, amountUsd, expense.expense_date || today(), notes, tx.id]);
  } else {
    const no = await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-');
    await query("INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,expense_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())", [box.id, no, 'expense', title, amount, currency, rate, amountUsd, expense.expense_date || today(), 'expense', expenseId, notes]);
  }
}

export async function syncTripExpense(vteId, req) {
  const vte = await one(`
    SELECT vte.*, vt.trip_no, v.plate_no
    FROM vehicle_trip_expenses vte
    JOIN vehicle_trips vt ON vt.id = vte.vehicle_trip_id AND vt.deleted_at IS NULL
    JOIN vehicles v ON v.id = vt.vehicle_id
    WHERE vte.id = ?
  `, [vteId]);
  if (!vte) return;

  const expenseNo = `TRP-${String(vte.trip_no).replace(/^TRP-/, '')}-${vte.id}`;
  const tripRef = `${vte.trip_no} / ${vte.plate_no}`;
  const notes = vte.notes ? `${vte.notes}\n${tripRef}` : tripRef;
  const hasTripCol = await hasColumn('expenses', 'vehicle_trip_id');
  let expenseId = vte.expense_id;

  if (expenseId) {
    if (hasTripCol) {
      await query('UPDATE expenses SET expense_no=?, scope=?, title=?, category=?, vehicle_trip_id=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, expense_date=?, notes=?, updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [expenseNo, 'vehicle_trip', vte.title, vte.stage, vte.vehicle_trip_id, vte.amount, vte.currency, vte.rate_to_usd, vte.amount_usd, vte.expense_date, notes, expenseId]);
    } else {
      await query('UPDATE expenses SET expense_no=?, scope=?, title=?, category=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, expense_date=?, notes=?, updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [expenseNo, 'vehicle_trip', vte.title, vte.stage, vte.amount, vte.currency, vte.rate_to_usd, vte.amount_usd, vte.expense_date, notes, expenseId]);
    }
  } else {
    let r;
    if (hasTripCol) {
      r = await query('INSERT INTO expenses (expense_no,scope,title,category,vehicle_trip_id,amount,currency,rate_to_usd,amount_usd,expense_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', [expenseNo, 'vehicle_trip', vte.title, vte.stage, vte.vehicle_trip_id, vte.amount, vte.currency, vte.rate_to_usd, vte.amount_usd, vte.expense_date, notes]);
    } else {
      r = await query('INSERT INTO expenses (expense_no,scope,title,category,amount,currency,rate_to_usd,amount_usd,expense_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', [expenseNo, 'vehicle_trip', vte.title, vte.stage, vte.amount, vte.currency, vte.rate_to_usd, vte.amount_usd, vte.expense_date, notes]);
    }
    expenseId = r.insertId;
    if (await hasColumn('vehicle_trip_expenses', 'expense_id')) {
      await query('UPDATE vehicle_trip_expenses SET expense_id=? WHERE id=?', [expenseId, vteId]);
    }
  }

  await syncExpenseCashbox(expenseId, req);
  return expenseId;
}

export async function deleteTripExpense(vteId) {
  const vte = await one('SELECT expense_id FROM vehicle_trip_expenses WHERE id=?', [vteId]);
  if (!vte?.expense_id) return;
  if (await hasColumn('cash_transactions', 'expense_id')) {
    await query("DELETE FROM cash_transactions WHERE expense_id=? AND source_type='expense'", [vte.expense_id]);
  }
  await softDelete('expenses', vte.expense_id);
}
