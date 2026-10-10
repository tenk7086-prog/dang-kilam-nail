import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
const config=JSON.parse(readFileSync(new URL('./web/public/site-config.json',import.meta.url),'utf8'));
const hasPhotos=existsSync(new URL('./web/public/images/og.jpg',import.meta.url));
const site=config.siteUrl?.replace(/\/$/,'')??'';
if(site && !/^https:\/\/[^\s<>"']+$/.test(site)) throw Error('siteUrl phải là địa chỉ HTTPS hợp lệ.');
const description='Hanhnail tại 181 Khương Thượng, Phường Kim Liên, Hà Nội. Khám phá mẫu nail, bảng giá và chọn lịch hẹn phù hợp với bạn.';
export default defineConfig({
 root:'web',base:'./',build:{outDir:'../dist',emptyOutDir:true,target:'es2022',assetsInlineLimit:0,rollupOptions:{input:{index:resolve('web/index.html'),admin:resolve('web/admin.html')}}},
 plugins:[{name:'nail-seo',transformIndexHtml(html){
   const ld={'@context':'https://schema.org','@type':'NailSalon',name:'Hanhnail',description,
     address:{'@type':'PostalAddress',streetAddress:'Số 181 Khương Thượng, Phường Kim Liên',addressLocality:'Hà Nội',addressCountry:'VN'},
     ...(site?{url:site,...(hasPhotos?{image:site+'/images/og.jpg'}:{})}:{})};
   return html.replace('<!-- SITE_SEO -->',`${site?`<link rel="canonical" href="${site}/"><meta property="og:url" content="${site}/">${hasPhotos?`<meta property="og:image" content="${site}/images/og.jpg">`:""}<meta name="twitter:card" content="summary_large_image">`:'<meta name="robots" content="noindex,nofollow">'}<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
 }}],
});
