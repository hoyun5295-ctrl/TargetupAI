/**
 * LegacyBakedPreview — ★ 2026-11-08 C116 D11 「구버전 앱 모습」 = 서버가 구워 보내는 모습(설계서 docs/2026-11-08-c116-inapp-bake-design.md).
 *   옛 앱(업체 네이티브 렌더러)은 그림 + 자기 버튼만 그린다 → 앱 바닥 시트(흰 · 위 모서리 둥금) 안에
 *   정지 그리기 틀(시계 · 버튼 칸 · 복사 · 닫기 0 · 넘김 유지)을 1:1 칸(서버 맞춤 `inapp` 캔버스)으로 넣고, 그 아래 앱 버튼 · 닫기 줄.
 *   편집기(PosterEditor) · 공용 미리보기(AppInAppPreview) 둘 다 이 부품을 쓴다(같은 모습 · 두 벌 0).
 */
import { PosterFramePreview } from './PosterFramePreview';
import type { PosterFrameSlide } from './generated/poster-frame';
import { inAppDeadlineText } from './legacy-app-view';

export function LegacyBakedPreview({
  slides, design, accentColor, badge, endAt, replaceVars, active = 0, onActive, buttonLabel, buttonBg, buttonColor, optOutLabel,
}: {
  slides: PosterFrameSlide[];
  design: Record<string, any> | null | undefined;
  accentColor?: string | null;
  badge?: string | null;
  endAt?: string | number | null;
  replaceVars?: (t: string) => string;
  active?: number;
  onActive?: (i: number) => void;
  /** 앱이 그리는 버튼(지금 장 버튼 · 없으면 메시지 첫 버튼) */
  buttonLabel?: string | null;
  buttonBg?: string | null;
  buttonColor?: string | null;
  optOutLabel: string;
}) {
  return (
    <div className="absolute inset-0" style={{ zIndex: 2 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,.45)' }} />
      <div className="absolute inset-x-0 bottom-0" style={{ background: '#ffffff', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
        {/* 앱 그림 칸 ≈ 정사각(서버 맞춤 inapp 캔버스) · 그 안 = 서버 화면(390 × 844)에서 그린 틀 상자를 안전 칸(80% × 92%)에 맞춘 모습 */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', background: '#ffffff' }}>
          <PosterFramePreview
            slides={slides} design={design} accentColor={accentColor} badge={badge} endAt={endAt}
            replaceVars={replaceVars} active={active} onActive={onActive}
            still={{ deadlineText: inAppDeadlineText(endAt ?? null) }}
            bakeFit
          />
        </div>
        <div style={{ padding: '12px 16px 6px' }}>
          {buttonLabel ? (
            <div style={{ background: buttonBg || '#111111', color: buttonColor || '#ffffff', padding: '11px 0', borderRadius: 11, fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
              {buttonLabel}
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 2px 2px' }}>
            <span style={{ color: '#1b1d23', opacity: 0.55, fontSize: 12, textDecoration: 'underline' }}>{optOutLabel}</span>
            <span style={{ color: '#1b1d23', opacity: 0.6, fontSize: 12 }}>닫기</span>
          </div>
        </div>
      </div>
    </div>
  );
}
