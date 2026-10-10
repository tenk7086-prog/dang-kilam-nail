> Báo cáo lịch sử trước bản cập nhật 09/10/2026. Xem UPDATE-20261009.md cho kiểm thử hiện tại.

# Báo cáo GĐ2 — 01/10/2026

**133 kiểm tra đạt: 72 SQL nền + 33 SQL Calendar + 28 Edge/tích hợp.**

- SQL: PostgreSQL 18.3 / PGlite 0.5.8; chạy migration GĐ1, seed, migration GĐ2, rồi cả hai bộ test. Auth roles được mô phỏng, không kết nối project người dùng.
- JavaScript: Node.js test runner; thử validation, CORS, giới hạn body, xử lý lỗi, bảo vệ token worker, quyền sở hữu event, retry 409, lease stale, Google 429 và secret key Supabase mới.
- OAuth: tạo khoá RSA tạm trong bộ nhớ, ký và xác minh JWT RS256 thực, kiểm tra scope/audience, cache access token; token endpoint mô phỏng.
- Tích hợp: Edge handler gọi PostgreSQL nhúng; Google HTTP mô phỏng. Luồng đặt thành công, replay cùng đơn, Google 503 không làm mất đơn, retry tạo event, dời cập nhật cùng event, huỷ xoá, đối soát xoá event xuất hiện muộn.
- Deno 2.9.6: `deno check` hai entrypoint thành công.

**Chưa chạy:** Google Calendar/Secrets thật, Supabase HTTP/Auth/Realtime thật, cron/pg_net/Vault trên hosted Supabase, nhiều kết nối đồng thời, kiểm thử k6 50 VU, responsive, LCP, p95 và tỷ lệ lỗi vận hành.

Code đầy đủ để cấu hình và deploy theo hướng dẫn; không khẳng định đã deploy hoặc đã đồng bộ lịch Google của tiệm. Log dưới đây chỉ có dữ liệu kiểm thử tổng hợp/mã lỗi giả lập, không có khoá Google hay thông tin khách thật.

## Log thực tế

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> dang-kilam-nail@0.2.0 test
> npm run test:db && npm run test:edge

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> dang-kilam-nail@0.2.0 test:db
> node tools/test-db.mjs

OK: supabase/migrations/202609300001_core.sql
OK: supabase/seed.sql
OK: supabase/migrations/202610010002_calendar_worker.sql
PASS: 10 lượt sai mã được ghi nhận
PASS: 12h không nhận 2 người ở server
PASS: 12h tối đa 1 người
PASS: 30 lượt trên IP được ghi nhận
PASS: Admin không ghi đè dữ liệu đã đổi
PASS: Anon không bỏ qua Edge để huỷ RPC
PASS: Anon không bỏ qua Edge để tra cứu RPC
PASS: Anon không bỏ qua Edge để đặt RPC
PASS: Anon không chạy maintenance
PASS: Anon không sửa sức chứa
PASS: Anon không đọc được đơn
PASS: Anon đọc được số chỗ
PASS: Blacklist được kiểm tra ở server
PASS: Bất biến: reserved bằng tổng người của đơn còn hiệu lực
PASS: Cho phép huỷ khi còn đúng 4 giờ
PASS: Chuẩn hoá +84
PASS: Chuẩn hoá 84
PASS: Chặn phone null
PASS: Chặn đuôi 8 chữ số lặp
PASS: Chặn đầu số sai
PASS: Chủ nhật không nhận từ 13h
PASS: Chủ tiệm vẫn huỷ được sát giờ
PASS: Chủ tiệm xem ngày qua RPC
PASS: Chủ tiệm đọc được đơn qua RLS
PASS: Cùng key khác payload bị từ chối
PASS: Dời cập nhật phiên bản outbox
PASS: Dời trả chỗ cũ và giữ chỗ mới
PASS: Ghi outbox cùng đơn
PASS: Giữ số 0
PASS: Huỷ lặp an toàn
PASS: Huỷ lặp chỉ trả chỗ một lần
PASS: Huỷ vẫn giữ tác vụ xoá event
PASS: Hết chỗ bị chặn ở server
PASS: ID event ổn định và mã chỉ lưu dạng băm
PASS: Khách huỷ trước 4 giờ
PASS: Khách không huỷ khi còn dưới 4 giờ
PASS: Không giảm sức chứa dưới số đã đặt
PASS: Không huỷ bằng mã của người khác
PASS: Không tự nâng thành chủ tiệm
PASS: Không vượt 10 ngày
PASS: Không vượt sức chứa
PASS: Không xoá cứng đơn làm mất tác vụ xoá Calendar
PASS: Không âm thầm xoá chữ cái
PASS: Không đóng ngày có đơn chưa xử lý
PASS: Không đặt quá khứ
PASS: Lượt thứ 11 bị giới hạn
PASS: Mọi đơn luôn có tác vụ đúng phiên bản
PASS: Payload Realtime không chứa PII
PASS: RPC chặn số lặp
PASS: Realtime chỉ publish availability
PASS: Retry không nhân đôi đơn
PASS: Retry trả đúng đơn cũ
PASS: Sinh 10 ngày x 24 giờ
PASS: Trừ đúng 1 chỗ
PASS: Tạo lịch trong giới hạn 1
PASS: Tạo lịch trong giới hạn 2
PASS: Tạo lịch trong giới hạn 3
PASS: Tạo đơn sát giờ để kiểm tra
PASS: Tạo đơn ở mốc đúng 4 giờ
PASS: User khác không đọc được audit
PASS: User khác không đọc được outbox
PASS: User khác không đọc được đơn đã tồn tại
PASS: User thường không dùng admin RPC
PASS: User thường không sửa blacklist
PASS: User thường không thấy đơn qua RLS
PASS: Đúng mã sai phone không đọc được
PASS: Đúng phone sai mã không đọc được
PASS: Đúng phone và mã tra cứu được
PASS: Đặt chỗ cuối
PASS: Đặt thành công qua service_role
PASS: Đổi IP không vượt giới hạn 3 lịch
PASS: Đổi phone không vượt giới hạn IP

72/72 kiểm tra đạt.
OK: supabase/tests/01_core.sql
PASS: ACK bản huỷ
PASS: ACK giả bị từ chối
PASS: ACK sai version bị từ chối
PASS: Anon không ACK job
PASS: Anon không claim job
PASS: Anon không xem hàng đợi
PASS: Bản huỷ vẫn pending
PASS: Ghi log retry
PASS: Huỷ trong lúc worker chạy
PASS: Hàng đợi rỗng trả null
PASS: Không chạy lại ngay sau thành công
PASS: Không claim lại khi lease còn hiệu lực
PASS: Không ghi chuỗi lỗi có PII
PASS: Không retry trước hạn
PASS: Kết quả phiên bản cũ chỉ ACK bản cũ
PASS: Lease hết hạn không ACK
PASS: Lease đúng hợp lệ
PASS: Lưu thất bại
PASS: Lỗi giữ pending và backoff
PASS: Phone limit hoạt động khi không có trusted IP
PASS: Retry cấp token mới
PASS: Service claim đúng đơn
PASS: Snapshot chứa version
PASS: Thành công xoá lỗi và lên lịch đối soát
PASS: Thống kê lỗi không có PII
PASS: Token giả bị từ chối
PASS: User không đọc lease
PASS: User đăng nhập không claim job
PASS: Version cũ không được phép tiếp tục ghi Google
PASS: Worker chết được nhận lại tác vụ
PASS: Worker cũ không ACK lease mới
PASS: Worker kế tiếp nhận trạng thái huỷ
PASS: Đối soát cả đơn đã huỷ để tìm event xuất hiện muộn

33/33 kiểm tra đạt.
OK: supabase/tests/02_calendar.sql
PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten, compiled by emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.74 (1092ec30a3fb1d46b1782ff1b4db5094d3d06ae5), 32-bit
Chưa kiểm tra: Supabase HTTP/Auth thật, WebSocket Realtime, nhiều kết nối, Calendar, k6.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> dang-kilam-nail@0.2.0 test:edge
> node --test tests/edge.test.mjs

✔ Chuẩn hoá frontend/server tương ứng regex và số lặp (2.478583ms)
✔ CORS từ chối origin ngoài danh sách trước khi gọi DB (4.381078ms)
✔ Preflight không gọi database (0.724706ms)
✔ GET không được dùng để truyền mã bí mật trong URL (0.630939ms)
✔ Chặn body lớn cả khi thiếu Content-Length (3.795154ms)
✔ Chặn JSON không phải object (0.88657ms)
✔ Content-Type phải là JSON (0.736697ms)
✔ Chặn nhóm 0 người và name điều khiển (1.435276ms)
✔ Chặn thời gian không có timezone và ngày huỷ không tồn tại (2.422727ms)
✔ Không cho client chọn RPC, role hoặc IP hash (2.117251ms)
{"component":"customer-api","code":"internal_error"}
✔ Không báo thành công trước xác nhận database (8.772127ms)
✔ Retry giữ nguyên idempotency và secret (2.016524ms)
✔ Tra cứu sai thông tin trả not_found, không hỏi tất cả lịch (0.443618ms)
✔ Rate limit trả 429 và Retry-After (0.442643ms)
✔ Không trả raw error có phone hoặc token (0.638942ms)
✔ Mặc định bỏ qua header IP giả; chế độ trusted bắt buộc đủ cấu hình (8.793612ms)
✔ RPC HTTP lỗi không truyền error body (0.757758ms)
✔ Worker từ chối token sai trước khi claim (2.071153ms)
✔ Google create dùng đúng event ID, title và lịch riêng tư (0.391079ms)
✔ Google insert 409 được đọc lại và PATCH, không tạo ID mới (0.20179ms)
✔ Huỷ event không có sẵn là thành công, không tạo mới (0.112615ms)
✔ Không cập nhật hoặc xoá event thiếu dấu nhận diện của đơn (0.303415ms)
✔ Lease đổi sau GET thì không gửi lệnh ghi Google (0.147851ms)
✔ Event chủ tiệm xoá tay được báo lỗi cần khôi phục, không tạo hàng loạt ID (0.110124ms)
✔ Google HTTP 429 không ACK thành công (0.408692ms)
✔ OAuth ký JWT RS256 hợp lệ và cache một access token cho các lời gọi song song (153.064336ms)
{"component":"calendar-worker","code":"google_http_503"}
✔ Luồng tích hợp: lưu đơn → Google lỗi → retry → dời → huỷ → xoá event muộn (2846.854498ms)
✔ Supabase secret key mới dùng apikey, không giả thành Bearer JWT (0.819841ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3236.659325

```
