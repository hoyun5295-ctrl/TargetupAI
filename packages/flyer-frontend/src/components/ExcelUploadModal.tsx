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
              onDrop={uploading ? undefined : handleDrop}
              onClick={uploading ? undefined : () => fileRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl text-center transition overflow-hidden min-h-[280px] flex items-center justify-center ${
                uploading
                  ? 'border-primary-300 bg-gradient-to-br from-primary-50/60 via-surface to-primary-50/40 cursor-default'
                  : dragOver
                    ? 'border-primary-400 bg-primary-50/30 cursor-pointer'
                    : 'border-border hover:border-primary-300 cursor-pointer'
              }`}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleInputChange} />
              {uploading ? (
                <div className="w-full px-8 py-4 flex flex-col items-center gap-5">
                  {/* SVG 링 스피너 — transform-origin 고정으로 흔들림 제거 */}
                  <div className="relative w-16 h-16" aria-label="분석 중">
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 50 50">
                      <defs>
                        <linearGradient id="spinnerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="var(--color-primary-400, #a78bfa)" />
                          <stop offset="100%" stopColor="var(--color-primary-600, #7c3aed)" />
                        </linearGradient>
                      </defs>
                      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="3" className="text-primary-100" />
                      <circle
                        cx="25" cy="25" r="20"
                        fill="none" stroke="url(#spinnerGrad)" strokeWidth="3" strokeLinecap="round"
                        strokeDasharray="60 126"
                        style={{ transformOrigin: '50% 50%', animation: 'excel-spin 1s linear infinite' }}
                      />
                    </svg>
                    {/* 중앙 AI 뱃지 */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-[11px] font-bold text-primary-600 tracking-wider">AI</div>
                    </div>
                  </div>

                  {/* 타이틀 */}
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-text">AI가 엑셀을 분석하고 있습니다</p>
                    <p className="text-xs text-text-secondary">컬럼명을 자동으로 매핑하는 중… 잠시만 기다려주세요.</p>
                  </div>

                  {/* 단계 progress dots (3단계) */}
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-primary-600 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" style={{ animation: 'excel-dot 1.4s ease-in-out infinite' }} />
                      <span>파일 분석</span>
                    </div>
                    <span className="text-border">·</span>
                    <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-border" style={{ animation: 'excel-dot 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
                      <span>AI 매핑</span>
                    </div>
                    <span className="text-border">·</span>
                    <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-border" style={{ animation: 'excel-dot 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
                      <span>미리보기 생성</span>
                    </div>
                  </div>

                  {/* 진행바 (indeterminate) */}
                  <div className="w-3/4 h-1 bg-primary-100 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full w-1/3 bg-gradient-to-r from-primary-400 to-primary-600 rounded-full"
                      style={{ animation: 'excel-bar 1.6s ease-in-out infinite' }}
                    />
                  </div>
                </div>
              ) : (
                <div className="px-8 py-4">
                  <div className="mx-auto w-14 h-14 mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-primary-500" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-text mb-1">파일을 드래그하거나 클릭하세요</p>
                  <p className="text-xs text-text-secondary">.xlsx, .xls, .csv 지원 · 최대 10MB · AI가 자동으로 컬럼을 매핑합니다</p>
                </div>
              )}

              {/* 로컬 keyframes — 모달 내부에서만 동작 */}
              <style>{`
                @keyframes excel-spin { to { transform: rotate(360deg); } }
                @keyframes excel-dot { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
                @keyframes excel-bar {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(300%); }
                }
              `}</style>
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
