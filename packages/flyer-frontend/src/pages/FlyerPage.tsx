import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../App';
import AlertModal from '../components/AlertModal';

interface FlyerItem { name: string; originalPrice: number; salePrice: number; badge?: string; }
interface FlyerCategory { name: string; items: FlyerItem[]; }
interface Flyer { id: string; title: string; store_name: string; period_start: string | null; period_end: string | null; categories: FlyerCategory[]; template: string; status: string; short_code: string | null; click_count: number; created_at: string; }

const CATEGORY_PRESETS = ['청과/야채', '공산', '축산', '수산', '냉동', '유제품', '음료/주류', '생활용품'];
const TEMPLATES = [
  { value: 'grid', label: '가격 강조형', desc: '빨간 테마, 2열 카드' },
  { value: 'list', label: '리스트형', desc: '블랙+골드 프리미엄' },
  { value: 'highlight', label: '특가 하이라이트', desc: '다크 모드, TODAY\'S PICK' },
];

export default function FlyerPage({ token }: { token: string }) {
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFlyer, setEditingFlyer] = useState<Flyer | null>(null);

  const [title, setTitle] = useState('');
  const [storeName, setStoreName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [template, setTemplate] = useState('grid');
  const [categories, setCategories] = useState<FlyerCategory[]>([{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);

  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });
  const [copyToast, setCopyToast] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; id: string; title: string }>({ show: false, id: '', title: '' });

  const headers = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const loadFlyers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers`, { headers });
      if (res.ok) setFlyers(await res.json());
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadFlyers(); }, [loadFlyers]);

  const resetForm = () => { setTitle(''); setStoreName(''); setPeriodStart(''); setPeriodEnd(''); setTemplate('grid'); setCategories([{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]); setEditingFlyer(null); };

  const handleSave = async () => {
    if (!title.trim()) { setAlert({ show: true, title: '입력 오류', message: '행사명을 입력해주세요.', type: 'error' }); return; }
    const clean = categories.map(c => ({ ...c, items: c.items.filter(i => i.name.trim()) })).filter(c => c.items.length > 0);
    if (clean.length === 0) { setAlert({ show: true, title: '입력 오류', message: '최소 1개 상품을 입력해주세요.', type: 'error' }); return; }

    try {
      const body = { title: title.trim(), store_name: storeName.trim(), period_start: periodStart || null, period_end: periodEnd || null, categories: clean, template };
      const url = editingFlyer ? `${API_BASE}/api/flyer/flyers/${editingFlyer.id}` : `${API_BASE}/api/flyer/flyers`;
      const res = await fetch(url, { method: editingFlyer ? 'PUT' : 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
      if (res.ok) { setAlert({ show: true, title: editingFlyer ? '수정 완료' : '생성 완료', message: editingFlyer ? '전단지가 수정되었습니다.' : '전단지가 생성되었습니다.', type: 'success' }); setShowForm(false); resetForm(); loadFlyers(); }
      else { const e = await res.json(); setAlert({ show: true, title: '오류', message: e.error || '저장 실패', type: 'error' }); }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
  };

  const handlePublish = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers/${id}/publish`, { method: 'POST', headers });
      if (res.ok) { const d = await res.json(); setAlert({ show: true, title: '발행 완료', message: `단축URL: ${d.short_url}`, type: 'success' }); loadFlyers(); }
    } catch { setAlert({ show: true, title: '오류', message: '발행 실패', type: 'error' }); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers/${id}`, { method: 'DELETE', headers });
      if (res.ok) { setAlert({ show: true, title: '삭제 완료', message: '삭제되었습니다.', type: 'success' }); setDeleteModal({ show: false, id: '', title: '' }); loadFlyers(); }
    } catch { setAlert({ show: true, title: '오류', message: '삭제 실패', type: 'error' }); }
  };

  const handleEdit = (f: Flyer) => {
    setEditingFlyer(f); setTitle(f.title); setStoreName(f.store_name || ''); setPeriodStart(f.period_start || ''); setPeriodEnd(f.period_end || ''); setTemplate(f.template || 'grid');
    const cats = typeof f.categories === 'string' ? JSON.parse(f.categories) : (f.categories || []);
    setCategories(cats.length > 0 ? cats : [{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
    setShowForm(true);
  };

  const handleCopyUrl = (code: string) => { navigator.clipboard.writeText(`https://hanjul-flyer.kr/${code}`); setCopyToast(true); setTimeout(() => setCopyToast(false), 2000); };

  const addCategory = (name?: string) => setCategories([...categories, { name: name || '새 카테고리', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
  const removeCategory = (idx: number) => setCategories(categories.filter((_, i) => i !== idx));
  const updateCategoryName = (idx: number, name: string) => { const u = [...categories]; u[idx].name = name; setCategories(u); };
  const addItem = (ci: number) => { const u = [...categories]; u[ci].items.push({ name: '', originalPrice: 0, salePrice: 0 }); setCategories(u); };
  const removeItem = (ci: number, ii: number) => { const u = [...categories]; u[ci].items = u[ci].items.filter((_, i) => i !== ii); setCategories(u); };
  const updateItem = (ci: number, ii: number, f: keyof FlyerItem, v: string | number) => { const u = [...categories]; (u[ci].items[ii] as any)[f] = v; setCategories(u); };

  const fmtDate = (d: string | null) => { if (!d) return ''; const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()}`; };

  return (
    <>
      {/* 상단 액션바 */}
      {!showForm && (
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-gray-800">전단지 관리</h2>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium">+ 전단지 만들기</button>
        </div>
      )}

      {/* 목록 */}
      {!showForm && (
        loading ? <div className="text-center py-20 text-gray-400">로딩 중...</div> :
        flyers.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-xl font-bold text-gray-700 mb-2">아직 전단지가 없습니다</h2>
            <p className="text-gray-500 mb-6">전단지를 만들어 고객에게 SMS로 발송해보세요</p>
            <button onClick={() => { resetForm(); setShowForm(true); }} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">첫 전단지 만들기</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flyers.map(f => (
              <div key={f.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                <div className={`px-4 py-3 ${f.status === 'published' ? 'bg-green-50 border-b border-green-100' : 'bg-gray-50 border-b border-gray-100'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0"><h3 className="font-bold text-gray-800 truncate">{f.title}</h3>{f.store_name && <p className="text-xs text-gray-500 mt-0.5">{f.store_name}</p>}</div>
                    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${f.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{f.status === 'published' ? '발행됨' : '임시저장'}</span>
                  </div>
                </div>
                <div className="px-4 py-3">
                  {(f.period_start || f.period_end) && <p className="text-xs text-gray-500 mb-2">📅 {fmtDate(f.period_start)} ~ {fmtDate(f.period_end)}</p>}
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">템플릿: <span className="font-medium text-gray-700">{TEMPLATES.find(t => t.value === f.template)?.label || f.template}</span></span>
                    {f.status === 'published' && <span className="text-blue-600 font-medium">👆 {f.click_count || 0}클릭</span>}
                  </div>
                  {f.short_code && <div className="mt-2 flex items-center gap-2"><code className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">hanjul-flyer.kr/{f.short_code}</code><button onClick={() => handleCopyUrl(f.short_code!)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0">복사</button></div>}
                </div>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                  <span className="text-xs text-gray-400">{fmtDate(f.created_at)}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(f)} className="text-xs text-gray-500 hover:text-gray-700">수정</button>
                    {f.status !== 'published' && <button onClick={() => handlePublish(f.id)} className="text-xs text-green-600 hover:text-green-800 font-medium">발행</button>}
                    {f.short_code && <a href={`https://hanjul-flyer.kr/${f.short_code}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800">미리보기</a>}
                    <button onClick={() => setDeleteModal({ show: true, id: f.id, title: f.title })} className="text-xs text-red-500 hover:text-red-700">삭제</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* 생성/수정 폼 */}
      {showForm && (
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-800">{editingFlyer ? '전단지 수정' : '새 전단지 만들기'}</h2>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-sm text-gray-500 hover:text-gray-700">취소</button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">기본 정보</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">행사명 *</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 26년 3월 데레사 행사" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">매장명</label><input type="text" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="예: 데레사 마트" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-gray-500 mb-1">시작일</label><input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">종료일</label><input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">디자인 템플릿</h3>
            <div className="grid grid-cols-3 gap-3">
              {TEMPLATES.map(t => (
                <button key={t.value} onClick={() => setTemplate(t.value)} className={`p-3 rounded-lg border-2 text-left transition-colors ${template === t.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="text-sm font-bold text-gray-800">{t.label}</div>
                  <div className="text-xs text-gray-500 mt-1">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">상품 등록</h3>
            <div className="flex flex-wrap gap-1 mb-3">
              {CATEGORY_PRESETS.filter(p => !categories.some(c => c.name === p)).map(p => (
                <button key={p} onClick={() => addCategory(p)} className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-600">+{p}</button>
              ))}
            </div>
            {categories.map((cat, ci) => (
              <div key={ci} className="mb-4 border border-gray-100 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <input type="text" value={cat.name} onChange={e => updateCategoryName(ci, e.target.value)} className="font-bold text-sm text-gray-800 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none pb-1" />
                  <button onClick={() => removeCategory(ci)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 px-1"><div className="col-span-4">상품명</div><div className="col-span-2">원가</div><div className="col-span-2">할인가</div><div className="col-span-3">뱃지</div><div className="col-span-1"></div></div>
                  {cat.items.map((item, ii) => (
                    <div key={ii} className="grid grid-cols-12 gap-2 items-center">
                      <input type="text" value={item.name} onChange={e => updateItem(ci, ii, 'name', e.target.value)} placeholder="상품명" className="col-span-4 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(ci, ii, 'originalPrice', Number(e.target.value))} placeholder="원가" className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <input type="number" value={item.salePrice || ''} onChange={e => updateItem(ci, ii, 'salePrice', Number(e.target.value))} placeholder="할인가" className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <input type="text" value={item.badge || ''} onChange={e => updateItem(ci, ii, 'badge', e.target.value)} placeholder="뱃지" className="col-span-3 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <button onClick={() => removeItem(ci, ii)} className="col-span-1 text-red-400 hover:text-red-600 text-center">✕</button>
                    </div>
                  ))}
                  <button onClick={() => addItem(ci)} className="w-full py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded border border-dashed border-blue-300">+ 상품 추가</button>
                </div>
              </div>
            ))}
            <button onClick={() => addCategory()} className="w-full py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg border border-dashed border-gray-300">+ 카테고리 추가</button>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">취소</button>
            <button onClick={handleSave} className="px-6 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 font-medium">{editingFlyer ? '수정 저장' : '전단지 저장'}</button>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
      {copyToast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm shadow-lg z-50">URL이 복사되었습니다</div>}

      {deleteModal.show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🗑️</div>
              <h3 className="text-lg font-bold text-gray-800">전단지 삭제</h3>
              <p className="text-sm text-gray-500 mt-1">"{deleteModal.title}"을(를) 삭제하시겠습니까?</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal({ show: false, id: '', title: '' })} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm">취소</button>
              <button onClick={() => handleDelete(deleteModal.id)} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium">삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
