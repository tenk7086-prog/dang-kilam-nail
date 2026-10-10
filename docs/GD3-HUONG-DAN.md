# GĐ3 — Website khách hàng Hanhnail

## Đã có

- Trang một trang responsive, phong cách wine–gold, mobile-first.
- Trang chủ, dịch vụ, bảng giá mẫu, gallery lightbox, giờ mở cửa, bản đồ và nút liên hệ.
- Chọn 10 ngày tới và khung giờ; Chủ nhật hiển thị giờ giới hạn; slot 12:00 có sức chứa 1 người.
- Đặt lịch qua Edge Function `customer-api`, chống bấm đúp bằng `request_key`, giữ request khi mạng mất phản hồi.
- Chuẩn hoá/kiểm tra số điện thoại ở frontend và backend; chỉ lưu tên và số điện thoại trong localStorage.
- Tra cứu danh sách bằng số điện thoại; huỷ từng lịch bất cứ lúc nào trước giờ hẹn (CANCEL_MIN_HOURS=0).
- Realtime chỉ nhận dữ liệu sức chứa công khai; khi mất WebSocket, polling dự phòng giãn dần và dừng khi tab ẩn.
- Ảnh WebP có `srcset`, tải gallery lazy, font có `font-display: swap`, SVG inline và trạng thái skeleton.

## Chạy bản xem trước

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra trên terminal. Khi `web/public/site-config.json` còn trống, giao diện dùng dữ liệu mẫu và không nhận đơn thật.

## Nối Supabase thật

Mở `web/public/site-config.json` và điền:

```json
{
  "supabaseUrl": "https://PROJECT_REF.supabase.co",
  "publishableKey": "sb_publishable_...",
  "siteUrl": "https://ten-mien-cua-ban.example"
}
```

Chỉ điền **publishable/anon key** ở frontend. Không đưa `service_role`, khoá Google, JWT worker hoặc mật khẩu database vào file này.

Sau khi đã chạy migration GĐ1, migration GĐ2, seed, cấu hình CORS/Secrets và deploy Edge Functions:

```bash
npm run build
npm run preview
```

## Kiểm tra nhanh

1. Mở website ở 390px, 768px và 1440px; kiểm tra không có thanh cuộn ngang.
2. Chọn ngày, chọn slot, nhập số điện thoại mẫu hợp lệ và bấm xác nhận.
3. Khi còn demo, phải thấy thông báo “bản xem trước”; khi đã nối Supabase, backend mới trả xác nhận thật.
4. Mở gallery, dùng hai nút mũi tên và phím `Esc`.
5. Tra cứu bằng số điện thoại, hiển thị danh sách và huỷ riêng từng lịch.

## Giới hạn kiểm thử GĐ3

Build production đã chạy thành công. Chưa thể xác nhận p95 trên Supabase thật khi chưa có URL/key và chưa chạy k6 GĐ5. Mục tiêu vận hành vẫn là p95 đặt lịch dưới 2 giây, lỗi dưới 1% và LCP dưới 2,5 giây trên 4G.
