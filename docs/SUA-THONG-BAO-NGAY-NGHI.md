# Sửa thông báo ngày nghỉ
Trang khách trước đây chỉ tải sức chứa, chưa tải closed_days.notice nên hiện câu mặc định.
Bản sửa tải thông báo theo ngày, hiển thị bằng textContent để tránh thực thi HTML, giữ xuống dòng và xuống dòng dài trên điện thoại.
Không thay đổi thông báo chung trên đầu trang (được quản lý riêng trong Cấu hình tiệm).

1. Chép thư mục web, tests, docs từ gói này vào F:\nail\Hanhnail-GitHub, thay thế file trùng.
2. Chạy CMD:

```bat
cd /d F:\nail\Hanhnail-GitHub
npm.cmd run build
node --test tests/closed-notice.test.mjs
git add web/src/backend.js web/src/main.js web/src/style.css tests/closed-notice.test.mjs tests/browser/gd3-gd4.spec.js docs/SUA-THONG-BAO-NGAY-NGHI.md
git commit -m "Show saved closed day notices to customers"
git push origin main
```

3. Chờ Actions xanh, mở trang khách và Ctrl+F5. Chọn 09 hoặc 10/11/2026, phải thấy nguyên thông báo đã nhập. Ngày 11 sẽ xuất hiện khi vào cửa sổ 10 ngày. Ngày khác vẫn có khung giờ theo cấu hình.
Không cần chạy SQL, deploy Edge Functions hoặc nhập lại ngày nghỉ.
Nếu chỉ sửa nội dung ngày nghỉ khi trang khách đang mở, tải lại trang để thấy nội dung mới.

Đã kiểm tra: build; npm test (DB và Edge); 2 test mới cho snapshot và chọn thông báo. Đã thêm test trình duyệt kiểm tra nội dung dạng text, ẩn khung giờ và đổi sang ngày thường; chưa chạy test trình duyệt trong phiên này.
