/**
 * Customer360Panel — 고객 한 명의 활동 타임라인, v2 2열 작업면 (★ 2026-08-22 재설계)
 *
 * 구성: 헤더(부모 언어) → 본문 2열 = 좌 레일(지표 2x2 · 12개월 막대 · 기본 정보) + 우 컬럼(툴바 2행 · 원천 안내 · 축선 타임라인 · 더 보기).
 * 데이터는 `useCustomerTimeline` 하나에서 온다. 제목·상태 문구는 **서버가 완성해서** 준다(1차 설계서 §2-5).
 * 같은 문자를 연달아 보낸 행은 `foldRuns`(순수)가 클라이언트에서 접는다(v2 §4).
 *
 * ⛔ 이 파일이 가진 훅은 데이터 훅 1개 + 화면 상태(펼침·전문 보기·기본 정보 열림) 뿐이고 **전부 조기 return 위**에 있다.
 *    표시 조각(Header·Rail·Toolbar·List·States)은 훅 0, props만 받는다(LESSONS_FRONTEND 2026-07-06 훅 개수 불일치).
 * ⛔ 톤: 껍데기·헤더 띠는 부모(고객 DB 조회) 리터럴, 안쪽은 CUI_* + c360-ui.ts(v2 §2-1). 부모 파일 무접촉.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayLabel } from './timeline-kinds';
import { foldRuns, groupByDay } from './timeline-fold';
import { useCustomerTimeline, type TimelineEvent } from './useCustomerTimeline';
import Customer360Header from './Customer360Header';
import Customer360Rail from './Customer360Rail';
import TimelineToolbar from './TimelineToolbar';
import TimelineList from './TimelineList';
import { TimelineEmpty, TimelineError, TimelineSkeleton } from './TimelineStates';
import { C360_BODY, C360_COL, C360_LIST, C360_LIST_DIM } from './c360-ui';

interface Props {
  customerId: string;
  /** 목록에서 넘어온 값 — 응답이 오기 전에도 헤더를 그린다(빈 화면을 보이지 않는다) */
  fallbackName?: string | null;
  fallbackPhone?: string | null;
  onClose: () => void;
  /** 레일 "기본 정보"에 넣을 내용. 목록 화면이 이미 갖고 있는 필드 표를 그대로 받는다 */
  basicInfo?: React.ReactNode;
  /** 발송 결과 상세로 보내기(캠페인 참조가 있을 때만. 배선은 부모 몫 — 별건) */
  onOpenCampaign?: (campaignId: string) => void;
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

export default function Customer360Panel({ customerId, fallbackName, fallbackPhone, onClose, basicInfo, onOpenCampaign }: Props) {
  const t = useCustomerTimeline(customerId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullText, setFullText] = useState<Set<string>>(new Set());
  // 데스크톱은 레일이 독립 스크롤이라 펼쳐 두어도 타임라인이 안 밀린다. 모바일은 세로를 아끼려 접는다
  const [basicOpen, setBasicOpen] = useState<boolean>(() => isDesktop());

  // 고객·조건이 바뀌면 펼침을 버린다(같은 키가 다른 행을 가리킬 수 있다)
  useEffect(() => { setExpanded(new Set()); setFullText(new Set()); }, [customerId, t.active, t.qApplied, t.range]);

  const toggle = useCallback((key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);
  const toggleFull = useCallback((key: string) => setFullText((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);

  // 접기 → 날짜 묶음. 누적 배열 전체에 걸어 페이지 경계를 다시 계산한다(꼬리 규칙은 foldRuns 안)
  const groups = useMemo(() => {
    const folded = foldRuns<TimelineEvent>(t.events, { dayOf: dayLabel, hasMore: !!t.nextBefore });
    return groupByDay(folded, dayLabel);
  }, [t.events, t.nextBefore]);

  const firstLoad = t.loading && t.events.length === 0 && !t.error;

  return (
    <>
      <Customer360Header customer={t.customer} fallbackName={fallbackName} fallbackPhone={fallbackPhone} onClose={onClose} />

      <div className={C360_BODY}>
        <Customer360Rail
          summary={t.summary}
          loading={firstLoad}
          basicInfo={basicInfo}
          basicOpen={basicOpen}
          onToggleBasic={() => setBasicOpen((v) => !v)}
        />

        <section className={C360_COL} aria-label="활동 기록">
          <TimelineToolbar
            qInput={t.qInput}
            onQInput={t.setQInput}
            onQEnter={t.applyNow}
            onQClear={t.clearQ}
            range={t.range}
            onRange={t.setRange}
            active={t.active}
            onKind={t.selectKind}
            conditioned={t.conditioned}
            onClearAll={t.clearAll}
            sources={t.sources}
            hasEvents={t.events.length > 0}
          />

          <div className={t.refreshing ? C360_LIST_DIM : C360_LIST} aria-live="polite" aria-busy={t.refreshing || firstLoad}>
            {firstLoad ? (
              <TimelineSkeleton />
            ) : t.error ? (
              <TimelineError message={t.error} onRetry={t.retry} />
            ) : t.events.length === 0 ? (
              <TimelineEmpty
                active={t.active}
                q={t.qApplied}
                rangeIsAll={t.range === 'all'}
                onShowAll={() => t.selectKind(null)}
                onClearQ={t.clearQ}
                onRangeAll={() => t.setRange('all')}
              />
            ) : (
              <TimelineList
                groups={groups}
                expanded={expanded}
                onToggle={toggle}
                fullText={fullText}
                onToggleFullText={toggleFull}
                q={t.qApplied}
                onOpenCampaign={onOpenCampaign}
                nextBefore={t.nextBefore}
                loadingMore={t.loadingMore}
                moreError={t.moreError}
                onMore={t.loadMore}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
