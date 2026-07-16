/**
 * FontApplyModal — ★ 2026-07-16 서체 일괄 적용 모달 (퀵바 서체 팝오버 교체)
 *
 * 배경: 퀵바 서체 컨트롤이 position:absolute 팝오버였는데 부모 퀵바가 overflowX:auto 스크롤
 *   컨테이너(브라우저가 overflow-y도 auto로 계산)라, 바 높이 밖으로 나온 서체 리스트가 잘려
 *   "저딴식으로" 보였다(LESSONS_FRONTEND 2026-07-14 오버플로 클리핑 함정 — z-index 아님).
 *   → ModalBase 기반 모달로 교체. 각 서체를 실제 글꼴로 크게 미리보기(어떤 서체인지 바로 확인).
 * 적용 = updateBrandKit({ font_family, font_display }) 1회 — 전 섹션 제목+본문 일괄(기존 동작 보존).
 * 서체 = DM_FONT_CATALOG 단일 소스(하드코딩 금지) — 12종 전부 무료·상업적 사용 가능(오픈 폰트
 *   라이선스) + 우리 서버 자가 호스팅이라 수신 단말에서도 미리보기 그대로 렌더.
 * 미리보기 글꼴은 fonts.css(자가호스팅)로 로드 — 편집 캔버스·발행 뷰어와 동일 파일.
 */
import { useEffect } from 'react';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import { DM_FONT_CATALOG } from '../../../utils/dm-tokens';
import ModalBase from './ModalBase';

export default function FontApplyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateBrandKit = useDmBuilderStore((s) => s.updateBrandKit);
  const setToast = useDmBuilderStore((s) => s.setToast);

  // 미리보기용 자가호스팅 서체 로드 — 편집 캔버스/브랜드킷과 동일 파일(idempotent). 각 서체가 실제 글꼴로 보임.
  useEffect(() => {
    if (!open) return;
    const ID = 'dm-selfhost-fonts';
    if (document.getElementById(ID)) return;
    const link = document.createElement('link');
    link.id = ID;
    link.rel = 'stylesheet';
    link.href = '/api/dm/v/fonts.css';
    document.head.appendChild(link);
  }, [open]);

  const currentFamily = brandKit.font_family || '';
  const currentFont = DM_FONT_CATALOG.find(
    (c) => currentFamily.includes(c.css.split(',')[0].replace(/"/g, '').trim()),
  );

  const apply = (css: string, label: string) => {
    // 제목+본문 일괄 — "누르면 전부 그 서체" (개별 페어링은 브랜드 킷 모달)
    updateBrandKit({ font_family: css, font_display: css });
    setToast({ type: 'success', message: `전체 서체를 "${label}"(으)로 적용했어요.` });
    onClose();
  };

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="서체"
      subtitle="누르면 전 섹션(제목·본문)에 한 번에 적용돼요. 아래 미리보기가 실제 출력 글꼴입니다."
      size="lg"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {DM_FONT_CATALOG.map((c) => {
          const active = currentFont?.id === c.id;
          const cleanLabel = c.label.replace(/\s*\(.*\)$/, '');
          const note = c.label.match(/\(([^)]+)\)/)?.[1] || '';
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => apply(c.css, c.label)}
              aria-pressed={active}
              style={{
                textAlign: 'left',
                border: active ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                background: active ? '#eef2ff' : '#fff',
                borderRadius: 12,
                padding: '13px 15px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: active ? 700 : 600, color: active ? '#4338ca' : '#374151' }}>
                  {cleanLabel}
                  {note ? <span style={{ fontWeight: 400, color: '#9ca3af' }}> · {note}</span> : null}
                </span>
                {active && <span style={{ fontSize: 11, color: '#4f46e5', fontWeight: 700, flexShrink: 0 }}>적용 중</span>}
              </div>
              {/* 실제 출력 글꼴 미리보기 — 제목(굵게)+본문(한글·영문·숫자) */}
              <div style={{ fontFamily: c.css, fontSize: 22, lineHeight: 1.25, fontWeight: 700, color: '#111827', marginTop: 8 }}>
                가나다 Aa 123
              </div>
              <div style={{ fontFamily: c.css, fontSize: 13, lineHeight: 1.5, color: '#4b5563', marginTop: 3 }}>
                안녕하세요 ABCabc 0123
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 14, fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>
        수록 서체는 모두 무료·상업적 사용 가능한 오픈 폰트 라이선스이며, 우리 서버에서 직접 제공돼 받는 분 단말에서도 위 미리보기 그대로 보입니다.
      </div>
    </ModalBase>
  );
}
