/**
 * ★ 전단AI 인쇄전단 에디터 (완전 재작성)
 *
 * 마트 전단지 레이아웃 기반 인터랙티브 에디터:
 *   - 상단: 매장 정보 (로고/주소/전화/QR)
 *   - 카테고리별 상품 그리드 (4열)
 *   - + 버튼 → 상품 추가 모달 (네이버 이미지 자동검색 + 서버 폴백 + 직접 업로드)
 *   - CSV 일괄 업로드 → 카테고리별 자동 배치
 *   - 최종 → puppeteer 300dpi PDF 출력
 *
 * API:
 *   - POST /api/flyer/flyers/print-flyer (PDF 생성)
 *   - GET /api/flyer/catalog/search-image?q=상품명 (네이버 이미지 검색)
 */

import { useState, useRef, useEffect } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, Badge, EmptyState, ConfirmModal } from '../components/ui';
import AlertModal from '../components/AlertModal';
import ExcelUploadModal, { type MappedProduct } from '../components/ExcelUploadModal';

// ============================================================
// 타입
// ============================================================
interface ProductItem {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  unit: string;
  category: string;
  imageUrl: string;
  aiCopy: string;
}

interface Category {
  id: string;
  name: string;
  items: ProductItem[];
}

interface StoreInfo {
  storeName: string;
  address: string;
  phone: string;
  hours: string;
}

// ★ D129: 인쇄전단 목록 아이템 (GET /print-flyers 응답)
interface PrintFlyerItem {
  id: string;
  title: string;
  store_name: string | null;
  status: string;
  categories: any;
  created_at: string;
  updated_at: string;
  pdfUrl: string | null;
  pngUrl: string | null;
}

// ============================================================
// 기본 카테고리
// ============================================================
const DEFAULT_CATEGORIES = [
  '축산', '정육', '과일', '채소', '수산', '유제품', '가공식품', '주류', '생활용품', '베이커리'
];

// ★ D129 V2: 인쇄전단 4종 기본 템플릿 (2절 545×788mm 고정)
// 백엔드 /api/flyer/flyers/print-templates 에서도 동일 메타 반환
interface PrintTemplateMeta {
  id: string;
  label: string;
  mood: string;
  palette: string[];
  recommended: string;
  paper: string;
}
const TEMPLATES_V2_FALLBACK: PrintTemplateMeta[] = [
  { id: 'mart_spring_v1',  label: '봄세일 (파스텔)',       mood: '부드러움',   palette: ['#4F46E5', '#FFB7D5', '#FFD33D'], recommended: '봄 · 시즌 행사',         paper: 'j2' },
  { id: 'mart_hot_v1',     label: 'HOT특가 (레드핫)',       mood: '파격',      palette: ['#E8331F', '#FF8F2B', '#FFD33D'], recommended: '특가 · 파격 세일',      paper: 'j2' },
  { id: 'mart_premium_v1', label: '프리미엄 (다크+골드)',   mood: '엘레강스',   palette: ['#0B1428', '#C9A961', '#F7F3E9'], recommended: '한우 · 수입산 · 고급',  paper: 'j2' },
  { id: 'mart_weekend_v1', label: '주말대박 (일렉트릭)',    mood: '임팩트',     palette: ['#7C3AED', '#FDE047', '#EC4899'], recommended: '주말 · 금토일 한정',     paper: 'j2' },
];

let idCounter = 0;
function genId() { return `p_${Date.now()}_${++idCounter}`; }

// ============================================================
// 메인 컴포넌트
// ============================================================
export default function PrintFlyerPage({ token: _token }: { token: string }) {
  // 기본 설정
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [templateCode, setTemplateCode] = useState('mart_spring_v1');

  // ★ D129 V2 템플릿 메타 (서버 /print-templates 에서 fetch. 실패 시 fallback 사용)
  const [templates, setTemplates] = useState<PrintTemplateMeta[]>(TEMPLATES_V2_FALLBACK);

  // 이미지 자동 배경제거 (rembg) 사용 여부
  const [useAutoRembg, setUseAutoRembg] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/flyer/flyers/print-templates`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) setTemplates(list);
        }
      } catch { /* fallback 유지 */ }
    })();
  }, []);

  // 매장 정보
  const [store, setStore] = useState<StoreInfo>({ storeName: '', address: '', phone: '', hours: '' });

  // 카테고리 + 상품
  const [categories, setCategories] = useState<Category[]>(
    DEFAULT_CATEGORIES.slice(0, 4).map(name => ({ id: genId(), name, items: [] }))
  );

  // 상품 추가 모달
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTargetCatId, setAddTargetCatId] = useState('');
  const [addForm, setAddForm] = useState({ name: '', price: '', originalPrice: '', unit: '', imageUrl: '', aiCopy: '' });
  const [searchImages, setSearchImages] = useState<Array<{ image: string; title: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState('');

  // 엑셀 업로드 모달
  const [showExcelModal, setShowExcelModal] = useState(false);

  // 이미지 업로드용
  const imageUploadRef = useRef<HTMLInputElement>(null);

  // 상태
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  // ★ D129: 인쇄전단 목록 state
  const [flyerList, setFlyerList] = useState<PrintFlyerItem[]>([]);
  const [loadingFlyerList, setLoadingFlyerList] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; id: string; title: string }>({ show: false, id: '', title: '' });

  const loadPrintFlyers = async () => {
    setLoadingFlyerList(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/print-flyers`);
      if (res.ok) {
        const data = await res.json();
        setFlyerList(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    setLoadingFlyerList(false);
  };

  useEffect(() => { loadPrintFlyers(); }, []);

  const handleDeleteFlyer = async (id: string) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setAlert({ show: true, title: '삭제 완료', message: '인쇄전단이 삭제되었습니다.', type: 'success' });
        setDeleteModal({ show: false, id: '', title: '' });
        loadPrintFlyers();
      } else {
        setAlert({ show: true, title: '삭제 실패', message: '삭제에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '삭제 실패', message: '서버 오류', type: 'error' });
    }
  };

  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
    } catch { return ''; }
  };

  // ============================================================
  // 카테고리 관리
  // ============================================================
  const addCategory = () => {
    const name = prompt('카테고리 이름을 입력하세요');
    if (!name) return;
    setCategories(prev => [...prev, { id: genId(), name, items: [] }]);
  };

  const removeCategory = (catId: string) => {
    if (!confirm('이 카테고리를 삭제하시겠습니까?')) return;
    setCategories(prev => prev.filter(c => c.id !== catId));
  };

  const renameCat = (catId: string) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const name = prompt('카테고리 이름', cat.name);
    if (!name) return;
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, name } : c));
  };

  // ============================================================
  // 상품 추가 모달
  // ============================================================
  const openAddModal = (catId: string) => {
    setAddTargetCatId(catId);
    setAddForm({ name: '', price: '', originalPrice: '', unit: '', imageUrl: '', aiCopy: '' });
    setSearchImages([]);
    setSelectedImage('');
    setShowAddModal(true);
  };

  const searchProductImage = async () => {
    if (!addForm.name.trim()) return;
    setSearchLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/catalog/search-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: addForm.name.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchImages(data.items || []);
      }
    } catch { /* ignore */ }
    setSearchLoading(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSelectedImage(dataUrl);
      setAddForm(prev => ({ ...prev, imageUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const confirmAddProduct = () => {
    if (!addForm.name.trim()) { setAlert({ show: true, title: '입력 오류', message: '상품명을 입력해주세요', type: 'error' }); return; }
    if (!addForm.price) { setAlert({ show: true, title: '입력 오류', message: '판매가를 입력해주세요', type: 'error' }); return; }

    const newItem: ProductItem = {
      id: genId(),
      name: addForm.name.trim(),
      price: Number(addForm.price) || 0,
      originalPrice: Number(addForm.originalPrice) || 0,
      unit: addForm.unit,
      category: categories.find(c => c.id === addTargetCatId)?.name || '',
      imageUrl: selectedImage || addForm.imageUrl || '',
      aiCopy: addForm.aiCopy,
    };

    setCategories(prev => prev.map(c =>
      c.id === addTargetCatId ? { ...c, items: [...c.items, newItem] } : c
    ));
    setShowAddModal(false);
  };

  const removeProduct = (catId: string, productId: string) => {
    setCategories(prev => prev.map(c =>
      c.id === catId ? { ...c, items: c.items.filter(i => i.id !== productId) } : c
    ));
  };

  // ============================================================
  // 엑셀 업로드 완료 → 카테고리별 자동 배치
  // ============================================================
  const handleExcelComplete = (mappedProducts: MappedProduct[]) => {
    const newCategories = new Map<string, ProductItem[]>();

    for (const p of mappedProducts) {
      const cat = p.category || '기타';
      if (!newCategories.has(cat)) newCategories.set(cat, []);
      newCategories.get(cat)!.push({
        id: genId(),
        name: p.productName,
        price: p.salePrice,
        originalPrice: p.originalPrice,
        unit: p.unit,
        category: cat,
        imageUrl: p.imageUrl,
        aiCopy: '',
      });
    }

    setCategories(prev => {
      const updated = [...prev];
      for (const [catName, items] of newCategories) {
        const existing = updated.find(c => c.name === catName);
        if (existing) {
          existing.items = [...existing.items, ...items];
        } else {
          updated.push({ id: genId(), name: catName, items });
        }
      }
      return updated;
    });

    setAlert({ show: true, title: '엑셀 업로드 완료', message: `${mappedProducts.length}개 상품이 카테고리별로 추가되었습니다`, type: 'success' });
  };

  // CSV 업로드 제거 — ExcelUploadModal로 통합 (CT-F24)

  // ============================================================
  // 전단 발행 (format 별 분기) — ★ D129: PNG(빠른확인) / PDF(인쇄용)
  // ============================================================
  const [pngUrl, setPngUrl] = useState('');
  const [generatingFormat, setGeneratingFormat] = useState<'' | 'pdf' | 'png'>('');

  const generate = async (format: 'pdf' | 'png') => {
    const totalProducts = categories.reduce((s, c) => s + c.items.length, 0);
    if (!title.trim()) { setAlert({ show: true, title: '입력 오류', message: '전단 제목을 입력해주세요', type: 'error' }); return; }
    if (totalProducts === 0) { setAlert({ show: true, title: '입력 오류', message: '상품을 1개 이상 추가해주세요', type: 'error' }); return; }

    setGeneratingFormat(format);
    setGenerating(true);
    try {
      const products = categories.flatMap(cat =>
        cat.items.map(item => ({
          productName: item.name,
          salePrice: item.price,
          originalPrice: item.originalPrice,
          unit: item.unit,
          category: cat.name,
          imageUrl: item.imageUrl,
          aiCopy: item.aiCopy,
          promoType: item.originalPrice > 0 && item.originalPrice !== item.price
            ? (Math.round((1 - item.price / item.originalPrice) * 100) >= 30 ? 'main' : 'sub')
            : 'general',
        }))
      );

      const period = periodStart && periodEnd ? `${periodStart} ~ ${periodEnd}` : '';
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/print-flyer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, period, products,
          templateCode,
          storeName: store.storeName,
          autoRembg: useAutoRembg,
          autoMatchImage: true,
          format,                    // ★ D129: 'pdf' or 'png'
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (format === 'pdf' && data.pdfUrl) {
          setPdfUrl(`${API_BASE}${data.pdfUrl}`);
          setAlert({ show: true, title: '인쇄용 PDF 발행 완료', message: 'PDF 다운로드 버튼을 눌러 인쇄업체 제출용 파일을 받으세요.', type: 'success' });
        } else if (format === 'png' && data.pngUrl) {
          setPngUrl(`${API_BASE}${data.pngUrl}`);
          setAlert({ show: true, title: '빠른확인 PNG 발행 완료', message: '확인용 이미지가 준비됐습니다. 다운로드하여 내용을 검토하세요.', type: 'success' });
        }
        // ★ D129: 발행 완료 후 목록 즉시 갱신
        loadPrintFlyers();
      } else {
        const err = await res.json().catch(() => ({ error: '생성 실패' }));
        setAlert({ show: true, title: '발행 실패', message: err.error || '전단 발행에 실패했습니다.', type: 'error' });
      }
    } catch (err: any) {
      setAlert({ show: true, title: '발행 실패', message: err.message || '서버 오류', type: 'error' });
    }
    setGenerating(false);
    setGeneratingFormat('');
  };

  const downloadFile = async (url: string, filename: string) => {
    const res = await apiFetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = objUrl; a.download = filename; a.click();
    URL.revokeObjectURL(objUrl);
  };

  // ============================================================
  // 총 상품 수
  // ============================================================
  const totalProducts = categories.reduce((s, c) => s + c.items.length, 0);

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="space-y-6">
      {/* ★ D129: 내 인쇄전단 목록 */}
      <SectionCard title={`📁 내 인쇄전단 ${flyerList.length > 0 ? `(${flyerList.length}건)` : ''}`}>
        {loadingFlyerList ? (
          <div className="text-center py-10 text-text-muted text-sm">로딩 중...</div>
        ) : flyerList.length === 0 ? (
          <EmptyState
            icon="🖨"
            title="아직 발행한 인쇄전단이 없습니다"
            description="아래 에디터에서 상품을 입력하고 PDF/PNG로 발행해보세요"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flyerList.map(f => {
              return (
                <div key={f.id} className="bg-surface border border-border rounded-xl overflow-hidden shadow-card hover:shadow-elevated transition-shadow">
                  <div className="px-4 py-3 border-b bg-bg border-border">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-sm text-text truncate">{f.title}</h3>
                        {f.store_name && <p className="text-xs text-text-muted mt-0.5 truncate">{f.store_name}</p>}
                      </div>
                      <Badge variant="neutral">인쇄전단</Badge>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>📐 2절 세로 (545×788mm)</span>
                    </div>
                    <div className="mt-2 flex gap-2 text-[11px]">
                      {f.pdfUrl && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 font-semibold">PDF</span>
                      )}
                      {f.pngUrl && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">PNG</span>
                      )}
                      {!f.pdfUrl && !f.pngUrl && (
                        <span className="text-text-muted">파일 없음 (재발행 필요)</span>
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-bg border-t border-border flex justify-between items-center">
                    <span className="text-[11px] text-text-muted">{fmtDate(f.created_at)}</span>
                    <div className="flex gap-2">
                      {f.pdfUrl && (
                        <button
                          onClick={() => downloadFile(`${API_BASE}${f.pdfUrl}`, `${f.title || 'print-flyer'}.pdf`)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          📄 PDF
                        </button>
                      )}
                      {f.pngUrl && (
                        <button
                          onClick={() => downloadFile(`${API_BASE}${f.pngUrl}`, `${f.title || 'print-flyer'}.png`)}
                          className="text-[11px] text-amber-600 hover:text-amber-700 font-medium"
                        >
                          🖼 PNG
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteModal({ show: true, id: f.id, title: f.title })}
                        className="text-[11px] text-error-500 hover:text-error-600 font-medium"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text">인쇄 전단 에디터</h2>
          <p className="text-xs text-text-secondary mt-1">빠른확인용 PNG 이미지 또는 인쇄업체 제출용 PDF를 발행합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {pngUrl && (
            <button onClick={() => downloadFile(pngUrl, `print-flyer-${Date.now()}.png`)}
              className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 transition inline-flex items-center gap-1.5">
              🖼 PNG 다운로드
            </button>
          )}
          {pdfUrl && (
            <button onClick={() => downloadFile(pdfUrl, `print-flyer-${Date.now()}.pdf`)}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-xl hover:bg-primary-700 transition inline-flex items-center gap-1.5">
              📄 PDF 다운로드
            </button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setShowExcelModal(true)}>
            엑셀 업로드
          </Button>
        </div>
      </div>

      {/* 기본 설정 */}
      <SectionCard title="기본 설정">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">전단 제목</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 봄맞이 특가전" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">행사 시작일</label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">행사 종료일</label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 font-semibold">
              📐 2절 세로 (545×788mm)
            </span>
            <span>인쇄소 표준 2절 사이즈로 자동 출력 (300dpi PDF)</span>
          </div>
        </div>
      </SectionCard>

      {/* ★ D129 V2 템플릿 선택 */}
      <SectionCard title="템플릿 선택 (AI 자동 제작)">
        <div className="grid grid-cols-2 gap-3">
          {templates.map(tpl => {
            const selected = templateCode === tpl.id;
            return (
              <button
                key={tpl.id}
                onClick={() => setTemplateCode(tpl.id)}
                className={`p-4 rounded-xl border-2 text-left transition relative overflow-hidden ${
                  selected
                    ? 'border-primary-500 bg-primary-50/50 ring-2 ring-primary-200 shadow-lg'
                    : 'border-border hover:border-primary-300 hover:shadow'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-text truncate">{tpl.label}</div>
                    <div className="text-[11px] text-text-secondary mt-0.5">{tpl.mood}</div>
                    <div className="text-[10px] text-text-secondary/70 mt-1.5">{tpl.recommended}</div>
                  </div>
                  {selected && (
                    <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold bg-primary-500 text-white rounded-full">선택됨</span>
                  )}
                </div>
                {/* 팔레트 미리보기 */}
                <div className="flex gap-1 mt-3">
                  {tpl.palette.map((color, i) => (
                    <div
                      key={i}
                      className="flex-1 h-8 rounded-md border border-black/5"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 text-[11px] text-text-secondary">
          💡 템플릿을 선택하면 해당 성격/컬러로 AI가 자동 레이아웃 + 가격 강조 + 카테고리 배치를 완성합니다.
        </div>
      </SectionCard>

      {/* 이미지 자동 배경제거 옵션 */}
      <SectionCard title="AI 이미지 처리 옵션">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-bg border border-border hover:border-primary-300 transition">
          <input
            type="checkbox"
            checked={useAutoRembg}
            onChange={e => setUseAutoRembg(e.target.checked)}
            className="w-5 h-5 accent-primary-500"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-text">상품 이미지 자동 배경제거</div>
            <div className="text-[11px] text-text-secondary mt-0.5">
              업로드한 상품 이미지의 배경을 AI가 자동으로 제거합니다 (rembg). 깔끔한 인쇄 품질 보장.
            </div>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-green-100 text-green-700 font-bold">추천</span>
        </label>
      </SectionCard>

      {/* 매장 헤더 미리보기 */}
      <SectionCard title="매장 정보 (전단 상단)">
        <div className="grid grid-cols-3 gap-4 p-4 bg-bg rounded-xl border border-border">
          <div className="text-center p-4 border border-dashed border-border rounded-lg">
            <div className="text-xs text-text-secondary mb-2">마트 로고 및 주소</div>
            <Input placeholder="매장명" value={store.storeName} onChange={e => setStore(s => ({ ...s, storeName: e.target.value }))} className="mb-2" />
            <Input placeholder="주소" value={store.address} onChange={e => setStore(s => ({ ...s, address: e.target.value }))} />
          </div>
          <div className="text-center p-4 border border-dashed border-border rounded-lg">
            <div className="text-xs text-text-secondary mb-2">매장 약도</div>
            <div className="text-xs text-text-secondary/50">(이미지 업로드 예정)</div>
          </div>
          <div className="text-center p-4 border border-dashed border-border rounded-lg">
            <div className="text-xs text-text-secondary mb-2">전화번호 및 QR</div>
            <Input placeholder="전화번호" value={store.phone} onChange={e => setStore(s => ({ ...s, phone: e.target.value }))} className="mb-2" />
            <Input placeholder="영업시간" value={store.hours} onChange={e => setStore(s => ({ ...s, hours: e.target.value }))} />
          </div>
        </div>
      </SectionCard>

      {/* 카테고리별 상품 그리드 */}
      {categories.map(cat => (
        <SectionCard
          key={cat.id}
          title={cat.name}
          action={
            <div className="flex items-center gap-2">
              <button onClick={() => renameCat(cat.id)} className="text-xs text-text-secondary hover:text-text">이름변경</button>
              <button onClick={() => removeCategory(cat.id)} className="text-xs text-error-500 hover:text-error-600">삭제</button>
            </div>
          }
        >
          <div className="grid grid-cols-4 gap-3">
            {/* 기존 상품들 */}
            {cat.items.map(item => (
              <div key={item.id} className="relative group border border-border rounded-xl overflow-hidden bg-bg hover:border-primary-300 transition">
                {/* 이미지 영역 */}
                <div className="aspect-square bg-surface flex items-center justify-center overflow-hidden">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-3xl opacity-20">📦</div>
                  )}
                </div>
                {/* 정보 */}
                <div className="p-2.5">
                  <div className="text-xs font-semibold text-text truncate">{item.name}</div>
                  {item.unit && <div className="text-[10px] text-text-secondary">{item.unit}</div>}
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-sm font-bold text-primary-600">{item.price.toLocaleString()}원</span>
                    {item.originalPrice > 0 && item.originalPrice !== item.price && (
                      <span className="text-[10px] text-text-secondary line-through">{item.originalPrice.toLocaleString()}원</span>
                    )}
                  </div>
                  {item.originalPrice > 0 && item.originalPrice !== item.price && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-bold bg-error-500 text-white rounded">
                      {Math.round((1 - item.price / item.originalPrice) * 100)}% OFF
                    </span>
                  )}
                </div>
                {/* 삭제 버튼 */}
                <button
                  onClick={() => removeProduct(cat.id, item.id)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-error-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                >x</button>
              </div>
            ))}

            {/* + 상품 추가 버튼 */}
            <button
              onClick={() => openAddModal(cat.id)}
              className="aspect-square border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary-400 hover:bg-primary-50/30 transition cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-light group-hover:bg-primary-200 transition">+</div>
              <span className="text-xs text-text-secondary group-hover:text-primary-600">상품 추가</span>
            </button>
          </div>
        </SectionCard>
      ))}

      {/* 카테고리 추가 */}
      <button
        onClick={addCategory}
        className="w-full py-4 border-2 border-dashed border-border rounded-xl text-sm text-text-secondary hover:border-primary-400 hover:text-primary-600 transition"
      >
        + 카테고리 추가
      </button>

      {/* 하단 발행 버튼 2개 — ★ D129 V2 */}
      <div className="sticky bottom-0 bg-bg/80 backdrop-blur-sm border-t border-border py-4 -mx-6 px-6 flex items-center justify-between gap-3">
        <div className="text-sm text-text-secondary">
          {categories.length}개 카테고리 / <b className="text-text">{totalProducts}개</b> 상품
        </div>
        <div className="flex items-center gap-3">
          {/* 빠른확인 - PNG */}
          <button
            onClick={() => generate('png')}
            disabled={generating || totalProducts === 0}
            className="px-5 py-3 rounded-xl border-2 border-amber-400 bg-amber-50 text-amber-700 text-sm font-bold hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-2"
            title="확인용 PNG 이미지로 발행 (빠름, 뷰어에서 즉시 열림)"
          >
            <span className="text-base">🖼</span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[10px] font-semibold text-amber-600">빠른확인</span>
              <span>{generatingFormat === 'png' ? '생성 중...' : 'PNG 발행'}</span>
            </span>
          </button>

          {/* 인쇄용 - PDF */}
          <button
            onClick={() => generate('pdf')}
            disabled={generating || totalProducts === 0}
            className="px-5 py-3 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-2 shadow-md"
            title="인쇄업체 제출용 PDF로 발행 (벡터, 고품질)"
          >
            <span className="text-base">📄</span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[10px] font-semibold text-primary-100">인쇄용</span>
              <span>{generatingFormat === 'pdf' ? '생성 중...' : 'PDF 발행'}</span>
            </span>
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 상품 추가 모달 */}
      {/* ============================================================ */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-text">상품 추가 — {categories.find(c => c.id === addTargetCatId)?.name}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-text-secondary hover:text-text text-lg">&times;</button>
            </div>

            {/* 본문 */}
            <div className="p-6 overflow-y-auto space-y-4">
              {/* 상품명 + 이미지 검색 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">상품명 *</label>
                <div className="flex gap-2">
                  <Input
                    value={addForm.name}
                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="예: 한우 등심 1++"
                    className="flex-1"
                    onKeyDown={e => e.key === 'Enter' && searchProductImage()}
                  />
                  <Button size="sm" variant="secondary" onClick={searchProductImage} disabled={searchLoading}>
                    {searchLoading ? '검색...' : '이미지 검색'}
                  </Button>
                </div>
              </div>

              {/* 이미지 검색 결과 */}
              {searchImages.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-2">이미지 선택 (클릭)</label>
                  <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                    {searchImages.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => { setSelectedImage(img.image); setAddForm(f => ({ ...f, imageUrl: img.image })); }}
                        className={`aspect-square rounded-lg overflow-hidden border-2 transition ${
                          selectedImage === img.image ? 'border-primary-500 ring-2 ring-primary-200' : 'border-border hover:border-primary-300'
                        }`}
                      >
                        <img src={img.image} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 선택된 이미지 + 직접 업로드 */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-xl border border-border overflow-hidden bg-bg flex items-center justify-center shrink-0">
                  {selectedImage ? (
                    <img src={selectedImage} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl opacity-20">📷</span>
                  )}
                </div>
                <div className="flex-1">
                  <button
                    onClick={() => imageUploadRef.current?.click()}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                  >직접 이미지 업로드</button>
                  <input ref={imageUploadRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  {selectedImage && (
                    <button
                      onClick={() => { setSelectedImage(''); setAddForm(f => ({ ...f, imageUrl: '' })); }}
                      className="block text-xs text-error-500 mt-1"
                    >이미지 제거</button>
                  )}
                </div>
              </div>

              {/* 가격 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">판매가 *</label>
                  <Input type="number" value={addForm.price} onChange={e => setAddForm(f => ({ ...f, price: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">원가 (할인 표시용)</label>
                  <Input type="number" value={addForm.originalPrice} onChange={e => setAddForm(f => ({ ...f, originalPrice: e.target.value }))} placeholder="0" />
                </div>
              </div>

              {/* 단위 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">단위/규격</label>
                <Input value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))} placeholder="예: 100g, 1팩, 1kg" />
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
              <Button variant="secondary" onClick={() => setShowAddModal(false)}>취소</Button>
              <Button onClick={confirmAddProduct}>추가</Button>
            </div>
          </div>
        </div>
      )}

      {/* 알림 모달 */}
      <AlertModal
        alert={alert}
        onClose={() => setAlert(a => ({ ...a, show: false }))}
      />

      {/* ★ D129: 인쇄전단 삭제 확인 모달 */}
      <ConfirmModal
        show={deleteModal.show}
        icon="🗑️"
        title="인쇄전단 삭제"
        message={`"${deleteModal.title}"을(를) 삭제하시겠습니까?\nPDF/PNG 파일도 함께 삭제됩니다.`}
        danger
        confirmLabel="삭제"
        onConfirm={() => handleDeleteFlyer(deleteModal.id)}
        onCancel={() => setDeleteModal({ show: false, id: '', title: '' })}
      />

      {/* 엑셀 업로드 + AI 매핑 모달 */}
      <ExcelUploadModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        onComplete={handleExcelComplete}
      />
    </div>
  );
}
