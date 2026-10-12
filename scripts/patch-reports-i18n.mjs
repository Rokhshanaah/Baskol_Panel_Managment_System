import fs from 'node:fs';

const file = new URL('../src/services/reports.js', import.meta.url);
let src = fs.readFileSync(file, 'utf8');

const statReplacements = [
  ["{ label: 'تعداد اجناس'", "{ label: rt('reportStats.cargoCount')"],
  ["{ label: 'تعداد کارتن'", "{ label: rt('reportStats.cartonCount')"],
  ["{ label: 'مجموع حجم مکعب'", "{ label: rt('reportStats.totalCbm')"],
  ["{ label: 'وزن خالص باسکول'", "{ label: rt('reportStats.netWeight')"],
  ["{ label: 'تعداد کانتینر'", "{ label: rt('reportStats.containerCount')"],
  ["{ label: 'مجموع کرایه'", "{ label: rt('reportStats.totalFreight')"],
  ["{ label: 'مصارف شرکت'", "{ label: rt('reportStats.companyExpenses')"],
  ["{ label: 'مصارف جنس'", "{ label: rt('reportStats.cargoExpenses')"],
  ["{ label: 'مصارف کانتینر'", "{ label: rt('reportStats.containerExpenses')"],
  ["{ label: 'تعداد ردیف موقعیت بار'", "{ label: rt('reportStats.locationRows')"],
  ["{ label: 'جمع کل مصارف'", "{ label: rt('reportStats.expenseTotal')"],
  ["{ label: 'جمع دریافت‌ها'", "{ label: rt('reportStats.paymentTotal')"],
  ["{ label: 'کل دریافت'", "{ label: rt('reportStats.totalIncome')"],
  ["{ label: 'کل مصرف'", "{ label: rt('reportStats.totalExpense')"],
  ["{ label: 'کل برداشت'", "{ label: rt('reportStats.totalWithdraw')"],
  ["{ label: 'موجودی دوره'", "{ label: rt('reportStats.periodBalance')"],
  ["{ label: 'تعداد ردیف بارگیری'", "{ label: rt('reportStats.loadingRows')"],
  ["{ label: 'کل درآمد (کرایه)'", "{ label: rt('reportStats.totalIncomeFreight')"],
  ["{ label: 'مصارف سربار'", "{ label: rt('reportStats.overheadExpenses')"],
  ["profitLoss >= 0 ? 'مفاد خالص' : 'ضرر خالص'", "profitLoss >= 0 ? rt('reportStats.netProfit') : rt('reportStats.netLoss')"],
  ["{ label: 'تعداد اقلام'", "{ label: rt('reportStats.invoiceItems')"],
  ["{ label: 'جمع کرایه'", "{ label: rt('reportStats.invoiceFreight')"],
  ["{ label: 'دریافت‌شده'", "{ label: rt('reportStats.invoicePaid')"],
  ["{ label: 'باقی‌مانده'", "{ label: rt('reportStats.invoiceBalance')"],
  ["report.subtitle = 'مشتری را انتخاب کنید تا فاکتور با تمام جزئیات صادر شود.';", "report.subtitle = rt('reportStats.invoiceSelectCustomer');"],
  ["['کرایه کانتینرها', 'درآمد حاصل از کرایه بارهای ارسالی', usd(totalFreight)]", "[rt('reportStats.plContainerFreight'), rt('reportStats.plContainerFreightDesc'), usd(totalFreight)]"],
  ["['مصارف شرکت', 'هزینه‌های مستقیم شرکت', usd(companyExpenses)]", "[rt('reportStats.plCompanyExpenses'), rt('reportStats.plCompanyExpensesDesc'), usd(companyExpenses)]"],
  ["['سربار جنس', 'مصارف مربوط به اجناس', usd(cargoExpenses)]", "[rt('reportStats.plCargoOverhead'), rt('reportStats.plCargoOverheadDesc'), usd(cargoExpenses)]"],
  ["['سربار کانتینر', 'مصارف مربوط به کانتینرها', usd(containerExpenses)]", "[rt('reportStats.plContainerOverhead'), rt('reportStats.plContainerOverheadDesc'), usd(containerExpenses)]"],
  ["['مصارف مسیر', 'هزینه‌های ثبت‌شده در موقعیت بار', usd(routeExpenses)]", "[rt('reportStats.plRouteExpenses'), rt('reportStats.plRouteExpensesDesc'), usd(routeExpenses)]"],
  ["['کل درآمد', 'مفاد', usd(totalFreight)]", "[rt('reportStats.plTotalIncome'), rt('reportStats.plIncome'), usd(totalFreight)]"],
  ["['کل مصارف', 'ضرر', usd(companyExpenses + overhead)]", "[rt('reportStats.plTotalExpenses'), rt('reportStats.plExpense'), usd(companyExpenses + overhead)]"],
  ["profitLoss >= 0 ? 'مفاد نهایی شرکت' : 'ضرر نهایی شرکت', profitLoss >= 0 ? 'مفاد' : 'ضرر'", "profitLoss >= 0 ? rt('reportStats.plFinalProfit') : rt('reportStats.plFinalLoss'), profitLoss >= 0 ? rt('reportStats.plIncome') : rt('reportStats.plExpense')"],
];

for (const [from, to] of statReplacements) {
  if (!src.includes(from)) console.warn('MISSING stat:', from.slice(0, 60));
  else src = src.split(from).join(to);
}

// REPORT_TYPES use reportMeta instead - replace with empty object keys pointing to i18n (optional cleanup)
src = src.replace(/export const REPORT_TYPES = \{[\s\S]*?\};\n\n/, 'export const REPORT_TYPES = Object.fromEntries(Object.keys(REPORT_I18N_KEYS).map((k) => [k, {}]));\n\n');

// reportToCsv localization
src = src.replace(
  'export function reportToCsv(report) {',
  `export function reportToCsv(report) {
  const ct = createTranslator(report.locale || 'fa');
  const csv = (key, vars) => ct(\`csv.\${key}\`, vars);`
);

const csvReplacements = [
  ["pushRow([`از: ${report.from || '-'}`, `تا: ${report.to || '-'}`]);", "pushRow([`${csv('from')}: ${report.from || '-'}`, `${csv('to')}: ${report.to || '-'}`]);"],
  ["pushRow(['خلاصه']);", "pushRow([csv('summary')]);"],
  ["pushRow(['فاکتور مشتری']);", "pushRow([csv('invoiceTitle')]);"],
  ["pushRow(['شماره فاکتور', inv.number]);", "pushRow([csv('invoiceNo'), inv.number]);"],
  ["pushRow(['تاریخ', inv.date]);", "pushRow([csv('date'), inv.date]);"],
  ["pushRow(['نام مشتری', inv.customer.name]);", "pushRow([csv('customerName'), inv.customer.name]);"],
  ["pushRow(['کد مشتری', inv.customer.customer_code || '-']);", "pushRow([csv('customerCode'), inv.customer.customer_code || '-']);"],
  ["pushRow(['نام پدر', inv.customer.father_name || '-']);", "pushRow([csv('fatherName'), inv.customer.father_name || '-']);"],
  ["pushRow(['تماس', inv.customer.phone || '-']);", "pushRow([csv('contact'), inv.customer.phone || '-']);"],
  ["pushRow(['ایمیل', inv.customer.email || '-']);", "pushRow([csv('email'), inv.customer.email || '-']);"],
  ["pushRow(['شرکت', inv.customer.company_name || '-']);", "pushRow([csv('company'), inv.customer.company_name || '-']);"],
  ["pushRow(['تذکره / پاسپورت', inv.customer.tazkira_or_passport || '-']);", "pushRow([csv('passport'), inv.customer.tazkira_or_passport || '-']);"],
  ["pushRow(['آدرس', inv.customer.address || '-']);", "pushRow([csv('address'), inv.customer.address || '-']);"],
  ["pushRow(['ردیف', 'کانتینر', 'کد جنس', 'نام جنس', 'مبدأ', 'مقصد', 'کارتن', 'حجم', 'وزن', 'مبلغ']);", "pushRow([csv('row'), csv('container'), csv('cargoCode'), csv('cargoName'), csv('origin'), csv('destination'), csv('cartons'), csv('volume'), csv('weight'), csv('amount')]);"],
  ["pushRow(['دریافت‌ها']);", "pushRow([csv('payments')]);"],
  ["pushRow(['شماره', 'تاریخ', 'روش', 'مبلغ']);", "pushRow([csv('paymentNo'), csv('date'), csv('method'), csv('amount')]);"],
  ["pushRow(['جمع کرایه', usd(inv.freightTotal)]);", "pushRow([csv('freightTotal'), usd(inv.freightTotal)]);"],
  ["pushRow(['دریافت‌شده', usd(inv.paidTotal)]);", "pushRow([csv('paidTotal'), usd(inv.paidTotal)]);"],
  ["pushRow(['باقی‌مانده', usd(inv.balance)]);", "pushRow([csv('balance'), usd(inv.balance)]);"],
];

for (const [from, to] of csvReplacements) {
  if (!src.includes(from)) console.warn('MISSING csv:', from.slice(0, 60));
  else src = src.split(from).join(to);
}

// store locale on report
src = src.replace(
  '    from,\n    to,\n  };',
  '    from,\n    to,\n    locale: filters.locale || \'fa\',\n  };'
);

fs.writeFileSync(file, src);
console.log('Patched reports.js');
