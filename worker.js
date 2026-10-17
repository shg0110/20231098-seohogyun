// AI 엔지니어: 메인 화면을 멈추지 않도록 별도 스레드에서 진화시킨다
importScripts('engine.js');
const GENS = 20;
onmessage = (e) => {
  const lv = Bridge.LEVELS.find(l => l.id === e.data.levelId);
  const ev = Bridge.createEvolver(lv);
  const send = (b, gen) => postMessage({ gen, total: GENS, cost: b.cost, win: b.win, maxRatio: b.maxRatio, design: b.design });
  send(ev.best(), 0);
  for (let g = 1; g <= GENS; g++) send(ev.step(), g);
  postMessage({ done: true });
};
