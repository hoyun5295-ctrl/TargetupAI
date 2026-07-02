/**
 * TargetExtractModal — 비-문자 채널 공용 타겟 추출 모달 (sub-project A · P2)
 *
 *   이메일·인앱·모바일DM·카카오 발송 화면에서 "타겟을 먼저 추출해 확정"하는 단계.
 *   자연어 입력 → POST /api/targets/extract → 조건 인원수 + 이 채널 발송 가능 인원수 + 샘플.
 *   확정 시 onApply(filter, channelEligibleCount, samples) 로 부모가 발송 대상으로 held.
 *
 *   - 0건 자동완화 X (D171): 조건 0건은 안내만, 채널 자격 0건은 발송 비활성.
 *   - 다크 톤 + useToast(native dialog X) + 모바일 반응형 + Source caption.
 */

import { useState } from 'react';
import { Sparkles, Users, Eye, RefreshCw, Check, AlertCircle, X, Bookmark } from 'lucide-react';
import { useToast } from './ToastProvider';

export type ExtractChannel = 'email' | 'dm' | 'inapp' | 'kakao';

export interface ExtractedTarget {
  filter: Record<string, { operator: string; value: any }>;
  /** ★ 2026-07-02(3) "전체 고객" 타겟 — filter는 빈 {} (조건 없음 = 전체) */
  isAll?: boolean;
  explanation: string;
  matchCount: number;
  channelEligibleCount: number;
  samples: Array<{
    id: string;
    phone: string;
    name: string | null;
    gender: string | null;
    region: string | null;
    last_purchase_date: string | null;
    total_purchase_amount: number | null;
  }>;
}

interface Props {
  show: boolean;
  channel: ExtractChannel;
  onClose: () => void;
  onApply: (target: ExtractedTarget) => void;
}

const CHANNEL_LABEL: Record<ExtractChannel, string> = {
  email: '이메일',
  dm: '모바일DM',
  inapp: '인앱 메시지',
  kakao: '카카오 알림톡',
};

// 채널별 발송 가능 인원수 설명 (자격 규칙 요약)
const CHANNEL_ELIGIBLE_HINT: Record<ExtractChannel, string> = {
  email: '이메일 주소 보유 + 수신거부 아님',
  dm: '전화 유효 + 수신거부 아님',
  inapp: '자사몰 방문 시 표시 가능',
  kakao: '전화 유효 + 수신거부 아님',
};

const EXAMPLES = [
  '전체 고객',
  '30일 안 구매하지 않은 30대 여성',
  'VIP 등급 + 누적 구매 100만원 이상',
  '서울 거주 + 최근 3개월 안 1회 이상 구매',
  '결혼기념일이 이번 달인 고객',
];

export default function TargetExtractModal({ show, channel, onClose, onApply }: Props) {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ExtractedTarget | null>(null);
  // ★ 2026-07-02(3) 추출 실패를 토스트(3초)로만 보여줘 놓치던 문제 — 모달 안 지속 표시
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!show) return null;

  const reset = () => {
    setInput('');
    setResult(null);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleExtract = async () => {
    if (!input.trim()) {
      toast.warning('조건을 자연어로 입력해주세요.');
      return;
    }
    setGenerating(true);
    setResult(null);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/targets/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ naturalLanguage: input.trim(), channel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const msg = data?.error || '타겟 추출에 실패했습니다.';
        setError(msg);
        toast.error(msg);
        return;
      }
      setResult({
        filter: data.filter,
        isAll: !!data.isAll,
        explanation: data.explanation,
        matchCount: data.matchCount,
        channelEligibleCount: data.channelEligibleCount,
        samples: data.samples || [],
      });
    } catch (e: any) {
      const msg = e?.message || '서버에 연결할 수 없습니다.';
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveSegment = async () => {
    if (!result) return;
    const name = `${CHANNEL_LABEL[channel]} 타겟 · ${new Date().toLocaleDateString('ko-KR')}`;
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/saved-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, segmentType: 'custom', prompt: input.trim(), filter: result.filter }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data?.error || '세그먼트 저장에 실패했습니다.');
        return;
      }
      toast.success('세그먼트로 저장했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '세그먼트 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleApply = () => {
    if (!result || result.channelEligibleCount === 0) return;
    onApply(result);
    reset();
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[560px] max-h-[92vh] overflow-hidden flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 px-5 py-4 border-b border-white/10 bg-slate-950/80 backdrop-blur-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                타겟 추출
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 border border-violet-400/20">
                  {CHANNEL_LABEL[channel]}
                </span>
              </h3>
              <p className="text-[11px] text-white/50">자연어로 조건을 입력하면 보낼 대상을 정확히 추출합니다</p>
            </div>
          </div>
          <button onClick={close} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 자연어 입력 */}
          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 p-4">
            <label className="text-[11px] text-white/60 mb-1.5 block">조건 자연어 입력</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleExtract(); }}
              placeholder="예: 30일 안 구매하지 않은 30대 여성"
              rows={3}
              disabled={generating}
              className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60 focus:ring-1 focus:ring-violet-400/40 resize-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setInput(ex)}
                  disabled={generating}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[10px] text-white/30">검증된 필터만 사용 — 단 1의 오차 없는 추출</p>
              <button
                onClick={handleExtract}
                disabled={!input.trim() || generating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generating ? '추출 중...' : '타겟 추출'}
              </button>
            </div>
          </div>

          {/* 추출 실패 — 모달 안 지속 표시 (토스트만으로는 놓침) */}
          {error && !result && (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-200">{error}</p>
            </div>
          )}

          {/* 결과 */}
          {result && (
            <div className="space-y-3">
              {/* 인원수 2칸 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] text-white/40 mb-1">조건에 맞는 고객</p>
                  <p className="text-2xl font-bold text-white">{result.matchCount.toLocaleString()}<span className="text-sm font-normal text-white/50 ml-1">명</span></p>
                </div>
                <div className={`rounded-xl border p-4 ${result.channelEligibleCount > 0 ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-amber-400/30 bg-amber-500/10'}`}>
                  <p className="text-[10px] text-white/40 mb-1">{CHANNEL_LABEL[channel]} 발송 가능</p>
                  <p className={`text-2xl font-bold ${result.channelEligibleCount > 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {result.channelEligibleCount.toLocaleString()}<span className="text-sm font-normal text-white/50 ml-1">명</span>
                  </p>
                  <p className="text-[9px] text-white/30 mt-0.5">{CHANNEL_ELIGIBLE_HINT[channel]}</p>
                </div>
              </div>

              {/* AI 해석 */}
              {result.explanation && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] text-white/70 leading-relaxed"><span className="font-semibold text-white/80">해석:</span> {result.explanation}</p>
                </div>
              )}

              {/* 채널 자격 0건 안내 */}
              {result.channelEligibleCount === 0 && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200">이 채널로 보낼 수 있는 고객이 없습니다. 조건을 조정하거나 다른 채널을 이용해주세요. (자동 완화는 마케팅 의도 보호를 위해 차단됩니다)</p>
                </div>
              )}

              {/* 샘플 */}
              {result.samples.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Eye className="w-3.5 h-3.5 text-white/40" />
                    <p className="text-[11px] text-white/60 font-medium">샘플 {result.samples.length}건</p>
                  </div>
                  <div className="space-y-1">
                    {result.samples.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-white/5 last:border-0">
                        <span className="text-white/80 font-mono w-28">{s.phone}</span>
                        <span className="text-white/60 w-16 truncate">{s.name || '-'}</span>
                        <span className="text-white/40 w-10">{s.gender || '-'}</span>
                        <span className="text-white/40 w-16 truncate">{s.region || '-'}</span>
                        <span className="text-white/40 ml-auto truncate">{s.total_purchase_amount != null ? s.total_purchase_amount.toLocaleString() : '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-white/30 italic text-center">Data source — AI 자연어 변환 + 검증된 SQL 필터 + 채널 발송 자격</p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-slate-950/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-2 text-white/50 text-xs mr-auto">
            <Users className="w-4 h-4" />
            {result ? `${result.channelEligibleCount.toLocaleString()}명 발송 가능` : '조건을 입력하고 추출하세요'}
          </div>
          {result && (
            <button
              onClick={handleSaveSegment}
              disabled={saving}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 transition-colors"
            >
              <Bookmark className="w-3.5 h-3.5" />
              {saving ? '저장 중...' : '세그먼트로 저장'}
            </button>
          )}
          <button
            onClick={handleApply}
            disabled={!result || result.channelEligibleCount === 0}
            className="flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Check className="w-4 h-4" />
            {result ? `이 타겟으로 진행 (${result.channelEligibleCount.toLocaleString()}명)` : '이 타겟으로 진행'}
          </button>
        </div>
      </div>
    </div>
  );
}
