/**
 * JourneyPauseLogsModal.tsx — D218+ (2026-05-26) 신설
 *
 * 본질: 여정 정지 이력 표시 — 담당자 단축 URL 정지 / 자동 잔액 정지 / 자동 통신사 fail 정지 / 자동 phone 무효 정지 통합 영구 기록.
 *   - GET /api/ai/operator/journeys/:id/pause-logs?limit=50 호출
 *   - 표시: 시각 + 사유 + 담당자 phone + 본문 미리보기 + 타겟 수 + execution status at pause
 *   - 검색 (본문) + 필터 (사유별) + 정렬 (시각 desc default)
 *   - 다크 톤 + Source caption + 모바일 반응형
 *
 * 영구 룰 정합:
 *   - feedback_design_quality_minimum_journey_level (다크 톤 + violet 액센트 + Source caption)
 *   - feedback_no_native_browser_dialog (커스텀 모달 + useToast)
 */

import { useState, useEffect, useMemo } from 'react';
import {
  X, History, Search, Filter, AlertTriangle, Wallet,
  PhoneOff, Wifi, UserCircle2, Loader2, MessageSquare,
} from 'lucide-react';

interface Props {
  journeyId: string;
  journeyName: string;
  onClose: () => void;
  token: string;
}

interface PauseLogRow {
  id: string;
  company_id: string;
  journey_id: string;
  step_id: string;
  execution_id: string | null;
  snapshot_id: string | null;
  pause_reason: string;
  pause_trigger_source: string | null;
  paused_at: string;
  paused_phone: string | null;
  message_body_snapshot: string | null;
  target_count_snapshot: number | null;
  execution_status_at_pause: string | null;
  journey_name?: string;
  step_order?: number;
  channel?: string;
}

const REASON_CONFIG: Record<string, { label: string; icon: typeof AlertTriangle; color: string; bg: string }> = {
  manager_manual: {
    label: '담당자 단축 URL 정지',
    icon: UserCircle2,
    color: 'text-cyan-300',
    bg: 'bg-cyan-500/15 border-cyan-400/40',
  },
  balance_insufficient: {
    label: '잔액 부족 자동 정지',
    icon: Wallet,
    color: 'text-rose-300',
    bg: 'bg-rose-500/15 border-rose-400/40',
  },
  carrier_temp_fail: {
    label: '통신사 일시 fail 정지',
    icon: Wifi,
    color: 'text-amber-300',
    bg: 'bg-amber-500/15 border-amber-400/40',
  },
  phone_invalid: {
    label: 'phone 무효 자동 정지',
    icon: PhoneOff,
    color: 'text-orange-300',
    bg: 'bg-orange-500/15 border-orange-400/40',
  },
  admin_manual: {
    label: '관리자 직접 정지',
    icon: UserCircle2,
    color: 'text-violet-300',
    bg: 'bg-violet-500/15 border-violet-400/40',
  },
  race_after_send: {
    label: '발송 직후 정지 (race)',
    icon: AlertTriangle,
    color: 'text-fuchsia-300',
    bg: 'bg-fuchsia-500/15 border-fuchsia-400/40',
  },
  auto_retry_exhausted: {
    label: '자동 재시도 1회 종결 정지',
    icon: Wifi,
    color: 'text-amber-300',
    bg: 'bg-amber-500/15 border-amber-400/40',
  },
};

const ALL_FILTER = '__ALL__';

export default function JourneyPauseLogsModal({ journeyId, journeyName, onClose, token }: Props) {
  const [logs, setLogs] = useState<PauseLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [reasonFilter, setReasonFilter] = useState<string>(ALL_FILTER);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/pause-logs?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 503) {
        setError('잠시 후 다시 시도해 주세요.');
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setLogs(Array.isArray(data?.logs) ? data.logs : []);
      } else {
        setError(data?.error || '이력 조회 사고');
      }
    } catch (e: any) {
      setError(e?.message || '조회 호출 사고');
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = useMemo(() => {
    let out = [...logs];
    if (reasonFilter !== ALL_FILTER) {
      out = out.filter((l) => l.pause_reason === reasonFilter);
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      out = out.filter((l) =>
        String(l.message_body_snapshot || '').toLowerCase().includes(kw) ||
        String(l.paused_phone || '').toLowerCase().includes(kw) ||
        String(l.pause_trigger_source || '').toLowerCase().includes(kw),
      );
    }
    return out;
  }, [logs, reasonFilter, searchKeyword]);

  // 사유별 카운트 — 필터 옵션 영역
  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach((l) => {
      counts[l.pause_reason] = (counts[l.pause_reason] || 0) + 1;
    });
    return counts;
  }, [logs]);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-fuchsia-500/10 via-violet-500/10 to-purple-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
              <History className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                정지 이력 영구 기록
              </h3>
              <p className="text-[11px] text-white/50 mt-0.5">{journeyName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {/* 검색 + 필터 */}
        <div className="p-4 border-b border-white/10 bg-slate-950/30 flex flex-col md:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="본문 / 담당자 phone / trigger source"
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/40"
            />
          </div>
          <div className="relative md:w-56">
            <Filter className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-400/40 appearance-none"
            >
              <option value={ALL_FILTER}>전체 사유 ({logs.length})</option>
              {Object.entries(reasonCounts).map(([reason, count]) => (
                <option key={reason} value={reason}>
                  {REASON_CONFIG[reason]?.label || reason} ({count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="text-center py-10 text-[12px] text-white/50 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-violet-300" />
              정지 이력 조회 중
            </div>
          )}

          {!loading && error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-400/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-300 flex-shrink-0 mt-0.5" />
                <div className="text-[12px] text-rose-100">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && filteredLogs.length === 0 && (
            <div className="text-center py-10">
              <History className="w-10 h-10 text-white/20 mx-auto mb-2" />
              <div className="text-[13px] text-white/50">정지 이력 없음</div>
              <div className="text-[11px] text-white/30 mt-1">
                담당자 단축 URL 정지 / 자동 정지 발화 시 본 영역에 영구 기록
              </div>
            </div>
          )}

          {!loading && !error && filteredLogs.length > 0 && (
            <div className="space-y-2">
              {filteredLogs.map((log) => {
                const config = REASON_CONFIG[log.pause_reason] || REASON_CONFIG.admin_manual;
                const Icon = config.icon;
                const pausedAt = new Date(log.paused_at);
                const dateStr = pausedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                return (
                  <div key={log.id} className={`p-3 rounded-xl border ${config.bg}`}>
                    <div className="flex items-start gap-3">
                      <Icon className={`w-4 h-4 ${config.color} flex-shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`text-[12px] font-semibold ${config.color}`}>
                            {config.label}
                          </span>
                          {log.step_order != null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono">
                              step {log.step_order}
                            </span>
                          )}
                          {log.channel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono uppercase">
                              {log.channel}
                            </span>
                          )}
                          {log.execution_status_at_pause && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 font-mono">
                              prev: {log.execution_status_at_pause}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/60 mb-1.5">
                          {dateStr}
                          {log.paused_phone && (
                            <span className="ml-2 font-mono">📞 {log.paused_phone}</span>
                          )}
                          {log.target_count_snapshot != null && log.target_count_snapshot > 0 && (
                            <span className="ml-2">타겟 {log.target_count_snapshot.toLocaleString()}명</span>
                          )}
                        </div>
                        {log.message_body_snapshot && (
                          <div className="mt-2 p-2 rounded-lg bg-black/30 border border-white/5">
                            <div className="flex items-center gap-1 mb-1 text-[10px] text-white/40">
                              <MessageSquare className="w-3 h-3" />
                              snapshot 본문 (활성화 시점)
                            </div>
                            <div className="text-[11px] text-white/70 whitespace-pre-wrap leading-relaxed">
                              {log.message_body_snapshot.slice(0, 200)}
                              {log.message_body_snapshot.length > 200 && <span className="text-white/30">...</span>}
                            </div>
                          </div>
                        )}
                        {log.pause_trigger_source && (
                          <div className="mt-2 text-[10px] text-white/30 font-mono">
                            trigger source: {log.pause_trigger_source}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 푸터 — Source caption */}
        <div className="px-5 py-3 border-t border-white/10 bg-slate-950/50">
          <div className="text-[10px] text-white/30 italic">
            Data source: journey_step_pause_logs (D218+ 영구 기록 테이블) · 정지 효과 + execution_status_at_pause 추적
          </div>
        </div>
      </div>
    </div>
  );
}
