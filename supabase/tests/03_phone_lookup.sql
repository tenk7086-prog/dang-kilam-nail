begin;
create temporary table test_results(label text not null);
create function pg_temp.assert_ok(ok boolean,label text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 insert into pg_temp.test_results values(label);
end $$;
select pg_temp.assert_ok((select cancel_before_hours=0 from public.shop_settings),'CANCEL_MIN_HOURS mặc định 0');
select pg_temp.assert_ok(to_regprocedure('public.customer_lookup(text,text,text)') is null,'RPC lookup cũ đã xoá');
select pg_temp.assert_ok(to_regprocedure('public.customer_book(text,text,timestamptz,integer,uuid,text,text)') is null,'RPC book cũ đã xoá');
select pg_temp.assert_ok(to_regprocedure('public.customer_cancel(text,text,date,time,text)') is null,'RPC cancel cũ đã xoá');
select set_config('test.day',((now() at time zone 'Asia/Ho_Chi_Minh')::date+1)::text,true);
do $$ begin
 for i in 0..2 loop
 perform public.customer_book('Ba lịch','0907654321',(current_setting('test.day')::date+('09:00'::time+make_interval(hours=>i))) at time zone 'Asia/Ho_Chi_Minh',1,gen_random_uuid(),null);
 end loop;
end $$;
select pg_temp.assert_ok(jsonb_array_length(public.customer_lookup('+84907654321',null)->'bookings')=3,'Lookup chuẩn hoá phone và trả đủ ba lịch');
select pg_temp.assert_ok(public.customer_lookup('0907654322',null)->'bookings'='[]'::jsonb,'Không trả lịch của số khác');
select pg_temp.assert_ok((select bool_and(value->>'phone'='0907654321') from jsonb_array_elements(public.customer_lookup('0907654321',null)->'bookings')),'Mọi phần tử thuộc đúng phone');
select pg_temp.assert_ok((public.customer_lookup('0907654321',null)->'bookings'->0->>'starts_at')::timestamptz<(public.customer_lookup('0907654321',null)->'bookings'->2->>'starts_at')::timestamptz,'Danh sách tăng dần theo giờ');
select pg_temp.assert_ok(public.customer_cancel('0907654321',current_setting('test.day')::date,'10:00',null)->>'ok'='true','Huỷ riêng lịch ở giữa');
select pg_temp.assert_ok(jsonb_array_length(public.customer_lookup('0907654321',null)->'bookings')=2,'Lookup loại lịch đã huỷ, giữ hai lịch khác');
select pg_temp.assert_ok(public.customer_cancel('0907654321',current_setting('test.day')::date,'10:00',null)->>'ok'='true','Huỷ lặp là no-op an toàn');
select pg_temp.assert_ok(public.customer_book('Đặt lại','0907654321',(current_setting('test.day')::date+'10:00'::time) at time zone 'Asia/Ho_Chi_Minh',1,gen_random_uuid(),null)->>'ok'='true','Đặt lại giờ đã huỷ');
select pg_temp.assert_ok(public.customer_cancel('0907654321',current_setting('test.day')::date,'10:00',null)->>'ok'='true','Huỷ đúng đơn active khi có lịch sử cùng giờ');
insert into public.availability(starts_at,local_date,local_time,capacity)
values(now()+interval '1 second',((now()+interval '1 second') at time zone 'Asia/Ho_Chi_Minh')::date,((now()+interval '1 second') at time zone 'Asia/Ho_Chi_Minh')::time,2);
select set_config('test.near',public.customer_book('Sát giờ','0907654330',now()+interval '1 second',1,gen_random_uuid(),null)::text,true);
select pg_temp.assert_ok((current_setting('test.near')::jsonb->'booking'->>'can_cancel')::boolean,'Một giây trước lịch vẫn được huỷ');
update public.shop_settings set cancel_before_hours=4;
select pg_temp.assert_ok(public.customer_cancel('0907654330',((now()+interval '1 second') at time zone 'Asia/Ho_Chi_Minh')::date,((now()+interval '1 second') at time zone 'Asia/Ho_Chi_Minh')::time,null)->>'error'='cancellation_too_late','Đổi một cấu hình thành 4 giờ có hiệu lực ở server');
update public.shop_settings set cancel_before_hours=0;
-- Fixture simulates time reaching appointment, without changing the real clock.
insert into public.availability(starts_at,local_date,local_time,capacity)
values(now(),(now() at time zone 'Asia/Ho_Chi_Minh')::date,(now() at time zone 'Asia/Ho_Chi_Minh')::time,2);
alter table nail_private.bookings disable trigger user;
update nail_private.bookings set starts_at=now() where id=(current_setting('test.near')::jsonb->'booking'->>'id')::uuid;
alter table nail_private.bookings enable trigger user;
select pg_temp.assert_ok(public.customer_cancel('0907654330',(now() at time zone 'Asia/Ho_Chi_Minh')::date,(now() at time zone 'Asia/Ho_Chi_Minh')::time,null)->>'error'='cancellation_too_late','Đúng giờ bắt đầu không được huỷ');
select pg_temp.assert_ok(public.customer_lookup('0907654330',null)->'bookings'='[]'::jsonb,'Lookup không trả lịch đã bắt đầu');
select pg_temp.assert_ok(not (nail_private.booking_result(b)->'booking'->>'can_cancel')::boolean,'can_cancel và customer_cancel cùng chặn giờ bắt đầu') from nail_private.bookings b where b.id=(current_setting('test.near')::jsonb->'booking'->>'id')::uuid;
select label from pg_temp.test_results;
rollback;
