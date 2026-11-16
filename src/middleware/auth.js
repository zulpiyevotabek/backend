import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../lib/http.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

async function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Token yaroqsiz yoki muddati tugagan');
  }
  const { rows } = await query(
    'SELECT id, full_name, email, phone, role, is_active, target_band, created_at FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user) throw new HttpError(401, 'Foydalanuvchi topilmadi');
  if (!user.is_active) throw new HttpError(403, 'Akkaunt bloklangan');
  return user;
}

/** Token bo'lsa req.user ni o'rnatadi, bo'lmasa davom etadi */
export async function optionalAuth(req, _res, next) {
  try {
    req.user = (await userFromRequest(req)) || null;
    next();
  } catch (err) {
    // Tracking kabi ochiq endpointlar yaroqsiz tokendan yiqilmasin
    req.user = null;
    next();
  }
}

export async function requireAuth(req, _res, next) {
  const user = await userFromRequest(req);
  if (!user) throw new HttpError(401, 'Kirish talab qilinadi');
  req.user = user;
  next();
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {});
  if (req.user.role !== 'admin') throw new HttpError(403, 'Faqat admin uchun');
  next();
}

export const publicUser = (u) => ({
  id: u.id,
  full_name: u.full_name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  target_band: u.target_band,
  created_at: u.created_at,
});
