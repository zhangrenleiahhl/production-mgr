/* 品一质保书（bz/bzv/bzt/bzb）专项测试 —— 2026-09-23 新增
   ★ 2026-09-24 起工序按人分工（名册 ops）：质保书由**仲崇雨**负责，
     所以下面 mark 质保书的操作人从「欧成义」改成了「仲崇雨」——
     用没权限的人去点会被数据层硬拦（这正是分工要的效果）。 */
/* 原注释：
   为什么单独立测试：能设能撤的状态必须带独立版本号（rt→rtv、cx→cxv 的老教训），
   合并写错的症状很隐蔽：点一下有反应、10 秒后拉取合并又弹回原样。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const MIRROR = 'D:/桌面/生产管理客户端/';
const SCANLIB = fs.readFileSync(MIRROR + 'scan-lib.js', 'utf8');
const STAFFCFG = fs.readFileSync(MIRROR + 'staff-config.js', 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'https://example.com/', runScripts: 'dangerously',
  beforeParse(w) { w.eval(SCANLIB); w.eval(STAFFCFG); },
});
const SL = dom.window.ScanLib;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
const eq = (a, b, m) => ok(a === b, m + (a === b ? '' : '（实=' + a + ' 期望=' + b + '）'));

console.log('=== ① applyBz 设 / 撤 / 幂等 ===');
let prog = {};
let r1 = SL.applyBz(prog, 'i1', '客户A|2026-09-23', true, '仲崇雨');
eq(r1.changed, true, '设置 → changed');
eq(r1.cell.bz, 1, '设置 → bz=1');
eq(r1.cell.bzv, 1, '设置 → bzv=1');
ok(r1.cell.bzt > 0, '设置 → bzt 有时间戳');
eq(r1.cell.bzb, '仲崇雨', '设置 → bzb=操作人');

let r2 = SL.applyBz(prog, 'i1', '客户A|2026-09-23', false, '仲崇雨');
eq(r2.changed, true, '撤掉 → changed');
eq(r2.cell.bz, 0, '撤掉 → bz=0');
eq(r2.cell.bzv, 2, '撤掉 → bzv=2（★ 独立版本号 +1）');
eq(r2.cell.bzt, 0, '撤掉 → bzt 清零');
eq(r2.cell.bzb, '', '撤掉 → bzb 清空');

let r3 = SL.applyBz(prog, 'i1', '客户A|2026-09-23', false, '仲崇雨');
eq(r3.changed, false, '重复撤 → 幂等 changed=false');

console.log('=== ② mergeCell：bzv 大者赢（跟 rv 解耦） ===');
// 本机低版本却带 bz=1，云端高版本 bz=0 → 云端赢（bz=0）
let m1 = SL.mergeCell({ bz: 1, bzv: 1, bzt: 111, bzb: '甲', rv: 9, s: 3 }, { bz: 0, bzv: 2, rv: 0 });
eq(m1.bz, 0, '云端 bzv=2 > 本机 1 → bz=0（不被高 rv 快照通吃）');
eq(m1.bzv, 2, 'bzv 取大者');
// 反过来：云端低版本、本机高版本
let m2 = SL.mergeCell({ bz: 0, bzv: 0, rv: 0 }, { bz: 1, bzv: 3, bzt: 222, bzb: '乙', rv: 1 });
eq(m2.bz, 1, 'bzv=3 的一方赢 → bz=1');
eq(m2.bzb, '乙', 'bzb 跟着赢的一方');
// 版本相同（含老数据没 bzv）：有值优先
let m3 = SL.mergeCell({ bz: 0, bzv: 0 }, { bz: 1, bzv: 0, bzt: 333, bzb: '丙' });
eq(m3.bz, 1, '同版本：有值优先 → bz=1');
eq(m3.bzb, '丙', '同版本：bzb 带出');
// 老数据（完全没有 bz 字段）不炸、默认 0
let m4 = SL.mergeCell({ s: 2, rv: 5 }, { s: 1, rv: 2 });
eq(m4.bz, 0, '老数据无 bz 字段 → 默认 0 不炸');
ok(m4.bzv === 0 && m4.bzt === 0, '老数据 → bzv/bzt 默认 0');

console.log('=== ③ mergeProg：纯 bz 格子（墓碑）不能丢 ===');
let mp = SL.mergeProg(
  // ★ 日期一律相对今天算，绝不写死（写死第二天就红：进度是按「客户|今天」查的）
  { i1: { ['客户A|' + SL.todayYmd()]: { s: 0, car: 0, rv: 0, rt: 0, cx: 0, bz: 1, bzv: 1, bzt: 444, bzb: '丁' } } },
  {}
);
ok(mp.i1 && mp.i1['客户A|' + SL.todayYmd()] && mp.i1['客户A|' + SL.todayYmd()].bz === 1, '只有 bz 的格子合并后保留');

console.log('=== ④ boardRows：把 bz/bzt/bzb 带给大屏/扫码页 ===');
const rec = { id: 1, no: 'NO001', planner: '张三', shipdate: SL.todayYmd(),
  rows: [{ customer: '客户A', shipdate: SL.todayYmd(), ton: 10, qty: 2, logistics: '德邦', models: ['M1'] }] };
const bzProg = { i1: { ['客户A|' + SL.todayYmd()]: { s: 1, t: 555, car: 0, rv: 1, bz: 1, bzv: 1, bzt: 666, bzb: '仲崇雨' } } };
const rows = SL.boardRows([rec], bzProg);
eq(rows.length, 1, '出一行');
eq(rows[0].bz, 1, '行带 bz=1');
eq(rows[0].bzb, '仲崇雨', '行带 bzb');
ok(rows[0].bzt === 666, '行带 bzt');

console.log('=== ⑤ 门禁：质保书不绑工序，没好也能推「已完成」（2026-09-30 起） ===');
{
  const pg = {};
  SL.applyCar(pg, 'i1', 'C|d', 1);
  SL.applyStep(pg, 'i1', 'C|d', +1, ''); SL.applyStep(pg, 'i1', 'C|d', +1, '');
  eq(pg.i1['C|d'].s, 2, '车已到 → 先推到「装货中」');
  // 质保书没好（bz=0）照样能推到「已完成」
  const go = SL.applyStep(pg, 'i1', 'C|d', +1, '');
  eq(go.changed, true, '★ 质保书没好（bz=0）也能推「已完成」');
  eq(go.blocked || '', '', '  没有质保书门槛（放行）');
  eq(pg.i1['C|d'].s, 3, '  工序推进到「已完成」s=3');
  eq(SL.stepBlock({ car: 1, bz: 0 }, 3), '', '  stepBlock 同一口径：质保书不绑工序');
  eq(SL.stepBlock({ car: 1, bz: 1 }, 3), '', '  质保书好了也一样放行');
  eq(SL.stepBlock({ car: 1, bz: 0 }, 2), '', '  「装货中」也不看质保书（货可以先上车）');
  // 先标质保书，再验证「已完成」后不能撤（2026-09-24 收紧，防「已完成+未确认」）
  SL.applyBz(pg, 'i1', 'C|d', 1, '仲崇雨');
  eq(pg.i1['C|d'].bz, 1, '  质保书标上了（bz=1）');
  const rb = SL.applyBz(pg, 'i1', 'C|d', 0, '仲崇雨');
  eq(rb.changed, false, '  已完成之后不能撤质保书');
  ok(/不能撤回/.test(rb.blocked || ''), '  撤回被拦且带原因：' + rb.blocked);
  eq(pg.i1['C|d'].s, 3, '  工序仍是已完成（不被悄悄改动）');
  eq(SL.applyUndo(pg, 'i1', 'C|d', 'x').changed, true, '★ 「已完成」还能撤回（门禁只拦往前走，不锁死）');
  eq(pg.i1['C|d'].s, 2, '  撤回退回「装货中」');
  eq(SL.applyBz(pg, 'i1', 'C|d', 0, '仲崇雨').changed, true, '  工序退回后质保书又能撤（不锁死）');
}


console.log('=== ⑦ 免质保书客户（2026-09-24 名单）：读数自动当「已备好」 ===');
{
  ok(typeof SL.bzExempt === 'function', '导出 bzExempt()');
  ok(SL.bzExempt('海立铸造') && SL.bzExempt('派格') && SL.bzExempt('恒精') && SL.bzExempt('宇泰精密'), '名单内精确命中');
  ok(SL.bzExempt('土耳其法雷奥') && SL.bzExempt('法国法雷奥') && SL.bzExempt('匈牙利舍弗勒') && SL.bzExempt('日本法雷奥') && SL.bzExempt('突尼斯法雷奥'), '国家前缀盖住云端实际名（法雷奥/舍弗勒）');
  ok(SL.bzExempt('尼得科-丰泰') && SL.bzExempt('尼得科-苏州丰泰'), '尼得科前缀');
  ok(SL.bzExempt('宁波泰友（宁波甬微进仓）') && SL.bzExempt('上海海立新能源（央禾富提）') && SL.bzExempt('南昌海立电器有限公司') && SL.bzExempt('海立电器（印度）有限公司'), '带后缀的实际名也命中');
  ok(!SL.bzExempt('芜湖海立新能源') && !SL.bzExempt('安徽海立精密铸造有限公司上海分公司'), '★ 名单外不误伤（芜湖/安徽海立不在名单）');
  ok(SL.bzExempt('新尼亚文') && SL.bzExempt('昆山衍咏') && SL.bzExempt('上海三菱'), 'v3 名单：新尼亚文/昆山衍咏/上海三菱');
  ok(!SL.bzExempt('芜湖海立新能源（昆山衍咏提货）') && !SL.bzExempt('芜湖海立新能源（昆山衍咏提走发）'), '★ 「昆山衍咏」前缀不吃掉芜湖海立（开头是芜湖）');
  eq(SL.stepBlock({ car: 1, bz: 0 }, 3, '派格'), '', '★ 免质保书客户：bz=0 同样不拦「已完成」');
  eq(SL.stepBlock({ car: 1, bz: 0 }, 3, '合肥某某'), '', '非免质保书客户同样不拦（质保书不绑工序，只卡车到）');
  const recP = { id: 2, no: 'NO002', planner: '李四', shipdate: SL.todayYmd(),
    rows: [{ customer: '派格', shipdate: SL.todayYmd(), ton: 5, qty: 1, logistics: '德邦', models: ['M2'] }] };
  const rowsP = SL.boardRows([recP], { i2: { ['派格|' + SL.todayYmd()]: { s: 1, car: 1, rv: 1, bz: 0 } } });
  eq(rowsP.length, 1, '免质保书客户出一行');
  eq(rowsP[0].bz, 1, 'boardRows：免质保书客户 bz 读出 1（大屏/扫码页自动「已备好」）');
  eq(rowsP[0].bzAuto, true, '  且带 bzAuto 标记（云端其实没标）');
  ok(rowsP[0].bzt === 0 && rowsP[0].bzb === '', '  bzt/bzb 仍为空（没冒充真数据）');
  const pg = {};
  SL.applyCar(pg, 'i2', '派格|d', 1);
  SL.applyStep(pg, 'i2', '派格|d', +1, ''); SL.applyStep(pg, 'i2', '派格|d', +1, '');
  eq(SL.applyStep(pg, 'i2', '派格|d', +1, '').changed, true, '★ 免质保书客户：装货中 → 已完成 直接放行');
  eq(pg.i2['派格|d'].s, 3, '  s=3');
  ok(!pg.i2['派格|d'].bz, '  云端 bz 数据没被偷偷写 1');
}

console.log('=== ⑧ 名册 19 人 ===')
eq(SL.staffUsers().length, 19, '名册 19 人（含欧成义/仲崇雨/蔡磊）');
ok(SL.staffUsers().some(u => u.phone === '15705659960'), '欧成义 15705659960 在名册');
ok(SL.staffUsers().some(u => u.phone === '13195550629'), '仲崇雨 13195550629 在名册');

console.log('\n合计: ' + pass + ' 过 / ' + fail + ' 败');
process.exit(fail ? 1 : 0);
