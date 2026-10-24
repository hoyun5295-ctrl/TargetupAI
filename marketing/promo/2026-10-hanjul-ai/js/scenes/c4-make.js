// 장 4 · 만들기(30초): 재료(행사 페이지 주소 · 사진 · 글) → 「이 문구 그대로 쓰기」 → 모바일 DM · 이메일 완성본 나란히 → 고칠 곳만 채우기 → 보낸 뒤 반응 → 인앱(장바구니 담는 순간)
// 화면 글 = QuickCampaignPage · MakeInputs · MakeSendModal · plan-feature-intros(mobile-dm · email · inapp) 원문 · 숫자는 예시
(() => {
  const C = chOf('c4');
  const IC = UI.icon;
  const P = (n) => `posters/${n}.jpg`;
  const URL = 'kyeolon.kr/autumn-week';
  const S = {
    win: 3.0, url: 3.5, read: 5.0, card: 5.4, keep: 6.6, pics: [6.0, 6.25], kinds: [7.1, 7.35], make: 7.9, out: 8.5,
    res: 8.6, dmScroll: [10.0, 17.6], email: 9.2, fix: 9.6, fixFill: [13.2, 15.4], ok: 15.8,
    stats: 19.0, stat: [19.4, 22.4], again: 22.6,
    shop: 24.4, cart: 26.0, pop: 26.35, trig: 26.6,
  };
  const caps = [[3.1, '가진 재료만', '넣으면'], [5.6, '할인율 · 기간은', '<em>적은 그대로</em> 싣고']];
  const caps2 = [
    [8.7, '같은 재료로', '모바일 DM과 이메일이 <em>나란히</em> 완성'],
    [19.1, '보낸 뒤에는', '누가 보고, 누르고, 참여했는지까지'],
    [24.5, '자사몰에 들어온 바로 그 순간', '<em>인앱 메시지</em>까지'],
  ];
  const DM = `
    <img src="${P('p3-kyeolon-event')}" alt="" style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover">
    <div style="padding:22px 20px 6px;text-align:center"><div style="font-size:13px;letter-spacing:.2em;color:#9A5B2E;font-weight:800">KYEOLON · VIP</div>
      <div style="margin-top:6px;font-size:25px;font-weight:900;line-height:1.25">VIP 고객님께만<br>가을 감사의 마음을</div>
      <div style="margin-top:8px;font-size:14px;color:#57534e;line-height:1.6">늘 결온을 아껴 주셔서 고맙습니다. 건조해지는 계절, 미리 채워 두는 보습을 준비했어요.</div></div>
    <div style="margin:14px 18px;border-radius:16px;border:2px dashed #9A5B2E;padding:16px;text-align:center;background:#FBF6F1">
      <div style="font-size:13px;font-weight:800;color:#9A5B2E">VIP 전용 쿠폰</div><div style="font-size:34px;font-weight:900;color:#3b2416">재구매 15%</div><div style="font-size:13px;color:#57534e">10월 25일(일)까지 · 온라인몰 · 전 매장</div></div>
    <div style="margin:0 18px;border-radius:16px;overflow:hidden;border:1px solid #eee"><img src="${P('p1-kyeolon-product')}" alt="" style="display:block;width:100%;height:230px;object-fit:cover;object-position:50% 70%">
      <div style="padding:12px 14px"><b style="font-size:16px">결온 앰버 세럼</b><div style="font-size:13px;color:#78716c">깊어지는 계절의 보습</div></div></div>
    <div style="margin:16px 18px;border-radius:16px;background:#1f1a17;color:#fff;padding:18px;text-align:center">
      <div style="font-size:13px;font-weight:800;color:#f5c9a5">참여 이벤트</div><div style="font-size:19px;font-weight:900;margin-top:2px">룰렛 돌리고 선물 받기</div>
      <div class="c4wheel" style="margin:14px auto 4px;width:150px;height:150px;border-radius:50%;background:conic-gradient(#FF5A1F 0 60deg,#fff 60deg 120deg,#9A5B2E 120deg 180deg,#fff 180deg 240deg,#FF5A1F 240deg 300deg,#f5c9a5 300deg 360deg);border:6px solid #fff"></div></div>
    <div style="margin:6px 18px 30px;height:52px;border-radius:14px;background:#111;color:#fff;font-size:17px;font-weight:800;display:flex;align-items:center;justify-content:center">쿠폰 받기</div>`;

  V.scene({
    id: 'c4', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps)}<div id="c4c2">${V.captionHTML(caps2, 'top')}</div>
      ${UI.win('c4win', { x: 730, y: 118, w: 1080, h: 870, icon: 'wand', title: '만들기', sub: '재료만 넣으면 완성본' })}
      <div id="c4res">
        <div class="sf" id="c4fix" style="left:120px;top:290px;width:400px;padding:24px 26px">
          <b style="font-size:24px;display:flex;align-items:center;gap:10px"><span class="ac">${IC('pen')}</span><span id="c4fixT">고칠 곳 1곳</span></b>
          <div style="margin-top:6px;font-size:16px;color:var(--s5)">휴대폰 화면에서 블록을 누르면 그 자리만 고칩니다</div>
          <div style="margin-top:16px;border-radius:14px;border:2px solid var(--line);padding:14px 16px">
            <div style="display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800"><span class="ck" id="c4ck"></span>버튼 주소</div>
            <div style="margin-top:8px;height:46px;border-radius:10px;background:var(--soft2);border:2px solid var(--line);display:flex;align-items:center;padding:0 12px;font-size:17px" id="c4btnUrl"></div>
          </div>
          <div style="margin-top:12px;border-radius:14px;border:2px solid var(--ok-line);background:var(--ok-soft);padding:12px 16px;font-size:16px;color:#065F46;font-weight:700;display:flex;gap:8px;align-items:center">${IC('check')}혜택 자리 · 적은 문구 그대로 채움</div>
          <div id="c4ok" style="margin-top:14px"><span class="pill ok" style="font-size:18px">${IC('check')}고칠 곳 없음 · 보낼 수 있어요</span></div>
          <div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:8px">${['테마', '브랜드 색', '서체', 'A/B 테스트', '링크만 받기'].map((s) => `<span class="pill sl" style="font-size:15px">${s}</span>`).join('')}</div>
        </div>
        <div class="phone" id="c4ph" style="left:570px;top:262px;transform-origin:0 0">
          <div class="scr"><div class="isl"></div><div class="sb"><span>10:12</span><span>● ● ●</span></div>
            <div style="height:44px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#57534e;border-bottom:1px solid #eee">결온 · VIP 가을 감사 위크</div>
            <div style="position:absolute;left:0;right:0;top:102px;bottom:0;overflow:hidden"><div id="c4dm">${DM}</div></div></div>
        </div>
        <div class="sf" id="c4mail" style="left:1010px;top:262px;width:800px;height:740px;overflow:hidden;padding:0">
          <div style="height:56px;display:flex;align-items:center;gap:8px;padding:0 22px;border-bottom:2px solid var(--soft);background:var(--soft2)"><i style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></i><i style="width:12px;height:12px;border-radius:50%;background:#febc2e"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c840"></i><span style="margin-left:14px;font-size:16px;color:var(--s5)">받은편지함</span></div>
          <div style="padding:20px 28px 14px;border-bottom:2px solid var(--soft)"><div style="font-size:24px;font-weight:850">VIP 가을 감사 위크가 시작됐어요</div>
            <div style="margin-top:6px;font-size:16px;color:var(--s5)">결온 · 재구매 15% 쿠폰을 10월 25일(일)까지 드려요</div></div>
          <div id="c4mb" style="padding:20px 60px">
            <div style="border-radius:14px;overflow:hidden;height:220px"><img src="${P('p3-kyeolon-event')}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% 50%"></div>
            <div style="margin-top:18px;text-align:center;font-size:26px;font-weight:900">늘 아껴 주셔서 고맙습니다</div>
            <div style="margin-top:8px;text-align:center;font-size:16px;color:var(--s6);line-height:1.6">VIP 고객님께 재구매 15% 쿠폰을 먼저 보내 드려요. 온라인몰과 전 매장에서 10월 25일(일)까지 쓰실 수 있어요.</div>
            <div style="margin-top:16px;display:grid;grid-template-columns:200px 1fr;gap:16px;align-items:center;border-radius:14px;border:2px solid var(--line);padding:12px">
              <img src="${P('p1-kyeolon-product')}" alt="" style="width:200px;height:150px;object-fit:cover;object-position:50% 70%;border-radius:10px">
              <div><b style="font-size:19px">결온 앰버 세럼</b><div style="margin-top:4px;font-size:15px;color:var(--s5)">깊어지는 계절의 보습</div></div></div>
            <div style="margin:18px auto 0;width:300px;height:54px;border-radius:12px;background:var(--ink);color:#fff;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center">쿠폰 받기</div>
            <div style="margin-top:14px;text-align:center;font-size:13px;color:var(--s4)">(광고) 수신을 원하지 않으시면 수신거부를 눌러 주세요</div>
          </div>
        </div>
        <div class="abs" id="c4st1" style="left:520px;top:1012px;width:460px;display:flex;justify-content:center;gap:10px"></div>
        <div class="sf" id="c4st2" style="left:1010px;top:262px;width:800px;padding:26px 30px"></div>
      </div>
      <div class="abs" id="c4trig" style="left:700px;top:176px;display:flex;align-items:center;flex-wrap:wrap;gap:10px"><span style="font-size:18px;font-weight:800;color:var(--s5);margin-right:6px">띄우는 순간</span>${['페이지 열 때', '장바구니 담음', '장바구니 금액', '결제 시작', '스크롤 도달', '이탈 의도'].map((s, k) => `<span class="pill ${k === 1 ? 'ac' : 'sl'}" style="font-size:18px">${s}</span>`).join('')}</div>
      <div class="win" id="c4shop" style="left:300px;top:262px;width:1320px;height:740px">
        <div style="height:60px;display:flex;align-items:center;gap:14px;padding:0 24px;background:#fff;border-bottom:2px solid var(--line)"><b style="font-size:22px;letter-spacing:.12em;color:#9A5B2E">KYEOLON</b><span style="margin-left:auto;font-size:16px;color:var(--s5)">결온 온라인몰</span><span class="ac" style="font-size:24px">${IC('cart')}</span></div>
        <div style="display:grid;grid-template-columns:560px 1fr;gap:40px;padding:36px 44px">
          <img src="posters/cut-kyeolon.png" alt="" style="width:560px;height:520px;object-fit:contain;background:#F3EEE8;border-radius:20px">
          <div><div style="font-size:16px;color:var(--s5)">스킨케어 · 세럼</div><div style="margin-top:6px;font-size:40px;font-weight:900">결온 앰버 세럼</div><div style="margin-top:10px;font-size:18px;color:var(--s6);line-height:1.6">깊어지는 계절의 보습</div>
            <div style="margin-top:30px;display:flex;gap:12px"><span class="btn" id="c4cart" style="height:66px;padding:0 40px">${UI.ripple}${IC('cart')}장바구니 담기</span><span class="btn gh" style="height:66px">바로 구매</span></div>
</div>
        </div>
        <div class="dim" id="c4dim" style="background:rgba(17,17,17,.45);backdrop-filter:none"></div>
        <div id="c4pop" style="position:absolute;left:50%;top:50%;width:360px;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 40px 80px -20px rgba(0,0,0,.5)">
          <img src="${P('p3-kyeolon-event')}" alt="" style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover">
          <div style="display:flex;font-size:17px;font-weight:800"><span style="flex:1;text-align:center;padding:14px 0">닫기</span><span style="flex:1;text-align:center;padding:14px 0;background:var(--ink);color:#fff">자세히 보기</span></div></div>
      </div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '재료만 넣으면, DM · 이메일 완성본', ['주소 · 사진 · 글 넣기', '모바일 DM · 이메일 나란히', '고칠 곳만 채우고 보내기', '보고 · 누르고 · 참여까지']));
      root.querySelector('#c4win .body').innerHTML = `
        <div style="padding:30px 36px">
          <div class="lbl">홈페이지·행사 페이지 주소</div>
          <div style="margin-top:10px;display:flex;gap:12px"><div style="flex:1;height:62px;border-radius:14px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;padding:0 18px;font-size:22px;font-weight:650" id="c4url"></div>
            <span class="btn sm" id="c4read" style="height:62px">${UI.ripple}읽어 오기</span></div>
          <div id="c4card" style="margin-top:14px;border-radius:16px;background:#fff;border:2px solid var(--line);padding:16px 18px">
            <div style="font-size:15px;font-weight:800;color:var(--s5)">읽어 온 문구</div>
            <div style="margin-top:6px;font-size:20px;font-weight:750;line-height:1.5">VIP 가을 감사 위크 · VIP 고객님께 재구매 15% 쿠폰 · 이번 주 일요일까지</div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:10px;font-size:17px;font-weight:750"><span class="ck" id="c4keep"></span>이 문구 그대로 쓰기 <span style="font-weight:500;color:var(--s5);font-size:15px">· 켜야 할인율 · 기간이 실립니다</span></div>
          </div>
          <div class="lbl" style="margin-top:22px">사진 · 글</div>
          <div style="margin-top:10px;display:flex;gap:14px;align-items:center">
            <div class="c4pic" style="width:150px;height:200px;border-radius:14px;overflow:hidden;border:2px solid var(--line)"><img src="${P('p3-kyeolon-event')}" alt="" style="width:100%;height:100%;object-fit:cover"></div>
            <div class="c4pic" style="width:150px;height:200px;border-radius:14px;overflow:hidden;border:2px solid var(--line)"><img src="${P('p1-kyeolon-product')}" alt="" style="width:100%;height:100%;object-fit:cover"></div>
            <div style="width:150px;height:200px;border-radius:14px;border:2px dashed var(--s3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--s5);font-size:16px">${IC('upload')}끌어다 놓기</div>
          </div>
          <div class="lbl" style="margin-top:22px">만들 것</div>
          <div style="margin-top:10px;display:flex;gap:12px"><span class="chip" id="c4k0">${UI.ripple}${IC('phone')}모바일 DM</span><span class="chip" id="c4k1">${UI.ripple}${IC('mail')}이메일</span><span class="chip">${IC('img')}카탈로그 DM</span></div>
          <span class="btn ac" id="c4go" style="margin-top:26px;width:100%;height:68px;font-size:24px">${UI.ripple}<span class="spin" id="c4sp" style="display:none;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span><span id="c4goT">${IC('wand')}만들기</span></span>
        </div>`;
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, S.out);
      V.captions(R.querySelector('#c4c2 .caps'), t, caps2, C.dur - 0.4);

      // ① 재료
      V.show($('c4win'), t, S.win, S.out, { dy: 70, blur: 12, dur: 0.7, out: 0.4 });
      const u = V.typed(URL, t, S.url, 16);
      $('c4url').innerHTML = u ? u + (u.length < URL.length ? '<span class="caret"></span>' : '') : '<span style="color:var(--s4)">https://</span>';
      V.press($('c4read'), t, S.read);
      V.show($('c4card'), t, S.card, null, { dy: 24, blur: 6, dur: 0.45 });
      const keep = t >= S.keep;
      $('c4keep').className = `ck${keep ? ' on' : ''}`;
      $('c4keep').innerHTML = keep ? UI.icon('check') : '';
      R.querySelectorAll('.c4pic').forEach((n, k) => V.show(n, t, S.pics[k], null, { dy: -40, blur: 6, dur: 0.45, sc: 0.1, ease: 'back' }));
      [0, 1].forEach((k) => { V.press($(`c4k${k}`), t, S.kinds[k]); $(`c4k${k}`).className = `chip${t >= S.kinds[k] + 0.05 ? ' on' : ''}`; });
      V.press($('c4go'), t, S.make);
      const busy = t >= S.make + 0.1;
      $('c4sp').style.display = busy ? 'block' : 'none';
      $('c4sp').style.transform = `rotate(${(t * 520) % 360}deg)`;
      $('c4goT').innerHTML = busy ? '재료를 잠그고 만드는 중이에요' : `${UI.icon('wand')}만들기`;

      // ② 완성본 나란히
      const resOut = V.p(t, S.shop - 0.4, S.shop + 0.1, 'io');
      $('c4res').style.opacity = (1 - resOut).toFixed(3);
      $('c4res').style.display = resOut >= 1 ? 'none' : 'block';
      V.show($('c4fix'), t, S.fix, null, { dy: 40, blur: 8, dur: 0.5 });
      const ph = $('c4ph');
      V.show(ph, t, S.res, null, { dy: 80, blur: 10, dur: 0.7 });
      ph.style.transform += ' scale(0.9)';
      // 블록이 위에서부터 쌓이고, 아래로 훑는다
      const dm = $('c4dm');
      [...dm.children].forEach((n, k) => V.show(n, t, S.res + 0.4 + k * 0.32, null, { dy: 40, blur: 6, dur: 0.45 }));
      const sc = V.p(t, S.dmScroll[0], S.dmScroll[1], 'io');
      dm.style.transform = `translateY(${(-sc * Math.max(0, dm.offsetHeight - 690)).toFixed(1)}px)`;
      const wh = dm.querySelector('.c4wheel');
      if (wh) wh.style.transform = `rotate(${(V.p(t, 15.0, 18.0, 'out') * 1440).toFixed(1)}deg)`;
      V.show($('c4mail'), t, S.email, S.stats, { dy: 80, blur: 10, dur: 0.7, out: 0.4 });
      [...$('c4mb').children].forEach((n, k) => V.show(n, t, S.email + 0.5 + k * 0.3, null, { dy: 30, blur: 6, dur: 0.45 }));
      // 고칠 곳
      const fill = V.typed('kyeolon.kr/vip', t, S.fixFill[0], 9);
      $('c4btnUrl').innerHTML = fill ? fill + (t < S.fixFill[1] ? '<span class="caret"></span>' : '') : '<span style="color:#B91C1C">비어 있어요 · 채워야 보낼 수 있어요</span>';
      const done = t >= S.fixFill[1];
      $('c4ck').className = `ck${done ? ' on' : ''}`;
      $('c4ck').innerHTML = done ? UI.icon('check') : '';
      $('c4fixT').textContent = done ? '고칠 곳 0곳' : '고칠 곳 1곳';
      V.show($('c4ok'), t, S.ok, null, { dy: 14, blur: 4, dur: 0.4, sc: 0.1, ease: 'back' });

      // ③ 보낸 뒤 반응
      const roll = (n, a = S.stat[0], b = S.stat[1]) => V.won(V.count(t, a, b, n));
      $('c4st1').innerHTML = [['받은 사람', 2184], ['열람', 1326], ['클릭', 488], ['룰렛 참여', 271]].map(([k, n]) => `<span class="pill ${k === '열람' ? 'dk' : 'sl'}" style="font-size:16px">${k} <b class="tnum">${roll(n)}</b></span>`).join('');
      V.show($('c4st1'), t, S.stats, null, { dy: 20, blur: 4, dur: 0.45 });
      $('c4st2').innerHTML = `<b style="font-size:24px;display:flex;align-items:center;gap:10px"><span class="ac">${UI.icon('chart')}</span>VIP 가을 감사 위크 · 보낸 뒤</b>
        <div style="margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">${[['이메일 오픈', 912], ['이메일 클릭', 207], ['모바일 DM 클릭', 488]].map(([k, n]) => `<div style="border-radius:16px;background:var(--soft2);border:2px solid var(--line);padding:16px 18px"><div style="font-size:16px;color:var(--s5);font-weight:700">${k}</div><div class="tnum" style="margin-top:4px;font-size:40px;font-weight:900">${roll(n)}</div></div>`).join('')}</div>
        <div style="margin-top:18px;font-size:17px;font-weight:800;color:var(--s5)">많이 누른 링크</div>
        ${[['쿠폰 받기', 74], ['결온 앰버 세럼', 19], ['수신거부', 2]].map(([k, w]) => `<div style="margin-top:10px;display:flex;align-items:center;gap:14px"><span style="width:180px;font-size:18px;font-weight:750">${k}</span><div style="flex:1;height:18px;border-radius:9px;background:var(--soft);overflow:hidden"><i style="display:block;height:100%;width:${(w * V.p(t, S.stat[0], S.stat[1])).toFixed(1)}%;background:${k === '쿠폰 받기' ? 'var(--ac)' : 'var(--ink)'};border-radius:9px"></i></div></div>`).join('')}
        <div style="margin-top:22px;display:flex;gap:12px"><span class="btn sm" id="c4again">${UI.ripple}${UI.icon('send')}안 연 사람에게 다시 보내기</span><span class="btn gh sm">받은 사람별 반응</span></div>`;
      V.show($('c4st2'), t, S.stats + 0.2, null, { dy: 40, blur: 8, dur: 0.55 });
      V.press($('c4again'), t, S.again);

      // ④ 인앱
      V.show($('c4shop'), t, S.shop, null, { dy: 70, blur: 10, dur: 0.6 });
      V.press($('c4cart'), t, S.cart);
      const pop = V.p(t, S.pop, S.pop + 0.45, 'back');
      $('c4dim').style.opacity = V.p(t, S.pop, S.pop + 0.3).toFixed(3);
      $('c4pop').style.opacity = V.clamp(pop * 1.3).toFixed(3);
      $('c4pop').style.transform = `translate(-50%, -50%) scale(${(0.7 + 0.3 * pop).toFixed(3)})`;
      V.show($('c4trig'), t, S.shop + 0.5, null, { dy: 16, blur: 4, dur: 0.4 });
      R.querySelectorAll('#c4trig .pill').forEach((n, k) => V.show(n, t, S.trig + k * 0.08, null, { dy: 12, blur: 0, dur: 0.3 }));

      V.pointer(t, [
        { at: S.read, node: $('c4read') }, { at: S.keep, node: $('c4keep') }, { at: S.kinds[0], node: $('c4k0') }, { at: S.kinds[1], node: $('c4k1') }, { at: S.make, node: $('c4go') },
      ], { tail: 0.4 });
      V.pointer(t, [{ at: S.fixFill[0] - 0.2, node: $('c4btnUrl') }], { tail: 0.4 });
      V.pointer(t, [{ at: S.again, node: $('c4again') }], { tail: 0.5 });
      V.pointer(t, [{ at: S.cart, node: $('c4cart') }], { tail: 0.6 });
    },
  });
})();
