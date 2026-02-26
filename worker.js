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

    // Calendar API
    if (url.pathname === '/api/calendar') {
      return handleCalendar(request, env);
    }

    // Static files
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) },
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
        db.prepare('SELECT COUNT(*) as c FROM users').first(),
        db.prepare('SELECT COALESCE(SUM(payback_amount),0) as c FROM settlements WHERE month=?').bind(curMonth).first(),
        db.prepare("SELECT COUNT(*) as c FROM settlements WHERE status='pending'").first(),
      ]);
      const byEx = await db.prepare('SELECT exchange, COUNT(*) as cnt FROM users GROUP BY exchange').all();
      return ajson({ totalUsers: u.c, monthlySettlement: s.c, unpaidCount: p.c, byExchange: byEx.results });
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
