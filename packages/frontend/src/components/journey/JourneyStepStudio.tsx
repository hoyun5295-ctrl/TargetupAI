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
import { useMemo, useRef, useState } from 'react';
import {
  Sparkles, Wand2, Beaker, Plus, Trash2, ChevronLeft, ChevronRight, Clock, AlertTriangle, Save, Loader2,
  Image as ImageIcon, Gift,
} from 'lucide-react';
// ★ 2026-08-08 — 미리보기·바이트는 **실제 나가는 형태**로 잰다. 합성 규칙은 기존 CT 하나가 소유한다
//   (백엔드 buildAdMessage의 프론트 미러 — 직접발송 화면이 쓰는 것과 같은 함수).
import { calculateSmsBytes, buildAdMessageFront, buildAdSubjectFront } from '../../utils/formatDate';
import { highlightVars, mergeVarsPlain } from '../../utils/highlightVars';
import { renderLiquid, flattenCustomerForLiquid } from '../../utils/liquid-templating';
// MMS는 이미지가 본체다 — 채널만 바꿔 두고 붙일 자리가 없으면 그 스텝은 만들다 만 것이 된다.
import JourneyMmsUploader from './JourneyMmsUploader';
// ★ 2026-08-08 — 혜택 placeholder는 텍스트 수술이 아니라 값 입력으로 채운다(판정·치환 단일 정의).
import { hasBenefitPlaceholder } from '../../utils/benefit-placeholder';

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
  onAdd: () => void;
  onDelete: (i: number) => void;
  onSave: () => void;
  /** AI 문안생성·다듬기 — 본문이 비어 있어도 부를 수 있다(생성 모드). */
  onAi: (i: number) => void;
  /** AI 꾸미기 — 회사 보유 컬럼을 %변수%로 녹인다. */
  onDecorate: (i: number) => void;
  onSpamTest: (i: number) => void;
  /**
   * ★ 2026-08-08 — 혜택 입력 카드. placeholder가 남은 스텝이 있을 때만 보인다.
   *   값을 받으면 **전 스텝의 placeholder를 일괄 치환**한다(치환은 페이지가 소유 — 스텝마다 다시 묻지 않는다).
   */
  onFillBenefit?: (benefit: string) => void;
  /**
   * ★ 2026-08-08 — 미리보기 치환용 타겟 최상위 고객 1명(페이지가 이미 들고 있다).
   *   없으면 원문으로 보여주고 그 사실을 알린다 — 지어낸 값으로 채우지 않는다.
   */
  sampleCustomer?: Record<string, string | number | null> | null;
  sampleCustomerFields?: Record<string, any> | null;
  /** 회사 080 수신거부 번호 — 무료수신거부 문구에 붙는다. */
  opt080Number?: string;
  /** 화면에 넣을 수 있는 변수(회사 보유 컬럼에서 온다 — 우리가 지어내지 않는다). */
  variables?: string[];
  triggerLabel?: string;
  objective?: string;
  aiBusy?: boolean;
  saving?: boolean;
  maxSteps: number;
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

export default function JourneyStepStudio({
  steps, index, onIndex, onPatch, onAdd, onDelete, onSave,
  onAi, onDecorate, onSpamTest, onFillBenefit,
  sampleCustomer = null, sampleCustomerFields = null, opt080Number = '',
  variables = [], triggerLabel, objective,
  aiBusy = false, saving = false, maxSteps,
}: Props) {
  const step = steps[index];
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [showVars, setShowVars] = useState(false);
  // ★ 2026-08-08 — 혜택 입력값(치환 전까지만 유지). 어느 스텝에든 placeholder가 남아 있으면 카드가 뜬다.
  const [benefitInput, setBenefitInput] = useState('');
  const benefitSlots = useMemo(
    () => steps.some((s) => hasBenefitPlaceholder(s.messageTemplate) || hasBenefitPlaceholder(s.subject || '')),
    [steps]
  );

  const channel = (step?.channel === 'sms' || step?.channel === 'mms' ? step.channel : 'lms') as StudioChannel;
  const maxBytes = channel === 'sms' ? 90 : 2000;
  const msgType = channel.toUpperCase();
  const isAdStep = step?.isAd !== false;

  /**
   * ★ 2026-08-08 (Harold 접수) — 세는 것도 보이는 것도 **실제 나가는 형태**여야 한다.
   *   옛 검토 화면은 (광고)·무료수신거부를 합성해 보여 줬는데 스튜디오는 순수 본문만 보여 주고 재고 있었다.
   *   `(광고)` + 개행 + `무료거부0801234567`이 약 27바이트라, SMS에서 "88 / 90"이 실제로는 초과다.
   *   ⛔ 저장 본문(`messageTemplate`)은 순수 상태 그대로 둔다 — 합성은 표시·계산에서만(이중 부착 차단 규약).
   */
  const adComposed = useMemo(
    () => buildAdMessageFront(step?.messageTemplate || '', msgType, isAdStep, opt080Number),
    [step?.messageTemplate, msgType, isAdStep, opt080Number]
  );
  // 바이트는 **변수 치환 전** 원문 기준으로 잰다 — 치환값은 고객마다 달라 숫자가 흔들린다(토큰 길이가 통제 가능한 값).
  const bytes = useMemo(() => calculateSmsBytes(adComposed), [adComposed]);
  const over = bytes > maxBytes;

  /** 보이는 모습 = 샘플 고객 치환 → 광고 합성. 샘플이 없으면 치환 없이 원문 그대로(지어내지 않는다). */
  const previewBody = useMemo(() => {
    const raw = step?.messageTemplate || '';
    if (!raw) return '';
    const merged = sampleCustomer
      ? mergeVarsPlain(
          renderLiquid(raw, { customer: flattenCustomerForLiquid(sampleCustomerFields || {}) }).rendered,
          sampleCustomer,
          sampleCustomerFields || undefined
        )
      : raw;
    return buildAdMessageFront(merged, msgType, isAdStep, opt080Number);
  }, [step?.messageTemplate, sampleCustomer, sampleCustomerFields, msgType, isAdStep, opt080Number]);

  /** 트리거로부터 누적 몇 시간인가 — AI 맥락과 화면 표기가 같은 값을 쓴다. */
  const hoursFromTrigger = useMemo(
    () => steps.slice(0, index + 1).reduce((sum, s) => sum + (Number(s.delayHours) || 0), 0),
    [steps, index]
  );

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
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 shadow-2xl overflow-hidden">
      {/* 헤더 — 지금이 몇 번째인지 한눈에 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-900/95 px-4 py-3 backdrop-blur md:px-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-bold text-white">
          {step.stepOrder}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            스텝 {step.stepOrder}
            <span className="text-white/35">/ {steps.length}</span>
          </div>
          <div className="truncate text-[11px] text-white/45">
            {triggerLabel ? `${triggerLabel} 발생 후` : '트리거 발생 후'} · {hoursFromTrigger === 0 ? '즉시' : hoursFromTrigger % 24 === 0 ? `${hoursFromTrigger / 24}일 뒤` : `${hoursFromTrigger}시간 뒤`}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:bg-white/5 disabled:opacity-25"
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
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-violet-400' : 'w-1.5 bg-white/20 hover:bg-white/40'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => onIndex(Math.min(steps.length - 1, index + 1))}
            disabled={index >= steps.length - 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:bg-white/5 disabled:opacity-25"
            aria-label="다음 스텝"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-5 md:p-5">
        {/* 좌 — 문안 */}
        <div className="space-y-3 md:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            {(['sms', 'lms', 'mms'] as StudioChannel[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onPatch(index, { channel: c })}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  channel === c ? 'bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/40' : 'text-white/45 hover:bg-white/5'
                }`}
              >
                {c.toUpperCase()}
              </button>
            ))}
            <span className={`ml-auto text-[11px] tabular-nums ${over ? 'text-rose-300' : 'text-white/35'}`}>
              {bytes} / {maxBytes} byte
              {isAdStep && <span className="ml-1 font-sans text-[10px] text-white/30">(광고 표기 포함)</span>}
            </span>
          </div>

          {channel !== 'sms' && (
            <input
              value={step.subject || ''}
              onChange={(e) => onPatch(index, { subject: e.target.value.slice(0, 50) })}
              placeholder="제목 (LMS·MMS 필수)"
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-violet-400/50 focus:outline-none"
            />
          )}

          <textarea
            ref={taRef}
            value={step.messageTemplate || ''}
            onChange={(e) => onPatch(index, { messageTemplate: e.target.value })}
            rows={9}
            placeholder="이 스텝에서 보낼 문안입니다. 비워 두고 [AI 문안생성]을 눌러도 됩니다."
            className={`w-full resize-y rounded-xl border bg-slate-950/60 px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-white/25 focus:outline-none ${
              over ? 'border-rose-400/50' : 'border-white/10 focus:border-violet-400/50'
            }`}
          />

          {/* MMS 이미지 — 채널을 MMS로 바꾸면 바로 붙일 자리가 나온다.
              ⛔ 이미지가 없는 MMS는 만들다 만 스텝이다. 채널만 바꿔 두고 넘어가지 못하게 이 자리에서 알린다. */}
          {channel === 'mms' && (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-violet-300" />
                <span className="text-[11px] font-semibold text-white/75">이미지 첨부</span>
                <span className="text-[10px] text-white/35">MMS는 이미지가 함께 나갑니다</span>
              </div>
              <JourneyMmsUploader
                value={step.mmsImagePaths || []}
                onChange={(paths) => onPatch(index, { mmsImagePaths: paths })}
              />
              {(step.mmsImagePaths?.length ?? 0) === 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
                  아직 이미지가 없습니다. 이대로 두면 글자만 나가니, 이미지를 넣거나 채널을 LMS로 되돌려 주세요.
                </p>
              )}
            </div>
          )}

          {/* ★ 2026-08-08 — 혜택은 값으로 받는다. 문안 속 placeholder를 손으로 고치게 하지 않는다.
              어느 스텝에든 placeholder가 남아 있으면 뜨고, 입력 한 번이 전 스텝을 채운다. */}
          {benefitSlots && onFillBenefit && (
            <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Gift className="h-3.5 w-3.5 text-fuchsia-300" />
                <span className="text-xs font-semibold text-white/85">혜택만 알려 주세요 — 문장은 그대로 잇습니다</span>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-white/50">
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
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-fuchsia-400/50 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!benefitInput.trim()}
                  onClick={() => { onFillBenefit(benefitInput); setBenefitInput(''); }}
                  className="shrink-0 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  혜택 넣기
                </button>
              </div>
            </div>
          )}

          {/* 변수 — 회사가 가진 컬럼만 나온다 */}
          {variables.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
              <button
                type="button"
                onClick={() => setShowVars((v) => !v)}
                className="text-[11px] font-medium text-white/55 hover:text-white/80"
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
                      className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-violet-200 transition-colors hover:bg-violet-500/20"
                    >
                      %{v}%
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[10px] italic text-white/30">Data source — 회사 고객 데이터에 실제로 있는 컬럼만 표시됩니다.</p>
            </div>
          )}

          {/* 액션 3 — 오퍼레이터 화면과 같은 정렬 */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAi(index)}
              disabled={aiBusy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {(step.messageTemplate || '').trim().length >= 5 ? 'AI 다듬기' : 'AI 문안생성'}
            </button>
            <button
              type="button"
              onClick={() => onDecorate(index)}
              disabled={aiBusy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" /> AI 꾸미기
            </button>
            <button
              type="button"
              onClick={() => onSpamTest(index)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10"
            >
              <Beaker className="h-3.5 w-3.5" /> 스팸필터 테스트
            </button>
          </div>

          {(step.messageTemplate || '').trim() && (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-white/45">보이는 모습</span>
                {sampleCustomer
                  ? <span className="text-[10px] text-emerald-300/70">타겟 최상위 고객 기준 · 실제 발송 형태</span>
                  : <span className="text-[10px] text-amber-300/70">아직 이 조건의 타겟 고객이 없어 원본으로 표시됩니다</span>}
              </div>
              {/* 제목도 발송 형태로 — 광고 문자는 제목에 (광고)가 붙는다. */}
              {channel !== 'sms' && step.subject && (
                <div className="mb-2 border-b border-white/10 pb-2 text-[12px]">
                  <span className="text-white/45">제목 </span>
                  <span className="text-white/85">{buildAdSubjectFront(step.subject, msgType, isAdStep)}</span>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85">
                {sampleCustomer ? previewBody : highlightVars(previewBody)}
              </div>
              <p className="mt-2 text-[10px] italic text-white/30">
                Data source — 저장된 스텝 본문{sampleCustomer ? ' + 추출된 타겟 최상위 고객 1명' : ''}. (광고) 표기와 무료수신거부는 발송할 때 자동으로 붙고, 위 미리보기·바이트에 이미 반영돼 있습니다.
              </p>
            </div>
          )}
        </div>

        {/* 우 — 언제 보낼지 */}
        <div className="space-y-3 md:col-span-2">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white/70">
              <Clock className="h-3.5 w-3.5 text-violet-300" />
              {index === 0 ? '트리거가 발생하면' : '앞 스텝을 보낸 뒤'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DELAY_PRESETS.map((p) => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => onPatch(index, { delayHours: p.hours })}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    Number(step.delayHours) === p.hours
                      ? 'bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/40'
                      : 'bg-white/5 text-white/55 hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="mt-3 flex items-center gap-2 text-[11px] text-white/55">
              <input
                type="checkbox"
                checked={hourFixed}
                onChange={(e) =>
                  onPatch(index, {
                    delayMode: e.target.checked ? 'relative_at_hour' : 'relative',
                    targetHourKst: e.target.checked ? (step.targetHourKst ?? 10) : undefined,
                  })
                }
                className="h-3.5 w-3.5 rounded border-white/20 bg-slate-950"
              />
              보내는 시각도 정하기
            </label>
            {hourFixed && (
              <select
                value={step.targetHourKst ?? 10}
                onChange={(e) => onPatch(index, { targetHourKst: Number(e.target.value) })}
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-xs text-white focus:border-violet-400/50 focus:outline-none"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>
                ))}
              </select>
            )}
          </div>

          {/* 야간 안내 — 광고성은 21~08시 발송 금지 */}
          {step.isAd !== false && (
            <div
              className={`flex gap-2 rounded-xl border p-3 text-[11px] leading-relaxed ${
                nightHit ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-white/10 bg-slate-950/40 text-white/50'
              }`}
            >
              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${nightHit ? 'text-amber-300' : 'text-white/30'}`} />
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
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="mb-1 text-[11px] font-medium text-white/45">이 여정의 목적</div>
              <p className="text-[12px] leading-relaxed text-white/70">{objective}</p>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={steps.length >= maxSteps}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2.5 text-xs font-semibold text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              {steps.length >= maxSteps ? `스텝은 최대 ${maxSteps}개` : '스텝 추가'}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              저장하기
            </button>
            {steps.length > 1 && (
              <button
                type="button"
                onClick={() => onDelete(index)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[11px] font-medium text-white/45 transition-colors hover:border-rose-400/30 hover:text-rose-200"
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
