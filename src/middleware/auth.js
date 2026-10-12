import { query, one, hasTable } from '../db.js';
import { flash } from '../utils/http.js';
import {
  ADMIN_ONLY_PAGES,
  canAccessPage,
  isAdmin,
  pageKeyForPath,
  permissionsFromRows,
} from '../utils/permissions.js';

export async function attachUser(req, res, next) {
  try {
    const id = req.session?.userId;
    req.user = id ? await one('SELECT id, name, email, role, photo_path FROM users WHERE id = ? LIMIT 1', [id]) : null;
    req.userPermissions = null;

    if (req.user) {
      if (isAdmin(req.user)) {
        req.userPermissions = null;
      } else if (await hasTable('user_permissions')) {
        const rows = await query('SELECT page_key, can_access FROM user_permissions WHERE user_id = ?', [req.user.id]);
        req.userPermissions = permissionsFromRows(rows);
      } else {
        req.userPermissions = {};
      }
    }

    res.locals.user = req.user;
    res.locals.userPermissions = req.userPermissions;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

export function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

export function requirePageAccess(req, res, next) {
  if (!req.user) return res.redirect('/login');

  const pageKey = pageKeyForPath(req.path);
  if (!pageKey) return next();

  if (ADMIN_ONLY_PAGES.has(pageKey) && !isAdmin(req.user)) {
    flash(req, 'error', 'فقط مدیر سیستم به این بخش دسترسی دارد.');
    return res.redirect('/dashboard');
  }

  if (!canAccessPage(req.userPermissions, req.user.role, pageKey)) {
    flash(req, 'error', 'شما به این صفحه دسترسی ندارید.');
    return res.redirect('/dashboard');
  }

  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!isAdmin(req.user)) {
    flash(req, 'error', 'فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.');
    return res.redirect('/dashboard');
  }
  next();
}
