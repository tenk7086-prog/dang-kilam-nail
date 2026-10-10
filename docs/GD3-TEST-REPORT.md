> Báo cáo lịch sử trước bản cập nhật 09/10/2026. Xem UPDATE-20261009.md cho kiểm thử hiện tại.

# Báo cáo kiểm thử GĐ3

## Đã đạt

- `npm run build`: PASS.
- Asset ảnh hero/gallery có WebP nhiều kích thước và `srcset`: PASS.
- Cấu hình public để trống mặc định, không chứa service key/Google secret: PASS.
- Frontend có trạng thái demo rõ ràng, không giả báo đặt lịch thành công: PASS.
- Logic client giữ idempotency key khi retry và hiển thị trạng thái mạng không chắc chắn: PASS qua review mã.
- Polling dự phòng có backoff, jitter, dừng khi tab ẩn: PASS qua review mã.

## Chưa thể kết luận từ máy local

- p95 HTTP trên Supabase hosted thật.
- 50 VU tranh cùng một slot.
- RLS qua HTTP/Auth/Realtime thật.
- LCP trên thiết bị 4G thật.
- Đồng bộ Google Calendar với tài khoản thật.

Các mục trên thuộc GĐ5 và cần project Supabase đã triển khai. Không coi build local hoặc dữ liệu demo là bằng chứng đạt tải production.
