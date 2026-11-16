// Ishga tushgan serverni boshidan oxirigacha tekshiradi.
// Ishlatish:  BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run smoke
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const stamp = Date.now();
const email = `smoke${stamp}@example.com`;

console.log('Health & auth');
check('health', (await api('GET', '/health')).status === 200);
let r = await api('POST', '/api/auth/register', { body: { full_name: 'Smoke User', email, password: 'password123', phone: '+998901234567', target_band: 7 } });
check('register 201', r.status === 201, r.data);
const token = r.data?.token;
check('duplicate email 409', (await api('POST', '/api/auth/register', { body: { full_name: 'X Y', email, password: 'password123' } })).status === 409);
check('weak password 400', (await api('POST', '/api/auth/register', { body: { full_name: 'X Y', email: 'a@b.co', password: '123' } })).status === 400);
check('wrong password 401', (await api('POST', '/api/auth/login', { body: { email, password: 'nope-nope' } })).status === 401);
r = await api('POST', '/api/auth/login', { body: { email, password: 'password123' } });
check('login 200', r.status === 200 && r.data.token);
check('me', (await api('GET', '/api/auth/me', { token })).data?.user?.email === email);
check('me without token 401', (await api('GET', '/api/auth/me')).status === 401);

console.log('Tracking');
check('visit 204', (await api('POST', '/api/track/visit', { body: { visitor_id: `visitor-${stamp}`, path: '/' } })).status === 204);
check('visit with token 204', (await api('POST', '/api/track/visit', { token, body: { visitor_id: `visitor-${stamp}`, path: '/tests' } })).status === 204);
check('heartbeat 204', (await api('POST', '/api/track/heartbeat', { token })).status === 204);

console.log('Admin access control');
check('user cannot open admin api', (await api('GET', '/api/admin/stats/overview', { token })).status === 403);
check('anonymous cannot open admin api', (await api('GET', '/api/admin/stats/overview')).status === 401);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.log('ADMIN_EMAIL/ADMIN_PASSWORD berilmagan — admin testlari o\'tkazib yuborildi');
} else {
  r = await api('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check('admin login', r.status === 200 && r.data.user.role === 'admin', r.data);
  const admin = r.data?.token;
  const adminId = r.data?.user?.id;

  console.log('Admin: test yaratish');
  r = await api('POST', '/api/admin/tests', {
    token: admin,
    body: {
      title: `Smoke reading ${stamp}`, section: 'reading', duration_minutes: 20, is_published: true,
      content: { passage: 'Some passage' },
      questions: [
        { type: 'mcq', prompt: 'Q1', options: ['A. one', 'B. two'], correct_answer: 'B' },
        { type: 'tfng', prompt: 'Q2', options: ['TRUE', 'FALSE', 'NOT GIVEN'], correct_answer: 'FALSE' },
        { type: 'fill', prompt: 'Q3', correct_answer: ['paris', 'Paris, France'] },
        { type: 'multi', prompt: 'Q4', options: ['A', 'B', 'C'], correct_answer: ['A', 'C'] },
      ],
    },
  });
  check('create test 201', r.status === 201, r.data);
  const testId = r.data?.test?.id;
  check('invalid question rejected', (await api('POST', '/api/admin/tests', { token: admin, body: { title: 'Bad test', section: 'reading', questions: [{ type: 'mcq', prompt: 'x' }] } })).status === 400);

  r = await api('POST', '/api/admin/tests', {
    token: admin,
    body: { title: `Smoke writing ${stamp}`, section: 'writing', duration_minutes: 40, is_published: true, questions: [{ type: 'essay', prompt: 'Write an essay', points: 0 }] },
  });
  const writingId = r.data?.test?.id;
  check('create writing test', r.status === 201, r.data);

  console.log('User: test ishlash');
  r = await api('GET', '/api/tests');
  check('public test list', r.data?.tests?.some((t) => t.id === testId));
  r = await api('GET', `/api/tests/${testId}`, { token });
  check('test detail hides answers', r.status === 200 && r.data.test.questions.length === 4 && !('correct_answer' in r.data.test.questions[0]), r.data);
  const qs = r.data.test.questions;

  r = await api('POST', '/api/attempts/start', { token, body: { test_id: testId } });
  check('start 201', r.status === 201, r.data);
  const attemptId = r.data?.attempt?.id;
  r = await api('POST', '/api/attempts/start', { token, body: { test_id: testId } });
  check('start again resumes same attempt', r.status === 200 && r.data.resumed && r.data.attempt.id === attemptId);
  check('autosave', (await api('PATCH', `/api/attempts/${attemptId}/answers`, { token, body: { answers: { [qs[0].id]: 'B' } } })).status === 200);

  r = await api('POST', `/api/attempts/${attemptId}/submit`, {
    token,
    body: { answers: { [qs[1].id]: 'false', [qs[2].id]: ' PARIS ', [qs[3].id]: ['C', 'A'] }, time_spent_sec: 120 },
  });
  check('submit graded 4/4', r.status === 200 && r.data.attempt.raw_score === 4 && r.data.attempt.max_score === 4 && r.data.attempt.status === 'graded', r.data?.attempt);
  check('band 9 for 4/4', r.data?.attempt?.band === 9, r.data?.attempt?.band);
  check('review contains correct answers', r.data?.review?.every((q) => q.is_correct === true), r.data?.review);
  check('double submit 409', (await api('POST', `/api/attempts/${attemptId}/submit`, { token, body: {} })).status === 409);

  // ikkinchi urinish: 1/4 to'g'ri
  r = await api('POST', '/api/attempts/start', { token, body: { test_id: testId } });
  r = await api('POST', `/api/attempts/${r.data.attempt.id}/submit`, { token, body: { answers: { [qs[0].id]: 'B' } } });
  check('partial submit 1/4', r.data?.attempt?.raw_score === 1, r.data?.attempt);

  // writing
  r = await api('POST', '/api/attempts/start', { token, body: { test_id: writingId } });
  const wAttempt = r.data.attempt.id;
  const wq = r.data.test.questions[0].id;
  r = await api('POST', `/api/attempts/${wAttempt}/submit`, { token, body: { answers: { [wq]: 'My essay text...' } } });
  check('writing waits for grading', r.data?.attempt?.status === 'submitted' && r.data.pending_manual_grading === true, r.data);
  check('my attempts', (await api('GET', '/api/attempts/me', { token })).data?.attempts?.length >= 3);

  console.log('Admin: statistika va baholash');
  r = await api('GET', '/api/admin/stats/overview', { token: admin });
  check('overview', r.status === 200 && r.data.users.total >= 1 && r.data.attempts.submitted_total >= 3 && r.data.attempts.pending_grading >= 1, r.data);
  check('online now counts user', r.data?.online_now?.users >= 1 && r.data?.online_now?.visitors >= 1, r.data?.online_now);
  check('unique visitors today', r.data?.traffic?.unique_visitors_today >= 1, r.data?.traffic);
  r = await api('GET', '/api/admin/stats/timeseries?days=7', { token: admin });
  check('timeseries 7 days', r.status === 200 && r.data.series.length === 7, r.data);
  check('timeseries today counts', r.data?.series?.at(-1)?.new_users >= 1 && r.data.series.at(-1).attempts >= 3, r.data?.series?.at(-1));
  check('stats/tests', (await api('GET', '/api/admin/stats/tests', { token: admin })).data?.tests?.some((t) => t.id === testId && t.attempts === 2));
  check('stats/sections', (await api('GET', '/api/admin/stats/sections', { token: admin })).status === 200);
  check('stats/bands', (await api('GET', '/api/admin/stats/bands', { token: admin })).data?.distribution?.length >= 1);
  r = await api('GET', `/api/admin/stats/tests/${testId}/questions`, { token: admin });
  check('question stats', r.status === 200 && r.data.questions.find((q) => q.id === qs[0].id)?.correct_percent === 100, r.data);
  check('stats/online', (await api('GET', '/api/admin/stats/online', { token: admin })).data?.users?.length >= 1);
  check('logins list', (await api('GET', '/api/admin/logins', { token: admin })).data?.total >= 1);

  r = await api('GET', `/api/admin/users?q=${encodeURIComponent('smoke' + stamp)}`, { token: admin });
  check('user search', r.data?.total === 1 && r.data.users[0].attempts === 3, r.data);
  const uid = r.data?.users?.[0]?.id;
  check('user detail', (await api('GET', `/api/admin/users/${uid}`, { token: admin })).data?.attempts?.length >= 3);

  r = await api('GET', '/api/admin/attempts?status=submitted', { token: admin });
  const pending = r.data?.attempts?.find((a) => a.id === wAttempt);
  check('pending writing visible', Boolean(pending), r.data);
  r = await api('GET', `/api/admin/attempts/${wAttempt}`, { token: admin });
  check('attempt detail has essay', r.data?.review?.[0]?.your_answer === 'My essay text...', r.data);
  r = await api('PATCH', `/api/admin/attempts/${wAttempt}/grade`, { token: admin, body: { band: 6.5, feedback: 'Good structure' } });
  check('grade writing', r.status === 200 && r.data.attempt.band === 6.5 && r.data.attempt.status === 'graded', r.data);
  check('invalid band 400', (await api('PATCH', `/api/admin/attempts/${wAttempt}/grade`, { token: admin, body: { band: 6.3 } })).status === 400);
  r = await api('GET', `/api/attempts/${wAttempt}`, { token });
  check('user sees graded writing', r.data?.attempt?.band === 6.5 && r.data.attempt.feedback === 'Good structure', r.data);

  console.log('Admin: boshqaruv va eksport');
  r = await api('PATCH', `/api/admin/tests/${testId}`, { token: admin, body: { title: `Smoke reading ${stamp} (edited)` } });
  check('patch test keeps defaults', r.data?.test?.duration_minutes === 20 && r.data.test.is_published === true && r.data.test.content?.passage === 'Some passage', r.data);
  r = await api('PATCH', `/api/admin/questions/${qs[0].id}`, { token: admin, body: { prompt: 'Q1 edited' } });
  check('patch question keeps points', r.data?.question?.points === 1 && r.data.question.prompt === 'Q1 edited', r.data);
  for (const f of ['users', 'attempts']) {
    const res = await fetch(`${BASE}/api/admin/export/${f}.csv`, { headers: { Authorization: `Bearer ${admin}` } });
    const txt = await res.text();
    check(`export ${f}.csv`, res.status === 200 && txt.includes('id,') && res.headers.get('content-type').includes('text/csv'));
  }
  check('admin cannot block self', (await api('PATCH', `/api/admin/users/${adminId}`, { token: admin, body: { is_active: false } })).status === 400);
  r = await api('PATCH', `/api/admin/users/${uid}`, { token: admin, body: { is_active: false } });
  check('block user', r.data?.user?.is_active === false);
  check('blocked user cannot use token', (await api('GET', '/api/auth/me', { token })).status === 403);
  check('blocked user cannot login', (await api('POST', '/api/auth/login', { body: { email, password: 'password123' } })).status === 403);
  check('delete test', (await api('DELETE', `/api/admin/tests/${testId}`, { token: admin })).status === 204);
  await api('DELETE', `/api/admin/tests/${writingId}`, { token: admin });
  await api('DELETE', `/api/admin/users/${uid}`, { token: admin });
}

console.log(`\n${passed} o'tdi, ${failed} yiqildi`);
process.exit(failed ? 1 : 0);
