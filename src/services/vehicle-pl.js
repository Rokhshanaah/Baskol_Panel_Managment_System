import { hasColumn, hasTable, one, query } from '../db.js';
import { n } from '../utils/format.js';

export async function recalcTripTotals(tripId, db = query) {
  const totals = await one(
    'SELECT COALESCE(SUM(weight_kg),0) w, COALESCE(SUM(freight_usd),0) f FROM vehicle_trip_cargo WHERE vehicle_trip_id=?',
    [tripId],
  );
  await db(
    'UPDATE vehicle_trips SET total_weight_kg=?, freight_usd=?, updated_at=NOW() WHERE id=?',
    [n(totals?.w), n(totals?.f), tripId],
  );
}

export async function tripExpenseTotal(tripId) {
  if (!await hasTable('vehicle_trip_expenses')) return 0;
  const row = await one('SELECT COALESCE(SUM(amount_usd),0) v FROM vehicle_trip_expenses WHERE vehicle_trip_id=?', [tripId]);
  return n(row?.v);
}

/** Attach summed trip expenses to list rows. */
export async function attachTripExpenseTotals(rows) {
  if (!rows.length || !await hasTable('vehicle_trip_expenses')) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const sums = await query(
    `SELECT vehicle_trip_id,
      COALESCE(SUM(amount), 0) AS expense_total,
      SUBSTRING_INDEX(GROUP_CONCAT(currency ORDER BY id DESC), ',', 1) AS expense_currency
     FROM vehicle_trip_expenses
     WHERE vehicle_trip_id IN (${placeholders})
     GROUP BY vehicle_trip_id`,
    ids,
  );
  const map = new Map(sums.map((s) => [s.vehicle_trip_id, s]));
  return rows.map((row) => {
    const summary = map.get(row.id);
    return {
      ...row,
      trip_expense_total: n(summary?.expense_total),
      trip_expense_currency: summary?.expense_currency || null,
    };
  });
}

export async function tripIncome(tripId) {
  const row = await one('SELECT COALESCE(SUM(freight_usd),0) v FROM vehicle_trip_cargo WHERE vehicle_trip_id=?', [tripId]);
  return n(row?.v);
}

export async function tripProfitLoss(tripId) {
  const income = await tripIncome(tripId);
  const expenses = await tripExpenseTotal(tripId);
  return { income, expenses, profit: income - expenses };
}

export async function cargoProfitOnTrip(tripId) {
  const cargoRows = await query(`
    SELECT vtc.*, ci.name cargo_name, ci.cargo_code, c.name customer_name
    FROM vehicle_trip_cargo vtc
    LEFT JOIN cargo_items ci ON ci.id = vtc.cargo_item_id
    LEFT JOIN customers c ON c.id = vtc.customer_id
    WHERE vtc.vehicle_trip_id = ?
  `, [tripId]);
  const { income: tripIncomeTotal, expenses: tripExpenseTotal } = await tripProfitLoss(tripId);
  const totalWeight = cargoRows.reduce((s, r) => s + n(r.weight_kg), 0) || 1;
  return cargoRows.map((row) => {
    const freight = n(row.freight_usd);
    const expenseShare = tripExpenseTotal * (n(row.weight_kg) / totalWeight);
    const profit = freight - expenseShare;
    return { ...row, expense_share_usd: expenseShare, profit_usd: profit };
  });
}

export async function vehicleDashboardStats() {
  const result = {
    activeVehicles: 0,
    tripsInTransit: 0,
    vehicleFreight: 0,
    vehicleTripExpenses: 0,
    vehicleProfit: 0,
  };
  if (!await hasTable('vehicles')) return result;

  result.activeVehicles = Number((await one(`
    SELECT COUNT(*) c FROM vehicles
    WHERE deleted_at IS NULL ${await hasColumn('vehicles', 'status') ? "AND status <> 'inactive'" : ''}
  `))?.c || 0);

  if (await hasTable('vehicle_trips')) {
    result.tripsInTransit = Number((await one(`
      SELECT COUNT(*) c FROM vehicle_trips
      WHERE deleted_at IS NULL AND status NOT IN ('delivered', 'cancelled')
    `))?.c || 0);
    result.vehicleFreight = Number((await one(`
      SELECT COALESCE(SUM(freight_usd), 0) v FROM vehicle_trips WHERE deleted_at IS NULL
    `))?.v || 0);
  }

  if (await hasTable('vehicle_trip_expenses')) {
    result.vehicleTripExpenses = Number((await one(`
      SELECT COALESCE(SUM(amount_usd), 0) v FROM vehicle_trip_expenses
    `))?.v || 0);
  }

  result.vehicleProfit = result.vehicleFreight - result.vehicleTripExpenses;
  return result;
}

export async function vehicleProfitLoss(vehicleId) {
  const trips = await query('SELECT id FROM vehicle_trips WHERE vehicle_id=? AND deleted_at IS NULL', [vehicleId]);
  let income = 0;
  let expenses = 0;
  for (const trip of trips) {
    const pl = await tripProfitLoss(trip.id);
    income += pl.income;
    expenses += pl.expenses;
  }
  return { income, expenses, profit: income - expenses, tripCount: trips.length };
}

export async function customerCargoProfitLoss(customerId) {
  const rows = await query(`
    SELECT vtc.cargo_item_id, ci.name cargo_name, ci.cargo_code,
      COALESCE(SUM(vtc.freight_usd),0) freight_total,
      COALESCE(SUM(vtc.weight_kg),0) weight_total
    FROM vehicle_trip_cargo vtc
    JOIN cargo_items ci ON ci.id = vtc.cargo_item_id
    WHERE vtc.customer_id = ? OR ci.customer_id = ?
    GROUP BY vtc.cargo_item_id, ci.name, ci.cargo_code
  `, [customerId, customerId]);
  const result = [];
  for (const row of rows) {
    const expenseRows = await one(`
      SELECT COALESCE(SUM(e.amount_usd),0) v FROM expenses e
      WHERE e.deleted_at IS NULL AND (e.customer_id=? OR e.cargo_item_id=?)
    `, [customerId, row.cargo_item_id]);
    const freight = n(row.freight_total);
    const exp = n(expenseRows?.v);
    result.push({ ...row, expenses_usd: exp, profit_usd: freight - exp });
  }
  return result;
}
