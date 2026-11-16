'use strict';
// Admin panel: faqat /api/admin/* endpointlaridan foydalanadi. Foydalanuvchi matnlari
// har doim textContent orqali qo'yiladi (XSS'dan himoya).

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) n.append(kid instanceof Node ? kid : document.createTextNode(kid ?? ''));
  return n;
};

let token = sessionStorage.getItem('ielts_admin_token');

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) { logout(); throw new Error('Kirish talab qilinadi'); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Xato ${res.status}`);
  return data;
}

async function download(path, filename) {
  const res = await fetch('/api/admin' + path, { headers: { Authorization: `Bearer ${token}` } });
  const url = URL.createObjectURL(await res.blob());
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ---------- format yordamchilari ---------- */
const fmtDate = (v) => (v ? new Date(v).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtDur = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}s ${Math.round((s % 3600) / 60)}d` : `${Math.round(s / 60)} daq`);
const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d).replace(/\.0+$/, ''));
const STATUS = { in_progress: ['Jarayonda', ''], submitted: ['Baholash kutilmoqda', 'warn'], graded: ['Baholangan', 'ok'], expired: ['Muddati tugagan', 'bad'] };
const statusBadge = (s) => el('span', { class: `badge ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);

function table(cols, rows, onRow) {
  const t = el('table', {}, el('thead', {}, el('tr', {}, cols.map((c) => el('th', { class: c.num ? 'num' : '' }, c.label)))));
  const body = el('tbody');
  if (!rows.length) body.append(el('tr', {}, el('td', { colspan: cols.length, class: 'muted' }, 'Hozircha ma\'lumot yo\'q')));
  for (const r of rows) {
    const tr = el('tr', { class: onRow ? 'click' : '' }, cols.map((c) => el('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : (r[c.key] ?? '—'))));
    if (onRow) tr.addEventListener('click', () => onRow(r));
    body.append(tr);
  }
  t.append(body);
  return t;
}

/* ---------- login ---------- */
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function logout() { token = null; sessionStorage.removeItem('ielts_admin_token'); showLogin(); }
$('#logout').addEventListener('click', logout);

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#email').value, password: $('#password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kirib bo\'lmadi');
    if (data.user.role !== 'admin') throw new Error('Bu akkaunt admin emas');
    token = data.token;
    sessionStorage.setItem('ielts_admin_token', token);
    $('#password').value = '';
    start();
  } catch (err) { $('#login-error').textContent = err.message; }
});

/* ---------- tablar ---------- */
const loaders = { dashboard: loadDashboard, users: loadUsers, attempts: loadAttempts, tests: loadTests };
let currentTab = 'dashboard';
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const tab = btn?.dataset?.tab;
  if (!tab) return;
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('main > section').forEach((s) => s.classList.toggle('hidden', s.id !== `tab-${tab}`));
  renderLiveBadge();
  loaders[tab]().catch(showError);
});
const showError = (err) => alert(err.message);

/* ---------- dashboard ---------- */
function kpi(value, label, sub) {
  return el('div', { class: 'kpi' }, el('div', { class: 'v' }, value ?? 0), el('div', { class: 'l' }, label), sub ? el('div', { class: 's' }, sub) : '');
}

function lineChart(series) {
  const W = 620, H = 220, P = { l: 34, r: 10, t: 10, b: 24 };
  const keys = [['unique_visitors', 'Tashrifchilar', 'var(--c1)'], ['new_users', 'Yangi foydalanuvchi', 'var(--c2)'], ['attempts', 'Topshirilgan test', 'var(--c3)']];
  const max = Math.max(4, Math.ceil(Math.max(...series.flatMap((d) => keys.map(([k]) => d[k]))) / 4) * 4);
  const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, series.length - 1);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', '100%');
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; svg.append(n); return n; };
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((max * i) / 4);
    add('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: 'var(--line)' });
    add('text', { x: P.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, v);
  }
  [0, Math.floor(series.length / 2), series.length - 1].forEach((i) => series[i] && add('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle' }, series[i].date.slice(5)));
  for (const [k, , color] of keys) {
    add('polyline', { fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', points: series.map((d, i) => `${x(i)},${y(d[k])}`).join(' ') });
  }
  $('#chart-legend').replaceChildren(...keys.map(([, label, color]) => el('span', {}, el('i', { style: `background:${color}` }), label)));
  return svg;
}

function barList(rows, labelFn, valueFn, max, valueLabel) {
  return rows.length
    ? rows.map((r) => el('div', { class: 'bar-row' }, el('span', {}, labelFn(r)), el('div', { class: 'bar' }, el('div', { style: `width:${Math.round((valueFn(r) / max) * 100)}%` })), el('span', { class: 'num' }, valueLabel(r))))
    : [el('p', { class: 'muted' }, 'Hozircha ma\'lumot yo\'q')];
}

async function loadDashboard() {
  const [ov, ts, sec, bands, online, logins, tests] = await Promise.all([
    api('/stats/overview'), api('/stats/timeseries?days=30'), api('/stats/sections'),
    api('/stats/bands'), api('/stats/online'), api('/logins?limit=8'), api('/stats/tests'),
  ]);
  const { users, traffic, online_now: on, attempts } = ov;
  $('#kpis').replaceChildren(
    el('div', { class: 'kpi' }, el('div', { class: 'v' }, el('span', { class: 'dot' }), on.total), el('div', { class: 'l' }, 'Hozir saytda'), el('div', { class: 's' }, `${on.users} ta kirgan, ${on.visitors} ta tashrifchi (so'nggi ${ov.online_window_minutes} daq)`)),
    kpi(traffic.unique_visitors_today, 'Bugungi tashrifchilar', `${traffic.visits_today} ta ko'rish · 7 kunda ${traffic.unique_visitors_7d}`),
    kpi(traffic.active_users_today, 'Bugun kirganlar', `${traffic.logins_today} ta kirish · 7 kunda ${traffic.active_users_7d}`),
    kpi(users.total, 'Ro\'yxatdan o\'tganlar', `Bugun +${users.new_today} · 7 kunda +${users.new_7d}`),
    kpi(attempts.submitted_total, 'Topshirilgan testlar', `Bugun ${attempts.submitted_today} · jarayonda ${attempts.in_progress}`),
    kpi(fmtNum(attempts.avg_band, 2), 'O\'rtacha band', attempts.pending_grading ? `${attempts.pending_grading} ta baholash kutmoqda` : 'Hammasi baholangan'),
  );
  $('#chart').replaceChildren(lineChart(ts.series));
  $('#sections').replaceChildren(...barList(sec.sections, (r) => r.section, (r) => r.avg_band || 0, 9, (r) => `${fmtNum(r.avg_band)} · ${r.attempts} ta`));
  const bmax = Math.max(1, ...bands.distribution.map((b) => b.count));
  $('#bands').replaceChildren(...barList(bands.distribution, (r) => `Band ${r.band}`, (r) => r.count, bmax, (r) => r.count));
  $('#online-note').textContent = `(${online.visitors} ta tashrifchi)`;
  $('#online').replaceChildren(table([
    { label: 'Ism', key: 'full_name' }, { label: 'Email', key: 'email' }, { label: 'Oxirgi faollik', render: (r) => fmtDate(r.last_seen_at) },
  ], online.users.slice(0, 10)));
  $('#logins').replaceChildren(table([
    { label: 'Ism', key: 'full_name' }, { label: 'Vaqt', render: (r) => fmtDate(r.created_at) }, { label: 'IP', key: 'ip' },
  ], logins.logins));
  $('#test-stats').replaceChildren(table([
    { label: 'Test', key: 'title' }, { label: 'Bo\'lim', key: 'section' },
    { label: 'Urinishlar', key: 'attempts', num: true }, { label: 'Foydalanuvchilar', key: 'users', num: true },
    { label: 'O\'rt. band', num: true, render: (r) => fmtNum(r.avg_band, 2) }, { label: 'O\'rt. %', num: true, render: (r) => (r.avg_percent == null ? '—' : r.avg_percent + '%') },
    { label: 'O\'rt. vaqt', num: true, render: (r) => fmtDur(r.avg_time_sec) },
  ], tests.tests, (r) => openTestQuestions(r)));
}

async function openTestQuestions(test) {
  const d = await api(`/stats/tests/${test.id}/questions`);
  openDialog(el('div', {}, el('h2', {}, `${d.test.title} — savollar bo'yicha`), el('p', { class: 'muted' }, `${d.total_attempts} ta urinish asosida`),
    table([{ label: '#', key: 'position', num: true }, { label: 'Savol', render: (r) => r.prompt.slice(0, 70) }, { label: 'To\'g\'ri', num: true, render: (r) => (r.correct_percent == null ? '—' : r.correct_percent + '%') }], d.questions)));
}

/* ---------- foydalanuvchilar ---------- */
let usersPage = 1;
async function loadUsers() {
  const q = $('#user-q').value.trim();
  const d = await api(`/users?page=${usersPage}&limit=20${q ? '&q=' + encodeURIComponent(q) : ''}`);
  $('#users').replaceChildren(table([
    { label: 'Ism', key: 'full_name' }, { label: 'Email', key: 'email' }, { label: 'Telefon', key: 'phone' },
    { label: 'Ro\'yxatdan o\'tgan', render: (r) => fmtDate(r.created_at) }, { label: 'Oxirgi kirish', render: (r) => fmtDate(r.last_login_at) },
    { label: 'Testlar', key: 'attempts', num: true }, { label: 'O\'rt. band', num: true, render: (r) => fmtNum(r.avg_band, 2) },
    { label: 'Holat', render: (r) => el('span', { class: `badge ${r.is_active ? 'ok' : 'bad'}` }, r.role === 'admin' ? 'admin' : r.is_active ? 'faol' : 'bloklangan') },
  ], d.users, openUser));
  pager('#users-pager', d, (p) => { usersPage = p; loadUsers().catch(showError); });
}
let debounce;
$('#user-q').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { usersPage = 1; loadUsers().catch(showError); }, 300); });
$('#export-users').addEventListener('click', () => download('/export/users.csv', 'users.csv'));

function pager(sel, d, go) {
  const pages = Math.max(1, Math.ceil(d.total / d.limit));
  $(sel).replaceChildren(el('span', {}, `Jami: ${d.total}`),
    el('button', { class: 'ghost', disabled: d.page <= 1, onclick: () => go(d.page - 1) }, '←'),
    el('span', {}, `${d.page} / ${pages}`),
    el('button', { class: 'ghost', disabled: d.page >= pages, onclick: () => go(d.page + 1) }, '→'));
}

async function openUser(u) {
  const d = await api(`/users/${u.id}`);
  const toggle = el('button', { class: 'ghost', onclick: async () => {
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { is_active: !d.user.is_active } }); closeDialog(); loadUsers(); } catch (e) { showError(e); }
  } }, d.user.is_active ? 'Bloklash' : 'Blokdan chiqarish');
  openDialog(el('div', {},
    el('h2', {}, d.user.full_name),
    el('p', { class: 'muted' }, `${d.user.email} · ${d.user.phone || 'telefon yo\'q'} · maqsad band: ${d.user.target_band ?? '—'}`),
    el('p', {}, `Kirishlar: ${d.logins.total} · oxirgisi: ${fmtDate(d.logins.last)}`),
    el('div', { class: 'row' }, toggle),
    table([
      { label: 'Test', key: 'title' }, { label: 'Holat', render: (r) => statusBadge(r.status) },
      { label: 'Ball', num: true, render: (r) => (r.raw_score == null ? '—' : `${r.raw_score}/${r.max_score}`) },
      { label: 'Band', num: true, render: (r) => fmtNum(r.band) }, { label: 'Sana', render: (r) => fmtDate(r.submitted_at || r.started_at) },
    ], d.attempts.filter((a) => a.status !== 'expired'), (r) => openAttempt(r.id))));
}

/* ---------- urinishlar ---------- */
let attemptsPage = 1;
async function loadAttempts() {
  const qs = new URLSearchParams({ page: attemptsPage, limit: 20 });
  if ($('#attempt-status').value) qs.set('status', $('#attempt-status').value);
  if ($('#attempt-section').value) qs.set('section', $('#attempt-section').value);
  const d = await api(`/attempts?${qs}`);
  $('#attempts').replaceChildren(table([
    { label: 'Foydalanuvchi', key: 'full_name' }, { label: 'Test', key: 'title' }, { label: 'Bo\'lim', key: 'section' },
    { label: 'Holat', render: (r) => statusBadge(r.status) },
    { label: 'Ball', num: true, render: (r) => (r.raw_score == null ? '—' : `${r.raw_score}/${r.max_score}`) },
    { label: 'Band', num: true, render: (r) => fmtNum(r.band) }, { label: 'Vaqt', num: true, render: (r) => fmtDur(r.time_spent_sec) },
    { label: 'Topshirilgan', render: (r) => fmtDate(r.submitted_at) },
  ], d.attempts, (r) => openAttempt(r.id)));
  pager('#attempts-pager', d, (p) => { attemptsPage = p; loadAttempts().catch(showError); });
}
['#attempt-status', '#attempt-section'].forEach((s) => $(s).addEventListener('change', () => { attemptsPage = 1; loadAttempts().catch(showError); }));
$('#export-attempts').addEventListener('click', () => download('/export/attempts.csv', 'attempts.csv'));

async function openAttempt(id) {
  const { attempt: a, review } = await api(`/attempts/${id}`);
  const hasEssay = review.some((q) => q.type === 'essay');
  const body = el('div', {},
    el('h2', {}, `${a.full_name} — ${a.title}`),
    el('div', { class: 'row' }, statusBadge(a.status), el('span', {}, a.raw_score != null ? `Ball: ${a.raw_score}/${a.max_score}` : ''), el('span', {}, `Band: ${fmtNum(a.band)}`), el('span', { class: 'muted' }, fmtDate(a.submitted_at))),
    review.map((q) => el('div', { class: 'q' },
      el('strong', {}, `${q.position}. `), q.prompt,
      q.type === 'essay'
        ? el('pre', {}, q.your_answer || '(javob yo\'q)')
        : el('div', {}, el('span', { class: `badge ${q.is_correct ? 'ok' : 'bad'}` }, q.is_correct ? 'to\'g\'ri' : 'noto\'g\'ri'),
            ` Javobi: ${Array.isArray(q.your_answer) ? q.your_answer.join(', ') : q.your_answer ?? '—'} · To'g'risi: ${[].concat(q.correct_answer ?? '—').join(' / ')}`))));
  if (hasEssay && a.status !== 'in_progress') {
    const band = el('input', { type: 'number', min: 0, max: 9, step: 0.5, value: a.band ?? '', placeholder: 'Band', style: 'width:90px' });
    const fb = el('textarea', { rows: 3, placeholder: 'Izoh (ixtiyoriy)', style: 'width:100%' }, a.feedback || '');
    body.append(el('div', { class: 'row' }, band), fb, el('div', { class: 'row' }, el('button', { onclick: async () => {
      try { await api(`/attempts/${id}/grade`, { method: 'PATCH', body: { band: Number(band.value), feedback: fb.value || null } }); closeDialog(); loaders[currentTab]().catch(showError); } catch (e) { showError(e); }
    } }, 'Baholashni saqlash')));
  }
  openDialog(body);
}

/* ---------- testlar ---------- */
async function loadTests() {
  const d = await api('/tests');
  $('#tests').replaceChildren(table([
    { label: 'ID', key: 'id', num: true }, { label: 'Test', key: 'title' }, { label: 'Bo\'lim', key: 'section' },
    { label: 'Savollar', key: 'question_count', num: true }, { label: 'Daqiqa', key: 'duration_minutes', num: true },
    { label: 'Urinishlar', key: 'attempts', num: true },
    { label: 'Holat', render: (r) => el('span', { class: `badge ${r.is_published ? 'ok' : ''}` }, r.is_published ? 'nashr etilgan' : 'qoralama') },
    { label: '', render: (r) => el('button', { class: 'ghost', onclick: async (e) => {
      e.stopPropagation();
      try { await api(`/tests/${r.id}`, { method: 'PATCH', body: { is_published: !r.is_published } }); loadTests(); } catch (err) { showError(err); }
    } }, r.is_published ? 'Yashirish' : 'Nashr etish') },
  ], d.tests));
}

/* ---------- dialog ---------- */
const dialog = $('#dialog');
function openDialog(node) { $('#dialog-body').replaceChildren(node); dialog.showModal(); }
function closeDialog() { dialog.close(); }
$('#dialog-close').addEventListener('click', closeDialog);

/* ---------- jonli faollik ---------- */
let liveLast = 0, livePaused = false, liveEvents = [], unseen = 0;
const loaders_live = async () => { unseen = 0; renderLiveBadge(); await pollLive(true); renderLive(); };
loaders.live = loaders_live;
const liveMethods = () => new Set([...document.querySelectorAll('#live-filters input:checked')].map((i) => i.value));
function renderLiveBadge() {
  const b = $('#live-count');
  b.textContent = unseen; b.classList.toggle('hidden', !unseen || currentTab === 'live');
}
function renderLive(newIds = new Set()) {
  const show = liveMethods();
  const rows = liveEvents.filter((e) => show.has(e.method)).slice().reverse();
  const t = table([
    { label: 'Vaqt', render: (e) => new Date(e.time).toLocaleTimeString('uz-UZ') },
    { label: 'Metod', render: (e) => el('span', { class: `m ${e.method}` }, e.method) },
    { label: 'Manzil', key: 'path' },
    { label: 'Status', render: (e) => el('span', { class: `st ${e.status < 400 ? 'ok' : 'bad'}` }, String(e.status)) },
    { label: 'Kim', render: (e) => e.user || 'mehmon' },
    { label: 'ms', key: 'ms', num: true },
  ], rows, openEvent);
  t.querySelectorAll('tbody tr').forEach((tr, i) => { if (rows[i] && newIds.has(rows[i].id)) tr.classList.add('new'); });
  $('#live-list').replaceChildren(t);
}
const json = (v) => el('pre', {}, JSON.stringify(v, null, 2));
function openEvent(e) {
  const row = (k, v) => [el('dt', {}, k), el('dd', {}, v ?? '—')];
  openDialog(el('div', { class: 'detail' },
    el('h2', {}, el('span', { class: `m ${e.method}` }, e.method), e.path),
    el('dl', {},
      row('Status', `${e.status} · ${e.ms} ms`), row('Vaqt', new Date(e.time).toLocaleString('uz-UZ')),
      row('Kim', e.user ? `${e.user} (${e.role}, #${e.user_id})` : 'mehmon (kirmagan)'),
      row('IP', e.ip), row('Brauzer', e.ua)),
    e.query ? [el('strong', {}, 'Query'), json(e.query)] : '',
    el('strong', {}, 'So\'rov tanasi (parol/token yashirilgan)'), json(e.body ?? {}),
    e.response ? [el('strong', {}, 'Xato javobi'), json(e.response)] : ''));
}
async function pollLive(force = false) {
  if (!token || (!force && (livePaused || document.hidden))) return;
  const { events } = await api(`/activity?after=${liveLast}`);
  if (!events.length) return;
  liveLast = events[events.length - 1].id;
  liveEvents = liveEvents.concat(events).slice(-300);
  if (currentTab === 'live') renderLive(new Set(events.map((x) => x.id)));
  else { unseen += events.length; renderLiveBadge(); }
}
$('#live-pause').addEventListener('click', (e) => { livePaused = !livePaused; e.target.textContent = livePaused ? 'Davom' : 'Pauza'; });
$('#live-clear').addEventListener('click', () => { liveEvents = []; renderLive(); });
$('#live-filters').addEventListener('change', () => renderLive());
setInterval(() => pollLive().catch(() => {}), 3000);

/* ---------- start ---------- */
function start() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  loaders[currentTab]().catch(showError);
}
if (token) start(); else showLogin();
setInterval(() => { if (token && currentTab === 'dashboard' && !document.hidden) loadDashboard().catch(() => {}); }, 30_000);
