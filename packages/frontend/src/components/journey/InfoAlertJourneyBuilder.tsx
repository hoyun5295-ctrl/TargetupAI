/**
 * 정보 알림 여정 빌더 — 컴팩트 버튼+모달 (2026-06-30 여정 일반화 SP-A)
 *
 * 알림톡은 정보성(거래 통지)만 — 카카오 승인 템플릿이 본체.
 * AI Operator 디자인 표준(feedback_design_modal_first_simplicity): 컴팩트 메인 + 버튼→모달.
 *   - [알림톡 선택] 버튼 → 모달(승인 템플릿 선택). 선택 요약 표시.
 *   - 언제 보낼까(event/one_shot/standing) = 카드 (event면 거래 이벤트 / one_shot면 즉시·예약).
 *   - [대상] 버튼 → 조건 모달. event=이벤트 발생 고객+조건 / segment=조건으로 대상 지정.
 */

import { useState, useRef, useEffect } from 'react';
import { Bell, ShoppingBag, CalendarCheck, ShoppingCart, Truck, ArrowLeft, Zap, Clock, Users, MessageSquare, UserPlus, Moon, Cake, Coins } from 'lucide-react';
// ★ 2026-07-28 트리거 카탈로그 + 템플릿 호환 판정 — 백엔드 switch 8종과 1:1(단일 출처).
import { TRIGGER_EVENTS, resolveTriggerCompat, type TriggerDef } from '../../utils/journey-trigger-catalog';
import AlimtalkChannelPanel, {
  validateAlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
  type AlimtalkChannelState,
} from '../alimtalk/AlimtalkChannelPanel';
import { ModalShell, SummaryButton, AudienceModal, buildCustomerConditions, audienceSummary, type AudienceCondition } from './JourneyBuilderUi';
import { DateTimeField, isoToLocalInput, localInputToIso } from '../DateTimeField';

export type InfoAlertStartKind = 'event' | 'one_shot' | 'standing';

export interface InfoAlertBuildResult {
  templateCode: 'repeat' | 'reservation' | 'cart' | 'custom';
  startKind: InfoAlertStartKind;
  triggerEvent: string;
  triggerFilters: Record<string, any>;
  oneShotScheduledAt: string | null;
  name: string;
  step: {
    messageTemplate: string;
    alimtalkProfileId: string;
    alimtalkTemplateCode: string;
    alimtalkVariableMap: Record<string, string>;
    alimtalkNextType: 'N' | 'S' | 'L' | 'A' | 'B';
    alimtalkNextContents: string;
    alimtalkNextSubject?: string;
  };
}

// 아이콘·색은 화면 관심사라 여기 둔다. 트리거 정의(백엔드 계약)는 카탈로그가 단일 출처.
const TRIGGER_DECOR: Record<string, { icon: typeof ShoppingBag; gradient: string }> = {
  purchase: { icon: ShoppingBag, gradient: 'from-emerald-400 to-teal-500' },
  reservation: { icon: CalendarCheck, gradient: 'from-blue-400 to-indigo-500' },
  cart: { icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500' },
  shipped: { icon: Truck, gradient: 'from-violet-400 to-purple-500' },
  signup: { icon: UserPlus, gradient: 'from-teal-400 to-cyan-500' },
  dormant: { icon: Moon, gradient: 'from-slate-400 to-slate-600' },
  birthday: { icon: Cake, gradient: 'from-pink-400 to-rose-500' },
  points: { icon: Coins, gradient: 'from-yellow-400 to-amber-500' },
};

const START_KINDS: { key: InfoAlertStartKind; label: string; desc: string; icon: typeof Zap; gradient: string }[] = [
  { key: 'event', label: '어떤 일이 생기면', desc: '가입·주문·예약·생일 등 발생 시 자동', icon: Zap, gradient: 'from-emerald-400 to-teal-500' },
  { key: 'one_shot', label: '지금 또는 예약', desc: '대상군에게 1회 발송', icon: Clock, gradient: 'from-sky-400 to-blue-500' },
  { key: 'standing', label: '조건 충족 시 계속', desc: '조건 만족 고객 상시', icon: Users, gradient: 'from-fuchsia-400 to-purple-500' },
];

const EMPTY_STATE: AlimtalkChannelState = {
  profileId: '', templateCode: '', templateId: '', variableMap: {}, nextType: 'N', nextContents: '', nextSubject: '',
};

interface Props {
  senders: AlimtalkSenderProfile[];
  templates: AlimtalkTemplate[];
  customerFieldOptions: { key: string; label: string }[];
  hasMallIntegration?: boolean;
  embedded?: boolean;
  onBuild: (result: InfoAlertBuildResult) => void;
  onBack: () => void;
}

export default function InfoAlertJourneyBuilder({ senders, templates, customerFieldOptions, hasMallIntegration = false, embedded = false, onBuild, onBack }: Props) {
  const [alimtalk, setAlimtalk] = useState<AlimtalkChannelState>(EMPTY_STATE);
  const [startKind, setStartKind] = useState<InfoAlertStartKind>('event');
  const [txKey, setTxKey] = useState<string>('purchase');
  // ★ 2026-07-28 포인트 소멸 트리거는 백엔드 기본 points_min이 0이라 그대로 열면 사실상 전원이 대상이 된다.
  //   숫자를 지어내지 않고 사용자에게 받는다(미입력이면 이 트리거로는 만들 수 없다).
  const [pointsMin, setPointsMin] = useState<string>('');
  // ★ 2026-07-28 템플릿 본문을 읽고 트리거를 제안받는다. 제안일 뿐 저장이 아니다 — 아래 [다음]에서 사람이 확인한다.
  const [suggesting, setSuggesting] = useState(false);
  // 추천은 **어느 템플릿에 대한 것인지**를 함께 들고 다닌다. 템플릿을 바꾸면 옛 추천은 자동으로 무효가 된다.
  // (템플릿별 초기화를 안 하면 바꾼 뒤에도 이전 근거가 그대로 보인다 — Codex 1R 지적)
  const [suggestion, setSuggestion] = useState<{ forTemplate: string; key: string; reason: string; delayDays: number } | null>(null);
  const [suggestFailed, setSuggestFailed] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [conditions, setConditions] = useState<AudienceCondition[]>([]);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showAudience, setShowAudience] = useState(false);
  // ★ 2026-08-01 설계서 §2-3 — 회사가 준 데이터로 만들 수 있는 트리거만 연다.
  //   못 만드는 것은 숨기지 않고 사유와 함께 잠근다. 만들어지고 켜졌는데 0건으로 도는 상태가 제일 나쁘다.
  const [dataCap, setDataCap] = useState<Record<string, { available: boolean; reason: string }> | null>(null);
  const [dataCapFailed, setDataCapFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/ai/operator/journeys-data-capability', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        const data = await res.json();
        if (!alive) return;
        if (data?.success && data.triggers) setDataCap(data.triggers);
        else setDataCapFailed(true);
      } catch {
        if (alive) setDataCapFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const selectedTemplate = templates.find((t) => t.template_code === alimtalk.templateCode);

  // ★ 2026-07-28 템플릿이 쓰는 변수로 붙일 수 있는 트리거를 가른다.
  //   `#{주문번호}`가 든 템플릿을 가입 트리거에 붙이면 진입 properties가 없어 빈 값으로 나간다.
  //   AI 판단이 아니라 규칙으로 갈리는 문제라 순수 함수(카탈로그)가 판정한다.
  const compat = resolveTriggerCompat(selectedTemplate?.content || '', hasMallIntegration);
  const allowedTriggers = compat.allowed;
  // ★ 허용 목록으로 **폴백하지 않는다**. 첫 허용 트리거로 갈아끼우면 아래 mismatch가 영원히 false가 되고,
  //   사용자가 고르지도 않은 트리거로 여정이 저장된다. (Codex 1R 지적, 실결함)
  //   고른 값이 못 쓰게 됐으면 그대로 두고 막은 뒤, 사용자가 다시 고르게 한다.
  const tx: TriggerDef = TRIGGER_EVENTS.find((t) => t.key === txKey) || TRIGGER_EVENTS[0];
  const eventVars = startKind === 'event' ? tx.eventFields : [];
  const triggerMismatch = startKind === 'event'
    && !!selectedTemplate
    && !allowedTriggers.some((t) => t.key === tx.key);
  // ★ one_shot·standing은 트리거가 'custom'이라 진입 이벤트 properties가 없다.
  //   이벤트 변수를 쓰는 템플릿을 그 경로로 보내면 값이 빈 채로 나간다 — event와 같은 기준으로 막는다.
  const eventVarsInNonEventFlow = startKind !== 'event' && compat.eventVarsFound.length > 0;

  // AI 추천 응답이 도착했을 때 "그 사이 템플릿이 바뀌었는지"를 콜백 시점 값으로 판정하기 위한 ref.
  // ★ useEffect로 갱신하면 렌더 **이후**라 한 박자 늦고, 그 틈에 옛 응답이 통과한다(Codex 2R 지적).
  //   렌더 중에 바로 맞춰 그 창을 없앤다(최신값 미러라 멱등 — StrictMode 이중 렌더에도 안전).
  const selectedTemplateCodeRef = useRef(alimtalk.templateCode);
  // 요청 순번 — 연달아 누르면 마지막 요청만 반영한다(늦게 온 옛 응답이 이기지 못하게).
  const suggestReqRef = useRef(0);
  if (selectedTemplateCodeRef.current !== alimtalk.templateCode) {
    selectedTemplateCodeRef.current = alimtalk.templateCode;
    // ★ 템플릿이 바뀌면 **진행 중인 요청을 전부 무효화**한다.
    //   순번만으로는 A→B→A로 되돌아왔을 때 순번·템플릿이 다시 일치해 옛 A 응답이 통과한다(Codex 3R 지적).
    //   그때 사용자가 손으로 고른 트리거가 조용히 덮인다 — 바뀌는 순간 끊는 게 확실하다.
    suggestReqRef.current += 1;
  }
  const needsPointsMin = startKind === 'event' && tx.requiresConfig === 'points_min';
  const pointsMinValue = Number(pointsMin);
  const pointsMinOk = !needsPointsMin || (Number.isFinite(pointsMinValue) && pointsMinValue > 0);

  // ★ 2026-07-27: 전환재발송 검증 공용 CT — 여정 활성화(백엔드)에서 막히기 전에 여기서 먼저 알려준다.
  const fallbackViolation = validateAlimtalkChannelState(alimtalk);
  // ★ 고른 트리거를 이 회사 데이터로 만들 수 있는가(설계서 §2-3).
  //   조회 실패(dataCap=null)면 잠그지 않는다 — 화면 편의 게이트이고, 실제 발송 차단은 백엔드가 한다.
  //   대신 아래 배너로 "지금 확인할 수 없다"를 알린다(조용히 넘어가지 않는다).
  const selectedDataInfo = startKind === 'event' ? dataCap?.[tx.key] : undefined;
  const dataBlockedForSelected = selectedDataInfo && !selectedDataInfo.available ? selectedDataInfo.reason : null;

  const canBuild = Boolean(alimtalk.profileId && alimtalk.templateCode)
    && !fallbackViolation
    && !triggerMismatch
    && !eventVarsInNonEventFlow
    && !dataBlockedForSelected
    && pointsMinOk
    && (startKind !== 'one_shot' || scheduleMode === 'now' || !!scheduledAt);

  /**
   * ★ 2026-07-28 고른 템플릿 본문을 읽고 트리거를 제안받는다.
   *   후보는 변수 호환으로 이미 걸러진 목록만 보낸다 — AI가 무엇을 고르든 치환이 깨지지 않는다.
   *   서버가 후보 밖 값을 버리므로 여기서는 받은 key가 후보에 있을 때만 반영한다(이중 가드).
   */
  const handleSuggestTrigger = async () => {
    if (!selectedTemplate?.content || allowedTriggers.length === 0) return;
    const askedFor = selectedTemplate.template_code;   // 응답 도착 시 같은 템플릿인지 대조할 기준
    const myReq = ++suggestReqRef.current;             // 이 요청의 순번
    setSuggesting(true);
    setSuggestFailed(null);
    setSuggestion(null);
    try {
      const res = await fetch('/api/ai/operator/journeys-suggest-trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify({
          templateName: selectedTemplate.template_name || selectedTemplate.template_code,
          templateContent: selectedTemplate.content,
          candidates: allowedTriggers.map((t) => ({ key: t.key, label: t.label, desc: t.desc })),
        }),
      });
      const data = await res.json();
      // ★ 응답이 오는 동안 사용자가 템플릿을 바꿨으면 그 추천은 다른 템플릿의 것이다 — 버린다.
      //   (재검증 없이 반영하면 옛 템플릿 기준 트리거가 새 템플릿에 붙는다 — Codex 1R 지적)
      if (myReq !== suggestReqRef.current) return;                    // 더 최신 요청이 있으면 이 응답은 버린다
      if (selectedTemplateCodeRef.current !== askedFor) return;       // 그 사이 템플릿이 바뀌었으면 버린다
      const s = data?.suggestion;
      if (data?.success && s?.key && allowedTriggers.some((t) => t.key === s.key)) {
        setTxKey(s.key);
        setStartKind('event');
        setSuggestion({
          forTemplate: askedFor,
          key: s.key,
          reason: String(s.reason || ''),
          delayDays: Math.max(0, Math.min(30, Math.floor(Number(s.delayDays) || 0))),
        });
      } else {
        // 판단이 안 서면 억지로 고르지 않는다 — 사용자가 직접 고르면 된다.
        setSuggestFailed(askedFor);
      }
    } catch {
      setSuggestFailed(askedFor);
    } finally {
      setSuggesting(false);
    }
  };


  const handleBuild = () => {
    if (!canBuild) return;
    const conds = buildCustomerConditions(conditions);
    const triggerFilters: Record<string, any> = startKind === 'event' ? { ...tx.filters } : {};
    if (needsPointsMin) triggerFilters.points_min = pointsMinValue;
    if (conds) Object.assign(triggerFilters, conds);
    const name = startKind === 'event' ? `${tx.label} 알림` : startKind === 'one_shot' ? '알림톡 1회 발송' : '알림톡 상시 발송';
    onBuild({
      templateCode: startKind === 'event' ? tx.templateCode : 'custom',
      startKind,
      triggerEvent: startKind === 'event' ? tx.triggerEvent : 'custom',
      triggerFilters,
      oneShotScheduledAt: startKind === 'one_shot' && scheduleMode === 'scheduled' && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      name,
      step: {
        messageTemplate: selectedTemplate?.content || '',
        alimtalkProfileId: alimtalk.profileId,
        alimtalkTemplateCode: alimtalk.templateCode,
        alimtalkVariableMap: alimtalk.variableMap,
        alimtalkNextType: alimtalk.nextType,
        alimtalkNextContents: alimtalk.nextContents,
        alimtalkNextSubject: alimtalk.nextSubject,
      },
    });
  };

  const noTemplates = senders.length === 0 || templates.length === 0;
  const templateSummary = noTemplates
    ? '승인된 발신프로필·템플릿이 없습니다'
    : selectedTemplate
      ? (selectedTemplate.template_name || selectedTemplate.template_code)
      : '알림톡 템플릿을 선택하세요';

  return (
    <div className="space-y-3 text-white">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10" aria-label="뒤로"><ArrowLeft className="w-4 h-4 text-white/70" /></button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center"><Bell className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="text-base md:text-lg font-semibold">정보 알림 만들기</h2>
            <p className="text-xs text-white/50">카카오 승인 템플릿으로 알림톡 발송 (광고 아님)</p>
          </div>
        </div>
      )}

      {/* 어떤 알림톡 — 요약 버튼 → 모달 */}
      <SummaryButton icon={<MessageSquare className="w-4 h-4 text-white" />} label="어떤 알림톡" value={templateSummary} accent="teal" onClick={() => setShowTemplate(true)} />

      {/* ★ 2026-07-28 템플릿을 고르면 본문을 읽고 트리거를 제안한다 — 사용자가 8개를 훑지 않아도 되게. */}
      {selectedTemplate && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSuggestTrigger}
            disabled={suggesting || allowedTriggers.length === 0}
            className="px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-100 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {suggesting ? '템플릿 읽는 중…' : '이 템플릿, 언제 보낼까요? — AI 추천'}
          </button>
          {/* 추천·실패 표시는 **지금 고른 템플릿에 대한 것일 때만** 보여준다(템플릿 바꾸면 자동 소멸). */}
          {suggestion && suggestion.forTemplate === alimtalk.templateCode && (
            <span className="text-[11px] text-violet-200/90">
              {TRIGGER_EVENTS.find((t) => t.key === suggestion.key)?.label || suggestion.key} 추천
              {` · ${suggestion.delayDays === 0 ? '발생 즉시' : `${suggestion.delayDays}일 뒤`}`}
              {suggestion.reason ? ` — ${suggestion.reason}` : ''}
            </span>
          )}
          {suggestFailed === alimtalk.templateCode && (
            <span className="text-[11px] text-white/50">추천하지 못했어요. 아래에서 직접 골라주세요.</span>
          )}
        </div>
      )}

      {/* 언제 보낼까 — 시작 방식 카드 */}
      <div>
        <div className="text-xs font-semibold text-white/70 mb-1.5">언제 보낼까요</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {START_KINDS.map((sk) => {
            const Icon = sk.icon;
            const active = sk.key === startKind;
            return (
              <button key={sk.key} onClick={() => setStartKind(sk.key)} className={`p-3 rounded-xl border text-left transition-colors ${active ? 'bg-teal-500/20 border-teal-400/60' : 'bg-white/[0.07] border-white/15 hover:bg-white/[0.12]'}`}>
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${sk.gradient} flex items-center justify-center mb-2`}><Icon className="w-4 h-4 text-white" /></div>
                <div className="text-sm font-semibold text-white">{sk.label}</div>
                <div className="text-[11px] text-white/60 mt-0.5">{sk.desc}</div>
              </button>
            );
          })}
        </div>

        {startKind === 'event' && (() => {
          // ★ 2026-07-28 거래 4종 + 고객 상태 4종. 백엔드 switch가 이미 8종을 처리하므로 전부 연다.
          //   템플릿이 이벤트 변수를 쓰면 그 값을 못 주는 트리거는 사유와 함께 잠근다.
          const blockedMap = new Map(compat.blocked.map((b) => [b.trigger.key, b.reason]));
          const groups: { group: 'tx' | 'lifecycle'; title: string }[] = [
            { group: 'tx', title: '거래가 일어났을 때 — 주문번호·상품명 같은 거래 정보를 쓸 수 있어요' },
            { group: 'lifecycle', title: '고객 상태가 바뀌었을 때 — 이름·등급 같은 고객 정보만 쓸 수 있어요' },
          ];
          return (
            <div className="mt-2 space-y-2.5">
              {compat.eventVarsFound.length > 0 && (
                <p className="text-[11px] text-teal-200/80">
                  이 템플릿은 <strong>{compat.eventVarsFound.join('·')}</strong>를 쓰기 때문에, 그 값을 주는 트리거만 고를 수 있어요.
                </p>
              )}
              {/* ★ 2026-08-01 §2-3 — 회사 데이터로 못 만드는 트리거는 잠긴다. 왜 잠겼는지와 무엇을 연동하면 되는지를 보여준다. */}
              {dataBlockedForSelected && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-400/30">
                  <p className="text-[11px] text-rose-100/90">{dataBlockedForSelected}</p>
                  <p className="text-[10px] text-white/45 mt-1">지금 만들면 대상이 한 명도 잡히지 않아 다른 트리거를 골라 주세요.</p>
                </div>
              )}
              {dataCapFailed && (
                <p className="text-[11px] text-amber-200/70">
                  어떤 여정을 만들 수 있는지 지금 확인하지 못했어요. 만들기 전에 대상 인원을 꼭 확인해 주세요.
                </p>
              )}
              {groups.map(({ group, title }) => {
                const items = TRIGGER_EVENTS.filter((t) => t.group === group);
                return (
                  <div key={group}>
                    <p className="text-[11px] text-white/50 mb-1.5">{title}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {items.map((t) => {
                        const decor = TRIGGER_DECOR[t.key] || { icon: Zap, gradient: 'from-slate-400 to-slate-600' };
                        const Icon = decor.icon;
                        const active = t.key === tx.key;
                        const gatedOff = t.gated && !hasMallIntegration;
                        const blockedReason = blockedMap.get(t.key);
                        // ★ 세 번째 잠금 축 — 이 회사 데이터로 이 트리거를 판정할 수 있는가.
                        const dataInfo = dataCap?.[t.key];
                        const dataBlocked = dataInfo && !dataInfo.available ? dataInfo.reason : null;
                        const locked = gatedOff || !!blockedReason || !!dataBlocked;
                        return (
                          <button key={t.key} onClick={() => { if (!locked) setTxKey(t.key); }} disabled={locked}
                            title={dataBlocked || blockedReason || undefined}
                            className={`p-2.5 rounded-lg border text-left transition-colors ${active ? 'bg-teal-500/20 border-teal-400/60' : 'bg-white/[0.06] border-white/15 hover:bg-white/[0.1]'} ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}>
                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${decor.gradient} flex items-center justify-center mb-1.5`}><Icon className="w-3.5 h-3.5 text-white" /></div>
                            <div className="text-xs font-semibold text-white">{t.label}</div>
                            <div className="text-[10px] text-white/55 mt-0.5">
                              {dataBlocked || blockedReason || (gatedOff ? '자사몰 연동 시' : t.desc)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {needsPointsMin && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-400/30">
                  <label className="block text-[11px] text-amber-100/90 mb-1">
                    보유 포인트 최소 (이 값 이상인 고객만) — 입력해야 만들 수 있어요
                  </label>
                  <input
                    type="number" min={1} value={pointsMin} onChange={(e) => setPointsMin(e.target.value)}
                    placeholder="예: 1000"
                    className="w-40 px-2 py-1.5 rounded-lg bg-slate-800 border border-white/15 text-sm text-white"
                  />
                  <p className="text-[10px] text-white/45 mt-1">비워두면 포인트가 0인 고객까지 전부 대상이 되어 막아두었습니다.</p>
                </div>
              )}
            </div>
          );
        })()}

        {startKind === 'one_shot' && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              {(['now', 'scheduled'] as const).map((m) => (
                <button key={m} onClick={() => setScheduleMode(m)} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${scheduleMode === m ? 'bg-sky-500/20 border-sky-400/60 text-white' : 'bg-white/[0.06] border-white/15 text-white/70 hover:bg-white/[0.1]'}`}>
                  {m === 'now' ? '지금 발송' : '예약 발송'}
                </button>
              ))}
            </div>
            {scheduleMode === 'scheduled' && (
              <DateTimeField
                value={localInputToIso(scheduledAt)}
                onChange={(iso) => setScheduledAt(isoToLocalInput(iso))}
                tone="dark"
              />
            )}
            <p className="text-[10px] text-white/40 italic">발송 가능 시간(08~21시 KST) 밖이면 다음 가능 시각으로 자동 조정됩니다.</p>
          </div>
        )}

        {(startKind !== 'event' || tx.eventFields.length === 0) && (
          <p className="text-[11px] text-amber-200/70 mt-2">이벤트 데이터가 없어 템플릿 변수는 고객 필드(이름·등급 등)만 매핑됩니다.</p>
        )}
        {triggerMismatch && (
          <p className="text-[11px] text-rose-300 mt-2">
            이 템플릿에 맞는 트리거를 다시 골라주세요 — 지금 선택({tx.label})은 템플릿이 쓰는 값을 채워줄 수 없습니다.
          </p>
        )}
        {eventVarsInNonEventFlow && (
          <p className="text-[11px] text-rose-300 mt-2">
            이 템플릿은 {compat.eventVarsFound.join('·')}를 쓰기 때문에 이 방식으로는 보낼 수 없어요.
            값을 채우려면 “어떤 일이 생기면”을 골라 해당 거래 트리거를 지정해주세요.
          </p>
        )}
      </div>

      {/* 대상 — 요약 버튼 → 모달 */}
      <SummaryButton icon={<Users className="w-4 h-4 text-white" />} label={startKind === 'event' ? '대상 (이벤트 발생 고객 + 조건)' : '대상'} value={audienceSummary(conditions)} accent="teal" onClick={() => setShowAudience(true)} />

      <div className="flex justify-end items-center gap-3 pt-1">
        {alimtalk.templateCode && fallbackViolation && (
          <span className="text-[11px] text-rose-300">{fallbackViolation}</span>
        )}
        <button onClick={handleBuild} disabled={!canBuild} className="px-5 py-3 bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">다음 — 흐름 검토</button>
      </div>

      {showTemplate && (
        <ModalShell title="어떤 알림톡을 보낼까요" subtitle="카카오 승인 템플릿 선택 (광고 아님)" icon={<MessageSquare className="w-4 h-4 text-white" />} onClose={() => setShowTemplate(false)}
          footer={<button onClick={() => setShowTemplate(false)} className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 text-sm font-medium hover:opacity-90">완료</button>}>
          {senders.length === 0 ? (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-200">승인된 발신프로필이 없습니다. 알림톡 발송 메뉴에서 발신프로필을 먼저 등록해주세요.</div>
          ) : templates.length === 0 ? (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-200">승인된 알림톡 템플릿이 없습니다. 알림톡 발송 메뉴에서 템플릿 등록 + 검수 통과 후 사용해주세요.</div>
          ) : (
            <AlimtalkChannelPanel
              senders={senders}
              templates={templates}
              customerFieldOptions={[...customerFieldOptions, ...eventVars]}
              value={alimtalk}
              onChange={setAlimtalk}
            />
          )}
        </ModalShell>
      )}
      {showAudience && (
        <AudienceModal initial={conditions} onSave={(c) => { setConditions(c); setShowAudience(false); }} onClose={() => setShowAudience(false)} />
      )}
    </div>
  );
}
