import { AppError, timedFetch } from './http.js';
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encode = value => base64url(new TextEncoder().encode(JSON.stringify(value)));
export function googleTokenProvider(serviceAccount, fetcher=fetch) {
  let cached=null, pending=null, signingKey=null;
  async function mint() {
    if (serviceAccount?.type!=='service_account' || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(serviceAccount.client_email??'') ||
        !serviceAccount.private_key?.includes('BEGIN PRIVATE KEY')) throw new AppError('google_credentials_invalid',503);
    try {
      if (!signingKey) {
        const der=Uint8Array.from(atob(serviceAccount.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
        signingKey=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      }
      const now=Math.floor(Date.now()/1000);
      const content=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:serviceAccount.client_email,
        scope:'https://www.googleapis.com/auth/calendar.events',aud:'https://oauth2.googleapis.com/token',iat:now-30,exp:now+3500});
      const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signingKey,new TextEncoder().encode(content)));
      const res=await timedFetch('https://oauth2.googleapis.com/token',{method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
          grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:content+'.'+base64url(signature)})},6000,fetcher);
      if (!res.ok) {await res.body?.cancel();throw new AppError('google_auth_failed',503);}
      const data=await res.json();
      if (typeof data.access_token!=='string' || !Number.isFinite(data.expires_in) || data.expires_in<60)
        throw new AppError('google_auth_failed',503);
      cached={token:data.access_token,expires:Date.now()+Math.min(data.expires_in,3600)*1000};
      return cached.token;
    } catch(error) { if(error instanceof AppError) throw error; throw new AppError('google_credentials_invalid',503); }
  }
  async function getToken() {
    if(cached && cached.expires>Date.now()+60000) return cached.token;
    if(!pending) pending=mint().finally(()=>{pending=null;});
    return await pending;
  }
  getToken.invalidate=()=>{cached=null;};
  return getToken;
}
export function calendarClient({calendarId,getToken,fetcher=fetch}) {
  if(!calendarId) throw new AppError('calendar_not_configured',503);
  const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  async function call(method,eventId,body,etag) {
    const headers={Authorization:`Bearer ${await getToken()}`,'Content-Type':'application/json'};
    if(etag) headers['If-Match']=etag;
    const response=await timedFetch(base+(eventId?'/'+encodeURIComponent(eventId):'')+(method==='GET'?'':'?sendUpdates=none'),
      {method,headers,...(body?{body:JSON.stringify(body)}:{})},8000,fetcher);
    if(response.status===401) getToken.invalidate?.();
    if([404,410,409].includes(response.status)) {await response.body?.cancel();return {status:response.status,data:null};}
    if(!response.ok) {await response.body?.cancel();throw new AppError(`google_http_${response.status}`,503);}
    if(response.status===204) return {status:204,data:null};
    try {return {status:response.status,data:await response.json()};}
    catch {throw new AppError('google_invalid_response',503);}
  }
  return {call};
}
function ownedBy(event,job) {
  return event?.extendedProperties?.private?.app==='dang-kilam-nail' &&
    event.extendedProperties.private.booking_id===job.booking_id;
}
export async function synchronize(job,client,checkLease) {
  async function check() {if(!await checkLease()) throw new AppError('lease_stale',409);}
  await check();
  let current=await client.call('GET',job.event_id);
  if(job.status==='cancelled') {
    if([404,410].includes(current.status) || current.data?.status==='cancelled') return;
    if(!ownedBy(current.data,job)) throw new AppError('event_id_conflict',503);
    await check();
    const deleted=await client.call('DELETE',job.event_id,null,current.data.etag);
    if(![200,204,404,410].includes(deleted.status)) throw new AppError('google_delete_failed',503);
    return;
  }
  if(current.status===410 || current.data?.status==='cancelled') throw new AppError('google_event_deleted_restore_required',503);
  const payload={summary:`${job.name} - ${job.phone} - ${job.people} người`,
    start:{dateTime:job.starts_at,timeZone:'Asia/Ho_Chi_Minh'},
    end:{dateTime:job.ends_at,timeZone:'Asia/Ho_Chi_Minh'},visibility:'private',transparency:'opaque',
    extendedProperties:{private:{app:'dang-kilam-nail',booking_id:job.booking_id,booking_version:String(job.version)}}};
  if(current.status===404) {
    await check();
    const inserted=await client.call('POST',null,{id:job.event_id,...payload});
    if(inserted.status===200 || inserted.status===201) return;
    if(inserted.status!==409) throw new AppError(`google_http_${inserted.status}`,503);
    // Timeout trước đó có thể đã tạo event. Cùng ID + dấu nhận diện, không sinh ID mới.
    await check(); current=await client.call('GET',job.event_id);
  }
  if(current.data?.status==='cancelled') throw new AppError('google_event_deleted_restore_required',503);
  if(!ownedBy(current.data,job)) throw new AppError('event_id_conflict',503);
  await check();
  const updated=await client.call('PATCH',job.event_id,payload,current.data.etag);
  if(updated.status!==200) throw new AppError(`google_http_${updated.status}`,503);
}
