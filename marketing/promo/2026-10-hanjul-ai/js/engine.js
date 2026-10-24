// 한줄로AI 홍보 영상 엔진 · 시각 t 하나로 화면 전체를 그린다(render.js 가 프레임마다 seek(t) 뒤 캡처한다 · 실시간 재생 없음)
// 장면 = V.scene({ id, at, dur, build(root), seek(lt, t) }) · lt = 장면 안 시각. 뒤 장면이 위에 그려진다(장 표지가 앞 장면을 덮는다).
const V = (() => {
  const W = 1920, H = 1080;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const E = {
    lin: (x) => x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    out5: (x) => 1 - Math.pow(1 - x, 5),
    in: (x) => x * x * x,
    io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  };
  const p = (t, a, b, e = 'out') => (b <= a ? (t >= a ? 1 : 0) : E[e](clamp((t - a) / (b - a))));
  const lerp = (a, b, x) => a + (b - a) * x;
  const $ = (id) => document.getElementById(id);

  // 문자열 → 요소(한 덩어리)
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  // 나타나기 · 사라지기: a 에 들어와 b 에 나간다(b = null 이면 남는다) · 돌려주는 값 = 보이는 정도 0~1
  function show(node, t, a, b, o = {}) {
    if (!node) return 0;
    const { dy = 40, dx = 0, blur = 10, dur = 0.55, out = 0.35, sc = 0, ease = 'out5', base = '', rot = 0, oy = null, ox = 0 } = o;
    const i = p(t, a, a + dur, ease);
    const k = b == null ? 0 : p(t, b, b + out, 'in');
    const v = clamp(i * 1.25) * (1 - k);
    node.style.opacity = v.toFixed(4);
    node.style.visibility = v <= 0.001 ? 'hidden' : 'visible';
    const ty = (1 - i) * dy + k * (oy == null ? -dy * 0.5 : oy);
    const tx = (1 - i) * dx + k * ox;
    const s = 1 - sc * (1 - i) - sc * 0.4 * k;
    node.style.transform = `${base} translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) rotate(${(rot * (1 - i)).toFixed(3)}deg) scale(${s.toFixed(4)})`;
    const bl = (1 - clamp(i * 1.3)) * blur + k * blur;
    node.style.filter = bl > 0.05 ? `blur(${bl.toFixed(2)}px)` : '';
    return v;
  }

  // 타자: cps(초당 글자) 로 a 부터 친다 · 한글 한 글자 = 1
  const chars = (s) => Array.from(s);
  const typedN = (t, a, cps, total) => Math.max(0, Math.min(total, Math.floor((t - a) * cps)));
  const typed = (s, t, a, cps) => { const c = chars(s); return c.slice(0, typedN(t, a, cps, c.length)).join(''); };

  // 강조 조각이 섞인 글을 n 글자까지 그린다 · segs = [[글, 클래스]] (클래스 없으면 평문) · 줄바꿈 = \n
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function segLen(segs) { return segs.reduce((n, [s]) => n + chars(s).length, 0); }
  function segHTML(segs, n) {
    let out = '', left = n;
    for (const [s, cls] of segs) {
      if (left <= 0) break;
      const c = chars(s);
      const part = esc(c.slice(0, left).join('')).replace(/\n/g, '<br>');
      out += cls ? `<span class="${cls}${left >= c.length ? ' done' : ''}">${part}</span>` : part;
      left -= c.length;
    }
    return out;
  }

  // 숫자가 굴러 올라간다
  const count = (t, a, b, n, e = 'out') => Math.round(n * p(t, a, b, e));
  const won = (n) => n.toLocaleString('ko-KR');

  // 누르기: 살짝 눌렸다 돌아오고 물결이 퍼진다(ripple = 버튼 안 .rp)
  function press(node, t, at) {
    if (!node) return 0;
    const pr = p(t, at - 0.07, at + 0.05, 'in') * (1 - p(t, at + 0.05, at + 0.3, 'out'));
    node.style.transform = `scale(${(1 - 0.06 * pr).toFixed(4)})`;
    const rp = node.querySelector(':scope > .rp');
    if (rp) {
      const r = clamp((t - at) / 0.5);
      rp.style.opacity = t >= at && r < 1 ? (0.55 * (1 - r)).toFixed(3) : 0;
      rp.style.transform = `translate(-50%, -50%) scale(${(0.2 + r * 7).toFixed(3)})`;
    }
    return pr;
  }

  // 무대 좌표(1920×1080) 기준 상자 — 미리보기 창이 작아도 같은 값
  function box(node) {
    const st = $('stage').getBoundingClientRect();
    const k = st.width / W;
    const b = node.getBoundingClientRect();
    return { x: (b.left - st.left) / k, y: (b.top - st.top) / k, w: b.width / k, h: b.height / k };
  }

  // 손가락 포인터: steps = [{ at, node, fx, fy }] · at 에 누른다 · 앞 단계 위치에서 0.5초 동안 옮겨 온다
  function pointer(t, steps, o = {}) {
    const pt = $('pointer');
    const list = steps.filter((s) => s.node);
    if (!list.length || t < list[0].at - 0.9 || t > list[list.length - 1].at + (o.tail ?? 0.6)) return;
    let i = list.findIndex((s) => t < s.at);
    if (i === -1) i = list.length - 1;
    const pos = (s) => { const b = box(s.node); return { x: b.x + b.w * (s.fx ?? 0.55), y: b.y + b.h * (s.fy ?? 0.6) }; };
    const cur = pos(list[i]);
    const prev = i > 0 ? pos(list[i - 1]) : { x: cur.x + 220, y: cur.y + 260 };
    const travel = Math.min(0.55, (list[i].at - (i > 0 ? list[i - 1].at : list[i].at - 0.9)) * 0.8);
    const m = p(t, list[i].at - travel - 0.08, list[i].at - 0.08, 'io');
    const x = lerp(prev.x, cur.x, m), y = lerp(prev.y, cur.y, m);
    const fadeIn = p(t, list[0].at - 0.9, list[0].at - 0.6);
    const fadeOut = 1 - p(t, list[list.length - 1].at + (o.tail ?? 0.6) - 0.25, list[list.length - 1].at + (o.tail ?? 0.6));
    pt.style.opacity = (fadeIn * fadeOut).toFixed(3);
    const tap = p(t, list[i].at - 0.07, list[i].at + 0.05, 'in') * (1 - p(t, list[i].at + 0.05, list[i].at + 0.3));
    pt.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - 0.16 * tap).toFixed(3)})`;
  }

  // 자막: items = [[at, 작은 줄, 큰 줄]] · 다음 항목 시각에 바뀐다 · end 에 모두 사라진다
  function captions(node, t, items, end) {
    const rows = node.querySelectorAll('.cap-row');
    items.forEach(([at], k) => {
      const next = k + 1 < items.length ? items[k + 1][0] - 0.3 : end;
      show(rows[k], t, at, next, { dy: 34, blur: 8, dur: 0.6, out: 0.3 });
    });
  }
  function captionHTML(items, cls = '') {
    return `<div class="caps ${cls}">${items.map(([, k, h]) => `<div class="cap-row"><div class="cap-k">${k}</div><div class="cap-h">${h}</div></div>`).join('')}</div>`;
  }

  const scenes = [];
  let chrome = null;
  function scene(s) { scenes.push(s); }
  function setChrome(fn) { chrome = fn; }

  function build() {
    const stage = $('scenes');
    scenes.forEach((s, k) => {
      s.root = document.createElement('div');
      s.root.className = 'scene';
      s.root.id = `sc-${s.id}`;
      s.root.style.zIndex = String(10 + k);
      stage.appendChild(s.root);
      s.build(s.root);
    });
  }

  function seek(t) {
    $('pointer').style.opacity = 0;   // 포인터는 쓰는 장면이 그 프레임에 켠다
    for (const s of scenes) {
      const lt = t - s.at;
      const on = lt >= -(s.pre ?? 0) && lt <= s.dur + (s.post ?? 1.0);
      s.root.style.display = on ? 'block' : 'none';
      if (on) s.seek(lt, t);
    }
    if (chrome) chrome(t);
  }

  const total = () => Math.max(...scenes.map((s) => s.at + s.dur));

  function ready() {
    window.ready = (async () => {
      build();
      await document.fonts.ready;
      await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      seek(0);
      return true;
    })();
    window.seek = seek;
    window.total = total;
  }

  return { W, H, clamp, E, p, lerp, $, el, show, chars, typed, typedN, segLen, segHTML, count, won, press, box, pointer, captions, captionHTML, scene, setChrome, ready, total };
})();
