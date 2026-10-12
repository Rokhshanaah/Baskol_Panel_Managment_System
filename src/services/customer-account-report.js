import { hasColumn, hasTable, one, query } from '../db.js';
import { money, n } from '../utils/format.js';
import { fa, faStage, faTransport, faWeight } from '../utils/labels.js';
import { getCargoBillingSummary } from './cargo-billing.js';

function likeParam(search) {
  return `%${String(search || '').trim()}%`;
}

function routeText(from, to) {
  if (from && to) return `از ${from} به ${to}`;
  if (to) return `به ${to}`;
  if (from) return `از ${from}`;
  return '-';
}

function formatMoneyCell(amount, currency) {
  const code = currency || 'USD';
  return `${money(amount)} ${code}`;
}

function matchesSearch(values, search) {
  if (!search) return true;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => String(v ?? '').toLowerCase().includes(q));
}

function paymentDateFilter(from, to, params) {
  let sql = '';
  if (from) { sql += ' AND DATE(COALESCE(p.payment_date, p.created_at))>=?'; params.push(from); }
  if (to) { sql += ' AND DATE(COALESCE(p.payment_date, p.created_at))<=?'; params.push(to); }
  return sql;
}

function expenseDateFilter(from, to, params) {
  let sql = '';
  if (from) { sql += ' AND DATE(COALESCE(e.expense_date, e.created_at))>=?'; params.push(from); }
  if (to) { sql += ' AND DATE(COALESCE(e.expense_date, e.created_at))<=?'; params.push(to); }
  return sql;
}

function genericDateFilter(alias, from, to, params, dateCol = 'created_at') {
  let sql = '';
  if (from) { sql += ` AND DATE(${alias}.${dateCol})>=?`; params.push(from); }
  if (to) { sql += ` AND DATE(${alias}.${dateCol})<=?`; params.push(to); }
  return sql;
}

async function listCustomers(search) {
  if (!await hasTable('customers')) return [];
  const params = [];
  let where = 'WHERE c.deleted_at IS NULL';
  if (search) {
    where += ' AND (c.name LIKE ? OR c.customer_code LIKE ? OR c.phone LIKE ? OR c.company_name LIKE ? OR c.email LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(likeParam(search));
  }
  return query(`
    SELECT c.id, c.customer_code, c.name, c.phone, c.company_name, c.email,
      (SELECT COUNT(*) FROM cargo_items ci WHERE ci.customer_id=c.id AND ci.deleted_at IS NULL) cargo_count,
      (SELECT COUNT(*) FROM payments p WHERE p.customer_id=c.id ${await hasColumn('payments', 'deleted_at') ? 'AND p.deleted_at IS NULL' : ''}) payment_count
    FROM customers c
    ${where}
    ORDER BY c.name ASC, c.id DESC
    LIMIT 500
  `, params);
}

async function buildCustomerDetail(customerId, search, from, to) {
  const customer = await one('SELECT * FROM customers WHERE id=? AND deleted_at IS NULL', [customerId]);
  if (!customer) return null;

  const cargoItems = await query(`
    SELECT ci.* FROM cargo_items ci
    WHERE ci.customer_id=? AND ci.deleted_at IS NULL
    ORDER BY ci.id DESC
  `, [customerId]);

  const cargoBillings = [];
  let totalDue = 0;
  let totalPaid = 0;
  let totalExpenses = 0;

  for (const cargo of cargoItems) {
    const billing = await getCargoBillingSummary(cargo.id);
    if (!billing) continue;
    totalDue += billing.totalDue;
    totalPaid += billing.paidTotal;
    totalExpenses += billing.expensesTotal;

    const legs = billing.legs.filter((leg) => matchesSearch([
      leg.title, leg.route_from, leg.route_to, leg.category, leg.notes, leg.expense_no,
    ], search));

    if (search && !matchesSearch([
      cargo.cargo_code, cargo.name, cargo.status, cargo.description, cargo.contract_route,
      ...legs.flatMap((l) => [l.title, l.route_from, l.route_to]),
    ], search) && legs.length === 0) {
      continue;
    }

    cargoBillings.push({
      cargo,
      billing,
      legs,
    });
  }

  const sections = [];

  // Cargo + billing summary rows
  const cargoRows = cargoBillings.map(({ cargo, billing }) => [
    cargo.cargo_code,
    cargo.name,
    fa(cargo.status),
    String(cargo.carton_count || 0),
    Number(cargo.total_cbm || 0).toFixed(4),
    faWeight(cargo.gross_weight_kg),
    fa(billing.billingMode),
    formatMoneyCell(billing.totalDue, cargo.contract_currency || 'USD'),
    formatMoneyCell(billing.paidTotal, 'USD'),
    formatMoneyCell(billing.balanceDue, cargo.contract_currency || 'USD'),
  ]);

  sections.push({
    key: 'cargo',
    titleKey: 'customerAccount.cargoSection',
    columns: ['cargoCode', 'cargoName', 'status', 'cartons', 'cbm', 'weight', 'type', 'totalDue', 'paid', 'remaining'],
    rows: cargoRows,
  });

  // Route expenses (all legs)
  const routeRows = [];
  for (const { cargo, legs } of cargoBillings) {
    for (const leg of legs) {
      routeRows.push([
        cargo.cargo_code,
        cargo.name,
        routeText(leg.route_from, leg.route_to),
        leg.title || '-',
        faStage(leg.category),
        formatMoneyCell(leg.amount, leg.currency),
        String(leg.expense_date || '').slice(0, 10),
        leg.notes || '-',
      ]);
    }
  }
  sections.push({
    key: 'routes',
    titleKey: 'customerAccount.routeExpensesSection',
    columns: ['cargoCode', 'cargoName', 'route', 'title', 'category', 'amount', 'date', 'notes'],
    rows: routeRows,
  });

  // Container loading
  if (await hasTable('container_cargo_items')) {
    const p = [];
    const loads = await query(`
      SELECT sc.container_no, sc.origin, sc.destination, ci.cargo_code, ci.name cargo_name,
        cci.cartons_loaded, cci.cbm_loaded, cci.weight_loaded_kg, cci.freight_share_usd
      FROM container_cargo_items cci
      JOIN shipping_containers sc ON sc.id=cci.shipping_container_id
      LEFT JOIN cargo_items ci ON ci.id=cci.cargo_item_id
      WHERE COALESCE(cci.customer_id, ci.customer_id)=?
      ORDER BY cci.id DESC
    `, [customerId]);
    const loadRows = loads.filter((r) => matchesSearch([
      r.container_no, r.origin, r.destination, r.cargo_code, r.cargo_name,
    ], search)).map((r) => [
      r.container_no || '-',
      r.cargo_code || '-',
      r.cargo_name || '-',
      r.origin || '-',
      r.destination || '-',
      String(r.cartons_loaded || 0),
      Number(r.cbm_loaded || 0).toFixed(4),
      faWeight(r.weight_loaded_kg),
      formatMoneyCell(r.freight_share_usd, 'USD'),
    ]);
    sections.push({
      key: 'loading',
      titleKey: 'customerAccount.loadingSection',
      columns: ['containerNo', 'cargoCode', 'cargoName', 'origin', 'destination', 'cartons', 'cbm', 'weight', 'freightShare'],
      rows: loadRows,
    });
  }

  // Payments
  if (await hasTable('payments')) {
    const p = [customerId];
    const payDel = await hasColumn('payments', 'deleted_at') ? ' AND p.deleted_at IS NULL' : '';
    const payRows = (await query(`
      SELECT p.*, ci.cargo_code, sc.container_no
      FROM payments p
      LEFT JOIN cargo_items ci ON ci.id=p.cargo_item_id
      LEFT JOIN shipping_containers sc ON sc.id=p.shipping_container_id
      WHERE p.customer_id=?${payDel}${paymentDateFilter(from, to, p)}
      ORDER BY p.payment_date DESC, p.id DESC
    `, p)).filter((r) => matchesSearch([
      r.payment_no, r.payment_method, r.notes, r.cargo_code, r.container_no,
    ], search)).map((r) => [
      r.payment_no,
      r.cargo_code || '-',
      r.container_no || '-',
      formatMoneyCell(r.amount, r.currency),
      fa(r.payment_method),
      String(r.payment_date || '').slice(0, 10),
      r.notes || '-',
    ]);
    sections.push({
      key: 'payments',
      titleKey: 'customerAccount.paymentsSection',
      columns: ['paymentNo', 'cargoCode', 'containerNo', 'amount', 'method', 'date', 'notes'],
      rows: payRows,
    });
  }

  // Weighbridge
  if (await hasTable('weighbridge_tickets')) {
    const p = [customerId];
    const tickets = (await query(`
      SELECT wt.*, ci.cargo_code FROM weighbridge_tickets wt
      LEFT JOIN cargo_items ci ON ci.id=wt.cargo_item_id
      WHERE wt.customer_id=? AND wt.deleted_at IS NULL${genericDateFilter('wt', from, to, p)}
      ORDER BY wt.id DESC
    `, p)).filter((r) => matchesSearch([
      r.ticket_no, r.vehicle_plate, r.driver_name, r.cargo_code,
    ], search)).map((r) => [
      r.ticket_no,
      r.cargo_code || '-',
      r.vehicle_plate || '-',
      faWeight(r.net_weight_kg),
      String(r.carton_count || 0),
      fa(r.weigh_type),
      String(r.created_at || '').slice(0, 10),
    ]);
    sections.push({
      key: 'weighbridge',
      titleKey: 'customerAccount.weighbridgeSection',
      columns: ['ticketNo', 'cargoCode', 'plate', 'netWeight', 'cartons', 'type', 'date'],
      rows: tickets,
    });
  }

  // Deliveries
  if (await hasTable('deliveries')) {
    const p = [customerId];
    const deliveries = (await query(`
      SELECT d.*, ci.cargo_code, vt.trip_no FROM deliveries d
      LEFT JOIN cargo_items ci ON ci.id=d.cargo_item_id
      LEFT JOIN vehicle_trips vt ON vt.id=d.vehicle_trip_id
      WHERE d.customer_id=? AND d.deleted_at IS NULL${genericDateFilter('d', from, to, p, 'delivered_at')}
      ORDER BY d.id DESC
    `, p)).filter((r) => matchesSearch([
      r.delivery_no, r.recipient_name, r.cargo_code, r.trip_no,
    ], search)).map((r) => [
      r.delivery_no,
      r.cargo_code || '-',
      r.recipient_name || '-',
      r.trip_no || '-',
      faWeight(r.weight_kg),
      String(r.delivered_at || '').slice(0, 16),
    ]);
    sections.push({
      key: 'deliveries',
      titleKey: 'customerAccount.deliveriesSection',
      columns: ['deliveryNo', 'cargoCode', 'recipient', 'tripNo', 'weight', 'date'],
      rows: deliveries,
    });
  }

  // Cargo locations / routes history
  if (await hasTable('cargo_locations')) {
    const p = [customerId];
    const locs = (await query(`
      SELECT cl.*, sc.container_no, ci.cargo_code
      FROM cargo_locations cl
      LEFT JOIN cargo_items ci ON ci.id=cl.cargo_item_id
      LEFT JOIN shipping_containers sc ON sc.id=cl.shipping_container_id
      WHERE ci.customer_id=?${genericDateFilter('cl', from, to, p, 'arrived_at')}
      ORDER BY cl.id DESC
    `, p)).filter((r) => matchesSearch([
      r.location_name, r.stage, r.transport_no, r.cargo_code, r.container_no,
    ], search)).map((r) => [
      r.cargo_code || '-',
      r.container_no || '-',
      faTransport(r.transport_type),
      faStage(r.stage),
      r.location_name || '-',
      fa(r.status),
      formatMoneyCell(r.cost_usd, r.cost_currency || 'USD'),
      String(r.arrived_at || '').slice(0, 16),
    ]);
    sections.push({
      key: 'locations',
      titleKey: 'customerAccount.locationsSection',
      columns: ['cargoCode', 'containerNo', 'transportType', 'stage', 'location', 'status', 'cost', 'date'],
      rows: locs,
    });
  }

  // All expenses linked to customer
  if (await hasTable('expenses')) {
    const p = [customerId, customerId];
    const expDel = await hasColumn('expenses', 'deleted_at') ? ' AND e.deleted_at IS NULL' : '';
    const hasRoute = await hasColumn('expenses', 'route_from');
    const expenses = await query(`
      SELECT e.*, ci.cargo_code, sc.container_no
      FROM expenses e
      LEFT JOIN cargo_items ci ON ci.id=e.cargo_item_id
      LEFT JOIN shipping_containers sc ON sc.id=e.shipping_container_id
      WHERE (e.customer_id=? OR ci.customer_id=?)${expDel}${expenseDateFilter(from, to, p)}
      ORDER BY COALESCE(e.expense_date, e.created_at) DESC, e.id DESC
    `, p);
    const expRows = expenses.filter((r) => matchesSearch([
      r.expense_no, r.title, r.category, r.notes, r.cargo_code, r.container_no,
      r.route_from, r.route_to,
    ], search)).map((r) => [
      r.expense_no,
      fa(r.scope),
      r.cargo_code || r.container_no || '-',
      hasRoute ? routeText(r.route_from, r.route_to) : '-',
      r.title || '-',
      formatMoneyCell(r.amount, r.currency),
      String(r.expense_date || '').slice(0, 10),
    ]);
    sections.push({
      key: 'expenses',
      titleKey: 'customerAccount.expensesSection',
      columns: ['expenseNo', 'type', 'relation', 'route', 'title', 'amount', 'date'],
      rows: expRows,
    });
  }

  const balance = Math.max(totalDue - totalPaid, 0);

  return {
    customer,
    cargoBillings,
    sections: sections.filter((s) => s.rows.length > 0 || !search),
    summary: {
      cargoCount: cargoItems.length,
      totalDue,
      totalPaid,
      balance,
      expenseLegCount: routeRows.length,
    },
  };
}

export async function buildCustomerAccountReport({ customerId, search = '', from = '', to = '' }) {
  const customers = await listCustomers(search);

  if (!customerId) {
    return {
      mode: 'list',
      customers,
      search,
      from,
      to,
    };
  }

  const detail = await buildCustomerDetail(customerId, search, from, to);
  return {
    mode: 'detail',
    customers: await listCustomers(''),
    search,
    from,
    to,
    ...detail,
  };
}
