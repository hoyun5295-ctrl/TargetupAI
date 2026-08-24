/**
 * TimelineList — 날짜 묶음 · 축선 행 · 접힌 묶음 · 펼침 상세 · 더 보기 (★ 2026-08-22 v2). 훅 0, props만.
 *
 * 행 = 시각(좌측 고정 열, 24시간제) · 타일(축선 위, 상태 점 우하단) · 제목/부제 · chevron.
 * 접힌 묶음 = 첫 사건의 제목·부제 원문 + 건수 배지 + 시각 범위. 펼치면 하위 줄(시각·상태)만, 본문은 대표 1회.
 * 하위 줄은 행 버튼 **밖**이다(버튼 중첩 금지). 펼침 전환은 grid-template-rows + opacity(transform 0).
 */
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { CUI_ACT, CUI_BTN_OUTLINE, CUI_PILL_BASE, CUI_PILL_DOT, CUI_PILL_TONE } from '../../utils/console-ui';
import {
  DETAIL_TIME_KEYS, KIND_STYLE, STATUS_DOT, STATUS_PILL, STATUS_SR, dayLabel, detailTimeLabel, timeLabel,
  type TimelineKind,
} from './timeline-kinds';
import { splitHighlight, type DayGroup, type FoldItem } from './timeline-fold';
import {
  C360_AXIS, C360_AXIS_COL, C360_AXIS_FIRST, C360_AXIS_LAST, C360_AXIS_ONLY, C360_CARD, C360_CARD_ACTIONS, C360_CHEVRON,
  C360_COUNT, C360_DAY, C360_DAY_COUNTS, C360_DAY_LABEL, C360_DETAIL_CLIP, C360_DETAIL_GRID, C360_DETAIL_WRAP, C360_DOT,
  C360_MARK, C360_META, C360_META_DD, C360_META_DT, C360_META_ROW, C360_MORE_ERROR, C360_MORE_WRAP, C360_MSG, C360_MSG_CLAMP,
  C360_MSG_MORE, C360_ROW, C360_ROW_HOVER, C360_ROW_OPEN, C360_ROW_STATIC, C360_SUBAXIS, C360_SUBAXIS_LAST, C360_SUBROW,
  C360_SUBROWS, C360_SUBROW_DOT, C360_SUBROW_DOT_COL, C360_SUBROW_TEXT, C360_SUBROW_TIME, C360_SUBTITLE, C360_TILE_ICON,
  C360_TIME, C360_TIME_RANGE, C360_TITLE, C360_TITLE_ROW,
} from './c360-ui';
import type { TimelineEvent } from './useCustomerTimeline';

interface Props {
  groups: DayGroup<TimelineEvent>[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  fullText: Set<string>;
  onToggleFullText: (key: string) => void;
  q: string;
  onOpenCampaign?: (campaignId: string) => void;
  nextBefore: string | null;
  loadingMore: boolean;
  moreError: string | null;
  onMore: () => void;
}

/** detail 키 라벨 — 서버가 원문 필드명을 주므로 화면에서만 한국어로 바꾼다 */
const DETAIL_LABEL: Record<string, string> = {
  subject: '제목', callback: '발신번호', statusCode: '상태 코드', statusLabel: '상태',
  carrier: '통신사', requestedAt: '요청', sentAt: '발송', messageType: '유형',
  productName: '상품', productCode: '상품코드', quantity: '수량', amount: '금액', storeName: '매장',
  eventName: '이벤트', source: '출처', eventType: '유형', dwellSeconds: '머문 시간',
  pageReached: '도달 페이지', totalPages: '전체 페이지', durationSeconds: '머문 시간',
  maxScrollPct: '스크롤', openCount: '열람 횟수', sectionType: '구역',
  channel: '채널', consentType: '동의 유형', journeyName: '여정', executionStatus: '진행 상태',
  stepOrder: '단계', logStatus: '결과', reason: '사유', transcript: '통화 내용',
  response: '응답', callStatus: '통화 상태', url: '링크', buttonId: '버튼',
};

const CLAMP_CHARS = 600;

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  return (
    <>
      {splitHighlight(text, q).map((p, i) => (p.hit ? <mark key={i} className={C360_MARK}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function dayCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${KIND_STYLE[k as TimelineKind]?.label || k} ${n}`)
    .join(' · ');
}

function DetailCard({ event, itemKey, fullText, onToggleFullText, onOpenCampaign }: {
  event: TimelineEvent; itemKey: string; fullText: Set<string>; onToggleFullText: (k: string) => void; onOpenCampaign?: (id: string) => void;
}) {
  const d = event.detail || {};
  const content = typeof d.content === 'string' ? d.content : '';
  const long = content.length > CLAMP_CHARS;
  const showFull = fullText.has(itemKey);
  const metas = Object.entries(d).filter(([k, v]) => k !== 'content' && v != null && v !== '' && typeof v !== 'object');
  return (
    <div className={C360_CARD}>
      {content && (
        <div>
          <p className={long && !showFull ? C360_MSG_CLAMP : C360_MSG}>{content}</p>
          {long && (
            <button type="button" onClick={() => onToggleFullText(itemKey)} className={C360_MSG_MORE}>
              {showFull ? '접기' : '전문 보기'}
            </button>
          )}
        </div>
      )}
      {metas.length > 0 && (
        <dl className={C360_META}>
          {metas.map(([k, v]) => (
            <div key={k} className={C360_META_ROW}>
              <dt className={C360_META_DT}>{DETAIL_LABEL[k] || k}</dt>
              {/* 시각 키는 화면 표기로 바꾼다 — 안 거치면 서버가 준 ISO 원문이 그대로 나온다(★2026-08-24 접수) */}
              <dd className={C360_META_DD}>
                {DETAIL_TIME_KEYS.has(k)
                  ? detailTimeLabel(String(v), event.at)
                  : (typeof v === 'number' ? v.toLocaleString() : String(v))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {event.ref?.type === 'campaign' && onOpenCampaign && (
        <div className={C360_CARD_ACTIONS}>
          <button type="button" onClick={() => onOpenCampaign(event.ref!.id)} className={CUI_ACT}>
            발송 결과 보기<ChevronRight className="w-3.5 h-3.5 inline -mr-0.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function Tile({ kind, status }: { kind: TimelineKind; status?: string | null }) {
  const style = KIND_STYLE[kind] || KIND_STYLE.behavior;
  const Icon = style.icon;
  const dot = status ? STATUS_DOT[status] : undefined;
  return (
    <span className={`${C360_TILE_ICON} ${style.tile}`}>
      <Icon className="w-[15px] h-[15px]" strokeWidth={1.9} aria-hidden="true" />
      {dot && (
        <span className={`${C360_DOT} ${dot}`}>
          <span className="sr-only">{STATUS_SR[status!] || status}</span>
        </span>
      )}
    </span>
  );
}

function StatusPill({ status }: { status?: string | null }) {
  const p = status ? STATUS_PILL[status] : undefined;
  if (!p) return null;
  return (
    <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[p.tone]}`}><i className={CUI_PILL_DOT} aria-hidden="true" />{p.label}</span>
  );
}

export default function TimelineList({
  groups, expanded, onToggle, fullText, onToggleFullText, q, onOpenCampaign, nextBefore, loadingMore, moreError, onMore,
}: Props) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.day} aria-label={dayLabel(g.items[0].type === 'run' ? g.items[0].first.at : g.items[0].event.at)}>
          <div className={C360_DAY}>
            <span className={C360_DAY_LABEL}>{dayLabel(g.items[0].type === 'run' ? g.items[0].first.at : g.items[0].event.at)}</span>
            <span className={C360_DAY_COUNTS}>{dayCounts(g.counts)}</span>
          </div>
          {g.items.map((item: FoldItem<TimelineEvent>, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === g.items.length - 1;
            const open = expanded.has(item.key);
            const rep = item.type === 'run' ? item.first : item.event;
            const hasDetail = !!rep.detail && Object.keys(rep.detail).length > 0;
            const expandable = item.type === 'run' || hasDetail;
            // 축선: 그룹 첫 행은 위를, 마지막 행은 아래를 끊는다. 펼친 묶음은 하위 줄이 이어받으므로 아래를 끊지 않는다
            const lastHere = isLast && !(item.type === 'run' && open);
            const axis = isFirst && lastHere ? C360_AXIS_ONLY : isFirst ? C360_AXIS_FIRST : lastHere ? C360_AXIS_LAST : C360_AXIS;
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() => expandable && onToggle(item.key)}
                  aria-expanded={expandable ? open : undefined}
                  className={`${C360_ROW} ${expandable ? C360_ROW_HOVER : C360_ROW_STATIC} ${open ? C360_ROW_OPEN : ''}`}
                >
                  <span className={C360_TIME}>
                    {timeLabel(rep.at)}
                    {item.type === 'run' && <span className={C360_TIME_RANGE}>~{timeLabel(item.fromAt)}</span>}
                  </span>
                  <span className={C360_AXIS_COL}>
                    <span className={axis} aria-hidden="true" />
                    <Tile kind={rep.kind} status={rep.status} />
                  </span>
                  <span className="min-w-0">
                    <span className={C360_TITLE_ROW}>
                      <span className={C360_TITLE}><Highlight text={rep.title} q={q} /></span>
                      {item.type === 'run' && <span className={C360_COUNT}>{item.count}건</span>}
                      <StatusPill status={rep.status} />
                    </span>
                    {rep.subtitle && <span className={C360_SUBTITLE}><Highlight text={rep.subtitle} q={q} /></span>}
                  </span>
                  {expandable ? <ChevronDown className={`${C360_CHEVRON} ${open ? 'rotate-180' : ''}`} aria-hidden="true" /> : <span />}
                </button>

                {item.type === 'run' && open && (
                  <div className={C360_SUBROWS}>
                    {item.items.map((e, i) => {
                      const subLast = i === item.items.length - 1 && isLast && !hasDetail;
                      return (
                        <div key={`${e.kind}:${e.id}`} className={C360_SUBROW}>
                          <span className={C360_SUBROW_TIME}>{timeLabel(e.at)}</span>
                          <span className={C360_SUBROW_DOT_COL}>
                            <span className={subLast ? C360_SUBAXIS_LAST : C360_SUBAXIS} aria-hidden="true" />
                            <i className={C360_SUBROW_DOT} aria-hidden="true" />
                          </span>
                          <span className={C360_SUBROW_TEXT}>{e.subtitle || (e.status ? STATUS_SR[e.status] : '') || e.title}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {hasDetail && (
                  <div className={C360_DETAIL_GRID} style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                    <div className={C360_DETAIL_CLIP}>
                      {open && (
                        <div className={C360_DETAIL_WRAP}>
                          <DetailCard event={rep} itemKey={item.key} fullText={fullText} onToggleFullText={onToggleFullText} onOpenCampaign={onOpenCampaign} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {(nextBefore || moreError) && (
        <div className={C360_MORE_WRAP}>
          {moreError ? (
            <span className={C360_MORE_ERROR}>
              {moreError}
              <button type="button" onClick={onMore} className={CUI_BTN_OUTLINE}>
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />다시 시도
              </button>
            </span>
          ) : (
            <button type="button" onClick={onMore} disabled={loadingMore} className={`${CUI_BTN_OUTLINE} w-full justify-center`}>
              {loadingMore ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />불러오는 중</> : '더 보기'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
