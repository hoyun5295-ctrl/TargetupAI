/**
 * ★ PlanUpgradeModal — 요금제 업그레이드 안내 모달
 *
 * D220+ Task 8 (2026-05-27 강화): 다크 톤 + violet/fuchsia 액센트 + 기능별 가치 카드
 *   Harold 명시 본질 = "메뉴는 잠궈놓되 어떤 기능인지 예쁘게 모달로 안내 + 구매욕구 자극"
 *
 * 활용 영역 (호출 위치 기존 4건):
 *   - 세그먼트 메뉴 (BASIC+ — ai_messaging)
 *   - AI 추천 발송 (BASIC+ — ai_messaging)
 *   - 직접 타겟 발송 (STARTER+ — customer_db)
 *   - 고객 DB 업로드 (STARTER+ — customer_db)
 *
 * 영구 룰 정합 (D215+ design_quality_minimum_journey_level):
 *   - 다크 톤 (bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl)
 *   - 헤더 = violet → fuchsia 그라데이션 + 자물쇠 아이콘
 *   - 본문 = 기능 안내 + 가치 카드 3건 (구매욕구 자극)
 *   - CTA = 요금제 보기 (violet 그라데이션) + 닫기
 */

import { useNavigate } from 'react-router-dom';
import { Lock, Sparkles, X, ArrowRight, Check, Zap, BarChart3, Target, ShieldCheck } from 'lucide-react';

interface PlanUpgradeModalProps {
  show: boolean;
  onClose: () => void;
  // D53: 범용화 — 잠긴 기능명 + 필요 요금제 (기본값: AI 문구 추천 / 스타터)
  featureName?: string;
  requiredPlan?: string;
}

// ★ Task 8: 기능별 가치 카드 매핑 — 구매욕구 자극 영업 멘트
const FEATURE_VALUE_MAP: Record<string, { icon: typeof Sparkles; description: string; benefits: string[] }> = {
  '고객 세그먼트': {
    icon: Target,
    description: '자연어 한 줄로 정확한 고객 그룹을 추출하고 발송 흐름에서 재활용하세요.',
    benefits: [
      '자연어 입력 → AI가 검증된 필터로 자동 변환',
      '매칭 인원 + 샘플 5건 즉시 확인 (단 1의 오차 X)',
      '저장한 세그먼트를 모든 발송 흐름에서 재사용',
    ],
  },
  'AI 추천 발송': {
    icon: Sparkles,
    description: '회사 데이터를 학습한 AI가 타겟·문구·시점을 자동 추천합니다.',
    benefits: [
      '회사별 30일 발송 패턴 학습으로 정확도 매일 향상',
      '타겟·메시지·발송 시점 한 번에 자동 추천',
      'A/B 테스트 + 광고 합성 미리보기 통합',
    ],
  },
  'AI 문구 추천': {
    icon: Sparkles,
    description: '몇 단어만 입력하면 마케팅 효과가 검증된 문구로 자동 변환합니다.',
    benefits: [
      '봄 신상품, VIP 감사 이벤트 등 자연어 → 풍성한 카피',
      'SMS/LMS 길이 자동 조정 + 광고 규정 자동 적용',
      '회사 톤앤매너 학습 (시간 지날수록 정확도 ↑)',
    ],
  },
  '직접 타겟 발송': {
    icon: Target,
    description: '필터 조건으로 고객을 정밀하게 추출해 단건 발송할 수 있습니다.',
    benefits: [
      '20+ 필드 조합으로 원하는 고객만 골라 발송',
      '발송 직전 매칭 인원 + 샘플 미리 확인',
      '연령 / 지역 / 구매 이력 / 등급 등 정밀 필터',
    ],
  },
  '고객 DB 업로드': {
    icon: BarChart3,
    description: '엑셀 · CSV로 고객 데이터를 한 번에 등록하고 관리할 수 있습니다.',
    benefits: [
      '엑셀 / CSV 파일 일괄 업로드 (수만 건 처리)',
      'AI 자동 컬럼 매핑 (수동 매핑 30+ 클릭 폐기)',
      '사용자 정의 필드 자유 추가 + 검색 / 필터',
    ],
  },
  // ★ 2026-07-04 직접발송 보조 기능 잠금 통일 (기존 SpamFilterLockModal·AiRefineLockedModal 대체)
  'AI 문안 다듬기': {
    icon: Sparkles,
    description: '직접 쓴 메시지를 톤·길이·이모지·스팸 회피까지 한 번에 정리합니다.',
    benefits: [
      '회사 30일 발송 패턴 학습 → 우리 톤으로 자동 정리',
      'SMS/LMS 길이 자동 조정 + 광고 규정 자동 적용',
      '스팸 유발 표현 자동 회피로 전달률 향상',
    ],
  },
  '스팸필터 테스트': {
    icon: ShieldCheck,
    description: 'SKT · KT · LG U+ 3사의 실제 스팸 차단 여부를 발송 전에 미리 확인합니다.',
    benefits: [
      '통신사 3사 실제 스팸 판정 사전 확인',
      '차단 위험 문구를 발송 전에 교정',
      'AI 다듬기와 연동해 안전한 문안으로 발송',
    ],
  },
};

export default function PlanUpgradeModal({ show, onClose, featureName, requiredPlan }: PlanUpgradeModalProps) {
  const navigate = useNavigate();

  if (!show) return null;

  const displayFeature = featureName || 'AI 문구 추천';
  const displayPlan = requiredPlan || '스타터';

  const config = FEATURE_VALUE_MAP[displayFeature] || FEATURE_VALUE_MAP['AI 문구 추천'];
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        {/* 헤더 — violet → fuchsia 그라데이션 + 자물쇠 아이콘 */}
        <div className="relative bg-gradient-to-br from-violet-600 via-fuchsia-600 to-indigo-600 px-6 pt-6 pb-5">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="relative w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <Icon className="w-6 h-6 text-white" />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center border-2 border-violet-600">
                <Lock className="w-2.5 h-2.5 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base md:text-lg font-bold text-white">{displayFeature}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/25 text-white border border-white/30 font-bold">
                  {displayPlan}+
                </span>
              </div>
              <p className="text-[12px] text-white/85 leading-relaxed">{config.description}</p>
            </div>
          </div>
        </div>

        {/* 본문 — 가치 카드 3건 */}
        <div className="px-5 py-5 space-y-2.5">
          <p className="text-[11px] text-white/50 font-medium uppercase tracking-wider mb-3">이 기능으로 할 수 있는 것</p>
          {config.benefits.map((benefit, idx) => (
            <div key={idx} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-3 h-3 text-white" strokeWidth={3} />
              </div>
              <p className="text-[13px] text-white/80 leading-relaxed flex-1">{benefit}</p>
            </div>
          ))}
        </div>

        {/* 가치 강조 영역 */}
        <div className="mx-5 mb-5 rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 p-3 flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-amber-300 flex-shrink-0" />
          <p className="text-[11px] text-violet-100 leading-relaxed">
            <span className="font-semibold text-violet-50">{displayPlan} 이상</span> 요금제로 업그레이드하면 즉시 사용할 수 있어요.
          </p>
        </div>

        {/* CTA */}
        <div className="px-5 pb-5 space-y-2">
          <button
            onClick={() => { onClose(); navigate('/pricing'); }}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white font-semibold py-3 rounded-xl text-sm transition-all shadow-lg shadow-violet-500/20"
          >
            요금제 보기
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            나중에 보기
          </button>
        </div>
      </div>
    </div>
  );
}
