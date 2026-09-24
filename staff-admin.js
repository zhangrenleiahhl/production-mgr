/* ==========================================================================
   全局悬浮控件（登录后注入）
   --------------------------------------------------------------------------
   每个内部页在 Auth.guard() 之后引这一句即可获得：
     · 「👋 欢迎 XXX」 —— 页面里设了 window.STAFF_WELCOME = 1 才显示，
       显示当前登录的是谁（手机号 → staff-config.js 名册里的中文姓名，名册里没这个号就退回手机号）。
     · 「退出」按钮 —— 所有已登录的人都能看到、都能点（清会话回登录页）。
     · 「👥 账号管理」按钮 —— 只有管理员（staff-config.js 的 adminPhone）登录后才出现，
       点开看所有人的手机号 + 密码（详见 账号管理.html）。
   用悬浮 fixed 定位，不依赖各页顶栏结构，避免改 9 个页面的 HTML 骨架。
   ========================================================================== */
(function () {
  var ADMIN = (window.STAFF && window.STAFF.adminPhone) || "16655052098";
  function curPhone() {
    try {
      var s = (window.Auth && Auth.getSession && Auth.getSession()) || null;
      if (!s || !s.email) return "";
      return String(s.email).split("@")[0];
    } catch (e) { return ""; }
  }
  /* 当前登录人显示名（给「欢迎 XXX」用）
     ① 手机号在名册（staff-config.js）里 → 用中文姓名
        ★ 姓名一律以名册为准：Supabase 账号的 user_metadata 里**没有**中文姓名；
     ② 名册里没这个号（或页面没加载名册）→ 用登录会话里的名字（只要它不是手机号本身）；
     ③ 都没有 → 退回手机号 —— 绝不显示空白。 */
  function nameOfPhone(phone) {
    phone = String(phone || "");
    if (!phone) return "";
    var list = (window.STAFF && Array.isArray(window.STAFF.users)) ? window.STAFF.users : [];
    for (var i = 0; i < list.length; i++) {
      var u = list[i] || {};
      if (String(u.phone || "") === phone) return String(u.name || u.id || phone);
    }
    try {
      var s = (window.Auth && Auth.getSession && Auth.getSession()) || null;
      if (s && s.name && String(s.name) !== phone) return String(s.name);
    } catch (e) {}
    return phone;
  }

  // 暴露纯函数，方便测试（jsdom 下不自动注入，但函数可用）
  window.StaffAdmin = {
    adminPhone: ADMIN,
    isAdmin: function (phone) { return !!phone && phone === ADMIN; },
    nameOfPhone: nameOfPhone,
    mount: function () {
      if (!document.body) return;
      if (window.__staffAdminMounted) return;
      var phone = curPhone();
      if (!phone) return;                       // 没登录（guard 早跳走了）
      window.__staffAdminMounted = true;

      var bar = document.createElement("div");
      bar.id = "staffAdminBar";
      bar.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:9999;display:flex;gap:8px;align-items:center;";
      var isAdmin = window.StaffAdmin.isAdmin(phone);

      // 欢迎当前账号（只有页面显式设了 window.STAFF_WELCOME=1 才显示）
      if (window.STAFF_WELCOME) {
        var hi = document.createElement("span");
        hi.id = "staffWelcome";
        hi.textContent = "👋 欢迎 " + (nameOfPhone(phone) || phone);
        hi.title = "当前登录账号：" + phone;
        hi.style.cssText = "height:38px;display:inline-flex;align-items:center;padding:0 16px;" +
          "border:1px solid #d7e0ee;background:#fff;color:#1f2d3d;border-radius:999px;" +
          "font-size:14px;font-weight:700;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.10);";
        bar.appendChild(hi);
      }

      // 退出（所有人）
      var out = document.createElement("button");
      out.type = "button";
      out.textContent = "退出登录";
      out.style.cssText = "height:38px;padding:0 16px;border:1px solid #fca5a5;background:#fff;color:#dc2626;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.12);";
      out.onclick = function () {
        var ok = window.confirm ? true : true;
        if (window.confirm && !window.confirm("退出登录？下次要重新输手机号和密码。")) return;
        try { if (window.flushDraft) window.flushDraft(); } catch (e) {}
        try { if (window.Auth && Auth.logout) Auth.logout(); } catch (e) {}
        try { if (window.SL && SL.staffLogout) SL.staffLogout(); } catch (e) {}
        location.href = "login.html";
      };
      bar.appendChild(out);

      // 账号管理（仅管理员）
      if (isAdmin) {
        var adm = document.createElement("button");
        adm.type = "button";
        adm.textContent = "👥 账号管理";
        adm.style.cssText = "height:38px;padding:0 16px;border:none;background:#1f6feb;color:#fff;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(31,111,235,.35);";
        adm.onclick = function () { location.href = "账号管理.html"; };
        bar.appendChild(adm);
      }
      document.body.appendChild(bar);
    }
  };

  // jsdom 环境下不自动注入（测试手动调 mount），真实浏览器才注入
  if (/jsdom/i.test(navigator.userAgent || "")) return;
  function start() { window.StaffAdmin.mount(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
