/**
 * JourneyStepStudio — 한 화면에서 스텝 하나를 완결한다 (2026-08-02, 설계서 §13-2)
 *
 * 왜 스텝별 전환인가
 *   보기 좋으라고가 아니다. AI 문안생성이 앞 스텝을 몰라서 문안이 겹치는 문제(§6-4)를 **구조로 푼다** —
 *   스텝이 확정된 채로 뒤에 쌓이면 AI에 넘길 맥락(앞 문안 전부·순번·트리거로부터 얼마 뒤)이 저절로 갖춰진다.
 *   프롬프트에 컨텍스트를 더 밀어 넣는 방식은 땜질이라는 것이 설계 메모의 결론이다.
 *
 * 1클릭 원칙(CLAUDE.md marketing_user_ux_priority)
 *   빈 스텝에서도 [AI 문안생성]이 눌린다. 사람이 먼저 열 글자를 쓰게 하지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Wand2, Beaker, Plus, Trash2, ChevronLeft, ChevronRight, Clock, AlertTriangle, Save, Loader2,
  Image as ImageIcon, Gift,
} from 'lucide-react';
// ★ 2026-08-08 — 미리보기·바이트는 **실제 나가는 형태**로 잰다. 합성 규칙은 기존 CT 하나가 소유한다
//   (백엔드 buildAdMessage의 프론트 미러 — 직접발송 화면이 쓰는 것과 같은 함수).
//   ★ 2026-10-20 V.3 §9-4 — 쓰는 자리 · 보이는 모습 · 바이트는 큰 휴대폰(PhoneComposer) 한 벌이 맡는다.
import PhoneComposer from './PhoneComposer';
// MMS는 이미지가 본체다 — 채널만 바꿔 두고 붙일 자리가 없으면 그 스텝은 만들다 만 것이 된다.
import JourneyMmsUploader from './JourneyMmsUploader';
// ★ 2026-08-08 — 혜택·링크 placeholder는 텍스트 수술이 아니라 값 입력으로 채운다(판정·치환 단일 정의).
import { hasBenefitPlaceholder, hasUrlPlaceholder } from '../../utils/message-placeholders';

export type StudioChannel = 'sms' | 'lms' | 'mms';
export type StudioDelayMode = 'relative' | 'relative_at_hour' | 'specific_hour' | 'next_business_day';

export interface StudioStep {
  stepOrder: number;
  channel: string;
  messageTemplate: string;
  subject?: string;
  isAd?: boolean;
  delayHours: number;
  delayMode?: StudioDelayMode;
  targetHourKst?: number;
  stepIntent?: string;
  /** MMS 첨부 이미지(서버 경로). 채널이 mms일 때만 쓴다. */
  mmsImagePaths?: string[];
}

interface Props {
  steps: StudioStep[];
  index: number;
  onIndex: (i: number) => void;
  onPatch: (i: number, patch: Partial<StudioStep>) => void;
  onAdd?: () => void;
  onDelete?: (i: number) => void;
  onSave: () => void;
  /** AI 문안생성·다듬기 — 본문이 비어 있어도 부를 수 있다(생성 모드). */
  onAi?: (i: number) => void;
  /**
   * AI 꾸미기 — 회사 보유 컬럼을 %변수%로 녹인다.
   * ★ 2026-08-08 — **고른 컬럼만** 넘긴다(Harold 접수). 전체를 넘기면 AI가 아무 컬럼이나 골라 넣는다.
   *   선택 UI는 날짜축 빌더·AI Operator와 같은 규약(0개면 잠금).
   */
  onDecorate?: (i: number, selectedTokens: string[]) => void;
  onSpamTest?: (i: number) => void;
  /**
   * ★ 2026-08-08 — 마무리 입력 카드. placeholder가 남은 스텝이 있을 때만 그 줄이 보인다.
   *   값을 받으면 **전 스텝의 placeholder를 일괄 치환**한다(치환은 페이지가 소유 — 스텝마다 다시 묻지 않는다).
   */
  onFillBenefit?: (benefit: string) => void;
  /** 링크 줄 — `[URL 입력]`이 남아 있을 때. 형식 판정·치환은 페이지가 소유한다. */
  onFillUrl?: (url: string) => void;
  /**
   * ★ 2026-08-08 — 미리보기 치환용 타겟 최상위 고객 1명(페이지가 이미 들고 있다).
   *   없으면 원문으로 보여주고 그 사실을 알린다 — 지어낸 값으로 채우지 않는다.
   */
  sampleCustomer?: Record<string, string | number | null> | null;
  sampleCustomerFields?: Record<string, any> | null;
  /** 회사 080 수신거부 번호 — 무료수신거부 문구에 붙는다. */
  opt080Number?: string;
  /** ★ V.3 — 저장된 여정이면 [받는 모습]을 서버 미리보기로(이 여정 대상 고객 1명 · 발송 치환 함수). */
  journeyId?: string;
  /** 휴대폰 머리 줄 보낸 사람(회신번호). */
  senderLabel?: string;
  /** 화면에 넣을 수 있는 변수(회사 보유 컬럼에서 온다 — 우리가 지어내지 않는다). `%` 없는 이름. */
  variables?: string[];
  /**
   * ★ 2026-08-08 — AI 꾸미기 컬럼 선택용 목록. **토큰(`%고객명%`) 그대로** 넘긴다 —
   *   꾸미기 API가 받는 값이 토큰이라, 이름만 들고 있다가 다시 조립하면 형태가 갈린다.
   *   날짜축 빌더(`dataProfileVars`)와 같은 모양이다.
   */
  decorateVars?: Array<{ token: string; label: string }>;
  triggerLabel?: string;
  objective?: string;
  aiBusy?: boolean;
  saving?: boolean;
  maxSteps: number;
  /**
   * ★ 2026-10-09 고객 관계 지도 — 칸 하나만 고치는 창(지도 편집 창)용. 넘기지 않으면 기존 동작 그대로(여정 만들기 화면).
   *   single = 스텝 이동 · 추가 · 지우기 · 저장 버튼을 숨긴다(이동은 창의 미니 척추 · 저장은 창의 바닥 줄이 맡는다)
   *   bare = 바깥 테두리 · 그림자를 뺀다(창 안 이중 테두리 방지) · stacked = 좁은 창에서 한 줄로 쌓는다
   *   lockChannel · lockTiming = 서버 편집 정책(stepEditPolicy)이 막은 묶음 — 화면은 그 값대로 잠그기만 한다.
   */
  single?: boolean;
  bare?: boolean;
  stacked?: boolean;
  lockChannel?: boolean;
  lockTiming?: boolean;
  lockNote?: string;
}

/**
 * 광고성 발송 금지 시간대 — 21시~08시 KST(`SEND_HOURS`).
 * ⛔ 밀려난 발송이 **도착하는 시각은 오전 9시**다(`send-time-util`의 `ARRIVE_HOUR = 9`).
 *   금지 창의 시작(08시)과 밀어 보내는 시각(09시)은 다른 값이다 — 화면이 8시라고 하면 한 시간 어긋난다.
 */
const NIGHT_START = 21;
const NIGHT_END = 8;
const SHIFTED_ARRIVE_HOUR = 9;
const isNightHour = (h: number) => h >= NIGHT_START || h < NIGHT_END;

const DELAY_PRESETS: Array<{ label: string; hours: number }> = [
  { label: '즉시', hours: 0 },
  { label: '1시간 뒤', hours: 1 },
  { label: '3시간 뒤', hours: 3 },
  { label: '하루 뒤', hours: 24 },
  { label: '3일 뒤', hours: 72 },
  { label: '7일 뒤', hours: 168 },
];

/**
 * ★ 2026-08-08 (Harold 접수) — 프리셋 6개만 두면 5일 뒤·2주 뒤를 만들 길이 없다.
 *   상한은 백엔드 `MAX_STEP_DELAY_HOURS`와 같은 값이어야 한다 — 화면이 더 크게 받으면 저장에서 조용히 깎인다.
 */
const MAX_DELAY_HOURS = 8760;   // 365일

export default function JourneyStepStudio({
  steps, index, onIndex, onPatch, onAdd, onDelete, onSave,
  onAi, onDecorate, onSpamTest, onFillBenefit, onFillUrl,
  sampleCustomer = null, sampleCustomerFields = null, opt080Number = '', journeyId, senderLabel,
  variables = [], decorateVars = [], triggerLabel, objective,
  aiBusy = false, saving = false, maxSteps,
  single = false, bare = false, stacked = false, lockChannel = false, lockTiming = false, lockNote,
}: Props) {
  const step = steps[index];
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [showVars, setShowVars] = useState(false);
  // ★ 2026-08-08 — 마무리 입력값(치환 전까지만 유지). 어느 스텝에든 그 placeholder가 남아 있으면 그 줄이 뜬다.
  const [benefitInput, setBenefitInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const anyStepHas = (fn: (t: string) => boolean) =>
    steps.some((s) => fn(s.messageTemplate || '') || fn(s.subject || ''));
  const benefitSlots = useMemo(() => anyStepHas(hasBenefitPlaceholder), [steps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const urlSlots = useMemo(() => anyStepHas(hasUrlPlaceholder), [steps]);           // eslint-disable-line react-hooks/exhaustive-deps
  // ★ 2026-08-08 — AI 꾸미기에 넣을 컬럼. 고른 것만 넘긴다(날짜축 빌더·Operator와 같은 규약).
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  // ★ 2026-08-08 — 발송 시점 직접 입력. 저장된 값이 프리셋에 없으면(예: 5일) 자동으로 열린다.
  const [customDelayOpen, setCustomDelayOpen] = useState(false);
  useEffect(() => { setCustomDelayOpen(false); }, [index]);   // 스텝을 옮기면 그 스텝 값 기준으로 다시 판단한다

  /**
   * ★ 2026-08-08 (Harold 지시) — **이미 문안에 쓰인 컬럼은 처음부터 선택돼 있다.**
   *   AI Operator가 그렇게 하고 있었는데(변형이 실제로 쓴 %변수%만 자동 체크) 여기만 빈 채로 시작했다.
   *   ⛔ 매 타이핑마다 다시 계산하지 않는다 — 그러면 사용자가 체크를 풀어도 즉시 되살아난다.
   *     스텝을 열 때와 컬럼 목록이 도착할 때만 맞춘다(그 뒤로는 사용자 선택이 진실).
   */
  useEffect(() => {
    const s = steps[index];
    if (!s) return;
    const valid = new Set(decorateVars.map((v) => v.token));
    const used = new Set<string>();
    const text = `${s.messageTemplate || ''}\n${s.subject || ''}`;
    // 본문은 %고객명%인데 칩 토큰은 % 없는 이름이다 — 캡처그룹으로 맞춘다(Operator와 같은 규약).
    for (const m of Array.from(text.matchAll(/%([^%\n]+)%/g))) {
      if (valid.has(m[1])) used.add(m[1]);
    }
    setSelectedVars(used);
  }, [index, decorateVars]);   // eslint-disable-line react-hooks/exhaustive-deps

  const channel = (step?.channel === 'sms' || step?.channel === 'mms' ? step.channel : 'lms') as StudioChannel;
  const isAdStep = step?.isAd !== false;

  /** 트리거로부터 누적 몇 시간인가 — AI 맥락과 화면 표기가 같은 값을 쓴다. */
  const hoursFromTrigger = useMemo(
    () => steps.slice(0, index + 1).reduce((sum, s) => sum + (Number(s.delayHours) || 0), 0),
    [steps, index]
  );

  /** 프리셋에 없는 값이면 직접 입력이 진실이다 — 저장된 여정을 열었을 때 5일(120시간)이 아무 데도 안 걸리면 안 된다. */
  const delayHoursNow = Math.max(0, Number(step?.delayHours) || 0);
  const customDelay = customDelayOpen || !DELAY_PRESETS.some((p) => p.hours === delayHoursNow);
  /**
   * ★ 2026-08-08 정정 — 직접 입력은 **며칠 뒤** 하나다(Harold 지시).
   *   옛 시간·일 셀렉트는 값이 0일 때 `0 × 24 = 0`이라 단위를 바꿔도 아무것도 안 바뀌었다(내 결함).
   *   단위가 하나면 그 계산 자체가 사라진다 — 시간 단위가 필요한 자리는 프리셋(1·3시간)이 갖는다.
   */
  const delayDays = Math.floor(delayHoursNow / 24);
  const delayHasOddHours = delayHoursNow % 24 !== 0;

  const hourFixed = step?.delayMode === 'specific_hour' || step?.delayMode === 'relative_at_hour';
  const nightHit = hourFixed && step?.targetHourKst != null && isNightHour(Number(step.targetHourKst));

  if (!step) return null;

  const insertVar = (name: string) => {
    const token = `%${name}%`;
    const ta = taRef.current;
    const body = step.messageTemplate || '';
    if (!ta) {
      onPatch(index, { messageTemplate: body + token });
      return;
    }
    const s = ta.selectionStart ?? body.length;
    const e = ta.selectionEnd ?? body.length;
    onPatch(index, { messageTemplate: body.slice(0, s) + token + body.slice(e) });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = s + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className={bare ? 'bg-white' : 'rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden'}>
      {/* 헤더 — 지금이 몇 번째인지 한눈에 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 backdrop-blur md:px-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-bold text-white">
          {step.stepOrder}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            {single ? `${step.stepOrder}번째 칸` : <>스텝 {step.stepOrder}<span className="text-slate-400">/ {steps.length}</span></>}
          </div>
          <div className="truncate text-[12px] text-slate-400">
            {triggerLabel ? `${triggerLabel} 발생 후` : '트리거 발생 후'} · {hoursFromTrigger === 0 ? '즉시' : hoursFromTrigger % 24 === 0 ? `${hoursFromTrigger / 24}일 뒤` : `${hoursFromTrigger}시간 뒤`}
          </div>
        </div>

        {!single && <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-white disabled:opacity-30"
            aria-label="이전 스텝"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1 px-1">
            {steps.map((s, i) => (
              <button
                key={s.stepOrder}
                type="button"
                onClick={() => onIndex(i)}
                aria-label={`스텝 ${s.stepOrder}로 이동`}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-violet-400' : 'w-1.5 bg-slate-200 hover:bg-slate-300'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => onIndex(Math.min(steps.length - 1, index + 1))}
            disabled={index >= steps.length - 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-white disabled:opacity-30"
            aria-label="다음 스텝"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>}
      </div>
      {lockNote && (
        <div className="mx-4 mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500 md:mx-5">{lockNote}</div>
      )}

      <div className={`grid grid-cols-1 gap-5 p-4 md:p-5 ${stacked ? '' : 'lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]'}`}>
        {/* 좌 — 큰 휴대폰(받은 문자 모양 그대로 쓴다) */}
        <div className="min-w-0 space-y-3">
          <fieldset disabled={lockChannel} className="flex flex-wrap items-center justify-center gap-1.5 disabled:opacity-60">
            <legend className="sr-only">채널</legend>
            {(['sms', 'lms', 'mms'] as StudioChannel[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onPatch(index, { channel: c })}
                aria-pressed={channel === c}
                className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition-colors ${
                  channel === c ? 'bg-violet-100 text-violet-900 ring-1 ring-violet-300' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {c === 'sms' ? '문자' : c === 'lms' ? '장문' : '사진'}
              </button>
            ))}
          </fieldset>
          <PhoneComposer
            channel={channel}
            subject={step.subject || ''}
            body={step.messageTemplate || ''}
            isAd={isAdStep}
            opt080Number={opt080Number}
            onSubject={(v) => onPatch(index, { subject: v })}
            onBody={(v) => onPatch(index, { messageTemplate: v })}
            textareaRef={taRef}
            journeyId={journeyId}
            sampleCustomer={sampleCustomer}
            sampleCustomerFields={sampleCustomerFields}
            senderLabel={senderLabel}
            imageCount={channel === 'mms' ? (step.mmsImagePaths?.length ?? 0) : 0}
            placeholder="이 칸에서 보낼 문안이에요. 비워 두고 AI 문안생성을 눌러도 돼요."
            resetKey={`${index}:${step.stepOrder}`}
          />
        </div>

        {/* 우 — 도구 */}
        <div className="min-w-0 space-y-3">
          {/* MMS 이미지 — 채널을 MMS로 바꾸면 바로 붙일 자리가 나온다.
              ⛔ 이미지가 없는 MMS는 만들다 만 스텝이다. 채널만 바꿔 두고 넘어가지 못하게 이 자리에서 알린다. */}
          {channel === 'mms' && (
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
              <div className="mb-2 flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-violet-700" />
                <span className="text-[12px] font-semibold text-slate-600">이미지 첨부</span>
                <span className="text-[12px] text-slate-400">MMS는 이미지가 함께 나갑니다</span>
              </div>
              <JourneyMmsUploader
                value={step.mmsImagePaths || []}
                onChange={(paths) => onPatch(index, { mmsImagePaths: paths })}
              />
              {(step.mmsImagePaths?.length ?? 0) === 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-amber-800">
                  아직 이미지가 없습니다. 이대로 두면 글자만 나가니, 이미지를 넣거나 채널을 LMS로 되돌려 주세요.
                </p>
              )}
            </div>
          )}

          {/* ★ 2026-08-08 — 혜택·링크는 값으로 받는다. 문안 속 placeholder를 손으로 고치게 하지 않는다.
              남은 자리만큼만 줄이 뜨고, 입력 한 번이 전 스텝을 채운다. */}
          {((benefitSlots && onFillBenefit) || (urlSlots && onFillUrl)) && (
            <div className="space-y-2.5 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3">
              <div className="flex items-center gap-1.5">
                <Gift className="h-3.5 w-3.5 text-fuchsia-700" />
                <span className="text-xs font-semibold text-slate-700">마지막 한 가지만 알려 주세요. 문장은 그대로 잇습니다</span>
              </div>

              {benefitSlots && onFillBenefit && (
                <div>
                  <p className="mb-1.5 text-[12px] leading-relaxed text-slate-500">
                    문안의 혜택 자리에 들어갈 실제 혜택입니다. 입력하면 모든 스텝에 한 번에 채워 드려요.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={benefitInput}
                      onChange={(e) => setBenefitInput(e.target.value.slice(0, 200))}
                      placeholder="예: 신규 가입 10% 쿠폰 · 5,000원 적립"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && benefitInput.trim()) {
                          e.preventDefault();
                          onFillBenefit(benefitInput);
                          setBenefitInput('');
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-300 focus:border-fuchsia-300 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!benefitInput.trim()}
                      onClick={() => { onFillBenefit(benefitInput); setBenefitInput(''); }}
                      className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
                    >
                      혜택 넣기
                    </button>
                  </div>
                </div>
              )}

              {urlSlots && onFillUrl && (
                <div>
                  <p className="mb-1.5 text-[12px] leading-relaxed text-slate-500">
                    문안에 넣을 링크 주소입니다. 주소는 발송할 때 짧은 링크로 바뀝니다.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value.slice(0, 300))}
                      placeholder="https://"
                      inputMode="url"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && urlInput.trim()) {
                          e.preventDefault();
                          onFillUrl(urlInput);
                          setUrlInput('');
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-300 focus:border-fuchsia-300 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!urlInput.trim()}
                      onClick={() => { onFillUrl(urlInput); setUrlInput(''); }}
                      className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
                    >
                      링크 넣기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 변수 — 회사가 가진 컬럼만 나온다 */}
          {variables.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-2.5">
              <button
                type="button"
                onClick={() => setShowVars((v) => !v)}
                className="text-[12px] font-medium text-slate-500 hover:text-slate-700"
              >
                변수 넣기 {showVars ? '접기' : `(${variables.length})`}
              </button>
              {showVars && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {variables.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVar(v)}
                      className="rounded-md bg-white px-2 py-1 text-[12px] text-violet-800 transition-colors hover:bg-violet-100"
                    >
                      %{v}%
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ★ 2026-08-08 (Harold 접수) — AI 꾸미기는 **고른 컬럼만** 녹인다.
              전체를 넘기면 AI가 아무 컬럼이나 골라 넣는다. 0개면 잠금(날짜축·Operator와 같은 규약). */}
          {/* ⛔ 컬럼이 0이어도 카드를 숨기지 않는다 — 숨기면 "왜 안 나오지"가 화면에서 안 보인다
              (2026-08-08: 데이터가 안 실려 카드가 통째로 사라졌는데 원인을 화면에서 알 수 없었다). */}
          <div className="rounded-xl border border-violet-200 bg-white p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-violet-700" />
              <span className="text-xs font-semibold text-slate-700">
                AI 꾸미기 <span className="font-normal text-slate-400">{selectedVars.size > 0 ? `${selectedVars.size}개 선택` : '컬럼 선택'}</span>
              </span>
            </div>
            {decorateVars.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-amber-800">
                문안에 넣을 수 있는 고객 데이터 항목이 아직 없습니다. 고객 정보를 올리면 여기에 컬럼이 나타납니다.
              </p>
            ) : (
              <>
              <p className="mb-2 text-[12px] leading-relaxed text-slate-500">넣고 싶은 데이터를 골라 주세요. AI가 문안에 자연스럽게 녹입니다.</p>
              <div className="flex flex-wrap gap-1.5">
                {decorateVars.map((v) => {
                  const on = selectedVars.has(v.token);
                  return (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => setSelectedVars((prev) => {
                        const n = new Set(prev);
                        if (n.has(v.token)) n.delete(v.token); else n.add(v.token);
                        return n;
                      })}
                      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all ${
                        on ? 'border-violet-300 bg-violet-100 text-violet-900' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      %{v.label}%
                    </button>
                  );
                })}
              </div>
              </>
            )}
          </div>

          {/* 액션 3 — 오퍼레이터 화면과 같은 정렬 */}
          {(onAi || onDecorate || onSpamTest) && <div className="flex flex-wrap gap-2">
            {onAi && <button
              type="button"
              onClick={() => onAi(index)}
              disabled={aiBusy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {(step.messageTemplate || '').trim().length >= 5 ? 'AI 다듬기' : 'AI 문안생성'}
            </button>}
            {onDecorate && <button
              type="button"
              onClick={() => onDecorate(index, Array.from(selectedVars))}
              disabled={aiBusy || selectedVars.size === 0}
              title={selectedVars.size === 0 ? '아래에서 넣을 컬럼을 먼저 골라 주세요' : undefined}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" /> AI 꾸미기{selectedVars.size > 0 ? ` (${selectedVars.size})` : ''}
            </button>}
            {onSpamTest && <button
              type="button"
              onClick={() => onSpamTest(index)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              <Beaker className="h-3.5 w-3.5" /> 스팸필터 테스트
            </button>}
          </div>}

          {/* 언제 보낼지 */}
          <fieldset disabled={lockTiming} className="rounded-xl border border-slate-200 bg-slate-100 p-3 disabled:opacity-60">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Clock className="h-3.5 w-3.5 text-violet-700" />
              {index === 0 ? '트리거가 발생하면' : '앞 스텝을 보낸 뒤'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DELAY_PRESETS.map((p) => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => { setCustomDelayOpen(false); onPatch(index, { delayHours: p.hours }); }}
                  className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                    !customDelay && Number(step.delayHours) === p.hours
                      ? 'bg-violet-100 text-violet-900 ring-1 ring-violet-300'
                      : 'bg-white text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {/* ★ 2026-08-08 (Harold 접수) — 프리셋만 두면 5일 뒤·2주 뒤를 만들 길이 없다. */}
              <button
                type="button"
                onClick={() => setCustomDelayOpen(true)}
                className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                  customDelay
                    ? 'bg-violet-100 text-violet-900 ring-1 ring-violet-300'
                    : 'bg-white text-slate-500 hover:bg-slate-100'
                }`}
              >
                직접 입력
              </button>
            </div>

            {customDelay && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={Math.floor(MAX_DELAY_HOURS / 24)}
                    value={delayDays}
                    onChange={(e) => {
                      const days = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      onPatch(index, { delayHours: Math.min(MAX_DELAY_HOURS, days * 24) });
                    }}
                    className="w-20 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-300 focus:outline-none"
                  />
                  <span className="text-xs text-slate-600">일 뒤</span>
                  <span className="text-[12px] text-slate-400">최대 365일</span>
                </div>
                {delayHasOddHours && (
                  // 지금 값이 시간 단위라 일수로 딱 떨어지지 않는다 — 조용히 바꾸지 않고 사실을 알린다.
                  <p className="mt-1.5 text-[12px] leading-relaxed text-amber-800">
                    지금은 {delayHoursNow}시간 뒤로 설정돼 있습니다. 위 일수를 입력하면 그 값으로 바뀝니다.
                  </p>
                )}
              </div>
            )}

            <label className="mt-3 flex items-center gap-2 text-[12px] text-slate-500">
              <input
                type="checkbox"
                checked={hourFixed}
                onChange={(e) =>
                  onPatch(index, {
                    delayMode: e.target.checked ? 'relative_at_hour' : 'relative',
                    targetHourKst: e.target.checked ? (step.targetHourKst ?? 10) : undefined,
                  })
                }
                className="h-3.5 w-3.5 rounded border-slate-300 bg-slate-100"
              />
              보내는 시각도 정하기
            </label>
            {hourFixed && (
              <select
                value={step.targetHourKst ?? 10}
                onChange={(e) => onPatch(index, { targetHourKst: Number(e.target.value) })}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-300 focus:outline-none"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>
                ))}
              </select>
            )}
          </fieldset>

          {/* 야간 안내 — 광고성은 21~08시 발송 금지 */}
          {step.isAd !== false && (
            <div
              className={`flex gap-2 rounded-xl border p-3 text-[12px] leading-relaxed ${
                nightHit ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-100 text-slate-500'
              }`}
            >
              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${nightHit ? 'text-amber-700' : 'text-slate-400'}`} />
              {nightHit ? (
                <span>
                  <strong className="font-semibold">밤 9시~아침 8시에는 광고 문자를 보낼 수 없습니다.</strong> 이 설정에 걸리는 문자는 자동으로 <strong>오전 {SHIFTED_ARRIVE_HOUR}시</strong>에 나갑니다.
                </span>
              ) : (
                <span>광고 문자는 밤 9시~아침 8시에 나가지 않습니다. 그 시간에 걸리면 오전 {SHIFTED_ARRIVE_HOUR}시에 자동으로 발송됩니다.</span>
              )}
            </div>
          )}

          {objective && (
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
              <div className="mb-1 text-[12px] font-medium text-slate-400">이 여정의 목적</div>
              <p className="text-[12px] leading-relaxed text-slate-600">{objective}</p>
            </div>
          )}

          <div className="space-y-2">
            {onAdd && !single && <button
              type="button"
              onClick={onAdd}
              disabled={steps.length >= maxSteps}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-semibold text-violet-900 transition-colors hover:bg-violet-100 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {steps.length >= maxSteps ? `스텝은 최대 ${maxSteps}개` : '스텝 추가'}
            </button>}
            {!single && <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              저장하기
            </button>}
            {onDelete && !single && steps.length > 1 && (
              <button
                type="button"
                onClick={() => onDelete(index)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-400 transition-colors hover:border-rose-200 hover:text-rose-800"
              >
                <Trash2 className="h-3.5 w-3.5" /> 이 스텝 지우기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
