-- THE GOLF TREND — 홈페이지 방문 행동 분석 확장(행동 기록 종류 추가)
-- 먼저 docs/sql/2026-10-24_crm_core.sql 이 실행되어 있어야 합니다. Supabase SQL Editor에서 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다. 기존 기록·테이블은 그대로이며, 기록할 수 있는 행동 종류만 늘어납니다.
-- 되돌리기: docs/sql/2026-10-26_visitor_insights_rollback.sql
--
-- ■ 추가되는 행동 종류(모두 익명 — 이름·연락처·IP는 저장하지 않음)
--   page_view        : 방문 1회(탭 단위 1번) — 유입 경로(도메인만), 기기(모바일/PC), 광고 태그(utm)
--   category_view    : 국가·권역 카드 열기
--   recommend_search : AI 추천 검색 1회 — 고른 조건과 조건 충족 상품 수(공급 부족 분석용)
--   form_start       : 상담 신청서 작성 시작(첫 입력)
--   detail_view      : 상품 상세의 주요 영역(요금표·일정·포함사항 등)을 실제로 본 기록

alter table public.tgt_site_events drop constraint if exists tgt_site_events_event_type_check;
alter table public.tgt_site_events add constraint tgt_site_events_event_type_check
  check (event_type in ('recommend_view','recommend_click','recommend_inquiry','product_view','inquiry_submit',
                        'call_click','kakao_click','channel_click',
                        'page_view','category_view','recommend_search','form_start','detail_view'));

create index if not exists tgt_site_events_type_created_idx on public.tgt_site_events (event_type, created_at desc);

-- 확인: 허용된 행동 종류
select pg_get_constraintdef(oid) as allowed_event_types from pg_constraint where conname = 'tgt_site_events_event_type_check';
