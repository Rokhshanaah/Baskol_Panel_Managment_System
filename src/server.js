import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import { env } from './config/env.js';
import { pool } from './db.js';
import { attachUser } from './middleware/auth.js';
import { attachLocale } from './utils/i18n.js';
import { csrfMiddleware, ensureCsrf } from './utils/http.js';
import { authRouter } from './routes/auth.js';
import { pageRouter } from './routes/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  expiration: env.sessionLifetimeMinutes * 60 * 1000,
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  schema: {
    tableName: 'express_sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data',
    },
  },
}, pool);
const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use('/storage', express.static(path.join(root, 'storage/app/public')));
app.use(express.static(path.join(root, 'public')));
app.use(session({
  name: 'baskol.sid',
  secret: env.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: env.secureCookies, maxAge: env.sessionLifetimeMinutes * 60 * 1000 },
}));
app.use((req, _res, next) => { ensureCsrf(req); next(); });
app.use(attachUser);
app.use(attachLocale);
app.use(csrfMiddleware);
app.use(authRouter);
app.use(pageRouter);
app.use((req, res) => res.status(404).send('404 - صفحه پیدا نشد'));
app.use((error, req, res, _next) => {
  console.error(error);
  const message = env.appEnv === 'production' ? 'خطای داخلی سرور' : error.message;
  res.status(500).send(`<div dir="rtl" style="font-family:sans-serif;padding:30px"><h2>خطای سرور</h2><pre>${String(message).replaceAll('<','&lt;')}</pre></div>`);
});

try {
  await pool.query('SELECT 1');
  app.listen(env.port, () => console.log(`${env.appName} Node.js running on http://localhost:${env.port}`));
} catch (error) {
  console.error('Database connection failed:', error.message);
  process.exit(1);
}
