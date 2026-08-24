/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 스타일 가이드 SSOT (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6)
 *
 * - 구조화 상수 1파일 export. 소비처는 getActiveStyleGuide() 하나만 본다.
 *   프롬프트 문자열 여기저기에 규칙을 흩지 않는다(샘플 세트가 오면 이 파일 하나만 교체).
 * - v0 = 샘플 미학습 기본형. 산출물에는 "가이드 미학습" 표시가 함께 나간다(sampleTrained=false).
 * - 테이블 승격 조건(하나라도 생기면 sales_outreach_style_guides 신설로 이관):
 *   ①샘플 세트 2개 이상 ②Harold가 화면에서 가이드 편집을 요구 ③버전 롤백 필요.
 */

export interface OutreachStyleGuide {
  version: string;
  /** 샘플 세트 학습 여부 — false면 화면·이력에 "가이드 미학습" 표시 */
  sampleTrained: boolean;
  /** 문안(SMS/LMS) 구성 규칙 */
  copy: {
    structure: string[];
    tone: string;
    maxLength: number;
  };
  /** 제안 메일 본문 구성(§8 고정 구조의 v2 판 — 전달용 완성본 1통) */
  email: {
    structure: string[];
    tone: string;
  };
  /** 전 산출물 공통 금지 규칙 — 프롬프트 조립 시 그대로 부착 */
  prohibitions: string[];
}

const STYLE_GUIDE_V0: OutreachStyleGuide = {
  version: 'v0',
  sampleTrained: false,
  copy: {
    structure: [
      '브랜드명과 진행 중 행사를 첫 문장에서 언급',
      '행사 핵심 1가지를 구체적으로(검증된 인용 근거 안에서만)',
      '모바일 DM 링크로 마무리',
    ],
    tone: '밝고 간결한 마케팅 문안. 과장·강요 없이 정보 중심.',
    maxLength: 350,
  },
  email: {
    structure: [
      '맞춤 서두: 그 업체 사이트에서 본 것 1~2가지 언급',
      '한줄로AI로 귀사 브랜드 예시를 만들어 봤다는 소개',
      '산출물 쇼케이스(이미지·문안 예시·확인 링크)',
      '한줄로 서비스 소개 1문단',
      '발신자 서명(회사·연락처)',
    ],
    tone: '정중하고 자신감 있는 제안. 판매 압박 없이 실물 중심.',
  },
  prohibitions: [
    '검증되지 않은 할인율·금액·쿠폰 등 구체 혜택 수치를 만들지 않는다',
    '존재가 확인되지 않은 행사를 언급하지 않는다',
    '모든 산출물에 예시(시안)임을 명시한다',
  ],
};

/** 활성 스타일 가이드 — 소비처 유일 진입점 */
export function getActiveStyleGuide(): OutreachStyleGuide {
  return STYLE_GUIDE_V0;
}
