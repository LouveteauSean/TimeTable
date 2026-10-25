/*!
 * TimeTable clone — src/app.js
 * 像素级复刻版：DOM / 类名 / 文本 / 交互与原始单文件产物一致（见 rebuild/docs/logic-spec.md）。
 * 名单功能按数据自动开关：数据含 people（内部完整数据）时显示名单/学生相关 UI，
 * 公开数据不含 people 时自动隐藏——因此同一份代码可同时构建公开版与内部部署版。
 * 数据由构建注入 window.__TT_DATA__（rebuild/src/data.raw.json）。
 */
(function () {
  'use strict';

  var Q = window.__TT_DATA__;
  var ENHANCED = true; // 公开版本始终启用：无障碍 / 动态标题 / hash 同步 / 输入法安全
  var HAS_PEOPLE = Array.isArray(Q.people) && Q.people.length > 0;
  var SEARCH_PLACEHOLDER = HAS_PEOPLE
    ? '搜索课程、班级、教室或学生姓名 / 学号'
    : '搜索课程、班级、教师或教室';

  /* ------------------------------------------------------------------ *
   * 常量（逻辑规格 §3）
   * ------------------------------------------------------------------ */
  var WEEKDAY_FULL = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  var WEEKDAY_CHAR = '一二三四五六日';
  var PERIOD_CHAR = '一二三四五';
  var COLORS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  var PICK_TITLES = { class: '选择班级', teacher: '选择教师', room: '选择教室' };
  var TYPE_LABELS = { course: '课程', class: '班级', person: '学生', teacher: '教师', room: '教室' };
  var TYPE_RANK = { class: 0, person: 1, room: 2, course: 3, teacher: 4 };
  var SEMESTER_START = new Date(2026, 7, 31);
  var WEEK_MS = 6048e5;
  var MAX_WEEK = 20;
  var ANCHOR = '<!---->';

  var ICON_PATHS = {
    check: '<path d="M3.3 8.7 6.4 11.8 12.8 4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    person: '<circle cx="8" cy="5.6" r="2.4" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 13.1c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    class: '<path d="M2.6 6.6 8 3.9l5.4 2.7L8 9.3 2.6 6.6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.1 8.1v3.2c0 .9 1.3 1.6 2.9 1.6s2.9-.7 2.9-1.6V8.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    course: '<path d="M8 4.7C6.7 3.8 4.9 3.4 2.9 3.4v8.1c2 0 3.8.4 5.1 1.3 1.3-.9 3.1-1.3 5.1-1.3V3.4c-2 0-3.8.4-5.1 1.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 4.7v8.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    teacher: '<rect x="2.6" y="3.4" width="10.8" height="7.2" rx="1.3" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 13.2h4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    room: '<path d="M8 14.1s4.1-4.3 4.1-7.2A4.1 4.1 0 0 0 3.9 6.9c0 2.9 4.1 7.2 4.1 7.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="6.9" r="1.5" stroke="currentColor" stroke-width="1.5"/>',
    close: '<path d="M4.7 4.7 11.3 11.3M11.3 4.7 4.7 11.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    search: '<circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.7"/><path d="M10.3 10.3 14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    prev: '<path d="M9.9 3.4 5.3 8l4.6 4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    next: '<path d="M6.1 3.4 10.7 8l-4.6 4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'
  };

  function ico(name) {
    return '<svg class="ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">' + ICON_PATHS[name] + '</svg>';
  }

  /* ------------------------------------------------------------------ *
   * 纯函数 / 派生数据（§15）
   * ------------------------------------------------------------------ */
  function splitTeachers(entry) {
    return String(entry.teacher || '')
      .split(/[、,，]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function colorClass(course) {
    var h = 0;
    for (var i = 0; i < course.length; i++) h = (h * 31 + course.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  function currentWeek() {
    var diff = Date.now() - SEMESTER_START.getTime();
    if (diff < 0) return 1;
    return Math.min(MAX_WEEK, Math.max(1, Math.floor(diff / WEEK_MS) + 1));
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  var peopleCountByClass = HAS_PEOPLE ? Q.people.reduce(function (acc, p) {
    acc[p.klass] = (acc[p.klass] || 0) + 1;
    return acc;
  }, {}) : {};

  function teacherDirectory() {
    var map = new Map();
    for (var i = 0; i < Q.classes.length; i++) {
      var entries = Q.classes[i].entries;
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        var list = splitTeachers(e);
        for (var k = 0; k < list.length; k++) {
          var t = list[k];
          if (!t || t === '体育课') continue;
          if (!map.has(t)) map.set(t, new Set());
          map.get(t).add(e.day + '|' + e.period + '|' + [e.course, e.code, e.teacher, e.weekText].join('|'));
        }
      }
    }
    var out = [];
    map.forEach(function (set, name) { out.push([name, set.size]); });
    return out.sort(function (a, b) { return a[0].localeCompare(b[0], 'zh'); });
  }

  function roomDirectory() {
    var map = new Map();
    for (var i = 0; i < Q.classes.length; i++) {
      var entries = Q.classes[i].entries;
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        var r = String(e.room || '').trim();
        if (!r || r === '无地点安排') continue;
        if (!map.has(r)) map.set(r, new Set());
        map.get(r).add(e.day + '|' + e.period + '|' + [e.course, e.code, e.teacher, e.weekText].join('|'));
      }
    }
    var out = [];
    map.forEach(function (set, name) { out.push([name, set.size]); });
    return out.sort(function (a, b) { return a[0].localeCompare(b[0], 'zh'); });
  }

  var TEACHERS = teacherDirectory();
  var ROOMS = roomDirectory();

  function findDirectory(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === name) return list[i][1];
    return 0;
  }

  /* 实体取条目（§15.5） */
  function classEntries(name) {
    if (!name) return [];
    for (var i = 0; i < Q.classes.length; i++) {
      if (Q.classes[i].name === name) return Q.classes[i].entries;
    }
    return [];
  }

  function weekFilter(entries, week) {
    if (!week) return entries;
    return entries.filter(function (e) { return !e.weeks.length || e.weeks.indexOf(week) !== -1; });
  }

  function classWeekEntries(name, week) {
    return weekFilter(classEntries(name), week);
  }

  function teacherEntries(name, week) {
    var out = [];
    if (!name) return out;
    for (var i = 0; i < Q.classes.length; i++) {
      var c = Q.classes[i];
      for (var j = 0; j < c.entries.length; j++) {
        var e = c.entries[j];
        if (splitTeachers(e).indexOf(name) === -1) continue;
        if (week && e.weeks.length && e.weeks.indexOf(week) === -1) continue;
        out.push(Object.assign({}, e, { clsName: c.name }));
      }
    }
    return out;
  }

  function roomEntries(name, week) {
    var out = [];
    if (!name) return out;
    var target = String(name).trim();
    for (var i = 0; i < Q.classes.length; i++) {
      var c = Q.classes[i];
      for (var j = 0; j < c.entries.length; j++) {
        var e = c.entries[j];
        if (String(e.room || '').trim() !== target) continue;
        if (week && e.weeks.length && e.weeks.indexOf(week) === -1) continue;
        out.push(Object.assign({}, e, { clsName: c.name }));
      }
    }
    return out;
  }

  function dedupe(list) {
    var map = new Map();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var key = [e.course, e.code, e.teacher, e.room, e.weekText].join('|');
      if (!map.has(key)) map.set(key, Object.assign({}, e, { clsList: [] }));
      var g = map.get(key);
      if (e.clsName && g.clsList.indexOf(e.clsName) === -1) g.clsList.push(e.clsName);
    }
    return Array.from(map.values());
  }

  /* 搜索索引（§13.2） */
  var searchIndex = (function () {
    var list = [];
    function push(o) { o.id = list.length; list.push(o); return o; }
    Q.classes.forEach(function (c) {
      push({ type: 'class', name: c.name, sub: c.entries.length + ' 节课', kw: c.name.toLowerCase() });
    });
    var courses = new Map();
    Q.classes.forEach(function (c) {
      c.entries.forEach(function (e) {
        if (!courses.has(e.course)) {
          courses.set(e.course, { type: 'course', name: e.course, sub: '', kw: e.course.toLowerCase() });
        }
      });
    });
    courses.forEach(function (o, course) {
      var ts = new Set();
      Q.classes.forEach(function (c) {
        c.entries.forEach(function (e) {
          if (e.course === course) splitTeachers(e).forEach(function (t) { ts.add(t); });
        });
      });
      o.sub = Array.from(ts).slice(0, 3).join('、');
      push(o);
    });
    if (HAS_PEOPLE) {
      Q.people.forEach(function (p) {
        push({
          type: 'person', name: p.name, sub: p.klass + ' · ' + p.code,
          kw: (p.name + ' ' + p.code).toLowerCase(), ref: p
        });
      });
    }
    TEACHERS.forEach(function (x) {
      push({ type: 'teacher', name: x[0], sub: '教师 · ' + x[1] + ' 节课', kw: x[0].toLowerCase() });
    });
    ROOMS.forEach(function (x) {
      push({ type: 'room', name: x[0], sub: '教室 · ' + x[1] + ' 节课', kw: x[0].toLowerCase() });
    });
    return list;
  })();

  function scoreSearch(raw) {
    var q = String(raw).trim().toLowerCase();
    if (!q) return [];
    var out = [];
    for (var i = 0; i < searchIndex.length; i++) {
      var item = searchIndex[i];
      var pos = item.kw.indexOf(q);
      if (pos === -1) continue;
      var score = 100 - pos;
      var lower = item.name.toLowerCase();
      if (lower === q) score += 100;
      if (lower.indexOf(q) === 0) score += 40;
      score -= TYPE_RANK[item.type] * 2;
      out.push({ item: item, score: score });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 12).map(function (x) { return x.item; });
  }

  /* 选择器索引（§11.2） */
  var pickerIndex = {
    class: Q.classes.map(function (c) { return { name: c.name, sub: c.entries.length + ' 节课' }; }),
    teacher: TEACHERS.map(function (x) { return { name: x[0], sub: x[1] + ' 节课' }; }),
    room: ROOMS.map(function (x) { return { name: x[0], sub: x[1] + ' 节课' }; })
  };

  /* ------------------------------------------------------------------ *
   * 状态（§1）
   * ------------------------------------------------------------------ */
  var state = {
    klass: null,
    room: null,
    teacher: null,
    entity: 'class',
    student: null,
    mode: 'week',
    week: 1,
    view: 'tt',
    anim: '',
    dragging: false,
    drag: 0,
    picker: { open: false, query: '' },
    modal: null,
    search: { q: '', open: false, active: -1 },
    dir: { mode: 'classes', klass: null }
  };

  var writingHash = false;

  function current() {
    return state.entity === 'teacher' ? state.teacher : state.entity === 'room' ? state.room : state.klass;
  }

  function pickLabel() {
    var cur = current();
    if (cur) return cur;
    return PICK_TITLES[state.entity] + '…';
  }

  function entityEntriesAll() {
    return state.entity === 'room' ? roomEntries(state.room, 0)
      : state.entity === 'teacher' ? teacherEntries(state.teacher, 0)
        : classEntries(state.klass);
  }

  function gridEntries() {
    if (state.entity === 'room') return roomEntries(state.room, state.mode === 'week' ? state.week : 0);
    if (state.entity === 'teacher') return teacherEntries(state.teacher, state.mode === 'week' ? state.week : 0);
    if (state.mode === 'gantt') return classEntries(state.klass);
    return classWeekEntries(state.klass, state.week);
  }

  function gridModel() {
    var entries = gridEntries();
    var byDay = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!byDay[e.day]) byDay[e.day] = {};
      byDay[e.day][e.period] = (byDay[e.day][e.period] || []).concat(e);
    }
    var days = [1, 2, 3, 4, 5];
    if (entries.some(function (x) { return x.day >= 6; })) days.push(6, 7);
    return {
      days: days,
      todayIdx: (new Date().getDay() + 6) % 7 + 1,
      rows: Q.periods.map(function (p) {
        return {
          no: p.no,
          time: p.time,
          label: '第' + PERIOD_CHAR[p.no - 1] + '节',
          cells: days.map(function (day) {
            var raw = (byDay[day] && byDay[day][p.no]) || [];
            return { day: day, items: raw.length ? dedupe(raw) : [] };
          })
        };
      }),
      isRoom: state.entity === 'room',
      isTeacher: state.entity === 'teacher'
    };
  }

  function gridTitleSub() {
    if (state.entity === 'room') {
      if (!state.room) return { title: '教室课表', sub: '点击上方选择一间教室' };
      return {
        title: state.room,
        sub: '教室课表 · 共' + findDirectory(ROOMS, state.room) + '节' + (state.mode === 'week' ? ' · 第' + state.week + '周' : '')
      };
    }
    if (state.entity === 'teacher') {
      if (!state.teacher) return { title: '教师课表', sub: '点击上方选择一位教师' };
      return {
        title: state.teacher,
        sub: '教师课表 · 共' + findDirectory(TEACHERS, state.teacher) + '节' + (state.mode === 'week' ? ' · 第' + state.week + '周' : '')
      };
    }
    return {
      title: state.klass,
      sub: Q.title + (state.mode === 'week' ? ' · 第' + state.week + '周' : ' · 学期全部课程')
    };
  }

  function weekDots() {
    var all = entityEntriesAll();
    var out = [];
    for (var w = 1; w <= MAX_WEEK; w++) {
      out.push({
        w: w,
        has: all.some(function (e) { return !e.weeks.length || e.weeks.indexOf(w) !== -1; }),
        cur: w === state.week
      });
    }
    return out;
  }

  function showStudentBanner() {
    return state.entity === 'class' && !!state.student && state.student.klass === state.klass;
  }

  function dirClasses() {
    return Q.classes.map(function (c) {
      var n = peopleCountByClass[c.name] || 0;
      return {
        name: c.name,
        sub: c.entries.length + ' 节课' + (n ? ' · ' + n + ' 名学生' : ''),
        hasPeople: !!n
      };
    });
  }

  function dirPeople() {
    return Q.people
      .filter(function (p) { return p.klass === state.dir.klass; })
      .map(function (p) { return { name: p.name, sub: '学号 ' + p.code, ref: p }; });
  }

  function modalCellItems(day, period) {
    return dedupe(entityEntriesAll().filter(function (e) { return e.day === day && e.period === period; }));
  }

  /* ------------------------------------------------------------------ *
   * DOM 骨架（§4–§12，空白/锚点与原版一致）
   * ------------------------------------------------------------------ */
  var app = document.getElementById('app');

  var HEADER_HTML =
    '<header class="app-header"><div class="header-inner"><div class="search-wrap">' +
    '<span class="search-icon">' + ico('search') + '</span> ' +
    '<input id="searchBox" class="search-box" type="text" autocomplete="off" placeholder="' + SEARCH_PLACEHOLDER + '"/> ' +
    '<button class="search-clear" id="searchClear" title="清空" aria-label="清空搜索">' + ico('close') + '</button> ' +
    '<button class="go-btn" id="goBtn">搜索</button> ' +
    '<div class="suggest" id="suggest"></div>' +
    '</div></div></header>';

  var TOOLBAR_HTML =
    '<div class="toolbar">' +
    '<div class="seg" id="entitySeg">' +
    '<button data-e="class" class="on">班级</button> <button data-e="teacher">教师</button> <button data-e="room">教室</button>' +
    '</div> ' +
    '<button id="pickBtn" class="pick-btn" aria-haspopup="listbox" aria-expanded="false">' +
    '<span class="pick-label" id="pickLabel">' + pickLabel() + '</span> ' +
    '<svg class="pick-chev" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</button> ' +
    '<div class="seg mode-seg"><button id="btnWeek" class="on">本周课表</button> <button id="btnGantt">学期总览</button></div>' +
    '</div>';

  var WEEKBAR_HTML =
    '<div class="week-bar" id="weekBar" style="display: flex;">' +
    '<div class="week-nav" id="weekNav">' +
    '<button id="wkPrev" title="上一周" aria-label="上一周">' + ico('prev') + '</button> ' +
    '<div class="week-label" id="wkNum"> </div> ' +
    '<button id="wkNext" title="下一周" aria-label="下一周">' + ico('next') + '</button> ' +
    '<button id="wkToday" title="回到本周" class="wk-today off">本周</button>' +
    '</div> ' +
    '<div class="week-marks" id="weekMarks"></div>' +
    '</div>';

  var BANNER_HTML = HAS_PEOPLE ? '<div class="banner" id="studentBanner" style="display: none;"></div>' : '';

  var GRID_HTML =
    '<div id="gridCard" class="grid-card">' +
    '<div class="grid-title"><h2 id="gridTitle"> </h2> <span class="sub" id="gridSub"> </span></div> ' +
    '<div class="grid-scroll"><table class="timetable" id="ttTable">' +
    '<thead><tr><th class="col-time">节次</th></tr></thead>' +
    '<tbody></tbody></table></div>' +
    '</div>';

  var VIEW_TT_HTML = '<section id="view-tt" class="view active">' +
    TOOLBAR_HTML + ANCHOR + ' ' + WEEKBAR_HTML + ANCHOR + ' ' + BANNER_HTML + ANCHOR + ' ' + GRID_HTML + ANCHOR +
    '</section>';

  var VIEW_DIR_HTML = HAS_PEOPLE ? (
    '<section id="view-dir" class="view">' +
    '<div class="picker-section" style="margin-top:0">' +
    '<h3>全部班级 <span class="cnt" id="dirCount"> </span></h3> ' +
    '<div class="dir-grid" id="dirGrid"></div>' +
    '</div> ' +
    '<div class="picker-section" id="peopleSection">' +
    '<h3 id="peopleTitle"></h3> ' +
    '<div class="dir-grid" id="peopleGrid"> </div>' +
    '</div>' +
    '</section>') : '';

  var LAYOUT_HTML = '<div class="layout">' + VIEW_TT_HTML + ' ' + VIEW_DIR_HTML + ANCHOR + ' ' +
    '<div class="footer">2026-2027学年秋季学期 · 8月31日开学 · 数据仅在本机浏览器中处理</div>' + '</div>';

  var MODAL_HTML =
    '<div id="modalMask" class="modal-mask"><div class="modal">' +
    '<div class="modal-head"><h3 id="mTitle">--</h3> <button class="modal-close" id="mClose" aria-label="关闭">' + ico('close') + '</button></div> ' +
    '<div class="modal-body"><div id="mBody"></div> <div class="modal-actions" id="mActions"></div></div>' +
    '</div></div>';

  var PICKER_HTML =
    '<div id="pickMask" class="pick-mask"><div class="pick-sheet" id="pickSheet" role="listbox">' +
    '<div class="pick-grab"></div> ' +
    '<div class="pick-head"><span class="pick-title" id="pickTitle"> </span> <button class="pick-close" id="pickClose" aria-label="关闭">' + ico('close') + '</button></div> ' +
    '<div class="pk-search-wrap"><span class="pk-search-ico">' + ico('search') + '</span> <input id="pickSearch" class="pk-search" type="text" autocomplete="off" placeholder="搜索名称…"/></div> ' +
    '<div class="pick-list" id="pickList"></div>' +
    '</div></div>';

  app.innerHTML = HEADER_HTML + ANCHOR + ' ' + LAYOUT_HTML + ' ' + MODAL_HTML + ANCHOR + ' ' + PICKER_HTML + ANCHOR;

  /* DOM 引用 */
  var el = {
    app: app,
    searchBox: document.getElementById('searchBox'),
    searchClear: document.getElementById('searchClear'),
    goBtn: document.getElementById('goBtn'),
    suggest: document.getElementById('suggest'),
    entitySeg: document.getElementById('entitySeg'),
    pickBtn: document.getElementById('pickBtn'),
    pickLabel: document.getElementById('pickLabel'),
    btnWeek: document.getElementById('btnWeek'),
    btnGantt: document.getElementById('btnGantt'),
    weekBar: document.getElementById('weekBar'),
    wkPrev: document.getElementById('wkPrev'),
    wkNum: document.getElementById('wkNum'),
    wkNext: document.getElementById('wkNext'),
    wkToday: document.getElementById('wkToday'),
    weekMarks: document.getElementById('weekMarks'),
    studentBanner: document.getElementById('studentBanner'),
    viewTt: document.getElementById('view-tt'),
    viewDir: document.getElementById('view-dir'),
    gridCard: document.getElementById('gridCard'),
    gridTitle: document.getElementById('gridTitle'),
    gridSub: document.getElementById('gridSub'),
    ttTable: document.getElementById('ttTable'),
    dirCount: document.getElementById('dirCount'),
    dirGrid: document.getElementById('dirGrid'),
    peopleSection: document.getElementById('peopleSection'),
    peopleTitle: document.getElementById('peopleTitle'),
    peopleGrid: document.getElementById('peopleGrid'),
    modalMask: document.getElementById('modalMask'),
    mTitle: document.getElementById('mTitle'),
    mBody: document.getElementById('mBody'),
    mActions: document.getElementById('mActions'),
    mClose: document.getElementById('mClose'),
    pickMask: document.getElementById('pickMask'),
    pickSheet: document.getElementById('pickSheet'),
    pickTitle: document.getElementById('pickTitle'),
    pickSearch: document.getElementById('pickSearch'),
    pickList: document.getElementById('pickList'),
    pickClose: document.getElementById('pickClose')
  };

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */
  function setClassList(node, tokens) {
    var value = tokens.filter(Boolean).join(' ');
    if (value) node.setAttribute('class', value);
    else node.removeAttribute('class');
  }

  // Svelte 的 set_class 语义：元素一旦被写入过动态 class，关掉时属性变为空串而非移除。
  function toggleOnClass(node, on) {
    if (on) node.setAttribute('class', 'on');
    else if (node.getAttribute('class') !== null) node.setAttribute('class', '');
  }

  function renderViews() {
    if (el.viewTt) setClassList(el.viewTt, ['view', state.view === 'tt' ? 'active' : '']);
    if (el.viewDir) setClassList(el.viewDir, ['view', state.view === 'dir' ? 'active' : '']);
  }

  function renderToolbar() {
    var buttons = el.entitySeg.querySelectorAll('button[data-e]');
    for (var i = 0; i < buttons.length; i++) {
      toggleOnClass(buttons[i], buttons[i].getAttribute('data-e') === state.entity);
    }
    setClassList(el.pickBtn, ['pick-btn', current() ? '' : 'placeholder']);
    el.pickBtn.setAttribute('aria-expanded', String(state.picker.open));
    el.pickLabel.textContent = pickLabel();
    toggleOnClass(el.btnWeek, state.mode === 'week');
    toggleOnClass(el.btnGantt, state.mode === 'gantt');
  }

  var lastRenderedWeek = null;
  var lastRenderedMode = null;

  function renderWeekBar() {
    el.weekBar.style.display = state.mode === 'week' ? 'flex' : 'none';
    el.wkNum.textContent = '第' + state.week + '周';
    el.wkPrev.disabled = state.week <= 1;
    el.wkNext.disabled = state.week >= MAX_WEEK;
    setClassList(el.wkToday, ['wk-today', state.week === currentWeek() ? 'off' : '']);
    if (state.mode === 'week') {
      var html = [];
      var dots = weekDots();
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        html.push('<button class="wk-dot' + (d.has ? ' has' : '') + (d.cur ? ' cur' : '') +
          '" data-w="' + d.w + '" aria-label="第' + d.w + '周">' + d.w + '</button>');
      }
      el.weekMarks.innerHTML = html.join('');
    } else {
      el.weekMarks.innerHTML = '';
    }
    // 原版 $effect：week / mode 变化后把当前周圆点滚到可视区中间（§7.4）
    if (lastRenderedWeek !== state.week || lastRenderedMode !== state.mode) {
      lastRenderedWeek = state.week;
      lastRenderedMode = state.mode;
      if (state.mode === 'week') {
        var cur = el.weekMarks.querySelector('.wk-dot.cur');
        if (cur && typeof cur.scrollIntoView === 'function') {
          cur.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
      }
    }
  }

  function renderBanner() {
    if (!HAS_PEOPLE || !el.studentBanner) return;
    el.studentBanner.style.display = showStudentBanner() ? 'flex' : 'none';
    if (!showStudentBanner()) {
      el.studentBanner.innerHTML = '';
      return;
    }
    var s = state.student;
    el.studentBanner.innerHTML =
      '<span class="banner-ico">' + ico('person') + '</span> ' +
      '<span><b>' + escapeHtml(s.name) + '</b> · 学号 ' + escapeHtml(s.code == null ? '' : s.code) + ' · <b>' + escapeHtml(s.klass) + '</b> 的班级课表</span> ' +
      '<button class="banner-x" id="bannerClose" title="退出查看" aria-label="退出查看">' + ico('close') + '</button>';
  }

  function slotCellHtml(item, idx, day, period, model) {
    var loc = (model.isRoom || model.isTeacher)
      ? (item.clsList && item.clsList.length ? item.clsList.join('、') : (item.clsName || ''))
      : item.room;
    return '<div data-idx="' + idx + '" class="slot-cell ' + colorClass(item.course) + '" data-day="' + day + '" data-period="' + period + '">' +
      '<div class="c-name">' + escapeHtml(item.course) + '</div> ' +
      '<div class="c-meta"><span class="c-teacher">' + escapeHtml(item.teacher || '—') + '</span> ' +
      (item.weekText ? '<span class="c-week">' + escapeHtml('· ' + item.weekText) + '</span>' : '') + ANCHOR + ' ' +
      (loc ? '<br><span class="c-loc">' + escapeHtml(loc) + '</span>' : '') + ANCHOR +
      '</div></div>';
  }

  function renderGrid() {
    var t = gridTitleSub();
    el.gridTitle.textContent = t.title == null ? '' : t.title;
    el.gridSub.textContent = t.sub;
    setClassList(el.gridCard, ['grid-card',
      state.anim === 'wk-in-right' ? 'wk-in-right' : '',
      state.anim === 'wk-in-left' ? 'wk-in-left' : '',
      state.dragging ? 'dragging' : '']);
    if (state.dragging) el.gridCard.style.transform = 'translateX(' + state.drag + 'px)';
    else el.gridCard.removeAttribute('style');

    var model = gridModel();
    var thead = '<th class="col-time">节次</th>';
    for (var d = 0; d < model.days.length; d++) {
      var day = model.days[d];
      thead += '<th' + (day === model.todayIdx ? ' class="today"' : '') + '>' + WEEKDAY_FULL[day - 1] + '</th>';
    }
    var theadRow = el.ttTable.querySelector('thead tr');
    theadRow.innerHTML = thead + ANCHOR;

    var rows = [];
    for (var r = 0; r < model.rows.length; r++) {
      var row = model.rows[r];
      var html = '<tr><td class="time-cell"><div class="t-no">' + row.label + '</div> <div class="t-time">' + row.time + '</div></td>';
      for (var c = 0; c < row.cells.length; c++) {
        var cell = row.cells[c];
        var content;
        if (cell.items.length) {
          var cards = [];
          for (var k = 0; k < cell.items.length; k++) {
            cards.push(slotCellHtml(cell.items[k], k, cell.day, row.no, model));
          }
          content = '<div class="slot-stack">' + cards.join('') + '</div>';
        } else {
          content = '<div class="empty-slot">·</div>';
        }
        html += '<td class="slot">' + content + ANCHOR + '</td>';
      }
      html += ANCHOR + '</tr>';
      rows.push(html);
    }
    el.ttTable.querySelector('tbody').innerHTML = rows.join('');
  }

  function renderSuggest() {
    el.suggest.style.display = state.search.open ? 'block' : 'none';
    if (el.searchBox.value !== state.search.q) el.searchBox.value = state.search.q;
    el.searchClear.style.display = state.search.q ? 'flex' : 'none';
    var list = state.search.q.trim() ? scoreSearch(state.search.q) : [];
    if (!list.length) {
      el.suggest.innerHTML = '<div class="suggest-empty">未找到匹配的课程 / 班级 / 教室 / 人员</div>';
      return;
    }
    var html = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      html.push('<button class="suggest-item' + (i === state.search.active ? ' active' : '') + '">' +
        '<span class="s-tag ' + item.type + '">' + TYPE_LABELS[item.type] + '</span> ' +
        '<span class="s-name">' + ico(item.type) + ANCHOR + ' ' + escapeHtml(item.name) + '</span> ' +
        '<span class="s-sub">' + escapeHtml(item.sub || '') + '</span>' +
        '</button>');
    }
    el.suggest.innerHTML = html.join('');
    // 事件：逐条绑定（原版用闭包；不添加额外 DOM 属性以保持 DOM 一致）
    var nodes = el.suggest.querySelectorAll('.suggest-item');
    for (var j = 0; j < nodes.length; j++) {
      (function (node, item) {
        node.addEventListener('click', function () { pickSearchItem(item); });
      })(nodes[j], list[j]);
    }
  }

  function renderPicker() {
    setClassList(el.pickMask, ['pick-mask', state.picker.open ? 'show' : '']);
    el.pickTitle.textContent = PICK_TITLES[state.entity];
    if (el.pickSearch.value !== state.picker.query) el.pickSearch.value = state.picker.query;

    var q = state.picker.query.trim().toLowerCase();
    var list = pickerIndex[state.entity].filter(function (x) {
      return !q || x.name.toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) {
      el.pickList.innerHTML = '<div class="pk-empty">未找到匹配项</div>';
    } else {
      var html = [];
      var cur = current();
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        html.push('<button class="pk-row' + (item.name === cur ? ' cur' : '') + '" data-name="' + escapeAttr(item.name) + '">' +
          '<span class="pk-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="pk-sub">' + escapeHtml(item.sub) + '</span> ' +
          '<span class="pk-check">' + ico('check') + '</span>' +
          '</button>');
      }
      el.pickList.innerHTML = html.join('');
    }

    if (state.picker.open) {
      positionSheet();
      if (window.innerWidth > 733 && document.activeElement !== el.pickSearch) el.pickSearch.focus();
    }
  }

  function positionSheet() {
    var sheet = el.pickSheet;
    if (window.innerWidth <= 733) {
      sheet.style.width = '';
      sheet.style.top = '';
      sheet.style.left = '';
      return;
    }
    var r = el.pickBtn.getBoundingClientRect();
    var w = Math.min(340, window.innerWidth - 24);
    sheet.style.width = w + 'px';
    var h = Math.min(sheet.offsetHeight || 380, 440);
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
    sheet.style.top = top + 'px';
    sheet.style.left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10) + 'px';
  }

  function renderModal() {
    setClassList(el.modalMask, ['modal-mask', state.modal ? 'show' : '']);
    el.mTitle.textContent = state.modal && state.modal.title ? state.modal.title : '--';
    if (!state.modal) {
      el.mBody.innerHTML = '';
      el.mActions.innerHTML = '';
      return;
    }
    var rows = state.modal.rows.map(function (row) {
      return '<div class="kv"><div class="k">' + escapeHtml(row.k) + '</div><div class="v">' + escapeHtml(row.v) + '</div></div>';
    });
    el.mBody.innerHTML = rows.join('');
    var actions = state.modal.actions.map(function (a) {
      return '<button class="chip-btn">' + escapeHtml(a.label) + '</button>';
    });
    el.mActions.innerHTML = actions.join('');
    var nodes = el.mActions.querySelectorAll('.chip-btn');
    for (var i = 0; i < nodes.length; i++) {
      (function (node, action) {
        node.addEventListener('click', function () { onAction(action); });
      })(nodes[i], state.modal.actions[i]);
    }
  }

  function renderDir() {
    if (!HAS_PEOPLE || !el.dirGrid) return;
    el.dirCount.textContent = Q.classes.length + ' 个班' + (state.dir.mode === 'roster' ? '' : ' · 点击查看课表');
    var cards = dirClasses();
    var html = [];
    for (var i = 0; i < cards.length; i++) {
      html.push('<div class="dir-card" data-c="' + escapeAttr(cards[i].name) + '">' +
        '<div class="d-name">' + escapeHtml(cards[i].name) + '</div> ' +
        '<div class="d-meta">' + escapeHtml(cards[i].sub) + '</div>' +
        '</div>');
    }
    el.dirGrid.innerHTML = html.join('');

    el.peopleSection.style.display = state.dir.mode === 'roster' ? 'block' : 'none';
    if (state.dir.mode !== 'roster') {
      el.peopleTitle.innerHTML = '';
      el.peopleGrid.innerHTML = ' ';
      return;
    }
    var people = dirPeople();
    el.peopleTitle.innerHTML = escapeHtml(state.dir.klass || '') + ' 学生名单 <span class="cnt">' +
      people.length + ' 人 · 点击查看课表</span>';
    var peopleHtml = [];
    for (var j = 0; j < people.length; j++) {
      var p = people[j];
      peopleHtml.push('<div class="dir-card" data-p="' + escapeAttr(p.name + '|' + p.sub) + '">' +
        '<div class="d-name">' + escapeHtml(p.name) + '</div> ' +
        '<div class="d-meta">' + escapeHtml(p.sub) + '</div>' +
        '</div>');
    }
    var empty = people.length ? '' : '<div style="color:var(--muted)">该班级暂无学生数据</div>';
    el.peopleGrid.innerHTML = peopleHtml.join('') + ' ' + empty;
    var nodes = el.peopleGrid.querySelectorAll('.dir-card[data-p]');
    for (var k = 0; k < nodes.length; k++) {
      (function (node, person) {
        node.addEventListener('click', function () { openStudent(person); });
      })(nodes[k], people[k].ref);
    }
  }

  function render() {
    renderViews();
    renderToolbar();
    renderWeekBar();
    renderBanner();
    renderGrid();
    renderSuggest();
    renderPicker();
    renderModal();
    renderDir();
    applyEnhancements();
  }

  /* ------------------------------------------------------------------ *
   * 文案转义
   * ------------------------------------------------------------------ */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ *
   * 动作（§16）
   * ------------------------------------------------------------------ */
  function writeHash(value) {
    writingHash = true;
    location.hash = value;
    writingHash = false;
  }

  function selectClass(name, keepStudent) {
    state.klass = name;
    state.entity = 'class';
    if (!keepStudent) state.student = null;
    writeHash('class=' + encodeURIComponent(name));
    state.view = 'tt';
    window.scrollTo({ top: 0 });
    render();
  }

  function selectTeacher(name) {
    state.teacher = name;
    state.entity = 'teacher';
    state.student = null;
    writeHash('teacher=' + encodeURIComponent(name));
    state.view = 'tt';
    window.scrollTo({ top: 0 });
    render();
  }

  function selectRoom(name) {
    state.room = name;
    state.entity = 'room';
    state.student = null;
    writeHash('room=' + encodeURIComponent(name));
    state.view = 'tt';
    window.scrollTo({ top: 0 });
    render();
  }

  function openStudent(person) {
    state.student = { name: person.name, code: person.code, klass: person.klass };
    selectClass(person.klass, true);
    writeHash('person=' + encodeURIComponent(person.name) + '&code=' + encodeURIComponent(person.code));
    render();
  }

  function closeStudent() {
    state.student = null;
    writeHash('class=' + encodeURIComponent(state.klass));
    render();
  }

  function selectEntity(x) {
    if (state.entity === x) { openPicker(); return; }
    if (x === 'class' && state.klass) { selectClass(state.klass); return; }
    if (x === 'teacher' && state.teacher) { selectTeacher(state.teacher); return; }
    if (x === 'room' && state.room) { selectRoom(state.room); return; }
    state.entity = x;
    state.student = null;
    openPicker();
  }

  function openPicker() {
    state.picker.query = '';
    state.picker.open = true;
    render();
  }

  function closePicker() {
    state.picker.open = false;
    render();
  }

  function selectFromPicker(name) {
    closePicker();
    if (state.entity === 'teacher') selectTeacher(name);
    else if (state.entity === 'room') selectRoom(name);
    else selectClass(name);
  }

  function setMode(mode) {
    state.mode = mode;
    render();
  }

  function stepWeek(delta) {
    var w = clamp(state.week + delta, 1, MAX_WEEK);
    if (w !== state.week) {
      state.week = w;
      state.anim = delta > 0 ? 'wk-in-right' : 'wk-in-left';
    }
    render();
  }

  function goToday() {
    state.week = currentWeek();
    state.anim = '';
    render();
  }

  function setWeek(w) {
    state.week = w;
    state.anim = '';
    render();
  }

  function openRoster(klass) {
    state.view = 'dir';
    state.dir = { mode: 'roster', klass: klass };
    writeHash('dir');
    window.scrollTo({ top: 0 });
    render();
  }

  function onDirClassClick(card) {
    if (card.hasPeople) openRoster(card.name);
    else selectClass(card.name);
  }

  function closeSuggest() {
    state.search.open = false;
    state.search.active = -1;
    render();
  }

  function setSearchQuery(value) {
    state.search.q = value;
    state.search.active = -1;
    state.search.open = !!String(value).trim();
    render();
  }

  function clearSearch() {
    state.search.q = '';
    closeSuggest();
  }

  function applySearchItem(item) {
    if (item.type === 'class') selectClass(item.name);
    else if (item.type === 'person') openStudent(item.ref);
    else if (item.type === 'room') selectRoom(item.name);
    else if (item.type === 'course') openCourseModal(item.name);
    else if (item.type === 'teacher') selectTeacher(item.name);
  }

  function pickSearchItem(item) {
    state.search.q = item.name;
    closeSuggest();
    applySearchItem(item);
  }

  function submitSearch() {
    var list = scoreSearch(state.search.q);
    var item = list[0];
    if (item) {
      state.search.q = item.name;
      applySearchItem(item);
      closeSuggest();
    } else if (String(state.search.q).trim()) {
      state.search.open = true;
      render();
    }
  }

  function moveActive(delta) {
    var n = scoreSearch(state.search.q).length;
    state.search.active = Math.max(0, Math.min(state.search.active + delta, n - 1));
    render();
  }

  function applyActiveOrFirst() {
    var list = scoreSearch(state.search.q);
    var item = state.search.active >= 0 ? list[state.search.active] : list[0];
    if (item) {
      state.search.q = item.name;
      applySearchItem(item);
      closeSuggest();
    }
  }

  function closeModal() {
    if (!state.modal) return;
    state.modal = null;
    render();
  }

  function openCardModal(day, period, idx) {
    var items = modalCellItems(day, period);
    if (!items.length) return;
    var it = items[idx || 0] || items[0];
    var rows = [
      { k: '课程代码', v: it.code },
      { k: '教师', v: it.teacher },
      { k: '时间', v: '周' + WEEKDAY_CHAR[day - 1] + ' 第' + period + '节 ' + ((Q.periods[period - 1] || {}).time || '') },
      { k: '周次', v: it.weekText },
      { k: '班级', v: it.clsList && it.clsList.length ? it.clsList.join('、') : (it.clsName || it.klass) },
      { k: '地点', v: it.room }
    ].filter(function (row) { return row.v; });

    var actions = [];
    var cur = current();
    var others = new Set();
    Q.classes.forEach(function (c) {
      c.entries.forEach(function (e) {
        if (e.course === it.course && c.name !== cur) others.add(c.name);
      });
    });
    if (others.size) actions.push({ label: '全校开课位置 · ' + others.size + ' 个班', type: 'course', value: it.course });
    var teachers = splitTeachers(it);
    if (state.entity !== 'teacher') {
      teachers.forEach(function (name) { actions.push({ label: '教师课表 · ' + name, type: 'teacher', value: name }); });
    }
    if (state.entity !== 'room' && it.room && it.room !== '无地点安排') {
      actions.push({ label: '教室课表 · ' + it.room, type: 'room', value: it.room });
    }
    if (state.entity !== 'class') {
      var names = it.clsList && it.clsList.length ? it.clsList : [it.clsName].filter(Boolean);
      names.forEach(function (n) {
        var exists = Q.classes.some(function (c) { return c.name === n; });
        if (exists) actions.push({ label: '班级课表 · ' + n, type: 'klass', value: n });
      });
    } else if (HAS_PEOPLE) {
      actions.push({ label: '本班学生名单', type: 'roster' });
    }
    state.modal = { title: it.course, rows: rows, actions: actions };
    render();
  }

  function openCourseModal(course) {
    var list = [];
    Q.classes.forEach(function (c) {
      c.entries.forEach(function (e) {
        if (e.course === course) list.push(Object.assign({}, e, { cls: c.name }));
      });
    });
    var teachers = new Set();
    list.forEach(function (e) { splitTeachers(e).forEach(function (t) { teachers.add(t); }); });
    var rows = [{ k: '开课班级', v: list.length + ' 个班次' }];
    if (teachers.size) rows.push({ k: '授课教师', v: Array.from(teachers).join('、') });
    state.modal = {
      title: course,
      rows: rows,
      actions: list.map(function (e) {
        return { label: e.cls + ' · 周' + WEEKDAY_CHAR[e.day - 1] + '第' + e.period + '节', type: 'klass', value: e.cls };
      })
    };
    render();
  }

  function onAction(action) {
    state.modal = null;
    render();
    if (action.type === 'course') openCourseModal(action.value);
    else if (action.type === 'teacher') selectTeacher(action.value);
    else if (action.type === 'room') selectRoom(action.value);
    else if (action.type === 'klass') selectClass(action.value);
    else if (action.type === 'roster') openRoster(state.klass);
  }

  /* ------------------------------------------------------------------ *
   * 启动（§17）
   * ------------------------------------------------------------------ */
  function boot() {
    state.week = currentWeek();
    var p = new URLSearchParams(location.hash.slice(1));
    if (HAS_PEOPLE && p.get('person')) {
      var person = Q.people.find(function (x) {
        return x.name === p.get('person') && (!p.get('code') || x.code === p.get('code'));
      });
      if (person) {
        state.student = { name: person.name, code: person.code, klass: person.klass };
        state.klass = person.klass;
        state.entity = 'class';
        state.view = 'tt';
        state.dir = { mode: 'classes', klass: null };
        state.mode = 'week';
        return;
      }
    }
    if (p.get('room')) {
      var r = p.get('room');
      if (ROOMS.some(function (x) { return x[0] === r; })) {
        state.room = r;
        state.entity = 'room';
      }
    }
    if (p.get('teacher')) {
      var t = p.get('teacher');
      if (TEACHERS.some(function (x) { return x[0] === t; })) {
        state.teacher = t;
        state.entity = 'teacher';
      }
    }
    if (state.entity !== 'room' && state.entity !== 'teacher') {
      if (p.get('class')) {
        var c = Q.classes.find(function (x) { return x.name === p.get('class'); });
        if (c) state.klass = c.name;
      }
      if (!state.klass) state.klass = Q.classes[0].name;
    }
    state.mode = 'week';
  }

  /* ------------------------------------------------------------------ *
   * 事件
   * ------------------------------------------------------------------ */
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var closest = function (sel) { return target.closest(sel); };

    if (closest('.search-clear')) { clearSearch(); return; }
    if (closest('#goBtn')) { submitSearch(); return; }
    if (closest('.suggest-item')) return; // 逐条绑定

    var entityBtn = closest('#entitySeg button[data-e]');
    if (entityBtn) { selectEntity(entityBtn.getAttribute('data-e')); return; }

    if (closest('#pickBtn')) { openPicker(); return; }
    if (closest('#btnWeek')) { setMode('week'); return; }
    if (closest('#btnGantt')) { setMode('gantt'); return; }
    if (closest('#wkPrev')) { stepWeek(-1); return; }
    if (closest('#wkNext')) { stepWeek(1); return; }
    if (closest('#wkToday')) { goToday(); return; }

    var dot = closest('.wk-dot');
    if (dot) { setWeek(Number(dot.getAttribute('data-w'))); return; }

    var bannerClose = closest('#bannerClose');
    if (bannerClose) { closeStudent(); return; }

    var cell = closest('.slot-cell');
    if (cell) {
      openCardModal(Number(cell.getAttribute('data-day')), Number(cell.getAttribute('data-period')), Number(cell.getAttribute('data-idx')));
      return;
    }

    if (closest('#mClose')) { closeModal(); return; }
    if (event.target === el.modalMask) { closeModal(); return; }

    if (closest('#pickClose')) { closePicker(); return; }
    if (event.target === el.pickMask) { closePicker(); return; }

    var row = closest('.pk-row');
    if (row) { selectFromPicker(row.getAttribute('data-name')); return; }

    var dirCard = closest('#dirGrid .dir-card');
    if (dirCard) {
      var name = dirCard.getAttribute('data-c');
      onDirClassClick({ name: name, hasPeople: !!(peopleCountByClass[name] || 0) });
      return;
    }
  });

  // 点击搜索区外 → 关闭建议（§14.2）
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest || target.closest('.search-wrap')) return;
    if (state.search.open) closeSuggest();
  });

  // 搜索框 / picker 输入
  document.addEventListener('input', function (event) {
    var t = event.target;
    if (!t) return;
    if (ENHANCED && t.__ttComposing) return;
    if (t.id === 'searchBox') setSearchQuery(t.value);
    else if (t.id === 'pickSearch') { state.picker.query = t.value; render(); }
  });

  // 键盘
  document.addEventListener('keydown', function (event) {
    var t = event.target;
    if (!t) return;
    if (t.id === 'searchBox') {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return; }
      if (event.key === 'Enter') { event.preventDefault(); applyActiveOrFirst(); return; }
      if (event.key === 'Escape') { closeSuggest(); return; }
    }
    if (t.id === 'pickSearch' && event.key === 'Enter') {
      var q = state.picker.query.trim().toLowerCase();
      var list = pickerIndex[state.entity].filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) !== -1; });
      if (list.length) selectFromPicker(list[0].name);
      return;
    }
    if (event.key === 'Escape') {
      if (state.modal) closeModal();
      if (state.picker.open) closePicker();
    }
  });

  // #gridCard 动画结束 → 清空 anim（§9.4）
  el.gridCard.addEventListener('animationend', function () {
    if (state.anim) { state.anim = ''; renderGrid(); }
  });

  // 滚动指示（§14.4）
  (function initScrollWatcher() {
    var timer = 0;
    window.addEventListener('scroll', function () {
      document.documentElement.classList.add('is-scrolling');
      clearTimeout(timer);
      timer = setTimeout(function () {
        document.documentElement.classList.remove('is-scrolling');
      }, 900);
    }, { passive: true, capture: true });
  })();

  // resize 时重算 picker 位置（§11.3）
  window.addEventListener('resize', function () {
    if (state.picker.open) positionSheet();
  });

  /* ------------------------------------------------------------------ *
   * 手势（§14.1）
   * ------------------------------------------------------------------ */
  (function initGestures() {
    var x0 = 0, y0 = 0, dx = 0, dy = 0, t0 = 0;
    var tracking = false, horizontal = false;
    var wheelAcc = 0, lastDir = 0, lastFire = 0;

    function overlayOpen() {
      return !!(document.querySelector('.pick-mask.show, .modal-mask.show'));
    }
    function ignored(target) {
      return !!(target && target.closest && target.closest('.week-marks, button, input, .suggest, .pick-mask, .modal-mask, .modal'));
    }

    el.viewTt.addEventListener('touchstart', function (e) {
      if (state.mode !== 'week' || e.touches.length !== 1 || overlayOpen() || ignored(e.target)) return;
      state.anim = '';
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dx = 0; dy = 0;
      t0 = Date.now();
      tracking = true;
      horizontal = false;
    }, { passive: true });

    el.viewTt.addEventListener('touchmove', function (e) {
      if (!tracking || e.touches.length !== 1) return;
      dx = e.touches[0].clientX - x0;
      dy = e.touches[0].clientY - y0;
      if (!horizontal) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy)) { tracking = false; return; }
        horizontal = true;
      }
      state.dragging = true;
      state.drag = clamp(dx * 0.22, -46, 46);
      renderGrid();
    }, { passive: true });

    function endTouch(e) {
      var wasTracking = tracking;
      tracking = false;
      state.dragging = false;
      state.drag = 0;
      if (!wasTracking || state.mode !== 'week') return;
      if (e.changedTouches && e.changedTouches[0]) {
        dx = e.changedTouches[0].clientX - x0;
        dy = e.changedTouches[0].clientY - y0;
      }
      if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.2 && Date.now() - t0 < 1200) {
        stepWeek(dx > 0 ? -1 : 1);
      }
    }
    el.viewTt.addEventListener('touchend', endTouch);
    el.viewTt.addEventListener('touchcancel', endTouch);

    el.viewTt.addEventListener('wheel', function (e) {
      if (state.mode !== 'week' || overlayOpen() || (e.target.closest && e.target.closest('.week-marks'))) return;
      var mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      var raw = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * mult;
      if (!raw) return;
      var now = Date.now();
      if (now - lastFire > 400) wheelAcc = 0;
      var dir = raw > 0 ? 1 : -1;
      if (dir !== lastDir) { wheelAcc = 0; lastDir = dir; }
      if ((dir > 0 && state.week >= MAX_WEEK) || (dir < 0 && state.week <= 1)) { wheelAcc = 0; return; }
      e.preventDefault();
      wheelAcc += raw;
      if (Math.abs(wheelAcc) >= 48 && now - lastFire >= 400) {
        lastFire = now;
        wheelAcc = 0;
        stepWeek(dir);
      }
    }, { passive: false });
  })();

  /* ------------------------------------------------------------------ *
   * 增强（无障碍 / 动态标题 / hash 同步 / 输入法安全）
   * ------------------------------------------------------------------ */
  function applyEnhancements() {
    if (!ENHANCED) return;
    // 动态标题
    var t = gridTitleSub();
    document.title = '课表 · ' + (t.title || '') + (t.title ? ' · ' : '') + '第' + state.week + '周';
    // 卡片可键盘聚焦
    var cells = el.ttTable.querySelectorAll('.slot-cell');
    for (var i = 0; i < cells.length; i++) {
      cells[i].setAttribute('role', 'button');
      cells[i].setAttribute('tabindex', '0');
      cells[i].setAttribute('aria-label', cells[i].querySelector('.c-name').textContent);
    }
  }

  // 输入法安全（组合输入期间不触发搜索）
  if (ENHANCED) {
    document.addEventListener('compositionstart', function (e) {
      if (e.target) e.target.__ttComposing = true;
    }, true);
    document.addEventListener('compositionend', function (e) {
      if (e.target) {
        e.target.__ttComposing = false;
        if (e.target.id === 'searchBox') setSearchQuery(e.target.value);
        else if (e.target.id === 'pickSearch') { state.picker.query = e.target.value; render(); }
      }
    }, true);
    // 前进/后退同步
    window.addEventListener('hashchange', function () {
      if (writingHash) return;
      applyHashState();
    });
    // 键盘激活卡片
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('slot-cell')) {
        e.preventDefault();
        openCardModal(Number(e.target.getAttribute('data-day')), Number(e.target.getAttribute('data-period')), Number(e.target.getAttribute('data-idx')));
      }
    });
  }

  function applyHashState() {
    var hash = location.hash.slice(1);
    var p = new URLSearchParams(hash);
    var weekNum = Number(p.get('week'));
    if (HAS_PEOPLE && p.get('person')) {
      var person = Q.people.find(function (x) {
        return x.name === p.get('person') && (!p.get('code') || x.code === p.get('code'));
      });
      if (person) {
        state.student = { name: person.name, code: person.code, klass: person.klass };
        state.entity = 'class';
        state.klass = person.klass;
        state.view = 'tt';
      }
    } else if (p.get('teacher') && TEACHERS.some(function (x) { return x[0] === p.get('teacher'); })) {
      state.entity = 'teacher'; state.teacher = p.get('teacher'); state.student = null; state.view = 'tt';
    } else if (p.get('room') && ROOMS.some(function (x) { return x[0] === p.get('room'); })) {
      state.entity = 'room'; state.room = p.get('room'); state.student = null; state.view = 'tt';
    } else if (p.get('class')) {
      var klass = Q.classes.find(function (x) { return x.name === p.get('class'); });
      if (klass) { state.entity = 'class'; state.klass = klass.name; state.view = 'tt'; }
    } else if (hash === 'dir' && state.klass) {
      state.view = 'dir'; state.dir = { mode: 'roster', klass: state.klass };
    }
    if (weekNum >= 1 && weekNum <= MAX_WEEK) state.week = weekNum;
    render();
  }

  /* ------------------------------------------------------------------ *
   * 挂载
   * ------------------------------------------------------------------ */
  boot();
  render();
})();
