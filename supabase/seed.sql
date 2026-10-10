-- Dữ liệu mẫu cho project mới. Không tạo khách/đơn giả trong dữ liệu thật.
begin;
insert into public.shop_settings(id,name) values(true,'Hanhnail') on conflict do nothing;
insert into public.weekly_hours(weekday,opens,closes,capacity)
select d,'09:00'::time,case when d=0 then '13:00'::time else '20:00'::time end,2
from generate_series(0,6) d on conflict do nothing;
insert into public.capacity_rules(local_time,capacity) values('12:00',1) on conflict do nothing;
insert into public.services(id,name,description,price_vnd,sort_order) values
 ('10000000-0000-4000-8000-000000000001','Sơn gel','Giá mẫu — chủ tiệm cần xác nhận trước khi công bố.',120000,1),
 ('10000000-0000-4000-8000-000000000002','Chăm sóc móng','Giá mẫu — chủ tiệm cần xác nhận trước khi công bố.',80000,2),
 ('10000000-0000-4000-8000-000000000003','Thiết kế móng','Giá mẫu, thay đổi theo mẫu và phụ kiện.',200000,3)
on conflict do nothing;
select public.refresh_availability();
commit;
