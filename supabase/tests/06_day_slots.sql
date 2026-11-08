begin;
insert into auth.users(id,email) values('93000000-0000-4000-8000-000000000001','slots@example.invalid');
insert into nail_private.owners(user_id) values('93000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
do $$
declare d date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date+2; r jsonb; n integer; st timestamptz;
begin
 if has_function_privilege('anon','public.admin_edit_day_slot(date,time,text,integer,integer)','execute') then raise exception 'anon allowed'; end if;
 if has_table_privilege('authenticated','nail_private.day_slots','select') then raise exception 'private table exposed'; end if;
 perform public.admin_day_slots(d);
 perform public.admin_edit_day_slot(d,'21:00','add',2,null);
 st:=(d+time '21:00') at time zone 'Asia/Ho_Chi_Minh';
 perform public.admin_edit_day_slot(d,'21:00','block',null,0);
 perform nail_private.refresh_slots();
 if (select remaining from public.availability where starts_at=st)<>1 then raise exception 'block not durable'; end if;
 begin
 perform public.admin_edit_day_slot(d,'21:00','block',null,0);
 raise exception 'repeated stale operation accepted';
 exception when raise_exception then if sqlerrm<>'version_conflict' then raise; end if; end;
 r:=public.admin_create_booking('Slot test','0907654321',d,'21:00',1,gen_random_uuid());
 if r->>'ok'<>'true' then raise exception 'extra booking failed %',r; end if;
 begin
 perform public.admin_edit_day_slot(d,'21:00','block',null,1);
 raise exception 'blocked booked seat';
 exception when raise_exception then if sqlerrm<>'slot_full' then raise; end if; end;
 select count(*) into n from nail_private.bookings;
 perform public.admin_edit_day_slot(d,'21:00','unblock',null,1);
 if (select count(*) from nail_private.bookings)<>n then raise exception 'created fake booking'; end if;
 if (select reserved from public.availability where starts_at=st)<>1 then raise exception 'changed customer booking'; end if;
 perform public.admin_day_slots(d+1);
 if (select capacity from public.availability where local_date=d+1 and local_time='21:00')<>0 then raise exception 'extra leaked into other day'; end if;
 perform public.admin_set_closed_days(d+1,d+1,'Nghỉ',false);
 begin
 perform public.admin_edit_day_slot(d+1,'21:00','add',2,null);
 raise exception 'closed day bypass';
 exception when raise_exception then if sqlerrm<>'slot_unavailable' then raise; end if; end;
 perform public.admin_edit_day_slot(d,'22:00','add',2,null);
 perform public.admin_edit_day_slot(d,'22:00','block',null,0);
 perform public.admin_edit_day_slot(d,'22:00','block',null,1);
 perform set_config('request.jwt.claim.sub','',true);
 r:=public.customer_book('Public test','0917654321',(d+time '22:00') at time zone 'Asia/Ho_Chi_Minh',1,gen_random_uuid(),repeat('a',64));
 if r->>'ok'='true' then raise exception 'customer bypassed full block'; end if;
 r:=public.customer_book('Public test','0917654321',st,1,gen_random_uuid(),repeat('b',64));
 if r->>'ok'<>'true' then raise exception 'public extra booking failed %',r; end if;
 begin
 perform public.admin_day_slots(d);
 raise exception 'nonowner allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
