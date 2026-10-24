-- THE GOLF TREND — AI 멀티 큐레이션(추천·판매 전략) 추가분
-- 먼저 docs/sql/2026-10-24_crm_core.sql 이 실행되어 있어야 합니다. Supabase SQL Editor에서 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다. 기존 테이블·데이터는 바꾸지 않습니다. 되돌리기: docs/sql/2026-10-25_curation_rollback.sql
--
-- ■ 무엇을 추가하나
--   1) tgt_product_strategy — 상품별 1인 예상 매출총이익·고객 만족도(관리자 전용). 홈페이지에는 공개되지 않습니다.
--      홈페이지 추천에는 관리자가 정한 "판매 전략 등급(핵심/일반/틈새)"만 상품 정보에 저장되어 쓰입니다.
--   2) tgt_recommend_exposure(일수) — 최근 N일 동안 상품별 AI 추천 "노출 횟수 합계"만 돌려주는 함수.
--      방문자 화면이 노출이 적었던 상품에 판매 기회를 주는 데 씁니다. 세션·시간·개인정보는 돌려주지 않습니다.

-- 1) 상품별 판매 전략 정보(관리자 전용)
create table if not exists public.tgt_product_strategy (
  product_uid              text primary key,
  product_title            text,
  gross_margin_per_person  numeric,            -- 1인 예상 매출총이익(원). 관리자 입력값
  currency                 text not null default 'KRW',
  satisfaction             numeric(2,1),       -- 고객 만족도(1.0~5.0). 관리자 입력값(후기·설문 등)
  satisfaction_source      text,               -- 만족도 근거(예: 2026 상반기 출발 고객 설문 12건)
  memo                     text,
  updated_at               timestamptz not null default now(),
  updated_by               uuid default auth.uid(),
  check (satisfaction is null or (satisfaction >= 1 and satisfaction <= 5)),
  check (product_title is null or char_length(product_title) <= 200)
);
drop trigger if exists tgt_touch_product_strategy on public.tgt_product_strategy;
create trigger tgt_touch_product_strategy before update on public.tgt_product_strategy for each row execute function public.tgt_touch_updated_at();

alter table public.tgt_product_strategy enable row level security;
drop policy if exists "admins select" on public.tgt_product_strategy;
drop policy if exists "admins insert" on public.tgt_product_strategy;
drop policy if exists "admins update" on public.tgt_product_strategy;
drop policy if exists "admins delete" on public.tgt_product_strategy;
create policy "admins select" on public.tgt_product_strategy for select to authenticated using (public.tgt_is_admin());
create policy "admins insert" on public.tgt_product_strategy for insert to authenticated with check (public.tgt_is_admin());
create policy "admins update" on public.tgt_product_strategy for update to authenticated using (public.tgt_is_admin()) with check (public.tgt_is_admin());
create policy "admins delete" on public.tgt_product_strategy for delete to authenticated using (public.tgt_is_admin());
grant select, insert, update, delete on public.tgt_product_strategy to authenticated;

-- 2) 상품별 최근 추천 노출 수(합계만) — 방문자도 호출 가능
create or replace function public.tgt_recommend_exposure(p_days integer default 30)
returns table (product_uid text, views bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.product_uid, count(*)::bigint as views
  from public.tgt_site_events e
  where e.event_type = 'recommend_view'
    and e.product_uid is not null
    and e.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
  group by e.product_uid
$$;
revoke all on function public.tgt_recommend_exposure(integer) from public;
grant execute on function public.tgt_recommend_exposure(integer) to anon, authenticated;

-- 확인: 함수가 동작하는지(아직 기록이 없으면 빈 결과가 정상)
select * from public.tgt_recommend_exposure(30) limit 5;
