-- THE GOLF TREND — 상담·예약 데이터 통합 1단계 되돌리기(롤백)
-- ⚠ 상담·예약·운영 조건·행동 기록 테이블과 그 안의 데이터가 모두 삭제됩니다.
--   실행 전 관리자 패널 "상담·예약 → 백업 내보내기"로 데이터를 먼저 받아 두세요.
-- 기존 테이블(kundo_site_state, kundo_leads, channel_posts)의 데이터는 건드리지 않으며,
-- kundo_leads의 권한만 이전 상태(로그인 사용자 누구나 읽기·수정)로 되돌립니다.

do $$
begin
  if to_regclass('public.kundo_leads') is not null then
    execute 'drop policy if exists "admins can read leads" on public.kundo_leads';
    execute 'drop policy if exists "admins can update leads" on public.kundo_leads';
    execute 'drop policy if exists "authenticated can read leads" on public.kundo_leads';
    execute 'drop policy if exists "authenticated can update leads" on public.kundo_leads';
    execute 'create policy "authenticated can read leads" on public.kundo_leads for select to authenticated using (true)';
    execute 'create policy "authenticated can update leads" on public.kundo_leads for update to authenticated using (true) with check (true)';
  end if;
end $$;

drop policy if exists "tgt admins read booking imports" on storage.objects;
drop policy if exists "tgt admins upload booking imports" on storage.objects;
-- 저장소의 원본 파일까지 지우려면 Supabase 대시보드 Storage에서 tgt-booking-imports 버킷을 비운 뒤 삭제하세요.

drop table if exists public.tgt_link_suggestions;
drop table if exists public.tgt_booking_status_history;
drop table if exists public.tgt_consultation_revisions;
alter table if exists public.tgt_consultations drop constraint if exists tgt_consultations_booking_fk;
drop table if exists public.tgt_bookings;
drop table if exists public.tgt_consultations;
drop table if exists public.tgt_booking_imports;
drop table if exists public.tgt_departure_groups;
drop table if exists public.tgt_product_operating_rules;
drop table if exists public.tgt_site_events;
drop table if exists public.tgt_admin_access_logs;

drop function if exists public.tgt_consultation_guard();
drop function if exists public.tgt_booking_guard();
drop function if exists public.tgt_booking_history();
drop function if exists public.tgt_touch_updated_at();
drop table if exists public.tgt_admins;
drop function if exists public.tgt_is_admin();
