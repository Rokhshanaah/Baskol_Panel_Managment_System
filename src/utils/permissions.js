export const PAGE_PERMISSIONS = [
  { key: 'dashboard', label: 'داشبورد', path: '/dashboard' },
  { key: 'weighbridge', label: 'باسکول', path: '/weighbridge-tickets' },
  { key: 'introductions', label: 'معرفی‌ها', path: '/introductions' },
  { key: 'reports-hub', label: 'مرکز گزارشات', path: '/reports-hub' },
  { key: 'reports', label: 'گزارش عمومی', path: '/reports' },
  { key: 'settings', label: 'تنظیمات', path: '/settings' },
  { key: 'users', label: 'کارمندان / کاربران', path: '/users' },
  { key: 'customers', label: 'مشتریان', path: '/customers' },
  { key: 'containers', label: 'کانتینرها', path: '/containers' },
  { key: 'container-loading', label: 'بارگیری کانتینر', path: '/container-loading' },
  { key: 'cashbox', label: 'صندوق', path: '/cashbox' },
  { key: 'cargo-items', label: 'اجناس / کالا', path: '/cargo-items' },
  { key: 'payments', label: 'دریافت‌ها', path: '/payments' },
  { key: 'expenses', label: 'هزینه‌ها', path: '/expenses' },
  { key: 'cargo-locations', label: 'موقعیت بار', path: '/cargo-locations' },
  { key: 'vehicles', label: 'موترها', path: '/vehicles' },
  { key: 'vehicle-trips', label: 'سفر موتر', path: '/vehicle-trips' },
  { key: 'deliveries', label: 'تحویل‌دهی', path: '/deliveries' },
  { key: 'partners', label: 'شرکا / سهامداران', path: '/partners' },
  { key: 'salaries', label: 'معاش کارمندان', path: '/salaries' },
  { key: 'vehicle-profit', label: 'سود/زیان موتر', path: '/vehicle-profit' },
];

export const USER_ROLES = [
  { key: 'admin', label: 'مدیر سیستم', fullAccess: true },
  { key: 'manager', label: 'مدیر عملیات', pages: ['dashboard', 'introductions', 'reports-hub', 'reports', 'weighbridge', 'customers', 'containers', 'container-loading', 'cargo-items', 'cashbox', 'payments', 'expenses', 'cargo-locations', 'vehicles', 'vehicle-trips', 'deliveries', 'partners', 'salaries', 'vehicle-profit'] },
  { key: 'accountant', label: 'حسابدار', pages: ['dashboard', 'reports-hub', 'reports', 'cashbox', 'payments', 'expenses', 'partners', 'salaries', 'vehicle-profit'] },
  { key: 'warehouse', label: 'انباردار', pages: ['dashboard', 'introductions', 'cargo-items', 'containers', 'container-loading', 'cargo-locations'] },
  { key: 'weighbridge_operator', label: 'اپراتور باسکول', pages: ['dashboard', 'weighbridge', 'customers', 'cargo-items'] },
  { key: 'sales', label: 'مسئول مشتریان', pages: ['dashboard', 'introductions', 'customers', 'cargo-items', 'payments'] },
  { key: 'viewer', label: 'ناظر گزارشات', pages: ['dashboard', 'reports-hub', 'reports'] },
  { key: 'user', label: 'کاربر سفارشی', pages: [] },
];

export const ROLE_PRESETS = Object.fromEntries(
  USER_ROLES.filter((role) => role.pages?.length).map((role) => [role.key, role.pages]),
);

export const VALID_ROLE_KEYS = new Set(USER_ROLES.map((role) => role.key));

export const ADMIN_ONLY_PAGES = new Set(['users', 'settings']);

const PATH_TO_PAGE = new Map([
  ...PAGE_PERMISSIONS.map((p) => [p.path, p.key]),
  ['/weighbridge-tickets', 'weighbridge'],
]);

export function pageKeyForPath(pathname) {
  if (PATH_TO_PAGE.has(pathname)) return PATH_TO_PAGE.get(pathname);
  for (const page of PAGE_PERMISSIONS) {
    if (pathname === page.path || pathname.startsWith(`${page.path}/`)) return page.key;
  }
  return null;
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function normalizeRole(role) {
  const key = String(role || 'user').trim();
  return VALID_ROLE_KEYS.has(key) ? key : 'user';
}

export function canAccessPage(userPermissions, role, pageKey) {
  if (!pageKey) return true;
  if (isAdmin({ role })) return true;
  if (ADMIN_ONLY_PAGES.has(pageKey)) return false;
  if (!userPermissions) return false;
  return !!userPermissions[pageKey];
}

export function permissionsFromRows(rows = []) {
  return Object.fromEntries(rows.map((row) => [row.page_key, !!row.can_access]));
}
