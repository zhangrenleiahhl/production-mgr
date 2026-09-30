// 验证：三端共用的那份「口径」没被各页面偷偷复制走 —— 防漂移契约
// ---------------------------------------------------------------------------
// 为什么必须有这一张测试：
//   「进度只增不减 + rv 版本号」这份合并逻辑，一旦哪个页面自己复制了一份，
//   表现就是"有时候进度会自己退回去"。这种 bug 现场极难复现、极难查。
//   所以用「源码扫描 + 行为断言」两头卡住，谁改漂了立刻红。
//   （原 test_scan.js 测的是"匿名按单扫码页"，那个页面已按需求取消，
//     改为收敛成两张固定码，见 ④；本文件接手它剩下那些仍然重要的契约。）
//   ① 所有页面引用的 scan-lib.js 版本号必须完全一样
//   ② 没有任何页面自己实现 mergeCell / mergeProg / boardRows / sha256Hex
//   ③ 需要登录的页面才加载 staff-config.js，不需要的不能乱加载
//   ④ 两个固定码（内部码 / 司机码）的地址必须精确、且都不带单号
//   ⑤ rv 合并契约：高 rv 整格赢 / 同 rv 只增不减 / 撤回留下的空墓碑要保留
//   ⑥ 三个动作函数都会 +rv，工序被夹在 0..3，撤回优先撤最近那一次
//   ⑦ guardFn 满足 CloudSync.guard 的 string→string 契约
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = 'D:/桌面/生产管理客户端/';
const SCANLIB = fs.readFileSync(DIR + 'scan-lib.js', 'utf8');

// 引用 scan-lib 的页面（新增页面时记得加进来）
const PAGES = ['发货计划系统.html', 'viewer.html', '扫码.html', '司机扫码.html', '物流大屏.html', '物流门口大屏.html', '生成内部口令.html'];
// ★ 2026-09-24：「发货计划系统 / viewer」也是登录后的页面（Auth.guard），
//   而且现在要在右下悬浮条显示「欢迎 当前账号」→ 必须读名册，所以它们也要加载 staff-config.js
const NEED_LOGIN = { '发货计划系统.html': true, 'viewer.html': true, '扫码.html': true, '生成内部口令.html': true };

console.log('被测目录：' + DIR + '\n');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } }
const eq = (a, b, m) => ok(String(a) === String(b), m + '（实际：' + JSON.stringify(a) + '）');

const src = { 'scan-lib.js': SCANLIB, 'staff-config.js': fs.readFileSync(DIR + 'staff-config.js', 'utf8') };
PAGES.forEach(f => { src[f] = fs.readFileSync(DIR + f, 'utf8'); });

(async function main(){
  /* ============ ① 版本号一致（防漂移第一道闸） ============ */
  console.log('【① 所有页面的 scan-lib.js 版本号必须一样】');
  const vers = {};
  PAGES.forEach(f => {
    const m = src[f].match(/scan-lib\.js\?v=([0-9A-Za-z]+)/g) || [];
    eq(m.length, 1, f + ' 只引一份 scan-lib（不重复引）');
    if (m.length) vers[f] = m[0].replace('scan-lib.js?v=', '');
  });
  const uniq = [...new Set(Object.values(vers))];
  eq(uniq.length, 1, '★ 版本号只有一个值：' + uniq.join(' / '));
  Object.keys(vers).forEach(f => eq(vers[f], uniq[0], '  ' + f + ' 用的是 ' + uniq[0]));
  ok(/^20\d{6}[a-z]?$/.test(uniq[0]), '  版本号形如 20260916b（日期 + 补丁字母）');
  // 手机缓存是按整串 URL 命中的：版本号一改，所有页面必须同步改，否则会出现
  // 同一台手机上「扫码页用新逻辑、司机页用旧逻辑」——合并行为就分叉了。
  ok(src['扫码.html'].indexOf('scan-lib.js?v=' + uniq[0]) >= 0 &&
     src['司机扫码.html'].indexOf('scan-lib.js?v=' + uniq[0]) >= 0,
     '  ★ 内部码页和司机码页拿到的是同一份 scan-lib（合并行为不会分叉）');

  /* ============ ② 没人自己复制一份逻辑 ============ */
  console.log('\n【② 没有页面自己实现容易漂移的那几个函数】');
  const FORBIDDEN = ['function mergeCell', 'function mergeProg', 'function boardRows',
                     'function sha256Hex', 'function isDoneCell', 'function normDate', 'function cellAt',
                     'function applyStep', 'function applyCar', 'function applyUndo'];
  PAGES.forEach(f => {
    const hit = FORBIDDEN.filter(k => src[f].indexOf(k) >= 0);
    eq(hit.join(','), '', '  ' + f + ' 没有自己重写：' + (hit.length ? hit.join(' / ') : '（干净）'));
  });
  ok(src['scan-lib.js'].indexOf('window.ScanLib') >= 0, 'scan-lib.js 是唯一的出口（window.ScanLib）');
  // 各页面必须通过 window.ScanLib 取，而不是自己算
  ['扫码.html', '司机扫码.html', '物流大屏.html', '物流门口大屏.html'].forEach(f => {
    ok(/window\.ScanLib|SL\s*=\s*window\.ScanLib/.test(src[f]), '  ' + f + ' 从 window.ScanLib 取公共实现');
  });

  /* ============ ③ staff-config.js 加载范围 ============ */
  console.log('\n【③ staff-config.js 只在需要登录的页面加载】');
  PAGES.forEach(f => {
    const has = src[f].indexOf('staff-config.js') >= 0;
    if (NEED_LOGIN[f]) ok(has, '  ' + f + '（要登录）加载了 staff-config.js');
    else ok(!has, '  ' + f + '（不用登录）没有加载 staff-config.js');
  });
  // 右下悬浮条的「👋 欢迎 当前账号」（2026-09-24）：只有开了开关的页面显示，且必须能读到名册
  src['staff-admin.js'] = fs.readFileSync(DIR + 'staff-admin.js', 'utf8');
  ok(src['staff-admin.js'].indexOf('staffWelcome') >= 0, 'staff-admin.js 里是 staffWelcome（悬浮条欢迎条）');
  ok(src['staff-admin.js'].indexOf('window.STAFF_WELCOME') >= 0, '  ★ 只有页面开了 STAFF_WELCOME 才显示（不搞突然全站冒出来）');
  ok(src['staff-admin.js'].indexOf('nameOfPhone') >= 0 && src['staff-admin.js'].indexOf('STAFF.users') >= 0,
     '  姓名走「手机号 → staff-config.js 名册」（Supabase 账号里没有中文姓名）');
  ['发货计划系统.html', 'viewer.html'].forEach(f => {
    const t = src[f];
    const iCfg = t.indexOf('staff-config.js'), iSw = t.indexOf('window.STAFF_WELCOME'), iAdm = t.indexOf('staff-admin.js');
    ok(iSw >= 0, '  ' + f + ' 开「欢迎当前账号」开关');
    ok(/staff-config\.js\?v=\d{8}[a-z]?/.test(t), '  ' + f + ' 名册引用带版本号（改完能被刷掉缓存）');
    // ★ 顺序契约：名册 / 开关都必须排在 staff-admin.js 之前，否则悬浮条已经渲染完了才拿到名册，
    //   症状是「欢迎条显示成一串手机号」——不报错、只是静默降级，靠肉眼很难发现。
    ok(iCfg >= 0 && iCfg < iAdm, '  ★ ' + f + '：名册排在悬浮条之前（否则欢迎条退化成手机号）');
    ok(iSw >= 0 && iSw < iAdm, '  ' + f + '：开关排在悬浮条之前');
  });
  ok(src['发货计划系统.html'].indexOf('staff-config.js') >= 0 && src['viewer.html'].indexOf('staff-config.js') >= 0,
     '  ★ 这两页要加载名册，所以 NEED_LOGIN 表里必须是 true（对得上上面的断言）');
  // 没开开关的页面不许有欢迎条（9 页共用一份 staff-admin.js，靠开关区分）
  ['物流大屏.html', '物流门口大屏.html', '司机扫码.html'].forEach(f => {
    ok(src[f].indexOf('STAFF_WELCOME') < 0, '  ' + f + ' 不开开关（不显示欢迎条）');
  });

  ok(src['staff-config.js'].indexOf('window.STAFF') >= 0, 'staff-config.js 只暴露 window.STAFF');
  ok(src['staff-config.js'].indexOf('h:') >= 0 && src['staff-config.js'].indexOf('salt') >= 0, '  里面存的是「salt + 哈希」，不是明文');

  /* ============ ④ 两个固定码的地址 ============ */
  console.log('\n【④ 两个固定码（打进二维码里的地址）】');
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) console.log('[jsdom] ' + e.message); });
  const w = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://example.com/production-mgr/index.html',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  }).window;
  w.eval(SCANLIB);
  const SL = w.ScanLib;
  // 站点地址自动跟随「当前打开它的网址」—— 换服务器 / 换域名不用改代码，两张码自动跟着走
  const B = 'https://example.com/production-mgr/';
  eq(SL.PUB_BASE, B, '★ PUB_BASE 自动跟随当前站点（不再是写死的线上地址）');
  eq(SL.SCAN_PAGE, '扫码.html', '内部页文件名');
  eq(SL.DRIVER_PAGE, '司机扫码.html', '司机页文件名');
  eq(SL.DASH_PAGE, '物流大屏.html', '大屏文件名');
  eq(SL.pageUrl(SL.SCAN_PAGE), B + encodeURIComponent('扫码.html'), '内部码地址');
  eq(SL.pageUrl(SL.DRIVER_PAGE), B + encodeURIComponent('司机扫码.html'), '司机码地址');
  const defs = SL.codeDefs();
  eq(defs.length, 2, '★ 正好两张码');
  eq(defs[0].title, '内部人员码', '第一张：内部人员码');
  eq(defs[1].title, '司机签到码', '第二张：司机签到码');
  ok(/登录/.test(defs[0].desc) && /四道工序|待确认/.test(defs[0].desc), '  内部码写明要登录、推四道工序');
  // 司机码的说明（2026-09-17 用户定稿）：不登录 + 对着自己的送达方代码点车已到 = 签到
  ok(/不用登录/.test(defs[1].desc) && /车已到/.test(defs[1].desc), '  司机签到码写明不用登录、只勾车已到');
  ok(/送达方代码/.test(defs[1].desc) && /签到/.test(defs[1].desc), '★ 司机签到码写明"照自己的信息找送达方代码 → 点车已到完成签到"');
  ok(!/撤回自己那一勾/.test(defs[1].desc), '  旧说明"只能勾车已到、可撤回自己那一勾"已替换');
  ok(defs.every(d => d.url.indexOf('?d=') < 0), '★ 两张码地址都不带 ?d=（不再每张单/每个人一个码）');
  ok(defs.every(d => d.url.indexOf(B) === 0), '  两张都在同一个线上域名下（现场手机必须能打开）');
  ok(SL.scanUrl('i1').indexOf('?d=i1') > 0, 'scanUrl 仍支持按单深链（查看页/管理端偶尔要用）');
  ok(SL.pageUrl('中文 名字.html').indexOf(' ') < 0, '文件名里的空格会被编码（地址不能带裸空格）');

  // 换服务器场景：地址必须跟着走，不能钉在旧域名上
  {
    const mk = (url) => {
      const x = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url, runScripts: 'dangerously', virtualConsole: vc,
      }).window;
      x.eval(SCANLIB);
      return x;
    };
    const w2 = mk('http://192.168.1.10:8080/production-mgr/index.html');
    eq(w2.ScanLib.PUB_BASE, 'http://192.168.1.10:8080/production-mgr/',
       '★ 装到内网服务器上，码自动指向那台服务器（换机器不用改代码）');
    eq(w2.ScanLib.pageUrl(w2.ScanLib.SCAN_PAGE),
       'http://192.168.1.10:8080/production-mgr/' + encodeURIComponent('扫码.html'),
       '  内部码跟着服务器走');

    const w3 = mk('http://192.168.1.10:8080/production-mgr/index.html');
    w3.SITE_BASE = 'http://gongchang.local/';
    w3.eval(SCANLIB);   // 重新求值，模拟「页面里先写好 SITE_BASE」
    eq(w3.ScanLib.PUB_BASE, 'http://gongchang.local/',
       '★ 页面里设了 window.SITE_BASE 时以它为准（换域名 / 固定门岗地址时用来钉死）');

    const w4 = mk('file:///D:/production-mgr/index.html');
    ok(/^https:\/\//.test(w4.ScanLib.PUB_BASE),
       '★ 用 file:// 直接打开时退回线上地址（现场手机扫的必须是一个能打开的网址）：' + w4.ScanLib.PUB_BASE);
  }

  /* ============ ⑤ rv 合并契约 ============ */
  console.log('\n【⑤ rv 合并契约（这是"进度不会自己退回去"的命根子）】');
  const CELL = (o) => Object.assign({ s: 0, t: 0, car: 0, ct: 0, u: 0, by: '', rv: 0 }, o);
  // ⑤-1 高 rv 整格赢：连"工序退一格"也要能退回去
  let m = SL.mergeCell(CELL({ s: 1, rv: 3 }), CELL({ s: 3, car: 1, rv: 2 }));
  eq(m.s, 1, '★ rv 大的那份整格赢（rv3 的 s=1 压住 rv2 的 s=3）');
  eq(m.car, 0, '  车辆也一起以 rv 大的那份为准（不会各取一半）');
  eq(m.rv, 3, '  rv 取大的');
  // ⑤-2 同 rv → 只增不减
  m = SL.mergeCell(CELL({ s: 1, car: 1, rv: 2 }), CELL({ s: 3, car: 0, rv: 2 }));
  eq(m.s, 3, 'rv 相同时工序取更进的一份');
  eq(m.car, 1, '  车辆取更进的一份（已到不会被改回未到）');
  // ⑤-3 旧数据（没有 rv）不能盖掉有 rv 的
  m = SL.mergeCell(CELL({ s: 3, car: 1, rv: 4 }), CELL({ s: 0, car: 0 }));
  eq(m.s, 3, '★ 没 rv 的旧数据（rv=0）永远压不过有 rv 的');
  // ⑤-4 撤回留下的空墓碑必须保留
  const tomb = { i7: { 'A|2026-09-01': CELL({ s: 0, car: 0, rv: 5 }) } };
  const cloudy = { i7: { 'A|2026-09-01': CELL({ s: 3, car: 1, rv: 2 }) } };
  const merged = SL.mergeProg(tomb, cloudy);
  ok(!!merged.i7['A|2026-09-01'], '★ 撤回留下的"空格子"（rv>0）不会被丢掉（墓碑）');
  eq(merged.i7['A|2026-09-01'].s, 0, '  合并后仍然是撤回到位的状态（0）');
  eq(merged.i7['A|2026-09-01'].rv, 5, '  版本号保留');
  // 反过来：纯空白且没 rv 的格子该丢就丢，别让文件越长越大
  const trash = SL.mergeProg({ i7: { X: CELL({}) } }, {});
  eq(trash.i7, undefined, '  完全空白又没 rv 的格子会被丢掉（不会越积越多）');
  // ⑤-5 不依赖传参顺序
  const a1 = SL.mergeCell(CELL({ s: 1, rv: 3 }), CELL({ s: 3, car: 1, rv: 2 }));
  const a2 = SL.mergeCell(CELL({ s: 3, car: 1, rv: 2 }), CELL({ s: 1, rv: 3 }));
  eq(a1.s, a2.s, '★ 反过来传参结果一样（合并不依赖顺序）');
  eq(a1.car, a2.car, '  车辆也一样');

  /* ============ ⑥ 三个动作函数都会 +rv ============ */
  console.log('\n【⑥ applyStep / applyCar / applyUndo 都必须 +rv】');
  let P = {};
  let r = SL.applyStep(P, 'i1', 'A', +1, '发货员');
  eq(P.i1['A'].rv, 1, '推进一步 → rv 0→1');
  eq(P.i1['A'].s, 1, '  工序到 1');
  eq(P.i1['A'].by, '发货员', '  记下操作人');
  // ★ 2026-09-22 起「装货中 / 已完成」必须有「车已到」打底（stepBlock 硬拦截）
  SL.applyCar(P, 'i1', 'A', 1); eq(P.i1['A'].car, 1, '  先签到车（后两步的前提）');
  r = SL.applyStep(P, 'i1', 'A', +1, ''); eq(P.i1['A'].rv, 3, '再推一步 → rv 3');
  P.i1['A'].bz = 1;   // 2026-09-30 起「已完成」不再强制质保书；这里置位仅验证 rv 计数不受影响
  SL.applyStep(P, 'i1', 'A', +1, '');     eq(P.i1['A'].rv, 4, '再推一步 → rv 4');
  eq(P.i1['A'].s, 3, '  到顶了（已完成）');
  const rNo = SL.applyStep(P, 'i1', 'A', +1, '');
  eq(rNo.changed, false, '  到底之后不再变（changed=false）');
  eq(P.i1['A'].rv, 4, '  ★ 没变化就不 +rv（不会把版本号空推上去）');
  const rBack = SL.applyStep(P, 'i1', 'A', -5, '');
  eq(P.i1['A'].s, 0, '  工序被夹在 0..3（一下退到底也不会变负数）');
  eq(P.i1['A'].rv, 5, '  退格也 +rv（退得回去的关键）');
  // 车辆
  const P2 = {};
  SL.applyCar(P2, 'i1', 'A', 1);
  eq(P2.i1['A'].car, 1, '车已到 → car=1');
  eq(P2.i1['A'].rv, 1, '  rv 0→1');
  ok(P2.i1['A'].ct > 0, '  记下到达时间');
  SL.applyCar(P2, 'i1', 'A', 1);
  eq(P2.i1['A'].rv, 1, '  重复点同一个值不 +rv');
  SL.applyCar(P2, 'i1', 'A', 0);
  eq(P2.i1['A'].car, 0, '撤回车已到 → car=0');
  eq(P2.i1['A'].ct, 0, '  ct 清掉（不留旧时间）');
  eq(P2.i1['A'].rv, 2, '  rv +1');
  // 撤回：优先撤"最近动的那一次"（比较工序时间 t 和车辆时间 ct）
  // 注意：别依赖"连续几次调用落在不同毫秒"。同一毫秒里 t===ct 时按设计撤工序，
  // 那样断言会随机红。这里把两个时间戳显式写死，测的是规则而不是时钟精度。
  const P3 = {};
  SL.applyCar(P3, 'i1', 'A', 1);                                   // 车先到（推「装货中」的前提）
  SL.applyStep(P3, 'i1', 'A', +1, 'x'); SL.applyStep(P3, 'i1', 'A', +1, 'x');
  P3.i1['A'].t = 200; P3.i1['A'].ct = 300;      // 车辆那一下更晚
  let u = SL.applyUndo(P3, 'i1', 'A', 'y');
  eq(u.what, '车已到', '工序和车辆都动过时，撤"更晚动的那个"（这里车辆更晚）');
  eq(P3.i1['A'].car, 0, '  车辆被撤回');
  eq(P3.i1['A'].s, 2, '  工序没被连带退掉');
  u = SL.applyUndo(P3, 'i1', 'A', 'y');
  eq(u.what, '装货中', '  再撤一次 → 退一格工序');
  eq(P3.i1['A'].s, 1, '  s 2→1');
  ok(P3.i1['A'].rv >= 4, '  三次动作 + 两次撤回，rv 一路只增（实际 ' + P3.i1['A'].rv + '）');
  const P4 = {};
  u = SL.applyUndo(P4, 'i1', 'A', '');
  eq(u.changed, false, '什么都没做过 → 撤不动（不报错）');
  // 工序时间更晚时优先撤工序
  const P5 = {};
  SL.applyCar(P5, 'i1', 'A', 1);
  P5.i1['A'].ct = 100;
  SL.applyStep(P5, 'i1', 'A', +1, 'x');
  P5.i1['A'].t = 200;                          // 工序那一下更晚
  u = SL.applyUndo(P5, 'i1', 'A', 'x');
  eq(u.what, '货好', '工序比车辆更晚 → 优先撤工序');
  eq(P5.i1['A'].car, 1, '  车辆（更早的那次）留着不动');

  /* ============ ⑦ guardFn 契约 ============ */
  console.log('\n【⑦ guardFn：CloudSync.guard 要的是 string→string】');
  ok(typeof SL.guardFn === 'function', 'guardFn 是函数');
  const gOut = SL.guardFn(JSON.stringify(tomb), JSON.stringify(cloudy));
  eq(typeof gOut, 'string', '★ 返回字符串（不是对象）');
  const gObj = JSON.parse(gOut);
  ok(gObj && gObj.i7, '  且能被 JSON.parse 回来');
  eq(gObj.i7['A|2026-09-01'].s, 0, '  合并结果正确（撤回守住了）');
  eq(typeof SL.guardFn('', ''), 'string', '空字符串输入也不炸');
  eq(typeof SL.guardFn('{坏json', '{也坏'), 'string', '★ 坏 JSON 也不炸（返回字符串兜底）');
  eq(JSON.parse(SL.guardFn('null', 'null')).constructor, Object, 'null 输入 → 空对象（不是 null）');
  eq(SL.parseObj('[]').constructor, Object, '数组输入 → 当空对象处理（进度必须是对象）');

  /* ============ 三端共用的常量 ============ */
  console.log('\n【共用常量（三端显示的工序名必须是同一套）】');
  eq(SL.STEP_NAME.length, 4, '工序 4 档');
  eq(SL.STEP_NAME[0], '货待确认', '  第 0 档：货待确认');
  eq(SL.STEP_NAME[3], '已完成', '  第 3 档：已完成');
  eq(SL.CAR_NAME.length, 2, '车辆 2 档');
  eq(SL.KEY_PROG, 'shipping_progress_v1', '进度存在 shipping_progress_v1');
  eq(SL.KEY_PLANS, 'shipping_plans_v1', '发货单存在 shipping_plans_v1');
  eq(SL.isDoneCell({ s: 3, car: 1 }), true, '已完成 = 工序走完 + 车已到（两个都要）');
  eq(SL.isDoneCell({ s: 3, car: 0 }), false, '★ 工序走完但车没到 → 不算完成');
  eq(SL.isDoneCell({ s: 2, car: 1 }), false, '★ 车到了但工序没走完 → 不算完成');

  console.log('\n================ 结果 ================');
  console.log((fail ? '❌ ' : '✅ ') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
