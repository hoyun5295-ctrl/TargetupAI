/**
 * ReportV2View — v2 스토리형 진단 리포트 (v3 개편 · v6 채움 킥 · v7 장 넘김 · v8 읽힘 재설계)
 *
 * 장(章) 구성 = ①지금 어디에 계신가(표지·요약 수치·단계·답해 주신 것) ②잘하는 것과 걸리는 것
 * ③아쉬운 곳(병목 인과 4박자) ④다음 30일 — 미리보기는 ④가 「전체 리포트 받기」.
 *
 * v8 읽힘 계약 (Harold 지적: "문서가 잘 안 읽힌다 · 임팩트가 없다")
 *   - **줄 길이 40자 안팎**(`.measure` = max-w-[560px]). 국문은 이 폭을 넘기면 문장이 벽이 된다.
 *   - **타이포 층 셋**: 장 제목(20~24) → 소제목(17 굵은 흰색) → 본문(14.5). 12px 회색 대문자 라벨은 제목이 아니다.
 *   - **블록마다 그릇을 다르게**(표 / 좌측선 / 면 / 카드) — 스크롤할 때 재질이 바뀌어야 덩어리가 보인다.
 *   - **훑을 것을 만든다**: 답변은 `키 : 값` 표, 칭찬·짚임은 첫 문장을 제목으로, 표지에 요약 수치, 병목에 순번.
 *   - 요약 수치는 서버 `tally`가 소유한다 — 화면이 axes로 다시 세면 판정 기준이 두 벌이 된다.
 *
 * 홍보 위치 계약
 *   - 진단 구간(표지·답해 주신 것·칭찬·짚임·축별 판정)에 자사명 0.
 *   - 자사 연결은 병목 카드의 채움 킥과 견적 구간뿐. **주어 「한줄로에서는」은 이 파일의 라벨이 소유**하고
 *     서버 문장에는 자사명이 없다 — 킥을 지워도 진단이 성립한다(삭제 테스트가 구조로 보장된다).
 *   - 킥 옆의 「먼저 해보실 것」(도구 중립 처방)을 없애지 않는다. 없애면 진단서가 판매 문서가 된다.
 *   - preview(퍼널 B 폼 앞) = plan30·effects·recommendation 부재. 흐림·자물쇠 0(부재가 정직).
 *   - 전 필드 방어적 접근(preview 부분 결과·구 스냅샷 — 백지 크래시 금지).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageSquareText, RotateCcw, X } from 'lucide-react';
import type { DiagnosisFillDto, DiagnosisResultDto } from './diagnosisApi';

const EXAMPLE_CHANNELS = [
  { key: 'dm', label: '모바일 DM' },
  { key: 'email', label: '이메일' },
  { key: 'inapp', label: '인앱 메시지' },
] as const;

/** 국문 가독 폭 — 40자 안팎. 카드는 넓어도 문장은 이 폭을 넘지 않는다. */
const MEASURE = 'max-w-[560px]';

function dDay(trialExpiresAt?: string | null): number | null {
  if (!trialExpiresAt) return null;
  const diff = new Date(trialExpiresAt).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) return null;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/**
 * 첫 문장을 제목으로, 나머지를 설명으로 가른다.
 * 원장 문장이 전부 "요약. 설명." 2문장 구조라는 것은 backend 계약 테스트가 잠근다
 * (`marketing-diagnosis-v3.test.ts` — 제목·설명 2단 분리 계약).
 */
function splitLead(text: string): [string, string] {
  const t = (text ?? '').trim();
  const m = /^(.+?[.!?])\s+([\s\S]+)$/.exec(t);
  return m ? [m[1], m[2]] : [t, ''];
}

/** 구 스냅샷(v6 배포분)의 킥은 문자열 한 줄이다 — 두 줄 구조로 흡수한다. */
function normalizeFill(fill?: DiagnosisFillDto): { gone: string; how: string } | null {
  if (!fill) return null;
  if (typeof fill === 'string') {
    const [gone, how] = splitLead(fill);
    return gone ? { gone, how } : null;
  }
  return fill.gone ? { gone: fill.gone, how: fill.how ?? '' } : null;
}

function SectionHead({ title, accent = 'rgba(255,255,255,.25)', count }: {
  title: string; accent?: string; count?: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-[17px] w-[3px] shrink-0 rounded-sm" style={{ background: accent }} aria-hidden />
      <h3 className="text-[17px] font-extrabold tracking-tight text-white">{title}</h3>
      {count !== undefined && <span className="text-xs font-bold text-white/35">{count}</span>}
    </div>
  );
}

interface Props {
  result: DiagnosisResultDto;
  outcome?: DiagnosisResultDto['grant_outcome'];
  trialExpiresAt?: string | null;
  /** 표지 1층 — A는 회사명, B는 폼 뒤 재렌더에서 회사명. 없으면 서버 cover.subject(접점 구절). */
  coverTitle?: string | null;
  /** 퍼널 B 폼 앞 미리보기 — 실행 순서·견적 대신 부재 안내를 그린다. */
  previewMode?: boolean;
  /** 퍼널 B 리드 폼 — 마지막 장 안에 함께 싣는다(장 밖에 두면 장 넘김의 이점이 사라진다). */
  previewFooter?: ReactNode;
  onFirstSend?: () => void;
  onConsult?: () => void;
  onSeePlans?: () => void;
  onLater?: () => void;
}

export default function ReportV2View({
  result, outcome, trialExpiresAt, coverTitle, previewMode = false, previewFooter,
  onFirstSend, onConsult, onSeePlans, onLater,
}: Props) {
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const effectiveOutcome = outcome ?? result.grant_outcome;
  const d = dDay(trialExpiresAt);
  const industry = result.examples?.industry ?? null;

  const stage = result.stage ?? null;
  const cover = result.cover ?? null;
  const obsItems = Array.isArray(result.observation?.items) ? result.observation!.items : [];
  const praises = Array.isArray(result.praises) ? result.praises : [];
  const insights = Array.isArray(result.insights) ? result.insights : [];
  const axes = Array.isArray(result.axes) ? result.axes : [];
  const gaps = Array.isArray(result.gaps) ? result.gaps : [];
  const plan30 = Array.isArray(result.plan30) ? result.plan30 : [];
  const effects = Array.isArray(result.effects) ? result.effects : [];
  const subjectLine = coverTitle || cover?.subject || null;
  const tally = result.tally ?? null;

  const axesLine = tally && tally.total > 0
    ? tally.gap === 0
      ? `${tally.total}가지 모두 자리를 잡았어요.`
      : tally.good === 0
        ? `${tally.total}가지 전부 아직 시작 단계예요.`
        : `${tally.total}가지 중 ${tally.good}가지는 자리를 잡았고, ${tally.gap}가지가 걸려요.`
    : null;
  /** 축 목록은 등급 내림차순이라 첫 「걸리는 축」 앞에서 한 번 끊어 준다. */
  const firstGapIdx = axes.findIndex((a) => (Number(a.level) || 0) <= 1);

  const chapters: Array<{ key: string; title: string; body: ReactNode }> = [];

  // ── 1장 — 지금 어디에 계신가 ──
  chapters.push({
    key: 'where',
    title: '지금 어디에 계신가',
    body: (
      <>
        {/* 표지 — 강점절 + 약점절 2행(명도로만 가른다 · 색 = 성적표 금지) */}
        <div className={MEASURE}>
          <p className="text-[12px] text-white/45">
            {subjectLine ? `${subjectLine}의 마케팅 진단` : '마케팅 진단'}
          </p>
          <div className="mt-2.5 text-[27px] font-extrabold leading-[1.26] tracking-[-0.035em] md:text-[34px]">
            {cover?.strength_clause && cover?.gap_clause ? (
              <>
                <span className="block text-white">{cover.strength_clause},</span>
                <span className="block text-white/50">{cover.gap_clause}</span>
              </>
            ) : (
              <span className="block text-white">{cover?.headline ?? result.summary}</span>
            )}
          </div>
        </div>

        {/* 요약 수치 — 진단서에 손에 잡히는 수를 만든다(판정은 서버 tally) */}
        {tally && (
          <div className="grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="p-4">
              <p className="text-[11px] font-semibold text-white/40">잘 되고 있는 것</p>
              <p className="mt-1.5 text-[27px] font-extrabold leading-none tracking-tight text-emerald-300">
                {tally.good}
                <span className="ml-1 align-baseline text-[13px] font-semibold tracking-normal text-white/45">가지</span>
              </p>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold text-white/40">걸리는 것</p>
              <p className="mt-1.5 text-[27px] font-extrabold leading-none tracking-tight text-rose-300">
                {tally.gap}
                <span className="ml-1 align-baseline text-[13px] font-semibold tracking-normal text-white/45">가지</span>
              </p>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold text-white/40">지금 단계</p>
              <p className="mt-2 text-[19px] font-extrabold leading-tight tracking-tight text-white">
                {stage?.issued ? stage.label : '확인 중'}
              </p>
            </div>
          </div>
        )}

        {/* 단계 눈금 */}
        {stage && (
          <div className={MEASURE}>
            {stage.issued ? (
              <>
                <div className="flex gap-1.5" aria-hidden>
                  {(stage.scale ?? []).map((label, i) => (
                    <div
                      key={label}
                      className={`h-[7px] flex-1 rounded-full ${
                        i < stage.position ? 'bg-white/30'
                        : i === stage.position ? 'bg-gradient-to-r from-sky-400 to-indigo-400 shadow-[0_0_18px_rgba(56,189,248,0.45)]'
                        : i === stage.position + 1 ? 'bg-white/15'
                        : 'bg-white/[0.07]'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px] font-bold text-white">{stage.label}</p>
                  {Array.isArray(stage.scale) && stage.scale[stage.position + 1] && (
                    <p className="text-[12px] text-white/40">다음은 {stage.scale[stage.position + 1]}</p>
                  )}
                </div>
                <p className="mt-1.5 text-[14.5px] leading-[1.7] text-white/60">{stage.line}</p>
              </>
            ) : (
              <p className="text-[14.5px] leading-[1.7] text-white/60">
                「잘 모르겠어요」 답이 많아 단계는 확정하지 않았어요. 아래 소견은 확인된 답만으로 정리했어요.
              </p>
            )}
          </div>
        )}

        {/* 답해 주신 것 — 문장 나열이 아니라 키·값 표(자기 답이 한눈에 들어오게) */}
        {obsItems.length > 0 && (
          <section className={MEASURE}>
            <SectionHead title="답해 주신 것" />
            <p className="mt-1.5 text-[13.5px] leading-[1.65] text-white/45">
              판단은 붙이지 않았어요. 그대로 되읽어 드립니다.
            </p>
            <div className="mt-3.5 border-t border-white/[0.09]">
              {obsItems.map((it, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-0.5 border-b border-white/[0.06] px-0.5 py-2.5 sm:grid-cols-[116px_1fr] sm:gap-3.5"
                >
                  {it.key ? (
                    <>
                      <p className="pt-px text-[13px] text-white/42">{it.key}</p>
                      <p className="text-[14.5px] font-semibold leading-snug text-white/90">
                        {it.value}
                        {it.measured && (
                          <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-white/50">
                            실측
                          </span>
                        )}
                      </p>
                    </>
                  ) : (
                    // 구 스냅샷 — 키·값이 없으면 원래 문장을 그대로 그린다
                    <p className="text-[14.5px] leading-snug text-white/80 sm:col-span-2">{it.text}</p>
                  )}
                </div>
              ))}
            </div>
            {result.observation?.source && (
              <p className="mt-3.5 text-[10.5px] italic text-white/28">Data source — {result.observation.source}</p>
            )}
          </section>
        )}
      </>
    ),
  });

  // ── 2장 — 잘하는 것과 걸리는 것 ──
  if (praises.length > 0 || insights.length > 0 || axes.length > 0) {
    chapters.push({
      key: 'read',
      title: '잘하는 것과 걸리는 것',
      body: (
        <>
          {/* 잘하고 있는 것 — 카드 없이 좌측선. 첫 문장이 제목, 나머지가 설명 */}
          {praises.length > 0 && (
            <section className={MEASURE}>
              <SectionHead title="잘하고 있는 것" accent="rgba(52,211,153,.7)" count={praises.length} />
              <div className="mt-3.5 flex flex-col gap-4">
                {praises.map((t, i) => {
                  const [title, detail] = splitLead(t);
                  return (
                    <div key={i} className="border-l-2 border-emerald-400/55 pl-3.5">
                      <p className="text-[15.5px] font-bold leading-snug text-white">{title}</p>
                      {detail && <p className="mt-1 text-sm leading-[1.7] text-white/60">{detail}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 짚이는 것 — 모순 조합 관찰문(감점이 아니라 소견) */}
          {insights.length > 0 && (
            <section className={MEASURE}>
              <SectionHead title="짚이는 것" accent="rgba(251,191,36,.7)" count={insights.length} />
              <div className="mt-3.5 flex flex-col gap-3">
                {insights.map((t, i) => {
                  const [title, detail] = splitLead(t);
                  return (
                    <div key={i} className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-4">
                      <p className="text-[15.5px] font-bold leading-snug text-white">{title}</p>
                      {detail && <p className="mt-1.5 text-sm leading-[1.7] text-white/62">{detail}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 축별 판정 — 잘하는 축과 걸리는 축 사이를 끊고 등급에 색을 준다 */}
          {axes.length > 0 && (
            <section>
              <div className={MEASURE}>
                <SectionHead title="여섯 가지로 나눠 봤어요" />
                {axesLine && <p className="mt-1.5 text-[13.5px] leading-[1.65] text-white/45">{axesLine}</p>}
              </div>
              <div className="mt-3.5 rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:p-[17px]">
                {axes.map((a, i) => {
                  const lv = Math.min(3, Math.max(0, Number(a.level) || 0));
                  const width = Math.max(9, Math.round((lv / 3) * 100));
                  const bar = lv >= 3 ? 'from-emerald-400 to-emerald-300'
                    : lv === 2 ? 'from-emerald-400 to-emerald-200'
                    : lv === 1 ? 'from-amber-500 to-amber-300'
                    : 'from-rose-400 to-rose-400';
                  const grade = lv >= 3 ? 'text-emerald-300' : lv === 2 ? 'text-emerald-200'
                    : lv === 1 ? 'text-amber-300' : 'text-rose-300';
                  return (
                    <div key={a.axis}>
                      {i === firstGapIdx && i > 0 && <div className="my-2.5 border-t border-dashed border-white/10" />}
                      <div className="grid grid-cols-[76px_1fr_82px] items-center gap-3 py-2">
                        <span className="text-[14px] font-semibold text-white/85">{a.label}</span>
                        <span className="h-[7px] overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
                          <span className={`block h-full rounded-full bg-gradient-to-r ${bar}`} style={{ width: `${width}%` }} />
                        </span>
                        <span className={`text-right text-[12px] font-bold ${grade}`}>{a.level_label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[10.5px] italic text-white/28">Data source — 답변 기준 자가 진단</p>
            </section>
          )}
        </>
      ),
    });
  }

  // ── 3장 — 아쉬운 곳(병목 인과 4박자 + 두 갈래) ──
  if (gaps.length > 0) {
    chapters.push({
      key: 'gaps',
      title: gaps.length === 1 ? '아쉬운 곳 하나' : gaps.length === 2 ? '아쉬운 곳 둘' : '아쉬운 곳 셋',
      body: (
        <>
          <p className={`${MEASURE} -mt-1 text-[13.5px] leading-[1.65] text-white/45`}>
            먼저 손대면 나머지가 따라오는 순서로 놓았어요.
          </p>
          {gaps.map((g, i) => {
            const [dirTitle, dirDetail] = splitLead(g.direction ?? '');
            const fill = normalizeFill(g.fill);
            return (
              <div
                key={g.axis}
                className={`relative overflow-hidden rounded-[18px] p-5 ${
                  i === 0
                    ? 'border border-rose-400/30 bg-gradient-to-b from-rose-500/10 to-rose-500/[0.04]'
                    : 'border border-amber-400/24 bg-gradient-to-b from-amber-500/[0.08] to-amber-500/[0.03]'
                }`}
              >
                <span
                  className="pointer-events-none absolute right-4 top-1.5 text-[52px] font-extrabold leading-none tracking-[-0.05em] text-white/[0.05]"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-base font-extrabold tracking-tight text-white">{g.label}</p>
                {g.heard && <p className="mt-1.5 text-[13px] text-white/45">{g.heard}</p>}
                <p className={`${MEASURE} mt-3.5 text-[18px] font-extrabold leading-[1.45] tracking-[-0.025em] text-white`}>
                  {g.cause}
                </p>
                <p className={`${MEASURE} mt-2 text-[14.5px] leading-[1.75] text-white/66`}>{g.effect}</p>

                {/* 두 갈래 — 직접 하는 길 / 한줄로로 가는 길. 왼쪽을 없애면 진단서가 판매 문서가 된다 */}
                <div className="mt-4 grid gap-2.5 md:grid-cols-2">
                  {g.direction && (
                    <div className="rounded-[13px] border border-white/[0.13] bg-white/[0.035] p-[14px]">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-white/40">
                        <span className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden />
                        먼저 해보실 것
                      </p>
                      <p className="mt-2 text-[14.5px] font-bold leading-snug text-white/[0.88]">{dirTitle}</p>
                      {dirDetail && <p className="mt-1 text-[12.5px] leading-[1.7] text-white/55">{dirDetail}</p>}
                    </div>
                  )}
                  {fill && (
                    <div className="rounded-[13px] border border-sky-400/30 bg-gradient-to-br from-sky-500/[0.13] to-indigo-500/[0.08] p-[14px]">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-sky-300">
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                        한줄로에서는
                      </p>
                      <p className="mt-2 text-[14.5px] font-bold leading-snug text-white">{fill.gone}</p>
                      {fill.how && <p className="mt-1 text-[12.5px] leading-[1.7] text-white/70">{fill.how}</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ),
    });
  }

  // ── 4장 — 다음 30일(full) / 전체 리포트 받기(preview) ──
  chapters.push({
    key: 'next',
    title: previewMode ? '전체 리포트 받기' : '다음 30일',
    body: (
      <>
        {!previewMode && plan30.length > 0 && (
          <section>
            <div className={MEASURE}><SectionHead title="30일 실행 순서" /></div>
            <div className="mt-3.5 flex flex-col gap-3.5">
              {plan30.map((s, i) => (
                <div key={i} className="flex items-start gap-3.5">
                  <span className="mt-0.5 shrink-0 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/60">
                    {s.week}
                  </span>
                  <div className={`${MEASURE} min-w-0`}>
                    <p className="text-[15px] font-bold leading-snug text-white">{s.title}</p>
                    <p className="mt-1 text-[14.5px] leading-[1.75] text-white/70">{s.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {previewMode && (
          <p className={`${MEASURE} text-[14.5px] leading-[1.75] text-white/60`}>
            {result.plan_note || '30일 실행 순서는 신청 후 담당자가 함께 정리해 드려요.'}
          </p>
        )}

        {/* 실적(A) — 서버 계산 스냅샷 */}
        {!previewMode && effects.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {effects.map((e, i) => (
              <div key={`${e.kind}-${i}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] font-semibold text-white/40">{e.label}</p>
                <p className="mt-1.5 text-[15px] font-bold leading-snug text-white">{e.value}</p>
                <p className="mt-2.5 text-[10.5px] italic text-white/28">Data source — {e.source}</p>
              </div>
            ))}
          </div>
        )}

        {/* 업종 예시 목업 — 처방의 증거. v6부터 미리보기(폼 앞)에도 낸다 */}
        {industry && (
          <section>
            <div className={MEASURE}><SectionHead title="이 분야에서는 이렇게 씁니다" /></div>
            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {EXAMPLE_CHANNELS.map((ch) => {
                const src = `/diagnosis-examples/${industry}-${ch.key}.html`;
                return (
                  <button
                    key={ch.key}
                    type="button"
                    onClick={() => setZoom({ src, label: ch.label })}
                    className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition-all hover:border-sky-400/40"
                  >
                    <div className="pointer-events-none h-44 overflow-hidden bg-slate-950">
                      <iframe
                        title={`${ch.label} 예시`}
                        src={src}
                        sandbox=""
                        loading="lazy"
                        className="h-[352px] w-[200%] origin-top-left scale-50 border-0"
                      />
                    </div>
                    <p className="px-3 py-2.5 text-xs font-bold text-white/80">{ch.label} 예시 보기</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[10.5px] italic text-white/28">예시 목업 · 가상 브랜드 · 실제 고객 사례 아님</p>
          </section>
        )}

        {/* 구분선 + 견적 — 리포트는 위에서 끝났고, 아래는 실행 수단 안내 */}
        {!previewMode && (
          <div className="border-t border-white/10 pt-5">
            {result.recommendation ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 md:p-5">
                <p className="text-[11px] font-bold tracking-wide text-white/40">이 처방을 실행하려면</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[19px] font-extrabold tracking-tight text-white">
                    {result.recommendation.plan_name}
                    <span className="ml-2 text-sm font-semibold text-white/55">
                      월 {Number(result.recommendation.monthly_price ?? 0).toLocaleString()}원
                    </span>
                  </p>
                  {onSeePlans && (
                    <button
                      type="button"
                      onClick={onSeePlans}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/85 transition-colors hover:border-sky-400/40 hover:text-white"
                    >
                      다른 요금제 보기 <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                {Array.isArray(result.recommendation.reasons) && result.recommendation.reasons.length > 0 && (
                  <ul className="mt-3.5 flex flex-col gap-1.5 border-t border-white/10 pt-3.5">
                    {result.recommendation.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-white/60">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" aria-hidden />
                        <span>
                          「{r.question}」에 <span className="font-semibold text-white/80">{r.option}</span>라고 답하셔서예요.
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.pitch_note && (
                  <p className="mt-2.5 text-[12px] text-white/50">{result.pitch_note}</p>
                )}
                <p className="mt-3 text-[10.5px] italic text-white/28">Data source — 답변 × 요금제 실데이터(요금제 표가 진실)</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 md:p-5">
                <p className={`${MEASURE} text-[15px] font-bold leading-snug text-white/85`}>
                  {result.no_match_kind === 'over_range'
                    ? '지금 규모는 표준 요금제 범위를 넘어요. 맞는 구성은 상담으로 함께 잡아 드릴게요.'
                    : '딱 맞는 요금제는 상담으로 함께 확인해 드릴게요.'}
                </p>
              </div>
            )}
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {effectiveOutcome === 'granted' && onFirstSend && (
                <button
                  type="button"
                  onClick={onFirstSend}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm transition-all hover:shadow-lg"
                >
                  첫 발송 해보기 <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              )}
              {(effectiveOutcome === 'not_eligible' || effectiveOutcome === 'already_granted' || result.no_match) && onConsult && (
                <button
                  type="button"
                  onClick={onConsult}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm transition-all hover:shadow-lg"
                >
                  <MessageSquareText className="h-4 w-4" aria-hidden />
                  {result.no_match ? '상담으로 확인하기' : '추천 요금제로 상담 신청'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 퍼널 B 리드 폼 — 마지막 장 안(장 넘김의 종착지가 곧 신청 자리) */}
        {previewMode && previewFooter}

        {!previewMode && onLater && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={onLater}
              className="min-h-[44px] rounded-xl px-4 py-2 text-sm text-white/50 transition-colors hover:text-white/80"
            >
              나중에 결정할게요
            </button>
          </div>
        )}
      </>
    ),
  });

  const total = chapters.length;
  const idx = Math.min(chapterIdx, total - 1);
  const current = chapters[idx];
  const isLast = idx === total - 1;

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(total - 1, next));
    if (bounded === idx) return;
    setChapterIdx(bounded);
  };

  /** 장을 옮길 때 스크롤 컨테이너를 맨 위로 — 없으면 새 장이 중간부터 보인다(모달·페이지 양쪽). */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') { node.scrollTop = 0; return; }
      node = node.parentElement;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [idx]);

  /** ← → 로도 넘긴다. 입력 중이거나 확대 보기가 떠 있으면 개입하지 않는다. */
  useEffect(() => {
    if (total <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (zoom) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.key === 'ArrowRight') goTo(idx + 1);
      else if (e.key === 'ArrowLeft') goTo(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div ref={rootRef} className="flex flex-col gap-6 break-keep">
      {/* 체험 지급 고지 — 첫 장에서만(지급 영수증이 매 장을 차지하지 않게) */}
      {effectiveOutcome === 'granted' && idx === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2 text-[13px] font-semibold text-emerald-200">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          7일 무료체험이 시작됐어요{d != null ? ` · D-${d}` : ''}
        </div>
      )}

      {/* 장 머리 — 순번·제목 + 목차 눈금(클릭 이동) */}
      {total > 1 && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.22em] text-white/30">
              {String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </p>
            <h2 className="mt-1.5 truncate text-[21px] font-extrabold tracking-[-0.03em] text-white md:text-[23px]">
              {current.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center" role="tablist" aria-label="진단서 목차">
            {chapters.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`${i + 1}장 ${c.title}`}
                onClick={() => goTo(i)}
                className="grid h-10 w-6 place-items-center"
              >
                <span
                  className={`block h-[5px] rounded-full transition-all duration-300 ${
                    i === idx
                      ? 'w-6 bg-gradient-to-r from-sky-400 to-indigo-400'
                      : i < idx
                        ? 'w-[5px] bg-white/40 hover:bg-white/70'
                        : 'w-[5px] bg-white/15 hover:bg-white/40'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 장 본문 */}
      <div
        key={current.key}
        role="tabpanel"
        aria-label={current.title}
        className="flex animate-in flex-col gap-7 fade-in slide-in-from-bottom-2 duration-300"
      >
        {current.body}
      </div>

      {/* 장 넘김 바 — 스크롤을 따라오는 하나의 컨트롤 */}
      {total > 1 && (
        <div className="sticky bottom-0 z-10 pb-1 pt-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/85 p-2 shadow-2xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => goTo(idx - 1)}
              disabled={idx === 0}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">이전</span>
            </button>

            {/* 미리보기 — 어느 장에서 멈춰도 신청으로 갈 길을 남긴다(이탈 지점 = 전환 지점) */}
            {previewMode && !isLast && (
              <button
                type="button"
                onClick={() => goTo(total - 1)}
                className="min-h-[44px] rounded-xl px-2 text-[13px] font-semibold text-white/45 transition-colors hover:text-white/80"
              >
                바로 신청하기
              </button>
            )}

            <div className="flex-1" />

            {!isLast ? (
              <button
                type="button"
                onClick={() => goTo(idx + 1)}
                className="inline-flex min-h-[44px] max-w-[62%] items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all hover:shadow-xl"
              >
                <span className="truncate">{chapters[idx + 1].title}</span>
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goTo(0)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                처음부터 다시 보기
              </button>
            )}
          </div>
        </div>
      )}

      {/* 확대 보기 — 커스텀 오버레이(native dialog 0) */}
      {zoom && (
        <div
          className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setZoom(null); }}
        >
          <div className="relative flex h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <p className="text-sm font-semibold text-white">{zoom.label} 예시</p>
              <button
                type="button"
                onClick={() => setZoom(null)}
                aria-label="닫기"
                className="grid h-9 w-9 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <iframe title={`${zoom.label} 예시 확대`} src={zoom.src} sandbox="" className="w-full flex-1 border-0 bg-white" />
            <p className="border-t border-white/10 px-4 py-2 text-[10px] italic text-white/30">
              예시 목업 · 가상 브랜드 · 실제 고객 사례 아님
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
