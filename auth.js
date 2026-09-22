/* ==========================================================================
   铸运通 · 统一账号登录（接 Supabase Auth）
   --------------------------------------------------------------------------
   复用现有 supabase 客户端（window.supabase + CLOUD_CONFIG），不新增任何密钥。
   账号标识：内部人员用「手机号」登录，系统自动补 @neibu.local 当邮箱去对接
            Supabase Auth（这样不必配置短信网关，零成本）。
           后台也可以在 Supabase 建「真邮箱+密码」账号，同样能登。

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

  // 手机号 / 任意账号 → Supabase 需要的 email 格式
  function toEmail(id) {
    id = (id || "").trim();
    if (!id) return "";
    if (id.indexOf("@") >= 0) return id;
    if (/^[\d]{6,15}$/.test(id)) return id + "@neibu.local";   // 手机号当账号
    return id + "@neibu.local";
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
    const { data, error } = await c.auth.signInWithPassword({ email: toEmail(identifier), password: password });
    if (error) return { ok: false, msg: humanErr(error) };
    if (!data.user) return { ok: false, msg: "登录失败" };
    saveSession(data.user);
    return { ok: true, name: nameOf(data.user) };
  }

  async function signup(identifier, password, name) {
    const c = sb();
    if (!c) return { ok: false, msg: "云端未配置" };
    const { data, error } = await c.auth.signUp({
      email: toEmail(identifier),
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

  window.Auth = { login, signup, logout, getSession, currentName, currentOp, guard, toEmail, nameOf };
})();
