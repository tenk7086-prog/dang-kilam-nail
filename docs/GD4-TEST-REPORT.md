# Báo cáo kiểm thử GĐ4

## Đạt

- `node --check web/src/admin.js`: PASS.
- `npm run build`: PASS; tạo được `dist/admin.html` và asset admin.
- `npm test`: PASS — 72/72 kiểm tra SQL nền, 33/33 hàng đợi Calendar, 28/28 Edge/tích hợp.
- Admin dùng Auth access token + publishable key; không có service key trong mã frontend.
- Huỷ/dời dùng optimistic version; số bị chặn, cấu hình tiệm và CSV được nối vào RPC owner.

## Chưa chạy trên project thật

- Đăng nhập Supabase Auth thật.
- Kiểm tra user không có trong `nail_private.owners` bị từ chối.
- HTTP/RLS/Realtime và Calendar hosted thật.
- k6 50 VU.
- Kiểm thử trình duyệt tự động ở 390/768/1440px: Chromium nhúng trong môi trường dựng bị SIGSEGV khi khởi động, nên cần chạy lại bằng Chrome/Edge thật sau khi deploy.
