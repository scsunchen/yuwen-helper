/* ==================================================================
 * 小学语文预习小助手 — GitHub Pages 网页版
 * 纯静态实现，无需构建工具。部署于 GitHub Pages 任意子路径均可运行。
 * ================================================================== */

// 相对路径：兼容 https://<user>.github.io/<repo>/ 这类子路径部署
const DATA = './data/';
const LS_KEY = 'yw_prep_setup_v2';
const LS_PROGRESS = 'yw_prep_progress_v1';   // 学习进度
const LS_STARS = 'yw_prep_stars_v1';         // 收藏的生字
const LS_PINYIN = 'yw_prep_pinyin_v1';       // 课文逐字拼音显示偏好

// ---------- 全局状态 ----------
const state = {
  // 选中项：textbook 存「版本 id」（如 rjb），与展示名解耦
  setup: { textbookId: null, grade: 1, term: '上册' },
  catalog: null,       // 版本清单（data/textbook/textbooks.json）
  versionBook: null,   // 当前版本的册次清单（按需加载）
  book: null,          // 当前册次的目录索引（按需加载）
  lesson: null,        // 当前课文正文
  charTab: 'one',
  writer: null,        // HanziWriter 实例
  loopTimer: null,
  speed: 5,
  charInfoMap: {},     // 册 key -> 字形信息（含笔画）
  metaMap: {},         // 字 -> 轻量信息（拼音/部首/结构/笔画数）
  wordMap: null,       // 字 -> 组词（按年级匹配，data/hanzi/words.json）
  initialMap: null,    // 字 -> 拼音首字母（音序，大写），data/hanzi/initial.json
  pinyinOn: null,      // 课文原文是否开启逐字拼音（低年级默认开，用户可关）
  _audio2: null,       // 课文朗读音频播放器
  versionCache: {},    // 版本 id -> 版本索引（避免重复请求）
  bookCache: {},       // "版本id/册key" -> 册索引（避免重复请求）
  yardCache: {},       // "版本id/册目录" -> 语文园地集合
  progress: {},        // "版本id/课id" -> 'learning' | 'done'
  stars: [],           // 收藏的生字（按收藏时间倒序）
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- 工具 ----------
async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('加载失败: ' + path);
  return r.json();
}

/** 判断某课是否有可学习的生字 */
function hasChars(lesson) {
  if (!lesson) return false;
  return (lesson.classOne || []).length > 0 || (lesson.classTwo || []).length > 0;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 1800);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==================================================================
// 学习进度（localStorage 持久化，与教材设置分开存放）
// ==================================================================
function loadProgress() {
  try {
    state.progress = JSON.parse(localStorage.getItem(LS_PROGRESS) || '{}') || {};
  } catch (e) { state.progress = {}; }
}

function saveProgress() {
  try { localStorage.setItem(LS_PROGRESS, JSON.stringify(state.progress)); } catch (e) {}
}

/** 进度键：版本 + 课文，跨册唯一 */
function progressKey(lessonId) {
  const vid = state.setup.textbookId || '_';
  return `${vid}/${lessonId || (state.lesson && state.lesson.id) || ''}`;
}

function getStatus(lessonId) {
  return state.progress[progressKey(lessonId)] || 'todo';
}

function setStatus(lessonId, status) {
  const k = progressKey(lessonId);
  if (status === 'todo') delete state.progress[k];
  else state.progress[k] = status;
  saveProgress();
}

/** 统计当前册的进度 */
function bookStats() {
  const b = state.book;
  if (!b) return { total: 0, done: 0, learning: 0, todo: 0, pct: 0 };
  let done = 0, learning = 0;
  b.lessons.forEach(l => {
    const s = getStatus(l.id);
    if (s === 'done') done++;
    else if (s === 'learning') learning++;
  });
  const total = b.lessons.length;
  return {
    total, done, learning, todo: total - done - learning,
    pct: total ? Math.round((done + learning * 0.5) / total * 100) : 0,
  };
}

function renderProgress() {
  const s = bookStats();
  $('#progressNum').textContent = `${s.done} / ${s.total}`;
  $('#progressFill').style.width = s.pct + '%';
  $('#cntDone').textContent = s.done;
  $('#cntLearning').textContent = s.learning;
  $('#cntTodo').textContent = s.todo;
  $('#starCount').textContent = state.stars.length;
}

// ==================================================================
// 生字收藏（我的生字本）
// ==================================================================
function loadStars() {
  try {
    state.stars = JSON.parse(localStorage.getItem(LS_STARS) || '[]') || [];
  } catch (e) { state.stars = []; }
  if (!Array.isArray(state.stars)) state.stars = [];
}

function saveStars() {
  try { localStorage.setItem(LS_STARS, JSON.stringify(state.stars)); } catch (e) {}
}

function isStarred(ch) { return state.stars.includes(ch); }

/** 课文拼音显示偏好：默认开（低年级），用户手动关闭后记住 */
function loadPyPref() {
  const v = localStorage.getItem(LS_PINYIN);
  if (v === '0') return false;
  if (v === '1') return true;
  return true;   // 未设置过 → 默认开启
}
function savePyPref(on) {
  try { localStorage.setItem(LS_PINYIN, on ? '1' : '0'); } catch (e) {}
}

function toggleStar(ch) {
  const i = state.stars.indexOf(ch);
  if (i >= 0) state.stars.splice(i, 1);
  else state.stars.unshift(ch);   // 新收藏的排前面
  saveStars();
  return i < 0;                   // true = 本次收藏
}

// ==================================================================
// 朗读：系统语音(Web Speech API)优先 → 在线音频兜底
//   原因：国产浏览器 / 部分安卓机没装中文语音包，
//        speechSynthesis 会以 synthesis-failed 静默失败（无声音）。
// ==================================================================
const SPEECH_OK = typeof window !== 'undefined'
  && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// 在线 TTS（百度翻译发音接口，支持长文本；无需 key）
const TTS_BASE = 'https://fanyi.baidu.com/gettts';
function ttsUrl(text, rate) {
  // rate 0.6~0.9 → spd 2~4（百度 spd 取值 1~5，越大越快）
  const spd = Math.max(1, Math.min(5, Math.round((rate || 0.85) * 5)));
  return `${TTS_BASE}?lan=zh&text=${encodeURIComponent(text)}&spd=${spd}&source=web`;
}

let _voice = null;
let _voiceReady = false;      // 是否已探测到可用中文语音
let _audio = null;            // 在线兜底播放器
let _fallToken = 0;           // 兜底去重令牌

function pickVoice() {
  if (!SPEECH_OK) return null;
  const vs = speechSynthesis.getVoices() || [];
  return vs.find(v => /zh[-_]CN/i.test(v.lang))
      || vs.find(v => /^zh/i.test(v.lang))
      || null;
}
if (SPEECH_OK) {
  _voice = pickVoice();
  _voiceReady = !!_voice;
  // 语音列表异步就绪，就绪后重新挑一次
  const refresh = () => {
    _voice = pickVoice();
    if (_voice) _voiceReady = true;
  };
  speechSynthesis.addEventListener?.('voiceschanged', refresh);
  setTimeout(refresh, 300);
}

/** 停止全部朗读 */
function stopSpeak() {
  try { if (SPEECH_OK) speechSynthesis.cancel(); } catch (e) {}
  if (_audio) {
    try { _audio.pause(); } catch (e) {}
    _audio = null;
  }
}

/** 在线音频兜底播放 */
function speakOnline(text, rate) {
  stopSpeak();
  const token = ++_fallToken;
  try {
    const a = new Audio(ttsUrl(text, rate));
    a.crossOrigin = 'anonymous';
    a.onended = () => { if (_audio === a) _audio = null; };
    a.onerror = () => {
      if (_audio === a) _audio = null;
      if (token === _fallToken) toast('朗读加载失败，请检查网络');
    };
    _audio = a;
    const p = a.play();
    if (p && p.catch) p.catch(() => {
      if (token === _fallToken) toast('请先点击页面任意处再试');
    });
    return true;
  } catch (e) { toast('朗读失败'); return false; }
}

/** 用系统语音播一次；播不出来时调用 fallback（只触发一次） */
function speakLocal(t, r, onFail) {
  let fired = false;
  const once = () => { if (!fired) { fired = true; onFail(); } };
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'zh-CN';
    if (_voice) u.voice = _voice;
    u.rate = r; u.pitch = 1;
    u.onerror = once;
    u.onstart = () => { fired = true; };   // 成功出声就不再兜底
    // 600ms 内仍未开始播放 → 判定引擎缺失
    setTimeout(() => {
      if (!fired && !speechSynthesis.speaking && !speechSynthesis.pending) once();
    }, 600);
    speechSynthesis.speak(u);
  } catch (e) { once(); }
}

/** 朗读文本；优先系统语音，不可用/失败时回退在线音频 */
function speak(text, rate) {
  const t = String(text || '').trim();
  if (!t) return;
  const r = rate || 0.85;
  _fallToken++;   // 作废上一次的兜底
  if (SPEECH_OK) {
    if (!_voice) _voice = pickVoice();
    speakLocal(t, r, () => speakOnline(t, r));
    return;
  }
  speakOnline(t, r);
}

/** 带喇叭图标的朗读按钮 HTML */
function speakBtn(text, cls, title) {
  return `<button class="${cls || 'speak-inline'}" data-speak="${esc(text)}" title="${esc(title || '朗读')}">🔊</button>`;
}

// ---------- 页面切换 ----------
const PAGES = { setup: '#page-setup', home: '#page-home', lesson: '#page-lesson', chars: '#page-chars', stars: '#page-stars' };const TITLES = {
  setup: '教材设置', home: '小学语文预习小助手',
  lesson: '课程讲解', chars: '生字词学习', stars: '我的生字本',
};

function showPage(name) {
  if (state.page !== name) stopSpeak();   // 切页时停掉正在朗读的内容
  Object.entries(PAGES).forEach(([k, sel]) => { $(sel).hidden = (k !== name); });
  $('#pageTitle').textContent = TITLES[name] || '';
  $('#backBtn').hidden = (name === 'setup' || name === 'home');
  $('#setupBtn').hidden = (name === 'setup');
  window.scrollTo(0, 0);
  state.page = name;
}

function goBack() {
  // 离开页面前，先收起可能打开着的笔顺弹层，并停掉朗读音频
  if (!$('#strokeModal').hidden) closeStrokeModal();
  if (state.page === 'lesson' || state.page === 'chars') stopAllAudio();
  if (state.page === 'chars') { showLesson(); }
  else if (state.page === 'stars') { showPage('home'); }
  else if (state.page === 'lesson') {
    showPage('home');
    // 学习状态可能已变化，回首页时刷新进度与列表标记
    renderProgress();
    renderCatalog();
  }
  else { showPage('home'); }
}

// ==================================================================
// 一、设置页
// ==================================================================
function currentVersion() {
  return (state.catalog?.textbooks || []).find(t => t.id === state.setup.textbookId) || null;
}

function renderSetup() {
  const list = state.catalog?.textbooks || [];

  // 教材版本：按「出版社 + 年份」并列展示
  if (!list.length) {
    $('#textbookChips').innerHTML = '<div class="chip disabled">暂无可用版本</div>';
  } else {
    $('#textbookChips').innerHTML = list.map(t => {
      const act = t.id === state.setup.textbookId;
      // 名称已含年份，如「人教部编版 2024年版」
      const sub = t.year && !String(t.name).includes(String(t.year)) ? ` ${t.year}年版` : '';
      return `<div class="chip ${act ? 'active' : ''}" data-textbook="${esc(t.id)}" title="${esc(t.alias || t.name)}">${esc(t.name)}${sub}</div>`;
    }).join('');
  }

  // 版本说明：别名 / 备注
  const ver = currentVersion();
  const noteEl = $('#textbookNote');
  if (noteEl) {
    if (!ver) {
      noteEl.textContent = list.length ? '请选择教材版本与年份' : '暂无可用教材版本';
    } else {
      noteEl.textContent = [ver.publisher, ver.edition, ver.alias, ver.note]
        .filter(Boolean).join(' · ');
    }
  }

  // 未选版本时，年级与册次不渲染，并提示
  const noVersion = !ver;
  $('#gradeChips').innerHTML = noVersion
    ? '<div class="chip disabled">请先选择教材版本</div>'
    : '';
  $('#termChips').innerHTML = noVersion
    ? '<div class="chip disabled">请先选择教材版本</div>'
    : '';

  if (!noVersion) {
    // 年级：以当前版本实际提供的年级为准
    const grades = (ver?.grades || []).slice().sort((a, b) => a - b);
    const gradeList = grades.length ? grades : [1, 2, 3, 4, 5, 6];
    if (!gradeList.includes(state.setup.grade)) state.setup.grade = gradeList[0];
    $('#gradeChips').innerHTML = gradeList.map(g =>
      `<div class="chip ${g === state.setup.grade ? 'active' : ''}" data-grade="${g}">${g}年级</div>`
    ).join('');

    // 册次
    $('#termChips').innerHTML = ['上册', '下册'].map(t =>
      `<div class="chip ${t === state.setup.term ? 'active' : ''}" data-term="${t}">${t}</div>`
    ).join('');
  }

  // 可用性提示（册次清单来自已加载的版本索引）
  const warn = $('#setupWarn');
  if (warn) {
    const key = `${state.setup.grade}-${state.setup.term === '上册' ? 1 : 2}`;
    const books = state.versionBook?.books || [];
    const has = books.some(b => b.key === key);
    // 版本索引尚未加载完时不做判断，避免误报
    warn.hidden = has || noVersion || !state.versionBook;
    if (!has && ver && state.versionBook) {
      warn.textContent = `${ver.name} 的 ${state.setup.grade}年级${state.setup.term} 数据尚未收录`;
    }
  }

  // 「开始预习」：未选版本时不可点
  const btn = $('#saveSetup');
  if (btn) {
    btn.disabled = noVersion;
    btn.textContent = noVersion ? '请先选择教材版本' : '开始预习';
  }
}

/** 选中版本变化时，按需拉取该版本的册次清单并刷新设置页 */
async function onVersionPicked(id) {
  state.setup.textbookId = id;
  state.versionBook = null;
  renderSetup();
  state.versionBook = await loadVersionIndex(id);
  renderSetup();
}

function bindSetupEvents() {
  $('#textbookChips').addEventListener('click', e => {
    const el = e.target.closest('[data-textbook]'); if (!el) return;
    if (el.dataset.textbook === state.setup.textbookId) return;
    onVersionPicked(el.dataset.textbook);
  });
  $('#gradeChips').addEventListener('click', e => {
    const el = e.target.closest('[data-grade]'); if (!el) return;
    state.setup.grade = Number(el.dataset.grade); renderSetup();
  });
  $('#termChips').addEventListener('click', e => {
    const el = e.target.closest('[data-term]'); if (!el) return;
    state.setup.term = el.dataset.term; renderSetup();
  });
  $('#saveSetup').addEventListener('click', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(state.setup));
    showPage('home');
    $('#currentBook').innerHTML = '<div class="loading">正在加载教材数据…</div>';
    $('#catalogList').innerHTML = '';
    await loadBook();
  });
}

// ==================================================================
// 一·B、数据加载（按需）
// ==================================================================

/** 拉取版本清单（应用启动时一次） */
async function loadCatalog() {
  if (state.catalog) return state.catalog;
  const path = `${DATA}textbook/textbooks.json`;
  const asJson = async (p) => {
    const r = await fetch(p);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  state.catalog = await asJson(path);
  // 不做「自动选中第一个版本」的兜底：出版社与年份必须由用户主动确认
  // （版本失效时同理，会在 main() 中被置空并跳转设置页）
  return state.catalog;
}

/** 按需加载当前版本的册次清单 */
async function loadVersionIndex(id) {
  if (!id) return null;
  if (state.versionCache[id]) return state.versionCache[id];
  try {
    const v = await getJSON(`${DATA}textbook/${id}/index.json`);
    state.versionCache[id] = v;
    return v;
  } catch (e) {
    return null;
  }
}

/** 按需加载某一册的目录索引（dir 由调用方显式给出，避免依赖全局状态） */
async function loadBookIndex(versionId, key, dir) {
  if (!versionId) return null;
  const cacheKey = `${versionId}/${key}`;
  if (state.bookCache[cacheKey]) return state.bookCache[cacheKey];
  const useDir = dir || `${state.setup.grade}年级${state.setup.term}`;
  try {
    const b = await getJSON(`${DATA}textbook/${versionId}/${encodeURIComponent(useDir)}/index.json`);
    state.bookCache[cacheKey] = b;
    return b;
  } catch (e) {
    return null;
  }
}

// ==================================================================
// 二、首页 / 课文检索
// ==================================================================
async function loadBook() {
  const vid = state.setup.textbookId;
  if (!vid) { toast('尚未选择教材版本'); return; }

  // 先确保版本索引已就绪（用于年级列表 / 可用性判断）
  state.versionBook = await loadVersionIndex(vid);

  const key = `${state.setup.grade}-${state.setup.term === '上册' ? 1 : 2}`;
  state.book = await loadBookIndex(vid, key, `${state.setup.grade}年级${state.setup.term}`);
  renderCurrentBook();
  renderCatalog();
  renderProgress();
}

function renderCurrentBook() {
  const b = state.book;
  const el = $('#currentBook');
  const ver = currentVersion();
  const vname = ver?.name || '教材';
  if (!b) {
    el.innerHTML = `<span class="book-name">${esc(vname)} ${state.setup.grade}年级${state.setup.term}</span>
                    <span class="book-sub">该册数据暂未收录</span>`;
    return;
  }
  const full = b.lessons.filter(l => !l.stub).length;
  el.innerHTML = `
    <span class="book-name">${esc(b.textbook)} ${b.grade}年级${b.term}</span>
    <span class="book-sub">共 ${b.count} 课 · ${full} 课含完整讲解</span>`;
}

function renderCatalog() {
  const b = state.book;
  const list = $('#catalogList');
  if (!b || !b.lessons.length) {
    list.innerHTML = '<div class="loading">暂无课文数据</div>';
    return;
  }
  // 按单元分组
  const groups = {};
  b.lessons.forEach(l => {
    const u = l.unit || '其他';
    (groups[u] = groups[u] || []).push(l);
  });
  let html = '';
  Object.entries(groups).forEach(([unit, items]) => {
    html += `<div class="section-label">${esc(unit)}</div>`;
    html += items.map(l => lessonItemHTML(l)).join('');
  });
  list.innerHTML = html;
}

function lessonItemHTML(l, keyword) {
  let title = esc(l.title);
  if (keyword) {
    const re = new RegExp('(' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    title = title.replace(re, '<mark>$1</mark>');
  }
  const st = getStatus(l.id);
  const stTag = st === 'done' ? '<span class="li-status st-done">✓ 已掌握</span>'
              : st === 'learning' ? '<span class="li-status st-learning">学习中</span>' : '';
  if (l.kind === 'yard') {
    return `<div class="lesson-item li-yard" data-id="${esc(l.id)}">
      <div class="li-title">📖 ${title}</div>
      <div class="li-unit">语文园地</div>
      <div class="li-badge badge-yard">园地</div>
    </div>`;
  }
  return `<div class="lesson-item ${l.stub ? '' : 'has-content'}" data-id="${esc(l.id)}">
    <div class="li-title">${title}${stTag}</div>
    <div class="li-unit">${esc(l.lessonType || '')}</div>
    <div class="li-badge ${l.stub ? 'badge-stub' : 'badge-full'}">${l.stub ? '待补充' : '有讲解'}</div>
  </div>`;
}

function bindHomeEvents() {
  const input = $('#searchInput');
  input.addEventListener('input', () => {
    const kw = input.value.trim();
    $('#clearSearch').hidden = !kw;
    if (!kw) {
      $('#searchResults').hidden = true;
      $('#catalogView').hidden = false;
      return;
    }
    doSearch(kw);
  });
  $('#clearSearch').addEventListener('click', () => {
    input.value = '';
    $('#clearSearch').hidden = true;
    $('#searchResults').hidden = true;
    $('#catalogView').hidden = false;
  });

  document.addEventListener('click', e => {
    // 朗读按钮（优先判断，避免被父级点击拦截）
    const sp = e.target.closest('[data-speak]');
    if (sp) {
      e.stopPropagation();
      // 再点一次同一个按钮 = 停止
      const playing = sp.classList.contains('speaking');
      document.querySelectorAll('[data-speak].speaking')
        .forEach(b => b.classList.remove('speaking'));
      if (playing) { stopSpeak(); return; }
      sp.classList.add('speaking');
      setTimeout(() => sp.classList.remove('speaking'), 6000);
      speak(sp.dataset.speak, sp.dataset.rate ? parseFloat(sp.dataset.rate) : undefined);
      return;
    }
    // 收藏星标
    const st = e.target.closest('[data-star]');
    if (st) {
      e.stopPropagation();
      const now = toggleStar(st.dataset.star);
      st.classList.toggle('on', now);
      $('#starCount').textContent = state.stars.length;
      toast(now ? '已加入我的生字本 ⭐' : '已取消收藏');
      return;
    }
    const item = e.target.closest('.lesson-item');
    if (item) openLesson(item.dataset.id);
  });
}

/** 我的生字本页面 */
function renderStarsPage() {
  const box = $('#starsContent');
  const n = state.stars.length;
  $('#starCount').textContent = n;
  if (!n) {
    box.className = '';
    box.innerHTML = `<div class="stars-empty">
      还没有收藏的生字<br>
      在「生字词学习」页点生字卡右上角的 ⭐ 就能收藏
    </div>`;
    return;
  }
  box.className = 'char-grid';
  // 用当前册的笔顺数据渲染；缺失时退化为拼音/笔画信息
  box.innerHTML = renderCharCards(state.stars);
  bindStarCards();
  // 音序表可能尚未加载（用户直接进生字本时），加载后补一次音序显示
  if (!state.initialMap) {
    ensureInitialMap().then(() => {
      if (state.page === 'stars' && state.stars.length) {
        box.innerHTML = renderCharCards(state.stars);
        bindStarCards();
      }
    });
  }
}

function bindStarsEvents() {
  const goStars = () => {
    $('#starCount').textContent = state.stars.length;
    renderStarsPage();
    showPage('stars');
  };
  $('#goStarBtn').addEventListener('click', goStars);

  $('#starsClear').addEventListener('click', () => {
    if (!state.stars.length) return;
    if (!confirm('确定要清空「我的生字本」吗？此操作不可撤销。')) return;
    state.stars = [];
    saveStars();
    renderStarsPage();
    $('#starCount').textContent = 0;
    toast('已清空我的生字本');
  });

  $('#starsPlayAll').addEventListener('click', () => {
    if (!state.stars.length) { toast('生字本是空的'); return; }
    if (!SPEECH_OK) { toast('当前浏览器不支持朗读'); return; }
    speak(state.stars.join('、'), 0.7);
  });
}

/** 课文页的学习状态切换 */
function bindStatusEvents() {
  $$('#statusRow .status-btn').forEach(b => {
    b.addEventListener('click', () => {
      const L = state.lesson;
      if (!L) return;
      const next = getStatus(L.id) === b.dataset.status ? 'todo' : b.dataset.status;
      setStatus(L.id, next);
      renderLesson(L);
      toast(next === 'done' ? '已标记为「已掌握」✓'
          : next === 'learning' ? '已标记为「学习中」' : '已重置为「未学」');
    });
  });
  $('#speakTitleBtn').addEventListener('click', () => {
    if (state.lesson) speak(state.lesson.title);
  });
}

async function doSearch(kw) {
  const box = $('#searchResults');
  $('#catalogView').hidden = true;
  box.hidden = false;

  // 先搜当前册（已加载）
  const hits = [];
  const seen = new Set();
  const collect = (b) => {
    if (!b) return;
    b.lessons.forEach(l => {
      if (l.title.includes(kw) && !seen.has(l.id)) {
        seen.add(l.id);
        hits.push({ ...l, book: b });
      }
    });
  };
  collect(state.book);

  const render = (loading) => {
    if (!hits.length) {
      box.innerHTML = loading
        ? `<div class="loading">正在搜索全部册次…</div>`
        : `<div class="loading">没有找到「${esc(kw)}」相关的课文</div>`;
      return;
    }
    hits.sort((a, b) => (a.stub ? 1 : 0) - (b.stub ? 1 : 0));
    box.innerHTML = `<div class="section-label">找到 ${hits.length} 篇相关课文${loading ? '（搜索中…）' : ''}</div>` +
      hits.slice(0, 60).map(h => {
        let title = esc(h.title);
        const re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        title = title.replace(re, '<mark>$1</mark>');
        return `<div class="lesson-item ${h.stub ? '' : 'has-content'}"
          data-id="${esc(h.id)}" data-book="${h.book.key}">
          <div class="li-title">${title}</div>
          <div class="li-unit">${h.book.grade}年级${h.book.term}</div>
          <div class="li-badge ${h.stub ? 'badge-stub' : 'badge-full'}">${h.stub ? '待补充' : '有讲解'}</div>
        </div>`;
      }).join('');
  };

  render(false);

  // 再懒加载同版本其余册次，边搜边补
  const vid = state.setup.textbookId;
  const books = state.versionBook?.books || [];
  const others = books.filter(b => !state.bookCache[`${vid}/${b.key}`]);

  for (const b of others) {
    // 用户可能已改关键词，放弃本次
    if ($('#searchInput').value.trim() !== kw) return;
    // 临时切到目标册以复用 loadBookIndex 的目录解析
    const keep = { grade: state.setup.grade, term: state.setup.term };
    state.setup.grade = b.grade;
    state.setup.term = b.term;
    const idx = await loadBookIndex(vid, b.key, b.dir);
    state.setup.grade = keep.grade;
    state.setup.term = keep.term;
    if (idx) collect(idx);
    render(true);
  }
  render(false);
}

// ==================================================================
// 三、课程讲解页
// ==================================================================
async function openLesson(id, bookKey) {
  // 若来自跨册搜索且册次不同，先切到目标册
  if (bookKey && (!state.book || state.book.key !== bookKey)) {
    const target = (state.versionBook?.books || []).find(b => b.key === bookKey);
    if (target) {
      state.setup.grade = target.grade;
      state.setup.term = target.term;
      localStorage.setItem(LS_KEY, JSON.stringify(state.setup));
      state.book = await loadBookIndex(state.setup.textbookId, bookKey, target.dir);
      renderCurrentBook();
      renderCatalog();
    }
  }
  const b = state.book;
  if (!b) return;
  const meta = b.lessons.find(l => l.id === id);
  if (!meta) return;

  showPage('lesson');
  $('#pageTitle').textContent = meta.title;
  $('#lessonBody').innerHTML = '<div class="loading">加载中</div>';
  $('#goCharsBtn').hidden = true;

  // 语文园地：数据在 yards.json 中，走独立渲染
  if (meta.kind === 'yard') {
    try {
      const yd = await loadYards(b.dir);
      const y = (yd.yards || []).find(x => x.id === id);
      if (!y) throw new Error('未找到该园地内容');
      renderYard(y, meta);
    } catch (err) {
      $('#lessonBody').innerHTML = `<div class="block empty">园地数据加载失败：${esc(err.message)}</div>`;
    }
    return;
  }

  try {
    // 路径完全由「版本 id + 册次目录」决定，不含任何硬编码版本名
    const vid = state.setup.textbookId;
    const lesson = await getJSON(
      `${DATA}textbook/${encodeURIComponent(vid)}/${encodeURIComponent(b.dir)}/${encodeURIComponent(id)}.json`
    );
    state.lesson = lesson;
    renderLesson(lesson);
  } catch (err) {
    $('#lessonBody').innerHTML = `<div class="block empty">课文数据加载失败：${esc(err.message)}</div>`;
  }
}

/** 加载某册的语文园地集合（每册一次，约 30KB） */
async function loadYards(dir) {
  const vid = state.setup.textbookId;
  const key = `${vid}/${dir}`;
  if (state.yardCache[key]) return state.yardCache[key];
  const data = await getJSON(
    `${DATA}textbook/${encodeURIComponent(vid)}/${encodeURIComponent(dir)}/yards.json`
  );
  state.yardCache[key] = data;
  return data;
}

/** 渲染语文园地详情页 */
function renderYard(y, meta) {
  const secName = (s) => esc(s.name);
  const body = (y.sections || []).map(s => {
    let inner = '';
    if (s.type === 'chars') {
      // 仅「识字加油站」的字可点击看笔顺/拼音/组词
      inner = (s.items || []).map(it => {
        if (typeof it === 'string') return `<div class="yd-line">${tapChars(it)}</div>`;
        const words = it.words || '';
        const chars = it.chars || '';
        return `<div class="yd-char-row">
          <span class="yd-words">${tapChars(words)}</span>
          ${chars ? `<span class="yd-chars">${[...chars.replace(/\s/g, '')].map(c =>
            `<span class="yd-char" data-ch="${esc(c)}">${esc(c)}</span>`).join('')}</span>` : ''}
        </div>`;
      }).join('');
    } else if (s.type === 'poem') {
      inner = `<div class="yd-poem">${(s.items || []).map((t, i) =>
        `<div class="${i === 0 ? 'yd-poem-title' : i === 1 ? 'yd-poem-author' : 'yd-poem-line'}">${esc(t)}</div>`
      ).join('')}</div>`;
    } else if (s.type === 'article') {
      inner = (s.items || []).map((t, i) =>
        `<p class="yd-para${i === 0 ? ' yd-art-title' : ''}">${esc(t)}</p>`).join('');
    } else {
      inner = (s.items || []).map(t => `<div class="yd-line">${esc(t)}</div>`).join('');
    }
    if (s.tip) inner += `<div class="yd-tip">${esc(s.tip)}</div>`;
    return `<div class="block yd-block">
      <h3 class="yd-h3">${secName(s)}</h3>
      <div class="yd-body">${inner}</div>
    </div>`;
  }).join('');

  $('#lessonTitle').textContent = y.title;
  $('#lessonType').textContent = '语文园地';
  $('#lessonMeta').textContent = `${meta.unit} · ${state.book?.textbook || ''}`;
  $('#statusRow').hidden = true;
  $('#goCharsBtn').hidden = true;

  $('#lessonBody').innerHTML = body + (y.confidence && y.confidence !== 'high'
    ? `<div class="block empty" style="font-size:12px">部分内容依据网络资料整理，与课本若有出入请以课本为准。</div>` : '');
  bindTapChars();
}

/**
 * 把字符串里的汉字包成可点击的 <span class="tap-ch">（仅用于识字加油站），
 * 点一下就能看笔顺、拼音、部首、组词——与生字卡片一致。
 * 标点、数字、括号等原样保留，不影响排版。
 */
function tapChars(text) {
  if (!text) return '';
  let out = '';
  for (const ch of String(text)) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      out += `<span class="tap-ch" data-ch="${esc(ch)}">${esc(ch)}</span>`;
    } else {
      out += esc(ch);
    }
  }
  return out;
}

/** 绑定园地内所有可点击汉字 */
function bindTapChars() {
  $$('#lessonBody .tap-ch, #lessonBody .yd-char').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', e => {
      e.stopPropagation();
      openStroke(el.dataset.ch);
    });
  });
}

function showLesson() {
  if (state.lesson) {
    $('#pageTitle').textContent = state.lesson.title;
  }
  showPage('lesson');
}

/** 渲染一行带注音的课文：每个汉字上方标拼音，标点原样显示 */
function renderPyLine(pairs) {
  return pairs.map(([ch, py]) => {
    if (!py) return esc(ch);   // 标点等非注音字符
    return `<ruby class="py-ruby">${esc(ch)}<rt class="py-rt">${esc(py)}</rt></ruby>`;
  }).join('');
}

function renderLesson(L) {
  // 换课时先停掉上一课的朗读音频与语音合成，避免后台继续出声
  stopAllAudio();

  // 从语文园地切回课文时，恢复被园地页隐藏的栏目
  $('#statusRow').hidden = false;

  $('#lessonTitle').textContent = L.title;
  $('#lessonType').textContent = L.lessonType || '';
  $('#lessonMeta').textContent =
    `${L.textbook} · ${L.grade}年级${L.term} · ${L.unit || ''}${L.author ? ' · ' + L.author : ''}`;

  // 标题朗读按钮
  const tb = $('#speakTitleBtn');
  tb.hidden = !SPEECH_OK;
  tb.dataset.speak = L.title;

  // 学习状态按钮高亮
  const cur = getStatus(L.id);
  $$('#statusRow .status-btn').forEach(b => {
    b.classList.remove('on-done', 'on-learning');
    if (b.dataset.status === cur) {
      if (cur === 'done') b.classList.add('on-done');
      else if (cur === 'learning') b.classList.add('on-learning');
    }
  });

  const body = $('#lessonBody');

  // 按课文实际数据决定生字入口是否可见
  $('#goCharsBtn').hidden = !hasChars(L);
  // 入口按钮上补一行生字数提示
  if (hasChars(L)) {
    const n1 = (L.classOne || []).length, n2 = (L.classTwo || []).length;
    $('#goCharsBtn').textContent = `查看本课生字词（一类 ${n1} · 二类 ${n2}） ▸`;
  } else {
    $('#goCharsBtn').textContent = '查看本课生字词 ▸';
  }

  if (L.stub) {
    body.innerHTML = `
      <div class="block empty">
        <strong>本课讲解正在整理中</strong><br>
        <span style="font-size:13px">课文原文与逐段解析尚未补充，但本课的<b>生字词学习与笔顺动画</b>已可正常使用。</span>
      </div>
      ${renderCharsEntry(L)}`;
    return;
  }

  let html = '';

  // 课文原文（低年级可叠加逐字拼音）
  if (L.text && L.text.length) {
    const fullText = L.text.join('');
    const hasPy = !!(L.pinyin && L.pinyin.length);
    // 首次进入有拼音的课文时默认开启；用户手动切换后持久化，以其选择为准
    if (hasPy && state.pinyinOn === null) state.pinyinOn = loadPyPref();
    const pyOn = hasPy && state.pinyinOn;
    html += `<div class="block">
      <h3>课文原文${L.audio ? `<button class="audio-btn" id="audioBtn" data-src="${esc(L.audio)}" title="播放课文朗读音频">▶ 听课文</button>` : ''}${speakBtn(fullText, 'speak-inline', '朗读课文')}</h3>
      ${hasPy ? `<div class="py-toggle">
        <button class="py-switch${state.pinyinOn ? ' on' : ''}" id="pySwitch">${state.pinyinOn ? '隐藏拼音' : '显示拼音'}</button>
        <span class="py-hint">${state.pinyinOn ? '拼音标注与课本一致' : '低年级可开启逐字注音'}</span>
      </div>` : ''}
      <div class="poem ${L.lessonType === '古诗' ? 'center' : ''} ${pyOn ? 'with-py' : ''}">
        ${L.text.map((t, i) => {
          const py = pyOn && L.pinyin[i] ? L.pinyin[i] : null;
          return `<p>${py ? renderPyLine(py) : esc(t)}${speakBtn(t, 'speak-inline', '朗读本句')}</p>`;
        }).join('')}
      </div>
    </div>`;
  }

  // 内容概述
  if (L.summary) {
    html += `<div class="block"><h3>内容概述</h3><p style="margin:0;color:var(--text-sub)">${esc(L.summary)}</p></div>`;
  }

  // 中心思想
  if (L.centerThought) {
    html += `<div class="block"><h3>中心思想</h3><p style="margin:0;color:var(--text-sub)">${esc(L.centerThought)}</p></div>`;
  }

  // 分段解析
  if (L.segments && L.segments.length) {
    html += `<div class="block"><h3>课文解析</h3>
      ${L.segments.map(s => `<div class="seg">
        <div class="seg-text">${esc(s.text)}</div>
        <div class="seg-note">${esc(s.note)}</div>
      </div>`).join('')}</div>`;
  }

  // 句子赏析
  if (L.sentences && L.sentences.length) {
    html += `<div class="block"><h3>重点句子赏析</h3>
      ${L.sentences.map(s => `<div class="sent">
        <div class="sent-q">${esc(s.sentence)}</div>
        <div class="sent-a">${esc(s.analysis)}</div>
      </div>`).join('')}</div>`;
  }

  // 写作特色
  if (L.skills && L.skills.length) {
    html += `<div class="block"><h3>写作特色 / 知识点</h3>
      <div class="skill-tags">${L.skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join('')}</div>
    </div>`;
  }

  // 预习任务
  if (L.homework && L.homework.length) {
    html += `<div class="block"><h3>预习任务</h3>
      <ul class="task-list">${L.homework.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
    </div>`;
  }

  body.innerHTML = html + renderCharsEntry(L);

  // 拼音显示开关（低年级课文）
  const sw = document.getElementById('pySwitch');
  if (sw) {
    sw.addEventListener('click', e => {
      e.stopPropagation();
      state.pinyinOn = !state.pinyinOn;
      savePyPref(state.pinyinOn);
      renderLesson(L);
    });
  }

  // 课文朗读音频（预生成 mp3，音色自然）
  const ab = document.getElementById('audioBtn');
  if (ab) {
    ab.addEventListener('click', e => {
      e.stopPropagation();
      toggleLessonAudio(ab, ab.dataset.src);
    });
  }
}

/** 停止当前课文音频与浏览器语音合成（换课/离开课文时调用） */
function stopAllAudio() {
  const a = state._audio2;
  if (a) {
    try { a.pause(); } catch (e) {}
    state._audio2 = null;
  }
  try { if (SPEECH_OK) speechSynthesis.cancel(); } catch (e) {}
}

/** 课文音频播放：同一按钮在播放/暂停之间切换 */
function toggleLessonAudio(btn, src) {
  if (!src) return;
  // 与 Audio.src 做同源规范化比较（浏览器会把中文等编码成 %XX，不能直接 endsWith 原文）
  let abs = src;
  try { abs = new URL(src, location.href).href; } catch (e) {}

  const cur = state._audio2;
  const same = !!(cur && cur.src === abs);

  // 情况一：本课音频正在播放 → 暂停
  if (same && !cur.paused) {
    cur.pause();
    return;
  }
  // 情况二：本课音频处于暂停态 → 接着播
  if (same && cur.paused) {
    cur.play().catch(() => toast('请先点击页面任意处再试'));
    return;
  }

  // 情况三：切换课程/首次播放 → 先停掉旧的，再新建
  stopAllAudio();

  const a = new Audio(src);
  a.preload = 'auto';
  state._audio2 = a;
  const setLabel = (playing) => {
    btn.textContent = playing ? '⏸ 暂停' : '▶ 听课文';
    btn.classList.toggle('playing', playing);
  };
  a.onplay = () => setLabel(true);
  a.onpause = () => setLabel(false);
  a.onended = () => { setLabel(false); if (state._audio2 === a) state._audio2 = null; };
  a.onerror = () => { setLabel(false); if (state._audio2 === a) state._audio2 = null; toast('音频加载失败，请检查网络'); };
  const p = a.play();
  if (p && p.catch) p.catch(() => { setLabel(false); toast('请先点击页面任意处再试'); });
}

/** 课文正文末尾的生字入口区块 */
function renderCharsEntry(L) {
  const n1 = (L.classOne || []).length, n2 = (L.classTwo || []).length;
  if (!n1 && !n2) {
    return `<div class="block empty" style="font-size:13px">本课暂未收录生字数据</div>`;
  }
  return `<div class="block" style="text-align:center">
    <p style="margin:0 0 12px;color:var(--text-sub);font-size:14px">
      本课生字：一类字 ${n1} 个 · 二类字 ${n2} 个
    </p>
    <button class="stroke-entry" onclick="window.__goChars()">查看生字词 + 笔顺动画 ▸</button>
  </div>`;
}

// ==================================================================
// 四、生字词页
// ==================================================================
window.__goChars = function () { renderCharsPage(); };

function bindCharsEvents() {
  $('#goCharsBtn').addEventListener('click', () => renderCharsPage());
}

async function ensureCharInfo(chars) {
  // 按册加载笔顺分片（key 含版本，避免多版本间串数据）
  if (!state.book) return {};
  const vid = state.setup.textbookId || 'default';
  const key = `${vid}/${state.book.key}`;
  if (!state.charInfoMap[key]) {
    try {
      state.charInfoMap[key] = await getJSON(`${DATA}hanzi/strokes/g${state.book.key}.json`);
    } catch (e) {
      state.charInfoMap[key] = {};
    }
  }
  // 兜底：全量 meta（仅拼音/部首/结构/笔画数）
  if (!Object.keys(state.metaMap).length) {
    try { state.metaMap = await getJSON(`${DATA}hanzi/meta.json`); } catch (e) { state.metaMap = {}; }
  }
  // 组词表（全量一次，含按年级匹配的词语）
  await ensureWordMap();
  // 音序表（全量一次，字 -> 拼音首字母大写）
  await ensureInitialMap();
  return state.charInfoMap[key] || {};
}

/** 加载「生字组词」表（全量约 60KB，只请求一次） */
async function ensureWordMap() {
  if (state.wordMap) return state.wordMap;
  try { state.wordMap = await getJSON(`${DATA}hanzi/words.json`); }
  catch (e) { state.wordMap = {}; }
  return state.wordMap;
}

/** 加载「音序」表（全量约 25KB，只请求一次） */
async function ensureInitialMap() {
  if (state.initialMap) return state.initialMap;
  try { state.initialMap = await getJSON(`${DATA}hanzi/initial.json`); }
  catch (e) { state.initialMap = {}; }
  return state.initialMap;
}

/** 取某字的音序首字母（大写），无则返回空串 */
function initialOf(ch) {
  return (state.initialMap && state.initialMap[ch]) || '';
}

/** 取某个字的组词数组（可能为空） */
function wordsOf(ch) {
  const v = state.wordMap && state.wordMap[ch];
  return (v && v.w) ? v.w : [];
}

/** 当前册已加载的笔顺映射 */
function currentStrokeMap() {
  const vid = state.setup.textbookId || 'default';
  return state.charInfoMap[`${vid}/${state.book?.key}`] || {};
}

async function renderCharsPage() {
  const L = state.lesson;
  if (!L) return;
  showPage('chars');
  $('#pageTitle').textContent = `${L.title} · 生字词`;

  // 立刻渲染标签，避免等待期间空白
  renderCharTabs();

  if (state.charTab === 'words') { renderWords(L); return; }

  const chars = state.charTab === 'one' ? (L.classOne || []) : (L.classTwo || []);
  if (!chars.length) {
    $('#charContent').innerHTML = '<div class="block empty">本课暂无该类别生字</div>';
    return;
  }

  // 先用已缓存的 meta 立即出卡片（含拼音/部首/结构/笔画数），
  // 笔顺分片在后台加载，加载完再补全“是否可播放”的标记。
  const ready = Object.keys(currentStrokeMap()).length > 0;
  $('#charContent').innerHTML = `
    <div class="section-label">点击汉字查看拼音、笔画数、笔顺动画</div>
    ${L.charsAuto ? '<div class="auto-note">本课讲解尚未整理，生字表由「本册写字表」自动分配，供预习参考。</div>' : ''}
    ${ready ? '' : '<div class="auto-note" style="background:#f0f6ff;border-left-color:#3a7bd5;color:#2a5298">正在加载本册笔顺数据，稍后即可播放动画…</div>'}
    <div class="char-grid">${renderCharCards(chars)}</div>`;

  bindCharCards();

  // 后台加载笔顺分片
  try {
    await ensureCharInfo();
    // 若仍停留在本页且未切标签，刷新卡片状态
    if (state.page === 'chars' && state.charTab !== 'words') {
      const stillChars = state.charTab === 'one' ? (L.classOne || []) : (L.classTwo || []);
      if (stillChars.join('') === chars.join('')) {
        $('#charContent').innerHTML = `
          <div class="section-label">点击汉字查看拼音、笔画数、笔顺动画</div>
          ${L.charsAuto ? '<div class="auto-note">本课讲解尚未整理，生字表由「本册写字表」自动分配，供预习参考。</div>' : ''}
          <div class="char-grid">${renderCharCards(chars)}</div>`;
        bindCharCards();
      }
    }
  } catch (e) {
    toast('笔顺数据加载失败，拼音与字义仍可查看');
  }
}

/** 渲染生字卡片 HTML */
function renderCharCards(chars) {
  const strokeMap = currentStrokeMap();
  return chars.map(ch => {
    const info = strokeMap[ch] || state.metaMap[ch] || {};
    const py = (info.p || []).length ? info.p[0] : '';
    const n = info.n || (info.st ? info.st.length : '');
    const r = info.r || '';
    const ini = initialOf(ch);
    const hasAnim = !!(strokeMap[ch] && strokeMap[ch].st);
    const ws = wordsOf(ch);
    const wHtml = ws.length
      ? `<div class="cc-words">${ws.map(w =>
          `<span class="cc-word" data-word="${esc(w)}">${esc(w)}</span>`).join('')}</div>`
      : '';
    return `<div class="char-card${hasAnim ? '' : ' no-anim'}" data-char="${esc(ch)}">
      ${SPEECH_OK ? `<button class="char-speak" data-speak="${esc(ch)}" title="朗读">🔊</button>` : ''}
      <button class="char-star${isStarred(ch) ? ' on' : ''}" data-star="${esc(ch)}" title="收藏到我的生字本">⭐</button>
      <div class="cc-pinyin">${esc(py)}</div>
      <div class="cc-char">${esc(ch)}</div>
      <div class="cc-info">${ini ? `<span class="cc-initial" title="音序（字典查字用）">${esc(ini)}</span>` : ''}${n ? n + '画' : ''}${r ? ' · ' + esc(r) : ''}</div>
      <div class="cc-play">✎</div>
      ${wHtml}
    </div>`;
  }).join('');
}

function bindCharCards() {
  $$('#charContent .char-card').forEach(c => {
    c.addEventListener('click', e => {
      // 点在星标 / 朗读 / 组词 等内嵌元素上时，不触发笔顺动画
      if (e.target.closest('[data-star],[data-speak],[data-word]')) return;
      openStroke(c.dataset.char);
    });
  });
  // 组词可单独点读
  $$('#charContent .cc-word').forEach(w => {
    w.addEventListener('click', e => {
      e.stopPropagation();
      speak(w.dataset.word, 0.8);
    });
  });
}

/** 我的生字本里的卡片绑定（同样的规则） */
function bindStarCards() {
  $$('#starsContent .char-card').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('[data-star],[data-speak]')) return;
      openStroke(c.dataset.char);
    });
  });
}

/** 渲染三个标签页并绑定事件 */
function renderCharTabs() {
  const L = state.lesson;
  let playBtn = '';
  if (SPEECH_OK && L) {
    const list = state.charTab === 'one' ? (L.classOne || [])
               : state.charTab === 'two' ? (L.classTwo || [])
               : (L.wordsOne || []).concat(L.wordsTwo || []);
    if (list.length) {
      playBtn = `<button class="tab-play" data-speak="${esc(list.join('、'))}" data-rate="0.7">🔊 依次朗读（${list.length}）</button>`;
    }
  }
  $('#charTabs').innerHTML = `
    <div class="tab ${state.charTab === 'one' ? 'active' : ''}" data-tab="one">一类字（会写）</div>
    <div class="tab ${state.charTab === 'two' ? 'active' : ''}" data-tab="two">二类字（会认）</div>
    <div class="tab ${state.charTab === 'words' ? 'active' : ''}" data-tab="words">词语积累</div>
    ${playBtn}`;
  $$('#charTabs .tab').forEach(t => t.addEventListener('click', () => {
    state.charTab = t.dataset.tab;
    renderCharsPage();
  }));
}

function renderWords(L) {
  const groups = [
    { label: '一类词语（要求会写）', words: L.wordsOne || [], cls: 'one' },
    { label: '二类词语（要求会认）', words: L.wordsTwo || [], cls: 'two' },
  ];
  let html = '';
  groups.forEach(g => {
    if (!g.words.length) return;
    html += `<div class="section-label">${g.label}</div><div class="word-list">`;
    html += g.words.map(w => `<div class="word-item"><span class="wi-text">${esc(w)}</span>${speakBtn(w, 'speak-inline', '朗读词语')}</div>`).join('');
    html += '</div><div style="height:16px"></div>';
  });
  $('#charContent').innerHTML = html || '<div class="block empty">本课暂无词语积累</div>';
}

// ==================================================================
// 五、笔顺动画弹层
// ==================================================================
async function openStroke(ch) {
  // 笔顺分片可能尚未就绪（首次点击时后台仍在加载）
  if (!Object.keys(currentStrokeMap()).length) {
    toast('正在加载本册笔顺数据…');
  }
  let strokeMap;
  try {
    strokeMap = await ensureCharInfo();
  } catch (e) {
    strokeMap = currentStrokeMap();
  }
  const info = strokeMap[ch] || state.metaMap[ch];

  if (!info) { toast('暂无「' + ch + '」的字形数据'); return; }

  if (!info.st) {
    toast('正在获取「' + ch + '」的笔顺数据…');
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`);
      const d = await r.json();
      info.st = d.strokes; info.md = d.medians; info.rs = d.radStrokes;
      info.n = d.strokes.length;
    } catch (e) {
      toast('本字笔顺数据暂不可用，请联网后重试');
      return;
    }
  }

  // 没有中线数据时（单文件精简版），由笔画轮廓推导出中线，保证动画可用
  if (!info.md || !info.md.length) {
    info.md = info.st.map(d => deriveMedian(d));
  }

  state._curChar = ch;
  state._curInfo = info;

  $('#strokeCharName').textContent = ch;
  const py = (info.p || []).join(' / ');
  const ini = initialOf(ch);
  $('#strokeMeta').innerHTML =
    `<span class="m-pinyin">${esc(py)}</span>` +
    (ini ? `<span class="m-item m-seq">音序 ${esc(ini)}</span>` : '') + `<br>` +
    `<span class="m-item">${info.n} 画</span>` +
    `<span class="m-item">部首 ${esc(info.r || '—')}</span>` +
    `<span class="m-item">${esc(info.s || '—')}</span>`;

  // 组词（按当前年级匹配）
  const sw = $('#strokeWords');
  const ws = wordsOf(ch);
  if (ws.length) {
    sw.hidden = false;
    sw.innerHTML = `<span class="sw-label">组词</span>` + ws.map(w =>
      `<span class="sw-item" data-word="${esc(w)}">${esc(w)}</span>`).join('') +
      (SPEECH_OK ? `<button class="sw-speak" data-speak="${esc(ws.join('、'))}" data-rate="0.8" title="朗读组词">🔊</button>` : '');
    $$('#strokeWords .sw-item').forEach(el => {
      el.addEventListener('click', () => speak(el.dataset.word, 0.8));
    });
  } else {
    sw.hidden = true;
    sw.innerHTML = '';
  }

  $('#strokeModal').hidden = false;

  // 销毁旧实例
  if (state.writer) { try { state.writer.cancelQuiz && state.writer.cancelQuiz(); } catch (e) {} }
  clearLoopTimer();
  $('#btnLoop').classList.remove('on');

  rebuildWriter(ch, info);

  // 打开即自动播放一次
  setTimeout(() => state.writer && state.writer.animateCharacter(), 260);

  // 笔画列表
  $('#strokeList').innerHTML = '<div class="stroke-list-label">点击单笔可单独演示：</div>' +
    Array.from({ length: info.n }, (_, i) =>
      `<div class="stroke-chip" data-stroke="${i}">${i + 1}</div>`).join('');
  $$('#strokeList .stroke-chip').forEach(c => {
    c.addEventListener('click', () => {
      clearLoopTimer();
      $('#btnLoop').classList.remove('on');
      state.writer && state.writer.animateStroke(Number(c.dataset.stroke));
    });
  });
}

function rebuildWriter(ch, info) {
  $('#writerTarget').innerHTML = '';
  const charData = { strokes: info.st, medians: info.md || [], radStrokes: info.rs || [] };
  state.writer = HanziWriter.create('writerTarget', ch, {
    width: 200, height: 200, padding: 4,
    strokeColor: '#22262b',
    radicalColor: '#d94f4f',
    highlightColor: '#3a7bd5',
    outlineColor: '#dfe3ea',
    showOutline: true,
    strokeAnimationSpeed: state.speed,
    delayBetweenStrokes: Math.max(60, 420 / state.speed),
    charDataLoader: (c, onComplete) => onComplete(charData),
  });
}

function bindStrokeModal() {
  $('#strokeModal').addEventListener('click', e => {
    if (e.target.dataset.close) closeStrokeModal();
  });

  $('#btnPlay').addEventListener('click', () => {
    if (!state.writer) return;
    clearLoopTimer();
    $('#btnLoop').classList.remove('on');
    state.writer.animateCharacter();
  });

  $('#btnLoop').addEventListener('click', () => {
    if (!state.writer) return;
    const on = $('#btnLoop').classList.toggle('on');
    clearLoopTimer();
    if (on) {
      const play = () => {
        if (!state.writer || !state.loopOn) return;
        state.writer.animateCharacter({
          onComplete: () => {
            if (!state.writer || !state.loopOn) return;
            state.loopTimer = setTimeout(play, 700);
          },
        });
      };
      state.loopOn = true;
      play();
    } else {
      state.loopOn = false;
    }
  });

  $('#btnQuiz').addEventListener('click', () => {
    if (!state.writer) return;
    clearLoopTimer();
    $('#btnLoop').classList.remove('on');
    state.writer.quiz({
      onComplete: () => toast('太棒了，笔顺全对！'),
      onMistake: () => {},
    });
  });

  $('#speedRange').addEventListener('input', e => {
    state.speed = Number(e.target.value);
    $('#speedVal').textContent = state.speed + 'x';
    // 重建实例以应用新速度，并保持当前字
    if (state.writer && state._curChar) {
      clearLoopTimer();
      $('#btnLoop').classList.remove('on');
      rebuildWriter(state._curChar, state._curInfo);
      if (state.writer) state.writer.animateCharacter();
    }
  });
}

/** 统一清理循环定时器 */
function clearLoopTimer() {
  if (state.loopTimer) { clearTimeout(state.loopTimer); state.loopTimer = null; }
  state.loopOn = false;
}

/**
 * 从笔画轮廓路径推导中线点列。
 * 单文件精简版去掉了 medians 字段，这里用轮廓路径的骨架点近似代替，
 * 足以驱动 hanzi-writer 的逐笔裁剪动画。
 */
function deriveMedian(d) {
  const toks = d.match(/[MLQCZmlqcz]|-?\d*\.?\d+/g) || [];
  const pts = [];
  let i = 0, cx = 0, cy = 0;
  const num = () => parseFloat(toks[i++]);
  const push = (x, y) => { if (!pts.length || Math.hypot(x - pts[pts.length - 1][0], y - pts[pts.length - 1][1]) > 8) pts.push([x, y]); };
  while (i < toks.length) {
    const t = toks[i];
    if (t === 'M' || t === 'm') {
      i++; let x = num(), y = num();
      if (t === 'm') { x += cx; y += cy; }
      push(x, y); cx = x; cy = y;
    } else if (t === 'L' || t === 'l') {
      i++; let x = num(), y = num();
      if (t === 'l') { x += cx; y += cy; }
      push(x, y); cx = x; cy = y;
    } else if (t === 'Q' || t === 'q') {
      i++; let qx = num(), qy = num(), x = num(), y = num();
      if (t === 'q') { qx += cx; qy += cy; x += cx; y += cy; }
      push(qx, qy); push(x, y); cx = x; cy = y;
    } else if (t === 'C' || t === 'c') {
      i++; let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      if (t === 'c') { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
      push(x1, y1); push(x2, y2); push(x, y); cx = x; cy = y;
    } else {
      i++;
    }
  }
  return pts.length >= 2 ? pts : [[0, 500], [1024, 500]];
}

function closeStrokeModal() {
  $('#strokeModal').hidden = true;
  clearLoopTimer();
  if (state.writer) { try { state.writer.cancelQuiz(); } catch (e) {} }
  state.writer = null;
  state._curChar = null;
  state._curInfo = null;
  $('#writerTarget').innerHTML = '';
}

// ==================================================================
// 启动
// ==================================================================
async function main() {
  // 1. 拉取版本清单（唯一必须的应用级数据）
  try {
    await loadCatalog();
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#666">数据加载失败：' +
      '请确保通过本地服务器打开本页面（例如 python3 -m http.server），<br>直接双击打开文件可能因浏览器安全限制无法读取数据。</div>';
    return;
  }

  // 2. 读取本地设置（含从 v1 迁移）
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved) {
      if (saved.textbookId) {
        state.setup = { ...state.setup, ...saved };
      } else if (saved.textbook) {
        // 旧版按版本「名称」保存，迁到新版的版本 id
        const hit = (state.catalog.textbooks || []).find(t => t.name === saved.textbook);
        state.setup = {
          textbookId: hit?.id || state.setup.textbookId,
          grade: saved.grade || state.setup.grade,
          term: saved.term || state.setup.term,
        };
      }
    }
  } catch (e) {}

  // 3. 校验已保存的版本是否仍有效（版本可能已下架）
  //    注意：不做「自动选中第一个版本」的兜底——年份必须由用户主动确认
  const ids = (state.catalog.textbooks || []).map(t => t.id);
  if (state.setup.textbookId && !ids.includes(state.setup.textbookId)) {
    state.setup.textbookId = null;
  }

  renderSetup();
  bindSetupEvents();
  bindHomeEvents();
  bindCharsEvents();
  bindStrokeModal();
  bindStatusEvents();
  bindStarsEvents();

  // 载入本地学习数据（进度 + 收藏）
  loadProgress();
  loadStars();

  $('#backBtn').addEventListener('click', goBack);
  $('#setupBtn').addEventListener('click', async () => {
    // 确保版本索引就绪，才能正确显示年级与可用性
    if (!state.versionBook && state.setup.textbookId) {
      state.versionBook = await loadVersionIndex(state.setup.textbookId);
    }
    renderSetup();
    showPage('setup');
  });

  // 4. 未选版本（首次使用，或所存版本已失效）：进入设置页让用户主动选择
  //    此时只加载版本索引（约 4KB），不加载任何册次数据
  if (!state.setup.textbookId) {
    state.versionBook = await loadVersionIndex(state.setup.textbookId);
    renderSetup();
    showPage('setup');
    return;
  }

  // 5. 已有有效设置：按需加载所选版本的那一册
  state.versionBook = await loadVersionIndex(state.setup.textbookId);
  showPage('home');
  $('#currentBook').innerHTML = '<div class="loading">正在加载教材数据…</div>';
  await loadBook();
}

main();

// ==================================================================
// Service Worker：离线可用（GitHub Pages 为 HTTPS，支持 SW）
// ==================================================================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* 注册失败不影响正常使用，仅失去离线能力 */
    });
  });
}
