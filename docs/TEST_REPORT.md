> Báo cáo lịch sử trước bản cập nhật 09/10/2026. Xem UPDATE-20261009.md cho kiểm thử hiện tại.

# Báo cáo kiểm thử GĐ1 — 30/09/2026

**Kết quả: 72/72 kiểm tra đạt.** Migration và seed chạy thành công từ database rỗng.

Môi trường: PostgreSQL 18.3 qua PGlite 0.5.8, Node.js; roles và auth.uid() của Supabase được mô phỏng trong harness. Bộ SQL dùng tính năng PostgreSQL 15+; chưa chạy trên project Supabase của chủ tiệm.

Đã kiểm tra: chuẩn hoá phone, bảng giờ Chủ nhật/12h, quyền anon và authenticated, chủ tiệm, idempotency, sức chứa, cửa sổ 10 ngày, tra cứu đúng mã/phone, blacklist, dời lịch, huỷ lặp, mốc dưới/đúng 4 giờ, rate limit theo phone/IP, giới hạn 3 lịch, và bất biến reserved/outbox.

**Chưa kiểm tra và không tuyên bố đã đạt:** tranh chấp nhiều kết nối thực, HTTP gateway/JWT thật, WebSocket Realtime, Google Calendar, responsive, LCP, tải 50 VU, p95, tỷ lệ lỗi, ngưỡng request 10 giây. Những phần này thuộc GĐ2–GĐ5. PGlite một kết nối không chứng minh cơ chế khoá hoạt động dưới tải nhiều kết nối.

Trong k6 về sau, slot_full/idempotency_conflict/rate_limited của kịch bản cố ý gây tranh chấp là kết quả nghiệp vụ dự kiến; phải báo riêng với lỗi kỹ thuật, không làm đẹp tỷ lệ lỗi bằng cách bỏ qua lỗi ngoài dự kiến.

## Kết quả từng kiểm tra

1. PASS — 10 lượt sai mã được ghi nhận
2. PASS — 12h không nhận 2 người ở server
3. PASS — 12h tối đa 1 người
4. PASS — 30 lượt trên IP được ghi nhận
5. PASS — Admin không ghi đè dữ liệu đã đổi
6. PASS — Anon không bỏ qua Edge để huỷ RPC
7. PASS — Anon không bỏ qua Edge để tra cứu RPC
8. PASS — Anon không bỏ qua Edge để đặt RPC
9. PASS — Anon không chạy maintenance
10. PASS — Anon không sửa sức chứa
11. PASS — Anon không đọc được đơn
12. PASS — Anon đọc được số chỗ
13. PASS — Blacklist được kiểm tra ở server
14. PASS — Bất biến: reserved bằng tổng người của đơn còn hiệu lực
15. PASS — Cho phép huỷ khi còn đúng 4 giờ
16. PASS — Chuẩn hoá +84
17. PASS — Chuẩn hoá 84
18. PASS — Chặn phone null
19. PASS — Chặn đuôi 8 chữ số lặp
20. PASS — Chặn đầu số sai
21. PASS — Chủ nhật không nhận từ 13h
22. PASS — Chủ tiệm vẫn huỷ được sát giờ
23. PASS — Chủ tiệm xem ngày qua RPC
24. PASS — Chủ tiệm đọc được đơn qua RLS
25. PASS — Cùng key khác payload bị từ chối
26. PASS — Dời cập nhật phiên bản outbox
27. PASS — Dời trả chỗ cũ và giữ chỗ mới
28. PASS — Ghi outbox cùng đơn
29. PASS — Giữ số 0
30. PASS — Huỷ lặp an toàn
31. PASS — Huỷ lặp chỉ trả chỗ một lần
32. PASS — Huỷ vẫn giữ tác vụ xoá event
33. PASS — Hết chỗ bị chặn ở server
34. PASS — ID event ổn định và mã chỉ lưu dạng băm
35. PASS — Khách huỷ trước 4 giờ
36. PASS — Khách không huỷ khi còn dưới 4 giờ
37. PASS — Không giảm sức chứa dưới số đã đặt
38. PASS — Không huỷ bằng mã của người khác
39. PASS — Không tự nâng thành chủ tiệm
40. PASS — Không vượt 10 ngày
41. PASS — Không vượt sức chứa
42. PASS — Không xoá cứng đơn làm mất tác vụ xoá Calendar
43. PASS — Không âm thầm xoá chữ cái
44. PASS — Không đóng ngày có đơn chưa xử lý
45. PASS — Không đặt quá khứ
46. PASS — Lượt thứ 11 bị giới hạn
47. PASS — Mọi đơn luôn có tác vụ đúng phiên bản
48. PASS — Payload Realtime không chứa PII
49. PASS — RPC chặn số lặp
50. PASS — Realtime chỉ publish availability
51. PASS — Retry không nhân đôi đơn
52. PASS — Retry trả đúng đơn cũ
53. PASS — Sinh 10 ngày x 24 giờ
54. PASS — Trừ đúng 1 chỗ
55. PASS — Tạo lịch trong giới hạn 1
56. PASS — Tạo lịch trong giới hạn 2
57. PASS — Tạo lịch trong giới hạn 3
58. PASS — Tạo đơn sát giờ để kiểm tra
59. PASS — Tạo đơn ở mốc đúng 4 giờ
60. PASS — User khác không đọc được audit
61. PASS — User khác không đọc được outbox
62. PASS — User khác không đọc được đơn đã tồn tại
63. PASS — User thường không dùng admin RPC
64. PASS — User thường không sửa blacklist
65. PASS — User thường không thấy đơn qua RLS
66. PASS — Đúng mã sai phone không đọc được
67. PASS — Đúng phone sai mã không đọc được
68. PASS — Đúng phone và mã tra cứu được
69. PASS — Đặt chỗ cuối
70. PASS — Đặt thành công qua service_role
71. PASS — Đổi IP không vượt giới hạn 3 lịch
72. PASS — Đổi phone không vượt giới hạn IP
