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
    ['strategy', '🎯 추천·판매 전략'],
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
      .st-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:10px}
      .st-tile{background:var(--nm-white,#fff);border-radius:12px;padding:10px 12px;box-shadow:var(--nm-shadow-raised-sm)}
      .st-l{font-size:.7rem;font-weight:800;color:#52514e}
      .st-v{font-size:1.25rem;font-weight:800;color:#0b0b0b;margin-top:2px}
      .st-s{font-size:.68rem;color:#52514e;margin-top:2px;line-height:1.4}
      .st-bars{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .st-bar{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;gap:8px;align-items:center;font-size:.76rem}
      .st-bl{color:#0b0b0b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .st-bt{height:12px;background:rgba(10,23,48,.05);border-radius:4px;overflow:hidden}
      .st-bf{height:100%;background:#2a78d6;border-radius:0 4px 4px 0}
      .st-bv{font-weight:800;color:#0b0b0b;white-space:nowrap}
      .st-bv span{font-weight:500;color:#52514e;margin-left:4px}
      .st-sm-l{font-size:.74rem;font-weight:800;color:#52514e;margin:12px 0 4px}
      .st-cols{display:flex;gap:2px;align-items:flex-end;overflow-x:auto;padding-bottom:2px}
      .st-col{flex:1 0 26px;display:flex;flex-direction:column;align-items:center;gap:2px}
      .st-cv{font-size:.62rem;font-weight:700;color:#0b0b0b;height:12px}
      .st-cb{width:100%;height:56px;display:flex;align-items:flex-end;background:rgba(10,23,48,.03);border-radius:4px}
      .st-cb > div{width:100%;background:#2a78d6;border-radius:4px 4px 0 0}
      .st-cm{font-size:.6rem;color:#52514e}
      .st-tbl-wrap{overflow-x:auto;margin-top:8px}
      .st-tbl{border-collapse:collapse;width:100%;font-size:.74rem}
      .st-tbl th{background:rgba(10,23,48,.05);font-weight:800;text-align:left;padding:6px 8px;white-space:nowrap;color:#0b0b0b}
      .st-tbl td{padding:6px 8px;border-top:1px solid rgba(10,23,48,.08);vertical-align:top;color:#0b0b0b}
      .st-heat td{text-align:center;min-width:30px;padding:5px 4px}
      .st-heat td.st-rh{text-align:left;white-space:nowrap;font-weight:700}
      .st-short{color:#8A4B00;font-weight:700}
      .it-list{margin:0;padding-left:18px;font-size:.8rem;line-height:1.7}
      .st-tbl td:first-child{min-width:120px;white-space:normal}
      .st-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 18px}
      .st-funnel{display:flex;flex-direction:column;gap:6px;margin-top:6px}
      .st-fn-row{display:grid;grid-template-columns:minmax(110px,30%) 1fr auto;gap:8px;align-items:center;font-size:.76rem}
      .st-fn-l{color:#0b0b0b;font-weight:600}
      .st-fn-t{height:16px;background:rgba(10,23,48,.05);border-radius:4px;overflow:hidden}
      .st-fn-b{height:100%;background:#2a78d6;border-radius:4px}
      .st-fn-v{font-weight:800;color:#0b0b0b;white-space:nowrap}.st-fn-v span{font-weight:500;color:#52514e;margin-left:6px;font-size:.7rem}
      .adv-item{background:var(--nm-white,#fff);border-radius:12px;padding:10px 12px;margin:6px 0;box-shadow:var(--nm-shadow-raised-sm)}
      .adv-h{display:flex;gap:8px;align-items:center;font-size:.84rem;margin-bottom:4px;flex-wrap:wrap}
      .adv-act{font-size:.78rem;color:#1f3a5f;background:rgba(42,120,214,.07);border-radius:8px;padding:6px 9px;margin-top:6px;line-height:1.55}
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
    else if (/^\d{4}-\d{2}$/.test(String(lead.departure_date||''))) f.preferred_departure_month = lead.departure_date;   // 탑승권에서 월 단위로 고른 출발 시기
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

  // ══ 4단계 — 통계 대시보드 ═════════════════════════════════════════
  const MIN_N = 5;   // 표본이 이보다 적으면 "자료 부족"
  const ACTIVE = s => s==='예약확정' || s==='출발완료';
  const KST_MONTH = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit'});
  function monthKeyTs(ts){ if (!ts) return null; const d = new Date(ts); return isNaN(d) ? null : KST_MONTH.format(d).slice(0,7); }
  const monthKeyDate = d => d ? String(d).slice(0,7) : null;
  function monthLabel(k){ const [y,m] = k.split('-'); return `${y.slice(2)}.${m}`; }
  function addMonths(k, n){ let [y,m] = k.split('-').map(Number); m += n; while (m>12){ m-=12; y++; } while (m<1){ m+=12; y--; } return `${y}-${pad2(m)}`; }
  function monthRange(a, b){ const out = []; let k = a; let guard = 0; while (k<=b && guard++<60){ out.push(k); k = addMonths(k,1); } return out; }
  const dayDiff = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  const depTs = d => d ? `${d}T00:00:00+09:00` : null;
  function quantile(sorted, q){ if (!sorted.length) return null; const pos = (sorted.length-1)*q, lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi]-sorted[lo])*(pos-lo); }
  function summarize(vals){
    const v = vals.filter(x=>x!=null && isFinite(x)).sort((a,b)=>a-b);
    if (v.length < MIN_N) return {n:v.length, short:true};
    return {n:v.length, mean:v.reduce((s,x)=>s+x,0)/v.length, median:quantile(v,.5), p25:quantile(v,.25), p75:quantile(v,.75), p90:quantile(v,.9)};
  }
  function partyBucket(n){ if (n==null) return '미확인'; if (n<=2) return '1~2인'; if (n<=4) return '3~4인'; if (n<=8) return '5~8인'; return '9인 이상(단체)'; }
  const BUCKETS = ['1~2인','3~4인','5~8인','9인 이상(단체)','미확인'];

  state.stats = {loaded:false, filter:{period:'12', region:''}, seasonBasis:'departure', seasonGroup:'country'};
  async function loadStats(force){
    if (state.stats.loaded && !force) return;
    await checkReady(); if (!isUsable()) return;
    const client = sb();
    const since = new Date(Date.now() - 400*86400000).toISOString();
    const [c, b, l, ev] = await Promise.all([
      client.from(TABLES.consultations).select('*').eq('is_deleted', false).limit(10000),
      client.from(TABLES.bookings).select('*').limit(10000),
      client.from(LEADS_TABLE_NAME).select('id,created_at,destination,party_size,source,recommended_product,status').limit(10000),   // 개인정보(이름·연락처)는 통계에 불러오지 않음
      client.from(TABLES.events).select('created_at,session_id,event_type,product_uid,product_title,product_cat,travel_region,rank,criteria').gte('created_at', since).order('created_at', {ascending:false}).limit(60000),
    ]);
    if (c.error || b.error){ state.stats.error = errText(c.error || b.error); return; }
    state.stats.cons = c.data||[]; state.stats.bookings = b.data||[]; state.stats.leads = l.error ? [] : (l.data||[]); state.stats.events = ev.error ? [] : (ev.data||[]);
    state.stats.loaded = true; state.stats.error = '';
  }

  // 문의 묶음(최초 상담 + 후속 상담) 단위로 정리
  function buildThreads(cons, bookings){
    const byRoot = {};
    cons.forEach(c=>{ const k = c.parent_id || c.id; (byRoot[k] = byRoot[k] || []).push(c); });
    const bkByCons = {};
    bookings.forEach(b=>{ if (b.consultation_id) (bkByCons[b.consultation_id] = bkByCons[b.consultation_id] || []).push(b); });
    const bkById = {}; bookings.forEach(b=>bkById[b.id]=b);
    return Object.entries(byRoot).map(([rootId, list])=>{
      list.sort((a,b)=>new Date(a.consulted_at)-new Date(b.consulted_at));
      const root = list.find(x=>String(x.id)===String(rootId)) || list[0], last = list[list.length-1];
      const pick = k => { for (let i=list.length-1;i>=0;i--) if (list[i][k]!=null && list[i][k]!=='') return list[i][k]; return null; };
      const bks = []; list.forEach(x=>{ (bkByCons[x.id]||[]).forEach(b=>bks.includes(b)||bks.push(b)); if (x.booking_id && bkById[x.booking_id] && !bks.includes(bkById[x.booking_id])) bks.push(bkById[x.booking_id]); });
      const active = bks.filter(b=>ACTIVE(b.booking_status));
      const prefs = [...new Set([].concat(...list.map(x=>x.preferences||[])))].filter(p=>p!=='특별한 취향 없음');
      return {
        id:Number(rootId), list, first_inquiry_at: root.first_inquiry_at || root.consulted_at, lastResult:last.result,
        product_uid: pick('product_uid'), product_title: pick('product_title'), product_cat: pick('product_cat'), travel_region: pick('travel_region'), country: pick('country'), destination: pick('destination'),
        party: pick('requested_party_size'), group_type: pick('group_type'), unbooked_reason: pick('unbooked_reason'), barrier: pick('party_booking_barrier'),
        preferred_month: pick('preferred_departure_month'), preferred_date: pick('preferred_departure_date'), lead_id: root.lead_id || pick('lead_id'),
        prefs, bookings:bks, activeBookings:active, converted: active.length>0 || last.result==='예약확정',
        cancelled: bks.length>0 && bks.every(b=>b.booking_status==='예약취소'),
      };
    });
  }
  function statsData(){
    const S = state.stats, f = S.filter;
    const now = todayKst(); const nowKey = `${now.y}-${pad2(now.m)}`;
    const startKey = f.period==='all' ? null : (f.period==='ytd' ? `${now.y}-01` : addMonths(nowKey, -(Number(f.period)-1)));
    const inRegion = x => !f.region || x.travel_region===f.region;
    const inPeriodTs = ts => !startKey || (monthKeyTs(ts)||'') >= startKey;
    const threadsAll = buildThreads(S.cons, S.bookings);
    const threads = threadsAll.filter(t=>inRegion(t) && inPeriodTs(t.first_inquiry_at));
    const bookings = S.bookings.filter(b=>inRegion(b) && inPeriodTs(b.confirmed_at || b.created_at));
    const leadIdsRecorded = new Set(S.cons.map(c=>c.lead_id).filter(Boolean));
    const leads = S.leads.filter(l=>inPeriodTs(l.created_at));
    return {threads, bookings, threadsAll, leads, leadIdsRecorded, startKey, nowKey};
  }

  // ── 표시 도구(단일 색상 막대·숫자 카드·표) ──
  const fmtN = n => n==null ? '—' : Number(n).toLocaleString('ko-KR');
  const pct = (a, b) => b>=MIN_N ? `${Math.round(a/b*100)}%` : (b ? `자료 부족(${a}/${b})` : '—');
  const days = v => v==null ? '—' : `${Math.round(v)}일`;
  const tile = (label, value, sub) => `<div class="st-tile"><div class="st-l">${label}</div><div class="st-v">${value}</div>${sub?`<div class="st-s">${sub}</div>`:''}</div>`;
  function barList(rows, unit){
    if (!rows.length) return '<div class="crm-empty">자료가 없습니다.</div>';
    const max = Math.max(...rows.map(r=>r.value), 1);
    return `<div class="st-bars">${rows.map(r=>`<div class="st-bar" title="${esc(r.label)}: ${fmtN(r.value)}${unit||''}${r.sub?' · '+esc(r.sub):''}"><div class="st-bl">${esc(r.label)}</div>
      <div class="st-bt"><div class="st-bf" style="width:${Math.max(2, r.value/max*100)}%"></div></div><div class="st-bv">${fmtN(r.value)}${unit||''}${r.sub?`<span>${esc(r.sub)}</span>`:''}</div></div>`).join('')}</div>`;
  }
  function monthBars(months, vals, unit, sub){
    const max = Math.max(...vals, 1);
    return `<div class="st-cols">${months.map((m,i)=>`<div class="st-col" title="${monthLabel(m)}: ${fmtN(vals[i])}${unit||''}${sub && sub[i]?' · '+sub[i]:''}">
      <div class="st-cv">${vals[i]?fmtN(vals[i]):''}</div><div class="st-cb"><div style="height:${vals[i]?Math.max(3, vals[i]/max*100):0}%"></div></div><div class="st-cm">${monthLabel(m)}</div></div>`).join('')}</div>`;
  }
  const table = (head, rows) => `<div class="st-tbl-wrap"><table class="st-tbl"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  function heatTable(rowKeys, colKeys, getVal, rowLabel){
    const max = Math.max(1, ...rowKeys.map(r=>Math.max(0, ...colKeys.map(c=>getVal(r,c)||0))));
    return `<div class="st-tbl-wrap"><table class="st-tbl st-heat"><thead><tr><th>${rowLabel}</th>${colKeys.map(c=>`<th>${monthLabel(c)}</th>`).join('')}</tr></thead><tbody>${rowKeys.map(r=>`<tr><td class="st-rh">${esc(r)}</td>${colKeys.map(c=>{ const v = getVal(r,c)||0; return `<td style="background:${v?`rgba(42,120,214,${(0.12+0.6*v/max).toFixed(2)})`:'transparent'};${v/max>0.6?'color:#fff;':''}" title="${esc(r)} · ${monthLabel(c)}: ${v}">${v||''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const countBy = (arr, keyFn) => { const m = {}; arr.forEach(x=>{ const k = keyFn(x); if (k==null || k==='') return; [].concat(k).forEach(kk=>{ m[kk] = (m[kk]||0)+1; }); }); return m; };
  const topRows = (m, n) => Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0, n||12).map(([label,value])=>({label, value}));
  const productKey = x => x.product_title || (x.destination ? `${x.destination} (상품 미정)` : '미지정');
  const countryKey = x => x.travel_region==='domestic' ? (x.destination || '국내') : (x.country || x.destination || '미지정');

  function statsHTML(){
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${state.ready ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    const S = state.stats;
    if (!S.loaded) return `<div class="crm-card"><div class="crm-empty">${S.error?'불러오기 실패: '+esc(S.error):'통계를 계산하는 중...'}</div></div>`;
    const D = statsData(), T = D.threads, B = D.bookings, f = S.filter;
    const activeB = B.filter(b=>ACTIVE(b.booking_status));
    const cancelledB = B.filter(b=>b.booking_status==='예약취소');
    const waitingB = B.filter(b=>b.booking_status==='예약대기');
    const people = activeB.reduce((s,b)=>s+(b.confirmed_party_size||0),0);
    const converted = T.filter(t=>t.converted).length;
    const holds = T.filter(t=>t.lastResult==='보류').length, fails = T.filter(t=>t.lastResult==='미예약').length, tCancelled = T.filter(t=>t.lastResult==='예약취소' || t.cancelled).length;
    const unrecordedLeads = D.leads.filter(l=>!D.leadIdsRecorded.has(l.id)).length;
    const unlinkedB = B.filter(b=>!b.consultation_id).length;
    const records = T.reduce((s,t)=>s+t.list.length,0);

    // 상품별 성과
    const prodMap = {};
    T.forEach(t=>{ const k = productKey(t); const p = prodMap[k] = prodMap[k] || {threads:0, conv:0, reasons:{}, people:0, bookings:0}; p.threads++; if (t.converted) p.conv++; if ((t.lastResult==='보류'||t.lastResult==='미예약') && t.unbooked_reason) p.reasons[t.unbooked_reason] = (p.reasons[t.unbooked_reason]||0)+1; });
    activeB.forEach(b=>{ const k = productKey(b); const p = prodMap[k] = prodMap[k] || {threads:0, conv:0, reasons:{}, people:0, bookings:0}; p.bookings++; p.people += b.confirmed_party_size||0; });
    const prodRows = Object.entries(prodMap).sort((a,b)=>(b[1].threads+b[1].bookings)-(a[1].threads+a[1].bookings)).slice(0,20)
      .map(([k,p])=>[esc(k), fmtN(p.threads), fmtN(p.bookings), p.threads ? pct(p.conv, p.threads) : '—', fmtN(p.people)+'명', Object.entries(p.reasons).sort((a,b)=>b[1]-a[1]).map(([r,n])=>`${esc(r)} ${n}`).join(', ') || '—']);

    // 월 범위(문의·확정·출발)
    const monthsSeen = [].concat(T.map(t=>monthKeyTs(t.first_inquiry_at)), B.map(b=>monthKeyTs(b.confirmed_at)), B.map(b=>monthKeyDate(b.departure_date))).filter(Boolean).sort();
    const mStart = D.startKey || (monthsSeen[0] || D.nowKey);
    const mEnd = [monthsSeen[monthsSeen.length-1] || D.nowKey, D.nowKey].sort().pop();
    let months = monthRange(mStart, mEnd); if (months.length>24) months = months.slice(-24);
    const inqByM = countBy(T, t=>monthKeyTs(t.first_inquiry_at));
    const confByM = countBy(B.filter(b=>b.confirmed_at && b.booking_status!=='예약대기'), b=>monthKeyTs(b.confirmed_at));
    const depByM = countBy(activeB, b=>monthKeyDate(b.departure_date));
    const depPeopleByM = {}; activeB.forEach(b=>{ const k = monthKeyDate(b.departure_date); if (k) depPeopleByM[k] = (depPeopleByM[k]||0)+(b.confirmed_party_size||0); });

    // 리드타임(일)
    const lt = (filterFn) => {
      const tt = T.filter(filterFn), bb = activeB.filter(filterFn);
      const inqToConf = [], inqToDep = [];
      tt.forEach(t=>t.activeBookings.forEach(b=>{ if (b.confirmed_at){ const d = dayDiff(t.first_inquiry_at, b.confirmed_at); if (d>=0) inqToConf.push(d); } if (b.departure_date){ const d = dayDiff(t.first_inquiry_at, depTs(b.departure_date)); if (d>=0) inqToDep.push(d); } }));
      const confToDep = bb.filter(b=>b.confirmed_at && b.departure_date).map(b=>dayDiff(b.confirmed_at, depTs(b.departure_date))).filter(d=>d>=0);
      return {inqToConf:summarize(inqToConf), confToDep:summarize(confToDep), inqToDep:summarize(inqToDep)};
    };
    const ltAll = lt(()=>true), ltDom = lt(x=>x.travel_region==='domestic'), ltOv = lt(x=>x.travel_region==='overseas');
    const ltCell = s => s.short ? `<span class="st-short">자료 부족 (${s.n}건)</span>` : `평균 ${days(s.mean)} · 중앙값 <b>${days(s.median)}</b><br><span class="crm-note">P25–P75 ${days(s.p25)}~${days(s.p75)} · P90 ${days(s.p90)} · ${s.n}건</span>`;

    // 희망 출발 월 vs 실제 출발 월
    const diffs = [];
    T.forEach(t=>{ const pm = t.preferred_month || (t.preferred_date ? t.preferred_date.slice(0,7)+'-01' : null); if (!pm) return; t.activeBookings.forEach(b=>{ if (!b.departure_date) return; const [y1,m1] = pm.split('-').map(Number), [y2,m2] = b.departure_date.split('-').map(Number); diffs.push((y2*12+m2)-(y1*12+m1)); }); });
    const diffDist = {'같은 달':0,'1개월 빠름':0,'1개월 늦음':0,'2개월 이상 빠름':0,'2개월 이상 늦음':0};
    diffs.forEach(d=>{ if (d===0) diffDist['같은 달']++; else if (d===-1) diffDist['1개월 빠름']++; else if (d===1) diffDist['1개월 늦음']++; else if (d<0) diffDist['2개월 이상 빠름']++; else diffDist['2개월 이상 늦음']++; });

    // 취소·출발일 변경
    const dateChanged = B.filter(b=>b.booking_status!=='예약취소' && b.original_departure_date && b.departure_date && b.original_departure_date!==b.departure_date);
    const shiftDays = dateChanged.map(b=>dayDiff(depTs(b.original_departure_date), depTs(b.departure_date)));
    const cancelReasons = topRows(countBy(cancelledB, b=>b.cancellation_reason || '사유 미기록'), 6);
    const decided = B.filter(b=>b.booking_status!=='예약대기').length;

    // 시즌 분포
    const basis = S.seasonBasis, grp = S.seasonGroup;
    const seasonItems = basis==='inquiry' ? T.map(t=>({k: grp==='product'?productKey(t):countryKey(t), m: monthKeyTs(t.first_inquiry_at)}))
      : basis==='booking' ? B.filter(b=>b.confirmed_at && b.booking_status!=='예약대기').map(b=>({k: grp==='product'?productKey(b):countryKey(b), m: monthKeyTs(b.confirmed_at)}))
      : activeB.map(b=>({k: grp==='product'?productKey(b):countryKey(b), m: monthKeyDate(b.departure_date)}));
    const seasonRows = topRows(countBy(seasonItems, x=>x.m ? x.k : null), 15).map(r=>r.label);
    const seasonVal = (r, c) => seasonItems.filter(x=>x.k===r && x.m===c).length;

    // 인원 구간
    const bucketT = countBy(T, t=>partyBucket(t.party)), bucketConv = countBy(T.filter(t=>t.converted), t=>partyBucket(t.party));
    const bucketB = countBy(activeB, b=>partyBucket(b.confirmed_party_size));
    const inqBucketMonth = (bk, m) => T.filter(t=>partyBucket(t.party)===bk && monthKeyTs(t.first_inquiry_at)===m).length;
    const bkBucketMonth = (bk, m) => activeB.filter(b=>partyBucket(b.confirmed_party_size)===bk && monthKeyTs(b.confirmed_at)===m).length;
    const surchargeLost = T.filter(t=>!t.converted && (t.unbooked_reason==='소인원 추가요금' || t.barrier==='소인원 추가요금')).length;
    const minShort = T.filter(t=>!t.converted && (t.unbooked_reason==='인원 미달' || t.barrier==='최소 출발 인원 미달')).length;
    const groupT = T.filter(t=>(t.party||0)>=9 || t.group_type==='동호회' || t.group_type==='기업');
    const groupPeople = activeB.filter(b=>(b.confirmed_party_size||0)>=9).reduce((s,b)=>s+b.confirmed_party_size,0);
    const countryBucketRows = topRows(countBy(T, t=>countryKey(t)), 12).map(r=>r.label);

    const filterBar = `<div class="crm-filter">
      <select onchange="TGT_CRM.statFilter('period', this.value)">${[['3','최근 3개월'],['6','최근 6개월'],['12','최근 12개월'],['ytd','올해'],['all','전체']].map(([v,l])=>`<option value="${v}" ${f.period===v?'selected':''}>${l}</option>`).join('')}</select>
      <select onchange="TGT_CRM.statFilter('region', this.value)">${[['','국내+해외'],['overseas','해외'],['domestic','국내']].map(([v,l])=>`<option value="${v}" ${f.region===v?'selected':''}>${l}</option>`).join('')}</select>
      <button type="button" class="crm-btn" onclick="TGT_CRM.reloadStats()">🔄 새로 계산</button>
      <span class="crm-note">기간 기준: 상담=최초 문의일, 예약=확정일 · 한국 시간 · 표본 ${MIN_N}건 미만은 "자료 부족"</span></div>`;

    return `<div class="crm-card">${filterBar}
      <div class="st-tiles">
        ${tile('상담 문의', fmtN(T.length)+'건', `상담 기록 ${fmtN(records)}건(후속 포함)`)}
        ${tile('예약 확정', fmtN(activeB.length)+'건', `예약 인원 ${fmtN(people)}명`)}
        ${tile('상담 → 예약 전환율', pct(converted, T.length), `${converted} / ${T.length} 문의`)}
        ${tile('예약 취소', fmtN(cancelledB.length)+'건', decided ? `확정·취소 중 ${pct(cancelledB.length, decided)}` : '')}
        ${tile('상담 기록률', D.leads.length ? pct(D.leads.length-unrecordedLeads, D.leads.length) : '—', `홈페이지 문의 ${D.leads.length}건 중 기록 ${D.leads.length-unrecordedLeads}건`)}
        ${tile('예약의 상담 연결', B.length ? pct(B.length-unlinkedB, B.length) : '—', `상담 없이 들어온 예약 ${unlinkedB}건`)}
      </div>
      <h5 style="margin-top:14px">결과 구분</h5>
      ${barList([{label:'기록되지 않은 상담(홈페이지 문의 미기록)', value:unrecordedLeads},{label:'예약 보류(상담 결과 보류)', value:holds},{label:'예약 대기(예약 명단)', value:waitingB.length},{label:'예약 실패(미예약)', value:fails},{label:'예약 취소', value:tCancelled + cancelledB.filter(b=>!b.consultation_id).length}], '건')}
    </div>

    <div class="crm-card"><h5>📦 상품별 상담·예약</h5>
      ${prodRows.length ? table(['상품','상담 문의','예약 확정','전환율','예약 인원','미예약·보류 사유'], prodRows) : '<div class="crm-empty">자료가 없습니다.</div>'}</div>

    <div class="crm-card"><h5>💚 고객 선호 스타일 <span class="crm-note" style="font-weight:500">(문의 기준)</span></h5>${barList(topRows(countBy(T, t=>t.prefs), 12), '건')}</div>

    <div class="crm-card"><h5>📅 문의 월 · 예약 확정 월 · 출발 월 비교</h5>
      <p class="crm-note">같은 상품도 문의·예약·출발 시점이 다릅니다. 세 줄을 같은 달 기준으로 나란히 비교하세요.</p>
      <div class="st-sm-l">최초 문의 (건)</div>${monthBars(months, months.map(m=>inqByM[m]||0), '건')}
      <div class="st-sm-l">예약 확정 (건)</div>${monthBars(months, months.map(m=>confByM[m]||0), '건')}
      <div class="st-sm-l">출발 (건 · 막대에 마우스를 올리면 인원)</div>${monthBars(months, months.map(m=>depByM[m]||0), '건', months.map(m=>depPeopleByM[m]?`${depPeopleByM[m]}명`:''))}
      ${table(['월','최초 문의','예약 확정','출발 건수','출발 인원'], months.filter(m=>inqByM[m]||confByM[m]||depByM[m]).map(m=>[monthLabel(m), fmtN(inqByM[m]||0), fmtN(confByM[m]||0), fmtN(depByM[m]||0), fmtN(depPeopleByM[m]||0)+'명']))}
    </div>

    <div class="crm-card"><h5>⏱ 리드타임 — 문의·예약·출발 사이 기간</h5>
      ${table(['구분','문의 → 예약 확정','예약 확정 → 출발','문의 → 출발'], [['전체', ltCell(ltAll.inqToConf), ltCell(ltAll.confToDep), ltCell(ltAll.inqToDep)], ['국내', ltCell(ltDom.inqToConf), ltCell(ltDom.confToDep), ltCell(ltDom.inqToDep)], ['해외', ltCell(ltOv.inqToConf), ltCell(ltOv.confToDep), ltCell(ltOv.inqToDep)]])}
      <p class="crm-note">문의 → 예약은 상담과 연결된 예약만 계산합니다(연결 승인 필요). P25–P75는 가운데 50% 고객의 범위입니다.</p></div>

    <div class="crm-card"><h5>🎯 희망 출발 월 vs 실제 출발 월</h5>
      ${diffs.length>=MIN_N ? barList(Object.entries(diffDist).map(([label,value])=>({label, value})), '건') + `<p class="crm-note">평균 차이 ${(diffs.reduce((s,x)=>s+x,0)/diffs.length).toFixed(1)}개월 (양수=희망보다 늦게 출발) · ${diffs.length}건</p>` : `<div class="crm-empty">자료 부족 (${diffs.length}건) — 상담에 희망 출발 월을 기록하고 예약과 연결하면 쌓입니다.</div>`}</div>

    <div class="crm-card"><h5>↩️ 예약 취소 · 출발일 변경</h5>
      <div class="st-tiles">
        ${tile('예약 취소', fmtN(cancelledB.length)+'건', decided ? `취소율 ${pct(cancelledB.length, decided)}` : '')}
        ${tile('출발일 변경', fmtN(dateChanged.length)+'건', dateChanged.length ? `평균 ${Math.round(shiftDays.reduce((s,x)=>s+x,0)/dateChanged.length)}일 이동` : '')}
      </div>
      ${cancelReasons.length ? `<div class="st-sm-l">취소 사유</div>${barList(cancelReasons, '건')}` : ''}</div>

    <div class="crm-card"><h5>🗓 시즌 분포</h5>
      <div class="crm-filter">
        <select onchange="TGT_CRM.statSeason('seasonBasis', this.value)">${[['departure','출발 월 기준'],['booking','예약 확정 월 기준'],['inquiry','최초 문의 월 기준']].map(([v,l])=>`<option value="${v}" ${basis===v?'selected':''}>${l}</option>`).join('')}</select>
        <select onchange="TGT_CRM.statSeason('seasonGroup', this.value)">${[['country','국가·지역별'],['product','상품별']].map(([v,l])=>`<option value="${v}" ${grp===v?'selected':''}>${l}</option>`).join('')}</select>
      </div>
      ${seasonRows.length ? heatTable(seasonRows, months, seasonVal, grp==='product'?'상품':'국가·지역') : '<div class="crm-empty">자료가 없습니다.</div>'}</div>

    <div class="crm-card"><h5>👥 인원 구간</h5>
      <div class="st-tiles">
        ${tile('소인원 추가요금으로 미예약', fmtN(surchargeLost)+'건', '확인된 사유만')}
        ${tile('최소 출발 인원 미달', fmtN(minShort)+'건', '확인된 사유만')}
        ${tile('단체 문의', fmtN(groupT.length)+'건', `단체(9인+) 확정 ${fmtN(groupPeople)}명`)}
      </div>
      ${table(['인원 구간','문의','예약 확정','전환율'], BUCKETS.map(bk=>[bk, fmtN(bucketT[bk]||0), fmtN(bucketB[bk]||0), (bucketT[bk]||0) ? pct(bucketConv[bk]||0, bucketT[bk]) : '—']))}
      <div class="st-sm-l">월별 인원 구간별 문의 (최초 문의 월)</div>${heatTable(BUCKETS, months, inqBucketMonth, '인원')}
      <div class="st-sm-l">월별 인원 구간별 예약 (예약 확정 월)</div>${heatTable(BUCKETS, months, bkBucketMonth, '인원')}
      <div class="st-sm-l">국가·지역별 인원 수요 (문의)</div>
      ${countryBucketRows.length ? table(['국가·지역'].concat(BUCKETS), countryBucketRows.map(k=>[esc(k)].concat(BUCKETS.map(bk=>fmtN(T.filter(t=>countryKey(t)===k && partyBucket(t.party)===bk).length))))) : '<div class="crm-empty">자료가 없습니다.</div>'}
      <p class="crm-note">문의 건수와 인원, 예약 건수와 인원은 따로 집계합니다. 인원 미기록 문의는 "미확인"으로 둡니다.</p></div>
    ${visitorHTML(D)}
    ${advisorHTML(D)}`;
  }
  // 홈페이지 방문자 반응(익명) — 관심 지표일 뿐 상담·예약 실적에는 넣지 않는다
  // ══ 홈페이지 방문 행동(익명) — 관심 지표일 뿐 상담·예약 실적에는 넣지 않는다 ══════════════
  const ACTION_TYPES = ['call_click','kakao_click','form_start','recommend_inquiry','inquiry_submit'];
  const EVT_LABEL = {page_view:'방문', category_view:'국가·권역 카드 열기', recommend_search:'AI 추천 검색', recommend_view:'추천 노출', recommend_click:'추천 상품 상세 보기',
    recommend_inquiry:'추천 → 상담 신청 이동', product_view:'상품 상세 보기', detail_view:'상세 정독', form_start:'상담 신청서 작성 시작', inquiry_submit:'상담 신청 제출',
    call_click:'전화 버튼', kakao_click:'카카오톡 버튼', channel_click:'블로그·유튜브·밴드'};
  const VISIT_MIN = 30;   // 방문 분석을 판단할 최소 방문 수
  function eventsInScope(D){
    const f = state.stats.filter;
    return (state.stats.events||[]).filter(e=>(!D.startKey || (monthKeyTs(e.created_at)||'') >= D.startKey) && (!f.region || !e.travel_region || e.travel_region===f.region));
  }
  const crit = e => (e && e.criteria && typeof e.criteria==='object') ? e.criteria : {};
  const sessSet = (ev, pred) => new Set(ev.filter(pred).map(e=>e.session_id));
  function visitStats(ev){
    const visits = sessSet(ev, e=>e.event_type==='page_view');
    const allSess = new Set(ev.map(e=>e.session_id));
    const base = visits.size ? visits : allSess;   // 방문 기록 이전 데이터는 행동이 있는 탭 수로 대신
    const inBase = s => !visits.size || visits.has(s);
    const S = pred => new Set([...sessSet(ev, pred)].filter(inBase));
    const explore = S(e=>['category_view','product_view','recommend_search','recommend_view'].includes(e.event_type));
    const reco = S(e=>e.event_type==='recommend_search' || e.event_type==='recommend_view');
    const detail = S(e=>e.event_type==='product_view');
    const action = S(e=>ACTION_TYPES.includes(e.event_type));
    const submit = S(e=>e.event_type==='inquiry_submit');
    return {visits, allSess, base, explore, reco, detail, action, submit, hasPV: visits.size>0};
  }
  function dayKeyKst(ts){ const d = new Date(ts); return isNaN(d) ? null : new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul'}).format(d); }
  function dayBars(days, vals){
    const max = Math.max(...vals, 1);
    return `<div class="st-cols">${days.map((d,i)=>`<div class="st-col" title="${d}: ${fmtN(vals[i])}회"><div class="st-cv">${vals[i]?fmtN(vals[i]):''}</div><div class="st-cb"><div style="height:${vals[i]?Math.max(3, vals[i]/max*100):0}%"></div></div><div class="st-cm">${Number(d.slice(8))}</div></div>`).join('')}</div>`;
  }
  function funnelHTML(steps){
    const first = steps[0].n || 1;
    return `<div class="st-funnel">${steps.map((s,i)=>{ const prev = i ? steps[i-1].n : s.n; const conv = i && prev ? Math.round(s.n/prev*100) : null;
      return `<div class="st-fn-row" title="${esc(s.label)}: ${fmtN(s.n)}회${conv!=null?` · 앞 단계의 ${conv}%`:''}"><div class="st-fn-l">${esc(s.label)}</div>
        <div class="st-fn-t"><div class="st-fn-b" style="width:${Math.max(2, s.n/first*100)}%"></div></div>
        <div class="st-fn-v">${fmtN(s.n)}<span>${i ? (conv!=null ? `앞 단계의 ${conv}%` : '') : '기준'}</span></div></div>`; }).join('')}</div>`;
  }
  function visitorHTML(D){
    const ev = eventsInScope(D);
    if (!ev.length) return `<div class="crm-card"><h5>🖱️ 홈페이지 방문 행동</h5><div class="crm-empty">아직 기록이 없습니다. 방문자가 홈페이지를 이용하면 쌓입니다(관리자 로그인 중 사용은 기록하지 않음).</div></div>`;
    const V = visitStats(ev), base = V.base.size;
    const pct = (a, b) => b ? `${Math.round(a/b*100)}%` : '—';
    const pv = ev.filter(e=>e.event_type==='page_view');
    // 유입·기기
    const refs = topRows(countBy(pv, e=>{ const r = crit(e).ref || 'direct'; return r==='direct' ? '직접 방문·북마크' : (r==='internal' ? '사이트 내 이동' : r); }), 8);
    const utms = topRows(countBy(pv.filter(e=>crit(e).utm), e=>[crit(e).utm.source, crit(e).utm.campaign].filter(Boolean).join(' / ')), 6);
    const dev = countBy(pv, e=>crit(e).device==='mobile' ? '모바일' : 'PC');
    const devAct = k => { const ss = new Set(pv.filter(e=>(crit(e).device==='mobile' ? '모바일' : 'PC')===k).map(e=>e.session_id)); return {n:ss.size, a:[...ss].filter(s=>V.action.has(s)).length}; };
    // 일별 방문(최근 30일)
    const days = []; for (let i=29;i>=0;i--) days.push(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul'}).format(new Date(Date.now()-i*86400000)));
    const visitByDay = {}; (V.hasPV ? pv : ev).forEach(e=>{ const k = dayKeyKst(e.created_at); if (k) (visitByDay[k] = visitByDay[k] || new Set()).add(e.session_id); });
    // 행동 종류별 건수
    const typeRows = Object.keys(EVT_LABEL).map(t=>({label:EVT_LABEL[t], value:ev.filter(e=>e.event_type===t).length, sub:`${fmtN(sessSet(ev, e=>e.event_type===t).size)}회 방문`})).filter(r=>r.value);
    // 고객이 찾는 조건(AI 추천 검색)
    const srch = ev.filter(e=>e.event_type==='recommend_search');
    const cRows = (fn, n) => topRows(countBy(srch, fn), n||8);
    const regionL = v => ({domestic:'국내', overseas:'해외'})[v] || '상관없음';
    const budgetL = v => v==='any' || !v ? '상관없음' : (typeof AI_BUDGET_LABEL==='object' && AI_BUDGET_LABEL[v]) || v;
    const durL = v => v==='any' || !v ? '상관없음' : (typeof AI_DURATION_LABEL==='object' && AI_DURATION_LABEL[v]) || v;
    const depL = v => !v || v==='any' ? '미정' : `${Number(String(v).slice(5,7))}월`;
    const styleL = v => ((typeof STYLE_OPTIONS!=='undefined' && STYLE_OPTIONS.find(o=>o.value===v)) || {label:v}).label.replace(/^[^\wㄱ-힣]+\s*/,'');
    const thin = srch.filter(e=>(crit(e).matched||0) < 3).length, none = srch.filter(e=>!(crit(e).matched||0)).length;
    // 국가·권역 관심
    const catV = {}; ev.filter(e=>e.event_type==='category_view' && e.product_cat).forEach(e=>{ (catV[e.product_cat] = catV[e.product_cat] || new Set()).add(e.session_id); });
    const prods = allProducts(), vis = x => typeof isProductVisible!=='function' || isProductVisible(x.p);
    const catRows = Object.entries(catV).map(([cid, ss])=>{ const ci = catInfo(cid); const ps = prods.filter(x=>x.catId===cid && vis(x));
      const pvS = sessSet(ev, e=>e.event_type==='product_view' && e.product_cat===cid);
      return {name: ci ? ci.ko : cid, n: ss.size, prods: ps.length, detail: pvS.size, act: [...pvS].filter(s=>V.action.has(s)).length}; }).sort((a,b)=>b.n-a.n).slice(0, 12);
    // 상품별 반응
    const byP = {};
    ev.filter(e=>e.product_uid || e.product_title).forEach(e=>{ const k = e.product_uid || e.product_title; const r = byP[k] = byP[k] || {title:e.product_title||k, detail:new Set(), d50:0, d90:0, rv:0, rc:0, ri:0, call:0, kakao:0, ranks:[]};
      if (e.event_type==='product_view') r.detail.add(e.session_id); else if (e.event_type==='detail_view'){ if (crit(e).depth>=90) r.d90++; else r.d50++; }
      else if (e.event_type==='recommend_view'){ r.rv++; if (e.rank) r.ranks.push(e.rank); } else if (e.event_type==='recommend_click') r.rc++; else if (e.event_type==='recommend_inquiry') r.ri++;
      else if (e.event_type==='call_click') r.call++; else if (e.event_type==='kakao_click') r.kakao++; });
    const pRows = Object.values(byP).sort((a,b)=>(b.detail.size+b.rv/10)-(a.detail.size+a.rv/10)).slice(0, 15);
    const fs = sessSet(ev, e=>e.event_type==='form_start').size, sub = ev.filter(e=>e.event_type==='inquiry_submit').length;
    return `<div class="crm-card"><h5>🖱️ 홈페이지 방문 행동 <span class="crm-note" style="font-weight:500">— 익명 기록(이름·연락처·IP 없음) · 관심 지표이며 상담·예약 실적에는 넣지 않음 · 기간·권역 필터 적용</span></h5>
      ${V.hasPV ? '' : `<div class="crm-banner warn">방문 수 기록이 아직 없어 "행동이 있었던 방문"을 기준으로 계산합니다. <code>docs/sql/2026-10-26_visitor_insights.sql</code>을 실행하면 방문·유입 경로·검색 조건까지 기록됩니다.</div>`}
      <div class="st-tiles">
        ${tile(V.hasPV ? '방문' : '행동이 있었던 방문', fmtN(base)+'회', V.hasPV ? `행동 기록 ${fmtN(ev.length)}건` : '탭 단위')}
        ${tile('AI 추천 이용', pct(V.reco.size, base), `${fmtN(V.reco.size)}회 방문`)}
        ${tile('상품 상세 조회', pct(V.detail.size, base), `${fmtN(V.detail.size)}회 방문`)}
        ${tile('상담 행동(전화·카톡·신청)', pct(V.action.size, base), `${fmtN(V.action.size)}회 방문`)}
        ${tile('상담 신청 제출', fmtN(sub)+'건', fs ? `작성 시작 ${fmtN(fs)}회 · 제출률 ${pct(sub, fs)}` : '작성 시작 기록 없음')}
      </div>
      <div class="st-sm-l">방문 → 상담까지(방문 수 기준)</div>
      ${funnelHTML([{label:V.hasPV?'방문':'행동이 있었던 방문', n:base}, {label:'여행지·상품 탐색', n:V.explore.size}, {label:'상품 상세 보기', n:V.detail.size}, {label:'상담 행동(전화·카톡·신청서)', n:V.action.size}, {label:'상담 신청 제출', n:V.submit.size}])}
      <div class="st-sm-l">최근 30일 일별 방문</div>${dayBars(days, days.map(d=>(visitByDay[d]||new Set()).size))}
      <div class="st-grid2">
        <div><div class="st-sm-l">유입 경로</div>${refs.length ? barList(refs, '회') : '<div class="crm-empty">방문 기록 후 표시</div>'}
          ${utms.length ? `<div class="st-sm-l">광고·캠페인(utm)</div>${barList(utms, '회')}` : ''}</div>
        <div><div class="st-sm-l">기기</div>${Object.keys(dev).length ? table(['기기','방문','상담 행동','상담 행동 비율'], ['모바일','PC'].filter(k=>dev[k]).map(k=>{ const x = devAct(k); return [k, fmtN(x.n), fmtN(x.a), pct(x.a, x.n)]; })) : '<div class="crm-empty">방문 기록 후 표시</div>'}
          <div class="st-sm-l">행동 종류별</div>${barList(typeRows, '건')}</div>
      </div>
      <div class="st-sm-l">고객이 AI 추천에서 고른 조건 ${srch.length ? `(검색 ${fmtN(srch.length)}회 · 조건 충족 상품 3개 미만 ${fmtN(thin)}회 · 0개 ${fmtN(none)}회)` : ''}</div>
      ${srch.length ? `<div class="st-grid2">
          <div><div class="st-sm-l" style="margin-top:4px">예산(1인)</div>${barList(cRows(e=>budgetL(crit(e).budget)), '회')}<div class="st-sm-l">일정</div>${barList(cRows(e=>durL(crit(e).duration)), '회')}</div>
          <div><div class="st-sm-l" style="margin-top:4px">권역 · 출발 시기</div>${barList(cRows(e=>regionL(crit(e).region), 3).concat(cRows(e=>depL(crit(e).depart), 7)), '회')}<div class="st-sm-l">선호 스타일</div>${barList(cRows(e=>(crit(e).styles||[]).map(styleL), 10), '회')}</div>
        </div>
        ${srch.some(e=>(crit(e).details||[]).length) ? `<div class="st-sm-l">세부 조건(출발·항공 · 숙박 · 코스 · 식사·관광 · 이동 · 동반·가격)</div>${barList(cRows(e=>(crit(e).details||[]).map(k=>(typeof AI_DETAIL_LABEL==='object' && AI_DETAIL_LABEL[k]) || k), 12), '회')}` : ''}` : '<div class="crm-empty">AI 추천 검색 기록이 아직 없습니다(SQL 실행 후 기록).</div>'}
      <div class="st-sm-l">국가·권역 관심도</div>
      ${catRows.length ? table(['국가·권역','카드 열기(방문)','판매 중 상품','상품 상세 본 방문','그중 상담 행동'], catRows.map(r=>[esc(r.name), fmtN(r.n), r.prods ? fmtN(r.prods) : '<b style="color:#B91C1C">0</b>', fmtN(r.detail), `${fmtN(r.act)} (${pct(r.act, r.detail)})`])) : '<div class="crm-empty">국가·권역 카드 기록이 아직 없습니다(SQL 실행 후 기록).</div>'}
      <div class="st-sm-l">상품별 반응</div>
      ${pRows.length ? table(['상품','상세 본 방문','정독 50% / 90%','추천 노출','추천 클릭률','상담 이동','전화 / 카톡(상세)'], pRows.map(r=>[esc(r.title), fmtN(r.detail.size), `${fmtN(r.d50+r.d90)} / ${fmtN(r.d90)}`, fmtN(r.rv), r.rv ? pct(r.rc, r.rv) : '—', fmtN(r.ri), `${fmtN(r.call)} / ${fmtN(r.kakao)}`])) : '<div class="crm-empty">상품 기록이 아직 없습니다.</div>'}
      <p class="crm-note">방문은 브라우저 탭 단위입니다. 같은 사람이 다른 날 다시 오면 다른 방문으로 셉니다. 비율은 방문 수가 적으면 크게 흔들리므로 방문 ${VISIT_MIN}회 이상부터 판단에 쓰세요.</p></div>`;
  }

  // ══ 경영 진단·제안 — 통계 지표를 근거로 부족한 상품·보완할 조건을 제안(규칙 기반, 근거 숫자 표시) ══════
  function productGaps(x){
    const p = x.p, miss = [];
    const price = (p.priceEntries && p.priceEntries[0] && Number(p.priceEntries[0].salePrice)) || Number(p.from) || 0;
    if (!price && !p.priceInquiry) miss.push('판매가');
    if (!/([0-9]+)\s*박/.test(p.nights||'')) miss.push('일정(박수)');
    const pe = (p.priceEntries||[])[0] || {};
    const eff = f => (typeof peEff==='function' && p.priceEntries && p.priceEntries[0]) ? peEff(p, pe, f) : p[f];
    const plain = v => String(v==null?'':(Array.isArray(v)?v.join(' '):v)).replace(/<[^>]+>/g,'').trim();
    if (!/\d+\s*R/i.test(plain(eff('rounds')) || p.rounds || '')) miss.push('라운드 수');
    if (x.region==='overseas' && !p.flightTime) miss.push('비행시간');
    if (!p.transferTime && !p.hotelToGolfTime) miss.push('이동 시간');
    if (!p.lodgeLocation || p.lodgeLocation==='none') miss.push('숙소 위치');
    if (typeof cardTagsOf==='function' && !cardTagsOf(p).length) miss.push('카드 태그');
    if (!plain(eff('minPeople'))) miss.push('최소 인원');
    if (!plain(eff('included')) && !plain(p.commonIncluded)) miss.push('포함사항');
    if (!((p.gallery||[]).length >= 3)) miss.push('사진 3장 이상');
    if (typeof productFieldPosts==='function' && !productFieldPosts(x.catId, x.idx).length) miss.push('현장 후기 연결');
    return miss;
  }
  function supplyFor(c){
    if (typeof aiScoreProduct!=='function') return null;
    return allProducts().filter(x=>(typeof isProductVisible!=='function' || isProductVisible(x.p)) && (!c.region || c.region==='any' || x.region===c.region))
      .filter(x=>!aiScoreProduct(x.catId, x.idx, x.p, catInfo(x.catId) ? findCat(x.catId) : null, Object.assign({region:'any', budget:'any', duration:'any', depart:'any', styles:[]}, c)).fails.length);
  }
  function advisorHTML(D){
    const ev = eventsInScope(D), V = visitStats(ev), T = D.threads;
    const srch = ev.filter(e=>e.event_type==='recommend_search');
    const items = [];   // {grp, pri:0~3, title, ev:[근거], act}
    const pct = (a, b) => b ? Math.round(a/b*100) : 0;
    const budgetL = v => (typeof AI_BUDGET_LABEL==='object' && AI_BUDGET_LABEL[v]) || v;
    const durL = v => (typeof AI_DURATION_LABEL==='object' && AI_DURATION_LABEL[v]) || v;
    const condText = c => [c.region==='domestic'?'국내':(c.region==='overseas'?'해외':''), c.budget && c.budget!=='any' ? `1인 ${budgetL(c.budget)}` : '', c.duration && c.duration!=='any' ? durL(c.duration) : '', c.depart && c.depart!=='any' ? `${Number(String(c.depart).slice(5,7))}월 출발` : ''].filter(Boolean).join(' · ') || '조건 없음';
    const prods = allProducts().filter(x=>typeof isProductVisible!=='function' || isProductVisible(x.p));
    const hold = [];
    // 1) 검색 수요 대비 상품 공급 부족 — 조건 조합별
    if (srch.length >= 20){
      const g = {};
      srch.forEach(e=>{ const c = crit(e); const k = [c.region||'any', c.budget||'any', c.duration||'any', c.depart||'any'].join('|'); (g[k] = g[k] || {c, n:0, thin:0}).n++; if ((c.matched||0) < 3) g[k].thin++; });
      Object.values(g).filter(x=>x.n>=3 && x.n/srch.length>=0.08).sort((a,b)=>b.n-a.n).slice(0, 6).forEach(x=>{
        const sup = supplyFor({region:x.c.region, budget:x.c.budget, duration:x.c.duration, depart:x.c.depart});
        if (sup && sup.length <= 2) items.push({grp:'add', pri: x.n/srch.length>=0.2 ? 3 : 2, title:`${condText(x.c)} 상품 추가`,
          ev:[`AI 추천 검색 ${fmtN(srch.length)}회 중 ${fmtN(x.n)}회(${pct(x.n, srch.length)}%)가 이 조건`, `현재 이 조건을 모두 충족하는 판매 상품 ${sup.length}개${sup.length ? ` (${sup.slice(0,3).map(s=>esc(s.title)).join(', ')})` : ''}`],
          act:`이 조건에 맞는 상품을 ${Math.max(1, 3-sup.length)}개 이상 더 등록하면 조건에 맞는 추천이 3개 이상이 됩니다. 이미 비슷한 상품이 있다면 판매가·일정·추천 판매 시기 값이 조건과 맞게 등록됐는지 먼저 확인하세요.`});
      });
      const fails = {}; srch.forEach(e=>Object.entries(crit(e).fails||{}).forEach(([k,v])=>{ fails[k] = (fails[k]||0) + v; }));
      const tot = Object.values(fails).reduce((a,b)=>a+b,0);
      const FN = {budget:'예산', duration:'일정(박수)', depart:'출발 시기(판매 시기)'};
      const topF = Object.entries(fails).sort((a,b)=>b[1]-a[1])[0];
      if (topF && tot && topF[1]/tot >= 0.45) items.push({grp:'cond', pri:2, title:`"${FN[topF[0]]||topF[0]}" 조건 때문에 추천에서 빠지는 상품이 가장 많음`,
        ev:[`검색 결과에서 상품이 조건 미충족으로 빠진 경우 중 ${pct(topF[1], tot)}%가 ${FN[topF[0]]||topF[0]} 때문`],
        act: topF[0]==='budget' ? '고객 예산대에 맞춘 실속형 요금 항목(평일·비수기·숙박 등급 조정)을 기존 상품에 추가하는 것을 검토하세요.'
          : topF[0]==='duration' ? '같은 상품에 다른 박수(예: 3박 → 2박·4박) 일정 옵션을 추가하는 것을 검토하세요.'
          : '판매 시기가 지난 상품의 다음 시즌 요금을 등록하거나, 판매 가능한 달을 "추천 판매 시기"에 정확히 넓혀 주세요.'});
      const none = srch.filter(e=>!(crit(e).matched||0)).length;
      if (none/srch.length >= 0.2) items.push({grp:'add', pri:3, title:'조건에 맞는 상품이 하나도 없는 검색이 많음', ev:[`검색 ${fmtN(srch.length)}회 중 ${fmtN(none)}회(${pct(none, srch.length)}%)는 조건 충족 상품 0개 — 고객은 "조건을 넓힌 대안"만 봄`], act:'위 "상품 추가" 항목의 조건 조합부터 상품을 보강하세요.'});
      // 2) 선호 스타일 수요 대비 상품
      const st = countBy(srch, e=>crit(e).styles||[]);
      Object.entries(st).filter(([,n])=>n/srch.length>=0.1 && n>=3).forEach(([style, n])=>{
        const sup = supplyFor({styles:[style]}); if (!sup) return;
        const match = sup.filter(x=>{ const r = aiScoreProduct(x.catId, x.idx, x.p, findCat(x.catId), {region:'any', budget:'any', duration:'any', depart:'any', styles:[style]}); return r.why.some(w=>w.ok===true); });
        if (match.length <= 2){ const lab = ((typeof STYLE_OPTIONS!=='undefined' && STYLE_OPTIONS.find(o=>o.value===style)) || {label:style}).label;
          items.push({grp:'add', pri: n/srch.length>=0.2 ? 3 : 2, title:`'${lab}' 취향 상품 보강`, ev:[`검색의 ${pct(n, srch.length)}%(${fmtN(n)}회)가 이 취향 선택`, `상품 정보에서 이 취향이 확인되는 판매 상품 ${match.length}개`],
            act:`이 취향에 맞는 상품을 추가하거나, 이미 해당하는 상품이 있다면 카드 태그·대표 문구에 관련 표현을 넣어 주세요(추천은 등록된 표현으로만 판단합니다).`}); }
      });
      // 2-1) 세부 조건(출발 공항·항공·이동·라운드 등) 수요 대비 — 맞는 상품이 적은지, 정보가 비어서 판단이 안 되는지 구분
      if (typeof aiDetailTest==='function' && typeof aiProdFacts==='function'){
        const dt = countBy(srch, e=>crit(e).details||[]);
        Object.entries(dt).filter(([,n])=>n>=3 && n/srch.length>=0.1).forEach(([k, n])=>{
          const lab = (typeof AI_DETAIL_LABEL==='object' && AI_DETAIL_LABEL[k]) || k;
          const res = prods.map(x=>aiDetailTest(k, aiProdFacts(x.p, x.catId)).v);
          const yes = res.filter(v=>v===true).length, unk = res.filter(v=>v===null).length;
          if (unk >= prods.length*0.5) items.push({grp:'fix', pri:2, title:`'${esc(lab)}' 판단에 필요한 상품 정보가 비어 있음`, ev:[`검색의 ${pct(n, srch.length)}%(${fmtN(n)}회)가 이 조건 선택`, `판매 중 ${prods.length}개 중 ${unk}개는 관련 정보 미등록으로 '미확인'`], act:'고객이 자주 고르는 조건입니다. 상품 편집에서 해당 정보(출발 공항·항공 포함·출발 요일·비행/이동시간·라운드·식사·최소 인원·등급 등)를 채우면 추천에 바로 반영됩니다.'});
          else if (yes <= 2) items.push({grp:'add', pri: n/srch.length>=0.2 ? 3 : 2, title:`'${esc(lab)}' 조건에 맞는 상품 보강`, ev:[`검색의 ${pct(n, srch.length)}%(${fmtN(n)}회)가 이 조건 선택`, `이 조건이 확인되는 판매 상품 ${yes}개 / ${prods.length}개`], act:'이 조건을 충족하는 상품(또는 요금 항목)을 추가하는 것을 검토하세요.'});
        });
      }
      // 3) 희망 출발 월 대비 판매 상품
      const dep = countBy(srch.filter(e=>crit(e).depart && crit(e).depart!=='any'), e=>crit(e).depart);
      const depTot = Object.values(dep).reduce((a,b)=>a+b,0);
      Object.entries(dep).filter(([,n])=>depTot>=10 && n/depTot>=0.15).forEach(([m, n])=>{
        const sup = supplyFor({depart:m}); if (sup && sup.length <= Math.max(2, prods.length*0.2))
          items.push({grp:'add', pri:2, title:`${Number(m.slice(5,7))}월 출발 상품 보강`, ev:[`출발 시기를 고른 검색의 ${pct(n, depTot)}%(${fmtN(n)}회)가 ${Number(m.slice(5,7))}월`, `${Number(m.slice(5,7))}월이 판매 시기에 포함된 상품 ${sup.length}개 / 판매 중 ${prods.length}개`], act:'이 달에 판매할 수 있는 상품을 추가하거나 기존 상품의 해당 월 요금을 등록하세요. 수요가 몰리는 달이므로 티타임·객실을 미리 확보하는 것도 검토하세요.'});
      });
    } else hold.push(`AI 추천 검색 ${fmtN(srch.length)}회 — 상품 공백·취향·출발 시기 분석은 20회 이상부터`);
    // 4) 관심 국가 대비 상품 수
    const catV = {}; ev.filter(e=>e.event_type==='category_view' && e.product_cat).forEach(e=>{ (catV[e.product_cat] = catV[e.product_cat] || new Set()).add(e.session_id); });
    const catTot = Object.values(catV).reduce((a,s)=>a+s.size,0);
    if (catTot >= 20) Object.entries(catV).forEach(([cid, ss])=>{ const n = prods.filter(x=>x.catId===cid).length; const ci = catInfo(cid);
      if (ss.size/catTot >= 0.12 && n <= 1) items.push({grp:'add', pri:2, title:`${ci?ci.ko:cid} 상품 추가`, ev:[`국가·권역 카드 열기의 ${pct(ss.size, catTot)}%(${fmtN(ss.size)}회)가 ${ci?ci.ko:cid}`, `판매 중 상품 ${n}개`], act:'관심에 비해 고를 수 있는 상품이 적습니다. 일정·가격대가 다른 상품을 1~2개 더 등록하세요.'}); });
    else hold.push(`국가·권역 카드 열기 ${fmtN(catTot)}회 — 관심 국가 분석은 20회 이상부터`);
    // 5) 상세는 많이 보는데 상담 행동이 적은 상품 + 부족한 정보
    const pv = {}; ev.filter(e=>e.event_type==='product_view' && e.product_uid).forEach(e=>{ (pv[e.product_uid] = pv[e.product_uid] || new Set()).add(e.session_id); });
    const avgRate = V.detail.size ? [...V.detail].filter(s=>V.action.has(s)).length / V.detail.size : 0;
    Object.entries(pv).filter(([,ss])=>ss.size>=10).forEach(([uid, ss])=>{
      const x = productByUid(uid); if (!x) return;
      const a = [...ss].filter(s=>V.action.has(s)).length, rate = a/ss.size;
      const d50 = new Set(ev.filter(e=>e.event_type==='detail_view' && e.product_uid===uid).map(e=>e.session_id)).size;
      const gaps = productGaps(x);
      if (avgRate && rate < avgRate*0.5) items.push({grp:'fix', pri:2, title:`${esc(x.title)} — 관심 대비 상담 전환 낮음`,
        ev:[`상세를 본 방문 ${fmtN(ss.size)}회 중 상담 행동 ${fmtN(a)}회(${pct(a, ss.size)}%) · 전체 평균 ${Math.round(avgRate*100)}%`, d50 ? `상세를 절반 이상 읽은 방문 ${fmtN(d50)}회(${pct(d50, ss.size)}%)` : '상세 정독 기록 없음', gaps.length ? `비어 있는 정보: ${gaps.join(', ')}` : '주요 정보는 모두 등록됨'],
        act: gaps.length ? `먼저 비어 있는 정보(${gaps.slice(0,4).join(', ')})를 채우세요. 그다음 가격 근거(포함사항·요금 비교)와 현장 후기를 상단에 보이게 하면 상담으로 이어질 가능성이 높아집니다.` : '정보는 갖춰져 있으니 가격 경쟁력·출발 요일·최소 인원 조건을 점검하고, 상세 상단에 핵심 장점과 후기를 배치해 보세요.'});
    });
    // 6) 추천 노출 대비 클릭이 낮은 상품
    const rv = {}, rc = {}; ev.forEach(e=>{ if (!e.product_uid) return; if (e.event_type==='recommend_view') rv[e.product_uid] = (rv[e.product_uid]||0)+1; if (e.event_type==='recommend_click') rc[e.product_uid] = (rc[e.product_uid]||0)+1; });
    const rvTot = Object.values(rv).reduce((a,b)=>a+b,0), rcTot = Object.values(rc).reduce((a,b)=>a+b,0), ctr = rvTot ? rcTot/rvTot : 0;
    Object.entries(rv).filter(([,n])=>n>=30).forEach(([uid, n])=>{ const x = productByUid(uid); const c = rc[uid]||0;
      if (x && ctr && c/n < ctr*0.4) items.push({grp:'expose', pri:1, title:`${esc(x.title)} — 추천 카드 클릭률 낮음`, ev:[`추천 노출 ${fmtN(n)}회 중 상세 보기 ${fmtN(c)}회(${pct(c, n)}%) · 전체 평균 ${Math.round(ctr*100)}%`], act:'카드 대표 이미지(타이틀 이미지)·상품명·카드 태그가 상품의 장점을 바로 보여 주는지 점검하세요.'}); });
    // 7) 상담 신청서 이탈
    const fsN = sessSet(ev, e=>e.event_type==='form_start').size, subN = ev.filter(e=>e.event_type==='inquiry_submit').length;
    if (fsN >= 10 && subN/fsN < 0.4) items.push({grp:'cond', pri:2, title:'상담 신청서 작성 중 이탈이 많음', ev:[`작성 시작 ${fmtN(fsN)}회 중 제출 ${fmtN(subN)}건(${pct(subN, fsN)}%)`], act:'필수 입력을 이름·연락처·희망 여행지 정도로 줄이고, 신청서 옆에 카카오톡 바로 상담을 함께 보여 주세요.'});
    // 8) 모바일 전환
    const pvE = ev.filter(e=>e.event_type==='page_view');
    const devRate = k => { const ss = new Set(pvE.filter(e=>(crit(e).device==='mobile')===(k==='m')).map(e=>e.session_id)); return {n:ss.size, r: ss.size ? [...ss].filter(s=>V.action.has(s)).length/ss.size : 0}; };
    const mo = devRate('m'), pc = devRate('d');
    if (mo.n >= 30 && pc.n >= 30 && mo.r < pc.r*0.6) items.push({grp:'expose', pri:2, title:'모바일 방문의 상담 전환이 PC보다 낮음', ev:[`모바일 ${fmtN(mo.n)}회 방문 중 상담 행동 ${Math.round(mo.r*100)}% · PC ${fmtN(pc.n)}회 중 ${Math.round(pc.r*100)}%`], act:'모바일 상세 페이지에서 요금·전화·카카오 버튼이 첫 화면 가까이에 보이는지, 사진이 너무 길게 이어지지 않는지 점검하세요.'});
    // 9) 상담 기록의 미예약 사유 → 조건 보완
    const rs = countBy(T.filter(t=>!t.converted && t.unbooked_reason), t=>t.unbooked_reason);
    const RS_ACT = {'가격':['cond','가격 때문에 예약하지 않은 상담이 많음','실속형 요금(평일·비수기·숙박 등급 조정)이나 얼리버드 요금을 추가하는 것을 검토하세요.'], '일정 불일치':['cond','고객이 원하는 일정과 맞지 않는 상담이 많음','출발 요일·박수 옵션을 늘리거나 판매 시기를 넓히는 것을 검토하세요.'], '인원 미달':['cond','인원 조건 때문에 성사되지 않은 상담이 많음','2인 출발·다른 팀 합류형 일정을 운영 조건에 등록하고 상품으로 만드는 것을 검토하세요.'], '소인원 추가요금':['cond','소인원 추가요금이 예약을 막고 있음','소인원 추가요금을 줄인 합류형 출발일을 정해 공지하는 것을 검토하세요.'], '원하는 상품 없음':['add','원하는 상품이 없어 놓친 상담이 많음','기획·운영 진단의 "적합한 등록 상품이 없는 고객 수요"에서 국가·취향 조합을 확인하고 상품을 추가하세요.']};
    Object.entries(rs).filter(([k,n])=>n>=3 && RS_ACT[k]).forEach(([k,n])=>items.push({grp:RS_ACT[k][0], pri: n>=6 ? 3 : 2, title:RS_ACT[k][1], ev:[`기간 내 미예약·보류 상담 중 사유 "${k}" ${fmtN(n)}건`], act:RS_ACT[k][2]}));
    // 10) 추천 근거가 부족한 상품(데이터 품질) — 기록 양과 무관하게 항상 점검
    const gapList = prods.map(x=>({x, g:productGaps(x)})).filter(o=>o.g.length);
    if (gapList.length){ const cnt = countBy(gapList, o=>o.g); const top = topRows(cnt, 6);
      items.push({grp:'fix', pri:1, title:`추천·상세 정보가 비어 있는 상품 ${gapList.length}개 / 판매 중 ${prods.length}개`, ev:[`많이 비어 있는 항목: ${top.map(r=>`${esc(r.label)} ${r.value}개`).join(', ')}`],
        act:'AI 추천은 등록된 값으로만 상품을 고르고 근거를 보여 줍니다. 판매가·일정·라운드·판매 시기·숙소 위치·카드 태그를 채우면 추천 정확도와 상세 페이지 신뢰도가 함께 올라갑니다.'}); }
    // 화면
    const GRP = {add:['🆕 추가해야 할 상품','hold'], fix:['🛠 기존 상품 보완','go'], cond:['⚙️ 조건·운영 보완','info'], expose:['📣 노출·전환 개선','ok']};
    const PRI = ['참고','참고','보통','높음'];
    const body = Object.entries(GRP).map(([k,[label]])=>{ const list = items.filter(i=>i.grp===k).sort((a,b)=>b.pri-a.pri); if (!list.length) return '';
      return `<div class="st-sm-l">${label} <span class="crm-note">${list.length}건</span></div>${list.map(i=>`<div class="adv-item"><div class="adv-h"><span class="crm-tag ${i.pri>=3?'no':(i.pri===2?'hold':'info')}">${PRI[i.pri]}</span><b>${i.title}</b></div>
        <ul class="it-list">${i.ev.map(x=>`<li>${x}</li>`).join('')}</ul><div class="adv-act">💡 ${esc(i.act)}</div></div>`).join('')}`; }).join('');
    return `<div class="crm-card"><h5>🧭 경영 진단·제안 <span class="crm-note" style="font-weight:500">— 홈페이지 방문 행동 + 상담·예약 기록 + 상품 정보를 함께 본 규칙 기반 제안 · 기간·권역 필터 적용</span></h5>
      ${body || '<div class="crm-empty">지금 기준으로 눈에 띄는 문제는 없습니다.</div>'}
      ${hold.length ? `<div class="st-sm-l">판단 보류</div><ul class="it-list">${hold.map(h=>`<li>${h}</li>`).join('')}</ul>` : ''}
      <p class="crm-note">제안은 기록된 숫자에서 나온 점검 항목이며 매출 증가를 보장하지 않습니다. 원가·현지 운영 조건을 확인한 뒤 결정하세요. 상담 기록 기반 진단은 "💡 기획·운영 진단"에도 있습니다.</p></div>`;
  }
  function statFilter(k, v){ state.stats.filter[k] = v; renderBody(); }
  function statSeason(k, v){ state.stats[k] = v; renderBody(); }
  async function reloadStats(){ state.stats.loaded = false; renderBody(); await loadStats(true); renderBody(); }

  // ══ 5단계 — 상품 운영 조건 · 출발 그룹 · 기획/운영 진단 ═════════════════════
  // 확보 필요 시점 기본 기준(일) — 출발일로부터 며칠 전까지 확보해야 하는지. 운영하며 바뀌면 이 값만 고치면 된다
  const SECURE_LEAD = { overseas:{teetime:60, rooms:60, vehicle:30, transfer:30}, domestic:{teetime:30, rooms:30, vehicle:14, transfer:14} };
  const SECURE_LABEL = {teetime:'티타임', rooms:'객실', vehicle:'차량', transfer:'송영'};
  const VERIFY_STALE_DAYS = 180;
  state.ops = {loaded:false, rules:[], groups:[], bookings:[], ruleForm:null, view:'rules'};
  async function loadOps(force){
    if (state.ops.loaded && !force) return;
    await checkReady(); if (!isUsable()) return;
    const client = sb();
    const [r, g, b] = await Promise.all([
      client.from(TABLES.rules).select('*').order('product_title', {ascending:true}).limit(3000),
      client.from(TABLES.groups).select('*').order('departure_date', {ascending:true}).limit(3000),
      client.from(TABLES.bookings).select('id,booking_no,booking_status,product_uid,product_title,product_cat,travel_region,destination,departure_date,confirmed_party_size,departure_group_id').limit(10000),
    ]);
    if (r.error || g.error || b.error){ state.ops.error = errText(r.error || g.error || b.error); return; }
    Object.assign(state.ops, {rules:r.data||[], groups:g.data||[], bookings:b.data||[], loaded:true, error:''});
  }
  const todayStr = () => { const t = todayKst(); return `${t.y}-${pad2(t.m)}-${pad2(t.d)}`; };
  // 오늘 적용되는(유효기간 안의) 운영 조건
  function activeRules(uid, onDate){
    const d = onDate || todayStr();
    return state.ops.rules.filter(r=>r.product_uid===uid && (!r.operating_rule_start_date || r.operating_rule_start_date<=d) && (!r.operating_rule_end_date || r.operating_rule_end_date>=d));
  }
  // 2인 출발 가능 여부 — 확인된 운영 조건이 없으면 "미확인"(가능으로 표시하지 않음)
  function twoPaxStatus(uid){
    const rs = activeRules(uid).filter(r=>r.minimum_departure_size!=null || r.private_departure_min_size!=null || r.join_group_allowed!=null);
    if (!rs.length) return {s:'unknown', t:'미확인'};
    if (rs.some(r=>(r.minimum_departure_size!=null && r.minimum_departure_size<=2) || (r.private_departure_min_size!=null && r.private_departure_min_size<=2))) return {s:'ok', t:'2인 출발 가능'};
    // 다른 팀 합류는 그 출발 그룹이 성사돼야 가능하므로 "2인 출발 가능"과 구분해 표시
    if (rs.some(r=>r.join_group_allowed===true)) return {s:'join', t:'2인은 합류 시 출발'};
    return {s:'no', t:'2인 출발 불가'};
  }
  function ruleBlank(uid){ return {id:null, product:uid?'uid:'+uid:'', party_size_from:'', party_size_to:'', minimum_departure_size:'', private_departure_min_size:'', join_group_allowed:'', small_group_surcharge:'', vehicle_cost:'', transfer_cost:'', handling_cost:'', maximum_group_capacity:'', currency:'KRW', operating_rule_start_date:'', operating_rule_end_date:'', source:'', last_verified_at:'', memo:''}; }
  function editRule(id){
    const r = state.ops.rules.find(x=>x.id===id); if (!r) return;
    state.ops.ruleForm = Object.assign(ruleBlank(), Object.fromEntries(Object.entries(r).map(([k,v])=>[k, v==null?'':v])), {product:'uid:'+r.product_uid, join_group_allowed: r.join_group_allowed==null?'':String(r.join_group_allowed), last_verified_at: r.last_verified_at ? r.last_verified_at.slice(0,10) : ''});
    renderBody();
  }
  function newRule(uid){ state.ops.ruleForm = ruleBlank(uid); renderBody(); }
  function rfSet(k, v){ state.ops.ruleForm[k] = v; }
  async function saveRule(){
    const f = state.ops.ruleForm; if (!f) return;
    if (!String(f.product).startsWith('uid:')){ alert('운영 조건은 등록된 상품을 골라야 합니다.'); return; }
    if (!String(f.source||'').trim()){ alert('조건의 출처(랜드사·계약서 등)를 입력해 주세요. 출처가 있어야 검증할 수 있습니다.'); return; }
    if (f.operating_rule_start_date && f.operating_rule_end_date && f.operating_rule_end_date < f.operating_rule_start_date){ alert('적용 종료일이 시작일보다 빠릅니다.'); return; }
    const x = productByUid(f.product.slice(4));
    const num = v => v==='' || v==null ? null : (isFinite(Number(v)) ? Number(v) : null);
    const row = {product_uid:x ? x.uid : f.product.slice(4), product_title:x ? x.title : null,
      party_size_from:num(f.party_size_from), party_size_to:num(f.party_size_to), minimum_departure_size:num(f.minimum_departure_size), private_departure_min_size:num(f.private_departure_min_size),
      join_group_allowed: f.join_group_allowed==='' ? null : f.join_group_allowed==='true', small_group_surcharge:num(f.small_group_surcharge), vehicle_cost:num(f.vehicle_cost), transfer_cost:num(f.transfer_cost),
      handling_cost:num(f.handling_cost), maximum_group_capacity:num(f.maximum_group_capacity), currency:f.currency||'KRW', operating_rule_start_date:f.operating_rule_start_date||null, operating_rule_end_date:f.operating_rule_end_date||null,
      source:String(f.source).trim(), last_verified_at: f.last_verified_at ? `${f.last_verified_at}T00:00:00+09:00` : null, memo:(f.memo||'').trim()||null};
    const client = sb();
    const q = f.id ? client.from(TABLES.rules).update(row).eq('id', f.id).select().single() : client.from(TABLES.rules).insert(row).select().single();
    const { data, error } = await q;
    if (error){ alert('저장 실패: '+errText(error)); return; }
    const i = state.ops.rules.findIndex(r=>r.id===data.id); if (i>=0) state.ops.rules[i] = data; else state.ops.rules.push(data);
    state.ops.ruleForm = null; renderBody();
  }
  async function deleteRule(id){
    if (!confirm('이 운영 조건을 삭제할까요?')) return;
    const { error } = await sb().from(TABLES.rules).delete().eq('id', id);
    if (error){ alert('삭제 실패: '+errText(error)); return; }
    state.ops.rules = state.ops.rules.filter(r=>r.id!==id); renderBody();
  }
  async function verifyRule(id){
    const { data, error } = await sb().from(TABLES.rules).update({last_verified_at:new Date().toISOString()}).eq('id', id).select().single();
    if (error){ alert(errText(error)); return; }
    const i = state.ops.rules.findIndex(r=>r.id===id); if (i>=0) state.ops.rules[i] = data; renderBody();
  }
  function ruleFormHTML(){
    const f = state.ops.ruleForm;
    const inp = (k, label, type, ph) => `<div class="crm-field"><label>${label}</label><input type="${type||'number'}" value="${esc(f[k])}" ${ph?`placeholder="${esc(ph)}"`:''} oninput="TGT_CRM.rfSet('${k}', this.value)" onchange="TGT_CRM.rfSet('${k}', this.value)"></div>`;
    return `<div class="crm-card"><h5>${f.id?'✏️ 운영 조건 수정':'+ 운영 조건 등록'} <span class="crm-note" style="font-weight:500">— 원가 정보는 관리자만 볼 수 있습니다</span></h5>
      <div class="crm-field"><label>상품<span class="req">*</span></label><select onchange="TGT_CRM.rfSet('product', this.value)">${productOptionsHTML(f.product)}</select></div>
      <div class="crm-grid2">
        ${inp('party_size_from','적용 인원 구간(이상)','number','예: 2')}${inp('party_size_to','적용 인원 구간(이하)','number','예: 3')}
        ${inp('minimum_departure_size','최소 출발 인원')}${inp('private_departure_min_size','단독 출발 최소 인원')}
        <div class="crm-field"><label>다른 팀 합류 가능</label><select onchange="TGT_CRM.rfSet('join_group_allowed', this.value)"><option value="" ${f.join_group_allowed===''?'selected':''}>미확인</option><option value="true" ${f.join_group_allowed==='true'?'selected':''}>가능</option><option value="false" ${f.join_group_allowed==='false'?'selected':''}>불가</option></select></div>
        ${inp('small_group_surcharge','소인원 추가 요금(1인)')}
        ${inp('vehicle_cost','차량 비용')}${inp('transfer_cost','송영 비용')}
        ${inp('handling_cost','핸들링 비용')}${inp('maximum_group_capacity','최대 수용 인원')}
        ${inp('operating_rule_start_date','적용 시작일','date')}${inp('operating_rule_end_date','적용 종료일','date')}
        ${inp('source','조건 출처 *','text','예: ○○랜드사 2027 상반기 계약서')}${inp('last_verified_at','최종 확인일','date')}
      </div>
      <div class="crm-field"><label>메모</label><input type="text" value="${esc(f.memo)}" oninput="TGT_CRM.rfSet('memo', this.value)"></div>
      <div class="crm-actions"><button type="button" class="crm-btn" onclick="TGT_CRM.cancelRule()">취소</button><button type="button" class="crm-btn primary" onclick="TGT_CRM.saveRule()">저장</button></div></div>`;
  }
  function rulesHTML(){
    const prods = allProducts();
    const byUid = {}; state.ops.rules.forEach(r=>(byUid[r.product_uid] = byUid[r.product_uid] || []).push(r));
    const stale = r => !r.last_verified_at || dayDiff(r.last_verified_at, new Date()) > VERIFY_STALE_DAYS;
    const expired = r => r.operating_rule_end_date && r.operating_rule_end_date < todayStr();
    const money = v => v==null ? '' : Number(v).toLocaleString('ko-KR');
    const ruleLine = r => `<div class="crm-hist h">${[
        (r.party_size_from!=null||r.party_size_to!=null) ? `인원 ${r.party_size_from??''}~${r.party_size_to??''}명` : '',
        r.minimum_departure_size!=null ? `최소 출발 ${r.minimum_departure_size}명` : '', r.private_departure_min_size!=null ? `단독 최소 ${r.private_departure_min_size}명` : '',
        r.join_group_allowed===true ? '합류 가능' : (r.join_group_allowed===false ? '합류 불가' : ''), r.small_group_surcharge!=null ? `소인원 추가 ${money(r.small_group_surcharge)}` : '',
        r.vehicle_cost!=null ? `차량 ${money(r.vehicle_cost)}` : '', r.transfer_cost!=null ? `송영 ${money(r.transfer_cost)}` : '', r.handling_cost!=null ? `핸들링 ${money(r.handling_cost)}` : '',
        r.maximum_group_capacity!=null ? `최대 ${r.maximum_group_capacity}명` : '',
        `${r.operating_rule_start_date?fmtDate(r.operating_rule_start_date):'~'} ~ ${r.operating_rule_end_date?fmtDate(r.operating_rule_end_date):''}`,
        `출처: ${r.source||'—'}`].filter(Boolean).map(esc).join(' · ')}
        ${expired(r)?' <span class="crm-tag no">기간 만료</span>':''}${stale(r)?' <span class="crm-tag hold">확인 필요</span>':''}
        <span class="crm-item-acts" style="display:inline-flex;margin:0 0 0 6px"><button type="button" class="crm-btn" onclick="TGT_CRM.verifyRule(${r.id})">오늘 확인함</button><button type="button" class="crm-btn" onclick="TGT_CRM.editRule(${r.id})">수정</button><button type="button" class="crm-btn danger" onclick="TGT_CRM.deleteRule(${r.id})">삭제</button></span></div>`;
    const rows = prods.map(x=>{
      const tp = twoPaxStatus(x.uid);
      return `<div class="crm-item"><div class="crm-item-top"><b>${esc(x.title)}</b><span class="crm-note">${esc(x.catKo)}</span><span class="crm-tag ${({ok:'ok', join:'go', no:'no'})[tp.s]||'info'}">${tp.t}</span>
        <button type="button" class="crm-btn" style="margin-left:auto" onclick="TGT_CRM.newRule('${esc(x.uid)}')">+ 조건</button></div>
        ${(byUid[x.uid]||[]).map(ruleLine).join('') || '<div class="crm-note" style="margin-top:4px">등록된 운영 조건 없음 — 2인 출발 가능 여부는 "미확인"으로 표시됩니다.</div>'}</div>`;
    });
    return `<div class="crm-card"><h5>📐 상품 운영 조건 <span class="crm-note" style="font-weight:500">— 적용 기간·인원 구간별, 출처·최종 확인일 필수 관리(확인 ${VERIFY_STALE_DAYS}일 경과 시 "확인 필요")</span></h5>
      <div class="crm-list">${rows.join('') || '<div class="crm-empty">등록된 상품이 없습니다.</div>'}</div></div>`;
  }

  // 출발 그룹 — 같은 상품·출발일 예약을 묶어 차량·송영·객실·티타임 확보를 관리
  function groupSuggestions(){
    const free = state.ops.bookings.filter(b=>ACTIVE(b.booking_status) && !b.departure_group_id && b.departure_date && b.departure_date >= todayStr());
    const m = {};
    free.forEach(b=>{ const k = (b.product_uid||b.product_title||b.destination||'?')+'|'+b.departure_date; (m[k] = m[k] || []).push(b); });
    return Object.values(m).map(list=>({product_uid:list[0].product_uid, product_title:list[0].product_title||list[0].destination, destination:list[0].destination, travel_region:list[0].travel_region, departure_date:list[0].departure_date, bookings:list, people:list.reduce((s,b)=>s+(b.confirmed_party_size||0),0)}))
      .sort((a,b)=>a.departure_date.localeCompare(b.departure_date));
  }
  async function createGroup(idx){
    const s = groupSuggestions()[idx]; if (!s) return;
    const client = sb();
    const { data:g, error } = await client.from(TABLES.groups).insert({product_uid:s.product_uid, product_title:s.product_title, destination:s.destination, departure_date:s.departure_date, status:'준비중'}).select().single();
    if (error){ alert('출발 그룹 생성 실패: '+errText(error)); return; }
    await client.from(TABLES.bookings).update({departure_group_id:g.id}).in('id', s.bookings.map(b=>b.id));
    await loadOps(true); renderBody();
  }
  async function groupToggle(id, field, on){
    const { data, error } = await sb().from(TABLES.groups).update({[field]:!!on}).eq('id', id).select().single();
    if (error){ alert(errText(error)); return; }
    const i = state.ops.groups.findIndex(g=>g.id===id); if (i>=0) state.ops.groups[i] = data; renderBody();
  }
  async function groupSet(id, field, value){
    const { data, error } = await sb().from(TABLES.groups).update({[field]:value||null}).eq('id', id).select().single();
    if (error){ alert(errText(error)); return; }
    const i = state.ops.groups.findIndex(g=>g.id===id); if (i>=0) state.ops.groups[i] = data; renderBody();
  }
  async function groupDetach(bookingId){
    await sb().from(TABLES.bookings).update({departure_group_id:null}).eq('id', bookingId);
    await loadOps(true); renderBody();
  }
  function groupsHTML(){
    const sug = groupSuggestions();
    const today = todayStr();
    const cards = state.ops.groups.filter(g=>g.status!=='취소').map(g=>{
      const bks = state.ops.bookings.filter(b=>b.departure_group_id===g.id);
      const act = bks.filter(b=>ACTIVE(b.booking_status));
      const ppl = act.reduce((s,b)=>s+(b.confirmed_party_size||0),0);
      const region = (act[0] && act[0].travel_region) || (g.destination && catInfo(matchCatFromDest(g.destination)||'') ? catInfo(matchCatFromDest(g.destination)).region : 'overseas');
      const dLeft = g.departure_date ? Math.ceil(dayDiff(depTs(today), depTs(g.departure_date))) : null;
      const cap = g.product_uid ? activeRules(g.product_uid, g.departure_date).map(r=>r.maximum_group_capacity).filter(v=>v!=null) : [];
      const warns = Object.keys(SECURE_LABEL).filter(k=>!g[k+'_secured'] && dLeft!=null && dLeft <= (SECURE_LEAD[region]||SECURE_LEAD.overseas)[k]).map(k=>SECURE_LABEL[k]);
      return `<div class="crm-item"><div class="crm-item-top"><b>${esc(g.product_title||g.destination||'출발 그룹')}</b><span class="crm-note">출발 ${esc(fmtDate(g.departure_date)||'-')}${dLeft!=null?` · D-${dLeft}`:''}</span>
          <select onchange="TGT_CRM.groupSet(${g.id}, 'status', this.value)">${['준비중','확정','출발완료','취소'].map(s=>`<option ${g.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="crm-item-meta">예약 ${act.length}건 · 확정 인원 ${ppl}명${cap.length?` · 최대 수용 ${Math.min(...cap)}명${ppl>Math.min(...cap)?' <b style="color:#B91C1C">초과</b>':''}`:''}</div>
        <div class="crm-chips" style="margin-top:6px">${Object.entries(SECURE_LABEL).map(([k,l])=>`<label class="crm-chip ${g[k+'_secured']?'on':''}" style="cursor:pointer"><input type="checkbox" style="display:none" ${g[k+'_secured']?'checked':''} onchange="TGT_CRM.groupToggle(${g.id}, '${k}_secured', this.checked)">${g[k+'_secured']?'✓ ':''}${l} 확보</label>`).join('')}</div>
        ${warns.length && g.status!=='출발완료' ? `<div class="crm-banner warn" style="margin-top:6px">⏰ 확보 필요 시점 지남: ${warns.join(', ')}</div>` : ''}
        <div class="crm-hist">${bks.map(b=>`<div class="h">${esc(b.booking_no)} · ${esc(b.booking_status)} · ${b.confirmed_party_size??'-'}명 <button type="button" class="crm-btn" style="padding:2px 7px;font-size:.66rem" onclick="TGT_CRM.groupDetach(${b.id})">빼기</button></div>`).join('') || '연결된 예약 없음'}</div>
        <input type="text" placeholder="운영 메모(차량 종류·객실 블록 등)" value="${esc(g.memo||'')}" onchange="TGT_CRM.groupSet(${g.id}, 'memo', this.value)" style="width:100%;margin-top:6px;padding:6px 9px;border:none;border-radius:8px;background:var(--nm-white,#fff);box-shadow:var(--nm-shadow-inset);font-size:.76rem;box-sizing:border-box">
      </div>`;
    });
    return `<div class="crm-card"><h5>🚐 출발 그룹 <span class="crm-note" style="font-weight:500">— 예약은 따로 관리하고, 차량·송영·객실·티타임은 출발 그룹 기준으로 확보</span></h5>
      <p class="crm-note">확보 필요 시점 기본 기준: 해외 티타임·객실 출발 ${SECURE_LEAD.overseas.teetime}일 전, 차량·송영 ${SECURE_LEAD.overseas.vehicle}일 전 / 국내 ${SECURE_LEAD.domestic.teetime}일 · ${SECURE_LEAD.domestic.vehicle}일 전</p>
      ${sug.length ? `<div class="st-sm-l">묶을 수 있는 예약(같은 상품·같은 출발일)</div><div class="crm-list">${sug.map((s,i)=>`<div class="crm-item"><b>${esc(s.product_title||'-')}</b> <span class="crm-note">출발 ${esc(fmtDate(s.departure_date))} · 예약 ${s.bookings.length}건 · ${s.people}명</span>
        <button type="button" class="crm-btn primary" style="margin-left:8px" onclick="TGT_CRM.createGroup(${i})">출발 그룹 만들기</button></div>`).join('')}</div>` : ''}
      <div class="st-sm-l">출발 그룹</div><div class="crm-list">${cards.join('') || '<div class="crm-empty">출발 그룹이 없습니다.</div>'}</div></div>`;
  }
  function opsHTML(){
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${state.ready ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    if (!state.ops.loaded) return `<div class="crm-card"><div class="crm-empty">${state.ops.error?'불러오기 실패: '+esc(state.ops.error):'불러오는 중...'}</div></div>`;
    if (state.ops.ruleForm) return ruleFormHTML();
    return `<div class="crm-subnav" style="margin-bottom:-4px">${[['rules','📐 상품 운영 조건'],['groups','🚐 출발 그룹']].map(([k,l])=>`<button type="button" class="${state.ops.view===k?'active':''}" onclick="TGT_CRM.opsView('${k}')">${l}</button>`).join('')}</div>`
      + (state.ops.view==='groups' ? groupsHTML() : rulesHTML());
  }

  // ── 기획·운영 진단(규칙 기반) — 근거 숫자와 함께 보여주고, 자료가 부족하면 "판단 보류" ──
  const INTEL_MIN = 3;   // 한 묶음을 패턴으로 볼 최소 문의 수
  function intelHTML(){
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${state.ready ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    if (!state.stats.loaded || !state.ops.loaded) return `<div class="crm-card"><div class="crm-empty">${state.stats.error||state.ops.error ? '불러오기 실패: '+esc(state.stats.error||state.ops.error) : '진단 중...'}</div></div>`;
    const threads = buildThreads(state.stats.cons, state.stats.bookings);
    const prods = allProducts().filter(x=>typeof isProductVisible!=='function' || isProductVisible(x.p));
    const now = todayKst(), nowKey = `${now.y}-${pad2(now.m)}`;
    const recentStart = addMonths(nowKey, -2), prevStart = addMonths(nowKey, -5), prevEnd = addMonths(nowKey, -3);
    const mk = t => monthKeyTs(t.first_inquiry_at) || '';
    const card = (title, st, items, action) => `<div class="crm-card"><h5>${title} <span class="crm-tag ${st==='found'?'hold':(st==='hold'?'info':'ok')}">${st==='found'?'발견':(st==='hold'?'판단 보류':'해당 없음')}</span></h5>
      ${items.length?`<ul class="it-list">${items.map(x=>`<li>${x}</li>`).join('')}</ul>`:''}${action?`<p class="crm-note">💡 ${action}</p>`:''}</div>`;
    const out = [];
    const total = threads.length;
    if (total < 10) out.push(`<div class="crm-banner warn">상담 문의가 ${total}건으로 아직 적습니다. 진단은 참고용이며, 대부분 "판단 보류"로 표시됩니다(문의 10건 이상부터 의미 있는 패턴을 찾습니다).</div>`);

    // 1) 적합한 등록 상품이 없는 수요
    const noFit = threads.filter(t=>!t.product_uid || t.unbooked_reason==='원하는 상품 없음');
    const noFitBy = {}; noFit.forEach(t=>{ const k = countryKey(t); (noFitBy[k] = noFitBy[k] || []).push(t); });
    const noFitItems = Object.entries(noFitBy).filter(([,l])=>l.length>=INTEL_MIN).sort((a,b)=>b[1].length-a[1].length).map(([k,l])=>{
      const prefs = topRows(countBy(l, t=>t.prefs), 3).map(r=>`${esc(r.label)} ${r.value}`).join(', ');
      const regProds = prods.filter(x=>countryKey({travel_region:x.region, country:x.catKo, destination:x.catKo})===k).length;
      return `<b>${esc(k)}</b> — 상품 미정·"원하는 상품 없음" 문의 ${l.length}건 (등록 상품 ${regProds}개)${prefs?` · 원하는 취향: ${prefs}`:''}`;
    });
    out.push(card('🧭 적합한 등록 상품이 없는 고객 수요', noFitItems.length?'found':(noFit.length?'hold':'none'), noFitItems.length?noFitItems:(noFit.length?[`관련 문의 ${noFit.length}건 — 국가별 ${INTEL_MIN}건 이상 쌓이면 판단합니다.`]:[]), noFitItems.length?'해당 국가·취향 조합으로 신규 상품 구성을 검토하세요.':''));

    // 2) 상담은 많은데 예약이 적은 상품
    const convAll = total ? threads.filter(t=>t.converted).length/total : 0;
    const byProd = {}; threads.forEach(t=>{ if (t.product_title) (byProd[t.product_title] = byProd[t.product_title] || []).push(t); });
    const lowConv = Object.entries(byProd).filter(([,l])=>l.length>=MIN_N).map(([k,l])=>({k, n:l.length, c:l.filter(t=>t.converted).length, reasons:topRows(countBy(l.filter(t=>!t.converted), t=>t.unbooked_reason), 2)}))
      .filter(x=>x.c/x.n < convAll*0.5).sort((a,b)=>b.n-a.n);
    const pendingProds = Object.values(byProd).filter(l=>l.length<MIN_N).length;
    out.push(card('📉 상담은 많지만 예약이 적은 상품', lowConv.length?'found':(Object.keys(byProd).length && !Object.values(byProd).some(l=>l.length>=MIN_N)?'hold':'none'),
      lowConv.map(x=>`<b>${esc(x.k)}</b> — 상담 ${x.n}건 중 예약 ${x.c}건(${Math.round(x.c/x.n*100)}%, 전체 평균 ${Math.round(convAll*100)}%)${x.reasons.length?` · 주요 사유: ${x.reasons.map(r=>`${esc(r.label)} ${r.value}`).join(', ')}`:''}`)
        .concat(pendingProds && !lowConv.length ? [`상담 ${MIN_N}건 미만 상품 ${pendingProds}개는 판단 보류`] : []),
      lowConv.length?'가격·일정·인원 조건 중 반복되는 사유부터 조정하세요.':''));

    // 3) 출발일·예산 불일치 반복 고객군
    const mismatch = {};
    threads.filter(t=>!t.converted && (t.unbooked_reason==='일정 불일치' || t.unbooked_reason==='가격')).forEach(t=>{ const k = `${countryKey(t)} · ${partyBucket(t.party)} · ${t.unbooked_reason}`; mismatch[k] = (mismatch[k]||0)+1; });
    const priceOf = x => Number((x.p.priceEntries && x.p.priceEntries[0] && x.p.priceEntries[0].salePrice) || x.p.from || 0);
    const budgetGap = {};
    threads.filter(t=>t.list.some(c=>c.budget_per_person)).forEach(t=>{
      const budget = Math.max(...t.list.map(c=>c.budget_per_person||0));
      const cand = prods.filter(x=>t.product_cat ? x.catId===t.product_cat : true).map(priceOf).filter(v=>v>0);
      if (cand.length && budget < Math.min(...cand)) { const k = countryKey(t); budgetGap[k] = (budgetGap[k]||0)+1; }
    });
    const mmItems = Object.entries(mismatch).filter(([,n])=>n>=INTEL_MIN).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<b>${esc(k)}</b> — 미예약·보류 ${n}건`)
      .concat(Object.entries(budgetGap).filter(([,n])=>n>=INTEL_MIN).map(([k,n])=>`<b>${esc(k)}</b> — 고객 예산이 등록 상품 최저가보다 낮은 문의 ${n}건`));
    out.push(card('🧩 출발일·예산 불일치가 반복되는 고객군', mmItems.length?'found':(Object.keys(mismatch).length||Object.keys(budgetGap).length?'hold':'none'), mmItems, mmItems.length?'해당 고객군을 위한 다른 출발 요일·가격대 구성(실속형·평일 출발 등)을 검토하세요.':''));

    // 4) 국가·스타일 관심 증가(최근 3개월 vs 그 전 3개월)
    const recent = threads.filter(t=>mk(t)>=recentStart), prev = threads.filter(t=>mk(t)>=prevStart && mk(t)<=prevEnd);
    const growth = (keyFn, label) => {
      const r = countBy(recent, keyFn), p = countBy(prev, keyFn);
      return Object.keys(r).filter(k=>r[k]>=MIN_N && (p[k]||0)>=INTEL_MIN && r[k] >= (p[k]||0)*1.5).map(k=>`<b>${esc(k)}</b> (${label}) — 최근 3개월 ${r[k]}건 / 그 전 3개월 ${p[k]||0}건 (+${Math.round((r[k]/(p[k]||1)-1)*100)}%)`);
    };
    const growthItems = growth(countryKey, '국가·지역').concat(growth(t=>t.prefs, '취향'));
    out.push(card('📈 특정 국가·여행 스타일 관심 증가', growthItems.length?'found':(prev.length<INTEL_MIN*2?'hold':'none'),
      growthItems.length ? growthItems : (prev.length<INTEL_MIN*2 ? [`비교 기간(그 전 3개월) 문의 ${prev.length}건 — 비교할 자료가 부족합니다.`] : []),
      growthItems.length?'관심이 늘어난 국가·스타일의 상품을 홈페이지에 먼저 노출하고, 다음 시즌 상품 기획에 반영하세요.':''));

    // 5) 운영 진단 — 인원·출발 그룹
    const opsItems = [];
    // 2인 문의가 많지만 2인 출발이 안 되는 지역(운영 조건 등록된 상품 기준)
    const twoBy = {}; threads.filter(t=>t.party!=null && t.party<=2).forEach(t=>{ const k = countryKey(t); twoBy[k] = (twoBy[k]||0)+1; });
    Object.entries(twoBy).filter(([,n])=>n>=INTEL_MIN).forEach(([k,n])=>{
      const ps = prods.filter(x=>countryKey({travel_region:x.region, country:x.catKo, destination:x.catKo})===k);
      const st = countBy(ps, x=>twoPaxStatus(x.uid).s);
      if (!ps.length) opsItems.push(`<b>${esc(k)}</b> — 2인 문의 ${n}건, 등록 상품 없음`);
      else if (!st.ok){
        const parts = [st.join?`합류 시 출발 ${st.join}개`:'', st.no?`2인 출발 불가 ${st.no}개`:'', st.unknown?`운영 조건 미확인 ${st.unknown}개`:''].filter(Boolean).join(' · ');
        opsItems.push(`<b>${esc(k)}</b> — 2인 문의 ${n}건, 2인 출발이 확인된 상품 없음 (등록 상품 ${ps.length}개: ${parts})${st.unknown?' — 미확인 상품의 운영 조건을 등록하면 판단할 수 있습니다':''}`);
      }
    });
    // 소인원 추가요금 때문에 전환이 낮은 상품
    Object.entries(byProd).forEach(([k,l])=>{
      const lost = l.filter(t=>!t.converted && (t.unbooked_reason==='소인원 추가요금' || t.barrier==='소인원 추가요금')).length;
      if (lost>=2) opsItems.push(`<b>${esc(k)}</b> — 소인원 추가요금으로 미예약 ${lost}건 (이 상품 상담 ${l.length}건)`);
    });
    // 단체 문의 집중 시즌(희망 출발 월 기준)
    const grpByM = countBy(threads.filter(t=>(t.party||0)>=9 || t.group_type==='동호회' || t.group_type==='기업'), t=>t.preferred_month ? t.preferred_month.slice(0,7) : (t.preferred_date ? t.preferred_date.slice(0,7) : null));
    Object.entries(grpByM).filter(([,n])=>n>=INTEL_MIN).sort().forEach(([m,n])=>opsItems.push(`<b>${monthLabel(m)} 출발</b> — 단체 문의 ${n}건 집중`));
    // 확보가 필요한 출발(앞으로 6개월, 출발 그룹 기준)
    const horizon = addMonths(nowKey, 6);
    const upcoming = state.ops.groups.filter(g=>g.status!=='취소' && g.status!=='출발완료' && g.departure_date && g.departure_date>=todayStr() && g.departure_date.slice(0,7)<=horizon);
    upcoming.forEach(g=>{
      const ppl = state.ops.bookings.filter(b=>b.departure_group_id===g.id && ACTIVE(b.booking_status)).reduce((s,b)=>s+(b.confirmed_party_size||0),0);
      const miss = Object.keys(SECURE_LABEL).filter(k=>!g[k+'_secured']).map(k=>SECURE_LABEL[k]);
      if (miss.length) opsItems.push(`<b>${esc(fmtDate(g.departure_date))} ${esc(g.product_title||g.destination||'')}</b> — 확정 ${ppl}명, 미확보: ${miss.join(', ')}`);
    });
    const ungrouped = groupSuggestions().filter(s=>s.departure_date.slice(0,7)<=horizon);
    if (ungrouped.length) opsItems.push(`출발 그룹으로 묶지 않은 앞으로 6개월 출발 예약 ${ungrouped.reduce((s,x)=>s+x.bookings.length,0)}건(${ungrouped.reduce((s,x)=>s+x.people,0)}명) — "운영 조건·출발 그룹"에서 묶어 확보를 관리하세요.`);
    // 인원 조건 때문에 충족 못한 수요
    const partyUnmet = countBy(threads.filter(t=>!t.converted && t.barrier), t=>`${countryKey(t)} · ${partyBucket(t.party)} · ${t.barrier}`);
    Object.entries(partyUnmet).filter(([,n])=>n>=2).forEach(([k,n])=>opsItems.push(`<b>${esc(k)}</b> — 인원 조건으로 충족 못한 문의 ${n}건`));
    out.push(card('🚐 인원·운영 진단', opsItems.length?'found':(total<10?'hold':'none'), opsItems, opsItems.length?'소인원 합류 상품, 단체 전용 일정, 차량·객실 사전 블록 등을 검토하세요.':''));

    // 6) 신규 상품 개발 후보(위 근거를 묶어 제안 — 예약 증가를 보장하지 않음)
    const cands = [];
    noFitItems.length && Object.entries(noFitBy).filter(([,l])=>l.length>=INTEL_MIN).forEach(([k,l])=>{ const pr = topRows(countBy(l, t=>t.prefs), 2).map(r=>r.label); const pb = topRows(countBy(l, t=>partyBucket(t.party)), 1)[0];
      cands.push(`<b>${esc(k)}</b> ${pr.length?esc(pr.join('·'))+' 중심 ':''}${pb?esc(pb.label)+' ':''}상품 — 근거: 맞는 상품이 없던 문의 ${l.length}건`); });
    Object.entries(twoBy).filter(([,n])=>n>=INTEL_MIN).forEach(([k,n])=>{ const ps = prods.filter(x=>countryKey({travel_region:x.region, country:x.catKo, destination:x.catKo})===k); if (ps.length && ps.every(x=>twoPaxStatus(x.uid).s==='no')) cands.push(`<b>${esc(k)}</b> 2인 출발(합류형) 상품 — 근거: 2인 문의 ${n}건, 현재 상품 모두 2인 출발 불가`); });
    Object.entries(grpByM).filter(([,n])=>n>=INTEL_MIN).forEach(([m,n])=>cands.push(`<b>${monthLabel(m)}</b> 단체(동호회·기업) 전용 일정 — 근거: 해당 월 출발 희망 단체 문의 ${n}건`));
    out.push(card('🆕 신규 상품 개발 후보', cands.length?'found':'hold', cands.length?cands:['근거가 충분히 쌓인 후보가 아직 없습니다.'], cands.length?'제안은 기록된 상담·예약 근거에서 나온 후보이며 예약 증가를 보장하지 않습니다. 시장·원가 확인 후 결정하세요.':''));
    return out.join('');
  }

  // ══ 추천·판매 전략(AI 멀티 큐레이션 관리) ══════════════════════════════════
  // 판매 전략 등급(핵심/일반/틈새)은 상품 정보에 저장되어 홈페이지 추천에 쓰이고,
  // 1인 예상 매출총이익·만족도는 관리자 전용 테이블(tgt_product_strategy)에만 저장된다
  const STRATEGY_TABLE = 'tgt_product_strategy';
  const STRATEGY_SQL = 'docs/sql/2026-10-25_curation.sql';
  const TIERS = [['core','핵심','적극 판매 — 조건이 맞을 때 추천에서 조금 더 앞에 둡니다'], ['standard','일반','기본 — 고객 적합도대로'], ['niche','틈새','특정 고객용 — 조건이 아주 잘 맞을 때만 앞에 둡니다']];
  state.strat = {loaded:false};
  async function loadStrategy(force){
    if (state.strat.loaded && !force) return;
    await checkReady(); if (!isUsable()) return;
    const client = sb();
    const since30 = new Date(Date.now()-30*86400000).toISOString(), since90 = new Date(Date.now()-90*86400000).toISOString();
    const [st, ev, cs, bk] = await Promise.all([
      client.from(STRATEGY_TABLE).select('*').limit(5000),
      client.from(TABLES.events).select('event_type,product_uid,session_id,created_at').gte('created_at', since30).limit(50000),
      client.from(TABLES.consultations).select('id,product_uid,result,consulted_at').eq('is_deleted', false).gte('consulted_at', since90).limit(10000),
      client.from(TABLES.bookings).select('id,product_uid,booking_status,confirmed_party_size,confirmed_at,travel_region,country,destination').gte('confirmed_at', since90).limit(10000),
    ]);
    state.strat = {loaded:true, missing: !!(st.error && isMissingTableError(st.error)), error: st.error && !isMissingTableError(st.error) ? errText(st.error) : '',
      rows: Object.fromEntries((st.data||[]).map(r=>[r.product_uid, r])), events: ev.data||[], cons: cs.data||[], bookings: bk.data||[]};
  }
  function setTier(uid, tier){
    const x = productByUid(uid); if (!x) return;
    if (productOverrides[x.catId]===undefined) productOverrides[x.catId] = tgtMaterializeDefaults(x.catId);
    const p = productOverrides[x.catId][x.idx]; if (!p) return;
    if (tier==='standard') delete p.salesTier; else p.salesTier = tier;
    saveProducts();   // 사이트 설정(상품 정보)에 저장 — 홈페이지 추천에 바로 반영
    renderBody();
  }
  async function saveStrategy(uid, field, value){
    if (state.strat.missing){ alert(`매출총이익·만족도는 ${STRATEGY_SQL}을 실행한 뒤 저장할 수 있습니다.`); return; }
    const x = productByUid(uid);
    let v = String(value||'').trim();
    if (field==='gross_margin_per_person') v = v==='' ? null : Number(v.replace(/[^\d.-]/g,''));
    if (field==='satisfaction'){ v = v==='' ? null : Number(v); if (v!=null && !(v>=1 && v<=5)){ alert('만족도는 1.0~5.0 사이로 입력해 주세요.'); renderBody(); return; } }
    if (field==='satisfaction_source' || field==='memo') v = v || null;
    if (typeof v==='number' && !isFinite(v)){ alert('숫자로 입력해 주세요.'); renderBody(); return; }
    const row = {product_uid:uid, product_title: x ? x.title : null, [field]:v};
    const { data, error } = await sb().from(STRATEGY_TABLE).upsert(row, {onConflict:'product_uid'}).select().single();
    if (error){ alert('저장 실패: '+errText(error)); return; }
    state.strat.rows[uid] = data; renderBody();
  }
  function strategyHTML(){
    if (!isUsable()) return `<div class="crm-card"><div class="crm-empty">${state.ready ? '위 안내에 따라 DB 준비와 관리자 권한을 먼저 확인하세요.' : '확인 중...'}</div></div>`;
    const S = state.strat;
    if (!S.loaded) return `<div class="crm-card"><div class="crm-empty">불러오는 중...</div></div>`;
    const prods = allProducts();
    const vis = x => typeof isProductVisible!=='function' || isProductVisible(x.p);
    const cnt = (type, uid) => S.events.filter(e=>e.event_type===type && e.product_uid===uid).length;
    const totalViews = S.events.filter(e=>e.event_type==='recommend_view' && e.product_uid).length;
    const rows = prods.map(x=>{
      const st = S.rows[x.uid] || {};
      const bks = S.bookings.filter(b=>b.product_uid===x.uid && ACTIVE(b.booking_status));
      const ppl = bks.reduce((s,b)=>s+(b.confirmed_party_size||0),0);
      return {x, st, tier: ['core','niche'].includes(x.p.salesTier) ? x.p.salesTier : 'standard', visible: vis(x),
        views: cnt('recommend_view', x.uid), clicks: cnt('recommend_click', x.uid), inq: cnt('recommend_inquiry', x.uid),
        cons: S.cons.filter(c=>c.product_uid===x.uid).length, bookings: bks.length, people: ppl,
        gp: st.gross_margin_per_person!=null ? st.gross_margin_per_person*ppl : null};
    });
    // 제안 등급(참고용) — 입력된 매출총이익·만족도가 모두 있을 때만
    const margins = rows.map(r=>r.st.gross_margin_per_person).filter(v=>v!=null).sort((a,b)=>a-b);
    const medMargin = margins.length ? margins[Math.floor(margins.length/2)] : null;
    const suggest = r => {
      const m = r.st.gross_margin_per_person, s = r.st.satisfaction;
      if (s!=null && s<3.5) return ['만족도 점검', 'no'];
      if (m==null || s==null) return ['판단 보류', 'info'];
      if (margins.length<3) return ['비교 자료 부족', 'info'];   // 이익 입력 상품이 3개 이상이어야 상대 비교
      if (margins.length>=3 && m>=medMargin && s>=4.0) return ['핵심 후보', 'ok'];
      if (s>=4.5 && m<medMargin) return ['일반(만족도 높음)', 'go'];
      return ['일반', 'info'];
    };
    // 진단
    const diag = [];
    const visRows = rows.filter(r=>r.visible);
    if (totalViews < 30) diag.push(`<li><span class="crm-tag info">판단 보류</span> 최근 30일 AI 추천 노출 ${fmtN(totalViews)}건 — 30건 이상 쌓이면 노출 쏠림을 판단합니다.</li>`);
    else {
      const top = visRows.slice().sort((a,b)=>b.views-a.views).slice(0,3), share = top.reduce((s,r)=>s+r.views,0)/totalViews;
      diag.push(share>0.5 ? `<li><span class="crm-tag hold">노출 쏠림</span> 상위 3개 상품이 추천 노출의 ${Math.round(share*100)}% — ${top.map(r=>`${esc(r.x.title)} ${fmtN(r.views)}`).join(', ')}</li>`
        : `<li><span class="crm-tag ok">양호</span> 상위 3개 상품의 추천 노출 비중 ${Math.round(share*100)}%</li>`);
      const zero = visRows.filter(r=>r.views===0);
      if (zero.length) diag.push(`<li><span class="crm-tag hold">기회 부족</span> 최근 30일 추천에 한 번도 나오지 않은 판매 중 상품 ${zero.length}개 — ${zero.slice(0,8).map(r=>esc(r.x.title)).join(', ')}${zero.length>8?' 외':''}. 판매 시기·가격·일정이 고객 조건과 자주 어긋나는지 확인하세요.</li>`);
    }
    const bAll = S.bookings.filter(b=>ACTIVE(b.booking_status));
    if (bAll.length >= MIN_N){
      const byC = countBy(bAll, b=>countryKey(b)), topC = topRows(byC, 1)[0];
      if (topC && topC.value/bAll.length > 0.5) diag.push(`<li><span class="crm-tag hold">국가 집중</span> 최근 90일 예약의 ${Math.round(topC.value/bAll.length*100)}%가 ${esc(topC.label)} — 항공·환율·현지 상황 변화에 대비해 다른 국가 상품의 노출·판매를 늘리는 것을 검토하세요.</li>`);
      else if (topC) diag.push(`<li><span class="crm-tag ok">양호</span> 최근 90일 예약 최다 국가 ${esc(topC.label)} ${Math.round(topC.value/bAll.length*100)}%</li>`);
    } else diag.push(`<li><span class="crm-tag info">판단 보류</span> 최근 90일 예약 ${bAll.length}건 — 국가 집중도는 ${MIN_N}건 이상부터 판단합니다.</li>`);
    const coreN = visRows.filter(r=>r.tier==='core').length;
    if (!coreN) diag.push(`<li><span class="crm-tag info">안내</span> 핵심 상품이 없습니다. 수익성·만족도가 높은 상품을 "핵심"으로 지정하면 조건이 맞는 고객에게 조금 더 앞에 소개됩니다.</li>`);
    else if (coreN > Math.max(3, visRows.length*0.3)) diag.push(`<li><span class="crm-tag hold">핵심 과다</span> 판매 중 상품 ${visRows.length}개 중 ${coreN}개가 핵심 — 핵심이 많으면 가중치 효과가 약해집니다(전체의 30% 이내 권장).</li>`);
    const gpRows = rows.filter(r=>r.people>0), gpKnown = gpRows.filter(r=>r.gp!=null);
    const gpSum = gpKnown.reduce((s,r)=>s+r.gp,0), pplAll = gpRows.reduce((s,r)=>s+r.people,0), pplKnown = gpKnown.reduce((s,r)=>s+r.people,0);
    const tierSel = r => `<select onchange="TGT_CRM.setTier('${esc(r.x.uid)}', this.value)">${TIERS.map(([v,l])=>`<option value="${v}" ${r.tier===v?'selected':''}>${l}</option>`).join('')}</select>`;
    const numIn = (r, f, ph, w) => `<input type="text" inputmode="decimal" value="${r.st[f]!=null?esc(String(r.st[f])):''}" placeholder="${ph}" style="width:${w}px" ${S.missing?'disabled':''} onchange="TGT_CRM.saveStrategy('${esc(r.x.uid)}', '${f}', this.value)">`;
    const sorted = rows.slice().sort((a,b)=>(b.visible-a.visible) || (['core','standard','niche'].indexOf(a.tier)-['core','standard','niche'].indexOf(b.tier)) || b.views-a.views);
    return `${S.missing ? `<div class="crm-banner warn">🛠 1인 예상 매출총이익·만족도 입력은 Supabase SQL Editor에서 <code>${STRATEGY_SQL}</code>을 한 번 실행한 뒤 사용할 수 있습니다. 판매 전략 등급은 지금도 지정할 수 있습니다.</div>` : ''}
      ${S.error ? `<div class="crm-banner err">불러오기 실패: ${esc(S.error)}</div>` : ''}
      <div class="crm-card"><h5>🧭 AI 멀티 큐레이션 진단</h5><ul class="it-list" style="list-style:none;padding-left:0">${diag.join('')}</ul>
        <div class="st-tiles" style="margin-top:10px">
          ${tile('최근 30일 추천 노출', fmtN(totalViews)+'건', `추천 받은 방문 ${fmtN(new Set(S.events.filter(e=>e.event_type==='recommend_view').map(e=>e.session_id)).size)}회`)}
          ${tile('핵심 / 일반 / 틈새', `${coreN} / ${visRows.filter(r=>r.tier==='standard').length} / ${visRows.filter(r=>r.tier==='niche').length}`, '판매 중 상품 기준')}
          ${tile('예상 매출총이익(90일)', gpKnown.length ? fmtN(Math.round(gpSum))+'원' : '자료 부족', pplAll ? `확정 인원 ${fmtN(pplAll)}명 중 이익 입력 상품 ${fmtN(pplKnown)}명 기준` : '확정 예약 없음')}
        </div>
        <p class="crm-note" style="margin-top:8px">추천 점수 = 고객 적합도(가장 큰 비중) + 판매 전략 등급(핵심 +8%, 틈새는 적합도 80% 이상일 때 +4%) + 최근 노출이 적은 상품 기회 보정(최대 +6%).
          가중치와 보정은 적합도가 충분한 상품에만 적용되고, 같은 국가는 최대 2개까지 여러 테마로 나눠 소개합니다. 예상 매출총이익은 입력한 1인 이익 × 확정 인원으로 계산한 참고값입니다.</p></div>
      <div class="crm-card"><h5>🎯 상품별 판매 전략 <span class="crm-note" style="font-weight:500">— 등급은 홈페이지 추천에 반영, 이익·만족도는 관리자만 봄</span></h5>
        <div class="st-tbl-wrap"><table class="st-tbl"><thead><tr><th>상품</th><th>판매 전략 등급</th><th>1인 예상 매출총이익(원)</th><th>만족도(1~5)</th><th>만족도 근거</th><th>제안</th><th>추천 노출(30일)</th><th>상세 보기</th><th>상담 이동</th><th>상담(90일)</th><th>예약 확정(90일)</th><th>예상 매출총이익</th></tr></thead><tbody>
          ${sorted.map(r=>{ const sg = suggest(r); return `<tr${r.visible?'':' style="opacity:.55"'}><td style="white-space:normal;min-width:150px"><b>${esc(r.x.title)}</b><br><span class="crm-note">${esc(r.x.catKo)}${r.visible?'':' · 판매 중 아님'}</span></td>
            <td>${tierSel(r)}</td><td>${numIn(r,'gross_margin_per_person','예: 150000',96)}</td><td>${numIn(r,'satisfaction','예: 4.5',56)}</td>
            <td><input type="text" value="${esc(r.st.satisfaction_source||'')}" placeholder="예: 출발 고객 설문 12건" style="width:150px" ${S.missing?'disabled':''} onchange="TGT_CRM.saveStrategy('${esc(r.x.uid)}', 'satisfaction_source', this.value)"></td>
            <td><span class="crm-tag ${sg[1]}">${sg[0]}</span></td>
            <td>${fmtN(r.views)}${totalViews?` <span class="crm-note">(${Math.round(r.views/totalViews*100)}%)</span>`:''}</td><td>${fmtN(r.clicks)}</td><td>${fmtN(r.inq)}</td><td>${fmtN(r.cons)}</td>
            <td>${fmtN(r.bookings)}건 · ${fmtN(r.people)}명</td><td>${r.gp!=null ? fmtN(Math.round(r.gp))+'원' : '—'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="crm-note">제안은 입력값만으로 만든 참고 표시이며 자동으로 바뀌지 않습니다. 핵심 후보: 이익이 입력 상품의 중간값 이상이고 만족도 4.0 이상(이익 입력 상품 3개 이상일 때). 만족도 3.5 미만은 점검 표시.</p></div>`;
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
      else if (state.sub==='stats' && !state.stats.loaded) loadStats().then(renderBody);
      else if (state.sub==='ops' && !state.ops.loaded) loadOps().then(renderBody);
      else if (state.sub==='intel' && !(state.stats.loaded && state.ops.loaded)) Promise.all([loadStats(), loadOps()]).then(renderBody);
      else if (state.sub==='strategy' && !state.strat.loaded) loadStrategy().then(renderBody);
      else renderBody();
    });
  }
  function go(sub){
    state.sub = sub; if (sub!=='bookings') state.bookingFlash = '';
    render();
    if (sub==='list') loadList().then(renderBody);
    if (sub==='bookings') loadBookings().then(renderBody);
    if (sub==='links') loadLinks(true).then(renderBody);
    if (sub==='stats') loadStats(true).then(renderBody);
    if (sub==='ops') loadOps(true).then(renderBody);
    if (sub==='intel') Promise.all([loadStats(true), loadOps(true)]).then(renderBody);
    if (sub==='strategy') loadStrategy(true).then(renderBody);
  }
  function renderBody(){
    const body = document.getElementById('crmBody'); if (!body) return;
    if (state.sub==='quick') body.innerHTML = quickHTML();
    else if (state.sub==='list') body.innerHTML = listHTML();
    else if (state.sub==='bookings') body.innerHTML = bookingsHTML();
    else if (state.sub==='links') body.innerHTML = linksHTML();
    else if (state.sub==='stats') body.innerHTML = statsHTML();
    else if (state.sub==='ops') body.innerHTML = opsHTML();
    else if (state.sub==='intel') body.innerHTML = intelHTML();
    else if (state.sub==='strategy') body.innerHTML = strategyHTML();
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
    </div>
    <div class="crm-card"><h5>💾 백업 내보내기</h5>
      <p class="crm-note">상담·예약·이력·가져오기 기록·연결 승인·운영 조건·출발 그룹·행동 기록 테이블 전체를 JSON 파일 하나로 내려받습니다. 고객 이름·연락처가 들어 있으니 안전한 곳에 보관하세요. 내보내기는 접근 기록에 남습니다.</p>
      <button type="button" class="crm-btn primary" ${isUsable()?'':'disabled'} onclick="TGT_CRM.exportBackup(this)">JSON 백업 내려받기</button>
      <span class="crm-note" id="crmBackupMsg" style="margin-left:8px"></span></div>`;
  }
  async function exportBackup(btn){
    if (!isUsable()) return;
    const msg = document.getElementById('crmBackupMsg');
    if (btn) btn.disabled = true;
    try{
      const client = sb(), out = {exported_at:new Date().toISOString(), source:'THE GOLF TREND 상담·예약', tables:{}};
      const names = ['consultations','revisions','bookings','bookingHistory','imports','links','rules','groups','events','accessLogs'];
      for (const k of names){
        const rows = []; const page = 1000;
        for (let from=0; from<200000; from+=page){
          if (msg) msg.textContent = `${TABLES[k]} 받는 중... ${rows.length}건`;
          const { data, error } = await client.from(TABLES[k]).select('*').order('id', {ascending:true}).range(from, from+page-1);
          if (error) throw new Error(TABLES[k]+': '+errText(error));
          rows.push(...(data||[]));
          if (!data || data.length < page) break;
        }
        out.tables[TABLES[k]] = rows;
      }
      { const { data, error } = await client.from(STRATEGY_TABLE).select('*').limit(10000); if (!error) out.tables[STRATEGY_TABLE] = data||[]; }
      await logAccess('export_backup', 'tgt_*', {counts:Object.fromEntries(Object.entries(out.tables).map(([k,v])=>[k, v.length]))});
      const t = todayKst();
      const blob = new Blob([JSON.stringify(out, null, 1)], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `thegolftrend-crm-backup-${t.y}${pad2(t.m)}${pad2(t.d)}.json`;
      document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      if (msg) msg.textContent = '✅ ' + Object.entries(out.tables).map(([k,v])=>`${k.replace('tgt_','')} ${v.length}`).join(' · ');
    }catch(e){ if (msg) msg.textContent = '⚠️ 백업 실패: ' + errText(e); }
    if (btn) btn.disabled = false;
  }
  async function recheck(){ await checkReady(true); render(); }

  window.TGT_CRM = {
    render, go, recheck,
    pick, set:setField, addPref, memoInput, applyMemo, mic, resetForm, save,
    filter, edit, followUp, history, remove, reloadList, fromLead,
    impPickFile, impSetSheet, impSetHeaderRow, impSetMap, impBuildPreview, impRun, impDownloadErrors, impReset:()=>{ impReset(); renderBody(); },
    statFilter, statSeason, reloadStats,
    newRule, editRule, rfSet, saveRule, deleteRule, verifyRule, cancelRule:()=>{ state.ops.ruleForm = null; renderBody(); }, opsView:v=>{ state.ops.view = v; renderBody(); },
    createGroup, groupToggle, groupSet, groupDetach, exportBackup, setTier, saveStrategy,
    newBooking, newBookingFromConsult, bfSet, saveBooking, bookingCancelForm, changeBooking, bookingHistory, bFilter, findLinks, decideLink,
    _internal:{ visitStats, productGaps, supplyFor, eventsInScope, twoPaxStatus, buildThreads, summarize, quantile, allProducts, checkReady, fmtKst, parseMemo, formToRow, TABLES, state, imp, toDateStr, toStatus, guessMapping, autoLink },
  };
})();
