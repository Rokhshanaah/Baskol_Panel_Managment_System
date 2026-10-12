import { LOCALE_META, SUPPORTED_LOCALES, messages } from '../i18n/messages.js';

export { LOCALE_META, SUPPORTED_LOCALES };

const DEFAULT_LOCALE = 'fa';
export const LOCALE_COOKIE = 'baskol_locale';

function getPath(obj, path) {
  return String(path).split('.').reduce((current, key) => current?.[key], obj);
}

export function readLocaleCookie(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|; )baskol_locale=(fa|ps|en)(?:;|$)/);
  return match ? match[1] : '';
}

export function writeLocaleCookie(res, locale) {
  res.setHeader('Set-Cookie', `baskol_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
}

export function resolveLocale(input) {
  const locale = String(input || '').trim();
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

export function createTranslator(locale) {
  const active = resolveLocale(locale);
  const dict = messages[active] || messages.fa;
  const fallback = messages.fa;

  return function t(key, vars = {}) {
    let text = getPath(dict, key) ?? getPath(fallback, key) ?? key;
    for (const [name, value] of Object.entries(vars)) {
      text = String(text).replaceAll(`{${name}}`, String(value));
    }
    return text;
  };
}

export function localeMeta(locale) {
  return LOCALE_META[resolveLocale(locale)] || LOCALE_META.fa;
}

export function attachLocale(req, res, next) {
  const locale = resolveLocale(req.session?.locale || readLocaleCookie(req));
  req.locale = locale;
  req.session.locale = locale;
  req.t = createTranslator(locale);

  const meta = localeMeta(locale);
  res.locals.locale = locale;
  res.locals.lang = meta.htmlLang;
  res.locals.dir = meta.dir;
  res.locals.t = req.t;
  res.locals.locales = SUPPORTED_LOCALES.map((code) => ({ code, label: LOCALE_META[code].label }));

  next();
}

import { PAGE_PERMISSIONS, USER_ROLES } from './permissions.js';

const PAGE_LABEL_KEYS = {
  dashboard: 'dashboard',
  weighbridge: 'weighbridge',
  introductions: 'introductions',
  'reports-hub': 'reportsHub',
  reports: 'reportsHub',
  settings: 'settings',
  users: 'users',
  customers: 'customers',
  containers: 'containers',
  'container-loading': 'containerLoading',
  cashbox: 'cashbox',
  'cargo-items': 'cargoItems',
  payments: 'payments',
  expenses: 'expenses',
  'cargo-locations': 'cargoLocations',
  vehicles: 'vehicles',
  'vehicle-trips': 'vehicleTrips',
  deliveries: 'deliveries',
  partners: 'partners',
  salaries: 'salaries',
  'vehicle-profit': 'vehicleProfit',
};

export function localizedPagePermissions(locale) {
  const t = createTranslator(locale);
  return PAGE_PERMISSIONS.map((page) => ({
    ...page,
    label: t(`pages.${PAGE_LABEL_KEYS[page.key] || page.key}.title`),
  }));
}

export function localizedUserRoles(locale) {
  const t = createTranslator(locale);
  return USER_ROLES.map((role) => ({
    ...role,
    label: t(`labels.${role.key}`),
  }));
}

export function pageMeta(req, baseKey, extra = {}) {
  const t = req.t || createTranslator(req.locale);
  return {
    title: t(`pages.${baseKey}.title`),
    subtitle: t(`pages.${baseKey}.subtitle`),
    ...extra,
  };
}

const TRANSPORT_TYPE_KEYS = ['container', 'ship', 'truck', 'warehouse', 'air', 'other'];
const STAGE_KEYS = ['warehouse', 'loading', 'sea', 'land', 'customs', 'delivery', 'other'];
const LOCATION_STATUS_KEYS = ['waiting', 'in_transit', 'customs', 'delivered', 'cancelled', 'arrived', 'departed'];

function mapLabels(locale, keys) {
  const t = createTranslator(locale);
  return Object.fromEntries(keys.map((key) => [key, t(`labels.${key}`)]));
}

export function localizedTransportTypes(locale) {
  return mapLabels(locale, TRANSPORT_TYPE_KEYS);
}

export function localizedStages(locale) {
  return mapLabels(locale, STAGE_KEYS);
}

export function localizedLocationStatuses(locale) {
  return mapLabels(locale, LOCATION_STATUS_KEYS);
}

export function blockerSeparator(locale) {
  return locale === 'en' ? '; ' : '؛ ';
}
