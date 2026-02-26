import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const url = new URL(event.request.url);

  // API 라우팅
  if (url.pathname === '/api/calendar') {
    return handleCalendar(event);
  }

  // 정적 파일 서빙
  try {
    return await getAssetFromKV(event);
  } catch (e) {
    return new Response('Not Found', { status: 404 });
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=1800',
};

// 코인 주요 일정 (CoinMarketCal API)
// API 키 설정: wrangler secret put COINMARKETCAL_API_KEY
async function handleCalendar(event) {
  const apiKey = (typeof COINMARKETCAL_API_KEY !== 'undefined') ? COINMARKETCAL_API_KEY : null;

  if (!apiKey) {
    // API 키 미설정 시 빈 배열 반환 (정적 콘텐츠 유지)
    return new Response(JSON.stringify({ events: [], source: 'no_api_key' }), { headers: CORS });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await fetch(
      `https://developers.coinmarketcal.com/v1/events?max=8&dateRangeStart=${today}&dateRangeEnd=${future}&showOnly=hot_events`,
      {
        headers: {
          'x-api-key': apiKey,
          'Accept-Encoding': 'deflate, gzip',
          'Accept': 'application/json',
        },
        cf: { cacheTtl: 1800, cacheEverything: true },
      }
    );

    if (!res.ok) throw new Error(`CoinMarketCal error: ${res.status}`);
    const data = await res.json();

    const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
    const events = (data.body || []).map(e => {
      const d = new Date(e.date_event);
      return {
        id: e.id,
        title: (e.title && e.title.en) ? e.title.en : String(e.title || ''),
        date: e.date_event,
        day: d.getDate(),
        dow: DAYS[d.getDay()],
        coins: (e.coins || []).slice(0, 2).map(c => c.symbol),
        category: (e.categories && e.categories[0]) ? e.categories[0].name : '주요이슈',
        hot: !!e.is_hot,
      };
    });

    return new Response(JSON.stringify({ events, source: 'coinmarketcal' }), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ events: [], error: err.message }), { headers: CORS });
  }
}
