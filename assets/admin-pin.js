/* THE GOLF TREND — 2중 관리자 비밀번호(숫자 4자리)
 * 개인정보 내보내기(실시간 상담 고객 정보 엑셀·CSV)와 "전체 초기화"·"상품 초기화" 전에 한 번 더 확인한다.
 * DB: docs/sql/2026-10-29_live_chat_v2.sql — 원문은 저장하지 않고 bcrypt 해시만 Supabase에 저장(모든 관리자 공용).
 *     10분에 5번 틀리면 그 계정은 10분 동안 잠긴다. 확인·변경 기록은 tgt_admin_pin_log에 남는다.
 * 사용: TGT_PIN.require(action, title, {allowWithoutDb}) → Promise<boolean>,  TGT_PIN.manage(container)
 */
(function(){
  'use strict';
  if (window.TGT_PIN) return;

  function client(){ try{ return getSupabaseClient(); }catch(e){ return null; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function errText(e){ return String((e && (e.message || e.details || e.code)) || e || ''); }
  function isMissing(e){ return /PGRST202|PGRST205|42883|42P01|does not exist|Could not find|schema cache/i.test(errText(e)); }
  const okPin = v => /^\d{4}$/.test(String(v||''));

  const CSS = `
.tpn-ov{position:fixed;inset:0;z-index:3500;background:rgba(10,23,48,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px}
.tpn-box{width:100%;max-width:360px;background:#fff;color:#1b2536;border-radius:16px;box-shadow:0 20px 50px rgba(3,13,38,.4);padding:22px 20px 18px;font-family:inherit}
.tpn-box h3{margin:0 0 6px;font-size:1.05rem}
.tpn-box p{margin:0 0 12px;font-size:.84rem;color:#5b6778;line-height:1.55}
.tpn-pin{display:block;width:100%;padding:12px;border:1px solid #c7cfdc;border-radius:12px;font-size:1.6rem;letter-spacing:.6em;text-align:center;font-family:inherit;margin:0 0 8px}
.tpn-pin:focus{outline:none;border-color:#c9962b;box-shadow:0 0 0 3px rgba(201,150,43,.22)}
.tpn-lab{display:block;font-size:.76rem;font-weight:800;color:#3a4658;margin:4px 0 4px}
.tpn-err{min-height:1.2em;color:#c0392b;font-size:.8rem;margin:2px 0 10px}
.tpn-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.tpn-btns button{padding:10px 16px;border-radius:10px;border:1px solid #c7cfdc;background:#fff;font-weight:800;font-size:.88rem;cursor:pointer;font-family:inherit}
.tpn-btns button.go{background:#0f2347;border-color:#0f2347;color:#fff}
.tpn-btns button.warn{color:#b45309;border-color:#f0c987}
.tpn-btns button:disabled{opacity:.5;cursor:default}
.tpn-card{border:1px solid rgba(10,23,48,.12);border-radius:12px;background:#fff;padding:14px}
.tpn-card h4{margin:0 0 4px;font-size:.95rem}
.tpn-card .tpn-st{font-size:.8rem;color:#5b6778;margin:0 0 10px;line-height:1.55}
.tpn-card .tpn-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:8px 0}
.tpn-card .tpn-row label{display:flex;flex-direction:column;font-size:.74rem;font-weight:800;color:#3a4658;gap:3px}
.tpn-card input{width:96px;padding:8px 10px;border:1px solid #c7cfdc;border-radius:9px;font-size:1.05rem;letter-spacing:.35em;text-align:center;font-family:inherit}
.tpn-card button{padding:8px 13px;border-radius:9px;border:1px solid #c7cfdc;background:#fff;font-weight:800;font-size:.8rem;cursor:pointer;font-family:inherit}
.tpn-card button.go{background:#0f2347;border-color:#0f2347;color:#fff}
.tpn-card button.danger{color:#c0392b;border-color:#f3b4ad}
.tpn-card .tpn-msg{font-size:.8rem;margin-top:6px;min-height:1.1em}
.tpn-card .tpn-msg.ok{color:#15803d}.tpn-card .tpn-msg.bad{color:#c0392b}`;
  let styled = false;
  function style(){ if (styled) return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
  const PIN_INPUT = (name, ph) => `<input class="tpn-pin" name="${name}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="${ph||'••••'}" aria-label="4자리 숫자">`;
  function digitsOnly(root){ root.querySelectorAll('input[inputmode=numeric]').forEach(i=>i.addEventListener('input', ()=>{ const v = i.value.replace(/\D/g,'').slice(0,4); if (v !== i.value) i.value = v; })); }

  async function status(){
    const c = client(); if (!c) return {error:'no-client'};
    const { data, error } = await c.rpc('tgt_admin_pin_status');
    if (error) return {error: errText(error), missing: isMissing(error)};
    return data || {};
  }

  // 모달 한 개를 띄우고 닫힐 때 결과를 돌려준다
  function modal(html, wire){
    style();
    return new Promise(resolve=>{
      const ov = document.createElement('div'); ov.className = 'tpn-ov'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true');
      ov.innerHTML = `<div class="tpn-box">${html}</div>`;
      document.body.appendChild(ov);
      let done = false;
      const finish = v => { if (done) return; done = true; ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); finish(false); } };
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('click', e=>{ if (e.target === ov) finish(false); });
      digitsOnly(ov);
      wire(ov, finish);
      const first = ov.querySelector('input'); if (first) setTimeout(()=>first.focus(), 30);
    });
  }

  /** 2중 비밀번호 확인. 맞으면 true. 미등록이면 그 자리에서 등록 후 true. */
  async function requirePin(action, title, opts){
    opts = opts || {};
    const st = await status();
    const head = `<h3>🔐 ${esc(title || '2중 관리자 비밀번호 확인')}</h3>`;
    if (st.error){
      if (st.missing){
        return modal(`${head}<p>2중 관리자 비밀번호 기능이 아직 준비되지 않았습니다.<br>Supabase SQL Editor에서 <code>docs/sql/2026-10-29_live_chat_v2.sql</code>을 실행해 주세요.</p>
          <div class="tpn-btns"><button type="button" class="no">취소</button>${opts.allowWithoutDb ? '<button type="button" class="warn yes">비밀번호 없이 진행</button>' : ''}</div>`,
          (ov, finish)=>{ ov.querySelector('.no').onclick = ()=>finish(false); const y = ov.querySelector('.yes'); if (y) y.onclick = ()=>finish(true); });
      }
      alert('2중 비밀번호를 확인하지 못했습니다: ' + st.error + '\n관리자 로그인 상태를 확인해 주세요.');
      return false;
    }
    if (!st.set){
      return modal(`${head}<p>2중 관리자 비밀번호가 아직 등록되지 않았습니다.<br>숫자 4자리를 정해 등록하면 바로 진행합니다. (모든 관리자 공용 · 관리자 패널 <b>💬 실시간 상담 → ⚙️ 설정</b>에서 변경·삭제)</p>
        <label class="tpn-lab">새 비밀번호</label>${PIN_INPUT('n1')}<label class="tpn-lab">한 번 더</label>${PIN_INPUT('n2')}
        <div class="tpn-err" role="alert"></div><div class="tpn-btns"><button type="button" class="no">취소</button><button type="button" class="go">등록하고 진행</button></div>`,
        (ov, finish)=>{
          const err = ov.querySelector('.tpn-err'), go = ov.querySelector('.go');
          ov.querySelector('.no').onclick = ()=>finish(false);
          const submit = async ()=>{
            const a = ov.querySelector('[name=n1]').value, b = ov.querySelector('[name=n2]').value;
            if (!okPin(a)){ err.textContent = '숫자 4자리를 입력해 주세요.'; return; }
            if (a !== b){ err.textContent = '두 번 입력한 비밀번호가 다릅니다.'; return; }
            go.disabled = true;
            const { data, error } = await client().rpc('tgt_admin_pin_set', {p_current:null, p_new:a});
            go.disabled = false;
            if (error){ err.textContent = '등록 실패: ' + errText(error); return; }
            if (data === false){ err.textContent = '다른 관리자가 먼저 등록했습니다. 창을 닫고 다시 시도해 주세요.'; return; }
            finish(true);
          };
          go.onclick = submit;
          ov.querySelector('[name=n2]').addEventListener('keydown', e=>{ if (e.key==='Enter') submit(); });
        });
    }
    if (st.locked){ alert('2중 비밀번호를 여러 번 틀려 10분 동안 잠겼습니다. 잠시 후 다시 시도해 주세요.'); return false; }
    return modal(`${head}<p>${esc(opts.desc || '계속하려면 2중 관리자 비밀번호(숫자 4자리)를 입력하세요.')}</p>${PIN_INPUT('p')}
      <div class="tpn-err" role="alert"></div><div class="tpn-btns"><button type="button" class="no">취소</button><button type="button" class="go">확인</button></div>`,
      (ov, finish)=>{
        const inp = ov.querySelector('[name=p]'), err = ov.querySelector('.tpn-err'), go = ov.querySelector('.go');
        ov.querySelector('.no').onclick = ()=>finish(false);
        const submit = async ()=>{
          if (!okPin(inp.value)){ err.textContent = '숫자 4자리를 입력해 주세요.'; return; }
          go.disabled = true;
          const { data, error } = await client().rpc('tgt_admin_pin_verify', {p_pin:inp.value, p_action:String(action||'verify').slice(0,40)});
          go.disabled = false;
          if (error){ err.textContent = /locked/.test(errText(error)) ? '여러 번 틀려 10분 동안 잠겼습니다.' : '확인 실패: ' + errText(error); return; }
          if (data !== true){ err.textContent = '비밀번호가 맞지 않습니다. (10분에 5번 틀리면 잠깁니다)'; inp.value = ''; inp.focus(); return; }
          finish(true);
        };
        go.onclick = submit;
        inp.addEventListener('input', ()=>{ if (inp.value.length === 4) submit(); });
        inp.addEventListener('keydown', e=>{ if (e.key==='Enter') submit(); });
      });
  }

  /** 관리 화면(등록·변경·삭제) */
  async function manage(box){
    style();
    box.innerHTML = '<div class="tpn-card">불러오는 중...</div>';
    const st = await status();
    const card = document.createElement('div'); card.className = 'tpn-card';
    const pin = (n, l) => `<label>${l}<input name="${n}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••"></label>`;
    if (st.error){
      card.innerHTML = `<h4>🔐 2중 관리자 비밀번호</h4><div class="tpn-st">${st.missing ? '아직 준비되지 않았습니다. Supabase SQL Editor에서 <code>docs/sql/2026-10-29_live_chat_v2.sql</code>을 실행해 주세요.' : '불러오기 실패: ' + esc(st.error)}</div>`;
    } else if (!st.set){
      card.innerHTML = `<h4>🔐 2중 관리자 비밀번호 <span style="color:#b45309">· 미등록</span></h4>
        <div class="tpn-st">개인정보(고객 정보) 내보내기, 전체 초기화, 상품 초기화 전에 한 번 더 입력하는 숫자 4자리입니다. 모든 관리자 계정이 함께 씁니다.</div>
        <div class="tpn-row">${pin('n1','새 비밀번호')}${pin('n2','한 번 더')}<button type="button" class="go" data-act="set">등록</button></div><div class="tpn-msg"></div>`;
    } else {
      card.innerHTML = `<h4>🔐 2중 관리자 비밀번호 <span style="color:#15803d">· 등록됨</span></h4>
        <div class="tpn-st">마지막 변경 ${esc(st.updated_at ? new Date(st.updated_at).toLocaleString('ko-KR') : '-')}${st.locked ? ' · <b style="color:#c0392b">이 계정은 여러 번 틀려 10분 동안 잠겨 있습니다</b>' : ''}<br>
        잊어버렸다면 Supabase SQL Editor에서 <code>delete from public.tgt_admin_pin;</code> 실행 후 새로 등록하세요.</div>
        <div class="tpn-row">${pin('cur','현재 비밀번호')}${pin('n1','새 비밀번호')}${pin('n2','한 번 더')}<button type="button" class="go" data-act="change">변경</button></div>
        <div class="tpn-row">${pin('cur2','현재 비밀번호')}<button type="button" class="danger" data-act="clear">삭제</button></div><div class="tpn-msg"></div>`;
    }
    box.innerHTML = ''; box.appendChild(card); digitsOnly(card);
    const msg = card.querySelector('.tpn-msg');
    const say = (t, ok) => { if (msg){ msg.textContent = t; msg.className = 'tpn-msg ' + (ok ? 'ok' : 'bad'); } };
    const val = n => { const i = card.querySelector(`[name=${n}]`); return i ? i.value : ''; };
    card.querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click', async ()=>{
      const act = b.dataset.act, c = client();
      if (act === 'set' || act === 'change'){
        if (act === 'change' && !okPin(val('cur'))) return say('현재 비밀번호(숫자 4자리)를 입력해 주세요.');
        if (!okPin(val('n1'))) return say('새 비밀번호는 숫자 4자리입니다.');
        if (val('n1') !== val('n2')) return say('새 비밀번호를 두 번 똑같이 입력해 주세요.');
        b.disabled = true;
        const { data, error } = await c.rpc('tgt_admin_pin_set', {p_current: act==='change' ? val('cur') : null, p_new: val('n1')});
        b.disabled = false;
        if (error) return say(/locked/.test(errText(error)) ? '여러 번 틀려 10분 동안 잠겼습니다.' : '실패: ' + errText(error));
        if (data !== true) return say(act==='change' ? '현재 비밀번호가 맞지 않습니다.' : '이미 등록되어 있습니다. 새로 고침 후 변경해 주세요.');
        await manage(box); const m2 = box.querySelector('.tpn-msg'); if (m2){ m2.textContent = act==='change' ? '✅ 변경했습니다.' : '✅ 등록했습니다.'; m2.className = 'tpn-msg ok'; }
      } else if (act === 'clear'){
        if (!okPin(val('cur2'))) return say('현재 비밀번호(숫자 4자리)를 입력해 주세요.');
        if (!confirm('2중 관리자 비밀번호를 삭제할까요?\n삭제하면 다음에 내보내기·초기화할 때 새로 등록해야 합니다.')) return;
        b.disabled = true;
        const { data, error } = await c.rpc('tgt_admin_pin_clear', {p_current: val('cur2')});
        b.disabled = false;
        if (error) return say(/locked/.test(errText(error)) ? '여러 번 틀려 10분 동안 잠겼습니다.' : '실패: ' + errText(error));
        if (data !== true) return say('현재 비밀번호가 맞지 않습니다.');
        await manage(box); const m2 = box.querySelector('.tpn-msg'); if (m2){ m2.textContent = '✅ 삭제했습니다.'; m2.className = 'tpn-msg ok'; }
      }
    }));
  }

  window.TGT_PIN = { require: requirePin, manage, status };
})();
