/**
 * BatchModeGuideModal.tsx — Batch 처리 모드 가이드 모달 (D217+ 2026-05-25)
 *
 * Batch 처리 모드 = 옛 batch-ai.ts CT-38 (24시간 SLA + 50% 비용 절감).
 * 회사 admin이 언제 Batch 모드를 사용해야 하는지 안내.
 *
 * 모델명 UI 노출 0건 — "Batch 처리 모드" / "고급 추론" 추상 명칭만 사용.
 */

import { useEffect } from 'react';
import { X, Layers, Clock, TrendingDown, Zap, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface UseCase {
  icon: typeof Zap;
  label: string;
  gradient: string;
  scenario: string;
  realtime: string;
  batch: string;
  recommend: 'realtime' | 'batch';
}

const USE_CASES: UseCase[] = [
  {
    icon: Zap,
    label: '실시간 캠페인 메시지 생성',
    gradient: 'from-rose-400 to-pink-500',
    scenario: '회사 admin이 캠페인 화면에서 "메시지 생성" 버튼 클릭',
    realtime: '5~10초 즉시 응답',
    batch: '최대 24시간 후 응답',
    recommend: 'realtime',
  },
  {
    icon: Clock,
    label: '대량 자율 분석 (500건+)',
    gradient: 'from-emerald-400 to-teal-500',
    scenario: '회사 전체 고객 500명+ 개별 메시지 일괄 생성',
    realtime: '500회 호출 × 평균 0.5원 = 250원 + 5분+ 소요',
    batch: '500회 일괄 처리 × 0.25원 = 125원 + 24시간 SLA (50% 절감)',
    recommend: 'batch',
  },
  {
    icon: Layers,
    label: '여정 단계별 사전 생성',
    gradient: 'from-violet-400 to-purple-500',
    scenario: '여정 6단계 × 50명 × 다양한 톤 사전 생성',
    realtime: '300회 호출 즉시: 한도 빠른 소진',
    batch: '300회 야간 일괄: 다음 날 활용',
    recommend: 'batch',
  },
  {
    icon: TrendingDown,
    label: '월별 정기 리포트 분석',
    gradient: 'from-sky-400 to-cyan-500',
    scenario: '매월 말 전체 캠페인 성과 자율 분석',
    realtime: '즉시 결과 필요 시 적합',
    batch: '리포트 생성 = 다음 날 발송: Batch 적합',
    recommend: 'batch',
  },
];

export default function BatchModeGuideModal({ open, onClose }: Props) {
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
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white">Batch 처리 모드 가이드</h3>
            <p className="text-xs text-white/50 mt-0.5">24시간 SLA + 50% 비용 절감. 언제 사용하면 좋은가요?</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 핵심 비교 */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="p-4 bg-gradient-to-br from-rose-500/15 to-pink-500/10 border border-rose-400/30 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-rose-300" />
                <span className="text-sm font-semibold text-white">실시간 처리</span>
              </div>
              <ul className="text-xs text-white/70 space-y-1">
                <li>· 즉시 응답 (5~10초)</li>
                <li>· 회사 admin 화면 인터랙션</li>
                <li>· 기본 단가 적용</li>
                <li>· 한도 빠르게 소진</li>
              </ul>
            </div>
            <div className="p-4 bg-gradient-to-br from-emerald-500/15 to-teal-500/10 border border-emerald-400/30 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-4 h-4 text-emerald-300" />
                <span className="text-sm font-semibold text-white">Batch 처리</span>
              </div>
              <ul className="text-xs text-white/70 space-y-1">
                <li>· 24시간 SLA 처리</li>
                <li>· 대량 일괄 작업</li>
                <li>· <strong className="text-emerald-300">50% 비용 절감</strong></li>
                <li>· 한도 절감 효과</li>
              </ul>
            </div>
          </div>

          {/* 시나리오별 추천 */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">시나리오별 권장 매트릭스</h4>
            <div className="space-y-2">
              {USE_CASES.map((u, i) => {
                const Icon = u.icon;
                const isBatch = u.recommend === 'batch';
                return (
                  <div key={i} className="p-3 bg-white/5 border border-white/10 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${u.gradient} flex items-center justify-center flex-shrink-0`}>
                        <Icon className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-semibold text-white">{u.label}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            isBatch ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
                          }`}>
                            {isBatch ? 'Batch 권장' : '실시간 권장'}
                          </span>
                        </div>
                        <div className="text-[11px] text-white/60 mb-1.5 italic">{u.scenario}</div>
                        <div className="grid md:grid-cols-2 gap-2 text-[11px]">
                          <div className="p-2 bg-rose-500/10 border border-rose-400/20 rounded">
                            <div className="text-rose-300 font-medium mb-0.5 flex items-center gap-1">
                              <Zap className="w-2.5 h-2.5" />
                              실시간
                            </div>
                            <div className="text-white/70">{u.realtime}</div>
                          </div>
                          <div className="p-2 bg-emerald-500/10 border border-emerald-400/20 rounded">
                            <div className="text-emerald-300 font-medium mb-0.5 flex items-center gap-1">
                              <Layers className="w-2.5 h-2.5" />
                              Batch
                            </div>
                            <div className="text-white/70">{u.batch}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 사용 흐름 */}
          <div className="p-4 bg-gradient-to-br from-violet-500/15 via-purple-500/10 to-indigo-500/15 border border-violet-400/30 rounded-xl">
            <div className="text-sm font-semibold text-violet-100 mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-violet-300" />
              Batch 처리 모드 활성화 흐름
            </div>
            <ol className="text-xs text-white/80 space-y-1.5 list-decimal list-inside pl-1">
              <li>대량 작업이 필요한 메뉴 (캠페인 일괄 / 여정 사전 / 월별 리포트) 진입</li>
              <li>"Batch 처리 모드" 옵션 선택. 자동으로 일괄 큐에 등록</li>
              <li>24시간 이내 완료 알림 수신 (회사 admin 이메일 + 앱 알림)</li>
              <li>결과는 옛 메뉴 결과 화면에서 확인 가능</li>
            </ol>
          </div>

          {/* 주의 사항 */}
          <div className="p-3 bg-amber-500/10 border border-amber-400/30 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-white/70 leading-relaxed">
              <strong className="text-amber-200">주의:</strong> Batch 모드는 24시간 SLA 이므로, 당일 발송이 필요한 캠페인에는 적합하지 않습니다.
              실시간 인터랙션이 필요한 메뉴 (메시지 다듬기 / 자율 진단 카드)에는 실시간 처리가 자동 적용됩니다.
            </div>
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
