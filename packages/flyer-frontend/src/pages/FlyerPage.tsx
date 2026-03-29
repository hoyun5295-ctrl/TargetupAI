import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, Button, Input, Badge, EmptyState, ConfirmModal, Toast } from '../components/ui';

interface FlyerItem { name: string; originalPrice: number; salePrice: number; badge?: string; }
interface FlyerCategory { name: string; items: FlyerItem[]; }
interface Flyer { id: string; title: string; store_name: string; period_start: string | null; period_end: string | null; categories: FlyerCategory[]; template: string; status: string; short_code: string | null; click_count: number; created_at: string; }

const CATEGORY_PRESETS = ['청과/야채', '공산', '축산', '수산', '냉동', '유제품', '음료/주류', '생활용품'];
const TEMPLATES = [
  { value: 'grid', label: '가격 강조형', desc: '빨간 테마, 2열 카드', color: 'from-red-500 to-orange-500' },
  { value: 'list', label: '리스트형', desc: '블랙+골드 프리미엄', color: 'from-gray-800 to-amber-700' },
  { value: 'highlight', label: '특가 하이라이트', desc: '다크 모드, TODAY\'S PICK', color: 'from-orange-500 to-red-600' },
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

  const jsonHeaders = { 'Content-Type': 'application/json' };

  const loadFlyers = useCallback(async () => {
    try { const res = await apiFetch(`${API_BASE}/api/flyer/flyers`); if (res.ok) setFlyers(await res.json()); }
    catch (err) { console.error(err); } finally { setLoading(false); }
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
      const res = await apiFetch(url, { method: editingFlyer ? 'PUT' : 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
      if (res.ok) { setAlert({ show: true, title: editingFlyer ? '수정 완료' : '생성 완료', message: editingFlyer ? '전단지가 수정되었습니다.' : '전단지가 생성되었습니다.', type: 'success' }); setShowForm(false); resetForm(); loadFlyers(); }
      else { const e = await res.json(); setAlert({ show: true, title: '오류', message: e.error || '저장 실패', type: 'error' }); }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
  };

  const handlePublish = async (id: string) => {
    try { const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}/publish`, { method: 'POST' }); if (res.ok) { const d = await res.json(); setAlert({ show: true, title: '발행 완료', message: `단축URL: ${d.short_url}`, type: 'success' }); loadFlyers(); } }
    catch { setAlert({ show: true, title: '오류', message: '발행 실패', type: 'error' }); }
  };

  const handleDelete = async (id: string) => {
    try { const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}`, { method: 'DELETE' }); if (res.ok) { setAlert({ show: true, title: '삭제 완료', message: '삭제되었습니다.', type: 'success' }); setDeleteModal({ show: false, id: '', title: '' }); loadFlyers(); } }
    catch { setAlert({ show: true, title: '오류', message: '삭제 실패', type: 'error' }); }
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
      {/* ── 목록 뷰 ── */}
      {!showForm && (
        <>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-lg font-bold text-text">전단지 관리</h2>
              <p className="text-xs text-text-muted mt-0.5">{flyers.length}개의 전단지</p>
            </div>
            <Button onClick={() => { resetForm(); setShowForm(true); }}>+ 전단지 만들기</Button>
          </div>

          {loading ? <div className="text-center py-20 text-text-muted">로딩 중...</div> :
          flyers.length === 0 ? (
            <EmptyState icon="📄" title="아직 전단지가 없습니다" description="전단지를 만들어 고객에게 SMS로 발송해보세요" action={<Button onClick={() => { resetForm(); setShowForm(true); }}>첫 전단지 만들기</Button>} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {flyers.map(f => (
                <div key={f.id} className="bg-surface border border-border rounded-xl overflow-hidden shadow-card hover:shadow-elevated transition-shadow">
                  <div className={`px-4 py-3 border-b ${f.status === 'published' ? 'bg-success-50 border-success-500/20' : 'bg-bg border-border'}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-sm text-text truncate">{f.title}</h3>
                        {f.store_name && <p className="text-xs text-text-muted mt-0.5">{f.store_name}</p>}
                      </div>
                      <Badge variant={f.status === 'published' ? 'success' : 'neutral'}>{f.status === 'published' ? '발행됨' : '임시저장'}</Badge>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    {(f.period_start || f.period_end) && <p className="text-xs text-text-muted mb-2">{fmtDate(f.period_start)} ~ {fmtDate(f.period_end)}</p>}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-text-muted">{TEMPLATES.find(t => t.value === f.template)?.label || f.template}</span>
                      {f.status === 'published' && <span className="text-primary-600 font-semibold">{f.click_count || 0} 클릭</span>}
                    </div>
                    {f.short_code && (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="text-[11px] bg-bg text-text-secondary px-2 py-1 rounded-md flex-1 truncate font-mono">hanjul-flyer.kr/{f.short_code}</code>
                        <button onClick={() => handleCopyUrl(f.short_code!)} className="text-[11px] text-primary-600 hover:text-primary-700 font-semibold">복사</button>
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2 bg-bg border-t border-border flex justify-between items-center">
                    <span className="text-[11px] text-text-muted">{fmtDate(f.created_at)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => handleEdit(f)} className="text-[11px] text-text-secondary hover:text-text font-medium">수정</button>
                      {f.status !== 'published' && <button onClick={() => handlePublish(f.id)} className="text-[11px] text-success-600 hover:text-success-500 font-semibold">발행</button>}
                      {f.short_code && <a href={`https://hanjul-flyer.kr/${f.short_code}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary-600 hover:text-primary-700 font-medium">미리보기</a>}
                      <button onClick={() => setDeleteModal({ show: true, id: f.id, title: f.title })} className="text-[11px] text-error-500 hover:text-error-600 font-medium">삭제</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── 생성/수정 폼 + 미리보기 ── */}
      {showForm && (
        <div className="flex gap-6">
          {/* 좌측: 입력 폼 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-text">{editingFlyer ? '전단지 수정' : '새 전단지 만들기'}</h2>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); resetForm(); }}>취소</Button>
            </div>

            <SectionCard title="기본 정보" className="mb-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><Input label="행사명 *" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 26년 3월 데레사 행사" /></div>
                <Input label="매장명" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="예: 데레사 마트" />
                <div className="grid grid-cols-2 gap-2">
                  <Input label="시작일" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                  <Input label="종료일" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="디자인 템플릿" className="mb-4">
              <div className="grid grid-cols-3 gap-3">
                {TEMPLATES.map(t => (
                  <button key={t.value} onClick={() => setTemplate(t.value)}
                    className={`rounded-xl border-2 text-left transition-all overflow-hidden ${template === t.value ? 'border-primary-500 shadow-elevated' : 'border-border hover:border-border-strong'}`}>
                    <div className={`h-3 bg-gradient-to-r ${t.color}`} />
                    <div className="p-3">
                      <div className="text-sm font-bold text-text">{t.label}</div>
                      <div className="text-xs text-text-muted mt-0.5">{t.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="상품 등록" className="mb-4">
              <div className="flex flex-wrap gap-1 mb-4">
                {CATEGORY_PRESETS.filter(p => !categories.some(c => c.name === p)).map(p => (
                  <button key={p} onClick={() => addCategory(p)} className="px-2.5 py-1 text-xs bg-bg hover:bg-border/50 rounded-md text-text-secondary font-medium transition-colors">+{p}</button>
                ))}
              </div>
              {categories.map((cat, ci) => (
                <div key={ci} className="mb-4 border border-border rounded-xl p-4 bg-bg/30">
                  <div className="flex justify-between items-center mb-3">
                    <input type="text" value={cat.name} onChange={e => updateCategoryName(ci, e.target.value)} className="font-bold text-sm text-text border-b border-transparent hover:border-border-strong focus:border-primary-500 focus:outline-none pb-1 bg-transparent" />
                    <button onClick={() => removeCategory(ci)} className="text-xs text-error-500 hover:text-error-600 font-medium">삭제</button>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-text-muted uppercase tracking-wider px-1">
                      <div className="col-span-4">상품명</div><div className="col-span-2">원가</div><div className="col-span-2">할인가</div><div className="col-span-3">뱃지</div><div className="col-span-1"></div>
                    </div>
                    {cat.items.map((item, ii) => (
                      <div key={ii} className="grid grid-cols-12 gap-2 items-center">
                        <input type="text" value={item.name} onChange={e => updateItem(ci, ii, 'name', e.target.value)} placeholder="상품명" className="col-span-4 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                        <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(ci, ii, 'originalPrice', Number(e.target.value))} placeholder="원가" className="col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                        <input type="number" value={item.salePrice || ''} onChange={e => updateItem(ci, ii, 'salePrice', Number(e.target.value))} placeholder="할인가" className="col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                        <input type="text" value={item.badge || ''} onChange={e => updateItem(ci, ii, 'badge', e.target.value)} placeholder="뱃지" className="col-span-3 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                        <button onClick={() => removeItem(ci, ii)} className="col-span-1 text-error-500/60 hover:text-error-500 text-center transition-colors">✕</button>
                      </div>
                    ))}
                    <button onClick={() => addItem(ci)} className="w-full py-2 text-xs text-primary-600 hover:bg-primary-50 rounded-lg border border-dashed border-primary-500/30 transition-colors font-medium">+ 상품 추가</button>
                  </div>
                </div>
              ))}
              <button onClick={() => addCategory()} className="w-full py-2.5 text-sm text-text-secondary hover:bg-bg rounded-xl border border-dashed border-border transition-colors font-medium">+ 카테고리 추가</button>
            </SectionCard>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }}>취소</Button>
              <Button onClick={handleSave}>{editingFlyer ? '수정 저장' : '전단지 저장'}</Button>
            </div>
          </div>

          {/* 우측: 폰 프레임 미리보기 */}
          <div className="w-[280px] flex-shrink-0 sticky top-20 self-start">
            <p className="text-xs font-semibold text-text-secondary mb-3 text-center">미리보기</p>
            <div className="bg-gray-900 rounded-[2rem] p-2.5 shadow-elevated">
              {/* 노치 */}
              <div className="flex justify-center mb-1">
                <div className="w-20 h-5 bg-gray-900 rounded-b-xl relative -top-0.5" />
              </div>
              <div className="bg-surface rounded-[1.5rem] overflow-hidden" style={{ width: 255, height: 520 }}>
                {/* 미니 주소바 */}
                <div className="bg-bg px-3 py-1.5 border-b border-border flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-success-500" />
                  <span className="text-[8px] text-text-muted font-mono truncate">hanjul-flyer.kr/preview</span>
                </div>
                {/* 프론트 자체 렌더링 미리보기 */}
                <div className="overflow-y-auto" style={{ height: 490 }}>
                  {editingFlyer?.short_code ? (
                    <iframe src={`${API_BASE}/api/flyer/p/${editingFlyer.short_code}`} className="w-full border-0" style={{ height: 490, transform: 'scale(0.68)', transformOrigin: 'top left', width: '147%' }} title="미리보기" />
                  ) : (
                    <FlyerPreviewRenderer title={title} storeName={storeName} periodStart={periodStart} periodEnd={periodEnd} categories={categories} template={template} />
                  )}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-text-muted text-center mt-2">
              {editingFlyer?.short_code ? '발행된 전단지 미리보기' : '입력 내용이 실시간 반영됩니다'}
            </p>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
      <Toast show={copyToast} message="URL이 복사되었습니다" />
      <ConfirmModal show={deleteModal.show} icon="🗑️" title="전단지 삭제" message={`"${deleteModal.title}"을(를) 삭제하시겠습니까?`} danger confirmLabel="삭제" onConfirm={() => handleDelete(deleteModal.id)} onCancel={() => setDeleteModal({ show: false, id: '', title: '' })} />
    </>
  );
}

// 프론트 자체 렌더링 미리보기 (미발행 전단지용)
function FlyerPreviewRenderer({ title, storeName, periodStart, periodEnd, categories, template }: {
  title: string; storeName: string; periodStart: string; periodEnd: string;
  categories: FlyerCategory[]; template: string;
}) {
  const fmtDate = (d: string) => { if (!d) return ''; const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  const fmtPrice = (n: number) => n ? n.toLocaleString() : '';
  const cleanCats = categories.map(c => ({ ...c, items: c.items.filter(i => i.name.trim()) })).filter(c => c.items.length > 0);
  const hasContent = title.trim() || cleanCats.length > 0;

  const colors = template === 'grid'
    ? { bg: '#FFF5F5', header: 'linear-gradient(135deg, #DC2626, #F97316)', card: '#fff', price: '#DC2626', badge: '#DC2626' }
    : template === 'list'
    ? { bg: '#1A1A1A', header: 'linear-gradient(135deg, #1A1A1A, #92400E)', card: '#262626', price: '#F59E0B', badge: '#F59E0B' }
    : { bg: '#111', header: 'linear-gradient(135deg, #EA580C, #DC2626)', card: '#1E1E1E', price: '#FB923C', badge: '#EA580C' };
  const isLight = template === 'grid';

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: colors.bg }}>
        <div className="text-center p-4">
          <p style={{ fontSize: 28 }}>📄</p>
          <p style={{ fontSize: 10, color: isLight ? '#999' : '#666', marginTop: 8 }}>상품을 입력하면<br />미리보기가 표시됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: colors.bg, minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      {/* 헤더 */}
      <div style={{ background: colors.header, padding: '16px 12px', textAlign: 'center' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.7)', margin: 0, letterSpacing: 1 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 14, color: '#fff', fontWeight: 800, margin: '4px 0' }}>{title || '행사명'}</p>
        {(periodStart || periodEnd) && (
          <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.8)', margin: 0 }}>{fmtDate(periodStart)} ~ {fmtDate(periodEnd)}</p>
        )}
      </div>

      {/* 상품 */}
      <div style={{ padding: '8px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: isLight ? '#333' : '#ddd', margin: '4px 0 4px 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat.name}</p>
            {template === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {cat.items.map((item, ii) => (
                  <div key={ii} style={{ background: colors.card, borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <p style={{ fontSize: 9, fontWeight: 600, color: '#333', margin: 0, lineHeight: 1.3 }}>{item.name}</p>
                    <div style={{ marginTop: 3, display: 'flex', alignItems: 'baseline', gap: 3 }}>
                      {item.originalPrice > 0 && <span style={{ fontSize: 7, color: '#999', textDecoration: 'line-through' }}>{fmtPrice(item.originalPrice)}</span>}
                      <span style={{ fontSize: 11, fontWeight: 800, color: colors.price }}>{fmtPrice(item.salePrice)}</span>
                    </div>
                    {item.badge && <span style={{ fontSize: 7, color: '#fff', background: colors.badge, borderRadius: 3, padding: '1px 4px', display: 'inline-block', marginTop: 2 }}>{item.badge}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {cat.items.map((item, ii) => (
                  <div key={ii} style={{ background: colors.card, borderRadius: 6, padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 600, color: isLight ? '#333' : '#eee', margin: 0 }}>{item.name}</p>
                      {item.badge && <span style={{ fontSize: 7, color: colors.badge, fontWeight: 600 }}>{item.badge}</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {item.originalPrice > 0 && <p style={{ fontSize: 7, color: '#999', textDecoration: 'line-through', margin: 0 }}>{fmtPrice(item.originalPrice)}</p>}
                      <p style={{ fontSize: 11, fontWeight: 800, color: colors.price, margin: 0 }}>{fmtPrice(item.salePrice)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
