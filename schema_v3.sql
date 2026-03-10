CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT UNIQUE NOT NULL,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    position TEXT NOT NULL,
    result TEXT DEFAULT '',
    pnl REAL DEFAULT 0,
    entry_price REAL DEFAULT 0,
    exit_price REAL DEFAULT 0,
    sl_price REAL DEFAULT 0,
    size REAL DEFAULT 0,
    leverage INTEGER DEFAULT 1,
    fee REAL DEFAULT 0,
    trade_type TEXT DEFAULT '',
    setup_type TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    entry_reason TEXT DEFAULT '',
    exit_reason TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    discipline_score TEXT DEFAULT '',
    w_score TEXT DEFAULT '',
    notion_page_id TEXT DEFAULT '',
    chart_url TEXT DEFAULT '',
    trade_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trade_stats_daily (
    date TEXT PRIMARY KEY,
    total_trades INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    breakeven INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    total_fees REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_trade_id ON trades(trade_id);
