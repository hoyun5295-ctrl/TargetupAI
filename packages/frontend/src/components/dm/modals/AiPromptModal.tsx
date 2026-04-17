/**
 * AiPromptModal — 한 줄 프롬프트로 DM 초안 생성 (D126 V2)
 *
 * 흐름:
 *  1. 사용자가 프롬프트 입력 (예: "3월 봄세일, 20대 여성, 20% 할인쿠폰")
 *  2. POST /api/dm/ai/parse-prompt → CampaignSpec
 *  3. POST /api/dm/ai/recommend-layout → Section[]
 *  4. (선택) 섹션별 카피 자동 생성
 *  5. 사용자 확인 → applyAiGenerated(sections)
 */
import { useState } from 'react';
import axios from 'axios';
import type { Section } from '../../../utils/dm-section-defaults';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import ModalBase, { ModalButton } from './ModalBase';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

const PROMPT_EXAMPLES: string[] = [
  '3월 봄세일 20% 할인쿠폰, 20대 여성 대상, 이번 주말까지',
  'VIP 고객 감사 이벤트, 무료 선물 증정, 감성적인 톤',
  '신메뉴 출시 안내, 이번 주 방문 고객 음료 서비스',
  '블랙프라이데이 최대 70% 할인, 긴박감 있는 문구',
];

type Step = 'input' | 'generating' | 'preview';

export default function AiPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const applyAiGenerated = useDmBuilderStore((s) => s.applyAiGenerated);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [spec, setSpec] = useState<any | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPrompt('');
    setStep('input');
    setSpec(null);
    setSections([]);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('프롬프트를 입력해주세요.');
      return;
    }
    setError(null);
    setStep('generating');

    try {
      // 1. parse-prompt — 백엔드 응답: { spec: {...} } 또는 (폴백) 직접 spec
      const parseRes = await api.post('/dm/ai/parse-prompt', { prompt });
      const parsedSpec = parseRes.data?.spec ?? parseRes.data;
      if (!parsedSpec || typeof parsedSpec !== 'object') {
        throw new Error('AI 응답 형식이 올바르지 않아요.');
      }
      setSpec(parsedSpec);

      // 2. recommend-layout
      const layoutRes = await api.post('/dm/ai/recommend-layout', { spec: parsedSpec });
      const recSections: Section[] = layoutRes.data?.sections || [];
      setSections(recSections);

      setStep('preview');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '생성 실패');
      setStep('input');
    }
  };

  const handleApply = () => {
    if (sections.length === 0) return;
    applyAiGenerated(sections, undefined, prompt);
    setToast({ type: 'success', message: 'AI 초안을 적용했어요.' });
    handleClose();
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={handleClose}>닫기</ModalButton>
      {step === 'preview' ? (
        <>
          <ModalButton variant="secondary" onClick={() => setStep('input')}>다시 작성</ModalButton>
          <ModalButton variant="primary" onClick={handleApply}>
            ✨ 적용하기 ({sections.length}개 섹션)
          </ModalButton>
        </>
      ) : (
        <ModalButton
          variant="primary"
          onClick={handleGenerate}
          loading={step === 'generating'}
          disabled={!prompt.trim() || step === 'generating'}
        >
          ✨ AI 초안 생성
        </ModalButton>
      )}
    </>
  );

  return (
    <ModalBase
      open={open}
      onClose={handleClose}
      size="lg"
      title="AI 프롬프트로 초안 만들기"
      subtitle="한 줄로 설명하면 섹션 구조와 카피까지 AI가 만들어요."
      badge={<span style={{ fontSize: 10, padding: '2px 6px', background: '#eef2ff', color: '#4f46e5', borderRadius: 4, fontWeight: 700 }}>BETA</span>}
      footer={footer}
    >
      {step !== 'preview' && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            프롬프트
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="예) 3월 봄세일 20% 할인쿠폰, 20대 여성 대상, 이번 주말까지"
            rows={4}
            style={{
              width: '100%',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
              lineHeight: 1.5,
              outline: 'none',
            }}
            disabled={step === 'generating'}
          />

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>예시 프롬프트</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PROMPT_EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  style={{
                    fontSize: 12,
                    padding: '6px 10px',
                    background: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: '#374151',
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', color: '#991b1b', fontSize: 13, borderRadius: 6 }}>
              {error}
            </div>
          )}

          {step === 'generating' && (
            <div style={{ marginTop: 16, padding: 16, background: '#f9fafb', borderRadius: 8, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>AI가 초안을 준비하고 있어요...</div>
              <div style={{ fontSize: 11 }}>보통 5~10초 걸려요.</div>
            </div>
          )}
        </>
      )}

      {step === 'preview' && (
        <PreviewPanel spec={spec} sections={sections} />
      )}
    </ModalBase>
  );
}

function PreviewPanel({ spec, sections }: { spec: any; sections: Section[] }) {
  return (
    <div>
      {spec && (
        <div style={{ marginBottom: 16, padding: 12, background: '#f3f4f6', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginBottom: 6 }}>분석 결과</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
            <span style={{ color: '#6b7280' }}>목적</span><span>{spec.objective || '—'}</span>
            <span style={{ color: '#6b7280' }}>톤</span><span>{spec.tone || '—'}</span>
            <span style={{ color: '#6b7280' }}>업종</span><span>{spec.industry || '—'}</span>
            <span style={{ color: '#6b7280' }}>혜택</span><span>{spec.benefit ? `${spec.benefit.type} ${spec.benefit.value || ''}` : '—'}</span>
            <span style={{ color: '#6b7280' }}>타겟</span><span>
              {[
                spec.target?.age_range && `${spec.target.age_range[0]}~${spec.target.age_range[1]}세`,
                spec.target?.gender === 'F' ? '여성' : spec.target?.gender === 'M' ? '남성' : null,
                spec.target?.region,
                spec.target?.segment,
              ].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
        구성 섹션 ({sections.length}개)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sections.map((s, i) => (
          <div
            key={s.id}
            style={{
              padding: '10px 12px',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#eef2ff', color: '#4f46e5', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{s.type}</span>
            {s.style_variant && (
              <span style={{ fontSize: 11, color: '#6b7280', padding: '2px 6px', background: '#f3f4f6', borderRadius: 4 }}>
                {s.style_variant}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
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
  return (p.headline || p.discount_label || p.urgency_text || p.code || p.tag || '').toString().slice(0, 40);
}
