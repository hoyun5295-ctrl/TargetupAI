// 장 1 · AI 한줄로(46초): 한 줄 → 빠진 것만 묻기 → 확인 판(받는 사람 · 종류 · 성격) → 개인화 칼럼 → 장문 3종 동시 작성 → 3사 스팸 검사 → 예약
// 화면 글 = AiLinePage · LineIntakeModal · LineResultCards · utils/ai-line 원문(제목 · 칩 · 단추) · 회사(결온) · 고객 · 숫자는 예시
(() => {
  const C = chOf('c1');
  const LINE = '최근 30일 미구매 VIP에게 가을 재구매 15% 쿠폰 보내줘. 이번 주 일요일까지';
  const COUNT = 2184;
  const REJ = '무료수신거부 080-***-****';
  const SIGN = '\n\n피부의 결을 따뜻하게, 결온\n';
  const MSG = [
    {
      type: '감성형', sub: '[결온] 깊어지는 계절, 김서연 님께',
      segs: [['(광고)', 'ad'], ['[결온]\n'], ['김서연', 'var'], [' 님, 아침 공기가 제법 차가워졌죠.\n이맘때면 피부가 먼저 계절을 알아채요. 세안하고 나면 금세 당기고, 화장이 들뜨는 날도 늘어나요.\n\n그래서 '], ['VIP', 'var'], [' 고객님께만 가을 감사의 마음을 담아 재구매 15% 쿠폰을 준비했어요. 늘 쓰시던 보습을 이번 계절에도 끊김 없이 이어 가시도록요.\n\n▶ 혜택: 재구매 15% 쿠폰\n▶ 기간: 10월 25일(일)까지\n▶ 사용처: 온라인몰 · 전 매장\n\n퇴근길에 '], ['성수점', 'var'], ['에 들르셔도 좋고, 온라인몰에서 편하게 받아 보셔도 좋아요. 깊어지는 계절, 피부의 결은 결온이 따뜻하게 지켜 드릴게요.\n\n쿠폰 받기 ▶ '], ['kyeolon.kr/vip', 'lk'], [SIGN], [REJ, 'rej']],
    },
    {
      type: '혜택강조형', rec: true, sub: '[결온] VIP 재구매 15% 쿠폰이 도착했어요',
      segs: [['(광고)', 'ad'], ['[결온]\n'], ['김서연', 'var'], [' 님, '], ['VIP', 'var'], [' 재구매 15% 쿠폰이 도착했어요.\n\n▶ 혜택: 재구매 15% 쿠폰\n▶ 기간: 10월 25일(일)까지\n▶ 사용처: 온라인몰 · 전 매장\n\n이번 가을 감사 위크에는 다시 찾아 주시는 VIP 고객님께 쿠폰을 먼저 보내 드려요. 건조해지는 계절, 미리 채워 두면 든든한 보습 루틴을 이번 쿠폰으로 가볍게 시작해 보세요.\n\n가까운 '], ['성수점', 'var'], ['에서도 바로 쓰실 수 있어요. 이번 주 일요일이 지나면 쿠폰이 사라지니 잊지 말고 챙겨 두세요.\n\n지금 쿠폰 받기 ▶ '], ['kyeolon.kr/vip', 'lk'], [SIGN], [REJ, 'rej']],
    },
    {
      type: 'MZ 감성형', sub: '[결온] 김서연 님 쿠폰 도착',
      segs: [['(광고)', 'ad'], ['[결온]\n'], ['김서연', 'var'], [' 님, 요즘 세안하고 나면 바로 당기죠?\n그 느낌, 이번 주에 끝내요.\n\n'], ['VIP', 'var'], [' 전용 재구매 15% 쿠폰\n딱 10월 25일(일)까지만!\n\n온라인몰에서 콕,\n'], ['성수점', 'var'], ['에서 슥.\n어디서든 바로 써요.\n\n가을 보습, 미루면 늦어요.\n쿠폰부터 챙겨 두기 ▶ '], ['kyeolon.kr/vip', 'lk'], [SIGN], [REJ, 'rej']],
    },
  ];
  // 문자 바이트(한글 2 · 그 밖 1)
  const bytes = (s) => Array.from(s).reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
  const plain = (segs) => segs.map(([s]) => s).join('');

  const S = {
    win: 2.3, type: 3.2, send: 6.8,
    ask: 7.15, askRead: 8.5, opt: 10.6, askNext: 12.0, askOut: 12.35,
    board: 12.6, cnt: [13.4, 14.6], tiles: [15.6, 16.3, 17.0], boardNext: 19.6, boardOut: 19.95,
    vars: 20.2, rows: [20.7, 20.85, 21.0, 21.15, 21.3], pick: 22.6, chg: 23.0, make: 25.4, out: 26.4,
    gen: 26.8, typeA: 27.6, typeEnd: 36.4,
    spam: [[37.3, 38.25, 39.05], [36.6, 36.7, 37.7], [37.3, 39.0, 39.85]],   // [줄 대기, 확인 중, 통과]
    pickAt: 40.8, sendPanel: 41.3, rsv: 42.5, rsvBtn: 44.2, toast: 44.45,
  };

  const caps1 = [
    [2.4, '보낼 문자를', '<em>한 줄</em>로 적으면'],
    [7.4, '한 줄을 읽고', '빠진 것만<br>콕 집어 묻고'],
    [13.6, '받는 사람은', '실제 발송과<br>같은 계산으로 세고'],
    [16.2, '문안 종류는', '여러 개를<br>한 번에 고르고'],
    [20.4, '우리 고객 정보까지', '골라서 넣으면'],
  ];
  const caps2 = [
    [26.9, '고른 종류마다', '<em>장문 문안</em>을 처음부터 끝까지'],
    [36.8, '보내기 전에', '통신사 3곳 테스트폰으로 스팸 검사'],
    [40.4, '검사를 마친 문안은', '바로 보내거나 예약까지'],
  ];

  const IC = UI.icon;
  V.scene({
    id: 'c1', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}
      ${V.captionHTML(caps1)}
      <div id="c1cap2">${V.captionHTML(caps2, 'top')}</div>
      ${UI.win('c1win', { x: 730, y: 118, w: 1080, h: 870, icon: 'send', title: 'AI 한줄로', sub: '한 줄이면 대상 · 문안 · 검사까지' })}
      <div class="abs dim" id="c1dim" style="left:730px;top:118px;width:1080px;height:870px;border-radius:30px"></div>

      <div class="mod" id="c1ask" style="left:880px;top:236px;width:780px;height:640px">
        <div class="mh"><h3>문안에 넣을 내용을 확인할게요</h3><p><b>한 줄</b>${LINE}</p></div>
        <div id="c1askLoad" class="abs" style="left:0;right:0;top:170px;text-align:center;color:var(--s6);font-size:21px">
          <div class="spin" id="c1sp1" style="margin:0 auto 18px;width:44px;height:44px;border-width:5px"></div>한 줄을 읽고 문안에 필요한데 빠진 것을 찾고 있어요</div>
        <div id="c1askBody" style="padding:28px 34px">
          <div style="font-size:23px;font-weight:800;display:flex;align-items:center;gap:10px"><span class="ac">${IC('msg')}</span>쿠폰은 어디서 쓸 수 있나요?</div>
          <div style="margin-top:8px;font-size:19px;color:var(--s5)">문안에 쓰는 곳을 정확히 적으려고 여쭤요</div>
          <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap">
            <span class="chip">온라인몰</span><span class="chip">매장</span><span class="chip" id="c1opt">${UI.ripple}온라인몰 · 매장 모두</span>
          </div>
          <div style="margin-top:14px;height:60px;border-radius:14px;border:2px solid var(--s3);display:flex;align-items:center;padding:0 18px;font-size:20px;color:var(--s4)">직접 적기</div>
          <div style="margin-top:26px;font-size:18px;line-height:1.55;color:var(--s5)">읽은 값 · 대상 「최근 30일 미구매 · VIP」은 다시 묻지 않아요. 비워 둔 질문은 문안에 넣지 않아요(지어내지 않아요).</div>
        </div>
        <div class="mf"><span class="btn gh sm">나중에</span><span class="btn sm" id="c1askNext">${UI.ripple}다음</span></div>
      </div>
      <div class="abs" id="c1tag" style="left:880px;top:900px;display:flex;gap:12px">
        <span class="pill" style="background:#fff;border:2px solid var(--ac-line);color:var(--ac-ink)">${IC('check')}혜택 · 재구매 15% 쿠폰</span>
        <span class="pill" style="background:#fff;border:2px solid var(--ac-line);color:var(--ac-ink)">${IC('check')}기간 · 이번 주 일요일까지</span>
        <span class="pill sl">한 줄에서 읽어서 다시 묻지 않아요</span>
      </div>

      <div class="mod" id="c1board" style="left:750px;top:150px;width:1040px;height:810px">
        <div class="mh"><h3>이렇게 만들어요</h3><p><b>한 줄</b>${LINE}</p></div>
        <div style="display:grid;grid-template-columns:1.25fr 1fr;height:600px">
          <div style="padding:24px 30px;border-right:2px solid var(--soft)">
            <div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">한 줄에서 읽은 대상</span><span class="chip" style="height:42px;font-size:18px;border-color:var(--ac-line);color:var(--ac-ink)">${IC('filter')}직접 타겟 선택</span></div>
            <div style="margin-top:12px;display:flex;gap:10px"><span class="chip acc"><i class="dot"></i>최근 30일 미구매</span><span class="chip acc"><i class="dot"></i>VIP</span></div>
            <div style="margin-top:18px;height:74px;border-radius:16px;background:var(--ok-soft);border:2px solid var(--ok-line);display:flex;align-items:center;justify-content:space-between;padding:0 22px">
              <span style="font-size:20px;font-weight:700;color:#065F46;display:flex;align-items:center;gap:10px">${IC('users')}받는 사람(발송 명단과 같은 계산)</span>
              <b class="tnum" id="c1num" style="font-size:34px;font-weight:900;color:#065F46">0명</b></div>
            <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px 22px;font-size:19px;color:var(--s6);align-items:center">
              <span>혜택 <b style="color:var(--ink)">재구매 15% 쿠폰</b></span><span>기간 <b style="color:var(--ink)">10월 25일(일)까지</b></span>
              <span style="display:flex;align-items:center;gap:6px">채널 <i class="pill sl" style="padding:4px 10px;font-size:15px;font-style:normal">SMS</i><i class="pill dk" style="padding:4px 10px;font-size:15px;font-style:normal">LMS</i><i class="pill sl" style="padding:4px 10px;font-size:15px;font-style:normal">MMS</i></span>
            </div>
            <div class="lbl" style="margin-top:22px">문안 종류(여러 개)</div>
            <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
              ${[['감성형', '계절감 · 다정한 말투'], ['혜택강조형', '혜택을 맨 앞에', 1], ['MZ 감성형', '짧고 가벼운 말투'], ['직접입력', '내가 씀']].map(([n, d, r], k) => `
                <div class="tile" id="c1t${k}" style="position:relative;overflow:hidden;height:104px;border-radius:16px;border:2px solid var(--line);padding:16px 18px;background:#fff">${UI.ripple}
                  ${r ? '<span class="pill ac" style="position:absolute;right:12px;top:12px;padding:4px 10px;font-size:14px">추천</span>' : ''}
                  <b style="display:block;font-size:22px;font-weight:850">${n}</b><span style="display:block;margin-top:4px;font-size:17px;color:var(--s5)">${d}</span>
                  <span class="c1tk" style="position:absolute;right:14px;bottom:12px;width:34px;height:34px;border-radius:50%;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;opacity:0">${IC('check')}</span></div>`).join('')}
            </div>
          </div>
          <div style="padding:24px 26px;background:var(--soft2)">
            <span class="lbl">문자 성격</span>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div style="border-radius:16px;border:3px solid var(--ink);background:#fff;padding:16px"><b style="display:block;font-size:22px">마케팅</b><span style="font-size:16px;color:var(--s6)">(광고) 표기 · 무료거부 080</span></div>
              <div style="border-radius:16px;border:2px solid var(--line);background:#fff;padding:16px"><b style="display:block;font-size:22px">안부 · 알림</b><span style="font-size:16px;color:var(--s5)">광고 표기 없이</span></div>
            </div>
            <p style="margin-top:14px;font-size:17px;line-height:1.6;color:var(--s6)">한 줄을 읽고 마케팅으로 골랐어요. 이 성격의 브랜드 말투 · 대표 문안으로 써요. 할인 · 쿠폰처럼 구매를 권하면 마케팅으로 보내야 해요(광고 표기 의무).</p>
            <div style="margin-top:20px;border-radius:16px;background:#fff;border:2px solid var(--line);padding:16px 18px;display:flex;gap:14px;align-items:center">
              <span style="width:46px;height:46px;border-radius:13px;background:var(--ac-soft);color:var(--ac);display:flex;align-items:center;justify-content:center;font-size:24px">${IC('brain')}</span>
              <div><b style="display:block;font-size:19px">AI 메모리 · 결온 마케팅 말투</b><span style="font-size:16px;color:var(--s5)">대표 문안에서 배운 말투로 씁니다</span></div>
            </div>
          </div>
        </div>
        <div class="mf"><span class="btn gh sm">닫기(결과 보존)</span><span class="btn" id="c1boardNext" style="height:56px">${UI.ripple}${IC('users')}다음 · 개인화 고르기</span></div>
      </div>

      <div class="mod" id="c1vars" style="left:860px;top:180px;width:820px;height:760px">
        <div class="mh"><h3>문안에 어떤 고객 정보를 넣을까요?</h3><p><b>한 줄</b>${LINE}</p></div>
        <div style="padding:20px 32px">
          <div style="font-size:19px;color:var(--s5)">받는 사람 <b class="tnum" style="color:var(--ink)">${V.won(COUNT)}명</b> · 감성형 · 혜택강조형 · MZ 감성형 · 마케팅</div>
          <div style="margin-top:8px;font-size:20px;color:var(--s7)">이 대상 1위 고객 <b>김서연</b>의 실제 값이에요. 고른 칼럼만 문안에 넣고, 고르지 않은 칼럼은 넣지 않아요.</div>
          <div style="margin-top:16px;border:2px solid var(--line);border-radius:18px;overflow:hidden">
            ${[['이름', '김서연', '추천', 97, 1], ['등급', 'VIP', '추천', 100, 1], ['단골 매장', '성수점', '회사 칼럼', 64, 0], ['최근 구매 상품', '앰버 세럼', '회사 칼럼', 81, 0], ['생일 월', '빈칸', '', 18, 2]].map(([n, v, b, f, on], k) => `
              <div class="row" id="c1r${k}" style="position:relative;overflow:hidden;height:66px;display:flex;align-items:center;gap:16px;padding:0 20px;font-size:21px;${k ? 'border-top:2px solid var(--soft);' : ''}${on === 2 ? 'color:var(--s4)' : ''}">${UI.ripple}
                <span class="ck ${on === 1 ? 'on' : ''}" id="c1ck${k}">${on === 2 ? IC('lock') : on === 1 ? IC('check') : ''}</span>
                <span style="width:150px;color:var(--s5)">${n}</span><b style="flex:1;font-weight:${on === 2 ? 500 : 850}">${v}</b>
                ${b ? `<span class="pill ${b === '추천' ? 'ac' : 'sl'}" style="padding:5px 12px;font-size:15px">${b}</span>` : ''}
                <span class="tnum" style="width:130px;text-align:right;font-size:17px;color:var(--s5)">${f}%${on === 2 ? ' · 빈칸 많음' : ''}</span></div>`).join('')}
          </div>
          <div id="c1chg" style="margin-top:14px;font-size:19px;font-weight:700;color:var(--ac-ink)">넣으면 이렇게 바뀌어요 · %이름% → 김서연 · %등급% → VIP · %단골 매장% → 성수점</div>
          <div style="margin-top:8px;font-size:16px;color:var(--s5)">%칼럼% 자리는 받는 사람마다 그 고객의 값으로 바뀌어요 · 채움 % = 이 대상 안에서 값이 있는 비율 · 30% 미만은 잠금</div>
        </div>
        <div class="mf"><span class="btn gh sm" style="margin-right:auto">확인 판</span><span class="btn gh sm">넣지 않고 만들기</span>
          <span class="btn ac" id="c1make" style="height:56px">${UI.ripple}<span class="spin" id="c1sp2" style="display:none;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span><span id="c1mkT">${IC('spark')}만들기</span></span></div>
      </div>

      <div id="c1gen">
        ${MSG.map((m, k) => `
          <div class="abs c1lab" id="c1lab${k}" style="left:${388 + k * 400}px;top:262px;width:344px;display:flex;align-items:center;justify-content:space-between">
            <span class="pill ${m.rec ? 'dk' : 'sl'}" style="font-size:19px">${m.type}${m.rec ? ' <i style="font-style:normal;color:var(--ac)">추천</i>' : ''}</span>
            <span class="pill sl" id="c1spam${k}" style="font-size:16px"></span></div>
          ${UI.phone(`c1ph${k}`, { x: 388 + k * 400, y: 318, name: '결온', color: '#9A5B2E', av: '결', scale: 0.86 })}`).join('')}
      </div>
      <div class="sf" id="c1send" style="left:1010px;top:330px;width:700px;height:560px;padding:32px 36px">
        <div style="font-size:30px;font-weight:850">보내는 때</div>
        <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="opt" style="position:relative;overflow:hidden;height:84px;border-radius:18px;border:2px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800">${IC('send')}&nbsp;즉시 보내기</div>
          <div class="opt" id="c1rsv" style="position:relative;overflow:hidden;height:84px;border-radius:18px;border:2px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800">${UI.ripple}${IC('clock')}&nbsp;예약</div>
        </div>
        <div id="c1when" style="margin-top:22px;border-radius:18px;background:var(--soft2);border:2px solid var(--line);padding:20px 24px">
          <div style="display:flex;gap:14px"><span class="chip" style="font-size:22px">${IC('cal')}10월 24일(토)</span><span class="chip on" style="font-size:22px">${IC('clock')}오전 10:00</span></div>
          <div style="margin-top:14px;font-size:18px;color:var(--s5)">즉시 보내거나 오전 8시부터 밤 9시 사이로 예약합니다.</div>
        </div>
        <div style="margin-top:22px;font-size:20px;color:var(--s6);display:flex;justify-content:space-between"><span>받는 사람</span><b class="tnum" style="color:var(--ink)">${V.won(COUNT)}명</b></div>
        <div style="margin-top:8px;font-size:20px;color:var(--s6);display:flex;justify-content:space-between"><span>문안</span><b style="color:var(--ink)">혜택강조형 · LMS · 스팸 통과 3사</b></div>
        <span class="btn" id="c1rsvBtn" style="position:absolute;left:36px;right:36px;bottom:30px;height:70px;font-size:25px">${UI.ripple}예약하기</span>
      </div>
      <div class="abs" id="c1toast" style="left:1180px;top:912px;padding:18px 30px;border-radius:999px;background:var(--ink);color:#fff;font-size:24px;font-weight:800;display:flex;align-items:center;gap:12px"><span class="ac">${IC('check')}</span>예약 완료 · 10월 24일 오전 10:00 · ${V.won(COUNT)}명</div>`;

      // 장 표지는 맨 위
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '한 줄 적으면, 장문 문안까지', ['한 줄 적기', '빠진 것만 답하기', '받는 사람 · 종류 · 고객 정보', '장문 생성 · 스팸 검사 · 예약']));
      // 명령 카드(창 몸통)
      this.root = root;
      root.querySelector('#c1win .body').innerHTML = `
        <div style="margin:36px 40px 0;border-radius:24px;background:#fff;border:2px solid var(--line);box-shadow:0 24px 50px -30px rgba(17,17,17,.3);padding:26px 28px;display:flex;align-items:flex-end;gap:22px">
          <img src="../../../packages/frontend/public/brand/wordmark.png" alt="한줄로" style="height:34px;margin-bottom:12px">
          <div style="flex:1;border-bottom:3px solid var(--ink);padding:0 0 10px;font-size:27px;font-weight:650;line-height:1.45;min-height:92px" id="c1tx"></div>
          <span class="btn gh sm">${IC('img')}이미지</span>
          <span class="btn ac" id="c1go" style="height:56px">${UI.ripple}${IC('send')}생성</span>
        </div>
        <div style="margin:12px 46px 0;display:flex;justify-content:space-between;font-size:17px;color:var(--s5)"><span>Ctrl(⌘) + Enter로 바로 생성 · 이미지 버튼으로 이미지 속 문안 불러오기</span><span class="tnum" id="c1len">0자</span></div>
        <div style="margin:34px 40px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px">
          ${[0, 1, 2].map(() => `<div style="height:330px;border-radius:22px;background:#fff;border:2px dashed var(--line);padding:24px"><div style="height:18px;width:40%;border-radius:9px;background:var(--soft)"></div><div style="margin-top:22px;height:12px;border-radius:6px;background:var(--soft)"></div><div style="margin-top:12px;height:12px;width:86%;border-radius:6px;background:var(--soft)"></div><div style="margin-top:12px;height:12px;width:72%;border-radius:6px;background:var(--soft)"></div></div>`).join('')}
        </div>`;
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps1, S.out);
      V.captions(R.querySelector('#c1cap2 .caps'), t, caps2, C.dur - 0.4);

      // ① 한 줄 적기
      const winOut = V.p(t, S.out - 0.2, S.gen + 0.2, 'io');
      V.show($('c1win'), t, S.win, null, { dy: 70, blur: 12, dur: 0.7, base: `translateY(${(winOut * 40).toFixed(1)}px) scale(${(1 - 0.06 * winOut).toFixed(3)})` });
      $('c1win').style.opacity = (Number($('c1win').style.opacity) * (1 - winOut)).toFixed(3);
      const tx = V.typed(LINE, t, S.type, 13);
      $('c1tx').innerHTML = tx ? `${tx}<span class="caret" style="opacity:${t > S.send || Math.floor(t * 3) % 2 === 0 ? 1 : 0}"></span>` : '<span style="color:var(--s4)">예: 최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘</span>';
      $('c1len').textContent = `${V.chars(tx).length}자`;
      V.press($('c1go'), t, S.send);

      // 창 위 흐림(모달이 떠 있는 동안)
      const dimOn = V.p(t, S.ask - 0.1, S.ask + 0.3) * (1 - V.p(t, S.out - 0.2, S.out + 0.2));
      $('c1dim').style.opacity = dimOn.toFixed(3);
      $('c1dim').style.visibility = dimOn > 0.01 ? 'visible' : 'hidden';

      // ② 빠진 것만 묻기
      V.show($('c1ask'), t, S.ask, S.askOut, { dy: 50, sc: 0.04, blur: 10, dur: 0.5 });
      $('c1sp1').style.transform = `rotate(${(t * 520) % 360}deg)`;
      V.show($('c1askLoad'), t, S.ask, S.askRead - 0.15, { dy: 0, blur: 4, dur: 0.3, out: 0.2 });
      V.show($('c1askBody'), t, S.askRead, null, { dy: 24, blur: 8, dur: 0.45 });
      V.press($('c1opt'), t, S.opt);
      $('c1opt').className = `chip${t >= S.opt + 0.05 ? ' on' : ''}`;
      V.press($('c1askNext'), t, S.askNext);
      V.show($('c1tag'), t, S.askRead + 0.5, S.askOut, { dy: 20, blur: 6, dur: 0.45 });

      // ③ 확인 판
      V.show($('c1board'), t, S.board, S.boardOut, { dy: 50, sc: 0.03, blur: 10, dur: 0.55 });
      $('c1num').textContent = `${V.won(V.count(t, S.cnt[0], S.cnt[1], COUNT))}명`;
      [0, 1, 2].forEach((k) => {
        const on = t >= S.tiles[k] + 0.05;
        const tile = $(`c1t${k}`);
        V.press(tile, t, S.tiles[k]);
        tile.style.borderColor = on ? 'var(--ink)' : 'var(--line)';
        tile.style.boxShadow = on ? 'inset 0 0 0 2px var(--ink)' : 'none';
        tile.querySelector('.c1tk').style.opacity = on ? 1 : 0;
      });
      V.press($('c1boardNext'), t, S.boardNext);

      // ④ 개인화 칼럼
      V.show($('c1vars'), t, S.vars, S.out, { dy: 50, sc: 0.03, blur: 10, dur: 0.55 });
      S.rows.forEach((a, k) => V.show($(`c1r${k}`), t, a, null, { dy: 0, dx: 40, blur: 6, dur: 0.4 }));
      V.press($('c1r2'), t, S.pick);
      const picked = t >= S.pick + 0.05;
      $('c1ck2').className = `ck${picked ? ' on' : ''}`;
      $('c1ck2').innerHTML = picked ? UI.icon('check') : '';
      V.show($('c1chg'), t, S.chg, null, { dy: 14, blur: 4, dur: 0.4 });
      V.press($('c1make'), t, S.make);
      const busy = t >= S.make + 0.1;
      $('c1sp2').style.display = busy ? 'block' : 'none';
      $('c1sp2').style.transform = `rotate(${(t * 520) % 360}deg)`;
      $('c1mkT').innerHTML = busy ? '만드는 중' : `${UI.icon('spark')}만들기`;

      // ⑤ 장문 3종 동시 작성
      const pick = V.p(t, S.pickAt, S.pickAt + 0.7, 'io');
      MSG.forEach((m, k) => {
        const ph = $(`c1ph${k}`), lab = $(`c1lab${k}`);
        const a = S.gen + 0.15 * k;
        const away = k === 1 ? 0 : pick;
        const shift = k === 1 ? (-400 + 172) * pick : 0;   // 고른 문안은 왼쪽으로
        const v = V.show(ph, t, a, null, { dy: 80, blur: 12, dur: 0.7, base: `translateX(${shift.toFixed(1)}px)` });
        ph.style.opacity = (v * (1 - away)).toFixed(3);
        ph.style.transform += ' scale(0.86)';
        const lv = V.show(lab, t, a + 0.1, null, { dy: 30, blur: 6, dur: 0.5, base: `translateX(${shift.toFixed(1)}px)` });
        lab.style.opacity = (lv * (1 - away)).toFixed(3);
        // 타자: 모든 문안이 같은 때 끝나게 속도를 맞춘다
        const st = S.typeA + 0.25 * k;
        const total = V.chars(m.sub).length + V.segLen(m.segs);
        const n = V.typedN(t, st, total / (S.typeEnd - st), total);
        const ns = Math.min(n, V.chars(m.sub).length), nb = Math.max(0, n - V.chars(m.sub).length);
        const typing = n > 0 && n < total;
        ph.querySelector('.in').innerHTML = n > 0 ? `<div class="meta">오늘 오전 10:00</div><div class="bub"><span class="sj">${V.chars(m.sub).slice(0, ns).join('')}</span>${V.segHTML(m.segs, nb)}${typing ? '<span class="caret"></span>' : ''}</div>
          <div class="meta" style="margin-top:10px">LMS · <span class="tnum">${V.won(bytes(V.chars(m.sub).slice(0, ns).join('')) + bytes(V.chars(plain(m.segs)).slice(0, nb).join('')))}</span> / 2,000바이트</div>` : '';
        UI.follow(ph);
        // 스팸 칩
        const [q, run, pass] = S.spam[k];
        const chip = $(`c1spam${k}`);
        if (t < q) { chip.className = 'pill sl'; chip.innerHTML = `${UI.icon('clock')}검사 전`; }
        else if (t < run) { chip.className = 'pill sl'; chip.innerHTML = `${UI.icon('clock')}줄 대기`; }
        else if (t < pass) { chip.className = 'pill wn'; chip.innerHTML = `<span class="spin" style="width:18px;height:18px;border-width:3px;transform:rotate(${(t * 520) % 360}deg)"></span>확인 중 · ${Math.max(1, Math.floor(t - run))}초`; }
        else { chip.className = 'pill ok'; chip.innerHTML = `${UI.icon('shield')}스팸 통과 · 3사`; }
        chip.style.transform = t >= pass ? `scale(${(1 + 0.14 * (1 - V.p(t, pass, pass + 0.3))).toFixed(3)})` : '';
      });

      // ⑥ 예약
      V.show($('c1send'), t, S.sendPanel, null, { dy: 0, dx: 120, blur: 10, dur: 0.6 });
      const rs = $('c1rsv');
      V.press(rs, t, S.rsv);
      rs.style.borderColor = t >= S.rsv + 0.05 ? 'var(--ink)' : 'var(--line)';
      rs.style.background = t >= S.rsv + 0.05 ? 'var(--ink)' : '#fff';
      rs.style.color = t >= S.rsv + 0.05 ? '#fff' : 'var(--ink)';
      V.show($('c1when'), t, S.rsv + 0.2, null, { dy: 20, blur: 6, dur: 0.4 });
      V.press($('c1rsvBtn'), t, S.rsvBtn);
      V.show($('c1toast'), t, S.toast, null, { dy: 30, blur: 0, sc: 0.3, ease: 'back', dur: 0.4 });

      V.pointer(t, [
        { at: S.send, node: $('c1go') },
        { at: S.opt, node: $('c1opt') },
        { at: S.askNext, node: $('c1askNext') },
        { at: S.tiles[0], node: $('c1t0') }, { at: S.tiles[1], node: $('c1t1') }, { at: S.tiles[2], node: $('c1t2') },
        { at: S.boardNext, node: $('c1boardNext') },
        { at: S.pick, node: $('c1r2'), fx: 0.3 },
        { at: S.make, node: $('c1make') },
      ], { tail: 0.5 });
      V.pointer(t, [
        { at: S.pickAt, node: $('c1lab1'), fx: 0.25 },
        { at: S.rsv, node: $('c1rsv') },
        { at: S.rsvBtn, node: $('c1rsvBtn') },
      ], { tail: 0.7 });
    },
  });
})();
