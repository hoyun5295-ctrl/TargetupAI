/**
 * VersionHistoryModal — 버전 히스토리 + side-by-side diff (D126 V2)
 *
 * 흐름:
 *  1. 모달 열릴 때 GET /api/dm/:id/versions
 *  2. 좌측: 버전 목록 (최신순) + "스냅샷 저장" 버튼
 *  3. 우측: 선택한 버전과 현재 내용을 나란히 — **실물 미리보기**(기본) 또는 코드 비교(줄 단위)
 *  4. "이 버전으로 복원" 버튼 → POST /versions/:vid/restore
 *
 * ★ 2026-08-24 실물 미리보기 신설 — 접수 cmt6qug4s00v1jnotsqeaf12g(임은지):
 *   "스냅샷을 비교하고 원하는 시점으로 복원할 수 있다"고 적어 놓고 실제로는 **JSON 로그**를 보여줬다.
 *   무엇이 어떻게 달라지는지 못 보면 복원을 누를 근거가 없다. 편집기와 같은 `SectionRenderer`로
 *   양쪽을 그대로 그린다(같은 부품을 써야 미리보기와 실물이 갈리지 않는다).
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useDmBuilderStore, selectAllSectionsFlat } from '../../../stores/dmBuilderStore';
import { diffByLine, type DiffChunk } from '../../../utils/dm-text-diff';
import { PageErrorBoundary } from '../../../lib/lazy-page';
import SectionRenderer from '../canvas/SectionRenderer';
import ModalBase, { ModalButton } from './ModalBase';
import ConfirmModal, { type ConfirmState } from '../../ConfirmModal';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

type Version = {
  id: string;
  version_label: string;
  version_number: number;
  note: string | null;
  created_by: string;
  created_at: string;
  sections: any;
  brand_kit: any;
};

export default function VersionHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dmId = useDmBuilderStore((s) => s.dmId);
  /** 버전 diff는 전체 DM(모든 페이지의 섹션) 기준 */
  const currentSections = useDmBuilderStore(selectAllSectionsFlat);
  const loadDm = useDmBuilderStore((s) => s.loadDm);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  // ★ D216+ ConfirmModal generic (native confirm 영구 폐기)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => {
    if (!open || !dmId) return;
    void loadVersions();
  }, [open, dmId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadVersions = async () => {
    if (!dmId) return;
    setLoading(true);
    try {
      const res = await api.get(`/dm/${dmId}/versions`);
      const list: Version[] = res.data?.versions || [];
      // sections/brand_kit이 string이면 parse
      const parsed = list.map((v) => ({
        ...v,
        sections: typeof v.sections === 'string' ? safeJSON(v.sections, []) : v.sections,
        brand_kit: typeof v.brand_kit === 'string' ? safeJSON(v.brand_kit, {}) : v.brand_kit,
      }));
      setVersions(parsed);
      if (parsed.length > 0 && !selectedId) setSelectedId(parsed[0].id);
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '버전 목록 조회 실패' });
    } finally {
      setLoading(false);
    }
  };

  const selectedVersion = versions.find((v) => v.id === selectedId);
  // 기본은 실물이다. 코드 비교는 정확하지만 "무엇이 달라 보이는가"를 알려주지 못한다(접수 원문)
  const [compareMode, setCompareMode] = useState<'preview' | 'code'>('preview');

  const diffChunks = useMemo(() => {
    if (!selectedVersion) return [] as DiffChunk[];
    const left = JSON.stringify(selectedVersion.sections || [], null, 2);
    const right = JSON.stringify(currentSections || [], null, 2);
    return diffByLine(left, right);
  }, [selectedVersion, currentSections]);

  const handleSaveSnapshot = async () => {
    if (!dmId || !label.trim()) {
      setToast({ type: 'error', message: '버전 이름을 입력해주세요.' });
      return;
    }
    setSaveLoading(true);
    try {
      await api.post(`/dm/${dmId}/versions`, { label, note: note || null });
      setLabel('');
      setNote('');
      setToast({ type: 'success', message: '스냅샷을 저장했어요.' });
      await loadVersions();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '저장 실패' });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!dmId || !selectedVersion) return;
    setConfirm({
      mode: 'warning',
      title: '버전 복원',
      description: `"${selectedVersion.version_label}" 버전으로 복원할까요? 현재 작업 내용이 덮어써져요.`,
      confirmLabel: '복원',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          await api.post(`/dm/${dmId}/versions/${selectedVersion.id}/restore`);
          await loadDm(dmId);
          setToast({ type: 'success', message: '복원 완료.' });
          onClose();
        } catch (err: any) {
          setToast({ type: 'error', message: err?.response?.data?.error || '복원 실패' });
        }
      },
    });
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={onClose}>닫기</ModalButton>
      {selectedVersion && (
        <ModalButton variant="primary" onClick={handleRestore}>
          ↺ 이 버전으로 복원
        </ModalButton>
      )}
    </>
  );

  return (
    <>
    <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    <ModalBase
      open={open}
      onClose={onClose}
      size="xl"
      title="버전 히스토리"
      subtitle="과거 스냅샷을 비교하고 원하는 시점으로 복원할 수 있어요."
      badge={versions.length > 0 ? <span style={{ fontSize: 11, padding: '2px 8px', background: '#eef2ff', color: '#4f46e5', borderRadius: 10, fontWeight: 700 }}>{versions.length}개</span> : null}
      footer={footer}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, height: 'calc(90vh - 260px)', minHeight: 380 }}>
        {/* 좌측: 버전 목록 */}
        <div style={{ borderRight: '1px solid #e5e7eb', paddingRight: 12, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'sticky', top: 0, background: '#fff', paddingBottom: 8, borderBottom: '1px solid #e5e7eb', zIndex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>새 스냅샷 저장</div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="버전 이름 (예: 1차 검수 통과)"
              style={{ width: '100%', height: 32, padding: '0 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, marginBottom: 6 }}
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="메모 (선택)"
              rows={2}
              style={{ width: '100%', padding: 6, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <button
              onClick={handleSaveSnapshot}
              disabled={saveLoading || !label.trim()}
              style={{
                width: '100%',
                height: 32,
                marginTop: 6,
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: saveLoading || !label.trim() ? 'not-allowed' : 'pointer',
                opacity: saveLoading || !label.trim() ? 0.6 : 1,
              }}
            >
              {saveLoading ? '저장 중...' : '💾 스냅샷 저장'}
            </button>
          </div>

          {loading && <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>불러오는 중...</div>}
          {!loading && versions.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              아직 스냅샷이 없어요.
            </div>
          )}

          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelectedId(v.id)}
              style={{
                textAlign: 'left',
                padding: 10,
                border: selectedId === v.id ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                background: selectedId === v.id ? '#eef2ff' : '#fff',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 10, padding: '1px 6px', background: '#e5e7eb', color: '#374151', borderRadius: 4, fontWeight: 700 }}>
                  v{v.version_number}
                </span>
                <span style={{ fontWeight: 600, color: '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.version_label}
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>
                {new Date(v.created_at).toLocaleString('ko-KR')}
              </div>
              {v.note && (
                <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.note}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* 우측: 실물 미리보기(기본) · 코드 비교 */}
        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedVersion ? (
            <>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, padding: '2px 8px', background: '#f3f4f6', borderRadius: 10, color: '#374151', fontWeight: 600 }}>
                  v{selectedVersion.version_number}
                </span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>vs</span>
                <span style={{ fontSize: 11, padding: '2px 8px', background: '#eef2ff', color: '#4f46e5', borderRadius: 10, fontWeight: 700 }}>
                  현재 작업본
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {(['preview', 'code'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setCompareMode(m)}
                      style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${compareMode === m ? '#4f46e5' : '#e5e7eb'}`,
                        background: compareMode === m ? '#eef2ff' : '#fff',
                        color: compareMode === m ? '#4f46e5' : '#6b7280',
                      }}
                    >
                      {m === 'preview' ? '미리보기' : '코드 비교'}
                    </button>
                  ))}
                </div>
              </div>
              {compareMode === 'preview' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, overflow: 'auto', flex: 1 }}>
                  <PhonePreview title={`v${selectedVersion.version_number} ${selectedVersion.version_label}`} sections={selectedVersion.sections} />
                  <PhonePreview title="현재 작업본" sections={currentSections} accent />
                </div>
              ) : (
                <DiffView chunks={diffChunks} />
              )}
            </>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              버전을 선택하면 현재 작업본과의 차이를 볼 수 있어요.
            </div>
          )}
        </div>
      </div>
    </ModalBase>
    </>
  );
}

/**
 * 버전 하나를 **편집기와 같은 부품으로** 그린다(★2026-08-24 · 접수 임은지).
 * ⛔ 미리보기 전용 렌더러를 새로 만들지 않는다 — 두 벌이 되는 순간 "미리보기와 실물이 다르다"가 생긴다.
 * 보기 전용이라 클릭을 먹지 않게 하고, 좁은 칸에 담으려 폭 375를 기준으로 축소한다.
 */
function PhonePreview({ title, sections, accent }: { title: string; sections: any; accent?: boolean }) {
  const list = Array.isArray(sections) ? sections.filter((x: any) => x && x.visible !== false) : [];
  const SCALE = 0.62;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, marginBottom: 6, color: accent ? '#4f46e5' : '#374151',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {title}
      </div>
      <div style={{
        border: `1px solid ${accent ? '#c7d2fe' : '#e5e7eb'}`, borderRadius: 12, background: '#fff',
        overflow: 'auto', flex: 1, minHeight: 0,
      }}>
        {list.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>표시할 내용이 없어요.</div>
        ) : (
          // ⛔ 옛 버전은 지금 없는 섹션 모양일 수 있다. 그리다 터지면 모달이 아니라 **화면 전체**가 날아가므로
          //   경계를 두고 코드 비교로 안내한다(미리보기가 없다고 복원까지 막히면 안 된다).
          <PageErrorBoundary fallback={
            <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
              이 버전은 미리보기를 그릴 수 없어요. "코드 비교"로 확인해 주세요.
            </div>
          }>
            {/* `zoom`을 쓰는 이유: `transform: scale`은 **레이아웃 높이를 줄이지 않아** 아래로 빈 공간이 남는다 */}
            <div style={{ zoom: SCALE, pointerEvents: 'none', userSelect: 'none' }}>
              {list.map((sec: any, i: number) => (
                <SectionRenderer key={sec.id || i} section={sec} readOnly />
              ))}
            </div>
          </PageErrorBoundary>
        )}
      </div>
    </div>
  );
}

function DiffView({ chunks }: { chunks: DiffChunk[] }) {
  const summary = useMemo(() => {
    let added = 0;
    let removed = 0;
    let replaced = 0;
    for (const c of chunks) {
      if (c.op === 'insert') added += c.after.split('\n').length;
      else if (c.op === 'delete') removed += c.before.split('\n').length;
      else if (c.op === 'replace') replaced += Math.max(c.before.split('\n').length, c.after.split('\n').length);
    }
    return { added, removed, replaced };
  }, [chunks]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, fontSize: 11, marginBottom: 6, color: '#6b7280' }}>
        <span>+{summary.added} 추가</span>
        <span>-{summary.removed} 삭제</span>
        <span>~{summary.replaced} 변경</span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
          fontSize: 11,
          lineHeight: 1.6,
          background: '#fafafa',
          padding: 10,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {chunks.map((c, i) => {
          if (c.op === 'equal') {
            return <div key={i} style={{ color: '#6b7280' }}>{c.before}</div>;
          }
          if (c.op === 'insert') {
            return (
              <div key={i} style={{ background: '#dcfce7', color: '#14532d' }}>
                + {c.after}
              </div>
            );
          }
          if (c.op === 'delete') {
            return (
              <div key={i} style={{ background: '#fee2e2', color: '#7f1d1d' }}>
                - {c.before}
              </div>
            );
          }
          return (
            <div key={i}>
              <div style={{ background: '#fee2e2', color: '#7f1d1d' }}>- {c.before}</div>
              <div style={{ background: '#dcfce7', color: '#14532d' }}>+ {c.after}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function safeJSON<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
