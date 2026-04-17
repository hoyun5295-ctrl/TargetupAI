/**
 * AbTestModal — A/B 테스트 CRUD + 성과 비교 (D126 V2)
 *
 * 기능:
 *  - 목록 / 신규 생성 / 실행 제어 / 결과 보기 모드 (단일 모달 내 뷰 전환)
 *  - 좌측: 테스트 목록 + "새 A/B 테스트" 버튼
 *  - 우측: 선택한 테스트 상세 or 생성 폼
 *  - 최소 variant A + B 필수, variant C 선택
 *  - 가중치 0~100
 *  - 공개 URL: /api/dm/v/ab/:code
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import ModalBase, { ModalButton } from './ModalBase';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

type AbStatus = 'draft' | 'running' | 'paused' | 'completed';
type AbVariantKey = 'a' | 'b' | 'c';

type AbTest = {
  id: string;
  name: string;
  description: string | null;
  short_code: string | null;
  variant_a_page_id: string;
  variant_b_page_id: string;
  variant_c_page_id: string | null;
  variant_a_weight: number;
  variant_b_weight: number;
  variant_c_weight: number;
  primary_metric: 'view' | 'click' | 'conversion' | 'complete_rate';
  status: AbStatus;
  started_at: string | null;
  ended_at: string | null;
  result_summary: any;
  created_at: string;
};

type AbResult = {
  test: AbTest;
  variants: Array<{
    variant: AbVariantKey;
    page_id: string;
    views: number;
    unique_phones: number;
    avg_duration_sec: number;
    completion_rate: number;
    clicks: number;
  }>;
  winner: AbVariantKey | null;
  total_views: number;
};

type DmListItem = { id: string; title: string; short_code: string | null };

type View = 'list' | 'create' | 'detail';

const STATUS_LABEL: Record<AbStatus, { text: string; bg: string; fg: string }> = {
  draft: { text: '초안', bg: '#f3f4f6', fg: '#6b7280' },
  running: { text: '실행 중', bg: '#dcfce7', fg: '#15803d' },
  paused: { text: '일시정지', bg: '#fef3c7', fg: '#92400e' },
  completed: { text: '완료', bg: '#e0e7ff', fg: '#4338ca' },
};

const METRIC_LABEL: Record<string, string> = {
  view: '조회수',
  click: '클릭',
  conversion: '전환',
  complete_rate: '완독률',
};

export default function AbTestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currentDmId = useDmBuilderStore((s) => s.dmId);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [view, setView] = useState<View>('list');
  const [tests, setTests] = useState<AbTest[]>([]);
  const [dmList, setDmList] = useState<DmListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AbResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadAll();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = async () => {
    setLoading(true);
    try {
      const [tRes, dRes] = await Promise.all([
        api.get('/dm/ab-tests'),
        api.get('/dm?status=published&limit=100'),
      ]);
      setTests(tRes.data?.tests || []);
      const dms: DmListItem[] = (dRes.data?.dms || dRes.data || []).map((d: any) => ({
        id: d.id, title: d.title, short_code: d.short_code,
      }));
      setDmList(dms);
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '목록 조회 실패' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedId || view !== 'detail') return;
    void loadDetail(selectedId);
  }, [selectedId, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = async (id: string) => {
    try {
      const res = await api.get(`/dm/ab-tests/${id}`);
      setDetail(res.data);
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '조회 실패' });
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const handleCreateClick = () => {
    setSelectedId(null);
    setDetail(null);
    setView('create');
  };

  const handleCreated = async (newTest: AbTest) => {
    await loadAll();
    setSelectedId(newTest.id);
    setView('detail');
  };

  const handleAction = async (action: 'start' | 'pause' | 'complete' | 'delete') => {
    if (!selectedId) return;
    const test = tests.find((t) => t.id === selectedId);
    if (action === 'delete' && test && !window.confirm(`"${test.name}" A/B 테스트를 삭제할까요?`)) return;
    try {
      if (action === 'delete') {
        await api.delete(`/dm/ab-tests/${selectedId}`);
        setToast({ type: 'success', message: '삭제했어요.' });
        setSelectedId(null);
        setView('list');
      } else {
        await api.post(`/dm/ab-tests/${selectedId}/${action}`);
        const actionLabel = action === 'start' ? '시작' : action === 'pause' ? '일시정지' : '완료';
        setToast({ type: 'success', message: `A/B 테스트를 ${actionLabel}했어요.` });
        await loadDetail(selectedId);
      }
      await loadAll();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '실행 실패' });
    }
  };

  const footer = (
    <ModalButton variant="ghost" onClick={onClose}>닫기</ModalButton>
  );

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      size="xl"
      title="A/B 테스트"
      subtitle="2~3개 DM을 가중치로 분배하고 성과를 비교해 최적안을 찾아요."
      footer={footer}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, minHeight: 460 }}>
        <aside style={{ borderRight: '1px solid #e5e7eb', paddingRight: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={handleCreateClick}
            style={{
              height: 34,
              background: '#4f46e5',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              marginBottom: 8,
            }}
          >
            + 새 A/B 테스트
          </button>
          {loading && <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>불러오는 중...</div>}
          {!loading && tests.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              아직 A/B 테스트가 없어요.
            </div>
          )}
          {tests.map((t) => {
            const sl = STATUS_LABEL[t.status];
            return (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                style={{
                  textAlign: 'left',
                  padding: 10,
                  border: selectedId === t.id ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                  background: selectedId === t.id ? '#eef2ff' : '#fff',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, padding: '1px 5px', background: sl.bg, color: sl.fg, borderRadius: 3, fontWeight: 700 }}>
                    {sl.text}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  {t.variant_c_page_id ? '3' : '2'} variants · {new Date(t.created_at).toLocaleDateString('ko-KR')}
                </div>
              </button>
            );
          })}
        </aside>

        <main style={{ overflow: 'auto' }}>
          {view === 'list' && (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🔬</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>A/B 테스트를 선택하거나 새로 만들어 보세요</div>
              <div style={{ fontSize: 12 }}>같은 캠페인을 여러 문안으로 테스트하여 최적안을 찾을 수 있어요.</div>
            </div>
          )}

          {view === 'create' && (
            <CreateAbForm
              currentDmId={currentDmId}
              dmList={dmList}
              onCancel={() => setView('list')}
              onCreated={handleCreated}
              onToast={(t) => setToast(t)}
            />
          )}

          {view === 'detail' && detail && (
            <DetailView
              detail={detail}
              onAction={handleAction}
              dmList={dmList}
            />
          )}
        </main>
      </div>
    </ModalBase>
  );
}

// ────────────── 생성 폼 ──────────────

function CreateAbForm({
  currentDmId,
  dmList,
  onCancel,
  onCreated,
  onToast,
}: {
  currentDmId: string | null;
  dmList: DmListItem[];
  onCancel: () => void;
  onCreated: (test: AbTest) => void;
  onToast: (t: { type: 'success' | 'error' | 'info'; message: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [variantA, setVariantA] = useState(currentDmId || '');
  const [variantB, setVariantB] = useState('');
  const [variantC, setVariantC] = useState('');
  const [weightA, setWeightA] = useState(50);
  const [weightB, setWeightB] = useState(50);
  const [weightC, setWeightC] = useState(0);
  const [metric, setMetric] = useState<'view' | 'click' | 'conversion' | 'complete_rate'>('view');
  const [saving, setSaving] = useState(false);

  const totalWeight = weightA + weightB + (variantC ? weightC : 0);

  const handleSubmit = async () => {
    if (!name.trim() || !variantA || !variantB) {
      onToast({ type: 'error', message: '이름 / Variant A / Variant B는 필수예요.' });
      return;
    }
    if (totalWeight <= 0) {
      onToast({ type: 'error', message: '가중치 합은 0보다 커야 해요.' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/dm/ab-tests', {
        name,
        description,
        variant_a_page_id: variantA,
        variant_b_page_id: variantB,
        variant_c_page_id: variantC || null,
        variant_a_weight: weightA,
        variant_b_weight: weightB,
        variant_c_weight: variantC ? weightC : 0,
        primary_metric: metric,
      });
      onToast({ type: 'success', message: 'A/B 테스트를 만들었어요.' });
      onCreated(res.data.test);
    } catch (err: any) {
      onToast({ type: 'error', message: err?.response?.data?.error || '생성 실패' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>새 A/B 테스트</h3>

      <FieldBox label="이름" required>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 3월 봄세일 A/B"
          style={inputStyle}
        />
      </FieldBox>

      <FieldBox label="설명">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="테스트 목적 (선택)"
          style={inputStyle}
        />
      </FieldBox>

      <FieldBox label="성과 지표">
        <select value={metric} onChange={(e) => setMetric(e.target.value as any)} style={inputStyle}>
          {(['view', 'click', 'conversion', 'complete_rate'] as const).map((m) => (
            <option key={m} value={m}>{METRIC_LABEL[m]}</option>
          ))}
        </select>
      </FieldBox>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, alignItems: 'end' }}>
        <FieldBox label="Variant A" required>
          <DmSelect value={variantA} onChange={setVariantA} list={dmList} />
        </FieldBox>
        <FieldBox label="가중치">
          <input type="number" value={weightA} onChange={(e) => setWeightA(Number(e.target.value))} min={0} max={100} style={inputStyle} />
        </FieldBox>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, alignItems: 'end' }}>
        <FieldBox label="Variant B" required>
          <DmSelect value={variantB} onChange={setVariantB} list={dmList} />
        </FieldBox>
        <FieldBox label="가중치">
          <input type="number" value={weightB} onChange={(e) => setWeightB(Number(e.target.value))} min={0} max={100} style={inputStyle} />
        </FieldBox>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, alignItems: 'end' }}>
        <FieldBox label="Variant C (선택)">
          <DmSelect value={variantC} onChange={setVariantC} list={dmList} allowEmpty />
        </FieldBox>
        <FieldBox label="가중치">
          <input type="number" value={weightC} onChange={(e) => setWeightC(Number(e.target.value))} min={0} max={100} disabled={!variantC} style={inputStyle} />
        </FieldBox>
      </div>

      <div style={{ fontSize: 11, color: '#6b7280' }}>
        총 가중치: {totalWeight} · 방문자는 이 비율로 분배됩니다.
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={onCancel} style={{ ...buttonStyle, background: '#fff', border: '1px solid #d1d5db', color: '#374151' }}>
          취소
        </button>
        <button onClick={handleSubmit} disabled={saving} style={{ ...buttonStyle, background: '#4f46e5', color: '#fff', opacity: saving ? 0.6 : 1 }}>
          {saving ? '생성 중...' : '생성'}
        </button>
      </div>
    </div>
  );
}

// ────────────── 상세 뷰 ──────────────

function DetailView({
  detail,
  onAction,
  dmList,
}: {
  detail: AbResult;
  onAction: (a: 'start' | 'pause' | 'complete' | 'delete') => void;
  dmList: DmListItem[];
}) {
  const { test, variants, winner, total_views } = detail;
  const dmName = (id: string) => dmList.find((d) => d.id === id)?.title || id.slice(0, 8);

  const sl = STATUS_LABEL[test.status];
  const publicUrl = test.short_code ? `${window.location.origin}/api/dm/v/ab/${test.short_code}` : null;

  const maxMetric = useMemo(() => {
    const scores = variants.map((v) => pickMetric(v, test.primary_metric));
    return Math.max(...scores, 1);
  }, [variants, test.primary_metric]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, padding: '2px 8px', background: sl.bg, color: sl.fg, borderRadius: 10, fontWeight: 700 }}>
              {sl.text}
            </span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>{test.name}</h3>
          </div>
          {test.description && <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{test.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {test.status === 'draft' && (
            <button onClick={() => onAction('start')} style={{ ...buttonStyle, background: '#16a34a', color: '#fff' }}>▶ 시작</button>
          )}
          {test.status === 'running' && (
            <>
              <button onClick={() => onAction('pause')} style={{ ...buttonStyle, background: '#d97706', color: '#fff' }}>⏸ 일시정지</button>
              <button onClick={() => onAction('complete')} style={{ ...buttonStyle, background: '#4338ca', color: '#fff' }}>🏁 종료</button>
            </>
          )}
          {test.status === 'paused' && (
            <>
              <button onClick={() => onAction('start')} style={{ ...buttonStyle, background: '#16a34a', color: '#fff' }}>▶ 재개</button>
              <button onClick={() => onAction('complete')} style={{ ...buttonStyle, background: '#4338ca', color: '#fff' }}>🏁 종료</button>
            </>
          )}
          {test.status !== 'completed' && test.status !== 'running' && (
            <button onClick={() => onAction('delete')} style={{ ...buttonStyle, background: '#fff', border: '1px solid #dc2626', color: '#dc2626' }}>
              🗑 삭제
            </button>
          )}
        </div>
      </div>

      {publicUrl && (
        <div style={{ padding: 10, background: '#f0f9ff', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0c4a6e' }}>공개 URL</span>
          <code style={{ flex: 1, fontSize: 11, color: '#0369a1', background: '#fff', padding: '4px 8px', borderRadius: 4, overflow: 'auto' }}>
            {publicUrl}
          </code>
          <button
            onClick={() => { void navigator.clipboard?.writeText(publicUrl); }}
            style={{ ...buttonStyle, background: '#0284c7', color: '#fff', height: 28, fontSize: 11 }}
          >
            복사
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <StatBox label="총 조회수" value={String(total_views)} />
        <StatBox label="지표" value={METRIC_LABEL[test.primary_metric]} />
        <StatBox label="시작" value={test.started_at ? new Date(test.started_at).toLocaleString('ko-KR') : '—'} />
        {winner && <StatBox label="👑 승자" value={`Variant ${winner.toUpperCase()}`} highlight />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {variants.map((v) => {
          const score = pickMetric(v, test.primary_metric);
          const pct = (score / maxMetric) * 100;
          const isWinner = winner === v.variant;
          return (
            <div
              key={v.variant}
              style={{
                padding: 12,
                border: isWinner ? '2px solid #16a34a' : '1px solid #e5e7eb',
                background: isWinner ? '#f0fdf4' : '#fff',
                borderRadius: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: isWinner ? '#16a34a' : '#eef2ff', color: isWinner ? '#fff' : '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
                  {v.variant.toUpperCase()}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{dmName(v.page_id)}</span>
                {isWinner && <span style={{ fontSize: 10, padding: '2px 6px', background: '#16a34a', color: '#fff', borderRadius: 10, fontWeight: 700 }}>WINNER</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11, color: '#374151' }}>
                <Metric label="조회" value={v.views} />
                <Metric label="순방문" value={v.unique_phones} />
                <Metric label="평균체류" value={`${Math.round(v.avg_duration_sec)}초`} />
                <Metric label="완독률" value={`${Math.round(v.completion_rate * 100)}%`} />
              </div>
              <div style={{ marginTop: 8, background: '#f3f4f6', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: isWinner ? '#16a34a' : '#4f46e5',
                    transition: 'width 400ms',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pickMetric(v: AbResult['variants'][number], metric: string): number {
  if (metric === 'click') return v.clicks;
  if (metric === 'conversion') return v.clicks;
  if (metric === 'complete_rate') return v.completion_rate;
  return v.views;
}

// ────────────── 공통 ──────────────

function FieldBox({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
      </div>
      {children}
    </div>
  );
}

function DmSelect({ value, onChange, list, allowEmpty }: { value: string; onChange: (v: string) => void; list: DmListItem[]; allowEmpty?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      {allowEmpty && <option value="">사용 안 함</option>}
      {!allowEmpty && !value && <option value="">DM을 선택하세요</option>}
      {list.map((d) => (
        <option key={d.id} value={d.id}>{d.title || `(${d.id.slice(0, 8)})`}</option>
      ))}
    </select>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: 10,
      background: highlight ? '#f0fdf4' : '#f9fafb',
      border: `1px solid ${highlight ? '#86efac' : '#e5e7eb'}`,
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? '#15803d' : '#111827' }}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9ca3af' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 34,
  padding: '0 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

const buttonStyle: React.CSSProperties = {
  height: 32,
  padding: '0 12px',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
