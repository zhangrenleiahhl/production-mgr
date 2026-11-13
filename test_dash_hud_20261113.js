// 守护测试：物流大屏（内部）/ 物流门口大屏 顶栏标题不再被 ellipsis 截断（2026-11-13）
// 根因：HUD 弹性行里 .tt 是唯一 flex-shrink 元素，窄屏时被压窄 + text-overflow:ellipsis 把
// 「物流进度 内部」截成「物流进…」。修复：.tt 改为 flex:0 0 auto（永不收缩）+ 去掉 ellipsis；
// 窄屏的弹性空间让给 .warnbadge（可收缩、长警示可省略号）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const DIR = 'C:/Users/zhangrl/WorkBuddy/2026-08-21-15-47-01/production-mgr';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

function read(f) { try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch (e) { return ''; } }

const innr = read('物流大屏.html');
const door = read('物流门口大屏.html');
const vj = JSON.parse(read('ver.json') || '{}');

// 抽取某个 CSS 规则块（从 选择器{ 到匹配的 }）
function ruleOf(src, sel) {
  const i = src.indexOf(sel);
  if (i < 0) return '';
  const j = src.indexOf('{', i);
  if (j < 0) return '';
  let d = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) { k++; break; } }
  }
  return src.slice(j, k);
}

console.log('===== 大屏 HUD 标题截断修复（源码守护）=====');
ok(ruleOf(innr, '.tt{').indexOf('flex:0 0 auto') >= 0, '★ 内部屏 .tt 改为 flex:0 0 auto（标题永不收缩）');
ok(ruleOf(innr, '.tt .t{').indexOf('text-overflow:ellipsis') < 0, '★ 内部屏 .tt .t 已去掉 text-overflow:ellipsis（标题不再截断）');
ok(ruleOf(innr, '.warnbadge{').indexOf('flex:0 1 auto') >= 0, '★ 内部屏 .warnbadge 可收缩（窄屏让出空间兜底）');
ok(ruleOf(innr, '.warnbadge .wb-text{').indexOf('text-overflow:ellipsis') >= 0, '★ 内部屏 警示长文可省略号');
ok(innr.indexOf('<span class="wb-text">') >= 0, '★ 内部屏 warnbadge 已用 wb-text 包住长警示文字');

ok(ruleOf(door, '.tt{').indexOf('flex:0 0 auto') >= 0, '★ 门口屏 .tt 改为 flex:0 0 auto（标题永不收缩）');
ok(ruleOf(door, '.tt .t{').indexOf('text-overflow:ellipsis') < 0, '★ 门口屏 .tt .t 已去掉 text-overflow:ellipsis（标题不再截断）');

const ver = vj.innr, ver2 = vj.door;
ok(innr.indexOf('const APP_VER = "' + ver + '"') >= 0, '★ 内部屏 APP_VER 与 ver.json.innr 一致（' + ver + '）');
ok(door.indexOf('const APP_VER = "' + ver2 + '"') >= 0, '★ 门口屏 APP_VER 与 ver.json.door 一致（' + ver2 + '）');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
