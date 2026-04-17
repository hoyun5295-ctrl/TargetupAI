/**
 * BrandKitModal — 회사 브랜드킷 편집 + URL 자동추출 (D126 V2)
 *
 * 섹션:
 *  1. URL 자동추출 (상단): og:image/favicon/theme-color 파싱
 *  2. 로고 URL
 *  3. 컬러 (primary/accent/neutral/bg)
 *  4. 타이포 (서체 선택)
 *  5. 톤 (5종)
 *  6. 연락처 (phone/email/website)
 *  7. SNS 링크 (인스타/유튜브/카카오/네이버)
 */
import { useEffect, useState } from 'react';
import axios from 'axios';
import type { DmBrandKit } from '../../../stores/dmBuilderStore';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import ModalBase, { ModalButton } from './ModalBase';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

type ExtractResult = {
  raw: {
    site_name?: string;
    title?: string;
    description?: string;
    logo_url?: string;
    og_image_url?: string;
    primary_color?: string;
    contact?: { phone?: string; email?: string; website?: string };
    sns?: { instagram?: string; youtube?: string; kakao?: string; naver?: string };
  };
  patch: Partial<DmBrandKit>;
};

const TONE_OPTIONS: Array<{ value: DmBrandKit['tone']; label: string }> = [
  { value: 'premium', label: '프리미엄' },
  { value: 'friendly', label: '친근' },
  { value: 'urgent', label: '긴박' },
  { value: 'elegant', label: '우아' },
  { value: 'playful', label: '재미' },
];

const FONT_OPTIONS = [
  { value: '', label: '기본 (Pretendard)' },
  { value: '"Noto Serif KR", serif', label: 'Noto Serif KR (세리프)' },
  { value: '"Pretendard Variable", sans-serif', label: 'Pretendard (산세리프)' },
  { value: '"Nanum Myeongjo", serif', label: '나눔명조' },
  { value: '"Gowun Dodum", sans-serif', label: '고운 도둠' },
  { value: '"Black Han Sans", sans-serif', label: '검은 고딕' },
];

export default function BrandKitModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const appliedKit = useDmBuilderStore((s) => s.brandKit);
  const applyBrandKit = useDmBuilderStore((s) => s.applyBrandKit);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [companyKit, setCompanyKit] = useState<DmBrandKit>({});
  const [kit, setKit] = useState<DmBrandKit>({});
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  // URL 추출
  const [extractUrl, setExtractUrl] = useState('');
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void loadCompanyKit();
    setKit(appliedKit);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCompanyKit = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dm/brand-kit');
      const k = res.data?.brand_kit || {};
      setCompanyKit(k);
    } catch {
      /* 무시 — 기본값으로 계속 */
    } finally {
      setLoading(false);
    }
  };

  const updateField = <K extends keyof DmBrandKit>(key: K, value: DmBrandKit[K]) => {
    setKit((prev) => ({ ...prev, [key]: value }));
  };

  const handleExtract = async () => {
    if (!extractUrl.trim()) return;
    setExtractError(null);
    setExtractLoading(true);
    setExtractResult(null);
    try {
      const res = await api.post('/dm/brand-kit/extract', { url: extractUrl });
      setExtractResult(res.data);
    } catch (err: any) {
      setExtractError(err?.response?.data?.error || '추출 실패');
    } finally {
      setExtractLoading(false);
    }
  };

  const applyExtractPatch = () => {
    if (!extractResult?.patch) return;
    setKit((prev) => ({ ...prev, ...extractResult.patch }));
    setToast({ type: 'success', message: '추출 결과를 적용했어요.' });
  };

  const handleSaveCompany = async () => {
    setSaveLoading(true);
    try {
      await api.put('/dm/brand-kit', { brand_kit: kit });
      applyBrandKit(kit); // 현재 DM에도 반영
      setToast({ type: 'success', message: '회사 기본 브랜드킷으로 저장했어요.' });
      onClose();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '저장 실패' });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleApplyToCurrent = () => {
    applyBrandKit(kit);
    setToast({ type: 'success', message: '현재 DM에만 적용했어요.' });
    onClose();
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={onClose}>닫기</ModalButton>
      <ModalButton variant="secondary" onClick={handleApplyToCurrent}>
        현재 DM에만 적용
      </ModalButton>
      <ModalButton variant="primary" onClick={handleSaveCompany} loading={saveLoading}>
        회사 기본값으로 저장
      </ModalButton>
    </>
  );

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      size="lg"
      title="브랜드 킷"
      subtitle="회사 기본 브랜드킷은 모든 DM에 상속되며, DM별로 override할 수 있어요."
      footer={footer}
    >
      {loading && <div style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>불러오는 중...</div>}

      {!loading && (
        <>
          {/* URL 자동추출 */}
          <Panel title="🌐 URL로 자동 추출" subtitle="브랜드 홈페이지 URL을 입력하면 로고/컬러/연락처를 자동 추출해요.">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={extractUrl}
                onChange={(e) => setExtractUrl(e.target.value)}
                placeholder="https://www.example.com"
                style={{ flex: 1, height: 36, padding: '0 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              />
              <button
                onClick={handleExtract}
                disabled={extractLoading || !extractUrl.trim()}
                style={{
                  height: 36,
                  padding: '0 14px',
                  background: '#4f46e5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: extractLoading || !extractUrl.trim() ? 'not-allowed' : 'pointer',
                  opacity: extractLoading || !extractUrl.trim() ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {extractLoading ? '추출중...' : '자동추출'}
              </button>
            </div>

            {extractError && (
              <div style={{ marginTop: 8, padding: 8, background: '#fef2f2', color: '#991b1b', fontSize: 12, borderRadius: 6 }}>
                {extractError}
              </div>
            )}

            {extractResult && (
              <ExtractResultView result={extractResult} onApply={applyExtractPatch} />
            )}
          </Panel>

          {/* 로고 */}
          <Panel title="🖼️ 로고">
            <Field label="로고 URL">
              <input
                value={kit.logo_url || ''}
                onChange={(e) => updateField('logo_url', e.target.value)}
                placeholder="https://.../logo.png"
                style={inputStyle}
              />
            </Field>
            {kit.logo_url && (
              <div style={{ marginTop: 8, padding: 8, background: '#f9fafb', borderRadius: 6, textAlign: 'center' }}>
                <img src={kit.logo_url} alt="logo preview" style={{ maxHeight: 60, maxWidth: 200 }} />
              </div>
            )}
          </Panel>

          {/* 컬러 */}
          <Panel title="🎨 컬러">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <ColorField label="Primary" value={kit.primary_color || ''} onChange={(v) => updateField('primary_color', v)} />
              <ColorField label="Accent" value={kit.accent_color || ''} onChange={(v) => updateField('accent_color', v)} />
              <ColorField label="Secondary" value={kit.secondary_color || ''} onChange={(v) => updateField('secondary_color', v)} />
              <ColorField label="Background" value={kit.background_color || ''} onChange={(v) => updateField('background_color', v)} />
            </div>
          </Panel>

          {/* 폰트 + 톤 */}
          <Panel title="🔤 타이포 & 톤">
            <Field label="서체">
              <select
                value={kit.font_family || ''}
                onChange={(e) => updateField('font_family', e.target.value)}
                style={inputStyle}
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="톤">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TONE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => updateField('tone', t.value)}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      border: kit.tone === t.value ? '2px solid #4f46e5' : '1px solid #d1d5db',
                      background: kit.tone === t.value ? '#eef2ff' : '#fff',
                      color: kit.tone === t.value ? '#4f46e5' : '#374151',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
          </Panel>

          {/* 연락처 */}
          <Panel title="📞 연락처">
            <Field label="전화">
              <input
                value={kit.contact?.phone || ''}
                onChange={(e) => updateField('contact', { ...kit.contact, phone: e.target.value })}
                placeholder="02-1234-5678"
                style={inputStyle}
              />
            </Field>
            <Field label="이메일">
              <input
                value={kit.contact?.email || ''}
                onChange={(e) => updateField('contact', { ...kit.contact, email: e.target.value })}
                placeholder="hello@example.com"
                style={inputStyle}
              />
            </Field>
            <Field label="웹사이트">
              <input
                value={kit.contact?.website || ''}
                onChange={(e) => updateField('contact', { ...kit.contact, website: e.target.value })}
                placeholder="https://www.example.com"
                style={inputStyle}
              />
            </Field>
          </Panel>

          {/* SNS */}
          <Panel title="📱 SNS">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              <Field label="Instagram">
                <input
                  value={kit.sns?.instagram || ''}
                  onChange={(e) => updateField('sns', { ...kit.sns, instagram: e.target.value })}
                  placeholder="https://instagram.com/..."
                  style={inputStyle}
                />
              </Field>
              <Field label="YouTube">
                <input
                  value={kit.sns?.youtube || ''}
                  onChange={(e) => updateField('sns', { ...kit.sns, youtube: e.target.value })}
                  placeholder="https://youtube.com/..."
                  style={inputStyle}
                />
              </Field>
              <Field label="카카오">
                <input
                  value={kit.sns?.kakao || ''}
                  onChange={(e) => updateField('sns', { ...kit.sns, kakao: e.target.value })}
                  placeholder="https://pf.kakao.com/..."
                  style={inputStyle}
                />
              </Field>
              <Field label="네이버">
                <input
                  value={kit.sns?.naver || ''}
                  onChange={(e) => updateField('sns', { ...kit.sns, naver: e.target.value })}
                  placeholder="https://smartstore.naver.com/..."
                  style={inputStyle}
                />
              </Field>
            </div>
          </Panel>

          {companyKit && Object.keys(companyKit).length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: '#f9fafb', borderRadius: 6, fontSize: 11, color: '#6b7280' }}>
              💡 회사 기본값이 설정되어 있어요. "회사 기본값으로 저장"을 누르면 이 DM부터 전부 상속돼요.
            </div>
          )}
        </>
      )}
    </ModalBase>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 34,
  padding: '0 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 14,
        background: '#fff',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#111827' }}>{title}</h3>
      {subtitle && <p style={{ margin: '2px 0 10px', fontSize: 11, color: '#6b7280' }}>{subtitle}</p>}
      <div style={{ marginTop: subtitle ? 0 : 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#4f46e5'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 34, border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', padding: 2 }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#hex"
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
    </div>
  );
}

function ExtractResultView({ result, onApply }: { result: ExtractResult; onApply: () => void }) {
  const { raw } = result;
  const hasData =
    raw.logo_url ||
    raw.og_image_url ||
    raw.primary_color ||
    raw.contact?.phone ||
    raw.contact?.email ||
    raw.sns?.instagram ||
    raw.sns?.youtube;

  return (
    <div style={{ marginTop: 10, padding: 10, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
      {!hasData ? (
        <div style={{ fontSize: 12, color: '#0369a1' }}>추출 가능한 정보가 없어요. 다른 URL로 시도해 주세요.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0369a1', marginBottom: 8 }}>
            추출 결과 {raw.site_name && `— ${raw.site_name}`}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {raw.logo_url && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', padding: 6, borderRadius: 6 }}>
                <img src={raw.logo_url} alt="logo" style={{ width: 24, height: 24, objectFit: 'contain' }} />
                <span style={{ fontSize: 11, color: '#0c4a6e' }}>로고</span>
              </div>
            )}
            {raw.primary_color && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', padding: 6, borderRadius: 6 }}>
                <div style={{ width: 20, height: 20, background: raw.primary_color, borderRadius: 4, border: '1px solid #e5e7eb' }} />
                <span style={{ fontSize: 11, color: '#0c4a6e' }}>{raw.primary_color}</span>
              </div>
            )}
            {raw.contact?.phone && <Chip>📞 {raw.contact.phone}</Chip>}
            {raw.contact?.email && <Chip>📧 {raw.contact.email}</Chip>}
            {raw.sns?.instagram && <Chip>📷 Instagram</Chip>}
            {raw.sns?.youtube && <Chip>▶️ YouTube</Chip>}
          </div>
          <button
            onClick={onApply}
            style={{
              height: 30,
              padding: '0 12px',
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ↓ 브랜드킷에 적용
          </button>
        </>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, padding: '4px 8px', background: '#fff', borderRadius: 10, color: '#0c4a6e' }}>
      {children}
    </span>
  );
}
