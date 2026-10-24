// 장 3 · 이미지 스튜디오(40초): 템플릿 582가지(16분류) → 「가을」 찾기 → 어텀 앰버 → 문구 · 사진 → 배경 자동 제거 → 포스터 → 말로 고치기 → 라이브러리 → 채널에 바로
// 화면 글 = TemplatePicker · StudioMake 원문 · 개수 = 템플릿 원장 실제 집계(listTemplatesPublic · 2026-10-23) · 포스터 = posters/(스튜디오 프롬프트 그대로 생성)
(() => {
  const C = chOf('c3');
  const IC = UI.icon;
  const CATS = [['뷰티', 95, ['#3d2b22', '#e8d5c4', '#5e9ea0']], ['패션', 90, ['#6b705c', '#495057', '#9d4352']], ['외식·메뉴', 58, ['#d62828', '#e9a23b', '#2a9d8f']], ['세일·이벤트', 50, ['#d4af37', '#1d3557', '#ff7f6e']],
    ['카페·음료', 43, ['#e07a8b', '#8d5b4c', '#c08552']], ['멤버십·고객감사', 38, ['#7d8597', '#e5989b', '#355070']], ['시즌·명절 행사', 31, ['#1b4332', '#8b1e3f', '#4d7cfe']], ['팝업·페스티벌', 26, ['#e8563f', '#d9903f', '#7b52c9']],
    ['데이·기념일', 25, ['#3a86ff', '#284b63', '#9e2a5b']], ['신메뉴·팝', 24, ['#ff4b3e', '#e94f64', '#f2b134']], ['오픈·기념일', 21, ['#d04a4a', '#5fb3a1', '#c2a35c']], ['안내·예약', 19, ['#606c38', '#6d2e46', '#52b69a']],
    ['모집·참여', 19, ['#7b2cbf', '#d81159', '#118ab2']], ['미니멀', 16, ['#d8d2c8', '#6b7d8a', '#c9c3b8']], ['클래스·체험', 16, ['#8a6f52', '#d9a97a', '#6f4a35']], ['시즌', 11, ['#7ba05b', '#a5433d', '#7a2e35']]];
  const FOUND = [['어텀 앰버', '뷰티', '#a9683b', '깊어지는 계절의 보습'], ['단풍 어텀 카페', '카페·음료', '#c07840', '가을을 마시는 시간'], ['어텀 시티', '패션', '#b8863f', '가을의 온도를 입다'], ['어텀 리프', '미니멀', '#c9a06b', '가을의 결'],
    ['어텀 위크', '시즌·명절 행사', '#b06a35', '가을, 깊어지다'], ['코지 리딩', '시즌', '#a07a4f', '책과 함께하는 계절'], ['단풍 여행', '시즌·명절 행사', '#b5642c', '단풍 여행 위크']];
  const TEXTS = [['작은 라벨', 'KYEOLON'], ['헤드라인', '깊어지는 계절의 보습'], ['부제', '결온 앰버 세럼']];
  const EDIT = '배경을 단풍잎이 비치는 따뜻한 창가로 바꿔 줘';
  const LIB = [['p1-kyeolon-product', '제품 · 뷰티 · 어텀 앰버'], ['p3-kyeolon-event', '행사 · VIP 벨벳 라운지 · 문구 중앙'], ['p4-ohudam-product', '제품 · 카페 · 단풍 어텀 카페'], ['p5-ohudam-birthday', '행사 · 버스데이 클럽 · 문구 위'],
    ['p6-soyo-product', '제품 · 패션 · 니트 텍스처'], ['p7-soyo-event', '행사 · 어텀 위크 · 문구 아래'], ['p2-kyeolon-product-edit', 'AI로 고친 포스터']];
  const P = (n) => `posters/${n}.jpg`;
  const S = {
    win: 3.0, cats: 3.4, count: 4.4, search: 5.8, found: 6.9, pickTpl: 8.1,
    make: 8.6, texts: 9.0, upload: 10.9, photo: 11.1, scan: [11.5, 12.9], cut: 13.0, makeBtn: 14.2, gen: [14.4, 15.8], poster: 15.9,
    edit: 17.3, editType: 17.7, editBtn: 20.0, wipe: [20.2, 21.3],
    lib: 23.0, libOut: 30.6, ch: 31.0, chOut: C.dur - 0.4,
  };
  const caps = [
    [3.2, '582가지 템플릿 중에', '<em>고르기만</em> 하면'],
    [8.8, '제품 사진을 올리면', '배경은 <em>자동으로</em> 지우고'],
    [13.4, '적은 문구 그대로', '포스터 한 장 완성'],
    [17.4, '바꾸고 싶은 점은', '<em>말로</em> 적으면 됩니다'],
  ];
  const caps2 = [
    [23.2, '제품 포스터도, 행사 포스터도', '업종마다 템플릿 그대로'],
    [31.2, '만든 포스터는 모바일 DM · 이메일 · 인앱 · 문자까지', '채널 크기에 맞춰 <em>바로</em> 씁니다'],
  ];
  const mock = (name, cat, ac, title, w = 200) => `<div style="border-radius:14px;overflow:hidden;border:2px solid var(--line);background:#fff">
      <div style="aspect-ratio:3/4;position:relative;display:flex;flex-direction:column;justify-content:flex-end;padding:14px;background:linear-gradient(160deg, ${ac}cc, ${ac}55 60%, #0f172a)">
        <b style="color:#fff;font-size:${Math.round(w * 0.085)}px;line-height:1.25;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,.3)">${title}</b></div>
      <div style="padding:10px 12px"><b style="display:block;font-size:16px;font-weight:800">${name}</b><span style="font-size:13px;color:var(--s5)">${cat}</span></div></div>`;

  V.scene({
    id: 'c3', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps)}<div id="c3c2">${V.captionHTML(caps2, 'top')}</div>
      ${UI.win('c3win', { x: 730, y: 118, w: 1080, h: 870, icon: 'img', title: '이미지 스튜디오', sub: '템플릿 고르고 문구만', tabs: [['제품 포스터', true], ['행사 포스터', false], ['라이브러리', false]] })}
      <div class="abs" id="c3foot" style="left:120px;top:1020px;font-size:17px;font-weight:550;color:var(--s5)">포스터는 이미지 스튜디오 템플릿 지시문 그대로 만든 예시입니다</div>
      <div id="c3lib">${LIB.map(([n, cap], k) => `<div class="abs c3li" style="left:${120 + (k % 4) * 430 + (k >= 4 ? 215 : 0)}px;top:${k < 4 ? 256 : 622}px;width:240px">
          <div class="poster" style="position:relative;width:240px;height:320px"><img src="${P(n)}" alt=""></div>
          <div style="margin-top:12px;font-size:17px;font-weight:750;color:var(--s7)">${cap}</div></div>`).join('')}</div>
      <div id="c3ch">
        <div class="abs" id="c3src" style="left:150px;top:300px"><div class="poster" style="position:relative;width:360px;height:480px"><img src="${P('p3-kyeolon-event')}" alt=""></div>
          <div style="margin-top:14px;font-size:20px;font-weight:800">VIP 가을 감사 위크 · 3:4</div></div>
        ${['모바일 DM', '이메일', '인앱', '문자(MMS)'].map((n, k) => `<div class="abs c3to" style="left:${640 + k * 318}px;top:300px;width:290px">
          <div style="height:520px;position:relative">${k === 1
            ? `<div style="position:absolute;left:0;top:40px;width:290px;height:420px;border-radius:18px;background:#fff;border:2px solid var(--line);overflow:hidden;box-shadow:0 30px 60px -36px rgba(17,17,17,.4)">
                 <div style="padding:12px 14px;border-bottom:2px solid var(--soft);font-size:14px;font-weight:800">VIP 가을 감사 위크가 시작됐어요<div style="font-weight:500;color:var(--s5);font-size:12px">결온 · 받은편지함</div></div>
                 <div style="height:164px;overflow:hidden"><img src="${P('p3-kyeolon-event')}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% 52%"></div>
                 <div style="padding:12px 14px"><div style="height:10px;border-radius:5px;background:var(--soft)"></div><div style="margin-top:8px;height:10px;width:80%;border-radius:5px;background:var(--soft)"></div><div style="margin-top:14px;height:40px;border-radius:10px;background:var(--ink);color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center">쿠폰 받기</div></div></div>`
            : `<div style="position:absolute;left:30px;top:0;width:230px;height:470px;border-radius:38px;background:var(--ink);padding:8px;box-shadow:0 30px 60px -30px rgba(17,17,17,.45)"><div style="width:100%;height:100%;border-radius:31px;overflow:hidden;background:${k === 2 ? '#E9E7E2' : '#fff'};position:relative">
                 ${k === 0 ? `<img src="${P('p3-kyeolon-event')}" alt="" style="width:100%;height:290px;object-fit:cover"><div style="padding:12px"><div style="height:10px;border-radius:5px;background:var(--soft)"></div><div style="margin-top:8px;height:10px;width:70%;border-radius:5px;background:var(--soft)"></div><div style="margin-top:14px;height:38px;border-radius:10px;background:var(--ink);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center">쿠폰 받기</div></div>` : ''}
                 ${k === 2 ? `<div style="position:absolute;inset:0;background:rgba(17,17,17,.42)"></div><div style="position:absolute;left:18px;right:18px;top:62px;border-radius:14px;overflow:hidden;background:#fff"><img src="${P('p3-kyeolon-event')}" alt="" style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover"><div style="display:flex;font-size:13px;font-weight:800"><span style="flex:1;text-align:center;padding:9px 0">닫기</span><span style="flex:1;text-align:center;padding:9px 0;background:var(--ink);color:#fff">자세히 보기</span></div></div>` : ''}
                 ${k === 3 ? `<div style="padding:60px 12px 0"><div style="font-size:11px;color:#8E8E93;text-align:center;margin-bottom:8px">오늘 오전 10:00</div><div style="border-radius:16px;background:#F0F0F2;padding:8px"><img src="${P('p3-kyeolon-event')}" alt="" style="display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px"><div style="padding:8px 4px 2px;font-size:12px;line-height:1.5;color:#111">(광고)[결온] 김서연 님, VIP 가을 감사 위크가 시작됐어요.</div></div></div>` : ''}
               </div></div>`}
          </div>
          <div style="display:flex;align-items:center;gap:10px;justify-content:center"><span class="pill dk" style="font-size:18px">${n}</span><span class="pill sl c3sz" style="font-size:15px">${['1:1 블록', '16:9 히어로', '3:4 포스터형', 'MMS 규격 자동 변환'][k]}</span></div></div>`).join('')}
        <svg class="abs" id="c3arr" style="left:0;top:0" width="1920" height="1080"><g fill="none" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-dasharray="10 10">
          <path class="c3ap" d="M 528 540 L 612 540"/></g><path class="c3ah" d="M 600 526 L 618 540 L 600 554" fill="none" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="abs" id="c3keep" style="left:150px;top:880px;display:flex;gap:12px"><span class="pill ok" style="font-size:18px">${IC('shield')}색 · 모양 그대로</span><span class="pill ok" style="font-size:18px">${IC('shield')}적은 문구만</span></div>
      </div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '문구만 쓰면, 포스터 한 장', ['582가지 템플릿에서 고르기', '제품 사진 · 배경 자동 제거', '적은 문구 그대로 포스터', '말로 고치기 · 채널에 바로']));

      root.querySelector('#c3win .body').innerHTML = `
        <div id="c3gal" style="position:absolute;inset:0;padding:26px 30px">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="flex:1;height:58px;border-radius:16px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;gap:12px;padding:0 18px;font-size:21px"><span style="color:var(--s5)">${IC('search')}</span><span id="c3q"></span></div>
            <span class="tnum" id="c3cnt" style="font-size:18px;font-weight:750;color:var(--s6)">총 582종 · 제품 · 행사 전체</span>
          </div>
          <div id="c3cats" style="margin-top:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
            ${CATS.map(([n, c, acs]) => `<div class="c3cat" style="height:136px;border-radius:18px;background:#fff;border:2px solid var(--line);padding:16px 18px;display:flex;flex-direction:column;justify-content:space-between">
              <div style="display:flex;gap:6px">${acs.map((a) => `<i style="width:26px;height:26px;border-radius:8px;background:${a}"></i>`).join('')}</div>
              <div><b style="display:block;font-size:21px;font-weight:850">${n}</b><span class="tnum" style="font-size:16px;color:var(--s5)">${c}종</span></div></div>`).join('')}
          </div>
          <div id="c3found" style="position:absolute;left:30px;right:30px;top:110px;display:grid;grid-template-columns:repeat(5,1fr);gap:16px">
            ${FOUND.map(([n, c, a, tt], k) => `<div class="c3fd" id="c3fd${k}" style="position:relative;overflow:hidden;border-radius:16px">${UI.ripple}${mock(n, c, a, tt)}</div>`).join('')}
          </div>
        </div>
        <div id="c3mk" style="position:absolute;inset:0;display:grid;grid-template-columns:460px 1fr">
          <div style="position:relative;padding:28px 0 0 30px">
            <div id="c3stage" style="position:relative;width:420px;height:560px;border-radius:20px;overflow:hidden;background:#fff;border:2px solid var(--line)">
              <div id="c3ex" style="position:absolute;inset:0">${mock('어텀 앰버', '뷰티 · 계절 무드', '#a9683b', '깊어지는 계절의 보습', 420).replace('border-radius:14px', 'border-radius:0;height:100%')}</div>
              <img id="c3ph" src="posters/src-kyeolon.jpg" alt="" style="position:absolute;left:0;top:70px;width:420px;height:420px;object-fit:cover">
              <div id="c3chk" style="position:absolute;left:0;top:70px;width:420px;height:420px;background-color:#fff;background-image:linear-gradient(45deg,#ececec 25%,transparent 25%),linear-gradient(-45deg,#ececec 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ececec 75%),linear-gradient(-45deg,transparent 75%,#ececec 75%);background-size:28px 28px;background-position:0 0,0 14px,14px -14px,-14px 0"></div>
              <img id="c3cut" src="posters/cut-kyeolon.png" alt="" style="position:absolute;left:0;top:70px;width:420px;height:420px;object-fit:contain">
              <div id="c3line" style="position:absolute;left:0;width:420px;height:4px;background:var(--ac);box-shadow:0 0 18px 6px rgba(255,90,31,.45)"></div>
              <img id="c3p1" src="${P('p1-kyeolon-product')}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
              <img id="c3p2" src="${P('p2-kyeolon-product-edit')}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
              <div id="c3shim" style="position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.7) 50%,transparent 70%);background-size:250% 100%"></div>
            </div>
            <div id="c3edit" style="margin-top:16px;width:420px;border-radius:16px;background:#fff;border:2px solid var(--line);padding:12px 14px">
              <div style="font-size:15px;font-weight:800;color:var(--s5)">${IC('wand')} AI로 고치기</div>
              <div id="c3et" style="margin-top:6px;min-height:52px;font-size:18px;font-weight:650;line-height:1.4"></div>
            </div>
          </div>
          <div style="padding:28px 30px 0 10px">
            <div style="border-radius:20px;border:2px solid var(--ac-line);background:var(--ac-soft);padding:18px 20px">
              <b style="font-size:21px;display:flex;align-items:center;gap:8px"><span class="ac">${IC('pen')}</span>포스터에 들어갈 문구</b>
              <div style="margin-top:8px;font-size:16px;color:var(--s6);line-height:1.5">예시 속 글자 자리에 <b style="color:var(--ac-ink)">아래 입력값이 그대로</b> 새겨져요. 상품 사진은 <b style="color:var(--ok)">배경이 자동으로 제거</b>되어 장면에 자연스럽게 들어가요.</div>
              ${TEXTS.map(([ph], k) => `<div style="margin-top:10px;height:54px;border-radius:12px;background:#fff;border:2px solid var(--line);display:flex;align-items:center;padding:0 16px;font-size:${k === 1 ? 22 : 18}px;font-weight:${k === 1 ? 800 : 650}"><span class="c3tv" id="c3tv${k}" data-ph="${ph}"></span></div>`).join('')}
              <div style="margin-top:8px;font-size:14px;color:var(--s5)">혜택 · 수치는 AI가 만들지 않아요. 직접 입력해주세요.</div>
            </div>
            <div style="margin-top:16px;border-radius:20px;border:2px solid var(--line);background:#fff;padding:18px 20px">
              <b style="font-size:21px;display:flex;align-items:center;gap:8px">${IC('box')}상품 이미지</b>
              <div style="margin-top:6px;font-size:15px;color:var(--s5)">제품 원본은 그대로 보존하고(누끼) 배경 · 문구만 새로 그립니다.</div>
              <div style="margin-top:12px;display:flex;gap:10px"><span class="btn gh sm">${IC('store')}연동 몰에서</span><span class="btn gh sm" id="c3up">${UI.ripple}${IC('upload')}사진 업로드</span></div>
              <div id="c3done" style="margin-top:12px;display:flex;align-items:center;gap:12px"><img src="posters/cut-kyeolon.png" alt="" style="width:62px;height:62px;object-fit:contain;border-radius:10px;border:2px solid var(--ok-line);background:#f7f7f7"><span style="font-size:17px;font-weight:750;color:var(--ok)">${IC('check')} 배경 제거 완료. 원본 그대로 들어갑니다</span></div>
            </div>
            <span class="btn ac" id="c3go" style="margin-top:18px;width:100%;height:66px;font-size:24px">${UI.ripple}<span class="spin" id="c3sp" style="display:none;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span><span id="c3goT">${IC('wand')}포스터 만들기</span></span>
            <span class="btn" id="c3eb" style="margin-top:12px;width:100%;height:60px">${UI.ripple}${IC('wand')}AI로 고치기</span>
          </div>
        </div>`;
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, S.lib - 0.3);
      V.captions(R.querySelector('#c3c2 .caps'), t, caps2, S.chOut);
      const winOut = V.p(t, S.lib - 0.4, S.lib + 0.2, 'io');
      V.show($('c3win'), t, S.win, null, { dy: 70, blur: 12, dur: 0.7 });
      $('c3win').style.opacity = (Number($('c3win').style.opacity) * (1 - winOut)).toFixed(3);
      $('c3win').style.visibility = winOut >= 1 ? 'hidden' : $('c3win').style.visibility;
      V.show($('c3foot'), t, S.make, null, { dy: 10, blur: 0, dur: 0.4 });

      // 갤러리 → 찾기
      const toMake = V.p(t, S.make - 0.2, S.make + 0.3);
      $('c3gal').style.opacity = (1 - toMake).toFixed(3);
      $('c3gal').style.visibility = toMake >= 1 ? 'hidden' : 'visible';
      R.querySelectorAll('.c3cat').forEach((n, k) => V.show(n, t, S.cats + k * 0.05, S.found - 0.3, { dy: 30, blur: 6, dur: 0.4, sc: 0.05 }));
      const q = V.typed('가을', t, S.search, 4);
      $('c3q').innerHTML = q ? `${q}<span class="caret"></span>` : '<span style="color:var(--s4)">템플릿 찾기 (예: 오픈)</span>';
      $('c3cnt').textContent = t >= S.found ? '가을 · 찾은 템플릿 7종' : `총 ${V.won(V.count(t, S.cats, S.count + 0.6, 582))}종 · 제품 · 행사 전체`;
      R.querySelectorAll('.c3fd').forEach((n, k) => V.show(n, t, S.found + k * 0.08, null, { dy: 40, blur: 6, dur: 0.45, sc: 0.05, ease: 'back' }));
      V.press($('c3fd0'), t, S.pickTpl);
      $('c3fd0').style.boxShadow = t >= S.pickTpl + 0.05 ? '0 0 0 4px var(--ac)' : 'none';

      // 만들기 화면
      const mk = $('c3mk');
      mk.style.opacity = toMake.toFixed(3);
      mk.style.visibility = toMake <= 0 ? 'hidden' : 'visible';
      TEXTS.forEach(([ph, v], k) => {
        const a = S.texts + k * 0.6;
        const s = V.typed(v, t, a, 16);
        const n = $(`c3tv${k}`);
        n.innerHTML = s ? s + (s.length < v.length ? '<span class="caret"></span>' : '') : `<span style="color:var(--s4)">${ph}</span>`;
      });
      V.press($('c3up'), t, S.upload);
      const ph = $('c3ph'), chk = $('c3chk'), cut = $('c3cut'), line = $('c3line');
      const photoV = V.p(t, S.photo, S.photo + 0.35);
      ph.style.opacity = photoV * (1 - V.p(t, S.poster - 0.4, S.poster));
      const sc = V.p(t, S.scan[0], S.scan[1], 'io');
      // 훑은 만큼 배경이 지워진다(위에서 아래로)
      ph.style.clipPath = `inset(${(sc * 100).toFixed(2)}% 0 0 0)`;
      chk.style.opacity = (V.clamp(photoV * 2) * (1 - V.p(t, S.poster - 0.4, S.poster))).toFixed(3);
      chk.style.clipPath = `inset(0 0 ${((1 - sc) * 100).toFixed(2)}% 0)`;
      cut.style.opacity = chk.style.opacity;
      cut.style.clipPath = chk.style.clipPath;
      line.style.top = `${(70 + sc * 420).toFixed(1)}px`;
      line.style.opacity = sc > 0 && sc < 1 ? 1 : 0;
      $('c3ex').style.opacity = (1 - photoV).toFixed(3);
      V.show($('c3done'), t, S.cut, null, { dy: 14, blur: 4, dur: 0.4, sc: 0.05, ease: 'back' });
      V.press($('c3go'), t, S.makeBtn);
      const busy = t >= S.makeBtn + 0.1 && t < S.poster;
      $('c3sp').style.display = busy ? 'block' : 'none';
      $('c3sp').style.transform = `rotate(${(t * 520) % 360}deg)`;
      $('c3goT').innerHTML = busy ? '포스터를 만들고 있어요' : t >= S.poster ? `${UI.icon('check')}완성 · 라이브러리에 저장` : `${UI.icon('wand')}포스터 만들기`;
      const sh = $('c3shim');
      const g = V.p(t, S.gen[0], S.gen[1], 'lin');
      sh.style.opacity = g > 0 && t < S.poster + 0.3 ? 1 : 0;
      sh.style.backgroundPosition = `${(100 - g * 300).toFixed(1)}% 0`;
      $('c3p1').style.opacity = V.p(t, S.poster - 0.2, S.poster + 0.5).toFixed(3);
      $('c3p1').style.transform = `scale(${(1.06 - 0.06 * V.p(t, S.poster - 0.2, S.poster + 1.2, 'out')).toFixed(4)})`;
      // 말로 고치기
      V.show($('c3edit'), t, S.edit, null, { dy: 20, blur: 6, dur: 0.4 });
      const et = V.typed(EDIT, t, S.editType, 12);
      $('c3et').innerHTML = et ? et + (et.length < EDIT.length ? '<span class="caret"></span>' : '') : '<span style="color:var(--s4)">바꾸고 싶은 점을 말로 적어 주세요</span>';
      V.show($('c3eb'), t, S.edit, null, { dy: 14, blur: 4, dur: 0.4 });
      V.press($('c3eb'), t, S.editBtn);
      const w = V.p(t, S.wipe[0], S.wipe[1], 'io');
      $('c3p2').style.clipPath = `inset(0 ${((1 - w) * 100).toFixed(2)}% 0 0)`;
      $('c3p2').style.opacity = w > 0 ? 1 : 0;

      // 라이브러리
      R.querySelectorAll('.c3li').forEach((n, k) => V.show(n, t, S.lib + 0.2 + k * 0.12, S.libOut, { dy: 70, blur: 10, dur: 0.6, sc: 0.06, rot: (k % 2 ? 3 : -3) }));
      // 채널에 바로
      V.show($('c3src'), t, S.ch, S.chOut, { dy: 50, blur: 8, dur: 0.6 });
      R.querySelectorAll('.c3to').forEach((n, k) => V.show(n, t, S.ch + 1.0 + k * 0.35, S.chOut, { dy: 0, dx: -60, blur: 8, dur: 0.6, sc: 0.08 }));
      const arr = V.p(t, S.ch + 0.7, S.ch + 1.1) * (1 - V.p(t, S.chOut, S.chOut + 0.3));
      R.querySelectorAll('.c3ap, .c3ah').forEach((n) => { n.style.opacity = arr.toFixed(3); n.style.strokeDashoffset = `${(-t * 40).toFixed(1)}`; });
      V.show($('c3keep'), t, S.ch + 2.8, S.chOut, { dy: 20, blur: 4, dur: 0.45 });

      V.pointer(t, [
        { at: S.pickTpl, node: $('c3fd0') },
        { at: S.upload, node: $('c3up') },
        { at: S.makeBtn, node: $('c3go') },
        { at: S.editBtn, node: $('c3eb') },
      ], { tail: 0.5 });
    },
  });
})();
