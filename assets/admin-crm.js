/* THE GOLF TREND — 관리자 패널 "상담·예약" (상담·예약 데이터 통합)
 * 관리자 패널의 상담·예약 탭을 열 때만 불러온다(index.html의 tgtLoadCrm). 홈페이지 방문자에게는 내려가지 않는다.
 * index.html의 전역 함수·데이터를 그대로 재사용한다: getSupabaseClient, adminSession, CATEGORIES, getProducts,
 * STYLE_OPTIONS, escapeAttr, isDomesticCat 등.
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

  const state = { root:null, sub:'check', ready:null, readyChecked:false };

  // ── 공통 도우미 ──────────────────────────────────────────────
  const esc = v => escapeAttr(String(v==null ? '' : v));
  const sb = () => getSupabaseClient();
  // 한국 시간 표시(저장은 UTC timestamptz)
  const KST_FMT = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false});
  function fmtKst(ts){ if (!ts) return ''; const d = new Date(ts); return isNaN(d) ? '' : KST_FMT.format(d); }
  function isMissingTableError(err){
    if (!err) return false;
    const m = String(err.message||'') + ' ' + String(err.code||'');
    return /does not exist|42P01|PGRST205|PGRST202|Could not find/i.test(m);
  }
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
      .crm-banner code{background:rgba(0,0,0,.06);padding:1px 5px;border-radius:5px}
      .crm-check-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
      .crm-check-list li{display:flex;align-items:center;gap:8px;font-size:.8rem}
      .crm-check-list .ic{width:20px;text-align:center}
      .crm-check-list .sub{color:var(--nm-text-soft,#5b6577);font-size:.74rem}
      .crm-empty{padding:18px;text-align:center;color:var(--nm-text-soft,#5b6577);font-size:.82rem}
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

  function readyBanner(r){
    if (!r) return '';
    if (!r.lib) return `<div class="crm-banner warn">Supabase 연결 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.</div>`;
    if (!r.session) return `<div class="crm-banner warn">관리자 로그인이 필요합니다.</div>`;
    if (!r.sqlApplied) return `<div class="crm-banner warn">🛠 상담·예약 DB가 아직 준비되지 않았습니다. Supabase SQL Editor에서 <code>${SQL_FILE}</code>을 한 번 실행해 주세요.
      실행 전에도 홈페이지·상품 관리·AI 리드는 지금처럼 동작합니다.</div>`;
    if (r.isAdmin===false) return `<div class="crm-banner warn">🔒 현재 계정(${esc(r.email)})은 상담·예약 관리자 목록(tgt_admins)에 없습니다. SQL 파일 맨 아래 안내대로 관리자로 추가해 주세요.</div>`;
    return '';
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
      <div id="crmReadyBanner"></div>
      <div id="crmBody"></div>
    </div>`;
    renderBody();
    checkReady().then(r=>{
      const b = document.getElementById('crmReadyBanner'); if (b) b.innerHTML = readyBanner(r);
      if (state.sub==='check') renderBody();
    });
  }
  function go(sub){ state.sub = sub; render(); }
  function renderBody(){
    const body = document.getElementById('crmBody'); if (!body) return;
    if (state.sub==='check') body.innerHTML = checkHTML(state.ready);
    else body.innerHTML = `<div class="crm-card"><div class="crm-empty">이 화면은 다음 단계에서 순서대로 제공됩니다. (현재: 1단계 — DB·권한·연결 점검)</div></div>`;
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

  window.TGT_CRM = { render, go, recheck, _internal:{ allProducts, checkReady, fmtKst, TABLES } };
})();
