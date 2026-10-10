// Explicit owner-requested crop of phone screenshots, then WebP variants.
// Usage: node tools/prepare-web-images.mjs PATH_TO_SCREENSHOTS
// Inputs: mau-1.png/jpg/jpeg .. mau-4.png/jpg/jpeg (same order as gallery.js).
import sharp from 'sharp';
import {mkdir,readdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
const input=process.argv[2];
if(!input)throw Error('Dùng: node tools/prepare-web-images.mjs THU_MUC_CHUA_4_ANH');
const files=await readdir(input);
const allSpecs=[{name:'mau-1',top:195,bottom:1430,right:1152},{name:'mau-2',top:216,bottom:1430,right:1152},{name:'mau-3',top:318,bottom:1430,right:1152},{name:'mau-4',top:394,bottom:1392,right:1080}];
// Optional subset lets the owner supply photos in separate batches.
const names=process.argv[3]?.split(',')??allSpecs.map(s=>s.name);
if(!names.length||names.some(n=>!allSpecs.some(s=>s.name===n)))throw Error('Chỉ nhận tên mau-1,mau-2,mau-3,mau-4');
const specs=allSpecs.filter(s=>names.includes(s.name));
// Validate every requested source before changing output.
for(const spec of specs){
 const file=files.find(f=>new RegExp(`^${spec.name}\\.(png|jpe?g)$`,'i').test(f));
 if(!file)throw Error(`Thiếu ảnh thật ${spec.name}.png/jpg. Không dùng ảnh thay thế.`);
 spec.source=path.join(input,file);
 const meta=await sharp(spec.source).metadata();
 if(!meta.width||!meta.height)throw Error(`Không đọc được ảnh ${file}`);
 const scale=meta.width/1152;
 spec.crop={left:0,top:Math.round(spec.top*scale),width:Math.round(spec.right*scale),height:Math.round((spec.bottom-spec.top)*scale)};
 if(spec.crop.top+spec.crop.height>meta.height)throw Error(`Ảnh ${file} không đủ chiều cao cho vùng cắt; kiểm tra ảnh nguồn.`);
}
const output=new URL('../web/public/images/',import.meta.url);
const staging=new URL('../web/public/images-staging/',import.meta.url);
await mkdir(staging,{recursive:true});
const manifest=JSON.parse(await readFile(new URL('../web/src/gallery-images.json',import.meta.url),'utf8'));
try{
 for(const spec of specs){
  const cropped=await sharp(spec.source).extract(spec.crop).toBuffer();
  manifest[spec.name]={width:spec.crop.width,height:spec.crop.height};
  for(const width of [480,800,1200])await sharp(cropped).resize({width}).webp({quality:82,effort:5}).toFile(new URL(`${spec.name}-${width}.webp`,staging).pathname);
  if(spec.name==='mau-1')await sharp(cropped).resize({width:1200,height:630,fit:'cover'}).jpeg({quality:86,mozjpeg:true}).toFile(new URL('og.jpg',staging).pathname);
 }
 await mkdir(output,{recursive:true});
 for(const file of await readdir(staging))await rename(new URL(file,staging),new URL(file,output));
 await writeFile(new URL('../web/src/gallery-images.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
 console.log(`Đã xuất ${specs.length*3} ảnh WebP${names.includes('mau-1')?', og.jpg':''} và cập nhật kích thước ảnh.`);
}finally{await rm(staging,{recursive:true,force:true});}
