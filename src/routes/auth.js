import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { HttpError, parse, z } from '../lib/http.js';
import { requireAuth, signToken, publicUser } from '../middleware/auth.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Juda ko\'p urinish. Birozdan so\'ng qayta urinib ko\'ring.' },
});

const bandSchema = z.number().min(0).max(9).multipleOf(0.5);

const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Ism kamida 2 ta belgi').max(100),
  email: z.string().trim().toLowerCase().email('Email noto\'g\'ri').max(200),
  phone: z.string().trim().max(30).optional().nullable(),
  password: z.string().min(8, 'Parol kamida 8 ta belgi').max(72, 'Parol 72 belgidan oshmasin'),
  target_band: bandSchema.optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(72),
});

// bcrypt uchun soxta hash: foydalanuvchi topilmasa ham vaqt bir xil sarflansin
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

router.post('/register', limiter, async (req, res) => {
  const data = parse(registerSchema, req.body);
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [data.email]);
  if (exists.rowCount) throw new HttpError(409, 'Bu email bilan allaqachon ro\'yxatdan o\'tilgan');

  const hash = await bcrypt.hash(data.password, 10);
  const { rows } = await query(
    `INSERT INTO users (full_name, email, phone, password_hash, target_band, last_login_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     RETURNING *`,
    [data.full_name, data.email, data.phone || null, hash, data.target_band ?? null],
  );
  const user = rows[0];
  await query('INSERT INTO login_events (user_id, ip, user_agent) VALUES ($1, $2, $3)', [
    user.id,
    req.ip,
    req.get('user-agent')?.slice(0, 300) || null,
  ]);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', limiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Email yoki parol noto\'g\'ri');
  if (!user.is_active) throw new HttpError(403, 'Akkaunt bloklangan');

  await query('UPDATE users SET last_login_at = now(), last_seen_at = now() WHERE id = $1', [user.id]);
  await query('INSERT INTO login_events (user_id, ip, user_agent) VALUES ($1, $2, $3)', [
    user.id,
    req.ip,
    req.get('user-agent')?.slice(0, 300) || null,
  ]);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [req.user.id]);
  res.json({ user: publicUser(req.user) });
});

const profileSchema = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  target_band: bandSchema.optional().nullable(),
});

router.patch('/me', requireAuth, async (req, res) => {
  const data = parse(profileSchema, req.body);
  const { rows } = await query(
    `UPDATE users SET
       full_name   = COALESCE($2, full_name),
       phone       = CASE WHEN $3::boolean THEN $4 ELSE phone END,
       target_band = CASE WHEN $5::boolean THEN $6 ELSE target_band END
     WHERE id = $1 RETURNING *`,
    [
      req.user.id,
      data.full_name ?? null,
      'phone' in data,
      data.phone ?? null,
      'target_band' in data,
      data.target_band ?? null,
    ],
  );
  res.json({ user: publicUser(rows[0]) });
});

const passwordSchema = z.object({
  current_password: z.string().min(1).max(72),
  new_password: z.string().min(8).max(72),
});

router.post('/change-password', requireAuth, limiter, async (req, res) => {
  const { current_password, new_password } = parse(passwordSchema, req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current_password, rows[0].password_hash))) {
    throw new HttpError(401, 'Joriy parol noto\'g\'ri');
  }
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    req.user.id,
    await bcrypt.hash(new_password, 10),
  ]);
  res.json({ ok: true });
});

export default router;
