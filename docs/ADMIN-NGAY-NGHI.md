# Cập nhật mục Ngày nghỉ / Khóa lịch

1. Giải nén gói cập nhật. Chép các thư mục web, supabase, tools, docs vào F:\nail\Hanhnail-GitHub; đồng ý thay thế file trùng tên.
2. Mở Supabase SQL Editor của dự án vmfaylwtmushjgspnpuo. Mở file supabase/migrations/202610290007_admin_closed_days.sql bằng Notepad, sao chép toàn bộ nội dung vào một truy vấn mới và bấm Run. Không chạy lại migration cũ.
3. Mở CMD tại thư mục dự án, chạy lần lượt:

```bat
npm.cmd run build
git add web/admin.html web/src/admin.js web/src/admin.css supabase/migrations/202610290007_admin_closed_days.sql supabase/tests/05_closed_days.sql tools/test-db.mjs docs/ADMIN-NGAY-NGHI.md
git commit -m "Add admin closed days management"
git push origin main
```

4. Chờ GitHub Actions build và deploy xanh. Mở admin.html, Ctrl+F5, đăng nhập.
5. Mục Ngày nghỉ / Khóa lịch nằm ngay dưới Tạo lịch thủ công. Chọn từ 09/11/2026 đến 11/11/2026, nhập thông báo Tiệm nghỉ, bấm Khóa các ngày đã chọn. Chú ý trình duyệt có thể hiển thị tháng/ngày/năm: 11/09/2026 đến 11/11/2026.
6. Danh sách phải hiển thị đủ 3 ngày. Bấm Mở lại ngày này nếu muốn gỡ khóa riêng một ngày.

Không cần deploy lại Edge Functions. Chức năng không tạo sự kiện nghỉ trên Google Calendar và không tự huỷ lịch khách. Nếu có lịch xác nhận trong khoảng ngày, toàn bộ thao tác khóa bị từ chối; dời/huỷ qua admin trước. Ngày đã khóa bằng SQL trước đây cũng xuất hiện trong danh sách.

Kiểm thử: npm test (bộ kiểm tra DB hiện có và test ngày nghỉ, Edge tests); npm run build; node --check web/src/admin.js. Chưa kiểm thử trực quan trong trình duyệt do tải Chromium thất bại. Chưa triển khai thay đổi lên Supabase hoặc GitHub của chủ tiệm.
