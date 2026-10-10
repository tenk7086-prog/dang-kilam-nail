import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { customerHandler,normalizePhone,hashIp } from '../supabase/functions/_shared/customer.js';
import { AppError,readJson } from '../supabase/functions/_shared/http.js';
import { database,serviceKey } from '../supabase/functions/_shared/database.js';
import { googleTokenProvider,calendarClient,synchronize } from '../supabase/functions/_shared/google.js';
import {makeBackend} from '../web/src/backend.js';
import { workerHandler } from '../supabase/functions/_shared/worker.js';
const origin='https://nail.example';const secret='a'.repeat(64);const workerToken='b'.repeat(64);
const body={action:'book',phone:'+84 901 234 567',name:'Khách kiểm thử',people:2,
 starts_at:'2030-01-01T09:00:00+07:00',idempotency_key:'10000000-0000-4000-8000-000000000001'};
const request=(data,extra={})=>new Request('https://api.example/customer-api',{method:'POST',headers:{
 'Content-Type':'application/json',Origin:origin,...extra},body:JSON.stringify(data)});
const api=(rpc,opts={})=>customerHandler({rpc,origins:[origin],...opts});
const job={booking_id:'10000000-0000-4000-8000-000000000001',version:1,event_id:'dkn1000',
 name:'Khách kiểm thử',phone:'0901234567',people:2,starts_at:'2030-01-01T02:00:00Z',ends_at:'2030-01-01T03:00:00Z',status:'confirmed'};
const owned={id:job.event_id,etag:'"1"',extendedProperties:{private:{app:'dang-kilam-nail',booking_id:job.booking_id}}};
test('Chuẩn hoá frontend/server tương ứng regex và số lặp',()=>{
 assert.equal(normalizePhone('+84 901 234 567'),'0901234567');assert.equal(normalizePhone('84901234567'),'0901234567');
 assert.equal(normalizePhone('0911111111'),null);assert.equal(normalizePhone('090abc1234567'),null);
});
test('CORS từ chối origin ngoài danh sách trước khi gọi DB',async()=>{
 const res=await api(()=>assert.fail())(request(body,{Origin:'https://evil.example'}));assert.equal(res.status,403);
});
test('Preflight không gọi database',async()=>{
 const res=await api(()=>assert.fail())(new Request('https://api.example',{method:'OPTIONS',headers:{Origin:origin}}));
 assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),origin);
});
test('GET không được dùng để truyền số điện thoại trong URL',async()=>{
 assert.equal((await api(()=>assert.fail())(new Request('https://api.example'))).status,405);
});
test('Chặn body lớn cả khi thiếu Content-Length',async()=>{
 assert.equal((await api(()=>assert.fail())(request({...body,name:'x'.repeat(5000)}))).status,413);
});
test('Chặn JSON không phải object',async()=>{assert.equal((await api(()=>assert.fail())(request([]))).status,400);});
test('Content-Type phải là JSON',async()=>{assert.equal((await api(()=>assert.fail())(request(body,{'Content-Type':'text/plain'}))).status,415);});
test('Chặn nhóm 0 người và name điều khiển',async()=>{
 assert.equal((await api(()=>assert.fail())(request({...body,people:0}))).status,400);
 assert.equal((await api(()=>assert.fail())(request({...body,name:'Tên\nkhác'}))).status,400);
});
test('Chặn thời gian không có timezone và ngày huỷ không tồn tại',async()=>{
 assert.equal((await api(()=>assert.fail())(request({...body,starts_at:'2030-01-01T09:00:00'}))).status,400);
 assert.equal((await api(()=>assert.fail())(request({action:'cancel',phone:body.phone,date:'2030-02-30',time:'09:00'}))).status,400);
});
test('Không cho client chọn RPC, role hoặc IP hash',async()=>{
 let sent;const res=await api(async(name,args)=>{sent={name,args};return {ok:true,booking:{id:'id'}};})
 (request({...body,p_ip_hash:'e'.repeat(64),role:'service_role',rpc:'admin_list_bookings'}));
 assert.equal(res.status,200);assert.equal(sent.name,'customer_book');assert.equal(sent.args.p_ip_hash,null);
 assert.equal(sent.args.p_phone,'0901234567');assert.equal(Object.hasOwn(sent.args,'p_secret'),false);assert.equal(Object.hasOwn(sent.args,'role'),false);
});
test('Không báo thành công trước xác nhận database',async()=>{
 let finish;const pending=api(()=>new Promise(r=>{finish=r;}))(request(body));
 await new Promise(r=>setTimeout(r,5)); finish({ok:false,error:'slot_full'});
 const res=await pending;assert.equal(res.status,409);assert.equal((await res.json()).ok,false);
});
test('Retry giữ nguyên idempotency',async()=>{
 const calls=[];const handler=api(async(n,a)=>{calls.push(a);return {ok:true,replayed:calls.length>1};});
 await handler(request(body));const res=await handler(request(body));assert.deepEqual(calls[0],calls[1]);assert.equal((await res.json()).replayed,true);
});
test('Tra cứu sai thông tin trả not_found, không hỏi tất cả lịch',async()=>{
 const res=await api(()=>assert.fail())(request({action:'lookup',phone:'invalid'}));assert.equal(res.status,404);
});
test('Rate limit trả 429 và Retry-After',async()=>{
 const res=await api(async()=>({ok:false,error:'rate_limited'}))(request(body));assert.equal(res.status,429);assert.equal(res.headers.get('retry-after'),'900');
});
test('Không trả raw error có phone hoặc token',async()=>{
 const res=await api(async()=>{throw Error('secret phone 0901234567');})(request(body));
 assert.deepEqual(await res.json(),{ok:false,error:'internal_error'});
});
test('Mặc định bỏ qua header IP giả; chế độ trusted bắt buộc đủ cấu hình',async()=>{
 assert.equal(await hashIp(request(body,{'X-Forwarded-For':'1.2.3.4'}),{}),null);
 await assert.rejects(()=>hashIp(request(body),{ipHeader:'x-verified-ip',ipSecret:secret}),/trusted_ip_missing/);
 const config={ipHeader:'x-verified-ip',ipSecret:secret};
 const hash=await hashIp(request(body,{'x-verified-ip':'1.2.3.4'}),config);assert.match(hash,/^[a-f0-9]{64}$/);
});
test('RPC HTTP lỗi không truyền error body',async()=>{
 const rpc=database('https://example.test','test',async()=>new Response('sensitive SQL details',{status:500}));
 await assert.rejects(()=>rpc('customer_book',{}),/database_unavailable/);
});
test('Worker từ chối token sai trước khi claim',async()=>{
 const h=workerHandler({rpc:()=>assert.fail(),client:{},workerToken});
 assert.equal((await h(new Request('https://worker.example',{method:'POST'}))).status,401);
});
test('Google create dùng đúng event ID, title và lịch riêng tư',async()=>{
 const calls=[];await synchronize(job,{call:async(...args)=>{calls.push(args);return args[0]==='GET'?{status:404}:{status:200};}},async()=>true);
 assert.equal(calls[1][2].id,job.event_id);assert.equal(calls[1][2].summary,'Khách kiểm thử - 0901234567 - 2 người');
 assert.equal(calls[1][2].visibility,'private');assert.equal(calls[1][2].start.timeZone,'Asia/Ho_Chi_Minh');
});
test('Google insert 409 được đọc lại và PATCH, không tạo ID mới',async()=>{
 let n=0;const methods=[];const responses=[{status:404},{status:409},{status:200,data:owned},{status:200}];
 await synchronize(job,{call:async(m)=>{methods.push(m);return responses[n++];}},async()=>true);
 assert.deepEqual(methods,['GET','POST','GET','PATCH']);
});
test('Huỷ event không có sẵn là thành công, không tạo mới',async()=>{
 const methods=[];await synchronize({...job,status:'cancelled'},{call:async(m)=>{methods.push(m);return {status:404};}},async()=>true);
 assert.deepEqual(methods,['GET']);
});
test('Không cập nhật hoặc xoá event thiếu dấu nhận diện của đơn',async()=>{
 for(const status of ['confirmed','cancelled']) await assert.rejects(()=>synchronize({...job,status},
 {call:async()=>({status:200,data:{id:job.event_id}})},async()=>true),/event_id_conflict/);
});
test('Lease đổi sau GET thì không gửi lệnh ghi Google',async()=>{
 let check=0,calls=0;await assert.rejects(()=>synchronize(job,{call:async()=>{calls++;return {status:404};}},async()=>++check===1),/lease_stale/);
 assert.equal(calls,1);
});
test('Event chủ tiệm xoá tay được báo lỗi cần khôi phục, không tạo hàng loạt ID',async()=>{
 await assert.rejects(()=>synchronize(job,{call:async()=>({status:410})},async()=>true),/google_event_deleted_restore_required/);
});
test('Google HTTP 429 không ACK thành công',async()=>{
 const client=calendarClient({calendarId:'calendar@group.calendar.google.com',getToken:async()=>'test',
 fetcher:async()=>new Response('do not log',{status:429})});
 await assert.rejects(()=>client.call('GET',job.event_id),/google_http_429/);
});
test('OAuth ký JWT RS256 hợp lệ và cache một access token cho các lời gọi song song',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
 publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const exported=Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');let requests=0;
 const provider=googleTokenProvider({type:'service_account',client_email:'calendar@test-project.iam.gserviceaccount.com',
 private_key:`-----BEGIN PRIVATE KEY-----\n${exported}\n-----END PRIVATE KEY-----`},async(url,options)=>{
  requests++;const assertion=new URLSearchParams(options.body).get('assertion');const [h,p,s]=assertion.split('.');
  const claims=JSON.parse(Buffer.from(p,'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/calendar.events');
  assert.equal(claims.aud,'https://oauth2.googleapis.com/token');
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(s,'base64url'),new TextEncoder().encode(h+'.'+p)),true);
  return Response.json({access_token:'test-token',expires_in:3600});
 });
 assert.deepEqual(await Promise.all([provider(),provider(),provider()]),['test-token','test-token','test-token']);assert.equal(requests,1);
 await provider();assert.equal(requests,1);provider.invalidate();await provider();assert.equal(requests,2);
});
test('Luồng tích hợp: lưu đơn → Google lỗi → retry → dời → huỷ → xoá event muộn',async()=>{
 const db=new PGlite();const events=new Map();let failNext=true;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  for(const path of ['migrations/202609300001_core.sql','seed.sql','migrations/202610010002_calendar_worker.sql','migrations/202610090003_phone_lookup.sql'])
   await db.exec(await readFile(new URL('../supabase/'+path,import.meta.url),'utf8'));
  const rpc=async(name,args={})=>{
   assert.match(name,/^(customer_(book|lookup|cancel)|calendar_(claim|check_lease|finish))$/);
   const keys=Object.keys(args);const parameters=keys.map((k,i)=>`${k}=>$${i+1}`).join(',');
   return (await db.query(`select public.${name}(${parameters}) as result`,Object.values(args))).rows[0].result;
  };
  const client=calendarClient({calendarId:'test-calendar',getToken:async()=>'test',fetcher:async(url,opts)=>{
   if(failNext){failNext=false;return new Response(null,{status:503});}
   const id=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
   if(opts.method==='GET')return events.has(id)?Response.json(events.get(id)):new Response(null,{status:404});
   if(opts.method==='POST'){const b=JSON.parse(opts.body);if(events.has(b.id))return new Response(null,{status:409});events.set(b.id,b);return Response.json(b);}
   if(opts.method==='PATCH'){const b={...events.get(id),...JSON.parse(opts.body)};events.set(id,b);return Response.json(b);}
   if(opts.method==='DELETE'){events.delete(id);return new Response(null,{status:204});}
   assert.fail('unexpected method');
  }});
  const worker=workerHandler({rpc,client,workerToken});const run=async()=>await (await worker(new Request('https://worker.example',
   {method:'POST',headers:{Authorization:`Bearer ${workerToken}`}}))).json();
  const slot=(await db.query("select starts_at::text as starts, local_date::text as day from public.availability where local_date=(now() at time zone 'Asia/Ho_Chi_Minh')::date+1 and local_time='09:00'")).rows[0];
  const bookingBody={...body,people:1,starts_at:new Date(slot.starts).toISOString(),idempotency_key:crypto.randomUUID()};
  const handler=api(rpc);const placed=await (await handler(request(bookingBody))).json();assert.equal(placed.ok,true);
  const again=await (await handler(request(bookingBody))).json();assert.equal(again.booking.id,placed.booking.id);assert.equal(again.replayed,true);
  assert.equal((await run()).failed,1);assert.equal(events.size,0);
  assert.equal((await db.query('select count(*)::int as n from nail_private.bookings')).rows[0].n,1);
  await db.exec('update nail_private.calendar_jobs set next_attempt_at=now()');assert.equal((await run()).completed,1);
  assert.equal(events.size,1);const id=[...events.keys()][0];assert.equal(events.get(id).summary,'Khách kiểm thử - 0901234567 - 1 người');
  await db.query("update nail_private.bookings set starts_at=starts_at+interval '1 hour' where id=$1",[placed.booking.id]);
  assert.equal((await run()).completed,1);assert.equal(events.size,1);assert.equal(events.get(id).extendedProperties.private.booking_version,'2');
  const canceled=await(await handler(request({action:'cancel',phone:body.phone,date:slot.day,time:'10:00'}))).json();assert.equal(canceled.ok,true);
  assert.equal((await run()).completed,1);assert.equal(events.size,0);
  events.set(id,{id,extendedProperties:{private:{app:'dang-kilam-nail',booking_id:placed.booking.id}}});
  await db.exec("update nail_private.calendar_jobs set reconcile_at=now()-interval '1 second'");
  assert.equal((await run()).completed,1);assert.equal(events.size,0);
  const state=(await db.query('select desired_version,processed_version from nail_private.calendar_jobs')).rows[0];
  assert.equal(state.desired_version,state.processed_version);
 }finally{await db.close();}
});

test('Supabase secret key mới dùng apikey, không giả thành Bearer JWT',async()=>{
 const env={SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_test'}),SUPABASE_SERVICE_ROLE_KEY:'legacy'};
 assert.equal(serviceKey(k=>env[k]),'sb_secret_test');
 const rpc=database('https://example.test',serviceKey(k=>env[k]),async(url,options)=>{
   assert.equal(options.headers.apikey,'sb_secret_test');assert.equal(options.headers.Authorization,undefined);
   return Response.json({ok:true});
 });
 assert.equal((await rpc('test')).ok,true);assert.equal(serviceKey(k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'legacy':undefined),'legacy');
});

test('Lookup phone-only trả mảng; cancel chỉ truyền phone/ngày/giờ',async()=>{
 const calls=[];const h=api(async(name,args)=>{calls.push({name,args});return name==='customer_lookup'?{ok:true,bookings:[]}:{ok:true,booking:{id:'x'}};});
 assert.deepEqual(await(await h(request({action:'lookup',phone:body.phone}))).json(),{ok:true,bookings:[]});
 await h(request({action:'cancel',phone:body.phone,date:'2030-01-01',time:'09:00'}));
 assert.deepEqual(calls,[{name:'customer_lookup',args:{p_phone:'0901234567',p_ip_hash:null}},{name:'customer_cancel',args:{p_phone:'0901234567',p_ip_hash:null,p_local_date:'2030-01-01',p_local_time:'09:00'}}]);
});

test('Nâng cấp giữ đơn cũ/event_id, retry idempotency và huỷ không cần secret',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  for(const file of ['202609300001_core.sql','202610010002_calendar_worker.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
  const slot=(await db.query("select starts_at::text,local_date::text from public.availability where local_date=(now() at time zone 'Asia/Ho_Chi_Minh')::date+1 and local_time='09:00'")).rows[0];
  const key=crypto.randomUUID();const old=(await db.query('select public.customer_book($1,$2,$3,1,$4,$5,null) as r',['Khách cũ','0903456789',slot.starts_at,key,'c'.repeat(64)])).rows[0].r;
  assert.equal(old.ok,true);
  const before=(await db.query('select event_id,version,request_hash from nail_private.bookings where id=$1',[old.booking.id])).rows[0];
  await db.exec(await readFile(new URL('../supabase/migrations/202610090003_phone_lookup.sql',import.meta.url),'utf8'));
  const after=(await db.query('select event_id,version,request_hash from nail_private.bookings where id=$1',[old.booking.id])).rows[0];assert.deepEqual(after,before);
  const replay=(await db.query('select public.customer_book($1,$2,$3,1,$4,null) as r',['Khách cũ','0903456789',slot.starts_at,key])).rows[0].r;
  assert.equal(replay.replayed,true);assert.equal(replay.booking.id,old.booking.id);
  const lookup=(await db.query("select public.customer_lookup('0903456789',null) as r")).rows[0].r;assert.equal(lookup.bookings[0].id,old.booking.id);
  const canceled=(await db.query("select public.customer_cancel('0903456789',$1,'09:00',null) as r",[slot.local_date])).rows[0].r;assert.equal(canceled.booking.status,'cancelled');
  const job=(await db.query('select desired_version,processed_version from nail_private.calendar_jobs where booking_id=$1',[old.booking.id])).rows[0];assert.equal(job.desired_version,2);assert.equal(job.processed_version,0);
 }finally{await db.close();}
});

test('Frontend xác thực mảng lookup và không nhận lịch thuộc phone khác',async()=>{
 const original=globalThis.fetch;
 const backend=makeBackend({supabaseUrl:'https://mock.supabase.co',publishableKey:'sb_publishable_test'});
 try{
  globalThis.fetch=async()=>Response.json({ok:true,bookings:[]});
  assert.deepEqual(await backend.mutate({action:'lookup',phone:'0901234567'}),{ok:true,bookings:[]});
  globalThis.fetch=async()=>Response.json({ok:true,bookings:[{id:'wrong',phone:'0901234568',status:'confirmed',starts_at:'2030-01-01T02:00:00Z'}]});
  await assert.rejects(()=>backend.mutate({action:'lookup',phone:'0901234567'}),/connection_uncertain/);
  globalThis.fetch=async()=>Response.json({ok:true,booking:{id:'legacy'}});
  await assert.rejects(()=>backend.mutate({action:'lookup',phone:'0901234567'}),/connection_uncertain/);
 }finally{globalThis.fetch=original;}
});
