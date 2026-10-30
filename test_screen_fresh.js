// 钉住 2026-10-30「大屏已同步却整屏锁旧」事故的修复：
//  ① 本机进度缓存若留着「rv 更高、内容却更旧」的格子（云端重建/恢复快照/换缓存造成），
//     mergeProg 会永远输给本机旧值 → 大屏显示「已同步 ✓」却锁在几天前。
//     mergeProgSafe 检出中毒格子过多 → 整份信云端（poisoned=true）；
//  ② 健康场景（云端 rv 更新 / 撤回墓碑 rv 更高）绝不能误判中毒；
//  ③ 两块大屏必须：用 mergeProgSafe 合并 + 定期强制全文拉进度 + 顶栏中毒提示
//     + verWatch 传本页版本（door/innr 字段，HTML 改了也能自动重载）；
//  ④ verWatch 预算必须是「滚动窗口」（60 分钟 2 次），不能是「会话总共 2 次」
//     —— 大屏常年不关，会话预算用光后 ver.json 再变也永远不重载（2026-10-30 实况）；
//  ⑤ ver.json 必须含 sl/door/innr 三个字段且全站 ?v= 一致。
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const MIRROR = 'D:/桌面/生产管理客户端/';
const SCANLIB = fs.readFileSync(MIRROR + 'scan-lib.js', 'utf-8');
const verjson = JSON.parse(fs.readFileSync(MIRROR + 'ver.json', 'utf-8'));

let pass = 0, fail = 0;
function ok(cond, msg, extra) { if (cond) { pass++; console.log('  ✅ ' + msg + (extra === undefined ? '' : ' (' + extra + ')')); } else { fail++; console.log('  ❌ ' + msg + (extra === undefined ? '' : ' (' + extra + ')')); } }

// ---------- 第一组：mergeProgSafe 单元测试 ----------
(function unit() {
  console.log('【mergeProgSafe 健全性自检】');
  const vc = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', virtualConsole: vc, url: 'https://x.test/' });
  const w = dom.window;
  w.eval('var window=this,localStorage=this.localStorage;\n' + SCANLIB);
  const SL = w.ScanLib;
  ok(!!SL.mergeProgSafe, 'scan-lib 已导出 mergeProgSafe');

  const T0 = 1760000000000;           // 基准时间
  const cell = (s, rv, u) => ({ s: s, rv: rv, u: u, t: u, car: 0, ct: 0, cx: 0, cxv: 0, rt: 0, rtv: 0, bz: 0, bzv: 0, bzt: 0, bzb: '' });

  // 场景 A：本机缓存中毒 —— 本机 rv 高（=9）但内容旧（u 老、s=0 未到），
  //          云端 rv 低（=2）但内容新（u 新、s=1 货好）。mergeProg 会让本机赢 → 锁旧。
  const localPoison = { 'FH1': { 'c1': cell(0, 9, T0), 'c2': cell(0, 9, T0), 'c3': cell(0, 9, T0), 'c4': cell(0, 9, T0), 'c5': cell(0, 9, T0) } };
  const cloudNew    = { 'FH1': { 'c1': cell(1, 2, T0 + 86400000), 'c2': cell(1, 2, T0 + 86400000), 'c3': cell(1, 2, T0 + 86400000), 'c4': cell(1, 2, T0 + 86400000), 'c5': cell(1, 2, T0 + 86400000) } };
  const rA = SL.mergeProgSafe(localPoison, cloudNew);
  ok(rA.poisoned === true, '中毒场景：本机 rv 高但内容旧 → 判定中毒', 'poisoned=' + rA.poisoned);
  ok(rA.data === cloudNew, '中毒场景：整份信云端（所有格子恢复成货好）');

  // 场景 B：健康 —— 云端 rv 更新（正常推进），合并取云端，绝不误判
  const localOld = { 'FH2': { 'c1': cell(0, 1, T0) } };
  const cloudNew2 = { 'FH2': { 'c1': cell(1, 2, T0 + 3600000) } };
  const rB = SL.mergeProgSafe(localOld, cloudNew2);
  ok(rB.poisoned === false, '健康场景：云端 rv+u 双新 → 不算中毒');
  ok(rB.data.FH2.c1.s === 1 && rB.data.FH2.c1.rv === 2, '健康场景：合并结果取云端新状态');

  // 场景 C：撤回墓碑 —— 本机 rv 更高（撤回留下的空格子），云端旧 → 必须保住本机墓碑
  const tomb = cell(0, 5, T0 + 7200000); tomb.rv = 5;
  const localTomb = { 'FH3': { 'c1': tomb } };
  const cloudStale = { 'FH3': { 'c1': cell(1, 2, T0) } };
  const rC = SL.mergeProgSafe(localTomb, cloudStale);
  ok(rC.poisoned === false, '撤回场景：本机 rv 高（墓碑）→ 不算中毒（云端 u 没有更新）');
  ok(rC.data.FH3.c1.rv === 5, '撤回场景：墓碑保住（防止离线旧版一推就长回来）');

  // 场景 D：个别格子差异（1-2 个）不触发整份替换（阈值：≥3 个且 ≥20%）
  const localD = { 'FH4': { 'c1': cell(0, 9, T0), 'c2': cell(1, 2, T0 + 86400000), 'c3': cell(1, 2, T0 + 86400000), 'c4': cell(1, 2, T0 + 86400000), 'c5': cell(1, 2, T0 + 86400000), 'c6': cell(1, 2, T0 + 86400000), 'c7': cell(1, 2, T0 + 86400000), 'c8': cell(1, 2, T0 + 86400000), 'c9': cell(1, 2, T0 + 86400000), 'c10': cell(1, 2, T0 + 86400000) } };
  const cloudD = { 'FH4': { 'c1': cell(1, 2, T0 + 86400000), 'c2': cell(1, 2, T0 + 86400000), 'c3': cell(1, 2, T0 + 86400000), 'c4': cell(1, 2, T0 + 86400000), 'c5': cell(1, 2, T0 + 86400000), 'c6': cell(1, 2, T0 + 86400000), 'c7': cell(1, 2, T0 + 86400000), 'c8': cell(1, 2, T0 + 86400000), 'c9': cell(1, 2, T0 + 86400000), 'c10': cell(1, 2, T0 + 86400000) } };
  const rD = SL.mergeProgSafe(localD, cloudD);
  ok(rD.poisoned === false, '阈值场景：10 格里只有 1 格异常（10%<20%）→ 不整份替换，只按格合并');
})();

// ---------- 第二组：verWatch 滚动窗口 + 本页版本 ----------
(function verwatch() {
  console.log('【verWatch 滚动窗口 + 本页版本自检】');
  ok(SCANLIB.indexOf('_verwatch_n') === -1, '旧「会话 2 次」预算已移除（_verwatch_n 不复存在）');
  ok(/_verwatch_hist/.test(SCANLIB), '新「滚动窗口」预算已就位（_verwatch_hist）');
  ok(/3600000/.test(SCANLIB), '窗口期为 60 分钟（3600000ms）');
  ok(/opt\.field && opt\.pageVer && j\[opt\.field\] && j\[opt\.field\] !== opt\.pageVer/.test(SCANLIB), 'verWatch 支持本页版本字段（opt.field/pageVer）');
})();

// ---------- 第三组：ver.json 与全站版本一致 ----------
(function verjsonCheck() {
  console.log('【ver.json 与全站版本一致】');
  ok(verjson.sl === '20261030a', 'ver.json sl = 20261030a', verjson.sl);
  ok(verjson.door === verjson.sl && verjson.innr === verjson.sl, 'door/innr 与 sl 一致（20261030a）',
     'door=' + verjson.door + ' innr=' + verjson.innr);
  const pages = ['viewer.html','发货计划系统.html','司机扫码.html','扫码.html','物料数据库.html',
                 '物流大屏.html','物流门口大屏.html','生成内部口令.html','账号管理.html'];
  let all = true, detail = [];
  for (const p of pages) {
    const h = fs.readFileSync(MIRROR + p, 'utf-8');
    const m = /scan-lib\.js\?v=([0-9a-zA-Z_-]+)/.exec(h);
    if (!m || m[1] !== verjson.sl) { all = false; detail.push(p + '=' + (m ? m[1] : '无')); }
  }
  ok(all, '全站 9 页 scan-lib ?v= 与 ver.json.sl 一致', detail.join(' ') || '全部 ' + verjson.sl);
})();

// ---------- 第四组：两块大屏的四件套 ----------
(function screens() {
  console.log('【大屏四件套：安全合并 / 定期强拉 / 中毒提示 / 本页版本】');
  for (const [P, field] of [['物流门口大屏.html', 'door'], ['物流大屏.html', 'innr']]) {
    const h = fs.readFileSync(MIRROR + P, 'utf-8');
    ok(/SL\.mergeProgSafe\s*\?\s*SL\.mergeProgSafe\(PROG,\s*rp\.value\)/.test(h.replace(/\r?\n\s*/g, ' ')), P + ' 进度合并走 mergeProgSafe（中毒自检）');
    ok(/forceProg/.test(h) && /pollN % 40/.test(h), P + ' 定期强制全文拉进度（约每 10 分钟无视戳）');
    ok(/progHeal/.test(h) && /已按云端校正本机缓存/.test(h), P + ' 中毒自愈在顶栏有提示');
    const m = new RegExp('verWatch\\(\\{\\s*field:\\s*"' + field + '"\\s*,\\s*pageVer:\\s*APP_VER\\s*\\}\\)').test(h.replace(/\r?\n\s*/g, ' ').replace(/"\s*\+\s*"/g, ''));
    ok(m, P + ' verWatch 已传本页版本（field=' + field + '）');
    ok(new RegExp('APP_VER\\s*=\\s*"[0-9a-z]+"').test(h), P + ' 已声明本页 APP_VER');
  }
})();

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
