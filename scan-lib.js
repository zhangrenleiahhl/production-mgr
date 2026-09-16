/* ==========================================================================
   发货进度 · 公共库（扫码页 / 查看页 / 管理端 三处共用）
   --------------------------------------------------------------------------
   为什么必须共用一份：
   1. 「进度合并只增不减」是保命规则。现场好几个人同时扫同一张单，如果三个页面
      各写一份合并逻辑，早晚会漂移成两套行为 —— 表现就是"有时候进度会自己退回去"。
      这种 bug 极难复现，所以从源头只留一份实现。
   2. 二维码里放什么地址，也必须三端一致，否则会出现"有的码扫得开、有的扫不开"。

   数据形状：{ "<记录键>": { "客户|发货日期": { s, t, car, ct, u } } }
     s   = 工序 0 货待确认（默认） / 1 货好 / 2 装货中 / 3 已完成
     car = 车辆 0 未到 / 1 已到
     t / ct = 达到该工序 / 车辆到达 的时间戳(ms)；u = 最后更新时间
   ========================================================================== */
window.ScanLib = (function () {
  var KEY_PLANS   = "shipping_plans_v1";
  var KEY_PROG    = "shipping_progress_v1";
  var KEY_DEL     = "shipping_plans_del_v1";
  var KEY_PENDING = "shipping_prog_pending_v1";
  var SCAN_PAGE   = "扫码.html";
  var DRIVER_PAGE = "司机扫码.html";
  var DASH_PAGE   = "物流大屏.html";
  /* 站点地址 —— 二维码里放的就是它。三种取法，按顺序：
     ① 页面里若设了 window.SITE_BASE，以它为准（换域名 / 固定内网 IP 时用来钉死）；
     ② 否则自动跟随「当前打开的网址」—— 系统装在哪台服务器，码就指向哪台服务器，不用改代码；
     ③ file:// 等特殊环境才退回线上地址（现场手机扫的必须是一个能打开的网址）。 */
  var FALLBACK_BASE = "https://zhangrenleiahhl.github.io/production-mgr/";
  var PUB_BASE = (function () {
    try { if (window.SITE_BASE) return String(window.SITE_BASE).replace(/\/*$/, "/"); } catch (e) {}
    try {
      var proto = location.protocol, pn = location.pathname || "/";
      if (proto === "http:" || proto === "https:") return location.origin + pn.replace(/[^/]*$/, "");
    } catch (e) {}
    return FALLBACK_BASE;
  })();
  var STEP_NAME   = ["货待确认", "货好", "装货中", "已完成"];
  var CAR_NAME    = ["车未到", "车已到"];
  var QR_FILE     = "qrcode.min.js";

  function pad(s){ s = String(s == null ? "" : s).trim(); return s === "" ? "/" : s; }
  function raw(s){ return String(s == null ? "" : s).trim(); }
  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function escAttr(s){ return esc(s); }

  /* ---- 键：记录用 id（稳定），进度的行用「客户|发货日期」（换型号/改数量都不影响） ---- */
  function recKeyOf(r){ return (r && r.id != null) ? ("i" + r.id) : (r && r.no ? ("n" + r.no) : null); }
  function custKeyOf(r){ return pad(r.customer) + "|" + pad(r.shipdate); }
  function recShipDate(rec){
    var rows = (rec && rec.rows) || [];
    for (var i = 0; i < rows.length; i++){ if (rows[i] && raw(rows[i].shipdate)) return raw(rows[i].shipdate); }
    return (rec && rec.date) || "";
  }

  /* ---- 扫码页地址：二维码里放的就是它（地址见上面 PUB_BASE 的三种取法）---- */
  function pageUrl(name){ return PUB_BASE + encodeURIComponent(String(name)); }
  function scanUrl(recKey){ return PUB_BASE + encodeURIComponent(SCAN_PAGE) + "?d=" + encodeURIComponent(String(recKey)); }

  /* ---- 合并规则 ----
     ① 有版本号的格子：谁的动作更新（rv 更大）整格以谁为准。
        为什么需要它：光靠「取最大值」的话「撤回」永远退不回去 —— 本地把工序退一格，
        上传时又会跟云端的高值取 max，10 秒后拉取一合并就自己弹回来了。
        rv 是本地自增的整数（每次动作 +1），**不看手机时钟**，所以个别手机时间不准也不影响。
     ② 版本号相同（或双方都是没有 rv 的旧数据）：退回老的「只增不减」规则，
        任何情况下都不会因为一次陈旧的整体覆盖而丢进度。 */
  function mergeCell(x, y){
    x = x || {}; y = y || {};
    var xr = x.rv || 0, yr = y.rv || 0;
    if (xr !== yr){
      var w = xr > yr ? x : y;
      return {
        s: Math.min(3, w.s || 0),
        t: w.t || 0,
        car: w.car || 0,
        ct: w.ct || 0,
        u: w.u || 0,
        by: raw(w.by),
        rv: Math.max(xr, yr)
      };
    }
    var xs = x.s || 0, ys = y.s || 0, s = Math.max(xs, ys);
    function pick(ax, ay, bx, by){
      if (ax > ay) return bx || 0;
      if (ay > ax) return by || 0;
      var a = [bx, by].filter(function (v) { return v > 0; });
      return a.length ? Math.min.apply(null, a) : 0;
    }
    var car = Math.max(x.car || 0, y.car || 0);
    var us = [x.u, y.u].filter(function (v) { return v > 0; });
    // 操作人：谁最后更新的算谁的（用来在页面上显示"谁点的这一步"）
    var by = "";
    if (s > 0){
      var bx = raw(x.by), by2 = raw(y.by);
      by = !bx ? by2 : (!by2 ? bx : ((x.u || 0) >= (y.u || 0) ? bx : by2));
    }
    return {
      s: s,
      t: s > 0 ? pick(xs, ys, x.t, y.t) : 0,
      car: car,
      ct: car > 0 ? pick(x.car || 0, y.car || 0, x.ct, y.ct) : 0,
      u: us.length ? Math.max.apply(null, us) : 0,
      by: by,
      rv: xr
    };
  }
  function mergeProg(a, b){
    var out = {};
    var rks = {}, i;
    Object.keys(a || {}).forEach(function (k) { rks[k] = 1; });
    Object.keys(b || {}).forEach(function (k) { rks[k] = 1; });
    Object.keys(rks).forEach(function (rk) {
      var A = (a || {})[rk] || {}, B = (b || {})[rk] || {}, o = {}, cks = {};
      Object.keys(A).forEach(function (k) { cks[k] = 1; });
      Object.keys(B).forEach(function (k) { cks[k] = 1; });
      Object.keys(cks).forEach(function (ck) {
        var m = mergeCell(A[ck], B[ck]);
        // rv>0 的"空格子"也要留着：那是「撤回」留下的墓碑。
        // 丢掉它的话，某台离线手机拿着旧版本一推，被撤掉的进度就会自己长回来。
        if (m.s > 0 || m.car > 0 || (m.rv || 0) > 0) o[ck] = m;
      });
      if (Object.keys(o).length) out[rk] = o;
    });
    return out;
  }
  function parseObj(s){
    try { var v = JSON.parse(s || "{}"); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; } catch (e){ return {}; }
  }
  // 直接交给 CloudSync.guard(KEY_PROG, ...) 用：引擎在 push 前先跟云端合并，
  // 合并规则就是上面那条「有 rv 比 rv，没 rv 就只增不减」。
  function guardFn(localStr, cloudStr){ return JSON.stringify(mergeProg(parseObj(localStr), parseObj(cloudStr))); }

  /* ==========================================================================
     在某个格子上做一次动作（三端共用一份，避免各写一份时忘了 rv+1）
     忘加 rv 的后果很隐蔽：点一下有反应、看起来生效了，10 秒后拉取一合并又弹回原样。
     ========================================================================== */
  function cellAt(prog, rk, ck){
    if (!prog[rk]) prog[rk] = {};
    if (!prog[rk][ck]) prog[rk][ck] = { s: 0, t: 0, car: 0, ct: 0, u: 0, by: "", rv: 0 };
    if (prog[rk][ck].rv == null) prog[rk][ck].rv = 0;
    return prog[rk][ck];
  }
  // 推进一步工序（delta 一般是 +1；who 是操作人，用于留痕）
  function applyStep(prog, rk, ck, delta, who){
    var c = cellAt(prog, rk, ck), now = Date.now();
    var from = c.s || 0;
    var to = Math.max(0, Math.min(3, from + (delta || 0)));
    if (to === from) return { changed: false, cell: c, to: to, from: from };
    c.s = to;
    c.t = to === 0 ? 0 : now;
    if (to > 0 && raw(who)) c.by = raw(who);
    c.u = now;
    c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, to: to, from: from };
  }
  // 标记车辆：未到 / 已到
  function applyCar(prog, rk, ck, v){
    var c = cellAt(prog, rk, ck), now = Date.now();
    var nv = v ? 1 : 0;
    if ((c.car || 0) === nv) return { changed: false, cell: c, car: nv };
    c.car = nv;
    c.ct = nv ? (c.ct || now) : 0;
    c.u = now;
    c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, car: nv };
  }
  /* 撤回：优先撤「最近做的那一次」——比较工序时间和车辆时间，谁更晚撤谁。
     都不晚的（只有工序）就退一格工序。三端共用，口径一致。 */
  function applyUndo(prog, rk, ck, who){
    var c = cellAt(prog, rk, ck), now = Date.now();
    var s = c.s || 0, car = c.car || 0;
    if (!s && !car) return { changed: false, cell: c, what: "" };
    var doCar = !!car && (!s || (c.ct || 0) > (c.t || 0));
    var what;
    if (doCar){ c.car = 0; c.ct = 0; what = "车已到"; }
    else {
      what = STEP_NAME[s];
      c.s = s - 1;
      c.t = c.s === 0 ? 0 : (c.t || now);
      if (c.s > 0 && raw(who)) c.by = raw(who);
    }
    c.u = now;
    c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, what: what };
  }

  function fmtHM(ts){
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    var p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---- 客户分组：同一「客户+发货日期」的多行型号合成一条 ----
     扫码页、查看页明细、管理端看板三处都用这一份，否则三处显示的客户清单会对不上。 */
  function custGroups(rec){
    var map = {};
    ((rec && rec.rows) || []).forEach(function (r) {
      var k = custKeyOf(r);
      if (!map[k]) map[k] = { key: k, customer: pad(r.customer), shipdate: pad(r.shipdate),
        logistics: raw(r.logistics), remark: raw(r.remark), ton: 0, qty: 0, nrow: 0, models: [] };
      var g = map[k];
      g.ton += (parseFloat(r.ton) || 0) + (parseFloat(r.cwt) || 0);
      g.qty += (parseFloat(r.qty) || 0);
      g.nrow++;
      var m = raw(r.model);
      if (m && g.models.indexOf(m) < 0) g.models.push(m);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /* ---- 一张单的整体进度（按「客户+发货日期」去重统计）----
     done=已完成客户数 / car=车已到客户数 / total=客户总数 / touched=有任何一个动作的客户数
     口径只留这一份：三端显示的「已完成 2/5」必须是同一个意思。 */
  function progStats(rec, prog){
    prog = prog || {};
    var rk = recKeyOf(rec);
    if (!rk) return { total: 0, done: 0, car: 0, step: 0, last: 0, touched: 0 };
    var keys = {};
    ((rec && rec.rows) || []).forEach(function (r) { keys[custKeyOf(r)] = 1; });
    var done = 0, car = 0, step = 0, last = 0, touched = 0, total = 0;
    Object.keys(keys).forEach(function (ck) {
      total++;
      var c = (prog[rk] || {})[ck] || {};
      if ((c.s || 0) >= 3) done++;
      if ((c.car || 0) >= 1) car++;
      if ((c.s || 0) > 0 || (c.car || 0) > 0) touched++;
      step += Math.min(3, c.s || 0);
      if ((c.u || 0) > last) last = c.u || 0;
    });
    return { total: total, done: done, car: car, step: step, last: last, touched: touched };
  }
  // 取某一行（客户）的进度
  function progOf(rec, ck, prog){
    var m = (prog || {})[recKeyOf(rec)];
    return (m && m[ck]) || { s: 0, t: 0, car: 0, ct: 0, u: 0, by: "", rv: 0 };
  }

  /* ==========================================================================
     日期：发货日期在数据里有好几种写法（2026-09-15 / 2026/9/15 / 2026年9月15日 /
     Excel 日期序列号），全部归一到 YYYY-MM-DD 后再比较，否则"今天"会认不出来
     —— 大屏上当天计划会整片消失，这种 bug 现场很难查。
     ========================================================================== */
  function p2(n){ return (n < 10 ? "0" : "") + n; }
  function ymdOf(d){ return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function todayYmd(){ return ymdOf(new Date()); }
  function shiftYmd(ymd, days){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd == null ? "" : ymd));
    if (!m) return "";
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    d.setDate(d.getDate() + days);
    return ymdOf(d);
  }
  function normDate(s){
    if (s == null) return "";
    var t = String(s).trim();
    if (!t) return "";
    var m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(t);
    if (m) return m[1] + "-" + p2(+m[2]) + "-" + p2(+m[3]);
    if (/^\d{5}$/.test(t)){                       // Excel 日期序列号（1900 起算）
      var d = new Date(Date.UTC(1899, 11, 30) + (+t) * 86400000);
      return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
    }
    return t;
  }

  /* ==========================================================================
     「完成了没有」的唯一口径（用户 2026-09-16 定死）：
       工序走到「已完成」**并且** 车已到，才算完成 —— 缺任何一个都算没走完。
     大屏的红色标记、昨天哪些单会留在屏幕上、顶部"还剩几趟"全都用这一个函数，
     所以三处的数字不可能对不上。
     ========================================================================== */
  function isDoneCell(c){ c = c || {}; return (c.s || 0) >= 3 && (c.car || 0) >= 1; }

  /* ==========================================================================
     大屏 / 司机页 / 内部页 共用的「要展示哪些行」
       ① 只展示「发货日期 = 今天」的，加上「发货日期 = 昨天 且 还没完成」的；
          （更早的遗留单不铺在门口大屏上，避免屏幕被历史数据淹掉）
       ② 一行 = 一个客户（最贴近现场那张 Excel 跟踪表）；
       ③ 完成工序最多的排最顶（2026-09-16 下午改）：工序走得越远越靠上，
          已完成（工序走完 + 车已到）天然就是进度最高的，自然排第一 ——
          现场看大屏时「有动静的单往上走」，一眼能看出哪几趟在动。
     三端共用这一份，所以三处看到行数、顺序、颜色分类完全一致。
     ========================================================================== */
  function boardRows(records, prog, opt){
    opt = opt || {};
    var today = opt.today || todayYmd();
    var yest = shiftYmd(today, -1);
    prog = prog || {};
    var out = [];
    (records || []).forEach(function (rec) {
      if (!rec) return;
      var rk = recKeyOf(rec);
      if (!rk) return;
      custGroups(rec).forEach(function (g) {
        var d = normDate(g.shipdate);
        var isToday = (d === today);
        var isYest = (d === yest);
        var c = (prog[rk] || {})[g.key] || {};
        var done = isDoneCell(c);
        if (opt.onlyRec && String(opt.onlyRec) !== String(rk)) return;
        if (opt.onlyDate && d !== opt.onlyDate) return;
        if (!opt.onlyDate){
          if (isToday) { /* 今天的全要 */ }
          // 2026-09-16 起改为「从今天开始算」：默认不再带昨天，
          // 只有明确传 opt.includeYesterday 的调用方才把昨天没走完的带上。
          else if (isYest && !done && opt.includeYesterday) { /* 昨天没走完的（仅显式开启时） */ }
          else return;
        }
        out.push({
          rec: rec, rk: rk, ck: g.key,
          customer: g.customer, shipdate: d, dateRaw: g.shipdate,
          logistics: g.logistics, remark: g.remark,
          ton: g.ton, qty: g.qty, nrow: g.nrow, models: g.models,
          s: Math.min(3, c.s || 0), car: c.car || 0,
          t: c.t || 0, ct: c.ct || 0, u: c.u || 0, by: raw(c.by),
          no: raw(rec.no), planner: raw(rec.planner),
          done: done, isToday: isToday, isYesterday: isYest, stale: !isToday
        });
      });
    });
    out.sort(function (a, b) {
      if (a.s !== b.s) return b.s - a.s;                      // ③ 完成工序最多的置顶
      if (a.car !== b.car) return b.car - a.car;              //    同工序：车已到的更靠前
      if (a.u !== b.u) return b.u - a.u;                      //    同进度：刚有动作的更靠前
      return String(a.customer).localeCompare(String(b.customer));
    });
    return out;
  }

  /* ---- 大屏顶部的汇总（只用上面那批行算，绝不会算到屏幕外的单） ---- */
  function boardStats(rows){
    var t = { total: 0, done: 0, car: 0, left: 0, stale: 0, ton: 0, tonLeft: 0, step: 0, byStep: [0, 0, 0, 0] };
    (rows || []).forEach(function (r) {
      t.total++;
      t.ton += r.ton || 0;
      t.step += Math.min(3, r.s || 0);
      t.byStep[Math.min(3, r.s || 0)]++;
      if (r.car) t.car++;
      if (r.done) t.done++; else { t.left++; t.tonLeft += r.ton || 0; }
      if (!r.isToday) t.stale++;
    });
    t.pct = t.total ? Math.round(t.step / (t.total * 3) * 100) : 0;
    return t;
  }

  /* ---- 按物流公司分组（司机扫一个码进来，先找自己那家物流的车） ---- */
  function groupByLogistics(rows){
    var m = {};
    (rows || []).forEach(function (r) {
      var k = r.logistics || "未填物流";
      if (!m[k]) m[k] = [];
      m[k].push(r);
    });
    return Object.keys(m).sort(function (a, b) {
      if (a === "未填物流") return 1;
      if (b === "未填物流") return -1;
      return a.localeCompare(b);
    }).map(function (k) { var g = m[k]; return { logistics: k, rows: g, ton: g.reduce(function (s, r) { return s + (r.ton || 0); }, 0) }; });
  }

  /* ==========================================================================
     SHA-256（纯 JS，不依赖 crypto.subtle）
     用途：内部人员的口令页面里只放哈希、不放明文。
     自己实现一份是为了 file:// 直接打开、以及 jsdom 测试里都照样能跑
     —— crypto.subtle 在 jsdom / 非安全上下文里可能不存在。
     ========================================================================== */
  function sha256Hex(str){
    str = String(str == null ? "" : str);
    function rr(v, n){ return (v >>> n) | (v << (32 - n)); }
    var K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bytes = [], i, c;
    for (i = 0; i < str.length; i++){                       // UTF-8
      c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff){
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
               (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64){
      for (i = 0; i < 16; i++)
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (i = 16; i < 64; i++){
        var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++){
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var mj = (a & b) ^ (a & cc) ^ (b & cc);
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a;
        a = (t1 + ((S0 + mj) | 0)) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }

  /* ==========================================================================
     内部人员登录（工号 + 口令）
     账号表放在单独的 staff-config.js 里，页面里只存口令的 SHA-256，不存明文。
     ⚠ 必须跟用户讲清楚的安全边界：
        这是「挡住司机/挡住误点」这个级别的门槛，不是金融级安全。
        静态页面没法做真正的服务端校验——拿到源码的人理论上可以离线暴力破解口令。
        要做到真正安全，需要：自有备案域名 + 服务端校验，或者微信登录。
     ========================================================================== */
  var KEY_STAFF = "staff_session_v1";
  function staffConf(){ return (typeof window !== "undefined" && window.STAFF) || {}; }
  function staffUsers(){ var u = staffConf().users; return Array.isArray(u) ? u : []; }
  function staffSalt(){ return String(staffConf().salt || ""); }
  function staffHash(pwd){ return sha256Hex(staffSalt() + ":" + String(pwd == null ? "" : pwd)); }
  function staffFind(id){
    var t = String(id == null ? "" : id).trim().toLowerCase();
    if (!t) return null;
    var list = staffUsers(), hit = null;
    list.forEach(function (u) {
      if (hit || !u) return;
      var uids = [u.id, u.name, u.no].filter(function (v) { return v != null && String(v).trim() !== ""; })
        .map(function (v) { return String(v).trim().toLowerCase(); });
      if (uids.indexOf(t) >= 0) hit = u;
    });
    return hit;
  }
  function staffLogin(id, pwd){
    if (!staffUsers().length) return { ok: false, msg: "还没配置内部账号，请先找管理员配置 staff-config.js" };
    var u = staffFind(id);
    if (!u) return { ok: false, msg: "工号不存在" };
    if (staffHash(pwd) !== String(u.h || "").trim().toLowerCase()) return { ok: false, msg: "口令不对" };
    var days = Number(staffConf().days) > 0 ? Number(staffConf().days) : 30;
    var ses = { id: String(u.id || u.name || ""), name: String(u.name || u.id || ""), exp: Date.now() + days * 86400000 };
    try { localStorage.setItem(KEY_STAFF, JSON.stringify(ses)); } catch (e){}
    return { ok: true, session: ses };
  }
  function staffSession(){
    try {
      var s = JSON.parse(localStorage.getItem(KEY_STAFF) || "null");
      if (s && s.id && Number(s.exp) > Date.now()) return s;
      if (s) localStorage.removeItem(KEY_STAFF);
    } catch (e){}
    return null;
  }
  function staffLogout(){ try { localStorage.removeItem(KEY_STAFF); } catch (e){} }
  function staffName(){ var s = staffSession(); return s ? String(s.name || s.id) : ""; }

  /* ---- 二维码（按需加载，不发码就完全不下这个文件）---- */
  var __qrPromise = null;
  function ensureQRCode(){
    if (window.QRCode) return Promise.resolve(true);
    if (__qrPromise) return __qrPromise;
    __qrPromise = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = QR_FILE;
      s.onload = function () { resolve(true); };
      s.onerror = function () { __qrPromise = null; resolve(false); };
      document.head.appendChild(s);
    });
    return __qrPromise;
  }
  /* 这个内容要多少个模块（21/25/29/…/177）：先拿一次库的内部矩阵问出来。
     只为确定模块数，不拿来显示。问不到就返回 0，后面会退回老做法。 */
  function qrModuleCount(text){
    try {
      var tmp = document.createElement("div");
      var q = new window.QRCode(tmp, { text: text, correctLevel: window.QRCode.CorrectLevel.M });
      var n = (q && q._oQRCode && q._oQRCode.getModuleCount) ? q._oQRCode.getModuleCount() : 0;
      return n > 0 ? n : 0;
    } catch (e){ return 0; }
  }

  /* 二维码的唯一出口。两个细节决定「手机能不能扫出来」：
     ① 模块边长必须取整数。qrcodejs 画方块用的是 x = round(j*k)、宽 = round(k)，
        当 240/模块数 除不尽（比如 37 模块时 k=6.49 → 宽 6、间距 7）时，
        相邻深色模块之间会留下 1px 白缝。白缝会破坏定位图形 1:1:3:1:1 的游程比，
        手机直接认不出这张码——同一张单只是 id 长短不同就可能中招。
        取 size = 模块数 × ceil(240/模块数)，k 就是整数，方块严丝合缝。
     ② 补 4 个模块宽的静默区。库画出来的码是贴边的，码外没有留白也不好认，打印时尤其明显。 */
  function makeQrInto(container, text, px){
    px = px || 240;
    var n = qrModuleCount(text);
    var K = n > 0 ? Math.max(4, Math.ceil(px / n)) : 0;   // 每个模块的像素边长（整数）
    var size = n > 0 ? n * K : px;
    var box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-9999px;top:0;";
    (document.body || document.documentElement).appendChild(box);
    var cv = null;
    try {
      new window.QRCode(box, { text: text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
      var lib = box.querySelector("canvas");
      if (lib){
        var quiet = n > 0 ? K * 4 : Math.round(size * 0.08);   // 标准静默区 4 个模块
        var out = document.createElement("canvas");
        var octx = null;
        try {
          out.width = lib.width + quiet * 2;
          out.height = lib.height + quiet * 2;
          octx = out.getContext("2d");
        } catch (e){ octx = null; }
        if (octx){
          octx.fillStyle = "#ffffff";
          octx.fillRect(0, 0, out.width, out.height);
          octx.drawImage(lib, quiet, quiet);
          cv = out;
        } else {
          cv = lib;   // 拿不到 2D 上下文就退回库自己那张：没有静默区，但码本身是对的
        }
      }
    } catch (e){ cv = null; }
    if (box.parentNode) box.parentNode.removeChild(box);
    if (cv && container){ container.innerHTML = ""; container.appendChild(cv); }
    return cv;
  }

  async function qrDataUrl(text){
    var okLib = await ensureQRCode();
    if (!okLib) return null;
    var cv = makeQrInto(null, text, 240);
    try { return cv ? cv.toDataURL("image/png") : null; } catch (e){ return null; }
  }

  // 进度徽章的外观也统一在这里（三端同一套），免得各页面各写一份、越走越不一样
  var PILL_CSS = '.p-pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;' +
    'font-weight:700;line-height:1.65;color:#fff;white-space:nowrap;}' +
    '.p-pill.p-wait{background:#94a3b8;}.p-pill.p-ok{background:#0ea5e9;}' +
    '.p-pill.p-mid{background:#f59e0b;}.p-pill.p-done{background:#10b981;}';

  var QR_CSS = '.smk-mask{display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;' +    'align-items:center;justify-content:center;padding:16px;}' +
    '.smk-box{background:#fff;border-radius:10px;padding:18px 20px 16px;max-width:340px;width:100%;' +
    'text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.32);font-family:"Microsoft YaHei","PingFang SC",sans-serif;}' +
    '.smk-title{font-size:16px;font-weight:800;color:#1f2328;word-break:break-all;}' +
    '.smk-sub{font-size:12px;color:#4b5563;margin:3px 0 10px;}' +
    '.smk-cv{display:flex;align-items:center;justify-content:center;min-height:240px;}' +
    '.smk-cv img,.smk-cv canvas{width:240px;height:240px;}' +
    '.smk-load{color:#94a3b8;font-size:13px;font-weight:600;}' +
    '.smk-url{font-size:10px;color:#94a3b8;word-break:break-all;margin:8px 0 12px;line-height:1.5;}' +
    '.smk-acts{display:flex;gap:8px;justify-content:center;}' +
    '.smk-acts button{flex:1;padding:8px 14px;border-radius:4px;border:1px solid #d0d7de;background:#fff;' +
    'font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}' +
    '.smk-acts button.pri{background:#2563eb;border-color:#2563eb;color:#fff;}';

  function ensureCss(){
    if (document.getElementById("smkCss")) return;
    var st = document.createElement("style");
    st.id = "smkCss";
    st.textContent = PILL_CSS + QR_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  try { ensureCss(); } catch (e){}

  // 二维码弹层（三端同一套：标题 + 码 + 「打印二维码」）
  function openQrModal(title, sub, url){
    var m = document.getElementById("smkQrModal");
    if (!m){
      ensureCss();
      m = document.createElement("div");
      m.id = "smkQrModal"; m.className = "smk-mask";
      m.innerHTML = '<div class="smk-box"><div class="smk-title" id="smkTitle"></div>' +
        '<div class="smk-sub" id="smkSub"></div><div class="smk-cv" id="smkCv"></div>' +
        '<div class="smk-url" id="smkUrl"></div>' +
        '<div class="smk-acts"><button type="button" class="pri" id="smkPrint">打印二维码</button>' +
        '<button type="button" id="smkClose">关闭</button></div></div>';
      document.body.appendChild(m);
      m.addEventListener("click", function (e) { if (e.target === m) m.style.display = "none"; });
      document.getElementById("smkClose").onclick = function () { m.style.display = "none"; };
      document.getElementById("smkPrint").onclick = function (){
        var cv = document.getElementById("smkCv").querySelector("canvas");
        var img = cv ? cv.toDataURL("image/png") : null;
        if (!img){ alert("二维码还没生成好，稍等一下再打印"); return; }
        var w = window.open("", "_blank");
        if (!w){ alert("打印窗口被浏览器拦住了，请允许本站弹出窗口后重试。"); return; }
        w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>发货单二维码</title>' +
          '<style>body{font-family:"Microsoft YaHei",sans-serif;text-align:center;margin:26px;}' +
          'h2{font-size:16px;margin:0 0 4px;}p{font-size:12px;color:#333;margin:2px 0 12px;}' +
          'img{width:260px;height:260px;}div.t{font-size:11px;color:#666;margin-top:8px;}</style></head><body>' +
          '<h2>' + esc(title) + '</h2><p>' + esc(sub || "") + '</p><img src="' + img + '">' +
          '<div class="t">' + esc(url) + '</div>' +
          '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr' + 'ipt></body></html>');
        w.document.close(); w.focus();
      };
    }
    document.getElementById("smkTitle").textContent = title;
    document.getElementById("smkSub").textContent = sub || "";
    document.getElementById("smkUrl").textContent = url;
    var box = document.getElementById("smkCv");
    box.innerHTML = '<div class="smk-load">正在生成…</div>';
    m.style.display = "flex";
    ensureQRCode().then(function (okLib) {
      if (!okLib){ box.innerHTML = '<div class="smk-load">二维码组件加载失败（检查网络后重试）</div>'; return; }
      var cv = makeQrInto(box, url, 240);
      if (!cv) box.innerHTML = '<div class="smk-load">生成失败</div>';
    });
  }

  /* ==========================================================================
     两个固定码（用户 2026-09-16 定死）：不再给每张单/每个人单独出码，
     全厂只用两张通用码：
       ① 内部码 → 扫码.html        内部人员（要登录）推 4 道工序
       ② 司机码 → 司机扫码.html    司机只能勾「车已到」和撤回
     三端共用这一份，所以每处弹出来的码永远是同一个地址。
     ========================================================================== */
  var CODES_CSS = '.smk2-mask{display:none;position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:3100;' +
    'align-items:center;justify-content:center;padding:16px;}' +
    '.smk2-box{background:#fff;border-radius:12px;padding:20px 20px 16px;max-width:660px;width:100%;' +
    'box-shadow:0 18px 50px rgba(0,0,0,.36);font-family:"Microsoft YaHei","PingFang SC",sans-serif;}' +
    '.smk2-h{font-size:17px;font-weight:800;color:#1f2328;text-align:center;}' +
    '.smk2-p{font-size:12.5px;color:#4b5563;text-align:center;margin:4px 0 15px;}' +
    '.smk2-cards{display:flex;gap:14px;}' +
    '.smk2-card{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:12px 10px;text-align:center;background:#fbfcfe;}' +
    '.smk2-card .t{font-size:15.5px;font-weight:800;color:#1f2328;}' +
    '.smk2-card .d{font-size:11.5px;color:#64748b;margin:4px 0 8px;line-height:1.5;min-height:34px;}' +
    '.smk2-card .cv{display:flex;align-items:center;justify-content:center;min-height:196px;}' +
    '.smk2-card canvas{width:184px;height:184px;}' +
    '.smk2-card .u{font-size:10px;color:#94a3b8;word-break:break-all;margin-top:7px;line-height:1.45;}' +
    '.smk2-act{display:flex;gap:8px;margin-top:16px;}' +
    '.smk2-act button{flex:1;padding:9px 14px;border-radius:5px;border:1px solid #d0d7de;background:#fff;' +
    'font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;}' +
    '.smk2-act button.pri{background:#2563eb;border-color:#2563eb;color:#fff;}' +
    '@media(max-width:560px){.smk2-cards{flex-direction:column;}.smk2-card canvas{width:170px;height:170px;}}';

  function codesCss(){
    if (document.getElementById("smk2Css")) return;
    var st = document.createElement("style");
    st.id = "smk2Css";
    st.textContent = CODES_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function codeDefs(){
    return [
      { title: "内部人员码", desc: "要登录（工号+口令）。推进「待确认 / 货好 / 装货中 / 已完成」四道工序。", url: pageUrl(SCAN_PAGE), page: SCAN_PAGE },
      { title: "司机码",     desc: "不用登录。司机只能勾「车已到」，可撤回自己那一勾。", url: pageUrl(DRIVER_PAGE), page: DRIVER_PAGE }
    ];
  }

  // 把两张码一起弹出来（管理端 / 大屏 都能调）
  function openCodesModal(){
    codesCss();
    var m = document.getElementById("smk2Modal");
    if (!m){
      m = document.createElement("div");
      m.id = "smk2Modal"; m.className = "smk2-mask";
      m.innerHTML = '<div class="smk2-box"><div class="smk2-h">发货进度 · 两个码</div>' +
        '<div class="smk2-p">贴在物流门口 / 工作群里发这两张就够，不用每张单单独出码</div>' +
        '<div class="smk2-cards" id="smk2Cards"></div>' +
        '<div class="smk2-act"><button type="button" class="pri" id="smk2Print">🖨 打印张贴</button>' +
        '<button type="button" id="smk2Close">关闭</button></div></div>';
      document.body.appendChild(m);
      m.addEventListener("click", function (e) { if (e.target === m) m.style.display = "none"; });
      document.getElementById("smk2Close").onclick = function () { m.style.display = "none"; };
      document.getElementById("smk2Print").onclick = printCodes;
    }
    var box = document.getElementById("smk2Cards");
    var defs = codeDefs();
    // 画布用「下标」做标记（c0 / c1），不要拿文件名去拼选择器。
    // 踩过的坑：曾经写 d.page.replace(/[^\w.]/g,"") 想"净化"一下，
    // 可 JS 的 \w 只认 ASCII，中文全被剔掉 —— "扫码.html" 变成 "html"，
    // 选择器永远匹配不上，弹出来就是两个"正在生成…"的空框。
    box.innerHTML = defs.map(function (d, i) {
      return '<div class="smk2-card"><div class="t">' + esc(d.title) + '</div>' +
        '<div class="d">' + esc(d.desc) + '</div>' +
        '<div class="cv" data-cv="c' + i + '"><div class="smk-load">正在生成…</div></div>' +
        '<div class="u">' + esc(d.url) + "</div></div>";
    }).join("");
    m.style.display = "flex";
    ensureQRCode().then(function (okLib) {
      defs.forEach(function (d, i) {
        var c = box.querySelector('[data-cv="c' + i + '"]');
        if (!c) return;
        if (!okLib){ c.innerHTML = '<div class="smk-load">二维码组件加载失败</div>'; return; }
        if (!makeQrInto(c, d.url, 184)) c.innerHTML = '<div class="smk-load">生成失败</div>';
      });
    });
  }

  // 打印「两张码」的张贴页：A4 一页，字号大，门口一贴就行
  function printCodes(){
    var defs = codeDefs();
    var w = window.open("", "_blank");
    if (!w){ alert("打印窗口被浏览器拦住了，请允许本站弹出窗口后重试。"); return; }
    ensureQRCode().then(function (okLib) {
      var imgs = defs.map(function (d) { return okLib ? qrDataUrl(d.url) : Promise.resolve(null); });
      Promise.all(imgs).then(function (urls) {
        var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>发货进度二维码</title>' +
          '<style>@page{margin:12mm;}body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;margin:0;color:#111;}' +
          'h1{font-size:20px;text-align:center;margin:0 0 2px;}p.sub{text-align:center;font-size:12px;color:#555;margin:0 0 20px;}' +
          '.two{display:flex;gap:16mm;justify-content:center;align-items:flex-start;}' +
          '.c{flex:1;max-width:80mm;text-align:center;border:1.5px solid #222;border-radius:6px;padding:8mm 4mm;}' +
          '.c h2{font-size:20px;margin:0 0 3px;}.c .d{font-size:12px;color:#444;margin:0 0 8px;line-height:1.5;}' +
          '.c img{width:60mm;height:60mm;}@media print{.c{page-break-inside:avoid;}}</style></head><body>' +
          '<h1>发货进度 · 扫码更新</h1><p class="sub">' + esc(PUB_BASE) + '</p><div class="two">' +
          defs.map(function (d, i) {
            return '<div class="c"><h2>' + esc(d.title) + "</h2><p class=\"d\">" + esc(d.desc) + "</p>" +
              (urls[i] ? '<img src="' + urls[i] + '">' : '<div style="height:60mm;line-height:60mm;color:#c00;">二维码没生成出来</div>') +
              "</div>";
          }).join("") +
          '</div><scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},400);};</scr' + 'ipt></body></html>';
        w.document.write(html); w.document.close(); w.focus();
      });
    });
  }

  /* ==========================================================================
     页面自绘确认弹窗（2026-09-16 用户要求：不要「关闭网页」，只要「取消 / 确定」）
     --------------------------------------------------------------------------
     为什么不用浏览器原生 confirm()：部分手机浏览器会往原生弹窗里自动加第三个
     按钮「关闭网页」，手一滑就把页面关了（发货员在车间手机上尤其容易误触）。
     这里改成页面自己画的弹层，只有「取消 / 确定」两个按钮，点空白 = 取消。
     用法：SL.uiConfirm("确认删除？", function(){ 确定后要做的事 });  // 回调式，不再返回值
     ========================================================================== */
  var CF_CSS = '.smkcf-mask{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:4000;display:flex;' +
    'align-items:center;justify-content:center;padding:16px;}' +
    '.smkcf-box{background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.3);width:100%;max-width:340px;' +
    'overflow:hidden;font-family:"Microsoft YaHei","PingFang SC",sans-serif;}' +
    '.smkcf-ttl{padding:15px 18px 0;font-size:15px;font-weight:800;color:#111827;}' +
    '.smkcf-msg{padding:9px 18px 4px;font-size:13.5px;line-height:1.65;color:#374151;white-space:pre-wrap;' +
    'max-height:52vh;overflow:auto;word-break:break-word;}' +
    '.smkcf-act{display:flex;border-top:1px solid #eef1f5;margin-top:14px;}' +
    '.smkcf-act button{flex:1;border:none;background:#fff;padding:14px 0;font-size:15px;cursor:pointer;font-family:inherit;}' +
    '.smkcf-act button:active{background:#f1f5f9;}' +
    '.smkcf-no{color:#4b5563;font-weight:600;border-right:1px solid #eef1f5;}' +
    '.smkcf-yes{color:#2563eb;font-weight:800;}';

  function cfCss(){
    if (document.getElementById("smkcfCss")) return;
    var st = document.createElement("style");
    st.id = "smkcfCss";
    st.textContent = CF_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // 只有「取消 / 确定」两个按钮的确认弹窗；返回 { close, mask } 便于测试与外部收口
  function uiConfirm(msg, onOk, opt){
    opt = opt || {};
    cfCss();
    var mask = document.createElement("div"); mask.className = "smkcf-mask";
    var box  = document.createElement("div"); box.className = "smkcf-box";
    var ttl  = document.createElement("div"); ttl.className = "smkcf-ttl";
    ttl.textContent = opt.title || "请确认";
    var body = document.createElement("div"); body.className = "smkcf-msg";
    body.textContent = msg == null ? "" : String(msg);
    var act  = document.createElement("div"); act.className = "smkcf-act";
    var no   = document.createElement("button"); no.className = "smkcf-no";  no.type = "button"; no.textContent = opt.cancelText || "取消";
    var yes  = document.createElement("button"); yes.className = "smkcf-yes"; yes.type = "button"; yes.textContent = opt.okText || "确定";
    act.appendChild(no); act.appendChild(yes);
    box.appendChild(ttl); box.appendChild(body); box.appendChild(act);
    mask.appendChild(box);
    (document.body || document.documentElement).appendChild(mask);

    function close(){ if (mask.parentNode) mask.parentNode.removeChild(mask); }
    no.onclick  = function(){ close(); if (opt.onCancel) opt.onCancel(); };
    yes.onclick = function(){ close(); if (onOk) onOk(); };
    mask.onclick = function(e){ if (e.target === mask){ close(); if (opt.onCancel) opt.onCancel(); } };
    setTimeout(function(){ try { yes.focus(); } catch (e){} }, 30);
    return { close: close, mask: mask, yes: yes, no: no };
  }

  return {
    uiConfirm: uiConfirm,
    KEY_PLANS: KEY_PLANS, KEY_PROG: KEY_PROG, KEY_DEL: KEY_DEL, KEY_PENDING: KEY_PENDING,
    SCAN_PAGE: SCAN_PAGE, DRIVER_PAGE: DRIVER_PAGE, DASH_PAGE: DASH_PAGE,
    PUB_BASE: PUB_BASE, STEP_NAME: STEP_NAME, CAR_NAME: CAR_NAME,
    pad: pad, raw: raw, esc: esc, escAttr: escAttr, fmtHM: fmtHM,
    recKeyOf: recKeyOf, custKeyOf: custKeyOf, recShipDate: recShipDate,
    scanUrl: scanUrl, pageUrl: pageUrl,
    mergeCell: mergeCell, mergeProg: mergeProg, parseObj: parseObj, guardFn: guardFn,
    cellAt: cellAt, applyStep: applyStep, applyCar: applyCar, applyUndo: applyUndo,
    custGroups: custGroups, progStats: progStats, progOf: progOf,
    p2: p2, ymdOf: ymdOf, todayYmd: todayYmd, shiftYmd: shiftYmd, normDate: normDate,
    isDoneCell: isDoneCell, boardRows: boardRows, boardStats: boardStats, groupByLogistics: groupByLogistics,
    sha256Hex: sha256Hex,
    KEY_STAFF: KEY_STAFF, staffUsers: staffUsers, staffLogin: staffLogin, staffSession: staffSession,
    staffLogout: staffLogout, staffName: staffName, staffHash: staffHash,
    progPill: function (s, car) {
      s = Math.min(3, s || 0);
      var cls = s >= 3 ? "p-done" : (s >= 2 ? "p-mid" : (s === 1 ? "p-ok" : "p-wait"));
      return '<span class="p-pill ' + cls + '">' + STEP_NAME[s] + (car ? " · 车已到" : "") + "</span>";
    },
    ensureQRCode: ensureQRCode, qrDataUrl: qrDataUrl, openQrModal: openQrModal,
    qrModuleCount: qrModuleCount, makeQrInto: makeQrInto,
    codeDefs: codeDefs, openCodesModal: openCodesModal, printCodes: printCodes
  };
})();
