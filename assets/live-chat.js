/* THE GOLF TREND — 실시간 상담 채팅(방문자 화면)
 * index.html의 상담 버튼(#tgtChatFab)을 처음 누를 때(또는 이전 상담이 남아 있을 때) 불러온다 — 일반 방문자의 첫 화면 속도에는 영향이 없다.
 * DB: docs/sql/2026-10-28_live_chat.sql (tgt_chat_* 테이블·함수). 방문자는 상담 시작 때 받은 비밀 토큰으로 자기 상담만 읽고 쓴다.
 * 2단계(docs/sql/2026-10-29_live_chat_v2.sql): 시작 전 성별·출발지역(시/도 → 시/군/구) 수집, 답변 대기 경과 표시
 * 이 파일이 쓰는 index.html 전역: getLeadClient/getSupabaseClient, LEAD_CONSENT, SITE_CONTACT, getLegalUrl, openKakaoChat
 */
(function(){
  'use strict';
  if (window.TGT_CHAT) return;

  const KEY = 'kundo_chat_v1', PROF_KEY = 'kundo_chat_profile_v1';
  const CONSENT_VERSION = 'chat-2026-10-29';   // 성별·출발지역 추가
  const HOURS = {days:[1,2,3,4,5], start:9, end:18, label:'평일 09:00–18:00'};   // 한국 시간
  const POLL_OPEN = 2500, POLL_IDLE = 15000;

  // 출발지역 — 시/도를 고르면 그 지역의 시/군/구만 고른다(2026년 기준 행정구역, 인천은 2026-07 개편 반영). 세종은 시/군/구 없음
  const REGIONS = {
    '서울특별시':'강남구 강동구 강북구 강서구 관악구 광진구 구로구 금천구 노원구 도봉구 동대문구 동작구 마포구 서대문구 서초구 성동구 성북구 송파구 양천구 영등포구 용산구 은평구 종로구 중구 중랑구',
    '부산광역시':'강서구 금정구 기장군 남구 동구 동래구 부산진구 북구 사상구 사하구 서구 수영구 연제구 영도구 중구 해운대구',
    '대구광역시':'군위군 남구 달서구 달성군 동구 북구 서구 수성구 중구',
    '인천광역시':'강화군 검단구 계양구 남동구 미추홀구 부평구 서구 연수구 영종구 옹진군 제물포구',
    '광주광역시':'광산구 남구 동구 북구 서구',
    '대전광역시':'대덕구 동구 서구 유성구 중구',
    '울산광역시':'남구 동구 북구 울주군 중구',
    '세종특별자치시':'',
    '제주특별자치도':'서귀포시 제주시',
    '경기도':'가평군 고양시 과천시 광명시 광주시 구리시 군포시 김포시 남양주시 동두천시 부천시 성남시 수원시 시흥시 안산시 안성시 안양시 양주시 양평군 여주시 연천군 오산시 용인시 의왕시 의정부시 이천시 파주시 평택시 포천시 하남시 화성시',
    '강원도':'강릉시 고성군 동해시 삼척시 속초시 양구군 양양군 영월군 원주시 인제군 정선군 철원군 춘천시 태백시 평창군 홍천군 화천군 횡성군',
    '충청북도':'괴산군 단양군 보은군 영동군 옥천군 음성군 제천시 증평군 진천군 청주시 충주시',
    '충청남도':'계룡시 공주시 금산군 논산시 당진시 보령시 부여군 서산시 서천군 아산시 예산군 천안시 청양군 태안군 홍성군',
    '전라북도':'고창군 군산시 김제시 남원시 무주군 부안군 순창군 완주군 익산시 임실군 장수군 전주시 정읍시 진안군',
    '전라남도':'강진군 고흥군 곡성군 광양시 구례군 나주시 담양군 목포시 무안군 보성군 순천시 신안군 여수시 영광군 영암군 완도군 장성군 장흥군 진도군 함평군 해남군 화순군',
    '경상북도':'경산시 경주시 고령군 구미시 김천시 문경시 봉화군 상주시 성주군 안동시 영덕군 영양군 영주시 영천시 예천군 울릉군 울진군 의성군 청도군 청송군 칠곡군 포항시',
    '경상남도':'거제시 거창군 고성군 김해시 남해군 밀양시 사천시 산청군 양산시 의령군 진주시 창녕군 창원시 통영시 하동군 함안군 함양군 합천군',
  };
  function sigunguOf(sido){ const v = REGIONS[sido]; return v ? v.split(' ') : []; }

  // ── 저장된 상담 ─────────────────────────────────────────────
  function load(){ try{ const v = JSON.parse(localStorage.getItem(KEY)||'null'); return (v && v.token) ? v : null; }catch(e){ return null; } }
  function save(){ try{ if (S.token) localStorage.setItem(KEY, JSON.stringify({token:S.token, lastId:S.lastId, startedAt:S.startedAt||Date.now()})); else localStorage.removeItem(KEY); }catch(e){} }
  function loadProf(){ try{ return JSON.parse(localStorage.getItem(PROF_KEY)||'{}') || {}; }catch(e){ return {}; } }
  const saved = load();
  const S = {token: saved ? saved.token : '', lastId: saved ? (saved.lastId||0) : 0, startedAt: saved ? saved.startedAt : 0,
    open:false, status:'대기', agentOnline:false, unread:0, timer:null, polling:false, seen:new Set(), lastWaitNote:0, error:''};

  // ── 도우미 ─────────────────────────────────────────────────
  const $ = (sel, root) => (root||document).querySelector(sel);
  function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text!=null) e.textContent = text; return e; }
  function client(){
    try{ return (typeof getLeadClient==='function' && getLeadClient()) || (typeof getSupabaseClient==='function' && getSupabaseClient()) || null; }catch(e){ return null; }
  }
  function kstNow(){ const d = new Date(Date.now() + 9*3600000); return {day:d.getUTCDay(), h:d.getUTCHours() + d.getUTCMinutes()/60}; }
  function inHours(){ const n = kstNow(); return HOURS.days.includes(n.day) && n.h >= HOURS.start && n.h < HOURS.end; }
  function hhmm(t){ const d = t ? new Date(t) : new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  function contact(){ return (typeof SITE_CONTACT!=='undefined' && SITE_CONTACT) || {phone:'010-9405-6842', kakaoChat:'http://pf.kakao.com/_SSxgFG/chat'}; }
  function errText(e){ return String((e && (e.message || e.details)) || e || ''); }

  // ── 화면 만들기 ─────────────────────────────────────────────
  const CSS = `
#tgtChat{position:fixed;left:20px;bottom:calc(20px + env(safe-area-inset-bottom));width:380px;max-width:calc(100vw - 24px);height:min(620px,calc(100dvh - 40px));z-index:230;display:none;flex-direction:column;background:#fff;color:#1b2536;border-radius:16px;box-shadow:0 18px 50px rgba(3,13,38,.38);overflow:hidden;font-family:'Pretendard','Noto Sans KR',-apple-system,sans-serif;font-size:15px}
#tgtChat.open{display:flex}
#tgtChat *{box-sizing:border-box}
.tc-head{flex:none;display:flex;align-items:center;gap:10px;padding:14px 14px 12px 16px;background:linear-gradient(135deg,#030D26,#0f2347);color:#fff}
.tc-head-t{flex:1;min-width:0}
.tc-title{font-weight:800;font-size:1rem;letter-spacing:.01em}
.tc-sub{font-size:.76rem;opacity:.9;margin-top:2px;display:flex;align-items:center;gap:6px}
.tc-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:none}
.tc-dot.on{background:#22c55e}.tc-dot.wait{background:#f59e0b}
.tc-x{flex:none;width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:1.15rem;cursor:pointer;line-height:1}
.tc-x:hover{background:rgba(255,255,255,.26)}
.tc-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:14px 14px 8px;background:#f4f6fa;-webkit-overflow-scrolling:touch}
.tc-msg{display:flex;flex-direction:column;margin:0 0 10px;max-width:100%}
.tc-msg .tc-who{font-size:.7rem;color:#6b7788;margin:0 4px 3px}
.tc-bub{display:inline-block;max-width:86%;padding:10px 13px;border-radius:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.tc-msg.me{align-items:flex-end}.tc-msg.me .tc-bub{background:#0f2347;color:#fff;border-bottom-right-radius:4px}
.tc-msg.agent,.tc-msg.bot{align-items:flex-start}.tc-msg.agent .tc-bub{background:#fff;border:1px solid #dde3ee;border-bottom-left-radius:4px}
.tc-msg.bot .tc-bub{background:#fff7e6;border:1px solid #f1dcae;border-bottom-left-radius:4px}
.tc-msg .tc-time{font-size:.66rem;color:#8a94a6;margin:3px 4px 0}
.tc-msg.system{align-items:center}.tc-msg.system .tc-bub{background:transparent;color:#6b7788;font-size:.78rem;text-align:center;padding:4px 8px}
.tc-chips{display:flex;flex-wrap:wrap;gap:7px;margin:2px 0 12px}
.tc-chip{padding:8px 12px;border-radius:999px;border:1px solid #c9962b;background:#fff;color:#7a5410;font-size:.84rem;font-weight:700;cursor:pointer;font-family:inherit}
.tc-chip:hover{background:#fff6e0}
.tc-act{display:inline-block;margin-top:8px;padding:8px 12px;border-radius:10px;background:#c9962b;color:#fff!important;font-weight:800;font-size:.84rem;text-decoration:none;border:none;cursor:pointer;font-family:inherit}
.tc-form{background:#fff;border:1px solid #dde3ee;border-radius:14px;padding:14px;margin:0 0 12px}
.tc-form h4{margin:0 0 4px;font-size:.98rem}
.tc-form p.tc-note{margin:0 0 10px;font-size:.8rem;color:#667385;line-height:1.5}
.tc-form .tc-f{display:block;margin:0 0 9px;font-size:.78rem;font-weight:700;color:#3a4658}
.tc-form input[type=text],.tc-form input[type=tel]{display:block;width:100%;margin-top:4px;padding:11px 12px;border:1px solid #c7cfdc;border-radius:10px;font-size:16px;font-family:inherit;color:#1b2536;background:#fff}
.tc-form input:focus,.tc-in textarea:focus{outline:none;border-color:#c9962b;box-shadow:0 0 0 3px rgba(201,150,43,.2)}
.tc-ck{display:flex;gap:8px;align-items:flex-start;margin:6px 0;font-size:.8rem;line-height:1.45;color:#2a3546}
.tc-ck input{margin-top:3px;width:18px;height:18px;flex:none}
.tc-ck b.req{color:#c0392b}
.tc-more{margin:2px 0 8px 26px;font-size:.76rem;color:#667385;line-height:1.5}
.tc-more summary{cursor:pointer;color:#7a5410;font-weight:700}
.tc-more dl{margin:6px 0 0}.tc-more dt{font-weight:800;margin-top:4px}.tc-more dd{margin:0}
.tc-form select{display:block;width:100%;margin-top:4px;padding:11px 12px;border:1px solid #c7cfdc;border-radius:10px;font-size:16px;font-family:inherit;color:#1b2536;background:#fff}
.tc-form select:focus{outline:none;border-color:#c9962b;box-shadow:0 0 0 3px rgba(201,150,43,.2)}
.tc-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tc-seg{display:flex;gap:8px;margin-top:4px}
.tc-seg label{flex:1;position:relative;cursor:pointer}
.tc-seg input{position:absolute;opacity:0;pointer-events:none}
.tc-seg span{display:block;text-align:center;padding:10px 0;border:1px solid #c7cfdc;border-radius:10px;font-size:.92rem;font-weight:700;color:#3a4658;background:#fff}
.tc-seg input:checked + span{border-color:#c9962b;background:#fff6e0;color:#7a5410;box-shadow:inset 0 0 0 1px #c9962b}
.tc-seg input:focus-visible + span{box-shadow:0 0 0 3px rgba(201,150,43,.3)}
.tc-err{color:#c0392b;font-size:.8rem;margin:6px 0 0;min-height:1em}
.tc-go{width:100%;margin-top:6px;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#d8ab45,#b98a24);color:#fff;font-weight:800;font-size:1rem;cursor:pointer;font-family:inherit}
.tc-go:disabled{opacity:.6;cursor:default}
.tc-foot{flex:none;border-top:1px solid #e3e8f0;background:#fff;padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
.tc-menu{display:none;flex-wrap:wrap;gap:7px;margin:0 0 9px}
.tc-menu.show{display:flex}
.tc-in{display:flex;align-items:flex-end;gap:8px}
.tc-in textarea{flex:1;min-width:0;resize:none;max-height:110px;padding:10px 12px;border:1px solid #c7cfdc;border-radius:12px;font-size:16px;line-height:1.4;font-family:inherit;color:#1b2536}
.tc-plus,.tc-send{flex:none;width:42px;height:42px;border-radius:12px;border:1px solid #c7cfdc;background:#fff;color:#334155;font-size:1.3rem;cursor:pointer;font-family:inherit}
.tc-send{background:#0f2347;border-color:#0f2347;color:#fff;font-size:1.05rem}
.tc-send:disabled{opacity:.45;cursor:default}
.tc-tools{display:flex;justify-content:space-between;margin-top:7px;font-size:.72rem;color:#8a94a6}
.tc-tools button{background:none;border:none;color:#8a94a6;font-size:.72rem;text-decoration:underline;cursor:pointer;font-family:inherit;padding:0}
@media(max-width:560px){
  #tgtChat{left:0;right:0;bottom:0;width:100%;max-width:100%;height:92dvh;border-radius:16px 16px 0 0}
}`;

  let root, bodyEl, subEl, dotEl, inputEl, sendBtn, menuEl, footEl;

  function build(){
    if (root) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = el('div'); root.id = 'tgtChat'; root.setAttribute('role','dialog'); root.setAttribute('aria-label','THE GOLF TREND 실시간 상담');
    root.innerHTML = `
      <div class="tc-head"><div class="tc-head-t"><div class="tc-title">THE GOLF TREND 상담</div><div class="tc-sub"><i class="tc-dot"></i><span class="tc-status"></span></div></div><button type="button" class="tc-x" aria-label="상담창 닫기">✕</button></div>
      <div class="tc-body" aria-live="polite"></div>
      <div class="tc-foot"><div class="tc-menu"></div>
        <div class="tc-in"><button type="button" class="tc-plus" aria-label="빠른 메뉴" title="빠른 메뉴">+</button><textarea rows="1" maxlength="2000" placeholder="메시지를 입력하세요" aria-label="메시지 입력"></textarea><button type="button" class="tc-send" aria-label="보내기">➤</button></div>
        <div class="tc-tools"><span>Enter 전송 · Shift+Enter 줄바꿈</span><button type="button" class="tc-new">새 상담 시작</button></div>
      </div>`;
    document.body.appendChild(root);
    bodyEl = $('.tc-body', root); subEl = $('.tc-status', root); dotEl = $('.tc-dot', root);
    inputEl = $('textarea', root); sendBtn = $('.tc-send', root); menuEl = $('.tc-menu', root); footEl = $('.tc-foot', root);
    $('.tc-x', root).addEventListener('click', close);
    sendBtn.addEventListener('click', send);
    $('.tc-plus', root).addEventListener('click', ()=>menuEl.classList.toggle('show'));
    $('.tc-new', root).addEventListener('click', ()=>{ if (!S.token || confirm('현재 상담 화면을 닫고 새 상담을 시작할까요?\n(이전 상담 내용은 상담원에게 그대로 남아 있습니다)')) reset(); });
    inputEl.addEventListener('keydown', e=>{ if (e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){ e.preventDefault(); send(); } });
    inputEl.addEventListener('input', ()=>{ inputEl.style.height='auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 110)+'px'; });
    MENU.forEach(m=>{ const b = el('button','tc-chip',m.label); b.type='button'; b.addEventListener('click', ()=>{ menuEl.classList.remove('show'); menu(m); }); menuEl.appendChild(b); });
    document.addEventListener('keydown', e=>{ if (e.key==='Escape' && S.open) close(); });
  }

  // ── 빠른 메뉴(규칙 기반 안내) — 등록된 정보만 안내하고 금액·일정을 지어내지 않는다 ──
  function go(id){ close(); const t = document.getElementById(id); if (t) t.scrollIntoView({behavior:'smooth', block:'start'}); }
  const MENU = [
    {k:'ai',    label:'🤖 AI 골프여행 추천', say:'취향·예산·일정을 고르면 조건에 맞는 상품을 골라 드려요.', btn:'AI 추천 받으러 가기', act:()=>go('aiRecommend')},
    {k:'dest',  label:'🌏 여행지·상품 보기', say:'국내 6권역과 해외 국가별 골프 상품을 볼 수 있어요.', btn:'여행지 보러 가기', act:()=>go('destinations')},
    {k:'quote', label:'💰 견적·가격 문의',   say:'정확한 견적은 인원·일정·출발일에 따라 달라져요. 희망 지역과 인원, 출발 시기를 아래에 적어 보내 주시면 상담원이 확인해서 안내해 드립니다.'},
    {k:'cancel',label:'📄 취소·환불 규정',   say:'상품별 취소·환불 규정은 아래에서 확인할 수 있어요. 개별 상황은 상담원에게 문의해 주세요.', btn:'취소환불규정 보기', link:()=>{ try{ return getLegalUrl('cancel'); }catch(e){ return ''; } }},
    {k:'form',  label:'📝 상담 신청서 작성', say:'상담 신청서를 작성해 주시면 접수번호와 함께 상담원이 연락드려요.', btn:'상담 신청서로 이동', act:()=>go('booking')},
    {k:'call',  label:'📞 전화 상담',         say:'전화로 바로 상담받으실 수 있어요.', btn:'전화 걸기', link:()=>'tel:'+contact().phone, hint:()=>contact().phone},
    {k:'kakao', label:'💬 카카오톡 상담',     say:'카카오톡 채널에서도 상담받으실 수 있어요.', btn:'카카오톡 열기', act:()=>{ try{ openKakaoChat(); }catch(e){ window.open(contact().kakaoChat,'_blank','noopener'); } }},
  ];
  function menu(m){
    pushLocal('me', m.label.replace(/^[^\wㄱ-힣]+\s*/,''));
    botSay(m.say + (m.hint ? ' ('+m.hint()+')' : ''), m);
  }
  function botSay(text, m){
    const wrap = pushLocal('bot', text);
    if (m && m.btn){
      const url = m.link ? m.link() : '';
      if (m.link && !url) return;
      const a = el(url ? 'a' : 'button', 'tc-act', m.btn);
      if (url){ a.href = url; if (!/^tel:/.test(url)){ a.target = '_blank'; a.rel = 'noopener'; } }
      else { a.type = 'button'; a.addEventListener('click', m.act); }
      $('.tc-bub', wrap).appendChild(document.createElement('br')); $('.tc-bub', wrap).appendChild(a);
    }
    scrollEnd();
  }
  // 고객이 직접 쓴 글에서 자주 나오는 말에는 안내를 덧붙인다
  function faq(text){
    const t = String(text||'');
    if (/취소|환불/.test(t)) return MENU.find(m=>m.k==='cancel');
    if (/전화|통화|번호/.test(t)) return MENU.find(m=>m.k==='call');
    if (/추천|AI|어디가|코스 ?추천/i.test(t)) return MENU.find(m=>m.k==='ai');
    return null;
  }

  // ── 메시지 그리기 ───────────────────────────────────────────
  function pushLocal(kind, text, time){
    const wrap = el('div', 'tc-msg ' + (kind==='me'?'me':kind));
    if (kind==='agent') wrap.appendChild(el('div','tc-who','상담원'));
    if (kind==='bot') wrap.appendChild(el('div','tc-who','자동 안내'));
    const b = el('div','tc-bub'); b.textContent = text; wrap.appendChild(b);
    if (kind!=='system') wrap.appendChild(el('div','tc-time', hhmm(time)));
    bodyEl.appendChild(wrap); scrollEnd();
    return wrap;
  }
  function scrollEnd(){ if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight; }
  function addServerMsg(m){
    if (S.seen.has(m.id)) return;
    S.seen.add(m.id);
    pushLocal(m.s==='visitor' ? 'me' : (m.s==='admin' ? 'agent' : 'system'), m.b, m.t);
  }

  // ── 화면 상태 ───────────────────────────────────────────────
  function waitText(){
    if (S.status !== '대기' || S.waitSec == null || !S.token) return '';
    const m = Math.floor(S.waitSec / 60);
    return m < 1 ? ' · 방금 연결 요청' : ` · 답변 대기 ${m}분째`;
  }
  function statusLine(){
    if (S.agentOnline && waitText()){ dotEl.className='tc-dot on'; subEl.textContent = '상담원 온라인' + waitText(); }
    else if (S.agentOnline){ dotEl.className='tc-dot on'; subEl.textContent = '상담원 온라인 · 바로 답변드려요'; }
    else if (inHours()){ dotEl.className='tc-dot wait'; subEl.textContent = '상담 가능 시간 · 순서대로 답변드려요' + waitText(); }
    else { dotEl.className='tc-dot'; subEl.textContent = '운영시간 외 ('+HOURS.label+') · 메시지를 남겨 주세요'; }
  }
  function render(){
    if (!root) return;
    bodyEl.innerHTML = ''; S.seen = new Set();
    statusLine();
    const started = !!S.token;
    footEl.style.display = started ? '' : 'none';
    botSay('안녕하세요, THE GOLF TREND입니다 ⛳\n궁금한 점을 남겨 주시면 상담원이 답변드려요.' + (inHours() ? '' : '\n\n지금은 운영시간('+HOURS.label+')이 아니에요. 메시지는 저장되어 운영시간에 순서대로 답변드립니다.'));
    if (!started){ renderForm(); return; }
    renderChips();
    S.lastId = 0; save();
    pollOnce(); loop();   // 상담을 막 시작한 직후에도 새 답변을 계속 확인한다
  }
  function renderChips(){
    const box = el('div','tc-chips');
    MENU.forEach(m=>{ const b = el('button','tc-chip',m.label); b.type='button'; b.addEventListener('click', ()=>menu(m)); box.appendChild(b); });
    bodyEl.appendChild(box); scrollEnd();
  }
  function renderForm(){
    const prof = loadProf(), C = (typeof LEAD_CONSENT!=='undefined' && LEAD_CONSENT) || {};
    const f = el('form','tc-form'); f.noValidate = true;
    const privacy = (()=>{ try{ return getLegalUrl('privacy'); }catch(e){ return ''; } })();
    f.innerHTML = `
      <h4>상담 시작하기</h4>
      <p class="tc-note">상담을 위해 아래 정보가 필요해요. 대화가 끊겨도 연락드릴 수 있어요.</p>
      <label class="tc-f">이름<input type="text" name="name" maxlength="40" autocomplete="name" placeholder="홍길동"></label>
      <label class="tc-f">연락처<input type="tel" name="phone" maxlength="30" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>
      <div class="tc-f" role="radiogroup" aria-label="성별">성별<div class="tc-seg"><label><input type="radio" name="gender" value="남"><span>남</span></label><label><input type="radio" name="gender" value="여"><span>여</span></label></div></div>
      <div class="tc-f">출발지역<div class="tc-row2">
        <select name="sido" aria-label="출발지역 시/도"><option value="">시/도 선택</option>${Object.keys(REGIONS).map(k=>`<option>${esc(k)}</option>`).join('')}</select>
        <select name="sigungu" aria-label="출발지역 시/군/구" disabled><option value="">시/군/구 선택</option></select>
      </div></div>
      <label class="tc-ck"><input type="checkbox" name="consent"><span><b class="req">[필수]</b> 개인정보 수집·이용에 동의합니다.</span></label>
      <details class="tc-more"><summary>내용 보기</summary><dl>
        <dt>수집 항목</dt><dd>이름, 연락처, 성별, 출발지역(시/도·시/군/구), 상담 대화 내용</dd>
        <dt>이용 목적</dt><dd>실시간 상담 응대 및 문의 안내</dd>
        <dt>보유 기간</dt><dd>${esc(C.retention || '상담 종료 후 1년')}</dd>
        <dt>동의 거부</dt><dd>동의를 거부할 수 있으며, 거부하시면 실시간 채팅 상담이 제한됩니다(전화·카카오톡 상담은 이용 가능).</dd>
        ${privacy ? `<dd><a href="${esc(privacy)}" target="_blank" rel="noopener">개인정보처리방침 전문 보기</a></dd>` : ''}
      </dl></details>
      <label class="tc-ck"><input type="checkbox" name="mk"><span>[선택] 여행 소식·혜택 안내 수신에 동의합니다.</span></label>
      <div class="tc-err" role="alert"></div>
      <button type="submit" class="tc-go">상담 시작</button>`;
    f.elements['name'].value = prof.name || ''; f.elements['phone'].value = prof.phone || '';
    const sidoEl = f.elements['sido'], sggEl = f.elements['sigungu'];
    const fillSgg = (keep)=>{
      const list = sigunguOf(sidoEl.value);
      sggEl.innerHTML = `<option value="">${sidoEl.value && !list.length ? '시/군/구 없음' : '시/군/구 선택'}</option>` + list.map(x=>`<option>${esc(x)}</option>`).join('');
      sggEl.disabled = !list.length;
      if (keep && list.includes(keep)) sggEl.value = keep;
    };
    sidoEl.addEventListener('change', ()=>fillSgg(''));
    if (prof.sido && REGIONS[prof.sido] !== undefined){ sidoEl.value = prof.sido; fillSgg(prof.sigungu); }
    if (prof.gender){ const g = f.querySelector(`input[name=gender][value="${prof.gender==='여'?'여':'남'}"]`); if (g) g.checked = true; }
    f.addEventListener('submit', e=>{ e.preventDefault(); start(f); });
    bodyEl.appendChild(f); bodyEl.scrollTop = 0;   // 처음 화면은 인사말부터 보이게
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function unavailable(){
    const f = $('.tc-form', root), err = f && $('.tc-err', f);
    if (err) err.textContent = '실시간 상담이 아직 준비되지 않았어요. 전화·카카오톡으로 문의해 주세요.';
    MENU.filter(m=>m.k==='call' || m.k==='kakao').forEach(m=>botSay(m.say, m));
  }

  // ── 상담 시작 · 보내기 ──────────────────────────────────────
  async function start(f){
    const E = f.elements, err = $('.tc-err', f), name = E['name'].value.trim(), phone = E['phone'].value.trim(), digits = phone.replace(/\D/g,'');
    err.textContent = '';
    if (!name){ err.textContent = '이름을 입력해 주세요.'; E['name'].focus(); return; }
    if (digits.length < 8 || digits.length > 15){ err.textContent = '연락처를 정확히 입력해 주세요. (숫자 8자리 이상)'; E['phone'].focus(); return; }
    const gEl = f.querySelector('input[name=gender]:checked'), gender = gEl ? gEl.value : '';
    const sido = E['sido'].value, sigungu = E['sigungu'].value;
    if (!gender){ err.textContent = '성별을 선택해 주세요.'; return; }
    if (!sido){ err.textContent = '출발지역(시/도)을 선택해 주세요.'; E['sido'].focus(); return; }
    if (sigunguOf(sido).length && !sigungu){ err.textContent = '출발지역(시/군/구)을 선택해 주세요.'; E['sigungu'].focus(); return; }
    if (!E['consent'].checked){ err.textContent = '개인정보 수집·이용에 동의해 주셔야 채팅 상담을 시작할 수 있어요.'; return; }
    const c = client(); if (!c){ unavailable(); return; }
    const btn = $('.tc-go', f); btn.disabled = true; btn.textContent = '연결 중...';
    try{
      const args = {p_name:name, p_phone:phone, p_consent_version:CONSENT_VERSION, p_marketing:!!E['mk'].checked, p_page:(location.pathname + location.hash).slice(0,300)};
      let { data, error } = await c.rpc('tgt_chat_start', Object.assign({p_gender:gender, p_region_sido:sido, p_region_sigungu:sigungu||null}, args));
      // 2단계 SQL을 아직 실행하지 않은 경우: 성별·지역 없이 시작하고 첫 메시지로 남긴다
      let legacy = false;
      if (error && /PGRST202|Could not find the function|42883/i.test(errText(error))){ ({ data, error } = await c.rpc('tgt_chat_start', args)); legacy = !error; }
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.token) throw new Error('no-token');
      try{ localStorage.setItem(PROF_KEY, JSON.stringify({name, phone, gender, sido, sigungu})); }catch(e){}
      S.token = row.token; S.lastId = 0; S.startedAt = Date.now(); save();
      if (legacy){ try{ await c.rpc('tgt_chat_send', {p_token:row.token, p_body:`[고객 정보] 성별: ${gender} · 출발지역: ${sido}${sigungu?' '+sigungu:''}`}); }catch(e){} }
      render();
    }catch(e){
      console.error('chat start failed', e);
      const m = errText(e);
      btn.disabled = false; btn.textContent = '상담 시작';
      if (/rate_limit/.test(m)) err.textContent = '잠시 후 다시 시도해 주세요.';
      else if (/invalid_phone/.test(m)) err.textContent = '연락처를 정확히 입력해 주세요.';
      else if (/invalid_name/.test(m)) err.textContent = '이름을 확인해 주세요.';
      else { err.textContent = '연결에 실패했어요. 잠시 후 다시 시도하거나 전화·카카오톡으로 문의해 주세요.'; if (/PGRST202|42883|does not exist|Could not find/i.test(m)) unavailable(); }
    }
  }
  async function send(){
    const text = inputEl.value.trim(); if (!text || !S.token || sendBtn.disabled) return;
    const c = client(); if (!c) return;
    sendBtn.disabled = true;
    try{
      const { error } = await c.rpc('tgt_chat_send', {p_token:S.token, p_body:text});
      if (error) throw error;
      inputEl.value = ''; inputEl.style.height = 'auto';
      await pollOnce();
      // 상담원이 바로 답할 수 없을 때(오프라인) 한 번 안내 + 자주 묻는 말 안내
      const f = faq(text);
      if (f) botSay(f.say, f);
      if (!S.agentOnline && Date.now() - S.lastWaitNote > 10*60*1000){
        S.lastWaitNote = Date.now();
        botSay(inHours() ? '메시지를 전달했어요. 상담원이 확인하는 대로 답변드릴게요.' : '메시지를 남겨 주셨어요. 지금은 운영시간('+HOURS.label+')이 아니라 운영시간에 순서대로 답변드릴게요. 급하시면 전화·카카오톡도 이용해 주세요.');
      }
    }catch(e){
      console.error('chat send failed', e);
      const m = errText(e);
      if (/invalid_token/.test(m)){ expire(); }
      else pushLocal('system', /rate_limit/.test(m) ? '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.' : '전송에 실패했어요. 입력한 내용은 그대로 있으니 다시 시도해 주세요.');
    }finally{ sendBtn.disabled = false; inputEl.focus(); }
  }
  function expire(){ S.token=''; S.lastId=0; save(); stopPoll(); if (root){ render(); pushLocal('system','상담 연결이 만료되었어요. 새로 시작해 주세요.'); } }
  function reset(){ S.token=''; S.lastId=0; S.unread=0; save(); stopPoll(); badge(); render(); }

  // ── 새 메시지 가져오기 ──────────────────────────────────────
  async function pollOnce(){
    if (!S.token || S.polling) return;
    const c = client(); if (!c) return;
    S.polling = true;
    try{
      const { data, error } = await c.rpc('tgt_chat_poll', {p_token:S.token, p_after:S.lastId});
      if (error) throw error;
      if (data && data.error==='invalid'){ expire(); return; }
      S.status = data.status; S.agentOnline = !!data.agent_online;
      S.waitSec = (typeof data.wait_sec === 'number') ? data.wait_sec : null;
      if (root) statusLine();
      (data.messages||[]).forEach(m=>{
        if (m.id > S.lastId) S.lastId = m.id;
        if (root && S.open){ addServerMsg(m); }
        else if (m.s==='admin' && !S.seen.has(m.id)){ S.seen.add(m.id); S.unread++; }   // 닫힌 상태: 안 읽은 상담원 답변만 센다(화면을 다시 열면 render가 처음부터 불러온다)
      });
      save(); badge();
    }catch(e){ console.error('chat poll failed', e); }
    finally{ S.polling = false; }
  }
  function loop(){
    stopPoll();
    if (!S.token) return;
    const tick = async ()=>{ if (!document.hidden || !S.open) await pollOnce(); S.timer = setTimeout(tick, S.open ? POLL_OPEN : POLL_IDLE); };
    S.timer = setTimeout(tick, S.open ? POLL_OPEN : POLL_IDLE);
  }
  function stopPoll(){ if (S.timer){ clearTimeout(S.timer); S.timer = null; } }
  function badge(){
    const b = document.getElementById('tgtChatBadge'); if (!b) return;
    if (window.TGT_CHAT_ADMIN && window.TGT_CHAT_ADMIN.active && window.TGT_CHAT_ADMIN.active()) return;   // 관리자 로그인 중에는 상담원 알림 숫자를 표시

    b.hidden = !(S.unread > 0 && !S.open); b.textContent = S.unread > 9 ? '9+' : String(S.unread);
  }

  // ── 열기/닫기 ───────────────────────────────────────────────
  function open(){
    build();
    S.open = true; S.unread = 0; badge();
    root.classList.add('open');
    const fab = document.getElementById('tgtChatFab'); if (fab) fab.classList.add('is-open');
    render(); loop();
    setTimeout(()=>{ const t = S.token ? inputEl : $('input[name=name]', root); if (t) t.focus({preventScroll:true}); }, 60);
  }
  function close(){
    if (!root) return;
    S.open = false; root.classList.remove('open'); menuEl.classList.remove('show');
    const fab = document.getElementById('tgtChatFab'); if (fab) fab.classList.remove('is-open');
    loop();
  }
  function toggle(){ S.open ? close() : open(); }

  window.TGT_CHAT = {open, close, toggle, pollOnce};
  // 이전 상담이 남아 있으면 조용히 새 답변을 확인해 버튼에 안 읽은 표시를 단다
  if (S.token){ loop(); setTimeout(pollOnce, 800); }
})();
