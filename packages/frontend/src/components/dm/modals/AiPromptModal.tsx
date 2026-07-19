/**
 * AiPromptModal — ★ 2026-07-16 M4 "AI 브리프 입력기" 전면 재작성 (설계서 §2-1)
 *
 * 옛 2단계(parse-prompt → recommend-layout, 카피 없음)를 폐기하고 one-shot 통합 생성으로 교체.
 * 입력 3종(한 화면): 행사 내용 붙여넣기(8,000자) · 이미지 판독(포스터/상품 스샷 → 텍스트 전사) ·
 * URL 가져오기(페이지 본문 수집). 셋 다 같은 입력칸에 합쳐져 사용자가 눈으로 확인·보정 후 생성.
 *
 * 생성 결과에는 반영 커버리지(missing)가 함께 온다 — 원문 중 미반영 항목을 숨기지 않고 표시(설계서 §2-4).
 */
import { useRef, useState } from 'react';
import axios from 'axios';
import type { Section } from '../../../utils/dm-section-defaults';
import { SECTION_META } from '../../../utils/dm-section-defaults';
import { useDmBuilderStore, type LayoutMode } from '../../../stores/dmBuilderStore';
import ModalBase, { ModalButton } from './ModalBase';
import { downscaleToJpeg } from '../../../utils/image-downscale';
// 고객 데이터 없으면 AI 문안 생성 전 차단 안내 (공용 게이트 — 모달만, 다크 오버레이)
import { useCustomerDataGate, CustomerDataRequiredModal } from '../../CustomerDataGate';
// ★ 2026-07-19 P4: 라이브러리 소재로 이미지 판독 (직접 업로드와 동일 흐름 — File 변환 후 판독)
import AssetLibraryPickerModal from '../../assets/AssetLibraryPickerModal';
import { assetsToFiles } from '../../../lib/asset-to-file';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

const EVENT_TEXT_MAX = 8000;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Step = 'input' | 'generating' | 'preview';

interface CoverageItem { kind: string; label: string; }

export default function AiPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const applyAiGenerated = useDmBuilderStore((s) => s.applyAiGenerated);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [eventText, setEventText] = useState('');
  const [extraPrompt, setExtraPrompt] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);
  const [imgExtracting, setImgExtracting] = useState(false);
  const [libOpen, setLibOpen] = useState(false); // ★ P4: 라이브러리에서 선택 분기
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sections: Section[];
    pages?: Section[][];
    layoutMode?: LayoutMode;
    brandKit?: any;
    spec?: any;
    coverage?: { missing: CoverageItem[] } | null;
    brief?: any;
  } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const customerGate = useCustomerDataGate(localStorage.getItem('token'));
  const [showDataGate, setShowDataGate] = useState(false);

  const reset = () => {
    setEventText(''); setExtraPrompt(''); setUrlInput('');
    setStep('input'); setResult(null); setError(null);
  };
  const handleClose = () => { reset(); onClose(); };

  const appendText = (t: string) => {
    setEventText((prev) => [prev.trim(), t.trim()].filter(Boolean).join('\n\n').slice(0, EVENT_TEXT_MAX));
  };

  // ── 이미지 판독 (기존 행사 캠페인 판독 파이프라인 재사용 — 3크레딧) ──
  const handleImages = async (files: FileList | null) => {
    const picked = Array.from(files || []).filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type) && f.size <= 5 * 1024 * 1024).slice(0, 5);
    if (!picked.length || imgExtracting) return;
    setImgExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      for (let i = 0; i < picked.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await downscaleToJpeg(picked[i]);
        fd.append('images', blob, `shot_${i + 1}.jpg`);
      }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/event-campaigns/extract-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }, // multipart — Content-Type 자동
        body: fd,
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '이미지 판독 실패'));
      appendText(String(data.event_text || ''));
      setToast({ type: 'success', message: '이미지에서 행사 내용을 읽어왔어요 — 내용을 확인·보정해주세요.' });
    } catch (e: any) {
      setError(e?.message || '이미지 판독 실패');
    } finally {
      setImgExtracting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── URL 본문 가져오기 ──
  const handleFetchUrl = async () => {
    const url = urlInput.trim();
    if (!url || urlFetching) return;
    setUrlFetching(true);
    setError(null);
    try {
      const res = await api.post('/dm/ai/event-text-from-url', { url });
      if (!res.data?.success) throw new Error(res.data?.error || 'URL 수집 실패');
      appendText(String(res.data.text || ''));
      setUrlInput('');
      setToast({ type: 'success', message: '페이지 내용을 가져왔어요 — 내용을 확인·보정해주세요.' });
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'URL 수집 실패');
    } finally {
      setUrlFetching(false);
    }
  };

  // ── 생성 (one-shot — 행사 원문 직투입 + 커버리지) ──
  const handleGenerate = async () => {
    if (customerGate.isEmpty) { setShowDataGate(true); onClose(); return; }
    if (!eventText.trim() && !extraPrompt.trim()) {
      setError('행사 내용을 붙여넣거나, 만들 내용을 한 줄이라도 적어주세요.');
      return;
    }
    setError(null);
    setStep('generating');
    try {
      const res = await api.post('/dm/ai/one-shot-generate', {
        prompt: extraPrompt.trim(),
        event_text: eventText.trim() || undefined,
      });
      if (!res.data?.success) throw new Error(res.data?.error || 'AI 생성 실패');
      const d = res.data.data || {};
      setResult({
        sections: d.sections || [],
        pages: d.pages,
        layoutMode: d.layout_mode,
        brandKit: d.brand_kit,
        spec: d.spec,
        coverage: d.coverage || null,
        brief: d.brief || null,
      });
      setStep('preview');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '생성 실패');
      setStep('input');
    }
  };

  const handleApply = () => {
    if (!result || result.sections.length === 0) return;
    applyAiGenerated(result.sections, result.brandKit, extraPrompt || eventText.slice(0, 200), {
      pages: result.pages,
      layoutMode: result.layoutMode,
    });
    setToast({ type: 'success', message: 'AI가 만든 DM을 적용했어요 — 캔버스에서 바로 다듬을 수 있어요.' });
    handleClose();
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={handleClose}>닫기</ModalButton>
      {step === 'preview' ? (
        <>
          <ModalButton variant="secondary" onClick={() => setStep('input')}>다시 작성</ModalButton>
          <ModalButton variant="primary" onClick={handleApply}>
            적용하기 ({result?.sections.length || 0}개 섹션{result?.pages && result.pages.length > 1 ? ` · ${result.pages.length}장` : ''})
          </ModalButton>
        </>
      ) : (
        <ModalButton
          variant="primary"
          onClick={handleGenerate}
          loading={step === 'generating'}
          disabled={(!eventText.trim() && !extraPrompt.trim()) || step === 'generating'}
        >
          ⚡ DM 만들기 (3크레딧)
        </ModalButton>
      )}
    </>
  );

  return (
    <>
    <ModalBase
      open={open}
      onClose={handleClose}
      size="lg"
      title="AI로 만들기"
      subtitle="행사 내용을 통째로 붙여넣으면 — 기간·혜택·상품·유의사항까지 자리 잡은 DM이 나와요."
      footer={footer}
    >
      {step !== 'preview' && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            행사 내용 (그대로 붙여넣기)
          </label>
          <textarea
            value={eventText}
            onChange={(e) => setEventText(e.target.value.slice(0, EVENT_TEXT_MAX))}
            placeholder={'예)\n프리미엄 수분 세럼 30ml\n85,000원 → 15% 72,250원\nhttps://brand.naver.com/...\n\n세럼 구매 시 한정판 파우치 증정\n한정 수량 — 조기 소진 가능'}
            rows={9}
            style={{
              width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: 12,
              fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.55, outline: 'none',
            }}
            disabled={step === 'generating'}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>상품 줄에 링크를 함께 붙여넣으면 이미지·가격까지 자동으로 붙어요.</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{eventText.length.toLocaleString()} / {EVENT_TEXT_MAX.toLocaleString()}</span>
          </div>

          {/* 입력 보조 — 이미지 판독 · URL 가져오기 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={fileRef} type="file" accept={ALLOWED_IMAGE_TYPES.join(',')} multiple style={{ display: 'none' }}
              onChange={(e) => handleImages(e.target.files)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={imgExtracting || step === 'generating'}
              style={helperBtnStyle}
            >
              {imgExtracting ? '이미지 읽는 중...' : '🖼 이미지로 채우기 (3크레딧)'}
            </button>
            <button
              type="button"
              onClick={() => setLibOpen(true)}
              disabled={imgExtracting || step === 'generating'}
              style={helperBtnStyle}
            >
              🗂 라이브러리에서 (3크레딧)
            </button>
            <AssetLibraryPickerModal
              open={libOpen}
              onClose={() => setLibOpen(false)}
              multiSelect
              onPick={async (a) => {
                const fs = await assetsToFiles([a]);
                if (!fs.length) return;
                const dt = new DataTransfer();
                fs.forEach((f) => dt.items.add(f));
                handleImages(dt.files);
              }}
              onPickMany={async (assets) => {
                const fs = await assetsToFiles(assets);
                if (!fs.length) return;
                const dt = new DataTransfer();
                fs.forEach((f) => dt.items.add(f));
                handleImages(dt.files);
              }}
            />
            <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 240 }}>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="행사 페이지 URL"
                style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, outline: 'none' }}
                disabled={urlFetching || step === 'generating'}
              />
              <button type="button" onClick={handleFetchUrl} disabled={!urlInput.trim() || urlFetching || step === 'generating'} style={helperBtnStyle}>
                {urlFetching ? '가져오는 중...' : '가져오기'}
              </button>
            </div>
          </div>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', margin: '14px 0 6px' }}>
            추가 요청 (선택)
          </label>
          <input
            type="text"
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            placeholder="예) 20대 여성 대상, 고급스러운 톤으로"
            style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none' }}
            disabled={step === 'generating'}
          />

          {error && (
            <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', color: '#991b1b', fontSize: 13, borderRadius: 6 }}>
              {error}
            </div>
          )}

          {step === 'generating' && (
            <div style={{ marginTop: 16, padding: 16, background: '#f9fafb', borderRadius: 8, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>행사 내용을 이해하고 DM을 만들고 있어요...</div>
              <div style={{ fontSize: 11 }}>상품·혜택·기간을 자리에 배치하는 중 — 보통 15~30초 걸려요.</div>
            </div>
          )}
        </>
      )}

      {step === 'preview' && result && (
        <PreviewPanel result={result} />
      )}
    </ModalBase>
    <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />
    </>
  );
}

const helperBtnStyle: React.CSSProperties = {
  padding: '7px 12px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8,
  cursor: 'pointer', color: '#374151', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
};

const COVERAGE_KIND_LABEL: Record<string, string> = {
  event_name: '행사명', benefit: '혜택', product: '상품', period: '기간', notice: '유의사항', link: '링크',
};

function PreviewPanel({ result }: {
  result: { sections: Section[]; pages?: Section[][]; layoutMode?: LayoutMode; spec?: any; coverage?: { missing: { kind: string; label: string }[] } | null; brief?: any };
}) {
  const missing = result.coverage?.missing || [];
  const brief = result.brief;
  return (
    <div>
      {/* 브리프 요약 — AI가 원문에서 무엇을 읽었는지 */}
      {brief && (
        <div style={{ marginBottom: 12, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12.5, color: '#166534' }}>
          원문에서 읽어낸 것 —
          {brief.event_name ? ` 행사명 1` : ''}
          {Array.isArray(brief.products) && brief.products.length > 0 ? ` · 상품 ${brief.products.length}개` : ''}
          {Array.isArray(brief.benefits) && brief.benefits.length > 0 ? ` · 혜택 ${brief.benefits.length}건` : ''}
          {brief.period_raw ? ` · 기간` : ''}
          {Array.isArray(brief.notices) && brief.notices.length > 0 ? ` · 유의사항 ${brief.notices.length}건` : ''}
          {Array.isArray(brief.links) && brief.links.length > 0 ? ` · 링크 ${brief.links.length}개` : ''}
        </div>
      )}

      {/* ★ 반영 커버리지 — 미반영 항목을 숨기지 않는다 (설계서 §2-4) */}
      {missing.length > 0 && (
        <div style={{ marginBottom: 12, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
            원문 중 아직 반영하지 못한 항목 — 적용 후 직접 확인해주세요
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#92400e', lineHeight: 1.7 }}>
            {missing.slice(0, 8).map((m, i) => (
              <li key={i}>[{COVERAGE_KIND_LABEL[m.kind] || m.kind}] {m.label}</li>
            ))}
            {/* ★ Codex 1R — 8건 초과분 은닉 금지: 숨겨진 개수 명시 (커버리지 보고의 정직성) */}
            {missing.length > 8 && <li>외 {missing.length - 8}건 더 — 적용 후 본문에서 확인해주세요</li>}
          </ul>
        </div>
      )}

      {result.spec && (
        <div style={{ marginBottom: 12, padding: 12, background: '#f3f4f6', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
            <span style={{ color: '#6b7280' }}>구성</span>
            <span>{result.layoutMode === 'slides' ? `슬라이드 ${result.pages?.length || 1}장` : '긴 스크롤'}</span>
            <span style={{ color: '#6b7280' }}>톤</span><span>{result.spec.tone || '—'}</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
        구성 섹션 ({result.sections.length}개)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
        {result.sections.map((s, i) => (
          <div key={s.id} style={{ padding: '8px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#eef2ff', color: '#4f46e5', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#374151', flexShrink: 0 }}>
              {SECTION_META[s.type]?.label || s.type}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {previewText(s)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function previewText(s: Section): string {
  const p = s.props as any;
  return (p.headline || p.title || p.discount_label || p.urgency_text || p.body || '').toString().slice(0, 42);
}
