# GĐ6 — Triển khai website

## Trạng thái hiện tại

Mã nguồn đã có workflow `.github/workflows/deploy-pages.yml`. Khi file này được đưa lên nhánh `main`, GitHub sẽ tự cài Node 22, chạy `npm ci`, build thư mục `dist` và xuất bản HTTPS bằng GitHub Pages.

Repository đã biết của dự án: `https://github.com/tenk7086-prog/dang-kilam-nail`.

## 1. Đưa mã nguồn lên GitHub

Nếu repository đã có nội dung cũ, tạo một bản sao/branch trước. Từ thư mục dự án chạy:

```bash
git init
git branch -M main
git add .
git commit -m "Deploy Hanhnail GĐ6"
git remote add origin https://github.com/tenk7086-prog/dang-kilam-nail.git
git push -u origin main
```

Nếu máy báo remote đã tồn tại, dùng `git remote -v` kiểm tra rồi chỉ chạy `git push -u origin main`.

## 2. Bật Pages

Vào GitHub → repository → **Settings → Pages**:

1. Ở **Build and deployment**, chọn **GitHub Actions**.
2. Vào tab **Actions**, mở workflow `Deploy Hanhnail`.
3. Chờ job xanh. URL mặc định sẽ có dạng `https://tenk7086-prog.github.io/dang-kilam-nail/`.

Không chọn `Deploy from a branch` vì workflow đã build Vite và xuất bản thư mục `dist`.

## 3. Cấu hình Supabase trước khi mở cho khách

Mở `web/public/site-config.json` và điền:

```json
{
  "supabaseUrl": "https://PROJECT_REF.supabase.co",
  "publishableKey": "PUBLISHABLE_OR_ANON_KEY",
  "siteUrl": "https://tenk7086-prog.github.io/dang-kilam-nail"
}
```

Sau đó commit/push lại để workflow build phiên bản mới. Không điền `service_role`, Google private key, worker token hoặc mật khẩu vào file này.

Trong Edge Function, đổi `ALLOWED_ORIGINS` thành origin thật, không có dấu `/` cuối:

```text
https://tenk7086-prog.github.io
```

Nếu dùng tên miền riêng thì thêm origin tên miền đó, phân tách bằng dấu phẩy.

## 4. Tên miền riêng

Sau khi có tên miền, vào Settings → Pages → Custom domain, nhập tên miền và làm đúng bản ghi DNS GitHub yêu cầu. Chờ GitHub cấp HTTPS rồi cập nhật lại `siteUrl` và `ALLOWED_ORIGINS` theo tên miền mới.

## 5. Backup bắt buộc

Định kỳ tải backup database bằng Supabase CLI/`pg_dump` và lưu ở nơi khác với project. Không chỉ dựa vào backup nội bộ của Supabase. Nếu dùng gói Free, cần cron ping hoặc nâng gói để tránh project bị tạm dừng sau thời gian không hoạt động.

## 6. Kiểm tra sau khi xuất bản

- Mở trang khách ở điện thoại và máy tính.
- Kiểm tra `site-config.json` không còn rỗng.
- Đặt một lịch thử bằng số thử nghiệm, kiểm tra xuất hiện trong admin.
- Kiểm tra worker tạo event Google Calendar.
- Huỷ lịch và xác nhận event Google bị xoá.
- Chạy lại `npm test` trước mỗi lần phát hành.
