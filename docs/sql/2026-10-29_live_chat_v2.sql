-- THE GOLF TREND — 실시간 상담 2단계(고객 정보·여러 상담원·대기 시간·통계·CRM 연결·2중 관리자 비밀번호)
-- 먼저 docs/sql/2026-10-28_live_chat.sql 이 실행되어 있어야 합니다.
-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다. 기존 상담·대화 기록은 그대로 유지됩니다(열만 추가).
-- 되돌리기: docs/sql/2026-10-29_live_chat_v2_rollback.sql
--
-- ■ 추가되는 것
--   tgt_chat_sessions 열 : gender(남/여) · region_sido/region_sigungu(출발지역) · memo(상담원 메모)
--                         assigned_to/assigned_name/assigned_at(담당 상담원) · waiting_since(답변 대기 시작 시각)
--                         first_response_at(첫 상담원 답변 시각) · crm_consultation_id(CRM 상담 기록 번호)
--   tgt_chat_messages 열 : agent_id/agent_name(어느 상담원이 보낸 답변인지)
--   tgt_chat_agents       : 상담원 표시 이름 + 상담원별 온라인 표시(여러 상담원)
--   tgt_admin_pin         : 2중 관리자 비밀번호(숫자 4자리) — 원문은 저장하지 않고 bcrypt 해시만 저장
--   tgt_admin_pin_log     : 2중 비밀번호 확인·변경 기록(개인정보 내보내기·초기화 접근 기록)

create extension if not exists pgcrypto with schema extensions;

-- ── 1. 상담 열 추가 ───────────────────────────────────────────
alter table public.tgt_chat_sessions add column if not exists gender text;
alter table public.tgt_chat_sessions add column if not exists region_sido text;
alter table public.tgt_chat_sessions add column if not exists region_sigungu text;
alter table public.tgt_chat_sessions add column if not exists memo text;
alter table public.tgt_chat_sessions add column if not exists assigned_to uuid;
alter table public.tgt_chat_sessions add column if not exists assigned_name text;
alter table public.tgt_chat_sessions add column if not exists assigned_at timestamptz;
alter table public.tgt_chat_sessions add column if not exists waiting_since timestamptz;
alter table public.tgt_chat_sessions add column if not exists first_response_at timestamptz;
alter table public.tgt_chat_sessions add column if not exists crm_consultation_id bigint;
alter table public.tgt_chat_messages add column if not exists agent_id uuid;
alter table public.tgt_chat_messages add column if not exists agent_name text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tgt_chat_sessions_gender_chk') then
    alter table public.tgt_chat_sessions add constraint tgt_chat_sessions_gender_chk check (gender is null or gender in ('남','여'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tgt_chat_sessions_memo_chk') then
    alter table public.tgt_chat_sessions add constraint tgt_chat_sessions_memo_chk check (memo is null or char_length(memo) <= 2000);
  end if;
end $$;
create index if not exists tgt_chat_sessions_created_idx on public.tgt_chat_sessions (created_at desc);

-- 기존 '대기' 상담은 마지막 메시지 시각부터 대기 중으로 본다(한 번만)
update public.tgt_chat_sessions set waiting_since = last_message_at where status = '대기' and waiting_since is null;
-- 기존 상담의 첫 답변 시각(상담원 메시지 중 가장 이른 것)
update public.tgt_chat_sessions s set first_response_at = m.t
  from (select session_id, min(created_at) t from public.tgt_chat_messages where sender = 'admin' group by session_id) m
 where m.session_id = s.id and s.first_response_at is null;

-- ── 2. 상담원(여러 명) ────────────────────────────────────────
create table if not exists public.tgt_chat_agents (
  user_id      uuid primary key,
  display_name text check (display_name is null or char_length(display_name) between 1 and 20),
  last_seen    timestamptz not null default now() - interval '1 day',
  online       boolean not null default false
);
alter table public.tgt_chat_agents enable row level security;
revoke all on public.tgt_chat_agents from anon;
grant select on public.tgt_chat_agents to authenticated;
drop policy if exists "admins select agents" on public.tgt_chat_agents;
create policy "admins select agents" on public.tgt_chat_agents for select to authenticated using (public.tgt_is_admin());

-- 이 계정의 상담원 표시 이름(없으면 이메일 앞부분)
create or replace function public.tgt_chat_agent_name(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.tgt_chat_agents where user_id = p_uid),
                  (select split_part(email, '@', 1) from public.tgt_admins where user_id = p_uid), '상담원');
$$;
revoke all on function public.tgt_chat_agent_name(uuid) from public;

create or replace function public.tgt_chat_admin_set_name(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  if v is not null and char_length(v) > 20 then raise exception 'invalid_name'; end if;
  insert into public.tgt_chat_agents (user_id, display_name) values (auth.uid(), v)
    on conflict (user_id) do update set display_name = excluded.display_name;
  update public.tgt_chat_sessions set assigned_name = public.tgt_chat_agent_name(auth.uid()) where assigned_to = auth.uid();
  return public.tgt_chat_agent_name(auth.uid());
end $$;

-- 상담원 온라인 표시: 상담원마다 따로 기록한다(한 명이 나가도 다른 상담원이 온라인이면 고객 화면은 "온라인")
create or replace function public.tgt_chat_admin_ping(p_online boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  insert into public.tgt_chat_agents (user_id, last_seen, online) values (auth.uid(), now(), coalesce(p_online, false))
    on conflict (user_id) do update set last_seen = now(), online = coalesce(p_online, false);
  -- 이전 버전 호환(단일 표시)
  update public.tgt_chat_presence set last_seen = case when p_online then now() else last_seen end where id = 1;
end $$;

-- 담당 지정: p_take=true면 내가 맡기(다른 상담원이 맡고 있으면 p_force=true일 때만), false면 담당 해제
create or replace function public.tgt_chat_admin_assign(p_session uuid, p_take boolean default true, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.tgt_chat_sessions%rowtype;
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  select * into v from public.tgt_chat_sessions where id = p_session for update;
  if not found then raise exception 'not_found'; end if;
  if p_take then
    if v.assigned_to is not null and v.assigned_to <> auth.uid() and not coalesce(p_force, false) then
      return jsonb_build_object('ok', false, 'assigned_to', v.assigned_to, 'assigned_name', v.assigned_name);
    end if;
    update public.tgt_chat_sessions set assigned_to = auth.uid(), assigned_name = public.tgt_chat_agent_name(auth.uid()), assigned_at = now() where id = p_session;
  else
    update public.tgt_chat_sessions set assigned_to = null, assigned_name = null, assigned_at = null where id = p_session;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── 3. 방문자 함수(성별·출발지역 추가, 대기 시간) ─────────────────
create or replace function public.tgt_chat_start(p_name text, p_phone text, p_consent_version text, p_marketing boolean, p_page text,
                                                 p_gender text, p_region_sido text, p_region_sigungu text)
returns table (session_id uuid, token text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_gender text := nullif(btrim(coalesce(p_gender, '')), '');
  v_sido text := nullif(left(btrim(coalesce(p_region_sido, '')), 20), '');
  v_sgg  text := nullif(left(btrim(coalesce(p_region_sigungu, '')), 20), '');
  v_id uuid; v_token text;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'invalid_name'; end if;
  if char_length(v_digits) < 8 or char_length(v_digits) > 15 or char_length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
  if v_gender is not null and v_gender not in ('남','여') then raise exception 'invalid_gender'; end if;
  if (select count(*) from public.tgt_chat_sessions s where s.phone = v_phone and s.created_at > now() - interval '10 minutes') >= 5 then raise exception 'rate_limit'; end if;
  if (select count(*) from public.tgt_chat_sessions s where s.created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limit'; end if;
  insert into public.tgt_chat_sessions (name, phone, page, consent_version, marketing_opt_in, unread_admin, gender, region_sido, region_sigungu, waiting_since)
    values (v_name, v_phone, left(coalesce(p_page, ''), 300), left(coalesce(p_consent_version, ''), 40), coalesce(p_marketing, false), 1, v_gender, v_sido, v_sgg, now())
    returning id, tgt_chat_sessions.token into v_id, v_token;
  insert into public.tgt_chat_messages (session_id, sender, body)
    values (v_id, 'system', '상담이 시작되었습니다.' || case when coalesce(p_page, '') <> '' then ' (방문 페이지: ' || left(p_page, 120) || ')' else '' end);
  return query select v_id, v_token;
end $$;
revoke all on function public.tgt_chat_start(text, text, text, boolean, text, text, text, text) from public;
grant execute on function public.tgt_chat_start(text, text, text, boolean, text, text, text, text) to anon, authenticated;

-- 이전 화면(성별·지역 없이) 호환: 기존 5개 인자 함수도 대기 시각을 남긴다
create or replace function public.tgt_chat_start(p_name text, p_phone text, p_consent_version text, p_marketing boolean, p_page text)
returns table (session_id uuid, token text)
language sql security definer set search_path = public as $$
  select * from public.tgt_chat_start(p_name, p_phone, p_consent_version, p_marketing, p_page, null::text, null::text, null::text);
$$;

create or replace function public.tgt_chat_send(p_token text, p_body text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_s public.tgt_chat_sessions%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  select * into v_s from public.tgt_chat_sessions where token = p_token;
  if not found then raise exception 'invalid_token'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'invalid_body'; end if;
  if (select count(*) from public.tgt_chat_messages m where m.session_id = v_s.id and m.sender = 'visitor' and m.created_at > now() - interval '1 minute') >= 20 then raise exception 'rate_limit'; end if;
  insert into public.tgt_chat_messages (session_id, sender, body) values (v_s.id, 'visitor', v_body) returning id into v_id;
  update public.tgt_chat_sessions
     set last_message_at = now(), unread_admin = unread_admin + 1,
         waiting_since = coalesce(waiting_since, now()),
         status = case when status = '종료' then '대기' else status end,
         closed_at = case when status = '종료' then null else closed_at end
   where id = v_s.id;
  return v_id;
end $$;

-- 고객 화면: 새 메시지 + 상태 + 상담원 온라인 + 답변 대기 경과(초)
create or replace function public.tgt_chat_poll(p_token text, p_after bigint default 0)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s public.tgt_chat_sessions%rowtype;
  v_online boolean;
  v_msgs jsonb;
begin
  select * into v_s from public.tgt_chat_sessions where token = p_token;
  if not found then return jsonb_build_object('error', 'invalid'); end if;
  update public.tgt_chat_sessions set visitor_seen_at = now() where id = v_s.id;
  select exists (select 1 from public.tgt_chat_agents where online and last_seen > now() - interval '90 seconds')
      or exists (select 1 from public.tgt_chat_presence where id = 1 and last_seen > now() - interval '90 seconds'
                   and not exists (select 1 from public.tgt_chat_agents))
    into v_online;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 't', m.created_at, 's', m.sender, 'b', m.body) order by m.id), '[]'::jsonb)
    into v_msgs
    from (select * from public.tgt_chat_messages where session_id = v_s.id and id > coalesce(p_after, 0) order by id limit 200) m;
  return jsonb_build_object('status', v_s.status, 'agent_online', v_online, 'messages', v_msgs,
    'wait_sec', case when v_s.waiting_since is null or v_s.status = '종료' then null else floor(extract(epoch from now() - v_s.waiting_since))::int end);
end $$;

-- ── 4. 상담원 함수(답변자 기록·첫 응답·대기 해제·담당 잠금) ────────────
-- 다른 상담원이 맡은 상담이면 p_force=true일 때만 답변(이때 담당이 나로 바뀜)
drop function if exists public.tgt_chat_admin_reply(uuid, text, boolean);
create or replace function public.tgt_chat_admin_reply(p_session uuid, p_body text, p_force boolean)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_s public.tgt_chat_sessions%rowtype;
  v_name text;
  v_id bigint;
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'invalid_body'; end if;
  select * into v_s from public.tgt_chat_sessions where id = p_session for update;
  if not found then raise exception 'not_found'; end if;
  if v_s.assigned_to is not null and v_s.assigned_to <> auth.uid() and not coalesce(p_force, false) then
    raise exception 'assigned_other:%', coalesce(v_s.assigned_name, '다른 상담원');
  end if;
  v_name := public.tgt_chat_agent_name(auth.uid());
  insert into public.tgt_chat_messages (session_id, sender, body, agent_id, agent_name) values (p_session, 'admin', v_body, auth.uid(), v_name) returning id into v_id;
  update public.tgt_chat_sessions
     set status = '상담중', unread_admin = 0, last_message_at = now(), closed_at = null, waiting_since = null,
         first_response_at = coalesce(first_response_at, now()),
         assigned_to = auth.uid(), assigned_name = v_name, assigned_at = case when assigned_to = auth.uid() then assigned_at else now() end
   where id = p_session;
  return v_id;
end $$;
-- 이전 화면 호환(2개 인자) — 담당이 없거나 내 상담일 때만 답변
create or replace function public.tgt_chat_admin_reply(p_session uuid, p_body text)
returns bigint
language sql security definer set search_path = public as $$
  select public.tgt_chat_admin_reply(p_session, p_body, false);
$$;

create or replace function public.tgt_chat_admin_close(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  insert into public.tgt_chat_messages (session_id, sender, body) values (p_session, 'system', '상담이 종료되었습니다. 이용해 주셔서 감사합니다.');
  update public.tgt_chat_sessions set status = '종료', unread_admin = 0, closed_at = now(), last_message_at = now(), waiting_since = null where id = p_session;
end $$;

revoke all on function public.tgt_chat_admin_set_name(text) from public;
revoke all on function public.tgt_chat_admin_assign(uuid, boolean, boolean) from public;
revoke all on function public.tgt_chat_admin_reply(uuid, text, boolean) from public;
revoke all on function public.tgt_chat_admin_reply(uuid, text) from public;
revoke all on function public.tgt_chat_admin_ping(boolean) from public;
revoke all on function public.tgt_chat_admin_close(uuid) from public;
grant execute on function public.tgt_chat_admin_set_name(text) to authenticated;
grant execute on function public.tgt_chat_admin_assign(uuid, boolean, boolean) to authenticated;
grant execute on function public.tgt_chat_admin_reply(uuid, text, boolean) to authenticated;
grant execute on function public.tgt_chat_admin_reply(uuid, text) to authenticated;
grant execute on function public.tgt_chat_admin_ping(boolean) to authenticated;
grant execute on function public.tgt_chat_admin_close(uuid) to authenticated;
revoke all on function public.tgt_chat_poll(text, bigint) from public;
revoke all on function public.tgt_chat_send(text, text) from public;
revoke all on function public.tgt_chat_start(text, text, text, boolean, text) from public;
grant execute on function public.tgt_chat_poll(text, bigint) to anon, authenticated;
grant execute on function public.tgt_chat_send(text, text) to anon, authenticated;
grant execute on function public.tgt_chat_start(text, text, text, boolean, text) to anon, authenticated;

-- ── 5. 2중 관리자 비밀번호(숫자 4자리, 모든 관리자 공용) ─────────────
-- 원문은 저장하지 않고 bcrypt 해시만 저장한다. 테이블은 아무도 직접 읽을 수 없고 아래 함수로만 확인·변경한다.
-- 10분 안에 5번 틀리면 그 계정은 10분 동안 확인할 수 없다.
-- 비밀번호를 잊었을 때: SQL Editor에서  delete from public.tgt_admin_pin;  실행 후 관리자 화면에서 새로 등록
create table if not exists public.tgt_admin_pin (
  id         integer primary key check (id = 1),
  pin_hash   text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists public.tgt_admin_pin_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid,
  email   text,
  action  text not null,
  ok      boolean not null
);
create index if not exists tgt_admin_pin_log_user_idx on public.tgt_admin_pin_log (user_id, at desc);
alter table public.tgt_admin_pin enable row level security;
alter table public.tgt_admin_pin_log enable row level security;
revoke all on public.tgt_admin_pin from anon, authenticated;
revoke all on public.tgt_admin_pin_log from anon, authenticated;
grant select on public.tgt_admin_pin_log to authenticated;
drop policy if exists "admins select pin log" on public.tgt_admin_pin_log;
create policy "admins select pin log" on public.tgt_admin_pin_log for select to authenticated using (public.tgt_is_admin());

create or replace function public._tgt_pin_log(p_action text, p_ok boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.tgt_admin_pin_log (user_id, email, action, ok)
  values (auth.uid(), (select email from public.tgt_admins where user_id = auth.uid()), left(coalesce(p_action, ''), 40), p_ok);
$$;
revoke all on function public._tgt_pin_log(text, boolean) from public;

create or replace function public._tgt_pin_locked()
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.tgt_admin_pin_log
           where user_id = auth.uid() and not ok and at > now() - interval '10 minutes') >= 5;
$$;
revoke all on function public._tgt_pin_locked() from public;

-- 등록 여부
create or replace function public.tgt_admin_pin_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object('set', exists (select 1 from public.tgt_admin_pin where id = 1),
                            'updated_at', (select updated_at from public.tgt_admin_pin where id = 1),
                            'locked', public._tgt_pin_locked());
end $$;

-- 확인(내보내기·초기화 전에 호출). p_action: 무엇을 하려는지(기록용)
create or replace function public.tgt_admin_pin_verify(p_pin text, p_action text default 'verify')
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_ok boolean;
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  if public._tgt_pin_locked() then raise exception 'locked'; end if;
  select pin_hash into v_hash from public.tgt_admin_pin where id = 1;
  if v_hash is null then raise exception 'not_set'; end if;
  v_ok := coalesce(p_pin, '') ~ '^[0-9]{4}$' and crypt(p_pin, v_hash) = v_hash;
  perform public._tgt_pin_log(coalesce(p_action, 'verify'), v_ok);
  return v_ok;
end $$;

-- 등록·변경: 처음이면 p_current 없이 등록, 이미 있으면 현재 비밀번호가 맞아야 변경
create or replace function public.tgt_admin_pin_set(p_current text, p_new text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  if coalesce(p_new, '') !~ '^[0-9]{4}$' then raise exception 'invalid_pin'; end if;
  if public._tgt_pin_locked() then raise exception 'locked'; end if;
  select pin_hash into v_hash from public.tgt_admin_pin where id = 1;
  if v_hash is not null and not (coalesce(p_current, '') ~ '^[0-9]{4}$' and crypt(p_current, v_hash) = v_hash) then
    perform public._tgt_pin_log('change', false);
    return false;
  end if;
  insert into public.tgt_admin_pin (id, pin_hash, updated_at, updated_by) values (1, crypt(p_new, gen_salt('bf')), now(), auth.uid())
    on conflict (id) do update set pin_hash = excluded.pin_hash, updated_at = now(), updated_by = auth.uid();
  perform public._tgt_pin_log(case when v_hash is null then 'register' else 'change' end, true);
  return true;
end $$;

-- 삭제: 현재 비밀번호가 맞아야 삭제
create or replace function public.tgt_admin_pin_clear(p_current text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  if public._tgt_pin_locked() then raise exception 'locked'; end if;
  select pin_hash into v_hash from public.tgt_admin_pin where id = 1;
  if v_hash is null then return true; end if;
  if not (coalesce(p_current, '') ~ '^[0-9]{4}$' and crypt(p_current, v_hash) = v_hash) then
    perform public._tgt_pin_log('delete', false);
    return false;
  end if;
  delete from public.tgt_admin_pin where id = 1;
  perform public._tgt_pin_log('delete', true);
  return true;
end $$;

revoke all on function public.tgt_admin_pin_status() from public;
revoke all on function public.tgt_admin_pin_verify(text, text) from public;
revoke all on function public.tgt_admin_pin_set(text, text) from public;
revoke all on function public.tgt_admin_pin_clear(text) from public;
grant execute on function public.tgt_admin_pin_status() to authenticated;
grant execute on function public.tgt_admin_pin_verify(text, text) to authenticated;
grant execute on function public.tgt_admin_pin_set(text, text) to authenticated;
grant execute on function public.tgt_admin_pin_clear(text) to authenticated;

-- 확인
select 'tgt_chat v2 columns' as item, count(*) as n from information_schema.columns
 where table_schema = 'public' and table_name = 'tgt_chat_sessions'
   and column_name in ('gender','region_sido','region_sigungu','memo','assigned_to','waiting_since','first_response_at','crm_consultation_id')
union all
select 'tgt_admin_pin table', count(*) from information_schema.tables where table_schema = 'public' and table_name = 'tgt_admin_pin';
