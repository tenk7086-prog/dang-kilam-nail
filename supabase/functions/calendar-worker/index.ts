import { database, serviceKey } from '../_shared/database.js';
import { googleTokenProvider, calendarClient } from '../_shared/google.js';
import { workerHandler } from '../_shared/worker.js';
import { json } from '../_shared/http.js';
let handler: ((request: Request) => Promise<Response>) | null = null;
Deno.serve(async (request: Request) => {
  try {
    if (!handler) {
      const account = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}');
      handler = workerHandler({rpc: database(Deno.env.get('SUPABASE_URL'),serviceKey((key: string) => Deno.env.get(key))),
        client: calendarClient({calendarId:Deno.env.get('GOOGLE_CALENDAR_ID'),getToken:googleTokenProvider(account)}),
        workerToken:Deno.env.get('CALENDAR_WORKER_TOKEN')});
    }
    return await handler(request);
  } catch { return json({ok:false,error:'server_not_configured'},503); }
});
