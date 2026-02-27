-- 1% Trading PRO Schema v2 — 회원 인증 시스템

CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  nickname          TEXT NOT NULL,
  referral_code_used TEXT DEFAULT '',
  my_referral_code  TEXT UNIQUE NOT NULL,
  agreed_terms      INTEGER DEFAULT 1,
  agreed_privacy    INTEGER DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_accounts_email   ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_refcode ON accounts(my_referral_code);

-- users 테이블에 account_id 연결 컬럼 추가
ALTER TABLE users ADD COLUMN account_id INTEGER DEFAULT NULL;
