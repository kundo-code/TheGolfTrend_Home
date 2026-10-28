-- THE GOLF TREND — 실시간 상담 채팅
-- 먼저 docs/sql/2026-10-24_crm_core.sql 이 실행되어 있어야 합니다(관리자 확인 함수 tgt_is_admin() 사용).
-- Supabase SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- 되돌리기: docs/sql/2026-10-28_live_chat_rollback.sql
--
-- ■ 구조
--   tgt_chat_sessions : 상담 1건(고객 이름·연락처·동의 기록·상태·안 읽은 메시지 수)
--   tgt_chat_messages : 대화 메시지(고객 / 상담원 / 시스템)
--   tgt_chat_presence : 상담원 온라인 표시(마지막 확인 시각)
-- ■ 보안
--   - 세 테이블 모두 RLS를 켜고 방문자(anon)에게는 직접 접근 권한을 주지 않습니다.
--   - 방문자는 아래 함수(tgt_chat_start/send/poll)로만 대화하며, 함수마다 "상담 시작 때 발급된 비밀 토큰"을 확인해
--     자기 상담 내용만 읽고 쓸 수 있습니다(다른 사람의 상담·연락처는 볼 수 없음). 도배 방지(분당 횟수 제한)도 포함됩니다.
--   - 상담원(관리자)은 tgt_is_admin()으로 허용된 계정만 조회·답변·종료·삭제할 수 있습니다.

create table if not exists public.tgt_chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique
                    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  name            text not null,
  phone           text not null,
  page            text,
  consent_at      timestamptz not null default now(),
  consent_version text,
  marketing_opt_in boolean not null default false,
  status          text not null default '대기' check (status in ('대기','상담중','종료')),
  unread_admin    integer not null default 0,
  visitor_seen_at timestamptz,
  closed_at       timestamptz
);
create index if not exists tgt_chat_sessions_last_idx on public.tgt_chat_sessions (last_message_at desc);
create index if not exists tgt_chat_sessions_phone_idx on public.tgt_chat_sessions (phone, created_at desc);

create table if not exists public.tgt_chat_messages (
  id         bigint generated always as identity primary key,
  session_id uuid not null references public.tgt_chat_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  sender     text not null check (sender in ('visitor','admin','system')),
  body       text not null check (char_length(body) between 1 and 2000)
);
create index if not exists tgt_chat_messages_session_idx on public.tgt_chat_messages (session_id, id);

create table if not exists public.tgt_chat_presence (
  id        integer primary key check (id = 1),
  last_seen timestamptz not null default now()
);
insert into public.tgt_chat_presence (id, last_seen) values (1, now() - interval '1 day')
  on conflict (id) do nothing;

alter table public.tgt_chat_sessions enable row level security;
alter table public.tgt_chat_messages enable row level security;
alter table public.tgt_chat_presence enable row level security;

-- 방문자(anon)는 테이블에 직접 접근할 수 없다
revoke all on public.tgt_chat_sessions, public.tgt_chat_messages, public.tgt_chat_presence from anon;
grant select, update, delete on public.tgt_chat_sessions to authenticated;
grant select, insert, delete on public.tgt_chat_messages to authenticated;
grant select on public.tgt_chat_presence to authenticated;

drop policy if exists "admins select sessions" on public.tgt_chat_sessions;
drop policy if exists "admins update sessions" on public.tgt_chat_sessions;
drop policy if exists "admins delete sessions" on public.tgt_chat_sessions;
create policy "admins select sessions" on public.tgt_chat_sessions for select to authenticated using (public.tgt_is_admin());
create policy "admins update sessions" on public.tgt_chat_sessions for update to authenticated using (public.tgt_is_admin()) with check (public.tgt_is_admin());
create policy "admins delete sessions" on public.tgt_chat_sessions for delete to authenticated using (public.tgt_is_admin());

drop policy if exists "admins select messages" on public.tgt_chat_messages;
drop policy if exists "admins insert messages" on public.tgt_chat_messages;
drop policy if exists "admins delete messages" on public.tgt_chat_messages;
create policy "admins select messages" on public.tgt_chat_messages for select to authenticated using (public.tgt_is_admin());
create policy "admins insert messages" on public.tgt_chat_messages for insert to authenticated with check (public.tgt_is_admin());
create policy "admins delete messages" on public.tgt_chat_messages for delete to authenticated using (public.tgt_is_admin());

drop policy if exists "admins select presence" on public.tgt_chat_presence;
create policy "admins select presence" on public.tgt_chat_presence for select to authenticated using (public.tgt_is_admin());

-- ── 방문자용 함수 ───────────────────────────────────────────────

-- 상담 시작: 이름·연락처·동의가 있어야 하며, 같은 연락처로 10분에 5건 넘게 만들 수 없다
create or replace function public.tgt_chat_start(p_name text, p_phone text, p_consent_version text, p_marketing boolean, p_page text)
returns table (session_id uuid, token text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_id uuid; v_token text;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'invalid_name'; end if;
  if char_length(v_digits) < 8 or char_length(v_digits) > 15 or char_length(v_phone) > 30 then raise exception 'invalid_phone'; end if;
  if (select count(*) from public.tgt_chat_sessions s where s.phone = v_phone and s.created_at > now() - interval '10 minutes') >= 5 then raise exception 'rate_limit'; end if;
  if (select count(*) from public.tgt_chat_sessions s where s.created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limit'; end if;
  insert into public.tgt_chat_sessions (name, phone, page, consent_version, marketing_opt_in, unread_admin)
    values (v_name, v_phone, left(coalesce(p_page, ''), 300), left(coalesce(p_consent_version, ''), 40), coalesce(p_marketing, false), 1)
    returning id, tgt_chat_sessions.token into v_id, v_token;
  insert into public.tgt_chat_messages (session_id, sender, body)
    values (v_id, 'system', '상담이 시작되었습니다.' || case when coalesce(p_page, '') <> '' then ' (방문 페이지: ' || left(p_page, 120) || ')' else '' end);
  return query select v_id, v_token;
end $$;

-- 고객 메시지 보내기
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
         status = case when status = '종료' then '대기' else status end,
         closed_at = case when status = '종료' then null else closed_at end
   where id = v_s.id;
  return v_id;
end $$;

-- 새 메시지·상담 상태·상담원 온라인 여부 가져오기(고객 화면이 몇 초마다 호출)
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
  select exists (select 1 from public.tgt_chat_presence where id = 1 and last_seen > now() - interval '90 seconds') into v_online;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 't', m.created_at, 's', m.sender, 'b', m.body) order by m.id), '[]'::jsonb)
    into v_msgs
    from (select * from public.tgt_chat_messages where session_id = v_s.id and id > coalesce(p_after, 0) order by id limit 200) m;
  return jsonb_build_object('status', v_s.status, 'agent_online', v_online, 'messages', v_msgs);
end $$;

revoke all on function public.tgt_chat_start(text, text, text, boolean, text) from public;
revoke all on function public.tgt_chat_send(text, text) from public;
revoke all on function public.tgt_chat_poll(text, bigint) from public;
grant execute on function public.tgt_chat_start(text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.tgt_chat_send(text, text) to anon, authenticated;
grant execute on function public.tgt_chat_poll(text, bigint) to anon, authenticated;

-- ── 상담원(관리자)용 함수 ─────────────────────────────────────────

-- 상담원 온라인 표시(관리자 화면이 30초마다 호출). p_online=false면 오프라인으로 표시
create or replace function public.tgt_chat_admin_ping(p_online boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  update public.tgt_chat_presence set last_seen = case when p_online then now() else now() - interval '1 day' end where id = 1;
end $$;

-- 상담원 답변(상태를 '상담중'으로, 안 읽음 0으로)
create or replace function public.tgt_chat_admin_reply(p_session uuid, p_body text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'invalid_body'; end if;
  insert into public.tgt_chat_messages (session_id, sender, body) values (p_session, 'admin', v_body) returning id into v_id;
  update public.tgt_chat_sessions set status = '상담중', unread_admin = 0, last_message_at = now(), closed_at = null where id = p_session;
  return v_id;
end $$;

-- 상담 종료(고객 화면에 안내 메시지)
create or replace function public.tgt_chat_admin_close(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tgt_is_admin() then raise exception 'forbidden'; end if;
  insert into public.tgt_chat_messages (session_id, sender, body) values (p_session, 'system', '상담이 종료되었습니다. 이용해 주셔서 감사합니다.');
  update public.tgt_chat_sessions set status = '종료', unread_admin = 0, closed_at = now(), last_message_at = now() where id = p_session;
end $$;

revoke all on function public.tgt_chat_admin_ping(boolean) from public;
revoke all on function public.tgt_chat_admin_reply(uuid, text) from public;
revoke all on function public.tgt_chat_admin_close(uuid) from public;
grant execute on function public.tgt_chat_admin_ping(boolean) to authenticated;
grant execute on function public.tgt_chat_admin_reply(uuid, text) to authenticated;
grant execute on function public.tgt_chat_admin_close(uuid) to authenticated;

-- 확인
select 'tgt_chat tables' as item, count(*) as n from information_schema.tables where table_schema = 'public' and table_name like 'tgt_chat_%';
