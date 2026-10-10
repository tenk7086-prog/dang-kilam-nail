import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// GĐ5: kiểm thử Edge Function công khai. Không đặt service_role key trong file này.
// Chạy theo từng RUN_MODE để không trộn dữ liệu kiểm thử vào cùng một khung giờ.
const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const PUBLISHABLE_KEY = __ENV.PUBLISHABLE_KEY || '';
const ORIGIN = __ENV.TEST_ORIGIN || 'https://example.invalid';
const STARTS_AT = __ENV.TARGET_STARTS_AT || '';
const IDEM_STARTS_AT = __ENV.IDEM_STARTS_AT || STARTS_AT;
const RUN_MODE = __ENV.RUN_MODE || 'contention';
const API = `${BASE_URL}/functions/v1/customer-api`;
const AVAILABILITY = `${BASE_URL}/rest/v1/availability?select=local_date,local_time,capacity,reserved&limit=10`;

// 409/429 là phản hồi nghiệp vụ dự kiến trong bài tranh chấp; chỉ 5xx mới tính là
// failed request mặc định của k6.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  scenarios: scenariosFor(RUN_MODE),
  thresholds: {
    http_req_duration: ['p(95)<2000', 'max<10000'],
    http_req_failed: ['rate<0.01'],
    app_errors: ['rate<0.01'],
    idempotency_mismatch: ['count==0'],
    leakage_failures: ['count==0'],
  },
};

const appErrors = new Rate('app_errors');
const idempotencyMismatch = new Counter('idempotency_mismatch');
const leakageFailures = new Counter('leakage_failures');

function scenariosFor(mode) {
  const all = {};
  if (mode === 'contention' || mode === 'all') {
    all.contention = { executor: 'constant-vus', vus: 50, duration: __ENV.DURATION || '30s', exec: 'contention' };
  }
  if (mode === 'idempotency' || mode === 'all') {
    all.idempotency = { executor: 'shared-iterations', vus: 1, iterations: 1, exec: 'idempotency' };
  }
  if (mode === 'leakage' || mode === 'all') {
    all.leakage = { executor: 'shared-iterations', vus: 1, iterations: 50, exec: 'leakage' };
  }
  if (!Object.keys(all).length) throw new Error(`RUN_MODE không hợp lệ: ${mode}`);
  return all;
}

function hex(length) {
  let value = '';
  while (value.length < length) value += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return value.slice(0, length);
}

function uuid() {
  const h = hex(32).split('');
  h[12] = '4';
  h[16] = ['8', '9', 'a', 'b'][parseInt(h[16], 16) % 4];
  return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20).join('')}`;
}

function phone(seed = 0) {
  // Dải số thử hợp lệ, không dùng số của khách thật.
  return `090${String(1000000 + (seed % 8999999)).padStart(7, '0')}`;
}



function headers() {
  return { headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY, Origin: ORIGIN }, tags: { endpoint: 'customer-api' } };
}

function assertConfig() {
  if (!BASE_URL || !PUBLISHABLE_KEY || !STARTS_AT) throw new Error('Cần BASE_URL, PUBLISHABLE_KEY và TARGET_STARTS_AT');
}

function post(body) {
  return http.post(API, JSON.stringify(body), headers());
}

function bodyOf(response) {
  try { return JSON.parse(response.body || '{}'); } catch { return {}; }
}

function markUnexpected(response, allowedStatuses) {
  const body = bodyOf(response);
  const allowed = allowedStatuses.includes(response.status);
  appErrors.add(!allowed || (response.status >= 500));
  return { body, allowed };
}

export function setup() { assertConfig(); return { startedAt: STARTS_AT }; }

// 50 VU cùng tranh đúng một slot. 409 slot_full/slot_unavailable là kết quả nghiệp vụ hợp lệ.
export function contention() {
  const key = uuid();
  const response = post({
    action: 'book', name: `K6 VU ${__VU}`, phone: phone(__VU * 1000 + __ITER), people: 1,
    starts_at: STARTS_AT, idempotency_key: key,
  });
  const { body, allowed } = markUnexpected(response, [200, 409, 429]);
  check(response, { 'contention trả HTTP hợp lệ': () => allowed, 'contention có JSON': () => !!body && typeof body.ok === 'boolean' });
  sleep(0.1);
}

// Gửi cùng payload hai lần; lần hai phải replay cùng booking, không tạo bản ghi thứ hai.
export function idempotency() {
  if (!IDEM_STARTS_AT) throw new Error('Cần IDEM_STARTS_AT hoặc TARGET_STARTS_AT');
  const key = uuid();
  const payload = { action: 'book', name: 'K6 Idempotency', phone: phone(7000001), people: 1,
    starts_at: IDEM_STARTS_AT, idempotency_key: key };
  const first = post(payload);
  const second = post(payload);
  const a = bodyOf(first); const b = bodyOf(second);
  const sameBooking = a.ok && b.ok && a.booking?.id === b.booking?.id && b.replayed === true;
  const firstAccepted = first.status === 200 || first.status === 409;
  if (!sameBooking && !(firstAccepted && b.error === 'slot_full')) idempotencyMismatch.add(1);
  appErrors.add(first.status >= 500 || second.status >= 500);
  check(second, { 'idempotency không nhân đôi': () => sameBooking || b.error === 'slot_full' || b.error === 'already_booked' });
}

// Tra cứu số thử nghiệm chưa có lịch và đọc availability công khai: tuyệt đối không được lộ PII.
export function leakage() {
  const lookup = post({ action: 'lookup', phone: phone(8000000 + __ITER) });
  const lookupBody = bodyOf(lookup);
  const lookupText = String(lookup.body || '').toLowerCase();
  const lookupSafe = lookup.status === 200 && lookupBody.ok === true && Array.isArray(lookupBody.bookings) && lookupBody.bookings.length === 0;
  if (!lookupSafe && lookup.status !== 429) leakageFailures.add(1);
  appErrors.add(lookup.status >= 500 || (lookup.status !== 200 && lookup.status !== 429));
  check(lookup, { 'lookup số chưa có lịch trả mảng rỗng': () => lookupSafe || lookup.status === 429 });

  const availability = http.get(AVAILABILITY, { headers: { apikey: PUBLISHABLE_KEY, Origin: ORIGIN }, tags: { endpoint: 'availability' } });
  const publicText = String(availability.body || '').toLowerCase();
  const publicSafe = availability.status >= 200 && availability.status < 300 &&
    !/(customer_name|phone|secret_hash|idempotency_key|event_id)/.test(publicText);
  if (!publicSafe) leakageFailures.add(1);
  appErrors.add(!publicSafe);
  check(availability, { 'availability chỉ có dữ liệu công khai': () => publicSafe });
}
