/* THE GOLF TREND — 관리자 패널 "상담·예약" (상담·예약 데이터 통합)
 * 관리자 패널의 상담·예약 탭을 열 때만 불러온다(index.html의 tgtLoadCrm). 홈페이지 방문자에게는 내려가지 않는다.
 * index.html의 전역 함수·데이터를 그대로 재사용한다: getSupabaseClient, adminSession, CATEGORIES, getProducts,
 * productOverrides, STYLE_OPTIONS, STYLE_KEYWORDS, escapeAttr 등.
 * DB: docs/sql/2026-10-24_crm_core.sql (tgt_* 테이블, 허용된 관리자만 접근)
 */
(function(){
  'use strict';

  const TABLES = {
    admins: 'tgt_admins',
    consultations: 'tgt_consultations',
    revisions: 'tgt_consultation_revisions',
    bookings: 'tgt_bookings',
    bookingHistory: 'tgt_booking_status_history',
    imports: 'tgt_booking_imports',
    links: 'tgt_link_suggestions',
    rules: 'tgt_product_operating_rules',
    groups: 'tgt_departure_groups',
    events: 'tgt_site_events',
    accessLogs: 'tgt_admin_access_logs',
  };
  const LEADS_TABLE_NAME = 'kundo_leads';
  const SQL_FILE = 'docs/sql/2026-10-24_crm_core.sql';

  const SUBS = [
    ['quick',    '✍️ 빠른 기록'],
    ['list',     '📋 상담 목록'],
    ['bookings', '🧾 예약'],
    ['links',    '🔗 연결 승인'],
    ['stats',    '📊 통계'],
    ['intel',    '💡 기획·운영 진단'],
    ['ops',      '🚐 운영 조건·출발 그룹'],
    ['check',    '🔧 연결 점검'],
  ];

  // ── 선택 목록(상담 결과·사유·경로 등) ─────────────────────────────
  const RESULTS = ['예약확정','예약진행중','보류','미예약','단순문의'];
  const RESULT_CLS = {'예약확정':'ok','예약진행중':'go','보류':'hold','미예약':'no','단순문의':'info'};
  const REASONS = ['가격','일정 불일치','인원 미달','소인원 추가요금','원하는 상품 없음','타사 예약','연락 두절','기타'];
  const CHANNELS = ['전화','카카오톡','문자','홈페이지','방문','기타'];
  const GROUP_TYPES = ['일반','가족·부부','친목','동호회','기업','기타'];
  const FLEX = ['가능','어려움','미확인'];
  const JOIN_PREF = ['합류 가능','단독 희망','미확인'];
  const PARTY_BARRIERS = ['최소 출발 인원 미달','소인원 추가요금','객실 배정(홀수 인원)','인원 확정 지연','기타'];
  // 고객 핵심 취향 — 홈페이지 AI 추천의 스타일 14종을 그대로 쓰고, 상담에서 자주 나오는 표현을 더한다
  const EXTRA_PREFS = ['풍경·경관','가성비','프리미엄','짧은 이동','온천','명문 코스','여유로운 일정','특별한 취향 없음'];
  // 상담에서 고객이 쓰는 표현 → 취향(정규식). "비싸다"가 가성비로 잡히지 않도록 앞 글자를 확인한다
  const PREF_PATTERNS = [
    ['풍경·경관', /풍경|경치|경관|뷰|바다|오션|전망|자연/],
    ['가성비', /가성비|저렴|(?<!비)싸(?!움)|합리적/],
    ['프리미엄', /고급|프리미엄|럭셔리|5성|최고급/],
    ['짧은 이동', /이동\s*(이|시간)?\s*짧|가까운|이동\s*(이\s*)?적|근거리|직항/],
    ['온천', /온천|스파/],
    ['명문 코스', /명문|챔피언|토너먼트/],
    ['여유로운 일정', /여유|느긋|휴양|힐링/],
    ['골프텔 (체류형)', /골프텔|체류형/],
    ['시내 호텔 (이동형)', /시내\s*호텔|시내에|도심/],
    ['골프장 內 숙박', /골프장\s*(내|안|內)\s*(숙박|숙소)?|골프장\s*숙박/],
    ['골프장 外 숙박', /골프장\s*(밖|외|外)|외부\s*숙소/],
    ['미식 및 주변 관광 중심', /관광|맛집|미식|먹거리/],
    ['미식 및 쇼핑 중심', /쇼핑/],
    ['골프장 퀄리티 중시', /퀄리티|잔디|그린\s*관리|코스\s*(가|이)?\s*좋/],
    ['숙박 시설 중시 (5성급 준)', /숙소\s*(가|는)?\s*좋|호텔\s*(이|은)?\s*좋|숙박\s*중시/],
    ['어려운 골프장 선호', /어려운\s*(코스|골프장)|난이도\s*높/],
    ['쉬운 골프장 선호', /쉬운\s*(코스|골프장)|초보|편한\s*코스/],
    ['올인원 패키지 (그린피·숙박·식사·카트·캐디피)', /올인원|다\s*포함|전부\s*포함/],
    ['실속형 (그린피·숙박·2일차 조식)', /실속/],
    ['특가 (그린피·숙박)', /특가/],
  ];
  // 국가·권역 별칭(지명) — 상품명에 없는 지명도 국가로 분류
  const PLACE_ALIASES = {
    japan:['일본','후쿠오카','오키나와','홋카이도','삿포로','미야자키','가고시마','구마모토','오사카','도쿄','시즈오카','나고야','큐슈','규슈','아오모리','니가타'],
    china:['중국','계림','구이린','하이난','상해','상하이','칭다오','청도','웨이하이','위해','연태','옌타이','곤명','쿤밍','해남','심천','선전'],
    mongolia:['몽골','울란바토르'],
    vietnam:['베트남','다낭','나트랑','냐짱','하노이','호치민','푸꾸옥','달랏','하롱'],
    thailand:['태국','방콕','파타야','치앙마이','후아힌','푸켓','칸차나부리'],
    philippines:['필리핀','세부','클락','마닐라','보라카이','바기오'],
    malaysia:['말레이시아','조호바루','코타키나발루','쿠알라룸푸르','랑카위'],
    indonesia:['인도네시아','발리','바탐','빈탄','자카르타'],
    guam:['괌','사이판'],
    gangwon:['강원','평창','홍천','춘천','원주','속초','강릉','정선'],
    chungcheong:['충청','충북','충남','대전','세종','청주','천안','충주','태안'],
    honam:['호남','전라','전북','전남','광주','여수','순천','해남','무안','군산','고창','영암'],
    yeongnam:['영남','경상','경북','경남','부산','대구','울산','경주','거제','남해','통영','김해','포항'],
    capital:['수도권','경기','서울','인천','용인','이천','여주','포천','가평'],
    jeju:['제주','서귀포'],
  };
  const GENERIC_TOKENS = new Set(['골프','골프장','투어','여행','패키지','리조트','호텔','코스','클럽','컨트리','라운드','일정','특가','상품','국내','해외','명문','프리미엄','CC','GC','cc','gc']);
  const KO_NUM = {'한':1,'하나':1,'두':2,'둘':2,'세':3,'셋':3,'네':4,'넷':4,'다섯':5,'여섯':6,'일곱':7,'여덟':8,'아홉':9,'열':10};

  const state = {
    root:null, sub:'quick', ready:null, readyChecked:false,
    form:null, editId:null, parentId:null, leadId:null, lastParse:null, saving:false, flash:'',
    list:[], listLoaded:false, listFilter:{q:'', result:'', period:'90'}, openHistory:{},
  };
  const DRAFT_KEY = 'tgt_crm_quick_draft_v1';

  // ── 공통 도우미 ──────────────────────────────────────────────
  const esc = v => escapeAttr(String(v==null ? '' : v));
  const sb = () => getSupabaseClient();
  const KST_FMT = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
  function fmtKst(ts){ if (!ts) return ''; const d = new Date(ts); return isNaN(d) ? '' : KST_FMT.format(d); }
  // 오늘(한국 시간) {y, m, d}
  function todayKst(){
    const p = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date()).split('-').map(Number);
    return {y:p[0], m:p[1], d:p[2]};
  }
  const pad2 = n => String(n).padStart(2,'0');
  function fmtMonth(dateStr){ if (!dateStr) return ''; const m = /^(\d{4})-(\d{2})/.exec(dateStr); return m ? `${m[1]}년 ${Number(m[2])}월` : ''; }
  function fmtDate(dateStr){ if (!dateStr) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr); return m ? `${m[1]}.${m[2]}.${m[3]}` : ''; }
  function isMissingTableError(err){
    if (!err) return false;
    const m = String(err.message||'') + ' ' + String(err.code||'');
    return /does not exist|42P01|PGRST205|PGRST202|Could not find/i.test(m);
  }
  function errText(e){ return (e && (e.message || e.error_description)) || String(e||'알 수 없는 오류'); }
  // 등록된 모든 상품(국내·해외) — 고유번호·분류 스냅샷과 함께
  function allProducts(){
    const out = [];
    ['overseas','domestic'].forEach(region=>{
      (CATEGORIES[region]||[]).forEach(cat=>{
        (getProducts(cat.id)||[]).forEach((p, idx)=>{
          out.push({uid:p.uid, title:p.title||'', catId:cat.id, catKo:cat.ko, region, idx, p, persisted: productOverrides[cat.id]!==undefined});
        });
      });
    });
    return out;
  }
  function catInfo(catId){
    for (const region of ['overseas','domestic']){
      const c = (CATEGORIES[region]||[]).find(x=>x.id===catId);
      if (c) return {id:c.id, ko:c.ko, region};
    }
    return null;
  }
  function productByUid(uid){ return uid ? allProducts().find(x=>x.uid===uid) || null : null; }
  async function logAccess(action, target, detail){
    try{ await sb().from(TABLES.accessLogs).insert({action, target:target||null, detail:detail||null}); }catch(e){}
  }

  // ── 스타일(한 번만 주입) ───────────────────────────────────────
  function injectStyle(){
    if (document.getElementById('tgtCrmStyle')) return;
    const st = document.createElement('style');
    st.id = 'tgtCrmStyle';
    st.textContent = `
      .crm-wrap{display:flex;flex-direction:column;gap:14px}
      .crm-subnav{display:flex;flex-wrap:wrap;gap:6px}
      .crm-subnav button{border:none;border-radius:100px;padding:7px 12px;font-size:.78rem;font-weight:700;cursor:pointer;background:var(--nm-surface-light,#eef1f6);color:var(--nm-text,#0a1730);box-shadow:var(--nm-shadow-raised-sm)}
      .crm-subnav button.active{background:var(--nm-gold-grad,#c9a45c);color:#fff}
      .crm-card{background:var(--nm-surface,#fff);border-radius:14px;padding:14px 16px;box-shadow:var(--nm-shadow-raised-sm)}
      .crm-card h5{margin:0 0 10px;font-size:.9rem;font-weight:800;color:var(--nm-text,#0a1730)}
      .crm-note{font-size:.76rem;color:var(--nm-text-soft,#5b6577);line-height:1.55}
      .crm-banner{padding:12px 14px;border-radius:12px;font-size:.8rem;line-height:1.6}
      .crm-banner.warn{background:#FFF4E5;color:#8A4B00;border:1px solid #F5C77E}
      .crm-banner.ok{background:#EAF7EE;color:#14532D;border:1px solid #9FD8B2}
      .crm-banner.err{background:#FDECEC;color:#8B1D1D;border:1px solid #F3B4B4}
      .crm-banner code{background:rgba(0,0,0,.06);padding:1px 5px;border-radius:5px}
      .crm-check-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
      .crm-check-list li{display:flex;align-items:center;gap:8px;font-size:.8rem}
      .crm-check-list .ic{width:20px;text-align:center}
      .crm-check-list .sub{color:var(--nm-text-soft,#5b6577);font-size:.74rem}
      .crm-empty{padding:18px;text-align:center;color:var(--nm-text-soft,#5b6577);font-size:.82rem}
      .crm-memo-row{display:flex;gap:8px;align-items:stretch}
      .crm-memo-row textarea{flex:1;min-width:0;min-height:54px;resize:vertical;padding:10px 12px;border:none;border-radius:12px;background:var(--nm-white,#fff);box-shadow:var(--nm-shadow-inset);font-size:.92rem;font-family:inherit;line-height:1.5}
      .crm-memo-btns{display:flex;flex-direction:column;gap:6px}
      .crm-btn{border:none;border-radius:10px;padding:8px 12px;font-size:.78rem;font-weight:700;cursor:pointer;background:var(--nm-surface-light,#eef1f6);color:var(--nm-text,#0a1730);box-shadow:var(--nm-shadow-raised-sm);white-space:nowrap}
      .crm-btn.primary{background:var(--nm-gold-grad,#c9a45c);color:#fff}
      .crm-btn.danger{color:#C0262D}
      .crm-btn.rec{background:#C0262D;color:#fff;animation:crmPulse 1.2s infinite}
      .crm-btn:disabled{opacity:.5;cursor:default}
      @keyframes crmPulse{50%{opacity:.6}}
      .crm-parse{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .crm-parse .pc{font-size:.72rem;padding:4px 9px;border-radius:100px;background:rgba(47,111,237,.1);color:#1d4ed8;font-weight:700}
      .crm-parse .pc.miss{background:rgba(10,23,48,.06);color:var(--nm-text-soft,#5b6577);font-weight:600}
      .crm-field{display:flex;flex-direction:column;gap:6px;margin-top:12px}
      .crm-field > label{font-size:.74rem;font-weight:800;color:var(--nm-text-soft,#5b6577);letter-spacing:.04em}
      .crm-field > label .req{color:#C0262D;margin-left:3px}
      .crm-field select,.crm-field input[type=text],.crm-field input[type=number],.crm-field input[type=date],.crm-field input[type=month],.crm-field input[type=tel],.crm-field textarea{width:100%;padding:9px 11px;border:none;border-radius:10px;background:var(--nm-white,#fff);box-shadow:var(--nm-shadow-inset);font-size:.86rem;font-family:inherit;box-sizing:border-box}
      .crm-chips{display:flex;flex-wrap:wrap;gap:6px}
      .crm-chip{border:1px solid rgba(10,23,48,.12);background:var(--nm-white,#fff);border-radius:100px;padding:6px 11px;font-size:.76rem;font-weight:600;cursor:pointer;color:var(--nm-text,#0a1730)}
      .crm-chip.on{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
      .crm-chip.r-ok.on{background:#15803d;border-color:#15803d}
      .crm-chip.r-hold.on{background:#b45309;border-color:#b45309}
      .crm-chip.r-no.on{background:#b91c1c;border-color:#b91c1c}
      .crm-chip.r-info.on{background:#475569;border-color:#475569}
      .crm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
      .crm-opt{margin-top:12px;border-top:1px dashed rgba(10,23,48,.15);padding-top:6px}
      .crm-opt > summary{cursor:pointer;font-size:.8rem;font-weight:800;color:var(--nm-text,#0a1730);padding:6px 0}
      .crm-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px}
      .crm-tag{display:inline-block;font-size:.7rem;font-weight:800;padding:3px 8px;border-radius:100px}
      .crm-tag.ok{background:#DCFCE7;color:#166534}.crm-tag.go{background:#DBEAFE;color:#1E40AF}.crm-tag.hold{background:#FEF3C7;color:#92400E}
      .crm-tag.no{background:#FEE2E2;color:#991B1B}.crm-tag.info{background:#E2E8F0;color:#334155}
      .crm-list{display:flex;flex-direction:column;gap:8px}
      .crm-item{background:var(--nm-white,#fff);border-radius:12px;padding:10px 12px;box-shadow:var(--nm-shadow-raised-sm)}
      .crm-item-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .crm-item-top b{font-size:.86rem}
      .crm-item-meta{font-size:.74rem;color:var(--nm-text-soft,#5b6577);margin-top:4px;line-height:1.5}
      .crm-item-prefs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
      .crm-item-prefs span{font-size:.68rem;background:rgba(221,179,103,.18);color:#7a5a1c;padding:2px 7px;border-radius:100px;font-weight:700}
      .crm-item-memo{font-size:.76rem;margin-top:6px;color:var(--nm-text,#0a1730);white-space:pre-wrap}
      .crm-item-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      .crm-item-acts .crm-btn{padding:5px 9px;font-size:.7rem}
      .crm-hist{margin-top:8px;border-top:1px dashed rgba(10,23,48,.15);padding-top:6px;font-size:.72rem;line-height:1.6}
      .crm-hist .h{margin-bottom:6px}
      .crm-hist .h b{color:var(--nm-text,#0a1730)}
      .crm-filter{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .crm-filter input,.crm-filter select{padding:7px 10px;border:none;border-radius:10px;background:var(--nm-white,#fff);box-shadow:var(--nm-shadow-inset);font-size:.8rem}
      .crm-filter input{flex:1;min-width:140px}
      .crm-mode{font-size:.76rem;font-weight:800;color:#1d4ed8;margin-bottom:6px}
      @media(max-width:640px){ .crm-grid2{grid-template-columns:1fr} .crm-memo-row{flex-direction:column} .crm-memo-btns{flex-direction:row} }
    `;
    document.head.appendChild(st);
  }

  // ── 준비 상태(SQL 적용·관리자 등록) 확인 ─────────────────────────
  async function checkReady(force){
    if (state.readyChecked && !force) return state.ready;
    const client = sb();
    const r = {lib:!!client, session:!!adminSession, email:(adminSession && adminSession.user && adminSession.user.email)||'', isAdmin:null, tables:{}, sqlApplied:false};
    if (client && adminSession){
      try{
        const { data, error } = await client.rpc('tgt_is_admin');
        r.isAdmin = error ? (isMissingTableError(error) ? 'missing' : 'error') : !!data;
      }catch(e){ r.isAdmin = 'error'; }
      await Promise.all(Object.entries(TABLES).map(async ([k, t])=>{
        try{
          const { count, error } = await client.from(t).select('*', {count:'exact', head:true});
          r.tables[k] = error ? (isMissingTableError(error) ? 'missing' : 'denied') : {count:count||0};
        }catch(e){ r.tables[k] = 'error'; }
      }));
      r.sqlApplied = r.isAdmin!=='missing' && Object.values(r.tables).every(v=>v!=='missing');
    }
    state.ready = r; state.readyChecked = true;
    return r;
  }
  function isUsable(){ const r = state.ready; return !!(r && r.lib && r.session && r.sqlApplied && r.isAdmin===true); }
  function readyBanner(r){
    if (!r) return '';
    if (!r.lib) return `<div class="crm-banner warn">Supabase 연결 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.</div>`;
    if (!r.session) return `<div class="crm-banner warn">관리자 로그인이 필요합니다.</div>`;
    if (!r.sqlApplied) return `<div class="crm-banner warn">🛠 상담·예약 DB가 아직 준비되지 않았습니다. Supabase SQL Editor에서 <code>${SQL_FILE}</code>을 한 번 실행해 주세요.
      실행 전에도 홈페이지·상품 관리·AI 리드는 지금처럼 동작합니다.</div>`;
    if (r.isAdmin===false) return `<div class="crm-banner warn">🔒 현재 계정(${esc(r.email)})은 상담·예약 관리자 목록(tgt_admins)에 없습니다. SQL 파일 맨 아래 안내대로 관리자로 추가해 주세요.</div>`;
    return '';
  }

  // ══ AI 상담 메모 — 한 줄 메모를 상품·인원·출발월·취향·결과로 분류(규칙 기반, 브라우저 안에서만 처리) ══
  function koNumber(s){ return KO_NUM[s] || null; }
  function parseMemo(text){
    const raw = String(text||'').trim();
    const t = raw.replace(/\s+/g,' ');
    const out = {fields:{}, hits:[]};
    if (!t) return out;
    const set = (k, v, label) => { if (v===undefined || v===null || v==='') return; out.fields[k] = v; if (label) out.hits.push(label); };

    // 상품 · 국가/권역
    const prods = allProducts();
    let best = null;
    prods.forEach(x=>{
      const tokens = (x.title||'').replace(/[()\[\]【】·,/]/g,' ').split(/\s+/).map(s=>s.replace(/\d+박\d*일?|\d+R|\d+일/g,'')).filter(s=>s.length>=2 && !GENERIC_TOKENS.has(s));
      let score = 0;
      tokens.forEach(tok=>{ if (t.includes(tok)) score += tok.length; });
      if (score>0 && (!best || score>best.score)) best = {x, score};
    });
    let catId = null;
    Object.entries(PLACE_ALIASES).forEach(([cid, names])=>{ if (!catId && names.some(n=>t.includes(n))) catId = cid; });
    if (best && best.score>=2){
      set('product', 'uid:'+best.x.uid, `상품: ${best.x.title}`);
      catId = best.x.catId;
    } else if (catId){
      set('product', 'cat:'+catId, `국가/권역: ${catInfo(catId) ? catInfo(catId).ko : catId}`);
    }

    // 인원 — "4명/4인/4분", "부부"=2, "두 명", "2팀"(팀=4인 기준 환산, 확인 필요 표시)
    let m;
    // "1인 100만원"처럼 예산을 말하는 "N인"은 인원으로 보지 않는다. "분"은 시간(이동 30분)과 헷갈려 숫자와는 쓰지 않는다
    const partyHit = [...t.matchAll(/(\d{1,3})\s*(명|인)(?!기|당)/g)].find(x=>!/^\s*(당\s*)?\d+\s*만/.test(t.slice(x.index + x[0].length, x.index + x[0].length + 8)));
    if (partyHit) set('requested_party_size', Number(partyHit[1]), `인원: ${partyHit[1]}명`);
    else if ((m = /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(명|분|사람)/.exec(t))) set('requested_party_size', koNumber(m[1]), `인원: ${koNumber(m[1])}명`);
    else if ((m = /(\d{1,2})\s*팀/.exec(t))) { set('requested_party_size', Number(m[1])*4, `인원: ${m[1]}팀(4인 기준 ${Number(m[1])*4}명 — 확인 필요)`); }
    else if (/부부|커플|둘이/.test(t)) set('requested_party_size', 2, '인원: 2명(부부·커플)');

    // 희망 출발일·출발 월(한국 시간 기준, 이미 지난 달이면 내년)
    const today = todayKst();
    const nextYear = /내년/.test(t);
    const yearFor = mon => nextYear ? today.y+1 : (mon < today.m ? today.y+1 : today.y);
    if ((m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(t)) || (m = /(?:^|\s)(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s|$|출발|경)/.exec(t))){
      const mon = Number(m[1]), day = Number(m[2]);
      if (mon>=1 && mon<=12 && day>=1 && day<=31){
        const y = yearFor(mon);
        set('preferred_departure_date', `${y}-${pad2(mon)}-${pad2(day)}`, `출발일: ${y}.${pad2(mon)}.${pad2(day)}`);
        set('preferred_departure_month', `${y}-${pad2(mon)}`);
      }
    } else if ((m = /(\d{1,2})\s*월/.exec(t))){
      const mon = Number(m[1]);
      if (mon>=1 && mon<=12){ const y = yearFor(mon); set('preferred_departure_month', `${y}-${pad2(mon)}`, `출발월: ${y}년 ${mon}월`); }
    } else if (/다음\s*달/.test(t)){
      const mon = today.m===12 ? 1 : today.m+1, y = today.m===12 ? today.y+1 : today.y;
      set('preferred_departure_month', `${y}-${pad2(mon)}`, `출발월: ${y}년 ${mon}월`);
    } else if (/이번\s*달/.test(t)){
      set('preferred_departure_month', `${today.y}-${pad2(today.m)}`, `출발월: ${today.y}년 ${today.m}월`);
    }
    if (/날짜\s*(조정|변경)\s*가능|일정\s*(조정|변경)\s*가능|날짜\s*유동|아무\s*때나/.test(t)) set('date_flexibility', '가능', '출발일 변경 가능');

    // 예산(1인) — "100만원", "1인 80만"
    if ((m = /(\d{2,4})\s*만\s*원?/.exec(t))) set('budget_man', Number(m[1]), `예산: 1인 ${m[1]}만원`);

    // 상담 결과 · 미예약 사유
    let result = null;
    if (/보류|고민|생각해\s*본|생각해보|나중에|미정|검토\s*후/.test(t)) result = '보류';
    else if (/안\s*(한|하|함|해)|포기|취소|다른\s*(곳|데|여행사)|타사|무산|불발/.test(t)) result = '미예약';
    else if (/예약\s*(확정|완료|함|했)|확정|계약|입금\s*완료|결제\s*완료/.test(t)) result = '예약확정';
    else if (/예약\s*진행|견적|진행\s*중|가예약|입금\s*예정|예약\s*예정/.test(t)) result = '예약진행중';
    else if (/문의만|단순\s*문의|가격만|정보만/.test(t)) result = '단순문의';
    if (result) set('result', result, `결과: ${result}`);
    let reason = null;
    if (/소인원|추가\s*요금|추가요금|싱글\s*차지/.test(t)) reason = '소인원 추가요금';
    else if (/가격|비싸|비용|예산\s*초과|금액/.test(t)) reason = '가격';
    else if (/인원\s*(부족|미달|안\s*모|모자)|최소\s*인원/.test(t)) reason = '인원 미달';
    else if (/일정|날짜|휴가|시간이?\s*안/.test(t) && (result==='보류'||result==='미예약')) reason = '일정 불일치';
    else if (/타사|다른\s*(곳|데|여행사)/.test(t)) reason = '타사 예약';
    else if (/연락\s*(두절|안\s*됨|안됨)|부재|안\s*받/.test(t)) reason = '연락 두절';
    else if (/원하는\s*상품|상품이?\s*없/.test(t)) reason = '원하는 상품 없음';
    if (reason) set('unbooked_reason', reason, `사유: ${reason}`);
    if (reason==='소인원 추가요금') set('party_booking_barrier', '소인원 추가요금');
    else if (reason==='인원 미달') set('party_booking_barrier', '최소 출발 인원 미달');

    // 고객 핵심 취향 — 상담 표현 규칙(홈페이지 AI 추천 스타일 14종 + 상담 표현)
    const uniqPrefs = PREF_PATTERNS.filter(([,re])=>re.test(t)).map(([p])=>p);
    if (uniqPrefs.length) set('preferences', uniqPrefs, `취향: ${uniqPrefs.join(', ')}`);

    // 상담 경로 · 단체 유형 · 합류 의사 · 고객 연락처
    if (/카톡|카카오/.test(t)) set('channel', '카카오톡', '경로: 카카오톡');
    else if (/문자/.test(t)) set('channel', '문자', '경로: 문자');
    else if (/방문/.test(t)) set('channel', '방문', '경로: 방문');
    else if (/전화|통화/.test(t)) set('channel', '전화', '경로: 전화');
    if (/동호회/.test(t)) set('group_type', '동호회', '단체: 동호회');
    else if (/회사|기업|법인|워크숍/.test(t)) set('group_type', '기업', '단체: 기업');
    else if (/친목|모임|계모임/.test(t)) set('group_type', '친목', '단체: 친목');
    else if (/가족|부부/.test(t)) set('group_type', '가족·부부', '단체: 가족·부부');
    if (/합류|조인/.test(t)) set('join_group_preference', '합류 가능', '다른 팀 합류 가능');
    else if (/단독|우리끼리|프라이빗/.test(t)) set('join_group_preference', '단독 희망', '단독 출발 희망');
    if ((m = /(01[016789])[-\s.]?(\d{3,4})[-\s.]?(\d{4})/.exec(t))) set('customer_phone', `${m[1]}-${m[2]}-${m[3]}`, '연락처');
    if ((m = /([가-힣]{2,4})\s*(고객님|고객|님)/.exec(t)) && !/(문의|상담|예약)/.test(m[1])) set('customer_name', m[1], `고객: ${m[1]}`);
    return out;
  }

  // ══ 빠른 기록 폼 ══════════════════════════════════════════════
  function emptyForm(){
    return {product:'', preferences:[], result:'', channel:'전화', preferred_departure_month:'', preferred_departure_date:'', date_flexibility:'',
            requested_party_size:'', party_flexibility:'', join_group_preference:'', group_type:'', party_booking_barrier:'', budget_man:'',
            unbooked_reason:'', customer_name:'', customer_phone:'', preference_note:'', memo:'', ai_memo:'', first_inquiry_at:null};
  }
  function loadDraft(){ try{ const d = JSON.parse(localStorage.getItem(DRAFT_KEY)||'null'); return d && typeof d==='object' ? Object.assign(emptyForm(), d) : null; }catch(e){ return null; } }
  function saveDraft(){ if (state.editId) return; try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(state.form)); }catch(e){} }
  function clearDraft(){ try{ localStorage.removeItem(DRAFT_KEY); }catch(e){} }
  function ensureForm(){ if (!state.form) state.form = loadDraft() || emptyForm(); return state.form; }

  function productOptionsHTML(sel){
    const prods = allProducts();
    let html = `<option value="">상품 선택 (필수)</option>`;
    ['overseas','domestic'].forEach(region=>{
      (CATEGORIES[region]||[]).forEach(cat=>{
        const list = prods.filter(x=>x.catId===cat.id);
        html += `<optgroup label="${esc((region==='overseas'?'해외 · ':'국내 · ')+cat.ko)}">`;
        html += `<option value="cat:${esc(cat.id)}" ${sel==='cat:'+cat.id?'selected':''}>${esc(cat.ko)} — 상품 미정(국가·권역만)</option>`;
        list.forEach(x=>{ html += `<option value="uid:${esc(x.uid)}" ${sel==='uid:'+x.uid?'selected':''}>${esc(x.title)}</option>`; });
        html += `</optgroup>`;
      });
    });
    return html;
  }
  const chipGroup = (field, opts, selected, multi, clsFn) => `<div class="crm-chips">${opts.map(o=>{
      const on = multi ? (selected||[]).includes(o) : selected===o;
      return `<button type="button" class="crm-chip ${clsFn?clsFn(o):''} ${on?'on':''}" onclick="TGT_CRM.pick('${field}', ${JSON.stringify(o).replace(/"/g,'&quot;')}, ${multi?'true':'false'})">${esc(o)}</button>`;
    }).join('')}</div>`;
  function prefOptions(){ return EXTRA_PREFS.concat((typeof STYLE_OPTIONS!=='undefined' ? STYLE_OPTIONS : []).map(o=>o.value)); }

  function quickHTML(){
    const f = ensureForm();
    const prefs = prefOptions();
    const custom = (f.preferences||[]).filter(p=>!prefs.includes(p));
    const parse = state.lastParse;
    const mode = state.editId ? `✏️ 상담 수정 중 (#${state.editId})` : (state.parentId ? `↪ 후속 상담 (최초 상담 #${state.parentId}의 최초 문의일 유지)` : (state.leadId ? `🌐 홈페이지 문의(리드 #${state.leadId})에서 시작한 상담` : ''));
    return `<div class="crm-card">
      ${mode?`<div class="crm-mode">${mode}</div>`:''}
      <h5>🤖 AI 상담 메모 <span class="crm-note" style="font-weight:500">— 통화 직후 한 줄로 말하거나 입력하면 아래 항목이 자동으로 채워집니다. 확인 후 저장하세요.</span></h5>
      <div class="crm-memo-row">
        <textarea id="crmMemo" placeholder="예) 계림, 4명, 11월, 풍경 좋은 곳 선호, 가격 때문에 보류" oninput="TGT_CRM.memoInput(this.value)">${esc(f.ai_memo)}</textarea>
        <div class="crm-memo-btns">
          <button type="button" class="crm-btn ${state.recording?'rec':''}" id="crmMicBtn" onclick="TGT_CRM.mic()" title="말로 입력(크롬·엣지·안드로이드)">${state.recording?'⏺ 듣는 중':'🎤 말하기'}</button>
          <button type="button" class="crm-btn primary" onclick="TGT_CRM.applyMemo()">분류하기</button>
        </div>
      </div>
      <div class="crm-parse" id="crmParse">${parse ? (parse.hits.length ? parse.hits.map(h=>`<span class="pc">${esc(h)}</span>`).join('') : '<span class="pc miss">인식된 항목이 없습니다 — 아래에서 직접 선택하세요</span>') : ''}</div>

      <div class="crm-field"><label>상담 상품<span class="req">*</span></label>
        <select onchange="TGT_CRM.set('product', this.value)">${productOptionsHTML(f.product)}</select></div>
      <div class="crm-field"><label>고객 핵심 취향<span class="req">*</span> <span class="crm-note" style="font-weight:500">(복수 선택)</span></label>
        ${chipGroup('preferences', prefs.concat(custom), f.preferences, true)}
        <input type="text" placeholder="직접 입력 후 Enter (예: 바다 보이는 코스)" onkeydown="if(event.key==='Enter'){event.preventDefault();TGT_CRM.addPref(this.value);this.value='';}"></div>
      <div class="crm-field"><label>상담 결과<span class="req">*</span></label>
        ${chipGroup('result', RESULTS, f.result, false, o=>'r-'+RESULT_CLS[o])}</div>
      ${(f.result==='보류'||f.result==='미예약') ? `<div class="crm-field"><label>미예약·보류 사유</label>${chipGroup('unbooked_reason', REASONS, f.unbooked_reason, false)}</div>` : ''}

      <details class="crm-opt" ${hasOptional(f)?'open':''}>
        <summary>선택 입력 — 경로 · 희망 출발 · 인원 · 예산 · 메모</summary>
        <div class="crm-field"><label>상담 경로</label>${chipGroup('channel', CHANNELS, f.channel, false)}</div>
        <div class="crm-grid2">
          <div class="crm-field"><label>희망 출발 월</label><input type="month" value="${esc(f.preferred_departure_month)}" onchange="TGT_CRM.set('preferred_departure_month', this.value)"></div>
          <div class="crm-field"><label>희망 출발일</label><input type="date" value="${esc(f.preferred_departure_date)}" onchange="TGT_CRM.set('preferred_departure_date', this.value)"></div>
          <div class="crm-field"><label>출발일 변경 가능</label>${chipGroup('date_flexibility', FLEX, f.date_flexibility, false)}</div>
          <div class="crm-field"><label>예산 (1인, 만원)</label><input type="number" min="0" step="1" value="${esc(f.budget_man)}" placeholder="예: 120" oninput="TGT_CRM.set('budget_man', this.value, true)"></div>
          <div class="crm-field"><label>희망 인원</label><input type="number" min="1" max="999" value="${esc(f.requested_party_size)}" placeholder="예: 4" oninput="TGT_CRM.set('requested_party_size', this.value, true)"></div>
          <div class="crm-field"><label>인원 변경 가능</label>${chipGroup('party_flexibility', FLEX, f.party_flexibility, false)}</div>
          <div class="crm-field"><label>다른 팀 합류 의사</label>${chipGroup('join_group_preference', JOIN_PREF, f.join_group_preference, false)}</div>
          <div class="crm-field"><label>단체 유형</label>${chipGroup('group_type', GROUP_TYPES, f.group_type, false)}</div>
        </div>
        <div class="crm-field"><label>인원 관련 예약 장애 <span class="crm-note" style="font-weight:500">(확인된 경우만)</span></label>${chipGroup('party_booking_barrier', PARTY_BARRIERS, f.party_booking_barrier, false)}</div>
        <div class="crm-grid2">
          <div class="crm-field"><label>고객명 <span class="crm-note" style="font-weight:500">(선택)</span></label><input type="text" value="${esc(f.customer_name)}" oninput="TGT_CRM.set('customer_name', this.value, true)"></div>
          <div class="crm-field"><label>연락처 <span class="crm-note" style="font-weight:500">(선택 · 예약 자동 연결용)</span></label><input type="tel" value="${esc(f.customer_phone)}" placeholder="010-0000-0000" oninput="TGT_CRM.set('customer_phone', this.value, true)"></div>
        </div>
        <div class="crm-field"><label>취향 메모</label><input type="text" value="${esc(f.preference_note)}" placeholder="예: 그린 관리 좋은 곳, 숙소에서 바다 전망" oninput="TGT_CRM.set('preference_note', this.value, true)"></div>
        <div class="crm-field"><label>상담 메모</label><textarea rows="2" oninput="TGT_CRM.set('memo', this.value, true)">${esc(f.memo)}</textarea></div>
      </details>
      ${state.flash ? state.flash : ''}
      <div class="crm-actions">
        ${state.editId || state.parentId || state.leadId ? `<button type="button" class="crm-btn" onclick="TGT_CRM.resetForm()">취소</button>` : `<button type="button" class="crm-btn" onclick="TGT_CRM.resetForm()">비우기</button>`}
        <button type="button" class="crm-btn primary" ${state.saving?'disabled':''} onclick="TGT_CRM.save()">${state.saving?'저장 중...':(state.editId?'수정 저장':'저장')}</button>
      </div>
    </div>`;
  }
  function hasOptional(f){
    return !!(f.preferred_departure_month || f.preferred_departure_date || f.requested_party_size || f.budget_man || f.memo || f.customer_name || f.customer_phone
      || f.group_type || f.join_group_preference || f.party_booking_barrier || f.date_flexibility || f.party_flexibility || f.preference_note || (f.channel && f.channel!=='전화'));
  }
  // 칩 선택(단일: 다시 누르면 해제 / 복수: 토글)
  function pick(field, value, multi){
    const f = ensureForm();
    if (multi){
      const arr = Array.isArray(f[field]) ? f[field].slice() : [];
      const i = arr.indexOf(value);
      if (i>=0) arr.splice(i,1); else arr.push(value);
      if (value!=='특별한 취향 없음'){ const j = arr.indexOf('특별한 취향 없음'); if (j>=0 && i<0) arr.splice(j,1); }
      else if (i<0) arr.splice(0, arr.length, value);
      f[field] = arr;
    } else {
      f[field] = f[field]===value ? '' : value;
      if (field==='result' && !(f.result==='보류'||f.result==='미예약')) f.unbooked_reason = '';
    }
    state.flash = '';
    saveDraft(); renderBody();
  }
  function setField(field, value, silent){ ensureForm()[field] = value; saveDraft(); if (!silent) renderBody(); }
  function addPref(v){ v = String(v||'').trim(); if (!v) return; const f = ensureForm(); if (!f.preferences.includes(v)) f.preferences.push(v); saveDraft(); renderBody(); }
  let _memoTimer = null;
  function memoInput(v){
    ensureForm().ai_memo = v; saveDraft();
    clearTimeout(_memoTimer);
    _memoTimer = setTimeout(()=>{ const p = parseMemo(v); state.lastParse = p; const el = document.getElementById('crmParse');
      if (el) el.innerHTML = p.hits.length ? p.hits.map(h=>`<span class="pc">${esc(h)}</span>`).join('') + '<span class="pc miss">"분류하기"를 누르면 아래 항목에 반영됩니다</span>' : ''; }, 250);
  }
  // 분류 결과를 폼에 반영 — 메모에서 인식된 항목만 덮어쓰고, 이미 고른 취향에는 더한다
  function applyMemo(){
    const f = ensureForm();
    const el = document.getElementById('crmMemo'); if (el) f.ai_memo = el.value;
    const p = parseMemo(f.ai_memo); state.lastParse = p;
    Object.entries(p.fields).forEach(([k,v])=>{
      if (k==='preferences') f.preferences = [...new Set((f.preferences||[]).filter(x=>x!=='특별한 취향 없음').concat(v))];
      else f[k] = v;
    });
    saveDraft(); renderBody();
  }
  // 음성 입력(Web Speech API — 크롬·엣지·안드로이드 지원, 사파리는 일부 지원)
  let _rec = null;
  function mic(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR){ alert('이 브라우저는 음성 입력을 지원하지 않습니다. 크롬 또는 엣지에서 사용하거나, 휴대폰 키보드의 마이크 버튼을 이용하세요.'); return; }
    if (_rec){ try{ _rec.stop(); }catch(e){} return; }
    _rec = new SR(); _rec.lang = 'ko-KR'; _rec.interimResults = false; _rec.maxAlternatives = 1;
    state.recording = true; renderBody();
    _rec.onresult = ev=>{
      const said = Array.from(ev.results).map(r=>r[0].transcript).join(' ');
      const f = ensureForm(); f.ai_memo = (f.ai_memo ? f.ai_memo.trim()+', ' : '') + said; saveDraft();
    };
    _rec.onend = ()=>{ _rec = null; state.recording = false; applyMemo(); };
    _rec.onerror = ()=>{};
    try{ _rec.start(); }catch(e){ _rec = null; state.recording = false; renderBody(); }
  }
  function resetForm(){
    state.form = emptyForm(); state.editId = null; state.parentId = null; state.leadId = null; state.lastParse = null; state.flash = '';
    clearDraft(); renderBody();
  }

  // 폼 → DB 행
  function formToRow(f){
    const row = {
      preferences: (f.preferences||[]).slice(),
      result: f.result,
      channel: f.channel || null,
      preferred_departure_month: f.preferred_departure_month ? f.preferred_departure_month.slice(0,7)+'-01' : null,
      preferred_departure_date: f.preferred_departure_date || null,
      date_flexibility: f.date_flexibility || null,
      requested_party_size: f.requested_party_size==='' || f.requested_party_size==null ? null : Math.max(1, parseInt(f.requested_party_size,10)||0) || null,
      party_flexibility: f.party_flexibility || null,
      join_group_preference: f.join_group_preference || null,
      group_type: f.group_type || null,
      party_booking_barrier: f.party_booking_barrier || null,
      budget_per_person: f.budget_man==='' || f.budget_man==null ? null : Math.round(Number(f.budget_man)*10000) || null,
      unbooked_reason: (f.result==='보류'||f.result==='미예약') ? (f.unbooked_reason || null) : null,
      customer_name: (f.customer_name||'').trim() || null,
      customer_phone: (f.customer_phone||'').trim() || null,
      preference_note: (f.preference_note||'').trim() || null,
      memo: (f.memo||'').trim() || null,
      ai_memo: (f.ai_memo||'').trim() || null,
      ai_parse: state.lastParse && Object.keys(state.lastParse.fields).length ? state.lastParse.fields : null,
    };
    if (!row.ai_parse && state.editId) delete row.ai_parse;   // 수정할 때 새로 분류하지 않았으면 처음 분류 결과를 그대로 둔다
    // 상품 스냅샷(이름·국가·권역) — 이후 상품명이 바뀌어도 당시 상담 내용이 남도록
    const v = f.product || '';
    if (v.startsWith('uid:')){
      const x = productByUid(v.slice(4));
      if (x){ Object.assign(row, {product_uid:x.uid, product_title:x.title, product_cat:x.catId, travel_region:x.region, country:x.region==='overseas'?x.catKo:'대한민국', destination:x.catKo}); }
    } else if (v.startsWith('cat:')){
      const c = catInfo(v.slice(4));
      if (c) Object.assign(row, {product_uid:null, product_title:null, product_cat:c.id, travel_region:c.region, country:c.region==='overseas'?c.ko:'대한민국', destination:c.ko});
    }
    return row;
  }
  function validate(f){
    const miss = [];
    if (!f.product) miss.push('상담 상품');
    if (!(f.preferences||[]).length) miss.push('고객 핵심 취향(없으면 "특별한 취향 없음")');
    if (!f.result) miss.push('상담 결과');
    return miss;
  }
  // 상담 결과 → AI 리드 상태 자동 갱신
  const LEAD_STATUS_BY_RESULT = {'예약확정':'성사','예약진행중':'연락중','보류':'보류','미예약':'취소','단순문의':'연락중'};
  async function syncLeadStatus(leadId, result){
    if (!leadId || !LEAD_STATUS_BY_RESULT[result]) return;
    try{
      await sb().from(LEADS_TABLE_NAME).update({status: LEAD_STATUS_BY_RESULT[result]}).eq('id', leadId);
      if (typeof _leadsCache!=='undefined'){ const l = _leadsCache.find(x=>x.id===leadId); if (l) l.status = LEAD_STATUS_BY_RESULT[result]; }
    }catch(e){}
  }
  async function save(){
    if (state.saving) return;
    const f = ensureForm();
    const memoEl = document.getElementById('crmMemo'); if (memoEl) f.ai_memo = memoEl.value;
    const miss = validate(f);
    if (miss.length){ state.flash = `<div class="crm-banner warn" style="margin-top:12px">입력이 필요합니다: ${miss.map(esc).join(', ')}</div>`; renderBody(); return; }
    await checkReady();
    if (!isUsable()){ state.flash = `<div class="crm-banner warn" style="margin-top:12px">저장할 수 없습니다 — 위의 안내(DB 준비·관리자 권한)를 먼저 확인하세요. 입력한 내용은 이 기기에 임시 저장되어 있습니다.</div>`; renderBody(); return; }
    state.saving = true; renderBody();
    const row = formToRow(f);
    const client = sb();
    try{
      let saved;
      if (state.editId){
        const { data, error } = await client.from(TABLES.consultations).update(row).eq('id', state.editId).select().single();
        if (error) throw error; saved = data;
      } else {
        if (state.parentId) row.parent_id = state.parentId;
        if (state.leadId) row.lead_id = state.leadId;
        if (f.first_inquiry_at) row.first_inquiry_at = f.first_inquiry_at;   // 리드 접수 시각 / 최초 상담의 최초 문의일 승계
        const { data, error } = await client.from(TABLES.consultations).insert(row).select().single();
        if (error) throw error; saved = data;
      }
      await syncLeadStatus(saved.lead_id, saved.result);
      const i = state.list.findIndex(x=>x.id===saved.id);
      if (i>=0) state.list[i] = saved; else if (state.listLoaded) state.list.unshift(saved);
      const wasEdit = !!state.editId;
      state.form = emptyForm(); state.editId = null; state.parentId = null; state.leadId = null; state.lastParse = null; clearDraft();
      state.flash = `<div class="crm-banner ok" style="margin-top:12px">✅ ${wasEdit?'수정했습니다':'저장했습니다'} — #${saved.id} ${esc(saved.product_title||saved.destination||'')} · ${esc(saved.result)}${saved.lead_id?' · AI 리드 상태도 함께 갱신':''}</div>`;
    }catch(e){
      state.flash = `<div class="crm-banner err" style="margin-top:12px">저장 실패: ${esc(errText(e))}</div>`;
    }finally{
      state.saving = false; renderBody();
    }
  }

  // ══ 상담 목록 · 수정 · 후속 상담 · 변경 이력 ═══════════════════════
  async function loadList(force){
    if (state.listLoaded && !force) return;
    await checkReady();
    if (!isUsable()) return;
    const { data, error } = await sb().from(TABLES.consultations).select('*').eq('is_deleted', false).order('consulted_at', {ascending:false}).limit(1000);
    if (error){ state.listError = errText(error); return; }
    state.list = data || []; state.listLoaded = true; state.listError = '';
    if (!state._listLogged){ state._listLogged = true; logAccess('view_consultations', TABLES.consultations, {count:state.list.length}); }
  }
  function filteredList(){
    const {q, result, period} = state.listFilter;
    const since = period==='all' ? 0 : Date.now() - Number(period)*86400000;
    const qq = String(q||'').trim().toLowerCase();
    return state.list.filter(c=>{
      if (result && c.result!==result) return false;
      if (since && new Date(c.consulted_at).getTime() < since) return false;
      if (qq){
        const hay = [c.product_title, c.destination, c.country, c.customer_name, c.customer_phone, c.memo, c.ai_memo, (c.preferences||[]).join(' '), c.unbooked_reason].join(' ').toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }
  const FIELD_LABELS = {product_uid:'상품', product_title:'상품명', product_cat:'국가/권역', travel_region:'국내/해외', country:'국가', destination:'목적지', preferences:'취향', result:'상담 결과',
    channel:'상담 경로', preferred_departure_month:'희망 출발 월', preferred_departure_date:'희망 출발일', date_flexibility:'출발일 변경 가능', requested_party_size:'희망 인원',
    party_flexibility:'인원 변경 가능', join_group_preference:'합류 의사', group_type:'단체 유형', party_booking_barrier:'인원 장애', budget_per_person:'예산(1인)', unbooked_reason:'미예약 사유',
    customer_name:'고객명', customer_phone:'연락처', preference_note:'취향 메모', memo:'메모', ai_memo:'AI 메모', booking_id:'연결 예약', is_deleted:'삭제', consulted_at:'상담 일시', lead_id:'리드', parent_id:'최초 상담'};
  function fmtVal(k, v){
    if (v==null || v==='') return '—';
    if (Array.isArray(v)) return v.join(', ') || '—';
    if (k==='preferred_departure_month') return fmtMonth(v);
    if (k==='preferred_departure_date') return fmtDate(v);
    if (k==='budget_per_person') return `${Math.round(Number(v)/10000)}만원`;
    if (k==='consulted_at') return fmtKst(v);
    if (typeof v==='object') return JSON.stringify(v);
    return String(v);
  }
  function listHTML(){
    const r = state.ready;
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${r ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    if (!state.listLoaded) return `<div class="crm-card"><div class="crm-empty">${state.listError ? '불러오기 실패: '+esc(state.listError) : '불러오는 중...'}</div></div>`;
    const lf = state.listFilter;
    const items = filteredList();
    return `<div class="crm-card">
      <div class="crm-filter">
        <input type="search" placeholder="상품·고객·메모 검색" value="${esc(lf.q)}" oninput="TGT_CRM.filter('q', this.value)">
        <select onchange="TGT_CRM.filter('result', this.value)"><option value="">전체 결과</option>${RESULTS.map(x=>`<option ${lf.result===x?'selected':''}>${x}</option>`).join('')}</select>
        <select onchange="TGT_CRM.filter('period', this.value)">${[['30','최근 30일'],['90','최근 90일'],['365','최근 1년'],['all','전체']].map(([v,l])=>`<option value="${v}" ${lf.period===v?'selected':''}>${l}</option>`).join('')}</select>
        <button type="button" class="crm-btn" onclick="TGT_CRM.reloadList()">🔄</button>
      </div>
      <p class="crm-note" style="margin:8px 0">${items.length}건 (전체 ${state.list.length}건) · 시간은 한국 시간</p>
      <div class="crm-list" id="crmListItems">${items.length ? items.map(itemHTML).join('') : '<div class="crm-empty">조건에 맞는 상담이 없습니다.</div>'}</div>
    </div>`;
  }
  function itemHTML(c){
    const hist = state.openHistory[c.id];
    const meta = [
      `상담 ${fmtKst(c.consulted_at)}`,
      c.first_inquiry_at && Math.abs(new Date(c.first_inquiry_at)-new Date(c.consulted_at))>60000 ? `최초 문의 ${fmtKst(c.first_inquiry_at)}` : '',
      c.channel || '',
      c.requested_party_size ? `${c.requested_party_size}명` : '',
      c.preferred_departure_date ? `출발 ${fmtDate(c.preferred_departure_date)}` : (c.preferred_departure_month ? `출발 ${fmtMonth(c.preferred_departure_month)}` : ''),
      c.budget_per_person ? `1인 ${Math.round(c.budget_per_person/10000)}만원` : '',
      c.unbooked_reason ? `사유: ${c.unbooked_reason}` : '',
      c.customer_name ? `고객 ${c.customer_name}` : '',
      c.lead_id ? `🌐 리드 #${c.lead_id}` : '',
      c.parent_id ? `↪ 후속(#${c.parent_id})` : '',
    ].filter(Boolean).map(esc).join(' · ');
    return `<div class="crm-item">
      <div class="crm-item-top"><span class="crm-tag ${RESULT_CLS[c.result]||'info'}">${esc(c.result)}</span><b>${esc(c.product_title || ((c.destination||'')+' (상품 미정)'))}</b><span class="crm-note">#${c.id}</span></div>
      <div class="crm-item-meta">${meta}</div>
      ${(c.preferences||[]).length ? `<div class="crm-item-prefs">${c.preferences.map(p=>`<span>${esc(p)}</span>`).join('')}</div>` : ''}
      ${c.memo || c.ai_memo ? `<div class="crm-item-memo">${esc(c.memo || c.ai_memo)}</div>` : ''}
      <div class="crm-item-acts">
        <button type="button" class="crm-btn" onclick="TGT_CRM.edit(${c.id})">✏️ 수정</button>
        <button type="button" class="crm-btn" onclick="TGT_CRM.followUp(${c.id})">↪ 후속 상담</button>
        <button type="button" class="crm-btn" onclick="TGT_CRM.history(${c.id})">🕘 변경 이력${hist && hist.rows ? ` (${hist.rows.length})` : ''}</button>
        <button type="button" class="crm-btn danger" onclick="TGT_CRM.remove(${c.id})">삭제</button>
      </div>
      ${hist ? `<div class="crm-hist">${hist.loading ? '불러오는 중...' : (hist.error ? '불러오기 실패: '+esc(hist.error) : (hist.rows.length ? hist.rows.map(h=>`<div class="h"><b>${esc(fmtKst(h.changed_at))}</b> — ${
          (h.changed_fields||[]).filter(k=>FIELD_LABELS[k]).map(k=>`${esc(FIELD_LABELS[k])}: ${esc(fmtVal(k, h.before && h.before[k]))} → ${esc(fmtVal(k, h.after && h.after[k]))}`).join(' / ') || '변경'}</div>`).join('') : '변경 이력이 없습니다.'))}</div>` : ''}
    </div>`;
  }
  function filter(k, v){
    state.listFilter[k] = v;
    const box = document.getElementById('crmListItems');
    if (k==='q' && box){ const items = filteredList(); box.innerHTML = items.length ? items.map(itemHTML).join('') : '<div class="crm-empty">조건에 맞는 상담이 없습니다.</div>'; return; }
    renderBody();
  }
  function rowToForm(c){
    return Object.assign(emptyForm(), {
      product: c.product_uid ? 'uid:'+c.product_uid : (c.product_cat ? 'cat:'+c.product_cat : ''),
      preferences: (c.preferences||[]).slice(), result: c.result||'', channel: c.channel||'',
      preferred_departure_month: c.preferred_departure_month ? c.preferred_departure_month.slice(0,7) : '',
      preferred_departure_date: c.preferred_departure_date || '', date_flexibility: c.date_flexibility||'',
      requested_party_size: c.requested_party_size==null ? '' : String(c.requested_party_size), party_flexibility: c.party_flexibility||'',
      join_group_preference: c.join_group_preference||'', group_type: c.group_type||'', party_booking_barrier: c.party_booking_barrier||'',
      budget_man: c.budget_per_person==null ? '' : String(Math.round(c.budget_per_person/10000)), unbooked_reason: c.unbooked_reason||'',
      customer_name: c.customer_name||'', customer_phone: c.customer_phone||'', preference_note: c.preference_note||'', memo: c.memo||'', ai_memo: c.ai_memo||'',
    });
  }
  function edit(id){
    const c = state.list.find(x=>x.id===id); if (!c) return;
    state.form = rowToForm(c); state.editId = id; state.parentId = null; state.leadId = null; state.lastParse = null; state.flash = '';
    go('quick');
  }
  // 후속 상담 — 상품·취향·인원 등은 이어받고 결과·메모는 새로 입력. 최초 문의일은 최초 상담 것을 그대로 쓴다
  function followUp(id){
    const c = state.list.find(x=>x.id===id); if (!c) return;
    const root = c.parent_id ? (state.list.find(x=>x.id===c.parent_id) || c) : c;
    const f = rowToForm(c); f.result = ''; f.unbooked_reason = ''; f.memo = ''; f.ai_memo = ''; f.channel = '전화';
    f.first_inquiry_at = root.first_inquiry_at || c.first_inquiry_at;
    state.form = f; state.editId = null; state.parentId = root.id; state.leadId = null; state.lastParse = null; state.flash = '';
    go('quick');
  }
  async function history(id){
    if (state.openHistory[id]){ delete state.openHistory[id]; renderBody(); return; }
    state.openHistory[id] = {loading:true}; renderBody();
    const { data, error } = await sb().from(TABLES.revisions).select('*').eq('consultation_id', id).order('changed_at', {ascending:false}).limit(50);
    state.openHistory[id] = error ? {error:errText(error)} : {rows:data||[]};
    renderBody();
  }
  async function remove(id){
    if (!confirm('이 상담 기록을 삭제할까요?\n(통계에서 빠지며, 변경 이력에는 삭제 기록이 남습니다)')) return;
    const { error } = await sb().from(TABLES.consultations).update({is_deleted:true}).eq('id', id);
    if (error){ alert('삭제 실패: '+errText(error)); return; }
    state.list = state.list.filter(x=>x.id!==id); renderBody();
  }
  async function reloadList(){ state.listLoaded = false; renderBody(); await loadList(true); renderBody(); }

  // ══ AI 리드 → 상담 기록 ═════════════════════════════════════════
  function matchCatFromDest(dest){
    if (!dest) return null;
    if (typeof DEST_LABELS==='object'){ const hit = Object.entries(DEST_LABELS).find(([,v])=>v===dest); if (hit) return hit[0]; }
    for (const [cid, names] of Object.entries(PLACE_ALIASES)) if (names.some(n=>String(dest).includes(n))) return cid;
    return null;
  }
  async function fromLead(leadId){
    let lead = (typeof _leadsCache!=='undefined' ? _leadsCache : []).find(x=>x.id===leadId);
    if (!lead){ try{ const { data } = await sb().from(LEADS_TABLE_NAME).select('*').eq('id', leadId).maybeSingle(); lead = data; }catch(e){} }
    if (!lead){ alert('리드를 찾지 못했습니다.'); return; }
    // 이미 이 리드로 기록한 상담이 있으면 그 상담의 후속 상담으로 이어간다(최초 문의일 중복 방지)
    await loadList();
    const existing = state.list.find(c=>c.lead_id===leadId && !c.parent_id);
    if (existing){ followUp(existing.id); state.flash = `<div class="crm-banner ok" style="margin-top:12px">이 리드는 이미 상담 #${existing.id}로 기록되어 있어 후속 상담으로 이어서 기록합니다.</div>`; renderBody(); return; }
    const f = emptyForm();
    const prod = lead.recommended_product ? allProducts().find(x=>x.title===lead.recommended_product) : null;
    const cat = matchCatFromDest(lead.destination);
    f.product = prod ? 'uid:'+prod.uid : (cat ? 'cat:'+cat : '');
    f.preferences = String(lead.styles||'').split(',').map(s=>s.trim()).filter(Boolean);
    const ps = /(\d{1,3})/.exec(String(lead.party_size||''));
    if (ps) f.requested_party_size = /팀/.test(lead.party_size) ? String(Number(ps[1])*4) : ps[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(lead.departure_date||''))){ f.preferred_departure_date = lead.departure_date; f.preferred_departure_month = lead.departure_date.slice(0,7); }
    f.channel = '홈페이지';
    f.customer_name = lead.name || ''; f.customer_phone = lead.phone || '';
    f.memo = [lead.details, lead.room_type ? `숙박: ${lead.room_type}` : '', lead.stay_duration ? `체류: ${lead.stay_duration}` : ''].filter(Boolean).join('\n');
    f.first_inquiry_at = lead.created_at || null;   // 최초 문의일 = 홈페이지 문의 접수 시각
    state.form = f; state.editId = null; state.parentId = null; state.leadId = leadId; state.lastParse = null;
    state.flash = `<div class="crm-banner ok" style="margin-top:12px">🌐 홈페이지 문의 내용을 채웠습니다 — 통화 결과(상담 결과)와 취향을 확인하고 저장하세요.</div>`;
    go('quick');
  }

  // ── 화면 ─────────────────────────────────────────────────────
  function render(root){
    injectStyle();
    state.root = root || state.root;
    if (!state.root) return;
    state.root.innerHTML = `<div class="crm-wrap">
      <div class="admin-info-box">💡 <b>상담·예약</b> — 전화·카카오톡·문자 상담과 예약 명단을 한곳에 모아, 상품별 문의·예약 성과와 시즌·인원 수요를 확인합니다.
        상담은 핵심 3개(상품·취향·결과)만 입력하면 되고, 기록은 허용된 관리자만 볼 수 있습니다.</div>
      <div class="crm-subnav">${SUBS.map(([k,l])=>`<button type="button" class="${state.sub===k?'active':''}" onclick="TGT_CRM.go('${k}')">${l}</button>`).join('')}</div>
      <div id="crmReadyBanner">${readyBanner(state.ready)}</div>
      <div id="crmBody"></div>
    </div>`;
    renderBody();
    checkReady().then(r=>{
      const b = document.getElementById('crmReadyBanner'); if (b) b.innerHTML = readyBanner(r);
      if (state.sub==='list' && !state.listLoaded) loadList().then(renderBody); else renderBody();
    });
  }
  function go(sub){ state.sub = sub; render(); if (sub==='list') loadList().then(renderBody); }
  function renderBody(){
    const body = document.getElementById('crmBody'); if (!body) return;
    if (state.sub==='quick') body.innerHTML = quickHTML();
    else if (state.sub==='list') body.innerHTML = listHTML();
    else if (state.sub==='check') body.innerHTML = checkHTML(state.ready);
    else body.innerHTML = `<div class="crm-card"><div class="crm-empty">이 화면은 다음 단계에서 순서대로 제공됩니다.</div></div>`;
  }

  function checkHTML(r){
    const prods = allProducts();
    const saved = prods.filter(x=>x.uid && x.persisted).length;
    const row = (ok, label, sub) => `<li><span class="ic">${ok===true?'✅':(ok===false?'⚠️':'⏳')}</span><span>${label}${sub?` <span class="sub">${sub}</span>`:''}</span></li>`;
    const tblLabel = {admins:'관리자 목록', consultations:'상담 기록', revisions:'상담 변경 이력', bookings:'예약', bookingHistory:'예약 상태 이력', imports:'예약 가져오기 기록',
                      links:'상담·예약 연결 승인', rules:'상품 운영 조건', groups:'출발 그룹', events:'홈페이지 행동 기록', accessLogs:'관리자 접근 기록'};
    let tables = '';
    if (r && r.session){
      tables = Object.keys(TABLES).map(k=>{
        const v = r.tables[k];
        if (v==null) return row(null, tblLabel[k]);
        if (v==='missing') return row(false, tblLabel[k], '테이블 없음 — SQL 실행 필요');
        if (v==='denied') return row(false, tblLabel[k], '접근 권한 없음 — 관리자 등록 확인');
        if (v==='error') return row(false, tblLabel[k], '확인 실패');
        return row(true, tblLabel[k], `${v.count}건`);
      }).join('');
    }
    return `<div class="crm-card">
      <h5>🔧 연결 점검</h5>
      <ul class="crm-check-list">
        ${row(r ? r.lib : null, 'Supabase 연결')}
        ${row(r ? r.session : null, '관리자 로그인', r && r.email ? esc(r.email) : '')}
        ${row(r && r.session ? (r.isAdmin===true ? true : (r.isAdmin===null ? null : false)) : null, '상담·예약 관리자 권한',
              r && r.isAdmin==='missing' ? 'SQL 실행 필요' : (r && r.isAdmin===false ? '관리자 목록에 없음' : ''))}
        ${tables}
        ${row(saved===prods.length ? true : false, '상품 고유번호', `${saved} / ${prods.length}개 저장됨` + (saved===prods.length ? '' : ' — 한 번도 수정하지 않은 기본(샘플) 상품은 위치 기반 번호를 쓰고, 처음 수정할 때 같은 번호로 저장됩니다'))}
      </ul>
      <p class="crm-note" style="margin-top:10px">상담·예약 데이터는 공개 사이트 설정(상품 정보)과 분리된 별도 테이블에 저장되며, tgt_admins에 등록된 관리자 계정만 읽고 쓸 수 있습니다.</p>
      <button type="button" class="leads-refresh-btn" style="margin-top:8px" onclick="TGT_CRM.recheck()">🔄 다시 점검</button>
    </div>`;
  }
  async function recheck(){ await checkReady(true); render(); }

  window.TGT_CRM = {
    render, go, recheck,
    pick, set:setField, addPref, memoInput, applyMemo, mic, resetForm, save,
    filter, edit, followUp, history, remove, reloadList, fromLead,
    _internal:{ allProducts, checkReady, fmtKst, parseMemo, formToRow, TABLES, state },
  };
})();
