import express from 'express';
import { hasColumn, hasTable, one, query } from '../db.js';
import { requireAuth, requirePageAccess } from '../middleware/auth.js';
import { asyncRoute, flash } from '../utils/http.js';
import { money, n, text, int } from '../utils/format.js';
import { formatMoneyUsd } from '../utils/currency.js';
import { fa, faSource, faWeight } from '../utils/labels.js';
import { loadSettings, saveSettings } from '../utils/settings.js';
import { renderPage } from '../utils/view.js';
import { resourcesRouter } from './resources.js';
import { modulesRouter } from './modules.js';
import { buildReport, reportToCsv } from '../services/reports.js';
import { requireAdmin } from '../middleware/auth.js';
import { pageMeta, createTranslator } from '../utils/i18n.js';
import { fetchCustomerReceivablesFromBilling } from '../services/cargo-billing.js';
import { vehicleDashboardStats } from '../services/vehicle-pl.js';
import { setLabelLocale } from '../utils/labels.js';
import {
  createDatabaseBackup,
  getResetConfirmPhrase,
  isValidResetConfirmPhrase,
  resetAllDatabaseData,
} from '../services/database-admin.js';
import bcrypt from 'bcryptjs';
import { photoUploadMiddleware, logoUploadMiddleware, resolveUploadedPhoto, removePhotoFile } from '../utils/upload.js';

export const pageRouter = express.Router();

const usd = (value) => formatMoneyUsd(value);

async function fetchCustomerReceivables() {
  if (await hasColumn('cargo_items', 'billing_mode')) {
    const billingData = await fetchCustomerReceivablesFromBilling();
    if (billingData.rows.length) return billingData;
  }

  if (!await hasTable('container_cargo_items')) {
    return { total: 0, rows: [] };
  }

  const paymentFilter = await hasColumn('payments', 'deleted_at') ? 'AND p.deleted_at IS NULL' : '';
  const rows = await query(`
    SELECT customer_name, freight_total, paid_total
    FROM (
      SELECT COALESCE(c.name, '') customer_name,
        COALESCE(SUM(cci.freight_share_usd), 0) freight_total,
        COALESCE((
          SELECT SUM(p.amount_usd) FROM payments p
          WHERE p.customer_id = cci.customer_id ${paymentFilter}
        ), 0) paid_total
      FROM container_cargo_items cci
      LEFT JOIN customers c ON c.id = cci.customer_id
      GROUP BY cci.customer_id, c.name
    ) receivables
    WHERE freight_total > 0
    ORDER BY (freight_total - paid_total) DESC
  `);

  const mapped = rows.map((row) => {
    const freightTotal = Number(row.freight_total || 0);
    const paidTotal = Number(row.paid_total || 0);
    const due = Math.max(freightTotal - paidTotal, 0);
    return { customer_name: row.customer_name, freight_total: freightTotal, paid_total: paidTotal, due };
  });

  return {
    total: mapped.reduce((sum, row) => sum + row.due, 0),
    rows: mapped.filter((row) => row.due > 0.004),
  };
}

async function totalPaymentsUsd() {
  if (!await hasTable('payments')) return 0;
  const payWhere = await hasColumn('payments', 'deleted_at') ? ' WHERE deleted_at IS NULL' : '';
  if (await hasColumn('payments', 'amount_usd')) {
    return Number((await one(`SELECT COALESCE(SUM(amount_usd),0) v FROM payments${payWhere}`))?.v || 0);
  }
  if (await hasColumn('payments', 'amount') && await hasColumn('payments', 'currency') && await hasColumn('payments', 'rate_to_usd')) {
    return Number((await one(`SELECT COALESCE(SUM(CASE WHEN currency='USD' THEN amount WHEN rate_to_usd IS NULL OR rate_to_usd<=0 THEN 0 ELSE amount/rate_to_usd END),0) v FROM payments${payWhere}`))?.v || 0);
  }
  return 0;
}

pageRouter.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));
pageRouter.use(requireAuth);
pageRouter.use(requirePageAccess);
pageRouter.use(resourcesRouter);
pageRouter.use(modulesRouter);

const expenseExpression = async () => {
  if (!await hasTable('expenses')) return '0';
  if (await hasColumn('expenses', 'amount') && await hasColumn('expenses', 'currency') && await hasColumn('expenses', 'rate_to_usd')) {
    return "CASE WHEN currency='USD' THEN amount WHEN rate_to_usd IS NULL OR rate_to_usd<=0 THEN 0 ELSE amount/rate_to_usd END";
  }
  if (await hasColumn('expenses', 'amount_usd')) return 'amount_usd';
  return '0';
};

async function dashboardData() {
  const result = {
    containersInTransit: 0, companyExpenses: 0, overheadExpenses: 0, profitLoss: 0,
    cashBalance: 0, arrivedNotDelivered: 0, receivables: 0, payables: 0, totalFreight: 0,
    activeVehicles: 0, tripsInTransit: 0, vehicleFreight: 0, vehicleTripExpenses: 0, vehicleProfit: 0,
  };

  if (await hasTable('shipping_containers')) {
    if (await hasColumn('shipping_containers', 'status')) {
      result.containersInTransit = Number((await one("SELECT COUNT(*) c FROM shipping_containers WHERE deleted_at IS NULL AND status IN ('loading','in_transit','on_ship','at_sea','in_route','hairatan','mazar')"))?.c || 0);
    }
    if (await hasColumn('shipping_containers', 'freight_usd')) {
      result.totalFreight = Number((await one('SELECT COALESCE(SUM(freight_usd),0) v FROM shipping_containers WHERE deleted_at IS NULL'))?.v || 0);
    }
  }

  const exp = await expenseExpression();
  if (await hasTable('expenses')) {
    if (await hasColumn('expenses', 'scope')) {
      const row = await one(`SELECT
        COALESCE(SUM(CASE WHEN scope='company' THEN ${exp} ELSE 0 END),0) company_total,
        COALESCE(SUM(CASE WHEN scope='cargo' THEN ${exp} ELSE 0 END),0) cargo_total,
        COALESCE(SUM(CASE WHEN scope='container' THEN ${exp} ELSE 0 END),0) container_total
        FROM expenses WHERE deleted_at IS NULL`);
      result.companyExpenses = Number(row?.company_total || 0);
      result.overheadExpenses = Number(row?.cargo_total || 0) + Number(row?.container_total || 0);
    } else {
      result.companyExpenses = Number((await one(`SELECT COALESCE(SUM(${exp}),0) v FROM expenses WHERE deleted_at IS NULL`))?.v || 0);
    }

    if (await hasColumn('expenses', 'paid_amount_usd')) {
      result.payables = Number((await one(`SELECT COALESCE(SUM(GREATEST((${exp})-paid_amount_usd,0)),0) v FROM expenses WHERE deleted_at IS NULL`))?.v || 0);
    } else if (await hasColumn('expenses', 'status')) {
      result.payables = Number((await one(`SELECT COALESCE(SUM(${exp}),0) v FROM expenses WHERE deleted_at IS NULL AND status IN ('unpaid','pending','partial')`))?.v || 0);
    }
  }

  if (await hasTable('cargo_locations') && await hasColumn('cargo_locations', 'cost_usd')) {
    result.overheadExpenses += Number((await one('SELECT COALESCE(SUM(cost_usd),0) v FROM cargo_locations'))?.v || 0);
  }

  if (await hasTable('cash_boxes')) {
    const opening = Number((await one('SELECT COALESCE(SUM(opening_balance),0) v FROM cash_boxes'))?.v || 0);
    result.cashBalance = opening;
    if (await hasTable('cash_transactions') && await hasColumn('cash_transactions', 'amount_usd')) {
      const row = await one(`SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount_usd ELSE 0 END),0) income_total,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount_usd ELSE 0 END),0) expense_total,
        COALESCE(SUM(CASE WHEN type='withdraw' THEN amount_usd ELSE 0 END),0) withdraw_total,
        COALESCE(SUM(CASE WHEN type='adjustment' THEN amount_usd ELSE 0 END),0) adjustment_total
        FROM cash_transactions`);
      result.cashBalance += Number(row?.income_total || 0) - Number(row?.expense_total || 0) - Number(row?.withdraw_total || 0) + Number(row?.adjustment_total || 0);
    }
  }

  if (await hasTable('cargo_items') && await hasColumn('cargo_items', 'status')) {
    result.arrivedNotDelivered = Number((await one("SELECT COUNT(*) c FROM cargo_items WHERE deleted_at IS NULL AND status IN ('arrived','at_destination','kabul_warehouse','in_kabul_warehouse','ready_for_delivery')"))?.c || 0);
  }

  const receivableData = await fetchCustomerReceivables();
  if (receivableData.rows.length || await hasTable('container_cargo_items')) {
    result.receivables = receivableData.total;
    result.receivableRows = receivableData.rows;
  } else {
    const paid = await totalPaymentsUsd();
    result.receivables = Math.max(result.totalFreight - paid, 0);
    result.receivableRows = result.receivables > 0
      ? [{ customer_name: '', freight_total: result.totalFreight, paid_total: paid, due: result.receivables }]
      : [];
  }

  result.profitLoss = result.totalFreight - result.companyExpenses - result.overheadExpenses;

  const vehicleStats = await vehicleDashboardStats();
  Object.assign(result, vehicleStats);

  return result;
}

async function dashboardDetails(type, data, locale = 'fa') {
  const t = createTranslator(locale);
  setLabelLocale(locale);
  const c = (...keys) => keys.map((k) => t(`reportCols.${k}`));
  const out = { title: '', subtitle: '', columns: [], rows: [] };
  if (!type) return out;

  if (type === 'containers_in_transit') {
    out.title = t('dashboardDetail.containersInTransit.title');
    out.subtitle = t('dashboardDetail.containersInTransit.subtitle');
    out.columns = c('containerNo', 'ship', 'origin', 'destination', 'currentLocation', 'status', 'freight');
    if (await hasTable('shipping_containers')) {
      const rows = await query("SELECT * FROM shipping_containers WHERE deleted_at IS NULL AND status IN ('loading','in_transit','on_ship','at_sea','in_route','hairatan','mazar') ORDER BY id DESC LIMIT 100");
      out.rows = rows.map(r => [r.container_no||'-',r.ship_name||'-',r.origin||'-',r.destination||'-',r.current_location||'-',fa(r.status),usd(r.freight_usd)]);
    }
  } else if (type === 'company_expenses') {
    out.title = t('dashboardDetail.companyExpenses.title'); out.subtitle = t('dashboardDetail.companyExpenses.subtitle');
    out.columns = c('number', 'title', 'category', 'amount', 'currency', 'usdEquivalent', 'date').concat([t('fields.notes')]);
    if(await hasTable('expenses')) { const exp=await expenseExpression(); const rows=await query(`SELECT *,${exp} calc_amount_usd FROM expenses WHERE deleted_at IS NULL ${await hasColumn('expenses','scope')?"AND scope='company'":''} ORDER BY id DESC LIMIT 100`); out.rows=rows.map(r=>[r.expense_no||'-',r.title||'-',r.category||'-',Number(r.amount||0).toFixed(2),fa(r.currency||'USD'),usd(r.calc_amount_usd??r.amount_usd),r.expense_date||r.created_at||'-',r.notes||'-']); }
  } else if (type === 'overhead_expenses') {
    out.title = t('dashboardDetail.overheadExpenses.title'); out.subtitle = t('dashboardDetail.overheadExpenses.subtitle');
    out.columns = [t('fields.type'), t('fields.refNo'), t('fields.title'), t('fields.amount'), t('fields.currency'), t('fields.usdEquivalent'), t('fields.date'), t('fields.notes')];
    if(await hasTable('expenses')) { const exp=await expenseExpression(); const rows=await query(`SELECT *,${exp} calc_amount_usd FROM expenses WHERE deleted_at IS NULL ${await hasColumn('expenses','scope')?"AND scope IN ('cargo','container')":''} ORDER BY id DESC LIMIT 100`); out.rows.push(...rows.map(r=>{const route=(r.route_from&&r.route_to)?`از ${r.route_from} به ${r.route_to}`:(r.route_to?`به ${r.route_to}`:(r.route_from?`از ${r.route_from}`:''));const title=route?(r.title?`${r.title} (${route})`:route):(r.title||'-');return[r.scope==='cargo'?t('dashboardDetail.cargoOverhead'):t('dashboardDetail.containerOverhead'),r.expense_no||'-',title,Number(r.amount||0).toFixed(2),fa(r.currency||'USD'),usd(r.calc_amount_usd??r.amount_usd),r.expense_date||r.created_at||'-',r.notes||'-'];})); }
    if(await hasTable('cargo_locations')&&await hasColumn('cargo_locations','cost_usd')) { const rows=await query('SELECT * FROM cargo_locations ORDER BY id DESC LIMIT 100'); out.rows.push(...rows.map(r=>[t('dashboardDetail.routeCost'),fa(r.stage),r.location_name||'-',Number(r.cost_usd||0).toFixed(2),fa('USD'),usd(r.cost_usd),r.arrived_at||r.created_at||'-',r.notes||'-'])); }
  } else if (type === 'profit_source') {
    out.title = t('dashboardDetail.profitSource.title');
    out.subtitle = t('dashboardDetail.profitSource.subtitle');
    out.columns = c('containerNo', 'ship', 'origin', 'destination', 'freight');
    if (await hasTable('shipping_containers')) {
      const rows = await query('SELECT container_no, ship_name, origin, destination, freight_usd FROM shipping_containers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 100');
      out.rows = rows.map((row) => [
        row.container_no || '-',
        row.ship_name || '-',
        row.origin || '-',
        row.destination || '-',
        usd(row.freight_usd),
      ]);
    }
    if (data.totalFreight > 0) {
      out.rows.push([t('dashboardDetail.totalContainerFreight'), '-', '-', '-', usd(data.totalFreight)]);
    }
  } else if (type === 'profit_loss') {
    out.title = data.profitLoss>=0 ? t('dashboardDetail.profitDetails.title') : t('dashboardDetail.lossDetails.title');
    out.subtitle = t('dashboardDetail.profitDetails.subtitle');
    out.columns = c('title', 'type', 'amount');
    out.rows=[[t('dashboardDetail.totalContainerFreight'),t('dashboardDetail.income'),usd(data.totalFreight)],[t('dashboardDetail.totalCompanyExpenses'),t('dashboardDetail.expense'),usd(data.companyExpenses)],[t('dashboardDetail.totalOverhead'),t('dashboardDetail.expense'),usd(data.overheadExpenses)],[data.profitLoss>=0?t('dashboardDetail.finalProfit'):t('dashboardDetail.finalLoss'),t('dashboardDetail.result'),usd(Math.abs(data.profitLoss))]];
  } else if (type === 'cash_balance') {
    out.title = t('dashboardDetail.cashBalance.title'); out.subtitle = t('dashboardDetail.cashBalance.subtitle');
    out.columns = c('transactionNo', 'type', 'title', 'amount', 'currency', 'usdEquivalent', 'date', 'source');
    if(await hasTable('cash_transactions')) {const rows=await query('SELECT * FROM cash_transactions ORDER BY id DESC LIMIT 100'); out.rows=rows.map(r=>[r.transaction_no||'-',fa(r.type),r.title||'-',Number(r.amount||0).toFixed(2),fa(r.currency||'USD'),usd(r.amount_usd),r.transaction_date||r.created_at||'-',faSource(r.source_type||'manual')]);}
  } else if (type === 'arrived_not_delivered') {
    out.title = t('dashboardDetail.arrivedNotDelivered.title'); out.subtitle = t('dashboardDetail.arrivedNotDelivered.subtitle');
    out.columns = c('cargoCode', 'cargoName', 'customer', 'cartons', 'cbm', 'weight', 'status');
    if(await hasTable('cargo_items')) {const rows=await query("SELECT ci.*,c.name customer_name FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL AND ci.status IN ('arrived','at_destination','kabul_warehouse','in_kabul_warehouse','ready_for_delivery') ORDER BY ci.id DESC LIMIT 100");out.rows=rows.map(r=>[r.cargo_code||'-',r.name||'-',r.customer_name||'-',Number(r.carton_count||0).toLocaleString(),Number(r.total_cbm||0).toFixed(4),faWeight(r.gross_weight_kg),fa(r.status)]);}
  } else if (type === 'receivables') {
    out.title = t('dashboardDetail.receivables.title'); out.subtitle = t('dashboardDetail.receivables.subtitle');
    out.columns = [t('fields.customer'), t('dashboardDetail.freightReceivable'), t('dashboardDetail.paid'), t('fields.remaining'), t('dashboardDetail.explanation')];
    const receivableRows = data.receivableRows ?? (await fetchCustomerReceivables()).rows;
    out.rows = receivableRows.map((row) => [
      row.customer_name || t('fields.noCustomer'),
      usd(row.freight_total),
      usd(row.paid_total),
      usd(row.due),
      t('dashboardDetail.freightShareNote'),
    ]);
  } else if (type === 'payables') {
    out.title = t('dashboardDetail.payables.title'); out.subtitle = t('dashboardDetail.payables.subtitle');
    out.columns = [t('fields.title'), t('fields.category'), t('dashboardDetail.remainingAmount')];
    if (data.payables > 0 && await hasTable('expenses')) {
      const exp = await expenseExpression();
      const hasPaidColumn = await hasColumn('expenses', 'paid_amount_usd');
      const rows = await query(`SELECT *, ${exp} calc_amount_usd FROM expenses WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 200`);
      out.rows = rows
        .map((row) => {
          const total = Number(row.calc_amount_usd ?? row.amount_usd ?? 0);
          const paid = hasPaidColumn ? Number(row.paid_amount_usd || 0) : 0;
          const remaining = Math.max(total - paid, 0);
          return { row, remaining };
        })
        .filter((item) => item.remaining > 0.004)
        .map(({ row, remaining }) => [row.title || '-', row.category || '-', usd(remaining)]);
    }
  } else if (type === 'active_vehicles') {
    out.title = t('dashboardDetail.activeVehicles.title');
    out.subtitle = t('dashboardDetail.activeVehicles.subtitle');
    out.columns = [t('fields.plateNo'), t('fields.codeShort'), t('fields.vehicleType'), t('fields.driver'), t('fields.capacityKg'), t('fields.status')];
    if (await hasTable('vehicles')) {
      const rows = await query(`
        SELECT vehicle_code, plate_no, vehicle_type, default_driver_name, capacity_kg, status
        FROM vehicles WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 100
      `);
      out.rows = rows.map((r) => [
        r.plate_no || '-',
        r.vehicle_code || '-',
        fa(r.vehicle_type || 'truck'),
        r.default_driver_name || '-',
        faWeight(r.capacity_kg),
        fa(r.status || 'active'),
      ]);
    }
  } else if (type === 'trips_in_transit') {
    out.title = t('dashboardDetail.tripsInTransit.title');
    out.subtitle = t('dashboardDetail.tripsInTransit.subtitle');
    out.columns = c('tripNo', 'plate', 'origin', 'destination', 'driver', 'status', 'freight', 'weight');
    if (await hasTable('vehicle_trips')) {
      const rows = await query(`
        SELECT vt.trip_no, v.plate_no, vt.origin, vt.destination, vt.driver_name, vt.status, vt.freight_usd, vt.total_weight_kg
        FROM vehicle_trips vt
        JOIN vehicles v ON v.id = vt.vehicle_id
        WHERE vt.deleted_at IS NULL AND vt.status NOT IN ('delivered', 'cancelled')
        ORDER BY vt.id DESC LIMIT 100
      `);
      out.rows = rows.map((r) => [
        r.trip_no || '-',
        r.plate_no || '-',
        r.origin || '-',
        r.destination || '-',
        r.driver_name || '-',
        fa(r.status),
        usd(r.freight_usd),
        faWeight(r.total_weight_kg),
      ]);
    }
  } else if (type === 'vehicle_freight') {
    out.title = t('dashboardDetail.vehicleFreight.title');
    out.subtitle = t('dashboardDetail.vehicleFreight.subtitle');
    out.columns = c('tripNo', 'plate', 'origin', 'destination', 'status', 'freight', 'weight');
    if (await hasTable('vehicle_trips')) {
      const rows = await query(`
        SELECT vt.trip_no, v.plate_no, vt.origin, vt.destination, vt.status, vt.freight_usd, vt.total_weight_kg
        FROM vehicle_trips vt
        JOIN vehicles v ON v.id = vt.vehicle_id
        WHERE vt.deleted_at IS NULL
        ORDER BY vt.id DESC LIMIT 100
      `);
      out.rows = rows.map((r) => [
        r.trip_no || '-',
        r.plate_no || '-',
        r.origin || '-',
        r.destination || '-',
        fa(r.status),
        usd(r.freight_usd),
        faWeight(r.total_weight_kg),
      ]);
      if (data.vehicleFreight > 0) {
        out.rows.push([t('dashboardDetail.totalVehicleFreight'), '-', '-', '-', '-', usd(data.vehicleFreight), '-']);
      }
    }
  } else if (type === 'vehicle_trip_expenses') {
    out.title = t('dashboardDetail.vehicleTripExpenses.title');
    out.subtitle = t('dashboardDetail.vehicleTripExpenses.subtitle');
    out.columns = c('tripNo', 'plate', 'title', 'stage', 'amount', 'currency', 'usdEquivalent', 'date');
    if (await hasTable('vehicle_trip_expenses')) {
      const rows = await query(`
        SELECT vt.trip_no, v.plate_no, vte.title, vte.stage, vte.amount, vte.currency, vte.amount_usd, vte.expense_date
        FROM vehicle_trip_expenses vte
        JOIN vehicle_trips vt ON vt.id = vte.vehicle_trip_id AND vt.deleted_at IS NULL
        JOIN vehicles v ON v.id = vt.vehicle_id
        ORDER BY vte.id DESC LIMIT 100
      `);
      out.rows = rows.map((r) => [
        r.trip_no || '-',
        r.plate_no || '-',
        r.title || '-',
        fa(r.stage),
        Number(r.amount || 0).toFixed(2),
        fa(r.currency || 'USD'),
        usd(r.amount_usd),
        r.expense_date || '-',
      ]);
    }
  } else if (type === 'vehicle_profit') {
    out.title = data.vehicleProfit >= 0 ? t('dashboardDetail.vehicleProfit.title') : t('dashboardDetail.vehicleLoss.title');
    out.subtitle = t('dashboardDetail.vehicleProfit.subtitle');
    out.columns = c('plate', 'tripCount', 'income', 'expenses', 'profit');
    if (await hasTable('vehicles') && await hasTable('vehicle_trips')) {
      const hasTripExpenses = await hasTable('vehicle_trip_expenses');
      const expenseSub = hasTripExpenses ? `COALESCE((
        SELECT SUM(vte.amount_usd)
        FROM vehicle_trip_expenses vte
        JOIN vehicle_trips vt2 ON vt2.id = vte.vehicle_trip_id AND vt2.deleted_at IS NULL
        WHERE vt2.vehicle_id = v.id
      ), 0)` : '0';
      const rows = await query(`
        SELECT v.plate_no, v.vehicle_code,
          COUNT(DISTINCT vt.id) trip_count,
          COALESCE(SUM(vt.freight_usd), 0) income,
          ${expenseSub} expenses
        FROM vehicles v
        LEFT JOIN vehicle_trips vt ON vt.vehicle_id = v.id AND vt.deleted_at IS NULL
        WHERE v.deleted_at IS NULL
        GROUP BY v.id, v.plate_no, v.vehicle_code
        ORDER BY income DESC
        LIMIT 100
      `);
      out.rows = rows.map((row) => {
        const income = Number(row.income || 0);
        const expenses = Number(row.expenses || 0);
        return [
          `${row.plate_no || '-'} (${row.vehicle_code || '-'})`,
          Number(row.trip_count || 0).toLocaleString(),
          usd(income),
          usd(expenses),
          usd(income - expenses),
        ];
      });
      if (data.vehicleFreight > 0 || data.vehicleTripExpenses > 0) {
        out.rows.push([
          t('dashboardDetail.totalVehicleSummary'),
          '-',
          usd(data.vehicleFreight),
          usd(data.vehicleTripExpenses),
          usd(data.vehicleProfit),
        ]);
      }
    }
  }
  return out;
}

pageRouter.get('/dashboard', asyncRoute(async (req, res) => {
  const data = await dashboardData();
  const detailType = text(req.query.detail);
  const details = detailType ? await dashboardDetails(detailType, data, req.locale) : null;
  await renderPage(req, res, 'dashboard', { ...pageMeta(req, 'dashboard'), ...data, details, detailType });
}));

pageRouter.post('/dashboard/refresh', (req, res) => {
  flash(req, 'success', req.t('flash.dashboardRefreshed'));
  res.redirect('/dashboard');
});

pageRouter.get('/introductions', asyncRoute(async (req, res) => renderPage(req, res, 'introductions', pageMeta(req, 'introductions'))));

pageRouter.get('/profile', asyncRoute(async (req, res) => {
  const form = await one('SELECT id, name, email, role, photo_path FROM users WHERE id=? LIMIT 1', [req.user.id]);
  await renderPage(req, res, 'profile', { ...pageMeta(req, 'profile'), form });
}));

pageRouter.post('/profile/save', photoUploadMiddleware('users', '/profile'), asyncRoute(async (req, res) => {
  const name = text(req.body.name);
  const password = String(req.body.password || '');
  must(name, req.t('validation.nameRequired'));
  const hasPhoto = await hasColumn('users', 'photo_path');
  const existing = hasPhoto ? await one('SELECT photo_path FROM users WHERE id=? LIMIT 1', [req.user.id]) : null;
  const photoPath = hasPhoto ? resolveUploadedPhoto(req, 'users', existing?.photo_path ?? null) : null;
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    if (hasPhoto) {
      await query('UPDATE users SET name=?, password=?, photo_path=?, updated_at=NOW() WHERE id=?', [name, hash, photoPath, req.user.id]);
    } else {
      await query('UPDATE users SET name=?, password=?, updated_at=NOW() WHERE id=?', [name, hash, req.user.id]);
    }
  } else if (hasPhoto) {
    await query('UPDATE users SET name=?, photo_path=?, updated_at=NOW() WHERE id=?', [name, photoPath, req.user.id]);
  } else {
    await query('UPDATE users SET name=?, updated_at=NOW() WHERE id=?', [name, req.user.id]);
  }
  flash(req, 'success', req.t('flash.profileUpdated'));
  res.redirect('/profile');
}));

function must(valueToCheck, message) {
  if (text(valueToCheck) === '') throw new Error(message);
}

pageRouter.get('/reports-hub', asyncRoute(async (req, res) => renderPage(req, res, 'reports-hub', pageMeta(req, 'reportsHub'))));
pageRouter.get('/settings', asyncRoute(async (req, res) => renderPage(req, res, 'settings', {
  ...pageMeta(req, 'settings'),
  settings: loadSettings(),
  resetConfirmPhrase: getResetConfirmPhrase(),
})));
pageRouter.post('/settings', logoUploadMiddleware('/settings'), asyncRoute(async (req, res) => {
  const current = loadSettings();
  let logoPath = current.logoPath || '';
  if (req.body.removeLogo === '1') {
    removePhotoFile(logoPath);
    logoPath = '';
  } else {
    logoPath = resolveUploadedPhoto(req, 'settings', logoPath);
  }
  const enabled = [];
  for (const code of ['USD', 'AFN', 'CNY', 'PKR', 'EUR', 'IRR']) {
    if (req.body[`currency_${code}`] === '1') enabled.push(code);
  }
  const rates = {};
  for (const code of ['USD', 'AFN', 'CNY', 'PKR', 'EUR', 'IRR']) {
    if (req.body[`rate_${code}`] !== undefined && req.body[`rate_${code}`] !== '') {
      rates[code] = Number(req.body[`rate_${code}`]);
    }
  }
  saveSettings({
    systemName: text(req.body.systemName),
    systemSubtitle: text(req.body.systemSubtitle),
    companyName: text(req.body.companyName),
    companyPhone: text(req.body.companyPhone),
    companyEmail: text(req.body.companyEmail),
    companyAddress: text(req.body.companyAddress),
    invoiceFooter: text(req.body.invoiceFooter),
    defaultCurrency: text(req.body.defaultCurrency),
    enabledCurrencies: enabled,
    currencyRates: rates,
    recordsPerPage: int(req.body.recordsPerPage, 15),
    codeDigits: int(req.body.codeDigits, 6),
    printFormat: text(req.body.printFormat),
    logoPath,
  });
  flash(req, 'success', req.t('flash.settingsSaved'));
  res.redirect('/settings');
}));

pageRouter.get('/settings/backup', requireAdmin, asyncRoute(async (req, res) => {
  const sql = await createDatabaseBackup();
  const filename = `baskol-backup-${new Date().toISOString().slice(0, 10)}.sql`;
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${sql}`);
}));

pageRouter.post('/settings/reset-database', requireAdmin, asyncRoute(async (req, res) => {
  if (!isValidResetConfirmPhrase(req.body.confirmPhrase)) {
    flash(req, 'error', req.t('flash.resetPhraseInvalid', { phrase: getResetConfirmPhrase() }));
    return res.redirect('/settings#database');
  }

  await resetAllDatabaseData(req.user.id);
  flash(req, 'success', req.t('flash.databaseReset'));
  res.redirect('/settings#database');
}));

pageRouter.get('/reports', asyncRoute(async (req, res) => {
  const type = text(req.query.type) || 'overview';
  const from = text(req.query.from);
  const to = text(req.query.to);
  const customerId = int(req.query.customer_id, 0) || null;
  const scope = text(req.query.scope);
  const category = text(req.query.category);
  const cashType = text(req.query.cash_type);
  const search = text(req.query.search);
  const report = await buildReport(type, {
    from, to, customerId, locale: req.locale, scope, category, cashType, search,
  });

  await renderPage(req, res, 'reports', {
    title: report.title,
    subtitle: report.subtitle,
    report,
    reportType: report.type,
    from,
    to,
    customerId,
    scope,
    category,
    cashType,
    search,
  });
}));

pageRouter.get('/reports/export', asyncRoute(async (req, res) => {
  const type = text(req.query.type) || 'overview';
  const from = text(req.query.from);
  const to = text(req.query.to);
  const customerId = int(req.query.customer_id, 0) || null;
  const scope = text(req.query.scope);
  const category = text(req.query.category);
  const cashType = text(req.query.cash_type);
  const search = text(req.query.search);
  const report = await buildReport(type, {
    from, to, customerId, locale: req.locale, scope, category, cashType, search,
  });
  const csv = reportToCsv(report);
  const filename = `report-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));
