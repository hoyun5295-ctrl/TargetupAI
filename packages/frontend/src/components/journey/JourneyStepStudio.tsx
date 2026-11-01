/**
 * JourneyStepStudio — 여정 작업 화면의 칸 하나(★ 2026-11-01 여정 재발 방지 배포 2 C6 · 3단 화면의 왼쪽 휴대폰 + 가운데 설정 한 판)
 *
 * 쓰는 곳 = JourneyWorkspace 하나. 오른쪽 점검 판(서버 점검 응답)은 작업 화면이 그린다.
 *   왼쪽 = 큰 휴대폰(받은 문자 모양 그대로 쓴다 · PhoneComposer 한 벌)
 *   가운데 = 「이름 | 고르기」 줄: 채널 · AI · 혜택 · 링크 · 넣을 데이터 · 보내는 때(+ 밤 안내) · 담당자 알림 · 사진(MMS)
 *   판 머리 오른쪽 = A/B · 칸 빼기(작업 화면이 넘긴다)
 * 1클릭 원칙(CLAUDE.md marketing_user_ux_priority) — 빈 칸에서도 [AI 문안 쓰기]가 눌린다. 사람이 먼저 열 글자를 쓰게 하지 않는다.
 * 낱말 = 칸 · 바로 · 스팸 검사 · 사진(설계서 §3 C6).
 */
import { useSendPolicy, isSendableHour, nightRangeText, koHour } from '../../utils/send-policy';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sparkles, Wand2, Clock, AlertTriangle, Loader2, Gift, Undo2 } from 'lucide-react';
// ★ 2026-08-08 — 미리보기·바이트는 **실제 나가는 형태**로 잰다(백엔드 buildAdMessage 의 프론트 미러).
//   ★ 2026-10-20 V.3 §9-4 — 쓰는 자리 · 보이는 모습 · 바이트는 큰 휴대폰(PhoneComposer) 한 벌이 맡는다.
import PhoneComposer from './PhoneComposer';
// MMS는 사진이 본체다 — 채널만 바꿔 두고 붙일 자리가 없으면 그 칸은 만들다 만 것이 된다.
import JourneyMmsUploader from './JourneyMmsUploader';
// ★ 2026-08-08 — 혜택·링크 자리는 텍스트 수술이 아니라 값 입력으로 채운다(판정·치환 단일 정의).
import { hasBenefitPlaceholder, hasUrlPlaceholder } from '../../utils/message-placeholders';
import { stepChannelLabel } from '../../utils/journey-labels';

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
  /** MMS 첨부 사진(서버 경로). 채널이 mms일 때만 쓴다. */
  mmsImagePaths?: string[];
}

interface Props {
  step: StudioStep;
  /** 이 칸이 여정 첫 문자 칸인가(보내는 때 줄 말머리 · 「시작하면」 / 「앞 칸을 보낸 뒤」) */
  first: boolean;
  onPatch: (patch: Partial<StudioStep>) => void;
  /** AI 문안 쓰기 · 다듬기 — 본문이 비어 있어도 부를 수 있다(쓰기 모드). */
  onAi?: () => void;
  /** AI 꾸미기 — 고른 컬럼만 넘긴다(★ 2026-08-08 Harold 접수 · 전체를 넘기면 AI가 아무 컬럼이나 넣는다). */
  onDecorate?: (selectedTokens: string[]) => void;
  /** AI 전으로 — 마지막 AI 결과 직전 글로(있을 때만) */
  onUndoAi?: () => void;
  /** 혜택 넣기 — 값을 받으면 전 칸 자리를 한 번에(치환 · 원장은 작업 화면 · 서버가 소유) */
  onFillBenefit?: (benefit: string) => void;
  /** 링크 넣기 — 형식 판정 · 치환은 작업 화면이 소유한다. */
  onFillUrl?: (url: string) => void;
  /** ★ 2026-11-01 B1-3 — 저장된 여정에 사람 값(혜택 · 링크)이 아직 없으면 자리표시가 없어도 채우기 줄을 보인다 */
  factsUnset?: boolean;
  /** 이 여정 어느 칸에든 혜택 · 링크 자리가 남았는가(작업 화면이 전 칸을 보고 넘긴다) */
  benefitSlots?: boolean;
  urlSlots?: boolean;
  sampleCustomer?: Record<string, string | number | null> | null;
  sampleCustomerFields?: Record<string, any> | null;
  /** 회사 080 수신거부 번호 — 무료수신거부 문구에 붙는다. */
  opt080Number?: string;
  /** 저장된 여정이면 [받는 모습]을 서버 미리보기로(이 여정 대상 고객 1명 · 발송 치환 함수). */
  journeyId?: string;
  /** 휴대폰 머리 줄 보낸 사람(회신번호). */
  senderLabel?: string;
  /** 화면에 넣을 수 있는 변수(회사 보유 컬럼 · `%` 없는 이름). */
  variables?: string[];
  /** AI 꾸미기 컬럼 선택용(토큰 그대로). */
  decorateVars?: Array<{ token: string; label: string }>;
  triggerLabel?: string;
  aiBusy?: boolean;
  /** 서버 편집 정책(stepEditPolicy)이 막은 묶음 — 화면은 그 값대로 잠그기만 한다. */
  lockChannel?: boolean;
  lockTiming?: boolean;
  lockNote?: string;
  /** 판 머리 오른쪽(A/B · 칸 빼기) */
  headerActions?: ReactNode;
  /** 담당자 알림 줄의 고르기(작업 화면이 넘긴다 · 저장된 칸만) */
  notifyControl?: ReactNode;
}

/**
 * 광고성 발송 금지 시간대 = 서버 SEND_HOURS · 밀려난 발송이 **도착하는 시각** = 서버 NIGHT_ARRIVE_HOUR(utils/send-policy · GET /api/send-policy).
 *   ★ 2026-10-25 원장 #40 — 옛: 21 · 8 · 9 를 숫자로 박았다(서버 환경 변수를 바꾸면 화면만 거짓).
 */
const DELAY_PRESETS: Array<{ label: string; hours: number }> = [
  { label: '바로', hours: 0 },
  { label: '1시간 뒤', hours: 1 },
  { label: '3시간 뒤', hours: 3 },
  { label: '하루 뒤', hours: 24 },
  { label: '3일 뒤', hours: 72 },
  { label: '7일 뒤', hours: 168 },
];

/** 상한 = 백엔드 `MAX_STEP_DELAY_HOURS`(화면이 더 크게 받으면 저장에서 조용히 깎인다). */
const MAX_DELAY_HOURS = 8760;   // 365일

/** 「이름 | 고르기」 한 줄 — 좁은 폭에서는 이름이 위로 */
function Row({ name, children, id }: { name: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-4">
      <div className="pt-1 text-[13px] font-semibold text-slate-700">{name}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const chip = (on: boolean) =>
  `h-8 rounded-lg px-3 text-[12.5px] font-medium transition-colors ${on ? 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-300' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`;

export default function JourneyStepStudio({
  step, first, onPatch, onAi, onDecorate, onUndoAi, onFillBenefit, onFillUrl, factsUnset, benefitSlots = false, urlSlots = false,
  sampleCustomer = null, sampleCustomerFields = null, opt080Number = '', journeyId, senderLabel,
  variables = [], decorateVars = [], triggerLabel, aiBusy = false,
  lockChannel = false, lockTiming = false, lockNote, headerActions, notifyControl,
}: Props) {
  const sendPolicy = useSendPolicy();   // ★ 2026-10-25 원장 #40 야간 창 · 이월 시각 = 서버 값
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [showVars, setShowVars] = useState(false);
  // ★ 2026-08-08 — 마무리 입력값(치환 전까지만 유지).
  const [benefitInput, setBenefitInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  // ★ 2026-08-08 — AI 꾸미기에 넣을 컬럼. 고른 것만 넘긴다(날짜축 빌더·Operator와 같은 규약).
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  // ★ 2026-08-08 — 보내는 때 직접 입력. 저장된 값이 프리셋에 없으면(예: 5일) 자동으로 열린다.
  const [customDelayOpen, setCustomDelayOpen] = useState(false);
  const stepKey = step.stepOrder;
  useEffect(() => { setCustomDelayOpen(false); }, [stepKey]);   // 칸을 옮기면 그 칸 값 기준으로 다시 판단한다

  /**
   * ★ 2026-08-08 (Harold 지시) — **이미 문안에 쓰인 컬럼은 처음부터 선택돼 있다.**
   *   ⛔ 매 타이핑마다 다시 계산하지 않는다 — 그러면 사용자가 체크를 풀어도 즉시 되살아난다.
   *     칸을 열 때와 컬럼 목록이 도착할 때만 맞춘다(그 뒤로는 사용자 선택이 진실).
   */
  useEffect(() => {
    const valid = new Set(decorateVars.map((v) => v.token));
    const used = new Set<string>();
    const text = `${step.messageTemplate || ''}\n${step.subject || ''}`;
    for (const m of Array.from(text.matchAll(/%([^%\n]+)%/g))) {
      if (valid.has(m[1])) used.add(m[1]);
    }
    setSelectedVars(used);
  }, [stepKey, decorateVars]);   // eslint-disable-line react-hooks/exhaustive-deps

  const channel = (step.channel === 'sms' || step.channel === 'mms' ? step.channel : 'lms') as StudioChannel;
  const isAdStep = step.isAd !== false;

  /** 프리셋에 없는 값이면 직접 입력이 진실이다 — 저장된 여정을 열었을 때 5일(120시간)이 아무 데도 안 걸리면 안 된다. */
  const delayHoursNow = Math.max(0, Number(step.delayHours) || 0);
  const customDelay = customDelayOpen || !DELAY_PRESETS.some((p) => p.hours === delayHoursNow);
  /** ★ 2026-08-08 정정 — 직접 입력은 **며칠 뒤** 하나다(Harold 지시 · 시간 단위는 프리셋이 갖는다). */
  const delayDays = Math.floor(delayHoursNow / 24);
  const delayHasOddHours = delayHoursNow % 24 !== 0;

  const hourFixed = step.delayMode === 'specific_hour' || step.delayMode === 'relative_at_hour';
  const nightHit = hourFixed && step.targetHourKst != null && !!sendPolicy && !isSendableHour(sendPolicy, Number(step.targetHourKst));
  const factsRow = (benefitSlots && onFillBenefit) || (urlSlots && onFillUrl) || (factsUnset && (onFillBenefit || onFillUrl));

  const insertVar = (name: string) => {
    const token = `%${name}%`;
    const ta = taRef.current;
    const body = step.messageTemplate || '';
    if (!ta) {
      onPatch({ messageTemplate: body + token });
      return;
    }
    const s = ta.selectionStart ?? body.length;
    const e = ta.selectionEnd ?? body.length;
    onPatch({ messageTemplate: body.slice(0, s) + token + body.slice(e) });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = s + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const fillBenefit = () => { if (!benefitInput.trim() || !onFillBenefit) return; onFillBenefit(benefitInput); setBenefitInput(''); };
  const fillUrl = () => { if (!urlInput.trim() || !onFillUrl) return; onFillUrl(urlInput); setUrlInput(''); };
  const inputCls = 'h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none';
  const goCls = 'h-9 shrink-0 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40';

  return (
    <div className="bg-white">
      {/* 판 머리 — 몇 번째 칸 · 시작에서 얼마 뒤 · 오른쪽 = A/B · 칸 빼기 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 md:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">{step.stepOrder}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-slate-900">{step.stepOrder}번째 칸</div>
          <div className="truncate text-[12.5px] text-slate-500">
            {first ? (triggerLabel ? `${triggerLabel} 뒤` : '시작하면') : '앞 칸을 보내고'} {delayHoursNow === 0 ? '바로' : delayHoursNow % 24 === 0 ? `${delayHoursNow / 24}일 뒤` : `${delayHoursNow}시간 뒤`}
          </div>
        </div>
        {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      </div>
      {lockNote && (
        <div className="mx-4 mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600 md:mx-5">{lockNote}</div>
      )}

      <div className="grid grid-cols-1 gap-5 p-4 md:grid-cols-[280px_minmax(0,1fr)] md:p-5">
        {/* 왼쪽 — 큰 휴대폰(받은 문자 모양 그대로 쓴다) */}
        <div className="min-w-0">
          <PhoneComposer
            channel={channel}
            subject={step.subject || ''}
            body={step.messageTemplate || ''}
            isAd={isAdStep}
            opt080Number={opt080Number}
            onSubject={(v) => onPatch({ subject: v })}
            onBody={(v) => onPatch({ messageTemplate: v })}
            textareaRef={taRef}
            journeyId={journeyId}
            sampleCustomer={sampleCustomer}
            sampleCustomerFields={sampleCustomerFields}
            senderLabel={senderLabel}
            imageCount={channel === 'mms' ? (step.mmsImagePaths?.length ?? 0) : 0}
            placeholder="이 칸에서 보낼 문안이에요. 비워 두고 AI 문안 쓰기를 눌러도 돼요."
            resetKey={stepKey}
          />
        </div>

        {/* 가운데 — 설정 한 판(이름 | 고르기) */}
        <div className="min-w-0 divide-y divide-slate-100 self-start rounded-2xl border border-slate-200 bg-white">
          <Row name="채널">
            <fieldset disabled={lockChannel} className="flex flex-wrap gap-1.5 disabled:opacity-60">
              <legend className="sr-only">채널</legend>
              {(['sms', 'lms', 'mms'] as StudioChannel[]).map((c) => (
                <button key={c} type="button" onClick={() => onPatch({ channel: c })} aria-pressed={channel === c} className={chip(channel === c)}>
                  {stepChannelLabel(c)}
                </button>
              ))}
            </fieldset>
          </Row>

          {(onAi || onDecorate || onUndoAi) && (
            <Row name="AI">
              <div className="flex flex-wrap gap-2">
                {onAi && (
                  <button type="button" onClick={onAi} disabled={aiBusy}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                    {(step.messageTemplate || '').trim().length >= 5 ? 'AI 다듬기' : 'AI 문안 쓰기'}
                  </button>
                )}
                {onDecorate && (
                  <button type="button" onClick={() => onDecorate(Array.from(selectedVars))} disabled={aiBusy || selectedVars.size === 0}
                    title={selectedVars.size === 0 ? '넣을 데이터 줄에서 먼저 골라 주세요' : undefined}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50">
                    <Wand2 className="h-3.5 w-3.5" aria-hidden />AI 꾸미기{selectedVars.size > 0 ? ` (${selectedVars.size})` : ''}
                  </button>
                )}
                {onUndoAi && (
                  <button type="button" onClick={onUndoAi} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300">
                    <Undo2 className="h-3.5 w-3.5" aria-hidden />AI 전으로
                  </button>
                )}
              </div>
            </Row>
          )}

          {/* ★ 2026-08-08 — 혜택·링크는 값으로 받는다(입력 한 번이 전 칸을 채운다 · B1-2 원장 + 전 칸 한 트랜잭션). */}
          {factsRow && (
            <Row name="혜택 · 링크">
              <div className="space-y-2.5">
                {(benefitSlots || factsUnset) && onFillBenefit && (
                  <div>
                    <div className="flex gap-2">
                      <input value={benefitInput} onChange={(e) => setBenefitInput(e.target.value.slice(0, 200))} placeholder="예: 첫 구매 10% 할인쿠폰" aria-label="혜택"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fillBenefit(); } }} className={inputCls} />
                      <button type="button" disabled={!benefitInput.trim()} onClick={fillBenefit} className={goCls}>
                        <Gift className="mr-1 inline h-3.5 w-3.5" aria-hidden />혜택 넣기
                      </button>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-500">문안의 혜택 자리에 들어갈 실제 혜택이에요. 넣으면 모든 문자 칸에 한 번에 채워요.</p>
                  </div>
                )}
                {(urlSlots || factsUnset) && onFillUrl && (
                  <div>
                    <div className="flex gap-2">
                      <input value={urlInput} onChange={(e) => setUrlInput(e.target.value.slice(0, 300))} placeholder="https://" inputMode="url" aria-label="링크"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fillUrl(); } }} className={inputCls} />
                      <button type="button" disabled={!urlInput.trim()} onClick={fillUrl} className={goCls}>링크 넣기</button>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-500">주소는 보낼 때 짧은 링크로 바뀌어요.</p>
                  </div>
                )}
              </div>
            </Row>
          )}

          {/* 넣을 데이터 — 회사가 가진 컬럼만(우리가 지어내지 않는다) · 0이어도 줄을 숨기지 않는다(왜 없는지 보이게) */}
          <Row name="넣을 데이터">
            {decorateVars.length === 0 ? (
              <p className="pt-1 text-[12.5px] leading-relaxed text-amber-800">문안에 넣을 수 있는 고객 데이터 항목이 아직 없어요. 고객 정보를 올리면 여기에 나타나요.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {decorateVars.map((v) => {
                    const on = selectedVars.has(v.token);
                    return (
                      <button key={v.token} type="button" aria-pressed={on}
                        onClick={() => setSelectedVars((prev) => { const n = new Set(prev); if (n.has(v.token)) n.delete(v.token); else n.add(v.token); return n; })}
                        className={`h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors ${on ? 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-300' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`}>
                        %{v.label}%
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">고른 데이터를 AI 꾸미기가 문안에 자연스럽게 녹여요.</p>
                {variables.length > 0 && (
                  <div className="mt-2">
                    <button type="button" onClick={() => setShowVars((v) => !v)} className="text-[12.5px] font-medium text-slate-500 hover:text-slate-800">
                      {showVars ? '변수 직접 넣기 접기' : `변수 직접 넣기 (${variables.length})`}
                    </button>
                    {showVars && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {variables.map((v) => (
                          <button key={v} type="button" onClick={() => insertVar(v)} className="h-8 rounded-md bg-slate-100 px-2.5 text-[12.5px] text-indigo-800 hover:bg-indigo-50">%{v}%</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Row>

          <Row name="보내는 때">
            <fieldset disabled={lockTiming} className="disabled:opacity-60">
              <legend className="sr-only">보내는 때</legend>
              <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-slate-500">
                <Clock className="h-3.5 w-3.5 text-indigo-600" aria-hidden />{first ? '시작하면' : '앞 칸을 보낸 뒤'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DELAY_PRESETS.map((p) => (
                  <button key={p.hours} type="button" onClick={() => { setCustomDelayOpen(false); onPatch({ delayHours: p.hours }); }}
                    aria-pressed={!customDelay && delayHoursNow === p.hours} className={chip(!customDelay && delayHoursNow === p.hours)}>
                    {p.label}
                  </button>
                ))}
                {/* ★ 2026-08-08 (Harold 접수) — 프리셋만 두면 5일 뒤·2주 뒤를 만들 길이 없다. */}
                <button type="button" onClick={() => setCustomDelayOpen(true)} aria-pressed={customDelay} className={chip(customDelay)}>직접 입력</button>
              </div>
              {customDelay && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={Math.floor(MAX_DELAY_HOURS / 24)} value={delayDays} aria-label="며칠 뒤"
                      onChange={(e) => {
                        const days = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        onPatch({ delayHours: Math.min(MAX_DELAY_HOURS, days * 24) });
                      }}
                      className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 focus:border-indigo-300 focus:outline-none" />
                    <span className="text-[13px] text-slate-600">일 뒤</span>
                    <span className="text-[12px] text-slate-400">최대 365일</span>
                  </div>
                  {delayHasOddHours && (
                    // 지금 값이 시간 단위라 일수로 딱 떨어지지 않는다 — 조용히 바꾸지 않고 사실을 알린다.
                    <p className="mt-1.5 text-[12px] leading-relaxed text-amber-800">지금은 {delayHoursNow}시간 뒤로 정해져 있어요. 위 일수를 넣으면 그 값으로 바뀌어요.</p>
                  )}
                </div>
              )}
              <label className="mt-2.5 flex items-center gap-2 text-[12.5px] text-slate-600">
                <input type="checkbox" checked={hourFixed} className="h-4 w-4 rounded border-slate-300"
                  onChange={(e) => onPatch({ delayMode: e.target.checked ? 'relative_at_hour' : 'relative', targetHourKst: e.target.checked ? (step.targetHourKst ?? 10) : undefined })} />
                보내는 시각도 정하기
              </label>
              {hourFixed && (
                <select value={step.targetHourKst ?? 10} onChange={(e) => onPatch({ targetHourKst: Number(e.target.value) })} aria-label="보내는 시각"
                  className="mt-2 h-9 w-full max-w-[220px] rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 focus:border-indigo-300 focus:outline-none">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>)}
                </select>
              )}
            </fieldset>
            {/* 밤 안내 — 광고성은 야간(서버 발송 창 밖) 발송 금지 */}
            {isAdStep && sendPolicy && (
              <div className={`mt-2.5 flex gap-2 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${nightHit ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-slate-50 text-slate-500'}`}>
                <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${nightHit ? 'text-amber-700' : 'text-slate-400'}`} aria-hidden />
                {nightHit ? (
                  <span><strong className="font-semibold">{nightRangeText(sendPolicy)}에는 광고 문자를 보낼 수 없어요.</strong> 이 설정에 걸리는 문자는 <strong>{koHour(sendPolicy.nightArriveHour, 'ampm')}</strong>에 나가요.</span>
                ) : (
                  <span>광고 문자는 {nightRangeText(sendPolicy)}에 나가지 않아요. 그 시간에 걸리면 {koHour(sendPolicy.nightArriveHour, 'ampm')}에 나가요.</span>
                )}
              </div>
            )}
          </Row>

          {notifyControl && <Row name="담당자 알림">{notifyControl}</Row>}

          {/* 사진 — MMS 는 사진이 본체다. 채널만 바꿔 두고 넘어가지 못하게 이 자리에서 알린다. */}
          {channel === 'mms' && (
            <Row name="사진">
              <JourneyMmsUploader value={step.mmsImagePaths || []} onChange={(paths) => onPatch({ mmsImagePaths: paths })} />
              {(step.mmsImagePaths?.length ?? 0) === 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-amber-800">아직 사진이 없어요. 이대로 두면 글자만 나가니, 사진을 넣거나 LMS로 되돌려 주세요.</p>
              )}
            </Row>
          )}
        </div>
      </div>
    </div>
  );
}
