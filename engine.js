// 다리 공학 실험실 — 물리 엔진 · 단계 데이터 · AI(유전 알고리즘)
// DOM을 쓰지 않으므로 페이지, Web Worker, node 테스트에서 똑같이 돌아간다.
(function (root) {
  'use strict';

  const GRAVITY = -9.81;
  const SUBSTEPS = 24;
  const FRAME = 1 / 60;

  // EA: 축강성(N), str: 파단 하중(N), mpm: m당 질량(kg)
  const MAT = {
    road:  { key: 'road',  name: '도로',   cost: 200, maxLen: 2,  mpm: 100, EA: 6e7,   str: 52000 },
    wood:  { key: 'wood',  name: '나무',   cost: 120, maxLen: 2.5,  mpm: 30,  EA: 3e7,   str: 38000 },
    steel: { key: 'steel', name: '강철',   cost: 360, maxLen: 4,  mpm: 55,  EA: 1.4e8, str: 110000 },
    cable: { key: 'cable', name: '케이블', cost: 160, maxLen: 12, mpm: 10,  EA: 9e7,   str: 90000, tension: true },
  };
  const MAT_ORDER = ['road', 'wood', 'steel', 'cable'];

  const VEH = {
    car:   { name: '승용차', mass: 1200, wb: 2.4, r: 0.42, h: 0.85, speed: 5,   accel: 6 },
    truck: { name: '트럭',   mass: 3400, wb: 3.4, r: 0.52, h: 1.25, speed: 3.6, accel: 4 },
  };

  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  const LEVELS = [
    {
      id: 1, name: '첫 번째 다리', veh: 'car', mats: ['road', 'wood'],
      desc: '폭 10m 협곡입니다.\n승용차 한 대가 건널 수 있게 이어 주세요.',
      hint: '도로만 일자로 이으면 처지다가 끊어집니다.\n아래에 나무로 삼각형을 만들어 받쳐 보세요.',
      terrain: [box(-40, -20, 0, 0), box(10, -20, 50, 0)],
      deck: [[0, 0], [10, 0]],
      anchors: [[0, 0], [10, 0], [0, -2], [10, -2]],
      start: -7, goal: 14, water: -7, view: [-9, 17, -8.5, 5],
      budget: 6500,
    },
    {
      id: 2, name: '바위섬 교각', veh: 'car', mats: ['road', 'wood', 'steel'],
      desc: '폭 16m입니다.\n가운데 바위섬을 교각으로 쓸 수 있습니다.',
      hint: '긴 다리는 중간 지지점이 있으면 훨씬 쉬워집니다.\n바위섬 위 고정점을 활용하세요.',
      terrain: [box(-40, -20, 0, 0), box(16, -20, 56, 0), [[7, -3], [9, -3], [9.8, -20], [6.2, -20]]],
      deck: [[0, 0], [16, 0]],
      anchors: [[0, 0], [16, 0], [0, -2], [16, -2], [7, -3], [9, -3]],
      start: -5, goal: 20, water: -7, view: [-7, 23, -9, 5.5],
      budget: 11000,
    },
    {
      id: 3, name: '아치의 원리', veh: 'car', mats: ['road', 'wood', 'steel'],
      desc: '폭 20m, 중간 지지점이 없습니다.\n절벽 아래쪽 고정점까지 써 보세요.',
      hint: '아치는 하중을 압축력으로 바꿔 양쪽 절벽으로 보냅니다.\n아래 고정점에서 위로 휘어 올라가는 곡선을 만들어 보세요.',
      terrain: [box(-40, -20, 0, 0), box(20, -20, 60, 0)],
      deck: [[0, 0], [20, 0]],
      anchors: [[0, 0], [20, 0], [0, -3], [20, -3]],
      start: -4.5, goal: 23, water: -8, view: [-6, 26, -10, 6],
      budget: 38000,
    },
    {
      id: 4, name: '현수교', veh: 'car', mats: ['road', 'wood', 'steel', 'cable'],
      desc: '폭 24m입니다.\n양쪽 주탑 꼭대기에 고정점이 있습니다.',
      hint: '케이블은 당기는 힘(인장)만 견디지만 싸고 깁니다.\n주탑에서 늘어뜨린 케이블로 도로를 매달아 보세요.',
      terrain: [box(-40, -20, 0, 0), box(24, -20, 64, 0)],
      towers: [2, 22],
      deck: [[0, 0], [24, 0]],
      anchors: [[0, 0], [24, 0], [0, -2], [24, -2], [2, 7], [22, 7]],
      start: -4.5, goal: 27, water: -8, view: [-6, 30, -10, 9],
      budget: 27000,
    },
    {
      id: 5, name: '중량 화물', veh: 'truck', mats: ['road', 'wood', 'steel', 'cable'],
      desc: '폭 14m, 이번엔 3.4톤 트럭입니다.\n승용차의 세 배 가까이 무겁습니다.',
      hint: '하중이 커지면 나무 대신 강철이 필요한 곳이 생깁니다.\n하중 보기에서 빨간 부재만 골라 강화하세요.',
      terrain: [box(-40, -20, 0, 0), box(14, -20, 54, 0)],
      deck: [[0, 0], [14, 0]],
      anchors: [[0, 0], [14, 0], [0, -3], [14, -3]],
      start: -6.5, goal: 17.5, water: -7, view: [-8, 22, -9, 6],
      budget: 25000,
    },
    {
      id: 6, name: '오르막 협곡', veh: 'car', mats: ['road', 'wood', 'steel', 'cable'],
      desc: '건너편 절벽이 3m 더 높습니다.\n경사진 다리를 놓아야 합니다.',
      hint: '경사로에서는 차가 미는 힘까지 더해집니다.\n삼각형을 촘촘히 짜서 처짐을 줄이세요.',
      terrain: [box(-40, -20, 0, 0), box(11, -20, 51, 3)],
      deck: [[0, 0], [11, 3]],
      anchors: [[0, 0], [11, 3], [0, -3], [11, 0]],
      start: -5.5, goal: 14.5, water: -7, view: [-7, 19, -9, 7],
      budget: 8500,
    },
  ];

  // ---------- 설계(디자인) 유틸 ----------
  function newDesign(level) {
    return { nodes: level.anchors.map(([x, y]) => ({ x, y, anchor: true })), members: [] };
  }
  function findNode(d, x, y, eps = 1e-3) {
    for (let i = 0; i < d.nodes.length; i++) {
      const n = d.nodes[i];
      if (Math.abs(n.x - x) < eps && Math.abs(n.y - y) < eps) return i;
    }
    return -1;
  }
  function nodeAt(d, x, y) {
    let i = findNode(d, x, y);
    if (i < 0) { d.nodes.push({ x, y, anchor: false }); i = d.nodes.length - 1; }
    return i;
  }
  function memberLen(d, m) {
    const a = d.nodes[m.a], b = d.nodes[m.b];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function hasMember(d, a, b) {
    return d.members.some(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  }
  function addMember(d, p, q, mat) {
    const a = nodeAt(d, p[0], p[1]), b = nodeAt(d, q[0], q[1]);
    if (a === b) return false;
    const old = d.members.find(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
    if (old) { old.mat = mat; return true; }
    d.members.push({ a, b, mat });
    return true;
  }
  function designCost(d) {
    let c = 0;
    for (const m of d.members) c += MAT[m.mat].cost * memberLen(d, m);
    return Math.round(c);
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function insideTerrain(level, x, y) {
    return level.terrain.some(p => pointInPoly(x, y, p));
  }

  // ---------- 물리 시뮬레이션 (XPBD) ----------
  // 부재 = 거리 제약. 한 서브스텝에 한 번 풀고, 라그랑주 승수/Δt²로 부재에 걸린 힘을 얻는다.
  function createSim(level, design) {
    const P = [];
    const nodeMass = design.nodes.map(() => 6);
    for (const m of design.members) {
      const half = MAT[m.mat].mpm * memberLen(design, m) / 2;
      nodeMass[m.a] += half; nodeMass[m.b] += half;
    }
    design.nodes.forEach((n, i) => {
      P.push({ x: n.x, y: n.y, px: n.x, py: n.y, vx: 0, vy: 0, w: n.anchor ? 0 : 1 / nodeMass[i] });
    });
    const C = design.members.map((m, i) => {
      const mat = MAT[m.mat], rest = memberLen(design, m);
      return { i, a: m.a, b: m.b, mat: m.mat, rest, comp: rest / mat.EA, str: mat.str,
        tension: !!mat.tension, road: m.mat === 'road', f: 0, fs: 0, peak: 0, broken: false };
    });

    // 차량: 바퀴 2개 + 차체 2점, 6개 강한 제약
    const v = VEH[level.veh];
    const sx = level.start, gy = 0;
    const base = P.length;
    const wm = v.mass * 0.3, bm = v.mass * 0.2;
    P.push({ x: sx, y: gy + v.r, w: 1 / wm, wheel: true });
    P.push({ x: sx + v.wb, y: gy + v.r, w: 1 / wm, wheel: true });
    P.push({ x: sx + 0.15, y: gy + v.r + v.h, w: 1 / bm });
    P.push({ x: sx + v.wb - 0.15, y: gy + v.r + v.h, w: 1 / bm });
    for (let k = base; k < P.length; k++) { const p = P[k]; p.px = p.x; p.py = p.y; p.vx = 0; p.vy = 0; p.rot = 0; }
    const carC = [];
    const link = (a, b, comp) => carC.push({ a, b, rest: Math.hypot(P[b].x - P[a].x, P[b].y - P[a].y), comp });
    link(base, base + 1, 1e-8); link(base + 2, base + 3, 1e-8);
    link(base, base + 2, 2e-6); link(base + 1, base + 3, 2e-6);
    link(base, base + 3, 1e-7); link(base + 1, base + 2, 1e-7);
    const wheels = [P[base], P[base + 1]];

    const terr = [];
    for (const poly of level.terrain) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        terr.push([a[0], a[1], b[0], b[1]]);
      }
    }

    const s = { level, P, C, carC, wheels, base, veh: v, t: 0, state: 'run', reason: '', endT: 0,
      maxRatio: 0, events: [], driveStart: 1.0, timeLimit: 30, progress: 0 };

    function solveDist(c, ih2) {
      const a = P[c.a], b = P[c.b];
      const ws = a.w + b.w;
      if (ws === 0) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      const Cv = L - c.rest;
      if (c.tension && Cv < 0) { c.f = 0; return; }
      const at = c.comp * ih2;
      const dl = -Cv / (ws + at);
      const nx = dx / L, ny = dy / L;
      a.x -= a.w * dl * nx; a.y -= a.w * dl * ny;
      b.x += b.w * dl * nx; b.y += b.w * dl * ny;
      c.f = -dl * ih2; // 양수 = 인장, 음수 = 압축
    }

    function collide(wh, ax, ay, bx, by, pa, pb) {
      const ex = bx - ax, ey = by - ay;
      const l2 = ex * ex + ey * ey;
      if (l2 < 1e-9) return;
      let t = ((wh.x - ax) * ex + (wh.y - ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qy = ay + ey * t;
      const dx = wh.x - qx, dy = wh.y - qy;
      const d2 = dx * dx + dy * dy, r = s.veh.r;
      if (d2 >= r * r || d2 < 1e-12) return;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = r - d;
      const wa = pa ? pa.w : 0, wb = pb ? pb.w : 0;
      const den = wh.w + wa * (1 - t) * (1 - t) + wb * t * t;
      const k = pen / den;
      wh.x += wh.w * k * nx; wh.y += wh.w * k * ny;
      if (pa && wa) { pa.x -= wa * (1 - t) * k * nx; pa.y -= wa * (1 - t) * k * ny; }
      if (pb && wb) { pb.x -= wb * t * k * nx; pb.y -= wb * t * k * ny; }
      if (!wh.hit || ny > wh.ny) { wh.hit = true; wh.nx = nx; wh.ny = ny; wh.pa = pa; wh.pb = pb; wh.ct = t; }
    }

    function substep(h) {
      const ih2 = 1 / (h * h);
      // 완공된 다리가 서서히 자기 무게를 받도록 중력을 0.6초에 걸쳐 올린다 (갑작스런 충격 방지)
      const ramp = s.t < 0.6 ? s.t / 0.6 : 1;
      const gh = GRAVITY * ramp * h;
      const damp = Math.exp(-(s.t < 0.8 ? 4 : 0.25) * h);
      for (const p of P) {
        if (p.w === 0) continue;
        p.vx *= damp; p.vy = p.vy * damp + gh;
        p.px = p.x; p.py = p.y;
        p.x += p.vx * h; p.y += p.vy * h;
      }
      for (const c of C) if (!c.broken) solveDist(c, ih2);
      for (const c of carC) solveDist(c, ih2);
      for (const wh of wheels) {
        wh.hit = false;
        for (const c of C) {
          if (c.broken || !c.road) continue;
          const a = P[c.a], b = P[c.b];
          collide(wh, a.x, a.y, b.x, b.y, a, b);
        }
        for (const sg of terr) collide(wh, sg[0], sg[1], sg[2], sg[3], null, null);
      }
      for (const p of P) {
        if (p.w === 0) continue;
        p.vx = (p.x - p.px) / h; p.vy = (p.y - p.py) / h;
      }
      // 구동 + 마찰: 접촉면 기준 접선 속도를 목표 속도로 끌어간다
      const target = s.t > s.driveStart && s.state === 'run' ? s.veh.speed : 0;
      for (const wh of wheels) {
        if (!wh.hit) continue;
        const tx = wh.ny, ty = -wh.nx;
        let svx = 0, svy = 0;
        if (wh.pa) {
          const t = wh.ct;
          svx = (1 - t) * wh.pa.vx + t * wh.pb.vx; svy = (1 - t) * wh.pa.vy + t * wh.pb.vy;
        }
        const vt = (wh.vx - svx) * tx + (wh.vy - svy) * ty;
        const lim = s.veh.accel * h;
        let dv = target - vt;
        dv = dv > lim ? lim : dv < -lim ? -lim : dv;
        wh.vx += tx * dv; wh.vy += ty * dv;
        wh.rot += vt * h / s.veh.r;
      }
      for (const wh of wheels) if (!wh.hit) wh.rot += 0;
      // 부재 파단 판정 (짧은 충격은 걸러서 평활값으로)
      const settle = s.t > 0.6;
      for (const c of C) {
        if (c.broken) continue;
        c.fs += (c.f - c.fs) * 0.12;
        const ratio = Math.abs(c.fs) / c.str;
        if (ratio > c.peak) c.peak = ratio;
        if (settle && ratio > s.maxRatio) s.maxRatio = Math.min(ratio, 1);
        if (ratio > 1) {
          c.broken = true;
          s.events.push({ type: 'break', c, t: s.t });
        }
      }
      s.t += h;
    }

    s.step = function (dt = FRAME) {
      const n = Math.max(1, Math.round(SUBSTEPS * dt / FRAME));
      const h = dt / n;
      for (let i = 0; i < n; i++) substep(h);
      const rear = P[base], front = P[base + 1];
      s.progress = Math.max(s.progress, Math.min(1, (rear.x - level.start) / (level.goal - level.start)));
      if (s.state !== 'run') return;
      let minY = Infinity;
      for (let k = base; k < base + 4; k++) minY = Math.min(minY, P[k].y);
      if (minY < level.water) { s.state = 'fail'; s.reason = '차량이 추락했습니다'; s.endT = s.t; }
      else if (rear.x > level.goal && front.x > level.goal) { s.state = 'win'; s.endT = s.t; }
      else if (s.t > s.timeLimit) { s.state = 'fail'; s.reason = '시간 안에 건너지 못했습니다'; s.endT = s.t; }
    };
    return s;
  }

  // 화면 없이 끝까지 돌린다 (테스트·AI 평가용)
  function runHeadless(level, design, maxT = 30) {
    const s = createSim(level, design);
    s.timeLimit = maxT;
    while (s.state === 'run') s.step(FRAME);
    const broken = s.C.filter(c => c.broken).length;
    return { win: s.state === 'win', reason: s.reason, t: s.t, maxRatio: s.maxRatio, broken, progress: s.progress };
  }

  // ---------- AI 엔지니어: 유전 알고리즘 ----------
  // 유전자 = 패널마다 트러스 절점의 높이 오프셋 + 부재군별 재료 + (현수교) 케이블 on/off.
  // 위상(어떤 부재가 연결되는지)은 정해진 틀 안에서만 바뀐다 — 구조를 '발명'하지는 못한다.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function aiSpec(level) {
    const [[x0, y0], [x1, y1]] = level.deck;
    const span = Math.hypot(x1 - x0, y1 - y0);
    const panels = Math.ceil(span / 2 - 1e-6);
    const hasSteel = level.mats.includes('steel');
    const hasCable = level.mats.includes('cable');
    return { x0, y0, x1, y1, panels, hasSteel, hasCable };
  }

  function randomGenome(spec, rnd) {
    const g = { off: [], chordMat: [], diagMat: [], side: rnd() < 0.7 ? -1 : 1, cables: [], anchorLinks: rnd() < 0.8 };
    for (let i = 0; i < spec.panels; i++) {
      g.off.push(0.6 + rnd() * 1.6);
      g.chordMat.push(spec.hasSteel && rnd() < 0.3 ? 'steel' : 'wood');
      g.diagMat.push(spec.hasSteel && rnd() < 0.3 ? 'steel' : 'wood');
    }
    for (let i = 0; i <= spec.panels; i++) g.cables.push(spec.hasCable && rnd() < 0.4);
    return g;
  }

  function buildFromGenome(level, spec, g) {
    const d = newDesign(level);
    const { x0, y0, x1, y1, panels } = spec;
    const deck = [];
    for (let i = 0; i <= panels; i++) {
      const t = i / panels;
      deck.push([+(x0 + (x1 - x0) * t).toFixed(3), +(y0 + (y1 - y0) * t).toFixed(3)]);
    }
    for (let i = 0; i < panels; i++) addMember(d, deck[i], deck[i + 1], 'road');
    const dl = Math.hypot(deck[1][0] - deck[0][0], deck[1][1] - deck[0][1]);
    const ux = (deck[1][0] - deck[0][0]) / dl, uy = (deck[1][1] - deck[0][1]) / dl;
    const nx = -uy * g.side, ny = ux * g.side;
    const maxOff = Math.sqrt(Math.pow(spec.hasSteel ? 4 : 2.5, 2) - dl * dl / 4) - 0.02;
    const off = g.off.map(o => Math.min(o, maxOff));
    if (!spec.hasSteel) for (let i = 1; i < panels; i++) {
      const lim = Math.sqrt(2.5 * 2.5 - dl * dl) - 0.02; // 위 현재가 나무 길이 안에 들도록
      off[i] = Math.max(off[i - 1] - lim, Math.min(off[i - 1] + lim, off[i]));
    }
    const tn = [];
    for (let i = 0; i < panels; i++) {
      const mx = (deck[i][0] + deck[i + 1][0]) / 2, my = (deck[i][1] + deck[i + 1][1]) / 2;
      const o = off[i];
      tn.push([+(mx + nx * o).toFixed(3), +(my + ny * o).toFixed(3)]);
    }
    const lenOk = (p, q, mat) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= MAT[mat].maxLen + 1e-6;
    let bad = 0;
    const put = (p, q, mat) => {
      if (!lenOk(p, q, mat)) {
        if (mat !== 'steel' && spec.hasSteel && lenOk(p, q, 'steel')) mat = 'steel';
        else { bad++; return; }
      }
      if (insideTerrain(level, p[0], p[1]) || insideTerrain(level, q[0], q[1])) { bad++; return; }
      addMember(d, p, q, mat);
    };
    for (let i = 0; i < panels; i++) {
      put(deck[i], tn[i], g.diagMat[i]);
      put(tn[i], deck[i + 1], g.diagMat[i]);
      if (i < panels - 1) put(tn[i], tn[i + 1], g.chordMat[i]);
    }
    if (g.anchorLinks) {
      // 데크가 아닌 고정점 → 가장 가까운 트러스 절점
      for (const [ax, ay] of level.anchors) {
        if (deck.some(p => Math.abs(p[0] - ax) < 1e-3 && Math.abs(p[1] - ay) < 1e-3)) continue;
        if (ay > 5) continue; // 주탑 꼭대기는 케이블 전용
        let best = null, bd = Infinity;
        for (const p of tn) { const dd = Math.hypot(p[0] - ax, p[1] - ay); if (dd < bd) { bd = dd; best = p; } }
        const mat = bd <= 2 ? 'wood' : 'steel';
        if (best && bd <= MAT[mat].maxLen) put([ax, ay], best, mat);
      }
    }
    if (spec.hasCable) {
      const tops = level.anchors.filter(a => a[1] > 5);
      for (let i = 0; i <= panels; i++) {
        if (!g.cables[i] || !tops.length) continue;
        let best = null, bd = Infinity;
        for (const a of tops) { const dd = Math.hypot(a[0] - deck[i][0], a[1] - deck[i][1]); if (dd < bd) { bd = dd; best = a; } }
        if (bd <= MAT.cable.maxLen) addMember(d, best, deck[i], 'cable');
      }
    }
    return { design: d, bad };
  }

  function fitness(level, spec, g) {
    const { design, bad } = buildFromGenome(level, spec, g);
    const cost = designCost(design);
    const r = runHeadless(level, design, 14);
    let score;
    if (r.win) score = cost * (1 + Math.max(0, r.maxRatio - 0.92) * 2);
    else score = 1e6 * (1 - r.progress * 0.8) + cost;
    score += bad * 500;
    return { score, cost, win: r.win, maxRatio: r.maxRatio, design };
  }

  function mutate(spec, g, rnd, rate) {
    const c = JSON.parse(JSON.stringify(g));
    for (let i = 0; i < spec.panels; i++) {
      if (rnd() < rate) c.off[i] = Math.max(0.3, Math.min(3.8, c.off[i] + (rnd() - 0.5) * 1.2));
      if (spec.hasSteel && rnd() < rate * 0.5) c.chordMat[i] = c.chordMat[i] === 'wood' ? 'steel' : 'wood';
      if (spec.hasSteel && rnd() < rate * 0.5) c.diagMat[i] = c.diagMat[i] === 'wood' ? 'steel' : 'wood';
    }
    for (let i = 0; i <= spec.panels; i++) if (spec.hasCable && rnd() < rate * 0.4) c.cables[i] = !c.cables[i];
    if (rnd() < rate * 0.15) c.side = -c.side;
    if (rnd() < rate * 0.2) c.anchorLinks = !c.anchorLinks;
    return c;
  }

  function crossover(a, b, rnd) {
    const c = JSON.parse(JSON.stringify(a));
    for (let i = 0; i < c.off.length; i++) {
      if (rnd() < 0.5) { c.off[i] = b.off[i]; c.chordMat[i] = b.chordMat[i]; c.diagMat[i] = b.diagMat[i]; }
    }
    for (let i = 0; i < c.cables.length; i++) if (rnd() < 0.5) c.cables[i] = b.cables[i];
    if (rnd() < 0.5) c.side = b.side;
    return c;
  }

  // 한 세대씩 진행하는 진화기. onGen으로 진행 상황을 알린다.
  function createEvolver(level, opts = {}) {
    const rnd = mulberry32(opts.seed || level.id * 7919);
    const spec = aiSpec(level);
    const popN = opts.pop || 18;
    let pop = [];
    // 처음 몇 개는 교과서적 설계(얕은 나무 트러스, 깊은 강철 트러스 등)로 시작한다
    const seeds = [];
    for (const [o, m] of [[1, 'wood'], [1.5, 'steel'], [2.5, 'steel'], [1.5, 'wood']]) {
      if (m === 'steel' && !spec.hasSteel) continue;
      const g = randomGenome(spec, rnd);
      g.off = g.off.map(() => o); g.chordMat = g.chordMat.map(() => m); g.diagMat = g.diagMat.map(() => m);
      g.side = -1; g.anchorLinks = true; g.cables = g.cables.map(() => spec.hasCable);
      seeds.push(g);
    }
    for (let i = 0; i < popN; i++) {
      const g = seeds[i] || randomGenome(spec, rnd);
      pop.push({ g, ...fitness(level, spec, g) });
    }
    pop.sort((a, b) => a.score - b.score);
    let gen = 0;
    return {
      spec,
      best: () => pop[0],
      gen: () => gen,
      step() {
        gen++;
        const elite = pop.slice(0, 4);
        const next = elite.slice();
        const pick = () => { const a = pop[(rnd() * popN) | 0], b = pop[(rnd() * popN) | 0]; return a.score < b.score ? a : b; };
        while (next.length < popN) {
          let g = crossover(pick().g, pick().g, rnd);
          g = mutate(spec, g, rnd, 0.35);
          next.push({ g, ...fitness(level, spec, g) });
        }
        pop = next.sort((a, b) => a.score - b.score);
        return pop[0];
      },
    };
  }

  const API = { MAT, MAT_ORDER, VEH, LEVELS, FRAME, SUBSTEPS, newDesign, findNode, nodeAt, addMember, memberLen,
    hasMember, designCost, insideTerrain, createSim, runHeadless, createEvolver, buildFromGenome, aiSpec };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Bridge = API;
})(typeof self !== 'undefined' ? self : this);
