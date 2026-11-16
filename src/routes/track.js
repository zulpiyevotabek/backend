import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { parse, z } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const visitSchema = z.object({
  // frontend localStorage'da saqlaydigan tasodifiy ID (masalan crypto.randomUUID())
  visitor_id: z.string().trim().min(8).max(64),
  path: z.string().max(300).optional(),
  referrer: z.string().max(500).optional(),
});

/** Sahifa ochilganda chaqiriladi: ro'yxatdan o'tmagan tashrifchilarni ham sanaydi */
router.post('/visit', limiter, optionalAuth, async (req, res) => {
  const data = parse(visitSchema, req.body);
  await query(
    'INSERT INTO visits (visitor_id, user_id, path, referrer, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [
      data.visitor_id,
      req.user?.id ?? null,
      data.path ?? null,
      data.referrer ?? null,
      req.get('user-agent')?.slice(0, 300) || null,
    ],
  );
  if (req.user) await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [req.user.id]);
  res.status(204).end();
});

/** Kirgan foydalanuvchi sahifada ekanini bildiradi (har 1–2 daqiqada) — "hozir onlayn" uchun */
router.post('/heartbeat', limiter, requireAuth, async (req, res) => {
  await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [req.user.id]);
  res.status(204).end();
});

export default router;
