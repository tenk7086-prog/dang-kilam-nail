-- Cho phép chủ tiệm tạo/dời lịch xa hơn cửa sổ 10 ngày của khách.
-- Khách công khai vẫn bị giới hạn bởi customer_book + RLS availability.
begin;

create or replace function nail_private.refresh_slots() returns void
language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 insert into public.availability(starts_at,local_date,local_time,capacity)
 select (d.day+h.tm) at time zone 'Asia/Ho_Chi_Minh',d.day,h.tm,
 case when w.weekday is null or c.local_date is not null or w.capacity=0
        or h.tm<w.opens or h.tm+interval '1 hour'>w.closes or h.tm>=w.closes then 0
      else coalesce(o.capacity,r.capacity,w.capacity) end
 from (select today+i as day from generate_series(0,9) i
       union select local_date from public.availability where local_date>=today) d
 cross join (select make_time(i,0,0) as tm from generate_series(0,23) i) h
 left join public.weekly_hours w on w.weekday=extract(dow from d.day)::integer
 left join public.closed_days c on c.local_date=d.day
 left join public.capacity_rules r on r.local_time=h.tm
 left join public.slot_overrides o on o.local_date=d.day and o.local_time=h.tm
 order by d.day,h.tm
 on conflict(starts_at) do update set capacity=excluded.capacity
 where public.availability.capacity<>excluded.capacity;
end $$;

create or replace function nail_private.guard_booking() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.availability%rowtype; today date;
begin
 perform pg_advisory_xact_lock_shared(181001);
 if tg_op='DELETE' then raise exception 'use_soft_cancel'; end if;
 if tg_op='UPDATE' then
   if new.id<>old.id or new.phone<>old.phone or new.customer_name<>old.customer_name
      or new.people<>old.people or new.secret_hash is distinct from old.secret_hash
      or new.idempotency_key<>old.idempotency_key or new.request_hash<>old.request_hash
      or new.event_id<>old.event_id or new.created_at<>old.created_at then
     raise exception 'immutable_booking_fields';
   end if;
   if old.status='cancelled' then raise exception 'booking_cancelled'; end if;
 end if;
 if new.status='confirmed' then
   today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
   -- Chỉ owner được tạo/dời lịch ngoài 10 ngày. Khách vẫn dùng cửa sổ công khai.
   if not nail_private.is_owner()
      and ((new.starts_at at time zone 'Asia/Ho_Chi_Minh')::date not between today and today+9) then
     raise exception 'outside_booking_window';
   end if;
   if new.starts_at<=now() then raise exception 'outside_booking_window'; end if;
   if exists(select 1 from nail_private.blocked_phones where phone=new.phone) then
     raise exception 'phone_blocked';
   end if;
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

create function nail_private.ensure_owner_slot(p_local_date date,p_local_time time)
returns timestamptz
language plpgsql security definer set search_path='' as $$
declare
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  w public.weekly_hours%rowtype;
  slot_capacity integer;
  starts timestamptz;
begin
  if p_local_date is null or p_local_time is null
     or extract(minute from p_local_time)<>0
     or extract(second from p_local_time)<>0 then
    raise exception 'invalid_request';
  end if;
  if p_local_date<today or p_local_date>today+730 then
    raise exception 'future_date_too_far';
  end if;
  if exists(select 1 from public.closed_days where local_date=p_local_date) then
    raise exception 'slot_unavailable';
  end if;
  select * into w from public.weekly_hours
   where weekday=extract(dow from p_local_date)::integer;
  if not found or w.capacity=0 or p_local_time<w.opens or p_local_time>=w.closes
     or p_local_time+interval '1 hour'>w.closes then
    raise exception 'slot_unavailable';
  end if;
  slot_capacity:=coalesce(
    (select capacity from public.slot_overrides where local_date=p_local_date and local_time=p_local_time),
    (select capacity from public.capacity_rules where local_time=p_local_time),
    w.capacity
  );
  if slot_capacity<=0 then raise exception 'slot_unavailable'; end if;
  starts:=(p_local_date+p_local_time) at time zone 'Asia/Ho_Chi_Minh';
  insert into public.availability(starts_at,local_date,local_time,capacity)
  values(starts,p_local_date,p_local_time,slot_capacity)
  on conflict(starts_at) do update set capacity=excluded.capacity;
  return starts;
end $$;

create or replace function public.admin_create_booking(
  p_name text,p_phone text,p_local_date date,p_local_time time,
  p_people integer,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_phone text:=nail_private.normalize_phone(p_phone);
  starts timestamptz; fingerprint text; err text;
  b nail_private.bookings%rowtype; bid uuid:=gen_random_uuid();
begin
  perform nail_private.require_owner();
  -- Same lock order as customer_book: idempotency, configuration, phone.
  perform pg_advisory_xact_lock(hashtextextended('idem:'||p_idempotency_key::text,0));
  perform pg_advisory_xact_lock(181001);
  begin
    if v_phone is null then raise exception 'invalid_phone'; end if;
    if p_name is null or length(btrim(p_name)) not between 2 and 80 or p_name ~ '[[:cntrl:]]'
      then raise exception 'invalid_name'; end if;
    if p_people is null or p_people not between 1 and 20 then raise exception 'invalid_people'; end if;
    if p_idempotency_key is null then raise exception 'invalid_request'; end if;
    starts:=(p_local_date+p_local_time) at time zone 'Asia/Ho_Chi_Minh';
    fingerprint:=nail_private.hash_text(jsonb_build_array(btrim(p_name),v_phone,extract(epoch from starts),p_people,'owner')::text);
    perform pg_advisory_xact_lock(hashtextextended('idem:'||p_idempotency_key::text,0));
    perform pg_advisory_xact_lock(hashtextextended('phone:'||v_phone,0));
    select * into b from nail_private.bookings where idempotency_key=p_idempotency_key;
    if found then
      if b.request_hash<>fingerprint then raise exception 'idempotency_conflict'; end if;
      return nail_private.booking_result(b)||jsonb_build_object('replayed',true);
    end if;
    starts:=nail_private.ensure_owner_slot(p_local_date,p_local_time);
    if (select count(*) from nail_private.bookings x where x.phone=v_phone
        and x.status='confirmed' and x.starts_at>now())>=3 then
      raise exception 'too_many_active_bookings';
    end if;
    if exists(select 1 from nail_private.bookings x where x.phone=v_phone
        and x.starts_at=starts and x.status='confirmed') then
      raise exception 'already_booked';
    end if;
    insert into nail_private.bookings(id,starts_at,customer_name,phone,people,
      idempotency_key,request_hash,event_id)
    values(bid,starts,btrim(p_name),v_phone,p_people,p_idempotency_key,
      fingerprint,'dkn'||replace(bid::text,'-','')) returning * into b;
    return nail_private.booking_result(b)||jsonb_build_object('replayed',false);
  exception when raise_exception then
    get stacked diagnostics err=message_text;
    return jsonb_build_object('ok',false,'error',err);
  when foreign_key_violation then
    return jsonb_build_object('ok',false,'error','slot_unavailable');
  when unique_violation then
    return jsonb_build_object('ok',false,'error','already_booked');
  end;
end $$;

create or replace function public.admin_change_booking(p_id uuid,p_action text,p_expected_version bigint,
 p_new_starts_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b nail_private.bookings%rowtype; expected_slot timestamptz;
begin
  perform nail_private.require_owner();
  perform pg_advisory_xact_lock(181001);
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
    expected_slot:=nail_private.ensure_owner_slot(
      (p_new_starts_at at time zone 'Asia/Ho_Chi_Minh')::date,
      (p_new_starts_at at time zone 'Asia/Ho_Chi_Minh')::time
    );
    if expected_slot<>p_new_starts_at then raise exception 'invalid_request'; end if;
    if b.starts_at<>p_new_starts_at then
      update nail_private.bookings set starts_at=p_new_starts_at where id=p_id returning * into b;
    end if;
  else raise exception 'invalid_action'; end if;
  return nail_private.booking_result(b);
end $$;

revoke all on function nail_private.ensure_owner_slot(date,time) from public,anon,authenticated,service_role;
revoke all on function public.admin_create_booking(text,text,date,time,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_booking(text,text,date,time,integer,uuid) to authenticated;

commit;
