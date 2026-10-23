/* 零花钱 — 解析与定时零花钱逻辑（浏览器和 Node 共用） */
(function (root) {
  var DIG = { '零': 0, '〇': 0, '一': 1, '幺': 1, '二': 2, '两': 2, '俩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var UNIT = { '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000 };
  var NUM = '(?:[0-9]+(?:\\.[0-9]+)?|[零〇一幺二两俩三四五六七八九十拾百佰千]+(?:点[零〇一二三四五六七八九]+)?)';

  function cnInt(s) {
    if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
    var total = 0, cur = 0, seen = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c in DIG) { cur = DIG[c]; seen = true; }
      else if (c in UNIT) { total += (cur || (UNIT[c] === 10 && !seen ? 1 : cur || 1)) * UNIT[c]; cur = 0; seen = true; }
      else return NaN;
    }
    // 处理 "一百五" = 150, "两千三" = 2300
    var last = s[s.length - 1], prev = s[s.length - 2];
    if (s.length >= 2 && (last in DIG) && (prev in UNIT) && UNIT[prev] >= 100) return total + cur * UNIT[prev] / 10;
    return total + cur;
  }
  function toNum(s) {
    if (s == null || s === '') return NaN;
    if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return parseFloat(s);
    var p = s.split('点');
    var n = cnInt(p[0] || '零');
    if (p[1]) { var d = ''; for (var i = 0; i < p[1].length; i++) d += DIG[p[1][i]]; n = parseFloat(n + '.' + d); }
    return n;
  }

  function normalize(t) {
    return String(t || '')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
      .replace(/[．。]/g, function (c, i, s) { return /[0-9]/.test(s[i - 1] || '') && /[0-9]/.test(s[i + 1] || '') ? '.' : '。'; })
      .replace(/[\s,，、!！?？~～“”"']/g, '')
      .replace(/¥|￥/g, '')
      .replace(/人民币/g, '');
  }

  // 找出所有金额片段：返回 [{start,end,cents,strong}]
  function findAmounts(t) {
    var out = [], m;
    var re1 = new RegExp('(' + NUM + ')(块|元|圆|快)(?:钱)?(?:(' + NUM + ')(毛|角)?)?(?:(' + NUM + ')分)?', 'g');
    while ((m = re1.exec(t))) {
      var y = toNum(m[1]); if (isNaN(y)) continue;
      var j = m[3] ? toNum(m[3]) : 0; if (isNaN(j)) j = 0;
      if (m[3] && !m[4] && j >= 10) { // "5块10" 之类，不当角
        re1.lastIndex = m.index + m[1].length + m[2].length; j = 0;
      }
      var f = m[5] ? toNum(m[5]) : 0;
      var cents = Math.round(y * 100 + j * 10 + (f || 0));
      var after = t[m.index + m[0].length] || '';
      out.push({ start: m.index, end: m.index + m[0].length, cents: cents, strong: /元|钱/.test(m[0]) || /[.点]/.test(m[1]) || !!m[3], pieceLike: !m[3] && /^[一两二三四五六七八九十0-9]$/.test(m[1]) && /[蛋糕巧克力糖饼面包肉布橡皮]/.test(after) });
    }
    var re2 = new RegExp('(' + NUM + ')(毛|角)(?:钱)?(?:(' + NUM + ')分?)?', 'g');
    while ((m = re2.exec(t))) {
      if (out.some(function (a) { return m.index >= a.start && m.index < a.end; })) continue;
      var v = toNum(m[1]); if (isNaN(v)) continue;
      var ff = m[3] ? toNum(m[3]) : 0;
      out.push({ start: m.index, end: m.index + m[0].length, cents: Math.round(v * 10 + (ff || 0)), strong: true });
    }
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  var VERB = /(花了|花掉|花|用了|用掉|付了|付|给了我|给我|收到了?|奖励了?我?|压岁钱|赚了|挣了|得到了?|是|共|一共|总共|要)$/;
  var INCOME = /(给了?我.{0,3}?(?:[0-9零一二两三四五六七八九十百]|钱)|收到|奖励|压岁钱|赚了|挣了|得到|捡到|发了?零花钱|发我|红包)/;
  var SPEND = /(买|花|用了|付了|交了|吃了)/;

  function guessEmoji(item) {
    var map = [[/冰淇淋|雪糕|冰棍|冰激凌/, '🍦'], [/糖|棒棒糖|巧克力/, '🍬'], [/贴纸|贴画/, '⭐'], [/书|绘本|本子|笔|橡皮|文具/, '📚'],
      [/玩具|娃娃|积木|乐高|公仔|盲盒|球/, '🧸'], [/面包|蛋糕|饼干|零食|薯片/, '🍪'], [/水|饮料|奶|果汁|可乐/, '🧃'], [/水果|苹果|香蕉|草莓|西瓜/, '🍓'],
      [/压岁钱|红包/, '🧧'], [/奖励/, '🏅'], [/零花钱/, '💰'], [/给的/, '💝'], [/发卡|头绳|发夹/, '🎀'], [/气球/, '🎈']];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(item)) return map[i][1];
    return '🛍️';
  }

  function cleanItem(s) {
    s = s.replace(/^(我|今天|昨天|刚才|刚刚|早上|中午|下午|晚上|在|去|超市|商店|小卖部|里|了|就|又|还|也|和妈妈|和爸爸|跟妈妈|跟爸爸)+/g, '');
    s = s.replace(/^(买了|买|吃了|买的是)/, '');
    s = s.replace(/^个/, '').replace(/^([0-9]+|[一两二三四五六七八九十几]+)(个|根|支|包|袋|张|瓶|盒|本|块|颗|只|杯|份|条|件|套|把|朵|串|罐|副)/, '');
    s = s.replace(/(花了|花掉|花|用了|付了|一共|总共|共|是|的钱|钱|了|，|。|的)+$/g, '');
    s = s.replace(/[。.]+/g, '');
    return s.slice(0, 12);
  }

  function parseSpeech(raw) {
    var t = normalize(raw);
    if (!t) return null;
    var list = findAmounts(t);
    var pick = null;
    if (list.length) {
      // 优先：紧跟在“花了/给我/收到”等动词后面的金额
      var near = list.filter(function (a) { return VERB.test(t.slice(Math.max(0, a.start - 4), a.start)); });
      var cand = near.length ? near : list.filter(function (a) { return !a.pieceLike; });
      if (!cand.length) cand = list;
      var strong = cand.filter(function (a) { return a.strong; });
      pick = (strong.length ? strong : cand)[(strong.length ? strong : cand).length - 1];
    } else {
      // 没有单位：取动词后的数字，或句子里唯一的阿拉伯数字
      var m = new RegExp('(花了|花掉|用了|付了|给了我|给我|收到|奖励)(' + NUM + ')').exec(t)
        || new RegExp('(' + '[0-9]+(?:\\.[0-9]+)?' + ')(?!.*[0-9])').exec(t);
      if (m) { var numStr = m[2] || m[1]; var v = toNum(numStr); if (!isNaN(v)) { var st = m.index + (m[2] ? m[1].length : 0); pick = { start: st, end: st + numStr.length, cents: Math.round(v * 100) }; } }
    }
    if (!pick || !(pick.cents > 0) || pick.cents > 10000000) return null;

    var income = INCOME.test(t) && !/给我买|帮我买/.test(t.slice(0, pick.start + 1).replace(/给了?我.{0,3}?[0-9零一二两三四五六七八九十百].*/, ''));
    if (INCOME.test(t) && /给我买|帮我买/.test(t)) income = false;
    if (!INCOME.test(t)) income = false;

    var item = '';
    if (income) {
      if (/压岁钱/.test(t)) item = '压岁钱';
      else if (/红包/.test(t)) item = '红包';
      else if (/奖励/.test(t)) { var r = /奖励(?:了?我)?(?:.{0,6}?)(?:因为|帮)?(.*)$/.exec(t.slice(pick.end)); item = '奖励'; }
      else {
        var g = /([^我了的,，]{1,4}?)给了?我/.exec(t);
        if (g && cleanItem(g[1])) item = cleanItem(g[1]) + '给的';
        else if (/零花钱/.test(t)) item = '零花钱';
        else item = '收到的钱';
      }
    } else {
      var before = t.slice(0, pick.start), after = t.slice(pick.end);
      var b = /买了?(.+)$/.exec(before);
      if (b) item = cleanItem(b[1]);
      if (!item) { var a2 = /^(?:钱)?(?:了)?(?:买了?|吃了|的)(.+)$/.exec(after); if (a2) item = cleanItem(a2[1]); }
      if (!item) item = cleanItem(before);
      if (!item) item = '买东西';
    }
    return { type: income ? 'in' : 'out', item: item, cents: pick.cents, emoji: guessEmoji(item), text: raw };
  }

  /* ---------- 每周定时零花钱 ---------- */
  // cfg: {enabled, cents, weekday(0=周日..6), time:'HH:MM', lastPayoutTs}
  function occurrenceOnDay(d, time) {
    var hm = (time || '08:00').split(':');
    var o = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +hm[0] || 0, +hm[1] || 0, 0, 0);
    return o;
  }
  function duePayouts(cfg, nowTs) {
    if (!cfg || !cfg.enabled || !(cfg.cents > 0) || cfg.lastPayoutTs == null) return [];
    var res = [], last = cfg.lastPayoutTs;
    var d = new Date(last); d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    // 前进到第一个对应星期几
    while (d.getDay() !== +cfg.weekday) d.setDate(d.getDate() + 1);
    for (var guard = 0; guard < 260; guard++) {
      var o = occurrenceOnDay(d, cfg.time).getTime();
      if (o > nowTs) break;
      if (o > last) res.push(o);
      d.setDate(d.getDate() + 7);
    }
    return res;
  }
  function payoutKey(ts) { var d = new Date(ts); return 'allow-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  // 在 data 上执行补发，返回新增条目数组（不会重复）
  function applyAllowance(data, nowTs) {
    var cfg = data.allowance; var added = [];
    var due = duePayouts(cfg, nowTs);
    due.forEach(function (ts) {
      var key = payoutKey(ts);
      if (data.entries.some(function (e) { return e.key === key; })) return;
      if (data.deleted && data.deleted[key]) return; // 家长删过这一周的零花钱：不再补发
      // id 固定为发放日 key：两台设备同时补发也只会得到同一个 id，同步合并后不会重复
      var e = { id: key, key: key, ts: ts, mt: nowTs, type: 'in', item: '每周零花钱', cents: cfg.cents, emoji: '💰', auto: true };
      data.entries.push(e); added.push(e);
    });
    if (due.length) cfg.lastPayoutTs = due[due.length - 1];
    return added;
  }

  /* ---------- 存钱目标 ---------- */
  // goal: {item, cents, emoji} 或 null；返回 null（无目标）或 {pct(0-100), remain(分), reached}
  function goalProgress(balCents, goal) {
    if (!goal || !(goal.cents > 0)) return null;
    var b = Math.max(0, balCents || 0);
    var pct = Math.min(100, Math.floor(b * 100 / goal.cents));
    var remain = Math.max(0, goal.cents - b);
    return { pct: remain === 0 ? 100 : Math.min(pct, 99), remain: remain, reached: remain === 0 };
  }

  /* ---------- 家长解锁有效期 ---------- */
  var UNLOCK_MS = 5 * 60 * 1000;
  function isUnlocked(unlockedAt, nowTs, windowMs) {
    if (!unlockedAt) return false;
    var w = windowMs == null ? UNLOCK_MS : windowMs;
    var age = nowTs - unlockedAt;
    return age >= 0 && age < w;
  }

  /* ---------- 云同步：合并逻辑（纯函数，可测试） ---------- */
  var SETTINGS = ['startCents', 'pin', 'allowance', 'goal'];
  function stable(v) { // 稳定 JSON（键排序），用于比较
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function emt(e) { return e.mt || e.ts || 0; }
  // 只取需要同步的部分
  function syncPart(d) {
    var out = { v: 1, entries: (d.entries || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }), deleted: d.deleted || {}, meta: d.meta || {} };
    SETTINGS.forEach(function (k) { out[k] = d[k] === undefined ? null : d[k]; });
    return clone(out);
  }
  function sameSync(a, b) { return stable(syncPart(a)) === stable(syncPart(b)); }
  function pickNewer(a, b) { // 条目冲突：改得晚的赢；一样晚就按内容排序，保证两边结果一致
    var ta = emt(a), tb = emt(b);
    if (ta !== tb) return ta > tb ? a : b;
    return stable(a) >= stable(b) ? a : b;
  }
  // local, remote: 完整 data（remote 可为 syncPart）；返回新的合并结果，不修改入参
  function mergeData(local, remote) {
    var out = clone(local);
    if (!remote) return out;
    remote = clone(remote);
    out.meta = out.meta || {}; out.deleted = out.deleted || {};
    var rmeta = remote.meta || {}, rdel = remote.deleted || {};
    // 1) 删除记录：并集，取较晚时间
    Object.keys(rdel).forEach(function (k) { out.deleted[k] = Math.max(out.deleted[k] || 0, rdel[k] || 0); });
    // 2) 账目：按 id 并集，冲突取较新
    var map = {};
    (out.entries || []).forEach(function (e) { map[e.id] = e; });
    (remote.entries || []).forEach(function (e) { map[e.id] = map[e.id] ? pickNewer(map[e.id], e) : e; });
    // 3) 删除优先：id 或发放日 key 被删的都去掉（删除不会被另一台设备“复活”）
    var list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (e) { return !out.deleted[e.id] && !(e.key && out.deleted[e.key]); });
    // 4) 每周零花钱按发放日去重：同一 key 只留 id 最小的一笔，其余记为删除
    var byKey = {};
    list.forEach(function (e) { if (!e.key) return; if (!byKey[e.key] || e.id < byKey[e.key].id) byKey[e.key] = e; });
    var now = Date.now();
    out.entries = list.filter(function (e) {
      if (e.key && byKey[e.key] !== e) { out.deleted[e.id] = Math.max(out.deleted[e.id] || 0, emt(e) || now); return false; }
      return true;
    }).sort(function (a, b) { return a.ts - b.ts; });
    // 5) 设置：各自按 updatedAt 后写赢
    SETTINGS.forEach(function (k) {
      var lt = out.meta[k] || 0, rt = rmeta[k] || 0;
      var useRemote = rt > lt || (rt === lt && stable(remote[k]) > stable(out[k]) && remote[k] !== undefined);
      if (useRemote) out[k] = remote[k] === undefined ? null : remote[k];
      out.meta[k] = Math.max(lt, rt);
    });
    // 6) 零花钱“上次发放时间”取两边较晚的，避免一台设备回退后重复补发
    var la = local.allowance, ra = remote.allowance;
    if (out.allowance && la && ra && la.lastPayoutTs != null && ra.lastPayoutTs != null)
      out.allowance.lastPayoutTs = Math.max(la.lastPayoutTs, ra.lastPayoutTs);
    return out;
  }
  // 给旧数据补上同步需要的字段（不改变已有字段）
  function prepSync(d, existed) {
    d.meta = d.meta || {}; d.deleted = d.deleted || {};
    SETTINGS.forEach(function (k) { if (d.meta[k] == null) d.meta[k] = existed ? 1 : 0; });
    (d.entries || []).forEach(function (e) { if (e.mt == null) e.mt = e.ts || 1; });
    return d;
  }


  // ---- 搬家：把整本账编码进链接 #import=1.<base64url(UTF-8 JSON)> ----
  function b64e(str) { var u = unescape(encodeURIComponent(str)); return btoa(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(b) { b = String(b).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return decodeURIComponent(escape(atob(b))); }
  function encodeMove(d) { var p = syncPart(d); p.from = 'move'; return '1.' + b64e(JSON.stringify(p)); }
  // 接受：完整链接、#import=…、1.xxx 编码、或备份 JSON 文本；不对就返回 null
  function decodeMove(txt) {
    if (txt == null) return null; txt = String(txt).trim();
    var m = txt.match(/[#&?]import=([^&#\s]+)/); if (m) txt = decodeURIComponent(m[1]);
    var d = null;
    try { if (/^1\.[A-Za-z0-9_-]+$/.test(txt)) d = JSON.parse(b64d(txt.slice(2))); else if (txt.charAt(0) === '{') d = JSON.parse(txt); } catch (e) { return null; }
    if (!d || typeof d !== 'object' || !Array.isArray(d.entries)) return null;
    if (d.entries.some(function (e) { return !e || typeof e.id !== 'string' || !(e.cents > 0) || (e.type !== 'in' && e.type !== 'out'); })) return null;
    return d;
  }
  // 合并（不是覆盖）：旧数据里没有的字段按“旧数据”补齐，再走正常同步合并
  function importMerge(local, imported) {
    var d = clone(imported); delete d.from; delete d.v;
    d = prepSync(d, true);
    return mergeData(local, d);
  }

  var api = { encodeMove: encodeMove, decodeMove: decodeMove, importMerge: importMerge, stable: stable, syncPart: syncPart, sameSync: sameSync, mergeData: mergeData, prepSync: prepSync, SETTINGS: SETTINGS, goalProgress: goalProgress, isUnlocked: isUnlocked, UNLOCK_MS: UNLOCK_MS, parseSpeech: parseSpeech, toNum: toNum, findAmounts: findAmounts, normalize: normalize, guessEmoji: guessEmoji, duePayouts: duePayouts, applyAllowance: applyAllowance, payoutKey: payoutKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PM = api;
})(this);
