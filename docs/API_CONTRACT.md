# Hợp đồng API — bản cập nhật 09/10/2026

Frontend gọi POST `/functions/v1/customer-api`, JSON, header `apikey` là publishable/anon key. Các RPC `customer_*` chỉ cho service_role trong Edge gọi; anon/authenticated không được gọi trực tiếp.

## Đặt lịch

```json
{"action":"book","name":"Tên khách","phone":"0901234567","people":1,"starts_at":"2030-01-01T09:00:00+07:00","idempotency_key":"10000000-0000-4000-8000-000000000001"}
```

Ngày trong ví dụ chỉ minh hoạ: sử dụng `starts_at` từ availability trong 10 ngày tới. Name 2–80 ký tự, phone chuẩn hoá +84/84 về 0, regex `/^0[35789][0-9]{8}$/`, chặn tám số cuối lặp. People 1–20, không vượt chỗ trống của slot. Tối đa ba đơn confirmed sắp tới/phone. Mỗi lần đặt dùng UUID v4 mới, retry giữ nguyên key + nội dung. Không còn secret trong payload, giao diện, URL hay localStorage. Nếu mất phản hồi, dùng lại key cũ hoặc tra cứu bằng phone; không tự tạo đơn mới.

```text
customer_book(p_name text,p_phone text,p_starts_at timestamptz,p_people integer,p_idempotency_key uuid,p_ip_hash text)
customer_lookup(p_phone text,p_ip_hash text)
customer_cancel(p_phone text,p_local_date date,p_local_time time,p_ip_hash text)
```

Đặt trả `{ok:true,booking:{id,name,phone,starts_at,ends_at,people,status,can_cancel},replayed:false}`; retry trả cùng booking với replayed=true. Đồng bộ Google Calendar vẫn qua outbox, không chặn phản hồi.

## Tra cứu danh sách

```json
{"action":"lookup","phone":"0901234567"}
```

Trả `{ok:true,bookings:[...]}` gồm lịch confirmed chưa bắt đầu, chỉ đúng phone được hỏi, sắp xếp starts_at tăng dần. Không có lịch trả `{ok:true,bookings:[]}`. Không trả đơn đã huỷ/quá giờ, secret_hash, event_id hoặc IP. Frontend hiển thị từng lịch với nút huỷ riêng.

**Giới hạn riêng tư do lựa chọn phone-only:** số điện thoại không chứng minh danh tính. Người biết/đoán được số có thể tra cứu và huỷ lịch tương ứng; RLS và rate limit không khắc phục việc này. Bảng booking vẫn riêng tư; API không trả lịch của phone khác trong cùng câu trả lời.

## Huỷ một lịch

```json
{"action":"cancel","phone":"0901234567","date":"2030-01-01","time":"09:00"}
```

Date/time là giờ Việt Nam. Chỉ đổi trạng thái đơn confirmed tại đúng phone + ngày + giờ, ưu tiên đơn active nếu có lịch sử đã huỷ cùng giờ. Trả `{ok:true,booking:{...}}`. Huỷ lặp đơn đã huỷ là no-op thành công, không trả chỗ hoặc tạo tác vụ xoá lần hai. Nếu đã đặt lại cùng phone/ngày/giờ, yêu cầu huỷ mới nhắm vào đơn active đó: hợp đồng phone/date/time không phân biệt được retry cũ với ý định huỷ đơn mới sau đặt lại.

`CANCEL_MIN_HOURS` lấy duy nhất từ `public.shop_settings.cancel_before_hours` (mặc định 0 sau migration). Frontend đọc trong snapshot; DB dùng trong can_cancel và customer_cancel. Mốc 0: starts_at phải **lớn hơn** now(); đúng giờ bắt đầu hoặc quá giờ không được huỷ. Mốc N > 0: phải còn ít nhất N giờ. Ví dụ bật lại bằng SQL Editor:

```sql
update public.shop_settings set cancel_before_hours = 4 where id = true;
```

Frontend nhận cấu hình mới khi tải lại trang/snapshot, backend áp dụng ngay.

## Rate limit, lỗi và quyền

Giữ 10 thao tác/action/phone/15 phút; khi có IP đáng tin, thêm 30/action/IP/15 phút. Lượt thất bại cũng được tính. `p_ip_hash` do Edge tự HMAC, không lấy từ body; nếu chưa cấu hình trusted header, vẫn có giới hạn phone, chưa có IP. CORS không xác thực người dùng.

| Mã lỗi | HTTP | Ý nghĩa |
|---|---|---|
| slot_full / slot_unavailable / already_booked | 409 | Hết chỗ, không nhận giờ này hoặc đã có lịch |
| idempotency_conflict | 409 | Key cũ nhưng payload khác |
| cancellation_too_late | 409 | Lịch đã bắt đầu hoặc quá thời hạn cấu hình |
| not_found | 404 | Không tìm được lịch để huỷ, hoặc phone tra cứu không hợp lệ |
| rate_limited / too_many_active_bookings | 429 | Vượt giới hạn thao tác/ba lịch sắp tới |
| phone_blocked | 403 | Phone bị chặn |
| invalid_phone / invalid_name / invalid_people / invalid_request / outside_booking_window | 400 | Dữ liệu sai |

Lỗi trả `{ok:false,error:"code"}`; lỗi nội bộ không kèm dữ liệu cá nhân/SQL/token. `rate_limited` có Retry-After: 900. RLS, quyền admin, Realtime availability, Calendar worker không đổi. Các overload RPC nhận secret cũ bị xoá trong migration mới.

## RPC admin — phải gửi JWT của chủ tiệm

```text
admin_create_booking(p_name TEXT, p_phone TEXT, p_local_date DATE, p_local_time TIME,
                     p_people INTEGER, p_idempotency_key UUID)
admin_list_bookings(p_from DATE, p_to DATE, p_phone TEXT hoặc null)
admin_change_booking(p_id UUID, p_action 'cancel'/'move', p_expected_version BIGINT,
                     p_new_starts_at TIMESTAMPTZ hoặc null)
admin_list_blocked_phones()
admin_set_blocked_phone(p_phone TEXT, p_block BOOLEAN, p_note TEXT mặc định '')
admin_configure(p_kind TEXT, p_data JSONB, p_remove BOOLEAN mặc định false)
```

JWT do Supabase Auth cấp; không tự truyền `owner=true`/user_id để xin quyền. `admin_list_bookings` trả dữ liệu dùng chung cho bảng ngày/tuần và CSV; chức năng tải CSV sẽ nằm ở GĐ4, có xử lý ô bắt đầu bằng `=`, `+`, `-`, `@` để tránh formula injection.

`p_expected_version` phải là version vừa đọc. Nếu báo `version_conflict`, tải lại đơn để chủ tiệm xem trước khi thao tác tiếp.

Các payload cấu hình mẫu (đây là dữ liệu RPC admin, không chạy trực tiếp trên SQL Editor nếu chưa thiết lập phiên chủ tiệm):

| p_kind | p_data | p_remove |
|---|---|---|
| shop | `{"announcement":"Tiệm nghỉ ngày 02/10."}` | false |
| shop | `{"contact_phone":"SO_DIEN_THOAI_THAT"}` | false |
| hours | `{"weekday":0,"opens":"09:00","closes":"13:00","capacity":2}` | false |
| capacity | `{"time":"12:00","capacity":1}` | false |
| closed_day | `{"date":"2026-10-02","notice":"Nghỉ theo lịch tiệm"}` | false |
| closed_day | `{"date":"2026-10-02"}` | true |
| slot_override | `{"date":"2026-10-03","time":"10:00","capacity":1}` | false |
| slot_override | `{"date":"2026-10-03","time":"10:00"}` | true |

Lỗi `23514` khi giảm capacity/đóng cửa: cấu hình mới xung đột với đơn hiện có hoặc giá trị ngoài giới hạn; frontend giải thích cần kiểm tra/dời/huỷ đơn. Toàn bộ thay đổi cấu hình đã rollback, không có trạng thái nửa cập nhật.

## Realtime và dự phòng

Subscribe `public.availability` bằng publishable/anon key; không subscribe bảng bookings. Khi mở trang và khi Realtime reconnect, đọc snapshot số chỗ. Sự kiện chỉ cập nhật dữ liệu hiển thị; kết quả đặt cuối cùng luôn do SQL quyết định. GĐ3 sẽ thêm dự phòng tăng dần có jitter, dừng tab ẩn; không polling cố định 7 giây.

## Bảo trì server

```text
refresh_availability() -> void
maintenance_cleanup() -> void
```

Chỉ service_role hoặc SQL Editor được chạy. GĐ2 sẽ lập cron. Nếu đang thử GĐ1 qua ngày mới, chạy `select public.refresh_availability();` trong SQL Editor trước khi xem đủ 10 ngày.

## Chủ tiệm đặt lịch xa (migration 005)

`admin_create_booking` chỉ cho tài khoản có trong danh sách owner; trả `{ok:true,booking:{...},replayed:false}` hoặc `{ok:false,error:code}`. Ngày/giờ theo Việt Nam, tối đa 730 ngày tới, khung giờ tròn. Retry giữ nguyên UUID và payload. Chủ tiệm vẫn tuân thủ giờ mở cửa, ngày nghỉ, sức chứa, blacklist và tối đa ba lịch sắp tới/phone.

`admin_change_booking` cho phép dời trong cùng phạm vi. SQL tạo slot cần thiết trong transaction; trigger/outbox hiện có tự đồng bộ Calendar. Khách vẫn chỉ tự đặt trong 10 ngày, kể cả khi slot xa đã tồn tại. Khách có thể tra cứu/huỷ lịch do chủ tiệm tạo theo quy tắc hiện hành. Cấu hình giờ mở cửa/ngày nghỉ cũng kiểm tra những ngày xa đã tạo slot; thay đổi làm vượt sức chứa bị rollback.
