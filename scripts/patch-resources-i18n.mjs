import fs from 'node:fs';

const file = new URL('../src/routes/resources.js', import.meta.url);
let src = fs.readFileSync(file, 'utf8');

const replacements = [
  ["import { pageMeta } from '../utils/i18n.js';", "import { blockerSeparator, localizedLocationStatuses, localizedStages, localizedTransportTypes, pageMeta } from '../utils/i18n.js';"],
  ['async function customerDeleteBlockers(customerId) {', 'async function customerDeleteBlockers(customerId, req) {'],
  ['if (cargoItems > 0) blockers.push(`${cargoItems} جنس / کالا برای این مشتری ثبت شده`);', "if (cargoItems > 0) blockers.push(req.t('blockers.customerCargoItems', { count: cargoItems }));"],
  ['if (activeCargo > 0) blockers.push(`${activeCargo} جنس هنوز در جریان / مسیر است`);', "if (activeCargo > 0) blockers.push(req.t('blockers.customerActiveCargo', { count: activeCargo }));"],
  ['if (tickets > 0) blockers.push(`${tickets} تکت باسکول برای این مشتری ثبت شده`);', "if (tickets > 0) blockers.push(req.t('blockers.customerTickets', { count: tickets }));"],
  ['if (payments > 0) blockers.push(`${payments} پرداخت / رسید پول برای این مشتری ثبت شده`);', "if (payments > 0) blockers.push(req.t('blockers.customerPayments', { count: payments }));"],
  ['if (expenses > 0) blockers.push(`${expenses} مصرف مربوط به این مشتری ثبت شده`);', "if (expenses > 0) blockers.push(req.t('blockers.customerExpenses', { count: expenses }));"],
  ['if (activeContainers > 0) blockers.push(`${activeContainers} کانتینر فعال مربوط به این مشتری وجود دارد`);', "if (activeContainers > 0) blockers.push(req.t('blockers.customerContainers', { count: activeContainers }));"],
  ['if (Number(row?.c || 0) > 0) blockers.push(`${row.c} موقعیت / حرکت بار برای جنس‌های این مشتری ثبت شده`);', "if (Number(row?.c || 0) > 0) blockers.push(req.t('blockers.customerLocations', { count: row.c }));"],
  ['async function cargoDeleteBlockers(cargoId) {', 'async function cargoDeleteBlockers(cargoId, req) {'],
  ["if (['in_container','in_transit'].includes(item?.status)) blockers.push('این جنس داخل کانتینر یا در مسیر است');", "if (['in_container','in_transit'].includes(item?.status)) blockers.push(req.t('blockers.cargoInTransit'));"],
  ["for (const [table,label] of [['weighbridge_tickets','تکت باسکول'],['cargo_locations','موقعیت / حرکت بار'],['payments','پرداخت'],['expenses','مصرف']]) {", "for (const [table,labelKey] of [['weighbridge_tickets','labelTicket'],['cargo_locations','labelLocation'],['payments','labelPayment'],['expenses','labelExpense']]) {"],
  ['if(c>0) blockers.push(`${c} ${label} برای این جنس ثبت شده`);', "if(c>0) blockers.push(req.t('blockers.cargoRelated', { count: c, label: req.t(`blockers.${labelKey}`) }));"],
  ['if(containerCount>0) blockers.push(`${containerCount} ردیف بارگیری / کانتینر برای این جنس ثبت شده`);', "if(containerCount>0) blockers.push(req.t('blockers.cargoLoadingRows', { count: containerCount }));"],
  ["must(req.body.name,'نام مشتری الزامی است.');", "must(req.body.name, req.t('validation.customerNameRequired'));"],
  ["flash(req,'error','کد مشتری قبلاً ثبت شده است.');", "flash(req,'error', req.t('flash.customerCodeDuplicate'));"],
  ["flash(req,'success','مشتری بروزرسانی شد.');", "flash(req,'success', req.t('flash.customerUpdated'));"],
  ["flash(req,'success','مشتری جدید ثبت شد.');", "flash(req,'success', req.t('flash.customerCreated'));"],
  ["flash(req,'error',`این مشتری حذف شده نمی‌تواند، چون: ${blockers.join('؛ ')}`);", "flash(req,'error', req.t('flash.customerDeleteBlocked', { reasons: blockers.join(blockerSeparator(req.locale)) }));"],
  ["flash(req,'success','مشتری حذف شد.');", "flash(req,'success', req.t('flash.customerDeleted'));"],
  ["must(req.body.customer_id,'مشتری الزامی است.'); must(req.body.name,'نام جنس الزامی است.');", "must(req.body.customer_id, req.t('validation.customerRequired')); must(req.body.name, req.t('validation.cargoNameRequired'));"],
  ["flash(req,'error','کد جنس قبلاً ثبت شده است.');", "flash(req,'error', req.t('flash.cargoCodeDuplicate'));"],
  ["flash(req,'success','جنس بروزرسانی شد.');", "flash(req,'success', req.t('flash.cargoUpdated'));"],
  ["flash(req,'success','جنس جدید ثبت شد.');", "flash(req,'success', req.t('flash.cargoCreated'));"],
  ["flash(req,'error',`این جنس حذف شده نمی‌تواند، چون: ${blockers.join('؛ ')}`);", "flash(req,'error', req.t('flash.cargoDeleteBlocked', { reasons: blockers.join(blockerSeparator(req.locale)) }));"],
  ["flash(req,'success','جنس حذف شد.');", "flash(req,'success', req.t('flash.cargoDeleted'));"],
  ["const blockers=await cargoDeleteBlockers(id);", "const blockers=await cargoDeleteBlockers(id, req);"],
  ["must(req.body.first_weight_kg,'وزن اول الزامی است.');must(req.body.second_weight_kg,'وزن دوم الزامی است.');", "must(req.body.first_weight_kg, req.t('validation.firstWeightRequired'));must(req.body.second_weight_kg, req.t('validation.secondWeightRequired'));"],
  ["flash(req,'success','رسید باسکول بروزرسانی شد.');", "flash(req,'success', req.t('flash.ticketUpdated'));"],
  ["flash(req,'success','رسید باسکول ثبت شد.');", "flash(req,'success', req.t('flash.ticketCreated'));"],
  ["flash(req,'success','رسید باسکول حذف شد.');", "flash(req,'success', req.t('flash.ticketDeleted'));"],
  ["origin:'گدام چین',destination:'گدام کابل'", "origin:req.t('fields.warehouseChina'),destination:req.t('fields.warehouseKabul')"],
  ["must(req.body.container_no,'شماره کانتینر الزامی است.');", "must(req.body.container_no, req.t('validation.containerNoRequired'));"],
  ["flash(req,'success','کانتینر ذخیره شد.');", "flash(req,'success', req.t('flash.containerSaved'));"],
  ["flash(req,'success','کانتینر حذف شد.');", "flash(req,'success', req.t('flash.containerDeleted'));"],
  ["must(cargoId,'جنس الزامی است.');", "must(cargoId, req.t('validation.cargoRequired'));"],
  ["if(!cargo)throw new Error('جنس پیدا نشد.');", "if(!cargo)throw new Error(req.t('validation.cargoNotFound'));"],
  ["flash(req,'success','جنس به کانتینر اضافه شد. می‌توانی جنس بعدی را هم اضافه کنی.');", "flash(req,'success', req.t('flash.cargoAddedToContainer'));"],
  ["flash(req,'success','جنس از کانتینر حذف شد.');", "flash(req,'success', req.t('flash.cargoRemovedFromContainer'));"],
  ["VALUES ('صندوق اصلی','USD',0,1,'',NOW(),NOW())", "VALUES (?,?,?,?,?,NOW(),NOW())"],
  ["async function ensureCashBox(){let box=await one('SELECT * FROM cash_boxes ORDER BY id LIMIT 1');if(!box){const r=await query(\"INSERT INTO cash_boxes (name,currency,opening_balance,is_active,notes,created_at,updated_at) VALUES (?,?,?,?,?,NOW(),NOW())\");box=await one('SELECT * FROM cash_boxes WHERE id=?',[r.insertId]);}return box;}", "async function ensureCashBox(req){let box=await one('SELECT * FROM cash_boxes ORDER BY id LIMIT 1');if(!box){const name=req?.t?req.t('fields.mainCashbox'):'Main Cashbox';const r=await query(\"INSERT INTO cash_boxes (name,currency,opening_balance,is_active,notes,created_at,updated_at) VALUES (?,?,?,?,?,NOW(),NOW())\",[name,'USD',0,1,'']);box=await one('SELECT * FROM cash_boxes WHERE id=?',[r.insertId]);}return box;}"],
  ["must(req.body.box_name,'نام صندوق الزامی است.');", "must(req.body.box_name, req.t('validation.boxNameRequired'));"],
  ["flash(req,'success','تنظیمات صندوق ذخیره شد.');", "flash(req,'success', req.t('flash.cashboxSaved'));"],
  ["must(req.body.title,'عنوان الزامی است.');", "must(req.body.title, req.t('validation.titleRequired'));"],
  ["flash(req,'success','حرکت صندوق ثبت شد.');", "flash(req,'success', req.t('flash.cashMovementSaved'));"],
  ["flash(req,'success','حرکت صندوق حذف شد.');", "flash(req,'success', req.t('flash.cashMovementDeleted'));"],
  ["must(req.body.title,'عنوان هزینه الزامی است.');", "must(req.body.title, req.t('validation.expenseTitleRequired'));"],
  ["flash(req,'success','هزینه بروزرسانی شد و صندوق نیز آپدیت شد.');", "flash(req,'success', req.t('flash.expenseUpdated'));"],
  ["flash(req,'success','هزینه جدید ثبت شد و از صندوق کم شد.');", "flash(req,'success', req.t('flash.expenseCreated'));"],
  ["flash(req,'success','هزینه حذف شد و حرکت مربوطه از صندوق نیز حذف شد.');", "flash(req,'success', req.t('flash.expenseDeleted'));"],
  ["const transportTypes={container:'کانتینر',ship:'کشتی',truck:'موتر',warehouse:'گدام',air:'طیاره',other:'دیگر'};const stages={warehouse:'گدام',loading:'بارگیری',sea:'مسیر بحری',land:'مسیر زمینی',customs:'گمرک',delivery:'تحویل',other:'دیگر'};const statuses={waiting:'منتظر',in_transit:'در مسیر',customs:'در گمرک',delivered:'تحویل شده',cancelled:'لغو شده'};", ''],
  ["await renderPage(req,res,'cargo-locations',{...pageMeta(req,'cargoLocations'),rows,pagination,search,containers,cargoItems,dynamicRoutes,transportTypes,stages,statuses,form});", "await renderPage(req,res,'cargo-locations',{...pageMeta(req,'cargoLocations'),rows,pagination,search,containers,cargoItems,dynamicRoutes,transportTypes:localizedTransportTypes(req.locale),stages:localizedStages(req.locale),statuses:localizedLocationStatuses(req.locale),form});"],
  ["must(req.body.location_name,'موقعیت الزامی است.');", "must(req.body.location_name, req.t('validation.locationRequired'));"],
  ["flash(req,'success','موقعیت جدید ثبت شد.');", "flash(req,'success', req.t('flash.locationSaved'));"],
  ["must(req.body.name,'نام الزامی است.');", "must(req.body.name, req.t('validation.nameRequired'));"],
  ["must(req.body.email,'ایمیل الزامی است.');", "must(req.body.email, req.t('validation.emailRequired'));"],
  ["must(req.body.password,'رمز عبور الزامی است.');", "must(req.body.password, req.t('validation.passwordRequired'));"],
  ["flash(req,'error','این ایمیل قبلاً ثبت شده است.');", "flash(req,'error', req.t('flash.userEmailDuplicate'));"],
  ["flash(req,'success','کاربر بروزرسانی شد.');", "flash(req,'success', req.t('flash.userUpdated'));"],
  ["flash(req,'success','کاربر جدید ثبت شد.');", "flash(req,'success', req.t('flash.userCreated'));"],
  ["flash(req,'error','نمی‌توانی حساب خودت را حذف کنی.');", "flash(req,'error', req.t('flash.userSelfDelete'));"],
  ["flash(req,'error','حداقل یک مدیر سیستم باید باقی بماند.');", "flash(req,'error', req.t('flash.adminRequired'));"],
  ["flash(req,'success','کاربر حذف شد.');", "flash(req,'success', req.t('flash.userDeleted'));"],
  ["flash(req,'success','دریافت بروزرسانی شد و صندوق نیز آپدیت شد.');", "flash(req,'success', req.t('flash.paymentUpdated'));"],
  ["flash(req,'success','دریافت جدید ثبت شد و به صندوق اضافه شد.');", "flash(req,'success', req.t('flash.paymentCreated'));"],
  ["flash(req,'success','دریافت حذف شد و حرکت مربوطه از صندوق نیز حذف شد.');", "flash(req,'success', req.t('flash.paymentDeleted'));"],
  ['const blockers=await customerDeleteBlockers(id);', 'const blockers=await customerDeleteBlockers(id, req);'],
  ['await ensureCashBox()', 'await ensureCashBox(req)'],
];

for (const [from, to] of replacements) {
  if (!src.includes(from)) {
    console.warn('MISSING:', from.slice(0, 80));
    continue;
  }
  src = src.split(from).join(to);
}

fs.writeFileSync(file, src);
console.log('Patched resources.js');
