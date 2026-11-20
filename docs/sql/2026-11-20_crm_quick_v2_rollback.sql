-- THE GOLF TREND — 빠른 기록 개선(2026-11-20_crm_quick_v2.sql) 되돌리기
-- ⚠ 거래처·담당자·상담 분류 목록과, 상담·예약에 새로 저장된 거래처·담당자·분류·요청사항·체류기간 값이 삭제됩니다.
--   실행 전 관리자 패널 "상담·예약 → 연결 점검 → 백업 내보내기"로 데이터를 먼저 받아 두세요.
-- 기존 상담·예약의 나머지 값은 그대로입니다.

drop index if exists public.tgt_consultations_partner_idx;

alter table public.tgt_consultations drop column if exists partner_name;
alter table public.tgt_consultations drop column if exists contact_name;
alter table public.tgt_consultations drop column if exists contact_phone;
alter table public.tgt_consultations drop column if exists consult_category;
alter table public.tgt_consultations drop column if exists request_note;
alter table public.tgt_consultations drop column if exists stay_period;

alter table public.tgt_bookings drop column if exists partner_name;
alter table public.tgt_bookings drop column if exists contact_name;
alter table public.tgt_bookings drop column if exists contact_phone;
alter table public.tgt_bookings drop column if exists consult_category;
alter table public.tgt_bookings drop column if exists request_note;
alter table public.tgt_bookings drop column if exists stay_period;

drop table if exists public.tgt_partner_contacts;
drop table if exists public.tgt_partners;
drop table if exists public.tgt_consult_categories;
