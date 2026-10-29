-- THE GOLF TREND — 실시간 상담 2단계 되돌리기
-- docs/sql/2026-10-29_live_chat_v2.sql 로 추가한 함수·테이블·열을 지웁니다.
-- ⚠️ 성별·출발지역·메모·담당 상담원 기록과 2중 관리자 비밀번호가 삭제됩니다. 상담·대화 기록 자체는 남습니다.
-- ⚠️ 이 파일을 실행한 직후 반드시 docs/sql/2026-10-28_live_chat.sql 을 다시 실행하세요(1단계 함수가 원래대로 돌아옵니다).
--    그 전까지는 상담 시작·메시지 보내기가 실패합니다. 코드도 이전 버전으로 되돌려야 합니다.

drop function if exists public.tgt_chat_start(text, text, text, boolean, text, text, text, text);
drop function if exists public.tgt_chat_admin_reply(uuid, text, boolean);
drop function if exists public.tgt_chat_admin_assign(uuid, boolean, boolean);
drop function if exists public.tgt_chat_admin_set_name(text);
drop function if exists public.tgt_admin_pin_status();
drop function if exists public.tgt_admin_pin_verify(text, text);
drop function if exists public.tgt_admin_pin_set(text, text);
drop function if exists public.tgt_admin_pin_clear(text);
drop function if exists public._tgt_pin_log(text, boolean);
drop function if exists public._tgt_pin_locked();

drop function if exists public.tgt_chat_agent_name(uuid);
drop table if exists public.tgt_admin_pin;
drop table if exists public.tgt_admin_pin_log;
drop table if exists public.tgt_chat_agents;

alter table public.tgt_chat_sessions
  drop column if exists gender, drop column if exists region_sido, drop column if exists region_sigungu, drop column if exists memo,
  drop column if exists assigned_to, drop column if exists assigned_name, drop column if exists assigned_at,
  drop column if exists waiting_since, drop column if exists first_response_at, drop column if exists crm_consultation_id;
alter table public.tgt_chat_messages drop column if exists agent_id, drop column if exists agent_name;
