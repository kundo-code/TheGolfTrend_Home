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
  const RESULTS = ['예약확정','예약진행중','보류','미예약','단순문의','예약취소'];
  const RESULT_CLS = {'예약확정':'ok','예약진행중':'go','보류':'hold','미예약':'no','단순문의':'info','예약취소':'no'};
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
      .crm-map-row{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.78rem}
      .crm-map-row span{flex:0 0 96px;font-weight:700}
      .crm-map-row select{flex:1;min-width:0;padding:6px 8px;border:none;border-radius:8px;background:var(--nm-white,#fff);box-shadow:var(--nm-shadow-inset);font-size:.78rem}
      .crm-map-row .req{color:#C0262D}
      .crm-preview{display:flex;flex-direction:column;gap:6px;margin-top:10px;max-height:420px;overflow:auto}
      .crm-prow{font-size:.76rem;padding:6px 8px;border-radius:8px;background:var(--nm-white,#fff);line-height:1.6}
      .crm-perr{color:#B91C1C;font-weight:700}
      .crm-item-acts select,.crm-item-acts input[type=date]{padding:5px 8px;border:none;border-radius:8px;background:var(--nm-white,#fff);box-shadow:var(--nm-shadow-inset);font-size:.72rem}
      .crm-link-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;font-size:.8rem;line-height:1.5}
      .crm-link-pair > div{background:var(--nm-surface-light,#eef1f6);border-radius:10px;padding:8px 10px}
      @media(max-width:640px){ .crm-link-pair{grid-template-columns:1fr} }
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
  const LEAD_STATUS_BY_RESULT = {'예약확정':'성사','예약진행중':'연락중','보류':'보류','미예약':'취소','단순문의':'연락중','예약취소':'취소'};
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
        ${c.booking_id ? `<span class="crm-tag ok">🧾 예약 연결됨</span>` : `<button type="button" class="crm-btn" onclick="TGT_CRM.newBookingFromConsult(${c.id})">🧾 예약으로 등록</button>`}
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

  // ══ 3단계 — 예약 데이터 연결 ═══════════════════════════════════════
  const BOOKING_STATUSES = ['예약대기','예약확정','예약취소','출발완료'];
  const BOOKING_CLS = {'예약대기':'go','예약확정':'ok','예약취소':'no','출발완료':'info'};
  // 예약 상태 → 연결된 상담 결과
  const RESULT_BY_BOOKING = {'예약대기':'예약진행중','예약확정':'예약확정','출발완료':'예약확정','예약취소':'예약취소'};
  // 가져오기 대상 항목과 열 이름 자동 인식 단어
  const IMPORT_FIELDS = [
    ['booking_no','예약번호',true,['예약번호','예약 번호','예약no','예약코드','booking','bookingno','reservation','예약id','주문번호']],
    ['booking_status','예약 상태',false,['상태','예약상태','진행상태','status']],
    ['product','상품명',false,['상품','상품명','여행상품','패키지','product','코스명']],
    ['destination','여행지/국가',false,['여행지','국가','지역','목적지','destination','country']],
    ['departure_date','출발일',false,['출발일','출발일자','출발','departure','여행시작일','출국일']],
    ['confirmed_party_size','인원',false,['인원','인원수','총인원','pax','party','명수']],
    ['customer_name','고객명',false,['고객명','예약자','대표자','이름','성명','name','고객']],
    ['customer_phone','연락처',false,['연락처','전화','휴대폰','핸드폰','phone','mobile','전화번호']],
    ['confirmed_at','예약(확정)일',false,['예약일','확정일','예약확정일','예약일자','접수일','booked']],
    ['cancelled_at','취소일',false,['취소일','취소일자','cancelled']],
    ['cancellation_reason','취소 사유',false,['취소사유','취소 사유','사유']],
    ['source_channel','예약 경로',false,['경로','예약경로','유입','채널','channel','source']],
    ['memo','비고',false,['비고','메모','note','memo','특이사항']],
  ];
  const normHeader = h => String(h||'').toLowerCase().replace(/[\s_\-().·]/g,'');
  function guessMapping(headers){
    const map = {}; const used = new Set();
    IMPORT_FIELDS.forEach(([key,,,syn])=>{
      const idx = headers.findIndex((h,i)=>!used.has(i) && syn.some(s=>normHeader(h)===normHeader(s)));
      const idx2 = idx>=0 ? idx : headers.findIndex((h,i)=>!used.has(i) && syn.some(s=>normHeader(h).includes(normHeader(s))));
      if (idx2>=0){ map[key] = idx2; used.add(idx2); }
    });
    return map;
  }
  const MAP_KEY = 'tgt_crm_import_map_v1';
  function savedMapping(headers){ try{ const all = JSON.parse(localStorage.getItem(MAP_KEY)||'{}'); return all[headers.map(normHeader).join('|')] || null; }catch(e){ return null; } }
  function rememberMapping(headers, map){ try{ const all = JSON.parse(localStorage.getItem(MAP_KEY)||'{}'); all[headers.map(normHeader).join('|')] = map; localStorage.setItem(MAP_KEY, JSON.stringify(all)); }catch(e){} }

  // 날짜·인원·상태 정규화(추정하지 않고, 읽을 수 없으면 오류로 돌려준다)
  function toDateStr(v){
    if (v==null || v==='') return null;
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad2(v.getMonth()+1)}-${pad2(v.getDate())}`;
    if (typeof v==='number' && v>20000 && v<80000){ const d = new Date(Math.round((v-25569)*86400000)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`; } // 엑셀 날짜 일련번호
    const s = String(v).trim();
    let m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s);
    if (!m && (m = /^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s))) m = [m[0], '20'+m[1], m[2], m[3]];
    if (!m && (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) m = [m[0], m[3], m[1], m[2]];
    if (!m) return undefined;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo<1 || mo>12 || d<1 || d>31) return undefined;
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  const kstMidnight = d => d ? `${d}T00:00:00+09:00` : null;   // 날짜만 있는 예약일·취소일은 한국 시간 0시로 저장
  function toParty(v){ if (v==null || v==='') return null; const m = /(\d{1,3})/.exec(String(v)); return m ? Number(m[1]) : undefined; }
  function toStatus(v){
    const s = String(v==null?'':v).replace(/\s/g,'').toLowerCase();
    if (!s) return '예약확정';
    if (/취소|환불|cancel/.test(s)) return '예약취소';
    if (/출발완료|여행완료|종료|완료된여행|departed|done/.test(s)) return '출발완료';
    if (/대기|가예약|보류|요청|pending|hold|입금대기/.test(s)) return '예약대기';
    if (/확정|완료|결제|confirm|ok|예약/.test(s)) return '예약확정';
    return undefined;
  }
  const phoneDigits = p => String(p||'').replace(/\D/g,'').replace(/^82/,'0');
  function matchProductByTitle(title){
    const t = String(title||'').trim(); if (!t) return null;
    const prods = allProducts();
    const exact = prods.find(x=>x.title===t); if (exact) return exact;
    const norm = s => s.replace(/\s+/g,'');
    const nt = norm(t);
    return prods.find(x=>x.title && (norm(x.title).includes(nt) || nt.includes(norm(x.title)))) || null;
  }

  // 파일 읽기 — CSV(UTF-8 / 한글 엑셀 CSV의 EUC-KR 자동 판별), XLSX·XLS(SheetJS, 처음 필요할 때만 불러옴)
  let _xlsxLoading = null;
  function loadXlsx(){
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!_xlsxLoading) _xlsxLoading = new Promise((res, rej)=>{ const s = document.createElement('script'); s.src = 'assets/vendor/xlsx-0.18.5.full.min.js'; s.onload = ()=>res(window.XLSX); s.onerror = ()=>{ _xlsxLoading = null; rej(new Error('엑셀 읽기 모듈을 불러오지 못했습니다')); }; document.head.appendChild(s); });
    return _xlsxLoading;
  }
  function parseCsv(text){
    const rows = []; let row = [], cell = '', q = false;
    for (let i=0;i<text.length;i++){
      const ch = text[i];
      if (q){ if (ch==='"'){ if (text[i+1]==='"'){ cell+='"'; i++; } else q = false; } else cell += ch; }
      else if (ch==='"') q = true;
      else if (ch===','){ row.push(cell); cell=''; }
      else if (ch==='\n' || ch==='\r'){ if (ch==='\r' && text[i+1]==='\n') i++; row.push(cell); rows.push(row); row=[]; cell=''; }
      else cell += ch;
    }
    if (cell!=='' || row.length){ row.push(cell); rows.push(row); }
    return rows;
  }
  async function sha256Hex(buf){ const h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
  async function readTableFile(file){
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    let sheets = [];
    if (/\.csv$/i.test(file.name) || file.type==='text/csv'){
      let text;
      try{ text = new TextDecoder('utf-8', {fatal:true}).decode(buf); }catch(e){ text = new TextDecoder('euc-kr').decode(buf); }
      sheets = [{name:'CSV', rows: parseCsv(text.replace(/^﻿/,''))}];
    } else {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(buf, {type:'array', cellDates:true});
      sheets = wb.SheetNames.map(n=>({name:n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1, raw:true, defval:'', blankrows:false})}));
    }
    sheets.forEach(s=>{ s.rows = s.rows.filter(r=>r.some(c=>String(c==null?'':c).trim()!=='')); });
    return {buf, hash, sheets: sheets.filter(s=>s.rows.length)};
  }

  // 가져오기 상태
  const imp = { file:null, data:null, sheet:0, headerRow:0, map:null, preview:null, running:false, result:null, error:'', dupInfo:null };
  function impReset(){ Object.assign(imp, {file:null, data:null, sheet:0, headerRow:0, map:null, preview:null, running:false, result:null, error:'', dupInfo:null}); }
  function impHeaders(){ const rows = imp.data.sheets[imp.sheet].rows; return (rows[imp.headerRow]||[]).map(h=>String(h==null?'':h).trim()); }
  function impBodyRows(){ return imp.data.sheets[imp.sheet].rows.slice(imp.headerRow+1); }
  async function impPickFile(input){
    const file = input.files && input.files[0]; if (!file) return;
    impReset(); imp.file = file; renderBody();
    try{
      imp.data = await readTableFile(file);
      if (!imp.data.sheets.length) throw new Error('읽을 수 있는 행이 없습니다');
      // 같은 파일을 이미 가져왔는지(중복 가져오기 방지)
      const { data:dup } = await sb().from(TABLES.imports).select('id,created_at,file_name').eq('file_sha256', imp.data.hash).eq('status','completed').limit(1);
      imp.dupInfo = dup && dup[0] ? dup[0] : null;
      impDetectHeaderRow(); impAutoMap();
    }catch(e){ imp.error = errText(e); }
    renderBody();
  }
  function impAutoMap(){ const h = impHeaders(); imp.map = savedMapping(h) || guessMapping(h); imp.preview = null; }
  // 머리글 행 자동 찾기 — 맨 위에 "○월 예약 명단" 같은 제목 줄이 있어도 예약번호 열이 있는 첫 행을 머리글로 쓴다
  function impDetectHeaderRow(){
    const rows = imp.data.sheets[imp.sheet].rows;
    for (let i=0;i<Math.min(8, rows.length);i++){
      const h = rows[i].map(x=>String(x==null?'':x).trim());
      if ((savedMapping(h) || guessMapping(h)).booking_no!=null){ imp.headerRow = i; return; }
    }
    imp.headerRow = 0;
  }
  function impSetSheet(i){ imp.sheet = Number(i)||0; impDetectHeaderRow(); impAutoMap(); renderBody(); }
  function impSetHeaderRow(i){ imp.headerRow = Math.max(0, Number(i)||0); impAutoMap(); renderBody(); }
  function impSetMap(key, idx){ if (idx==='') delete imp.map[key]; else imp.map[key] = Number(idx); imp.preview = null; renderBody(); }

  // 미리보기 — 행마다 신규·갱신·변경 없음·오류를 판정
  async function impBuildPreview(){
    if (imp.map.booking_no==null){ imp.error = '예약번호 열을 지정해 주세요(중복 검사·갱신 기준).'; renderBody(); return; }
    imp.error = ''; imp.preview = {loading:true}; renderBody();
    const headers = impHeaders(); rememberMapping(headers, imp.map);
    const get = (r, k) => imp.map[k]==null ? '' : r[imp.map[k]];
    const rows = impBodyRows();
    const parsed = [];
    const seen = {};
    rows.forEach((r, i)=>{
      const lineNo = imp.headerRow + 2 + i;   // 엑셀 행 번호(1부터, 머리글 다음)
      const errs = [];
      const booking_no = String(get(r,'booking_no')==null?'':get(r,'booking_no')).trim();
      if (!booking_no) errs.push('예약번호 없음');
      const status = toStatus(get(r,'booking_status')); if (status===undefined) errs.push(`알 수 없는 상태 "${get(r,'booking_status')}"`);
      const dep = toDateStr(get(r,'departure_date')); if (dep===undefined) errs.push(`출발일 형식 오류 "${get(r,'departure_date')}"`);
      const conf = toDateStr(get(r,'confirmed_at')); if (conf===undefined) errs.push(`예약일 형식 오류 "${get(r,'confirmed_at')}"`);
      const canc = toDateStr(get(r,'cancelled_at')); if (canc===undefined) errs.push(`취소일 형식 오류 "${get(r,'cancelled_at')}"`);
      const party = toParty(get(r,'confirmed_party_size')); if (party===undefined) errs.push(`인원 형식 오류 "${get(r,'confirmed_party_size')}"`);
      const title = String(get(r,'product')||'').trim();
      const prod = title ? matchProductByTitle(title) : null;
      const destRaw = String(get(r,'destination')||'').trim();
      const catId = prod ? prod.catId : (destRaw ? matchCatFromDest(destRaw) : (title ? matchCatFromDest(title) : null));
      const ci = catId ? catInfo(catId) : null;
      const rec = {
        booking_no, booking_status: status, departure_date: dep||null, confirmed_party_size: party==null?null:party,
        product_uid: prod ? prod.uid : null, product_title: prod ? prod.title : (title||null), product_cat: ci ? ci.id : null,
        travel_region: ci ? ci.region : null, country: ci ? (ci.region==='overseas'?ci.ko:'대한민국') : (destRaw||null), destination: ci ? ci.ko : (destRaw||null),
        customer_name: String(get(r,'customer_name')||'').trim() || null, customer_phone: String(get(r,'customer_phone')||'').trim() || null,
        cancellation_reason: String(get(r,'cancellation_reason')||'').trim() || null, source_channel: String(get(r,'source_channel')||'').trim() || null,
        memo: String(get(r,'memo')||'').trim() || null,
        confirmed_at: conf ? kstMidnight(conf) : null, cancelled_at: canc ? kstMidnight(canc) : null,
      };
      if (booking_no){ if (seen[booking_no]!=null) parsed[seen[booking_no]].errs.push(`파일 안 예약번호 중복(${lineNo}행을 사용)`); seen[booking_no] = parsed.length; }
      parsed.push({lineNo, raw:r, rec, errs, productMatched: !!prod});
    });
    // 기존 예약 조회(예약번호 기준)
    const nos = [...new Set(parsed.filter(p=>p.rec.booking_no).map(p=>p.rec.booking_no))];
    const existing = {};
    for (let i=0;i<nos.length;i+=200){
      const { data, error } = await sb().from(TABLES.bookings).select('*').in('booking_no', nos.slice(i,i+200));
      if (error){ imp.preview = null; imp.error = '기존 예약 조회 실패: '+errText(error); renderBody(); return; }
      (data||[]).forEach(b=>existing[b.booking_no]=b);
    }
    const CMP = ['booking_status','departure_date','confirmed_party_size','product_uid','product_title','customer_name','customer_phone','cancellation_reason','source_channel','memo'];
    parsed.forEach(p=>{
      if (p.errs.length){ p.kind = 'error'; return; }
      const ex = existing[p.rec.booking_no];
      if (!ex){ p.kind = 'new'; return; }
      p.existing = ex;
      // 비어 있는 칸은 기존 값을 지우지 않는다(명단에 없는 정보는 유지)
      const patch = {};
      CMP.forEach(k=>{ const v = p.rec[k]; if (v!=null && v!=='' && String(v)!==String(ex[k]==null?'':ex[k])) patch[k] = v; });
      if (!ex.confirmed_at && p.rec.confirmed_at) patch.confirmed_at = p.rec.confirmed_at;
      if (!ex.cancelled_at && p.rec.cancelled_at) patch.cancelled_at = p.rec.cancelled_at;
      if (patch.product_uid || patch.product_title){ ['product_cat','travel_region','country','destination'].forEach(k=>{ if (p.rec[k]) patch[k] = p.rec[k]; }); }
      p.patch = patch;
      p.kind = !Object.keys(patch).length ? 'same' : (patch.booking_status==='예약취소' ? 'cancel' : (patch.departure_date ? 'datechange' : 'update'));
    });
    const cnt = k => parsed.filter(p=>p.kind===k).length;
    imp.preview = {rows:parsed, counts:{new:cnt('new'), update:cnt('update'), cancel:cnt('cancel'), datechange:cnt('datechange'), same:cnt('same'), error:cnt('error')}};
    renderBody();
  }
  const KIND_LABEL = {new:'신규', update:'갱신', cancel:'취소 반영', datechange:'출발일 변경', same:'변경 없음', error:'오류'};
  const KIND_CLS = {new:'ok', update:'go', cancel:'no', datechange:'hold', same:'info', error:'no'};

  async function impRun(){
    if (!imp.preview || !imp.preview.rows || imp.running) return;
    if (imp.dupInfo){ alert(`이 파일은 ${fmtKst(imp.dupInfo.created_at)}에 이미 가져온 파일과 내용이 같아 다시 가져오지 않습니다.`); return; }
    const work = imp.preview.rows.filter(p=>p.kind!=='error' && p.kind!=='same');
    if (!work.length && !confirm('새로 반영할 행이 없습니다. 기록만 남길까요?')) return;
    imp.running = true; imp.error = ''; renderBody();
    const client = sb();
    const report = {inserted:0, updated:0, unchanged:imp.preview.counts.same, errors:imp.preview.rows.filter(p=>p.kind==='error').map(p=>({line:p.lineNo, reason:p.errs.join(', ')})), autoLinked:0, suggested:0, backup:null};
    let importId = null;
    try{
      // 1) 원본 파일 백업(비공개 저장소)
      const kst = todayKst();
      const path = `${kst.y}-${pad2(kst.m)}/${imp.data.hash.slice(0,16)}-${imp.file.name.replace(/[^\w.\-가-힣]/g,'_')}`;
      try{
        const { error:upErr } = await client.storage.from('tgt-booking-imports').upload(path, imp.file, {upsert:false});
        if (upErr && !/exists|Duplicate/i.test(errText(upErr))) throw upErr;
        report.backup = path;
      }catch(e){
        if (!confirm('원본 파일 백업에 실패했습니다('+errText(e)+').\n백업 없이 가져오기를 계속할까요?')){ imp.running = false; renderBody(); return; }
      }
      // 2) 가져오기 기록(끝나면 completed로 바꿈 — 중간에 멈추면 failed로 남아 다시 가져올 수 있음)
      const { data:impRow, error:impErr } = await client.from(TABLES.imports).insert({file_name:imp.file.name, file_sha256:imp.data.hash, storage_path:report.backup, mapping:imp.map, total_rows:imp.preview.rows.length, status:'failed'}).select().single();
      if (impErr) throw impErr;
      importId = impRow.id;
      // 3) 신규·갱신 반영
      const touched = [];
      const news = work.filter(p=>p.kind==='new').map(p=>Object.assign({}, p.rec, {import_id:importId, raw:{line:p.lineNo, cells:p.raw}}));
      for (let i=0;i<news.length;i+=100){
        const { data, error } = await client.from(TABLES.bookings).insert(news.slice(i,i+100)).select();
        if (error) throw error;
        report.inserted += (data||[]).length; touched.push(...(data||[]));
      }
      for (const p of work.filter(p=>p.kind!=='new')){
        const { data, error } = await client.from(TABLES.bookings).update(Object.assign({}, p.patch, {import_id:importId})).eq('id', p.existing.id).select().single();
        if (error){ report.errors.push({line:p.lineNo, reason:'갱신 실패: '+errText(error)}); continue; }
        report.updated++; touched.push(data);
      }
      // 4) 이미 상담과 연결된 예약은 상태(확정·취소·출발완료)를 상담 결과·AI 리드 상태에 반영하고, 나머지는 자동 연결·연결 후보
      for (const b of touched.filter(x=>x && x.consultation_id)) await syncConsultFromBooking(b);
      const lk = await autoLink(touched);
      report.autoLinked = lk.linked; report.suggested = lk.suggested;
      await client.from(TABLES.imports).update({status:'completed', inserted_rows:report.inserted, updated_rows:report.updated, unchanged_rows:report.unchanged, error_rows:report.errors.length, report}).eq('id', importId);
      imp.result = report; state.bookingsLoaded = false;
      logAccess('import_bookings', TABLES.bookings, {import_id:importId, inserted:report.inserted, updated:report.updated});
    }catch(e){
      imp.error = '가져오기 중단: '+errText(e) + (importId ? ' (일부 반영된 행은 다시 가져오면 예약번호 기준으로 갱신됩니다)' : '');
      if (importId) try{ await client.from(TABLES.imports).update({report}).eq('id', importId); }catch(x){}
    }
    imp.running = false; renderBody();
  }
  function impDownloadErrors(){
    if (!imp.preview) return;
    const headers = impHeaders();
    const errLines = new Set(((imp.result && imp.result.errors) || imp.preview.rows.filter(p=>p.kind==='error').map(p=>({line:p.lineNo, reason:p.errs.join(', ')}))).map(e=>e.line));
    const reasonBy = {}; ((imp.result && imp.result.errors) || []).forEach(e=>reasonBy[e.line]=e.reason);
    const rows = imp.preview.rows.filter(p=>errLines.has(p.lineNo));
    const csvCell = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const out = [['행 번호','오류 사유'].concat(headers).map(csvCell).join(',')].concat(rows.map(p=>[p.lineNo, reasonBy[p.lineNo] || p.errs.join(', ')].concat(headers.map((h,i)=>p.raw[i] instanceof Date ? toDateStr(p.raw[i]) : p.raw[i])).map(csvCell).join(',')));
    const blob = new Blob(['﻿'+out.join('\n')], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `예약가져오기_오류행_${Date.now()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  // 상담 ↔ 예약 연결: 연락처가 같고 상품(또는 목적지)이 같은 상담이 하나뿐이면 자동 연결, 애매하면 승인 대기 후보로 남긴다
  async function autoLink(bookings){
    const client = sb(); let linked = 0, suggested = 0;
    const todo = (bookings||[]).filter(b=>b && !b.consultation_id);
    if (!todo.length) return {linked, suggested};
    const { data:cons } = await client.from(TABLES.consultations).select('*').eq('is_deleted', false).order('consulted_at', {ascending:false}).limit(2000);
    const all = cons || [];
    for (const b of todo){
      const bp = phoneDigits(b.customer_phone);
      const sameTrip = c => (b.product_uid && c.product_uid===b.product_uid) || (!b.product_uid && b.product_cat && c.product_cat===b.product_cat) || (b.product_uid && !c.product_uid && c.product_cat===b.product_cat);
      const before = c => !b.confirmed_at || new Date(c.consulted_at) <= new Date(new Date(b.confirmed_at).getTime() + 7*86400000);
      const cands = [];
      all.forEach(c=>{
        if (c.booking_id && c.booking_id!==b.id) return;
        const reasons = []; let score = 0;
        const cp = phoneDigits(c.customer_phone);
        if (bp && cp && bp===cp){ score += 0.6; reasons.push('연락처 일치'); }
        if (b.customer_name && c.customer_name && b.customer_name.replace(/\s/g,'')===c.customer_name.replace(/\s/g,'')){ score += 0.2; reasons.push('고객명 일치'); }
        if (sameTrip(c)){ score += 0.3; reasons.push(c.product_uid && c.product_uid===b.product_uid ? '상품 일치' : '국가·권역 일치'); }
        if (score>=0.5 && before(c)) cands.push({c, score:Math.min(1, score), reasons});
      });
      if (!cands.length) continue;
      // 같은 문의 묶음(후속 상담)은 최초 상담 하나로 본다
      const roots = {}; cands.forEach(x=>{ const k = x.c.parent_id || x.c.id; if (!roots[k] || roots[k].score < x.score) roots[k] = x; });
      const uniq = Object.values(roots).sort((a,b2)=>b2.score-a.score);
      const top = uniq[0];
      const certain = top.reasons.includes('연락처 일치') && top.score>=0.9 && uniq.filter(x=>x.score>=0.9).length===1;
      if (certain){ await linkBookingConsult(b, top.c); linked++; }
      else for (const x of uniq.slice(0,3)){
        const { error } = await client.from(TABLES.links).insert({consultation_id:x.c.id, booking_id:b.id, score:Number(x.score.toFixed(2)), reasons:x.reasons});
        if (!error) suggested++;
      }
    }
    return {linked, suggested};
  }
  // 연결 확정 — 예약에 상담을, 상담에 예약을 기록하고 상담 결과·리드 상태를 예약 상태에 맞춘다
  async function linkBookingConsult(b, c){
    const client = sb();
    await client.from(TABLES.bookings).update({consultation_id:c.id}).eq('id', b.id);
    await syncConsultFromBooking(Object.assign({}, b, {consultation_id:c.id}), c);
    await client.from(TABLES.links).update({status:'rejected', decided_at:new Date().toISOString()}).eq('booking_id', b.id).eq('status','pending').neq('consultation_id', c.id);
    await client.from(TABLES.links).update({status:'approved', decided_at:new Date().toISOString()}).eq('booking_id', b.id).eq('consultation_id', c.id);
  }
  async function syncConsultFromBooking(b, c){
    if (!b.consultation_id) return;
    const client = sb();
    if (!c){ const { data } = await client.from(TABLES.consultations).select('*').eq('id', b.consultation_id).maybeSingle(); c = data; }
    if (!c) return;
    const result = RESULT_BY_BOOKING[b.booking_status];
    const patch = {booking_id:b.id};
    if (result && c.result!==result) patch.result = result;
    const { data } = await client.from(TABLES.consultations).update(patch).eq('id', c.id).select().single();
    if (data){ const i = state.list.findIndex(x=>x.id===data.id); if (i>=0) state.list[i] = data; }
    // 후속 상담이면 최초 상담의 리드까지 따라가 상태를 맞춘다
    const leadId = c.lead_id || (c.parent_id ? ((state.list.find(x=>x.id===c.parent_id)||{}).lead_id) : null);
    if (result) await syncLeadStatus(leadId, result);
  }

  // ── 예약 목록 · 직접 등록 · 상태 변경 ──
  state.bookings = []; state.bookingsLoaded = false; state.bookingFilter = {q:'', status:'', month:''}; state.bookingHist = {}; state.bookingForm = null; state.bookingView = 'list';
  async function loadBookings(force){
    if (state.bookingsLoaded && !force) return;
    await checkReady(); if (!isUsable()) return;
    const { data, error } = await sb().from(TABLES.bookings).select('*').order('departure_date', {ascending:false}).limit(3000);
    if (error){ state.bookingsError = errText(error); return; }
    state.bookings = data||[]; state.bookingsLoaded = true; state.bookingsError = '';
  }
  function bookingFormFromConsult(c){
    return {booking_no:'', product: c.product_uid ? 'uid:'+c.product_uid : (c.product_cat ? 'cat:'+c.product_cat : ''), booking_status:'예약확정',
      departure_date: c.preferred_departure_date || '', confirmed_party_size: c.requested_party_size==null ? '' : String(c.requested_party_size),
      customer_name: c.customer_name||'', customer_phone: c.customer_phone||'', source_channel: c.channel||'', memo:'', consultation_id: c.id};
  }
  function newBookingFromConsult(id){
    const c = state.list.find(x=>x.id===id); if (!c) return;
    state.bookingForm = bookingFormFromConsult(c); state.bookingView = 'form'; go('bookings');
  }
  function newBooking(){ state.bookingForm = {booking_no:'', product:'', booking_status:'예약확정', departure_date:'', confirmed_party_size:'', customer_name:'', customer_phone:'', source_channel:'', memo:'', consultation_id:null}; state.bookingView = 'form'; renderBody(); }
  function bfSet(k, v){ state.bookingForm[k] = v; }
  async function saveBooking(){
    const f = state.bookingForm; if (!f) return;
    const no = String(f.booking_no||'').trim() || `M${todayKst().y%100}${pad2(todayKst().m)}${pad2(todayKst().d)}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    if (!f.product){ alert('상품(또는 국가·권역)을 선택하세요.'); return; }
    const base = formToRow({product:f.product});
    const row = {booking_no:no, booking_status:f.booking_status, departure_date:f.departure_date||null, confirmed_party_size: f.confirmed_party_size==='' ? null : (parseInt(f.confirmed_party_size,10)||null),
      customer_name:(f.customer_name||'').trim()||null, customer_phone:(f.customer_phone||'').trim()||null, source_channel:f.source_channel||null, memo:(f.memo||'').trim()||null,
      consultation_id:f.consultation_id||null, product_uid:base.product_uid||null, product_title:base.product_title||null, product_cat:base.product_cat||null, travel_region:base.travel_region||null, country:base.country||null, destination:base.destination||null};
    const { data, error } = await sb().from(TABLES.bookings).insert(row).select().single();
    if (error){ alert('예약 저장 실패: '+errText(error)); return; }
    if (data.consultation_id) await syncConsultFromBooking(data);
    state.bookings.unshift(data); state.bookingForm = null; state.bookingView = 'list';
    state.bookingFlash = `<div class="crm-banner ok">✅ 예약 ${esc(data.booking_no)} 등록${data.consultation_id?` — 상담 #${data.consultation_id} 결과도 "${esc(RESULT_BY_BOOKING[data.booking_status])}"로 갱신`:''}</div>`;
    renderBody();
  }
  async function changeBooking(id, field, value){
    const b = state.bookings.find(x=>x.id===id); if (!b) return;
    const patch = {};
    if (field==='booking_status'){
      patch.booking_status = value;
      if (value==='예약취소'){ const r = prompt('취소 사유(선택)', b.cancellation_reason||''); if (r===null){ renderBody(); return; } patch.cancellation_reason = r.trim()||null; }
      if (value==='출발완료'){
        const n = prompt('실제 출발 인원을 입력하세요(출발이 확인된 경우에만 출발 완료로 처리됩니다)', b.actual_party_size || b.confirmed_party_size || '');
        if (n===null || !/^\d+$/.test(String(n).trim())){ renderBody(); return; }
        patch.actual_party_size = Number(n); patch.actual_departed_at = new Date().toISOString();
      }
    } else if (field==='departure_date'){ patch.departure_date = value || null; }
    else if (field==='confirmed_party_size'){ patch.confirmed_party_size = value==='' ? null : (parseInt(value,10)||null); }
    const { data, error } = await sb().from(TABLES.bookings).update(patch).eq('id', id).select().single();
    if (error){ alert('변경 실패: '+errText(error)); return; }
    Object.assign(b, data); delete state.bookingHist[id];
    if (field==='booking_status' && data.consultation_id) await syncConsultFromBooking(data);
    renderBody();
  }
  async function bookingHistory(id){
    if (state.bookingHist[id]){ delete state.bookingHist[id]; renderBody(); return; }
    state.bookingHist[id] = {loading:true}; renderBody();
    const { data, error } = await sb().from(TABLES.bookingHistory).select('*').eq('booking_id', id).order('changed_at', {ascending:false}).limit(50);
    state.bookingHist[id] = error ? {error:errText(error)} : {rows:data||[]}; renderBody();
  }
  function bookingsHTML(){
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${state.ready ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    if (state.bookingView==='form' && state.bookingForm) return bookingFormHTML();
    return importHTML() + bookingListHTML();
  }
  function bookingFormHTML(){
    const f = state.bookingForm;
    return `<div class="crm-card"><h5>🧾 예약 직접 등록 ${f.consultation_id?`<span class="crm-note" style="font-weight:500">— 상담 #${f.consultation_id} 내용으로 채움</span>`:''}</h5>
      <div class="crm-grid2">
        <div class="crm-field"><label>예약번호 <span class="crm-note" style="font-weight:500">(비우면 자동 생성)</span></label><input type="text" value="${esc(f.booking_no)}" oninput="TGT_CRM.bfSet('booking_no', this.value)"></div>
        <div class="crm-field"><label>예약 상태</label><select onchange="TGT_CRM.bfSet('booking_status', this.value)">${['예약대기','예약확정'].map(s=>`<option ${f.booking_status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
      <div class="crm-field"><label>상품<span class="req">*</span></label><select onchange="TGT_CRM.bfSet('product', this.value)">${productOptionsHTML(f.product)}</select></div>
      <div class="crm-grid2">
        <div class="crm-field"><label>출발일</label><input type="date" value="${esc(f.departure_date)}" onchange="TGT_CRM.bfSet('departure_date', this.value)"></div>
        <div class="crm-field"><label>확정 인원</label><input type="number" min="0" value="${esc(f.confirmed_party_size)}" oninput="TGT_CRM.bfSet('confirmed_party_size', this.value)"></div>
        <div class="crm-field"><label>고객명</label><input type="text" value="${esc(f.customer_name)}" oninput="TGT_CRM.bfSet('customer_name', this.value)"></div>
        <div class="crm-field"><label>연락처</label><input type="tel" value="${esc(f.customer_phone)}" oninput="TGT_CRM.bfSet('customer_phone', this.value)"></div>
        <div class="crm-field"><label>예약 경로</label><input type="text" value="${esc(f.source_channel)}" oninput="TGT_CRM.bfSet('source_channel', this.value)"></div>
        <div class="crm-field"><label>비고</label><input type="text" value="${esc(f.memo)}" oninput="TGT_CRM.bfSet('memo', this.value)"></div>
      </div>
      <p class="crm-note" style="margin-top:10px">예약 확정일과 최초 출발일은 저장할 때 자동으로 기록되며, 이후 출발일을 바꿔도 최초 값은 그대로 남습니다.</p>
      <div class="crm-actions"><button type="button" class="crm-btn" onclick="TGT_CRM.bookingCancelForm()">취소</button><button type="button" class="crm-btn primary" onclick="TGT_CRM.saveBooking()">예약 저장</button></div>
    </div>`;
  }
  function bookingCancelForm(){ state.bookingForm = null; state.bookingView = 'list'; renderBody(); }
  function importHTML(){
    let inner = '';
    if (imp.result){
      const r = imp.result;
      inner = `<div class="crm-banner ok">✅ 가져오기 완료 — 신규 ${r.inserted}건 · 갱신 ${r.updated}건 · 변경 없음 ${r.unchanged}건 · 오류 ${r.errors.length}건<br>
        상담 자동 연결 ${r.autoLinked}건 · 연결 승인 대기 ${r.suggested}건 ${r.backup?'· 원본 백업 완료':'· ⚠ 원본 백업 없음'}</div>
        <div class="crm-actions">${r.errors.length?`<button type="button" class="crm-btn" onclick="TGT_CRM.impDownloadErrors()">⬇ 오류 행 다운로드</button>`:''}
        ${r.suggested?`<button type="button" class="crm-btn" onclick="TGT_CRM.go('links')">🔗 연결 승인으로</button>`:''}
        <button type="button" class="crm-btn primary" onclick="TGT_CRM.impReset()">다른 파일 가져오기</button></div>`;
    } else if (!imp.file){
      inner = `<p class="crm-note">예약 관리 프로그램·엑셀에서 내려받은 명단(CSV · XLSX)을 올리면, 예약번호를 기준으로 신규·갱신·취소·출발일 변경을 판정해 미리 보여드립니다. 같은 파일은 두 번 가져오지 않습니다.</p>
        <div class="crm-actions" style="justify-content:flex-start"><label class="crm-btn primary" style="display:inline-block">📥 파일 선택<input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="TGT_CRM.impPickFile(this)"></label>
        <button type="button" class="crm-btn" onclick="TGT_CRM.newBooking()">+ 예약 직접 등록</button></div>`;
    } else if (!imp.data){
      inner = imp.error ? `<div class="crm-banner err">${esc(imp.error)}</div><div class="crm-actions"><button type="button" class="crm-btn" onclick="TGT_CRM.impReset()">다시 선택</button></div>` : `<div class="crm-empty">파일을 읽는 중...</div>`;
    } else {
      const headers = impHeaders();
      const sheets = imp.data.sheets;
      const pv = imp.preview;
      inner = `<p class="crm-note"><b>${esc(imp.file.name)}</b> · ${impBodyRows().length}행</p>
        ${imp.dupInfo?`<div class="crm-banner warn">⚠ 이 파일은 ${esc(fmtKst(imp.dupInfo.created_at))}에 이미 가져온 파일과 내용이 같아 다시 가져올 수 없습니다(중복 가져오기 방지).</div>`:''}
        <div class="crm-grid2">
          ${sheets.length>1?`<div class="crm-field"><label>시트</label><select onchange="TGT_CRM.impSetSheet(this.value)">${sheets.map((s,i)=>`<option value="${i}" ${imp.sheet===i?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>`:''}
          <div class="crm-field"><label>머리글(열 이름) 행</label><select onchange="TGT_CRM.impSetHeaderRow(this.value)">${sheets[imp.sheet].rows.slice(0,8).map((r,i)=>`<option value="${i}" ${imp.headerRow===i?'selected':''}>${i+1}행: ${esc(r.slice(0,4).join(' | ').slice(0,40))}</option>`).join('')}</select></div>
        </div>
        <div class="crm-field"><label>열 이름 매핑 <span class="crm-note" style="font-weight:500">(자동 인식 · 다음에는 같은 양식을 기억)</span></label>
          <div class="crm-grid2">${IMPORT_FIELDS.map(([key,label,req])=>`<div class="crm-map-row"><span>${label}${req?'<span class="req">*</span>':''}</span>
            <select onchange="TGT_CRM.impSetMap('${key}', this.value)"><option value="">— 사용 안 함 —</option>${headers.map((h,i)=>`<option value="${i}" ${imp.map[key]===i?'selected':''}>${esc(h||('열 '+(i+1)))}</option>`).join('')}</select></div>`).join('')}</div></div>
        ${imp.error?`<div class="crm-banner err" style="margin-top:10px">${esc(imp.error)}</div>`:''}
        ${pv && pv.rows ? previewHTML(pv) : (pv && pv.loading ? '<div class="crm-empty">미리보기 만드는 중...</div>' : '')}
        <div class="crm-actions">
          <button type="button" class="crm-btn" onclick="TGT_CRM.impReset()">취소</button>
          <button type="button" class="crm-btn" onclick="TGT_CRM.impBuildPreview()">👀 미리보기</button>
          ${pv && pv.rows ? `<button type="button" class="crm-btn" onclick="TGT_CRM.impDownloadErrors()" ${pv.counts.error?'':'disabled'}>⬇ 오류 행</button>
          <button type="button" class="crm-btn primary" ${imp.running||imp.dupInfo?'disabled':''} onclick="TGT_CRM.impRun()">${imp.running?'가져오는 중...':'가져오기 실행'}</button>` : ''}
        </div>`;
    }
    return `<div class="crm-card"><h5>📥 예약 명단 가져오기</h5>${inner}</div>`;
  }
  function previewHTML(pv){
    const c = pv.counts;
    const show = pv.rows.filter(p=>p.kind!=='same').slice(0,60);
    return `<div class="crm-banner ${c.error?'warn':'ok'}" style="margin-top:12px">신규 ${c.new} · 갱신 ${c.update} · 취소 반영 ${c.cancel} · 출발일 변경 ${c.datechange} · 변경 없음 ${c.same} · <b>오류 ${c.error}</b></div>
      <div class="crm-preview">${show.map(p=>`<div class="crm-prow"><span class="crm-tag ${KIND_CLS[p.kind]}">${KIND_LABEL[p.kind]}</span>
        <span class="crm-note">${p.lineNo}행</span> <b>${esc(p.rec.booking_no||'(번호 없음)')}</b> ${esc(p.rec.product_title||p.rec.destination||'')}${p.rec.product_title && !p.productMatched ? ' <span class="crm-note">(등록 상품과 일치 없음)</span>' : ''}
        · ${esc(p.rec.booking_status||'')} · 출발 ${esc(fmtDate(p.rec.departure_date)||'-')} · ${p.rec.confirmed_party_size==null?'-':p.rec.confirmed_party_size+'명'}
        ${p.kind==='error'?`<div class="crm-perr">${esc(p.errs.join(', '))}</div>`:''}
        ${p.patch && Object.keys(p.patch).length ? `<div class="crm-note">${Object.entries(p.patch).filter(([k])=>BK_LABELS[k]).map(([k,v])=>`${BK_LABELS[k]}: ${esc(fmtBk(k, p.existing[k]))} → ${esc(fmtBk(k, v))}`).join(' / ')}</div>` : ''}
      </div>`).join('')}${pv.rows.filter(p=>p.kind!=='same').length>60?`<div class="crm-note">… 외 ${pv.rows.filter(p=>p.kind!=='same').length-60}행</div>`:''}</div>`;
  }
  const BK_LABELS = {booking_status:'상태', departure_date:'출발일', confirmed_party_size:'인원', product_title:'상품', customer_name:'고객명', customer_phone:'연락처', cancellation_reason:'취소 사유', source_channel:'경로', memo:'비고', confirmed_at:'예약일', cancelled_at:'취소일'};
  function fmtBk(k, v){ if (v==null || v==='') return '—'; if (k==='departure_date') return fmtDate(v); if (k==='confirmed_at'||k==='cancelled_at') return fmtKst(v); return String(v); }
  function bookingListHTML(){
    if (!state.bookingsLoaded) return `<div class="crm-card"><div class="crm-empty">${state.bookingsError?'불러오기 실패: '+esc(state.bookingsError):'예약 불러오는 중...'}</div></div>`;
    const bf = state.bookingFilter;
    const qq = bf.q.trim().toLowerCase();
    const items = state.bookings.filter(b=>(!bf.status || b.booking_status===bf.status) && (!bf.month || String(b.departure_date||'').startsWith(bf.month))
      && (!qq || [b.booking_no,b.product_title,b.destination,b.customer_name,b.customer_phone,b.memo].join(' ').toLowerCase().includes(qq)));
    return `<div class="crm-card"><h5>🧾 예약 목록 <span class="crm-note" style="font-weight:500">${items.length}건 / 전체 ${state.bookings.length}건</span></h5>
      ${state.bookingFlash||''}
      <div class="crm-filter">
        <input type="search" placeholder="예약번호·상품·고객 검색" value="${esc(bf.q)}" oninput="TGT_CRM.bFilter('q', this.value)">
        <select onchange="TGT_CRM.bFilter('status', this.value)"><option value="">전체 상태</option>${BOOKING_STATUSES.map(s=>`<option ${bf.status===s?'selected':''}>${s}</option>`).join('')}</select>
        <input type="month" value="${esc(bf.month)}" onchange="TGT_CRM.bFilter('month', this.value)" title="출발 월">
        <button type="button" class="crm-btn" onclick="TGT_CRM.newBooking()">+ 직접 등록</button>
      </div>
      <div class="crm-list" style="margin-top:10px">${items.slice(0,300).map(bookingItemHTML).join('') || '<div class="crm-empty">예약이 없습니다.</div>'}</div>
    </div>`;
  }
  function bookingItemHTML(b){
    const h = state.bookingHist[b.id];
    const changed = b.original_departure_date && b.departure_date && b.original_departure_date!==b.departure_date;
    return `<div class="crm-item">
      <div class="crm-item-top"><span class="crm-tag ${BOOKING_CLS[b.booking_status]||'info'}">${esc(b.booking_status)}</span><b>${esc(b.product_title || b.destination || '(상품 미정)')}</b><span class="crm-note">${esc(b.booking_no)}</span></div>
      <div class="crm-item-meta">${[
        b.departure_date ? `출발 ${fmtDate(b.departure_date)}${changed?` (최초 ${fmtDate(b.original_departure_date)})`:''}` : '출발일 미정',
        b.confirmed_party_size!=null ? `확정 인원 ${b.confirmed_party_size}명` : '', b.actual_party_size!=null ? `실제 출발 ${b.actual_party_size}명` : '',
        b.confirmed_at ? `예약확정일 ${fmtKst(b.confirmed_at)}` : '', b.cancelled_at ? `취소 ${fmtKst(b.cancelled_at)}${b.cancellation_reason?` (${b.cancellation_reason})`:''}` : '',
        b.customer_name ? `고객 ${b.customer_name}` : '', b.source_channel || '', b.consultation_id ? `💬 상담 #${b.consultation_id}` : '🔗 상담 미연결'].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="crm-item-acts">
        <select onchange="TGT_CRM.changeBooking(${b.id}, 'booking_status', this.value)">${BOOKING_STATUSES.map(s=>`<option ${b.booking_status===s?'selected':''}>${s}</option>`).join('')}</select>
        <input type="date" value="${esc(b.departure_date||'')}" onchange="TGT_CRM.changeBooking(${b.id}, 'departure_date', this.value)" title="출발일 변경">
        <button type="button" class="crm-btn" onclick="TGT_CRM.bookingHistory(${b.id})">🕘 이력</button>
        ${b.consultation_id ? '' : `<button type="button" class="crm-btn" onclick="TGT_CRM.findLinks(${b.id})">🔗 상담 찾기</button>`}
      </div>
      ${h ? `<div class="crm-hist">${h.loading?'불러오는 중...':(h.error?esc(h.error):(h.rows.map(x=>`<div class="h"><b>${esc(fmtKst(x.changed_at))}</b> — ${esc(x.from_status||'등록')} → ${esc(x.to_status)}${x.from_departure_date!==x.to_departure_date && x.from_departure_date?` · 출발 ${esc(fmtDate(x.from_departure_date))} → ${esc(fmtDate(x.to_departure_date))}`:''}${x.from_party_size!=null && x.from_party_size!==x.to_party_size?` · 인원 ${x.from_party_size} → ${x.to_party_size}`:''} <span class="crm-note">(${x.source==='import'?'가져오기':'직접'})</span></div>`).join('')||'이력이 없습니다.'))}</div>` : ''}
    </div>`;
  }
  function bFilter(k, v){ state.bookingFilter[k] = v; renderBody(); }
  async function findLinks(bookingId){
    const b = state.bookings.find(x=>x.id===bookingId); if (!b) return;
    const r = await autoLink([b]);
    await loadBookings(true); await loadLinks(true);
    alert(r.linked ? '연락처·상품이 일치하는 상담과 자동 연결했습니다.' : (r.suggested ? `연결 후보 ${r.suggested}건을 "연결 승인"에 올렸습니다.` : '연결할 만한 상담을 찾지 못했습니다(연락처·고객명·상품 기준).'));
    renderBody();
  }

  // ── 연결 승인 ──
  state.links = []; state.linksLoaded = false;
  async function loadLinks(force){
    if (state.linksLoaded && !force) return;
    await checkReady(); if (!isUsable()) return;
    const client = sb();
    const { data, error } = await client.from(TABLES.links).select('*').eq('status','pending').order('created_at', {ascending:false}).limit(300);
    if (error){ state.linksError = errText(error); return; }
    const rows = data||[];
    const cIds = [...new Set(rows.map(r=>r.consultation_id))], bIds = [...new Set(rows.map(r=>r.booking_id))];
    const cons = cIds.length ? ((await client.from(TABLES.consultations).select('*').in('id', cIds)).data||[]) : [];
    const bks = bIds.length ? ((await client.from(TABLES.bookings).select('*').in('id', bIds)).data||[]) : [];
    state.links = rows.map(r=>Object.assign({}, r, {c:cons.find(x=>x.id===r.consultation_id), b:bks.find(x=>x.id===r.booking_id)})).filter(r=>r.c && r.b);
    state.linksLoaded = true; state.linksError = '';
  }
  function linksHTML(){
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${state.ready ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    if (!state.linksLoaded) return `<div class="crm-card"><div class="crm-empty">${state.linksError?'불러오기 실패: '+esc(state.linksError):'불러오는 중...'}</div></div>`;
    return `<div class="crm-card"><h5>🔗 연결 승인 <span class="crm-note" style="font-weight:500">— 자동으로 확정하기 애매한 상담·예약 연결 ${state.links.length}건</span></h5>
      <p class="crm-note">연락처가 같고 상품이 같은 상담이 하나뿐인 경우만 자동 연결합니다. 나머지는 여기서 확인 후 승인하면 상담 결과와 AI 리드 상태가 예약 상태에 맞춰 갱신됩니다.</p>
      <div class="crm-list">${state.links.map(l=>`<div class="crm-item">
        <div class="crm-item-top"><span class="crm-tag go">일치도 ${Math.round(Number(l.score||0)*100)}%</span><span class="crm-note">${(l.reasons||[]).map(esc).join(' · ')}</span></div>
        <div class="crm-link-pair">
          <div><span class="crm-note">💬 상담 #${l.c.id}</span><br><b>${esc(l.c.product_title || l.c.destination || '')}</b><br><span class="crm-note">${esc(fmtKst(l.c.consulted_at))} · ${esc(l.c.result)} · ${esc(l.c.customer_name||'')} ${esc(l.c.customer_phone||'')}</span></div>
          <div><span class="crm-note">🧾 예약 ${esc(l.b.booking_no)}</span><br><b>${esc(l.b.product_title || l.b.destination || '')}</b><br><span class="crm-note">${esc(l.b.booking_status)} · 출발 ${esc(fmtDate(l.b.departure_date)||'-')} · ${esc(l.b.customer_name||'')} ${esc(l.b.customer_phone||'')}</span></div>
        </div>
        <div class="crm-item-acts"><button type="button" class="crm-btn primary" onclick="TGT_CRM.decideLink(${l.id}, true)">✓ 같은 고객 — 연결</button><button type="button" class="crm-btn" onclick="TGT_CRM.decideLink(${l.id}, false)">✕ 다른 고객</button></div>
      </div>`).join('') || '<div class="crm-empty">승인을 기다리는 연결이 없습니다.</div>'}</div></div>`;
  }
  async function decideLink(id, ok){
    const l = state.links.find(x=>x.id===id); if (!l) return;
    if (ok) await linkBookingConsult(l.b, l.c);
    else await sb().from(TABLES.links).update({status:'rejected', decided_at:new Date().toISOString()}).eq('id', id);
    state.bookingsLoaded = false;
    await loadLinks(true); renderBody();
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
      if (state.sub==='list' && !state.listLoaded) loadList().then(renderBody);
      else if (state.sub==='bookings' && !state.bookingsLoaded) loadBookings().then(renderBody);
      else if (state.sub==='links' && !state.linksLoaded) loadLinks().then(renderBody);
      else renderBody();
    });
  }
  function go(sub){
    state.sub = sub; if (sub!=='bookings') state.bookingFlash = '';
    render();
    if (sub==='list') loadList().then(renderBody);
    if (sub==='bookings') loadBookings().then(renderBody);
    if (sub==='links') loadLinks(true).then(renderBody);
  }
  function renderBody(){
    const body = document.getElementById('crmBody'); if (!body) return;
    if (state.sub==='quick') body.innerHTML = quickHTML();
    else if (state.sub==='list') body.innerHTML = listHTML();
    else if (state.sub==='bookings') body.innerHTML = bookingsHTML();
    else if (state.sub==='links') body.innerHTML = linksHTML();
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
    impPickFile, impSetSheet, impSetHeaderRow, impSetMap, impBuildPreview, impRun, impDownloadErrors, impReset:()=>{ impReset(); renderBody(); },
    newBooking, newBookingFromConsult, bfSet, saveBooking, bookingCancelForm, changeBooking, bookingHistory, bFilter, findLinks, decideLink,
    _internal:{ allProducts, checkReady, fmtKst, parseMemo, formToRow, TABLES, state, imp, toDateStr, toStatus, guessMapping, autoLink },
  };
})();
