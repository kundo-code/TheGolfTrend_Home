-- 이미 channel_posts 표를 만들어 둔 경우: 네이버 블로그 카테고리 이름을 저장할 열 추가 (한 번만 실행)
-- Supabase SQL Editor에서 실행하세요. 기존 데이터는 그대로 유지됩니다.
-- 실행 후 관리자 패널에서 채널 카드의 "⟳ 전체"로 다시 수집하면 카테고리가 채워집니다.

alter table public.channel_posts add column if not exists category text not null default '';

comment on column public.channel_posts.category is '네이버 블로그 카테고리 이름 (예: 국내 패키지 여행). 여행 이야기 카드의 국내-블로그/해외-블로그 태그 구분에 사용.';
