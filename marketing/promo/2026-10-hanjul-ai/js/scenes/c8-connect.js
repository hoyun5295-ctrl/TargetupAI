// 장 8 · 연결과 분석(12초): 쓰던 쇼핑몰 연결 → 주문 · 회원 · 행동이 고객 DB 로 → 성과리포트(30일 · AI 진단 · 바로 실행) · AI 자율 예측
// 화면 글 = plan-feature-intros(connect-shop · performance · predictive) 원문 · 숫자는 예시
(() => {
  const C = chOf('c8');
  const IC = UI.icon;
  const MALLS = ['카페24', '네이버 스마트스토어', '고도몰', '아임웹', '메이크샵', '우커머스(워드프레스)', '자체 몰 · 그 외'];
  const FLOWS = ['주문', '회원', '방문', '장바구니'];
  const BARS = [['모바일 DM', 92], ['여정', 78], ['자동 마케팅', 71], ['문자', 64], ['이메일', 52]];
  const S = { malls: 3.0, hub: 3.6, flow: [4.0, 7.0], rep: 5.6, bars: [6.2, 7.6], diag: 7.8, acts: 8.6, pred: 9.4 };
  const caps = [
    [3.1, '쓰던 쇼핑몰을 연결하면', '주문 · 회원 · 행동이 <em>자동으로</em>'],
    [6.4, '보낸 뒤에는', '성과 진단과 <em>다음 할 일</em>까지'],
  ];

  V.scene({
    id: 'c8', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps, 'top')}
      <div class="abs" id="c8malls" style="left:120px;top:280px;width:300px">${MALLS.map((m) => `<div class="c8m" style="margin-top:12px;height:76px;border-radius:16px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;gap:12px;padding:0 18px;font-size:19px;font-weight:800"><span style="color:var(--ac);font-size:22px">${IC('store')}</span>${m}</div>`).join('')}</div>
      <svg class="abs" id="c8svg" style="left:0;top:0" width="1920" height="1080"></svg>
      <div class="abs" id="c8hub" style="left:520px;top:470px;width:260px;height:260px;border-radius:50%;background:var(--ink);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 0 14px var(--ac-soft)">
        <span style="font-size:52px;color:var(--ac)">${IC('db')}</span><b style="margin-top:8px;font-size:28px">고객 DB</b><span style="font-size:16px;color:rgba(255,255,255,.7)">고객 이력 · 여정 · 인앱에 바로</span></div>
      <div class="abs" id="c8tags" style="left:500px;top:770px;width:300px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px">${FLOWS.map((f) => `<span class="pill dk" style="font-size:17px">${f}</span>`).join('')}</div>
      <div class="sf" id="c8rep" style="left:880px;top:262px;width:930px;height:430px;padding:24px 28px">
        <div style="display:flex;align-items:center;gap:12px"><span style="width:46px;height:46px;border-radius:14px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px">${IC('chart')}</span><b style="font-size:26px">성과리포트 · 최근 30일</b><span class="pill sl" style="margin-left:auto;font-size:15px">풀분석 보고서 PDF</span></div>
        <div style="margin-top:20px">${BARS.map(([n, w], k) => `<div style="margin-top:${k ? 14 : 0}px;display:flex;align-items:center;gap:16px"><b style="width:130px;font-size:18px">${n}</b><div style="flex:1;height:30px;border-radius:9px;background:var(--soft);overflow:hidden"><i class="c8b" data-w="${w}" style="display:block;height:100%;width:0;border-radius:9px;background:${k ? 'var(--ink)' : 'var(--ac)'}"></i></div></div>`).join('')}</div>
        <div id="c8diag" style="margin-top:22px;border-radius:16px;background:var(--ac-soft);border:2px solid var(--ac-line);padding:14px 18px;display:flex;gap:14px;align-items:center">
          <span style="font-size:28px;color:var(--ac)">${IC('spark')}</span><div><b style="font-size:19px">AI 진단 · 1순위 권장</b><div style="font-size:16px;color:var(--s6)">클릭이 많았던 오전 10시대로 다음 발송 시각을 옮겨 보세요</div></div></div>
      </div>
      <div class="sf" id="c8acts" style="left:880px;top:712px;width:450px;padding:18px 22px">
        <b style="font-size:19px">바로 실행</b><div style="font-size:14px;color:var(--s5)">누르면 그 방향으로 캠페인을 설계합니다 · 검토 뒤 발송</div>
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">${['채널 ROI 회복', '시간대 최적화', '최고 성과 복제'].map((s, k) => `<span class="pill ${k === 1 ? 'ac' : 'sl'}" style="font-size:16px">${s}</span>`).join('')}</div>
      </div>
      <div class="sf" id="c8pred" style="left:1350px;top:712px;width:460px;padding:18px 22px">
        <b style="font-size:19px;display:flex;align-items:center;gap:8px"><span class="ac">${IC('brain')}</span>AI 자율 예측 · 매일</b>
        <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="border-radius:14px;background:var(--soft2);border:2px solid var(--line);padding:12px"><div style="font-size:14px;color:var(--s5);font-weight:700">떠날 것 같은 고객</div><b class="tnum c8p" data-n="412" style="font-size:30px">0</b></div>
          <div style="border-radius:14px;background:var(--soft2);border:2px solid var(--line);padding:12px"><div style="font-size:14px;color:var(--s5);font-weight:700">살 것 같은 고객</div><b class="tnum c8p" data-n="286" style="font-size:30px">0</b></div>
        </div>
        <div style="margin-top:10px;font-size:15px;font-weight:800;color:var(--ac-ink)">그 그룹 그대로 캠페인 시작 →</div>
      </div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '쓰던 쇼핑몰 그대로, 보낸 뒤까지', ['자사몰 연동', '주문 · 회원 · 행동 자동으로', '성과리포트 · AI 진단', 'AI 자율 예측']));
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, C.dur - 0.3);
      R.querySelectorAll('.c8m').forEach((n, k) => V.show(n, t, S.malls + k * 0.08, null, { dy: 0, dx: -40, blur: 6, dur: 0.4 }));
      V.show($('c8hub'), t, S.hub, null, { dy: 0, sc: 0.3, blur: 10, dur: 0.6, ease: 'back' });
      V.show($('c8tags'), t, S.hub + 0.4, null, { dy: 20, blur: 4, dur: 0.4 });
      // 몰 → 고객 DB 로 흐르는 점
      const fl = V.p(t, S.flow[0], S.flow[0] + 0.5) * (1 - V.p(t, C.dur - 0.6, C.dur));
      let svg = '';
      MALLS.forEach((_, k) => {
        const y1 = 280 + 12 + k * 88 + 38, x1 = 420, x2 = 650, y2 = 600;
        svg += `<path d="M ${x1} ${y1} C 500 ${y1}, 560 ${y2}, ${x2 - 130} ${y2}" fill="none" stroke="var(--line)" stroke-width="3" opacity="${fl}"/>`;
        for (let j = 0; j < 2; j++) {
          const u = ((t * 0.7 + k * 0.13 + j * 0.5) % 1);
          const bx = (1 - u) ** 3 * x1 + 3 * (1 - u) ** 2 * u * 500 + 3 * (1 - u) * u * u * 560 + u ** 3 * (x2 - 130);
          const by = (1 - u) ** 3 * y1 + 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3 * y2;
          svg += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="6" fill="var(--ac)" opacity="${fl}"/>`;
        }
      });
      $('c8svg').innerHTML = svg;
      // 성과
      V.show($('c8rep'), t, S.rep, null, { dy: 60, blur: 10, dur: 0.6 });
      R.querySelectorAll('.c8b').forEach((n, k) => { n.style.width = `${(Number(n.dataset.w) * V.p(t, S.bars[0] + k * 0.12, S.bars[1] + k * 0.12, 'out')).toFixed(1)}%`; });
      V.show($('c8diag'), t, S.diag, null, { dy: 20, blur: 6, dur: 0.45 });
      V.show($('c8acts'), t, S.acts, null, { dy: 30, blur: 6, dur: 0.45 });
      V.show($('c8pred'), t, S.pred, null, { dy: 30, blur: 6, dur: 0.45 });
      R.querySelectorAll('.c8p').forEach((n) => { n.textContent = `${V.won(V.count(t, S.pred + 0.2, S.pred + 1.6, Number(n.dataset.n)))}명`; });
    },
  });
})();
