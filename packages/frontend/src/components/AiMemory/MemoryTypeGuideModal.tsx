/**
 * MemoryTypeGuideModal.tsx — 5 메모리 타입 상세 가이드 모달 (D217+ 2026-05-25)
 *
 * 회사 admin이 "어떤 메모리 타입을 직접 입력해야 하나요?" 의문 해소.
 * 각 타입별 = label + 설명 + 자동/직접 분류 + 예시 3건 + 학습 흐름 한 줄.
 */

import { useEffect } from 'react';
import { X, Sparkles, Brain } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface TypeGuide {
  type: string;
  label: string;
  gradient: string;
  description: string;
  addable: 'auto' | 'admin' | 'both';
  flow: string;
  examples: string[];
}

const GUIDES: TypeGuide[] = [
  {
    type: 'success_pattern',
    label: '성공 패턴',
    gradient: 'from-emerald-400 to-teal-500',
    description: '클릭률 / 전환율 높은 캠페인의 채널·시점·타겟 조합을 기록합니다.',
    addable: 'auto',
    flow: '캠페인 발송 종료 후 클릭률 10% 이상 자동 누적',
    examples: [
      'VIP 화요일 오후 2시 알림톡 → 클릭률 18.4% (320명 발송)',
      '휴면 90일+ 고객 LMS → 클릭률 12.7% (180명 발송)',
      '신규 가입 첫날 SMS → 전환율 8.2% (240명 발송)',
    ],
  },
  {
    type: 'channel_performance',
    label: '채널 성과',
    gradient: 'from-amber-400 to-orange-500',
    description: '채널별 평균 클릭/전환을 누적합니다 (SMS vs LMS vs 알림톡).',
    addable: 'auto',
    flow: '캠페인 종료 후 채널별 통계 자동 누적',
    examples: [
      'LMS 평균 클릭률 7.4% > SMS 평균 5.2% (지난 30일)',
      '알림톡 발송 → SMS 폴백 전환율 11.3%',
      'MMS 평균 클릭률 9.8% (이미지 첨부 효과)',
    ],
  },
  {
    type: 'customer_insight',
    label: '고객 인사이트',
    gradient: 'from-sky-400 to-cyan-500',
    description: '특정 고객군의 행동·선호·반응 패턴을 기록합니다. 자동 + 직접 둘 다 가능.',
    addable: 'both',
    flow: '회사 admin 직접 입력 권장 + 캠페인 결과 자동 학습',
    examples: [
      '3개월 휴면 고객은 무료 배송 안내에 강한 반응',
      'VIP 등급 고객은 한정판 신상 출시 알림 선호',
      '신규 가입 7일 이내 고객은 첫 구매 쿠폰 미사용률 높음',
    ],
  },
  {
    type: 'brand_tone_evolution',
    label: '브랜드 톤 진화',
    gradient: 'from-violet-400 to-purple-500',
    description: '시간에 따른 브랜드 톤 변화를 기록합니다 (이모지 사용 / 존댓말 / 친근도).',
    addable: 'admin',
    flow: '회사 admin 직접 입력 의무 (자동 학습 데이터 부족)',
    examples: [
      '이모지 사용 자제 — 전문성 우선 (2026-Q1 정책)',
      '"고객님" 호칭 통일 (옛 "회원님" 사용 X)',
      '느낌표 1개 이내 — 차분한 톤 유지',
    ],
  },
  {
    type: 'compliance_learning',
    label: '컴플라이언스 학습',
    gradient: 'from-rose-400 to-pink-500',
    description: '광고 차단 / 반려 사유 패턴 + 안전 대체 단어 매핑을 기록합니다.',
    addable: 'both',
    flow: '회사 admin 직접 입력 권장 + 카카오 반려 자동 학습',
    examples: [
      '"특가" 단어 광고 차단 6건 — "한정 혜택"으로 대체',
      '"긴급" 단어 카카오 반려 — "신규 안내"로 대체',
      '회신번호 누락 시 자동 080 무료 회신 추가 필수',
    ],
  },
];

const ADDABLE_BADGE: Record<TypeGuide['addable'], { label: string; bg: string; text: string }> = {
  auto:  { label: '자동 누적',     bg: 'bg-emerald-500/20', text: 'text-emerald-200' },
  admin: { label: '직접 입력 의무', bg: 'bg-blue-500/20',    text: 'text-blue-200' },
  both:  { label: '자동 + 직접',   bg: 'bg-violet-500/20',  text: 'text-violet-200' },
};

export default function MemoryTypeGuideModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white">5 메모리 타입 가이드</h3>
            <p className="text-xs text-white/50 mt-0.5">어떤 학습이 자동으로 쌓이고, 어떤 학습을 직접 입력해야 하는지 안내</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {GUIDES.map((g) => {
            const addableMeta = ADDABLE_BADGE[g.addable];
            return (
              <div key={g.type} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className={`p-4 bg-gradient-to-r ${g.gradient}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">{g.label}</div>
                      <div className="text-xs text-white/90 mt-0.5">{g.description}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${addableMeta.bg} ${addableMeta.text}`}>
                      {addableMeta.label}
                    </span>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-start gap-2 text-xs">
                    <Brain className="w-3.5 h-3.5 text-violet-300 flex-shrink-0 mt-0.5" />
                    <span className="text-white/70">{g.flow}</span>
                  </div>
                  <div className="pt-2 border-t border-white/5">
                    <div className="text-[11px] text-white/40 mb-1.5 font-medium">학습 예시</div>
                    <ul className="space-y-1">
                      {g.examples.map((ex, i) => (
                        <li key={i} className="text-xs text-white/60 flex items-start gap-2">
                          <span className="text-white/30">·</span>
                          <span className="flex-1">{ex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="p-4 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-pink-500/15 border border-violet-400/30 rounded-xl">
            <div className="text-sm font-semibold text-violet-100 mb-1">왜 학습 메모리가 중요한가요?</div>
            <p className="text-xs text-white/80 leading-relaxed">
              AI는 메시지 생성, 캠페인 추천, 자율 진단 시 회사 메모리를 시스템 프롬프트에 자동 포함합니다.
              누적 학습이 많을수록 회사 고유 톤과 고객 특성을 더 정확히 반영하므로, 시간이 지날수록 추천 정확도가 향상됩니다.
              회사 admin이 직접 입력한 학습은 자동 학습보다 중요도를 높게 설정하여 우선 참고됩니다.
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-sm border-t border-white/10 px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-violet-500/40 hover:bg-violet-500/60 text-violet-50 text-sm rounded-lg font-medium"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
