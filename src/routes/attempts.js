import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { HttpError, idParam, parse, z } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { gradeAttempt } from '../lib/scoring.js';
import { buildReview } from '../lib/review.js';

const router = Router();
router.use(requireAuth);

const answerValue = z.union([z.string().max(20000), z.array(z.string().max(500)).max(20)]);
const answersSchema = z.record(z.string().regex(/^\d+$/), answerValue);

const startSchema = z.object({ test_id: z.coerce.number().int().positive() });
const saveSchema = z.object({ answers: answersSchema });
const submitSchema = z.object({
  answers: answersSchema.optional(),
  time_spent_sec: z.number().int().min(0).max(86400).optional(),
});

const deadline = (attempt, durationMin) =>
  new Date(new Date(attempt.started_at).getTime() + durationMin * 60_000);

const loadTest = async (testId) => {
  const t = await query('SELECT * FROM tests WHERE id = $1', [testId]);
  return t.rows[0] || null;
};

async function loadOwnAttempt(id, userId) {
  const { rows } = await query('SELECT * FROM attempts WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) throw new HttpError(404, 'Urinish topilmadi');
  return rows[0];
}

const attemptView = (a) => ({
  id: a.id,
  test_id: a.test_id,
  status: a.status,
  started_at: a.started_at,
  submitted_at: a.submitted_at,
  time_spent_sec: a.time_spent_sec,
  raw_score: a.raw_score,
  max_score: a.max_score,
  band: a.band,
  feedback: a.feedback,
  answers: a.answers,
});

/** Testni boshlash (yoki davom ettirish) */
router.post('/start', async (req, res) => {
  const { test_id } = parse(startSchema, req.body);
  const test = await loadTest(test_id);
  if (!test || !test.is_published) throw new HttpError(404, 'Test topilmadi');

  const { rows: open } = await query(
    `SELECT * FROM attempts WHERE user_id = $1 AND test_id = $2 AND status = 'in_progress'
      ORDER BY started_at DESC`,
    [req.user.id, test_id],
  );

  let attempt = null;
  const graceMs = config.submitGraceMinutes * 60_000;
  for (const a of open) {
    if (!attempt && deadline(a, test.duration_minutes).getTime() + graceMs > Date.now()) {
      attempt = a; // vaqti tugamagan urinishni davom ettiramiz
    } else {
      await query("UPDATE attempts SET status = 'expired' WHERE id = $1", [a.id]);
    }
  }
  const resumed = Boolean(attempt);
  if (!attempt) {
    const ins = await query('INSERT INTO attempts (user_id, test_id) VALUES ($1, $2) RETURNING *', [
      req.user.id,
      test_id,
    ]);
    attempt = ins.rows[0];
  }

  const { rows: questions } = await query(
    `SELECT id, position, type, prompt, options, points
       FROM questions WHERE test_id = $1 ORDER BY position, id`,
    [test_id],
  );
  res.status(resumed ? 200 : 201).json({
    resumed,
    attempt: {
      id: attempt.id,
      started_at: attempt.started_at,
      expires_at: deadline(attempt, test.duration_minutes),
      answers: attempt.answers,
    },
    test: {
      id: test.id,
      title: test.title,
      section: test.section,
      description: test.description,
      duration_minutes: test.duration_minutes,
      content: test.content,
      questions,
    },
  });
});

/** Javoblarni oraliq saqlash (autosave) */
router.patch('/:id/answers', async (req, res) => {
  const id = idParam(req.params.id);
  const { answers } = parse(saveSchema, req.body);
  const { rowCount } = await query(
    `UPDATE attempts SET answers = answers || $3::jsonb
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`,
    [id, req.user.id, JSON.stringify(answers)],
  );
  if (!rowCount) throw new HttpError(409, 'Urinish topilmadi yoki allaqachon topshirilgan');
  await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
});

/** Topshirish va baholash */
router.post('/:id/submit', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(submitSchema, req.body ?? {});
  const attempt = await loadOwnAttempt(id, req.user.id);
  if (attempt.status !== 'in_progress') throw new HttpError(409, 'Bu urinish allaqachon topshirilgan');

  const test = await loadTest(attempt.test_id);
  const { rows: questions } = await query(
    `SELECT id, type, correct_answer, points FROM questions WHERE test_id = $1 ORDER BY position, id`,
    [attempt.test_id],
  );

  const answers = { ...attempt.answers, ...(body.answers || {}) };
  const result = gradeAttempt(questions, answers);
  const elapsed = Math.round((Date.now() - new Date(attempt.started_at).getTime()) / 1000);
  const timeSpent = Math.min(body.time_spent_sec ?? elapsed, elapsed + 5, test.duration_minutes * 60 + 600);
  const status = result.needsManualGrading ? 'submitted' : 'graded';

  const { rows } = await query(
    `UPDATE attempts SET
        status = $2, submitted_at = now(), time_spent_sec = $3, answers = $4::jsonb,
        raw_score = $5, max_score = $6, band = $7,
        graded_at = CASE WHEN $2 = 'graded' THEN now() ELSE NULL END
      WHERE id = $1 AND status = 'in_progress'
      RETURNING *`,
    [id, status, timeSpent, JSON.stringify(answers), result.rawScore, result.maxScore, result.band],
  );
  if (!rows[0]) throw new HttpError(409, 'Bu urinish allaqachon topshirilgan');

  await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [req.user.id]);
  res.json({
    attempt: attemptView(rows[0]),
    pending_manual_grading: result.needsManualGrading,
    review: await buildReview(rows[0]),
  });
});

/** Mening urinishlarim */
router.get('/me', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.test_id, t.title, t.section, a.status, a.started_at, a.submitted_at,
            a.time_spent_sec, a.raw_score, a.max_score, a.band
       FROM attempts a JOIN tests t ON t.id = a.test_id
      WHERE a.user_id = $1 AND a.status <> 'expired'
      ORDER BY a.started_at DESC`,
    [req.user.id],
  );
  res.json({ attempts: rows });
});

/** Bitta urinish natijasi (topshirilgan bo'lsa — to'g'ri javoblar bilan) */
router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const attempt = await loadOwnAttempt(id, req.user.id);
  const done = attempt.status === 'submitted' || attempt.status === 'graded';
  res.json({
    attempt: attemptView(attempt),
    review: done ? await buildReview(attempt) : null,
  });
});

export default router;
