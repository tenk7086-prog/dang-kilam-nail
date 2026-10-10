export class ApiError extends Error {constructor(code,uncertain=false){super(code);this.code=code;this.uncertain=uncertain;}}
export function vnDate(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function nextDays(){const today=vnDate();return Array.from({length:10},(_,i)=>{const date=new Date(today+'T12:00:00+07:00');date.setUTCDate(date.getUTCDate()+i);return vnDate(date);});}
export function normalizePhone(input){if(typeof input!=='string'||input.length>32||!/^\+?[0-9 ()-]+$/.test(input))return null;let p=input.replace(/[ ()-]/g,'');if(p.startsWith('+84'))p='0'+p.slice(3);else if(p.startsWith('84'))p='0'+p.slice(2);return /^0[35789][0-9]{8}$/.test(p)&&!/^([0-9])\1{7}$/.test(p.slice(2))?p:null;}
export function newRequestKey(){return crypto.randomUUID();}
export function validConfig(config){
 if(!config.supabaseUrl&&!config.publishableKey)return false;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl??''))throw new ApiError('configuration_invalid');
 const key=config.publishableKey??'';
 if(key.startsWith('sb_publishable_'))return true;
 try{const p=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(p.role==='anon')return true;}catch{}
 throw new ApiError('configuration_invalid');
}
const sampleSettings={name:'Hanhnail',address:'Số 181 Khương Thượng, Phường Kim Liên, Hà Nội',contact_phone:null,announcement:'',cancel_before_hours:0};
export function demoData(){
 const availability=nextDays().flatMap(day=>{const sunday=new Date(day+'T12:00:00+07:00').getUTCDay()===0;return Array.from({length:sunday?4:11},(_,i)=>{const h=i+9;return{local_date:day,local_time:String(h).padStart(2,'0')+':00:00',starts_at:`${day}T${String(h).padStart(2,'0')}:00:00+07:00`,capacity:h===12?1:2,reserved:0,remaining:h===12?1:2};});});
 return{settings:sampleSettings,availability,hours:Array.from({length:7},(_,i)=>({weekday:i,opens:'09:00:00',closes:i===0?'13:00:00':'20:00:00',capacity:2})),services:[{name:'Sơn gel',price_vnd:120000,description:'Chọn sắc màu yêu thích cho bộ móng của bạn.',is_sample:true},{name:'Chăm sóc móng',price_vnd:80000,description:'Làm gọn và chăm chút cho đôi bàn tay.',is_sample:true},{name:'Thiết kế móng',price_vnd:200000,description:'Giá thay đổi theo mẫu và phụ kiện.',is_sample:true}]};
}
export function makeBackend(config){
 const live=validConfig(config);const url=config.supabaseUrl?.replace(/\/$/,'');let socket,channel;
 const headers={apikey:config.publishableKey};if(config.publishableKey?.startsWith('eyJ'))headers.Authorization=`Bearer ${config.publishableKey}`;
 async function table(name,query){const res=await fetch(`${url}/rest/v1/${name}?${query}`,{headers,signal:AbortSignal.timeout(8000),cache:'no-store'});if(!res.ok)throw new ApiError('load_failed');const data=await res.json();if(!Array.isArray(data))throw new ApiError('load_failed');return data;}
 return{
  live,
  async snapshot(){if(!live)return demoData();const days=nextDays();const [availability,settings,hours,services]=await Promise.all([
   table('availability',`select=starts_at,local_date,local_time,capacity,reserved,remaining&local_date=gte.${days[0]}&local_date=lte.${days.at(-1)}&order=starts_at.asc`),
   table('shop_settings','select=name,address,contact_phone,announcement,cancel_before_hours&limit=1'),table('weekly_hours','select=weekday,opens,closes,capacity&order=weekday'),
   table('services','select=name,description,price_vnd,is_sample,sort_order&order=sort_order.asc')]);
   if(settings.length!==1)throw new ApiError('load_failed');return{availability,settings:settings[0],hours,services};},
  async mutate(body){if(!live)throw new ApiError('preview_only');let res,data;try{res=await fetch(`${url}/functions/v1/customer-api`,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey},body:JSON.stringify(body),signal:AbortSignal.timeout(9000),cache:'no-store'});data=await res.json();}catch{throw new ApiError('connection_uncertain',true);}
   if(!res.ok||data.ok!==true){throw new ApiError(data.error??'server_error',res.status>=500);}
   const bookings=body.action==='lookup'?data.bookings:[data.booking];
   if(!Array.isArray(bookings)||bookings.some(b=>!b||typeof b.id!=='string'||b.phone!==normalizePhone(body.phone)||!['confirmed','cancelled'].includes(b.status)||!Number.isFinite(Date.parse(b.starts_at))))throw new ApiError('connection_uncertain',true);
   return data;
  },
  async connect(onChange,onStatus){if(!live){onStatus('preview');return;}try{
   const {RealtimeClient}=await import('@supabase/realtime-js');
   socket=new RealtimeClient(`${url}/realtime/v1`,{params:{apikey:config.publishableKey},heartbeatIntervalMs:30000});
   channel=socket.channel('public-availability');channel.on('postgres_changes',{event:'*',schema:'public',table:'availability'},onChange).subscribe(status=>onStatus(status));
  }catch{onStatus('CHANNEL_ERROR');}},
  disconnect(){if(channel&&socket)socket.removeChannel(channel);socket?.disconnect();channel=null;socket=null;}
 };
}
