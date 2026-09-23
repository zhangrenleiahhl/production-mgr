/* ==========================================================================
   铸运通 · 统一账号登录（接 Supabase Auth）
   --------------------------------------------------------------------------
   复用现有 supabase 客户端（window.supabase + CLOUD_CONFIG），不新增任何密钥。
   账号标识：内部人员用「手机号」登录，系统自动补 @neibu.local 当邮箱去对接
            Supabase Auth（这样不必配置短信网关，零成本）。
   ⚠ 域名这件事有两个坑，都实测过（2026-09-23）——别再改错：
     · **后台手动建的账号**（Authentication → Users → Add user）用 @neibu.local
       完全正常，登录/签发 token 都没问题；现网十几个人全建在这个域名下。
     · **API 自助注册**（signUp）只认带真实顶级域的写法，@neibu.local 会被判
       email_address_invalid。所以注册用 @neibu.fhjd.com。
   → 登录按「上次成功的域名」优先、两个域名依次尝试，账号建在哪边都能登。

   全站门禁：window.LOGIN_REQUIRED = true 时，未登录的页面会跳登录页。
            = false（关闭，默认）—— 各页面已接上 Auth.guard()，建好账号后跟我说一声「开门禁」即开启；
            改回 false 可随时关闭，不会锁死现网。
   ========================================================================== */
window.LOGIN_REQUIRED = false;
(function () {
  const CFG = window.CLOUD_CONFIG || {};
  const LS_KEY = "auth_session_v1";
  let _sb = null;

  function sb() {
    if (_sb) return _sb;
    if (!window.supabase || !CFG.url || !CFG.key) return null;
    const url = (CFG.url || "").trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
    try { _sb = window.supabase.createClient(url, CFG.key); } catch (e) { _sb = null; }
    return _sb;
  }

  /* 手机号 / 任意账号 → Supabase 需要的 email 格式。
     INTERNAL_DOMAINS：登录时依次尝试的域名（上次成功的排最前，少一次无谓请求）。
     SIGNUP_DOMAIN   ：只能用带真实顶级域的那个 —— API 注册不认 .local。 */
  var INTERNAL_DOMAINS = ["@neibu.local", "@neibu.fhjd.com"];
  var SIGNUP_DOMAIN = "@neibu.fhjd.com";
  var DOM_LS = "auth_dom_v1";

  function domOrder() {
    var last = "";
    try { last = localStorage.getItem(DOM_LS) || ""; } catch (e) {}
    var arr = INTERNAL_DOMAINS.slice();
    var i = arr.indexOf(last);
    if (i > 0) { arr.splice(i, 1); arr.unshift(last); }
    return arr;
  }

  function toEmail(id, dom) {
    id = (id || "").trim();
    if (!id) return "";
    if (id.indexOf("@") >= 0) return id;
    return id + (dom || INTERNAL_DOMAINS[0]);                     // 手机号 / 姓名 当账号
  }

  function nameOf(u) {
    if (!u) return "";
    const m = u.user_metadata || {};
    return m.name || m.ename || (u.email ? u.email.split("@")[0] : "");
  }

  function saveSession(u) {
    const s = { uid: u.id, email: u.email, name: nameOf(u), exp: (u.exp || 0) * 1000, at: Date.now() };
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  function getSession() {
    try {
      const r = localStorage.getItem(LS_KEY);
      if (!r) return null;
      const s = JSON.parse(r);
      if (s.exp && s.exp < Date.now()) { logout(); return null; }
      return s;
    } catch (e) { return null; }
  }

  function currentName() { const s = getSession(); return s ? s.name : ""; }

  // ★ 合并内部人员码：登录后把姓名暴露给报工端，扫码时免输内部码
  function currentOp() {
    const s = getSession();
    return s ? (s.name || s.email.split("@")[0]) : "";
  }

  async function login(identifier, password) {
    const c = sb();
    if (!c) return { ok: false, msg: "云端未配置（CLOUD_CONFIG 缺失，先配置云端同步）" };
    const raw = (identifier || "").trim();
    if (!raw) return { ok: false, msg: "请输入账号" };
    // 用户自己写了完整邮箱 → 只试这一次，不猜域名
    const doms = raw.indexOf("@") >= 0 ? [""] : domOrder();
    let msg = "账号或密码错误";
    for (let i = 0; i < doms.length; i++) {
      const { data, error } = await c.auth.signInWithPassword({ email: toEmail(raw, doms[i]), password: password });
      if (!error && data && data.user) {
        try { if (doms[i]) localStorage.setItem(DOM_LS, doms[i]); } catch (e) {}
        saveSession(data.user);
        return { ok: true, name: nameOf(data.user) };
      }
      msg = humanErr(error);
      // ★ 只有「账号或密码不对」才值得换域名再试；「没激活/格式错」换域名结果一样
      if (msg !== "账号或密码错误") return { ok: false, msg: msg };
    }
    return { ok: false, msg: msg };
  }

  async function signup(identifier, password, name) {
    const c = sb();
    if (!c) return { ok: false, msg: "云端未配置" };
    const { data, error } = await c.auth.signUp({
      email: toEmail(identifier, SIGNUP_DOMAIN),
      password: password,
      options: { data: { name: name || toEmail(identifier).split("@")[0] } }
    });
    if (error) return { ok: false, msg: humanErr(error) };
    return { ok: true, name: nameOf(data.user) };
  }

  async function logout() {
    // 退出前先把未保存的草稿落盘（本机草稿与登录无关，退出不会清数据，这里是双保险）
    try { if (window.flushDraft) window.flushDraft(); } catch (e) {}
    const c = sb();
    if (c) { try { await c.auth.signOut(); } catch (e) {} }
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  // 让 Supabase 的英文报错变成人话
  function humanErr(e) {
    const m = (e && e.message) || "";
    if (/Invalid login|invalid credentials/i.test(m)) return "账号或密码错误";
    if (/Email not confirmed|not confirmed/i.test(m)) return "账号还没激活，联系管理员开通";
    if (/User already registered/i.test(m)) return "该账号已存在";
    if (/Password should be|should be at least/i.test(m)) return "密码太弱（至少 6 位）";
    if (/Unable to validate email|invalid email/i.test(m)) return "账号格式不对（用手机号或邮箱）";
    return m || "未知错误";
  }

  // 全站门禁（默认关闭，见文件头说明）
  function guard() {
    if (/jsdom/i.test(navigator.userAgent || "")) return;
    if (window.LOGIN_REQUIRED && !getSession()) {
      const back = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      try { if (window.flushDraft) window.flushDraft(); } catch (e) {}   // 跳登录前先把未保存的草稿落盘
      location.href = "login.html?redirect=" + back;
    }
  }

  window.Auth = { login, signup, logout, getSession, currentName, currentOp, guard, toEmail, nameOf,
                  domains: INTERNAL_DOMAINS, signupDomain: SIGNUP_DOMAIN, domOrder: domOrder };
})();
