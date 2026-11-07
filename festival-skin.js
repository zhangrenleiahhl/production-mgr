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
 *  ?fs=soft/normal/strong   皮肤浓度（默认 normal；皮肤管理页可切换并记忆）
 *  点击徽章文字       展开「节日/节气预览面板」，点任一格立即试穿
 * ========================================================================== */
(function () {
  'use strict';

  var VER = '20261106a';
  var KEY_OFF = 'festival_skin_off_v1';
  var KEY_PREVIEW = 'festival_skin_preview_v1';
  var KEY_STRENGTH = 'festival_skin_strength_v1';    // 皮肤浓度（soft / 默认 normal / strong）
  var KEY_CARD = 'festival_skin_card_off_v1';        // 左下角节日插画贺卡是否隐藏
  var KEY_OVR = 'festival_skin_override_local_v1';   // 本机缓存（同源所有标签页共享）
  var CLOUD_KEY = 'festival_skin_override_v1';        // 云端 app_data 键（全站统一皮肤）

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
   * ★ 配色按节日意象定：红金＝年节、青绿＝春与清明、粽绿＝端午、月金＝中秋、
   *   紫粉＝七夕、菊黄＝重阳、霜红＝霜降、藏蓝暖阳＝冬至……同一季内也拉开色相，
   *   避免「冬季六个节气全是蓝」看不出换肤。
   */
  var THEMES = {
    /* 法定与传统节日 */
    yuandan:   { n: '元旦',   z: '旦', c1: '#e0453c', c2: '#ffc95c', w: '一元复始，万象更新', g: 'star' },
    chuxi:     { n: '除夕',   z: '岁', c1: '#b3122b', c2: '#ffcf6b', w: '辞旧迎新，阖家团圆', g: 'lantern' },
    chunjie:   { n: '春节',   z: '福', c1: '#d81e2c', c2: '#ffd166', w: '新春大吉，万事如意', g: 'lantern' },
    yuanxiao:  { n: '元宵',   z: '圆', c1: '#c9344b', c2: '#ffb454', w: '灯火万家，团圆美满', g: 'lantern' },
    qingming:  { n: '清明',   z: '清', c1: '#3f8f74', c2: '#a9d6a0', w: '清风拂柳，慎终追远', g: 'willow' },
    laodong:   { n: '劳动节', z: '勤', c1: '#e07b1a', c2: '#ffd166', w: '劳动最光荣', g: 'wheat' },
    duanwu:    { n: '端午',   z: '粽', c1: '#1f7a5a', c2: '#8fd694', w: '粽叶飘香，安康顺遂', g: 'leaf' },
    qixi:      { n: '七夕',   z: '巧', c1: '#8e44ad', c2: '#f0a6d2', w: '银河相会，乞巧祈愿', g: 'star' },
    zhongyuan: { n: '中元',   z: '思', c1: '#46527a', c2: '#a9b8d8', w: '追思怀远，灯火寄情', g: 'moon' },
    zhongqiu:  { n: '中秋',   z: '月', c1: '#c98a12', c2: '#ffe6a3', w: '花好月圆，阖家安康', g: 'moon' },
    guoqing:   { n: '国庆',   z: '华', c1: '#d32027', c2: '#ffd54a', w: '盛世华诞，举国同庆', g: 'star' },
    chongyang: { n: '重阳',   z: '菊', c1: '#c8860d', c2: '#f0cf7a', w: '登高望远，菊香敬老', g: 'chrys' },
    laba:      { n: '腊八',   z: '暖', c1: '#8a5a2b', c2: '#e0b878', w: '腊八粥暖，岁岁平安', g: 'bowl' },
    workday:   { n: '调休上班', z: '勤', c1: '#6b7688', c2: '#a9b4c4', w: '今日调休上班，注意作息', g: 'none' },
    /* 二十四节气 */
    xiaohan:   { n: '小寒', z: '寒', c1: '#3d6fa8', c2: '#b9d9ef', w: '雁北乡，寒渐深', g: 'winter' },
    dahan:     { n: '大寒', z: '寒', c1: '#2b4a7d', c2: '#93b8dc', w: '岁末极寒，静待春归', g: 'winter' },
    lichun:    { n: '立春', z: '春', c1: '#2f8f5b', c2: '#a8e0a0', w: '东风解冻，万物始生', g: 'spring' },
    yushui:    { n: '雨水', z: '雨', c1: '#2e8f8a', c2: '#a6dcd4', w: '天一生水，润物无声', g: 'spring' },
    jingzhe:   { n: '惊蛰', z: '蛰', c1: '#4f9a45', c2: '#c2e08a', w: '春雷始鸣，蛰虫惊醒', g: 'spring' },
    chunfen:   { n: '春分', z: '分', c1: '#4a9c6d', c2: '#b6dda2', w: '昼夜均分，燕子归来', g: 'spring' },
    guyu:      { n: '谷雨', z: '谷', c1: '#6aa84f', c2: '#cfe39a', w: '雨生百谷，春色将阑', g: 'spring' },
    lixia:     { n: '立夏', z: '夏', c1: '#d24b3c', c2: '#f5a97a', w: '蝼蝈鸣，夏木成荫', g: 'summer' },
    xiaoman:   { n: '小满', z: '满', c1: '#d19a1e', c2: '#f2d876', w: '麦粒渐满，小得盈满', g: 'summer' },
    mangzhong: { n: '芒种', z: '种', c1: '#b8862b', c2: '#e8c96a', w: '有芒之谷，可种可收', g: 'summer' },
    xiazhi:    { n: '夏至', z: '至', c1: '#e0522f', c2: '#ffc26b', w: '日北至，昼最长', g: 'summer' },
    xiaoshu:   { n: '小暑', z: '暑', c1: '#e0703c', c2: '#f7bd82', w: '温风至，荷香起', g: 'summer' },
    dashu:     { n: '大暑', z: '炎', c1: '#c92f2a', c2: '#ff9a5c', w: '腐草为萤，暑气至极', g: 'summer' },
    liqiu:     { n: '立秋', z: '秋', c1: '#b98420', c2: '#e8cf82', w: '凉风至，白露生', g: 'autumn' },
    chushu:    { n: '处暑', z: '凉', c1: '#a97933', c2: '#ddb878', w: '暑气止，秋意来', g: 'autumn' },
    bailu:     { n: '白露', z: '露', c1: '#7d9076', c2: '#dfe6cf', w: '露凝而白，鸿雁来', g: 'autumn' },
    qiufen:    { n: '秋分', z: '分', c1: '#c69a2c', c2: '#f0dc96', w: '雷始收声，昼夜再均', g: 'autumn' },
    hanlu:     { n: '寒露', z: '寒', c1: '#9a6b2f', c2: '#d9b274', w: '露气寒冷，菊有黄华', g: 'autumn' },
    shuangjiang:{n: '霜降', z: '霜', c1: '#a34f32', c2: '#e0a878', w: '霜华初降，草木黄落', g: 'autumn' },
    lidong:    { n: '立冬', z: '冬', c1: '#4066a8', c2: '#a8c4ea', w: '水始冰，地始冻', g: 'winter' },
    xiaoxue:   { n: '小雪', z: '雪', c1: '#6a86b8', c2: '#dce9f7', w: '虹藏不见，雪意初萌', g: 'winter' },
    daxue:     { n: '大雪', z: '雪', c1: '#2f5f96', c2: '#bcd8ee', w: '积雪盈野，万物冬藏', g: 'winter' },
    dongzhi:   { n: '冬至', z: '至', c1: '#344f7a', c2: '#e8a06a', w: '一阳来复，昼渐长', g: 'winter' }
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
    /* 1. 管理员全站指定（本机试穿优先，方便先试再发） */
    var ov = override();
    if (ov) {
      return { id: ov.id, t: THEMES[ov.id], level: 'festive',
               sub: '管理员指定 · ' + (ov.name ? ov.name + ' 设置' : '全站统一'), override: ov };
    }
    /* 2. 法定假期（每天显示）/ 调休上班 */
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
    /* 3. 传统节日当天 */
    var lf = findLunarFest(k);
    if (lf && THEMES[lf]) {
      return { id: lf, t: THEMES[lf], level: 'festive', sub: '传统节日 · ' + (lunarText(k) || '吉日') };
    }
    /* 4. 节气当天 */
    var c = currentTerm(k);
    if (c && c.k === k) {
      /* 祝语由 apply() 统一拼在 sub 后面，这里只给前缀，避免节气当天重复显示 */
      return { id: c.id, t: THEMES[c.id], level: 'festive', sub: '二十四节气' };
    }
    /* 5. 平时：当前节气淡雅常驻 */
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
    '.fs-bar{position:absolute;top:0;left:0;right:0;height:9px;background:linear-gradient(90deg,var(--fs-c1),var(--fs-c2),var(--fs-c1));background-size:200% 100%;animation:fsFlow 24s linear infinite;box-shadow:0 2px 16px -3px var(--fs-c1);}',
    '@keyframes fsFlow{0%{background-position:0 0}100%{background-position:200% 0}}',
    '/* ★ 四边柔光：让节日色真正上屏，但只染边缘、不改业务 DOM / 不挡点击 */',
    '.fs-tint{position:absolute;inset:0;pointer-events:none;opacity:.16;transition:opacity .35s;',
    '  background:linear-gradient(180deg,var(--fs-c1) 0%,transparent 100%) top center/100% 130px no-repeat,',
    '  linear-gradient(0deg,var(--fs-c2) 0%,transparent 100%) bottom center/100% 100px no-repeat,',
    '  linear-gradient(90deg,var(--fs-c1) 0%,transparent 100%) left center/28px 100% no-repeat,',
    '  linear-gradient(270deg,var(--fs-c2) 0%,transparent 100%) right center/28px 100% no-repeat;}',
    /* ★ 徽章放右下角并抬到 58px：顶部居中会压 appbar / HUD，而 staff-admin 的
       「退出登录 / 账号管理」浮动条在 bottom:14px 高约 30px，贴太近会被徽章盖住 */
    '.fs-badge{position:absolute;top:auto;bottom:58px;left:auto;right:14px;transform:none;display:flex;align-items:center;gap:7px;',
    '  max-width:min(92vw,460px);padding:3px 8px 3px 4px;border-radius:999px;pointer-events:auto;cursor:pointer;',
    '  background:linear-gradient(135deg,var(--fs-c1),var(--fs-c2));border:1px solid rgba(255,255,255,.42);box-shadow:0 4px 18px rgba(20,28,44,.26);',
    '  color:#fff;font-size:11px;line-height:1.25;white-space:nowrap;transition:opacity .25s,box-shadow .25s;text-shadow:0 1px 2px rgba(0,0,0,.22);}',
    '.fs-zi{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;',
    '  background:rgba(255,255,255,.24);color:#fff;font-size:12px;font-weight:700;',
    '  box-shadow:0 1px 4px rgba(0,0,0,.16);}',
    '.fs-txt{display:flex;flex-direction:column;min-width:0;}',
    '.fs-txt b{font-size:12px;font-weight:700;letter-spacing:.5px;}',
    '.fs-txt i{font-style:normal;font-size:10px;opacity:.92;overflow:hidden;text-overflow:ellipsis;}',
    '.fs-x{flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;',
    '  font-size:13px;line-height:1;opacity:.72;pointer-events:auto;}',
    '.fs-x:hover{opacity:1;background:rgba(255,255,255,.24);}',
    '.fs-deco{position:absolute;pointer-events:none;opacity:.13;transition:opacity .35s;}',
    '.fs-deco-tl{top:-26px;left:-18px;width:210px;height:150px;}',
    '.fs-deco-br{bottom:-40px;right:-24px;width:260px;height:190px;transform:rotate(180deg);}',
    '.fs-deco svg{width:100%;height:100%;fill:none;stroke:var(--fs-c1);stroke-width:1.5;}',
    /* ★ 节日插画贺卡：左下角，和右下角徽章 / 账号管理浮动条互不干扰 */
    '.fs-card{position:absolute;left:14px;bottom:14px;width:176px;border-radius:12px;overflow:hidden;pointer-events:auto;cursor:zoom-in;',
    '  background:rgba(255,255,255,.96);border:1px solid var(--fs-c1);box-shadow:0 6px 22px rgba(20,28,44,.2);',
    '  opacity:.94;transition:opacity .3s,width .3s;}',
    '.fs-card:hover{opacity:1;}',
    '.fs-card-img{height:104px;background-size:cover;background-position:center;background-color:#f3efe6;',
    '  transition:height .3s,background-image .3s;}',
    '.fs-card-img.noimg{background-image:none!important;background:linear-gradient(135deg,var(--fs-c1),var(--fs-c2))!important;}',
    '.fs-card-txt{padding:6px 9px 7px;display:flex;flex-direction:column;gap:1px;}',
    '.fs-card-txt b{font-size:12px;font-weight:800;color:#233047;letter-spacing:.5px;}',
    '.fs-card-txt i{font-style:normal;font-size:10px;color:#6b7688;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.fs-card-x{position:absolute;top:5px;right:6px;width:17px;height:17px;border-radius:50%;display:grid;place-items:center;',
    '  background:rgba(255,255,255,.86);color:#333;font-size:12px;line-height:1;pointer-events:auto;opacity:.72;}',
    '.fs-card-x:hover{opacity:1;}',
    '.fs-lightbox{position:fixed;inset:0;z-index:2147483600;background:rgba(8,12,20,.84);display:none;',
    '  align-items:center;justify-content:center;pointer-events:auto;cursor:zoom-out;}',
    '.fs-lightbox.on{display:flex;}',
    '.fs-lightbox img{max-width:86vw;max-height:78vh;border-radius:14px;box-shadow:0 20px 70px rgba(0,0,0,.5);border:3px solid rgba(255,255,255,.72);}',
    '.fs-lightbox span{position:absolute;bottom:6vh;color:#fff;font-size:15px;text-shadow:0 2px 8px #000;}',
    'html[data-fs-dark="1"] .fs-card{background:rgba(14,20,31,.9);border-color:rgba(255,255,255,.24);opacity:.9;}',
    'html[data-fs-dark="1"] .fs-card-txt b{color:#eef4ff;}html[data-fs-dark="1"] .fs-card-txt i{color:#9db0c8;}',
    'html[data-fs-strength="soft"] .fs-card{width:138px;opacity:.8;}',
    'html[data-fs-strength="soft"] .fs-card-img{height:82px;}',
    'html[data-fs-strength="strong"] .fs-card{width:210px;opacity:1;}',
    'html[data-fs-strength="strong"] .fs-card-img{height:126px;}',
    '.fs-wm{position:absolute;right:5vw;top:auto;bottom:11vh;font-size:min(20vw,200px);line-height:.8;font-weight:900;',
    '  color:var(--fs-c1);opacity:.035;pointer-events:none;user-select:none;}',
    '.fs-panel{position:absolute;top:auto;bottom:96px;left:auto;right:14px;transform:none;width:min(94vw,620px);max-height:min(62vh,460px);',
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
    '.fs-admin{display:inline-block;margin:2px 0 4px;padding:5px 12px;border-radius:8px;',
    '  background:rgba(31,111,235,.12);color:#1f6feb;font-size:12px;font-weight:700;text-decoration:none;}',
    '.fs-admin:hover{background:rgba(31,111,235,.22);}',
    '.fs-auto{display:inline-block;margin:2px 0 6px;padding:4px 12px;border:1px solid var(--fs-c1);',
    '  color:var(--fs-c1);border-radius:999px;cursor:pointer;font-size:11px;background:#fff;}',
    'html[data-fs-level="festive"] .fs-badge{border-color:rgba(255,255,255,.62);box-shadow:0 5px 22px rgba(20,28,44,.28),0 0 0 2px rgba(255,255,255,.28) inset;}',
    'html[data-fs-level="calm"] .fs-badge{opacity:.78;}',
    'html[data-fs-level="calm"] .fs-badge:hover{opacity:1;}',
    '/* ★ 三档浓度：normal 为新的明显默认；soft 回到旧版淡雅；strong 更浓 */',
    'html[data-fs-strength="soft"] .fs-bar{height:4px;opacity:.72;box-shadow:none;}',
    'html[data-fs-strength="soft"] .fs-tint{opacity:.045;}',
    'html[data-fs-strength="soft"] .fs-deco{opacity:.08;}',
    'html[data-fs-strength="soft"] .fs-wm{opacity:.025;}',
    'html[data-fs-strength="normal"] .fs-bar{height:9px;}',
    'html[data-fs-strength="normal"] .fs-tint{opacity:.16;}',
    'html[data-fs-strength="normal"] .fs-deco{opacity:.26;}',
    'html[data-fs-strength="normal"] .fs-wm{opacity:.06;}',
    'html[data-fs-strength="strong"] .fs-bar{height:14px;}',
    'html[data-fs-strength="strong"] .fs-tint{opacity:.3;}',
    'html[data-fs-strength="strong"] .fs-deco{opacity:.4;}',
    'html[data-fs-strength="strong"] .fs-wm{opacity:.11;}',
    '/* 深色大屏要收一点，避免整屏糊；特异性高于档位规则 */',
    'html[data-fs-dark="1"][data-fs-strength="soft"] .fs-tint{opacity:.035;}',
    'html[data-fs-dark="1"][data-fs-strength="normal"] .fs-tint{opacity:.11;}',
    'html[data-fs-dark="1"][data-fs-strength="strong"] .fs-tint{opacity:.22;}',
    'html[data-fs-dark="1"] .fs-badge{border-color:rgba(255,255,255,.3);box-shadow:0 5px 22px rgba(0,0,0,.5);}',
    'html[data-fs-dark="1"] .fs-txt i{opacity:.92;}',
    'html[data-fs-dark="1"] .fs-x:hover{background:rgba(255,255,255,.24);}',
    'html[data-fs-dark="1"] .fs-panel{background:rgba(16,23,35,.97);color:#eef4ff;border-color:rgba(255,255,255,.16);}',
    'html[data-fs-dark="1"] .fs-cell{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);}',
    'html[data-fs-dark="1"] .fs-auto{background:rgba(255,255,255,.06);}',
    'html[data-fs-dark="1"] .fs-admin{background:rgba(96,165,250,.18);color:#bfdbfe;}',
    '/* ★ 关闭后必须留一个可见的恢复入口：以前点过徽章 × 就连徽章一起消失，用户再也开不回来 */',
    '.fs-onbtn{display:none;position:absolute;right:14px;bottom:58px;align-items:center;',
    '  padding:6px 12px;border-radius:999px;pointer-events:auto;cursor:pointer;',
    '  background:rgba(255,255,255,.93);border:1px solid rgba(0,0,0,.09);',
    '  box-shadow:0 3px 14px rgba(20,28,44,.16);color:#233047;font-size:11px;font-weight:700;opacity:.72;}',
    '.fs-onbtn:hover{opacity:1;}',
    'html[data-fs-dark="1"] .fs-onbtn{background:rgba(14,20,31,.88);color:#eef4ff;border-color:rgba(255,255,255,.15);}',
    'html[data-fs="off"] .fs-bar,html[data-fs="off"] .fs-tint,html[data-fs="off"] .fs-deco,html[data-fs="off"] .fs-wm,html[data-fs="off"] .fs-badge,html[data-fs="off"] .fs-panel,html[data-fs="off"] .fs-card,html[data-fs="off"] .fs-lightbox{display:none!important;}',
    'html[data-fs="off"] .fs-onbtn{display:flex!important;}',
    /* ★ 打印/导出 PDF 也保留节日主题：只隐藏交互元素，保留彩条与插画贺卡 */
    '@media print{',
    '  .fs-badge,.fs-panel,.fs-onbtn,.fs-x,.fs-card-x,.fs-lightbox,.fs-wm,.fs-deco,.fs-tint{display:none!important;}',
    '  .fs-root{position:absolute;}.fs-bar{height:6px;opacity:1;box-shadow:none;}',
    '  .fs-card{opacity:1;box-shadow:none;border:1px solid #ccc;pointer-events:none;}',
    '}',
    '@media (prefers-reduced-motion:reduce){.fs-bar{animation:none;}}'
  ].join('\n');

  var CLOUD_SVG = '<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M8 96c14 0 14-14 28-14 10 0 13 7 20 7 8 0 9-12 22-12 12 0 15 11 26 11 13 0 14-16 30-16 15 0 19 14 32 14"/>' +
    '<path d="M30 118c12 0 12-11 24-11 9 0 11 6 18 6 8 0 9-10 20-10 11 0 13 9 23 9 12 0 13-13 26-13"/>' +
    '<path d="M0 54c16 0 16-13 30-13 10 0 13 7 21 7"/>' +
    '<circle cx="164" cy="30" r="16"/><circle cx="164" cy="30" r="9"/>' +
    '<path d="M164 8v-8M164 60v-8M142 30h-8M194 30h-8M148 14l-6-6M186 14l6-6M148 46l-6 6M186 46l6 6"/>' +
    '</svg>';

  /* ---------- 37 套节日专属线稿图案 ----------
   * 每个节日/节气一组不同的简笔意象，替代原来所有节日共用的云纹。
   * 供页面角落装饰、贺卡无图时的兜底、以及截图绘制共用。
   */
  var MOTIFS = {
    bailu: '<path d="M42 126V34M62 126V46M82 126V30"/><path d="M42 34c-8-8-14-10-20-10M62 46c8-10 14-12 22-12M82 30c-8-8-14-10-20-10"/><circle cx="126" cy="54" r="9"/><circle cx="156" cy="74" r="7"/><circle cx="112" cy="90" r="5"/><path d="M138 26l10 7 10-7M158 20l10 7 10-7"/><path d="M8 122q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    chongyang: '<circle cx="62" cy="52" r="10"/><ellipse cx="86" cy="52" rx="7" ry="13"/><ellipse cx="78" cy="68" rx="7" ry="13"/><ellipse cx="62" cy="75" rx="7" ry="13"/><ellipse cx="46" cy="68" rx="7" ry="13"/><ellipse cx="39" cy="52" rx="7" ry="13"/><ellipse cx="45" cy="36" rx="7" ry="13"/><ellipse cx="62" cy="29" rx="7" ry="13"/><ellipse cx="78" cy="35" rx="7" ry="13"/><path d="M108 100h44l-6 18h-32z"/><path d="M116 100c0-10 6-16 14-16s14 6 14 16"/><path d="M8 124l30-22 22 14 26-20"/>',
    chunfen: '<path d="M100 14v112M100 76l-30-30M100 60l30-30"/><circle cx="64" cy="42" r="6"/><circle cx="136" cy="26" r="6"/><circle cx="56" cy="62" r="5"/><circle cx="144" cy="52" r="5"/><path d="M116 96l10 8 10-8M138 90l10 8 10-8"/><path d="M20 118h160"/>',
    chunjie: '<circle cx="58" cy="52" r="27"/><path d="M58 25v54M31 52h54M40 34l36 36M76 34L40 70"/><path d="M104 28c10 8 12 20 8 30M112 44l14-8M108 58l16 4"/><circle cx="118" cy="30" r="4"/><circle cx="136" cy="52" r="4"/><circle cx="112" cy="72" r="4"/><circle cx="148" cy="88" r="10"/><path d="M143 88h10M148 83v10"/>',
    chushu: '<path d="M46 124V52"/><ellipse cx="53" cy="58" rx="4" ry="8"/><ellipse cx="39" cy="67" rx="4" ry="8"/><ellipse cx="53" cy="76" rx="4" ry="8"/><ellipse cx="39" cy="85" rx="4" ry="8"/><ellipse cx="53" cy="94" rx="4" ry="8"/><ellipse cx="39" cy="103" rx="4" ry="8"/><ellipse cx="53" cy="112" rx="4" ry="8"/><path d="M46 52l-6-12M46 52l6-12"/><path d="M100 34c10-10 22-10 32 0s16 8 24 2M96 52c14-10 28-10 40 0s18 8 26 2"/><path d="M132 88l8 6 8-6M150 82l8 6 8-6"/><path d="M8 118q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    chuxi: '<path d="M34 24h40l-4 48H38z"/><ellipse cx="54" cy="24" rx="20" ry="6"/><ellipse cx="54" cy="72" rx="20" ry="6"/><path d="M54 10L54 24"/><path d="M54 78L54 96"/><circle cx="140" cy="50" r="21"/><path d="M140 22v-8M140 86v8M113 50h-8M175 50h8M121 31l19 38M159 31l-19 38"/><path d="M128 50h24"/>',
    dahan: '<path d="M20 12v34M38 12v24M56 12v40M74 12v28M92 12v20"/><path d="M14 12h96"/><path d="M20 46l6 12 6-12M56 52l6 12 6-12M74 40l6 12 6-12"/><path d="M112 118c16-44 34-66 56-76 10 34 12 58 0 76z"/><circle cx="140" cy="30" r="1"/><circle cx="166" cy="52" r="1"/><circle cx="120" cy="72" r="1"/>',
    dashu: '<circle cx="70" cy="50" r="26"/><path d="M106 50L116 50"/><path d="M101 68L109 73"/><path d="M87 81L92 89"/><path d="M70 85L70 95"/><path d="M52 81L47 89"/><path d="M39 67L31 72"/><path d="M35 50L25 50"/><path d="M39 32L31 27"/><path d="M53 19L48 11"/><path d="M70 15L70 5"/><path d="M88 19L93 11"/><path d="M101 33L109 28"/><path d="M120 108c16-34 30-48 48-54 4 26 4 44-6 54z"/><path d="M120 108c16-12 30-16 42-10"/><path d="M12 122c10-8 20-8 30 0s20 8 30 0M92 122c10-8 20-8 30 0s20 8 30 0"/>',
    daxue: '<path d="M8 118l38-52 22 26 30-42 34 44 26-24 34 48z"/><path d="M98 50l-8-14M98 50l10-12"/><path d="M146 84l-16-14-16 14M130 70V40M130 84l-16-14-16 14M130 98l-18-16-18 16M130 40v84"/><circle cx="40" cy="30" r="1"/><circle cx="76" cy="22" r="1"/><circle cx="168" cy="32" r="1"/><circle cx="110" cy="18" r="1"/><circle cx="186" cy="56" r="1"/>',
    dongzhi: '<path d="M26 92h56a28 28 0 0 1-56 0z"/><circle cx="44" cy="86" r="7"/><circle cx="62" cy="88" r="7"/><ellipse cx="54" cy="92" rx="28" ry="6"/><circle cx="140" cy="42" r="22"/><path d="M140 12v-8M140 72v8M110 42h-8M178 42h8M118 20l-6-6M162 20l6-6M118 64l-6 6M162 64l6 6"/><path d="M104 112c10-8 20-8 30 0s20 8 30 0"/>',
    duanwu: '<path d="M40 96l24-58 24 58z"/><path d="M40 96h48M52 72h24M64 38v58"/><path d="M112 28c14 12 18 30 12 48M124 32c-2 18 2 32 12 44M108 40c8-12 20-16 30-14"/><path d="M8 112q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/><path d="M8 126q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    guoqing: '<path d="M50 14l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3z"/><path d="M104 22c14 6 20 18 14 32 14-8 28-4 36 6l-6 42h-44z"/><circle cx="160" cy="32" r="3"/><path d="M160 32L178 32"/><path d="M160 32L172 44"/><path d="M160 32L160 49"/><path d="M160 32L148 44"/><path d="M160 32L143 32"/><path d="M160 32L148 20"/><path d="M160 32L160 15"/><path d="M160 32L172 20"/><path d="M8 120q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    guyu: '<path d="M32 20c8 14 12 20 12 26a12 12 0 0 1-24 0c0-6 4-12 12-26z"/><circle cx="112" cy="58" r="14"/><circle cx="112" cy="58" r="24"/><ellipse cx="142" cy="58" rx="9" ry="15"/><ellipse cx="127" cy="83" rx="9" ry="15"/><ellipse cx="98" cy="83" rx="9" ry="15"/><ellipse cx="83" cy="58" rx="9" ry="15"/><ellipse cx="97" cy="33" rx="9" ry="15"/><ellipse cx="126" cy="33" rx="9" ry="15"/><path d="M112 90v34M112 104l16-12M112 110l-14-12"/><path d="M8 126q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    hanlu: '<circle cx="54" cy="50" r="9"/><ellipse cx="76" cy="50" rx="6" ry="12"/><ellipse cx="69" cy="65" rx="6" ry="12"/><ellipse cx="54" cy="71" rx="6" ry="12"/><ellipse cx="39" cy="65" rx="6" ry="12"/><ellipse cx="33" cy="50" rx="6" ry="12"/><ellipse cx="39" cy="35" rx="6" ry="12"/><ellipse cx="54" cy="29" rx="6" ry="12"/><ellipse cx="69" cy="35" rx="6" ry="12"/><circle cx="126" cy="38" r="8"/><circle cx="156" cy="62" r="6"/><path d="M112 96l14-16 6 10 10-6 4 20-22 4z"/><path d="M126 108v18"/><path d="M8 126q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    jingzhe: '<path d="M50 10l-16 36h18l-12 34 34-44H56l12-26z"/><path d="M96 100c8-10 18-10 26 0s18 10 26 0"/><path d="M100 112c8-10 18-10 26 0s18 10 26 0"/><circle cx="146" cy="44" r="12"/><circle cx="146" cy="44" r="20"/><path d="M146 24v-10M146 74v10M126 44h-10M176 44h10"/><circle cx="40" cy="108" r="1"/><circle cx="72" cy="116" r="1"/>',
    laba: '<path d="M28 84h68a34 34 0 0 1-68 0z"/><ellipse cx="62" cy="84" rx="34" ry="8"/><path d="M46 60c-6-10 6-14 0-24M62 58c-6-10 6-14 0-24M78 60c-6-10 6-14 0-24"/><circle cx="126" cy="96" r="9"/><circle cx="148" cy="102" r="7"/><circle cx="166" cy="90" r="6"/><path d="M110 118h72"/>',
    laodong: '<path d="M60 124V28"/><ellipse cx="71" cy="40" rx="6" ry="12"/><ellipse cx="49" cy="51" rx="6" ry="12"/><ellipse cx="71" cy="62" rx="6" ry="12"/><ellipse cx="49" cy="73" rx="6" ry="12"/><ellipse cx="71" cy="84" rx="6" ry="12"/><ellipse cx="49" cy="95" rx="6" ry="12"/><ellipse cx="71" cy="106" rx="6" ry="12"/><circle cx="140" cy="64" r="26"/><path d="M140 30L140 22"/><path d="M140 30v-10M140 98v10M106 64h-10M184 64h10M116 40l-8-8M164 40l8-8M116 88l-8 8M164 88l8 8"/><circle cx="140" cy="64" r="9"/>',
    lichun: '<path d="M62 124V64"/><ellipse cx="46" cy="58" rx="16" ry="9"/><ellipse cx="78" cy="54" rx="16" ry="9"/><path d="M62 64l-16-6M62 60l16-6"/><path d="M112 36l10 8 10-8M136 30l10 8 10-8"/><path d="M100 92l14-10v20zM126 92l14-10v20zM152 92l14-10v20z"/><path d="M20 124h150"/>',
    lidong: '<path d="M20 106h160M20 120h160M36 92l16 28M68 92l16 28M100 92l16 28M132 92l16 28M36 120l16-28M68 120l16-28M100 120l16-28M132 120l16-28"/><path d="M162 30c-6-10 6-14 0-24"/><path d="M162 40c-6-10 6-14 0-24"/><path d="M144 52c8-6 16-6 24 0"/>',
    liqiu: '<path d="M62 96c-18-10-24-30-14-46 8-14 26-16 38-6 12 10 12 30 2 44z"/><path d="M62 96l-14-40M62 96l16-36M62 96l-2 26"/><path d="M112 34c14-6 26-6 38 0M108 50c18-8 32-8 46 0M116 66c12-6 24-6 34 0"/><path d="M148 92l8-12 8 12zM148 92v18"/>',
    lixia: '<circle cx="70" cy="62" r="44"/><path d="M70 18v44M70 62l38-22"/><circle cx="70" cy="62" r="34"/><path d="M136 96c0-10 10-16 20-16s20 6 20 16z"/><circle cx="142" cy="92" r="2"/><circle cx="170" cy="92" r="2"/><path d="M8 120q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/><path d="M126 34c10-6 18-6 26 0"/>',
    mangzhong: '<path d="M46 126V44"/><ellipse cx="54" cy="52" rx="4" ry="9"/><ellipse cx="38" cy="62" rx="4" ry="9"/><ellipse cx="54" cy="72" rx="4" ry="9"/><ellipse cx="38" cy="82" rx="4" ry="9"/><ellipse cx="54" cy="92" rx="4" ry="9"/><ellipse cx="38" cy="102" rx="4" ry="9"/><ellipse cx="54" cy="112" rx="4" ry="9"/><path d="M110 126V88M110 88l-14-12M110 88l14-12M110 100l-12-10M110 100l12-10"/><path d="M136 40l22 10-22 10z"/><path d="M136 40v20"/><path d="M8 120q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    qingming: '<path d="M28 10c6 30 4 60 0 90M42 12c8 28 6 58 2 86M56 14c10 26 8 54 4 80"/><path d="M28 34l16-8M32 52l18-8M36 70l16-8M42 20l14-6M46 40l14-6M50 60l14-6"/><path d="M96 44l-10 18M116 40l-10 18M136 44l-10 18M156 40l-10 18"/><path d="M8 118l34-24 24 16 32-26 28 20 30-18 36 20"/>',
    qiufen: '<circle cx="140" cy="38" r="22"/><path d="M100 96c20-14 44-14 64 0M92 110c24-16 52-16 76 0M100 124c20-12 44-12 64 0"/><path d="M100 70v56M20 126h160"/><circle cx="48" cy="34" r="5"/><circle cx="62" cy="44" r="5"/><circle cx="36" cy="48" r="5"/>',
    qixi: '<path d="M12 22c50 26 126 26 176 0M12 36c50 26 126 26 176 0M12 50c50 26 126 26 176 0"/><path d="M28 108c30-38 114-38 144 0"/><path d="M40 100c26-28 94-28 120 0"/><path d="M86 74l8-8 8 8M102 70l8-8 8 8"/><circle cx="30" cy="72" r="3"/><circle cx="170" cy="72" r="3"/><circle cx="100" cy="16" r="3"/><circle cx="60" cy="60" r="1"/><circle cx="140" cy="58" r="1"/>',
    shuangjiang: '<path d="M56 96l-16-18 6-22 20-8 18 12-2 22-14 14z"/><path d="M56 96l-12-30M56 96l16-28M56 96V126"/><circle cx="136" cy="54" r="18"/><path d="M136 36v-8M130 36h12"/><circle cx="170" cy="88" r="1"/><circle cx="180" cy="104" r="1"/><circle cx="158" cy="108" r="1"/><circle cx="112" cy="116" r="1"/><path d="M18 130h170"/>',
    workday: '<path d="M30 26h62v74H30zM30 46h62M46 16v18M76 16v18"/><path d="M42 62h12M62 62h12M42 78h12M62 78h12"/><path d="M112 84h44v22a12 12 0 0 1-12 12h-20a12 12 0 0 1-12-12z"/><path d="M156 90h10a8 8 0 0 1 0 16h-10"/><path d="M118 68c-4-8 4-10 0-18M134 68c-4-8 4-10 0-18"/>',
    xiaohan: '<path d="M14 118c26-14 34-40 30-66M44 52c14-8 24-6 34 2"/><circle cx="56" cy="44" r="5"/><circle cx="74" cy="54" r="5"/><circle cx="40" cy="70" r="5"/><circle cx="66" cy="80" r="5"/><path d="M112 34l10 8 10-8M134 28l10 8 10-8"/><circle cx="150" cy="60" r="1"/><circle cx="168" cy="72" r="1"/><circle cx="128" cy="78" r="1"/><path d="M100 108h88"/>',
    xiaoman: '<path d="M64 128V32"/><ellipse cx="73" cy="42" rx="5" ry="10"/><ellipse cx="55" cy="54" rx="5" ry="10"/><ellipse cx="73" cy="66" rx="5" ry="10"/><ellipse cx="55" cy="78" rx="5" ry="10"/><ellipse cx="73" cy="90" rx="5" ry="10"/><ellipse cx="55" cy="102" rx="5" ry="10"/><ellipse cx="73" cy="114" rx="5" ry="10"/><path d="M64 32l-8-14M64 32l8-14"/><circle cx="130" cy="52" r="10"/><circle cx="130" cy="52" r="4"/><path d="M130 36V26M130 78v10M114 52h-10M156 52h10"/><circle cx="160" cy="88" r="1"/><circle cx="148" cy="100" r="1"/><path d="M104 120h72"/>',
    xiaoshu: '<circle cx="56" cy="54" r="36"/><path d="M56 18v36M56 54l30-18"/><path d="M116 40l22 8-8 26-22-8z"/><path d="M116 40l22 8"/><circle cx="156" cy="28" r="1"/><circle cx="172" cy="48" r="1"/><circle cx="146" cy="68" r="1"/><circle cx="178" cy="80" r="1"/><path d="M132 96c8-8 18-8 26 0"/><path d="M8 120q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    xiaoxue: '<path d="M60 20v56M32 48h56M40 28l40 40M80 28L40 68"/><path d="M60 12v-8M60 84v8M24 48h-8M104 48h8M34 22l-6-6M86 22l6-6M34 74l-6 6M86 74l6 6"/><path d="M136 108V58M136 58l-18-10M136 70l18-10"/><path d="M162 34l8 8-8 8-8-8z"/><circle cx="178" cy="66" r="1"/><circle cx="120" cy="90" r="1"/><circle cx="184" cy="96" r="1"/>',
    xiazhi: '<circle cx="150" cy="32" r="20"/><path d="M150 4v-4M150 60v8M120 32h-8M188 32h8M128 10l-6-6M172 10l6-6M128 54l-6 6M172 54l6 6"/><path d="M60 108c-14-18-8-36 0-46 8 10 14 28 0 46z"/><path d="M36 108c-8-14-4-28 4-36 8 8 12 22 4 36zM84 108c8-14 4-28-4-36-8 8-12 22-4 36z"/><circle cx="60" cy="108" r="26"/><path d="M34 108h52"/><path d="M8 126q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/>',
    yuandan: '<circle cx="60" cy="48" r="22"/><path d="M60 16V6M60 90v10M22 48H12M108 48h10M33 21l-7-7M87 21l7-7M33 75l-7 7M87 75l7 7"/><path d="M104 112c12 0 12-11 24-11s13 11 26 11s12-8 22-8"/>',
    yuanxiao: '<circle cx="132" cy="38" r="24"/><path d="M108 38h-6M162 38h-6"/><path d="M28 88h64a32 32 0 0 1-64 0z"/><circle cx="48" cy="82" r="7"/><circle cx="64" cy="84" r="7"/><circle cx="78" cy="82" r="7"/><path d="M40 112l8-10 8 10M56 112l8-10 8 10"/><path d="M104 92l10-12 10 12-10 12z"/>',
    yushui: '<path d="M40 26c8 14 12 20 12 26a12 12 0 0 1-24 0c0-6 4-12 12-26z"/><path d="M100 34c8 14 12 20 12 26a12 12 0 0 1-24 0c0-6 4-12 12-26z"/><circle cx="64" cy="96" r="14"/><circle cx="64" cy="96" r="22"/><circle cx="64" cy="96" r="30"/><path d="M132 88c10-8 18-8 26 0M138 74c8-6 16-6 22 0"/><circle cx="164" cy="110" r="4"/><circle cx="178" cy="102" r="4"/>',
    zhongqiu: '<circle cx="96" cy="52" r="38"/><circle cx="96" cy="52" r="31"/><ellipse cx="150" cy="68" rx="7" ry="20"/><ellipse cx="164" cy="66" rx="7" ry="20"/><circle cx="154" cy="96" r="14"/><path d="M132 44l10-6M138 56l12-2M130 32l8-8"/><circle cx="52" cy="112" r="12"/><path d="M52 100v24M40 112h24"/>',
    zhongyuan: '<circle cx="148" cy="32" r="20"/><path d="M28 92c0-16 12-26 26-26s26 10 26 52H28z"/><path d="M54 66c-6-10 2-16 0-24 10 8 12 16 6 24"/><path d="M108 92c0-14 10-22 22-22s22 8 22 22z"/><path d="M8 112q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/><path d="M8 126q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0q15 -6 31 0t31 0"/><circle cx="40" cy="30" r="1"/><circle cx="88" cy="22" r="1"/>',
  };
  function patternSVG(id, color) {
    return '<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="' +
      (color || '#888') + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (MOTIFS[id] || MOTIFS.workday) + '</svg>';
  }

  /* ---------- 管理员全站指定 / 本机试穿 ----------
   * 优先级：?fs=off 关闭 > 会话预览 > 管理员全站指定 > 自动日期。
   * 试穿只写 sessionStorage（当前标签页），全站指定写 localStorage + 云端，
   * 同源其它标签页用 storage 事件立刻跟随。没有 CloudSync 的页面静默用本机缓存，
   * 皮肤永远只是附加层，绝不因设置读取失败影响主页面。
   */
  function override() {
    var o = null;
    try { o = JSON.parse(lsGet(KEY_OVR) || 'null'); } catch (e) {}
    if (!o || typeof o !== 'object' || !o.id || o.id === 'auto' || !THEMES[o.id]) return null;
    return o;
  }
  function writeOverride(o) {
    if (!o || !o.id || o.id === 'auto' || !THEMES[o.id]) lsDel(KEY_OVR);
    else lsSet(KEY_OVR, JSON.stringify(o));
    refresh(true);
  }
  function setOverride(o) { ssDel(KEY_PREVIEW); writeOverride(o); }
  function clearOverride() { lsDel(KEY_OVR); ssDel(KEY_PREVIEW); refresh(true); }
  function preview(id) {
    if (!id || id === '__auto' || id === 'auto') ssDel(KEY_PREVIEW);
    else if (THEMES[id]) ssSet(KEY_PREVIEW, id);
    refresh(true);
  }
  function currentPreview() { return ssGet(KEY_PREVIEW) || ''; }
  function isAdmin() {
    try {
      var s = window.Auth && window.Auth.getSession && window.Auth.getSession();
      var phone = s && s.email ? String(s.email).split('@')[0] : '';
      var adm = (window.STAFF && window.STAFF.adminPhone) || '16655052098';
      return !!phone && phone === adm;
    } catch (e) { return false; }
  }
  /* 只在页面已加载 CloudSync 时读云端；否则静默用本机缓存，绝不自己发网络请求 */
  function syncCloud(done) {
    var CS = window.CloudSync;
    if (!CS || !CS.pullResult) { if (done) done(false); return; }
    try { if (!CS.ready()) CS.init(); } catch (e) {}
    if (!CS.ready()) { if (done) done(false); return; }
    var p;
    try { p = CS.pullResult(CLOUD_KEY); } catch (e) { if (done) done(false); return; }
    if (!p || typeof p.then !== 'function') { if (done) done(false); return; }
    p.then(function (r) {
      if (!r || !r.ok) { if (done) done(false); return; }
      var o = r.value;
      if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
      var wanted = (o && o.id && o.id !== 'auto' && THEMES[o.id]) ? JSON.stringify(o) : '';
      var changed = wanted !== (lsGet(KEY_OVR) || '');
      if (changed) writeOverride(o);      /* 不清会话预览：管理员试穿时不被云端打断 */
      if (done) done(changed);
    }, function () { if (done) done(false); });
  }

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
      '<div class="fs-tint"></div>' +
      '<div class="fs-bar"></div>' +
      '<div class="fs-deco fs-deco-tl"></div>' +
      '<div class="fs-deco fs-deco-br"></div>' +
      '<div class="fs-wm" id="fsWm"></div>' +
      '<div class="fs-badge" id="fsBadge" title="点击试穿其它节日皮肤">' +
      '  <span class="fs-zi" id="fsZi"></span>' +
      '  <span class="fs-txt"><b id="fsName"></b><i id="fsSub"></i></span>' +
      '  <span class="fs-x" id="fsX" title="隐藏节日皮肤（右下角可重新开启）">×</span>' +
      '</div>' +
      '<div class="fs-panel" id="fsPanel" style="display:none"></div>' +
      '<div class="fs-onbtn" id="fsOn" title="重新开启节日皮肤">🎨 开启节日皮肤</div>' +
      '<div class="fs-card" id="fsCard" title="点击放大查看节日插画">' +
      '  <div class="fs-card-img" id="fsCardImg"></div>' +
      '  <div class="fs-card-txt"><b id="fsCardName"></b><i id="fsCardWish"></i></div>' +
      '  <span class="fs-card-x" id="fsCardX" title="不再显示这张贺卡">×</span>' +
      '</div>' +
      '<div class="fs-lightbox" id="fsLight"><img id="fsLightImg" alt=""><span id="fsLightTxt"></span></div>';
    (document.body || document.documentElement).appendChild(root);
    document.getElementById('fsX').onclick = function (ev) { ev.stopPropagation(); turnOff(); };
    document.getElementById('fsOn').onclick = function (ev) { ev.stopPropagation(); turnOn(); };
    document.getElementById('fsBadge').onclick = function (ev) { ev.stopPropagation(); togglePanel(); };
    document.getElementById('fsCard').onclick = function (ev) {
      if (ev && ev.target && ev.target.id === 'fsCardX') return;
      try { document.getElementById('fsLight').className = 'fs-lightbox on'; } catch (e) {}
    };
    document.getElementById('fsCardX').onclick = function (ev) { ev.stopPropagation(); setCardVisible(false); };
    document.getElementById('fsLight').onclick = function () { this.className = 'fs-lightbox'; };
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
    s += '</div>';
    if (isAdmin()) s += '<h4>管理</h4><a class="fs-admin" href="' + encodeURI('皮肤管理.html') + '">🎨 打开皮肤管理（管理员）</a>';
    return s;
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
    h.setAttribute('data-fs-strength', strength());
    root.style.display = '';   /* 关闭态也留着 root：里面藏着「开启皮肤」按钮 */
    if (!p) return;
    h.style.setProperty('--fs-c1', p.t.c1);
    h.style.setProperty('--fs-c2', p.t.c2);
    document.getElementById('fsZi').textContent = p.t.z;
    document.getElementById('fsName').textContent = p.t.n;
    document.getElementById('fsSub').textContent = p.preview ? p.sub : (p.sub + ' · ' + p.t.w);
    document.getElementById('fsWm').textContent = p.t.z;
    var svg = patternSVG(p.id, p.t.c1);       /* ★ 每个节日一套专属线稿，不再共用云纹 */
    var ds = root.querySelectorAll('.fs-deco');
    var deco = p.t.g === 'none';
    for (var i = 0; i < ds.length; i++) { ds[i].innerHTML = svg; ds[i].style.display = deco ? 'none' : ''; }
    setCard(p);
  }

  /* 关闭/开启要通知同页业务 UI（皮肤管理页状态栏），否则会误显示「自动模式」 */
  function notify() {
    try {
      var ev = (typeof CustomEvent === 'function') ? new CustomEvent('fschange') : document.createEvent('Event');
      if (typeof CustomEvent !== 'function') ev.initEvent('fschange', false, false);
      document.dispatchEvent(ev);
    } catch (e) {}
  }
  function turnOff() {
    lsSet(KEY_OFF, '1');
    ssDel(KEY_PREVIEW);
    panelOpen = false;
    try { document.documentElement.setAttribute('data-fs', 'off'); } catch (e) {}
    ensureRoot();
    if (root) root.style.display = '';      /* 只藏装饰层，露出恢复按钮 */
    try { var pnl = document.getElementById('fsPanel'); if (pnl) pnl.style.display = 'none'; } catch (e) {}
    notify();
  }
  function turnOn() {
    lsDel(KEY_OFF);
    /* 网址若带 ?fs=off，刷新会立刻又关掉 → 顺手把参数去掉 */
    try {
      if (window.history && history.replaceState && /[?&]fs=off(?:&|$)/.test(location.search)) {
        var q = location.search.replace(/([?&])fs=off(?:&|$)/, '$1').replace(/[?&]$/, '');
        history.replaceState(null, '', location.pathname + q + location.hash);
      }
    } catch (e) {}
    lastKey = '';
    refresh(true);
    notify();
  }
  function isOff() { return lsGet(KEY_OFF) === '1'; }
  /* ---------- 皮肤浓度 ---------- */
  function strength() {
    var s = qs('fs');
    if (s === 'soft' || s === 'normal' || s === 'strong') return s;
    var v = lsGet(KEY_STRENGTH);
    return (v === 'soft' || v === 'strong') ? v : 'normal';
  }
  function setStrength(v) {
    if (v === 'soft' || v === 'strong') lsSet(KEY_STRENGTH, v);
    else lsDel(KEY_STRENGTH);
    lastKey = ''; refresh(true); notify();
  }

  /* ---------- 节日插画贺卡（按需只加载当天那一张） ---------- */
  function artUrl(id) { return 'fs-' + id + '.webp'; }
  function cardVisible() { return lsGet(KEY_CARD) !== '1'; }
  /* 皮肤管理页自己就是 37 张插画墙，左下角再叠一张贺卡反而盖住卡片 → 本页不显示 */
  function cardHostVisible() {
    try {
      var f = decodeURIComponent((location.pathname || '').split('/').pop() || '');
      if (f === '皮肤管理.html') return false;
    } catch (e) {}
    return cardVisible();
  }
  function setCardVisible(v) {
    if (v) lsDel(KEY_CARD); else lsSet(KEY_CARD, '1');
    try { var c = document.getElementById('fsCard'); if (c) c.style.display = cardHostVisible() ? '' : 'none'; } catch (e) {}
    notify();
  }
  var artCache = {};
  function loadArt(url, el) {
    el.className = 'fs-card-img'; el.style.backgroundImage = '';
    if (artCache[url] === false) { el.className = 'fs-card-img noimg'; return; }
    try {
      var im = new Image();
      im.onload = function () { artCache[url] = true; el.style.backgroundImage = 'url("' + url + '")'; };
      im.onerror = function () { artCache[url] = false; el.className = 'fs-card-img noimg'; };
      im.src = url;
    } catch (e) { el.className = 'fs-card-img noimg'; }
  }
  function setCard(p) {
    try {
      var card = document.getElementById('fsCard'); if (!card) return;
      card.style.display = cardHostVisible() ? '' : 'none';
      var url = artUrl(p.id);
      var ci = document.getElementById('fsCardImg'); if (ci) loadArt(url, ci);
      document.getElementById('fsCardName').textContent = p.t.n;
      document.getElementById('fsCardWish').textContent = p.t.w;
      var li = document.getElementById('fsLightImg'); if (li) li.src = url;
      var lt = document.getElementById('fsLightTxt'); if (lt) lt.textContent = p.t.n + ' · ' + p.t.w;
    } catch (e) {}
  }

  /* ---------- 截图 / 导出 PNG 时叠加节日主题 ----------
   * html2canvas 只截 .wrap，body 下的 fixed 浮层根本进不了画布。
   * 所以直接在生成好的 canvas 上重画一遍：彩条 / 四边柔光 / 专属线稿 /
   * 节日插画贺卡 / 节日名祝语 / 落款。全部同域资源，不污染 canvas。
   */
  function rgba(hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return 'rgba(128,128,128,' + a + ')';
    return 'rgba(' + ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255) + ',' + a + ')';
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath();
  }
  function loadImg(src) {
    return new Promise(function (res) {
      try {
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = function () { res(null); };
        im.src = src;
        if (im.complete && im.naturalWidth) res(im);
      } catch (e) { res(null); }
    });
  }
  function drawCover(ctx, im, x, y, w, h) {
    var k = Math.max(w / im.width, h / im.height), dw = im.width*k, dh = im.height*k;
    ctx.drawImage(im, x + (w-dw)/2, y + (h-dh)/2, dw, dh);
  }
  function paintCapture(canvas, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      try {
        if (isOff()) { resolve(false); return; }
        var p = pick();
        if (!p || !canvas || !canvas.getContext) { resolve(false); return; }
        var ctx = canvas.getContext('2d');
        if (!ctx) { resolve(false); return; }
        /* ★★ html2canvas 返回的 canvas 上残留 scale(2,2) 之类的变换，
           不重置的话彩条会画在顶部、贺卡却被画到画布外（只剩彩条、看不到插画）。 */
        ctx.save();
        try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch (e) {}
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        try { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; } catch (e) {}
        var W = canvas.width, H = canvas.height;
        var s = W / (opts.cssWidth || (W / 2));      /* html2canvas 的 scale，默认 2 */
        /* ★ 表格数据少时画布可能只有 100 多像素高：整套装饰按比例缩小，
           否则贺卡会被裁掉、四边柔光会把整张图染成一块色。 */
        var u = s * Math.min(1, H / (360 * s));
        var dark = !!opts.dark, c1 = p.t.c1, c2 = p.t.c2;
        var topGlow = Math.min(130*u, H*0.18), botGlow = Math.min(100*u, H*0.14);
        var svg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(patternSVG(p.id, c1));
        /* 初始化失败也要把最外层 save 还回去 */
        
        Promise.all([loadImg(artUrl(p.id)), loadImg(svg)]).then(function (ims) {
          try {
            var art = ims[0], pat = ims[1];
            var g = ctx.createLinearGradient(0, 0, W, 0);
            g.addColorStop(0, c1); g.addColorStop(.5, c2); g.addColorStop(1, c1);
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, 9*u);              /* ① 顶部彩条 */
            var al = dark ? .11 : .16;                                    /* ② 四边柔光 */
            var gt = ctx.createLinearGradient(0, 0, 0, topGlow);
            gt.addColorStop(0, rgba(c1, al)); gt.addColorStop(1, rgba(c1, 0));
            ctx.fillStyle = gt; ctx.fillRect(0, 0, W, topGlow);
            var gb = ctx.createLinearGradient(0, H, 0, H-botGlow);
            gb.addColorStop(0, rgba(c2, al)); gb.addColorStop(1, rgba(c2, 0));
            ctx.fillStyle = gb; ctx.fillRect(0, H-botGlow, W, botGlow);
            var gl = ctx.createLinearGradient(0, 0, 28*u, 0);
            gl.addColorStop(0, rgba(c1, al)); gl.addColorStop(1, rgba(c1, 0));
            ctx.fillStyle = gl; ctx.fillRect(0, 0, 28*u, H);
            var gr = ctx.createLinearGradient(W, 0, W-28*u, 0);
            gr.addColorStop(0, rgba(c2, al)); gr.addColorStop(1, rgba(c2, 0));
            ctx.fillStyle = gr; ctx.fillRect(W-28*u, 0, 28*u, H);
            if (pat && H > 150*u) {                                       /* ③ 专属线稿 */
              ctx.save(); ctx.globalAlpha = dark ? .5 : .34;
              ctx.drawImage(pat, W-190*u, 16*u, 170*u, 119*u); ctx.restore();
            }
            var cw = 176*u, ih = 108*u, th = 34*u, ch = ih+th;           /* ④ 插画贺卡 */
            var cx = 16*u, cy = Math.max(14*u, H-ch-14*u);
            if (cy + ch > H - 6*u) cy = Math.max(6*u, H-ch-6*u);        /* 保证不被裁切 */
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,.32)'; ctx.shadowBlur = 18*u; ctx.shadowOffsetY = 5*u;
            rr(ctx, cx, cy, cw, ch, 10*u);
            ctx.fillStyle = dark ? 'rgba(14,20,31,.95)' : 'rgba(255,255,255,.97)'; ctx.fill();
            ctx.restore();
            ctx.save(); rr(ctx, cx, cy, cw, ch, 10*u); ctx.clip();
            if (art) drawCover(ctx, art, cx, cy, cw, ih);
            else { ctx.fillStyle = g; ctx.fillRect(cx, cy, cw, ih); }
            ctx.fillStyle = dark ? 'rgba(14,20,31,.95)' : 'rgba(255,255,255,.97)';
            ctx.fillRect(cx, cy+ih, cw, th);
            ctx.fillStyle = dark ? '#eef4ff' : '#233047';
            ctx.font = 'bold ' + Math.max(9, 13*u) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
            ctx.fillText(p.t.n, cx+10*u, cy+ih+Math.min(15*u, th*0.46));
            ctx.fillStyle = dark ? '#9db0c8' : '#6b7688';
            ctx.font = Math.max(8, 10*u) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
            ctx.fillText(p.t.w, cx+10*u, cy+ih+Math.min(28*u, th*0.84));
            ctx.restore();
            ctx.save(); rr(ctx, cx, cy, cw, ch, 10*u);
            ctx.strokeStyle = c1; ctx.lineWidth = 1.5*u; ctx.stroke(); ctx.restore();
            ctx.fillStyle = dark ? 'rgba(238,244,255,.85)' : 'rgba(35,48,71,.75)';   /* ⑤ 落款 */
            ctx.font = Math.max(9, 11*u) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('海立铸运通 · ' + p.t.n + ' · ' + todayK(), W-16*u, H-14*u);
            ctx.textAlign = 'left';
            try { ctx.restore(); } catch (e2) {}
            resolve(true);
          } catch (e) {
            try { console.warn('[festival-skin] 截图节日主题绘制失败：', e && e.message); } catch (e2) {}
            try { ctx.restore(); } catch (e2) {}
            resolve(false);
          }
        });
      } catch (e) {
        try { console.warn('[festival-skin] 截图节日主题初始化失败：', e && e.message); } catch (e2) {}
        try { if (ctx) ctx.restore(); } catch (e2) {}
        resolve(false);
      }
    });
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
    syncCloud();
    /* 每 5 分钟检查跨零点 + 云端设置（只读一条几十字节的记录） */
    setInterval(function () { syncCloud(); refresh(false); }, 5 * 60 * 1000);
    try {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
      window.addEventListener('focus', function () { refresh(false); });
      window.addEventListener('storage', function (ev) {
        if (ev && (ev.key === KEY_OVR || ev.key === KEY_OFF || ev.key === KEY_STRENGTH || ev.key === KEY_CARD)) { lastKey = ''; refresh(true); }
      });
    } catch (e) {}
  }

  /* 对外暴露，便于守护测试与排障 */
  window.FestivalSkin = {
    version: VER, themes: THEMES, termIds: TERM_IDS, festIds: FEST_IDS,
    holidays: HOLIDAYS, lunarFest: LUNAR_FEST, termTable: TERM_TABLE,
    pick: pick, apply: apply, refresh: refresh, turnOff: turnOff,
    turnOn: turnOn, isOff: isOff, strength: strength, setStrength: setStrength,
    motifs: MOTIFS, patternSVG: patternSVG, artUrl: artUrl,
    cardVisible: cardVisible, setCardVisible: setCardVisible,
    paintCapture: paintCapture,
    preview: preview, currentPreview: currentPreview,
    override: override, setOverride: setOverride, clearOverride: clearOverride,
    syncCloud: syncCloud, isAdmin: isAdmin, cloudKey: CLOUD_KEY,
    termDay: termDay, currentTerm: currentTerm, findHoliday: findHoliday,
    findLunarFest: findLunarFest, lunarText: lunarText, isDark: isDark
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
