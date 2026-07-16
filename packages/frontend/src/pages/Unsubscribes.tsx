import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateTime, formatPhoneNumber } from '../utils/formatDate';
import {
  Ban, Search, Plus, Upload, RefreshCw, Trash2, Phone,
  ChevronLeft, ChevronRight, ArrowLeft, CheckCircle2, Info, AlertCircle, ShieldAlert,
  Download,
} from 'lucide-react';

export default function Unsubscribes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [unsubscribes, setUnsubscribes] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ show: false, type: '', message: '' });
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; id: string; phone: string }>({ show: false, id: '', phone: '' });
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // ★ 엑셀/CSV 업로드 열 선택 (여러 열이면 전화번호 열을 고르게 함)
  const [columnPicker, setColumnPicker] = useState<{ show: boolean; fileId: string; columns: Array<{ index: number; header: string; samples: string[]; phoneCount: number }>; selected: number; totalRows: number }>({ show: false, fileId: '', columns: [], selected: 0, totalRows: 0 });
  const [pickerSubmitting, setPickerSubmitting] = useState(false);
  // D43-4: 080 연동 상태
  const [opt080Number, setOpt080Number] = useState('');
  const [optOutAutoSync, setOptOutAutoSync] = useState(false);
  const [syncTesting, setSyncTesting] = useState(false);
  const [syncTestModal, setSyncTestModal] = useState(false);
  // ★ D162-3 격리 ON + 고객사관리자 = 등록/삭제 UI 비활성화 + 안내 메시지
  const [canManageUnsubscribes, setCanManageUnsubscribes] = useState(true);
  const [userIsolationEnabled, setUserIsolationEnabled] = useState(false);

  useEffect(() => {
    loadUnsubscribes();
  }, [pagination.page]);

  const loadUnsubscribes = async (): Promise<any[]> => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      });
      if (search) params.append('search', search);

      const res = await fetch(`/api/unsubscribes?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const items = data.unsubscribes || [];
        setUnsubscribes(items);
        setPagination(prev => ({ ...prev, ...data.pagination }));
        // D43-4: 080 설정 정보 수신
        setOpt080Number(data.opt080Number || '');
        setOptOutAutoSync(data.optOutAutoSync || false);
        // ★ D162-3 격리 ON + 고객사관리자 = 등록/삭제 UI 차단
        setCanManageUnsubscribes(data.canManageUnsubscribes !== false);
        setUserIsolationEnabled(data.userIsolationEnabled === true);
        return items;
      }
    } catch (error) {
      console.error('수신거부 목록 로드 실패:', error);
    } finally {
      setLoading(false);
    }
    return [];
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadUnsubscribes();
  };

  // ★ 2026-06-13: 수신거부 전체 엑셀(CSV) 다운로드 — 현재 검색 조건 그대로 서버에서 전체 생성
  const handleExportAll = async () => {
    try {
      setExporting(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      const res = await fetch(`/api/unsubscribes/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `수신거부_전체_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setToast({ show: true, type: 'error', message: '다운로드에 실패했습니다. 잠시 후 다시 시도해주세요.' });
      setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
    } finally {
      setExporting(false);
    }
  };

  const handleAdd = async () => {
    const cleaned = newPhone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setToast({ show: true, type: 'error', message: '올바른 전화번호를 입력하세요' });
      setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/unsubscribes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: cleaned }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '등록되었습니다' });
        setNewPhone('');
        loadUnsubscribes();
      } else {
        setToast({ show: true, type: 'error', message: data.error || '등록 실패' });
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '등록 실패' });
    }
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.id) return;
    setDeleting(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/unsubscribes/${deleteModal.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '삭제되었습니다. 수신동의로 복원됩니다.' });
      } else {
        // 6원칙 ②: 실제 삭제 0건이면 성공 토스트 금지 — 정직 안내 + 목록 재조회로 진실 반영
        setToast({ show: true, type: 'error', message: data.error || '삭제된 항목이 없습니다. 새로고침 후 다시 시도해주세요.' });
      }
      loadUnsubscribes();
    } catch (error) {
      setToast({ show: true, type: 'error', message: '삭제 실패' });
    } finally {
      setDeleting(false);
      setDeleteModal({ show: false, id: '', phone: '' });
    }
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // 1단계: 서버(multer+XLSX)로 파싱해 열 메타를 받는다. 실제 엑셀(.xlsx) 바이너리도 서버가 읽음.
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/unsubscribes/upload/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }, // Content-Type 미지정 — multipart boundary 자동
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        setToast({ show: true, type: 'error', message: data.error || '파일 파싱 실패' });
        setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
        return;
      }
      const cols: Array<{ index: number; header: string; samples: string[]; phoneCount: number }> = data.columns || [];
      const phoneCols = cols.filter((c) => c.phoneCount > 0);
      // 단일 열, 또는 전화번호 열이 하나로 명확하면 모달 없이 자동 등록 (불필요한 클릭 방지)
      if (cols.length <= 1) {
        await commitUpload(data.fileId, cols[0]?.index ?? 0);
      } else if (phoneCols.length === 1) {
        await commitUpload(data.fileId, phoneCols[0].index);
      } else {
        // 애매(다열) = 전화번호 열 선택 모달 (추천 열 미리 선택)
        setColumnPicker({ show: true, fileId: data.fileId, columns: cols, selected: data.suggestedColumn ?? 0, totalRows: data.totalRows || 0 });
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '파일 처리 실패' });
      setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // 2단계: 선택한 열로 커밋 등록
  const commitUpload = async (fileId: string, columnIndex: number) => {
    setPickerSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/unsubscribes/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileId, columnIndex }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: data.message });
        loadUnsubscribes();
      } else {
        setToast({ show: true, type: 'error', message: data.error || '업로드 실패' });
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '업로드 실패' });
    } finally {
      setPickerSubmitting(false);
      setColumnPicker({ show: false, fileId: '', columns: [], selected: 0, totalRows: 0 });
      setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
    }
  };

  // D43-4: 080 연동 테스트 — 목록 새로고침 후 최근 080_ars 건 확인
  // ★ stale state 버그 수정: loadUnsubscribes()가 반환한 최신 데이터로 직접 체크
  const handleSyncTest = async () => {
    setSyncTesting(true);
    const freshData = await loadUnsubscribes();
    setSyncTesting(false);

    // 최근 5분 내 080_ars 소스 건 확인 (반환된 최신 데이터 사용)
    const recent080 = freshData.filter(
      (item: any) => item.source === '080_ars' &&
      new Date(item.created_at).getTime() > Date.now() - 5 * 60 * 1000
    );

    if (recent080.length > 0) {
      setToast({ show: true, type: 'success', message: `080 연동 정상! 최근 ${recent080.length}건 수신거부 감지` });
    } else {
      setToast({ show: true, type: 'info', message: '최근 5분 내 080 수신거부 건이 없습니다. 080 전화 후 다시 확인해주세요.' });
    }
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 5000);
  };

  // ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용 (02/대표번호/050X/080 전부 정확 처리)
  const format080Number = formatPhoneNumber;

  // ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용
  const formatPhone = formatPhoneNumber;

  const sourceLabel: Record<string, { text: string; color: string }> = {
    '080_ars': { text: '080 ARS', color: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100' },
    api: { text: '080 자동', color: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100' },
    upload: { text: '파일 업로드', color: 'bg-violet-50 text-violet-700 ring-1 ring-violet-100' },
    manual: { text: '직접 입력', color: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
    db_upload: { text: 'DB 업로드', color: 'bg-teal-50 text-teal-700 ring-1 ring-teal-100' },
    sync: { text: 'Sync 연동', color: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100' },
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 토스트 */}
      {toast.show && (
        <div className="fixed top-4 right-4 z-[10000] flex items-center gap-3 px-4 py-3 rounded-xl bg-white shadow-lg ring-1 ring-slate-200 max-w-sm animate-in fade-in slide-in-from-top-2 duration-200">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          ) : toast.type === 'info' ? (
            <Info className="w-5 h-5 text-sky-500 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
          )}
          <span className="text-sm text-slate-700">{toast.message}</span>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 max-w-sm w-full animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 bg-rose-50 rounded-2xl flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">수신거부 해제</h3>
              <p className="text-sm mb-1">
                <span className="font-mono font-semibold text-slate-800">{formatPhone(deleteModal.phone)}</span>
              </p>
              <p className="text-sm text-slate-500 mb-6">
                삭제 시 해당 번호의 수신동의가 복원됩니다.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteModal({ show: false, id: '', phone: '' })}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-rose-500 text-white rounded-xl hover:bg-rose-600 font-medium transition-colors disabled:opacity-50"
                >
                  {deleting ? '처리중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 전화번호 열 선택 모달 — 여러 열 파일 업로드 시 (엑셀/CSV) */}
      {columnPicker.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => { if (!pickerSubmitting) setColumnPicker({ show: false, fileId: '', columns: [], selected: 0, totalRows: 0 }); }}
          />
          <div className="relative bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 max-w-md w-full animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                  <Upload className="w-5 h-5 text-violet-500" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900">전화번호 열 선택</h3>
                  <p className="text-xs text-slate-400">수신거부할 전화번호가 있는 열을 선택하세요 · 총 {columnPicker.totalRows.toLocaleString()}행</p>
                </div>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto -mx-1 px-1">
                {columnPicker.columns.map((col) => {
                  const active = columnPicker.selected === col.index;
                  return (
                    <button
                      key={col.index}
                      onClick={() => setColumnPicker((prev) => ({ ...prev, selected: col.index }))}
                      className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${active ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-200' : 'border-slate-200 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800 truncate">{col.header}</span>
                        {col.phoneCount > 0 && (
                          <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">전화번호 {col.phoneCount.toLocaleString()}건</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-400 font-mono truncate">
                        {col.samples.length > 0 ? col.samples.join('  ·  ') : '(빈 값)'}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setColumnPicker({ show: false, fileId: '', columns: [], selected: 0, totalRows: 0 })}
                  disabled={pickerSubmitting}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={() => commitUpload(columnPicker.fileId, columnPicker.selected)}
                  disabled={pickerSubmitting}
                  className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 font-medium transition-colors disabled:opacity-50"
                >
                  {pickerSubmitting ? '등록 중...' : '이 열로 등록'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* D43-4: 080 연동 테스트 안내 모달 — opt_out_auto_sync=true일 때만 열림 */}
      {syncTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 max-w-sm w-full animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 bg-sky-50 rounded-2xl flex items-center justify-center">
                <Phone className="w-6 h-6 text-sky-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">080 연동 테스트</h3>
              <div className="text-sm text-slate-600 mb-4 leading-relaxed">
                <p className="mb-3">아래 번호로 전화하여 수신거부를 등록하세요.</p>
                <div className="bg-slate-50 rounded-xl py-3 px-4 mb-3 ring-1 ring-slate-100">
                  <p className="text-2xl font-bold text-slate-900 font-mono tracking-wider">
                    {format080Number(opt080Number)}
                  </p>
                </div>
                <p className="text-xs text-slate-400">
                  ARS 안내에 따라 수신거부 등록 후<br />
                  아래 버튼을 눌러 연동 상태를 확인하세요.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setSyncTestModal(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors"
                >
                  닫기
                </button>
                <button
                  onClick={() => {
                    setSyncTestModal(false);
                    handleSyncTest();
                  }}
                  disabled={syncTesting}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 font-medium transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${syncTesting ? 'animate-spin' : ''}`} />
                  {syncTesting ? '확인중...' : '연동 확인'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
              <Ban className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">수신거부 관리</h1>
              <p className="text-xs text-slate-400">차단된 번호 관리 · 080 자동 연동</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> 대시보드
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* 상단 액션 영역 */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            {/* 검색 */}
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">전화번호 검색</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="010-1234-5678"
                  className="flex-1 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition"
                />
                <button
                  onClick={handleSearch}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
                >
                  <Search className="w-4 h-4" /> 검색
                </button>
              </div>
            </div>

            {/* 직접 추가 — 격리 ON + 고객사관리자 차단 */}
            <div className="min-w-[200px]">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">직접 추가</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canManageUnsubscribes && handleAdd()}
                  placeholder="01012345678"
                  disabled={!canManageUnsubscribes}
                  className={`w-36 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition ${!canManageUnsubscribes ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                />
                <button
                  onClick={handleAdd}
                  disabled={!canManageUnsubscribes}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${canManageUnsubscribes ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                >
                  <Plus className="w-4 h-4" /> 추가
                </button>
              </div>
            </div>

            {/* 파일 업로드 — 격리 ON + 고객사관리자 차단 */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">파일 업로드</label>
              <label className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${canManageUnsubscribes ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'} ${uploading ? 'opacity-60' : ''}`}>
                <Upload className="w-4 h-4" />
                <span>{uploading ? '처리중...' : '엑셀·CSV'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  onChange={handleFileUpload}
                  disabled={uploading || !canManageUnsubscribes}
                  className="hidden"
                />
              </label>
            </div>

            {/* D43-4: 080 연동 테스트 — opt_out_auto_sync=true일 때만 표시 */}
            {optOutAutoSync && opt080Number && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">080 연동</label>
                <button
                  onClick={() => setSyncTestModal(true)}
                  disabled={syncTesting}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-sm font-medium text-slate-700 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${syncTesting ? 'animate-spin' : ''}`} />
                  <span>{syncTesting ? '확인중...' : '연동 테스트'}</span>
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-400 mt-3">
            {optOutAutoSync
              ? `※ 080 수신거부(${format080Number(opt080Number)}) 시 자동 등록됩니다. 유료 요금제 업체는 고객 DB의 수신동의 상태도 자동 연동됩니다.`
              : '※ 엑셀(xlsx·xls)·CSV·TXT 업로드를 지원합니다. 열이 여러 개면 전화번호 열을 선택하는 창이 뜹니다.'
            }
          </p>

          {/* ★ D162-3 격리 ON + 고객사관리자 안내 */}
          {!canManageUnsubscribes && userIsolationEnabled && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <strong>수신거부 사용자격리기능이 적용되어 있습니다.</strong> 한줄로 운영실에 문의하세요.
                <div className="text-xs text-amber-700 mt-1">고객사관리자는 조회만 가능합니다. 각 사용자가 등록한 수신거부 결과가 본 화면에 자동 동기화됩니다.</div>
              </div>
            </div>
          )}
        </div>

        {/* 목록 */}
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-sm font-bold text-slate-900">수신거부 목록</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">총 <span className="font-semibold text-slate-700">{pagination.total.toLocaleString()}</span>건</span>
              {/* ★ 2026-06-13: 전체 엑셀 다운로드 (콤비타·던필드 알파 요청) — 현재 검색 조건 그대로 전체 내려받기 */}
              <button
                onClick={handleExportAll}
                disabled={exporting || pagination.total === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className={`w-3.5 h-3.5 ${exporting ? 'animate-bounce' : ''}`} />
                {exporting ? '내려받는 중...' : '전체 엑셀 다운로드'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin text-slate-300" />
              로딩 중...
            </div>
          ) : unsubscribes.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-400">수신거부 목록이 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">전화번호</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">등록 경로</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">등록일시</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">삭제</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {unsubscribes.map((item) => {
                    const src = sourceLabel[item.source] || { text: item.source, color: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' };
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-sm text-slate-900">{formatPhone(item.phone)}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium ${src.color}`}>
                            {src.text}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-500">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <button
                            onClick={() => canManageUnsubscribes && setDeleteModal({ show: true, id: item.id, phone: item.phone })}
                            disabled={!canManageUnsubscribes}
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${canManageUnsubscribes ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50' : 'text-slate-200 cursor-not-allowed'}`}
                            title="수신거부 해제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 페이지네이션 */}
          {pagination.totalPages > 1 && (
            <div className="px-5 py-4 border-t border-slate-100 flex justify-center items-center gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 text-sm text-slate-500">
                {pagination.page} <span className="text-slate-300">/</span> {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
