-- THE GOLF TREND — 방문 행동 분석 확장 되돌리기
-- ⚠ 새로 추가된 종류(page_view·category_view·recommend_search·form_start·detail_view)의 기록이 삭제됩니다.
delete from public.tgt_site_events where event_type in ('page_view','category_view','recommend_search','form_start','detail_view');
alter table public.tgt_site_events drop constraint if exists tgt_site_events_event_type_check;
alter table public.tgt_site_events add constraint tgt_site_events_event_type_check
  check (event_type in ('recommend_view','recommend_click','recommend_inquiry','product_view','inquiry_submit','call_click','kakao_click','channel_click'));
drop index if exists public.tgt_site_events_type_created_idx;
