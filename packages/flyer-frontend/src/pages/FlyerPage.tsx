import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, Button, Input, Badge, EmptyState, ConfirmModal, Toast } from '../components/ui';
import { getProductDisplay } from '../utils/product-images';

interface FlyerItem { name: string; originalPrice: number; salePrice: number; badge?: string; imageUrl?: string; }
interface FlyerCategory { name: string; items: FlyerItem[]; }
interface Flyer { id: string; title: string; store_name: string; period_start: string | null; period_end: string | null; categories: FlyerCategory[]; template: string; status: string; short_code: string | null; click_count: number; created_at: string; }

// D113: 하드코딩 폴백용 (API 실패 시)
const DEFAULT_CATEGORY_PRESETS = ['청과/야채', '공산', '축산', '수산', '냉동', '유제품', '음료/주류', '생활용품'];
const DEFAULT_TEMPLATES: TemplateOption[] = [
  { value: 'grid', label: '가격 강조형', desc: '빨간 테마, 2열 카드', color: 'linear-gradient(to right, #ef4444, #f97316)' },
  { value: 'list', label: '리스트형', desc: '딥블루, 깔끔 모던', color: 'linear-gradient(to right, #1d4ed8, #3b82f6)' },
  { value: 'highlight', label: '특가 하이라이트', desc: '다크 모드, TOP PICK', color: 'linear-gradient(to right, #1f2937, #d97706)' },
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
      const body = { title: title.trim(), store_name: storeName.trim(), period_start: periodStart || null, period_end: periodEnd || null, categories: clean, template };
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
function ProductRegistrationSection({ categories, setCategories, addCategory, removeCategory, updateCategoryName, addItem, removeItem, updateItem, setAlert, categoryPresets }: {
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
    reader.onload = (ev) => {
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
        const totalItems = newCategories.reduce((sum, c) => sum + c.items.length, 0);
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
                <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-text-muted uppercase tracking-wider px-1">
                  <div className="col-span-5">상품명</div><div className="col-span-2">원가</div><div className="col-span-2">할인가</div><div className="col-span-2">뱃지</div><div className="col-span-1"></div>
                </div>
                {categories[safeTab].items.map((item, ii) => (
                  <div key={ii} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5 flex items-center gap-2">
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
                    <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(safeTab, ii, 'originalPrice', Number(e.target.value))} placeholder="원가"
                      className="col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    <input type="number" value={item.salePrice || ''} onChange={e => updateItem(safeTab, ii, 'salePrice', Number(e.target.value))} placeholder="할인가"
                      className="col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    <input type="text" value={item.badge || ''} onChange={e => updateItem(safeTab, ii, 'badge', e.target.value)} placeholder="뱃지"
                      className="col-span-2 px-2.5 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-surface" />
                    <button onClick={() => removeItem(safeTab, ii)} className="col-span-1 text-error-500/60 hover:text-error-500 text-center transition-colors">✕</button>
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

// 프론트 자체 렌더링 미리보기 (미발행 전단지용) — 공개 페이지(short-urls.ts)와 동일 디자인
function FlyerPreviewRenderer({ title, storeName, periodStart, periodEnd, categories, template }: {
  title: string; storeName: string; periodStart: string; periodEnd: string;
  categories: FlyerCategory[]; template: string;
}) {
  const fmtDate = (d: string) => { if (!d) return ''; const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  const fmtPrice = (n: number) => n ? n.toLocaleString() : '';
  const cleanCats = categories.map(c => ({ ...c, items: c.items.filter(i => i.name.trim()) })).filter(c => c.items.length > 0);
  const hasContent = title.trim() || cleanCats.length > 0;
  const period = (periodStart || periodEnd) ? `${fmtDate(periodStart)} ~ ${fmtDate(periodEnd)}` : '';

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: template === 'highlight' ? '#0f0f0f' : '#f2f2f2' }}>
        <div className="text-center p-4">
          <p style={{ fontSize: 28 }}>📄</p>
          <p style={{ fontSize: 10, color: '#999', marginTop: 8 }}>상품을 입력하면<br />미리보기가 표시됩니다</p>
        </div>
      </div>
    );
  }

  const ImgOrEmoji = ({ item, h }: { item: FlyerItem; h: number }) => {
    const pd = getProductDisplay(item.name);
    const src = item.imageUrl ? `${API_BASE}${item.imageUrl}` : null;
    if (src) return <img src={src} alt="" style={{ width: '100%', height: h, objectFit: 'cover' }} />;
    const emojiBg = template === 'grid' ? 'linear-gradient(135deg,#fff5f5,#fef2f2)' : template === 'list' ? 'linear-gradient(135deg,#eff6ff,#dbeafe)' : 'linear-gradient(135deg,#1a1a2e,#2a2a3e)';
    return <div style={{ width: '100%', height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: h * 0.4, background: emojiBg }}>{pd.emoji}</div>;
  };

  // ── 그리드형 (빨간 테마) ──
  if (template === 'grid') return (
    <div style={{ background: '#f2f2f2', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)', padding: '16px 10px 20px', textAlign: 'center', borderRadius: '0 0 50% 50% / 0 0 15px 15px' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,.8)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 13, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        {period && <p style={{ fontSize: 7, color: 'rgba(255,255,255,.7)', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0 5px' }}>
              <span style={{ width: 3, height: 12, background: 'linear-gradient(180deg,#dc2626,#f97316)', borderRadius: 2 }} />
              <span style={{ fontSize: 9, fontWeight: 800, color: '#b91c1c' }}>{cat.name}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {cat.items.map((item, ii) => {
                const discount = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                return (
                  <div key={ii} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.06)', position: 'relative' }}>
                    {discount > 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: 'linear-gradient(135deg,#dc2626,#ea580c)', color: '#fff', fontSize: 7, fontWeight: 800, padding: '1px 5px', borderRadius: 5, zIndex: 1 }}>{discount}%</span>}
                    <ImgOrEmoji item={item} h={60} />
                    <div style={{ padding: '5px 6px 7px' }}>
                      <p style={{ fontSize: 8, fontWeight: 700, color: '#222', margin: 0, lineHeight: 1.3 }}>{item.name}</p>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                        {item.originalPrice > 0 && <span style={{ fontSize: 7, color: '#aaa', textDecoration: 'line-through' }}>{fmtPrice(item.originalPrice)}</span>}
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#dc2626' }}>₩{fmtPrice(item.salePrice)}</span>
                      </div>
                      {item.badge && <span style={{ fontSize: 6, color: '#dc2626', fontWeight: 700, background: '#fef2f2', padding: '1px 4px', borderRadius: 3, display: 'inline-block', marginTop: 2, border: '1px solid #fecaca' }}>{item.badge}</span>}
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

  // ── 리스트형 (밝은 톤 + 딥블루) ──
  if (template === 'list') return (
    <div style={{ background: '#f8f9fa', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#1e40af,#2563eb)', padding: '16px 10px 14px', textAlign: 'center', borderBottom: '3px solid #60a5fa' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,.75)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 13, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        {period && <p style={{ fontSize: 7, color: 'rgba(255,255,255,.65)', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <span style={{ display: 'inline-block', fontSize: 8, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', padding: '3px 8px', borderRadius: 10, margin: '8px 0 5px' }}>{cat.name}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {cat.items.map((item, ii) => {
                const discount = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                return (
                  <div key={ii} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', borderRadius: 8, padding: 5, boxShadow: '0 1px 3px rgba(0,0,0,.04)', position: 'relative' }}>
                    <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 7, overflow: 'hidden' }}><ImgOrEmoji item={item} h={42} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>{item.name}</p>
                      {item.badge && <span style={{ fontSize: 6, color: '#2563eb', background: '#eff6ff', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>{item.badge}</span>}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 1 }}>
                        {item.originalPrice > 0 && <span style={{ fontSize: 7, color: '#aaa', textDecoration: 'line-through' }}>{fmtPrice(item.originalPrice)}</span>}
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#1e40af' }}>₩{fmtPrice(item.salePrice)}</span>
                      </div>
                    </div>
                    {discount > 0 && <span style={{ position: 'absolute', top: 4, right: 4, background: '#ef4444', color: '#fff', fontSize: 7, fontWeight: 800, padding: '1px 4px', borderRadius: 4 }}>{discount}%</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 공통 헬퍼 ──
  const allItems: (FlyerItem & { discount: number })[] = [];
  for (const cat of cleanCats) for (const item of cat.items) {
    if (item.originalPrice > 0) allItems.push({ ...item, discount: Math.round((1 - item.salePrice / item.originalPrice) * 100) });
  }
  allItems.sort((a, b) => b.discount - a.discount);
  const picks = allItems.slice(0, 4);
  const maxDiscount = allItems.length > 0 ? allItems[0].discount : 0;
  const featured = allItems[0] || null;

  // ── 하이라이트형 (프리미엄 다크 + 골드) ──
  if (template === 'highlight') return (
    <div style={{ background: '#0f0f0f', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(180deg,#1a1a2e,#0f0f0f)', padding: '18px 10px 14px', textAlign: 'center', borderBottom: '2px solid #d4a844' }}>
        <p style={{ fontSize: 7, color: '#d4a844', letterSpacing: 3, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 14, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        {period && <p style={{ fontSize: 7, color: '#888', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {picks.length > 0 && <>
          <p style={{ textAlign: 'center', fontSize: 8, fontWeight: 800, color: '#d4a844', letterSpacing: 3, margin: '10px 0 6px' }}>TOP PICK</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
            {picks.map((p, i) => (
              <div key={i} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                <ImgOrEmoji item={p} h={70} />
                <span style={{ position: 'absolute', top: 4, left: 4, background: 'linear-gradient(135deg,#d4a844,#b8860b)', color: '#000', fontSize: 6, fontWeight: 800, padding: '2px 5px', borderRadius: 4 }}>{p.discount}% OFF</span>
                <div style={{ padding: '5px 6px 7px' }}>
                  <p style={{ fontSize: 8, fontWeight: 700, color: '#fff', margin: 0 }}>{p.name}</p>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                    <span style={{ fontSize: 7, color: '#666', textDecoration: 'line-through' }}>{fmtPrice(p.originalPrice)}</span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#d4a844' }}>₩{fmtPrice(p.salePrice)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>}
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 8, fontWeight: 700, color: '#d4a844', borderBottom: '1px solid #222', padding: '6px 0 4px', margin: '4px 0', letterSpacing: 1 }}>{cat.name}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {cat.items.map((item, ii) => (
                <div key={ii} style={{ background: '#1a1a1a', borderRadius: 7, overflow: 'hidden', border: '1px solid #222' }}>
                  <ImgOrEmoji item={item} h={45} />
                  <div style={{ padding: '4px 5px 6px' }}>
                    <p style={{ fontSize: 7, fontWeight: 600, color: '#ddd', margin: 0 }}>{item.name}</p>
                    <p style={{ fontSize: 10, fontWeight: 900, color: '#d4a844', margin: '1px 0 0' }}>₩{fmtPrice(item.salePrice)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 신선식품 특화 (녹색 테마) ──
  if (template === 'mart_fresh') return (
    <div style={{ background: '#f0fdf4', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', padding: '16px 10px 20px', textAlign: 'center', borderRadius: '0 0 50% 50% / 0 0 12px 12px' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,.8)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 13, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        {period && <p style={{ fontSize: 7, color: 'rgba(255,255,255,.7)', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: '#15803d', margin: '8px 0 5px', paddingBottom: 4, borderBottom: '2px solid #bbf7d0' }}>🌿 {cat.name}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {cat.items.map((item, ii) => {
                const disc = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                return (
                  <div key={ii} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #dcfce7', position: 'relative' }}>
                    {disc > 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#16a34a', color: '#fff', fontSize: 7, fontWeight: 800, padding: '1px 5px', borderRadius: 5, zIndex: 1 }}>-{disc}%</span>}
                    <ImgOrEmoji item={item} h={55} />
                    <div style={{ padding: '5px 6px 7px' }}>
                      <p style={{ fontSize: 8, fontWeight: 700, margin: 0 }}>{item.name}</p>
                      <span style={{ fontSize: 11, fontWeight: 900, color: '#16a34a' }}>{fmtPrice(item.salePrice)}원</span>
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

  // ── 주말특가 (보라+핑크, 대표 상품 배너) ──
  if (template === 'mart_weekend') return (
    <div style={{ background: '#fdf4ff', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#9333ea,#ec4899)', padding: '16px 10px 14px', textAlign: 'center' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,.85)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 14, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        {period && <p style={{ fontSize: 7, color: 'rgba(255,255,255,.7)', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '8px 6px 12px' }}>
        {featured && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 10, textAlign: 'center', boxShadow: '0 4px 12px rgba(147,51,234,.12)', marginBottom: 10, border: '2px solid #e9d5ff' }}>
            <span style={{ display: 'inline-block', background: 'linear-gradient(135deg,#9333ea,#ec4899)', color: '#fff', fontSize: 8, fontWeight: 800, padding: '3px 10px', borderRadius: 10, marginBottom: 6 }}>BEST DEAL -{featured.discount}%</span>
            <ImgOrEmoji item={featured} h={80} />
            <p style={{ fontSize: 10, fontWeight: 800, margin: '6px 0 2px' }}>{featured.name}</p>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#9333ea' }}>₩{fmtPrice(featured.salePrice)}</span>
          </div>
        )}
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <span style={{ display: 'inline-block', fontSize: 8, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#a855f7,#ec4899)', padding: '3px 8px', borderRadius: 10, margin: '6px 0 5px' }}>{cat.name}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {cat.items.map((item, ii) => (
                <div key={ii} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                  <ImgOrEmoji item={item} h={50} />
                  <div style={{ padding: '4px 6px 6px' }}>
                    <p style={{ fontSize: 7, fontWeight: 700, margin: 0 }}>{item.name}</p>
                    <span style={{ fontSize: 10, fontWeight: 900, color: '#9333ea' }}>₩{fmtPrice(item.salePrice)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 시즌 행사 (파랑+시안) ──
  if (template === 'mart_seasonal') return (
    <div style={{ background: '#f0f9ff', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#2563eb,#0891b2)', padding: '18px 10px 16px', textAlign: 'center' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,.8)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 14, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        {period && <span style={{ display: 'inline-block', fontSize: 8, fontWeight: 600, color: '#fff', background: 'rgba(255,255,255,.15)', padding: '3px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,.3)', marginTop: 4 }}>{period}</span>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: '#1e40af', margin: '8px 0 5px', display: 'flex', alignItems: 'center', gap: 4 }}>🎁 {cat.name}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {cat.items.map((item, ii) => {
                const disc = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                return (
                  <div key={ii} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0f2fe' }}>
                    <ImgOrEmoji item={item} h={55} />
                    <div style={{ padding: '5px 6px 7px' }}>
                      <p style={{ fontSize: 8, fontWeight: 700, margin: 0 }}>{item.name}</p>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                        {item.originalPrice > 0 && <span style={{ fontSize: 7, color: '#aaa', textDecoration: 'line-through' }}>{fmtPrice(item.originalPrice)}</span>}
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#2563eb' }}>{fmtPrice(item.salePrice)}원</span>
                      </div>
                      {disc > 0 && <span style={{ display: 'inline-block', fontSize: 6, fontWeight: 700, color: '#fff', background: '#0891b2', padding: '1px 5px', borderRadius: 6, marginTop: 2 }}>↓{disc}%</span>}
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

  // ── 창고대방출 (노랑+빨강, 가격 최우선) ──
  if (template === 'mart_clearance') return (
    <div style={{ background: '#fffbeb', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#eab308,#dc2626)', padding: '14px 10px 12px', textAlign: 'center' }}>
        <p style={{ fontSize: 7, color: '#fff', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 15, color: '#fff', fontWeight: 900, margin: '3px 0', textShadow: '0 2px 4px rgba(0,0,0,.2)' }}>{title || '행사명'}</p>
        {maxDiscount > 0 && <span style={{ display: 'inline-block', background: '#fff', color: '#dc2626', fontSize: 9, fontWeight: 900, padding: '3px 12px', borderRadius: 12, margin: '4px 0' }}>최대 {maxDiscount}% 할인</span>}
        {period && <p style={{ fontSize: 7, color: 'rgba(255,255,255,.85)', margin: '3px 0 0' }}>{period}</p>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 9, fontWeight: 900, color: '#92400e', background: 'repeating-linear-gradient(45deg,#fef3c7,#fef3c7 8px,#fde68a 8px,#fde68a 16px)', padding: '5px 8px', borderRadius: 5, textAlign: 'center', margin: '8px 0 5px' }}>{cat.name}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {cat.items.map((item, ii) => {
                const disc = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                return (
                  <div key={ii} style={{ background: '#fff', borderRadius: 8, padding: '8px 6px', textAlign: 'center', border: '2px solid #fde68a' }}>
                    {disc > 0 && <p style={{ fontSize: 20, fontWeight: 900, color: '#dc2626', margin: 0, lineHeight: 1 }}>{disc}%<span style={{ fontSize: 9 }}>OFF</span></p>}
                    <p style={{ fontSize: 12, fontWeight: 900, color: '#b91c1c', margin: '2px 0' }}>₩{fmtPrice(item.salePrice)}</p>
                    {item.originalPrice > 0 && <p style={{ fontSize: 7, color: '#aaa', textDecoration: 'line-through', margin: 0 }}>₩{fmtPrice(item.originalPrice)}</p>}
                    <p style={{ fontSize: 8, fontWeight: 700, color: '#333', margin: '3px 0 0' }}>{item.name}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 프리미엄 정육 (다크+골드, 단일 컬럼) ──
  if (template === 'butcher_premium') return (
    <div style={{ background: '#0a0a0a', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(180deg,#1a1a1a,#0a0a0a)', padding: '20px 10px 16px', textAlign: 'center', borderBottom: '3px solid #c9a84c' }}>
        <p style={{ fontSize: 7, color: '#c9a84c', letterSpacing: 4, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 16, color: '#fff', fontWeight: 900, margin: '6px 0' }}>{title || '행사명'}</p>
        {period && <p style={{ fontSize: 7, color: '#666', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '8px 8px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: '#c9a84c', textAlign: 'center', letterSpacing: 2, margin: '12px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ flex: 1, maxWidth: 40, height: 1, background: 'linear-gradient(90deg,transparent,#c9a84c)' }} />
              {cat.name}
              <span style={{ flex: 1, maxWidth: 40, height: 1, background: 'linear-gradient(90deg,#c9a84c,transparent)' }} />
            </p>
            {cat.items.map((item, ii) => {
              const disc = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
              return (
                <div key={ii} style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', marginBottom: 6 }}>
                  <ImgOrEmoji item={item} h={90} />
                  <div style={{ padding: '8px 10px 10px' }}>
                    <p style={{ fontSize: 11, fontWeight: 800, color: '#fff', margin: 0 }}>{item.name}</p>
                    {item.badge && <span style={{ display: 'inline-block', fontSize: 7, fontWeight: 700, color: '#c9a84c', border: '1px solid #c9a84c', padding: '1px 6px', borderRadius: 3, margin: '4px 0' }}>{item.badge}</span>}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
                      {item.originalPrice > 0 && <span style={{ fontSize: 8, color: '#555', textDecoration: 'line-through' }}>₩{fmtPrice(item.originalPrice)}</span>}
                      <span style={{ fontSize: 15, fontWeight: 900, color: '#c9a84c' }}>₩{fmtPrice(item.salePrice)}</span>
                    </div>
                    {disc > 0 && <span style={{ display: 'inline-block', fontSize: 7, fontWeight: 700, background: '#c9a84c', color: '#000', padding: '2px 6px', borderRadius: 4, marginTop: 4 }}>-{disc}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  // ── 오늘의 고기 (빨강, 일일특가, Top 3) ──
  if (template === 'butcher_daily') {
    const top3 = allItems.slice(0, 3);
    return (
      <div style={{ background: '#fff1f2', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: 'linear-gradient(135deg,#dc2626,#e11d48)', padding: '16px 10px 14px', textAlign: 'center' }}>
          <p style={{ fontSize: 8, color: 'rgba(255,255,255,.85)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
          <p style={{ fontSize: 14, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
          <span style={{ display: 'inline-block', background: '#fff', color: '#dc2626', fontSize: 8, fontWeight: 800, padding: '3px 10px', borderRadius: 10, marginTop: 4 }}>오늘만 이 가격!</span>
        </div>
        <div style={{ padding: '8px 6px 12px' }}>
          {top3.length > 0 && (
            <>
              <p style={{ fontSize: 10, fontWeight: 900, color: '#dc2626', textAlign: 'center', margin: '6px 0 6px' }}>🥩 오늘의 추천</p>
              {top3.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', borderRadius: 10, padding: 6, marginBottom: 5, borderLeft: '3px solid #dc2626', position: 'relative' }}>
                  <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}><ImgOrEmoji item={item} h={44} /></div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 9, fontWeight: 800, margin: 0 }}>{item.name}</p>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#dc2626' }}>₩{fmtPrice(item.salePrice)}</span>
                  </div>
                  {item.discount > 0 && <span style={{ position: 'absolute', top: 4, right: 4, background: '#dc2626', color: '#fff', fontSize: 7, fontWeight: 800, padding: '1px 5px', borderRadius: 5 }}>{item.discount}%</span>}
                </div>
              ))}
            </>
          )}
          {cleanCats.map((cat, ci) => (
            <div key={ci} style={{ marginBottom: 6 }}>
              <p style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: 'linear-gradient(90deg,#dc2626,#e11d48)', padding: '5px 8px', borderRadius: 6, textAlign: 'center', margin: '8px 0 5px' }}>{cat.name}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {cat.items.map((item, ii) => (
                  <div key={ii} style={{ background: '#fff', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                    <p style={{ fontSize: 8, fontWeight: 700, margin: 0 }}>{item.name}</p>
                    <p style={{ fontSize: 11, fontWeight: 900, color: '#dc2626', margin: '2px 0 0' }}>₩{fmtPrice(item.salePrice)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── 대용량 팩 (네이비, 절약액 강조) ──
  if (template === 'butcher_bulk') return (
    <div style={{ background: '#eef2ff', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#1e3a8a,#3730a3)', padding: '16px 10px 20px', textAlign: 'center', borderRadius: '0 0 50% 50% / 0 0 12px 12px' }}>
        <p style={{ fontSize: 8, color: 'rgba(255,255,255,.8)', letterSpacing: 2, margin: 0 }}>{storeName || '매장명'}</p>
        <p style={{ fontSize: 13, color: '#fff', fontWeight: 900, margin: '4px 0' }}>{title || '행사명'}</p>
        <p style={{ fontSize: 9, fontWeight: 700, color: '#a5b4fc', margin: '3px 0' }}>대용량 특가 — 많이 살수록 이득!</p>
        {period && <p style={{ fontSize: 7, color: 'rgba(255,255,255,.6)', margin: 0 }}>{period}</p>}
      </div>
      <div style={{ padding: '6px 6px 12px' }}>
        {cleanCats.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: '#1e3a8a', margin: '8px 0 5px', display: 'flex', alignItems: 'center', gap: 4 }}>📦 {cat.name}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {cat.items.map((item, ii) => {
                const disc = item.originalPrice > 0 ? Math.round((1 - item.salePrice / item.originalPrice) * 100) : 0;
                const saving = item.originalPrice > 0 ? item.originalPrice - item.salePrice : 0;
                return (
                  <div key={ii} style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #c7d2fe', textAlign: 'center' }}>
                    <ImgOrEmoji item={item} h={50} />
                    <div style={{ padding: '5px 6px 7px' }}>
                      <p style={{ fontSize: 8, fontWeight: 800, margin: 0 }}>{item.name}</p>
                      {item.badge && <span style={{ display: 'inline-block', fontSize: 7, fontWeight: 600, color: '#6366f1', background: '#eef2ff', padding: '1px 5px', borderRadius: 4, margin: '2px 0' }}>{item.badge}</span>}
                      <p style={{ fontSize: 12, fontWeight: 900, color: '#1e3a8a', margin: '2px 0 0' }}>₩{fmtPrice(item.salePrice)}</p>
                      {saving > 0 && <p style={{ fontSize: 7, fontWeight: 700, color: '#16a34a', margin: '1px 0 0' }}>₩{fmtPrice(saving)} 절약</p>}
                      {disc > 0 && <span style={{ display: 'inline-block', fontSize: 6, fontWeight: 800, color: '#fff', background: '#4338ca', padding: '1px 5px', borderRadius: 4, marginTop: 2 }}>{disc}% OFF</span>}
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

  // ── 폴백: 그리드형 스타일 ──
  return (
    <div style={{ background: '#f2f2f2', minHeight: '100%', fontFamily: 'system-ui, sans-serif', padding: 10 }}>
      <p style={{ fontSize: 10, color: '#999', textAlign: 'center', marginTop: 30 }}>템플릿 미리보기 준비 중...</p>
    </div>
  );
}
