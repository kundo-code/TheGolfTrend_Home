/* THE GOLF TREND — 관리자 패널 "실시간 상담"(상담원 화면)
 * 관리자 로그인 후 index.html이 불러온다(tgtChatAdminBoot). 방문자 화면(live-chat.js)과 같은 DB를 쓴다.
 * DB: docs/sql/2026-10-28_live_chat.sql — 상담원은 tgt_is_admin() 허용 계정만 조회·답변·종료·삭제할 수 있다.
 * 하는 일: ① 로그인 중 백그라운드로 새 상담·안 읽은 메시지 확인(탭 배지·소리·제목 표시) ② 상담원 온라인 표시(30초마다) ③ 상담 목록·대화·답변·종료·삭제
 */
(function(){
  'use strict';
  if (window.TGT_CHAT_ADMIN) return;

  const AVAIL_KEY = 'kundo_chat_avail', SOUND_KEY = 'kundo_chat_sound';
  const BG_MS = 8000, THREAD_MS = 3000, PING_MS = 30000;
  const S = {sessions:[], sel:null, msgs:[], lastId:0, unreadSessions:0, prevUnread:null, missing:false, error:'',
    avail: localStorage.getItem(AVAIL_KEY) !== '0', sound: localStorage.getItem(SOUND_KEY) !== '0',
    root:null, bgTimer:null, uiTimer:null, pingTimer:null, busy:false, baseTitle:document.title, sending:false, loadedList:false};

  const $ = (sel, root) => (root||document).querySelector(sel);
  function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text!=null) e.textContent = text; return e; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function client(){ try{ return getSupabaseClient(); }catch(e){ return null; } }
  function authed(){ try{ return !!adminSession; }catch(e){ return false; } }
  function hhmm(t){ const d = new Date(t); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  function when(t){
    const d = new Date(t), n = new Date(); const same = d.toDateString() === n.toDateString();
    return same ? hhmm(t) : `${d.getMonth()+1}/${d.getDate()} ${hhmm(t)}`;
  }
  function isMissing(error){ const m = String((error && (error.message||error.code)) || ''); return /42P01|PGRST205|PGRST202|does not exist|Could not find the table|schema cache/i.test(m); }

  // ── 알림(소리·탭 배지·제목) ───────────────────────────────
  let audio = null;
  function beep(){
    if (!S.sound) return;
    try{
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(.25, audio.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .35);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + .38);
    }catch(e){}
  }
  function paintBadge(){
    const b = document.getElementById('chatTabBadge');
    if (b){ b.hidden = !(S.unreadSessions > 0); b.textContent = String(S.unreadSessions); }
    document.title = S.unreadSessions > 0 ? `(${S.unreadSessions}) 새 상담 · ${S.baseTitle}` : S.baseTitle;
  }

  // ── 데이터 ─────────────────────────────────────────────────
  async function loadSessions(){
    const c = client(); if (!c || !authed()) return;
    const { data, error } = await c.from('tgt_chat_sessions')
      .select('id,created_at,last_message_at,name,phone,page,status,unread_admin,marketing_opt_in,consent_at,consent_version,visitor_seen_at')
      .order('last_message_at', {ascending:false}).limit(100);
    if (error){ S.missing = isMissing(error); S.error = S.missing ? '' : String(error.message||error); return; }
    S.missing = false; S.error = ''; S.sessions = data || []; S.loadedList = true;
    const unread = S.sessions.filter(x=>x.unread_admin > 0 && x.status !== '종료').length;
    const total = S.sessions.reduce((n,x)=>n + (x.status !== '종료' ? (x.unread_admin||0) : 0), 0);
    S.unreadSessions = unread;
    if (S.prevUnread !== null && total > S.prevUnread){ beep(); }
    S.prevUnread = total;
    paintBadge();
  }
  async function loadThread(full){
    const c = client(); if (!c || !S.sel) return;
    if (full){ S.msgs = []; S.lastId = 0; }
    const { data, error } = await c.from('tgt_chat_messages').select('id,created_at,sender,body').eq('session_id', S.sel).gt('id', S.lastId).order('id', {ascending:true}).limit(500);
    if (error) return;
    if (data && data.length){
      S.msgs = S.msgs.concat(data); S.lastId = data[data.length-1].id;
      if (data.some(m=>m.sender==='visitor')) markRead();
    }
  }
  async function markRead(){
    const c = client(); if (!c || !S.sel) return;
    const s = S.sessions.find(x=>x.id===S.sel); if (s){ s.unread_admin = 0; }
    await c.from('tgt_chat_sessions').update({unread_admin:0}).eq('id', S.sel);
  }
  async function ping(){
    const c = client(); if (!c || !authed() || S.missing) return;
    try{ await c.rpc('tgt_chat_admin_ping', {p_online: !!S.avail}); }catch(e){}
  }

  // ── 백그라운드(로그인 중 항상) ─────────────────────────────
  async function bgTick(){
    if (S.busy) return; S.busy = true;
    try{ await loadSessions(); }catch(e){}
    S.busy = false;
  }
  function boot(){
    if (S.bgTimer) return;
    bgTick(); ping();
    S.bgTimer = setInterval(()=>{ if (authed()) bgTick(); }, BG_MS);
    S.pingTimer = setInterval(()=>{ if (authed()) ping(); }, PING_MS);
    window.addEventListener('beforeunload', ()=>{ try{ const c = client(); if (c && authed()) c.rpc('tgt_chat_admin_ping', {p_online:false}); }catch(e){} });
  }

  // ── 화면 ───────────────────────────────────────────────────
  const CSS = `
.tca{display:flex;flex-direction:column;gap:10px;font-size:.88rem;color:var(--nm-text,#202B3A)}
.tca-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 12px;border-radius:12px;background:var(--nm-surface-light,#f4f7fb);border:1px solid rgba(10,23,48,.1)}
.tca-sw{display:inline-flex;align-items:center;gap:7px;font-weight:700;cursor:pointer}
.tca-sw input{width:18px;height:18px}
.tca-hint{font-size:.76rem;color:var(--nm-text-soft,#667385)}
.tca-warn{padding:12px 14px;border-radius:12px;background:#fff4e5;border:1px solid #f0c987;line-height:1.6}
.tca-wrap{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:10px;min-height:460px}
.tca-list{border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;overflow:auto;max-height:70vh}
.tca-item{display:block;width:100%;text-align:left;padding:10px 12px;border:none;border-bottom:1px solid rgba(10,23,48,.08);background:#fff;cursor:pointer;font-family:inherit;color:inherit}
.tca-item:hover{background:#f6f9ff}.tca-item.on{background:#eef4ff;box-shadow:inset 3px 0 0 #2563eb}
.tca-item .r1{display:flex;align-items:center;gap:6px;font-weight:800}
.tca-item .r2{display:flex;justify-content:space-between;gap:6px;margin-top:3px;font-size:.74rem;color:#6b7788}
.tca-chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:.68rem;font-weight:800;background:#e5e9f1;color:#475569}
.tca-chip.wait{background:#fde8c8;color:#92400e}.tca-chip.go{background:#d6f5e0;color:#166534}.tca-chip.end{background:#e5e9f1;color:#64748b}
.tca-dot{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#e11d48;color:#fff;font-size:.72rem;font-weight:800;display:inline-flex;align-items:center;justify-content:center;margin-left:auto}
.tca-th{display:flex;flex-direction:column;border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;min-width:0;overflow:hidden}
.tca-th-h{padding:10px 12px;border-bottom:1px solid rgba(10,23,48,.1);display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;background:#f8fafc}
.tca-th-h b{font-size:1rem}
.tca-th-h a{color:#2563eb;font-weight:700;text-decoration:none}
.tca-meta{width:100%;font-size:.74rem;color:#6b7788;line-height:1.5;word-break:break-all}
.tca-btns{margin-left:auto;display:flex;gap:6px}
.tca-btns button{padding:6px 11px;border-radius:9px;border:1px solid rgba(10,23,48,.18);background:#fff;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit}
.tca-btns button.danger{color:#c0392b}
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
}`;
  let styled = false;
  function style(){ if (styled) return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

  function render(root){
    if (root) S.root = root;
    root = S.root; if (!root) return;
    style();
    if (!authed()){ root.innerHTML = '<div class="tca-empty">관리자 로그인 후 이용할 수 있어요.</div>'; return; }
    root.innerHTML = '';
    const wrap = el('div','tca');
    const bar = el('div','tca-bar');
    bar.innerHTML = `<label class="tca-sw"><input type="checkbox" class="tca-avail" ${S.avail?'checked':''}> 상담 대기 중</label>
      <span class="tca-hint">켜 두면 고객 화면에 "상담원 온라인"이 표시됩니다(이 화면이 열려 있는 동안).</span>
      <label class="tca-sw"><input type="checkbox" class="tca-sound" ${S.sound?'checked':''}> 새 메시지 알림음</label>`;
    wrap.appendChild(bar);
    $('.tca-avail', bar).addEventListener('change', e=>{ S.avail = e.target.checked; localStorage.setItem(AVAIL_KEY, S.avail?'1':'0'); ping(); });
    $('.tca-sound', bar).addEventListener('change', e=>{ S.sound = e.target.checked; localStorage.setItem(SOUND_KEY, S.sound?'1':'0'); if (S.sound) beep(); });
    if (S.missing){
      const w = el('div','tca-warn'); w.innerHTML = '실시간 상담 데이터베이스가 아직 준비되지 않았어요.<br>Supabase → <b>SQL Editor</b>에서 <code>docs/sql/2026-10-28_live_chat.sql</code> 내용을 한 번 실행해 주세요. (자세한 순서: <code>docs/live-chat-setup.md</code>)';
      wrap.appendChild(w); root.appendChild(wrap); return;
    }
    if (S.error){ const w = el('div','tca-warn'); w.textContent = '불러오기 실패: ' + S.error; wrap.appendChild(w); }
    const grid = el('div','tca-wrap' + (S.sel ? ' thread' : ''));
    const list = el('div','tca-list');
    if (!S.sessions.length) list.appendChild(el('div','tca-empty', S.loadedList ? '아직 들어온 상담이 없어요.' : '불러오는 중...'));
    S.sessions.forEach(s=>{
      const b = el('button','tca-item' + (s.id===S.sel?' on':'')); b.type = 'button';
      const cls = s.status==='대기' ? 'wait' : (s.status==='상담중' ? 'go' : 'end');
      b.innerHTML = `<div class="r1"><span>${esc(s.name)}</span><span class="tca-chip ${cls}">${esc(s.status)}</span>${s.unread_admin>0 && s.status!=='종료' ? `<span class="tca-dot">${s.unread_admin>9?'9+':s.unread_admin}</span>` : ''}</div>
        <div class="r2"><span>${esc(s.phone)}</span><span>${when(s.last_message_at)}</span></div>`;
      b.addEventListener('click', ()=>select(s.id));
      list.appendChild(b);
    });
    grid.appendChild(list);
    grid.appendChild(threadEl());
    wrap.appendChild(grid); root.appendChild(wrap);
    const box = $('.tca-msgs', root); if (box) box.scrollTop = box.scrollHeight;
  }
  function threadEl(){
    const th = el('div','tca-th');
    const s = S.sessions.find(x=>x.id===S.sel);
    if (!s){ th.appendChild(el('div','tca-empty','왼쪽에서 상담을 선택하세요.')); return th; }
    const h = el('div','tca-th-h');
    h.innerHTML = `<button type="button" class="tca-back apc-btn-sm">‹ 목록</button><b>${esc(s.name)}</b><a href="tel:${esc(s.phone)}">📞 ${esc(s.phone)}</a>
      <div class="tca-btns"><button type="button" class="tca-close">${s.status==='종료'?'종료됨':'상담 종료'}</button><button type="button" class="tca-del danger">삭제</button></div>
      <div class="tca-meta">시작 ${esc(new Date(s.created_at).toLocaleString('ko-KR'))} · 방문 페이지 ${esc(s.page||'-')}<br>개인정보 수집·이용 동의 ${esc(new Date(s.consent_at).toLocaleString('ko-KR'))} (${esc(s.consent_version||'-')}) · 선택 동의(소식 안내) ${s.marketing_opt_in?'동의':'미동의'}</div>`;
    th.appendChild(h);
    $('.tca-back', h).addEventListener('click', ()=>{ S.sel = null; render(); });
    $('.tca-close', h).addEventListener('click', ()=>closeSession(s));
    $('.tca-del', h).addEventListener('click', ()=>delSession(s));
    const box = el('div','tca-msgs');
    S.msgs.forEach(m=>{
      const w = el('div','tca-m ' + (m.sender==='visitor'?'v':(m.sender==='admin'?'a':'s')));
      const b = el('div','bub'); b.textContent = m.body; w.appendChild(b);
      if (m.sender!=='system') w.appendChild(el('div','t', (m.sender==='admin'?'상담원 ':'고객 ') + hhmm(m.created_at)));
      box.appendChild(w);
    });
    th.appendChild(box);
    const rep = el('div','tca-rep');
    rep.innerHTML = '<textarea rows="2" maxlength="2000" placeholder="답변을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"></textarea><button type="button">보내기</button>';
    const ta = $('textarea', rep), btn = $('button', rep);
    const go = ()=>reply(ta, btn);
    btn.addEventListener('click', go);
    ta.addEventListener('keydown', e=>{ if (e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229){ e.preventDefault(); go(); } });
    th.appendChild(rep);
    return th;
  }

  // ── 동작 ───────────────────────────────────────────────────
  async function select(id){
    S.sel = id; S.msgs = []; S.lastId = 0; render();
    await loadThread(true); await markRead(); await loadSessions(); render();
    const ta = $('.tca-rep textarea', S.root); if (ta) ta.focus();
    startUi();
  }
  async function reply(ta, btn){
    const text = ta.value.trim(); if (!text || !S.sel || S.sending) return;
    const c = client(); if (!c) return;
    S.sending = true; btn.disabled = true;
    try{
      const { error } = await c.rpc('tgt_chat_admin_reply', {p_session:S.sel, p_body:text});
      if (error) throw error;
      ta.value = '';
      await loadThread(false); await loadSessions(); render();
      const t2 = $('.tca-rep textarea', S.root); if (t2) t2.focus();
    }catch(e){ alert('답변을 보내지 못했어요: ' + String((e && e.message) || e)); }
    S.sending = false; btn.disabled = false;
  }
  async function closeSession(s){
    if (s.status==='종료') return;
    if (!confirm(`"${s.name}" 님과의 상담을 종료할까요?\n(고객 화면에 종료 안내가 표시되며, 고객이 다시 메시지를 보내면 상담이 다시 열립니다)`)) return;
    const c = client(); if (!c) return;
    const { error } = await c.rpc('tgt_chat_admin_close', {p_session:s.id});
    if (error){ alert('종료하지 못했어요: ' + error.message); return; }
    await loadThread(false); await loadSessions(); render();
  }
  async function delSession(s){
    if (!confirm(`"${s.name}" 님의 상담 기록(대화·연락처)을 완전히 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
    const c = client(); if (!c) return;
    const { error } = await c.from('tgt_chat_sessions').delete().eq('id', s.id);
    if (error){ alert('삭제하지 못했어요: ' + error.message); return; }
    S.sel = null; S.msgs = []; await loadSessions(); render();
  }
  // 상담 탭이 열려 있는 동안만 더 자주 새로 고침(대화·목록)
  function startUi(){
    stopUi();
    S.uiTimer = setInterval(async ()=>{
      if (!S.root || !document.body.contains(S.root) || S.root.offsetParent === null){ stopUi(); return; }
      if (!authed()) return;
      const hadSel = S.sel, before = S.msgs.length;
      await loadSessions();
      if (hadSel){ await loadThread(false); }
      // 입력 중인 답변을 지우지 않도록, 바뀐 것이 있을 때만 다시 그린다
      const changed = S.msgs.length !== before || !S.root.querySelector('.tca');
      const ta = S.root.querySelector('.tca-rep textarea'), typing = ta && (ta.value.length > 0 || document.activeElement === ta);
      if (changed || !typing) { const keep = ta ? ta.value : '', hadFocus = ta && document.activeElement === ta; render(); const t2 = S.root.querySelector('.tca-rep textarea'); if (t2){ if (keep) t2.value = keep; if (hadFocus) t2.focus(); } }
    }, THREAD_MS);
  }
  function stopUi(){ if (S.uiTimer){ clearInterval(S.uiTimer); S.uiTimer = null; } }

  window.TGT_CHAT_ADMIN = {
    boot,
    render: function(root){ render(root); startUi(); bgTick().then(()=>render()); }
  };
})();
