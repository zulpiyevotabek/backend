-- IELTS mock backend sxemasi. Server ishga tushganda har safar xavfsiz (idempotent) bajariladi.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  full_name     TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  target_band   NUMERIC(2,1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_seen  ON users (last_seen_at);

-- Har bir muvaffaqiyatli kirish (login) yozib boriladi
CREATE TABLE IF NOT EXISTS login_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events (created_at);
CREATE INDEX IF NOT EXISTS idx_login_events_user    ON login_events (user_id);

-- Saytga tashriflar (ro'yxatdan o'tmaganlar ham, visitor_id orqali)
CREATE TABLE IF NOT EXISTS visits (
  id         BIGSERIAL PRIMARY KEY,
  visitor_id TEXT        NOT NULL,
  user_id    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  path       TEXT,
  referrer   TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits (created_at);
CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits (visitor_id);

CREATE TABLE IF NOT EXISTS tests (
  id               BIGSERIAL PRIMARY KEY,
  title            TEXT        NOT NULL,
  section          TEXT        NOT NULL CHECK (section IN ('reading', 'listening', 'writing')),
  description      TEXT,
  duration_minutes INT         NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  -- passage matni, audio_url, rasm havolalari va h.k. (erkin JSON)
  content          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_published     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id             BIGSERIAL PRIMARY KEY,
  test_id        BIGINT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  position       INT    NOT NULL DEFAULT 0,
  type           TEXT   NOT NULL CHECK (type IN ('mcq', 'tfng', 'ynng', 'fill', 'matching', 'multi', 'essay')),
  prompt         TEXT   NOT NULL,
  options        JSONB,
  -- string | string[] (qabul qilinadigan variantlar) | multi uchun string[] (to'plam)
  correct_answer JSONB,
  points         INT    NOT NULL DEFAULT 1 CHECK (points >= 0)
);
CREATE INDEX IF NOT EXISTS idx_questions_test ON questions (test_id, position, id);

CREATE TABLE IF NOT EXISTS attempts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id         BIGINT      NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'submitted', 'graded', 'expired')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  time_spent_sec  INT,
  answers         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  raw_score       INT,
  max_score       INT,
  band            NUMERIC(2,1),
  feedback        TEXT,
  graded_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  graded_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attempts_user      ON attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_test      ON attempts (test_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status    ON attempts (status);
CREATE INDEX IF NOT EXISTS idx_attempts_submitted ON attempts (submitted_at);
