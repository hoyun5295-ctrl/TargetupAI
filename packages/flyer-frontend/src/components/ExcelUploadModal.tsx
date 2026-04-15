/**
 * ★ 전단AI 공용 엑셀 업로드 + AI 매핑 모달
 *
 * 사용처: FlyerPage, PopPage, PrintFlyerPage
 * CT-F24 API 연동: upload-excel → AI 매핑 → 매핑 수정 → 확정
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   onComplete: (products: MappedProduct[]) => void
 */

import { useState, useRef } from 'react';
import { API_BASE, apiFetch } from '../App';
import { Button } from './ui';

export interface MappedProduct {
  productName: string;
  salePrice: number;
  originalPrice: number;
  unit: string;
  category: string;
  promoType: 'main' | 'sub' | 'general';
  origin: string;
  imageUrl: string;
}

interface MappingField {
  fieldKey: string;
  displayName: string;
  description: string;
  required: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (products: MappedProduct[]) => void;
}

type Step = 'upload' | 'mapping' | 'preview';

export default function ExcelUploadModal({ isOpen, onClose, onComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  // 단계
  const [step, setStep] = useState<Step>('upload');

  // 업로드 상태
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // 매핑 데이터
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [fields, setFields] = useState<MappingField[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  // 결과
  const [products, setProducts] = useState<MappedProduct[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  // ============================================================
  // Step 1: 엑셀 업로드 + AI 매핑
  // ============================================================
  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/upload-excel`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '업로드 실패' }));
        throw new Error(err.error || '업로드 실패');
      }

      const data = await res.json();
      setHeaders(data.headers || []);
      setMapping(data.mapping || {});
      setFields(data.fields || []);
      setPreview(data.preview || []);
      setTotalRows(data.totalRows || 0);
      setStep('mapping');
    } catch (err: any) {
      setError(err.message || '엑셀 처리에 실패했습니다');
    }
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileSelect(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  // ============================================================
  // Step 2: 매핑 수정
  // ============================================================
  const updateMapping = (header: string, value: string) => {
    setMapping(prev => ({ ...prev, [header]: value || null }));
  };

  const hasProductName = Object.values(mapping).includes('product_name');
  const hasSalePrice = Object.values(mapping).includes('sale_price');

  // ============================================================
  // Step 3: 매핑 적용
  // ============================================================
  const applyMapping = async () => {
    if (!file) return;
    setApplying(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));

      const res = await apiFetch(`${API_BASE}/api/flyer/flyers/apply-excel-mapping`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '매핑 적용 실패' }));
        throw new Error(err.error);
      }

      const data = await res.json();
      setProducts(data.products || []);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || '매핑 적용 실패');
    }
    setApplying(false);
  };

  // ============================================================
  // 완료
  // ============================================================
  const handleComplete = () => {
    onComplete(products);
    // 초기화
    setStep('upload');
    setHeaders([]);
    setMapping({});
    setPreview([]);
    setProducts([]);
    setFile(null);
    setError('');
    onClose();
  };

  // ============================================================
  // 렌더링
  // ============================================================
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-bold text-text">
              {step === 'upload' && '엑셀 파일 업로드'}
              {step === 'mapping' && 'AI 필드 매핑'}
              {step === 'preview' && '매핑 결과 확인'}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              {step === 'upload' && '.xlsx, .xls, .csv 파일을 업로드하세요'}
              {step === 'mapping' && `${totalRows}개 행 감지 — AI가 자동 매핑했습니다. 수정 후 확정하세요.`}
              {step === 'preview' && `${products.length}개 상품이 변환되었습니다.`}
            </p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text text-lg">&times;</button>
        </div>

        {/* 본문 */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* 에러 */}
          {error && (
            <div className="mb-4 p-3 bg-error-50 border border-error-200 rounded-xl text-sm text-error-600">{error}</div>
          )}

          {/* Step 1: 업로드 */}
          {step === 'upload' && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition ${
                dragOver ? 'border-primary-400 bg-primary-50/30' : 'border-border hover:border-primary-300'
              }`}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleInputChange} />
              {uploading ? (
                <div>
                  <div className="text-2xl mb-3 animate-spin">&#9881;</div>
                  <p className="text-sm text-text-secondary">AI가 분석 중...</p>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-4 opacity-30">&#128196;</div>
                  <p className="text-sm font-medium text-text mb-1">파일을 드래그하거나 클릭하세요</p>
                  <p className="text-xs text-text-secondary">.xlsx, .xls, .csv 지원 (최대 10MB)</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: 매핑 */}
          {step === 'mapping' && (
            <div className="space-y-3">
              {headers.map(header => (
                <div key={header} className="flex items-center gap-4 p-3 bg-bg rounded-xl">
                  <div className="w-1/3 text-sm font-medium text-text truncate" title={header}>{header}</div>
                  <div className="text-text-secondary">&rarr;</div>
                  <div className="flex-1">
                    <select
                      value={mapping[header] || ''}
                      onChange={e => updateMapping(header, e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface"
                    >
                      <option value="">매핑 안 함</option>
                      {fields.map(f => (
                        <option key={f.fieldKey} value={f.fieldKey}>
                          {f.displayName} {f.required ? '(필수)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}

              {/* 미리보기 테이블 */}
              {preview.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-medium text-text-secondary mb-2">미리보기 (상위 5행)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-bg">
                          {headers.map(h => <th key={h} className="px-2 py-1.5 text-left font-medium text-text-secondary truncate max-w-[120px]">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={i} className="border-t border-border">
                            {headers.map(h => <td key={h} className="px-2 py-1.5 text-text truncate max-w-[120px]">{String(row[h] ?? '')}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: 결과 확인 */}
          {step === 'preview' && (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg text-text-secondary">
                      <th className="px-3 py-2 text-left font-medium">상품명</th>
                      <th className="px-3 py-2 text-right font-medium">판매가</th>
                      <th className="px-3 py-2 text-right font-medium">원가</th>
                      <th className="px-3 py-2 text-left font-medium">단위</th>
                      <th className="px-3 py-2 text-left font-medium">카테고리</th>
                      <th className="px-3 py-2 text-center font-medium">행사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 20).map((p, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-text">{p.productName}</td>
                        <td className="px-3 py-2 text-right text-primary-600 font-bold">{p.salePrice.toLocaleString()}원</td>
                        <td className="px-3 py-2 text-right text-text-secondary">{p.originalPrice > 0 ? `${p.originalPrice.toLocaleString()}원` : '-'}</td>
                        <td className="px-3 py-2 text-text-secondary">{p.unit || '-'}</td>
                        <td className="px-3 py-2 text-text-secondary">{p.category}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            p.promoType === 'main' ? 'bg-error-100 text-error-600'
                            : p.promoType === 'sub' ? 'bg-primary-100 text-primary-600'
                            : 'bg-bg text-text-secondary'
                          }`}>
                            {p.promoType === 'main' ? '메인' : p.promoType === 'sub' ? '서브' : '일반'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {products.length > 20 && (
                <p className="text-xs text-text-secondary mt-2 text-center">외 {products.length - 20}개 상품 더 있음</p>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="px-6 py-4 border-t border-border flex justify-between items-center shrink-0">
          <div>
            {step !== 'upload' && (
              <Button variant="ghost" onClick={() => setStep(step === 'preview' ? 'mapping' : 'upload')}>
                &larr; 이전
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>취소</Button>
            {step === 'mapping' && (
              <Button
                onClick={applyMapping}
                disabled={!hasProductName || !hasSalePrice || applying}
              >
                {applying ? 'AI 변환 중...' : '매핑 확정'}
              </Button>
            )}
            {step === 'preview' && (
              <Button onClick={handleComplete}>
                {products.length}개 상품 추가
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
