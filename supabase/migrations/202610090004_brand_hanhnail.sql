-- Đổi tên hiển thị của tiệm; không thay đổi dữ liệu lịch, event_id hoặc Google Calendar.
begin;
update public.shop_settings set name = 'Hanhnail' where id = true;
commit;
