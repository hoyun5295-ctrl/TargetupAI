/**
 * ★ D219+ Part 2 (2026-05-27) — Wizard Step 4: 자연어 세그먼트 + AI 변환 + 미리보기
 *
 * Harold 명시 본질 (2026-05-27): "단 1의 오차도 없는 타겟 추출 의무".
 * CT-97 ai-segment-generator → CT-01 customer-filter 호환 변환 → 매칭 수 + 샘플 5건 즉시 표시.
 */

import { useState } from 'react';
import { Target, Sparkles, ArrowRight, Check, AlertCircle, RefreshCw, Save, Users, Eye } from 'lucide-react';
import type { OnboardingStateData } from '../../pages/OnboardingWizardPage';

interface Props {
  state: OnboardingStateData;
  onNext: () => void;
  onSync: () => void;
}

interface PreviewSample {
  id: string;
  phone: string;
  name: string | null;
  gender: string | null;
  region: string | null;
  last_purchase_date: string | null;
  total_purchase_amount: number | null;
}

interface GenerateResult {
  filter: Record<string, { operator: string; value: any }>;
  explanation: string;
  matchCount: number;
  samples: PreviewSample[];
}

const EXAMPLE_PROMPTS = [
  '30일 안 구매하지 않은 30대 여성',
  'VIP 등급 + 누적 구매 100만원 이상',
  '서울 거주 + 최근 3개월 안 1회 이상 구매한 고객',
  '결혼기념일이 이번 달인 고객',
];

export default function Step4Segment({ state, onNext, onSync }: Props) {
  const completed = state.completedSteps.includes(4);
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleGenerate() {
    if (!input.trim()) {
      setError('조건을 자연어로 입력하세요.');
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/onboarding/segment-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ naturalLanguage: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        // ZERO_MATCH 같은 사용자 안내 오류 = 친화 표시
        setError(data?.error || 'AI 변환 실패');
        return;
      }
      setResult({
        filter: data.filter,
        explanation: data.explanation,
        matchCount: data.matchCount,
        samples: data.samples || [],
      });
    } catch (e: any) {
      setError(e?.message || 'AI 변환 실패');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!result || !name.trim()) {
      setError('세그먼트 이름을 입력하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/onboarding/segment-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          filter: result.filter,
          naturalLanguage: input.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || '세그먼트 저장 실패');
        return;
      }
      setSaved(true);
      onSync();
    } catch (e: any) {
      setError(e?.message || '세그먼트 저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* 안내 카드 */}
      <div className="rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <h2 className="text-base font-semibold text-white">자연어로 고객 세그먼트 만들기</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-200 border border-violet-400/30 font-semibold">AI</span>
            </div>
            <p className="text-[12px] text-white/70 leading-relaxed">
              조건을 자연어로 입력하면 AI가 정확한 필터로 변환합니다. 매칭 수 + 샘플 5건이 즉시 표시되어 신뢰할 수 있습니다.
              <br />
              <span className="text-violet-200 font-medium">단 1의 오차도 없는 추출</span> — AI는 검증된 필드/연산자만 사용하며, SQL은 직접 생성하지 않습니다.
            </p>
          </div>
        </div>
      </div>

      {/* 예시 prompt 4 */}
      <div>
        <p className="text-[11px] text-white/40 mb-2">💡 빠른 시작 예시</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => setInput(p)}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* 자연어 입력 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <label className="text-[11px] text-white/50 mb-1.5 block">조건 자연어 입력</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예: 30일 안 구매하지 않은 30대 여성"
          className="w-full bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/50"
          rows={3}
          disabled={generating || saving}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[10px] text-white/35">
            AI가 변환한 필터를 검증하고, 매칭 수 + 샘플 5건을 즉시 표시합니다.
          </p>
          <button
            onClick={handleGenerate}
            disabled={!input.trim() || generating || saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold"
          >
            {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'AI 변환 중...' : 'AI 변환'}
          </button>
        </div>
      </div>

      {/* 오류 */}
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-rose-100">{error}</p>
          </div>
        </div>
      )}

      {/* 결과 카드 */}
      {result && !saved && (
        <div className="space-y-4">
          {/* 매칭 수 + AI 해석 */}
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-5">
            <div className="flex items-start gap-3">
              <Users className="w-6 h-6 text-emerald-300 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[11px] text-emerald-200/70 mb-1">매칭 결과</p>
                <p className="text-2xl font-bold text-emerald-100">{result.matchCount.toLocaleString()}명</p>
                <p className="text-[12px] text-emerald-100/80 mt-2 leading-relaxed">
                  <span className="text-emerald-200 font-medium">AI 해석:</span> {result.explanation}
                </p>
              </div>
            </div>
          </div>

          {/* 샘플 5건 */}
          {result.samples.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-4 h-4 text-white/60" />
                <p className="text-[12px] text-white/70 font-medium">샘플 5건 미리보기</p>
              </div>
              <div className="space-y-1.5">
                {result.samples.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 text-[11px] py-1.5 border-b border-white/5">
                    <span className="text-white/80 font-mono w-32">{s.phone}</span>
                    <span className="text-white/60 w-20">{s.name || '-'}</span>
                    <span className="text-white/40 w-12">{s.gender || '-'}</span>
                    <span className="text-white/40 w-20">{s.region || '-'}</span>
                    <span className="text-white/40 w-24">{s.last_purchase_date || '-'}</span>
                    <span className="text-white/40 ml-auto">{s.total_purchase_amount?.toLocaleString() || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 저장 영역 */}
          <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-4">
            <p className="text-[12px] text-violet-100 mb-3">이 세그먼트를 저장하면 발송 시 재활용할 수 있습니다.</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="세그먼트 이름 (예: 30일 미구매 30대 여성)"
                className="flex-1 bg-slate-950/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/50"
                disabled={saving}
              />
              <button
                onClick={handleSave}
                disabled={!name.trim() || saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-30 text-white rounded-lg text-sm font-semibold"
              >
                <Save className="w-4 h-4" />
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 저장 완료 */}
      {saved && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-5 text-center">
          <Check className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
          <p className="text-sm text-emerald-100 font-semibold">세그먼트 저장 완료</p>
          <p className="text-[11px] text-emerald-200/70 mt-1">다음 단계로 진입하여 본문을 작성하세요.</p>
        </div>
      )}

      {/* 다음 버튼 */}
      <div className="flex justify-between items-center pt-4 border-t border-white/10">
        <p className="text-[11px] text-white/40">
          {completed || saved ? '✓ 완성된 step.' : '세그먼트 저장 후 다음 단계로 진입하세요.'}
        </p>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-semibold"
        >
          {completed || saved ? <Check className="w-4 h-4" /> : null}
          다음 단계 (5/7)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
