import { Router } from 'express';
import { pool, query } from '../db.js';
import { config } from '../config.js';
import { HttpError, idParam, likeEscape, paging, parse, z } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildReview } from '../lib/review.js';
import { isCorrect } from '../lib/scoring.js';
import { sendCsv } from '../lib/csv.js';
import { activitySince } from '../lib/activity.js';

const router = Router();
router.use(requireAdmin);

const TZ = config.statsTz;
const WINDOW = config.onlineWindowMinutes;
const DONE = "('submitted','graded')";

/** Jonli faollik: POST/PATCH/DELETE so'rovlari (?after=<oxirgi id>) */
router.get('/activity', (req, res) => {
  res.json({ events: activitySince(Number(req.query.after) || 0) });
});

/* ============================================================
 *  STATISTIKA
 * ========================================================== */

/** Asosiy ko'rsatkichlar: nechta odam kirgan, hozir kimlar onlayn, nechta test ishlangan */
router.get('/stats/overview', async (_req, res) => {
  const today = `(now() AT TIME ZONE $1::text)::date`;
  const day = (col) => `(${col} AT TIME ZONE $1::text)::date`;

  const [users, traffic, online, attempts] = await Promise.all([
    query(
      `SELECT
         count(*) FILTER (WHERE role = 'user')::int                                   AS total,
         count(*) FILTER (WHERE role = 'user' AND ${day('created_at')} = ${today})::int AS new_today,
         count(*) FILTER (WHERE role = 'user' AND created_at >= now() - interval '7 days')::int  AS new_7d,
         count(*) FILTER (WHERE role = 'user' AND created_at >= now() - interval '30 days')::int AS new_30d,
         count(*) FILTER (WHERE NOT is_active)::int                                   AS blocked
       FROM users`,
      [TZ],
    ),
    query(
      `SELECT
         (SELECT count(*) FROM visits WHERE ${day('created_at')} = ${today})::int AS visits_today,
         (SELECT count(DISTINCT visitor_id) FROM visits WHERE ${day('created_at')} = ${today})::int AS unique_visitors_today,
         (SELECT count(DISTINCT visitor_id) FROM visits WHERE created_at >= now() - interval '7 days')::int AS unique_visitors_7d,
         (SELECT count(DISTINCT visitor_id) FROM visits)::int AS unique_visitors_total,
         (SELECT count(*) FROM login_events WHERE ${day('created_at')} = ${today})::int AS logins_today,
         (SELECT count(DISTINCT user_id) FROM login_events WHERE ${day('created_at')} = ${today})::int AS active_users_today,
         (SELECT count(DISTINCT user_id) FROM login_events WHERE created_at >= now() - interval '7 days')::int AS active_users_7d`,
      [TZ],
    ),
    query(
      `SELECT
         (SELECT count(*) FROM users WHERE last_seen_at >= now() - make_interval(mins => $1::int))::int AS users,
         (SELECT count(DISTINCT visitor_id) FROM visits
            WHERE created_at >= now() - make_interval(mins => $1::int))::int AS visitors,
         -- bir odam ham foydalanuvchi, ham tashrifchi sifatida sanalmasligi uchun
         ((SELECT count(DISTINCT visitor_id) FROM visits
            WHERE created_at >= now() - make_interval(mins => $1::int))
          + (SELECT count(*) FROM users u
              WHERE u.last_seen_at >= now() - make_interval(mins => $1::int)
                AND NOT EXISTS (SELECT 1 FROM visits v
                                 WHERE v.user_id = u.id
                                   AND v.created_at >= now() - make_interval(mins => $1::int))))::int AS total`,
      [WINDOW],
    ),
    query(
      `SELECT
         count(*) FILTER (WHERE status IN ${DONE})::int                       AS submitted_total,
         count(*) FILTER (WHERE status IN ${DONE} AND ${day('submitted_at')} = ${today})::int AS submitted_today,
         count(*) FILTER (WHERE status = 'submitted')::int                    AS pending_grading,
         count(*) FILTER (WHERE status = 'in_progress')::int                  AS in_progress,
         ROUND(AVG(band), 2)                                                   AS avg_band
       FROM attempts`,
      [TZ],
    ),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    timezone: TZ,
    online_window_minutes: WINDOW,
    users: users.rows[0],
    traffic: traffic.rows[0],
    online_now: online.rows[0],
    attempts: attempts.rows[0],
  });
});

/** Kunlar kesimida: ro'yxatdan o'tganlar, tashriflar, kirishlar, topshirilgan testlar */
router.get('/stats/timeseries', async (req, res) => {
  const days = Math.min(180, Math.max(1, parseInt(req.query.days, 10) || 30));
  const { rows } = await query(
    `WITH d AS (
       SELECT generate_series(
                (now() AT TIME ZONE $1::text)::date - ($2::int - 1),
                (now() AT TIME ZONE $1::text)::date,
                interval '1 day')::date AS day)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
       (SELECT count(*) FROM users u
          WHERE u.role = 'user' AND (u.created_at AT TIME ZONE $1::text)::date = d.day)::int AS new_users,
       (SELECT count(*) FROM visits v
          WHERE (v.created_at AT TIME ZONE $1::text)::date = d.day)::int AS visits,
       (SELECT count(DISTINCT v.visitor_id) FROM visits v
          WHERE (v.created_at AT TIME ZONE $1::text)::date = d.day)::int AS unique_visitors,
       (SELECT count(*) FROM login_events l
          WHERE (l.created_at AT TIME ZONE $1::text)::date = d.day)::int AS logins,
       (SELECT count(DISTINCT l.user_id) FROM login_events l
          WHERE (l.created_at AT TIME ZONE $1::text)::date = d.day)::int AS active_users,
       (SELECT count(*) FROM attempts a
          WHERE a.status IN ${DONE} AND (a.submitted_at AT TIME ZONE $1::text)::date = d.day)::int AS attempts
     FROM d ORDER BY d.day`,
    [TZ, days],
  );
  res.json({ days, timezone: TZ, series: rows });
});

/** Hozir onlayn foydalanuvchilar ro'yxati */
router.get('/stats/online', async (_req, res) => {
  const [users, visitors] = await Promise.all([
    query(
      `SELECT id, full_name, email, last_seen_at FROM users
        WHERE last_seen_at >= now() - make_interval(mins => $1::int)
        ORDER BY last_seen_at DESC LIMIT 200`,
      [WINDOW],
    ),
    query(
      `SELECT count(DISTINCT visitor_id)::int AS n FROM visits
        WHERE created_at >= now() - make_interval(mins => $1::int)`,
      [WINDOW],
    ),
  ]);
  res.json({ window_minutes: WINDOW, users: users.rows, visitors: visitors.rows[0].n });
});

/** Bo'limlar (Reading/Listening/Writing) bo'yicha natijalar */
router.get('/stats/sections', async (_req, res) => {
  const { rows } = await query(
    `SELECT t.section,
            count(a.id)::int AS attempts,
            count(DISTINCT a.user_id)::int AS users,
            ROUND(AVG(a.band), 2) AS avg_band,
            ROUND(AVG(a.raw_score::numeric / NULLIF(a.max_score, 0)) * 100, 1) AS avg_percent,
            ROUND(AVG(a.time_spent_sec))::int AS avg_time_sec
       FROM tests t
       LEFT JOIN attempts a ON a.test_id = t.id AND a.status IN ${DONE}
      GROUP BY t.section ORDER BY t.section`,
  );
  res.json({ sections: rows });
});

/** Har bir test bo'yicha statistika */
router.get('/stats/tests', async (_req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.title, t.section, t.is_published,
            count(a.id)::int AS attempts,
            count(DISTINCT a.user_id)::int AS users,
            ROUND(AVG(a.band), 2) AS avg_band,
            ROUND(AVG(a.raw_score::numeric / NULLIF(a.max_score, 0)) * 100, 1) AS avg_percent,
            ROUND(AVG(a.time_spent_sec))::int AS avg_time_sec
       FROM tests t
       LEFT JOIN attempts a ON a.test_id = t.id AND a.status IN ${DONE}
      GROUP BY t.id ORDER BY attempts DESC, t.id`,
  );
  res.json({ tests: rows });
});

/** Band taqsimoti (0–9) */
router.get('/stats/bands', async (req, res) => {
  const section = ['reading', 'listening', 'writing'].includes(req.query.section) ? req.query.section : null;
  const { rows } = await query(
    `SELECT a.band, count(*)::int AS count
       FROM attempts a JOIN tests t ON t.id = a.test_id
      WHERE a.band IS NOT NULL AND ($1::text IS NULL OR t.section = $1)
      GROUP BY a.band ORDER BY a.band`,
    [section],
  );
  res.json({ section, distribution: rows });
});

/** Test ichidagi har bir savol bo'yicha to'g'ri javob foizi (eng qiyin savollarni topish uchun) */
router.get('/stats/tests/:id/questions', async (req, res) => {
  const id = idParam(req.params.id);
  const test = await query('SELECT id, title, section FROM tests WHERE id = $1', [id]);
  if (!test.rows[0]) throw new HttpError(404, 'Test topilmadi');
  const [{ rows: questions }, { rows: attempts }] = await Promise.all([
    query(
      `SELECT id, position, type, prompt, correct_answer, points FROM questions
        WHERE test_id = $1 ORDER BY position, id`,
      [id],
    ),
    query(`SELECT answers FROM attempts WHERE test_id = $1 AND status IN ${DONE}`, [id]),
  ]);
  const stats = questions
    .filter((q) => q.type !== 'essay')
    .map((q) => {
      let answered = 0;
      let correct = 0;
      for (const a of attempts) {
        const given = a.answers?.[String(q.id)];
        if (given !== undefined && given !== null && given !== '') answered++;
        if (isCorrect(q, given)) correct++;
      }
      return {
        id: q.id,
        position: q.position,
        prompt: q.prompt,
        attempts: attempts.length,
        answered,
        correct,
        correct_percent: attempts.length ? Math.round((correct / attempts.length) * 1000) / 10 : null,
      };
    });
  res.json({ test: test.rows[0], total_attempts: attempts.length, questions: stats });
});

/** So'nggi kirishlar */
router.get('/logins', async (req, res) => {
  const { page, limit, offset } = paging(req.query, { defaultLimit: 50 });
  const [{ rows }, total] = await Promise.all([
    query(
      `SELECT l.id, l.created_at, l.ip, l.user_agent, u.id AS user_id, u.full_name, u.email
         FROM login_events l JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    query('SELECT count(*)::int AS n FROM login_events'),
  ]);
  res.json({ page, limit, total: total.rows[0].n, logins: rows });
});

/* ============================================================
 *  FOYDALANUVCHILAR
 * ========================================================== */

const USER_SORT = {
  created_at: 'u.created_at',
  last_login_at: 'u.last_login_at',
  full_name: 'u.full_name',
  attempts: 'attempts',
  avg_band: 'avg_band',
};

router.get('/users', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${likeEscape(req.query.q.trim())}%` : null;
  const sort = USER_SORT[req.query.sort] || USER_SORT.created_at;
  const dir = req.query.order === 'asc' ? 'ASC' : 'DESC';

  const where = `WHERE ($1::text IS NULL OR u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1)`;
  const [{ rows }, total] = await Promise.all([
    query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.target_band,
              u.created_at, u.last_login_at, u.last_seen_at,
              count(a.id) FILTER (WHERE a.status IN ${DONE})::int AS attempts,
              ROUND(AVG(a.band), 2) AS avg_band
         FROM users u LEFT JOIN attempts a ON a.user_id = u.id
         ${where}
        GROUP BY u.id
        ORDER BY ${sort} ${dir} NULLS LAST, u.id DESC
        LIMIT $2 OFFSET $3`,
      [q, limit, offset],
    ),
    query(`SELECT count(*)::int AS n FROM users u ${where}`, [q]),
  ]);
  res.json({ page, limit, total: total.rows[0].n, users: rows });
});

router.get('/users/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const u = await query(
    `SELECT id, full_name, email, phone, role, is_active, target_band, created_at, last_login_at, last_seen_at
       FROM users WHERE id = $1`,
    [id],
  );
  if (!u.rows[0]) throw new HttpError(404, 'Foydalanuvchi topilmadi');
  const [attempts, logins] = await Promise.all([
    query(
      `SELECT a.id, a.test_id, t.title, t.section, a.status, a.started_at, a.submitted_at,
              a.time_spent_sec, a.raw_score, a.max_score, a.band
         FROM attempts a JOIN tests t ON t.id = a.test_id
        WHERE a.user_id = $1 ORDER BY a.started_at DESC`,
      [id],
    ),
    query(
      `SELECT count(*)::int AS total, max(created_at) AS last FROM login_events WHERE user_id = $1`,
      [id],
    ),
  ]);
  res.json({ user: u.rows[0], logins: logins.rows[0], attempts: attempts.rows });
});

const userPatchSchema = z.object({
  is_active: z.boolean().optional(),
  role: z.enum(['user', 'admin']).optional(),
});

router.patch('/users/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const data = parse(userPatchSchema, req.body);
  if (id === req.user.id && (data.is_active === false || data.role === 'user')) {
    throw new HttpError(400, 'O\'zingizni bloklay yoki adminlikdan olib tashlay olmaysiz');
  }
  const { rows } = await query(
    `UPDATE users SET is_active = COALESCE($2, is_active), role = COALESCE($3, role)
      WHERE id = $1 RETURNING id, full_name, email, role, is_active`,
    [id, data.is_active ?? null, data.role ?? null],
  );
  if (!rows[0]) throw new HttpError(404, 'Foydalanuvchi topilmadi');
  res.json({ user: rows[0] });
});

router.delete('/users/:id', async (req, res) => {
  const id = idParam(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'O\'zingizni o\'chira olmaysiz');
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Foydalanuvchi topilmadi');
  res.status(204).end();
});

/* ============================================================
 *  URINISHLAR VA BAHOLASH
 * ========================================================== */

router.get('/attempts', async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const status = ['in_progress', 'submitted', 'graded', 'expired'].includes(req.query.status) ? req.query.status : null;
  const section = ['reading', 'listening', 'writing'].includes(req.query.section) ? req.query.section : null;
  const testId = parseInt(req.query.test_id, 10) || null;
  const userId = parseInt(req.query.user_id, 10) || null;
  const params = [status, section, testId, userId];
  const where = `WHERE ($1::text IS NULL OR a.status = $1) AND ($2::text IS NULL OR t.section = $2)
                   AND ($3::bigint IS NULL OR a.test_id = $3) AND ($4::bigint IS NULL OR a.user_id = $4)`;
  const from = `FROM attempts a JOIN tests t ON t.id = a.test_id JOIN users u ON u.id = a.user_id`;

  const [{ rows }, total] = await Promise.all([
    query(
      `SELECT a.id, a.status, a.started_at, a.submitted_at, a.time_spent_sec, a.raw_score, a.max_score, a.band,
              t.id AS test_id, t.title, t.section, u.id AS user_id, u.full_name, u.email
         ${from} ${where}
        ORDER BY COALESCE(a.submitted_at, a.started_at) DESC LIMIT $5 OFFSET $6`,
      [...params, limit, offset],
    ),
    query(`SELECT count(*)::int AS n ${from} ${where}`, params),
  ]);
  res.json({ page, limit, total: total.rows[0].n, attempts: rows });
});

router.get('/attempts/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await query(
    `SELECT a.*, u.full_name, u.email, t.title, t.section, t.content
       FROM attempts a JOIN users u ON u.id = a.user_id JOIN tests t ON t.id = a.test_id
      WHERE a.id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Urinish topilmadi');
  res.json({ attempt: rows[0], review: await buildReview(rows[0]) });
});

const gradeSchema = z.object({
  band: z.number().min(0).max(9).multipleOf(0.5),
  feedback: z.string().trim().max(5000).optional().nullable(),
});

/** Writing (essay) ishlarini qo'lda baholash */
router.patch('/attempts/:id/grade', async (req, res) => {
  const id = idParam(req.params.id);
  const { band, feedback } = parse(gradeSchema, req.body);
  const { rows } = await query(
    `UPDATE attempts SET band = $2, feedback = $3, status = 'graded', graded_by = $4, graded_at = now()
      WHERE id = $1 AND status IN ('submitted', 'graded')
      RETURNING id, status, band, feedback, graded_at`,
    [id, band, feedback ?? null, req.user.id],
  );
  if (!rows[0]) throw new HttpError(404, 'Topshirilgan urinish topilmadi');
  res.json({ attempt: rows[0] });
});

router.delete('/attempts/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM attempts WHERE id = $1', [idParam(req.params.id)]);
  if (!rowCount) throw new HttpError(404, 'Urinish topilmadi');
  res.status(204).end();
});

/* ============================================================
 *  TESTLAR VA SAVOLLAR (CRUD)
 * ========================================================== */

const QUESTION_TYPES = ['mcq', 'tfng', 'ynng', 'fill', 'matching', 'multi', 'essay'];

const questionFields = {
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().trim().min(1).max(5000),
  options: z.array(z.string().max(1000)).max(30).optional().nullable(),
  correct_answer: z.union([z.string().max(500), z.array(z.string().max(500)).max(20)]).optional().nullable(),
  points: z.number().int().min(0).max(100),
  position: z.number().int().min(0).optional(),
};
const questionSchema = z.object({ ...questionFields, points: questionFields.points.default(1) });
const questionPatchSchema = z.object(questionFields).partial();

function checkQuestion(q) {
  if (q.type !== 'essay' && (q.correct_answer === undefined || q.correct_answer === null || q.correct_answer === '')) {
    throw new HttpError(400, `"${q.prompt.slice(0, 40)}" savoli uchun correct_answer kerak`);
  }
  if ((q.type === 'mcq' || q.type === 'multi') && !q.options?.length) {
    throw new HttpError(400, `"${q.prompt.slice(0, 40)}" savoli uchun options kerak`);
  }
  if (q.type === 'multi' && !Array.isArray(q.correct_answer)) {
    throw new HttpError(400, 'multi turidagi savolda correct_answer massiv bo\'lishi kerak');
  }
}

const testFields = {
  title: z.string().trim().min(2).max(200),
  section: z.enum(['reading', 'listening', 'writing']),
  description: z.string().trim().max(2000).optional().nullable(),
  duration_minutes: z.number().int().min(1).max(300),
  // passage matni, audio_url va h.k.
  content: z.record(z.string(), z.any()),
  is_published: z.boolean(),
};
const testSchema = z.object({
  ...testFields,
  duration_minutes: testFields.duration_minutes.default(60),
  content: testFields.content.default({}),
  is_published: testFields.is_published.default(false),
  questions: z.array(questionSchema).max(200).optional(),
});
const testPatchSchema = z.object(testFields).partial();

async function insertQuestions(client, testId, questions, startPos = 0) {
  let pos = startPos;
  for (const q of questions) {
    checkQuestion(q);
    await client.query(
      `INSERT INTO questions (test_id, position, type, prompt, options, correct_answer, points)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        testId,
        q.position ?? ++pos,
        q.type,
        q.prompt,
        q.options ? JSON.stringify(q.options) : null,
        q.correct_answer !== undefined && q.correct_answer !== null ? JSON.stringify(q.correct_answer) : null,
        q.points,
      ],
    );
  }
}

router.get('/tests', async (_req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.title, t.section, t.description, t.duration_minutes, t.is_published, t.created_at,
            (SELECT count(*) FROM questions q WHERE q.test_id = t.id)::int AS question_count,
            (SELECT count(*) FROM attempts a WHERE a.test_id = t.id AND a.status IN ${DONE})::int AS attempts
       FROM tests t ORDER BY t.id DESC`,
  );
  res.json({ tests: rows });
});

router.get('/tests/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const t = await query('SELECT * FROM tests WHERE id = $1', [id]);
  if (!t.rows[0]) throw new HttpError(404, 'Test topilmadi');
  const q = await query('SELECT * FROM questions WHERE test_id = $1 ORDER BY position, id', [id]);
  res.json({ test: { ...t.rows[0], questions: q.rows } });
});

router.post('/tests', async (req, res) => {
  const data = parse(testSchema, req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tests (title, section, description, duration_minutes, content, is_published)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [data.title, data.section, data.description ?? null, data.duration_minutes, JSON.stringify(data.content), data.is_published],
    );
    await insertQuestions(client, rows[0].id, data.questions ?? []);
    await client.query('COMMIT');
    res.status(201).json({ test: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/tests/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const d = parse(testPatchSchema, req.body);
  const { rows } = await query(
    `UPDATE tests SET
        title = COALESCE($2, title), section = COALESCE($3, section),
        description = CASE WHEN $4::boolean THEN $5 ELSE description END,
        duration_minutes = COALESCE($6, duration_minutes),
        content = COALESCE($7::jsonb, content),
        is_published = COALESCE($8, is_published),
        updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      id,
      d.title ?? null,
      d.section ?? null,
      'description' in d,
      d.description ?? null,
      d.duration_minutes ?? null,
      d.content ? JSON.stringify(d.content) : null,
      d.is_published ?? null,
    ],
  );
  if (!rows[0]) throw new HttpError(404, 'Test topilmadi');
  res.json({ test: rows[0] });
});

router.delete('/tests/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM tests WHERE id = $1', [idParam(req.params.id)]);
  if (!rowCount) throw new HttpError(404, 'Test topilmadi');
  res.status(204).end();
});

/** Testga savol(lar) qo'shish: bitta obyekt yoki massiv */
router.post('/tests/:id/questions', async (req, res) => {
  const id = idParam(req.params.id);
  const list = parse(z.array(questionSchema).min(1).max(200), Array.isArray(req.body) ? req.body : [req.body]);
  const t = await query('SELECT 1 FROM tests WHERE id = $1', [id]);
  if (!t.rowCount) throw new HttpError(404, 'Test topilmadi');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const max = await client.query('SELECT COALESCE(max(position), 0)::int AS m FROM questions WHERE test_id = $1', [id]);
    await insertQuestions(client, id, list, max.rows[0].m);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const q = await query('SELECT * FROM questions WHERE test_id = $1 ORDER BY position, id', [id]);
  res.status(201).json({ questions: q.rows });
});

router.patch('/questions/:qid', async (req, res) => {
  const qid = idParam(req.params.qid);
  const d = parse(questionPatchSchema, req.body);
  const cur = await query('SELECT * FROM questions WHERE id = $1', [qid]);
  if (!cur.rows[0]) throw new HttpError(404, 'Savol topilmadi');
  const merged = { ...cur.rows[0], ...d };
  checkQuestion(merged);
  const { rows } = await query(
    `UPDATE questions SET type = $2, prompt = $3, options = $4::jsonb, correct_answer = $5::jsonb,
            points = $6, position = $7
      WHERE id = $1 RETURNING *`,
    [
      qid,
      merged.type,
      merged.prompt,
      merged.options ? JSON.stringify(merged.options) : null,
      merged.correct_answer !== null && merged.correct_answer !== undefined ? JSON.stringify(merged.correct_answer) : null,
      merged.points,
      merged.position,
    ],
  );
  res.json({ question: rows[0] });
});

router.delete('/questions/:qid', async (req, res) => {
  const { rowCount } = await query('DELETE FROM questions WHERE id = $1', [idParam(req.params.qid)]);
  if (!rowCount) throw new HttpError(404, 'Savol topilmadi');
  res.status(204).end();
});

/* ============================================================
 *  EKSPORT (CSV — Excel'da ochiladi)
 * ========================================================== */

router.get('/export/users.csv', async (_req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.target_band,
            u.created_at, u.last_login_at,
            count(a.id) FILTER (WHERE a.status IN ${DONE})::int AS attempts,
            ROUND(AVG(a.band), 2) AS avg_band
       FROM users u LEFT JOIN attempts a ON a.user_id = u.id
      GROUP BY u.id ORDER BY u.id`,
  );
  sendCsv(res, 'users.csv',
    ['id', 'full_name', 'email', 'phone', 'role', 'is_active', 'target_band', 'created_at', 'last_login_at', 'attempts', 'avg_band'],
    rows);
});

router.get('/export/attempts.csv', async (_req, res) => {
  const { rows } = await query(
    `SELECT a.id, u.full_name, u.email, t.title AS test, t.section, a.status,
            a.started_at, a.submitted_at, a.time_spent_sec, a.raw_score, a.max_score, a.band
       FROM attempts a JOIN users u ON u.id = a.user_id JOIN tests t ON t.id = a.test_id
      WHERE a.status <> 'expired' ORDER BY a.id`,
  );
  sendCsv(res, 'attempts.csv',
    ['id', 'full_name', 'email', 'test', 'section', 'status', 'started_at', 'submitted_at', 'time_spent_sec', 'raw_score', 'max_score', 'band'],
    rows);
});

export default router;
