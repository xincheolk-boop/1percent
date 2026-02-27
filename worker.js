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

    // Admin API
    if (url.pathname.startsWith('/api/admin')) {
      return handleAdmin(request, env, url);
    }

    // Auth API
    if (url.pathname.startsWith('/api/auth')) {
      return handleAuth(request, env, url);
    }

    // Mypage API
    if (url.pathname.startsWith('/api/mypage')) {
      return handleMypage(request, env, url);
    }

    // Public Register API
    if (url.pathname === '/api/register') {
      return handleRegister(request, env);
    }

    // Calendar API
    if (url.pathname === '/api/calendar') {
      return handleCalendar(request, env);
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
};

// ── Admin Auth ────────────────────────────────────────────────────────────────

function checkAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  return h.slice(7) === (env.ADMIN_PASSWORD || 'admin1234');
}

const AH = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const ajson = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: AH });

// ── Admin Routes ──────────────────────────────────────────────────────────────

async function handleAdmin(request, env, url) {
  const path = url.pathname.replace('/api/admin', '') || '/';

  // Auth (no token required)
  if (path === '/auth' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body.password === (env.ADMIN_PASSWORD || 'admin1234')) return ajson({ ok: true });
    return ajson({ ok: false, error: '비밀번호가 틀렸습니다' }, 401);
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
      let sql = `SELECT a.id, a.email, a.nickname, a.my_referral_code, a.referral_code_used,
                        a.status, a.created_at, COUNT(u.id) as uid_count
                 FROM accounts a LEFT JOIN users u ON u.account_id = a.id`;
      const p = [], w = [];
      if (st) { w.push('a.status=?'); p.push(st); }
      if (q)  { w.push('(a.email LIKE ? OR a.nickname LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
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
        const r = await db.prepare('SELECT * FROM events ORDER BY is_active DESC, start_date DESC').all();
        return ajson({ events: r.results || [] });
      }
      if (request.method === 'POST') {
        const b = await request.json();
        const r = await db.prepare(
          'INSERT INTO events (exchange,title,description,image_url,link,start_date,end_date,is_active) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(b.exchange||'', b.title||'', b.description||'', b.image_url||'', b.link||'', b.start_date||'', b.end_date||'', b.is_active?1:0).run();
        return ajson({ ok: true, id: r.meta.last_row_id });
      }
    }
    const eIdM = path.match(/^\/events\/(\d+)$/);
    if (eIdM) {
      const id = +eIdM[1];
      if (request.method === 'PUT') {
        const b = await request.json();
        await db.prepare('UPDATE events SET exchange=?,title=?,description=?,image_url=?,link=?,start_date=?,end_date=?,is_active=? WHERE id=?')
          .bind(b.exchange||'', b.title||'', b.description||'', b.image_url||'', b.link||'', b.start_date||'', b.end_date||'', b.is_active?1:0, id).run();
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

  return aj2({ error: '알 수 없는 경로' }, 404);
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
