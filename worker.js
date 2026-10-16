// Nifty Options Proxy - Cloudflare Worker
// Routes:
//   /expiries            NIFTY option expiry list (NSE)
//   /chain?expiry=X      NIFTY option chain for one expiry (NSE), X like 20-Oct-2026
//   /market              Nifty 50 + India VIX, 1 year daily closes (Yahoo)
//   /news                Latest Indian market headlines (Google News RSS)
//   /calendar            High-impact global events this week + next (Forex Factory feed)
//   /context             market + news + calendar in one call
// Written without template literals so it survives copy-paste into the Cloudflare editor.

var NSE = 'https://www.nseindia.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
var cookieJar = { v: '', t: 0 };

function cors(body, status, maxAge) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=' + (maxAge || 0)
    }
  });
}

function readCookies(res) {
  var list = [];
  if (res.headers.getSetCookie) list = res.headers.getSetCookie();
  else if (res.headers.get('set-cookie')) list = res.headers.get('set-cookie').split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  return list.map(function (s) { return s.split(';')[0].trim(); }).filter(function (s) { return s; }).join('; ');
}

async function nseCookies(force) {
  if (!force && cookieJar.v && Date.now() - cookieJar.t < 180000) return cookieJar.v;
  var r = await fetch(NSE + '/option-chain', {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  cookieJar = { v: readCookies(r), t: Date.now() };
  return cookieJar.v;
}

async function nseJson(path) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var c = await nseCookies(attempt > 0);
    var r = await fetch(NSE + path, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': NSE + '/option-chain',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': c
      }
    });
    if (r.ok) {
      var txt = await r.text();
      try { var j = JSON.parse(txt); if (j && Object.keys(j).length) return j; } catch (e) {}
    }
  }
  throw new Error('NSE did not return data (blocked or market data unavailable)');
}

function leg(o) {
  if (!o) return null;
  return {
    ltp: o.lastPrice, chg: o.change, oi: o.openInterest, coi: o.changeinOpenInterest,
    iv: o.impliedVolatility, vol: o.totalTradedVolume, bid: o.buyPrice1 || o.bidprice, ask: o.sellPrice1 || o.askPrice
  };
}

async function expiries() {
  var j = await nseJson('/api/option-chain-contract-info?symbol=NIFTY');
  return { expiries: j.expiryDates || (j.records && j.records.expiryDates) || [] };
}

async function chain(expiry) {
  if (!expiry) expiry = (await expiries()).expiries[0];
  var j = await nseJson('/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=' + encodeURIComponent(expiry));
  var rec = j.records || {};
  var data = rec.data || (j.filtered && j.filtered.data) || [];
  var rows = [];
  var spot = rec.underlyingValue || 0;
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    if (d.expiryDate && d.expiryDate !== expiry && d.expiryDates !== expiry) { /* v3 returns one expiry; keep all */ }
    if (!spot && d.CE && d.CE.underlyingValue) spot = d.CE.underlyingValue;
    rows.push({ k: d.strikePrice, ce: leg(d.CE), pe: leg(d.PE) });
  }
  rows.sort(function (a, b) { return a.k - b.k; });
  return { source: 'NSE', expiry: expiry, timestamp: rec.timestamp || '', spot: spot, expiries: rec.expiryDates || [], rows: rows };
}

async function yahoo(sym) {
  var u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1y&interval=1d';
  var r = await fetch(u, { headers: { 'User-Agent': UA } });
  var j = await r.json();
  var res = j.chart.result[0];
  var q = res.indicators.quote[0];
  var closes = [];
  for (var i = 0; i < res.timestamp.length; i++) if (q.close[i] != null) closes.push(Math.round(q.close[i] * 100) / 100);
  var m = res.meta;
  var price = m.regularMarketPrice || closes[closes.length - 1];
  var prev = m.chartPreviousClose;
  if (closes.length > 1) prev = closes[closes.length - 2];
  return { price: price, prevClose: prev, time: m.regularMarketTime, closes: closes };
}

async function market() {
  var a = await Promise.all([yahoo('^NSEI'), yahoo('^INDIAVIX')]);
  return { nifty: a[0], vix: a[1] };
}

function tag(s, name) {
  var m = s.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

async function news() {
  var q = encodeURIComponent('(Nifty OR Sensex OR RBI OR "Indian stock market" OR FII) when:1d');
  var u = 'https://news.google.com/rss/search?q=' + q + '&hl=en-IN&gl=IN&ceid=IN:en';
  var r = await fetch(u, { headers: { 'User-Agent': UA } });
  var x = await r.text();
  var items = x.split('<item>').slice(1, 41);
  var out = [];
  for (var i = 0; i < items.length; i++) {
    out.push({ title: tag(items[i], 'title'), link: tag(items[i], 'link'), time: tag(items[i], 'pubDate'), source: tag(items[i], 'source') });
  }
  return { items: out };
}

async function ff(file) {
  try {
    var r = await fetch('https://nfs.faireconomy.media/' + file, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) { return []; }
}

async function calendar() {
  var a = await Promise.all([ff('ff_calendar_thisweek.json'), ff('ff_calendar_nextweek.json')]);
  var all = a[0].concat(a[1]);
  var keep = ['USD', 'CNY', 'EUR', 'JPY', 'GBP'];
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (e.impact === 'High' && keep.indexOf(e.country) >= 0) out.push({ title: e.title, country: e.country, date: e.date, impact: e.impact, forecast: e.forecast, previous: e.previous });
  }
  return { events: out };
}

async function settle(p) { try { return await p; } catch (e) { return { error: String(e.message || e) }; } }

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return cors({}, 204);
    var url = new URL(request.url);
    var p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/expiries') return cors(await expiries(), 200, 300);
      if (p === '/chain') return cors(await chain(url.searchParams.get('expiry')), 200, 5);
      if (p === '/market') return cors(await market(), 200, 30);
      if (p === '/news') return cors(await news(), 200, 300);
      if (p === '/calendar') return cors(await calendar(), 200, 1800);
      if (p === '/context') {
        var r = await Promise.all([settle(market()), settle(news()), settle(calendar())]);
        return cors({ market: r[0], news: r[1], calendar: r[2] }, 200, 30);
      }
      return cors({ ok: true, routes: ['/expiries', '/chain?expiry=DD-Mon-YYYY', '/market', '/news', '/calendar', '/context'] });
    } catch (e) {
      return cors({ error: String(e.message || e) }, 502);
    }
  }
};
