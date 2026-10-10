begin;
create temporary table test_results(label text not null);
create function pg_temp.assert_ok(ok boolean,label text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 insert into pg_temp.test_results values(label);
end $$;
create function pg_temp.denied(statement text,label text) returns void
language plpgsql as $$ declare failed boolean:=false; begin
 begin execute statement; exception when insufficient_privilege then failed:=true; end;
 perform pg_temp.assert_ok(failed,label);
end $$;
set local role anon;
select pg_temp.denied('select public.calendar_claim()','Anon không claim job');
select pg_temp.denied('select public.calendar_queue_status()','Anon không xem hàng đợi');
select pg_temp.denied($q$select public.calendar_finish(gen_random_uuid(),gen_random_uuid(),1,true)$q$,'Anon không ACK job');
reset role;
set local role authenticated;
select pg_temp.denied('select public.calendar_claim()','User đăng nhập không claim job');
select pg_temp.denied($q$select public.calendar_check_lease(gen_random_uuid(),gen_random_uuid(),1)$q$,'User không đọc lease');
reset role;
select pg_temp.assert_ok(public.calendar_claim() is null,'Hàng đợi rỗng trả null');
select set_config('test.slot',((((now() at time zone 'Asia/Ho_Chi_Minh')::date+1)+'09:00'::time)
 at time zone 'Asia/Ho_Chi_Minh')::text,true);
select set_config('test.result',public.customer_book('Calendar Test','0902345678',current_setting('test.slot')::timestamptz,
 1,gen_random_uuid(),null)::text,true);
select pg_temp.assert_ok((current_setting('test.result')::jsonb->>'ok')::boolean,'Phone limit hoạt động khi không có trusted IP');
select set_config('test.id',current_setting('test.result')::jsonb->'booking'->>'id',true);
set local role service_role;
select set_config('test.job',public.calendar_claim()::text,true);
reset role;
select pg_temp.assert_ok(current_setting('test.job')::jsonb->>'booking_id'=current_setting('test.id'),'Service claim đúng đơn');
select pg_temp.assert_ok(current_setting('test.job')::jsonb->>'version'='1','Snapshot chứa version');
select pg_temp.assert_ok(public.calendar_claim() is null,'Không claim lại khi lease còn hiệu lực');
select pg_temp.assert_ok(public.calendar_check_lease(current_setting('test.id')::uuid,
 (current_setting('test.job')::jsonb->>'lease_token')::uuid,1),'Lease đúng hợp lệ');
select pg_temp.assert_ok(not public.calendar_check_lease(current_setting('test.id')::uuid,gen_random_uuid(),1),'Token giả bị từ chối');
select pg_temp.assert_ok(not public.calendar_finish(current_setting('test.id')::uuid,gen_random_uuid(),1,true),'ACK giả bị từ chối');
select pg_temp.assert_ok(not public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job')::jsonb->>'lease_token')::uuid,2,true),'ACK sai version bị từ chối');
select pg_temp.assert_ok(public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job')::jsonb->>'lease_token')::uuid,1,false,'google_http_503'),'Lưu thất bại');
select pg_temp.assert_ok((select processed_version=0 and last_error_code='google_http_503' and next_attempt_at>now()
 from nail_private.calendar_jobs where booking_id=current_setting('test.id')::uuid),'Lỗi giữ pending và backoff');
select pg_temp.assert_ok((select count(*)=1 from nail_private.calendar_error_log),'Ghi log retry');
select pg_temp.assert_ok(public.calendar_claim() is null,'Không retry trước hạn');
update nail_private.calendar_jobs set next_attempt_at=now()-interval '1 second';
select set_config('test.job2',public.calendar_claim()::text,true);
select pg_temp.assert_ok((current_setting('test.job2')::jsonb->>'lease_token')<>(current_setting('test.job')::jsonb->>'lease_token'),'Retry cấp token mới');
select pg_temp.assert_ok(not public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job')::jsonb->>'lease_token')::uuid,1,true),'Worker cũ không ACK lease mới');
-- Khách huỷ trong khi phiên bản tạo event đang chạy.
select set_config('test.cancel_result',public.customer_cancel('0902345678',
 ((now() at time zone 'Asia/Ho_Chi_Minh')::date+1),'09:00',null)::text,true);
select pg_temp.assert_ok((current_setting('test.cancel_result')::jsonb->>'ok')::boolean,'Huỷ trong lúc worker chạy');
select pg_temp.assert_ok(not public.calendar_check_lease(current_setting('test.id')::uuid,
 (current_setting('test.job2')::jsonb->>'lease_token')::uuid,1),'Version cũ không được phép tiếp tục ghi Google');
select pg_temp.assert_ok(public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job2')::jsonb->>'lease_token')::uuid,1,true),'Kết quả phiên bản cũ chỉ ACK bản cũ');
select pg_temp.assert_ok((select processed_version=1 and desired_version=2 from nail_private.calendar_jobs),'Bản huỷ vẫn pending');
select set_config('test.job3',public.calendar_claim()::text,true);
select pg_temp.assert_ok(current_setting('test.job3')::jsonb->>'status'='cancelled','Worker kế tiếp nhận trạng thái huỷ');
select pg_temp.assert_ok(public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job3')::jsonb->>'lease_token')::uuid,2,true),'ACK bản huỷ');
select pg_temp.assert_ok((select processed_version=2 and last_error_code is null and reconcile_at>now()
 from nail_private.calendar_jobs),'Thành công xoá lỗi và lên lịch đối soát');
select pg_temp.assert_ok(public.calendar_claim() is null,'Không chạy lại ngay sau thành công');
update nail_private.calendar_jobs set reconcile_at=now()-interval '1 second';
select set_config('test.job4',public.calendar_claim()::text,true);
select pg_temp.assert_ok(current_setting('test.job4')::jsonb->>'version'='2','Đối soát cả đơn đã huỷ để tìm event xuất hiện muộn');
update nail_private.calendar_jobs set leased_until=now()-interval '1 second';
select pg_temp.assert_ok(not public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job4')::jsonb->>'lease_token')::uuid,2,true),'Lease hết hạn không ACK');
select set_config('test.job5',public.calendar_claim()::text,true);
select pg_temp.assert_ok(current_setting('test.job5')::jsonb->>'lease_token'<>current_setting('test.job4')::jsonb->>'lease_token','Worker chết được nhận lại tác vụ');
select public.calendar_finish(current_setting('test.id')::uuid,
 (current_setting('test.job5')::jsonb->>'lease_token')::uuid,2,false,'Error with phone +84901234567');
select pg_temp.assert_ok((select last_error_code='sync_failed' from nail_private.calendar_jobs),'Không ghi chuỗi lỗi có PII');
select pg_temp.assert_ok((public.calendar_queue_status()->>'errors')::integer=1,'Thống kê lỗi không có PII');
select label from pg_temp.test_results order by label;
rollback;
