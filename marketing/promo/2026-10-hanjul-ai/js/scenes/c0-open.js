// 장 0 · 여는 장(0~20초): 마케터의 할 일이 쏟아진다 → 한 줄 입력칸으로 빨려 든다 → 「한 줄이면 됩니다」 → 로고 한줄로 + AI → 이 영상의 여덟 장
(() => {
  const C = chOf('c0');
  const TODO = [
    'VIP 재구매 문자 쓰기', '생일 고객 쿠폰 보내기', '가을 세일 포스터 만들기', '이메일 뉴스레터', '모바일 DM 페이지 만들기',
    '휴면 고객 다시 부르기', '장바구니 리마인드', '자사몰 팝업 띄우기', '이달 행사 달력 짜기', '스팸 검사',
    '(광고) 표기 · 수신거부 확인', '브랜드 말투 맞추기', '고객 엑셀 정리', '보낼 시간 예약', '성과 정리해서 보고',
    '신규 가입 환영 문자', '포인트 소멸 안내', '등급 상승 축하',
  ];
  // 가운데(문구 자리)를 비워 둘레에 놓는다 · [x, y, 기울기]
  const POS = [
    [150, 180, -5], [540, 120, 4], [1180, 160, -3], [1520, 230, 6], [90, 380, 3], [1560, 420, -4],
    [230, 600, -6], [1500, 640, 5], [120, 820, 4], [560, 880, -3], [1080, 900, 6], [1480, 850, -5],
    [900, 60, 2], [340, 300, 5], [1270, 330, -6], [300, 740, -2], [1310, 760, 3], [820, 950, -4],
  ];
  const LINE = '최근 30일 미구매 VIP에게 가을 쿠폰 보내줘';
  const S = { todo0: 0.8, todoGap: 0.17, h1: 2.3, suck: [6.3, 7.3], inp: 7.15, type: 7.8, send: 10.05, big: 10.7, bigOut: 13.4, logo: 13.7, ai: 14.75, sub: 15.3, toc: 16.6 };
  const chipStyle = (k) => (k % 4 === 1 ? 'background:var(--ink);color:#fff;border:2px solid var(--ink)'
    : k % 5 === 2 ? 'background:var(--ac-soft);color:var(--ac-ink);border:2px solid var(--ac-line)'
      : 'background:#fff;color:var(--ink);border:2px solid var(--line)');

  V.scene({
    id: 'c0', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg('<div class="glow" id="c0g" style="left:660px;top:240px;width:600px;height:600px;background:rgba(255,90,31,.16)"></div>')}
        <div id="c0todo"></div>
        <div class="abs" id="c0h" style="left:0;top:428px;width:1920px;text-align:center">
          <div style="font-size:34px;font-weight:650;color:var(--s5)">문자 쓰고, 포스터 만들고, 고객 고르고, 검사하고, 예약하고</div>
          <div style="margin-top:14px;font-size:80px;font-weight:850;letter-spacing:-0.05em">오늘도 할 일이 너무 많습니다</div>
        </div>
        <div class="abs" id="c0in" style="left:410px;top:470px;width:1100px;height:132px;border-radius:34px;background:#fff;color:var(--ink);display:flex;align-items:center;gap:22px;padding:0 22px 0 40px;border:3px solid var(--ink);box-shadow:0 40px 90px -30px rgba(17,17,17,.35)">
          <span style="font-size:40px;color:var(--ac)">${UI.icon('spark')}</span>
          <span id="c0tx" style="flex:1;font-size:40px;font-weight:750;letter-spacing:-0.03em;white-space:nowrap;overflow:hidden"></span>
          <span class="btn" id="c0send" style="width:88px;height:88px;border-radius:26px;padding:0;font-size:38px">${UI.ripple}${UI.icon('up')}</span>
        </div>
        <div class="abs" id="c0big" style="left:0;top:395px;width:1920px;text-align:center;font-size:116px;font-weight:900;letter-spacing:-0.055em;line-height:1.1">
          마케팅, 이제 <span class="mk" id="c0mk">한 줄</span>이면 됩니다
        </div>
        <div class="abs" id="c0logo" style="left:540px;top:330px;width:840px;height:187px">
          <img src="../../../packages/frontend/public/logo.png" alt="한줄로" style="position:absolute;left:0;top:0;width:840px;clip-path:inset(0 36% 0 0)">
          <img id="c0bar" src="../../../packages/frontend/public/logo.png" alt="" style="position:absolute;left:0;top:0;width:840px;clip-path:inset(0 0 0 64%)">
          <div id="c0ai" style="position:absolute;left:541px;width:294px;top:-18px;text-align:center;font-size:178px;font-weight:900;line-height:1;letter-spacing:-0.03em;color:var(--ac)"></div>
        </div>
        <div class="abs" id="c0sub" style="left:0;top:560px;width:1920px;text-align:center;font-size:40px;font-weight:650;color:var(--s6);letter-spacing:-0.03em">문안 · 이미지 · 타깃 · 자동화 · 발송까지, 한 곳에서</div>
        <div class="abs" id="c0toc" style="left:160px;top:700px;width:1600px;display:grid;grid-template-columns:repeat(4,1fr);gap:18px"></div>`;
      V.$('c0todo').innerHTML = TODO.map((s, k) => `<div class="abs" id="c0t${k}" style="left:${POS[k][0]}px;top:${POS[k][1]}px;padding:18px 28px;border-radius:999px;font-size:28px;font-weight:700;white-space:nowrap;${chipStyle(k)};box-shadow:0 18px 36px -20px rgba(17,17,17,.35)">${s}</div>`).join('');
      V.$('c0toc').innerHTML = CH.filter((c) => c.no).map((c) => `<div class="c0c" style="padding:22px 26px;border-radius:22px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;gap:16px;box-shadow:0 18px 40px -30px rgba(17,17,17,.3)">
        <b style="font-size:26px;font-weight:900;color:var(--ac)">${c.no}</b><span style="font-size:30px;font-weight:750">${c.name}</span></div>`).join('');
    },
    seek(lt) {
      const t = lt;
      UI.bgSeek(this.root, t);
      const g = V.$('c0g');
      g.style.transform = `scale(${(0.85 + 0.2 * Math.sin(t * 0.9) + 0.4 * V.p(t, 13.6, 14.6, 'out')).toFixed(3)})`;

      // 할 일이 쏟아진다 → 가운데 입력칸으로 빨려 든다
      const su = V.p(t, S.suck[0], S.suck[1], 'in');
      TODO.forEach((_, k) => {
        const n = V.$(`c0t${k}`);
        const a = S.todo0 + k * S.todoGap;
        const i = V.p(t, a, a + 0.45, 'back');
        const [x, y, r] = POS[k];
        const cx = 960 - (x + 150), cy = 536 - (y + 34);
        const jx = Math.sin(t * 1.3 + k) * 8 * (1 - su), jy = Math.cos(t * 1.1 + k * 1.7) * 10 * (1 - su);
        n.style.opacity = (V.clamp(V.p(t, a, a + 0.15) * 1.2) * (1 - V.p(t, S.suck[1] - 0.25, S.suck[1]))).toFixed(3);
        n.style.visibility = t < a || t > S.suck[1] + 0.05 ? 'hidden' : 'visible';
        n.style.transform = `translate(${(cx * su + jx).toFixed(1)}px, ${(cy * su + jy + (1 - i) * 30).toFixed(1)}px) rotate(${(r * (1 - su)).toFixed(2)}deg) scale(${((0.5 + 0.5 * i) * (1 - 0.85 * su)).toFixed(3)})`;
      });
      V.show(V.$('c0h'), t, S.h1, S.suck[0] - 0.1, { dy: 40, blur: 14, dur: 0.8 });

      // 한 줄 입력
      V.show(V.$('c0in'), t, S.inp, S.big - 0.35, { dy: 0, sc: 0.12, blur: 12, dur: 0.6, ease: 'back' });
      const tx = V.typed(LINE, t, S.type, 11);
      V.$('c0tx').innerHTML = tx ? `${tx}<span class="caret" style="opacity:${t < S.send && Math.floor(t * 3) % 2 === 0 ? 1 : (t < S.type + 2.1 ? 1 : 0)}"></span>` : '<span style="color:var(--s4)">보낼 내용을 한 줄로 적어 주세요</span>';
      V.press(V.$('c0send'), t, S.send);

      // 한 줄이면 됩니다(형광펜이 그어진다)
      V.show(V.$('c0big'), t, S.big, S.bigOut, { dy: 60, blur: 18, dur: 0.8, sc: 0.04 });
      V.$('c0mk').style.backgroundSize = `${(V.p(t, S.big + 0.7, S.big + 1.2, 'io') * 100).toFixed(1)}% 34%`;

      // 로고 + AI
      const up = V.p(t, S.toc - 0.2, S.toc + 0.6, 'io');
      V.show(V.$('c0logo'), t, S.logo, null, { dy: 0, sc: 0.18, blur: 20, dur: 0.9, base: `translateY(${(-130 * up).toFixed(1)}px)` });
      V.$('c0bar').style.opacity = t < S.ai + 0.15 ? (Math.floor((t - S.logo) * 3.2) % 2 === 0 ? 1 : 0.18) : 1;
      V.$('c0ai').textContent = (t >= S.ai ? 'A' : '') + (t >= S.ai + 0.16 ? 'I' : '');
      V.show(V.$('c0sub'), t, S.sub, null, { dy: 30, blur: 10, dur: 0.7, base: `translateY(${(-130 * up).toFixed(1)}px)` });
      this.root.querySelectorAll('.c0c').forEach((n, k) => V.show(n, t, S.toc + 0.15 + k * 0.11, null, { dy: 40, blur: 8, dur: 0.55, sc: 0.06, ease: 'back' }));
    },
  });
})();
