/**
 * 전단AI 인쇄 전단 생성 페이지
 *
 * 기능:
 *   - CSV 파일 업로드 (드래그&드롭 + 클릭)
 *   - 기본 설정 폼 (제목, 기간, 용지, 테마)
 *   - 상품 목록 편집 (행사구분/상품명/원가/할인가/단위/카테고리)
 *   - 인쇄 전단 생성 → PDF 다운로드
 *
 * API: POST /api/flyer/flyers/print-flyer
 */

import { useState, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input, Select } from '../components/ui';
import AlertModal from '../components/AlertModal';

interface Product {
  id: string;
  eventType: string;   // 메인/서브/일반
  name: string;
  price: string;       // 할인가(판매가)
  originalPrice: string; // 원가
  unit: string;
  category: string;
}

const PAPER_SIZES = [
  { value: 'A4', label: 'A4 (210x297mm)' },
  { value: 'B4', label: 'B4 (257x364mm)' },
  { value: 'tabloid', label: '타블로이드 (279x432mm)' },
];

const THEMES = [
  { value: 'fresh_green', label: '신선한 그린' },
  { value: 'warm_orange', label: '따뜻한 오렌지' },
  { value: 'cool_blue', label: '시원한 블루' },
  { value: 'premium_dark', label: '프리미엄 다크' },
];

const EVENT_TYPES = [
  { value: '메인', label: '메인' },
  { value: '서브', label: '서브' },
  { value: '일반', label: '일반' },
];

let productIdCounter = 0;
function genId() {
  productIdCounter += 1;
  return `p_${Date.now()}_${productIdCounter}`;
}

/** CSV 텍스트를 Product[] 배열로 변환 */
function parseCsv(text: string): Product[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // 첫 행은 헤더 — 건너뜀
  const dataLines = lines.slice(1);
  return dataLines.map(line => {
    const cols = line.split(',').map(c => c.trim());
    return {
      id: genId(),
      eventType: cols[0] || '일반',
      name: cols[1] || '',
      price: cols[2] || '',
      originalPrice: cols[3] || '',
      unit: cols[4] || '',
      category: cols[5] || '',
    };
  }).filter(p => p.name); // 상품명 없는 행 제외
}

export default function PrintFlyerPage({ token: _token }: { token: string }) {
  // 기본 설정
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [paperSize, setPaperSize] = useState('A4');
  const [theme, setTheme] = useState('fresh_green');

  // 상품 목록
  const [products, setProducts] = useState<Product[]>([]);

  // 파일 업로드 상태
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');

  // 생성 상태
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [flyerId, setFlyerId] = useState('');

  // 알림
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    show: false, title: '', message: '', type: 'info',
  });

  // ────── CSV 파일 처리 ──────
  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setAlert({ show: true, title: '파일 오류', message: 'CSV 파일만 업로드 가능합니다.', type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setAlert({ show: true, title: '파싱 오류', message: 'CSV에서 상품 데이터를 찾을 수 없습니다.\n포맷: 행사구분,상품명,가격,원가,단위,카테고리', type: 'error' });
        return;
      }
      setProducts(parsed);
      setFileName(file.name);
      setPdfUrl('');
      setFlyerId('');
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }, [handleFile]);

  // ────── 상품 편집 ──────
  const updateProduct = useCallback((id: string, field: keyof Product, value: string) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }, []);

  const removeProduct = useCallback((id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

  // ────── 인쇄 전단 생성 ──────
  const handleGenerate = async () => {
    if (!title.trim()) {
      setAlert({ show: true, title: '입력 오류', message: '전단 제목을 입력해주세요.', type: 'error' });
      return;
    }
    if (!periodStart || !periodEnd) {
      setAlert({ show: true, title: '입력 오류', message: '행사 기간을 설정해주세요.', type: 'error' });
      return;
    }
    if (products.length === 0) {
      setAlert({ show: true, title: '입력 오류', message: 'CSV 파일을 업로드하여 상품을 추가해주세요.', type: 'error' });
      return;
    }

    setGenerating(true);
    setPdfUrl('');
    setFlyerId('');

    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/print-flyer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          period: { start: periodStart, end: periodEnd },
          products: products.map(p => ({
            eventType: p.eventType,
            name: p.name,
            price: p.price,
            originalPrice: p.originalPrice,
            unit: p.unit,
            category: p.category,
          })),
          paperSize,
          theme,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPdfUrl(data.pdfUrl || '');
        setFlyerId(data.flyerId || '');
        setAlert({ show: true, title: '생성 완료', message: '인쇄 전단이 생성되었습니다.\nPDF를 다운로드하세요.', type: 'success' });
      } else {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        setAlert({ show: true, title: '생성 실패', message: err.error || '오류가 발생했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  // ────── 렌더링 ──────
  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">인쇄 전단 생성</h2>
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            PDF 다운로드
          </a>
        )}
      </div>

      {/* CSV 업로드 영역 */}
      <SectionCard title="상품 데이터 업로드">
        <div
          className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
            ${dragOver
              ? 'border-primary-500 bg-primary-500/10'
              : fileName
                ? 'border-success-500/50 bg-success-500/5'
                : 'border-border hover:border-text-muted'
            }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('csv-file-input')?.click()}
        >
          <input
            id="csv-file-input"
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileInput}
          />
          {fileName ? (
            <div>
              <p className="text-3xl mb-2">📄</p>
              <p className="text-sm font-semibold text-text">{fileName}</p>
              <p className="text-xs text-text-secondary mt-1">{products.length}개 상품 로드됨 &#183; 클릭하여 다시 업로드</p>
            </div>
          ) : (
            <div>
              <p className="text-3xl mb-2">📁</p>
              <p className="text-sm text-text-secondary mb-1">CSV 파일을 드래그하거나 클릭하여 업로드</p>
              <p className="text-xs text-text-muted">포맷: 행사구분, 상품명, 가격, 원가, 단위, 카테고리</p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* 기본 설정 */}
      <SectionCard title="기본 설정">
        <div className="space-y-4">
          <Input
            label="전단 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 4월 신선식품 대특가"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="행사 시작일"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
            <Input
              label="행사 종료일"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="용지 크기"
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
            >
              {PAPER_SIZES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>

            <Select
              label="테마"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              {THEMES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </SectionCard>

      {/* 상품 목록 편집 */}
      {products.length > 0 && (
        <SectionCard
          title={`상품 목록 (${products.length}개)`}
          action={
            <span className="text-xs text-text-muted">행사구분을 변경하거나 불필요한 상품을 삭제하세요</span>
          }
        >
          {/* 데스크톱: 테이블 */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">행사구분</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">상품명</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">원가</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary">할인가</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">단위</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">카테고리</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, idx) => (
                  <tr
                    key={p.id}
                    className={`border-b border-border/30 transition-colors hover:bg-bg/50 ${
                      idx % 2 === 0 ? '' : 'bg-bg/20'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <select
                        className="bg-surface-secondary border border-border rounded-lg px-2 py-1 text-sm text-text w-20"
                        value={p.eventType}
                        onChange={(e) => updateProduct(p.id, 'eventType', e.target.value)}
                      >
                        {EVENT_TYPES.map(et => (
                          <option key={et.value} value={et.value}>{et.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-text font-medium">{p.name}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.originalPrice ? (
                        <span className="text-text-muted line-through">{Number(p.originalPrice).toLocaleString()}원</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-primary-600 font-bold">
                        {p.price ? `${Number(p.price).toLocaleString()}원` : '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{p.unit || '-'}</td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 bg-bg rounded-full text-xs text-text-secondary">{p.category || '-'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="text-text-muted hover:text-error-500 transition-colors text-sm"
                        onClick={() => removeProduct(p.id)}
                        title="삭제"
                      >
                        &#10005;
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일: 카드형 */}
          <div className="sm:hidden space-y-3">
            {products.map(p => (
              <div key={p.id} className="bg-surface-secondary rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <span className="text-text font-semibold">{p.name}</span>
                    <span className="ml-2 px-2 py-0.5 bg-bg rounded-full text-xs text-text-secondary">{p.category || '-'}</span>
                  </div>
                  <button
                    className="text-text-muted hover:text-error-500 transition-colors text-sm ml-2"
                    onClick={() => removeProduct(p.id)}
                  >
                    &#10005;
                  </button>
                </div>
                <div className="flex items-center gap-3 text-sm mb-2">
                  {p.originalPrice && (
                    <span className="text-text-muted line-through">{Number(p.originalPrice).toLocaleString()}원</span>
                  )}
                  <span className="text-primary-600 font-bold">
                    {p.price ? `${Number(p.price).toLocaleString()}원` : '-'}
                  </span>
                  {p.unit && <span className="text-text-muted">/ {p.unit}</span>}
                </div>
                <select
                  className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text"
                  value={p.eventType}
                  onChange={(e) => updateProduct(p.id, 'eventType', e.target.value)}
                >
                  {EVENT_TYPES.map(et => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 빈 상태 */}
      {products.length === 0 && !fileName && (
        <SectionCard>
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🖨️</p>
            <p className="text-text-secondary mb-2">CSV 파일을 업로드하여 인쇄용 전단을 자동 생성하세요</p>
            <p className="text-xs text-text-muted">행사구분, 상품명, 가격, 원가, 단위, 카테고리 순서의 CSV 파일을 준비해주세요</p>
          </div>
        </SectionCard>
      )}

      {/* 생성 버튼 + PDF 다운로드 */}
      {products.length > 0 && (
        <div className="space-y-4">
          <Button
            className="w-full"
            size="lg"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? '전단 생성 중...' : '인쇄 전단 생성'}
          </Button>

          {pdfUrl && (
            <SectionCard>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">인쇄 전단이 준비되었습니다</p>
                  {flyerId && <p className="text-xs text-text-muted mt-0.5">ID: {flyerId}</p>}
                </div>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  PDF 다운로드
                </a>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      <AlertModal
        alert={alert}
        onClose={() => setAlert({ ...alert, show: false })}
      />
    </div>
  );
}
