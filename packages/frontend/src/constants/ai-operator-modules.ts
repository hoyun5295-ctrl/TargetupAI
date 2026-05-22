/**
 * ai-operator-modules.ts — AI Operator sub-module 카드 매트릭스 (D210+ 2026-05-23)
 *
 * AiOperatorPage 카드 + AiOperatorWalkthroughModal STEP 6 메뉴 매트릭스 공통 사용.
 * no_inline_duplication 룰 정합 — 단일 source of truth.
 *
 * ★ D210+ Phase 1 (Harold 명시 2026-05-23): AiOperatorWalkthroughModal STEP 6 메뉴 매트릭스 추가 의무로
 *   AiOperatorPage 인라인 정의를 constants/ 모듈로 추출 — 사용처 2곳 공통 import.
 */

import {
  Activity,
  Brain,
  LineChart,
  Mail,
  MessageSquare,
  Smartphone,
  Target,
  Workflow,
} from 'lucide-react';

export interface SubModuleCard {
  icon: typeof Target;
  gradient: string;
  label: string;
  description: string;
  path: string;
  adminOnly?: boolean;
}

// ★ D209+ (Harold 명시 2026-05-22): 모든 description 1줄 일관 매트릭스 — 영구운영 ("매일 AI 캠페인 자동 제안" 12자) 기준.
//   카드 높이 정합성 의무 — AI 영역 신뢰 (정합 X = 사용자 의구심).
// ★ D210+ (Harold 명시 2026-05-23): constants/ 모듈 추출 — AiOperatorPage + AiOperatorWalkthroughModal STEP 6 공통 사용.
export const SUB_MODULE_CARDS: SubModuleCard[] = [
  { icon: Workflow,     gradient: 'from-fuchsia-400 to-purple-500', label: '여정 자동화',    description: 'AI 여정 7종 자동 설계',          path: '/ai-journeys' },
  { icon: Brain,        gradient: 'from-violet-400 to-fuchsia-500', label: 'AI 자율 예측',   description: '이탈·구매 AI 자동 예측',         path: '/predictive' },
  { icon: Brain,        gradient: 'from-indigo-400 to-violet-500',  label: 'AI 영구운영',    description: '매일 AI 캠페인 자동 제안',       path: '/continuous-operator' },
  { icon: LineChart,    gradient: 'from-fuchsia-400 to-pink-500',   label: '성과리포트',     description: '30일 성과 + 다음 추천',          path: '/performance' },
  { icon: Workflow,     gradient: 'from-emerald-400 to-teal-500',   label: '자사몰 연동',    description: '카페24·네이버 자동 연동',        path: '/cdp-settings' },
  { icon: MessageSquare,gradient: 'from-rose-400 to-pink-500',      label: '인앱메시지',     description: '자사몰 배너·모달 자동 표시',     path: '/inapp-messages',   adminOnly: true },
  { icon: Mail,         gradient: 'from-blue-400 to-cyan-500',      label: 'Email 캠페인',   description: '이메일 자동 발송 + 트래킹',      path: '/email-campaigns',  adminOnly: true },
  { icon: Smartphone,   gradient: 'from-amber-400 to-yellow-500',   label: '모바일 DM',      description: '카드형 미디어 메시지 빌더',      path: '/dm-builder' },
  { icon: Brain,        gradient: 'from-emerald-400 to-teal-500',   label: 'AI 메모리',      description: '회사별 누적 학습 정확도↑',       path: '/ai-memory' },
  { icon: Activity,     gradient: 'from-blue-400 to-sky-500',       label: 'AI 사용량',      description: '월 한도 + 일별 통계 진단',       path: '/ai-usage' },
];
