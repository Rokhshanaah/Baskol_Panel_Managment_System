import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { int, text } from './format.js';
import { createTranslator } from './i18n.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.resolve(__dirname, '../../storage/app-settings.json');

export const DEFAULT_SETTINGS = {
  systemName: 'سیستم باسکول',
  systemSubtitle: 'گدام، بارچلانی، فاکتور',
  companyName: '',
  companyPhone: '',
  companyEmail: '',
  companyAddress: '',
  invoiceFooter: '',
  defaultCurrency: 'USD',
  enabledCurrencies: ['USD', 'AFN', 'CNY', 'PKR'],
  currencyRates: { USD: 1, AFN: 70, CNY: 7.2, PKR: 280 },
  recordsPerPage: 15,
  codeDigits: 6,
  printFormat: 'A4',
  logoPath: '',
};

const LEGACY_CURRENCIES = new Set(['USD', 'AFN', 'CNY', 'PKR', 'EUR', 'IRR']);

function ensureStorageDir() {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function settingText(value, max, fallback = '') {
  const cleaned = text(value).slice(0, max);
  return cleaned || fallback;
}

export function loadSettings() {
  try {
    if (!fs.existsSync(settingsPath)) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeCurrencyList(input, fallback) {
  const raw = Array.isArray(input) ? input : fallback;
  const cleaned = [...new Set(raw.map((c) => text(c).toUpperCase()).filter((c) => LEGACY_CURRENCIES.has(c)))];
  return cleaned.length ? cleaned : DEFAULT_SETTINGS.enabledCurrencies;
}

function normalizeRates(input, fallback) {
  const base = { ...DEFAULT_SETTINGS.currencyRates, ...fallback };
  const rates = { ...base };
  if (input && typeof input === 'object') {
    for (const [key, val] of Object.entries(input)) {
      const code = text(key).toUpperCase();
      if (LEGACY_CURRENCIES.has(code)) rates[code] = Math.max(0.0001, Number(val) || base[code] || 1);
    }
  }
  rates.USD = 1;
  return rates;
}

export function normalizeSettings(input = {}) {
  const current = loadSettingsSafe(input);
  const recordsPerPage = Math.min(100, Math.max(5, int(input.recordsPerPage, current.recordsPerPage)));
  const codeDigits = Math.min(10, Math.max(4, int(input.codeDigits, current.codeDigits)));
  const enabledCurrencies = normalizeCurrencyList(input.enabledCurrencies, current.enabledCurrencies);
  const defaultCurrency = LEGACY_CURRENCIES.has(text(input.defaultCurrency).toUpperCase())
    && enabledCurrencies.includes(text(input.defaultCurrency).toUpperCase())
    ? text(input.defaultCurrency).toUpperCase()
    : enabledCurrencies[0] || DEFAULT_SETTINGS.defaultCurrency;
  const currencyRates = normalizeRates(input.currencyRates, current.currencyRates);
  const printFormatRaw = text(input.printFormat).toUpperCase();
  const printFormat = ['A4', 'A5'].includes(printFormatRaw)
    ? printFormatRaw
    : (['A4', 'A5'].includes(current.printFormat) ? current.printFormat : DEFAULT_SETTINGS.printFormat);
  const logoPath = input.logoPath !== undefined ? text(input.logoPath) : (current.logoPath || '');

  return {
    systemName: settingText(input.systemName, 80, DEFAULT_SETTINGS.systemName),
    systemSubtitle: settingText(input.systemSubtitle, 120, DEFAULT_SETTINGS.systemSubtitle),
    companyName: settingText(input.companyName, 120),
    companyPhone: settingText(input.companyPhone, 40),
    companyEmail: settingText(input.companyEmail, 120),
    companyAddress: settingText(input.companyAddress, 255),
    invoiceFooter: settingText(input.invoiceFooter, 255),
    defaultCurrency,
    enabledCurrencies,
    currencyRates,
    recordsPerPage,
    codeDigits,
    printFormat,
    logoPath,
  };
}

function loadSettingsSafe(fallback = {}) {
  return { ...DEFAULT_SETTINGS, ...fallback };
}

export function saveSettings(input) {
  ensureStorageDir();
  const settings = normalizeSettings({ ...loadSettings(), ...input });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

export function getRecordsPerPage() {
  return loadSettings().recordsPerPage;
}

export function getCodeDigits() {
  return loadSettings().codeDigits;
}

export function getPrintFormat() {
  return loadSettings().printFormat || DEFAULT_SETTINGS.printFormat;
}

export function resolvePerPage(req) {
  return getRecordsPerPage();
}

const LEGACY_DEFAULT_NAMES = new Set([
  'سیستم باسکول',
  'د باسکول مدیریت سیستم',
  'Weighbridge Management System',
  'Weighbridge System',
]);

const LEGACY_DEFAULT_SUBTITLES = new Set([
  'گدام، بارچلانی، فاکتور',
  'گدام، بار، فاکتور',
  'Warehouse, cargo, invoice',
]);

export function localizeAppSettings(settings, locale) {
  const t = createTranslator(locale);
  const localized = { ...settings };

  if (settings.systemName === DEFAULT_SETTINGS.systemName || LEGACY_DEFAULT_NAMES.has(settings.systemName)) {
    localized.systemName = t('settings.defaultSystemName');
  }
  if (settings.systemSubtitle === DEFAULT_SETTINGS.systemSubtitle || LEGACY_DEFAULT_SUBTITLES.has(settings.systemSubtitle)) {
    localized.systemSubtitle = t('settings.defaultSystemSubtitle');
  }

  return localized;
}
