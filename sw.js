// 一一钱罐 Service Worker（v8：手机适配；逻辑同 v7）：应用外壳“缓存优先”。
// 新地址是云开发默认域名：浏览器直接打开页面时可能先出现腾讯的「访问提示中间页」，
// 其它请求会被加上 Content-Disposition: attachment。所以：
//  - 安装时把所有文件拉下来，去掉 attachment 头，并确认 index.html 真的是钱罐（不是提示页）才缓存；
//  - 之后打开页面一律用缓存里的外壳，不再经过提示页；
//  - 更新：sw.js 有变化时浏览器会装新版本（新缓存装好才替换），页面随后自动刷新。
var V='pm-v8',SHELL='index.html',MARK='name="pm-app"';
var FILES=['index.html','logic.js','sync.js','vendor/cloudbase.js','manifest.json','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'];
function clean(r){var h=new Headers(r.headers);h.delete('content-disposition');
  return r.blob().then(function(b){return new Response(b,{status:200,statusText:'OK',headers:h})})}
function grab(f){return fetch(new Request(f,{cache:'reload',credentials:'same-origin'})).then(function(r){
  if(!r||!r.ok)throw new Error('fetch '+f+' '+(r&&r.status));
  if(f!==SHELL)return clean(r);
  return r.clone().text().then(function(t){if(t.indexOf(MARK)<0)throw new Error('index.html 不是钱罐（可能是提示页）');return clean(r)})})}
self.addEventListener('install',function(e){e.waitUntil(caches.open('pm-tmp-'+V).then(function(tmp){
  return Promise.all(FILES.map(function(f){return grab(f).then(function(r){return tmp.put(f,r)})}))})
  .then(function(){return Promise.all([caches.open(V),caches.open('pm-tmp-'+V)])})
  .then(function(cs){return cs[1].keys().then(function(ks){return Promise.all(ks.map(function(k){return cs[1].match(k).then(function(r){return cs[0].put(k,r)})}))})})
  .then(function(){return caches.delete('pm-tmp-'+V)}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){var req=e.request;if(req.method!=='GET')return;
  var u=new URL(req.url);if(u.origin!==self.location.origin)return; // 云开发接口等跨域请求不处理
  if(req.mode==='navigate'){ // 打开页面：直接给缓存的外壳（地址栏里的 ?参数 和 #import 保持不变）
    e.respondWith(caches.open(V).then(function(c){return c.match(SHELL)}).then(function(r){return r||fetch(req)}));return}
  e.respondWith(caches.open(V).then(function(c){return c.match(req,{ignoreSearch:true})}).then(function(r){
    return r||fetch(req).then(function(n){return n&&n.ok?clean(n):n})}))});
