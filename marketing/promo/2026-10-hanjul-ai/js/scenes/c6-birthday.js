// 장 6 · 자동 마케팅 · 생일(24초): 시나리오 「생일 축하 (매월)」 → 미리보기(누구에게 · 핵심 혜택 · AI 문안 3안) → 승인하고 시작
//   → 회차 당일(문안 준비 · 3사 검사 → 담당자 미리 알림 → 발송) → 다음 회차 전에 다시 여쭤요 → 개인별 생일 = 여정
// 화면 글 = ScenarioStart · OperatorPreviewModal · plan-feature-intros(auto-marketing) 원문 · 회사(오후담) · 숫자는 예시
(() => {
  const C = chOf('c6');
  const IC = UI.icon;
  const SC = [['crown', 'VIP 재구매 유도', '90일 이상 구매 없는 VIP에게 재구매 제안'], ['moon', '휴면 고객 회복', '60일 넘게 잠든 고객을 복귀 유도'], ['user', '신규 첫구매 전환', '가입 후 아직 안 산 고객 첫 구매 유도'],
    ['trend', '등급 상승 유도', 'VIP 근접 고객에게 한 걸음 더 제안'], ['sun', '계절 프로모션', '이번 시즌에 맞춰 전체 활성 고객 안내'], ['box', '재고 소진', '재고가 남은 상품의 구매 유도'],
    ['cake', '생일 축하 (매월)', '매월 정한 날, 그 달 생일 고객에게 축하 인사'], ['coins', '포인트 사용 유도', '포인트 보유 고객에게 사용 안내'], ['star', 'VIP 데이 (매월)', '매월 정한 날, VIP에게 감사 안내']];
  const BENEFIT = '생일 달 음료 한 잔 쿠폰 · 이달 말까지';
  const MMS = [['(광고)', 'ad'], ['[오후담] '], ['박지수', 'var'], ['님, 생일 축하해요!\n이번 달은 '], ['박지수', 'var'], ['님의 달이에요. 오후담 창가 자리에서 따뜻한 음료 한 잔 하며 쉬어 가요.\n\n▶ '], ['생일 달 음료 한 잔 쿠폰', 'sig'], ['\n▶ 이달 말까지\n\n오늘도 오후담에서 쉬어 가요\n'], ['무료수신거부 080-***-****', 'rej']];
  const S = {
    win: 3.0, pick: 5.8, mod: 6.5, load: [6.6, 7.6], body: 7.6, tabs: 9.6, start: 13.8, modOut: 14.5,
    flow: 14.7, steps: [15.6, 17.0, 18.4], notice: 17.0, mms: 18.6, mmsEnd: 20.6, next: 20.8, jr: 21.6,
  };
  const caps = [[3.1, '검증된 시나리오에서', '<em>생일 축하</em>를 고르면']];
  const caps2 = [
    [6.7, '받을 고객 수 · 문안 · 일정을', '<em>먼저 보고</em> 승인합니다'],
    [11.0, '혜택은', '<em>적은 그대로만</em> 들어갑니다'],
    [14.8, '승인하면', '정한 날, 정한 시각에 <em>알아서</em>'],
    [21.0, '고객마다 생일 당일에 맞추려면', '<em>여정</em>으로, 생일 며칠 전부터'],
  ];

  V.scene({
    id: 'c6', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps)}<div id="c6c2">${V.captionHTML(caps2, 'top')}</div>
      ${UI.win('c6win', { x: 730, y: 118, w: 1080, h: 870, icon: 'brain', title: '자동 마케팅', sub: '한 번 승인하면 정해진 때에' })}
      <div class="mod" id="c6mod" style="left:120px;top:262px;width:1060px;height:770px">
        <div class="mh" style="display:flex;gap:14px"><span style="width:50px;height:50px;border-radius:14px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;flex:none">${IC('spark')}</span>
          <div><h3>생일 축하 (매월)</h3><p>이번 달 생일인 고객에게 생일 축하 인사</p></div></div>
        <div id="c6load" class="abs" style="left:0;right:0;top:220px;text-align:center"><div class="spin" id="c6sp" style="margin:0 auto 16px;width:46px;height:46px;border-width:5px"></div>
          <b style="font-size:22px">대상 고객을 세고 문안을 준비하고 있어요</b><div style="margin-top:8px;font-size:17px;color:var(--s5)">아직 자동 마케팅은 시작되지 않았어요. 보고 나서 시작할지 정하시면 됩니다.</div></div>
        <div id="c6body" style="padding:18px 30px">
          <div style="border-radius:16px;background:var(--ac-soft);border:2px solid var(--ac-line);padding:14px 18px">
            <div style="font-size:21px">지금 승인하시면 <b>11월 1일(일) 오전 10:00</b>에 이렇게 나갑니다.</div>
            <div style="margin-top:4px;font-size:16px;color:var(--ac-ink)">매월 1회라 이 승인은 다음 회차 1회분이고, 그다음 회차 전에 다시 여쭤요.</div></div>
          <div style="margin-top:10px;font-size:15px;color:var(--s6)">발송 대상을 <b>'이달 생일 고객'</b> 기준으로 고정해요. 매 회차 같은 기준으로 나가고, 세부 설정에서 바꿀 수 있어요.</div>
          <div style="margin-top:14px;font-size:19px;font-weight:850">누구에게</div>
          <div style="margin-top:8px;border-radius:14px;border:2px solid var(--line)">
            <div style="padding:12px 16px;display:flex;gap:16px;align-items:center;border-bottom:2px solid var(--soft)"><span style="width:90px;color:var(--s5);font-size:16px">조건</span><b style="font-size:19px">이달 생일 고객</b></div>
            <div style="padding:12px 16px;display:flex;gap:10px;align-items:center;font-size:18px"><span style="color:var(--s4)">${IC('users')}</span>지금 기준 <b class="tnum" id="c6n">0명</b><span style="font-size:15px;color:var(--s5)">· 회차마다 그때 다시 세요</span></div>
          </div>
          <div style="margin-top:14px;font-size:19px;font-weight:850">문안은 어떻게 쓰시겠어요?</div>
          <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="border-radius:14px;border:3px solid var(--ink);padding:12px 16px"><b style="font-size:18px">AI가 회차마다 새로 써요</b><div style="font-size:14.5px;color:var(--s6);margin-top:4px">매일 · 매주 · 매달 계절과 그날 특성에 맞게 문안이 달라져요. 핵심 혜택은 그대로 유지돼요.</div></div>
            <div style="border-radius:14px;border:2px solid var(--line);padding:12px 16px"><b style="font-size:18px">직접 쓴 문안 그대로</b><div style="font-size:14.5px;color:var(--s5);margin-top:4px">우리 브랜드 문안을 넣어 두면 대상만 자동으로 뽑아 매 회차 그 문안으로 보내요.</div></div>
          </div>
          <div style="margin-top:12px;border-radius:14px;border:2px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:14px"><span style="width:90px;color:var(--s5);font-size:16px">핵심 혜택</span><b style="font-size:18px" id="c6bf"></b><span style="margin-left:auto;font-size:15px;color:var(--s5)">회차마다 문안에 그대로 들어가요</span></div>
          <div id="c6tabs" style="margin-top:12px;display:flex;gap:8px"><span class="pill dk" style="font-size:16px">A · 추천</span><span class="pill sl" style="font-size:16px">B</span><span class="pill sl" style="font-size:16px">C</span>
            <span style="margin-left:auto;font-size:15px;color:var(--s5)">문안은 회차마다 그날에 맞게 새로 만들고, 스팸 검사를 통과한 안만 나가요</span></div>
        </div>
        <div class="mf"><span class="btn gh sm" style="margin-right:auto">닫기</span><span class="btn gh sm">세부 설정에서 고치기</span><span class="btn ac" id="c6start" style="height:56px">${UI.ripple}${IC('spark')}승인하고 시작</span></div>
      </div>
      ${UI.phone('c6ph', { x: 1290, y: 262, name: '오후담', color: '#B7791F', scale: 0.92 })}
      <div class="abs" id="c6phl" style="left:1290px;top:226px;width:368px;text-align:center;font-size:17px;font-weight:750;color:var(--s6)">첫 회차 문안 · MMS</div>

      <div id="c6flow">
        <div class="sf" id="c6cal" style="left:120px;top:290px;width:420px;padding:22px 24px">
          <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:24px">2026년 11월</b><span class="pill ac" style="font-size:15px">매월 1일 · 오전 10:00</span></div>
          <div style="margin-top:14px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-size:14px;color:var(--s5);text-align:center">${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<b style="font-weight:700">${d}</b>`).join('')}
            ${Array.from({ length: 30 }, (_, i) => `<span class="${i === 0 ? 'c6d1' : ''}" style="height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;${i === 0 ? 'background:var(--ac);color:#fff' : 'background:var(--soft2);color:var(--s6)'}">${i + 1}</span>`).join('')}</div>
          <div id="c6nx" style="margin-top:16px;border-radius:14px;border:2px solid var(--line);padding:12px 14px;font-size:16px;line-height:1.5"><b>12월 회차 전</b> · 지난 회차 요약과 함께 다음 승인을 여쭤요</div>
        </div>
        <div class="abs" id="c6steps" style="left:580px;top:300px;width:620px">
          ${[['08:00', '문안 준비 · 스팸 검사', '통신사 3곳 테스트폰으로 실제 수신을 확인하고, 통과한 문안으로 보냅니다', 'shield'],
            ['발송 전', '담당자에게 미리 알림', '회차마다 보내기 전에 그날 문안과 대상 수를 문자로 알려 드려요', 'bell'],
            ['10:00', '이달 생일 고객에게 발송', '(광고) 표기 · 무료수신거부 자동 · 밤 9시부터 다음 날 오전 8시까지는 보내지 않아요', 'send']].map(([tm, h, d, ic], k) => `
            <div class="c6s" style="position:relative;margin-top:${k ? 18 : 0}px;padding:18px 20px 18px 92px;border-radius:18px;background:#fff;border:2px solid var(--line)">
              <span style="position:absolute;left:20px;top:18px;width:54px;height:54px;border-radius:16px;background:${k === 2 ? 'var(--ac)' : 'var(--ink)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px">${IC(ic)}</span>
              <div style="display:flex;align-items:center;gap:10px"><b class="tnum" style="font-size:18px;color:var(--ac)">${tm}</b><b style="font-size:22px">${h}</b><span class="c6ok" style="margin-left:auto"></span></div>
              <div style="margin-top:4px;font-size:16px;color:var(--s5);line-height:1.5">${d}</div></div>`).join('')}
          <div id="c6jr" style="margin-top:22px;border-radius:18px;border:2px dashed var(--ac-line);background:var(--ac-soft);padding:16px 20px;display:flex;align-items:center;gap:14px">
            <span style="font-size:28px;color:var(--ac)">${IC('map')}</span><div><b style="font-size:20px">여정 · 생일 축하</b><div style="font-size:15px;color:var(--s6)">생일 며칠 전 시작 · 고객 한 명 한 명의 생일에 맞춰 보냅니다</div></div>
            <span class="pill ok" style="margin-left:auto;font-size:15px">켜짐</span></div>
        </div>
        <div class="phone" id="c6mgr" style="left:1240px;top:282px;transform-origin:0 0">
          <div class="scr"><div class="isl"></div><div class="sb"><span>09:50</span><span>● ● ●</span></div>
            <div style="padding:40px 18px 0;text-align:center"><div style="font-size:15px;font-weight:700;color:#555">11월 1일 일요일</div><div class="tnum" style="font-size:72px;font-weight:300;letter-spacing:-0.02em;line-height:1.1;color:#111">09:50</div></div><div style="padding:24px 18px 0"><div style="border-radius:20px;background:rgba(255,255,255,.96);box-shadow:0 10px 30px -10px rgba(0,0,0,.25);border:1px solid #eee;padding:14px 16px">
              <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#666"><span style="width:22px;height:22px;border-radius:6px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px">${IC('bell')}</span><b style="color:#111">한줄로 자동 마케팅</b><span style="margin-left:auto">지금</span></div>
              <div style="margin-top:8px;font-size:15.5px;line-height:1.55">오늘 오전 10:00 <b>생일 축하 (매월)</b> 회차가 나갑니다 · 받는 사람 318명 · 스팸 검사 통과 · 문안 미리 보기</div></div></div></div>
        </div>
        <div class="abs" id="c6mgrl" style="left:1240px;top:256px;width:360px;text-align:center;font-size:17px;font-weight:750;color:var(--s6)">담당자 휴대폰</div>
      </div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '생일 고객에게, 매달 알아서', ['시나리오 고르기', '대상 · 문안 · 일정 미리보기', '승인하면 정한 날 자동 발송', '보내기 전 검사 · 담당자 알림']));
      root.querySelector('#c6win .body').innerHTML = `<div style="padding:30px 34px">
        <div style="font-size:26px;font-weight:850">검증된 시나리오로 바로 시작</div>
        <div style="margin-top:6px;font-size:17px;color:var(--s5)">고르면 타겟 · 문안 · 발송 시각이 미리 채워집니다. 가동 전 한 번 확인합니다.</div>
        <div style="margin-top:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
          ${SC.map(([ic, n, d], k) => `<div class="c6sc" id="c6sc${k}" style="position:relative;overflow:hidden;border-radius:18px;background:#fff;border:2px solid var(--line);padding:18px;display:flex;gap:14px;min-height:150px">${UI.ripple}
            <span style="width:50px;height:50px;border-radius:14px;background:${k === 6 ? 'var(--ac)' : 'var(--ink)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none">${IC(ic)}</span>
            <div><b style="display:block;font-size:19px">${n}</b><span style="display:block;margin-top:4px;font-size:15px;color:var(--s5);line-height:1.45">${d}</span></div></div>`).join('')}
        </div></div>`;
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, S.mod);
      V.captions(R.querySelector('#c6c2 .caps'), t, caps2, C.dur - 0.4);

      V.show($('c6win'), t, S.win, S.mod, { dy: 70, blur: 12, dur: 0.7, out: 0.4 });
      R.querySelectorAll('.c6sc').forEach((n, k) => V.show(n, t, S.win + 0.3 + k * 0.07, null, { dy: 30, blur: 6, dur: 0.4 }));
      V.press($('c6sc6'), t, S.pick);
      $('c6sc6').style.borderColor = t >= S.pick + 0.05 ? 'var(--ac)' : 'var(--line)';
      $('c6sc6').style.boxShadow = t >= S.pick + 0.05 ? '0 0 0 4px var(--ac-soft)' : 'none';

      // 미리보기
      V.show($('c6mod'), t, S.mod, S.modOut, { dy: 60, blur: 10, dur: 0.6 });
      $('c6sp').style.transform = `rotate(${(t * 520) % 360}deg)`;
      V.show($('c6load'), t, S.load[0], S.load[1], { dy: 0, blur: 4, dur: 0.3, out: 0.2 });
      V.show($('c6body'), t, S.body, null, { dy: 24, blur: 8, dur: 0.45 });
      $('c6n').textContent = `${V.won(V.count(t, S.body + 0.3, S.body + 1.4, 318))}명`;
      const bf = V.typed(BENEFIT, t, S.body + 2.6, 14);
      $('c6bf').innerHTML = bf ? bf + (bf.length < BENEFIT.length ? '<span class="caret"></span>' : '') : '<span style="color:var(--s4)">적지 않음</span>';
      V.show($('c6tabs'), t, S.tabs, null, { dy: 14, blur: 4, dur: 0.4 });
      V.press($('c6start'), t, S.start);
      // 받는 사람이 보는 모양(첫 회차)
      const ph = $('c6ph');
      V.show(ph, t, S.tabs - 0.2, null, { dy: 60, blur: 10, dur: 0.6, base: `translateX(${(V.p(t, S.flow, S.flow + 0.7, 'io') * 0).toFixed(1)}px)` });
      ph.style.transform += ' scale(0.92)';
      const phOut = V.p(t, S.modOut, S.modOut + 0.4);
      ph.style.opacity = (Number(ph.style.opacity) * (1 - phOut) + 0).toFixed(3);
      V.show($('c6phl'), t, S.tabs + 0.2, S.modOut, { dy: 10, blur: 0, dur: 0.4 });
      ph.querySelector('.in').innerHTML = `<div class="meta">오늘 오전 10:00</div><div class="bub" style="padding:8px"><img src="posters/p5-ohudam-birthday.jpg" alt="" style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:14px"></div>`
        + (t >= S.tabs + 0.3 ? `<div class="bub" style="margin-top:8px">${V.segHTML(MMS, V.typedN(t, S.tabs + 0.3, 60, V.segLen(MMS)))}</div>` : '');
      UI.follow(ph);

      // 회차 당일 흐름
      V.show($('c6cal'), t, S.flow, null, { dy: 50, blur: 8, dur: 0.55 });
      const d1 = R.querySelector('.c6d1');
      d1.style.transform = `scale(${(1 + 0.18 * Math.sin(Math.max(0, t - S.flow) * 4) * (1 - V.p(t, S.flow + 1, S.flow + 3))).toFixed(3)})`;
      V.show($('c6nx'), t, S.next, null, { dy: 14, blur: 4, dur: 0.4 });
      R.querySelectorAll('.c6s').forEach((n, k) => {
        V.show(n, t, S.steps[k] - 0.6, null, { dy: 30, blur: 6, dur: 0.45 });
        n.querySelector('.c6ok').innerHTML = t >= S.steps[k] ? `<span class="pill ok" style="font-size:15px">${UI.icon('check')}${['통과 · 3사', '보냄', '318명 발송'][k]}</span>` : '';
      });
      V.show($('c6jr'), t, S.jr, null, { dy: 20, blur: 6, dur: 0.45 });
      const mg = $('c6mgr');
      V.show(mg, t, S.notice - 0.3, null, { dy: 50, blur: 8, dur: 0.5 });
      mg.style.transform += ' scale(0.9)';
      V.show($('c6mgrl'), t, S.notice, null, { dy: 10, blur: 0, dur: 0.4 });

      V.pointer(t, [{ at: S.pick, node: $('c6sc6') }], { tail: 0.4 });
      V.pointer(t, [{ at: S.start, node: $('c6start') }], { tail: 0.5 });
    },
  });
})();
