export const n = (value, fallback = 0) => {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
};

export const int = (value, fallback = 0) => {
  const x = Number.parseInt(value, 10);
  return Number.isFinite(x) ? x : fallback;
};

export const nullableInt = (value) => {
  if (value === '' || value == null) return null;
  const x = Number.parseInt(value, 10);
  return Number.isFinite(x) ? x : null;
};

export const text = (value) => String(value ?? '').trim();

export const nullableText = (value) => {
  const x = text(value);
  return x === '' ? null : x;
};

export const money = (value, digits = 2) =>
  n(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const number = (value, digits = 0) =>
  n(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatDate = (value) => {
  if (!value) return '';
  const s = String(value);
  return s.slice(0, 10).replaceAll('-', '/');
};

export const formatDateTime = (value) => {
  if (!value) return '';
  return String(value).replace('T', ' ').slice(0, 16);
};

export const today = () => new Date().toISOString().slice(0, 10);

export const like = (value) => `%${text(value)}%`;

export function padCode(prefix, numberValue, width = 6) {
  return `${prefix}${String(numberValue).padStart(width, '0')}`;
}

export function paginateMeta(total, page, perPage) {
  const safePerPage = Math.max(1, int(perPage, 10));
  const lastPage = Math.max(1, Math.ceil(total / safePerPage));
  const safePage = Math.min(Math.max(1, page), lastPage);
  return {
    total,
    page: safePage,
    perPage: safePerPage,
    lastPage,
    from: total === 0 ? 0 : (safePage - 1) * safePerPage + 1,
    to: Math.min(total, safePage * safePerPage),
  };
}

export function rowNo(pagination, index, digits = 0) {
  const num = pagination ? pagination.from + index : index + 1;
  if (digits > 0) return String(num).padStart(digits, '0');
  return num;
}
