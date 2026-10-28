/**
 * ★ CT: Email AI 컨트롤타워 (2026-06-13 신설)
 *
 * 목적
 *   Email 캠페인 AI 기능 — 원샷 생성 / 다듬기 / 발송 전 진단 / 발송 후 성과 진단 / 발송 시간 추천.
 *   호출부 = routes/email.ts (checkCredit → 본 함수 → 성공 후 deductCreditSafe — dm.ts 패턴 1:1).
 *
 * 크레딧 (CREDIT_COST_MAP 1:1)
 *   email-ai-generate 3 / email-refine 1 / email-precheck 1 /
 *   email-performance-insight 5 / email-send-time-recommend 5
 *   - 본 파일의 callAIWithFallback은 전부 creditCost: 0 — 차감은 route에서 작업 성공 후 1회만 (이중 차감 차단 + 실패 시 차감 0).
 *
 * ⛔ 영구 원칙
 *   - 구체 혜택(%/원/쿠폰/무료/사은품) 임의 생성 절대 금지 → [혜택을 직접 입력해주세요] placeholder
 *   - placeholder 잔존 캠페인 = 발송 차단 (hasUneditedPlaceholder)
 *   - (광고) prefix / 수신거부 링크 = 발송 시 시스템 자동 부착 — AI가 직접 작성 금지
 *   - 모델명/내부 시스템명 사용자 노출 절대 금지
 *   - 추정 숫자(전환율/오픈율 예측치) 임의 생성 금지 — 실측 집계만 전달
 */
import { UserFacingError } from './http-error';
import { callAIWithFallback } from '../services/ai';
import { extractJsonFromAiText, aiStr } from './ai-json';   // ★ 2026-10-26 S8 — AI JSON 칸 = 글일 때만
import { htmlVisibleText, replaceInventedBenefits, replaceInventedBenefitsDeep, claimsInventedEfficacy, dropInventedEfficacy, dropInventedEfficacyDeep, pairClaimsInventedEfficacy, rewriteAddsFacts, readingAddsEfficacy, EFFICACY_PLACEHOLDER, HEADLINE_PLACEHOLDER, EFFICACY_PROMPT_RULES, EFFICACY_REWRITE_RULE } from './copy-benefit-detector';
import { composeVoicePrompt } from './brand-voice-prompt';
import { resolveCopyIntent } from './copy-content-type';
// 비주얼 빌더: AI 블록 출력 → 검증된 email Section[]
import { normalizeAiBlocksToSections, buildCarouselProductsFromExtracted } from './email/email-blocks';
// ★ 2026-07-13 행사 상품 URL 페이지 og:image 자동 채움 — DM one-shot과 공용(SSRF 리다이렉트 가드 내장)
import { fetchProductOgImages } from './dm/dm-brand-extractor';
import type { Section } from './dm/dm-section-registry';
// 비주얼 에디터 "AI로 개선" 순수 코어(텍스트 수집·안전 검증·반영)
import { collectRefinableTexts, applyRefinedTexts, isRefinedTextSafe } from './email/email-section-refine';
// 문안 두뇌: 성과 RAG + 시의성 + 브랜드 키트 주입 + 타사 표현 복제 가드
import { composeCopyBrain } from './copy-prompt-composer';
import { buildEventPromptBlock, validateProductsAgainstEventText } from './event-brief';
// ★ 2026-07-14 디자인 4.0 M5 — 행사 → 정예 템플릿 스토리 힌트 (결정적 선택기, design-core)
import { buildEventTemplateHintBlock } from './design-core/event-package';
// ★ 2026-09-03 참조 골격 학습층(설계서 §6-2)
import { getStructureSkeleton } from './best-copy-assets';
import { renderStructureBlock } from './email/email-structure-prompt';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface EmailCodeCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface EmailSpamRiskResult {
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
  suggestions: string[];
}

export interface EmailInsightResult {
  topInsight: string;
  suggestions: Array<{ title: string; description: string }>;
}

export type EmailScenarioKey =
  | 'cart' | 'dormant' | 'vip' | 'new' | 'repurchase' | 'birthday' | 'newsletter';

export const EMAIL_SCENARIO_PRESETS: Record<EmailScenarioKey, { label: string; prompt: string }> = {
  cart: {
    label: '장바구니 리마인드',
    prompt: '장바구니에 상품을 담아두고 결제하지 않은 고객에게 부담 없이 결제를 이어가도록 안내하는 리마인드 이메일',
  },
  dormant: {
    label: '휴면 고객 재활성',
    prompt: '오랫동안 방문하지 않은 휴면 고객에게 다시 찾아올 이유를 따뜻하게 전하는 재방문 유도 이메일',
  },
  vip: {
    label: 'VIP 감사',
    prompt: 'VIP 등급 고객에게 감사를 전하고 전용 안내를 담는 프리미엄 톤 이메일',
  },
  new: {
    label: '신상품 안내',
    prompt: '새로 출시된 상품/서비스를 소개하고 자세히 보기로 연결하는 신상품 안내 이메일',
  },
  repurchase: {
    label: '재구매 유도',
    prompt: '이전 구매 고객에게 재구매 시점을 자연스럽게 환기하는 이메일',
  },
  birthday: {
    label: '생일 축하',
    prompt: '생일을 맞은 고객에게 축하 인사를 전하는 따뜻한 톤의 이메일',
  },
  newsletter: {
    label: '뉴스레터',
    prompt: '브랜드 소식·읽을거리를 섹션 2~3개로 정돈해 전하는 월간 뉴스레터 이메일',
  },
};

// ════════════════════════════════════════════════════════════════════
// 순수 헬퍼 (검증 스크립트 대상 — DB/AI 의존 0)
// ════════════════════════════════════════════════════════════════════

/** AI placeholder 잔존 검사 — [혜택을 직접 입력해주세요] 류가 남아 있으면 true (발송 차단) */
// ★ 2026-10-05 export 만 추가(동작 불변) — 화면 완성도 줄이 같은 기준으로 세는지 짝 테스트가 글자 단위로 대조한다
export const PLACEHOLDER_PATTERN = /\[[^\[\]\n]{0,60}(직접|입력해|작성해)[^\[\]\n]{0,60}\]/;

export function hasUneditedPlaceholder(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => !!t && PLACEHOLDER_PATTERN.test(t));
}

/** placeholder 위치·샘플 검출 — 발송 차단 메시지·목록 배지 공용(같은 PLACEHOLDER_PATTERN 단일 소스). 없으면 null. */
export function findUneditedPlaceholder(
  subject?: string | null,
  htmlBody?: string | null,
  textBody?: string | null,
): { where: '제목' | '본문' | '텍스트'; sample: string } | null {
  const fields: Array<['제목' | '본문' | '텍스트', string | null | undefined]> = [
    ['제목', subject],
    ['본문', htmlBody],
    ['텍스트', textBody],
  ];
  for (const [where, t] of fields) {
    if (!t) continue;
    const m = t.match(PLACEHOLDER_PATTERN);
    if (m) return { where, sample: m[0] };
  }
  return null;
}

/** 제목 길이 점검 — 모바일 수신함 잘림 기준 40자 */
export const SUBJECT_MOBILE_LIMIT = 40;

export function checkSubjectLength(subject: string): { length: number; warn: boolean } {
  const length = (subject || '').trim().length;
  return { length, warn: length > SUBJECT_MOBILE_LIMIT };
}

/** HTML 안 외부 링크 수 (트래킹 래핑 대상과 동일 기준) */
export function countExternalLinks(html: string): number {
  if (!html) return 0;
  const matches = html.match(/<a\b[^>]*?\bhref\s*=\s*"https?:\/\/[^"]+"/gi);
  return matches ? matches.length : 0;
}

/** 발송 전 기계 체크 (코드 — 크레딧 0) */
export function runEmailCodeChecks(input: {
  subject: string;
  htmlBody: string;
  textBody?: string | null;
  isAd: boolean;
}): EmailCodeCheck[] {
  const checks: EmailCodeCheck[] = [];

  const placeholder = hasUneditedPlaceholder(input.subject, input.htmlBody, input.textBody);
  checks.push({
    key: 'placeholder',
    label: '미입력 placeholder',
    status: placeholder ? 'fail' : 'pass',
    detail: placeholder
      ? '직접 입력이 필요한 자리가 남아 있습니다. 모두 채워야 발송할 수 있습니다.'
      : '남은 placeholder가 없습니다.',
  });

  const sub = checkSubjectLength(input.subject);
  checks.push({
    key: 'subject_length',
    label: '제목 길이',
    status: sub.warn ? 'warn' : 'pass',
    detail: sub.warn
      ? `제목 ${sub.length}자: 모바일 수신함에서 ${SUBJECT_MOBILE_LIMIT}자 이후가 잘릴 수 있습니다.`
      : `제목 ${sub.length}자: 모바일 수신함 기준 적정 길이입니다.`,
  });

  const linkCount = countExternalLinks(input.htmlBody);
  checks.push({
    key: 'links',
    label: '클릭 추적 링크',
    status: linkCount > 0 ? 'pass' : 'warn',
    detail: linkCount > 0
      ? `외부 링크 ${linkCount}건: 발송 시 클릭 추적이 자동 적용됩니다.`
      : '외부 링크가 없어 클릭 성과를 측정할 수 없습니다.',
  });

  checks.push({
    key: 'text_body',
    label: '텍스트 본문',
    status: input.textBody && input.textBody.trim() ? 'pass' : 'warn',
    detail: input.textBody && input.textBody.trim()
      ? '텍스트 본문이 있어 HTML 차단 환경에서도 내용이 전달됩니다.'
      : 'HTML만 있으면 일부 수신 환경·스팸 필터에 불리합니다. 텍스트 본문을 함께 넣어주세요.',
  });

  checks.push({
    key: 'ad_compliance',
    label: '광고 표기',
    status: 'pass',
    detail: input.isAd
      ? '광고성 캠페인: 발송 시 "(광고)" 표기와 수신거부 링크가 자동 부착됩니다.'
      : '비광고 캠페인: 광고성 내용이라면 캠페인 설정에서 광고성으로 변경해야 합니다.',
  });

  return checks;
}

/** KST 시간대별 오픈 분포 정리 — 표본 합계 + 상위 3 시간대 (추정치 0, 실측 비중만) */
export function binOpenHours(rows: Array<{ hour: number; cnt: number }>): {
  total: number;
  top: Array<{ hour: number; cnt: number; pct: number }>;
} {
  const total = rows.reduce((sum, r) => sum + (Number(r.cnt) || 0), 0);
  const top = [...rows]
    .filter((r) => Number(r.cnt) > 0)
    .sort((a, b) => Number(b.cnt) - Number(a.cnt))
    .slice(0, 3)
    .map((r) => ({
      hour: Number(r.hour),
      cnt: Number(r.cnt),
      pct: total > 0 ? Math.round((Number(r.cnt) / total) * 100) : 0,
    }));
  return { total, top };
}

// ════════════════════════════════════════════════════════════════════
// AI 호출 — 전부 creditCost: 0 (차감은 route에서 성공 후 1회)
// ════════════════════════════════════════════════════════════════════

const EMAIL_HTML_RULES = `
[HTML 규격: 이메일 클라이언트 호환 의무]
- 전체를 <table> 기반 레이아웃으로 작성, 최대 폭 600px 중앙 정렬.
- 모든 스타일은 인라인 style 속성만 사용 (<style> 태그/외부 CSS 금지, JavaScript 금지).
- 밝은 배경(바깥 #f4f5f7, 본문 카드 #ffffff), 본문 글자색 #333333 계열, 글꼴 font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif.
- 버튼은 <a>를 테이블 셀 배경색과 padding으로 감싼 형태(이미지 버튼 금지).
- 이미지는 사용하지 않는다 (수신자 환경에서 깨질 수 있는 외부 이미지 URL 금지).
- 수신 인사에 {{이름}} 변수를 사용할 수 있다 (발송 시 고객 이름으로 치환).

[절대 금지]
- 구체 혜택 수치(할인율 %, 금액, 쿠폰, 무료, 사은품, 적립)를 임의로 만들지 않는다. 혜택 언급이 필요한 자리는 반드시 "[혜택을 직접 입력해주세요]" 그대로 적는다.
- 수신거부 링크/문구를 직접 작성하지 않는다 (발송 시 시스템이 자동 부착).
- 제목에 "(광고)" 표기를 직접 넣지 않는다 (광고성 캠페인은 발송 시 자동 부착).
- 존재하지 않는 회사 정보·날짜·행사를 단정해 적지 않는다. 필요하면 "[기간을 직접 입력해주세요]" 형태로 남긴다.
${EFFICACY_PROMPT_RULES}`;

export interface EmailSectionsGenResult {
  name: string;
  subjects: string[];
  preheader: string;
  sections: Section[];
  /** ★ 2026-10-24 ② 근거 없는 효능을 뺀 수(라우트가 notes 서버 문장으로 바꾼다 · 응답에 그대로 내보내지 않는다) */
  efficacyDropped: number;
}

const EMAIL_BLOCKS_SYSTEM = `당신은 한국어 이메일 마케팅 디자이너입니다. 회사 마케팅 담당자의 요청을 바탕으로 발송 가능한 비주얼 이메일의 블록 구성을 설계합니다.

[사용 가능한 블록: 아래 type만 사용]
- header: { "variant": "logo", "brand_name": "회사명" }
- hero: { "headline": "큰 제목", "sub_copy": "한 줄 부제", "align": "center", "height": "md" }
- text_card: { "tag": "라벨", "headline": "소제목", "body": "본문 2~3문장", "align": "left", "image_position": "top" }
- product_carousel: { "title": "추천 상품", "products": [{ "name": "상품명", "price": 0, "discount_price": 0, "image_url": "", "link_url": "" }] }
- gallery: { "title": "갤러리", "images": [{ "url": "" }] }
- coupon: { "discount_label": "혜택 제목", "coupon_code": "" }
- cta: { "buttons": [{ "label": "버튼 글", "url": "", "style": "primary" }], "layout": "stack" }
- store_info: { "address": "", "phone": "", "business_hours": "" }
- footer: { "notes": "회사 안내 한 줄", "cs_phone": "", "legal_text": "" }

[절대 규칙]
- 위 type만 사용한다. 그 외 type 금지.
- 모든 이미지(image_url, url)는 빈 문자열로 둔다 (회사가 직접 업로드).
- 구체 혜택 수치(할인율, 금액, 쿠폰코드, 무료, 사은품)는 임의로 만들지 않는다. 혜택 자리는 "[혜택을 직접 입력해주세요]" 텍스트로 두고, coupon_code는 빈 문자열로 둔다.
- 단, [행사 내용] 원문에 상품명·가격이 적혀 있으면 그것은 창작이 아니다. product_carousel 1개에 그 상품들을 원문 수치 그대로 담는다(정가 price, 할인가 discount_price. 원문에 없는 상품·가격 추가 금지).
- [행사 내용] 원문에 상품 URL(http/https)이 적혀 있으면 해당 상품의 link_url에 원문 글자 그대로 넣는다(변형·축약·생성 금지). 원문에 URL이 없으면 link_url은 빈 문자열.
- 모든 버튼 url은 빈 문자열로 둔다.
- 권장 순서: header → hero → 본문(text_card / product_carousel / gallery) → cta → footer.
${EFFICACY_PROMPT_RULES}

반드시 아래 JSON으로만 출력한다 (코드블록/설명 금지):
{ "name": "캠페인 이름(30자 이내)", "subjects": ["제목1","제목2","제목3"], "preheader": "수신함 미리보기(50자 이내)", "blocks": [ { "type": "hero", "props": {} } ] }`;

/** AI 비주얼 생성 — 요청 → 이메일 블록 Section[](이미지·혜택은 빈 자리). 크레딧 차감은 route에서 성공 후. */
export async function generateEmailSections(input: {
  companyId: string;
  userId?: string;
  prompt?: string;
  scenario?: EmailScenarioKey;
  isAd: boolean;
  /** ★ 2026-07-07(4) 행사 캠페인 — 행사 원문. 기재된 혜택만 원문 그대로 인용, 없으면 기존 placeholder 규칙 */
  eventText?: string;
}): Promise<EmailSectionsGenResult> {
  const scenarioPreset = input.scenario ? EMAIL_SCENARIO_PRESETS[input.scenario] : null;
  const parts: string[] = [];
  const eventBlock = input.eventText ? buildEventPromptBlock(input.eventText) : '';
  if (eventBlock) parts.push(eventBlock);
  // ★ 2026-07-14 디자인 4.0 M5 — 행사 성격 → 정예 템플릿 스토리 힌트(결정적 매칭, 빈 행사문 = '' 우회)
  const templateHint = input.eventText ? buildEventTemplateHintBlock(input.eventText) : '';
  if (templateHint) parts.push(templateHint);
  if (scenarioPreset) parts.push(`[시나리오] ${scenarioPreset.label}: ${scenarioPreset.prompt}`);
  if (input.prompt) parts.push(`[요청 내용] ${input.prompt}`);
  parts.push(`[캠페인 성격] ${input.isAd ? '광고성 (표기는 발송 시 자동 부착, 직접 넣지 말 것)' : '정보성'}`);

  // ★ 2026-10-28 AI 메모리 설계 K11-1 · K11-2 — 이메일 생성 = 쓰기 · HTML 이라 말투 · 호칭 · 맺음만(모양 · 이모지 = 이메일 규칙)
  const baseSystem = (await composeVoicePrompt({
    companyId: input.companyId, producer: 'email-generate', mode: 'write', scope: 'tone',
    kind: resolveCopyIntent({ isAd: input.isAd }).kind, isAd: input.isAd, basePrompt: EMAIL_BLOCKS_SYSTEM,
  })).system;
  const brain = await composeCopyBrain({
    companyId: input.companyId,
    channels: ['EMAIL', 'LMS', 'MMS', 'SMS'],
    isAd: input.isAd,
  });
  // ★ 2026-09-03 참조 골격(설계서 §6-2) — 통계 문장만 붙는다(시퀀스 원문 0). serving off·골격 없음 = '' → 현행 system과 문자 단위 동일.
  const skeleton = await getStructureSkeleton('general', 'EMAIL');
  const structureBlock = skeleton ? renderStructureBlock(skeleton.meta.stats) : '';
  const text = await callAIWithFallback({
    system: baseSystem + brain.promptSuffix + structureBlock,
    userMessage: `${parts.join('\n')}\n\n위 요청으로 비주얼 이메일의 블록 구성을 JSON으로 설계하세요.`,
    maxTokens: 4000,
    temperature: 0.7,
    model: 'opus',
    companyId: input.companyId,
    userId: input.userId,
    source: 'email-ai-generate',
    creditCost: 0,
  });

  const parsed = extractJsonFromAiText<{ name?: string; subjects?: string[]; preheader?: string; blocks?: unknown[] }>(text);
  const sections = normalizeAiBlocksToSections(parsed.blocks);
  if (sections.length === 0) {
    throw new UserFacingError(502, 'AI_RESULT_EMPTY', 'AI 블록 생성 결과가 비어 있습니다. 다시 시도해주세요.');
  }
  // ★ 2026-07-08 행사 원문 상품 기계 검증 — 가격이 원문에 실존하는 상품만 통과(환각 가격 차단, DM과 동일 규칙)
  // ★ 2026-07-13 — link_url 보존(검증기 3중 검증 + 결정적 배정 통과분) + og:image 자동 채움 (DM one-shot 미러).
  //   옛 map이 name/price만 재조립해 link_url을 유실하던 결함 정정. og 실패/사설 호스트/부재 = 빈 값 유지(생성 차단 X).
  // ★ 2026-10-19 B-1010-1 — 원문이 없으면 요청 글이 근거다(옛: 한 줄 이메일은 원문이 비어 대조가 돌지 않아, AI 가 쓴 가격이 뒤의 몰 자동 첨부 사진 · 링크와 함께 나갔다).
  const productGround = input.eventText || input.prompt || '';
  if (productGround) {
    for (const s of sections) {
      if (s.type !== 'product_carousel') continue;
      const p: any = s.props || {};
      const validated = validateProductsAgainstEventText(p.products, productGround);
      let ogImages: Array<string | undefined> = [];
      try {
        ogImages = await fetchProductOgImages(validated.map((v) => v.link_url));
      } catch { /* og 조회 실패 = 빈 값 유지 — 생성 흐름 무영향 */ }
      p.products = buildCarouselProductsFromExtracted(validated, ogImages);
      s.props = p;
    }
  }
  // ★ 2026-09-30 WP2 혜택 서버 차단 — 블록 글 필드의 없는 혜택 값 · 낱말은 자리표시
  //   (링크 · 이미지 · 모양 값 · 가격 숫자 필드는 건너뜀 · 상품 가격은 위 원문 검증이 이미 본다). 이메일 발송 가드가 자리표시를 막는다.
  // ★ 2026-10-24 세 채널 구조체크 ② — 근거 = 사람 글(행사 원문 + 요청)만. 옛 근거 parts 는 우리 규칙 문장(「쿠폰 · 무료 · 사은품」) ·
  //   시나리오 프리셋 · 템플릿 힌트를 품어 그 낱말이 근거가 됐다. 혜택 · 효능 같은 근거 변수(설계서 §3).
  const blocksGround = [input.eventText, input.prompt].filter(Boolean).join('\n');
  const blockInvented: string[] = [];
  const effDropped: string[] = [];
  // 혜택 → 효능 순(효능 문장 빼기는 혜택 자리표시가 들어간 글 위에서 돈다)
  const guardedSections = dropInventedEfficacyDeep(replaceInventedBenefitsDeep(sections, blocksGround, blockInvented), blocksGround, effDropped);
  const subjects = (Array.isArray(parsed.subjects) ? parsed.subjects : [])
    .map((s) => replaceInventedBenefits(String(s || '').trim(), blocksGround)).filter(Boolean)
    .filter((s) => { const bad = claimsInventedEfficacy(s, blocksGround); if (bad) effDropped.push(s); return !bad; })
    .slice(0, 3);
  while (subjects.length > 0 && subjects.length < 3) subjects.push(subjects[0]);
  const pre = dropInventedEfficacy(replaceInventedBenefits(aiStr(parsed.preheader).trim(), blocksGround), blocksGround);
  effDropped.push(...pre.dropped);
  // 수신함에서 제목 바로 뒤에 이어 읽힌다 — 어느 제목 후보와 이어 읽어도 단정이면 프리헤더를 비운다(★ Codex 1R)
  let preheader = pre.text === EFFICACY_PLACEHOLDER ? '' : pre.text;
  if (preheader && subjects.some((s) => pairClaimsInventedEfficacy(s, preheader, blocksGround))) { effDropped.push(preheader); preheader = ''; }
  if (blockInvented.length > 0) console.warn(`[copy-guard] 비주얼 이메일 근거 없는 혜택 → 자리표시 (${Array.from(new Set(blockInvented)).join(', ')})`);
  if (effDropped.length > 0) console.warn(`[copy-guard] 비주얼 이메일 근거 없는 효능 ${effDropped.length}곳 뺌`);
  return {
    name: aiStr(parsed.name).trim().slice(0, 60) || 'AI 비주얼 이메일',
    // 제목 후보가 다 빠지면 채울 자리(옛 '새 이메일' 무언 대체 금지 · 설계서 §2)
    subjects: subjects.length ? subjects : [HEADLINE_PLACEHOLDER],
    // 프리헤더 = 비워도 되는 칸(다 빠지면 빈 값)
    preheader: preheader.slice(0, 100),
    sections: guardedSections,
    efficacyDropped: effDropped.length,
  };
}

export async function refineEmail(input: {
  companyId: string;
  userId?: string;
  subject: string;
  htmlBody: string;
  instruction: string;
}): Promise<{ subject: string; htmlBody: string }> {
  // ★ 2026-10-28 K11-1 — 이메일 다듬기 = 고치기(예시 0 · 원문 꼴 유지) · 성격을 받지 않는 편집기라 광고 여부 기본(마케팅 편집기)
  const { system } = await composeVoicePrompt({
    companyId: input.companyId, producer: 'email-refine', mode: 'rewrite', scope: 'tone', kind: resolveCopyIntent({ isAd: true }).kind,
    basePrompt: `당신은 한국어 이메일 마케팅 카피 에디터입니다. 기존 이메일의 구조를 유지하면서 지시에 따라 다듬습니다.
${EMAIL_HTML_RULES}

${EFFICACY_REWRITE_RULE}

반드시 아래 JSON 스키마로만 출력합니다 (코드블록/설명 금지):
{ "subject": "다듬은 제목", "html_body": "다듬은 HTML 전체" }`,
  });

  const text = await callAIWithFallback({
    system,
    userMessage: `[현재 제목]\n${input.subject}\n\n[현재 HTML]\n${input.htmlBody}\n\n[다듬기 지시]\n${input.instruction}\n\n지시를 반영해 JSON으로 출력하세요.`,
    maxTokens: 4000,
    temperature: 0.5,
    model: 'opus',
    companyId: input.companyId,
    userId: input.userId,
    source: 'email-refine',
    creditCost: 0,
  });

  const parsed = extractJsonFromAiText<{ subject?: string; html_body?: string }>(text);
  const subject = aiStr(parsed.subject).trim();
  const htmlBody = aiStr(parsed.html_body).trim();
  if (!subject || !htmlBody) throw new UserFacingError(502, 'AI_REFINE_EMPTY', 'AI 다듬기 결과가 비어 있습니다. 다시 시도해주세요.');
  // ★ 2026-09-30 WP2 — 다듬기 = 다시 쓰기. 근거 = 원래 제목 · 본문의 **보이는 글** · 다듬기 지시(지시에 적은 새 혜택 · 숫자는 사람이 준 것).
  //   원래 HTML 을 그대로 근거에 넣으면 속성 값(width="100%")이 혜택 근거가 된다(Codex 0930 2R). 다른 다시 쓰기 경로와 같게
  //   근거에 없는 숫자 · 혜택이 생기면 적용하지 않는다(차감 전 throw · 화면 = 이 문장).
  // ★ 2026-10-24 ② 판정 = rewriteAddsFacts(숫자 ∥ 혜택 ∥ 효능 · 0930 근거 그대로) + 이어 읽는 단위의 효능(readingAddsEfficacy · 보이는 글 줄 · 연달아 온 문단 태그 · <br> = 한 경계 · 이웃 문단도 이어 읽힌다 · Codex 2R · 4R)
  const refineGround = `${input.subject}\n${htmlVisibleText(input.htmlBody)}\n${input.instruction}`;
  const refinedVisible = `${subject}\n${htmlVisibleText(htmlBody)}`;
  const visibleLines = (html: string) => htmlVisibleText(html).split(/\n+/);
  if (rewriteAddsFacts(refinedVisible, refineGround) || readingAddsEfficacy([subject, ...visibleLines(htmlBody)], [input.subject, ...visibleLines(input.htmlBody)], input.instruction)) {
    throw new UserFacingError(422, 'REFINE_ADDS_FACTS', '원문에 없는 숫자 · 혜택 · 효능 말이 생겨 적용하지 않았어요. 다시 눌러 주세요.');
  }
  return { subject, htmlBody };
}

const EMAIL_SECTION_REFINE_SYSTEM = `당신은 한국어 이메일 마케팅 카피 에디터입니다. 이메일 블록의 텍스트 조각들을 더 매끄럽고 설득력 있게 다듬습니다.
규칙:
- 입력은 텍스트 조각 배열입니다. 같은 개수·같은 순서의 배열로, 다듬은 텍스트만 출력합니다.
- 의미와 사실(상품/혜택/금액/할인율/날짜/숫자/링크/연락처)은 절대 바꾸지 않습니다. 원본에 없는 정보나 혜택을 새로 만들지 않습니다.
- {{ ... }} 형태의 변수 토큰은 글자 그대로 보존합니다(삭제·수정 금지).
- [직접 작성해주세요] 같은 자리표시자는 그대로 둡니다.
- (광고) 표기나 수신거부 문구를 새로 넣지 않습니다(시스템이 자동 처리).
- 빈 텍스트는 빈 문자열로 둡니다.
${EFFICACY_REWRITE_RULE}
반드시 아래 JSON 스키마로만 출력합니다 (코드블록/설명 금지):
{ "texts": ["다듬은 텍스트 1", "다듬은 텍스트 2"] }`;

/**
 * 비주얼 에디터 "AI로 개선" — 블록의 마케팅 카피 텍스트만 다듬어 Section[] 반환.
 * 사실·혜택·법적 필드는 수집 대상이 아니고, 변수/자리표시자 손실분은 원본 유지(안전 코어).
 * 다듬을 텍스트가 없거나 ★ 2026-10-24 실제로 바뀐 조각이 0 이면 changed=false(호출부가 차감하지 않음 · 옛: 전부 되돌려도 1크레딧).
 * rejected = 원문에 없는 숫자 · 혜택 · 효능이 생겨 원래 글로 둔 조각 수(라우트가 notes 서버 문장으로).
 */
export async function refineEmailSections(input: {
  companyId: string;
  userId?: string;
  sections: Section[];
  instruction?: string;
}): Promise<{ sections: Section[]; changed: boolean; rejected: number }> {
  const { slots, texts } = collectRefinableTexts(input.sections);
  if (texts.length === 0) return { sections: input.sections, changed: false, rejected: 0 };

  // ★ 2026-10-28 K11-1 — 블록 카피 다듬기 = 고치기(예시 0 · 원문 꼴 유지)
  const { system } = await composeVoicePrompt({
    companyId: input.companyId, producer: 'email-section-refine', mode: 'rewrite', scope: 'tone', kind: resolveCopyIntent({ isAd: true }).kind,
    basePrompt: EMAIL_SECTION_REFINE_SYSTEM,
  });
  const userInstruction = (input.instruction || '전체 카피를 더 매끄럽고 자연스럽게 다듬어주세요.').trim();
  const text = await callAIWithFallback({
    system,
    userMessage: `[다듬기 지시]\n${userInstruction}\n\n[텍스트 조각 ${texts.length}개: 같은 순서·같은 개수로 다듬어 JSON 출력]\n${JSON.stringify(texts)}`,
    maxTokens: 3000,
    temperature: 0.5,
    model: 'opus',
    companyId: input.companyId,
    userId: input.userId,
    source: 'email-refine',
    creditCost: 0,
  });

  const parsed = extractJsonFromAiText<{ texts?: unknown }>(text);
  const refined = Array.isArray(parsed?.texts) ? (parsed.texts as unknown[]).map((t) => String(t ?? '')) : null;
  if (!refined || refined.length !== texts.length) {
    throw new UserFacingError(502, 'AI_RESULT_EMPTY', 'AI 다듬기 결과를 해석하지 못했습니다. 다시 시도해주세요.');
  }
  // ★ 2026-09-30 WP2 — 조각마다 표현만 바꾼다. 원래 조각 · 지시에 없던 숫자 · 혜택 값이 생긴 조각은 원래 글로 되돌린다.
  // ★ 2026-10-24 ② 판정 = rewriteAddsFacts(숫자 ∥ 혜택 ∥ 효능)
  //   ★ Codex 3R — 바뀌지 않은 조각은 판정하지 않는다(버린 수에 넣지 않음) · 조각 근거 = 그 조각 + 지시(0930 계약 그대로 · Codex 4R = 이웃 조각을 근거로 넓히면 다른 상품의 할인을 옮겨 온다)
  let rejected = 0;
  const safeRefined = refined.map((r, i) => {
    if (r === texts[i]) return r;
    if (!rewriteAddsFacts(r, `${texts[i]}\n${userInstruction}`)) return r;
    rejected += 1;
    return texts[i];
  });
  // ★ Codex 1R — 섹션째 다시 본다(고친 조각 + 남은 조각을 고객이 이어 읽는다 · 「피부 고민」 + 「매끈하게 달라져요」) · 걸린 섹션은 조각 전부 원래 글
  //   적용 결과 = applyRefinedTexts 가 실제로 넣는 값(안전 실패 조각은 원래 글) · changed = 그 결과로 정한다(차감 근거)
  const effective = safeRefined.map((r, i) => (isRefinedTextSafe(texts[i], r) ? r : texts[i]));
  const bySection = new Map<number, number[]>();
  slots.forEach((slot, i) => bySection.set(slot.si, [...(bySection.get(slot.si) || []), i]));
  for (const idx of bySection.values()) {
    if (idx.every((i) => effective[i] === texts[i])) continue;
    if (!readingAddsEfficacy(idx.map((i) => effective[i]), idx.map((i) => texts[i]), userInstruction)) continue;
    rejected += 1;
    for (const i of idx) effective[i] = texts[i];
  }
  const changed = effective.some((r, i) => r !== texts[i]);
  if (!changed) return { sections: input.sections, changed: false, rejected };
  const sections = applyRefinedTexts(input.sections, slots, effective);
  return { sections, changed: true, rejected };
}

export async function analyzeSpamRisk(input: {
  companyId: string;
  userId?: string;
  subject: string;
  htmlBody: string;
  isAd: boolean;
}): Promise<EmailSpamRiskResult> {
  const text = await callAIWithFallback({
    system: `당신은 한국어 이메일 도달률 진단 전문가입니다. 제목과 본문을 보고 스팸함으로 분류될 위험을 진단합니다.
판단 기준: 과장·절박 표현 남발, 전부 대문자/특수문자 반복, 낚시성 제목, 본문 대비 링크 과다, 수신자 신뢰를 깨는 표현.
반드시 아래 JSON 스키마로만 출력합니다 (코드블록/설명 금지):
{ "risk_level": "low|medium|high", "reasons": ["근거 1", "..."], "suggestions": ["수정 제안 1", "..."] }
- reasons/suggestions 각 1~3건, 한국어, 실제 본문 표현을 인용해 구체적으로.`,
    userMessage: `[캠페인 성격] ${input.isAd ? '광고성' : '정보성'}\n[제목]\n${input.subject}\n\n[HTML 본문]\n${input.htmlBody.slice(0, 6000)}\n\n스팸 위험을 JSON으로 진단하세요.`,
    maxTokens: 1200,
    temperature: 0.2,
    model: 'opus',
    companyId: input.companyId,
    userId: input.userId,
    source: 'email-precheck',
    creditCost: 0,
  });

  const parsed = extractJsonFromAiText<{ risk_level?: string; reasons?: string[]; suggestions?: string[] }>(text);
  const riskLevel = (['low', 'medium', 'high'].includes(String(parsed.risk_level)) ? parsed.risk_level : 'medium') as EmailSpamRiskResult['riskLevel'];
  return {
    riskLevel,
    reasons: (parsed.reasons || []).map((r) => String(r)).slice(0, 3),
    suggestions: (parsed.suggestions || []).map((s) => String(s)).slice(0, 3),
  };
}

export async function buildPerformanceInsight(input: {
  companyId: string;
  userId?: string;
  campaignName: string;
  stats: {
    sentCount: number;
    uniqueOpeners: number;
    uniqueClickers: number;
    bounceCount: number;
    unsubscribeCount: number;
    openRatePct: number | null;
    clickRatePct: number | null;
    topOpenHours: Array<{ hour: number; cnt: number; pct: number }>;
  };
}): Promise<EmailInsightResult> {
  const text = await callAIWithFallback({
    system: `당신은 한국어 이메일 마케팅 성과 분석가입니다. 실측 수치만 근거로 진단합니다.
[절대 금지] 실측에 없는 수치 추정/창작, 업계 평균 단정, 모델명·시스템명 노출.
반드시 아래 JSON 스키마로만 출력합니다 (코드블록/설명 금지):
{ "top_insight": "가장 중요한 발견 1~2문장", "suggestions": [{ "title": "제안 제목", "description": "구체 실행 방법 1~2문장" }] }
- suggestions 1~3건. 다음 캠페인에서 실행 가능한 것만.`,
    userMessage: `[캠페인] ${input.campaignName}\n[실측]\n- 발송 성공: ${input.stats.sentCount}건\n- 고유 오픈: ${input.stats.uniqueOpeners}명${input.stats.openRatePct != null ? ` (오픈율 ${input.stats.openRatePct}%)` : ''}\n- 고유 클릭: ${input.stats.uniqueClickers}명${input.stats.clickRatePct != null ? ` (클릭율 ${input.stats.clickRatePct}%)` : ''}\n- 반송(bounce): ${input.stats.bounceCount}건\n- 수신거부: ${input.stats.unsubscribeCount}건\n- 오픈 상위 시간대(KST): ${input.stats.topOpenHours.length > 0 ? input.stats.topOpenHours.map((h) => `${h.hour}시 ${h.cnt}건(${h.pct}%)`).join(', ') : '표본 없음'}\n\n실측만 근거로 JSON 진단을 출력하세요.`,
    maxTokens: 1500,
    temperature: 0.3,
    model: 'opus',
    companyId: input.companyId,
    userId: input.userId,
    source: 'email-performance-insight',
    creditCost: 0,
  });

  const parsed = extractJsonFromAiText<{ top_insight?: string; suggestions?: Array<{ title?: string; description?: string }> }>(text);
  const topInsight = aiStr(parsed.top_insight).trim();
  if (!topInsight) throw new UserFacingError(502, 'AI_RESULT_EMPTY', 'AI 진단 결과가 비어 있습니다. 다시 시도해주세요.');
  return {
    topInsight,
    suggestions: (parsed.suggestions || [])
      .map((s) => ({ title: String(s?.title || '').trim(), description: String(s?.description || '').trim() }))
      .filter((s) => s.title)
      .slice(0, 3),
  };
}

/**
 * 계정 전체(최근 N일) 성과 종합 진단 — 분석 대시보드 "AI 진단 받기".
 * 집계 실측만 근거. 임의 혜택·추정 금지(buildPerformanceInsight와 동일 원칙).
 */
export async function buildEmailAccountInsight(input: {
  companyId: string;
  userId?: string;
  days: number;
  stats: {
    campaignCount: number;
    sentCount: number;
    openRatePct: number;
    clickRatePct: number;
    bounceRatePct: number;
    unsubRatePct: number;
    prevOpenRatePct: number | null;
    prevClickRatePct: number | null;
    best: { name: string; openRatePct: number } | null;
    worst: { name: string; openRatePct: number } | null;
  };
}): Promise<EmailInsightResult> {
  const s = input.stats;
  const text = await callAIWithFallback({
    system: `당신은 한국어 이메일 마케팅 성과 분석가입니다. 회사 계정 전체의 실측 수치만 근거로 진단합니다.
[절대 금지] 실측에 없는 수치 추정/창작, 업계 평균 단정, 모델명·시스템명 노출, 구체 혜택(%/원/쿠폰) 임의 생성.
반드시 아래 JSON 스키마로만 출력합니다 (코드블록/설명 금지):
{ "top_insight": "가장 중요한 발견 1~2문장", "suggestions": [{ "title": "제안 제목", "description": "구체 실행 방법 1~2문장" }] }
- suggestions 1~3건. 다음 캠페인에서 실행 가능한 것만.`,
    userMessage: `[기간] 최근 ${input.days}일\n[실측 집계]\n- 캠페인 수: ${s.campaignCount}건\n- 총 발송: ${s.sentCount}건\n- 오픈율: ${s.openRatePct}%${s.prevOpenRatePct != null ? ` (이전 동기간 ${s.prevOpenRatePct}%)` : ''}\n- 클릭율: ${s.clickRatePct}%${s.prevClickRatePct != null ? ` (이전 동기간 ${s.prevClickRatePct}%)` : ''}\n- 반송율: ${s.bounceRatePct}%\n- 수신거부율: ${s.unsubRatePct}%\n- 성과 상위: ${s.best ? `${s.best.name} (오픈율 ${s.best.openRatePct}%)` : '표본 없음'}\n- 성과 하위: ${s.worst ? `${s.worst.name} (오픈율 ${s.worst.openRatePct}%)` : '표본 없음'}\n\n실측만 근거로 JSON 진단을 출력하세요.`,
    maxTokens: 1500,
    temperature: 0.3,
    model: 'opus',
    companyId: input.companyId,
    userId: input.userId,
    source: 'email-performance-insight',
    creditCost: 0,
  });

  const parsed = extractJsonFromAiText<{ top_insight?: string; suggestions?: Array<{ title?: string; description?: string }> }>(text);
  const topInsight = aiStr(parsed.top_insight).trim();
  if (!topInsight) throw new UserFacingError(502, 'AI_RESULT_EMPTY', 'AI 진단 결과가 비어 있습니다. 다시 시도해주세요.');
  return {
    topInsight,
    suggestions: (parsed.suggestions || [])
      .map((s2) => ({ title: String(s2?.title || '').trim(), description: String(s2?.description || '').trim() }))
      .filter((s2) => s2.title)
      .slice(0, 3),
  };
}
