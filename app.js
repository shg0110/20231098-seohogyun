// 다리 공학 실험실 — 화면, 편집기, 연출
(function () {
  'use strict';
  const B = window.Bridge;
  const { MAT, LEVELS } = B;
  const $ = (id) => document.getElementById(id);
  const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');

  // ---------- 테마 (낮 풍경) ----------
  const THEME = {
      bg: '#cfe6f7', sky: ['#9fd0f2', '#e4f2fb'],
      grid: 'rgba(30,60,90,.07)', grid5: 'rgba(30,60,90,.13)',
      terr: '#8a6a4f', terrEdge: '#5b4330', hatch: 'rgba(60,40,25,.18)', grass: '#6aa84f',
      water: 'rgba(48,120,190,.55)', waterLine: 'rgba(230,245,255,.8)',
      tower: '#b9b2a6', towerEdge: '#7d756a',
      ink: '#1d2a36', dim: '#5d7083', accent: '#e8590c', node: '#2b2f36', nodeFill: '#f8f9fa', anchor: '#e8590c',
      mats: { road: ['#3a3f47', 0.30, '#596069'], wood: ['#b5793c', 0.16], steel: ['#7f8fa3', 0.17], cable: ['#2b2f36', 0.06] },
      car: { body: '#e03131', line: '#7a1414', glass: '#bfe1f7', tire: '#22262b', hub: '#ced4da' },
      ghost: 'rgba(232,89,12,.8)', mountains: ['#b7d3e6', '#a3c3d8'],
  };

  // ---------- 저장 ----------
  const store = (() => {
    let data = { designs: {}, best: {}, ai: {} };
    try { data = Object.assign(data, JSON.parse(localStorage.getItem('bridgelab.v1') || '{}')); } catch (e) { }
    return {
      data,
      save() { try { localStorage.setItem('bridgelab.v1', JSON.stringify(data)); } catch (e) { } },
    };
  })();

  // ---------- 상태 ----------
  const S = {
    level: null, design: null, history: [], mat: 'road', tool: 'build',
    mode: 'build', // build | sim
    sim: null, simOf: 'mine', slow: false, stress: false,
    drag: null, hover: null, pointer: null,
    ai: { gen: 0, total: 20, best: null, done: false, worker: null }, peek: false,
    debris: [], sparks: [], shake: 0, resultShown: false,
  };
  const T = () => THEME;

  // ---------- 캔버스 ----------
  const cv = $('c'), mainCtx = cv.getContext('2d');
  let ctx = mainCtx;
  let W = 0, H = 0, DPR = 1;
  const cam = { sc: 40, ox: 0, oy: 0 };
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    fitCamera();
    resizeHero();
  }
  function fitCamera() {
    if (!S.level) return;
    const [x0, x1, y0, y1] = S.level.view;
    const top = W < 820 ? 132 : 72, bottom = 84;
    const aw = W - 24, ah = H - top - bottom;
    cam.sc = Math.min(aw / (x1 - x0), ah / (y1 - y0));
    cam.ox = (W - (x1 - x0) * cam.sc) / 2 - x0 * cam.sc;
    cam.oy = top + (ah - (y1 - y0) * cam.sc) / 2 + y1 * cam.sc;
  }
  const toWorld = (sx, sy) => [(sx - cam.ox) / cam.sc, (cam.oy - sy) / cam.sc];
  const toScreen = (x, y) => [cam.ox + x * cam.sc, cam.oy - y * cam.sc];

  // ---------- 효과음 (WebAudio로 합성) ----------
  let AC = null;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.25, hp = 900) {
    const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
    s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const sfx = {
    place: () => tone(660, 0.07, 'triangle', 0.08),
    remove: () => tone(300, 0.09, 'triangle', 0.08, -120),
    snap: (heavy) => { noise(0.25, heavy ? 0.35 : 0.22, heavy ? 500 : 1400); tone(heavy ? 90 : 160, 0.25, 'sawtooth', 0.06, -60); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, 0, i * 0.09)),
    fail: () => { tone(330, 0.35, 'sawtooth', 0.06, -200); tone(247, 0.45, 'sawtooth', 0.05, -150, 0.15); },
    splash: () => noise(0.6, 0.3, 300),
    ai: () => tone(880, 0.06, 'sine', 0.05),
  };

  // ---------- 편집기 ----------
  const GRID = 0.5, HIT = 0.4;
  function loadLevel(lv) {
    S.level = lv;
    const saved = store.data.designs[lv.id];
    S.design = saved ? JSON.parse(JSON.stringify(saved)) : B.newDesign(lv);
    S.history = []; S.mode = 'build'; S.sim = null; S.debris = []; S.sparks = [];
    S.mat = lv.mats[0]; S.tool = 'build'; S.stress = false; S.peek = false;
    $('lvNo').textContent = String(lv.id).padStart(2, '0');
    $('lvName').textContent = lv.name;
    $('budgetTxt').textContent = won(lv.budget);
    buildToolbar();
    $('cover').classList.add('hidden'); $('hud').classList.remove('hidden'); document.body.classList.add('playing');
    fitCamera(); refreshHud(); startAI(lv);
    showIntro(lv);
  }
  function saveDesign() { store.data.designs[S.level.id] = S.design; store.save(); }
  function pushHistory() { S.history.push(JSON.stringify(S.design)); if (S.history.length > 200) S.history.shift(); }
  function undo() {
    if (!S.history.length) return toast('되돌릴 작업이 없습니다');
    S.design = JSON.parse(S.history.pop()); saveDesign(); refreshHud(); sfx.remove();
  }
  function clearDesign() {
    if (!S.design.members.length) return;
    pushHistory(); S.design = B.newDesign(S.level); saveDesign(); refreshHud(); sfx.remove();
    toast('설계를 모두 지웠습니다\n되돌리기로 복구할 수 있습니다');
  }
  function nearestNode(x, y, r = HIT) {
    let best = -1, bd = r;
    S.design.nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    let t = l2 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - ex * t, py - ay - ey * t);
  }
  function nearestMember(x, y, r = 0.35) {
    let best = -1, bd = r;
    S.design.members.forEach((m, i) => {
      const a = S.design.nodes[m.a], b = S.design.nodes[m.b];
      const d = segDist(x, y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  // 드래그 끝점 계산: 기존 절점 > 격자 스냅 > 최대 길이로 잘라냄
  function dragTarget(from, wx, wy) {
    const a = S.design.nodes[from], max = MAT[S.mat].maxLen;
    let tx, ty, node = nearestNode(wx, wy);
    if (node >= 0 && node !== from) { tx = S.design.nodes[node].x; ty = S.design.nodes[node].y; }
    else { node = -1; tx = Math.round(wx / GRID) * GRID; ty = Math.round(wy / GRID) * GRID; }
    let len = Math.hypot(tx - a.x, ty - a.y), clipped = false;
    if (len > max + 1e-6) {
      // 손가락 방향 그대로 최대 길이 지점에 둔다
      const dx = wx - a.x, dy = wy - a.y, dl = Math.hypot(dx, dy) || 1;
      tx = +(a.x + dx / dl * max).toFixed(2); ty = +(a.y + dy / dl * max).toFixed(2);
      node = nearestNode(tx, ty, 0.12); if (node === from) node = -1;
      if (node >= 0) { tx = S.design.nodes[node].x; ty = S.design.nodes[node].y; }
      len = Math.hypot(tx - a.x, ty - a.y); clipped = true;
    }
    let ok = len >= 0.5, why = '';
    if (!ok) why = '너무 짧습니다';
    if (ok && node < 0 && B.insideTerrain(S.level, tx, ty)) { ok = false; why = '땅 속에는 이음매를 놓을 수 없습니다'; }
    if (ok && node >= 0 && B.hasMember(S.design, from, node)) {
      const m = S.design.members.find(m => (m.a === from && m.b === node) || (m.b === from && m.a === node));
      if (m.mat === S.mat) { ok = false; why = '이미 연결되어 있습니다'; }
    }
    if (ok && len > max + 1e-3) { ok = false; why = `${MAT[S.mat].name} 최대 길이는 ${max}m입니다`; }
    return { tx, ty, node, len, ok, why, clipped };
  }
  function commitDrag(d) {
    const t = dragTarget(d.from, d.wx, d.wy);
    if (!t.ok) { if (t.why && t.len >= 0.5) toast(t.why); return; }
    pushHistory();
    let b = t.node;
    if (b < 0) { S.design.nodes.push({ x: t.tx, y: t.ty, anchor: false }); b = S.design.nodes.length - 1; }
    const old = S.design.members.find(m => (m.a === d.from && m.b === b) || (m.b === d.from && m.a === b));
    if (old) old.mat = S.mat; else S.design.members.push({ a: d.from, b, mat: S.mat });
    saveDesign(); refreshHud(); sfx.place();
  }
  function removeAt(wx, wy) {
    const mi = nearestMember(wx, wy);
    if (mi < 0) return false;
    pushHistory();
    S.design.members.splice(mi, 1);
    pruneNodes(); saveDesign(); refreshHud(); sfx.remove();
    return true;
  }
  function pruneNodes() {
    const d = S.design, used = new Set();
    d.members.forEach(m => { used.add(m.a); used.add(m.b); });
    const map = [], nodes = [];
    d.nodes.forEach((n, i) => { if (n.anchor || used.has(i)) { map[i] = nodes.length; nodes.push(n); } });
    d.members.forEach(m => { m.a = map[m.a]; m.b = map[m.b]; });
    d.nodes = nodes;
  }

  // ---------- 입력 ----------
  cv.addEventListener('pointerdown', (e) => {
    audio();
    if (S.mode !== 'build' || !$('modal').classList.contains('hidden')) return;
    cv.setPointerCapture(e.pointerId);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const erase = S.tool === 'erase' || e.button === 2;
    if (erase) { S.drag = { erase: true }; removeAt(wx, wy); return; }
    const n = nearestNode(wx, wy, e.pointerType === 'touch' ? 0.7 : HIT);
    if (n >= 0) S.drag = { from: n, wx, wy };
    else {
      const mi = nearestMember(wx, wy);
      if (mi >= 0) toast('이음매(동그라미)에서 시작해 끌어당기세요');
      else toast('주황색 고정점이나 흰 이음매에서\n끌어당겨 부재를 놓으세요');
    }
  });
  cv.addEventListener('pointermove', (e) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    S.pointer = [wx, wy];
    if (!S.drag) return;
    if (S.drag.erase) { removeAt(wx, wy); return; }
    S.drag.wx = wx; S.drag.wy = wy;
  });
  const endDrag = () => {
    if (S.drag && !S.drag.erase) commitDrag(S.drag);
    S.drag = null;
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', () => { S.drag = null; });
  cv.addEventListener('pointerleave', () => { S.pointer = null; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => {
    if ($('cover').classList.contains('hidden') === false) return;
    if (!$('modal').classList.contains('hidden')) {
      if (e.key === 'Enter' || e.key === 'Escape') { const b = $('card').querySelector('.btn.primary'); if (b) b.click(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (S.mode === 'build') undo(); return; }
    if (e.key === ' ') { e.preventDefault(); S.mode === 'build' ? startSim('mine') : stopSim(); return; }
    if (S.mode !== 'build') return;
    const i = '1234'.indexOf(e.key);
    if (i >= 0 && S.level.mats[i]) { S.mat = S.level.mats[i]; S.tool = 'build'; buildToolbar(); }
    if (e.key.toLowerCase() === 'e' || e.key === 'Delete' || e.key === 'Backspace') { S.tool = S.tool === 'erase' ? 'build' : 'erase'; buildToolbar(); }
  });

  // ---------- HUD ----------
  function buildToolbar() {
    const bar = $('buildBar'); bar.innerHTML = '';
    S.level.mats.forEach((k, i) => {
      const m = MAT[k], c = T().mats[k][0];
      const b = document.createElement('button');
      b.className = 'tool' + (S.tool === 'build' && S.mat === k ? ' on' : '');
      b.title = `${m.name} (단축키 ${i + 1}) · 최대 ${m.maxLen}m`;
      b.innerHTML = `<i class="sw" style="background:${c}"></i>${m.name}<small>${won(m.cost)}/m</small>`;
      b.onclick = () => { S.mat = k; S.tool = 'build'; buildToolbar(); };
      bar.appendChild(b);
    });
    bar.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
    const mk = (label, sub, on, fn, title) => {
      const b = document.createElement('button'); b.className = 'tool' + (on ? ' on' : '');
      b.innerHTML = `${label}<small>${sub}</small>`; b.title = title || ''; b.onclick = fn; bar.appendChild(b);
    };
    mk('지우기', '부재 삭제', S.tool === 'erase', () => { S.tool = S.tool === 'erase' ? 'build' : 'erase'; buildToolbar(); }, '단축키 E, 마우스 오른쪽 버튼');
    mk('되돌리기', 'Ctrl+Z', false, undo);
    mk('초기화', '전부 지움', false, clearDesign);
    bar.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
    const run = document.createElement('button'); run.className = 'run'; run.textContent = '▶ 시험 주행';
    run.title = '스페이스바'; run.onclick = () => startSim('mine'); bar.appendChild(run);
  }
  function refreshHud() {
    const cost = B.designCost(S.design), lv = S.level;
    $('cost').textContent = won(cost);
    const bar = $('budgetBar');
    bar.querySelector('i').style.width = Math.min(100, cost / lv.budget * 100) + '%';
    bar.classList.toggle('over', cost > lv.budget);
    const sim = S.mode === 'sim';
    $('buildBar').classList.toggle('hidden', sim);
    $('simBar').classList.toggle('hidden', !sim);
    $('status').classList.toggle('hidden', !sim);
    $('legend').classList.toggle('hidden', !(sim && S.stress));
    $('slowBtn').classList.toggle('on', S.slow);
    $('stressBtn2').classList.toggle('on', S.stress);
    $('peekBtn').classList.toggle('on', S.peek);
  }
  let toastT = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900);
  }

  // ---------- AI 엔지니어 ----------
  function startAI(lv) {
    const ai = S.ai;
    if (ai.worker) { ai.worker.terminate(); ai.worker = null; }
    if (ai.timer) { clearTimeout(ai.timer); ai.timer = null; }
    Object.assign(ai, { gen: 0, best: null, done: false, levelId: lv.id });
    $('aiPanel').classList.remove('done');
    $('aiTestBtn').disabled = true;
    const cached = store.data.ai[lv.id];
    if (cached) { Object.assign(ai, { gen: cached.total, total: cached.total, best: cached, done: true }); updateAiPanel(); return; }
    updateAiPanel();
    const onMsg = (d) => {
      if (ai.levelId !== lv.id) return;
      if (d.done) {
        ai.done = true;
        store.data.ai[lv.id] = Object.assign({ total: ai.total }, ai.best); store.save();
        sfx.ai(); toast(`AI가 설계를 마쳤습니다: ${won(ai.best.cost)}`);
      } else {
        ai.gen = d.gen; ai.total = d.total;
        if (d.win) ai.best = { cost: d.cost, maxRatio: d.maxRatio, design: d.design, win: true };
      }
      updateAiPanel();
    };
    try {
      if (location.protocol === 'file:') throw new Error('file');
      const w = new Worker('worker.js');
      w.onmessage = (e) => onMsg(e.data);
      w.onerror = () => { w.terminate(); ai.worker = null; runAIInline(lv, onMsg); };
      w.postMessage({ levelId: lv.id });
      ai.worker = w;
    } catch (e) { runAIInline(lv, onMsg); }
  }
  // Worker를 못 쓰는 환경(파일로 직접 연 경우)에서는 화면 틈틈이 한 세대씩
  function runAIInline(lv, onMsg) {
    const ev = B.createEvolver(lv), total = 20;
    let g = 0;
    const tick = () => {
      if (S.ai.levelId !== lv.id) return;
      const b = g === 0 ? ev.best() : ev.step();
      onMsg({ gen: g, total, cost: b.cost, win: b.win, maxRatio: b.maxRatio, design: b.design });
      g++;
      if (g > total) onMsg({ done: true }); else S.ai.timer = setTimeout(tick, S.mode === 'sim' ? 400 : 30);
    };
    S.ai.timer = setTimeout(tick, 300);
  }
  function updateAiPanel() {
    const ai = S.ai;
    $('aiGen').textContent = ai.done ? '완료' : `${ai.gen}/${ai.total}세대`;
    $('aiBar').style.width = (ai.gen / ai.total * 100) + '%';
    $('aiPanel').classList.toggle('done', ai.done);
    $('aiBest').innerHTML = ai.best ? `최저 <b class="num">${won(ai.best.cost)}</b>` : '통과하는 설계 탐색 중';
    $('aiTestBtn').disabled = !ai.done;
    $('aiTestBtn').style.opacity = ai.done ? 1 : 0.4;
  }
  $('peekBtn').onclick = () => { S.peek = !S.peek; refreshHud(); };
  $('aiTestBtn').onclick = () => { if (S.ai.done && S.ai.best) startSim('ai'); };

  // ---------- 시뮬레이션 ----------
  function startSim(who) {
    if (S.mode === 'sim') stopSim();
    const design = who === 'ai' ? S.ai.best.design : S.design;
    if (who === 'mine' && !design.members.some(m => m.mat === 'road')) return toast('차가 달릴 도로부터 놓아 주세요');
    S.simOf = who; S.sim = B.createSim(S.level, design); S.simDesign = design;
    S.mode = 'sim'; S.drag = null; S.debris = []; S.sparks = []; S.resultShown = false; S.splashed = false;
    refreshHud();
  }
  function stopSim() { S.mode = 'build'; S.sim = null; refreshHud(); }
  $('stopBtn').onclick = stopSim;
  $('slowBtn').onclick = () => { S.slow = !S.slow; refreshHud(); };
  $('stressBtn2').onclick = () => { S.stress = !S.stress; refreshHud(); };

  function simFrame(dt) {
    const s = S.sim; if (!s) return;
    const step = Math.min(dt, 1 / 30) * (S.slow ? 0.25 : 1);
    s.step(step);
    for (const e of s.events.splice(0)) {
      const c = e.c, a = s.P[c.a], b = s.P[c.b];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      for (const [p, q] of [[a, { x: mx, y: my }], [{ x: mx, y: my }, b]]) {
        S.debris.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, vx: (a.vx + b.vx) / 2 + (Math.random() - .5) * 2, vy: (a.vy + b.vy) / 2 + Math.random() * 2,
          w: (Math.random() - .5) * 8, life: 2.2, mat: c.mat });
      }
      for (let i = 0; i < 10; i++) S.sparks.push({ x: mx, y: my, vx: (Math.random() - .5) * 7, vy: Math.random() * 6, life: 0.6 + Math.random() * .4 });
      S.shake = Math.min(0.25, S.shake + (c.mat === 'steel' ? 0.16 : 0.1));
      sfx.snap(c.mat === 'steel');
    }
    const car = s.P[s.base];
    if (!S.splashed && car.y < s.level.water + 0.3 && car.y > s.level.water - 1) {
      S.splashed = true; sfx.splash();
      for (let i = 0; i < 26; i++) S.sparks.push({ x: car.x + Math.random() * 2, y: s.level.water, vx: (Math.random() - .5) * 6, vy: 3 + Math.random() * 6, life: 0.9, water: true });
    }
    // 상태 표시
    const live = s.C.filter(c => !c.broken), worst = live.reduce((m, c) => Math.max(m, Math.abs(c.fs) / c.str), 0);
    $('status').innerHTML = `<span>${S.simOf === 'ai' ? 'AI 설계' : '내 설계'} 주행</span><span>현재 최대 하중<b class="num">${Math.round(Math.min(worst, 1) * 100)}%</b></span><span>끊어진 부재<b class="num">${s.C.length - live.length}</b></span>`;
    if (s.state !== 'run' && !S.resultShown && s.t - s.endT > (s.state === 'win' ? 0.4 : 1.4)) {
      S.resultShown = true; showResult(s);
    }
  }
  function stepFx(dt) {
    for (const d of S.debris) {
      d.vy -= 9.8 * dt; const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
      const ang = d.w * dt, cs = Math.cos(ang), sn = Math.sin(ang);
      const rx1 = d.x1 - cx, ry1 = d.y1 - cy, rx2 = d.x2 - cx, ry2 = d.y2 - cy;
      const ncx = cx + d.vx * dt, ncy = cy + d.vy * dt;
      d.x1 = ncx + rx1 * cs - ry1 * sn; d.y1 = ncy + rx1 * sn + ry1 * cs;
      d.x2 = ncx + rx2 * cs - ry2 * sn; d.y2 = ncy + rx2 * sn + ry2 * cs;
      d.life -= dt;
    }
    S.debris = S.debris.filter(d => d.life > 0);
    for (const p of S.sparks) { p.vy -= 12 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    S.sparks = S.sparks.filter(p => p.life > 0);
    S.shake = Math.max(0, S.shake - dt * 0.8);
  }

  // ---------- 결과 ----------
  function starsFor(lv, cost, win) {
    if (!win || cost > lv.budget) return 0;
    let n = 1;
    if (cost <= lv.budget * 0.8) n = 2;
    const ai = store.data.ai[lv.id];
    if (ai && cost < ai.cost) n = 3;
    return n;
  }
  const starHtml = (n) => [0, 1, 2].map(i => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
  function showResult(s) {
    const lv = S.level, cost = B.designCost(S.simDesign), ai = S.ai.best, aiDone = S.ai.done;
    if (S.simOf === 'ai') {
      return openCard(`
        <h2>${s.state === 'win' ? 'AI 설계 통과' : 'AI 설계 실패'}</h2>
        <p>비용 <b class="num">${won(cost)}</b>, 최대 하중 <b class="num">${Math.round(s.maxRatio * 100)}%</b>입니다.\nAI는 트러스 절점 높이와 재료만 바꿔 가며 최적화했습니다.\n아치·현수교 같은 새로운 구조로 더 싸게 만들 수 있는지 도전해 보세요.</p>
        <div class="acts"><button class="btn primary" data-act="edit">내 설계로 돌아가기</button></div>`);
    }
    const within = cost <= lv.budget, win = s.state === 'win';
    if (win) sfx.win(); else sfx.fail();
    if (win && within) {
      const n = starsFor(lv, cost, true), prev = store.data.best[lv.id];
      if (!prev || cost < prev.cost) { store.data.best[lv.id] = { cost, stars: Math.max(n, prev ? prev.stars : 0), maxRatio: s.maxRatio }; }
      else if (n > prev.stars) prev.stars = n;
      store.save();
    }
    let verdict = '';
    if (win && ai && aiDone) {
      const diff = Math.round((1 - cost / ai.cost) * 100);
      verdict = cost < ai.cost ? `AI보다 ${diff}% 저렴합니다.\n사람의 승리입니다.` : `AI가 ${Math.abs(diff)}% 더 저렴합니다.\n구조를 바꿔 다시 도전해 보세요.`;
    } else if (win && !aiDone) verdict = 'AI가 아직 설계 중입니다.\n끝나면 비교할 수 있습니다.';
    const next = LEVELS.find(l => l.id === lv.id + 1);
    if (win) {
      const n = within ? starsFor(lv, cost, true) : 0;
      openCard(`
        <h2>${within ? '통과했습니다' : '통과했지만 예산 초과'}</h2>
        <div class="bigstars">${starHtml(n)}</div>
        <div class="cmp">
          <div class="${ai && cost < ai.cost ? 'win' : ''}"><div class="k">내 다리</div><div class="v num">${won(cost)}</div><div class="k">최대 하중 ${Math.round(s.maxRatio * 100)}%</div></div>
          <div class="${ai && cost >= ai.cost ? 'win' : ''}"><div class="k">AI 다리</div><div class="v num">${ai ? won(ai.cost) : '계산 중'}</div><div class="k">${ai ? '최대 하중 ' + Math.round(ai.maxRatio * 100) + '%' : `${S.ai.gen}/${S.ai.total}세대`}</div></div>
        </div>
        ${within ? `<div class="verdict">${verdict}</div>` : `<p>예산 ${won(lv.budget)}을 ${won(cost - lv.budget)} 넘었습니다.\n하중 보기에서 여유 있는 부재를 찾아 줄여 보세요.</p>`}
        <p style="margin-top:8px;font-size:12.5px">별 1개는 통과, 2개는 예산의 80% 이하, 3개는 AI보다 싸게 통과입니다.</p>
        <div class="acts"><button class="btn" data-act="edit">설계 다듬기</button>${next ? '<button class="btn primary" data-act="next">다음 단계</button>' : '<button class="btn primary" data-act="cover">모든 단계 완료</button>'}</div>`);
    } else {
      const broken = s.C.filter(c => c.broken).length;
      openCard(`
        <h2>${s.reason}</h2>
        <p>${broken ? `부재 ${broken}개가 하중을 못 견디고 끊어졌습니다.\n주행을 다시 보면서 어디서 처음 끊어지는지 확인하세요.` : '다리가 차를 건너편까지 이어 주지 못했습니다.'}</p>
        <div class="hint">하중 보기를 켜면 빨갛게 변하는 부재가 보입니다.\n그 주변을 삼각형으로 보강하거나 강한 재료로 바꾸세요.</div>
        <div class="acts"><button class="btn" data-act="replay">하중 보며 다시 주행</button><button class="btn primary" data-act="edit">다시 설계하기</button></div>`);
    }
  }
  function openCard(html) {
    $('card').innerHTML = html; $('modal').classList.remove('hidden');
    $('card').querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
  }
  function closeCard() { $('modal').classList.add('hidden'); }
  function act(a) {
    closeCard();
    if (a === 'edit') stopSim();
    if (a === 'replay') { S.stress = true; S.slow = true; startSim('mine'); }
    if (a === 'next') { stopSim(); loadLevel(LEVELS.find(l => l.id === S.level.id + 1)); }
    if (a === 'cover') showCover();
    if (a === 'start') { }
  }
  function showIntro(lv) {
    const sw = lv.mats.map(k => `<span><i style="background:${T().mats[k][0]}"></i>${MAT[k].name} 최대 ${MAT[k].maxLen}m</span>`).join('');
    const first = lv.id === 1 && !store.data.designs[1]?.members?.length;
    openCard(`
      <div class="num" style="color:var(--accent);font-size:13px;margin-bottom:6px">${lv.id}단계 · ${B.VEH[lv.veh].name} ${(B.VEH[lv.veh].mass / 1000).toFixed(1)}톤</div>
      <h2>${lv.name}</h2>
      <p>${lv.desc}</p>
      <div class="hint">${lv.hint}</div>
      <div class="mats">${sw}</div>
      ${first ? `<p style="margin-top:12px;font-size:13px">주황색 고정점이나 흰 이음매에서 끌어당기면 부재가 놓입니다.\n오른쪽 위에서는 AI가 같은 협곡의 설계를 진화시키고 있습니다.</p>` : ''}
      <div class="acts"><button class="btn primary" data-act="start">설계 시작</button></div>`);
  }

  // ---------- 렌더링 ----------
  function worldTransform(shx = 0, shy = 0) {
    ctx.setTransform(DPR * cam.sc, 0, 0, -DPR * cam.sc, DPR * (cam.ox + shx), DPR * (cam.oy + shy));
  }
  function drawBackground() {
    const t = T();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (t.sky) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, t.sky[0]); g.addColorStop(1, t.sky[1]); ctx.fillStyle = g; }
    else ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
  }
  function drawMountains(lv) {
    const t = T(); if (!t.mountains) return;
    const [x0, x1] = lv.view, span = x1 - x0;
    t.mountains.forEach((col, k) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x0 - 5, lv.water);
      for (let i = 0; i <= 40; i++) {
        const x = x0 - 5 + (span + 10) * i / 40;
        const y = 2.5 + k * -1.5 + Math.sin(x * 0.35 + k * 2) * 1.6 + Math.sin(x * 0.9 + k) * 0.6;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(x1 + 5, lv.water); ctx.fill();
    });
  }
  function drawGrid(lv) {
    const t = T(), [x0, x1, y0, y1] = lv.view;
    ctx.lineWidth = 1 / cam.sc;
    for (let x = Math.floor(x0 - 2); x <= x1 + 2; x++) {
      ctx.strokeStyle = x % 5 === 0 ? t.grid5 : t.grid;
      ctx.beginPath(); ctx.moveTo(x, y0 - 3); ctx.lineTo(x, y1 + 3); ctx.stroke();
    }
    for (let y = Math.floor(y0 - 3); y <= y1 + 3; y++) {
      ctx.strokeStyle = y % 5 === 0 ? t.grid5 : t.grid;
      ctx.beginPath(); ctx.moveTo(x0 - 3, y); ctx.lineTo(x1 + 3, y); ctx.stroke();
    }
  }
  function drawWater(lv, time) {
    const t = T(), [x0, x1, y0] = lv.view;
    ctx.fillStyle = t.water;
    ctx.beginPath(); ctx.moveTo(x0 - 4, y0 - 6);
    for (let x = x0 - 4; x <= x1 + 4; x += 0.5) ctx.lineTo(x, lv.water + Math.sin(x * 1.3 + time * 1.6) * 0.08);
    ctx.lineTo(x1 + 4, y0 - 6); ctx.fill();
    ctx.strokeStyle = t.waterLine; ctx.lineWidth = 1.5 / cam.sc;
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 1 - k * 0.3;
      ctx.setLineDash(k ? [0.6, 0.5] : []);
      ctx.beginPath();
      for (let x = x0 - 4; x <= x1 + 4; x += 0.5) {
        const y = lv.water - k * 0.7 + Math.sin(x * 1.3 + time * 1.6 + k) * 0.08;
        x === x0 - 4 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  function drawTerrain(lv) {
    const t = T();
    for (const poly of lv.terrain) {
      ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      ctx.fillStyle = t.terr; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = t.hatch; ctx.lineWidth = 1.2 / cam.sc;
      ctx.beginPath();
      for (let k = -60; k < 80; k += 0.55) { ctx.moveTo(k, -25); ctx.lineTo(k + 30, 5); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = t.terrEdge; ctx.lineWidth = 2 / cam.sc;
      ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
      if (t.grass) {
        // 윗면만 풀
        ctx.strokeStyle = t.grass; ctx.lineWidth = 0.22;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if (Math.abs(a[1] - b[1]) < 1e-6 && a[1] > -10 && Math.abs(a[0] - b[0]) > 1.5) {
            ctx.beginPath(); ctx.moveTo(a[0], a[1] + 0.05); ctx.lineTo(b[0], b[1] + 0.05); ctx.stroke();
          }
        }
      }
    }
  }
  function drawTowers(lv) {
    if (!lv.towers) return;
    const t = T();
    for (const x of lv.towers) {
      ctx.fillStyle = t.tower; ctx.strokeStyle = t.towerEdge; ctx.lineWidth = 1.5 / cam.sc;
      ctx.beginPath(); ctx.rect(x - 0.45, lv.water - 4, 0.9, 7.6 - lv.water + 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 0.45, 4); ctx.lineTo(x + 0.45, 4); ctx.moveTo(x - 0.45, 1.2); ctx.lineTo(x + 0.45, 1.2); ctx.stroke();
    }
  }
  function drawFlags(lv) {
    const t = T();
    const ground = (x) => { let best = -99; for (const p of lv.terrain) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; if (Math.abs(a[1] - b[1]) < 1e-6 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])) best = Math.max(best, a[1]); } return best; };
    const gx = lv.goal + B.VEH[lv.veh].wb + 0.4, gy = ground(gx);
    ctx.strokeStyle = t.ink; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + 2.6); ctx.stroke();
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.moveTo(gx, gy + 2.6); ctx.lineTo(gx + 1.1, gy + 2.25); ctx.lineTo(gx, gy + 1.9); ctx.fill();
  }
  function stressColor(r) {
    r = Math.max(0, Math.min(1, r));
    const h = 140 - 140 * r;
    return `hsl(${h},78%,${45}%)`;
  }
  function drawMember(ax, ay, bx, by, mat, stress, alpha = 1) {
    const t = T(), st = t.mats[mat];
    const col = stress == null ? st[0] : stressColor(stress);
    ctx.globalAlpha = alpha; ctx.lineCap = 'round';
    ctx.strokeStyle = col; ctx.lineWidth = st[1];
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    if (mat === 'road') {
      ctx.strokeStyle = st[2]; ctx.lineWidth = st[1] * 0.5; ctx.stroke();
      if (stress == null) { ctx.strokeStyle = st[0]; ctx.lineWidth = 0.035; ctx.setLineDash([0.3, 0.25]); ctx.stroke(); ctx.setLineDash([]); }
    } else if (mat === 'steel' && stress == null) {
      ctx.strokeStyle = '#5c6b7d'; ctx.lineWidth = st[1] * 0.35; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawNode(x, y, anchor, hi) {
    const t = T();
    if (anchor) {
      ctx.fillStyle = t.anchor; ctx.beginPath(); ctx.arc(x, y, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.nodeFill; ctx.beginPath(); ctx.arc(x, y, 0.08, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = t.nodeFill; ctx.strokeStyle = t.node; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.arc(x, y, 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (hi) { ctx.strokeStyle = t.accent; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(x, y, 0.36, 0, Math.PI * 2); ctx.stroke(); }
  }
  const ORDER = { cable: 0, wood: 1, steel: 2, road: 3 };
  function drawDesign(d, opts = {}) {
    const ms = d.members.map((m, i) => i).sort((i, j) => ORDER[d.members[i].mat] - ORDER[d.members[j].mat]);
    for (const i of ms) {
      const m = d.members[i], a = d.nodes[m.a], b = d.nodes[m.b];
      if (opts.ghost) {
        ctx.strokeStyle = T().ghost; ctx.lineWidth = 0.07; ctx.setLineDash([0.25, 0.18]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      } else drawMember(a.x, a.y, b.x, b.y, m.mat, null, opts.alpha);
    }
    if (!opts.ghost) d.nodes.forEach((n, i) => drawNode(n.x, n.y, n.anchor, opts.hiNode === i));
  }
  function drawSim(s) {
    const ms = s.C.filter(c => !c.broken).sort((a, b) => ORDER[a.mat] - ORDER[b.mat]);
    for (const c of ms) {
      const a = s.P[c.a], b = s.P[c.b];
      drawMember(a.x, a.y, b.x, b.y, c.mat, S.stress ? Math.abs(c.fs) / c.str : null);
    }
    const used = new Set(); for (const c of ms) { used.add(c.a); used.add(c.b); }
    s.simDesignNodes.forEach((n, i) => { if (n.anchor || used.has(i)) drawNode(s.P[i].x, s.P[i].y, n.anchor); });
    drawCar(s);
  }
  function drawCar(s) {
    const t = T().car, v = s.veh, P = s.P, w1 = P[s.base], w2 = P[s.base + 1];
    const dx = w2.x - w1.x, dy = w2.y - w1.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const mx = (w1.x + w2.x) / 2, my = (w1.y + w2.y) / 2;
    ctx.save(); ctx.translate(mx, my); ctx.transform(ux, uy, -uy, ux, 0, 0);
    const hw = v.wb / 2;
    ctx.lineWidth = 0.06; ctx.strokeStyle = t.line; ctx.fillStyle = t.body; ctx.lineJoin = 'round';
    if (s.level.veh === 'truck') {
      ctx.beginPath(); ctx.rect(-hw - 0.7, 0.15, v.wb * 0.68 + 0.7, 1.55); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hw - 0.75, 0.15); ctx.lineTo(hw + 0.85, 0.15); ctx.lineTo(hw + 0.85, 0.75); ctx.lineTo(hw + 0.45, 1.25); ctx.lineTo(hw - 0.75, 1.25); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.glass; ctx.beginPath(); ctx.moveTo(hw - 0.15, 0.8); ctx.lineTo(hw + 0.62, 0.8); ctx.lineTo(hw + 0.35, 1.13); ctx.lineTo(hw - 0.15, 1.13); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(-hw - 0.6, 0.15); ctx.lineTo(hw + 0.7, 0.15); ctx.lineTo(hw + 0.75, 0.55); ctx.lineTo(hw + 0.1, 0.68);
      ctx.lineTo(hw - 0.45, 1.08); ctx.lineTo(-hw + 0.25, 1.08); ctx.lineTo(-hw - 0.35, 0.68); ctx.lineTo(-hw - 0.62, 0.62); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.glass; ctx.beginPath(); ctx.moveTo(-hw + 0.05, 0.72); ctx.lineTo(hw - 0.1, 0.72); ctx.lineTo(hw - 0.52, 0.98); ctx.lineTo(-hw + 0.32, 0.98); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    for (const wh of [w1, w2]) {
      ctx.fillStyle = t.tire; ctx.beginPath(); ctx.arc(wh.x, wh.y, v.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.hub; ctx.beginPath(); ctx.arc(wh.x, wh.y, v.r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = t.tire; ctx.lineWidth = 0.05; ctx.beginPath();
      for (let k = 0; k < 3; k++) { const a = -wh.rot + k * Math.PI * 2 / 3; ctx.moveTo(wh.x, wh.y); ctx.lineTo(wh.x + Math.cos(a) * v.r * 0.45, wh.y + Math.sin(a) * v.r * 0.45); }
      ctx.stroke();
    }
  }
  function drawFx() {
    for (const d of S.debris) drawMember(d.x1, d.y1, d.x2, d.y2, d.mat, null, Math.min(1, d.life));
    for (const p of S.sparks) {
      ctx.fillStyle = p.water ? T().waterLine : T().accent; ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.water ? 0.09 : 0.05, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawDragPreview() {
    const d = S.drag; if (!d || d.erase) return;
    const a = S.design.nodes[d.from], t = dragTarget(d.from, d.wx, d.wy);
    drawMember(a.x, a.y, t.tx, t.ty, S.mat, null, t.ok ? 0.85 : 0.35);
    if (!t.ok) { ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 0.05; ctx.setLineDash([0.15, 0.12]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.tx, t.ty); ctx.stroke(); ctx.setLineDash([]); }
    drawNode(t.tx, t.ty, false, true);
    // 최대 길이 원
    ctx.strokeStyle = T().dim; ctx.globalAlpha = 0.4; ctx.lineWidth = 1 / cam.sc; ctx.setLineDash([4 / cam.sc, 4 / cam.sc]);
    ctx.beginPath(); ctx.arc(a.x, a.y, MAT[S.mat].maxLen, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    // 치수 표기 (화면 좌표로)
    const [sx, sy] = toScreen((a.x + t.tx) / 2, (a.y + t.ty) / 2);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const txt = t.ok ? `${t.len.toFixed(2)} m  ${won(t.len * MAT[S.mat].cost)}` : t.why;
    ctx.font = `600 12px 'IBM Plex Mono', 'IBM Plex Sans KR', monospace`;
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = T().nodeFill; ctx.globalAlpha = 0.92; ctx.fillRect(sx - tw / 2 - 6, sy - 30, tw + 12, 20); ctx.globalAlpha = 1;
    ctx.fillStyle = t.ok ? T().ink : '#ff4d4d'; ctx.textAlign = 'center'; ctx.fillText(txt, sx, sy - 16);
    worldTransform();
  }

  function render(time) {
    drawBackground();
    if (!S.level) return;
    const lv = S.level;
    const sh = S.shake * cam.sc * 0.15;
    worldTransform((Math.random() - .5) * sh, (Math.random() - .5) * sh);
    drawMountains(lv);
    if (S.mode === 'build') drawGrid(lv);
    drawTowers(lv);
    drawWater(lv, time);
    drawTerrain(lv);
    drawFlags(lv);
    if (S.mode === 'build') {
      if (S.peek && S.ai.best) drawDesign(S.ai.best.design, { ghost: true });
      let hi = -1;
      if (S.pointer && !S.drag && S.tool === 'build') hi = nearestNode(S.pointer[0], S.pointer[1]);
      if (S.drag && !S.drag.erase) hi = S.drag.from;
      drawDesign(S.design, { hiNode: hi });
      if (S.tool === 'erase' && S.pointer) {
        const mi = nearestMember(S.pointer[0], S.pointer[1]);
        if (mi >= 0) { const m = S.design.members[mi], a = S.design.nodes[m.a], b = S.design.nodes[m.b]; ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 0.32; ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      drawDragPreview();
      drawGhostCar(lv);
    } else if (S.sim) {
      S.sim.simDesignNodes = S.simDesign.nodes;
      drawSim(S.sim);
    }
    drawFx();
  }
  function drawGhostCar(lv) {
    if (!S._ghost || S._ghost.level !== lv) { S._ghost = B.createSim(lv, B.newDesign(lv)); S._ghost.level = lv; }
    drawCar(S._ghost);
  }

  // ---------- 표지 ----------
  const hc = $('heroCanvas'), hctx = hc.getContext('2d');
  let hero = null;
  function resizeHero() {
    const r = hc.getBoundingClientRect();
    hc.width = Math.max(1, r.width * DPR); hc.height = Math.max(1, r.height * DPR);
  }
  // 표지의 실시간 시연: 1단계 기준 설계를 실제 물리로 주행시키며 하중 색을 보여 준다
  function heroDesign() {
    const lv = LEVELS[0], d = B.newDesign(lv), p = [];
    for (let i = 0; i <= 5; i++) p.push([i * 2, 0]);
    for (let i = 0; i < 5; i++) B.addMember(d, p[i], p[i + 1], 'road');
    const t = []; for (let i = 0; i < 5; i++) { const m = [i * 2 + 1, -1.5]; t.push(m); B.addMember(d, p[i], m, 'wood'); B.addMember(d, m, p[i + 1], 'wood'); if (i) B.addMember(d, t[i - 1], m, 'wood'); }
    B.addMember(d, [0, -2], t[0], 'wood'); B.addMember(d, [10, -2], t[4], 'wood');
    return d;
  }
  function heroFrame(dt, time) {
    if ($('cover').classList.contains('hidden')) return;
    const lv = LEVELS[0];
    if (!hero || hero.t > 9) { hero = B.createSim(lv, heroDesign()); hero.simDesignNodes = heroDesign().nodes; hero.timeLimit = 99; }
    hero.step(Math.min(dt, 1 / 30));
    const w = hc.width, h = hc.height, sc = Math.min(w / 17, h / 10.5), ox = w / 2 - 5 * sc, oy = h * 0.45;
    // 표지 캔버스에 같은 그리기 함수를 재사용
    const t = T();
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.fillStyle = t.sky ? t.sky[1] : t.bg; hctx.fillRect(0, 0, w, h);
    swapCtx(hctx, sc / DPR, ox / DPR, oy / DPR, () => {
      ctx.setTransform(DPR * cam.sc, 0, 0, -DPR * cam.sc, DPR * cam.ox, DPR * cam.oy);
      drawMountains({ view: [-12, 22], water: lv.water });
      drawGrid({ view: [-12, 22, -8, 6] });
      drawWater({ view: [-12, 22, -9], water: lv.water }, time);
      drawTerrain(lv);
      const st = S.stress; S.stress = true; drawSim(hero); S.stress = st;
    });
  }
  function swapCtx(c2, sc, ox, oy, fn) {
    const keep = { ctx, sc: cam.sc, ox: cam.ox, oy: cam.oy };
    ctx = c2; cam.sc = sc; cam.ox = ox; cam.oy = oy;
    try { fn(); } finally { ctx = keep.ctx; cam.sc = keep.sc; cam.ox = keep.ox; cam.oy = keep.oy; }
  }

  function renderLevels() {
    const box = $('levels'); box.innerHTML = '';
    let total = 0;
    LEVELS.forEach(lv => {
      const best = store.data.best[lv.id], ai = store.data.ai[lv.id], n = best ? best.stars : 0; total += n;
      const b = document.createElement('button'); b.className = 'frame lv';
      b.innerHTML = `<div class="row"><span class="no">${lv.id}단계 · ${B.VEH[lv.veh].name}</span><span class="stars">${starHtml(n)}</span></div>
        <div class="name">${lv.name}</div>
        <div class="meta">예산 <span class="num">${won(lv.budget)}</span>${best ? `<br>내 최저 <span class="num">${won(best.cost)}</span>` : ''}${ai ? `${best ? ' / ' : '<br>'}AI <span class="num">${won(ai.cost)}</span>` : ''}</div>`;
      b.onclick = () => { audio(); loadLevel(lv); };
      box.appendChild(b);
    });
    $('progressTxt').textContent = `별 ${total}/${LEVELS.length * 3}개`;
  }
  function showCover() {
    stopSimSafe();
    if (S.ai.worker) { S.ai.worker.terminate(); S.ai.worker = null; }
    if (S.ai.timer) clearTimeout(S.ai.timer);
    S.ai.levelId = null; S.level = null; closeCard();
    $('hud').classList.add('hidden'); $('cover').classList.remove('hidden'); document.body.classList.remove('playing');
    renderLevels(); requestAnimationFrame(resizeHero);
  }
  function stopSimSafe() { S.mode = 'build'; S.sim = null; }
  $('backBtn').onclick = showCover;
  $('startBtn').onclick = () => { audio(); loadLevel(LEVELS[0]); };
  $('howBtn').onclick = () => $('notes').scrollIntoView({ behavior: 'smooth' });


  // ---------- 루프 ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const time = now / 1000;
    if (S.mode === 'sim') simFrame(dt);
    stepFx(dt);
    render(time);
    heroFrame(dt, time);
    requestAnimationFrame(loop);
  }

  window.__bridgeDebug = S; window.__cam = cam;
  addEventListener('resize', resize);
  resize(); renderLevels();
  requestAnimationFrame(loop);
})();
