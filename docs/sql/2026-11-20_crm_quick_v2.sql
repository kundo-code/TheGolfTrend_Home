-- THE GOLF TREND — 상담·예약 "빠른 기록" 개선 (거래처·담당자·상담 분류 + 새 입력 항목)
-- Supabase SQL Editor에서 한 번 실행하세요. (먼저 2026-10-24_crm_core.sql이 적용되어 있어야 합니다.)
--
-- ■ 기존 데이터 보호
--   · 기존 상담·예약 기록의 값은 바꾸지 않습니다(새 칸만 추가, 기존 행의 새 칸은 비어 있음).
--   · 모든 문장은 여러 번 실행해도 안전합니다(if not exists / drop policy if exists).
--   · 처음 목록(거래처·상담 분류)은 "테이블이 비어 있을 때 한 번만" 넣습니다 — 나중에 관리자가 지운 항목이 다시 생기지 않습니다.
--   · 되돌리기: docs/sql/2026-11-20_crm_quick_v2_rollback.sql
--
-- ■ 새로 생기는 것
--   · tgt_partners          거래처 목록(순서 포함)
--   · tgt_partner_contacts  담당자 목록(거래처 연결·연락처·순서 포함)
--   · tgt_consult_categories 상담 분류 옵션(순서 포함)
--   · 상담 기록(tgt_consultations): 거래처·담당자·담당자 연락처·상담 분류·요청사항 간단메모·체류기간
--   · 예약(tgt_bookings): 위 항목 중 거래처·담당자·담당자 연락처·상담 분류·요청사항 간단메모·체류기간

-- ───────────────────────────────────────────────────────────
-- 1. 거래처 · 담당자 · 상담 분류 옵션 (관리자 전용)
-- ───────────────────────────────────────────────────────────
create table if not exists public.tgt_partners (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name       text not null,
  sort_order integer not null default 0,
  check (char_length(btrim(name)) between 1 and 80)
);
create unique index if not exists tgt_partners_name_key on public.tgt_partners (lower(btrim(name)));
create index if not exists tgt_partners_sort_idx on public.tgt_partners (sort_order, id);
comment on table public.tgt_partners is '거래처 — 빠른 기록에서 선택하는 거래처 목록(드래그 순서 = sort_order).';

create table if not exists public.tgt_partner_contacts (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  partner_id bigint references public.tgt_partners(id) on delete cascade,
  name       text not null,
  phone      text,
  sort_order integer not null default 0,
  check (char_length(btrim(name)) between 1 and 80),
  check (phone is null or char_length(phone) <= 40)
);
create index if not exists tgt_partner_contacts_partner_idx on public.tgt_partner_contacts (partner_id, sort_order, id);
comment on table public.tgt_partner_contacts is '거래처 담당자 — 선택하면 연락처가 자동 입력된다.';

create table if not exists public.tgt_consult_categories (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  value      text not null,
  sort_order integer not null default 0,
  check (char_length(btrim(value)) between 1 and 40)
);
create unique index if not exists tgt_consult_categories_value_key on public.tgt_consult_categories (lower(btrim(value)));
create index if not exists tgt_consult_categories_sort_idx on public.tgt_consult_categories (sort_order, id);
comment on table public.tgt_consult_categories is '상담 분류 옵션 — 빠른 기록의 "상담 분류" 선택지.';

drop trigger if exists tgt_touch_partners on public.tgt_partners;
create trigger tgt_touch_partners before update on public.tgt_partners for each row execute function public.tgt_touch_updated_at();
drop trigger if exists tgt_touch_partner_contacts on public.tgt_partner_contacts;
create trigger tgt_touch_partner_contacts before update on public.tgt_partner_contacts for each row execute function public.tgt_touch_updated_at();
drop trigger if exists tgt_touch_consult_categories on public.tgt_consult_categories;
create trigger tgt_touch_consult_categories before update on public.tgt_consult_categories for each row execute function public.tgt_touch_updated_at();

-- ───────────────────────────────────────────────────────────
-- 2. 상담·예약에 새 입력 칸 추가 (기존 값은 그대로)
--    거래처·담당자·분류는 "기록 당시의 이름"을 글자로 남깁니다(나중에 목록에서 이름을 바꾸거나 지워도 과거 기록은 그대로).
-- ───────────────────────────────────────────────────────────
alter table public.tgt_consultations add column if not exists partner_name    text;
alter table public.tgt_consultations add column if not exists contact_name    text;
alter table public.tgt_consultations add column if not exists contact_phone   text;
alter table public.tgt_consultations add column if not exists consult_category text;
alter table public.tgt_consultations add column if not exists request_note    text;
alter table public.tgt_consultations add column if not exists stay_period     text;

alter table public.tgt_bookings add column if not exists partner_name    text;
alter table public.tgt_bookings add column if not exists contact_name    text;
alter table public.tgt_bookings add column if not exists contact_phone   text;
alter table public.tgt_bookings add column if not exists consult_category text;
alter table public.tgt_bookings add column if not exists request_note    text;
alter table public.tgt_bookings add column if not exists stay_period     text;

create index if not exists tgt_consultations_partner_idx on public.tgt_consultations (partner_name);

-- ───────────────────────────────────────────────────────────
-- 3. RLS — 허용된 관리자만 읽기·쓰기
-- ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tgt_partners','tgt_partner_contacts','tgt_consult_categories']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admins select" on public.%I', t);
    execute format('drop policy if exists "admins insert" on public.%I', t);
    execute format('drop policy if exists "admins update" on public.%I', t);
    execute format('drop policy if exists "admins delete" on public.%I', t);
    execute format('create policy "admins select" on public.%I for select to authenticated using (public.tgt_is_admin())', t);
    execute format('create policy "admins insert" on public.%I for insert to authenticated with check (public.tgt_is_admin())', t);
    execute format('create policy "admins update" on public.%I for update to authenticated using (public.tgt_is_admin()) with check (public.tgt_is_admin())', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.tgt_is_admin())', t);
  end loop;
end $$;

grant select, insert, update, delete on public.tgt_partners, public.tgt_partner_contacts, public.tgt_consult_categories to authenticated;

-- ───────────────────────────────────────────────────────────
-- 4. 처음 목록(테이블이 비어 있을 때 한 번만)
-- ───────────────────────────────────────────────────────────
insert into public.tgt_partners (name, sort_order)
select v.name, v.ord
from unnest(array[
  '골프트렌드','가예약','예약취소','골프와사람','꿈에그린','부산그린','블루밍','와골프','엘리트골프','SGL(김영훈)',
  'OK버디(선경)','자이언트','캐슬투어','OK투어','가자골프','권우현골프','골프로','골프스토리(엄창용)','골프어때','골프여행닷컴',
  '나이스골프','다음여행사','다해드림','대원투어','더블엠(권미순)','보물섬','소현투어','에버그린','인그립','골프스케치',
  '프리미엄','투어몬','에이온투어','컴팩트투어','조희준','밀리토피아투어','에이플러스'
]) with ordinality as v(name, ord)
where not exists (select 1 from public.tgt_partners);

insert into public.tgt_consult_categories (value, sort_order)
select v.value, v.ord
from unnest(array[
  '예약확정','예약진행중','보류','견적문의','미예약','단순문의','단체문의','기업문의','예약취소·변경','결제 · 환급 · 환불'
]) with ordinality as v(value, ord)
where not exists (select 1 from public.tgt_consult_categories);

-- 확인
select (select count(*) from public.tgt_partners) as partners,
       (select count(*) from public.tgt_partner_contacts) as contacts,
       (select count(*) from public.tgt_consult_categories) as categories;
