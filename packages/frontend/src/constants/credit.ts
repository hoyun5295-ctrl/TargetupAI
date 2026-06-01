import { Sparkles, Route, Smartphone, Layers, PenLine, Wand2, type LucideIcon } from 'lucide-react';

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
 * 작업당 AI 크레딧 단가 — 백엔드 CREDIT_COST_MAP 기준.
 *  orchestrate 20(풀분석) · journey 10(여정) · dm-builder 5(모바일 DM)
 *  · 생성 3(인앱·CDP) · 문안·분석 2 · 다듬기·질문·매핑 1. 스팸필터 테스트는 비대상(0, 미표기).
 */
export const CREDIT_TASK_COSTS: CreditTaskCost[] = [
  { key: 'full', label: '풀분석', cost: 20, icon: Sparkles },
  { key: 'journey', label: '여정 설계', cost: 10, icon: Route },
  { key: 'dm', label: '모바일 DM', cost: 5, icon: Smartphone },
  { key: 'inapp', label: '인앱·생성', cost: 3, icon: Layers },
  { key: 'copy', label: '문안·분석', cost: 2, icon: PenLine },
  { key: 'refine', label: '다듬기·질문', cost: 1, icon: Wand2 },
];

/**
 * 크레딧 → 대표 작업 환산 횟수. 실제 단가(풀분석 20·DM 5·문안 2)로만 계산 — 임의 상수 없음.
 * "1,000 크레딧"이 막연하지 않게 "풀분석 50회"처럼 손에 잡히는 양으로 보여주는 용도.
 */
export function creditConversions(credits: number) {
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  return {
    fullAnalysis: Math.floor(c / 20),
    dm: Math.floor(c / 5),
    copy: Math.floor(c / 2),
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
