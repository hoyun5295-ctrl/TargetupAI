import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import DragDropUpload from '../components/DragDropUpload';
import { SectionCard, Button, Input, DataTable, Badge, EmptyState, ConfirmModal, StatCard } from '../components/ui';

interface Customer {
  id: string; phone: string; name: string; gender?: string; age?: number;
  grade?: string; region?: string; store_name?: string; created_at: string;
}

export default function CustomerPage({ token }: { token: string }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // 업로드 상태
  const [showUpload, setShowUpload] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileData, setFileData] = useState<any[]>([]);
  const [fileId, setFileId] = useState('');
  const [showMapping, setShowMapping] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{ show: boolean; id: string; phone: string }>({ show: false, id: '', phone: '' });
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const jsonHeaders = { 'Content-Type': 'application/json' };
  const PER_PAGE = 20;

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (search.trim()) params.set('search', search.trim());
      const res = await apiFetch(`${API_BASE}/api/customers?${params}`);
      if (res.ok) {
        const d = await res.json();
        setCustomers(d.customers || d.data || []);
        setTotal(d.total || d.totalCount || 0);
      }
    } catch { }
    finally { setLoading(false); }
  }, [token, page, search]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // 검색 debounce
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 파일 업로드 → 파싱
  const handleFileSelect = async (file: File) => {
    setFileLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(`${API_BASE}/api/upload/parse?includeData=true`, {
        method: 'POST', body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setFileHeaders(data.headers);
        setFileData(data.allData || data.preview);
        setFileId(data.fileId || '');
        setShowMapping(true);
        setColumnMapping({});
      } else {
        setAlert({ show: true, title: '파일 오류', message: data.error || '파일 파싱에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '파일 업로드 중 오류가 발생했습니다.', type: 'error' });
    } finally { setFileLoading(false); }
  };

  // 매핑 적용 → 저장
  const handleMappingSave = async () => {
    if (!columnMapping.phone) {
      setAlert({ show: true, title: '매핑 오류', message: '전화번호 컬럼을 선택해주세요.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/upload/save`, {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ fileId, mapping: columnMapping }),
      });
      const data = await res.json();
      if (data.success) {
        setAlert({ show: true, title: '업로드 완료', message: `${data.savedCount || 0}건이 저장되었습니다.`, type: 'success' });
        setShowMapping(false); setShowUpload(false); setFileData([]); setFileHeaders([]); setFileId('');
        loadCustomers();
      } else {
        setAlert({ show: true, title: '저장 오류', message: data.error || '저장에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' });
    } finally { setSaving(false); }
  };

  // 고객 삭제
  const handleDelete = async (id: string) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/customers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setAlert({ show: true, title: '삭제 완료', message: '고객이 삭제되었습니다.', type: 'success' });
        setDeleteModal({ show: false, id: '', phone: '' });
        loadCustomers();
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '삭제 실패', type: 'error' });
    }
  };

  const totalPages = Math.ceil(total / PER_PAGE);
  const formatPhone = (p: string) => {
    if (!p) return '-';
    const n = p.replace(/-/g, '');
    if (n.length === 11) return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
    return p;
  };
  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth() + 1}.${dt.getDate()}`; };

  const MAPPING_FIELDS = [
    { key: 'phone', label: '전화번호', required: true },
    { key: 'name', label: '이름' },
    { key: 'gender', label: '성별' },
    { key: 'birth_date', label: '생년월일' },
    { key: 'grade', label: '등급' },
    { key: 'region', label: '지역' },
    { key: 'store_name', label: '매장명' },
    { key: 'email', label: '이메일' },
  ];

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-text">고객 DB</h2>
          <p className="text-xs text-text-muted mt-0.5">{total.toLocaleString()}명의 고객</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowUpload(!showUpload)}>
            {showUpload ? '닫기' : '엑셀 업로드'}
          </Button>
        </div>
      </div>

      {/* 업로드 영역 */}
      {showUpload && (
        <SectionCard title="고객 데이터 업로드" className="mb-6">
          <DragDropUpload loading={fileLoading} onFile={handleFileSelect} label="엑셀/CSV 파일을 드래그하거나 클릭하세요" hint=".xlsx, .xls, .csv 파일 지원" />
        </SectionCard>
      )}

      {/* 검색 */}
      <div className="mb-4">
        <Input
          placeholder="전화번호 또는 이름으로 검색..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          className="max-w-md"
        />
      </div>

      {/* 통계 */}
      {total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="전체 고객" value={total.toLocaleString()} />
        </div>
      )}

      {/* 고객 목록 */}
      {loading ? (
        <div className="text-center py-20 text-text-muted">로딩 중...</div>
      ) : customers.length === 0 ? (
        <EmptyState icon="👥" title={search ? '검색 결과가 없습니다' : '등록된 고객이 없습니다'} description={search ? '다른 검색어를 입력해보세요' : '엑셀 파일로 고객 데이터를 업로드하세요'} action={!search ? <Button onClick={() => setShowUpload(true)}>엑셀 업로드</Button> : undefined} />
      ) : (
        <>
          <DataTable
            columns={[
              { key: 'phone', label: '전화번호', render: (v) => <span className="font-mono text-sm">{formatPhone(v)}</span> },
              { key: 'name', label: '이름', render: (v) => <span className="font-medium text-text">{v || '-'}</span> },
              { key: 'gender', label: '성별', align: 'center', render: (v) => v ? <Badge variant="neutral">{v}</Badge> : <span className="text-text-muted">-</span> },
              { key: 'grade', label: '등급', align: 'center', render: (v) => v ? <Badge variant="brand">{v}</Badge> : <span className="text-text-muted">-</span> },
              { key: 'region', label: '지역', render: (v) => <span className="text-text-secondary">{v || '-'}</span> },
              { key: 'created_at', label: '등록일', align: 'center', render: (v) => <span className="text-text-muted text-xs">{fmtDate(v)}</span> },
              { key: 'id', label: '', align: 'center', render: (_, row) => <button onClick={() => setDeleteModal({ show: true, id: row.id, phone: row.phone })} className="text-xs text-error-500/60 hover:text-error-500">삭제</button> },
            ]}
            rows={customers}
          />

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-6">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg disabled:opacity-30 transition-colors">이전</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) p = i + 1;
                else if (page <= 4) p = i + 1;
                else if (page >= totalPages - 3) p = totalPages - 6 + i;
                else p = page - 3 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 text-xs font-semibold rounded-lg transition-colors ${page === p ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-bg'}`}
                  >{p}</button>
                );
              })}
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg disabled:opacity-30 transition-colors">다음</button>
              <span className="text-xs text-text-muted ml-2">{((page - 1) * PER_PAGE) + 1}~{Math.min(page * PER_PAGE, total)} / {total}</span>
            </div>
          )}
        </>
      )}

      {/* 컬럼 매핑 모달 */}
      {showMapping && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]">
          <div className="bg-surface rounded-2xl shadow-modal max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text">컬럼 매핑</h3>
              <p className="text-xs text-text-muted mt-1">엑셀 컬럼을 고객 필드에 매핑해주세요 ({fileData.length}건)</p>
            </div>
            <div className="p-6 space-y-3">
              {MAPPING_FIELDS.map(field => (
                <div key={field.key} className="flex items-center gap-4">
                  <label className="w-20 text-sm font-medium text-text flex-shrink-0">
                    {field.label} {field.required && <span className="text-error-500">*</span>}
                  </label>
                  <select value={columnMapping[field.key] || ''} onChange={e => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                    className="flex-1 px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-surface">
                    <option value="">선택 안 함</option>
                    {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}

              {fileData.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-text-secondary mb-2">미리보기 (상위 3건)</p>
                  <div className="bg-bg rounded-lg overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr>{fileHeaders.slice(0, 6).map(h => <th key={h} className="text-left px-2 py-1.5 font-semibold text-text-muted whitespace-nowrap">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {fileData.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-t border-border/30">
                            {fileHeaders.slice(0, 6).map(h => <td key={h} className="px-2 py-1.5 text-text-secondary whitespace-nowrap">{String(row[h] || '').substring(0, 20)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setShowMapping(false); setFileData([]); setFileHeaders([]); }}>취소</Button>
              <Button disabled={saving} onClick={handleMappingSave}>{saving ? '저장 중...' : `업로드 저장 (${fileData.length}건)`}</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal show={deleteModal.show} icon="🗑️" title="고객 삭제" message={`${formatPhone(deleteModal.phone)} 고객을 삭제하시겠습니까?`} danger confirmLabel="삭제" onConfirm={() => handleDelete(deleteModal.id)} onCancel={() => setDeleteModal({ show: false, id: '', phone: '' })} />
      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
