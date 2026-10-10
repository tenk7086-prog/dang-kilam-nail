// Chạy trên máy chủ tiệm. Không tải khoá Google lên chat/GitHub.
import { readFile,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const [keyPath,calendarId,origin]=process.argv.slice(2);
try {
  if(!keyPath || !calendarId || !origin) throw Error('Cách dùng: node tools/make-secrets.mjs "DUONG_DAN_KEY_JSON" "CALENDAR_ID" "https://TEN_WEB"');
  const parsedOrigin=new URL(origin);
  if(parsedOrigin.origin!==origin || !['http:','https:'].includes(parsedOrigin.protocol) ||
      (parsedOrigin.protocol==='http:' && !['localhost','127.0.0.1'].includes(parsedOrigin.hostname)))
    throw Error('Origin phải là https://ten-web, không có đường dẫn hoặc dấu / cuối; localhost được dùng HTTP.');
  if(/[\r\n]/.test(calendarId) || calendarId.length>300) throw Error('Calendar ID không hợp lệ.');
  const account=JSON.parse(await readFile(keyPath,'utf8'));
  if(account.type!=='service_account' || !account.client_email || !account.private_key) throw Error('File không phải khoá service account.');
  const env=[`ALLOWED_ORIGINS=${origin}`,`GOOGLE_CALENDAR_ID=${calendarId}`,
    `GOOGLE_SERVICE_ACCOUNT_JSON=${JSON.stringify({type:account.type,client_email:account.client_email,private_key:account.private_key})}`,
    `CALENDAR_WORKER_TOKEN=${randomBytes(32).toString('hex')}`,'TRUSTED_CLIENT_IP_HEADER=',
    `IP_HASH_SECRET=${randomBytes(32).toString('hex')}`,''].join('\n');
  await writeFile(new URL('../supabase/functions/.env',import.meta.url),env,{flag:'wx',mode:0o600});
  console.log('Đã tạo supabase/functions/.env. File chứa bí mật: chỉ dùng để nạp Secrets, không gửi cho người khác.');
  console.log('Mở file này trên máy bạn để chép CALENDAR_WORKER_TOKEN vào Vault. Không đưa lên GitHub.');
} catch(error) {
  console.error(error.code==='EEXIST'?'File .env đã tồn tại; không ghi đè hoặc đổi token đang dùng.':
    error.code==='ENOENT'?'Không tìm thấy file khoá Google. Kiểm tra đường dẫn.':
    error instanceof SyntaxError?'File JSON khoá Google không hợp lệ.':error.message);
  process.exitCode=1;
}
