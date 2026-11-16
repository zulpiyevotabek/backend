// Jonli faollik jurnali: oxirgi so'rovlar xotirada saqlanadi (serverni qayta ishga tushirsa tozalanadi).
// Faqat o'zgartiruvchi metodlar (POST/PUT/PATCH/DELETE) yoziladi.
// Maxfiy maydonlar (parol, token) tanadan olib tashlanadi.
const MAX = 300;
const SKIP = new Set(['/api/track/heartbeat']); // juda ko'p, shovqin qiladi
const SECRET = /pass|token|secret|authorization/i;
const log = [];
let seq = 0;

function clean(value, depth = 0) {
  if (value == null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value;
  }
  if (depth > 4) return '…';
  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((v) => clean(v, depth + 1));
    if (value.length > 20) out.push(`…yana ${value.length - 20} ta`);
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? '***' : clean(v, depth + 1);
  return out;
}

export function activityMiddleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const started = Date.now();
  let error = null;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object') {
      error = { error: body.error, details: clean(body.details) };
    }
    return json(body);
  };
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (!path.startsWith('/api/') || SKIP.has(path)) return;
    log.push({
      id: ++seq,
      time: new Date().toISOString(),
      method: req.method,
      path,
      query: req.query && Object.keys(req.query).length ? clean(req.query) : null,
      status: res.statusCode,
      ms: Date.now() - started,
      user: req.user ? req.user.full_name || req.user.email : null,
      user_id: req.user?.id ?? null,
      role: req.user?.role ?? null,
      ip: req.ip,
      ua: String(req.headers['user-agent'] || '').slice(0, 160),
      body: clean(req.body),
      response: error,
    });
    if (log.length > MAX) log.shift();
  });
  next();
}

export function activitySince(afterId = 0, limit = 150) {
  return log.filter((e) => e.id > afterId).slice(-limit);
}
