/**
 * ★ CT: 몰별 「준비 됨」 표(★ 2026-10-28 자사몰 대비 K13 · G9 · M16 · M17 · M18)
 *
 * 화면이 몰마다 「무엇이 됩니다」를 고정 문장으로 약속하던 것을 이 표 하나로 바꾼다(GET /api/cdp/providers 가 싣는다).
 * 등급 = live(실고객 데이터로 확인) · test(시험 몰로 확인) · code(코드만 있음 · 확인 전) · none(길 없음).
 * 화면 = test 이상만 「됩니다」 · code = 「준비 중」 · none = 말하지 않음 · /providers 실패 = 능력 문장 0.
 * 근거 = 날짜 · 원문 위치(필수) — 등급을 올리는 길은 리허설(설계서 §7)의 원문 + 판정 한 줄뿐이다(추측으로 올리지 않는다).
 */
export const READINESS_STAGES = ['history', 'realtime', 'paid_signal', 'consent', 'withdrawal', 'behavior', 'first_purchase'] as const;
export type ReadinessStage = (typeof READINESS_STAGES)[number];
export type ReadinessGrade = 'live' | 'test' | 'code' | 'none';
export interface ReadinessCell { grade: ReadinessGrade; evidence: string }
export type ProviderReadiness = Record<ReadinessStage, ReadinessCell>;

const c = (grade: ReadinessGrade, evidence: string): ReadinessCell => ({ grade, evidence });
const NONE_YET = (why: string): ProviderReadiness => Object.fromEntries(READINESS_STAGES.map((st) => [st, c('none', why)])) as ProviderReadiness;

export const PROVIDER_READINESS: Record<string, ProviderReadiness> = {
  woocommerce: {
    history: c('live', '0921 4몰 가져오기 실데이터(구조체크 원장 §4-1)'),
    realtime: c('live', '웹훅 + 30분 주기 수집 실데이터(§4-1)'),
    paid_signal: c('live', '1001 결제 시각 원문 · 상태 분포(§4-1)'),
    consent: c('live', '몰 동의 키 실데이터(0921 · §4-1)'),
    withdrawal: c('code', '1028 K5 customer.deleted 웹훅(리허설 전 · 설계서 §7)'),
    behavior: c('code', '플러그인 1.0.3 · 설치 0(§4-1 · 리허설 전)'),
    first_purchase: c('code', '가입일 = 우커머스 회원 칸(리허설 전)'),
  },
  cafe24: {
    history: c('none', '주문 · 회원 목록 조회 0(M29 · 바뀐 시각 조회 칸 원문 미확인 · 리허설 대기)'),
    realtime: c('test', '0703 gyunoo83 시험 몰 주문 웹훅(§4-1 · 웹훅만)'),
    paid_signal: c('code', '1004 상태 코드표 · 원문 미확인(M18)'),
    consent: c('none', '회원 웹훅 권한 미승인(§4-1)'),
    withdrawal: c('none', '삭제 신호 없음 · 회원 권한 승인 뒤(설계서 K5)'),
    behavior: c('code', '스크립트 자동 삽입 · 1028 K12 허용 도메인(리허설 전)'),
    first_purchase: c('none', '과거 데이터 가져오기 0(M29)'),
  },
  imweb: {
    history: c('none', '목록 API 적어 두고 안 씀(M29 · 리허설 대기)'),
    realtime: c('code', '앱 승인만 · 실연결 0(§4-1)'),
    paid_signal: c('code', '입금 완료만(M17 · 원문 미확인)'),
    consent: c('code', '동의 칸 이름 미확인(§4-1)'),
    withdrawal: c('code', '탈퇴 웹훅 코드(§4-1)'),
    behavior: c('none', '스크립트 넣는 자리 미확인(§8-4)'),
    first_purchase: c('none', '과거 데이터 가져오기 0(M29)'),
  },
  godo: {
    history: c('code', '90일 가져오기 · 시험 몰 주문 0(§4-1)'),
    realtime: c('code', '30분 주기 수집 · 시험 몰 주문 0'),
    paid_signal: c('code', '상태표 · 원문 미확인(M16)'),
    consent: c('none', 'smsFl 칸 뜻 미확인 · 쓰지 않음(K2-1)'),
    withdrawal: c('none', '회원 경로 없음(§9-1)'),
    behavior: c('none', '회원 토큰 자리 없음 · 익명만(§8-4)'),
    first_purchase: c('code', '90일 가져오기 뒤 판정(시험 몰 주문 0)'),
  },
  custom: {
    history: c('code', '일괄 적재 API(고객사 몫)'),
    realtime: c('live', '0706 2개 회사 웹훅 실데이터(§4-1)'),
    paid_signal: c('live', '고객사가 보낸 상태 글자(§4-1)'),
    consent: c('live', '고객사가 보낸 동의 값(§4-1)'),
    withdrawal: c('code', '1028 K5 customer.deleted 선택 칸(리허설 전)'),
    behavior: c('code', 'SDK 스니펫(설치 실측 전)'),
    first_purchase: c('code', '고객사 과거 데이터 적재 뒤'),
  },
  naver_smart_store: NONE_YET('매핑 보류(§4-1 · 조회형 · 1028 M19 웹훅 삭제)'),
  makeshop: NONE_YET('매핑 보류(§4-1)'),
};

/** 그 몰의 표(없으면 null = 화면이 능력 문장을 말하지 않는다) */
export function providerReadinessOf(provider: string): ProviderReadiness | null {
  return PROVIDER_READINESS[provider] ?? null;
}
