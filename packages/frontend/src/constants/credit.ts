import { Sparkles, Route, Smartphone, Layers, PenLine, Wand2, Repeat, type LucideIcon } from 'lucide-react';

/**
 * 종량제 크레딧 공용 상수 (D229+ UI 폴리시).
 * 프론트 전 영역(PricingPage 요약 바·AI Operator 칩 등)에서 같은 값을 쓰도록 단일 소스로 모음.
 * 작업당 단가는 백엔드 utils/ai-credit-calc.ts CREDIT_COST_MAP과 1:1 일치해야 함 — 한쪽만 바꾸지 말 것.
 */

export interface CreditTaskCost {
  key: string;
  label: string;
  cost: number;
  icon: LucideIcon;
}

/**
 * 작업당 AI 크레딧 단가 — 백엔드 CREDIT_COST_MAP 기준 (가치 기반 재설계, 1크레딧 = 500원).
 *  풀분석 300 · 여정 150 · 자동마케팅 50 · 모바일DM 30 · 인앱 15 · 문안·분석 5 · 다듬기·질문 1.
 *  스팸필터 테스트는 비대상(0, 미표기).
 */
export const CREDIT_TASK_COSTS: CreditTaskCost[] = [
  { key: 'full', label: '풀분석', cost: 300, icon: Sparkles },
  { key: 'journey', label: '여정 설계', cost: 150, icon: Route },
  { key: 'auto', label: '자동 마케팅', cost: 200, icon: Repeat },
  { key: 'dm', label: '모바일 DM', cost: 30, icon: Smartphone },
  { key: 'inapp', label: '인앱 생성', cost: 15, icon: Layers },
  { key: 'copy', label: '문안·분석', cost: 5, icon: PenLine },
  { key: 'refine', label: '다듬기·질문', cost: 1, icon: Wand2 },
];

/**
 * 크레딧 → 대표 작업 환산 횟수. 실제 단가(풀분석 300·DM 30·문안 5)로만 계산 — 임의 상수 없음.
 * "2,400 크레딧"이 막연하지 않게 "풀분석 8회"처럼 손에 잡히는 양으로 보여주는 용도.
 */
export function creditConversions(credits: number) {
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  return {
    fullAnalysis: Math.floor(c / 300),
    dm: Math.floor(c / 30),
    copy: Math.floor(c / 5),
  };
}

export interface PlanInfra {
  label: string;    // 인프라 등급명 (카드 표시)
  benefit: string;  // 한 줄 가치 설명
  premium: boolean; // 전용 등급 시각 강조 여부 (비즈니스·엔터)
}

/**
 * 요금제별 인프라 등급 (Harold 명시 2026-06-01).
 *  - 스타터·베이직·프로: 당사 IDC 고성능 서버를 멀티테넌트(공유)로 사용
 *  - 비즈니스: 전용 서버를 당사 IDC에 입고해 전담 관리
 *  - 엔터프라이즈: 전용 AI 서버를 당사 IDC에 입고해 전담 관리
 * 온프레미스(고객사 설치)가 아니라 "당사 IDC 입고 + 전담 관리"가 핵심.
 */
export const PLAN_INFRA: Record<string, PlanInfra> = {
  STARTER:    { label: '고성능 공유 서버', benefit: '당사 IDC 고성능 서버를 멀티테넌트로 사용', premium: false },
  BASIC:      { label: '고성능 공유 서버', benefit: '당사 IDC 고성능 서버를 멀티테넌트로 사용', premium: false },
  PRO:        { label: '고성능 공유 서버', benefit: '당사 IDC 고성능 서버를 멀티테넌트로 사용', premium: false },
  BUSINESS:   { label: '전용 서버', benefit: '당사 IDC 전용 서버 입고 · 독립 환경 · 데이터 격리 · 전담 관리', premium: true },
  ENTERPRISE: { label: '전용 AI 서버', benefit: '당사 IDC 전용 AI 서버 입고 · 완전 격리 · 최고 성능 · 전담 관리', premium: true },
};

/** 전 플랜 공통 서비스 한 줄 — 등급별 기능 차등 폐지(스타터부터 동일). */
export const COMMON_SERVICE_LINE = '스타터부터 AI 전 기능 · 전 채널 발송 동일';

/**
 * ai_credit_transactions.source → 한글 작업명 (사용 이력 표시).
 * 백엔드 CREDIT_COST_MAP source와 1:1. 미등록 source는 'AI 작업'으로 fallback.
 */
export const CREDIT_SOURCE_LABELS: Record<string, string> = {
  orchestrate: '풀분석', orchestrateWithAI: '풀분석',
  'journey-ai-generate': '여정 설계', 'journey-builder-custom': '여정 설계',
  'continuous-operator': '자동 마케팅',
  'dm-builder': '모바일 DM',
  'inapp-ai-generator': '인앱 생성', 'inapp-quick-action': '인앱 생성',
  'generate-messages': '문구 생성', 'generate-custom-messages': '문구 생성',
  'recommend-target': '타겟 추천', 'recommend-next-campaign': '캠페인 추천',
  'variant-generator': '문안 변형', 'performance-explainer': '성과 분석',
  'performance-quick-action': '성과 분석', 'next-action-advisor': '액션 추천',
  'multi-goal-decisioning': '목표 분석', 'cdp-fusion-explainer': 'CDP 분석',
  'voice-inbound': '음성 분석', 'dm-event-recommender': '이벤트 추천',
  'journey-ai-refine': '다듬기', 'journey-step-diagnosis': '진단',
  'dm-quick-action-refine': '다듬기', 'dm-self-diagnosis': '진단',
  'inapp-explainer': '인앱 설명', 'alimtalk-matcher': '알림톡 매칭',
  'ai-memory-search': '메모리 검색', 'ai-usage-search': '사용 검색',
  'ai-segment-generator': '세그먼트 생성', 'ai-column-mapper': '컬럼 매핑',
  'brand-voice-extract': '브랜드보이스 추출', 'parse-briefing': '브리핑 분석',
};

/** ai_credit_transactions.type → 한글. deduct는 source 라벨 우선. */
export const CREDIT_TYPE_LABELS: Record<string, string> = {
  deduct: 'AI 작업', grant: '관리자 지급', admin_deduct: '관리자 차감',
  purchase: '크레딧 충전', reset: '월 기본분 리셋', postpaid_grant: '후불 지급',
};

/** 크레딧 거래 1건 → 표시 라벨 (deduct=작업명, 그 외=type 라벨). */
export function creditTxLabel(type: string, source?: string | null): string {
  if (type === 'deduct') return (source && CREDIT_SOURCE_LABELS[source]) || 'AI 작업';
  return CREDIT_TYPE_LABELS[type] || type;
}

/**
 * 크레딧 충전 단가 — 백엔드 ai-credit-calc.ts와 동일값(미리보기 전용).
 * 실제 청구 금액은 백엔드가 계산(진실의 원천). 화면에 단가 자체를 노출하지 말 것. 보너스 없음.
 */
export const CREDIT_UNIT_PRICE = 500;
export const CREDIT_VAT_RATE = 0.1;

/** 충전 크레딧 수량 → 결제 금액(공급가/부가세/합계). */
export function calcRechargeAmount(credits: number): { credits: number; supply: number; vat: number; total: number } {
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  const supply = c * CREDIT_UNIT_PRICE;
  const vat = Math.round(supply * CREDIT_VAT_RATE);
  return { credits: c, supply, vat, total: supply + vat };
}

/**
 * 요금제 보너스 % — 지급 크레딧이 (월정액 ÷ 단가) 기본분 대비 몇 % 더인지.
 * 요금제 카드 "+XX%" 배지용. 0 이하면 미표시.
 * 예: 프로 100만 / 단가 500 = 기본 2,000, 지급 2,400 → +20%.
 */
export function planBonusPct(monthlyPrice: number, credits: number): number {
  const base = Math.floor((Number(monthlyPrice) || 0) / CREDIT_UNIT_PRICE);
  if (base <= 0) return 0;
  return Math.round(((Number(credits) || 0) / base - 1) * 100);
}
