/**
 * LegacyBakedPreview — ★ 2026-11-08 C116 D11 · C116-B D6 「구버전 앱 모습」 = 서버가 구워 보내는 모습(설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md).
 *   옛 연동 앱(고객사 네이티브 앱)은 그림 + 자기 버튼만 그린다 → 앱 시트(흰 · 위 모서리 둥금) 안에
 *   정지 그리기 틀(시계 · 버튼 칸 · 복사 · 닫기 · 그림자 0 · 넘김 유지)을 정사각 칸(서버 최종 그림 = 가운데 80% · 무대색)으로 넣고, 그 아래 앱 버튼 · 닫기 줄.
 *   편집기(PosterEditor) · 공용 미리보기(AppInAppPreview) 둘 다 이 부품을 쓴다(같은 모습 · 두 벌 0).
 */
import { PosterFramePreview } from './PosterFramePreview';
import type { PosterFrameSlide } from './generated/poster-frame';
import { inAppDeadlineText, legacyStageOf } from './legacy-app-view';

export function LegacyBakedPreview({
  slides, design, accentColor, badge, endAt, replaceVars, active = 0, onActive, buttonLabel, buttonBg, buttonColor, optOutLabel, full = false,
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
  /** ★ C118 B2 전부 스튜디오 인앱용 그림 = 여백 0 · 모서리 0(서버 굽기 full 과 같은 모습) */
  full?: boolean;
}) {
  return (
    <div className="absolute inset-0" style={{ zIndex: 2 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,.45)' }} />
      <div className="absolute inset-x-0 bottom-0" style={{ background: '#ffffff', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
        {/* 앱 그림 칸 = 서버 최종 정사각 그림 · 그 안 = 서버 화면(390 × 844)에서 그린 틀 상자를 가운데 80% × 80% 에 맞춘 모습 · 바탕 = 지금 장 무대색 */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', background: legacyStageOf((slides[Math.min(Math.max(0, active), Math.max(0, slides.length - 1))] as any)?.bg_color) }}>
          <PosterFramePreview
            slides={slides} design={design} accentColor={accentColor} badge={badge} endAt={endAt}
            replaceVars={replaceVars} active={active} onActive={onActive}
            still={{ deadlineText: inAppDeadlineText(endAt ?? null), ...(full ? { full: true } : {}) }}
            bakeFit
            bakeFull={full}
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

/**
 * ★ C116-B D6 「구버전 앱 모습」을 아직 정할 수 없을 때(서버 호스트 목록을 받는 중 · 받지 못함) — 짐작한 그림 대신 이 칸.
 *   실패면 「다시 시도」 = 목록을 다시 받는다(편집 중인 내용은 그대로).
 */
export function LegacyAppPreviewPending({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="absolute inset-0" style={{ zIndex: 2 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,.45)' }} />
      <div className="absolute inset-x-0 bottom-0" style={{ background: '#ffffff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '28px 20px 26px', textAlign: 'center' }}>
        {failed ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1b1d23' }}>구버전 앱 모습을 확인하지 못했어요</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>그림 주소를 서버와 맞춰 보는 중에 연결이 끊겼어요</div>
            <button type="button" onClick={onRetry}
              style={{ marginTop: 14, height: 38, padding: '0 18px', borderRadius: 10, border: 'none', background: '#111827', color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              다시 시도
            </button>
          </>
        ) : (
          <>
            <div className="animate-spin" aria-label="확인 중" style={{ width: 22, height: 22, margin: '0 auto 10px', borderRadius: 999, border: '2.5px solid #e2e8f0', borderTopColor: '#111827' }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1b1d23' }}>구버전 앱 모습을 확인하고 있어요</div>
          </>
        )}
      </div>
    </div>
  );
}
