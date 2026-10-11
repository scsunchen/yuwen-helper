/* ==================================================================
 * 小学语文预习小助手 — GitHub Pages 网页版
 * 纯静态实现，无需构建工具。部署于 GitHub Pages 任意子路径均可运行。
 * ================================================================== */

// 相对路径：兼容 https://<user>.github.io/<repo>/ 这类子路径部署
const DATA = './data/';
const LS_KEY = 'yw_prep_setup_v1';

// ---------- 全局状态 ----------
const state = {
  setup: { textbook: '人教部编版', grade: 1, term: '上册' },
  manifest: null,
  book: null,          // 当前册次
  lesson: null,        // 当前课文
  charTab: 'one',
  writer: null,        // HanziWriter 实例
  loopTimer: null,
  speed: 5,
  charInfoMap: {},     // 字 -> 字形信息（含笔画）
  metaMap: {},         // 字 -> 轻量信息（拼音/部首/结构/笔画数）
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

// ---------- 页面切换 ----------
const PAGES = { setup: '#page-setup', home: '#page-home', lesson: '#page-lesson', chars: '#page-chars' };const TITLES = {
  setup: '教材设置', home: '小学语文预习小助手',
  lesson: '课程讲解', chars: '生字词学习',
};

function showPage(name) {
  Object.entries(PAGES).forEach(([k, sel]) => { $(sel).hidden = (k !== name); });
  $('#pageTitle').textContent = TITLES[name] || '';
  $('#backBtn').hidden = (name === 'setup' || name === 'home');
  $('#setupBtn').hidden = (name === 'setup');
  window.scrollTo(0, 0);
  state.page = name;
}

function goBack() {
  if (state.page === 'chars') { showLesson(); }
  else if (state.page === 'lesson') { showPage('home'); }
  else { showPage('home'); }
}

// ==================================================================
// 一、设置页
// ==================================================================
function renderSetup() {
  // 教材版本
  const textbooks = state.manifest?.textbooks || ['人教部编版'];
  $('#textbookChips').innerHTML = textbooks.map(t =>
    `<div class="chip ${t === state.setup.textbook ? 'active' : ''}" data-textbook="${esc(t)}">${esc(t)}</div>`
  ).join('');

  // 年级
  const grades = [...new Set((state.manifest?.books || []).map(b => b.grade))].sort((a, b) => a - b);
  const gradeList = grades.length ? grades : [1, 2, 3, 4, 5, 6];
  $('#gradeChips').innerHTML = gradeList.map(g =>
    `<div class="chip ${g === state.setup.grade ? 'active' : ''}" data-grade="${g}">${g}年级</div>`
  ).join('');

  // 册次
  $('#termChips').innerHTML = ['上册', '下册'].map(t =>
    `<div class="chip ${t === state.setup.term ? 'active' : ''}" data-term="${t}">${t}</div>`
  ).join('');
}

function bindSetupEvents() {
  $('#textbookChips').addEventListener('click', e => {
    const el = e.target.closest('[data-textbook]'); if (!el) return;
    state.setup.textbook = el.dataset.textbook; renderSetup();
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
    await loadBook();
    showPage('home');
  });
}

// ==================================================================
// 二、首页 / 课文检索
// ==================================================================
async function loadBook() {
  const key = `${state.setup.grade}-${state.setup.term === '上册' ? 1 : 2}`;
  state.book = state.manifest.books.find(b => b.key === key) || null;
  renderCurrentBook();
  renderCatalog();
}

function renderCurrentBook() {
  const b = state.book;
  const el = $('#currentBook');
  if (!b) {
    el.innerHTML = `<span class="book-name">${esc(state.setup.textbook)} ${state.setup.grade}年级${state.setup.term}</span>
                    <span class="book-sub">暂无数据</span>`;
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
  return `<div class="lesson-item ${l.stub ? '' : 'has-content'}" data-id="${esc(l.id)}">
    <div class="li-title">${title}</div>
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
    const item = e.target.closest('.lesson-item');
    if (item) openLesson(item.dataset.id);
  });
}

async function doSearch(kw) {
  // 跨全部册次搜索
  const hits = [];
  state.manifest.books.forEach(b => {
    b.lessons.forEach(l => {
      if (l.title.includes(kw)) hits.push({ ...l, book: b });
    });
  });
  const box = $('#searchResults');
  $('#catalogView').hidden = true;
  box.hidden = false;
  if (!hits.length) {
    box.innerHTML = `<div class="loading">没有找到「${esc(kw)}」相关的课文</div>`;
    return;
  }
  // 完整讲解的排前面
  hits.sort((a, b) => (a.stub ? 1 : 0) - (b.stub ? 1 : 0));
  box.innerHTML = `<div class="section-label">找到 ${hits.length} 篇相关课文</div>` +
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
}

// ==================================================================
// 三、课程讲解页
// ==================================================================
async function openLesson(id, bookKey) {
  // 若来自全局搜索且册次不同，先切换册次
  if (bookKey) {
    const target = state.manifest.books.find(b => b.key === bookKey);
    if (target && (!state.book || state.book.key !== bookKey)) {
      state.setup.grade = target.grade;
      state.setup.term = target.term;
      localStorage.setItem(LS_KEY, JSON.stringify(state.setup));
      await loadBook();
    }
  }
  const b = state.book;
  if (!b) return;
  const meta = b.lessons.find(l => l.id === id);
  if (!meta) return;

  showPage('lesson');
  $('#pageTitle').textContent = meta.title;
  $('#lessonBody').innerHTML = '<div class="loading">加载中</div>';
  // 先按 manifest 粗略判断，加载完课文数据后再精确判断
  $('#goCharsBtn').hidden = true;

  try {
    const lesson = await getJSON(`${DATA}textbook/${encodeURIComponent('人教部编版')}/${encodeURIComponent(b.dir)}/${id}.json`);
    state.lesson = lesson;
    renderLesson(lesson);
  } catch (err) {
    $('#lessonBody').innerHTML = `<div class="block empty">课文数据加载失败：${esc(err.message)}</div>`;
  }
}

function showLesson() {
  if (state.lesson) {
    $('#pageTitle').textContent = state.lesson.title;
  }
  showPage('lesson');
}

function renderLesson(L) {
  $('#lessonTitle').textContent = L.title;
  $('#lessonType').textContent = L.lessonType || '';
  $('#lessonMeta').textContent =
    `${L.textbook} · ${L.grade}年级${L.term} · ${L.unit || ''}${L.author ? ' · ' + L.author : ''}`;

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

  // 课文原文
  if (L.text && L.text.length) {
    html += `<div class="block">
      <h3>课文原文</h3>
      <div class="poem ${L.lessonType === '古诗' ? 'center' : ''}">
        ${L.text.map(t => `<p>${esc(t)}</p>`).join('')}
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
  // 按册加载笔顺分片
  if (!state.book) return {};
  const key = state.book.key;
  if (!state.charInfoMap[key]) {
    try {
      state.charInfoMap[key] = await getJSON(`${DATA}hanzi/strokes/g${key}.json`);
    } catch (e) {
      state.charInfoMap[key] = {};
    }
  }
  // 兜底：全量 meta（仅拼音/部首/结构/笔画数）
  if (!Object.keys(state.metaMap).length) {
    try { state.metaMap = await getJSON(`${DATA}hanzi/meta.json`); } catch (e) { state.metaMap = {}; }
  }
  return state.charInfoMap[key] || {};
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
  const ready = !!state.charInfoMap[state.book?.key];
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
  const strokeMap = state.charInfoMap[state.book?.key] || {};
  return chars.map(ch => {
    const info = strokeMap[ch] || state.metaMap[ch] || {};
    const py = (info.p || []).length ? info.p[0] : '';
    const n = info.n || (info.st ? info.st.length : '');
    const r = info.r || '';
    const hasAnim = !!(strokeMap[ch] && strokeMap[ch].st);
    return `<div class="char-card${hasAnim ? '' : ' no-anim'}" data-char="${esc(ch)}">
      <div class="cc-pinyin">${esc(py)}</div>
      <div class="cc-char">${esc(ch)}</div>
      <div class="cc-info">${n ? n + '画' : ''}${r ? ' · ' + esc(r) : ''}</div>
      <div class="cc-play">✎</div>
    </div>`;
  }).join('');
}

function bindCharCards() {
  $$('#charContent .char-card').forEach(c => {
    c.addEventListener('click', () => openStroke(c.dataset.char));
  });
}

/** 渲染三个标签页并绑定事件 */
function renderCharTabs() {
  $('#charTabs').innerHTML = `
    <div class="tab ${state.charTab === 'one' ? 'active' : ''}" data-tab="one">一类字（会写）</div>
    <div class="tab ${state.charTab === 'two' ? 'active' : ''}" data-tab="two">二类字（会认）</div>
    <div class="tab ${state.charTab === 'words' ? 'active' : ''}" data-tab="words">词语积累</div>`;
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
    html += g.words.map(w => `<div class="word-item"><span class="wi-text">${esc(w)}</span></div>`).join('');
    html += '</div><div style="height:16px"></div>';
  });
  $('#charContent').innerHTML = html || '<div class="block empty">本课暂无词语积累</div>';
}

// ==================================================================
// 五、笔顺动画弹层
// ==================================================================
async function openStroke(ch) {
  // 笔顺分片可能尚未就绪（首次点击时后台仍在加载）
  if (!state.charInfoMap[state.book?.key]) {
    toast('正在加载本册笔顺数据…');
  }
  let strokeMap;
  try {
    strokeMap = await ensureCharInfo();
  } catch (e) {
    strokeMap = state.charInfoMap[state.book?.key] || {};
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
  $('#strokeMeta').innerHTML =
    `<span class="m-pinyin">${esc(py)}</span><br>` +
    `<span class="m-item">${info.n} 画</span>` +
    `<span class="m-item">部首 ${esc(info.r || '—')}</span>` +
    `<span class="m-item">${esc(info.s || '—')}</span>`;

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
  try {
    state.manifest = await getJSON(`${DATA}textbook/manifest.json`);
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#666">数据加载失败：' +
      '请确保通过本地服务器打开本页面（例如 python3 -m http.server），<br>直接双击打开文件可能因浏览器安全限制无法读取数据。</div>';
    return;
  }

  // 读取本地设置
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && saved.grade) state.setup = { ...state.setup, ...saved };
  } catch (e) {}

  renderSetup();
  bindSetupEvents();
  bindHomeEvents();
  bindCharsEvents();
  bindStrokeModal();

  $('#backBtn').addEventListener('click', goBack);
  $('#setupBtn').addEventListener('click', () => { renderSetup(); showPage('setup'); });

  await loadBook();

  // 首次使用（无本地设置）进入设置页
  if (!localStorage.getItem(LS_KEY)) {
    showPage('setup');
  } else {
    showPage('home');
  }
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
