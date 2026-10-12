import { hasColumn, hasTable, one, query } from '../db.js';
import { money, n } from '../utils/format.js';
import { formatMoneyUsd } from '../utils/currency.js';
import { fa, faSource, faStage, faTransport, faWeight, localizeStoredTitle, setLabelLocale } from '../utils/labels.js';
import { createTranslator } from '../utils/i18n.js';
import { vehicleProfitLoss } from './vehicle-pl.js';
import { fetchCustomerReceivablesFromBilling } from './cargo-billing.js';
import { buildCustomerAccountReport } from './customer-account-report.js';

const usd = (value) => formatMoneyUsd(value);

let reportT = createTranslator('fa');
const rc = (...keys) => keys.map((k) => reportT(`reportCols.${k}`));
const rt = (key, vars) => reportT(key, vars);

const REPORT_I18N_KEYS = {
  overview: 'overview',
  location: 'location',
  expenses: 'expenses',
  payments: 'payments',
  cashbox: 'cashbox',
  containers: 'containers',
  loading: 'loading',
  weighbridge: 'weighbridge',
  cargo: 'cargo',
  'profit-loss': 'profitLoss',
  invoice: 'invoice',
  'customer-accounts': 'customerAccounts',
  'vehicle-trips': 'vehicleTrips',
  deliveries: 'deliveries',
  partners: 'partners',
  salaries: 'salaries',
  'vehicle-profit': 'vehicleProfit',
};

function reportMeta(type, locale) {
  const t = createTranslator(locale);
  const key = REPORT_I18N_KEYS[type] || 'overview';
  return {
    title: t(`reportsHub.${key}.title`),
    subtitle: t(`reportsHub.${key}.desc`),
  };
}

async function expenseExpression() {
  if (!await hasTable('expenses')) return '0';
  if (await hasColumn('expenses', 'amount_usd')) return 'amount_usd';
  if (await hasColumn('expenses', 'amount') && await hasColumn('expenses', 'currency') && await hasColumn('expenses', 'rate_to_usd')) {
    return "CASE WHEN currency='USD' THEN amount WHEN rate_to_usd IS NULL OR rate_to_usd<=0 THEN 0 ELSE amount/rate_to_usd END";
  }
  return '0';
}

function dateFilter(alias, from, to, params) {
  let sql = '';
  if (from) { sql += ` AND DATE(${alias}.created_at)>=?`; params.push(from); }
  if (to) { sql += ` AND DATE(${alias}.created_at)<=?`; params.push(to); }
  return sql;
}

function expenseViaText(r) {
  if (r.scope === 'vehicle_trip') return `${rt('expenseVia.vehicleTrip')} — ${r.trip_no || '-'} / ${r.plate_no || '-'}`;
  if (r.scope === 'container') return `${rt('expenseVia.container')} — ${r.container_no || '-'}`;
  if (r.scope === 'cargo') {
    const ref = [r.cargo_code, r.customer_name].filter(Boolean).join(' / ');
    return ref ? `${rt('expenseVia.cargo')} — ${ref}` : rt('expenseVia.cargo');
  }
  return rt('expenseVia.company');
}

function cashboxFlowLabel(type) {
  if (type === 'income' || type === 'adjustment') return rt('expenseVia.cashboxIn');
  return rt('expenseVia.cashbox');
}

function expenseDateFilter(alias, from, to, params) {
  let sql = '';
  if (from) { sql += ` AND DATE(COALESCE(${alias}.expense_date, ${alias}.created_at))>=?`; params.push(from); }
  if (to) { sql += ` AND DATE(COALESCE(${alias}.expense_date, ${alias}.created_at))<=?`; params.push(to); }
  return sql;
}

export const REPORT_TYPES = Object.fromEntries(Object.keys(REPORT_I18N_KEYS).map((k) => [k, {}]));

export async function buildReport(type, filters = {}) {
  const from = filters.from || '';
  const to = filters.to || '';
  const customerId = filters.customerId || null;
  reportT = createTranslator(filters.locale || 'fa');
  setLabelLocale(filters.locale || 'fa');
  const resolvedType = REPORT_I18N_KEYS[type] ? type : 'overview';
  const resolvedMeta = reportMeta(resolvedType, filters.locale);

  const report = {
    type: resolvedType,
    title: resolvedMeta.title,
    subtitle: resolvedMeta.subtitle,
    columns: [],
    rows: [],
    stats: [],
    sections: [],
    invoice: null,
    customers: [],
    from,
    to,
    locale: filters.locale || 'fa',
    scope: filters.scope || '',
    category: filters.category || '',
    cashType: filters.cashType || '',
    search: filters.search || '',
    customerId: filters.customerId || null,
  };

  if (type === 'overview' || !REPORT_TYPES[type]) return buildOverview(report, from, to);
  if (type === 'location') return buildLocation(report, from, to);
  if (type === 'expenses') return buildExpenses(report, from, to, report.scope, report.category);
  if (type === 'payments') return buildPayments(report, from, to);
  if (type === 'cashbox') return buildCashbox(report, from, to, report.cashType);
  if (type === 'containers') return buildContainers(report, from, to);
  if (type === 'loading') return buildLoading(report, from, to);
  if (type === 'weighbridge') return buildWeighbridge(report, from, to);
  if (type === 'cargo') return buildCargo(report, from, to);
  if (type === 'profit-loss') return buildProfitLoss(report, from, to);
  if (type === 'invoice') return buildInvoice(report, customerId);
  if (type === 'customer-accounts') return buildCustomerAccounts(report, customerId, report.search, from, to);
  if (type === 'vehicle-trips') return buildVehicleTrips(report, from, to);
  if (type === 'deliveries') return buildDeliveries(report, from, to);
  if (type === 'partners') return buildPartners(report, from, to);
  if (type === 'salaries') return buildSalaries(report, from, to);
  if (type === 'vehicle-profit') return buildVehicleProfit(report);
  return buildOverview(report, from, to);
}

async function buildOverview(report, from, to) {
  const p = [];
  let cargo = { cargo_count: 0, total_cartons: 0, total_cbm: 0 };
  let ticket = { total_weight: 0 };
  let container = { containers: 0, freight: 0 };
  let expense = { company_expenses: 0, cargo_expenses: 0, container_expenses: 0, trip_expenses: 0 };

  if (await hasTable('cargo_items')) {
    cargo = { ...cargo, ...(await one(`SELECT COUNT(*) cargo_count, COALESCE(SUM(carton_count),0) total_cartons, COALESCE(SUM(total_cbm),0) total_cbm FROM cargo_items ci WHERE ci.deleted_at IS NULL${dateFilter('ci', from, to, p)}`, p)) };
  }
  if (await hasTable('weighbridge_tickets')) {
    const weight = await hasColumn('weighbridge_tickets', 'net_weight_kg') ? 'net_weight_kg' : '0';
    ticket = { ...ticket, ...(await one(`SELECT COALESCE(SUM(${weight}),0) total_weight FROM weighbridge_tickets wt WHERE wt.deleted_at IS NULL${dateFilter('wt', from, to, p)}`, p)) };
  }
  if (await hasTable('shipping_containers')) {
    container = { ...container, ...(await one(`SELECT COUNT(*) containers, COALESCE(SUM(freight_usd),0) freight FROM shipping_containers sc WHERE sc.deleted_at IS NULL${dateFilter('sc', from, to, p)}`, p)) };
  }
  if (await hasTable('expenses')) {
    const exp = await expenseExpression();
    const p2 = [...p];
    expense = { ...expense, ...(await one(`SELECT COALESCE(SUM(CASE WHEN scope='company' THEN ${exp} ELSE 0 END),0) company_expenses, COALESCE(SUM(CASE WHEN scope='cargo' THEN ${exp} ELSE 0 END),0) cargo_expenses, COALESCE(SUM(CASE WHEN scope='container' THEN ${exp} ELSE 0 END),0) container_expenses, COALESCE(SUM(CASE WHEN scope='vehicle_trip' THEN ${exp} ELSE 0 END),0) trip_expenses FROM expenses e WHERE e.deleted_at IS NULL${expenseDateFilter('e', from, to, p2)}`, p2)) };
  }
  const tripExpenses = n(expense.trip_expenses);

  report.stats = [
    { label: rt('reportStats.cargoCount'), value: Number(cargo.cargo_count || 0).toLocaleString() },
    { label: rt('reportStats.cartonCount'), value: Number(cargo.total_cartons || 0).toLocaleString() },
    { label: rt('reportStats.totalCbm'), value: Number(cargo.total_cbm || 0).toFixed(4) },
    { label: rt('reportStats.netWeight'), value: faWeight(ticket.total_weight) },
    { label: rt('reportStats.containerCount'), value: Number(container.containers || 0).toLocaleString() },
    { label: rt('reportStats.totalFreight'), value: usd(container.freight) },
    { label: rt('reportStats.companyExpenses'), value: usd(expense.company_expenses) },
    { label: rt('reportStats.cargoExpenses'), value: usd(expense.cargo_expenses) },
    { label: rt('reportStats.containerExpenses'), value: usd(expense.container_expenses) },
    { label: rt('reportStats.tripExpenses'), value: usd(tripExpenses) },
  ];

  if (await hasTable('shipping_containers')) {
    const p3 = [];
    const rows = await query(`SELECT sc.*, (SELECT COUNT(*) FROM container_cargo_items x WHERE x.shipping_container_id=sc.id) items_count FROM shipping_containers sc WHERE sc.deleted_at IS NULL${dateFilter('sc', from, to, p3)} ORDER BY sc.id DESC LIMIT 100`, p3);
    report.sections.push({
      title: rt('reportCols.latestContainers'),
      columns: rc('containerNo', 'ship', 'origin', 'destination', 'status', 'loadedVolume', 'freight', 'itemCount'),
      rows: rows.map((r) => [r.container_no, r.ship_name || '-', r.origin || '-', r.destination || '-', fa(r.status), Number(r.total_loaded_cbm || 0).toFixed(4), usd(r.freight_usd), String(r.items_count || 0)]),
    });
  }

  if (await hasTable('expenses')) {
    const exp = await expenseExpression();
    const p4 = [];
    const rows = await query(`SELECT scope, COALESCE(SUM(${exp}),0) total FROM expenses e WHERE e.deleted_at IS NULL${expenseDateFilter('e', from, to, p4)} GROUP BY scope`, p4);
    report.sections.push({
      title: rt('reportCols.expensesByType'),
      columns: rc('expenseType', 'amount'),
      rows: rows.map((r) => [fa(r.scope), usd(r.total)]),
    });
  }

  return report;
}

async function buildLocation(report, from, to) {
  report.columns = rc('cargoCode', 'cargoName', 'customer', 'cargoStatus', 'container', 'currentLocation', 'destination', 'lastStage', 'lastLocation');

  if (await hasTable('cargo_items')) {
    const p = [];
    const rows = await query(`
      SELECT ci.cargo_code, ci.name cargo_name, ci.status cargo_status, c.name customer_name,
        sc.container_no, sc.current_location, sc.destination,
        (SELECT cl.location_name FROM cargo_locations cl WHERE cl.cargo_item_id=ci.id OR cl.shipping_container_id=sc.id ORDER BY cl.id DESC LIMIT 1) last_location,
        (SELECT cl.stage FROM cargo_locations cl WHERE cl.cargo_item_id=ci.id OR cl.shipping_container_id=sc.id ORDER BY cl.id DESC LIMIT 1) last_stage
      FROM cargo_items ci
      LEFT JOIN customers c ON c.id=ci.customer_id
      LEFT JOIN container_cargo_items cci ON cci.cargo_item_id=ci.id
      LEFT JOIN shipping_containers sc ON sc.id=cci.shipping_container_id AND sc.deleted_at IS NULL
      WHERE ci.deleted_at IS NULL${dateFilter('ci', from, to, p)}
      ORDER BY ci.id DESC LIMIT 500
    `, p);
    report.rows = rows.map((r) => [
      r.cargo_code || '-', r.cargo_name || '-', r.customer_name || '-', fa(r.cargo_status),
      r.container_no || rt('fields.noContainer'), r.current_location || r.last_location || '-', r.destination || '-',
      faStage(r.last_stage), r.last_location || '-',
    ]);
  }

  if (await hasTable('cargo_locations')) {
    const p = [];
    const locRows = await query(`
      SELECT cl.transport_type, cl.transport_no, cl.location_name, cl.stage, cl.status, sc.container_no, ci.cargo_code, ci.name cargo_name, c.name customer_name, cl.arrived_at
      FROM cargo_locations cl
      LEFT JOIN shipping_containers sc ON sc.id=cl.shipping_container_id
      LEFT JOIN cargo_items ci ON ci.id=cl.cargo_item_id
      LEFT JOIN customers c ON c.id=ci.customer_id
      WHERE 1=1${dateFilter('cl', from, to, p)}
      ORDER BY cl.id DESC LIMIT 300
    `, p);
    report.sections.push({
      title: rt('reportCols.cargoMovementHistory'),
      columns: rc('transportType', 'number', 'location', 'stage', 'status', 'container', 'cargo', 'customer', 'date'),
      rows: locRows.map((r) => [faTransport(r.transport_type), r.transport_no || '-', r.location_name || '-', faStage(r.stage), fa(r.status), r.container_no || '-', r.cargo_code ? `${r.cargo_code} - ${r.cargo_name}` : '-', r.customer_name || '-', String(r.arrived_at || '').slice(0, 16)]),
    });
  }

  report.stats = [{ label: rt('reportStats.locationRows'), value: String(report.rows.length) }];
  return report;
}

async function buildExpenses(report, from, to, scope = '', category = '') {
  const hasRouteCols = await hasColumn('expenses', 'route_from');
  report.columns = hasRouteCols
    ? rc('expenseNo', 'type', 'title', 'route', 'category', 'expenseVia', 'customerRef', 'amount', 'currency', 'cashboxFlow', 'date')
    : rc('expenseNo', 'type', 'title', 'category', 'expenseVia', 'customerRef', 'amount', 'currency', 'cashboxFlow', 'date');
  if (!(await hasTable('expenses'))) return report;

  const exp = await expenseExpression();
  const p = [];
  const dateSql = expenseDateFilter('e', from, to, p);
  let scopeSql = '';
  if (scope) { scopeSql += ' AND e.scope=?'; p.push(scope); }
  if (category) { scopeSql += ' AND e.category LIKE ?'; p.push(`%${category}%`); }
  const rows = await query(`
    SELECT e.*, ${exp} calc_usd, c.name customer_name, ci.cargo_code, sc.container_no, vt.trip_no, v.plate_no
    FROM expenses e
    LEFT JOIN customers c ON c.id=e.customer_id
    LEFT JOIN cargo_items ci ON ci.id=e.cargo_item_id
    LEFT JOIN shipping_containers sc ON sc.id=e.shipping_container_id
    LEFT JOIN vehicle_trips vt ON vt.id=e.vehicle_trip_id
    LEFT JOIN vehicles v ON v.id=vt.vehicle_id
    WHERE e.deleted_at IS NULL${dateSql}${scopeSql}
    ORDER BY COALESCE(e.expense_date, e.created_at) DESC, e.id DESC LIMIT 500
  `, p);

  let total = 0;
  report.rows = rows.map((r) => {
    const amount = n(r.calc_usd ?? r.amount_usd);
    total += amount;
    const ref = r.trip_no ? `${r.trip_no} / ${r.plate_no || '-'}` : (r.customer_name || r.cargo_code || r.container_no || '-');
    let routeCell = '-';
    if (hasRouteCols && (r.route_from || r.route_to)) {
      if (r.route_from && r.route_to) routeCell = `از ${r.route_from} به ${r.route_to}`;
      else if (r.route_to) routeCell = `به ${r.route_to}`;
      else routeCell = `از ${r.route_from}`;
    }
    const base = [
      r.expense_no,
      fa(r.scope),
      r.title,
    ];
    if (hasRouteCols) base.push(routeCell);
    base.push(
      faStage(r.category),
      expenseViaText(r),
      ref,
      money(r.amount),
      fa(r.currency),
      rt('expenseVia.cashbox'),
      String(r.expense_date || r.created_at || '').slice(0, 10),
    );
    return base;
  });
  report.stats = [{ label: rt('reportStats.expenseTotal'), value: usd(total) }];
  report.scopeTabs = ['', 'company', 'cargo', 'container', 'vehicle_trip'];
  report.activeScope = scope;
  report.activeCategory = category;
  return report;
}

async function buildPayments(report, from, to) {
  report.columns = rc('paymentNo', 'customer', 'container', 'cargo', 'amount', 'currency', 'usdEquivalent', 'method', 'date');

  if (await hasTable('payments')) {
    const p = [];
    const payWhere = await hasColumn('payments', 'deleted_at') ? ' AND p.deleted_at IS NULL' : '';
    const rows = await query(`
      SELECT p.*, c.name customer_name, sc.container_no, ci.cargo_code, ci.name cargo_name
      FROM payments p
      LEFT JOIN customers c ON c.id=p.customer_id
      LEFT JOIN shipping_containers sc ON sc.id=p.shipping_container_id
      LEFT JOIN cargo_items ci ON ci.id=p.cargo_item_id
      WHERE 1=1${payWhere}${dateFilter('p', from, to, p)}
      ORDER BY p.id DESC LIMIT 500
    `, p);
    let totalPaid = 0;
    report.rows = rows.map((r) => {
      totalPaid += n(r.amount_usd);
      return [r.payment_no, r.customer_name || '-', r.container_no || '-', r.cargo_code ? `${r.cargo_code} - ${r.cargo_name}` : '-', money(r.amount), fa(r.currency), usd(r.amount_usd), fa(r.payment_method), String(r.payment_date || r.created_at || '').slice(0, 10)];
    });
    report.stats.push({ label: rt('reportStats.paymentTotal'), value: usd(totalPaid) });
  }

  if (await hasTable('container_cargo_items')) {
    let receivableRows = [];
    if (await hasColumn('cargo_items', 'billing_mode')) {
      const billingData = await fetchCustomerReceivablesFromBilling();
      receivableRows = billingData.rows.map((r) => ({
        customer_name: r.customer_name,
        freight_total: r.freight_total,
        paid_total: r.paid_total,
      }));
    }
    if (!receivableRows.length) {
      receivableRows = await query(`
        SELECT customer_name, freight_total, paid_total
        FROM (
          SELECT COALESCE(c.name,'') customer_name,
            COALESCE(SUM(cci.freight_share_usd),0) freight_total,
            COALESCE((SELECT SUM(p.amount_usd) FROM payments p WHERE p.customer_id=cci.customer_id AND p.deleted_at IS NULL),0) paid_total
          FROM container_cargo_items cci
          LEFT JOIN customers c ON c.id=cci.customer_id
          GROUP BY cci.customer_id, c.name
        ) receivables
        WHERE freight_total > 0
        ORDER BY freight_total DESC
      `);
    }
    report.sections.push({
      title: rt('reportCols.customerReceivables'),
      columns: rc('customer', 'freightDebt', 'received', 'remaining'),
      rows: receivableRows.map((r) => {
        const due = Math.max(n(r.freight_total) - n(r.paid_total), 0);
        return [r.customer_name || rt('fields.noCustomer'), usd(r.freight_total), usd(r.paid_total), usd(due)];
      }),
    });
  }

  return report;
}

async function buildCashbox(report, from, to, cashType = '') {
  report.columns = rc('transactionNo', 'direction', 'type', 'title', 'amount', 'currency', 'date', 'source');
  if (!(await hasTable('cash_transactions'))) return report;

  const p = [];
  const dateSql = dateFilter('cash_transactions', from, to, p);
  let typeSql = '';
  if (cashType) { typeSql = ' AND type=?'; p.push(cashType); }
  const rows = await query(`SELECT * FROM cash_transactions WHERE 1=1${dateSql}${typeSql} ORDER BY transaction_date DESC, id DESC LIMIT 500`, p);
  const pSummary = [];
  const summaryDateSql = dateFilter('cash_transactions', from, to, pSummary);
  const summaryTypeSql = cashType ? ' AND type=?' : '';
  if (cashType) pSummary.push(cashType);
  const summary = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount_usd ELSE 0 END),0) income_total,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount_usd ELSE 0 END),0) expense_total,
      COALESCE(SUM(CASE WHEN type='withdraw' THEN amount_usd ELSE 0 END),0) withdraw_total,
      COALESCE(SUM(CASE WHEN type='adjustment' THEN amount_usd ELSE 0 END),0) adjustment_total
    FROM cash_transactions WHERE 1=1${summaryDateSql}${summaryTypeSql}
  `, pSummary);

  report.rows = rows.map((r) => {
    const inflow = r.type === 'income' || (r.type === 'adjustment' && n(r.amount) >= 0);
    const direction = inflow ? rt('expenseVia.inflow') : rt('expenseVia.outflow');
    return [
      r.transaction_no,
      direction,
      fa(r.type),
      localizeStoredTitle(r.title),
      money(r.amount),
      fa(r.currency),
      String(r.transaction_date || r.created_at || '').slice(0, 10),
      faSource(r.source_type || 'manual'),
    ];
  });
  const balance = n(summary?.income_total) - n(summary?.expense_total) - n(summary?.withdraw_total) + n(summary?.adjustment_total);
  report.stats = [
    { label: rt('reportStats.totalIncome'), value: usd(summary?.income_total) },
    { label: rt('reportStats.totalExpense'), value: usd(summary?.expense_total) },
    { label: rt('reportStats.totalWithdraw'), value: usd(summary?.withdraw_total) },
    { label: rt('reportStats.periodBalance'), value: usd(balance) },
  ];
  report.cashTypeTabs = ['', 'income', 'expense', 'withdraw', 'adjustment'];
  report.activeCashType = cashType;
  return report;
}

async function buildContainers(report, from, to) {
  if (!(await hasTable('shipping_containers'))) return report;

  const p = [];
  const containers = await query(`SELECT * FROM shipping_containers sc WHERE sc.deleted_at IS NULL${dateFilter('sc', from, to, p)} ORDER BY sc.id DESC LIMIT 200`, p);

  for (const c of containers) {
    const items = await query(`
      SELECT cci.*, ci.cargo_code, ci.name cargo_name, cu.name customer_name, cu.phone customer_phone
      FROM container_cargo_items cci
      LEFT JOIN cargo_items ci ON ci.id=cci.cargo_item_id
      LEFT JOIN customers cu ON cu.id=COALESCE(cci.customer_id, ci.customer_id)
      WHERE cci.shipping_container_id=?
      ORDER BY cci.id DESC
    `, [c.id]);

    report.sections.push({
      title: `${rt('reportCols.containerLabel')} ${c.container_no}`,
      subtitle: `${rt('fields.destination')}: ${c.destination || '-'} | ${rt('fields.status')}: ${fa(c.status)} | ${rt('fields.freight')}: ${usd(c.freight_usd)} | ${rt('fields.cbm')}: ${Number(c.total_loaded_cbm || 0).toFixed(4)}`,
      columns: rc('cargo', 'customer', 'contact', 'cartons', 'cbm', 'weight', 'freightShare'),
      rows: items.length ? items.map((i) => [
        `${i.cargo_code || '-'} - ${i.cargo_name || '-'}`,
        i.customer_name || '-',
        i.customer_phone || '-',
        String(i.cartons_loaded || 0),
        Number(i.cbm_loaded || 0).toFixed(4),
        faWeight(i.weight_loaded_kg),
        usd(i.freight_share_usd),
      ]) : [['-', '-', '-', '-', '-', '-', rt('common.noData')]],
    });
  }

  report.stats = [{ label: rt('reportStats.containerCount'), value: String(containers.length) }];
  return report;
}

async function buildLoading(report, from, to) {
  report.columns = rc('container', 'cargo', 'customer', 'cartons', 'cbm', 'weight', 'freightShare', 'destination');
  if (!(await hasTable('container_cargo_items'))) return report;

  const p = [];
  const rows = await query(`
    SELECT sc.container_no, sc.destination, ci.cargo_code, ci.name cargo_name, c.name customer_name,
      cci.cartons_loaded, cci.cbm_loaded, cci.weight_loaded_kg, cci.freight_share_usd
    FROM container_cargo_items cci
    JOIN shipping_containers sc ON sc.id=cci.shipping_container_id AND sc.deleted_at IS NULL
    LEFT JOIN cargo_items ci ON ci.id=cci.cargo_item_id
    LEFT JOIN customers c ON c.id=COALESCE(cci.customer_id, ci.customer_id)
    WHERE 1=1${dateFilter('cci', from, to, p)}
    ORDER BY sc.id DESC, cci.id DESC LIMIT 500
  `, p);

  report.rows = rows.map((r) => [
    r.container_no, `${r.cargo_code || '-'} - ${r.cargo_name || '-'}`, r.customer_name || '-',
    String(r.cartons_loaded || 0), Number(r.cbm_loaded || 0).toFixed(4), faWeight(r.weight_loaded_kg), usd(r.freight_share_usd), r.destination || '-',
  ]);
  report.stats = [{ label: rt('reportStats.loadingRows'), value: String(rows.length) }];
  return report;
}

async function buildWeighbridge(report, from, to) {
  report.columns = rc('ticketNo', 'customer', 'cargo', 'plate', 'driver', 'weightFirst', 'weightSecond', 'netWeight', 'date');
  if (!(await hasTable('weighbridge_tickets'))) return report;

  const p = [];
  const rows = await query(`
    SELECT wt.*, c.name customer_name, ci.cargo_code, ci.name cargo_name
    FROM weighbridge_tickets wt
    LEFT JOIN customers c ON c.id=wt.customer_id
    LEFT JOIN cargo_items ci ON ci.id=wt.cargo_item_id
    WHERE wt.deleted_at IS NULL${dateFilter('wt', from, to, p)}
    ORDER BY wt.id DESC LIMIT 500
  `, p);

  report.rows = rows.map((r) => [
    r.ticket_no, r.customer_name || '-', r.cargo_code ? `${r.cargo_code} - ${r.cargo_name}` : '-',
    r.vehicle_plate || '-', r.driver_name || '-', faWeight(r.first_weight_kg), faWeight(r.second_weight_kg), faWeight(r.net_weight_kg),
    String(r.created_at || '').slice(0, 10),
  ]);
  return report;
}

async function buildCargo(report, from, to) {
  report.columns = rc('cargoCode', 'title', 'customer', 'cartons', 'cbm', 'weight', 'value', 'status', 'container', 'destination');
  if (!(await hasTable('cargo_items'))) return report;

  const p = [];
  const rows = await query(`
    SELECT ci.*, c.name customer_name, sc.container_no, sc.destination
    FROM cargo_items ci
    LEFT JOIN customers c ON c.id=ci.customer_id
    LEFT JOIN container_cargo_items cci ON cci.cargo_item_id=ci.id
    LEFT JOIN shipping_containers sc ON sc.id=cci.shipping_container_id AND sc.deleted_at IS NULL
    WHERE ci.deleted_at IS NULL${dateFilter('ci', from, to, p)}
    ORDER BY ci.id DESC LIMIT 500
  `, p);

  report.rows = rows.map((r) => [
    r.cargo_code, r.name, r.customer_name || '-', String(r.carton_count || 0), Number(r.total_cbm || 0).toFixed(4),
    faWeight(r.gross_weight_kg), usd(r.value_usd), fa(r.status), r.container_no || '-', r.destination || '-',
  ]);
  return report;
}

async function buildProfitLoss(report, from, to) {
  let totalFreight = 0;
  let companyExpenses = 0;
  let cargoExpenses = 0;
  let containerExpenses = 0;
  let routeExpenses = 0;

  if (await hasTable('shipping_containers')) {
    const p = [];
    totalFreight = n((await one(`SELECT COALESCE(SUM(freight_usd),0) v FROM shipping_containers sc WHERE sc.deleted_at IS NULL${dateFilter('sc', from, to, p)}`, p))?.v);
  }

  if (await hasTable('expenses')) {
    const exp = await expenseExpression();
    const p = [];
    const row = await one(`SELECT
      COALESCE(SUM(CASE WHEN scope='company' THEN ${exp} ELSE 0 END),0) company_total,
      COALESCE(SUM(CASE WHEN scope='cargo' THEN ${exp} ELSE 0 END),0) cargo_total,
      COALESCE(SUM(CASE WHEN scope='container' THEN ${exp} ELSE 0 END),0) container_total
      FROM expenses e WHERE e.deleted_at IS NULL${dateFilter('e', from, to, p)}`, p);
    companyExpenses = n(row?.company_total);
    cargoExpenses = n(row?.cargo_total);
    containerExpenses = n(row?.container_total);
  }

  if (await hasTable('cargo_locations')) {
    const p = [];
    routeExpenses = n((await one(`SELECT COALESCE(SUM(cost_usd),0) v FROM cargo_locations cl WHERE 1=1${dateFilter('cl', from, to, p)}`, p))?.v);
  }

  const overhead = cargoExpenses + containerExpenses + routeExpenses;
  const profitLoss = totalFreight - companyExpenses - overhead;

  report.stats = [
    { label: rt('reportStats.totalIncomeFreight'), value: usd(totalFreight) },
    { label: rt('reportStats.companyExpenses'), value: usd(companyExpenses) },
    { label: rt('reportStats.overheadExpenses'), value: usd(overhead) },
    { label: profitLoss >= 0 ? rt('reportStats.netProfit') : rt('reportStats.netLoss'), value: usd(Math.abs(profitLoss)) },
  ];

  report.sections.push({
    title: rt('reportCols.incomeSources'),
    columns: rc('incomeSource', 'description', 'amount'),
    rows: [
      [rt('reportStats.plContainerFreight'), rt('reportStats.plContainerFreightDesc'), usd(totalFreight)],
    ],
  });

  report.sections.push({
    title: rt('reportCols.expenseSources'),
    columns: rc('section', 'description', 'amount'),
    rows: [
      [rt('reportStats.plCompanyExpenses'), rt('reportStats.plCompanyExpensesDesc'), usd(companyExpenses)],
      [rt('reportStats.plCargoOverhead'), rt('reportStats.plCargoOverheadDesc'), usd(cargoExpenses)],
      [rt('reportStats.plContainerOverhead'), rt('reportStats.plContainerOverheadDesc'), usd(containerExpenses)],
      [rt('reportStats.plRouteExpenses'), rt('reportStats.plRouteExpensesDesc'), usd(routeExpenses)],
    ],
  });

  report.sections.push({
    title: rt('reportCols.finalResult'),
    columns: rc('title', 'type', 'amount'),
    rows: [
      [rt('reportStats.plTotalIncome'), rt('reportStats.plIncome'), usd(totalFreight)],
      [rt('reportStats.plTotalExpenses'), rt('reportStats.plExpense'), usd(companyExpenses + overhead)],
      [profitLoss >= 0 ? rt('reportStats.plFinalProfit') : rt('reportStats.plFinalLoss'), profitLoss >= 0 ? rt('reportStats.plIncome') : rt('reportStats.plExpense'), usd(Math.abs(profitLoss))],
    ],
  });

  if (await hasTable('shipping_containers')) {
    const p = [];
    const rows = await query(`SELECT container_no, freight_usd, destination, status FROM shipping_containers sc WHERE sc.deleted_at IS NULL AND freight_usd>0${dateFilter('sc', from, to, p)} ORDER BY freight_usd DESC LIMIT 100`, p);
    report.sections.push({
      title: rt('reportCols.containerIncomeDetails'),
      columns: rc('container', 'destination', 'status', 'freight'),
      rows: rows.map((r) => [r.container_no, r.destination || '-', fa(r.status), usd(r.freight_usd)]),
    });
  }

  return report;
}

async function buildInvoice(report, customerId) {
  if (await hasTable('customers')) {
    report.customers = await query('SELECT id, name, customer_code, phone, company_name, address FROM customers WHERE deleted_at IS NULL ORDER BY name LIMIT 500');
  }

  if (!customerId) {
    report.subtitle = rt('reportStats.invoiceSelectCustomer');
    return report;
  }

  const customer = await one('SELECT * FROM customers WHERE id=? AND deleted_at IS NULL', [customerId]);
  if (!customer) return report;

  let freightTotal = 0;
  let paidTotal = 0;
  const lines = [];
  const payments = [];

  if (await hasTable('container_cargo_items')) {
    const cargoLines = await query(`
      SELECT sc.container_no, sc.destination, sc.origin, sc.status container_status,
        ci.cargo_code, ci.name cargo_name, ci.carton_count total_cartons,
        cci.cartons_loaded, cci.cbm_loaded, cci.weight_loaded_kg, cci.freight_share_usd
      FROM container_cargo_items cci
      JOIN shipping_containers sc ON sc.id=cci.shipping_container_id
      LEFT JOIN cargo_items ci ON ci.id=cci.cargo_item_id
      WHERE COALESCE(cci.customer_id, ci.customer_id)=?
      ORDER BY sc.id DESC, cci.id DESC
    `, [customerId]);
    cargoLines.forEach((line, index) => {
      freightTotal += n(line.freight_share_usd);
      lines.push({
        rowNo: index + 1,
        containerNo: line.container_no || '-',
        cargoCode: line.cargo_code || '-',
        cargoName: line.cargo_name || '-',
        origin: line.origin || '-',
        destination: line.destination || '-',
        containerStatus: fa(line.container_status),
        cartons: line.cartons_loaded || 0,
        cbm: Number(line.cbm_loaded || 0).toFixed(4),
        weight: faWeight(line.weight_loaded_kg),
        amount: n(line.freight_share_usd),
      });
    });
  }

  if (await hasTable('payments')) {
    const payWhere = await hasColumn('payments', 'deleted_at') ? ' AND deleted_at IS NULL' : '';
    payments.push(...await query(`
      SELECT payment_no, amount, amount_usd, currency, payment_date, payment_method, notes
      FROM payments WHERE customer_id=?${payWhere}
      ORDER BY id DESC LIMIT 100
    `, [customerId]));
    paidTotal = payments.reduce((sum, p) => sum + n(p.amount_usd), 0);
  }

  const balance = Math.max(freightTotal - paidTotal, 0);
  report.invoice = {
    number: `INV-${customer.customer_code || customer.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    date: new Date().toISOString().slice(0, 10),
    customer,
    lines,
    payments,
    freightTotal,
    paidTotal,
    balance,
    totals: {
      cartons: lines.reduce((s, l) => s + Number(l.cartons || 0), 0),
      cbm: lines.reduce((s, l) => s + Number(l.cbm || 0), 0).toFixed(4),
      items: lines.length,
    },
  };

  report.stats = [
    { label: rt('reportStats.invoiceItems'), value: String(lines.length) },
    { label: rt('reportStats.invoiceFreight'), value: usd(freightTotal) },
    { label: rt('reportStats.invoicePaid'), value: usd(paidTotal) },
    { label: rt('reportStats.invoiceBalance'), value: usd(balance) },
  ];

  return report;
}

async function buildCustomerAccounts(report, customerId, search, from, to) {
  const data = await buildCustomerAccountReport({ customerId, search, from, to });
  report.customerAccount = data;
  report.search = search;

  const col = (key) => rt(`customerAccount.cols.${key}`);

  if (data.mode === 'list') {
    report.subtitle = rt('customerAccount.listSubtitle');
    report.columns = [
      col('customerCode'), col('customerName'), col('phone'), col('company'),
      col('cargoCount'), col('paymentCount'), col('action'),
    ];
    report.rows = (data.customers || []).map((c) => [
      c.customer_code || '-',
      c.name || '-',
      c.phone || '-',
      c.company_name || '-',
      String(c.cargo_count || 0),
      String(c.payment_count || 0),
      col('viewReport'),
    ]);
    report.stats = [
      { label: rt('customerAccount.stats.customers'), value: String(data.customers?.length || 0) },
    ];
    report.customerLinks = (data.customers || []).map((c) => ({
      id: c.id,
      href: `/reports?type=customer-accounts&customer_id=${c.id}${search ? `&search=${encodeURIComponent(search)}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    }));
    return report;
  }

  if (!data.customer) {
    report.subtitle = rt('customerAccount.notFound');
    return report;
  }

  const c = data.customer;
  report.subtitle = `${c.customer_code || ''} — ${c.name || ''}`;
  report.stats = [
    { label: rt('customerAccount.stats.cargoCount'), value: String(data.summary?.cargoCount || 0) },
    { label: rt('customerAccount.stats.totalDue'), value: formatMoneyUsd(data.summary?.totalDue || 0) },
    { label: rt('customerAccount.stats.totalPaid'), value: formatMoneyUsd(data.summary?.totalPaid || 0) },
    { label: rt('customerAccount.stats.balance'), value: formatMoneyUsd(data.summary?.balance || 0) },
    { label: rt('customerAccount.stats.routeExpenses'), value: String(data.summary?.expenseLegCount || 0) },
  ];

  report.sections = (data.sections || []).map((section) => ({
    title: rt(section.titleKey),
    columns: section.columns.map((k) => col(k)),
    rows: section.rows,
  }));

  report.cargoBillingLinks = (data.cargoBillings || []).map(({ cargo }) => ({
    id: cargo.id,
    code: cargo.cargo_code,
    href: `/cargo-items/${cargo.id}/billing`,
  }));

  return report;
}

async function buildVehicleTrips(report, from, to) {
  if (!await hasTable('vehicle_trips')) return report;
  const p = [];
  let where = 'WHERE vt.deleted_at IS NULL';
  if (from) { where += ' AND DATE(vt.created_at)>=?'; p.push(from); }
  if (to) { where += ' AND DATE(vt.created_at)<=?'; p.push(to); }
  const rows = await query(`SELECT vt.trip_no, v.plate_no, vt.origin, vt.destination, vt.total_weight_kg, vt.freight_usd, vt.status FROM vehicle_trips vt JOIN vehicles v ON v.id=vt.vehicle_id ${where} ORDER BY vt.id DESC`, p);
  report.columns = rc('tripNo', 'plate', 'origin', 'destination', 'weight', 'freight', 'status');
  report.rows = rows.map((r) => [r.trip_no, r.plate_no, r.origin || '-', r.destination || '-', money(r.total_weight_kg), usd(r.freight_usd), fa(r.status)]);
  return report;
}

async function buildDeliveries(report, from, to) {
  if (!await hasTable('deliveries')) return report;
  const p = [];
  let where = 'WHERE d.deleted_at IS NULL';
  if (from) { where += ' AND DATE(d.delivered_at)>=?'; p.push(from); }
  if (to) { where += ' AND DATE(d.delivered_at)<=?'; p.push(to); }
  const rows = await query(`SELECT d.delivery_no, c.name customer_name, ci.name cargo_name, vt.trip_no, d.delivered_at, d.weight_kg FROM deliveries d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN cargo_items ci ON ci.id=d.cargo_item_id LEFT JOIN vehicle_trips vt ON vt.id=d.vehicle_trip_id ${where} ORDER BY d.id DESC`, p);
  report.columns = [rt('reportCols.deliveryNo'), ...rc('customer', 'cargo', 'tripNo', 'date', 'weight')];
  report.rows = rows.map((r) => [r.delivery_no, r.customer_name || '-', r.cargo_name || '-', r.trip_no || '-', String(r.delivered_at || '').slice(0, 16), money(r.weight_kg)]);
  return report;
}

async function buildPartners(report, from, to) {
  if (!await hasTable('partners')) return report;
  const partners = await query('SELECT partner_code, name, share_percent, equity_usd FROM partners WHERE deleted_at IS NULL ORDER BY id DESC');
  report.sections.push({
    title: rt('pages.partners.title'),
    columns: [...rc('code'), rt('reportCols.partnerName'), rt('reportCols.sharePercent'), rt('reportCols.equity')],
    rows: partners.map((p) => [p.partner_code, p.name, `${p.share_percent}%`, usd(p.equity_usd)]),
  });
  if (await hasTable('partner_withdrawals')) {
    const p = [];
    let where = 'WHERE 1=1';
    if (from) { where += ' AND DATE(pw.withdrawal_date)>=?'; p.push(from); }
    if (to) { where += ' AND DATE(pw.withdrawal_date)<=?'; p.push(to); }
    const w = await query(`SELECT pw.withdrawal_no, p.name, pw.amount_usd, pw.withdrawal_date FROM partner_withdrawals pw JOIN partners p ON p.id=pw.partner_id ${where} ORDER BY pw.id DESC`, p);
    report.sections.push({
      title: rt('fields.recentWithdrawals'),
      columns: [...rc('withdrawalNo'), rt('reportCols.partnerName'), rc('amount', 'date')],
      rows: w.map((r) => [r.withdrawal_no, r.name, usd(r.amount_usd), r.withdrawal_date || '-']),
    });
  }
  return report;
}

async function buildSalaries(report, from, to) {
  if (!await hasTable('salary_records')) return report;
  const p = [];
  let where = 'WHERE deleted_at IS NULL';
  if (from) { where += ' AND DATE(paid_date)>=?'; p.push(from); }
  if (to) { where += ' AND DATE(paid_date)<=?'; p.push(to); }
  const rows = await query(`SELECT salary_no, employee_name, salary_month, amount_usd, paid_date FROM salary_records ${where} ORDER BY id DESC`, p);
  report.columns = [...rc('salaryNo', 'employeeName', 'salaryMonth', 'amount'), rt('fields.paidDate')];
  report.rows = rows.map((r) => [r.salary_no, r.employee_name, r.salary_month || '-', usd(r.amount_usd), r.paid_date || '-']);
  return report;
}

async function buildVehicleProfit(report) {
  if (!await hasTable('vehicles')) return report;
  const vehicles = await query('SELECT id, plate_no, vehicle_code FROM vehicles WHERE deleted_at IS NULL ORDER BY id DESC');
  report.columns = [...rc('plate'), rt('fields.tripCount'), rt('fields.income'), rt('fields.expenses'), rt('fields.profit')];
  for (const v of vehicles) {
    const pl = await vehicleProfitLoss(v.id);
    report.rows.push([`${v.plate_no} (${v.vehicle_code})`, String(pl.tripCount), usd(pl.income), usd(pl.expenses), usd(pl.profit)]);
  }
  return report;
}

export function reportToCsv(report) {
  const ct = createTranslator(report.locale || 'fa');
  const csv = (key, vars) => ct(`csv.${key}`, vars);
  const lines = [];
  const pushRow = (cells) => lines.push(cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));

  lines.push('\uFEFF');
  pushRow([report.title]);
  pushRow([report.subtitle]);
  if (report.from || report.to) pushRow([`${csv('from')}: ${report.from || '-'}`, `${csv('to')}: ${report.to || '-'}`]);
  pushRow([]);

  if (report.stats?.length) {
    pushRow([csv('summary')]);
    for (const s of report.stats) pushRow([s.label, s.value]);
    pushRow([]);
  }

  const exportTable = (title, columns, rows) => {
    if (title) pushRow([title]);
    if (columns?.length) pushRow(columns);
    for (const row of rows || []) pushRow(row);
    pushRow([]);
  };

  if (report.invoice) {
    const inv = report.invoice;
    pushRow([csv('invoiceTitle')]);
    pushRow([csv('invoiceNo'), inv.number]);
    pushRow([csv('date'), inv.date]);
    pushRow([csv('customerName'), inv.customer.name]);
    pushRow([csv('customerCode'), inv.customer.customer_code || '-']);
    pushRow([csv('fatherName'), inv.customer.father_name || '-']);
    pushRow([csv('contact'), inv.customer.phone || '-']);
    pushRow([csv('email'), inv.customer.email || '-']);
    pushRow([csv('company'), inv.customer.company_name || '-']);
    pushRow([csv('passport'), inv.customer.tazkira_or_passport || '-']);
    pushRow([csv('address'), inv.customer.address || '-']);
    pushRow([]);
    pushRow([csv('row'), csv('container'), csv('cargoCode'), csv('cargoName'), csv('origin'), csv('destination'), csv('cartons'), csv('volume'), csv('weight'), csv('amount')]);
    for (const line of inv.lines) {
      pushRow([line.rowNo, line.containerNo, line.cargoCode, line.cargoName, line.origin, line.destination, line.cartons, line.cbm, line.weight, usd(line.amount)]);
    }
    pushRow([]);
    pushRow([csv('payments')]);
    pushRow([csv('paymentNo'), csv('date'), csv('method'), csv('amount')]);
    for (const p of inv.payments || []) {
      pushRow([p.payment_no, String(p.payment_date || '').slice(0, 10), fa(p.payment_method), usd(p.amount_usd)]);
    }
    pushRow([]);
    pushRow([csv('freightTotal'), usd(inv.freightTotal)]);
    pushRow([csv('paidTotal'), usd(inv.paidTotal)]);
    pushRow([csv('balance'), usd(inv.balance)]);
    pushRow([]);
  }

  if (report.columns?.length) exportTable('', report.columns, report.rows);
  for (const section of report.sections || []) exportTable(section.title, section.columns, section.rows);

  return lines.join('\n');
}
