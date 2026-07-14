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
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const apply = (t: EliteDmTemplate) => {
    setSections(t.sections);
    updateBrandKit(t.brand_kit_patch as any);
    setToast({ type: 'success', message: `'${t.label}' 정예 템플릿을 적용했어요. 혜택 문구는 직접 작성해주세요.` });
    setConfirmId(null);
    onClose();
  };

  const pick = (t: EliteDmTemplate) => {
    const hasContent = (sections || []).some((s: any) => s.type !== 'header' && s.type !== 'footer');
    if (hasContent) setConfirmId(t.id);
    else apply(t);
  };

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="정예 템플릿"
      subtitle="목적으로 고르는 완성형 골격 — 스토리 구조·구도·테마가 함께 적용됩니다. 혜택 문구는 직접 작성해주세요."
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
            {confirmId === t.id && (
              <div style={{ borderTop: '1px solid #fde68a', background: '#fffbeb', padding: '10px 14px' }}>
                <div style={{ fontSize: 11.5, color: '#92400e', lineHeight: 1.5 }}>
                  편집 중인 섹션 구성이 이 템플릿 골격으로 교체됩니다. 계속할까요?
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => apply(t)} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#d97706', border: 0, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                    교체하고 적용
                  </button>
                  <button onClick={() => setConfirmId(null)} style={{ fontSize: 12, color: '#6b7280', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
        브랜드 학습(AI 메모리)에 저장한 고객센터·브랜드 정보가 골격에 자동으로 채워집니다. 상품 카드는 편집기에서 연동 몰 자동 채우기로 이어가세요.
      </div>
    </ModalBase>
  );
}
