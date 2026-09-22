/* brand.js — 全站品牌角标（HIGHLY 海立 logo）统一注入
 * 放置策略（按页面布局自动选择，绝不压住按钮/数据）：
 *  - 物流大屏 / 物流门口大屏 / 仪表盘：logo 进顶部 HUD 最右角，HUD 原内容整体左移让位
 *  - 发货计划系统 / index / 生产管理客户端：放进顶部导航栏最右侧
 *  - 扫码 / 司机扫码：放进深色顶栏第一行最右侧
 *  - viewer（发货员端）：放进顶部标题栏最右侧
 *  - 其余页面：固定右上角白色小圆标
 * 各模块 logo 高度按页面对比度/范围挑最合适的值（见 SIZE）。
 */
(function () {
  "use strict";
  var SRC = "logo.png?v=1";
  var page = "";
  try { page = decodeURIComponent(location.pathname.split("/").pop() || ""); }
  catch (e) { page = location.pathname.split("/").pop() || ""; }

  // 各模块 logo 高度（px），按页面范围挑最合适的
  var SIZE = {
    "物流大屏.html": 30, "物流门口大屏.html": 30, "仪表盘.html": 30,
    "发货计划系统.html": 22, "index.html": 22, "生产管理客户端.html": 22,
    "扫码.html": 20, "司机扫码.html": 20, "viewer.html": 20,
    "_default": 22
  };
  var H = SIZE[page] || SIZE._default;

  function mk() {
    var d = document.createElement("div");
    d.className = "brandLogo";
    d.setAttribute("style", "display:inline-flex;align-items:center;flex:0 0 auto;pointer-events:none;" +
      "background:rgba(255,255,255,.93);border:1px solid rgba(15,23,42,.12);border-radius:8px;" +
      "padding:4px 9px;box-shadow:0 2px 8px rgba(15,23,42,.18);");
    var img = document.createElement("img");
    img.src = SRC;
    img.alt = "HIGHLY 海立";
    img.setAttribute("style", "height:" + H + "px;width:auto;display:block;");
    d.appendChild(img);
    return d;
  }

  function appendLast(sel, ml) {
    var el = document.querySelector(sel);
    if (!el) return false;
    var b = mk();
    if (ml) b.setAttribute("style", b.getAttribute("style") + "margin-left:" + ml + ";");
    el.appendChild(b);
    return true;
  }

  function fixed(pos) {
    var b = mk();
    b.setAttribute("style", b.getAttribute("style") + "position:fixed;z-index:99990;pointer-events:none;" + pos);
    (document.body || document.documentElement).appendChild(b);
  }

  try {
    if (page === "物流大屏.html" || page === "物流门口大屏.html" || page === "仪表盘.html") {
      // 大屏：logo 进顶部 HUD 最右角，原有 HUD 内容整体左移让位
      if (appendLast(".hud", "14px")) return;
    }
    if (page === "扫码.html" || page === "司机扫码.html") { if (appendLast(".hd .r1", "10px")) return; }
    else if (page === "viewer.html") { if (appendLast("header.top", "12px")) return; }
    else if (page === "发货计划系统.html" || page === "index.html" || page === "生产管理客户端.html") {
      if (appendLast("#appbar") || appendLast(".appbar")) return;
    }
    fixed("right:12px;top:8px;");
  } catch (e) { /* 角标注入失败不影响页面功能 */ }
})();
