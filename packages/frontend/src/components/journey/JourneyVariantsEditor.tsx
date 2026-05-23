/**
 * ★ D189 #1 (2026-05-22): JourneyVariantsEditor — Journey Step A/B/C 테스트 + Bandit 자동 최적화
 *
 * 영역 정합:
 *   - bandit-optimizer.ts JourneyStepVariant interface 정합 (CT-31)
 *   - routes/ai.ts variants 4 endpoint 정합 (GET list / POST UPSERT / DELETE / POST track)
 *   - Thompson Sampling Beta-Bernoulli 학습 (cold start < 3회 explore / active ≥ 3회)
 *
 * 영구 원칙:
 *   - feedback_ai_no_arbitrary_benefit — AI 임의 혜택 작성 금지, 회사 admin 직접 작성
 *   - 활성 여정 (status='active') = 모든 input disabled + 안내 노출
 *   - 회사 격리 — endpoint 측에서 companyId 검증 (Frontend는 단순 호출)
 *
 * UI 매트릭스:
 *   - A/B/C 탭 (최대 3 variants, 신규 variant 버튼 < 3 시만 노출)
 *   - 각 variant: channel + traffic_weight + 메시지 본문 (channel 별 분기)
 *   - Bandit 통계 카드: 발송 / 클릭 / 전환 / 평균 클릭률 (posteriorMean)
 *   - 학습 단계 안내 (cold start / active)
 */

import { useState, useEffect, useCallback } from 'react';
import { Beaker, Plus, Trash2, Save, Loader2, X, BarChart3, Info, Trophy, Activity, MousePointerClick, ShoppingCart, Sparkles, AlertTriangle } from 'lucide-react';

type ChannelType = 'sms' | 'lms' | 'mms' | 'kakao';

export interface JourneyStepVariant {
  id: string;
  stepId: string;
  variantId: string;
  messageTemplate: string | null;
  subject: string | null;
  channel: string | null;
  alimtalkTemplateCode: string | null;
  alimtalkVariableMap: Record<string, string> | null;
  trafficWeight: number;
  banditAlpha: number;
  banditBeta: number;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
}

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): winner 자동 선언 매트릭스 (backend declareVariantWinner 응답 정합)
interface VariantWinnerDeclaration {
  winnerVariantId: string | null;
  winnerConfidence: number;
  recommendedTrafficWeights: Record<string, number>;
  totalTrials: number;
  variantProbabilities: Record<string, number>;
  reasoning: string;
  status: 'cold_start' | 'low_confidence' | 'leading' | 'winner';
}

// ★ D211+ Phase 1 (2026-05-23 Harold 명시): Beta-Bernoulli 95% 신뢰 구간 (backend computeVariantsCI 응답 정합)
interface BetaCredibleInterval {
  mean: number;
  stddev: number;
  lower95: number;
  upper95: number;
  intervalWidth: number;
}

interface VariantCI {
  variantId: string;
  ci: BetaCredibleInterval;
}

interface Props {
  stepId: string;
  journeyId: string;
  journeyStatus: 'draft' | 'active' | 'paused';
  defaultChannel: ChannelType;
  defaultMessageTemplate: string;
  defaultSubject?: string;
  onClose?: () => void;
}

const VARIANT_IDS = ['A', 'B', 'C'];

function nextVariantId(existing: JourneyStepVariant[]): string {
  for (const id of VARIANT_IDS) {
    if (!existing.find((v) => v.variantId === id)) return id;
  }
  return 'A';
}

function fetchHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function JourneyVariantsEditor({
  stepId,
  journeyId,
  journeyStatus,
  defaultChannel,
  defaultMessageTemplate,
  defaultSubject,
  onClose,
}: Props) {
  const [variants, setVariants] = useState<JourneyStepVariant[]>([]);
  const [winnerDeclaration, setWinnerDeclaration] = useState<VariantWinnerDeclaration | null>(null);
  // ★ D211+ Phase 1 (2026-05-23 Harold 명시): variantsCI state — Beta 95% 신뢰 구간 시각화 영역
  const [variantsCI, setVariantsCI] = useState<VariantCI[]>([]);
  // ★ D211+ Phase A 3번 (2026-05-23 Harold 명시): AI 자동 생성 영역 (3 톤 — 감성/실용/캐주얼)
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [generatedVariants, setGeneratedVariants] = useState<Array<{ tone: string; messageTemplate: string; byteCount: number; reasoning: string }>>([]);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  // ★ D211+ Phase A-fix (2026-05-23 Harold 명시): native confirm 영구 폐기 — 인라인 confirm card 영역
  const [pendingDelete, setPendingDelete] = useState<JourneyStepVariant | null>(null);
  const [pendingTrafficApply, setPendingTrafficApply] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('A');

  const isReadOnly = journeyStatus === 'active';

  const loadVariants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/operator/journeys/${journeyId}/steps/${stepId}/variants`,
        { headers: fetchHeaders() },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'variants 조회 실패');
      }
      const loaded: JourneyStepVariant[] = data.variants || [];
      setVariants(loaded);
      // ★ D210+ Phase 3 (2026-05-23 Harold 명시): winner 자동 선언 매트릭스 응답 통합
      setWinnerDeclaration(data.winnerDeclaration || null);
      // ★ D211+ Phase 1 (2026-05-23 Harold 명시): Beta 95% 신뢰 구간 응답 통합
      setVariantsCI(data.variantsCI || []);
      if (loaded.length > 0) {
        setActiveTab(loaded[0].variantId);
      }
    } catch (err: any) {
      setError(err?.message || '조회 실패');
    } finally {
      setLoading(false);
    }
  }, [journeyId, stepId]);

  useEffect(() => {
    loadVariants();
  }, [loadVariants]);

  const handleAddVariant = async () => {
    if (variants.length >= 3 || isReadOnly) return;
    const newId = nextVariantId(variants);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/operator/journeys/${journeyId}/steps/${stepId}/variants`,
        {
          method: 'POST',
          headers: fetchHeaders(),
          body: JSON.stringify({
            variantId: newId,
            messageTemplate: defaultMessageTemplate,
            subject: defaultSubject,
            channel: defaultChannel,
            trafficWeight: 1 / (variants.length + 1),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'variant 생성 실패');
      }
      await loadVariants();
      setActiveTab(newId);
    } catch (err: any) {
      setError(err?.message || '생성 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateVariant = (variant: JourneyStepVariant, patch: Partial<JourneyStepVariant>) => {
    if (isReadOnly) return;
    setVariants((prev) => prev.map((v) => (v.id === variant.id ? { ...v, ...patch } : v)));
  };

  const handleSaveVariant = async (variant: JourneyStepVariant) => {
    if (isReadOnly) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/operator/journeys/${journeyId}/steps/${stepId}/variants`,
        {
          method: 'POST',
          headers: fetchHeaders(),
          body: JSON.stringify({
            variantId: variant.variantId,
            messageTemplate: variant.messageTemplate,
            subject: variant.subject,
            channel: variant.channel,
            alimtalkTemplateCode: variant.alimtalkTemplateCode,
            alimtalkVariableMap: variant.alimtalkVariableMap,
            trafficWeight: variant.trafficWeight,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '저장 실패');
      }
      await loadVariants();
    } catch (err: any) {
      setError(err?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  // ★ D211+ Phase A 3번 (2026-05-23 Harold 명시): AI 자동 생성 호출
  const handleAutoGenerate = async () => {
    if (isReadOnly) return;
    if (!defaultMessageTemplate || defaultMessageTemplate.trim().length < 10) {
      setError('base 메시지 영역 10자 이상 의무 — step 본문 영역 먼저 작성해주세요.');
      return;
    }
    setAutoGenerating(true);
    setGeneratedVariants([]);
    setGenerationWarnings([]);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/operator/journeys/steps/${stepId}/variants/auto-generate`,
        {
          method: 'POST',
          headers: fetchHeaders(),
          body: JSON.stringify({
            baseMessage: defaultMessageTemplate,
            channel: defaultChannel,
            subject: defaultSubject,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'AI 자동 생성 실패');
      }
      setGeneratedVariants(data.variants || []);
      setGenerationWarnings(data.warnings || []);
    } catch (err: any) {
      setError(err?.message || 'AI 자동 생성 영역 오류');
    } finally {
      setAutoGenerating(false);
    }
  };

  // ★ D211+ Phase A 3번 (2026-05-23 Harold 명시): 생성된 variant 영역 명시 적용 (회사 admin 명시 선택)
  const handleApplyGenerated = async (gen: { tone: string; messageTemplate: string }) => {
    if (isReadOnly) return;
    const newId = nextVariantId(variants);
    setSaving(true);
    try {
      const res = await fetch(
        `/api/ai/operator/journeys/${journeyId}/steps/${stepId}/variants`,
        {
          method: 'POST',
          headers: fetchHeaders(),
          body: JSON.stringify({
            variantId: newId,
            messageTemplate: gen.messageTemplate,
            subject: defaultSubject,
            channel: defaultChannel,
            trafficWeight: 1 / (variants.length + 1),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'variant 적용 실패');
      }
      await loadVariants();
      setActiveTab(newId);
      // 적용된 영역 = 생성 리스트 영역 안에서 제거
      setGeneratedVariants((prev) => prev.filter((g) => g.messageTemplate !== gen.messageTemplate));
    } catch (err: any) {
      setError(err?.message || 'variant 적용 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVariant = async (variant: JourneyStepVariant) => {
    if (isReadOnly) return;
    // ★ D211+ Phase A-fix (2026-05-23 Harold 명시): native confirm 폐기 — pendingDelete state 영역 인라인 confirm 정합
    setPendingDelete(variant);
  };

  const executeDeleteVariant = async (variant: JourneyStepVariant) => {
    setPendingDelete(null);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/operator/journeys/variants/${variant.id}`,
        { method: 'DELETE', headers: fetchHeaders() },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '삭제 실패');
      }
      const remaining = variants.filter((v) => v.id !== variant.id);
      await loadVariants();
      if (remaining.length > 0 && activeTab === variant.variantId) {
        setActiveTab(remaining[0].variantId);
      }
    } catch (err: any) {
      setError(err?.message || '삭제 실패');
    } finally {
      setSaving(false);
    }
  };

  const activeVariant = variants.find((v) => v.variantId === activeTab) || null;
  const trafficSum = variants.reduce((sum, v) => sum + v.trafficWeight, 0);
  const channelOfActive = (activeVariant?.channel || defaultChannel) as ChannelType;

  return (
    <div className="border-2 border-violet-500/30 rounded-xl bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Beaker className="w-4 h-4 text-violet-300" />
        <h4 className="text-sm font-semibold text-violet-200">A/B 테스트 (Bandit 자동 최적화)</h4>
        {onClose && (
          <button onClick={onClose} className="ml-auto p-1 hover:bg-white/10 rounded" title="닫기">
            <X className="w-3.5 h-3.5 text-white/50" />
          </button>
        )}
      </div>

      <div className="text-[11px] text-violet-200/60 leading-relaxed">
        Variant A/B/C에 다른 메시지를 작성하면 Thompson Sampling이 누적 발송 결과(클릭/전환)를 학습하여 자동으로 최선의 variant를 선택합니다.
        <br />
        <span className="text-amber-300/70">AI 임의 혜택 작성 금지 — 회사 admin이 직접 작성 (영구 룰).</span>
      </div>

      {/* ★ D211+ Phase A 3번 (2026-05-23 Harold 명시): AI 자동 생성 영역 — 3 톤 (감성/실용/캐주얼) */}
      {!isReadOnly && variants.length < 3 && (
        <div className="p-2.5 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-400/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-300" />
            <span className="text-[11px] font-semibold text-violet-100">AI 자동 생성 — 3 톤 다양화</span>
            <button
              onClick={handleAutoGenerate}
              disabled={autoGenerating || !defaultMessageTemplate || defaultMessageTemplate.trim().length < 10}
              className="ml-auto px-2.5 py-1 bg-violet-500/30 hover:bg-violet-500/50 disabled:opacity-30 text-violet-100 rounded text-[10px] flex items-center gap-1 transition-colors"
            >
              {autoGenerating ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> 생성 중</>
              ) : (
                <><Sparkles className="w-3 h-3" /> 자동 생성</>
              )}
            </button>
          </div>
          <div className="text-[10px] text-white/50 leading-relaxed">
            base 메시지 기준으로 감성적 · 실용적 · 캐주얼 3 톤 자동 생성 (혜택 영역 보존 / 인사·안내·마무리만 톤 다양화).
          </div>

          {/* 생성된 variant 목록 (회사 admin 명시 적용 의무) */}
          {generatedVariants.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {generatedVariants.map((gen, idx) => (
                <div key={idx} className="p-2 bg-slate-900 border border-white/10 rounded">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-100 font-medium">{gen.tone}</span>
                    <span className="text-[9px] text-white/40 font-mono">{gen.byteCount}바이트</span>
                    <button
                      onClick={() => handleApplyGenerated(gen)}
                      disabled={saving}
                      className="ml-auto px-2 py-0.5 bg-emerald-500/30 hover:bg-emerald-500/50 disabled:opacity-30 text-emerald-100 rounded text-[10px] flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-2.5 h-2.5" /> 적용
                    </button>
                  </div>
                  <div className="text-[10px] text-white/80 whitespace-pre-wrap leading-relaxed mb-1">{gen.messageTemplate}</div>
                  {gen.reasoning && (
                    <div className="text-[9px] text-white/40 italic">{gen.reasoning}</div>
                  )}
                </div>
              ))}
              <div className="text-[9px] text-amber-200/60 italic">
                회사 admin 명시 검토 + "적용" 클릭 의무 — 자동 저장 X.
              </div>
            </div>
          )}

          {/* 경고 영역 */}
          {generationWarnings.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {generationWarnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-1 text-[9px] text-amber-200/70">
                  <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isReadOnly && (
        <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-200">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          활성 여정의 variants는 수정 불가 — 먼저 일시정지 후 수정해주세요.
        </div>
      )}

      {error && (
        <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded text-[11px] text-rose-200">
          {error}
        </div>
      )}

      {/* ★ D210+ Phase 3 (2026-05-23 Harold 명시): winner 자동 선언 안내 카드 (회사 admin 명시 적용 의무 — 자동 변경 X) */}
      {winnerDeclaration && variants.length >= 2 && (
        <div className={`p-3 rounded-lg border ${
          winnerDeclaration.status === 'winner' ? 'bg-emerald-500/10 border-emerald-400/40' :
          winnerDeclaration.status === 'leading' ? 'bg-amber-500/10 border-amber-400/40' :
          'bg-white/5 border-white/10'
        }`}>
          <div className="flex items-start gap-2">
            <Trophy className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
              winnerDeclaration.status === 'winner' ? 'text-emerald-300' :
              winnerDeclaration.status === 'leading' ? 'text-amber-300' :
              'text-white/40'
            }`} />
            <div className="flex-1 text-[11px]">
              <div className={`font-semibold mb-1 ${
                winnerDeclaration.status === 'winner' ? 'text-emerald-200' :
                winnerDeclaration.status === 'leading' ? 'text-amber-200' :
                'text-white/70'
              }`}>
                {winnerDeclaration.status === 'winner' && '🏆 Winner 자동 선언'}
                {winnerDeclaration.status === 'leading' && '선두 영역 진입'}
                {winnerDeclaration.status === 'low_confidence' && '데이터 누적 영역'}
                {winnerDeclaration.status === 'cold_start' && '초기 탐색 영역'}
              </div>
              <div className="text-white/70 leading-relaxed mb-2">{winnerDeclaration.reasoning}</div>
              {Object.keys(winnerDeclaration.variantProbabilities).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-white/40">Variant별 winner 확률 (Monte Carlo 1,000회)</div>
                  {Object.entries(winnerDeclaration.variantProbabilities).map(([vid, prob]) => (
                    <div key={vid} className="flex items-center gap-2">
                      <div className="text-[10px] text-white/60 w-16">Variant {vid}</div>
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            vid === winnerDeclaration.winnerVariantId
                              ? winnerDeclaration.status === 'winner' ? 'bg-emerald-400' : 'bg-amber-400'
                              : 'bg-white/30'
                          }`}
                          style={{ width: `${prob * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-white/60 font-mono w-12 text-right">{(prob * 100).toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              )}
              {winnerDeclaration.winnerVariantId && !isReadOnly && !pendingTrafficApply && (
                <button
                  onClick={() => setPendingTrafficApply(true)}
                  className={`mt-2 px-3 py-1 rounded text-[11px] font-medium ${
                    winnerDeclaration.status === 'winner'
                      ? 'bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100'
                      : 'bg-amber-500/30 hover:bg-amber-500/50 text-amber-100'
                  }`}
                >
                  권장 traffic 적용 (회사 admin 명시 확인)
                </button>
              )}
              {/* ★ D211+ Phase A-fix (2026-05-23 Harold 명시): native confirm 폐기 — 인라인 confirm 카드 (권장 traffic 적용) */}
              {pendingTrafficApply && winnerDeclaration.winnerVariantId && (
                <div className="mt-2 p-2.5 bg-slate-950 border border-violet-400/40 rounded-lg">
                  <div className="text-[11px] text-white/80 mb-2 leading-relaxed">
                    Variant <span className="font-semibold text-violet-200">{winnerDeclaration.winnerVariantId}</span> 영역 권장 traffic 적용하시겠습니까?
                    <div className="mt-1 text-[10px] text-white/50">{winnerDeclaration.reasoning}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPendingTrafficApply(false)}
                      className="flex-1 px-2 py-1 bg-white/5 hover:bg-white/10 text-white/80 rounded text-[10px]"
                    >
                      취소
                    </button>
                    <button
                      onClick={async () => {
                        setPendingTrafficApply(false);
                        setSaving(true);
                        try {
                          for (const v of variants) {
                            const recommended = winnerDeclaration.recommendedTrafficWeights[v.variantId] ?? v.trafficWeight;
                            await fetch(
                              `/api/ai/operator/journeys/${journeyId}/steps/${stepId}/variants`,
                              {
                                method: 'POST',
                                headers: fetchHeaders(),
                                body: JSON.stringify({
                                  variantId: v.variantId,
                                  messageTemplate: v.messageTemplate,
                                  subject: v.subject,
                                  channel: v.channel,
                                  alimtalkTemplateCode: v.alimtalkTemplateCode,
                                  alimtalkVariableMap: v.alimtalkVariableMap,
                                  trafficWeight: recommended,
                                }),
                              },
                            );
                          }
                          await loadVariants();
                        } catch (err: any) {
                          setError(err?.message || '권장 traffic 적용 실패');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      className={`flex-1 px-2 py-1 rounded text-[10px] font-semibold ${
                        winnerDeclaration.status === 'winner'
                          ? 'bg-emerald-500/40 hover:bg-emerald-500/60 text-emerald-50'
                          : 'bg-amber-500/40 hover:bg-amber-500/60 text-amber-50'
                      }`}
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-violet-300" />
        </div>
      ) : variants.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-white/10 rounded-lg">
          <p className="text-xs text-white/50 mb-2">A/B 테스트 variants가 없습니다.</p>
          <button
            onClick={handleAddVariant}
            disabled={isReadOnly || saving}
            className="px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 disabled:opacity-50 text-violet-200 rounded text-xs flex items-center gap-1 mx-auto"
          >
            <Plus className="w-3 h-3" /> 첫 Variant 추가 (기본 메시지 복제)
          </button>
        </div>
      ) : (
        <>
          {/* Tab — A/B/C */}
          <div className="flex items-center gap-1 border-b border-white/10">
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveTab(v.variantId)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === v.variantId
                    ? 'border-violet-400 text-violet-200'
                    : 'border-transparent text-white/40 hover:text-white/70'
                }`}
              >
                Variant {v.variantId}
                <span className="ml-1 text-[10px] text-white/30">
                  ({(v.trafficWeight * 100).toFixed(0)}%)
                </span>
              </button>
            ))}
            {variants.length < 3 && (
              <button
                onClick={handleAddVariant}
                disabled={isReadOnly || saving}
                className="ml-auto p-1.5 hover:bg-white/10 disabled:opacity-50 rounded text-violet-300"
                title="Variant 추가"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Active variant card */}
          {activeVariant && (
            <div className="space-y-3 pt-2">
              {/* ★ D210+ Phase 3 (2026-05-23 Harold 명시): funnel 시각화 영역 — 발송 → 클릭 → 전환 매트릭스 */}
              {activeVariant.sentCount > 0 && (
                <div className="p-3 bg-slate-950/40 border border-white/10 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Activity className="w-3 h-3 text-violet-300" />
                    <span className="text-[11px] font-semibold text-white/80">Funnel — Variant {activeVariant.variantId}</span>
                  </div>
                  <div className="space-y-2">
                    {/* 발송 100% */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 text-[10px] text-white/60 flex items-center gap-1">
                        <Activity className="w-2.5 h-2.5" /> 발송
                      </div>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-400" style={{ width: '100%' }} />
                      </div>
                      <div className="text-[10px] text-white/70 font-mono w-20 text-right">
                        {activeVariant.sentCount} (100%)
                      </div>
                    </div>
                    {/* 클릭 */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 text-[10px] text-white/60 flex items-center gap-1">
                        <MousePointerClick className="w-2.5 h-2.5" /> 클릭
                      </div>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-400"
                          style={{ width: `${(activeVariant.clickCount / activeVariant.sentCount) * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-white/70 font-mono w-20 text-right">
                        {activeVariant.clickCount} ({((activeVariant.clickCount / activeVariant.sentCount) * 100).toFixed(1)}%)
                      </div>
                    </div>
                    {/* 전환 */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 text-[10px] text-white/60 flex items-center gap-1">
                        <ShoppingCart className="w-2.5 h-2.5" /> 전환
                      </div>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${(activeVariant.conversionCount / activeVariant.sentCount) * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-white/70 font-mono w-20 text-right">
                        {activeVariant.conversionCount} ({((activeVariant.conversionCount / activeVariant.sentCount) * 100).toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bandit 통계 */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-white/5 rounded text-center">
                  <div className="text-[10px] text-white/40">발송</div>
                  <div className="text-sm font-semibold text-white/90">{activeVariant.sentCount}</div>
                </div>
                <div className="p-2 bg-white/5 rounded text-center">
                  <div className="text-[10px] text-white/40">클릭</div>
                  <div className="text-sm font-semibold text-white/90">{activeVariant.clickCount}</div>
                </div>
                <div className="p-2 bg-white/5 rounded text-center">
                  <div className="text-[10px] text-white/40">전환</div>
                  <div className="text-sm font-semibold text-white/90">{activeVariant.conversionCount}</div>
                </div>
                <div className="p-2 bg-white/5 rounded text-center">
                  <div className="text-[10px] text-white/40">평균 클릭률</div>
                  <div className="text-sm font-semibold text-violet-300">
                    {((activeVariant.banditAlpha / (activeVariant.banditAlpha + activeVariant.banditBeta)) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* ★ D211+ Phase 1 (2026-05-23 Harold 명시): Beta-Bernoulli 95% 신뢰 구간 시각화 — winner 자동 선언 신뢰 본질 */}
              {(() => {
                const ciEntry = variantsCI.find((v) => v.variantId === activeVariant.variantId);
                if (!ciEntry) return null;
                const { mean, lower95, upper95, intervalWidth } = ciEntry.ci;
                const meanPct = (mean * 100).toFixed(1);
                const lowerPct = (lower95 * 100).toFixed(1);
                const upperPct = (upper95 * 100).toFixed(1);
                const widthPct = (intervalWidth * 100).toFixed(1);
                // 신뢰도 안내 — interval 좁을수록 신뢰도 높음 (10%- 좁음 / 10~25% 중간 / 25%+ 넓음)
                const reliabilityLabel =
                  intervalWidth < 0.10 ? '신뢰도 높음' :
                  intervalWidth < 0.25 ? '신뢰도 중간 — 추가 발송 후 좁아짐' :
                  '신뢰도 부족 — 누적 발송 영역 부족';
                const reliabilityColor =
                  intervalWidth < 0.10 ? 'text-emerald-300' :
                  intervalWidth < 0.25 ? 'text-amber-300' :
                  'text-rose-300';
                return (
                  <div className="p-3 bg-violet-500/5 border border-violet-400/20 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-semibold text-violet-200 flex items-center gap-1.5">
                        <BarChart3 className="w-3 h-3" />
                        95% 신뢰 구간 (Beta-Bernoulli)
                      </div>
                      <div className={`text-[10px] font-medium ${reliabilityColor}`}>{reliabilityLabel}</div>
                    </div>
                    {/* CI 막대 시각화 — 0~100% 영역 안 lower~upper 범위 표시 + mean 점 */}
                    <div className="relative h-6 bg-white/5 rounded">
                      {/* CI 범위 막대 */}
                      <div
                        className="absolute top-1 bottom-1 bg-violet-400/40 border-l-2 border-r-2 border-violet-300 rounded-sm"
                        style={{
                          left: `${lower95 * 100}%`,
                          width: `${Math.max(0.5, (upper95 - lower95) * 100)}%`,
                        }}
                      />
                      {/* mean 점 */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-violet-100 shadow-lg"
                        style={{ left: `calc(${mean * 100}% - 1px)` }}
                      />
                      {/* 눈금 0% / 50% / 100% */}
                      <div className="absolute -bottom-3.5 left-0 text-[9px] text-white/30">0%</div>
                      <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[9px] text-white/30">50%</div>
                      <div className="absolute -bottom-3.5 right-0 text-[9px] text-white/30">100%</div>
                    </div>
                    <div className="mt-5 flex items-center justify-between text-[10px] text-white/60">
                      <span>
                        평균 <span className="font-mono text-violet-200 font-semibold">{meanPct}%</span>
                      </span>
                      <span>
                        95% CI <span className="font-mono text-violet-200">{lowerPct}% ~ {upperPct}%</span>
                        <span className="ml-1 text-white/30">(폭 {widthPct}%p)</span>
                      </span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-white/40 leading-relaxed">
                      클릭률은 통계적으로 <span className="text-violet-200/70 font-mono">{lowerPct}%~{upperPct}%</span> 사이 95% 확률.
                      구간이 좁을수록 자동 winner 선언 신뢰도 높음.
                    </div>
                  </div>
                );
              })()}

              <div className="text-[10px] text-white/40 flex items-start gap-1.5 leading-relaxed">
                <BarChart3 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  {activeVariant.sentCount < 3
                    ? `초기 탐색 단계 (누적 발송 ${activeVariant.sentCount}회 < 3회) — 모든 variant 동등 기회 제공. 누적 3회 이상부터 Bandit 추천 작동.`
                    : `학습 단계 — Thompson Sampling Beta(α=${activeVariant.banditAlpha.toFixed(1)}, β=${activeVariant.banditBeta.toFixed(1)}) 분포 기반 자동 선택.`}
                </span>
              </div>

              {/* channel select */}
              <div>
                <label className="block text-[11px] text-white/50 mb-1">채널</label>
                <select
                  value={channelOfActive}
                  onChange={(e) => handleUpdateVariant(activeVariant, { channel: e.target.value })}
                  disabled={isReadOnly}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs disabled:opacity-50"
                >
                  <option value="sms">SMS</option>
                  <option value="lms">LMS</option>
                  <option value="mms">MMS</option>
                  <option value="kakao">알림톡</option>
                </select>
              </div>

              {/* traffic_weight 슬라이더 */}
              <div>
                <label className="block text-[11px] text-white/50 mb-1">
                  Traffic Weight: <span className="text-violet-300 font-semibold">{(activeVariant.trafficWeight * 100).toFixed(0)}%</span>
                  {trafficSum > 0 && (
                    <span className="ml-2 text-[10px] text-white/30">
                      (전체 합산 {(trafficSum * 100).toFixed(0)}% — Bandit이 자동 정규화)
                    </span>
                  )}
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={activeVariant.trafficWeight * 100}
                  onChange={(e) => handleUpdateVariant(activeVariant, { trafficWeight: Number(e.target.value) / 100 })}
                  disabled={isReadOnly}
                  className="w-full disabled:opacity-50"
                />
              </div>

              {/* 메시지 영역 — channel 별 분기 */}
              {channelOfActive === 'kakao' ? (
                <>
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">
                      알림톡 템플릿 코드 <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={activeVariant.alimtalkTemplateCode || ''}
                      onChange={(e) => handleUpdateVariant(activeVariant, { alimtalkTemplateCode: e.target.value })}
                      placeholder="kakao_templates.template_code"
                      disabled={isReadOnly}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">변수 매핑 (JSON)</label>
                    <textarea
                      value={JSON.stringify(activeVariant.alimtalkVariableMap || {}, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          handleUpdateVariant(activeVariant, { alimtalkVariableMap: parsed });
                        } catch {
                          // JSON 파싱 실패 시 갱신 안 함 (사용자가 편집 중)
                        }
                      }}
                      rows={4}
                      disabled={isReadOnly}
                      placeholder='{"name": "@@고객명@@", "amount": "@@최근구매금액@@"}'
                      className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs font-mono disabled:opacity-50"
                    />
                    <div className="text-[10px] text-white/30 mt-1">
                      알림톡 #{`{변수}`} → @@고객필드@@ 형식 매핑 (회사 admin 직접 작성).
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {(channelOfActive === 'lms' || channelOfActive === 'mms') && (
                    <div>
                      <label className="block text-[11px] text-white/50 mb-1">
                        제목 <span className="text-rose-400">*</span>
                        <span className="ml-1 text-white/30">(LMS/MMS 필수, 최대 40자)</span>
                      </label>
                      <input
                        type="text"
                        value={activeVariant.subject || ''}
                        onChange={(e) => handleUpdateVariant(activeVariant, { subject: e.target.value })}
                        maxLength={40}
                        placeholder="한 줄 제목"
                        disabled={isReadOnly}
                        className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs disabled:opacity-50"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">메시지 본문</label>
                    <textarea
                      value={activeVariant.messageTemplate || ''}
                      onChange={(e) => handleUpdateVariant(activeVariant, { messageTemplate: e.target.value })}
                      rows={5}
                      placeholder="회사 admin이 직접 작성 (AI 임의 혜택 X)"
                      disabled={isReadOnly}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs font-mono resize-y disabled:opacity-50"
                    />
                  </div>
                </>
              )}

              {/* 액션 */}
              {!isReadOnly && (
                <>
                  {/* ★ D211+ Phase A-fix (2026-05-23 Harold 명시): native confirm 폐기 — 인라인 삭제 confirm 카드 */}
                  {pendingDelete?.id === activeVariant.id && (
                    <div className="p-2.5 bg-slate-950 border border-rose-400/40 rounded-lg">
                      <div className="flex items-start gap-2 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-300 flex-shrink-0 mt-0.5" />
                        <span className="text-[11px] text-white/80 leading-relaxed">
                          Variant <span className="font-semibold text-rose-200">{activeVariant.variantId}</span> 삭제하시겠습니까?
                          <span className="block text-[10px] text-white/40 mt-0.5">옛 누적 발송/클릭/전환 통계 영역 함께 손실</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPendingDelete(null)}
                          className="flex-1 px-2 py-1 bg-white/5 hover:bg-white/10 text-white/80 rounded text-[10px]"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => executeDeleteVariant(activeVariant)}
                          disabled={saving}
                          className="flex-1 px-2 py-1 bg-rose-500/40 hover:bg-rose-500/60 disabled:opacity-30 text-rose-50 rounded text-[10px] font-semibold"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                    <button
                      onClick={() => handleSaveVariant(activeVariant)}
                      disabled={saving}
                      className="flex-1 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 disabled:opacity-50 text-violet-200 rounded text-xs flex items-center justify-center gap-1"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Variant {activeVariant.variantId} 저장
                    </button>
                    <button
                      onClick={() => handleDeleteVariant(activeVariant)}
                      disabled={saving || pendingDelete?.id === activeVariant.id}
                      className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-50 text-rose-200 rounded text-xs flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> 삭제
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
