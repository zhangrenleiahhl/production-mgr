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
  var PUB_BASE    = "https://zhangrenleiahhl.github.io/production-mgr/";
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

  /* ---- 扫码页地址：二维码里放的就是它。固定用线上地址，
         因为现场手机扫的必须是一个能打开的网址，不能是别人电脑上的 file:// 路径 ---- */
  function scanUrl(recKey){ return PUB_BASE + encodeURIComponent(SCAN_PAGE) + "?d=" + encodeURIComponent(String(recKey)); }

  /* ---- 合并：只增不减 ---- */
  function mergeCell(x, y){
    x = x || {}; y = y || {};
    var xs = x.s || 0, ys = y.s || 0, s = Math.max(xs, ys);
    function pick(ax, ay, bx, by){
      if (ax > ay) return bx || 0;
      if (ay > ax) return by || 0;
      var a = [bx, by].filter(function (v) { return v > 0; });
      return a.length ? Math.min.apply(null, a) : 0;
    }
    var car = Math.max(x.car || 0, y.car || 0);
    var us = [x.u, y.u].filter(function (v) { return v > 0; });
    return {
      s: s,
      t: s > 0 ? pick(xs, ys, x.t, y.t) : 0,
      car: car,
      ct: car > 0 ? pick(x.car || 0, y.car || 0, x.ct, y.ct) : 0,
      u: us.length ? Math.max.apply(null, us) : 0
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
        if (m.s > 0 || m.car > 0) o[ck] = m;
      });
      if (Object.keys(o).length) out[rk] = o;
    });
    return out;
  }
  function parseObj(s){
    try { var v = JSON.parse(s || "{}"); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; } catch (e){ return {}; }
  }
  // 直接交给 CloudSync.guard(KEY_PROG, ...) 用：引擎在 push 前先跟云端合并，
  // 合并规则就是上面这条「只增不减」。
  function guardFn(localStr, cloudStr){ return JSON.stringify(mergeProg(parseObj(localStr), parseObj(cloudStr))); }

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
    return (m && m[ck]) || { s: 0, t: 0, car: 0, ct: 0, u: 0 };
  }

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

  return {
    KEY_PLANS: KEY_PLANS, KEY_PROG: KEY_PROG, KEY_DEL: KEY_DEL, KEY_PENDING: KEY_PENDING,
    SCAN_PAGE: SCAN_PAGE, PUB_BASE: PUB_BASE, STEP_NAME: STEP_NAME, CAR_NAME: CAR_NAME,
    pad: pad, raw: raw, esc: esc, escAttr: escAttr, fmtHM: fmtHM,
    recKeyOf: recKeyOf, custKeyOf: custKeyOf, recShipDate: recShipDate, scanUrl: scanUrl,
    mergeCell: mergeCell, mergeProg: mergeProg, parseObj: parseObj, guardFn: guardFn,
    custGroups: custGroups, progStats: progStats, progOf: progOf,
    progPill: function (s, car) {
      s = Math.min(3, s || 0);
      var cls = s >= 3 ? "p-done" : (s >= 2 ? "p-mid" : (s === 1 ? "p-ok" : "p-wait"));
      return '<span class="p-pill ' + cls + '">' + STEP_NAME[s] + (car ? " · 车已到" : "") + "</span>";
    },
    ensureQRCode: ensureQRCode, qrDataUrl: qrDataUrl, openQrModal: openQrModal,
    qrModuleCount: qrModuleCount, makeQrInto: makeQrInto
  };
})();
