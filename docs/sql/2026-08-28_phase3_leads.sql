-- Phase 3: AI 추천 → 상담 문의(리드) 저장 테이블
-- Supabase 프로젝트(https://zjanojlayndtgmzohpyb.supabase.co)의 SQL Editor에서 한 번만 실행하세요.
-- (anon publishable key만으로는 테이블/정책을 생성할 수 없어 코드에서 자동 실행되지 않습니다.)

create table if not exists public.kundo_leads (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  destination text,
  departure_date text,
  party_size text,
  room_type text,
  stay_duration text,
  styles text,
  details text,
  source text not null default 'direct',        -- 'direct' | 'ai_recommend'
  recommended_product text,                       -- AI 추천에서 시작된 문의의 추천 상품명
  status text not null default '신규'             -- 신규 | 연락중 | 성사 | 보류 | 취소
);

comment on table public.kundo_leads is 'THE GOLF TREND 홈페이지 상담 신청(티타임 상담 탑승권) 리드. AI 추천 플로우에서 넘어온 문의는 source=ai_recommend.';

alter table public.kundo_leads enable row level security;

-- 방문자 누구나 상담 신청 폼을 통해 리드를 저장할 수 있어야 함 (읽기/수정은 불가)
drop policy if exists "public can insert leads" on public.kundo_leads;
create policy "public can insert leads"
  on public.kundo_leads for insert
  to anon
  with check (true);

-- 관리자(Supabase Auth 로그인 사용자)만 리드 목록을 조회
drop policy if exists "authenticated can read leads" on public.kundo_leads;
create policy "authenticated can read leads"
  on public.kundo_leads for select
  to authenticated
  using (true);

-- 관리자만 상태(status) 등을 변경 가능
drop policy if exists "authenticated can update leads" on public.kundo_leads;
create policy "authenticated can update leads"
  on public.kundo_leads for update
  to authenticated
  using (true)
  with check (true);

create index if not exists kundo_leads_created_at_idx on public.kundo_leads (created_at desc);

-- RLS 정책과 별개로, 역할 자체에 테이블 접근 권한(GRANT)이 없으면
-- "permission denied for table kundo_leads" (42501) 에러가 발생한다.
-- SQL Editor로 테이블을 직접 생성한 경우 이 기본 권한이 자동으로 부여되지 않을 수 있어 명시적으로 부여한다.
grant usage on schema public to anon, authenticated;
grant insert on public.kundo_leads to anon;
grant select, update on public.kundo_leads to authenticated;
