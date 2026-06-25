/**
 * CustomerDataGate.tsx — 고객 데이터가 없으면 AI 문안 생성 전에 안내하는 공용 게이트
 *
 * 배경 (2026-06-25 Harold 명시): 고객 DB가 비어 있으면 AI가 문안·타겟추출을 제대로 못 한다.
 *   문안 생성 진입점(여정/AI Operator 메인/인앱/이메일/모바일DM)에서 고객 0명이면
 *   (a) 입력부 위 배너 상시 표시 + (b) 생성 시도 시 모달로 막고 안내한다.
 *
 * 단일 출처(중복 금지): 감지 훅 + 배너 + 모달을 한 모듈에서 export, 5곳이 그대로 재사용.
 *   - 감지: GET /api/ai/operator/data-profile 의 totalCustomers (1시간 서버 캐시 + 모듈 1분 캐시).
 *   - isEmpty = totalCustomers === 0 (조회 실패/미상이면 false = 생성을 막지 않음 — 오탐 차단).
 *   - 고객 올리는 경로: 직접 업로드 = /manage(고객 관리) / 싱크에이전트 = 운영자 배포라 담당자 안내.
 *
 * 영구 룰: 다크 톤(bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl) · native dialog 0 · Source caption.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Database, Upload, RefreshCw, X, Sparkles, ArrowRight, Users } from 'lucide-react';

// ── 감지 훅 ────────────────────────────────────────────────────────────────
// 페이지 이동 간 중복 호출만 줄이는 가벼운 모듈 캐시(서버가 이미 1시간 캐시).
let _cache: { ts: number; totalCustomers: number } | null = null;
const CACHE_MS = 60_000;

export function useCustomerDataGate(token: string | null | undefined) {
  const [loading, setLoading] = useState(_cache == null);
  const [totalCustomers, setTotalCustomers] = useState<number | null>(_cache?.totalCustomers ?? null);

  const fetchCount = useCallback(async (force = false) => {
    if (!token) { setLoading(false); return; }
    if (!force && _cache && Date.now() - _cache.ts < CACHE_MS) {
      setTotalCustomers(_cache.totalCustomers);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/ai/operator/data-profile', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.success && typeof data.totalCustomers === 'number') {
        _cache = { ts: Date.now(), totalCustomers: data.totalCustomers };
        setTotalCustomers(data.totalCustomers);
      }
    } catch {
      // 네트워크 실패 시 게이트 미적용 — 생성을 막지 않는다(오탐 방지).
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchCount(); }, [fetchCount]);

  return {
    loading,
    totalCustomers,
    isEmpty: totalCustomers === 0,
    refetch: () => fetchCount(true),
  };
}

const TITLE = '고객 데이터를 먼저 올려주세요';
const LEAD = 'AI가 정확한 문안과 타겟을 만들려면 고객 데이터가 필요해요. 아직 등록된 고객이 없어 생성을 시작할 수 없습니다.';

// ── 상시 배너 (입력부 위) ──────────────────────────────────────────────────
export function CustomerDataRequiredBanner({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-amber-400/25 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent px-4 py-3 ${className}`}>
      <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
        <Database className="w-4 h-4 text-amber-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-amber-100">고객 데이터가 없어요</p>
        <p className="text-[12px] text-amber-100/70 leading-relaxed mt-0.5">
          싱크에이전트 연동 또는 직접 업로드로 고객 데이터를 먼저 올리면 문안·타겟추출이 정확해집니다.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate('/manage')}
        className="shrink-0 self-center inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[12px] font-semibold transition-colors"
      >
        올리러 가기 <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── 생성 시도 차단 모달 ────────────────────────────────────────────────────
export function CustomerDataRequiredModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) { setShown(false); return; }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    const t = setTimeout(() => setShown(true), 10);
    return () => { window.removeEventListener('keydown', onEsc); clearTimeout(t); };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl transition-all duration-200 ${shown ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 상단 그라데이션 글로우 */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl" />

        {/* 헤더 */}
        <div className="relative flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-violet-300/80 uppercase">
                <Sparkles className="w-3 h-3" /> AI 문안 · 타겟추출
              </div>
              <h3 className="text-base font-semibold text-white mt-0.5">{TITLE}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {/* 본문 */}
        <div className="relative p-5 space-y-3">
          <p className="text-sm text-white/75 leading-relaxed">{LEAD}</p>

          {/* 직접 업로드 — 바로 실행 */}
          <button
            type="button"
            onClick={() => { onClose(); navigate('/manage'); }}
            className="group w-full text-left rounded-xl border border-emerald-400/25 bg-emerald-500/5 hover:bg-emerald-500/10 p-4 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5 text-emerald-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">엑셀·CSV 직접 업로드</p>
                <p className="text-[12px] text-white/55 mt-0.5">고객 관리에서 파일로 바로 올리기 — 가장 빠른 방법</p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-200 group-hover:gap-1.5 transition-all">
                올리러 가기 <ArrowRight className="w-4 h-4" />
              </span>
            </div>
          </button>

          {/* 싱크에이전트 — 운영자 배포라 안내 */}
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0">
                <RefreshCw className="w-5 h-5 text-cyan-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">회사 DB 자동 연동 (싱크에이전트)</p>
                <p className="text-[12px] text-white/55 mt-0.5">회사 DB를 주기적으로 자동 동기화 — 한줄로 담당자에게 문의해 주세요.</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-white/40">
            <Users className="w-3.5 h-3.5" />
            <span className="italic">Data source — customers (현재 등록 고객 0명)</span>
          </div>
        </div>

        {/* 액션 */}
        <div className="relative flex items-center gap-2 p-5 border-t border-white/10 bg-slate-950/50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
          >
            닫기
          </button>
          <button
            onClick={() => { onClose(); navigate('/manage'); }}
            className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white text-sm font-semibold shadow-lg shadow-violet-500/30 transition-colors inline-flex items-center justify-center gap-2"
          >
            <Upload className="w-4 h-4" /> 고객 데이터 올리러 가기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
