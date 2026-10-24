// 장 5 · 여정(36초): 문장으로 여정 만들기 → 질문(추천 답 미리) → 여정마다 설계 · 이어붙이기 점검 → 생애 지도가 그려진다 → 켜기 전 점검 → 켜짐 · 흐름
// 화면 글 = InterviewModal · journey-interview.ts 질문 · LifecycleMapCanvas · journey-map(-layout) · BatchActivateModal 원문 · 이름 · 숫자는 예시
(() => {
  const C = chOf('c5');
  const IC = UI.icon;
  const SENT = '가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘';
  const PLANS = [
    { t: '신규 가입 환영', o: '가입한 고객의 첫 구매를 돕는다', trig: ['신규 가입', '가입 후 미구매'], n: 3 },
    { t: '첫 구매 감사', o: '첫 구매 고객이 다시 사도록 이끈다', trig: ['첫 구매', '구매 주기 이탈'], n: 2 },
    { t: '재구매 이어가기', o: '두 번째 구매 고객을 단골로', trig: ['재구매', '등급 상승'], n: 3 },
  ];
  // 지도 카드: 칸 = [종류, 이름, 때]
  const CARDS = [
    { col: 0, name: '신규 가입 환영', when: '가입', steps: [['msg', '1번째 문자 · LMS', '바로'], ['wait', '2번째 · 기다림', '3일'], ['cond', '3번째 · 조건', '맞으면 끝 · 아니면 다음 칸'], ['msg', '4번째 문자 · LMS', '오전 10:00']], n: 1284, exit: 212 },
    { col: 1, name: '첫 구매 감사', when: '첫 구매', steps: [['msg', '1번째 문자 · LMS', '바로'], ['wait', '2번째 · 기다림', '7일'], ['msg', '3번째 문자 · MMS', '오전 10:00']], n: 486, exit: 131 },
    { col: 2, name: '재구매 이어가기', when: '재구매', steps: [['msg', '1번째 문자 · LMS', '구매 후 21일'], ['cond', '2번째 · 조건', '맞으면 끝 · 아니면 다음 칸'], ['msg', '3번째 문자 · LMS', '오전 11:00']], n: 203, exit: 58 },
  ];
  const COLS = ['가입', '첫 구매', '재구매', '이탈 · 복귀'];
  const CX = (c) => 48 + c * 436;   // 지도 안 열 왼쪽
  const S = {
    mod: 3.0, type: 3.6, ask: 7.0, read: [7.1, 8.0], qs: 8.0, build: 12.6,
    run: [[13.0, 14.1], [14.1, 15.1], [15.1, 16.0]], attach: 16.2, modOut: 17.2,
    map: 17.3, cards: [17.7, 18.1, 18.5], ghost: 18.9, steps: 19.1, stepGap: 0.32, lines: [22.6, 23.8], band: 24.3,
    act: 26.4, chk: [27.0, 27.5, 28.0], pass: [27.8, 28.3, 28.7], go: 29.4, done: 29.9, actOut: 30.7, live: 30.8,
    guard: 33.0,
  };
  const caps = [
    [3.1, '만들고 싶은 여정을', '<em>한 문장</em>으로 적으면'],
    [8.2, '필요한 것만 묻고', '<em>추천 답</em>은 미리 골라 둡니다'],
    [13.2, '여정마다', 'AI가 단계를 설계하고'],
    [17.4, '그리고', '<em>고객 생애 지도</em>가 그려집니다'],
    [24.0, '가입부터 재구매까지', '한 화면에서 이어 봅니다'],
    [26.6, '켜기 전에 한 번 더', '<em>점검</em>하고 켭니다'],
    [30.9, '켜 두면', '고객마다 알아서, 순서대로'],
  ];
  const stepIcon = (k) => (k === 'wait' ? IC('hour') : k === 'cond' ? IC('branch') : IC('msg'));
  const stepTone = (k) => (k === 'msg' ? 'var(--ac)' : k === 'cond' ? '#0E7490' : 'var(--s4)');

  V.scene({
    id: 'c5', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps, 'top')}
      <div class="sf" id="c5map" style="left:60px;top:262px;width:1800px;height:770px;overflow:hidden;padding:0">
        <div style="height:76px;display:flex;align-items:center;gap:12px;padding:0 26px;border-bottom:2px solid var(--line)">
          <span style="width:46px;height:46px;border-radius:14px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px">${IC('map')}</span><b style="font-size:26px">여정</b>
          <span class="pill sl" style="margin-left:10px;font-size:17px">여정 목록</span><span class="pill dk" style="font-size:17px">생애 지도</span>
          <span style="margin-left:auto;display:flex;gap:10px"><span class="pill sl" style="font-size:17px">${IC('spark')}AI 진단</span><span class="pill" style="font-size:17px;background:var(--ac-soft);color:var(--ac-ink)">${IC('msg')}문장으로 만들기</span></span>
        </div>
        <div style="position:relative;height:50px;border-bottom:2px solid var(--line)">
          ${COLS.map((c, k) => `<div class="c5col" style="position:absolute;left:${CX(k)}px;top:0;height:50px;width:410px;display:flex;align-items:center;gap:10px"><b style="font-size:20px">${c}</b><span class="tnum c5cc" style="font-size:16px;color:var(--s4)">${k < 3 ? 1 : 0}</span>${k < 3 ? `<span style="margin-left:auto;margin-right:20px;color:var(--s3);font-size:20px">${IC('arrow')}</span>` : ''}</div>`).join('')}
        </div>
        <div id="c5legend" style="position:absolute;left:48px;top:138px;display:flex;gap:22px;font-size:15px;color:var(--s5)">
          <span style="display:flex;align-items:center;gap:8px"><svg width="28" height="6"><line x1="0" y1="3" x2="28" y2="3" stroke="#334155" stroke-width="3"/></svg>이어짐</span>
          <span style="display:flex;align-items:center;gap:8px"><svg width="28" height="6"><line x1="0" y1="3" x2="28" y2="3" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6 4"/></svg>손봐야 함</span>
          <span style="display:flex;align-items:center;gap:8px"><svg width="28" height="6"><line x1="0" y1="3" x2="28" y2="3" stroke="#94a3b8" stroke-width="3" stroke-dasharray="3 5"/></svg>비어 있음</span>
        </div>
        <div id="c5cards"></div>
        <svg id="c5svg" style="position:absolute;left:0;top:0;pointer-events:none" width="1800" height="770"></svg>
        <div class="c5ghost" style="position:absolute;left:${CX(3)}px;top:176px;width:390px;border-radius:20px;border:2.5px dashed var(--s3);background:var(--soft2);padding:20px">
          <b style="font-size:19px">이탈 · 복귀 여정이 없어요</b>
          <div style="margin-top:6px;font-size:15px;color:var(--s5);line-height:1.5">이 단계에 들어온 고객을 맞이할 여정이 아직 없어요.</div>
          <div style="margin-top:12px;height:44px;border-radius:12px;background:var(--ink);color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px">+ 이탈 · 복귀 여정 만들기</div>
          <div style="margin-top:6px;text-align:center;font-size:13px;color:var(--s4)">켜기 전에는 보내지 않아요</div>
        </div>
        <div id="c5band" style="position:absolute;left:48px;right:48px;top:636px">
          <div style="display:flex;align-items:baseline;gap:12px;border-bottom:2px solid var(--line);padding-bottom:8px"><b style="font-size:19px">언제든 생기는 순간</b><span class="tnum" style="color:var(--s4);font-size:15px">2</span><span style="font-size:15px;color:var(--s4)">장바구니 · 조회 후 미구매 · 배송 · 생일 · 등급 · 포인트</span></div>
          <div style="margin-top:12px;display:flex;gap:14px">
            ${[['생일 축하', '생일 3일 전 시작', 312], ['장바구니 이탈', '장바구니 담고 2시간 뒤 시작', 97]].map(([n, w, c]) => `<div style="width:420px;border-radius:14px;border:2px solid var(--line);background:#fff;padding:10px 14px;display:flex;align-items:center;gap:10px"><i class="c5dot" style="width:12px;height:12px;border-radius:50%;background:var(--ok)"></i><b style="font-size:17px">${n}</b><span style="font-size:14px;color:var(--s5)">켜짐 · ${w}</span><span class="tnum" style="margin-left:auto;font-size:14px;color:var(--s4)">30일 ${c}명</span></div>`).join('')}
          </div>
        </div>
        <div class="dim" id="c5dim" style="background:rgba(250,250,248,.75)"></div>
      </div>

      <div class="mod" id="c5mod" style="left:420px;top:262px;width:1080px;height:760px">
        <div class="mh" style="display:flex;gap:14px;align-items:flex-start"><span style="width:48px;height:48px;border-radius:14px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none">${IC('msg')}</span>
          <div><h3>문장으로 여정 만들기</h3><p style="white-space:normal">한 문장이면 몇 가지만 묻고 여정 초안을 만들어요. 켜기 전에는 아무것도 보내지 않아요.</p></div></div>
        <div id="c5in" style="padding:24px 34px">
          <div style="font-size:19px;font-weight:800">어떤 여정을 만들고 싶으세요?</div>
          <div style="margin-top:10px;min-height:110px;border-radius:16px;background:var(--soft2);border:2px solid var(--line);padding:18px 20px;font-size:26px;font-weight:700;line-height:1.45" id="c5tx"></div>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">${['가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘', '장바구니에 담고 안 산 고객을 다시 불러 줘', '한동안 안 산 고객을 되살리는 여정 만들어 줘', '생일 앞둔 고객에게 축하 쿠폰 보내 줘'].map((s) => `<span class="pill sl" style="font-size:15px;font-weight:600">${s}</span>`).join('')}</div>
        </div>
        <div id="c5qs" style="position:absolute;left:0;right:0;top:118px;padding:18px 26px">
          <div style="border-radius:14px;border:2px solid var(--line);padding:10px 16px;font-size:16px;color:var(--s5)">“${SENT}”을 이렇게 나눴어요. 추천 답을 골라 두었으니 그대로 만들어도 돼요.</div>
          <div style="margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
            ${PLANS.map((p, k) => `<div class="c5pl" style="border-radius:18px;background:var(--soft2);border:2px solid var(--line);padding:16px">
              <div style="display:flex;gap:10px;align-items:flex-start"><span style="width:30px;height:30px;border-radius:50%;background:var(--ac-soft);color:var(--ac-ink);font-weight:900;display:flex;align-items:center;justify-content:center;flex:none">${k + 1}</span><div><b style="font-size:19px">${p.t}</b><div style="font-size:14px;color:var(--s5)">${p.o}</div></div></div>
              <div style="margin-top:12px;font-size:15px;font-weight:700">${p.t}: 언제 시작할까요?</div>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${p.trig.map((s, j) => `<span class="pill ${j ? 'sl' : 'dk'}" style="font-size:14px">${s}${j ? '' : ' <i style="font-style:normal;color:var(--ac)">추천</i>'}</span>`).join('')}</div>
              <div style="margin-top:12px;font-size:15px;font-weight:700">문자를 몇 번 보낼까요?</div>
              <div style="margin-top:6px;display:flex;gap:6px">${['1번', '2번', '3번', '4번'].map((s, j) => `<span class="pill ${j + 1 === p.n ? 'dk' : 'sl'}" style="font-size:14px">${s}${j + 1 === p.n ? ' <i style="font-style:normal;color:var(--ac)">추천</i>' : ''}</span>`).join('')}</div>
              <div style="margin-top:12px;font-size:15px;font-weight:700">목표를 이루면 남은 문자를 멈출까요?</div>
              <div style="margin-top:6px;display:flex;gap:6px"><span class="pill dk" style="font-size:14px">멈춤 <i style="font-style:normal;color:var(--ac)">추천</i></span><span class="pill sl" style="font-size:14px">끝까지 보냄</span></div>
              <div style="margin-top:12px;font-size:15px;font-weight:700">넣을 혜택이 있나요?</div>
              <div style="margin-top:6px;height:40px;border-radius:10px;background:#fff;border:2px solid var(--line);font-size:14px;color:var(--s4);display:flex;align-items:center;padding:0 12px">예: 첫 구매 10% 쿠폰</div>
            </div>`).join('')}
          </div>
        </div>
        <div id="c5run" style="position:absolute;left:0;right:0;top:118px;padding:22px 34px">
          ${PLANS.map((p, k) => `<div class="c5rr" style="margin-top:${k ? 12 : 0}px;border-radius:16px;border:2px solid var(--line);padding:14px 18px;display:flex;align-items:center;gap:14px"><span class="c5ri" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center"></span><div style="flex:1"><b style="font-size:20px">${p.t}</b><div class="c5rs" style="font-size:15px;color:var(--s5)"></div></div><span class="c5rl" style="font-size:16px;font-weight:700;color:var(--ac-ink)">지도에서 →</span></div>`).join('')}
          <div id="c5att" style="margin-top:24px"><b style="font-size:21px">이어붙이기 점검</b><div style="margin-top:4px;font-size:15px;color:var(--s5)">새 여정이 다른 여정과 어떻게 이어지는지 봤어요.</div>
            ${[['신규 가입 환영 → 첫 구매 감사', '구매로 앞 여정을 마치면 다음 여정이 맞이해요'], ['첫 구매 감사 → 재구매 이어가기', '구매로 앞 여정을 마치면 다음 여정이 맞이해요']].map(([a, b]) => `<div style="margin-top:10px;border-radius:14px;border:2px solid var(--ac-line);background:var(--ac-soft);padding:12px 16px"><b style="font-size:17px">${a}</b><div style="font-size:14px;color:var(--s6)">${b}</div></div>`).join('')}</div>
        </div>
        <div class="mf"><span id="c5f1" style="flex:1;font-size:16px;color:var(--s5)">한 문장이면 몇 가지만 물어요.</span>
          <span class="btn sm" id="c5ask">${UI.ripple}<span class="spin" id="c5sp" style="display:none;width:22px;height:22px;border-width:3px;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span><span id="c5askT">${IC('spark')}질문 받기</span></span>
          <span class="btn ac sm" id="c5build">${UI.ripple}이대로 만들기</span>
          <span class="btn gh sm" id="c5see">지도에서 보기</span><span class="btn sm" id="c5pre">켜기 전 점검</span></div>
      </div>

      <div class="mod" id="c5act" style="left:560px;top:300px;width:800px;height:660px">
        <div class="mh"><h3>켜기 전 점검</h3><p style="white-space:normal">받는 여정부터 차례로 켭니다. 켠 뒤에 조건을 새로 만족한 고객부터 보내요(지난 사건으로는 보내지 않아요).</p></div>
        <div style="padding:20px 30px">
          ${CARDS.map((c, k) => `<div class="c5ac" style="margin-top:${k ? 12 : 0}px;border-radius:16px;border:2px solid var(--ink);background:var(--soft2);padding:16px 18px;display:flex;align-items:center;gap:14px">
            <span class="ck on">${IC('check')}</span><div style="flex:1"><b style="font-size:20px">${c.name}</b><div class="c5as" style="font-size:15px;color:var(--s5)">초안 · ${c.when}</div></div>
            <span class="c5av" style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:6px"></span></div>`).join('')}
          <div style="margin-top:18px;font-size:16px;color:var(--s5)">단계마다 보내기 2시간 전 스팸 검사 · 걸리면 AI가 한 번 고쳐 다시 검사하고, 그래도 걸리면 멈추고 알려 드려요.</div>
        </div>
        <div class="mf"><span class="btn gh sm">닫기</span><span class="btn ac" id="c5go" style="height:56px">${UI.ripple}${IC('zap')}3개 켜기</span></div>
      </div>
      <div class="abs" id="c5guard" style="left:860px;top:186px;display:flex;gap:12px;z-index:3"></div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '문장 하나로, 고객 생애 지도', ['한 문장으로 여정 만들기', '추천 답 그대로 만들기', '생애 지도가 그려진다', '켜 두면 고객마다 자동']));

      // 지도 카드
      const html = CARDS.map((c, k) => {
        const x = CX(c.col);
        const steps = c.steps.map(([kind, name, when], j) => `
          ${j ? `<div class="c5iv" style="height:26px;padding-left:22px;font-size:14px;color:var(--s5);display:flex;align-items:center">↓ ${c.steps[j][0] === 'wait' ? '기다린 뒤' : '다음 칸'}</div>` : ''}
          <div class="c5st" style="height:58px;border-radius:12px;border:2px solid var(--line);background:#fff;padding:7px 12px">
            <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:800"><span style="color:${stepTone(kind)};font-size:17px">${stepIcon(kind)}</span>${name}<span style="margin-left:auto;font-weight:500;font-size:14px;color:var(--s5)">${kind === 'cond' ? '' : when}</span></div>
            <div style="margin-top:2px;font-size:13.5px;color:var(--s5)">${kind === 'cond' ? when : kind === 'wait' ? '구매하면 여기서 마쳐요' : '<span class="c5got">받음 아직 없음</span>'}</div></div>`).join('');
        return `<div class="c5card" id="c5c${k}" style="position:absolute;left:${x}px;top:176px;width:390px;border-radius:20px;border:2px solid var(--line);background:#fff;box-shadow:0 20px 40px -30px rgba(17,17,17,.35);padding:14px 16px">
          <div style="display:flex;align-items:center;gap:8px"><i class="c5d" style="width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 2px var(--s4)"></i><b style="font-size:20px">${c.name}</b><span style="margin-left:auto;color:var(--s4);font-size:18px">${IC('pen')}</span></div>
          <div style="margin-top:2px;display:flex;font-size:14px;color:var(--s5)"><span class="c5stt">초안</span>&nbsp;·&nbsp;${c.when} 때 시작<span class="tnum c5n" style="margin-left:auto;color:var(--s4)">30일 아직 없음</span></div>
          <div style="margin-top:10px">${steps}</div>
          <div class="c5end" style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:14px;color:var(--s5)">${IC('flag')}구매하면 끝<span class="tnum c5x" style="margin-left:auto;color:var(--ok);font-weight:800">구매 확인 아직 없음</span></div>
        </div>`;
      }).join('');
      root.querySelector('#c5cards').innerHTML = html;
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, C.dur - 0.4);

      // ① 문장 → 질문 → 설계
      V.show($('c5mod'), t, S.mod, S.modOut, { dy: 60, blur: 10, dur: 0.6 });
      const tx = V.typed(SENT, t, S.type, 10);
      $('c5tx').innerHTML = tx ? tx + (t < S.ask ? '<span class="caret"></span>' : '') : '<span style="color:var(--s4)">예: 가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘</span>';
      V.press($('c5ask'), t, S.ask);
      const reading = t >= S.read[0] && t < S.read[1];
      $('c5sp').style.display = reading ? 'block' : 'none';
      $('c5sp').style.transform = `rotate(${(t * 520) % 360}deg)`;
      $('c5askT').innerHTML = reading ? '문장을 읽는 중' : `${UI.icon('spark')}질문 받기`;
      const inQ = t >= S.qs, inRun = t >= S.build + 0.25;
      $('c5in').style.display = inQ ? 'none' : 'block';
      $('c5qs').style.display = inQ && !inRun ? 'block' : 'none';
      R.querySelectorAll('.c5pl').forEach((n, k) => V.show(n, t, S.qs + 0.1 + k * 0.2, null, { dy: 30, blur: 6, dur: 0.45 }));
      $('c5run').style.display = inRun ? 'block' : 'none';
      $('c5ask').style.display = inQ ? 'none' : 'inline-flex';
      $('c5build').style.display = inQ && !inRun ? 'inline-flex' : 'none';
      $('c5see').style.display = t >= S.attach ? 'inline-flex' : 'none';
      $('c5pre').style.display = t >= S.attach ? 'inline-flex' : 'none';
      $('c5f1').textContent = !inQ ? '한 문장이면 몇 가지만 물어요.' : !inRun ? '여정 3개 · 추천 답 그대로' : t < S.attach ? '여정을 차례로 설계하고 있어요' : '여정 3개를 초안으로 저장했어요';
      V.press($('c5build'), t, S.build);
      R.querySelectorAll('.c5rr').forEach((n, k) => {
        const [a, b] = S.run[k];
        const st = t < a ? 'wait' : t < b ? 'run' : 'ok';
        n.querySelector('.c5ri').innerHTML = st === 'run' ? `<span class="spin" style="width:24px;height:24px;border-width:3px;transform:rotate(${(t * 520) % 360}deg)"></span>` : st === 'ok' ? `<span style="color:var(--ok);font-size:26px">${UI.icon('check')}</span>` : '<span style="width:22px;height:22px;border-radius:50%;border:2px solid var(--s3)"></span>';
        n.querySelector('.c5rs').textContent = st === 'run' ? '설계하는 중(30초 안팎)' : st === 'ok' ? '초안으로 저장했어요' : '차례를 기다리는 중';
        n.querySelector('.c5rl').style.opacity = st === 'ok' ? 1 : 0;
      });
      V.show($('c5att'), t, S.attach, null, { dy: 20, blur: 6, dur: 0.45 });

      // ② 지도
      V.show($('c5map'), t, S.map, null, { dy: 40, blur: 8, dur: 0.6 });
      const live = t >= S.live;
      R.querySelectorAll('.c5card').forEach((n, k) => {
        V.show(n, t, S.cards[k], null, { dy: -50, blur: 8, dur: 0.55, sc: 0.04, ease: 'back' });
        n.querySelectorAll('.c5st, .c5iv').forEach((s, j) => V.show(s, t, S.steps + k * 0.5 + j * S.stepGap * 0.6, null, { dy: -16, blur: 4, dur: 0.35 }));
        V.show(n.querySelector('.c5end'), t, S.steps + k * 0.5 + 2.2, null, { dy: -10, blur: 0, dur: 0.3 });
        const c = CARDS[k];
        n.querySelector('.c5stt').textContent = live ? '켜짐' : '초안';
        n.querySelector('.c5d').style.cssText = live ? 'width:12px;height:12px;border-radius:50%;background:var(--ok)' : 'width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 2px var(--s4)';
        n.querySelector('.c5n').textContent = live ? `30일 ${V.won(V.count(t, S.live, S.live + 2.2, c.n))}명` : '30일 아직 없음';
        n.querySelector('.c5x').textContent = live ? `구매 확인 ${V.won(V.count(t, S.live + 0.4, S.live + 2.6, c.exit))}` : '구매 확인 아직 없음';
        n.querySelectorAll('.c5got').forEach((g, j) => { g.textContent = live ? `받음 ${V.won(V.count(t, S.live, S.live + 2.2, Math.round(c.n / (j + 1.4))))}` : '받음 아직 없음'; });
        n.style.borderColor = live ? 'var(--ok-line)' : 'var(--line)';
      });
      V.show(R.querySelector('.c5ghost'), t, S.ghost, null, { dy: -30, blur: 6, dur: 0.5 });
      V.show($('c5legend'), t, S.map + 0.6, null, { dy: 0, blur: 0, dur: 0.4 });
      V.show($('c5band'), t, S.band, null, { dy: 30, blur: 6, dur: 0.5 });
      R.querySelectorAll('.c5dot').forEach((d) => { d.style.background = 'var(--ok)'; });
      // 선: 카드 머리 높이에서 다음 열 카드로 · 켜면 흐름이 흐른다
      const d0 = V.p(t, S.lines[0], S.lines[1], 'io');
      const lines = [0, 1].map((k) => {
        const x1 = CX(k) + 390, x2 = CX(k + 1), y = 206;
        const dash = live ? `stroke-dasharray="10 8" stroke-dashoffset="${(-t * 60) % 36}"` : '';
        const len = x2 - x1;
        return `<line x1="${x1}" y1="${y}" x2="${x1 + len * d0}" y2="${y}" stroke="#334155" stroke-width="3"/>
          ${live ? `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--ac)" stroke-width="3" ${dash}/>` : ''}
          ${d0 > 0.98 ? `<path d="M ${x2 - 10} ${y - 7} L ${x2} ${y} L ${x2 - 10} ${y + 7} Z" fill="#334155"/>` : ''}
          <path d="M ${CX(k) + 390} 520 l 7 -7 l 7 7 l -7 7 Z" fill="var(--ok)" opacity="${V.p(t, S.lines[0] + 0.4, S.lines[1])}"/>`;
      }).join('');
      $('c5svg').innerHTML = lines + [0, 1].map((k) => {
        const mx = (CX(k) + 390 + CX(k + 1)) / 2;
        const label = live ? `이어받음 ${V.won(V.count(t, S.live + 0.4, S.live + 2.6, [128, 41][k]))}명` : '이어짐';
        return d0 > 0.6 ? `<g opacity="${V.p(t, S.lines[0] + 0.6, S.lines[1] + 0.2)}"><rect x="${mx - 64}" y="${206 - 60}" width="128" height="30" rx="15" fill="#fff" stroke="#CBD5E1" stroke-width="2"/><text x="${mx}" y="${206 - 40}" text-anchor="middle" font-size="14" font-weight="700" fill="#334155" font-family="PretendardV">${label}</text></g>` : '';
      }).join('');

      // ③ 켜기 전 점검
      const dim = V.p(t, S.act - 0.1, S.act + 0.3) * (1 - V.p(t, S.actOut - 0.1, S.actOut + 0.3));
      $('c5dim').style.opacity = dim.toFixed(3);
      $('c5dim').style.visibility = dim > 0.01 ? 'visible' : 'hidden';
      V.show($('c5act'), t, S.act, S.actOut, { dy: 50, blur: 8, dur: 0.5 });
      R.querySelectorAll('.c5ac').forEach((n, k) => {
        const v = n.querySelector('.c5av');
        const done = t >= S.done;
        v.innerHTML = done ? `<span style="color:var(--ok)">${UI.icon('check')}</span><span style="color:var(--ok)">켰어요</span>`
          : t >= S.pass[k] ? `<span style="color:var(--ok)">${UI.icon('check')}</span><span style="color:var(--ok)">통과</span>`
            : t >= S.chk[k] ? `<span class="spin" style="width:18px;height:18px;border-width:3px;transform:rotate(${(t * 520) % 360}deg)"></span><span style="color:var(--s5)">검증 중</span>` : '';
        n.style.borderColor = done ? 'var(--ok-line)' : 'var(--ink)';
        n.style.background = done ? 'var(--ok-soft)' : 'var(--soft2)';
      });
      V.press($('c5go'), t, S.go);

      // ④ 지키는 것
      $('c5guard').innerHTML = ['단계마다 보내기 2시간 전 스팸 검사', '켜기 전 일로는 보내지 않아요', '언제든 일시정지'].map((s) => `<span class="pill ok" style="font-size:18px">${UI.icon('shield')}${s}</span>`).join('');
      R.querySelectorAll('#c5guard .pill').forEach((n, k) => V.show(n, t, S.guard + k * 0.2, null, { dy: 20, blur: 4, dur: 0.4 }));

      V.pointer(t, [{ at: S.ask, node: $('c5ask') }], { tail: 0.4 });
      V.pointer(t, [{ at: S.build, node: $('c5build') }], { tail: 0.4 });
      V.pointer(t, [{ at: S.go, node: $('c5go') }], { tail: 0.5 });
    },
  });
})();
