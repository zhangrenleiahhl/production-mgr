// 验证：司机没签到（车未到）/ 质保书没好 → 「装货中 / 已完成」推不动，并且弹提示说清楚
//   现象（2026-09-22 用户报）：大屏上出现「工序：已完成 100% + 车辆：未到 / 还没签到」
//   这种自相矛盾的行 —— 车都没来，工序却一路推到装货中 / 已完成。
//
//   ① scan-lib.stepBlock：唯一口径（to<2 放行；to>=2 要求 car>=1；to=3 还要 bz>=1；车辆已取消也拦）
//   ② applyStep 硬拦截（数据层双保险）：拦下时 changed=false / s 不动 / rv 不涨 / 带 blocked 原因
//   ③ 撤回不受影响：推错的老数据（s>=2 但 car=0）能退回去，不会被锁死
//   ④ uiAlert：只有「知道了」一个按钮的自绘提示框（不是原生 alert）
//   ⑤ 扫码.html：行上写明原因 + 按钮压暗 + 点一下弹提示、且一个字节都不改
//   ⑥ 源码契约：step() 必须走 SL.stepBlock / SL.uiAlert（防漂移）
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const crypto = require('crypto');

const DIR = 'D:/桌面/生产管理客户端/';
const SCANLIB = fs.readFileSync(DIR + 'scan-lib.js', 'utf8');
const STAFFCFG = fs.readFileSync(DIR + 'staff-config.js', 'utf8');
const SCANHTML = fs.readFileSync(DIR + '扫码.html', 'utf8');

console.log('被测文件：' + DIR + 'scan-lib.js + 扫码.html\n');
let pass = 0, fail = 0;
function ok(c, m){ if (c){ pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } }
const eq = (a, b, m) => ok(String(a) === String(b), m + '（实际：' + JSON.stringify(a) + '）');

/* 日期一律相对今天算（写死日期踩过 3 次坑） */
function ymdAgo(off){
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
const TODAY = ymdAgo(0);
const CK = (c) => c + '|' + TODAY;

/* ---- 会话（名册版本 + 签名字，跟 staff-config 现读，别写死） ---- */
function cfgStr(k){
  const m = STAFFCFG.match(new RegExp('^\\s{2}' + k + '\\s*:\\s*"([^"]*)"', 'm'));
  return m ? m[1] : '';
}
const SALT = cfgStr('salt'), VER = cfgStr('ver');
function sessOf(id){
  const exp = Date.now() + 86400000;
  const tok = crypto.createHash('sha256').update(SALT + ':' + id + ':' + exp + ':' + VER + ':sess').digest('hex');
  return { id: id, name: id, exp: exp, v: VER, tok: tok };
}

/* ==========================================================================
   ①②③④ 纯 scan-lib 层（不起页面，先把规则钉死）
   ========================================================================== */
const libDom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/x.html', runScripts: 'dangerously' });
const w0 = libDom.window;
w0.eval(SCANLIB);
const SL = w0.ScanLib;

console.log('\n=== ① stepBlock：没车不许装货（口径只留这一份）===');
ok(typeof SL.stepBlock === 'function', 'scan-lib 导出 stepBlock()');
eq(SL.stepBlock({ car: 0 }, 1), '', '推进「货好」不需要车 → 放行');
eq(SL.stepBlock({ car: 0 }, 0), '', 'to=0 也不会拦（撤回退格走的是 applyStep，不能被误拦）');
ok(SL.stepBlock({ car: 0 }, 2).length > 0, '★ 车未到 → 拦「装货中」');
ok(SL.stepBlock({ car: 0 }, 3).length > 0, '★ 车未到 → 拦「已完成」');
ok(/司机/.test(SL.stepBlock({ car: 0 }, 2)) && /签到/.test(SL.stepBlock({ car: 0 }, 2)),
   '  拦下来的原因说清是「司机还没签到」：' + SL.stepBlock({ car: 0 }, 2));
ok(/装货中/.test(SL.stepBlock({ car: 0 }, 2)) && /已完成/.test(SL.stepBlock({ car: 0 }, 3)),
   '  原因里点名是哪一道工序被拦（现场知道卡在哪一步）');
eq(SL.stepBlock({ car: 1 }, 2), '', '车已到 → 放行「装货中」');
eq(SL.stepBlock({ car: 1, bz: 1 }, 3), '', '车已到 + 质保书好了 → 放行「已完成」');
eq(SL.stepBlock({ car: 1 }, 3), '', '★ 车已到（质保书没好 bz=0）也能点「已完成」→ 放行（质保书不绑工序，2026-09-30）');
ok(!/质保书/.test(SL.stepBlock({ car: 1 }, 3)), '  放行原因里不再点名质保书（只卡车到）');
eq(SL.stepBlock({ car: 1, bz: 0 }, 2), '', '质保书没好不拦「装货中」（只拦最后一档：货可以先上车）');
ok(SL.stepBlock({ car: 1, bz: 1, cx: 1 }, 3).length > 0, '  已取消的车：车到了、质保书也好了照样被拦下');
ok(/取消/.test(SL.stepBlock({ car: 0, cx: 1 }, 2)), '★ 车辆已取消的那一趟也拦（原因提「取消」）：' + SL.stepBlock({ car: 0, cx: 1 }, 2));
ok(/取消/.test(SL.stepBlock({ car: 1, cx: 1 }, 2)), '  脏数据里 cx=1 但 car 还是 1 → 照样拦（取消的车不可能到）');
eq(SL.stepBlock(undefined, 2).length > 0, true, '空格子（没车）也拦');

console.log('\n=== ② applyStep 硬拦截：拦下时一个字节都不改 ===');
{
  const P = {};
  SL.applyStep(P, 'i1', 'A', +1, '发货员');              // s=1 货好
  const c = P.i1['A'], rv1 = c.rv;
  const r = SL.applyStep(P, 'i1', 'A', +1, '张仁磊');    // 想推到装货中，但车未到
  eq(r.changed, false, '★ 车未到时 applyStep 拒绝推进（changed=false）');
  eq(r.blocked.length > 0, true, '  返回值里带上被拦的原因（页面拿去弹提示）');
  eq(c.s, 1, '  工序原地不动（还是 1 货好）');
  eq(c.rv, rv1, '★ rv 也不涨（脏数据不能顺着版本号污染云端）');
  eq(c.by, '发货员', '  操作人不会被改写（还是第一步的「发货员」，没被这次「张仁磊」覆盖）');

  SL.applyCar(P, 'i1', 'A', 1);
  const r2 = SL.applyStep(P, 'i1', 'A', +1, '张仁磊');
  eq(r2.changed, true, '车已到之后再推 → 成功');
  eq(c.s, 2, '  工序到 2（装货中）');
  eq(c.by, '张仁磊', '  这次才记下操作人');
  const r4 = SL.applyStep(P, 'i1', 'A', +1, '张仁磊');
  eq(r4.changed, true, '★ 车到了（质保书没好）也能推到「已完成」（质保书不绑工序，2026-09-30）');
  eq(c.s, 3, '  直接到「已完成」');
  eq(r4.blocked || '', '', '  放行原因空（不点名质保书）');
  SL.applyBz(P, 'i1', 'A', 1, '张仁磊');          // 质保书仍可在「已完成」后补充标注
  eq(c.bz, 1, '  质保书补标成功（不影响已完成的门禁）');

  // 货好那一步从来不需要车
  const P2 = {};
  eq(SL.applyStep(P2, 'i1', 'B', +1, 'x').changed, true, '★ 货好（0→1）不受影响，没车也能点');
  eq(P2.i1['B'].s, 1, '  工序到 1');

  // 老数据（2026-09-22 之前推上去的 s>=2 但没车）不许继续往前推
  const P3 = { i1: { C: { s: 2, t: 1, car: 0, ct: 0, u: 1, by: '张敏锐', rv: 9 } } };
  const r3 = SL.applyStep(P3, 'i1', 'C', +1, 'x');
  eq(r3.changed, false, '★ 老数据「装货中 + 车未到」也不许推到已完成');
  eq(P3.i1['C'].s, 2, '  停在装货中（不静默改成别的）');
  eq(P3.i1['C'].rv, 9, '  rv 不动');
}

console.log('\n=== ③ 撤回不受影响：推错的老数据能退回去（不锁死）===');
{
  const P = { i1: { A: { s: 2, t: 1, car: 0, ct: 0, u: 1, by: 'x', rv: 9 } } };
  const u = SL.applyUndo(P, 'i1', 'A', '张仁磊');
  eq(u.changed, true, '★ 车未到的「装货中」也能撤回（这是把老数据改回正路的手段）');
  eq(P.i1['A'].s, 1, '  退回「货好」');
  const P2 = { i1: { A: { s: 3, t: 2, car: 1, ct: 1, u: 2, by: 'x', rv: 9 } } };
  SL.applyUndo(P2, 'i1', 'A', 'y');
  eq(P2.i1['A'].s, 2, '  撤「已完成」也照旧（车到了的格子撤回本来就没被拦）');
  const P3 = { i1: { A: { s: 1, t: 1, car: 0, ct: 0, u: 1, by: 'x', rv: 2 } } };
  const r = SL.applyStep(P3, 'i1', 'A', -1, 'x');
  eq(r.changed, true, '  退格（delta<0）不会被拦');
  eq(P3.i1['A'].s, 0, '  退到 0');
}

console.log('\n=== ④ uiAlert：只有「知道了」一个按钮的自绘提示框 ===');
{
  ok(typeof SL.uiAlert === 'function', 'scan-lib 导出 uiAlert()');
  const h = SL.uiAlert('司机还没签到，不能推进「装货中」。', { title: '🚫 不能推进工序' });
  const mask = w0.document.querySelector('.smkcf-mask');
  ok(!!mask, '弹出的是页面自绘弹层（.smkcf-mask）');
  const btns = Array.from(mask.querySelectorAll('button')).map(b => b.textContent);
  eq(btns.join('/'), '知道了', '★ 只有一个按钮「知道了」（没有「取消/关闭网页」）');
  ok(/不能推进工序/.test(mask.querySelector('.smkcf-ttl').textContent), '标题是「不能推进工序」');
  ok(/司机还没签到/.test(mask.querySelector('.smkcf-msg').textContent), '正文写清原因');
  h.yes.onclick();
  ok(!w0.document.querySelector('.smkcf-mask'), '点「知道了」→ 弹层关掉');
  const h2 = SL.uiAlert('再来一次');
  h2.mask.onclick({ target: h2.mask });
  ok(!w0.document.querySelector('.smkcf-mask'), '点空白处也能关掉（不卡住页面）');
}

/* ==========================================================================
   ⑤ 扫码.html 界面：看得见（提示 + 压暗）+ 点得动（弹提示、不改数据）
   ========================================================================== */
const REC = {
  id: 7, no: 'F-007', planner: '张三',
  rows: [
    { shipdate: TODAY, customer: '甲客户', model: 'A', qty: '1000', ton: '2.0', logistics: '顺达物流' },  // s=1 车未到
    { shipdate: TODAY, customer: '乙客户', model: 'B', qty: '2000', ton: '3.0', logistics: '安捷货运' },  // s=0
    { shipdate: TODAY, customer: '丙客户', model: 'C', qty: '3000', ton: '4.0', logistics: '顺达物流' },  // s=2 车未到（老数据）
    { shipdate: TODAY, customer: '丁客户', model: 'D', qty: '4000', ton: '5.0', logistics: '顺达物流' },  // s=1 车已到
    { shipdate: TODAY, customer: '戊客户', model: 'E', qty: '5000', ton: '6.0', logistics: '顺达物流' },  // s=2 车已到 质保书没好
  ],
};
const PROG = { i7: {
  [CK('甲客户')]: { s: 1, t: 1757916000000, car: 0, ct: 0, u: 1757916000000, by: '发货员', rv: 3 },
  [CK('乙客户')]: { s: 0, t: 0, car: 0, ct: 0, u: 0, by: '', rv: 0 },
  [CK('丙客户')]: { s: 2, t: 1757916000000, car: 0, ct: 0, u: 1757916000000, by: '张敏锐', rv: 4 },
  [CK('丁客户')]: { s: 1, t: 1757916000000, car: 1, ct: 1757912400000, u: 1757916000000, by: '发货员', rv: 3 },
  [CK('戊客户')]: { s: 2, t: 1757916000000, car: 1, ct: 1757912400000, u: 1757916000000, by: '发货员', rv: 5, bz: 0 },
} };

function boot(){
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) console.log('[jsdom] ' + e.message); });
  const pushed = [];
  const dom = new JSDOM(SCANHTML, {
    url: 'https://example.com/' + encodeURIComponent('扫码.html'),
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w){
      w.CloudSync = {
        init: () => {}, ready: () => true, configured: () => true, setStatus: () => {}, bindStatus: () => {},
        guard: () => {}, pull: () => Promise.resolve(null),
        pullResult: (k) => {
          if (k === 'shipping_plans_v1') return Promise.resolve({ ok: true, value: [REC] });
          if (k === 'shipping_progress_v1') return Promise.resolve({ ok: true, value: PROG });
          return Promise.resolve({ ok: true, value: null });
        },
        push: (k, v) => { pushed.push({ key: k, value: JSON.parse(JSON.stringify(v)) }); return Promise.resolve(true); },
      };
      w.eval(SCANLIB);
      w.eval(STAFFCFG);
      w.confirm = () => true;
      w.alert = () => {};
      w.localStorage.setItem('staff_session_v1', JSON.stringify(sessOf('张仁磊')));
    },
  });
  dom.__pushed = pushed;
  return dom;
}
const settle = () => new Promise(r => setTimeout(r, 60));
const rowsOf = (w) => Array.from(w.document.querySelectorAll('#list .row'));
const rowOf = (w, name) => rowsOf(w).filter(r => r.querySelector('.name').textContent.replace(/昨/g, '').trim() === name)[0];
const maskOf = (w) => w.document.querySelector('.smkcf-mask');
const clickYes = (w) => { const b = w.document.querySelector('.smkcf-mask .smkcf-yes'); if (b) b.onclick(); return !!b; };

(async function main(){
  console.log('\n=== ⑤ 扫码.html：行上看得出、点了有提示、数据不动 ===');
  const dom = boot(), w = dom.window;
  await settle();
  eq(rowsOf(w).length, 5, '在屏 5 行（都是今天）');

  const jia = rowOf(w, '甲客户'), yi = rowOf(w, '乙客户'), bing = rowOf(w, '丙客户'), ding = rowOf(w, '丁客户');
  ok(!!jia && !!yi && !!bing && !!ding, '四行都渲染出来了');

  // ---- 看得见 ----
  ok(/司机没签到|司机还没签到/.test(jia.querySelector('.needcar') ? jia.querySelector('.needcar').textContent : ''),
     '★ 甲客户（s=1 车未到）行上直接写明「司机还没签到」');
  ok(/签到/.test(jia.querySelector('.needcar').textContent) && /车已到/.test(jia.querySelector('.needcar').textContent),
     '  提示里给出解法（让司机签到 / 点「车已到」）');
  ok(/lock/.test(jia.querySelector('[data-go]').className), '★ 工序按钮带 lock 锁定态（压暗，不是普通色）');
  eq(jia.querySelector('[data-go]').getAttribute('title'), SL.stepBlock({ car: 0 }, 2), '  鼠标悬停能看到原因');
  eq(bing.querySelector('[data-go]').getAttribute('title'), SL.stepBlock({ car: 0 }, 3), '  丙客户（s=2 车未到）也一样，指向「已完成」');
  eq(yi.querySelector('.needcar'), null, '乙客户（s=0）不受影响：没有锁定提示（货好不需要车）');
  eq(/lock/.test(yi.querySelector('[data-go]').className), false, '  按钮也是正常态');
  eq(ding.querySelector('.needcar'), null, '丁客户（车已到）没有锁定提示');
  eq(/lock/.test(ding.querySelector('[data-go]').className), false, '  按钮正常态');
  const wu = rowOf(w, '戊客户');
  ok(!!wu, '戊客户（s=2 车已到、质保书没好）也渲染出来');
  /* ★ 2026-09-30 质保书不绑工序：车已到即可点「已完成」，不再提示/锁死质保书 */
  eq(wu.querySelector('.needcar'), null, '  戊客户行不再显示「品一质保书还没好」提示（质保书不绑工序）');
  eq(wu.querySelector('[data-go]').getAttribute('title') || '', '', '  悬停原因空（stepBlock 不拦质保书）');
  ok(!/lock/.test(wu.querySelector('[data-go]').className), '  工序按钮正常态（车已到即可点，不压暗）');

  // ---- 点了有提示、且什么都不改 ----
  const p0 = dom.__pushed.length;
  jia.querySelector('[data-go]').onclick();
  await settle();
  ok(!!maskOf(w), '★ 点「装货中」→ 弹提示框（不是没反应）');
  const btns = Array.from(maskOf(w).querySelectorAll('button')).map(b => b.textContent);
  eq(btns.join('/'), '知道了', '★ 只有一个「知道了」（没有「关闭网页」这种坑）');
  ok(/甲客户/.test(maskOf(w).textContent), '  提示里点名是哪一家：' + maskOf(w).querySelector('.smkcf-msg').textContent.split('\n')[0]);
  ok(/司机还没签到/.test(maskOf(w).textContent), '  说清被拦的原因');
  ok(/司机签到码|车已到/.test(maskOf(w).textContent), '  给出解法');
  if (maskOf(w)) clickYes(w);
  await settle();
  eq(dom.__pushed.length, p0, '★ 拦下时没往云端推任何东西');
  eq(JSON.parse(w.localStorage.getItem('shipping_progress_v1') || '{}').i7[CK('甲客户')].s, 1, '  本机进度也一个字没改');
  ok(!maskOf(w), '  点「知道了」→ 弹层关掉，页面能继续用');

  // ---- 老数据（s=2 车未到）推到「已完成」也被拦 ----
  bing.querySelector('[data-go]').onclick();
  await settle();
  ok(!!maskOf(w) && /还没签到/.test(maskOf(w).textContent), '★ 老数据「装货中 + 车未到」点「已完成」也被拦');
  if (maskOf(w)) clickYes(w);
  await settle();
  eq(dom.__pushed.length, p0, '  同样什么都没推');
  // 但它能撤回（把老数据改回正路）
  bing.querySelector('[data-undo]').onclick();
  await settle();
  ok(!!maskOf(w) && /取消|确定/.test(maskOf(w).textContent), '  点「↩」撤回 → 走的是「取消/确定」确认框（没被拦）');
  clickYes(w);
  await settle();
  const lastP = dom.__pushed[dom.__pushed.length - 1].value.i7[CK('丙客户')];
  eq(lastP.s, 1, '★ 撤回把老数据退回「货好」（能改回来，不锁死）');
  eq(lastP.rv, 5, '  rv 自增（退得回去的关键）');

  // ---- 正常路径不受影响：车已到 → 点工序还是老样子（取消/确定）----
  const p1 = dom.__pushed.length;
  ding.querySelector('[data-go]').onclick();
  await settle();
  const b2 = Array.from(maskOf(w).querySelectorAll('button')).map(b => b.textContent);
  eq(b2.join('/'), '取消/确定', '★ 车已到的那趟，点工序还是「取消/确定」确认框（没被误拦）');
  clickYes(w);
  await settle();
  eq(dom.__pushed[dom.__pushed.length - 1].value.i7[CK('丁客户')].s, 2, '  确认后正常推进到「装货中」');
  eq(dom.__pushed.length > p1, true, '  也确实推了云端');

  // ---- 质保书不绑工序：车已到即可点「已完成」（2026-09-30 起，不卡质保书）----
  const p2 = dom.__pushed.length;
  // 先标质保书（s=2 时仍可标注）
  rowOf(w, '戊客户').querySelector('[data-bz="1"]').onclick();
  await settle();
  ok(!!maskOf(w) && /质保书/.test(maskOf(w).textContent), '  点「✓ 质保书好了」→ 弹确认框');
  clickYes(w);
  await settle();
  eq(dom.__pushed[dom.__pushed.length - 1].value.i7[CK('戊客户')].bz, 1, '  质保书写进去了');
  // 车已到 + 质保书好了 → 点「已完成」放行（bz=0 同样放行，见 SCANLIB 断言与上方戊客户渲染）
  rowOf(w, '戊客户').querySelector('[data-go]').onclick();
  await settle();
  const b4 = Array.from(maskOf(w).querySelectorAll('button')).map(b => b.textContent);
  eq(b4.join('/'), '取消/确定', '★ 点「已完成」→ 正常确认框（放行，质保书不绑工序）');
  clickYes(w);
  await settle();
  eq(dom.__pushed[dom.__pushed.length - 1].value.i7[CK('戊客户')].s, 3, '  推进到 3（已完成）');

  // ---- 货好（s=0）没车照样能点 ----
  yi.querySelector('[data-go]').onclick();
  await settle();
  const b3 = Array.from((maskOf(w) || w.document.createElement('div')).querySelectorAll('button')).map(b => b.textContent);
  eq(b3.join('/'), '取消/确定', '★ 乙客户 s=0：点「货好」不被拦（没车也能确认货好）');
  clickYes(w);
  await settle();
  eq(dom.__pushed[dom.__pushed.length - 1].value.i7[CK('乙客户')].s, 1, '  确认后到「货好」');

  console.log('\n=== ⑥ 源码契约：拦的入口只有一处，别在页面里另写一套 ===');
  const code = SCANHTML.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/SL\.stepBlock\(cur, s \+ 1(, cust)?\)/.test(code), '★ 扫码.html 的 step() 推进前先问 SL.stepBlock');
  ok(/SL\.uiAlert\(/.test(code), '★ 被拦时用 SL.uiAlert 弹提示（不是静默 return）');
  ok(!/司机没签到|司机还没签到/.test(code), '  「司机没签到」这句话不是页面自己编的（统一由 scan-lib.stepBlock 出）');
  ok(/stepBlock: stepBlock/.test(SCANLIB), 'scan-lib 把 stepBlock 导出了');
  ok(/uiAlert: uiAlert/.test(SCANLIB), 'scan-lib 把 uiAlert 导出了');
  ok(/var blocked = stepBlock\(c, to[,)]/.test(SCANLIB), '★ applyStep 自己也调 stepBlock（硬拦截，不止页面挡一下）');
  ok(!/to >= 3 && \(c\.bz \|\| 0\) < 1/.test(SCANLIB), '★ 「已完成」不再强制「质保书已好」（2026-09-30 起质保书不绑工序）');
  ok(/bz: r\.bz/.test(code), '★ 扫码.html 仍把 bz 交给 stepBlock（读数用，不再用于门禁）');
  ok(!/品一质保书还没好/.test(SCANLIB), '★ scan-lib 不再有「品一质保书还没好」文案（质保书不绑工序）');

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
