import manifest from './gallery-images.json';
export const gallery = [
 {file:'mau-1',name:'Cat-eye xanh đêm',description:'Ánh sao lấp lánh',alt:'Móng xanh navy cat-eye gắn charm sao'},
 {file:'mau-2',name:'Jelly trong',description:'Đá pha lê',alt:'Móng trong gắn đá pha lê và viền bạc'},
 {file:'mau-3',name:'Đỏ rượu',description:'Nơ và viền vàng',alt:'Móng đỏ rượu bóng, đính nơ vàng'},
 {file:'mau-4',name:'Hồng hoa nổi',description:'Hoa hồng trong và nhụy vàng',alt:'Móng hồng trong đính hoa nổi với nhụy vàng'},
].map(item=>({...item,...manifest[item.file],ready:!!manifest[item.file]}));
