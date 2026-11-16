import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT);

if (isProd && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET o\'rnatilmagan. Railway Variables bo\'limida JWT_SECRET qo\'shing.');
}
if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL o\'rnatilmagan. Railway\'da PostgreSQL qo\'shing yoki .env faylga yozing.');
}

export const config = {
  isProd,
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL,
  // Railway'ning ichki tarmog'ida SSL kerak emas; tashqi (public) URL uchun DATABASE_SSL=true qo'ying
  databaseSsl: env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  corsOrigins: (env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
  adminPassword: env.ADMIN_PASSWORD || null,
  adminResetPassword: env.ADMIN_RESET_PASSWORD === 'true',
  // Statistikadagi "bugun" qaysi vaqt zonasi bo'yicha hisoblanishi
  statsTz: env.STATS_TZ || 'Asia/Tashkent',
  // Test vaqti tugagandan keyin yana necha daqiqa topshirishga ruxsat
  submitGraceMinutes: Number(env.SUBMIT_GRACE_MINUTES) || 5,
  onlineWindowMinutes: Number(env.ONLINE_WINDOW_MINUTES) || 5,
};
