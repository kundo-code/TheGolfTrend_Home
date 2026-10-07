// THE GOLF TREND — 블로그·유튜브 "전체 글 목록" 수집 서버 (Cloudflare Worker)
//
// 기존 프록시(mode=rss / mode=og)와는 별개의 새 Worker로 배포합니다. 기존 프록시는 그대로 둡니다.
// 설정 방법은 docs/channel-collection-setup.md 를 참고하세요.
//
// 제공 기능 (모두 GET, 응답은 JSON)
//   ?mode=ping                                   → 연결 확인 { ok, youtube:true|false }
//   ?mode=ytlist&channel=UC...&pageToken=...     → 유튜브 채널 업로드 영상 50개씩 { items, nextPageToken, total }
//   ?mode=naverlist&blogId=아이디&page=1          → 네이버 블로그 글 목록 { items, page, total, source }
//   ?mode=navercats&blogId=아이디                 → (진단용) 블로그 카테고리 구조 { categories:[{no,name,parent,path}] }
//
// items 형식: [{ id, link, title, thumbnail, published(ISO 문자열), category }]
//   category: 네이버 블로그 카테고리. 상위 카테고리가 있으면 "상위 > 하위" (예: "해외 패키지 여행 > 중국"), 없으면 빈 문자열
//
// 환경 변수(Settings → Variables and Secrets)
//   YOUTUBE_API_KEY  (Secret, 필수 — 유튜브 수집용)  Google Cloud에서 발급한 YouTube Data API v3 키
//   ALLOWED_ORIGINS  (선택) 쉼표로 구분한 허용 사이트 주소. 예) https://thegolftrend.co.kr,https://www.thegolftrend.co.kr
//                    지정하면 다른 사이트에서 이 수집 서버(와 API 키 사용량)를 쓰지 못하게 막습니다.
//
// ⚠ 네이버 블로그에는 "글 목록" 공식 API가 없어, 네이버 모바일 블로그가 내부적으로 쓰는 목록 주소를 사용합니다.
//   네이버가 이 주소를 바꾸면 동작이 멈출 수 있습니다(그 경우 홈페이지는 자동으로 RSS 최신 글 방식으로 대체됩니다).

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin = !allowed.length ? '*' : (allowed.includes(origin) ? origin : '');
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin || 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200, maxAge = 300) => new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
    });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (allowed.length && origin && !allowOrigin) return json({ error: 'origin not allowed' }, 403, 0);

    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || '';
    try {
      if (mode === 'ping') return json({ ok: true, youtube: !!env.YOUTUBE_API_KEY }, 200, 0);
      if (mode === 'ytlist') return await youtubeList(url, env, json);
      if (mode === 'naverlist') return await naverList(url, json);
      if (mode === 'navercats') return await naverCats(url, json);
      return json({ error: 'unknown mode' }, 400, 0);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502, 0);
    }
  },
};

// ── 유튜브: 채널의 "업로드" 재생목록(UC... → UU...)을 50개씩 ─────────────────
async function youtubeList(url, env, json) {
  const channel = url.searchParams.get('channel') || '';
  if (!/^UC[\w-]{20,}$/.test(channel)) return json({ error: 'invalid channel id (UC...로 시작해야 합니다)' }, 400, 0);
  if (!env.YOUTUBE_API_KEY) return json({ error: 'YOUTUBE_API_KEY가 설정되지 않았습니다' }, 500, 0);
  const api = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  api.searchParams.set('part', 'snippet');
  api.searchParams.set('maxResults', '50');
  api.searchParams.set('playlistId', 'UU' + channel.slice(2));
  api.searchParams.set('key', env.YOUTUBE_API_KEY);
  const pageToken = url.searchParams.get('pageToken');
  if (pageToken) api.searchParams.set('pageToken', pageToken);
  const r = await fetch(api.toString());
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: (d.error && d.error.message) || ('YouTube HTTP ' + r.status) }, 502, 0);
  const items = (d.items || []).map(it => {
    const s = it.snippet || {};
    const vid = s.resourceId && s.resourceId.videoId;
    if (!vid || s.title === 'Private video' || s.title === 'Deleted video') return null;
    const th = s.thumbnails || {};
    return {
      id: vid,
      link: 'https://www.youtube.com/watch?v=' + vid,
      title: s.title || '',
      thumbnail: (th.medium || th.high || th.default || {}).url || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
      published: s.publishedAt || '',
    };
  }).filter(Boolean);
  return json({ items, nextPageToken: d.nextPageToken || '', total: (d.pageInfo || {}).totalResults || 0 });
}

// ── 네이버 블로그: 글 목록 30개씩 (모바일 목록 → 실패 시 PC 제목 목록) ────────────
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 진단용: 이 블로그의 카테고리 구조(번호·이름·상위 번호·"상위 > 하위" 경로)를 그대로 보여줌
async function naverCats(url, json) {
  const blogId = url.searchParams.get('blogId') || '';
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(blogId)) return json({ error: 'invalid blogId' }, 400, 0);
  const cats = await naverCategoryMap(blogId, UA_MOBILE, UA_PC);
  const categories = Object.keys(cats).map(no => ({ no, name: cats[no].name, parent: cats[no].parent, path: naverCatPath(cats, no).join(' > ') }));
  return json({ categories }, 200, 0);
}

async function naverList(url, json) {
  const blogId = url.searchParams.get('blogId') || '';
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(blogId)) return json({ error: 'invalid blogId' }, 400, 0);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const categoryNo = /^\d+$/.test(url.searchParams.get('categoryNo') || '') ? url.searchParams.get('categoryNo') : '0';
  const linkOf = logNo => `https://blog.naver.com/${blogId}/${logNo}`;
  let firstError = '';
  // 카테고리 번호 → {이름, 상위 번호}. 글 목록에는 가장 아래 단계 이름만 있는 경우가 많아서, 상위 카테고리까지 이어
  // "상위 > 하위"로 만든다. 실패해도 목록은 계속 진행(그 경우 아래 단계 이름만 내려감)
  const catMap = await naverCategoryMap(blogId, UA_MOBILE, UA_PC);
  const catOf = it => {
    const parts = naverCatPath(catMap, it.categoryNo);
    return parts.length ? parts.join(' > ') : stripTags(safeDecode(String(it.categoryName || '')));
  };

  // 1) 모바일 블로그 목록(JSON)
  try {
    const r = await fetch(`https://m.blog.naver.com/api/blogs/${blogId}/post-list?categoryNo=${categoryNo}&itemCount=30&page=${page}`, {
      headers: { 'User-Agent': UA_MOBILE, 'Referer': `https://m.blog.naver.com/${blogId}`, 'Accept': 'application/json' },
    });
    if (r.ok) {
      const d = await r.json();
      const res = (d && d.result) || {};
      const list = Array.isArray(res.items) ? res.items : [];
      if (d && d.isSuccess !== false) {
        const items = list.filter(it => it && it.logNo).map(it => ({
          id: String(it.logNo),
          link: linkOf(it.logNo),
          title: stripTags(it.titleWithInspectMessage || it.title || ''),
          thumbnail: fixNaverThumb(it.thumbnailUrl || (it.thumbnailList && it.thumbnailList[0] && it.thumbnailList[0].url) || ''),
          published: toIso(it.addDate),
          category: catOf(it),
        }));
        return json({ items, page, total: Number(res.totalCount) || 0, source: 'm-api' });
      }
    } else firstError = 'm-api HTTP ' + r.status;
  } catch (e) { firstError = 'm-api ' + ((e && e.message) || e); }

  // 2) PC 블로그 제목 목록 — 응답이 엄격한 JSON이 아니어서(\' 등) 정리 후 파싱
  const r2 = await fetch(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${page}&categoryNo=${categoryNo}&parentCategoryNo=&countPerPage=30`, {
    headers: { 'User-Agent': UA_PC, 'Referer': `https://blog.naver.com/${blogId}` },
  });
  if (!r2.ok) return json({ error: `${firstError || ''} / title-list HTTP ${r2.status}`.trim() }, 502, 0);
  const txt = (await r2.text()).replace(/\\'/g, "'");
  const d2 = JSON.parse(txt);
  const list2 = Array.isArray(d2.postList) ? d2.postList : [];
  const items = list2.filter(it => it && it.logNo).map(it => ({
    id: String(it.logNo),
    link: linkOf(it.logNo),
    title: stripTags(safeDecode(it.title || '')),
    thumbnail: '',
    published: toIso(it.addDate),
    category: catOf(it),
  }));
  return json({ items, page, total: Number(d2.totalCount) || 0, source: 'title-list' });
}

// 네이버 블로그 카테고리 목록 → { 카테고리번호: {name, parent(상위 번호, 최상위면 빈 문자열)} }.
// 응답 구조가 달라져도 견디도록 categoryNo/categoryName 짝을 찾아 모으고, 상위는 parentCategoryNo 또는 "하위 목록 안에 들어 있음"으로 판단한다
async function naverCategoryMap(blogId, UA_MOBILE, UA_PC) {
  const cats = {};
  const walk = (o, ctx, depth) => {
    if (!o || depth > 8) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, ctx, depth + 1)); return; }
    if (typeof o !== 'object') return;
    let here = ctx;
    const name = o.categoryName || o.categoryname;
    if (o.categoryNo != null && name) {
      const no = String(o.categoryNo);
      const pn = o.parentCategoryNo != null && String(o.parentCategoryNo) !== '' && String(o.parentCategoryNo) !== '0' ? String(o.parentCategoryNo) : (ctx || '');
      cats[no] = { name: stripTags(safeDecode(String(name))), parent: pn && pn !== no ? pn : '' };
      here = no;
    }
    Object.keys(o).forEach(k => walk(o[k], here, depth + 1));
  };
  const tryFetch = async (url, ua, ref) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua, 'Referer': ref, 'Accept': 'application/json' } });
      if (!r.ok) return false;
      walk(JSON.parse((await r.text()).replace(/\\'/g, "'")), '', 0);
      return Object.keys(cats).length > 0;
    } catch (e) { return false; }
  };
  if (!(await tryFetch(`https://m.blog.naver.com/api/blogs/${blogId}/category-list`, UA_MOBILE, `https://m.blog.naver.com/${blogId}`))) {
    await tryFetch(`https://blog.naver.com/CategoryList.naver?blogId=${blogId}&from=postList&isMobile=false`, UA_PC, `https://blog.naver.com/${blogId}`);
  }
  return cats;
}
// 카테고리 번호 → ["최상위", ..., "해당 카테고리"] 이름 목록
function naverCatPath(cats, no) {
  const parts = []; let cur = String(no), guard = 0;
  while (cur && cats[cur] && guard++ < 6) { parts.unshift(cats[cur].name); cur = cats[cur].parent; }
  return parts;
}
function safeDecode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } }
function stripTags(s) { return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
// 목록용 작은 썸네일(type=w80 등)을 카드용 크기로
function fixNaverThumb(u) { return u ? String(u).replace(/([?&])type=[^&]*/, '$1type=w800') : ''; }
// addDate: 숫자(ms) · "2026. 10. 7." · "3시간 전" 등 → ISO (해석 불가 시 빈 값)
function toIso(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v); return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const m = String(v).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 3)).toISOString(); // KST 정오 근처
  const rel = String(v).match(/(\d+)\s*(분|시간|일)\s*전/);
  if (rel) { const unit = { '분': 6e4, '시간': 36e5, '일': 864e5 }[rel[2]]; return new Date(Date.now() - (+rel[1]) * unit).toISOString(); }
  const t = Date.parse(v); return isNaN(t) ? '' : new Date(t).toISOString();
}
