/**
 * dm-alert-copy.ts — DM 을 알리는 문자 문안 1개 생성 CT(★ 2026-10-24 세 채널 구조체크 ② · 옛 routes/dm.ts POST /:id/generate-copy 본문을 그대로 옮김)
 *
 * 라우트 안에서 AI 를 직접 부르고 혜택만 거르던 것을 CT 로 옮기고 효능 거름을 붙였다(라우트 인라인 금지 · 생산자 출구 = 혜택 → 효능).
 * 근거 = DM 페이지 글 + 추가 요청 · 알고 둔 한계 = DM 페이지 글이 AI 초안 그대로인 옛 DM 은 그 글이 근거가 된다(BUGS B-1024-4).
 */
import { callAIWithFallback, getSeasonContext } from '../../services/ai';
import { buildSystemPromptWithBrandVoice } from '../brand-voice-prompt';
import { extractJsonFromAiText } from '../ai-json';
import { stripAdPartsDeep, normalizeSmsSeparatorLines } from '../messageUtils';
import { findInventedBenefits, replaceInventedBenefits, dropInventedEfficacy, EFFICACY_PROMPT_RULES } from '../copy-benefit-detector';
import { extractFlatSectionsFromDm } from './dm-builder';

export async function generateDmAlertCopy(input: {
  dm: any;
  userPrompt: string;
  lengthMode: 'sms' | 'lms';
  companyId: string;
  userId?: string;
}): Promise<{ message: string; efficacyDropped: number }> {
  const { dm, userPrompt, lengthMode, companyId, userId } = input;
  const dmLines: string[] = [];
  if (dm.title) dmLines.push(`DM 제목: ${dm.title}`);
  if (dm.store_name) dmLines.push(`브랜드/매장: ${dm.store_name}`);
  for (const s of extractFlatSectionsFromDm(dm).slice(0, 24)) {
    const p: any = s?.props || {};
    switch (s?.type) {
      case 'hero': if (p.headline) dmLines.push(`히어로: ${p.headline}${p.sub_copy ? ` / ${p.sub_copy}` : ''}`); break;
      case 'text_card': if (p.headline || p.body) dmLines.push(`텍스트: ${p.headline || ''} ${String(p.body || '').slice(0, 100)}`.trim()); break;
      case 'coupon': if (p.discount_label) dmLines.push(`쿠폰: ${p.discount_label}${p.coupon_code ? ` (코드 ${p.coupon_code})` : ''}`); break;
      case 'instant_coupon': if (p.coupon_label) dmLines.push(`즉시쿠폰: ${p.coupon_label} ${p.discount_description || ''}`.trim()); break;
      case 'product_carousel': {
        // ★ 2026-07-08 가격 동반 요약 — 문안 규칙이 "요약에 적힌 표현만 인용"이라 가격이 여기 있어야 문안에 들어간다
        const items = (Array.isArray(p.products) ? p.products : []).slice(0, 5).map((x: any) => {
          const nm = String(x?.name || '').trim();
          if (!nm) return '';
          const price = Number(x?.price || 0);
          const dis = Number(x?.discount_price || 0);
          if (price > 0 && dis > 0 && dis < price) return `${nm} ${price.toLocaleString('ko-KR')}원 → ${dis.toLocaleString('ko-KR')}원`;
          const fp = dis > 0 ? dis : price;
          return fp > 0 ? `${nm} ${fp.toLocaleString('ko-KR')}원` : nm;
        }).filter(Boolean);
        if (items.length) dmLines.push(`상품: ${items.join(' / ')}`);
        break;
      }
      case 'countdown': if (p.urgency_text) dmLines.push(`마감 안내: ${p.urgency_text}`); break;
      case 'limited_quantity': if (p.title) dmLines.push(`선착순: ${p.title}`); break;
      case 'lucky_draw': if (p.title) dmLines.push(`응모 이벤트: ${p.title}`); break;
      case 'roulette': if (p.title) dmLines.push(`룰렛 이벤트: ${p.title}`); break;
      case 'cta': { const b = (Array.isArray(p.buttons) ? p.buttons : [])[0]; if (b?.label) dmLines.push(`행동 유도: ${b.label}`); break; }
      // ★ 2026-07-07(4) 16섹션 커버리지 — 열거 밖 신규/기타 섹션도 대표 텍스트를 요약에 반영 (탭·설문·투표·이메일수집 등)
      default: {
        const rep = p.headline || p.title || p.question || p.label || p.text;
        if (rep && String(rep).trim()) dmLines.push(`${String(s?.type || '섹션')}: ${String(rep).slice(0, 80)}`);
        break;
      }
    }
  }
  const dmSummary = dmLines.length
    ? `\n\n[DM 페이지 편집 내용: 이 문자는 아래 DM을 알리는 문자입니다. 문안은 반드시 이 내용에 근거해 작성]\n${dmLines.join('\n')}`
    : '';

  // ★ 2026-07-02(3) 계절·시기 감성 주입 — DM 내용 + 시즌감으로 풍성한 카피 (구체 사실 창작은 여전히 금지)
  const { monthLabel, seasonHint } = getSeasonContext();
  const lengthRule = lengthMode === 'sms'
    ? `- 단문(SMS) 우선: %DM링크%는 발송 시 22자 내외 단축링크로 치환됩니다. 링크를 제외한 본문은 한글 기준 28자 안(전체 90바이트 안)으로: 감성 후크 반 줄 + 핵심 한 조각 + %DM링크%. 줄바꿈 없이 한 줄.`
    : `- 밋밋한 나열 대신 감성 후크(첫 줄) + 핵심 내용 + 행동 유도 흐름으로.
- 80~250자. 줄바꿈은 실제 줄바꿈 문자로.`;
  const baseSystem = `당신은 한줄로 SMS/LMS 마케팅 카피라이터입니다. 아래 조건으로 ${lengthMode === 'sms' ? '단문(SMS)' : 'LMS'} 문자 본문 1개만 작성합니다.
- 반드시 %DM링크% 를 문안 안 자연스러운 위치에 1회 포함(수신자별 개인화 링크가 여기 들어갑니다).
- 혜택·쿠폰·이벤트는 [DM 페이지 편집 내용]에 실제 적힌 표현만 그대로 인용. 거기 없는 혜택(%/원/쿠폰/무료/할인/사은품/적립) 임의 창작 절대 금지.
- 지금은 ${monthLabel}(${seasonHint}). 계절감과 시기 감성을 가벼운 수식·인사로 자연스럽게 녹여 카피를 풍성하게. 단 시즌 묘사는 일반적 사실만, 통계·행사 등 구체 사실 지어내기 금지.
- [DM 페이지 편집 내용]에 상품 가격이 있으면 대표 상품 1~3개를 "정가 → 할인가" 형식 그대로 본문에 담아라(전 상품 나열로 장황해지지 않게).
- 구분선은 하이픈 10개(----------)를 초과 금지. 긴 대시/등호/특수문자 줄은 휴대폰에서 두 줄로 꺾여 보인다.
${lengthRule}
- 유니코드 이모지 금지(SMS 호환).
- 개인화는 %고객명% 등 명시된 변수만 사용.
${EFFICACY_PROMPT_RULES}
[출력 형식: 절대 준수] 문자 본문 텍스트만 그대로 출력. JSON·코드블록·따옴표·"channel"·"body" 같은 형식 절대 금지.${dmSummary}`;
  const system = await buildSystemPromptWithBrandVoice(companyId, baseSystem);

  const text = await callAIWithFallback({
    system,
    userMessage: `${userPrompt ? `추가 요청: ${userPrompt}\n\n` : ''}[DM 페이지 편집 내용]을 고객에게 알리는 LMS 문안 1개를 본문 텍스트로만 작성하세요. %DM링크% 를 포함하세요.`,
    model: 'sonnet',
    maxTokens: 800,
    temperature: 0.7,
    companyId,
    source: 'dm-copy-generate',
    creditCost: 3,
    userId,
  });

  let msg = String(text || '').trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  // ★ 방어 파싱 — AI가 형식을 어기고 {"channel","body"} JSON으로 답하면 body만 추출 (JSON 원문 노출 차단)
  if (msg.startsWith('{')) {
    try {
      const parsed: any = extractJsonFromAiText(msg);
      const body = parsed?.body ?? parsed?.message ?? parsed?.text;
      if (typeof body === 'string' && body.trim()) msg = body.trim();
    } catch { /* JSON 아님 = 텍스트 그대로 */ }
  }
  // 리터럴 \n(백슬래시+n)로 온 줄바꿈을 실제 줄바꿈으로 정규화
  msg = msg.replace(/\\n/g, '\n').trim();
  // ★ 2026-07-02: AI가 문안에 넣은 (광고)/무료수신거부(임의 번호 포함) 제거 —
  //   080 문구는 발송 시점에 buildAdMessage가 설정된 번호로 합성한다.
  msg = stripAdPartsDeep(msg);
  // ★ 2026-07-08 긴 구분선 줄 정규화 — 기기 화면 폭에서 두 줄로 꺾이는 것 차단 (CT-messageUtils)
  msg = normalizeSmsSeparatorLines(msg);
  // ★ 2026-09-30 WP2 혜택 서버 차단 — 근거 = DM 페이지 편집 내용 + 추가 요청. 없는 혜택 값 · 낱말은 자리표시
  //   (이 문안은 문자 발송 길목을 지나고, 자리표시는 send-placeholder-gate 가 막는다 · 사람이 채우거나 지운 뒤에만 발송).
  // ★ 2026-10-24 ② 근거 = DM 페이지 글 + 추가 요청(우리 감싸기 문장은 뺀다 · 혜택 · 효능 같은 근거)
  const dmCopyGround = `${dmLines.join('\n')}\n${userPrompt || ''}`;
  const dmCopyInvented = findInventedBenefits(msg, dmCopyGround);
  if (dmCopyInvented.length > 0) {
    msg = replaceInventedBenefits(msg, dmCopyGround);
    console.warn(`[copy-guard] DM 알림 문안 근거 없는 혜택 → 자리표시 (${dmCopyInvented.join(', ')})`);
  }
  // ★ 2026-10-24 세 채널 구조체크 ② — 근거 없는 효능 문장을 뺀다(다 빠지면 직접 채울 자리 · 발송 길목이 막는다)
  const eff = dropInventedEfficacy(msg, dmCopyGround);
  if (eff.dropped.length > 0) console.warn(`[copy-guard] DM 알림 문안 근거 없는 효능 ${eff.dropped.length}문장 뺌`);
  msg = eff.text;
  return { message: msg, efficacyDropped: eff.dropped.length };
}
