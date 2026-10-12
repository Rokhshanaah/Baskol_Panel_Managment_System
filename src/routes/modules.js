import express from 'express';
import { hasColumn, hasTable, one, query } from '../db.js';
import { asyncRoute, flash } from '../utils/http.js';
import { int, like, n, nullableInt, nullableText, text, today } from '../utils/format.js';
import { generateSequentialCode, pageNumber, paginateQuery, searchText, softDelete } from '../utils/resource.js';
import { resolvePerPage, loadSettings } from '../utils/settings.js';
import { pageMeta } from '../utils/i18n.js';
import { renderPage } from '../utils/view.js';
import { logActivity } from '../services/activity.js';
import { getDefaultCurrency, getEnabledCurrencies, moneyFormNative, nativeMoneyFields } from '../utils/currency.js';
import { attachTripExpenseTotals, cargoProfitOnTrip, recalcTripTotals, tripProfitLoss, vehicleProfitLoss } from '../services/vehicle-pl.js';
import { deleteTripExpense, syncTripExpense } from '../services/expense-sync.js';

export const modulesRouter = express.Router();

function must(value, message) { if (text(value) === '') throw new Error(message); }

function currencyFields(body, settings = loadSettings()) {
  return nativeMoneyFields(body, settings);
}

async function ensureCashBox(req) {
  let box = await one('SELECT * FROM cash_boxes ORDER BY id LIMIT 1');
  if (!box) {
    const name = req?.t ? req.t('fields.mainCashbox') : 'Main Cashbox';
    const r = await query("INSERT INTO cash_boxes (name,currency,opening_balance,is_active,notes,created_at,updated_at) VALUES (?,?,?,?,?,NOW(),NOW())", [name, 'USD', 0, 1, '']);
    box = await one('SELECT * FROM cash_boxes WHERE id=?', [r.insertId]);
  }
  return box;
}

async function syncPartnerWithdrawal(withdrawalId, req) {
  if (!await hasTable('partner_withdrawals')) return;
  const w = await one(`
    SELECT pw.*, p.name partner_name FROM partner_withdrawals pw
    JOIN partners p ON p.id = pw.partner_id WHERE pw.id=?
  `, [withdrawalId]);
  if (!w) return;
  const box = await ensureCashBox(req);
  if (n(w.amount) <= 0) return;
  const title = req.t('sync.partnerWithdrawTitle', { name: w.partner_name || w.withdrawal_no });
  const notes = req.t('sync.partnerWithdrawNote', { no: w.withdrawal_no, notes: w.notes || '' });
  if (await hasColumn('cash_transactions', 'partner_withdrawal_id')) {
    let tx = await one('SELECT id FROM cash_transactions WHERE partner_withdrawal_id=? LIMIT 1', [withdrawalId]);
    if (tx) {
      await query("UPDATE cash_transactions SET cash_box_id=?, type='withdraw', title=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, transaction_date=?, source_type='partner', notes=?, updated_at=NOW() WHERE id=?", [box.id, title, w.amount, w.currency, w.rate_to_usd, w.amount_usd, w.withdrawal_date || today(), notes, tx.id]);
    } else {
      const no = await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-');
      const r = await query("INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,partner_withdrawal_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())", [box.id, no, 'withdraw', title, w.amount, w.currency, w.rate_to_usd, w.amount_usd, w.withdrawal_date || today(), 'partner', withdrawalId, notes]);
      await query('UPDATE partner_withdrawals SET cash_transaction_id=? WHERE id=?', [r.insertId, withdrawalId]);
    }
    return;
  }
  const cashNo = await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-');
  const r = await query("INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())", [box.id, cashNo, 'withdraw', title, w.amount, w.currency, w.rate_to_usd, w.amount_usd, w.withdrawal_date || today(), 'partner', notes]);
  await query('UPDATE partner_withdrawals SET cash_transaction_id=? WHERE id=?', [r.insertId, withdrawalId]);
}

async function syncSalaryExpense(salaryId, req) {
  const salary = await one('SELECT * FROM salary_records WHERE id=? AND deleted_at IS NULL', [salaryId]);
  if (!salary) return;
  const settings = loadSettings();
  const title = req.t('sync.salaryTitle', { name: salary.employee_name, month: salary.salary_month || '-' });
  const expenseNo = salary.salary_no;
  if (salary.expense_id) {
    await query('UPDATE expenses SET expense_no=?, scope=?, title=?, category=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, expense_date=?, notes=?, updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [expenseNo, 'company', title, salary.category || 'salary', salary.amount, salary.currency, salary.rate_to_usd, salary.amount_usd, salary.paid_date || today(), salary.notes, salary.expense_id]);
  } else {
    const r = await query('INSERT INTO expenses (expense_no,scope,title,category,amount,currency,rate_to_usd,amount_usd,expense_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', [expenseNo, 'company', title, salary.category || 'salary', salary.amount, salary.currency, salary.rate_to_usd, salary.amount_usd, salary.paid_date || today(), salary.notes]);
    await query('UPDATE salary_records SET expense_id=? WHERE id=?', [r.insertId, salaryId]);
  }
  if (await hasColumn('cash_transactions', 'expense_id')) {
    const expenseId = salary.expense_id || (await one('SELECT expense_id FROM salary_records WHERE id=?', [salaryId]))?.expense_id;
    const expense = await one('SELECT * FROM expenses WHERE id=?', [expenseId]);
    if (expense) {
      const box = await ensureCashBox(req);
      let tx = await one("SELECT id FROM cash_transactions WHERE expense_id=? AND source_type='expense' LIMIT 1", [expenseId]);
      const txNotes = req.t('sync.expenseNote', { no: expense.expense_no, scope: expense.scope, notes: expense.notes || '' });
      if (tx) {
        await query("UPDATE cash_transactions SET cash_box_id=?, type='expense', title=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, transaction_date=?, notes=?, updated_at=NOW() WHERE id=?", [box.id, title, expense.amount, expense.currency, expense.rate_to_usd, expense.amount_usd, expense.expense_date, txNotes, tx.id]);
      } else {
        const no = await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-');
        await query("INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,expense_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())", [box.id, no, 'expense', title, expense.amount, expense.currency, expense.rate_to_usd, expense.amount_usd, expense.expense_date, 'expense', expenseId, txNotes]);
      }
    }
  }
}

// ─── Vehicles ───
modulesRouter.get('/vehicles', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE deleted_at IS NULL';
  if (search) {
    where += ' AND (vehicle_code LIKE ? OR plate_no LIKE ? OR brand_model LIKE ? OR owner_name LIKE ? OR default_driver_name LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(like(search));
  }
  const { rows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM vehicles ${where}`,
    dataSql: `SELECT * FROM vehicles ${where} ORDER BY id DESC`,
    params, page, perPage: resolvePerPage(req),
  });
  let form = null;
  if (req.query.form === 'create') form = { vehicle_code: await generateSequentialCode('vehicles', 'vehicle_code', 'VEH-'), plate_no: '', vehicle_type: 'truck', brand_model: '', capacity_kg: '', capacity_cbm: '', owner_name: '', default_driver_name: '', default_driver_phone: '', status: 'active', notes: '' };
  if (req.query.edit) form = await one('SELECT * FROM vehicles WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  await renderPage(req, res, 'vehicles', { ...pageMeta(req, 'vehicles'), rows, pagination, search, form, editingId: form?.id ?? null });
}));

modulesRouter.post('/vehicles/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const code = text(req.body.vehicle_code) || await generateSequentialCode('vehicles', 'vehicle_code', 'VEH-');
  must(req.body.plate_no, req.t('validation.plateRequired'));
  const vals = [code, text(req.body.plate_no), text(req.body.vehicle_type) || 'truck', nullableText(req.body.brand_model), n(req.body.capacity_kg), n(req.body.capacity_cbm), nullableText(req.body.owner_name), nullableText(req.body.default_driver_name), nullableText(req.body.default_driver_phone), text(req.body.status) || 'active', nullableText(req.body.notes)];
  if (id) {
    await query('UPDATE vehicles SET vehicle_code=?,plate_no=?,vehicle_type=?,brand_model=?,capacity_kg=?,capacity_cbm=?,owner_name=?,default_driver_name=?,default_driver_phone=?,status=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, id]);
    flash(req, 'success', req.t('flash.vehicleUpdated'));
  } else {
    await query('INSERT INTO vehicles (vehicle_code,plate_no,vehicle_type,brand_model,capacity_kg,capacity_cbm,owner_name,default_driver_name,default_driver_phone,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', vals);
    flash(req, 'success', req.t('flash.vehicleCreated'));
  }
  res.redirect('/vehicles');
}));

modulesRouter.post('/vehicles/:id/delete', asyncRoute(async (req, res) => {
  await softDelete('vehicles', int(req.params.id));
  flash(req, 'success', req.t('flash.vehicleDeleted'));
  res.redirect('/vehicles');
}));

// ─── Vehicle Trips ───
modulesRouter.get('/vehicle-trips', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE vt.deleted_at IS NULL';
  if (search) {
    where += ' AND (vt.trip_no LIKE ? OR vt.origin LIKE ? OR vt.destination LIKE ? OR v.plate_no LIKE ? OR vt.driver_name LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(like(search));
  }
  const { rows: tripRows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM vehicle_trips vt JOIN vehicles v ON v.id=vt.vehicle_id ${where}`,
    dataSql: `SELECT vt.*, v.plate_no, v.vehicle_code FROM vehicle_trips vt JOIN vehicles v ON v.id=vt.vehicle_id ${where} ORDER BY vt.id DESC`,
    params, page, perPage: resolvePerPage(req),
  });
  const rows = await attachTripExpenseTotals(tripRows);
  const selectedId = nullableInt(req.query.trip);
  let selectedTrip = null;
  let tripCargo = [];
  let tripExpenses = [];
  let tripPl = null;
  let cargoPl = [];
  if (selectedId) {
    selectedTrip = await one(`SELECT vt.*, v.plate_no, v.vehicle_code FROM vehicle_trips vt JOIN vehicles v ON v.id=vt.vehicle_id WHERE vt.id=? AND vt.deleted_at IS NULL`, [selectedId]);
    if (selectedTrip) {
      tripCargo = await query(`SELECT vtc.*, ci.cargo_code, ci.name cargo_name, c.name customer_name FROM vehicle_trip_cargo vtc LEFT JOIN cargo_items ci ON ci.id=vtc.cargo_item_id LEFT JOIN customers c ON c.id=vtc.customer_id WHERE vtc.vehicle_trip_id=? ORDER BY vtc.id DESC`, [selectedId]);
      tripExpenses = await query('SELECT * FROM vehicle_trip_expenses WHERE vehicle_trip_id=? ORDER BY expense_date DESC, id DESC', [selectedId]);
      tripPl = await tripProfitLoss(selectedId);
      cargoPl = await cargoProfitOnTrip(selectedId);
    }
  }
  let form = null;
  if (req.query.form === 'create') {
    const vehicle = nullableInt(req.query.vehicle);
    const v = vehicle ? await one('SELECT * FROM vehicles WHERE id=?', [vehicle]) : null;
    form = { trip_no: await generateSequentialCode('vehicle_trips', 'trip_no', 'TRP-'), vehicle_id: vehicle || '', driver_name: v?.default_driver_name || '', driver_phone: v?.default_driver_phone || '', origin: '', destination: '', status: 'loading', notes: '' };
  }
  if (req.query.edit) {
    form = await one('SELECT * FROM vehicle_trips WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  }
  const vehicles = await query('SELECT id, plate_no, vehicle_code FROM vehicles WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500');
  const cargoItems = selectedTrip ? await query('SELECT ci.id, ci.cargo_code, ci.name, c.name customer_name FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 500') : [];
  const enabledCurrencies = getEnabledCurrencies();
  const defaultCurrency = getDefaultCurrency();
  await renderPage(req, res, 'vehicle-trips', {
    ...pageMeta(req, 'vehicleTrips'), rows, pagination, search, form, editingId: form?.id ?? null,
    selectedTrip, tripCargo, tripExpenses, tripPl, cargoPl, vehicles, cargoItems, enabledCurrencies, defaultCurrency,
  });
}));

modulesRouter.post('/vehicle-trips/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const tripNo = id
    ? (text(req.body.trip_no) || await generateSequentialCode('vehicle_trips', 'trip_no', 'TRP-'))
    : await generateSequentialCode('vehicle_trips', 'trip_no', 'TRP-');
  must(req.body.vehicle_id, req.t('validation.vehicleRequired'));
  const vals = [tripNo, nullableInt(req.body.vehicle_id), nullableText(req.body.driver_name), nullableText(req.body.driver_phone), nullableText(req.body.origin), nullableText(req.body.destination), text(req.body.status) || 'loading', nullableText(req.body.loaded_at), nullableText(req.body.departed_at), nullableText(req.body.arrived_at), nullableText(req.body.delivered_at)];
  const notes = nullableText(req.body.notes);
  let tripId = id;
  if (id) {
    await query('UPDATE vehicle_trips SET trip_no=?,vehicle_id=?,driver_name=?,driver_phone=?,origin=?,destination=?,status=?,loaded_at=?,departed_at=?,arrived_at=?,delivered_at=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, notes, id]);
    flash(req, 'success', req.t('flash.tripUpdated'));
  } else {
    const dc = getDefaultCurrency();
    const r = await query('INSERT INTO vehicle_trips (trip_no,vehicle_id,driver_name,driver_phone,origin,destination,status,loaded_at,departed_at,arrived_at,delivered_at,freight_usd,freight_currency,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,NOW(),NOW())', [...vals, dc, notes]);
    tripId = r.insertId;
    flash(req, 'success', req.t('flash.tripCreated'));
  }
  await recalcTripTotals(tripId);
  res.redirect(`/vehicle-trips?trip=${tripId}`);
}));

modulesRouter.post('/vehicle-trips/:id/delete', asyncRoute(async (req, res) => {
  await softDelete('vehicle_trips', int(req.params.id));
  flash(req, 'success', req.t('flash.tripDeleted'));
  res.redirect('/vehicle-trips');
}));

modulesRouter.post('/vehicle-trips/:id/cargo', asyncRoute(async (req, res) => {
  const tripId = int(req.params.id);
  const cargoId = nullableInt(req.body.cargo_item_id);
  must(cargoId, req.t('validation.cargoRequired'));
  const cargo = await one('SELECT id, customer_id FROM cargo_items WHERE id=? AND deleted_at IS NULL', [cargoId]);
  const { currency, amount } = nativeMoneyFields(req.body);
  must(amount > 0, req.t('validation.freightRequired'));
  await query('INSERT INTO vehicle_trip_cargo (vehicle_trip_id,cargo_item_id,customer_id,cartons,weight_kg,freight_usd,freight_currency,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())', [tripId, cargoId, cargo.customer_id, int(req.body.cartons, 0), n(req.body.weight_kg), amount, currency, nullableText(req.body.notes)]);
  await recalcTripTotals(tripId);
  flash(req, 'success', req.t('flash.tripCargoAdded'));
  res.redirect(`/vehicle-trips?trip=${tripId}`);
}));

modulesRouter.post('/vehicle-trips/:tripId/cargo/:itemId/delete', asyncRoute(async (req, res) => {
  const tripId = int(req.params.tripId);
  await query('DELETE FROM vehicle_trip_cargo WHERE id=? AND vehicle_trip_id=?', [int(req.params.itemId), tripId]);
  await recalcTripTotals(tripId);
  flash(req, 'success', req.t('flash.tripCargoRemoved'));
  res.redirect(`/vehicle-trips?trip=${tripId}`);
}));

modulesRouter.post('/vehicle-trips/:id/expenses', asyncRoute(async (req, res) => {
  const tripId = int(req.params.id);
  must(req.body.title, req.t('validation.expenseTitleRequired'));
  const { currency, amount, rate, amountUsd } = currencyFields(req.body);
  const r = await query('INSERT INTO vehicle_trip_expenses (vehicle_trip_id,stage,title,expense_date,amount,currency,rate_to_usd,amount_usd,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())', [tripId, text(req.body.stage) || 'transit', text(req.body.title), nullableText(req.body.expense_date) || today(), amount, currency, rate, amountUsd, nullableText(req.body.notes)]);
  await syncTripExpense(r.insertId, req);
  flash(req, 'success', req.t('flash.tripExpenseAdded'));
  res.redirect(`/vehicle-trips?trip=${tripId}`);
}));

modulesRouter.post('/vehicle-trips/:tripId/expenses/:expId/delete', asyncRoute(async (req, res) => {
  const tripId = int(req.params.tripId);
  await deleteTripExpense(int(req.params.expId));
  await query('DELETE FROM vehicle_trip_expenses WHERE id=? AND vehicle_trip_id=?', [int(req.params.expId), tripId]);
  flash(req, 'success', req.t('flash.tripExpenseDeleted'));
  res.redirect(`/vehicle-trips?trip=${tripId}`);
}));

// ─── Deliveries ───
modulesRouter.get('/deliveries', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE d.deleted_at IS NULL';
  if (search) {
    where += ' AND (d.delivery_no LIKE ? OR d.recipient_name LIKE ? OR c.name LIKE ? OR ci.name LIKE ? OR vt.trip_no LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(like(search));
  }
  const { rows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM deliveries d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN cargo_items ci ON ci.id=d.cargo_item_id LEFT JOIN vehicle_trips vt ON vt.id=d.vehicle_trip_id ${where}`,
    dataSql: `SELECT d.*, c.name customer_name, ci.name cargo_name, ci.cargo_code, vt.trip_no FROM deliveries d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN cargo_items ci ON ci.id=d.cargo_item_id LEFT JOIN vehicle_trips vt ON vt.id=d.vehicle_trip_id ${where} ORDER BY d.id DESC`,
    params, page, perPage: resolvePerPage(req),
  });
  let form = null;
  if (req.query.form === 'create') form = { delivery_no: await generateSequentialCode('deliveries', 'delivery_no', 'DLV-'), vehicle_trip_id: nullableInt(req.query.trip) || '', customer_id: '', cargo_item_id: '', delivered_at: today(), recipient_name: '', recipient_phone: '', cartons_delivered: '', weight_kg: '', status: 'delivered', notes: '' };
  if (req.query.edit) form = await one('SELECT * FROM deliveries WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  const customers = form ? await query('SELECT id, name, customer_code FROM customers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500') : [];
  const cargoItems = form ? await query('SELECT ci.id, ci.name, ci.cargo_code, c.name customer_name FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 500') : [];
  const trips = form ? await query('SELECT vt.id, vt.trip_no, v.plate_no FROM vehicle_trips vt JOIN vehicles v ON v.id=vt.vehicle_id WHERE vt.deleted_at IS NULL ORDER BY vt.id DESC LIMIT 200') : [];
  await renderPage(req, res, 'deliveries', { ...pageMeta(req, 'deliveries'), rows, pagination, search, form, editingId: form?.id ?? null, customers, cargoItems, trips });
}));

modulesRouter.post('/deliveries/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const no = text(req.body.delivery_no) || await generateSequentialCode('deliveries', 'delivery_no', 'DLV-');
  const vals = [no, nullableInt(req.body.vehicle_trip_id), nullableInt(req.body.customer_id), nullableInt(req.body.cargo_item_id), nullableText(req.body.delivered_at), nullableText(req.body.recipient_name), nullableText(req.body.recipient_phone), int(req.body.cartons_delivered, 0), n(req.body.weight_kg), text(req.body.status) || 'delivered', nullableText(req.body.notes)];
  if (id) {
    await query('UPDATE deliveries SET delivery_no=?,vehicle_trip_id=?,customer_id=?,cargo_item_id=?,delivered_at=?,recipient_name=?,recipient_phone=?,cartons_delivered=?,weight_kg=?,status=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, id]);
    flash(req, 'success', req.t('flash.deliveryUpdated'));
  } else {
    await query('INSERT INTO deliveries (delivery_no,vehicle_trip_id,customer_id,cargo_item_id,delivered_at,recipient_name,recipient_phone,cartons_delivered,weight_kg,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', vals);
    flash(req, 'success', req.t('flash.deliveryCreated'));
  }
  const cargoId = nullableInt(req.body.cargo_item_id);
  if (cargoId && text(req.body.status) === 'delivered') {
    await query("UPDATE cargo_items SET status='delivered', updated_at=NOW() WHERE id=?", [cargoId]);
  }
  res.redirect('/deliveries');
}));

modulesRouter.post('/deliveries/:id/delete', asyncRoute(async (req, res) => {
  await softDelete('deliveries', int(req.params.id));
  flash(req, 'success', req.t('flash.deliveryDeleted'));
  res.redirect('/deliveries');
}));

// ─── Partners ───
modulesRouter.get('/partners', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE deleted_at IS NULL';
  if (search) { where += ' AND (partner_code LIKE ? OR name LIKE ? OR phone LIKE ? OR email LIKE ?)'; for (let i = 0; i < 4; i++) params.push(like(search)); }
  const { rows, pagination } = await paginateQuery({ countSql: `SELECT COUNT(*) total FROM partners ${where}`, dataSql: `SELECT * FROM partners ${where} ORDER BY id DESC`, params, page, perPage: resolvePerPage(req) });
  const withdrawals = await query(`SELECT pw.*, p.name partner_name FROM partner_withdrawals pw JOIN partners p ON p.id=pw.partner_id ORDER BY pw.id DESC LIMIT 100`);
  let form = null;
  if (req.query.form === 'create') {
    const dc = getDefaultCurrency();
    form = { partner_code: await generateSequentialCode('partners', 'partner_code', 'PTR-'), name: '', phone: '', email: '', share_percent: '', amount: '', currency: dc, notes: '' };
  }
  if (req.query.edit) {
    form = await one('SELECT * FROM partners WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
    if (form) Object.assign(form, moneyFormNative(form.equity_usd, form.equity_currency));
  }
  let withdrawForm = req.query.withdraw ? { withdrawal_no: await generateSequentialCode('partner_withdrawals', 'withdrawal_no', 'WDR-'), partner_id: '', amount: '', currency: getDefaultCurrency(), withdrawal_date: today(), notes: '' } : null;
  const enabledCurrencies = getEnabledCurrencies();
  await renderPage(req, res, 'partners', { ...pageMeta(req, 'partners'), rows, pagination, search, form, editingId: form?.id ?? null, withdrawals, withdrawForm, enabledCurrencies });
}));

modulesRouter.post('/partners/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const code = text(req.body.partner_code) || await generateSequentialCode('partners', 'partner_code', 'PTR-');
  must(req.body.name, req.t('validation.partnerNameRequired'));
  const { currency, amount } = nativeMoneyFields(req.body);
  const vals = [code, text(req.body.name), nullableText(req.body.phone), nullableText(req.body.email), n(req.body.share_percent), amount, currency, nullableText(req.body.notes)];
  if (id) { await query('UPDATE partners SET partner_code=?,name=?,phone=?,email=?,share_percent=?,equity_usd=?,equity_currency=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, id]); flash(req, 'success', req.t('flash.partnerUpdated')); }
  else { await query('INSERT INTO partners (partner_code,name,phone,email,share_percent,equity_usd,equity_currency,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())', vals); flash(req, 'success', req.t('flash.partnerCreated')); }
  res.redirect('/partners');
}));

modulesRouter.post('/partners/:id/delete', asyncRoute(async (req, res) => {
  await softDelete('partners', int(req.params.id));
  flash(req, 'success', req.t('flash.partnerDeleted'));
  res.redirect('/partners');
}));

modulesRouter.post('/partners/withdrawals', asyncRoute(async (req, res) => {
  must(req.body.partner_id, req.t('validation.partnerRequired'));
  const { currency, amount, rate, amountUsd } = currencyFields(req.body);
  const no = text(req.body.withdrawal_no) || await generateSequentialCode('partner_withdrawals', 'withdrawal_no', 'WDR-');
  const r = await query('INSERT INTO partner_withdrawals (withdrawal_no,partner_id,amount,currency,rate_to_usd,amount_usd,withdrawal_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())', [no, nullableInt(req.body.partner_id), amount, currency, rate, amountUsd, nullableText(req.body.withdrawal_date) || today(), nullableText(req.body.notes)]);
  if (await hasColumn('cash_transactions', 'partner_withdrawal_id')) {
    await syncPartnerWithdrawal(r.insertId, req);
  } else {
    const box = await ensureCashBox(req);
    const partner = await one('SELECT name FROM partners WHERE id=?', [nullableInt(req.body.partner_id)]);
    const cashNo = await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-');
    const cr = await query("INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())", [box.id, cashNo, 'withdraw', req.t('sync.partnerWithdrawTitle', { name: partner?.name }), amount, currency, rate, amountUsd, nullableText(req.body.withdrawal_date) || today(), 'partner', nullableText(req.body.notes)]);
    await query('UPDATE partner_withdrawals SET cash_transaction_id=? WHERE id=?', [cr.insertId, r.insertId]);
  }
  flash(req, 'success', req.t('flash.partnerWithdrawCreated'));
  res.redirect('/partners');
}));

// ─── Salaries ───
modulesRouter.get('/salaries', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE deleted_at IS NULL';
  if (search) { where += ' AND (salary_no LIKE ? OR employee_name LIKE ? OR salary_month LIKE ? OR category LIKE ?)'; for (let i = 0; i < 4; i++) params.push(like(search)); }
  const { rows, pagination } = await paginateQuery({ countSql: `SELECT COUNT(*) total FROM salary_records ${where}`, dataSql: `SELECT * FROM salary_records ${where} ORDER BY id DESC`, params, page, perPage: resolvePerPage(req) });
  let form = null;
  if (req.query.form === 'create') form = { salary_no: await generateSequentialCode('salary_records', 'salary_no', 'SAL-'), employee_name: '', user_id: '', amount: '', currency: getDefaultCurrency(), salary_month: today().slice(0, 7), paid_date: today(), category: 'salary', notes: '' };
  if (req.query.edit) form = await one('SELECT * FROM salary_records WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  const users = form ? await query('SELECT id, name FROM users ORDER BY id DESC LIMIT 200') : [];
  const enabledCurrencies = getEnabledCurrencies();
  await renderPage(req, res, 'salaries', { ...pageMeta(req, 'salaries'), rows, pagination, search, form, editingId: form?.id ?? null, users, enabledCurrencies });
}));

modulesRouter.post('/salaries/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const no = text(req.body.salary_no) || await generateSequentialCode('salary_records', 'salary_no', 'SAL-');
  must(req.body.employee_name, req.t('validation.employeeNameRequired'));
  const { currency, amount, rate, amountUsd } = currencyFields(req.body);
  const vals = [no, text(req.body.employee_name), nullableInt(req.body.user_id), amount, currency, rate, amountUsd, nullableText(req.body.salary_month), nullableText(req.body.paid_date) || today(), text(req.body.category) || 'salary', nullableText(req.body.notes)];
  let salaryId = id;
  if (id) {
    await query('UPDATE salary_records SET salary_no=?,employee_name=?,user_id=?,amount=?,currency=?,rate_to_usd=?,amount_usd=?,salary_month=?,paid_date=?,category=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, id]);
    flash(req, 'success', req.t('flash.salaryUpdated'));
  } else {
    const r = await query('INSERT INTO salary_records (salary_no,employee_name,user_id,amount,currency,rate_to_usd,amount_usd,salary_month,paid_date,category,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', vals);
    salaryId = r.insertId;
    flash(req, 'success', req.t('flash.salaryCreated'));
  }
  await syncSalaryExpense(salaryId, req);
  res.redirect('/salaries');
}));

modulesRouter.post('/salaries/:id/delete', asyncRoute(async (req, res) => {
  const id = int(req.params.id);
  const salary = await one('SELECT expense_id FROM salary_records WHERE id=?', [id]);
  if (salary?.expense_id) {
    if (await hasColumn('cash_transactions', 'expense_id')) await query("DELETE FROM cash_transactions WHERE expense_id=? AND source_type='expense'", [salary.expense_id]);
    await softDelete('expenses', salary.expense_id);
  }
  await softDelete('salary_records', id);
  flash(req, 'success', req.t('flash.salaryDeleted'));
  res.redirect('/salaries');
}));

// ─── Vehicle P&L summary page ───
modulesRouter.get('/vehicle-profit', asyncRoute(async (req, res) => {
  const vehicles = await query('SELECT id, plate_no, vehicle_code FROM vehicles WHERE deleted_at IS NULL ORDER BY id DESC');
  const summaries = [];
  for (const v of vehicles) {
    summaries.push({ ...v, ...(await vehicleProfitLoss(v.id)) });
  }
  await renderPage(req, res, 'vehicle-profit', { ...pageMeta(req, 'vehicleProfit'), summaries });
}));
