// ============================================================
// crm-agency-proposal-core.ts — CRM 캠페인 대행 제안서 순수 코어 (DB import 0 — vitest 대상)
// ============================================================
// 스펙: docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md
// 프롬프트 빌더 + AI 응답 정규화/출구 가드. DB·AI 호출은 crm-agency-proposal.ts(오케스트레이션)가 담당.
// ★ 출구 가드 원칙 (Harold 2026-07-06): AI 지시는 확률적으로 뚫린다 — 보장은 코드가 한다.
import { detectLiquidSyntax, flattenLiquidToPlainText } from './liquid-templating';
import type { AgencyRequestParsed } from './crm-agency-request';

export type AgencyChannel = 'sms' | 'lms' | 'mms' | 'alimtalk' | 'dm' | 'email' | 'inapp' | 'journey';

export interface AgencyPlan {
  title: string;
  objective: string;
  channel: AgencyChannel;
  /** 명확한 규칙 서술(등급·최근구매·포인트·가입시점·구매횟수) — recommendTarget 입력 */
  targetDescription: string;
  /** recommendTarget 산출 필터 (오케스트레이션 단계에서 채움) */
  targetFilters: Record<string, unknown> | null;
  /** ★ DB 실측 COUNT (AI 추정 금지) — 오케스트레이션 단계에서 채움 */
  targetCount: number | null;
  timing: string;
  draftCopy: string;
  /** 문자 채널만 targetCount×단가, 그 외 null("실행 시 산정") */
  estimatedCost: number | null;
  expectedNote: string;
}

export interface AgencyProposalResult {
  companyName: string;
  situation: string[];
  eventSummary: string;
  plans: AgencyPlan[];
  /** 참고 인사이트 — 발송 대상 선정에 사용하지 않음(표기 전용) */
  insights: string[];
  risks: string[];
  /** insufficient_data 등 정직 표기 */
  dataNotes: string[];
  /** 행사 이미지 판독(전사) 결과 — 오케스트레이션이 채움(이미지 없으면 undefined). PDF·요약 표기용 */
  imageTranscript?: string;
}

const CHANNEL_WHITELIST: AgencyChannel[] = ['sms', 'lms', 'mms', 'alimtalk', 'dm', 'email', 'inapp', 'journey'];
// 한국어 채널명 → 코드 (양식 희망 채널·AI 출력 관용 표기 흡수). '문자'는 본문 길이 미정이라 lms로 정규화.
const CHANNEL_KO_MAP: Record<string, AgencyChannel> = {
  '문자': 'lms', 'sms': 'sms', 'lms': 'lms', 'mms': 'mms',
  '알림톡': 'alimtalk', '카카오': 'alimtalk', 'dm': 'dm', '모바일dm': 'dm',
  '이메일': 'email', 'email': 'email', '인앱': 'inapp', '여정': 'journey',
};

export function normalizeAgencyChannel(raw: any): AgencyChannel {
  const s = String(raw ?? '').trim().toLowerCase();
  if (CHANNEL_WHITELIST.includes(s as AgencyChannel)) return s as AgencyChannel;
  return CHANNEL_KO_MAP[s] || 'lms';
}

// 구체 혜택 패턴 — 요청서 benefit·상품 가격에 없는 수치 혜택이 문안에 등장하면 그 줄을 제거(출구 가드)
const BENEFIT_PATTERN = /(\d[\d,.]*\s*%|\d[\d,.]*\s*만?\s*원|무료|쿠폰|사은품|적립|증정)/g;

function collectAllowedBenefitText(request: AgencyRequestParsed, extraAllowedText?: string): string {
  const productNums = request.products
    .flatMap((p) => [p.price, p.salePrice])
    .filter((n): n is number => n != null)
    .map((n) => String(n));
  // extraAllowedText = 행사 이미지 판독(전사) — 고객사가 제출한 이미지의 실측 내용이므로 혜택 허용 텍스트에 포함
  return [request.benefit, request.description, extraAllowedText || '', ...productNums].join(' ');
}

/** 숫자 혜택 토큰의 단위 분류 — %와 원을 구분해 "5만원 → 5%" 같은 단위 스왑 통과를 차단(Codex 2차 리뷰 정정). */
function classifyBenefitToken(m: string): { digits: string; unit: 'percent' | 'won' | 'text' } {
  const compact = m.replace(/[\s,]/g, '');
  const digits = compact.replace(/[^\d]/g, '');
  if (!digits) return { digits: '', unit: 'text' };
  return { digits, unit: compact.includes('%') ? 'percent' : 'won' };
}

/** 문안 출구 가드 — 허용 텍스트에 근거 없는 구체 혜택이 든 줄 제거. 제거 발생 시 사유 반환.
 *  숫자 혜택은 단위(%/원)까지 일치해야 허용. 단위 없는 허용 수치(상품 가격 등)는 원 단위 표현만 허용.
 *  비숫자(무료·쿠폰)는 문자열 포함으로 비교. */
export function guardDraftCopyBenefits(
  draft: string, request: AgencyRequestParsed, extraAllowedText?: string,
): { copy: string; removed: boolean } {
  const allowedRaw = collectAllowedBenefitText(request, extraAllowedText);
  const allowed = allowedRaw.replace(/[\s,]/g, '');
  // 허용 텍스트의 단위 붙은 토큰(10%·5만원)은 단위별 세트로, 단위 없는 맨 숫자(상품 가격)는 plain 세트로.
  const percentSet = new Set<string>();
  const wonSet = new Set<string>();
  const unitTokens = allowedRaw.match(BENEFIT_PATTERN) || [];
  let bareText = allowedRaw;
  for (const t of unitTokens) {
    const { digits, unit } = classifyBenefitToken(t);
    if (!digits) continue;
    if (unit === 'percent') percentSet.add(digits);
    else wonSet.add(digits);
    bareText = bareText.replace(t, ' ');
  }
  const plainSet = new Set((bareText.match(/\d[\d,.]*/g) || []).map((d) => d.replace(/[^\d]/g, '')));

  let removed = false;
  const lines = String(draft || '').split('\n').filter((line) => {
    const matches = line.match(BENEFIT_PATTERN);
    if (!matches) return true;
    const ok = matches.every((m) => {
      const compact = m.replace(/[\s,]/g, '');
      const { digits, unit } = classifyBenefitToken(m);
      if (!digits) return allowed.includes(compact);                          // 무료/쿠폰/사은품 등
      if (unit === 'percent') return percentSet.has(digits) || allowed.includes(compact);
      return wonSet.has(digits) || plainSet.has(digits) || allowed.includes(compact);  // 원 단위
    });
    if (!ok) removed = true;
    return ok;
  });
  return { copy: lines.join('\n').trim(), removed };
}

/** AI 응답(JSON parse 결과) → 검증된 결과. plans 0건이면 throw(직원 재실행 흐름 — 위장 성공 금지).
 *  extraAllowedText = 행사 이미지 전사(혜택 출구가드 허용 텍스트에 포함). */
export function normalizeProposal(
  raw: any, companyName: string, request: AgencyRequestParsed, extraAllowedText?: string,
): AgencyProposalResult {
  const arr = (v: any): string[] => Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
  const rawPlans: any[] = Array.isArray(raw?.plans) ? raw.plans : [];
  const dataNotes: string[] = [];
  const risks = arr(raw?.risks);

  const plans: AgencyPlan[] = rawPlans.slice(0, 5).map((p) => {
    let draft = String(p?.draftCopy ?? '').trim();
    if (detectLiquidSyntax(draft)) draft = flattenLiquidToPlainText(draft);
    const guarded = guardDraftCopyBenefits(draft, request, extraAllowedText);
    if (guarded.removed) {
      risks.push(`'${String(p?.title ?? '플랜')}' 문안에서 요청서에 없는 혜택 표현을 제거했습니다 — 발송 전 혜택 확인 필요.`);
    }
    return {
      title: String(p?.title ?? '').trim() || '캠페인 플랜',
      objective: String(p?.objective ?? '').trim(),
      channel: normalizeAgencyChannel(p?.channel),
      targetDescription: String(p?.targetDescription ?? '').trim(),
      targetFilters: null,
      targetCount: null,
      timing: String(p?.timing ?? '').trim(),
      draftCopy: guarded.copy,
      estimatedCost: null,
      expectedNote: String(p?.expectedNote ?? '').trim(),
    };
  }).filter((p) => p.objective || p.draftCopy);

  if (plans.length === 0) {
    throw new Error('AI가 유효한 캠페인 플랜을 생성하지 못했습니다. 다시 실행해 주세요.');
  }

  return {
    companyName,
    situation: arr(raw?.situation),
    eventSummary: String(raw?.eventSummary ?? '').trim(),
    plans,
    insights: arr(raw?.insights),
    risks,
    dataNotes,
  };
}

// ── 프롬프트 빌더 ──────────────────────────────────────────

/** 접수 폼 자동 입력용 — 행사 이미지를 구조화 JSON으로 전사(보이는 것만·추정 금지). 2026-07-09 Harold 승인. */
export function buildAgencyIntakeSystemPrompt(): string {
  return `당신은 행사/프로모션 이미지를 읽어 캠페인 대행 요청서 항목을 채우는 전사 담당입니다.

[반드시 이미지에 실제로 보이는 것만 — 절대 규칙]
1. 이미지에 없는 행사명·날짜·가격·할인율·혜택·상품을 지어내지 마세요. 안 보이면 빈 값("")으로 두세요.
2. 광고 문구를 새로 창작하지 마세요 — 당신은 "옮겨 적기"만 합니다.
3. 노이즈 제외: 리뷰 수·별점, 단위당 환산가격, 대괄호 채널/기획 태그, 섹션 헤드라인, 이모지.
4. 날짜는 이미지에 명시된 경우만 YYYY-MM-DD 형식으로. 연도가 안 보이면 빈 값(추정 금지).
5. benefit에는 이미지에 보이는 혜택(할인·쿠폰·사은품 등)만 적으세요.
6. 여러 장의 이미지는 하나의 행사로 보고 합쳐서 정리하세요.

[출력 — JSON만, 다른 텍스트 금지]
{
  "title": "행사명(배너에 크게 보이는 것, 없으면 빈 값)",
  "periodStart": "YYYY-MM-DD 또는 빈 값",
  "periodEnd": "YYYY-MM-DD 또는 빈 값",
  "description": "행사 내용 정리 — 보이는 상품은 '상품명 / 정가 / 할인가' 한 줄씩 포함",
  "benefit": "이미지에 보이는 혜택만, 없으면 빈 값",
  "products": [{ "name": "상품명", "price": 정가 숫자 또는 null, "salePrice": 할인가 숫자 또는 null }]
}`;
}

export function buildAgencySystemPrompt(): string {
  return `당신은 한줄로(CRM 마케팅 SaaS)의 시니어 CRM 컨설턴트입니다. 제공된 "실측 데이터"만 근거로, 요청 행사에 맞는 캠페인 플랜 제안서를 JSON으로 작성합니다.

[절대 규칙]
1. 혜택: "요청 혜택" 텍스트와 "행사 이미지 판독" 내용에 실제로 있는 것만 사용. 거기 없는 할인율·금액·무료·쿠폰·사은품을 새로 만들지 마세요.
2. 타겟(targetDescription): 명확한 규칙 한 문장(고객 등급/최근 구매일/보유 포인트/가입 시점/구매 횟수 기준만). 확률·예측·성향 표현 금지.
3. 개인화 변수: 퍼센트 기호로 감싼 형태만 사용(예: %고객명%, %등급%, %포인트%). 중괄호 기반 템플릿 문법은 절대 사용하지 마세요.
4. channel 값: sms | lms | mms | alimtalk | dm | email | inapp | journey 중 하나.
5. 플랜 수: 2~4개. 서로 타겟 또는 채널이 달라야 합니다.
6. 대상 인원수를 직접 추정하지 마세요(시스템이 DB에서 실측합니다).
7. 데이터에 근거 없는 주장 금지 — 근거 부족하면 그 축은 언급하지 마세요.

[출력 — JSON만, 다른 텍스트 금지]
{
  "situation": ["기업 현황 요약 문장(실데이터 근거) 3~6개"],
  "eventSummary": "요청 행사 정리 한 단락",
  "plans": [{
    "title": "플랜명", "objective": "이 플랜의 목표 한 문장",
    "channel": "lms", "targetDescription": "명확한 규칙 한 문장",
    "timing": "발송 시점 제안(행사 기간 기준)", "draftCopy": "발송 문안 초안(개행 포함)",
    "expectedNote": "기대 효과 서술(수치 예측 금지, 근거 서술만)"
  }],
  "insights": ["참고 인사이트(타겟 선정에 쓰지 않는 관찰) 0~5개"],
  "risks": ["리스크·주의점 0~5개"]
}`;
}

export function buildAgencyUserMessage(input: {
  companyName: string;
  businessType: string;
  brandName: string;
  brandTone: string;
  profileBlock: string;                       // formatProfileForAiPrompt(..., {variableStyle:'percent'})
  memoryLines: string[];                      // "type · key: value (중요도 N)"
  campaignLines: string[];                    // "YYYY-MM-DD · 이름 · 유형 · 대상 N · 성공 N"
  request: AgencyRequestParsed;
  /** 행사 이미지 판독(전사) — 고객사 업로드 이미지의 실측 내용 (없으면 생략) */
  imageTranscript?: string;
}): string {
  const r = input.request;
  const products = r.products.length
    ? r.products.map((p) => `- ${p.name}${p.price ? ` 정가 ${p.price}원` : ''}${p.salePrice ? ` → 할인 ${p.salePrice}원` : ''}`).join('\n')
    : '(없음)';
  const transcriptBlock = input.imageTranscript
    ? `\n## 행사 이미지 판독 (고객사가 올린 행사 이미지에 실제로 보이는 내용 — 실측 전사)\n${input.imageTranscript}\n`
    : '';
  return `## 회사
- 회사명: ${input.companyName} / 업종: ${input.businessType || '미상'} / 브랜드: ${input.brandName || '-'} / 톤: ${input.brandTone || '-'}

## 회사 실측 데이터 프로필
${input.profileBlock}

## AI 학습 메모리 (이 회사에서 축적된 검증 지식)
${input.memoryLines.length ? input.memoryLines.join('\n') : '(아직 없음)'}

## 최근 캠페인 이력 (실측)
${input.campaignLines.length ? input.campaignLines.join('\n') : '(아직 없음)'}

## 캠페인 대행 요청서
- 행사명: ${r.title}
- 기간: ${r.periodStart} ~ ${r.periodEnd}
- 행사 내용: ${r.description}
- 요청 혜택(이것만 사용): ${r.benefit}
- 희망 채널: ${r.channels.length ? r.channels.join(', ') : '(미지정 — 데이터 기반 추천)'}
- 예산: ${r.budget ? `${r.budget}원` : '(미지정)'}
- 대상 상품:
${products}
- 참고사항: ${r.note || '(없음)'}
${transcriptBlock}
위 실측 데이터에 근거해 이 행사에 맞는 캠페인 플랜 제안서 JSON을 작성하세요.`;
}
