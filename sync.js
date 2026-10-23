/* 一一钱罐 — 腾讯云开发 CloudBase 云同步
 * 本地 localStorage 仍是主存储（离线优先）；云端集合 ledger 里只有一条文档 family，存整本账。
 * 任何网络/云端错误都只影响同步状态显示，不会挡住孩子用 App。 */
(function () {
  var ENV = 'yiyi-d3gyvvdig0f40d02f', REGION = 'ap-shanghai', COLL = 'ledger', DOC = 'family';
  var SDK = 'vendor/cloudbase.js?v=5', APPV = 'v5';
  var H = window.__pmSyncHost, PM = window.PM;
  if (!H || !PM) return;

  var devId = '';
  try { devId = localStorage.getItem('pm-device') || ''; } catch (e) {}
  if (!devId) { devId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); try { localStorage.setItem('pm-device', devId); } catch (e) {} }

  var st = { state: 'idle', env: ENV, connected: false, live: false, reason: '', last: 0 };
  try { st.last = +localStorage.getItem('pm-sync-last') || 0; } catch (e) {}
  function set(p) { for (var k in p) st[k] = p[k]; try { H.status(st); } catch (e) {} }

  var app = null, db = null, ready = null, watcher = null, busy = false, again = false;
  var timer = null, retryT = null, fails = 0, lastPushed = 0, lastPushAt = 0;

  function loadSdk() {
    if (window.cloudbase) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = SDK; s.async = true;
      s.onload = function () { window.cloudbase ? res() : rej(new Error('SDK 加载失败')); };
      s.onerror = function () { rej(new Error('SDK 加载失败（网络不通？）')); };
      document.head.appendChild(s);
    });
  }
  function timeout(p, ms, msg) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(msg || '超时')); }, ms); })]); }
  function authErr(e) { var x = new Error((e && (e.message || e.msg)) || '登录失败'); x.code = e && (e.status || e.code); x.raw = e; return x; }

  function ensure() {
    if (ready) return ready;
    ready = timeout(loadSdk().then(function () {
      app = app || window.cloudbase.init({ env: ENV, region: REGION });
      var auth = typeof app.auth === 'function' ? app.auth({ persistence: 'local' }) : app.auth;
      return Promise.resolve(auth.hasLoginState ? auth.hasLoginState() : null).then(function (has) {
        if (has) return;
        return Promise.resolve(auth.signInAnonymously()).then(function (r) { if (r && r.error) throw authErr(r.error); });
      }).then(function () { db = app.database(); set({ connected: true }); });
    }), 20000, '连接云端超时').catch(function (e) { ready = null; set({ connected: false }); throw e; });
    return ready;
  }
  function doc() { return db.collection(COLL).doc(DOC); }
  function chk(r) { if (r && r.code && !r.data && r.code !== 'SUCCESS') throw r; return r; }

  function describe(e) {
    var code = String((e && (e.code || e.errCode || (e.raw && e.raw.status))) || ''), msg = String((e && (e.message || e.msg || e.errMsg)) || e || '');
    var all = code + ' ' + msg, t;
    if (!navigator.onLine || /Failed to fetch|NetworkError|network|网络不通|ERR_INTERNET|timeout|超时/i.test(all)) return { offline: true, text: '网络不通，稍后自动重试' };
    if (/4045|login_type_disabled|匿名登录/.test(all)) t = '匿名登录没有开启（控制台 → 身份认证 → 登录方式 → 匿名登录）';
    else if (/cors|domain|安全域名|安全来源|INVALID_ORIGIN|origin/i.test(all)) t = '当前网址不在安全域名里（控制台 → 环境配置 → 安全来源）';
    else if (/COLLECTION_NOT_EXIST|collection.*not.*exist|集合.*不存在/i.test(all)) t = '还没有创建集合 ledger（控制台 → 文档型数据库 → 新建集合）';
    else if (/PERMISSION|permission|权限/i.test(all)) t = '没有读写权限：集合 ledger 需要设置安全规则 auth != null';
    else t = '未知错误';
    return { offline: false, text: t + (code || msg ? '（' + (code ? code + ' ' : '') + msg.slice(0, 80) + '）' : '') };
  }

  function syncNow(manual) {
    if (!navigator.onLine) { set({ state: 'off', reason: '设备没有联网' }); return Promise.resolve(false); }
    if (busy) { again = true; return Promise.resolve(false); }
    busy = true; clearTimeout(retryT); set({ state: 'busy' });
    return ensure().then(function () { return doc().get(); }).then(chk).then(function (res) {
      var remote = res && res.data && res.data[0];
      if (remote && remote.data) H.merge(remote.data);
      var local = PM.syncPart(H.get());
      if (remote && remote.data && PM.stable(PM.syncPart(remote.data)) === PM.stable(local)) return;
      var now = Date.now(); lastPushed = now; lastPushAt = now;
      return doc().set({ data: local, updatedAt: now, deviceId: devId, appv: APPV }).then(chk);
    }).then(function () {
      fails = 0; var now = Date.now(); try { localStorage.setItem('pm-sync-last', String(now)); } catch (e) {}
      set({ state: 'ok', reason: '', last: now }); startWatch(); return true;
    }).catch(function (e) {
      fails++; var d = describe(e);
      try { console.warn('[sync]', e); } catch (x) {}
      set({ state: d.offline ? 'off' : 'err', reason: d.text }); retry(); return false;
    }).then(function (ok) { busy = false; if (again) { again = false; schedule(300); } return ok; });
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { syncNow(); }, ms == null ? 1500 : ms); }
  function retry() { clearTimeout(retryT); var d = [5, 15, 60, 120, 300][Math.min(fails - 1, 4)] * 1000; retryT = setTimeout(function () { syncNow(); }, d); }

  function startWatch() {
    if (watcher || !db || typeof doc().watch !== 'function') return;
    try {
      watcher = doc().watch({
        onChange: function (snap) {
          set({ live: true });
          var d = snap && snap.docs && snap.docs[0];
          if (!d || !d.data) return;
          if (d.deviceId === devId && d.updatedAt === lastPushed) return; // 自己刚写的回声
          H.merge(d.data);
          if (PM.stable(PM.syncPart(d.data)) !== PM.stable(PM.syncPart(H.get()))) schedule(Math.max(1500, 3000 - (Date.now() - lastPushAt)));
          else { var now = Date.now(); try { localStorage.setItem('pm-sync-last', String(now)); } catch (e) {} set({ state: 'ok', reason: '', last: now }); }
        },
        onError: function (err) { try { console.warn('[sync] watch', err); } catch (x) {} try { watcher && watcher.close && watcher.close(); } catch (x) {} watcher = null; set({ live: false }); }
      });
    } catch (e) { watcher = null; set({ live: false }); }
  }

  // 后备：回到前台 / 联网 / 定时刷新（实时监听失效时也能更新）
  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(200); });
  window.addEventListener('focus', function () { schedule(200); });
  window.addEventListener('online', function () { schedule(200); });
  window.addEventListener('offline', function () { set({ state: 'off', reason: '设备没有联网' }); });
  setInterval(function () { if (!document.hidden && !st.live) syncNow(); }, 60000);

  window.__sync = { changed: function () { schedule(1500); }, syncNow: syncNow, status: function () { return st; }, deviceId: devId };
  set({});
  setTimeout(function () { syncNow(); }, 800);
})();
