import crypto from 'node:crypto';

export function flash(req, type, message) {
  req.session.flash = { type, message };
}

export function takeFlash(req) {
  const value = req.session.flash || null;
  delete req.session.flash;
  return value;
}

export function ensureCsrf(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

export function isMultipartRequest(req) {
  return String(req.headers['content-type'] || '').includes('multipart/form-data');
}

function readCsrfToken(req) {
  const raw = req.body?._csrf || req.headers['x-csrf-token'];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function verifyCsrf(req) {
  const token = ensureCsrf(req);
  return readCsrfToken(req) === token;
}

export function csrfMiddleware(req, res, next) {
  const token = ensureCsrf(req);
  res.locals.csrfToken = token;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (isMultipartRequest(req)) return next();
  const supplied = readCsrfToken(req);
  if (supplied === token) return next();

  const message = req.t?.('flash.csrfInvalid') || 'نشست شما منقضی شده. صفحه را رفرش کنید و دوباره تلاش کنید.';
  flash(req, 'error', message);
  const back = String(req.get('Referer') || '/dashboard').split('#')[0];
  return req.session.save((err) => {
    if (err) console.error('Failed to save session after CSRF failure:', err);
    return res.redirect(back || '/dashboard');
  });
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
