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
import { Beaker, Plus, Trash2, Save, Loader2, X, BarChart3, Info } from 'lucide-react';

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

  const handleDeleteVariant = async (variant: JourneyStepVariant) => {
    if (isReadOnly) return;
    if (!confirm(`Variant ${variant.variantId}을 삭제하시겠습니까?`)) return;
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
                    disabled={saving}
                    className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-50 text-rose-200 rounded text-xs flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> 삭제
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
