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
    /**
     * ★ 0906(3) Harold 스토리라인 — 1) 홈페이지만 읽고 자동으로 이만큼(기술력) 2) 자사몰 연동·이미지 몇 장이면 훨씬 위 3) 5분이면 브로마이드급(features).
     * 사실만 · 로드맵 0 · 모델명 0. 캡처 갤러리 문구는 이미지 렌더러가 title 과 caption 을 그린다.
     */
    story: {
      auto: { tag: string; headline: string; body: (companyName: string) => string };
      /**
       * ★ v3 대조 2장(설계서 §8) — 왼쪽 = 담당자 홈 첫 화면 캡처(있을 때만) · 오른쪽 = 자동으로 만든 모바일 DM 첫 화면 캡처 · 포스터 카드. 전부 이미지 위 text_card(gallery 0).
       * 캡처 위에는 글자를 얹지 않는다(카드의 headline·body 가 설명).
       */
      capture: {
        title: string;
        homeHeadline: (companyName: string) => string; homeBody: string;
        dmHeadline: string; dmBody: (companyName: string) => string;
        posterHeadline: string; posterBody: string;
        /** 옛 키(갤러리 캡션) — 평문 대체본이 계속 쓴다 */
        dmCaption: string; posterCaption: string;
      };
      compare: { tag: string; headline: string; body: (companyName: string) => string; imageTitle: string; imageCaption: string };
    };
    /** ★ v3 회신 유도 1문장(마지막 카드 body 마지막 줄 · 검토 화면에서 60자까지 편집 = stage_results.reply_line) */
    reply: string;
    lead: { tag: string; headlineWithEvent: string; headlineNoEvent: string; quoteLabel: string };
    sample: { tag: string; headline: (companyName: string) => string; body: string };
    showcase: { tag: string; headline: string };
    cta: { primary: string; secondary: string };
    service: { headline: string; body: string };
    /**
     * ★ 2026-09-06(2) Harold 지시 — 제안 메일 본문에 한줄로 기능 3가지(여정 · 자동마케팅 · 이미지 스튜디오)를 실물 근거와 함께 섞어 넣는다.
     * 사실만(기능 상설 SoT 문서의 정의 · 로드맵 0 · 모델명 0). 이미지 스튜디오 headline 은 포스터가 있으면 "이 메일의 이미지가 그 결과물"이라고 가리킨다(호기심 축).
     */
    features: {
      tag: string;
      headline: (companyName: string) => string;
      body: string;
      items: Array<{ tag: string; headline: (hasPoster: boolean) => string; body: (companyName: string) => string }>;
    };
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
      headline: '귀사 홈페이지만 읽고 AI가 자동으로 만든 시안입니다',
      headlineNoImage: (c) => `${c} 홈페이지만 읽고 AI가 자동으로 만든 시안입니다`,
      subCopy: '이미지 · 문안 · 모바일 페이지 전부 사람 손 없이 만들어졌습니다(예시 · 시안)',
    },
    story: {
      auto: {
        tag: '1. 홈페이지 주소 하나로',
        headline: '사람 손 없이 여기까지 만들었습니다',
        body: (c) => `${c} 홈페이지를 AI가 읽고 대표 이미지 · 모바일 DM · 브랜드 이메일 · 문자 문안을 자동으로 만들었습니다. 아래 화면 캡처와 시안이 그 결과입니다.`,
      },
      capture: {
        title: '자동으로 만든 모바일 DM(화면 캡처)와 대표 이미지',
        homeHeadline: (c) => `${c} 홈페이지 첫 화면(읽은 원본)`,
        homeBody: 'AI가 읽은 출발점입니다. 이 화면의 배너 · 행사 · 상품 정보만으로 아래 시안을 만들었습니다.',
        dmHeadline: '자동으로 만든 모바일 DM 첫 화면',
        dmBody: (c) => `${c} 홈페이지의 행사와 상품을 그대로 옮긴 모바일 DM 시안입니다. 아래 버튼으로 실제 페이지가 열립니다.`,
        posterHeadline: '대표 이미지 · 이미지 스튜디오 자동 제작',
        posterBody: '홈페이지 상품 사진 한 장으로 배경을 걷어내고 연출 템플릿에 얹어 만든 이미지입니다.',
        dmCaption: '모바일 DM 시안 · 누르면 실제 페이지가 열립니다',
        posterCaption: '대표 이미지 · 이미지 스튜디오 자동 제작',
      },
      compare: {
        tag: '2. 자사몰 연동과 이미지 몇 장이면',
        headline: '지금 보신 것은 시작점입니다',
        body: (c) => `홈페이지만 읽어 만든 결과가 이 정도입니다. ${c} 자사몰을 연동하고 행사 이미지 몇 장만 올리면 상품 · 가격 · 행사를 그대로 읽어 훨씬 뛰어난 품질의 DM과 이메일이 자동으로 나옵니다.`,
        imageTitle: '이미지 스튜디오 실제 산출물 예시',
        imageCaption: '한줄로 이미지 스튜디오가 만든 실제 결과물입니다(예시)',
      },
    },
    reply: '이 메일에 행사 이미지 2장과 자사몰 주소만 회신해 주시면 시안 3벌을 더 만들어 보내드립니다.',
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
    features: {
      tag: '3. 5분만 투자하면 브로마이드급',
      headline: (c) => `${c} 담당자님이 5분으로 바꿀 수 있는 세 가지`,
      body: '지금 보신 자동 시안 위에 세 가지만 더하면 결과물이 달라집니다.',
      items: [
        {
          tag: '이미지 스튜디오',
          headline: (hasPoster) => (hasPoster ? '이 메일 맨 위 이미지도 그렇게 만들었습니다' : '상품 사진 한 장으로 포스터가 나옵니다'),
          body: (c) => `${c} 상품 사진을 올리면 배경을 자동으로 걷어내고(누끼) 300여 종 연출 템플릿 중 골라 포스터와 배너를 바로 산출물로 씁니다. 문구는 담당자님이 쓴 그대로만 들어가 지어낸 혜택이 실릴 일이 없습니다.`,
        },
        {
          tag: '문안과 여정',
          headline: () => '귀사 문자를 학습해 귀사 목소리로 씁니다',
          body: (c) => `${c} 대표 문안을 학습한 AI가 그 어투로 문자 · 모바일 DM · 이메일 문안을 쓰고, 첫 구매 · 재구매 · 오랜 미방문 같은 고객의 순간을 출발점으로 여정을 설계합니다. 조건과 대기 시간은 말로 설명하면 됩니다.`,
        },
        {
          tag: '자동마케팅',
          headline: () => '매달 생일자 같은 반복 마케팅은 자동으로',
          body: (c) => `이달 생일 고객, 등급이 오른 고객, 발길이 끊긴 고객처럼 회차마다 달라지는 대상을 AI가 골라 ${c} 소식에 맞춘 캠페인을 제안하고, 담당자님이 확인하면 발송까지 이어집니다.`,
        },
      ],
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
