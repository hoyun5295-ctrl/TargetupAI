/**
 * ★ POP 제작 페이지 — 독립 제작 도구
 *
 * 1. 전단에서 상품 끌어오기 OR 직접 입력
 * 2. 이미지 매칭 (카탈로그/네이버)
 * 3. 분할(1/2/4/8) + 용지방향(가로/세로) 선택
 * 4. 미리보기 + PDF 다운로드 (개별/전체)
 */

import { useState, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, Badge, EmptyState } from '../components/ui';
import AlertModal from '../components/AlertModal';

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
}

type SplitOption = 1 | 2 | 4 | 8;
type ColorTheme = 'red' | 'yellow' | 'green' | 'blue' | 'black';

const SPLIT_OPTIONS: { value: SplitOption; label: string; desc: string }[] = [
  { value: 1, label: '1장 1상품', desc: 'A4 전체에 상품 1개' },
  { value: 2, label: '2분할', desc: 'A4에 상품 2개' },
  { value: 4, label: '4분할', desc: 'A4에 상품 4개' },
  { value: 8, label: '8분할', desc: 'A4에 상품 8개' },
];

const COLOR_OPTIONS: { value: ColorTheme; label: string; color: string }[] = [
  { value: 'red', label: '빨강', color: '#dc2626' },
  { value: 'yellow', label: '노랑', color: '#f59e0b' },
  { value: 'green', label: '초록', color: '#16a34a' },
  { value: 'blue', label: '파랑', color: '#1d4ed8' },
  { value: 'black', label: '블랙', color: '#1a1a1a' },
];

export default function PopPage({ token: _token }: { token: string }) {
  const [items, setItems] = useState<PopItem[]>([]);
  const [storeName, setStoreName] = useState('');
  const [splits, setSplits] = useState<SplitOption>(1);
  const [colorTheme, setColorTheme] = useState<ColorTheme>('red');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  // 전단 목록 (끌어오기용)
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [showFlyerPicker, setShowFlyerPicker] = useState(false);

  const loadFlyers = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers`);
      if (res.ok) setFlyers(await res.json());
    } catch {}
  }, []);

  // 전단에서 상품 가져오기
  const importFromFlyer = (flyer: Flyer) => {
    const cats = typeof flyer.categories === 'string' ? JSON.parse(flyer.categories) : (flyer.categories || []);
    const imported: PopItem[] = [];
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        if (item.name?.trim()) {
          imported.push({ ...item, selected: true });
        }
      }
    }
    setItems(prev => [...prev, ...imported]);
    setStoreName(flyer.store_name || storeName);
    setShowFlyerPicker(false);
    setAlert({ show: true, title: '가져오기 완료', message: `${imported.length}개 상품을 가져왔습니다.`, type: 'success' });
  };

  // 상품 직접 추가
  const addItem = () => {
    setItems([...items, { name: '', originalPrice: 0, salePrice: 0, selected: true }]);
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const u = [...items];
    (u[idx] as any)[field] = value;
    setItems(u);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const toggleAll = (checked: boolean) => {
    setItems(items.map(it => ({ ...it, selected: checked })));
  };

  const selectedItems = items.filter(it => it.selected && it.name.trim());
  const selectedCount = selectedItems.length;

  // PDF 다운로드 — 개별 (1장 1상품)
  const downloadSinglePop = async (item: PopItem) => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/pop-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, storeName, colorTheme }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${item.name}_POP.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setAlert({ show: true, title: '오류', message: 'POP 다운로드 실패', type: 'error' });
    } finally { setLoading(false); }
  };

  // PDF 다운로드 — 선택 상품 분할 POP
  const downloadMultiPop = async () => {
    if (selectedCount === 0) {
      setAlert({ show: true, title: '알림', message: '상품을 선택해주세요.', type: 'info' });
      return;
    }
    setLoading(true);
    try {
      const endpoint = splits === 1 ? 'pop-pdf' : 'multi-pop';
      const body = splits === 1
        ? { item: selectedItems[0], storeName, colorTheme }
        : { items: selectedItems, splits, storeName, colorTheme };
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `POP_${splits}분할.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setAlert({ show: true, title: '오류', message: 'POP 다운로드 실패', type: 'error' });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">POP 제작</h2>
          <p className="text-xs text-text-muted mt-0.5">가격표/POP를 만들어 인쇄하세요</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { loadFlyers(); setShowFlyerPicker(true); }}>
            전단에서 가져오기
          </Button>
          <Button onClick={addItem}>+ 상품 추가</Button>
        </div>
      </div>

      {/* 매장명 */}
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Input label="매장명" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="OO마트 OO점" />
        </div>
      </div>

      {/* POP 옵션 */}
      <SectionCard title="POP 설정">
        <div className="grid grid-cols-2 gap-6">
          {/* 분할 선택 */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2">분할</p>
            <div className="grid grid-cols-4 gap-2">
              {SPLIT_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setSplits(opt.value)}
                  className={`rounded-xl border-2 p-3 text-center transition-all ${
                    splits === opt.value
                      ? 'border-primary-500 bg-primary-500/10'
                      : 'border-border hover:border-border-strong'
                  }`}>
                  <div className="text-lg font-bold text-text">{opt.label}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 색상 테마 */}
          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2">색상 테마</p>
            <div className="flex gap-2">
              {COLOR_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setColorTheme(opt.value)}
                  className={`w-10 h-10 rounded-full border-3 transition-all ${
                    colorTheme === opt.value ? 'ring-2 ring-offset-2 ring-primary-500' : ''
                  }`}
                  style={{ background: opt.color, borderColor: colorTheme === opt.value ? opt.color : 'transparent' }}
                  title={opt.label}
                />
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* 상품 목록 */}
      <SectionCard title={`상품 목록 (${items.length}개${selectedCount > 0 ? ` / ${selectedCount}개 선택` : ''})`}>
        {items.length === 0 ? (
          <EmptyState icon="🏷️" title="상품을 추가해주세요" description="직접 입력하거나, 전단에서 가져올 수 있습니다" />
        ) : (
          <>
            {/* 전체 선택 */}
            <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border">
              <input type="checkbox" checked={items.length > 0 && items.every(it => it.selected)}
                onChange={e => toggleAll(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary-600" />
              <span className="text-xs text-text-secondary font-medium">전체 선택</span>
            </div>

            {/* 상품 행 */}
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-bg/50 hover:bg-bg transition-colors">
                  <input type="checkbox" checked={item.selected}
                    onChange={e => updateItem(idx, 'selected', e.target.checked)}
                    className="w-4 h-4 rounded border-border text-primary-600 flex-shrink-0" />

                  {/* 이미지 */}
                  <div className="w-12 h-12 rounded-lg bg-surface-secondary overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {item.imageUrl ? (
                      <img src={`${API_BASE}${item.imageUrl}`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-text-muted text-lg">{(item.name || '?')[0]}</span>
                    )}
                  </div>

                  {/* 상품명 */}
                  <input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)}
                    placeholder="상품명"
                    className="flex-1 min-w-0 px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />

                  {/* 원가 */}
                  <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(idx, 'originalPrice', Number(e.target.value))}
                    placeholder="원가"
                    className="w-24 px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />

                  {/* 할인가 */}
                  <input type="number" value={item.salePrice || ''} onChange={e => updateItem(idx, 'salePrice', Number(e.target.value))}
                    placeholder="할인가"
                    className="w-24 px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 font-bold" />

                  {/* 뱃지 */}
                  <input value={item.badge || ''} onChange={e => updateItem(idx, 'badge', e.target.value)}
                    placeholder="뱃지"
                    className="w-16 px-2 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-500" />

                  {/* 개별 POP */}
                  <button onClick={() => downloadSinglePop(item)} disabled={!item.name.trim() || loading}
                    className="text-[10px] px-2 py-1.5 rounded bg-primary-50 text-primary-600 hover:bg-primary-100 font-medium flex-shrink-0 disabled:opacity-40">
                    POP
                  </button>

                  {/* 삭제 */}
                  <button onClick={() => removeItem(idx)} className="text-error-500/60 hover:text-error-500 flex-shrink-0">✕</button>
                </div>
              ))}
            </div>

            {/* 하단 버튼 */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border">
              <Button variant="ghost" size="sm" onClick={addItem}>+ 상품 추가</Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={downloadMultiPop} disabled={selectedCount === 0 || loading}>
                  {loading ? '생성 중...' : `선택 ${selectedCount}개 → ${splits === 1 ? '개별' : splits + '분할'} POP 다운로드`}
                </Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* 전단 선택 모달 */}
      {showFlyerPicker && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowFlyerPicker(false)}>
          <div className="bg-surface rounded-2xl w-full max-w-lg p-6 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">전단에서 가져오기</h3>
            {flyers.length === 0 ? (
              <p className="text-center text-text-muted py-8">전단지가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {flyers.map(f => {
                  const cats = typeof f.categories === 'string' ? JSON.parse(f.categories) : (f.categories || []);
                  const itemCount = cats.reduce((s: number, c: any) => s + (c.items?.length || 0), 0);
                  return (
                    <button key={f.id} onClick={() => importFromFlyer(f)}
                      className="w-full text-left p-4 rounded-xl bg-surface-secondary hover:bg-bg transition-colors">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-sm text-white">{f.title}</span>
                          {f.store_name && <span className="ml-2 text-xs text-text-muted">{f.store_name}</span>}
                        </div>
                        <Badge variant={f.status === 'published' ? 'success' : 'neutral'}>
                          {itemCount}개 상품
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </div>
  );
}
