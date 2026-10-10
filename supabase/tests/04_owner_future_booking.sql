begin;
create temporary table test_results(label text not null);
create function pg_temp.assert_ok(ok boolean,label text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 insert into pg_temp.test_results values(label);
end $$;
insert into auth.users(id,email) values('91000000-0000-4000-8000-000000000001','future-owner@example.invalid');
insert into nail_private.owners(user_id) values('91000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.day',((now() at time zone 'Asia/Ho_Chi_Minh')::date+30)::text,true);
select set_config('test.key','91000000-0000-4000-8000-000000000001',true);
select set_config('test.created',public.admin_create_booking('Lịch xa','0907654399',current_setting('test.day')::date,'09:00',1,current_setting('test.key')::uuid)::text,true);
select pg_temp.assert_ok((current_setting('test.created')::jsonb->>'ok')::boolean,'Chủ tiệm tạo lịch xa hơn 10 ngày');
select pg_temp.assert_ok((current_setting('test.created')::jsonb->'booking'->>'status')='confirmed','Lịch xa được xác nhận');
reset role;
select pg_temp.assert_ok((select starts_at=(current_setting('test.day')::date+'09:00'::time) at time zone 'Asia/Ho_Chi_Minh'
 from nail_private.bookings where phone='0907654399'),'Lịch xa lưu đúng ngày giờ');
select pg_temp.assert_ok((select capacity=2 and reserved=1 from public.availability
 where local_date=current_setting('test.day')::date and local_time='09:00'),'Tạo slot xa và trừ chỗ đúng');
select pg_temp.assert_ok((public.admin_create_booking('Lịch xa','0907654399',current_setting('test.day')::date,'09:00',1,current_setting('test.key')::uuid)->>'replayed')::boolean,'Retry lịch xa không tạo trùng');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_ok(public.customer_book('Khách công khai','0907654388',
 (current_setting('test.day')::date+'09:00'::time) at time zone 'Asia/Ho_Chi_Minh',1,gen_random_uuid(),null)->>'error'='outside_booking_window','Khách vẫn bị giới hạn 10 ngày');
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_ok(public.admin_create_booking('Sai giờ','0907654387',current_setting('test.day')::date,'20:00',1,gen_random_uuid())->>'error'='slot_unavailable','Chủ tiệm không tạo ngoài giờ mở cửa');
select set_config('test.moved',public.admin_change_booking((current_setting('test.created')::jsonb->'booking'->>'id')::uuid,'move',1,
 ((current_setting('test.day')::date+1)+'10:00'::time) at time zone 'Asia/Ho_Chi_Minh')::text,true);
select pg_temp.assert_ok((current_setting('test.moved')::jsonb->>'ok')::boolean,'Chủ tiệm dời lịch xa');
reset role;
select pg_temp.assert_ok((select reserved=0 from public.availability where local_date=current_setting('test.day')::date and local_time='09:00')
 and (select reserved=1 from public.availability where local_date=current_setting('test.day')::date+1 and local_time='10:00'),'Dời lịch xa cập nhật sức chứa');

select pg_temp.assert_ok((select desired_version=2 from nail_private.calendar_jobs where booking_id=(current_setting('test.created')::jsonb->'booking'->>'id')::uuid),'Lịch xa dời vẫn có outbox Calendar');
select pg_temp.assert_ok(public.admin_create_booking('Hết chỗ','0907654301',current_setting('test.day')::date+1,'10:00',2,gen_random_uuid())->>'error'='slot_full','Lịch xa không vượt sức chứa');
select pg_temp.assert_ok(public.admin_create_booking('Khung trưa','0907654302',current_setting('test.day')::date,'12:00',2,gen_random_uuid())->>'error'='slot_full','Lịch xa áp dụng giới hạn 12 giờ');
select pg_temp.assert_ok(public.admin_create_booking('Quá xa','0907654303',(now() at time zone 'Asia/Ho_Chi_Minh')::date+731,'09:00',1,gen_random_uuid())->>'error'='future_date_too_far','Giới hạn 730 ngày ở server');
do $$ begin
 begin
 perform public.admin_configure('closed_day',jsonb_build_object('date',current_setting('test.day')::date+1));
 raise exception 'expected capacity constraint';
 exception when check_violation then perform pg_temp.assert_ok(true,'Không đóng ngày xa đang có khách'); end;
end $$;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$ begin
 begin
 perform public.admin_create_booking('Không quyền','0907654304',current_setting('test.day')::date,'09:00',1,gen_random_uuid());
 raise exception 'expected permission error';
 exception when insufficient_privilege then perform pg_temp.assert_ok(true,'Tài khoản thường không tạo lịch xa'); end;
end $$;
set local role anon;
do $$ begin
 begin
 perform public.admin_create_booking('Không quyền','0907654304',current_setting('test.day')::date,'09:00',1,gen_random_uuid());
 raise exception 'expected permission error';
 exception when insufficient_privilege then perform pg_temp.assert_ok(true,'Anon không gọi RPC tạo lịch'); end;
end $$;
reset role;
select pg_temp.assert_ok(public.customer_cancel('0907654399',current_setting('test.day')::date+1,'10:00',null)->>'ok'='true','Khách huỷ được lịch xa do chủ tạo');
select pg_temp.assert_ok((select desired_version=3 from nail_private.calendar_jobs where booking_id=(current_setting('test.created')::jsonb->'booking'->>'id')::uuid),'Huỷ lịch xa xếp hàng xoá Calendar');
select label from pg_temp.test_results;
rollback;
