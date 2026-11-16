import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { migrate, pool, query } from './db.js';
import { createApp } from './app.js';

/** ADMIN_EMAIL va ADMIN_PASSWORD berilgan bo'lsa, birinchi adminni yaratadi */
async function ensureAdmin() {
  if (!config.adminEmail || !config.adminPassword) {
    console.log('[admin] ADMIN_EMAIL/ADMIN_PASSWORD berilmagan — admin yaratilmadi');
    return;
  }
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [config.adminEmail]);
  if (!rows[0]) {
    await query(
      `INSERT INTO users (full_name, email, password_hash, role) VALUES ('Admin', $1, $2, 'admin')`,
      [config.adminEmail, await bcrypt.hash(config.adminPassword, 10)],
    );
    console.log(`[admin] yaratildi: ${config.adminEmail}`);
  } else {
    // Mavjud akkauntni admin qilib qo'yamiz; parol faqat ADMIN_RESET_PASSWORD=true bo'lsa almashadi
    await query("UPDATE users SET role = 'admin', is_active = TRUE WHERE id = $1", [rows[0].id]);
    if (config.adminResetPassword) {
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        rows[0].id,
        await bcrypt.hash(config.adminPassword, 10),
      ]);
      console.log('[admin] paroli yangilandi (ADMIN_RESET_PASSWORD o\'chirib qo\'yishni unutmang)');
    }
  }
}

async function main() {
  await migrate();
  await ensureAdmin();
  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () =>
    console.log(`[server] http://0.0.0.0:${config.port} (${config.isProd ? 'production' : 'development'})`),
  );

  // Render deploy/restart paytida toza to'xtash
  const shutdown = (sig) => {
    console.log(`[server] ${sig} — to'xtatilmoqda`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
