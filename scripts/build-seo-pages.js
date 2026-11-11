#!/usr/bin/env node
/* THE GOLF TREND — 검색엔진·AI 검색용 상품 정적 페이지 생성기
 *
 * 왜 필요한가: 홈페이지의 상품은 관리자가 입력해 Supabase(kundo_site_state)에 저장되고, 방문자 브라우저에서 JS가 읽어 화면을 그린다.
 *   그런데 AI 검색 크롤러(ChatGPT·Perplexity·Claude 등)와 일부 검색엔진은 JS를 실행하지 않아, 처음 받는 HTML에 상품이 하나도 없다.
 *   이 스크립트는 상품마다 "처음부터 내용이 들어 있는" 정적 HTML 페이지를 만들어 저장소(GitHub Pages)에 올린다.
 *
 * 어떻게 만드는가(데이터가 홈페이지와 어긋나지 않도록): 홈페이지(index.html)를 헤드리스 브라우저로 열고, 홈페이지가 쓰는 함수
 *   (getProducts·isProductVisible 등)로 "지금 홈페이지에 보이는 상품"을 그대로 뽑는다. 상품 데이터는 Supabase에서 받아 주입한다.
 *   → 관리자 입력값·기본 상품·노출 기간(만료 상품 숨김) 규칙이 홈페이지와 항상 같다.
 *
 * 만드는 것:  golf/index.html(전체) · golf/overseas/ · golf/domestic/ · golf/<국가·권역>/ · golf/<국가·권역>/<상품코드>/ · sitemap.xml
 * 원칙:  등록된 값만 쓴다. 비어 있는 항목은 줄 자체를 만들지 않는다(숫자·가격·시기를 만들어 내지 않음).
 *        구조화 데이터(JSON-LD)는 같은 페이지에 보이는 내용과 1:1로 맞춘다.
 *
 * 실행:  node scripts/build-seo-pages.js          (Playwright 필요: scripts/package.json)
 *        환경변수  SEO_SITE_STATE_FILE=파일경로  → Supabase 대신 저장해 둔 site state JSON 사용(테스트용)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://thegolftrend.co.kr';
const OUT = path.join(ROOT, 'golf');
const SOURCE_HTML = 'index.html';

// ── 도우미 ──────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const won = n => Number(n).toLocaleString('ko-KR') + '원';
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const kstDate = iso => { const d = new Date(new Date(iso).getTime() + 9 * 3600000); return d.toISOString().slice(0, 10); };
const codeOf = uid => String(uid || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const urlProduct = (cat, code) => `/golf/${cat}/${code}/`;
const abs = u => /^https?:\/\//.test(u) ? u : ORIGIN + (u.startsWith('/') ? u : '/' + u);

function readConst(name) {
  const m = new RegExp(`const ${name}\\s*=\\s*'([^']+)'`).exec(fs.readFileSync(path.join(ROOT, SOURCE_HTML), 'utf8'));
  if (!m) throw new Error(`${name}을 ${SOURCE_HTML}에서 찾지 못했습니다`);
  return m[1];
}

async function loadSiteState() {
  if (process.env.SEO_SITE_STATE_FILE) {
    const j = JSON.parse(fs.readFileSync(process.env.SEO_SITE_STATE_FILE, 'utf8'));
    return Array.isArray(j) ? j[0] : j;
  }
  const url = readConst('SUPABASE_URL'), key = readConst('SUPABASE_ANON_KEY');
  const res = await fetch(`${url}/rest/v1/kundo_site_state?id=eq.1&select=updated_at,data`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase 응답 오류 ${res.status}`);
  const rows = await res.json();
  if (!rows.length || !rows[0].data) throw new Error('kundo_site_state에 데이터가 없습니다');
  return rows[0];
}

// ── 1) 홈페이지에서 "지금 보이는 상품" 뽑기 ───────────────────────
async function extract(state) {
  const { chromium } = require('playwright');
  const server = http.createServer((q, r) => {
    let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
    if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200); r.end(d); } });
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.href), r => r.abort());   // 외부 요청 차단(글꼴·CDN 등) — 데이터는 아래에서 주입
    await ctx.addInitScript(({ data, updated }) => {
      const mk = table => { const q = { select() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; }, gt() { return q; }, gte() { return q; }, in() { return q; }, range() { return q; },
        upsert() { return Promise.resolve({ error: null }); }, insert() { return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve(table === 'kundo_site_state' ? { data: { data, updated_at: updated }, error: null } : { data: null, error: null }); },
        then(res) { return Promise.resolve(table === 'kundo_site_state' ? { data: [{ data }], error: null } : { data: [], error: null }).then(res); } }; return q; };
      window.supabase = { createClient: () => ({ from: mk, rpc: () => Promise.resolve({ data: null, error: null }),
        auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
        storage: { from: () => ({}) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }) }) };
    }, { data: state.data, updated: state.updated_at });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.warn('[홈페이지 오류]', e.message));
    await page.goto(`http://127.0.0.1:${port}/${SOURCE_HTML}`, { waitUntil: 'load' });
    const pulled = await page.evaluate(() => siteStatePulled);
    if (!pulled) throw new Error('홈페이지가 상품 데이터를 불러오지 못했습니다');
    return await page.evaluate(extractInPage);
  } finally { await browser.close(); server.close(); }
}

// 브라우저 안에서 실행 — 홈페이지의 전역 함수·상수를 그대로 쓴다
function extractInPage() {
  const lines = html => {
    const t = String(html == null ? '' : html); if (!t.trim()) return [];
    const d = document.createElement('div');
    if (t.indexOf('<') < 0) d.textContent = t; else d.innerHTML = sanitizeRichHTML(t);
    d.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    d.querySelectorAll('td,th').forEach(c => c.append(' | '));
    d.querySelectorAll('div,p,li,tr,table,h1,h2,h3,h4,h5,h6,ul,ol').forEach(el => { el.prepend('\n'); el.append('\n'); });
    const out = [];
    (d.textContent || '').split('\n').forEach(l => {
      l = l.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/\s*\|\s*$/, '').trim();
      if (l && l !== out[out.length - 1]) out.push(l);
    });
    return out;
  };
  const plain = v => lines(v).join(' ');
  const strip = s => String(s || '').replace(/^["“”']+|["“”']+$/g, '').trim();
  const filled = v => Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== '');
  const fmtField = (f, v) => {
    if (Array.isArray(v)) { const sub = f.sub ? '' : ''; return v.join(', ') + sub; }
    if (f.type === 'yn') return v === 'y' ? (f.yes || '예') : (f.no || '아니오');
    if (f.type === 'num') return v + (f.unit || '');
    return String(v);
  };
  const placeFacts = (fields, place, skip) => {
    const out = [];
    fields.forEach(f => {
      if (skip.includes(f.k) || f.type === 'prox' || f.type === 'cat') return;
      let v = place[f.k]; if (f.k === 'practice') { if (!filled(v)) return; const items = place.practiceItems; out.push([f.label, v === 'y' ? ((items && items.length ? items.join(', ') : f.yes || '있음')) : (f.no || '없음')]); return; }
      if (!filled(v)) return; out.push([f.label, fmtField(f, v)]);
    });
    return out;
  };
  const ymd = x => { const o = dateYMD(x); if (!o) return ''; return `${o.y}.${String(o.m).padStart(2, '0')}.${String(o.d).padStart(2, '0')}(${WEEKDAY_KO[new Date(o.y, o.m - 1, o.d).getDay()]})`; };
  // 요일별 요금 — 부제목(group)은 바로 아래에 금액이 있을 때만 남기고, 구분선(divider)은 뺀다. 기간(start~end)이 있으면 함께 담는다
  const dayRows = list => {
    const out = []; let pending = [];
    (list || []).forEach(d => {
      if (!d) return;
      if (d.kind === 'group') { const g = plain(d.title); if (g) pending.push({ g }); return; }
      if (d.kind === 'divider') { pending = []; return; }          // 금액 없이 구분선으로 끝난 구간의 부제목은 뺀다
      if (Number(d.price) > 0) { out.push(...pending, { day: String(d.day || '').trim(), price: Number(d.price), start: d.start || '', end: d.end || '' }); pending = []; }
    });
    return out;
  };
  const holRows = list => (list || []).filter(h => h && !dpIsMarker(h) && Number(h.price) > 0).map(h => ({ date: ymd(h.date), end: h.endDate ? ymd(h.endDate) : '', price: Number(h.price) })).filter(h => h.date);
  const dateList = v => normDayDates(v).dates.map(ymd).filter(Boolean);
  const placeById = (kind, id) => (kind === 'lodge' ? aiPlaces.lodges : aiPlaces.courses).find(x => x.id === id);
  const res = [];
  const cats = [].concat(CATEGORIES.overseas.map(c => ['overseas', c]), CATEGORIES.domestic.map(c => ['domestic', c]));
  cats.forEach(([region, cat]) => {
    getProducts(cat.id).forEach((p, idx) => {
      if (!isProductVisible(p)) return;
      const dom = region === 'domestic';
      const entries = (p.priceEntries || []).filter(e => !e.hidden).map(e => {
        const price = Number(e.salePrice) || 0;
        return {
          headline: plain(e.headline), price, currency: e.saleCurrency || 'KRW', fromLabel: e.saleFromLabel !== false,
          rounds: plain(e.rounds), stay: plain(e.stay), meals: plain(e.meals), minPeople: plain(e.minPeople),
          dayPrices: dayRows(peEff(p, e, 'dayPrices')), holidayPrices: holRows(peEff(p, e, 'holidayPrices')), dates: dateList(peEff(p, e, 'dayDates')),
          included: lines(e.included), notIncluded: lines(e.notIncluded), precautions: lines(e.precautions),
          ai: e.aiInfo || {}
        };
      });
      const info = aiMergedInfo(p, null, dom);
      const ids = k => { const set = new Set(Array.isArray(info[k]) ? info[k] : []); entries.forEach(e => (e.ai[k] || []).forEach(i => set.add(i))); return [...set]; };
      const courses = ids('courseIds').map(i => placeById('course', i)).filter(Boolean).map(c => ({ name: c.name, facts: placeFacts(AI_COURSE_FIELDS, c, ['name', 'memo']) }));
      const lodges = ids('lodgeIds').map(i => placeById('lodge', i)).filter(Boolean).map(l => ({ name: l.name, facts: placeFacts(AI_LODGE_FIELDS, l, ['name', 'memo', 'lodgeStarSrc']) }));
      const images = [];
      const addImg = (url, cap) => { if (url && !images.some(i => i.url === url)) images.push({ url, caption: plain(cap || '') }); };
      if (p.titleMedia && p.titleMedia.type === 'image') addImg(p.titleMedia.url, '');
      (p.gallery || []).forEach(g => addImg(g.url, g.caption));
      (p.extraGalleries || []).forEach(s => (s.items || []).forEach(g => addImg(g.url, g.caption)));
      const lab = p.labels || {};
      const priceInquiry = priceInquiryText(p);
      const from = Number(p.from) || 0;
      res.push({
        region, catId: cat.id, catKo: cat.ko, catTagline: cat.tagline || '', idx, uid: p.uid,
        title: plain(p.title), monthsTag: productMonthsLabel(p), periodText: plain(p.nights), nightsCount: plain(p.nightsCount),
        rounds: plain(p.rounds), stay: plain(p.stay), meals: plain(p.meals), lodge: lodgeText(p), ticket: ticketText(p),
        airfare: p.airfareIncluded === 'included' ? '항공 포함' : (p.airfareIncluded === 'excluded' ? '항공 불포함' : ''),
        flightTime: plain(p.flightTime), transferLabel: dom ? '숙소→골프장' : '공항→호텔', transferTime: plain(p.transferTime), hotelToGolfTime: plain(p.hotelToGolfTime),
        minPeople: plain(p.minPeople),
        departAirports: Array.isArray(lab.departureAirport) ? lab.departureAirport : [], arrAirport: plain(lab.arrAirport), flightNo: plain(lab.flightNo),
        departureDay: Array.isArray(lab.departureDay) ? lab.departureDay : [], stayDuration: lab.stayDuration && lab.stayDuration !== 'none' ? plain(lab.stayDuration) : '',
        tags: cardTagEntries(p).map(t => t.plain).filter(Boolean),
        checkpoints: [].concat(lines(p.checkpoint1), lines(p.checkpoint2)),
        priceInquiry: strip(priceInquiry), from, fromLabel: p.fromLabel !== false,
        entries, commonDayPrices: dayRows(p.commonDayPrices), commonHolidayPrices: holRows(p.commonHolidayPrices), commonDates: dateList(p.commonDayDates),
        included: lines(p.commonIncluded), notIncluded: lines(p.commonNotIncluded), precautions: lines(p.commonPrecautions), notes: lines(p.notes), booking: lines(p.bookingPolicy),
        aiFacts: { packageType: info.packageType || '', mealsIncl: info.mealsIncl || [], mealCount: info.mealCount || '', paxOk: info.paxOk || [] },
        courses, lodges, images
      });
    });
  });
  const company = [...document.querySelectorAll('.foot-company .fc-line')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
  return { products: res, company, contact: { phone: SITE_CONTACT.phone, kakaoChat: SITE_CONTACT.kakaoChat, kakaoChannel: SITE_CONTACT.kakaoChannel },
    cats: { overseas: CATEGORIES.overseas.map(c => ({ id: c.id, ko: c.ko, tagline: c.tagline || '' })), domestic: CATEGORIES.domestic.map(c => ({ id: c.id, ko: c.ko, tagline: c.tagline || '' })) } };
}

// ── 2) HTML 만들기 ───────────────────────────────────────────
const CSS = `
:root{--navy:#030d26;--navy2:#0f2347;--gold:#b98a24;--gold2:#d8ab45;--ink:#1b2536;--soft:#5b6778;--line:#e3e8f0;--bg:#f7f4ec}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Noto Sans KR',-apple-system,'Malgun Gothic',sans-serif;color:var(--ink);background:var(--bg);line-height:1.7;word-break:keep-all}
a{color:#1d4ed8}header.site{background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff}
header.site .in{max-width:1000px;margin:0 auto;padding:14px 20px;display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}
header.site a{color:#fff;text-decoration:none}.brand{font-weight:800;letter-spacing:.08em;font-size:1.05rem}
header.site nav{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.9rem;margin-left:auto}
main{max-width:1000px;margin:0 auto;padding:22px 20px 48px}
.crumbs{font-size:.82rem;color:var(--soft);margin:0 0 14px}.crumbs a{color:var(--soft)}
h1{font-size:1.6rem;line-height:1.35;margin:0 0 6px;color:var(--navy)}h2{font-size:1.2rem;margin:30px 0 10px;padding-left:10px;border-left:5px solid var(--gold2);color:var(--navy)}h3{font-size:1.02rem;margin:18px 0 6px}
.tag{display:inline-block;font-size:.8rem;font-weight:700;padding:2px 10px;border-radius:999px;background:#fff3d6;color:#7a5410;margin:0 6px 6px 0}
.lead{color:var(--soft);margin:0 0 14px}.hero{width:100%;max-height:460px;object-fit:cover;border-radius:16px;background:#dfe4ec;display:block}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:10px 0}
table.facts{width:100%;border-collapse:collapse;font-size:.95rem}table.facts th{width:150px;text-align:left;vertical-align:top;color:var(--soft);font-weight:600;padding:7px 10px 7px 0;border-bottom:1px solid var(--line)}table.facts td{padding:7px 0;border-bottom:1px solid var(--line)}
.price{font-size:1.5rem;font-weight:800;color:var(--navy)}.price small{font-size:.85rem;font-weight:600;color:var(--gold)}
table.rate{width:100%;border-collapse:collapse;font-size:.95rem;margin:6px 0}table.rate th,table.rate td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}table.rate th{background:#f1f4f9}
.entry{border-top:1px dashed var(--line);margin-top:12px;padding-top:6px}.entry:first-child{border-top:none;margin-top:0}
p.l{margin:3px 0}.muted{color:var(--soft);font-size:.9rem}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:8px 0}.gallery figure{margin:0}.gallery img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;background:#dfe4ec;display:block}.gallery figcaption{font-size:.8rem;color:var(--soft);margin-top:3px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.cta a{display:inline-block;padding:12px 20px;border-radius:12px;font-weight:800;text-decoration:none;border:1px solid var(--gold);color:#7a5410;background:#fff}.cta a.pri{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#fff;border-color:var(--gold)}
ul.list{list-style:none;margin:0;padding:0}ul.list li{background:#fff;border:1px solid var(--line);border-radius:12px;margin:8px 0}ul.list a{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:space-between;align-items:baseline;padding:12px 16px;text-decoration:none;color:var(--ink)}ul.list .t{font-weight:700;color:var(--navy)}ul.list .m{color:var(--soft);font-size:.88rem}ul.list .p{font-weight:800;color:var(--navy)}
footer.site{background:var(--navy);color:#cbd5e1;font-size:.82rem;padding:22px 20px}footer.site .in{max-width:1000px;margin:0 auto}footer.site p{margin:3px 0}
@media(max-width:600px){h1{font-size:1.35rem}table.facts th{width:96px}header.site nav{margin-left:0}}`;

function layout({ title, description, canonicalPath, ogImage, jsonLd, body, crumbs, data, stateDate }) {
  const canonical = ORIGIN + canonicalPath;
  const crumbHtml = crumbs.map((c, i) => i === crumbs.length - 1 ? `<span aria-current="page">${esc(c.name)}</span>` : `<a href="${esc(c.path)}">${esc(c.name)}</a>`).join(' › ');
  const ld = [].concat(jsonLd || [], { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path) })) });
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="THE GOLF TREND">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(abs(ogImage))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(abs(ogImage))}">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="site"><div class="in"><a class="brand" href="/">THE GOLF TREND</a>
<nav aria-label="주요 메뉴"><a href="/golf/">골프 패키지 전체</a><a href="/golf/overseas/">해외 골프여행</a><a href="/golf/domestic/">국내 골프여행</a><a href="/">홈페이지</a></nav></div></header>
<main>
<p class="crumbs">${crumbHtml}</p>
${body}
</main>
<footer class="site"><div class="in">
${data.company.map(l => `<p>${esc(l)}</p>`).join('\n')}
<p>등록 정보 기준일 ${esc(stateDate)} · 요금·일정은 변동될 수 있으니 상담 시 최종 확인해 주세요.</p>
</div></footer>
</body>
</html>
`;
}

const cta = (p, data) => `<div class="cta">
<a class="pri" href="/?p=${encodeURIComponent(p.catId)}:${p.idx}#booking" rel="nofollow">상담 신청 · 자세히 보기</a>
<a href="tel:${esc(data.contact.phone)}">전화 상담 ${esc(data.contact.phone)}</a>
<a href="${esc(data.contact.kakaoChat)}" target="_blank" rel="noopener">카카오톡 상담</a></div>`;

const titleFull = p => (p.title + (p.monthsTag ? ` 【${p.monthsTag}】` : '')).trim();
const regionName = r => r === 'overseas' ? '해외 골프여행' : '국내 골프여행';
// 최저가 — 페이지에 보이는 모든 금액(홈페이지 표시가·요금 항목·요일별 요금) 중 가장 낮은 값. 가격 문의 상품은 금액을 쓰지 않는다
function lowestPrice(p) {
  if (p.priceInquiry) return 0;
  const nums = [p.from].concat(p.entries.map(e => e.price), p.entries.reduce((a, e) => a.concat(e.dayPrices.map(d => d.price || 0)), []), p.commonDayPrices.map(d => d.price || 0)).filter(n => n > 0);
  return nums.length ? Math.min(...nums) : 0;
}
const priceText = p => { if (p.priceInquiry) return p.priceInquiry; const lo = lowestPrice(p); return lo > 0 ? `${won(lo)}${p.fromLabel ? ' ~부터' : ''}` : ''; };

function descOf(p) {
  const lo = lowestPrice(p);
  const bits = [p.nightsCount, p.rounds, p.lodge, p.airfare, p.monthsTag ? `추천 시기 ${p.monthsTag}` : '', lo > 0 ? `${won(lo)}${p.fromLabel ? '~' : ''}` : ''].filter(Boolean);
  return clip(`${p.title} — ${bits.join(' · ')}. ${p.catKo} 골프 패키지 상담·예약 THE GOLF TREND.`, 150);
}

function productPage(p, data, stateDate) {
  const code = codeOf(p.uid), pagePath = urlProduct(p.catId, code), url = ORIGIN + pagePath;
  const rows = [];
  const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') rows.push(`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`); };
  add('지역', `${regionName(p.region)} › ${p.catKo}`);
  add('일정', p.nightsCount); add('체류 기간', p.stayDuration); add('출발 가능 기간', p.periodText); add('추천 판매 시기', p.monthsTag);
  add('출발 요일', p.departureDay.join(', ')); add('골프 라운드', p.rounds); add('숙박', p.stay); add('숙소 위치', p.lodge); add('식사', p.meals);
  add('항공', p.airfare); add('출발 공항', p.departAirports.join(', ')); add('도착 공항', p.arrAirport); add('항공편', p.flightNo);
  add('비행 시간', p.flightTime); add(p.transferLabel + ' 이동', p.transferTime); add('호텔→골프장 이동', p.hotelToGolfTime);
  add('최소 출발 인원', p.minPeople ? `${p.minPeople}명 이상` : ''); add('항공 발권', p.ticket);
  add('상품 구성', p.aiFacts.packageType); add('포함 식사', p.aiFacts.mealsIncl.join(', ')); add('포함 식사 횟수', p.aiFacts.mealCount); add('출발 가능 인원', p.aiFacts.paxOk.join(', '));
  add(p.priceInquiry ? '요금' : '최저가', priceText(p));
  if (!p.priceInquiry && p.from > 0 && p.from !== lowestPrice(p)) add('홈페이지 표시 대표가', `${won(p.from)}${p.fromLabel ? ' ~부터' : ''}`);

  const priced = p.entries.filter(e => e.price > 0);
  // 같은 문장이 "참고 사항"과 "유의 사항"에 두 번 나오지 않게(체크포인트에 이미 있는 줄은 뺀다)
  const seen = new Set(p.checkpoints);
  const uniq = ls => ls.filter(l => !seen.has(l));
  const precautions = uniq(p.precautions);
  const hasPeriod = rows => rows.some(r => r.start || r.end);
  const priceTables = (day, hol, dates) => {
    const out = [];
    if (day.length) {
      const per = hasPeriod(day), cols = per ? 3 : 2;
      out.push(`<table class="rate"><thead><tr><th>출발 요일</th>${per ? '<th>적용 기간</th>' : ''}<th>1인 요금</th></tr></thead><tbody>${day.map(d => d.g ? `<tr><th colspan="${cols}">${esc(d.g)}</th></tr>` : `<tr><td>${esc(d.day)}</td>${per ? `<td>${esc([d.start, d.end].filter(Boolean).join(' ~ ').replace(/-/g, '.'))}</td>` : ''}<td>${won(d.price)}</td></tr>`).join('')}</tbody></table>`);
    }
    if (hol.length) out.push(`<table class="rate"><thead><tr><th>공휴일·지정일</th><th>1인 요금</th></tr></thead><tbody>${hol.map(h => `<tr><td>${esc(h.date + (h.end ? ' ~ ' + h.end : ''))}</td><td>${won(h.price)}</td></tr>`).join('')}</tbody></table>`);
    if (dates.length) out.push(`<p class="muted">지정 출발일: ${esc(dates.join(', '))}</p>`);
    return out.join('');
  };
  const entryHtml = p.entries.map(e => {
    const parts = [];
    const meta = [e.rounds && `라운드 ${e.rounds}`, e.stay && `숙박 ${e.stay}`, e.meals && `식사 ${e.meals}`, e.minPeople && `최소 ${e.minPeople}명`].filter(Boolean).join(' · ');
    if (meta) parts.push(`<p class="muted">${esc(meta)}</p>`);
    parts.push(priceTables(e.dayPrices, e.holidayPrices, e.dates));
    const block = (label, ls) => ls.length ? `<h3>${label}</h3>${ls.map(l => `<p class="l">${esc(l)}</p>`).join('')}` : '';
    parts.push(block('포함 사항', e.included), block('불포함 사항', e.notIncluded), block('유의 사항', e.precautions));
    return `<div class="entry"><h3>${esc(e.headline || '요금 항목')}${e.price > 0 ? ` — <span class="price">${won(e.price)}<small>${e.fromLabel ? ' ~부터' : ''}</small></span>` : ''}</h3>${parts.join('')}</div>`;
  }).join('');

  const kv = (label, facts) => facts.length ? `<table class="facts"><tbody>${facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '';
  const places = (items, label) => items.length ? `<h2>${label}</h2>${items.map(i => `<div class="card"><h3 style="margin-top:0">${esc(i.name)}</h3>${kv('', i.facts) || '<p class="muted">등록된 상세 정보가 없습니다.</p>'}</div>`).join('')}` : '';
  const textBlock = (h, ls) => ls.length ? `<h2>${h}</h2><div class="card">${ls.map(l => `<p class="l">${esc(l)}</p>`).join('')}</div>` : '';
  const alt = (img, i) => `${p.catKo} ${p.title} — ${img.caption ? `${img.caption} ${i + 1}` : `골프 패키지 이미지 ${i + 1}`}`;
  const gallery = p.images.length ? `<h2>사진</h2><div class="gallery">${p.images.slice(0, 12).map((img, i, arr) => `<figure><img src="${esc(img.url)}" alt="${esc(alt(img, i))}" loading="lazy" decoding="async" width="640" height="400">${img.caption && (i === 0 || arr[i - 1].caption !== img.caption) ? `<figcaption>${esc(img.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : '';
  const hero = p.images[0] ? `<img class="hero" src="${esc(p.images[0].url)}" alt="${esc(alt(p.images[0], 0))}" fetchpriority="high" decoding="async">` : '';

  const body = `<h1>${esc(p.title)}</h1>
<p class="lead">${[p.catKo, p.monthsTag && `추천 시기 ${p.monthsTag}`].filter(Boolean).map(esc).join(' · ')}</p>
${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
${hero}
<h2>한눈에 보기</h2><div class="card"><table class="facts"><tbody>${rows.join('')}</tbody></table></div>
${p.checkpoints.length ? `<div class="card">${p.checkpoints.map(l => `<p class="l">${esc(l)}</p>`).join('')}</div>` : ''}
${cta(p, data)}
${(p.entries.length || p.commonDayPrices.length || p.commonHolidayPrices.length) ? `<h2>요금 안내</h2><div class="card">${entryHtml}${(!p.entries.length) ? priceTables(p.commonDayPrices, p.commonHolidayPrices, p.commonDates) : ''}</div>` : ''}
${places(p.courses, '골프장 정보')}${places(p.lodges, '숙소 정보')}
${textBlock('포함 사항', p.included)}${textBlock('불포함 사항', p.notIncluded)}${textBlock('참고 사항', p.notes)}${textBlock('유의 사항', precautions)}${textBlock('예약·취소 안내', p.booking)}
${gallery}
${cta(p, data)}`;

  const image = p.images[0] ? p.images[0].url : '/assets/og-thumbnail.jpg';
  const low = lowestPrice(p);
  const offers = low > 0 ? {
    '@type': 'AggregateOffer', priceCurrency: 'KRW', lowPrice: low, offerCount: Math.max(1, priced.length),
    ...(priced.length ? { offers: priced.map(e => ({ '@type': 'Offer', name: e.headline || '요금 항목', price: e.price, priceCurrency: e.currency, url })) } : {}),
    seller: { '@type': 'Organization', name: '(주)더골프트렌드', url: ORIGIN + '/' }
  } : undefined;
  const props = [['일정', p.nightsCount], ['골프 라운드', p.rounds], ['숙박', p.stay], ['숙소 위치', p.lodge], ['식사', p.meals], ['항공', p.airfare], ['추천 판매 시기', p.monthsTag], ['최소 출발 인원', p.minPeople ? `${p.minPeople}명 이상` : '']]
    .filter(([, v]) => v).map(([name, value]) => ({ '@type': 'PropertyValue', name, value }));
  const product = { '@context': 'https://schema.org', '@type': 'Product', '@id': url + '#product', name: titleFull(p), description: descOf(p), url, sku: code,
    image: p.images.slice(0, 6).map(i => abs(i.url)), category: `${regionName(p.region)} > ${p.catKo}`, brand: { '@type': 'Brand', name: 'THE GOLF TREND' },
    ...(props.length ? { additionalProperty: props } : {}), ...(offers ? { offers } : {}) };

  const crumbs = [{ name: '홈', path: '/' }, { name: regionName(p.region), path: `/golf/${p.region}/` }, { name: p.catKo, path: `/golf/${p.catId}/` }, { name: titleFull(p), path: pagePath }];
  return { path: pagePath, html: layout({ title: `${titleFull(p)} | ${p.catKo} 골프여행 패키지 - THE GOLF TREND`, description: descOf(p), canonicalPath: pagePath, ogImage: image, jsonLd: product, body, crumbs, data, stateDate }) };
}

function listItems(ps) {
  return `<ul class="list">${ps.map(p => `<li><a href="${urlProduct(p.catId, codeOf(p.uid))}"><span class="t">${esc(titleFull(p))}</span><span class="m">${esc([p.nightsCount, p.rounds, p.lodge].filter(Boolean).join(' · '))}</span><span class="p">${esc(priceText(p))}</span></a></li>`).join('')}</ul>`;
}

function listPage({ pathName, title, h1, lead, sections, crumbs, data, stateDate, image, ldItems }) {
  const body = `<h1>${esc(h1)}</h1><p class="lead">${esc(lead)}</p>${sections}`;
  const itemList = { '@context': 'https://schema.org', '@type': 'ItemList', name: h1, numberOfItems: ldItems.length, itemListElement: ldItems.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: titleFull(p), url: ORIGIN + urlProduct(p.catId, codeOf(p.uid)) })) };
  return { path: pathName, html: layout({ title, description: clip(lead, 150), canonicalPath: pathName, ogImage: image || '/assets/og-thumbnail.jpg', jsonLd: itemList, body, crumbs, data, stateDate }) };
}

function build(data, stateDate) {
  const pages = [];
  const all = data.products;
  const by = { overseas: all.filter(p => p.region === 'overseas'), domestic: all.filter(p => p.region === 'domestic') };
  const catName = id => (data.cats.overseas.concat(data.cats.domestic).find(c => c.id === id) || {}).ko || id;
  all.forEach(p => pages.push(productPage(p, data, stateDate)));
  const sectionsFor = (region, ps) => data.cats[region].filter(c => ps.some(p => p.catId === c.id)).map(c => `<h2><a href="/golf/${c.id}/" style="color:inherit;text-decoration:none">${esc(c.ko)}</a></h2>${c.tagline ? `<p class="muted">${esc(c.tagline)}</p>` : ''}${listItems(ps.filter(p => p.catId === c.id))}`).join('');
  const img = ps => (ps.find(p => p.images[0]) || { images: [{ url: '/assets/og-thumbnail.jpg' }] }).images[0].url;

  ['overseas', 'domestic'].forEach(region => {
    const ps = by[region]; if (!ps.length) return;
    pages.push(listPage({ pathName: `/golf/${region}/`, title: `${regionName(region)} 패키지 ${ps.length}개 | THE GOLF TREND`, h1: `${regionName(region)} 골프 패키지`,
      lead: `THE GOLF TREND가 상담·예약을 받는 ${regionName(region)} 골프 패키지 ${ps.length}개입니다. 요금·일정은 상품 페이지에서 확인하세요.`,
      sections: sectionsFor(region, ps), crumbs: [{ name: '홈', path: '/' }, { name: regionName(region), path: `/golf/${region}/` }], data, stateDate, image: img(ps), ldItems: ps }));
  });
  data.cats.overseas.concat(data.cats.domestic).forEach(c => {
    const ps = all.filter(p => p.catId === c.id); if (!ps.length) return;
    const region = ps[0].region;
    pages.push(listPage({ pathName: `/golf/${c.id}/`, title: `${c.ko} 골프여행 패키지 ${ps.length}개 | THE GOLF TREND`, h1: `${c.ko} 골프여행 패키지`,
      lead: `${c.tagline ? c.tagline + ' — ' : ''}${c.ko} 골프 패키지 ${ps.length}개의 일정·요금·포함 사항을 확인하세요.`,
      sections: listItems(ps), crumbs: [{ name: '홈', path: '/' }, { name: regionName(region), path: `/golf/${region}/` }, { name: c.ko, path: `/golf/${c.id}/` }], data, stateDate, image: img(ps), ldItems: ps }));
  });
  pages.push(listPage({ pathName: '/golf/', title: `골프 패키지 전체 ${all.length}개 — 국내·해외 골프여행 | THE GOLF TREND`, h1: '국내·해외 골프 패키지 전체 목록',
    lead: `(주)더골프트렌드가 상담·예약을 받는 국내·해외 골프여행 패키지 ${all.length}개입니다. 상품마다 일정·요금·포함 사항·골프장과 숙소 정보를 확인할 수 있습니다.`,
    sections: ['overseas', 'domestic'].filter(r => by[r].length).map(r => `<h2><a href="/golf/${r}/" style="color:inherit;text-decoration:none">${regionName(r)}</a></h2>${data.cats[r].filter(c => by[r].some(p => p.catId === c.id)).map(c => `<h3><a href="/golf/${c.id}/">${esc(c.ko)}</a></h3>${listItems(by[r].filter(p => p.catId === c.id))}`).join('')}`).join(''),
    crumbs: [{ name: '홈', path: '/' }, { name: '골프 패키지 전체', path: '/golf/' }], data, stateDate, image: img(all), ldItems: all }));
  return pages;
}

function sitemap(pages, stateDate) {
  const rank = p => p.path === '/golf/' ? 0 : (/^\/golf\/(overseas|domestic)\/$/.test(p.path) ? 1 : (p.path.split('/').length === 4 ? 2 : 3));
  const sorted = pages.slice().sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  const urls = [{ loc: ORIGIN + '/', lastmod: stateDate }].concat(sorted.map(p => ({ loc: ORIGIN + p.path, lastmod: stateDate })));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- 자동 생성: scripts/build-seo-pages.js — 직접 고치지 마세요(다음 실행 때 덮어씁니다) -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

(async () => {
  const state = await loadSiteState();
  const stateDate = kstDate(state.updated_at || new Date().toISOString());
  const data = await extract(state);
  if (!data.products.length) throw new Error('노출할 상품이 0개입니다 — 데이터를 확인하세요(기존 페이지는 건드리지 않고 중단)');
  const pages = build(data, stateDate);
  // 안전장치: 데이터를 일부만 받아 와서 기존 상품 페이지가 대량으로 사라지는 일을 막는다(정말 줄이려면 SEO_ALLOW_SHRINK=1)
  const prev = fs.existsSync(OUT) ? fs.readdirSync(OUT, { withFileTypes: true }).filter(d => d.isDirectory()).reduce((n, d) => n + fs.readdirSync(path.join(OUT, d.name), { withFileTypes: true }).filter(x => x.isDirectory()).length, 0) : 0;
  if (prev >= 4 && data.products.length < prev / 2 && !process.env.SEO_ALLOW_SHRINK) throw new Error(`상품이 ${prev}개에서 ${data.products.length}개로 절반 넘게 줄어 중단합니다(의도한 것이면 SEO_ALLOW_SHRINK=1로 다시 실행)`);
  fs.rmSync(OUT, { recursive: true, force: true });
  pages.forEach(p => { const f = path.join(ROOT, p.path, 'index.html'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, p.html); });
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap(pages, stateDate));
  const cnt = { overseas: data.products.filter(p => p.region === 'overseas').length, domestic: data.products.filter(p => p.region === 'domestic').length };
  console.log(`상품 ${data.products.length}개(해외 ${cnt.overseas} · 국내 ${cnt.domestic}) → 페이지 ${pages.length}개, 기준일 ${stateDate}`);
})().catch(e => { console.error('생성 실패:', e.message); process.exit(1); });
