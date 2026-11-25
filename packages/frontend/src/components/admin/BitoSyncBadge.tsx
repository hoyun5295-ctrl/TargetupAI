/**
 * 비토엔진 업체 발신번호의 비토 허용번호 상태 한 칸(★ 2026-11-24 B-1124-3 · 설계서 docs/2026-11-24-callback-bito-sync-design.md §3)
 *   판정 = 서버(utils/bito-sender-sync.ts bitoSyncStatusOf) · 화면은 그 값을 이름 · 색으로만 바꾼다.
 *   마우스를 올리면 V 발송ID 마다 결과 · 확인 시각(펼침 대신 title · 표 안 한 줄 유지).
 */
export interface BitoSyncView {
  status: string;
  checkedAt: string | null;
  perV: Array<{ agentSendId: string; outcome: string | null; reason: string | null; roundAt: string | null }>;
}

const LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  registered: { text: '비토 등록됨', tone: 'ok' },
  manual_ok: { text: '비토 손 입력(사용)', tone: 'ok' },
  blocked_in_bito: { text: '비토에서 꺼 둠', tone: 'warn' },
  manual_blocked: { text: '비토 손 입력 · 꺼짐', tone: 'warn' },
  invalid: { text: '규격 위반', tone: 'bad' },
  agent_inactive: { text: '비토 에이전트 꺼짐', tone: 'bad' },
  customer_inactive: { text: '비토 고객사 꺼짐', tone: 'bad' },
  mapping_conflict: { text: '비토 매핑 충돌', tone: 'bad' },
  sync_error: { text: '비토 넣기 실패', tone: 'bad' },
  unmapped: { text: '비토 연결 없음', tone: 'bad' },
  checking: { text: '확인 중', tone: 'idle' },
  delayed: { text: '확인 지연', tone: 'warn' },
};

const TONE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-800',
  bad: 'bg-red-50 text-red-700',
  idle: 'bg-gray-100 text-gray-600',
};

const when = (iso: string | null) => {
  if (!iso) return '확인 전';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function BitoSyncBadge({ view }: { view: BitoSyncView | undefined }) {
  if (!view) return <span className="text-gray-400">-</span>;
  const label = LABEL[view.status] ?? { text: view.status, tone: 'idle' as const };
  const lines = view.perV.map((p) => `${p.agentSendId} · ${p.outcome ? (LABEL[p.outcome]?.text ?? p.outcome) : '확인 전'}${p.reason ? ` · ${p.reason}` : ''} · ${when(p.roundAt)}`);
  const title = [view.status === 'delayed' ? `마지막 확인 ${when(view.checkedAt)} · 비토 동기화가 5분 넘게 결과를 보내지 않았습니다` : '', ...lines].filter(Boolean).join('\n');
  return (
    <span className={`whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${TONE[label.tone]}`} title={title}>
      {label.text}
    </span>
  );
}
