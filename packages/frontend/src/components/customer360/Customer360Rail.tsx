/**
 * Customer360Rail — 좌 레일: "이 고객이 누구인가" (★ 2026-08-22 v2). 훅 0, props만.
 *
 * 지표 2x2(4칸 유지 · 0도 지우지 않음) → 12개월 막대(받은 메시지 타일 안) → 기본 정보(접이식) → Source caption.
 * 요약은 기간·검색·종류와 무관한 최근 12개월 기준이다(v2 §2-5). 못 센 값은 0이 아니라 "집계 중".
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  C360_BARS, C360_BAR_OFF, C360_BAR_ON, C360_BASIC_BODY, C360_BASIC_HEAD, C360_RAIL, C360_RAIL_SPLIT, C360_SOURCE,
  C360_TILE, C360_TILES, C360_TILE_CTX, C360_TILE_LABEL, C360_TILE_SKELETON_LABEL, C360_TILE_SKELETON_VALUE,
  C360_TILE_UNIT, C360_TILE_VALUE, C360_TILE_VALUE_TEXT, C360_TILE_VALUE_ZERO,
} from './c360-ui';
import type { TimelineSummary } from './useCustomerTimeline';

interface Props {
  summary: TimelineSummary | null;
  loading: boolean;
  basicInfo?: React.ReactNode;
  basicOpen: boolean;
  onToggleBasic: () => void;
}

const daysAgo = (iso: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(d)) / 86400000));
};

const dateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

function Tile({ label, value, unit, ctx, zero, children, text }: {
  label: string; value?: number | null; unit?: string; ctx?: string; zero?: boolean; children?: React.ReactNode; text?: string;
}) {
  return (
    <div className={C360_TILE}>
      <div className={C360_TILE_LABEL}>{label}</div>
      {text != null ? (
        <div className={C360_TILE_VALUE_TEXT}>{text}</div>
      ) : (
        <div className={zero ? C360_TILE_VALUE_ZERO : C360_TILE_VALUE}>
          {(value ?? 0).toLocaleString()}
          {unit && <span className={C360_TILE_UNIT}>{unit}</span>}
        </div>
      )}
      {children ?? <div className={C360_TILE_CTX}>{ctx || ''}</div>}
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className={C360_TILE} aria-hidden="true">
      <div className={C360_TILE_SKELETON_LABEL} />
      <div className={C360_TILE_SKELETON_VALUE} />
      <div className={C360_TILE_CTX} />
    </div>
  );
}

export default function Customer360Rail({ summary, loading, basicInfo, basicOpen, onToggleBasic }: Props) {
  const months = summary?.basis?.months ?? 12;
  const sends = summary?.sends ?? null;
  const engagements = summary?.engagements ?? 0;
  const purchases = summary?.purchases ?? 0;
  const monthly = summary?.monthly && summary.monthly.length > 0 ? summary.monthly : null;
  const maxMonthly = monthly ? Math.max(1, ...monthly.map((m) => m.sends)) : 1;
  const rate = sends && sends > 0 ? Math.round((engagements / sends) * 100) : null;
  const ago = daysAgo(summary?.lastActivityAt ?? null);

  return (
    <aside className={C360_RAIL} aria-label="고객 요약">
      <div className={C360_TILES}>
        {loading && !summary ? (
          <><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /></>
        ) : (
          <>
            {sends === null ? (
              <Tile label="받은 메시지" text="집계 중" ctx={`최근 ${months}개월`} />
            ) : (
              <Tile label="받은 메시지" value={sends} unit="건" zero={sends === 0} ctx={`최근 ${months}개월`}>
                {monthly && sends > 0 ? (
                  <div className={C360_BARS} role="img" aria-label={`최근 ${months}개월 월별 발송`} title={`최근 ${months}개월`}>
                    {monthly.map((m) => (
                      <span
                        key={m.ym}
                        className={m.sends > 0 ? C360_BAR_ON : C360_BAR_OFF}
                        style={{ height: `${Math.max(3, Math.round((m.sends / maxMonthly) * 28))}px` }}
                        title={`${m.ym.slice(0, 4)}년 ${Number(m.ym.slice(4))}월 ${m.sends}건`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={C360_TILE_CTX}>{`최근 ${months}개월`}</div>
                )}
              </Tile>
            )}
            <Tile
              label="반응"
              value={engagements}
              unit="건"
              zero={engagements === 0}
              ctx={engagements === 0 ? '열람 기록 없음' : rate != null ? `열람률 ${rate}%` : '열람 · 클릭 · 응답'}
            />
            <Tile label="구매" value={purchases} unit="건" zero={purchases === 0} ctx={purchases === 0 ? '구매 연동 없음' : '누적'} />
            {ago === null ? (
              <Tile label="마지막 활동" text="없음" ctx="" />
            ) : (
              <Tile label="마지막 활동" value={ago} unit={ago === 0 ? '오늘' : '일 전'} ctx={summary?.lastActivityAt ? dateTime(summary.lastActivityAt) : ''} />
            )}
          </>
        )}
      </div>

      {basicInfo && (
        <>
          <div className={C360_RAIL_SPLIT} />
          <button type="button" onClick={onToggleBasic} className={C360_BASIC_HEAD} aria-expanded={basicOpen}>
            {basicOpen ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
            기본 정보
          </button>
          {basicOpen && <div className={C360_BASIC_BODY}>{basicInfo}</div>}
        </>
      )}

      <p className={C360_SOURCE}>Data source: 발송 큐 · 고객 DB · 자사몰 이벤트</p>
    </aside>
  );
}
