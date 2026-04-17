/**
 * AiImproveModal — AI가 섹션별 카피 개선 제안을 diff 형태로 표시 (D126 V2)
 *
 * 흐름:
 *  1. 모달 열릴 때 POST /api/dm/ai/improve 호출
 *  2. ImprovementSuggestion[] 받아와서 섹션별 diff 표시
 *  3. 각 제안마다 수락/거부 버튼
 *  4. "모두 적용" / "선택만 적용" 옵션
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import { diffByWord, type DiffChunk } from '../../../utils/dm-text-diff';
import ModalBase, { ModalButton } from './ModalBase';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

type Suggestion = {
  section_id: string;
  field: string;
  before: string;
  after: string;
  reason: string;
};

type Decision = 'pending' | 'accept' | 'reject';

export default function AiImproveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sections = useDmBuilderStore((s) => s.sections);
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      setSuggestions([]);
      setDecisions({});
      try {
        const res = await api.post('/dm/ai/improve', { sections, brand_kit: brandKit });
        if (cancelled) return;
        const list: Suggestion[] = res.data?.suggestions || [];
        setSuggestions(list);
        const initial: Record<number, Decision> = {};
        list.forEach((_, i) => (initial[i] = 'pending'));
        setDecisions(initial);
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || err?.message || '분석 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  const pendingCount = useMemo(
    () => Object.values(decisions).filter((d) => d === 'pending').length,
    [decisions],
  );
  const acceptedCount = useMemo(
    () => Object.values(decisions).filter((d) => d === 'accept').length,
    [decisions],
  );

  const setDecision = (idx: number, d: Decision) => {
    setDecisions((prev) => ({ ...prev, [idx]: d }));
  };

  const acceptAll = () => {
    const next: Record<number, Decision> = {};
    suggestions.forEach((_, i) => (next[i] = 'accept'));
    setDecisions(next);
  };

  const rejectAll = () => {
    const next: Record<number, Decision> = {};
    suggestions.forEach((_, i) => (next[i] = 'reject'));
    setDecisions(next);
  };

  const handleApply = () => {
    let applied = 0;
    suggestions.forEach((s, i) => {
      if (decisions[i] === 'accept') {
        updateSectionProps(s.section_id, { [s.field]: s.after } as any);
        applied++;
      }
    });
    if (applied > 0) {
      setToast({ type: 'success', message: `${applied}개 개선 제안을 적용했어요.` });
    } else {
      setToast({ type: 'info', message: '적용할 제안이 없어요.' });
    }
    onClose();
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={onClose}>닫기</ModalButton>
      {suggestions.length > 0 && (
        <>
          <ModalButton variant="secondary" onClick={rejectAll}>전체 거부</ModalButton>
          <ModalButton variant="secondary" onClick={acceptAll}>전체 수락</ModalButton>
          <ModalButton variant="primary" onClick={handleApply} disabled={acceptedCount === 0}>
            적용 ({acceptedCount}건)
          </ModalButton>
        </>
      )}
    </>
  );

  const getSectionType = (id: string) => sections.find((s) => s.id === id)?.type || '';

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      size="lg"
      title="AI 문안 개선 제안"
      subtitle="각 제안을 확인하고 수락 또는 거부하세요. 거부한 항목은 원본을 유지해요."
      badge={
        suggestions.length > 0 ? (
          <span style={{ fontSize: 11, padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 10, fontWeight: 700 }}>
            {suggestions.length}건 제안
          </span>
        ) : null
      }
      footer={footer}
    >
      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          AI가 카피를 분석하고 있어요...
          <div style={{ marginTop: 8, fontSize: 11 }}>5~10초 걸려요.</div>
        </div>
      )}

      {error && !loading && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', fontSize: 13, borderRadius: 6 }}>
          {error}
        </div>
      )}

      {!loading && !error && suggestions.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>카피가 이미 좋아요!</div>
          <div style={{ fontSize: 12 }}>AI가 특별히 개선할 부분을 찾지 못했어요.</div>
        </div>
      )}

      {!loading && suggestions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
            대기 {pendingCount}건 · 수락 {acceptedCount}건 · 거부 {Object.values(decisions).filter((d) => d === 'reject').length}건
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {suggestions.map((s, i) => (
              <SuggestionCard
                key={i}
                idx={i}
                suggestion={s}
                sectionType={getSectionType(s.section_id)}
                decision={decisions[i] || 'pending'}
                onDecide={(d) => setDecision(i, d)}
              />
            ))}
          </div>
        </div>
      )}
    </ModalBase>
  );
}

function SuggestionCard({
  suggestion,
  sectionType,
  decision,
  onDecide,
}: {
  idx: number;
  suggestion: Suggestion;
  sectionType: string;
  decision: Decision;
  onDecide: (d: Decision) => void;
}) {
  const chunks = useMemo(
    () => diffByWord(suggestion.before, suggestion.after),
    [suggestion.before, suggestion.after],
  );

  const bgByDecision: Record<Decision, string> = {
    pending: '#fff',
    accept: '#f0fdf4',
    reject: '#fef2f2',
  };

  return (
    <div
      style={{
        border: '1px solid ' + (decision === 'accept' ? '#86efac' : decision === 'reject' ? '#fca5a5' : '#e5e7eb'),
        borderRadius: 10,
        padding: 14,
        background: bgByDecision[decision],
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, padding: '2px 6px', background: '#eef2ff', color: '#4f46e5', borderRadius: 4, fontWeight: 700 }}>
          {sectionType}
        </span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{suggestion.field}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => onDecide('reject')}
            style={{
              height: 28,
              padding: '0 10px',
              fontSize: 11,
              fontWeight: 600,
              border: decision === 'reject' ? '1px solid #dc2626' : '1px solid #d1d5db',
              background: decision === 'reject' ? '#dc2626' : '#fff',
              color: decision === 'reject' ? '#fff' : '#6b7280',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            거부
          </button>
          <button
            type="button"
            onClick={() => onDecide('accept')}
            style={{
              height: 28,
              padding: '0 10px',
              fontSize: 11,
              fontWeight: 600,
              border: decision === 'accept' ? '1px solid #16a34a' : '1px solid #d1d5db',
              background: decision === 'accept' ? '#16a34a' : '#fff',
              color: decision === 'accept' ? '#fff' : '#6b7280',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            수락
          </button>
        </div>
      </div>

      <DiffRender chunks={chunks} />

      {suggestion.reason && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#4b5563', fontStyle: 'italic' }}>
          💡 {suggestion.reason}
        </div>
      )}
    </div>
  );
}

function DiffRender({ chunks }: { chunks: DiffChunk[] }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 10,
        fontSize: 13,
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {chunks.map((c, i) => {
        if (c.op === 'equal') return <span key={i}>{c.before}</span>;
        if (c.op === 'insert') return <span key={i} className="dm-diff-insert">{c.after}</span>;
        if (c.op === 'delete') return <span key={i} className="dm-diff-delete">{c.before}</span>;
        // replace
        return (
          <span key={i}>
            <span className="dm-diff-replace-before">{c.before}</span>
            <span className="dm-diff-replace-after">{c.after}</span>
          </span>
        );
      })}
    </div>
  );
}
