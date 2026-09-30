// 电视老内核登录兜底（2026-09-30）——静态契约检查
//   背景：电视自带浏览器内核旧，supabase.min.js（新版大库，含新语法）解析失败 ->
//         window.supabase 不存在 -> 登录页误报「云端未配置（CLOUD_CONFIG 缺失）」，
//         而线上 cloud-config.js 内容是正常的。
//   修复：auth.js 新增 ES5 XHR 直连 Supabase Auth REST 的兜底登录 xhrSignIn；
//         signInRetry 里「库在走库、库不在走兜底」；「云端未配置」只在 CLOUD_CONFIG 真缺失时报。
//   附带：根目录引用 auth.js 的页面统一升 auth.js?v=20260930a（login.html 原来没带版本号，也补上）。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } }

const DIR = 'D:/桌面/生产管理客户端/';
const authSrc = fs.readFileSync(DIR + 'auth.js', 'utf8');

console.log('【一】auth.js 老内核兜底登录');
ok(/function xhrSignIn\(email, password\)/.test(authSrc),
   '★ auth.js 有 ES5 XHR 兜底登录 xhrSignIn（老内核跑不动 supabase 库也能登）');
ok(/\/auth\/v1\/token\?grant_type=password/.test(authSrc),
   '★ 兜底走 Supabase Auth REST（/auth/v1/token?grant_type=password）');
ok(/x\.setRequestHeader\("apikey", CFG\.key\)/.test(authSrc),
   '  REST 请求带 apikey 头（anon key，界面层公开值）');
ok(/last = c \? await c\.auth\.signInWithPassword\(\{ email: email, password: password \}\) : await xhrSignIn\(email, password\)/.test(authSrc),
   '★ signInRetry：supabase 库在走库、库不在自动走 XHR 兜底（同一个域名轮询/重试流程复用）');
ok(/x\.onerror|ontimeout/.test(authSrc), '  兜底有网络错误/超时处理（走 humanErr 的人话提示）');
ok(/if \(!CFG\.url \|\| !CFG\.key\) return \{ ok: false, msg: "云端未配置（CLOUD_CONFIG 缺失，先配置云端同步）" \}/.test(authSrc),
   '★ 「云端未配置」只在 CLOUD_CONFIG 真缺失（url/key 缺）时报');
ok(authSrc.indexOf('if (!c) return { ok: false, msg: "云端未配置（CLOUD_CONFIG 缺失') < 0,
   '  login() 的「c 为空就误报云端未配置（CLOUD_CONFIG 缺失）」已移除（不再冤枉老内核；signup 保留的短提示不受影响）');

console.log('\n【二】页面引用缓存版本');
const V = '20260930a';
let bumped = 0, missing = [];
fs.readdirSync(DIR).forEach(f => {
  if (!/\.html$/i.test(f)) return;
  let h = '';
  try { h = fs.readFileSync(DIR + f, 'utf8'); } catch (e) { return; }
  if (h.indexOf('auth.js') < 0) return;          // 不引用 auth.js 的页面不参与
  if (h.indexOf('auth.js?v=' + V) >= 0) bumped++;
  else missing.push(f);
});
ok(bumped >= 12, '★ 根目录引用 auth.js 的页面都已升 auth.js?v=' + V + '（本次 ' + bumped + ' 页）');
ok(missing.length === 0, '  没有漏升版本的页面' + (missing.length ? ('：' + missing.join(', ')) : ''));

console.log(fail ? '\n❌ ' + fail + ' 项失败' : '\n✅ ' + pass + ' 项全部通过');
process.exit(fail ? 1 : 0);
