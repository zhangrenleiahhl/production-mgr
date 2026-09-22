/* ==========================================================================
   发货进度 · 公共库（扫码页 / 查看页 / 管理端 三处共用）
   --------------------------------------------------------------------------
   为什么必须共用一份：
   1. 「进度合并只增不减」是保命规则。现场好几个人同时扫同一张单，如果三个页面
      各写一份合并逻辑，早晚会漂移成两套行为 —— 表现就是"有时候进度会自己退回去"。
      这种 bug 极难复现，所以从源头只留一份实现。
   2. 二维码里放什么地址，也必须三端一致，否则会出现"有的码扫得开、有的扫不开"。

   数据形状：{ "<记录键>": { "客户|发货日期": { s, t, car, ct, u } } }
     ★ 客户名可带「（第二车）」后缀（一天一家公司发多车，见 custBase / carNoOf）：
       带后缀的客户是**独立一格**（各自进度、各自吨位），但查代码 / 查物流一律回基名。
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
  /* --------------------------------------------------------------------------
     一天一家公司发 2 车（2026-09-20）：客户名末尾的「（第二车）」后缀
     ---- 为什么要有后缀 ----
     同一家公司同一天发第二车时，光看名字分不出是哪一车（现场对单、大屏跟踪都会混）。
     所以在客户名末尾挂「（第二车）」/「（第三车）」…，第二车在表格 / 大屏 / 司机页
     里就是**独立的一条**，能分别盯各自的进度、各自的吨位。
     ---- 关键：后缀只改"名字"，不改"认人" ----
     · 分组（custKeyOf）用**全名** → 两车天然分开；
     · 认物料库（送达方代码 / 物流 / 客户名写法变体）一律回**基名** custBase()
       → 第二车和第一车拿到的代码、物流完全一样，不会因为多个后缀就查不到代码。
     ---- 后缀长什么样 ----
     只认**末尾**的「第X车／X车」括号后缀（全角/半角括号都行、中文/阿拉伯数字都行）：
       宁波泰友（第二车） ／ 宁波泰友(第2车) ／ 宁波泰友（二车）
     ★ 客户名本来就带括号的不受影响：「宁波泰友（宁波甬微进仓）」不是车号
       —— carNoOf 返回 1、custBase 原样返回。
     -------------------------------------------------------------------------- */
  var CAR_CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  var CAR_WORD = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
  var CAR_SUFFIX_RE = /[（(]\s*第?\s*([一二三四五六七八九十]+|\d{1,2})\s*车\s*[)）]\s*$/;
  function carLabel(n){                       // 2 → 二；10 → 十；11 → 十一；20 → 二十
    n = parseInt(n, 10) || 1;
    if (n < 1) return CAR_CN[0];
    if (n < 10) return CAR_CN[n];
    if (n === 10) return "十";
    var t = Math.floor(n / 10), o = n % 10;
    return (t > 1 ? CAR_CN[t] : "") + "十" + (o ? CAR_CN[o] : "");
  }
  function cnNum(t){                          // 中文数字 → 数字：「十一」11 /「二十」20 /「三」3
    t = String(t == null ? "" : t).trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (!/^[一二三四五六七八九十]+$/.test(t)) return 0;
    var i = t.indexOf("十");
    if (i < 0) return t.length === 1 ? (CAR_WORD[t] || 0) : 0;
    var h = i > 0 ? (CAR_WORD[t.charAt(i - 1)] || 1) : 1;
    var o = i < t.length - 1 ? (CAR_WORD[t.charAt(i + 1)] || 0) : 0;
    return h * 10 + o;
  }
  function carNoOf(name){                     // 「宁波泰友（第二车）」→ 2；没有后缀 → 1
    var m = CAR_SUFFIX_RE.exec(String(name == null ? "" : name).trim());
    if (!m) return 1;
    var n = cnNum(m[1]);
    return (n >= 2 && n <= 99) ? n : 1;
  }
  function custBase(name){                    // 剥掉车号后缀 → 查代码 / 查物流 / 认写法变体都用它
    return String(name == null ? "" : name).trim().replace(CAR_SUFFIX_RE, "").trim();
  }
  function custWithCar(name, n){              // ("宁波泰友", 2) → "宁波泰友（第二车）"；n<=1 → 原样
    var b = custBase(name);
    if (!b) return b;
    n = parseInt(n, 10) || 1;
    return n > 1 ? (b + "（第" + carLabel(n) + "车）") : b;
  }
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
  /* ---- 「能设能撤」的状态：预约货好时间 rt、车辆取消 cx -----------------------
     这两个不是"进度"，不能用"整格以 rv 大的为准"去合并 ——
     计划员填预约 / 点取消的那一刻，本机常常还没拉到云端最新（页面刚打开、标签在
     后台、现场刚扫过一道工序），本机那份的 rv 比云端小，整格替换就会把刚填的预约
     抹成 0；而 push 的合并结果又不会回写本机，界面上还显示着，等下一轮拉取（10 秒）
     才"自己消失"（2026-09-19 用户报的就是这个）。
     所以给它俩各配一个独立版本号：谁动过谁 +1（rtv / cxv），合并时版本号大的说了算，
     与 rv 解耦。版本号相同（含两端都是没有版本号的老数据）才退回"有值优先"，
     保证老数据里的预约/取消不会因为这次改动被弄丢。 */
  function mergeRt(x, y){
    var xv = x.rtv || 0, yv = y.rtv || 0;
    if (xv > yv) return { rt: x.rt || 0, rtv: xv };
    if (yv > xv) return { rt: y.rt || 0, rtv: yv };
    return { rt: Math.max(x.rt || 0, y.rt || 0), rtv: xv };
  }
  function mergeCx(x, y){
    var xv = x.cxv || 0, yv = y.cxv || 0;
    if (xv > yv) return { cx: (x.cx || 0) ? 1 : 0, cxv: xv };
    if (yv > xv) return { cx: (y.cx || 0) ? 1 : 0, cxv: yv };
    return { cx: Math.max(x.cx || 0, y.cx || 0) ? 1 : 0, cxv: xv };
  }
  function mergeCell(x, y){
    x = x || {}; y = y || {};
    var R = mergeRt(x, y), X = mergeCx(x, y);
    var xr = x.rv || 0, yr = y.rv || 0;
    if (xr !== yr){
      var w = xr > yr ? x : y;
      return {
        s: Math.min(3, w.s || 0),
        t: w.t || 0,
        // 取消着的车不能同时又"已到"（isDoneCell 要求 car>=1，两边打架会误判已完成）
        car: X.cx ? 0 : (w.car || 0),
        ct: X.cx ? 0 : (w.ct || 0),
        cx: X.cx,
        cxv: X.cxv,
        rt: R.rt,
        rtv: R.rtv,
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
    var car = X.cx ? 0 : Math.max(x.car || 0, y.car || 0);
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
      cx: X.cx,
      cxv: X.cxv,
      rt: R.rt,
      rtv: R.rtv,
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
        if (m.s > 0 || m.car > 0 || (m.rv || 0) > 0 || (m.rt || 0) > 0 || (m.cx || 0) > 0) o[ck] = m;
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
    if (!prog[rk][ck]) prog[rk][ck] = { s: 0, t: 0, car: 0, ct: 0, u: 0, by: "", rv: 0, cx: 0, rt: 0, rtv: 0, cxv: 0 };
    if (prog[rk][ck].rv == null) prog[rk][ck].rv = 0;
    if (prog[rk][ck].cx == null) prog[rk][ck].cx = 0;
    if (prog[rk][ck].rt == null) prog[rk][ck].rt = 0;
    if (prog[rk][ck].rtv == null) prog[rk][ck].rtv = 0;
    if (prog[rk][ck].cxv == null) prog[rk][ck].cxv = 0;
    return prog[rk][ck];
  }
  /* ---- 预约货好（2026-09-18 用户要求）----------------------------------------
     cell.rt = 计划员在管理端填的「预约货好时间」（时间戳 ms，0 = 没预约）。
     ★ 到点（now >= rt）就算「货已好」，不需要任何人去点 —— 这就是
       "次日系统更新自动显示货已好"：哪怕一夜之间没人开过页面，第二天谁打开
       任何一端（内部大屏 / 门口大屏 / 内部码 / 发货进度看板）看到的都是「货好」。
     各端读的时候统一用 effS() 算"有效工序"，不要各自去比时间（会有人漏、有人写错）。
     再配合 applyReadyAuto() 把它落成真实数据（rv+1、带操作人留痕），
     这样工人手机上点"下一步"是从「货好」继续往前走，不会出现"点了没反应"。 */
  function readyAuto(c){ c = c || {}; return (c.rt || 0) > 0 && Date.now() >= (c.rt || 0); }
  function rawS(c){ return Math.min(3, (c && c.s) || 0); }
  function effS(c){
    var s = rawS(c);
    return (s < 1 && readyAuto(c)) ? 1 : s;
  }
  /* 这一格的「货好」是不是预约自动来的（管理端要标出来，别让人以为是现场点的）：
     ① 还没落库（工序还是 0 但预约时间已过）→ 算自动；
     ② 已经落库（工序 >=1，且「货好时间」正好等于「预约时间」）→ 也算自动。
     ★ ② 这条必须留着：applyReadyAuto() 把数据落成真实值之后，
       如果只看"还没落库"，页面上「到点自动」标记就会自己消失（探针实测踩到过）。 */
  function readyIsAuto(c){
    c = c || {};
    if (!((c.rt || 0) > 0)) return false;
    // 兼容两种入参：原始格子（c.s）和 progOf() 返回的视图（c.s 是"有效工序"，真实值在 rs）
    var s = (c.rs == null) ? rawS(c) : c.rs;
    if (s < 1) return Date.now() >= (c.rt || 0);
    return (c.t || 0) === (c.rt || 0);
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
  /* 车辆取消：把这一趟的「车辆」标记为取消（cx=1），大屏「车辆」栏显示红字「取消」。
     取消同时把 car 清回 0 —— 取消意味着这趟车不来了，自然也不能算「车已到」，
     否则已完成会误判（isDoneCell 要求 car>=1）。撤回取消（applyCarUncancel）时
     cx 归 0、car 留在 0（撤销后回到「未到」状态，等司机重新签到）。三端共用，rv 自增。 */
  function applyCarCancel(prog, rk, ck, who){
    var c = cellAt(prog, rk, ck), now = Date.now();
    if ((c.cx || 0) === 1 && (c.car || 0) === 0) return { changed: false, cell: c, cx: 1 };
    c.car = 0; c.ct = 0; c.cx = 1;
    c.cxv = (c.cxv || 0) + 1;      // 取消这个开关有自己的版本号（见 mergeCx）
    c.u = now;
    c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, cx: 1 };
  }
  function applyCarUncancel(prog, rk, ck, who){
    var c = cellAt(prog, rk, ck), now = Date.now();
    if ((c.cx || 0) === 0) return { changed: false, cell: c, cx: 0 };
    c.cx = 0; c.car = 0; c.ct = 0;
    c.cxv = (c.cxv || 0) + 1;
    c.u = now;
    c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, cx: 0 };
  }
  /* 标记 / 撤销「货已好」（管理端「发货进度」看板上的「是否货好」）。
     v=true  → 工序置到「货好」（只在还停在「货待确认」时才有用）；
     v=false → 退回「货待确认」，★ 同时清掉预约时间 —— 不清的话时间已经过了，
               effS() 会立刻又把它算成「货好」，看起来像"撤销不生效"。
     已经装货/完成的（s>=2）不许退回：那是现场真做过的动作，不能从管理端抹掉。 */
  function applyReady(prog, rk, ck, v, who){
    var c = cellAt(prog, rk, ck), now = Date.now(), s = rawS(c);
    if (v){
      if (s >= 1) return { changed: false, cell: c, s: s, why: "已经是货好" };
      c.s = 1; c.t = now;
      if (raw(who)) c.by = raw(who);
      c.u = now; c.rv = (c.rv || 0) + 1;
      return { changed: true, cell: c, s: 1 };
    }
    if (s !== 1) return { changed: false, cell: c, s: s, why: s < 1 ? "还没货好" : "已经装货了，不能退回货待确认" };
    c.s = 0; c.t = 0;
    if ((c.rt || 0) > 0){ c.rt = 0; c.rtv = (c.rtv || 0) + 1; }   // 清预约要带自己的版本号，否则会被别人的旧预约盖回来
    if (raw(who)) c.by = raw(who);
    c.u = now; c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, s: 0 };
  }
  /* 设置「预约货好时间」：at = 时间戳 ms（0 = 清掉预约）。
     如果填的时间已经过了，顺手就把工序置成「货好」（和到点自动变一样，不留半截状态）。 */
  function applyReadyAt(prog, rk, ck, at, who){
    var c = cellAt(prog, rk, ck), now = Date.now();
    var v = Number(at) > 0 ? Number(at) : 0;
    if ((c.rt || 0) === v) return { changed: false, cell: c, rt: v };
    c.rt = v;
    c.rtv = (c.rtv || 0) + 1;      // 预约有自己的版本号：本机 rv 落后时也不会被云端高 rv 抹掉
    if (v && v <= now && rawS(c) < 1){
      c.s = 1; c.t = v;
      if (raw(who)) c.by = raw(who);
    }
    c.u = now; c.rv = (c.rv || 0) + 1;
    return { changed: true, cell: c, rt: v };
  }
  /* 到点落库：把「预约时间已到但工序还停在货待确认」的格子批量置成「货好」。
     谁在线谁跑一次（管理端打开/轮询、内部码拉取后），推上去后其他端也就拿到真实数据了。
     返回改了几格（0 = 没有要改的，调用方就不用推云端）。 */
  function applyReadyAuto(prog, who, now){
    now = now || Date.now();
    var n = 0;
    Object.keys(prog || {}).forEach(function (rk) {
      var m = prog[rk];
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (ck) {
        var c = m[ck];
        if (!c || typeof c !== "object") return;
        if ((c.rt || 0) > 0 && now >= c.rt && rawS(c) < 1){
          c.s = 1; c.t = c.rt; c.u = now;
          c.by = raw(who) || "预约货好";
          c.rv = (c.rv || 0) + 1;
          n++;
        }
      });
    });
    return n;
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
    var map = {}, ovs = (rec && rec.custTon) || {};
    function ovNum(k){
      var v = ovs[k];
      if (v === undefined || v === null || String(v).trim() === "") return null;
      var n = parseFloat(v); return isNaN(n) ? null : n;
    }
    ((rec && rec.rows) || []).forEach(function (r) {
      var k = custKeyOf(r);
      if (!map[k]) map[k] = { key: k, customer: pad(r.customer), shipdate: pad(r.shipdate),
        logistics: raw(r.logistics), remark: raw(r.remark), ton: 0, qty: 0, nrow: 0, models: [],
        _byPt: {} };
      var g = map[k];
      var pt = raw(r.shippt), t = (parseFloat(r.ton) || 0) + (parseFloat(r.cwt) || 0);
      g._byPt[pt] = (g._byPt[pt] || 0) + t;
      g.qty += (parseFloat(r.qty) || 0);
      g.nrow++;
      var m = raw(r.model);
      if (m && g.models.indexOf(m) < 0) g.models.push(m);
    });
    return Object.keys(map).map(function (k) {
      var g = map[k];
      /* 客户吨位取数（与发货员端 custTonVal 同一口径）：
         计划员在合并格里手改过的吨位，发布那一刻被刻进 rec.custTon ——
         这种客户明细行里可能根本没有吨数（总数只写在合并格上），
         只把明细行加总会得 0，大屏吨位列就显示「/」。
         ① 三段 key 客户|日期|发货点：有覆盖值的区域用覆盖值，没有的区域仍用自动合计；
         ② 旧两段 key 客户|日期：这块客户+日期没被拆成多个发货点时才沿用（拆过不共用）；
         ③ 都没有 → 行明细自动合计。 */
      var pts = Object.keys(g._byPt), any3 = false;
      pts.forEach(function (pt) {
        var ov = ovNum(pad(g.customer) + "|" + pad(g.shipdate) + "|" + pt);
        if (ov !== null) { any3 = true; g.ton += ov; }
        else g.ton += g._byPt[pt];
      });
      if (!any3 && pts.length === 1) {
        var ov2 = ovNum(pad(g.customer) + "|" + pad(g.shipdate));
        if (ov2 !== null) g.ton = ov2;
      }
      delete g._byPt;
      return g;
    });
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
      var s = effS(c);                       // 预约到点的算「货好」，跟各端显示同一个口径
      if (s >= 3) done++;
      if ((c.car || 0) >= 1) car++;
      if (s > 0 || (c.car || 0) > 0) touched++;
      step += s;
      if ((c.u || 0) > last) last = c.u || 0;
    });
    return { total: total, done: done, car: car, step: step, last: last, touched: touched };
  }
  /* 取某一行（客户）的进度：返回的 s 是"有效工序"（预约到点的自动算「货好」），
     rs 是数据里真实的工序值 —— 管理端要靠 rs 判断"这格现在能不能撤销货好"。
     返回的是副本，随便改不会污染 PROG。 */
  function progOf(rec, ck, prog){
    var m = (prog || {})[recKeyOf(rec)];
    var c = (m && m[ck]) || {};
    return {
      s: effS(c), rs: rawS(c),
      t: c.t || 0, car: c.car || 0, ct: c.ct || 0, u: c.u || 0,
      by: raw(c.by), rv: c.rv || 0, cx: c.cx || 0, rt: c.rt || 0,
      autoReady: rawS(c) < 1 && readyAuto(c)
    };
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
        // 车辆被取消的行：即使脏数据里 car 还留着 1，也一律按「车未到」算 ——
        // 大屏显示红字「取消」，且不算完成（取消的车不可能到）。
        var cxv = c.cx ? 1 : 0;
        var carv = cxv ? 0 : (c.car || 0);
        var done = !cxv && isDoneCell(c);
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
          // 有效工序：预约货好时间一到就自动算「货好」（货已好），不需要人去点
          s: effS(c), car: carv, cx: cxv,
          t: c.t || 0, ct: c.ct || 0, u: c.u || 0, by: raw(c.by),
          rt: c.rt || 0, autoReady: readyIsAuto(c),
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
     送达方代码（保密口径的**唯一实现**：门口保密屏、司机页共用这一份）
     --------------------------------------------------------------------------
     物料库里的「送达方代码」是 2026-09-16 新增的一列，历史数据多半还没填，
     所以三级兜底：
       ① 记录行里已经刻好的 custcode（发布那一刻写在记录里，最权威）
       ② 物料库按型号匹配（一行可能带多个型号，取第一个查得到的）
       ③ 物料库按客户名匹配（型号对不上但客户没换时兜底）
     ★ 三级都查不到 → 返回 ""，**绝不回落到客户名** —— 宁可显示「未编代码」，
       也不能因为"查不到"就把客户名漏出去（保密需求的核心）。
     ========================================================================== */
  var KEY_DB = "shipping_db_v1";       // 物料库（含送达方代码）
  var NO_CODE = "未编代码";             // 查不到代码时的占位（绝不填客户名）

  /* --------------------------------------------------------------------------
     送达方代码：解析口径**只此一份**（门口大屏 / 内部大屏 / 司机扫码 / 发布 全调它）

     ★ 为什么索引要区分「唯一」和「冲突」
       送达方代码是**客户**的属性，不是型号的属性。而物料库里同一个型号常常挂在
       好几个客户名下 —— 例如「曲轴箱_BK15110020_灰铁_粗抛件」这一条型号就对应 7 个
       客户、7 个不同代码（坤胜 100158 / 荣生 100157 / 安徽美芝 100154 / …）。
       旧版 byModel 只记「第一条」，于是全库 207 个型号会把 A 客户的代码显示成 B 客户
       的 —— 门口那块保密屏跟着显示**别人的代码**，这是实打实的错。
       同理还有 1 个客户名对应两个代码（上海佳喆 100064/100065）。
       所以冲突键直接标成 null、不再参与兜底：**宁可不显示，也不显示错的**。

     ★ 取值顺序（从最准到最宽）：
       ① 客户 + 型号 同时命中   （库里 3580 个组合**全部唯一**，最准）
       ② 只按客户名             （164 个客户里仅 1 个有冲突，冲突的自动跳过）
       ③ 客户名的**写法变体**   （行名是库名的另一种写法时，见 aliasName 的说明）
       ④ 记录里发布时刻刻好的那份（这台机器没同步过物料库时的兜底；也是老单据的原样）
       ⑤ 只按型号 —— 且该行所有型号在库里**只能指向同一个客户**才敢用
          （旧版是「单个型号在库里唯一就命中」，会闯祸：一行里只要有一个型号属于
            别的客户，就把**别人的代码**安到这行上。2026-09-17 现场实拍抓到的就是它：
            「宁波泰友（宁波甬微进仓）」的 3 个型号因两种写法冲突、兜不住，
            于是拿第 4 个型号「密封盖_D265270511」命中宁波优艾希杰 → 显示了 100081）
       ⑥ 都没有 → 返回空，调用方显示「未编代码」（**绝不回落客户名**，保密底线）
       ★ ①②③ 排在④前面：送达方代码的真源是物料库，库里命中就用库的 ——
         历史上有 11 行是按旧规则("型号第一条")刻错的老数据，库优先才能自动纠正。
     -------------------------------------------------------------------------- */
  var CODE_PAIR = "\u0001";        // 客户名 与 型号 的连接符（正常数据里不会出现）

  /* --------------------------------------------------------------------------
     客户名的「写法变体」匹配（**取代码 / 取物流共用这一份实现**）
     --------------------------------------------------------------------------
     ★ 为什么需要它：计划员在计划表里录的名字、和物料库里的名字，经常不是同一种写法。
         行名（现场录的）            物料库里的名字          实际是同一个客户
         ─────────────────────────┼───────────────────────┼──────────────
         宁波泰友（宁波甬微进仓）     宁波甬微-宁波泰友        100175
         广州博世舒适科技有限公司     广州博世                100132
         太仓舍弗勒专车              太仓舍弗勒              100049
         浙江百达精工股份有限公司     浙江百达                100011
       库里的名字常常是「别名拼起来」的（用 - 或括号分段），行名可能是全称 + 括注。
       不做这层对齐的后果：明明库里有这个客户，却查不到 → 白白显示「未编代码」，
       或者更糟 —— 掉进型号兜底，把别的客户的代码显示出来。
     ★ 规则（四条必须同时满足，缺一不用 —— 宁可不显示，也不显示错的）：
       ① 库名拆段后**每一段**都要能在行名里找到（行名的某一段包含它或与它相等）
       ② 反之行名的**每一段**也要能被库名解释（它包含库名的某一段）
          —— 堵住「上海旺巷桥（南京信昌）」「芜湖海立新能源（昆山衍咏提货）」
             这种一行点两个客户的名字
       ③ 对上的段里至少有一段 **≥4 个字**
          —— 堵住 3 字短名横扫：库里「旺巷桥」是 100042、「上海旺巷桥国际贸易有限公司」
             是 100062，两个码；放 3 字短名进来会把行名"吸"到错的那条上
       ④ 候选**唯一**才用；有并列 → 返回空，交回上层继续往下兜底
     ========================================================================== */
  var SEG_SPLIT = /[（）()\[\]【】\-\/\u3001,\uff0c;\uff1b\s]+/;   // 括号/横杠/斜杠/顿号/逗号/空格 = 分段符

  function nameSegs(name){                             // 拆段：单字段没有区分度，丢掉
    return String(name == null ? "" : name).split(SEG_SPLIT)
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length >= 2; });
  }
  /* 行名 → 物料库里的那个客户名；对不上或有并列 → 返回 ""（继续往下兜底） */
  function aliasName(rowName, names){
    var rs = nameSegs(rowName);
    if (!rs.length || !names || !names.length) return "";
    var hit = "", n = 0, i, j, k;
    for (i = 0; i < names.length; i++){
      var name = names[i], ns = nameSegs(name);
      if (!ns.length) continue;
      var strong = false, ok = true;
      for (j = 0; j < ns.length && ok; j++){           // ① 库名的每一段都要出现在行名里
        var seg = ns[j], found = false;
        for (k = 0; k < rs.length; k++){ if (rs[k] === seg || rs[k].indexOf(seg) >= 0) { found = true; break; } }
        if (!found) ok = false;
        else if (seg.length >= 4) strong = true;       // ③ 至少一段 >=4 字
      }
      if (!ok || !strong) continue;
      for (j = 0; j < rs.length && ok; j++){           // ② 行名的每一段都要能被库名解释
        var rseg = rs[j], ex = false;
        for (k = 0; k < ns.length; k++){ if (rseg === ns[k] || rseg.indexOf(ns[k]) >= 0) { ex = true; break; } }
        if (!ex) ok = false;
      }
      if (!ok) continue;
      if (++n > 1) return "";                          // ④ 并列 → 不猜
      hit = name;
    }
    return n === 1 ? hit : "";
  }

  function codeIndex(db){
    var byPair = {}, byCust = {}, byModel = {}, byModelCust = {}, names = [];
    var seen = {};
    var put = function (o, k, cc) {
      if (!k) return;
      if (o[k] === undefined) o[k] = cc;
      else if (o[k] !== cc) o[k] = null;               // 同一个键出现两种代码 → 标冲突
    };
    (db || []).forEach(function (r) {
      if (!r) return;
      var cc = String(r.custcode || "").trim();
      if (!cc) return;                                 // 没填代码的记录不进索引
      var c = String(r.customer || "").trim().toLowerCase();
      var m = String(r.model || "").trim().toLowerCase();
      if (c && m) put(byPair, c + CODE_PAIR + m, cc);
      put(byCust, c, cc);
      put(byModel, m, cc);
      if (c && m){                                     // 型号 → 它挂在哪些客户名下
        (byModelCust[m] = byModelCust[m] || {})[c] = 1;
      }
      if (c && !seen[c]){ seen[c] = 1; names.push(String(r.customer || "").trim()); }
    });
    return { byPair: byPair, byCust: byCust, byModel: byModel, byModelCust: byModelCust, names: names };
  }

  function codeOf(row, idx){
    if (!row) return "";
    idx = idx || {};
    var byPair = idx.byPair || {}, byCust = idx.byCust || {}, byModelCust = idx.byModelCust || {};
    var ms = row.models || [];
    var cu = custBase(row.customer);              // 第二车也按原客户名认（后缀在这里剥掉）
    var key = cu.toLowerCase();
    var i, m, cc;

    for (i = 0; i < ms.length; i++){                   // ① 客户 + 型号
      m = String(ms[i] || "").trim().toLowerCase();
      if (!m) continue;
      cc = byPair[key + CODE_PAIR + m];
      if (cc) return cc;
    }
    cc = byCust[key];                                  // ② 只按客户名
    if (cc) return cc;

    var alias = aliasName(cu, idx.names);               // ③ 客户名的写法变体
    if (alias) { cc = byCust[alias.toLowerCase()]; if (cc) return cc; }

    var src = (row.rec && row.rec.rows) || [];          // ④ 记录自带那份（发布时刻的）
    for (i = 0; i < src.length; i++){
      var x = src[i];
      if (!x) continue;
      if (custBase(x.customer) !== cu) continue;    // 记录自带那份按基名比 → 第二车也能取到代码
      cc = String(x.custcode || "").trim();
      if (cc) return cc;
    }
    var cand = {}, any = false;                         // ⑤ 只按型号（且该行型号只指向一个客户）
    for (i = 0; i < ms.length; i++){
      m = String(ms[i] || "").trim().toLowerCase();
      if (!m) continue;
      var o = byModelCust[m];
      if (!o) continue;
      any = true;
      Object.keys(o).forEach(function (c) { cand[c] = 1; });
    }
    var ks = any ? Object.keys(cand) : [];
    if (ks.length === 1) { cc = byCust[ks[0]]; if (cc) return cc; }
    return "";
  }

  /* 行上要显示的那串字：查得到显示代码，查不到显示「未编代码」占位。
     ★ 这个函数存在的意义就是**堵住"顺手回落客户名"这条路** ——
       渲染方一律调它，不要自己去拼 row.customer。 */
  function codeText(row, idx){
    return codeOf(row, idx) || NO_CODE;
  }

  /* --------------------------------------------------------------------------
     「按客户反查物流」——口径也只此一份（管理端发布兜底 / 内部看板 都调它）

     客户 → 该客户在物料库里**出现次数最多**的那个物流值。
     ★ 为什么不取「第一条有值的」：同一客户在库里可能几十条、偶尔混进写法不同的
       物流，按"第一条"会随库顺序跳（今天旺成、明天贝业）；众数才是稳定口径。
       并列时保留先出现的那个（用 > 而不是 >=）。
     ★ 不做缓存：物料库随时可能变（物料库页面改完、云端同步回来），
       缓存键很容易失效或读到旧库；一次全库扫描对 3000 多条的库只是毫秒级。
     -------------------------------------------------------------------------- */
  function logisticsIndex(db){
    var tally = {}, names = [], seen = {}, modelCust = {}, mseen = {};
    (db || []).forEach(function (r) {
      if (!r) return;
      var raw = String(r.customer || "").trim();
      var c = raw.toLowerCase();
      var lg = String(r.logistics || "").trim();
      var m = String(r.model || "").trim().toLowerCase();
      if (c && m && !(mseen[m] && mseen[m][c])) {
        (modelCust[m] = modelCust[m] || {})[c] = 1;
        (mseen[m] = mseen[m] || {})[c] = 1;
      }
      if (!c || !lg) return;
      var k = c + CODE_PAIR + lg;
      tally[k] = (tally[k] || 0) + 1;
      if (!seen[c]) { seen[c] = 1; names.push(raw); }
    });
    var best = {};
    Object.keys(tally).forEach(function (k) {
      var i = k.lastIndexOf(CODE_PAIR), c = k.slice(0, i), lg = k.slice(i + 1);
      if (!best[c] || tally[k] > tally[c + CODE_PAIR + best[c]]) best[c] = lg;
    });
    /* ★ 把库里的客户名清单 + 「型号 → 客户」关系挂在索引上（不可枚举：不污染
       Object.keys / JSON.stringify）：
       · __names     —— 物流也要认「写法变体」，否则「宁波泰友（宁波甬微进仓）」
                        明明库里有贝业，屏上却是空的（客户名对不上的老毛病）。
       · __modelCust —— 代码能靠「型号唯一指向的客户」认出来，物流就该跟着认，
                        否则屏上会出现「有代码、没物流」的半截行
                        （安徽海立精密铸造有限公司上海分公司 / 丹佛斯（天津）有限公司…）。 */
    if (Object.defineProperty) {
      try {
        Object.defineProperty(best, "__names", { value: names, enumerable: false });
        Object.defineProperty(best, "__modelCust", { value: modelCust, enumerable: false });
      } catch (e) {}
    }
    return best;
  }
  function logisticsOf(cust, idx){
    if (!idx) return "";
    var base = custBase(cust);                                       // 「（第二车）」先剥掉再查
    var c = base.toLowerCase();
    if (idx[c]) return idx[c];
    var alias = aliasName(base, idx.__names);                        // 写法变体 → 认同一个客户
    return alias ? (idx[alias.toLowerCase()] || "") : "";
  }
  /* 整行版：和 codeOf 用同一个「认人」结果 —— 客户名直接对上 → 写法变体 →
     该行型号在库里只指向一个客户（代码就是靠这条认出来的）。认不出 → "" */
  function logisticsOfRow(row, idx){
    if (!row || !idx) return "";
    var cu = custBase(row.customer);                                 // 同上：第二车按原客户名认物流
    if (idx[cu.toLowerCase()]) return idx[cu.toLowerCase()];
    var alias = aliasName(cu, idx.__names);
    if (alias && idx[alias.toLowerCase()]) return idx[alias.toLowerCase()];
    var mc = idx.__modelCust || {}, cand = {}, any = false, i;
    var ms = row.models || [];
    for (i = 0; i < ms.length; i++){
      var m = String(ms[i] || "").trim().toLowerCase();
      if (!m || !mc[m]) continue;
      any = true;
      Object.keys(mc[m]).forEach(function (x) { cand[x] = 1; });
    }
    var ks = any ? Object.keys(cand) : [];
    if (ks.length === 1) return idx[ks[0]] || "";
    return "";
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
     内部人员登录（姓名 + 口令）
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
  /* 名册版本号（staff-config.js 里的 ver）。
     ★ 只要改过名单或口令，就把 ver 换成一个新值 —— 所有手机上那份"记住了 30 天"的
       旧会话当场作废，必须重新用名单里的姓名登录。这就是"登录重置"。 */
  function staffVer(){ return String(staffConf().ver || ""); }
  /* 会话签名字：把 姓名 + 过期时间 + 名册版本 一起搅进哈希。
     有人手动往 localStorage 里塞一个假会话（比如把 exp 改成 2099 年），
     签名字对不上，一样进不来。 */
  function staffToken(id, exp){ return sha256Hex(staffSalt() + ":" + String(id) + ":" + String(exp) + ":" + staffVer() + ":sess"); }
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
    if (!staffVer()) return { ok: false, msg: "账号表缺少版本号 ver，请找管理员更新 staff-config.js" };
    var u = staffFind(id);
    if (!u) return { ok: false, msg: "账号不存在（姓名不在内部名单里）" };
    if (staffHash(pwd) !== String(u.h || "").trim().toLowerCase()) return { ok: false, msg: "口令不对" };
    var days = Number(staffConf().days) > 0 ? Number(staffConf().days) : 30;
    var idn = String(u.id || u.name || ""), exp = Date.now() + days * 86400000;
    var ses = { id: idn, name: String(u.name || u.id || ""), exp: exp, v: staffVer(), tok: staffToken(idn, exp) };
    try { localStorage.setItem(KEY_STAFF, JSON.stringify(ses)); } catch (e){}
    return { ok: true, session: ses };
  }
  /* 读会话：下面每一条不过关就当场删掉，回到登录页 —— 绝不留着一个"半有效"的会话。
     ① 过期              → 删
     ② 名册版本对不上    → 删（名单/口令重置过，必须重新登录）
     ③ 姓名已不在名单里  → 删（比如人已离职被从 staff-config.js 里去掉）
     ④ 签名字对不上      → 删（手动伪造的会话）                                        */
  function staffSession(){
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY_STAFF) || "null"); } catch (e){ return null; }
    if (!s || typeof s !== "object") return null;
    var kill = function(){ try { localStorage.removeItem(KEY_STAFF); } catch (e){} return null; };
    if (!s.id) return kill();
    if (!(Number(s.exp) > Date.now())) return kill();
    if (String(s.v || "") !== staffVer()) return kill();
    var u = staffFind(s.id);
    if (!u) return kill();
    if (String(s.tok || "") !== staffToken(u.id || u.name, s.exp)) return kill();
    /* 姓名以名册为准（名册改了显示名，这里立刻跟着变） */
    return { id: String(u.id || u.name || ""), name: String(u.name || u.id || ""), exp: Number(s.exp), v: s.v, tok: s.tok };
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

  /* px = 要生成的像素边长（默认 240，够屏幕上看）。
     ★ 打印要传大尺寸：192mm 宽印到 300dpi 的纸上 ≈ 2268px，
       源图只有 240px 的话是靠拉伸糊上去的，模块边缘一糊就有扫不出来的风险。
       传 1200px 时每个模块仍是整数像素、边缘干净。 */
  async function qrDataUrl(text, px){
    var okLib = await ensureQRCode();
    if (!okLib) return null;
    var cv = makeQrInto(null, text, px || 240);
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
       ② 司机签到码 → 司机扫码.html    司机只能勾「车已到」和撤回
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
    '.smk2-lay{display:flex;align-items:center;gap:4px;font-size:13px;color:#374151;white-space:nowrap;}' +
    '.smk2-lay select{font-size:13px;padding:6px 6px;border:1px solid #d0d7de;border-radius:5px;font-family:inherit;background:#fff;}' +
    '@media(max-width:560px){.smk2-cards{flex-direction:column;}.smk2-card canvas{width:170px;height:170px;}' +
    '.smk2-act{flex-wrap:wrap;}.smk2-lay{order:3;flex-basis:100%;justify-content:center;}}';

  function codesCss(){
    if (document.getElementById("smk2Css")) return;
    var st = document.createElement("style");
    st.id = "smk2Css";
    st.textContent = CODES_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function codeDefs(){
    return [
      { title: "内部人员码", desc: "要登录（姓名+口令）。推进「待确认 / 货好 / 装货中 / 已完成」四道工序。", url: pageUrl(SCAN_PAGE), page: SCAN_PAGE },
      { title: "司机签到码", desc: "不用登录。请司机师傅根据自己的信息，找到对应的送达方代码，点击「车已到」完成签到（点错可撤回）。", url: pageUrl(DRIVER_PAGE), page: DRIVER_PAGE }
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
        '<div class="smk2-act">' +
        '<label class="smk2-lay">版式 <select id="smk2Lay">' +
        '<option value="big">海报纸·1张/页</option>' +
        '<option value="small8">小码·8张/A4</option></select></label>' +
        '<button type="button" class="pri" id="smk2Print0">🖨 打印内部码</button>' +
        '<button type="button" class="pri" id="smk2Print1">🖨 打印司机码</button>' +
        '<button type="button" id="smk2Close">关闭</button></div></div>';
      document.body.appendChild(m);
      m.addEventListener("click", function (e) { if (e.target === m) m.style.display = "none"; });
      document.getElementById("smk2Close").onclick = function () { m.style.display = "none"; };
      var laySel = document.getElementById("smk2Lay");
      function curLay(){ return laySel ? laySel.value : "big"; }
      /* 两张码「分别打印」：点哪个按钮只印那一张；版式下拉决定印大码海报纸还是一页八张小码 */
      document.getElementById("smk2Print0").onclick = function () { printCodes(defs[0], curLay()); };
      document.getElementById("smk2Print1").onclick = function () { printCodes(defs[1], curLay()); };
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
        '<div class="u">' + esc(prettyUrl(d.url)) + "</div></div>";
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

  /* 打印「两张码」的张贴页（2026-09-17 用户要求：A4 全屏、居中，一张纸一个码，共 2 页）。
     改写前是一张纸上并排两个 60mm 的小码；现在每张码独占整页、放到 192mm（≈3.2 倍大），
     门口贴出去隔着远也能扫。
     ★ 两个容易翻车的点：
       ① 分页用「.pg + .pg{page-break-before:always}」而不是给每张加 page-break-after ——
          后者会在最后多印一张空白页（用户拿到手第一反应是"打印机坏了"）。
       ② 二维码源图必须给大尺寸（PRINT_QR_PX），240px 拉到 192mm 只有 32dpi，糊边会扫不出来。 */
  var PRINT_QR_PX = 1200;      // 源图像素边长：192mm @300dpi ≈ 2268px，1200px 已足够清晰且体积可控

  /* 打印页底部那行网址：纸上是给人看/手输的，别把中文文件名的 %E6%89%AB%E7%A0%81
     这种编码甩上去（根本没法抄）。解不回来就原样退回，不因为一行字把整张纸搞崩。 */
  function prettyUrl(u){
    try { return decodeURIComponent(String(u)); } catch (e){ return String(u); }
  }

  function printCodes(def, layout){
    if (!def) return;
    var w = window.open("", "_blank");
    if (!w){ alert("打印窗口被浏览器拦住了，请允许本站弹出窗口后重试。"); return; }
    ensureQRCode().then(function (okLib) {
      var px = (layout === "small8") ? 800 : PRINT_QR_PX;
      var img = okLib ? qrDataUrl(def.url, px) : null;
      var html = (layout === "small8")
        ? codesSheetHtml(def, img, 8, "小码·8张/A4")
        : codesPageHtml(def, img);
      w.document.write(html); w.document.close(); w.focus();
    });
  }

  /* 大海报版式：一张 A4 只放一个码，放大到 192mm，门口隔远也能扫。
     分页用「.pg+.pg{page-break-before}」而不是给每张加 page-break-after ——
     后者会在最后多印一张空白页。 */
  function codesPageHtml(def, img){
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<title>' + esc(def.title) + '（A4 一页一张）</title>' +
      '<style>@page{size:A4;margin:6mm;}' +
      'html,body{margin:0;padding:0;background:#fff;}' +
      'body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#111;}' +
      '.pg{height:282mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}' +
      '.pg h2{font-size:34px;font-weight:800;margin:0 0 7mm;letter-spacing:3px;}' +
      '.pg .d{font-size:17px;color:#333;margin:0 0 6mm;line-height:1.55;max-width:172mm;}' +
      '.pg img{width:192mm;height:192mm;display:block;image-rendering:pixelated;}' +
      '.pg .bad{width:192mm;height:192mm;line-height:192mm;color:#c00;font-size:18px;}' +
      '.pg .u{font-size:12px;color:#666;margin-top:6mm;word-break:break-all;line-height:1.5;}' +
      '@media print{.pg{page-break-inside:avoid;}}</style></head><body>' +
      '<div class="pg"><h2>' + esc(def.title) + '</h2><p class="d">' + esc(def.desc) + '</p>' +
      (img ? '<img src="' + img + '">' : '<div class="bad">二维码没生成出来</div>') +
      '<div class="u">' + esc(prettyUrl(def.url)) + '</div></div>' +
      '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},400);};</scr' + 'ipt></body></html>';
  }

  /* 小码版式：一张 A4 切成 N 张小标签（默认 8 张，2 列 × 4 行），每张都印同一个码，
     印出来裁开就能一张张贴。二维码用 800px 源图，缩到 62mm 仍清晰好扫。 */
  function codesSheetHtml(def, img, n, label){
    var cell = '<div class="cell">' +
      (img ? '<img src="' + img + '">' : '<div class="noqr">二维码未生成</div>') +
      '<div class="t">' + esc(def.title) + '</div>' +
      '<div class="u">' + esc(prettyUrl(def.url)) + '</div></div>';
    var cells = "", i;
    for (i = 0; i < n; i++) cells += cell;
    var cols = 2, rows = Math.ceil(n / cols);
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<title>' + esc(def.title) + '（' + esc(label || (n + "张/A4")) + '）</title>' +
      '<style>@page{size:A4;margin:5mm;}' +
      'html,body{margin:0;padding:0;background:#fff;}' +
      'body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#111;}' +
      '.sheet{width:200mm;height:287mm;display:grid;grid-template-columns:1fr 1fr;' +
      'grid-template-rows:repeat(' + rows + ',1fr);}' +
      '.cell{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'border:1px dashed #cbd5e1;box-sizing:border-box;padding:2mm;}' +
      '.cell img{width:62mm;height:62mm;display:block;image-rendering:pixelated;}' +
      '.cell .noqr{width:62mm;height:62mm;line-height:62mm;text-align:center;color:#c00;font-size:13px;}' +
      '.cell .t{font-size:14px;font-weight:800;margin-top:3mm;color:#111;}' +
      '.cell .u{font-size:7.5px;color:#888;margin-top:2mm;word-break:break-all;max-width:92mm;line-height:1.4;}' +
      '@media print{.cell{page-break-inside:avoid;}}</style></head><body>' +
      '<div class="sheet">' + cells + '</div>' +
      '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},400);};</scr' + 'ipt></body></html>';
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
    KEY_DB: KEY_DB, NO_CODE: NO_CODE, codeIndex: codeIndex, codeOf: codeOf, codeText: codeText,
    logisticsIndex: logisticsIndex, logisticsOf: logisticsOf, logisticsOfRow: logisticsOfRow,
    aliasName: aliasName, nameSegs: nameSegs,
    carNoOf: carNoOf, custBase: custBase, custWithCar: custWithCar, carLabel: carLabel,
    SCAN_PAGE: SCAN_PAGE, DRIVER_PAGE: DRIVER_PAGE, DASH_PAGE: DASH_PAGE,
    PUB_BASE: PUB_BASE, STEP_NAME: STEP_NAME, CAR_NAME: CAR_NAME,
    pad: pad, raw: raw, esc: esc, escAttr: escAttr, fmtHM: fmtHM,
    recKeyOf: recKeyOf, custKeyOf: custKeyOf, recShipDate: recShipDate,
    scanUrl: scanUrl, pageUrl: pageUrl,
    mergeCell: mergeCell, mergeProg: mergeProg, parseObj: parseObj, guardFn: guardFn,
    cellAt: cellAt, applyStep: applyStep, applyCar: applyCar, applyUndo: applyUndo,
    applyCarCancel: applyCarCancel, applyCarUncancel: applyCarUncancel,
    applyReady: applyReady, applyReadyAt: applyReadyAt, applyReadyAuto: applyReadyAuto,
    effS: effS, rawS: rawS, readyAuto: readyAuto, readyIsAuto: readyIsAuto,    custGroups: custGroups, progStats: progStats, progOf: progOf,
    p2: p2, ymdOf: ymdOf, todayYmd: todayYmd, shiftYmd: shiftYmd, normDate: normDate,
    isDoneCell: isDoneCell, boardRows: boardRows, boardStats: boardStats, groupByLogistics: groupByLogistics,
    sha256Hex: sha256Hex,
    KEY_STAFF: KEY_STAFF, staffUsers: staffUsers, staffLogin: staffLogin, staffSession: staffSession,
    staffLogout: staffLogout, staffName: staffName, staffVer: staffVer, staffFind: staffFind, staffHash: staffHash,
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
