/**
 * v3-motion.ts — 「한줄로 V3」 장면 창 · 무료체험 창의 움직임 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2-3 · §4-2)
 *   ★ 2026-11-16 C136 — 이 파일에는 움직임만 남는다(시간표 · 선택자 · 단계 이름표). 장면의 글 · 그림 · 업종 셋(가게 이름 · MMS 문안)은
 *     로그인 뒤 서버가 준다(backend content/gated/v3-popup.ts) · 업종 셋은 인자(sets)로 받는다. ⛔ 여기에 소개 글 · 그림 주소를 다시 적지 않는다.
 *
 * 승인된 목업의 스크립트를 그대로 옮긴 것이다(시간표 · 단계 번호 · 그림 속 제품 자리 값 = 목업 값).
 * 화면(React)은 창의 틀과 버튼 동작만 맡고, 장면 안쪽(서버가 준 마크업)은 이 파일이 class · data-ph 로 움직인다.
 *   - 넘김: 장면이 끝나면 다음 장면 · 칸을 누르면 그 장면을 처음부터 · 멈추는 조건 둘(멈춤 버튼 · 움직임 줄이기 · 마우스가 창 위여도 넘어간다)
 *     장면 시간(data-ms) = 그 장면의 움직임이 끝나는 시각 + 읽는 여유(잰 값 = 설계서 §12-6)
 *   - 누끼 → 포스터: 단계 1 사진 · 2 선이 내려가며 배경 지움 · 3 카드가 걷히고 제품만 · 4 제품이 포스터 자리로 · 5 완성 · 6 폰(MMS) · 7 걷힘
 *   - 멈춤(무료체험 무대) = 반복 예약을 끊고 그 업종의 완성 장면(문자 도착)에서 선다(어느 단계에서 눌러도 같다)
 *   - 움직임 줄이기 = 처음부터 멈춘 채 · 장면의 결론이 다 보이는 완성 장면
 * 돌려주는 함수 = 정리(타이머 · 그리기 예약 · 누름 처리를 모두 걷는다).
 */
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode): T[] => Array.from(root.querySelectorAll<T>(sel));
const pad = (n: number): string => (n < 10 ? '0' : '') + n;
const fmt = (v: number, dec: number): string => (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'));
const prefersReduce = (): boolean => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** 숫자 올리기(장면이 시작될 때 0 에서 목표까지) — 돌려주는 함수 = 멈추고 목표 값으로 */
function countUp(el: HTMLElement, reduce: boolean): () => void {
  const to = parseFloat(el.dataset.count || '0');
  const dec = Number(el.dataset.dec || 0);
  const delay = Number(el.dataset.delay || 500);
  const dur = 900;
  let raf = 0;
  if (reduce) { el.textContent = fmt(to, dec); return () => undefined; }
  el.textContent = fmt(0, dec);
  const timer = window.setTimeout(() => {
    const t0 = performance.now();
    const step = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e, dec);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    step(t0);
  }, delay);
  return () => { window.clearTimeout(timer); cancelAnimationFrame(raf); el.textContent = fmt(to, dec); };
}

/**
 * 누끼 → 포스터에 쓰는 업종 한 벌(서버가 준다 · 여기는 꼴만).
 *   c = 누끼 사진 속 제품의 가운데(가로 · 세로)와 폭 · p = 포스터 속 그 제품의 가운데와 폭(그림마다 잰 값 · 0 ~ 1)
 *   src · cut · post = 그림을 가리키는 CSS 클래스 이름 · text = 그 포스터가 붙어 나가는 MMS 문안
 */
export interface MorphSet { src: string; cut: string; post: string; c: [number, number, number]; p: [number, number, number]; name: string; text: string }

/** (순수) 서버가 준 업종 셋에서 꼴이 맞는 것만 — 하나도 없으면 빈 배열(= 움직임을 돌리지 않는다) */
export function readMorphSets(raw: unknown): MorphSet[] {
  const three = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  const cls = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v);
  if (!Array.isArray(raw)) return [];
  return raw.filter((x: any): x is MorphSet => !!x && cls(x.src) && cls(x.cut) && cls(x.post) && three(x.c) && three(x.p) && typeof x.name === 'string' && typeof x.text === 'string');
}

interface Morph { start(): void; stop(): void; pause(): void; resume(): void }

function createMorph(root: HTMLElement, reduce: boolean, sets: readonly MorphSet[]): Morph {
  const loop = root.dataset.morph === 'loop';
  const full = !!root.closest('.qA');
  const wrap = root.querySelector<HTMLElement>('.mo-wrap');
  const photo = root.querySelector<HTMLElement>('.mo-photo');
  const fly = root.querySelector<HTMLElement>('.mo-fly');
  const post = root.querySelector<HTMLElement>('.mo-post');
  const st = root.querySelector<HTMLElement>('[data-status] span');
  const tm = root.querySelector<HTMLElement>('[data-timer]');
  const labs = $$('.track span', root);
  const pName = root.querySelector<HTMLElement>('[data-ph-name]');
  const pImg = root.querySelector<HTMLElement>('[data-ph-img]');
  const pText = root.querySelector<HTMLElement>('[data-ph-text]');
  const T = loop
    ? { erase: 600, lift: 1400, fly: 1600, done: 2500, phone: 3500, out: 8700, next: 9300 }
    : { erase: 550, lift: 1350, fly: 1550, done: 2450, phone: 0, out: 0, next: 0 };
  let timers: number[] = [];
  let raf = 0;
  let k = 0;
  let cur: MorphSet = sets[0];

  const clear = (): void => { timers.forEach((t) => window.clearTimeout(t)); timers = []; cancelAnimationFrame(raf); };
  const at = (ms: number, fn: () => void): void => { timers.push(window.setTimeout(fn, ms)); };
  const swap = (el: HTMLElement | null, a: string, b: string): void => { if (el && a !== b) el.classList.replace(a, b); };
  const images = (set: MorphSet): void => {
    swap(photo, cur.src, set.src); swap(fly, cur.cut, set.cut); swap(post, cur.post, set.post); swap(pImg, cur.post, set.post);
    if (pName) pName.textContent = set.name;
    if (pText) pText.textContent = set.text;
    cur = set;
  };
  /** 제품이 옮겨 갈 거리 · 배율 — 무대 크기에서 그때그때 잰다(창 크기가 바뀌어도 다음 바퀴에 맞는다) */
  const geo = (set: MorphSet): void => {
    if (!wrap) return;
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (full) {
      const size = Math.max(W, H);
      wrap.style.width = size + 'px'; wrap.style.left = (W - size) / 2 + 'px'; wrap.style.top = (H - size) / 2 + 'px';
    }
    const s = wrap.offsetWidth;
    const wx = wrap.offsetLeft;
    const wy = wrap.offsetTop;
    const dw = W / H > 0.75 ? W : H * 0.75;
    const dh = dw / 0.75;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;
    const cx = wx + set.c[0] * s;
    const cy = wy + set.c[1] * s;
    const tx = ox + set.p[0] * dw;
    const ty = oy + set.p[1] * dh;
    root.style.setProperty('--dx', (tx - cx).toFixed(1) + 'px');
    root.style.setProperty('--dy', (ty - cy).toFixed(1) + 'px');
    root.style.setProperty('--sc', ((set.p[2] * dw) / (set.c[2] * s)).toFixed(3));
    root.style.setProperty('--ox', (set.c[0] * 100).toFixed(1) + '%');
    root.style.setProperty('--oy', (set.c[1] * 100).toFixed(1) + '%');
  };
  const phase = (n: number, label?: string): void => {
    root.dataset.ph = String(n);
    if (label && st) st.textContent = label;
    const step = n <= 1 ? 0 : n <= 3 ? 1 : 2;
    labs.forEach((l, x) => l.classList.toggle('on', x <= step));
    root.style.setProperty('--p', String(n <= 0 ? 0 : n === 1 ? 0.14 : n === 2 ? 0.5 : n === 3 ? 0.62 : n === 4 ? 0.88 : 1));
  };
  const run = (): void => {
    clear();
    const set = sets[k];
    phase(0, '원본 사진'); images(set); void root.offsetWidth; geo(set);
    if (tm) tm.textContent = '00:00';
    if (reduce) { phase(loop ? 6 : 5, loop ? 'MMS로 도착' : '포스터 완성'); if (tm) tm.textContent = '약 30초'; return; }
    at(60, () => phase(1, '원본 사진'));
    at(T.erase, () => {
      phase(2, '배경 지우는 중');
      const t0 = performance.now();
      const span = T.done - T.erase;
      const tick = (now: number): void => {
        const p = Math.min(1, (now - t0) / span);
        if (tm) tm.textContent = p >= 1 ? '약 30초' : '00:' + pad(Math.floor(p * 30));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      tick(t0);
    });
    at(T.lift, () => phase(3, '배경 제거 완료'));
    at(T.fly, () => phase(4, '포스터에 합성 중'));
    at(T.done, () => { phase(5, '포스터 완성'); if (tm) tm.textContent = '약 30초'; });
    if (loop) {
      at(T.phone, () => phase(6, 'MMS로 도착'));
      at(T.out, () => phase(7));
      at(T.next, () => { k = (k + 1) % sets.length; run(); });
    }
  };
  // 멈춤 = 예약을 끊고 그 업종의 완성 장면(문자 도착)을 보여 준 채 선다. 어느 단계에서 눌러도 같다(업종이 바뀌는 숨김 단계 7 에서 눌러도 무대가 비지 않는다).
  const pause = (): void => { clear(); phase(6, 'MMS로 도착'); if (tm) tm.textContent = '약 30초'; };
  return { start: () => { k = 0; run(); }, stop: () => { clear(); phase(0); }, pause, resume: run };
}

/**
 * 로그인 직후 장면 창 — 장면 넘김. pop = 창(.pop.pA) · sets = 서버가 준 업종 셋.
 *   장면 = [data-slides] 두 묶음(무대 .sl · 글 .msgs 의 자식)이 같은 번호로 함께 넘어간다.
 */
export function mountScenes(pop: HTMLElement, sets: readonly MorphSet[]): () => void {
  const reduce = prefersReduce();
  const ac = new AbortController();
  const on = { signal: ac.signal };
  const morphs = new Map<HTMLElement, Morph>();
  if (sets.length > 0) $$('[data-morph]', pop).forEach((el) => morphs.set(el, createMorph(el, reduce, sets)));

  const runScene = (slide: HTMLElement): (() => void) => {
    const cancels = $$('[data-count]', slide).map((el) => countUp(el, reduce));
    const mo = slide.querySelector<HTMLElement>('[data-morph]');
    const m = mo ? morphs.get(mo) : undefined;
    if (m) { m.start(); cancels.push(() => m.stop()); }
    return () => cancels.forEach((c) => c());
  };

  const groups = $$('[data-slides]', pop).map((g) => Array.from(g.children) as HTMLElement[]);
  const scenes = groups[0] || [];
  const tabs = $$('[data-tab]', pop);
  const n = tabs.length;
  const pp = pop.querySelector<HTMLElement>('[data-pp]');
  let i = 0;
  let timer = 0;
  let stopScene: (() => void) | null = null;
  let off = reduce;
  const msOf = (x: number): number => Number(scenes[x]?.dataset.ms) || 5500;
  // ★ 2026-11-15 (배포 뒤 Harold 「멈춰있는데 · 좀 느리네」 · 설계서 §12-6) — 마우스가 창 위에 있어도 넘어간다. 창이 화면 가운데를 크게 차지해
  //   마우스가 그 위에 놓여 있기 쉽고, 그러면 내내 멈춘 것으로 보였다. 멈추는 길 = 멈춤 단추 · 움직임 줄이기 둘뿐.
  const arm = (): void => {
    window.clearTimeout(timer);
    pop.classList.toggle('hold', off);
    if (!off) timer = window.setTimeout(() => show(i + 1), msOf(i));
  };
  function show(x: number): void {
    if (n === 0) return;
    i = (x + n) % n;
    if (stopScene) stopScene();
    pop.style.setProperty('--ms', msOf(i) + 'ms');
    groups.forEach((g) => g.forEach((el, y) => { el.classList.remove('on'); if (y === i) { void el.offsetWidth; el.classList.add('on'); } }));
    tabs.forEach((b, y) => { b.classList.remove('on'); void b.offsetWidth; b.classList.toggle('on', y === i); });
    stopScene = runScene(scenes[i]);
    arm();
  }
  tabs.forEach((b, x) => b.addEventListener('click', () => show(x), on));
  if (pp) {
    const paint = (): void => { pp.classList.toggle('off', off); pp.setAttribute('aria-label', off ? '자동 넘김 다시 켜기' : '자동 넘김 멈춤'); };
    paint();
    pp.addEventListener('click', () => { off = !off; paint(); arm(); }, on);
  }
  show(0);
  return () => {
    ac.abort();
    window.clearTimeout(timer);
    if (stopScene) { stopScene(); stopScene = null; }
  };
}

/** 무료체험 팝업 — 무대가 혼자 돈다(뷰티 → 카페 → 의류) + 멈춤 버튼. pop = 창(.pop.qA). */
export function mountTrialStage(pop: HTMLElement, sets: readonly MorphSet[]): () => void {
  const reduce = prefersReduce();
  const ac = new AbortController();
  const el = pop.querySelector<HTMLElement>('[data-morph]');
  if (!el || sets.length === 0) return () => undefined;
  const m = createMorph(el, reduce, sets);
  const stop = el.querySelector<HTMLElement>('[data-stop]');
  let off = false;
  const paint = (): void => {
    if (!stop) return;
    stop.classList.toggle('off', off);
    stop.setAttribute('aria-label', off ? '장면 반복 다시 켜기' : '장면 반복 멈춤');
  };
  if (stop) stop.addEventListener('click', () => { off = !off; paint(); if (off) m.pause(); else m.resume(); }, { signal: ac.signal });
  paint();
  m.start();
  return () => { ac.abort(); m.stop(); };
}
