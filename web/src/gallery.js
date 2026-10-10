import manifest from './gallery-images.json';
export const gallery = [
 {file:'mau-1',name:'Cat-eye xanh đêm',description:'Ánh sao lấp lánh',alt:'Móng xanh navy cat-eye gắn charm sao'},
 {file:'mau-2',name:'Jelly trong',description:'Đá pha lê',alt:'Móng trong gắn đá pha lê và viền bạc'},
 {file:'mau-3',name:'Pearl shell',description:'Vỏ sò ngọc trai',alt:'Móng nude hồng vỏ sò 3D, ngọc trai và sao biển vàng'},
 {file:'mau-4',name:'Ocean shell',description:'Xanh biển dịu',alt:'Móng xanh pastel vỏ sò 3D'},
].map(item=>({...item,...manifest[item.file],ready:!!manifest[item.file]}));
