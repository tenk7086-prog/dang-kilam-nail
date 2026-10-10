import {test,expect} from '@playwright/test';
import {demoData,nextDays} from '../../web/src/backend.js';
import {readFileSync} from 'node:fs';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'};
const photos=JSON.parse(readFileSync(new URL('../../web/src/gallery-images.json',import.meta.url)));
// Never connect tests to the real shop, even when site-config is configured.
test.beforeEach(async({page})=>{
 await page.route('**/site-config.json',r=>r.fulfill({json:{supabaseUrl:'',publishableKey:'',siteUrl:''}}));
 await page.route('https://maps.google.com/**',r=>r.fulfill({body:''}));
});
for(const width of [390,768,1440]){
 test(`responsive ${width}px không tràn ngang`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/');
  await expect(page).toHaveTitle(/Hanhnail/);await expect(page.locator('#days .day')).toHaveCount(10);
  await expect(page.locator('[data-gallery]')).toHaveCount(4);
  await expect(page.locator('#people input[type=radio]')).toHaveCount(2);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/gd3-${width}.png`,fullPage:true});
  await page.goto('/admin.html');await expect(page.locator('#login-view')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 });
}
test('menu mobile đóng bằng Escape',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto('/');await page.locator('#menu-toggle').click();
 await expect(page.locator('#navigation')).toHaveClass(/open/);await page.keyboard.press('Escape');await expect(page.locator('#navigation')).not.toHaveClass(/open/);
});
test('gallery bốn ảnh có vòng trước/sau và Escape',async({page})=>{
 test.skip(Object.keys(photos).length!==4,'Chờ chủ tiệm cung cấp bốn ảnh thật.');
 await page.goto('/');await page.locator('[data-gallery="0"]').click();await expect(page.locator('#lightbox')).toBeVisible();
 await page.keyboard.press('ArrowLeft');await expect(page.locator('#lightbox-caption')).toContainText('Ocean shell');
 await page.keyboard.press('ArrowRight');await expect(page.locator('#lightbox-caption')).toContainText('Cat-eye xanh đêm');
 await page.keyboard.press('ArrowRight');await expect(page.locator('#lightbox-caption')).toContainText('Jelly trong');
 await page.keyboard.press('ArrowRight');await expect(page.locator('#lightbox-caption')).toContainText('Pearl shell');
 await page.keyboard.press('Escape');await expect(page.locator('#lightbox')).not.toBeVisible();
});
test('nhóm số người hỗ trợ phím mũi tên và không che xác nhận',async({page})=>{
 await page.goto('/');const one=page.locator('#people input[value="1"]'),two=page.locator('#people input[value="2"]');
 await one.focus();await page.keyboard.press('ArrowRight');await expect(two).toBeChecked();
 await expect(page.locator('select#people')).toHaveCount(0);
 const group=await page.locator('#people').boundingBox(),submit=await page.locator('#submit-booking').boundingBox();expect(group.y+group.height).toBeLessThan(submit.y);
 await page.locator('#days button').nth(1).click();await expect(page.locator('#slots button').filter({hasText:'12:00'})).toBeDisabled();
});
test('bản demo không báo đặt lịch thành công giả',async({page})=>{
 await page.goto('/');await page.locator('#days button').nth(1).click();await page.locator('#slots .slot:not(:disabled)').first().click();
 await page.locator('#customer-name').fill('Nguyễn Văn A');await page.locator('#customer-phone').fill('0901234567');await page.locator('#submit-booking').click();
 await expect(page.locator('#booking-error')).toContainText('bản xem trước');await expect(page.locator('#booking-success')).toBeHidden();
});
test('admin yêu cầu cấu hình trước đăng nhập',async({page})=>{
 await page.goto('/admin.html');await expect(page).toHaveTitle(/Quản trị/);await expect(page.locator('#login-error')).toContainText('Chưa cấu hình Supabase');
});
async function mockLive(page){
 const data=demoData();const calls=[];const day=nextDays()[1];
 let bookings=[9,10,11].map((hour,i)=>({id:`booking-${i}`,name:'Khách thử',phone:'0901234567',people:1,status:'confirmed',can_cancel:true,starts_at:`${day}T${hour.toString().padStart(2,'0')}:00:00+07:00`}));
 await page.route('**/site-config.json',r=>r.fulfill({json:{supabaseUrl:'https://mock.supabase.co',publishableKey:'sb_publishable_test',siteUrl:''}}));
 await page.route('https://mock.supabase.co/rest/v1/**',r=>{const table=new URL(r.request().url()).pathname.split('/').pop();const values={availability:data.availability,shop_settings:[data.settings],weekly_hours:data.hours,services:data.services};return r.fulfill({headers:cors,json:values[table]});});
 await page.routeWebSocket('wss://mock.supabase.co/**',ws=>ws.close());
 await page.route('https://mock.supabase.co/functions/v1/customer-api',async r=>{
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:cors});
  const body=r.request().postDataJSON();calls.push(body);expect(body).not.toHaveProperty('secret');
  if(body.action==='lookup')return r.fulfill({headers:cors,json:{ok:true,bookings:bookings.filter(b=>b.status==='confirmed'&&b.phone===body.phone)}});
  if(body.action==='cancel'){const b=bookings.find(b=>b.starts_at.startsWith(`${body.date}T${body.time}`));b.status='cancelled';b.can_cancel=false;return r.fulfill({headers:cors,json:{ok:true,booking:b}});}
  await new Promise(resolve=>setTimeout(resolve,100));return r.fulfill({headers:cors,json:{ok:true,booking:{...bookings[0],starts_at:body.starts_at,name:body.name,people:body.people},replayed:false}});
 });
 return {calls};
}
test('tra cứu ba lịch và chỉ huỷ lịch được chọn',async({page})=>{
 const {calls}=await mockLive(page);await page.goto('/');await page.locator('#lookup-phone').fill('+84 901 234 567');await page.locator('#lookup-button').click();
 await expect(page.locator('.lookup-card')).toHaveCount(3);await expect(page.locator('#lookup-secret')).toHaveCount(0);
 await page.locator('.lookup-card').nth(1).getByRole('button',{name:'Huỷ lịch này'}).click();await page.locator('#confirm-cancel').click();
 await expect(page.locator('.lookup-card').nth(1)).toContainText('Lịch đã huỷ');await expect(page.getByRole('button',{name:'Huỷ lịch này',exact:true})).toHaveCount(2);
 expect(calls.find(c=>c.action==='cancel')).toEqual({action:'cancel',phone:'0901234567',date:nextDays()[1],time:'10:00'});
 await page.locator('#lookup-button').click();await expect(page.locator('.lookup-card')).toHaveCount(2);
});
test('đặt không có secret, điền phone tra cứu và chống bấm đúp',async({page})=>{
 const {calls}=await mockLive(page);await page.goto('/');await page.locator('#days button').nth(1).click();await page.locator('#slots .slot:not(:disabled)').first().click();
 await page.locator('#customer-name').fill('Khách thử');await page.locator('#customer-phone').fill('0901234567');
 await page.locator('#booking-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await expect(page.locator('#booking-success')).toBeVisible();expect(calls.filter(c=>c.action==='book')).toHaveLength(1);
 await expect(page.locator('#success-secret,.secret-box,#copy-secret')).toHaveCount(0);await expect(page.locator('#lookup-phone')).toHaveValue('0901234567');
 expect(await page.evaluate(()=>Object.keys(localStorage).sort())).toEqual(['dkn_name','dkn_phone']);
});
