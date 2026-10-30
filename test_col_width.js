// 守护测试：发货计划系统「客户订单号」列加长 + 「物料编码」列缩短 + 两列自动换行完整显示
// 读镜像 D:/桌面/生产管理客户端/发货计划系统.html（与其它测试一致）
const fs = require('fs');
const path = require('path');

const FILE = 'D:/桌面/生产管理客户端/发货计划系统.html';
let ok = 0, bad = 0;
function ok_(c, m, e) { if (c) { ok++; console.log('  ✅', m, e === undefined ? '' : '(' + e + ')'); } else { bad++; console.log('  ❌', m, e === undefined ? '' : '(' + e + ')'); } }
function eq(a, b, m) { ok_(a === b, m, '实际=' + a + ' 期望=' + b); }

const html = fs.readFileSync(FILE, 'utf8');

console.log('\n=== ① 列宽：客户订单号加长 / 物料编码缩短 / 合计仍 100% ===');
function w(n) {
  const m = html.match(new RegExp('nth-child\\(' + n + '\\),\\.tbl tbody td:nth-child\\(' + n + '\\)\\{width:([0-9.]+)%'));
  return m ? parseFloat(m[1]) : null;
}
const widths = [];
for (let i = 1; i <= 17; i++) widths.push(w(i));
ok_(widths.every(x => x !== null), '17 列宽度全部可解析', widths.join(','));
const total = widths.reduce((a, b) => a + b, 0);
eq(total, 100, '17 列宽度合计 = 100%');
ok_(w(15) >= 6, '客户订单号列 ≥6%', w(15) + '%');
ok_(w(15) >= 6, '客户订单号列 ≥6%', w(15) + '%');
ok_(w(16) <= 4.5, '物料编码列保持 ≤4.5%（2026-10-30 还原：扩大按钮≠扩大列）', w(16) + '%');
ok_(w(3) <= 8, '发货日期列已缩短到 ≤8%', w(3) + '%');
ok_(w(17) <= 3, '操作列已缩短到 ≤3%', w(17) + '%');
ok_(w(5) >= 17, '型号列保持 ≥17%（2026-10-30 还原：型号名最长）', w(5) + '%');
ok_(w(5) > w(15), '型号列比客户订单号列宽（型号名最长）', w(5) + '% vs ' + w(15) + '%');

console.log('\n=== ② 两列表头允许折行（窄屏不裁字）===');
ok_(/\.tbl thead th\.col-order\{[^}]*white-space:normal/.test(html), '「客户订单号」表头允许折行');
ok_(/\.tbl thead th\.col-code\{[^}]*white-space:normal/.test(html), '「物料编码」表头允许折行');
ok_(/<th class="col-order"[^>]*>客户订单号</.test(html), '表头有 col-order 类');
ok_(/<th class="col-code"[^>]*>物料编码</.test(html), '表头有 col-code 类');

console.log('\n=== ③ 两列 textarea 可换行（原来 nowrap 会裁字）===');
const oRule = html.match(/\.tbl tbody td:nth-child\(15\) textarea\{[^}]*\}/);
const cRule = html.match(/\.tbl tbody td:nth-child\(16\) textarea\{[^}]*\}/);
ok_(!!oRule, '存在 nth-child(15) textarea 规则');
ok_(!!cRule, '存在 nth-child(16) textarea 规则');
ok_(oRule && /white-space:pre-wrap/.test(oRule[0]), '客户订单号 textarea = pre-wrap（可换行）', oRule && oRule[0].slice(0, 90));
ok_(cRule && /white-space:pre-wrap/.test(cRule[0]), '物料编码 textarea = pre-wrap（可换行）', cRule && cRule[0].slice(0, 90));
ok_(oRule && !/white-space:nowrap/.test(oRule[0]), '客户订单号已去掉 nowrap');
ok_(cRule && !/white-space:nowrap/.test(cRule[0]), '物料编码已去掉 nowrap');
ok_(oRule && /height:auto/.test(oRule[0]), '客户订单号 height:auto（交给 fitTextarea 撑高）');
ok_(cRule && /height:auto/.test(cRule[0]), '物料编码 height:auto（交给 fitTextarea 撑高）');
ok_(cRule && /word-break:break-all/.test(cRule[0]), '物料编码用 break-all（编码无空格，任意位置断行）');

console.log('\n=== ④ 「复制」按钮：增大 + 常显 + 永远最上层（2026-10-29 改版）===');
ok_(/\.copy-code\{[^}]*width:18px[^}]*height:18px/.test(html), '复制按钮已增大到 18×18px');
ok_(/\.copy-code\{[^}]*z-index:30/.test(html), '★ z-index 拉满（永远在最上层，不会被编码文字压住）');
ok_(/\.copy-code\{[^}]*opacity:\.9/.test(html), '★ 按钮常显（不用悬停才出现）');
ok_(/\.copy-code\{[^}]*right:2px; bottom:2px/.test(html), '★ 按钮在格子右下角空白区（编码是居中的，右上角必定压字）');
ok_(/\.col-code:focus-within \.copy-code\{[^}]*opacity:0/.test(html), '聚焦编辑时按钮让位（不遮正在编辑的字）');
ok_(/\.copy-code:hover\{[^}]*opacity:1/.test(html), '悬停时变实心');
ok_(!/\.col-code \.code-wrap textarea\[data-f="code"\]\{[^}]*font-size:13px/.test(html), '编码字号保持默认（2026-10-30 还原：不改字号）');
ok_(html.indexOf('>⧉</button>') > 0, '按钮文案是图标 ⧉（18px 小方块放不下两个汉字）');
ok_(/isIcon=\(o==="/.test(html), '复制后图标换成 ✓（小方块放不下「已复制」三个字）');

console.log('\n=== ⑤ 字段链路仍然完整（订单号不丢）===');
ok_(/data-f="orderno"/.test(html), '行里有 orderno 输入框');
ok_(/orderno:f\(b\.orderno\)/.test(html), '发布记录带 orderno');
ok_(/orderno:R\.orderno/.test(html), '草稿带 orderno');
ok_(/logistics:r\.logistics,\s*orderno/.test(html) || /orderno:r\.orderno/.test(html), '从发布记录导回编辑器带 orderno');
ok_(/PASTE_COLS_V2/.test(html), '粘贴列映射含新版（14 列）');
ok_(html.indexOf('20261029c') > 0, 'APP_VER 已 bump 到 20261029c');
ok_(/nth-child\(15\) textarea\{[^}]*font-size:10px/.test(html), '客户订单号字号 10px（缩小一档）');
ok_(/thead th\.col-act\{[^}]*white-space:normal/.test(html), '「操作」表头允许折行（3% 窄列）');
ok_(/id="dashAnalyzeLink"[^>]*href="数据透析\.html"/.test(html), '工具栏有「📊 数据透析」入口');

console.log('\n通过 ' + ok + ' / 失败 ' + bad);
process.exit(bad ? 1 : 0);
