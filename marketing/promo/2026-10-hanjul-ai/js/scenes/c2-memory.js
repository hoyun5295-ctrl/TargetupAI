// 장 2 · AI 메모리(40초): 고객사 셋이 예전에 보낸 문자를 올린다 → 가이드라인 자동 추출(회사마다 · 마케팅 / 안부 · 알림 따로)
//   → 회사 사이 칸막이(회사마다 따로 저장) → 같은 한 줄이 세 회사 목소리로 → 관리자가 직접 고친다
// 항목 이름 = BrandVoiceCard.tsx 가이드라인 칸 · 저장 = ai_company_memory 회사 단위(routes/ai-memory.ts) · 회사 · 문안은 가상
(() => {
  const C = chOf('c2');
  const IC = UI.icon;
  const CO = [
    {
      name: '결온', ind: '뷰티', color: '#9A5B2E', x: 110,
      msgs: [['마케팅', '(광고)[결온] %이름% 님, 환절기 피부가 예민해지는 요즘이에요. 결온 리페어 크림으로 하루를 감싸 보세요'],
        ['안부 · 알림', '[결온] %이름% 님, 주문하신 앰버 세럼이 오늘 출발했어요. 받아 보시고 편하게 써 보세요'],
        ['마케팅', '(광고)[결온] %이름% 님만을 위한 생일 달 선물을 준비했어요. 피부의 결을 따뜻하게'],
        ['안부 · 알림', '[결온] %이름% 님, 지난번 고르신 제품은 잘 맞으셨나요? 궁금한 점은 언제든 말씀 주세요']],
      g: [['톤', '정중/격조'], ['고객 호칭', '○○ 님'], ['종결어미', '해요체 · ~해요 · ~드릴게요'], ['첫 줄 후크', '계절 · 피부 이야기'], ['본문 구조', '인사 → 공감 → 혜택 → 기간 → 링크'], ['CTA 패턴', '쿠폰 받기 ▶'], ['시그니처', '피부의 결을 따뜻하게, 결온'], ['금지 단어', '최저가 · 파격'], ['길이 범위', '220~480자 · 자동 계산'], ['링크 습관', '본문 끝 · 문안당 1개']],
      out: { who: '김서연', segs: [['[결온] '], ['김서연', 'var'], [' 님, 이번 한 주도 수고 많으셨어요.\n찬 바람이 불기 시작하는 주말이에요. 따뜻한 차 한 잔과 함께 잠시 쉬어 가시길 바라요.\n\n늘 결온을 아껴 주셔서 진심으로 감사드려요. '], ['김서연', 'var'], [' 님의 피부가 이 계절에도 편안하도록, 저희도 더 세심하게 준비할게요.\n\n편안한 주말 보내세요.\n'], ['피부의 결을 따뜻하게, 결온', 'sig']] },
      traits: ['「○○ 님」 호칭', '해요체', '고정 시그니처'],
    },
    {
      name: '오후담', ind: '카페', color: '#B7791F', x: 700,
      msgs: [['마케팅', '(광고)[오후담] %이름%님! 오늘 오후 네 시, 창가 자리에 햇살이 제일 예뻐요. 메이플 크림 라떼가 나왔어요'],
        ['안부 · 알림', '[오후담] %이름%님, 지난 주말에 와 주셔서 고마웠어요. 다음에도 그 자리 비워 둘게요'],
        ['마케팅', '(광고)[오후담] 비 오는 날엔 따뜻한 라떼죠. 오늘은 사이즈업 해 드려요'],
        ['안부 · 알림', '[오후담] %이름%님, 스탬프 열 개가 다 모였어요! 다음 방문 때 한 잔 챙겨 드릴게요']],
      g: [['톤', '친근/캐주얼'], ['고객 호칭', '○○님'], ['종결어미', '해요체 · ~해요 · ~예요!'], ['첫 줄 후크', '오늘 날씨 · 창가 이야기'], ['본문 구조', '오늘 이야기 → 메뉴 → 혜택 → 매장'], ['CTA 패턴', '오늘 들러 주세요'], ['시그니처', '오늘도 오후담에서 쉬어 가요'], ['금지 단어', '할인 폭탄'], ['길이 범위', '120~300자 · 자동 계산'], ['링크 습관', '없음']],
      out: { who: '박지수', segs: [['[오후담] '], ['박지수', 'var'], ['님, 한 주 버티느라 고생 많았어요!\n요즘 해가 짧아져서 오후 네 시만 돼도 창가가 금빛이에요. 그 자리, '], ['박지수', 'var'], ['님 생각하면서 늘 비워 두고 있어요.\n\n이번 주말엔 따뜻한 라떼 한 잔 하면서 쉬어 가요. 와 주시는 것만으로도 늘 고마워요.\n\n'], ['오늘도 오후담에서 쉬어 가요', 'sig']] },
      traits: ['「○○님」 친근한 호칭', '오늘 이야기로 시작', '느낌표 · 해요체'],
    },
    {
      name: '소요웨어', ind: '의류', color: '#3F3F46', x: 1290,
      msgs: [['마케팅', '(광고)[소요웨어] 고객님, F/W 신상품이 입고되었습니다. 오래 입을 수 있는 소재만 골랐습니다'],
        ['안부 · 알림', '[소요웨어] %이름% 고객님, 주문하신 상품이 출고되었습니다. 받으신 뒤 사이즈를 확인해 주십시오'],
        ['마케팅', '(광고)[소요웨어] 시즌 오프를 시작합니다. 고객님께 먼저 안내드립니다'],
        ['안부 · 알림', '[소요웨어] %이름% 고객님, 교환 접수가 완료되었습니다. 새 상품은 내일 출고됩니다']],
      g: [['톤', '정보/실용'], ['고객 호칭', '○○ 고객님'], ['종결어미', '합쇼체 · ~입니다 · ~드립니다'], ['첫 줄 후크', '입고 · 시즌 소식'], ['본문 구조', '소식 → 소재 · 핏 → 혜택 → 기간'], ['CTA 패턴', '지금 확인하기 ▶'], ['시그니처', 'SOYO WEAR'], ['금지 단어', '무조건 · 역대급'], ['길이 범위', '160~380자 · 자동 계산'], ['링크 습관', '본문 끝 · 문안당 1개']],
      out: { who: '이준호', segs: [['[소요웨어] '], ['이준호', 'var'], [' 고객님, 한 주 동안 수고 많으셨습니다.\n아침저녁으로 기온 차가 커지는 시기입니다. 얇은 니트 하나를 겹쳐 입으시면 하루가 한결 편안합니다.\n\n소요웨어를 찾아 주셔서 감사합니다. 앞으로도 오래 입을 수 있는 옷으로 보답하겠습니다.\n\n주말 잘 보내십시오.\n'], ['SOYO WEAR', 'sig']] },
      traits: ['「○○ 고객님」 호칭', '합쇼체', '소식 중심 · 담백하게'],
    },
  ];
  const LINE = '이번 주말, 고객님께 감사 인사 보내줘';
  const S = {
    panels: 3.0, msg0: 3.6, msgGap: 0.32, ext: [8.4, 8.75, 9.1], scan: [8.9, 10.4], kind: 10.0,
    guide: 10.8, rowGap: 0.28, kinds2: 15.2,
    vault: 19.0, vaultOut: 24.2,
    line: 24.6, type: 25.2, phones: 27.0, typeA: 27.6, typeB: 35.0, traits: 35.4,
    edit: 36.6,
  };
  const caps = [
    [3.1, '예전에 보낸 문자를', '대표 문안으로 올리면'],
    [10.5, 'AI가 회사마다', '<em>말투를 따로</em> 배웁니다'],
    [15.0, '광고 문자와 안부 문자도', '성격별로 따로 배웁니다'],
    [19.1, '고객사마다 각각', '<em>별도로</em> 저장되고, 서로 섞이지 않습니다'],
    [24.5, '같은 한 줄을 넣어도', '회사마다 <em>그 회사의 목소리</em>로'],
    [36.4, '배운 말투는', '관리자가 직접 고칠 수도 있습니다'],
  ];

  V.scene({
    id: 'c2', at: C.at, dur: C.dur,
    build(root) {
      root.innerHTML = `${UI.stageBg()}${V.captionHTML(caps, 'top')}
      ${CO.map((c, k) => `
        <div class="sf c2p" id="c2p${k}" style="left:${c.x}px;top:262px;width:520px;height:742px;overflow:hidden">
          <div style="padding:24px 26px 18px;display:flex;align-items:center;gap:14px;border-bottom:2px solid var(--soft)">
            <span style="width:56px;height:56px;border-radius:50%;background:${c.color};color:#fff;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center">${c.name.slice(0, 1)}</span>
            <div style="flex:1"><b style="display:block;font-size:28px;font-weight:850">${c.name}</b><span style="font-size:17px;color:var(--s5)">${c.ind} · AI 메모리</span></div>
            <span class="pill dk c2lock" style="font-size:16px">${IC('lock')}${c.name} 전용</span>
          </div>
          <div style="padding:18px 26px">
            <div class="lbl">LMS/MMS 대표 문안 (${c.msgs.length}/10)</div>
            <div class="c2msgs" style="position:relative;margin-top:12px">
              ${c.msgs.map(([kind, txt], j) => `
                <div class="c2m" style="margin-top:${j ? 10 : 0}px;border-radius:14px;background:var(--soft2);border:2px solid var(--line);padding:12px 14px">
                  <div style="display:flex;gap:8px;align-items:center;font-size:14px;font-weight:800;color:var(--s5)"><span>#${j + 1}</span><span class="pill sl" style="padding:2px 9px;font-size:13px">LMS</span>
                    <span class="pill sl c2kind" data-k="${kind}" style="padding:2px 9px;font-size:13px">성격 판정 전</span></div>
                  <div style="margin-top:6px;font-size:16.5px;line-height:1.45;color:var(--s7);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${txt}</div>
                </div>`).join('')}
              <div class="c2scan" style="position:absolute;left:-8px;right:-8px;height:70px;top:0;background:linear-gradient(180deg,transparent,rgba(255,90,31,.20),transparent);border-bottom:3px solid var(--ac);opacity:0"></div>
            </div>
            <span class="btn sm c2ext" style="margin-top:16px">${UI.ripple}${IC('spark')}AI 가이드라인 자동 추출</span>
          </div>
          <div class="c2g" style="position:absolute;left:0;right:0;top:104px;bottom:0;background:#fff;padding:18px 26px">
            <div style="display:flex;align-items:center;gap:10px"><span class="ok" style="color:var(--ok);font-size:22px">${IC('check')}</span><b style="font-size:22px">Brand Voice 가이드라인</b></div>
            <div style="margin-top:12px;border:2px solid var(--line);border-radius:16px;overflow:hidden">
              ${c.g.map(([kk, v], j) => `<div class="c2gr" style="display:flex;gap:12px;padding:11px 16px;${j ? 'border-top:2px solid var(--soft);' : ''}font-size:17.5px">
                <span style="width:104px;flex:none;color:var(--s5);font-weight:650">${kk}</span><b style="font-weight:800;${kk === '금지 단어' ? 'color:#B91C1C' : ''}">${v}</b></div>`).join('')}
            </div>
            <div class="c2kd" style="margin-top:14px;display:flex;gap:10px">
              <span class="pill ok" style="font-size:17px">${IC('check')}마케팅 말투</span><span class="pill ok" style="font-size:17px">${IC('check')}안부 · 알림 말투</span>
            </div>
          </div>
        </div>`).join('')}
      ${[0, 1].map((k) => `<div class="abs c2wall" id="c2w${k}" style="left:${665 + k * 590 - 6}px;top:240px;width:12px;height:0;border-radius:6px;background:var(--ink)">
          <span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:58px;height:58px;border-radius:50%;background:var(--ac);color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 8px var(--bg)">${IC('lock')}</span></div>`).join('')}

      <div class="abs" id="c2in" style="left:460px;top:250px;width:1000px;height:78px;border-radius:24px;background:#fff;border:3px solid var(--ink);display:flex;align-items:center;gap:16px;padding:0 14px 0 26px;box-shadow:0 30px 60px -30px rgba(17,17,17,.35)">
        <img src="../../../packages/frontend/public/brand/wordmark.png" alt="" style="height:24px">
        <span id="c2tx" style="flex:1;font-size:28px;font-weight:700"></span>
        <span class="pill sl" style="font-size:16px">안부 · 알림 · 광고 표기 없이</span>
        <span class="btn ac sm" id="c2go">${UI.ripple}${IC('send')}생성</span>
      </div>
      ${CO.map((c, k) => UI.phone(`c2ph${k}`, { x: c.x + 96, y: 350, name: c.name, color: c.color, scale: 0.8, time: '10:00' })).join('')}
      ${CO.map((c, k) => `<div class="abs c2tr" id="c2tr${k}" style="left:${c.x + 428}px;top:600px;width:172px;display:flex;flex-direction:column;align-items:flex-start;gap:10px">
          ${c.traits.map((s) => `<span class="pill" style="background:#fff;border:2px solid var(--ac-line);color:var(--ac-ink);font-size:16px;white-space:normal;line-height:1.3">${s}</span>`).join('')}</div>`).join('')}
      <div class="abs" id="c2edit" style="left:460px;top:262px;width:1000px;display:flex;justify-content:center;gap:12px">
        ${['직접 정정', '고정 시그니처', '필수 표현', '금지 단어 추가', '재추출'].map((s, k) => `<span class="pill ${k === 0 ? 'dk' : 'sl'}" style="font-size:19px">${k === 0 ? IC('pen') : ''}${s}</span>`).join('')}
      </div>`;
      root.insertAdjacentHTML('beforeend', UI.card(C.no, C.name, '고객사마다, 따로 배우는 목소리', ['예전에 보낸 문자 올리기', 'AI가 말투를 따로 추출', '회사마다 따로 저장', '같은 한 줄, 다른 목소리']));
    },
    seek(lt) {
      const t = lt, R = this.root, $ = V.$;
      UI.bgSeek(R, t);
      UI.cardSeek(R.querySelector('.card'), t, 2.9);
      V.captions(R.querySelector(':scope > .caps'), t, caps, C.dur - 0.4);

      const vault = V.p(t, S.vault, S.vault + 0.8, 'io');
      const gone = V.p(t, S.vaultOut, S.vaultOut + 0.6, 'io');
      CO.forEach((c, k) => {
        const p = $(`c2p${k}`);
        V.show(p, t, S.panels + k * 0.15, null, { dy: 80, blur: 10, dur: 0.7, base: `scale(${(1 - 0.04 * vault).toFixed(4)})` });
        p.style.opacity = (Number(p.style.opacity) * (1 - gone)).toFixed(3);
        p.style.visibility = gone >= 1 ? 'hidden' : p.style.visibility;
        // 대표 문안이 한 장씩 들어온다
        p.querySelectorAll('.c2m').forEach((m, j) => V.show(m, t, S.msg0 + k * 0.18 + j * S.msgGap, null, { dy: 0, dx: 50, blur: 6, dur: 0.45 }));
        // 추출 단추 · 훑는 빛 · 성격 판정
        V.press(p.querySelector('.c2ext'), t, S.ext[k]);
        const sc = p.querySelector('.c2scan');
        const sp = V.p(t, S.scan[0] + k * 0.12, S.scan[1] + k * 0.12, 'io');
        sc.style.opacity = sp > 0 && sp < 1 ? 1 : 0;
        sc.style.top = `${(sp * 300 - 30).toFixed(1)}px`;
        p.querySelectorAll('.c2kind').forEach((b, j) => {
          const on = t >= S.kind + k * 0.12 + j * 0.1;
          b.textContent = on ? b.dataset.k : '성격 판정 전';
          b.className = `pill c2kind ${on ? (b.dataset.k === '마케팅' ? 'wn' : 'ok') : 'sl'}`;
        });
        // 가이드라인 카드
        const g = p.querySelector('.c2g');
        V.show(g, t, S.guide + k * 0.2, null, { dy: 40, blur: 8, dur: 0.55 });
        g.querySelectorAll('.c2gr').forEach((r, j) => V.show(r, t, S.guide + 0.3 + k * 0.2 + j * S.rowGap, null, { dy: 0, dx: 30, blur: 4, dur: 0.35 }));
        V.show(g.querySelector('.c2kd'), t, S.kinds2 + k * 0.15, null, { dy: 20, blur: 6, dur: 0.4, sc: 0.1, ease: 'back' });
        V.show(p.querySelector('.c2lock'), t, S.vault + 0.6 + k * 0.15, null, { dy: 0, sc: 0.4, blur: 0, dur: 0.4, ease: 'back' });
      });
      // 칸막이
      [0, 1].forEach((k) => {
        const w = $(`c2w${k}`);
        w.style.height = `${(V.p(t, S.vault + 0.1 * k, S.vault + 0.7 + 0.1 * k, 'out') * 800).toFixed(1)}px`;
        w.style.opacity = (1 - gone).toFixed(3);
        w.querySelector('span').style.transform = `translate(-50%,-50%) scale(${V.p(t, S.vault + 0.6, S.vault + 1.0, 'back').toFixed(3)})`;
      });

      // 같은 한 줄 → 세 목소리
      V.show($('c2in'), t, S.line, S.edit - 0.3, { dy: -30, blur: 8, dur: 0.5 });
      const tx = V.typed(LINE, t, S.type, 14);
      $('c2tx').innerHTML = tx + (t < S.phones ? '<span class="caret"></span>' : '');
      V.press($('c2go'), t, S.phones - 0.3);
      CO.forEach((c, k) => {
        const ph = $(`c2ph${k}`);
        V.show(ph, t, S.phones + k * 0.12, null, { dy: 70, blur: 10, dur: 0.6 });
        ph.style.transform += ' scale(0.8)';
        UI.bubble(ph, { t, a: S.typeA + 0.2 * k, b: S.typeB, segs: c.out.segs, top: '오늘 오전 10:00' });
        const tr = $(`c2tr${k}`);
        tr.querySelectorAll('.pill').forEach((n, j) => V.show(n, t, S.traits + k * 0.2 + j * 0.15, null, { dy: 0, dx: -30, blur: 4, dur: 0.4, ease: 'back' }));
      });
      R.querySelectorAll('#c2edit .pill').forEach((n, k) => V.show(n, t, S.edit + 0.1 + k * 0.1, null, { dy: 20, blur: 4, dur: 0.4 }));
      V.pointer(t, [{ at: S.ext[0], node: R.querySelector('#c2p0 .c2ext') }, { at: S.ext[1], node: R.querySelector('#c2p1 .c2ext') }, { at: S.ext[2], node: R.querySelector('#c2p2 .c2ext') }], { tail: 0.5 });
      V.pointer(t, [{ at: S.phones - 0.3, node: $('c2go') }], { tail: 0.4 });
    },
  });
})();
