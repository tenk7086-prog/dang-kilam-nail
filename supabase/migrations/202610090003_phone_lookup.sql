-- Upgrade existing projects; do not rerun the original migrations or seed.
-- CANCEL_MIN_HOURS has ONE source: public.shop_settings.cancel_before_hours.
begin;
alter table public.shop_settings drop constraint shop_settings_cancel_before_hours_check;
alter table public.shop_settings alter column cancel_before_hours set default 0;
alter table public.shop_settings add constraint shop_settings_cancel_before_hours_check check(cancel_before_hours between 0 and 168);
update public.shop_settings set cancel_before_hours=0 where id;
alter table nail_private.bookings alter column secret_hash drop not null;
alter table nail_private.bookings drop constraint bookings_secret_hash_key;
-- Retain legacy hashes for compatibility with the immutable-row trigger; unused by new API.
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

drop function public.customer_book(text,text,timestamptz,integer,uuid,text,text);
drop function public.customer_lookup(text,text,text);
drop function public.customer_cancel(text,text,date,time,text);
create or replace function nail_private.booking_result(b nail_private.bookings) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('ok',true,'booking',jsonb_build_object(
   'id',b.id,'name',b.customer_name,'phone',b.phone,'starts_at',b.starts_at,
   'ends_at',b.starts_at+interval '1 hour','people',b.people,'status',b.status,
   'can_cancel',b.status='confirmed' and b.starts_at>now() and b.starts_at>=now()+make_interval(hours=>(select cancel_before_hours from public.shop_settings where id))))
$$;
create function public.customer_book(
 p_name text,p_phone text,p_starts_at timestamptz,p_people integer,
 p_idempotency_key uuid,p_ip_hash text) returns jsonb
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
   if p_idempotency_key is null
      or p_starts_at is null then raise exception 'invalid_request'; end if;
   fingerprint:=nail_private.hash_text(jsonb_build_array(btrim(p_name),v_phone,extract(epoch from p_starts_at),
                  p_people)::text);
   perform pg_advisory_xact_lock(hashtextextended('idem:'||p_idempotency_key::text,0));
   select * into b from nail_private.bookings where idempotency_key=p_idempotency_key;
   if found then
     if b.request_hash<>fingerprint and (b.secret_hash is null or b.request_hash<>nail_private.hash_text(jsonb_build_array(btrim(p_name),v_phone,extract(epoch from p_starts_at),p_people,b.secret_hash)::text)) then raise exception 'idempotency_conflict'; end if;
     return nail_private.booking_result(b)||jsonb_build_object('replayed',true);
   end if;
   perform pg_advisory_xact_lock_shared(181001);
   perform pg_advisory_xact_lock(hashtextextended('phone:'||v_phone,0));
   if (select count(*) from nail_private.bookings x where x.phone=v_phone
       and x.status='confirmed' and x.starts_at>now())>=3 then raise exception 'too_many_active_bookings'; end if;
   if exists(select 1 from nail_private.bookings x where x.phone=v_phone
       and x.starts_at=p_starts_at and x.status='confirmed') then raise exception 'already_booked'; end if;
   insert into nail_private.bookings(id,starts_at,customer_name,phone,people,
       idempotency_key,request_hash,event_id)
   values(bid,p_starts_at,btrim(p_name),v_phone,p_people,
       p_idempotency_key,fingerprint,'dkn'||replace(bid::text,'-','')) returning * into b;
   return nail_private.booking_result(b)||jsonb_build_object('replayed',false);
 exception when raise_exception then
   get stacked diagnostics err=message_text;
   return jsonb_build_object('ok',false,'error',err);
 when foreign_key_violation then return jsonb_build_object('ok',false,'error','slot_unavailable');
 when unique_violation then return jsonb_build_object('ok',false,'error','already_booked');
 end;
end $$;

create function public.customer_lookup(p_phone text,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_phone text:=nail_private.normalize_phone(p_phone); items jsonb;
begin
 if not nail_private.take_budget('lookup',v_phone,p_ip_hash) then
   return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 if v_phone is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
 select coalesce(jsonb_agg(nail_private.booking_result(b)->'booking' order by b.starts_at,b.id),'[]'::jsonb)
 into items from nail_private.bookings b
 where b.phone=v_phone and b.status='confirmed' and b.starts_at>now();
 return jsonb_build_object('ok',true,'bookings',items);
end $$;
create function public.customer_cancel(p_phone text,p_local_date date,p_local_time time,p_ip_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_phone text:=nail_private.normalize_phone(p_phone); b nail_private.bookings%rowtype;
 CANCEL_MIN_HOURS integer;
begin
 if not nail_private.take_budget('cancel',v_phone,p_ip_hash) then
   return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 perform pg_advisory_xact_lock_shared(181001);
 -- Same order as booking: configuration -> phone -> booking -> slot.
 perform pg_advisory_xact_lock(hashtextextended('phone:'||coalesce(v_phone,''),0));
 select * into b from nail_private.bookings x where x.phone=v_phone
   and x.starts_at=(p_local_date+p_local_time) at time zone 'Asia/Ho_Chi_Minh'
 order by (x.status='confirmed') desc,x.created_at desc,x.id limit 1 for update;
 if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
 -- Retry of an already completed cancel is a no-op, never releases seats twice.
 if b.status='cancelled' then return nail_private.booking_result(b); end if;
 select cancel_before_hours into CANCEL_MIN_HOURS from public.shop_settings where id;
 if b.starts_at<=now() or b.starts_at<now()+make_interval(hours=>CANCEL_MIN_HOURS) then
   return jsonb_build_object('ok',false,'error','cancellation_too_late'); end if;
 update nail_private.bookings set status='cancelled' where id=b.id returning * into b;
 return nail_private.booking_result(b);
end $$;
revoke all on function public.customer_book(text,text,timestamptz,integer,uuid,text) from public,anon,authenticated;
revoke all on function public.customer_lookup(text,text) from public,anon,authenticated;
revoke all on function public.customer_cancel(text,date,time,text) from public,anon,authenticated;
grant execute on function public.customer_book(text,text,timestamptz,integer,uuid,text) to service_role;
grant execute on function public.customer_lookup(text,text) to service_role;
grant execute on function public.customer_cancel(text,date,time,text) to service_role;
commit;
