import express from 'express';
import bcrypt from 'bcryptjs';
import { one } from '../db.js';
import { asyncRoute, flash } from '../utils/http.js';
import { renderGuest } from '../utils/view.js';
import { requireGuest } from '../middleware/auth.js';
import { resolveLocale, writeLocaleCookie } from '../utils/i18n.js';

export const authRouter = express.Router();

authRouter.get('/locale/:lang', (req, res) => {
  const locale = resolveLocale(req.params.lang);
  req.session.locale = locale;
  writeLocaleCookie(res, locale);
  const redirect = String(req.query.redirect || '/dashboard');
  const target = redirect.startsWith('/') ? redirect : '/dashboard';
  req.session.save((err) => {
    if (err) console.error('Failed to save locale in session:', err);
    res.redirect(target);
  });
});

authRouter.get('/login', requireGuest, asyncRoute(async (req, res) => {
  await renderGuest(req, res, 'login', { title: req.t('pages.login.title'), error: null, email: '' });
}));

authRouter.post('/login', requireGuest, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) {
    return renderGuest(req, res, 'login', { title: req.t('pages.login.title'), error: req.t('pages.login.errorRequired'), email });
  }
  const user = await one('SELECT id, name, email, password, role FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
  const hash = String(user?.password || '').replace(/^\$2y\$/, '$2a$');
  const valid = user && await bcrypt.compare(password, hash).catch(() => false);
  if (!valid) {
    return renderGuest(req, res, 'login', { title: req.t('pages.login.title'), error: req.t('pages.login.errorInvalid'), email });
  }
  req.session.userId = user.id;
  req.session.cookie.maxAge = req.body.remember ? 30 * 24 * 60 * 60 * 1000 : undefined;
  req.session.save(() => res.redirect('/dashboard'));
}));

authRouter.post('/logout', asyncRoute(async (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
}));
