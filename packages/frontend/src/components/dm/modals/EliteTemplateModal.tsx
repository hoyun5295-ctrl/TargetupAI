/**
 * EliteTemplateModal — 디자인 4.0 정예 템플릿 10종 (2026-07-14)
 *
 * 목적×스토리 구조로 고르는 완성형 골격 — 서버 design-core 컴파일 산출을 그대로 적용(FE 복제 없음).
 * 적용 = 섹션 골격 교체 + 브랜드킷 패치(테마 큐레이션 동승). 트리거·발송 설정과 무관.
 * 혜택은 placeholder — 직접 작성 전까지 수치 없음(AI 임의 혜택 영구 룰).
 */
import { useEffect, useState } from 'react';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import type { Section } from '../../../utils/dm-section-defaults';
import ModalBase from './ModalBase';

interface EliteDmTemplate {
  id: string;
  label: string;
  hint: string;
  difference: string;
  swatches: [string, string, string];
  sections: Section[];
  brand_kit_patch: Record<string, any>;
}

export default function EliteTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sections = useDmBuilderStore((s) => s.sections);
  const setSections = useDmBuilderStore((s) => s.setSections);
  const updateBrandKit = useDmBuilderStore((s) => s.updateBrandKit);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [items, setItems] = useState<EliteDmTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || items.length > 0) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/design/golden-templates?channel=dm', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const data = await res.json();
        if (data?.success && Array.isArray(data.templates)) setItems(data.templates);
      } catch {
        // 조회 실패 = 빈 목록 안내(아래 렌더)
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ★ 2026-07-14 Harold 지시 — 비파괴 적용. 작성한 콘텐츠(상품·문안)가 있으면 절대 지우지 않는다:
  //   빈 캔버스 = 골격+룩 채움 / 콘텐츠 있음 = 룩(브랜드킷)+같은 타입 섹션의 구도·배경만 입힘(콘텐츠 무손실).
  const pick = (t: EliteDmTemplate) => {
    updateBrandKit(t.brand_kit_patch as any);
    const hasContent = (sections || []).some((s: any) => s.type !== 'header' && s.type !== 'footer');
    if (!hasContent) {
      setSections(t.sections);
      setToast({ type: 'success', message: `'${t.label}' 골격과 룩을 적용했어요. 혜택 문구는 직접 작성해주세요.` });
    } else {
      const styleByType = new Map<string, any>();
      for (const s of t.sections as any[]) {
        if (!styleByType.has(s.type)) styleByType.set(s.type, s);
      }
      const STYLE_KEYS = ['treatment', 'background', 'divider_shape', 'pull_up', 'align'] as const;
      setSections(
        (sections as any[]).map((s) => {
          const ref = styleByType.get(s.type);
          if (!ref) return s;
          const patch: Record<string, unknown> = {};
          for (const k of STYLE_KEYS) {
            if (ref[k] !== undefined) patch[k] = ref[k];
          }
          return { ...s, ...patch };
        }) as any,
      );
      setToast({ type: 'success', message: `'${t.label}' 룩·구도만 적용했어요 — 작성하신 콘텐츠는 그대로예요.` });
    }
    onClose();
  };

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="정예 템플릿"
      subtitle="빈 캔버스에는 골격까지, 작성 중인 DM에는 룩·구도만 입혀요 — 만들어둔 콘텐츠는 지워지지 않습니다."
      size="lg"
    >
      {loading && <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>정예 템플릿을 불러오는 중...</div>}
      {!loading && items.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>템플릿을 불러오지 못했어요. 잠시 후 다시 열어주세요.</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {items.map((t) => (
          <div key={t.id} style={{ border: '1px solid #d1d5db', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
            <button
              onClick={() => pick(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', height: 10 }}>
                {t.swatches.map((c, i) => (
                  <span key={i} style={{ flex: 1, background: c }} />
                ))}
              </div>
              <div style={{ padding: '10px 14px 12px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{t.label}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{t.hint}</div>
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 6, lineHeight: 1.55 }}>{t.difference}</div>
              </div>
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
        브랜드 학습(AI 메모리)에 저장한 고객센터·브랜드 정보가 골격에 자동으로 채워집니다. 상품은 상품 슬라이드 섹션의 [상품 정보 붙여넣기]나 [연동 몰에서 불러오기]로 언제든 추가할 수 있어요.
      </div>
    </ModalBase>
  );
}
