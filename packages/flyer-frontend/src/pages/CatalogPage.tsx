/**
 * ★ D114: 전단AI 상품 카탈로그 관리 페이지
 *
 * 기능:
 *   - 상품 목록 조회 (카테고리/검색 필터)
 *   - 상품 추가/수정/삭제
 *   - 전단 제작 시 "내 상품"에서 바로 불러오기 가능
 *
 * API: /api/flyer/catalog (CT-F11)
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input } from '../components/ui';
import AlertModal from '../components/AlertModal';

interface CatalogItem {
  id: string;
  product_name: string;
  category: string;
  default_price: number;
  image_url: string | null;
  description: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
}

export default function CatalogPage({ token: _token }: { token: string }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // 추가/수정 모달
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [form, setForm] = useState({ product_name: '', category: '', default_price: '', description: '' });
  const [saving, setSaving] = useState(false);

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);

  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : data.items || []);
      }
    } catch (e) {
      console.error('카탈로그 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => { loadItems(); }, [loadItems]);

  // 카테고리 목록 (등록된 상품에서 추출)
  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];

  const openCreateForm = () => {
    setEditingItem(null);
    setForm({ product_name: '', category: '', default_price: '', description: '' });
    setShowForm(true);
  };

  const openEditForm = (item: CatalogItem) => {
    setEditingItem(item);
    setForm({
      product_name: item.product_name,
      category: item.category || '',
      default_price: item.default_price ? String(item.default_price) : '',
      description: item.description || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.product_name.trim()) {
      setAlert({ show: true, title: '입력 오류', message: '상품명을 입력해주세요.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        default_price: parseInt(form.default_price) || 0,
        id: editingItem?.id || undefined,
      };
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowForm(false);
        loadItems();
        setAlert({ show: true, title: editingItem ? '수정 완료' : '등록 완료', message: `"${form.product_name}" 상품이 ${editingItem ? '수정' : '등록'}되었습니다.`, type: 'success' });
      } else {
        const err = await res.json();
        setAlert({ show: true, title: '오류', message: err.error || '저장에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '서버 연결에 실패했습니다.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteTarget(null);
        loadItems();
        setAlert({ show: true, title: '삭제 완료', message: `"${deleteTarget.product_name}" 상품이 삭제되었습니다.`, type: 'success' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '삭제에 실패했습니다.', type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* 상단 통계 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-border p-5">
          <p className="text-xs text-text-muted font-medium">전체 상품</p>
          <p className="text-2xl font-bold text-text mt-1">{items.length}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-5">
          <p className="text-xs text-text-muted font-medium">카테고리</p>
          <p className="text-2xl font-bold text-primary-600 mt-1">{categories.length}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-5">
          <p className="text-xs text-text-muted font-medium">전단 사용</p>
          <p className="text-2xl font-bold text-success-600 mt-1">{items.reduce((sum, i) => sum + (i.usage_count || 0), 0)}회</p>
        </div>
      </div>

      <SectionCard title="상품 카탈로그"
        action={<Button onClick={openCreateForm} size="sm">+ 상품 등록</Button>}>

        {/* 검색 + 필터 */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <Input placeholder="상품명 검색..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:ring-2 focus:ring-primary-300 transition">
            <option value="">전체 카테고리</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* 상품 목록 */}
        {loading ? (
          <div className="text-center py-12 text-text-muted">로딩 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📦</p>
            <p className="text-text-secondary font-medium">등록된 상품이 없습니다</p>
            <p className="text-xs text-text-muted mt-1">상품을 등록하면 전단 제작 시 빠르게 불러올 수 있어요</p>
            <button onClick={openCreateForm} className="mt-4 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 transition">
              첫 상품 등록하기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(item => (
              <div key={item.id} className="bg-bg rounded-xl border border-border overflow-hidden hover:shadow-md transition group">
                {/* 이미지 영역 */}
                <div className="h-28 bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center">
                  {item.image_url ? (
                    <img src={`${API_BASE}${item.image_url}`} alt={item.product_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl opacity-50">📦</span>
                  )}
                </div>
                {/* 정보 */}
                <div className="p-3.5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text truncate">{item.product_name}</p>
                      {item.category && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-primary-50 text-primary-600 text-[10px] font-medium rounded-full">{item.category}</span>
                      )}
                    </div>
                    {item.default_price > 0 && (
                      <p className="text-sm font-bold text-error-600 shrink-0 ml-2">{item.default_price.toLocaleString()}원</p>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-text-muted mt-1.5 line-clamp-2">{item.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border">
                    <span className="text-[10px] text-text-muted">전단 {item.usage_count || 0}회 사용</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => openEditForm(item)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition">수정</button>
                      <button onClick={() => setDeleteTarget(item)} className="px-2 py-1 text-[10px] bg-red-50 text-red-500 rounded hover:bg-red-100 transition">삭제</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 상품 추가/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-lg">{editingItem ? '✏️' : '📦'}</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">{editingItem ? '상품 수정' : '상품 등록'}</h3>
                <p className="text-sm text-gray-500">전단 제작 시 빠르게 불러올 수 있는 상품을 등록하세요</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상품명 *</label>
                <input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-300 focus:border-primary-400 transition" placeholder="예: 한우 등심 1++ 특선" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-300 transition" placeholder="예: 축산, 과일, 수산" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">기본 가격 (원)</label>
                  <input type="number" value={form.default_price} onChange={e => setForm(p => ({ ...p, default_price: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-300 transition" placeholder="29,900" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-300 transition resize-none" placeholder="상품 간단 설명" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
              <button onClick={() => setShowForm(false)} className="px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">취소</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium shadow-sm transition disabled:opacity-50">
                {saving ? '저장 중...' : editingItem ? '수정' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">상품 삭제</h3>
                <p className="text-sm text-gray-500">"{deleteTarget.product_name}"</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5">이 상품을 삭제하면 되돌릴 수 없습니다.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">취소</button>
              <button onClick={handleDelete} className="px-5 py-2.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium shadow-sm transition">삭제</button>
            </div>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert(p => ({ ...p, show: false }))} />
    </div>
  );
}
