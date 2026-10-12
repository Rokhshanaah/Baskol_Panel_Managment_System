import { createTranslator } from './i18n.js';

let activeLocale = 'fa';

export function setLabelLocale(locale) {
  activeLocale = locale || 'fa';
}

export function fa(value) {
  if (value == null || value === '') return '-';
  const key = String(value).trim();
  const translated = createTranslator(activeLocale)(`labels.${key}`);
  return translated === `labels.${key}` ? key : translated;
}

export function faWeight(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  const unit = createTranslator(activeLocale)('fields.weightUnit');
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

export function faStage(value, stages = {}) {
  if (value == null || value === '') return '-';
  const key = String(value).trim();
  return stages[key] ?? fa(key);
}

export function faTransport(value, transportTypes = {}) {
  if (value == null || value === '') return '-';
  const key = String(value).trim();
  return transportTypes[key] ?? fa(key);
}

export function faLocationStatus(value, statuses = {}) {
  if (value == null || value === '') return '-';
  const key = String(value).trim();
  return statuses[key] ?? fa(key);
}

export function faSource(value) {
  return fa(value);
}

const STORED_TITLE_PREFIXES = [
  { prefixes: ['هزینه:', 'Expense:', 'لګښت:'], key: 'sync.expenseTitle', field: 'title' },
  { prefixes: ['دریافت:', 'Payment:', 'ترلاسه:'], key: 'sync.paymentTitle', field: 'no' },
];

const MAIN_CASHBOX_NAMES = new Set(['صندوق اصلی', 'Main Cashbox', 'اصلي صندوق']);

export function localizeStoredTitle(title) {
  if (title == null || title === '') return '-';
  const text = String(title).trim();
  const t = createTranslator(activeLocale);

  for (const rule of STORED_TITLE_PREFIXES) {
    for (const prefix of rule.prefixes) {
      if (text.startsWith(prefix)) {
        return t(rule.key, { [rule.field]: text.slice(prefix.length).trim() });
      }
    }
  }

  return text;
}

export function localizeCashboxName(name) {
  if (name == null || name === '') return '-';
  const text = String(name).trim();
  if (MAIN_CASHBOX_NAMES.has(text)) {
    return createTranslator(activeLocale)('fields.mainCashbox');
  }
  return text;
}
