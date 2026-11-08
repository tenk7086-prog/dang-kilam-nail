begin;
-- Sức chứa công khai là tổng chỗ trừ chỗ chủ tiệm khóa. Không tạo booking/Calendar.
create table nail_private.day_slots (
 local_date date not null, local_time time not null,
 extra_capacity integer check(extra_capacity between 1 and 20),
 blocked integer not null default 0 check(blocked between 0 and 20),
 primary key(local_date,local_time),
 check(extract(minute from local_time)=0 and extract(second from local_time)=0)
);
alter table nail_private.day_slots enable row level security;
revoke all on nail_private.day_slots from public,anon,authenticated,service_role;
create or replace function nail_private.refresh_slots() returns void
language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 insert into public.availability(starts_at,local_date,local_time,capacity)
 select (d.day+h.tm) at time zone 'Asia/Ho_Chi_Minh',d.day,h.tm,
 greatest(0,(case when c.local_date is not null then 0 when s.extra_capacity is not null then s.extra_capacity when w.weekday is null or c.local_date is not null or w.capacity=0
        or h.tm<w.opens or h.tm+interval '1 hour'>w.closes or h.tm>=w.closes then 0
      else coalesce(o.capacity,r.capacity,w.capacity) end)-coalesce(s.blocked,0))
 from (select today+i as day from generate_series(0,9) i
       union select local_date from public.availability where local_date>=today) d
 cross join (select make_time(i,0,0) as tm from generate_series(0,23) i) h
 left join public.weekly_hours w on w.weekday=extract(dow from d.day)::integer
 left join public.closed_days c on c.local_date=d.day
 left join public.capacity_rules r on r.local_time=h.tm
 left join public.slot_overrides o on o.local_date=d.day and o.local_time=h.tm
 left join nail_private.day_slots s on s.local_date=d.day and s.local_time=h.tm
 order by d.day,h.tm
 on conflict(starts_at) do update set capacity=excluded.capacity
 where public.availability.capacity<>excluded.capacity;
end $$;

create or replace function nail_private.ensure_owner_slot(p_local_date date,p_local_time time)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare starts timestamptz; cap integer; today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if p_local_date is null or p_local_time is null or extract(minute from p_local_time)<>0 or extract(second from p_local_time)<>0 then raise exception 'invalid_request'; end if;
 if p_local_date<today or p_local_date>today+730 then raise exception 'future_date_too_far'; end if;
 starts:=(p_local_date+p_local_time) at time zone 'Asia/Ho_Chi_Minh';
 insert into public.availability(starts_at,local_date,local_time,capacity) values(starts,p_local_date,p_local_time,0) on conflict do nothing;
 perform nail_private.refresh_slots();
 select capacity into cap from public.availability where starts_at=starts;
 if cap<=0 then raise exception 'slot_unavailable'; end if;
 return starts;
end $$;

create function public.admin_day_slots(p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date; result jsonb;
begin
 perform nail_private.require_owner();
 if p_date is null or p_date<today or p_date>today+730 then raise exception 'future_date_too_far'; end if;
 perform pg_advisory_xact_lock(181001);
 insert into public.availability(starts_at,local_date,local_time,capacity)
 values((p_date+time '00:00') at time zone 'Asia/Ho_Chi_Minh',p_date,'00:00',0) on conflict do nothing;
 perform nail_private.refresh_slots();
 select jsonb_build_object('closed',exists(select 1 from public.closed_days where local_date=p_date),
 'slots',coalesce(jsonb_agg(jsonb_build_object('time',a.local_time,'starts_at',a.starts_at,
 'capacity',a.capacity,'reserved',a.reserved,'remaining',a.remaining,'blocked',coalesce(s.blocked,0),
 'extra',s.extra_capacity is not null) order by a.local_time) filter(where a.capacity>0 or coalesce(s.blocked,0)>0 or s.extra_capacity is not null),'[]'::jsonb)) into result
 from public.availability a left join nail_private.day_slots s using(local_date,local_time) where a.local_date=p_date;
 return result;
end $$;
create function public.admin_edit_day_slot(p_date date,p_time time,p_action text,p_value integer,p_expected_blocked integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.availability%rowtype; b integer; extra integer; today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 perform nail_private.require_owner();
 if p_date is null or p_date<today or p_date>today+730 or p_time is null or extract(minute from p_time)<>0 or extract(second from p_time)<>0 then raise exception 'invalid_request'; end if;
 if (p_date+p_time) at time zone 'Asia/Ho_Chi_Minh'<=now() then raise exception 'outside_booking_window'; end if;
 perform pg_advisory_xact_lock(181001);
 if exists(select 1 from public.closed_days where local_date=p_date) then raise exception 'slot_unavailable'; end if;
 perform public.admin_day_slots(p_date);
 select * into a from public.availability where local_date=p_date and local_time=p_time for update;
 select blocked,extra_capacity into b,extra from nail_private.day_slots where local_date=p_date and local_time=p_time;
 b:=coalesce(b,0);
 if p_action='block' then
   if p_expected_blocked is distinct from b then raise exception 'version_conflict'; end if;
   if a.remaining<1 then raise exception 'slot_full'; end if;
   b:=b+1;
 elsif p_action='unblock' then
   if p_expected_blocked is distinct from b then raise exception 'version_conflict'; end if;
   if b<1 then raise exception 'invalid_request'; end if;
   b:=b-1;
 elsif p_action='add' then
   if p_value is null or p_value not between 1 and 20 then raise exception 'invalid_people'; end if;
   if a.capacity>0 or b>0 or extra is not null then raise exception 'slot_exists'; end if;
   extra:=p_value;
 else raise exception 'invalid_action'; end if;
 insert into nail_private.day_slots(local_date,local_time,extra_capacity,blocked) values(p_date,p_time,extra,b)
 on conflict(local_date,local_time) do update set blocked=excluded.blocked,extra_capacity=excluded.extra_capacity;
 perform nail_private.refresh_slots();
 return public.admin_day_slots(p_date);
end $$;
revoke all on function public.admin_day_slots(date) from public,anon,authenticated,service_role;
revoke all on function public.admin_edit_day_slot(date,time,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_day_slots(date),public.admin_edit_day_slot(date,time,text,integer,integer) to authenticated;
commit;
