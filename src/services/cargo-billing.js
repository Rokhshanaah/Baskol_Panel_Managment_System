import { hasColumn, one, query } from '../db.js';
import { n } from '../utils/format.js';

function expenseUsd(expense) {
  if (expense.amount_usd != null) return n(expense.amount_usd);
  if (expense.currency === 'USD') return n(expense.amount);
  const rate = n(expense.rate_to_usd);
  return rate > 0 ? n(expense.amount) / rate : n(expense.amount);
}

async function billableFilter() {
  if (await hasColumn('expenses', 'billable_to_customer')) {
    return 'AND e.billable_to_customer = 1';
  }
  return '';
}

export async function getCargoBillingSummary(cargoId) {
  const cargo = await one(`
    SELECT ci.*, c.name customer_name, c.customer_code
    FROM cargo_items ci
    LEFT JOIN customers c ON c.id = ci.customer_id
    WHERE ci.id = ? AND ci.deleted_at IS NULL
  `, [cargoId]);
  if (!cargo) return null;

  const billingMode = cargo.billing_mode || 'itemized';
  const commissionPercent = n(cargo.commission_percent);
  const billableSql = await billableFilter();

  const cargoExpenses = await query(`
    SELECT e.* FROM expenses e
    WHERE e.deleted_at IS NULL AND e.cargo_item_id = ? ${billableSql}
    ORDER BY e.expense_date ASC, e.id ASC
  `, [cargoId]);

  const containerLoads = await query(`
    SELECT cci.*, sc.container_no
    FROM container_cargo_items cci
    JOIN shipping_containers sc ON sc.id = cci.shipping_container_id
    WHERE cci.cargo_item_id = ?
  `, [cargoId]);

  const freightShareTotal = containerLoads.reduce((sum, row) => sum + n(row.freight_share_usd), 0);

  const allocatedExpenses = [];
  for (const load of containerLoads) {
    const containerExpenses = await query(`
      SELECT e.* FROM expenses e
      WHERE e.deleted_at IS NULL AND e.scope = 'container' AND e.shipping_container_id = ? ${billableSql}
      ORDER BY e.expense_date ASC, e.id ASC
    `, [load.shipping_container_id]);

    const totalCbm = n((await one(
      'SELECT COALESCE(SUM(cbm_loaded),0) t FROM container_cargo_items WHERE shipping_container_id=?',
      [load.shipping_container_id],
    ))?.t);
    const share = totalCbm > 0 ? n(load.cbm_loaded) / totalCbm : 0;

    for (const exp of containerExpenses) {
      allocatedExpenses.push({
        ...exp,
        allocated_amount_usd: expenseUsd(exp) * share,
        allocation_note: `${load.container_no} (${(share * 100).toFixed(1)}%)`,
        is_allocated: true,
      });
    }
  }

  const legs = [
    ...cargoExpenses.map((exp) => ({
      ...exp,
      allocated_amount_usd: expenseUsd(exp),
      is_allocated: false,
    })),
    ...allocatedExpenses,
  ];

  const expensesTotal = legs.reduce((sum, leg) => sum + n(leg.allocated_amount_usd), 0);
  const commissionAmount = billingMode === 'itemized' ? (expensesTotal * commissionPercent) / 100 : 0;

  let totalDue = 0;
  if (billingMode === 'fixed_contract') {
    totalDue = n(cargo.contract_amount);
  } else if (expensesTotal > 0.004 || commissionPercent > 0 || legs.length > 0) {
    totalDue = expensesTotal + commissionAmount;
  } else {
    totalDue = freightShareTotal;
  }

  const paidRow = await one(`
    SELECT COALESCE(SUM(amount_usd),0) paid FROM payments p
    WHERE p.deleted_at IS NULL AND p.cargo_item_id = ?
  `, [cargoId]);
  const paidTotal = n(paidRow?.paid);
  const balanceDue = Math.max(totalDue - paidTotal, 0);

  return {
    cargo,
    billingMode,
    commissionPercent,
    commissionAmount,
    expensesTotal,
    freightShareTotal,
    totalDue,
    paidTotal,
    balanceDue,
    legs,
    containerLoads,
  };
}

export async function fetchCustomerReceivablesFromBilling() {
  const cargos = await query(`
    SELECT ci.id, ci.customer_id
    FROM cargo_items ci
    WHERE ci.deleted_at IS NULL
  `);

  const byCustomer = new Map();
  for (const row of cargos) {
    const billing = await getCargoBillingSummary(row.id);
    if (!billing || billing.totalDue <= 0.004) continue;

    const key = row.customer_id || 0;
    const existing = byCustomer.get(key) || {
      customer_id: key,
      customer_name: billing.cargo.customer_name || '',
      freight_total: 0,
      paid_total: 0,
    };
    existing.freight_total += billing.totalDue;
    existing.paid_total += billing.paidTotal;
    byCustomer.set(key, existing);
  }

  const mapped = [...byCustomer.values()].map((row) => {
    const due = Math.max(n(row.freight_total) - n(row.paid_total), 0);
    return { ...row, due };
  });

  return {
    total: mapped.reduce((sum, row) => sum + row.due, 0),
    rows: mapped.filter((row) => row.due > 0.004).sort((a, b) => b.due - a.due),
  };
}
