-- Chạy sau migration + seed bằng SQL Editor (postgres) hoặc psql.
-- Chỉ chạy trên project thử nghiệm. Mọi dữ liệu test được ROLLBACK.
begin;
create temporary table test_results(label text not null);
create function pg_temp.assert_ok(ok boolean,label text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 insert into pg_temp.test_results values(label);
 raise notice 'PASS: %',label;
end $$;
create function pg_temp.expect_error(statement text,expected text,label text) returns void
language plpgsql as $$ declare msg text; state text; failed boolean:=false; begin
 begin execute statement;
 exception when others then
   get stacked diagnostics msg=message_text,state=returned_sqlstate;
   if position(expected in msg)=0 and expected<>state then
     raise exception 'FAIL: %; unexpected error % / %',label,state,msg; end if;
   failed:=true;
 end;
 if not failed then raise exception 'FAIL: %; no error',label; end if;
 perform pg_temp.assert_ok(true,label);
end $$;

select pg_temp.assert_ok(nail_private.normalize_phone('+84 901 234 567')='0901234567','Chuẩn hoá +84');
select pg_temp.assert_ok(nail_private.normalize_phone('84901234567')='0901234567','Chuẩn hoá 84');
select pg_temp.assert_ok(nail_private.normalize_phone('0901234567')='0901234567','Giữ số 0');
select pg_temp.assert_ok(nail_private.normalize_phone('0911111111') is null,'Chặn đuôi 8 chữ số lặp');
select pg_temp.assert_ok(nail_private.normalize_phone('090abc1234567') is null,'Không âm thầm xoá chữ cái');
select pg_temp.assert_ok(nail_private.normalize_phone('0123456789') is null,'Chặn đầu số sai');
select pg_temp.assert_ok(nail_private.normalize_phone(null) is null,'Chặn phone null');
select pg_temp.assert_ok((select count(*)=240 from public.availability),'Sinh 10 ngày x 24 giờ');
select pg_temp.assert_ok(not exists(select 1 from public.availability where local_time='12:00' and capacity<>1),'12h tối đa 1 người');
select pg_temp.assert_ok(not exists(select 1 from public.availability where extract(dow from local_date)=0
 and local_time>='13:00' and capacity<>0),'Chủ nhật không nhận từ 13h');
select pg_temp.assert_ok(not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
 and (schemaname<>'public' or tablename<>'availability')),'Realtime chỉ publish availability');
select pg_temp.assert_ok(not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='availability' and column_name in ('phone','customer_name','booking_id','secret_hash')),'Payload Realtime không chứa PII');

set local role anon;
select pg_temp.assert_ok((select count(*)>0 from public.availability),'Anon đọc được số chỗ');
select pg_temp.expect_error('select * from nail_private.bookings','42501','Anon không đọc được đơn');
select pg_temp.expect_error('update public.availability set reserved=0','42501','Anon không sửa sức chứa');
select pg_temp.expect_error('select public.refresh_availability()','42501','Anon không chạy maintenance');
select pg_temp.expect_error($q$select public.customer_lookup('0901234567',repeat('1',64))$q$,
 '42501','Anon không bỏ qua Edge để tra cứu RPC');
select pg_temp.expect_error($q$select public.customer_book('Test','0901234567',now(),1,
 gen_random_uuid(),repeat('1',64))$q$,'42501','Anon không bỏ qua Edge để đặt RPC');
select pg_temp.expect_error($q$select public.customer_cancel('0901234567',current_date,'09:00',repeat('1',64))$q$,
 '42501','Anon không bỏ qua Edge để huỷ RPC');
reset role;

set local role authenticated;
select pg_temp.assert_ok((select count(*)=0 from nail_private.bookings),'User thường không thấy đơn qua RLS');
select pg_temp.expect_error($q$select public.admin_list_bookings(current_date,current_date)$q$,
 '42501','User thường không dùng admin RPC');
select pg_temp.expect_error($q$insert into nail_private.owners values(gen_random_uuid())$q$,
 '42501','Không tự nâng thành chủ tiệm');
select pg_temp.expect_error($q$delete from nail_private.blocked_phones$q$,'42501','User thường không sửa blacklist');
reset role;

select set_config('test.day',((now() at time zone 'Asia/Ho_Chi_Minh')::date+1)::text,true);
select set_config('test.slot',((current_setting('test.day')::date+'10:00'::time)
 at time zone 'Asia/Ho_Chi_Minh')::text,true);
set local role service_role;
select set_config('test.first',public.customer_book('Khách kiểm thử','+84901234567',
 current_setting('test.slot')::timestamptz,1,'20000000-0000-4000-8000-000000000001',repeat('1',64))::text,true);
reset role;
select pg_temp.assert_ok((current_setting('test.first')::jsonb->>'ok')::boolean,'Đặt thành công qua service_role');
select set_config('test.id',current_setting('test.first')::jsonb->'booking'->>'id',true);
select pg_temp.assert_ok((select reserved=1 from public.availability where starts_at=current_setting('test.slot')::timestamptz),'Trừ đúng 1 chỗ');
select pg_temp.assert_ok((select count(*)=1 from nail_private.calendar_jobs where booking_id=current_setting('test.id')::uuid),'Ghi outbox cùng đơn');
select pg_temp.assert_ok((select event_id='dkn'||replace(id::text,'-','') and secret_hash is null
 from nail_private.bookings where id=current_setting('test.id')::uuid),'ID event ổn định; đơn mới không cần secret');
set local role service_role;
select set_config('test.retry',public.customer_book('Khách kiểm thử','0901234567',
 current_setting('test.slot')::timestamptz,1,'20000000-0000-4000-8000-000000000001',repeat('1',64))::text,true);
reset role;
select pg_temp.assert_ok((current_setting('test.retry')::jsonb->>'replayed')::boolean
 and current_setting('test.retry')::jsonb->'booking'->>'id'=current_setting('test.id'),'Retry trả đúng đơn cũ');
select pg_temp.assert_ok((select count(*)=1 from nail_private.bookings where phone='0901234567'),'Retry không nhân đôi đơn');
select pg_temp.assert_ok(public.customer_book('Tên khác','0901234567',current_setting('test.slot')::timestamptz,1,
 '20000000-0000-4000-8000-000000000001',repeat('1',64))->>'error'='idempotency_conflict','Cùng key khác payload bị từ chối');
select pg_temp.assert_ok(jsonb_array_length(public.customer_lookup('0901234567',repeat('1',64))->'bookings')=1,'Lookup trả danh sách lịch của phone');
select pg_temp.assert_ok(public.customer_lookup('0901234568',repeat('1',64))->'bookings'='[]'::jsonb,'Không trả lịch của phone khác');
select pg_temp.assert_ok((public.customer_lookup('0901234567',repeat('1',64))->>'ok')::boolean,'Chỉ cần đúng phone để tra cứu');
select pg_temp.assert_ok((public.customer_book('Khách thứ hai','0901234568',current_setting('test.slot')::timestamptz,1,
 gen_random_uuid(),repeat('2',64))->>'ok')::boolean,'Đặt chỗ cuối');
select pg_temp.assert_ok(public.customer_book('Khách thứ ba','0901234569',current_setting('test.slot')::timestamptz,1,
 gen_random_uuid(),repeat('3',64))->>'error'='slot_full','Hết chỗ bị chặn ở server');
select pg_temp.assert_ok((select reserved=2 from public.availability where starts_at=current_setting('test.slot')::timestamptz),'Không vượt sức chứa');
select pg_temp.assert_ok(public.customer_book('Khách test','0901234570',
 (current_setting('test.day')::date+'12:00'::time) at time zone 'Asia/Ho_Chi_Minh',2,
 gen_random_uuid(),repeat('4',64))->>'error'='slot_full','12h không nhận 2 người ở server');
select pg_temp.assert_ok(public.customer_book('Khách test','0901234570',now()-interval '1 day',1,
 gen_random_uuid(),repeat('4',64))->>'error'='outside_booking_window','Không đặt quá khứ');
select pg_temp.assert_ok(public.customer_book('Khách test','0901234570',now()+interval '11 days',1,
 gen_random_uuid(),repeat('4',64))->>'error'='outside_booking_window','Không vượt 10 ngày');
select pg_temp.assert_ok(public.customer_book('Khách test','0911111111',current_setting('test.slot')::timestamptz,1,
 gen_random_uuid(),repeat('4',64))->>'error'='invalid_phone','RPC chặn số lặp');
select pg_temp.assert_ok(public.customer_cancel('0901234567',current_setting('test.day')::date,
 '09:00',repeat('1',64))->>'error'='not_found','Sai giờ không huỷ lịch khác');

-- Cài chủ tiệm giả trong transaction thử nghiệm.
insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000001','owner-test@example.invalid');
insert into nail_private.owners(user_id) values('90000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_ok((select count(*)=2 from nail_private.bookings),'Chủ tiệm đọc được đơn qua RLS');
select pg_temp.assert_ok((select count(*)=2 from public.admin_list_bookings(current_setting('test.day')::date,
 current_setting('test.day')::date)),'Chủ tiệm xem ngày qua RPC');
select pg_temp.expect_error($q$select public.admin_configure('slot_override',jsonb_build_object(
 'date',current_setting('test.day'),'time','10:00','capacity',1))$q$,'23514','Không giảm sức chứa dưới số đã đặt');
select pg_temp.expect_error($q$select public.admin_configure('closed_day',jsonb_build_object(
 'date',current_setting('test.day'),'notice','Nghỉ thử'))$q$,'23514','Không đóng ngày có đơn chưa xử lý');
select public.admin_set_blocked_phone('0901234571',true,'Số thử nghiệm');
reset role;
select pg_temp.assert_ok(public.customer_book('Bị chặn','0901234571',
 (current_setting('test.day')::date+'11:00'::time) at time zone 'Asia/Ho_Chi_Minh',1,
 gen_random_uuid(),repeat('5',64))->>'error'='phone_blocked','Blacklist được kiểm tra ở server');
set local role authenticated;
select public.admin_set_blocked_phone('0901234571',false);
select set_config('test.move',public.admin_change_booking(current_setting('test.id')::uuid,'move',1,
 (current_setting('test.day')::date+'11:00'::time) at time zone 'Asia/Ho_Chi_Minh')::text,true);
select pg_temp.expect_error($q$select public.admin_change_booking(current_setting('test.id')::uuid,'cancel',1)$q$,
 'version_conflict','Admin không ghi đè dữ liệu đã đổi');
reset role;
select pg_temp.assert_ok((select reserved=1 from public.availability where starts_at=current_setting('test.slot')::timestamptz)
 and (select reserved=1 from public.availability where local_date=current_setting('test.day')::date and local_time='11:00'),'Dời trả chỗ cũ và giữ chỗ mới');
select pg_temp.assert_ok((select desired_version=2 and processed_version=0 from nail_private.calendar_jobs
 where booking_id=current_setting('test.id')::uuid),'Dời cập nhật phiên bản outbox');
select pg_temp.assert_ok((public.customer_cancel('0901234567',current_setting('test.day')::date,
 '11:00',repeat('1',64))->>'ok')::boolean,'Khách huỷ trước giờ hẹn');
select pg_temp.assert_ok((public.customer_cancel('0901234567',current_setting('test.day')::date,
 '11:00',repeat('1',64))->>'ok')::boolean,'Huỷ lặp an toàn');
select pg_temp.assert_ok((select version=3 and status='cancelled' from nail_private.bookings where id=current_setting('test.id')::uuid)
 and (select reserved=0 from public.availability where local_date=current_setting('test.day')::date and local_time='11:00'),'Huỷ lặp chỉ trả chỗ một lần');
select pg_temp.assert_ok((select desired_version=3 from nail_private.calendar_jobs where booking_id=current_setting('test.id')::uuid),'Huỷ vẫn giữ tác vụ xoá event');

-- Tạo slot gần hiện tại, chỉ trong dữ liệu test, để kiểm tra chính xác mốc 4 giờ.
select set_config('test.near',(date_trunc('hour',now())+interval '2 hours')::text,true);
update public.availability set capacity=2 where starts_at=current_setting('test.near')::timestamptz;
select set_config('test.near_result',public.customer_book('Gần giờ','0901234572',current_setting('test.near')::timestamptz,1,
 gen_random_uuid(),repeat('6',64))::text,true);
select pg_temp.assert_ok((current_setting('test.near_result')::jsonb->>'ok')::boolean,'Tạo đơn sát giờ để kiểm tra');
select pg_temp.assert_ok(public.customer_cancel('0901234572',
 (current_setting('test.near')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date,
 (current_setting('test.near')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::time,
 repeat('6',64))->>'ok'='true','Khách huỷ sát giờ với CANCEL_MIN_HOURS=0');
set local role authenticated;
select pg_temp.assert_ok((public.admin_change_booking((current_setting('test.near_result')::jsonb->'booking'->>'id')::uuid,
 'cancel',2)->>'ok')::boolean,'Chủ tiệm huỷ lặp không trả chỗ lần hai');
reset role;

-- Mốc đúng 4 giờ dùng now() cố định trong transaction.
insert into public.availability(starts_at,local_date,local_time,capacity)
values(now()+interval '4 hours',((now()+interval '4 hours') at time zone 'Asia/Ho_Chi_Minh')::date,
 ((now()+interval '4 hours') at time zone 'Asia/Ho_Chi_Minh')::time,1);
select pg_temp.assert_ok((public.customer_book('Đúng bốn giờ','0901234582',now()+interval '4 hours',1,
 gen_random_uuid(),repeat('8',64))->>'ok')::boolean,'Tạo đơn ở mốc đúng 4 giờ');
select pg_temp.assert_ok((public.customer_cancel('0901234582',
 ((now()+interval '4 hours') at time zone 'Asia/Ho_Chi_Minh')::date,
 ((now()+interval '4 hours') at time zone 'Asia/Ho_Chi_Minh')::time,repeat('8',64))->>'ok')::boolean,
 'Cho phép huỷ khi còn đúng 4 giờ');
-- Giới hạn 3 lịch tương lai / số điện thoại, kể cả khi đổi IP.
do $$ declare i integer; r jsonb; begin
 for i in 1..3 loop
  r:=public.customer_book('Giới hạn lịch','0901234583',
   ((current_setting('test.day')::date+i)+'09:00'::time) at time zone 'Asia/Ho_Chi_Minh',1,
   gen_random_uuid(),nail_private.hash_text('limit-ip-'||i));
  perform pg_temp.assert_ok((r->>'ok')::boolean,'Tạo lịch trong giới hạn '||i);
 end loop;
 r:=public.customer_book('Giới hạn lịch','0901234583',
   ((current_setting('test.day')::date+4)+'09:00'::time) at time zone 'Asia/Ho_Chi_Minh',1,
   gen_random_uuid(),nail_private.hash_text('limit-ip-4'));
 perform pg_temp.assert_ok(r->>'error'='too_many_active_bookings','Đổi IP không vượt giới hạn 3 lịch');
end $$;
-- IP bị chặn ngay ở lượt 31, kể cả thay số điện thoại.
do $$ declare i integer; r jsonb; begin
 for i in 1..30 loop
  r:=public.customer_lookup('090123'||lpad(i::text,4,'0'),repeat('7',64));
 end loop;
 perform pg_temp.assert_ok(r->'bookings'='[]'::jsonb,'30 lượt trên IP được ghi nhận');
 r:=public.customer_lookup('0901230031',repeat('7',64));
 perform pg_temp.assert_ok(r->>'error'='rate_limited','Đổi phone không vượt giới hạn IP');
end $$;

-- Rate limiting vẫn ghi nhận cả các lượt tra cứu phone không có lịch.
do $$ declare i integer; r jsonb; begin
 for i in 1..10 loop
  r:=public.customer_lookup('0901234599',repeat('9',64));
 end loop;
 perform pg_temp.assert_ok(r->'bookings'='[]'::jsonb,'10 lượt phone không có lịch được ghi nhận');
 r:=public.customer_lookup('0901234599',repeat('9',64));
 perform pg_temp.assert_ok(r->>'error'='rate_limited','Lượt thứ 11 bị giới hạn');
end $$;
select pg_temp.assert_ok(not exists(select 1 from public.availability a
 where a.reserved<>(select coalesce(sum(b.people),0) from nail_private.bookings b
 where b.starts_at=a.starts_at and b.status='confirmed')),'Bất biến: reserved bằng tổng người của đơn còn hiệu lực');
select pg_temp.assert_ok(not exists(select 1 from nail_private.bookings b left join nail_private.calendar_jobs j
 on j.booking_id=b.id where j.booking_id is null or j.desired_version<>b.version),'Mọi đơn luôn có tác vụ đúng phiên bản');
select pg_temp.expect_error($q$delete from nail_private.bookings where id=current_setting('test.id')::uuid$q$,
 'use_soft_cancel','Không xoá cứng đơn làm mất tác vụ xoá Calendar');

-- RLS kiểm tra lại khi ĐÃ CÓ dữ liệu thật trong transaction, không chỉ bảng rỗng.
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000099',true);
set local role authenticated;
select pg_temp.assert_ok((select count(*)=0 from nail_private.bookings),'User khác không đọc được đơn đã tồn tại');
select pg_temp.assert_ok((select count(*)=0 from nail_private.calendar_jobs),'User khác không đọc được outbox');
select pg_temp.assert_ok((select count(*)=0 from nail_private.audit_log),'User khác không đọc được audit');
reset role;
select label from pg_temp.test_results order by label;
rollback;
