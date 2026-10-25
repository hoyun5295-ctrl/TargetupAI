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
// ★ 2026-10-20 V.3 §9-4 — 변형마다 같은 큰 휴대폰(실제 나가는 형태 · (광고) · 무료수신거부 합성 바이트 · 받는 모습 = 서버 미리보기).
import PhoneComposer from './PhoneComposer';
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
  /** ★ V.3 — 회사 080 수신거부 번호(바이트 · 보이는 모습 합성). 비카카오 여정 칸은 늘 광고다(resolveJourneyAdFlag). */
  opt080Number?: string;
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
  opt080Number = '',
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
        throw new Error(data.error || 'A/B 문안을 불러오지 못했어요.');
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
        throw new Error(data.error || 'A/B 문안을 만들지 못했어요.');
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
      setError('이 칸 문안을 10자 이상 먼저 써 주세요.');
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
      setError(err?.message || 'AI 문안을 만들지 못했어요.');
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
  // ★ 2026-10-25 여정 구조체크 2차 #1 — A/B 문안 = 칸과 같은 채널의 다른 글(서버가 칸 채널로 저장 · 검사 · 발송이 같은 판을 본다).
  //   옛: 변이마다 채널(알림톡 포함) · 템플릿 코드 · 변수 JSON 을 직접 넣게 해 검사한 적 없는 모양으로 나갔다.
  const channelOfActive = defaultChannel;

  return (
    <div className="border-2 border-violet-200 rounded-xl bg-violet-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Beaker className="w-4 h-4 text-violet-700" />
        <h4 className="text-sm font-semibold text-violet-800">A/B 문안 시험</h4>
        {onClose && (
          <button onClick={onClose} className="ml-auto p-1 hover:bg-slate-100 rounded" title="닫기">
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        )}
      </div>

      <div className="text-[11px] text-violet-800 leading-relaxed">
        A · B · C 안에 서로 다른 문안을 넣으면, 보낸 결과(클릭 · 구매)를 보고 반응이 좋은 안을 더 자주 보내요.
        <br />
        <span className="text-amber-700">혜택(%·원·쿠폰)은 AI가 지어내지 않아요. 실제로 주는 혜택만 직접 넣어 주세요.</span>
      </div>

      {/* ★ D211+ Phase A 3번 (2026-05-23 Harold 명시): AI 자동 생성 영역 — 3 톤 (감성/실용/캐주얼) */}
      {!isReadOnly && variants.length < 3 && (
        <div className="p-2.5 bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 rounded-lg">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-700" />
            <span className="text-[11px] font-semibold text-violet-900">AI로 말투가 다른 안 3개 만들기</span>
            <button
              onClick={handleAutoGenerate}
              disabled={autoGenerating || !defaultMessageTemplate || defaultMessageTemplate.trim().length < 10}
              className="ml-auto px-2.5 py-1 bg-violet-100 hover:bg-violet-200 disabled:opacity-30 text-violet-900 rounded text-[10px] flex items-center gap-1 transition-colors"
            >
              {autoGenerating ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> 생성 중</>
              ) : (
                <><Sparkles className="w-3 h-3" /> 자동 생성</>
              )}
            </button>
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed">
            지금 문안을 바탕으로 감성적 · 실용적 · 캐주얼 세 말투를 만들어요. 혜택과 숫자는 그대로 두고 인사 · 안내 · 마무리만 바꿔요.
          </div>

          {/* 생성된 variant 목록 (회사 admin 명시 적용 의무) */}
          {generatedVariants.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {generatedVariants.map((gen, idx) => (
                <div key={idx} className="p-2 bg-white border border-slate-200 rounded">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 font-medium">{gen.tone}</span>
                    <span className="text-[9px] text-slate-400 font-mono">{gen.byteCount}바이트</span>
                    <button
                      onClick={() => handleApplyGenerated(gen)}
                      disabled={saving}
                      className="ml-auto px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-30 text-emerald-900 rounded text-[10px] flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-2.5 h-2.5" /> 적용
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-700 whitespace-pre-wrap leading-relaxed mb-1">{gen.messageTemplate}</div>
                  {gen.reasoning && (
                    <div className="text-[9px] text-slate-400 italic">{gen.reasoning}</div>
                  )}
                </div>
              ))}
              <div className="text-[9px] text-amber-800 italic">
                읽어 보고 「적용」을 눌러야 저장돼요.
              </div>
            </div>
          )}

          {/* 경고 영역 */}
          {generationWarnings.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {generationWarnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-1 text-[9px] text-amber-800">
                  <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isReadOnly && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          켜진 여정의 A/B 문안은 고칠 수 없어요. 먼저 일시정지해 주세요.
        </div>
      )}

      {error && (
        <div className="p-2 bg-rose-50 border border-rose-200 rounded text-[11px] text-rose-800">
          {error}
        </div>
      )}

      {/* ★ D210+ Phase 3 (2026-05-23 Harold 명시): winner 자동 선언 안내 카드 (회사 admin 명시 적용 의무 — 자동 변경 X) */}
      {winnerDeclaration && variants.length >= 2 && (
        <div className={`p-3 rounded-lg border ${
          winnerDeclaration.status === 'winner' ? 'bg-emerald-50 border-emerald-300' :
          winnerDeclaration.status === 'leading' ? 'bg-amber-50 border-amber-300' :
          'bg-white border-slate-200'
        }`}>
          <div className="flex items-start gap-2">
            <Trophy className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
              winnerDeclaration.status === 'winner' ? 'text-emerald-700' :
              winnerDeclaration.status === 'leading' ? 'text-amber-700' :
              'text-slate-400'
            }`} />
            <div className="flex-1 text-[11px]">
              <div className={`font-semibold mb-1 ${
                winnerDeclaration.status === 'winner' ? 'text-emerald-800' :
                winnerDeclaration.status === 'leading' ? 'text-amber-800' :
                'text-slate-600'
              }`}>
                {winnerDeclaration.status === 'winner' && '반응이 좋은 안이 나왔어요'}
                {winnerDeclaration.status === 'leading' && '앞서는 안이 있어요'}
                {winnerDeclaration.status === 'low_confidence' && '결과를 모으는 중이에요'}
                {winnerDeclaration.status === 'cold_start' && '처음에는 고르게 보내요'}
              </div>
              <div className="text-slate-600 leading-relaxed mb-2">{winnerDeclaration.reasoning}</div>
              {Object.keys(winnerDeclaration.variantProbabilities).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-400">안마다 가장 좋을 가능성</div>
                  {Object.entries(winnerDeclaration.variantProbabilities).map(([vid, prob]) => (
                    <div key={vid} className="flex items-center gap-2">
                      <div className="text-[10px] text-slate-500 w-16">{vid}안</div>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            vid === winnerDeclaration.winnerVariantId
                              ? winnerDeclaration.status === 'winner' ? 'bg-emerald-400' : 'bg-amber-400'
                              : 'bg-slate-300'
                          }`}
                          style={{ width: `${prob * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono w-12 text-right">{(prob * 100).toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              )}
              {winnerDeclaration.winnerVariantId && !isReadOnly && !pendingTrafficApply && (
                <button
                  onClick={() => setPendingTrafficApply(true)}
                  className={`mt-2 px-3 py-1 rounded text-[11px] font-medium ${
                    winnerDeclaration.status === 'winner'
                      ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900'
                      : 'bg-amber-100 hover:bg-amber-200 text-amber-900'
                  }`}
                >
                  좋은 안을 더 자주 보내기
                </button>
              )}
              {/* ★ D211+ Phase A-fix (2026-05-23 Harold 명시): native confirm 폐기 — 인라인 confirm 카드 (권장 traffic 적용) */}
              {pendingTrafficApply && winnerDeclaration.winnerVariantId && (
                <div className="mt-2 p-2.5 bg-slate-100 border border-violet-300 rounded-lg">
                  <div className="text-[11px] text-slate-700 mb-2 leading-relaxed">
                    <span className="font-semibold text-violet-800">{winnerDeclaration.winnerVariantId}안</span>을 더 자주 보내도록 비율을 바꿀까요?
                    <div className="mt-1 text-[10px] text-slate-500">{winnerDeclaration.reasoning}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPendingTrafficApply(false)}
                      className="flex-1 px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded text-[10px]"
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
                                  trafficWeight: recommended,
                                }),
                              },
                            );
                          }
                          await loadVariants();
                        } catch (err: any) {
                          setError(err?.message || '보내는 비율을 바꾸지 못했어요.');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      className={`flex-1 px-2 py-1 rounded text-[10px] font-semibold ${
                        winnerDeclaration.status === 'winner'
                          ? 'bg-emerald-200 hover:bg-emerald-200 text-emerald-900'
                          : 'bg-amber-200 hover:bg-amber-200 text-amber-900'
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
          <Loader2 className="w-5 h-5 animate-spin text-violet-700" />
        </div>
      ) : variants.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500 mb-2">아직 A/B 문안이 없어요.</p>
          <button
            onClick={handleAddVariant}
            disabled={isReadOnly || saving}
            className="px-3 py-1.5 bg-violet-100 hover:bg-violet-100 disabled:opacity-50 text-violet-800 rounded text-xs flex items-center gap-1 mx-auto"
          >
            <Plus className="w-3 h-3" /> 지금 문안으로 A안 만들기
          </button>
        </div>
      ) : (
        <>
          {/* Tab — A/B/C */}
          <div className="flex items-center gap-1 border-b border-slate-200">
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveTab(v.variantId)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === v.variantId
                    ? 'border-violet-400 text-violet-800'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {v.variantId}안
                <span className="ml-1 text-[10px] text-slate-400">
                  ({(v.trafficWeight * 100).toFixed(0)}%)
                </span>
              </button>
            ))}
            {variants.length < 3 && (
              <button
                onClick={handleAddVariant}
                disabled={isReadOnly || saving}
                className="ml-auto p-1.5 hover:bg-slate-100 disabled:opacity-50 rounded text-violet-700"
                title="안 추가"
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
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Activity className="w-3 h-3 text-violet-700" />
                    <span className="text-[11px] font-semibold text-slate-700">{activeVariant.variantId}안 결과</span>
                  </div>
                  <div className="space-y-2">
                    {/* 발송 100% */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 text-[10px] text-slate-500 flex items-center gap-1">
                        <Activity className="w-2.5 h-2.5" /> 발송
                      </div>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-400" style={{ width: '100%' }} />
                      </div>
                      <div className="text-[10px] text-slate-600 font-mono w-20 text-right">
                        {activeVariant.sentCount} (100%)
                      </div>
                    </div>
                    {/* 클릭 */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 text-[10px] text-slate-500 flex items-center gap-1">
                        <MousePointerClick className="w-2.5 h-2.5" /> 클릭
                      </div>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-400"
                          style={{ width: `${(activeVariant.clickCount / activeVariant.sentCount) * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-600 font-mono w-20 text-right">
                        {activeVariant.clickCount} ({((activeVariant.clickCount / activeVariant.sentCount) * 100).toFixed(1)}%)
                      </div>
                    </div>
                    {/* 전환 */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 text-[10px] text-slate-500 flex items-center gap-1">
                        <ShoppingCart className="w-2.5 h-2.5" /> 전환
                      </div>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${(activeVariant.conversionCount / activeVariant.sentCount) * 100}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-600 font-mono w-20 text-right">
                        {activeVariant.conversionCount} ({((activeVariant.conversionCount / activeVariant.sentCount) * 100).toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Bandit 통계 */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-white rounded text-center">
                  <div className="text-[10px] text-slate-400">발송</div>
                  <div className="text-sm font-semibold text-slate-800">{activeVariant.sentCount}</div>
                </div>
                <div className="p-2 bg-white rounded text-center">
                  <div className="text-[10px] text-slate-400">클릭</div>
                  <div className="text-sm font-semibold text-slate-800">{activeVariant.clickCount}</div>
                </div>
                <div className="p-2 bg-white rounded text-center">
                  <div className="text-[10px] text-slate-400">전환</div>
                  <div className="text-sm font-semibold text-slate-800">{activeVariant.conversionCount}</div>
                </div>
                <div className="p-2 bg-white rounded text-center">
                  <div className="text-[10px] text-slate-400" title="지금까지 결과로 본 이 안의 예상 클릭률이에요(보낸 수가 적으면 실제 클릭률과 달라요)">예상 반응률</div>
                  <div className="text-sm font-semibold text-violet-700">
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
                  intervalWidth < 0.10 ? '결과가 충분해요' :
                  intervalWidth < 0.25 ? '조금 더 보내면 또렷해져요' :
                  '아직 보낸 수가 적어요';
                const reliabilityColor =
                  intervalWidth < 0.10 ? 'text-emerald-700' :
                  intervalWidth < 0.25 ? 'text-amber-700' :
                  'text-rose-700';
                return (
                  <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-semibold text-violet-800 flex items-center gap-1.5">
                        <BarChart3 className="w-3 h-3" />
                        클릭률이 있을 법한 범위
                      </div>
                      <div className={`text-[10px] font-medium ${reliabilityColor}`}>{reliabilityLabel}</div>
                    </div>
                    {/* CI 막대 시각화 — 0~100% 영역 안 lower~upper 범위 표시 + mean 점 */}
                    <div className="relative h-6 bg-white rounded">
                      {/* CI 범위 막대 */}
                      <div
                        className="absolute top-1 bottom-1 bg-violet-200 border-l-2 border-r-2 border-violet-300 rounded-sm"
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
                      <div className="absolute -bottom-3.5 left-0 text-[9px] text-slate-400">0%</div>
                      <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[9px] text-slate-400">50%</div>
                      <div className="absolute -bottom-3.5 right-0 text-[9px] text-slate-400">100%</div>
                    </div>
                    <div className="mt-5 flex items-center justify-between text-[10px] text-slate-500">
                      <span>
                        평균 <span className="font-mono text-violet-800 font-semibold">{meanPct}%</span>
                      </span>
                      <span>
                        범위 <span className="font-mono text-violet-800">{lowerPct}% ~ {upperPct}%</span>
                        <span className="ml-1 text-slate-400">(폭 {widthPct}%p)</span>
                      </span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
                      클릭률은 <span className="text-violet-800 font-mono">{lowerPct}%~{upperPct}%</span> 사이일 가능성이 커요.
                      범위가 좁을수록 결과를 믿을 수 있어요.
                    </div>
                  </div>
                );
              })()}

              <div className="text-[10px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
                <BarChart3 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  {activeVariant.sentCount < 3
                    ? `처음에는 고르게 보내요(보낸 수 ${activeVariant.sentCount}회 · 3회부터 반응을 보고 골라요).`
                    : '보낸 결과를 보고 반응이 좋은 안을 더 자주 보내는 중이에요.'}
                </span>
              </div>

              {/* traffic_weight 슬라이더 */}
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  보내는 비율: <span className="text-violet-700 font-semibold">{(activeVariant.trafficWeight * 100).toFixed(0)}%</span>
                  {trafficSum > 0 && (
                    <span className="ml-2 text-[10px] text-slate-400">
                      (합계 {(trafficSum * 100).toFixed(0)}% · 자동으로 100%에 맞춰요)
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

              {/* 문안 — 칸과 같은 채널 */}
                <PhoneComposer
                  channel={(channelOfActive === 'sms' || channelOfActive === 'mms' ? channelOfActive : 'lms') as 'sms' | 'lms' | 'mms'}
                  subject={activeVariant.subject || ''}
                  body={activeVariant.messageTemplate || ''}
                  isAd
                  opt080Number={opt080Number}
                  onSubject={isReadOnly ? undefined : (v) => handleUpdateVariant(activeVariant, { subject: v })}
                  onBody={isReadOnly ? undefined : (v) => handleUpdateVariant(activeVariant, { messageTemplate: v })}
                  journeyId={journeyId}
                  placeholder="이 변형으로 보낼 문안이에요. 혜택은 실제로 주는 것만 써요."
                  resetKey={activeVariant.id || activeVariant.variantId}
                />

              {/* 액션 */}
              {!isReadOnly && (
                <>
                  {/* ★ D211+ Phase A-fix (2026-05-23 Harold 명시): native confirm 폐기 — 인라인 삭제 confirm 카드 */}
                  {pendingDelete?.id === activeVariant.id && (
                    <div className="p-2.5 bg-slate-100 border border-rose-300 rounded-lg">
                      <div className="flex items-start gap-2 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-700 flex-shrink-0 mt-0.5" />
                        <span className="text-[11px] text-slate-700 leading-relaxed">
                          <span className="font-semibold text-rose-800">{activeVariant.variantId}안</span>을 지울까요?
                          <span className="block text-[10px] text-slate-400 mt-0.5">이 안의 보낸 수 · 클릭 · 구매 기록도 함께 지워져요.</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPendingDelete(null)}
                          className="flex-1 px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded text-[10px]"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => executeDeleteVariant(activeVariant)}
                          disabled={saving}
                          className="flex-1 px-2 py-1 bg-rose-200 hover:bg-rose-200 disabled:opacity-30 text-rose-900 rounded text-[10px] font-semibold"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                    <button
                      onClick={() => handleSaveVariant(activeVariant)}
                      disabled={saving}
                      className="flex-1 px-3 py-1.5 bg-violet-100 hover:bg-violet-100 disabled:opacity-50 text-violet-800 rounded text-xs flex items-center justify-center gap-1"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      {activeVariant.variantId}안 저장
                    </button>
                    <button
                      onClick={() => handleDeleteVariant(activeVariant)}
                      disabled={saving || pendingDelete?.id === activeVariant.id}
                      className="px-3 py-1.5 bg-rose-100 hover:bg-rose-100 disabled:opacity-50 text-rose-800 rounded text-xs flex items-center gap-1"
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
