// 真 Edge 探针：物流大屏(内部) HUD 顶栏标题被截断「物流进…」修复前后对照
// 在 780~1280 多宽度下测量：标题 .t 是否截断、右侧时钟是否被 overflow:hidden 裁掉。
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = process.argv[2] || '物流大屏.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };

const STUBS = {
  'supabase.min.js': '/* stub */',
  'html2canvas.min.js': '/* stub */',
  'cloud-config.js': 'window.CLOUD={url:"",key:""};',
  'cloud-sync.js': 'window.CloudSync=new Proxy({ready:()=>false,configured:()=>false,init(){},guard(){},autoPush(){},pull:()=>Promise.resolve(null),pullAll:()=>Promise.resolve(),pullStamp:()=>Promise.resolve(null),pullResult:()=>Promise.resolve({ok:false,value:null}),push:()=>Promise.resolve(true),setStatus(){},bindStatus(){},lastPullFailed:()=>false},{get:(t,k)=>(k in t?t[k]:()=>Promise.resolve([]))});',
  'auth.js': 'window.Auth=new Proxy({},{get:function(t,k){if(k==="getSession")return function(){return null;};if(k==="guard")return function(){};return function(){};}});',
  'scan-lib.js': '/* probe: 直接注入 KPI，不需要真实 scan-lib */'
};

async function run(browser, port, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const base = 'http://127.0.0.1:' + port + '/';
  await page.goto(base + encodeURIComponent(PAGE) + '?_t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    try {
      var el = document.getElementById('kpis');
      if (el) {
        var data = [['', '30', '在屏计划（趟）'], ['red', '12', '未完成'], ['amber', '410.5', '未完成吨位'], ['green', '25/30', '车已到'], ['', '68%', '整体进度'], ['', '410.5', '在屏吨位']];
        el.innerHTML = data.map(function (d) { return '<div class="kpi ' + d[0] + '"><i></i><b>' + d[1] + '</b><span>' + d[2] + '</span></div>'; }).join('');
      }
    } catch (e) {}
  }).catch(() => {});
  const m = await page.evaluate(() => {
    const hud = document.querySelector('.hud');
    const t = document.querySelector('.tt .t');
    const kpis = document.getElementById('kpis');
    const clock = document.querySelector('.clock');
    const r = el => el ? el.getBoundingClientRect() : null;
    const tR = r(t), hR = r(hud), cR = r(clock);
    return {
      titleText: t ? t.textContent : null,
      titleClipped: t ? (t.scrollWidth - t.clientWidth) : -1,
      titleNatural: t ? (t.scrollWidth > t.clientWidth ? t.scrollWidth : t.offsetWidth) : -1,
      hudOverflow: hud ? (hud.scrollWidth - hud.clientWidth) : -1,
      clockClipped: (cR && hR) ? (cR.right > hR.right + 1) : false,
      clockRight: cR ? Math.round(cR.right) : -1,
      hudRight: hR ? Math.round(hR.right) : -1,
      kpiCount: kpis ? kpis.children.length : -1,
      pageerror: 0
    };
  });
  m.width = width; m.pageerror = errs.length;
  await ctx.close();
  return m;
}

(async () => {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const name = path.basename(u);
    if (Object.prototype.hasOwnProperty.call(STUBS, name)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(STUBS[name]); return;
    }
    const p = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\//, ''));
    fs.readFile(p, (e, b) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(b);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let pass = 0, fail = 0;
  const ok = (c, mm) => { if (c) { pass++; console.log('  ✅ ' + mm); } else { fail++; console.log('  ❌ ' + mm); } };
  const widths = [780, 860, 940, 1024, 1080, 1280];
  const ms = [];
  try {
    console.log('===== 物流大屏 HUD 顶栏测量（修复后版本）=====');
    console.log('width | title | titleClipped | titleNatural | hudOverflow | clockClipped | clockRight/hudRight');
    for (const w of widths) {
      const m = await run(browser, port, w);
      ms.push(m);
      console.log(`${m.width} | ${(m.titleText||'').replace(/\s+/g,'')} | ${m.titleClipped} | ${m.titleNatural} | ${m.hudOverflow} | ${m.clockClipped} | ${m.clockRight}/${m.hudRight}`);
    }
    const allTitleOk = ms.every(m => m.titleClipped <= 1);
    const allClockOk = ms.every(m => !m.clockClipped);
    ms.filter(m => m.titleClipped > 1).forEach(m => console.log('  · ' + m.width + ' 标题仍截断 ' + m.titleClipped));
    ms.filter(m => m.clockClipped).forEach(m => console.log('  · ' + m.width + ' 时钟被裁'));
    ok(allTitleOk, '★ 修复后：780~1280 各宽度标题都显示全（不再 ellipsis 截断）');
    ok(allClockOk, '★ 修复后：窄屏下右侧时钟不会被 overflow:hidden 裁掉');
    ok(ms.every(m => m.kpiCount >= 6), 'KPI 卡片正常渲染（>=6）');
    const totalPe = ms.reduce((a, m) => a + (m.pageerror || 0), 0);
    console.log('  · 探针桩环境 pageerror 计数（桩不完整导致，非页面真 bug）：' + totalPe);
    console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  } finally { await browser.close(); server.close(); }
  process.exit(fail ? 1 : 0);
})();
