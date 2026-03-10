import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

const assetManifest = JSON.parse(manifestJSON);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Admin Exchange Configs API
    if (url.pathname.startsWith('/api/admin/exchange-configs')) {
      return handleAdminExchangeConfigs(request, env, url);
    }

    // Admin Commission Collection API
    if (url.pathname.startsWith('/api/admin/commissions') ||
        url.pathname.startsWith('/api/admin/commission-summaries') ||
        url.pathname.startsWith('/api/admin/collection-logs')) {
      return handleAdminCommissions(request, env, url);
    }

    // CSV commission upload
    if (url.pathname === '/api/admin/upload-commissions' && request.method === 'POST') {
      return handleCSVUpload(request, env);
    }

    // Manual commission collection trigger
    if (url.pathname === '/api/admin/collect-commissions' && request.method === 'POST') {
      return handleCollectTrigger(request, env);
    }

    // Admin auto-send withdrawal
    if (url.pathname.match(/\/api\/admin\/withdrawals\/\d+\/auto-send/) && request.method === 'POST') {
      return handleAutoWithdrawal(request, env, url);
    }

    // Admin Withdrawals API (more specific, must come before /api/admin)
    if (url.pathname.startsWith('/api/admin/withdrawals')) {
      return handleAdminWithdrawals(request, env, url);
    }

    // Manual crawl trigger (must come before /api/admin)
    if (url.pathname === '/api/admin/crawl-events' && request.method === 'POST') {
      return handleCrawlTrigger(request, env);
    }

    // Seed events (must come before /api/admin)
    if (url.pathname === '/api/admin/seed-events' && request.method === 'POST') {
      return handleSeedEvents(request, env);
    }

    // Admin Journal API (must come before /api/admin catch-all)
    if (url.pathname.startsWith('/api/admin/journal/')) {
      return handleAdminJournal(request, env, url.pathname);
    }

    // Admin API (catch-all for other admin routes)
    if (url.pathname.startsWith('/api/admin')) {
      return handleAdmin(request, env, url);
    }

    // Journal (Trading Diary) API
    if (url.pathname.startsWith('/api/journal/')) {
      return handleJournal(request, env, url.pathname);
    }

    // Auth API
    if (url.pathname.startsWith('/api/auth')) {
      return handleAuth(request, env, url);
    }

    // Mypage API (includes withdrawal)
    if (url.pathname.startsWith('/api/mypage')) {
      return handleMypage(request, env, url);
    }

    // Public Events API
    if (url.pathname === '/api/events') {
      return handlePublicEvents(request, env);
    }

    // Public Register API
    if (url.pathname === '/api/register') {
      return handleRegister(request, env);
    }

    // Calendar API
    if (url.pathname === '/api/calendar') {
      return handleCalendar(request, env);
    }

    // Binance Futures API Proxy
    if (url.pathname.startsWith('/api/binance/')) {
      return handleBinanceProxy(request, url);
    }

    // Bitget Market Data Proxy
    if (url.pathname.startsWith('/api/market/')) {
      return handleMarketProxy(request, url);
    }

    // Static files
    try {
      // Clean URL support: /admin → admin.html, /register → register.html, etc.
      let assetRequest = request;
      const pathname = url.pathname;
      if (pathname !== '/' && !pathname.includes('.') && !pathname.endsWith('/')) {
        const newUrl = new URL(request.url);
        newUrl.pathname = pathname + '.html';
        assetRequest = new Request(newUrl.toString(), request);
      }
      return await getAssetFromKV(
        { request: assetRequest, waitUntil: ctx.waitUntil.bind(ctx) },
        { ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: assetManifest }
      );
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  },

  // Cron 스케줄러: 매일 이벤트 크롤링 + 6시간마다 커미션 수집
  async scheduled(event, env, ctx) {
    ctx.waitUntil(crawlExchangeEvents(env));
    ctx.waitUntil(collectAllCommissions(env));
  },
};

// ── Admin Auth ────────────────────────────────────────────────────────────────

function checkAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  const token = h.slice(7);
  const expectedUser = env.ADMIN_USERNAME || '1percentadmin';
  const expectedPass = env.ADMIN_PASSWORD || 'admin1234';
  return token === expectedUser + ':' + expectedPass;
}

const AH = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ajson = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: AH });

// ── Admin Routes ──────────────────────────────────────────────────────────────

async function handleAdmin(request, env, url) {
  const path = url.pathname.replace('/api/admin', '') || '/';

  // Auth (no token required)
  if (path === '/auth' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const validUser = (body.username === (env.ADMIN_USERNAME || '1percentadmin'));
    const validPass = (body.password === (env.ADMIN_PASSWORD || 'admin1234'));
    if (validUser && validPass) return ajson({ ok: true });
    return ajson({ ok: false, error: '아이디 또는 비밀번호가 틀렸습니다' }, 401);
  }

  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);

  const db = env.DB;
  if (!db) return ajson({ error: 'DB 미연결' }, 500);

  try {
    // ── Stats ──
    if (path === '/stats' && request.method === 'GET') {
      const curMonth = new Date().toISOString().slice(0, 7);
      const [u, s, p] = await Promise.all([
        db.prepare('SELECT COUNT(*) as c FROM accounts').first(),
        db.prepare('SELECT COALESCE(SUM(payback_amount),0) as c FROM settlements WHERE month=?').bind(curMonth).first(),
        db.prepare("SELECT COUNT(*) as c FROM settlements WHERE status='pending'").first(),
      ]);
      const byEx = await db.prepare('SELECT exchange, COUNT(*) as cnt FROM users GROUP BY exchange').all();
      return ajson({ totalUsers: u.c, monthlySettlement: s.c, unpaidCount: p.c, byExchange: byEx.results });
    }

    // ── Accounts (회원 목록) ──
    if (path === '/accounts' && request.method === 'GET') {
      const q  = url.searchParams.get('search') || '';
      const st = url.searchParams.get('status') || '';
      const ex = url.searchParams.get('exchange') || '';
      let sql = `SELECT a.id, a.email, a.nickname, a.my_referral_code, a.referral_code_used,
                        a.status, a.created_at, COUNT(u.id) as uid_count,
                        GROUP_CONCAT(DISTINCT u.exchange) as exchanges
                 FROM accounts a LEFT JOIN users u ON u.account_id = a.id`;
      const p = [], w = [];
      if (st) { w.push('a.status=?'); p.push(st); }
      if (q)  { w.push('(a.email LIKE ? OR a.nickname LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
      if (ex) { w.push('u.exchange=?'); p.push(ex); }
      if (w.length) sql += ' WHERE ' + w.join(' AND ');
      sql += ' GROUP BY a.id ORDER BY a.created_at DESC';
      const r = await db.prepare(sql).bind(...p).all();
      return ajson({ accounts: r.results || [] });
    }

    // 회원 상태 변경
    const accIdM = path.match(/^\/accounts\/(\d+)$/);
    if (accIdM && request.method === 'PATCH') {
      const id = +accIdM[1];
      const { status } = await request.json().catch(() => ({}));
      if (!['active','inactive'].includes(status)) return ajson({ error: '올바른 상태값이 아닙니다' }, 400);
      await db.prepare('UPDATE accounts SET status=? WHERE id=?').bind(status, id).run();
      return ajson({ ok: true });
    }

    // ── Users ──
    if (path === '/users') {
      if (request.method === 'GET') {
        const ex = url.searchParams.get('exchange') || '';
        const st = url.searchParams.get('status') || '';
        const q  = url.searchParams.get('search') || '';
        let sql = `SELECT u.*, COALESCE(SUM(s.volume),0) as total_volume, COALESCE(SUM(s.payback_amount),0) as total_payback
                   FROM users u LEFT JOIN settlements s ON u.id=s.user_id`;
        const p = [], w = [];
        if (ex) { w.push('u.exchange=?'); p.push(ex); }
        if (st) { w.push('u.status=?');   p.push(st); }
        if (q)  { w.push('(u.uid LIKE ? OR u.nickname LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
        if (w.length) sql += ' WHERE ' + w.join(' AND ');
        sql += ' GROUP BY u.id ORDER BY u.created_at DESC';
        const r = await db.prepare(sql).bind(...p).all();
        return ajson({ users: r.results || [] });
      }
      if (request.method === 'POST') {
        const b = await request.json();
        const r = await db.prepare(
          'INSERT INTO users (nickname,uid,exchange,telegram,join_date,status) VALUES (?,?,?,?,?,?)'
        ).bind(b.nickname||'', b.uid||'', b.exchange||'', b.telegram||'', b.join_date||new Date().toISOString().slice(0,10), b.status||'active').run();
        return ajson({ ok: true, id: r.meta.last_row_id });
      }
    }

    const uIdM = path.match(/^\/users\/(\d+)$/);
    if (uIdM) {
      const id = +uIdM[1];
      if (request.method === 'GET') {
        const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
        const sett = await db.prepare('SELECT * FROM settlements WHERE user_id=? ORDER BY month DESC').bind(id).all();
        return ajson({ user, settlements: sett.results || [] });
      }
      if (request.method === 'PUT') {
        const b = await request.json();
        await db.prepare('UPDATE users SET nickname=?,uid=?,exchange=?,telegram=?,join_date=?,status=? WHERE id=?')
          .bind(b.nickname||'', b.uid||'', b.exchange||'', b.telegram||'', b.join_date||'', b.status||'active', id).run();
        return ajson({ ok: true });
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM settlements WHERE user_id=?').bind(id).run();
        await db.prepare('DELETE FROM users WHERE id=?').bind(id).run();
        return ajson({ ok: true });
      }
    }

    // ── Settlements ──
    if (path === '/settlements') {
      if (request.method === 'GET') {
        const mo = url.searchParams.get('month') || '';
        const ex = url.searchParams.get('exchange') || '';
        const st = url.searchParams.get('status') || '';
        let sql = `SELECT s.*, u.nickname, u.uid as user_uid, u.exchange as user_exchange
                   FROM settlements s LEFT JOIN users u ON s.user_id=u.id`;
        const p = [], w = [];
        if (mo) { w.push('s.month=?'); p.push(mo); }
        if (ex) { w.push('u.exchange=?'); p.push(ex); }
        if (st) { w.push('s.status=?'); p.push(st); }
        if (w.length) sql += ' WHERE ' + w.join(' AND ');
        sql += ' ORDER BY s.month DESC, u.nickname';
        const r = await db.prepare(sql).bind(...p).all();
        return ajson({ settlements: r.results || [] });
      }
      if (request.method === 'POST') {
        const b = await request.json();
        const r = await db.prepare(
          'INSERT INTO settlements (user_id,exchange,month,volume,fee,payback_amount,status) VALUES (?,?,?,?,?,?,?)'
        ).bind(b.user_id||0, b.exchange||'', b.month||'', b.volume||0, b.fee||0, b.payback_amount||0, b.status||'pending').run();
        return ajson({ ok: true, id: r.meta.last_row_id });
      }
    }

    const sIdM = path.match(/^\/settlements\/(\d+)$/);
    if (sIdM) {
      const id = +sIdM[1];
      if (request.method === 'PUT') {
        const b = await request.json();
        await db.prepare('UPDATE settlements SET volume=?,fee=?,payback_amount=?,status=?,paid_date=? WHERE id=?')
          .bind(b.volume||0, b.fee||0, b.payback_amount||0, b.status||'pending', b.paid_date||null, id).run();
        return ajson({ ok: true });
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM settlements WHERE id=?').bind(id).run();
        return ajson({ ok: true });
      }
    }

    // ── Events ──
    if (path === '/events') {
      if (request.method === 'GET') {
        const r = await db.prepare('SELECT * FROM events ORDER BY is_featured DESC, sort_order ASC, created_at DESC').all();
        return ajson({ events: r.results || [] });
      }
      if (request.method === 'POST') {
        const b = await request.json();
        if (!b.title || !b.exchange) return ajson({ error: '제목과 거래소는 필수입니다' }, 400);
        const r = await db.prepare(
          'INSERT INTO events (title,description,exchange,type,image_url,link,start_date,end_date,prize,is_featured,sort_order,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(b.title, b.description||'', b.exchange, b.type||'event', b.image_url||'', b.link||'', b.start_date||null, b.end_date||null, b.prize||'', b.is_featured?1:0, b.sort_order||0, b.status||'active').run();
        return ajson({ ok: true, id: r.meta.last_row_id });
      }
    }
    const eIdM = path.match(/^\/events\/(\d+)$/);
    if (eIdM) {
      const id = +eIdM[1];
      if (request.method === 'PUT' || request.method === 'PATCH') {
        const b = await request.json();
        const fields = [];
        const values = [];
        for (const key of ['title','description','exchange','type','image_url','link','start_date','end_date','prize','status','sort_order']) {
          if (b[key] !== undefined) { fields.push(key+'=?'); values.push(b[key]); }
        }
        if (b.is_featured !== undefined) { fields.push('is_featured=?'); values.push(b.is_featured?1:0); }
        if (fields.length === 0) return ajson({ error: '수정할 항목 없음' }, 400);
        fields.push("updated_at=datetime('now')");
        values.push(id);
        await db.prepare('UPDATE events SET '+fields.join(',')+' WHERE id=?').bind(...values).run();
        return ajson({ ok: true });
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM events WHERE id=?').bind(id).run();
        return ajson({ ok: true });
      }
    }

    // ── Banners ──
    if (path === '/banners') {
      if (request.method === 'GET') {
        const r = await db.prepare('SELECT * FROM banners ORDER BY is_active DESC').all();
        return ajson({ banners: r.results || [] });
      }
      if (request.method === 'POST') {
        const b = await request.json();
        const r = await db.prepare(
          'INSERT INTO banners (title,image_url,link,position,is_active) VALUES (?,?,?,?,?)'
        ).bind(b.title||'', b.image_url||'', b.link||'', b.position||'main', b.is_active?1:0).run();
        return ajson({ ok: true, id: r.meta.last_row_id });
      }
    }
    const bIdM = path.match(/^\/banners\/(\d+)$/);
    if (bIdM) {
      const id = +bIdM[1];
      if (request.method === 'PUT') {
        const b = await request.json();
        await db.prepare('UPDATE banners SET title=?,image_url=?,link=?,position=?,is_active=? WHERE id=?')
          .bind(b.title||'', b.image_url||'', b.link||'', b.position||'main', b.is_active?1:0, id).run();
        return ajson({ ok: true });
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM banners WHERE id=?').bind(id).run();
        return ajson({ ok: true });
      }
    }

    // ── Notices ──
    if (path === '/notices') {
      if (request.method === 'GET') {
        const r = await db.prepare('SELECT * FROM notices ORDER BY is_pinned DESC, created_at DESC').all();
        return ajson({ notices: r.results || [] });
      }
      if (request.method === 'POST') {
        const b = await request.json();
        const r = await db.prepare('INSERT INTO notices (title,content,is_pinned) VALUES (?,?,?)')
          .bind(b.title||'', b.content||'', b.is_pinned?1:0).run();
        return ajson({ ok: true, id: r.meta.last_row_id });
      }
    }
    const nIdM = path.match(/^\/notices\/(\d+)$/);
    if (nIdM) {
      const id = +nIdM[1];
      if (request.method === 'PUT') {
        const b = await request.json();
        await db.prepare('UPDATE notices SET title=?,content=?,is_pinned=? WHERE id=?')
          .bind(b.title||'', b.content||'', b.is_pinned?1:0, id).run();
        return ajson({ ok: true });
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM notices WHERE id=?').bind(id).run();
        return ajson({ ok: true });
      }
    }

    return ajson({ error: '알 수 없는 경로' }, 404);
  } catch (err) {
    console.error('Admin error:', err);
    return ajson({ error: err.message }, 500);
  }
}

// ── Public Register ───────────────────────────────────────────────────────────

const REG_CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const rjson = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: REG_CORS });

async function handleRegister(request, env) {
  if (request.method !== 'POST') return rjson({ error: 'POST only' }, 405);

  const db = env.DB;
  if (!db) return rjson({ error: 'DB 미연결' }, 500);

  let body;
  try { body = await request.json(); }
  catch (e) { return rjson({ error: '잘못된 요청 형식' }, 400); }

  const { exchange, uid, telegram, nickname } = body;

  if (!exchange || !uid) return rjson({ error: '거래소와 UID는 필수입니다' }, 400);

  const VALID_EX = ['Bitget', 'OKX', 'Gate.io'];
  if (!VALID_EX.includes(exchange)) return rjson({ error: '지원하지 않는 거래소입니다' }, 400);

  const cleanUid = String(uid).trim();
  if (cleanUid.length < 3) return rjson({ error: 'UID가 너무 짧습니다' }, 400);

  try {
    // UID 중복 확인
    const existing = await db.prepare('SELECT id FROM users WHERE uid=? AND exchange=?').bind(cleanUid, exchange).first();
    if (existing) return rjson({ error: '이미 등록된 UID입니다', code: 'DUPLICATE' }, 409);

    // 로그인 상태면 account_id 연결
    let accountId = null;
    const authAccount = await getAccountFromRequest(request, db).catch(() => null);
    if (authAccount) accountId = authAccount.id;

    const today = new Date().toISOString().slice(0, 10);
    const result = await db.prepare(
      'INSERT INTO users (nickname, uid, exchange, telegram, join_date, status, account_id) VALUES (?,?,?,?,?,?,?)'
    ).bind(
      String(nickname || '').trim().slice(0, 30),
      cleanUid,
      exchange,
      String(telegram || '').trim().replace(/^@/, ''),
      today,
      'active',
      accountId
    ).run();

    return rjson({ ok: true, id: result.meta.last_row_id, message: 'UID 등록 완료' });
  } catch (err) {
    console.error('Register error:', err);
    return rjson({ error: '등록 중 오류가 발생했습니다: ' + err.message }, 500);
  }
}

// ── Auth Helpers ──────────────────────────────────────────────────────────────

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const toHex = arr => [...arr].map(b => b.toString(16).padStart(2,'0')).join('');
  return toHex(salt) + ':' + toHex(new Uint8Array(bits));
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b,16)));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const newHash = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
  return newHash === hashHex;
}

function generateToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map(b => chars[b % chars.length]).join('');
}

async function getAccountFromRequest(request, db) {
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const token = h.slice(7);
  const session = await db.prepare(
    'SELECT * FROM sessions WHERE token=? AND expires_at > datetime("now")'
  ).bind(token).first();
  if (!session) return null;
  return db.prepare('SELECT * FROM accounts WHERE id=?').bind(session.account_id).first();
}

const AH2 = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const aj2 = (d, s=200) => new Response(JSON.stringify(d), { status: s, headers: AH2 });

// ── Auth Routes ────────────────────────────────────────────────────────────────

async function handleAuth(request, env, url) {
  const db = env.DB;
  if (!db) return aj2({ error: 'DB 미연결' }, 500);
  const path = url.pathname.replace('/api/auth', '');

  // 회원가입
  if (path === '/signup' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch(e) { return aj2({ error: '잘못된 형식' }, 400); }

    const { email, password, nickname, referral_code, agreed_terms, agreed_privacy } = body;
    if (!email || !password || !nickname) return aj2({ error: '필수 항목을 입력해주세요' }, 400);
    if (!agreed_terms || !agreed_privacy) return aj2({ error: '약관에 동의해주세요' }, 400);
    if (password.length < 8) return aj2({ error: '비밀번호는 8자 이상이어야 합니다' }, 400);
    if (nickname.trim().length < 2) return aj2({ error: '닉네임은 2자 이상이어야 합니다' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return aj2({ error: '이메일 형식이 올바르지 않습니다' }, 400);

    try {
      const existing = await db.prepare('SELECT id FROM accounts WHERE email=?').bind(email.toLowerCase()).first();
      if (existing) return aj2({ error: '이미 사용 중인 이메일입니다', code: 'DUP_EMAIL' }, 409);

      if (referral_code) {
        const ref = await db.prepare('SELECT id FROM accounts WHERE my_referral_code=?').bind(referral_code.toUpperCase()).first();
        if (!ref) return aj2({ error: '존재하지 않는 추천코드입니다', code: 'INVALID_REF' }, 400);
      }

      const hash = await hashPassword(password);
      let myCode;
      for (let i = 0; i < 10; i++) {
        myCode = generateReferralCode();
        const check = await db.prepare('SELECT id FROM accounts WHERE my_referral_code=?').bind(myCode).first();
        if (!check) break;
      }

      const result = await db.prepare(
        'INSERT INTO accounts (email, password_hash, nickname, referral_code_used, my_referral_code, agreed_terms, agreed_privacy) VALUES (?,?,?,?,?,?,?)'
      ).bind(email.toLowerCase(), hash, nickname.trim(), (referral_code||'').toUpperCase(), myCode, 1, 1).run();

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      await db.prepare('INSERT INTO sessions (account_id, token, expires_at) VALUES (?,?,?)')
        .bind(result.meta.last_row_id, token, expiresAt).run();

      return aj2({ ok: true, token, nickname: nickname.trim(), my_referral_code: myCode });
    } catch(err) {
      return aj2({ error: '가입 중 오류: ' + err.message }, 500);
    }
  }

  // 로그인
  if (path === '/login' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch(e) { return aj2({ error: '잘못된 형식' }, 400); }

    const { email, password } = body;
    if (!email || !password) return aj2({ error: '이메일과 비밀번호를 입력해주세요' }, 400);

    try {
      const account = await db.prepare('SELECT * FROM accounts WHERE email=?').bind(email.toLowerCase()).first();
      if (!account) return aj2({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, 401);
      if (account.status !== 'active') return aj2({ error: '비활성화된 계정입니다' }, 403);

      const valid = await verifyPassword(password, account.password_hash);
      if (!valid) return aj2({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, 401);

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      await db.prepare('INSERT INTO sessions (account_id, token, expires_at) VALUES (?,?,?)')
        .bind(account.id, token, expiresAt).run();

      return aj2({ ok: true, token, nickname: account.nickname, my_referral_code: account.my_referral_code });
    } catch(err) {
      return aj2({ error: '로그인 중 오류: ' + err.message }, 500);
    }
  }

  // 로그아웃
  if (path === '/logout' && request.method === 'POST') {
    const h = request.headers.get('Authorization') || '';
    if (h.startsWith('Bearer ')) {
      await db.prepare('DELETE FROM sessions WHERE token=?').bind(h.slice(7)).run().catch(()=>{});
    }
    return aj2({ ok: true });
  }

  // 내 정보
  if (path === '/me' && request.method === 'GET') {
    const account = await getAccountFromRequest(request, db);
    if (!account) return aj2({ error: '로그인이 필요합니다' }, 401);
    return aj2({ ok: true, id: account.id, email: account.email, nickname: account.nickname, my_referral_code: account.my_referral_code, created_at: account.created_at });
  }

  return aj2({ error: '알 수 없는 경로' }, 404);
}

// ── Mypage Routes ──────────────────────────────────────────────────────────────

async function handleMypage(request, env, url) {
  const db = env.DB;
  if (!db) return aj2({ error: 'DB 미연결' }, 500);

  const account = await getAccountFromRequest(request, db);
  if (!account) return aj2({ error: '로그인이 필요합니다' }, 401);

  const path = url.pathname.replace('/api/mypage', '') || '/';

  if (path === '/' || path === '/profile') {
    return aj2({ ok: true, id: account.id, email: account.email, nickname: account.nickname, my_referral_code: account.my_referral_code, created_at: account.created_at });
  }

  if (path === '/uids') {
    const r = await db.prepare('SELECT * FROM users WHERE account_id=? ORDER BY created_at DESC').bind(account.id).all();
    return aj2({ ok: true, uids: r.results || [] });
  }

  if (path === '/settlements') {
    const r = await db.prepare(
      'SELECT s.* FROM settlements s INNER JOIN users u ON s.user_id=u.id WHERE u.account_id=? ORDER BY s.month DESC'
    ).bind(account.id).all();
    return aj2({ ok: true, settlements: r.results || [] });
  }

  // 출금 가능 잔액 조회
  if (path === '/balance' && request.method === 'GET') {
    const total = await db.prepare(
      `SELECT COALESCE(SUM(s.payback_amount),0) as total_reward
       FROM settlements s INNER JOIN users u ON s.user_id=u.id
       WHERE u.account_id=? AND s.status='paid'`
    ).bind(account.id).first();
    const withdrawn = await db.prepare(
      `SELECT COALESCE(SUM(amount),0) as total_withdrawn
       FROM withdrawals WHERE account_id=? AND status IN ('completed','processing','pending')`
    ).bind(account.id).first();
    const balance = (total?.total_reward || 0) - (withdrawn?.total_withdrawn || 0);
    return aj2({ ok: true, total_reward: total?.total_reward || 0, total_withdrawn: withdrawn?.total_withdrawn || 0, balance });
  }

  // 출금 내역 조회
  if (path === '/withdrawals' && request.method === 'GET') {
    const r = await db.prepare(
      'SELECT * FROM withdrawals WHERE account_id=? ORDER BY requested_at DESC'
    ).bind(account.id).all();
    return aj2({ ok: true, withdrawals: r.results || [] });
  }

  // 출금 신청
  if (path === '/withdraw' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch(e) { return aj2({ error: '잘못된 형식' }, 400); }

    const { amount, wallet_address, network } = body;
    if (!amount || !wallet_address) return aj2({ error: '출금 금액과 지갑 주소를 입력해주세요' }, 400);
    if (amount < 50) return aj2({ error: '최소 출금 금액은 $50 USDT입니다' }, 400);

    const addr = String(wallet_address).trim();
    if (addr.length < 20) return aj2({ error: '올바른 지갑 주소를 입력해주세요' }, 400);

    // 잔액 확인
    const total = await db.prepare(
      `SELECT COALESCE(SUM(s.payback_amount),0) as total_reward
       FROM settlements s INNER JOIN users u ON s.user_id=u.id
       WHERE u.account_id=? AND s.status='paid'`
    ).bind(account.id).first();
    const withdrawn = await db.prepare(
      `SELECT COALESCE(SUM(amount),0) as total_withdrawn
       FROM withdrawals WHERE account_id=? AND status IN ('completed','processing','pending')`
    ).bind(account.id).first();
    const balance = (total?.total_reward || 0) - (withdrawn?.total_withdrawn || 0);

    if (amount > balance) return aj2({ error: '출금 가능 잔액이 부족합니다 (잔액: $' + balance.toFixed(2) + ')' }, 400);

    // 진행 중인 출금 요청 확인
    const pending = await db.prepare(
      "SELECT id FROM withdrawals WHERE account_id=? AND status='pending'"
    ).bind(account.id).first();
    if (pending) return aj2({ error: '이미 처리 대기 중인 출금 요청이 있습니다' }, 400);

    const result = await db.prepare(
      'INSERT INTO withdrawals (account_id, amount, wallet_address, network) VALUES (?,?,?,?)'
    ).bind(account.id, amount, addr, network || 'TRC-20').run();

    return aj2({ ok: true, id: result.meta.last_row_id, message: '출금 신청이 완료되었습니다' });
  }

  // 내 커미션 조회
  if (path === '/commissions') {
    const userUids = await db.prepare('SELECT uid, exchange FROM users WHERE account_id=?').bind(account.id).all();
    const uids = (userUids.results || []);
    if (!uids.length) return aj2({ commissions: [] });

    const conditions = uids.map(() => '(invitee_uid=? AND exchange=?)').join(' OR ');
    const vals = uids.flatMap(u => [u.uid, u.exchange]);

    const month = url.searchParams.get('month') || '';
    let where = `(${conditions})`;
    if (month) { where += ' AND substr(commission_time,1,7)=?'; vals.push(month); }

    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 50;
    vals.push(limit, (page - 1) * limit);
    const r = await db.prepare(`SELECT * FROM commissions WHERE ${where} ORDER BY commission_time DESC LIMIT ? OFFSET ?`).bind(...vals).all();
    return aj2({ commissions: r.results || [] });
  }

  // 내 커미션 월별 요약
  if (path === '/commission-summary') {
    const userIds = await db.prepare('SELECT id FROM users WHERE account_id=?').bind(account.id).all();
    const ids = (userIds.results || []).map(u => u.id);
    if (!ids.length) return aj2({ summaries: [], total_reward: 0 });

    const placeholders = ids.map(() => '?').join(',');
    const r = await db.prepare(`
      SELECT cs.*, u.nickname, u.uid, u.exchange as user_exchange
      FROM commission_summaries cs
      LEFT JOIN users u ON u.id = cs.user_id
      WHERE cs.user_id IN (${placeholders})
      ORDER BY cs.month DESC
    `).bind(...ids).all();

    const summaries = r.results || [];
    const totalReward = summaries.reduce((s, item) => s + (item.user_commission || 0), 0);
    return aj2({ summaries, total_reward: totalReward });
  }

  return aj2({ error: '알 수 없는 경로' }, 404);
}

// ── Admin Withdrawals ─────────────────────────────────────────────────────────

async function handleAdminWithdrawals(request, env, url) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);

  const db = env.DB;
  if (!db) return ajson({ error: 'DB 미연결' }, 500);

  const path = url.pathname.replace('/api/admin/withdrawals', '') || '/';

  try {
    // 출금 목록 조회
    if ((path === '/' || path === '') && request.method === 'GET') {
      const status = url.searchParams.get('status') || '';
      let sql = `SELECT w.*, a.email, a.nickname
                 FROM withdrawals w
                 LEFT JOIN users u ON w.user_id=u.id
                 LEFT JOIN accounts a ON u.account_id=a.id`;
      const params = [];
      if (status) { sql += ' WHERE w.status=?'; params.push(status); }
      sql += ' ORDER BY w.requested_at DESC';
      const r = await db.prepare(sql).bind(...params).all();
      return ajson({ withdrawals: r.results || [] });
    }

    // 출금 상태 변경 (승인/거절/완료)
    const idMatch = path.match(/^\/(\d+)$/);
    if (idMatch && request.method === 'PATCH') {
      const id = +idMatch[1];
      const body = await request.json().catch(() => ({}));
      const { status, tx_hash, reject_reason } = body;

      if (!['processing','completed','rejected'].includes(status)) {
        return ajson({ error: '올바른 상태값: processing, completed, rejected' }, 400);
      }

      const now = new Date().toISOString();
      await db.prepare(
        'UPDATE withdrawals SET status=?, tx_hash=?, reject_reason=?, processed_at=? WHERE id=?'
      ).bind(status, tx_hash || '', reject_reason || '', now, id).run();

      return ajson({ ok: true });
    }

    return ajson({ error: '알 수 없는 경로' }, 404);
  } catch (err) {
    return ajson({ error: err.message }, 500);
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────

const CAL_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=1800',
};

async function handleCalendar(request, env) {
  const apiKey = env.COINMARKETCAL_API_KEY || null;
  if (!apiKey) {
    return new Response(JSON.stringify({ events: [], source: 'no_api_key' }), { headers: CAL_CORS });
  }
  try {
    const today  = new Date().toISOString().split('T')[0];
    const future = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    const res = await fetch(
      `https://developers.coinmarketcal.com/v1/events?max=8&dateRangeStart=${today}&dateRangeEnd=${future}&showOnly=hot_events`,
      { headers: { 'x-api-key': apiKey, 'Accept-Encoding': 'deflate, gzip', 'Accept': 'application/json' },
        cf: { cacheTtl: 1800, cacheEverything: true } }
    );
    if (!res.ok) throw new Error(`CoinMarketCal ${res.status}`);
    const data = await res.json();
    const DAYS = ['일','월','화','수','목','금','토'];
    const events = (data.body || []).map(e => {
      const d = new Date(e.date_event);
      return {
        id: e.id,
        title: (e.title?.en) ? e.title.en : String(e.title || ''),
        date: e.date_event,
        day: d.getDate(),
        dow: DAYS[d.getDay()],
        coins: (e.coins || []).slice(0, 2).map(c => c.symbol),
        category: e.categories?.[0]?.name || '주요이슈',
        hot: !!e.is_hot,
      };
    });
    return new Response(JSON.stringify({ events, source: 'coinmarketcal' }), { headers: CAL_CORS });
  } catch (err) {
    return new Response(JSON.stringify({ events: [], error: err.message }), { headers: CAL_CORS });
  }
}

// ========== Public Events API ==========
async function handlePublicEvents(request, env) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const db = env.DB;
    let rows = await db.prepare(
      "SELECT id, title, description, exchange, type, image_url, link, start_date, end_date, prize, is_featured FROM events WHERE status = 'active' ORDER BY is_featured DESC, sort_order ASC, created_at DESC"
    ).all();
    // 비어있으면 자동 시드
    if (!(rows.results || []).length) {
      await autoSeedEvents(db);
      rows = await db.prepare(
        "SELECT id, title, description, exchange, type, image_url, link, start_date, end_date, prize, is_featured FROM events WHERE status = 'active' ORDER BY is_featured DESC, sort_order ASC, created_at DESC"
      ).all();
    }
    return new Response(JSON.stringify({ ok: true, events: rows.results || [] }), { headers });
  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { headers });
  }
}

async function autoSeedEvents(db) {
  const seeds = [
    { title:'신규 가입 보너스 최대 1.7M USDT', description:'1% Trading을 통해 Bitget에 가입하면 최대 1.7M USDT 보너스를 지급합니다.', exchange:'Bitget', type:'event', image_url:'', link:'https://www.bitget.com/referral/register?from=referral&clacCode=pkju', start_date:null, end_date:null, prize:'최대 1.7M USDT', is_featured:1, sort_order:1 },
    { title:'선물 거래 수수료 85% Reward', description:'1% Trading 전용 코드를 통해 가입 시 선물 거래 수수료의 85%를 돌려받습니다.', exchange:'Bitget', type:'event', image_url:'', link:'https://www.bitget.com/referral/register?from=referral&clacCode=pkju', start_date:null, end_date:null, prize:'85% Reward', is_featured:1, sort_order:2 },
    { title:'Gate.io 신규 가입 수수료 80% Reward', description:'Gate.io에서 1% Trading 코드로 가입하면 선물 거래 수수료의 80%를 Reward 받을 수 있습니다.', exchange:'Gate.io', type:'event', image_url:'', link:'', start_date:null, end_date:null, prize:'80% Reward', is_featured:1, sort_order:3 },
    { title:'트레이딩 대회 $50,000 Prize', description:'Bitunix 주간 트레이딩 대회에 참가하고 상금을 받아보세요.', exchange:'Bitunix', type:'competition', image_url:'', link:'', start_date:null, end_date:null, prize:'$50,000', is_featured:0, sort_order:10 },
    { title:'카피트레이딩 챌린지 $20,000', description:'Bitget 카피트레이딩 챌린지에 참가하세요.', exchange:'Bitget', type:'competition', image_url:'', link:'', start_date:null, end_date:null, prize:'$20,000', is_featured:0, sort_order:11 },
  ];
  for (const s of seeds) {
    try {
      await db.prepare(
        "INSERT INTO events (title,description,exchange,type,image_url,link,start_date,end_date,prize,is_featured,sort_order,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(s.title, s.description, s.exchange, s.type, s.image_url, s.link, s.start_date, s.end_date, s.prize, s.is_featured, s.sort_order, 'active').run();
    } catch(e) { /* 중복 무시 */ }
  }
}

// ========== Seed Events ==========
async function handleSeedEvents(request, env) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);
  const db = env.DB;
  const seeds = [
    { title:'신규 가입 보너스 최대 1.7M USDT', description:'1% Trading을 통해 Bitget에 가입하면 최대 1.7M USDT 보너스를 지급합니다. 선물 거래 시작에 필요한 시드머니를 무료로 받아보세요.', exchange:'Bitget', type:'event', image_url:'', link:'https://www.bitget.com/referral/register?from=referral&clacCode=pkju', start_date:null, end_date:null, prize:'최대 1.7M USDT', is_featured:1, sort_order:1 },
    { title:'선물 거래 수수료 85% Reward', description:'1% Trading 전용 코드를 통해 가입 시 선물 거래 수수료의 85%를 돌려받습니다. 업계 최고 수준의 Reward율입니다.', exchange:'Bitget', type:'event', image_url:'', link:'https://www.bitget.com/referral/register?from=referral&clacCode=pkju', start_date:null, end_date:null, prize:'85% Reward', is_featured:1, sort_order:2 },
    { title:'Gate.io 신규 가입 수수료 80% Reward', description:'Gate.io에서 1% Trading 코드로 가입하면 선물 거래 수수료의 80%를 Reward 받을 수 있습니다.', exchange:'Gate.io', type:'event', image_url:'', link:'https://www.gate.io/referral/register?from=referral', start_date:null, end_date:null, prize:'80% Reward', is_featured:1, sort_order:3 },
    { title:'트레이딩 대회 $50,000 Prize', description:'Bitunix 주간 트레이딩 대회에 참가하고 상금을 받아보세요.', exchange:'Bitunix', type:'competition', image_url:'', link:'', start_date:null, end_date:null, prize:'$50,000', is_featured:0, sort_order:10 },
    { title:'카피트레이딩 챌린지 $20,000', description:'Bitget 카피트레이딩 챌린지에 참가하세요.', exchange:'Bitget', type:'competition', image_url:'', link:'', start_date:null, end_date:null, prize:'$20,000', is_featured:0, sort_order:11 },
  ];
  let inserted = 0;
  for (const s of seeds) {
    const exists = await db.prepare("SELECT id FROM events WHERE title = ? AND exchange = ?").bind(s.title, s.exchange).first();
    if (!exists) {
      await db.prepare(
        "INSERT INTO events (title,description,exchange,type,image_url,link,start_date,end_date,prize,is_featured,sort_order,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(s.title, s.description, s.exchange, s.type, s.image_url, s.link, s.start_date, s.end_date, s.prize, s.is_featured, s.sort_order, 'active').run();
      inserted++;
    }
  }
  return ajson({ ok:true, inserted, total:seeds.length });
}

// ========== Admin Events API ==========
async function handleAdminEvents(request, env, url) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // GET /api/admin/events — 전체 이벤트 목록
  if (request.method === 'GET' && url.pathname === '/api/admin/events') {
    const rows = await env.DB.prepare(
      "SELECT * FROM events ORDER BY sort_order ASC, created_at DESC"
    ).all();
    return new Response(JSON.stringify({ ok: true, events: rows.results || [] }), { headers });
  }

  // POST /api/admin/events — 이벤트 생성
  if (request.method === 'POST' && url.pathname === '/api/admin/events') {
    const body = await request.json();
    const { title, description, exchange, type, image_url, link, start_date, end_date, prize, is_featured, sort_order } = body;
    if (!title || !exchange) {
      return new Response(JSON.stringify({ ok: false, error: '제목과 거래소는 필수입니다.' }), { headers, status: 400 });
    }
    const r = await env.DB.prepare(
      "INSERT INTO events (title, description, exchange, type, image_url, link, start_date, end_date, prize, is_featured, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(title, description || '', exchange, type || 'event', image_url || '', link || '', start_date || null, end_date || null, prize || '', is_featured ? 1 : 0, sort_order || 0).run();
    return new Response(JSON.stringify({ ok: true, id: r.meta?.last_row_id }), { headers });
  }

  // PATCH /api/admin/events/:id — 이벤트 수정
  const patchMatch = url.pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (request.method === 'PATCH' && patchMatch) {
    const id = parseInt(patchMatch[1]);
    const body = await request.json();
    const fields = [];
    const values = [];
    for (const key of ['title', 'description', 'exchange', 'type', 'image_url', 'link', 'start_date', 'end_date', 'prize', 'status', 'sort_order']) {
      if (body[key] !== undefined) {
        fields.push(key + ' = ?');
        values.push(body[key]);
      }
    }
    if (body.is_featured !== undefined) {
      fields.push('is_featured = ?');
      values.push(body.is_featured ? 1 : 0);
    }
    if (fields.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: '수정할 항목이 없습니다.' }), { headers, status: 400 });
    }
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await env.DB.prepare(
      "UPDATE events SET " + fields.join(', ') + " WHERE id = ?"
    ).bind(...values).run();
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // DELETE /api/admin/events/:id — 이벤트 삭제
  const delMatch = url.pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (request.method === 'DELETE' && delMatch) {
    const id = parseInt(delMatch[1]);
    await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { headers, status: 404 });
}

// ========== Exchange Event Crawler ==========
async function crawlExchangeEvents(env) {
  const db = env.DB;
  if (!db) return;

  const results = [];

  // Bybit 공식 announcement API
  try {
    const res = await fetch('https://api.bybit.com/v5/announcements/index?locale=en-US&limit=10', {
      cf: { cacheTtl: 600 }
    });
    const data = await res.json();
    if (data.result?.list) {
      for (const item of data.result.list) {
        results.push({
          title: item.title,
          description: item.description?.substring(0, 200) || '',
          exchange: 'Bybit',
          type: item.type?.name?.includes('competition') ? 'competition' : 'event',
          link: item.url || '',
          start_date: item.startDateTimestamp ? new Date(item.startDateTimestamp).toISOString().slice(0,10) : null,
          end_date: item.endDateTimestamp ? new Date(item.endDateTimestamp).toISOString().slice(0,10) : null,
          source: 'bybit_api'
        });
      }
    }
  } catch(e) { console.warn('Bybit crawl fail:', e.message); }

  // Bitget 공식 announcement API
  try {
    const res = await fetch('https://api.bitget.com/api/v2/public/annoucements?language=en_US&limit=10', {
      cf: { cacheTtl: 600 }
    });
    const data = await res.json();
    if (data.data) {
      for (const item of data.data) {
        results.push({
          title: item.annTitle || item.title || '',
          description: (item.annDesc || '').substring(0, 200),
          exchange: 'Bitget',
          type: (item.annTitle || '').toLowerCase().includes('competition') ? 'competition' : 'event',
          link: item.annUrl || '',
          start_date: null,
          end_date: null,
          source: 'bitget_api'
        });
      }
    }
  } catch(e) { console.warn('Bitget crawl fail:', e.message); }

  // Gate.io announcement API
  try {
    const res = await fetch('https://www.gate.io/api/v4/announcements?page=1&limit=10&type=activities', {
      cf: { cacheTtl: 600 }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          results.push({
            title: item.title || '',
            description: (item.content || '').substring(0, 200),
            exchange: 'Gate.io',
            type: (item.title || '').toLowerCase().includes('competition') ? 'competition' : 'event',
            link: item.url || 'https://www.gate.com/competition/center/trading',
            start_date: null,
            end_date: null,
            source: 'gate_api'
          });
        }
      }
    }
  } catch(e) { console.warn('Gate.io crawl fail:', e.message); }

  // OKX announcement (JSON endpoint)
  try {
    const res = await fetch('https://www.okx.com/api/v5/support/announcements?page=1&limit=10', {
      cf: { cacheTtl: 600 }
    });
    if (res.ok) {
      const data = await res.json();
      const items = data.data || [];
      for (const group of items) {
        for (const item of (group.details || [])) {
          results.push({
            title: item.title || '',
            description: '',
            exchange: 'OKX',
            type: (item.annType || '').includes('activit') || (item.title || '').toLowerCase().includes('competition') ? 'competition' : 'event',
            link: item.url || 'https://www.okx.com/events',
            start_date: null,
            end_date: null,
            source: 'okx_api'
          });
        }
      }
    }
  } catch(e) { console.warn('OKX crawl fail:', e.message); }

  // DB에 upsert (중복 방지: 같은 title+exchange 조합이면 스킵)
  let inserted = 0;
  for (const ev of results) {
    if (!ev.title) continue;
    try {
      const existing = await db.prepare(
        "SELECT id FROM events WHERE title = ? AND exchange = ?"
      ).bind(ev.title, ev.exchange).first();
      if (!existing) {
        await db.prepare(
          "INSERT INTO events (title, description, exchange, type, image_url, link, start_date, end_date, prize, is_featured, sort_order, status) VALUES (?, ?, ?, ?, '', ?, ?, ?, '', 0, 99, 'active')"
        ).bind(ev.title, ev.description, ev.exchange, ev.type, ev.link, ev.start_date, ev.end_date).run();
        inserted++;
      }
    } catch(e) { /* skip duplicate */ }
  }

  console.log(`Event crawler: ${results.length} found, ${inserted} new inserted`);
}

// 수동 크롤링 트리거 (admin에서 호출)
async function handleCrawlTrigger(request, env) {
  await crawlExchangeEvents(env);
  return new Response(JSON.stringify({ ok: true, message: '크롤링 완료' }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// ===== Binance Futures API Proxy =====
async function handleBinanceProxy(request, url) {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=10',
  };
  
  try {
    const path = url.pathname.replace('/api/binance/', '');
    const search = url.search || '';
    
    let binanceUrl;
    if (path.startsWith('futures/')) {
      binanceUrl = 'https://fapi.binance.com/' + path + search;
    } else if (path.startsWith('fapi/')) {
      binanceUrl = 'https://fapi.binance.com/' + path + search;
    } else {
      binanceUrl = 'https://fapi.binance.com/fapi/v1/' + path + search;
    }
    
    const res = await fetch(binanceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
  }
}

// ============================================================================
// ══ Bitget Market Data Proxy ══
// ============================================================================
async function handleMarketProxy(request, url) {
  const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=10',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const path = url.pathname.replace('/api/market/', '');
  const BASE = 'https://api.bitget.com/api/v2/mix/market';
  const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' };

  try {
    let result = {};

    if (path === 'all') {
      const BN = 'https://fapi.binance.com';
      // Bitget + Binance 동시 수집
      const promises = await Promise.allSettled([
        // Bitget
        fetch(`${BASE}/current-fund-rate?symbol=BTCUSDT&productType=USDT-FUTURES`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BASE}/current-fund-rate?symbol=ETHUSDT&productType=USDT-FUTURES`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BASE}/current-fund-rate?symbol=SOLUSDT&productType=USDT-FUTURES`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BASE}/ticker?symbol=BTCUSDT&productType=USDT-FUTURES`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BASE}/open-interest?symbol=BTCUSDT&productType=USDT-FUTURES`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BASE}/account-long-short?symbol=BTCUSDT&productType=USDT-FUTURES&period=5m`, { headers: HEADERS }).then(r => r.json()),
        // Binance (서버사이드 프록시 - CORS 문제 없음)
        fetch(`${BN}/fapi/v1/premiumIndex?symbol=BTCUSDT`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BN}/fapi/v1/premiumIndex?symbol=ETHUSDT`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BN}/fapi/v1/premiumIndex?symbol=SOLUSDT`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BN}/fapi/v1/ticker/24hr?symbol=BTCUSDT`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BN}/fapi/v1/openInterest?symbol=BTCUSDT`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${BN}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1`, { headers: HEADERS }).then(r => r.json()),
      ]);

      const v = (i) => promises[i].status === 'fulfilled' ? promises[i].value : null;

      // Bitget 데이터
      const bg = {
        fundingBtc: v(0)?.data, fundingEth: v(1)?.data, fundingSol: v(2)?.data,
        tickerBtc: v(3)?.data?.[0] || v(3)?.data,
        oiBtc: v(4)?.data, longShortBtc: v(5)?.data,
      };
      // Binance 데이터
      const bn = {
        fundingBtc: v(6), fundingEth: v(7), fundingSol: v(8),
        tickerBtc: v(9), oiBtc: v(10), longShortBtc: v(11),
      };

      // Bitget 우선, Binance 폴백
      result = {
        fundingBtc: bg.fundingBtc || bn.fundingBtc,
        fundingEth: bg.fundingEth || bn.fundingEth,
        fundingSol: bg.fundingSol || bn.fundingSol,
        tickerBtc: bg.tickerBtc || bn.tickerBtc,
        oiBtc: bg.oiBtc || bn.oiBtc,
        longShortBtc: bg.longShortBtc || bn.longShortBtc,
        // Binance 추가 데이터 (Bitget에 없는 것)
        binance: {
          fundingBtc: bn.fundingBtc,
          tickerBtc: bn.tickerBtc,
          oiBtc: bn.oiBtc,
          longShortBtc: bn.longShortBtc,
        },
        source: bg.fundingBtc ? 'bitget' : (bn.fundingBtc ? 'binance' : 'none'),
      };
    } else {
      const search = url.search || '';
      const res = await fetch(`${BASE}/${path}${search}`, { headers: HEADERS });
      result = await res.json();
    }

    return new Response(JSON.stringify(result), { headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
  }
}

// ============================================================================
// ══ 거래소 API 자동 수집 + 자동출금 시스템 ══
// ============================================================================

// ── 암호화 유틸 (AES-256-GCM) ────────────────────────────────────────────────

async function getEncryptionKey(env) {
  const raw = env.ENCRYPTION_KEY || 'default_dev_key_change_in_production!';
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(raw.slice(0, 32).padEnd(32, '0')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('1pct_salt'), iterations: 1000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptValue(plaintext, env) {
  if (!plaintext) return '';
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv); buf.set(new Uint8Array(ct), iv.length);
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

async function decryptValue(ciphertext, env) {
  if (!ciphertext) return '';
  try {
    const key = await getEncryptionKey(env);
    const raw = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch { return ''; }
}

function maskKey(val) {
  if (!val || val.length < 8) return '****';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

// ── 거래소 API 서명 함수 ─────────────────────────────────────────────────────

async function hmacSHA256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacSHA512Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha512Hex(message) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-512', enc.encode(message));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function buildBitgetHeaders(apiKey, secret, passphrase, method, path, queryString, body) {
  const ts = String(Date.now());
  const preSign = ts + method.toUpperCase() + path + (queryString ? '?' + queryString : '') + (body || '');
  const sign = await hmacSHA256(secret, preSign);
  return { 'ACCESS-KEY': apiKey, 'ACCESS-SIGN': sign, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json' };
}

async function buildOKXHeaders(apiKey, secret, passphrase, method, path, body) {
  const ts = new Date().toISOString();
  const preSign = ts + method.toUpperCase() + path + (body || '');
  const sign = await hmacSHA256(secret, preSign);
  return { 'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': sign, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json' };
}

async function buildGateHeaders(apiKey, secret, method, path, queryString, body) {
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha512Hex(body || '');
  const preSign = method.toUpperCase() + '\n' + path + '\n' + (queryString || '') + '\n' + bodyHash + '\n' + ts;
  const sign = await hmacSHA512Hex(secret, preSign);
  return { 'KEY': apiKey, 'SIGN': sign, 'Timestamp': ts, 'Content-Type': 'application/json' };
}

// ── 거래소 설정 API ──────────────────────────────────────────────────────────

async function handleAdminExchangeConfigs(request, env, url) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);
  const db = env.DB;
  if (!db) return ajson({ error: 'DB 미연결' }, 500);

  const path = url.pathname.replace('/api/admin/exchange-configs', '') || '/';

  // GET / - 설정 목록
  if (request.method === 'GET' && path === '/') {
    const r = await db.prepare('SELECT * FROM exchange_api_configs ORDER BY exchange').all();
    const configs = (r.results || []).map(c => ({
      ...c,
      api_key_display: c.api_key_enc ? '설정됨' : '미설정',
      api_secret_display: c.api_secret_enc ? '설정됨' : '미설정',
      passphrase_display: c.passphrase_enc ? '설정됨' : '미설정',
    }));
    return ajson({ configs });
  }

  // POST / - 저장
  if (request.method === 'POST' && path === '/') {
    try {
    const body = await request.json();
    const { exchange, api_key, api_secret, passphrase, platform_rate, user_rate, is_active } = body;
    if (!exchange) return ajson({ error: '거래소 필수' }, 400);

    const keyEnc = api_key ? await encryptValue(api_key, env) : '';
    const secretEnc = api_secret ? await encryptValue(api_secret, env) : '';
    const passEnc = passphrase ? await encryptValue(passphrase, env) : '';

    const existing = await db.prepare('SELECT id FROM exchange_api_configs WHERE exchange=?').bind(exchange).first();
    if (existing) {
      const updates = [];
      const vals = [];
      if (api_key) { updates.push('api_key_enc=?'); vals.push(keyEnc); }
      if (api_secret) { updates.push('api_secret_enc=?'); vals.push(secretEnc); }
      if (passphrase) { updates.push('passphrase_enc=?'); vals.push(passEnc); }
      if (platform_rate !== undefined) { updates.push('platform_rate=?'); vals.push(platform_rate); }
      if (user_rate !== undefined) { updates.push('user_rate=?'); vals.push(user_rate); }
      if (is_active !== undefined) { updates.push('is_active=?'); vals.push(is_active ? 1 : 0); }
      updates.push("updated_at=datetime('now')");
      vals.push(existing.id);
      await db.prepare(`UPDATE exchange_api_configs SET ${updates.join(',')} WHERE id=?`).bind(...vals).run();
    } else {
      await db.prepare(
        'INSERT INTO exchange_api_configs (exchange,api_key_enc,api_secret_enc,passphrase_enc,platform_rate,user_rate,is_active) VALUES (?,?,?,?,?,?,?)'
      ).bind(exchange, keyEnc, secretEnc, passEnc, platform_rate || 0, user_rate || 0, is_active ? 1 : 0).run();
    }
    return ajson({ ok: true });
    } catch (err) { return ajson({ error: 'save_error: ' + err.message }, 500); }
  }

  // POST /test - 연결 테스트
  if (request.method === 'POST' && path === '/test') {
    const body = await request.json();
    const { exchange } = body;
    const config = await db.prepare('SELECT * FROM exchange_api_configs WHERE exchange=?').bind(exchange).first();
    if (!config || !config.api_key_enc) return ajson({ error: 'API 키 미설정' }, 400);

    try {
      const apiKey = await decryptValue(config.api_key_enc, env);
      const apiSecret = await decryptValue(config.api_secret_enc, env);
      const passphrase = await decryptValue(config.passphrase_enc, env);

      if (exchange === 'Bitget') {
        const path = '/api/v2/broker/account/info';
        const headers = await buildBitgetHeaders(apiKey, apiSecret, passphrase, 'GET', path, '', '');
        const r = await fetch('https://api.bitget.com' + path, { headers });
        const d = await r.json();
        return ajson({ ok: true, data: d });
      } else if (exchange === 'OKX') {
        const path = '/api/v5/account/balance';
        const headers = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'GET', path, '');
        const r = await fetch('https://www.okx.com' + path, { headers });
        const d = await r.json();
        return ajson({ ok: true, data: d });
      } else if (exchange === 'Gate.io') {
        const path = '/api/v4/wallet/total_balance';
        const headers = await buildGateHeaders(apiKey, apiSecret, 'GET', path, '', '');
        const r = await fetch('https://api.gateio.ws' + path, { headers });
        const d = await r.json();
        return ajson({ ok: true, data: d });
      }
      return ajson({ error: '지원하지 않는 거래소' }, 400);
    } catch (err) {
      return ajson({ error: '연결 실패: ' + err.message }, 500);
    }
  }

  // POST /debug - 실제 API 응답 확인
  if (request.method === 'POST' && path === '/debug') {
    const body = await request.json();
    const { exchange } = body;
    const config = await db.prepare('SELECT * FROM exchange_api_configs WHERE exchange=?').bind(exchange).first();
    if (!config || !config.api_key_enc) return ajson({ error: 'API 키 미설정' }, 400);
    try {
      const apiKey = await decryptValue(config.api_key_enc, env);
      const apiSecret = await decryptValue(config.api_secret_enc, env);
      const passphrase = await decryptValue(config.passphrase_enc, env);
      const results = {};

      if (exchange === 'Bitget') {
        results.note = 'Bitget은 Cloudflare Workers에서 차단됨';
      }

      if (exchange === 'OKX') {
        const now = Date.now();
        const since = now - 90 * 24 * 60 * 60 * 1000;

        // 1) 브로커 리베이트 - spot
        const path1 = '/api/v5/broker/fd/rebate-per-orders';
        const qs1a = `type=1&begin=${since}&end=${now}&limit=10`;
        const h1a = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'GET', path1 + '?' + qs1a, '');
        const r1a = await fetch('https://www.okx.com' + path1 + '?' + qs1a, { headers: h1a });
        results.broker_spot = await r1a.json();

        // 2) 브로커 리베이트 - futures
        const qs1b = `type=2&begin=${since}&end=${now}&limit=10`;
        const h1b = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'GET', path1 + '?' + qs1b, '');
        const r1b = await fetch('https://www.okx.com' + path1 + '?' + qs1b, { headers: h1b });
        results.broker_futures = await r1b.json();

        // 3) 제휴 커미션 내역
        const path3 = '/api/v5/affiliate/invitee/detail';
        const qs3 = 'limit=10';
        const h3 = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'GET', path3 + '?' + qs3, '');
        const r3 = await fetch('https://www.okx.com' + path3 + '?' + qs3, { headers: h3 });
        results.affiliate_detail = await r3.json();

        // 4) 펀딩 빌링 (모든 타입)
        const path4 = '/api/v5/asset/bills';
        const qs4 = 'limit=20';
        const h4 = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'GET', path4 + '?' + qs4, '');
        const r4 = await fetch('https://www.okx.com' + path4 + '?' + qs4, { headers: h4 });
        results.asset_bills_all = await r4.json();
      }

      return ajson({ ok: true, results });
    } catch (err) {
      return ajson({ error: 'debug_error: ' + err.message }, 500);
    }
  }

  return ajson({ error: '알 수 없는 경로' }, 404);
}

// ── 커미션 수집 함수 (거래소별) ──────────────────────────────────────────────

async function collectBitgetCommissions(env, config) {
  const db = env.DB;
  const apiKey = await decryptValue(config.api_key_enc, env);
  const apiSecret = await decryptValue(config.api_secret_enc, env);
  const passphrase = await decryptValue(config.passphrase_enc, env);

  const now = Date.now();
  const since = config.last_sync ? new Date(config.last_sync).getTime() : now - 24 * 60 * 60 * 1000;
  let fetched = 0, inserted = 0;
  let idLessThan = '';

  while (true) {
    const params = new URLSearchParams({ startTime: String(since), endTime: String(now), limit: '100' });
    if (idLessThan) params.set('idLessThan', idLessThan);
    const path = '/api/v2/broker/customer-commissions';
    const qs = params.toString();
    const headers = await buildBitgetHeaders(apiKey, apiSecret, passphrase, 'GET', path, qs, '');
    const r = await fetch('https://api.bitget.com' + path + '?' + qs, { headers });
    const d = await r.json();

    const list = d.data || [];
    if (!list.length) break;
    fetched += list.length;

    for (const item of list) {
      try {
        const fee = parseFloat(item.totalFee || item.fee || 0);
        const platformComm = fee * config.platform_rate;
        const userComm = fee * config.user_rate;
        await db.prepare(
          `INSERT OR IGNORE INTO commissions (exchange,invitee_uid,order_id,commission_time,trade_type,token,trading_fee,net_fee,platform_rate,user_rate,platform_commission,user_commission,raw_data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          'Bitget', item.uid || '', item.id || String(Date.now()), item.createTime || new Date().toISOString(),
          item.productType || '', item.coin || 'USDT', fee, parseFloat(item.netFee || fee),
          config.platform_rate, config.user_rate, platformComm, userComm, JSON.stringify(item)
        ).run();
        inserted++;
      } catch (e) { /* dedup or error, skip */ }
    }

    if (list.length < 100) break;
    idLessThan = list[list.length - 1].id || '';
    if (!idLessThan) break;
  }
  return { fetched, inserted };
}

async function collectOKXCommissions(env, config) {
  const db = env.DB;
  const apiKey = await decryptValue(config.api_key_enc, env);
  const apiSecret = await decryptValue(config.api_secret_enc, env);
  const passphrase = await decryptValue(config.passphrase_enc, env);

  let fetched = 0, inserted = 0;
  let after = '';

  // /api/v5/asset/bills?type=150 (Affiliate commission)
  while (true) {
    let qs = 'type=150&limit=100';
    if (after) qs += '&after=' + after;
    const path = '/api/v5/asset/bills?' + qs;
    const headers = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'GET', path, '');
    const r = await fetch('https://www.okx.com' + path, { headers });
    const d = await r.json();

    if (d.code !== '0') break;
    const list = d.data || [];
    if (!list.length) break;
    fetched += list.length;

    for (const item of list) {
      try {
        const amount = Math.abs(parseFloat(item.balChg || 0));
        const platformComm = amount * config.platform_rate;
        const userComm = amount * config.user_rate;
        const commTime = item.ts ? new Date(parseInt(item.ts)).toISOString() : new Date().toISOString();
        await db.prepare(
          `INSERT OR IGNORE INTO commissions (exchange,invitee_uid,order_id,commission_time,trade_type,token,trading_fee,net_fee,platform_rate,user_rate,platform_commission,user_commission,raw_data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          'OKX', 'affiliate', item.billId || String(Date.now()), commTime,
          'affiliate', item.ccy || 'USDT', amount, amount,
          config.platform_rate, config.user_rate, platformComm, userComm, JSON.stringify(item)
        ).run();
        inserted++;
      } catch (e) { /* dedup */ }
    }

    if (list.length < 100) break;
    after = list[list.length - 1].billId || '';
    if (!after) break;
  }
  return { fetched, inserted };
}

async function collectGateCommissions(env, config) {
  const db = env.DB;
  const apiKey = await decryptValue(config.api_key_enc, env);
  const apiSecret = await decryptValue(config.api_secret_enc, env);

  const now = Math.floor(Date.now() / 1000);
  const since = config.last_sync ? Math.floor(new Date(config.last_sync).getTime() / 1000) : now - 24 * 60 * 60;
  let fetched = 0, inserted = 0;
  let offset = 0;

  while (true) {
    const qs = `from=${since}&to=${now}&limit=100&offset=${offset}`;
    const apiPath = '/api/v4/rebate/partner/commission_history';
    const headers = await buildGateHeaders(apiKey, apiSecret, 'GET', apiPath, qs, '');
    const r = await fetch('https://api.gateio.ws' + apiPath + '?' + qs, { headers });
    const list = await r.json();

    if (!Array.isArray(list) || !list.length) break;
    fetched += list.length;

    for (const item of list) {
      try {
        const fee = parseFloat(item.commission_amount || item.amount || 0);
        const platformComm = fee * config.platform_rate;
        const userComm = fee * config.user_rate;
        await db.prepare(
          `INSERT OR IGNORE INTO commissions (exchange,invitee_uid,order_id,commission_time,trade_type,token,trading_fee,net_fee,platform_rate,user_rate,platform_commission,user_commission,raw_data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          'Gate.io', String(item.user_id || ''), String(item.id || Date.now()),
          item.commission_time || item.time || new Date().toISOString(),
          item.source || '', item.currency || 'USDT', fee, fee,
          config.platform_rate, config.user_rate, platformComm, userComm, JSON.stringify(item)
        ).run();
        inserted++;
      } catch (e) { /* dedup */ }
    }

    if (list.length < 100) break;
    offset += 100;
  }
  return { fetched, inserted };
}

// ── 월별 요약 집계 ───────────────────────────────────────────────────────────

async function aggregateCommissionSummaries(env) {
  const db = env.DB;
  const months = await db.prepare(
    "SELECT DISTINCT substr(commission_time,1,7) as m FROM commissions ORDER BY m DESC LIMIT 3"
  ).all();

  for (const row of (months.results || [])) {
    const month = row.m;
    const agg = await db.prepare(`
      SELECT c.exchange, c.invitee_uid, u.id as user_id,
        SUM(c.trading_fee) as total_fee, SUM(c.platform_commission) as pc,
        SUM(c.user_commission) as uc, COUNT(*) as cnt
      FROM commissions c
      LEFT JOIN users u ON u.uid = c.invitee_uid AND u.exchange = c.exchange
      WHERE substr(c.commission_time,1,7) = ?
      GROUP BY c.exchange, c.invitee_uid
    `).bind(month).all();

    for (const r of (agg.results || [])) {
      if (!r.user_id) continue;
      await db.prepare(`
        INSERT INTO commission_summaries (user_id, exchange, month, total_fee, platform_commission, user_commission, trade_count, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, exchange, month) DO UPDATE SET
          total_fee=excluded.total_fee, platform_commission=excluded.platform_commission,
          user_commission=excluded.user_commission, trade_count=excluded.trade_count,
          last_updated=datetime('now')
      `).bind(r.user_id, r.exchange, month, r.total_fee, r.pc, r.uc, r.cnt).run();
    }
  }
}

// ── 전체 수집 실행 (크론 + 수동) ──────────────────────────────────────────────

async function collectAllCommissions(env) {
  const db = env.DB;
  if (!db) return;

  let configs;
  try {
    configs = await db.prepare('SELECT * FROM exchange_api_configs WHERE is_active=1').all();
  } catch { return; }

  for (const config of (configs.results || [])) {
    const startedAt = new Date().toISOString();
    let logId;
    try {
      const lr = await db.prepare('INSERT INTO collection_logs (exchange,started_at,status) VALUES (?,?,?)').bind(config.exchange, startedAt, 'running').run();
      logId = lr.meta.last_row_id;
    } catch { logId = null; }

    try {
      let result = { fetched: 0, inserted: 0 };
      if (config.exchange === 'Bitget') result = await collectBitgetCommissions(env, config);
      else if (config.exchange === 'OKX') result = await collectOKXCommissions(env, config);
      else if (config.exchange === 'Gate.io') result = await collectGateCommissions(env, config);

      await db.prepare("UPDATE exchange_api_configs SET last_sync=datetime('now'), last_sync_status='success', updated_at=datetime('now') WHERE id=?").bind(config.id).run();
      if (logId) await db.prepare("UPDATE collection_logs SET finished_at=datetime('now'), status='success', records_fetched=?, records_new=? WHERE id=?").bind(result.fetched, result.inserted, logId).run();
    } catch (err) {
      await db.prepare("UPDATE exchange_api_configs SET last_sync_status=?, updated_at=datetime('now') WHERE id=?").bind('error: ' + err.message, config.id).run();
      if (logId) await db.prepare("UPDATE collection_logs SET finished_at=datetime('now'), status='error', error_message=? WHERE id=?").bind(err.message, logId).run();
    }
  }

  try { await aggregateCommissionSummaries(env); } catch (e) { console.error('Aggregate error:', e); }
}

// ── CSV 커미션 업로드 ─────────────────────────────────────────────────────────

async function handleCSVUpload(request, env) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);
  const db = env.DB;
  if (!db) return ajson({ error: 'DB 미연결' }, 500);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const exchange = formData.get('exchange');
    if (!file || !exchange) return ajson({ error: '파일과 거래소는 필수입니다' }, 400);

    const text = await file.text();
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return ajson({ error: 'CSV에 데이터가 없습니다' }, 400);

    // 헤더 파싱 + 컬럼 매핑
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
    const colMap = {};
    const MAPPING = {
      invitee_uid: ['uid', 'user_id', 'invitee_uid', '유저', '유저id'],
      trading_fee: ['amount', 'commission', 'fee', '금액', '커미션', '수수료'],
      commission_time: ['time', 'date', 'commission_time', '시간', '날짜'],
      order_id: ['order_id', 'id', 'bill_id', '주문id'],
      trade_type: ['type', 'trade_type', '유형'],
      token: ['token', 'currency', 'coin', '통화'],
      exchange_col: ['exchange', '거래소']
    };
    for (const [target, aliases] of Object.entries(MAPPING)) {
      const idx = headers.findIndex(h => aliases.includes(h));
      if (idx !== -1) colMap[target] = idx;
    }

    if (colMap.invitee_uid === undefined) return ajson({ error: '필수 컬럼 누락: UID (uid, user_id, invitee_uid)' }, 400);
    if (colMap.trading_fee === undefined) return ajson({ error: '필수 컬럼 누락: 금액 (amount, commission, fee)' }, 400);
    if (colMap.commission_time === undefined) return ajson({ error: '필수 컬럼 누락: 시간 (time, date, commission_time)' }, 400);

    // exchange_api_configs에서 비율 조회
    const config = await db.prepare('SELECT platform_rate, user_rate FROM exchange_api_configs WHERE exchange=?').bind(exchange).first();
    const platformRate = config?.platform_rate || 0.5;
    const userRate = config?.user_rate || 0.5;

    const now = Date.now();
    let total = 0, inserted = 0, skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (!cols.length) continue;
      total++;

      const uid = (cols[colMap.invitee_uid] || '').trim();
      const fee = parseFloat(cols[colMap.trading_fee] || '0');
      const time = (cols[colMap.commission_time] || '').trim();
      if (!uid || !time) { skipped++; continue; }

      const orderId = colMap.order_id !== undefined ? (cols[colMap.order_id] || '').trim() : `csv_${i}_${now}`;
      const tradeType = colMap.trade_type !== undefined ? (cols[colMap.trade_type] || '').trim() : 'unknown';
      const token = colMap.token !== undefined ? (cols[colMap.token] || '').trim() : 'USDT';
      const rowExchange = colMap.exchange_col !== undefined ? (cols[colMap.exchange_col] || '').trim() : exchange;

      const platformComm = fee * platformRate;
      const userComm = fee * userRate;

      try {
        await db.prepare(
          `INSERT OR IGNORE INTO commissions (exchange,invitee_uid,order_id,commission_time,trade_type,token,trading_fee,net_fee,platform_rate,user_rate,platform_commission,user_commission,raw_data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          rowExchange || exchange, uid, orderId || `csv_${i}_${now}`, time,
          tradeType, token, fee, fee, platformRate, userRate, platformComm, userComm,
          JSON.stringify({ source: 'csv_upload', row: i })
        ).run();
        inserted++;
      } catch (e) {
        skipped++;
      }
    }

    // 월별 요약 자동 재생성
    try { await aggregateCommissionSummaries(env); } catch (e) { console.error('Aggregate error:', e); }

    // 수집 로그 기록
    try {
      await db.prepare(
        "INSERT INTO collection_logs (exchange,started_at,finished_at,status,records_fetched,records_new) VALUES (?,datetime('now'),datetime('now'),?,?,?)"
      ).bind(exchange, 'success', total, inserted).run();
    } catch (e) { /* ignore log error */ }

    return ajson({ ok: true, total, inserted, skipped });
  } catch (err) {
    console.error('CSV upload error:', err);
    return ajson({ error: 'CSV 처리 실패: ' + err.message }, 500);
  }
}

// CSV 라인 파싱 (따옴표 처리)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

// ── 수동 수집 트리거 ─────────────────────────────────────────────────────────

async function handleCollectTrigger(request, env) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);
  try {
    await collectAllCommissions(env);
    return ajson({ ok: true, message: '수집 완료' });
  } catch (err) {
    return ajson({ error: '수집 실패: ' + err.message }, 500);
  }
}

// ── 커미션 관리 API (어드민) ─────────────────────────────────────────────────

async function handleAdminCommissions(request, env, url) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);
  const db = env.DB;
  if (!db) return ajson({ error: 'DB 미연결' }, 500);

  // GET /api/admin/commissions
  if (url.pathname === '/api/admin/commissions' && request.method === 'GET') {
    const ex = url.searchParams.get('exchange') || '';
    const uid = url.searchParams.get('uid') || '';
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = (page - 1) * limit;

    let where = '1=1';
    const vals = [];
    if (ex) { where += ' AND exchange=?'; vals.push(ex); }
    if (uid) { where += ' AND invitee_uid LIKE ?'; vals.push('%' + uid + '%'); }
    if (from) { where += ' AND commission_time>=?'; vals.push(from); }
    if (to) { where += ' AND commission_time<=?'; vals.push(to); }

    const total = await db.prepare(`SELECT COUNT(*) as cnt FROM commissions WHERE ${where}`).bind(...vals).first();
    vals.push(limit, offset);
    const r = await db.prepare(`SELECT * FROM commissions WHERE ${where} ORDER BY commission_time DESC LIMIT ? OFFSET ?`).bind(...vals).all();
    return ajson({ commissions: r.results || [], total: total?.cnt || 0, page, limit });
  }

  // GET /api/admin/commission-summaries
  if (url.pathname === '/api/admin/commission-summaries' && request.method === 'GET') {
    const month = url.searchParams.get('month') || '';
    const ex = url.searchParams.get('exchange') || '';
    const st = url.searchParams.get('status') || '';

    let where = '1=1';
    const vals = [];
    if (month) { where += ' AND cs.month=?'; vals.push(month); }
    if (ex) { where += ' AND cs.exchange=?'; vals.push(ex); }
    if (st) { where += ' AND cs.settlement_status=?'; vals.push(st); }

    const r = await db.prepare(`
      SELECT cs.*, u.nickname, u.uid, u.exchange as user_exchange
      FROM commission_summaries cs
      LEFT JOIN users u ON u.id = cs.user_id
      WHERE ${where}
      ORDER BY cs.month DESC, cs.exchange, u.nickname
    `).bind(...vals).all();
    return ajson({ summaries: r.results || [] });
  }

  // POST /api/admin/commission-summaries/:id/settle
  const settleMatch = url.pathname.match(/^\/api\/admin\/commission-summaries\/(\d+)\/settle$/);
  if (settleMatch && request.method === 'POST') {
    const csId = parseInt(settleMatch[1]);
    const cs = await db.prepare('SELECT cs.*, u.uid, u.exchange as user_exchange FROM commission_summaries cs LEFT JOIN users u ON u.id=cs.user_id WHERE cs.id=?').bind(csId).first();
    if (!cs) return ajson({ error: '요약 없음' }, 404);
    if (cs.settlement_status === 'settled') return ajson({ error: '이미 정산됨' }, 400);

    const sr = await db.prepare(
      'INSERT INTO settlements (user_id,exchange,month,volume,fee,payback_amount,status) VALUES (?,?,?,?,?,?,?)'
    ).bind(cs.user_id, cs.exchange, cs.month, cs.total_volume || 0, cs.total_fee, cs.user_commission, 'pending').run();

    await db.prepare("UPDATE commission_summaries SET settlement_status='settled', settlement_id=? WHERE id=?").bind(sr.meta.last_row_id, csId).run();
    return ajson({ ok: true, settlement_id: sr.meta.last_row_id });
  }

  // GET /api/admin/collection-logs
  if (url.pathname === '/api/admin/collection-logs' && request.method === 'GET') {
    const r = await db.prepare('SELECT * FROM collection_logs ORDER BY started_at DESC LIMIT 50').all();
    return ajson({ logs: r.results || [] });
  }

  return ajson({ error: '알 수 없는 경로' }, 404);
}

// ── 자동출금 실행 ────────────────────────────────────────────────────────────

async function executeAutoWithdrawal(env, withdrawal) {
  const db = env.DB;
  const sourceEx = withdrawal.source_exchange || 'Bitget';
  const config = await db.prepare('SELECT * FROM exchange_api_configs WHERE exchange=? AND is_active=1').bind(sourceEx).first();
  if (!config) throw new Error(sourceEx + ' API 설정이 없거나 비활성 상태입니다');

  const apiKey = await decryptValue(config.api_key_enc, env);
  const apiSecret = await decryptValue(config.api_secret_enc, env);
  const passphrase = await decryptValue(config.passphrase_enc, env);

  if (sourceEx === 'Bitget') {
    const body = JSON.stringify({
      coin: 'USDT', transferType: 'on_chain', chain: 'TRC20',
      address: withdrawal.wallet_address, size: String(withdrawal.amount),
      clientOid: '1pct_' + withdrawal.id + '_' + Date.now()
    });
    const path = '/api/v2/spot/wallet/withdrawal';
    const headers = await buildBitgetHeaders(apiKey, apiSecret, passphrase, 'POST', path, '', body);
    const r = await fetch('https://api.bitget.com' + path, { method: 'POST', headers, body });
    const d = await r.json();
    if (d.code && d.code !== '00000') throw new Error('Bitget 출금 실패: ' + (d.msg || JSON.stringify(d)));
    return { tx_id: d.data?.orderId || d.data?.id || '', exchange_data: d };
  }

  if (sourceEx === 'OKX') {
    const body = JSON.stringify({
      ccy: 'USDT', amt: String(withdrawal.amount), dest: '4',
      toAddr: withdrawal.wallet_address, chain: 'USDT-TRC20', fee: '1'
    });
    const path = '/api/v5/asset/withdrawal';
    const headers = await buildOKXHeaders(apiKey, apiSecret, passphrase, 'POST', path, body);
    const r = await fetch('https://www.okx.com' + path, { method: 'POST', headers, body });
    const d = await r.json();
    if (d.code !== '0') throw new Error('OKX 출금 실패: ' + (d.msg || JSON.stringify(d)));
    return { tx_id: d.data?.[0]?.wdId || '', exchange_data: d };
  }

  if (sourceEx === 'Gate.io') {
    const body = JSON.stringify({
      currency: 'USDT', amount: String(withdrawal.amount),
      address: withdrawal.wallet_address, chain: 'TRX'
    });
    const path = '/api/v4/withdrawals';
    const headers = await buildGateHeaders(apiKey, apiSecret, 'POST', path, '', body);
    const r = await fetch('https://api.gateio.ws' + path, { method: 'POST', headers, body });
    const d = await r.json();
    if (d.id === undefined && d.message) throw new Error('Gate.io 출금 실패: ' + d.message);
    return { tx_id: d.txid || String(d.id || ''), exchange_data: d };
  }

  throw new Error('지원하지 않는 거래소: ' + sourceEx);
}

async function handleAutoWithdrawal(request, env, url) {
  if (!checkAuth(request, env)) return ajson({ error: '인증 필요' }, 401);
  const db = env.DB;
  if (!db) return ajson({ error: 'DB 미연결' }, 500);

  const match = url.pathname.match(/\/api\/admin\/withdrawals\/(\d+)\/auto-send/);
  if (!match) return ajson({ error: '잘못된 경로' }, 400);
  const wId = parseInt(match[1]);

  const withdrawal = await db.prepare('SELECT * FROM withdrawals WHERE id=?').bind(wId).first();
  if (!withdrawal) return ajson({ error: '출금 요청 없음' }, 404);
  if (withdrawal.status !== 'pending' && withdrawal.status !== 'processing') {
    return ajson({ error: '처리할 수 없는 상태: ' + withdrawal.status }, 400);
  }

  await db.prepare("UPDATE withdrawals SET status='processing' WHERE id=?").bind(wId).run();

  try {
    const body = await request.json().catch(() => ({}));
    if (body.source_exchange) {
      await db.prepare("UPDATE withdrawals SET source_exchange=? WHERE id=?").bind(body.source_exchange, wId).run();
      withdrawal.source_exchange = body.source_exchange;
    }

    const result = await executeAutoWithdrawal(env, withdrawal);
    await db.prepare(
      "UPDATE withdrawals SET status='completed', auto_sent=1, exchange_withdraw_id=?, tx_hash=?, processed_at=datetime('now') WHERE id=?"
    ).bind(result.tx_id, result.tx_id, wId).run();
    return ajson({ ok: true, tx_id: result.tx_id });
  } catch (err) {
    await db.prepare("UPDATE withdrawals SET status='pending' WHERE id=?").bind(wId).run();
    return ajson({ error: err.message }, 500);
  }
}

// ── 마이페이지 커미션 API ────────────────────────────────────────────────────
// (handleMypage 함수에 추가할 라우트 - 아래에서 기존 함수에 패치)

// ── JSON Response Helper ────────────────────────────────────────────────────
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    }
  });
}

// ── 매매일지 (Trading Journal) API ──────────────────────────────────────────
async function handleJournal(request, env, path) {
  const method = request.method;

  // GET /api/journal/trades - 트레이드 목록 (필터링/페이징)
  if (path === '/api/journal/trades' && method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const symbol = url.searchParams.get('symbol');
    const exchange = url.searchParams.get('exchange');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let query = 'SELECT * FROM trades WHERE 1=1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (symbol) { query += ' AND symbol = ?'; params.push(symbol); }
    if (exchange) { query += ' AND exchange = ?'; params.push(exchange); }
    if (from) { query += ' AND trade_date >= ?'; params.push(from); }
    if (to) { query += ' AND trade_date <= ?'; params.push(to); }
    query += ' ORDER BY trade_date DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return jsonResp({ trades: results, total: results.length, limit, offset });
  }

  // GET /api/journal/trades/:id - 개별 트레이드 조회
  if (path.match(/^\/api\/journal\/trades\/[\w-]+$/) && method === 'GET') {
    const tradeId = path.split('/').pop();
    const { results } = await env.DB.prepare(
      'SELECT * FROM trades WHERE trade_id = ? OR id = ?'
    ).bind(tradeId, tradeId).all();
    if (!results.length) return jsonResp({ error: 'Not found' }, 404);
    return jsonResp(results[0]);
  }

  // POST /api/journal/trades - 트레이드 생성/업서트
  if (path === '/api/journal/trades' && method === 'POST') {
    const body = await request.json();
    const {
      trade_id, exchange, symbol, position,
      result = '', pnl = 0, entry_price = 0, exit_price = 0, sl_price = 0,
      size = 0, leverage = 1, fee = 0, trade_type = '', setup_type = '',
      status = 'open', entry_reason = '', exit_reason = '', comment = '',
      discipline_score = '', w_score = '', notion_page_id = '', chart_url = '',
      trade_date
    } = body;

    if (!trade_id || !exchange || !symbol || !position) {
      return jsonResp({ error: 'trade_id, exchange, symbol, position 필수' }, 400);
    }

    const date = trade_date || new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO trades
        (trade_id, exchange, symbol, position, result, pnl, entry_price, exit_price,
         sl_price, size, leverage, fee, trade_type, setup_type, status, entry_reason,
         exit_reason, comment, discipline_score, w_score, notion_page_id, chart_url,
         trade_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      trade_id, exchange, symbol, position, result, pnl, entry_price, exit_price,
      sl_price, size, leverage, fee, trade_type, setup_type, status, entry_reason,
      exit_reason, comment, discipline_score, w_score, notion_page_id, chart_url, date
    ).run();
    return jsonResp({ success: true, trade_id });
  }

  // PATCH /api/journal/trades/:id - 트레이드 수정
  if (path.match(/^\/api\/journal\/trades\/[\w-]+$/) && method === 'PATCH') {
    const tradeId = path.split('/').pop();
    const body = await request.json();
    const fields = [];
    const values = [];
    const allowed = [
      'result', 'pnl', 'exit_price', 'fee', 'status', 'exit_reason',
      'comment', 'discipline_score', 'notion_page_id', 'chart_url',
      'trade_type', 'setup_type'
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(body[key]);
      }
    }
    if (!fields.length) return jsonResp({ error: 'No fields' }, 400);
    fields.push("updated_at = datetime('now')");
    values.push(tradeId, tradeId);
    await env.DB.prepare(
      `UPDATE trades SET ${fields.join(', ')} WHERE trade_id = ? OR id = ?`
    ).bind(...values).run();
    return jsonResp({ success: true });
  }

  // DELETE /api/journal/trades/:id - 트레이드 삭제
  if (path.match(/^\/api\/journal\/trades\/[\w-]+$/) && method === 'DELETE') {
    const tradeId = path.split('/').pop();
    await env.DB.prepare(
      'DELETE FROM trades WHERE trade_id = ? OR id = ?'
    ).bind(tradeId, tradeId).run();
    return jsonResp({ success: true });
  }

  // GET /api/journal/stats - 전체 통계
  if (path === '/api/journal/stats' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN result='승' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result='패' THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN result='무' THEN 1 ELSE 0 END) as breakeven,
        ROUND(SUM(pnl),2) as total_pnl,
        ROUND(SUM(fee),2) as total_fees,
        ROUND(AVG(CASE WHEN pnl>0 THEN pnl END),2) as avg_win,
        ROUND(AVG(CASE WHEN pnl<0 THEN ABS(pnl) END),2) as avg_loss
       FROM trades WHERE status='closed'`
    ).all();
    const s = results[0] || {};
    s.win_rate = (s.wins + s.losses) > 0
      ? parseFloat(((s.wins / (s.wins + s.losses)) * 100).toFixed(2)) : 0;
    s.rr_ratio = (s.avg_win && s.avg_loss)
      ? parseFloat((s.avg_win / s.avg_loss).toFixed(2)) : 0;
    return jsonResp(s);
  }

  // GET /api/journal/stats/daily - 일별 통계
  if (path === '/api/journal/stats/daily' && method === 'GET') {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30');
    const { results } = await env.DB.prepare(
      `SELECT trade_date as date, COUNT(*) as trades,
        SUM(CASE WHEN result='승' THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(pnl),2) as pnl
       FROM trades WHERE status='closed'
        AND trade_date >= date('now','-'||?||' days')
       GROUP BY trade_date ORDER BY trade_date DESC`
    ).bind(days).all();
    return jsonResp(results);
  }

  // GET /api/journal/stats/symbol - 심볼별 통계
  if (path === '/api/journal/stats/symbol' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT symbol, COUNT(*) as trades,
        SUM(CASE WHEN result='승' THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(pnl),2) as pnl
       FROM trades WHERE status='closed'
       GROUP BY symbol ORDER BY pnl DESC`
    ).all();
    return jsonResp(results);
  }

  // GET /api/journal/positions - 오픈 포지션 목록
  if (path === '/api/journal/positions' && method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT * FROM trades WHERE status='open' ORDER BY created_at DESC"
    ).all();
    return jsonResp(results);
  }

  // GET /api/journal/today - 오늘 거래 요약
  if (path === '/api/journal/today' && method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT * FROM trades WHERE trade_date=date('now') ORDER BY created_at DESC"
    ).all();
    const pnl = results.reduce((s, t) => s + (t.pnl || 0), 0);
    const wins = results.filter(t => t.result === '승').length;
    return jsonResp({
      trades: results,
      summary: { count: results.length, wins, pnl: parseFloat(pnl.toFixed(2)) }
    });
  }

  return jsonResp({ error: 'Not found' }, 404);
}

// ── 매매일지 관리자 API ─────────────────────────────────────────────────────
async function handleAdminJournal(request, env, path) {
  // GET /api/admin/journal/stats - 관리자 통계
  if (path === '/api/admin/journal/stats') {
    const { results } = await env.DB.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_positions,
        ROUND(SUM(CASE WHEN status='closed' THEN pnl ELSE 0 END),2) as total_pnl
       FROM trades`
    ).all();
    return jsonResp(results[0] || {});
  }

  // POST /api/admin/journal/bulk - 대량 트레이드 입력
  if (path === '/api/admin/journal/bulk' && request.method === 'POST') {
    const body = await request.json();
    const trades = body.trades || [];
    let inserted = 0;
    for (const t of trades) {
      try {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO trades
            (trade_id, exchange, symbol, position, result, pnl, entry_price, exit_price,
             sl_price, size, leverage, fee, trade_type, status, entry_reason, exit_reason, trade_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          t.trade_id || `import_${Date.now()}_${inserted}`,
          t.exchange || '', t.symbol || '', t.position || '',
          t.result || '', t.pnl || 0, t.entry_price || 0, t.exit_price || 0,
          t.sl_price || 0, t.size || 0, t.leverage || 1, t.fee || 0,
          t.trade_type || '', t.status || 'closed',
          t.entry_reason || '', t.exit_reason || '',
          t.trade_date || new Date().toISOString().slice(0, 10)
        ).run();
        inserted++;
      } catch (e) { /* skip duplicates */ }
    }
    return jsonResp({ success: true, inserted });
  }

  return jsonResp({ error: 'Not found' }, 404);
}
