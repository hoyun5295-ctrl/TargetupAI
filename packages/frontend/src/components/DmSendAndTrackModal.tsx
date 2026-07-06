/**
 * DmSendAndTrackModal — 모바일DM 타겟 발송 + 발송 추적 (sub-project A · P4)
 *
 *   타겟 추출(channel=dm) → 문안 작성(AI 생성 / 직접) → 핸드폰 편집기(꾸미기·다듬기·스팸테스트·예약시각)
 *   → 수신자별 개인화 링크(?r=token) 문자 발송. 발송 후 '발송 추적'에서 열람/완독 확인.
 *   발송은 검증된 /dm/:id/send-to-target(직접발송 파이프라인 재사용 — 안전망 보존).
 *   DM 링크는 %DM링크% 위치에 자동 삽입(수신자별). 없으면 문안 끝에 첨부.
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, RefreshCw, Check, X, Wand2, ShieldCheck, Clock, Smartphone, Download } from 'lucide-react';
// ★ 2026-07-06 발송 추적 CSV 다운로드 (Harold 지시) — 공용 CT (BOM + 셀 이스케이프)
import { downloadCsv, safeCsvFilename } from '../utils/csv-download';
import { useToast } from './ToastProvider';
import TargetExtractModal, { type ExtractedTarget } from './TargetExtractModal';
import AiRefineModal from './AiRefineModal';
import SpamFilterTestModal from './SpamFilterTestModal';
import ConfirmModal, { type ConfirmState } from './ConfirmModal';
import { DateTimeField, isoToLocalInput, localInputToIso } from './DateTimeField';

/** 발신번호 select 특수값 — 고객별 등록매장 번호(개별 회신) */
const INDIVIDUAL_CB = '__individual__';

interface TrackRecipient {
  customerId: string;
  name: string | null;
  phone: string | null;
  sentAt: string | null;
  viewed: boolean;
  pageReached: number;
  totalPages: number;
  maxScrollPct: number | null;
  progressPct: number;
  completed: boolean;
  clicks: number;
  /** ★ 2026-07-02(3) 고객 액션(응모/투표/쿠폰 수령/설문) 여부 — dm_event_responses */
  responded: boolean;
  durationSeconds: number;
  lastActiveAt: string | null;
  /** ★ 2026-07-06 재열람 횟수(진입 비콘 누적) · 열람 기기 수(공유 신호) · 발송 후 7일 구매 실측 */
  openCount?: number;
  deviceCount?: number;
  purchaseCount?: number;
  purchaseAmount?: number;
}

interface TrackSummary {
  sent: number;
  viewed: number;
  reached50: number;
  completed: number;
  clicked: number;
  responded: number;
  /** ★ 2026-07-06 구매 전환(명·금액) · 재열람 · 다기기(공유 의심) */
  purchased?: number;
  purchaseAmount?: number;
  reViewed?: number;
  multiDevice?: number;
}

interface TrackData {
  summary: TrackSummary;
  recipients: TrackRecipient[];
  hourDistribution?: Array<{ hour: number; cnt: number }>;
  sectionExits?: Array<{ id: string; label: string; count: number }>;
}

/** 체류 초 → "1분 24초" 표시 */
const formatDur = (sec: number): string => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
};

/** 마지막 활동 상대 시각 */
const formatAgo = (iso: string | null): string => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
};

interface Props {
  dmId: string;
  dmTitle?: string;
  show: boolean;
  onClose: () => void;
  /** ★ 2026-07-02(3) DM 카드 [발송 추적] 진입 — 'track'이면 추적 탭으로 바로 열고 자동 로드 */
  initialView?: 'compose' | 'track';
}

// 편집기 변수 칩 (본문 삽입). %DM링크% = 수신자별 개인화 링크(발송 시 자동 치환).
const VAR_CHIPS = ['%DM링크%', '%고객명%', '%등급%', '%지역%'];
// ★ 2026-07-02(3) Harold 지시 — 미리보기 변수값은 하드코딩 대신 "전 단계에서 추출된 타겟"의 첫 샘플 실데이터로 치환

export default function DmSendAndTrackModal({ dmId, dmTitle, show, onClose, initialView }: Props) {
  const toast = useToast();
  const [view, setView] = useState<'compose' | 'track'>('compose');
  const [extractOpen, setExtractOpen] = useState(false);
  const [target, setTarget] = useState<ExtractedTarget | null>(null);

  // 문안 — 2모드
  const [mode, setMode] = useState<'ai' | 'direct'>('ai');
  const [prompt, setPrompt] = useState('');
  // ★ 2026-07-07(4) 문안 길이 — lms(기존 80~250자) / sms(90바이트 단문 — hlj.kr 단축링크로 가능해진 저단가 옵션)
  const [copyLen, setCopyLen] = useState<'lms' | 'sms'>('lms');
  const [messageText, setMessageText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [decorating, setDecorating] = useState(false);

  // ★ 2026-07-02(5) 타겟 DM 문자는 광고성이 기본 — (광고)+무료수신거부 080 자동 합성이 기본 동작
  const [isAd, setIsAd] = useState(true);
  // 설정된 수신거부(080) 번호 — 미리보기 합성 표시용 (발송 합성은 백엔드 CT가 동일 번호로 수행)
  const [opt080, setOpt080] = useState('');
  const [opt080Loaded, setOpt080Loaded] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [spamOpen, setSpamOpen] = useState(false);
  // ★ 2026-07-02(3) 발신번호 선택 — 회사 등록 번호 목록(기본 = is_default). 발송·스팸테스트 공용.
  const [callbackList, setCallbackList] = useState<Array<{ phone: string; isDefault: boolean }>>([]);
  const [callback, setCallback] = useState('');
  // ★ 2026-07-02(5) 고객사 보유 필드 — 꾸미기 활용 다중 선택 (AI 오퍼레이터 '활용 가능 컬럼' 패턴 미러).
  //   token/label = %변수% 안쪽 표시명(예 '고객명'). 시스템 변수 제외한 실제 고객 데이터 필드만.
  const [companyFields, setCompanyFields] = useState<Array<{ token: string; label: string; category: string }>>([]);
  const [decorateVars, setDecorateVars] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!show) return;
    (async () => {
      try {
        const res = await fetch('/api/manage/callbacks', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const data = await res.json();
        // 응답 키 = callbackNumbers (manage-callbacks.ts:76) — 구 callbacks 파싱이 항상 빈 목록이던 결함 수정
        const list: any[] = Array.isArray(data?.callbackNumbers) ? data.callbackNumbers
          : Array.isArray(data?.callbacks) ? data.callbacks
          : Array.isArray(data) ? data : [];
        const mapped = list.filter((c: any) => c?.phone).map((c: any) => ({ phone: String(c.phone), isDefault: !!c.is_default }));
        setCallbackList(mapped);
        const def = mapped.find((c) => c.isDefault) || mapped[0];
        setCallback((prev) => prev || def?.phone || '');
      } catch { /* 목록 조회 실패 = 발송 시 백엔드가 기본 번호 사용 */ }
      try {
        // reject_number = 설정 화면과 동일한 우선순위(getOpt080Number: user → 회사)로 확정된 080 번호
        const sres = await fetch('/api/companies/settings', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const sdata = await sres.json();
        setOpt080(String(sdata?.reject_number || '').trim());
        setOpt080Loaded(true);
      } catch { /* 미조회 = 미리보기에 번호 미표시 (발송은 백엔드 가드) */ }
      try {
        // 고객사 실제 보유 필드 — getAvailableVariables(회사 스키마 매핑). 시스템 변수 제외 = 고객 데이터 필드만.
        const vres = await fetch('/api/dm/variables', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const vdata = await vres.json();
        const list: any[] = Array.isArray(vdata?.variables) ? vdata.variables : [];
        setCompanyFields(
          list
            .filter((v: any) => v?.displayName && v.category !== 'system')
            .map((v: any) => ({ token: String(v.displayName), label: String(v.displayName), category: String(v.category || '') })),
        );
      } catch { /* 필드 조회 실패 = 꾸미기 필드 미표시 (삽입 칩은 기본값 폴백) */ }
    })();
  }, [show]);

  // ★ 2026-07-02(5) 본문에 실제 쓰인 보유 필드는 꾸미기 대상으로 자동 선택(추가 선택은 유지) — AI 오퍼레이터 패턴.
  useEffect(() => {
    if (companyFields.length === 0) return;
    const valid = new Set(companyFields.map((f) => f.token));
    const used: string[] = [];
    for (const m of Array.from(messageText.matchAll(/%([^%]+)%/g))) {
      if (valid.has(m[1])) used.push(m[1]);
    }
    if (used.length > 0) setDecorateVars((prev) => new Set([...prev, ...used]));
  }, [messageText, companyFields]);

  // 예약 시각
  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'manual' | 'ai'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');

  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const [tracking, setTracking] = useState<TrackData | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  // ★ 2026-07-06 미열람자 재발송 모드 — 추적 탭에서 미열람 고객만 추려 발송 탭으로(타겟 추출 대신 고객 id 지정)
  const [resendIds, setResendIds] = useState<string[] | null>(null);
  // ★ 2026-07-02(3) 미리보기 샘플 전환 — 추출된 수신자별 개인화 결과를 눈으로 확인
  const [sampleIdx, setSampleIdx] = useState(0);
  // ★ 2026-07-02(3) 개별 회신(미등록/미보유 제외) 확인 모달
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const isIndividualCb = callback === INDIVIDUAL_CB;
  const defaultRegisteredCb = callbackList.find((c) => c.isDefault)?.phone || callbackList[0]?.phone || '';
  // ★ 2026-07-02(5) 본문 삽입 칩 = %DM링크%(DM 전용) + 고객사 실제 보유 필드. 미로드 시 기본값 폴백.
  const insertChips = companyFields.length > 0
    ? ['%DM링크%', ...companyFields.map((f) => `%${f.token}%`)]
    : VAR_CHIPS;

  const loadTracking = async () => {
    setView('track');
    setLoadingTrack(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/recipients-tracking`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (res.ok && data.success) setTracking({ summary: data.summary, recipients: data.recipients, hourDistribution: data.hourDistribution || [], sectionExits: data.sectionExits || [] });
      else toast.error(data?.error || '추적 조회에 실패했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '추적 조회 중 오류가 발생했습니다.');
    } finally {
      setLoadingTrack(false);
    }
  };

  // ★ 2026-07-02(5) 수신자 상세 — 행 클릭 시 섹션 여정·요소 클릭·응답 이력 lazy 로드
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailMap, setDetailMap] = useState<Record<string, any>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const toggleDetail = async (customerId: string) => {
    if (expandedId === customerId) { setExpandedId(null); return; }
    setExpandedId(customerId);
    if (detailMap[customerId]) return;
    setDetailLoading(customerId);
    try {
      const res = await fetch(`/api/dm/${dmId}/recipient-detail?customerId=${encodeURIComponent(customerId)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (res.ok && data.success) setDetailMap((prev) => ({ ...prev, [customerId]: data }));
      else toast.error(data?.error || '상세 조회에 실패했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '상세 조회 중 오류가 발생했습니다.');
    } finally {
      setDetailLoading(null);
    }
  };

  // 카드 [발송 추적] 진입 = 추적 탭 직행 + 자동 로드
  useEffect(() => {
    if (!show) return;
    if (initialView === 'track') { void loadTracking(); }
    else { setView('compose'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, initialView]);

  // ★ 2026-07-02(5) 변수 칩 커서 삽입용 textarea ref.
  //   ★ 2026-07-06 훅 규칙 fix — 조기 return(!show) 아래에 있어서 닫힘 렌더(훅 N개)와 열림 렌더(N+1개)의
  //   훅 개수가 달라져, 발송 버튼 클릭(show false→true) 순간 React가 크래시해 화면 전체가 백지가 되던 근본 원인.
  //   모든 훅은 반드시 조기 return 위에서 호출한다.
  const messageRef = useRef<HTMLTextAreaElement>(null);

  if (!show) return null;
  const token = () => localStorage.getItem('token');

  // ★ 2026-07-02(5) 변수 칩은 커서 위치에 삽입 (항상 끝에 붙던 결함 수정)
  const insertVar = (v: string) => {
    const el = messageRef.current;
    if (!el) { setMessageText((prev) => (prev ? `${prev} ${v}` : v)); return; }
    // 버튼 클릭으로 blur돼도 textarea의 마지막 selection 값은 보존된다
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setMessageText((prev) => prev.slice(0, start) + v + prev.slice(end));
    // 삽입 직후 커서를 삽입 텍스트 뒤로 이동 + 포커스 복귀
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + v.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // 미리보기 치환값 = 추출 타겟 샘플(실데이터, ‹ › 로 수신자별 확인). 타겟 미추출 시 중립 기본값.
  const samples = target?.samples || [];
  const sample = samples[Math.min(sampleIdx, Math.max(0, samples.length - 1))];

  // 샘플 고객 기준 변수 치환 — 미리보기·스팸테스트 공용 (검증 본문 = 실발송 본문 원칙)
  const substituteVars = (text: string, s: typeof sample | undefined, linkText: string) => {
    const vals: Record<string, string> = {
      '%고객명%': (s?.name || '').trim() || '고객',
      '%등급%': String(s?.grade || '').trim() || '일반',
      '%지역%': (s?.region || '').trim() || '-',
      '%DM링크%': linkText,
    };
    let out = text || '';
    for (const [k, val] of Object.entries(vals)) out = out.split(k).join(val);
    if (!text.includes('%DM링크%') && text.trim()) out = `${out}\n${linkText}`;
    return out;
  };

  // ★ 2026-07-02(5) 광고성이면 실발송과 동일하게 (광고)+무료수신거부 080까지 합성해 미리보기 —
  //   어떤 번호가 붙는지 발송 전에 눈으로 확인 (백엔드 buildAdMessage와 동일 형식)
  const previewBody = substituteVars(messageText, sample, 'https://hanjul.ai/dm(개인화)');
  const previewText = isAd && previewBody.trim()
    ? `(광고) ${previewBody}\n무료수신거부 ${opt080 || '(080 미등록 — 수신거부번호 설정 필요)'}`
    : previewBody;
  // ★ 2026-07-02(3) 스팸테스트 본문 = 첫 샘플 고객 치환본 (원본 변수 그대로 들어가던 결함 수정).
  //   링크는 실발송 개인화 링크와 같은 길이 구조의 자리값 — 바이트·스팸 판정 정확도 유지.
  const spamTestMessage = substituteVars(messageText, samples[0], 'https://hanjul.ai/api/dm/v/dm-XXXXXXX?r=XXXXXXXXXXXXXXXXXXXXXXXX');

  // ★ 2026-07-02(3) 프롬프트 = 선택 — 비워두면 편집된 DM 내용만으로 자동 생성 (백엔드가 DM 섹션 요약 주입)
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ prompt: prompt.trim(), length_mode: copyLen }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { toast.error(data?.error || '문안 생성에 실패했습니다.'); return; }
      const text = String(data.message || '').trim();
      if (!text) { toast.error('생성된 문안이 비어 있습니다. 다시 시도해주세요.'); return; }
      setMessageText(text);
      toast.success('문안을 생성했습니다. (3크레딧) 핸드폰 미리보기에서 확인하세요.');
    } catch (e: any) {
      toast.error(e?.message || '문안 생성 중 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDecorate = async () => {
    if (!messageText.trim()) { toast.warning('먼저 문안을 작성해주세요.'); return; }
    // ★ 2026-07-02(5) 하드코딩 3개 대신 선택된 고객사 보유 필드를 활용 컬럼으로 전송
    const vars = Array.from(decorateVars);
    if (vars.length === 0) { toast.warning('꾸미기에 활용할 필드를 1개 이상 선택해주세요.'); return; }
    setDecorating(true);
    try {
      const res = await fetch('/api/ai/operator/decorate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ message: messageText, selectedVars: vars, channel: 'lms', isAd }),
      });
      const data = await res.json();
      if (data.success) { setMessageText(String(data.message || messageText)); toast.success('꾸미기를 적용했습니다. (3크레딧)'); }
      else toast.error(data.error || 'AI 꾸미기에 실패했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '꾸미기 중 오류가 발생했습니다.');
    } finally {
      setDecorating(false);
    }
  };

  const openSpamTest = () => {
    if (!messageText.trim()) { toast.warning('먼저 문안을 작성해주세요.'); return; }
    // 개별 회신 모드는 스팸테스트에 기본 등록번호 사용 (테스트폰 발송용 대표 번호)
    if (!(isIndividualCb ? defaultRegisteredCb : callback)) { toast.error('등록된 발신번호가 없습니다. 발신번호 등록 후 이용해주세요.'); return; }
    setSpamOpen(true);
  };

  const applyAiTime = () => {
    // AI 추천 발송 시각 — 다음날 오전 10시(KST 근사, datetime-local 형식)
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setScheduleMode('ai');
  };

  const handleSend = async (confirmExclusion = false) => {
    const isResend = !!resendIds && resendIds.length > 0;
    if (!isResend && (!target || target.channelEligibleCount === 0)) { toast.warning('먼저 타겟을 추출해주세요.'); return; }
    if (!messageText.trim()) { toast.warning('문자 본문을 작성해주세요.'); return; }
    if (!callback) { toast.warning('발신번호를 선택해주세요. (발신번호 관리에서 등록)'); return; }
    if (isAd && opt080Loaded && !opt080) { toast.warning('광고성 발송은 무료수신거부(080) 번호가 필요합니다. 수신거부번호 설정에서 등록해주세요.'); return; }
    const scheduledAtVal = scheduleMode === 'immediate' ? null : scheduledAt;
    if (scheduleMode !== 'immediate' && !scheduledAtVal) { toast.warning('예약 시각을 선택해주세요.'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/send-to-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          // ★ 2026-07-06 재발송 모드 = 미열람 고객 id 지정(서버가 자격·수신거부 재적용) / 일반 = 타겟 filter
          ...(isResend
            ? { resendCustomerIds: resendIds }
            : { filter: target!.filter, allCustomers: !!target!.isAll }),
          messageText: messageText.trim(),
          isAd,
          // 개별 회신 = 고객별 등록매장 번호(store_phone) — 미등록 번호 고객은 백엔드 CT-08이 제외(확인 후 발송)
          callback: isIndividualCb ? undefined : callback,
          useIndividualCallback: isIndividualCb,
          confirmCallbackExclusion: confirmExclusion,
          scheduledAt: scheduledAtVal ? new Date(scheduledAtVal).toISOString() : null,
        }),
      });
      const data = await res.json();
      // 개별 회신 — 회신번호 미보유/미등록 고객 제외 확인 (직접발송과 동일 UX)
      if (res.ok && data?.callbackConfirmRequired) {
        const detail = (data.unregisteredDetails || []).slice(0, 5).map((d: any) => `${d.phone}(${d.excludedCount}명)`).join(', ');
        setConfirmState({
          mode: 'warning',
          title: '회신번호 없는 고객 제외',
          description: `${data.message}${detail ? `\n미등록 번호: ${detail}${(data.unregisteredDetails || []).length > 5 ? ' 외' : ''}` : ''}\n미등록 매장번호는 발신번호 관리에 등록하면 발송할 수 있습니다.`,
          confirmLabel: '제외하고 발송',
          onConfirm: () => { void handleSend(true); },
        });
        return;
      }
      if (!res.ok || !data.success) { toast.error(data?.error || '발송에 실패했습니다.'); return; }
      setSentCount(data.sent);
      toast.success(scheduledAtVal ? `${Number(data.sent).toLocaleString()}명 예약 완료.` : `${Number(data.sent).toLocaleString()}명에게 발송했습니다. 열람 현황은 DM 카드의 [발송 추적]에서 확인하세요.`);
      // ★ 2026-07-02(5) 발송 완료 = 창 닫기 (Harold 지시) — 토스트는 z-9990이라 닫힌 뒤에도 표시됨
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '발송 중 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[1240px] max-h-[95vh] overflow-hidden flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-white/10 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0"><Send className="w-4 h-4 text-white" /></div>
            <div>
              <h3 className="text-base font-bold text-white">DM 타겟 발송{dmTitle ? ` · ${dmTitle}` : ''}</h3>
              <p className="text-[11px] text-white/50">추출한 타겟에게 수신자별 개인화 링크 문자를 보냅니다</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 pt-3 flex gap-1">
          <button onClick={() => setView('compose')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'compose' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}>발송</button>
          <button onClick={loadTracking} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'track' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}>발송 추적</button>
        </div>

        {view === 'compose' ? (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* 왼쪽 — 타겟 + 편집 */}
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  {resendIds && resendIds.length > 0 ? (
                    /* ★ 2026-07-06 미열람자 재발송 모드 — 타겟 추출 대신 미열람 고객 지정. 문구를 바꿔 보내면 열람률이 오릅니다. */
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] text-cyan-300/80 font-semibold">미열람자 재발송</p>
                        <p className="text-2xl font-bold text-cyan-300">{resendIds.length.toLocaleString()}<span className="text-sm font-normal text-white/50 ml-1">명</span></p>
                        <p className="text-[10px] text-white/40 mt-0.5">그 사이 수신거부한 고객은 발송 시 자동 제외됩니다. 문구를 바꿔 보내는 것을 권장합니다.</p>
                      </div>
                      <button onClick={() => setResendIds(null)} className="text-[11px] text-white/50 hover:text-white">재발송 해제</button>
                    </div>
                  ) : target ? (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] text-white/40">발송 가능 대상</p>
                        <p className="text-2xl font-bold text-emerald-300">{target.channelEligibleCount.toLocaleString()}<span className="text-sm font-normal text-white/50 ml-1">명</span></p>
                      </div>
                      <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200">다시 추출</button>
                    </div>
                  ) : (
                    <button onClick={() => setExtractOpen(true)} className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 flex items-center justify-center gap-2"><Sparkles className="w-4 h-4" /> 1. 타겟 추출</button>
                  )}
                </div>

                {/* 문안 2모드 */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex gap-1">
                    <button onClick={() => setMode('ai')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'ai' ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white' : 'bg-white/5 text-white/50'}`}>AI 문안 생성</button>
                    <button onClick={() => setMode('direct')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'direct' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/50'}`}>직접 입력</button>
                  </div>

                  {mode === 'ai' && (
                    <div>
                      <p className="text-[10px] text-violet-200/70 mb-1.5">편집해 둔 DM 내용(행사·쿠폰·상품)을 AI가 읽고 문안을 만듭니다 — 프롬프트 없이 바로 생성하세요.</p>
                      {/* ★ 2026-07-07(4) SMS 우선 옵션 — hlj.kr 단축링크(22자)로 90바이트 단문 발송 가능 (원가 절감) */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] text-white/40">길이</span>
                        {([['lms', 'LMS 여유 (80~250자)'], ['sms', 'SMS 짧게 (90바이트·저단가)']] as const).map(([v, label]) => (
                          <button
                            key={v}
                            onClick={() => setCopyLen(v)}
                            className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${copyLen === v ? 'bg-violet-500/30 border-violet-400/50 text-white' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="추가 요청 (선택) — 예: 정중한 톤으로, 마감 강조" className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60 resize-none" />
                      <button onClick={handleGenerate} disabled={generating} className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 flex items-center justify-center gap-1.5">
                        {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{generating ? '생성 중...' : '편집된 DM 내용으로 AI 문안 생성'}
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-white/60 mb-1 block">문자 본문 {mode === 'ai' ? '(생성 후 편집 가능)' : ''}</label>
                    <textarea ref={messageRef} value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={5} placeholder="문안을 작성하거나 AI로 생성하세요. %DM링크% 위치에 수신자별 개인화 링크가 들어갑니다." className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400/60 resize-none" />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {insertChips.map((v) => (
                        <button key={v} onClick={() => insertVar(v)} title="커서 위치에 삽입" className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${v === '%DM링크%' ? 'border-fuchsia-400/40 text-fuchsia-200 bg-fuchsia-500/10' : 'border-white/10 text-white/60 bg-white/5 hover:bg-white/10'}`}>{v}</button>
                      ))}
                    </div>
                  </div>

                  {/* ★ 2026-07-02(5) 꾸미기 활용 필드 — 고객사 보유 필드 별도 선택(본문에 쓰인 필드 자동 선택 + 추가 토글). AI 오퍼레이터 '활용 가능 컬럼' 미러. */}
                  <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0"><Wand2 className="w-3.5 h-3.5 text-white" /></div>
                        <div>
                          <p className="text-[11px] font-bold text-white">꾸미기에 활용할 필드</p>
                          <p className="text-[9.5px] text-white/45">본문에 쓴 필드는 자동 선택 · 더 넣을 필드를 골라 AI가 자연스럽게 녹입니다{decorateVars.size > 0 ? ` · ${decorateVars.size}개 선택` : ''}</p>
                        </div>
                      </div>
                      <button onClick={handleDecorate} disabled={decorating || decorateVars.size === 0} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"><Wand2 className="w-3.5 h-3.5" />{decorating ? '꾸미는 중...' : 'AI 꾸미기'}</button>
                    </div>
                    {companyFields.length === 0 ? (
                      <p className="text-[10px] text-white/40">고객 데이터가 있어야 개인화 필드가 표시됩니다. (고객DB 업로드 후 이용)</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {companyFields.map((f) => {
                          const on = decorateVars.has(f.token);
                          return (
                            <button
                              key={f.token}
                              onClick={() => setDecorateVars((prev) => { const n = new Set(prev); if (n.has(f.token)) n.delete(f.token); else n.add(f.token); return n; })}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all ${on ? 'bg-violet-500/30 text-violet-100 border-violet-400/50' : 'bg-white/5 text-white/55 border-white/10 hover:bg-white/10 hover:text-white/80'}`}
                            >
                              %{f.label}%
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 툴바 */}
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => { if (!messageText.trim()) { toast.warning('먼저 문안을 작성해주세요.'); return; } setRefineOpen(true); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"><Sparkles className="w-3.5 h-3.5" />다듬기</button>
                    <button onClick={openSpamTest} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"><ShieldCheck className="w-3.5 h-3.5" />스팸테스트</button>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                    <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="rounded" /> 광고성 메시지 — (광고)·무료수신거부 자동 표기
                    {isAd && (
                      <span className={`font-mono ${opt080 ? 'text-emerald-300/90' : 'text-amber-300/90'}`}>
                        {opt080 ? opt080 : opt080Loaded ? '080 미등록' : ''}
                      </span>
                    )}
                  </label>
                </div>

                {/* ★ 2026-07-02(3) 발송 시각·발신번호는 항상 보이는 하단 푸터로 이동 (스크롤에 묻히던 문제) */}
              </div>

              {/* 오른쪽 — 핸드폰 미리보기 (수신자별 개인화 확인) */}
              <div className="flex flex-col items-center">
                <div className="mb-2 flex items-center gap-2 flex-wrap justify-center">
                  <p className="text-[11px] text-white/50 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> 핸드폰 미리보기</p>
                  {samples.length > 0 && (
                    <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-1.5 py-0.5">
                      <button onClick={() => setSampleIdx((i) => (i - 1 + samples.length) % samples.length)} className="px-1 text-white/60 hover:text-white text-xs" aria-label="이전 수신자">‹</button>
                      <span className="text-[10px] text-violet-200 font-semibold whitespace-nowrap">
                        {(sample?.name || '').trim() || '이름 없음'} ({Math.min(sampleIdx + 1, samples.length)}/{samples.length})
                      </span>
                      <button onClick={() => setSampleIdx((i) => (i + 1) % samples.length)} className="px-1 text-white/60 hover:text-white text-xs" aria-label="다음 수신자">›</button>
                    </div>
                  )}
                </div>
                <div className="w-full max-w-[380px] rounded-[34px] border-4 border-slate-700 bg-slate-950 p-4 shadow-2xl">
                  <div className="h-6 flex items-center justify-center"><div className="w-20 h-1.5 rounded-full bg-slate-700" /></div>
                  <div className="mt-2 min-h-[500px] bg-slate-800/50 rounded-2xl p-4">
                    <div className="max-w-[92%] bg-white text-slate-900 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow">
                      {previewText || <span className="text-slate-400">문안을 작성하면 여기에 미리보기가 나타납니다.</span>}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-white/30 italic mt-2 text-center">
                  {target
                    ? `발송 시 ${target.channelEligibleCount.toLocaleString()}명 각각 본인 이름·등급·지역 + 개인화 링크로 치환되어 나갑니다 — ‹ › 로 수신자별 확인`
                    : 'Data source — 타겟 추출 후 수신자별 개인화 미리보기가 표시됩니다'}
                </p>
                {sentCount !== null && (
                  <div className="mt-3 w-full rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">{sentCount.toLocaleString()}명 처리 완료. '발송 추적'에서 열람 현황을 볼 수 있어요.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loadingTrack ? (
              <div className="py-12 flex justify-center text-white/50"><RefreshCw className="w-6 h-6 animate-spin" /></div>
            ) : tracking ? (
              <>
                {/* 깔때기: 발송 → 열람 → 50% 도달 → 완독 → 클릭 */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] text-white/50">수신자별 열람 깊이 · 클릭 현황</p>
                  <div className="flex items-center gap-2">
                    {/* ★ 2026-07-06 미열람자 재발송 — 미열람 고객만 추려 발송 탭으로(문구 수정 후 발송, 비용은 일반 발송과 동일) */}
                    {tracking.recipients.some((r) => !r.viewed) && (
                      <button
                        onClick={() => {
                          const ids = tracking.recipients.filter((r) => !r.viewed).map((r) => r.customerId);
                          setResendIds(ids);
                          setView('compose');
                          toast.info(`미열람 ${ids.length.toLocaleString()}명이 발송 대상으로 지정되었습니다. 문구를 바꿔 발송해보세요.`);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-cyan-100 bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/30"
                      >
                        <Send className="w-3.5 h-3.5" /> 미열람자 재발송 ({tracking.recipients.filter((r) => !r.viewed).length.toLocaleString()}명)
                      </button>
                    )}
                    {/* ★ 2026-07-06 추적 CSV 다운로드 — 로드된 전체 수신자(서버 LIMIT 1000) 내보내기 */}
                    <button
                      onClick={() => {
                        downloadCsv(
                          safeCsvFilename(dmTitle || 'DM', 'DM_발송추적'),
                          ['이름', '전화번호', '발송 시각', '상태', '진행률(%)', '체류(초)', '클릭 수', '응모·액션', '재열람 횟수', '열람 기기 수', '구매 건수(7일)', '구매 금액(7일)', '마지막 활동'],
                          tracking.recipients.map((r) => [
                            r.name || '', r.phone || '', r.sentAt ? new Date(r.sentAt).toLocaleString('ko-KR') : '',
                            r.viewed ? (r.completed ? '완독' : '열람') : '미열람',
                            r.viewed ? (r.progressPct || 0) : '',
                            r.viewed ? r.durationSeconds : '',
                            r.clicks, r.responded ? 'Y' : '', r.openCount || '', r.deviceCount || '',
                            r.purchaseCount || '', r.purchaseAmount ? Math.round(Number(r.purchaseAmount)) : '',
                            r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleString('ko-KR') : '',
                          ]),
                        );
                        toast.success(`${tracking.recipients.length.toLocaleString()}건 CSV 다운로드 완료`);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                    <button onClick={loadTracking} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10">
                      <RefreshCw className="w-3.5 h-3.5" /> 새로고침
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                  {[
                    { l: '발송', v: tracking.summary.sent, c: 'text-white' },
                    { l: '열람', v: tracking.summary.viewed, c: 'text-cyan-300' },
                    { l: '50% 도달', v: tracking.summary.reached50 ?? 0, c: 'text-violet-300' },
                    { l: '완독', v: tracking.summary.completed, c: 'text-emerald-300' },
                    { l: '클릭', v: tracking.summary.clicked ?? 0, c: 'text-amber-300' },
                    { l: '응모·액션', v: tracking.summary.responded ?? 0, c: 'text-fuchsia-300' },
                    { l: '구매 전환', v: tracking.summary.purchased ?? 0, c: 'text-rose-300', sub: (tracking.summary.purchaseAmount || 0) > 0 ? `${Math.round(Number(tracking.summary.purchaseAmount)).toLocaleString()}원` : undefined },
                  ].map((m: any) => (
                    <div key={m.l} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                      <p className="text-[10px] text-white/40">{m.l}</p>
                      <p className={`text-xl font-bold ${m.c}`}>{Number(m.v).toLocaleString()}</p>
                      {m.sub && <p className="text-[9.5px] text-rose-200/70">{m.sub}</p>}
                    </div>
                  ))}
                </div>
                {((tracking.summary.reViewed ?? 0) > 0 || (tracking.summary.multiDevice ?? 0) > 0) && (
                  <p className="text-[10.5px] text-white/45">
                    재열람 {Number(tracking.summary.reViewed || 0).toLocaleString()}명
                    {(tracking.summary.multiDevice ?? 0) > 0 && <> · 여러 기기에서 열람 {Number(tracking.summary.multiDevice || 0).toLocaleString()}명 <span className="text-cyan-300/70">(지인 공유 가능성)</span></>}
                  </p>
                )}
                <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5 max-h-[52vh] overflow-y-auto">
                  {tracking.recipients.length === 0 ? (
                    <p className="text-xs text-white/40 p-4 text-center">아직 발송 이력이 없습니다.</p>
                  ) : tracking.recipients.map((r) => {
                    const isOpen = expandedId === r.customerId;
                    const detail = detailMap[r.customerId];
                    return (
                      <div key={r.customerId}>
                        <div
                          onClick={() => { void toggleDetail(r.customerId); }}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] cursor-pointer transition-colors ${isOpen ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                        >
                          <span className={`text-[9px] text-white/40 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                          <span className="text-white/80 w-20 truncate">{r.name || '-'}</span>
                          <span className="text-white/40 font-mono w-28 truncate">{r.phone || '-'}</span>
                          {r.viewed ? (
                            <>
                              <span className="flex items-center gap-1.5 flex-1 min-w-[110px]">
                                <span className="flex-1 max-w-[140px] h-1.5 rounded-full bg-white/10 overflow-hidden">
                                  <span className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${Math.min(100, Math.max(2, r.progressPct || 0))}%` }} />
                                </span>
                                <span className="text-white/60 w-9 text-right">{r.progressPct || 0}%</span>
                              </span>
                              <span className="text-white/50 w-16 text-right">{formatDur(r.durationSeconds)}</span>
                              <span className={`w-12 text-right ${r.clicks > 0 ? 'text-amber-300 font-semibold' : 'text-white/30'}`}>{r.clicks > 0 ? `클릭 ${r.clicks}` : '-'}</span>
                              {r.responded && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/30 font-semibold">응모</span>}
                              {/* ★ 2026-07-06 재열람·공유·구매 신호 */}
                              {(r.openCount ?? 0) > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-200 border border-cyan-400/25">재열람 ×{r.openCount}</span>}
                              {(r.deviceCount ?? 0) > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-200 border border-sky-400/25" title="여러 기기에서 열람 — 지인 공유 가능성">기기 {r.deviceCount}</span>}
                              {(r.purchaseCount ?? 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-200 border border-rose-400/30 font-semibold" title={`발송 후 7일 내 구매 ${r.purchaseCount}건`}>구매 {Math.round(Number(r.purchaseAmount || 0)).toLocaleString()}원</span>}
                              <span className="text-white/30 w-16 text-right hidden md:inline">{formatAgo(r.lastActiveAt)}</span>
                              <span className={`w-12 text-right font-medium ${r.completed ? 'text-emerald-300' : 'text-cyan-300'}`}>{r.completed ? '완독' : '열람'}</span>
                            </>
                          ) : (
                            <span className="ml-auto flex items-center gap-2">
                              {(r.purchaseCount ?? 0) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-200 border border-rose-400/30 font-semibold" title={`발송 후 7일 내 구매 ${r.purchaseCount}건 (열람 없이 구매)`}>구매 {Math.round(Number(r.purchaseAmount || 0)).toLocaleString()}원</span>}
                              <span className="font-medium text-white/30">미열람</span>
                            </span>
                          )}
                        </div>
                        {/* ★ 2026-07-02(5) 수신자 상세 — 섹션 여정(본 곳·누른 버튼) + 열람 요약 + 응답·액션 이력 */}
                        {isOpen && (
                          <div className="px-4 pb-3 pt-2 bg-white/[0.02] border-t border-white/5">
                            {detailLoading === r.customerId ? (
                              <div className="py-4 flex justify-center text-white/40"><RefreshCw className="w-4 h-4 animate-spin" /></div>
                            ) : detail ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[10px] font-semibold text-white/50 mb-1.5">섹션 여정 — 본 곳과 누른 버튼</p>
                                  <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
                                    {(detail.sections || []).map((s: any) => (
                                      <div key={s.id} className={`rounded-lg px-2.5 py-1.5 border ${(s.views > 0 || s.clicks > 0) ? 'border-white/10 bg-white/5' : 'border-white/5 opacity-45'}`}>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10.5px] text-white/80 flex-1 truncate">{s.label}</span>
                                          <span className={`text-[10px] ${s.views > 0 ? 'text-cyan-300' : 'text-white/25'}`}>조회 {s.views}</span>
                                          <span className={`text-[10px] ${s.clicks > 0 ? 'text-amber-300 font-semibold' : 'text-white/25'}`}>클릭 {s.clicks}</span>
                                        </div>
                                        {s.elements && Object.keys(s.elements).length > 0 && (
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {Object.entries(s.elements as Record<string, number>).map(([label, n]) => (
                                              <span key={label} className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-200 border border-amber-400/25">{label} ×{String(n)}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div>
                                    <p className="text-[10px] font-semibold text-white/50 mb-1.5">열람 요약</p>
                                    {detail.view ? (
                                      <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[10.5px] text-white/70 space-y-0.5">
                                        <p>첫 열람 {new Date(detail.view.viewedAt).toLocaleString('ko-KR')} · 마지막 활동 {formatAgo(detail.view.lastActiveAt) || '-'}</p>
                                        <p>체류 {formatDur(detail.view.durationSeconds)} · 도달 깊이 {detail.view.progressPct}%{detail.view.completed ? ' · 완독' : ''}</p>
                                      </div>
                                    ) : <p className="text-[10.5px] text-white/35">아직 열람 전입니다.</p>}
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold text-white/50 mb-1.5">응답·액션 이력</p>
                                    {(detail.responses || []).length === 0 ? (
                                      <p className="text-[10.5px] text-white/35">응모·투표·쿠폰 등 액션 기록이 없습니다.</p>
                                    ) : (
                                      <div className="space-y-1 max-h-[170px] overflow-y-auto pr-1">
                                        {detail.responses.map((resp: any, i: number) => (
                                          <div key={i} className="rounded-lg border border-fuchsia-400/20 bg-fuchsia-500/5 px-2.5 py-1.5 flex items-center gap-2">
                                            <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/30 font-semibold flex-shrink-0">{resp.typeLabel}</span>
                                            <span className="text-[10.5px] text-white/75 flex-1 truncate">{resp.summary}</span>
                                            <span className="text-[9.5px] text-white/35 flex-shrink-0">{new Date(resp.occurredAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10.5px] text-white/35 py-2 text-center">상세를 불러오지 못했습니다.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* ★ 2026-07-06 열람 시간대 + 섹션 이탈 지점 — 다음 발송·콘텐츠 개선 참고 (데이터 있을 때만) */}
                {((tracking.hourDistribution?.length || 0) > 0 || (tracking.sectionExits?.length || 0) > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(tracking.hourDistribution?.length || 0) > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <p className="text-[10px] font-semibold text-white/50 mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> 열람이 많은 시간대</p>
                        <div className="flex flex-wrap gap-1.5">
                          {tracking.hourDistribution!.slice(0, 3).map((h) => (
                            <span key={h.hour} className="text-[10.5px] px-2 py-1 rounded-lg bg-violet-500/15 text-violet-200 border border-violet-400/25">{h.hour}시 <strong>{h.cnt}</strong>건</span>
                          ))}
                        </div>
                        <p className="text-[9.5px] text-white/35 mt-1.5">다음 발송은 {tracking.hourDistribution![0].hour}시 전후를 권장합니다 · Data source — dm_views 열람 시각(KST)</p>
                      </div>
                    )}
                    {(tracking.sectionExits?.length || 0) > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <p className="text-[10px] font-semibold text-white/50 mb-1.5">이탈이 많은 섹션 (완독 실패 지점)</p>
                        <div className="space-y-1">
                          {tracking.sectionExits!.slice(0, 3).map((s) => (
                            <div key={s.id} className="flex items-center justify-between text-[10.5px]">
                              <span className="text-white/70 truncate flex-1">{s.label}</span>
                              <span className="text-rose-300 font-semibold ml-2">{s.count}명 이탈</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[9.5px] text-white/35 mt-1.5">이 섹션 다음 내용을 다듬으면 완독률이 오릅니다 · Data source — section_interactions</p>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-white/30 italic text-center">행을 클릭하면 섹션 여정·버튼 클릭·응답 상세가 열립니다 · Data source — dm_recipient_tokens × dm_views × dm_event_responses</p>
              </>
            ) : (
              <p className="text-xs text-white/40 text-center py-8">추적 데이터를 불러오는 중입니다.</p>
            )}
          </div>
        )}

        {view === 'compose' && (
          <div className="px-5 py-3 border-t border-white/10 bg-slate-950/60 flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* 발신번호 선택 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/40 whitespace-nowrap">발신번호</span>
              <select
                value={callback}
                onChange={(e) => setCallback(e.target.value)}
                className="bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400/60"
              >
                {callbackList.length === 0
                  ? <option value="">등록된 번호 없음</option>
                  : callbackList.map((cb) => <option key={cb.phone} value={cb.phone}>{cb.phone}{cb.isDefault ? ' (기본)' : ''}</option>)}
                <option value={INDIVIDUAL_CB}>고객별 매장번호 (개별 회신)</option>
              </select>
            </div>
            {/* 발송 시각 — 즉시 / 직접 예약 / AI 추천 */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-white/40 flex items-center gap-1 whitespace-nowrap"><Clock className="w-3 h-3" /> 발송 시각</span>
              <button onClick={() => setScheduleMode('immediate')} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${scheduleMode === 'immediate' ? 'bg-indigo-500/40 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>즉시</button>
              <button onClick={() => setScheduleMode('manual')} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${scheduleMode === 'manual' ? 'bg-indigo-500/40 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>직접 예약</button>
              <button onClick={applyAiTime} title="AI 추천 — 내일 오전 10시" className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${scheduleMode === 'ai' ? 'bg-violet-500/40 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>AI 추천</button>
              {scheduleMode !== 'immediate' && (
                <DateTimeField
                  value={localInputToIso(scheduledAt)}
                  onChange={(iso) => { setScheduledAt(isoToLocalInput(iso)); setScheduleMode('manual'); }}
                  tone="dark"
                />
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-white/70 hover:bg-white/5">닫기</button>
              <button onClick={() => handleSend()} disabled={(resendIds && resendIds.length > 0 ? false : (!target || target.channelEligibleCount === 0)) || !messageText.trim() || sending} className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5">
                {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? '처리 중...'
                  : resendIds && resendIds.length > 0 ? `미열람 ${resendIds.length.toLocaleString()}명 재발송`
                  : scheduleMode === 'immediate' ? (target ? `${target.channelEligibleCount.toLocaleString()}명 발송` : '발송') : '예약 발송'}
              </button>
            </div>
          </div>
        )}

        <TargetExtractModal show={extractOpen} channel="dm" onClose={() => setExtractOpen(false)} onApply={(t) => { setTarget(t); setSampleIdx(0); setExtractOpen(false); }} />
        <AiRefineModal isOpen={refineOpen} originalMessage={messageText} onClose={() => setRefineOpen(false)} onApply={(text) => { setMessageText(text); setRefineOpen(false); }} />
        {spamOpen && (
          <SpamFilterTestModal onClose={() => setSpamOpen(false)} messageContentLms={spamTestMessage} callbackNumber={isIndividualCb ? defaultRegisteredCb : callback} messageType="LMS" subject={dmTitle} isAd={isAd} />
        )}
        <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      </div>
    </div>
  );
}
