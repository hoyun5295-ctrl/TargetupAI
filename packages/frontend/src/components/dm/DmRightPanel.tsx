/**
 * DmRightPanel — 우측 패널 (320px)
 * ★ 2026-07-16 M4 재구성 (설계서 §1-5 — 초등학생 조작성):
 *   내용(타입별 에디터)이 최상단 → 빠른 디자인(정렬·버튼 색 2개만) → 나머지 공통 속성 전부 [고급 설정 ▾] 접힘.
 *   개발자 코드값(beauty-elegant 등) 노출 금지 — styleVariantLabel 단일 소스 경유.
 *   (직원 실사용 "설명 없이는 모른다" + Harold "세부편집 겁나 불편" 직접 대응 — 폼 나열 12개 → 기본 노출 2개)
 */
import { useMemo } from 'react';
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import { SECTION_META, DM_FONT_SIZE_OPTIONS, styleVariantLabel } from '../../utils/dm-section-defaults';
import SectionPropsEditor from './panels/SectionPropsEditor';

// ★ 2026-06-25 (P1) 섹션 구도(treatment) 픽커 — 백엔드 dm-art-direction.TREATMENTS 미러.
// ★ 2026-07-13 디자인 3.0 — 4섹션 → 10섹션 확장.
const TREATMENT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  hero: [
    { value: 'classic', label: '기본' }, { value: 'full_bleed', label: '풀블리드' },
    { value: 'split', label: '분할' }, { value: 'typographic', label: '타이포 (이미지 미사용)' }, { value: 'editorial_overlap', label: '오버랩' },
  ],
  coupon: [{ value: 'classic', label: '기본' }, { value: 'ticket', label: '티켓' }, { value: 'spotlight', label: '스포트라이트' }],
  text_card: [{ value: 'classic', label: '기본' }, { value: 'lead', label: '리드 (이미지 미사용)' }, { value: 'framed', label: '프레임' }, { value: 'quote', label: '인용 (이미지 미사용)' }],
  cta: [{ value: 'classic', label: '기본' }, { value: 'bar', label: '바' }, { value: 'ghost', label: '고스트' }, { value: 'sticky', label: '스티키 바 (하단 고정)' }],
  product_carousel: [{ value: 'classic', label: '기본 2열' }, { value: 'focus', label: '대표 상품 강조' }, { value: 'list', label: '리스트' }],
  gallery: [{ value: 'classic', label: '기본' }, { value: 'mosaic', label: '모자이크' }],
  reviews: [{ value: 'classic', label: '기본' }, { value: 'quote', label: '대표 후기 인용' }],
  countdown: [{ value: 'classic', label: '기본' }, { value: 'banner', label: '슬림 배너' }],
  promo_code: [{ value: 'classic', label: '다크 패널' }, { value: 'light', label: '라이트 카드' }],
  store_info: [{ value: 'classic', label: '기본' }, { value: 'card', label: '카드' }],
};

// ★ 2026-07-13 디자인 3.0 — 섹션 배경면/연결부 선택지 (SSR·캔버스 dm-bgx-*/dm-divider-svg 클래스와 1:1)
const BACKGROUND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '기본' },
  { value: 'soft', label: '브랜드 소프트' },
  { value: 'tint', label: '브랜드 틴트' },
  { value: 'dark', label: '다크' },
  { value: 'gradient', label: '그라데이션' },
  { value: 'glass', label: '글래스' },
];
const DIVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '없음' },
  { value: 'wave', label: '웨이브' },
  { value: 'slant', label: '사선' },
  { value: 'curve', label: '커브' },
];

export default function DmRightPanel() {
  const sections = useDmBuilderStore((s) => s.sections);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const setSectionVariant = useDmBuilderStore((s) => s.setSectionVariant);
  const setSectionVisible = useDmBuilderStore((s) => s.setSectionVisible);
  const toggleSectionLock = useDmBuilderStore((s) => s.toggleSectionLock);
  const setSectionStyle = useDmBuilderStore((s) => s.setSectionStyle);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);

  const selected = useMemo(
    () => sections.find((s) => s.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--dm-neutral-200)',
        background: 'var(--dm-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {!selected ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--dm-neutral-500)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👈</div>
          <div>좌측 섹션 또는 캔버스에서<br />편집할 섹션을 선택하세요.</div>
        </div>
      ) : (() => {
        const meta = SECTION_META[selected.type];
        return (
          <>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--dm-neutral-200)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{meta.label}</span>
                {/* ★ 2026-07-16 M4 — AI 문안 개선을 전역 메뉴에서 섹션 문맥 인라인으로 이동 (설계서 §1-2) */}
                <button
                  onClick={() => setOpenModal('ai-improve')}
                  title="이 DM의 문안을 AI가 다듬어줘요"
                  style={{
                    marginLeft: 'auto', height: 24, padding: '0 8px', borderRadius: 6,
                    border: '1px solid var(--dm-neutral-200)', background: 'var(--dm-neutral-50)',
                    color: 'var(--dm-neutral-700)', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  ✨ AI 다듬기
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)' }}>{meta.description}</div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '14px' }}>
              {/* ★ M4 — 내용이 1순위: 타입별 필드 에디터가 최상단 (설계서 §1-5) */}
              <section style={{ marginBottom: 16 }}>
                <SectionTitle>내용</SectionTitle>
                <SectionPropsEditor
                  key={selected.id}
                  section={selected}
                  onUpdate={(patch) => updateSectionProps(selected.id, patch)}
                />
              </section>

              {/* ★ M4 — 빠른 디자인: 자주 쓰는 2개만 기본 노출 */}
              <section style={{ marginBottom: 12 }}>
                <SectionTitle>빠른 디자인</SectionTitle>
                <LabelRow label="정렬">
                  <div style={{ display: 'flex', gap: 4 }}>
                    {([['left', '좌'], ['center', '중'], ['right', '우']] as const).map(([a, lbl]) => (
                      <button
                        key={a}
                        onClick={() => setSectionStyle(selected.id, { align: a })}
                        style={{ ...alignBtnStyle, ...((selected.align || 'center') === a ? alignBtnActiveStyle : {}) }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </LabelRow>
                <LabelRow label="버튼 색">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="color"
                      value={selected.accent_color || '#4f46e5'}
                      onChange={(e) => setSectionStyle(selected.id, { accent_color: e.target.value })}
                      style={{ width: 30, height: 24, padding: 0, border: '1px solid var(--dm-neutral-200)', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                    />
                    {selected.accent_color && (
                      <button
                        onClick={() => setSectionStyle(selected.id, { accent_color: undefined })}
                        style={{ fontSize: 10, color: 'var(--dm-neutral-500)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        브랜드색
                      </button>
                    )}
                  </div>
                </LabelRow>
              </section>

              {/* ★ M4 — 나머지 공통 속성 전부 [고급 설정 ▾] 접힘 (기본 닫힘 — 폼 12개 나열 제거) */}
              <details>
                <summary
                  style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--dm-neutral-500)', letterSpacing: 0.5,
                    textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none', marginBottom: 10,
                  }}
                >
                  고급 설정 (디자인 세부)
                </summary>
                <div style={{ paddingTop: 6 }}>
                <LabelRow label="분위기(스타일)">
                  <select
                    value={selected.style_variant || 'default'}
                    onChange={(e) => setSectionVariant(selected.id, e.target.value)}
                    style={selectStyle}
                  >
                    {meta.supportsStyleVariants.map((v) => (
                      <option key={v} value={v}>{styleVariantLabel(v)}</option>
                    ))}
                  </select>
                </LabelRow>
                {TREATMENT_OPTIONS[selected.type] && (
                  <LabelRow label="구도">
                    <select
                      value={selected.treatment || 'classic'}
                      onChange={(e) => setSectionStyle(selected.id, { treatment: e.target.value })}
                      style={selectStyle}
                    >
                      {TREATMENT_OPTIONS[selected.type].map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </LabelRow>
                )}
                {/* ★ 2026-07-13 디자인 3.0 — 섹션 배경면/연결부/겹침 */}
                <LabelRow label="배경면">
                  <select
                    value={selected.background || ''}
                    onChange={(e) => setSectionStyle(selected.id, { background: (e.target.value || undefined) as any })}
                    style={selectStyle}
                  >
                    {BACKGROUND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </LabelRow>
                <LabelRow label="하단 연결부">
                  <select
                    value={selected.divider_shape || ''}
                    onChange={(e) => setSectionStyle(selected.id, { divider_shape: (e.target.value || undefined) as any })}
                    style={selectStyle}
                  >
                    {DIVIDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </LabelRow>
                <LabelRow label="위 섹션에 겹침">
                  <ToggleButton
                    active={!!selected.pull_up}
                    onClick={() => setSectionStyle(selected.id, { pull_up: !selected.pull_up })}
                    labelOn="겹침"
                    labelOff="없음"
                  />
                </LabelRow>
                {/* ★ 2026-07-14 배경면=그라데이션 두 번째 색 직접 지정(임은지) — 첫 색은 "빠른 디자인"의 버튼 색, 끝 색을 여기서. 미지정=자동 도출 */}
                {selected.background === 'gradient' && (
                  <LabelRow label="그라데이션 끝 색">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="color"
                        value={selected.accent_color_2 || '#a855f7'}
                        onChange={(e) => setSectionStyle(selected.id, { accent_color_2: e.target.value })}
                        style={{ width: 30, height: 24, padding: 0, border: '1px solid var(--dm-neutral-200)', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                      />
                      {selected.accent_color_2 && (
                        <button
                          onClick={() => setSectionStyle(selected.id, { accent_color_2: undefined })}
                          style={{ fontSize: 10, color: 'var(--dm-neutral-500)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          자동
                        </button>
                      )}
                    </div>
                  </LabelRow>
                )}
                {/* ★ 2026-07-02(2) 섹션 공통 텍스트 크기 — 전 섹션 제목급/본문급 일괄, 발행물 동일 적용 */}
                <LabelRow label="제목 크기">
                  <select
                    value={selected.title_size ? String(selected.title_size) : ''}
                    onChange={(e) => setSectionStyle(selected.id, { title_size: e.target.value ? Number(e.target.value) : undefined })}
                    style={selectStyle}
                  >
                    {DM_FONT_SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </LabelRow>
                <LabelRow label="본문 크기">
                  <select
                    value={selected.text_size ? String(selected.text_size) : ''}
                    onChange={(e) => setSectionStyle(selected.id, { text_size: e.target.value ? Number(e.target.value) : undefined })}
                    style={selectStyle}
                  >
                    {DM_FONT_SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </LabelRow>
                {/* 운영성 토글 — 항상 보일 이유 없어 고급 끝으로 (설계서 §1-5-5) */}
                <LabelRow label="표시">
                  <ToggleButton
                    active={selected.visible}
                    onClick={() => setSectionVisible(selected.id, !selected.visible)}
                    labelOn="표시"
                    labelOff="숨김"
                  />
                </LabelRow>
                <LabelRow label="AI 재생성 제외">
                  <ToggleButton
                    active={!!selected.ai_locked}
                    onClick={() => toggleSectionLock(selected.id)}
                    labelOn="잠금"
                    labelOff="허용"
                  />
                </LabelRow>
                </div>
              </details>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dm-neutral-500)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </div>
  );
}

function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--dm-neutral-700)' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ToggleButton({ active, onClick, labelOn, labelOff }: { active: boolean; onClick: () => void; labelOn: string; labelOff: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 24,
        padding: '0 10px',
        borderRadius: 12,
        border: 'none',
        background: active ? 'var(--dm-primary)' : 'var(--dm-neutral-200)',
        color: active ? '#fff' : 'var(--dm-neutral-700)',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {active ? labelOn : labelOff}
    </button>
  );
}

const alignBtnStyle: React.CSSProperties = {
  flex: 1,
  height: 24,
  padding: '0 8px',
  borderRadius: 6,
  border: '1px solid var(--dm-neutral-200)',
  background: 'var(--dm-bg)',
  color: 'var(--dm-neutral-700)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const alignBtnActiveStyle: React.CSSProperties = {
  background: 'var(--dm-primary)',
  color: '#fff',
  borderColor: 'var(--dm-primary)',
};

const selectStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--dm-neutral-200)',
  borderRadius: 6,
  background: 'var(--dm-bg)',
  fontSize: 12,
  color: 'var(--dm-neutral-900)',
  outline: 'none',
  cursor: 'pointer',
};
