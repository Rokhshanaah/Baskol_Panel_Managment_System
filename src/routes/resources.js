import express from 'express';
import bcrypt from 'bcryptjs';
import { hasColumn, hasTable, one, query, transaction } from '../db.js';
import { asyncRoute, flash } from '../utils/http.js';
import { int, like, n, nullableInt, nullableText, text, today } from '../utils/format.js';
import { activeRelationCount, generateSequentialCode, pageNumber, paginateQuery, relationCount, searchText, softDelete } from '../utils/resource.js';
import { resolvePerPage } from '../utils/settings.js';
import { blockerSeparator, localizedLocationStatuses, localizedStages, localizedTransportTypes, pageMeta } from '../utils/i18n.js';
import { renderPage } from '../utils/view.js';
import { logActivity } from '../services/activity.js';
import { requireAdmin } from '../middleware/auth.js';
import { PAGE_PERMISSIONS, permissionsFromRows, ROLE_PRESETS, normalizeRole } from '../utils/permissions.js';
import { localizedPagePermissions, localizedUserRoles } from '../utils/i18n.js';
import { photoUploadMiddleware, resolveUploadedPhoto } from '../utils/upload.js';
import { getDefaultCurrency, getEnabledCurrencies, moneyFormNative, nativeMoneyFields } from '../utils/currency.js';
import { createCargoRouteExpense, syncExpenseCashbox } from '../services/expense-sync.js';
import { getCargoBillingSummary, fetchCustomerReceivablesFromBilling } from '../services/cargo-billing.js';

export const resourcesRouter = express.Router();

function containerReturnPath(req, containerId) {
  return text(req.body.return_to) === 'container-loading'
    ? `/container-loading?container=${containerId}`
    : `/containers?container=${containerId}`;
}
function value(obj, key, fallback = '') { return obj?.[key] ?? fallback; }
function must(valueToCheck, message) { if (text(valueToCheck) === '') throw new Error(message); }
function safeRedirect(res, path) { res.redirect(path); }

async function customerDeleteBlockers(customerId, req) {
  const blockers = [];
  const cargoItems = await relationCount('cargo_items', 'customer_id', customerId);
  if (cargoItems > 0) blockers.push(req.t('blockers.customerCargoItems', { count: cargoItems }));
  const activeCargo = await activeRelationCount('cargo_items', 'customer_id', customerId);
  if (activeCargo > 0) blockers.push(req.t('blockers.customerActiveCargo', { count: activeCargo }));
  const tickets = await relationCount('weighbridge_tickets', 'customer_id', customerId);
  if (tickets > 0) blockers.push(req.t('blockers.customerTickets', { count: tickets }));
  const payments = await relationCount('payments', 'customer_id', customerId);
  if (payments > 0) blockers.push(req.t('blockers.customerPayments', { count: payments }));
  const expenses = await relationCount('expenses', 'customer_id', customerId);
  if (expenses > 0) blockers.push(req.t('blockers.customerExpenses', { count: expenses }));
  if (await hasTable('shipping_containers') && await hasColumn('shipping_containers', 'customer_id')) {
    const activeContainers = await activeRelationCount('shipping_containers', 'customer_id', customerId);
    if (activeContainers > 0) blockers.push(req.t('blockers.customerContainers', { count: activeContainers }));
  }
  if (await hasTable('cargo_locations') && await hasTable('cargo_items')) {
    const row = await one(`SELECT COUNT(*) AS c FROM cargo_locations cl JOIN cargo_items ci ON ci.id=cl.cargo_item_id WHERE ci.customer_id=?`, [customerId]);
    if (Number(row?.c || 0) > 0) blockers.push(req.t('blockers.customerLocations', { count: row.c }));
  }
  return blockers;
}

resourcesRouter.get('/customers', asyncRoute(async (req, res) => {
  const search = searchText(req); const page = pageNumber(req); const params = [];
  let where = 'WHERE deleted_at IS NULL';
  if (search) { where += ' AND (customer_code LIKE ? OR name LIKE ? OR father_name LIKE ? OR phone LIKE ? OR email LIKE ? OR company_name LIKE ? OR tazkira_or_passport LIKE ?)'; for (let i=0;i<7;i++) params.push(like(search)); }
  const { rows, pagination } = await paginateQuery({ countSql:`SELECT COUNT(*) total FROM customers ${where}`, dataSql:`SELECT id,customer_code,name,father_name,phone,email,company_name,tazkira_or_passport,created_at FROM customers ${where} ORDER BY id DESC`, params, page, perPage: resolvePerPage(req) });
  let form = null;
  if (req.query.form === 'create') form = { customer_code: await generateSequentialCode('customers','customer_code','CUS-'), name:'', father_name:'', phone:'', email:'', tazkira_or_passport:'', company_name:'', address:'', notes:'' };
  if (req.query.edit) form = await one('SELECT * FROM customers WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  await renderPage(req,res,'customers',{ ...pageMeta(req, 'customers'), rows, pagination, search, form, editingId:form?.id ?? null, deleteError:req.query.deleteError ? String(req.query.deleteError) : '' });
}));

resourcesRouter.post('/customers/save', photoUploadMiddleware('customers', (req) => {
  const id = nullableInt(req.body?.id);
  return id ? `/customers?edit=${id}` : '/customers?form=create';
}), asyncRoute(async (req,res) => {
  const id = nullableInt(req.body.id); const customerCode = text(req.body.customer_code) || await generateSequentialCode('customers','customer_code','CUS-');
  must(req.body.name, req.t('validation.customerNameRequired'));
  const duplicate = await one('SELECT id FROM customers WHERE customer_code=? AND deleted_at IS NULL AND (? IS NULL OR id<>?) LIMIT 1',[customerCode,id,id]);
  if (duplicate) { flash(req,'error', req.t('flash.customerCodeDuplicate')); return res.redirect(id?`/customers?edit=${id}`:'/customers?form=create'); }
  const hasPhoto = await hasColumn('customers', 'photo_path');
  const existing = id && hasPhoto ? await one('SELECT photo_path FROM customers WHERE id=? AND deleted_at IS NULL', [id]) : null;
  const photoPath = hasPhoto ? resolveUploadedPhoto(req, 'customers', existing?.photo_path ?? null) : null;
  const payload=[customerCode,text(req.body.name),nullableText(req.body.father_name),nullableText(req.body.phone),nullableText(req.body.email),nullableText(req.body.tazkira_or_passport),nullableText(req.body.company_name),nullableText(req.body.address),nullableText(req.body.notes)];
  if (id) {
    if (hasPhoto) {
      await query('UPDATE customers SET customer_code=?,name=?,father_name=?,phone=?,email=?,tazkira_or_passport=?,company_name=?,address=?,notes=?,photo_path=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL',[...payload, photoPath, id]);
    } else {
      await query('UPDATE customers SET customer_code=?,name=?,father_name=?,phone=?,email=?,tazkira_or_passport=?,company_name=?,address=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL',[...payload,id]);
    }
    flash(req,'success', req.t('flash.customerUpdated'));
  } else {
    if (hasPhoto) {
      await query('INSERT INTO customers (customer_code,name,father_name,phone,email,tazkira_or_passport,company_name,address,notes,photo_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',[...payload, photoPath]);
    } else {
      await query('INSERT INTO customers (customer_code,name,father_name,phone,email,tazkira_or_passport,company_name,address,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())',payload);
    }
    flash(req,'success', req.t('flash.customerCreated'));
  }
  res.redirect('/customers');
}));

resourcesRouter.post('/customers/:id/delete', asyncRoute(async (req,res) => {
  const id=int(req.params.id); const blockers=await customerDeleteBlockers(id, req);
  if (blockers.length) { flash(req,'error', req.t('flash.customerDeleteBlocked', { reasons: blockers.join(blockerSeparator(req.locale)) })); return res.redirect('/customers'); }
  await softDelete('customers',id); flash(req,'success', req.t('flash.customerDeleted')); res.redirect('/customers');
}));

async function cargoDeleteBlockers(cargoId, req) {
  const blockers=[]; const item=await one('SELECT id,status FROM cargo_items WHERE id=? AND deleted_at IS NULL',[cargoId]);
  if (['in_container','in_transit'].includes(item?.status)) blockers.push(req.t('blockers.cargoInTransit'));
  for (const [table,labelKey] of [['weighbridge_tickets','labelTicket'],['cargo_locations','labelLocation'],['payments','labelPayment'],['expenses','labelExpense']]) {
    const c=await relationCount(table,'cargo_item_id',cargoId); if(c>0) blockers.push(req.t('blockers.cargoRelated', { count: c, label: req.t(`blockers.${labelKey}`) }));
  }
  let containerCount=0; for (const table of ['shipping_container_items','container_cargo_items','cargo_container_items','loading_items']) containerCount += await relationCount(table,'cargo_item_id',cargoId);
  if(containerCount>0) blockers.push(req.t('blockers.cargoLoadingRows', { count: containerCount }));
  return blockers;
}

resourcesRouter.get('/cargo-items', asyncRoute(async (req,res)=>{
  const search=searchText(req), page=pageNumber(req), params=[]; let where='WHERE ci.deleted_at IS NULL';
  if(search){ where += ' AND (ci.cargo_code LIKE ? OR ci.name LIKE ? OR ci.status LIKE ? OR c.name LIKE ? OR c.customer_code LIKE ?)'; for(let i=0;i<5;i++) params.push(like(search)); }
  const {rows,pagination}=await paginateQuery({ countSql:`SELECT COUNT(*) total FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id ${where}`, dataSql:`SELECT ci.*,c.name customer_name,c.customer_code FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id ${where} ORDER BY ci.id DESC`,params,page,perPage:resolvePerPage(req)});
  let form=null; if(req.query.form==='create') form={cargo_code:await generateSequentialCode('cargo_items','cargo_code','CRG-'),customer_id:'',name:'',carton_count:0,length_cm:0,width_cm:0,height_cm:0,gross_weight_kg:0,status:'registered',description:''};
  if(req.query.edit) form=await one('SELECT * FROM cargo_items WHERE id=? AND deleted_at IS NULL',[int(req.query.edit)]);
  const customers=form?await query('SELECT id,name,customer_code FROM customers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500'):[];
  await renderPage(req,res,'cargo-items',{ ...pageMeta(req, 'cargoItems'), rows,pagination,search,form,editingId:form?.id??null,customers});
}));

resourcesRouter.post('/cargo-items/save', asyncRoute(async(req,res)=>{
  const id=nullableInt(req.body.id); const cargoCode=text(req.body.cargo_code)||await generateSequentialCode('cargo_items','cargo_code','CRG-'); must(req.body.customer_id, req.t('validation.customerRequired')); must(req.body.name, req.t('validation.cargoNameRequired'));
  const customerId=nullableInt(req.body.customer_id); const duplicate=await one('SELECT id FROM cargo_items WHERE cargo_code=? AND deleted_at IS NULL AND (? IS NULL OR id<>?) LIMIT 1',[cargoCode,id,id]);
  if(duplicate){flash(req,'error', req.t('flash.cargoCodeDuplicate'));return res.redirect(id?`/cargo-items?edit=${id}`:'/cargo-items?form=create');}
  const carton=int(req.body.carton_count,0), l=n(req.body.length_cm),w=n(req.body.width_cm),h=n(req.body.height_cm), cbm=(l*w*h)/1000000,totalCbm=cbm*carton;
  const vals=[customerId,cargoCode,text(req.body.name),carton,l,w,h,cbm,totalCbm,n(req.body.gross_weight_kg),0,text(req.body.status)||'registered',nullableText(req.body.description)];
  const hasBilling = await hasColumn('cargo_items', 'billing_mode');
  if(id){
    await query('UPDATE cargo_items SET customer_id=?,cargo_code=?,name=?,carton_count=?,length_cm=?,width_cm=?,height_cm=?,cbm_per_carton=?,total_cbm=?,gross_weight_kg=?,value_usd=?,status=?,description=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL',[...vals,id]);
    flash(req,'success', req.t('flash.cargoUpdated'));
  } else {
    if (hasBilling) {
      await query('INSERT INTO cargo_items (customer_id,cargo_code,name,carton_count,length_cm,width_cm,height_cm,cbm_per_carton,total_cbm,gross_weight_kg,value_usd,status,description,billing_mode,contract_amount,contract_currency,commission_percent,contract_route,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',[...vals,'itemized',0,getDefaultCurrency(),0,null]);
    } else {
      await query('INSERT INTO cargo_items (customer_id,cargo_code,name,carton_count,length_cm,width_cm,height_cm,cbm_per_carton,total_cbm,gross_weight_kg,value_usd,status,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',vals);
    }
    flash(req,'success', req.t('flash.cargoCreated'));
  }
  res.redirect('/cargo-items');
}));

resourcesRouter.get('/cargo-items/:id/billing', asyncRoute(async (req, res) => {
  const cargoId = int(req.params.id);
  const billing = await getCargoBillingSummary(cargoId);
  if (!billing) {
    flash(req, 'error', req.t('validation.cargoNotFound'));
    return res.redirect('/cargo-items');
  }
  const payments = await query(`
    SELECT p.* FROM payments p
    WHERE p.deleted_at IS NULL AND p.cargo_item_id = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `, [cargoId]);
  await renderPage(req, res, 'cargo-billing', {
    ...pageMeta(req, 'cargoBilling'),
    billing, payments, enabledCurrencies: getEnabledCurrencies(),
  });
}));

resourcesRouter.post('/cargo-items/:id/billing/settings', asyncRoute(async (req, res) => {
  const cargoId = int(req.params.id);
  if (!(await one('SELECT id FROM cargo_items WHERE id=? AND deleted_at IS NULL', [cargoId]))) {
    flash(req, 'error', req.t('validation.cargoNotFound'));
    return res.redirect('/cargo-items');
  }
  if (!(await hasColumn('cargo_items', 'billing_mode'))) {
    return res.redirect(`/cargo-items/${cargoId}/billing`);
  }
  const billingMode = text(req.body.billing_mode) || 'itemized';
  await query(`
    UPDATE cargo_items SET billing_mode=?, contract_amount=?, contract_currency=?, commission_percent=?, contract_route=?, updated_at=NOW()
    WHERE id=? AND deleted_at IS NULL
  `, [
    billingMode,
    n(req.body.contract_amount ?? req.body.amount),
    text(req.body.contract_currency || req.body.currency) || getDefaultCurrency(),
    n(req.body.commission_percent),
    nullableText(req.body.contract_route),
    cargoId,
  ]);
  flash(req, 'success', req.t('flash.cargoBillingSaved'));
  res.redirect(`/cargo-items/${cargoId}/billing`);
}));

resourcesRouter.post('/cargo-items/:id/billing/expenses', asyncRoute(async (req, res) => {
  const cargoId = int(req.params.id);
  const cargo = await one('SELECT id, customer_id FROM cargo_items WHERE id=? AND deleted_at IS NULL', [cargoId]);
  if (!cargo) {
    flash(req, 'error', req.t('validation.cargoNotFound'));
    return res.redirect('/cargo-items');
  }
  must(req.body.title, req.t('validation.expenseTitleRequired'));
  const { amount, currency, rate, amountUsd } = nativeMoneyFields(req.body);
  const billable = req.body.billable_to_customer === '0' || req.body.billable_to_customer === 0 ? 0 : 1;
  await createCargoRouteExpense(req, {
    cargoId,
    customerId: cargo.customer_id,
    title: text(req.body.title),
    category: nullableText(req.body.category),
    amount,
    currency,
    rate,
    amountUsd,
    expenseDate: nullableText(req.body.expense_date),
    notes: nullableText(req.body.notes),
    routeFrom: nullableText(req.body.route_from),
    routeTo: nullableText(req.body.route_to),
    billable,
  });
  flash(req, 'success', req.t('flash.expenseCreated'));
  res.redirect(`/cargo-items/${cargoId}/billing`);
}));

resourcesRouter.post('/cargo-items/:id/billing/expenses/:expenseId/delete', asyncRoute(async (req, res) => {
  const cargoId = int(req.params.id);
  const expenseId = int(req.params.expenseId);
  const expense = await one('SELECT id FROM expenses WHERE id=? AND cargo_item_id=? AND deleted_at IS NULL', [expenseId, cargoId]);
  if (!expense) {
    flash(req, 'error', req.t('validation.cargoNotFound'));
    return res.redirect(`/cargo-items/${cargoId}/billing`);
  }
  if (await hasColumn('cash_transactions', 'expense_id')) {
    await query("DELETE FROM cash_transactions WHERE expense_id=? AND source_type='expense'", [expenseId]);
  }
  await softDelete('expenses', expenseId);
  flash(req, 'success', req.t('flash.expenseDeleted'));
  res.redirect(`/cargo-items/${cargoId}/billing`);
}));

resourcesRouter.post('/cargo-items/:id/delete', asyncRoute(async(req,res)=>{const id=int(req.params.id);const blockers=await cargoDeleteBlockers(id, req);if(blockers.length){flash(req,'error', req.t('flash.cargoDeleteBlocked', { reasons: blockers.join(blockerSeparator(req.locale)) }));return res.redirect('/cargo-items');}await softDelete('cargo_items',id);flash(req,'success', req.t('flash.cargoDeleted'));res.redirect('/cargo-items');}));

async function generateTicketNo() {
  return generateSequentialCode('weighbridge_tickets', 'ticket_no', 'WB-');
}

resourcesRouter.get('/weighbridge-tickets', asyncRoute(async(req,res)=>{
 const search=searchText(req),page=pageNumber(req),params=[];let where='WHERE wt.deleted_at IS NULL'; if(search){where+=' AND (wt.ticket_no LIKE ? OR wt.vehicle_plate LIKE ? OR wt.driver_name LIKE ? OR wt.driver_phone LIKE ? OR c.name LIKE ? OR ci.name LIKE ? OR ci.cargo_code LIKE ?)';for(let i=0;i<7;i++)params.push(like(search));}
 const {rows,pagination}=await paginateQuery({countSql:`SELECT COUNT(*) total FROM weighbridge_tickets wt LEFT JOIN customers c ON c.id=wt.customer_id LEFT JOIN cargo_items ci ON ci.id=wt.cargo_item_id ${where}`,dataSql:`SELECT wt.*,c.name customer_name,c.customer_code,ci.name cargo_name,ci.cargo_code FROM weighbridge_tickets wt LEFT JOIN customers c ON c.id=wt.customer_id LEFT JOIN cargo_items ci ON ci.id=wt.cargo_item_id ${where} ORDER BY wt.id DESC`,params,page,perPage:resolvePerPage(req)});
 let form=null;if(req.query.form==='create')form={ticket_no:await generateTicketNo(),customer_id:'',cargo_item_id:'',vehicle_plate:'',driver_name:'',driver_phone:'',weigh_type:'loading',first_weight_kg:'',second_weight_kg:'',carton_count:'',notes:''};if(req.query.edit)form=await one('SELECT * FROM weighbridge_tickets WHERE id=? AND deleted_at IS NULL',[int(req.query.edit)]);
 const customers=form?await query('SELECT id,name,customer_code FROM customers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500'):[]; const cargoItems=form?await query('SELECT ci.id,ci.customer_id,ci.cargo_code,ci.name,ci.carton_count,ci.total_cbm,ci.gross_weight_kg,c.name customer_name FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 700'):[];
 await renderPage(req,res,'weighbridge-tickets',{ ...pageMeta(req, 'weighbridge'), rows,pagination,search,form,editingId:form?.id??null,customers,cargoItems});
}));

resourcesRouter.post('/weighbridge-tickets/save', asyncRoute(async(req,res)=>{const id=nullableInt(req.body.id),ticketNo=text(req.body.ticket_no)||await generateTicketNo(); must(req.body.first_weight_kg, req.t('validation.firstWeightRequired'));must(req.body.second_weight_kg, req.t('validation.secondWeightRequired'));const first=n(req.body.first_weight_kg),second=n(req.body.second_weight_kg),net=Math.abs(first-second);const vals=[ticketNo,nullableInt(req.body.customer_id),nullableInt(req.body.cargo_item_id),nullableText(req.body.vehicle_plate),nullableText(req.body.driver_name),nullableText(req.body.driver_phone),text(req.body.weigh_type)||'loading',first,second,net,int(req.body.carton_count,0),nullableText(req.body.notes)];if(id){await query('UPDATE weighbridge_tickets SET ticket_no=?,customer_id=?,cargo_item_id=?,vehicle_plate=?,driver_name=?,driver_phone=?,weigh_type=?,first_weight_kg=?,second_weight_kg=?,net_weight_kg=?,carton_count=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL',[...vals,id]);flash(req,'success', req.t('flash.ticketUpdated'));}else{await query('INSERT INTO weighbridge_tickets (ticket_no,customer_id,cargo_item_id,vehicle_plate,driver_name,driver_phone,weigh_type,first_weight_kg,second_weight_kg,net_weight_kg,carton_count,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',vals);flash(req,'success', req.t('flash.ticketCreated'));}res.redirect('/weighbridge-tickets');}));
resourcesRouter.post('/weighbridge-tickets/:id/delete', asyncRoute(async(req,res)=>{await softDelete('weighbridge_tickets',int(req.params.id));flash(req,'success', req.t('flash.ticketDeleted'));res.redirect('/weighbridge-tickets');}));

async function recalcContainer(containerId, db=query){
 const totals=await one('SELECT COALESCE(SUM(cbm_loaded),0) total_cbm FROM container_cargo_items WHERE shipping_container_id=?',[containerId]); const container=await one('SELECT freight_usd FROM shipping_containers WHERE id=?',[containerId]); const total=n(totals?.total_cbm), freight=n(container?.freight_usd), per=total>0?freight/total:0; await db('UPDATE shipping_containers SET total_loaded_cbm=?,freight_per_cbm_usd=?,updated_at=NOW() WHERE id=?',[total,per,containerId]); await db('UPDATE container_cargo_items SET freight_share_usd=ROUND(cbm_loaded * ?,2),updated_at=NOW() WHERE shipping_container_id=?',[per,containerId]);
}

resourcesRouter.get('/containers', asyncRoute(async(req,res)=>{
 const search=searchText(req),page=pageNumber(req),params=[];let where='WHERE sc.deleted_at IS NULL';if(search){where+=' AND (sc.container_no LIKE ? OR sc.ship_name LIKE ? OR sc.seal_no LIKE ? OR sc.booking_no LIKE ? OR sc.current_location LIKE ? OR sc.origin LIKE ? OR sc.destination LIKE ?)';for(let i=0;i<7;i++)params.push(like(search));}
 const {rows:containers,pagination}=await paginateQuery({countSql:`SELECT COUNT(*) total FROM shipping_containers sc ${where}`,dataSql:`SELECT sc.*,(SELECT COUNT(*) FROM container_cargo_items x WHERE x.shipping_container_id=sc.id) items_count FROM shipping_containers sc ${where} ORDER BY sc.id DESC`,params,page,perPage:resolvePerPage(req)});
 let form=null;if(req.query.form==='create'){const stamp=new Date().toISOString().replace(/\D/g,'').slice(2,14);const dc=getDefaultCurrency();form={container_no:`CONT-${stamp}`,seal_no:'',booking_no:'',ship_name:'',container_type:'40HQ',origin:req.t('fields.warehouseChina'),destination:req.t('fields.warehouseKabul'),current_location:'',status:'draft',departure_date:'',arrival_date:'',amount:'',currency:dc,notes:''};}if(req.query.edit){form=await one('SELECT * FROM shipping_containers WHERE id=? AND deleted_at IS NULL',[int(req.query.edit)]);if(form)Object.assign(form,moneyFormNative(form.freight_usd,form.freight_currency));}
 const selectedId=nullableInt(req.query.container); let selectedContainer=null,cargoItems=[]; if(selectedId){selectedContainer=await one('SELECT * FROM shipping_containers WHERE id=? AND deleted_at IS NULL',[selectedId]);if(selectedContainer){selectedContainer.items=await query(`SELECT cci.*,ci.cargo_code,ci.name cargo_name,c.name customer_name,c.customer_code FROM container_cargo_items cci LEFT JOIN cargo_items ci ON ci.id=cci.cargo_item_id LEFT JOIN customers c ON c.id=COALESCE(cci.customer_id,ci.customer_id) WHERE cci.shipping_container_id=? ORDER BY cci.id DESC`,[selectedId]);cargoItems=await query(`SELECT ci.id,ci.customer_id,ci.cargo_code,ci.name,ci.carton_count,ci.total_cbm,ci.gross_weight_kg,ci.status,c.name customer_name,c.customer_code FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 700`);}}
 await renderPage(req,res,'containers',{ ...pageMeta(req, 'containers'), containers,pagination,search,form,editingId:form?.id??null,selectedContainer,cargoItems});
}));

resourcesRouter.post('/containers/save', asyncRoute(async(req,res)=>{const id=nullableInt(req.body.id);must(req.body.container_no, req.t('validation.containerNoRequired'));const { amount, currency } = nativeMoneyFields(req.body);const vals=[text(req.body.container_no),nullableText(req.body.seal_no),nullableText(req.body.booking_no),nullableText(req.body.ship_name),text(req.body.container_type)||'40HQ',nullableText(req.body.origin),nullableText(req.body.destination),nullableText(req.body.current_location),text(req.body.status)||'draft',nullableText(req.body.departure_date),nullableText(req.body.arrival_date),amount,currency,nullableText(req.body.notes)];let containerId=id;if(id){await query('UPDATE shipping_containers SET container_no=?,seal_no=?,booking_no=?,ship_name=?,container_type=?,origin=?,destination=?,current_location=?,status=?,departure_date=?,arrival_date=?,freight_usd=?,freight_currency=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL',[...vals,id]);}else{const result=await query('INSERT INTO shipping_containers (container_no,seal_no,booking_no,ship_name,container_type,origin,destination,current_location,status,departure_date,arrival_date,freight_usd,freight_currency,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',vals);containerId=result.insertId;}await recalcContainer(containerId);await logActivity(req,'containers',id?'update':'create',`کانتینر ${text(req.body.container_no)} ذخیره شد.`);flash(req,'success', req.t('flash.containerSaved'));res.redirect(`/containers?container=${containerId}`);}));

resourcesRouter.post('/containers/:id/delete', asyncRoute(async(req,res)=>{const id=int(req.params.id);const c=await one('SELECT container_no FROM shipping_containers WHERE id=?',[id]);await transaction(async tx=>{await tx.query('DELETE FROM container_cargo_items WHERE shipping_container_id=?',[id]);if(await hasColumn('shipping_containers','deleted_at'))await tx.query('UPDATE shipping_containers SET deleted_at=NOW(),updated_at=NOW() WHERE id=?',[id]);else await tx.query('DELETE FROM shipping_containers WHERE id=?',[id]);});await logActivity(req,'containers','delete',`کانتینر ${c?.container_no||id} حذف شد.`);flash(req,'success', req.t('flash.containerDeleted'));res.redirect('/containers');}));

resourcesRouter.post('/containers/:id/cargo', asyncRoute(async(req,res)=>{const containerId=int(req.params.id),cargoId=nullableInt(req.body.cargo_item_id);must(cargoId, req.t('validation.cargoRequired'));const cargo=await one('SELECT id,customer_id,name FROM cargo_items WHERE id=? AND deleted_at IS NULL',[cargoId]);if(!cargo)throw new Error(req.t('validation.cargoNotFound'));await query('INSERT INTO container_cargo_items (shipping_container_id,cargo_item_id,customer_id,cartons_loaded,cbm_loaded,weight_loaded_kg,freight_share_usd,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,NOW(),NOW())',[containerId,cargoId,cargo.customer_id,int(req.body.cartons_loaded,0),n(req.body.cbm_loaded),n(req.body.weight_loaded_kg),nullableText(req.body.item_notes)]);await query("UPDATE cargo_items SET status='in_container',updated_at=NOW() WHERE id=?",[cargoId]);await recalcContainer(containerId);const c=await one('SELECT container_no FROM shipping_containers WHERE id=?',[containerId]);await logActivity(req,'containers','add_cargo',`جنس ${cargo.name} به کانتینر ${c?.container_no||containerId} اضافه شد.`);flash(req,'success', req.t('flash.cargoAddedToContainer'));res.redirect(containerReturnPath(req, containerId));}));

resourcesRouter.post('/containers/:containerId/cargo/:itemId/delete', asyncRoute(async(req,res)=>{const containerId=int(req.params.containerId),itemId=int(req.params.itemId);const item=await one('SELECT cargo_item_id FROM container_cargo_items WHERE id=? AND shipping_container_id=?',[itemId,containerId]);if(item){await query('DELETE FROM container_cargo_items WHERE id=?',[itemId]);const still=await one('SELECT id FROM container_cargo_items WHERE cargo_item_id=? LIMIT 1',[item.cargo_item_id]);if(!still)await query("UPDATE cargo_items SET status='registered',updated_at=NOW() WHERE id=?",[item.cargo_item_id]);await recalcContainer(containerId);}flash(req,'success', req.t('flash.cargoRemovedFromContainer'));res.redirect(containerReturnPath(req, containerId));}));

async function ensureCashBox(req){let box=await one('SELECT * FROM cash_boxes ORDER BY id LIMIT 1');if(!box){const name=req?.t?req.t('fields.mainCashbox'):'Main Cashbox';const r=await query("INSERT INTO cash_boxes (name,currency,opening_balance,is_active,notes,created_at,updated_at) VALUES (?,?,?,?,?,NOW(),NOW())",[name,'USD',0,1,'']);box=await one('SELECT * FROM cash_boxes WHERE id=?',[r.insertId]);}return box;}

resourcesRouter.get('/cashbox', asyncRoute(async (req, res) => {
  const box = await ensureCashBox(req);
  const search = searchText(req);
  const page = pageNumber(req);
  const cashType = text(req.query.cash_type);
  const params = [box.id];
  let searchClause = '';
  if (search) {
    searchClause = ' AND (transaction_no LIKE ? OR title LIKE ? OR type LIKE ? OR currency LIKE ? OR notes LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(like(search));
  }
  let typeClause = '';
  if (cashType) { typeClause = ' AND type=?'; params.push(cashType); }
  const summary = await one(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_usd ELSE 0 END),0) income_total,COALESCE(SUM(CASE WHEN type='expense' THEN amount_usd ELSE 0 END),0) expense_total,COALESCE(SUM(CASE WHEN type='withdraw' THEN amount_usd ELSE 0 END),0) withdraw_total,COALESCE(SUM(CASE WHEN type='adjustment' THEN amount_usd ELSE 0 END),0) adjustment_total FROM cash_transactions WHERE cash_box_id=?`, [box.id]);
  const { rows: transactions, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM cash_transactions WHERE cash_box_id=? ${searchClause}${typeClause}`,
    dataSql: `SELECT * FROM cash_transactions WHERE cash_box_id=? ${searchClause}${typeClause} ORDER BY transaction_date DESC, id DESC`,
    params, page, perPage: resolvePerPage(req),
  });
  const opening = n(box.opening_balance);
  const income = n(summary?.income_total);
  const expensesTotal = n(summary?.expense_total);
  const withdraws = n(summary?.withdraw_total);
  const adjustments = n(summary?.adjustment_total);
  const outgoing = expensesTotal + withdraws;
  const balance = opening + income - outgoing + adjustments;
  let transactionForm = null;
  let boxForm = null;
  if (req.query.transaction) {
    const dc = getDefaultCurrency();
    transactionForm = { transaction_no: await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-'), type: 'income', title: '', amount: '', currency: dc, transaction_date: today(), notes: '' };
  }
  if (req.query.box) boxForm = { box_name: box.name, box_currency: box.currency, opening_balance: box.opening_balance, box_notes: box.notes };
  await renderPage(req, res, 'cashbox', {
    ...pageMeta(req, 'cashbox'), selectedBox: box, transactions, pagination, search, cashType,
    opening_balance: opening, income, expensesTotal, withdraws, outgoing, adjustments, balance, transactionForm, boxForm,
  });
}));

resourcesRouter.post('/cashbox/box', asyncRoute(async(req,res)=>{const box=await ensureCashBox(req);must(req.body.box_name, req.t('validation.boxNameRequired'));await query('UPDATE cash_boxes SET name=?,currency=?,opening_balance=?,is_active=1,notes=?,updated_at=NOW() WHERE id=?',[text(req.body.box_name),text(req.body.box_currency)||'USD',n(req.body.opening_balance),nullableText(req.body.box_notes),box.id]);flash(req,'success', req.t('flash.cashboxSaved'));res.redirect('/cashbox');}));
resourcesRouter.post('/cashbox/transactions', asyncRoute(async(req,res)=>{const box=await ensureCashBox(req);must(req.body.title, req.t('validation.titleRequired'));const { amount, currency, rate, amountUsd } = nativeMoneyFields(req.body);const no=text(req.body.transaction_no)||await generateSequentialCode('cash_transactions','transaction_no','CASH-');await query('INSERT INTO cash_transactions (cash_box_id,transaction_no,type,title,amount,currency,rate_to_usd,amount_usd,transaction_date,source_type,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,\'manual\',?,NOW(),NOW())',[box.id,no,text(req.body.type)||'income',text(req.body.title),amount,currency,rate,amountUsd,nullableText(req.body.transaction_date),nullableText(req.body.notes)]);flash(req,'success', req.t('flash.cashMovementSaved'));res.redirect('/cashbox');}));
resourcesRouter.post('/cashbox/transactions/:id/delete', asyncRoute(async(req,res)=>{await query('DELETE FROM cash_transactions WHERE id=?',[int(req.params.id)]);flash(req,'success', req.t('flash.cashMovementDeleted'));res.redirect('/cashbox');}));

resourcesRouter.get('/expenses', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const scope = text(req.query.scope);
  const category = text(req.query.category);
  const params = [];
  let where = 'WHERE e.deleted_at IS NULL';
  if (scope) { where += ' AND e.scope=?'; params.push(scope); }
  if (category) { where += ' AND e.category LIKE ?'; params.push(`%${category}%`); }
  if (search) {
    where += ' AND (e.expense_no LIKE ? OR e.scope LIKE ? OR e.title LIKE ? OR e.category LIKE ? OR e.currency LIKE ? OR c.name LIKE ? OR c.customer_code LIKE ? OR ci.name LIKE ? OR ci.cargo_code LIKE ? OR sc.container_no LIKE ? OR vt.trip_no LIKE ? OR v.plate_no LIKE ?)';
    for (let i = 0; i < 12; i++) params.push(like(search));
  }
  const joins = `FROM expenses e
    LEFT JOIN customers c ON c.id=e.customer_id
    LEFT JOIN cargo_items ci ON ci.id=e.cargo_item_id
    LEFT JOIN shipping_containers sc ON sc.id=e.shipping_container_id
    LEFT JOIN vehicle_trips vt ON vt.id=e.vehicle_trip_id
    LEFT JOIN vehicles v ON v.id=vt.vehicle_id`;
  const { rows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total ${joins} ${where}`,
    dataSql: `SELECT e.*, c.name customer_name, c.customer_code, ci.name cargo_name, ci.cargo_code, sc.container_no, vt.trip_no, v.plate_no ${joins} ${where} ORDER BY e.id DESC`,
    params, page, perPage: resolvePerPage(req),
  });
  let form = null;
  if (req.query.form === 'create') form = { expense_no: await generateSequentialCode('expenses', 'expense_no', 'EXP-'), scope: 'company', title: '', category: '', customer_id: '', cargo_item_id: '', shipping_container_id: '', amount: '', currency: 'USD', rate_to_usd: '1', expense_date: today(), notes: '', route_from: '', route_to: '', billable_to_customer: 1 };
  if (req.query.edit) form = await one('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  let customers = [];
  let cargoItems = [];
  let containers = [];
  if (form) {
    customers = await query('SELECT id,name,customer_code FROM customers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500');
    cargoItems = await query('SELECT ci.id,ci.customer_id,ci.name,ci.cargo_code,c.name customer_name,c.customer_code FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 700');
    containers = await query('SELECT id,container_no FROM shipping_containers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500');
  }
  await renderPage(req, res, 'expenses', {
    ...pageMeta(req, 'expenses'), rows, pagination, search, form, editingId: form?.id ?? null,
    customers, cargoItems, containers, scope, category,
  });
}));

resourcesRouter.post('/expenses/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const expenseNo = text(req.body.expense_no) || await generateSequentialCode('expenses', 'expense_no', 'EXP-');
  const scope = text(req.body.scope) || 'company';
  must(req.body.title, req.t('validation.expenseTitleRequired'));
  let customerId = nullableInt(req.body.customer_id);
  let cargoId = nullableInt(req.body.cargo_item_id);
  let containerId = nullableInt(req.body.shipping_container_id);
  if (scope === 'company') { customerId = null; cargoId = null; containerId = null; }
  if (scope === 'cargo') containerId = null;
  if (scope === 'container') cargoId = null;
  const amount = n(req.body.amount);
  const currency = text(req.body.currency) || 'USD';
  const rate = 1;
  const amountUsd = amount;
  const routeFrom = nullableText(req.body.route_from);
  const routeTo = nullableText(req.body.route_to);
  const billable = req.body.billable_to_customer === '0' || req.body.billable_to_customer === 0 ? 0 : 1;
  const hasRoute = await hasColumn('expenses', 'route_from');
  const vals = [expenseNo, scope, text(req.body.title), nullableText(req.body.category), customerId, cargoId, containerId, amount, currency, rate, amountUsd, nullableText(req.body.expense_date), nullableText(req.body.notes)];
  let expenseId = id;
  if (id) {
    if (hasRoute) {
      await query('UPDATE expenses SET expense_no=?,scope=?,title=?,category=?,customer_id=?,cargo_item_id=?,shipping_container_id=?,amount=?,currency=?,rate_to_usd=?,amount_usd=?,expense_date=?,notes=?,route_from=?,route_to=?,billable_to_customer=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, routeFrom, routeTo, billable, id]);
    } else {
      await query('UPDATE expenses SET expense_no=?,scope=?,title=?,category=?,customer_id=?,cargo_item_id=?,shipping_container_id=?,amount=?,currency=?,rate_to_usd=?,amount_usd=?,expense_date=?,notes=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, id]);
    }
    flash(req, 'success', req.t('flash.expenseUpdated'));
  } else {
    let r;
    if (hasRoute) {
      r = await query('INSERT INTO expenses (expense_no,scope,title,category,customer_id,cargo_item_id,shipping_container_id,amount,currency,rate_to_usd,amount_usd,expense_date,notes,route_from,route_to,billable_to_customer,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', [...vals, routeFrom, routeTo, billable]);
    } else {
      r = await query('INSERT INTO expenses (expense_no,scope,title,category,customer_id,cargo_item_id,shipping_container_id,amount,currency,rate_to_usd,amount_usd,expense_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', vals);
    }
    expenseId = r.insertId;
    flash(req, 'success', req.t('flash.expenseCreated'));
  }
  await syncExpenseCashbox(expenseId, req);
  res.redirect('/expenses');
}));
resourcesRouter.post('/expenses/:id/delete', asyncRoute(async(req,res)=>{const id=int(req.params.id);if(await hasColumn('cash_transactions','expense_id'))await query("DELETE FROM cash_transactions WHERE expense_id=? AND source_type='expense'",[id]);if(await hasColumn('vehicle_trip_expenses','expense_id'))await query('DELETE FROM vehicle_trip_expenses WHERE expense_id=?',[id]);await softDelete('expenses',id);flash(req,'success', req.t('flash.expenseDeleted'));res.redirect('/expenses');}));


resourcesRouter.get('/cargo-locations', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = "WHERE cl.transport_type <> 'truck'";
  if (search) {
    where += ' AND (cl.transport_type LIKE ? OR cl.transport_no LIKE ? OR cl.stage LIKE ? OR cl.location_name LIKE ? OR cl.status LIKE ? OR sc.container_no LIKE ? OR sc.seal_no LIKE ? OR sc.booking_no LIKE ? OR ci.name LIKE ? OR ci.cargo_code LIKE ?)';
    for (let i = 0; i < 10; i++) params.push(like(search));
  }
  const joins = `FROM cargo_locations cl
    LEFT JOIN shipping_containers sc ON sc.id=cl.shipping_container_id
    LEFT JOIN cargo_items ci ON ci.id=cl.cargo_item_id
    LEFT JOIN customers c ON c.id=ci.customer_id`;
  const { rows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total ${joins} ${where}`,
    dataSql: `SELECT cl.*, sc.container_no, ci.name cargo_name, ci.cargo_code, c.name customer_name ${joins} ${where} ORDER BY cl.location_name ASC, cl.id DESC`,
    params, page, perPage: resolvePerPage(req),
  });
  const containers = await query('SELECT id, container_no, current_location FROM shipping_containers WHERE deleted_at IS NULL ORDER BY id DESC');
  const cargoItems = await query('SELECT ci.id, ci.cargo_code, ci.name, c.name customer_name, c.customer_code FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC');
  const dc = getDefaultCurrency();
  const prefillCargo = nullableInt(req.query.cargo);
  const form = req.query.form === 'create' ? {
    transport_type: 'container', transport_no: '', shipping_container_id: '', cargo_item_id: prefillCargo || '',
    stage: 'warehouse', location_name: '', status: 'waiting', amount: '', currency: dc,
    route_from: '', route_to: '', expense_title: '', category: '', billable_to_customer: 1,
    arrived_at: '', departed_at: '', notes: '',
  } : null;
  await renderPage(req, res, 'cargo-locations', {
    ...pageMeta(req, 'cargoLocations'),
    rows, pagination, search, containers, cargoItems,
    transportTypes: localizedTransportTypes(req.locale),
    stages: localizedStages(req.locale),
    statuses: localizedLocationStatuses(req.locale),
    form,
  });
}));

resourcesRouter.post('/cargo-locations/save', asyncRoute(async (req, res) => {
  must(req.body.location_name, req.t('validation.locationRequired'));
  const containerId = nullableInt(req.body.shipping_container_id);
  const cargoId = nullableInt(req.body.cargo_item_id);
  const status = text(req.body.status) || 'waiting';
  const transportType = text(req.body.transport_type) || 'container';
  if (transportType === 'truck') {
    flash(req, 'error', req.t('validation.vehicleLocationNotHere'));
    return res.redirect('/cargo-locations');
  }
  const { amount, currency, rate, amountUsd } = nativeMoneyFields(req.body);
  const routeFrom = nullableText(req.body.route_from);
  const routeTo = nullableText(req.body.route_to);
  const billable = req.body.billable_to_customer === '0' || req.body.billable_to_customer === 0 ? 0 : 1;
  if (amount > 0 && !cargoId) {
    flash(req, 'error', req.t('validation.locationExpenseNeedsCargo'));
    return res.redirect('/cargo-locations?form=create');
  }
  const stage = text(req.body.stage) || 'warehouse';
  const locationName = text(req.body.location_name);
  const vals = [
    transportType, nullableText(req.body.transport_no), containerId, cargoId, stage, locationName, status,
    amount, currency, nullableText(req.body.arrived_at), nullableText(req.body.departed_at), nullableText(req.body.notes),
    routeFrom, routeTo,
  ];
  const hasRouteCols = await hasColumn('cargo_locations', 'route_from');
  let locationId;
  if (hasRouteCols) {
    const r = await query(`
      INSERT INTO cargo_locations (transport_type, transport_no, shipping_container_id, cargo_item_id, stage, location_name, status, cost_usd, cost_currency, arrived_at, departed_at, notes, route_from, route_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, vals);
    locationId = r.insertId;
  } else {
    const r = await query(`
      INSERT INTO cargo_locations (transport_type, transport_no, shipping_container_id, cargo_item_id, stage, location_name, status, cost_usd, cost_currency, arrived_at, departed_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, vals.slice(0, 12));
    locationId = r.insertId;
  }
  if (amount > 0 && cargoId) {
    const cargo = await one('SELECT id, customer_id FROM cargo_items WHERE id=? AND deleted_at IS NULL', [cargoId]);
    if (cargo) {
      const stages = localizedStages(req.locale);
      const stageLabel = stages[stage] || stage;
      const expenseTitle = text(req.body.expense_title) || `${stageLabel} — ${locationName}`;
      const expenseDate = nullableText(req.body.arrived_at)?.slice(0, 10) || today();
      const expenseId = await createCargoRouteExpense(req, {
        cargoId,
        customerId: cargo.customer_id,
        title: expenseTitle,
        category: nullableText(req.body.category),
        amount,
        currency,
        rate,
        amountUsd,
        expenseDate,
        notes: nullableText(req.body.notes),
        routeFrom,
        routeTo,
        billable,
      });
      if (await hasColumn('cargo_locations', 'expense_id')) {
        await query('UPDATE cargo_locations SET expense_id=?, updated_at=NOW() WHERE id=?', [expenseId, locationId]);
      }
    }
  }
  if (containerId) {
    await query('UPDATE shipping_containers SET current_location=?, updated_at=NOW() WHERE id=?', [locationName, containerId]);
    if (['in_transit', 'delivered'].includes(status)) {
      await query('UPDATE shipping_containers SET status=?, updated_at=NOW() WHERE id=?', [status === 'delivered' ? 'arrived' : 'in_transit', containerId]);
    }
  }
  if (cargoId) {
    const cargoStatus = status === 'delivered' ? 'delivered' : (['in_transit', 'customs'].includes(status) ? 'in_transit' : 'registered');
    await query('UPDATE cargo_items SET status=?, updated_at=NOW() WHERE id=?', [cargoStatus, cargoId]);
  }
  flash(req, 'success', req.t('flash.locationSaved'));
  res.redirect('/cargo-locations');
}));

async function saveUserPermissions(userId, body, role) {
  if (!await hasTable('user_permissions')) return;
  await query('DELETE FROM user_permissions WHERE user_id=?', [userId]);
  if (role === 'admin') return;
  for (const page of PAGE_PERMISSIONS) {
    if (body[`perm_${page.key}`] === '1') {
      await query('INSERT INTO user_permissions (user_id, page_key, can_access, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', [userId, page.key]);
    }
  }
}

async function loadPermissionMap(userId) {
  if (!await hasTable('user_permissions')) return {};
  const rows = await query('SELECT page_key, can_access FROM user_permissions WHERE user_id=?', [userId]);
  return permissionsFromRows(rows);
}

async function syncPaymentCashbox(paymentId, req) {
  if (!(await hasTable('cash_transactions')) || !(await hasColumn('cash_transactions', 'payment_id'))) return;
  const payment = await one('SELECT * FROM payments WHERE id=?', [paymentId]);
  if (!payment) return;
  const box = await ensureCashBox(req);
  const amount = n(payment.amount);
  const currency = payment.currency || 'USD';
  const rate = 1;
  const amountUsd = amount;
  if (amount <= 0) {
    await query("DELETE FROM cash_transactions WHERE payment_id=? AND source_type='payment'", [paymentId]);
    return;
  }
  let tx = await one("SELECT * FROM cash_transactions WHERE payment_id=? AND source_type='payment' LIMIT 1", [paymentId]);
  const notes = req.t('sync.paymentNote', { no: payment.payment_no || '-', notes: payment.notes || '' });
  const title = req.t('sync.paymentTitle', { no: payment.payment_no });
  if (tx) {
    await query("UPDATE cash_transactions SET cash_box_id=?, type='income', title=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, transaction_date=?, source_type='payment', notes=?, updated_at=NOW() WHERE id=?", [box.id, title, amount, currency, rate, amountUsd, payment.payment_date || today(), notes, tx.id]);
  } else {
    const no = await generateSequentialCode('cash_transactions', 'transaction_no', 'CASH-');
    await query("INSERT INTO cash_transactions (cash_box_id, transaction_no, type, title, amount, currency, rate_to_usd, amount_usd, transaction_date, source_type, payment_id, notes, created_at, updated_at) VALUES (?, ?, 'income', ?, ?, ?, ?, ?, ?, 'payment', ?, ?, NOW(), NOW())", [box.id, no, title, amount, currency, rate, amountUsd, payment.payment_date || today(), paymentId, notes]);
  }
}

resourcesRouter.get('/users', requireAdmin, asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE 1=1';
  if (search) {
    where += ' AND (name LIKE ? OR email LIKE ? OR role LIKE ?)';
    for (let i = 0; i < 3; i++) params.push(like(search));
  }
  const { rows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM users ${where}`,
    dataSql: `SELECT id, name, email, role, created_at FROM users ${where} ORDER BY id DESC`,
    params,
    page,
    perPage: resolvePerPage(req),
  });
  let form = null;
  if (req.query.form === 'create') {
    form = { name: '', email: '', password: '', role: 'user', permissions: {} };
  }
  if (req.query.edit) {
    const user = await one('SELECT id, name, email, role FROM users WHERE id=?', [int(req.query.edit)]);
    if (user) form = { ...user, password: '', permissions: await loadPermissionMap(user.id) };
  }
  await renderPage(req, res, 'users', {
    ...pageMeta(req, 'users'),
    rows,
    pagination,
    search,
    form,
    editingId: form?.id ?? null,
    pagePermissions: localizedPagePermissions(req.locale),
    userRoles: localizedUserRoles(req.locale),
    rolePresets: ROLE_PRESETS,
  });
}));

resourcesRouter.post('/users/save', requireAdmin, photoUploadMiddleware('users', (req) => {
  const id = nullableInt(req.body?.id);
  return id ? `/users?edit=${id}` : '/users?form=create';
}), asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const name = text(req.body.name);
  const email = text(req.body.email).toLowerCase();
  const role = normalizeRole(req.body.role);
  const password = String(req.body.password || '');
  must(name, req.t('validation.nameRequired'));
  must(email, req.t('validation.emailRequired'));
  const duplicate = await one('SELECT id FROM users WHERE LOWER(email)=? AND (? IS NULL OR id<>?) LIMIT 1', [email, id, id]);
  if (duplicate) {
    flash(req, 'error', req.t('flash.userEmailDuplicate'));
    return res.redirect(id ? `/users?edit=${id}` : '/users?form=create');
  }
  const hasPhoto = await hasColumn('users', 'photo_path');
  const existing = id && hasPhoto ? await one('SELECT photo_path FROM users WHERE id=?', [id]) : null;
  const photoPath = hasPhoto ? resolveUploadedPhoto(req, 'users', existing?.photo_path ?? null) : null;
  if (id) {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      if (hasPhoto) {
        await query('UPDATE users SET name=?, email=?, role=?, password=?, photo_path=?, updated_at=NOW() WHERE id=?', [name, email, role, hash, photoPath, id]);
      } else {
        await query('UPDATE users SET name=?, email=?, role=?, password=?, updated_at=NOW() WHERE id=?', [name, email, role, hash, id]);
      }
    } else if (hasPhoto) {
      await query('UPDATE users SET name=?, email=?, role=?, photo_path=?, updated_at=NOW() WHERE id=?', [name, email, role, photoPath, id]);
    } else {
      await query('UPDATE users SET name=?, email=?, role=?, updated_at=NOW() WHERE id=?', [name, email, role, id]);
    }
    await saveUserPermissions(id, req.body, role);
    flash(req, 'success', req.t('flash.userUpdated'));
  } else {
    must(password, req.t('validation.passwordRequired'));
    const hash = await bcrypt.hash(password, 10);
    if (hasPhoto) {
      const result = await query('INSERT INTO users (name, email, password, role, photo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())', [name, email, hash, role, photoPath]);
      await saveUserPermissions(result.insertId, req.body, role);
    } else {
      const result = await query('INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())', [name, email, hash, role]);
      await saveUserPermissions(result.insertId, req.body, role);
    }
    flash(req, 'success', req.t('flash.userCreated'));
  }
  res.redirect('/users');
}));

resourcesRouter.post('/users/:id/delete', requireAdmin, asyncRoute(async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) {
    flash(req, 'error', req.t('flash.userSelfDelete'));
    return res.redirect('/users');
  }
  const admins = await one("SELECT COUNT(*) c FROM users WHERE role='admin' AND id<>?", [id]);
  const target = await one('SELECT role FROM users WHERE id=?', [id]);
  if (target?.role === 'admin' && Number(admins?.c || 0) === 0) {
    flash(req, 'error', req.t('flash.adminRequired'));
    return res.redirect('/users');
  }
  await query('DELETE FROM user_permissions WHERE user_id=?', [id]);
  await query('DELETE FROM users WHERE id=?', [id]);
  flash(req, 'success', req.t('flash.userDeleted'));
  res.redirect('/users');
}));

resourcesRouter.get('/payments', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE p.deleted_at IS NULL';
  if (search) {
    where += ' AND (p.payment_no LIKE ? OR p.payment_method LIKE ? OR p.currency LIKE ? OR c.name LIKE ? OR c.customer_code LIKE ? OR ci.name LIKE ? OR sc.container_no LIKE ?)';
    for (let i = 0; i < 7; i++) params.push(like(search));
  }
  const { rows, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN cargo_items ci ON ci.id=p.cargo_item_id LEFT JOIN shipping_containers sc ON sc.id=p.shipping_container_id ${where}`,
    dataSql: `SELECT p.*, c.name customer_name, c.customer_code, ci.name cargo_name, ci.cargo_code, sc.container_no FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN cargo_items ci ON ci.id=p.cargo_item_id LEFT JOIN shipping_containers sc ON sc.id=p.shipping_container_id ${where} ORDER BY p.id DESC`,
    params,
    page,
    perPage: resolvePerPage(req),
  });
  let form = null;
  if (req.query.form === 'create') {
    const preCargoId = nullableInt(req.query.cargo);
    let preCustomerId = '';
    if (preCargoId) {
      const preCargo = await one('SELECT customer_id FROM cargo_items WHERE id=? AND deleted_at IS NULL', [preCargoId]);
      preCustomerId = preCargo?.customer_id ?? '';
    }
    form = { payment_no: await generateSequentialCode('payments', 'payment_no', 'PAY-'), customer_id: preCustomerId, shipping_container_id: '', cargo_item_id: preCargoId || '', amount: '', currency: getDefaultCurrency(), payment_date: today(), payment_method: 'cash', notes: '' };
  }
  if (req.query.edit) form = await one('SELECT * FROM payments WHERE id=? AND deleted_at IS NULL', [int(req.query.edit)]);
  let customers = [], cargoItems = [], containers = [];
  if (form) {
    customers = await query('SELECT id, name, customer_code FROM customers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500');
    cargoItems = await query('SELECT ci.id, ci.customer_id, ci.name, ci.cargo_code, c.name customer_name FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 700');
    containers = await query('SELECT id, container_no FROM shipping_containers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 500');
  }
  await renderPage(req, res, 'payments', { ...pageMeta(req, 'payments'), rows, pagination, search, form, editingId: form?.id ?? null, customers, cargoItems, containers });
}));

resourcesRouter.post('/payments/save', asyncRoute(async (req, res) => {
  const id = nullableInt(req.body.id);
  const paymentNo = text(req.body.payment_no) || await generateSequentialCode('payments', 'payment_no', 'PAY-');
  must(req.body.customer_id, req.t('validation.customerRequired'));
  const customerId = nullableInt(req.body.customer_id);
  const { currency, amount, rate, amountUsd } = nativeMoneyFields(req.body);
  const vals = [paymentNo, customerId, nullableInt(req.body.shipping_container_id), nullableInt(req.body.cargo_item_id), amount, currency, rate, amountUsd, nullableText(req.body.payment_date), text(req.body.payment_method) || 'cash', nullableText(req.body.notes)];
  let paymentId = id;
  if (id) {
    await query('UPDATE payments SET payment_no=?, customer_id=?, shipping_container_id=?, cargo_item_id=?, amount=?, currency=?, rate_to_usd=?, amount_usd=?, payment_date=?, payment_method=?, notes=?, updated_at=NOW() WHERE id=? AND deleted_at IS NULL', [...vals, id]);
    flash(req, 'success', req.t('flash.paymentUpdated'));
  } else {
    const r = await query('INSERT INTO payments (payment_no, customer_id, shipping_container_id, cargo_item_id, amount, currency, rate_to_usd, amount_usd, payment_date, payment_method, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())', vals);
    paymentId = r.insertId;
    flash(req, 'success', req.t('flash.paymentCreated'));
  }
  await syncPaymentCashbox(paymentId, req);
  res.redirect('/payments');
}));

resourcesRouter.post('/payments/:id/delete', asyncRoute(async (req, res) => {
  const id = int(req.params.id);
  if (await hasColumn('cash_transactions', 'payment_id')) await query("DELETE FROM cash_transactions WHERE payment_id=? AND source_type='payment'", [id]);
  await softDelete('payments', id);
  flash(req, 'success', req.t('flash.paymentDeleted'));
  res.redirect('/payments');
}));

resourcesRouter.get('/container-loading', asyncRoute(async (req, res) => {
  const search = searchText(req);
  const page = pageNumber(req);
  const params = [];
  let where = 'WHERE sc.deleted_at IS NULL';
  if (search) {
    where += ' AND (sc.container_no LIKE ? OR sc.ship_name LIKE ? OR sc.origin LIKE ? OR sc.destination LIKE ? OR sc.current_location LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(like(search));
  }
  const { rows: containers, pagination } = await paginateQuery({
    countSql: `SELECT COUNT(*) total FROM shipping_containers sc ${where}`,
    dataSql: `SELECT sc.*, (SELECT COUNT(*) FROM container_cargo_items x WHERE x.shipping_container_id=sc.id) items_count FROM shipping_containers sc ${where} ORDER BY FIELD(sc.status,'loading','draft','in_transit','on_ship','at_sea','in_route','hairatan','mazar','arrived','delivered','closed'), sc.id DESC`,
    params,
    page,
    perPage: resolvePerPage(req),
  });
  const selectedId = nullableInt(req.query.container);
  let selectedContainer = null;
  let cargoItems = [];
  if (selectedId) {
    selectedContainer = await one('SELECT * FROM shipping_containers WHERE id=? AND deleted_at IS NULL', [selectedId]);
    if (selectedContainer) {
      selectedContainer.items = await query(`SELECT cci.*, ci.cargo_code, ci.name cargo_name, c.name customer_name, c.customer_code FROM container_cargo_items cci LEFT JOIN cargo_items ci ON ci.id=cci.cargo_item_id LEFT JOIN customers c ON c.id=COALESCE(cci.customer_id, ci.customer_id) WHERE cci.shipping_container_id=? ORDER BY cci.id DESC`, [selectedId]);
      cargoItems = await query(`SELECT ci.id, ci.customer_id, ci.cargo_code, ci.name, ci.carton_count, ci.total_cbm, ci.gross_weight_kg, ci.status, c.name customer_name, c.customer_code FROM cargo_items ci LEFT JOIN customers c ON c.id=ci.customer_id WHERE ci.deleted_at IS NULL ORDER BY ci.id DESC LIMIT 700`);
    }
  }
  await renderPage(req, res, 'container-loading', { ...pageMeta(req, 'containerLoading'), containers, pagination, search, selectedContainer, cargoItems, returnTo: 'container-loading' });
}));
