import bcrypt from 'bcryptjs';
import { pool, one, query } from '../src/db.js';

const email = process.env.ADMIN_EMAIL || 'admin@example.com';
const password = process.env.ADMIN_PASSWORD || 'password123';
const name = process.env.ADMIN_NAME || 'مدیر سیستم';

try {
  const existing = await one('SELECT id FROM users WHERE email=? LIMIT 1', [email]);
  const hash = await bcrypt.hash(password, 12);
  if (existing) {
    await query('UPDATE users SET name=?,password=?,role=\'admin\',updated_at=NOW() WHERE id=?', [name, hash, existing.id]);
    console.log(`Admin user updated: ${email}`);
  } else {
    await query('INSERT INTO users (name,email,password,role,created_at,updated_at) VALUES (?,?,?,\'admin\',NOW(),NOW())', [name, email, hash]);
    console.log(`Admin user created: ${email}`);
  }
} finally {
  await pool.end();
}
