import './admin.css';
import {normalizePhone,vnDate,nextDays} from './backend.js';
const $=id=>document.getElementById(id);const state={config:null,token:null,user:null,bookings:[],hours:[],settings:null,blocked:[],moveTarget:null,manualPending:null};
const weekdays=['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const dateText=iso=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(iso));
const timeText=iso=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const message=e=>({invalid_login:'Email hoặc mật khẩu không đúng.',invalid_phone:'Số điện thoại chưa hợp lệ.',invalid_name:'Họ tên chưa hợp lệ.',invalid_people:'Số người chưa hợp lệ.',not_found:'Không tìm thấy lịch.',version_conflict:'Lịch đã thay đổi, hãy tải lại.',booking_cancelled:'Lịch đã huỷ.',slot_full:'Khung giờ không còn đủ chỗ.',slot_unavailable:'Ngày/giờ không nằm trong giờ mở cửa hoặc đang nghỉ.',phone_blocked:'Số điện thoại đang bị chặn.',already_booked:'Số điện thoại này đã có lịch ở khung giờ đó.',too_many_active_bookings:'Số điện thoại đã có tối đa 3 lịch sắp tới.',outside_booking_window:'Giờ hẹn phải ở tương lai.',idempotency_conflict:'Thông tin đã thay đổi; hãy tải lại và kiểm tra lịch trước khi đặt lại.',future_date_too_far:'Ngày hẹn chỉ được chọn trong vòng 2 năm tới.',invalid_request:'Dữ liệu chưa hợp lệ.',configuration_invalid:'Website chưa cấu hình Supabase.'}[e]??'Không thể xử lý. Hãy thử lại.');
function show(id,text){$(id).textContent=text;$(id).hidden=!text;}
function configError(){show('login-error','Chưa cấu hình Supabase. Điền web/public/site-config.json trước khi đăng nhập.');}
async function loadConfig(){const res=await fetch('./site-config.json',{cache:'no-store'});if(!res.ok)throw Error();state.config=await res.json();if(!state.config.supabaseUrl||!state.config.publishableKey)throw Error();}
function headers(){return {'Content-Type':'application/json',apikey:state.config.publishableKey,Authorization:`Bearer ${state.token}`};}
async function auth(path,body){const res=await fetch(`${state.config.supabaseUrl.replace(/\/$/,'')}/auth/v1/${path}`,{method:'POST',headers:{apikey:state.config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error_code||data.error||'invalid_login');return data;}
async function rpc(name,body){const res=await fetch(`${state.config.supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body)});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.message?.match(/owner|not_owner/i)?'not_owner':data.hint||data.message||data.code||'server_error');return data;}
async function table(name,query){const res=await fetch(`${state.config.supabaseUrl.replace(/\/$/,'')}/rest/v1/${name}?${query}`,{headers:headers()});const data=await res.json().catch(()=>[]);if(!res.ok)throw Error(data.message||'server_error');return data;}
function setDefaultDates(){const days=nextDays();$('from-date').value=days[0];$('to-date').value=days[6]??days.at(-1);$('manual-date').min=days[0];const max=new Date(`${days[0]}T12:00:00+07:00`);max.setUTCDate(max.getUTCDate()+730);$('manual-date').max=vnDate(max);$('manual-date').value=days[0];}
function renderHours(){const values=state.hours.length?state.hours:Array.from({length:7},(_,weekday)=>({weekday,opens:'09:00:00',closes:weekday===0?'13:00:00':'20:00:00',capacity:2}));$('hours-fields').replaceChildren(...values.sort((a,b)=>a.weekday-b.weekday).map(h=>{const row=document.createElement('div');row.className='hours-row';row.dataset.weekday=h.weekday;const title=document.createElement('span');title.textContent=weekdays[h.weekday];const open=document.createElement('input');open.type='time';open.value=h.opens.slice(0,5);open.setAttribute('aria-label',`${weekdays[h.weekday]} mở cửa`);const close=document.createElement('input');close.type='time';close.value=h.closes.slice(0,5);close.setAttribute('aria-label',`${weekdays[h.weekday]} đóng cửa`);row.append(title,open,close);return row;}));}
function renderBookings(){const list=$('bookings-list');$('booking-count').textContent=`${state.bookings.length} lịch`;if(!state.bookings.length){list.innerHTML='<p class="admin-muted">Không có lịch trong khoảng đã chọn.</p>';return;}list.replaceChildren(...state.bookings.map(b=>{const row=document.createElement('article');row.className='booking-row';const start=document.createElement('div');start.innerHTML=`<div class="booking-primary">${esc(timeText(b.starts_at))} · ${esc(dateText(b.starts_at))}</div><div class="booking-meta">${esc(b.customer_name)} · ${esc(b.phone)} · ${b.people} người</div>`;const status=document.createElement('div');status.className=`booking-meta ${b.status==='cancelled'?'status-cancelled':'status-confirmed'}`;status.textContent=b.status==='cancelled'?'Đã huỷ':'Đã xác nhận';if(b.calendar_pending)status.textContent+=' · Đang đồng bộ lịch';if(b.calendar_error)status.textContent+=' · Lỗi Calendar';const actions=document.createElement('div');actions.className='booking-actions';if(b.status==='confirmed'){const cancel=document.createElement('button');cancel.className='button danger';cancel.type='button';cancel.textContent='Huỷ';cancel.addEventListener('click',()=>changeBooking(b,'cancel'));const move=document.createElement('button');move.className='button secondary';move.type='button';move.textContent='Dời giờ';move.addEventListener('click',()=>moveBooking(b));actions.append(move,cancel);}row.append(start,status,actions);return row;}));}
async function loadBookings(){const from=$('from-date').value,to=$('to-date').value;if(!from||!to||to<from||new Date(`${to}T00:00:00`)-new Date(`${from}T00:00:00`)>31*86400000)throw Error('invalid_request');const phone=$('filter-phone').value.trim();if(phone&&!normalizePhone(phone))throw Error('invalid_phone');state.bookings=await rpc('admin_list_bookings',{p_from:from,p_to:to,p_phone:phone?normalizePhone(phone):null});renderBookings();show('admin-error','');show('admin-status',`Đã tải ${state.bookings.length} lịch · ${from} đến ${to}`);}
async function createManualBooking(){const button=$('manual-booking-button');if(button.disabled)return;const name=$('manual-name').value.trim(),phone=normalizePhone($('manual-phone').value),date=$('manual-date').value,time=$('manual-time').value,people=Number($('manual-people').value);if(!name||!phone||!date||!time||!Number.isInteger(people)||people<1||people>20){show('admin-error',!phone?'Số điện thoại chưa hợp lệ.':'Dữ liệu lịch chưa hợp lệ.');return;}const payload={p_name:name,p_phone:phone,p_local_date:date,p_local_time:`${time.slice(0,5)}:00`,p_people:people};const fingerprint=JSON.stringify(payload);if(state.manualPending?.fingerprint!==fingerprint)state.manualPending={fingerprint,key:crypto.randomUUID()};button.disabled=true;button.textContent='Đang tạo lịch…';show('admin-error','');try{const data=await rpc('admin_create_booking',{...payload,p_idempotency_key:state.manualPending.key});if(!data?.ok)throw Error(data?.error||'server_error');state.manualPending=null;toast(data.replayed?'Lịch đã tồn tại, không tạo trùng.':'Đã tạo lịch và đưa vào hàng đợi đồng bộ Calendar.');$('from-date').value=date;$('to-date').value=date;$('filter-phone').value='';await loadBookings();$('manual-booking-form').reset();$('manual-date').min=vnDate();$('manual-date').value=date;}catch(e){show('admin-error',message(String(e.message||e)));}finally{button.disabled=false;button.textContent='Tạo lịch và đồng bộ Calendar';}}
async function changeBooking(b,action,newStartsAt=null){if(!confirm(action==='cancel'?'Huỷ lịch này?':'Dời lịch sang giờ đã chọn?'))return;try{const result=await rpc('admin_change_booking',{p_id:b.id,p_action:action,p_expected_version:b.version,p_new_starts_at:newStartsAt});toast(action==='cancel'?'Đã huỷ lịch.':'Đã dời lịch.');await loadBookings();return result;}catch(e){show('admin-error',message(String(e.message||e)));}}
async function moveBooking(b){state.moveTarget=b;const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(b.starts_at)).replace(', ','T');const [date,time]=local.split('T');$('move-date').value=date;$('move-time').value=time;$('move-summary').textContent=`${b.customer_name} · ${b.phone} · ${timeText(b.starts_at)} ${dateText(b.starts_at)}`;$('move-error').hidden=true;$('move-dialog').showModal();}
async function loadSettings(){state.settings=(await table('shop_settings','select=name,address,contact_phone,announcement&limit=1'))[0];state.hours=await table('weekly_hours','select=weekday,opens,closes,capacity&order=weekday');state.blocked=await rpc('admin_list_blocked_phones',{});$('shop-announcement').value=state.settings?.announcement??'';$('shop-phone').value=state.settings?.contact_phone??'';renderHours();renderBlocked();await loadClosedDays();}
function renderBlocked(){const list=$('blocked-list');if(!state.blocked.length){list.innerHTML='<p class="admin-muted">Chưa có số bị chặn.</p>';return;}list.replaceChildren(...state.blocked.map(b=>{const row=document.createElement('div');row.className='blocked-row';const info=document.createElement('span');info.innerHTML=`<strong>${esc(b.phone)}</strong><small>${esc(b.note||'Không có ghi chú')}</small>`;const button=document.createElement('button');button.className='button danger';button.type='button';button.textContent='Bỏ chặn';button.addEventListener('click',async()=>{try{await rpc('admin_set_blocked_phone',{p_phone:b.phone,p_block:false,p_note:''});toast('Đã bỏ chặn số.');await loadSettings();}catch(e){show('admin-error',message(String(e.message||e)));}});row.append(info,button);return row;}));}
function toast(text){$('admin-toast').textContent=text;$('admin-toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('admin-toast').hidden=true,3000);}
function csv(){const head=['id','customer_name','phone','starts_at','people','status','version','calendar_pending','calendar_error'];const lines=[head,...state.bookings.map(b=>head.map(k=>String(b[k]??'').replaceAll('"','""')))].map(row=>row.map(v=>`"${v}"`).join(','));const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`hanhnail-${$('from-date').value}-${$('to-date').value}.csv`;a.click();URL.revokeObjectURL(a.href);}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();if($('login-button').disabled)return;show('login-error','');$('login-button').disabled=true;$('login-button').textContent='Đang đăng nhập…';try{const data=await auth('token?grant_type=password',{email:$('login-email').value.trim(),password:$('login-password').value});state.token=data.access_token;state.user=data.user;sessionStorage.setItem('dkn_admin_token',state.token);$('login-view').hidden=true;$('dashboard-view').hidden=false;$('logout').hidden=false;await loadSettings();await loadBookings();}catch(e){show('login-error',message(String(e.message||e)));}finally{$('login-button').disabled=false;$('login-button').textContent='Đăng nhập';}});
$('logout').addEventListener('click',()=>{sessionStorage.removeItem('dkn_admin_token');location.reload();});$('load-bookings').addEventListener('click',async()=>{try{await loadBookings();}catch(e){show('admin-error',message(String(e.message||e)));}});$('refresh-admin').addEventListener('click',async()=>{try{await loadSettings();await loadBookings();toast('Đã tải lại dữ liệu.');}catch(e){show('admin-error',message(String(e.message||e)));}});$('export-csv').addEventListener('click',csv);$('reload-blocked').addEventListener('click',()=>loadSettings().catch(e=>show('admin-error',message(String(e.message||e)))));
$('blocked-form').addEventListener('submit',async e=>{e.preventDefault();const phone=normalizePhone($('blocked-phone').value);if(!phone)return show('admin-error','Số điện thoại chưa hợp lệ.');try{await rpc('admin_set_blocked_phone',{p_phone:phone,p_block:true,p_note:$('blocked-note').value.trim()});$('blocked-form').reset();toast('Đã thêm số bị chặn.');await loadSettings();}catch(e){show('admin-error',message(String(e.message||e)));}});
$('shop-form').addEventListener('submit',async e=>{e.preventDefault();const phone=$('shop-phone').value.trim();if(phone&&!normalizePhone(phone))return show('admin-error','Số điện thoại chưa hợp lệ.');try{await rpc('admin_configure',{p_kind:'shop',p_data:{announcement:$('shop-announcement').value,contact_phone:phone?normalizePhone(phone):null},p_remove:false});toast('Đã lưu thông tin tiệm.');}catch(e){show('admin-error',message(String(e.message||e)));}});
$('hours-form').addEventListener('submit',async e=>{e.preventDefault();try{for(const row of $('hours-fields').children){const inputs=row.querySelectorAll('input');if(!inputs[0].value||!inputs[1].value||inputs[0].value>=inputs[1].value)throw Error('invalid_request');await rpc('admin_configure',{p_kind:'hours',p_data:{weekday:Number(row.dataset.weekday),opens:inputs[0].value+':00',closes:inputs[1].value+':00',capacity:2},p_remove:false});}toast('Đã lưu giờ mở cửa.');await loadSettings();}catch(e){show('admin-error',message(String(e.message||e)));}});
$('capacity-form').addEventListener('submit',async e=>{e.preventDefault();try{await rpc('admin_configure',{p_kind:'capacity',p_data:{time:$('capacity-time').value+':00',capacity:Number($('capacity-value').value)},p_remove:false});toast('Đã lưu sức chứa riêng.');}catch(e){show('admin-error',message(String(e.message||e)));}});
$('manual-booking-form').addEventListener('submit',async e=>{e.preventDefault();await createManualBooking();});
$('move-form').addEventListener('submit',async e=>{e.preventDefault();if(!state.moveTarget)return;const date=$('move-date').value,time=$('move-time').value;if(!date||!time){show('move-error','Vui lòng chọn ngày và giờ mới.');return;}try{const moved=await changeBooking(state.moveTarget,'move',`${date}T${time.slice(0,5)}:00+07:00`);if(!moved)return;$('move-dialog').close();state.moveTarget=null;}catch(e){show('move-error',message(String(e.message||e)));}});
$('close-move').addEventListener('click',()=>{$('move-dialog').close();state.moveTarget=null;});
async function init(){setDefaultDates();try{await loadConfig();const token=sessionStorage.getItem('dkn_admin_token');if(token){state.token=token;$('login-view').hidden=true;$('dashboard-view').hidden=false;$('logout').hidden=false;try{await loadSettings();await loadBookings();}catch(e){sessionStorage.removeItem('dkn_admin_token');location.reload();}}}catch{configError();}}void init();

let closedBusy=false;
async function loadClosedDays(){
  const days=await table('closed_days',`select=local_date,notice&local_date=gte.${vnDate()}&order=local_date`);
  const list=$('closed-list');list.replaceChildren();
  if(!days.length){list.textContent='Chưa có ngày nghỉ sắp tới.';return;}
  for(const day of days){
    const row=document.createElement('div');row.className='closed-row';
    const text=document.createElement('span');text.textContent=`${day.local_date.split('-').reverse().join('/')} · ${day.notice||'Tiệm nghỉ'}`;
    const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Mở lại ngày này';button.disabled=closedBusy;
    button.addEventListener('click',()=>{if(confirm(`Mở nhận lịch lại ngày ${day.local_date.split('-').reverse().join('/')}?`))void saveClosedDays(day.local_date,day.local_date,true);});
    row.append(text,button);list.append(row);
  }
}
async function saveClosedDays(from,to,remove){
  if(closedBusy)return;
  closedBusy=true;
  for(const button of document.querySelectorAll('#closed-form button,#closed-list button'))button.disabled=true;
  show('closed-feedback','Đang lưu…');
  try{
    await rpc('admin_set_closed_days',{p_from:from,p_to:to,p_notice:$('closed-notice').value.trim()||'Tiệm nghỉ',p_remove:remove});
    show('closed-feedback',remove?'Đã mở lại ngày theo giờ và sức chứa hiện có.':'Đã khóa toàn bộ ngày đã chọn.');
  }catch(e){
    const error=String(e.message||e);
    show('closed-feedback',error==='closed_day_has_bookings'?'Có lịch khách trong khoảng ngày này. Chưa khóa ngày nào. Hãy dời hoặc huỷ lịch khách trước.':error.includes('admin_set_closed_days')?'Chưa cài migration 007 trên Supabase. Vui lòng chạy file SQL đi kèm.':message(error));
  }finally{
    closedBusy=false;
    $('closed-save').disabled=false;
    try{await loadClosedDays();}catch{show('closed-feedback','Chưa tải được danh sách. Bấm Tải lại trước khi thao tác tiếp.');}
  }
}
$('closed-from').min=vnDate();$('closed-to').min=vnDate();
$('closed-from').addEventListener('change',()=>{const from=$('closed-from').value;$('closed-to').min=from||vnDate();if(!$('closed-to').value||$('closed-to').value<from)$('closed-to').value=from;});
$('closed-form').addEventListener('submit',e=>{
  e.preventDefault();const from=$('closed-from').value,to=$('closed-to').value;
  if(!from||!to||from<vnDate()||to<from||Date.parse(to)-Date.parse(from)>365*86400000){show('closed-feedback','Chọn khoảng ngày từ hôm nay, tối đa 366 ngày mỗi lần.');return;}
  void saveClosedDays(from,to,false);
});

// Các thao tác chỗ trống không tạo đơn khách và không gửi Calendar.
let daySlotsBusy=false, daySlotsLoaded=null;
const daySlotsDate=$('day-slots-date');daySlotsDate.min=vnDate();daySlotsDate.value=vnDate();
function renderDaySlots(data){
 $('day-slots-grid').replaceChildren(...data.slots.map(slot=>{
  const card=document.createElement('article');card.className='day-slot-card';
  const title=document.createElement('h3');title.textContent=slot.time.slice(0,5)+(slot.extra?' · Ca thêm':'');
  const detail=document.createElement('p');detail.textContent=`Đã đặt: ${slot.reserved} · Đã khóa: ${slot.blocked} · Còn: ${data.closed?0:slot.remaining}`;
  card.append(title,detail);
  for(const [action,label,disabled] of [['block','Khóa 1 chỗ',slot.remaining<1],['unblock','Mở lại 1 chỗ',slot.blocked<1]]){
   const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=label;
   button.disabled=disabled||data.closed||Date.parse(slot.starts_at)<=Date.now();
   button.addEventListener('click',()=>editDaySlot(slot.time,action,null,slot.blocked));card.append(button);
  }return card;
 }));
 show('day-slots-feedback',data.closed?'Ngày này đang khóa cả ngày. Hãy mở lại trong mục Ngày nghỉ trước khi chỉnh khung giờ.':data.slots.length?'Mỗi lần bấm khóa một chỗ còn trống.':'Chưa có khung giờ. Bạn có thể mở thêm ca cho ngày này.');
}
async function loadDaySlots(){
 if(daySlotsBusy)return;daySlotsBusy=true;daySlotsLoaded=null;$('day-slots-grid').replaceChildren();show('day-slots-feedback','Đang tải…');
 try{const date=daySlotsDate.value;const data=await rpc('admin_day_slots',{p_date:date});if(date===daySlotsDate.value){daySlotsLoaded=date;renderDaySlots(data);}}
 catch(e){show('day-slots-feedback',slotError(e));}finally{daySlotsBusy=false;}
}
function slotError(e){const error=String(e.message||e);return error==='slot_exists'?'Khung giờ đã tồn tại. Hãy dùng nút mở lại chỗ nếu đã khóa.':error.includes('admin_day_slots')||error.includes('admin_edit_day_slot')?'Chưa cài bản cập nhật SQL 008 hoặc phiên đăng nhập không còn hợp lệ.':message(error);}
async function editDaySlot(time,action,value,expected){
 if(daySlotsBusy)return;
 if(daySlotsLoaded!==daySlotsDate.value){show('day-slots-feedback','Hãy tải khung giờ của ngày đã chọn trước.');return;}
 const date=daySlotsDate.value;daySlotsBusy=true;daySlotsDate.disabled=true;
 $('day-slots-grid').querySelectorAll('button').forEach(b=>b.disabled=true);show('day-slots-feedback','Đang lưu…');
 try{const data=await rpc('admin_edit_day_slot',{p_date:date,p_time:time,p_action:action,p_value:value,p_expected_blocked:expected});renderDaySlots(data);show('day-slots-feedback','Đã lưu thay đổi cho ngày '+date.split('-').reverse().join('/')+'.');}
 catch(e){daySlotsLoaded=null;$('day-slots-grid').replaceChildren();show('day-slots-feedback',slotError(e)+' Bấm Tải khung giờ để kiểm tra trước khi thử lại.');}
 finally{daySlotsBusy=false;daySlotsDate.disabled=false;}
}
$('day-slots-form').addEventListener('submit',e=>{e.preventDefault();void loadDaySlots();});
daySlotsDate.addEventListener('change',()=>{daySlotsLoaded=null;$('day-slots-grid').replaceChildren();void loadDaySlots();});
$('day-slots-add').addEventListener('submit',e=>{e.preventDefault();void editDaySlot($('day-slots-time').value,'add',Number($('day-slots-capacity').value),null);});
