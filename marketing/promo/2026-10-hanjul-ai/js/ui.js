// 한줄로AI 홍보 영상 · 공용 부품(아이콘 · 장 표지 · 작업 창 · 휴대폰 · 장 시각표)
// 장 시각표(초) — 모든 장면 파일과 render.js · music.py 가 같은 값을 쓴다(music.py 는 손으로 맞춘다)
const CH = [
  { id: 'c0', at: 0, dur: 20, no: '', name: '' },
  { id: 'c1', at: 20, dur: 46, no: '01', name: 'AI 한줄로' },
  { id: 'c2', at: 66, dur: 40, no: '02', name: 'AI 메모리' },
  { id: 'c3', at: 106, dur: 40, no: '03', name: '이미지 스튜디오' },
  { id: 'c4', at: 146, dur: 30, no: '04', name: '만들기' },
  { id: 'c5', at: 176, dur: 36, no: '05', name: '여정' },
  { id: 'c6', at: 212, dur: 24, no: '06', name: '자동 마케팅' },
  { id: 'c7', at: 236, dur: 14, no: '07', name: '마케팅 플래너' },
  { id: 'c8', at: 250, dur: 12, no: '08', name: '연결과 분석' },
  { id: 'c9', at: 262, dur: 14, no: '', name: '' },
];
const chOf = (id) => CH.find((c) => c.id === id);

const UI = (() => {
  // 선 아이콘(24 격자 · lucide 모양을 따라 그림)
  const I = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    wand: '<path d="m15 4 5 5"/><path d="M3 21 14.5 9.5"/><path d="M8 2v3M6.5 3.5h3M19 14v3M17.5 15.5h3"/>',
    map: '<path d="M14.1 6 9.9 3.9a2 2 0 0 0-1.8 0L3.6 6.1A1 1 0 0 0 3 7v12.8a1 1 0 0 0 1.4.9l3.7-1.9a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.5-2.2a1 1 0 0 0 .6-.9V5a1 1 0 0 0-1.4-.9L16 5.9a2 2 0 0 1-1.9.1Z"/><path d="M15 5.8v15M9 3.2v15"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.99.13 4 4 0 0 0-2.53 5.77 4 4 0 0 0 .56 6.6A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.99.13 4 4 0 0 1 2.53 5.77 4 4 0 0 1-.56 6.6A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3"/><path d="M7 4h.01M12 4h.01M17 4h.01"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    store: '<path d="m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M2 7v3a2 2 0 0 0 2 2 2.7 2.7 0 0 0 2-1 2.7 2.7 0 0 0 4 0 2.7 2.7 0 0 0 4 0 2.7 2.7 0 0 0 4 0 2.7 2.7 0 0 0 2 1 2 2 0 0 0 2-2V7"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    hour: '<path d="M5 22h14M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${I[n] || ''}</svg>`;
  const ripple = '<span class="rp"></span>';

  // 장 표지: 오른쪽에서 덮고(0~0.6) 제목을 보이고 왼쪽으로 걷힌다(dur-0.55~dur)
  // items = 이 장에서 보는 단계(오른쪽에 차례로 뜬다)
  function card(no, title, sub, items = []) {
    return `<div class="card"><div class="bg"></div><div class="grid"></div>
      <div class="no">${no}</div><div class="ln"></div><div class="tt">${title}</div><div class="sb">${sub}</div>
      <div class="its">${items.map((s, k) => `<div class="it"><b>${k + 1}</b><span>${s}</span></div>`).join('')}</div></div>`;
  }
  function cardSeek(node, lt, dur = 2.6) {
    const inK = V.p(lt, 0, 0.62, 'io');
    const outK = V.p(lt, dur - 0.6, dur, 'io');
    node.style.display = lt > dur + 0.05 ? 'none' : 'block';
    node.style.clipPath = `inset(0 0 0 ${((1 - inK) * 100).toFixed(2)}%)`;
    node.style.transform = `translateY(${(-outK * 1080).toFixed(1)}px)`;
    const no = node.querySelector('.no'), tt = node.querySelector('.tt'), sb = node.querySelector('.sb'), ln = node.querySelector('.ln');
    V.show(no, lt, 0.28, null, { dy: 60, blur: 16, dur: 0.7 });
    V.show(tt, lt, 0.42, null, { dy: 50, blur: 12, dur: 0.7 });
    V.show(sb, lt, 0.62, null, { dy: 30, blur: 8, dur: 0.6 });
    ln.style.width = `${(V.p(lt, 0.5, 1.2, 'io') * 220).toFixed(1)}px`;
    node.querySelectorAll('.it').forEach((n, k) => V.show(n, lt, 0.75 + k * 0.16, null, { dy: 0, dx: 50, blur: 8, dur: 0.5 }));
    node.querySelector('.grid').style.transform = `translate(${(-(lt * 18) % 80).toFixed(1)}px, ${(-(lt * 8) % 80).toFixed(1)}px)`;
  }

  // 작업 창(남색 머리 띠 + 밝은 작업대)
  function win(id, { x, y, w, h, icon: ic = 'spark', title, sub = '', tabs = [] }) {
    return `<div class="win" id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      <div class="zh"><span class="ic">${icon(ic)}</span><b>${title}</b><span>${sub}</span>
        ${tabs.length ? `<span class="tabs">${tabs.map(([t, on]) => `<i class="${on ? 'on' : ''}">${t}</i>`).join('')}</span>` : ''}</div>
      <div class="body"></div></div>`;
  }

  // 휴대폰(문자 화면) · 보낸 쪽 이름 · 머리 글자색
  function phone(id, { x, y, name, color = '#7C3AED', av = '', scale = 1, time = '10:00' }) {
    return `<div class="phone" id="${id}" style="left:${x}px;top:${y}px;transform-origin:0 0;${scale !== 1 ? `transform:scale(${scale})` : ''}">
      <div class="scr"><div class="isl"></div>
        <div class="sb"><span>${time}</span><span>● ● ●</span></div>
        <div class="ph"><span class="av" style="background:${color}">${av || name.slice(0, 1)}</span><b>${name}</b></div>
        <div class="msgs"><div class="in"></div></div></div></div>`;
  }
  // 휴대폰 안 글이 넘치면 끝이 보이게 위로 민다
  function follow(phoneNode) {
    const box = phoneNode.querySelector('.msgs'), inn = phoneNode.querySelector('.in');
    const over = inn.offsetHeight - (box.clientHeight - 30);
    inn.style.transform = `translateY(${-Math.max(0, over)}px)`;
  }

  // 휴대폰 말풍선에 문안을 a~b 동안 한 글자씩 친다 · 돌려주는 값 = 진행 0~1
  function bubble(ph, { t, a, b, sub = '', segs, top = '', bottom = null }) {
    const subN = V.chars(sub).length, total = subN + V.segLen(segs);
    const n = V.typedN(t, a, total / (b - a), total);
    const ns = Math.min(n, subN), nb = Math.max(0, n - subN);
    const typing = n > 0 && n < total;
    ph.querySelector('.in').innerHTML = n > 0
      ? `${top ? `<div class="meta">${top}</div>` : ''}<div class="bub">${sub ? `<span class="sj">${V.chars(sub).slice(0, ns).join('')}</span>` : ''}${V.segHTML(segs, nb)}${typing ? '<span class="caret"></span>' : ''}</div>${bottom ? bottom(ns, nb) : ''}`
      : '';
    follow(ph);
    return n / total;
  }

  // 장면 바탕(흰 바탕 · 흐르는 점 격자)
  const stageBg = (extra = '') => `<div class="bg"></div><div class="grid"></div>${extra}`;
  function bgSeek(root, lt) {
    const g = root.querySelector(':scope > .grid');
    if (g) g.style.transform = `translate(${(-(lt * 10) % 80).toFixed(1)}px, ${(-(lt * 5) % 80).toFixed(1)}px)`;
  }

  return { I, icon, ripple, card, cardSeek, win, phone, follow, bubble, stageBg, bgSeek };
})();
