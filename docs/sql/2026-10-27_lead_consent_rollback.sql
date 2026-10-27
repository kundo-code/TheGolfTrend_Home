-- 되돌리기: 동의 기록 칸 삭제 — 이미 저장된 동의 기록·접수번호도 함께 사라집니다(법적 증빙이므로 필요하면 먼저 백업하세요)
do $$
begin
  if to_regclass('public.kundo_leads') is not null then
    execute 'drop index if exists public.kundo_leads_receipt_no_idx';
    execute 'alter table public.kundo_leads drop column if exists consent_at';
    execute 'alter table public.kundo_leads drop column if exists consent_version';
    execute 'alter table public.kundo_leads drop column if exists marketing_opt_in';
    execute 'alter table public.kundo_leads drop column if exists receipt_no';
  end if;
end $$;
