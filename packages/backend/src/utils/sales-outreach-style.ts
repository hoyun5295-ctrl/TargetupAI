/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 스타일 가이드 SSOT (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6)
 *
 * - 구조화 상수 1파일 export. 소비처는 getActiveStyleGuide() 하나만 본다.
 *   프롬프트 문자열 여기저기에 규칙을 흩지 않는다.
 * - ★2026-09-03 실물 참조(섹션 골격)는 참조 골격 CT가 맡는다(best-copy-assets getStructureSkeleton · sales-outreach-produce pickOutreachStructure).
 * - ★2026-09-05 v1: 샘플 예시(few-shot) 층이 붙었다(sales-outreach-exemplars.ts · 직원 실물 DM 10건·이메일 9건 마스킹본).
 *   이 파일은 문안 규칙 층 + 제안 메일 문구(emailCopy)를 소유한다. `sampleTrained=true`의 뜻 = 예시 층이 생성 프롬프트에 실린다.
 * - 테이블 승격 조건(하나라도 생기면 sales_outreach_style_guides 신설로 이관):
 *   ①샘플 세트 2개 이상 ②Harold가 화면에서 가이드 편집을 요구 ③버전 롤백 필요.
 */

export interface OutreachStyleGuide {
  version: string;
  /** 샘플 예시 층이 프롬프트에 실리는가 */
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
  /**
   * ★2026-09-05 제안 메일 문구 층(A-2) : 조립 함수(buildProposalEmailSections)는 한글 리터럴을 갖지 않고 여기만 읽는다.
   * 업체명이 들어가는 문구는 함수 : 업체명 바로 뒤에 조사(을·를·이·가·은·는·과·와)를 붙이지 않는다(외래어·영문 업체명에서 조사가 틀린다).
   */
  emailCopy: {
    senderBrandName: string;
    subjectDefault: (companyName: string) => string;
    preheader: (companyName: string) => string;
    introDefault: (companyName: string) => string;
    hero: { headline: string; headlineNoImage: (companyName: string) => string; subCopy: string };
    lead: { tag: string; headlineWithEvent: string; headlineNoEvent: string; quoteLabel: string };
    sample: { tag: string; headline: (companyName: string) => string; body: string };
    showcase: { tag: string; headline: string };
    cta: { primary: string; secondary: string };
    service: { headline: string; body: string };
    footer: { notes: string[]; basisLine: (kstDate: string) => string; legal: string };
    /** 검수 테스트 발송 제목 접두 */
    testSubjectPrefix: string;
  };
}

const STYLE_GUIDE_V1: OutreachStyleGuide = {
  version: 'v1-exemplar',
  sampleTrained: true,
  copy: {
    structure: [
      '브랜드명과 진행 중 행사를 첫 문장에서 언급',
      '행사 핵심 1가지를 구체적으로(검증된 인용 근거 안에서만)',
      '홈페이지에서 읽은 상품·행사 사실을 1~2개 이어 붙인다(수치는 원문 그대로 있는 것만)',
      '모바일 DM 링크로 마무리',
    ],
    tone: '밝고 간결한 마케팅 문안. 과장·강요 없이 정보 중심. 존댓말.',
    maxLength: 350,
  },
  email: {
    structure: [
      '맞춤 서두: 그 업체 사이트에서 본 것 1~2가지 언급',
      '한줄로AI로 귀사 브랜드 예시를 만들어 봤다는 소개',
      '산출물 쇼케이스(이미지·브랜드 이메일 시안·문안 예시·확인 링크)',
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
  emailCopy: {
    senderBrandName: '한줄로',
    subjectDefault: (c) => `${c} 맞춤 마케팅 시안이 도착했습니다`,
    preheader: (c) => `${c} 맞춤 시안 · 한줄로AI 제작 예시`,
    introDefault: (c) => `${c} 홈페이지를 살펴보고, 한줄로AI로 귀사 브랜드에 맞춘 마케팅 예시를 만들어 보았습니다. 아래에서 실물 그대로 확인하실 수 있습니다.`,
    hero: {
      headline: '귀사 브랜드로 만든 마케팅 시안',
      headlineNoImage: (c) => `${c} 맞춤 마케팅 시안`,
      subCopy: '한줄로AI가 만든 예시(시안)입니다',
    },
    lead: {
      tag: '귀사 홈페이지에서 확인했습니다',
      headlineWithEvent: '지금 진행 중인 소식에 맞춰 만들었습니다',
      headlineNoEvent: '귀사 브랜드에 맞춰 만들었습니다',
      quoteLabel: '홈페이지에서 본 내용',
    },
    sample: {
      tag: '브랜드 이메일 시안',
      headline: (c) => `${c} 이름으로 나가는 이메일은 이런 모습입니다`,
      body: '아래는 귀사 홈페이지의 상품·이미지·문구만으로 한줄로AI가 구성한 이메일 시안입니다. 실제 발송 전에는 담당자님이 자유롭게 고칠 수 있습니다.',
    },
    showcase: { tag: 'AI 문안 예시', headline: '이런 문안으로 보낼 수 있습니다' },
    cta: { primary: '산출물 보기', secondary: 'DM 열어보기' },
    service: {
      headline: '한줄로는 이렇게 도와드립니다',
      body: '한줄로는 문자·이메일·모바일 DM·인앱 메시지를 AI가 만들어 보내는 마케팅 자동화 서비스입니다. 이 안내의 이미지·문안·모바일 페이지 전부 한줄로AI가 귀사 홈페이지만 보고 만들었습니다.',
    },
    footer: {
      notes: [
        '본 안내의 모든 산출물은 한줄로AI로 제작된 예시(시안)입니다.',
        '귀사에 맞춤형 제안을 드리기 위하여 귀사 홈페이지의 이미지를 활용한 예시를 보여드렸습니다. 상업적 이용이 아닌 귀사 제안용으로만 사용되었음을 확약드립니다.',
      ],
      basisLine: (kstDate) => `본 안내는 ${kstDate} 기준 홈페이지 내용을 참고했습니다.`,
      legal: '(주)인비토 · 한줄로(hanjul.ai)',
    },
    testSubjectPrefix: '[검수] ',
  },
};

/** 활성 스타일 가이드 — 소비처 유일 진입점 */
export function getActiveStyleGuide(): OutreachStyleGuide {
  return STYLE_GUIDE_V1;
}
