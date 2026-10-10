-- GĐ2. Chạy SAU migration GĐ1; không sửa/xoá dữ liệu đã đặt.
begin;
alter table nail_private.calendar_jobs add column lease_version bigint;
alter table nail_private.calendar_jobs add column reconcile_at timestamptz not null default now();
create index calendar_reconcile_due on nail_private.calendar_jobs(reconcile_at,next_attempt_at);

-- IP chỉ dùng khi Edge xác định được header IP đáng tin cậy.
-- NULL = chỉ giới hạn theo phone, không gom mọi khách vào một IP giả.
create or replace function nail_private.take_budget(p_action text,p_phone text,p_ip_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare window_at timestamptz; n integer; k text; keys text[];
begin
 if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 window_at:=to_timestamp(floor(extract(epoch from now())/900)*900);
 keys:=array[p_action||':phone:'||nail_private.hash_text(coalesce(p_phone,'invalid'))];
 if p_ip_hash is not null then keys:=array_prepend(p_action||':ip:'||p_ip_hash,keys); end if;
 foreach k in array keys loop
  insert into nail_private.rate_buckets(bucket_key,window_start,hits) values(k,window_at,1)
  on conflict(bucket_key,window_start) do update set hits=nail_private.rate_buckets.hits+1 returning hits into n;
  if n>(case when k like '%:ip:%' then 30 else 10 end) then return false; end if;
 end loop;
 return true;
end $$;

-- Mỗi lần claim chỉ nhận 1 job, tránh giữ hàng loạt lease khi worker chưa xử lý.
create function public.calendar_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j nail_private.calendar_jobs%rowtype; b nail_private.bookings%rowtype; token uuid:=gen_random_uuid();
begin
 select * into j from nail_private.calendar_jobs
 where (processed_version<desired_version or reconcile_at<=now())
 and next_attempt_at<=now() and (leased_until is null or leased_until<now())
 order by next_attempt_at,booking_id for update skip locked limit 1;
 if not found then return null; end if;
 select * into b from nail_private.bookings where id=j.booking_id;
 update nail_private.calendar_jobs set lease_token=token,leased_until=now()+interval '120 seconds',
   lease_version=b.version,attempts=attempts+1 where booking_id=b.id;
 return jsonb_build_object('booking_id',b.id,'lease_token',token,'version',b.version,
   'event_id',b.event_id,'name',b.customer_name,'phone',b.phone,'people',b.people,
   'starts_at',b.starts_at,'ends_at',b.starts_at+interval '1 hour','status',b.status);
end $$;
create function public.calendar_check_lease(p_id uuid,p_token uuid,p_version bigint) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from nail_private.calendar_jobs j join nail_private.bookings b on b.id=j.booking_id
 where j.booking_id=p_id and j.lease_token=p_token and j.lease_version=p_version
 and j.leased_until>clock_timestamp() and b.version=p_version)
$$;
create function public.calendar_finish(p_id uuid,p_token uuid,p_version bigint,p_success boolean,
 p_error_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j nail_private.calendar_jobs%rowtype; delay_seconds integer; safe_error text;
begin
 select * into j from nail_private.calendar_jobs where booking_id=p_id for update;
 if not found or p_token is null or j.lease_token is distinct from p_token
    or j.lease_version is distinct from p_version or j.leased_until<=clock_timestamp()
    or p_success is null then return false; end if;
 if p_success then
   update nail_private.calendar_jobs set processed_version=greatest(processed_version,p_version),
     lease_token=null,leased_until=null,lease_version=null,attempts=0,last_error_code=null,
     last_success_at=now(),reconcile_at=now()+interval '1 day',next_attempt_at=now()
   where booking_id=p_id;
 else
   -- Mã allow-list ký tự: không giữ nguyên error body từ Google hoặc JWT.
   safe_error:=case when p_error_code ~ '^[a-z0-9_]{1,100}$' then p_error_code else 'sync_failed' end;
   delay_seconds:=least(3600,30*power(2,least(j.attempts-1,7))::integer)+(random()*15)::integer;
   update nail_private.calendar_jobs set lease_token=null,leased_until=null,lease_version=null,
     last_error_code=safe_error,
     next_attempt_at=case when desired_version>p_version then now()
       else now()+make_interval(secs=>delay_seconds) end
   where booking_id=p_id;
   insert into nail_private.calendar_error_log(booking_id,booking_version,error_code)
   values(p_id,p_version,safe_error);
 end if;
 return true;
end $$;
-- Dùng để kiểm tra cấu hình worker, không trả dữ liệu khách.
create function public.calendar_queue_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('pending',count(*) filter(where processed_version<desired_version),
 'errors',count(*) filter(where last_error_code is not null),
 'due',count(*) filter(where (processed_version<desired_version or reconcile_at<=now()) and next_attempt_at<=now()),
 'last_success_at',max(last_success_at)) from nail_private.calendar_jobs
$$;
revoke all on function public.calendar_claim() from public,anon,authenticated,service_role;
revoke all on function public.calendar_check_lease(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.calendar_finish(uuid,uuid,bigint,boolean,text) from public,anon,authenticated,service_role;
revoke all on function public.calendar_queue_status() from public,anon,authenticated,service_role;
grant execute on function public.calendar_claim(),public.calendar_check_lease(uuid,uuid,bigint),
 public.calendar_finish(uuid,uuid,bigint,boolean,text),public.calendar_queue_status() to service_role;
commit;
