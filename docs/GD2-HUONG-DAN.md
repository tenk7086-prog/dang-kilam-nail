# Hanhnail — GĐ2: API khách và Google Calendar

Bộ này **bao gồm mã GĐ1 và GĐ2**. GĐ2 đã có code chạy được sau khi bạn tạo tài khoản, cấp quyền và điền Secrets. Chưa được deploy vào tài khoản của bạn, chưa dùng khoá Google thật, chưa có giao diện khách/admin.

Nếu đã cài GĐ1: **chỉ chạy migration `202610010002_calendar_worker.sql`**, không chạy lại migration GĐ1. Không cần xoá project hay dữ liệu cũ. Nếu chưa cài: chạy migration GĐ1 → seed → migration GĐ2, rồi cấp quyền owner theo hướng dẫn GĐ1.

## Cơ chế hoạt động

1. Khách gửi đặt lịch đến Edge `customer-api`; server kiểm tra và gọi SQL đã có.
2. Database lưu đơn và tác vụ Calendar cùng transaction rồi trả thành công. Việc Google lỗi không làm mất đơn.
3. Cron kiểm tra mỗi phút. Nếu có việc, gọi `calendar-worker` bằng token bí mật.
4. Worker tạo event, dời cập nhật cùng event, huỷ xoá event. Tiêu đề chính xác: **Họ tên - 0901234567 - 2 người**.
5. Lỗi: giữ tác vụ, ghi mã lỗi, thử lại khoảng 30 giây → 60 → 120… tối đa khoảng 1 giờ cộng jitter; vì cron chạy mỗi phút, thời điểm chạy thực tế được làm tròn theo lần quét tiếp theo.
6. Tác vụ thành công được đối soát lại khoảng mỗi 24 giờ, kể cả đơn đã huỷ, để xử lý event xuất hiện muộn sau timeout. Khi hàng đợi đông, việc đối soát có thể muộn hơn.

Lần đồng bộ đầu thông thường chờ tối đa khoảng 1 phút cộng thời gian xử lý và hàng đợi; đây không phải cam kết uptime. Phản hồi đặt lịch không chờ khoảng thời gian này. Worker xử lý tối đa 20 tác vụ/lượt, tự ngừng nhận thêm sau khoảng 45 giây; tác vụ đang làm được hoàn tất trong giới hạn timeout riêng.

## 1. Tạo lịch riêng của tiệm

1. Đăng nhập tài khoản Google của tiệm tại [Google Calendar](https://calendar.google.com/).
2. Mở **Settings / Cài đặt → Add calendar / Thêm lịch → Create new calendar / Tạo lịch mới**.
3. Đặt tên **Hanhnail**, múi giờ **Asia/Ho_Chi_Minh** hoặc GMT+07:00 Việt Nam.
4. Tạo lịch. Chọn lịch vừa tạo trong phần **Settings for my calendars**.
5. Trong **Access permissions**, **không bật công khai lịch**. Event chứa tên và số điện thoại khách.
6. Tìm **Integrate calendar / Tích hợp lịch → Calendar ID / ID lịch**, sao chép ID. Thường kết thúc bằng `@group.calendar.google.com`.

Dùng ID của lịch riêng vừa tạo, không dùng chữ `primary` và không dùng đường dẫn trang Calendar.

## 2. Tạo service account và bật API

1. Mở [Google Cloud Console](https://console.cloud.google.com/), tạo project cho tiệm hoặc chọn project bạn quản lý.
2. Vào **APIs & Services → Library**, tìm **Google Calendar API**, bấm **Enable**.
3. Vào **IAM & Admin → Service Accounts → Create service account**.
4. Đặt tên `dang-kilam-calendar`. Không cần cấp vai trò Owner/Editor của toàn bộ Google Cloud project cho service account chỉ để chỉnh lịch.
5. Mở service account vừa tạo, sao chép email dạng `dang-kilam-calendar@TEN_PROJECT.iam.gserviceaccount.com`.
6. Tab **Keys → Add key → Create new key → JSON**. Tải file về máy bạn và giữ ở nơi riêng tư, bên ngoài thư mục mã nguồn.

Nếu tổ chức của bạn cấm tạo khoá service account, không tự tắt chính sách của tổ chức. Nhờ quản trị viên hỗ trợ hoặc báo lại để chuyển sang OAuth. Bộ code hiện tại triển khai service account; chưa triển khai luồng OAuth người dùng.

## 3. Chia sẻ lịch cho service account

1. Quay lại Google Calendar, chọn **đúng lịch Hanhnail → Settings and sharing**.
2. Trong **Share with specific people or groups / Chia sẻ với người hoặc nhóm cụ thể**, chọn **Add people and groups**.
3. Dán email service account ở bước 2.
4. Chọn quyền **Make changes to events / Thay đổi sự kiện** rồi lưu/gửi.
5. Không chỉ chọn quyền xem; worker cần tạo, sửa và xoá sự kiện.

Service account không phải hộp thư của khách. Không thêm khách vào attendees. Code chỉ thao tác lịch đã chia sẻ nên không cần domain-wide delegation cho danh sách người tham dự. Workspace có thể chặn chia sẻ ra ngoài tổ chức; nếu vậy cần quản trị viên cho phép đúng lịch/tài khoản.

## 4. Cập nhật database

Trong Supabase Dashboard → **SQL Editor → New query**:

1. Chạy toàn bộ `supabase/migrations/202610010002_calendar_worker.sql`.
2. Khi thành công, chạy:

```sql
select public.calendar_queue_status();
```

Kết quả là số tác vụ pending/errors/due và thời điểm thành công gần nhất. Chưa có đơn thì số lượng bằng 0 và thời điểm thành công là null.

Migration này thêm lease/đối soát, RPC dành riêng cho worker và cho phép bỏ qua bộ đếm IP khi server chưa có nguồn IP tin cậy. Giới hạn 10 thao tác/phone/15 phút và tối đa 3 lịch tương lai/phone vẫn giữ nguyên. Nếu có nguồn IP đã kiểm chứng, giới hạn 30 thao tác/IP/15 phút vẫn hoạt động.

## 5. Tạo Secrets trên máy bạn

Cài [Node.js](https://nodejs.org/) phiên bản 22 trở lên. Giải nén ZIP, mở Terminal/PowerShell trong thư mục `dang-kilam-nail`.

Chạy lệnh sau, thay 3 giá trị bằng file khoá, Calendar ID và địa chỉ website của bạn:

```powershell
node tools/make-secrets.mjs "C:\Users\BAN\Downloads\service-account.json" "ID_LICH@group.calendar.google.com" "http://localhost:5173"
```

Chưa có website thì dùng `http://localhost:5173` cho giai đoạn thử. Khi deploy frontend GĐ3, đổi `ALLOWED_ORIGINS` sang origin thật, ví dụ `https://ten-tiem.pages.dev`. Nhiều origin cách nhau bằng dấu phẩy; không có dấu `/` cuối hoặc đường dẫn. Trước vận hành bỏ origin localhost nếu không còn dùng.

Script tạo `supabase/functions/.env`, tự sinh token ngẫu nhiên mạnh. Nếu file đã tồn tại, script từ chối ghi đè để tránh đổi token ngoài ý muốn. Đây là file bí mật đã có trong `.gitignore`; **không gửi file này, khoá JSON hoặc ảnh chụp giá trị Secrets lên chat/GitHub**.

| Secret | Ý nghĩa |
|---|---|
| ALLOWED_ORIGINS | Origin được frontend dùng để gọi API |
| GOOGLE_CALENDAR_ID | ID lịch tiệm đã chia sẻ |
| GOOGLE_SERVICE_ACCOUNT_JSON | JSON chứa email và private key của service account |
| CALENDAR_WORKER_TOKEN | Token 64 ký tự hex cho cron gọi worker |
| TRUSTED_CLIENT_IP_HEADER | Để trống mặc định |
| IP_HASH_SECRET | Secret HMAC nếu bật kiểm tra IP sau này |

Trên hosted Supabase, `SUPABASE_URL` và bộ `SUPABASE_SECRET_KEYS` được môi trường Edge cung cấp; code ưu tiên secret key mới, hỗ trợ dự phòng `SUPABASE_SERVICE_ROLE_KEY` dạng legacy. Chúng chỉ được đọc ở server. Frontend sau này chỉ dùng publishable/anon key.

Không tự đặt `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for`: người gửi có thể giả header nếu gateway không xoá/ghi đè đúng cách. Chỉ bật sau khi đã kiểm thử header đáng tin cậy trên hạ tầng thật. Khi bật, code không lưu raw IP mà dùng HMAC với secret máy chủ. CORS cũng không ngăn bot gọi API từ ngoài trình duyệt.

## 6. Nạp Secrets và deploy hai Edge Functions

Mở Supabase Dashboard, xem **Project Settings → General → Reference ID**, lấy mã project (không phải mật khẩu).

Trong terminal thư mục `dang-kilam-nail`, chạy lần lượt, thay `PROJECT_REF`:

```powershell
npx supabase login
```

```powershell
npx supabase secrets set --project-ref PROJECT_REF --env-file supabase/functions/.env
```

```powershell
npx supabase functions deploy customer-api --project-ref PROJECT_REF --use-api
```

```powershell
npx supabase functions deploy calendar-worker --project-ref PROJECT_REF --use-api
```

`--use-api` deploy từ xa, không cần Docker trên máy. `supabase/config.toml` tắt gateway JWT cho hai function: khách không cần đăng nhập; worker tự kiểm tra bearer token riêng. Không thay worker token bằng anon key. Các RPC SQL vẫn chỉ cho service_role gọi, không mở EXECUTE cho anon.

Hai endpoint sau deploy:

```text
https://PROJECT_REF.supabase.co/functions/v1/customer-api
https://PROJECT_REF.supabase.co/functions/v1/calendar-worker
```

Bạn cũng có thể kiểm tra trong Dashboard → **Edge Functions → Secrets** rằng tên Secrets đã tồn tại. Không cần in giá trị ra terminal. Dùng SQL Editor cho migration GĐ1/GĐ2 như hướng dẫn; không chạy `supabase db push` vào project đã cài SQL thủ công nếu chưa quản lý lại lịch sử migration.

## 7. Tạo Vault secrets và bật cron

Trong Supabase Dashboard, tìm **Vault** (có thể nằm trong Database hoặc Integrations tuỳ giao diện), chọn thêm secret:

| Tên Vault secret | Giá trị |
|---|---|
| dkn_project_url | `https://PROJECT_REF.supabase.co` — không có `/` cuối |
| dkn_worker_token | Giá trị CALENDAR_WORKER_TOKEN trong `.env`, giống hệt Edge Secret |

Vault và Edge Secrets là hai nơi khác nhau; cần điền token giống nhau ở cả hai. Chỉ sao chép trên máy bạn, không đưa token vào file SQL được chia sẻ.

Sau đó, SQL Editor → chạy toàn bộ `supabase/operations/install_cron.sql`. Nó bật `pg_cron`/`pg_net`, tạo 3 lịch chạy:

| Cron | Khi chạy | Việc làm |
|---|---|---|
| dkn-calendar-minute | Mỗi phút | Nếu có việc thì gọi worker |
| dkn-refresh-slots | Mỗi giờ tại phút 0 | Giữ đủ cửa sổ 10 ngày, gồm thời điểm nửa đêm Việt Nam |
| dkn-cleanup | 00:15 Việt Nam mỗi ngày | Xoá bộ đếm quá 2 ngày, log Calendar quá 90 ngày |

Installer có thể chạy lại để thay các cron mang tên `dkn-`; không đụng cron khác. Nó không tạo một cron nhắc SMS hoặc gửi tin nhắn nào.

## 8. Kiểm tra thật bằng một lịch thử

Chỉ thử trên lịch/project thử nghiệm hoặc vào slot bạn dành riêng; request dưới đây **tạo đơn thật và event thật** nếu cấu hình thành công. Chọn một ngày trong 10 ngày hiện tại, giờ còn chỗ và chưa bắt đầu để thử huỷ.

Trong PowerShell, điền Project Ref, tên và **số điện thoại của chính bạn**:

```powershell
$apiUrl = "https://PROJECT_REF.supabase.co/functions/v1/customer-api"
$bookingKey = [guid]::NewGuid().ToString()
$myPhone = "SO_DIEN_THOAI_CUA_BAN"
$appointmentDay = "YYYY-MM-DD"
$appointmentTime = "10:00"
$payload = @{
  action = "book"
  name = "Ten cua ban"
  phone = $myPhone
  people = 1
  starts_at = "${appointmentDay}T${appointmentTime}:00+07:00"
  idempotency_key = $bookingKey
} | ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri $apiUrl -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($payload))
$result
```

Giữ cửa sổ PowerShell này để giữ `$bookingSecret`. Kết quả phải có `ok = True`. Chạy lại đúng dòng `Invoke-RestMethod` với `$payload` cũ: cùng booking ID và `replayed = True`, không có đơn/event thứ hai. Nếu mạng lỗi, cũng dùng lại payload cũ; không sinh key mới ngay.

Chờ 1–2 phút và xem lịch Google. Tên event đúng mẫu, giờ 10:00–11:00 Việt Nam. Đồng thời chạy `supabase/operations/verify_calendar.sql` để xem hàng đợi, cron và mã lỗi (không in tên/phone/token).

Tra cứu:

```powershell
$lookup = @{ action = "lookup"; phone = $myPhone } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $apiUrl -ContentType "application/json" -Body $lookup
```

Huỷ:

```powershell
$cancel = @{ action = "cancel"; phone = $myPhone; date = $appointmentDay; time = $appointmentTime } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $apiUrl -ContentType "application/json" -Body $cancel
```

Khi huỷ thành công, chỗ được trả ngay; event sẽ biến mất sau lượt worker kế tiếp. Huỷ lại không trả chỗ lần thứ hai. Huỷ sát giờ được phép với cấu hình 0; đúng giờ bắt đầu bị từ chối. Lookup trả danh sách bookings, mảng rỗng nếu không có lịch sắp tới.

Huỷ/dời bởi chủ tiệm đã có RPC SQL từ GĐ1. Sau khi thay đổi hợp lệ qua RPC admin, trigger tự thêm việc cho worker. GĐ4 mới có nút thao tác trên giao diện admin; không dời trực tiếp trong Google Calendar vì chưa đồng bộ ngược về database.

## 9. Kiểm tra code trước khi deploy

```powershell
npm ci
npm test
```

Kết quả đã chạy trong môi trường phát triển: **72 kiểm tra SQL nền + 33 kiểm tra hàng đợi + 28 kiểm tra Edge/tích hợp**, tất cả đạt. Kiểm tra kiểu entrypoint bằng Deno cũng đạt.

Test SQL dùng PostgreSQL nhúng (PGlite); test Google dùng API mô phỏng và test chữ ký RS256 thật với khoá tạm trong bộ nhớ. **Chưa kiểm thử quyền Google thật, cron trên Supabase, nhiều kết nối đồng thời, p95 hay tải 50 VU.** Không coi test mock là đã kết nối lịch của tiệm.

## 10. Khi gặp lỗi

| Hiện tượng/mã lỗi | Cách xử lý |
|---|---|
| Migration báo đã có cột/function | Kiểm tra có chạy lại migration GĐ2 không; không xoá bảng hoặc dữ liệu |
| customer-api trả server_not_configured | Kiểm tra Secrets, ALLOWED_ORIGINS và đã deploy đúng project |
| Frontend origin_denied | Thêm đúng origin của website, không thêm path hoặc dấu `/` cuối |
| Worker HTTP 401 | So khớp dkn_worker_token trong Vault với CALENDAR_WORKER_TOKEN ở Edge |
| google_auth_failed / google_credentials_invalid | Kiểm tra JSON, private key còn hiệu lực, service account, Calendar API đã bật |
| google_http_403 | Kiểm tra đã chia sẻ đúng lịch với quyền sửa sự kiện; xem quota/chính sách tổ chức |
| google_http_404 | Kiểm tra Calendar ID và quyền truy cập; không dùng URL lịch hay primary |
| google_http_429 / google_http_503 / network_timeout | Worker giữ đơn, tự thử lại; kiểm tra quota và kết nối nếu kéo dài |
| google_event_deleted_restore_required | Event active bị xoá thủ công: khôi phục trong Trash của Google Calendar nếu còn có thể, hoặc huỷ đơn trong admin rồi đặt lại khi phù hợp |
| event_id_conflict | Event cùng ID không có dấu nhận diện của đơn; kiểm tra lịch/DB, worker không tự xoá event lạ |
| Cron succeeded nhưng không có event | Đây chỉ là cron đã gọi; xem calendar_queue_status, last_error_code và HTTP response |
| Không còn chỗ | 409 slot_full là kết quả nghiệp vụ; chọn giờ khác |
| rate_limited | Dừng thử dồn dập, chờ cửa sổ 15 phút; không giảm bảo mật chỉ để thử liên tục |

Để dừng đồng bộ tạm thời, tắt job `dkn-calendar-minute` trong Cron Dashboard; đơn và outbox vẫn giữ lại. Khi bật lại, worker tiếp tục xử lý. Nếu đổi worker token, cập nhật Edge Secret và Vault đồng thời; redeploy function khi đổi Secrets để chắc chắn các instance nạp cấu hình mới.

## Giới hạn còn lại

- Mất quyền Google, quota hết hoặc project Supabase bị pause làm đồng bộ chậm/ngừng; dữ liệu đã commit vẫn ở database. Cần người vận hành kiểm tra mã lỗi và khôi phục quyền/dịch vụ.
- Google và Postgres không chia sẻ transaction: có thể lệch tạm thời. Lease, ID ổn định, kiểm tra phiên bản và đối soát giúp đưa lịch về trạng thái trong DB; không thể cam kết không lệch khi dịch vụ ngoài ngừng hoạt động vô hạn.
- Event bị xoá tay có thể trở thành tombstone của Google; code báo lỗi rõ thay vì tạo nhiều event mới. Hãy dùng admin website để huỷ/dời sau GĐ4.
- Đối soát giữ cả lịch sử đơn đã huỷ; khi số đơn tích luỹ lớn cần chính sách lưu trữ/đối soát phù hợp, chưa tự xoá dữ liệu khách.
- Theo phone + mã bí mật bảo vệ việc xem/huỷ; không xác minh quyền sở hữu số điện thoại khi đặt. IP mặc định chưa bật; giới hạn phone không ngăn được spam phân tán với nhiều số. Có thể bổ sung OTP/CAPTCHA nếu bạn yêu cầu sau.
- GĐ3/GĐ4 chưa có, nên chưa kiểm tra responsive 390/768/1440px. GĐ5 mới đo tải và hiệu năng; GĐ6 mới triển khai frontend/tên miền và backup định kỳ.

Tài liệu chính thức: [Supabase cron](https://supabase.com/docs/guides/functions/schedule-functions), [Edge Secrets](https://supabase.com/docs/guides/functions/secrets), [Deploy Functions](https://supabase.com/docs/guides/functions/deploy), [Google service account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account), [Tạo khoá service account](https://docs.cloud.google.com/iam/docs/keys-create-delete), [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Chia sẻ lịch](https://support.google.com/calendar/answer/37082).
