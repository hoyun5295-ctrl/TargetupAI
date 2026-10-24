// 장 7 · 마케팅 플래너(14초): 한 달 행사를 달력에 담기 → 채널마다 완성본을 미리(문자는 스팸 검사까지) → 첫 발송 3일 전 휴대폰 확인 링크 → 한 번 승인 → 예정일에 발송
// 화면 글 = plan-feature-intros(marketing-planner) 원문 · 회사(소요웨어) · 날짜 · 숫자는 예시
(() => {
  const C = chOf('c7');
  const IC = UI.icon;
  const EV = [
    { n: '소요웨어 어텀 위크', d: [6, 8], c: 'var(--ac)', ch: ['문자 11/5', '모바일 DM 11/6', '이메일 11/6'] },
    { n: '첫 추위 니트 입고', d: [20, 20], c: 'var(--ink)', ch: ['문자 11/20'] },
    { n: 'F/W 시즌 오프', d: [27, 30], c: '#9A5B2E', ch: ['모바일 DM 11/27', '이메일 11/27'] },
  ];
  const S = { cal: 3.0, ev: [3.6, 4.0, 4.4], det: 4.9, made: [6.4, 6.8, 7.2], sms: 9.4, open: 10.4, approve: 11.9, done: 12.2 };
  const caps = [
    [3.1, '한 달 행사를 달력에 담고 재료만 넣으면', '채널마다 <em>완성본</em>을 미리'],
    [9.2, '첫 발송 3일 전 휴대폰으로', '확인하고 <em>한 번</em> 승인하면 끝'],
  ];
  // 2026년 11월 = 1일 일요일
  const cell = (day) => ({ x: ((day - 1) % 7), y: Math.floor((day - 1) / 7) });

  V.scene({
    id: 'c7', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps, 'top')}
      <div class="sf" id="c7cal" style="left:120px;top:262px;width:1010px;height:760px;padding:24px 28px">
        <div style="display:flex;align-items:center;gap:12px"><span style="width:46px;height:46px;border-radius:14px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px">${IC('cal')}</span><b style="font-size:26px">마케팅 플래너 · 2026년 11월</b><span class="pill sl" style="margin-left:auto;font-size:16px">소요웨어</span></div>
        <div style="position:relative;margin-top:18px;display:grid;grid-template-columns:repeat(7,1fr);gap:8px">
          ${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<b style="font-size:16px;color:var(--s5);text-align:center">${d}</b>`).join('')}
          ${Array.from({ length: 35 }, (_, i) => `<div style="height:112px;border-radius:12px;background:${i < 30 ? 'var(--soft2)' : 'transparent'};padding:8px 10px;font-size:15px;font-weight:700;color:var(--s6)">${i < 30 ? i + 1 : ''}</div>`).join('')}
          <div id="c7bars" style="position:absolute;left:0;top:32px;right:0;bottom:0"></div>
        </div>
      </div>
      <div class="sf" id="c7det" style="left:1170px;top:262px;width:640px;padding:24px 28px">
        <div style="font-size:15px;font-weight:800;color:var(--s5)">행사</div>
        <div style="margin-top:4px;font-size:28px;font-weight:900">소요웨어 어텀 위크</div>
        <div style="margin-top:4px;font-size:17px;color:var(--s6)">11월 6일(금) ~ 8일(일) · 혜택 문구는 적은 그대로 들어갑니다</div>
        <div style="margin-top:16px;font-size:15px;font-weight:800;color:var(--s5)">채널과 날짜</div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">${EV[0].ch.map((s) => `<span class="pill dk" style="font-size:16px">${s}</span>`).join('')}</div>
        <div style="margin-top:16px;font-size:15px;font-weight:800;color:var(--s5)">재료</div>
        <div style="margin-top:8px;display:flex;gap:10px"><img src="posters/p7-soyo-event.jpg" alt="" style="width:84px;height:112px;object-fit:cover;border-radius:10px"><img src="posters/p6-soyo-product.jpg" alt="" style="width:84px;height:112px;object-fit:cover;border-radius:10px"><img src="posters/src-soyo.jpg" alt="" style="width:112px;height:112px;object-fit:cover;border-radius:10px"></div>
        <div style="margin-top:18px;font-size:15px;font-weight:800;color:var(--s5)">미리 만든 완성본</div>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          <div class="c7m" style="border-radius:14px;border:2px solid var(--line);overflow:hidden"><img src="posters/p7-soyo-event.jpg" alt="" style="display:block;width:100%;height:150px;object-fit:cover"><div style="padding:8px 10px;font-size:15px;font-weight:800">모바일 DM</div></div>
          <div class="c7m" style="border-radius:14px;border:2px solid var(--line);overflow:hidden"><img src="posters/p6-soyo-product.jpg" alt="" style="display:block;width:100%;height:150px;object-fit:cover;object-position:50% 70%"><div style="padding:8px 10px;font-size:15px;font-weight:800">이메일</div></div>
          <div class="c7m" style="border-radius:14px;border:2px solid var(--line);padding:10px;background:var(--soft2)"><div style="border-radius:12px;background:#fff;padding:8px 10px;font-size:13px;line-height:1.5;height:120px;overflow:hidden">(광고)[소요웨어] 고객님, 어텀 위크가 시작되었습니다. 신상 니트가 입고되었습니다.</div><div style="margin-top:6px;font-size:15px;font-weight:800;display:flex;align-items:center;gap:6px">문자 <span class="pill ok" style="padding:2px 8px;font-size:12px">검사 통과</span></div></div>
        </div>
      </div>
      <div class="phone" id="c7ph" style="left:1300px;top:262px;transform-origin:0 0">
        <div class="scr"><div class="isl"></div><div class="sb"><span>10:00</span><span>● ● ●</span></div>
          <div id="c7sms" style="position:absolute;left:0;right:0;top:58px;bottom:0">
            <div style="height:86px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-bottom:1px solid #eee;background:#FBFBFB"><span style="width:44px;height:44px;border-radius:50%;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900">한</span><b style="font-size:15px;margin-top:4px">한줄로</b></div>
            <div style="padding:16px"><div class="meta">11월 3일 화요일 오전 10:00</div><div class="bub">[한줄로] 소요웨어 「어텀 위크」 첫 발송이 3일 남았어요. 문안 · 모바일 DM · 이메일 실물과 받는 사람 수를 확인하고 승인해 주세요.<br><span class="lk" id="c7lk">확인하고 승인하기</span></div></div>
          </div>
          <div id="c7app" style="position:absolute;left:0;right:0;top:58px;bottom:0;background:#fff;padding:18px 18px">
            <div style="font-size:14px;font-weight:800;color:var(--s5)">승인 요청 · 소요웨어</div><div style="font-size:24px;font-weight:900;margin-top:2px">어텀 위크</div>
            <img src="posters/p7-soyo-event.jpg" alt="" style="margin-top:12px;width:100%;height:300px;object-fit:cover;border-radius:14px">
            <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:15px"><span style="color:var(--s5)">받는 사람</span><b class="tnum">3,412명</b></div>
            <div style="margin-top:6px;display:flex;justify-content:space-between;font-size:15px"><span style="color:var(--s5)">보내는 날</span><b>11/5 문자 · 11/6 DM · 이메일</b></div>
            <div style="margin-top:6px;font-size:13px;color:var(--s5)">그날 오전 8시부터 스팸 검사를 한 번 더 하고 승인한 그대로 보냅니다.</div>
            <span class="btn ac" id="c7ok" style="position:absolute;left:18px;right:18px;bottom:26px;height:58px">${UI.ripple}<span id="c7okT">${IC('check')}이 행사 승인</span></span>
          </div>
        </div>
      </div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '한 달 행사를 달력에 담으면', ['행사 · 채널 · 날짜 담기', '완성본을 미리 만들어 두고', '휴대폰으로 확인 · 승인', '예정일에 자동 발송']));
      // 행사 막대(주마다 끊어서)
      const W = (1010 - 56 - 48) / 7;   // 칸 폭(대략)
      root.querySelector('#c7bars').innerHTML = EV.map((e, k) => {
        const segs = [];
        for (let d = e.d[0]; d <= e.d[1];) {
          const c0 = cell(d), endOfRow = d + (6 - c0.x);
          const to = Math.min(e.d[1], endOfRow);
          segs.push({ x: c0.x, y: c0.y, w: to - d + 1 });
          d = to + 1;
        }
        return segs.map((sg) => `<div class="c7b" data-k="${k}" style="position:absolute;left:${sg.x * (W + 8) + 4}px;top:${sg.y * 120 + 42}px;width:${sg.w * (W + 8) - 16}px;height:34px;border-radius:9px;background:${e.c};color:#fff;font-size:15px;font-weight:800;display:flex;align-items:center;padding:0 10px;white-space:nowrap;overflow:hidden">${e.n}</div>`).join('');
      }).join('');
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, C.dur - 0.3);
      const toPhone = V.p(t, S.sms - 0.5, S.sms, 'io');
      V.show($('c7cal'), t, S.cal, null, { dy: 60, blur: 10, dur: 0.6 });
      $('c7cal').style.opacity = (Number($('c7cal').style.opacity) * (1 - 0.6 * toPhone)).toFixed(3);
      R.querySelectorAll('.c7b').forEach((n) => { const k = Number(n.dataset.k); V.show(n, t, S.ev[k], null, { dy: 0, dx: -30, blur: 4, dur: 0.4 }); });
      V.show($('c7det'), t, S.det, S.sms - 0.5, { dy: 0, dx: 60, blur: 8, dur: 0.5 });
      R.querySelectorAll('.c7m').forEach((n, k) => V.show(n, t, S.made[k], null, { dy: 20, blur: 6, dur: 0.4, sc: 0.08, ease: 'back' }));
      // 휴대폰 확인 · 승인
      const ph = $('c7ph');
      V.show(ph, t, S.sms, null, { dy: 80, blur: 10, dur: 0.6 });
      ph.style.transform += ' scale(0.9)';
      const open = V.p(t, S.open, S.open + 0.4, 'io');
      $('c7app').style.transform = `translateY(${((1 - open) * 105).toFixed(1)}%)`;
      $('c7app').style.opacity = open > 0 ? 1 : 0;
      V.press($('c7ok'), t, S.approve);
      const done = t >= S.done;
      $('c7ok').style.background = done ? 'var(--ok)' : 'var(--ac)';
      $('c7okT').innerHTML = done ? `${UI.icon('check')}승인 완료 · 예정일에 보냅니다` : `${UI.icon('check')}이 행사 승인`;
      V.pointer(t, [{ at: S.open, node: $('c7lk') }, { at: S.approve, node: $('c7ok') }], { tail: 0.6 });
    },
  });
})();
