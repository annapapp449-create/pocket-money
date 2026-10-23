var V='pm-v3',FILES=['./','index.html','logic.js','manifest.json','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(V).then(function(c){return c.addAll(FILES.map(function(f){return new Request(f,{cache:'reload'})}))}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){if(e.request.method!=='GET')return;
  var same=new URL(e.request.url).origin===self.location.origin;
  // 网络优先（跳过 HTTP 缓存，拿到最新版），离线时用缓存
  var req=same?new Request(e.request.url,{cache:'no-cache',credentials:'same-origin'}):e.request;
  e.respondWith(fetch(req).then(function(r){if(r&&r.ok){var c=r.clone();caches.open(V).then(function(ca){ca.put(e.request,c)})}return r}).catch(function(){return caches.match(e.request,{ignoreSearch:true}).then(function(r){return r||caches.match('index.html')})}))});
