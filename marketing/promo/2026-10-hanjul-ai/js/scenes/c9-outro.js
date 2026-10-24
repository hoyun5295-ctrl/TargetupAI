// 장 9 · 지키는 것 + 닫는 장(14초): 보내기 전에 한줄로가 지키는 것 다섯 줄 → 로고 한줄로 + AI → 「마케팅, 이제 한 줄이면 됩니다」 → hanjul.ai
// 지키는 것 = plan-feature-intros safeguards 제목 · about-page ABOUT_GUARDS 줄인 말(크레딧 표현은 영상 규칙상 뺐다)
(() => {
  const C = chOf('c9');
  const IC = UI.icon;
  const G = [
    ['보내기 전 스팸 검사', '통신사 3곳 테스트폰으로 먼저 확인'],
    ['혜택은 지어내지 않음', '한 줄과 담당자가 답한 내용만'],
    ['광고 규정 자동', '(광고) 표기 · 수신거부 · 야간 발송 금지'],
    ['승인 전에는 아무것도 안 나감', '승인한 그대로만 나갑니다'],
    ['대상 없는 날은 쉼', '보낼 고객이 없으면 보내지 않아요'],
  ];
  const S = { title: 0.3, rows: 1.0, out: 5.8, logo: 6.3, ai: 7.3, copy: 8.0, chips: 9.0, url: 10.2, note: 11.0 };

  V.scene({
    id: 'c9', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg('<div class="glow" id="c9g" style="left:660px;top:200px;width:600px;height:600px;background:rgba(255,90,31,.14)"></div>')}
      <div class="abs" id="c9t" style="left:0;top:150px;width:1920px;text-align:center"><div style="font-size:34px;font-weight:650;color:var(--s5)">보내기 전에,</div><div style="margin-top:8px;font-size:76px;font-weight:900;letter-spacing:-0.05em">한줄로가 지키는 것</div></div>
      <div class="abs" id="c9rows" style="left:360px;top:400px;width:1200px">${G.map(([h, d]) => `<div class="c9r" style="margin-top:14px;height:96px;border-radius:22px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;gap:22px;padding:0 30px;box-shadow:0 20px 40px -32px rgba(17,17,17,.35)">
        <span style="width:56px;height:56px;border-radius:16px;background:var(--ok-soft);color:var(--ok);display:flex;align-items:center;justify-content:center;font-size:30px">${IC('shield')}</span>
        <b style="font-size:32px;font-weight:850">${h}</b><span style="margin-left:auto;font-size:24px;color:var(--s6)">${d}</span></div>`).join('')}</div>
      <div class="abs" id="c9logo" style="left:540px;top:300px;width:840px;height:187px">
        <img src="../../../packages/frontend/public/logo.png" alt="한줄로" style="position:absolute;left:0;top:0;width:840px;clip-path:inset(0 36% 0 0)">
        <img id="c9bar" src="../../../packages/frontend/public/logo.png" alt="" style="position:absolute;left:0;top:0;width:840px;clip-path:inset(0 0 0 64%)">
        <div id="c9ai" style="position:absolute;left:541px;width:294px;top:-18px;text-align:center;font-size:178px;font-weight:900;line-height:1;color:var(--ac)"></div>
      </div>
      <div class="abs" id="c9copy" style="left:0;top:540px;width:1920px;text-align:center;font-size:72px;font-weight:900;letter-spacing:-0.05em">마케팅, 이제 <span class="mk" id="c9mk">한 줄</span>이면 됩니다</div>
      <div class="abs" id="c9chips" style="left:0;top:680px;width:1920px;display:flex;justify-content:center;flex-wrap:wrap;gap:12px">${CH.filter((c) => c.no).map((c) => `<span class="pill" style="background:#fff;border:2px solid var(--line);font-size:22px;padding:12px 22px">${c.name}</span>`).join('')}</div>
      <div class="abs" id="c9url" style="left:50%;top:800px;display:flex;align-items:center;gap:16px;padding:24px 54px;border-radius:999px;background:var(--ink);color:#fff;font-size:46px;font-weight:800">hanjul.ai<span style="color:var(--ac);font-size:44px">${IC('arrow')}</span></div>
      <div class="abs" id="c9note" style="left:0;top:1010px;width:1920px;text-align:center;font-size:17px;font-weight:550;color:var(--s5)">영상 속 화면은 예시이며, 회사와 고객은 가상입니다 · 포스터는 이미지 스튜디오 방식으로 만든 예시입니다</div>`;
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      // 앞 장면 위로 덮으며 들어온다
      R.style.opacity = V.p(t, 0, 0.5).toFixed(3);
      V.show($('c9t'), t, S.title, S.out, { dy: 40, blur: 12, dur: 0.6 });
      R.querySelectorAll('.c9r').forEach((n, k) => V.show(n, t, S.rows + k * 0.35, S.out, { dy: 0, dx: 80, blur: 8, dur: 0.5 }));
      $('c9g').style.transform = `scale(${(0.8 + 0.5 * V.p(t, S.logo, S.logo + 1.2)).toFixed(3)})`;
      V.show($('c9logo'), t, S.logo, null, { dy: 0, sc: 0.18, blur: 20, dur: 0.9 });
      $('c9bar').style.opacity = t < S.ai + 0.15 ? (Math.floor((t - S.logo) * 3.2) % 2 === 0 ? 1 : 0.18) : 1;
      $('c9ai').textContent = (t >= S.ai ? 'A' : '') + (t >= S.ai + 0.16 ? 'I' : '');
      V.show($('c9copy'), t, S.copy, null, { dy: 40, blur: 12, dur: 0.7 });
      $('c9mk').style.backgroundSize = `${(V.p(t, S.copy + 0.6, S.copy + 1.1, 'io') * 100).toFixed(1)}% 34%`;
      R.querySelectorAll('#c9chips .pill').forEach((n, k) => V.show(n, t, S.chips + k * 0.08, null, { dy: 24, blur: 4, dur: 0.4, sc: 0.1, ease: 'back' }));
      V.show($('c9url'), t, S.url, null, { dy: 30, blur: 0, sc: 0.2, dur: 0.5, ease: 'back', base: 'translateX(-50%)' });
      V.show($('c9note'), t, S.note, null, { dy: 10, blur: 0, dur: 0.5 });
    },
  });
})();
