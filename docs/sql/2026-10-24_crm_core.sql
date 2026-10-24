-- THE GOLF TREND — 상담·예약 데이터 통합 (1단계: 기반 테이블 · 관리자 권한)
-- Supabase 프로젝트(https://zjanojlayndtgmzohpyb.supabase.co)의 SQL Editor에서 한 번 실행하세요.
-- (anon publishable key만으로는 테이블/정책을 생성할 수 없어 코드에서 자동 실행되지 않습니다.)
--
-- ■ 기존 데이터 보호
--   · 기존 테이블(kundo_site_state, kundo_leads, channel_posts)의 구조·데이터는 바꾸지 않습니다.
--   · kundo_leads는 "읽기·수정 권한"만 허용된 관리자 계정으로 좁힙니다(홈페이지 상담 신청 저장은 그대로).
--   · 모든 문장은 여러 번 실행해도 안전합니다(if not exists / drop policy if exists).
--   · 되돌리기: docs/sql/2026-10-24_crm_core_rollback.sql
--
-- ■ 관리자 권한(단일 관리자)
--   · tgt_admins 에 등록된 Supabase 로그인 계정만 상담·예약·리드 데이터를 읽고 쓸 수 있습니다.
--   · 이 SQL을 실행하는 순간 "이미 존재하는 로그인 계정"은 모두 관리자로 등록됩니다(지금도 로그인하면 전체 권한이므로
--     기존 사용 방식이 그대로 유지되고, 실행 직후 잠기는 일이 없습니다). 이후에 새로 가입한 계정은 자동으로 관리자가 되지 않습니다.
--   · 실행 후 맨 아래 "관리자 목록 확인" 쿼리로 목록을 꼭 확인하고, 관리자가 아닌 계정이 있으면 삭제하세요.
--
-- ■ 시간 기준
--   · 일시(timestamptz)는 UTC로 저장되고 관리자 화면에서 한국 시간(Asia/Seoul)으로 표시합니다.
--   · 출발일처럼 날짜만 필요한 값은 date 타입입니다. 희망 출발 월은 그 달 1일(date)로 저장합니다.

-- ───────────────────────────────────────────────────────────────
-- 0. 관리자 목록과 판별 함수
-- ───────────────────────────────────────────────────────────────
create table if not exists public.tgt_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
comment on table public.tgt_admins is '상담·예약·리드 데이터에 접근할 수 있는 관리자 계정(단일 관리자 권한).';

-- 처음 실행할 때만(관리자 목록이 비어 있을 때) 기존 로그인 계정을 관리자로 등록해 현재 사용 방식을 유지한다.
-- 다시 실행해도 이미 정리한 관리자 목록에 계정이 되살아나지 않는다
insert into public.tgt_admins (user_id, email)
select u.id, u.email from auth.users u
where not exists (select 1 from public.tgt_admins)
on conflict (user_id) do nothing;

create or replace function public.tgt_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tgt_admins a where a.user_id = auth.uid());
$$;
revoke all on function public.tgt_is_admin() from public;
grant execute on function public.tgt_is_admin() to anon, authenticated;

alter table public.tgt_admins enable row level security;
drop policy if exists "admins read admins" on public.tgt_admins;
create policy "admins read admins" on public.tgt_admins for select to authenticated using (public.tgt_is_admin());

-- 공통: updated_at 자동 갱신
create or replace function public.tgt_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────────────────────────────────────────────
-- 1. 기존 AI 리드(kundo_leads) — 읽기·수정을 허용된 관리자로 제한(데이터·구조 변경 없음)
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.kundo_leads') is not null then
    execute 'drop policy if exists "authenticated can read leads" on public.kundo_leads';
    execute 'drop policy if exists "authenticated can update leads" on public.kundo_leads';
    execute 'drop policy if exists "admins can read leads" on public.kundo_leads';
    execute 'drop policy if exists "admins can update leads" on public.kundo_leads';
    execute 'create policy "admins can read leads" on public.kundo_leads for select to authenticated using (public.tgt_is_admin())';
    execute 'create policy "admins can update leads" on public.kundo_leads for update to authenticated using (public.tgt_is_admin()) with check (public.tgt_is_admin())';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────
-- 2. 출발 그룹 / 가져오기 기록 (예약이 참조하므로 먼저 생성)
-- ───────────────────────────────────────────────────────────────
create table if not exists public.tgt_departure_groups (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  product_uid      text,
  product_title    text,
  destination      text,
  departure_date   date,
  return_date      date,
  status           text not null default '준비중',          -- 준비중 | 확정 | 출발완료 | 취소
  vehicle_secured  boolean not null default false,
  transfer_secured boolean not null default false,
  rooms_secured    boolean not null default false,
  teetime_secured  boolean not null default false,
  memo             text
);
comment on table public.tgt_departure_groups is '출발 운영 그룹 — 여러 예약을 묶어 차량·송영·객실·티타임을 관리.';

create table if not exists public.tgt_booking_imports (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  file_name     text,
  file_sha256   text,                                    -- 같은 파일 재가져오기 방지용 지문
  storage_path  text,                                    -- 원본 파일 백업 위치(비공개 저장소)
  mapping       jsonb not null default '{}'::jsonb,       -- 열 이름 매핑
  total_rows    integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows  integer not null default 0,
  unchanged_rows integer not null default 0,
  error_rows    integer not null default 0,
  status        text not null default 'completed' check (status in ('completed','failed')),
  report        jsonb not null default '{}'::jsonb
);
create unique index if not exists tgt_booking_imports_file_once
  on public.tgt_booking_imports (file_sha256) where status = 'completed' and file_sha256 is not null;

-- ───────────────────────────────────────────────────────────────
-- 3. 상담 기록
-- ───────────────────────────────────────────────────────────────
create table if not exists public.tgt_consultations (
  id                        bigint generated always as identity primary key,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid default auth.uid(),
  consulted_at              timestamptz not null default now(),   -- 이번 상담 일시
  first_inquiry_at          timestamptz not null default now(),   -- 최초 문의 일시(후속 상담으로 덮어쓰지 않음)
  parent_id                 bigint references public.tgt_consultations(id) on delete set null, -- 후속 상담이면 최초 상담 id
  lead_id                   bigint,                               -- 홈페이지 리드(kundo_leads.id)에서 시작된 상담
  booking_id                bigint,                               -- 연결된 예약(tgt_bookings.id)
  is_deleted                boolean not null default false,
  -- 필수 3개
  product_uid               text,
  product_title             text,
  preferences               text[] not null default '{}',        -- 고객 핵심 취향
  result                    text not null,                        -- 상담 결과
  -- 상품 분류(통계용 스냅샷)
  product_cat               text,
  travel_region             text check (travel_region in ('domestic','overseas')),
  country                   text,
  destination               text,
  -- 선택 입력
  channel                   text,                                 -- 상담 경로
  customer_name             text,
  customer_phone            text,
  preferred_departure_month date,
  preferred_departure_date  date,
  date_flexibility          text,
  requested_party_size      integer check (requested_party_size is null or requested_party_size between 1 and 999),
  party_flexibility         text,
  join_group_preference     text,
  group_type                text,
  party_booking_barrier     text,
  budget_per_person         integer check (budget_per_person is null or budget_per_person >= 0),
  unbooked_reason           text,
  preference_note           text,
  memo                      text,
  ai_memo                   text,                                 -- AI 상담 메모 원문
  ai_parse                  jsonb                                 -- AI 분류 결과(관리자 확인 전 원본)
);
comment on table public.tgt_consultations is '상담 기록 — 필수: 상품·취향·결과. 최초 문의일은 변경 불가.';
create index if not exists tgt_consultations_consulted_idx on public.tgt_consultations (consulted_at desc);
create index if not exists tgt_consultations_first_idx on public.tgt_consultations (first_inquiry_at);
create index if not exists tgt_consultations_product_idx on public.tgt_consultations (product_uid);
create index if not exists tgt_consultations_lead_idx on public.tgt_consultations (lead_id);

create table if not exists public.tgt_consultation_revisions (
  id              bigint generated always as identity primary key,
  consultation_id bigint not null references public.tgt_consultations(id) on delete cascade,
  changed_at      timestamptz not null default now(),
  changed_by      uuid default auth.uid(),
  changed_fields  text[] not null default '{}',
  before          jsonb,
  after           jsonb
);
create index if not exists tgt_consultation_revisions_idx on public.tgt_consultation_revisions (consultation_id, changed_at desc);

-- 최초 문의일 보호 + 변경 이력 자동 기록
create or replace function public.tgt_consultation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[];
begin
  new.first_inquiry_at := old.first_inquiry_at;          -- 최초 문의일은 어떤 수정으로도 바뀌지 않음
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  select coalesce(array_agg(n.key order by n.key), '{}') into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value and n.key <> 'updated_at';
  if array_length(changed, 1) is not null then
    insert into public.tgt_consultation_revisions (consultation_id, changed_fields, before, after)
    values (old.id, changed, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists tgt_consultation_guard on public.tgt_consultations;
create trigger tgt_consultation_guard before update on public.tgt_consultations
  for each row execute function public.tgt_consultation_guard();

-- ───────────────────────────────────────────────────────────────
-- 4. 예약
-- ───────────────────────────────────────────────────────────────
create table if not exists public.tgt_bookings (
  id                       bigint generated always as identity primary key,
  booking_no               text not null,                         -- 예약번호(중복 불가)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  booking_status           text not null default '예약확정'
                             check (booking_status in ('예약대기','예약확정','예약취소','출발완료')),
  product_uid              text,
  product_title            text,
  product_cat              text,
  travel_region            text check (travel_region in ('domestic','overseas')),
  country                  text,
  destination              text,
  customer_name            text,
  customer_phone           text,
  confirmed_party_size     integer check (confirmed_party_size is null or confirmed_party_size between 0 and 999),
  actual_party_size        integer check (actual_party_size is null or actual_party_size between 0 and 999),
  confirmed_at             timestamptz,                            -- 최초 예약 확정 일시(자동, 이후 변경 불가)
  departure_date           date,                                   -- 현재 확정 출발일
  original_departure_date  date,                                   -- 최초 확정 출발일(자동, 이후 변경 불가)
  cancelled_at             timestamptz,
  cancellation_reason      text,
  actual_departed_at       timestamptz,                            -- 실제 출발 완료 확인(확인된 경우에만)
  source_channel           text,
  consultation_id          bigint references public.tgt_consultations(id) on delete set null,
  departure_group_id       bigint references public.tgt_departure_groups(id) on delete set null,
  import_id                bigint references public.tgt_booking_imports(id) on delete set null,
  raw                      jsonb,                                  -- 가져온 원본 행
  memo                     text
);
create unique index if not exists tgt_bookings_booking_no_key on public.tgt_bookings (booking_no);
create index if not exists tgt_bookings_departure_idx on public.tgt_bookings (departure_date);
create index if not exists tgt_bookings_product_idx on public.tgt_bookings (product_uid);
comment on table public.tgt_bookings is '예약 — 예약번호 기준 1건. 확정일·최초 출발일은 자동 기록되고 덮어쓰지 않음.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tgt_consultations_booking_fk') then
    alter table public.tgt_consultations
      add constraint tgt_consultations_booking_fk foreign key (booking_id) references public.tgt_bookings(id) on delete set null;
  end if;
end $$;

create table if not exists public.tgt_booking_status_history (
  id                  bigint generated always as identity primary key,
  booking_id          bigint not null references public.tgt_bookings(id) on delete cascade,
  changed_at          timestamptz not null default now(),
  changed_by          uuid default auth.uid(),
  from_status         text,
  to_status           text,
  from_departure_date date,
  to_departure_date   date,
  from_party_size     integer,
  to_party_size       integer,
  source              text                                        -- manual | import
);
create index if not exists tgt_booking_status_history_idx on public.tgt_booking_status_history (booking_id, changed_at desc);

-- 확정일·최초 출발일·취소일 자동 기록 + 상태/출발일/인원 변경 이력
create or replace function public.tgt_booking_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
    new.confirmed_at := coalesce(old.confirmed_at, new.confirmed_at);
    new.original_departure_date := coalesce(old.original_departure_date, new.original_departure_date);
  end if;
  if new.booking_status in ('예약확정','출발완료') and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  if new.confirmed_at is not null and new.original_departure_date is null then
    new.original_departure_date := new.departure_date;
  end if;
  if new.booking_status = '예약취소' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end $$;
drop trigger if exists tgt_booking_guard on public.tgt_bookings;
create trigger tgt_booking_guard before insert or update on public.tgt_bookings
  for each row execute function public.tgt_booking_guard();

create or replace function public.tgt_booking_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tgt_booking_status_history (booking_id, from_status, to_status, to_departure_date, to_party_size, source)
    values (new.id, null, new.booking_status, new.departure_date, new.confirmed_party_size,
            case when new.import_id is null then 'manual' else 'import' end);
  elsif new.booking_status is distinct from old.booking_status
     or new.departure_date is distinct from old.departure_date
     or new.confirmed_party_size is distinct from old.confirmed_party_size then
    insert into public.tgt_booking_status_history (booking_id, from_status, to_status, from_departure_date, to_departure_date, from_party_size, to_party_size, source)
    values (new.id, old.booking_status, new.booking_status, old.departure_date, new.departure_date, old.confirmed_party_size, new.confirmed_party_size,
            case when new.import_id is distinct from old.import_id then 'import' else 'manual' end);
  end if;
  return new;
end $$;
drop trigger if exists tgt_booking_history on public.tgt_bookings;
create trigger tgt_booking_history after insert or update on public.tgt_bookings
  for each row execute function public.tgt_booking_history();

-- 불확실한 상담 ↔ 예약 연결(관리자 승인 대기)
create table if not exists public.tgt_link_suggestions (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  consultation_id bigint not null references public.tgt_consultations(id) on delete cascade,
  booking_id      bigint not null references public.tgt_bookings(id) on delete cascade,
  score           numeric,
  reasons         text[] not null default '{}',
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at      timestamptz,
  decided_by      uuid
);
create unique index if not exists tgt_link_suggestions_pair on public.tgt_link_suggestions (consultation_id, booking_id);

-- ───────────────────────────────────────────────────────────────
-- 5. 상품 운영 조건(원가 포함 — 공개 사이트 설정과 분리해 관리자만 접근)
-- ───────────────────────────────────────────────────────────────
create table if not exists public.tgt_product_operating_rules (
  id                         bigint generated always as identity primary key,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  product_uid                text not null,
  product_title              text,
  party_size_from            integer,                              -- 이 조건이 적용되는 인원 구간(이상)
  party_size_to              integer,                              -- (이하)
  minimum_departure_size     integer,
  private_departure_min_size integer,
  join_group_allowed         boolean,
  small_group_surcharge      integer,
  vehicle_cost               integer,
  transfer_cost              integer,
  handling_cost              integer,
  maximum_group_capacity     integer,
  currency                   text not null default 'KRW',
  operating_rule_start_date  date,
  operating_rule_end_date    date,
  source                     text,                                 -- 조건 출처(랜드사·계약서 등)
  last_verified_at           timestamptz,
  memo                       text,
  check (operating_rule_end_date is null or operating_rule_start_date is null or operating_rule_end_date >= operating_rule_start_date),
  check (party_size_to is null or party_size_from is null or party_size_to >= party_size_from)
);
create index if not exists tgt_operating_rules_product_idx on public.tgt_product_operating_rules (product_uid);

-- ───────────────────────────────────────────────────────────────
-- 6. 홈페이지 행동 기록(익명, 개인정보 없음 — 방문자는 쓰기만)
-- ───────────────────────────────────────────────────────────────
create table if not exists public.tgt_site_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  session_id    text not null,
  event_type    text not null,
  product_uid   text,
  product_title text,
  product_cat   text,
  travel_region text,
  rank          integer,
  criteria      jsonb,
  page          text,
  check (char_length(session_id) <= 64),
  check (event_type in ('recommend_view','recommend_click','recommend_inquiry','product_view','inquiry_submit','call_click','kakao_click','channel_click')),
  check (product_title is null or char_length(product_title) <= 200),
  check (product_uid is null or char_length(product_uid) <= 64),
  check (page is null or char_length(page) <= 200),
  check (criteria is null or pg_column_size(criteria) <= 2000)
);
create index if not exists tgt_site_events_created_idx on public.tgt_site_events (created_at desc);

-- 관리자 접근 기록(개인정보 열람·내보내기)
create table if not exists public.tgt_admin_access_logs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid default auth.uid(),
  action     text not null,
  target     text,
  detail     jsonb
);

-- updated_at 트리거
drop trigger if exists tgt_touch_departure_groups on public.tgt_departure_groups;
create trigger tgt_touch_departure_groups before update on public.tgt_departure_groups for each row execute function public.tgt_touch_updated_at();
drop trigger if exists tgt_touch_operating_rules on public.tgt_product_operating_rules;
create trigger tgt_touch_operating_rules before update on public.tgt_product_operating_rules for each row execute function public.tgt_touch_updated_at();

-- ───────────────────────────────────────────────────────────────
-- 7. RLS — 모든 새 테이블은 허용된 관리자만(행동 기록은 방문자 쓰기만 추가 허용)
-- ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tgt_departure_groups','tgt_booking_imports','tgt_consultations','tgt_consultation_revisions',
                           'tgt_bookings','tgt_booking_status_history','tgt_link_suggestions','tgt_product_operating_rules',
                           'tgt_site_events','tgt_admin_access_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admins select" on public.%I', t);
    execute format('create policy "admins select" on public.%I for select to authenticated using (public.tgt_is_admin())', t);
  end loop;
  -- 쓰기(관리자): 이력 테이블은 트리거만 기록하므로 직접 쓰기 정책을 두지 않음
  foreach t in array array['tgt_departure_groups','tgt_booking_imports','tgt_consultations','tgt_bookings',
                           'tgt_link_suggestions','tgt_product_operating_rules']
  loop
    execute format('drop policy if exists "admins insert" on public.%I', t);
    execute format('drop policy if exists "admins update" on public.%I', t);
    execute format('drop policy if exists "admins delete" on public.%I', t);
    execute format('create policy "admins insert" on public.%I for insert to authenticated with check (public.tgt_is_admin())', t);
    execute format('create policy "admins update" on public.%I for update to authenticated using (public.tgt_is_admin()) with check (public.tgt_is_admin())', t);
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.tgt_is_admin())', t);
  end loop;
end $$;

drop policy if exists "admins insert" on public.tgt_admin_access_logs;
create policy "admins insert" on public.tgt_admin_access_logs for insert to authenticated with check (public.tgt_is_admin());

drop policy if exists "visitors insert events" on public.tgt_site_events;
create policy "visitors insert events" on public.tgt_site_events for insert to anon, authenticated with check (true);

-- 역할 권한(GRANT) — SQL Editor로 만든 테이블은 기본 권한이 빠질 수 있어 명시
grant usage on schema public to anon, authenticated;
grant select on public.tgt_admins to authenticated;
grant select, insert, update, delete on public.tgt_departure_groups, public.tgt_booking_imports, public.tgt_consultations,
  public.tgt_bookings, public.tgt_link_suggestions, public.tgt_product_operating_rules to authenticated;
grant select on public.tgt_consultation_revisions, public.tgt_booking_status_history, public.tgt_site_events to authenticated;
grant select, insert on public.tgt_admin_access_logs to authenticated;
grant insert on public.tgt_site_events to anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- 8. 예약 명단 원본 백업용 비공개 저장소
-- ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('tgt-booking-imports', 'tgt-booking-imports', false)
on conflict (id) do nothing;

drop policy if exists "tgt admins read booking imports" on storage.objects;
create policy "tgt admins read booking imports" on storage.objects for select to authenticated
  using (bucket_id = 'tgt-booking-imports' and public.tgt_is_admin());
drop policy if exists "tgt admins upload booking imports" on storage.objects;
create policy "tgt admins upload booking imports" on storage.objects for insert to authenticated
  with check (bucket_id = 'tgt-booking-imports' and public.tgt_is_admin());

-- ───────────────────────────────────────────────────────────────
-- 관리자 목록 확인 — 관리자가 아닌 계정이 보이면 아래처럼 삭제하세요
--   delete from public.tgt_admins where email = '관리자가아닌@example.com';
-- 새 관리자 추가(그 계정이 먼저 Supabase Auth에 존재해야 함)
--   insert into public.tgt_admins (user_id, email) select id, email from auth.users where email = '추가할@example.com';
-- ───────────────────────────────────────────────────────────────
select user_id, email, created_at from public.tgt_admins order by created_at;
