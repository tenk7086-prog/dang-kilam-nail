-- Bước 1: Dashboard > Authentication > Users > Add user, tạo tài khoản chủ tiệm.
-- Bước 2: Thay chuỗi bên dưới bằng email THẬT, chạy trong SQL Editor.
-- Không chạy qua frontend. Không đặt mật khẩu trong file SQL hoặc GitHub.
do $$
declare owner_email text := 'tenk7086@gmail.com'; owner_id uuid;
begin
 select id into owner_id from auth.users where lower(email)=lower(owner_email);
 if owner_id is null then raise exception 'Chưa tìm thấy tài khoản. Hãy tạo user và sửa email trong file.'; end if;
 insert into nail_private.owners(user_id) values(owner_id) on conflict do nothing;
end $$;
