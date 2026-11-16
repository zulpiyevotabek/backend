# IELTS Mock — Backend (Render + PostgreSQL)

Node.js + Express + PostgreSQL backend. Bu loyiha frontend emas: u API va `/admin` admin panelini taqdim etadi.

## Render'ga joylash — tayyor Blueprint

Loyiha ildizida `render.yaml` bor. U Render'da backend servisi va PostgreSQL bazasini yaratib, `DATABASE_URL` ni avtomatik ulaydi.

1. ZIP'ni oching. Ichidagi `ielts-backend` papkasini GitHub'ga alohida repository qilib yuklang. `node_modules` va `.env` yuklamang.
2. Render.com'ga kiring → **New** → **Blueprint**.
3. GitHub repository'ni tanlang va `render.yaml` topilganini tekshiring.
4. **Apply** bosing. Render backend va PostgreSQL resurslarini yaratadi.
5. Blueprint yaratish vaqtida so'ralgan `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGINS` qiymatlarini kiriting:
   - `ADMIN_EMAIL`: admin uchun email.
   - `ADMIN_PASSWORD`: kamida 12 belgili kuchli parol.
   - `CORS_ORIGINS`: frontend domeni, masalan `https://sizning-saytingiz.netlify.app`. Bir nechta domen bo'lsa vergul bilan yozing. Frontend hali tayyor bo'lmasa, vaqtincha `*` yozish mumkin, lekin ommaviy ishga tushirishdan oldin aniq domen bilan almashtiring.
6. Deploy tugagach Render backend uchun `https://...onrender.com` domen beradi.

**Narx haqida:** Blueprint `starter` web service va `basic-256mb` PostgreSQL rejasini tanlaydi; ular pullik bo'lishi mumkin. Apply bosishdan oldin Render ko'rsatadigan narxni tekshiring. Bepul web service ishlatmoqchi bo'lsangiz, Dashboard'da web service rejasini mavjud bepul rejaga o'zgartiring. PostgreSQL narxi va amal qilish shartlarini alohida tekshiring.

### Ishlayotganini tekshirish

Brauzerda quyidagilarni oching (domenni o'zingiznikiga almashtiring):

- `https://SIZNING-BACKEND.onrender.com/` — API holati.
- `https://SIZNING-BACKEND.onrender.com/health` — PostgreSQL bilan ulanish tekshiruvi; `{"status":"ok",...}` chiqishi kerak.
- `https://SIZNING-BACKEND.onrender.com/admin` — admin panel.

Jadvallar birinchi ishga tushishda avtomatik yaratiladi. Admin akkaunt ham `ADMIN_EMAIL` va `ADMIN_PASSWORD` orqali avtomatik yaratiladi. Admin parolini keyin o'zgartirish uchun `ADMIN_RESET_PASSWORD=true` ni bir marta qo'shib redeploy qiling, keyin uni darhol o'chiring.

## Render Environment sozlamalari

Render → backend service → **Environment** bo'limida:
- `DATABASE_URL` Blueprint orqali PostgreSQL'dan avtomatik olinadi. Uni qo'lda boshqa URL bilan almashtirmang.
- `JWT_SECRET` avtomatik yaratiladi; uni o'chirmang yoki oshkor qilmang.
- `CORS_ORIGINS` ga frontendning to'liq HTTPS domenini yozing (oxirida `/` bo'lmasin).
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` maxfiy qiymat bo'lib qolishi kerak; ularni GitHub'ga yozmang.

## Frontendni ulash

1. `docs/frontend-api.js` faylini frontend loyihasiga `src/api.js` deb nusxalang.
2. Frontend ildizida `.env` yarating: `VITE_API_URL=https://SIZNING-BACKEND.up.railway.app`
3. `src/main.js` ga qo'shing:
   ```js
   import { trackVisit, startHeartbeat } from './api'
   trackVisit(); startHeartbeat();
   ```
   (Router ishlatilganda har bir sahifa o'zgarishida `router.afterEach((to) => trackVisit(to.fullPath))` ham qo'shing.)
4. Boshqa funksiyalar: `register`, `login`, `listTests`, `startTest`, `saveAnswers`, `submitTest`, `myAttempts`.

## Lokal ishga tushirish

```bash
cp .env.example .env     # DATABASE_URL ni o'zingizning Postgres'ingizga moslang
npm install
npm run seed             # ixtiyoriy: 2 ta namuna test
npm run dev              # http://localhost:3000
npm run smoke            # (server ishlayotganda) hamma narsani tekshiradi
```

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
