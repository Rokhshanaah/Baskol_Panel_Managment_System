import fs from 'node:fs';
import path from 'node:path';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { formatDate, formatDateTime, money, number, rowNo as formatRowNo } from './format.js';
import { fa, faLocationStatus, faSource, faStage, faTransport, faWeight, localizeCashboxName, localizeStoredTitle, setLabelLocale } from './labels.js';
import { loadSettings, localizeAppSettings } from './settings.js';
import { formatMoneyAmount, formatLegacyMoney, formatStoredMoney, formatMoneyUsd, fromUsd, getDefaultCurrency, getEnabledCurrencies, getCurrencyRates } from './currency.js';
import { ensureCsrf, takeFlash } from './http.js';
import { PAGE_PERMISSIONS, canAccessPage } from './permissions.js';
import { messages } from '../i18n/messages.js';
import { LOCALE_META, SUPPORTED_LOCALES, resolveLocale, createTranslator, localizedPagePermissions, localizedUserRoles, localeMeta, readLocaleCookie } from './i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const views = path.join(root, 'views');

const routeMap = {
  dashboard: '/dashboard',
  'tickets.index': '/weighbridge-tickets',
  'introductions.index': '/introductions',
  'reports-hub.index': '/reports-hub',
  'settings.index': '/settings',
  'customers.index': '/customers',
  'cargo-items.index': '/cargo-items',
  'containers.index': '/containers',
  'shipping-containers.index': '/containers',
  'cashbox.index': '/cashbox',
  'expenses.index': '/expenses',
  'cargo-locations.index': '/cargo-locations',
  'reports.index': '/reports',
  'users.index': '/users',
  'payments.index': '/payments',
  'container-loading.index': '/container-loading',
  'vehicles.index': '/vehicles',
  'vehicle-trips.index': '/vehicle-trips',
  'deliveries.index': '/deliveries',
  'partners.index': '/partners',
  'salaries.index': '/salaries',
  'vehicle-profit.index': '/vehicle-profit',
};

export const route = (name) => routeMap[name] ?? '#';

export function icon(name, klass = 'w-5 h-5') {
  const attrs = `class="${klass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"`;
  const paths = {
    dashboard: '<path d="M4 13h7V4H4v9Z"/><path d="M13 20h7V4h-7v16Z"/><path d="M4 20h7v-5H4v5Z"/>',
    scale: '<path d="M4 18h16"/><path d="M6 18V8"/><path d="M18 18V8"/><path d="M8 8h8"/><path d="M12 8V4"/><path d="M9 4h6"/><path d="M7 13h10"/><path d="M8 13l-2 3"/><path d="M16 13l2 3"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    report: '<path d="M6 3h9l3 3v15H6V3Z"/><path d="M15 3v4h4"/><path d="M9 17v-4"/><path d="M12 17v-7"/><path d="M15 17v-2"/>',
    settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19 12a7 7 0 1 0-14 0 7 7 0 0 0 14 0Z"/>',
    logout: '<path d="M10 17l-5-5 5-5"/><path d="M5 12h12"/><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
    users: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 11a2.5 2.5 0 1 0 0-5"/><path d="M17 15a5 5 0 0 1 4 5"/>',
    customer: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    cargo: '<path d="M4 8l8-4 8 4-8 4-8-4Z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/>',
    container: '<path d="M4 5h16v14H4z"/><path d="M8 5v14M12 5v14M16 5v14"/>',
    money: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M7 9h.01M17 15h.01"/>',
    payment: '<path d="M4 7h16v10H4V7Z"/><path d="M4 10h16"/><path d="M8 15h4"/>',
    loading: '<path d="M3 17h18"/><path d="M6 17V9h8v8"/><path d="M14 12h3l2 3v2"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/>',
    expense: '<path d="M12 3v18"/><path d="M17 7H9.5a2.5 2.5 0 0 0 0 5H14a2.5 2.5 0 0 1 0 5H7"/>',
    location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  };
  return `<svg ${attrs}>${paths[name] ?? '<path d="M5 12h14M12 5v14"/>'}</svg>`;
}

function assetManifest() {
  const p = path.join(root, 'public/build/manifest.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function assetTags() {
  const manifest = assetManifest();
  const entry = manifest['resources/js/app.js'];
  const cssEntry = manifest['resources/css/app.css'];
  if (entry || cssEntry) {
    const cssFiles = [...new Set([...(entry?.css || []), ...(cssEntry?.file ? [cssEntry.file] : [])])];
    const css = cssFiles.map((f) => `<link rel="stylesheet" href="/build/${f}">`).join('\n');
    const js = entry?.file ? `<script type="module" src="/build/${entry.file}"></script>` : '';
    return `${css}\n${js}`;
  }
  const assetsDir = path.join(root, 'public/build/assets');
  let fallbackCss = '';
  let fallbackJs = '';
  try {
    for (const file of fs.readdirSync(assetsDir)) {
      if (!fallbackCss && file.startsWith('app-') && file.endsWith('.css')) fallbackCss = `/build/assets/${file}`;
      if (!fallbackJs && file.startsWith('app-') && file.endsWith('.js')) fallbackJs = `/build/assets/${file}`;
    }
  } catch { /* build output missing */ }
  return `${fallbackCss ? `<link rel="stylesheet" href="${fallbackCss}">` : ''}\n${fallbackJs ? `<script type="module" src="${fallbackJs}"></script>` : ''}`;
}

export function viewLocals(req, extra = {}) {
  const locale = resolveLocale(req.locale || req.session?.locale || readLocaleCookie(req));
  const meta = localeMeta(locale);
  const settings = loadSettings();
  const appSettings = localizeAppSettings(settings, locale);
  const defaultCurrency = getDefaultCurrency(settings);
  setLabelLocale(locale);
  const t = req.t && resolveLocale(req.locale) === locale ? req.t : createTranslator(locale);
  return {
    ...extra,
    user: req.user,
    csrfToken: ensureCsrf(req),
    flash: takeFlash(req),
    currentPath: req.path,
    route,
    icon,
    money,
    formatMoney: (amount, currency) => (currency ? formatMoneyAmount(amount, currency) : formatMoneyUsd(amount, settings)),
    formatLegacyMoney: (row, usdKey, currencyKey) => formatLegacyMoney(row, usdKey, currencyKey, settings),
    formatStoredMoney: (row, amountKey, currencyKey) => formatStoredMoney(row, amountKey, currencyKey, settings),
    fromUsd: (amount, currency) => fromUsd(amount, currency, settings),
    defaultCurrency,
    enabledCurrencies: getEnabledCurrencies(settings),
    currencyRates: getCurrencyRates(settings),
    number,
    formatDate,
    formatDateTime,
    fa,
    faWeight,
    faStage,
    faTransport,
    faLocationStatus,
    faSource,
    localizeTitle: localizeStoredTitle,
    localizeCashboxName,
    appSettings,
    rowNo: (pagination, index) => formatRowNo(pagination, index, appSettings.codeDigits),
    pagePermissions: localizedPagePermissions(locale),
    userRoles: localizedUserRoles(locale),
    canPage: (key) => canAccessPage(req.userPermissions, req.user?.role, key),
    assetTags: assetTags(),
    query: req.query,
    locale,
    lang: meta.htmlLang,
    dir: meta.dir,
    t,
    roleHints: messages[locale]?.roleHints || messages.fa.roleHints,
    locales: SUPPORTED_LOCALES.map((code) => ({ code, label: LOCALE_META[code].label })),
  };
}

export async function renderPage(req, res, page, data = {}) {
  const locals = viewLocals(req, data);
  const body = await ejs.renderFile(path.join(views, 'pages', `${page}.ejs`), locals);
  const html = await ejs.renderFile(path.join(views, 'layouts', 'app.ejs'), { ...locals, body });
  res.send(html);
}

export async function renderGuest(req, res, page, data = {}) {
  const locals = viewLocals(req, data);
  const body = await ejs.renderFile(path.join(views, 'pages', `${page}.ejs`), locals);
  const html = await ejs.renderFile(path.join(views, 'layouts', 'guest.ejs'), { ...locals, body });
  res.send(html);
}
