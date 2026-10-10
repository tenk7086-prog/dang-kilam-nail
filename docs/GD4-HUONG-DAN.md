# GĐ4 — Trang quản trị Hanhnail

## Chức năng

Mở `/admin.html` để chủ tiệm đăng nhập. Trang có lịch theo khoảng ngày tối đa 32 ngày, lọc đúng số điện thoại, CSV, huỷ/dời lịch, số bị chặn, thông báo, số điện thoại/Zalo, giờ mở cửa và sức chứa theo giờ.

Mọi thao tác thay đổi gọi RPC owner-gated. Frontend không chứa `service_role`, khoá Google hoặc mật khẩu database. Token đăng nhập chỉ nằm trong `sessionStorage` của tab hiện tại.

## Tạo tài khoản chủ tiệm

1. Supabase Dashboard → Authentication → Users → Add user.
2. Tạo email và mật khẩu riêng cho chủ tiệm.
3. Lấy UUID của user vừa tạo.
4. Mở SQL Editor, chạy:

```sql
insert into nail_private.owners(user_id)
values ('UUID_CUA_USER');
```

5. Tắt public sign-up trong Authentication → Providers/Settings. Không đưa UUID, email hay mật khẩu vào website công khai.

## Cấu hình frontend

Điền `web/public/site-config.json`:

```json
{
  "supabaseUrl": "https://PROJECT_REF.supabase.co",
  "publishableKey": "sb_publishable_...",
  "siteUrl": "https://ten-mien-cua-ban.example"
}
```

Chạy `npm run build`, sau đó mở `/admin.html`. Nếu đăng nhập được nhưng báo không có quyền, kiểm tra user đã có trong `nail_private.owners` chưa.

## Kiểm tra

- Chủ tiệm xem được lịch của mình trong ngày/tuần.
- Số điện thoại không hợp lệ bị chặn trước khi gọi RPC.
- Huỷ/dời dùng `version`, nên thao tác cạnh tranh sẽ báo cần tải lại thay vì ghi đè.
- Dời lịch cập nhật sức chứa cũ/mới và tạo tác vụ Calendar qua trigger/outbox.
- CSV chỉ tạo trong trình duyệt của phiên admin hiện tại.
- Tài khoản thường hoặc anon không đọc được bảng `nail_private` và không gọi được RPC admin.

## Ghi chú

Trang admin đã build production. Kiểm thử SQL/Edge hiện đạt 72/72, 33/33 và 28/28. Kiểm thử trình duyệt tự động chưa chạy được trong môi trường dựng hiện tại vì Chromium nhúng bị SIGSEGV khi khởi động; cần kiểm tra lại bằng Chrome/Edge thật sau khi triển khai.

## Tạo lịch xa hơn 10 ngày

Trong dashboard, phần **Tạo lịch thủ công** chỉ dành cho tài khoản chủ tiệm. Chọn họ tên, số điện thoại, ngày xa hơn, giờ và số người rồi bấm **Tạo lịch và đồng bộ Calendar**. Server vẫn kiểm tra ngày tương lai (tối đa 730 ngày), giờ mở cửa, ngày nghỉ, sức chứa, blacklist, tối đa 3 lịch active theo số điện thoại và idempotency. Khách công khai vẫn chỉ thấy 10 ngày tới. Lịch tạo thủ công đi qua cùng trigger/outbox nên nếu Calendar lỗi sẽ được worker tự thử lại.
