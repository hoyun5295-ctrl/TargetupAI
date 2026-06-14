/**
 * CreditConfirmModal — 큰 확정 차감 사전 확인 (종량제 인지 장치).
 *
 * 발행·게시·저장·자동마케팅·풀분석처럼 되돌리기 어렵고 비싼 작업 직전에 띄운다.
 * "[기능] 사용으로 NNN 크레딧 차감 · 현재 → 사용 후"를 보여주고 진행/취소를 받는다.
 * 잔액은 GET /api/companies/my-credit로 자체 조회(부모 무관). 비용·라벨은 constants/credit.ts 단일 출처.
 * 작은 차감(생성·문안·다듬기)은 이 모달을 쓰지 않고 차감 후 토스트로만 알린다.
 */
import { useState, useEffect } from 'react';
import { Sparkles, X, AlertTriangle } from 'lucide-react';
import { CONFIRM_CREDIT_COSTS, CREDIT_SOURCE_LABELS } from '../../constants/credit';

interface Props {
  open: boolean;
  source: string;          // 'dm-builder' | 'inapp-publish' | 'journey-activate' | 'continuous-operator' | 'orchestrate' | 'dm-ai-generate'
  description?: string;     // 작업 맥락 1줄 (예: 빠른시작 시나리오 설명) — 있으면 차감 안내 위에 표시
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CreditConfirmModal({ open, source, description, onConfirm, onCancel }: Props) {
  const cost = CONFIRM_CREDIT_COSTS[source] ?? 0;
  const label = CREDIT_SOURCE_LABELS[source] ?? 'AI 작업';
  const [balance, setBalance] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);

  // open 시 잔액 조회 (대시보드와 동일 endpoint)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBalance(null);
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = await res.json();
          if (alive && d && d.success !== false) {
            setBalance(Number(d.total) || 0);
            setEnabled(d.creditEnabled !== false); // 크레딧제 미적용(무료) 회사는 차감 0 → 잔액 차단 안 함
          }
        }
      } catch { /* 조회 실패 시 비용만 표시 */ }
    })();
    return () => { alive = false; };
  }, [open, source]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const insufficient = enabled && balance != null && balance < cost;
  const after = balance != null ? balance - cost : null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">크레딧 차감 확인</div>
            <div className="text-[11px] text-white/40 truncate">{label}</div>
          </div>
          <button
            onClick={onCancel}
            className="ml-auto p-1 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
            aria-label="닫기"
          >
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        {description && (
          <div className="text-[12px] text-white/70 leading-relaxed mb-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
            {description}
          </div>
        )}
        <div className="text-[13px] text-white/80 leading-relaxed mb-4">
          <span className="font-semibold text-white">{label}</span> 사용으로{' '}
          <span className="font-semibold text-violet-300">{cost.toLocaleString()} 크레딧</span>이 차감됩니다.
        </div>

        <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 mb-4 text-[12px] space-y-1.5">
          <div className="flex justify-between text-white/60">
            <span>현재 크레딧</span>
            <span className="text-white/90 font-medium">{balance != null ? balance.toLocaleString() : '—'}</span>
          </div>
          <div className="flex justify-between text-white/60">
            <span>사용 후</span>
            <span className={`font-medium ${insufficient ? 'text-rose-300' : 'text-white/90'}`}>
              {after != null ? after.toLocaleString() : '—'}
            </span>
          </div>
        </div>

        {insufficient && (
          <div className="flex items-center gap-2 text-[12px] text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            크레딧이 부족합니다. 충전 후 이용해 주세요.
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[13px] text-white/70 transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={insufficient}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-opacity"
          >
            진행
          </button>
        </div>
      </div>
    </div>
  );
}
