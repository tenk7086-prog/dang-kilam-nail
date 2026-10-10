> **Bản cập nhật 09/10/2026:** đọc `docs/UPDATE-20261009.md` trước khi triển khai. Luồng tra cứu/huỷ đã chuyển sang chỉ dùng số điện thoại.

# Hanhnail — GĐ1–GĐ6

Bản mới hoàn toàn cho tiệm. Bộ hiện tại gồm database, API khách, worker đồng bộ Google Calendar, giao diện khách, trang quản trị owner, kiểm thử k6 và workflow triển khai GitHub Pages.

**Bắt đầu bằng [hướng dẫn GĐ2](docs/GD2-HUONG-DAN.md).** Nếu đã cài GĐ1, chỉ chạy migration `202610010002_calendar_worker.sql`, rồi cấu hình Google, Secrets, deploy hai function và bật cron. Không chạy lại migration GĐ1, không xoá dữ liệu.

Nếu chưa cài gì: đọc [hướng dẫn GĐ1](docs/GD1-HUONG-DAN.md), chạy migration GĐ1 → seed → migration GĐ2.

## Đã có

- Đặt, tra cứu, huỷ theo phone + mã bí mật; chuẩn hoá phone, chống lặp request, SQL bảo vệ sức chứa.
- RPC admin huỷ/dời, cấu hình giờ/ngày nghỉ/sức chứa, danh sách chặn; quyền owner và RLS.
- API khách trả kết quả sau commit database, không chờ Google.
- Google Calendar tạo/sửa/xoá cùng event_id; lease/version, retry/backoff, log mã lỗi và đối soát định kỳ.
- Cron gọi worker khi có việc; refresh 10 ngày; dọn bộ đếm/log.
- Chuẩn bị bảng nhắc SMS; chưa gửi SMS.

## Kiểm thử

```sh
npm ci
npm test
```

72 kiểm tra SQL nền + 33 kiểm tra SQL hàng đợi + 28 kiểm tra Edge/tích hợp đã đạt. Đã kiểm tra Deno entrypoints. SQL dùng PostgreSQL nhúng; Google mô phỏng; chưa cấu hình tài khoản Google/Supabase thật của chủ tiệm. Script k6 ở `tests/k6/customer-api.js`; chưa tuyên bố đã đạt tải 50 VU hoặc chỉ tiêu tốc độ cho tới khi chạy trên project thật.

## File cần dùng

| File/thư mục | Nội dung |
|---|---|
| docs/GD2-HUONG-DAN.md | Cài đặt từng bước, thử API bằng PowerShell, xử lý lỗi |
| supabase/migrations/202610010002_calendar_worker.sql | Nâng cấp GĐ2, không xoá dữ liệu cũ |
| supabase/functions/customer-api/index.ts | API khách |
| supabase/functions/calendar-worker/index.ts | Worker Google Calendar |
| supabase/functions/_shared/ | Validation, HTTP, database, Google OAuth/Calendar, worker |
| supabase/operations/install_cron.sql | Lập lịch chạy sau khi điền Vault Secrets |
| supabase/operations/verify_calendar.sql | Kiểm tra hàng đợi/cron không in thông tin khách |
| tools/make-secrets.mjs | Tạo file Secrets trên máy của chủ tiệm |
| docs/GD2-TEST-REPORT.md | Kết quả và giới hạn kiểm thử |
| docs/GD5-HUONG-DAN.md | Kịch bản k6 50 VU, idempotency và chống rò rỉ |
| docs/GD6-HUONG-DAN.md | Đưa mã nguồn lên GitHub Pages, HTTPS và backup |
| .github/workflows/deploy-pages.yml | Tự động build và xuất bản GitHub Pages |

Mặc định chưa bật rate limit IP khi chưa có nguồn IP được kiểm chứng; rate limit phone vẫn hoạt động. Không đưa khoá Google, `.env`, token worker hoặc Supabase secret key vào frontend/GitHub.

Trang khách mở tại `/index.html`; trang quản trị mở tại `/admin.html`. Cả hai chỉ dùng publishable/anon key ở frontend. Trang quản trị yêu cầu Supabase Auth và user phải có trong `nail_private.owners`.
