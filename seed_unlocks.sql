-- Known 2026 major token unlocks (recurring patterns from cryptorank.io/upcoming-unlocks)
-- Run once: wrangler d1 execute 1percent-admin --remote --file=seed_unlocks.sql

-- ARB (Arbitrum) — 매월 16일 언락, ~2.4% 유통량
INSERT OR IGNORE INTO events (title, description, exchange, type, image_url, link, start_date, end_date, prize, is_featured, sort_order, status) VALUES
  ('ARB 토큰 언락 — 92.6M ARB', '아비트럼 월간 언락 (약 $92M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/arbitrum/vesting', '2026-05-16', '2026-05-16', '', 0, 50, 'active'),
  ('ARB 토큰 언락 — 92.6M ARB', '아비트럼 월간 언락 (약 $92M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/arbitrum/vesting', '2026-06-16', '2026-06-16', '', 0, 50, 'active'),
  -- OP (Optimism) — 매월 30일 언락
  ('OP 토큰 언락 — 31.3M OP', '옵티미즘 월간 언락 (약 $40M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/optimism/vesting', '2026-04-30', '2026-04-30', '', 0, 50, 'active'),
  ('OP 토큰 언락 — 31.3M OP', '옵티미즘 월간 언락 (약 $40M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/optimism/vesting', '2026-05-30', '2026-05-30', '', 0, 50, 'active'),
  -- SUI — 매월 1일 언락
  ('SUI 토큰 언락 — 64M SUI', '수이 월간 언락 (약 $180M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/sui/vesting', '2026-05-01', '2026-05-01', '', 0, 50, 'active'),
  ('SUI 토큰 언락 — 64M SUI', '수이 월간 언락 (약 $180M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/sui/vesting', '2026-06-01', '2026-06-01', '', 0, 50, 'active'),
  -- APT (Aptos) — 매월 12일 언락
  ('APT 토큰 언락 — 11.31M APT', '앱토스 월간 언락 (약 $60M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/aptos/vesting', '2026-05-12', '2026-05-12', '', 0, 50, 'active'),
  -- IMX (Immutable) — 매월 10일 전후
  ('IMX 토큰 언락 — 24.5M IMX', '이뮤터블 월간 언락 (약 $12M 규모)', '', 'unlock', '', 'https://cryptorank.io/price/immutable-x/vesting', '2026-05-10', '2026-05-10', '', 0, 50, 'active'),
  -- JTO (Jito)
  ('JTO 토큰 언락 — 14.8M JTO', '지토 월간 언락', '', 'unlock', '', 'https://cryptorank.io/price/jito/vesting', '2026-05-07', '2026-05-07', '', 0, 50, 'active'),
  -- WLD (Worldcoin)
  ('WLD 토큰 언락 — 38M WLD', '월드코인 월간 언락', '', 'unlock', '', 'https://cryptorank.io/price/worldcoin/vesting', '2026-05-24', '2026-05-24', '', 0, 50, 'active'),
  -- PYTH (Pyth Network)
  ('PYTH 토큰 언락 — 2.13B PYTH', '파이스 대규모 언락 (50% 유통량)', '', 'unlock', '', 'https://cryptorank.io/price/pyth-network/vesting', '2026-05-20', '2026-05-20', '', 0, 50, 'active');
