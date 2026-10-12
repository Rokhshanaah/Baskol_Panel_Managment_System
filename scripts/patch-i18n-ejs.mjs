import fs from 'node:fs';
import path from 'node:path';

const pagesDir = path.resolve('views/pages');

const commonReplacements = [
  ['>ردیف<', "><%= t('common.row') %><"],
  ['>عملیات<', "><%= t('common.actions') %><"],
  ['>ویرایش<', "><%= t('common.edit') %><"],
  ['>حذف<', "><%= t('common.delete') %><"],
  ['>ذخیره<', "><%= t('common.save') %><"],
  ['>لغو<', "><%= t('common.cancel') %><"],
  ['>بستن فرم<', "><%= t('common.closeForm') %><"],
  ['>بستن<', "><%= t('common.close') %><"],
  ['>انتخاب<', "><%= t('fields.select') %><"],
  ['>بدون کانتینر<', "><%= t('fields.noContainer') %><"],
  ['>بدون جنس<', "><%= t('fields.noCargo') %><"],
  ['>بدون مشتری<', "><%= t('fields.noCustomer') %><"],
  ['>خودکار<', "><%= t('fields.auto') %><"],
  ['>مشتری<', "><%= t('fields.customer') %><"],
  ['>جنس<', "><%= t('fields.cargo') %><"],
  ['>کانتینر<', "><%= t('fields.container') %><"],
  ['>نام<', "><%= t('fields.name') %><"],
  ['>ایمیل<', "><%= t('fields.email') %><"],
  ['>نقش<', "><%= t('fields.role') %><"],
  ['>مبلغ<', "><%= t('fields.amount') %><"],
  ['>تاریخ<', "><%= t('fields.date') %><"],
  ['>یادداشت<', "><%= t('fields.notes') %><"],
  ['>نوع<', "><%= t('fields.type') %><"],
  ['>عنوان<', "><%= t('fields.title') %><"],
  ['>شماره<', "><%= t('fields.number') %><"],
  ['>ارتباط<', "><%= t('fields.relation') %><"],
  ['>روش<', "><%= t('fields.method') %><"],
  ['>معادل دالر<', "><%= t('fields.usdEquivalent') %><"],
  ['>واحد پول<', "><%= t('fields.currency') %><"],
  ['>نرخ هر ۱ دالر<', "><%= t('fields.rateUsd') %><"],
  ['>وضعیت<', "><%= t('fields.status') %><"],
  ['>مبدأ<', "><%= t('fields.origin') %><"],
  ['>مقصد<', "><%= t('fields.destination') %><"],
  ['>کارتن<', "><%= t('fields.cartons') %><"],
  ['>حجم مکعب<', "><%= t('fields.cbm') %><"],
  ['>وزن<', "><%= t('fields.weight') %><"],
  ['>کرایه<', "><%= t('fields.freight') %><"],
  ['>دسته‌بندی<', "><%= t('fields.category') %><"],
  ['>رسید<', "><%= t('fields.ticket') %><"],
  ['>شرکت<', "><%= t('fields.company') %><"],
  ["|| 'خودکار'", "|| t('fields.auto')"],
  ['data-confirm="این دریافت حذف شود؟"', 'data-confirm="<%= t(\'fields.confirmDeletePayment\') %>"'],
  ['data-confirm="این هزینه حذف شود؟"', 'data-confirm="<%= t(\'fields.confirmDeleteExpense\') %>"'],
  ['data-confirm="این رسید حذف شود؟"', 'data-confirm="<%= t(\'fields.confirmDeleteTicket\') %>"'],
  ['data-confirm="این کاربر حذف شود؟"', 'data-confirm="<%= t(\'fields.confirmDeleteUser\') %>"'],
  ['data-confirm="آیا مطمئن هستی که این مشتری حذف شود؟"', 'data-confirm="<%= t(\'fields.confirmDeleteCustomer\') %>"'],
  ['data-confirm="این حرکت حذف شود؟"', 'data-confirm="<%= t(\'fields.confirmDeleteCash\') %>"'],
];

const fileReplacements = {
  'customers.ejs': [
    ["editingId ? 'ویرایش مشتری' : 'ثبت مشتری جدید'", "editingId ? t('forms.customers.edit') : t('forms.customers.new')"],
    ['هنوز مشتری ثبت نشده است', "<%= t('pages.customers.empty') %>"],
  ],
  'payments.ejs': [
    ["editingId?'ویرایش دریافت':'ثبت دریافت جدید'", "editingId?t('forms.payments.edit'):t('forms.payments.new')"],
    ['پول دریافت‌شده از مشتری را ثبت کن.', "<%= t('forms.payments.desc') %>"],
    ['>شماره دریافت<', "><%= t('fields.paymentNo') %><"],
    ['>کانتینر (اختیاری)<', "><%= t('fields.optionalContainer') %><"],
    ['>جنس (اختیاری)<', "><%= t('fields.optionalCargo') %><"],
    ['>روش دریافت<', "><%= t('fields.paymentMethod') %><"],
    ['دریافتی ثبت نشده است', "<%= t('pages.payments.empty') %>"],
  ],
  'expenses.ejs': [
    ["editingId?'ویرایش هزینه':'ثبت هزینه جدید'", "editingId?t('forms.expenses.edit'):t('forms.expenses.new')"],
    ['معلومات هزینه را وارد کن.', "<%= t('forms.expenses.desc') %>"],
    ['>شماره هزینه<', "><%= t('fields.number') %><"],
    ['هزینه‌ای ثبت نشده است', "<%= t('pages.expenses.empty') %>"],
  ],
  'weighbridge-tickets.ejs': [
    ["editingId?'ویرایش رسید باسکول':'ثبت رسید باسکول'", "editingId?t('forms.weighbridge.edit'):t('forms.weighbridge.new')"],
    ['معلومات وزن‌کشی را وارد کن.', "<%= t('forms.weighbridge.desc') %>"],
    ['>شماره رسید<', "><%= t('fields.ticketNo') %><"],
    ['>نوع وزن<', "><%= t('fields.weighType') %><"],
    ['>نمبر پلیت<', "><%= t('fields.plate') %><"],
    ['>نام راننده<', "><%= t('fields.driver') %><"],
    ['>تماس راننده<', "><%= t('fields.driverPhone') %><"],
    ['>تعداد کارتن<', "><%= t('fields.cartons') %><"],
    ['>وزن اول (کیلو)<', "><%= t('fields.weightFirst') %><"],
    ['>وزن دوم (کیلو)<', "><%= t('fields.weightSecond') %><"],
    ['>وزن خالص خودکار<', "><%= t('fields.weightAuto') %><"],
    ['>موتر / راننده<', "><%= t('fields.vehicleDriver') %><"],
    ['>وزن اول<', "><%= t('reportCols.weightFirst') %><"],
    ['>وزن دوم<', "><%= t('reportCols.weightSecond') %><"],
    ['>خالص<', "><%= t('reportCols.netWeight') %><"],
    ['هنوز رسیدی ثبت نشده است', "<%= t('pages.weighbridge.empty') %>"],
  ],
  'containers.ejs': [
    ["editingId?'ویرایش کانتینر':'ثبت کانتینر جدید'", "editingId?t('forms.containers.edit'):t('forms.containers.new')"],
    ['مشخصات کانتینر را وارد کن.', "<%= t('forms.containers.desc') %>"],
    ['>شماره کانتینر<', "><%= t('fields.containerNo') %><"],
    ['>کشتی / مسیر<', "><%= t('fields.shipRoute') %><"],
    ['>اجناس<', "><%= t('fields.items') %><"],
    ['کانتینری ثبت نشده است', "<%= t('common.noData') %>"],
    ['بارگیری کانتینر', "<%= t('forms.loading.title') %>"],
  ],
  'users.ejs': [
    ['کاربری ثبت نشده است', "<%= t('pages.users.empty') %>"],
  ],
  'cargo-items.ejs': [
    ["editingId?'ویرایش جنس':'ثبت جنس جدید'", "editingId?t('forms.cargoItems.edit'):t('forms.cargoItems.new')"],
    ['مشخصات جنس را وارد کن.', "<%= t('forms.cargoItems.desc') %>"],
  ],
  'cargo-locations.ejs': [
    ['ثبت موقعیت جدید', "<%= t('forms.cargoLocations.new') %>"],
    ['>نوع حمل<', "><%= t('fields.transportType') %><"],
    ['>شماره / کد<', "><%= t('fields.transportNo') %><"],
  ],
  'containers.ejs': [
    ['>نمبر سیل<', "><%= t('fields.sealNo') %><"],
    ['>شماره رزرو<', "><%= t('fields.bookingNo') %><"],
    ['>نام کشتی<', "><%= t('fields.shipName') %><"],
    ['>نوع کانتینر<', "><%= t('fields.containerType') %><"],
    ['انتخاب جنس', "<%= t('fields.selectCargo') %>"],
    ['>کارتن بارگیری<', "><%= t('forms.loading.loadCartons') %><"],
    ['>حجم بارگیری<', "><%= t('forms.loading.loadCbm') %><"],
    ['>سهم کرایه<', "><%= t('fields.freightShare') %><"],
    ['هنوز جنسی داخل این کانتینر نیست.', "<%= t('fields.noCargoInContainer') %>"],
    ['حجم:', "<%= t('fields.volumeShort') %>:"],
    ['| کرایه/متر مکعب:', "| <%= t('fields.freightPerCbm') %>:"],
  ],
  'container-loading.ejs': [
    ['بارگیری کانتینر', "<%= t('forms.loading.title') %>"],
    ['>مسیر<', "><%= t('fields.route') %><"],
    ['>اجناس<', "><%= t('fields.items') %><"],
    ['کانتینری برای بارگیری وجود ندارد', "<%= t('fields.noContainersToLoad') %>"],
    ['انتخاب جنس', "<%= t('fields.selectCargo') %>"],
    ['>کارتن بارگیری<', "><%= t('forms.loading.loadCartons') %><"],
    ['>حجم بارگیری<', "><%= t('forms.loading.loadCbm') %><"],
    ['>سهم کرایه<', "><%= t('fields.freightShare') %><"],
    ['هنوز جنسی داخل این کانتینر نیست.', "<%= t('fields.noCargoInContainer') %>"],
  ],
  'cashbox.ejs': [
    ["{l:'افتتاحیه',v:opening_balance", "{l:t('fields.opening'),v:opening_balance"],
    ["{l:'دریافت',v:income", "{l:t('fields.income'),v:income"],
    ["{l:'مصرف',v:expensesTotal", "{l:t('fields.expense'),v:expensesTotal"],
    ["{l:'برداشت',v:withdraws", "{l:t('fields.withdraw'),v:withdraws"],
    ["{l:'اصلاحات',v:adjustments", "{l:t('fields.adjustments'),v:adjustments"],
    ["{l:'موجودی',v:balance", "{l:t('fields.balance'),v:balance"],
    ['ثبت حرکت صندوق', "<%= t('forms.cashbox.transaction') %>"],
    ['دریافت، مصرف، برداشت یا اصلاحیه', "<%= t('forms.cashbox.transactionDesc') %>"],
    ['تنظیمات صندوق', "<%= t('forms.cashbox.box') %>"],
    ['>نام صندوق<', "><%= t('fields.boxName') %><"],
    ['>واحد اصلی<', "><%= t('fields.mainCurrency') %><"],
    ['>موجودی افتتاحیه (دالر)<', "><%= t('fields.openingBalanceUsd') %><"],
    ['>دالر<', "><%= t('fields.usdEquivalent') %><"],
    ['>منبع<', "><%= t('fields.source') %><"],
    ['حرکتی ثبت نشده است', "<%= t('fields.noMovements') %>"],
    ['<option value="income">دریافت</option>', '<option value="income"><%= t(\'fields.income\') %></option>'],
    ['<option value="expense">مصرف</option>', '<option value="expense"><%= t(\'fields.expense\') %></option>'],
  ],
};

for (const file of fs.readdirSync(pagesDir)) {
  if (!file.endsWith('.ejs')) continue;
  let content = fs.readFileSync(path.join(pagesDir, file), 'utf8');
  for (const [from, to] of commonReplacements) {
    content = content.split(from).join(to);
  }
  for (const [from, to] of fileReplacements[file] || []) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(path.join(pagesDir, file), content);
}

console.log('Patched EJS pages');
