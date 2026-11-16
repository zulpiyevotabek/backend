// Frontend loyihangizga nusxalang: src/api.js
// .env (frontend ildizida):  VITE_API_URL=https://SIZNING-BACKEND.up.railway.app
//
// Ishlatish (masalan main.js'da):
//   import { trackVisit, startHeartbeat } from './api'
//   trackVisit(); startHeartbeat();

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

/* ---------- token va tashrifchi ID ---------- */
const TOKEN_KEY = 'ielts_token';
const VISITOR_KEY = 'ielts_visitor_id';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

function visitorId() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

/* ---------- asosiy so'rov funksiyasi ---------- */
export async function request(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null); // token eskirgan
    const err = new Error(data.error || `Xato ${res.status}`);
    err.status = res.status;
    err.details = data.details; // validatsiya xatolari: [{ field, message }]
    throw err;
  }
  return data;
}

/* ---------- autentifikatsiya ---------- */
export async function register({ full_name, email, password, phone, target_band }) {
  const data = await request('/api/auth/register', { method: 'POST', body: { full_name, email, password, phone, target_band } });
  setToken(data.token);
  return data.user;
}

export async function login(email, password) {
  const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  setToken(data.token);
  return data.user;
}

export const logout = () => setToken(null);
export const getMe = () => request('/api/auth/me').then((d) => d.user);

/* ---------- testlar ---------- */
export const listTests = (section) =>
  request(`/api/tests${section ? `?section=${section}` : ''}`).then((d) => d.tests);

// Testni boshlaydi (yoki davom ettiradi). Qaytaradi: { attempt, test: { questions, content, ... } }
export const startTest = (testId) => request('/api/attempts/start', { method: 'POST', body: { test_id: testId } });

// answers: { [questionId]: "B" | "TRUE" | "matn" | ["A","C"] }
export const saveAnswers = (attemptId, answers) =>
  request(`/api/attempts/${attemptId}/answers`, { method: 'PATCH', body: { answers } });

// Topshirish: natija + to'g'ri javoblar bilan sharh (review) qaytadi
export const submitTest = (attemptId, answers, timeSpentSec) =>
  request(`/api/attempts/${attemptId}/submit`, { method: 'POST', body: { answers, time_spent_sec: timeSpentSec } });

export const myAttempts = () => request('/api/attempts/me').then((d) => d.attempts);
export const getAttempt = (id) => request(`/api/attempts/${id}`);

/* ---------- statistika uchun ---------- */
// Sahifa ochilganda / route o'zgarganda chaqiring (ro'yxatdan o'tmaganlar ham sanaladi)
export function trackVisit(path = location.pathname) {
  return request('/api/track/visit', {
    method: 'POST',
    body: { visitor_id: visitorId(), path, referrer: document.referrer || undefined },
  }).catch(() => {}); // statistika xatosi sahifani buzmasin
}

// Kirgan foydalanuvchi uchun "hozir onlayn" belgisi (har 60 soniyada)
export function startHeartbeat(everyMs = 60_000) {
  const tick = () => {
    if (getToken() && !document.hidden) request('/api/track/heartbeat', { method: 'POST' }).catch(() => {});
  };
  tick();
  return setInterval(tick, everyMs);
}
