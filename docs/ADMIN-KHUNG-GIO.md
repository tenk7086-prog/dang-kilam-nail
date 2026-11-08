# Hanhnail — Khóa chỗ và mở ca theo ngày

Chỉ cập nhật các file đi kèm, dựa trên commit 0b2d896. Không thay site-config.json hoặc khóa bí mật. Không cần deploy Edge Functions.

## 1. Sao lưu và chép file
Sao lưu thư mục dự án hiện tại. Giải nén ZIP, chép các thư mục web, supabase, tools, docs vào F:\nail\Hanhnail-GitHub và đồng ý thay các file trùng tên.

## 2. Cập nhật Supabase trước
Mở dự án Supabase > SQL Editor > New query.
Mở supabase/migrations/202611080008_day_slots.sql bằng Notepad, sao chép toàn bộ vào query rồi Run một lần.
Không chạy lại migrations cũ hoặc seed. Migration này tạo bảng riêng có RLS, không xóa đơn khách.

## 3. Kiểm tra và đưa giao diện lên GitHub
Mở CMD:
```
cd /d F:\nail\Hanhnail-GitHub
npm.cmd test
npm.cmd run build
git add web/admin.html web/src/admin.js web/src/admin.css supabase/migrations/202611080008_day_slots.sql supabase/tests/06_day_slots.sql tools/test-db.mjs docs/ADMIN-KHUNG-GIO.md
git commit -m "Add per-day slot blocks and extra hours"
git push origin main
```
Đợi GitHub Actions build và deploy xanh. Mở admin.html, Ctrl+F5 rồi đăng nhập lại nếu cần.

## 4. Sử dụng
- Tìm mục Khung giờ theo ngày. Chọn ngày, bấm Tải khung giờ.
- Bấm Khóa 1 chỗ: giảm đúng một chỗ trống. Bấm lần nữa sau khi lưu xong để khóa tiếp.
- Bấm Mở lại 1 chỗ: trả một chỗ do chủ tiệm đã khóa, không huỷ lịch khách.
- Mở thêm khung giờ: nhập giờ nguyên (ví dụ 21:00), số chỗ rồi lưu. Ca đã tồn tại sẽ bị từ chối, tránh tăng sức chứa nhầm.
- Ngày khóa cả ngày: phải mở lại trong mục Ngày nghỉ trước. Chỉnh riêng khung giờ không vượt qua khóa cả ngày.
- Chọn được ngày trong 2 năm tới; khách vẫn chỉ thấy cửa sổ 10 ngày.
- Không tạo sự kiện Calendar cho chỗ khóa/ca trống. Khách đặt vào ca thêm vẫn dùng đồng bộ Calendar hiện có.
- Nếu lỗi hoặc mất mạng: bấm Tải khung giờ để đối chiếu trước khi thử lại. Yêu cầu khóa dùng số chỗ đã khóa kỳ vọng để chống thao tác lặp/cũ.

## 5. Kiểm tra kết quả
Chọn ca tương lai chưa có khách: khóa 1 chỗ, tải lại, kiểm tra số còn lại. Mở lại sau khi kiểm tra.
Thêm ca ở ngày khác ngoài giờ thông thường, kiểm tra ngày kế tiếp không có ca đó.
Kiểm tra trên web khách khi ngày đó nằm trong cửa sổ 10 ngày; tải lại trang nếu đang giữ dữ liệu cũ.
Thử giao diện 390px, 768px và 1440px. Các nút cần hiện đầy đủ, không cuộn ngang.

## Kiểm chứng trong môi trường phát triển
- npm test đạt: bộ SQL hiện có (141 assertions cùng khối kiểm tra ngày nghỉ), khối kiểm tra khung giờ mới và 31 test Edge.
- Test mới: chặn quyền anon/non-owner; bảng riêng không cho authenticated đọc trực tiếp; khóa bền sau refresh; từ chối thao tác cũ; không khóa chỗ có khách; mở lại không sửa đơn; ca thêm không lan sang ngày khác; ngày nghỉ vẫn chặn; khách không đặt được ca khóa hết và đặt được ca thêm còn chỗ.
- npm run build đạt.
- Chưa chạy kiểm tra hình ảnh responsive vì thiếu executable Playwright. Chưa kiểm thử tải/concurrency trên nhiều kết nối hoặc Supabase/Realtime/Calendar thật. SQL dùng khóa transaction cùng khóa cấu hình hiện có và ràng buộc reserved<=capacity để bảo vệ sức chứa.
- Không sửa lỗi tạo lịch thủ công chưa xác định nguyên nhân hoặc cơ chế Realtime hiện có trong bản cập nhật này.
