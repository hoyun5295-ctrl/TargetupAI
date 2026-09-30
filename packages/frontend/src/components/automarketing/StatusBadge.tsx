// 자동마케팅 상태 배지 — 오퍼레이터/제안 공용 (2026-06-27)

const MAP: Record<string, { label: string; cls: string }> = {
  active: { label: '활성', cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  paused: { label: '일시중지', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  paused_no_credit: { label: '크레딧 부족', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  archived: { label: '보관', cls: 'bg-slate-100 text-slate-500' },
  pending: { label: '승인 대기', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  approved: { label: '승인됨', cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  rejected: { label: '거부됨', cls: 'bg-slate-100 text-slate-500' },
  auto_executed: { label: '자동 실행됨', cls: 'bg-violet-100 text-violet-700' },
  admin_review: { label: '검토 필요', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  scheduled: { label: '발송 예정', cls: 'bg-indigo-100 text-indigo-700 border border-indigo-200' },
  sending: { label: '발송 중', cls: 'bg-indigo-100 text-indigo-700' },
  sent: { label: '발송 완료', cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  skipped: { label: '이번 회차 생략', cls: 'bg-slate-100 text-slate-500' },
  admin_stopped: { label: '담당자 정지', cls: 'bg-rose-100 text-rose-700 border border-rose-200' },
  expired: { label: '만료됨', cls: 'bg-rose-100 text-rose-700 border border-rose-200' },
};

export default function StatusBadge({ status }: { status: string }) {
  const e = MAP[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
