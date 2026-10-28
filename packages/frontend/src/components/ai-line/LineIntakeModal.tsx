/**
 * LineIntakeModal.tsx — AI 한줄로 확인 창(★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §5-3 · §8)
 *
 * 창은 한 줄을 읽고 모자란 것만 묻는다: (카톡 모호) 채널 → (빠졌으면) 혜택 · 기간 → (받는 사람을 못 읽었으면) 누구에게 → 확인 판.
 *   ★ 2026-10-19 Harold 「한 줄을 읽고 질문 먼저 · 정보를 다 모은 뒤 생성」 · 「중간에 타겟 확인할 때 직접 타겟 선택」.
 *   누구에게 = 전체 고객 · AI 추천 대상 · 직접 타겟 선택(조건 고르기 창) · 한 줄로 더 적기. 확인 판에서도 「직접 타겟 선택」으로 바꿀 수 있다.
 *   - 확인 판 왼쪽 = 한 줄에서 읽은 대상(누르면 빼기) · AI 가 보탬(기본 켬 · 빼면 n명) · 받는 사람 수(발송 명단과 같은 계산) · 혜택 · 기간 · 채널 · 종류 타일
 *   - 오른쪽 = 이 대상 1위 고객 칼럼(기본 0개 · 채움 % · 30% 미만 잠금) · 금액 줄(잔액 전 → 후)
 *   - 알림톡 갈래 = 종류 칸 대신 승인 템플릿 · 칼럼 칸 대신 #{변수} 맞춤(대시보드 알림톡 발송 창으로 넘긴다)
 * ★ 2026-10-20 Harold 「동적으로 한 줄을 보고 부족한 것을 물어라」 · 「문안 생성 전에 개인화할 칼럼을 묻는 단계」 · 「문자 성격별 브랜드 보이스」(설계서 §17)
 *   단계 = 채널(카톡 모호) → 빠진 정보(서버 asks = AI 가 한 줄을 읽고 판단 + 규칙 안전망 · 비면 건너뜀) → 누구에게 → 확인 판(대상 · 종류 · 성격 · 금액)
 *   → 개인화 칼럼(만들기 직전 · 1위 고객 실제 값 · 회사 칼럼 · 추천 미리 체크 · 만들기 버튼은 여기 한 곳).
 * 금액 · 대상 수 · 판정은 서버 값만 그린다. 닫기 = 숨김(진행 상태는 호출부 run 이 sessionStorage 에 보관).
 * ⛔ 바깥 눌러 닫힘 없음 · 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Check, Lock, Loader2, Sparkles, Users, AlertTriangle, MessageSquare, CalendarDays, Gift, Send, Filter, Undo2, HelpCircle, ChevronLeft } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import DirectTargetFilterModal from '../DirectTargetFilterModal';
import { toLineAudienceFilters } from '../../utils/customerFilterBuild';
import { creditCost } from '../../constants/credit';
import {
  type AiLineRun, type AiLineType, type AiLineCopyType, type AiLineChannel,
  AI_LINE_TYPE_META, AI_LINE_TYPE_ORDER, aiLineApi, activeFilters, filtersEmpty, allCustomersFlag, audienceOf, isAdOf, asksOf,
} from '../../utils/ai-line';

const MAX_AUDIENCE = 10000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodChips(): Array<{ label: string; value: string }> {
  const now = new Date();
  const sunday = new Date(now); sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const week = new Date(now); week.setDate(now.getDate() + 6);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const out = [{ label: '이번 주 일요일까지', value: ymd(sunday) }, { label: '일주일 동안', value: ymd(week) }, { label: '이달 말까지', value: ymd(monthEnd) }];
  return out.filter((c, i) => out.findIndex((x) => x.value === c.value) === i);
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function periodLabel(v: string): string {
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return v;
  return `${m}월 ${d}일(${WEEK[new Date(y, m - 1, d).getDay()]})까지`;
}

type Step = 'kakao' | 'asks' | 'board' | 'vars';
/** 칼럼 단계에서 미리 체크하는 추천 칼럼 수 */
const PRECHECK_MAX = 2;

export interface LineIntakeModalProps {
  open: boolean;
  run: AiLineRun;
  /** 확인 판 잔액(띠가 읽은 값 · 모르면 null) */
  creditTotal: number | null;
  /** 대상 찾기 실패 문장(크레딧 부족 · 일시 오류) — 있으면 기다림 대신 이 문장 */
  loadError?: string | null;
  /** 확인 창이 바꾼 진행 상태(호출부가 보관) — 함수면 최신 진행에 합친다(늦게 온 응답이 그 사이 바뀐 칸을 덮지 않게) */
  onRun: (next: AiLineRun | ((cur: AiLineRun) => AiLineRun)) => void;
  onClose: () => void;
  /** 만들기 끝 = 결과 카드(창을 닫고 페이지에) */
  onComposed: (next: AiLineRun) => void;
  /** 직접입력만 = 대상 확정 · 빈 직접입력 카드 */
  onProceedDirect: (next: AiLineRun) => void;
  /** 알림톡 갈래 = 대시보드 알림톡 발송 창으로 */
  onProceedAlimtalk: (next: AiLineRun, templateId: string | null) => void;
  /** 크레딧 차감 뒤(띠 다시 읽기) */
  onCharged: () => void;
  /** ★ 2026-10-19 「누구에게」를 한 줄로 더 적었다 = 그 한 줄로 처음부터 다시 읽는다 */
  onRetypeLine: (line: string) => void;
}

export default function LineIntakeModal({ open, run, creditTotal, loadError, onRun, onClose, onComposed, onProceedDirect, onProceedAlimtalk, onCharged, onRetypeLine }: LineIntakeModalProps) {
  const read = run.read;
  const needKakao = run.branch === 'ask_kakao';
  // ★ 2026-10-20 묻는 목록 = 서버 asks 한 자리(대상 찾기 응답 · AI 가 한 줄을 읽고 판단 + 규칙 안전망)
  const asks = asksOf(run);
  const askBenefit = asks.find((a) => a.kind === 'benefit') || null;
  const askPeriod = asks.find((a) => a.kind === 'period') || null;
  const askTexts = asks.filter((a) => a.kind === 'text');
  const [step, setStep] = useState<Step>('board');
  useEffect(() => {
    if (!open) return;
    // 창을 열 때 한 번만 단계를 정한다(답을 고르는 동안 단계가 바뀌지 않게) · 빠진 정보는 대상 찾기가 끝나야 알 수 있어 그 단계에서 기다린다
    setStep(needKakao ? 'kakao' : run.branch === 'sms' && run.facts === null ? 'asks' : 'board');
    // 갈래 판정(read · AI 0)이 대상 찾기보다 먼저 오므로 그때 한 번 더 정한다(빠진 정보 단계는 대상 찾기를 기다리는 중이라 답을 덮지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run.runId, !!read]);
  // 대상 찾기가 끝났는데 물을 것이 없으면(다 갖춘 한 줄 · 알림톡) 바로 다음
  useEffect(() => {
    if (step === 'asks' && run.intake && (asks.length === 0 || run.branch !== 'sms')) setStep('board');
  }, [step, run.intake, asks.length, run.branch]);

  // ── 1장: 빠진 정보 ──
  const [benefitDraft, setBenefitDraft] = useState('');
  const [benefitNone, setBenefitNone] = useState(false);
  const [periodPick, setPeriodPick] = useState<string | null>(null);
  const [periodNone, setPeriodNone] = useState(false);
  /** 그 밖 질문 답(질문 id → 글) · 비우면 빼고 쓴다 */
  const [textAns, setTextAns] = useState<Record<string, string>>({});
  const chips = useMemo(periodChips, []);
  const asksOk = (!askBenefit || benefitNone || benefitDraft.trim().length > 0)
    && (!askPeriod || periodNone || !!periodPick);
  const submitAsks = () => {
    const answers = askTexts
      .map((a) => ({ q: a.text, a: (textAns[a.id] || '').trim().slice(0, 200) }))
      .filter((x) => x.a.length > 0);
    onRun({
      ...run,
      facts: {
        benefit: askBenefit && !benefitNone ? benefitDraft.trim().slice(0, 300) : null,
        period_end: askPeriod && !periodNone ? periodPick : null,
        ...(answers.length > 0 ? { answers } : {}),
      },
    });
    setStep('board');
  };

  // ── 확인 판: 조건 켜기/끄기 → 다시 세기(0크레딧) ──
  const intake = run.intake;
  const [boardError, setBoardError] = useState<string | null>(null);
  // ★ Codex B2 — 대상 선택 버전 하나(recountSeq) · 진행 상태 하나(retargeting). 대상을 바꾸는 모든 동작이 버전을 올리고,
  //   응답은 자기 버전이 최신일 때만 · 최신 진행에 대상 칸만 합친다. 대체된 요청의 진행 표시는 새 요청이 이어받는다(멈춤 없음).
  // ★ 2026-10-21 「지금 대상」 주인 하나 — 칩 끄기/켜기 · 전체 고객 체크도 이 한 길(수 · 칩 · 1위 고객 · 칼럼을 한 응답으로).
  //   수만 세던 길(recount)이 1위 고객 · 칼럼을 앞 대상 것으로 남겨, 처음 0명이던 대상에서 칩을 끄면 칼럼 단계가 비었다(Harold 1021 실측).
  const recountSeq = useRef(0);
  const [retargeting, setRetargeting] = useState(false);
  const bump = () => { recountSeq.current += 1; setRetargeting(false); };
  // ★ 2026-10-19 대상 바꾸기 = 서버가 다시 센다(칩 · 1위 고객 · 칼럼까지 · 0크레딧)
  const [pickerOpen, setPickerOpen] = useState(false);
  const retarget = async (next: AiLineRun) => {
    const seq = ++recountSeq.current;
    setRetargeting(true);
    setBoardError(null);
    // ★ Codex B1 high — 새 대상은 서버가 다시 센 뒤에만 확정한다(실패 = 아무것도 바꾸지 않는다)
    try {
      const r = await aiLineApi.retarget(activeFilters(next), allCustomersFlag(next));
      if (seq !== recountSeq.current) return;
      // 고른 칼럼 = 새 대상에서도 쓸 수 있는 것만(새 대상에서 빈칸이 많으면 잠금 · 고른 목록에서 뺀다)
      const audience = { ...r, count: r.empty && !allCustomersFlag(next) ? 0 : r.count };
      onRun((cur) => ({
        ...cur,
        manual: next.manual, allChecked: next.allChecked, offKeys: next.offKeys,
        liveCount: null, audienceSet: true, audience,
      }));
    } catch (e) {
      if (seq === recountSeq.current) setBoardError(e instanceof Error ? e.message : '받는 사람을 다시 세지 못했어요.');
    } finally {
      if (seq === recountSeq.current) setRetargeting(false);
    }
  };
  const pickDirect = (dynamicFilters: Record<string, any>, enabledFields: any[]) => {
    setPickerOpen(false);
    const { filters, unsupported } = toLineAudienceFilters(dynamicFilters, enabledFields);
    if (unsupported.length > 0) {
      const names = unsupported.map((k) => enabledFields.find((f) => f.field_key === k)?.display_name || k).join(' · ');
      setBoardError(`「${names}」 조건은 이 방식으로 고를 수 없어요. 한 가지 값으로 고르거나 그 조건을 빼 주세요.`);
      return;
    }
    void retarget({ ...run, manual: { filters }, allChecked: false });
  };
  const chooseAllCustomers = () => {
    void retarget({ ...run, manual: null, offKeys: Object.keys(intake?.filters || {}), allChecked: true });
  };
  const backToLine = () => {
    // ★ Codex B1 high — 한 줄 대상으로 돌아가면 「누구에게」도 다시(물었던 대상 찾기면 다시 묻는다)
    bump();
    onRun((cur) => ({ ...cur, manual: null, audience: null, liveCount: null, allChecked: false, offKeys: [], audienceSet: false }));
    setBoardError(null);
  };
  /** 「누구에게」 = AI 추천 대상(한 줄 대상 찾기 결과 그대로 · 사람이 고름) */
  const chooseAiSuggest = () => {
    bump();
    onRun((cur) => ({ ...cur, manual: null, audience: null, liveCount: null, allChecked: false, offKeys: [], audienceSet: true }));
    setBoardError(null);
  };
  const [whoDraft, setWhoDraft] = useState('');
  // 한 줄이 바뀌면(새 진행) 앞 진행의 템플릿 · 적던 글을 비운다
  // ★ Codex 1020 R1 — 빠진 정보 칸도 진행에 묶는다(질문 id 가 매 진행 q1 부터라 앞 한 줄의 답이 새 질문의 답으로 남았다 · 혜택 · 기간 칸도 같은 뿌리)
  useEffect(() => {
    setTemplates(null); setTplPick(null); setTplError(false); setWhoDraft(''); setBoardError(null);
    setBenefitDraft(''); setBenefitNone(false); setPeriodPick(null); setPeriodNone(false); setTextAns({});
  }, [run.runId]);
  // ★ Codex B2 medium — 창을 다시 열면 템플릿 오류를 지우고 다시 불러온다(안내 문장 「닫았다가 다시 열어 주세요」와 맞춘다)
  useEffect(() => { if (open) setTplError(false); }, [open]);

  /**
   * ★ Codex 1021 R1 · R2 — 「지금 대상」 불변식: 칩이 대상 찾기와 다르게 꺼져 있거나 전체 고객이 체크됐는데 다시 받은 상세가 없다
   *   = 받는 사람 수 · 1위 고객 · 칼럼이 서로 다른 대상 값이다(1021 앞에 저장된 · 수만 세던 길의 진행).
   *   이 상태면 창을 열 때 한 번 다시 받고(R1), 받기 전 · 실패 뒤에도 다음 단계 · 만들기 · 진행을 잠근다(R2 · 「다시 세기」로만 풀림 ·
   *   한 줄 대상으로 돌아가면 칩이 처음으로 돌아가 풀린다).
   */
  const detailStale = !!run.intake && !run.manual && !run.audience && (run.offKeys.length > 0 || run.allChecked);
  useEffect(() => {
    if (!open || !detailStale || retargeting) return;
    void retarget({ ...run });
    // 실패해도 detailStale 이 그대로라 다시 부르지 않는다(반복 호출 0 · 잠금은 유지 · 「다시 세기」로 재시도)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run.runId, detailStale]);

  const toggleCond = (key: string) => {
    if (retargeting) return;   // 앞 요청이 확정되기 전 칩을 또 누르면 앞 변경이 사라진다
    const off = run.offKeys.includes(key) ? run.offKeys.filter((k) => k !== key) : [...run.offKeys, key];
    void retarget({ ...run, offKeys: off, allChecked: false });
  };
  const toggleAll = () => {
    if (retargeting) return;
    void retarget({ ...run, allChecked: !run.allChecked });
  };
  // AI 가 보탠 조건 = 빼면 몇 명인지 미리 센다(0크레딧 · 최대 3개)
  const [withoutCounts, setWithoutCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open || !intake) return;
    const aiKeys = intake.conditions.filter((c) => c.origin === 'ai').map((c) => c.key).slice(0, 3);
    let alive = true;
    void (async () => {
      const out: Record<string, number> = {};
      for (const k of aiKeys) {
        const f = Object.fromEntries(Object.entries(intake.filters).filter(([key]) => key !== k));
        if (Object.keys(f).length === 0) continue;
        try { out[k] = (await aiLineApi.recount(f, false)).count; } catch { /* 모르면 칸을 비운다 */ }
      }
      if (alive) setWithoutCounts(out);
    })();
    return () => { alive = false; };
  }, [open, intake]);

  const aud = audienceOf(run);
  const count = run.liveCount ?? aud.count;
  // ★ Codex B3 — 문안에 넣을 칼럼 = 지금 대상에서 보이고 잠기지 않은 것만(대상을 바꿔도 · 돌아가도 이 한 자리가 거른다)
  const usableVars = run.vars.filter((t) => aud.columns.some((c) => c.token === t && !c.locked));
  const emptyNow = intake ? filtersEmpty(run) : false;
  const lineUntranslated = run.manual ? [] : (intake?.untranslated || []).filter((u) => u.origin === 'line');
  const pickUntranslated = run.manual ? (run.audience?.untranslated || []) : [];
  /** 한 줄에서 받는 사람을 못 읽었고 아직 답하지 않았다 = 확인 판 대신 「누구에게」 */
  const asking = step === 'board' && !!intake && intake.needAudience && !run.audienceSet;
  const aiSuggest = intake ? intake.conditions.filter((c) => c.origin === 'ai') : [];

  // ── 종류 · 칼럼 ──
  const toggleType = (t: AiLineType) => {
    const types = run.types.includes(t) ? run.types.filter((x) => x !== t) : [...run.types, t];
    onRun({ ...run, types });
  };
  const toggleVar = (token: string) => {
    const vars = run.vars.includes(token) ? run.vars.filter((x) => x !== token) : [...run.vars, token];
    onRun({ ...run, vars });
  };
  const setChannel = (c: AiLineChannel) => onRun({ ...run, channel: c });

  const copyTypes = run.types.filter((t): t is AiLineCopyType => t !== 'direct');
  const unit = creditCost('ai-line-compose');
  const baseCost = intake?.base.paid ? 0 : creditCost('ai-line-intake');
  const total = baseCost + copyTypes.length * unit;
  const directOnly = run.types.length === 1 && run.types[0] === 'direct';

  // ── 알림톡 갈래 ──
  const alimtalk = run.branch === 'alimtalk';
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof aiLineApi.alimtalkMatch>> | null>(null);
  const [tplPick, setTplPick] = useState<string | null>(null);
  const [tplError, setTplError] = useState(false);
  useEffect(() => {
    if (!open || !alimtalk || !intake || asking || count === 0 || templates || tplError || retargeting) return;
    let alive = true;
    void aiLineApi.alimtalkMatch(run.line, activeFilters(run), allCustomersFlag(run)).then((t) => {
      // ★ Codex B2 · B3 medium — 낸 상태(paid)는 진행에 저장 · 이번에 걷었으면 잔액 다시 읽기. 창을 닫아도 버리지 않는다
      //   (진행 저장은 호출부가 runId 로 보호 · 템플릿 화면 반영만 아래 alive 조건)
      if (t.paid) onRun((cur) => (cur.intake && !cur.intake.base.paid ? { ...cur, intake: { ...cur.intake, base: { ...cur.intake.base, paid: true } } } : cur));
      if (t.charged) onCharged();
      if (!alive) return;
      setTemplates(t);
      setTplPick(t.templates[0]?.id ?? null);
    }).catch((e) => {
      if (!alive) return;
      setTplError(true);
      setBoardError(e instanceof Error ? e.message : '템플릿을 불러오지 못했어요.');
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alimtalk, intake, asking, count, templates, tplError, retargeting, run.line]);

  // ── 잠금 사유(버튼 하나 · 이유 한 줄) ──
  const lock: string | null = !intake ? '대상을 찾는 중이에요'
    : intake.zeroReason === 'scope' ? '담당 매장이 지정되지 않아 보낼 고객을 정할 수 없어요'
    : lineUntranslated.length > 0 ? `한 줄의 「${lineUntranslated.map((u) => u.text).join(' · ')}」 조건을 옮기지 못했어요. 한 줄을 고쳐 다시 보내 주세요`
    : pickUntranslated.length > 0 ? `직접 고른 「${pickUntranslated.map((u) => u.text).join(' · ')}」 조건은 쓸 수 없어요. 그 조건을 빼고 다시 골라 주세요`
    : retargeting ? '받는 사람을 다시 세는 중이에요'
    : detailStale ? '받는 사람을 다시 세지 못했어요. 「다시 세기」를 눌러 주세요'
    : run.manual && !run.audience ? '직접 고른 조건을 다시 골라 주세요(확인하지 못했어요)'
    : emptyNow && !allCustomersFlag(run) ? '조건이 모두 빠졌어요. 조건을 켜거나 「전체 고객에게 보내기」를 골라 주세요'
    : count === 0 ? '조건에 맞는 고객이 0명이에요'
    : count > MAX_AUDIENCE ? `받는 사람이 ${count.toLocaleString()}명이에요. 한 번에 ${MAX_AUDIENCE.toLocaleString()}명까지 보낼 수 있어요`
    // ★ Codex B1 medium — 템플릿을 못 불러왔거나 고르지 않았으면 진행하지 않는다(템플릿 없이 넘어가지 않게)
    : alimtalk ? (!templates ? (tplError ? '템플릿을 불러오지 못했어요. 창을 닫았다가 다시 열어 주세요' : '템플릿을 불러오는 중이에요')
      : templates.templates.length === 0 ? '승인된 알림톡 템플릿이 없어요'
      : !tplPick ? '템플릿을 골라 주세요' : null)
    : run.types.length === 0 ? '종류를 골라 주세요'
    : null;
  const lacking = creditTotal != null && !directOnly && !alimtalk && creditTotal < total;

  const [busy, setBusy] = useState(false);
  /** varsArg = 칼럼 단계에서 고른 칼럼(「넣지 않고 만들기」 = []) */
  const make = async (varsArg: string[] = usableVars) => {
    if (!intake || lock || busy) return;
    setBusy(true);
    setBoardError(null);
    try {
      if (alimtalk || directOnly || copyTypes.length === 0) {
        await aiLineApi.proceed(run.line, activeFilters(run), allCustomersFlag(run));
        onCharged();
        if (alimtalk) onProceedAlimtalk(run, tplPick);
        else onProceedDirect({ ...run, cards: [{ type: 'direct', label: AI_LINE_TYPE_META.direct.label, body: '', subject: '', byteCount: 0 }], picked: 'direct' });
        return;
      }
      const out = await aiLineApi.compose({
        line: run.line, facts: run.facts, filters: activeFilters(run), allCustomers: allCustomersFlag(run),
        types: copyTypes, vars: varsArg, channel: run.channel, isAd: isAdOf(run), attemptToken: run.attemptToken,
        contentType: run.contentType ?? intake.contentType ?? null,
      });
      onCharged();
      const direct = run.types.includes('direct') ? [{ type: 'direct' as const, label: AI_LINE_TYPE_META.direct.label, body: '', subject: '', byteCount: 0 }] : [];
      const rec = intake.recommend?.type;
      const picked = out.cards.find((c) => c.type === rec)?.type ?? out.cards[0]?.type ?? 'direct';
      onComposed({ ...run, vars: varsArg, cards: [...out.cards, ...direct], channel: out.channel, picked, liveCount: out.count });
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : '만들지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = alimtalk ? `알림톡으로 진행 · ${baseCost}크레딧`
    : directOnly ? `이 대상으로 진행 · ${baseCost}크레딧`
    : `만들기 · ${total}크레딧`;
  /** 문자 갈래에서 문안을 만들 종류가 있으면 확인 판 다음 = 칼럼 단계(만들기 버튼은 그 단계 한 곳) */
  const toVars = !alimtalk && !directOnly && copyTypes.length > 0;

  // ── 칼럼 단계 ──
  // 추천 = 대상 찾기 AI 가 이 한 줄에 맞게 고른 칼럼(대상을 바꾼 뒤에도 같은 표시) · 처음 들어올 때만 최대 2개 미리 체크
  const recommendedTokens = useMemo(() => new Set(intake?.recommendedVars ?? (intake?.columns || []).filter((c) => c.recommended).map((c) => c.token)), [intake]);
  const precheckedFor = useRef<string | null>(null);
  const goVars = () => {
    if (precheckedFor.current !== run.runId && run.vars.length === 0) {
      const pre = aud.columns.filter((c) => !c.locked && (c.recommended || recommendedTokens.has(c.token))).slice(0, PRECHECK_MAX).map((c) => c.token);
      if (pre.length > 0) onRun({ ...run, vars: pre });
    }
    precheckedFor.current = run.runId;
    setBoardError(null);
    setStep('vars');
  };

  // ── 금액 상자(확인 판 · 칼럼 단계 같이) ──
  const amountBox = intake ? (
    <div className="rounded-xl bg-white border border-slate-200 p-3 text-[12.5px] text-slate-600 space-y-1">
      <div className="flex justify-between"><span>대상 찾기{intake.base.paid ? '(이미 냄)' : ''}</span><span className="tabular-nums">{baseCost}</span></div>
      {!alimtalk && <div className="flex justify-between"><span>문안 {copyTypes.length}개 × {unit}</span><span className="tabular-nums">{copyTypes.length * unit}</span></div>}
      {!alimtalk && <div className="flex justify-between"><span>스팸 검사 {run.types.length}건(문자 요금 · 요금제 무료 문자 먼저)</span><span>문자</span></div>}
      <div className="flex justify-between font-semibold text-slate-900 pt-1 border-t border-slate-100">
        <span>{creditTotal != null ? `잔액 ${creditTotal.toLocaleString()} → ${(creditTotal - (alimtalk || directOnly ? baseCost : total)).toLocaleString()}` : '크레딧'}</span>
        <span className="tabular-nums">{alimtalk || directOnly ? baseCost : total}크레딧</span>
      </div>
    </div>
  ) : null;

  // ── 문자 성격 · 브랜드 말투 ──
  const isAdNow = isAdOf(run);
  const voice = intake?.voice ?? null;
  // ★ 2026-10-28 AI 메모리 설계 K13-7 · K7-5 — 칩 상태(학습 미완 · 확인 대기)는 AI 메모리와 같은 판정 · 버튼 = 브랜드 보이스 바로 열기
  const voiceNote: string | null = !voice ? null
    : voice.status === 'review_pending' ? '배운 내용을 아직 확인하지 않아 기본 말투로 써요. 확인하면 바로 그 말투로 써요'
    : voice.status === 'incomplete' && !voice.learned ? '새로 올린 문안을 아직 배우지 않았어요. [다시 배우기]를 누르면 그 말투로 써요'
    : !voice.learned ? '브랜드 말투 학습본이 없어 기본 말투로 써요. 보냈던 문자를 고르면 그 말투 · 줄띄움 · 기호로 맞춰져요'
    : isAdNow ? (voice.marketing ? null : '마케팅 문자 학습본이 없어 학습된 말투로 써요. AI 메모리에 마케팅 문자를 올리면 맞춰져요')
    : (voice.notice ? null : '안부 문자 학습본이 없어 마케팅 말투로 써요. AI 메모리에 안부 문자를 올리면 맞춰져요');

  return (
    <JourneyModalShell
      open={open}
      onClose={onClose}
      labelledBy="ai-line-q"
      disableDismiss
      zIndexClassName="z-[1500]"
      panelClassName={step === 'board' && !asking
        ? 'w-full md:w-[min(1040px,calc(100vw-3rem))] md:max-w-none !max-h-[100dvh] md:!max-h-[min(860px,calc(100dvh-3rem))]'
        : 'w-full md:max-w-[540px] !max-h-[100dvh] md:!max-h-[min(640px,calc(100dvh-3rem))]'}
    >
      {/* 머리 */}
      <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 id="ai-line-q" className="text-[17px] font-bold text-slate-900">
            {step === 'kakao' ? '어느 채널로 보낼까요?'
              : step === 'asks' ? '문안에 넣을 내용을 확인할게요'
              : step === 'vars' ? '문안에 어떤 고객 정보를 넣을까요?'
              : asking ? '누구에게 보낼까요?'
              : alimtalk ? '어느 알림톡 템플릿으로 보낼까요?'
              : '이렇게 만들어요'}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500 truncate"><span className="font-semibold text-violet-700 mr-1.5">한 줄</span>{run.line}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0">
          <X className="w-5 h-5" />
        </button>
      </div>

      {step === 'kakao' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-3">
          <p className="text-[13.5px] text-slate-600">「카톡」은 알림톡(승인된 템플릿 · 광고 불가)과 문자 중 어느 쪽인지 한 번만 여쭤요.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => { onRun({ ...run, branch: 'alimtalk' }); setStep('board'); }}
              className="rounded-xl border border-slate-200 p-4 text-left hover:border-violet-400 hover:bg-violet-50/50 transition-colors">
              <p className="text-[15px] font-bold text-slate-900">알림톡</p>
              <p className="mt-1 text-[12.5px] text-slate-500">승인된 템플릿으로 · 문안을 만들지 않아요</p>
            </button>
            <button type="button" onClick={() => {
              const next = { ...run, branch: 'sms' as const };
              onRun(next);
              setStep(run.facts === null ? 'asks' : 'board');
            }}
              className="rounded-xl border border-slate-200 p-4 text-left hover:border-violet-400 hover:bg-violet-50/50 transition-colors">
              <p className="text-[15px] font-bold text-slate-900">문자</p>
              <p className="mt-1 text-[12.5px] text-slate-500">문안을 만들고 스팸 검사까지</p>
            </button>
          </div>
        </div>
      )}

      {step === 'asks' && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">
            {!intake ? (
              <div className="h-56 flex flex-col items-center justify-center gap-3 text-slate-500 text-center">
                {loadError ? (
                  <>
                    <AlertTriangle className="w-7 h-7 text-amber-600" />
                    <p className="text-[13.5px] text-slate-700">{loadError}</p>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
                    <p className="text-[13.5px]">한 줄을 읽고 문안에 필요한데 빠진 것을 찾고 있어요</p>
                  </>
                )}
              </div>
            ) : (
              <>
                {askBenefit && (
                  <div className="space-y-2">
                    <p className="text-[13px] font-semibold text-slate-700 inline-flex items-center gap-1.5"><Gift className="w-4 h-4 text-violet-600" />{askBenefit.text}</p>
                    {askBenefit.why && <p className="text-[12.5px] text-slate-500">{askBenefit.why}</p>}
                    <input
                      value={benefitDraft}
                      onChange={(e) => { setBenefitDraft(e.target.value); if (e.target.value) setBenefitNone(false); }}
                      maxLength={300}
                      placeholder="예: 전 품목 20% 할인 · 3만원 이상 무료배송"
                      className="w-full h-11 rounded-xl border border-slate-300 px-3 text-[16px] [@media(pointer:fine)]:text-[14px] outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    />
                    <button type="button" onClick={() => { setBenefitNone((v) => !v); setBenefitDraft(''); }}
                      className={`h-9 px-3 rounded-lg border text-[13px] ${benefitNone ? 'border-violet-600 bg-violet-50 text-violet-800 font-semibold' : 'border-dashed border-slate-300 text-slate-500'}`}>
                      혜택 없이 보내기
                    </button>
                  </div>
                )}
                {askPeriod && (
                  <div className="space-y-2">
                    <p className="text-[13px] font-semibold text-slate-700 inline-flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-violet-600" />{askPeriod.text}</p>
                    {askPeriod.why && <p className="text-[12.5px] text-slate-500">{askPeriod.why}</p>}
                    <div className="flex flex-wrap gap-2 text-[13px]">
                      {chips.map((c) => (
                        <button key={c.value} type="button" onClick={() => { setPeriodPick(c.value); setPeriodNone(false); }}
                          className={`h-9 px-3 rounded-lg border ${periodPick === c.value && !periodNone ? 'border-2 border-violet-600 bg-violet-50 text-violet-800 font-semibold' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                          {c.label}
                        </button>
                      ))}
                      <label className="h-9 px-3 rounded-lg border border-slate-200 text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
                        달력에서 고르기
                        <input type="date" min={ymd(new Date())} className="text-[13px] outline-none bg-transparent"
                          value={periodPick && !chips.some((c) => c.value === periodPick) ? periodPick : ''}
                          onChange={(e) => { if (e.target.value) { setPeriodPick(e.target.value); setPeriodNone(false); } }} />
                      </label>
                      <button type="button" onClick={() => { setPeriodNone((v) => !v); setPeriodPick(null); }}
                        className={`h-9 px-3 rounded-lg border text-[13px] ${periodNone ? 'border-violet-600 bg-violet-50 text-violet-800 font-semibold' : 'border-dashed border-slate-300 text-slate-500'}`}>
                        기간 없이 보내기
                      </button>
                    </div>
                    {periodPick && !periodNone && <p className="text-[12px] text-violet-700">{periodLabel(periodPick)}</p>}
                  </div>
                )}
                {askTexts.map((a) => {
                  const val = textAns[a.id] || '';
                  return (
                    <div key={a.id} className="space-y-2">
                      <p className="text-[13px] font-semibold text-slate-700 inline-flex items-center gap-1.5"><HelpCircle className="w-4 h-4 text-violet-600" />{a.text}</p>
                      {a.why && <p className="text-[12.5px] text-slate-500">{a.why}</p>}
                      {a.options.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-[13px]">
                          {a.options.map((o) => (
                            <button key={o} type="button" aria-pressed={val === o} onClick={() => setTextAns((cur) => ({ ...cur, [a.id]: cur[a.id] === o ? '' : o }))}
                              className={`h-9 px-3 rounded-lg border ${val === o ? 'border-2 border-violet-600 bg-violet-50 text-violet-800 font-semibold' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                              {o}
                            </button>
                          ))}
                        </div>
                      )}
                      <input
                        value={a.options.includes(val) ? '' : val}
                        onChange={(e) => setTextAns((cur) => ({ ...cur, [a.id]: e.target.value }))}
                        maxLength={200}
                        placeholder={a.options.length > 0 ? '직접 적기' : '답을 적어 주세요'}
                        className="w-full h-11 rounded-xl border border-slate-300 px-3 text-[16px] [@media(pointer:fine)]:text-[14px] outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      />
                    </div>
                  );
                })}
                <p className="text-[12px] text-slate-500">
                  {intake.conditions.some((c) => c.origin === 'line')
                    ? <>읽은 값 · 대상 「{intake.conditions.filter((c) => c.origin === 'line').map((c) => c.text).join(' · ')}」은 다시 묻지 않아요. </>
                    : '한 줄에서 읽은 것은 다시 묻지 않아요. '}
                  {askTexts.length > 0 ? '비워 둔 질문은 문안에 넣지 않아요(지어내지 않아요).' : ''}
                </p>
              </>
            )}
          </div>
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 shrink-0">
            <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-[13.5px] font-semibold text-slate-700">나중에</button>
            <button type="button" onClick={submitAsks} disabled={!intake || !asksOk} className="h-10 px-5 rounded-lg bg-slate-900 text-white text-[13.5px] font-semibold disabled:opacity-40">다음</button>
          </div>
        </>
      )}

      {asking && intake && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-3">
            <p className="text-[13.5px] text-slate-600">한 줄에서 받을 고객 조건을 찾지 못했어요. 누구에게 보낼지 골라 주세요. 고르기 전에는 크레딧이 빠지지 않아요.</p>
            {aiSuggest.length > 0 && intake.count > 0 && (
              <button type="button" onClick={chooseAiSuggest}
                className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-violet-400 hover:bg-violet-50/50 transition-colors">
                <p className="text-[15px] font-bold text-slate-900 inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-600" />AI 추천 대상 · {intake.count.toLocaleString()}명</p>
                <p className="mt-1 text-[12.5px] text-slate-500">{aiSuggest.map((c) => c.text).join(' · ')}</p>
              </button>
            )}
            <button type="button" onClick={chooseAllCustomers} disabled={retargeting}
              className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-violet-400 hover:bg-violet-50/50 transition-colors disabled:opacity-50">
              <p className="text-[15px] font-bold text-slate-900 inline-flex items-center gap-1.5"><Users className="w-4 h-4 text-violet-600" />전체 고객</p>
              <p className="mt-1 text-[12.5px] text-slate-500">수신동의한 고객 전원 · 담당 매장 범위 안</p>
            </button>
            <button type="button" onClick={() => setPickerOpen(true)} disabled={retargeting}
              className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-violet-400 hover:bg-violet-50/50 transition-colors disabled:opacity-50">
              <p className="text-[15px] font-bold text-slate-900 inline-flex items-center gap-1.5"><Filter className="w-4 h-4 text-violet-600" />직접 타겟 선택</p>
              <p className="mt-1 text-[12.5px] text-slate-500">성별 · 연령 · 지역 · 등급 · 구매 같은 조건을 직접 골라요</p>
            </button>
            <div className="rounded-xl border border-slate-200 p-4 space-y-2">
              <p className="text-[13px] font-semibold text-slate-700">한 줄로 더 적기</p>
              <div className="flex gap-2">
                <input
                  value={whoDraft}
                  onChange={(e) => setWhoDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && whoDraft.trim()) onRetypeLine(`${run.line} ${whoDraft.trim()}`); }}
                  maxLength={200}
                  placeholder="예: 최근 30일 미구매 VIP · 서울 30대 여성"
                  className="flex-1 min-w-0 h-10 rounded-lg border border-slate-300 px-3 text-[16px] [@media(pointer:fine)]:text-[14px] outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
                <button type="button" onClick={() => onRetypeLine(`${run.line} ${whoDraft.trim()}`)} disabled={!whoDraft.trim()}
                  className="h-10 px-4 rounded-lg bg-slate-900 text-white text-[13.5px] font-semibold disabled:opacity-40 shrink-0">찾기</button>
              </div>
            </div>
            {retargeting && <p className="text-[12.5px] text-slate-500 inline-flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />받는 사람을 세는 중이에요</p>}
            {boardError && <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-800">{boardError}</p>}
          </div>
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 shrink-0">
            <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-[13.5px] font-semibold text-slate-700">나중에</button>
          </div>
        </>
      )}

      {step === 'board' && !asking && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!intake ? (
              <div className="h-72 flex flex-col items-center justify-center gap-3 text-slate-500 px-6 text-center">
                {loadError ? (
                  <>
                    <AlertTriangle className="w-7 h-7 text-amber-600" />
                    <p className="text-[13.5px] text-slate-700">{loadError}</p>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-7 h-7 animate-spin text-violet-600" />
                    <p className="text-[13.5px]">받을 고객을 찾고 있어요. 발송 명단과 같은 계산으로 셉니다.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid md:grid-cols-[1.25fr_1fr] md:divide-x divide-slate-100">
                {/* 왼쪽 */}
                <div className="p-5 space-y-4">
                  {read?.adConflict && alimtalk && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12.5px] text-amber-900 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span className="flex-1">할인 같은 광고는 알림톡으로 보낼 수 없어요.</span>
                      <button type="button" onClick={() => { onRun({ ...run, branch: 'sms' }); if (run.facts === null) setStep('asks'); }} className="font-semibold underline underline-offset-2 shrink-0">문자로 만들기</button>
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] font-semibold text-slate-500">{run.manual ? '직접 고른 대상' : '한 줄에서 읽은 대상'}</p>
                      <span className="inline-flex items-center gap-1.5">
                        {(run.manual || run.allChecked) && (
                          <button type="button" onClick={backToLine} className="h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1">
                            <Undo2 className="w-3.5 h-3.5" />한 줄 대상으로
                          </button>
                        )}
                        <button type="button" onClick={() => setPickerOpen(true)} disabled={retargeting}
                          className="h-8 px-2.5 rounded-lg border border-violet-200 bg-white text-[12.5px] font-semibold text-violet-800 hover:bg-violet-50 inline-flex items-center gap-1 disabled:opacity-50">
                          <Filter className="w-3.5 h-3.5" />직접 타겟 선택
                        </button>
                      </span>
                    </div>
                    {run.manual ? (
                      <div className="flex flex-wrap gap-1.5 text-[13px]">
                        {(run.audience?.conditions || []).map((c) => (
                          <span key={c.key} className="h-8 px-2.5 rounded-lg border bg-violet-50 border-violet-200 text-violet-900 inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />{c.text}
                          </span>
                        ))}
                        {!run.audience && <span className="text-[12.5px] text-slate-400 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />조건을 읽는 중</span>}
                      </div>
                    ) : (
                    <>
                    <div className="flex flex-wrap gap-1.5 text-[13px]">
                      {intake.conditions.filter((c) => c.origin === 'line').length === 0 && <span className="text-[12.5px] text-slate-400">{allCustomersFlag(run) ? '전체 고객' : '읽은 조건이 없어요'}</span>}
                      {intake.conditions.filter((c) => c.origin === 'line').map((c) => {
                        const on = !run.offKeys.includes(c.key);
                        return (
                          <button key={c.key} type="button" onClick={() => toggleCond(c.key)} aria-pressed={on} disabled={retargeting}
                            className={`h-8 px-2.5 rounded-lg border inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${on ? 'bg-violet-50 border-violet-200 text-violet-900' : 'bg-white border-slate-200 text-slate-400 line-through'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-violet-500' : 'bg-slate-300'}`} />{c.text}
                          </button>
                        );
                      })}
                    </div>
                    {intake.conditions.some((c) => c.origin === 'ai') && (
                      <>
                        <p className="text-[12.5px] font-semibold text-slate-500 pt-1">AI 가 보탬</p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                          {intake.conditions.filter((c) => c.origin === 'ai').map((c) => {
                            const on = !run.offKeys.includes(c.key);
                            return (
                              <span key={c.key} className="inline-flex items-center gap-1.5">
                                <button type="button" onClick={() => toggleCond(c.key)} aria-pressed={on} disabled={retargeting}
                                  className={`h-8 px-2.5 rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-50 ${on ? 'bg-white border-slate-300 text-slate-800' : 'bg-white border-slate-200 text-slate-400'}`}>
                                  <span className={`w-3.5 h-3.5 rounded grid place-items-center ${on ? 'bg-violet-600' : 'border border-slate-300'}`}>{on && <Check className="w-3 h-3 text-white" />}</span>
                                  {c.text}
                                </button>
                                {withoutCounts[c.key] != null && <span className="text-[12px] text-slate-500">빼면 <b className="tabular-nums text-slate-700">{withoutCounts[c.key].toLocaleString()}</b>명</span>}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {intake.untranslated.length > 0 && (
                      <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                        옮기지 못한 조건 · 「{intake.untranslated.map((u) => u.text).join(' · ')}」 · 받는 사람 계산에 들어가지 않아요
                      </p>
                    )}
                    {emptyNow && (
                      <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={allCustomersFlag(run)} onChange={toggleAll} disabled={retargeting} className="w-4 h-4 accent-violet-600" />
                        조건 없이 전체 고객에게 보내기
                      </label>
                    )}
                    </>
                    )}
                    {pickUntranslated.length > 0 && (
                      <p className="text-[12px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2">
                        쓸 수 없는 조건 · 「{pickUntranslated.map((u) => u.text).join(' · ')}」 · 직접 타겟 선택에서 빼 주세요
                      </p>
                    )}
                    <div className={`rounded-xl border px-3 py-2 flex items-center justify-between ${count > 0 && count <= MAX_AUDIENCE ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                      <span className={`text-[13px] inline-flex items-center gap-1.5 ${count > 0 ? 'text-emerald-900' : 'text-rose-900'}`}><Users className="w-4 h-4" />받는 사람(발송 명단과 같은 계산)</span>
                      <span className="inline-flex items-center gap-2">
                        {detailStale && !retargeting && (
                          <button type="button" onClick={() => { void retarget({ ...run }); }}
                            className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">
                            다시 세기
                          </button>
                        )}
                        <b className={`text-[18px] tabular-nums ${count > 0 && count <= MAX_AUDIENCE ? 'text-emerald-800' : 'text-rose-700'}`}>
                          {retargeting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : `${count.toLocaleString()}명`}
                        </b>
                      </span>
                    </div>
                    {count === 0 && !retargeting && !run.manual && (
                      <p className="text-[12px] text-slate-500">
                        {intake.zeroReason === 'unresolved' ? (intake.reasoning || '한 줄의 조건을 옮기지 못했어요. 조건을 더 구체적으로 적어 주세요.')
                          : intake.zeroReason === 'scope' ? '담당 매장이 지정되지 않았어요. 관리자에게 매장 배정을 요청해 주세요.'
                          : '조건에 맞는 고객이 없어요. 조건을 빼거나 한 줄을 고쳐 주세요. 대상 찾기 크레딧은 빠지지 않았어요.'}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate-600">
                      <span>혜택 <b className="text-slate-900">{run.facts?.benefit || (askBenefit ? '없음' : '한 줄 그대로')}</b></span>
                      {(run.facts?.period_end || askPeriod) && <span>기간 <b className="text-slate-900">{run.facts?.period_end ? periodLabel(run.facts.period_end) : '없음'}</b></span>}
                      {(run.facts?.answers?.length ?? 0) > 0 && <span>확인한 사실 <b className="text-slate-900">{run.facts?.answers?.length}개</b></span>}
                      {!alimtalk && (
                        <span className="inline-flex items-center gap-1.5">채널
                          {(['SMS', 'LMS', 'MMS'] as const).map((c) => (
                            <button key={c} type="button" onClick={() => setChannel(c)}
                              className={`h-6 px-2 rounded-md border text-[11.5px] font-semibold ${run.channel === c ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-500'}`}>{c}</button>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  {!alimtalk ? (
                    <div className="space-y-2">
                      <p className="text-[12.5px] font-semibold text-slate-500">문안 종류(여러 개)</p>
                      <div className="grid grid-cols-2 gap-2 text-[13px]">
                        {AI_LINE_TYPE_ORDER.map((t) => {
                          const on = run.types.includes(t);
                          const rec = intake.recommend?.type === t;
                          return (
                            <button key={t} type="button" onClick={() => toggleType(t)} aria-pressed={on}
                              className={`relative rounded-xl p-3 text-left transition-colors ${on ? 'border-2 border-violet-600 bg-violet-50/60' : 'border border-slate-200 hover:border-slate-300'}`}>
                              {rec && <span className="absolute top-2 right-2 rounded-full bg-violet-600 text-white text-[10.5px] font-bold px-1.5 leading-[18px]">추천</span>}
                              <p className="font-semibold text-slate-900">{intake.typeNames?.[t] || AI_LINE_TYPE_META[t].label}</p>
                              <p className={`text-[12px] ${on ? 'text-violet-900/80' : 'text-slate-500'}`}>{rec && intake.recommend?.reason ? intake.recommend.reason : AI_LINE_TYPE_META[t].desc}</p>
                              <p className={`mt-1 text-[12px] font-semibold ${on ? 'text-violet-800' : 'text-slate-600'}`}>{t === 'direct' ? '+0' : `+${unit}`}{on ? ' · 고름' : ''}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[12.5px] font-semibold text-slate-500">승인된 템플릿(자동 매칭)</p>
                      {!templates ? (
                        <div className="h-20 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
                      ) : templates.templates.length === 0 ? (
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[12.5px] text-slate-600 space-y-2">
                          <p>{templates.suggestion || '승인된 알림톡 템플릿이 없어요.'}</p>
                          <button type="button" onClick={() => { onRun({ ...run, branch: 'sms' }); if (run.facts === null) setStep('asks'); }} className="font-semibold text-indigo-700 underline underline-offset-2">문자로 만들기</button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {templates.templates.slice(0, 4).map((t, i) => (
                            <button key={t.id} type="button" onClick={() => setTplPick(t.id)} aria-pressed={tplPick === t.id}
                              className={`w-full rounded-xl p-3 text-left text-[13px] ${tplPick === t.id ? 'border-2 border-violet-600 bg-violet-50/60' : 'border border-slate-200'}`}>
                              <p className="font-semibold text-slate-900">{t.name}</p>
                              <p className="text-[12px] text-slate-500">{i === 0 ? '맞춤 1위 · ' : ''}{t.reason}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 오른쪽 */}
                <div className="p-5 space-y-3 bg-slate-50/60">
                  {!alimtalk ? (
                    <>
                      <p className="text-[12.5px] font-semibold text-slate-500">문자 성격</p>
                      <div className="grid grid-cols-2 gap-2 text-[13px]">
                        {([true, false] as const).map((ad) => (
                          <button key={String(ad)} type="button" aria-pressed={isAdNow === ad} onClick={() => onRun({ ...run, isAd: ad })}
                            className={`rounded-xl p-3 text-left transition-colors ${isAdNow === ad ? 'border-2 border-violet-600 bg-violet-50/60' : 'border border-slate-200 bg-white hover:border-slate-300'}`}>
                            <p className="font-semibold text-slate-900">{ad ? '마케팅' : '안부 · 알림'}</p>
                            <p className={`text-[12px] ${isAdNow === ad ? 'text-violet-900/80' : 'text-slate-500'}`}>{ad ? '(광고) 표기 · 무료거부 080' : '광고 표기 없이'}</p>
                          </button>
                        ))}
                      </div>
                      <p className="text-[11.5px] text-slate-500">한 줄을 읽고 {intake.isAd ? '마케팅' : '안부 · 알림'}으로 골랐어요. 이 성격의 브랜드 말투 · 대표 문안으로 써요. 할인 · 쿠폰처럼 구매를 권하면 마케팅으로 보내야 해요(광고 표기 의무).</p>
                      {!!intake.contentTypes?.length && (
                        <div>
                          <p className="text-[12.5px] font-semibold text-slate-500 mb-1.5">문자 종류</p>
                          <div className="flex flex-wrap gap-1.5">
                            {intake.contentTypes.map((c) => {
                              const on = (run.contentType ?? intake.contentType ?? null) === c.key;
                              return (
                                <button key={c.key} type="button" aria-pressed={on} onClick={() => onRun({ ...run, contentType: c.key })}
                                  className={`h-8 px-3 rounded-full text-[12.5px] font-semibold ${on ? 'border-2 border-violet-600 bg-violet-50 text-violet-900' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                                  {c.label}{on && run.contentType == null && intake.contentType === c.key ? ' · AI' : ''}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[11.5px] text-slate-500 mt-1">종류에 맞는 대표 문안의 뼈대로 써요. 광고 표기는 위 성격만 따라요.</p>
                        </div>
                      )}
                      {voiceNote && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12.5px] text-amber-900 flex items-start gap-2">
                          <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                          <span className="flex-1">{voiceNote} <Link to="/ai-memory?learn=voice" className="font-semibold underline underline-offset-2">목소리 배우기</Link></span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-[12.5px] font-semibold text-slate-500">변수 맞추기(발송 창에서 고칠 수 있어요)</p>
                      <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100 text-[13px]">
                        {(templates?.mappings || []).length === 0 ? (
                          <p className="px-3 py-3 text-[12.5px] text-slate-400">{templates ? '변수가 없는 템플릿이에요' : '불러오는 중'}</p>
                        ) : templates!.mappings.map((mp) => (
                          <div key={mp.templateVariable} className="flex items-center justify-between px-3 h-10">
                            <code className="text-[12px]">{mp.templateVariable}</code>
                            <span className={mp.customerFieldLabel ? 'text-slate-800' : 'text-amber-700'}>{mp.customerFieldLabel || '직접 맞추기'}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11.5px] text-slate-500">알림톡 본문은 문자 스팸 검사 대상이 아니에요 · 대체 문자는 발송 창에서 정해요</p>
                    </>
                  )}
                  {amountBox}
                </div>
              </div>
            )}
            {boardError && <p className="mx-5 mb-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-800">{boardError}</p>}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 shrink-0 sticky bottom-0 bg-white">
            {(lock || lacking) && <p className="mr-auto text-[12px] text-slate-500">{lock || '크레딧이 모자라요. 충전한 뒤 다시 눌러 주세요'}</p>}
            <button type="button" onClick={onClose} className="h-11 px-4 rounded-lg border border-slate-200 text-[13.5px] font-semibold text-slate-700">닫기(결과 보존)</button>
            {toVars ? (
              <button type="button" onClick={goVars} disabled={!!lock || lacking || busy}
                className="h-11 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-bold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                <Users className="w-4 h-4" />다음 · 개인화 고르기
              </button>
            ) : (
              <button type="button" onClick={() => { void make(); }} disabled={!!lock || lacking || busy}
                className="h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[14px] font-bold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : alimtalk ? <MessageSquare className="w-4 h-4" /> : directOnly ? <Send className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                {buttonLabel}
              </button>
            )}
          </div>
        </>
      )}

      {step === 'vars' && intake && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
            <p className="text-[12.5px] text-slate-500">
              받는 사람 <b className="text-slate-800 tabular-nums">{count.toLocaleString()}명</b> · {copyTypes.map((t) => intake.typeNames?.[t] || AI_LINE_TYPE_META[t].label).join(' · ')} · {isAdNow ? '마케팅' : '안부 · 알림'}
            </p>
            <p className="text-[13px] text-slate-700">
              {aud.top?.name ? <>이 대상 1위 고객 <b>{aud.top.name}</b>의 실제 값이에요. </> : null}
              고른 칼럼만 문안에 넣고, 고르지 않은 칼럼은 넣지 않아요.
            </p>
            {aud.columns.length === 0 ? (
              <p className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3 text-[12.5px] text-slate-600">이 대상은 문안에 넣을 고객 정보가 비어 있어요. 칼럼 없이 만들어요.</p>
            ) : (
              <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100 text-[13px]">
                {aud.columns.map((c) => {
                  const on = usableVars.includes(c.token);
                  const rec = (c.recommended || recommendedTokens.has(c.token)) && !c.locked;
                  return (
                    <button key={c.token} type="button" disabled={c.locked} onClick={() => toggleVar(c.token)} aria-pressed={on}
                      className={`w-full flex items-center gap-2 px-3 h-11 text-left ${c.locked ? 'text-slate-400 cursor-not-allowed' : 'hover:bg-slate-50'}`}>
                      <span className={`w-4 h-4 rounded grid place-items-center shrink-0 ${c.locked ? 'border border-slate-200 bg-slate-100' : on ? 'bg-violet-600' : 'border border-slate-300'}`}>
                        {c.locked ? <Lock className="w-3 h-3" /> : on && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="w-[92px] text-slate-500 truncate">{c.label}</span>
                      <b className={`flex-1 min-w-0 truncate ${c.locked ? 'font-medium' : ''}`}>{c.value ?? '빈칸'}</b>
                      {c.custom && <span className="shrink-0 rounded-full bg-slate-100 text-slate-700 text-[10.5px] font-semibold px-1.5 leading-[18px]">회사 칼럼</span>}
                      {rec && <span className="shrink-0 rounded-full bg-violet-100 text-violet-800 text-[10.5px] font-bold px-1.5 leading-[18px]">추천</span>}
                      <span className="text-[11.5px] text-slate-500 tabular-nums shrink-0">{c.fill}%{c.locked ? ' · 빈칸 많음' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {usableVars.length > 0 && (
              <p className="text-[12px] text-violet-800">
                넣으면 이렇게 바뀌어요 · {usableVars.map((t) => `%${t}% → ${aud.columns.find((x) => x.token === t)?.value ?? '빈칸'}`).join(' · ')}
              </p>
            )}
            <p className="text-[11.5px] text-slate-500">%칼럼% 자리는 받는 사람마다 그 고객의 값으로 바뀌어요 · 채움 % = 이 대상 안에서 값이 있는 비율 · 30% 미만은 잠금{usableVars.length > 0 && run.channel === 'SMS' ? ' · 칼럼을 넣으면 장문(LMS)으로 보내요' : ''}</p>
            {amountBox}
            {boardError && <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12.5px] text-rose-800">{boardError}</p>}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 shrink-0 sticky bottom-0 bg-white">
            {(lock || lacking) && <p className="w-full text-[12px] text-slate-500">{lock || '크레딧이 모자라요. 충전한 뒤 다시 눌러 주세요'}</p>}
            <button type="button" onClick={() => { setBoardError(null); setStep('board'); }} disabled={busy}
              className="mr-auto h-11 px-3 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />확인 판
            </button>
            <button type="button" onClick={() => { void make([]); }} disabled={!!lock || lacking || busy}
              className="h-11 px-4 rounded-lg border border-slate-200 text-[13.5px] font-semibold text-slate-700 disabled:opacity-40">
              넣지 않고 만들기
            </button>
            <button type="button" onClick={() => { void make(); }} disabled={!!lock || lacking || busy}
              className="h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[14px] font-bold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {buttonLabel}
            </button>
          </div>
        </>
      )}
      {/* ★ 2026-10-19 직접 타겟 선택 = 지금 조건 고르기 창(고르기 모드 · 추출 없음 · 확인 창 위) */}
      <DirectTargetFilterModal
        show={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onExtracted={() => { /* 고르기 모드는 추출하지 않는다 */ }}
        onPick={({ dynamicFilters, enabledFields }) => pickDirect(dynamicFilters, enabledFields)}
      />
    </JourneyModalShell>
  );
}
