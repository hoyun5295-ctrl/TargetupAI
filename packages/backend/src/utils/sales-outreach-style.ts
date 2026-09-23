/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 스타일 가이드 SSOT (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6)
 *
 * - 구조화 상수 1파일 export. 소비처는 getActiveStyleGuide() 하나만 본다.
 *   프롬프트 문자열 여기저기에 규칙을 흩지 않는다.
 * - ★2026-09-03 실물 참조(섹션 골격)는 참조 골격 CT가 맡는다(best-copy-assets getStructureSkeleton · sales-outreach-produce pickOutreachStructure).
 * - ★2026-09-05 v1: 샘플 예시(few-shot) 층이 붙었다(sales-outreach-exemplars.ts · 직원 실물 DM 10건·이메일 9건 마스킹본).
 *   이 파일은 문안 규칙 층 + 제안 메일 문구(emailCopy)를 소유한다. `sampleTrained=true`의 뜻 = 예시 층이 생성 프롬프트에 실린다.
 * - ★2026-09-23 제안 메일 재구성(docs/2026-09-23-outreach-direct-send-design.md §11 · Harold 결재) — 모바일 첫 화면 = 헤드라인 + [DM 열어보기] + 그 브랜드 시안 머리.
 *   3막 스토리(홈페이지 하나로 · 자사몰 연동 · 5분 투자)는 카드 1장 요약으로 줄였다(0906(3) 스토리 지시의 압축 · 같은 결재).
 *   'AI' 는 헤드라인 1번 + footer 고지 1번만 · 번호 태그(1. 2. 3.) 0 · 괄호 "(예시 · 시안)" 은 footer 고지로.
 * - 테이블 승격 조건(하나라도 생기면 sales_outreach_style_guides 신설로 이관):
 *   ①샘플 세트 2개 이상 ②Harold가 화면에서 가이드 편집을 요구 ③버전 롤백 필요.
 */
import { INVITO_INFO } from '../config/defaults';

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
    /** 제목·서두 생성이 실패했을 때의 기본 제목(옛 키) */
    subjectDefault: (companyName: string) => string;
    /** ★ 2026-09-23 결정 제목 — 확정 행사명이 있을 때 · 없거나 길면 generic */
    subjectEvent: (companyName: string, eventTitle: string) => string;
    subjectGeneric: (companyName: string) => string;
    preheader: (companyName: string) => string;
    introDefault: (companyName: string) => string;
    /** ★ 2026-09-23 담당자명이 있을 때만 서두 첫 줄(사람이 넣은 이름 · 제목에는 넣지 않는다) */
    greeting: (contactName: string) => string;
    /** ★ 2026-09-23 첫 화면 헤드라인(이 메일에서 'AI' 는 여기와 footer 고지 두 번뿐) */
    opener: { headline: (companyName: string) => string };
    sample: { tag: string; headline: (companyName: string) => string };
    /** ★ 2026-09-23 시안에 담은 확정 행사 요약(제목 · 기간 줄 · 원문 인용 덤프 없음) */
    events: { tag: string; headline: string };
    showcase: { tag: string; headline: string };
    /** ★ 2026-09-23 옛 2·3막(자사몰 연동 · 5분 투자 3가지)을 카드 1장으로 */
    more: { tag: string; headline: string; lines: (companyName: string) => string[] };
    /** ★ v3 회신 유도 1문장(서비스 카드 body 마지막 줄 · 검토 화면에서 60자까지 편집 = stage_results.reply_line) */
    reply: string;
    /** ★ 2026-09-15 catalog = 아웃리치 카탈로그 DM 버튼(카탈로그가 만들어진 건에만 실린다) */
    cta: { primary: string; secondary: string; catalog: string };
    service: { headline: string; body: string };
    footer: { notes: string[]; basisLine: (kstDate: string) => string; legal: string };
    /** ★ 2026-09-23 담당자 직접 발송 법정 footer 의 전송자 명칭(buildEmailAdFooter 에 넘긴다) */
    senderLegalName: string;
    /** ★ 2026-09-23 평문 대체본의 수신거부 줄(직접 발송 건) */
    plainUnsubscribe: (sender: string, url: string) => string;
    /** 검수 테스트 발송 제목 접두 */
    testSubjectPrefix: string;
    /** ★ 2026-09-23 직접 발송 때 자사 수신함으로 따로 보내는 사본 제목 접두 */
    copySubjectPrefix: string;
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
    subjectEvent: (c, e) => `${c} ${e} 모바일 DM 시안`,
    subjectGeneric: (c) => `${c} 맞춤 모바일 DM 시안`,
    preheader: (c) => `${c} 홈페이지 재료로 만든 모바일 DM · 이메일 시안`,
    introDefault: (c) => `${c} 홈페이지를 살펴보고 귀사 브랜드에 맞춘 마케팅 시안을 만들어 보았습니다. 아래 버튼을 누르면 실제 모바일 DM이 열립니다.`,
    greeting: (n) => `${n}님, 안녕하세요.`,
    opener: { headline: (c) => `${c} 홈페이지만 읽고 AI가 만든 모바일 DM 시안입니다` },
    sample: { tag: '브랜드 이메일 시안', headline: (c) => `${c} 이름으로 나가는 이메일은 이런 모습입니다` },
    events: { tag: '이번 시안에 담은 소식', headline: '홈페이지에서 확인한 진행 중 소식으로 만들었습니다' },
    showcase: { tag: '문자 문안 예시', headline: '이런 문안으로 보낼 수 있습니다' },
    more: {
      tag: '여기서 더 좋아집니다',
      headline: '지금 보신 것은 홈페이지만 읽은 결과입니다',
      lines: (c) => [
        `자사몰을 연동하고 행사 이미지 몇 장만 올리면 ${c} 상품 · 가격 · 행사를 그대로 읽어 훨씬 좋은 DM과 이메일이 나옵니다.`,
        '이미지 스튜디오: 상품 사진 한 장으로 배경을 걷어내고 포스터와 배너를 만듭니다. 문구는 담당자님이 쓴 그대로만 들어갑니다.',
        '문안과 여정: 귀사 문자를 학습해 귀사 목소리로 쓰고, 첫 구매 · 재구매 · 오랜 미방문 같은 고객의 순간을 여정으로 잇습니다.',
        '자동마케팅: 이달 생일 고객처럼 회차마다 달라지는 대상을 골라 캠페인을 제안하고, 확인하시면 발송까지 이어집니다.',
      ],
    },
    reply: '이 메일에 행사 이미지 2장과 자사몰 주소만 회신해 주시면 시안 3벌을 더 만들어 보내드립니다.',
    cta: { primary: '산출물 보기', secondary: 'DM 열어보기', catalog: '카탈로그 보기' },
    service: {
      headline: '한줄로는 이렇게 도와드립니다',
      body: '한줄로는 문자 · 이메일 · 모바일 DM · 인앱 메시지를 만들고 보내는 마케팅 자동화 서비스입니다. 이 메일의 시안은 전부 귀사 홈페이지만 보고 만들었습니다.',
    },
    footer: {
      notes: [
        '본 안내의 모든 산출물은 한줄로가 AI로 자동 제작한 예시(시안)입니다.',
        '귀사에 맞춤형 제안을 드리기 위하여 귀사 홈페이지의 이미지를 활용한 예시를 보여드렸습니다. 상업적 이용이 아닌 귀사 제안용으로만 사용되었음을 확약드립니다.',
      ],
      basisLine: (kstDate) => `본 안내는 ${kstDate} 기준 홈페이지 내용을 참고했습니다.`,
      // ★ 2026-09-23 발신자 명칭 · 주소 · 연락처(INVITO_INFO 단일 원천 · 정보통신망법 제50조 표기 축)
      legal: `(주)인비토 · 한줄로(hanjul.ai) · ${INVITO_INFO.address} · ${INVITO_INFO.phone}`,
    },
    senderLegalName: '주식회사 인비토(한줄로)',
    plainUnsubscribe: (sender, url) => `본 메일은 ${sender}의 광고 정보입니다. 수신을 원하지 않으시면: ${url}`,
    testSubjectPrefix: '[검수] ',
    copySubjectPrefix: '[사본] ',
  },
};

/** 활성 스타일 가이드 — 소비처 유일 진입점 */
export function getActiveStyleGuide(): OutreachStyleGuide {
  return STYLE_GUIDE_V1;
}
