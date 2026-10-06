// 한줄로 AI 기능 소개 릴스 · 흰 바탕 시리즈 공용 장치(08 편부터 · 01 다시 굽기 포함)
// 각 편은 R.setup({ ... }) 으로 머리 표지 · 훅 · 아웃트로를 깔고, window.seek(t) 안에서 R.base(t) 를 먼저 부른다.
// 시각표(15초 · 128 BPM): 훅 0 · 장면1 1마디 · 장면2 2마디 · 장면3 4마디 · 장면4 5마디 · 아웃트로 6마디 · 주소 7마디
const R = (() => {
  const BAR = 1.875;
  const T = { s1: BAR, s2: 2 * BAR, s3: 4 * BAR, s4: 5 * BAR, outro: 6 * BAR, copy: 12.55, url: 7 * BAR, och: [11.6, 11.75, 11.9, 12.05], aiType: [12.15, 12.3] };
  const C = (x) => Math.min(1, Math.max(0, x));
  const E = {
    lin: (x) => x, out: (x) => 1 - Math.pow(1 - x, 3), in: (x) => x * x * x,
    io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  const p = (t, a, b, e = 'out') => E[e](C((t - a) / (b - a)));
  const lerp = (a, b, x) => a + (b - a) * x;
  const $ = (id) => document.getElementById(id);
  const LOGO = '../../../packages/frontend/public/logo.png';
  const ARROW = '<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  const POINTER = '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>';

  function show(el, t, a, b, o = {}) {
    const { dy = 60, blur = 12, dur = 0.38, outDur = 0.24, sc = 0, ease = 'out', x = '', dx = 0, rot = 0 } = o;
    const i = p(t, a, a + dur, ease);
    const q = b == null ? 0 : p(t, b, b + outDur, 'in');
    const v = Math.min(C(i * 1.4), 1) * (1 - q);
    el.style.opacity = v;
    el.style.visibility = v <= 0.001 ? 'hidden' : 'visible';
    el.style.transform = `${x} translate(${(1 - i) * dx}px, ${(1 - i) * dy - q * dy * 0.5}px) rotate(${rot * i}deg) scale(${1 - sc * (1 - i) - sc * 0.5 * q})`;
    const bl = (1 - C(i * 1.3)) * blur + q * blur;
    el.style.filter = bl > 0.05 ? `blur(${bl}px)` : 'none';
  }
  const mark = (el, t, a) => { if (el) el.style.backgroundSize = `${p(t, a, a + 0.35, 'io') * 100}% 36%`; };
  function press(btn, rp, t, at) {
    const pr = p(t, at - 0.06, at + 0.06, 'in') * (1 - p(t, at + 0.06, at + 0.26, 'out'));
    btn.style.transform = `scale(${1 - 0.07 * pr})`;
    const r = C((t - at) / 0.45);
    rp.style.opacity = t >= at ? 0.9 * (1 - r) : 0;
    rp.style.transform = `scale(${0.2 + r * 6})`;
    return pr;
  }
  // 글자가 입력되는 모양: 0~ticks 박자에 나눠 친다
  const typed = (s, t, at, ticks, gap = 0.08) => {
    let k = 0;
    for (let j = 0; j < ticks; j++) if (t >= at + j * gap) k = j + 1;
    return s.slice(0, Math.round(s.length * k / ticks));
  };

  let cfg = null;
  // [ ] 로 감싼 말에 형광펜
  const hl = (s) => s.replace(/\[(.+?)\]/, '<span class="mark hm">$1</span>');
  function setup(c) {
    cfg = c;
    const st = $('stage');
    st.insertAdjacentHTML('afterbegin', `<div class="abs" id="chip"><img src="${LOGO}" alt="한줄로"><span class="bar"></span><span>${c.name}</span></div>
      <div class="abs" id="hook">${c.hook.map((l, k) => `<span class="l" id="h${k}">${hl(l)}</span>`).join('')}</div>`);
    st.insertAdjacentHTML('beforeend', `<svg class="abs" id="pointer" viewBox="0 0 24 24">${POINTER}</svg>
      <div class="abs wipe" id="wipeA"></div><div class="abs wipe" id="wipeB"></div>
      <div class="abs" id="och">${c.chips.map((s) => `<div>${s}</div>`).join('')}</div>
      <div class="abs" id="outK">마케팅의 완성</div>
      <div class="abs" id="logo"><img src="${LOGO}" alt="한줄로" style="clip-path: inset(0 36% 0 0)"><img id="logoBar" src="${LOGO}" alt="" style="clip-path: inset(0 0 0 64%)"><div id="ai"></div></div>
      <div class="abs" id="outC"><span class="l" id="oc0">${c.copy[0]}</span><span class="l" id="oc1">${c.copy[1]}</span></div>
      <div class="abs" id="url">hanjul.ai${ARROW}</div>`);
    if (c.hookSize) $('hook').style.fontSize = c.hookSize + 'px';
  }

  function base(t) {
    $('stage').style.backgroundPosition = `${-t * 6}px ${-t * 14}px`;
    show($('chip'), t, 0.0, T.outro - 0.2, { dy: -30, x: 'translateX(-50%)' });
    cfg.hook.forEach((_, k) => show($('h' + k), t, [0.04, 0.47, 0.9][k], T.s1 - 0.2, { dy: 80, sc: 0.06 }));
    mark(document.querySelector('#hook .hm'), t, cfg.markAt || 0.7);
    // 아웃트로
    const wa = p(t, T.outro - 0.25, T.outro + 0.15, 'io');
    const wb = p(t, T.outro - 0.12, T.outro + 0.28, 'io');
    $('wipeA').style.clipPath = `circle(${wa * 1400}px at 540px 1150px)`;
    $('wipeB').style.clipPath = `circle(${wb * 1400}px at 540px 1150px)`;
    $('wipeA').style.visibility = wa > 0 ? 'visible' : 'hidden';
    $('wipeB').style.visibility = wb > 0 ? 'visible' : 'hidden';
    $('och').querySelectorAll('div').forEach((d, j) => show(d, t, T.och[j] || T.och[3] + 0.15 * (j - 3), null, { dy: 30, blur: 0, sc: 0.3, ease: 'back', dur: 0.35 }));
    show($('outK'), t, T.outro + 0.2, null, { dy: 40 });
    show($('logo'), t, T.outro + 0.28, null, { dy: 70, sc: 0.08, dur: 0.5 });
    $('ai').textContent = (t >= T.aiType[0] ? 'A' : '') + (t >= T.aiType[1] ? 'I' : '');
    $('logoBar').style.opacity = t < T.aiType[1] ? (Math.floor((t - T.outro) * 3.2) % 2 === 0 ? 1 : 0.15) : 1;
    show($('oc0'), t, T.copy, null, { dy: 50 });
    show($('oc1'), t, T.copy + 0.15, null, { dy: 50 });
    show($('url'), t, T.url, null, { dy: 40, sc: 0.2, ease: 'back', dur: 0.45, x: 'translateX(-50%)' });
  }

  // 포인터: 목록 [{ el, at, gone, pr }] 중 지금 차례인 것으로(이번 프레임 위치 · seek 맨 끝에서 부른다)
  function pointer(t, list) {
    const pt = $('pointer');
    const cur = list.find((g) => t < g.gone + 0.15);
    if (cur === undefined) { pt.style.opacity = 0; return; }
    const bb = cur.el.getBoundingClientRect();
    const bx = bb.left + Math.min(bb.width * 0.6, 420), by = bb.top + bb.height * 0.55;
    const m = p(t, cur.at - 0.42, cur.at - 0.05, 'io');
    pt.style.left = lerp(bx + 170, bx, m) + 'px';
    pt.style.top = lerp(by + 250, by, m) + 'px';
    pt.style.opacity = C(p(t, cur.at - 0.5, cur.at - 0.35)) * (1 - p(t, cur.gone, cur.gone + 0.15));
    const tap = p(t, cur.at - 0.06, cur.at + 0.06, 'in') * (1 - p(t, cur.at + 0.06, cur.at + 0.26));
    pt.style.transform = `scale(${1 - 0.14 * Math.max(tap, cur.pr || 0)})`;
  }

  function ready(after) {
    window.ready = (async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      if (after) after();
      window.seek(0);
      return true;
    })();
  }

  return { BAR, T, C, p, lerp, $, show, mark, press, typed, setup, base, pointer, ready };
})();
