-- 블로그·유튜브 채널 글/영상 전체 목록 저장 테이블
-- Supabase 프로젝트(https://zjanojlayndtgmzohpyb.supabase.co)의 SQL Editor에서 한 번만 실행하세요.
-- (anon publishable key만으로는 테이블/정책을 생성할 수 없어 코드에서 자동 실행되지 않습니다.)
--
-- 동작 방식
--  · 관리자(로그인 사용자)가 관리자 패널에서 수집하면 글/영상 목록(제목·링크·썸네일·날짜)만 이 테이블에 저장합니다.
--  · 방문자는 이 테이블을 "읽기만" 합니다. 방문자 브라우저가 블로그/유튜브를 직접 수집하지 않으므로 홈페이지 부담이 줄어듭니다.
--  · 태그·제목 덮어쓰기·연결 상품·숨김·추천 고정 같은 관리자 편집값은 기존처럼 사이트 설정(kundo_site_state)에 글 주소 단위로 저장됩니다.
--  · 이 테이블이 없으면 홈페이지는 자동으로 기존 방식(RSS 최신 글)으로 동작합니다.

create table if not exists public.channel_posts (
  link          text primary key,                 -- 정규화된 글/영상 주소 (예: https://blog.naver.com/thegolftrend/224285622579)
  channel_id    text not null,                    -- 관리자 패널 채널 ID (ch_...)
  type          text not null check (type in ('blog','youtube')),
  title         text not null default '',
  thumbnail     text not null default '',
  published_at  timestamptz,                      -- 글 작성/영상 게시 시각 (정렬 기준)
  post_no       text,                             -- 네이버 글 번호(logNo) 또는 유튜브 영상 ID
  category      text not null default '',         -- 네이버 블로그 카테고리 이름 (예: 국내 패키지 여행)
  updated_at    timestamptz not null default now()
);

comment on table public.channel_posts is 'THE GOLF TREND 여행 이야기 — 블로그·유튜브 채널에서 수집한 글/영상 목록(메타데이터만).';

create index if not exists channel_posts_published_idx on public.channel_posts (published_at desc nulls last);
create index if not exists channel_posts_channel_idx   on public.channel_posts (channel_id, published_at desc nulls last);

alter table public.channel_posts enable row level security;

-- 방문자 누구나 목록을 읽을 수 있음
drop policy if exists "public can read channel posts" on public.channel_posts;
create policy "public can read channel posts"
  on public.channel_posts for select
  to anon, authenticated
  using (true);

-- 관리자(Supabase Auth 로그인 사용자)만 추가·수정·삭제
drop policy if exists "authenticated can insert channel posts" on public.channel_posts;
create policy "authenticated can insert channel posts"
  on public.channel_posts for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated can update channel posts" on public.channel_posts;
create policy "authenticated can update channel posts"
  on public.channel_posts for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated can delete channel posts" on public.channel_posts;
create policy "authenticated can delete channel posts"
  on public.channel_posts for delete
  to authenticated
  using (true);

-- SQL Editor로 만든 테이블은 기본 권한(GRANT)이 빠질 수 있어 명시적으로 부여
grant usage on schema public to anon, authenticated;
grant select on public.channel_posts to anon;
grant select, insert, update, delete on public.channel_posts to authenticated;
