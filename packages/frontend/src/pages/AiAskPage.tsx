/**
 * AiAskPage.tsx — 한 줄로 묻기 (★ 2026-11-21 C151 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §3 · 목업 docs/mockups/2026-11-21-ask-entry-flow-mockup.html)
 *
 * 처음 화면(한 줄 · 시작 줄 셋) → 1단계 누구에게(묶음 여섯 + 구매 기록 없음 · 격자) → 2단계 몇 명에게(모두 · 예산 · 순서)
 * → 3단계 무엇을(★ 2026-11-22 C153 = 알릴 내용 · 혜택 · 오실 곳 · 종류를 받은 뒤에만 문안을 만든다 · 카드 · 도착 확인 칩 = AI 한줄로 부품)
 * → 4단계 보내기(이 화면에서 지금 보내기 · 예약 = 직접발송 · AI 한줄로와 같은 확정 길 · 명단은 그때 서버가 다시 센다 · 설계서 docs/2026-11-22-c153-ask-step3-redesign-design.md).
 * ★ 2026-11-22 C157 — 보내는 방법 넓히기(문자 종류 = 2단계 · 칼럼 더 넣기 = 카드 · 이미지 = 3단계 · 고객별 매장 번호 · 나눠 보내기 = 4단계 ·
 *   명단은 서버가 싣고 고정한다 = POST /ask/stage → 확정에 서명 · 설계서 docs/2026-11-22-c157-ask-send-options-design.md §3).
 * ★ 2026-11-21 C152 B · C — 한 줄이 질문이면 답 화면(답 글 + 근거 + 표 · 크레딧 값은 단추에 · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §3-B) · 묶음 줄에 1인 평균 구매액.
 * 전용 틀(Harold 1121 결정 D1 · AI 존 남색 머리 띠를 쓰지 않는다) · 숫자 = 서버 값만 · 크레딧이 나가는 자리는 단추에 값을 적는다.
 * ⛔ 모델명 0 · 검사 방식 낱말 0 · native dialog 0 · 줄표 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { fetchGroupPerformance, perWonByGroup, perWonText } from '../utils/group-performance';   // ★ 2026-11-22 C154
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { creditCost } from '../constants/credit';
import {
  aiLineApi, AiLineApiError, spamFp, newAiLineRun, bodyOf, subjectOf, setBody, setSubject, audienceOf, AI_LINE_TYPE_META,
  type AiLineRun, type AiLineType,
} from '../utils/ai-line';
import { newAttemptToken } from '../utils/one-line';
import { useSendPolicy, isNightAdTime, sendWindowText } from '../utils/send-policy';
import { LMS_SUBJECT_MAX_CHARS, buildAdMessageFront, buildAdSubjectFront, adPrefixFront, adFooterFront, adLockedPartsFront, startsWithAdMark, calculateSmsBytes } from '../utils/formatDate';
import { hasUnsupportedSmsChars, SMS_CHARSET_BLOCK_MESSAGE } from '../utils/smsSafeChars';
import { useSenderAuth } from '../hooks/useSenderAuth';
import LineResultCards from '../components/ai-line/LineResultCards';
import MmsUploadModal from '../components/MmsUploadModal';
import { useMmsUpload } from '../hooks/useMmsUpload';
import { toMmsImagePaths } from '../utils/mmsImage';
import AskAnswerTables from '../components/ai-ask/AskAnswerTables';   // ★ 2026-11-22 C155
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import SenderAuthModal from '../components/SenderAuthModal';
import {
  ASK_BUDGET_CHIPS, ASK_COL_LABELS, ASK_LINE_MIN, ASK_ROW_LABELS,
  askBenefitMode, askBudgetOf, askBudgetValid, askGroupSendable, askInputFp, askParts, askTakeBlock, fmtNum,
  ASK_COPY_TYPES, askComposeBlock, askDefaultTypes, askSpamNote,
  ASK_QUESTION_MAX, ASK_THREAD_MAX, askHistoryOf, askFollowChips, type AskTurn, askAnswerAttemptKey, askGroupSpend, askSpendText,
  type AskAnswer, type AskCopyType, type AskCount, type AskGroupKey, type AskOrder, type AskPlace, type AskPlan, type AskSegments,
  ASK_CHANNELS, askBusyGate, askSendChannel, askSendFp, askSplitError, askStageLines, type AskChannel, type AskStage,
  askSendBody, askSendSubject, askOpt080Of,
} from '../utils/ai-ask';

type Step = 0 | 1 | 2 | 3 | 4;
type Start = 'line' | 'coupon' | 'pick' | 'budget';
/** 확정 한 건 — 준비분 id 가 든 확정 본문 · 확인 창에 보인 인원 · 이 흐름을 시작한 인증(끝날 때까지 이것 하나만 쓴다) */
/**   fp = 적재 때의 발송 지문(★ C157 · 확인 창의 보내기가 지금 화면의 값과 같을 때만 확정한다) */
interface SendJob { body: Record<string, unknown>; shown: number; token: string; fp: string }

const COMPOSE_COST = creditCost('ai-line-compose');
/** 답 받기 한 번(서버 단가표 ai-operator-explain 과 같은 표) */
const ANSWER_COST = creditCost('ai-operator-explain');
/** 문자 한도(서버 message-byte 와 같은 값) · 셈 = 실제로 나가는 글((광고) · 수신거부 꼬리 포함 · 번호 = 보내는 계정의 080 · 모르면 옛 10자리) · 종류 = 나가는 종류 */
const LMS_MAX_BYTES = 2000;
const SMS_MAX_BYTES = 90;
const maxBytesOf = (ch: AskChannel) => (ch === 'SMS' ? SMS_MAX_BYTES : LMS_MAX_BYTES);
// ★ 2026-11-27 C167-A(R111) — 셈 = 보낼 본문(askSendBody) · 실제 080 으로 합성한 글(가짜 번호 상수 걷음)
const sendBytes = (body: string, ch: AskChannel, opt080: string) => calculateSmsBytes(buildAdMessageFront(askSendBody(body), ch, true, opt080));
/** 발신번호 고르기의 「고객별 매장 번호」(AI 한줄로와 같은 뜻 = 고객의 매장 번호로 보낸다) */
const INDIVIDUAL_CB = '__individual__';
const priceWon = (n: number) => `${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
const PLACES: Array<{ key: AskPlace; label: string }> = [{ key: 'none', label: '적지 않음' }, { key: 'store', label: '매장 방문' }, { key: 'online', label: '온라인' }];
const errText = (e: unknown, fallback: string) => (e instanceof AiLineApiError || e instanceof Error ? e.message : fallback) || fallback;
const won = (n: number) => `${fmtNum(n)}원`;

function Chk({ on }: { on: boolean }) {
  return (
    <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-[#F97316] bg-[#F97316]' : 'border-[#D1D6DB] bg-white'}`} aria-hidden="true">
      {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
    </span>
  );
}

function Pill({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`h-[34px] whitespace-nowrap rounded-full px-3.5 text-[13.5px] font-semibold disabled:opacity-50 ${on ? 'bg-[#191F28] text-white' : 'bg-[#F2F4F6] text-[#4E5968]'}`}>
      {children}
    </button>
  );
}

const Label = ({ children, first }: { children: ReactNode; first?: boolean }) => (
  <span className={`block text-[12.5px] font-semibold text-[#636D7A] ${first ? '' : 'mt-[18px]'}`}>{children}</span>
);

export default function AiAskPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [lineDraft, setLineDraft] = useState('');
  const [lineHint, setLineHint] = useState<string | null>(null);
  const [usedLine, setUsedLine] = useState<string | null>(null);
  const [start, setStart] = useState<Start>('pick');

  // ★ C152 B 질문에 답하기 — asking = 질문으로 읽힌 줄(확인 줄) · answer = 받은 답 · flow = 흐름 번호(답 요청 · 시작이 올린다 = 앞서 떠난 읽기 응답이 화면을 못 바꾼다)
  const [asking, setAsking] = useState<{ line: string; groups: AskGroupKey[] } | null>(null);
  // ★ 2026-11-22 C155 — 답 화면 = 문답 줄(thread · 화면이 쥔다 · 서버에 저장하지 않는다) · answer = 가장 늦은 답(보내기 단추 · 묶음 표는 이것만)
  const [thread, setThread] = useState<AskTurn[]>([]);
  const [threadGroups, setThreadGroups] = useState<AskGroupKey[]>(['leave']);
  const answer = thread.length > 0 ? { ...thread[thread.length - 1], groups: threadGroups } : null;
  const [followDraft, setFollowDraft] = useState('');
  const [followHint, setFollowHint] = useState<string | null>(null);
  const [openTables, setOpenTables] = useState<number[]>([]);
  const lastTurnRef = useRef<HTMLElement | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<{ text: string; scoped: boolean } | null>(null);
  const answerAttempt = useRef<{ key: string; token: string } | null>(null);
  const flow = useRef(0);

  // 묶음 숫자(서버)
  const [seg, setSeg] = useState<AskSegments | null>(null);
  const [segState, setSegState] = useState<'loading' | 'ok' | 'error' | 'locked'>('loading');
  const [segError, setSegError] = useState('');
  const loadSegments = async () => {
    setSegState('loading');
    try {
      setSeg(await aiLineApi.askSegments());
      setSegState('ok');
    } catch (e) {
      if (e instanceof AiLineApiError && e.code === 'AI_OPERATOR_GATED') { setSegState('locked'); return; }
      setSegError(errText(e, '고객 묶음을 세지 못했어요.'));
      setSegState('error');
    }
  };
  useEffect(() => { void loadSegments(); }, []);
  // ★ 2026-11-22 C154 — 묶음별 「문자 1원당 매출」(성과 화면 카드와 같은 값 · 닫힌 회사 · 담당자 · 실패 = 빈 표 = 그 자리 비움 · 격자 첫 그림을 기다리게 하지 않는다)
  const [perWon, setPerWon] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let on = true;
    void fetchGroupPerformance().then((p) => { if (on) setPerWon(perWonByGroup(p)); });
    return () => { on = false; };
  }, []);

  // 고르기
  const [picked, setPicked] = useState<AskGroupKey[]>(['leave']);
  const [mode, setMode] = useState<'all' | 'budget'>('all');
  const [budget, setBudget] = useState(30_000);
  const [budgetText, setBudgetText] = useState('30,000');
  const [order, setOrder] = useState<AskOrder>('recent');
  const [mxOpen, setMxOpen] = useState(false);
  const groupsInOrder = useMemo(() => (seg ? seg.groups.map((g) => g.key).filter((k) => picked.includes(k)) : picked), [seg, picked]);
  // ★ 2026-11-22 C157 — 문자 종류(사람이 고른다 · 2단계) · 문안 진행(run)을 세기보다 먼저 둔다:
  //   나가는 종류 = 고른 종류 + 지금 고른 문안의 본문(askSendChannel · **상태로 쥐지 않고 매번 계산** · 주인은 서버 적재) → 세기 · 카드 · 요약이 이 값을 쓴다.
  const [channel, setChannel] = useState<AskChannel>('LMS');
  const [run, setRun] = useState<AiLineRun | null>(null);
  const runRef = useRef<AiLineRun | null>(null);
  runRef.current = run;
  const pickedType = (run?.picked ?? null) as AskCopyType | null;
  const bodyAt = (t: AiLineType) => (run ? bodyOf(run, t) : '');
  const pickedBody = pickedType ? bodyAt(pickedType) : '';
  /** 카드마다 나가는 종류(그 카드의 본문에서) — 도착 확인은 카드마다 자기 종류로 건다(고른 카드의 종류가 다른 카드의 검사를 바꾸지 않는다 · 구현 Codex 1R) */
  const channelAt = (t: AiLineType): AskChannel => askSendChannel(channel, bodyAt(t), seg?.varNames ?? []);
  const sendChannel = pickedType ? channelAt(pickedType) : channel;
  // ★ 2026-11-27 C167-A — 보내는 계정의 080(서버 · 확정과 같은 함수) · 모르면(옛 서버) 꼬리 「번호 확인 중」 · 바이트는 옛 10자리
  const opt080 = askOpt080Of(seg);
  /** 3단계 편집칸의 잠긴 머리 · 꼬리(합성이 실제로 붙이는 것만 · 보낼 본문 기준) */
  const pickedLocked = adLockedPartsFront(askSendBody(pickedBody), sendChannel, true, opt080.value);
  const basePlan = useMemo(() => ({ groups: groupsInOrder, mode, budget: mode === 'budget' ? budget : null, order }), [groupsInOrder, mode, budget, order]);
  /** plan = 사람이 고른 종류(문안 만들기 · 적재 요청에 싣는다) · countPlan = 나가는 종류(세기) · LMS 는 싣지 않는다(옛 요청과 같은 몸) */
  const plan: AskPlan = useMemo(() => (channel === 'LMS' ? basePlan : { ...basePlan, channel }), [basePlan, channel]);
  const countPlan: AskPlan = useMemo(() => (sendChannel === 'LMS' ? basePlan : { ...basePlan, channel: sendChannel }), [basePlan, sendChannel]);
  const planKey = JSON.stringify(countPlan);
  const toggle = (g: AskGroupKey) => setPicked((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  // 세기(서버 §2-1) — 고른 것이 바뀔 때마다 · 늦게 온 옛 응답은 버린다
  const [count, setCount] = useState<AskCount | null>(null);
  const [countBusy, setCountBusy] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const countSeq = useRef(0);
  const budgetOk = mode === 'all' || askBudgetValid(budget);
  useEffect(() => {
    const my = ++countSeq.current;
    if (step === 0 || plan.groups.length === 0 || !budgetOk || segState !== 'ok') { setCount(null); setCountBusy(false); setCountError(null); return; }
    setCountBusy(true);
    const t = setTimeout(async () => {
      try {
        const c = await aiLineApi.askCount(countPlan);
        if (countSeq.current === my) { setCount(c); setCountError(null); }
      } catch (e) {
        if (countSeq.current === my) {
          setCount(null);
          setCountError(errText(e, '인원을 세지 못했어요.'));
          // 단가가 정해지지 않은 회사 = 예산으로 고를 수 없다(그 사이 단가가 지워진 경우 · 1단계에서 갇히지 않게 모두로 되돌린다)
          if (e instanceof AiLineApiError && e.code === 'PRICE_UNSET') setMode('all');
        }
      } finally {
        if (countSeq.current === my) setCountBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, step === 0, budgetOk, segState]);

  // ── ★ 2026-11-22 C153 3단계 「무엇을」 — 내용은 사람이 정한다(설계서 docs/2026-11-22-c153-ask-step3-redesign-design.md §3) ──
  //   폼(무엇을 · 혜택 · 오실 곳 · 종류)을 받은 뒤 「문안 만들기」를 눌러야 만든다(2단계에서 넘어올 때 생성 0 · 크레딧 0).
  const [what, setWhat] = useState('');
  const [benefit, setBenefit] = useState('');
  const [none, setNone] = useState(false);
  const [place, setPlace] = useState<AskPlace>('none');
  const [link, setLink] = useState('');
  /** 사람이 종류를 고르기 전 = null(기본값 = 혜택 갈래에서 나온다) */
  const [typesPicked, setTypesPicked] = useState<AskCopyType[] | null>(null);
  const benefitMode = askBenefitMode(none, benefit);
  const types = typesPicked ?? askDefaultTypes(benefitMode);
  const nowFp = askInputFp({ line: what, groups: groupsInOrder, mode: benefitMode, benefit, place, link, types, channel });
  // 문안 진행 = AI 한줄로와 같은 모양(카드 · 칩 · 고른 문안 · 다듬은 글) · made = 만든 때의 입력 지문 + 서버가 본 카드별 알림
  const [made, setMade] = useState<{ fp: string; byType: Partial<Record<AskCopyType, { hole: boolean; ungrounded: string[]; body: string; subject: string }>> } | null>(null);
  const [making, setMaking] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const attemptRef = useRef<{ key: string; token: string } | null>(null);
  const gen = useRef(0);

  // 발신번호(등록 번호 · 기본 번호 먼저) — 도착 확인과 보내기가 같은 번호를 쓴다 · null = 아직 읽는 중
  const [cbList, setCbList] = useState<Array<{ phone: string; isDefault: boolean }> | null>(null);
  const [cbChoice, setCbChoice] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/companies/callback-numbers', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const d = r.ok ? await r.json().catch(() => null) : null;
        const list = (Array.isArray(d?.numbers) ? d.numbers : []).filter((c: any) => c?.phone).map((c: any) => ({ phone: String(c.phone), isDefault: !!c.is_default }));
        setCbList(list);
        setCbChoice((list.find((c: { isDefault: boolean }) => c.isDefault) || list[0])?.phone || '');
      } catch { setCbList([]); }
    })();
  }, []);
  // ★ C157 고객별 매장 번호 — 도착 확인은 기본 번호로 한다(AI 한줄로와 같은 규칙)
  const individual = cbChoice === INDIVIDUAL_CB;
  const callback = (individual ? ((cbList || []).find((c) => c.isDefault) || (cbList || [])[0])?.phone || '' : cbChoice).replace(/\D/g, '');

  // ★ C157 MMS 이미지(공용 올리기 훅 · 창) — 고른 종류가 MMS 일 때만 싣는다
  const [mmsError, setMmsError] = useState<string | null>(null);
  const [mmsOpen, setMmsOpen] = useState(false);
  const mms = useMmsUpload((msg) => setMmsError(msg));
  /**
   * 첨부를 바꾸는 손잡이의 문 — 이 화면이 이미지 창에 넘기는 손잡이는 **전부** 이 문으로 감싼다(올리기 · 여러 장 · 지우기 · 보관함에서 가져오기 · 자리 바꾸기).
   *   떠 있는 작업 수(attachBusy)가 0 이 아닌 동안 보내기 앞의 잠금이 걸린다. 작업 종류를 하나씩 세지 않는다
   *   (올리기만 보던 잠금이 지우기를 놓쳤다 = 구현 Codex 1R · 2R 같은 부류 → 손잡이를 내주는 자리 하나에서 센다).
   */
  const [attachBusy, setAttachBusy] = useState(0);
  //   ★ 구현 Codex 3R — 문 = askBusyGate(순수 · 손잡이를 불린 그 틱에 실행 = 이미지 창이 넘긴 파일 목록이 비워지기 전에 읽는다)
  const attach = askBusyGate(() => setAttachBusy((n) => n + 1), () => setAttachBusy((n) => Math.max(0, n - 1)));
  const images = useMemo(() => (channel === 'MMS' ? toMmsImagePaths(mms.mmsUploadedImages) : []), [channel, mms.mmsUploadedImages]);

  const composeBlock = askComposeBlock({ line: what, types, planned: count?.planned ?? 0, needImage: channel === 'MMS' && images.length === 0 });
  const compose = async (retry: boolean) => {
    if (making || composeBlock || countBusy) return;
    const fp = nowFp;
    const key = `${fp}|${retry ? 1 : 0}`;
    // 응답을 못 받은 같은 시도 = 같은 토큰(서버가 같은 키로 0 · 기억한 결과) · 성공하면 다음은 새 토큰
    if (!attemptRef.current || attemptRef.current.key !== key) attemptRef.current = { key, token: newAttemptToken() };
    const my = ++gen.current;
    setMaking(true);
    setComposeError(null);
    try {
      const out = await aiLineApi.askCompose({
        line: what.trim(), plan, benefitMode, benefit: benefitMode === 'custom' ? benefit.trim() : null,
        place, link: place === 'online' && link.trim() ? link.trim() : null, types, retryBlocked: retry, attemptToken: attemptRef.current.token,
      });
      if (gen.current !== my) return;
      attemptRef.current = null;
      // 새 문안 = 새 진행(앞 문안의 칩 · 고른 문안 · 다듬은 글을 남기지 않는다)
      // 제목 = 보낼 수 있는 길이로 맞춰 둔다(도착 확인 칩이 묶이는 글 = 실제로 나가는 글)
      const cards = out.cards.map((c) => ({ ...c, subject: c.subject.slice(0, LMS_SUBJECT_MAX_CHARS) }));
      setRun({
        ...newAiLineRun(what.trim()), channel: out.channel, types: cards.map((c) => c.type), picked: cards[0]?.type ?? null,
        // ★ C157 D13 — 검사 · 미리보기의 표본 고객과 칼럼 목록 = 이 실행의 것(다시 만들어야 바뀐다 · 카드 부품이 audienceOf(run) 로 읽는다)
        audience: { count: out.count, conditions: [], untranslated: [], top: out.sample ?? null, sampleCustomer: null, columns: out.columns ?? [] },
        audienceSet: true,
        cards: cards.map((c) => ({ type: c.type, label: c.label, body: c.body, subject: c.subject, byteCount: c.byteCount })),
      });
      setMade({ fp, byType: Object.fromEntries(cards.map((c) => [c.type, { hole: c.hole, ungrounded: c.ungrounded, body: c.body, subject: c.subject }])) });
    } catch (e) {
      if (gen.current === my) setComposeError(errText(e, '문안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.'));
    } finally {
      if (gen.current === my) setMaking(false);
    }
  };

  // 고른 문안 — 읽기 · 쓰기 = AI 한줄로 CT(bodyOf · setBody · subjectOf · setSubject)
  // 제목 = 단문(SMS)으로 나가면 없다(검사 지문 · 확정 본문이 같은 값) · 만든 글과의 대조(혜택 자리 · 입력에 없는 말)는 카드의 제목 그대로
  const cardSubject = pickedType && run ? subjectOf(run, pickedType) : '';
  const subjectAt = (t: AiLineType) => (run && channelAt(t) !== 'SMS' ? subjectOf(run, t) : '');
  const pickedSubject = pickedType ? subjectAt(pickedType) : '';
  const pickedMeta = pickedType && made ? made.byType[pickedType] : undefined;
  // 혜택 자리가 남았는가 = 서버가 본 그 글 그대로일 때만(사람이 고친 글은 발송 길목이 다시 본다)
  const pickedHole = !!pickedMeta?.hole && pickedBody === pickedMeta.body && cardSubject === pickedMeta.subject;
  const pickedUngrounded = pickedMeta && pickedBody === pickedMeta.body && cardSubject === pickedMeta.subject ? pickedMeta.ungrounded : [];
  const pickedChip = pickedType && run ? run.spam[pickedType] : undefined;

  // ★ C157 칼럼 더 넣기(카드 부품의 단추 · AI 한줄로와 같은 주소 · 1크레딧) — 꾸미는 동안 다음 · 보내기 · 이전 · 편집 칸을 잠근다(decorating).
  //   응답은 보낸 때의 실행 · 카드 · 본문이 지금도 같을 때만 쓴다(그 사이 달라졌으면 버리고 알린다 = 잠금이 놓친 길의 둘째 문).
  const [decorating, setDecorating] = useState(false);
  const decorate = async (t: AiLineType, vars: string[]) => {
    const at = runRef.current;
    if (!at || decorating) return;
    const runId = at.runId;
    const reqBody = bodyOf(at, t);
    setDecorating(true);
    try {
      // 칼럼이 든 글은 단문으로 나가지 않는다 → 단문을 골랐어도 LMS 로 꾸민다
      const out = await aiLineApi.decorate({ body: reqBody, vars, channel: channel === 'SMS' ? 'LMS' : channel, isAd: true, attemptToken: at.attemptToken });
      if (!out.changed) return;
      const cur = runRef.current;
      if (!cur || cur.runId !== runId || bodyOf(cur, t) !== reqBody) throw new Error('그 사이 문안이 바뀌어 칼럼 넣기 결과를 쓰지 않았어요. 다시 넣어 주세요.');
      setRun((r) => (r && r.runId === runId ? setBody(r, t, out.body) : r));
    } finally {
      setDecorating(false);
    }
  };

  /**
   * 보내기 앞의 잠금 — 발송 값을 뒤에서 바꾸는 작업이 떠 있는 동안(칼럼 넣기 = 본문 · 첨부를 바꾸는 손잡이 = 이미지) 다음 · 보내기 · 이전을 잠근다.
   *   이미지 창을 닫아도 그 작업이 끝날 때까지 잠긴다(끝나지 않은 첨부 변경을 둔 채 옛 이미지 목록으로 적재 · 확정되지 않는다 · 구현 Codex 1R · 2R).
   */
  const sendLocked = decorating || attachBusy > 0;

  // ★ C157 나눠 보내기(한 번에 몇 건 · 몇 분 간격 · 값 범위 = 서버 parseSplitSetting)
  const [splitOn, setSplitOn] = useState(false);
  const [splitCountText, setSplitCountText] = useState('1000');
  const [splitGapText, setSplitGapText] = useState('10');
  const splitCount = Number(splitCountText);
  const splitGap = Number(splitGapText);
  const splitErr = askSplitError(splitOn, splitCount, splitGap);

  /** 문답 줄 비우기(확인 없이 · 보내기 흐름으로 넘어갈 때 · 닫기를 확인한 뒤) */
  const closeThreadNow = () => { setThread([]); setFollowDraft(''); setFollowHint(null); setOpenTables([]); };

  // ── 시작 ──
  const begin = (from: Start, groups: AskGroupKey[], opts: { line?: string | null; budget?: number | null } = {}) => {
    // 답을 쓰는 동안에는 어떤 시작도 받지 않는다(★ C155 구현 Codex 1R) — 받은 답은 버리지 않고 문답 줄에 붙이므로, 그 사이 흐름이 바뀌면
    //   값을 낸 답이 다른 단계 뒤에 숨고 지운 대화가 되살아난다. 시작하는 자리가 여럿(시작 줄 · 표의 보내기 · 아래 단추)이라 문은 여기 하나에 둔다.
    if (answering) return;
    flow.current++;
    setAsking(null);
    closeThreadNow();
    setAnswerError(null);
    setStart(from);
    setUsedLine(opts.line ?? null);
    setPicked(groups);
    // 단가가 정해지지 않은 회사 = 예산으로 시작하지 않는다(서버가 예산 세기를 거절 · 2단계 예산 칸도 잠김)
    setMode((from === 'budget' || opts.budget) && !seg?.unitPrice.unset ? 'budget' : 'all');
    const b = opts.budget ?? 30_000;
    setBudget(b);
    setBudgetText(fmtNum(b));
    setOrder('recent');
    // ★ C153 — 처음 화면에서 적은 한 줄 = 3단계 「알릴 내용」에 채워 둔다(다시 입력 0 · 고칠 수 있다)
    setWhat(opts.line ?? '');
    setBenefit('');
    setNone(false);
    setPlace('none');
    setLink('');
    setTypesPicked(null);
    setChannel('LMS');
    mms.setMmsUploadedImages([]);
    setSplitOn(false);
    gen.current++;
    setRun(null);
    setMade(null);
    setMaking(false);
    setComposeError(null);
    attemptRef.current = null;
    setWhen('now');
    setLaterAt('');
    setSendError(null);
    setSent(null);
    hold(null);
    setStep(1);
  };
  // ★ 2026-11-22 C154 — 성과 화면 「이 묶음에 보내기」(/ai-ask?group=<키>) = 그 묶음을 고른 2단계로 연다.
  //   묶음 표(서버)에 있는 키일 때만 · 한 번만 · 주소 꼬리는 지운다(새로 고침 · 뒤로 가기가 다시 열지 않게).
  const groupParamDone = useRef(false);
  useEffect(() => {
    if (groupParamDone.current || segState !== 'ok' || !seg) return;
    groupParamDone.current = true;
    // 묶음 숫자가 오기 전에 사용자가 무엇이든 시작했으면(한 줄 적기 · 답 받기 · 고르기 = 흐름 번호가 올랐다) 자동으로 열지 않는다
    //   (늦게 온 응답이 받은 답 · 진행 중인 흐름을 지우지 않는다 · 구현 Codex 1R)
    if (flow.current !== 0) return;
    const k = new URLSearchParams(window.location.search).get('group');
    const hit = k ? seg.groups.find((g) => g.key === k) : undefined;
    if (!hit) return;
    begin('pick', [hit.key]);
    setStep(2);
    navigate('/ai-ask', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segState, seg]);
  const [reading, setReading] = useState(false);
  // 한 줄 읽는 동안에는 다른 시작을 받지 않는다(늦게 온 읽기 응답이 새로 고른 흐름 · 만든 문안을 덮지 않게 · 시작 줄 · Enter · 단추 모두 잠김)
  const beginFromLine = async () => {
    if (reading) return;
    const t = lineDraft.trim();
    if (t.length < ASK_LINE_MIN) { setLineHint(`한 줄을 ${ASK_LINE_MIN}자 이상 적어 주세요.`); return; }
    setLineHint(null);
    setAnswerError(null);
    setReading(true);
    const my = flow.current;
    try {
      const r = await aiLineApi.askRead(t);
      if (flow.current !== my) return;   // 그 사이 답 요청 · 다른 시작이 떠났다(늦은 읽기 응답이 화면을 덮지 않는다)
      // 질문으로 읽힌 줄 = 확인 줄(답 받기 · 보낼 고객 고르기) · 보내기로 읽힌 줄 = 지금 그대로 1단계
      if (r.intent === 'ask') { setAsking({ line: t, groups: r.groups }); return; }
      begin('line', r.groups, { line: t, budget: r.budget });
    } catch (e) {
      if (flow.current === my) setLineHint(errText(e, '한 줄을 읽지 못했어요. 다시 눌러 주세요.'));
    } finally {
      setReading(false);
    }
  };

  // ── ★ C152 B 답 받기(크레딧 값 = ANSWER_COST) — 요청 하나 = 시도 표 하나(응답을 못 받은 같은 질문 = 같은 표 = 서버가 낸 답 그대로 · 성공하면 비운다) ──
  //   ★ C155 follow = 이어 묻기(앞 문답을 맥락으로 싣는다 · 문답마다 새 시도 표 = 열쇠에 몇째 문답인지가 든다) · 실패해도 앞 문답은 남는다
  const askNow = async (line: string, groups: AskGroupKey[] = ['leave'], follow: boolean = false) => {
    if (answering || reading) return;
    const hint = follow ? setFollowHint : setLineHint;
    const t = line.trim();
    if (t.length < ASK_LINE_MIN) { hint(`${follow ? '질문을' : '한 줄을'} ${ASK_LINE_MIN}자 이상 적어 주세요.`); return; }
    if (t.length > ASK_QUESTION_MAX) { hint(`질문은 ${ASK_QUESTION_MAX}자 안으로 적어 주세요.`); return; }
    const before = follow ? thread : [];
    if (before.length >= ASK_THREAD_MAX) return;
    flow.current++;   // 앞서 떠난 읽기 응답은 이제 화면을 못 바꾼다
    const key = askAnswerAttemptKey(t, before.length);
    if (!answerAttempt.current || answerAttempt.current.key !== key) answerAttempt.current = { key, token: newAttemptToken() };
    hint(null);
    setAnswerError(null);
    setAnswering(true);
    try {
      const data = await aiLineApi.askAnswer(t, answerAttempt.current.token, askHistoryOf(before));
      // 낸 답은 버리지 않는다(Codex 구현 2R) — 답을 쓰는 동안 입력 칸 · 시작 줄 · 단추가 전부 잠겨 흐름이 바뀌지 않고, 받은 답은 언제나 보여 준다
      answerAttempt.current = null;
      setAsking(null);
      setThread([...before, { question: t, data }]);
      if (follow) setFollowDraft('');
      else { setThreadGroups(groups); setOpenTables([]); window.scrollTo(0, 0); }
    } catch (e) {
      setAnswerError({ text: errText(e, '답을 받지 못했어요. 잠시 뒤 다시 눌러 주세요.'), scoped: e instanceof AiLineApiError && e.code === 'ASK_ANSWER_SCOPED' });
    } finally {
      setAnswering(false);
    }
  };
  // 이어 물은 답이 붙으면 그 문답으로 내려간다(첫 답은 맨 위)
  useEffect(() => {
    if (thread.length > 1) lastTurnRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [thread.length]);
  /** 대화 닫기 — 문답이 둘 이상이면 먼저 묻는다(받은 답은 저장되지 않는다) */
  const closeThread = () => {
    if (thread.length < 2) { closeThreadNow(); return; }
    setConfirm({
      title: '대화를 닫을까요?', description: '받은 답은 다시 볼 수 없어요.', confirmLabel: '닫기', cancelLabel: '계속 보기',
      onConfirm: () => { closeThreadNow(); },
    });
  };

  const go = (s: Step) => { setStep(s); window.scrollTo(0, 0); };

  // ── ★ C153 4단계 「보내기」 — 이 화면에서 끝낸다(직접발송 · AI 한줄로와 같은 확정 길 = 명단 → 적재 → 집계 → 확인 → 확정 · 서버 발송 코드 무변경) ──
  const block = askTakeBlock({ making, cardFp: made?.fp ?? null, nowFp, benefitHole: pickedHole, planned: count?.planned ?? 0 });
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [laterAt, setLaterAt] = useState('');
  const sendPolicy = useSendPolicy();
  const senderAuth = useSenderAuth();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ count: number; scheduledAt: string | null; already: boolean } | null>(null);
  /** 한 번만 — 화면이 쥔 요청 하나(누르는 동안 잠금) */
  const sendLock = useRef(false);
  /** 확정을 보냈는데 답을 못 받은 요청(새로 싣지 않는다 · 「다시 확인」 = 서버에 접수됐는지 먼저 묻고, 없을 때만 같은 준비분으로 확정을 다시 보낸다) */
  const [unknown, setUnknown] = useState<SendJob | null>(null);
  /**
   * 쥔 준비분의 소유 = 이 한 곳 — 화면 표시(unknown)와 이어 가기 판정(heldRef)을 같이 바꾼다.
   *   놓을 때는 그 준비분에 묶여 있던 발신 인증 창 · 재시도도 같이 버린다(놓인 준비분이 뒤늦은 인증 통과로 다시 확정되지 않게).
   */
  const heldRef = useRef<SendJob | null>(null);
  const hold = (job: SendJob | null) => {
    heldRef.current = job;
    setUnknown(job);
    if (!job) senderAuth.cancel();
  };
  /** 발신 인증 뒤 이어 가기 — 그 확정 건을 지금도 쥐고 있을 때만(놓였거나 끝난 건은 다시 보내지 않는다) */
  const resume = (job: SendJob) => () => { if (heldRef.current === job) void commitSend(job); };

  /** 보내기 흐름의 서버 호출 — 인증은 흐름을 시작할 때 고정한 것 하나(token)만 쓴다. 본문을 못 읽으면 data = null(= 결과를 모른다) */
  /** 이 화면이 아직 떠 있는가 */
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ACCOUNT_CHANGED = '로그인한 계정이 바뀌었어요. 화면을 새로 고친 뒤 다시 진행해 주세요.';
  /**
   * 보내기 흐름의 서버 호출 한 곳 — 이 흐름의 모든 요청이 여기 문을 지난다(부르는 자리마다 따로 검사하지 않는다).
   *   문 = 화면을 떠났으면 보내지 않는다(조용히 멈춤) · 흐름을 시작한 계정이 아니면 보내지 않는다(알리고 멈춤) → 던진다 = 요청을 보내지 않았다.
   *   보냈는데 답을 못 받았으면 null(접수됐는지 모른다) · 본문을 못 읽으면 data null.
   */
  const sendCall = async (method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any } | null> => {
    if (!alive.current) throw new Error('');
    if ((localStorage.getItem('token') || '') !== token) throw new Error(ACCOUNT_CHANGED);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
    } catch {
      return null;
    }
  };

  useEffect(() => { if (sent) window.scrollTo(0, 0); }, [sent]);

  /** 보내는 때 검사(화면) — 예약 = 1분 뒤 · 발송 허용 시간(서버가 다시 판정한다) */
  const whenError = (): string | null => {
    if (when === 'now') return null;
    if (!laterAt) return '예약할 날짜와 시각을 골라 주세요.';
    const d = new Date(laterAt);
    if (Number.isNaN(d.getTime())) return '예약 시각이 올바르지 않아요.';
    if (d.getTime() <= Date.now() + 60_000) return '예약 시각은 지금부터 1분 뒤여야 해요.';
    if (sendPolicy && isNightAdTime(sendPolicy, d)) return `예약 시각은 ${sendWindowText(sendPolicy)} 사이여야 해요.`;
    return null;
  };

  const CHECK_AGAIN = '접수됐는지 확인하지 못했어요. [다시 확인]을 눌러 주세요. 새로 보내지 않고 같은 명단으로 확인해요.';
  const IN_PROGRESS = '앞서 누른 요청을 처리하는 중이에요. 잠시 뒤 [다시 확인]을 눌러 주세요.';
  const SEND_FAILED = '발송을 접수하지 못했어요. 잠시 뒤 다시 눌러 주세요.';

  /**
   * 접수 상태로 끝을 정한다 — 판정 = 서버의 캠페인 행 하나(GET /ask/sent). 확정 응답의 코드로 접수 여부를 짐작하지 않는다
   *   (같은 준비분 409 는 차감 전 처리 중도 포함하고 · 앞 요청이 접수된 뒤의 재시도는 400 으로도 온다).
   *   준비분은 확정을 보내기 전에 이미 쥐고 있다(commitSend). 여기서는 **놓는 자리만** 정한다 = 접수됨(끝) · 없음 + 서버가 본문으로 거절(reason).
   *   그 밖(처리 중 · 못 읽음 · 이 함수가 던짐)은 쥔 채다. 없음 + 거절 아님 = 'none'(부른 쪽이 잇는다).
   */
  const settle = async (job: SendJob, reason: string | null): Promise<'ended' | 'held' | 'released' | 'none'> => {
    const r = await sendCall('GET', `/api/ai-line/ask/sent/${encodeURIComponent(String(job.body.stagingId))}`, job.token);
    const state = r && r.ok && r.data?.success === true ? r.data.state : null;
    if (state === 'accepted') {
      hold(null);
      setSent({ count: job.shown, scheduledAt: job.body.scheduled ? String(job.body.scheduledAt) : null, already: true });
      return 'ended';
    }
    // 캠페인은 생겼는데 차감 · 전환 전 = 접수됐다고 말하지 않는다 · 다시 보내지도 않는다
    //   오래 풀리지 않으면(서버 판정 stuck) 새로 보내게 두지 않고 확인 번호를 알린다(운영 쪽에는 그때 경보가 가 있다)
    if (state === 'pending') {
      setSendError(r!.data.stuck === true
        ? `앞서 누른 요청의 처리가 오래 끝나지 않고 있어요. 새로 보내지 마시고 고객센터에 확인 번호 ${String(job.body.stagingId).slice(0, 8)}을 알려 주세요. 이 화면은 떠나셔도 돼요.`
        : IN_PROGRESS);
      return 'held';
    }
    if (state === 'none' && reason !== null) {
      hold(null);
      setSendError(reason);
      return 'released';
    }
    if (state === 'none') return 'none';
    setSendError(CHECK_AGAIN);
    return 'held';
  };

  /**
   * 확정 — 성공 응답만 그 자리에서 끝낸다. 그 밖의 모든 답(거절 · 겹침 · 5xx · 답 없음 · 본문 못 읽음)은 접수 상태(settle)가 판정한다.
   *   서버가 본문으로 거절한 4xx(겹침 IN_FLIGHT · 시간 초과 408 · 과다 요청 429 제외)는 그 문구를 들고 가서 · 접수 상태가 「없음」일 때만 준비분을 놓는다.
   *   **준비분은 보내기 전에 쥔다** — 그 뒤 어디서 끊겨도(답 없음 · 접수 확인 중 계정 변경 · 예외) 준비분이 남아 「다시 확인」으로만 간다(새 명단 · 새 적재 0).
   *   발신 인증 요구는 끝이 아니라 같은 확정 건이 이어질 자리다 → 접수되지 않았음이 확인된 뒤에 창을 열되 **준비분은 쥔 채**다
   *   (창이 떠 있는 동안 다른 준비분을 만들 길 0 · 통과하면 같은 확정 건을 그대로 다시 · 그만두면 cancelAuth 가 접수 상태로 판정해 놓는다).
   */
  const commitSend = async (job: SendJob) => {
    if (sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    setSendNote(job.body.scheduled ? '예약하는 중이에요' : '보내는 중이에요');
    try {
      hold(job);
      const r = await sendCall('POST', '/api/campaigns/direct-send/commit', job.token, job.body);
      if (r && r.ok && r.data?.success === true) {
        hold(null);
        setSent({ count: Number(r.data.accepted) || job.shown, scheduledAt: job.body.scheduled ? String(job.body.scheduledAt) : null, already: false });
        return;
      }
      const rejected = !!r && r.status >= 400 && r.status < 500 && ![408, 429].includes(r.status) && r.data?.success === false && r.data?.code !== 'IN_FLIGHT';
      const authAsk = r?.data?.code === 'SENDER_AUTH_REQUIRED' && !!r?.data?.senderAuth;
      const reason = !rejected || authAsk ? null
        : r!.status === 402 && r!.data?.insufficientBalance
          ? `잔액이 부족해요. 지금 ${fmtNum(Number(r!.data.balance) || 0)}원이고 ${fmtNum(Number(r!.data.requiredAmount) || 0)}원이 필요해요. 충전한 뒤 다시 눌러 주세요.`
          : String(r!.data?.error || SEND_FAILED);
      if ((await settle(job, reason)) !== 'none') return;
      if (authAsk && senderAuth.handleResponse(r!.data, resume(job))) return;
      setSendError(r?.data?.code === 'IN_FLIGHT' ? IN_PROGRESS : CHECK_AGAIN);
    } catch (e) {
      if (alive.current) setSendError(errText(e, SEND_FAILED));
    } finally {
      sendLock.current = false;
      setSending(false);
      setSendNote(null);
    }
  };

  /**
   * 「다시 확인」 — 접수 상태를 먼저 묻고(발송이 끝나 적재가 지워진 뒤에도 답한다) · 없음일 때만 같은 확정 건으로 다시 보낸다(새 명단 · 새 적재 0).
   *   reason 을 주면(발신 인증을 그만둠) 없음일 때 다시 보내지 않고 그 문구로 준비분을 놓는다.
   */
  const recheckSend = async (job: SendJob, reason: string | null = null) => {
    if (sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    setSendNote('접수됐는지 확인하고 있어요');
    let again = false;
    try {
      again = (await settle(job, reason)) === 'none';
    } catch (e) {
      if (alive.current) setSendError(errText(e, CHECK_AGAIN));
    } finally {
      sendLock.current = false;
      setSending(false);
      setSendNote(null);
    }
    if (again) void commitSend(job);
  };

  /** 발신 인증을 그만둠 — 쥐고 있던 준비분은 같은 판정(접수 상태)으로 없음일 때만 놓는다 */
  const AUTH_CANCELED = '발신번호 인증을 마쳐야 보낼 수 있어요. 다시 눌러 주세요.';
  const cancelAuth = () => {
    const job = heldRef.current;
    senderAuth.cancel();
    if (job) void recheckSend(job, AUTH_CANCELED);
  };

  // ★ C157 발송 지문 — 적재 때의 값을 확정 건에 묶는다(본문 · 제목 · 고른 종류 · 계획 · 발신번호 · 예약 · 나눔 · 이미지)
  const sendFp = askSendFp({
    body: pickedBody, subject: pickedSubject, channel, plan, callback: cbChoice, when, laterAt,
    splitOn, splitCount, splitGap, images: images.map((x) => x.path),
  });
  const sendFpRef = useRef(sendFp);
  sendFpRef.current = sendFp;
  const SEND_CHANGED = '문안이나 조건이 바뀌었어요. 다시 눌러 주세요.';
  /** 확인 창의 「보내기」 — 적재 때의 발송 지문이 지금 화면의 값과 같을 때만 확정한다(다르면 그 준비분으로 보내지 않는다 · 다시 누르면 새로 싣는다) */
  const confirmSend = (job: SendJob) => {
    if (sendFpRef.current !== job.fp) { setSendError(SEND_CHANGED); return; }
    void commitSend(job);
  };

  /** 서버 적재(명단 고정 · 나가는 종류 · 금액 · 뺀 분) → 확인 창. 확정은 확인 창의 단추가 부른다 */
  const prepareSend = async () => {
    if (sendLock.current || sending) return;
    if (heldRef.current) { void recheckSend(heldRef.current); return; }
    if (block || !pickedType || !count || sendLocked) return;
    // ★ 2026-11-27 C167-A — 보낼 본문 · 제목 = 한 함수(끝 줄바꿈 보존 = 수신거부 줄 앞 간격 · 받는 분 화면 · 바이트와 같은 글) · 최소 길이 = trim 길이
    const body = askSendBody(pickedBody);
    const subject = askSendSubject(sendChannel, pickedSubject);
    const we = whenError();
    const pre = body.trim().length < 5 ? '문안이 비어 있어요. 3단계에서 문안을 확인해 주세요.'
      : sendChannel !== 'SMS' && !subject ? '제목이 비어 있어요. 3단계에서 제목을 적어 주세요.'
        : hasUnsupportedSmsChars(body, subject) ? SMS_CHARSET_BLOCK_MESSAGE
          : sendBytes(body, sendChannel, opt080.forBytes) > maxBytesOf(sendChannel) ? `문안이 ${sendChannel} 한도(${fmtNum(maxBytesOf(sendChannel))}바이트)를 넘어요. 3단계에서 줄여 주세요.`
            : sendChannel === 'MMS' && images.length === 0 ? 'MMS 는 이미지가 있어야 보낼 수 있어요. 3단계에서 이미지를 붙여 주세요.'
              : !cbChoice ? '등록된 발신번호가 없어요. 발신번호를 등록한 뒤 다시 눌러 주세요.'
                : splitErr || we;
    if (pre) { setSendError(pre); return; }
    // 이 흐름의 인증 = 지금 것 하나로 고정(적재 · 확정 · 다시 확인이 모두 같은 계정으로 간다 · 화면 · 계정 확인은 sendCall 의 문)
    const token = localStorage.getItem('token') || '';
    // 이 적재가 묶이는 화면 값(확인 창의 보내기가 이것과 대조한다)
    const fp = sendFp;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    try {
      setSendNote('받는 분 명단을 준비하고 있어요');
      const scheduled = when === 'later';
      const scheduledAt = scheduled ? new Date(laterAt).toISOString() : null;
      const split = { splitEnabled: splitOn, splitCount: splitOn ? splitCount : null, splitIntervalMinutes: splitOn ? splitGap : null };
      // 명단 = 서버가 싣고 고정한다(화면은 명단을 받지 않는다) · 예약 · 나눔 값은 확정과 같은 것을 싣는다(광고 관문의 기간이 같아야 한다)
      const sr = await sendCall('POST', '/api/ai-line/ask/stage', token, { plan, message: body, individualCallback: individual, scheduled, scheduledAt, ...split });
      if (!sr?.ok || !sr.data?.success || !sr.data.stagingId || !sr.data.signature) throw new Error(String(sr?.data?.error || '받는 분 명단을 준비하지 못했어요. 잠시 뒤 다시 눌러 주세요.'));
      const st = sr.data as AskStage;
      const sendCount = Number(st.total) || 0;
      if (sendCount <= 0) throw new Error('보낼 수 있는 분이 0명이에요.');
      // 나가는 종류의 주인 = 서버. 화면이 본 것과 다르면(그 사이 회사의 칼럼 이름이 바뀐 경우) 묶음 정보를 다시 읽고 멈춘다
      //   (제목 · 길이 · 이미지 확인을 서버가 정한 종류로 다시 하게 = 화면이 서버 값을 따라간다 · 이 준비분으로는 보내지 않는다)
      if (st.channel !== sendChannel) {
        void sendCall('GET', '/api/ai-line/ask/segments', token).then((x) => { if (alive.current && x?.ok && x.data?.success === true) setSeg(x.data as AskSegments); }).catch(() => undefined);
        throw new Error(`나가는 문자 종류가 ${st.channel} 로 정해졌어요. 내용을 확인한 뒤 다시 눌러 주세요.`);
      }
      const names = (seg?.groups || []).filter((g) => groupsInOrder.includes(g.key)).map((g) => g.name).join(' · ');
      const job: SendJob = {
        token, shown: sendCount, fp,
        body: {
          stagingId: String(st.stagingId), signature: String(st.signature),
          // 종류 = 적재 응답의 값(화면이 계산한 값을 쓰지 않는다)
          msgType: st.channel, sendChannel: 'sms', subject, message: body,
          callback: individual ? undefined : cbChoice, useIndividualCallback: individual,
          adEnabled: true, scheduled, scheduledAt, ...split,
          mmsImagePaths: st.channel === 'MMS' ? images : [],
          dedupEnabled: true, unsubFilterEnabled: true,
          // 출처 = AI 발송 갈래(서버 CT send-type-axis 가 가진 값 · 새 값을 만들지 않는다)
          sendType: 'operator',
          campaignName: `한 줄로 묻기 · ${names || '고객'}`.slice(0, 60),
        },
      };
      const lines = [
        askSpamNote(pickedChip, spamFp(pickedBody, pickedSubject, sendChannel, true, callback)),
        `${st.channel} 1통 ${priceWon(Number(st.unitPrice?.lms) || 0)} · 예상 ${won(Number(st.amount) || 0)}`,
        ...askStageLines(st),
        splitOn ? `한 번에 ${fmtNum(splitCount)}건씩 ${splitGap}분 간격으로 나눠 보내요.` : '',
      ].filter(Boolean);
      const head = lines.length > 0 ? `${lines.join('\n')}\n` : '';
      setConfirm(scheduled ? {
        mode: 'info', title: '예약 발송: 지금 나가지 않아요',
        description: `${head}${fmtNum(sendCount)}명에게 ${new Date(laterAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}에 보내요.\n그전까지 예약 내역에서 취소할 수 있어요.`,
        confirmLabel: '예약하기',
        onConfirm: () => { confirmSend(job); },
      } : {
        mode: 'warning', title: '지금 보내기: 되돌릴 수 없어요',
        description: `${head}${fmtNum(sendCount)}명에게 지금 바로 보내요.\n보낸 뒤에는 되돌릴 수 없어요.`,
        confirmLabel: '지금 보내기',
        onConfirm: () => { confirmSend(job); },
      });
    } catch (e) {
      if (alive.current) setSendError(errText(e, '보낼 준비를 하지 못했어요. 잠시 뒤 다시 눌러 주세요.'));
    } finally {
      sendLock.current = false;
      if (alive.current) {
        setSending(false);
        setSendNote(null);
      }
    }
  };

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // 문안 카드 · 도착 확인 칩 = AI 한줄로 부품 하나 · **부품의 수명 = 문안(run)의 수명**(단계가 바뀌어도 내려가지 않는다 · 새 문안이면 새 부품).
  //   옛: 단계마다 부품이 다시 올라와 한 문안에 부품이 둘이 됐다 → 내려간 부품의 늦은 응답이 새 칩을 덮거나(그 부품이 기억하는 칩은 옛것) 버려졌다(구현 Codex 1R · 2R · 3R 같은 부류).
  //   부품은 한 번 만든 자리(cardsHost)에 그리고, 3단계가 그 자리를 자기 칸(cardsSlot)에 끼운다. 다른 단계에서는 화면에 없는 채로 계속 읽는다(확인 판의 도착 확인 한 줄이 멈춘 값이 되지 않게). 보낸 뒤에는 내린다(결과 화면에서 새 검사를 걸지 않는다).
  const cardsHost = useRef<HTMLDivElement | null>(null);
  if (!cardsHost.current) cardsHost.current = document.createElement('div');
  const cardsSlot = useCallback((slot: HTMLDivElement | null) => { if (slot) slot.appendChild(cardsHost.current!); }, []);
  const cardsEl = run && run.cards.length > 0 && !sent ? (
    <LineResultCards
      key={run.runId}
      run={run} pickedType={pickedType} bodyAt={bodyAt} subjectAt={subjectAt}
      channel={sendChannel} channelAt={channelAt} isAd callback={callback} columns={audienceOf(run).columns} stack
      onPick={(t) => setRun((r) => (r && r.runId === run.runId ? { ...r, picked: t } : r))}
      onEdit={(t) => { setRun((r) => (r && r.runId === run.runId ? { ...r, picked: t } : r)); bodyRef.current?.focus(); }}
      onDecorate={decorate}
      onSpamPatch={(t, chip) => setRun((r) => (r && r.runId === run.runId ? { ...r, spam: { ...r.spam, [t]: chip } } : r))}
    />
  ) : null;
  /** 끝난 뒤 처음으로 */
  const restart = () => {
    flow.current++;
    gen.current++;
    setRun(null);
    setMade(null);
    setSent(null);
    hold(null);
    setSendError(null);
    setStep(0);
    window.scrollTo(0, 0);
  };

  // ── 화면 값 ──
  const groupName = (k: AskGroupKey) => seg?.groups.find((g) => g.key === k)?.name || '';
  const sub1 = start === 'line'
    ? `한 줄에 적으신 대로 ${groupsInOrder.map(groupName).filter(Boolean).join(' · ') || '고객'}을 골라 두었어요. 더 넣거나 빼도 돼요.`
    : picked.length === 1 && picked[0] === 'nobuy' ? '구매 기록이 없는 분을 골라 두었어요. 더 넣거나 빼도 돼요.'
      : '먼저 챙길 떠나는 단골을 골라 두었어요. 더 넣거나 빼도 돼요.';
  const price = count?.unitPrice ?? seg?.unitPrices?.[sendChannel] ?? seg?.unitPrice ?? null;
  const priceText = price && !price.unset ? priceWon(price.lms) : '';
  /** 종류 칩의 1통 값(서버 단가 · 정해지지 않았으면 빈 글) */
  const chipPrice = (c: AskChannel) => { const p = seg?.unitPrices?.[c]; return p && !p.unset ? priceWon(p.lms) : ''; };
  const excluded = count ? Math.max(0, count.inScope - count.sendable) : 0;
  const parts = count ? askParts(count, mode === 'budget' ? order : 'recent') : [];
  const stale = !!made && !making && made.fp !== nowFp;
  /** 장문 · MMS 로 나가는데 제목이 비었다(단문으로 만든 문안에 칼럼 · 링크가 들어가 장문이 된 경우 등) = 3단계에서 적게 한다 */
  const needSubject = !!pickedType && !!made && !stale && sendChannel !== 'SMS' && !pickedSubject.trim();
  const ready = segState === 'ok';

  // 아래 줄 · 단추
  let sum: ReactNode = null;
  const inAnswer = step === 0 && !!answer;
  if (inAnswer) sum = answering ? '답을 쓰고 있어요' : '이어서 묻거나 표의 묶음에서 바로 보낼 수 있어요';
  else if (step === 0) sum = '한 줄을 적거나 오른쪽에서 골라 시작하세요';
  else if (picked.length === 0) sum = '보낼 분을 한 줄 이상 골라 주세요';
  else if (making && step === 3) sum = '문안을 만들고 있어요';
  else if (step === 3 && !made) sum = '내용을 적고 문안을 만들어 주세요';
  else if (step === 3 && block === 'stale') sum = '입력이 바뀌었어요. 문안을 다시 만들어 주세요';
  else if ((step === 3 || step === 4) && attachBusy > 0) sum = '이미지를 반영하고 있어요';
  else if (step === 3 && needSubject) sum = `${sendChannel} 로 보내려면 제목을 적어 주세요`;
  else if (step === 4 && sent) sum = null;
  else if (countBusy && !count) sum = '고객을 세고 있어요';
  else if (countError) sum = countError;
  else if (count) sum = step === 1
    ? <><b className="text-[15px] text-[#191F28] tabular-nums">{fmtNum(count.inScope)}명</b>을 골랐어요</>
    : <><b className="text-[15px] text-[#191F28] tabular-nums">{fmtNum(count.planned)}명</b>에게 {won(count.amount)}으로 보내요</>;
  /**
   * 확인 창 · 발신 인증 창이 떠 있는가 — 그 창들은 초점을 가두지 않는다(공용 부품) → 떠 있는 동안 뒤 화면 전체를 막는다
   *   (창의 단추와 뒤 화면의 단추 · 이전 · 입력이 엇갈려 눌리는 길 0 · 구현 Codex 4R · 5R · 6R 같은 부류).
   *   React 18 은 inert 를 모르는 속성으로 그대로 넘긴다(문자열 값) · 막는 동안만 붙인다(여정 작업대와 같은 꼴).
   */
  const modalOpen = !!confirm || !!senderAuth.state || mmsOpen;
  const inertProps: Record<string, string> = modalOpen ? { inert: '' } : {};
  const nextDisabled = step === 0 ? reading || answering || !ready
    : step === 3 ? !!block || countBusy || !pickedType || sendLocked || needSubject
      // 4단계 — inert 를 모르는 옛 브라우저에서도 창이 떠 있는 동안 보내기 단추는 잠긴다
      : step === 4 ? sending || countBusy || !cbChoice || (!unknown && !!block) || modalOpen || sendLocked
        : !ready || picked.length === 0 || countBusy || !count || (step === 2 && (count.planned === 0 || !budgetOk));
  const onNext = () => {
    if (step === 0) { void beginFromLine(); return; }
    if (step === 1) { go(2); return; }
    if (step === 2) { go(3); return; }   // ★ C153 — 넘어갈 때 문안을 만들지 않는다(크레딧 0 · 「문안 만들기」 단추만 만든다)
    if (step === 3) { go(4); return; }
    void prepareSend();
  };
  const blockLine = block === 'zero' ? '보낼 분이 0명이에요. 2단계에서 다시 골라 주세요.' : '';

  return (
    <div className="min-h-screen bg-[#F2F4F6] text-[14px] leading-normal text-[#191F28] [overflow-wrap:anywhere] break-keep">
      <div {...inertProps} className="relative mx-auto flex min-h-screen max-w-[960px] flex-col bg-white min-[900px]:mt-4 min-[900px]:min-h-0 min-[900px]:rounded-[20px]">
        <header className="flex h-12 items-center gap-0.5 px-2.5 min-[900px]:px-[18px]">
          <button type="button" disabled={answering || making || sending || !!unknown || sendLocked} onClick={() => (sent ? restart() : inAnswer ? closeThread() : step === 0 ? navigate('/dashboard') : go((step - 1) as Step))}
            className="flex h-10 w-10 items-center justify-center rounded-[10px] hover:bg-[#F2F4F6]" aria-label={inAnswer ? '질문으로 돌아가기' : step === 0 ? '대시보드로 돌아가기' : '이전'}>
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
          </button>
          <span className="flex-1 text-[14px] font-semibold text-[#4E5968]">한 줄로 묻기</span>
          {step > 0 && <span className="pr-2.5 text-[13px] font-semibold tabular-nums text-[#636D7A]">{step} / 4</span>}
        </header>
        {step > 0 && (
          <div className="flex gap-1.5 px-5 min-[900px]:px-7" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => <i key={i} className={`h-1 flex-1 rounded ${i <= step ? 'bg-[#F97316]' : 'bg-[#E5E8EB]'}`} />)}
          </div>
        )}

        <main className="relative px-5 pb-3 pt-5 min-[900px]:min-h-[432px] min-[900px]:px-7">
          {answering && (
            <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/85 pt-24" role="status" aria-live="polite">
              <p className="rounded-full bg-[#191F28] px-4 py-2 text-[13.5px] font-semibold text-white">답을 쓰는 중이에요</p>
            </div>
          )}
          {segState === 'locked' ? (
            <div className="max-w-[520px]">
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">요금제에 가입하면 쓸 수 있어요</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">한 줄로 묻기는 AI 요금제에서 열려요. 요금제를 고르면 바로 쓸 수 있어요.</p>
              <button type="button" onClick={() => navigate('/pricing')} className="mt-5 h-11 rounded-xl bg-[#191F28] px-5 text-[15px] font-bold text-white">요금제 보기</button>
            </div>
          ) : inAnswer && answer ? (
            <div>
              {thread.map((t, ti) => {
                const last = ti === thread.length - 1;
                const open = last || openTables.includes(ti);
                return (
                  <section key={ti} ref={last ? lastTurnRef : undefined} className={`scroll-mt-4 ${ti > 0 ? 'mt-7 border-t border-[#E5E8EB] pt-6' : ''}`} aria-label={`문답 ${ti + 1}`}>
                    <Label first>질문{thread.length > 1 ? ` ${ti + 1}` : ''}</Label>
                    <h1 className="mt-1 text-[18px] font-bold leading-[1.4] tracking-[-0.02em]">{t.question}</h1>
                    <div className="mt-4 whitespace-pre-wrap rounded-2xl bg-[#F9FAFB] p-4 text-[14.5px] leading-[1.7] text-[#191F28]">{t.data.text}</div>
                    {t.data.documentTitles.length > 0 && (
                      <p className="mt-2 text-[12.5px] leading-[1.55] text-[#636D7A]">근거: {t.data.documentTitles.join(' · ')}</p>
                    )}
                    {t.data.tables.length > 0 && (open ? (
                      <AskAnswerTables tables={t.data.tables} sendable={last} ready={ready && !answering} onSend={(g) => begin('pick', [g])} />
                    ) : (
                      <button type="button" aria-expanded={false} onClick={() => setOpenTables((cur) => [...cur, ti])}
                        className="mt-3 inline-flex h-9 items-center gap-1 rounded-lg bg-[#F2F4F6] px-3 text-[13px] font-semibold text-[#4E5968] hover:bg-[#E5E8EB]">
                        표 {t.data.tables.length}개 보기 <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
                      </button>
                    ))}
                  </section>
                );
              })}
              <p className="mt-4 text-[12.5px] leading-[1.55] text-[#636D7A]">우리 회사 숫자를 근거로 AI 가 쓴 답이에요. 숫자는 물을 때마다 지금 값으로 다시 세요. 보내기는 담당자가 정해요.</p>

              {/* ★ C155 이어서 묻기 — 문답마다 크레딧 값은 단추에 · 칩은 입력 칸에 넣기만 한다(누르는 순간 크레딧이 나가지 않는다) */}
              {thread.length >= ASK_THREAD_MAX ? (
                <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[#F9FAFB] p-4">
                  <p className="min-w-0 flex-1 basis-[200px] text-[14px] leading-[1.55] text-[#4E5968]">대화가 길어졌어요. 새 대화로 시작해 주세요.</p>
                  <button type="button" onClick={closeThread} className="h-10 shrink-0 rounded-xl bg-[#191F28] px-4 text-[14px] font-bold text-white hover:bg-[#333D4B]">새 대화</button>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-[#E5E8EB] p-4">
                  <label htmlFor="ask-follow" className="block text-[12.5px] font-semibold text-[#636D7A]">이어서 묻기</label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input id="ask-follow" value={followDraft} disabled={answering} maxLength={ASK_QUESTION_MAX}
                      onChange={(e) => { setFollowDraft(e.target.value); setFollowHint(null); setAnswerError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void askNow(followDraft, threadGroups, true); } }}
                      placeholder="예: 그중 떠나는 단골은 몇 명인가요?"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-[#D1D6DB] bg-white px-3.5 text-[15px] outline-none placeholder:text-[#B0B8C1] focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                    <button type="button" disabled={answering || followDraft.trim().length < ASK_LINE_MIN} onClick={() => void askNow(followDraft, threadGroups, true)}
                      className="h-11 shrink-0 whitespace-nowrap rounded-xl bg-[#191F28] px-4 text-[14.5px] font-bold text-white hover:bg-[#333D4B] disabled:cursor-not-allowed disabled:bg-[#F2F4F6] disabled:text-[#4E5968]">
                      {answering ? '답을 쓰는 중' : <>묻기 <span className="ml-1 text-[12.5px] font-semibold opacity-80">{ANSWER_COST}크레딧</span></>}
                    </button>
                  </div>
                  {askFollowChips(answer.data.tables).length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {askFollowChips(answer.data.tables).map((c) => (
                        <button key={c} type="button" disabled={answering} onClick={() => { setFollowDraft(c); setFollowHint(null); }}
                          className="min-h-[34px] rounded-full bg-[#F2F4F6] px-3.5 py-1.5 text-left text-[13px] font-semibold text-[#4E5968] hover:bg-[#E5E8EB] disabled:opacity-50">
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  {followHint && <p className="mt-2 text-[13px] text-[#B91C1C]" role="alert">{followHint}</p>}
                  {answerError && <p className="mt-2 text-[13px] text-[#B91C1C]" role="alert">{answerError.text}</p>}
                </div>
              )}
            </div>
          ) : step === 0 ? (
            <div className="grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
              <div>
                <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">무엇을 보내고 싶으세요?<br />한 줄로 적어 주세요</h1>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">누구에게, 몇 명에게, 무엇을 보낼지 차례로 골라 드려요.</p>
                <label className="mt-[22px] flex items-end gap-2.5 border-b-2 border-[#191F28] pb-[7px]">
                  <img src="/brand/wordmark.png" alt="한줄로" className="mb-1 h-[17px] shrink-0 select-none" draggable={false} />
                  {/* 글을 고치면 흐름 번호를 올린다 = 앞서 떠난 읽기 응답이 옛 글의 확인 줄 · 1단계를 되살리지 않는다(Codex 구현 1R · 화면의 글과 다른 질문에 크레딧을 쓰지 않게) · 답을 쓰는 동안에는 칸을 잠근다(2R · 낸 답이 버려지지 않게) */}
                  <input value={lineDraft} onChange={(e) => { flow.current++; setLineDraft(e.target.value); setLineHint(null); setAsking(null); setAnswerError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!answering) void beginFromLine(); } }}
                    disabled={answering} maxLength={2000} placeholder="오래 안 온 단골에게 재구매 10% 쿠폰" aria-label="한 줄 입력"
                    className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-[#636D7A]" />
                </label>
                {lineHint && <p className="mt-2 text-[13px] text-[#B91C1C]">{lineHint}</p>}
                {asking && (
                  <div className="mt-3 rounded-2xl bg-[#F9FAFB] p-4" role="status">
                    <p className="text-[14px] font-semibold leading-[1.55]">질문으로 읽었어요. 우리 회사 숫자를 근거로 답해 드릴까요?</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={answering} onClick={() => void askNow(asking.line, asking.groups)}
                        className="h-10 rounded-xl bg-[#191F28] px-4 text-[14px] font-bold text-white hover:bg-[#333D4B] disabled:opacity-50">
                        답 받기 <span className="ml-1.5 text-[12.5px] font-semibold text-[#D1D6DB]">{ANSWER_COST}크레딧</span>
                      </button>
                      <button type="button" disabled={answering || !ready} onClick={() => begin('line', asking.groups, { line: asking.line })}
                        className="h-10 rounded-xl bg-white px-4 text-[14px] font-semibold text-[#4E5968] shadow-[inset_0_0_0_1px_#D1D6DB] hover:bg-[#F2F4F6] disabled:opacity-50">
                        보낼 고객 고르기
                      </button>
                    </div>
                  </div>
                )}
                {answerError && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[#B91C1C]" role="alert">
                    {answerError.text}
                    {answerError.scoped && (
                      <button type="button" disabled={!ready} onClick={() => begin('pick', ['leave'])} className="h-8 rounded-lg bg-[#191F28] px-3 text-[13px] font-bold text-white disabled:opacity-50">보낼 고객 고르기</button>
                    )}
                  </p>
                )}
                {!asking && (
                  <button type="button" disabled={reading || answering || lineDraft.trim().length < ASK_LINE_MIN} onClick={() => void askNow(lineDraft)}
                    className="mt-3 inline-flex items-center gap-1 py-1.5 text-[13px] font-semibold text-[#4E5968] underline underline-offset-4 disabled:text-[#B0B8C1] disabled:no-underline">
                    질문으로 물어보기 <span className="font-medium no-underline">{ANSWER_COST}크레딧</span>
                  </button>
                )}
              </div>
              <div>
                <Label first>이렇게 시작해도 돼요</Label>
                <ul className="-mx-2.5 mt-1.5 grid gap-px">
                  {([
                    ['coupon', '오래 안 온 단골에게 쿠폰 보내기', '떠나는 단골을 골라 두고, 혜택은 3단계에서 적어요', ['leave']],
                    ['pick', '고객 묶음부터 보기', '먼저 연락할 고객을 골라 두고 시작해요', ['leave']],
                    ['budget', '예산에 맞춰 보내기', '금액만 정하면 그만큼 골라 드려요', ['leave']],
                  ] as Array<[Start, string, string, AskGroupKey[]]>).map(([k, t, d, g]) => (
                    <li key={k}>
                      <button type="button" disabled={!ready || reading || answering} onClick={() => begin(k, g)}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-[9px] text-left hover:bg-[#F9FAFB] disabled:opacity-50">
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                          <b className="text-[15px] font-bold">{t}</b>
                          <span className="text-[12.5px] text-[#636D7A]">{d}</span>
                        </span>
                        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#D1D6DB]" strokeWidth={2.4} />
                      </button>
                    </li>
                  ))}
                </ul>
                {segState === 'loading' && <p className="mt-3 text-[12.5px] text-[#636D7A]">고객 묶음을 세고 있어요</p>}
                {segState === 'error' && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[#4E5968]">
                    {segError}
                    <button type="button" onClick={() => void loadSegments()} className="h-8 rounded-lg bg-[#191F28] px-3 text-[13px] font-bold text-white">다시 읽기</button>
                  </p>
                )}
              </div>
            </div>
          ) : step === 1 && seg ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">누구에게 보낼까요?</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">{sub1}</p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <ul className="-mx-2.5 grid gap-px">
                    {seg.groups.filter((g) => g.key !== 'nobuy').map((g) => {
                      const on = picked.includes(g.key);
                      return (
                        <li key={g.key}>
                          <button type="button" aria-pressed={on} onClick={() => toggle(g.key)}
                            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-[9px] text-left ${on ? 'bg-[#FFF7ED]' : 'hover:bg-[#F9FAFB]'}`}>
                            <Chk on={on} />
                            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                              <b className="inline-flex items-center gap-1.5 text-[15px] font-bold">
                                {g.name}{g.key === 'leave' && <span className="rounded-md bg-[#FFEDD5] px-[7px] py-0.5 text-[11.5px] font-bold text-[#C2410C]">먼저 챙길 분</span>}
                              </b>
                              <span className="text-[12.5px] text-[#636D7A]">{g.desc}</span>
                              {(askGroupSpend(seg, g.key) !== null || perWon.has(g.key)) && (
                                <span className="basis-full text-[12px] font-semibold text-[#4E5968]">
                                  {[
                                    askGroupSpend(seg, g.key) !== null ? `1인 평균 구매 ${askSpendText(askGroupSpend(seg, g.key)!)}` : '',
                                    perWon.has(g.key) ? `문자 1원당 매출 ${perWonText(perWon.get(g.key)!)}` : '',
                                  ].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[15px] font-bold tabular-nums">{fmtNum(askGroupSendable(seg, g.key))}명</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="my-1.5 h-px bg-[#E5E8EB]" />
                  {seg.groups.filter((g) => g.key === 'nobuy').map((g) => {
                    const on = picked.includes(g.key);
                    return (
                      <button key={g.key} type="button" aria-pressed={on} onClick={() => toggle(g.key)}
                        className={`-mx-2.5 flex w-[calc(100%+1.25rem)] items-center gap-3 rounded-xl px-2.5 py-[9px] text-left ${on ? 'bg-[#FFF7ED]' : 'hover:bg-[#F9FAFB]'}`}>
                        <Chk on={on} />
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                          <b className="text-[15px] font-bold">{g.name}</b>
                          <span className="text-[12.5px] text-[#636D7A]">{g.desc}</span>
                        </span>
                        <span className="shrink-0 text-[15px] font-bold tabular-nums">{fmtNum(askGroupSendable(seg, g.key))}명</span>
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setMxOpen((x) => !x)} aria-expanded={mxOpen}
                    className="mt-2 inline-flex items-center gap-1 py-1.5 text-[13.5px] font-semibold text-[#4E5968] underline underline-offset-4 min-[900px]:hidden">
                    {mxOpen ? '표 접기' : '표로 자세히 보기'}
                  </button>
                </div>
                <div className={mxOpen ? 'block' : 'hidden min-[900px]:block'}>
                  <Label first>표로 보기</Label>
                  <div className="mt-1.5 grid grid-cols-[62px_repeat(3,minmax(0,1fr))] gap-1 min-[400px]:grid-cols-[72px_repeat(3,minmax(0,1fr))] min-[400px]:gap-[5px]">
                    <div />
                    {ASK_COL_LABELS.map((c) => <div key={c} className="flex min-h-[26px] items-center justify-center text-center text-[12px] font-semibold text-[#636D7A]">{c}</div>)}
                    {ASK_ROW_LABELS.map((r, ri) => (
                      <div key={r} className="contents">
                        <div className="flex min-h-[26px] items-center text-[12px] font-semibold text-[#636D7A]">{r}</div>
                        {seg.cells.filter((c) => c.row === ri).map((c) => (
                          <button key={c.key} type="button" onClick={() => toggle(c.group)} aria-pressed={picked.includes(c.group)}
                            className={`flex min-h-[40px] items-center justify-center rounded-[10px] text-[14px] font-bold tabular-nums ${picked.includes(c.group) ? 'bg-[#FFEDD5] text-[#C2410C]' : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'}`}>
                            {fmtNum(c.sendable)}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[12.5px] leading-[1.55] text-[#636D7A]">세로는 마지막 구매, 가로는 구매 횟수예요. 칸을 누르면 그 묶음이 골라져요. 묶음을 겹쳐 고르면 같은 분은 한 번만 보내요.</p>
                </div>
              </div>
            </>
          ) : step === 2 ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">{count ? `${fmtNum(count.sendable)}명에게 보낼 수 있어요` : '보낼 수 있는 분을 세고 있어요'}</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">
                {count && excluded > 0 ? `고른 ${fmtNum(count.inScope)}명 가운데 수신거부, 광고 수신 미동의, 번호 오류, 같은 번호인 ${fmtNum(excluded)}명은 뺐어요.` : count ? `고른 ${fmtNum(count.inScope)}명 모두 받을 수 있어요.` : ' '}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <div className="grid gap-2">
                    {([['all', '모두에게 보내기', count && mode === 'all' ? `${fmtNum(count.planned)}명, ${won(count.amount)}` : '받을 수 있는 분 모두에게 보내요'],
                      ['budget', '예산에 맞춰 보내기', price?.unset ? '문자 단가가 정해지지 않아 고를 수 없어요' : '정한 금액 안에서 골라 보내요']] as Array<['all' | 'budget', string, string]>).map(([k, t, d]) => (
                      <button key={k} type="button" aria-pressed={mode === k} disabled={k === 'budget' && !!price?.unset} onClick={() => setMode(k)}
                        className={`flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left disabled:opacity-50 ${mode === k ? 'bg-[#FFF7ED] shadow-[inset_0_0_0_2px_#F97316]' : 'bg-[#F9FAFB] shadow-[inset_0_0_0_1px_#E5E8EB]'}`}>
                        <Chk on={mode === k} />
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                          <b className="text-[15px] font-bold">{t}</b>
                          <span className="text-[12.5px] text-[#636D7A]">{d}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {mode === 'budget' && (
                    <div>
                      <Label>예산</Label>
                      <div className="mt-1 flex items-baseline gap-1 border-b-2 border-[#191F28] pb-1">
                        <input value={budgetText} inputMode="numeric" aria-label="예산"
                          onChange={(e) => { const b = askBudgetOf(e.target.value); setBudget(b); setBudgetText(b ? fmtNum(b) : ''); }}
                          style={{ width: `${Math.max(2, budgetText.length) + 0.5}ch` }}
                          className="min-w-[2ch] max-w-full border-0 bg-transparent text-[22px] font-bold tabular-nums tracking-[-0.01em] outline-none" />
                        <span className="text-[17px] font-bold">원</span>
                      </div>
                      {!budgetOk && <p className="mt-1.5 text-[12.5px] text-[#B91C1C]">예산은 1,000원부터 1억 원까지 적을 수 있어요.</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ASK_BUDGET_CHIPS.map((b) => <Pill key={b} on={budget === b} onClick={() => { setBudget(b); setBudgetText(fmtNum(b)); }}>{fmtNum(b / 10_000)}만 원</Pill>)}
                      </div>
                      <Label>누구부터 넣을까요?</Label>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Pill on={order === 'recent'} onClick={() => setOrder('recent')}>최근에 산 분부터</Pill>
                        <Pill on={order === 'count'} onClick={() => setOrder('count')}>많이 산 분부터</Pill>
                      </div>
                    </div>
                  )}
                  <div>
                    <Label>문자 종류</Label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ASK_CHANNELS.map((c) => (
                        <Pill key={c} on={channel === c} onClick={() => setChannel(c)}>{c}{chipPrice(c) ? ` · ${chipPrice(c)}` : ''}</Pill>
                      ))}
                    </div>
                    <p className="mt-2 text-[12.5px] leading-[1.55] text-[#636D7A]">
                      {channel === 'SMS' ? '짧은 글(90바이트)로 보내요. 칼럼이나 링크가 들어가면 LMS 로 보내요.'
                        : channel === 'MMS' ? '이미지를 붙여 보내요. 이미지는 다음 단계에서 골라요.'
                          : '긴 글(2,000바이트)까지 보낼 수 있어요.'}
                    </p>
                  </div>
                </div>
                <div className={`rounded-2xl bg-[#F9FAFB] p-4 ${countBusy ? 'opacity-60' : ''}`}>
                  <Label first>이렇게 보내요</Label>
                  {count ? (
                    <>
                      <div className="mt-1.5 text-[20px] font-bold leading-[1.3] tracking-[-0.02em] tabular-nums">{fmtNum(count.planned)}명에게 {won(count.amount)}</div>
                      <div className="mt-0.5 text-[13px] text-[#4E5968]">
                        {mode === 'all' ? '받을 수 있는 분 모두에게 보내요' : count.planned < count.sendable ? `받을 수 있는 ${fmtNum(count.sendable)}명 가운데 골랐어요` : '예산 안에서 모두에게 보낼 수 있어요'}
                      </div>
                      {mode === 'budget' && (
                        <div className="mt-3 h-1.5 rounded-full bg-[#E5E8EB]"><i className="block h-full rounded-full bg-[#F97316]" style={{ width: `${count.sendable ? Math.min(100, (count.planned / count.sendable) * 100).toFixed(1) : 0}%` }} /></div>
                      )}
                      <ul className="mt-2.5">
                        {parts.map((p) => (
                          <li key={p.label} className="flex justify-between gap-3 py-[5px] text-[13.5px] text-[#4E5968]">
                            <span className="whitespace-nowrap">{p.label}</span>
                            <span className={`text-right tabular-nums ${p.taken === 0 ? 'font-medium text-[#636D7A]' : 'font-bold text-[#191F28]'}`}>
                              {p.taken === p.n ? `${fmtNum(p.n)}명 모두` : p.taken > 0 ? `${fmtNum(p.n)}명 중 ${fmtNum(p.taken)}명` : '이번에는 빠져요'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {count.capped && <p className="mt-2 text-[12.5px] font-semibold text-[#C2410C]">한 번에 5만 명까지 가져가요.</p>}
                    </>
                  ) : (
                    <div className="mt-2 grid gap-2.5" aria-hidden="true"><i className="block h-5 w-3/4 rounded bg-[#E5E8EB]" /><i className="block h-3 w-1/2 rounded bg-[#E5E8EB]" /></div>
                  )}
                  <p className="mt-3 text-[12.5px] leading-[1.55] text-[#636D7A]">
                    {priceText ? `${sendChannel} 1통 ${priceText}으로 계산했어요. ` : ''}문안은 다음 단계에서 내용을 적은 뒤에 만들어요. 한 안에 {COMPOSE_COST}크레딧이고, 도착 확인에는 검사 문자 요금이 들어요.
                  </p>
                </div>
              </div>
            </>
          ) : step === 3 ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">무엇을 알릴까요?</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">적어 주신 내용으로만 문안을 만들어요. 적지 않은 혜택이나 행사는 넣지 않아요.</p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <Label first>알릴 내용</Label>
                  <textarea value={what} onChange={(e) => setWhat(e.target.value)} disabled={making} maxLength={2000} rows={3}
                    placeholder="예: 겨울 니트가 새로 들어왔어요. 이번 주 일요일까지 둘러보러 오세요" aria-label="알릴 내용"
                    className="mt-1 block w-full resize-y rounded-xl border-2 border-[#E5E8EB] bg-white px-3.5 py-3 text-[15px] leading-[1.55] outline-none placeholder:text-[#8B95A1] focus:border-[#191F28] disabled:bg-[#F9FAFB] disabled:text-[#636D7A]" />
                  <Label>혜택</Label>
                  <div className="mt-1 flex items-center gap-2.5 border-b-2 border-[#E5E8EB] pb-[5px] focus-within:border-[#191F28]">
                    <input value={benefit} onChange={(e) => setBenefit(e.target.value)} disabled={none || making} maxLength={40}
                      placeholder="예: 재구매 10% 쿠폰" aria-label="혜택"
                      className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-[#636D7A] disabled:text-[#636D7A]" />
                    <Pill on={none} disabled={making} onClick={() => setNone((x) => !x)}>혜택 없이</Pill>
                  </div>
                  <Label>고객이 오실 곳</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {PLACES.map((x) => <Pill key={x.key} on={place === x.key} disabled={making} onClick={() => setPlace(x.key)}>{x.label}</Pill>)}
                  </div>
                  {place === 'online' && (
                    <input value={link} onChange={(e) => setLink(e.target.value)} disabled={making} maxLength={500} inputMode="url"
                      placeholder="링크 주소(있으면) 예: https://" aria-label="링크 주소"
                      className="mt-2 block h-11 w-full rounded-xl border-2 border-[#E5E8EB] bg-white px-3.5 text-[14.5px] outline-none placeholder:text-[#8B95A1] focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                  )}
                  {channel === 'MMS' && (
                    <>
                      <Label>이미지</Label>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <button type="button" disabled={making} onClick={() => { setMmsError(null); setMmsOpen(true); }}
                          className="h-10 whitespace-nowrap rounded-xl bg-white px-3.5 text-[14px] font-semibold text-[#191F28] shadow-[inset_0_0_0_1px_#D1D6DB] hover:bg-[#F9FAFB] disabled:opacity-50">
                          {images.length > 0 ? '이미지 바꾸기' : '이미지 붙이기'}
                        </button>
                        <span className="text-[13px] text-[#4E5968]">{images.length > 0 ? `${images.length}장을 붙였어요.` : 'MMS 는 이미지를 붙여 보내요.'}</span>
                      </div>
                    </>
                  )}
                  <Label>문안 종류</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ASK_COPY_TYPES.map((t) => (
                      <Pill key={t} on={types.includes(t)} disabled={making}
                        onClick={() => setTypesPicked(types.includes(t) ? types.filter((x) => x !== t) : ASK_COPY_TYPES.filter((x) => x === t || types.includes(x)))}>
                        {seg?.typeNames?.[t] || AI_LINE_TYPE_META[t].label}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-[1.55] text-[#636D7A]">고른 종류마다 한 안씩 만들어요. 한 안에 {COMPOSE_COST}크레딧이에요.</p>
                  {(!made || stale) && (
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <button type="button" disabled={making || !!composeBlock || countBusy} onClick={() => void compose(false)}
                        className="h-11 whitespace-nowrap rounded-xl bg-[#191F28] px-4 text-[14.5px] font-bold text-white hover:bg-[#333D4B] disabled:cursor-not-allowed disabled:bg-[#F2F4F6] disabled:text-[#4E5968]">
                        {made ? '문안 다시 만들기' : '문안 만들기'} <span className="ml-1.5 text-[12.5px] font-semibold opacity-80">{COMPOSE_COST * Math.max(1, types.length)}크레딧</span>
                      </button>
                      <span className="text-[13px] text-[#4E5968]">
                        {composeBlock === 'line' ? `알릴 내용을 ${ASK_LINE_MIN}자 이상 적어 주세요.`
                          : composeBlock === 'types' ? '문안 종류를 하나 이상 골라 주세요.'
                            : composeBlock === 'image' ? 'MMS 는 이미지를 먼저 붙여 주세요.'
                            : composeBlock === 'zero' ? '보낼 분이 0명이에요. 2단계에서 다시 골라 주세요.'
                              : stale ? '입력이 바뀌었어요. 문안에 넣으려면 다시 만들어 주세요.' : ''}
                      </span>
                    </div>
                  )}
                  {composeError && <p className="mt-2.5 text-[13.5px] text-[#B91C1C]" role="alert">{composeError}</p>}
                </div>
                <div>
                  {making ? (
                    <div className="rounded-2xl bg-[#F2F4F6] px-4 py-3.5" role="status" aria-live="polite">
                      <div className="mb-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-[#4E5968]">
                        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#D1D6DB] border-t-[#4E5968] motion-reduce:animate-none" />문안을 만들고 있어요
                      </div>
                      <div className="grid gap-[9px] pb-1 pt-0.5" aria-hidden="true"><i className="block h-3 rounded-md bg-[#D1D6DB]" /><i className="block h-3 w-[86%] rounded-md bg-[#D1D6DB]" /><i className="block h-3 w-[62%] rounded-md bg-[#D1D6DB]" /></div>
                    </div>
                  ) : run && run.cards.length > 0 ? (
                    <div className={stale ? 'opacity-60' : ''}>
                      <div ref={cardsSlot} />
                      {sendChannel !== channel && (
                        <p className="mb-2.5 rounded-xl bg-[#F2F4F6] px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#4E5968]" role="status">
                          칼럼이나 링크가 들어 있어 <b className="text-[#191F28]">{sendChannel}</b> 로 보내요. 1통 값과 인원을 {sendChannel} 로 다시 셌어요.
                        </p>
                      )}
                      {pickedType && (
                        <div className="rounded-2xl bg-[#F2F4F6] px-4 py-3.5">
                          <small className="mb-2 block text-[12.5px] font-semibold text-[#4E5968]">받는 분 화면 · 고칠 수 있어요</small>
                          {/* ★ 2026-11-27 C167-A(R111 · 임은지 접수) — 회색 = 보낼 때 붙는 글(합성이 실제로 붙이는 것만 · 고칠 수 없음) · 번호 = 보내는 계정의 080 */}
                          {sendChannel !== 'SMS' && (
                            <div className="mb-2 flex items-center gap-2">
                              {!startsWithAdMark(pickedSubject) && <span className="shrink-0 text-[14.5px] font-bold text-[#8B95A1]" title="보낼 때 붙어요">{adPrefixFront(sendChannel).trim()}</span>}
                              <input value={pickedSubject} disabled={decorating} onChange={(e) => setRun((r) => (r && pickedType ? setSubject(r, pickedType, e.target.value) : r))} maxLength={LMS_SUBJECT_MAX_CHARS}
                                placeholder="제목" aria-label="제목"
                                className="block h-10 min-w-0 flex-1 rounded-lg border border-[#D1D6DB] bg-white px-3 text-[14.5px] font-bold outline-none focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                            </div>
                          )}
                          {pickedLocked.head && <p className="mb-1 px-3 text-[14.5px] leading-[1.65] text-[#8B95A1]" title="보낼 때 붙어요">{pickedLocked.head.trim()}</p>}
                          <textarea ref={bodyRef} value={pickedBody} disabled={decorating} onChange={(e) => setRun((r) => (r && pickedType ? setBody(r, pickedType, e.target.value) : r))} rows={12} maxLength={2000}
                            aria-label="문안"
                            className="block w-full resize-y rounded-lg border border-[#D1D6DB] bg-white px-3 py-2.5 text-[14.5px] leading-[1.65] outline-none focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                          {pickedLocked.footer && (
                            <p className="mt-1 px-3 text-[14.5px] leading-[1.65] text-[#8B95A1]" title="보낼 때 붙어요">
                              {opt080.known ? pickedLocked.footer : adFooterFront(sendChannel, '')} {opt080.known ? '' : <span className="text-[12.5px]">(번호 확인 중)</span>}
                            </p>
                          )}
                          {opt080.known && !opt080.value && <p className="mt-1 px-3 text-[12.5px] font-semibold text-[#B45309]">수신거부 번호(080)가 없어요. 회사 설정에서 등록해 주세요.</p>}
                          <p className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-[#636D7A]">
                            <span>한줄로 묻기는 혜택과 방문을 알리는 문자라 늘 광고로 보내요. 회색 글은 보낼 때 붙어요. 수신거부 줄과 한 줄 띄우려면 문안 끝에서 줄을 두 번 바꿔 주세요.</span>
                            <span className={`tabular-nums ${sendBytes(pickedBody, sendChannel, opt080.forBytes) > maxBytesOf(sendChannel) ? 'font-semibold text-[#B91C1C]' : ''}`}>{fmtNum(sendBytes(pickedBody, sendChannel, opt080.forBytes))} / {fmtNum(maxBytesOf(sendChannel))}바이트</span>
                          </p>
                        </div>
                      )}
                      {pickedUngrounded.length > 0 && (
                        <p className="mt-2.5 rounded-xl bg-[#FFF7ED] px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#9A3412]">
                          입력하신 내용에 없는 말이 들어 있어요: <b>{pickedUngrounded.join(' · ')}</b>. 맞는지 보고, 아니면 위에서 지워 주세요.
                        </p>
                      )}
                      {pickedHole && <p className="mt-2.5 text-[13px] font-semibold text-[#C2410C]">문안에 혜택 자리가 남았어요. 혜택 칸에 적고 다시 만들거나 위에서 직접 고쳐 주세요.</p>}
                      {pickedChip?.state === 'blocked' && !stale && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[#4E5968]">
                          <span>통신사에서 스팸으로 막혔어요. 막힌 표현을 고쳐 다시 만들 수 있어요.</span>
                          <button type="button" disabled={making || !!composeBlock} onClick={() => void compose(true)} className="h-9 whitespace-nowrap rounded-[10px] bg-[#191F28] px-3.5 text-[13.5px] font-bold text-white disabled:opacity-50">
                            고쳐서 다시 만들기 <span className="ml-1.5 text-[12.5px] font-semibold text-[#D1D6DB]">{COMPOSE_COST * Math.max(1, types.length)}크레딧</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#D1D6DB] px-4 py-6 text-[13.5px] leading-[1.6] text-[#636D7A]">
                      왼쪽을 채우고 「문안 만들기」를 누르면 여기에 문안이 나와요. 만들기 전에는 크레딧이 들지 않아요.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : step === 4 && sent ? (
            <div className="max-w-[560px]">
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">{sent.already ? '이미 접수됐어요' : sent.scheduledAt ? '예약됐어요' : '보내기 시작했어요'}</h1>
              <p className="mt-1.5 text-[14px] leading-[1.6] text-[#4E5968]">
                {sent.already ? '앞서 누른 요청이 접수돼 있었어요. 다시 보내지 않았어요.'
                  : sent.scheduledAt ? `${fmtNum(sent.count)}명에게 ${new Date(sent.scheduledAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}에 보내요. 그전까지 예약 내역에서 취소할 수 있어요.`
                    : `${fmtNum(sent.count)}명에게 보내는 중이에요. 진행 상황은 발송 결과에서 볼 수 있어요.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => navigate('/dashboard')} className="h-11 rounded-xl bg-[#191F28] px-5 text-[15px] font-bold text-white hover:bg-[#333D4B]">대시보드에서 확인하기</button>
                <button type="button" onClick={restart} className="h-11 rounded-xl bg-white px-5 text-[15px] font-semibold text-[#4E5968] shadow-[inset_0_0_0_1px_#D1D6DB] hover:bg-[#F9FAFB]">처음으로</button>
              </div>
            </div>
          ) : step === 4 ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">이렇게 보낼게요</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">확인하고 누르면 여기서 바로 보내요.</p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <Label first>받는 분</Label>
                  <p className="mt-1 text-[16px] font-bold leading-[1.45]">{groupsInOrder.map(groupName).filter(Boolean).join(' · ') || '고른 고객'}</p>
                  <p className="mt-0.5 text-[14px] text-[#4E5968]">{count ? <><b className="tabular-nums text-[#191F28]">{fmtNum(count.planned)}명</b> · 예상 {won(count.amount)}</> : '인원을 세고 있어요'}</p>
                  <p className="mt-0.5 text-[13px] text-[#636D7A]">{sendChannel}{priceText ? ` · 1통 ${priceText}` : ''}{images.length > 0 ? ` · 이미지 ${images.length}장` : ''}</p>
                  <Label>발신번호</Label>
                  {cbList && cbList.length > 0 ? (
                    <select value={cbChoice} onChange={(e) => setCbChoice(e.target.value)} disabled={sending || !!unknown} aria-label="발신번호"
                      className="mt-1 block h-11 w-full rounded-xl border-2 border-[#E5E8EB] bg-white px-3 text-[15px] font-semibold outline-none focus:border-[#191F28] disabled:bg-[#F9FAFB]">
                      {cbList.map((c) => <option key={c.phone} value={c.phone}>{c.phone}{c.isDefault ? ' · 기본' : ''}</option>)}
                      <option value={INDIVIDUAL_CB}>고객별 매장 번호</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-[#B91C1C]">{cbList ? '등록된 발신번호가 없어요. 발신번호를 등록한 뒤 보낼 수 있어요.' : '발신번호를 읽고 있어요'}</p>
                  )}
                  {individual && <p className="mt-1.5 text-[12.5px] leading-[1.55] text-[#636D7A]">고객마다 등록된 매장 번호로 보내요. 매장 번호가 없거나 등록되지 않은 고객은 보내기 전에 빼고 몇 명인지 알려 드려요.</p>}
                  <Label>보내는 때</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill on={when === 'now'} disabled={sending || !!unknown} onClick={() => setWhen('now')}>지금 보내기</Pill>
                    <Pill on={when === 'later'} disabled={sending || !!unknown} onClick={() => setWhen('later')}>예약</Pill>
                  </div>
                  {when === 'later' && (
                    <>
                      <input type="datetime-local" value={laterAt} onChange={(e) => setLaterAt(e.target.value)} disabled={sending || !!unknown} aria-label="예약 날짜와 시각"
                        className="mt-2 block h-11 w-full rounded-xl border-2 border-[#E5E8EB] bg-white px-3 text-[15px] outline-none focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                      {sendPolicy && <p className="mt-1.5 text-[12.5px] text-[#636D7A]">보낼 수 있는 시간은 {sendWindowText(sendPolicy)}이에요.</p>}
                    </>
                  )}
                  <Label>나눠 보내기</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill on={!splitOn} disabled={sending || !!unknown} onClick={() => setSplitOn(false)}>한 번에 보내기</Pill>
                    <Pill on={splitOn} disabled={sending || !!unknown} onClick={() => setSplitOn(true)}>나눠 보내기</Pill>
                  </div>
                  {splitOn && (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-[14px] text-[#4E5968]">
                        <span>한 번에</span>
                        <input value={splitCountText} inputMode="numeric" maxLength={4} disabled={sending || !!unknown} aria-label="한 번에 보낼 건수"
                          onChange={(e) => setSplitCountText(e.target.value.replace(/\D/g, ''))}
                          className="h-10 w-[84px] rounded-xl border-2 border-[#E5E8EB] bg-white px-3 text-right text-[15px] font-semibold tabular-nums outline-none focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                        <span>건씩</span>
                        <input value={splitGapText} inputMode="numeric" maxLength={2} disabled={sending || !!unknown} aria-label="보내는 간격(분)"
                          onChange={(e) => setSplitGapText(e.target.value.replace(/\D/g, ''))}
                          className="h-10 w-[64px] rounded-xl border-2 border-[#E5E8EB] bg-white px-3 text-right text-[15px] font-semibold tabular-nums outline-none focus:border-[#191F28] disabled:bg-[#F9FAFB]" />
                        <span>분 간격으로 보내요</span>
                      </div>
                      {splitErr && <p className="mt-1.5 text-[12.5px] text-[#B91C1C]">{splitErr}</p>}
                    </>
                  )}
                  <p className="mt-3 text-[12.5px] leading-[1.55] text-[#636D7A]">
                    {askSpamNote(pickedChip, spamFp(pickedBody, pickedSubject, sendChannel, true, callback)) || '세 통신사 도착 확인을 통과한 문안이에요.'}
                    {' '}수신거부 · 중복은 보내기 직전에 서버가 다시 빼요.
                  </p>
                  {sendNote && <p className="mt-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-[#4E5968]" role="status" aria-live="polite"><span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#D1D6DB] border-t-[#4E5968] motion-reduce:animate-none" />{sendNote}</p>}
                  {sendError && <p className="mt-2.5 text-[13.5px] leading-[1.55] text-[#B91C1C]" role="alert">{sendError}</p>}
                </div>
                <div className="rounded-2xl bg-[#F2F4F6] px-4 py-3.5">
                  <small className="mb-2 block text-[12.5px] font-semibold text-[#4E5968]">받는 분 화면</small>
                  {/* ★ 2026-11-27 C167-A(R111) — 나가는 글 그대로(확정과 같은 보낼 제목 · 본문 · 같은 합성 · 보내는 계정의 080) */}
                  {sendChannel !== 'SMS' && <p className="mb-1.5 text-[14.5px] font-bold">{buildAdSubjectFront(askSendSubject(sendChannel, pickedSubject), sendChannel, true)}</p>}
                  <pre className="m-0 max-h-[360px] overflow-y-auto whitespace-pre-wrap font-[inherit] text-[14.5px] leading-[1.65]">{buildAdMessageFront(askSendBody(pickedBody), sendChannel, true, opt080.value)}</pre>
                  {!opt080.known && <p className="mt-1.5 text-[12px] text-[#636D7A]">수신거부 번호를 확인하고 있어요.</p>}
                  {opt080.known && !opt080.value && <p className="mt-1.5 text-[12.5px] font-semibold text-[#B45309]">수신거부 번호(080)가 없어요. 회사 설정에서 등록해 주세요.</p>}
                  <p className="mt-2.5 text-[12px] text-[#636D7A]">이 모습 그대로 나가요. 칼럼 자리는 받는 분마다 바뀌어요. 고치려면 「이전」으로 돌아가 주세요.</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-[#4E5968]">고객 묶음을 세고 있어요</p>
          )}
        </main>

        {segState !== 'locked' && !(step === 4 && sent) && (
          <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-[#E5E8EB] bg-white px-5 pb-4 pt-3 min-[900px]:static min-[900px]:flex-nowrap min-[900px]:rounded-b-[20px] min-[900px]:px-7 min-[900px]:pb-[18px] min-[900px]:pt-3.5">
            <div className="basis-full text-center text-[14px] text-[#4E5968] min-[900px]:flex-1 min-[900px]:basis-auto min-[900px]:text-left">{sum}</div>
            {step >= 2 && (
              <button type="button" disabled={making || sending || !!unknown || sendLocked} onClick={() => go((step - 1) as Step)}
                className="h-[46px] shrink-0 rounded-xl bg-white px-[18px] text-[15px] font-semibold text-[#4E5968] shadow-[inset_0_0_0_1px_#D1D6DB] hover:bg-[#F9FAFB] disabled:opacity-50 min-[900px]:h-11">이전</button>
            )}
            {inAnswer && (
              <button type="button" disabled={answering} onClick={closeThread}
                className="h-[46px] shrink-0 rounded-xl bg-white px-[18px] text-[15px] font-semibold text-[#4E5968] shadow-[inset_0_0_0_1px_#D1D6DB] hover:bg-[#F9FAFB] disabled:opacity-50 min-[900px]:h-11">새 대화</button>
            )}
            <button type="button" onClick={inAnswer && answer ? () => begin('pick', answer.groups) : onNext} disabled={inAnswer ? !ready || answering : nextDisabled}
              className="h-[46px] flex-1 rounded-xl bg-[#191F28] px-5 text-[15px] font-bold text-white hover:bg-[#333D4B] disabled:cursor-not-allowed disabled:bg-[#F2F4F6] disabled:text-[#4E5968] min-[900px]:h-11 min-[900px]:min-w-[176px] min-[900px]:flex-none">
              {inAnswer ? '보낼 고객 고르기' : step === 0 ? (reading ? '읽는 중' : '시작하기')
                : step === 4 ? (sending ? '처리하는 중' : unknown ? '다시 확인' : when === 'later' ? '예약하기' : count ? `${fmtNum(count.planned)}명에게 보내기` : '보내기')
                  : '다음'}
            </button>
          </footer>
        )}
      </div>
      {cardsEl && createPortal(cardsEl, cardsHost.current!)}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <MmsUploadModal
        show={mmsOpen}
        onClose={() => setMmsOpen(false)}
        mmsUploadedImages={mms.mmsUploadedImages}
        mmsUploading={mms.mmsUploading}
        handleMmsSlotUpload={attach(mms.handleMmsSlotUpload)}
        handleMmsMultiUpload={attach(mms.handleMmsMultiUpload)}
        handleMmsImageRemove={attach(mms.handleMmsImageRemove)}
        handleMmsFromAsset={attach(mms.handleMmsFromAsset)}
        handleMmsImageSwap={attach(mms.handleMmsImageSwap)}
        errorMessage={mmsError}
      />
      {senderAuth.state && (
        <SenderAuthModal
          state={senderAuth.state}
          code={senderAuth.code}
          onCodeChange={senderAuth.setCode}
          error={senderAuth.error}
          busy={senderAuth.busy}
          onVerify={senderAuth.verify}
          onResend={senderAuth.resend}
          onProceed={cancelAuth}
          onCancel={cancelAuth}
        />
      )}
    </div>
  );
}
