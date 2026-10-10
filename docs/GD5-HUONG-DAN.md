# GĐ5 — Kiểm thử tải, tranh chấp và RLS

## Phạm vi

File `tests/k6/customer-api.js` kiểm thử đúng đường đi khách hàng thật:

- 50 VU cùng đặt vào một slot (`RUN_MODE=contention`);
- gửi lại cùng `idempotency_key` (`RUN_MODE=idempotency`);
- tra cứu bằng bí mật sai và đọc bảng `availability` công khai (`RUN_MODE=leakage`).

Ngưỡng tự động: p95 dưới 2 giây, không request nào quá 10 giây, lỗi dưới 1%, không có lỗi idempotency hoặc rò rỉ dữ liệu.

## Chuẩn bị an toàn

1. Tạo một slot thử nghiệm còn cách hiện tại ít nhất 4 giờ, tốt nhất là ngoài giờ có khách. Không dùng số điện thoại khách thật.
2. Lấy URL dự án và **publishable/anon key** từ Supabase Dashboard → Project Settings → API. Không đưa `service_role` key vào k6.
3. `TARGET_STARTS_AT` phải là ISO-8601, ví dụ `2026-10-20T14:00:00+07:00`, thuộc 10 ngày được hệ thống mở lịch.
4. `TEST_ORIGIN` phải có trong `ALLOWED_ORIGINS` của Edge Function.

## Chạy

```bash
BASE_URL="https://<project-ref>.supabase.co" \
PUBLISHABLE_KEY="<publishable-or-anon-key>" \
TEST_ORIGIN="https://ten-mien-cua-ban.vn" \
TARGET_STARTS_AT="2026-10-20T14:00:00+07:00" \
k6 run tests/k6/customer-api.js
```

Các bài còn lại chạy riêng để không tranh cùng dữ liệu:

```bash
RUN_MODE=idempotency IDEM_STARTS_AT="2026-10-20T15:00:00+07:00" k6 run tests/k6/customer-api.js
RUN_MODE=leakage k6 run tests/k6/customer-api.js
```

Nếu muốn chạy tất cả (chỉ dùng trên dữ liệu thử nghiệm): `RUN_MODE=all`. K6 bản cài trên máy phải là bản chính thức; có thể dùng Docker `grafana/k6` nếu không muốn cài trực tiếp.

## Đọc kết quả

- `✓` và `checks`: kiểm tra nghiệp vụ đạt.
- `http_req_duration`: cần `p(95)<2000` và `max<10000`.
- `http_req_failed` và `app_errors`: cần dưới `1%`.
- `idempotency_mismatch` và `leakage_failures`: phải bằng `0`.
- Trong contention, HTTP 409/429 có thể là kết quả hợp lệ (slot đầy hoặc rate limit), không phải lỗi máy chủ.

Script không tự xoá các booking contention đã nhận thành công vì xoá ngay sẽ làm sai phép đo. Sau khi kiểm thử, vào trang admin huỷ các lịch có tên `K6 VU ...` và kiểm tra Calendar worker đã xoá event tương ứng.

## Trạng thái xác minh

Đã kiểm tra tĩnh mã nguồn, build frontend và bộ test SQL/Edge cục bộ. Chưa thể ghi nhận số liệu p95 thực tế cho Supabase cho đến khi có URL, publishable key, origin và một slot thử nghiệm; chạy lệnh trên sau khi điền bốn giá trị đó.
