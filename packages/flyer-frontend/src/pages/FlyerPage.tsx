import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, Button, Input, Badge, EmptyState, ConfirmModal, Toast } from '../components/ui';
import { getProductDisplay } from '../utils/product-images';

interface FlyerItem { name: string; originalPrice: number; salePrice: number; badge?: string; imageUrl?: string; unit?: string; origin?: string; cardDiscount?: string; aiCopy?: string; }
interface FlyerCategory { name: string; items: FlyerItem[]; }
interface Flyer { id: string; title: string; store_name: string; period_start: string | null; period_end: string | null; categories: FlyerCategory[]; template: string; status: string; short_code: string | null; click_count: number; created_at: string; extra_data?: any; }

// D113: 하드코딩 폴백용 (API 실패 시)
const DEFAULT_CATEGORY_PRESETS = ['청과/야채', '공산', '축산', '수산', '냉동', '유제품', '음료/주류', '생활용품'];
const DEFAULT_TEMPLATES: TemplateOption[] = [
  { value: 'grid', label: '가격 강조형', desc: '2열 카드 그리드, 가격 대형', color: 'linear-gradient(to right, #ef4444, #f97316)' },
  { value: 'magazine', label: '매거진형', desc: '1열 매거진 레이아웃, 대형 이미지', color: 'linear-gradient(to right, #292524, #c2410c)' },
  { value: 'editorial', label: '에디토리얼', desc: '풀블리드 이미지, 모던 타이포', color: 'linear-gradient(to right, #0f172a, #334155)' },
  { value: 'showcase', label: '쇼케이스', desc: '대형 싱글 카드, 절약액 표시', color: 'linear-gradient(to right, #7c3aed, #ec4899)' },
  { value: 'list', label: '리스트형', desc: '1열 매거진 (딥블루)', color: 'linear-gradient(to right, #1d4ed8, #3b82f6)' },
  { value: 'highlight', label: '특가 하이라이트', desc: '다크 쇼케이스, 옐로 강조', color: 'linear-gradient(to right, #18181b, #facc15)' },
];

interface TemplateOption { value: string; label: string; desc: string; color: string; }

export default function FlyerPage({ token, businessType = 'mart' }: { token: string; businessType?: string }) {
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFlyer, setEditingFlyer] = useState<Flyer | null>(null);

  // D113: 업종별 동적 템플릿/카테고리
  const [categoryPresets, setCategoryPresets] = useState<string[]>(DEFAULT_CATEGORY_PRESETS);
  const [availableTemplates, setAvailableTemplates] = useState<TemplateOption[]>(DEFAULT_TEMPLATES);
  const [defaultTemplate, setDefaultTemplate] = useState('grid');

  const [title, setTitle] = useState('');
  const [storeName, setStoreName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [template, setTemplate] = useState('grid');
  const [categories, setCategories] = useState<FlyerCategory[]>([{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);

  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });
  const [copyToast, setCopyToast] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; id: string; title: string }>({ show: false, id: '', title: '' });

  // 쿠폰 연동 (발행 시)
  const [couponModal, setCouponModal] = useState<{ show: boolean; flyerId: string }>({ show: false, flyerId: '' });
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponForm, setCouponForm] = useState({ coupon_name: '', coupon_type: 'fixed' as 'fixed' | 'percent' | 'free_item', discount_value: '', min_purchase: '', max_issues: '', expires_at: '' });
  const [couponSaving, setCouponSaving] = useState(false);

  const jsonHeaders = { 'Content-Type': 'application/json' };

  const loadFlyers = useCallback(async () => {
    try { const res = await apiFetch(`${API_BASE}/api/flyer/flyers`); if (res.ok) setFlyers(await res.json()); }
    catch (err) { console.error(err); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadFlyers(); }, [loadFlyers]);

  // D113: 업종별 템플릿/카테고리 동적 로딩
  useEffect(() => {
    apiFetch(`${API_BASE}/api/flyer/business-types`)
      .then(res => res.ok ? res.json() : null)
      .then((types: any[] | null) => {
        if (!types || types.length === 0) return;
        const myType = types.find((t: any) => t.type_code === businessType) || types[0];
        if (myType.category_presets?.length) setCategoryPresets(myType.category_presets);
        if (myType.templates?.length) setAvailableTemplates(myType.templates);
        if (myType.default_template) {
          setDefaultTemplate(myType.default_template);
          setTemplate(myType.default_template);
        }
      })
      .catch(() => {}); // 폴백: DEFAULT_* 유지
  }, [businessType]);

  const resetForm = () => { setTitle(''); setStoreName(''); setPeriodStart(''); setPeriodEnd(''); setTemplate(defaultTemplate); setCategories([{ name: categoryPresets[0] || '새 카테고리', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]); setEditingFlyer(null); };

  const handleSave = async () => {
    if (!title.trim()) { setAlert({ show: true, title: '입력 오류', message: '행사명을 입력해주세요.', type: 'error' }); return; }
    const clean = categories.map(c => ({ ...c, items: c.items.filter(i => i.name.trim()) })).filter(c => c.items.length > 0);
    if (clean.length === 0) { setAlert({ show: true, title: '입력 오류', message: '최소 1개 상품을 입력해주세요.', type: 'error' }); return; }
    try {
      const body = { title: title.trim(), store_name: storeName.trim(), period_start: periodStart || null, period_end: periodEnd || null, categories: clean, template, extra_data: extraData };
      const url = editingFlyer ? `${API_BASE}/api/flyer/flyers/${editingFlyer.id}` : `${API_BASE}/api/flyer/flyers`;
      const res = await apiFetch(url, { method: editingFlyer ? 'PUT' : 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
      if (res.ok) {
        setAlert({ show: true, title: editingFlyer ? '수정 완료' : '생성 완료', message: editingFlyer ? '전단지가 수정되었습니다.' : '전단지가 생성되었습니다. AI 상품 이미지를 생성 중입니다...', type: 'success' });
        setShowForm(false); resetForm(); loadFlyers();
        // 백그라운드 이미지 생성 트리거
        apiFetch(`${API_BASE}/api/flyer/flyers/generate-images`, {
          method: 'POST', headers: jsonHeaders, body: JSON.stringify({ categories: clean })
        }).catch(() => {});
      }
      else { const e = await res.json(); setAlert({ show: true, title: '오류', message: e.error || '저장 실패', type: 'error' }); }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
  };

  const handlePublish = (id: string) => {
    setCouponModal({ show: true, flyerId: id });
    setCouponEnabled(false);
    setCouponForm({ coupon_name: '', coupon_type: 'fixed', discount_value: '', min_purchase: '', max_issues: '', expires_at: '' });
  };

  const executePublish = async () => {
    const id = couponModal.flyerId;
    setCouponSaving(true);
    try {
      // 1. 전단 발행
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}/publish`, { method: 'POST' });
      if (!res.ok) { setAlert({ show: true, title: '오류', message: '발행 실패', type: 'error' }); return; }
      const d = await res.json();

      // 2. 쿠폰 생성 (활성화된 경우)
      if (couponEnabled && couponForm.coupon_name && couponForm.discount_value) {
        await apiFetch(`${API_BASE}/api/flyer/coupons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coupon_name: couponForm.coupon_name,
            coupon_type: couponForm.coupon_type,
            discount_value: Number(couponForm.discount_value),
            min_purchase: couponForm.min_purchase ? Number(couponForm.min_purchase) : undefined,
            max_issues: couponForm.max_issues ? Number(couponForm.max_issues) : undefined,
            expires_at: couponForm.expires_at || undefined,
            flyer_id: id,
          }),
        });
      }

      setCouponModal({ show: false, flyerId: '' });
      setAlert({ show: true, title: '발행 완료', message: `단축URL: ${d.short_url}${couponEnabled ? '\nQR 쿠폰도 생성되었습니다!' : ''}`, type: 'success' });
      loadFlyers();
    } catch { setAlert({ show: true, title: '오류', message: '발행 실패', type: 'error' }); }
    finally { setCouponSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try { const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}`, { method: 'DELETE' }); if (res.ok) { setAlert({ show: true, title: '삭제 완료', message: '삭제되었습니다.', type: 'success' }); setDeleteModal({ show: false, id: '', title: '' }); loadFlyers(); } }
    catch { setAlert({ show: true, title: '오류', message: '삭제 실패', type: 'error' }); }
  };

  const handleEdit = (f: Flyer) => {
    setEditingFlyer(f); setTitle(f.title); setStoreName(f.store_name || ''); setPeriodStart(f.period_start || ''); setPeriodEnd(f.period_end || ''); setTemplate(f.template || 'grid');
    const cats = typeof f.categories === 'string' ? JSON.parse(f.categories) : (f.categories || []);
    setCategories(cats.length > 0 ? cats : [{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
    const ed = typeof f.extra_data === 'string' ? JSON.parse(f.extra_data || '{}') : (f.extra_data || {});
    setExtraData(ed);
    setShowForm(true);
  };

  const handleCopyUrl = (code: string) => { navigator.clipboard.writeText(`https://hanjul-flyer.kr/${code}`); setCopyToast(true); setTimeout(() => setCopyToast(false), 2000); };

  const handleDownloadPdf = async (id: string, title: string) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}/pdf`, { method: 'POST' });
      if (!res.ok) throw new Error('PDF 생성 실패');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'flyer'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch { setAlert({ show: true, title: '오류', message: 'PDF 다운로드에 실패했습니다.', type: 'error' }); }
  };

  const [aiCopyLoading, setAiCopyLoading] = useState<string | null>(null);
  const [extraData, setExtraData] = useState<{
    externalLinks?: Array<{ label: string; url: string; icon: string }>;
    announcements?: Array<{ title: string; content: string }>;
    bannerGifUrl?: string;
  }>({});
  const handleAiCopy = async (ci: number, ii: number, copyType: string) => {
    const item = categories[ci]?.items[ii];
    if (!item?.name) { setAlert({ show: true, title: '알림', message: '상품명을 먼저 입력해주세요.', type: 'info' }); return; }
    const key = `${ci}-${ii}`;
    setAiCopyLoading(key);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/generate-copy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: item.name, category: categories[ci].name, copy_type: copyType })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      updateItem(ci, ii, 'aiCopy' as any, data.copy);
    } catch { setAlert({ show: true, title: '오류', message: 'AI 문구 생성 실패', type: 'error' }); }
    finally { setAiCopyLoading(null); }
  };

  const handlePopPdf = async (ci: number, ii: number) => {
    const item = categories[ci]?.items[ii];
    if (!item?.name || !item.salePrice) { setAlert({ show: true, title: '알림', message: '상품명과 할인가를 입력해주세요.', type: 'info' }); return; }
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/pop-pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, storeName })
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${item.name}_POP.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch { setAlert({ show: true, title: '오류', message: 'POP PDF 다운로드 실패', type: 'error' }); }
  };

  const addCategory = (name?: string) => setCategories([...categories, { name: name || '새 카테고리', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
  const removeCategory = (idx: number) => setCategories(categories.filter((_, i) => i !== idx));
  const updateCategoryName = (idx: number, name: string) => { const u = [...categories]; u[idx].name = name; setCategories(u); };
  const addItem = (ci: number) => { const u = [...categories]; u[ci].items.push({ name: '', originalPrice: 0, salePrice: 0 }); setCategories(u); };
  const removeItem = (ci: number, ii: number) => { const u = [...categories]; u[ci].items = u[ci].items.filter((_, i) => i !== ii); setCategories(u); };
  const updateItem = (ci: number, ii: number, f: keyof FlyerItem, v: string | number) => { const u = [...categories]; (u[ci].items[ii] as any)[f] = v; setCategories(u); };

  const fmtDate = (d: string | null) => { if (!d) return ''; const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()}`; };

  // ★ 행사 기간 만료 판정
  const isExpired = (f: Flyer) => {
    if (!f.period_end) return false;
    const endStr = typeof f.period_end === 'string' ? f.period_end.slice(0, 10) : '';
    if (!endStr) return false;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return endStr < todayStr;
  };

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
                      {isExpired(f) ? (
                        <Badge variant="warn">만료</Badge>
                      ) : (
                        <Badge variant={f.status === 'published' ? 'success' : 'neutral'}>{f.status === 'published' ? '발행됨' : '임시저장'}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    {(f.period_start || f.period_end) && <p className="text-xs text-text-muted mb-2">{fmtDate(f.period_start)} ~ {fmtDate(f.period_end)}</p>}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-text-muted">{availableTemplates.find(t => t.value === f.template)?.label || f.template}</span>
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
                      {f.status === 'published' && <button onClick={() => handleDownloadPdf(f.id, f.title)} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium">PDF</button>}
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
                <div className="col-span-2"><Input label="행사명 *" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: X월 XX일~XX일 행사" /></div>
                <Input label="매장명" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="예: OO마트" />
                <div className="grid grid-cols-2 gap-2">
                  <Input label="시작일" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                  <Input label="종료일" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="디자인 템플릿" className="mb-4">
              <div className="grid grid-cols-3 gap-3">
                {availableTemplates.map(t => (
                  <button key={t.value} onClick={() => setTemplate(t.value)}
                    className={`rounded-xl border-2 text-left transition-all overflow-hidden ${template === t.value ? 'border-primary-500 shadow-elevated' : 'border-border hover:border-border-strong'}`}>
                    {/* ★ D114: 인라인 스타일 — Tailwind 동적 클래스 purge 방지 */}
                    <div className="h-3 rounded-t-[10px]" style={{ background: t.color }} />
                    <div className="p-3 text-center">
                      <div className="text-sm font-bold text-text">{t.label}</div>
                      <div className="text-xs text-text-muted mt-0.5">{t.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>

            <ProductRegistrationSection
              categories={categories}
              setCategories={setCategories}
              addCategory={addCategory}
              removeCategory={removeCategory}
              updateCategoryName={updateCategoryName}
              addItem={addItem}
              removeItem={removeItem}
              updateItem={updateItem}
              setAlert={setAlert}
              categoryPresets={categoryPresets}
              aiCopyLoading={aiCopyLoading}
              handleAiCopy={handleAiCopy}
              handlePopPdf={handlePopPdf}
              extraData={extraData}
              setExtraData={setExtraData}
            />

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }}>취소</Button>
              <Button onClick={handleSave}>{editingFlyer ? '수정 저장' : '전단지 저장'}</Button>
            </div>
          </div>

          {/* 우측: 모던 폰 프레임 미리보기 */}
          <div className="w-[280px] flex-shrink-0 sticky top-20 self-start">
            <p className="text-xs font-semibold text-text-secondary mb-3 text-center">미리보기</p>
            <div className="relative mx-auto" style={{ width: 260 }}>
              {/* 폰 외곽 — 모던 플랫 스타일 */}
              <div className="bg-[#1a1a1a] rounded-[2.8rem] p-[6px] shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
                {/* 다이나믹 아일랜드 */}
                <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[72px] h-[22px] bg-[#1a1a1a] rounded-full z-20" />
                {/* 스크린 */}
                <div className="bg-surface rounded-[2.4rem] overflow-hidden relative">
                  {/* 상태바 */}
                  <div className="h-[42px] bg-white/80 backdrop-blur-sm flex items-end justify-between px-6 pb-1">
                    <span className="text-[9px] font-semibold text-gray-800">9:41</span>
                    <div className="flex items-center gap-[3px]">
                      <svg className="w-[14px] h-[10px] text-gray-800" viewBox="0 0 17 12" fill="currentColor"><path d="M15.5 1h-1a.5.5 0 00-.5.5v9a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-9a.5.5 0 00-.5-.5zM11.5 3h-1a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-7a.5.5 0 00-.5-.5zM7.5 5h-1a.5.5 0 00-.5.5v5a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-5a.5.5 0 00-.5-.5zM3.5 7.5h-1a.5.5 0 00-.5.5v2.5a.5.5 0 00.5.5h1a.5.5 0 00.5-.5V8a.5.5 0 00-.5-.5z"/></svg>
                      <svg className="w-[15px] h-[10px] text-gray-800" viewBox="0 0 16 12" fill="currentColor"><path d="M8 3.5a6.47 6.47 0 014.56 1.86.5.5 0 01-.7.7A5.47 5.47 0 008 4.5a5.47 5.47 0 00-3.86 1.56.5.5 0 01-.7-.7A6.47 6.47 0 018 3.5z"/><path d="M8 6.5a3.98 3.98 0 012.83 1.17.5.5 0 01-.71.71A2.98 2.98 0 008 7.5a2.98 2.98 0 00-2.12.88.5.5 0 01-.71-.71A3.98 3.98 0 018 6.5z"/><circle cx="8" cy="10" r="1"/></svg>
                      <div className="w-[22px] h-[10px] border border-gray-800 rounded-[3px] relative ml-0.5">
                        <div className="absolute inset-[1.5px] bg-gray-800 rounded-[1px]" style={{ width: '70%' }} />
                        <div className="absolute right-[-3px] top-[2.5px] w-[1.5px] h-[4px] bg-gray-800 rounded-r-sm" />
                      </div>
                    </div>
                  </div>
                  {/* 미니 주소바 */}
                  <div className="bg-gray-100 mx-3 mt-0.5 mb-1 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                    <svg className="w-2.5 h-2.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v.01M12 12a2.5 2.5 0 001.286-4.642A2.5 2.5 0 0011 5.5 2.5 2.5 0 008.714 7.358 2.5 2.5 0 0010 12" /></svg>
                    <span className="text-[8px] text-gray-500 font-medium">hanjul-flyer.kr</span>
                  </div>
                  {/* 콘텐츠 */}
                  <div className="overflow-y-auto" style={{ height: 460 }}>
                    {editingFlyer?.short_code ? (
                      <iframe src={`${API_BASE}/api/flyer/p/${editingFlyer.short_code}`} className="w-full border-0" style={{ height: 460, transform: 'scale(0.66)', transformOrigin: 'top left', width: '152%' }} title="미리보기" />
                    ) : (
                      <FlyerPreviewRenderer title={title} storeName={storeName} periodStart={periodStart} periodEnd={periodEnd} categories={categories} template={template} />
                    )}
                  </div>
                  {/* 홈 인디케이터 */}
                  <div className="flex justify-center py-2 bg-white">
                    <div className="w-[100px] h-[4px] bg-gray-900 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-text-muted text-center mt-3">
              {editingFlyer?.short_code ? '발행된 전단지 미리보기' : '입력 내용이 실시간 반영됩니다'}
            </p>
          </div>
        </div>
      )}

      {/* ── 발행 + 쿠폰 모달 ── */}
      {couponModal.show && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setCouponModal({ show: false, flyerId: '' })}>
          <div className="bg-surface rounded-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">전단지 발행</h3>

            {/* 쿠폰 토글 */}
            <div className="flex items-center justify-between bg-surface-secondary rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">QR 쿠폰 추가</p>
                <p className="text-xs text-text-tertiary">전단 하단에 QR 코드가 삽입됩니다</p>
              </div>
              <button
                onClick={() => setCouponEnabled(!couponEnabled)}
                className={`w-12 h-6 rounded-full transition-colors relative ${couponEnabled ? 'bg-primary-600' : 'bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${couponEnabled ? 'left-[26px]' : 'left-0.5'}`} />
              </button>
            </div>

            {/* 쿠폰 설정 (토글 ON일 때만) */}
            {couponEnabled && (
              <div className="space-y-3 border border-border rounded-xl p-4">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">쿠폰명 *</label>
                  <Input value={couponForm.coupon_name} onChange={e => setCouponForm({ ...couponForm, coupon_name: e.target.value })} placeholder="예: 5,000원 할인 쿠폰" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">할인 유형</label>
                    <select className="w-full bg-surface-secondary border border-border rounded-lg px-3 py-2 text-sm text-white" value={couponForm.coupon_type} onChange={e => setCouponForm({ ...couponForm, coupon_type: e.target.value as any })}>
                      <option value="fixed">정액 (원)</option>
                      <option value="percent">퍼센트 (%)</option>
                      <option value="free_item">증정품</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">할인값 *</label>
                    <Input type="number" value={couponForm.discount_value} onChange={e => setCouponForm({ ...couponForm, discount_value: e.target.value })} placeholder="5000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">최대 발급수</label>
                    <Input type="number" value={couponForm.max_issues} onChange={e => setCouponForm({ ...couponForm, max_issues: e.target.value })} placeholder="무제한" />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">만료일</label>
                    <Input type="date" value={couponForm.expires_at} onChange={e => setCouponForm({ ...couponForm, expires_at: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setCouponModal({ show: false, flyerId: '' })}>취소</Button>
              <Button className="flex-1" onClick={executePublish} disabled={couponSaving}>
                {couponSaving ? '처리 중...' : couponEnabled ? '발행 + 쿠폰 생성' : '발행하기'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
      <Toast show={copyToast} message="URL이 복사되었습니다" />
      <ConfirmModal show={deleteModal.show} icon="🗑️" title="전단지 삭제" message={`"${deleteModal.title}"을(를) 삭제하시겠습니까?`} danger confirmLabel="삭제" onConfirm={() => handleDelete(deleteModal.id)} onCancel={() => setDeleteModal({ show: false, id: '', title: '' })} />
    </>
  );
}

// ============================================================
// 상품 등록 섹션 — 엑셀 업로드 + 카테고리 탭 방식
// ============================================================
function ProductRegistrationSection({ categories, setCategories, addCategory, removeCategory, updateCategoryName, addItem, removeItem, updateItem, setAlert, categoryPresets, aiCopyLoading, handleAiCopy, handlePopPdf, extraData, setExtraData }: {
  categories: FlyerCategory[];
  setCategories: (c: FlyerCategory[]) => void;
  addCategory: (name?: string) => void;
  removeCategory: (idx: number) => void;
  updateCategoryName: (idx: number, name: string) => void;
  addItem: (ci: number) => void;
  removeItem: (ci: number, ii: number) => void;
  updateItem: (ci: number, ii: number, f: keyof FlyerItem, v: string | number) => void;
  setAlert: (a: { show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }) => void;
  categoryPresets: string[];
  aiCopyLoading: string | null;
  handleAiCopy: (ci: number, ii: number, copyType: string) => void;
  handlePopPdf: (ci: number, ii: number) => void;
  extraData: { externalLinks?: Array<{ label: string; url: string; icon: string }>; announcements?: Array<{ title: string; content: string }>; bannerGifUrl?: string };
  setExtraData: (d: any) => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ★ 이미지 후보 선택기
  const [imagePickerState, setImagePickerState] = useState<{ catIdx: number; itemIdx: number; candidates: Array<{ title: string; image: string }> } | null>(null);

  const handlePickImage = async (imageUrl: string) => {
    if (!imagePickerState) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/select-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        updateItem(imagePickerState.catIdx, imagePickerState.itemIdx, 'imageUrl', data.image_url);
      }
    } catch {}
    setImagePickerState(null);
  };

  // ★ 카탈로그 불러오기
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; product_name: string; category: string; default_price: number; image_url: string | null }>>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadCatalog = async () => {
    setCatalogLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog`);
      if (res.ok) {
        const data = await res.json();
        setCatalogItems(Array.isArray(data) ? data : data.items || []);
      }
    } catch (e) { console.error(e); }
    finally { setCatalogLoading(false); }
  };

  const handleCatalogSelect = (item: { product_name: string; default_price: number; image_url: string | null }) => {
    const safeTab = Math.min(activeTab, Math.max(categories.length - 1, 0));
    if (categories.length === 0) return;
    const u = [...categories];
    u[safeTab].items.push({
      name: item.product_name,
      originalPrice: item.default_price,
      salePrice: item.default_price,
      imageUrl: item.image_url || undefined,
    });
    setCategories(u);
  };
  const jsonHeaders = { 'Content-Type': 'application/json' };

  // 활성 탭이 범위 밖이면 보정
  const safeTab = Math.min(activeTab, Math.max(categories.length - 1, 0));

  // 예시 엑셀 다운로드 (CSV — 엑셀에서 바로 열림)
  const downloadTemplate = () => {
    const BOM = '\uFEFF';
    const header = '카테고리,상품명,원가,할인가,뱃지';
    const examples = [
      '청과/야채,대저토마토,8980,6980,오늘만',
      '청과/야채,짭짤이 토마토,9900,7900,인기',
      '청과/야채,청송사과 20kg,79800,59800,',
      '축산,한돈 삼겹살 1kg,18900,12900,초특가',
      '축산,한우 등심 1++ 500g,49800,39800,프리미엄',
      '수산,노르웨이 연어 500g,19900,14900,',
      '수산,흰다리 새우 1kg,15900,11900,대용량',
      '유제품,서울우유 1L,2980,2480,',
      '냉동,비비고 만두 1kg,8900,6900,1+1',
      '음료/주류,카스 500ml 12캔,18900,14900,주말특가',
    ];
    const csv = BOM + header + '\n' + examples.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '전단지_상품_예시.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // 엑셀/CSV 파일 업로드 파싱
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        // 헤더 스킵 (첫 줄이 '카테고리'로 시작하면)
        const startIdx = lines[0]?.includes('카테고리') ? 1 : 0;

        const parsed: Record<string, FlyerItem[]> = {};
        for (let i = startIdx; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.length < 3) continue;

          const catName = cols[0] || '기타';
          const itemName = cols[1] || '';
          const originalPrice = Number(cols[2]) || 0;
          const salePrice = Number(cols[3]) || 0;
          const badge = cols[4] || '';

          if (!itemName) continue;

          if (!parsed[catName]) parsed[catName] = [];
          parsed[catName].push({ name: itemName, originalPrice, salePrice, badge });
        }

        const newCategories: FlyerCategory[] = Object.entries(parsed).map(([name, items]) => ({ name, items }));

        if (newCategories.length === 0) {
          setAlert({ show: true, title: '업로드 오류', message: '유효한 상품 데이터가 없습니다. 예시 파일 형식을 확인해주세요.', type: 'error' });
          return;
        }

        const totalItems = newCategories.reduce((sum, c) => sum + c.items.length, 0);

        // 카테고리가 전부 '기타'면 → 자동분류 시도
        const allEtc = newCategories.every(c => c.name === '기타');
        if (allEtc && totalItems > 0) {
          try {
            const allItems = newCategories.flatMap(c => c.items);
            const res = await apiFetch(`${API_BASE}/api/flyer/flyers/classify-products`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: allItems.map(i => ({ name: i.name })) })
            });
            if (res.ok) {
              const data = await res.json();
              const autoCategories: FlyerCategory[] = Object.entries(data.classified as Record<string, string[]>)
                .map(([catName, names]) => ({
                  name: catName,
                  items: (names as string[]).map(n => allItems.find(i => i.name === n) || { name: n, originalPrice: 0, salePrice: 0 })
                }));
              if (autoCategories.length > 0) {
                setCategories(autoCategories);
                setAlert({ show: true, title: '자동 분류 완료', message: `${autoCategories.length}개 카테고리, ${totalItems}개 상품이 자동 분류되었습니다.`, type: 'success' });
                return;
              }
            }
          } catch {} // 자동분류 실패 시 원본 그대로 진행
        }

        // 기존 카테고리에 머지 (같은 이름이면 추가, 새 이름이면 새 탭)
        const merged = [...categories];
        for (const newCat of newCategories) {
          const existIdx = merged.findIndex(c => c.name === newCat.name);
          if (existIdx >= 0) {
            merged[existIdx].items = [...merged[existIdx].items, ...newCat.items];
          } else {
            merged.push(newCat);
          }
        }

        setCategories(merged);
        setAlert({ show: true, title: '업로드 완료', message: `${newCategories.length}개 카테고리, ${totalItems}개 상품이 등록되었습니다.`, type: 'success' });
      } catch {
        setAlert({ show: true, title: '업로드 오류', message: '파일 형식이 올바르지 않습니다.', type: 'error' });
      }
    };
    reader.readAsText(file, 'UTF-8');
    // 같은 파일 재업로드 가능하도록 초기화
    e.target.value = '';
  };

  const totalItems = categories.reduce((sum, c) => sum + c.items.filter(i => i.name.trim()).length, 0);

  return (
    <SectionCard title={`상품 등록 (${totalItems}개)`} className="mb-4">
      {/* 엑셀 업로드 / 예시 다운로드 */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors">
          <span>📋</span> 예시파일 다운로드
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-success-600 bg-success-50 hover:bg-success-100 rounded-lg transition-colors">
          <span>📥</span> 엑셀/CSV 업로드
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
        <span className="text-[10px] text-text-muted ml-1">CSV 형식 (엑셀에서 다른이름으로 저장 → CSV)</span>
      </div>

      {/* 카테고리 추가 버튼들 */}
      <div className="flex flex-wrap gap-1 mb-4">
        {categoryPresets.filter(p => !categories.some(c => c.name === p)).map(p => (
          <button key={p} onClick={() => { addCategory(p); setActiveTab(categories.length); }} className="px-2.5 py-1 text-xs bg-bg hover:bg-border/50 rounded-md text-text-secondary font-medium transition-colors">+{p}</button>
        ))}
      </div>

      {/* 카테고리 탭 */}
      {categories.length > 0 && (
        <>
          <div className="flex border-b border-border mb-3 overflow-x-auto">
            {categories.map((cat, ci) => {
              const itemCount = cat.items.filter(i => i.name.trim()).length;
              return (
                <button key={ci} onClick={() => setActiveTab(ci)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    safeTab === ci
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-text-muted hover:text-text hover:border-border-strong'
                  }`}>
                  {cat.name}
                  {itemCount > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                      safeTab === ci ? 'bg-primary-100 text-primary-700' : 'bg-bg text-text-muted'
                    }`}>{itemCount}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 활성 카테고리 상품 목록 */}
          {categories[safeTab] && (
            <div className="border border-border rounded-xl p-4 bg-bg/30">
              <div className="flex justify-between items-center mb-3">
                <input type="text" value={categories[safeTab].name} onChange={e => updateCategoryName(safeTab, e.target.value)}
                  className="font-bold text-sm text-text border-b border-transparent hover:border-border-strong focus:border-primary-500 focus:outline-none pb-1 bg-transparent" />
                <button onClick={() => { removeCategory(safeTab); setActiveTab(Math.max(0, safeTab - 1)); }}
                  className="text-xs text-error-500 hover:text-error-600 font-medium">카테고리 삭제</button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1">
                  <div className="col-span-4">상품명</div><div className="col-span-2">원가/할인가</div><div className="col-span-2">규격/원산지</div><div className="col-span-2">뱃지</div><div className="col-span-1">카드할인</div><div className="col-span-1"></div>
                </div>
                {categories[safeTab].items.map((item, ii) => (
                  <div key={ii} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4 flex items-center gap-2">
                      <div className="relative flex-shrink-0">
                        <label className="cursor-pointer block w-9 h-9 rounded-lg border border-dashed border-border hover:border-primary-500 overflow-hidden flex items-center justify-center bg-bg/50 transition-colors">
                          {item.imageUrl ? (
                            <img src={`${API_BASE}${item.imageUrl}`} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-text-muted text-sm">📷</span>
                          )}
                          <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 1 * 1024 * 1024) { setAlert({ show: true, title: '업로드 오류', message: '이미지 크기는 1MB 이하여야 합니다.', type: 'error' }); return; }
                            const formData = new FormData();
                            formData.append('image', file);
                            try {
                              const res = await apiFetch(`${API_BASE}/api/flyer/flyers/product-image`, { method: 'POST', body: formData });
                              if (res.ok) {
                                const data = await res.json();
                                updateItem(safeTab, ii, 'imageUrl', data.url);
                              } else {
                                const err = await res.json();
                                setAlert({ show: true, title: '업로드 실패', message: err.error || '이미지 업로드에 실패했습니다.', type: 'error' });
                              }
                            } catch { setAlert({ show: true, title: '업로드 실패', message: '네트워크 오류', type: 'error' }); }
                            e.target.value = '';
                          }} />
                        </label>
                        {item.imageUrl && (
                          <button onClick={async () => {
                            try { await apiFetch(`${API_BASE}/api/flyer/flyers/product-image`, { method: 'DELETE', headers: jsonHeaders, body: JSON.stringify({ url: item.imageUrl }) }); } catch {}
                            updateItem(safeTab, ii, 'imageUrl', '');
                          }} className="absolute -top-1 -right-1 w-4 h-4 bg-error-500 text-white rounded-full text-[10px] leading-none flex items-center justify-center hover:bg-error-600">✕</button>
                        )}
                      </div>
                      <input type="text" value={item.name} onChange={e => updateItem(safeTab, ii, 'name', e.target.value)} placeholder="상품명"
                        className="flex-1 min-w-0 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface"
                        onBlur={async (e) => {
                          const name = e.target.value.trim();
                          if (!name || item.imageUrl) return;
                          try {
                            // 1순위: 서버 카탈로그에서 동일 상품명 이미지 조회
                            const catalogRes = await apiFetch(`${API_BASE}/api/flyer/catalog/find-image?name=${encodeURIComponent(name)}`);
                            if (catalogRes.ok) {
                              const catalogData = await catalogRes.json();
                              if (catalogData.image_url) {
                                updateItem(safeTab, ii, 'imageUrl', catalogData.image_url);
                                return; // 서버 매칭 성공 → 검색 스킵
                              }
                            }
                            // 2순위: 네이버 쇼핑 검색 → 후보 표시
                            const catName = categories[safeTab]?.name || '';
                            const searchQuery = catName ? `${name} ${catName}` : name;
                            const res = await apiFetch(`${API_BASE}/api/flyer/catalog/search-image`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ product_name: searchQuery }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              if (data.items?.length > 0) {
                                setImagePickerState({ catIdx: safeTab, itemIdx: ii, candidates: data.items });
                              }
                            }
                          } catch {}
                        }} />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(safeTab, ii, 'originalPrice', Number(e.target.value))} placeholder="원가"
                        className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                      <input type="number" value={item.salePrice || ''} onChange={e => updateItem(safeTab, ii, 'salePrice', Number(e.target.value))} placeholder="할인가"
                        className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <input type="text" value={item.unit || ''} onChange={e => updateItem(safeTab, ii, 'unit' as any, e.target.value)} placeholder="6kg/통"
                        className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                      <input type="text" value={item.origin || ''} onChange={e => updateItem(safeTab, ii, 'origin' as any, e.target.value)} placeholder="국내산"
                        className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    </div>
                    <input type="text" value={item.badge || ''} onChange={e => updateItem(safeTab, ii, 'badge', e.target.value)} placeholder="뱃지"
                      className="col-span-2 px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    <input type="text" value={item.cardDiscount || ''} onChange={e => updateItem(safeTab, ii, 'cardDiscount' as any, e.target.value)} placeholder="농협5%"
                      className="col-span-1 px-1.5 py-1.5 border border-border rounded-lg text-[10px] focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    <div className="col-span-1 flex gap-0.5 items-center justify-center">
                      <div className="relative group">
                        <button className={`text-[10px] px-1 py-0.5 rounded ${aiCopyLoading === `${safeTab}-${ii}` ? 'text-gray-400' : 'text-purple-500 hover:bg-purple-50'}`}
                          disabled={aiCopyLoading === `${safeTab}-${ii}`}>
                          {aiCopyLoading === `${safeTab}-${ii}` ? '...' : 'AI'}
                        </button>
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 hidden group-hover:block min-w-[100px]">
                          {[['recipe','조리팁'],['benefit','효능'],['storage','보관법'],['selling_point','매력포인트']].map(([k,l]) => (
                            <button key={k} onClick={() => handleAiCopy(safeTab, ii, k)} className="block w-full text-left px-3 py-1.5 text-[11px] hover:bg-purple-50 text-gray-700">{l}</button>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => handlePopPdf(safeTab, ii)} className="text-[10px] px-1 py-0.5 rounded text-indigo-500 hover:bg-indigo-50" title="가격표 PDF">POP</button>
                      <button onClick={() => removeItem(safeTab, ii)} className="text-error-500/60 hover:text-error-500 transition-colors">✕</button>
                    </div>
                    {item.aiCopy && <div className="col-span-12 -mt-1 mb-1 px-1"><p className="text-[10px] text-purple-500 truncate">{item.aiCopy}</p></div>}
                  </div>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => addItem(safeTab)} className="flex-1 py-2 text-xs text-primary-600 hover:bg-primary-50 rounded-lg border border-dashed border-primary-500/30 transition-colors font-medium">+ 상품 추가</button>
                  <button onClick={() => { setShowCatalog(true); loadCatalog(); }} className="flex-1 py-2 text-xs text-text-secondary hover:bg-surface-hover rounded-lg border border-dashed border-border transition-colors font-medium">📦 카탈로그에서</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════ 추가 요소 (외부링크/공지/GIF) ══════ */}
      <div className="mt-4 border border-border rounded-xl bg-surface overflow-hidden">
        <button onClick={() => {
          const el = document.getElementById('extra-section');
          if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
        }} className="w-full px-4 py-3 text-left text-sm font-semibold text-text-secondary hover:bg-surface-hover flex justify-between items-center">
          <span>추가 요소 (링크/공지/GIF)</span>
          <span className="text-xs text-text-muted">{(extraData.externalLinks?.length || 0) + (extraData.announcements?.length || 0) + (extraData.bannerGifUrl ? 1 : 0)}개</span>
        </button>
        <div id="extra-section" style={{ display: 'none' }} className="px-4 pb-4 space-y-3">
          {/* 외부 링크 */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2">외부 링크</p>
            {(extraData.externalLinks || []).map((link, i) => (
              <div key={i} className="flex gap-1 mb-1.5 items-center">
                <select value={link.icon} onChange={e => {
                  const u = [...(extraData.externalLinks || [])]; u[i].icon = e.target.value; setExtraData({ ...extraData, externalLinks: u });
                }} className="px-1.5 py-1 border border-border rounded text-[10px] bg-surface w-16">
                  {['phone','shop','band','map','instagram','blog','link'].map(ic => <option key={ic} value={ic}>{ic}</option>)}
                </select>
                <input value={link.label} onChange={e => {
                  const u = [...(extraData.externalLinks || [])]; u[i].label = e.target.value; setExtraData({ ...extraData, externalLinks: u });
                }} placeholder="라벨" className="flex-1 px-2 py-1 border border-border rounded text-xs bg-surface" />
                <input value={link.url} onChange={e => {
                  const u = [...(extraData.externalLinks || [])]; u[i].url = e.target.value; setExtraData({ ...extraData, externalLinks: u });
                }} placeholder="URL (tel:031-xxx 등)" className="flex-[2] px-2 py-1 border border-border rounded text-xs bg-surface" />
                <button onClick={() => {
                  const u = (extraData.externalLinks || []).filter((_, j) => j !== i); setExtraData({ ...extraData, externalLinks: u });
                }} className="text-error-500/60 hover:text-error-500 text-xs">✕</button>
              </div>
            ))}
            <button onClick={() => setExtraData({ ...extraData, externalLinks: [...(extraData.externalLinks || []), { label: '', url: '', icon: 'phone' }] })}
              className="text-[11px] text-primary-600 hover:text-primary-700 font-medium">+ 링크 추가</button>
          </div>

          {/* 공지사항 */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2">공지사항</p>
            {(extraData.announcements || []).map((ann, i) => (
              <div key={i} className="flex gap-1 mb-1.5 items-start">
                <input value={ann.title} onChange={e => {
                  const u = [...(extraData.announcements || [])]; u[i].title = e.target.value; setExtraData({ ...extraData, announcements: u });
                }} placeholder="제목" className="w-24 px-2 py-1 border border-border rounded text-xs bg-surface" />
                <input value={ann.content} onChange={e => {
                  const u = [...(extraData.announcements || [])]; u[i].content = e.target.value; setExtraData({ ...extraData, announcements: u });
                }} placeholder="내용" className="flex-1 px-2 py-1 border border-border rounded text-xs bg-surface" />
                <button onClick={() => {
                  const u = (extraData.announcements || []).filter((_, j) => j !== i); setExtraData({ ...extraData, announcements: u });
                }} className="text-error-500/60 hover:text-error-500 text-xs mt-1">✕</button>
              </div>
            ))}
            <button onClick={() => setExtraData({ ...extraData, announcements: [...(extraData.announcements || []), { title: '', content: '' }] })}
              className="text-[11px] text-primary-600 hover:text-primary-700 font-medium">+ 공지 추가</button>
          </div>

          {/* GIF 배너 URL */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2">GIF 배너 URL</p>
            <input value={extraData.bannerGifUrl || ''} onChange={e => setExtraData({ ...extraData, bannerGifUrl: e.target.value || undefined })}
              placeholder="https://... (GIF 이미지 URL)" className="w-full px-2 py-1.5 border border-border rounded text-xs bg-surface" />
          </div>
        </div>
      </div>

      {/* 카테고리 0개일 때 */}
      {categories.length === 0 && (
        <div className="text-center py-8 text-text-muted">
          <p className="text-2xl mb-2">📦</p>
          <p className="text-sm">위 카테고리 버튼을 클릭하거나<br/>예시파일을 업로드하여 상품을 등록하세요</p>
        </div>
      )}

      <button onClick={() => addCategory()} className="w-full mt-3 py-2.5 text-sm text-text-secondary hover:bg-bg rounded-xl border border-dashed border-border transition-colors font-medium">+ 카테고리 추가</button>

      {/* ★ 카탈로그 선택 모달 */}
      {showCatalog && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCatalog(false)}>
          <div className="bg-surface rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">카탈로그에서 상품 추가</h3>
              <button onClick={() => setShowCatalog(false)} className="text-text-tertiary hover:text-white">X</button>
            </div>
            {catalogLoading ? (
              <p className="text-center py-8 text-text-secondary">로딩 중...</p>
            ) : catalogItems.length === 0 ? (
              <p className="text-center py-8 text-text-tertiary">등록된 상품이 없습니다.<br/>상품관리에서 먼저 등록해주세요.</p>
            ) : (
              <div className="space-y-2">
                {catalogItems.map(item => (
                  <button key={item.id} onClick={() => { handleCatalogSelect(item); setAlert({ show: true, title: '추가됨', message: `"${item.product_name}" 추가`, type: 'success' }); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-secondary hover:bg-surface-hover transition-colors text-left">
                    {item.image_url ? (
                      <img src={item.image_url.startsWith('http') ? item.image_url : `${API_BASE}${item.image_url}`} alt="" className="w-12 h-12 object-cover rounded-lg" />
                    ) : (
                      <div className="w-12 h-12 bg-bg rounded-lg flex items-center justify-center text-lg">📦</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{item.product_name}</p>
                      <p className="text-xs text-text-tertiary">{item.category} · {item.default_price?.toLocaleString()}원</p>
                    </div>
                    <span className="text-xs text-primary-500 font-medium">추가</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* ★ 이미지 후보 선택 팝업 */}
      {imagePickerState && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setImagePickerState(null)}>
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">상품 이미지 선택</h3>
              <button onClick={() => setImagePickerState(null)} className="text-text-tertiary hover:text-white text-xs">닫기</button>
            </div>
            <p className="text-xs text-text-tertiary mb-3">원하는 이미지를 클릭하세요</p>
            <div className="grid grid-cols-3 gap-2">
              {imagePickerState.candidates.map((c, i) => (
                <button key={i} onClick={() => handlePickImage(c.image)}
                  className="aspect-square border-2 border-border rounded-lg overflow-hidden hover:border-primary-500 transition-colors">
                  <img src={c.image} alt={c.title} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            <button onClick={() => setImagePickerState(null)} className="w-full mt-3 py-2 text-xs text-text-muted hover:text-text-secondary">이미지 없이 진행</button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ============================================================
// 프론트 자체 렌더링 미리보기 (미발행 전단지용) — CT-F14 V3 동기화
// 4개 레이아웃 엔진: grid, magazine, editorial, showcase
// ============================================================

/** 엔진 분류: template code → layout engine */
const ENGINE_MAP: Record<string, string> = {
  grid: 'grid', mart_fresh: 'grid', event_bogo: 'grid',
  magazine: 'magazine', butcher_premium: 'magazine', season_winter: 'magazine',
  editorial: 'editorial', season_chuseok: 'editorial', event_grand_open: 'editorial',
  showcase: 'showcase', highlight: 'showcase', season_newyear: 'showcase',
  mart_clearance: 'compact', mart_general: 'compact', season_summer: 'compact',
  butcher_hanwoo: 'hero', mart_seafood: 'hero',
  event_timesale: 'swipe', season_christmas: 'swipe',
  butcher_giftset: 'mosaic', event_membership: 'mosaic',
};

/** 테마 색상 (미리보기용 간소화) */
const PREVIEW_THEMES: Record<string, { hero: string; price: string; bg: string; dark?: boolean; badge: string; chip: string; chipC: string }> = {
  // 기본
  grid:             { hero: 'linear-gradient(145deg,#dc2626,#991b1b)', price: '#dc2626', bg: '#f3f4f6', badge: 'linear-gradient(135deg,#dc2626,#ea580c)', chip: '#fef2f2', chipC: '#b91c1c' },
  magazine:         { hero: 'linear-gradient(160deg,#292524,#0c0a09)', price: '#c2410c', bg: '#fafaf9', badge: 'linear-gradient(135deg,#ea580c,#c2410c)', chip: '#fff7ed', chipC: '#9a3412' },
  editorial:        { hero: 'linear-gradient(180deg,#0f172a,#1e293b)', price: '#0f172a', bg: '#fff', badge: 'linear-gradient(135deg,#ef4444,#dc2626)', chip: '#f1f5f9', chipC: '#334155' },
  showcase:         { hero: 'linear-gradient(135deg,#7c3aed,#4c1d95)', price: '#7c3aed', bg: '#fafafa', badge: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', chip: '#f5f3ff', chipC: '#6d28d9' },
  highlight:        { hero: 'linear-gradient(145deg,#18181b,#09090b)', price: '#facc15', bg: '#0a0a0a', dark: true, badge: 'linear-gradient(135deg,#facc15,#eab308)', chip: 'rgba(250,204,21,.1)', chipC: '#facc15' },
  // 시즌
  season_newyear:   { hero: 'linear-gradient(145deg,#991b1b,#dc2626)', price: '#b91c1c', bg: '#fef2f2', badge: 'linear-gradient(135deg,#dc2626,#ca8a04)', chip: '#fef9c3', chipC: '#92400e' },
  season_chuseok:   { hero: 'linear-gradient(160deg,#1e3a5f,#3b82f6)', price: '#1e40af', bg: '#fffbeb', badge: 'linear-gradient(135deg,#f59e0b,#d97706)', chip: '#fef3c7', chipC: '#92400e' },
  season_summer:    { hero: 'linear-gradient(145deg,#0891b2,#22d3ee)', price: '#0e7490', bg: '#ecfeff', badge: 'linear-gradient(135deg,#06b6d4,#0891b2)', chip: '#cffafe', chipC: '#155e75' },
  season_winter:    { hero: 'linear-gradient(160deg,#881337,#e11d48)', price: '#be123c', bg: '#fff1f2', badge: 'linear-gradient(135deg,#e11d48,#be123c)', chip: '#ffe4e6', chipC: '#9f1239' },
  season_christmas: { hero: 'linear-gradient(145deg,#14532d,#15803d)', price: '#fbbf24', bg: '#052e16', dark: true, badge: 'linear-gradient(135deg,#dc2626,#b91c1c)', chip: 'rgba(220,38,38,.15)', chipC: '#fca5a5' },
  // 행사
  event_bogo:       { hero: 'linear-gradient(145deg,#c2410c,#f97316)', price: '#c2410c', bg: '#fff7ed', badge: 'linear-gradient(135deg,#f97316,#ea580c)', chip: '#ffedd5', chipC: '#9a3412' },
  event_timesale:   { hero: 'linear-gradient(145deg,#0a0a0a,#1f1f1f)', price: '#ef4444', bg: '#0f0f0f', dark: true, badge: 'linear-gradient(135deg,#ef4444,#dc2626)', chip: 'rgba(239,68,68,.12)', chipC: '#f87171' },
  event_membership: { hero: 'linear-gradient(145deg,#581c87,#9333ea)', price: '#7e22ce', bg: '#faf5ff', badge: 'linear-gradient(135deg,#9333ea,#7e22ce)', chip: '#f3e8ff', chipC: '#6b21a8' },
  event_grand_open: { hero: 'linear-gradient(160deg,#0c0a09,#292524)', price: '#fbbf24', bg: '#0c0a09', dark: true, badge: 'linear-gradient(135deg,#fbbf24,#d97706)', chip: 'rgba(251,191,36,.12)', chipC: '#fbbf24' },
  // 마트
  mart_fresh:       { hero: 'linear-gradient(145deg,#15803d,#14532d)', price: '#15803d', bg: '#f0fdf4', badge: 'linear-gradient(135deg,#16a34a,#15803d)', chip: '#dcfce7', chipC: '#166534' },
  mart_clearance:   { hero: 'linear-gradient(145deg,#b91c1c,#ef4444)', price: '#b91c1c', bg: '#fefce8', badge: 'linear-gradient(135deg,#dc2626,#b91c1c)', chip: '#fef9c3', chipC: '#92400e' },
  mart_general:     { hero: 'linear-gradient(145deg,#334155,#64748b)', price: '#dc2626', bg: '#f8fafc', badge: 'linear-gradient(135deg,#475569,#334155)', chip: '#f1f5f9', chipC: '#334155' },
  mart_seafood:     { hero: 'linear-gradient(145deg,#1e3a8a,#2563eb)', price: '#1d4ed8', bg: '#eff6ff', badge: 'linear-gradient(135deg,#2563eb,#1d4ed8)', chip: '#dbeafe', chipC: '#1e40af' },
  // 정육
  butcher_premium:  { hero: 'linear-gradient(160deg,#1c1917,#000)', price: '#d9aa51', bg: '#0c0a09', dark: true, badge: 'linear-gradient(135deg,#d9aa51,#b8860b)', chip: 'rgba(217,170,81,.12)', chipC: '#d9aa51' },
  butcher_hanwoo:   { hero: 'linear-gradient(160deg,#0c0a09,#292524)', price: '#f59e0b', bg: '#1c1917', dark: true, badge: 'linear-gradient(135deg,#f59e0b,#d97706)', chip: 'rgba(245,158,11,.12)', chipC: '#fbbf24' },
  butcher_giftset:  { hero: 'linear-gradient(160deg,#78350f,#b45309)', price: '#92400e', bg: '#fdf2f8', badge: 'linear-gradient(135deg,#d97706,#b45309)', chip: '#fef3c7', chipC: '#78350f' },
};

function FlyerPreviewRenderer({ title, storeName, periodStart, periodEnd, categories, template }: {
  title: string; storeName: string; periodStart: string; periodEnd: string;
  categories: FlyerCategory[]; template: string;
}) {
  const fmtDate = (d: string) => { if (!d) return ''; const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  const fmtPrice = (n: number) => n ? n.toLocaleString() : '';
  const cleanCats = categories.map(c => ({ ...c, items: c.items.filter(i => i.name.trim()) })).filter(c => c.items.length > 0);
  const hasContent = title.trim() || cleanCats.length > 0;
  const period = (periodStart || periodEnd) ? `${fmtDate(periodStart)} ~ ${fmtDate(periodEnd)}` : '';
  const th = PREVIEW_THEMES[template] || PREVIEW_THEMES.grid;
  const engine = ENGINE_MAP[template] || 'grid';

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: th.dark ? '#0a0a0a' : '#f2f2f2' }}>
        <div className="text-center p-4">
          <p style={{ fontSize: 28 }}>📄</p>
          <p style={{ fontSize: 10, color: '#999', marginTop: 8 }}>상품을 입력하면<br />미리보기가 표시됩니다</p>
        </div>
      </div>
    );
  }

  const ImgOrEmoji = ({ item, h, w }: { item: FlyerItem; h: number | string; w?: string }) => {
    const pd = getProductDisplay(item.name);
    const src = item.imageUrl ? `${API_BASE}${item.imageUrl}` : null;
    const emojiBg = th.dark ? 'linear-gradient(135deg,#1a1a2e,#2a2a3e)' : `linear-gradient(135deg,${th.chip},${th.bg})`;
    if (src) return <img src={src} alt="" style={{ width: w || '100%', height: h, objectFit: 'cover', display: 'block' }} />;
    return <div style={{ width: w || '100%', height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: typeof h === 'number' ? h * 0.4 : 28, background: emojiBg }}>{pd.emoji}</div>;
  };

  /** 규격/원산지 칩 */
  const MetaChips = ({ item }: { item: FlyerItem }) => {
    if (!item.unit && !item.origin) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 3 }}>
        {item.unit && <span style={{ fontSize: 6, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: th.chip, color: th.chipC }}>{item.unit}</span>}
        {item.origin && <span style={{ fontSize: 6, fontWeight: 600, padding: '1px 5px', borderRadius: 4, border: `1px solid ${th.chipC}`, color: th.chipC, background: 'transparent' }}>{item.origin}</span>}
      </div>
    );
  };

  /** 카드할인 */
  const CardDiscount = ({ item }: { item: FlyerItem }) => {
    if (!item.cardDiscount) return null;
    return <p style={{ fontSize: 6, fontWeight: 700, color: '#16a34a', marginTop: 2 }}>💳 {item.cardDiscount}</p>;
  };

  // ── 히어로 배너 (공통) ──
  const HeroBanner = ({ align = 'center' }: { align?: 'center' | 'left' }) => (
    <div style={{ background: th.hero, padding: align === 'left' ? '18px 12px 22px' : '22px 10px 30px', textAlign: align, position: 'relative', overflow: 'hidden' }}>
      <p style={{ fontSize: 8, color: 'rgba(255,255,255,.7)', letterSpacing: 3, fontWeight: 700, margin: 0 }}>{storeName || '매장명'}</p>
      <p style={{ fontSize: 18, color: '#fff', fontWeight: 900, margin: '4px 0', lineHeight: 1.15, textShadow: '0 2px 8px rgba(0,0,0,.25)' }}>{title || '행사명'}</p>
      {period && <div style={{ display: 'inline-block', marginTop: 6, background: 'rgba(255,255,255,.12)', borderRadius: 12, padding: '3px 10px', fontSize: 7, fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>{period}</div>}
      {engine === 'grid' && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 12, background: th.bg, borderRadius: '12px 12px 0 0' }} />}
      {engine === 'magazine' && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, background: `linear-gradient(to top,${th.bg},transparent)` }} />}
    </div>
  );

  // ── 카테고리 탭 (공통) ──
  const CatTabs = ({ style: tabStyle }: { style?: 'pill' | 'underline' }) => (
    <div style={{ background: th.dark ? '#141414' : '#fff', borderBottom: tabStyle === 'underline' ? `1px solid ${th.dark ? '#222' : '#e5e7eb'}` : 'none', padding: tabStyle === 'pill' ? '5px 6px' : '0 6px', display: 'flex', overflow: 'auto', gap: tabStyle === 'pill' ? 3 : 0 }}>
      {cleanCats.map((cat, ci) => (
        <span key={ci} style={{
          padding: tabStyle === 'pill' ? '5px 10px' : '7px 9px',
          fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap' as const, flexShrink: 0,
          ...(tabStyle === 'pill'
            ? { color: ci === 0 ? '#fff' : (th.dark ? '#777' : '#9ca3af'), background: ci === 0 ? th.price : 'transparent', borderRadius: 10 }
            : { color: ci === 0 ? th.price : (th.dark ? '#777' : '#9ca3af'), borderBottom: ci === 0 ? `2px solid ${th.price}` : '2px solid transparent' }
          ),
        }}>{cat.name}</span>
      ))}
    </div>
  );

  // ══════════════════════════════════════════
  // ★ 엔진 1: GRID — 2열 카드 그리드
  // ══════════════════════════════════════════
  if (engine === 'grid') return (
    <div style={{ background: th.bg, minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <HeroBanner />
      <CatTabs style="pill" />
      <div style={{ padding: '2px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 7px', padding: '0 2px' }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: th.badge, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 900, flexShrink: 0 }}>{String(ci + 1).padStart(2, '0')}</div>
              <span style={{ fontSize: 11, fontWeight: 800, color: th.dark ? '#eee' : '#1a1a1a' }}>{cat.name}</span>
              <span style={{ fontSize: 7, color: th.dark ? '#555' : '#9ca3af', fontWeight: 600, marginLeft: 'auto' }}>{cat.items.length}개</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {cat.items.map((item, ii) => {
                const discount = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                return (
                  <div key={ii} style={{ background: th.dark ? '#141414' : '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.08)', position: 'relative', border: th.dark ? '1px solid #222' : 'none' }}>
                    {discount > 0 && <span style={{ position: 'absolute', top: 5, left: 5, background: th.badge, color: '#fff', fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 5, zIndex: 1 }}>{discount}%</span>}
                    <ImgOrEmoji item={item} h={70} />
                    <div style={{ padding: '6px 7px 8px' }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: th.dark ? '#eee' : '#1a1a1a', margin: 0, lineHeight: 1.3 }}>{item.name}</p>
                      <MetaChips item={item} />
                      {item.originalPrice > 0 && item.originalPrice > item.salePrice && <p style={{ fontSize: 7, color: th.dark ? '#555' : '#9ca3af', textDecoration: 'line-through', margin: '1px 0 0' }}>{fmtPrice(item.originalPrice)}원</p>}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, marginTop: 1 }}>
                        <span style={{ fontSize: 16, fontWeight: 900, color: th.price, letterSpacing: -0.5 }}>{fmtPrice(item.salePrice)}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: th.price, opacity: 0.7 }}>원</span>
                      </div>
                      <CardDiscount item={item} />
                      {item.badge && <span style={{ fontSize: 6, fontWeight: 700, padding: '1px 5px', borderRadius: 4, display: 'inline-block', marginTop: 3, background: th.chip, color: th.chipC, border: `1px solid ${th.chipC}22` }}>{item.badge}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ══════════════════════════════════════════
  // ★ 엔진 2: MAGAZINE — 1열 매거진형 (좌: 텍스트+가격, 우: 대형이미지)
  // ══════════════════════════════════════════
  if (engine === 'magazine') return (
    <div style={{ background: th.bg, minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <HeroBanner align="left" />
      <CatTabs style="underline" />
      <div style={{ padding: '0 7px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '14px 0 8px' }}>
              <div style={{ width: 3, height: 16, borderRadius: 1, background: th.badge, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 900, color: th.dark ? '#eee' : '#1c1917' }}>{cat.name}</span>
            </div>
            {cat.items.map((item, ii) => {
              const discount = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
              const imgRight = ii % 2 === 0;
              return (
                <div key={ii} style={{ display: 'flex', flexDirection: imgRight ? 'row' : 'row-reverse', background: th.dark ? '#1c1917' : '#fff', borderRadius: 10, overflow: 'hidden', marginBottom: 7, boxShadow: '0 1px 4px rgba(0,0,0,.06)', border: th.dark ? '1px solid #292524' : 'none', minHeight: 88 }}>
                  <div style={{ flex: 1, padding: '8px 9px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {discount > 0 && <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, marginBottom: 2 }}><span style={{ fontSize: 18, fontWeight: 900, color: th.price, lineHeight: 1 }}>{discount}</span><span style={{ fontSize: 7, fontWeight: 800, color: th.price }}>% OFF</span></div>}
                    <p style={{ fontSize: 10, fontWeight: 800, color: th.dark ? '#eee' : '#1c1917', margin: 0, lineHeight: 1.3 }}>{item.name}</p>
                    <MetaChips item={item} />
                    {item.originalPrice > 0 && item.originalPrice > item.salePrice && <p style={{ fontSize: 7, color: th.dark ? '#666' : '#a8a29e', textDecoration: 'line-through', margin: '3px 0 0' }}>{fmtPrice(item.originalPrice)}원</p>}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, marginTop: 1 }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: th.price, letterSpacing: -1 }}>{fmtPrice(item.salePrice)}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: th.price, opacity: 0.7 }}>원</span>
                    </div>
                    <CardDiscount item={item} />
                    {item.badge && <span style={{ display: 'inline-block', fontSize: 6, fontWeight: 700, padding: '1px 5px', borderRadius: 4, marginTop: 3, background: th.chip, color: th.chipC }}>{item.badge}</span>}
                  </div>
                  <div style={{ width: '42%', flexShrink: 0, overflow: 'hidden' }}><ImgOrEmoji item={item} h="100%" /></div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  // ══════════════════════════════════════════
  // ★ 엔진 3: EDITORIAL — 풀블리드 이미지 + 오버레이
  // ══════════════════════════════════════════
  if (engine === 'editorial') return (
    <div style={{ background: th.bg, minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <HeroBanner align="left" />
      <CatTabs style="underline" />
      <div style={{ padding: '0 0 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 8px 8px' }}>
              <span style={{ fontSize: 8, fontWeight: 800, color: th.price }}>{String(ci + 1).padStart(2, '0')}</span>
              <span style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>{cat.name}</span>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb', marginLeft: 4 }} />
            </div>
            {cat.items.map((item, ii) => {
              const discount = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
              // 첫 상품 = 풀블리드 대형
              if (ii === 0) return (
                <div key={ii} style={{ position: 'relative', overflow: 'hidden', margin: '0 0 6px' }}>
                  <ImgOrEmoji item={item} h={140} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 10px 10px', background: 'linear-gradient(to top,rgba(0,0,0,.8),rgba(0,0,0,.3),transparent)' }}>
                    {discount > 0 && <span style={{ display: 'inline-block', background: th.badge, color: '#fff', fontSize: 7, fontWeight: 800, padding: '2px 7px', borderRadius: 4, marginBottom: 4 }}>{discount}% OFF</span>}
                    <p style={{ fontSize: 11, fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.3 }}>{item.name}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 2 }}>
                      {item.unit && <span style={{ fontSize: 6, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: 'rgba(255,255,255,.15)', color: '#fff' }}>{item.unit}</span>}
                      {item.origin && <span style={{ fontSize: 6, fontWeight: 600, padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(255,255,255,.3)', color: '#fff' }}>{item.origin}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, marginTop: 2 }}>
                      <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: -1 }}>{fmtPrice(item.salePrice)}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.7)' }}>원</span>
                    </div>
                  </div>
                </div>
              );
              // 나머지 = 일반 카드
              return (
                <div key={ii} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', margin: '0 7px 6px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                  <div style={{ position: 'relative', width: '100%', height: 80, overflow: 'hidden' }}>
                    {discount > 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: th.badge, color: '#fff', fontSize: 7, fontWeight: 800, padding: '2px 6px', borderRadius: 4, zIndex: 1 }}>{discount}%</span>}
                    <ImgOrEmoji item={item} h={80} />
                  </div>
                  <div style={{ padding: '6px 8px 8px' }}>
                    <p style={{ fontSize: 9, fontWeight: 800, color: '#111', margin: 0 }}>{item.name}</p>
                    <MetaChips item={item} />
                    {item.originalPrice > 0 && item.originalPrice > item.salePrice && <p style={{ fontSize: 7, color: '#9ca3af', textDecoration: 'line-through', margin: '2px 0 0' }}>{fmtPrice(item.originalPrice)}원</p>}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, marginTop: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: th.price, letterSpacing: -0.5 }}>{fmtPrice(item.salePrice)}</span>
                      <span style={{ fontSize: 7, fontWeight: 700, color: th.price, opacity: 0.7 }}>원</span>
                    </div>
                    <CardDiscount item={item} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  // ══════════════════════════════════════════
  // ★ 엔진 4: SHOWCASE — 대형 싱글 카드
  // ══════════════════════════════════════════
  // 공통 헬퍼 (unused by new engines but kept for compatibility)

  // (engine === 'showcase' — below)

  // ══════════════════════════════════════════
  // ★ SHOWCASE ENGINE (폴백 포함 — 나머지 전부)
  // ══════════════════════════════════════════
  return (
    <div style={{ background: th.bg, minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <HeroBanner />
      <CatTabs style="pill" />
      <div style={{ padding: '4px 7px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 8px' }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: th.badge, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>{(cat.name || '').charAt(0)}</div>
              <span style={{ fontSize: 11, fontWeight: 900, color: th.dark ? '#eee' : '#18181b' }}>{cat.name}</span>
              <span style={{ fontSize: 7, color: th.dark ? '#555' : '#a1a1aa', fontWeight: 600, marginLeft: 'auto' }}>{cat.items.length}개</span>
            </div>
            {cat.items.map((item, ii) => {
              const discount = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
              const saving = item.originalPrice > 0 ? item.originalPrice - item.salePrice : 0;
              return (
                <div key={ii} style={{ background: th.dark ? '#141414' : '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)', border: th.dark ? '1px solid #222' : 'none' }}>
                  <div style={{ position: 'relative', width: '100%', height: 110, overflow: 'hidden' }}>
                    <ImgOrEmoji item={item} h={110} />
                    {discount > 0 && <div style={{ position: 'absolute', top: 6, right: 6, width: 34, height: 34, borderRadius: '50%', background: th.badge, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13, fontWeight: 900, color: th.dark ? '#000' : '#fff', lineHeight: 1 }}>{discount}</span>
                      <span style={{ fontSize: 5, fontWeight: 800, color: th.dark ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.8)', lineHeight: 1 }}>%할인</span>
                    </div>}
                  </div>
                  <div style={{ padding: '8px 9px 10px' }}>
                    <p style={{ fontSize: 11, fontWeight: 800, color: th.dark ? '#eee' : '#18181b', margin: 0, lineHeight: 1.35 }}>{item.name}</p>
                    <MetaChips item={item} />
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 }}>
                      <div>
                        {item.originalPrice > 0 && item.originalPrice > item.salePrice && <p style={{ fontSize: 7, color: th.dark ? '#555' : '#a1a1aa', textDecoration: 'line-through', margin: '0 0 1px' }}>{fmtPrice(item.originalPrice)}원</p>}
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                          <span style={{ fontSize: 20, fontWeight: 900, color: th.price, letterSpacing: -1 }}>{fmtPrice(item.salePrice)}</span>
                          <span style={{ fontSize: 8, fontWeight: 700, color: th.price, opacity: 0.7 }}>원</span>
                        </div>
                      </div>
                      {saving > 0 && <span style={{ fontSize: 7, fontWeight: 700, color: '#16a34a', background: th.dark ? 'rgba(74,222,128,.1)' : '#f0fdf4', padding: '2px 6px', borderRadius: 5, border: th.dark ? '1px solid rgba(74,222,128,.15)' : '1px solid #bbf7d0' }}>↓{fmtPrice(saving)}원 절약</span>}
                    </div>
                    <CardDiscount item={item} />
                    {item.badge && <span style={{ display: 'inline-block', fontSize: 6, fontWeight: 700, padding: '1px 5px', borderRadius: 4, marginTop: 3, background: th.chip, color: th.chipC }}>{item.badge}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
// ═══ END FlyerPreviewRenderer ═══
// (orphaned old code removed — V3 engine handles all templates via ENGINE_MAP)

// ═══ (V3: old per-template blocks removed — all templates route through 4 engines above) ═══
