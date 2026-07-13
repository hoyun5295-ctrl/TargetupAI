/**
 * DesignThemeModal — 디자인 테마 프리셋 8종 1클릭 적용 (★ 2026-07-13 디자인 3.0)
 *
 * 테마 = 색·서체·아트디렉션(타입스케일/모티프/디바이더/그레인) 큐레이션 조합.
 * 적용 = updateBrandKit(theme.kit) 1회 — 섹션 문안/구성은 건드리지 않음(색·룩만).
 * 톤 기반 추천 배지 = 결정적 매핑(recommendThemeIds) — AI 호출·임의 상수 없음.
 */
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import { DM_DESIGN_THEMES, recommendThemeIds } from '../../../utils/dm-themes';
import ModalBase from './ModalBase';

export default function DesignThemeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateBrandKit = useDmBuilderStore((s) => s.updateBrandKit);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const currentTheme = brandKit.art_direction?.theme;
  const recommended = recommendThemeIds(brandKit.tone);

  const apply = (id: string) => {
    const theme = DM_DESIGN_THEMES.find((t) => t.id === id);
    if (!theme) return;
    updateBrandKit(theme.kit);
    setToast({ type: 'success', message: `'${theme.name}' 테마를 적용했어요. 문안은 그대로, 룩만 바뀌었어요.` });
  };

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="디자인 테마"
      subtitle="색·서체·타이포 스케일·섹션 리듬을 한 번에 바꿉니다. 문안과 섹션 구성은 그대로 유지돼요."
      size="lg"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {DM_DESIGN_THEMES.map((t) => {
          const active = currentTheme === t.id;
          const isRec = recommended.includes(t.id);
          const dark = t.kit.background_color && ['#0e1018', '#0b1220'].includes(t.kit.background_color);
          return (
            <button
              key={t.id}
              onClick={() => apply(t.id)}
              style={{
                textAlign: 'left',
                border: active ? '2px solid #4f46e5' : '1px solid #d1d5db',
                borderRadius: 14,
                padding: 0,
                overflow: 'hidden',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              {/* 미리보기 스트립 — 테마 배경 + 스와치 + 서체 샘플 */}
              <div style={{ background: t.kit.background_color || '#fff', padding: '14px 14px 12px', borderBottom: '1px solid #eee' }}>
                <div style={{ fontFamily: t.previewFont || 'inherit', fontSize: 17, fontWeight: 800, color: dark ? '#f2f5fa' : (t.kit.primary_color || '#111'), letterSpacing: '-0.01em' }}>
                  가나다 Aa 123
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {t.swatches.map((c, i) => (
                    <span key={i} style={{ width: 18, height: 18, borderRadius: 6, background: c, border: '1px solid rgba(0,0,0,0.08)' }} />
                  ))}
                </div>
              </div>
              <div style={{ padding: '10px 14px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{t.name}</span>
                  {isRec && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#4f46e5', background: '#eef2ff', padding: '2px 7px', borderRadius: 8 }}>
                      현재 톤 추천
                    </span>
                  )}
                  {active && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '2px 7px', borderRadius: 8 }}>
                      적용됨
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>{t.description}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
        적용 후에도 섹션별 구도·배경면·버튼 색은 우측 패널에서 개별 조정할 수 있어요. 되돌리려면 다른 테마를 선택하거나 브랜드 킷에서 색을 직접 바꾸면 됩니다.
      </div>
    </ModalBase>
  );
}
