import { AppError,json,secureEqual,safeCode } from './http.js';
import { synchronize } from './google.js';
export function workerHandler({rpc,client,workerToken,maxJobs=20,budgetMs=45000}) {
  return async request => {
    if(request.method!=='POST') return json({ok:false,error:'method_not_allowed'},405,{Allow:'POST'});
    if(!workerToken || !/^[0-9a-f]{64}$/.test(workerToken)) return json({ok:false,error:'server_not_configured'},503);
    const actual=request.headers.get('authorization')??'';
    if(actual.length>200 || !await secureEqual(actual,`Bearer ${workerToken}`))
      return json({ok:false,error:'unauthorized'},401);
    const started=Date.now();let completed=0,failed=0,stale=0;
    // Không đọc body hoặc nhận ID khách từ caller; worker chỉ lấy hàng đợi server.
    try {
      while(completed+failed+stale<maxJobs && Date.now()-started<budgetMs) {
        const job=await rpc('calendar_claim');if(!job) break;
        const args={p_id:job.booking_id,p_token:job.lease_token,p_version:job.version};
        try {
          await synchronize(job,client,()=>rpc('calendar_check_lease',args));
          const accepted=await rpc('calendar_finish',{...args,p_success:true,p_error_code:null});
          if(accepted) completed++;else stale++;
        } catch(error) {
          const code=safeCode(error);
          const accepted=await rpc('calendar_finish',{...args,p_success:false,p_error_code:code});
          if(code==='lease_stale' || !accepted) stale++;else failed++;
          console.error(JSON.stringify({component:'calendar-worker',code}));
          // Lỗi cấu hình/quyền/quota không thử toàn bộ hàng đợi trong cùng lần chạy.
          if(['google_auth_failed','google_credentials_invalid','google_http_401','google_http_403','google_http_429'].includes(code)) break;
        }
      }
      return json({ok:true,completed,failed,stale,elapsed_ms:Date.now()-started});
    } catch(error) {
      console.error(JSON.stringify({component:'calendar-worker',code:safeCode(error)}));
      // Lease chưa ACK sẽ hết hạn, tác vụ được claim lại; không xoá job.
      return json({ok:false,error:safeCode(error),completed,failed,stale},error instanceof AppError?error.status:500);
    }
  };
}
