import { AppError, timedFetch } from './http.js';
export function database(url, key, fetcher = fetch) {
  if (!url || !key) throw new AppError('server_not_configured', 503);
  const headers = { apikey:key, 'Content-Type':'application/json' };
  // Secret key mới không phải JWT: chỉ gửi apikey. Legacy service_role dùng Bearer.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return async function rpc(name, args = {}) {
    const res = await timedFetch(`${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers,
      body: JSON.stringify(args),
    }, 6000, fetcher);
    if (!res.ok) { await res.body?.cancel(); throw new AppError('database_unavailable', 503); }
    try { return await res.json(); } catch { throw new AppError('invalid_database_response', 503); }
  };
}

export function serviceKey(getEnv) {
  try {
    const keys=JSON.parse(getEnv('SUPABASE_SECRET_KEYS') ?? '{}');
    if(typeof keys.default==='string' && keys.default.startsWith('sb_secret_')) return keys.default;
  } catch { /* fallback sang legacy nếu có */ }
  return getEnv('SUPABASE_SERVICE_ROLE_KEY');
}
