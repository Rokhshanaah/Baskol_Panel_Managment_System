import dotenv from 'dotenv';
dotenv.config();

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  appName: process.env.APP_NAME || 'BaskolPanel',
  appEnv: process.env.APP_ENV || 'local',
  appUrl: process.env.APP_URL || 'http://localhost',
  port: asInt(process.env.PORT, 8000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: asInt(process.env.DB_PORT, 3306),
    database: process.env.DB_DATABASE || 'Baskol_db',
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: asInt(process.env.DB_POOL_SIZE, 10),
  },
  sessionSecret: process.env.SESSION_SECRET || process.env.APP_KEY || 'change-this-session-secret',
  sessionLifetimeMinutes: asInt(process.env.SESSION_LIFETIME, 120),
  secureCookies: process.env.APP_ENV === 'production',
};
