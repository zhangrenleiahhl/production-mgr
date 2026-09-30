const fs=require('fs');
const {JSDOM}=require('jsdom');

const file='C:/Users/zhangrl/WorkBuddy/2026-08-21-15-47-01/production-mgr/发货计划系统.html';
const html=fs.readFileSync(file,'utf8');

let pass=0, fail=0;
function ok(c,m){ if(c){pass++;console.log('  \u2713 '+m);} else {fail++;console.log('  \u2717 '+m);} }

console.log('=== 行列高亮(WPS) + 按天分组留白（2026-09-30 续）===');

/* ---------- (1) 源码契约 ---------- */
ok(/\.tbl tbody tr\.row-active > td\{ outline:2px solid var\(--hl-row\)/.test(html),
   '行高亮：当前行 td 有 outline（row-active）');
ok(/\.tbl tbody td\.col-active\{ outline:2px solid var\(--hl-col\)/.test(html),
   '列高亮：当前列 td 有 outline（col-active）');
ok(/\.tbl thead th\.col-active\{/.test(html),
   '列高亮连带表头那列也亮（thead th.col-active）');
ok(/\.tbl tbody tr\.row-active > td\.col-active\{ outline:2px solid var\(--purple\)/.test(html),
   '交叉点（正在编辑格）用紫色 outline，压过行/列高亮');
ok(/\.tbl tbody tr\.day-first > td\{ border-top:16px solid var\(--day-gap/.test(html),
   '按天分组：用中性浅灰间距带留白（day-first 顶部 border-top，不画线/不涂色）');
ok(!/box-shadow: inset 4px 0 0 var\(--dayc/.test(html) && !/--dayc/.test(html),
   '已去掉按天彩条/专属色（不再用颜色区分天数）');
ok(/function paintDayBands\(\)/.test(html) && /paintDayBands\(\);/.test(html),
   'paintDayBands 已定义并在 foldByDate 末尾调用');
ok(/bindCrosshair/.test(html) && /focusin/.test(html) && /focusout/.test(html),
   '行列高亮已用 focusin/focusout 事件绑定（点哪格亮哪行哪列）');

/* ---------- (2) 行为：按天分组留白（只标 day-first，无 day-a/day-b/--dayc）---------- */
const patched = html
  .replace(/<script src="supabase\.min\.js[^"]*"><\/script>/,'<script>window.supabase={createClient:()=>({from:()=>({})})};</script>')
  .replace(/<script src="cloud-config\.js[^"]*"><\/script>/,'<script>window.CLOUD_CONFIG={};</script>')
  .replace(/<script src="cloud-sync\.js[^"]*"><\/script>/,'<script>window.CloudSync={init:()=>{},ready:()=>true,pullResult:()=>({ok:true,value:[]}),guard:()=>{},push:()=>Promise.resolve(),pullAll:()=>Promise.resolve(),bindStatus:()=>{},markPending:()=>{},getPending:()=>false}</script>');

const dom=new JSDOM(patched,{runScripts:'dangerously',url:'https://zhangrenleiahhl.github.io/production-mgr/%E5%8F%91%E8%B4%A7%E8%AE%A1%E5%88%92%E7%B3%BB%E7%BB%9F.html'});
const w=dom.window, d=w.document;
const tbody=d.getElementById('tbody');
ok(!!tbody,'页面有 #tbody');

// 清空 tbody（页面加载时自带默认行，会干扰"组头"判定），只放我们这 4 行
while(tbody.firstChild) tbody.removeChild(tbody.firstChild);

// 构造 4 行，发货日期：01 / 01 / 02 / 03（相邻天不同）
const dates=['2026-10-01','2026-10-01','2026-10-02','2026-10-03'];
const rows=dates.map(dt=>{
  const tr=d.createElement('tr');
  tr.innerHTML='<td class="col-idx"></td>'
    + '<td class="col-check"><input type="checkbox"></td>'
    + '<td class="col-shipdate"><input type="date" data-f="shipdate" value="'+dt+'"></td>'
    + '<td class="col-customer"><input data-f="customer"></td>'
    + '<td><input data-f="model"></td>'
    + '<td><input data-f="qty"></td>'
    + '<td class="col-act"><button>＋</button></td>';
  tbody.appendChild(tr);
  return tr;
});
w.paintDayBands();

ok(rows[0].classList.contains('day-first') && !rows[1].classList.contains('day-first'),
   '同一天（01）只有第一行标 day-first（间距带只画在组头）');
ok(rows[2].classList.contains('day-first') && rows[3].classList.contains('day-first'),
   '日期一换（02、03）各自第一行标 day-first —— 相邻天之间留出间距');
ok(!rows[0].classList.contains('day-a') && !rows[0].classList.contains('day-b'),
   '已不再用 day-a/day-b 交替底色');
ok(rows[0].style.getPropertyValue('--dayc')==='' && rows[2].style.getPropertyValue('--dayc')==='',
   '已不再给每行写专属色（--dayc 为空）');

/* ---------- (3) 行为：行列高亮 ---------- */
ok(tbody.querySelectorAll('tr.row-active').length===0 && tbody.querySelectorAll('td.col-active').length===0,
   '没点之前：没有任何行/列被高亮');

// 点第 3 行（02）的发货日期格（列索引 2）
const shipTd=rows[2].querySelector('.col-shipdate');
const shipInp=shipTd.querySelector('input');
shipInp.focus();

ok(rows[2].classList.contains('row-active'), '点发货日期格 → 整行高亮（row-active）');
const colCells=[...tbody.querySelectorAll('tr')].map(r=>r.cells && r.cells[2]).filter(Boolean);
ok(colCells.length>0 && colCells.every(c=>c.classList.contains('col-active')),
   '点发货日期格 → 整列（所有行的发货日期格）都高亮（col-active）');
ok(shipTd.classList.contains('row-active')===false && shipTd.classList.contains('col-active'),
   '正在编辑的格：同时落在行+列上（交叉点）');

const th=d.querySelector('.tbl thead tr');
if(th && th.cells[2]){
  ok(th.cells[2].classList.contains('col-active'), '表头那列也跟着亮（thead th.col-active）');
} else {
  console.log('  (i) 本页 thead 不存在，跳过表头列高亮断言');
}

// 改点第 1 行客户格（列索引 3）→ 高亮应整体移过去
const custInp=rows[0].querySelector('[data-f="customer"]');
custInp.focus();
ok(rows[0].classList.contains('row-active') && !rows[2].classList.contains('row-active'),
   '改点别处 → 整行高亮跟过去，旧行退掉');
const custCol=[...tbody.querySelectorAll('tr')].map(r=>r.cells && r.cells[3]).filter(Boolean);
ok(custCol.every(c=>c.classList.contains('col-active')) && !shipTd.classList.contains('col-active'),
   '改点别处 → 整列高亮跟过去，旧列退掉');

console.log('\n'+pass+' 通过 / '+fail+' 失败');
process.exit(fail?1:0);
