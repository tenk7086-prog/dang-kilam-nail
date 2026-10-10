-- Chạy trong SQL Editor SAU migration GĐ2, deploy function và cài Secrets.
-- Trước hết tạo 2 Vault secrets trong Dashboard:
-- dkn_project_url = https://YOUR_PROJECT_REF.supabase.co
-- dkn_worker_token = GIỐNG HỆT CALENDAR_WORKER_TOKEN trong Edge Secrets.
-- Không viết giá trị token vào file này hoặc vào GitHub.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
 if (select count(*) from vault.decrypted_secrets where name in ('dkn_project_url','dkn_worker_token'))<>2
 then raise exception 'Cần tạo đủ 2 Vault secrets dkn_project_url và dkn_worker_token'; end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='dkn_worker_token') !~ '^[0-9a-f]{64}$'
 then raise exception 'Worker token phải có 64 ký tự hex thường'; end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='dkn_project_url') !~ '^https://[a-z0-9]+\.supabase\.co$'
 then raise exception 'Sai project URL'; end if;
end $$;
create or replace function nail_private.dispatch_calendar() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Không gọi Edge lúc không có việc, giảm invocation và truy cập không cần thiết.
 if exists(select 1 from nail_private.calendar_jobs where
   (processed_version<desired_version or reconcile_at<=now()) and next_attempt_at<=now()
   and (leased_until is null or leased_until<now())) then
   perform net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='dkn_project_url')||'/functions/v1/calendar-worker',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='dkn_worker_token')),
    body:='{}'::jsonb,timeout_milliseconds:=120000);
 end if;
end $$;
revoke all on function nail_private.dispatch_calendar() from public,anon,authenticated,service_role;
-- Chạy lặp installer chỉ thay 3 job của dự án này, không đụng cron khác.
do $$ declare item record; begin
 for item in select jobid from cron.job where jobname in ('dkn-calendar-minute','dkn-refresh-slots','dkn-cleanup')
 loop perform cron.unschedule(item.jobid); end loop;
end $$;
select cron.schedule('dkn-calendar-minute','* * * * *','select nail_private.dispatch_calendar();');
-- 00:00 Việt Nam = 17:00 UTC; refresh mỗi giờ tại phút 0 còn có tác dụng phục hồi.
select cron.schedule('dkn-refresh-slots','0 * * * *','select public.refresh_availability();');
select cron.schedule('dkn-cleanup','15 17 * * *','select public.maintenance_cleanup();');
select public.refresh_availability();
commit;
