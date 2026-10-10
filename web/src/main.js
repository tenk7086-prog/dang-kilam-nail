import './style.css';
import {gallery} from './gallery.js';
import {makeBackend,ApiError,nextDays,vnDate,normalizePhone,newRequestKey} from './backend.js';
const $=id=>document.getElementById(id);
const state={backend:null,data:null,day:vnDate(),slot:null,people:1,busy:false,pending:null,uncertain:false,lookup:null,cancelTarget:null,lookupPhone:null,lookupBusy:false,cancelBusy:false,liveSocket:false,loading:false,dirty:false};
const messages={slot_full:'Khung giờ vừa hết chỗ cho nhóm của bạn. Vui lòng chọn giờ khác.',slot_unavailable:'Khung giờ này không còn nhận lịch.',already_booked:'Số điện thoại này đã có lịch ở khung giờ đã chọn. Hãy tra cứu lịch cũ.',outside_booking_window:'Khung giờ đã qua hoặc ngoài 10 ngày nhận lịch.',invalid_phone:'Số điện thoại chưa hợp lệ. Hãy nhập số di động Việt Nam, ví dụ 0901 234 567.',invalid_name:'Họ tên cần từ 2–80 ký tự và không có ký tự xuống dòng.',invalid_people:'Vui lòng chọn số người hợp lệ.',phone_blocked:'Chưa thể đặt trực tuyến với số này. Vui lòng liên hệ tiệm.',too_many_active_bookings:'Số điện thoại đã có 3 lịch sắp tới. Hãy kiểm tra các lịch đã đặt.',rate_limited:'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau khoảng 15 phút.',not_found:'Không tìm thấy lịch với số điện thoại này.',cancellation_too_late:'Lịch đã bắt đầu hoặc đã quá thời hạn huỷ trực tuyến.',idempotency_conflict:'Thông tin yêu cầu không khớp. Hãy kiểm tra lịch trước khi đặt lại.',preview_only:'Đây là bản xem trước, chưa nhận đặt hoặc tra cứu lịch thật.',configuration_invalid:'Chức năng đặt lịch chưa được cấu hình đúng. Vui lòng liên hệ tiệm.',origin_denied:'Website chưa được phép kết nối hệ thống đặt lịch. Vui lòng liên hệ tiệm.',load_failed:'Chưa tải được lịch. Vui lòng kiểm tra mạng và thử lại.'};
const describe=err=>messages[err.code]??'Chưa thể xử lý yêu cầu. Vui lòng thử lại sau.';
const timeText=iso=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const dayText=iso=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',weekday:'long',day:'2-digit',month:'2-digit'}).format(new Date(iso+'T12:00:00+07:00'));
let toastTimer,pollTimer,eventTimer,pollAttempt=0,clockTimer,configTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function showError(id,text){$(id).textContent=text;$(id).hidden=!text;}
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function headerHeight(){document.documentElement.style.setProperty('--header-h',`${$('site-header').offsetHeight}px`);}
new ResizeObserver(headerHeight).observe($('site-header'));
$('year').textContent=new Date().getFullYear();
$('menu-toggle').addEventListener('click',()=>{const open=$('menu-toggle').getAttribute('aria-expanded')!=='true';$('navigation').classList.toggle('open',open);$('menu-toggle').setAttribute('aria-expanded',String(open));$('menu-toggle').setAttribute('aria-label',open?'Đóng menu':'Mở menu');});
function closeMenu(){$('navigation').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');$('menu-toggle').setAttribute('aria-label','Mở menu');}
$('navigation').addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('navigation').classList.contains('open')){closeMenu();$('menu-toggle').focus();}});
let galleryIndex=0;
function photo(item,width=480){const img=el('img');img.src=`./images/${item.file}-${width}.webp`;img.srcset=[480,800,1200].map(w=>`./images/${item.file}-${w}.webp ${w}w`).join(', ');img.sizes='(max-width: 767px) 92vw, (max-width: 1023px) 44vw, 280px';img.width=item.width;img.height=item.height;img.alt=item.alt;img.loading='lazy';img.decoding='async';return img;}
function paintGallery(){
 $('gallery').replaceChildren(...gallery.map((item,index)=>{const b=el('button','gallery-card');b.type='button';b.dataset.gallery=String(index);b.setAttribute('aria-label',`${item.name} — ${item.description}`);
 b.append(item.ready?photo(item):el('div','photo-pending','Ảnh tiệm đang được cập nhật'));
 const caption=el('span');caption.append(el('b','',item.name),el('small','',item.description),el('span','gallery-plus','+'));b.append(caption);b.disabled=!item.ready;
 b.addEventListener('click',()=>{showGallery(index);$('lightbox').showModal();});return b;}));
 if(gallery[0].ready&&$('hero-image').tagName!=='IMG'){const img=photo(gallery[0],800);img.loading='eager';img.fetchPriority='high';img.sizes='(max-width: 767px) 92vw, (max-width: 1279px) 45vw, 560px';$('hero-image').replaceWith(img);}
}
function stepGallery(delta){for(let i=1;i<=gallery.length;i++){const next=(galleryIndex+delta*i+gallery.length)%gallery.length;if(gallery[next].ready){showGallery(next);return;}}}
function showGallery(index){galleryIndex=(index+gallery.length)%gallery.length;const item=gallery[galleryIndex];const img=$('lightbox-image');img.src=`./images/${item.file}-1200.webp`;img.alt=item.alt;img.width=item.width;img.height=item.height;$('lightbox-caption').textContent=`${item.name} — ${item.description}`;}
paintGallery();
$('gallery-prev').addEventListener('click',()=>stepGallery(-1));$('gallery-next').addEventListener('click',()=>stepGallery(1));
$('lightbox').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();stepGallery(e.key==='ArrowLeft'?-1:1);}});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.close==='cancel-dialog'&&state.cancelBusy)return;$(button.dataset.close).close();}));
$('keep-booking').addEventListener('click',()=>$('cancel-dialog').close());
$('cancel-dialog').addEventListener('cancel',e=>{if(state.cancelBusy)e.preventDefault();});
function readRemembered(){try{$('customer-name').value=localStorage.getItem('dkn_name')??'';$('customer-phone').value=localStorage.getItem('dkn_phone')??'';$('lookup-phone').value=$('customer-phone').value;}catch{}}
function remember(){try{if($('remember').checked){localStorage.setItem('dkn_name',$('customer-name').value.trim());localStorage.setItem('dkn_phone',normalizePhone($('customer-phone').value)??'');}else{localStorage.removeItem('dkn_name');localStorage.removeItem('dkn_phone');}}catch{}}
$('remember').addEventListener('change',()=>{if(!$('remember').checked)remember();});readRemembered();
function paintDays(){const focused=document.activeElement?.dataset?.day;const days=nextDays();if(!days.includes(state.day)){state.day=days[0];state.slot=null;}
 $('month-label').textContent=new Intl.DateTimeFormat('vi-VN',{month:'long',year:'numeric',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(state.day+'T12:00:00+07:00'));
 $('days').replaceChildren(...days.map((day,index)=>{const b=el('button','day');b.type='button';b.dataset.day=day;b.setAttribute('aria-pressed',String(day===state.day));b.setAttribute('aria-label',dayText(day)+(index===0?', hôm nay':''));b.disabled=state.busy||state.uncertain;
 const date=new Date(day+'T12:00:00+07:00');b.append(el('span','',index===0?'Hôm nay':new Intl.DateTimeFormat('vi-VN',{weekday:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(date)),el('strong','',day.slice(8)),el('span','',`Tháng ${Number(day.slice(5,7))}`));b.addEventListener('click',()=>{state.day=day;state.slot=null;paintDays();paintSlots();summary();});return b;}));
 if(focused)$('days').querySelector(`[data-day="${focused}"]`)?.focus({preventScroll:true});
}
function paintSlots(){if(!state.data)return;const active=document.activeElement?.dataset?.slot;
 const list=state.data.availability.filter(x=>x.local_date===state.day&&(x.capacity>0||x.reserved>0));
 const nodes=list.map(row=>{const passed=Date.parse(row.starts_at)<=Date.now();const full=row.remaining<state.people;
 const button=el('button','slot');button.type='button';button.dataset.slot=row.starts_at;button.disabled=passed||full||state.busy||state.uncertain||state.loading;button.setAttribute('aria-pressed',String(state.slot===row.starts_at));
 const label=passed?'Đã qua giờ':row.remaining===0?'Đã đủ chỗ':full?`Còn ${row.remaining} chỗ · không đủ nhóm`:`Còn ${row.remaining} chỗ`;
 button.append(el('strong','',row.local_time.slice(0,5)),el('small','',label));button.setAttribute('aria-label',`${row.local_time.slice(0,5)}, ${label}`);button.addEventListener('click',()=>{state.slot=row.starts_at;showError('booking-error','');paintSlots();summary();scrollToCustomerForm();});return button;});
 if(!nodes.length)nodes.push(el('p','empty','Tiệm không nhận lịch trong ngày này. Hãy chọn ngày khác.'));
 $('slots').replaceChildren(...nodes);$('slots').setAttribute('aria-busy',String(state.loading));
 if(active)[...$('slots').querySelectorAll('button')].find(x=>x.dataset.slot===active)?.focus({preventScroll:true});
}
function summary(){const current=state.data?.availability.find(x=>x.starts_at===state.slot);
 $('selected-summary').textContent=current?`${timeText(current.starts_at)} · ${dayText(current.local_date)}`:'Chưa chọn khung giờ';
 const valid=!!current&&Date.parse(current.starts_at)>Date.now()&&current.remaining>=state.people&&!state.loading;
 $('submit-booking').disabled=state.busy||(!state.uncertain&&!valid)||!state.backend;
 $('submit-booking').textContent=state.busy?'Đang xác nhận…':state.uncertain?'Kiểm tra lại yêu cầu vừa gửi':'Xác nhận đặt lịch';
 $('booking-fields').disabled=state.busy||state.uncertain;
}
function paintSettings(){const {settings,hours,services}=state.data;document.querySelectorAll('[data-address]').forEach(x=>x.textContent=settings.address);
 $('announcement').textContent=settings.announcement;$('announcement').hidden=!settings.announcement;
 $('price-grid').replaceChildren(...services.map((s,i)=>{const a=el('article','price-card');a.append(el('p','price-label',s.is_sample?'GIÁ THAM KHẢO · DỮ LIỆU MẪU':'DỊCH VỤ TẠI TIỆM'),el('h3','',s.name),el('p','',s.description));const price=el('strong','price-amount',new Intl.NumberFormat('vi-VN').format(s.price_vnd));price.append(el('small','','đ'));a.append(price);const link=el('a','text-link','Chọn lịch hẹn');link.href='#dat-lich';a.append(link);return a;}));
 $('price-grid').setAttribute('aria-busy','false');
 $('opening-hours').replaceChildren(...[1,2,3,4,5,6,0].map(day=>{const h=hours.find(x=>x.weekday===day);const p=el('p');p.append(el('span','',day===0?'Chủ nhật':`Thứ ${day+1}`),el('strong','',!h||h.capacity===0?'Nghỉ':`${h.opens.slice(0,5)} – ${h.closes.slice(0,5)}`));return p;}));
 $('hours-note').hidden=state.backend.live;const phone=normalizePhone(settings.contact_phone??'');
 if(phone){const call=el('a','button primary','Gọi tiệm');call.href=`tel:${phone}`;const zalo=el('a','button secondary','Nhắn Zalo');zalo.href=`https://zalo.me/${phone}`;zalo.target='_blank';zalo.rel='noopener noreferrer';$('contact-buttons').replaceChildren(call,zalo);$('contact-note').textContent=phone;document.querySelector('[data-contact-mini]').replaceChildren(Object.assign(el('a','',`Zalo · ${phone}`),{href:zalo.href,target:'_blank',rel:'noopener noreferrer'}));}
 else{$('contact-buttons').replaceChildren(...['Gọi tiệm','Nhắn Zalo'].map(t=>{const b=el('button','button secondary',t);b.disabled=true;return b;}));$('contact-note').textContent='Số điện thoại / Zalo đang được cập nhật.';document.querySelector('[data-contact-mini]').textContent='Zalo: đang cập nhật';}
}
function paintPeople(max){const active=document.activeElement;const focused=active?.name==='people'?active.value:null;
 const nodes=Array.from({length:max},(_,i)=>{const label=el('label','people-option');const input=el('input');input.type='radio';input.name='people';input.value=String(i+1);input.checked=state.people===i+1;label.append(input,el('span','',`${i+1} người`));return label;});
 $('people').querySelector('.people-options').replaceChildren(...nodes);
 if(focused)$('people').querySelector(`input[value="${focused}"]`)?.focus({preventScroll:true});
}
$('people').addEventListener('change',e=>{if(e.target.name!=='people')return;state.people=Number(e.target.value);const r=state.data?.availability.find(x=>x.starts_at===state.slot);if(r&&r.remaining<state.people){state.slot=null;showError('booking-error','Khung vừa chọn không đủ chỗ cho nhóm. Vui lòng chọn giờ khác.');}paintSlots();summary();});
function fallback(){clearTimeout(pollTimer);if(document.hidden||state.liveSocket||!state.backend?.live)return;const delay=Math.min(120000,15000*2**Math.min(pollAttempt++,3))*(.8+Math.random()*.4);pollTimer=setTimeout(async()=>{await refresh();fallback();},delay);}
async function refresh(){if(document.hidden)return;if(state.loading){state.dirty=true;return;}state.loading=true;summary();try{const data=await state.backend.snapshot();state.data=data;const max=Math.max(1,...data.availability.map(x=>x.capacity));const previous=state.people;
 state.people=Math.min(previous,max);paintPeople(max);
 const selected=data.availability.find(x=>x.starts_at===state.slot);if(!state.uncertain&&!state.busy&&state.slot&&(!selected||selected.remaining<state.people||Date.parse(selected.starts_at)<=Date.now())){state.slot=null;showError('booking-error','Khung giờ vừa thay đổi hoặc không còn đủ chỗ. Hãy chọn lại giờ hẹn.');}
 $('availability-error').hidden=true;paintSettings();paintDays();
 }catch{ $('availability-error').hidden=false;state.data=null;$('slots').replaceChildren(el('p','empty','Không thể xác nhận chỗ trống lúc này.'));$('slots').setAttribute('aria-busy','false');}
 finally{state.loading=false;paintSlots();summary();paintLookup();if(state.dirty){state.dirty=false;void refresh();}}
}
$('reload-slots').addEventListener('click',()=>refresh());
function paintDetails(container,booking){const rows=[['Họ tên',booking.name],['Điện thoại',booking.phone],['Lịch hẹn',`${timeText(booking.starts_at)} · ${dayText(vnDate(new Date(booking.starts_at)))}`],['Số người',`${booking.people} người`],['Trạng thái',booking.status==='cancelled'?'Đã huỷ':'Đã xác nhận']];(typeof container==='string'?$(container):container).replaceChildren(...rows.map(([key,value])=>{const row=el('div');row.append(el('dt','',key),el('dd','',String(value)));return row;}));}
function booked(result){clearLookup();const b=result.booking;$('booking-grid').hidden=true;$('booking-success').hidden=false;paintDetails('success-details',b);$('success-title').textContent=b.status==='cancelled'?'Lịch này đã được huỷ.':'Hẹn gặp bạn tại tiệm!';$('lookup-phone').value=b.phone;state.pending=null;state.uncertain=false;state.slot=null;$('booking-success').focus();$('booking-success').scrollIntoView({behavior:'smooth',block:'center'});}
$('booking-form').addEventListener('submit',async e=>{e.preventDefault();if(state.busy)return;showError('booking-error','');
 if(!state.uncertain){const phone=normalizePhone($('customer-phone').value);const name=$('customer-name').value.trim();if(!phone){showError('booking-error',messages.invalid_phone);$('customer-phone').focus();return;}if([...name].length<2||[...name].length>80||/[\x00-\x1f\x7f]/.test(name)){showError('booking-error',messages.invalid_name);$('customer-name').focus();return;}
 const row=state.data?.availability.find(x=>x.starts_at===state.slot);if(!row||row.remaining<state.people||Date.parse(row.starts_at)<=Date.now()){showError('booking-error','Vui lòng chọn một khung giờ còn đủ chỗ.');return;}
 if(!state.backend.live){showError('booking-error',messages.preview_only);return;}
 state.pending={action:'book',name,phone,people:state.people,starts_at:row.starts_at,idempotency_key:newRequestKey()};remember();}
 state.busy=true;summary();paintDays();paintSlots();try{const result=await state.backend.mutate(state.pending);booked(result);void refresh();}
 catch(err){if(err.uncertain||(state.uncertain&&['rate_limited','idempotency_conflict'].includes(err.code))){state.uncertain=true;showError('booking-error','Chưa nhận được xác nhận từ hệ thống. Đơn có thể đã được lưu. Bấm “Kiểm tra lại yêu cầu vừa gửi”; không đóng trang hoặc đặt lại đơn mới.');}else{state.pending=null;state.uncertain=false;showError('booking-error',describe(err));if(['slot_full','slot_unavailable','outside_booking_window'].includes(err.code)){state.slot=null;void refresh();}}}
 finally{state.busy=false;summary();paintDays();paintSlots();}
});
$('new-booking').addEventListener('click',()=>{$('booking-success').hidden=true;$('booking-grid').hidden=false;state.lookup=null;$('lookup-result').hidden=true;showError('booking-error','');paintDays();paintSlots();summary();$('days').querySelector('button')?.focus();});
window.addEventListener('beforeunload',e=>{if(state.uncertain||state.busy){e.preventDefault();e.returnValue='';}});
function paintLookup(){if(!state.lookup)return;const focused=document.activeElement?.dataset?.cancelId;
 // Single source of truth: DB setting (also enforced by customer_cancel).
 const CANCEL_MIN_HOURS=state.data?.settings.cancel_before_hours;
 $('lookup-result').hidden=false;
 $('lookup-result').replaceChildren(...state.lookup.map(booking=>{const card=el('article','lookup-card');const details=el('dl','booking-details');paintDetails(details,booking);card.append(details);
 if(booking.status==='cancelled'){card.append(el('p','cancel-explanation','Lịch đã huỷ, chỗ đã được trả lại.'));}
 else{const button=el('button','button danger','Huỷ lịch này');button.type='button';button.dataset.cancelId=booking.id;
 const remaining=Date.parse(booking.starts_at)-Date.now();button.disabled=state.cancelBusy||booking.can_cancel!==true||!Number.isFinite(CANCEL_MIN_HOURS)||remaining<=0||remaining<CANCEL_MIN_HOURS*3600000;
 button.addEventListener('click',()=>{state.cancelTarget={...booking};showError('cancel-error','');$('cancel-summary').textContent=`${timeText(booking.starts_at)} · ${dayText(vnDate(new Date(booking.starts_at)))} · ${booking.people} người`;$('cancel-dialog').showModal();});card.append(button);}return card;}));
 if(!state.lookup.length)$('lookup-result').append(el('p','empty','Không có lịch sắp tới với số điện thoại này.'));
 if(focused)[...$('lookup-result').querySelectorAll('[data-cancel-id]')].find(b=>b.dataset.cancelId===focused)?.focus({preventScroll:true});
}
function clearLookup(){state.lookup=null;state.cancelTarget=null;state.lookupPhone=null;$('lookup-result').hidden=true;}
$('lookup-phone').addEventListener('input',clearLookup);
$('lookup-form').addEventListener('submit',async e=>{e.preventDefault();if(state.lookupBusy||state.cancelBusy)return;clearLookup();showError('lookup-error','');const phone=normalizePhone($('lookup-phone').value);if(!phone){showError('lookup-error',messages.invalid_phone);return;}
 state.lookupBusy=true;$('lookup-phone').disabled=true;$('lookup-button').disabled=true;$('lookup-button').textContent='Đang tra cứu…';try{const result=await state.backend.mutate({action:'lookup',phone});state.lookup=result.bookings;state.lookupPhone=phone;paintLookup();}catch(err){showError('lookup-error',err.uncertain?'Chưa tra cứu được. Vui lòng kiểm tra mạng và thử lại.':describe(err));}finally{state.lookupBusy=false;$('lookup-phone').disabled=false;$('lookup-button').disabled=false;$('lookup-button').textContent='Tra cứu lịch hẹn';}
});
$('confirm-cancel').addEventListener('click',async()=>{if(state.cancelBusy||!state.cancelTarget)return;const target=state.cancelTarget;const phone=state.lookupPhone;state.cancelBusy=true;showError('cancel-error','');$('confirm-cancel').disabled=true;$('keep-booking').disabled=true;$('confirm-cancel').textContent='Đang huỷ…';try{const result=await state.backend.mutate({action:'cancel',phone,date:vnDate(new Date(target.starts_at)),time:timeText(target.starts_at)});state.lookup=state.lookup.map(b=>b.id===target.id?result.booking:b);$('cancel-dialog').close();toast('Đã huỷ lịch và trả lại chỗ.');void refresh();}catch(err){showError('cancel-error',err.uncertain?'Chưa nhận được kết quả huỷ. Bạn có thể bấm xác nhận lại hoặc tra cứu lại; thao tác lặp không trả chỗ hai lần.':describe(err));}finally{state.cancelBusy=false;paintLookup();$('confirm-cancel').disabled=false;$('keep-booking').disabled=false;$('confirm-cancel').textContent='Xác nhận huỷ';}
});
function connect(){state.backend.connect(()=>{clearTimeout(eventTimer);eventTimer=setTimeout(()=>refresh(),150);},status=>{state.liveSocket=status==='SUBSCRIBED';$('sync-status').textContent=status==='preview'?'Lịch minh hoạ':state.liveSocket?'Cập nhật trực tiếp':'Đang kết nối lại';if(state.liveSocket){pollAttempt=0;clearTimeout(pollTimer);void refresh();}else fallback();});}
function runClock(){clearTimeout(clockTimer);if(document.hidden)return;clockTimer=setTimeout(()=>{if(!nextDays().includes(state.day)){state.slot=null;void refresh();}else{paintSlots();summary();paintLookup();}runClock();},30000);}
document.addEventListener('visibilitychange',()=>{clearTimeout(pollTimer);clearTimeout(clockTimer);clearTimeout(configTimer);if(document.hidden){state.liveSocket=false;state.backend?.disconnect();}else if(state.backend){void refresh();connect();runClock();scheduleConfig();}});
window.addEventListener('online',()=>{pollAttempt=0;if(state.backend){void refresh();fallback();}});
function scheduleConfig(){clearTimeout(configTimer);if(document.hidden||!state.backend?.live)return;configTimer=setTimeout(async()=>{if(state.liveSocket)await refresh();scheduleConfig();},300000*(.9+Math.random()*.2));}
async function init(){paintDays();try{const res=await fetch('./site-config.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!res.ok)throw new ApiError('configuration_invalid');const config=await res.json();state.backend=makeBackend(config);
 if(state.backend.live){const link=document.createElement('link');link.rel='preconnect';link.href=config.supabaseUrl;document.head.append(link);}else{$('mode-notice').hidden=false;$('mode-notice').textContent='Bản xem trước — lịch và giá đang dùng dữ liệu mẫu. Chưa nhận đặt lịch thật.';}
 await refresh();connect();runClock();scheduleConfig();
 }catch(err){$('mode-notice').hidden=false;$('mode-notice').textContent=messages.configuration_invalid;$('slots').replaceChildren(el('p','empty','Chưa thể tải lịch.'));$('slots').setAttribute('aria-busy','false');$('sync-status').textContent='Chưa kết nối';const data=(await import('./backend.js')).demoData();state.data=data;state.backend=null;$('price-grid').replaceChildren(el('p','','Chưa tải được bảng giá.'));$('price-grid').setAttribute('aria-busy','false');summary();}}
void init();

// Cuộn sau khi người dùng chọn giờ, chỉ ở bố cục điện thoại.
function scrollToCustomerForm(){
 if(!window.matchMedia('(max-width: 767px)').matches)return;
 requestAnimationFrame(()=>{
  const form=$('booking-form');
  const header=$('site-header');
  const top=Math.max(0,window.scrollY+form.getBoundingClientRect().top-(header?.getBoundingClientRect().height??0)-16);
  window.scrollTo({top,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 });
}
