/**
 * ★ CT: 사업자등록증 이미지 판독 → 사업자 정보 자동입력 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md (Harold 지시 — 그룹웨어 동일 기능).
 * 슈퍼관리자 정산 탭의 [계산서 사업자 등록] 모달에서 사업자등록증 사진/스캔을 올리면
 * 상호·사업자번호·대표자·주소·업태·종목을 읽어 입력칸에 채운다.
 *
 * 원칙:
 *  - vision 호출 패턴은 `event-image-extract.ts`를 미러(검증된 자산 재사용 — no_inline_duplication).
 *  - **creditCost 0** — 슈퍼관리자 내부 운영 기능이라 고객사 크레딧을 차감하지 않는다
 *    (services/ai.ts: creditCost 0이면 체크·차감 모두 없음 실측 확인).
 *  - 자동입력 결과는 화면 입력칸에 채워질 뿐 저장은 사람이 [저장]으로 확정한다 — 오판독은 눈으로 걸러진다.
 *  - 이미지에 없는 값은 빈 문자열(추정 금지 — AI 혜택 날조 금지 계열과 같은 원칙).
 */

import { callAIWithFallback } from '../services/ai';
import { ALLOWED_IMAGE_MEDIA_TYPES, type EventImageInput } from './event-image-extract';

export interface BizRegistrationInfo {
  biz_number: string;    // 000-00-00000
  company_name: string;  // 상호(법인명)
  ceo_name: string;      // 대표자
  address: string;       // 사업장 소재지
  biz_type: string;      // 업태 (여러 개면 쉼표)
  biz_item: string;      // 종목 (여러 개면 쉼표)
}

const SYSTEM_PROMPT = `당신은 한국 사업자등록증 이미지를 읽어 기재 정보를 "그대로 옮겨 적는" 전사 담당입니다.

[출력 — 반드시 아래 JSON 형식만. 다른 텍스트·코드펜스·설명 금지]
{"biz_number":"","company_name":"","ceo_name":"","address":"","biz_type":"","biz_item":""}

[규칙]
- 이미지에 실제로 보이는 값만 적습니다. 안 보이거나 흐린 항목은 빈 문자열로 둡니다(추정 금지).
- biz_number(등록번호)는 숫자 10자리를 000-00-00000 형식으로 적습니다.
- company_name = 상호(법인명). 법인이면 "(주)" 같은 표기도 보이는 그대로.
- ceo_name = 대표자(성명). 공동대표면 쉼표로 나열.
- address = 사업장 소재지 전체 주소.
- biz_type = 업태, biz_item = 종목. 여러 개가 나열돼 있으면 각각 쉼표로 연결합니다.
- 사업자등록증이 아닌 이미지면 모든 값을 빈 문자열로 둡니다.`;

const clean = (v: any, max: number) => String(v ?? '').trim().slice(0, max);

/** 방어 파싱 — 형식 위반 시 null(호출측이 사용자 안내). */
function parseInfo(raw: string): BizRegistrationInfo | null {
  try {
    let t = String(raw ?? '').trim();
    const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
    if (fence) t = fence[1].trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    const obj = JSON.parse(t.slice(s, e + 1));
    const info: BizRegistrationInfo = {
      biz_number: clean(obj?.biz_number, 20),
      company_name: clean(obj?.company_name, 100),
      ceo_name: clean(obj?.ceo_name, 50),
      address: clean(obj?.address, 300),
      biz_type: clean(obj?.biz_type, 100),
      biz_item: clean(obj?.biz_item, 100),
    };
    // 사업자번호 표기 정규화 — 숫자 10자리면 000-00-00000로
    const digits = info.biz_number.replace(/\D/g, '');
    if (digits.length === 10) info.biz_number = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    const hasAny = Object.values(info).some((v) => v.length > 0);
    return hasAny ? info : null;
  } catch {
    return null;
  }
}

// ★ 2026-07-30 PDF 허용(서수란 접수 — 고객사 보관 파일 90%가 PDF). 이 CT에서만 넓힌다 —
//   공유 상수(ALLOWED_IMAGE_MEDIA_TYPES)를 넓히면 행사 이미지 판독 등 다른 소비처까지 열린다.
//   PDF는 services/ai.ts가 document 블록으로 보낸다(기본 모델 전용 — 폴백 모델은 PDF 미지원이라
//   기본 모델 장애 중에는 명확한 판독 실패로 떨어진다. 그때는 이미지로 재시도 안내).
const BIZREG_MEDIA_TYPES = new Set([...ALLOWED_IMAGE_MEDIA_TYPES, 'application/pdf']);

/** 사업자등록증 이미지/PDF 1장 → 기재 정보. 판독 불가 시 throw(호출측이 사용자 안내). */
export async function extractBizRegistration(params: {
  image: EventImageInput;
  adminId?: string | null;
}): Promise<BizRegistrationInfo> {
  const { image } = params;
  if (!image || typeof image.data !== 'string' || image.data.length === 0 || !BIZREG_MEDIA_TYPES.has(image.media_type)) {
    throw new Error('판독할 파일이 없습니다. jpg/png/webp 이미지 또는 PDF를 올려주세요.');
  }

  const raw = await callAIWithFallback({
    system: SYSTEM_PROMPT,
    userMessage: '이 사업자등록증 이미지에 실제로 보이는 기재 정보만 규칙대로 JSON으로 옮겨 적어줘. 안 보이는 값은 빈 문자열로 두고 지어내지 마.',
    maxTokens: 800,
    temperature: 0,
    source: 'biz-registration-extract',
    creditCost: 0, // 슈퍼관리자 내부 기능 — 고객사 크레딧 미차감
    userId: params.adminId || undefined,
    images: [image],
  });

  const info = parseInfo(raw);
  if (!info) {
    throw new Error('사업자등록증에서 정보를 읽지 못했습니다. 글자가 잘 보이는 이미지로 다시 시도해주세요.');
  }
  return info;
}
