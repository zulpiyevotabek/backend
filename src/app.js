import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
import trackRoutes from './routes/track.js';
import testRoutes from './routes/tests.js';
import attemptRoutes from './routes/attempts.js';
import adminRoutes from './routes/admin.js';
import { activityMiddleware } from './lib/activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render proxy ortida haqiqiy IP olish uchun

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, cb) {
        // origin yo'q = curl/server-server; bo'lsa ro'yxat bo'yicha tekshiramiz
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          return cb(null, true);
        }
        cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: '300kb' }));
  app.use(activityMiddleware);

  app.get('/', (_req, res) =>
    res.json({ name: 'IELTS mock backend', status: 'ok', admin_panel: '/admin', health: '/health' }),
  );

  // Render health check uchun
  app.get('/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/track', trackRoutes);
  app.use('/api/tests', testRoutes);
  app.use('/api/attempts', attemptRoutes);
  app.use('/api/admin', adminRoutes);

  // Oddiy admin panel (statik sahifa; ma'lumotni /api/admin/* dan oladi)
  app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint topilmadi')));
  app.use((_req, _res, next) => next(new HttpError(404, 'Topilmadi')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON noto\'g\'ri' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'So\'rov juda katta' });
    console.error('[error]', err);
    res.status(500).json({ error: 'Server xatosi' });
  });

  return app;
}
