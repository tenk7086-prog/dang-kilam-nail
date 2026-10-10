import { AppError, json, readJson, safeCode } from './http.js';
export function normalizePhone(input) {
  if (typeof input !== 'string' || input.length > 32 || !/^\+?[0-9 ()-]+$/.test(input)) return null;
  let phone = input.replace(/[ ()-]/g,'');
  if (phone.startsWith('+84')) phone = '0'+phone.slice(3);
  else if (phone.startsWith('84')) phone = '0'+phone.slice(2);
  return /^0[35789][0-9]{8}$/.test(phone) && !/^([0-9])\1{7}$/.test(phone.slice(2)) ? phone : null;
}
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const statuses = { rate_limited:429, too_many_active_bookings:429, phone_blocked:403,
  not_found:404, slot_full:409, slot_unavailable:409, already_booked:409, idempotency_conflict:409,
  cancellation_too_late:409, outside_booking_window:400, invalid_phone:400, invalid_name:400,
  invalid_people:400, invalid_request:400 };
export async function hashIp(request, config) {
  // Mặc định KHÔNG tin các header IP từ client. Chỉ bật sau khi kiểm chứng reverse proxy.
  if (!config.ipHeader) return null;
  const raw = request.headers.get(config.ipHeader)?.trim();
  if (!raw || raw.length>80 || raw.includes(',') || !/^[0-9a-fA-F:.]+$/.test(raw))
    throw new AppError('trusted_ip_missing',503);
  if (!config.ipSecret || config.ipSecret.length<32) throw new AppError('server_not_configured',503);
  let normalized;
  try { normalized = raw.includes(':') ? new URL(`http://[${raw}]/`).hostname : new URL(`http://${raw}/`).hostname; }
  catch { throw new AppError('trusted_ip_missing',503); }
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(config.ipSecret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(normalized)));
  return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
export function customerHandler({rpc, origins, ipHeader='', ipSecret=''}) {
  const allowed = new Set(origins);
  return async request => {
    const origin = request.headers.get('origin');
    const cors = origin && allowed.has(origin) ? { 'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'content-type, apikey, authorization, x-client-info',
      'Access-Control-Max-Age':'600', 'Vary':'Origin' } : {};
    if (origin && !allowed.has(origin)) return json({ok:false,error:'origin_denied'},403);
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    if (request.method!=='POST') return json({ok:false,error:'method_not_allowed'},405,{...cors,Allow:'POST, OPTIONS'});
    try {
      const b = await readJson(request);
      if (!['book','lookup','cancel'].includes(b.action)) throw new AppError('invalid_action',400);
      const phone = normalizePhone(b.phone);
      if (!phone) throw new AppError(b.action==='book'?'invalid_phone':'not_found',b.action==='book'?400:404);
      const args = {p_phone:phone,p_ip_hash:await hashIp(request,{ipHeader,ipSecret})};
      if (b.action==='book') {
        if (typeof b.name!=='string' || [...b.name.trim()].length<2 || [...b.name.trim()].length>80 || /[\x00-\x1f\x7f]/.test(b.name))
          throw new AppError('invalid_name',400);
        if (!Number.isInteger(b.people) || b.people<1 || b.people>20) throw new AppError('invalid_people',400);
        if (!uuid(b.idempotency_key) || typeof b.starts_at!=='string' || b.starts_at.length>40 ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(b.starts_at) ||
            (!Number.isFinite(Date.parse(b.starts_at)) ||
             new Date(b.starts_at.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==b.starts_at.slice(0,10))) throw new AppError('invalid_request',400);
        Object.assign(args,{p_name:b.name.trim(),p_people:b.people,p_starts_at:b.starts_at,p_idempotency_key:b.idempotency_key});
      } else if (b.action==='cancel') {
        if (typeof b.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
            !Number.isFinite(Date.parse(b.date+'T00:00:00Z')) || new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date ||
            typeof b.time!=='string' || !/^(?:[01]\d|2[0-3]):00$/.test(b.time)) throw new AppError('invalid_request',400);
        Object.assign(args,{p_local_date:b.date,p_local_time:b.time});
      }
      const result = await rpc(`customer_${b.action}`,args);
      if (!result || typeof result.ok!=='boolean') throw new AppError('invalid_database_response',503);
      // SQL đã commit mới phản hồi thành công. Không gọi Calendar trong request này.
      if (result.ok) return json(result,200,cors);
      const status = statuses[result.error];
      return json({ok:false,error:status?result.error:'internal_error'},status??500,
        result.error==='rate_limited'?{...cors,'Retry-After':'900'}:cors);
    } catch(error) {
      const code=safeCode(error);
      if (!(error instanceof AppError) || error.status>=500) console.error(JSON.stringify({component:'customer-api',code}));
      return json({ok:false,error:code},error instanceof AppError?error.status:500,cors);
    }
  };
}
