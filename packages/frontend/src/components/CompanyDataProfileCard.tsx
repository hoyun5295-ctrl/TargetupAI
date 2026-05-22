/**
 * CompanyDataProfileCard.tsx — D210+ Phase 2-fix1 (Harold 명시 2026-05-23)
 *
 * 본질 = 마케팅 담당자 검토 UI 안내 카드.
 *   "AI가 우리 회사 데이터 이만큼 정확히 활용했네" 시각 확인 + 신뢰감.
 *
 * 매트릭스:
 *   - 안전 변수 (70%+) = emerald 톤 (무조건 활용)
 *   - 분기 변수 (30~70%) = amber 톤 (fallback 자동)
 *   - 차단 변수 (30% 미만) = rose 톤 (데이터 부족 — AI가 사용 못 함)
 *
 * Backend = GET /api/ai/operator/data-profile (CT-58 company-data-profile 활용).
 * 통합 = AiOperatorPage + JourneysPage 결과 영역.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Loader2, X } from 'lucide-react';

interface FieldEntry {
  field: string;
  label: string;
  percentVar?: string;
  fillRate: number;
}

interface DataProfileResponse {
  success: boolean;
  totalCustomers: number;
  safeFields: FieldEntry[];
  conditionalFields: FieldEntry[];
  blockedFields: FieldEntry[];
  analyzedAt: string;
}

interface CompanyDataProfileCardProps {
  className?: string;
}

export default function CompanyDataProfileCard({ className }: CompanyDataProfileCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<DataProfileResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ai/operator/data-profile', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          throw new Error(data.error || '회사 데이터 프로필 조회 실패');
        }
        setProfile(data);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className={`rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-violet-400/20 p-6 shadow-lg ${className || ''}`}>
        <div className="flex items-center justify-center gap-2 text-white/50 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>회사 데이터 활용 매트릭스 분석 중...</span>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className={`rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-6 shadow-lg ${className || ''}`}>
        <p className="text-xs text-white/50">회사 데이터 프로필 표시 영역 — {error || '데이터 없음'}</p>
      </div>
    );
  }

  const { totalCustomers, safeFields, conditionalFields, blockedFields, analyzedAt } = profile;

  if (totalCustomers === 0) {
    return (
      <div className={`rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-amber-400/20 p-6 shadow-lg ${className || ''}`}>
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-base font-bold text-white mb-1">아직 customer DB가 비어 있어요</p>
            <p className="text-xs text-white/60 leading-relaxed">
              고객 데이터를 업로드하면 AI가 개인화 변수를 정확하게 활용합니다.
              <br />지금은 모두에게 동일한 일반 안내 본문만 작성됩니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-violet-400/20 p-6 shadow-lg ${className || ''}`}>
      {/* 헤더 */}
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-lg flex-shrink-0">
          <Database className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-1 text-violet-200">Company Data Profile</p>
          <p className="text-base font-bold text-white">이 메시지에 활용된 회사 데이터</p>
          <p className="text-xs text-white/50 mt-0.5">
            총 {totalCustomers.toLocaleString()}명 customer DB 실측 분석 결과 — AI가 안전한 변수만 활용합니다
          </p>
        </div>
      </div>

      {/* 3단계 매트릭스 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 안전 변수 */}
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/30 p-4">
          <p className="text-xs font-semibold text-emerald-300 mb-1 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            안전 변수 ({safeFields.length})
          </p>
          <p className="text-[10px] text-white/50 mb-3">무조건 활용 · 70% 이상 채워짐</p>
          {safeFields.length > 0 ? (
            <div className="space-y-1.5">
              {safeFields.map((f) => (
                <div key={f.field} className="text-xs text-white/80 flex justify-between items-center">
                  <span className="truncate">%{f.percentVar || f.label}%</span>
                  <span className="text-emerald-300/90 tabular-nums text-[11px] ml-2 flex-shrink-0">{f.fillRate}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-white/40">해당 없음</p>
          )}
        </div>

        {/* 분기 변수 */}
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-4">
          <p className="text-xs font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            분기 변수 ({conditionalFields.length})
          </p>
          <p className="text-[10px] text-white/50 mb-3">fallback 자동 적용 · 30~70%</p>
          {conditionalFields.length > 0 ? (
            <div className="space-y-1.5">
              {conditionalFields.map((f) => (
                <div key={f.field} className="text-xs text-white/80 flex justify-between items-center">
                  <span className="truncate">%{f.percentVar || f.label}%</span>
                  <span className="text-amber-300/90 tabular-nums text-[11px] ml-2 flex-shrink-0">{f.fillRate}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-white/40">해당 없음</p>
          )}
        </div>

        {/* 차단 변수 */}
        <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 p-4">
          <p className="text-xs font-semibold text-rose-300 mb-1 flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" />
            차단 변수 ({blockedFields.length})
          </p>
          <p className="text-[10px] text-white/50 mb-3">데이터 부족 · AI가 사용 못 함</p>
          {blockedFields.length > 0 ? (
            <div className="space-y-1.5">
              {blockedFields.map((f) => (
                <div key={f.field} className="text-xs text-white/80 flex justify-between items-center">
                  <span className="truncate">{f.label}</span>
                  <span className="text-rose-300/90 tabular-nums text-[11px] ml-2 flex-shrink-0">{f.fillRate}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-white/40">해당 없음</p>
          )}
        </div>
      </div>

      {/* 푸터 */}
      <p className="text-[10px] text-white/40 mt-4 text-center">
        실측 분석 · {new Date(analyzedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 기준
      </p>
    </div>
  );
}
