/**
 * CT: 마케팅 진단 v3 — 문구 원장 (2026-08-16 신설 · v3 설계서 §4)
 *
 * 진단 리포트의 모든 한국어 문장이 여기 있다(관찰 틀·단계·칭찬·병목 인과·처방·고도화·각주·표지 절).
 * 조립 로직은 marketing-diagnosis-report.ts가, 문장은 이 파일이 소유한다 — 문장 수정 = 이 파일만.
 *
 * 집필 규약 (회의 수렴 — 어기면 그 문장은 반려 대상)
 *   - 문장 속 대시(—) 금지 · break-keep 전제 · 원인/결과 각 행 45자 내외.
 *   - 관찰·칭찬·아쉬움 구간에 자사명 0. 자사명은 HANJUL_FILLS(병목 킥 전용 · v6)에서만 — 개수 테스트로 고정.
 *   - 수치는 응답자가 말한 것·서버 실측만. 시간 절감 %·매출·응답률 추정 금지.
 *   - 접점 슬롯 {t} = TOUCH_WORD(주문·방문·예약 — 전부 닫힌 음절이라 을/이/과 조사 안전).
 *     슬롯이 비면 문장을 빼는 게 아니라 기본값 '방문'을 쓴다(이 슬롯은 항상 채워지는 축).
 */
import type { DiagnosisAxis } from './plan-recommend';

/** 접점(touchpoint) 답 → 어절 슬롯. 미답·미지정 = '방문'. */
export const TOUCH_WORD: Record<string, string> = {
  online: '주문',
  offline: '방문',
  both: '방문',
  booking: '예약',
  platform: '주문',
};

/** 표지 subject(퍼널 B — 회사명이 폼 뒤에나 생기므로 접점 구절로 연다. 회의론자 C3). */
export const TOUCH_SUBJECT: Record<string, string> = {
  online: '온라인 브랜드',
  offline: '매장 브랜드',
  both: '온·오프라인 브랜드',
  booking: '예약제 브랜드',
  platform: '플랫폼 기반 브랜드',
};

export const AXIS_META: Record<DiagnosisAxis, { label: string; priority: number }> = {
  list: { label: '고객 명단', priority: 0 },
  targeting: { label: '보내는 대상', priority: 1 },
  measure: { label: '성과 확인', priority: 2 },
  repeat: { label: '단골 관리', priority: 3 },
  production: { label: '콘텐츠 제작', priority: 4 },
  sending: { label: '발송 실행', priority: 5 },
};

/** 축별 판정 표의 단계 라벨(숫자 점수 비노출 — 회의 확정). */
export const LEVEL_LABELS = ['아직 없어요', '이제 시작', '자리 잡는 중', '잘하고 있어요'] as const;

/** 단계 관문 사다리 결과물 — 등급이 아니라 경로상의 위치로 쓴다. */
export const STAGES = [
  { key: 'before', label: '모으기 전', line: '오신 고객이 다시 올 수 있게, 남기는 것부터가 시작이에요.' },
  { key: 'collect', label: '모으는 중', line: '명단이 생기고 있으니, 이제 나눠서 보낼 차례예요.' },
  { key: 'divide', label: '나누는 중', line: '대상을 나누기 시작하셨으니, 반복과 측정을 붙일 차례예요.' },
  { key: 'run', label: '굴러가는 중', line: '기본기가 갖춰졌어요. 이제 다듬는 단계예요.' },
] as const;

/** 표지 강점절 — 강점 축(level 2+ 최고 축) 1개가 고른다. */
export const COVER_STRENGTH: Record<DiagnosisAxis, string> = {
  list: '명단은 갖춰 두셨는데',
  targeting: '고르는 눈은 있으신데',
  sending: '꾸준히 보내고 계신데',
  production: '만드는 손은 빠른데',
  repeat: '단골은 챙기고 계신데',
  measure: '결과는 챙겨 보시는데',
};

/**
 * 표지 약점절 — 1순위 병목의 축 × level이 고른다(★Codex 1R — 축만 보면 level 1의 정상 답변에
 * 정반대 표지가 나간다: 건수는 본다고 답했는데 "결과를 안 보고" 류). GAPS와 같은 조합만 존재한다.
 */
export const COVER_GAP: Partial<Record<DiagnosisAxis, Partial<Record<0 | 1, string>>>> = {
  list: {
    0: '고객이 남지 않는 단계예요',
    1: '명단이 흩어져 있는 단계예요',
  },
  targeting: {
    0: '아직 대상을 고르지 않는 단계예요',
    1: '행동 기준까지는 못 나누는 단계예요',
  },
  sending: {
    0: '발송이 멈춰 있는 단계예요',
    1: '발송이 뜸한 단계예요',
  },
  production: {
    0: '글자만으로 보내는 단계예요',
  },
  repeat: {
    0: '단골 챙김은 아직인 단계예요',
    1: '단골 챙김이 손에 의존하는 단계예요',
  },
  measure: {
    0: '결과를 안 보고 보내는 단계예요',
    1: '반응까지는 못 보는 단계예요',
  },
};

/**
 * v8 — 관찰 표의 왼쪽 칸(키). OBSERVE_LEAD에서 조사(은/는)를 뺀 형태다.
 * 화면이 문장 나열이 아니라 `키 : 값` 표로 그리므로 조사가 붙으면 왼쪽 칸이 문장처럼 읽힌다.
 * 앞말에서 기계적으로 잘라내지 않는다 — 조사 규칙은 예외가 많아 원장을 따로 갖는 편이 안전하다.
 */
export const OBSERVE_KEY: Record<DiagnosisAxis, string> = {
  list: '고객 연락처',
  targeting: '가장 최근 발송',
  sending: '지난 한 달 발송',
  production: '콘텐츠 제작',
  repeat: '반복 발송',
  measure: '결과 확인',
};

/** v8 — 실측 선치환(퍼널 A) 관찰의 키. 값은 조립 시점에 건수로 채운다. */
export const OBSERVE_KEY_MEASURED_SENDING = '지난 30일 발송';

/** 관찰 블록의 축별 앞말 — 뒤에 「선택지 라벨」 인용이 붙는다(라벨이 문장형이라 조사 불필요). */
export const OBSERVE_LEAD: Record<DiagnosisAxis, string> = {
  list: '고객 연락처는',
  targeting: '가장 최근 발송은',
  sending: '지난 한 달 발송은',
  production: '콘텐츠 제작은',
  repeat: '반복 발송은',
  measure: '결과 확인은',
};

/** 칭찬 — 그 축 level 2+ 일 때만. 재기술 + 그것이 왜 자산인지 한 문장(조용한 톤 — 화려하면 아부). */
export const PRAISES: Record<DiagnosisAxis, string> = {
  list: '고객 명단을 한곳에 모아 두셨어요. 이 명단이 앞으로 하는 모든 마케팅의 출발점이 됩니다.',
  targeting: '받을 사람을 골라서 보내고 계세요. 같은 발송비로 더 높은 반응을 만드는 습관이에요.',
  sending: '발송을 꾸준히 하고 계세요. 고객이 브랜드를 잊기 전에 다시 만나는 리듬이 있다는 뜻이에요.',
  production: '보내는 메시지에 볼거리를 갖추고 계세요. 같은 안내도 눈에 담기는 형태로 나가고 있어요.',
  repeat: '생일이나 재방문 같은 순간을 챙기고 계세요. 고객 입장에서 가장 반가운 메시지들이에요.',
  measure: '보낸 결과를 확인하고 계세요. 다음 발송을 더 낫게 만들 재료를 이미 모으고 계신 거예요.',
};

/** 강점 근거가 0(전 축 level 1 이하)일 때의 자산 문장 — 접점(P2)에서 파생. 억지 칭찬 대신 사실(M6). */
export const ASSET_PRAISE: Record<string, string> = {
  online: '온라인 접점이라 고객의 행동이 기록으로 남는 환경이에요. 모으기 시작하면 빠르게 쌓입니다.',
  offline: '매일 얼굴을 보는 매장 접점은 온라인이 갖지 못한 자산이에요. 연락처만 남기면 바로 힘이 됩니다.',
  both: '온라인과 매장 양쪽 접점을 갖고 계세요. 한쪽에서 만난 고객을 다른 쪽으로 부를 수 있는 구조예요.',
  booking: '예약을 받는 업종이라 고객 연락처가 자연스럽게 남아요. 시작 조건이 좋은 편이에요.',
  platform: '플랫폼에서 꾸준히 주문이 나온다는 건 상품력이 검증됐다는 뜻이에요. 이제 그 고객을 내 명단으로 옮길 차례예요.',
};

/**
 * v5 — 전문 툴 사용자의 명단 칭찬 분화(unified_tool 답이 고른다). 엑셀 초심자용 일반 칭찬이
 * CRM 운영사에 나가면 "우리 수준을 모르네"가 된다(Harold 지적). 재기술 + 다음 한 수 프레임.
 */
export const LIST_TOOL_PRAISES: Record<string, string> = {
  crm: '이미 CRM으로 고객을 관리하고 계세요. 데이터 기반은 갖춰진 회사라, 남은 건 그 명단이 발송과 이어지는 것뿐이에요.',
  marketing_tool: '마케팅 툴을 쓰실 만큼 데이터 관리가 자리 잡았어요. 이제 그 데이터가 실제 발송 성과로 이어지는지가 관건이에요.',
  erp: '자체 시스템에 고객이 정리돼 있다는 건 데이터 자산이 이미 있다는 뜻이에요. 꺼내 쓰는 통로만 놓이면 바로 힘이 됩니다.',
  chat_tool: '상담 툴에 고객 접점이 차곡차곡 쌓이고 있어요. 문의로 만난 고객을 다시 부를 수 있는 재료가 이미 있는 거예요.',
};

/**
 * 병목 인과 2단(그래서 생기는 일) — 축 × 발생 가능 level(0·1)만. 없는 조합 = 그 축은 병목이 아니다.
 * {t} = 접점 어절 슬롯.
 */
export const GAPS: Partial<Record<DiagnosisAxis, Partial<Record<0 | 1, { cause: string; effect: string }>>>> = {
  list: {
    0: {
      cause: '오신 고객이 누구인지 아직 남지 않고 있어요.',
      effect: '다시 {t}을 만들 방법이 광고나 우연뿐이라, 올 때마다 새로 데려와야 해요.',
    },
    1: {
      cause: '명단이 있긴 한데 엑셀이나 포스기, ERP 같은 곳에 나뉘어 있어요.',
      effect: '보내야 할 순간에 바로 꺼낼 수 없어서, 있는 명단이 없는 것처럼 놀아요.',
    },
  },
  targeting: {
    0: {
      cause: '가장 최근 발송이 명단 전체에게 나갔거나, 아직 발송 전이에요.',
      effect: '관심 없는 고객에게도 같은 메시지가 가면 수신거부가 조용히 쌓이고, 다음에 닿을 사람이 줄어요.',
    },
    1: {
      cause: '성별과 나이까지는 나누고 계신데, 행동 기준은 아직이에요.',
      effect: '같은 연령대라도 산 사람과 안 산 사람은 반응이 완전히 달라서, 발송의 절반이 허공에 가요.',
    },
  },
  sending: {
    0: {
      cause: '지난 한 달 동안 고객에게 나간 메시지가 없어요.',
      effect: '고객은 마지막 {t} 이후 브랜드를 잊어가고, 그 자리를 다른 곳이 채워요.',
    },
    1: {
      cause: '발송이 월 한두 번에 그치고 있어요.',
      effect: '간격이 벌어질수록 다음 메시지가 낯설어져서, 보낼 때마다 처음부터 다시 시작하는 셈이 돼요.',
    },
  },
  production: {
    0: {
      cause: '메시지가 글자만으로 나가고 있어요.',
      effect: '같은 혜택도 보여주지 못하면 스치듯 지워져요. 신제품이나 행사 안내에서 차이가 커요.',
    },
  },
  repeat: {
    0: {
      cause: '생일이나 재방문 안내처럼 반복해서 나가는 메시지가 아직 없어요.',
      effect: '다시 올 이유를 브랜드가 만들지 않으면, 재{t}은 전적으로 고객 기억에 달려 있게 돼요.',
    },
    1: {
      cause: '챙기고는 계신데, 생각날 때 손으로 보내고 계세요.',
      effect: '사람 기억에 의존하는 발송은 바쁜 달에 제일 먼저 끊겨요. 정작 효과는 제일 좋은데요.',
    },
  },
  measure: {
    0: {
      cause: '보낸 뒤에 결과를 보지 않고 계세요.',
      effect: '무엇이 통했는지 모른 채 다음 발송을 만들게 되어, 같은 비용으로 나아질 기회가 사라져요.',
    },
    1: {
      cause: '발송 성공 건수까지만 확인하고 계세요.',
      effect: '도착했는지는 알아도 반응했는지는 몰라서, 문구와 대상을 바꿀 근거가 안 쌓여요.',
    },
  },
};

/** 병목 인과 3단(바꾸는 방법) — 축당 1문장·도구 중립(자사명 0). */
export const DIRECTIONS: Record<DiagnosisAxis, string> = {
  list: '이번 주에 오는 고객부터 연락처를 한곳에 남겨 보세요. 열 명이면 충분한 시작이에요.',
  targeting: '다음 발송은 최근 석 달 안에 {t}이 있던 고객에게만 보내 보세요. 같은 문구여도 반응 차이가 보여요.',
  sending: '이번 달에 알릴 것 하나를 정해 한 번만 보내 보세요. 잘 만든 한 번이 리듬의 시작이에요.',
  production: '다음 안내부터 이미지 한 장을 붙여 보세요. 글자만일 때와 반응을 비교해 보시고요.',
  repeat: '가장 효과 좋은 것 하나만 자동으로 바꿔 보세요. 생일 축하가 대개 첫 후보예요.',
  measure: '다음 발송에서 링크 클릭 하나만 세어 보세요. 숫자 하나가 다음 문구를 정해 줍니다.',
};

/**
 * 변형 표의 공통 모양 — 30일 실행 처방(PRESCRIPTIONS)과 병목 킥(HANJUL_FILLS)이 같은 규약을 쓴다.
 * variant key = `${질문key}:${답key}` · **표에 적은 순서가 곧 우선순위**(구체적인 판정을 위에 둔다).
 */
export interface VariantTable<T = string> {
  default: T;
  variants?: Record<string, T>;
}

/**
 * 변형 선택 — 첫 매칭에서 멈춘다. 선택 로직은 이 한 벌뿐이다(표마다 복사하면 규약이 갈린다).
 * variantKey는 호출부가 특수 처리(NO_PRESCRIPTION_VARIANTS 등)를 판정하는 데 쓴다.
 */
export function pickVariant<T>(
  table: VariantTable<T>,
  answers: Record<string, string>,
): { variantKey: string | null; value: T } {
  for (const [variantKey, value] of Object.entries(table.variants ?? {}) as Array<[string, T]>) {
    const [qKey, aKey] = variantKey.split(':');
    if (answers[qKey] === aKey) return { variantKey, value };
  }
  return { variantKey: null, value: table.default };
}

/**
 * 30일 실행(plan30)의 축별 실행 문장 — 분기 심화 답이 변형을 고른다(variant key = `${질문key}:${답key}`).
 * 매칭 없으면 'default'(= DIRECTIONS 재사용이 아니라 실행형 문장).
 *
 * ⚠ 변형은 **그 축이 병목(level ≤ 1)일 때만** 선택된다 — 축이 상위 등급일 때만 열리는 분기에 변형을 걸면
 *   영원히 안 나간다. 현행 seed v5 기준 도달 불가 잔존 = list의 `unified_tool:*`(unified는 level 3) ·
 *   production의 `prod_*`(self·outsource는 level 2). 판정 축을 바꿀지가 결정 사항이라 그대로 둔다.
 *   신규 원장(HANJUL_FILLS)은 seed 계약 테스트가 도달 가능성을 강제한다.
 */
export const PRESCRIPTIONS: Record<DiagnosisAxis, VariantTable> = {
  list: {
    default: '포스기·쇼핑몰·엑셀에 흩어진 연락처를 한곳으로 모으는 것부터 시작하세요. 이번 주는 모으기만 해도 됩니다.',
    variants: {
      // 순서 = 매칭 우선순위(더 구체적인 판정 먼저): 플랫폼 종속은 유입 캡처 처방까지 흡수한다
      'locked_tool:platform': '다녀간 고객이 연락처를 남길 이유를 하나 만드세요. 멤버십 적립이나 리뷰 혜택 한 줄이면, 플랫폼 고객이 내 고객이 되기 시작해요.',
      'locked_tool:erp': 'ERP 명단을 발송할 수 있는 곳으로 옮기는 정기 통로부터 만드세요. 내보내기 한 번이면 시작이에요.',
      'unified_tool:erp': 'ERP 명단을 발송할 수 있는 곳으로 옮기는 정기 통로부터 만드세요. 내보내기 한 번이면 시작이에요.',
      'unified_tool:excel': '엑셀 명단에 새 고객이 자동으로 들어오는 통로를 만드세요. 손 정리가 멈춰도 명단이 크도록요.',
      'inflow_capture:no_capture': '광고로 온 고객이 연락처를 남길 자리부터 만드세요. 적립이나 예약 확인 한 줄이면 됩니다.',
      'inflow_capture:event_only': '이벤트 때만 남는 연락처를 평소에도 남게 하세요. 새는 문은 대개 한 곳이에요.',
    },
  },
  targeting: {
    default: '다음 발송에서 최근 석 달 {t} 고객만 골라 보내고, 그 반응을 전체 발송과 비교해 보세요.',
    variants: {
      'optout_check:not_checked': '먼저 지난 발송의 수신거부부터 확인해 보세요. 그 숫자가 나눠 보낼 이유를 말해 줍니다.',
      'unified_tool:crm': 'CRM에 이미 있는 방문·구매 기록으로 다음 발송 대상을 골라 보세요. 새로 모을 것 없이 지금 데이터로 됩니다.',
      'unified_tool:marketing_tool': '쓰시는 툴에 쌓인 고객 기록으로 대상을 나눠 보세요. 데이터는 이미 있고, 거는 조건 하나가 없을 뿐이에요.',
      'unified_tool:erp': '자체 시스템의 구매 기록으로 받을 사람을 골라 보세요. 데이터는 이미 충분하고, 꺼내 쓰는 길만 놓이면 됩니다.',
    },
  },
  sending: {
    default: '이번 달 알릴 것 하나를 정해 한 번 보내세요. 문구는 한 문장, 대상은 최근 고객이면 충분해요.',
    variants: {
      'no_send_reason:no_list': '발송보다 명단이 먼저예요. 명단 열 명이 모이면 그때 첫 발송을 하세요.',
      'no_send_reason:no_copy': '문구는 지금 파는 것 하나와 혜택 하나만 적으면 됩니다. 길게 쓸수록 안 읽혀요.',
      'no_send_reason:no_time': '한 달에 한 번, 30분만 달력에 정해 두세요. 그 시간에만 만들고 보내는 겁니다.',
      'no_send_reason:no_effect': '효과가 없던 건 전체 발송이었을 가능성이 커요. 최근 고객 소수에게만 다시 시험해 보세요.',
    },
  },
  production: {
    default: '다음 안내에 이미지 한 장을 붙여 보내 보세요. 만드는 부담이 크면 한 장짜리부터요.',
    variants: {
      'prod_refit:yes': '채널마다 다시 만드는 일부터 없애 보세요. 한 번 만든 것을 크기별로 트는 방식으로요.',
      'prod_leadtime:week': '받는 데 일주일이 넘으면 즉흥 행사를 못 해요. 당일 제작 경로를 하나 확보해 두세요.',
      'prod_leadtime:varies': '받는 날짜를 못 정하면 발송 달력을 못 짜요. 당일 제작 경로를 하나 확보해 두세요.',
      'prod_time:fullday': '한 건에 하루가 넘게 들면 발송 자체가 미뤄져요. 제작 시간을 줄일 방법부터 찾으세요.',
      'prod_time:gaveup': '만들다 그만둔 적이 있다면 도구가 아니라 과정이 무거운 거예요. 더 가벼운 제작 방식으로 바꿔 보세요.',
    },
  },
  repeat: {
    default: '반복 발송 하나를 정해 조건과 문구를 고정하세요. 그다음부터는 사람이 아니라 달력이 보냅니다.',
    variants: {
      'manual_count:c6_10': '손으로 챙기는 발송이 월 6번을 넘으면 이미 자동화가 남는 장사예요. 제일 잦은 것부터 바꾸세요.',
      'manual_count:c10p': '월 10번 넘게 손으로 보내고 계세요. 이 반복부터 자동으로 돌리면 시간이 가장 크게 돌아와요.',
      'unified_tool:crm': 'CRM의 방문·구매 기록에 조건 하나를 걸어 생일이나 재방문 안내부터 자동으로 돌려 보세요. 재료는 이미 다 있어요.',
    },
  },
  measure: {
    default: '다음 발송에서 클릭 수 하나만 기록해 보세요. 두 번째 발송부터 비교가 시작됩니다.',
    variants: {
      'measure_reason:dont_know': '발송 결과 화면을 여는 것부터가 시작이에요. 성공과 실패 숫자만 봐도 절반은 온 거예요.',
      'measure_reason:no_time': '결과를 찾아보는 대신 요약으로 받아 보는 방식으로 바꿔 보세요. 보는 시간이 거의 사라져요.',
      'measure_reason:what_next': '기준을 숫자 하나(클릭)로 정하세요. 오르면 유지, 내리면 문구를 바꾸는 룰이면 충분해요.',
    },
  },
};

/** measure_reason:no_need — 처방하지 않는다(억지 처방 금지 §3-6). 이 키가 오면 measure 처방을 생략한다. */
export const NO_PRESCRIPTION_VARIANTS = new Set(['measure_reason:no_need']);

/** 병목 카드 채움 킥 — 두 줄로 갈라 쓴다(첫 줄이 카드의 두 번째 강조, 둘째 줄이 방법). */
export interface HanjulFill {
  /** 없어지는 수고 — 기능 이름이 아니라 **그 사람이 안 해도 되는 일**을 지목한다. */
  gone: string;
  /** 그래서 어떻게 되는가 — 한 줄. */
  how: string;
}

/**
 * v6·v8 — 병목 채움 킥("이 부족함을 한줄로는 이렇게 채워드립니다" · Harold 확정 2026-08-16).
 * 병목 카드 인과 4박자째로 붙는다(heard → cause → effect → direction → **fill**).
 * 30일 실행 각주(v5 FOOTNOTES)는 이 킥으로 대체돼 폐지됐다 — 같은 말을 두 곳에서 하지 않는다.
 *
 * 집필 규약 (★v8 개정 — "기능 소개"에서 "없어지는 수고"로)
 *   - **주어 「한줄로」를 쓰지 않는다.** 화면 라벨(「한줄로에서는」)이 주어를 소유한다 —
 *     그래서 서버가 만드는 리포트 문장 전체에 자사명이 0이 되고, 삭제 테스트가 구조로 보장된다.
 *   - `gone` = "~하는 일이 없어집니다/사라집니다/줄어듭니다/풀립니다"(계약 테스트가 어미를 강제).
 *     effect가 말한 손실과 짝이 맞아야 한다 — 기능 나열은 반려 대상이다.
 *   - `how` = 실존 기능이 실제로 하는 동작 한 줄(고객 통합·세그먼트·AI 문안/이미지·자동 발송·
 *     발송 결과·자사몰 연동·수신거부 관리). 수치·기간 약속 0 · 문장 속 대시 0 · {t} 슬롯 허용.
 *   - 변형 키는 **그 축이 병목일 때 열리는 분기**만 쓴다(도달 가능성 = seed 계약 테스트가 강제).
 */
export const HANJUL_FILLS: Record<DiagnosisAxis, VariantTable<HanjulFill>> = {
  list: {
    default: {
      gone: '흩어진 연락처를 모으고 정리하는 일이 없어집니다.',
      how: '포스기와 쇼핑몰, 엑셀의 고객이 자동으로 한 명단에 쌓입니다.',
    },
    variants: {
      'locked_tool:platform': {
        gone: '플랫폼 밖으로 고객을 부르지 못하는 상태가 풀립니다.',
        how: '매장에서 남긴 연락처가 바로 발송할 수 있는 내 명단이 됩니다.',
      },
      'locked_tool:erp': {
        gone: '명단을 내보내고 옮기는 일이 없어집니다.',
        how: '자체 시스템의 고객이 자동으로 동기화돼 그대로 발송 대상이 됩니다.',
      },
      'inflow_capture:no_capture': {
        gone: '광고로 온 고객이 그냥 지나가는 일이 줄어듭니다.',
        how: '자사몰과 예약 화면에서 남긴 연락처가 그대로 명단에 담깁니다.',
      },
    },
  },
  targeting: {
    default: {
      gone: '받을 사람을 매번 새로 추리는 일이 없어집니다.',
      how: '구매 이력으로 한 번 고르면 그 조건이 저장돼, 다음엔 눌러서 바로 보냅니다.',
    },
    variants: {
      'unified_tool:crm': {
        gone: 'CRM에서 고른 고객을 발송 쪽으로 옮기는 일이 없어집니다.',
        how: '고른 대상이 그대로 발송 명단이 됩니다.',
      },
      'optout_check:not_checked': {
        gone: '수신거부를 따로 확인하는 일이 없어집니다.',
        how: '거부한 고객은 자동으로 빠진 채 발송됩니다.',
      },
    },
  },
  sending: {
    default: {
      gone: '보내기까지 화면을 옮겨 다니는 일이 없어집니다.',
      how: '문안 작성부터 발송과 결과 확인까지 한곳에서 끝납니다.',
    },
    variants: {
      'no_send_reason:no_copy': {
        gone: '무엇을 써야 할지 막히는 일이 없어집니다.',
        how: '팔 것과 혜택만 고르면 AI가 문안을 대신 써 드립니다.',
      },
      'no_send_reason:no_time': {
        gone: '한 번 보내려고 손이 여러 번 가는 일이 없어집니다.',
        how: '만들고 보내는 과정이 한 화면으로 줄어듭니다.',
      },
      'send_tool:mixed': {
        gone: '보낼 곳을 옮겨 다니는 일이 없어집니다.',
        how: '문자·알림톡·이메일·모바일 DM을 한곳에서 보내고 결과도 한곳에 모입니다.',
      },
    },
  },
  production: {
    default: {
      gone: '이미지를 만들 사람을 따로 찾는 일이 없어집니다.',
      how: '상품과 문구만 고르면 보낼 이미지와 안내 화면이 완성됩니다.',
    },
    variants: {
      'copy_how:no_copy': {
        gone: '문구 없이 그냥 보내는 일이 없어집니다.',
        how: '무엇을 파는지만 고르면 문구와 이미지가 함께 만들어집니다.',
      },
      'copy_how:new': {
        gone: '매번 문구를 새로 쓰는 일이 없어집니다.',
        how: 'AI가 먼저 써 주고, 어울리는 이미지까지 같이 만들어집니다.',
      },
      'copy_how:reuse': {
        gone: '예전 문구를 찾아 고쳐 쓰는 일이 없어집니다.',
        how: '지금 파는 상품에 맞는 문구와 이미지가 새로 만들어집니다.',
      },
    },
  },
  repeat: {
    default: {
      gone: '보낼 때를 기억하고 챙기는 일이 없어집니다.',
      how: '생일이나 재{t} 안내가 조건만 정해 두면 자동으로 나갑니다.',
    },
    variants: {
      'manual_count:c6_10': {
        gone: '매달 손으로 챙기던 발송이 없어집니다.',
        how: '조건을 한 번 정해 두면 그다음부터는 자동으로 나갑니다.',
      },
      'manual_count:c10p': {
        gone: '매달 손으로 챙기던 발송이 없어집니다.',
        how: '조건을 한 번 정해 두면 그다음부터는 자동으로 나갑니다.',
      },
    },
  },
  measure: {
    default: {
      gone: '결과를 찾아다니는 일이 없어집니다.',
      how: '보낸 뒤 클릭과 방문까지 발송 결과에 자동으로 담깁니다.',
    },
    variants: {
      'measure_reason:dont_know': {
        gone: '어디서 보는지 헤매는 일이 없어집니다.',
        how: '발송이 끝나면 결과가 같은 화면에 바로 뜹니다.',
      },
      'measure_reason:no_time': {
        gone: '결과를 보려고 따로 시간을 내는 일이 없어집니다.',
        how: '보이는 곳에 두어 스치듯 봐도 흐름이 잡힙니다.',
      },
    },
  },
};

/** 모순 조합 관찰문 — 강등이 아니라 소견 승격(회의 확정). 전용 집필만. */
export const COMBO_OBSERVATIONS = {
  headless_criteria:
    '관심사까지 보고 고르시는데, 그 기준이 명단에는 남아 있지 않아요. 지금은 담당자 머릿속에 있는 상태라, 자리를 비우면 같은 발송을 다시 만들 수 없어요.',
  paid_inflow_leak:
    '광고로 오신 고객의 연락처가 남지 않고 있어요. 비용을 들여 데려온 고객이 한 번의 {t}으로 끝나는 구조예요.',
  /** v4 도구 스택 축 — 데이터가 사는 곳과 발송하는 곳이 다르다(ERP·POS ↔ 별도 발송 도구). */
  tool_disconnect:
    '고객 데이터가 있는 곳과 발송하는 곳이 서로 달라요. 보낼 때마다 명단을 꺼내 옮겨야 해서, 골라 보내는 일이 구조적으로 번거로운 상태예요.',
  /** v4 — 발송 도구가 여러 갈래라 기록·결과가 흩어진다. */
  tool_mixed:
    '발송 도구가 여러 갈래로 나뉘어 있어요. 보낸 기록과 결과도 흩어져서, 무엇이 통했는지 한곳에서 보기 어려운 구조예요.',
  /** v4 — 한곳에 모았지만 엑셀이라 자동 갱신이 없다. */
  unified_but_excel:
    '명단을 한곳에 모으신 건 좋은 출발이에요. 다만 엑셀이라 새 고객이 자동으로 들어오지는 않아서, 정리하는 손이 멈추면 명단도 멈춰요.',
  /** v5 — 플랫폼 종속: 고객은 오는데 연락처는 플랫폼 소유(한국 자영업 최대 병목 축). */
  platform_lock:
    '고객은 꾸준히 오는데 연락처는 플랫폼이 갖고 있어요. 매출이 나도 내 명단은 늘지 않아서, 광고비나 수수료 없이는 같은 고객을 다시 부를 수 없는 구조예요.',
} as const;

/** v4 — 도구 스택 답의 관찰 앞말(뒤에 「선택지 라벨」 인용이 붙는다). */
export const TOOL_OBSERVE: Record<string, string> = {
  locked_tool: '고객 데이터가 있는 곳은',
  unified_tool: '명단을 모아 둔 곳은',
  send_tool: '발송에 쓰는 도구는',
};

/** v8 — 도구 축의 관찰 표 키(조사 없음 · OBSERVE_KEY와 같은 이유). */
export const TOOL_OBSERVE_KEY: Record<string, string> = {
  locked_tool: '고객 데이터가 있는 곳',
  unified_tool: '명단을 모아 둔 곳',
  send_tool: '발송에 쓰는 도구',
};

/** v4 — 발송 도구 중 "데이터가 사는 곳과 분리된 외부 도구" 판정(디스커넥트 조합 입력). */
export const EXTERNAL_SEND_TOOLS = new Set(['sms_site', 'kakao_agency', 'email_tool', 'mixed']);
/** v4 — 데이터 측 시스템 답 중 "발송 기능이 없는 저장소" 판정(platform은 전용 짚임이 우선한다). */
export const DATA_SIDE_SYSTEMS = new Set(['pos', 'mall', 'erp', 'booking_sys']);
/** v5 — 한곳 저장소 중 "발송과 분리돼 있기 쉬운" 판정(디스커넥트 조합의 unified 측). */
export const UNIFIED_DISCONNECT_TOOLS = new Set(['erp', 'crm', 'chat_tool']);

/**
 * v5 — 견적 구간 전용 한 줄(전문 툴·자체 시스템 사용자에게만). 홍보 위치 계약 안의 문장이다 —
 * 본문(표지~병목) 노출 금지, 렌더는 견적 카드 하단 작은 활자.
 */
export const PITCH_NOTE_TOOL_USER =
  '지금 쓰시는 도구를 바꾸는 이야기가 아니라, 그 데이터에 발송과 자동화가 이어지는 구성이에요.';

/** 병목 0(전 축 상위)의 고도화 제안 — 심화 답에서만 파생(자기 문장을 가진 답만). */
export const UPGRADE_SUGGESTIONS: Array<{ q: string; a: string; text: string }> = [
  {
    q: 'segment_reuse',
    a: 'fresh',
    text: '고르는 조건을 매번 새로 만들고 계세요. 잘 쓰는 조건 두세 개만 저장해 두면 발송 준비가 몇 분으로 줄어요.',
  },
  {
    q: 'measure_compare',
    a: 'none',
    text: '구매까지 보시는데 달끼리 비교는 안 하고 계세요. 숫자 두 개만 적어 두면 잘한 달의 이유를 찾을 수 있어요.',
  },
  {
    q: 'measure_compare',
    a: 'feel',
    text: '비교를 느낌으로 하고 계세요. 숫자 두 개만 적어 두면 잘한 달의 이유가 손에 잡혀요.',
  },
  {
    q: 'auto_count',
    a: 'a_unknown',
    text: '자동 발송이 몇 개 도는지 세어 보지 않으셨어요. 목록을 한 번 정리하면 겹치거나 빠진 구멍이 보여요.',
  },
  {
    q: 'manual_ratio',
    a: 'all_manual',
    text: '매번 직접 골라 보내고 계세요. 반복되는 발송 하나만 예약으로 바꿔도 손이 크게 줄어요.',
  },
];

/** manual_count 답 → 월 최소 횟수(연환산 앵커 — 답변 하한만 쓴다: 부풀리지 않는 방향). */
export const MANUAL_COUNT_MIN: Record<string, number> = {
  c1_2: 1,
  c3_5: 3,
  c6_10: 6,
  c10p: 10,
};

/** 접점 슬롯 치환 — 2단(생기는 일)·조합 관찰문에만 쓴다(회의 확정: 1단은 인용, 3단 곱셈 금지). */
export function fillTouch(text: string, touchKey: string | null | undefined): string {
  const word = (touchKey && TOUCH_WORD[touchKey]) || '방문';
  return text.split('{t}').join(word);
}
