import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, idParam } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/** Ochiq ro'yxat: nashr etilgan testlar (javoblarsiz, savollar matnisiz) */
router.get('/', async (req, res) => {
  const section = ['reading', 'listening', 'writing'].includes(req.query.section)
    ? req.query.section
    : null;
  const { rows } = await query(
    `SELECT t.id, t.title, t.section, t.description, t.duration_minutes,
            (SELECT count(*) FROM questions q WHERE q.test_id = t.id)::int AS question_count
       FROM tests t
      WHERE t.is_published AND ($1::text IS NULL OR t.section = $1)
      ORDER BY t.section, t.id`,
    [section],
  );
  res.json({ tests: rows });
});

/** Test tafsiloti (savollar bilan, to'g'ri javoblarsiz). Kirish talab qilinadi. */
router.get('/:id', requireAuth, async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await query(
    `SELECT id, title, section, description, duration_minutes, content
       FROM tests WHERE id = $1 AND is_published`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Test topilmadi');
  const questions = await query(
    `SELECT id, position, type, prompt, options, points
       FROM questions WHERE test_id = $1 ORDER BY position, id`,
    [id],
  );
  res.json({ test: { ...rows[0], questions: questions.rows } });
});

export default router;
