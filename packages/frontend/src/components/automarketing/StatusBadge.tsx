// 자동마케팅 상태 배지 — 오퍼레이터/제안 공용 (2026-06-27)

const MAP: Record<string, { label: string; cls: string }> = {
  active: { label: '활성', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
  paused: { label: '일시중지', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  paused_no_credit: { label: '크레딧 부족', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  archived: { label: '보관', cls: 'bg-white/10 text-white/50' },
  pending: { label: '승인 대기', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  approved: { label: '승인됨', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
  rejected: { label: '거부됨', cls: 'bg-white/10 text-white/50' },
  auto_executed: { label: '자동 실행됨', cls: 'bg-violet-500/20 text-violet-300' },
  admin_review: { label: '검토 필요', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  scheduled: { label: '발송 예정', cls: 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30' },
  sending: { label: '발송 중', cls: 'bg-indigo-500/20 text-indigo-300' },
  sent: { label: '발송 완료', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
  skipped: { label: '이번 회차 생략', cls: 'bg-white/10 text-white/50' },
  admin_stopped: { label: '담당자 정지', cls: 'bg-rose-500/20 text-rose-300 border border-rose-400/30' },
  expired: { label: '만료됨', cls: 'bg-rose-500/20 text-rose-300 border border-rose-400/30' },
};

export default function StatusBadge({ status }: { status: string }) {
  const e = MAP[status] || { label: status, cls: 'bg-white/10 text-white/70' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
