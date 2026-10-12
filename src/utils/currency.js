import { loadSettings } from './settings.js';
import { money, n, text } from './format.js';

export const ALL_CURRENCIES = ['USD', 'AFN', 'CNY', 'PKR', 'EUR', 'IRR'];

export const DEFAULT_RATES = {
  USD: 1,
  AFN: 70,
  CNY: 7.2,
  PKR: 280,
  EUR: 0.92,
  IRR: 42000,
};

export function getEnabledCurrencies(settings = loadSettings()) {
  const list = Array.isArray(settings.enabledCurrencies) ? settings.enabledCurrencies : ['USD', 'AFN', 'CNY', 'PKR'];
  return list.filter((c) => ALL_CURRENCIES.includes(c));
}

export function getDefaultCurrency(settings = loadSettings()) {
  const enabled = getEnabledCurrencies(settings);
  const preferred = text(settings.defaultCurrency).toUpperCase();
  return enabled.includes(preferred) ? preferred : (enabled[0] || 'USD');
}

export function getCurrencyRates(settings = loadSettings()) {
  return { ...DEFAULT_RATES, ...(settings.currencyRates || {}) };
}

export function resolveRate(currency, settings = loadSettings()) {
  const code = text(currency).toUpperCase() || 'USD';
  if (code === 'USD') return 1;
  return n(getCurrencyRates(settings)[code], 1);
}

/** Legacy helper — kept for any code paths that still need conversion. */
export function toUsd(amount, currency, settings = loadSettings()) {
  const code = text(currency).toUpperCase() || 'USD';
  const value = n(amount);
  if (code === 'USD') return value;
  const rate = resolveRate(code, settings);
  return rate > 0 ? value / rate : 0;
}

export function currencyOptions(settings = loadSettings()) {
  return getEnabledCurrencies(settings).map((code) => ({ code, rate: resolveRate(code, settings) }));
}

/** Parse posted amount + currency — stored as-is, no conversion. */
export function nativeMoneyFields(body, settings = loadSettings(), amountKey = 'amount') {
  const currency = text(body.currency) || getDefaultCurrency(settings);
  const amount = n(body[amountKey] ?? body.amount);
  return { currency, amount, rate: 1, amountUsd: amount };
}

/** Build form defaults from stored amount + currency. */
export function moneyFormNative(amount, currency, settings = loadSettings()) {
  return {
    amount: n(amount),
    currency: text(currency).toUpperCase() || getDefaultCurrency(settings),
  };
}

/** @deprecated use moneyFormNative */
export function moneyFormFromUsd(amountUsd, settings = loadSettings()) {
  return moneyFormNative(amountUsd, getDefaultCurrency(settings), settings);
}

/** @deprecated use nativeMoneyFields */
export function usdFromBody(body, settings = loadSettings(), amountKey = 'amount') {
  return nativeMoneyFields(body, settings, amountKey).amount;
}

/** Format a native amount with its currency code. */
export function formatMoneyAmount(amount, currency, digits = 2) {
  const code = text(currency).toUpperCase() || getDefaultCurrency();
  return `${money(amount, digits)} ${code}`;
}

/** Format stored money row (amount + currency columns). */
export function formatStoredMoney(row, amountKey = 'amount', currencyKey = 'currency', settings = loadSettings()) {
  const amount = n(row?.[amountKey]);
  const currency = text(row?.[currencyKey]).toUpperCase() || getDefaultCurrency(settings);
  return formatMoneyAmount(amount, currency);
}

/** Format legacy *_usd column with optional *_currency column. */
export function formatLegacyMoney(row, usdKey, currencyKey, settings = loadSettings()) {
  const amount = n(row?.[usdKey]);
  const currency = text(row?.[currencyKey]).toUpperCase() || getDefaultCurrency(settings);
  return formatMoneyAmount(amount, currency);
}

/** @deprecated prefer formatStoredMoney / formatLegacyMoney */
export function fromUsd(amountUsd, currency, settings = loadSettings()) {
  return n(amountUsd);
}

/** @deprecated prefer formatStoredMoney */
export function formatMoneyUsd(amountUsd, settings = loadSettings(), digits = 2) {
  const code = getDefaultCurrency(settings);
  return formatMoneyAmount(amountUsd, code, digits);
}
