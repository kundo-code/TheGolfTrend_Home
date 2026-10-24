-- THE GOLF TREND — AI 멀티 큐레이션 추가분 되돌리기
-- ⚠ 상품별 매출총이익·만족도 입력값(tgt_product_strategy)이 삭제됩니다. 상품 정보의 판매 전략 등급(salesTier)은 그대로 남습니다.
drop function if exists public.tgt_recommend_exposure(integer);
drop table if exists public.tgt_product_strategy;
