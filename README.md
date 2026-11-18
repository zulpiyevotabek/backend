# IELTS Mock — Backend (Railway + PostgreSQL)

Node.js + Express + PostgreSQL backend. Bu loyiha frontend emas: API va `/admin` admin panelini taqdim etadi.

## Railway'ga joylash

1. ZIP ichidagi loyiha fayllarini GitHub repository'ga yuklang. `node_modules` va `.env` yuklamang.
2. Railway'da **New Project → Deploy from GitHub Repo** orqali repository'ni ulang.
3. Railway loyihasiga **PostgreSQL** service qo'shing.
4. Backend service → **Variables** bo'limida quyidagilarni kiriting:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Postgres service nomi boshqacha bo'lsa, o'sha nomdan foydalaning).
   - `JWT_SECRET` = uzun, tasodifiy maxfiy qiymat (kamida 32 belgi).
   - `ADMIN_EMAIL` = admin email.
   - `ADMIN_PASSWORD` = kuchli admin paroli (kamida 12 belgi tavsiya qilinadi).
   - `CORS_ORIGINS` = frontend domeni, masalan `https://saytingiz.netlify.app` (bir nechta domen vergul bilan ajratiladi).
   - `NODE_ENV` = `production`.
   - `STATS_TZ` = `Asia/Tashkent`.
5. Deploy sozlamalarida Root Directory bo'sh (`/`) qolsin. Build Command maydoni bo'sh qolsin (Railway avtomatik install qiladi). `railway.json` `npm start` va `/health` healthcheck'ni belgilaydi. Dependency install'ni Railway/Nixpacks avtomatik ravishda `package-lock.json` asosida bajaradi; Build Command maydoniga `npm ci` yozmang.
6. Deploy tugagach, Railway bergan public domain orqali tekshiring:
   - `/` — API holati.
   - `/health` — PostgreSQL ulanishi; `{"status":"ok",...}` chiqishi kerak.
   - `/admin` — admin panel.

**Muhim:** Railway PostgreSQL'ning private `DATABASE_URL` manzilidan foydalaning. Private URL uchun `DATABASE_SSL` kerak emas (default `false`). Agar ataylab public PostgreSQL URL ishlatsangiz, `DATABASE_SSL=true` qo'ying. `JWT_SECRET`, admin paroli va database URL'ni GitHub'ga yoki frontend `.env` fayliga joylamang.

Jadvallar server birinchi marta ishga tushganda avtomatik yaratiladi. Admin akkaunt `ADMIN_EMAIL` va `ADMIN_PASSWORD` orqali avtomatik yaratiladi. Admin parolini keyin yangilash uchun `ADMIN_RESET_PASSWORD=true` ni bir marta qo'shib redeploy qiling, so'ng darhol o'chiring.

## Frontendni ulash

1. `docs/frontend-api.js` faylini frontend loyihasiga `src/api.js` deb nusxalang.
2. Frontend ildizida `.env` yarating: `VITE_API_URL=https://SIZNING-BACKEND.up.railway.app` (Railway bergan haqiqiy domenni yozing).
3. `src/main.js` ga qo'shing:
   ```js
   import { trackVisit, startHeartbeat } from './api'
   trackVisit(); startHeartbeat();
   ```
   Router ishlatilsa, sahifa o'zgarganida `router.afterEach((to) => trackVisit(to.fullPath))` ham qo'shing.
4. Backend service Variables ichidagi `CORS_ORIGINS` qiymatiga frontendning to'liq HTTPS domenini yozing. O'zgartirgandan keyin redeploy qiling.
5. Funksiyalar: `register`, `login`, `listTests`, `startTest`, `saveAnswers`, `submitTest`, `myAttempts`.

## Lokal ishga tushirish

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
```

`/health` endpoint server va PostgreSQL ulanishini tekshiradi. `npm run smoke` integratsion tekshiruvlarni bajaradi (server ishlayotgan bo'lishi va `ADMIN_EMAIL`/`ADMIN_PASSWORD` berilgan bo'lishi kerak).

---

## API

Autentifikatsiya: `Authorization: Bearer <token>`. Xatolar: `{ "error": "matn", "details": [...] }`.

### Ochiq / foydalanuvchi
| Metod | Yo'l | Izoh |
|---|---|---|
| POST | `/api/auth/register` | `{full_name, email, password, phone?, target_band?}` → `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` → `{token, user}` |
| GET / PATCH | `/api/auth/me` | profil olish / yangilash |
| POST | `/api/auth/change-password` | `{current_password, new_password}` |
| POST | `/api/track/visit` | `{visitor_id, path?, referrer?}` — tashriflarni sanash (token shart emas) |
| POST | `/api/track/heartbeat` | "hozir onlayn" belgisi (token kerak) |
| GET | `/api/tests?section=reading` | nashr etilgan testlar ro'yxati |
| GET | `/api/tests/:id` | savollar bilan (to'g'ri javobsiz) |
| POST | `/api/attempts/start` | `{test_id}` → urinish + test + savollar (tugamagan urinish bo'lsa davom ettiradi) |
| PATCH | `/api/attempts/:id/answers` | `{answers:{ "<savolId>": "B" }}` — oraliq saqlash |
| POST | `/api/attempts/:id/submit` | `{answers?, time_spent_sec?}` → ball, band, sharh |
| GET | `/api/attempts/me`, `/api/attempts/:id` | natijalar tarixi / bitta natija |

### Admin (`role = admin`)
| Metod | Yo'l | Izoh |
|---|---|---|
| GET | `/api/admin/stats/overview` | umumiy: foydalanuvchilar, tashrifchilar, **hozir onlayn**, urinishlar |
| GET | `/api/admin/stats/timeseries?days=30` | kunlar bo'yicha grafik ma'lumoti |
| GET | `/api/admin/stats/online` | hozir onlayn foydalanuvchilar |
| GET | `/api/admin/stats/sections`, `/stats/tests`, `/stats/bands` | bo'lim / test / band tahlili |
| GET | `/api/admin/stats/tests/:id/questions` | har bir savol bo'yicha to'g'ri javob foizi |
| GET | `/api/admin/logins` | so'nggi kirishlar |
| GET | `/api/admin/users?q=&page=&sort=` | foydalanuvchilar (qidiruv, sahifalash) |
| GET / PATCH / DELETE | `/api/admin/users/:id` | tafsilot / bloklash (`{is_active}`), rol / o'chirish |
| GET | `/api/admin/attempts?status=submitted&section=writing` | urinishlar |
| GET | `/api/admin/attempts/:id` | javoblar + to'g'ri javoblar |
| PATCH | `/api/admin/attempts/:id/grade` | `{band: 6.5, feedback?}` — Writing'ni baholash |
| GET / POST | `/api/admin/tests` | testlar ro'yxati / yangi test (savollari bilan) |
| GET / PATCH / DELETE | `/api/admin/tests/:id` | test |
| POST | `/api/admin/tests/:id/questions` | savol(lar) qo'shish |
| PATCH / DELETE | `/api/admin/questions/:qid` | savolni tahrirlash / o'chirish |
| GET | `/api/admin/export/users.csv`, `/export/attempts.csv` | Excel uchun CSV |

### Test yaratish namunasi
```bash
curl -X POST https://MANZIL/api/admin/tests \
  -H "Authorization: Bearer ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "title": "Reading Test 1", "section": "reading", "duration_minutes": 60, "is_published": true,
    "content": { "passage": "Matn shu yerda..." },
    "questions": [
      { "type": "mcq",  "prompt": "Savol?", "options": ["A. bir", "B. ikki"], "correct_answer": "B" },
      { "type": "tfng", "prompt": "Gap...", "options": ["TRUE","FALSE","NOT GIVEN"], "correct_answer": "FALSE" },
      { "type": "fill", "prompt": "The capital is ____", "correct_answer": ["paris", "Paris"] },
      { "type": "multi", "prompt": "2 tasini tanlang", "options": ["A","B","C"], "correct_answer": ["A","C"] }
    ]
  }'
```
Listening uchun audio havolasini `content: { "audio_url": "https://..." }` ga yozing (audio faylni backend serverdan tashqarida — masalan Cloudflare R2/S3 — saqlash tavsiya etiladi).

**Savol turlari:** `mcq`, `tfng`, `ynng`, `fill`, `matching` (bitta javob), `multi` (bir nechta javob, tartibi muhim emas), `essay` (qo'lda baholanadi).
Javoblarni solishtirishda katta-kichik harf va ortiqcha bo'shliqlar e'tiborga olinmaydi; `correct_answer` massiv bo'lsa — barcha variantlar to'g'ri hisoblanadi.

## Eslatmalar

- **Band hisobi** — taxminiy Academic Reading/Listening jadvali (40 savolga moslab olinadi), `src/lib/scoring.js`. Writing bandni admin qo'yadi.
- **"Hozir onlayn"** — so'nggi 5 daqiqada faol bo'lganlar (`ONLINE_WINDOW_MINUTES` bilan o'zgartiriladi).
- **Xavfsizlik** — login/ro'yxatdan o'tishga cheklov (15 daqiqada 30 ta urinish), helmet, CORS ro'yxati, parametrli SQL so'rovlar, CSV'da formula inyeksiyasidan himoya.
- Foydalanuvchi bloklansa, uning eski tokeni ham darhol ishlamay qoladi.
- Admin panel tokenni brauzer `sessionStorage`'ida saqlaydi (tab yopilganda o'chadi).
