# Hanhnail — Giai đoạn 1

Bộ nền tảng database mới hoàn toàn. **Chưa có giao diện và chưa kết nối Google Calendar thật.** GĐ2 sẽ thêm Edge Functions và worker Calendar; GĐ3/GĐ4 mới có website khách/admin.

## Cấu hình đang dùng

| Mục | Giá trị ban đầu |
|---|---|
| Tiệm | Hanhnail |
| Địa chỉ | Số 181 Khương Thượng, Phường Kim Liên, Hà Nội |
| Điện thoại/Zalo | Chưa có; để `null`, không dùng số giả cho nút liên hệ |
| Giờ Thứ 2–Thứ 7 | 09:00–20:00, lịch cuối bắt đầu 19:00 |
| Giờ Chủ nhật | 09:00–13:00, lịch cuối bắt đầu 12:00 |
| Thời lượng | 60 phút/người; nhóm được phục vụ cùng khung giờ |
| Sức chứa | 2 người; riêng 12:00 là 1 người |
| Ngày hiển thị | Hôm nay + 9 ngày kế tiếp, theo giờ Việt Nam |
| Huỷ bởi khách | Chưa bắt đầu, theo cấu hình cancel_before_hours=0 sau migration 202610090003 |
| Tra cứu/huỷ | Số điện thoại + mã bí mật riêng cho từng đơn |
| Chống spam | 10 thao tác/phone/15 phút; 30 thao tác/IP/15 phút, tách đặt/tra cứu/huỷ; tối đa 3 đơn tương lai còn hiệu lực/phone |
| Bảng giá | 3 dịch vụ mẫu, cần chủ tiệm xác nhận |

Đây là các giả định vì thông tin còn để trống. Nếu một lượt nail thường lâu hơn 60 phút, cần chốt lại thời lượng trước khi vận hành: bản này chưa quản lý thời lượng khác nhau theo dịch vụ hoặc theo thợ.

Mã bí mật là 32 byte ngẫu nhiên (64 ký tự hex), database chỉ giữ SHA-256. Khách phải lưu mã khi đặt thành công; chỉ có phone sẽ không xem/huỷ được. Quyết định này bảo vệ yêu cầu không lộ lịch khách. Mã không được ghi vào localStorage. Giao diện sau này chỉ ghi nhớ tên và phone nếu khách sử dụng tính năng nhớ thông tin.

## Cài bằng Supabase Dashboard — không cần biết lập trình

1. Tạo một **project Supabase mới riêng cho tiệm**, chọn vùng Singapore nếu được cung cấp. Lưu mật khẩu database ở nơi riêng tư.
2. Mở **SQL Editor → New query**. Mở file `supabase/migrations/202609300001_core.sql`, sao chép **toàn bộ**, dán vào editor và bấm **Run**.
3. Khi thành công, mở query mới, chạy toàn bộ `supabase/seed.sql`. Đây là cấu hình/giá mẫu; không có khách hàng giả được thêm vào dữ liệu thật.
4. Trong phần cài đặt API/Data API, kiểm tra **Exposed schemas không có `nail_private`**. Giữ `public` theo mặc định; không cấp thêm quyền cho `anon`.
5. Trong **Authentication → Users → Add user**, tạo tài khoản chủ tiệm bằng email thật và mật khẩu mạnh. Nếu Dashboard hỏi xác nhận email, xác nhận theo hướng dẫn. Tắt cho phép người dùng mới tự đăng ký vì website khách không cần tài khoản.
6. Mở `supabase/bootstrap_owner.sql`, thay `THAY_BANG_EMAIL_CUA_BAN` bằng email vừa tạo. Chạy file trong SQL Editor. Chỉ email có user được thêm vào bảng `owners` mới quản trị được; đăng nhập đơn thuần không đủ.
7. Trên **project thử nghiệm**, chạy `supabase/tests/01_core.sql`. Kết quả cuối phải có **72 dòng kiểm tra**, không có lỗi `FAIL`. File tự `ROLLBACK`, nên không giữ lại khách/đơn test. Không dùng bài test như tác vụ định kỳ trên dữ liệu đang hoạt động.
8. Kiểm tra nhanh bằng câu SQL ở dưới. Lúc này chưa có API công khai đặt lịch; các RPC khách chỉ cho `service_role` chạy. Đây là chủ ý: GĐ2 sẽ cung cấp Edge gateway để giữ bí mật server, chống spam và xử lý lỗi.

Nếu migration báo schema/bảng đã tồn tại: **dừng**, kiểm tra có chọn nhầm project cũ không. Không xoá database cũ. Migration dùng transaction, lỗi giữa chừng sẽ không để lại một nửa schema. Migration không được chạy lặp; seed có thể chạy lặp và không ghi đè cấu hình có sẵn.

```sql
select name, address, contact_phone from public.shop_settings;
select * from public.weekly_hours order by weekday;
select local_date, local_time, capacity, reserved, remaining
from public.availability
where local_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date
  and capacity > 0
order by local_time;
```

Kết quả mong đợi: ngày thường có 11 khung bắt đầu 09:00–19:00; Chủ nhật có 4 khung 09:00–12:00. Trước khi có đơn: `reserved = 0`; 12:00 có `remaining = 1`, các khung khác là 2. Bảng vật lý có 24 giờ/ngày, giờ đóng cửa mang sức chứa 0; frontend sẽ lọc chúng.

## Kiểm thử trên máy cá nhân, không cần tài khoản Supabase

Cài Node.js 22 trở lên. Giải nén ZIP, mở terminal trong thư mục `dang-kilam-nail`, chạy:

```sh
npm ci
npm run test:db
```

Đây là PostgreSQL thật biên dịch WebAssembly qua PGlite, chạy trong bộ nhớ; không phải kiểm tra bằng regex. Auth và roles của Supabase được mô phỏng tối thiểu. Nó kiểm tra SQL và quyền database, **không thay thế** kiểm thử Supabase Auth/HTTP/Realtime hoặc tranh chấp nhiều kết nối trên hạ tầng thật.

## Những phần đã có

- Migration tạo bảng, ràng buộc, index, RLS, grants, trigger và RPC đặt/tra cứu/huỷ/dời.
- Chống vượt sức chứa bằng khoá hàng slot và transaction; `CHECK (reserved <= capacity)` là lớp bảo vệ bổ sung.
- Idempotency có unique key, khoá theo key và fingerprint; cùng key/cùng nội dung trả đơn cũ, đổi nội dung bị từ chối.
- Huỷ là đổi trạng thái, không xoá đơn. Trả chỗ đúng một lần và vẫn giữ tác vụ xoá Calendar.
- Quyền chủ tiệm được kiểm tra từ `auth.uid()` và bảng owners; không dùng thông tin role do khách tự gửi.
- Admin xem ngày/tuần (khoảng tối đa 32 ngày), tìm đúng phone, huỷ/dời, quản lý số bị chặn, thông báo, giờ, ngày nghỉ và sức chứa.
- Bảng availability công khai, chỉ có ngày/giờ và số chỗ; đây là bảng duy nhất được đưa vào Realtime publication.
- Outbox Calendar giữ `event_id`, phiên bản mong muốn, retry/lease/log. Chưa có worker ở GĐ1.
- Chuẩn bị `notification_jobs` cho nhắc trước 2 giờ/tổng hợp 19:00, mặc định `disabled`; chưa gửi SMS.

Admin thay giờ hoặc giảm sức chứa mà ảnh hưởng đơn đã đặt sẽ bị database từ chối. Phải dời/huỷ các đơn liên quan trước, rồi mới đổi cấu hình. Thông báo dạng chữ không tự đóng slot; ngày nghỉ phải được thêm bằng thao tác `closed_day`.

## Việc sẽ làm ở giai đoạn tiếp theo

**GĐ2:** Edge API khách + Calendar worker, cron refresh 10 ngày, cleanup rate buckets, service account, retry và đối soát Calendar. Không chạy Calendar API bên trong transaction đặt lịch.

**GĐ3:** Giao diện khách wine–gold, responsive, đặt/tra cứu/huỷ, gallery, bản đồ, SEO; kiểm tra 390/768/1440px.

**GĐ4:** Đăng nhập/trang quản trị và xuất CSV an toàn; kiểm tra 390/768/1440px.

**GĐ5:** k6 50 VU, tranh slot, retry, kiểm tra API/RLS và đo tốc độ. 72 kiểm tra GĐ1 chưa chứng minh p95 hay khả năng chịu tải.

**GĐ6:** Hosting, tên miền, HTTPS, sao lưu và thử khôi phục. Đề xuất frontend Cloudflare Pages, source trên GitHub; GitHub Pages không thích hợp cho website kinh doanh giao dịch theo giới hạn của GitHub.

## Bảo mật và vận hành cần nhớ

- Không đưa `service_role`/secret key, khoá Google hoặc mật khẩu DB vào frontend, GitHub, ảnh chụp màn hình hay chat.
- GĐ1 chưa cần khoá Google. Không gửi khoá cho tôi; GĐ2 sẽ hướng dẫn điền vào Secrets trên server.
- Project Free có thể tạm dừng khi ít hoạt động trong 7 ngày. Cron ping không được coi là bảo đảm uptime; cron bên trong project cũng không tự đánh thức project đã pause. Cân nhắc gói trả phí khi nhận lịch thật.
- Free cần chủ động xuất backup bằng Supabase CLI/`pg_dump`, bảo vệ file vì có dữ liệu cá nhân. GĐ6 sẽ cung cấp lịch sao lưu và quy trình khôi phục; tránh chỉ giữ backup trong chính project.
- Điện thoại đúng regex chưa có nghĩa là chủ số điện thoại đã xác minh. Phương án mã bí mật ngăn xem/huỷ đơn người khác, nhưng không ngăn tuyệt đối người khác đặt bằng số đó. Rate limit/blacklist giảm spam, không thay thế OTP.
- Khách mất mã: liên hệ tiệm qua số chính thức sau khi chủ tiệm điền số; chủ tiệm kiểm tra và xử lý trong admin. Không có chức năng lấy lại mã công khai bằng phone.
- Đơn bị huỷ không bị xoá cứng. Khi bổ sung chính sách lưu trữ dữ liệu, chỉ làm sạch sau khi xác nhận Calendar đã đồng bộ và hết thời gian cần giữ; chưa tự xoá dữ liệu khách ở GĐ1.

## File chính

| File | Công dụng |
|---|---|
| `supabase/migrations/202609300001_core.sql` | Schema, SQL nghiệp vụ, trigger, RLS và quyền |
| `supabase/seed.sql` | Giờ, sức chứa, giá mẫu |
| `supabase/bootstrap_owner.sql` | Cấp quyền chủ tiệm sau khi tạo Auth user |
| `supabase/tests/01_core.sql` | 72 kiểm tra có rollback |
| `tools/test-db.mjs` | Chạy test bằng PostgreSQL nhúng |
| `docs/DATABASE.md` | Bảng dữ liệu, quy tắc khoá và đồng bộ |
| `docs/API_CONTRACT.md` | Tham số, kết quả và mã lỗi cho GĐ2/GĐ3 |
| `docs/TEST_REPORT.md` | Kết quả chạy thực tế và phần chưa kiểm tra |

Tài liệu chính thức dùng để đối chiếu:

- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Google Calendar — Create events](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
