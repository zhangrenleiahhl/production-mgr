/* ==========================================================================
 * festival-skin.js  —  海立铸运通生产管理系统 · 中国传统节日皮肤
 * --------------------------------------------------------------------------
 * 设计口径（2026-11-06）
 *  ① 法定节假日：按国务院办公厅公布的【放假起止日】，假期里【每天】都显示
 *     该节日皮肤，并显示「假期第 N 天 / 共 N 天」；调休上班日单独提示。
 *  ② 传统节日：除夕/春节/元宵/端午/七夕/中元/中秋/重阳/腊八，内置
 *     2026-2030 精确公历日期表（运行时零计算，兼容老电视浏览器）。
 *  ③ 二十四节气：太阳黄经近似公式 + 2026/2027 权威表校正；节气当天醒目，
 *     平时以「当前节气」淡雅常驻，全年有中国味但不打扰生产。
 *  ④ 优先级：预览 > 法定假期 > 调休上班 > 传统节日 > 节气当天 > 当前节气。
 *  ⑤ 全站零依赖、零外链资源、不改动任何业务 CSS 变量、不改表格/按钮配色；
 *     所有 DOM 都是 pointer-events:none 的浮层，只有徽章与预览面板可点。
 *  ⑥  iframe 内不显示（外壳页统一显示一次，避免重复）；跨零点自动换肤；
 *     深浅主题自动适配；打印时自动隐藏；任何异常都静默降级，绝不白屏。
 *
 * URL 参数（方便预览与验收）
 *  ?festival=chunjie   强制预览某个皮肤（id 见 THEMES）；?festival=auto 取消
 *  ?fs=off / on        关闭 / 重新打开皮肤（记忆在 localStorage）
 *  ?fs=strong          加强装饰（默认 normal）
 *  点击徽章文字       展开「节日/节气预览面板」，点任一格立即试穿
 * ========================================================================== */
(function () {
  'use strict';

  var VER = '20261106a';
  var KEY_OFF = 'festival_skin_off_v1';
  var KEY_PREVIEW = 'festival_skin_preview_v1';

  /* ---------- 小工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function kOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function todayK() { var d = new Date(); return kOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function dateK(d) { return kOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function parseK(s) { var a = String(s).split('-'); return new Date(+a[0], +a[1] - 1, +a[2], 12); }
  function addDays(s, n) { var d = parseK(s); d.setDate(d.getDate() + n); return dateK(d); }
  function daysBetween(a, b) { return Math.round((parseK(b) - parseK(a)) / 86400000); }
  function qs(n) { var m = new RegExp('[?&]' + n + '=([^&#]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- ① 法定节假日放假表（国务院办公厅通知原文） ----------
   * [节日id, 放假起, 放假止, 调休上班日数组]
   * 2026：国办发明电〔2025〕7号（2025-11-04 发布）
   * 2027：国办发明电〔2026〕10号（2026-11-05 发布）
   * ★ 每年 11 月国务院发布次年安排后，在这里补一年即可。
   */
  var HOLIDAYS = {
    2026: [
      ['yuandan', '01-01', '01-03', ['01-04']],
      ['chunjie', '02-15', '02-23', ['02-14', '02-28']],
      ['qingming', '04-04', '04-06', []],
      ['laodong', '05-01', '05-05', ['05-09']],
      ['duanwu', '06-19', '06-21', []],
      ['zhongqiu', '09-25', '09-27', []],
      ['guoqing', '10-01', '10-07', ['09-20', '10-10']]
    ],
    2027: [
      ['yuandan', '01-01', '01-03', []],
      ['chunjie', '02-05', '02-13', ['01-31', '02-14']],
      ['qingming', '04-03', '04-05', []],
      ['laodong', '05-01', '05-05', ['05-08']],
      ['duanwu', '06-09', '06-09', []],
      ['zhongqiu', '09-15', '09-15', []],
      ['guoqing', '10-01', '10-07', ['09-26', '10-09']]
    ]
  };

  /* ---------- ② 传统节日（农历）公历日期表 2026-2030 ----------
   * 由 ICU 中国农历生成，并用国务院放假通知的官方农历标注校正：
   * 2027 春节 ICU 给 02-07，官方通知写明「2月5日除夕」→ 正月初一 02-06，
   * 故 2027 的 除夕/春节/元宵 整体前移 1 天（02-05 / 02-06 / 02-20）。
   * 2026 与官方完全吻合（除夕 02-16、春节 02-17、端午 06-19、中秋 09-25）。
   */
  var LUNAR_FEST = {
    2026: { laba: '01-26', chuxi: '02-16', chunjie: '02-17', yuanxiao: '03-03', duanwu: '06-19', qixi: '08-19', zhongyuan: '08-27', zhongqiu: '09-25', chongyang: '10-18' },
    2027: { laba: '01-14', chuxi: '02-05', chunjie: '02-06', yuanxiao: '02-20', duanwu: '06-09', qixi: '08-08', zhongyuan: '08-16', zhongqiu: '09-15', chongyang: '10-08' },
    2028: { laba: '01-04', chuxi: '01-25', chunjie: '01-26', yuanxiao: '02-09', duanwu: '05-28', qixi: '08-26', zhongyuan: '09-03', zhongqiu: '10-03', chongyang: '10-26' },
    2029: { laba: '01-22', chuxi: '02-12', chunjie: '02-13', yuanxiao: '02-27', duanwu: '06-16', qixi: '08-16', zhongyuan: '08-24', zhongqiu: '09-22', chongyang: '10-16' },
    2030: { laba: '01-11', chuxi: '02-01', chunjie: '02-02', yuanxiao: '02-16', duanwu: '06-05', qixi: '08-05', zhongyuan: '08-13', zhongqiu: '09-12', chongyang: '10-05' }
  };

  /* ---------- ③ 二十四节气 ----------
   * 顺序：小寒(1月) 大寒(1月) 立春(2月) …… 大雪(12月) 冬至(12月)
   * 月份 = floor(n/2)+1。经典 1900-2100 近似公式，2026/2027 用权威表校正。
   */
  var TERM_INFO = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551,
    218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210,
    440795, 462224, 483532, 504758];
  var TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
  /* 近似公式与权威节气表的偏差校正（2026 芒种：公式 6 日，权威 5 日） */
  var TERM_FIX = { '2026-10': 5 };
  var TERM_TABLE = {
    2026: [5, 20, 4, 18, 5, 20, 5, 20, 5, 21, 5, 21, 7, 23, 7, 23, 7, 23, 8, 23, 7, 22, 7, 22],
    2027: [5, 20, 4, 19, 6, 21, 5, 20, 6, 21, 6, 21, 7, 23, 8, 23, 8, 23, 8, 23, 7, 22, 7, 22]
  };
  function termDay(y, n) {
    var tab = TERM_TABLE[y]; if (tab) return tab[n];
    var fix = TERM_FIX[y + '-' + n]; if (fix) return fix;
    try {
      var t = 31556925974.7 * (y - 1900) + TERM_INFO[n] * 60000 + Date.UTC(1900, 0, 6, 2, 5);
      return new Date(t).getUTCDate();
    } catch (e) { return [6, 20, 4, 19, 6, 21, 5, 20, 6, 21, 6, 21, 7, 23, 8, 23, 8, 23, 8, 23, 7, 22, 7, 22][n]; }
  }
  function termKey(y, n) { return kOf(y, Math.floor(n / 2) + 1, termDay(y, n)); }

  /* ---------- 皮肤主题 ----------
   * n 名称 / z 汉字徽记 / c1 c2 主渐变 / w 祝语或物候 / g 图案组
   */
  var THEMES = {
    /* 法定与传统节日 */
    yuandan:   { n: '元旦',   z: '旦', c1: '#d64b3f', c2: '#f2b34c', w: '一元复始，万象更新', g: 'star' },
    chuxi:     { n: '除夕',   z: '岁', c1: '#b81f2d', c2: '#f0a500', w: '辞旧迎新，阖家团圆', g: 'lantern' },
    chunjie:   { n: '春节',   z: '福', c1: '#c62828', c2: '#f0a500', w: '新春大吉，万事如意', g: 'lantern' },
    yuanxiao:  { n: '元宵',   z: '圆', c1: '#d33b3b', c2: '#ffb84d', w: '灯火万家，团圆美满', g: 'lantern' },
    qingming:  { n: '清明',   z: '清', c1: '#4c8c6b', c2: '#a8cba0', w: '清风拂柳，慎终追远', g: 'willow' },
    laodong:   { n: '劳动节', z: '勤', c1: '#d97706', c2: '#f6c453', w: '劳动最光荣', g: 'wheat' },
    duanwu:    { n: '端午',   z: '粽', c1: '#2e7d62', c2: '#8fc7a0', w: '粽叶飘香，安康顺遂', g: 'leaf' },
    qixi:      { n: '七夕',   z: '巧', c1: '#a4488f', c2: '#e6a6cd', w: '银河相会，乞巧祈愿', g: 'star' },
    zhongyuan: { n: '中元',   z: '思', c1: '#5b6b8c', c2: '#9aa9c4', w: '追思怀远，灯火寄情', g: 'moon' },
    zhongqiu:  { n: '中秋',   z: '月', c1: '#b8860b', c2: '#f2d68a', w: '花好月圆，阖家安康', g: 'moon' },
    guoqing:   { n: '国庆',   z: '华', c1: '#c62828', c2: '#f4b942', w: '盛世华诞，举国同庆', g: 'star' },
    chongyang: { n: '重阳',   z: '菊', c1: '#b9770e', c2: '#e8c46a', w: '登高望远，菊香敬老', g: 'chrys' },
    laba:      { n: '腊八',   z: '暖', c1: '#8d5524', c2: '#d9a566', w: '腊八粥暖，岁岁平安', g: 'bowl' },
    workday:   { n: '调休上班', z: '勤', c1: '#6b7688', c2: '#a9b4c4', w: '今日调休上班，注意作息', g: 'none' },
    /* 二十四节气 */
    xiaohan:   { n: '小寒', z: '寒', c1: '#3a5f8a', c2: '#a2bfd9', w: '雁北乡，寒渐深', g: 'winter' },
    dahan:     { n: '大寒', z: '寒', c1: '#2b4f7a', c2: '#93b3d1', w: '岁末极寒，静待春归', g: 'winter' },
    lichun:    { n: '立春', z: '春', c1: '#2f7d5b', c2: '#9ed4a8', w: '东风解冻，万物始生', g: 'spring' },
    yushui:    { n: '雨水', z: '雨', c1: '#3c8a86', c2: '#a8d8d0', w: '天一生水，润物无声', g: 'spring' },
    jingzhe:   { n: '惊蛰', z: '蛰', c1: '#4f8f52', c2: '#b9d98a', w: '春雷始鸣，蛰虫惊醒', g: 'spring' },
    chunfen:   { n: '春分', z: '分', c1: '#3f8f6f', c2: '#a8d5a2', w: '昼夜均分，燕子归来', g: 'spring' },
    guyu:      { n: '谷雨', z: '谷', c1: '#5a9b63', c2: '#c1dca0', w: '雨生百谷，春色将阑', g: 'spring' },
    lixia:     { n: '立夏', z: '夏', c1: '#c0563f', c2: '#f0b27a', w: '蝼蝈鸣，夏木成荫', g: 'summer' },
    xiaoman:   { n: '小满', z: '满', c1: '#c98a2e', c2: '#efd07a', w: '麦粒渐满，小得盈满', g: 'summer' },
    mangzhong: { n: '芒种', z: '种', c1: '#b8862b', c2: '#e8c96a', w: '有芒之谷，可种可收', g: 'summer' },
    xiazhi:    { n: '夏至', z: '至', c1: '#cc4f3f', c2: '#f2a65a', w: '日北至，昼最长', g: 'summer' },
    xiaoshu:   { n: '小暑', z: '暑', c1: '#d2643f', c2: '#f4b26b', w: '温风至，荷香起', g: 'summer' },
    dashu:     { n: '大暑', z: '炎', c1: '#c0392b', c2: '#f08a5d', w: '腐草为萤，暑气至极', g: 'summer' },
    liqiu:     { n: '立秋', z: '秋', c1: '#b07d2b', c2: '#e3c27a', w: '凉风至，白露生', g: 'autumn' },
    chushu:    { n: '处暑', z: '凉', c1: '#a97933', c2: '#ddb878', w: '暑气止，秋意来', g: 'autumn' },
    bailu:     { n: '白露', z: '露', c1: '#8a8f6b', c2: '#d6dcc0', w: '露凝而白，鸿雁来', g: 'autumn' },
    qiufen:    { n: '秋分', z: '分', c1: '#b08a3e', c2: '#e8cf94', w: '雷始收声，昼夜再均', g: 'autumn' },
    hanlu:     { n: '寒露', z: '寒', c1: '#9a6b2f', c2: '#d9b274', w: '露气寒冷，菊有黄华', g: 'autumn' },
    shuangjiang:{n: '霜降', z: '霜', c1: '#8c5a3c', c2: '#d9a679', w: '霜华初降，草木黄落', g: 'autumn' },
    lidong:    { n: '立冬', z: '冬', c1: '#3b6a9c', c2: '#9fc4e0', w: '水始冰，地始冻', g: 'winter' },
    xiaoxue:   { n: '小雪', z: '雪', c1: '#4a7ba8', c2: '#b8d6ec', w: '虹藏不见，雪意初萌', g: 'winter' },
    daxue:     { n: '大雪', z: '雪', c1: '#35618f', c2: '#a6c8e4', w: '积雪盈野，万物冬藏', g: 'winter' },
    dongzhi:   { n: '冬至', z: '至', c1: '#2f5d8a', c2: '#8fb8dc', w: '一阳来复，昼渐长', g: 'winter' }
  };
  /* 节气 index → 主题 id（qingming 复用节日主题） */
  var TERM_IDS = ['xiaohan', 'dahan', 'lichun', 'yushui', 'jingzhe', 'chunfen', 'qingming', 'guyu',
    'lixia', 'xiaoman', 'mangzhong', 'xiazhi', 'xiaoshu', 'dashu',
    'liqiu', 'chushu', 'bailu', 'qiufen', 'hanlu', 'shuangjiang',
    'lidong', 'xiaoxue', 'daxue', 'dongzhi'];
  var FEST_IDS = ['yuandan', 'chuxi', 'chunjie', 'yuanxiao', 'qingming', 'laodong', 'duanwu',
    'qixi', 'zhongyuan', 'zhongqiu', 'guoqing', 'chongyang', 'laba'];

  /* ---------- 农历中文（用于徽章副标题，可选） ---------- */
  var LM = ['', '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  function cnDay(n) {
    if (n === 10) return '初十'; if (n === 20) return '二十'; if (n === 30) return '三十';
    if (n < 10) return '初' + '一二三四五六七八九'[n - 1];
    if (n < 20) return '十' + '一二三四五六七八九'[n - 11];
    if (n < 30) return '廿' + '一二三四五六七八九'[n - 21];
    return '三十';
  }
  function lunarText(k) {
    try {
      var f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
      var ps = f.formatToParts(parseK(k)), mo = '', da = '';
      for (var i = 0; i < ps.length; i++) { if (ps[i].type === 'month') mo = ps[i].value; if (ps[i].type === 'day') da = ps[i].value; }
      var m = parseInt((String(mo).match(/\d+/) || [0])[0], 10), d = parseInt((String(da).match(/\d+/) || [0])[0], 10);
      if (m >= 1 && m <= 12 && d >= 1) return (/闰|bis/i.test(mo) ? '闰' : '') + LM[m] + '月' + cnDay(d);
    } catch (e) {}
    return '';
  }

  /* ---------- 判定：今天该穿哪套皮肤 ---------- */
  function findHoliday(k) {
    var y = +k.slice(0, 4), md = k.slice(5), list = HOLIDAYS[y];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i], from = y + '-' + it[1], to = y + '-' + it[2];
      if (md >= it[1] && md <= it[2]) {
        return { id: it[0], from: from, to: to, day: daysBetween(from, k) + 1, total: daysBetween(from, to) + 1 };
      }
      for (var j = 0; j < it[3].length; j++) if (md === it[3][j]) return { workday: true, id: it[0] };
    }
    return null;
  }
  function findLunarFest(k) {
    var y = +k.slice(0, 4), md = k.slice(5), t = LUNAR_FEST[y];
    if (!t) return null;
    for (var id in t) if (t.hasOwnProperty(id) && t[id] === md) return id;
    return null;
  }
  function currentTerm(k) {
    var y = +k.slice(0, 4), best = null;
    for (var yy = y - 1; yy <= y; yy++) {
      for (var n = 0; n < 24; n++) {
        var kk = termKey(yy, n);
        if (kk <= k && (!best || kk > best.k)) best = { k: kk, n: n, id: TERM_IDS[n] };
      }
    }
    return best;
  }

  function pick(k) {
    k = k || todayK();
    if (qs('festival') === 'auto') ssDel(KEY_PREVIEW);   // 显式回到自动：连会话预览一起清掉
    var prev = qs('festival') || ssGet(KEY_PREVIEW);
    if (prev && prev !== 'auto' && THEMES[prev]) {
      return { id: prev, t: THEMES[prev], level: 'festive', sub: '预览中 · 点「自动」返回', preview: true };
    }
    /* 1. 法定假期（每天显示）/ 调休上班 */
    var h = findHoliday(k);
    if (h && h.workday) {
      return { id: 'workday', t: THEMES.workday, level: 'calm', sub: '今日调休上班 · ' + (THEMES[h.id] ? THEMES[h.id].n : '') };
    }
    var extra = '';
    if (h) {
      var ct = currentTerm(k);
      if (ct && ct.k === k) extra = ' · 今日' + TERM_NAMES[ct.n];
      return {
        id: h.id, t: THEMES[h.id] || THEMES.yuandan, level: 'festive',
        sub: '假期第 ' + h.day + ' 天 / 共 ' + h.total + ' 天' + extra, holiday: h
      };
    }
    /* 2. 传统节日当天 */
    var lf = findLunarFest(k);
    if (lf && THEMES[lf]) {
      return { id: lf, t: THEMES[lf], level: 'festive', sub: '传统节日 · ' + (lunarText(k) || '吉日') };
    }
    /* 3. 节气当天 */
    var c = currentTerm(k);
    if (c && c.k === k) {
      /* 祝语由 apply() 统一拼在 sub 后面，这里只给前缀，避免节气当天重复显示 */
      return { id: c.id, t: THEMES[c.id], level: 'festive', sub: '二十四节气' };
    }
    /* 4. 平时：当前节气淡雅常驻 */
    if (c) {
      var d = daysBetween(c.k, k) + 1;
      return { id: c.id, t: THEMES[c.id], level: 'calm', sub: '当前节气 · 第 ' + d + ' 天', termDays: d };
    }
    return null;
  }

  /* ---------- 深浅主题判定 ---------- */
  var DARK_PAGES = { '物流大屏.html': 1, '物流门口大屏.html': 1, '仪表盘.html': 1, 'login.html': 1, '诊断-电视.html': 1 };
  function isDark() {
    var f = decodeURIComponent((location.pathname || '').split('/').pop() || '');
    if (DARK_PAGES[f]) return true;
    try {
      var bg = getComputedStyle(document.body || document.documentElement).backgroundColor || '';
      var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return (+m[1] * 299 + +m[2] * 587 + +m[3] * 114) / 1000 < 110;
    } catch (e) {}
    return false;
  }

  /* ---------- 样式（只用 --fs-* 变量，绝不碰业务变量） ---------- */
  var CSS = [
    '.fs-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif;}',
    '.fs-bar{position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--fs-c1),var(--fs-c2),var(--fs-c1));background-size:200% 100%;animation:fsFlow 24s linear infinite;opacity:.72;}',
    '@keyframes fsFlow{0%{background-position:0 0}100%{background-position:200% 0}}',
    /* ★ 徽章放右下角：顶部居中会压到 appbar / HUD（订单管理系统的搜索框、大屏的进度数字），
       顶部只留 3~5px 贴边彩条，不遮挡任何业务内容 */
    '.fs-badge{position:absolute;top:auto;bottom:26px;left:auto;right:14px;transform:none;display:flex;align-items:center;gap:7px;',
    '  max-width:min(92vw,460px);padding:3px 8px 3px 4px;border-radius:999px;pointer-events:auto;cursor:pointer;',
    '  background:rgba(255,255,255,.93);border:1px solid rgba(0,0,0,.07);box-shadow:0 3px 14px rgba(20,28,44,.13);',
    '  color:#233047;font-size:11px;line-height:1.25;white-space:nowrap;transition:opacity .25s,box-shadow .25s;}',
    '.fs-zi{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;',
    '  background:linear-gradient(135deg,var(--fs-c1),var(--fs-c2));color:#fff;font-size:12px;font-weight:700;',
    '  box-shadow:0 1px 4px rgba(0,0,0,.16);}',
    '.fs-txt{display:flex;flex-direction:column;min-width:0;}',
    '.fs-txt b{font-size:12px;font-weight:700;letter-spacing:.5px;}',
    '.fs-txt i{font-style:normal;font-size:10px;opacity:.68;overflow:hidden;text-overflow:ellipsis;}',
    '.fs-x{flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;',
    '  font-size:13px;line-height:1;opacity:.42;pointer-events:auto;}',
    '.fs-x:hover{opacity:.9;background:rgba(0,0,0,.07);}',
    '.fs-deco{position:absolute;pointer-events:none;opacity:.13;transition:opacity .35s;}',
    '.fs-deco-tl{top:-26px;left:-18px;width:210px;height:150px;}',
    '.fs-deco-br{bottom:-40px;right:-24px;width:260px;height:190px;transform:rotate(180deg);}',
    '.fs-deco svg{width:100%;height:100%;fill:none;stroke:var(--fs-c1);stroke-width:1.5;}',
    '.fs-wm{position:absolute;right:5vw;top:auto;bottom:11vh;font-size:min(20vw,200px);line-height:.8;font-weight:900;',
    '  color:var(--fs-c1);opacity:.035;pointer-events:none;user-select:none;}',
    '.fs-panel{position:absolute;top:auto;bottom:62px;left:auto;right:14px;transform:none;width:min(94vw,620px);max-height:min(62vh,460px);',
    '  overflow:auto;pointer-events:auto;background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.1);',
    '  border-radius:12px;box-shadow:0 16px 46px rgba(16,24,40,.24);padding:12px;color:#233047;}',
    '.fs-panel h4{margin:2px 0 8px;font-size:12px;font-weight:700;letter-spacing:.5px;}',
    '.fs-panel h4:not(:first-child){margin-top:12px;}',
    '.fs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px;}',
    '.fs-cell{border:1px solid rgba(0,0,0,.09);border-radius:7px;padding:5px 3px;text-align:center;cursor:pointer;',
    '  font-size:11px;background:#fff;transition:transform .12s,box-shadow .12s;}',
    '.fs-cell:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.12);}',
    '.fs-cell i{display:block;width:20px;height:20px;line-height:20px;margin:0 auto 3px;border-radius:50%;',
    '  color:#fff;font-style:normal;font-size:11px;font-weight:700;}',
    '.fs-auto{display:inline-block;margin:2px 0 6px;padding:4px 12px;border:1px solid var(--fs-c1);',
    '  color:var(--fs-c1);border-radius:999px;cursor:pointer;font-size:11px;background:#fff;}',
    'html[data-fs-level="festive"] .fs-bar{height:5px;opacity:1;}',
    'html[data-fs-level="festive"] .fs-badge{border-color:var(--fs-c2);box-shadow:0 3px 18px rgba(20,28,44,.18),0 0 0 2px rgba(255,255,255,.5) inset;}',
    'html[data-fs-level="festive"] .fs-deco{opacity:.19;}',
    'html[data-fs-level="festive"] .fs-wm{opacity:.05;}',
    'html[data-fs-level="calm"] .fs-badge{opacity:.62;}',
    'html[data-fs-level="calm"] .fs-badge:hover{opacity:1;}',
    'html[data-fs-level="calm"] .fs-deco{opacity:0;}',
    'html[data-fs-level="calm"] .fs-wm{opacity:.022;}',
    'html[data-fs-strength="strong"] .fs-deco{opacity:.3;}',
    'html[data-fs-strength="strong"] .fs-wm{opacity:.08;}',
    'html[data-fs-dark="1"] .fs-wm{opacity:.09;}',
    'html[data-fs-dark="1"] .fs-badge{background:rgba(14,20,31,.88);color:#eef4ff;border-color:rgba(255,255,255,.15);box-shadow:0 3px 18px rgba(0,0,0,.5);}',
    'html[data-fs-dark="1"] .fs-txt i{opacity:.72;}',
    'html[data-fs-dark="1"] .fs-x:hover{background:rgba(255,255,255,.14);}',
    'html[data-fs-dark="1"] .fs-panel{background:rgba(16,23,35,.97);color:#eef4ff;border-color:rgba(255,255,255,.16);}',
    'html[data-fs-dark="1"] .fs-cell{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);}',
    'html[data-fs-dark="1"] .fs-auto{background:rgba(255,255,255,.06);}',
    '@media print{.fs-root{display:none!important;}}',
    '@media (prefers-reduced-motion:reduce){.fs-bar{animation:none;}}'
  ].join('\n');

  var CLOUD_SVG = '<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M8 96c14 0 14-14 28-14 10 0 13 7 20 7 8 0 9-12 22-12 12 0 15 11 26 11 13 0 14-16 30-16 15 0 19 14 32 14"/>' +
    '<path d="M30 118c12 0 12-11 24-11 9 0 11 6 18 6 8 0 9-10 20-10 11 0 13 9 23 9 12 0 13-13 26-13"/>' +
    '<path d="M0 54c16 0 16-13 30-13 10 0 13 7 21 7"/>' +
    '<circle cx="164" cy="30" r="16"/><circle cx="164" cy="30" r="9"/>' +
    '<path d="M164 8v-8M164 60v-8M142 30h-8M194 30h-8M148 14l-6-6M186 14l6-6M148 46l-6 6M186 46l6 6"/>' +
    '</svg>';

  /* ---------- 渲染 ---------- */
  var root = null, lastKey = '', panelOpen = false;

  function ensureRoot() {
    if (root && root.parentNode) return root;
    var st = document.getElementById('fsStyle');
    if (!st) {
      st = document.createElement('style'); st.id = 'fsStyle'; st.type = 'text/css';
      st.appendChild(document.createTextNode(CSS));
      (document.head || document.documentElement).appendChild(st);
    }
    root = document.createElement('div');
    root.className = 'fs-root'; root.id = 'fsRoot';
    root.innerHTML =
      '<div class="fs-bar"></div>' +
      '<div class="fs-deco fs-deco-tl">' + CLOUD_SVG + '</div>' +
      '<div class="fs-deco fs-deco-br">' + CLOUD_SVG + '</div>' +
      '<div class="fs-wm" id="fsWm"></div>' +
      '<div class="fs-badge" id="fsBadge" title="点击试穿其它节日皮肤">' +
      '  <span class="fs-zi" id="fsZi"></span>' +
      '  <span class="fs-txt"><b id="fsName"></b><i id="fsSub"></i></span>' +
      '  <span class="fs-x" id="fsX" title="关闭节日皮肤">×</span>' +
      '</div>' +
      '<div class="fs-panel" id="fsPanel" style="display:none"></div>';
    (document.body || document.documentElement).appendChild(root);
    document.getElementById('fsX').onclick = function (ev) { ev.stopPropagation(); turnOff(); };
    document.getElementById('fsBadge').onclick = function (ev) { ev.stopPropagation(); togglePanel(); };
    root.addEventListener('click', function (ev) {
      var c = ev.target;
      while (c && c !== root && (!c.getAttribute || !c.getAttribute('data-fs-id'))) c = c.parentNode;
      if (c && c !== root && c.getAttribute) {
        var id = c.getAttribute('data-fs-id');
        if (id === '__auto') { ssDel(KEY_PREVIEW); panelOpen = false; }
        else { ssSet(KEY_PREVIEW, id); panelOpen = false; }
        lastKey = ''; refresh(true);
      }
    });
    return root;
  }

  function panelHTML() {
    var s = '<h4>自动模式</h4><span class="fs-auto" data-fs-id="__auto">回到自动（按今天真实日期）</span>';
    s += '<h4>传统节日 · 法定假日</h4><div class="fs-grid">';
    for (var i = 0; i < FEST_IDS.length; i++) {
      var id = FEST_IDS[i], t = THEMES[id];
      s += '<div class="fs-cell" data-fs-id="' + id + '"><i style="background:linear-gradient(135deg,' + t.c1 + ',' + t.c2 + ')">' + t.z + '</i>' + esc(t.n) + '</div>';
    }
    s += '</div><h4>二十四节气</h4><div class="fs-grid">';
    for (var j = 0; j < TERM_IDS.length; j++) {
      var id2 = TERM_IDS[j], t2 = THEMES[id2];
      s += '<div class="fs-cell" data-fs-id="' + id2 + '"><i style="background:linear-gradient(135deg,' + t2.c1 + ',' + t2.c2 + ')">' + t2.z + '</i>' + esc(t2.n) + '</div>';
    }
    return s + '</div>';
  }
  function togglePanel() {
    panelOpen = !panelOpen;
    var p = document.getElementById('fsPanel');
    if (!p) return;
    if (panelOpen && !p.innerHTML) p.innerHTML = panelHTML();
    p.style.display = panelOpen ? 'block' : 'none';
  }

  function apply(p) {
    ensureRoot();
    var h = document.documentElement;
    h.setAttribute('data-fs', p ? p.id : 'none');
    h.setAttribute('data-fs-level', p ? p.level : 'calm');
    h.setAttribute('data-fs-dark', isDark() ? '1' : '0');
    var s = qs('fs');
    h.setAttribute('data-fs-strength', s === 'strong' ? 'strong' : 'normal');
    root.style.display = p ? '' : 'none';
    if (!p) return;
    h.style.setProperty('--fs-c1', p.t.c1);
    h.style.setProperty('--fs-c2', p.t.c2);
    document.getElementById('fsZi').textContent = p.t.z;
    document.getElementById('fsName').textContent = p.t.n;
    document.getElementById('fsSub').textContent = p.preview ? p.sub : (p.sub + ' · ' + p.t.w);
    document.getElementById('fsWm').textContent = p.t.z;
    var deco = p.t.g === 'none';
    var ds = root.querySelectorAll('.fs-deco');
    for (var i = 0; i < ds.length; i++) ds[i].style.display = deco ? 'none' : '';
  }

  function turnOff() {
    lsSet(KEY_OFF, '1');
    ssDel(KEY_PREVIEW);
    if (root) root.style.display = 'none';
    try { document.documentElement.setAttribute('data-fs', 'off'); } catch (e) {}
  }

  function refresh(force) {
    try {
      var k = todayK();
      if (!force && k === lastKey) return;
      lastKey = k;
      var s = qs('fs');
      if (s === 'off') { lsSet(KEY_OFF, '1'); }
      else if (s === 'on') { lsDel(KEY_OFF); }
      if (lsGet(KEY_OFF) === '1') {
        apply(null);
        try { document.documentElement.setAttribute('data-fs', 'off'); } catch (e) {}
        return;
      }
      apply(pick(k));
    } catch (e) {
      /* 皮肤是附加功能：任何异常都静默降级，绝不拖累主页面 */
      try { if (root) root.style.display = 'none'; } catch (e2) {}
    }
  }

  /* ---------- 启动 ---------- */
  function boot() {
    /* iframe 内不画：外壳页统一显示一次，避免重复浮层 */
    try { if (window.top !== window.self) return; } catch (e) { return; }
    refresh(true);
    /* 每 5 分钟检查一次是否跨零点（开销可忽略） */
    setInterval(function () { refresh(false); }, 5 * 60 * 1000);
    try {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
      window.addEventListener('focus', function () { refresh(false); });
    } catch (e) {}
  }

  /* 对外暴露，便于守护测试与排障 */
  window.FestivalSkin = {
    version: VER, themes: THEMES, termIds: TERM_IDS, festIds: FEST_IDS,
    holidays: HOLIDAYS, lunarFest: LUNAR_FEST, termTable: TERM_TABLE,
    pick: pick, apply: apply, refresh: refresh, turnOff: turnOff,
    termDay: termDay, currentTerm: currentTerm, findHoliday: findHoliday,
    findLunarFest: findLunarFest, lunarText: lunarText, isDark: isDark
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
