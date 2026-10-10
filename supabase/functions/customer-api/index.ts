import { database, serviceKey } from '../_shared/database.js';
import { customerHandler } from '../_shared/customer.js';
import { json } from '../_shared/http.js';
// Phone-only contract; validation and RPC argument mapping live in customerHandler.
let handler: ((request: Request) => Promise<Response>) | null = null;
Deno.serve(async (request: Request) => {
  try {
    if (!handler) {
      const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (!origins.length || origins.includes('*')) return json({ok:false,error:'server_not_configured'},503);
      handler = customerHandler({
        rpc: database(Deno.env.get('SUPABASE_URL'), serviceKey((key: string) => Deno.env.get(key))),
        origins, ipHeader: Deno.env.get('TRUSTED_CLIENT_IP_HEADER') ?? '',
        ipSecret: Deno.env.get('IP_HASH_SECRET') ?? '',
      });
    }
    return await handler(request);
  } catch { return json({ok:false,error:'server_not_configured'},503); }
});
