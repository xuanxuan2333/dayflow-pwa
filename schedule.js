/* DayFlow · 日程表 v2（左时间轴 + 右活动池）
   纯前端原型：数据只读，日程写 localStorage。正式实现写 schedule_items。 */
(() => {
  'use strict';

  const DATA = window.DAYFLOW_SNAPSHOT;
  if (!DATA) {
    document.body.innerHTML = '<div style="padding:40px;font:14px -apple-system,sans-serif">缺少 prototype-data.js。<br>请先运行 <code>node modules/web/design/build-data.mjs</code>。</div>';
    return;
  }

  // ---------------------------------------------------------------------
  // 基础
  // ---------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const pad2 = (n) => String(n).padStart(2, '0');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const FULL_DAY = { id: 'full', label: '全天', start: 0, end: 24 * 60 };
  const PERIODS = [
    { id: 'night', label: '凌晨', start: 0, end: 6 * 60 },
    { id: 'morning', label: '上午', start: 6 * 60, end: 12 * 60 },
    { id: 'afternoon', label: '下午', start: 12 * 60, end: 18 * 60 },
    { id: 'evening', label: '晚上', start: 18 * 60, end: 24 * 60 },
  ];
  const SOURCE_META = {
    cumen: { label: '粗门', color: '#0A7CFF' },
    wechat: { label: '微信', color: '#07C160' },
    meituan: { label: '美团', color: '#FFB000' },
    dianping: { label: '大众点评', color: '#FF6633' },
    douban: { label: '豆瓣', color: '#2E963D' },
    xiaohongshu: { label: '小红书', color: '#FF2442' },
    xhs: { label: '小红书', color: '#FF2442' },
    manual: { label: '手动', color: '#8A8F98' },
    bearstory: { label: '春天的熊', color: '#D97706' },
  };
  function sourceMeta(id) {
    const key = String(id || 'cumen');
    return SOURCE_META[key] || { label: key === 'cumen' ? '粗门' : key, color: '#8A8F98' };
  }
  function sourceLabel(id) { return sourceMeta(id).label; }
  const DAY_START = 0;
  const DAY_END = 24 * 60;
  const HOUR_PX = 48;
  const TIMELINE_H = ((DAY_END - DAY_START) / 60) * HOUR_PX; // 1008
  const PX_PER_MIN = HOUR_PX / 60;
  const MANUAL_COLORS = ['#007aff', '#af52de', '#34c759', '#ff9500', '#8e8e93'];

  const AREA = new Map(DATA.areas.map((a) => [a.id, a]));
  const ACT = new Map(DATA.activities.map((a) => [a.id, a]));
  const today = ymd(new Date());

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(value) { return esc(value).replace(/`/g, '&#96;'); }
  function trimText(value, n) {
    const s = String(value || '');
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }
  function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseDate(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d);
  }
  function monthOf(s) { return String(s).slice(0, 7); }
  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function weekdayCN(s) { return WEEKDAYS[parseDate(s).getDay()]; }
  function fmtDateCN(s) { const d = parseDate(s); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; }
  function fmtDateShort(s) { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function toMin(hhmm) {
    const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  }
  function fmtMin(min) {
    if (min >= 1440) return '24:00';
    return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  }
  function toTimeInput(min) {
    const m = clamp(Math.round(min), 0, 1439);
    return fmtMin(m);
  }
  function timeOf(dt) { return String(dt).slice(11, 16); }
  function dayMin(dt) { return toMin(timeOf(dt)); }
  function dayDiff(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
  }
  function priceValue(a) { return a && a.price != null ? Number(a.price) : 0; }
  function priceText(a) {
    const p = priceValue(a);
    if (!a || a.price == null) return '—';
    return p === 0 ? '免费' : `¥${p % 1 === 0 ? p : p.toFixed(1)}`;
  }
  function durationText(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60); const m = Math.round(min % 60);
    if (h && m) return `${h} 小时 ${m} 分`;
    if (h) return `${h} 小时`;
    return `${m} 分钟`;
  }
  function durationShort(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60); const m = Math.round(min % 60);
    if (h && m) return `${h}h${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }
  function hoursText(min) {
    const h = min / 60;
    if (h === 0) return '0 小时';
    return Number.isInteger(h) ? `${h} 小时` : `${h.toFixed(1)} 小时`;
  }
  function stateBadge(a) {
    if (!a.state || a.state === '可报名') return '';
    const cls = a.state === '已满' ? 'fullbooked' : a.state === '已截止' ? 'closed' : 'ended';
    return `<span class="badge ${cls}">${esc(a.state)}</span>`;
  }
  function activityTimeLabel(a) {
    if (a.isFullDay) return '全天';
    return `${a.start.slice(11, 16)}–${a.end.slice(11, 16)}`;
  }
  function rangeTextOf(item) {
    const a = item.activityId ? ACT.get(item.activityId) : null;
    if (a?.isFullDay) return '全天';
    return `${timeOf(item.start)}–${timeOf(item.end)}`;
  }
  function activityDuration(a) {
    if (a.durationMin != null) return a.durationMin;
    return Math.max(0, (dayDiff(a.end.slice(0, 10), a.start.slice(0, 10)) * 1440) + dayMin(a.end) - dayMin(a.start));
  }

  // 距离 / 颜色
  const RAD = Math.PI / 180;
  function haversine(a, b) {
    if (!a || !b) return null;
    const dLat = (b.lat - a.lat) * RAD;
    const dLng = (b.lng - a.lng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  function distanceKm(a) {
    if (!a || a.lat == null || a.lng == null) return null;
    return haversine(state.home, { lat: a.lat, lng: a.lng });
  }
  function kmBetween(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    return haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  }
  function travelMinutes(km) { return Math.max(5, Math.round((km * 1.35 / 18) * 60 + 8)); }
  function mixWhite(hex, t) {
    const h = String(hex || '#8e8e93').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
    const k = clamp(t, 0, 1);
    return `rgb(${Math.round(r + (255 - r) * k)}, ${Math.round(g + (255 - g) * k)}, ${Math.round(b + (255 - b) * k)})`;
  }

  // ---------------------------------------------------------------------
  // 存储
  // ---------------------------------------------------------------------
  const STORE_KEY = 'dayflow.schedule.v2';
  const store = {
    get(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };
  let uidSeq = 0;
  function uid(prefix = 's') {
    uidSeq++;
    return `${prefix}_${Date.now().toString(36)}_${uidSeq.toString(36)}`;
  }

  function normalizeSchedule(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      if (!item || !DT_RE.test(String(item.start || '')) || !DT_RE.test(String(item.end || ''))) continue;
      const start = String(item.start).slice(0, 16);
      const end = String(item.end).slice(0, 16);
      if (end <= start) continue;
      const planDate = start.slice(0, 10);
      const kind = item.kind === 'manual' ? 'manual' : 'activity';
      const activityId = kind === 'activity' ? String(item.activityId || '') : null;
      if (kind === 'activity' && !activityId) continue;
      if (activityId) {
        const key = `${planDate}:${activityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const a = activityId ? ACT.get(activityId) : null;
      out.push({
        id: String(item.id || uid('s')),
        planDate,
        start,
        end,
        kind,
        activityId,
        title: String(item.title || a?.title || '未命名安排'),
        venue: String(item.venue || a?.venue || ''),
        address: String(item.address || a?.address || ''),
        note: String(item.note || ''),
        color: item.color || null,
        state: ['going', 'done', 'skipped'].includes(item.state) ? item.state : 'going',
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      });
    }
    return out;
  }

  const savedHomeName = store.get('dayflow.home.v1', DATA.home.name);
  const savedHome = DATA.homes.find((h) => h.name === savedHomeName) || DATA.homes[0];
  const defaultDate = (() => {
    const has = DATA.activities.some((a) => a.start.slice(0, 10) === today);
    return has ? today : (DATA.activities[0]?.start.slice(0, 10) || today);
  })();

  const state = {
    mode: 'calendar',
    sideView: 'pool',
    date: defaultDate,
    month: monthOf(defaultDate),
    monthCursor: monthOf(defaultDate),
    home: { name: savedHome.name, lat: savedHome.lat, lng: savedHome.lng },
    schedule: normalizeSchedule(store.get(STORE_KEY, [])),
    blacklist: (() => {
      const raw = store.get('dayflow.blacklist.v1', null);
      if (Array.isArray(raw)) return raw.filter((e) => e && typeof e.label === 'string').map((e) => ({ label: e.label, active: Boolean(e.active) }));
      return [{ label: '德州扑克', active: false }];
    })(),
    pool: {
      search: '',
      period: 'all',
      category: 'all',
      subcategory: 'all',
      area: 'all',
      source: 'all',
      sort: 'time',
      gapOnly: false,
      hideScheduled: false,
      bookableOnly: true,
      formationUnlikely: true,
      winStart: 0,
      winEnd: 24 * 60,
      fitsTime: false,
    },
    mobilePane: 'schedule',
    cal: {
      winStart: 8 * 60,
      winEnd: 22 * 60,
      startAfter: null,
      sort: 'distance',
      group: true,
      source: 'all',
      subcategory: 'all',
      category: 'all',
      bookableOnly: true,
      formationUnlikely: true,
      collapsedGroups: new Set(['fullday']),
    },
    db: { table: 'activities', page: 0, query: '', source: 'all', sub: 'all' },
    detailId: null,
    revealItemId: null,
    manualColor: MANUAL_COLORS[0],
    pendingConfirm: null,
  };

  // ---------------------------------------------------------------------
  // 黑名单（localStorage，新加默认不启用）
  // ---------------------------------------------------------------------
  const BLACKLIST_KEY = 'dayflow.blacklist.v1';
  function blacklistMatchLabel(a, label) {
    const needle = String(label || '').trim().toLowerCase();
    if (!needle) return false;
    const keys = [a.subcategory, a.category, a.title, a.venue]
      .filter(Boolean).map((v) => String(v).toLowerCase());
    if (keys.some((k) => k === needle)) return true;
    if (keys.some((k) => k.includes(needle))) return true;
    return false;
  }
  function isBlacklisted(a) {
    return state.blacklist.some((e) => e.active && e.label.trim() && blacklistMatchLabel(a, e.label));
  }
  function isFormationLow(a) {
    return a.formation === '可能不成团';
  }
  function formationAllowed(a, f) {
    return !isFormationLow(a) || Boolean(f.formationUnlikely);
  }
  function saveBlacklist() {
    store.set(BLACKLIST_KEY, state.blacklist);
    renderBlacklistBadges();
  }
  function renderBlacklistBadges() {
    const n = state.blacklist.filter((e) => e.active && e.label.trim()).length;
    $$('.blacklist-badge').forEach((el) => { el.textContent = String(n); });
  }
  function blacklistHitCount(label) {
    return actsOn(state.date).filter((a) => blacklistMatchLabel(a, label)).length;
  }

  // 预处理每天的活动量，用于周条/月历圆点
  const DAY_INFO = new Map();
  for (const a of DATA.activities) {
    const date = a.start.slice(0, 10);
    let info = DAY_INFO.get(date);
    if (!info) { info = { count: 0, fullDay: 0, areas: new Map() }; DAY_INFO.set(date, info); }
    info.count++;
    if (a.isFullDay) info.fullDay++;
    info.areas.set(a.areaId, (info.areas.get(a.areaId) || 0) + 1);
  }

  // ---------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------
  const dom = {
    headerDate: $('#headerDate'),
    modeTabs: $('#modeTabs'),
    sideTabs: $('#sideTabs'),
    poolPane: $('#poolPane'),
    mapPane: $('#mapPane'),
    scheduleMap: $('#scheduleMap'),
    scheduleMapCount: $('#scheduleMapCount'),
    scheduleMapSub: $('#scheduleMapSub'),
    scheduleMapNote: $('#scheduleMapNote'),
    timeWindowOverlay: $('#timeWindowOverlay'),
    timeHandleStart: $('#timeHandleStart'),
    timeHandleEnd: $('#timeHandleEnd'),
    timeHandleStartLabel: $('#timeHandleStartLabel'),
    timeHandleEndLabel: $('#timeHandleEndLabel'),
    timeWindowLabel: $('#timeWindowLabel'),
    timeWindowReset: $('#timeWindowReset'),
    timeFits: $('#timeFits'),
    calMap: $('#calMap'),
    calMapCount: $('#calMapCount'),
    calMapNote: $('#calMapNote'),
    calendarView: $('#calendarView'),
    homeChipText: $('#homeChipText'),
    weekbar: $('#weekbar'),
    workspace: $('#workspace'),
    scheduleDate: $('#scheduleDate'),
    scheduleStats: $('#scheduleStats'),
    conflictBanner: $('#conflictBanner'),
    timelineScroll: $('#timelineScroll'),
    timeGutter: $('#timeGutter'),
    timelineBody: $('#timelineBody'),
    hourLines: $('#hourLines'),
    gapBands: $('#gapBands'),
    blockLayer: $('#blockLayer'),
    scheduleFoot: $('#scheduleFoot'),
    nowLine: $('#nowLine'),
    nowLabel: $('#nowLabel'),
    poolCount: $('#poolCount'),
    poolSub: $('#poolSub'),
    poolSearch: $('#poolSearch'),
    periodTabs: $('#periodTabs'),
    poolCategory: $('#poolCategory'),
    poolSubcategory: $('#poolSubcategory'),
    poolArea: $('#poolArea'),
    poolSource: $('#poolSource'),
    poolSort: $('#poolSort'),
    gapOnly: $('#gapOnly'),
    hideScheduled: $('#hideScheduled'),
    bookableOnly: $('#bookableOnly'),
    formationUnlikely: $('#formationUnlikely'),
    poolList: $('#poolList'),
    mobileScheduleCount: $('#mobileScheduleCount'),
    mobilePoolCount: $('#mobilePoolCount'),
    mobileSwitch: $('#mobileSwitch'),
    scrim: $('#scrim'),
    detailDrawer: $('#detailDrawer'),
    detailTitle: $('#detailTitle'),
    detailBody: $('#detailBody'),
    detailFoot: $('#detailFoot'),
    modalRoot: $('#modalRoot'),
    toast: $('#toast'),
    calMonthTitle: $('#calMonthTitle'),
    calGrid: $('#calGrid'),
    calMonthFoot: $('#calMonthFoot'),
    calCategory: $('#calCategory'),
    calSubcategory: $('#calSubcategory'),
    calSourceChips: $('#calSourceChips'),
    calBookable: $('#calBookable'),
    calFormationUnlikely: $('#calFormationUnlikely'),
    calDayTitle: $('#calDayTitle'),
    calDaySub: $('#calDaySub'),
    calPresets: $('#calPresets'),
    calHist: $('#calHist'),
    calHistBars: $('#calHistBars'),
    calBrush: $('#calBrush'),
    calBrushSelection: $('#calBrushSelection'),
    calBrushStartHandle: $('#calBrushStartHandle'),
    calBrushEndHandle: $('#calBrushEndHandle'),
    calHistReadout: $('#calHistReadout'),
    calResultSummary: $('#calResultSummary'),
    calSort: $('#calSort'),
    calGroupBtn: $('#calGroupBtn'),
    calGroups: $('#calGroups'),
    calSchedCount: $('#calSchedCount'),
    calSchedList: $('#calSchedList'),
    calLegend: $('#calLegend'),
  };

  // ---------------------------------------------------------------------
  // 日程查询 / 几何
  // ---------------------------------------------------------------------
  function actsOn(date) { return DATA.activities.filter((a) => a.start.slice(0, 10) === date); }
  function scheduleFor(date) {
    return state.schedule
      .filter((s) => s.planDate === date)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }
  function displayItemsFor(date) {
    const dayStart = `${date}T00:00`;
    const nextStart = `${addDays(date, 1)}T00:00`;
    return state.schedule
      .filter((s) => s.start < nextStart && s.end > dayStart)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }
  function findScheduled(activityId, date) {
    return state.schedule.find((s) => s.planDate === date && s.activityId === activityId) || null;
  }
  function itemForId(id) { return state.schedule.find((s) => s.id === id) || null; }

  function itemRange(item) {
    const sDate = item.start.slice(0, 10);
    const eDate = item.end.slice(0, 10);
    const start = dayDiff(sDate, state.date) * 1440 + dayMin(item.start);
    const end = dayDiff(eDate, state.date) * 1440 + dayMin(item.end);
    return {
      start, end,
      clippedStart: Math.max(DAY_START, start),
      clippedEnd: Math.min(DAY_END, end),
      crossDay: eDate !== sDate,
      clipped: start < DAY_START || end > DAY_END,
    };
  }
  function activityRange(a) {
    const sDate = a.start.slice(0, 10);
    const eDate = a.end.slice(0, 10);
    const start = dayDiff(sDate, state.date) * 1440 + dayMin(a.start);
    const end = dayDiff(eDate, state.date) * 1440 + dayMin(a.end);
    return { start: Math.max(DAY_START, start), end: Math.min(DAY_END, end) };
  }
  function mergeRanges(ranges) {
    const sorted = ranges.filter((r) => r.end > r.start).sort((x, y) => x.start - y.start || x.end - y.end);
    const out = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (!last || r.start > last.end) {
        out.push({ ...r });
      } else {
        last.end = Math.max(last.end, r.end);
        last.clippedStart = Math.min(last.clippedStart, r.clippedStart);
        last.clippedEnd = Math.max(last.clippedEnd, r.clippedEnd);
      }
    }
    return out;
  }
  function freeGapsFor(date, minMinutes = 15) {
    const occupied = mergeRanges(displayItemsFor(date).map(itemRange));
    const gaps = [];
    let cursor = DAY_START;
    for (const r of occupied) {
      if (r.clippedStart > cursor) gaps.push({ start: cursor, end: Math.min(r.clippedStart, DAY_END) });
      cursor = Math.max(cursor, r.clippedEnd);
    }
    if (cursor < DAY_END) gaps.push({ start: cursor, end: DAY_END });
    return gaps.filter((g) => g.end - g.start >= minMinutes);
  }
  function occupiedMinutes(date) {
    return mergeRanges(displayItemsFor(date).map(itemRange))
      .reduce((sum, r) => sum + Math.max(0, r.clippedEnd - r.clippedStart), 0);
  }
  function conflictPairsFor(date) {
    const entries = displayItemsFor(date)
      .map((item) => ({ item, range: itemRange(item) }))
      .filter((x) => x.range.clippedEnd > x.range.clippedStart);
    const pairs = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const A = entries[i]; const B = entries[j];
        if (A.range.clippedStart < B.range.clippedEnd && B.range.clippedStart < A.range.clippedEnd) {
          pairs.push({
            a: A.item, b: B.item,
            start: Math.max(A.range.clippedStart, B.range.clippedStart),
            end: Math.min(A.range.clippedEnd, B.range.clippedEnd),
          });
        }
      }
    }
    return pairs;
  }
  function conflictIdSet(date) {
    const set = new Set();
    for (const p of conflictPairsFor(date)) { set.add(p.a.id); set.add(p.b.id); }
    return set;
  }
  function conflictsForActivity(a) {
    const r = activityRange(a);
    if (r.end <= r.start) return [];
    return displayItemsFor(state.date).filter((item) => {
      const ir = itemRange(item);
      return ir.clippedEnd > ir.clippedStart && r.start < ir.clippedEnd && ir.clippedStart < r.end;
    });
  }
  function wouldConflict(a) {
    return conflictsForActivity(a).length > 0;
  }
  function fitsAnyGap(a, gaps = freeGapsFor(state.date, 15)) {
    const r = activityRange(a);
    if (r.end <= r.start) return false;
    return gaps.some((g) => r.start >= g.start && r.end <= g.end);
  }

  // ---------------------------------------------------------------------
  // 日程操作
  // ---------------------------------------------------------------------
  function saveSchedule() {
    store.set(STORE_KEY, state.schedule);
  }

  function addActivityItem(a) {
    if (!a) return null;
    const date = a.start.slice(0, 10);
    const existing = findScheduled(a.id, date);
    if (existing) return existing;
    if (state.date !== date) {
      state.date = date;
      state.month = monthOf(date);
    }
    const now = new Date().toISOString();
    const item = {
      id: uid('s'),
      planDate: date,
      start: a.start,
      end: a.end,
      kind: 'activity',
      activityId: a.id,
      title: a.title,
      venue: a.venue || '',
      address: a.address || '',
      note: '',
      color: null,
      state: 'going',
      createdAt: now,
      updatedAt: now,
    };
    state.schedule.push(item);
    saveSchedule();
    state.revealItemId = item.id;
    return item;
  }

  function removeScheduleItem(id) {
    const item = itemForId(id);
    if (!item) return null;
    state.schedule = state.schedule.filter((s) => s.id !== id);
    saveSchedule();
    return item;
  }

  function toggleActivity(a) {
    if (!a) return;
    const date = a.start.slice(0, 10);
    const existing = findScheduled(a.id, date);
    if (existing) {
      removeScheduleItem(existing.id);
      renderAll();
      toast('已移出时间表');
      if (state.detailId === a.id) renderDetail();
      return;
    }
    const conflict = wouldConflict(a);
    const item = addActivityItem(a);
    renderAll({ revealId: item?.id });
    if (state.detailId === a.id) renderDetail();
    toast(conflict
      ? `已加入 ${rangeTextOf(item)} · 与现有安排重叠`
      : `已加入 ${rangeTextOf(item)}`);
  }

  // ---------------------------------------------------------------------
  // 渲染：顶栏 / 周条
  // ---------------------------------------------------------------------
  function renderHeader() {
    const d = parseDate(state.date);
    const itemsForDay = displayItemsFor(state.date);
    dom.headerDate.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${weekdayCN(state.date)}`;
    dom.homeChipText.textContent = state.home.name;
    dom.scheduleDate.innerHTML = `${d.getMonth() + 1} 月 ${d.getDate()} 日 <span>${weekdayCN(state.date)}</span>${state.date === today ? '<span class="today-tag">今天</span>' : ''}`;

    const items = itemsForDay;
    const conflicts = conflictPairsFor(state.date);
    const occupied = occupiedMinutes(state.date);
    const free = (DAY_END - DAY_START) - occupied;
    if (!items.length) {
      dom.scheduleStats.innerHTML = '还没安排 · 从右侧挑活动，或点时间轴空白处添加';
    } else {
      dom.scheduleStats.innerHTML = `已排 <b>${items.length}</b> 项 · 占用 <b>${hoursText(occupied)}</b> · 空档 <span class="free">${hoursText(free)}</span>${
        conflicts.length ? ` · <span class="conflict">${conflicts.length} 处冲突</span>` : ''
      }`;
    }

    if (conflicts.length) {
      const pairs = conflicts.slice(0, 4).map((p) => {
        const ta = rangeTextOf(p.a);
        const tb = rangeTextOf(p.b);
        const overlap = `${fmtMin(p.start)}–${fmtMin(p.end)}`;
        return `<span>${esc(ta)}「${esc(trimText(p.a.title, 14))}」× ${esc(tb)}「${esc(trimText(p.b.title, 14))}」 · 重叠 ${overlap}</span>`;
      }).join('');
      dom.conflictBanner.hidden = false;
      dom.conflictBanner.innerHTML = `<svg><use href="#i-info"/></svg><div><b>${conflicts.length} 处时间重叠</b>：<span class="pairs">${pairs}${conflicts.length > 4 ? '<span>…</span>' : ''}</span></div>`;
    } else {
      dom.conflictBanner.hidden = true;
      dom.conflictBanner.innerHTML = '';
    }
  }

  function renderWeekbar() {
    const start = addDays(state.date, -parseDate(state.date).getDay());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const info = DAY_INFO.get(date);
      const d = parseDate(date);
      const dots = info
        ? [...info.areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
          .map(([id]) => `<i style="background:${(AREA.get(id)?.color || '#8e8e93')}"></i>`).join('')
        : '';
      days.push(`<button class="week-day ${date === state.date ? 'selected' : ''} ${date === today ? 'today' : ''}"
        data-action="pick-date" data-date="${date}">
        <span class="wd">${WEEKDAYS[d.getDay()].replace('周', '')}</span>
        <span class="num">${d.getDate()}</span>
        <span class="dots">${dots}</span>
      </button>`);
    }
    dom.weekbar.innerHTML = days.join('');
  }

  // ---------------------------------------------------------------------
  // 渲染：时间轴
  // ---------------------------------------------------------------------
  function renderTimeline() {
    const items = displayItemsFor(state.date);
    const conflicts = conflictIdSet(state.date);

    let gutter = '';
    for (let h = 0; h <= 24; h++) {
      const top = h * HOUR_PX;
      gutter += `<span class="gutter-label" style="top:${h === 24 ? TIMELINE_H - 1 : top}px">${pad2(h)}:00</span>`;
    }
    dom.timeGutter.innerHTML = gutter;

    let lines = '';
    for (let h = 0; h < 24; h++) {
      const top = h * HOUR_PX;
      lines += `<span class="hour-line" style="top:${top}px"></span>`;
      lines += `<span class="hour-line half" style="top:${top + HOUR_PX / 2}px"></span>`;
    }
    dom.hourLines.innerHTML = lines;

    // 空档
    let gaps = '';
    for (const gap of freeGapsFor(state.date, 30)) {
      const top = (gap.start - DAY_START) * PX_PER_MIN;
      const height = (gap.end - gap.start) * PX_PER_MIN;
      const big = height >= 120;
      gaps += `<button class="gap-band ${big ? 'big' : ''}" style="top:${top}px;height:${height}px"
        data-action="gap-add" data-start="${gap.start}" data-end="${gap.end}" title="点这里添加自己的安排">
        <span class="gap-label">空档 ${hoursText(gap.end - gap.start)}</span>
        ${big ? '<span class="gap-sub">点这里加自己的安排，或从右侧挑活动</span>' : ''}
        ${big ? '<span class="gap-plus"><svg><use href="#i-plus"/></svg></span>' : ''}
      </button>`;
    }
    dom.gapBands.innerHTML = gaps;

    // 日程块
    const displays = [];
    for (const item of items) {
      const range = itemRange(item);
      if (range.clippedEnd - range.clippedStart < 1) continue;
      const a = item.activityId ? ACT.get(item.activityId) : null;
      const isFullDay = Boolean(a?.isFullDay);
      const continuation = dayDiff(item.start.slice(0, 10), state.date) < 0;
      const color = item.kind === 'manual' ? (item.color || '#007aff') : (a ? (AREA.get(a.areaId)?.color || '#8a8f98') : '#8a8f98');
      displays.push({ item, range, a, isFullDay, continuation, color });
    }

    // 重叠分列
    const sorted = [...displays].sort((x, y) => x.range.clippedStart - y.range.clippedStart || y.range.clippedEnd - x.range.clippedEnd);
    const clusters = [];
    let cluster = [];
    let clusterEnd = -1;
    for (const d of sorted) {
      if (cluster.length && d.range.clippedStart >= clusterEnd) {
        clusters.push(cluster); cluster = []; clusterEnd = -1;
      }
      cluster.push(d);
      clusterEnd = Math.max(clusterEnd, d.range.clippedEnd);
    }
    if (cluster.length) clusters.push(cluster);
    for (const cl of clusters) {
      const laneEnds = [];
      for (const d of cl) {
        let lane = laneEnds.findIndex((end) => end <= d.range.clippedStart);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(d.range.clippedEnd); }
        else laneEnds[lane] = d.range.clippedEnd;
        d.lane = lane;
      }
      const lanes = Math.min(3, Math.max(1, laneEnds.length));
      for (const d of cl) {
        d.lanes = lanes;
        d.left = (Math.min(d.lane, lanes - 1) / lanes) * 100;
        d.width = 100 / lanes;
      }
    }

    let blocks = '';
    for (const d of displays) {
      const top = (d.range.clippedStart - DAY_START) * PX_PER_MIN;
      const height = Math.max(22, (d.range.clippedEnd - d.range.clippedStart) * PX_PER_MIN);
      const tiny = height < 30;
      const short = height < 54;
      const conflict = conflicts.has(d.item.id);
      const tint = mixWhite(d.color, d.item.kind === 'manual' ? 0.9 : 0.85);
      const full = d.isFullDay ? '<span class="kind">全天</span>' : '';
      const cross = d.continuation
        ? '<span class="kind">跨天续</span>'
        : d.range.crossDay ? '<span class="kind">跨天</span>' : '';
      let meta = d.item.kind === 'manual'
        ? [d.item.venue || d.item.note || '我的安排', '手动']
        : [AREA.get(d.a?.areaId)?.name || '', d.a?.venue || ''];
      const lowFormation = d.a ? isFormationLow(d.a) : false;
      if (lowFormation) meta = [...meta, '可能不成团'];
      let actualRange = `${timeOf(d.item.start)}–${timeOf(d.item.end)}`;
      if (d.range.crossDay) actualRange = `${timeOf(d.item.start)}–次日${timeOf(d.item.end)}`;
      if (d.isFullDay || d.range.crossDay) meta = [actualRange, ...meta];
      blocks += `
        <div class="block ${d.item.kind === 'manual' ? 'manual' : ''} ${tiny ? 'tiny' : short ? 'short' : ''} ${conflict ? 'conflict' : ''} ${lowFormation ? 'is-low-formation' : ''}"
             style="top:${top}px;height:${height}px;left:${d.left}%;width:${d.width}%;--c:${d.color};--tint:${tint}" data-id="${escAttr(d.item.id)}">
          <div class="block-inner" data-action="block-open" data-id="${escAttr(d.item.id)}">
            <div class="block-time">${esc(rangeTextOf(d.item))}${full}${cross}</div>
            <div class="block-title">${esc(d.item.title)}</div>
            <div class="block-meta">${esc(meta.filter(Boolean).join(' · '))}</div>
            <button class="block-remove" data-action="block-remove" data-id="${escAttr(d.item.id)}" aria-label="移出时间表">
              <svg><use href="#i-close"/></svg>
            </button>
          </div>
        </div>`;
    }
    dom.blockLayer.innerHTML = blocks;
    renderNowLine();
    renderFoot();
    updateTimeWindowUI();
  }

  function renderNowLine() {
    if (state.date !== today) { dom.nowLine.hidden = true; return; }
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    if (min < DAY_START || min >= DAY_END) { dom.nowLine.hidden = true; return; }
    dom.nowLine.hidden = false;
    dom.nowLine.style.top = `${(min - DAY_START) * PX_PER_MIN}px`;
    dom.nowLabel.textContent = `现在 ${fmtMin(min)}`;
  }

  function initialScrollTop() {
    const items = displayItemsFor(state.date);
    let target = 8 * 60;
    if (items.length) {
      target = Math.max(DAY_START, Math.min(...items.map((i) => itemRange(i).clippedStart)) - 60);
    }
    return Math.max(0, (target - DAY_START) * PX_PER_MIN);
  }

  // ---------------------------------------------------------------------
  // 一键顺路 / 导出
  // ---------------------------------------------------------------------
  function buildChain() {
    const gaps = freeGapsFor(state.date, 30);
    if (!gaps.length) { toast('今天已经没有空档了'); return; }
    const pool = actsOn(state.date)
      .filter((a) => a.state === '可报名' && !a.isFullDay && activityDuration(a) <= 360 && a.lat != null && a.lng != null && !findScheduled(a.id, state.date));
    if (!pool.length) { toast('今天没有适合连场的短活动'); return; }

    let best = [];
    let bestScore = -Infinity;
    for (const gap of gaps) {
      const candidates = pool.filter((a) => {
        const r = activityRange(a);
        return r.start >= gap.start && r.end <= gap.end && r.end > r.start;
      }).sort((a, b) => startMinOf(a) - startMinOf(b));
      if (!candidates.length) continue;
      const seeds = [...candidates].sort((a, b) => (distanceKm(a) ?? Infinity) - (distanceKm(b) ?? Infinity)).slice(0, 24);
      for (const seed of seeds) {
        const chain = [seed];
        let cur = seed;
        for (const cand of candidates) {
          if (chain.some((x) => x.id === cand.id)) continue;
          const gapMin = startMinOf(cand) - dayMin(cur.end);
          const legKm = kmBetween(cur, cand);
          if (gapMin < 0 || legKm == null || legKm > 8) continue;
          if (gapMin < Math.max(15, travelMinutes(legKm))) continue;
          chain.push(cand); cur = cand;
          if (chain.length >= 3) break;
        }
        let travelSum = 0;
        let sameArea = 0;
        for (let i = 1; i < chain.length; i++) {
          travelSum += travelMinutes(kmBetween(chain[i - 1], chain[i]));
          if (chain[i - 1].areaId === chain[i].areaId) sameArea++;
        }
        const score = chain.length * 1000 - travelSum * 12 + sameArea * 50;
        if (score > bestScore) { bestScore = score; best = chain; }
      }
    }

    if (!best.length) { toast('空档里没有合适的活动，试试放宽筛选'); return; }
    const created = [];
    for (const a of best) {
      const item = addActivityItem(a);
      if (item) created.push(item);
    }
    if (!created.length) { toast('这些活动已经在时间表里了'); return; }
    saveSchedule();
    renderAll({ revealId: created[0].id });
    let km = 0;
    for (let i = 1; i < best.length; i++) km += kmBetween(best[i - 1], best[i]) || 0;
    toast(created.length >= 2
      ? `已顺路排好 ${created.length} 个活动 · 换场约 ${km.toFixed(1)}km`
      : `空档里先放了一个：${best[0].title.slice(0, 18)}`);
  }

  function icsEscape(text) {
    return String(text == null ? '' : text)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  function icsDate(local) {
    return `${local.replace(/[-:]/g, '')}00`;
  }
  function icsStamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function buildIcs(items) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DayFlow//M5 Prototype//CN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:出门计划'];
    for (const item of items) {
      const a = item.activityId ? ACT.get(item.activityId) : null;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${item.kind === 'manual' ? item.id : (item.activityId || item.id)}@dayflow.local`);
      lines.push(`DTSTAMP:${icsStamp()}`);
      lines.push(`DTSTART:${icsDate(item.start)}`);
      lines.push(`DTEND:${icsDate(item.end)}`);
      lines.push(`SUMMARY:${icsEscape(item.title || '安排')}`);
      lines.push(`LOCATION:${icsEscape(`${item.venue || a?.venue || ''} ${item.address || a?.address || ''}`.trim())}`);
      const desc = [item.kind === 'manual' ? '我的安排' : (a?.summary || a?.description || ''), item.note || '',
        a ? `费用：${priceText(a)} · 状态：${a.state || ''}` : ''].filter(Boolean).join('\n');
      lines.push(`DESCRIPTION:${icsEscape(desc)}`);
      if (a?.link) lines.push(`URL:${a.link}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function exportCurrent() {
    const items = displayItemsFor(state.date);
    if (!items.length) { toast('时间表还是空的'); return; }
    const blob = new Blob([buildIcs(items)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dayflow-${state.date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${items.length} 个时间块到 .ics`);
  }

  function renderFoot() {
    if (!dom.scheduleFoot) return;
    const items = displayItemsFor(state.date);
    dom.scheduleFoot.innerHTML = `
      <span class="foot-note">本地保存 · 正式写 <code>schedule_items</code></span>
      <div class="foot-actions">
        <button class="btn ghost" data-action="chain">一键顺路</button>
        <button class="btn" data-action="export-ics" ${items.length ? '' : 'disabled'}>导出 .ics</button>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // 渲染：活动池
  // ---------------------------------------------------------------------
  function periodOf(a) {
    if (a.isFullDay) return 'full';
    const m = startMinOf(a);
    if (m < 6 * 60) return 'night';
    if (m < 12 * 60) return 'morning';
    if (m < 18 * 60) return 'afternoon';
    return 'evening';
  }
  function startMinOf(a) { return dayMin(a.start); }

  function renderPool() {
    const all = actsOn(state.date);
    const gaps = freeGapsFor(state.date, 15);

    // 分类 / 片区选项
    const categories = [...new Set(all.map((a) => a.category).filter(Boolean))]
      .sort((a, b) => {
        const order = ['运动', '娱乐', '社交', '文艺', '演出', '体验课', '其他'];
        return order.indexOf(a) - order.indexOf(b);
      });
    if (state.pool.category !== 'all' && !categories.includes(state.pool.category)) state.pool.category = 'all';
    dom.poolCategory.innerHTML = `<option value="all">全部分类</option>${categories.map((c) => `<option value="${escAttr(c)}">${esc(c)}</option>`).join('')}`;
    dom.poolCategory.value = state.pool.category;

    const areaCounts = new Map();
    for (const a of all) areaCounts.set(a.areaId, (areaCounts.get(a.areaId) || 0) + 1);
    const areas = [...areaCounts.entries()].sort((x, y) => y[1] - x[1]);
    if (state.pool.area !== 'all' && !areaCounts.has(state.pool.area)) state.pool.area = 'all';
    dom.poolArea.innerHTML = `<option value="all">全部片区</option>${areas.map(([id, n]) => {
      const area = AREA.get(id);
      return `<option value="${escAttr(id)}">${esc(area?.name || '其他')} (${n})</option>`;
    }).join('')}`;
    dom.poolArea.value = state.pool.area;

    const sourceCounts = new Map();
    for (const a of all) sourceCounts.set(a.source || 'cumen', (sourceCounts.get(a.source || 'cumen') || 0) + 1);
    const sources = [...sourceCounts.entries()].sort((x, y) => y[1] - x[1]);
    if (state.pool.source !== 'all' && !sourceCounts.has(state.pool.source)) state.pool.source = 'all';
    dom.poolSource.innerHTML = `<option value="all">全部来源</option>${sources.map(([id, n]) => `<option value="${escAttr(id)}">${esc(sourceLabel(id))} (${n})</option>`).join('')}`;
    dom.poolSource.value = state.pool.source;

    // 细分类只展示“当前分类 + 当前来源”下真实存在的项
    const subPool = all.filter((a) => (state.pool.category === 'all' || a.category === state.pool.category)
      && (state.pool.source === 'all' || (a.source || 'cumen') === state.pool.source));
    const subCounts = new Map();
    for (const a of subPool) if (a.subcategory) subCounts.set(a.subcategory, (subCounts.get(a.subcategory) || 0) + 1);
    if (state.pool.subcategory !== 'all' && !subCounts.has(state.pool.subcategory)) state.pool.subcategory = 'all';
    dom.poolSubcategory.innerHTML = `<option value="all">全部细分</option>${[...subCounts.entries()].sort((x, y) => y[1] - x[1]).map(([id, n]) => `<option value="${escAttr(id)}">${esc(id)} (${n})</option>`).join('')}`;
    dom.poolSubcategory.value = state.pool.subcategory;

    dom.poolSort.value = state.pool.sort;
    dom.gapOnly.checked = state.pool.gapOnly;
    dom.hideScheduled.checked = state.pool.hideScheduled;
    dom.bookableOnly.checked = state.pool.bookableOnly;
    if (dom.formationUnlikely) dom.formationUnlikely.checked = state.pool.formationUnlikely;
    if (dom.timeFits) dom.timeFits.checked = state.pool.fitsTime;
    if (dom.poolSearch.value !== state.pool.search) dom.poolSearch.value = state.pool.search;

    // 时段 counts：全天单独一类，不混进凌晨/上午/下午/晚上
    const counts = { all: all.length, full: 0, night: 0, morning: 0, afternoon: 0, evening: 0 };
    for (const a of all) counts[periodOf(a)]++;
    dom.periodTabs.innerHTML = [{ id: 'all', label: '全部', n: counts.all }, FULL_DAY, ...PERIODS]
      .map((p) => `<button class="period-tab ${state.pool.period === p.id ? 'active' : ''}" data-action="pool-period" data-period="${p.id}">${p.label}<span class="n">${counts[p.id] ?? 0}</span></button>`).join('');

    // 过滤
    const q = state.pool.search.trim().toLowerCase();
    const rangeActive = state.pool.winStart > 0 || state.pool.winEnd < 24 * 60;
    let list = all.filter((a) => {
      if (rangeActive) {
        const r = activityRange(a);
        if (!(r.start < state.pool.winEnd && r.end > state.pool.winStart)) return false;
        if (state.pool.fitsTime && !(r.start >= state.pool.winStart && r.end <= state.pool.winEnd)) return false;
      }
      if (state.pool.period !== 'all' && periodOf(a) !== state.pool.period) return false;
      if (isBlacklisted(a)) return false;
      if (!formationAllowed(a, state.pool)) return false;
      if (state.pool.category !== 'all' && a.category !== state.pool.category) return false;
      if (state.pool.subcategory !== 'all' && a.subcategory !== state.pool.subcategory) return false;
      if (state.pool.area !== 'all' && a.areaId !== state.pool.area) return false;
      if (state.pool.source !== 'all' && (a.source || 'cumen') !== state.pool.source) return false;
      if (state.pool.bookableOnly && a.state !== '可报名') return false;
      if (q && !`${a.title} ${a.venue || ''} ${a.address || ''}`.toLowerCase().includes(q)) return false;
      const scheduled = Boolean(findScheduled(a.id, state.date));
      if (state.pool.hideScheduled && scheduled) return false;
      if (state.pool.gapOnly && (scheduled || !fitsAnyGap(a, gaps))) return false;
      return true;
    });

    list = [...list].sort((x, y) => {
      if (state.pool.sort === 'distance') return (distanceKm(x) ?? Infinity) - (distanceKm(y) ?? Infinity) || startMinOf(x) - startMinOf(y);
      if (state.pool.sort === 'price') return priceValue(x) - priceValue(y) || startMinOf(x) - startMinOf(y);
      if (state.pool.sort === 'duration') return activityDuration(x) - activityDuration(y) || startMinOf(x) - startMinOf(y);
      return startMinOf(x) - startMinOf(y) || (distanceKm(x) ?? Infinity) - (distanceKm(y) ?? Infinity);
    });

    const scheduledCount = all.filter((a) => findScheduled(a.id, state.date)).length;
    const rangeText = rangeActive ? `时间窗 ${fmtMin(state.pool.winStart)}–${fmtMin(state.pool.winEnd)}` : '';
    dom.poolCount.textContent = `${list.length} / ${all.length}`;
    const hasOvernight = all.some((a) => a.end.slice(0, 10) !== a.start.slice(0, 10));
    dom.poolSub.textContent = (list.length === all.length
      ? `${all.length} 个活动 · 已排 ${scheduledCount} 个 · 点一下加入/取消`
      : `筛选出 ${list.length} 个 · 已排 ${scheduledCount} 个`)
      + (rangeText ? ` · ${rangeText}` : '')
      + (state.pool.winEnd === 24 * 60 && hasOvernight ? ' · 通宵活动按 24:00 截断计算' : '')
      + (scheduledCount ? ' · 灰色 = 与已排时间冲突（仍可点）' : '');
    updateTimeWindowUI();
    dom.mobilePoolCount.textContent = String(list.length);
    dom.mobileScheduleCount.textContent = String(displayItemsFor(state.date).length);

    if (!list.length) {
      dom.poolList.innerHTML = all.length
        ? `<div class="pool-empty">
            <span class="emoji">🔍</span>
            <h3>没有符合条件的活动</h3>
            <p>试试关掉「只看能放进空档 / 隐藏已排」，或者换个分类、片区。</p>
            <button class="btn" data-action="reset-pool">清空筛选</button>
          </div>`
        : `<div class="pool-empty">
            <span class="emoji">🗓️</span>
            <h3>这天还没有采集到的活动</h3>
            <p>你可以点「自己的安排」手动填一个时间块。</p>
            <button class="btn" data-action="manual-add">+ 手动添加</button>
          </div>`;
      return;
    }

    const groups = [FULL_DAY, ...PERIODS].map((p) => ({
      ...p,
      items: list.filter((a) => periodOf(a) === p.id),
    })).filter((g) => g.items.length);

    let html = '';
    for (const group of groups) {
      const isFull = group.id === 'full';
      const headClass = isFull ? 'pool-group-head full-day' : 'pool-group-head';
      const timeLabel = isFull
        ? '徒步 / 一日游'
        : `${pad2(group.start / 60)}:00–${group.end === 1440 ? '24:00' : `${pad2(group.end / 60)}:00`}`;
      html += `<div class="${headClass}"><span>${group.label}</span><span>${timeLabel}</span><span class="rule"></span><span class="n">${group.items.length}</span></div>`;
      for (const a of group.items) {
        const scheduled = Boolean(findScheduled(a.id, state.date));
        const conflict = !scheduled && wouldConflict(a);
        const area = AREA.get(a.areaId) || { name: '其他', color: '#8a8f98' };
        const km = distanceKm(a);
        const duration = activityDuration(a);
        const badges = [];
        const lowFormation = isFormationLow(a);
        const crossDay = a.end.slice(0, 10) !== a.start.slice(0, 10);
        if (lowFormation) badges.push('<span class="badge formation-low">可能不成团</span>');
        if (a.isFullDay) badges.push('<span class="badge full">全天</span>');
        if ((a.source || 'cumen') !== 'cumen') badges.push(`<span class="badge source" style="--sc:${sourceMeta(a.source).color}">${esc(sourceLabel(a.source))}</span>`);
        if (crossDay) badges.push('<span class="badge warn">跨天</span>');
        if (crossDay && a.end.slice(11, 16) < '06:00') badges.push('<span class="badge night">通宵</span>');
        if (scheduled) badges.push('<span class="badge" style="background:rgba(52,199,89,.14);color:#1a7f37">已排</span>');
        if (conflict) badges.push('<span class="badge conflict">会冲突</span>');
        if (a.state && a.state !== '可报名') badges.push(stateBadge(a));
        html += `
          <div class="pool-item ${scheduled ? 'scheduled' : ''} ${conflict ? 'conflicting' : ''} ${lowFormation ? 'is-low-formation' : ''}"
               data-action="toggle-activity" data-id="${escAttr(a.id)}" role="checkbox" aria-checked="${scheduled}" tabindex="0"
               title="${escAttr(a.title)} · ${escAttr(a.venue || '')}">
            <span class="p-check"><svg><use href="#i-check"/></svg></span>
            <span class="p-rail" style="--area:${area.color};background:${area.color}"></span>
            <span class="p-body">
              <span class="p-row1">
                <span class="p-time">${a.isFullDay ? '全天' : `${a.start.slice(11, 16)}–${a.end.slice(11, 16)}`}</span>
                <span class="p-title">${esc(a.title)}</span>
                <span class="p-price ${priceValue(a) === 0 ? 'free' : ''}">${esc(priceText(a))}</span>
              </span>
              <span class="p-row2">
                <span class="area-dot" style="--area:${area.color};background:${area.color}"></span>
                <span>${esc(area.name)}</span>
                <span class="sep">·</span>
                <span>${km == null ? '距离未知' : `${km.toFixed(1)}km`}</span>
                <span class="sep">·</span>
                <span>${durationShort(duration)}</span>
                ${badges.join('')}
              </span>
            </span>
            <button class="p-info" data-action="open-detail" data-id="${escAttr(a.id)}" aria-label="看详情" title="看详情">
              <svg><use href="#i-info"/></svg>
            </button>
          </div>`;
      }
    }
    dom.poolList.innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // 地图（Leaflet + 高德瓦片；无 Key，GCJ-02 与采集坐标一致）
  // ---------------------------------------------------------------------
  const mapInstances = { schedule: null, calendar: null };
  const AMAP_TILE = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
  const AMAP_ATTRIBUTION = '&copy; 高德地图';

  function mapNoteEl(which) {
    if (which === 'schedule') return dom.scheduleMapNote;
    return dom.calMapNote;
  }

  function setMapNote(which, text) {
    const el = mapNoteEl(which);
    if (el) el.textContent = text;
  }

  function ensureMap(which, container) {
    if (!window.L) return null;
    if (mapInstances[which]) {
      const old = mapInstances[which];
      const oldContainer = old.getContainer?.();
      if (oldContainer === container && document.body.contains(oldContainer)) return old;
      try { old._dfRO?.disconnect(); } catch { /* ignore */ }
      try { old.remove(); } catch { /* ignore */ }
      delete mapInstances[which];
    }
    if (!container) return null;
    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([state.home.lat, state.home.lng], 11);
    const layer = L.tileLayer(AMAP_TILE, {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      minZoom: 8,
      attribution: AMAP_ATTRIBUTION,
    });
    layer.on('tileerror', () => {
      map._dfTileError = true;
      setMapNote(which, '底图加载失败（网络或瓦片）· 活动点仍可点');
    });
    layer.addTo(map);
    map._dfTileLayer = layer;
    map._dfMarkers = L.layerGroup().addTo(map);
    if (window.ResizeObserver) {
      map._dfRO = new ResizeObserver(() => {
        try { map.invalidateSize(); } catch { /* ignore */ }
      });
      map._dfRO.observe(container);
    }
    mapInstances[which] = map;
    return map;
  }

  function mapPopupHTML(a, scheduled) {
    const area = AREA.get(a.areaId) || { name: '其他', color: '#8a8f98' };
    const km = distanceKm(a);
    return `<div class="df-popup">
      <div class="df-popup-title">${esc(a.title)}</div>
      <div class="df-popup-meta">${esc(sourceLabel(a.source))} · ${esc(activityTimeLabel(a))} · ${esc(area.name)}${km == null ? '' : ` · ${km.toFixed(1)}km`}</div>
      <div class="df-popup-venue">${esc(a.venue || '场地待确认')}</div>
      <div class="df-popup-foot">
        <span class="df-popup-price ${priceValue(a) === 0 ? 'free' : ''}">${esc(priceText(a))}</span>
        <button class="df-popup-btn ${scheduled ? 'added' : ''}" data-action="map-toggle-activity" data-id="${escAttr(a.id)}">${scheduled ? '已排 · 移出' : '加入时间表'}</button>
      </div>
    </div>`;
  }

  function updateMap(which, container, items) {
    if (!container) return;
    if (!window.L) {
      renderFallbackMap(which, container, items);
      return;
    }
    const map = ensureMap(which, container);
    if (!map) { renderFallbackMap(which, container, items); return; }
    if (map._dfMarkers) map.removeLayer(map._dfMarkers);
    const markers = L.layerGroup().addTo(map);
    map._dfMarkers = markers;

    L.marker([state.home.lat, state.home.lng], {
      icon: L.divIcon({
        className: 'df-marker-wrap',
        html: '<div class="df-marker home-marker">家</div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      zIndexOffset: 1000,
    }).addTo(markers).bindTooltip(`家 · ${esc(state.home.name)}`, { direction: 'top', offset: [0, -10] });

    const points = [[state.home.lat, state.home.lng]];
    for (const item of items) {
      const a = item.a;
      if (a.lat == null || a.lng == null) continue;
      const color = AREA.get(a.areaId)?.color || '#8a8f98';
      const scheduled = state.schedule.some((s) => s.activityId === a.id);
      const lowFormation = isFormationLow(a);
      points.push([a.lat, a.lng]);
      L.marker([a.lat, a.lng], {
        icon: L.divIcon({
          className: 'df-marker-wrap',
          html: `<div class="df-marker ${scheduled ? 'scheduled' : ''} ${lowFormation ? 'is-low-formation' : ''}" style="--c:${color}"></div>`,
          iconSize: [15, 15],
          iconAnchor: [7.5, 7.5],
          popupAnchor: [0, -8],
        }),
        riseOnHover: true,
      }).addTo(markers)
        .bindTooltip(esc(a.title), { direction: 'top', offset: [0, -7], opacity: 0.9 })
        .bindPopup(mapPopupHTML(a, scheduled), { maxWidth: 260, minWidth: 200, autoPanPadding: [18, 18] })
        .on('dblclick', (ev) => {
          L.DomEvent.stop(ev.originalEvent || ev);
          closeExpandedCalendarMap();
          openDetail(a.id);
        });
    }

    if (map._dfFitTimer) clearTimeout(map._dfFitTimer);
    map._dfFitTimer = setTimeout(() => {
      if (items.length) {
        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [26, 26], maxZoom: 14 });
      } else {
        map.setView([state.home.lat, state.home.lng], 11);
      }
      map.invalidateSize();
    }, 30);
    map.invalidateSize();
    setMapNote(which, map._dfTileError
      ? '底图加载失败（网络或瓦片）· 活动点仍可点'
      : '底图：高德 · GCJ-02 · 单击看活动 · 双击看详情');
  }

  function renderFallbackMap(which, container, items) {
    const pts = items.map((x) => x.a).filter((a) => a.lat != null && a.lng != null);
    const all = [{ lat: state.home.lat, lng: state.home.lng, home: true }, ...pts];
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    let minLat = Math.min(...lats); let maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs); let maxLng = Math.max(...lngs);
    if (maxLat - minLat < 0.02) { minLat -= 0.01; maxLat += 0.01; }
    if (maxLng - minLng < 0.02) { minLng -= 0.01; maxLng += 0.01; }
    const W = 320; const H = 210; const pad = 20;
    const x = (lng) => pad + ((lng - minLng) / (maxLng - minLng)) * (W - pad * 2);
    const y = (lat) => pad + ((maxLat - lat) / (maxLat - minLat)) * (H - pad * 2);
    let svg = `<svg class="map-svg-fallback" viewBox="0 0 ${W} ${H}" aria-label="位置示意">`;
    svg += `<rect width="${W}" height="${H}" fill="#f7f7fa"/>`;
    for (let i = 1; i < 4; i++) {
      svg += `<line x1="${(W / 4) * i}" y1="0" x2="${(W / 4) * i}" y2="${H}" stroke="rgba(60,60,67,.05)"/>`;
      svg += `<line x1="0" y1="${(H / 4) * i}" x2="${W}" y2="${(H / 4) * i}" stroke="rgba(60,60,67,.05)"/>`;
    }
    for (const a of pts) {
      const color = AREA.get(a.areaId)?.color || '#8a8f98';
      const scheduled = Boolean(findScheduled(a.id, state.date));
      svg += `<circle cx="${x(a.lng).toFixed(1)}" cy="${y(a.lat).toFixed(1)}" r="${scheduled ? 6 : 4.5}" fill="${scheduled ? color : '#fff'}" stroke="${color}" stroke-width="2"><title>${esc(a.title)}</title></circle>`;
    }
    const hx = x(state.home.lng); const hy = y(state.home.lat);
    svg += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="6" fill="#fff" stroke="#ff3b30" stroke-width="2.5"/>`;
    svg += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="2" fill="#ff3b30"/>`;
    svg += `<text x="${hx.toFixed(1)}" y="${(hy - 9).toFixed(1)}" text-anchor="middle" fill="#ff3b30" font-weight="700">家</text>`;
    svg += '</svg>';
    container.innerHTML = svg + '<div class="map-fallback-note">地图组件未加载，显示位置示意（实心=已排）</div>';
    setMapNote(which, '距家直线距离；点位为示意，不是真实地图');
  }

  function mapActivitiesForSchedule() {
    const q = state.pool.search.trim().toLowerCase();
    const list = actsOn(state.date).filter((a) => {
      if (a.lat == null || a.lng == null) return false;
      if (state.pool.period !== 'all' && periodOf(a) !== state.pool.period) return false;
      if (isBlacklisted(a)) return false;
      if (!formationAllowed(a, state.pool)) return false;
      if (state.pool.category !== 'all' && a.category !== state.pool.category) return false;
      if (state.pool.subcategory !== 'all' && a.subcategory !== state.pool.subcategory) return false;
      if (state.pool.area !== 'all' && a.areaId !== state.pool.area) return false;
      if (state.pool.source !== 'all' && (a.source || 'cumen') !== state.pool.source) return false;
      if (state.pool.bookableOnly && a.state !== '可报名') return false;
      if (q && !`${a.title} ${a.venue || ''} ${a.address || ''}`.toLowerCase().includes(q)) return false;
      if (state.pool.winStart > 0 || state.pool.winEnd < 24 * 60) {
        const r = activityRange(a);
        if (!(r.start < state.pool.winEnd && r.end > state.pool.winStart)) return false;
        if (state.pool.fitsTime && !(r.start >= state.pool.winStart && r.end <= state.pool.winEnd)) return false;
      }
      return true;
    });
    const byId = new Map(list.map((a) => [a.id, a]));
    for (const item of displayItemsFor(state.date)) {
      if (item.activityId && ACT.has(item.activityId)) {
        const a = ACT.get(item.activityId);
        if (a.lat != null && a.lng != null) byId.set(item.activityId, a);
      }
    }
    return [...byId.values()].map((a) => ({ a }));
  }

  function mapActivitiesForCalendar() {
    // 地图点必须严格跟当前筛选/时间窗一致；已排但被筛掉的活动也不显示。
    return calListWithFits().list
      .map((x) => x.a)
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => ({ a }));
  }

  function renderScheduleMap() {
    if (!dom.scheduleMap || state.sideView !== 'map' || state.mode !== 'schedule') return;
    const items = mapActivitiesForSchedule();
    dom.scheduleMapCount.textContent = `${items.length} 个`;
    dom.scheduleMapSub.textContent = `彩色 = 片区 · 实心 = 已排 · 空心 = 未排`;
    updateMap('schedule', dom.scheduleMap, items);
  }

  function renderCalendarMap() {
    if (!dom.calMap) return;
    const items = mapActivitiesForCalendar();
    dom.calMapCount.textContent = String(items.length);
    updateMap('calendar', dom.calMap, items);
  }

  function closeExpandedCalendarMap() {
    if (!document.body.classList.contains('map-expanded')) return;
    document.body.classList.remove('map-expanded');
    const btn = document.querySelector('[data-action="cal-map-expand"]');
    if (btn) btn.innerHTML = '<svg><use href="#i-expand"/></svg>放大';
    requestAnimationFrame(() => {
      renderCalendarMap();
      mapInstances.calendar?.invalidateSize();
    });
  }

  function toggleCalendarMapExpand() {
    const expand = !document.body.classList.contains('map-expanded');
    document.body.classList.toggle('map-expanded', expand);
    const btn = document.querySelector('[data-action="cal-map-expand"]');
    if (btn) {
      btn.innerHTML = expand
        ? '<svg><use href="#i-expand"/></svg>收起'
        : '<svg><use href="#i-expand"/></svg>放大';
    }
    if (expand) {
      requestAnimationFrame(() => {
        renderCalendarMap();
        mapInstances.calendar?.invalidateSize();
        setTimeout(() => {
          renderCalendarMap();
          mapInstances.calendar?.invalidateSize();
        }, 180);
      });
    } else {
      requestAnimationFrame(() => {
        mapInstances.calendar?.invalidateSize();
      });
    }
  }

  function setSideView(view) {
    if (!['pool', 'map'].includes(view)) return;
    state.sideView = view;
    $$('.side-tab', dom.sideTabs).forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (dom.poolPane) dom.poolPane.hidden = view !== 'pool';
    if (dom.mapPane) dom.mapPane.hidden = view !== 'map';
    if (view === 'map') {
      renderScheduleMap();
      requestAnimationFrame(() => mapInstances.schedule?.invalidateSize());
    }
  }

  // ---------------------------------------------------------------------
  // 日历横向时间轴：拖拽框选
  // ---------------------------------------------------------------------
  let calHistBuckets = new Array(24).fill(0);
  function setupCalBrush() {
    let dragging = null;
    let anchor = 0;
    let frame = 0;
    let mapFrame = 0;
    const minuteFromEvent = (e) => {
      const rect = dom.calBrush.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      return clamp(Math.round((ratio * 24 * 60) / 30) * 30, 0, 24 * 60);
    };
    const live = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderCalFilters();
        renderCalResults();
        renderCalTimeControls();
      });
      if (!mapFrame) {
        mapFrame = setTimeout(() => {
          mapFrame = 0;
          renderCalendarMap();
        }, 120);
      }
    };
    const begin = (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.cal.startAfter = null;
      const m = minuteFromEvent(e);
      const handle = e.target.closest('.cal-brush-handle');
      if (handle) {
        dragging = handle.dataset.edge === 'start' ? 'start' : 'end';
      } else {
        dragging = 'new';
        anchor = m;
        state.cal.winStart = m;
        state.cal.winEnd = Math.min(24 * 60, m + 30);
      }
      try { dom.calBrush.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      updateCalBrushUI();
      live();
    };
    dom.calBrush.addEventListener('pointerdown', begin);
    dom.calBrush.addEventListener('pointermove', (e) => {
      if (dragging) return;
      const h = Math.min(23, Math.floor(minuteFromEvent(e) / 60));
      if (dom.calHistReadout) dom.calHistReadout.textContent = `${pad2(h)}:00–${pad2(h + 1)}:00 · ${calHistBuckets[h] || 0} 个活动`;
    });
    dom.calBrush.addEventListener('pointerleave', () => {
      if (dragging) return;
      if (dom.calHistReadout) dom.calHistReadout.textContent = '拖动图表框选时间段 · 也可以点上面的预设';
    });

    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const m = minuteFromEvent(e);
      if (dragging === 'new') {
        let a = Math.min(anchor, m);
        let b = Math.max(anchor, m);
        if (b - a < 30) b = Math.min(24 * 60, a + 30);
        if (b - a < 30) a = Math.max(0, b - 30);
        state.cal.winStart = a;
        state.cal.winEnd = b;
      } else if (dragging === 'start') {
        state.cal.winStart = clamp(m, 0, state.cal.winEnd - 30);
      } else {
        state.cal.winEnd = clamp(m, state.cal.winStart + 30, 24 * 60);
      }
      updateCalBrushUI();
      live();
    });

    const finish = () => {
      if (!dragging) return;
      if (dragging === 'new' && state.cal.winEnd - state.cal.winStart < 60) {
        if (state.cal.winEnd >= 24 * 60) state.cal.winStart = Math.max(0, 24 * 60 - 60);
        else state.cal.winEnd = Math.min(24 * 60, state.cal.winStart + 60);
      }
      dragging = null;
      updateCalBrushUI();
      renderCalendarView();
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  // ---------------------------------------------------------------------
  // 日历 tab（原版浏览视图）
  // ---------------------------------------------------------------------
  const CAL_PRESETS = [
    { label: '凌晨', start: 0, end: 6 * 60 },
    { label: '上午', start: 6 * 60, end: 12 * 60 },
    { label: '下午', start: 12 * 60, end: 18 * 60 },
    { label: '晚上', start: 18 * 60, end: 24 * 60 },
    { label: '深夜', start: 20 * 60, end: 24 * 60, startAfter: 20 * 60 },
    { label: '白天', start: 8 * 60, end: 18 * 60 },
    { label: '全天', start: 0, end: 24 * 60 },
  ];

  function setMode(mode, opts = {}) {
    if (!['schedule', 'calendar'].includes(mode)) return;
    state.mode = mode;
    document.body.classList.toggle('calendar-mode', mode === 'calendar');
    dom.workspace.hidden = mode !== 'schedule';
    dom.calendarView.hidden = mode !== 'calendar';
    $$('.mode-tab', dom.modeTabs).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (mode === 'calendar') {
      renderCalendarView();
      requestAnimationFrame(() => mapInstances.calendar?.invalidateSize());
    } else {
      renderAll({ resetScroll: Boolean(opts.resetScroll) });
      if (state.sideView === 'map') renderScheduleMap();
    }
  }

  function calBlock(a) {
    if (a.isFullDay) return { start: 8 * 60, end: 18 * 60 };
    const end = Math.min(1440, dayMin(a.end) + (a.end.slice(0, 10) !== a.start.slice(0, 10) ? 1440 : 0));
    return { start: dayMin(a.start), end };
  }

  function calInWindow(a, block = calBlock(a)) {
    if (!(block.start < state.cal.winEnd && block.end > state.cal.winStart)) return false;
    if (state.cal.startAfter != null && startMinOf(a) < state.cal.startAfter) return false;
    return true;
  }

  function calTimeBase() {
    return actsOn(state.date).filter((a) => calInWindow(a));
  }

  function calFilterActivities({ respectWindow = true } = {}) {
    const all = actsOn(state.date);
    const list = [];
    for (const a of all) {
      const block = calBlock(a);
      if (respectWindow && !calInWindow(a, block)) continue;
      if (isBlacklisted(a)) continue;
      if (!formationAllowed(a, state.cal)) continue;
      if (state.cal.bookableOnly && a.state !== '可报名') continue;
      if (state.cal.category !== 'all' && a.category !== state.cal.category) continue;
      if (state.cal.subcategory !== 'all' && a.subcategory !== state.cal.subcategory) continue;
      if (state.cal.source !== 'all' && (a.source || 'cumen') !== state.cal.source) continue;
      const km = distanceKm(a);
      const fits = block.start >= state.cal.winStart && block.end <= state.cal.winEnd;
      list.push({ a, km, fits, block });
    }
    return { all, list };
  }

  function calListWithFits() {
    return calFilterActivities({ respectWindow: true });
  }

  function calShade(a) {
    const km = distanceKm(a);
    const color = AREA.get(a.areaId)?.color || '#8a8f98';
    const t = km == null ? 0.55 : clamp((km - 3) / 37, 0, 1) * 0.55;
    return mixWhite(color, t);
  }

  function renderCalendarView() {
    if (!dom.calendarView) return;
    dom.calDayTitle.innerHTML = `${fmtDateCN(state.date)} <span style="font-size:13px;font-weight:500;color:var(--muted)">${weekdayCN(state.date)}</span>`;
    dom.calDaySub.textContent = `${actsOn(state.date).length} 个活动 · ${displayItemsFor(state.date).length} 项已排${state.date === today ? ' · 今天' : ''}`;
    renderCalMonth();
    renderCalFilters();
    renderCalTime();
    renderCalResults();
    renderCalScheduleList();
    renderCalLegend();
    renderCalendarMap();
    requestAnimationFrame(() => mapInstances.calendar?.invalidateSize());
  }

  function renderCalMonth() {
    const [y, m] = state.monthCursor.split('-').map(Number);
    dom.calMonthTitle.textContent = `${y} 年 ${m} 月`;
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - first.getDay());
    let daysWith = 0;
    let total = 0;
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const date = ymd(d);
      const info = DAY_INFO.get(date);
      const dots = info
        ? [...info.areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([id]) => `<i style="background:${AREA.get(id)?.color || '#8e8e93'}"></i>`).join('')
        : '';
      if (d.getMonth() === m - 1) { total += info?.count || 0; if (info?.count) daysWith++; }
      const cls = ['cal-day'];
      if (d.getMonth() !== m - 1) cls.push('other');
      if (date === today) cls.push('today');
      if (date === state.date) cls.push('selected');
      cells.push(`<button class="${cls.join(' ')}" data-action="pick-date" data-date="${date}" title="${fmtDateCN(date)} ${weekdayCN(date)}${info ? ` · ${info.count} 个活动` : ''}">
        <span class="num">${d.getDate()}</span><span class="dots">${dots}</span>
      </button>`);
    }
    dom.calGrid.innerHTML = cells.join('');
    dom.calMonthFoot.textContent = `${daysWith} 天有活动 · 共 ${total} 个`;
  }

  function renderCalFilters() {
    const all = calTimeBase();
    const catCounts = new Map();
    for (const a of all) if (a.category) catCounts.set(a.category, (catCounts.get(a.category) || 0) + 1);
    if (state.cal.category !== 'all' && !catCounts.has(state.cal.category)) state.cal.category = 'all';
    const order = ['运动', '娱乐', '社交', '文艺', '演出', '体验课', '其他'];
    dom.calCategory.innerHTML = `<option value="all">全部分类</option>${order.filter((c) => catCounts.has(c)).map((c) => `<option value="${escAttr(c)}">${esc(c)} ${catCounts.get(c)}</option>`).join('')}`;
    dom.calCategory.value = state.cal.category;

    const sourceCounts = new Map();
    for (const a of all) sourceCounts.set(a.source || 'cumen', (sourceCounts.get(a.source || 'cumen') || 0) + 1);
    if (state.cal.source !== 'all' && !sourceCounts.has(state.cal.source)) state.cal.source = 'all';
    dom.calSourceChips.innerHTML = `<button class="cal-chip ${state.cal.source === 'all' ? 'active' : ''}" data-action="cal-source" data-source="all">全部 ${all.length}</button>`
      + [...sourceCounts.entries()].sort((x, y) => y[1] - x[1]).map(([id, n]) => `<button class="cal-chip ${state.cal.source === id ? 'active' : ''}" data-action="cal-source" data-source="${escAttr(id)}">${esc(sourceLabel(id))} ${n}</button>`).join('');

    // 细分类只展示“当前分类 + 当前来源”下真实存在的项
    const subBase = all.filter((a) => (state.cal.category === 'all' || a.category === state.cal.category)
      && (state.cal.source === 'all' || (a.source || 'cumen') === state.cal.source));
    const subCounts = new Map();
    for (const a of subBase) if (a.subcategory) subCounts.set(a.subcategory, (subCounts.get(a.subcategory) || 0) + 1);
    if (state.cal.subcategory !== 'all' && !subCounts.has(state.cal.subcategory)) state.cal.subcategory = 'all';
    dom.calSubcategory.innerHTML = `<option value="all">全部细分类</option>${[...subCounts.entries()].sort((x, y) => y[1] - x[1]).map(([id, n]) => `<option value="${escAttr(id)}">${esc(id)} (${n})</option>`).join('')}`;
    dom.calSubcategory.value = state.cal.subcategory;

    dom.calBookable.checked = state.cal.bookableOnly;
    if (dom.calFormationUnlikely) dom.calFormationUnlikely.checked = state.cal.formationUnlikely;
  }

  function renderCalTimeControls() {
    dom.calPresets.innerHTML = CAL_PRESETS.map((p) => {
      const startAfter = p.startAfter ?? '';
      const active = state.cal.winStart === p.start && state.cal.winEnd === p.end && String(state.cal.startAfter ?? '') === String(startAfter);
      return `<button class="cal-preset ${active ? 'active' : ''}" data-action="cal-preset" data-start="${p.start}" data-end="${p.end}" data-start-after="${startAfter}">${p.label}</button>`;
    }).join('');
  }

  function updateCalBrushUI() {
    if (!dom.calBrushSelection) return;
    const start = state.cal.winStart;
    const end = state.cal.winEnd;
    const left = clamp((start / (24 * 60)) * 100, 0, 100);
    const right = clamp((end / (24 * 60)) * 100, 0, 100);
    dom.calBrushSelection.style.left = `${left}%`;
    dom.calBrushSelection.style.width = `${Math.max(0, right - left)}%`;
    dom.calBrushStartHandle.style.left = `${left}%`;
    dom.calBrushEndHandle.style.left = `${right}%`;
    dom.calBrushStartHandle.title = `开始 ${fmtMin(start)}`;
    dom.calBrushEndHandle.title = `结束 ${fmtMin(end)}`;
    updateCalHistogramSelected(start, end);
  }

  function updateCalHistogramSelected(start, end) {
    if (!dom.calHistBars) return;
    const bars = dom.calHistBars.querySelectorAll('.bar');
    bars.forEach((bar, h) => {
      bar.classList.toggle('on', h * 60 >= start && (h + 1) * 60 <= end);
    });
  }

  function renderCalHistogram() {
    // 图表跟随左下角筛选，但不跟当前时间窗联动；否则框出去的柱子会消失，没法再拖回来。
    const list = calFilterActivities({ respectWindow: false }).list;
    const buckets = new Array(24).fill(0);
    for (const { a } of list) {
      const block = calBlock(a);
      for (let h = 0; h < 24; h++) {
        if (block.start < (h + 1) * 60 && block.end > h * 60) buckets[h]++;
      }
    }
    calHistBuckets = buckets;
    if (dom.calHistReadout) dom.calHistReadout.textContent = '拖动图表框选时间段 · 也可以点上面的预设';
    const max = Math.max(1, ...buckets);
    dom.calHistBars.innerHTML = buckets.map((n, h) => {
      return `<div class="bar" style="height:${Math.max(2, (n / max) * 100)}%" title="${pad2(h)}:00–${pad2(h + 1)}:00 · ${n} 个活动"></div>`;
    }).join('');
    updateCalBrushUI();
  }

  function renderCalTime() {
    renderCalTimeControls();
    renderCalHistogram();
  }

  function calCardHTML(a, km) {
    const area = AREA.get(a.areaId) || { name: '其他', color: '#8a8f98' };
    const scheduled = Boolean(findScheduled(a.id, state.date));
    const shade = calShade(a);
    const lowFormation = isFormationLow(a);
    const badges = [
      a.isFullDay ? '<span class="badge full">全天</span>' : '',
      (a.source || 'cumen') !== 'cumen' ? `<span class="badge source" style="--sc:${sourceMeta(a.source).color}">${esc(sourceLabel(a.source))}</span>` : '',
      stateBadge(a),
    ].filter(Boolean).join('');
    return `<article class="cal-activity-card ${scheduled ? 'in-plan' : ''} ${lowFormation ? 'is-low-formation' : ''}" data-action="open-detail" data-id="${escAttr(a.id)}" title="${escAttr(a.title)} · ${escAttr(a.venue || '')}">
      <span class="rail" style="background:${shade}"></span>
      <div class="cal-card-top">
        <h3>${esc(a.title)}</h3>
        <span class="cal-card-time">${esc(activityTimeLabel(a))}</span>
      </div>
      <div class="cal-card-foot">
        <span class="cal-card-badges">${badges}</span>
        <span class="cal-card-place" title="${escAttr(`${a.venue || '场地待确认'} · ${area.name}${km == null ? '' : ` · 直线 ${km.toFixed(1)}km`}`)}">
          <span class="cal-card-venue" title="${escAttr(a.address || '')}">${esc(a.venue || '场地待确认')}</span>
          <span class="cal-card-sep">·</span>
          <span class="cal-area-chip"><i style="background:${area.color}"></i>${esc(area.name)}</span>
          <span class="cal-card-dist">${km == null ? '距离未知' : `直线 ${km.toFixed(1)}km`}</span>
        </span>
        <span class="cal-card-price ${priceValue(a) === 0 ? 'free' : ''}">${esc(priceText(a))}</span>
        <button class="cal-add-btn ${scheduled ? 'added' : ''}" data-action="cal-toggle-activity" data-id="${escAttr(a.id)}">${scheduled ? '已加入 ✓' : '加入时间表'}</button>
      </div>
    </article>`;
  }

  function renderCalResults() {
    const { all, list } = calListWithFits();
    const sortLabel = state.cal.sort === 'distance' ? '按直线距离' : state.cal.sort === 'time' ? '按开始时间' : '按价格';
    dom.calResultSummary.innerHTML = `<b>${list.length}</b> 个活动 · ${sortLabel}`;
    dom.calSort.value = state.cal.sort;
    dom.calGroupBtn.classList.toggle('active', state.cal.group && state.cal.sort === 'distance');
    dom.calGroupBtn.disabled = state.cal.sort !== 'distance';

    const sorted = [...list].sort((x, y) => {
      if (state.cal.sort === 'time') return startMinOf(x.a) - startMinOf(y.a) || (x.km ?? Infinity) - (y.km ?? Infinity);
      if (state.cal.sort === 'price') return priceValue(x.a) - priceValue(y.a) || startMinOf(x.a) - startMinOf(y.a);
      return (x.km ?? Infinity) - (y.km ?? Infinity) || startMinOf(x.a) - startMinOf(y.a);
    });
    if (!sorted.length) {
      dom.calGroups.innerHTML = `<div class="cal-empty"><h3>这个条件下还没有活动</h3><p>试试放宽时间窗，或者清空筛选。</p><button class="btn" data-action="cal-reset" style="margin-top:10px">清空筛选</button></div>`;
      return;
    }
    const fullDay = sorted.filter((x) => x.a.isFullDay);
    const normal = sorted.filter((x) => !x.a.isFullDay);
    let html = '';
    // 全天/徒步单独一栏，不混进上午/下午/晚上的片区组
    if (fullDay.length) {
      const fullOpen = !state.cal.collapsedGroups.has('fullday');
      html += `<details class="cal-fullday-section cal-group-collapse" data-cal-group="fullday" ${fullOpen ? 'open' : ''}>
        <summary class="cal-fullday-head">
          <span class="cal-area-dot"></span>
          <span class="cal-area-name">全天 · 徒步 / 一日游</span>
          <span class="cal-area-meta">占满白天，和普通时段活动分开展示</span>
          <span class="cal-area-rule"></span>
          <span class="cal-area-meta">${fullDay.length} 个</span>
          <span class="cal-group-caret">${fullOpen ? '▾' : '▸'}</span>
        </summary>
        <div class="cal-cards">${fullDay.map((x) => calCardHTML(x.a, x.km)).join('')}</div>
      </details>`;
    }
    if (normal.length) {
      if (state.cal.group && state.cal.sort === 'distance') {
        const map = new Map();
        for (const x of normal) {
          if (!map.has(x.a.areaId)) map.set(x.a.areaId, []);
          map.get(x.a.areaId).push(x);
        }
        const groups = [...map.entries()].map(([id, items]) => {
          const area = AREA.get(id) || { name: '其他', color: '#8a8f98' };
          const kms = items.map((x) => x.km).filter((x) => x != null);
          return { id, area, items: items.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)), min: kms.length ? Math.min(...kms) : null };
        }).sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity));
        for (const g of groups) {
          const key = `area:${g.id}`;
          const open = !state.cal.collapsedGroups.has(key);
          html += `<details class="cal-group-collapse" data-cal-group="${escAttr(key)}" ${open ? 'open' : ''}>
            <summary class="cal-area-head">
              <span class="cal-area-dot" style="background:${g.area.color}"></span>
              <span class="cal-area-name">${esc(g.area.name)}</span>
              <span class="cal-area-meta">${g.min == null ? '地点待确认' : `最近 ${g.min.toFixed(1)}km`}</span>
              <span class="cal-area-rule"></span>
              <span class="cal-area-meta">${g.items.length} 个</span>
              <span class="cal-group-caret">${open ? '▾' : '▸'}</span>
            </summary>
            <div class="cal-cards">${g.items.map((x) => calCardHTML(x.a, x.km)).join('')}</div>
          </details>`;
        }
      } else {
        html += `<div class="cal-cards">${normal.map((x) => calCardHTML(x.a, x.km)).join('')}</div>`;
      }
    }
    dom.calGroups.innerHTML = html;
    $$('details[data-cal-group]', dom.calGroups).forEach((d) => {
      d.addEventListener('toggle', () => {
        if (d.open) state.cal.collapsedGroups.delete(d.dataset.calGroup);
        else state.cal.collapsedGroups.add(d.dataset.calGroup);
        const caret = d.querySelector('.cal-group-caret');
        if (caret) caret.textContent = d.open ? '▾' : '▸';
      });
    });
  }

  function renderCalScheduleList() {
    const items = displayItemsFor(state.date);
    dom.calSchedCount.textContent = `${items.length} 项`;
    if (!items.length) {
      dom.calSchedList.innerHTML = `<div class="cal-sched-empty">这天还没排。点卡片加入，或去「日程」拖一条自己的安排。</div>`;
      return;
    }
    dom.calSchedList.innerHTML = items.map((item) => {
      const a = item.activityId ? ACT.get(item.activityId) : null;
      const area = a ? (AREA.get(a.areaId)?.name || '') : '我的安排';
      const lowFormation = a ? isFormationLow(a) : false;
      const sub = a ? `${area} · ${a.venue || ''}${lowFormation ? ' · 可能不成团' : ''}` : `${item.venue || ''}${item.note ? ` · ${item.note}` : ''}`;
      return `<div class="cal-sched-row ${lowFormation ? 'is-low-formation' : ''}" data-action="cal-open-item" data-id="${escAttr(item.id)}">
        <span class="t">${esc(rangeTextOf(item))}</span>
        <span class="name">${esc(item.title)}<span class="sub">${esc(sub)}</span></span>
        <button class="x" data-action="cal-remove-item" data-id="${escAttr(item.id)}" aria-label="移出时间表">×</button>
      </div>`;
    }).join('');
  }

  function renderCalLegend() {
    const counts = new Map();
    for (const a of actsOn(state.date)) counts.set(a.areaId, (counts.get(a.areaId) || 0) + 1);
    const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    dom.calLegend.innerHTML = items.map(([id, n]) => {
      const area = AREA.get(id);
      return `<span class="cal-legend-item"><i style="background:${area?.color || '#8e8e93'}"></i>${esc(area?.name || '其他')} ${n}</span>`;
    }).join('');
  }

  function setCal(patch, opts = {}) {
    Object.assign(state.cal, patch);
    renderCalendarView();
  }

  // ---------------------------------------------------------------------
  // 时间窗拖拽筛选
  // ---------------------------------------------------------------------
  function updateTimeWindowUI() {
    if (!dom.timeWindowOverlay) return;
    const start = state.pool.winStart;
    const end = state.pool.winEnd;
    const full = start === 0 && end === 24 * 60;
    const top = start * PX_PER_MIN;
    const height = Math.max(0, (end - start) * PX_PER_MIN);
    dom.timeWindowOverlay.style.top = `${top}px`;
    dom.timeWindowOverlay.style.height = `${height}px`;
    dom.timeWindowOverlay.classList.toggle('active', !full);
    dom.timeHandleStart.style.top = `${clamp(top, 12, TIMELINE_H - 12)}px`;
    dom.timeHandleEnd.style.top = `${clamp(top + height, 12, TIMELINE_H - 12)}px`;
    dom.timeHandleStartLabel.textContent = fmtMin(start);
    dom.timeHandleEndLabel.textContent = fmtMin(end);
    dom.timeWindowLabel.textContent = full ? '全天' : `${fmtMin(start)}–${fmtMin(end)}`;
    dom.timeWindowReset.disabled = full;
    if (dom.timeFits) dom.timeFits.checked = state.pool.fitsTime;
  }

  function setupTimeWindowDrag() {
    let dragging = null;
    const minuteFromEvent = (e) => {
      const rect = dom.timelineBody.getBoundingClientRect();
      const y = clamp(e.clientY - rect.top, 0, TIMELINE_H);
      return clamp(Math.round((y / PX_PER_MIN) / 15) * 15, 0, 24 * 60);
    };
    const begin = (which) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = which;
      document.body.style.cursor = 'ns-resize';
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.timeHandleStart.addEventListener('pointerdown', begin('start'));
    dom.timeHandleEnd.addEventListener('pointerdown', begin('end'));

    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const m = minuteFromEvent(e);
      if (dragging === 'start') state.pool.winStart = clamp(m, 0, state.pool.winEnd - 30);
      else state.pool.winEnd = clamp(m, state.pool.winStart + 30, 24 * 60);
      updateTimeWindowUI();
      schedulePoolUpdate();
    });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = null;
      document.body.style.cursor = '';
      renderPool();
    });
  }

  // ---------------------------------------------------------------------
  // 时间轴框选：在时间轴上按住往下拖一段，直接筛出这个时间段的活动
  // ---------------------------------------------------------------------
  function setupRangeSelect() {
    const body = dom.timelineBody;
    const band = document.createElement('div');
    band.className = 'time-select-band';
    band.hidden = true;
    band.innerHTML = '<span class="time-select-label"></span>';
    body.appendChild(band);

    let press = null;
    let suppressClick = false;

    const minuteAt = (clientY) => {
      const rect = body.getBoundingClientRect();
      const y = clamp(clientY - rect.top, 0, TIMELINE_H);
      return clamp(Math.round((y / PX_PER_MIN) / 15) * 15, 0, 24 * 60);
    };
    const paint = (s, e) => {
      band.hidden = false;
      band.style.top = `${s * PX_PER_MIN}px`;
      band.style.height = `${Math.max(2, (e - s) * PX_PER_MIN)}px`;
      band.querySelector('.time-select-label').textContent = `${fmtMin(s)}–${fmtMin(e)}`;
    };

    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.block, .time-handle, .now-line, .time-select-band')) return;
      // 空档是 <button class="gap-band">，允许从它上面开始拖选；其它按钮不拦
      if (e.target.closest('button') && !e.target.closest('.gap-band')) return;
      press = { y0: e.clientY, selecting: false };
    });

    window.addEventListener('pointermove', (e) => {
      if (!press) return;
      if (!press.selecting) {
        if (Math.abs(e.clientY - press.y0) < 6) return;
        press.selecting = true;
        body.classList.add('selecting');
        try { body.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      const a = minuteAt(press.y0);
      const b = minuteAt(e.clientY);
      press.range = [Math.min(a, b), Math.max(a, b)];
      paint(press.range[0], press.range[1]);
      e.preventDefault();
    });

    window.addEventListener('pointerup', () => {
      if (!press) return;
      const { selecting, range } = press;
      press = null;
      body.classList.remove('selecting');
      band.hidden = true;
      if (!selecting || !range) return;
      let [s, e] = range;
      if (e - s < 30) {
        // 拖得太短按 1 小时算
        e = Math.min(24 * 60, s + 60);
        s = Math.max(0, e - 60);
      }
      state.pool.winStart = s;
      state.pool.winEnd = e;
      updateTimeWindowUI();
      renderPool();
      toast(`时间窗 ${fmtMin(s)}–${fmtMin(e)}`);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 400);
    });

    // 框选结束后紧跟的 click 会触发“点空白加安排”，这里在捕获阶段拦掉
    body.addEventListener('click', (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  let poolUpdateFrame = 0;
  function schedulePoolUpdate() {
    if (poolUpdateFrame) return;
    poolUpdateFrame = requestAnimationFrame(() => {
      poolUpdateFrame = 0;
      renderPool();
    });
  }

  // ---------------------------------------------------------------------
  // 视图刷新
  // ---------------------------------------------------------------------
  function renderAll(opts = {}) {
    const tScroll = dom.timelineScroll.scrollTop;
    const pScroll = dom.poolList.scrollTop;
    renderHeader();
    renderWeekbar();
    renderTimeline();
    renderPool();
    renderMobileChrome();

    if (opts.resetScroll) {
      dom.timelineScroll.scrollTop = initialScrollTop();
      dom.poolList.scrollTop = 0;
    } else {
      dom.timelineScroll.scrollTop = tScroll;
      dom.poolList.scrollTop = pScroll;
    }

    const revealId = opts.revealId || state.revealItemId;
    if (revealId) {
      state.revealItemId = null;
      const el = [...dom.blockLayer.children].find((x) => x.dataset.id === revealId);
      if (el) dom.timelineScroll.scrollTop = Math.max(0, el.offsetTop - 60);
    }
    if (state.mode === 'calendar') renderCalendarView();
  }

  function renderMobileChrome() {
    $$('.mobile-switch button', dom.mobileSwitch).forEach((b) => b.classList.toggle('active', b.dataset.pane === state.mobilePane));
    dom.workspace.classList.toggle('show-pool', state.mobilePane === 'pool');
    dom.mobileScheduleCount.textContent = String(displayItemsFor(state.date).length);
  }

  function selectDate(date, opts = {}) {
    if (!DATE_RE.test(date)) return;
    state.date = date;
    state.month = monthOf(date);
    state.monthCursor = monthOf(date);
    closeModal();
    closeLayers();
    if (opts.resetPool !== false) {
      state.pool.search = '';
      state.mobilePane = 'schedule';
    }
    renderAll({ resetScroll: true });
  }

  function setPool(patch, { resetScroll = false } = {}) {
    Object.assign(state.pool, patch);
    const prev = dom.poolList.scrollTop;
    renderPool();
    dom.poolList.scrollTop = resetScroll ? 0 : prev;
    dom.mobilePoolCount.textContent = String(dom.poolList.querySelectorAll('.pool-item').length);
  }

  // ---------------------------------------------------------------------
  // 手动安排弹窗
  // ---------------------------------------------------------------------
  function closeModal() {
    const fn = state.pendingConfirm;
    state.pendingConfirm = null;
    dom.modalRoot.innerHTML = '';
    if (fn) fn(false);
  }

  function openModal(html) {
    dom.modalRoot.innerHTML = html;
    dom.detailDrawer.classList.remove('show');
    dom.detailDrawer.setAttribute('aria-hidden', 'true');
    dom.scrim.classList.remove('show');
    state.detailId = null;
  }

  // ---------------------------------------------------------------------
  // 爬取入口
  // ---------------------------------------------------------------------
  function crawlModuleRows() {
    const modules = Array.isArray(DATA.modules) ? DATA.modules : [];
    if (!modules.length) return '<div class="blacklist-empty">快照里没有模块信息，请先刷新数据快照。</div>';
    return modules.map((m) => {
      const last = m.lastRun
        ? `上次 ${new Date(m.lastRun.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · 抓取 ${m.lastRun.fetched}`
        : '从未运行';
      return `<label class="crawl-module ${m.ready ? '' : 'disabled'}">
        <input type="checkbox" value="${escAttr(m.id)}" ${m.ready ? '' : 'disabled'}>
        <span class="crawl-name">${esc(m.label)}<small>${esc(m.id)}</small></span>
        <span class="crawl-status ${m.ready ? 'ready' : 'bad'}">${m.ready ? last : '未实现，暂不能选'}</span>
      </label>`;
    }).join('');
  }

  function updateCrawlStart() {
    const link = $('#crawlStart');
    if (!link) return;
    // 手机版没有 Mac，采集只能在电脑上跑
    if (window.DAYFLOW_PWA) {
      link.href = '#';
      link.classList.add('disabled');
      link.textContent = '手机端不支持，请在 Mac 上运行';
      link.setAttribute('aria-disabled', 'true');
      return;
    }
    const ids = $$('.crawl-module input:checked').map((x) => x.value);
    if (ids.length) {
      const location = ($('#crawlLocation')?.value || '').trim();
      const radius = ($('#crawlRadius')?.value || '10').trim() || '10';
      let href = `dayflow://service/crawl?modules=${encodeURIComponent(ids.join(','))}`;
      if (location) href += `&location=${encodeURIComponent(location)}&radius=${encodeURIComponent(radius)}`;
      link.href = href;
      link.classList.remove('disabled');
      link.textContent = `开始爬取（${ids.length}）`;
      link.setAttribute('aria-disabled', 'false');
    } else {
      link.href = '#';
      link.classList.add('disabled');
      link.textContent = '开始爬取';
      link.setAttribute('aria-disabled', 'true');
    }
  }

  function openCrawlModal() {
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog crawl-dialog" role="dialog" aria-modal="true">
          <div class="dialog-head">
            <h2>开始爬取</h2>
            <p>勾选要运行的采集模块；只勾选一个也可以。会调用本地 DayFlowLauncher，不需要命令行。</p>
          </div>
          <div class="dialog-body">
            <div class="crawl-list" id="crawlList">${crawlModuleRows()}</div>
            <div class="crawl-location">
              <label>地点
                <input id="crawlLocation" type="text" placeholder="如：北苑 / 望京 / 39.90,116.64">
              </label>
              <label>半径
                <input id="crawlRadius" type="number" min="1" max="50" step="1" value="10"> km
              </label>
              <span class="hint">只对美团课程/演出生效；留空 = 不按地点过滤（全城）。</span>
            </div>
            <div class="crawl-actions">
              <button class="crawl-select" data-action="crawl-select-all">全选可用</button>
              <a class="btn primary crawl-start disabled" id="crawlStart" href="#" aria-disabled="true">开始爬取</a>
            </div>
            <div class="crawl-note">抓取在后台顺序运行，完成后 macOS 通知会提示；刷新页面即可看到新快照。日志：<code>data/crawl.log</code>。地点/半径只对美团课程/演出生效；课程首次运行会自动打开 Chrome 登录，演出不需要登录。</div>
          </div>
          <div class="dialog-foot">
            <button class="btn" data-action="modal-close">取消</button>
          </div>
        </div>
      </div>`);
    $$('.crawl-module input', dom.modalRoot).forEach((cb) => cb.addEventListener('change', updateCrawlStart));
    $('#crawlLocation')?.addEventListener('input', updateCrawlStart);
    $('#crawlRadius')?.addEventListener('input', updateCrawlStart);
    $('#crawlStart')?.addEventListener('click', (e) => {
      if ($('#crawlStart').classList.contains('disabled')) {
        e.preventDefault();
        return;
      }
      toast('已交给本地启动器，抓取会在后台运行');
      setTimeout(closeModal, 350);
    });
    updateCrawlStart();
  }

  // ---------------------------------------------------------------------
  // 数据库快照查看器
  // ---------------------------------------------------------------------
  const DB_PAGE_SIZE = 60;
  function dbRows() {
    const q = state.db.query.trim().toLowerCase();
    if (state.db.table === 'collection_runs') {
      return (DATA.runs || []).filter((r) => !q || Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)));
    }
    return DATA.activities.filter((a) => {
      if (state.db.source !== 'all' && (a.source || 'cumen') !== state.db.source) return false;
      if (state.db.sub !== 'all' && (a.subcategory || '') !== state.db.sub) return false;
      if (q) {
        const text = `${a.id} ${a.title} ${a.subcategory || ''} ${a.category || ''} ${sourceLabel(a.source)} ${a.venue || ''} ${a.address || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }

  function dbRowsHTML(rows, page) {
    if (!rows.length) return '<div class="db-empty">没有匹配的数据行</div>';
    const start = page * DB_PAGE_SIZE;
    const slice = rows.slice(start, start + DB_PAGE_SIZE);
    if (state.db.table === 'collection_runs') {
      return `<table class="db-table"><thead><tr>
        <th>#</th><th>module</th><th>trigger</th><th>started_at</th><th>ended_at</th><th>ok</th>
        <th>fetched</th><th>inserted</th><th>updated</th><th>unchanged</th><th>errors</th>
      </tr></thead><tbody>${slice.map((r, i) => `<tr>
        <td class="num">${start + i + 1}</td>
        <td>${esc(r.module || '')}</td><td>${esc(r.trigger || '')}</td>
        <td class="num">${esc(r.started_at || '')}</td><td class="num">${esc(r.ended_at || '')}</td>
        <td>${esc(String(r.ok ?? ''))}</td><td class="num">${esc(String(r.fetched ?? ''))}</td>
        <td class="num">${esc(String(r.inserted ?? ''))}</td><td class="num">${esc(String(r.updated ?? ''))}</td>
        <td class="num">${esc(String(r.unchanged ?? ''))}</td><td>${esc(r.errors || '')}</td>
      </tr>`).join('')}</tbody></table>`;
    }
    return `<table class="db-table"><thead><tr>
      <th>#</th><th>id</th><th>标题</th><th>开始</th><th>结束</th><th>大类</th><th>细分类</th>
      <th>来源</th><th>片区</th><th>场地</th><th>价格</th><th>状态</th><th>坐标</th>
    </tr></thead><tbody>${slice.map((a, i) => {
      const area = AREA.get(a.areaId)?.name || '';
      return `<tr>
        <td class="num">${start + i + 1}</td>
        <td class="num">${esc(a.id)}</td>
        <td class="title-cell">${esc(a.title)}</td>
        <td class="num">${esc(String(a.start || '').replace('T', ' '))}</td>
        <td class="num">${esc(String(a.end || '').replace('T', ' '))}</td>
        <td>${esc(a.category || '')}</td>
        <td>${esc(a.subcategory || '')}</td>
        <td>${esc(sourceLabel(a.source))}</td>
        <td>${esc(area)}</td>
        <td>${esc(a.venue || '')}</td>
        <td class="num">${a.price == null ? '—' : a.price === 0 ? '免费' : a.price}</td>
        <td>${esc(a.state || '')}</td>
        <td class="num">${a.lat == null || a.lng == null ? '—' : `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  function renderDbTable() {
    const wrap = $('#dbTableWrap');
    const pager = $('#dbPager');
    const count = $('#dbCount');
    if (!wrap) return;
    const rows = dbRows();
    const pages = Math.max(1, Math.ceil(rows.length / DB_PAGE_SIZE));
    state.db.page = clamp(state.db.page, 0, pages - 1);
    wrap.innerHTML = dbRowsHTML(rows, state.db.page);
    if (count) count.textContent = `${rows.length} 行 · 第 ${state.db.page + 1}/${pages} 页`;
    if (pager) {
      pager.innerHTML = `<span>${rows.length} 行</span>
        <button data-action="db-page" data-delta="-1" ${state.db.page <= 0 ? 'disabled' : ''}>上一页</button>
        <button data-action="db-page" data-delta="1" ${state.db.page >= pages - 1 ? 'disabled' : ''}>下一页</button>`;
    }
    $$('.db-table-tab').forEach((b) => b.classList.toggle('active', b.dataset.table === state.db.table));
    const filters = $('#dbFilters');
    if (filters) filters.hidden = state.db.table !== 'activities';
  }

  function renderDbModal() {
    const sources = [...new Set(DATA.activities.map((a) => a.source || 'cumen'))].sort();
    const subs = [...new Set(DATA.activities.map((a) => a.subcategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
    if (state.db.source !== 'all' && !sources.includes(state.db.source)) state.db.source = 'all';
    if (state.db.sub !== 'all' && !subs.includes(state.db.sub)) state.db.sub = 'all';
    const generated = DATA.generatedAt ? new Date(DATA.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '—';
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog db-dialog" role="dialog" aria-modal="true">
          <div class="dialog-head db-head">
            <div class="db-head-row">
              <div>
                <h2>数据库 · 只读快照</h2>
                <p>页面内看到的是生成快照时的 <code>data/dayflow.db</code>；完整实时表用右上角按钮自动启动。</p>
                <div class="db-meta">
                  <span><code>data/dayflow.db</code></span>
                  <span>快照 ${esc(generated)}</span>
                  <span>${DATA.activities.length} 条 activities</span>
                  <span>${(DATA.runs || []).length} 条 collection_runs</span>
                </div>
              </div>
              <div class="db-head-actions">
                ${window.DAYFLOW_PWA
                  ? '<span class="btn" aria-disabled="true" title="实时查看器只在 Mac 上运行">手机端只读</span>'
                  : '<a class="btn primary" href="dayflow://service/db">启动并打开实时查看器</a>'}
              </div>
            </div>
          </div>
          <div class="dialog-body db-body">
            <div class="db-table-tabs">
              <button class="db-table-tab ${state.db.table === 'activities' ? 'active' : ''}" data-action="db-table" data-table="activities">activities · ${DATA.activities.length}</button>
              <button class="db-table-tab ${state.db.table === 'collection_runs' ? 'active' : ''}" data-action="db-table" data-table="collection_runs">collection_runs · ${(DATA.runs || []).length}</button>
              <span class="db-count" id="dbCount"></span>
            </div>
            <div class="db-toolbar" id="dbFilters" ${state.db.table !== 'activities' ? 'hidden' : ''}>
              <input id="dbSearch" value="${escAttr(state.db.query)}" placeholder="搜 id / 标题 / 细分类 / 来源 / 场地" autocomplete="off">
              <select id="dbSource" aria-label="来源">
                <option value="all">全部来源</option>
                ${sources.map((s) => `<option value="${escAttr(s)}" ${state.db.source === s ? 'selected' : ''}>${esc(sourceLabel(s))}</option>`).join('')}
              </select>
              <select id="dbSub" aria-label="细分类">
                <option value="all">全部细分类</option>
                ${subs.map((s) => `<option value="${escAttr(s)}" ${state.db.sub === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
              </select>
            </div>
            <div class="db-table-wrap" id="dbTableWrap"></div>
            <div class="db-pager" id="dbPager"></div>
            <div class="db-note">快照不含 <code>schedule_items</code>。点右上角按钮会调用本地 DayFlowLauncher：服务没启动就先启动，再打开实时查看器（首次点击系统会确认一次）。没反应就双击 <code>tools/launcher/DayFlowLauncher.app</code>；实时地址是 <code>http://127.0.0.1:8787</code>。</div>
          </div>
          <div class="dialog-foot">
            <button class="btn" data-action="modal-close">关闭</button>
          </div>
        </div>
      </div>`);
    renderDbTable();
    $('#dbSearch')?.addEventListener('input', (e) => {
      state.db.query = e.target.value;
      state.db.page = 0;
      renderDbTable();
    });
    $('#dbSource')?.addEventListener('change', (e) => {
      state.db.source = e.target.value;
      state.db.page = 0;
      renderDbTable();
    });
    $('#dbSub')?.addEventListener('change', (e) => {
      state.db.sub = e.target.value;
      state.db.page = 0;
      renderDbTable();
    });
  }

  // ---------------------------------------------------------------------
  // 黑名单弹窗
  // ---------------------------------------------------------------------
  function blacklistRowsHTML() {
    if (!state.blacklist.length) {
      return '<div class="blacklist-empty">黑名单是空的。可以添加「德州扑克」「KTV」「写生」等类型。</div>';
    }
    return state.blacklist.map((e, i) => {
      const hits = blacklistHitCount(e.label);
      return `<div class="blacklist-row ${e.active ? 'active' : ''}">
        <input type="checkbox" class="blacklist-check" data-action="blacklist-toggle" data-index="${i}" ${e.active ? 'checked' : ''} aria-label="启用 ${escAttr(e.label)}">
        <input class="blacklist-label" data-index="${i}" value="${escAttr(e.label)}" aria-label="编辑黑名单类型" title="直接修改类型名">
        <span class="blacklist-hits" title="当前日期匹配的活动数">今天 ${hits}</span>
        <button class="blacklist-remove" data-action="blacklist-remove" data-index="${i}" aria-label="删除">删除</button>
      </div>`;
    }).join('');
  }

  function renderBlacklistRows() {
    const box = $('#blacklistList');
    if (box) box.innerHTML = blacklistRowsHTML();
    const count = $('#blacklistActiveCount');
    if (count) count.textContent = String(state.blacklist.filter((e) => e.active && e.label.trim()).length);
    renderBlacklistBadges();
  }

  function refreshAfterBlacklistChange() {
    renderBlacklistBadges();
    if (state.mode === 'calendar') renderCalendarView();
    else renderAll();
  }

  function openBlacklistModal() {
    const types = [...new Set(DATA.activities.map((a) => a.subcategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
    const active = state.blacklist.filter((e) => e.active && e.label.trim()).length;
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog blacklist-dialog" role="dialog" aria-modal="true">
          <div class="dialog-head">
            <h2>活动类型黑名单</h2>
            <p>勾选后才会隐藏；新加的类型默认不勾选。匹配细分类、分类、标题或场地，已启用 <b id="blacklistActiveCount">${active}</b> 类。</p>
          </div>
          <div class="dialog-body">
            <div class="blacklist-add">
              <input id="blacklistInput" list="blacklistTypes" placeholder="例如：德州扑克 / KTV / 写生" autocomplete="off">
              <datalist id="blacklistTypes">${types.map((t) => `<option value="${escAttr(t)}"></option>`).join('')}</datalist>
              <button class="btn primary" data-action="blacklist-add">添加</button>
            </div>
            <div class="blacklist-list" id="blacklistList">${blacklistRowsHTML()}</div>
            <div class="blacklist-note">类型名可以直接点开修改；只有勾选后才生效。黑名单只影响展示，不删除活动，也不会改数据库。勾选「德州扑克」后，当天所有德州扑克活动会从活动池、日历卡片、图表和地图上消失。</div>
          </div>
          <div class="dialog-foot">
            <button class="btn" data-action="modal-close">关闭</button>
          </div>
        </div>
      </div>`);
    const input = $('#blacklistInput');
    input?.focus();
  }

  function addBlacklistFromInput() {
    const input = $('#blacklistInput');
    if (!input) return;
    const label = input.value.trim();
    if (!label) { toast('先输入一个活动类型'); input.focus(); return; }
    if (state.blacklist.some((e) => e.label.toLowerCase() === label.toLowerCase())) {
      toast('这个类型已经在黑名单里了');
      input.focus();
      return;
    }
    state.blacklist.push({ label, active: false });
    saveBlacklist();
    input.value = '';
    renderBlacklistRows();
    refreshAfterBlacklistChange();
    input.focus();
    toast(`已加入黑名单：${label}（默认未勾选）`);
  }

  function toggleBlacklist(index, checked) {
    const e = state.blacklist[index];
    if (!e) return;
    e.active = Boolean(checked);
    saveBlacklist();
    renderBlacklistRows();
    refreshAfterBlacklistChange();
  }

  function removeBlacklist(index) {
    const e = state.blacklist[index];
    if (!e) return;
    state.blacklist.splice(index, 1);
    saveBlacklist();
    renderBlacklistRows();
    refreshAfterBlacklistChange();
    toast(`已从黑名单移除：${e.label}`);
  }

  function editBlacklist(index, value) {
    const e = state.blacklist[index];
    if (!e) return;
    const label = value.trim();
    const old = e.label;
    if (!label) {
      renderBlacklistRows();
      toast('类型名不能为空');
      return;
    }
    if (state.blacklist.some((x, i) => i !== index && x.label.toLowerCase() === label.toLowerCase())) {
      renderBlacklistRows();
      toast('这个类型已经在黑名单里了');
      return;
    }
    e.label = label;
    saveBlacklist();
    renderBlacklistRows();
    refreshAfterBlacklistChange();
    if (old !== label) toast(`黑名单类型改为：${label}`);
  }

  function defaultManualRange(gap) {
    if (gap) {
      let start = gap.start;
      if (gap.end - gap.start >= 180 && start < 9 * 60) start = 9 * 60;
      let end = Math.min(start + 60, gap.end, 1439);
      if (end - start < 30) end = Math.min(gap.end, 1439);
      return { start, end };
    }
    const now = new Date();
    const nowMin = state.date === today ? now.getHours() * 60 + now.getMinutes() : 9 * 60;
    const start = clamp(Math.ceil(nowMin / 15) * 15, DAY_START, 22 * 60);
    return { start, end: Math.min(start + 60, 1439) };
  }

  function openManualModal(opts = {}) {
    const editing = opts.id ? itemForId(opts.id) : null;
    let start; let end; let nextDay = false;
    if (editing) {
      nextDay = editing.end.slice(0, 10) > editing.start.slice(0, 10);
      start = Math.max(DAY_START, Math.min(dayMin(editing.start), 1439));
      end = Math.max(0, Math.min(dayMin(editing.end), 1439));
    } else if (opts.start != null) {
      start = clamp(Math.round(Number(opts.start) / 15) * 15, DAY_START, 1439);
      const gapEnd = opts.end != null ? clamp(Number(opts.end), start + 15, 1439) : null;
      if (gapEnd != null && gapEnd - start > 180 && start < 9 * 60) start = 9 * 60;
      end = gapEnd != null ? Math.min(start + 60, gapEnd) : Math.min(start + 60, 1439);
      if (end - start < 15) end = Math.min(gapEnd ?? (start + 60), 1439);
    } else {
      const gaps = freeGapsFor(state.date, 30);
      const preferred = gaps.find((g) => g.start >= DAY_START) || gaps[0] || null;
      const range = defaultManualRange(preferred);
      start = range.start; end = range.end;
    }
    state.manualColor = editing?.color || MANUAL_COLORS[0];
    const title = editing?.title || '';
    const venue = editing?.venue || '';
    const note = editing?.note || '';
    const dateLabel = `${fmtDateCN(state.date)} ${weekdayCN(state.date)}`;
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog manual-dialog" role="dialog" aria-modal="true">
          <div class="dialog-head">
            <h2>${editing ? '编辑我的安排' : '添加自己的安排'}</h2>
            <p>${esc(dateLabel)} · 时间块会直接落在左侧时间轴上，和采集活动一起排。</p>
          </div>
          <div class="dialog-body">
            <label class="field"><span>标题</span><input id="manualTitle" value="${escAttr(title)}" placeholder="例如：健身房 / 和朋友吃饭 / 午休" autocomplete="off"></label>
            <div class="form-row">
              <label class="field"><span>开始</span><input id="manualStart" type="time" step="900" min="00:00" max="23:59" value="${toTimeInput(start)}"></label>
              <label class="field"><span>结束</span><input id="manualEnd" type="time" step="900" min="00:00" max="23:59" value="${toTimeInput(end)}"></label>
            </div>
            <label class="check-row"><input type="checkbox" id="manualNextDay" ${nextDay ? 'checked' : ''}> 结束于次日（跨天）</label>
            <label class="field"><span>地点（可选）</span><input id="manualVenue" value="${escAttr(venue)}" placeholder="例如：家 / 公司 / 三里屯" autocomplete="off"></label>
            <label class="field"><span>备注（可选）</span><textarea id="manualNote" placeholder="给自己留一句话">${esc(note)}</textarea></label>
            <div class="field">
              <span>颜色</span>
              <div class="swatches">
                ${MANUAL_COLORS.map((c) => `<button class="swatch ${state.manualColor === c ? 'active' : ''}" data-action="pick-color" data-color="${c}" style="background:${c}" aria-label="颜色 ${c}"></button>`).join('')}
              </div>
            </div>
            <div class="modal-conflict ok" id="manualConflict">和现有安排不冲突</div>
            <div class="modal-error" id="manualError"></div>
          </div>
          <div class="dialog-foot">
            <button class="btn" data-action="modal-close">取消</button>
            ${editing ? '<button class="btn delete" data-action="manual-delete">删除</button>' : ''}
            <button class="btn primary" data-action="manual-save">保存</button>
          </div>
        </div>
      </div>`);
    const titleInput = $('#manualTitle');
    titleInput?.focus();
    for (const id of ['manualStart', 'manualEnd', 'manualTitle', 'manualNextDay']) {
      $(`#${id}`)?.addEventListener('input', updateManualPreview);
    }
    updateManualPreview();
    dom.modalRoot.dataset.editingId = editing?.id || '';
  }

  function updateManualPreview() {
    const startVal = $('#manualStart')?.value;
    const endVal = $('#manualEnd')?.value;
    const box = $('#manualConflict');
    if (!startVal || !endVal || !box) return;
    const start = toMin(startVal);
    const endDay = $('#manualNextDay')?.checked ? toMin(endVal) + 1440 : toMin(endVal);
    if (endDay <= start) {
      box.className = 'modal-conflict';
      box.textContent = '结束时间要晚于开始时间；如果要跨天，请勾选「结束于次日」。';
      return;
    }
    const editingId = dom.modalRoot.dataset.editingId || '';
    const overlaps = state.schedule.filter((s) => s.planDate === state.date && s.id !== editingId).filter((s) => {
      const r = itemRange(s);
      return r.clippedEnd > r.clippedStart && start < r.clippedEnd && r.clippedStart < endDay;
    });
    if (overlaps.length) {
      box.className = 'modal-conflict';
      box.textContent = `和「${overlaps.map((s) => s.title).join('」「')}」时间重叠，仍然可以保存。`;
    } else {
      box.className = 'modal-conflict ok';
      box.textContent = '和现有安排不冲突。';
    }
  }

  function saveManual() {
    const el = (id) => $(`#${id}`);
    const title = el('manualTitle').value.trim() || '个人安排';
    const startVal = el('manualStart').value;
    const endVal = el('manualEnd').value;
    const error = el('manualError');
    if (!startVal || !endVal) { error.textContent = '请填写开始和结束时间。'; return; }
    const start = toMin(startVal);
    const nextDay = Boolean(el('manualNextDay')?.checked);
    const endDate = nextDay ? addDays(state.date, 1) : state.date;
    const startISO = `${state.date}T${toTimeInput(start)}`;
    const endISO = `${endDate}T${toTimeInput(toMin(endVal))}`;
    if (start < DAY_START) { error.textContent = '开始时间不能早于 00:00。'; return; }
    if (endISO <= startISO) {
      error.textContent = nextDay ? '结束时间要晚于开始时间。' : '结束时间要晚于开始时间；如果要跨天，请勾选「结束于次日」。';
      return;
    }
    const editingId = dom.modalRoot.dataset.editingId || '';
    const editing = editingId ? itemForId(editingId) : null;
    const now = new Date().toISOString();
    const item = editing || {
      id: uid('m'), planDate: state.date, kind: 'manual', activityId: null,
      state: 'going', createdAt: now, updatedAt: now,
    };
    Object.assign(item, {
      planDate: state.date,
      start: startISO,
      end: endISO,
      title,
      venue: el('manualVenue').value.trim(),
      note: el('manualNote').value.trim(),
      color: state.manualColor,
      updatedAt: now,
    });
    if (!editing) state.schedule.push(item);
    saveSchedule();
    closeModal();
    state.revealItemId = item.id;
    renderAll({ revealId: item.id });
    const overlap = conflictPairsFor(state.date).some((p) => p.a.id === item.id || p.b.id === item.id);
    toast(overlap ? '已保存 · 注意时间和现有安排重叠' : `已添加 ${rangeTextOf(item)}`);
  }

  function deleteManual() {
    const id = dom.modalRoot.dataset.editingId;
    if (!id) return;
    askConfirm({
      title: '删除这个安排？',
      text: '只从时间轴上移除，不影响采集活动。',
      okText: '删除',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      removeScheduleItem(id);
      closeModal();
      renderAll();
      toast('已删除');
    });
  }

  // ---------------------------------------------------------------------
  // 月历 / 出发点 / 帮助 / 确认框
  // ---------------------------------------------------------------------
  function openMonthModal() {
    state.monthCursor = monthOf(state.date);
    renderMonthModal();
  }

  function renderMonthModal() {
    const [y, m] = state.monthCursor.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const date = ymd(d);
      const info = DAY_INFO.get(date);
      const dots = info
        ? [...info.areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([id]) => `<i style="background:${AREA.get(id)?.color || '#8e8e93'}"></i>`).join('')
        : '';
      const classes = ['month-cell'];
      if (d.getMonth() !== m - 1) classes.push('other');
      if (date === today) classes.push('today');
      if (date === state.date) classes.push('selected');
      cells.push(`<button class="${classes.join(' ')}" data-action="pick-date" data-date="${date}" title="${fmtDateCN(date)} ${weekdayCN(date)}${info ? ` · ${info.count} 个活动` : ''}">
        <span class="num">${d.getDate()}</span><span class="dots">${dots}</span>
      </button>`);
    }
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog month-dialog" role="dialog" aria-modal="true">
          <div class="month-head">
            <span class="month-title">${y} 年 ${m} 月</span>
            <div class="month-nav">
              <button class="icon-btn" data-action="month-prev" aria-label="上个月"><svg><use href="#i-left"/></svg></button>
              <button class="icon-btn" data-action="month-next" aria-label="下个月"><svg><use href="#i-right"/></svg></button>
            </div>
          </div>
          <div class="month-dow"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
          <div class="month-grid">${cells.join('')}</div>
          <div class="month-foot">
            <button class="btn" data-action="today">今天</button>
            <button class="btn" data-action="modal-close">关闭</button>
          </div>
        </div>
      </div>`);
  }

  function openHomeModal() {
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="dialog-head">
            <h2>出发点</h2>
            <p>活动池的距离从这儿算。原型提供几个 13 号线 / 10 号线附近的预设。</p>
          </div>
          <div class="dialog-body">
            <div class="radio-list">
              ${DATA.homes.map((h) => `
                <label class="radio-item">
                  <input type="radio" name="home" value="${escAttr(h.name)}" ${h.name === state.home.name ? 'checked' : ''}>
                  <span>${esc(h.name)}</span>
                  <span class="note">${esc(h.note || '')}</span>
                </label>`).join('')}
            </div>
          </div>
          <div class="dialog-foot">
            <button class="btn" data-action="modal-close">取消</button>
            <button class="btn primary" data-action="home-save">保存</button>
          </div>
        </div>
      </div>`);
  }

  function saveHome() {
    const picked = $('input[name="home"]:checked', dom.modalRoot);
    if (!picked) return;
    const home = DATA.homes.find((h) => h.name === picked.value);
    if (!home) return;
    state.home = { name: home.name, lat: home.lat, lng: home.lng };
    store.set('dayflow.home.v1', home.name);
    closeModal();
    renderAll();
    toast(`出发点改为 ${home.name}`);
  }

  function openHelp() {
    openModal(`
      <div class="modal-scrim" data-action="modal-close">
        <div class="dialog help-dialog" role="dialog" aria-modal="true">
          <div class="dialog-head"><h2>怎么用 / 这版规则</h2><p>左边是编排主视图，右边是活动池。</p></div>
          <div class="help-body">
            <div class="help-step"><span class="num">1</span><div><b>选一天。</b>顶栏日期、周条、月历都能切；「今天」随时回来。顶栏「日程 / 日历」是两个 tab：左边时间轴在「日程」，原来的卡片浏览版在「日历」，共用同一天的安排。</div></div>
            <div class="help-step"><span class="num">2</span><div><b>框时间窗 + 加活动。</b>「日程」拖左侧时间轴最右侧上下两个圆点框时间窗，可打开「只看装得下」；「日历」直接拖上方横向柱状图框选时间段，按重叠筛选。点活动池任意一行，活动按真实时间落到左侧；再点一次取消。</div></div>
            <div class="help-step"><span class="num">3</span><div><b>加自己的安排。</b>点「手动添加」或时间轴上的空档，填标题和时间；勾「结束于次日」可以跨天。点自己的块可以再改。</div></div>
            <div class="help-step"><span class="num">4</span><div><b>看冲突。</b>勾选活动后，活动池里和已排时间冲突的活动会变灰（仍可点击）；两个冲突块会在时间轴上收窄、左右并排、红色描边，顶部清单写明重叠在哪一段。</div></div>
            <div class="help-step"><span class="num">5</span><div><b>填空档。</b>打开「只看能放进空档」，右侧只剩能完整塞进空白时段的活动；也可以点「一键顺路」。</div></div>
            <div class="help-step"><span class="num">6</span><div><b>收尾。</b>「导出 .ics」把当天时间块写成日历；日程自动存浏览器。</div></div>
            <div class="help-step"><span class="num">7</span><div><b>看地图。</b>「日程」右侧切「地图」，「日历」右上角也有地图。点 marker 可看活动并加入时间表；实心=已排，空心=未排。底图需要联网，加载失败会退回位置示意。</div></div>

            <div class="help-block">
              <h4>规则</h4>
              <ul>
                <li><b>时间轴范围</b>：00:00–24:00，凌晨也能排。活动真实开始/结束时间不会被改；跨天活动在开始日和结束日各显示一段，结束日标「跨天续」。</li>
                <li><b>时间窗</b>：日程在时间轴右侧拖上下两个圆点，可开「只看装得下」；日历直接拖上方横向图表框选。两种方式共用同一个时间窗。</li>
                <li><b>日历图表</b>：横向柱状图按小时显示活动量，会跟随左下角的来源/分类/细分类/成团开关等筛选一起变；框选范围只筛下方卡片，不改变柱子的统计范围，方便再拖回来。预设里新增「深夜」，只保留 20:00 之后开始的活动。分类、细分类、来源的数量和选项也会跟着当前时间窗变化，只列该时段里存在的活动。</li>
                <li><b>细分类</b>：用 SQLite 的 <code>activities.subcategory</code>，包括 KTV、写生、德州扑克、徒步、桌游等；活动池和日历都能筛。细分类下拉会随「分类」和「来源」联动，只列出当前组合下真实存在的细分类（例如 演出 + 美团 → 脱口秀/话剧/相声/戏曲）。</li>
                <li><b>黑名单</b>：活动池/日历里的「黑名单」按钮打开。可以自由添加、改名、删除类型；<b>新加或默认的项都不勾选</b>，只有手动勾选后才从活动池、日历、图表和地图里隐藏。黑名单存 localStorage。</li>
                <li><b>成团概率</b>：日历和日程表只有一个「可能不成团」开关，默认开启。开启时全部显示，「可能不成团」的活动蒙灰并标灰；关闭后直接隐藏这些低概率活动。报名人数（signup_count）0 或 1 人的活动统一按可能不成团处理；已成团、可能已满和 formation 为空的活动正常显示，不蒙灰。</li>
                <li><b>数据库</b>：顶栏「数据库」查看页面快照里的 <code>activities</code> 和 <code>collection_runs</code>；表格支持搜索/来源/细分类筛选。页内是只读快照；点弹窗右上角的「启动并打开实时查看器」会自动检查并启动本地数据库服务，不需要命令行。</li>
                <li><b>开始爬取</b>：顶栏「开始爬取」把各模块拆成独立复选框：粗门、微信群、小红书、美团·课程、美团·演出。点开始后由本地 DayFlowLauncher 在后台顺序运行；完成后系统通知，刷新页面即可看到新快照。当前粗门、微信群、美团·课程、美团·演出可用（课程首次要在专用 Chrome 登录），小红书显示「未实现」并禁用。</li>
                <li><b>顺便可以参加</b>：打开活动详情后异步计算，不阻塞详情。活动候选在 15km 内，**开始前和结束后**都算，允许 ≤30 分钟重叠，按距离/空档/赶场时间/价格综合排名；美团课程来自 <code>course_offers</code>，没有具体上课时间，但会按营业时间判断开场前/结束后能否留出至少 60 分钟（扣除赶场），再按距离和可留时长排名；营业时间未知的保留但靠后，结果折叠展示。自习室来自 <code>study_spots</code>，同样按营业时间/闭馆日/距离推荐；点课程或自习室卡片可看详情。顺便活动里的「可能不成团」会蒙灰；如果已经有 5 个以上更稳的候选，就不显示低概率活动，避免选项太多。</li>
                <li><b>全天活动</b>：徒步/一日游这类全天活动单独归到「全天 · 徒步/一日游」一组，不混进凌晨/上午/下午/晚上；它们仍按真实时间落在时间轴上（例如 00:00–19:00 从 00:00 占到大半天）。</li>
                <li><b>通宵 / 跨天</b>：结束在次日凌晨的活动在当天标「通宵」；当天时间轴按 24:00 截断。日程时间窗结束拖到 24:00 且「只看装得下」时，只要通宵活动的开始时间在窗内，就会按截断后的结束时间计入。若开始时间早于窗起点，仍然不算完整装下（这是「装得下」的严格含义）。</li>
                <li><b>冲突</b>：任意两个块时间重叠就算；活动、手动块一视同仁。时间轴上自动收窄并排；活动池里未排的冲突项变灰。灰色不是禁用，仍然可以点，让你自己决定要不要叠。</li>
                <li><b>手动安排</b>：00:00–23:59，可勾「结束于次日」跨天；标题、地点、备注、颜色都能改。</li>
                <li><b>颜色</b>：采集活动用片区色（国贸红、西直门绿，其他片区自动错开）；手动块用你在弹窗里选的颜色，边框是虚线。</li>
                <li><b>折叠</b>：右侧活动池可以按来源/分类/片区/时段过滤，按距离、价格、时长排序；来源来自 SQLite 的 <code>activities.source</code>（粗门/微信/美团/…）。</li>
                <li><b>地图</b>：Leaflet + 高德栅格瓦片，坐标 GCJ-02 与采集数据一致；原型无 Key，需要联网。日历右上角地图可「放大」全屏，单击 marker 看活动，双击 marker 看详情；地图点会跟随来源/细分类/黑名单/成团开关和日历时间窗一起过滤。</li>
                <li><b>卡片密度</b>：日历卡片只有两行：第一行标题和时间；第二行从来源徽标开始，接地点、片区、直线距离、价格和加入按钮。全天/徒步和各个片区组可展开/收起，全天默认收起，片区默认展开。手机日历把地图放最上面，筛选紧跟地图。</li>
              </ul>
            </div>

            <div class="help-block">
              <h4>新的 SQLite 表</h4>
              <p>M5 写 <code>schedule_items</code>，每条是一个时间块，支持活动与手动安排、任意起止时间、同一天多个块。旧的 <code>plans</code> 保留兼容但不再使用。</p>
              <div class="help-callout" style="margin-top:8px">
                <b>为什么不是 plans？</b><br>
                旧表有 <code>UNIQUE(plan_date, slot)</code>，一个半天只能放一个活动，和连场冲突。新表的唯一约束只在「同一天同一活动」上，时间重叠交给应用层提示。
              </div>
            </div>

            <div class="help-block">
              <h4>原型边界</h4>
              <p>数据是只读快照（<code>prototype-data.js</code>）；日程写 localStorage，刷新还在、清缓存会丢；正式实现读写 <code>schedule_items</code>，并可在服务端做冲突校验。</p>
            </div>
            <div class="dialog-foot" style="padding-left:0;padding-right:0;padding-bottom:0">
              <button class="btn" data-action="modal-close">关闭</button>
            </div>
          </div>
        </div>
      </div>`);
  }

  function askConfirm({ title, text, okText = '确定', danger = false }) {
    return new Promise((resolve) => {
      state.pendingConfirm = resolve;
      openModal(`
        <div class="modal-scrim" data-action="confirm-cancel">
          <div class="dialog" role="dialog" aria-modal="true">
            <div class="dialog-head"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
            <div class="dialog-foot">
              <button class="btn" data-action="confirm-cancel">取消</button>
              <button class="btn ${danger ? 'delete' : 'primary'}" data-action="confirm-ok">${esc(okText)}</button>
            </div>
          </div>
        </div>`);
    });
  }

  function settleConfirm(value) {
    const fn = state.pendingConfirm;
    state.pendingConfirm = null;
    dom.modalRoot.innerHTML = '';
    if (fn) fn(value);
  }

  // ---------------------------------------------------------------------
  // 详情页：顺便可以参加（异步）
  // ---------------------------------------------------------------------
  let nearbyToken = 0;
  let nearbyCourseItems = [];
  let nearbyStudyItems = [];
  let courseLoadPromise = null;

  function loadCourseData() {
    if (Array.isArray(window.DAYFLOW_COURSES)) return Promise.resolve(window.DAYFLOW_COURSES);
    if (courseLoadPromise) return courseLoadPromise;
    courseLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'prototype-courses.js';
      script.async = true;
      script.onload = () => {
        if (Array.isArray(window.DAYFLOW_COURSES)) resolve(window.DAYFLOW_COURSES);
        else reject(new Error('课程快照为空'));
      };
      script.onerror = () => reject(new Error('课程快照未生成'));
      document.head.appendChild(script);
    });
    return courseLoadPromise;
  }

  function nearbyActivityCandidates(a) {
    if (a.lat == null || a.lng == null) return [];
    const aStart = Date.parse(a.start);
    const aEnd = Date.parse(a.end);
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) return [];
    const dates = new Set([a.start.slice(0, 10), a.end.slice(0, 10)]);
    const seen = new Set([a.id]);
    const out = [];
    for (const date of dates) {
      for (const b of actsOn(date)) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        if (b.isFullDay || b.lat == null || b.lng == null) continue;
        if (b.state !== '可报名') continue;
        if (findScheduled(b.id, b.start.slice(0, 10))) continue;
        if (isBlacklisted(b)) continue;
        const bStart = Date.parse(b.start);
        const bEnd = Date.parse(b.end);
        if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) continue;
        let direction = '';
        let overlap = 0;
        let gap = 0;
        if (bStart < aStart) {
          // 开场前：不能把当前活动整个包进去
          if (bEnd > aEnd) continue;
          overlap = Math.max(0, (bEnd - aStart) / 60000);
          gap = Math.max(0, (aStart - bEnd) / 60000);
          direction = 'before';
        } else if (bEnd > aEnd) {
          // 结束后：可以轻微压到下一场开头
          overlap = Math.max(0, (aEnd - bStart) / 60000);
          gap = Math.max(0, (bStart - aEnd) / 60000);
          direction = 'after';
        } else {
          // 完全在当前活动内部，既不是之前也不是之后
          continue;
        }
        if (overlap > 30) continue;
        const dist = kmBetween(a, b);
        if (dist == null || dist > 15) continue;
        const travel = travelMinutes(dist);
        let timing;
        if (overlap > 0) timing = Math.max(0.05, 0.35 - (overlap / 30) * 0.2);
        else if (gap < travel) timing = 0.4;
        else if (gap <= Math.max(90, travel + 30)) timing = 1;
        else if (gap <= 180) timing = 0.82;
        else if (gap <= 300) timing = 0.62;
        else timing = 0.42;
        const proximity = clamp(1 - dist / 15, 0, 1);
        const score = Math.round(proximity * 50 + timing * 45 + (priceValue(b) === 0 ? 5 : 0));
        out.push({ b, dist, travel, gap, overlap, score, direction, formationLow: isFormationLow(b), date: b.start.slice(0, 10) });
      }
    }
    return out.sort((x, y) => y.score - x.score || x.dist - y.dist);
  }

  function parseBusinessHours(text) {
    const raw = String(text || '').trim();
    if (!raw) return { unknown: true, label: '营业时间未知' };
    if (/24\s*小时|全天/.test(raw)) return { allDay: true, open: 0, close: 24 * 60, label: raw };
    const m = raw.match(/(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/);
    if (!m) return { unknown: true, label: raw };
    let open = Number(m[1]) * 60 + Number(m[2]);
    let close = Number(m[3]) * 60 + Number(m[4]);
    if (close <= open) close += 24 * 60;
    return { open, close, label: raw };
  }

  function nearbyCourseCandidates(a, courses) {
    if (a.lat == null || a.lng == null) return [];
    const aStart = dayMin(a.start);
    const aEnd = dayMin(a.end);
    const out = [];
    for (const c of courses) {
      if (c.lat == null || c.lng == null) continue;
      const dist = haversine({ lat: a.lat, lng: a.lng }, { lat: c.lat, lng: c.lng });
      if (dist == null || dist > 15) continue;
      const travel = travelMinutes(dist);
      const h = parseBusinessHours(c.hours);
      let direction = 'unknown';
      let available = null;
      if (h.unknown) {
        // 没有营业时间时仍保留，但排在后面，并标注需确认。
      } else {
        const open = h.open;
        const close = h.close;
        const before = Math.max(0, Math.min(aStart, close) - open - travel);
        const after = Math.max(0, close - Math.max(aEnd, open) - travel);
        const beforeOk = before >= 60;
        const afterOk = after >= 60;
        if (!beforeOk && !afterOk) continue;
        if (afterOk && (!beforeOk || after >= before)) {
          direction = 'after';
          available = after;
        } else {
          direction = 'before';
          available = before;
        }
      }
      const proximity = clamp(1 - dist / 15, 0, 1);
      const timeScore = available == null ? 0.15 : clamp(available / 180, 0, 1);
      const ratingScore = c.rating ? clamp(c.rating / 5, 0, 1) : 0;
      const score = Math.round(proximity * 60 + timeScore * 25 + ratingScore * 10 + (c.price === 0 ? 5 : 0));
      out.push({ c, dist, travel, direction, available, hours: h, score });
    }
    return out.sort((x, y) => y.score - x.score || x.dist - y.dist);
  }

  function nearbyTimeText(item, a) {
    const anchor = item.direction === 'before' ? a.start.slice(0, 10) : a.end.slice(0, 10);
    const prefix = item.date !== anchor ? (item.direction === 'before' ? '前一日 ' : '次日 ') : '';
    return `${prefix}${item.b.start.slice(11, 16)}–${item.b.end.slice(11, 16)}`;
  }

  function nearbyTimingText(item) {
    const side = item.direction === 'before' ? '开场前' : '结束后';
    if (item.overlap > 0) return `${side}重叠 ${Math.round(item.overlap)} 分 · 赶场约 ${item.travel} 分`;
    const tight = item.gap < item.travel;
    return `${side}空档 ${Math.round(item.gap)} 分 · 赶场约 ${item.travel} 分${tight ? ' · 偏紧' : ''}`;
  }

  function renderNearbyActivities(a, token) {
    const box = $('#nearbyActivities');
    if (!box || state.detailId !== a.id || nearbyToken !== token) return;
    const all = nearbyActivityCandidates(a);
    if (!all.length) {
      box.innerHTML = '<div class="nearby-empty">这场前后 15km 内没有合适时间的安排。</div>';
      return;
    }
    const likely = all.filter((x) => !x.formationLow);
    const low = all.filter((x) => x.formationLow);
    const showLow = state.mode === 'calendar' ? state.cal.formationUnlikely : state.pool.formationUnlikely;
    // 有 5 个以上更稳的选择时，低概率活动不再露出；少于 5 个才作为兜底保留并蒙灰。
    const hideLow = !showLow || likely.length >= 5;
    const visible = hideLow ? likely : [...likely, ...low];
    const hiddenLow = hideLow ? low.length : 0;
    if (!visible.length) {
      box.innerHTML = `<div class="nearby-empty">没有更合适的下一场。${hiddenLow ? `已隐藏 ${hiddenLow} 个可能不成团的活动。` : ''}</div>`;
      return;
    }
    const card = (item) => {
      const area = AREA.get(item.b.areaId) || { name: '其他', color: '#8a8f98' };
      return `<button type="button" class="nearby-item ${item.formationLow ? 'is-low-formation' : ''}" data-action="nearby-open" data-id="${escAttr(item.b.id)}">
        <span class="nearby-item-top">
          <span class="nearby-direction ${item.direction}">${item.direction === 'before' ? '开场前' : '结束后'}</span>
          ${item.formationLow ? '<span class="nearby-low-badge">可能不成团</span>' : ''}
          <span class="nearby-item-title">${esc(item.b.title)}</span>
          <span class="nearby-score">顺路 ${item.score}</span>
        </span>
        <span class="nearby-item-meta">${esc(nearbyTimeText(item, a))} · <i style="background:${area.color}"></i>${esc(area.name)} · ${item.dist.toFixed(1)}km</span>
        <span class="nearby-item-meta">${esc(nearbyTimingText(item))} · ${esc(priceText(item.b))}</span>
      </button>`;
    };
    const top = visible.slice(0, 8);
    const rest = visible.slice(8);
    const lowNote = hiddenLow ? ` · 已隐藏 ${hiddenLow} 个可能不成团` : (low.length && !hideLow ? ` · 含 ${low.length} 个可能不成团（灰色）` : '');
    box.innerHTML = `<div class="nearby-sub">开场前 / 结束后 · ${visible.length} 个候选${lowNote}</div>
      <div class="nearby-list">${top.map(card).join('')}</div>
      ${rest.length ? `<details class="nearby-more-list"><summary>还有 ${rest.length} 个候选 · 展开</summary><div class="nearby-list">${rest.map(card).join('')}</div></details>` : ''}`;
  }

  function renderNearbyCourses(a, token, courses) {
    const box = $('#nearbyCourses');
    if (!box || state.detailId !== a.id || nearbyToken !== token) return;
    const items = nearbyCourseCandidates(a, courses);
    if (!items.length) {
      box.innerHTML = '<div class="nearby-empty">15km 内没有找到美团课程。</div>';
      return;
    }
    const top = items.slice(0, 40);
    nearbyCourseItems = top;
    box.innerHTML = `<details class="nearby-courses">
      <summary><span>美团课程 · ${items.length} 门</span><small>15km 内 · 按营业时间 + 距离排</small><b>展开</b></summary>
      <div class="nearby-course-list">${top.map((item, index) => {
        const c = item.c;
        const dist = item.dist;
        const rating = c.rating ? ` · ★${c.rating}` : '';
        const price = c.priceText || (c.price === 0 ? '免费' : c.price != null ? `¥${c.price}` : '价格未知');
        const near = dist <= 3 ? '很近' : '';
        const dir = item.direction === 'before' ? '开场前可去' : item.direction === 'after' ? '结束后可去' : '营业时间需确认';
        const windowText = item.available != null ? ` · ${item.available >= 240 ? '时间充足' : item.available >= 120 ? `可留约 ${Math.round(item.available / 60)} 小时` : `可留约 ${item.available} 分钟`}` : '';
        return `<button type="button" class="nearby-course" data-action="nearby-place" data-kind="course" data-index="${index}">
          <span class="nearby-course-top"><span class="nearby-course-title">${esc(c.name)}</span><span class="nearby-course-dist">${dist.toFixed(1)}km${near ? ' · 很近' : ''}</span></span>
          <span class="nearby-course-meta">${esc(c.venue || '')}${c.district ? ` · ${esc(c.district)}` : ''}</span>
          <span class="nearby-course-meta"><b class="nearby-course-dir ${item.direction}">${dir}</b> · ${esc(price)}${esc(rating)}${c.hours ? ` · 营业 ${esc(c.hours)}` : ''}${windowText}</span>
        </button>`;
      }).join('')}</div>
      ${items.length > top.length ? `<div class="nearby-more">共 ${items.length} 门，展示前 ${top.length} 门。</div>` : ''}
    </details>`;
  }

  let studyLoadPromise = null;
  function loadStudyData() {
    if (Array.isArray(window.DAYFLOW_STUDY)) return Promise.resolve(window.DAYFLOW_STUDY);
    if (studyLoadPromise) return studyLoadPromise;
    studyLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'prototype-study.js';
      script.async = true;
      script.onload = () => {
        if (Array.isArray(window.DAYFLOW_STUDY)) resolve(window.DAYFLOW_STUDY);
        else reject(new Error('自习室快照为空'));
      };
      script.onerror = () => reject(new Error('自习室快照未生成'));
      document.head.appendChild(script);
    });
    return studyLoadPromise;
  }

  function clockMinutes(text) {
    const m = String(text || '').match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function parseStudyHours(s) {
    if (s.is24h) return { allDay: true, open: 0, close: 24 * 60, label: '24小时' };
    let open = clockMinutes(s.open);
    let close = clockMinutes(s.close);
    if (open == null || close == null) {
      const m = String(s.hours || '').match(/(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/);
      if (m) {
        open = Number(m[1]) * 60 + Number(m[2]);
        close = Number(m[3]) * 60 + Number(m[4]);
      }
    }
    if (open == null || close == null) return { unknown: true, label: '营业时间未知' };
    if (close <= open) close += 24 * 60;
    return { open, close, label: s.hours || `${String(Math.floor(open / 60)).padStart(2, '0')}:${String(open % 60).padStart(2, '0')}–${String(Math.floor((close % 1440) / 60)).padStart(2, '0')}:${String(close % 60).padStart(2, '0')}` };
  }

  function studyClosedOn(s, date) {
    if (!s.closedDays) return false;
    const d = parseDate(date);
    return String(s.closedDays).includes(WEEKDAYS[d.getDay()]);
  }

  function nearbyStudyCandidates(a, spots) {
    if (a.lat == null || a.lng == null) return [];
    const aStart = dayMin(a.start);
    const aEnd = dayMin(a.end);
    const startDate = a.start.slice(0, 10);
    const endDate = a.end.slice(0, 10);
    const out = [];
    for (const s of spots) {
      if (s.lat == null || s.lng == null) continue;
      const dist = haversine({ lat: a.lat, lng: a.lng }, { lat: s.lat, lng: s.lng });
      if (dist == null || dist > 15) continue;
      const travel = travelMinutes(dist);
      const h = parseStudyHours(s);
      let direction = 'unknown';
      let available = null;
      if (h.unknown) {
        if (studyClosedOn(s, startDate) || studyClosedOn(s, endDate)) continue;
      } else {
        const closedBefore = studyClosedOn(s, startDate);
        const closedAfter = studyClosedOn(s, endDate);
        const before = closedBefore ? -1 : Math.max(0, Math.min(aStart, h.close) - h.open - travel);
        const after = closedAfter ? -1 : Math.max(0, h.close - Math.max(aEnd, h.open) - travel);
        const beforeOk = before >= 60;
        const afterOk = after >= 60;
        if (!beforeOk && !afterOk) continue;
        if (afterOk && (!beforeOk || after >= before)) {
          direction = 'after';
          available = after;
        } else {
          direction = 'before';
          available = before;
        }
      }
      const proximity = clamp(1 - dist / 15, 0, 1);
      const timeScore = available == null ? 0.15 : clamp(available / 180, 0, 1);
      const quality = s.studyScore != null ? clamp(s.studyScore / 100, 0, 1) : (s.rating ? clamp(s.rating / 5, 0, 1) : 0);
      const score = Math.round(proximity * 60 + timeScore * 25 + quality * 10 + (s.isFree ? 5 : 0));
      out.push({ s, dist, travel, direction, available, hours: h, score });
    }
    return out.sort((x, y) => y.score - x.score || x.dist - y.dist);
  }

  function renderNearbyStudy(a, token, spots) {
    const box = $('#nearbyStudy');
    if (!box || state.detailId !== a.id || nearbyToken !== token) return;
    const items = nearbyStudyCandidates(a, spots);
    if (!items.length) {
      box.innerHTML = '<div class="nearby-empty">15km 内没有合适营业时间的自习室。</div>';
      return;
    }
    const top = items.slice(0, 40);
    nearbyStudyItems = top;
    box.innerHTML = `<details class="nearby-courses nearby-study">
      <summary><span>自习室 · ${items.length} 个</span><small>15km 内 · 按营业时间 + 距离排</small><b>展开</b></summary>
      <div class="nearby-course-list">${top.map((item, index) => {
        const s = item.s;
        const dir = item.direction === 'before' ? '开场前可去' : item.direction === 'after' ? '结束后可去' : '营业时间需确认';
        const price = s.isFree ? '免费' : (s.priceText || '价格未知');
        const quality = s.studyScore != null ? `自习评分 ${s.studyScore}` : (s.rating ? `★${s.rating}` : '');
        const windowText = item.available != null ? ` · ${item.available >= 240 ? '时间充足' : item.available >= 120 ? `可留约 ${Math.round(item.available / 60)} 小时` : `可留约 ${item.available} 分钟`}` : '';
        const tags = [s.quiet, s.wifi ? 'WiFi' : '', s.power ? '插座' : ''].filter(Boolean).join(' · ');
        return `<button type="button" class="nearby-course" data-action="nearby-place" data-kind="study" data-index="${index}">
          <span class="nearby-course-top"><span class="nearby-course-title">${esc(s.name)}</span><span class="nearby-course-dist">${item.dist.toFixed(1)}km${item.dist <= 3 ? ' · 很近' : ''}</span></span>
          <span class="nearby-course-meta">${esc(s.type || '自习室')}${s.district ? ` · ${esc(s.district)}` : ''}${s.businessArea ? ` · ${esc(s.businessArea)}` : ''}${tags ? ` · ${esc(tags)}` : ''}</span>
          <span class="nearby-course-meta"><b class="nearby-course-dir ${item.direction}">${dir}</b> · ${esc(price)}${quality ? ` · ${esc(quality)}` : ''}${s.hours || s.is24h ? ` · 营业 ${esc(s.hours || '24小时')}` : ''}${windowText}</span>
        </button>`;
      }).join('')}</div>
      ${items.length > top.length ? `<div class="nearby-more">共 ${items.length} 个，展示前 ${top.length} 个。</div>` : ''}
    </details>`;
  }

  function nearbyPlaceWindowText(item) {
    if (item.available == null) return '营业时间需确认';
    if (item.available >= 240) return '时间充足';
    if (item.available >= 120) return `可留约 ${Math.round(item.available / 60)} 小时`;
    return `可留约 ${item.available} 分钟`;
  }

  function nearbyPlaceDirection(item) {
    return item.direction === 'before' ? '开场前可去' : item.direction === 'after' ? '结束后可去' : '营业时间需确认';
  }

  function openNearbyPlace(kind, index) {
    const item = kind === 'course' ? nearbyCourseItems[index] : nearbyStudyItems[index];
    if (!item) return;
    const isCourse = kind === 'course';
    const place = isCourse ? item.c : item.s;
    const direction = nearbyPlaceDirection(item);
    const windowText = nearbyPlaceWindowText(item);
    const link = place.link || '';
    const title = place.name || (isCourse ? '美团课程' : '自习室');
    const subtitle = isCourse
      ? [place.venue, place.district].filter(Boolean).join(' · ')
      : [place.type, place.brand, place.district].filter(Boolean).join(' · ');
    const tags = Array.isArray(place.tags) ? place.tags.filter(Boolean).slice(0, 8) : [];
    const rows = [];
    const row = (k, v) => { if (v) rows.push(`<div class="info-row"><span class="k">${esc(k)}</span><div class="v">${esc(v)}</div></div>`); };
    row('距离', `${item.dist.toFixed(1)}km · 赶场约 ${item.travel} 分`);
    row('营业时间', place.hours || (place.is24h ? '24小时营业' : '营业时间未知'));
    if (!isCourse && place.closedDays) row('闭馆日', place.closedDays);
    row('可去时间', `${direction} · ${windowText}`);
    row('价格', isCourse
      ? (place.priceText || (place.price === 0 ? '免费' : place.price != null ? `¥${place.price}` : '价格未知'))
      : (place.isFree ? '免费' : (place.priceText || '价格未知')));
    if (isCourse && place.rating) row('评分', `★${place.rating}`);
    if (!isCourse) {
      if (place.studyScore != null) row('自习评分', String(place.studyScore));
      if (place.rating) row('评分', `★${place.rating}`);
    }
    if (isCourse && place.category) row('分类', place.category);
    if (isCourse && place.audience) row('适合人群', place.audience);
    row('地址', place.address || '');
    if (!isCourse) {
      const facilities = [place.quiet, place.wifi ? 'WiFi' : '', place.power ? '插座' : '', place.seats ? `${place.seats} 个座位` : ''].filter(Boolean).join(' · ');
      if (facilities) row('设施', facilities);
    }
    row('来源', isCourse ? '美团课程' : '自习室数据');
    const desc = isCourse ? (place.description || '') : (place.description || '');
    const html = `<div class="modal-scrim" data-action="modal-close">
      <div class="dialog place-dialog">
        <div class="dialog-head">
          <h2>${esc(title)}</h2>
          <p>${esc(subtitle || (isCourse ? '美团课程' : '自习室'))}</p>
        </div>
        <div class="dialog-body">
          <div class="place-badges">
            <span class="nearby-direction ${item.direction}">${direction}</span>
            <span class="nearby-score">${windowText}</span>
            ${isCourse ? '<span class="badge source" style="--sc:#FFB000">美团课程</span>' : '<span class="badge source" style="--sc:#0A7CFF">自习室</span>'}
          </div>
          <div class="info-list">${rows.join('')}</div>
          ${desc ? `<div class="detail-section"><h4>介绍</h4><div class="detail-desc">${esc(desc)}</div></div>` : ''}
          ${tags.length ? `<div class="detail-section"><h4>标签</h4><div class="place-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>` : ''}
        </div>
        <div class="dialog-foot">
          <button class="btn" data-action="modal-close">关闭</button>
          ${link ? `<a class="btn primary" href="${escAttr(link)}" target="_blank" rel="noopener noreferrer">打开${isCourse ? '美团' : '来源'}</a>` : ''}
        </div>
      </div>
    </div>`;
    dom.modalRoot.innerHTML = html;
  }

  function startNearby(a) {
    const token = ++nearbyToken;
    const actBox = $('#nearbyActivities');
    if (!actBox) return;
    if (a.lat == null || a.lng == null) {
      actBox.innerHTML = '<div class="nearby-empty">这个活动没有坐标，暂时无法找附近的下一场。</div>';
      const courseBox = $('#nearbyCourses');
      if (courseBox) courseBox.innerHTML = '<div class="nearby-empty">没有坐标，无法计算美团课程距离。</div>';
      const studyBox = $('#nearbyStudy');
      if (studyBox) studyBox.innerHTML = '<div class="nearby-empty">没有坐标，无法计算自习室距离。</div>';
      return;
    }
    setTimeout(() => renderNearbyActivities(a, token), 30);
    loadCourseData()
      .then((courses) => renderNearbyCourses(a, token, courses))
      .catch((err) => {
        const box = $('#nearbyCourses');
        if (box && state.detailId === a.id && nearbyToken === token) {
          box.innerHTML = `<div class="nearby-empty">美团课程快照未生成（${esc(err.message)}）。运行 build-data.mjs 后刷新。</div>`;
        }
      });
    loadStudyData()
      .then((spots) => renderNearbyStudy(a, token, spots))
      .catch((err) => {
        const box = $('#nearbyStudy');
        if (box && state.detailId === a.id && nearbyToken === token) {
          box.innerHTML = `<div class="nearby-empty">自习室快照未生成（${esc(err.message)}）。运行 build-data.mjs 后刷新。</div>`;
        }
      });
  }

  // ---------------------------------------------------------------------
  // 活动详情抽屉
  // ---------------------------------------------------------------------
  function openDetail(activityId) {
    if (!ACT.has(activityId)) return;
    state.detailId = activityId;
    renderDetail();
    dom.detailBody.scrollTop = 0;
    dom.detailDrawer.classList.add('show');
    dom.detailDrawer.setAttribute('aria-hidden', 'false');
    dom.scrim.classList.add('show');
  }

  function closeLayers() {
    dom.detailDrawer.classList.remove('show');
    dom.detailDrawer.setAttribute('aria-hidden', 'true');
    dom.scrim.classList.remove('show');
    state.detailId = null;
  }

  function renderDetail() {
    const a = ACT.get(state.detailId);
    if (!a) return;
    const area = AREA.get(a.areaId) || { name: '其他', color: '#8a8f98' };
    const km = distanceKm(a);
    const date = a.start.slice(0, 10);
    const scheduled = findScheduled(a.id, date);
    const link = a.link
      ? `<a class="btn ghost" href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer">打开链接</a>`
      : '<button class="btn ghost" disabled>无链接</button>';
    dom.detailTitle.textContent = a.title;
    dom.detailBody.innerHTML = `
      <div class="detail-badges">
        ${a.isFullDay ? '<span class="badge full">全天</span>' : ''}
        ${stateBadge(a) || '<span class="badge avail">可报名</span>'}
        ${a.category ? `<span class="badge soft">${esc(a.category)}</span>` : ''}
        ${a.formed ? `<span class="badge" style="background:rgba(52,199,89,.12);color:#1a7f37">${esc(a.formed)}</span>` : ''}
        ${scheduled ? '<span class="badge" style="background:rgba(52,199,89,.14);color:#1a7f37">已在时间表</span>' : ''}
      </div>
      <div class="info-list">
        <div class="info-row"><span class="k">时间</span><div class="v">${esc(activityTimeLabel(a))} · ${esc(durationText(a.durationMin))}
          ${a.endEstimated ? '<div class="sub">来源没有提供结束时间，按 2 小时估算。</div>' : ''}
          ${a.isFullDay ? '<div class="sub">全天活动会占掉大半天，时间轴上会显示真实起止。</div>' : ''}</div></div>
        <div class="info-row"><span class="k">日期</span><div class="v">${fmtDateCN(date)} ${weekdayCN(date)}
          ${date !== state.date ? `<button class="text-link" data-action="locate-date" data-date="${date}">在日历中查看 →</button>` : ''}</div></div>
        <div class="info-row"><span class="k">地点</span><div class="v">${esc(a.venue || '待确认')}<div class="sub">${esc(a.address || '')}</div></div></div>
        <div class="info-row"><span class="k">细分类</span><div class="v">${esc(a.subcategory || '未细分')}</div></div>
        <div class="info-row"><span class="k">来源</span><div class="v">${esc(sourceLabel(a.source))}${
          a.groupName ? ` · <span class="group-name" title="采集自这个微信群">${esc(a.groupName)}</span>` : ''
        }</div></div>
        <div class="info-row"><span class="k">成团</span><div class="v">${a.formation ? esc(a.formation) : '<span style="color:var(--muted-2)">未标注 · 默认按可能成团</span>'}</div></div>
        <div class="info-row"><span class="k">报名</span><div class="v">${a.joined ?? 0}${a.capacity ? ` / ${a.capacity}` : ''} 人${a.formation === '可能已满' ? ' · 已满' : ''}</div></div>
        <div class="info-row"><span class="k">距离</span><div class="v"><span class="area-chip"><i style="background:${area.color}"></i>${esc(area.name)}</span>
          <div class="sub">${km == null ? '坐标不可用，未参与距离排序' : `从${esc(state.home.name)}出发直线 ${km.toFixed(1)}km · 约 ${travelMinutes(km)} 分`}</div></div></div>
        <div class="info-row"><span class="k">费用</span><div class="v">${esc(priceText(a))}</div></div>
        ${a.host ? `<div class="info-row"><span class="k">主办</span><div class="v">${esc(a.host)}</div></div>` : ''}
        ${a.capacity || a.joined ? `<div class="info-row"><span class="k">名额</span><div class="v">${a.joined ?? '—'} / ${a.capacity ?? '—'} 人</div></div>` : ''}
        ${scheduled ? `<div class="info-row"><span class="k">已排</span><div class="v">${esc(rangeTextOf(scheduled))}${date === state.date && conflictIdSet(date).has(scheduled.id) ? ' · <span style="color:#b42318">和其他安排重叠</span>' : ''}</div></div>` : ''}
      </div>
      <div class="detail-section nearby-section" id="detailNearby">
        <div class="nearby-head"><h4>顺便可以参加</h4><span>开始前 / 结束后 · 15km 内 · 时间错开优先</span></div>
        <div id="nearbyActivities"><div class="nearby-loading">正在找附近顺路的安排…</div></div>
        <div id="nearbyCourses"><div class="nearby-loading">正在加载美团课程…</div></div>
        <div id="nearbyStudy"><div class="nearby-loading">正在加载附近自习室…</div></div>
      </div>
      ${a.description || a.summary ? `<div class="detail-section"><h4>活动介绍</h4><div class="detail-desc">${esc(a.description || a.summary)}</div></div>` : ''}
      ${a.link ? `<div class="detail-section"><h4>跳转链接</h4><a class="link-box" href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer"><svg><use href="#i-link"/></svg>${esc(a.link)}</a></div>` : ''}
      <div class="detail-section"><div class="plan-saved-note"><svg><use href="#i-info"/></svg>原型：只读快照；加入时间表只存浏览器。</div></div>`;
    dom.detailFoot.innerHTML = `
      ${link}
      <button class="btn ${scheduled ? '' : 'primary'}" data-action="detail-toggle" data-id="${escAttr(a.id)}">${scheduled ? '移出时间表' : '加入时间表'}</button>`;
    startNearby(a);
  }

  // ---------------------------------------------------------------------
  // Toast / 事件
  // ---------------------------------------------------------------------
  let toastTimer = 0;
  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2800);
  }

  function setupEvents() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;

      switch (action) {
        case 'day-prev': selectDate(addDays(state.date, -1)); break;
        case 'day-next': selectDate(addDays(state.date, 1)); break;
        case 'today': selectDate(today); break;
        case 'pick-date': selectDate(target.dataset.date); break;
        case 'set-mode': setMode(target.dataset.mode); break;
        case 'side-view': setSideView(target.dataset.view); break;
        case 'map-toggle-activity': {
          const a = ACT.get(target.dataset.id);
          if (a) toggleActivity(a);
          break;
        }

        case 'cal-today': selectDate(today); break;
        case 'cal-prev-day': selectDate(addDays(state.date, -1)); break;
        case 'cal-next-day': selectDate(addDays(state.date, 1)); break;
        case 'cal-month-prev':
          state.monthCursor = addMonths(state.monthCursor, -1);
          renderCalMonth();
          break;
        case 'cal-month-next':
          state.monthCursor = addMonths(state.monthCursor, 1);
          renderCalMonth();
          break;
        case 'cal-preset':
          state.cal.winStart = Number(target.dataset.start);
          state.cal.winEnd = Number(target.dataset.end);
          state.cal.startAfter = target.dataset.startAfter ? Number(target.dataset.startAfter) : null;
          renderCalendarView();
          break;
        case 'cal-source':
          state.cal.source = target.dataset.source || 'all';
          renderCalendarView();
          break;
        case 'cal-reset':
          state.cal = {
            winStart: 8 * 60, winEnd: 22 * 60, startAfter: null,
            sort: 'distance', group: true, source: 'all', subcategory: 'all', category: 'all',
            bookableOnly: true, formationUnlikely: true, collapsedGroups: new Set(['fullday']),
          };
          renderCalendarView();
          break;
        case 'cal-toggle-group':
          if (state.cal.sort !== 'distance') break;
          state.cal.group = !state.cal.group;
          renderCalendarView();
          break;
        case 'cal-toggle-activity': {
          const a = ACT.get(target.dataset.id);
          if (a) toggleActivity(a);
          break;
        }
        case 'cal-remove-item': {
          const item = itemForId(target.dataset.id);
          if (item) {
            removeScheduleItem(item.id);
            renderAll();
            toast('已移出时间表');
          }
          break;
        }
        case 'cal-open-item': {
          const item = itemForId(target.dataset.id);
          if (!item) break;
          if (item.kind === 'manual') openManualModal({ id: item.id });
          else if (item.activityId && ACT.has(item.activityId)) openDetail(item.activityId);
          break;
        }
        case 'month-open': openMonthModal(); break;
        case 'month-prev':
          state.monthCursor = addMonths(state.monthCursor, -1);
          renderMonthModal();
          break;
        case 'month-next':
          state.monthCursor = addMonths(state.monthCursor, 1);
          renderMonthModal();
          break;

        case 'mobile-pane':
          state.mobilePane = target.dataset.pane;
          renderMobileChrome();
          break;

        case 'manual-add':
          openManualModal();
          break;
        case 'gap-add': {
          const gapStart = Number(target.dataset.start);
          const gapEnd = Number(target.dataset.end);
          const rect = target.getBoundingClientRect();
          const ratio = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
          const raw = gapStart + ratio * (gapEnd - gapStart);
          const start = clamp(Math.round(raw / 15) * 15, gapStart, Math.max(gapStart, gapEnd - 15));
          openManualModal({ start, end: gapEnd });
          break;
        }
        case 'chain': buildChain(); break;
        case 'export-ics': exportCurrent(); break;
        case 'clear-schedule': {
          const dayItems = displayItemsFor(state.date);
          const n = dayItems.length;
          if (!n) { toast('这一天的安排已经是空的'); break; }
          askConfirm({
            title: '清空这一天的安排？',
            text: `会移除 ${n} 个时间块（采集活动 + 手动安排）。活动本身还在活动池里。`,
            okText: '清空',
            danger: true,
          }).then((ok) => {
            if (!ok) return;
            const removeIds = new Set(dayItems.map((s) => s.id));
            state.schedule = state.schedule.filter((s) => !removeIds.has(s.id));
            saveSchedule();
            renderAll({ resetScroll: true });
            toast('已清空这一天');
          });
          break;
        }

        case 'toggle-activity': {
          const a = ACT.get(target.dataset.id);
          if (a) toggleActivity(a);
          break;
        }
        case 'open-detail':
          openDetail(target.dataset.id);
          break;
        case 'block-open': {
          const item = itemForId(target.dataset.id);
          if (!item) break;
          if (item.kind === 'manual') openManualModal({ id: item.id });
          else if (item.activityId && ACT.has(item.activityId)) openDetail(item.activityId);
          else toast('活动已不在数据里');
          break;
        }
        case 'block-remove': {
          const item = itemForId(target.dataset.id);
          if (!item) break;
          removeScheduleItem(item.id);
          renderAll();
          toast('已移出时间表');
          break;
        }
        case 'nearby-open':
          openDetail(target.dataset.id);
          break;
        case 'detail-toggle': {
          const a = ACT.get(target.dataset.id);
          if (a) toggleActivity(a);
          break;
        }
        case 'close-layers': closeLayers(); break;
        case 'locate-date':
          closeLayers();
          selectDate(target.dataset.date);
          break;

        case 'help-open': openHelp(); break;
        case 'home-open': openHomeModal(); break;
        case 'home-save': saveHome(); break;

        case 'nearby-place':
          openNearbyPlace(target.dataset.kind, Number(target.dataset.index));
          break;
        case 'modal-close':
          if (target.classList.contains('modal-scrim') && e.target.closest('.dialog')) break;
          closeModal();
          break;
        case 'confirm-ok': settleConfirm(true); break;
        case 'confirm-cancel':
          if (target.classList.contains('modal-scrim') && e.target.closest('.dialog')) break;
          settleConfirm(false);
          break;

        case 'manual-save': saveManual(); break;
        case 'manual-delete': deleteManual(); break;
        case 'blacklist-open': openBlacklistModal(); break;
        case 'crawl-open': openCrawlModal(); break;
        case 'crawl-select-all': {
          const boxes = $$('.crawl-module input:not(:disabled)', dom.modalRoot);
          const allOn = boxes.length && boxes.every((b) => b.checked);
          boxes.forEach((b) => { b.checked = !allOn; });
          updateCrawlStart();
          break;
        }
        case 'db-open': state.db.page = 0; renderDbModal(); break;
        case 'cal-map-expand': toggleCalendarMapExpand(); break;
        case 'db-table':
          state.db.table = target.dataset.table === 'collection_runs' ? 'collection_runs' : 'activities';
          state.db.page = 0;
          state.db.query = '';
          renderDbModal();
          break;
        case 'db-page':
          state.db.page = clamp(state.db.page + Number(target.dataset.delta || 0), 0, 9999);
          renderDbTable();
          break;
        case 'blacklist-add': addBlacklistFromInput(); break;
        case 'blacklist-remove': removeBlacklist(Number(target.dataset.index)); break;
        case 'pick-color':
          state.manualColor = target.dataset.color;
          $$('.swatch', dom.modalRoot).forEach((s) => s.classList.toggle('active', s.dataset.color === state.manualColor));
          break;
        case 'pool-period': setPool({ period: target.dataset.period }, { resetScroll: true }); break;
        case 'reset-pool':
          state.pool = { ...state.pool, search: '', period: 'all', category: 'all', subcategory: 'all', area: 'all', source: 'all', gapOnly: false, hideScheduled: false, bookableOnly: true, formationUnlikely: true, winStart: 0, winEnd: 24 * 60, fitsTime: false };
          updateTimeWindowUI();
          renderPool();
          break;
        case 'time-window-reset':
          state.pool.winStart = 0;
          state.pool.winEnd = 24 * 60;
          state.pool.fitsTime = false;
          updateTimeWindowUI();
          renderPool();
          break;

        default: break;
      }
    });

    // 活动池筛选
    dom.poolSearch.addEventListener('input', () => {
      state.pool.search = dom.poolSearch.value;
      const top = dom.poolList.scrollTop;
      renderPool();
      dom.poolList.scrollTop = 0;
    });
    dom.poolCategory.addEventListener('change', () => setPool({ category: dom.poolCategory.value }));
    dom.poolArea.addEventListener('change', () => setPool({ area: dom.poolArea.value }));
    dom.poolSubcategory.addEventListener('change', () => setPool({ subcategory: dom.poolSubcategory.value }));
    dom.poolSource.addEventListener('change', () => setPool({ source: dom.poolSource.value }));
    dom.poolSort.addEventListener('change', () => setPool({ sort: dom.poolSort.value }));
    dom.gapOnly.addEventListener('change', () => setPool({ gapOnly: dom.gapOnly.checked }));
    dom.hideScheduled.addEventListener('change', () => setPool({ hideScheduled: dom.hideScheduled.checked }));
    dom.bookableOnly.addEventListener('change', () => setPool({ bookableOnly: dom.bookableOnly.checked }));
    dom.formationUnlikely.addEventListener('change', () => setPool({ formationUnlikely: dom.formationUnlikely.checked }));
    dom.timeFits.addEventListener('change', () => {
      state.pool.fitsTime = dom.timeFits.checked;
      renderPool();
    });

    // 日历 tab 筛选/时间
    dom.modalRoot.addEventListener('change', (e) => {
      if (e.target.matches?.('[data-action="blacklist-toggle"]')) {
        toggleBlacklist(Number(e.target.dataset.index), e.target.checked);
      } else if (e.target.classList?.contains('blacklist-label')) {
        editBlacklist(Number(e.target.dataset.index), e.target.value);
      }
    });
    dom.calCategory.addEventListener('change', () => setCal({ category: dom.calCategory.value }));
    dom.calSubcategory.addEventListener('change', () => setCal({ subcategory: dom.calSubcategory.value }));
    dom.calBookable.addEventListener('change', () => setCal({ bookableOnly: dom.calBookable.checked }));
    dom.calFormationUnlikely.addEventListener('change', () => setCal({ formationUnlikely: dom.calFormationUnlikely.checked }));
    dom.calSort.addEventListener('change', () => {
      state.cal.sort = dom.calSort.value;
      if (state.cal.sort !== 'distance') state.cal.group = false;
      renderCalendarView();
    });

    // 键盘：活动池行 Enter/Space 切换
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('map-expanded')) {
        closeExpandedCalendarMap();
        return;
      }
      if (e.target.id === 'blacklistInput' && e.key === 'Enter') {
        e.preventDefault();
        addBlacklistFromInput();
        return;
      }
      const row = e.target.closest?.('.pool-item');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        const a = ACT.get(row.dataset.id);
        if (a) toggleActivity(a);
        return;
      }
      if (e.key === 'Escape') {
        if (dom.modalRoot.innerHTML) { closeModal(); return; }
        closeLayers();
        dom.workspace.classList.remove('show-pool');
      }
    });

    dom.scrim.addEventListener('click', closeLayers);
    window.addEventListener('resize', () => {
      renderNowLine();
      for (const map of Object.values(mapInstances)) map?.invalidateSize();
    });

    // 每分钟更新“现在”线
    setInterval(() => {
      if (state.date === today) renderNowLine();
    }, 60 * 1000);

    // 点时间轴空白处：交给最上层 gap band；若点到 body 的非块区域，也补一个默认
    dom.timelineBody.addEventListener('click', (e) => {
      if (e.target.closest('.block') || e.target.closest('.gap-band') || e.target.closest('.now-line') || e.target.closest('.time-handle')) return;
      const rect = dom.timelineBody.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < 0 || y > TIMELINE_H) return;
      const minutes = clamp(Math.round((DAY_START + y / PX_PER_MIN) / 15) * 15, DAY_START, 1439);
      openManualModal({ start: minutes, end: Math.min(minutes + 60, 1439) });
    });
  }

  // ---------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------
  function init() {
    renderBlacklistBadges();
    setupEvents();
    setupTimeWindowDrag();
    setupCalBrush();
    setupRangeSelect();
    renderHeader();
    renderWeekbar();
    setMode('calendar');
    setTimeout(() => {
      if (!displayItemsFor(state.date).length) {
        toast('拖上方时间轴图表框选时段 · 点卡片加入时间表');
      }
    }, 700);
  }

  init();
})();
