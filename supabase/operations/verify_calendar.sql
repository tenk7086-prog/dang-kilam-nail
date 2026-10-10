-- Chỉ chạy trong SQL Editor. Không trả tên/phone/token.
select public.calendar_queue_status();
select jobname,schedule,active from cron.job where jobname like 'dkn-%' order by jobname;
select j.booking_id,j.desired_version,j.processed_version,j.attempts,j.last_error_code,
 j.next_attempt_at,j.leased_until,j.last_success_at,j.reconcile_at
from nail_private.calendar_jobs j
where j.processed_version<j.desired_version or j.last_error_code is not null
order by j.next_attempt_at limit 50;
select jobid,status,start_time,end_time from cron.job_run_details
where jobid in (select jobid from cron.job where jobname like 'dkn-%')
order by start_time desc limit 20;
-- HTTP 200 có thể chứa failed>0. Phải xem queue/log, không chỉ nhìn cron succeeded.
select id,status_code,timed_out,error_msg from net._http_response order by created desc limit 20;
