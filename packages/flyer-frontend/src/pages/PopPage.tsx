/**
 * ★ POP 제작 페이지 V2 — 독립 제작 도구 (전단제작 수준 UX)
 *
 * 좌측: 전단 목록 (클릭하면 상품 로드) + 직접 입력 모드
 * 중앙: 상품 편집 (이미지 업로드/검색, 가격, 뱃지 등)
 * 우측: POP 설정 (분할/색상/방향) + 다운로드
 */

import { useState, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { Button, EmptyState } from '../components/ui';
import AlertModal from '../components/AlertModal';
import ExcelUploadModal, { type MappedProduct } from '../components/ExcelUploadModal';

interface PopItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
  unit?: string;
  origin?: string;
  cardDiscount?: string;
  imageUrl?: string;
  selected: boolean;
}

interface Flyer {
  id: string;
  title: string;
  store_name: string;
  categories: any;
  status: string;
  created_at: string;
}

type SplitOption = 1 | 2 | 4 | 8 | 16 | 21 | 35;
type ColorTheme = 'red' | 'yellow' | 'green' | 'blue' | 'black';
type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'price_card';

const SPLIT_OPTIONS: { value: SplitOption; label: string }[] = [
  { value: 1, label: '1장' },
  { value: 2, label: '2분할' },
  { value: 4, label: '4분할' },
  { value: 8, label: '8분할' },
  { value: 16, label: '16분할' },
  { value: 21, label: '21분할' },
  { value: 35, label: '35분할' },
];

const PAPER_OPTIONS: { value: PaperSize; label: string; desc: string }[] = [
  { value: 'price_card', label: '프라이스카드', desc: '90×55mm' },
  { value: 'A4', label: 'A4', desc: '210×297mm' },
  { value: 'A3', label: 'A3', desc: '297×420mm' },
  { value: 'A2', label: 'A2', desc: '420×594mm' },
  { value: 'A1', label: 'A1', desc: '594×841mm' },
  { value: 'A0', label: 'A0', desc: '841×1189mm' },
];

const COLOR_OPTIONS: { value: ColorTheme; label: string; color: string }[] = [
  { value: 'red', label: '빨강', color: '#dc2626' },
  { value: 'yellow', label: '노랑', color: '#f59e0b' },
  { value: 'green', label: '초록', color: '#16a34a' },
  { value: 'blue', label: '파랑', color: '#1d4ed8' },
  { value: 'black', label: '블랙', color: '#1a1a1a' },
];

const jsonHeaders = { 'Content-Type': 'application/json' };

export default function PopPage({ token: _token }: { token: string }) {
  const [items, setItems] = useState<PopItem[]>([]);
  const [storeName, setStoreName] = useState('');
  const [splits, setSplits] = useState<SplitOption>(1);
  const [colorTheme, setColorTheme] = useState<ColorTheme>('red');
  const [popTemplate, setPopTemplate] = useState<'hot' | 'classic' | 'simple' | 'dark' | 'jumbo'>('hot');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [landscape, setLandscape] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  // 전단 목록
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [flyersLoaded, setFlyersLoaded] = useState(false);
  const [activeSource, setActiveSource] = useState<'flyer' | 'direct'>('direct');

  // 이미지 검색 팝업
  const [imgPicker, setImgPicker] = useState<{ idx: number; candidates: Array<{ title: string; image: string }> } | null>(null);


  const loadFlyers = useCallback(async () => {
    if (flyersLoaded) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers`);
      if (res.ok) { setFlyers(await res.json()); setFlyersLoaded(true); }
    } catch {}
  }, [flyersLoaded]);

  const importFromFlyer = (flyer: Flyer) => {
    const cats = typeof flyer.categories === 'string' ? JSON.parse(flyer.categories) : (flyer.categories || []);
    const imported: PopItem[] = [];
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        if (item.name?.trim()) imported.push({ ...item, selected: true });
      }
    }
    setItems(imported);
    setStoreName(flyer.store_name || storeName);
    setAlert({ show: true, title: '가져오기 완료', message: `"${flyer.title}"에서 ${imported.length}개 상품을 가져왔습니다.`, type: 'success' });
  };

  const addItem = () => setItems([...items, { name: '', originalPrice: 0, salePrice: 0, selected: true }]);
  const updateItem = (idx: number, field: string, value: any) => { const u = [...items]; (u[idx] as any)[field] = value; setItems(u); };
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const toggleAll = (checked: boolean) => setItems(items.map(it => ({ ...it, selected: checked })));
  const selectedItems = items.filter(it => it.selected && it.name.trim());
  const selectedCount = selectedItems.length;

  // 이미지 업로드
  const handleImageUpload = async (idx: number, file: File) => {
    if (file.size > 1024 * 1024) { setAlert({ show: true, title: '오류', message: '1MB 이하만 가능', type: 'error' }); return; }
    const fd = new FormData(); fd.append('image', file);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/product-image`, { method: 'POST', body: fd });
      if (res.ok) { const d = await res.json(); updateItem(idx, 'imageUrl', d.url); }
    } catch {}
  };

  // 이미지 네이버 검색
  const handleImageSearch = async (idx: number, name: string) => {
    if (!name.trim()) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/search-image`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ product_name: name }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.items?.length > 0) setImgPicker({ idx, candidates: d.items });
        else setAlert({ show: true, title: '알림', message: '검색 결과가 없습니다.', type: 'info' });
      }
    } catch {}
  };

  const selectImage = async (imageUrl: string) => {
    if (!imgPicker) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/select-image`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ image_url: imageUrl }),
      });
      if (res.ok) { const d = await res.json(); updateItem(imgPicker.idx, 'imageUrl', d.image_url); }
    } catch {}
    setImgPicker(null);
  };

  // ★ D129: ExcelUploadModal (AI 자동매핑) onComplete — CSV 수동파싱 제거
  // 3경로(인쇄전단/전단/POP) 공용 AI 매핑 모달 통일
  const [showExcelModal, setShowExcelModal] = useState(false);
  const handleExcelComplete = (mappedProducts: MappedProduct[]) => {
    if (mappedProducts.length === 0) {
      setAlert({ show: true, title: '업로드 오류', message: '유효한 상품 데이터가 없습니다.', type: 'error' });
      return;
    }
    const parsed: PopItem[] = mappedProducts.map(p => ({
      name: p.productName,
      originalPrice: p.originalPrice || 0,
      salePrice: p.salePrice || p.originalPrice || 0,
      badge: '',
      unit: p.unit,
      origin: p.origin,
      imageUrl: p.imageUrl,
      selected: true,
    }));
    setItems(prev => [...prev, ...parsed]);
    setAlert({ show: true, title: 'AI 자동매핑 완료', message: `${parsed.length}개 상품이 추가되었습니다.`, type: 'success' });
  };

  // PDF 다운로드
  const downloadPop = async (targetItems?: PopItem[]) => {
    const popItems = targetItems || selectedItems;
    if (popItems.length === 0) { setAlert({ show: true, title: '알림', message: '상품을 선택해주세요.', type: 'info' }); return; }
    setLoading(true);
    try {
      const useSplits = splits === 1 || popItems.length === 1;
      const endpoint = useSplits ? 'pop-pdf' : 'multi-pop';
      const body = useSplits
        ? { item: popItems[0], storeName, colorTheme, popTemplate, paperSize, landscape }
        : { items: popItems, splits, storeName, colorTheme, paperSize, landscape };
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${endpoint}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = useSplits ? `${popItems[0].name}_POP.pdf` : `POP_${splits}분할.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch { setAlert({ show: true, title: '오류', message: 'POP 다운로드 실패', type: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex gap-6 min-h-[calc(100vh-100px)]">
      {/* ═══ 좌측: 상품 소스 (전단 불러오기 / 직접 입력) ═══ */}
      <div className="w-[240px] flex-shrink-0">
        <div className="sticky top-20 space-y-4">
          {/* 소스 탭 */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button onClick={() => { setActiveSource('flyer'); loadFlyers(); }}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeSource === 'flyer' ? 'bg-primary-600 text-white' : 'bg-surface text-text-secondary hover:bg-bg'}`}>
              전단에서
            </button>
            <button onClick={() => setActiveSource('direct')}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeSource === 'direct' ? 'bg-primary-600 text-white' : 'bg-surface text-text-secondary hover:bg-bg'}`}>
              직접 입력
            </button>
          </div>

          {/* 전단 목록 */}
          {activeSource === 'flyer' && (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <p className="px-3 py-2 text-[10px] font-semibold text-text-muted border-b border-border">전단 선택 → 상품 가져오기</p>
              <div className="max-h-[400px] overflow-y-auto">
                {flyers.length === 0 ? (
                  <p className="text-center text-text-muted text-xs py-6">전단지가 없습니다</p>
                ) : flyers.map(f => {
                  const cats = typeof f.categories === 'string' ? JSON.parse(f.categories) : (f.categories || []);
                  const cnt = cats.reduce((s: number, c: any) => s + (c.items?.filter((i: any) => i.name?.trim()).length || 0), 0);
                  return (
                    <button key={f.id} onClick={() => importFromFlyer(f)}
                      className="w-full text-left px-3 py-3 border-b border-border/50 hover:bg-bg transition-colors">
                      <div className="text-xs font-semibold text-text truncate">{f.title}</div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-[10px] text-text-muted">{f.store_name || ''}</span>
                        <span className="text-[10px] text-primary-600 font-medium">{cnt}개</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 직접 입력 도구 */}
          {activeSource === 'direct' && (
            <div className="space-y-2">
              <Button className="w-full" onClick={addItem}>+ 상품 추가</Button>
              <Button variant="secondary" className="w-full" onClick={() => setShowExcelModal(true)}>
                🤖 엑셀/CSV AI 자동매핑
              </Button>
              <p className="text-[10px] text-text-muted text-center">헤더 자동 매핑 (.xlsx/.xls/.csv)</p>
            </div>
          )}

          {/* POP 설정 */}
          <div className="bg-surface border border-border rounded-xl p-3 space-y-3">
            <p className="text-xs font-bold text-text">POP 설정</p>

            {/* 매장명 */}
            <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="매장명"
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />

            {/* POP 템플릿 */}
            <div>
              <p className="text-[10px] font-semibold text-text-muted mb-1.5">디자인</p>
              <div className="space-y-1">
                {[
                  { value: 'hot' as const, label: 'HOT 프라이스', color: '#1a1a1a' },
                  { value: 'classic' as const, label: '클래식 마트', color: '#dc2626' },
                  { value: 'simple' as const, label: '심플 화이트', color: '#f5f5f5' },
                  { value: 'dark' as const, label: '다크 프리미엄', color: '#0a0a0a' },
                  { value: 'jumbo' as const, label: '대형 가격', color: '#dc2626' },
                ].map(t => (
                  <button key={t.value} onClick={() => setPopTemplate(t.value)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                      popTemplate === t.value ? 'bg-primary-600 text-white' : 'bg-bg text-text-secondary hover:bg-border/50'}`}>
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: t.color, border: t.color === '#f5f5f5' ? '1px solid #ddd' : 'none' }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 용지 사이즈 */}
            <div>
              <p className="text-[10px] font-semibold text-text-muted mb-1.5">용지</p>
              <div className="grid grid-cols-3 gap-1">
                {PAPER_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setPaperSize(opt.value)}
                    className={`py-1.5 rounded-lg text-center transition-all ${
                      paperSize === opt.value ? 'bg-primary-600 text-white text-[10px] font-bold' : 'bg-bg text-text-secondary text-[10px] hover:bg-border/50'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 분할 */}
            <div>
              <p className="text-[10px] font-semibold text-text-muted mb-1.5">분할</p>
              <div className="flex flex-wrap gap-1">
                {SPLIT_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setSplits(opt.value)}
                    className={`px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-bold ${
                      splits === opt.value ? 'bg-primary-600 text-white' : 'bg-bg text-text-secondary hover:bg-border/50'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 색상 */}
            <div>
              <p className="text-[10px] font-semibold text-text-muted mb-1.5">색상</p>
              <div className="flex gap-1.5">
                {COLOR_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setColorTheme(opt.value)}
                    className={`w-8 h-8 rounded-full transition-all ${colorTheme === opt.value ? 'ring-2 ring-offset-1 ring-primary-500' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: opt.color }} title={opt.label} />
                ))}
              </div>
            </div>

            {/* 방향 */}
            <div>
              <p className="text-[10px] font-semibold text-text-muted mb-1.5">용지 방향</p>
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => setLandscape(false)}
                  className={`py-2 rounded-lg text-xs font-bold ${!landscape ? 'bg-primary-600 text-white' : 'bg-bg text-text-secondary'}`}>
                  세로
                </button>
                <button onClick={() => setLandscape(true)}
                  className={`py-2 rounded-lg text-xs font-bold ${landscape ? 'bg-primary-600 text-white' : 'bg-bg text-text-secondary'}`}>
                  가로
                </button>
              </div>
            </div>

            {/* 다운로드 */}
            <Button className="w-full" onClick={() => downloadPop()} disabled={selectedCount === 0 || loading}>
              {loading ? '생성 중...' : `POP 다운로드 (${selectedCount}개)`}
            </Button>
          </div>
        </div>
      </div>

      {/* ═══ 중앙: 상품 편집 ═══ */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-text">POP 제작</h2>
            <p className="text-xs text-text-muted">상품을 추가하고 POP를 만들어 인쇄하세요</p>
          </div>
          {items.length > 0 && (
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={items.every(it => it.selected)} onChange={e => toggleAll(e.target.checked)}
                className="w-4 h-4 rounded" />
              <span className="text-xs text-text-secondary">{selectedCount}/{items.length} 선택</span>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-12">
            <EmptyState icon="🏷️" title="상품을 추가해주세요"
              description="좌측에서 전단을 선택하거나 직접 상품을 추가하세요"
              action={<div className="flex gap-2"><Button variant="secondary" onClick={() => { setActiveSource('flyer'); loadFlyers(); }}>전단에서 가져오기</Button><Button onClick={addItem}>+ 상품 추가</Button></div>} />
          </div>
        ) : (
          <div className="space-y-2">
            {/* 헤더 */}
            <div className="grid grid-cols-12 gap-2 px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              <div className="col-span-1"></div>
              <div className="col-span-1">이미지</div>
              <div className="col-span-3">상품명</div>
              <div className="col-span-1">원가</div>
              <div className="col-span-1">할인가</div>
              <div className="col-span-1">규격</div>
              <div className="col-span-1">원산지</div>
              <div className="col-span-1">뱃지</div>
              <div className="col-span-2"></div>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className={`grid grid-cols-12 gap-2 items-center p-3 rounded-xl border transition-all ${
                item.selected ? 'bg-primary-500/5 border-primary-500/20' : 'bg-surface border-border/50'}`}>

                {/* 체크 */}
                <div className="col-span-1 flex justify-center">
                  <input type="checkbox" checked={item.selected} onChange={e => updateItem(idx, 'selected', e.target.checked)}
                    className="w-4 h-4 rounded" />
                </div>

                {/* 이미지 */}
                <div className="col-span-1">
                  <label className="cursor-pointer block w-11 h-11 rounded-lg border border-dashed border-border hover:border-primary-500 overflow-hidden flex items-center justify-center bg-bg/50">
                    {item.imageUrl ? (
                      <img src={`${API_BASE}${item.imageUrl}`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-text-muted text-sm">📷</span>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const f = e.target.files?.[0]; if (f) handleImageUpload(idx, f); e.target.value = '';
                    }} />
                  </label>
                </div>

                {/* 상품명 */}
                <div className="col-span-3">
                  <input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} placeholder="상품명"
                    className="w-full px-2.5 py-2 bg-surface border border-border rounded-lg text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary-500"
                    onBlur={async () => {
                      if (!item.name.trim() || item.imageUrl) return;
                      // 카탈로그 우선 매칭
                      try {
                        const r = await apiFetch(`${API_BASE}/api/flyer/catalog/find-image?name=${encodeURIComponent(item.name)}`);
                        if (r.ok) { const d = await r.json(); if (d.image_url) { updateItem(idx, 'imageUrl', d.image_url); return; } }
                      } catch {}
                      // 네이버 검색 후보
                      handleImageSearch(idx, item.name);
                    }} />
                </div>

                {/* 원가 */}
                <div className="col-span-1">
                  <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(idx, 'originalPrice', Number(e.target.value))}
                    placeholder="원가" className="w-full px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />
                </div>

                {/* 할인가 */}
                <div className="col-span-1">
                  <input type="number" value={item.salePrice || ''} onChange={e => updateItem(idx, 'salePrice', Number(e.target.value))}
                    placeholder="할인가" className="w-full px-2 py-2 bg-surface border border-border rounded-lg text-xs font-bold text-error-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                </div>

                {/* 규격 */}
                <div className="col-span-1">
                  <input value={item.unit || ''} onChange={e => updateItem(idx, 'unit', e.target.value)}
                    placeholder="1kg" className="w-full px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />
                </div>

                {/* 원산지 */}
                <div className="col-span-1">
                  <input value={item.origin || ''} onChange={e => updateItem(idx, 'origin', e.target.value)}
                    placeholder="국내산" className="w-full px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />
                </div>

                {/* 뱃지 */}
                <div className="col-span-1">
                  <input value={item.badge || ''} onChange={e => updateItem(idx, 'badge', e.target.value)}
                    placeholder="특가" className="w-full px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />
                </div>

                {/* 액션 */}
                <div className="col-span-2 flex items-center gap-1 justify-end">
                  <button onClick={() => handleImageSearch(idx, item.name)} className="text-[10px] px-2 py-1.5 rounded text-blue-500 hover:bg-blue-50 font-medium" title="이미지 검색">검색</button>
                  <button onClick={() => downloadPop([item])} disabled={!item.name.trim() || loading}
                    className="text-[10px] px-2 py-1.5 rounded bg-primary-50 text-primary-600 hover:bg-primary-100 font-medium disabled:opacity-40">POP</button>
                  <button onClick={() => removeItem(idx)} className="text-error-500/50 hover:text-error-500 text-sm">✕</button>
                </div>
              </div>
            ))}

            {/* 일괄 변경/스타일 복사 */}
            <div className="flex items-center gap-2 pt-3 pb-1 border-t border-border">
              <span className="text-[10px] text-text-muted font-medium">일괄:</span>
              <button onClick={() => {
                const badge = prompt('뱃지 일괄 변경 (예: 초특가)');
                if (badge !== null) setItems(items.map(it => it.selected ? { ...it, badge } : it));
              }} className="text-[10px] px-2 py-1 rounded bg-bg text-text-secondary hover:bg-border/50 font-medium">뱃지 변경</button>
              <button onClick={() => {
                const origin = prompt('원산지 일괄 변경 (예: 국내산)');
                if (origin !== null) setItems(items.map(it => it.selected ? { ...it, origin } : it));
              }} className="text-[10px] px-2 py-1 rounded bg-bg text-text-secondary hover:bg-border/50 font-medium">원산지 변경</button>
              <button onClick={() => {
                const pct = prompt('할인율 일괄 적용 (예: 20)');
                if (pct && Number(pct) > 0) {
                  const rate = 1 - Number(pct) / 100;
                  setItems(items.map(it => it.selected && it.originalPrice > 0
                    ? { ...it, salePrice: Math.round(it.originalPrice * rate) }
                    : it));
                }
              }} className="text-[10px] px-2 py-1 rounded bg-bg text-text-secondary hover:bg-border/50 font-medium">할인율 적용</button>
              {items.length > 1 && (
                <button onClick={() => {
                  const first = items.find(it => it.selected);
                  if (!first) return;
                  setItems(items.map(it => it.selected ? { ...it, badge: first.badge, origin: first.origin, unit: first.unit } : it));
                }} className="text-[10px] px-2 py-1 rounded bg-primary-50 text-primary-600 hover:bg-primary-100 font-medium">스타일 복사</button>
              )}
            </div>

            {/* 하단 */}
            <div className="flex justify-between items-center pt-2">
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={addItem}>+ 상품 추가</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowExcelModal(true)}>🤖 엑셀/CSV AI 자동매핑</Button>
              </div>
              <Button onClick={() => downloadPop()} disabled={selectedCount === 0 || loading}>
                {loading ? '생성 중...' : `${paperSize} ${splits === 1 ? '개별' : splits + '분할'} POP (${selectedCount}개)`}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ★ D129: 엑셀/CSV AI 자동매핑 모달 (3경로 공용) */}
      <ExcelUploadModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        onComplete={handleExcelComplete}
      />

      {/* ═══ 이미지 검색 팝업 ═══ */}
      {imgPicker && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setImgPicker(null)}>
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-3">이미지 선택</h3>
            <div className="grid grid-cols-3 gap-2">
              {imgPicker.candidates.map((c, i) => (
                <button key={i} onClick={() => selectImage(c.image)}
                  className="rounded-xl overflow-hidden border-2 border-transparent hover:border-primary-500 transition-all">
                  <img src={c.image} alt={c.title} className="w-full aspect-square object-cover" />
                  <p className="text-[9px] text-text-muted p-1 truncate">{c.title}</p>
                </button>
              ))}
            </div>
            <Button variant="secondary" className="w-full mt-3" onClick={() => setImgPicker(null)}>닫기</Button>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </div>
  );
}
