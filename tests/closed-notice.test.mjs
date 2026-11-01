import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBackend,nextDays,closedDayNotice} from '../web/src/backend.js';
test('Thông báo đúng ngày; fallback khi trống; ngày khác không có thông báo',()=>{
 const days=[{local_date:'2026-11-09',notice:' Nghỉ đến 11/11\nMở lại 12/11 '},{local_date:'2026-11-10',notice:'  '}];
 assert.equal(closedDayNotice(days,'2026-11-09'),'Nghỉ đến 11/11\nMở lại 12/11');
 assert.equal(closedDayNotice(days,'2026-11-10'),'Tiệm nghỉ trong ngày này. Vui lòng chọn ngày khác.');
 assert.equal(closedDayNotice(days,'2026-11-12'),null);
 assert.equal(closedDayNotice(undefined,'2026-11-12'),null);
});
test('Snapshot tải thông báo ngày nghỉ trong cửa sổ đặt lịch',async t=>{
 const day=nextDays()[1];const closed=[{local_date:day,notice:'Thông báo của chủ tiệm'}];let requested=false;
 t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);const table=u.pathname.split('/').at(-1);
  if(table==='closed_days'){requested=true;assert.equal(u.searchParams.get('local_date'),'gte.'+nextDays()[0]);}
  return Response.json(table==='shop_settings'?[{}]:table==='closed_days'?closed:[]);
 });
 const data=await makeBackend({supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test'}).snapshot();
 assert.ok(requested);assert.deepEqual(data.closedDays,closed);
});
