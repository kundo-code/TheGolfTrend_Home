-- 상담 신청(kundo_leads) 개인정보 수집·이용 동의 기록 칸 추가
-- 기존 데이터·정책은 그대로 두고 비어 있는(null) 칸만 더합니다. Supabase SQL Editor에서 한 번 실행하세요.
-- (실행 전에도 홈페이지는 정상 접수됩니다 — 이 칸이 없으면 동의 기록이 "세부 요청" 끝에 문장으로 남습니다.)

do $$
begin
  if to_regclass('public.kundo_leads') is not null then
    execute 'alter table public.kundo_leads add column if not exists consent_at timestamptz';
    execute 'alter table public.kundo_leads add column if not exists consent_version text';
    execute 'alter table public.kundo_leads add column if not exists marketing_opt_in boolean';
    execute 'alter table public.kundo_leads add column if not exists receipt_no text';
    execute 'create index if not exists kundo_leads_receipt_no_idx on public.kundo_leads (receipt_no)';
    execute 'comment on column public.kundo_leads.consent_at is ''개인정보 수집·이용(필수) 동의 일시''';
    execute 'comment on column public.kundo_leads.consent_version is ''동의 문구 버전(홈페이지 LEAD_CONSENT.version)''';
    execute 'comment on column public.kundo_leads.marketing_opt_in is ''소식·혜택 안내 수신(선택) 동의 여부''';
    execute 'comment on column public.kundo_leads.receipt_no is ''접수번호(고객에게 안내 — 카카오톡 문의와 연결용)''';
  end if;
end $$;

-- 확인: 4개 칸(consent_at, consent_version, marketing_opt_in, receipt_no)이 보이면 정상
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='kundo_leads'
   and column_name in ('consent_at','consent_version','marketing_opt_in','receipt_no') order by column_name;
