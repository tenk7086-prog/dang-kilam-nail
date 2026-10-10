export class AppError extends Error {
  constructor(code, status = 500) { super(code); this.code = code; this.status = status; }
}
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers },
});
export async function readJson(request, maxBytes = 4096) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    throw new AppError('json_required', 415);
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new AppError('body_too_large', 413);
  if (!request.body) throw new AppError('invalid_request', 400);
  const reader = request.body.getReader(); const parts = []; let total = 0;
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
    reject(new AppError('request_timeout',408)); void reader.cancel().catch(()=>{});
  },2000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(),deadline]); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new AppError('body_too_large', 413); }
      parts.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const all = new Uint8Array(total); let offset = 0;
  for (const part of parts) { all.set(part, offset); offset += part.length; }
  try {
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new AppError('invalid_json', 400); }
}
export async function timedFetch(url, options = {}, timeoutMs = 6000, fetcher = fetch) {
  try { return await fetcher(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new AppError('network_timeout', 503); }
}
export async function secureEqual(a, b) {
  const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x,y] = await Promise.all([digest(a),digest(b)]); let difference = 0;
  for (let i=0;i<x.length;i++) difference |= x[i]^y[i];
  return difference === 0;
}
export function safeCode(error) { return error instanceof AppError ? error.code : 'internal_error'; }
