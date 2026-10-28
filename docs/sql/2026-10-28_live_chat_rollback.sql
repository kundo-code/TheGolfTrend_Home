-- 실시간 상담 채팅 되돌리기 — 대화 기록(고객 이름·연락처 포함)이 모두 삭제됩니다. 필요하면 먼저 내려받아 보관하세요.
drop function if exists public.tgt_chat_admin_close(uuid);
drop function if exists public.tgt_chat_admin_reply(uuid, text);
drop function if exists public.tgt_chat_admin_ping(boolean);
drop function if exists public.tgt_chat_poll(text, bigint);
drop function if exists public.tgt_chat_send(text, text);
drop function if exists public.tgt_chat_start(text, text, text, boolean, text);
drop table if exists public.tgt_chat_messages;
drop table if exists public.tgt_chat_sessions;
drop table if exists public.tgt_chat_presence;
