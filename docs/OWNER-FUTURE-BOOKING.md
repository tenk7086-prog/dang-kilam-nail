# Hanhnail — cập nhật chức năng đặt lịch xa

Chủ tiệm đăng nhập admin có thể tạo/dời lịch tối đa 730 ngày tới. Khách vẫn tự đặt trong 10 ngày. Giữ kiểm tra giờ mở cửa, ngày nghỉ, số chỗ, số bị chặn, tối đa ba lịch sắp tới mỗi số điện thoại và chống gửi trùng. Calendar dùng hàng đợi cũ, không cần tạo lịch Google mới.

## Cài bản cập nhật

1. Sao lưu database và thư mục mã nguồn đang dùng. Giữ riêng khoá Google và `.env`.
2. Giải nén ZIP mới. Copy mã nguồn vào thư mục dự án của bạn; giữ `web/public/site-config.json` đúng dự án.
3. Mở Supabase → SQL Editor → New query. Nếu migration 003 (phone lookup) và 004 (Hanhnail) chưa được áp dụng, chạy lần lượt hai file đó trước. Không chạy lại migration đã áp dụng; không chạy lại core, seed hoặc bootstrap_owner.
4. Mở file `supabase/migrations/202610090005_owner_future_booking.sql` bằng Notepad. Copy toàn bộ, dán vào truy vấn mới của SQL Editor rồi bấm Run một lần. Chờ thông báo thành công. Nếu lỗi, dừng và gửi nội dung lỗi; chưa triển khai giao diện mới.
5. Mở Terminal trong thư mục có `package.json`, chạy từng lệnh:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
```

6. Triển khai lại frontend theo cách bạn đang dùng trong `docs/GD6-HUONG-DAN.md`. Bản nâng cấp lịch xa không cần triển khai lại Edge Function. Nếu chưa từng triển khai bản phone-only, làm thêm bước cập nhật customer-api trong `docs/UPDATE-20261009.md`.
7. Mở trang `/admin.html`, tải lại trang và đăng nhập bằng tài khoản chủ tiệm hiện tại. Trong **Tạo lịch thủ công**, nhập tên, số điện thoại, ngày xa hơn 10 ngày, giờ tròn (ví dụ 10:00), số người rồi bấm **Tạo lịch và đồng bộ Calendar**.

## Kiểm tra sau cập nhật

- Dùng tên/số của bạn, chọn ngày mở cửa sau khoảng một tháng. Sau thành công, danh sách tự chuyển đến ngày đó.
- Kiểm tra sự kiện trên Google Calendar sau khi worker xử lý hàng đợi. Dời rồi huỷ lịch thử và kiểm tra sự kiện cũng được cập nhật/xoá.
- Thử khung 12:00 với số người vượt mức cấu hình: hệ thống phải từ chối.
- Trang khách vẫn chỉ có 10 ngày; tra cứu bằng số của bạn phải thấy lịch xa do chủ tiệm tạo.
- Thử bằng tài khoản không phải chủ tiệm: không được tạo lịch.

Không cần tạo lại Supabase, Google Calendar, service account hoặc tài khoản admin.

## Kiểm thử đã thực hiện

141/141 kiểm tra SQL nhúng và 31/31 kiểm tra Node/Edge đạt; build đạt. Có kiểm tra quyền owner/anon, giới hạn cửa sổ khách, idempotency, sức chứa, giờ mở cửa, dời/huỷ và outbox. Đây không phải kiểm thử trên Supabase/Google thật hoặc tải nhiều kết nối. Chưa xác nhận bố cục bằng trình duyệt do môi trường thiếu Chromium; cần kiểm tra trên máy triển khai.
