begin;
insert into auth.users(id,email) values('92000000-0000-4000-8000-000000000001','days@example.invalid');
insert into nail_private.owners(user_id) values('92000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
do $$
declare d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date+30; result jsonb;
begin
 if has_function_privilege('anon','public.admin_set_closed_days(date,date,text,boolean)','execute') then raise exception 'anon permission'; end if;
 perform public.admin_set_closed_days(d,d+2,'Tiệm nghỉ',false);
 if (select count(*) from public.closed_days where local_date between d and d+2)<>3 then raise exception 'range failed'; end if;
 result:=public.admin_create_booking('Test ngày nghỉ','0907654321',d,'09:00',1,gen_random_uuid());
 if result->>'error'<>'slot_unavailable' then raise exception 'closed booking accepted: %',result; end if;
 perform public.admin_set_closed_days(d,d+2,'',true);
 result:=public.admin_create_booking('Test mở lại','0907654321',d,'09:00',1,gen_random_uuid());
 if result->>'ok'<>'true' then raise exception 'reopen failed'; end if;
 begin
   perform public.admin_set_closed_days(d,d+2,'',false);
   raise exception 'accepted existing booking';
 exception when raise_exception then
   if sqlerrm<>'closed_day_has_bookings' then raise; end if;
 end;
 if exists(select 1 from public.closed_days where local_date between d and d+2) then raise exception 'partial update'; end if;
 perform public.admin_set_closed_days(d+1,d+2,'',false);
 perform public.admin_set_closed_days(d+1,d+2,'',false);
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.admin_set_closed_days(d+1,d+2,'',true);
   raise exception 'non owner accepted';
 exception when insufficient_privilege then
   if sqlerrm<>'owner_required' then raise; end if;
 end;
end $$;
rollback;
