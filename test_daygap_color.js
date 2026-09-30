const fs=require('fs');
const {JSDOM}=require('jsdom');

const file='C:/Users/zhangrl/WorkBuddy/2026-08-21-15-47-01/production-mgr/发货计划系统.html';
const html=fs.readFileSync(file,'utf8');

let pass=0, fail=0;
function ok(c,m){ if(c){pass++;console.log('  \u2713 '+m);} else {fail++;console.log('  \u2717 '+m);} }

console.log('=== 按天间距带颜色自选（2026-09-30 续）===');

/* ---------- (1) 源码契约 ---------- */
ok(/\.tbl tbody tr\.day-first > td\{ border-top:16px solid var\(--day-gap, #000\)/.test(html),
   '间距带改用 CSS 变量 var(--day-gap)，默认黑色');

/* ---------- (2) 行为：取色器 + 持久化 + 实时变色 ---------- */
const patched = html
  .replace(/<script src="supabase\.min\.js[^"]*"><\/script>/,'<script>window.supabase={createClient:()=>({from:()=>({})})};</script>')
  .replace(/<script src="cloud-config\.js[^"]*"><\/script>/,'<script>window.CLOUD_CONFIG={};</script>')
  .replace(/<script src="cloud-sync\.js[^"]*"><\/script>/,'<script>window.CloudSync={init:()=>{},ready:()=>true,pullResult:()=>({ok:true,value:[]}),guard:()=>{},push:()=>Promise.resolve(),pullAll:()=>Promise.resolve(),bindStatus:()=>{},markPending:()=>{},getPending:()=>false}</script>');

const dom=new JSDOM(patched,{runScripts:'dangerously',url:'https://zhangrenleiahhl.github.io/production-mgr/%E5%8F%91%E8%B4%A7%E8%AE%A1%E5%88%92%E7%B3%BB%E7%BB%9F.html'});
const w=dom.window, d=w.document;

const inp=d.getElementById('dayGapColor');
ok(!!inp,'工具栏存在「间距色」取色器 #dayGapColor');
ok(inp && inp.tagName==='INPUT' && inp.type==='color','#dayGapColor 是 input[type=color]');

// 选一个自定义颜色 -> 触发 input 事件
if(inp){
  inp.value='#ff8800';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));
}
ok(w.localStorage.getItem('DAY_GAP_COLOR')==='#ff8800','选色后已写入 localStorage(DAY_GAP_COLOR)');
ok((d.documentElement.style.getPropertyValue('--day-gap')||'').trim()==='#ff8800',
   '选色后 --day-gap 已应用到根节点（间距带实时变色）');

// 下次打开：init 块会读 localStorage 的 DAY_GAP_COLOR，回显到取色器 + 应用到 --day-gap（源码契约）
ok(/initDayGapColor/.test(html)
   && /localStorage\.getItem\(DAY_GAP_KEY\)/.test(html)
   && /inp\.value = saved/.test(html)
   && /document\.documentElement\.style\.setProperty\("--day-gap", saved\)/.test(html),
   '下次打开：init 读 localStorage(DAY_GAP_COLOR) 并回显到取色器 + 应用到 --day-gap');
// 用页面已暴露的 applyDayGapColor 复核"写入+应用"链路（runScripts:dangerously 下顶层函数挂在 window 上）
ok(typeof w.applyDayGapColor==='function','页面暴露了 applyDayGapColor');
w.applyDayGapColor('#ff8800');
ok(w.localStorage.getItem('DAY_GAP_COLOR')==='#ff8800' && (d.documentElement.style.getPropertyValue('--day-gap')||'').trim()==='#ff8800',
   'applyDayGapColor 同时写 localStorage 并应用到 --day-gap');

console.log('\n测试 daygap_color：'+pass+' 通过 / '+fail+' 失败');
process.exit(fail?1:0);
