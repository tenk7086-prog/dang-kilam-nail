-- Dang Kilam Nail | GĐ1 | PostgreSQL 15+ / Supabase
-- Chạy đúng một lần trên project MỚI, bằng SQL Editor hoặc supabase db push.
begin;
create schema nail_private;
revoke all on schema nail_private from public, anon, authenticated, service_role;
grant usage on schema nail_private to authenticated;

create table public.shop_settings (
  id boolean primary key default true check (id),
  name text not null default 'Dang Kilam Nail',
  address text not null default 'Số 181 Khương Thượng, Phường Kim Liên, Hà Nội',
  contact_phone text check (contact_phone is null or contact_phone ~ '^0[35789][0-9]{8}$'),
  announcement text not null default '' check (length(announcement) <= 1000),
  timezone text not null default 'Asia/Ho_Chi_Minh' check (timezone = 'Asia/Ho_Chi_Minh'),
  slot_minutes integer not null default 60 check (slot_minutes = 60),
  booking_days integer not null default 10 check (booking_days = 10),
  cancel_before_hours integer not null default 4 check (cancel_before_hours = 4)
);
create table public.weekly_hours (
  weekday integer primary key check (weekday between 0 and 6), -- 0: Chủ nhật
  opens time not null, closes time not null,
  capacity integer not null check (capacity between 0 and 20),
  check (opens < closes),
  check (extract(minute from opens)=0 and extract(second from opens)=0),
  check (extract(minute from closes)=0 and extract(second from closes)=0)
);
create table public.capacity_rules (
  local_time time primary key,
  capacity integer not null check (capacity between 0 and 20),
  check (extract(minute from local_time)=0 and extract(second from local_time)=0)
);
create table public.closed_days (
  local_date date primary key,
  notice text not null default '' check (length(notice)<=500)
);
create table public.slot_overrides (
  local_date date not null, local_time time not null,
  capacity integer not null check (capacity between 0 and 20),
  primary key(local_date,local_time),
  check (extract(minute from local_time)=0 and extract(second from local_time)=0)
);
create table public.services (
  id uuid primary key default gen_random_uuid(), name text not null,
  description text not null default '', price_vnd integer not null check(price_vnd>=0),
  is_sample boolean not null default true, sort_order integer not null default 0
);
-- Bảng duy nhất được phát qua Realtime: KHÔNG có ID đơn hay thông tin khách.
create table public.availability (
  starts_at timestamptz primary key,
  local_date date not null, local_time time not null,
  capacity integer not null check(capacity between 0 and 20),
  reserved integer not null default 0 check(reserved>=0),
  remaining integer generated always as (capacity-reserved) stored,
  unique(local_date,local_time),
  check(reserved<=capacity),
  check(starts_at = (local_date+local_time) at time zone 'Asia/Ho_Chi_Minh')
);

create table nail_private.owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table nail_private.blocked_phones (
  phone text primary key check(phone ~ '^0[35789][0-9]{8}$'),
  note text not null default '', created_at timestamptz not null default now()
);
create function nail_private.normalize_phone(p text) returns text
language plpgsql immutable set search_path='' as $$
declare v text;
begin
  if p is null or length(p)>32 or p !~ '^\+?[0-9 ()-]+$' then return null; end if;
  v := regexp_replace(p, '[ ()-]', '', 'g');
  if v like '+84%' then v := '0'||substr(v,4);
  elsif v like '84%' then v := '0'||substr(v,3); end if;
  if v !~ '^0[35789][0-9]{8}$' or substr(v,3) ~ '^([0-9])\1{7}$' then return null; end if;
  return v;
end $$;
create function nail_private.hash_text(p text) returns text
language sql immutable strict set search_path='' as $$
  select encode(sha256(convert_to(p,'UTF8')),'hex')
$$;
create table nail_private.bookings (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null references public.availability(starts_at),
  customer_name text not null check(length(btrim(customer_name)) between 2 and 80 and customer_name !~ '[[:cntrl:]]'),
  phone text not null check(nail_private.normalize_phone(phone) is not null
                            and phone=nail_private.normalize_phone(phone)),
  people integer not null check(people between 1 and 20),
  status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
  secret_hash text not null unique check(secret_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid not null unique,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  event_id text not null unique,
  version bigint not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), cancelled_at timestamptz,
  check((status='cancelled')=(cancelled_at is not null))
);
create unique index one_phone_per_slot on nail_private.bookings(phone,starts_at)
  where status='confirmed';
create index bookings_date on nail_private.bookings(starts_at,status);
create index bookings_phone on nail_private.bookings(phone,created_at desc);
create table nail_private.calendar_jobs (
  booking_id uuid primary key references nail_private.bookings(id),
  desired_version bigint not null, processed_version bigint not null default 0,
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_token uuid, leased_until timestamptz,
  last_error_code text, last_success_at timestamptz,
  check(processed_version<=desired_version)
);
create index pending_calendar_jobs on nail_private.calendar_jobs(next_attempt_at)
  where processed_version<desired_version;
create table nail_private.calendar_error_log (
  id bigint generated always as identity primary key,
  booking_id uuid not null references nail_private.bookings(id),
  booking_version bigint not null, error_code text not null check(length(error_code)<=120),
  created_at timestamptz not null default now()
);
create table nail_private.audit_log (
  id bigint generated always as identity primary key,
  booking_id uuid not null references nail_private.bookings(id),
  actor_id uuid, action text not null,
  old_starts_at timestamptz, new_starts_at timestamptz,
  created_at timestamptz not null default now()
);
create table nail_private.rate_buckets (
  bucket_key text not null, window_start timestamptz not null,
  hits integer not null check(hits>0), primary key(bucket_key,window_start)
);
create index rate_buckets_expiry on nail_private.rate_buckets(window_start);
-- Chỉ chuẩn bị cấu trúc; GĐ1 KHÔNG lập lịch/gửi SMS.
create table nail_private.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references nail_private.bookings(id),
  booking_version bigint,
  kind text not null check(kind in ('reminder_2h','owner_daily_19h')),
  dedupe_key text not null unique, run_at timestamptz not null,
  state text not null default 'disabled' check(state in ('disabled','pending','sent','failed','cancelled')),
  provider text check(provider in ('speedsms','esms')),
  attempts integer not null default 0, provider_message_id text,
  last_error_code text, created_at timestamptz not null default now()
);

create function nail_private.is_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from nail_private.owners where user_id=(select auth.uid()))
$$;
create function nail_private.require_owner() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not nail_private.is_owner() then raise exception using errcode='42501',message='owner_required'; end if;
end $$;

-- Khoá dùng chung khi đặt/huỷ/dời; admin thay cấu hình lấy khoá độc quyền.
create function nail_private.refresh_slots() returns void
language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 insert into public.availability(starts_at,local_date,local_time,capacity)
 select (d.day+h.tm) at time zone 'Asia/Ho_Chi_Minh',d.day,h.tm,
 case when w.weekday is null or c.local_date is not null or w.capacity=0
        or h.tm<w.opens or h.tm+interval '1 hour'>w.closes or h.tm>=w.closes then 0
      else coalesce(o.capacity,r.capacity,w.capacity) end
 from (select today+i as day from generate_series(0,9) i) d
 cross join (select make_time(i,0,0) as tm from generate_series(0,23) i) h
 left join public.weekly_hours w on w.weekday=extract(dow from d.day)::integer
 left join public.closed_days c on c.local_date=d.day
 left join public.capacity_rules r on r.local_time=h.tm
 left join public.slot_overrides o on o.local_date=d.day and o.local_time=h.tm
 order by d.day,h.tm
 on conflict(starts_at) do update set capacity=excluded.capacity
 where public.availability.capacity<>excluded.capacity;
end $$;
create function public.refresh_availability() returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(181001);
 perform nail_private.refresh_slots();
end $$;

-- Trigger là lớp bảo vệ chung cho mọi đường ghi đơn, kể cả thao tác của admin.
create function nail_private.guard_booking() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.availability%rowtype; today date;
begin
 perform pg_advisory_xact_lock_shared(181001);
 if tg_op='DELETE' then raise exception 'use_soft_cancel'; end if;
 if tg_op='UPDATE' then
   if new.id<>old.id or new.phone<>old.phone or new.customer_name<>old.customer_name
      or new.people<>old.people or new.secret_hash<>old.secret_hash
      or new.idempotency_key<>old.idempotency_key or new.request_hash<>old.request_hash
      or new.event_id<>old.event_id or new.created_at<>old.created_at then
     raise exception 'immutable_booking_fields';
   end if;
   if old.status='cancelled' then raise exception 'booking_cancelled'; end if;
 end if;
 if new.status='confirmed' then
   today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
   if new.starts_at<=now() or (new.starts_at at time zone 'Asia/Ho_Chi_Minh')::date
      not between today and today+9 then raise exception 'outside_booking_window'; end if;
   if exists(select 1 from nail_private.blocked_phones where phone=new.phone) then
     raise exception 'phone_blocked'; end if;
 end if;
 -- Luôn khoá cả slot cũ và mới theo cùng thứ tự để tránh deadlock khi dời chéo.
 if tg_op='UPDATE' then
   perform 1 from public.availability where starts_at in(old.starts_at,new.starts_at)
     order by starts_at for update;
   if old.status='confirmed' then
     update public.availability set reserved=reserved-old.people where starts_at=old.starts_at;
   end if;
 else
   perform 1 from public.availability where starts_at=new.starts_at for update;
 end if;
 if new.status='confirmed' then
   select * into a from public.availability where starts_at=new.starts_at;
   if not found or a.capacity-a.reserved<new.people then raise exception 'slot_full'; end if;
   update public.availability set reserved=reserved+new.people where starts_at=new.starts_at;
 end if;
 if tg_op='INSERT' then new.version:=1;
 else new.version:=old.version+1; end if;
 new.updated_at:=now();
 new.cancelled_at:=case when new.status='cancelled' then now() else null end;
 return new;
end $$;
create trigger bookings_guard before insert or update or delete on nail_private.bookings
 for each row execute function nail_private.guard_booking();
create function nail_private.queue_calendar() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into nail_private.calendar_jobs(booking_id,desired_version)
 values(new.id,new.version)
 on conflict(booking_id) do update set desired_version=excluded.desired_version,
   next_attempt_at=now(),attempts=0;
 -- Không xoá lease đang chạy: worker hoàn tất phiên bản cũ rồi nhận phiên bản mới.
 insert into nail_private.audit_log(booking_id,actor_id,action,old_starts_at,new_starts_at)
 values(new.id,auth.uid(),case when tg_op='INSERT' then 'create'
   when new.status='cancelled' then 'cancel' else 'move' end,
   case when tg_op='UPDATE' then old.starts_at else null end,new.starts_at);
 update nail_private.notification_jobs set state='cancelled'
 where booking_id=new.id and state in ('pending','disabled') and booking_version<new.version;
 return new;
end $$;
create trigger bookings_outbox after insert or update on nail_private.bookings
 for each row execute function nail_private.queue_calendar();

-- Mỗi thao tác tính cả lượt thất bại; Edge phải truyền hash IP do chính server tạo.
create function nail_private.take_budget(p_action text,p_phone text,p_ip_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare window_at timestamptz; n integer; k text;
begin
 if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 window_at:=to_timestamp(floor(extract(epoch from now())/900)*900);
 foreach k in array array[p_action||':ip:'||p_ip_hash,
   p_action||':phone:'||nail_private.hash_text(coalesce(p_phone,'invalid'))] loop
   insert into nail_private.rate_buckets(bucket_key,window_start,hits) values(k,window_at,1)
   on conflict(bucket_key,window_start) do update set hits=nail_private.rate_buckets.hits+1
   returning hits into n;
   if n>(case when k like '%:ip:%' then 30 else 10 end) then return false; end if;
 end loop;
 return true;
end $$;
create function nail_private.booking_result(b nail_private.bookings) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('ok',true,'booking',jsonb_build_object(
   'id',b.id,'name',b.customer_name,'phone',b.phone,'starts_at',b.starts_at,
   'ends_at',b.starts_at+interval '1 hour','people',b.people,'status',b.status,
   'can_cancel',b.status='confirmed' and b.starts_at>=now()+interval '4 hours'))
$$;
create function public.customer_book(
 p_name text,p_phone text,p_starts_at timestamptz,p_people integer,
 p_idempotency_key uuid,p_secret text,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_phone text:=nail_private.normalize_phone(p_phone); fingerprint text;
 b nail_private.bookings%rowtype; bid uuid:=gen_random_uuid(); err text;
begin
 if not nail_private.take_budget('book',v_phone,p_ip_hash) then
   return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 -- Savepoint: lỗi nghiệp vụ rollback phần đặt, không rollback bộ đếm chống spam.
 begin
   if v_phone is null then raise exception 'invalid_phone'; end if;
   if p_name is null or length(btrim(p_name)) not between 2 and 80 or p_name ~ '[[:cntrl:]]' then raise exception 'invalid_name'; end if;
   if p_people is null or p_people not between 1 and 20 then raise exception 'invalid_people'; end if;
   if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_idempotency_key is null
      or p_starts_at is null then raise exception 'invalid_request'; end if;
   fingerprint:=nail_private.hash_text(jsonb_build_array(btrim(p_name),v_phone,extract(epoch from p_starts_at),
                  p_people,nail_private.hash_text(p_secret))::text);
   perform pg_advisory_xact_lock(hashtextextended('idem:'||p_idempotency_key::text,0));
   select * into b from nail_private.bookings where idempotency_key=p_idempotency_key;
   if found then
     if b.request_hash<>fingerprint then raise exception 'idempotency_conflict'; end if;
     return nail_private.booking_result(b)||jsonb_build_object('replayed',true);
   end if;
   perform pg_advisory_xact_lock_shared(181001);
   perform pg_advisory_xact_lock(hashtextextended('phone:'||v_phone,0));
   if (select count(*) from nail_private.bookings x where x.phone=v_phone
       and x.status='confirmed' and x.starts_at>now())>=3 then raise exception 'too_many_active_bookings'; end if;
   if exists(select 1 from nail_private.bookings x where x.phone=v_phone
       and x.starts_at=p_starts_at and x.status='confirmed') then raise exception 'already_booked'; end if;
   insert into nail_private.bookings(id,starts_at,customer_name,phone,people,secret_hash,
       idempotency_key,request_hash,event_id)
   values(bid,p_starts_at,btrim(p_name),v_phone,p_people,nail_private.hash_text(p_secret),
       p_idempotency_key,fingerprint,'dkn'||replace(bid::text,'-','')) returning * into b;
   return nail_private.booking_result(b)||jsonb_build_object('replayed',false);
 exception when raise_exception then
   get stacked diagnostics err=message_text;
   return jsonb_build_object('ok',false,'error',err);
 when foreign_key_violation then return jsonb_build_object('ok',false,'error','slot_unavailable');
 when unique_violation then return jsonb_build_object('ok',false,'error','already_booked');
 end;
end $$;
create function public.customer_lookup(p_phone text,p_secret text,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_phone text:=nail_private.normalize_phone(p_phone); b nail_private.bookings%rowtype;
begin
 if not nail_private.take_budget('lookup',v_phone,p_ip_hash) then
   return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 if v_phone is null or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
   return jsonb_build_object('ok',false,'error','not_found'); end if;
 select * into b from nail_private.bookings x
 where x.phone=v_phone and x.secret_hash=nail_private.hash_text(p_secret)
 order by x.created_at desc limit 1;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 return nail_private.booking_result(b);
end $$;
create function public.customer_cancel(
 p_phone text,p_secret text,p_local_date date,p_local_time time,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_phone text:=nail_private.normalize_phone(p_phone); b nail_private.bookings%rowtype;
begin
 if not nail_private.take_budget('cancel',v_phone,p_ip_hash) then
   return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 perform pg_advisory_xact_lock_shared(181001);
 select * into b from nail_private.bookings x where x.phone=v_phone
   and x.secret_hash=nail_private.hash_text(p_secret)
   and x.starts_at=(p_local_date+p_local_time) at time zone 'Asia/Ho_Chi_Minh' for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 if b.status='cancelled' then return nail_private.booking_result(b); end if;
 if b.starts_at<now()+interval '4 hours' then
   return jsonb_build_object('ok',false,'error','cancellation_too_late'); end if;
 update nail_private.bookings set status='cancelled' where id=b.id returning * into b;
 return nail_private.booking_result(b);
end $$;

create function public.admin_list_bookings(p_from date,p_to date,p_phone text default null)
returns table(id uuid,customer_name text,phone text,starts_at timestamptz,people integer,
 status text,version bigint,calendar_pending boolean,calendar_error text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform nail_private.require_owner();
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>31 then
   raise exception 'invalid_date_range'; end if;
 if p_phone is not null and nail_private.normalize_phone(p_phone) is null then
   raise exception 'invalid_phone'; end if;
 return query select b.id,b.customer_name,b.phone,b.starts_at,b.people,b.status,b.version,
   j.processed_version<j.desired_version,j.last_error_code
 from nail_private.bookings b join nail_private.calendar_jobs j on j.booking_id=b.id
 where b.starts_at>=p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'
   and b.starts_at<(p_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'
   and (p_phone is null or b.phone=nail_private.normalize_phone(p_phone))
 order by b.starts_at,b.created_at;
end $$;
create function public.admin_change_booking(p_id uuid,p_action text,p_expected_version bigint,
 p_new_starts_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b nail_private.bookings%rowtype;
begin
 perform nail_private.require_owner();
 perform pg_advisory_xact_lock_shared(181001);
 select * into b from nail_private.bookings where id=p_id for update;
 if not found then raise exception 'not_found'; end if;
 if p_expected_version is null or b.version<>p_expected_version then raise exception 'version_conflict'; end if;
 if p_action='cancel' then
   if b.status='confirmed' then
     update nail_private.bookings set status='cancelled' where id=p_id returning * into b;
   end if;
 elsif p_action='move' then
   if b.status='cancelled' then raise exception 'booking_cancelled'; end if;
   if p_new_starts_at is null then raise exception 'invalid_request'; end if;
   if b.starts_at<>p_new_starts_at then
     update nail_private.bookings set starts_at=p_new_starts_at where id=p_id returning * into b;
   end if;
 else raise exception 'invalid_action'; end if;
 return nail_private.booking_result(b);
end $$;
create function public.admin_set_blocked_phone(p_phone text,p_block boolean,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v_phone text:=nail_private.normalize_phone(p_phone);
begin
 perform nail_private.require_owner();
 perform pg_advisory_xact_lock(181001);
 if v_phone is null or p_block is null or length(coalesce(p_note,''))>500 then raise exception 'invalid_request'; end if;
 if p_block then
   insert into nail_private.blocked_phones(phone,note) values(v_phone,coalesce(p_note,''))
   on conflict(phone) do update set note=excluded.note;
 else delete from nail_private.blocked_phones x where x.phone=v_phone; end if;
end $$;
create function public.admin_list_blocked_phones()
returns table(phone text,note text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 perform nail_private.require_owner();
 return query select b.phone,b.note,b.created_at from nail_private.blocked_phones b order by b.created_at desc;
end $$;
-- p_kind: shop / hours / capacity / closed_day / slot_override.
-- p_remove dùng để xoá ngoại lệ, ngày nghỉ, hoặc quy tắc sức chứa.
create function public.admin_configure(p_kind text,p_data jsonb,p_remove boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform nail_private.require_owner();
 perform pg_advisory_xact_lock(181001);
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_remove is null then raise exception 'invalid_request'; end if;
 case p_kind
 when 'shop' then
   if p_remove then raise exception 'invalid_request'; end if;
   update public.shop_settings set
     announcement=coalesce(p_data->>'announcement',announcement),
     contact_phone=case when p_data ? 'contact_phone' then
       case when p_data->>'contact_phone' is null then null
       else nail_private.normalize_phone(p_data->>'contact_phone') end else contact_phone end
   where id;
   if p_data->>'contact_phone' is not null and nail_private.normalize_phone(p_data->>'contact_phone') is null
   then raise exception 'invalid_phone'; end if;
 when 'hours' then
   if p_remove then raise exception 'invalid_request'; end if;
   insert into public.weekly_hours(weekday,opens,closes,capacity)
   values((p_data->>'weekday')::integer,(p_data->>'opens')::time,
     (p_data->>'closes')::time,(p_data->>'capacity')::integer)
   on conflict(weekday) do update set opens=excluded.opens,closes=excluded.closes,capacity=excluded.capacity;
 when 'capacity' then
   if p_remove then delete from public.capacity_rules where local_time=(p_data->>'time')::time;
   else
     insert into public.capacity_rules(local_time,capacity)
     values((p_data->>'time')::time,(p_data->>'capacity')::integer)
     on conflict(local_time) do update set capacity=excluded.capacity;
   end if;
 when 'closed_day' then
   if p_remove then delete from public.closed_days where local_date=(p_data->>'date')::date;
   else
     insert into public.closed_days(local_date,notice)
     values((p_data->>'date')::date,coalesce(p_data->>'notice',''))
     on conflict(local_date) do update set notice=excluded.notice;
   end if;
 when 'slot_override' then
   if p_remove then delete from public.slot_overrides
     where local_date=(p_data->>'date')::date and local_time=(p_data->>'time')::time;
   else
     insert into public.slot_overrides(local_date,local_time,capacity)
     values((p_data->>'date')::date,(p_data->>'time')::time,(p_data->>'capacity')::integer)
     on conflict(local_date,local_time) do update set capacity=excluded.capacity;
   end if;
 else raise exception 'invalid_action'; end case;
 -- CHECK reserved<=capacity ngăn giảm chỗ/đóng cửa khi vẫn còn đơn đang giữ chỗ.
 perform nail_private.refresh_slots();
end $$;
create function public.maintenance_cleanup() returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from nail_private.rate_buckets where window_start<now()-interval '2 days';
 delete from nail_private.calendar_error_log where created_at<now()-interval '90 days';
end $$;

-- Thu hồi cả grant mặc định: RLS không thay thế cho quyền EXECUTE của function.
do $$
declare t text; f record;
begin
 foreach t in array array['shop_settings','weekly_hours','capacity_rules','closed_days',
     'slot_overrides','services','availability'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
   execute format('grant select on table public.%I to anon,authenticated',t);
   if t='availability' then
     execute format('create policy public_read on public.%I for select to anon,authenticated using '
       ||'(local_date between (now() at time zone ''Asia/Ho_Chi_Minh'')::date '
       ||'and (now() at time zone ''Asia/Ho_Chi_Minh'')::date+9)',t);
   else
     execute format('create policy public_read on public.%I for select to anon,authenticated using(true)',t);
   end if;
 end loop;
 foreach t in array array['owners','blocked_phones','bookings','calendar_jobs','calendar_error_log',
     'audit_log','rate_buckets','notification_jobs'] loop
   execute format('alter table nail_private.%I enable row level security',t);
   execute format('revoke all on table nail_private.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['bookings','blocked_phones','calendar_jobs','audit_log'] loop
   execute format('grant select on table nail_private.%I to authenticated',t);
   execute format('create policy owner_read on nail_private.%I for select to authenticated '
     ||'using ((select nail_private.is_owner()))',t);
 end loop;
 for f in select p.oid::regprocedure as signature,p.proname,n.nspname
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='nail_private' or (n.nspname='public' and
     (p.proname in ('customer_book','customer_lookup','customer_cancel','refresh_availability',
       'maintenance_cleanup','admin_list_bookings','admin_change_booking','admin_set_blocked_phone',
       'admin_list_blocked_phones','admin_configure'))) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   if f.nspname='public' then
     if f.proname like 'admin_%' then
       execute format('grant execute on function %s to authenticated',f.signature);
     else execute format('grant execute on function %s to service_role',f.signature); end if;
   end if;
 end loop;
end $$;
grant execute on function nail_private.is_owner() to authenticated;
revoke all on all sequences in schema nail_private from public,anon,authenticated,service_role;
-- Không đưa nail_private vào danh sách Exposed schemas của PostgREST.
-- Chỉ phát dữ liệu availability; KHÔNG publish bookings hoặc bất kỳ bảng riêng tư nào.
do $$
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
   create publication supabase_realtime;
 end if;
 alter publication supabase_realtime add table public.availability;
end $$;
commit;
