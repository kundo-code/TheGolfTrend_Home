/* THE GOLF TREND — 관리자 "실시간 상담"(상담원 화면)
 * 관리자 로그인 후 index.html이 불러온다(tgtChatAdminBoot). 방문자 화면(live-chat.js)과 같은 DB를 쓴다.
 * DB: docs/sql/2026-10-28_live_chat.sql(1단계) + docs/sql/2026-10-29_live_chat_v2.sql(2단계: 성별·출발지역·메모·담당·대기 시간·통계·2중 비밀번호)
 *     2단계 SQL 전에도 1단계 기능(목록·대화·답변·종료·삭제)은 그대로 동작한다.
 * 하는 일
 *  ① 로그인 중 백그라운드로 새 상담·안 읽은 메시지 확인 → 패널 탭 배지 · 왼쪽 아래 상담 버튼 배지 · 알림음 · 바탕화면(푸시) 알림 · 브라우저 탭 제목
 *  ② 왼쪽 아래 상담 버튼으로 여는 "상담원 창"에서 바로 응대(목록·대화·답변·담당)
 *  ③ 패널 탭: 💬 상담 / 👥 고객 정보(마스킹·메모·엑셀·CSV 내보내기 — 2중 비밀번호) / 📈 통계 / ⚙️ 설정
 *  ④ 여러 상담원: 담당 지정(응대 중 잠금) · 답변한 상담원 기록 · 상담원별 온라인 표시
 *  ⑤ 대기 시간: 답변을 기다리는 상담을 오래 기다린 순서로 맨 위에, "N분째 대기" 표시
 * 개인정보 보호: 목록·화면에는 이름·연락처를 일부 가려(*) 표시한다. 전체 정보는 2중 비밀번호를 확인한 내보내기 파일에만 담긴다.
 */
(function(){
  'use strict';
  if (window.TGT_CHAT_ADMIN) return;

  const AVAIL_KEY = 'kundo_chat_avail', SOUND_KEY = 'kundo_chat_sound', PUSH_KEY = 'kundo_chat_push';
  const BG_MS = 8000, THREAD_MS = 3000, PING_MS = 30000;
  const BASE_COLS = 'id,created_at,last_message_at,name,phone,page,status,unread_admin,marketing_opt_in,consent_at,consent_version,visitor_seen_at,closed_at';
  const V2_COLS = ',gender,region_sido,region_sigungu,memo,assigned_to,assigned_name,assigned_at,waiting_since,first_response_at,crm_consultation_id';
  const S = {sessions:[], sel:null, msgs:[], lastId:0, waiting:0, prevMap:null, missing:false, error:'', v2:null,
    avail: localStorage.getItem(AVAIL_KEY) !== '0', sound: localStorage.getItem(SOUND_KEY) !== '0', push: localStorage.getItem(PUSH_KEY) === '1',
    root:null, view:'chat', bgTimer:null, uiTimer:null, pingTimer:null, busy:false, baseTitle:document.title, sending:false, loadedList:false,
    uid:null, myName:'', floatOpen:false, floatRoot:null, threadTab:'chat', reveal:{},
    cust:{period:'90', status:'', gender:'', sido:'', q:'', rows:[], loaded:false, loading:false, error:'', withMsgs:false},
    stats:{period:'30', data:null, loading:false, error:''}};

  const $ = (sel, root) => (root||document).querySelector(sel);
  function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text!=null) e.textContent = text; return e; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function client(){ try{ return getSupabaseClient(); }catch(e){ return null; } }
  function authed(){ try{ return !!adminSession || (typeof _tgtAuthed!=='undefined' && _tgtAuthed===true); }catch(e){ return false; } }
  function errText(e){ return String((e && (e.message || e.details || e.code)) || e || ''); }
  function hhmm(t){ const d = new Date(t); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  function when(t){
    const d = new Date(t), n = new Date(); const same = d.toDateString() === n.toDateString();
    return same ? hhmm(t) : `${d.getMonth()+1}/${d.getDate()} ${hhmm(t)}`;
  }
  function fullTime(t){ return t ? new Date(t).toLocaleString('ko-KR') : ''; }
  function isColMissing(error){ return /42703|column .* does not exist|Could not find the '.*' column/i.test(errText(error)); }
  function isMissing(error){ return !isColMissing(error) && /42P01|PGRST205|PGRST202|does not exist|Could not find the table|schema cache/i.test(errText(error)); }
  function isFnMissing(error){ return /PGRST202|42883|Could not find the function/i.test(errText(error)); }

  // ── 개인정보 마스킹 ─────────────────────────────────────────
  // 이름: 2글자는 두 번째 글자, 3글자는 가운데 글자, 4글자 이상은 처음·끝 글자만 남김 / 연락처: 가운데 번호(010-****-5678)
  function maskName(n){
    const a = Array.from(String(n||'').trim());
    if (a.length <= 1) return a.join('');
    if (a.length === 2) return a[0] + '*';
    return a[0] + '*'.repeat(a.length - 2) + a[a.length - 1];
  }
  function maskPhone(p){
    const raw = String(p||'').trim(), d = raw.replace(/\D/g,'');
    if (d.length < 8) return raw ? raw.replace(/\d(?=\d{2})/g, '*') : '';
    const head = /^02/.test(d) ? 2 : (d.length <= 8 ? 0 : 3), tail = 4, mid = d.length - head - tail;
    return [d.slice(0, head), '*'.repeat(mid), d.slice(-tail)].filter(Boolean).join('-');
  }
  function region(s){ return [s.region_sido, s.region_sigungu].filter(Boolean).join(' '); }
  function waitMin(s){ if (!s.waiting_since || s.status === '종료') return null; return Math.max(0, Math.floor((Date.now() - new Date(s.waiting_since).getTime()) / 60000)); }
  function waitChip(s){
    const m = waitMin(s); if (m == null) return '';
    const cls = m >= 15 ? 'hot' : (m >= 5 ? 'warm' : '');
    return `<span class="tca-wait ${cls}" title="고객이 답변을 기다린 시간">⏱ ${m < 1 ? '방금' : m + '분째'} 대기</span>`;
  }
  // 대기 중(답변 전) 상담을 오래 기다린 순서로 맨 위, 나머지는 최근 메시지 순
  function sorted(list){
    const w = s => s.status !== '종료' && (S.v2 ? !!s.waiting_since : s.status === '대기');
    return list.slice().sort((a, b)=>{
      const wa = w(a), wb = w(b);
      if (wa !== wb) return wa ? -1 : 1;
      if (wa && S.v2) return new Date(a.waiting_since) - new Date(b.waiting_since);
      return new Date(b.last_message_at) - new Date(a.last_message_at);
    });
  }

  // ── 알림(소리·배지·바탕화면 알림·제목) ─────────────────────────
  // 효과음: assets/sounds/chat-notify.mp3 (볼륨 70%). 새 상담 요청·새 고객 메시지가 오면 울린다
  const SOUND_URL = 'assets/sounds/chat-notify.mp3', VOLUME = 0.7;
  let sfx = null, audio = null;
  function getSfx(){
    if (!sfx){ sfx = new Audio(SOUND_URL); sfx.preload = 'auto'; sfx.volume = VOLUME; }
    return sfx;
  }
  function fallbackBeep(){
    try{
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(VOLUME * .35, audio.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .35);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + .38);
    }catch(e){}
  }
  function beep(force){
    if (!S.sound && !force) return;
    try{
      const a = getSfx(); a.volume = VOLUME; a.currentTime = 0;
      const p = a.play();
      if (p && p.then) p.then(()=>{ if (S.soundBlocked){ S.soundBlocked = false; paintSoundHint(); } }, err=>{
        if (err && err.name === 'NotAllowedError'){ S.soundBlocked = true; paintSoundHint(); }
        else fallbackBeep();
      });
    }catch(e){ fallbackBeep(); }
  }
  function paintSoundHint(){ document.querySelectorAll('.tca-soundhint').forEach(h=>{ h.hidden = !S.soundBlocked; }); }
  document.addEventListener('pointerdown', ()=>{ if (S.soundBlocked){ S.soundBlocked = false; paintSoundHint(); try{ getSfx().load(); }catch(e){} } }, {capture:true});

  // 바탕화면(푸시) 알림 — 이 사이트가 열려 있는 동안, 다른 탭·창을 보고 있어도 운영체제 알림으로 띄운다
  const pushSupported = () => typeof window.Notification !== 'undefined';
  function pushState(){ if (!pushSupported()) return 'unsupported'; return Notification.permission; }
  async function enablePush(on){
    S.push = !!on; localStorage.setItem(PUSH_KEY, S.push ? '1' : '0');
    if (S.push && pushSupported() && Notification.permission === 'default'){ try{ await Notification.requestPermission(); }catch(e){} }
    if (S.push && pushState() === 'granted') notify('🔔 바탕화면 알림이 켜졌어요', '새 상담·고객 메시지가 오면 이렇게 알려 드립니다.', null, true);
    renderAll();
  }
  function iconUrl(){ const l = document.querySelector('link[rel~="icon"]'); return l ? l.href : ''; }
  function notify(title, body, sid, force){
    if (!S.push || pushState() !== 'granted') return;
    if (!force && !document.hidden && document.hasFocus()) return;   // 화면을 보고 있으면 소리·배지로 충분
    const opts = {body, tag: sid ? 'tgt-chat-' + sid : 'tgt-chat', renotify: true, icon: iconUrl()};
    try{
      const n = new Notification(title, opts);
      n.onclick = ()=>{ try{ window.focus(); }catch(e){} if (sid) openFloat(sid); n.close(); };
    }catch(e){
      // 안드로이드 크롬 등은 서비스워커 알림만 허용 — 등록된 것이 있으면 사용
      try{ navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r=>{ if (r) r.showNotification(title, opts); }); }catch(e2){}
    }
    try{ if (navigator.vibrate) navigator.vibrate([120, 60, 120]); }catch(e){}
  }
  function paintBadge(){
    const n = authed() ? S.waiting : 0, txt = n > 9 ? '9+' : String(n);
    const b = document.getElementById('chatTabBadge');
    if (b){ b.hidden = !(n > 0); b.textContent = txt; }
    const fb = document.getElementById('tgtChatBadge'), fab = document.getElementById('tgtChatFab');
    if (fab){
      fab.classList.toggle('is-agent', authed());
      fab.classList.toggle('is-alert', n > 0);
      fab.setAttribute('aria-label', authed() ? `실시간 상담(상담원) — 답변 대기 ${n}건` : '실시간 상담 열기');
    }
    if (fb && authed()){ fb.hidden = !(n > 0); fb.textContent = txt; }
    document.title = n > 0 ? `(${n}) 새 상담 · ${S.baseTitle}` : S.baseTitle;
    const fh = S.floatRoot && $('.tcf-count', S.floatRoot); if (fh) fh.textContent = n > 0 ? `답변 대기 ${n}건` : '대기 중인 상담 없음';
  }

  // ── 데이터 ─────────────────────────────────────────────────
  async function selectSessions(build){
    const c = client();
    if (S.v2 !== false){
      const r = await build(c.from('tgt_chat_sessions').select(BASE_COLS + V2_COLS));
      if (!r.error){ S.v2 = true; return r; }
      if (!isColMissing(r.error)) return r;
      S.v2 = false;
    }
    return build(c.from('tgt_chat_sessions').select(BASE_COLS));
  }
  async function whoami(){
    if (S.uid) return;
    try{ const { data } = await client().auth.getSession(); S.uid = data && data.session ? data.session.user.id : null; }catch(e){}
    if (S.uid && S.v2){
      try{ const { data } = await client().from('tgt_chat_agents').select('display_name').eq('user_id', S.uid).maybeSingle(); S.myName = (data && data.display_name) || ''; }catch(e){}
    }
  }
  async function loadSessions(){
    const c = client(); if (!c || !authed()) return;
    const { data, error } = await selectSessions(q=>q.order('last_message_at', {ascending:false}).limit(150));
    if (error){ S.missing = isMissing(error); S.error = S.missing ? '' : errText(error); return; }
    S.missing = false; S.error = ''; S.sessions = sorted(data || []); S.loadedList = true;
    const open = S.sessions.filter(x=>x.status !== '종료');
    S.waiting = open.filter(x=>x.unread_admin > 0).length;
    // 새 상담·새 메시지 감지 → 소리 + 바탕화면 알림
    const map = {}; open.forEach(x=>{ map[x.id] = x.unread_admin || 0; });
    if (S.prevMap){
      let rang = false;
      open.forEach(x=>{
        const prev = S.prevMap[x.id], now = x.unread_admin || 0;
        if (now > 0 && (prev === undefined || now > prev)){
          if (!rang){ beep(); rang = true; }
          const who = maskName(x.name) + (region(x) ? ` · ${region(x)}` : '');
          notify(prev === undefined ? '💬 새 상담 요청' : '💬 새 고객 메시지', `${who}${prev === undefined ? '' : ` — 안 읽은 메시지 ${now}건`}`, x.id);
        }
      });
    }
    S.prevMap = map;
    paintBadge();
  }
  async function loadThread(full){
    const c = client(); if (!c || !S.sel) return;
    if (full){ S.msgs = []; S.lastId = 0; }
    const sel = S.sel;
    let r = await c.from('tgt_chat_messages').select('id,created_at,sender,body' + (S.v2 ? ',agent_name' : '')).eq('session_id', sel).gt('id', S.lastId).order('id', {ascending:true}).limit(500);
    if (r.error && isColMissing(r.error)) r = await c.from('tgt_chat_messages').select('id,created_at,sender,body').eq('session_id', sel).gt('id', S.lastId).order('id', {ascending:true}).limit(500);
    if (r.error || sel !== S.sel) return;
    const data = r.data;
    if (data && data.length){
      S.msgs = S.msgs.concat(data); S.lastId = data[data.length-1].id;
      if (data.some(m=>m.sender==='visitor')) markRead();
    }
  }
  async function markRead(){
    const c = client(); if (!c || !S.sel) return;
    const s = S.sessions.find(x=>x.id===S.sel); if (s){ s.unread_admin = 0; }
    if (S.prevMap && S.prevMap[S.sel] !== undefined) S.prevMap[S.sel] = 0;
    await c.from('tgt_chat_sessions').update({unread_admin:0}).eq('id', S.sel);
  }
  async function ping(){
    const c = client(); if (!c || !authed() || S.missing) return;
    try{ await c.rpc('tgt_chat_admin_ping', {p_online: !!S.avail}); }catch(e){}
  }

  // ── 백그라운드(로그인 중 항상) ─────────────────────────────
  async function bgTick(){
    if (S.busy) return; S.busy = true;
    try{ await loadSessions(); await whoami(); }catch(e){}
    S.busy = false;
    if (S.floatOpen) renderFloat();
  }
  function boot(){
    if (S.bgTimer){ paintBadge(); return; }
    getSfx(); bgTick(); ping();
    S.bgTimer = setInterval(()=>{ if (authed()) bgTick(); else { S.waiting = 0; paintBadge(); if (S.floatOpen) closeFloat(); } }, BG_MS);
    S.pingTimer = setInterval(()=>{ if (authed()) ping(); }, PING_MS);
    window.addEventListener('beforeunload', ()=>{ try{ const c = client(); if (c && authed()) c.rpc('tgt_chat_admin_ping', {p_online:false}); }catch(e){} });
  }

  // ── 스타일 ─────────────────────────────────────────────────
  const CSS = `
.tca{display:flex;flex-direction:column;gap:10px;font-size:.88rem;color:var(--nm-text,#202B3A)}
.tca-tabs{display:flex;flex-wrap:wrap;gap:6px}
.tca-tabs button{padding:8px 13px;border-radius:999px;border:1px solid rgba(10,23,48,.16);background:#fff;font-weight:800;font-size:.82rem;cursor:pointer;font-family:inherit;color:#334155}
.tca-tabs button.on{background:#0f2347;border-color:#0f2347;color:#fff}
.tca-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 12px;border-radius:12px;background:var(--nm-surface-light,#f4f7fb);border:1px solid rgba(10,23,48,.1)}
.tca-sw{display:inline-flex;align-items:center;gap:7px;font-weight:700;cursor:pointer}
.tca-sw input{width:18px;height:18px}
.tca-sw input[type=time]{width:auto;height:auto;min-width:110px;font-size:.85rem}
.tca-hint{font-size:.76rem;color:var(--nm-text-soft,#667385)}
.tca-warn{padding:12px 14px;border-radius:12px;background:#fff4e5;border:1px solid #f0c987;line-height:1.6}
.tca-wrap{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:10px;min-height:460px}
.tca-list{border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;overflow:auto;max-height:70vh}
.tca-item{display:block;width:100%;text-align:left;padding:10px 12px;border:none;border-bottom:1px solid rgba(10,23,48,.08);background:#fff;cursor:pointer;font-family:inherit;color:inherit}
.tca-item:hover{background:#f6f9ff}.tca-item.on{background:#eef4ff;box-shadow:inset 3px 0 0 #2563eb}
.tca-item .r1{display:flex;align-items:center;gap:6px;font-weight:800}
.tca-item .r2{display:flex;justify-content:space-between;gap:6px;margin-top:3px;font-size:.74rem;color:#6b7788}
.tca-item .r3{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:4px;font-size:.72rem;color:#475569}
.tca-chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:.68rem;font-weight:800;background:#e5e9f1;color:#475569;white-space:nowrap}
.tca-chip.wait{background:#fde8c8;color:#92400e}.tca-chip.go{background:#d6f5e0;color:#166534}.tca-chip.end{background:#e5e9f1;color:#64748b}
.tca-chip.me{background:#dbeafe;color:#1e40af}.tca-chip.other{background:#ede9fe;color:#5b21b6}
.tca-wait{font-weight:800;color:#92400e;white-space:nowrap}.tca-wait.warm{color:#c2410c}.tca-wait.hot{color:#be123c}
.tca-dot{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#e11d48;color:#fff;font-size:.72rem;font-weight:800;display:inline-flex;align-items:center;justify-content:center;margin-left:auto}
.tca-th{display:flex;flex-direction:column;border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;min-width:0;overflow:hidden}
.tca-th-h{padding:10px 12px;border-bottom:1px solid rgba(10,23,48,.1);display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;background:#f8fafc}
.tca-th-h b{font-size:1rem}
.tca-th-h a{color:#2563eb;font-weight:700;text-decoration:none}
.tca-meta{width:100%;font-size:.74rem;color:#6b7788;line-height:1.5;word-break:break-all}
.tca-btns{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px}
.tca-btns button,.tca-mini{padding:6px 11px;border-radius:9px;border:1px solid rgba(10,23,48,.18);background:#fff;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit;color:#1f2937}
.tca-btns button.danger{color:#c0392b}
.tca-btns button.pri,.tca-mini.pri{background:#0f2347;border-color:#0f2347;color:#fff}
.tca-cust{width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:6px;align-items:stretch;margin-top:2px}
.tca-cust .c{background:#fff;border:1px solid #dbe4f0;border-radius:10px;padding:6px 9px;min-width:0}
.tca-cust .c span{display:block;font-size:.7rem;font-weight:700;color:#64748b}
.tca-cust .c b{display:block;font-size:.95rem;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tca-cust .c b.none{color:#94a3b8;font-weight:600}
.tca-cust .c a{color:#1d4ed8;text-decoration:none}
.tca-reveal{align-self:center;padding:6px 9px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;font-size:.74rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap}
.tca-ttabs{width:100%;display:flex;gap:6px;margin-top:4px}
.tca-ttabs button{flex:1;padding:8px 10px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;font-size:.84rem;font-weight:800;color:#475569;cursor:pointer;font-family:inherit}
.tca-ttabs button.on{background:#0f2347;border-color:#0f2347;color:#fff}
.tca-ttabs em{font-style:normal;font-size:.7rem;font-weight:700;padding:1px 6px;border-radius:999px;background:#dcfce7;color:#166534;margin-left:4px}
.tca-rec{flex:1;min-height:260px;max-height:62vh;overflow:auto;padding:12px;background:#f4f6fa}
.tca-memo-card{background:#fff;border:1px solid #e2e8f0;border-left:5px solid #0f2347;border-radius:14px;padding:10px 12px}
.tca-memo-card .h{font-size:.98rem;font-weight:800;margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
.tca-rec-host .crm-card{margin-top:12px}
.tca-th{container-type:inline-size}
@container (max-width:560px){ .tca-rec .crm-grid2{grid-template-columns:1fr} .tca-cust{grid-template-columns:1fr 1fr} .tca-reveal{grid-column:1 / -1} }
.tca-assign{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:.78rem}
.tca-memo{width:100%;display:flex;gap:6px;align-items:flex-start}
.tca-memo textarea{flex:1;min-width:0;min-height:38px;max-height:120px;resize:vertical;padding:7px 9px;border:1px solid #c7cfdc;border-radius:9px;font-size:.82rem;font-family:inherit;line-height:1.4}
.tca-msgs{flex:1;min-height:260px;max-height:52vh;overflow:auto;padding:12px;background:#f4f6fa;display:flex;flex-direction:column;gap:8px}
.tca-m{max-width:82%;display:flex;flex-direction:column}
.tca-m .bub{padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.5}
.tca-m .t{font-size:.66rem;color:#8a94a6;margin:2px 4px 0}
.tca-m.v{align-self:flex-start}.tca-m.v .bub{background:#fff;border:1px solid #dde3ee}
.tca-m.a{align-self:flex-end;align-items:flex-end}.tca-m.a .bub{background:#0f2347;color:#fff}
.tca-m.s{align-self:center;align-items:center}.tca-m.s .bub{background:transparent;color:#6b7788;font-size:.76rem;padding:2px 6px}
.tca-rep{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(10,23,48,.1);background:#fff;align-items:flex-end}
.tca-rep textarea{flex:1;min-width:0;resize:none;max-height:120px;padding:9px 11px;border:1px solid #c7cfdc;border-radius:10px;font-size:.9rem;font-family:inherit;line-height:1.4}
.tca-rep button{padding:10px 16px;border-radius:10px;border:none;background:var(--nm-gold-grad,linear-gradient(135deg,#d8ab45,#b98a24));color:#fff;font-weight:800;cursor:pointer;font-family:inherit}
.tca-rep button:disabled{opacity:.5}
.tca-empty{display:flex;align-items:center;justify-content:center;min-height:200px;color:#8a94a6;text-align:center;padding:16px;line-height:1.6}
.tca-back{display:none}
@media(max-width:820px){
  .tca-wrap{grid-template-columns:1fr}
  .tca-wrap.thread .tca-list{display:none}
  .tca-wrap:not(.thread) .tca-th{display:none}
  .tca-back{display:inline-block}
}
/* 고객 정보 */
.tcc-filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tcc-filters select,.tcc-filters input[type=search]{padding:7px 9px;border:1px solid #c7cfdc;border-radius:9px;font-size:.82rem;font-family:inherit;background:#fff}
.tcc-filters input[type=search]{min-width:150px;flex:1}
.tcc-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tcc-tbl-wrap{overflow:auto;border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;max-height:66vh}
.tcc-tbl{width:100%;border-collapse:collapse;font-size:.8rem;min-width:820px}
.tcc-tbl th{position:sticky;top:0;background:#f1f5f9;text-align:left;padding:8px;font-weight:800;color:#334155;border-bottom:1px solid #dbe2ec;white-space:nowrap}
.tcc-tbl td{padding:7px 8px;border-bottom:1px solid #edf1f6;vertical-align:top}
.tcc-tbl tr:hover td{background:#fafcff}
.tcc-tbl .memo{display:flex;gap:4px;min-width:220px}
.tcc-tbl .memo input{flex:1;min-width:0;padding:5px 7px;border:1px solid #c7cfdc;border-radius:7px;font-size:.78rem;font-family:inherit}
.tcc-tbl .memo button{padding:4px 8px;border-radius:7px;border:1px solid #c7cfdc;background:#fff;font-size:.74rem;font-weight:800;cursor:pointer;font-family:inherit}
.tcc-tbl .memo button.dirty{background:#0f2347;border-color:#0f2347;color:#fff}
.tcc-note{font-size:.74rem;color:#667385;line-height:1.55}
/* 통계 */
.tcs-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.tcs-tile{border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;padding:10px 12px}
.tcs-tile .k{font-size:.72rem;color:#667385;font-weight:700}
.tcs-tile .v{font-size:1.35rem;font-weight:800;color:#0f2347;margin-top:2px;font-variant-numeric:tabular-nums}
.tcs-tile .s{font-size:.7rem;color:#8a94a6;margin-top:2px}
.tcs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.tcs-card{border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;padding:12px}
.tcs-card h4{margin:0 0 8px;font-size:.88rem}
.tcs-row{display:grid;grid-template-columns:minmax(64px,110px) 1fr auto;gap:8px;align-items:center;font-size:.78rem;margin:4px 0}
.tcs-row .lab{color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tcs-row .trk{height:10px;background:#eef2f7;border-radius:4px;overflow:hidden}
.tcs-row .trk i{display:block;height:100%;background:#2f5597;border-radius:0 4px 4px 0}
.tcs-row b{font-variant-numeric:tabular-nums;color:#1f2937;min-width:2.5em;text-align:right}
.tcs-cols{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid #cbd5e1;padding-top:6px}
.tcs-cols span{flex:1;min-width:2px;background:#2f5597;border-radius:3px 3px 0 0;position:relative}
.tcs-cols span:hover{background:#1d3a6e}
.tcs-axis{display:flex;justify-content:space-between;font-size:.68rem;color:#8a94a6;margin-top:3px}
/* 상담원 창(왼쪽 아래) */
#tgtChatAgent{position:fixed;left:20px;bottom:calc(20px + env(safe-area-inset-bottom));width:400px;max-width:calc(100vw - 24px);height:min(640px,calc(100dvh - 40px));z-index:230;display:none;flex-direction:column;background:#fff;color:#1b2536;border-radius:16px;box-shadow:0 18px 50px rgba(3,13,38,.38);overflow:hidden;font-family:'Pretendard','Noto Sans KR',-apple-system,sans-serif;font-size:14px}
#tgtChatAgent.open{display:flex}
#tgtChatAgent *{box-sizing:border-box}
.tcf-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;background:linear-gradient(135deg,#030D26,#0f2347);color:#fff}
.tcf-head .t{flex:1;min-width:0}
.tcf-head .t b{display:block;font-size:.95rem}
.tcf-head .t span{font-size:.74rem;opacity:.9}
.tcf-head button{flex:none;height:32px;min-width:32px;padding:0 9px;border-radius:999px;border:none;background:rgba(255,255,255,.14);color:#fff;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit}
.tcf-head button:hover{background:rgba(255,255,255,.26)}
.tcf-body{flex:1;min-height:0;display:flex;flex-direction:column}
.tcf-body .tca-list{border:none;border-radius:0;max-height:none;flex:1}
.tcf-body .tca-th{border:none;border-radius:0;flex:1;min-height:0}
.tcf-body .tca-msgs{max-height:none;min-height:0}
.tcf-tools{flex:none;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:8px 12px;border-top:1px solid #e3e8f0;background:#f8fafc;font-size:.74rem}
.tcf-tools label{display:inline-flex;align-items:center;gap:5px;font-weight:700;cursor:pointer}
@media(max-width:560px){ #tgtChatAgent{left:0;right:0;bottom:0;width:100%;max-width:100%;height:92dvh;border-radius:16px 16px 0 0} }`;
  let styled = false;
  function style(){ if (styled) return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

  // ── 화면 공통: 목록 · 대화 ────────────────────────────────────
  function statusCls(s){ return s.status==='대기' ? 'wait' : (s.status==='상담중' ? 'go' : 'end'); }
  function assignChip(s){
    if (!S.v2 || !s.assigned_to) return '';
    const mine = s.assigned_to === S.uid;
    return `<span class="tca-chip ${mine?'me':'other'}" title="담당 상담원">👤 ${esc(mine ? '내 담당' : (s.assigned_name || '다른 상담원'))}</span>`;
  }
  function listHTML(){
    if (!S.sessions.length) return `<div class="tca-empty">${S.loadedList ? '아직 들어온 상담이 없어요.' : '불러오는 중...'}</div>`;
    return S.sessions.map(s=>{
      const meta = [s.gender, region(s)].filter(Boolean).join(' · ');
      return `<button type="button" class="tca-item${s.id===S.sel?' on':''}" data-act="sel" data-id="${esc(s.id)}">
        <div class="r1"><span>${esc(maskName(s.name))}</span><span class="tca-chip ${statusCls(s)}">${esc(s.status)}</span>${s.unread_admin>0 && s.status!=='종료' ? `<span class="tca-dot">${s.unread_admin>9?'9+':s.unread_admin}</span>` : ''}</div>
        <div class="r2"><span>${esc(maskPhone(s.phone))}</span><span>${when(s.last_message_at)}</span></div>
        ${(meta || waitChip(s) || assignChip(s)) ? `<div class="r3">${waitChip(s)}${assignChip(s)}${meta ? `<span>${esc(meta)}</span>` : ''}</div>` : ''}
      </button>`;
    }).join('');
  }
  function threadHTML(compact){
    const s = S.sessions.find(x=>x.id===S.sel);
    if (!s) return `<div class="tca-empty">${compact ? '' : '왼쪽에서 상담을 선택하세요.'}</div>`;
    let assign = '';
    if (S.v2){
      const mine = s.assigned_to && s.assigned_to === S.uid;
      assign = `<div class="tca-assign">${s.assigned_to ? `담당: <b>${esc(mine ? (S.myName ? S.myName + ' (나)' : '나') : (s.assigned_name || '다른 상담원'))}</b>` : '<span class="tca-hint">담당 상담원 없음 — 답변하면 자동으로 내 담당이 됩니다</span>'}
        ${mine ? '<button type="button" class="tca-mini" data-act="release">담당 해제</button>' : `<button type="button" class="tca-mini pri" data-act="take">${s.assigned_to ? '담당 가져오기' : '내가 맡기'}</button>`}
        ${waitChip(s)}${s.first_response_at ? `<span class="tca-hint">첫 답변 ${Math.max(0, Math.round((new Date(s.first_response_at) - new Date(s.created_at))/60000))}분</span>` : ''}</div>`;
    }
    // 채팅창 맨 위: 고객이 상담 시작 때 입력한 정보(이름·연락처는 기본으로 일부 가리고, 👁로 잠깐 펼쳐 볼 수 있음)
    const open = !!S.reveal[s.id];
    const cell = (k, v, extra) => `<div class="c"><span>${k}</span><b${v ? '' : ' class="none"'}>${v ? (extra || esc(v)) : '미확인'}</b></div>`;
    const ph = open ? s.phone : maskPhone(s.phone);
    const cust = `<div class="tca-cust">${cell('고객명', open ? s.name : maskName(s.name))}${cell('연락처', ph, `<a href="tel:${esc(String(s.phone).replace(/[^0-9+]/g,''))}" title="전화 걸기">📞 ${esc(ph)}</a>`)}${cell('성별', s.gender)}${cell('출발지역', region(s))}
      <button type="button" class="tca-reveal" data-act="reveal" title="이름·연락처 전체 보기/가리기">${open ? '🙈 가리기' : '👁 전체 보기'}</button></div>`;
    const tab = compact ? 'chat' : S.threadTab;
    const tabs = compact ? '' : `<div class="tca-ttabs"><button type="button" data-act="ttab" data-t="chat" class="${tab==='chat'?'on':''}">💬 대화</button><button type="button" data-act="ttab" data-t="rec" class="${tab==='rec'?'on':''}">📝 상담 기록 · 메모${s.crm_consultation_id ? ` <em>#${esc(s.crm_consultation_id)} 저장됨</em>` : ''}</button></div>`;
    const head = `<div class="tca-th-h"><button type="button" class="tca-back tca-mini" data-act="back"${compact?' style="display:inline-block"':''}>‹ 목록</button><span class="tca-chip ${statusCls(s)}">${esc(s.status)}</span>
      <div class="tca-btns">${compact ? `<button type="button" data-act="panel">패널에서 보기</button>` : ''}<button type="button" data-act="close">${s.status==='종료'?'종료됨':'상담 종료'}</button>${compact ? '' : '<button type="button" data-act="del" class="danger">삭제</button>'}</div>
      ${cust}${assign}${tabs}</div>`;
    if (tab === 'rec'){
      // 📝 상담 기록 · 메모 — 간단 메모(고객 정보 목록·엑셀에 표시) + 상담·예약의 빠른 기록 항목(그룹별)
      const memo = S.v2 ? `<section class="tca-memo-card"><div class="h">🗒 상담원 메모 <span class="tca-hint">고객에게 보이지 않음 · 👥 고객 정보 목록과 엑셀에 함께 표시</span></div>
        <div class="tca-memo"><textarea data-memo="${esc(s.id)}" maxlength="2000" placeholder="간단 메모 (예: 10월 일본 · 부부 · 재문의 예정)">${esc(s.memo||'')}</textarea><button type="button" class="tca-mini" data-act="memo" data-id="${esc(s.id)}">메모 저장</button></div></section>` : '';
      return `${head}<div class="tca-rec">${memo}<div class="tca-rec-host" data-crm-host="${esc(s.id)}"><div class="tca-empty">상담 기록 양식을 불러오는 중...</div></div>
        <div class="tca-meta" style="margin-top:10px">시작 ${esc(fullTime(s.created_at))} · 방문 페이지 ${esc(s.page||'-')}<br>개인정보 수집·이용 동의 ${esc(fullTime(s.consent_at))} (${esc(s.consent_version||'-')}) · 선택 동의(소식 안내) ${s.marketing_opt_in?'동의':'미동의'}</div></div>`;
    }
    const msgs = S.msgs.map(m=>{
      const k = m.sender==='visitor' ? 'v' : (m.sender==='admin' ? 'a' : 's');
      const who = m.sender==='admin' ? (m.agent_name ? `상담원 ${m.agent_name}` : '상담원') : '고객';
      return `<div class="tca-m ${k}"><div class="bub">${esc(m.body)}</div>${m.sender!=='system' ? `<div class="t">${esc(who)} ${hhmm(m.created_at)}</div>` : ''}</div>`;
    }).join('');
    return `${head}<div class="tca-msgs">${msgs}</div>
      <div class="tca-rep"><textarea rows="2" maxlength="2000" data-reply="1" placeholder="답변을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"></textarea><button type="button" data-act="send">보내기</button></div>`;
  }
  // 상담 기록 양식(admin-crm.js)을 채팅창 안에 띄운다 — 이미 띄운 양식은 다시 그릴 때 그대로 옮겨 붙여 입력 중인 내용·커서를 지킨다
  function mountRec(container){
    const host = container && container.querySelector('[data-crm-host]'); if (!host || host.dataset.mounted === host.dataset.crmHost) return;
    const s = S.sessions.find(x=>x.id===host.dataset.crmHost); if (!s) return;
    const visitor = S.sel === s.id ? S.msgs.filter(m=>m.sender==='visitor').map(m=>m.body).filter(b=>!/^\[고객 정보\]/.test(b)) : [];
    const payload = {id:s.id, name:s.name, phone:s.phone, created_at:s.created_at, gender:s.gender||'', region:region(s), memo:s.memo||'', crm_id:s.crm_consultation_id||null,
      visitor_text: visitor.join(', ').slice(0, 2000),
      onSaved: saved=>{ [S.sessions, S.cust.rows].forEach(l=>{ const r = l.find(x=>x.id===s.id); if (r) r.crm_consultation_id = saved.id; }); S._sig = ''; renderAll(); }};
    host.dataset.mounted = host.dataset.crmHost;
    const load = (typeof tgtEnsureCrm === 'function') ? tgtEnsureCrm() : Promise.reject(new Error('no crm'));
    load.then(()=>{ if (host.isConnected) window.TGT_CRM.mountChat(host, payload); })
      .catch(()=>{ host.dataset.mounted = ''; host.innerHTML = '<div class="tca-warn">상담 기록 양식을 불러오지 못했어요. 새로고침 후 다시 열어 주세요.</div>'; });
  }

  // 다시 그려도 입력 중인 답변·메모가 지워지지 않게
  function preserve(container, paint){
    const keep = {}; let focus = null, caret = null;
    container.querySelectorAll('textarea[data-reply],textarea[data-memo],input[data-cmemo],input[type=search]').forEach(t=>{
      const k = t.dataset.reply ? 'r' : (t.dataset.memo ? 'm' + t.dataset.memo : (t.dataset.cmemo ? 'c' + t.dataset.cmemo : 'q'));
      keep[k] = {v:t.value, dirty:t.dataset.dirty === '1'};
      if (document.activeElement === t){ focus = k; try{ caret = [t.selectionStart, t.selectionEnd]; }catch(e){} }
    });
    const box = container.querySelector('.tca-msgs'), atBottom = !box || (box.scrollHeight - box.scrollTop - box.clientHeight < 40), top = box ? box.scrollTop : 0;
    const scrolls = ['.tca-list', '.tcc-tbl-wrap'].map(q=>{ const x = container.querySelector(q); return x ? [q, x.scrollTop, x.scrollLeft] : null; }).filter(Boolean);
    const pinBox = container.querySelector('#tcaPinBox');
    const recHost = container.querySelector('[data-crm-host][data-mounted]'), recFocus = recHost && recHost.contains(document.activeElement) ? document.activeElement : null;
    let recCaret = null; try{ if (recFocus && 'selectionStart' in recFocus) recCaret = [recFocus.selectionStart, recFocus.selectionEnd]; }catch(e){}
    const recScroll = recHost ? recHost.closest('.tca-rec') : null, recTop = recScroll ? recScroll.scrollTop : 0;
    paint();
    const nRec = container.querySelector('[data-crm-host]');
    if (recHost && nRec && nRec.dataset.crmHost === recHost.dataset.crmHost){
      nRec.replaceWith(recHost);
      const sc = recHost.closest('.tca-rec'); if (sc) sc.scrollTop = recTop;
      if (recFocus && recHost.contains(recFocus)){ recFocus.focus({preventScroll:true}); if (recCaret) try{ recFocus.setSelectionRange(recCaret[0], recCaret[1]); }catch(e){} }
    }
    mountRec(container);
    scrolls.forEach(([q, t, l])=>{ const x = container.querySelector(q); if (x){ x.scrollTop = t; x.scrollLeft = l; } });
    const nPin = container.querySelector('#tcaPinBox'); if (pinBox && nPin && pinBox.dataset.done) nPin.replaceWith(pinBox);   // 2중 비밀번호 입력 중인 내용 유지
    container.querySelectorAll('textarea[data-reply],textarea[data-memo],input[data-cmemo],input[type=search]').forEach(t=>{
      const k = t.dataset.reply ? 'r' : (t.dataset.memo ? 'm' + t.dataset.memo : (t.dataset.cmemo ? 'c' + t.dataset.cmemo : 'q'));
      const v = keep[k];
      if (v && (k === 'r' || v.dirty)){ t.value = v.v; if (v.dirty){ t.dataset.dirty = '1'; const b = t.parentElement && t.parentElement.querySelector('button'); if (b) b.classList.add('dirty'); } }
      if (focus === k){ t.focus({preventScroll:true}); if (caret) try{ t.setSelectionRange(caret[0], caret[1]); }catch(e){} }
    });
    const nb = container.querySelector('.tca-msgs'); if (nb) nb.scrollTop = atBottom ? nb.scrollHeight : top;
  }

  // ── 패널 탭 화면 ───────────────────────────────────────────
  function render(root){
    if (root) S.root = root;
    root = S.root; if (!root) return;
    style(); wire(root);
    if (!authed()){ root.innerHTML = '<div class="tca-empty">관리자 로그인 후 이용할 수 있어요.</div>'; return; }
    preserve(root, ()=>{ root.innerHTML = panelHTML(); });
  }
  function panelHTML(){
    const tabs = [['chat', `💬 상담${S.waiting ? ` (${S.waiting})` : ''}`], ['cust','👥 고객 정보'], ['stats','📈 통계'], ['set','⚙️ 설정']]
      .map(([k, l])=>`<button type="button" data-act="view" data-v="${k}" class="${S.view===k?'on':''}">${l}</button>`).join('');
    let body = '';
    if (S.missing){
      body = '<div class="tca-warn">실시간 상담 데이터베이스가 아직 준비되지 않았어요.<br>Supabase → <b>SQL Editor</b>에서 <code>docs/sql/2026-10-28_live_chat.sql</code>과 <code>docs/sql/2026-10-29_live_chat_v2.sql</code>을 차례로 실행해 주세요. (자세한 순서: <code>docs/live-chat-setup.md</code>)</div>';
    } else {
      const v2warn = S.v2 === false ? '<div class="tca-warn">고객 정보(성별·출발지역)·메모·담당 상담원·대기 시간·통계·2중 비밀번호를 쓰려면 Supabase SQL Editor에서 <code>docs/sql/2026-10-29_live_chat_v2.sql</code>을 실행해 주세요. 그 전에도 상담·답변은 그대로 됩니다.</div>' : '';
      const err = S.error ? `<div class="tca-warn">불러오기 실패: ${esc(S.error)}</div>` : '';
      if (S.view === 'chat') body = v2warn + err + barHTML() + `<div class="tca-wrap${S.sel ? ' thread' : ''}"><div class="tca-list">${listHTML()}</div><div class="tca-th">${threadHTML(false)}</div></div>`;
      else if (S.view === 'cust') body = v2warn + custHTML();
      else if (S.view === 'stats') body = v2warn + statsHTML();
      else body = v2warn + settingsHTML();
    }
    return `<div class="tca"><div class="tca-tabs">${tabs}</div>${body}</div>`;
  }
  function pushLabel(){
    const st = pushState();
    if (st === 'unsupported') return '<span class="tca-hint">이 브라우저는 바탕화면 알림을 지원하지 않아요</span>';
    if (st === 'denied') return '<span class="tca-hint">바탕화면 알림이 브라우저에서 차단되어 있어요(주소창 왼쪽 자물쇠 → 알림 허용)</span>';
    return '';
  }
  function barHTML(){
    return `<div class="tca-bar"><label class="tca-sw"><input type="checkbox" data-act="avail" ${S.avail?'checked':''}> 상담 대기 중</label>
      <span class="tca-hint">켜 두면 고객 화면에 "상담원 온라인"이 표시됩니다(이 화면이 열려 있는 동안).</span>
      <label class="tca-sw"><input type="checkbox" data-act="sound" ${S.sound?'checked':''}> 🔔 알림음 (볼륨 70%)</label>
      <label class="tca-sw"><input type="checkbox" data-act="push" ${S.push && pushState()==='granted'?'checked':''}> 🖥 바탕화면(푸시) 알림</label>
      <button type="button" class="tca-mini" data-act="test">🔊 소리 들어보기</button>${pushLabel()}
      <span class="tca-hint tca-soundhint" ${S.soundBlocked?'':'hidden'}>브라우저가 소리를 막고 있어요. 화면을 한 번 누르면 알림음이 울립니다.</span></div>`;
  }

  // ── 고객 정보(마스킹 목록 · 메모 · 내보내기) ─────────────────────
  const SIDO = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','제주특별자치도','경기도','강원도','충청북도','충청남도','전라북도','전라남도','경상북도','경상남도'];
  function since(days){ return days === 'all' ? null : new Date(Date.now() - Number(days) * 86400000).toISOString(); }
  async function loadCustomers(){
    const C = S.cust; if (C.loading) return;
    C.loading = true; C.error = ''; renderAll();
    const from = since(C.period);
    const { data, error } = await selectSessions(q=>{ q = q.order('created_at', {ascending:false}).limit(3000); return from ? q.gte('created_at', from) : q; });
    C.loading = false;
    if (error){ C.error = errText(error); C.rows = []; } else { C.rows = data || []; C.loaded = true; }
    renderAll();
  }
  function custFiltered(){
    const C = S.cust, q = C.q.trim().toLowerCase(), qd = q.replace(/\D/g,'');
    return C.rows.filter(r=>{
      if (C.status && r.status !== C.status) return false;
      if (C.gender && r.gender !== C.gender) return false;
      if (C.sido && r.region_sido !== C.sido) return false;
      if (q){
        const hay = [r.name, r.memo, region(r), r.assigned_name].join(' ').toLowerCase();
        if (!hay.includes(q) && !(qd.length >= 4 && String(r.phone||'').replace(/\D/g,'').includes(qd))) return false;
      }
      return true;
    });
  }
  function custHTML(){
    const C = S.cust;
    if (!C.loaded && !C.loading){ setTimeout(loadCustomers, 0); }
    const rows = custFiltered();
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur)===String(v)?'selected':''}>${esc(l)}</option>`;
    const filters = `<div class="tcc-filters">
      <select data-cf="period">${[['7','최근 7일'],['30','최근 30일'],['90','최근 90일'],['365','최근 1년'],['all','전체 기간']].map(([v,l])=>opt(v,l,C.period)).join('')}</select>
      <select data-cf="status">${opt('','전체 상태',C.status)}${['대기','상담중','종료'].map(x=>opt(x,x,C.status)).join('')}</select>
      <select data-cf="gender">${opt('','성별 전체',C.gender)}${opt('남','남',C.gender)}${opt('여','여',C.gender)}</select>
      <select data-cf="sido">${opt('','출발지역 전체',C.sido)}${SIDO.map(x=>opt(x,x,C.sido)).join('')}</select>
      <input type="search" data-cf="q" value="${esc(C.q)}" placeholder="이름·연락처(4자리 이상)·메모 검색">
      <button type="button" class="tca-mini" data-act="creload">새로 고침</button></div>`;
    const acts = `<div class="tcc-acts"><b>${rows.length}명</b><span class="tca-hint">(목록의 이름·연락처는 개인정보 보호를 위해 일부 가려서 표시합니다)</span>
      <span style="flex:1"></span>
      <label class="tca-sw" style="font-size:.78rem"><input type="checkbox" data-act="cmsgs" ${C.withMsgs?'checked':''}> 대화 내용 포함</label>
      <button type="button" class="tca-mini pri" data-act="xlsx">📊 엑셀(.xlsx) 내보내기</button><button type="button" class="tca-mini" data-act="csv">⬇ CSV 내려받기</button></div>`;
    let table;
    if (C.loading && !C.loaded) table = '<div class="tca-empty">불러오는 중...</div>';
    else if (C.error) table = `<div class="tca-warn">불러오기 실패: ${esc(C.error)}</div>`;
    else if (!rows.length) table = '<div class="tca-empty">조건에 맞는 고객이 없어요.</div>';
    else table = `<div class="tcc-tbl-wrap"><table class="tcc-tbl"><thead><tr><th>상담 시작</th><th>이름</th><th>연락처</th><th>성별</th><th>출발지역</th><th>상태</th><th>담당</th><th>메모</th><th></th></tr></thead><tbody>${
      rows.slice(0, 500).map(r=>`<tr><td>${esc(when(r.created_at))}</td><td>${esc(maskName(r.name))}</td><td>${esc(maskPhone(r.phone))}</td><td>${esc(r.gender||'미확인')}</td><td>${esc(region(r)||'미확인')}</td>
        <td><span class="tca-chip ${statusCls(r)}">${esc(r.status)}</span></td><td>${esc(r.assigned_name||'-')}</td>
        <td>${S.v2 ? `<div class="memo"><input data-cmemo="${esc(r.id)}" maxlength="2000" value="${esc(r.memo||'')}" placeholder="간단 메모"><button type="button" data-act="cmemo" data-id="${esc(r.id)}">저장</button></div>` : '-'}</td>
        <td><button type="button" class="tca-mini" data-act="copen" data-id="${esc(r.id)}">대화</button></td></tr>`).join('')}</tbody></table></div>${rows.length > 500 ? '<div class="tcc-note">화면에는 최근 500명까지 표시합니다. 내보내기 파일에는 조건에 맞는 전체가 담깁니다.</div>' : ''}`;
    return `${filters}${acts}${table}
      <div class="tcc-note">내보내기 파일에는 가리지 않은 이름·연락처가 담기므로 2중 관리자 비밀번호를 한 번 더 확인합니다. 내려받은 파일은 상담 목적에만 쓰고, 사용 후 삭제하거나 암호를 걸어 보관하세요. 보유 기간(상담 종료 후 1년)이 지난 상담은 💬 상담에서 삭제하세요.</div>`;
  }
  async function saveMemo(id, value, btn){
    const c = client(); if (!c) return;
    if (btn) btn.disabled = true;
    const v = String(value||'').trim().slice(0, 2000) || null;
    const { error } = await c.from('tgt_chat_sessions').update({memo:v}).eq('id', id);
    if (btn) btn.disabled = false;
    if (error){ alert('메모를 저장하지 못했어요: ' + errText(error)); return false; }
    [S.sessions, S.cust.rows].forEach(list=>{ const r = list.find(x=>x.id===id); if (r) r.memo = v; });
    return true;
  }
  function loadPin(){ return (typeof tgtLoadPin === 'function') ? tgtLoadPin() : Promise.reject(new Error('no pin loader')); }
  function stamp(){ const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
  async function fetchMsgs(ids){
    const out = {}; const c = client();
    for (let i = 0; i < ids.length; i += 80){
      const { data, error } = await c.from('tgt_chat_messages').select('session_id,created_at,sender,body').in('session_id', ids.slice(i, i+80)).order('id', {ascending:true}).limit(20000);
      if (error) throw error;
      (data||[]).forEach(m=>{ (out[m.session_id] = out[m.session_id] || []).push(m); });
    }
    return out;
  }
  const EXPORT_HEAD = ['번호','상담 시작','이름','연락처','성별','출발지역(시/도)','출발지역(시/군/구)','상태','담당 상담원','첫 답변까지(분)','마지막 메시지','상담 종료','메모','소식 수신 동의','동의 버전','CRM 상담번호','방문 페이지'];
  function exportRow(r, i){
    const fr = r.first_response_at ? Math.max(0, Math.round((new Date(r.first_response_at) - new Date(r.created_at))/60000)) : '';
    return [i+1, fullTime(r.created_at), r.name, r.phone, r.gender||'', r.region_sido||'', r.region_sigungu||'', r.status, r.assigned_name||'', fr,
      fullTime(r.last_message_at), fullTime(r.closed_at), r.memo||'', r.marketing_opt_in ? '동의' : '미동의', r.consent_version||'', r.crm_consultation_id||'', r.page||''];
  }
  async function doExport(kind){
    const rows = custFiltered();
    if (!rows.length){ alert('내보낼 고객이 없어요.'); return; }
    try{ await loadPin(); }catch(e){ alert('2중 비밀번호 확인 기능을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.'); return; }
    const ok = await window.TGT_PIN.require('export_' + kind, '개인정보 내보내기', {desc:`고객 ${rows.length}명의 이름·연락처(가리지 않은 원본)가 담긴 ${kind==='xlsx'?'엑셀':'CSV'} 파일을 내려받습니다. 2중 관리자 비밀번호(숫자 4자리)를 입력하세요.`});
    if (!ok) return;
    let msgs = null;
    if (S.cust.withMsgs){ try{ msgs = await fetchMsgs(rows.map(r=>r.id)); }catch(e){ alert('대화 내용을 불러오지 못했어요: ' + errText(e)); return; } }
    const base = `실시간상담_고객정보_${stamp()}`;
    const who = m => m.sender==='visitor' ? '고객' : (m.sender==='admin' ? '상담원' : '안내');
    if (kind === 'csv'){
      const head = EXPORT_HEAD.concat(msgs ? ['대화 내용'] : []);
      const lines = [head].concat(rows.map((r, i)=>{
        const a = exportRow(r, i);
        if (msgs) a.push((msgs[r.id]||[]).map(m=>`[${hhmm(m.created_at)} ${who(m)}] ${m.body}`).join('\n'));
        return a;
      }));
      const csv = lines.map(a=>a.map(v=>{ let s = String(v==null?'':v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }).join(',')).join('\r\n');
      download(new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8'}), base + '.csv');
      return;
    }
    try{ await loadXlsx(); }catch(e){ alert('엑셀 모듈을 불러오지 못했어요. CSV로 내려받아 주세요.'); return; }
    const X = window.XLSX, wb = X.utils.book_new();
    const ws = X.utils.aoa_to_sheet([EXPORT_HEAD].concat(rows.map(exportRow)));
    ws['!cols'] = [6,18,10,15,6,14,12,8,12,10,18,18,30,10,16,10,24].map(w=>({wch:w}));
    X.utils.book_append_sheet(wb, ws, '고객 정보');
    if (msgs){
      const aoa = [['이름','연락처','시각','보낸 사람','내용']];
      rows.forEach(r=>(msgs[r.id]||[]).forEach(m=>aoa.push([r.name, r.phone, fullTime(m.created_at), m.sender==='admin' && m.agent_name ? `상담원 ${m.agent_name}` : who(m), m.body])));
      const ws2 = X.utils.aoa_to_sheet(aoa); ws2['!cols'] = [10,15,18,12,80].map(w=>({wch:w}));
      X.utils.book_append_sheet(wb, ws2, '대화 내용');
    }
    X.writeFile(wb, base + '.xlsx');
  }
  let _xlsx = null;
  function loadXlsx(){
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!_xlsx) _xlsx = new Promise((res, rej)=>{ const sc = document.createElement('script'); sc.src = 'assets/vendor/xlsx-0.18.5.full.min.js'; sc.onload = ()=>res(window.XLSX); sc.onerror = ()=>{ _xlsx = null; rej(new Error('xlsx')); }; document.head.appendChild(sc); });
    return _xlsx;
  }
  function download(blob, name){
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ── 통계 ───────────────────────────────────────────────────
  // 등록된 대화에서 규칙으로만 센다(추정·생성 없음). 데이터가 없으면 "미확인"
  const TOPICS = [
    ['견적·가격', /견적|가격|금액|요금|얼마|비용|할인|특가|만원/],
    ['일정·출발일', /일정|날짜|출발|언제|\d+\s*월|주말|평일|박\s*\d|\d\s*박/],
    ['인원·조인', /인원|\d+\s*명|조인|\d+\s*팀|혼자|1인|부부|단체/],
    ['골프장·코스', /골프장|코스|라운드|티업|티타임|그린피|캐디|카트/],
    ['항공·숙박', /항공|비행기|호텔|숙소|숙박|리조트|객실|룸/],
    ['예약·결제', /예약|결제|입금|계좌|카드|잔금|계약/],
    ['취소·변경·환불', /취소|환불|변경|위약/],
    ['국내 여행지', /제주|강원|경기|충청|전라|경상|부산|국내|남해|경주/],
    ['해외 여행지', /일본|태국|베트남|필리핀|중국|대만|말레이|괌|사이판|해외|다낭|나트랑|치앙마이|후쿠오카|오키나와|하이난|라오스|캄보디아|인도네시아|발리/],
  ];
  function kst(t){ const d = new Date(new Date(t).getTime() + 9*3600000); return {y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), h:d.getUTCHours(), wd:d.getUTCDay()}; }
  function offHours(t){ const k = kst(t); return !(k.wd >= 1 && k.wd <= 5 && k.h >= 9 && k.h < 18); }
  async function loadStats(){
    const T = S.stats; if (T.loading) return;
    T.loading = true; T.error = ''; renderAll();
    try{
      const from = since(T.period);
      const { data, error } = await selectSessions(q=>{ q = q.order('created_at', {ascending:true}).limit(5000); return from ? q.gte('created_at', from) : q; });
      if (error) throw error;
      let mq = client().from('tgt_chat_messages').select('session_id,body').eq('sender','visitor').order('id', {ascending:false}).limit(8000);
      if (from) mq = mq.gte('created_at', from);
      const mr = await mq;
      T.data = {sessions: data || [], msgs: mr.error ? null : (mr.data || []), at: Date.now()};
    }catch(e){ T.error = errText(e); }
    T.loading = false; renderAll();
  }
  function bars(pairs, unit){
    const max = Math.max(1, ...pairs.map(p=>p[1]));
    if (!pairs.length) return '<div class="tca-hint">미확인</div>';
    return pairs.map(([k, v, note])=>`<div class="tcs-row" title="${esc(k)}: ${v}${unit||'건'}${note?` (${esc(note)})`:''}"><span class="lab">${esc(k)}</span><span class="trk"><i style="width:${(v/max*100).toFixed(1)}%"></i></span><b>${v}${note?` <small style="font-weight:600;color:#667385">${esc(note)}</small>`:''}</b></div>`).join('');
  }
  function fmtMin(m){ if (m == null || !isFinite(m)) return '미확인'; if (m < 1) return '1분 미만'; if (m < 60) return Math.round(m) + '분'; return (m/60).toFixed(1) + '시간'; }
  function statsHTML(){
    const T = S.stats;
    if (!T.data && !T.loading && !T.error) setTimeout(loadStats, 0);
    const per = `<div class="tcc-filters"><select data-sf="period">${[['7','최근 7일'],['30','최근 30일'],['90','최근 90일'],['365','최근 1년']].map(([v,l])=>`<option value="${v}" ${T.period===v?'selected':''}>${l}</option>`).join('')}</select><button type="button" class="tca-mini" data-act="sreload">새로 고침</button>${T.data ? `<span class="tca-hint">기준 ${esc(new Date(T.data.at).toLocaleString('ko-KR'))}</span>` : ''}</div>`;
    if (T.error) return per + `<div class="tca-warn">통계를 불러오지 못했어요: ${esc(T.error)}</div>`;
    if (!T.data) return per + '<div class="tca-empty">불러오는 중...</div>';
    const ss = T.data.sessions, n = ss.length;
    if (!n) return per + '<div class="tca-empty">이 기간에 들어온 상담이 없어요.</div>';
    const answered = ss.filter(s=>s.first_response_at);
    const frs = answered.map(s=>(new Date(s.first_response_at) - new Date(s.created_at))/60000).filter(x=>x >= 0).sort((a,b)=>a-b);
    const avg = frs.length ? frs.reduce((a,b)=>a+b,0)/frs.length : null, med = frs.length ? frs[Math.floor(frs.length/2)] : null;
    const in5 = frs.length ? Math.round(frs.filter(x=>x <= 5).length / frs.length * 100) : null;
    const closed = ss.filter(s=>s.status==='종료').length, off = ss.filter(s=>offHours(s.created_at)).length;
    const waitNow = S.sessions.filter(s=>s.status!=='종료' && (S.v2 ? s.waiting_since : s.status==='대기')).length;
    const pct = (a, b) => b ? Math.round(a/b*100) + '%' : '미확인';
    const tiles = [
      ['상담 수', n + '건', `하루 평균 ${(()=>{ const r = n / Math.max(1, Number(T.period)); return r < 1 ? r.toFixed(2) : r.toFixed(1); })()}건`],
      ['답변한 상담', S.v2 ? pct(answered.length, n) : '미확인', S.v2 ? `${answered.length}건` : '2단계 SQL 필요'],
      ['첫 답변 시간(중앙값)', S.v2 ? fmtMin(med) : '미확인', S.v2 && avg != null ? `평균 ${fmtMin(avg)}` : ''],
      ['5분 안에 첫 답변', S.v2 && in5 != null ? in5 + '%' : '미확인', ''],
      ['종료율', pct(closed, n), `${closed}건 종료`],
      ['운영시간 외 접수', pct(off, n), '평일 09–18시 외'],
      ['지금 대기 중', waitNow + '건', '답변 전 상담'],
    ].map(([k, v, s])=>`<div class="tcs-tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s?`<div class="s">${esc(s)}</div>`:''}</div>`).join('');
    // 날짜별(1년은 월별)
    const byMonth = T.period === '365', counts = new Map();
    const days = byMonth ? 12 : Number(T.period);
    const keys = [];
    for (let i = days - 1; i >= 0; i--){
      const d = new Date(Date.now() + 9*3600000);
      if (byMonth){ d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); keys.push(`${d.getUTCFullYear()}.${d.getUTCMonth()+1}`); }
      else { d.setUTCDate(d.getUTCDate() - i); keys.push(`${d.getUTCMonth()+1}/${d.getUTCDate()}`); }
    }
    keys.forEach(k=>counts.set(k, 0));
    ss.forEach(s=>{ const k0 = kst(s.created_at), k = byMonth ? `${k0.y}.${k0.m}` : `${k0.m}/${k0.d}`; if (counts.has(k)) counts.set(k, counts.get(k) + 1); });
    const cmax = Math.max(1, ...counts.values());
    const cols = `<div class="tcs-cols">${keys.map(k=>`<span style="height:${Math.max(counts.get(k) ? 3 : 0, counts.get(k)/cmax*100)}%" title="${esc(k)} · ${counts.get(k)}건"></span>`).join('')}</div><div class="tcs-axis"><span>${esc(keys[0])}</span><span>최대 ${cmax}건</span><span>${esc(keys[keys.length-1])}</span></div>`;
    const hours = Array.from({length:24}, ()=>0); ss.forEach(s=>{ hours[kst(s.created_at).h]++; });
    const hmax = Math.max(1, ...hours);
    const hcols = `<div class="tcs-cols">${hours.map((v,h)=>`<span style="height:${Math.max(v ? 3 : 0, v/hmax*100)}%" title="${h}시 · ${v}건"></span>`).join('')}</div><div class="tcs-axis"><span>0시</span><span>12시</span><span>23시</span></div>`;
    const group = (fn) => { const m = new Map(); ss.forEach(s=>{ const k = fn(s) || '미확인'; m.set(k, (m.get(k)||0) + 1); }); return [...m.entries()].sort((a,b)=>b[1]-a[1]); };
    const gender = S.v2 ? group(s=>s.gender) : [];
    const sido = S.v2 ? group(s=>s.region_sido).slice(0, 10) : [];
    const sgg = S.v2 ? group(s=>region(s) && s.region_sigungu ? region(s) : '').filter(x=>x[0] !== '미확인').slice(0, 10) : [];
    const status = group(s=>s.status);
    let agents = [];
    if (S.v2){
      const m = new Map();
      ss.forEach(s=>{ if (!s.assigned_name) return; const a = m.get(s.assigned_name) || {n:0, fr:[], closed:0}; a.n++; if (s.status==='종료') a.closed++; if (s.first_response_at) a.fr.push((new Date(s.first_response_at)-new Date(s.created_at))/60000); m.set(s.assigned_name, a); });
      agents = [...m.entries()].sort((a,b)=>b[1].n-a[1].n).map(([k,a])=>[k, a.n, `종료 ${a.closed} · 첫 답변 평균 ${fmtMin(a.fr.length ? a.fr.reduce((x,y)=>x+y,0)/a.fr.length : null)}`]);
    }
    let topics = '<div class="tca-hint">미확인</div>';
    if (T.data.msgs){
      const bySess = new Map(); T.data.msgs.forEach(m=>{ if (/^\[고객 정보\]/.test(m.body)) return; bySess.set(m.session_id, (bySess.get(m.session_id)||'') + ' ' + m.body); });
      const tc = TOPICS.map(([k, re])=>[k, [...bySess.values()].filter(t=>re.test(t)).length]).filter(x=>x[1] > 0).sort((a,b)=>b[1]-a[1]);
      topics = bars(tc) + `<div class="tcc-note">고객이 보낸 메시지에 해당 낱말이 나온 상담 수(한 상담이 여러 주제에 들어갈 수 있음) · 메시지가 있는 상담 ${bySess.size}건 기준</div>`;
    }
    const card = (t, inner) => `<div class="tcs-card"><h4>${t}</h4>${inner}</div>`;
    return per + `<div class="tcs-tiles">${tiles}</div><div class="tcs-grid">
      ${card(byMonth ? '월별 상담 수' : '날짜별 상담 수', cols)}
      ${card('시간대별 접수(한국 시간)', hcols)}
      ${card('문의 주제', topics)}
      ${card('상담 상태', bars(status))}
      ${card('상담원별 담당', S.v2 ? (agents.length ? bars(agents) : '<div class="tca-hint">아직 담당이 지정된 상담이 없어요</div>') : '<div class="tca-hint">미확인 — 2단계 SQL 필요</div>')}
      ${card('성별', S.v2 ? bars(gender) : '<div class="tca-hint">미확인 — 2단계 SQL 필요</div>')}
      ${card('출발지역(시/도) 상위 10', S.v2 ? bars(sido) : '<div class="tca-hint">미확인 — 2단계 SQL 필요</div>')}
      ${card('출발지역(시/군/구) 상위 10', S.v2 ? bars(sgg) : '<div class="tca-hint">미확인 — 2단계 SQL 필요</div>')}
    </div><div class="tcc-note">통계는 Supabase에 저장된 상담·메시지로만 계산합니다(추정값 없음). 성별·출발지역·첫 답변 시간은 2단계 SQL 실행 이후 들어온 상담부터 집계되며, 그 이전 상담은 "미확인"으로 셉니다.</div>`;
  }

  // ── 설정 ───────────────────────────────────────────────────
  function settingsHTML(){
    setTimeout(()=>{ const box = S.root && $('#tcaPinBox', S.root); if (box && !box.dataset.done){ box.dataset.done = '1'; loadPin().then(()=>window.TGT_PIN.manage(box)).catch(()=>{ box.textContent = '2중 비밀번호 기능을 불러오지 못했어요.'; }); } }, 0);
    let hours = '';
    try{
      const h = getChatHours(), WD = [1,2,3,4,5,6,0], KO = ['일','월','화','수','목','금','토'];
      hours = `<div class="tcs-card"><h4>🕘 상담 업무시간 (한국 시간)</h4>
        <div class="tcc-note" style="margin-bottom:8px">업무시간에는 상담 신청서(탑승권)를 접수하면 실시간 상담 창이 바로 열립니다. 업무시간이 아니면 "다음 업무일에 확인 후 상담"을 안내하고, 고객 상담 창·홈페이지 안내 문구(현재: <b>${esc(chatHoursLabel())}</b>)에도 함께 반영됩니다.</div>
        <div class="tcc-filters" data-hours="1">${WD.map(d=>`<label class="tca-sw" style="font-size:.82rem"><input type="checkbox" data-hday="${d}" ${h.days.includes(d)?'checked':''}> ${KO[d]}</label>`).join('')}</div>
        <div class="tcc-filters" style="margin-top:8px"><label class="tca-sw" style="font-size:.82rem">시작 <input type="time" data-hstart="1" value="${esc(h.start)}" step="600" style="padding:6px 8px;border:1px solid #c7cfdc;border-radius:8px;font-family:inherit"></label>
          <label class="tca-sw" style="font-size:.82rem">종료 <input type="time" data-hend="1" value="${esc(h.end)}" step="600" style="padding:6px 8px;border:1px solid #c7cfdc;border-radius:8px;font-family:inherit"></label>
          <button type="button" class="tca-mini pri" data-act="hours">저장</button><span class="tca-hint" data-hmsg="1"></span></div>
        <div class="tcc-note" style="margin-top:6px">지금은 <b>${chatInHours() ? '업무시간' : '업무시간 외'}</b>입니다. 저장하면 모든 방문자 화면에 바로 반영됩니다(관리자 로그인 상태에서 저장).</div></div>`;
    }catch(e){}
    return hours + `<div class="tcs-card"><h4>👤 상담원 표시 이름</h4>
        <div class="tcc-note" style="margin-bottom:8px">여러 상담원이 함께 응대할 때 목록·대화에 표시되는 이름입니다(고객 화면에는 "상담원"으로만 보입니다).</div>
        ${S.v2 ? `<div class="tcc-filters"><input type="search" data-myname="1" maxlength="20" value="${esc(S.myName)}" placeholder="예: 김상담" style="max-width:220px"><button type="button" class="tca-mini pri" data-act="myname">저장</button></div>` : '<div class="tca-hint">2단계 SQL 실행 후 사용할 수 있어요.</div>'}
      </div>
      <div class="tcs-card"><h4>🔔 알림</h4>${barHTML()}
        <div class="tcc-note" style="margin-top:8px">바탕화면(푸시) 알림은 이 사이트가 브라우저 탭에 열려 있는 동안, 다른 탭·프로그램을 보고 있어도 운영체제 알림으로 표시됩니다. 브라우저를 완전히 닫으면 알림을 받을 수 없어요. 아이폰은 사파리 정책상 홈 화면에 추가한 경우에만 지원됩니다.</div></div>
      <div id="tcaPinBox"></div>`;
  }

  // ── 상담원 창(왼쪽 아래 상담 버튼) ───────────────────────────────
  function buildFloat(){
    if (S.floatRoot) return S.floatRoot;
    style();
    const r = el('div'); r.id = 'tgtChatAgent'; r.setAttribute('role','dialog'); r.setAttribute('aria-label','실시간 상담 — 상담원 창');
    document.body.appendChild(r); wire(r); S.floatRoot = r;
    try{ tgtKbFit.attach(r); }catch(e){}   // 안드로이드 가상 키보드가 답변 입력창을 가리지 않게(index.html)
    document.addEventListener('keydown', e=>{ if (e.key==='Escape' && S.floatOpen && !document.querySelector('.tpn-ov')) closeFloat(); });
    return r;
  }
  function renderFloat(){
    const r = S.floatRoot; if (!r || !S.floatOpen) return;
    preserve(r, ()=>{
      const body = S.missing ? '<div class="tca-empty">실시간 상담 DB가 아직 준비되지 않았어요(docs/live-chat-setup.md 참고).</div>'
        : (S.sel ? `<div class="tca-th">${threadHTML(true)}</div>` : `<div class="tca-list">${listHTML()}</div>`);
      r.innerHTML = `<div class="tcf-head"><div class="t"><b>💬 실시간 상담 · 상담원</b><span class="tcf-count">${S.waiting ? `답변 대기 ${S.waiting}건` : '대기 중인 상담 없음'}</span></div>
        <button type="button" data-act="panel" title="관리자 패널에서 열기">패널</button><button type="button" data-act="visitor" title="고객 화면 미리보기">고객 화면</button><button type="button" data-act="fclose" aria-label="상담원 창 닫기">✕</button></div>
        <div class="tcf-body">${body}</div>
        <div class="tcf-tools"><label><input type="checkbox" data-act="avail" ${S.avail?'checked':''}> 상담 대기 중</label><label><input type="checkbox" data-act="sound" ${S.sound?'checked':''}> 🔔 알림음</label><label><input type="checkbox" data-act="push" ${S.push && pushState()==='granted'?'checked':''}> 🖥 바탕화면 알림</label><span class="tca-hint tca-soundhint" ${S.soundBlocked?'':'hidden'}>화면을 한 번 누르면 소리가 켜져요</span></div>`;
    });
  }
  function openFloat(sid){
    buildFloat();
    S.floatOpen = true; S.floatRoot.classList.add('open');
    const fab = document.getElementById('tgtChatFab'); if (fab) fab.classList.add('is-open');
    try{ if (window.TGT_CHAT && window.TGT_CHAT.close) window.TGT_CHAT.close(); }catch(e){}
    if (sid) select(sid); else { renderFloat(); bgTick(); }
    startUi();
  }
  function closeFloat(){
    if (!S.floatRoot) return;
    S.floatOpen = false; S.floatRoot.classList.remove('open');
    const fab = document.getElementById('tgtChatFab'); if (fab) fab.classList.remove('is-open');
  }
  function toggleFloat(){ S.floatOpen ? closeFloat() : openFloat(); }
  async function openInPanel(sid){
    closeFloat();
    try{
      const panel = document.getElementById('adminPanel');
      if (panel && !panel.classList.contains('open') && typeof toggleAdmin === 'function') await toggleAdmin();
      S.view = 'chat';
      if (typeof switchTab === 'function') switchTab('chat');
    }catch(e){}
    if (sid) select(sid);
  }

  function panelVisible(){ return S.root && document.body.contains(S.root) && S.root.offsetParent !== null; }
  function renderAll(){ if (panelVisible()) render(); if (S.floatOpen) renderFloat(); }

  // ── 동작(이벤트 위임) ─────────────────────────────────────────
  function wire(container){
    if (container._tcaWired) return; container._tcaWired = true;
    container.addEventListener('click', async e=>{
      const t = e.target.closest('[data-act]'); if (!t || !container.contains(t)) return;
      const act = t.dataset.act, s = S.sessions.find(x=>x.id===S.sel);
      if (t.tagName === 'INPUT') return;   // 체크박스는 change에서 처리
      switch (act){
        case 'view': S.view = t.dataset.v; render(); if (S.view === 'chat') startUi(); break;
        case 'sel': select(t.dataset.id); break;
        case 'back': S.sel = null; S.msgs = []; S.reveal = {}; renderAll(); break;
        case 'send': reply(container); break;
        case 'close': if (s) closeSession(s); break;
        case 'del': if (s) delSession(s); break;
        case 'take': if (s) assign(s, true); break;
        case 'release': if (s) assign(s, false); break;
        case 'memo': { const ta = container.querySelector(`textarea[data-memo="${CSS_ESC(t.dataset.id)}"]`); if (ta && await saveMemo(t.dataset.id, ta.value, t)){ ta.dataset.dirty = ''; t.textContent = '저장됨 ✓'; setTimeout(()=>{ t.textContent = '메모 저장'; }, 1500); } break; }
        case 'ttab': S.threadTab = t.dataset.t === 'rec' ? 'rec' : 'chat'; renderAll(); break;
        case 'reveal': if (s){ S.reveal[s.id] = !S.reveal[s.id]; renderAll(); } break;
        case 'test': beep(true); break;
        case 'panel': openInPanel(S.sel); break;
        case 'visitor': closeFloat(); if (typeof tgtChatOpenVisitor === 'function') tgtChatOpenVisitor(); break;
        case 'fclose': closeFloat(); break;
        case 'creload': S.cust.loaded = false; loadCustomers(); break;
        case 'cmemo': { const inp = container.querySelector(`input[data-cmemo="${CSS_ESC(t.dataset.id)}"]`); if (inp && await saveMemo(t.dataset.id, inp.value, t)){ inp.dataset.dirty = ''; t.classList.remove('dirty'); t.textContent = '✓'; setTimeout(()=>{ t.textContent = '저장'; }, 1500); } break; }
        case 'copen': S.view = 'chat'; select(t.dataset.id); break;
        case 'xlsx': doExport('xlsx'); break;
        case 'csv': doExport('csv'); break;
        case 'sreload': S.stats.data = null; loadStats(); break;
        case 'hours': {
          const days = [...container.querySelectorAll('input[data-hday]')].filter(i=>i.checked).map(i=>Number(i.dataset.hday));
          const st = (container.querySelector('input[data-hstart]')||{}).value, en = (container.querySelector('input[data-hend]')||{}).value;
          const msg = container.querySelector('[data-hmsg]');
          if (!/^\d{2}:\d{2}$/.test(st||'') || !/^\d{2}:\d{2}$/.test(en||'')){ if (msg) msg.textContent = '시작·종료 시각을 입력해 주세요.'; break; }
          if (st >= en){ if (msg) msg.textContent = '종료 시각은 시작 시각보다 늦어야 해요.'; break; }
          if (!days.length && !confirm('업무 요일을 하나도 고르지 않았어요. 항상 "업무시간 외"로 안내할까요?')) break;
          try{ tgtSaveChatHours({days, start:st, end:en}); render(); const m2 = S.root && S.root.querySelector('[data-hmsg]'); if (m2) m2.textContent = '✅ 저장했습니다 — ' + chatHoursLabel(); }
          catch(e){ if (msg) msg.textContent = '저장 실패: ' + errText(e); }
          break;
        }
        case 'myname': {
          const inp = container.querySelector('input[data-myname]'); if (!inp) break;
          const { data, error } = await client().rpc('tgt_chat_admin_set_name', {p_name: inp.value});
          if (error){ alert('저장하지 못했어요: ' + errText(error)); break; }
          S.myName = inp.value.trim(); t.textContent = '저장됨 ✓'; setTimeout(()=>{ t.textContent = '저장'; }, 1500); loadSessions();
          break;
        }
      }
    });
    container.addEventListener('change', e=>{
      const t = e.target;
      if (t.dataset.act === 'avail'){ S.avail = t.checked; localStorage.setItem(AVAIL_KEY, S.avail?'1':'0'); ping(); renderAll(); }
      else if (t.dataset.act === 'sound'){ S.sound = t.checked; localStorage.setItem(SOUND_KEY, S.sound?'1':'0'); if (S.sound) beep(); renderAll(); }
      else if (t.dataset.act === 'push'){ enablePush(t.checked); }
      else if (t.dataset.act === 'cmsgs'){ S.cust.withMsgs = t.checked; }
      else if (t.dataset.cf){ const k = t.dataset.cf; S.cust[k] = t.value; if (k === 'period'){ S.cust.loaded = false; loadCustomers(); } else render(); }
      else if (t.dataset.sf){ S.stats.period = t.value; S.stats.data = null; loadStats(); }
    });
    container.addEventListener('input', e=>{
      const t = e.target;
      if (t.dataset.memo || t.dataset.cmemo){ t.dataset.dirty = '1'; const b = t.parentElement && t.parentElement.querySelector('button'); if (b) b.classList.add('dirty'); }
      if (t.dataset.cf === 'q'){ S.cust.q = t.value; clearTimeout(S._qT); S._qT = setTimeout(()=>render(), 250); }
    });
    container.addEventListener('keydown', e=>{
      const t = e.target;
      if (t.dataset && t.dataset.reply && e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){ e.preventDefault(); reply(container); }
    });
  }
  function CSS_ESC(v){ return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/"/g,'\\"'); }

  async function select(id){
    if (S.sel !== id) S.reveal = {};
    S.sel = id; S.msgs = []; S.lastId = 0;
    if (!S.sessions.some(x=>x.id===id)){ await loadSessions(); }
    renderAll();
    await loadThread(true); await markRead(); await loadSessions(); renderAll();
    const host = S.floatOpen ? S.floatRoot : S.root;
    const ta = host && $('textarea[data-reply]', host); if (ta) ta.focus({preventScroll:true});
    startUi();
  }
  async function assign(s, take, force){
    const c = client(); if (!c) return;
    const { data, error } = await c.rpc('tgt_chat_admin_assign', {p_session:s.id, p_take:take, p_force:!!force});
    if (error){ alert('담당을 바꾸지 못했어요: ' + errText(error)); return; }
    if (data && data.ok === false){
      if (confirm(`${data.assigned_name || '다른 상담원'} 님이 응대 중인 상담입니다.\n담당을 내 쪽으로 가져올까요?`)) return assign(s, true, true);
      return;
    }
    await loadSessions(); renderAll();
  }
  async function reply(container){
    const ta = $('textarea[data-reply]', container), btn = $('[data-act=send]', container);
    if (!ta) return;
    const text = ta.value.trim(); if (!text || !S.sel || S.sending) return;
    const c = client(); if (!c) return;
    S.sending = true; if (btn) btn.disabled = true;
    try{
      let force = false;
      for (;;){
        let r = S.v2 ? await c.rpc('tgt_chat_admin_reply', {p_session:S.sel, p_body:text, p_force:force}) : await c.rpc('tgt_chat_admin_reply', {p_session:S.sel, p_body:text});
        if (r.error && S.v2 && isFnMissing(r.error)) r = await c.rpc('tgt_chat_admin_reply', {p_session:S.sel, p_body:text});
        if (r.error){
          const m = /assigned_other:?(.*)/.exec(errText(r.error));
          if (m && !force){
            if (!confirm(`${(m[1]||'').trim() || '다른 상담원'} 님이 응대 중인 상담입니다.\n대신 답변하고 담당을 가져올까요?`)) throw null;
            force = true; continue;
          }
          throw r.error;
        }
        break;
      }
      ta.value = '';
      await loadThread(false); await loadSessions(); renderAll();
      const host = container; const t2 = $('textarea[data-reply]', host); if (t2){ t2.value = ''; t2.focus({preventScroll:true}); }
    }catch(e){ if (e) alert('답변을 보내지 못했어요: ' + errText(e)); }
    S.sending = false; const b2 = $('[data-act=send]', container); if (b2) b2.disabled = false;
  }
  async function closeSession(s){
    if (s.status==='종료') return;
    if (!confirm(`"${maskName(s.name)}" 님과의 상담을 종료할까요?\n(고객 화면에 종료 안내가 표시되며, 고객이 다시 메시지를 보내면 상담이 다시 열립니다)`)) return;
    const c = client(); if (!c) return;
    const { error } = await c.rpc('tgt_chat_admin_close', {p_session:s.id});
    if (error){ alert('종료하지 못했어요: ' + error.message); return; }
    await loadThread(false); await loadSessions(); renderAll();
  }
  async function delSession(s){
    if (!confirm(`"${maskName(s.name)}" 님의 상담 기록(대화·연락처)을 완전히 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    const c = client(); if (!c) return;
    const { error } = await c.from('tgt_chat_sessions').delete().eq('id', s.id);
    if (error){ alert('삭제하지 못했어요: ' + error.message); return; }
    S.sel = null; S.msgs = []; S.cust.rows = S.cust.rows.filter(r=>r.id!==s.id); await loadSessions(); renderAll();
  }
  // 상담 화면(패널 탭·상담원 창)이 열려 있는 동안 더 자주 새로 고침
  function startUi(){
    if (S.uiTimer) return;
    S.uiTimer = setInterval(async ()=>{
      const pv = panelVisible() && S.view === 'chat';
      if (!pv && !S.floatOpen){ stopUi(); return; }
      if (!authed() || S.uiBusy) return;
      S.uiBusy = true;
      try{
        await loadSessions();
        if (S.sel) await loadThread(false);
        // 바뀐 것이 있을 때만 다시 그린다(목록 스크롤·입력 중인 글 보호). 대기 시간은 1분 단위로 갱신
        const sig = JSON.stringify([S.sessions.map(x=>[x.id, x.status, x.unread_admin, x.last_message_at, x.assigned_to, x.memo, waitMin(x)]), S.msgs.length, S.sel, S.waiting]);
        if (sig !== S._sig){ S._sig = sig; renderAll(); }
      }catch(e){}
      S.uiBusy = false;
    }, THREAD_MS);
  }
  function stopUi(){ if (S.uiTimer){ clearInterval(S.uiTimer); S.uiTimer = null; } }

  window.TGT_CHAT_ADMIN = {
    boot, openFloat, closeFloat, toggleFloat, active: authed,
    render: function(root){ render(root); startUi(); bgTick().then(()=>render()); },
    _internal: {maskName, maskPhone, S},
  };
})();
