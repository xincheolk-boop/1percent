-- 1% Trading PRO Admin DB Schema

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname   TEXT NOT NULL DEFAULT '',
  uid        TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  telegram   TEXT DEFAULT '',
  join_date  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settlements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  exchange       TEXT NOT NULL DEFAULT '',
  month          TEXT NOT NULL,
  volume         REAL NOT NULL DEFAULT 0,
  fee            REAL NOT NULL DEFAULT 0,
  payback_amount REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',
  paid_date      TEXT DEFAULT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange    TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  image_url   TEXT DEFAULT '',
  link        TEXT DEFAULT '',
  start_date  TEXT DEFAULT '',
  end_date    TEXT DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  image_url  TEXT DEFAULT '',
  link       TEXT DEFAULT '',
  position   TEXT NOT NULL DEFAULT 'main',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT DEFAULT '',
  is_pinned  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_settlements_user_id ON settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_month   ON settlements(month);
CREATE INDEX IF NOT EXISTS idx_users_exchange      ON users(exchange);
