/**
 * SpamFilterTestModal — 스팸 검사 창
 * ★ 2026-09-25 화면 개편(Harold "스팸필터테스트 검사 창도 너무 올드해" · 목업 승인)
 *   - 상태 카드(60초 원형 타이머 · 통과/막힘/결과 없음과 다음 할 일) · 통신사별 한 줄(도착 시간) · 지난 검사(통신사 색 점)
 *   - 무료 체험(미가입 3회 · 차감 0) / 유료(테스트 문자 발송 요금 청구) 한 줄 · 진행 중 중복·잔액 부족을 같은 카드 안에서 안내
 *   - 판정 규칙·API·폴링·타이머·이력 조회는 원본 그대로(화면만 바꿨다). 창을 여는 곳 4곳(대시보드·자동발송·모바일 DM·여정)의
 *     넘기는 값은 그대로이고, `onEdit`만 선택으로 더했다(없으면 [글 고치러 가기] = 닫기).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Ban, Check, ChevronDown, Loader2, Play, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { formatPhoneNumber, replaceDirectVars, buildAdSubjectFront } from '../utils/formatDate';
import { carrierLabel, fetchSendCheckStatus, type SendCheckStatus } from '../utils/send-checks';

interface SpamFilterTestModalProps {
  onClose: () => void;
  messageContentSms?: string;
  messageContentLms?: string;
  callbackNumber: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  isAd?: boolean;
  firstRecipient?: Record<string, any>;
  /** ★ 2026-09-25 막혔을 때 [글 고치러 가기] — 없으면 창만 닫는다 */
  onEdit?: () => void;
}

interface TestResult {
  carrier: string;
  message_type: string;
  received: boolean;
  received_at: string | null;
  result: 'received' | 'blocked' | 'timeout' | 'failed' | null;
}

interface TestHistoryItem {
  id: string;
  callback_number: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  message_content_sms: string | null;
  message_content_lms: string | null;
  user_name: string;
  received_count: number;
  total_count: number;
  source?: string | null;
  results?: { carrier: string; received: boolean; result: string | null }[];
}

type ErrorKind = 'dup' | 'money' | 'trial' | 'generic';

const CARRIERS = ['SKT', 'KT', 'LGU'];

export default function SpamFilterTestModal({
  onClose,
  messageContentSms,
  messageContentLms,
  callbackNumber,
  messageType,
  subject,
  isAd,
  firstRecipient,
  onEdit,
}: SpamFilterTestModalProps) {
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<'ready' | 'testing' | 'completed'>('ready');
  const [testId, setTestId] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [countdown, setCountdown] = useState(60);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic');
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'test' | 'history'>('test');
  const [history, setHistory] = useState<TestHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<{ test: any; results: TestResult[] } | null>(null);
  const [checkStatus, setCheckStatus] = useState<SendCheckStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 서버 시작 시간 기준 타이머용
  const serverCreatedAtRef = useRef<number | null>(null);
  // ★2026-09-25 도착 시간 표시용 — 서버 시각끼리만 뺀다(타이머 기준과 섞지 않는다 · 시계 차이 방지)
  const serverTestCreatedRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  // 서버 created_at 기준 남은 초 계산
  const calcRemaining = useCallback(() => {
    if (!serverCreatedAtRef.current) return 0;
    const elapsed = Date.now() - serverCreatedAtRef.current;
    return Math.max(0, Math.ceil((60000 - elapsed) / 1000));
  }, []);

  // 서버 시간 기반 카운트다운 시작
  const startServerBasedCountdown = useCallback(() => {
    // 즉시 한번 계산
    setCountdown(calcRemaining());

    countdownRef.current = setInterval(() => {
      const remaining = calcRemaining();
      setCountdown(remaining);
      if (remaining <= 0) {
        clearTimers();
        setStatus('completed');
      }
    }, 1000);
  }, [calcRemaining, clearTimers]);

  // 폴링 시작
  const startPolling = useCallback((id: string) => {
    pollRef.current = setInterval(() => pollResults(id), 2000);
  }, []);

  // 모달 열릴 때 active 테스트 확인 + ★2026-09-25 체험/청구 안내용 현황
  useEffect(() => {
    checkActiveTest();
    fetchSendCheckStatus().then((st) => { if (st) setCheckStatus(st); });
    return () => clearTimers();
  }, []);

  // ESC 닫기(한글 조합 중 ESC는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const checkActiveTest = async () => {
    try {
      const res = await fetch('/api/spam-filter/active-test', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.active && data.testId) {
        // 진행 중인 테스트 복원
        setTestId(data.testId);
        setResults(data.results || []);
        setTotalCount(data.results?.length || 0);
        setStatus('testing');

        // 서버 시간 기준 타이머 설정
        serverCreatedAtRef.current = new Date(data.createdAt).getTime();
        serverTestCreatedRef.current = serverCreatedAtRef.current;
        setCountdown(data.remainingSeconds || calcRemaining());

        // 폴링 + 카운트다운 재개
        startPolling(data.testId);
        startServerBasedCountdown();
      }
    } catch (err) {
      console.error('active 테스트 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  // 상태 초기화 (재테스트용)
  const resetForRetest = useCallback(() => {
    clearTimers();
    setStatus('ready');
    setTestId(null);
    setResults([]);
    setCountdown(60);
    setError('');
    setTotalCount(0);
    serverCreatedAtRef.current = null;
    serverTestCreatedRef.current = null;
  }, [clearTimers]);

  // 본인 테스트 이력 조회
  const fetchHistory = async (page = 1) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/spam-filter/tests?mine=true&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setHistory(data.tests || []);
      setHistoryPage(data.page || 1);
      setHistoryTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error('이력 조회 실패:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // 이력 상세 (통신사별 결과) 조회
  const fetchHistoryDetail = async (testId: string) => {
    if (expandedHistoryId === testId) {
      setExpandedHistoryId(null);
      setHistoryDetail(null);
      return;
    }
    try {
      const res = await fetch(`/api/spam-filter/tests/${testId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setExpandedHistoryId(testId);
      setHistoryDetail({ test: data.test, results: data.results || [] });
    } catch (err) {
      console.error('상세 조회 실패:', err);
    }
  };

  // 이력 탭 전환 시 조회
  useEffect(() => {
    if (activeTab === 'history') fetchHistory(1);
  }, [activeTab]);

  const startTest = async () => {
    if (!callbackNumber) { setErrorKind('generic'); setError('발신번호가 선택되지 않았습니다.'); return; }
    if (!messageContentSms && !messageContentLms) { setErrorKind('generic'); setError('메시지를 입력해주세요.'); return; }
    setStatus('testing'); setError('');
    clearTimers();

    try {
      const res = await fetch('/api/spam-filter/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ callbackNumber, messageContentSms: messageContentSms || null, messageContentLms: messageContentLms || null, messageType, subject: subject || null, firstRecipient: firstRecipient || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) { setErrorKind('dup'); setError(data.message || data.error || '이미 진행 중인 테스트가 있습니다.'); }
        else if (res.status === 402 || data.insufficientBalance) { setErrorKind('money'); setError(data.error || '잔액이 부족합니다.'); }
        else if (data.code === 'SPAM_TRIAL_EXHAUSTED') { setErrorKind('trial'); setError(data.error || '무료 스팸 검사를 모두 쓰셨어요.'); }
        else { setErrorKind('generic'); setError(data.error || '테스트 요청에 실패했습니다.'); }
        setStatus('ready'); return;
      }
      setTestId(data.testId);
      setTotalCount(data.totalCount);

      // 서버 시간 = 지금
      serverCreatedAtRef.current = Date.now();

      // 폴링 + 서버 시간 기반 카운트다운
      startPolling(data.testId);
      startServerBasedCountdown();
      // 체험 횟수 갱신
      fetchSendCheckStatus().then((st) => { if (st) setCheckStatus(st); });

    } catch (err) { setErrorKind('generic'); setError('네트워크 오류가 발생했습니다.'); setStatus('ready'); }
  };

  const pollResults = async (id: string) => {
    try {
      const res = await fetch(`/api/spam-filter/tests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.results) setResults(data.results);
      if (data.test?.created_at) serverTestCreatedRef.current = new Date(data.test.created_at).getTime();
      if (data.test?.status === 'completed') {
        clearTimers();
        setStatus('completed');
      }
    } catch (err) { console.error('폴링 오류:', err); }
  };

  // ── 판정(원본 규칙 그대로) ──
  const receivedCount = results.filter(r => r.received).length;
  const blockedList = status === 'completed' ? results.filter(r => r.result === 'blocked') : [];
  const missingList = status === 'completed' ? results.filter(r => !r.received && (r.result === 'timeout' || r.result === 'failed' || r.result == null)) : [];
  const verdict: 'ready' | 'run' | 'pass' | 'block' | 'warn' =
    status === 'ready' ? 'ready'
      : status === 'testing' ? 'run'
        : blockedList.length > 0 ? 'block'
          : missingList.length > 0 ? 'warn'
            : 'pass';
  const namesOf = (rows: TestResult[]) => [...new Set(rows.map((r) => carrierLabel(r.carrier)))].join(' · ');

  // ★ D97: 미리보기 변수 치환 — replaceDirectVars 컨트롤타워 사용 (인라인 금지)
  const rawPreview = messageContentSms || messageContentLms || '';
  const previewMessage = firstRecipient
    ? replaceDirectVars(rawPreview, firstRecipient, callbackNumber)
    : rawPreview;
  const typeLabel = messageType === 'SMS' ? '단문(SMS)' : messageType === 'LMS' ? '장문(LMS)' : '사진(MMS)';
  const trial = checkStatus?.spamTrial;
  const isTrial = !!trial?.eligible;

  const laneOf = (carrier: string) => {
    const r = results.find((x) => x.carrier === carrier);
    if (status === 'ready' || !r) return { cls: 'wait', chip: '대기', sub: '검사를 시작하면 이 번호로 보내요' };
    if (r.received) {
      const at = r.received_at ? new Date(r.received_at).getTime() : null;
      const base = serverTestCreatedRef.current;
      const sec = at && base ? Math.max(0, (at - base) / 1000) : null;
      return { cls: 'ok', chip: '받았어요', sub: sec != null ? `보낸 뒤 ${sec.toFixed(1)}초 만에 도착` : '테스트폰에 도착했어요' };
    }
    if (status === 'completed') {
      if (r.result === 'blocked') return { cls: 'block', chip: '막혔어요', sub: '통신사는 전달했는데 휴대폰에 오지 않았어요' };
      if (r.result === 'failed') return { cls: 'block', chip: '전달 실패', sub: '통신사가 문자를 받지 않았어요' };
      return { cls: 'warn', chip: '결과 없음', sub: '60초 안에 통신사 결과가 오지 않았어요' };
    }
    return { cls: 'run', chip: '확인 중', sub: '테스트폰이 받는지 보고 있어요' };
  };

  // 로딩 중 표시
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]">
        <div className="bg-white rounded-2xl shadow-2xl px-7 py-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
          <span className="text-stone-600 text-sm">검사 상태를 확인하고 있어요</span>
        </div>
      </div>
    );
  }

  const ringR = 24;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className="fixed inset-0 bg-stone-900/55 flex items-center justify-center z-[2000] p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sft-title">
      <div className="sft bg-white rounded-[20px] shadow-2xl w-full max-w-[780px] max-h-[calc(100vh-24px)] overflow-hidden flex flex-col">
        {/* 머리 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-100">
          <span className="w-10 h-10 rounded-xl bg-amber-500 text-white grid place-items-center shadow-[0_6px_14px_-6px_rgba(245,158,11,0.7)] shrink-0">
            <ShieldCheck className="w-5 h-5" strokeWidth={2.1} />
          </span>
          <div className="min-w-0">
            <h3 id="sft-title" className="text-base font-extrabold text-stone-900">스팸 검사</h3>
            <p className="text-xs text-stone-500 mt-0.5 break-keep">통신사 3사 테스트폰으로 실제로 보내 막히는지 확인해요</p>
          </div>
          <div className="ml-auto inline-flex bg-stone-100 rounded-[10px] p-[3px] gap-0.5 ring-1 ring-inset ring-stone-200 shrink-0">
            {(['test', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={`h-[30px] px-3 rounded-lg text-[12.5px] font-semibold transition-colors ${activeTab === t ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                {t === 'test' ? '검사' : '지난 검사'}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 rounded-lg grid place-items-center text-stone-400 hover:bg-stone-100 hover:text-stone-700 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeTab === 'test' ? (
          <div className="grid md:grid-cols-[250px_1fr] gap-5 p-5 overflow-y-auto">
            {/* 받는 사람 화면 */}
            <div className="hidden md:block">
              <div className="rounded-[26px] p-1.5 bg-stone-100 ring-1 ring-inset ring-stone-200 h-full">
                <div className="bg-white rounded-[21px] overflow-hidden flex flex-col min-h-[400px] h-full shadow-sm">
                  <div className="px-3.5 pt-3 pb-2.5 border-b border-stone-100 text-center">
                    <b className="block text-[13px] tabular-nums">{formatPhoneNumber(callbackNumber) || '회신번호'}</b>
                    <small className="text-[10.5px] text-stone-400">{typeLabel} · 받는 사람 화면</small>
                  </div>
                  <div className="flex-1 p-3 bg-stone-50 overflow-y-auto">
                    <div className="bg-white border border-stone-200 rounded-[16px_16px_16px_4px] px-3 py-2.5 text-[12.5px] leading-[1.65] whitespace-pre-wrap break-keep [overflow-wrap:anywhere] text-stone-700">
                      {subject && (messageType === 'LMS' || messageType === 'MMS') && (
                        <b className="block text-stone-900 pb-1.5 mb-1.5 border-b border-stone-200">{buildAdSubjectFront(subject, messageType, isAd ?? false)}</b>
                      )}
                      {previewMessage || '메시지 없음'}
                    </div>
                  </div>
                  <div className="px-2 py-2 text-center text-[10.5px] text-stone-400 border-t border-stone-100">
                    {firstRecipient ? '첫 번째 받는 사람 기준으로 변수를 채웠어요' : messageType}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 min-w-0">
              {/* 상태 카드 */}
              {error ? (
                <div className="rounded-2xl p-4 flex items-center gap-3.5 border border-rose-200 bg-rose-50">
                  <span className="w-14 h-14 rounded-2xl grid place-items-center bg-white text-rose-600 ring-1 ring-inset ring-rose-200 shrink-0"><AlertTriangle className="w-6 h-6" strokeWidth={2.2} /></span>
                  <div className="min-w-0">
                    <h4 className="text-[15px] font-extrabold leading-snug text-rose-700 break-keep">
                      {errorKind === 'dup' ? '진행 중인 스팸 검사가 있어요'
                        : errorKind === 'money' ? '잔액이 부족해 검사를 보내지 못했어요'
                          : errorKind === 'trial' ? '무료 스팸 검사를 모두 쓰셨어요'
                            : '검사를 시작하지 못했어요'}
                    </h4>
                    <p className="text-[12.5px] text-stone-600 mt-1 leading-relaxed break-keep">
                      {errorKind === 'dup' ? `${error} 검사는 1분 안에 끝나요. 잠시 뒤 다시 눌러 주세요.`
                        : errorKind === 'money' ? `테스트 문자 발송 요금이 필요해요. 충전한 뒤 다시 눌러 주세요. (${error})`
                          : error}
                    </p>
                  </div>
                </div>
              ) : verdict === 'run' ? (
                <div className="rounded-2xl p-4 flex items-center gap-3.5 border border-stone-200 bg-white">
                  <span className="relative w-14 h-14 grid place-items-center shrink-0">
                    <svg width="56" height="56" viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden>
                      <circle cx="28" cy="28" r={ringR} fill="none" stroke="#EFEDEB" strokeWidth="5" />
                      <circle cx="28" cy="28" r={ringR} fill="none" stroke="#F59E0B" strokeWidth="5" strokeLinecap="round"
                        strokeDasharray={ringC} strokeDashoffset={ringC * (1 - Math.max(0, Math.min(60, countdown)) / 60)}
                        style={{ transition: 'stroke-dashoffset .9s linear' }} />
                    </svg>
                    <span className="text-[15px] font-extrabold tabular-nums">{countdown}</span>
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-[16px] font-extrabold leading-snug break-keep">테스트폰이 받는지 보고 있어요</h4>
                    <p className="text-[12.5px] text-stone-600 mt-1 leading-relaxed break-keep">
                      <b className="tabular-nums">{totalCount || results.length || 3}</b>대 중 <b className="tabular-nums">{receivedCount}</b>대가 받았어요. 창을 닫아도 검사는 계속되고, 다시 열면 이어서 보여요.
                    </p>
                  </div>
                </div>
              ) : verdict === 'pass' ? (
                <div className="rounded-2xl p-4 flex items-center gap-3.5 border border-emerald-200 bg-emerald-50">
                  <span className="w-14 h-14 rounded-2xl grid place-items-center bg-emerald-600 text-white shrink-0"><Check className="w-7 h-7" strokeWidth={2.6} /></span>
                  <div className="min-w-0">
                    <h4 className="text-[16px] font-extrabold leading-snug text-emerald-800 break-keep">3사 테스트폰이 모두 받았어요</h4>
                    <p className="text-[12.5px] text-stone-600 mt-1 leading-relaxed break-keep">이 글은 이번 검사에서 막히지 않았어요.</p>
                  </div>
                </div>
              ) : verdict === 'block' ? (
                <div className="rounded-2xl p-4 flex items-center gap-3.5 border border-rose-200 bg-rose-50">
                  <span className="w-14 h-14 rounded-2xl grid place-items-center bg-rose-600 text-white shrink-0"><Ban className="w-6 h-6" strokeWidth={2.4} /></span>
                  <div className="min-w-0">
                    <h4 className="text-[16px] font-extrabold leading-snug text-rose-700 break-keep">{namesOf(blockedList)}에서 막혔어요</h4>
                    <p className="text-[12.5px] text-stone-600 mt-1 leading-relaxed break-keep">이대로 보내면 {namesOf(blockedList)} 고객에게는 도착하지 않을 수 있어요.</p>
                  </div>
                </div>
              ) : verdict === 'warn' ? (
                <div className="rounded-2xl p-4 flex items-center gap-3.5 border border-amber-200 bg-amber-50">
                  <span className="w-14 h-14 rounded-2xl grid place-items-center bg-amber-500 text-white shrink-0"><AlertTriangle className="w-6 h-6" strokeWidth={2.4} /></span>
                  <div className="min-w-0">
                    <h4 className="text-[16px] font-extrabold leading-snug text-amber-800 break-keep">{namesOf(missingList)} 결과를 받지 못했어요</h4>
                    <p className="text-[12.5px] text-stone-600 mt-1 leading-relaxed break-keep">통신사 사정으로 늦어질 때가 있어요. 잠시 뒤 다시 검사해 보세요.</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl p-4 flex items-center gap-3.5 border border-amber-200 bg-amber-50">
                  <span className="w-14 h-14 rounded-2xl grid place-items-center bg-amber-500 text-white shrink-0"><ShieldCheck className="w-7 h-7" strokeWidth={2.1} /></span>
                  <div className="min-w-0">
                    <h4 className="text-[16px] font-extrabold leading-snug break-keep">보내기 전에 막히는지 확인해 볼까요?</h4>
                    <p className="text-[12.5px] text-stone-600 mt-1 leading-relaxed break-keep">지금 글 그대로 SKT · KT · LG U+ 테스트폰에 한 통씩 보내요. 1분 안에 끝나요.</p>
                  </div>
                </div>
              )}

              {/* 통신사별 한 줄 */}
              {!(error && (errorKind === 'dup' || errorKind === 'money' || errorKind === 'trial')) && (
                <div className="border border-stone-200 rounded-[14px] overflow-hidden">
                  {CARRIERS.map((c, i) => {
                    const l = laneOf(c);
                    const chipCls = l.cls === 'ok' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : l.cls === 'block' ? 'bg-rose-50 text-rose-700 ring-rose-200'
                        : l.cls === 'warn' ? 'bg-amber-50 text-amber-800 ring-amber-200'
                          : l.cls === 'run' ? 'bg-amber-50 text-amber-700 ring-amber-200'
                            : 'bg-stone-100 text-stone-500 ring-transparent';
                    return (
                      <div key={c} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? 'border-t border-stone-100' : ''}`}>
                        <span className="w-[52px] h-8 rounded-[9px] bg-stone-100 grid place-items-center text-xs font-extrabold text-stone-700 shrink-0">{carrierLabel(c)}</span>
                        <div className="flex-1 min-w-0">
                          <b className="text-[13px] font-bold">{carrierLabel(c)} 테스트폰</b>
                          <small className="block text-[11.5px] text-stone-500 mt-0.5 break-keep">{l.sub}</small>
                          {l.cls === 'run' && (
                            <div className="h-1 rounded bg-stone-200 overflow-hidden mt-1.5"><i className="block h-full w-[30%] rounded bg-amber-400 animate-pulse" /></div>
                          )}
                        </div>
                        <span className={`inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-xs font-bold whitespace-nowrap ring-1 ring-inset shrink-0 ${chipCls}`}>
                          <span className={`w-[7px] h-[7px] rounded-full bg-current ${l.cls === 'run' ? 'animate-pulse' : ''}`} />{l.chip}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 보내는 양 · 요금 */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11.5px] text-stone-600 bg-stone-100 rounded-[7px] px-2 py-1">{messageType === 'SMS' ? '단문(SMS)' : '장문(LMS)'} <b className="text-stone-900">1통씩</b> · 통신사 3사 테스트폰</span>
                {checkStatus && (isTrial ? (
                  <span className="text-[11.5px] text-violet-700 bg-violet-50 ring-1 ring-inset ring-violet-200 rounded-[7px] px-2 py-1">
                    무료 체험 <b className="tabular-nums">{Math.max(0, trial?.remaining ?? 0)}</b>회 남음 · 차감 없음
                  </span>
                ) : (
                  <span className="text-[11.5px] text-stone-600 bg-stone-100 rounded-[7px] px-2 py-1">테스트 문자는 발송 요금으로 청구돼요</span>
                ))}
              </div>

              {verdict === 'block' && (
                <div className="border border-dashed border-rose-200 rounded-xl px-3 py-2.5 text-[12.5px] text-stone-700 leading-relaxed bg-white break-keep">
                  <b className="text-rose-700">이렇게 해 보세요</b> · 막힌 표현을 바꾼 뒤 [다시 검사]를 누르면 이 창에서 바로 비교돼요. 지난 결과는 [지난 검사]에 남아요.
                </div>
              )}

              <p className="text-[11px] text-stone-400 leading-relaxed break-keep">
                실제 통신사 판정을 미리 보는 참고 결과예요. 같은 글이라도 보내는 양과 시점에 따라 달라질 수 있어요.
                {messageType === 'MMS' && ' 사진은 스팸 판정에 영향이 없어 글만 보내요.'}
              </p>
            </div>
          </div>
        ) : (
          /* 지난 검사 */
          <div className="px-5 pt-4 pb-5 overflow-y-auto min-h-[300px]">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12 text-stone-500 text-sm gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-amber-500" />지난 검사를 불러오고 있어요
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-stone-400 text-sm">아직 한 스팸 검사가 없어요</div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {history.map((item) => {
                    const isExpanded = expandedHistoryId === item.id;
                    const rows = Array.isArray(item.results) ? item.results : [];
                    const blockedCnt = rows.filter((r) => r.result === 'blocked').length;
                    const missCnt = rows.filter((r) => !r.received && r.result !== 'blocked' && r.result !== 'pass').length;
                    const summary = item.status !== 'completed' ? '검사 중'
                      : blockedCnt > 0 ? `${rows.filter((r) => r.result === 'blocked').map((r) => carrierLabel(r.carrier)).join(' · ')} 막힘`
                        : missCnt > 0 ? '결과 없는 통신사 있음' : '3사 모두 받음';
                    const msgPreview = (item.message_content_lms || item.message_content_sms || '').replace(/\s+/g, ' ').slice(0, 80);
                    const d = new Date(item.created_at);
                    return (
                      <div key={item.id} className="border border-stone-200 rounded-xl overflow-hidden">
                        <button
                          type="button"
                          onClick={() => fetchHistoryDetail(item.id)}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 bg-white hover:bg-stone-50 text-left transition-colors"
                        >
                          <span className="w-[96px] shrink-0">
                            <b className="block text-[13px] font-bold tabular-nums">
                              {d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </b>
                            <small className={`text-[11px] ${blockedCnt > 0 ? 'text-rose-600' : 'text-stone-500'}`}>{summary}</small>
                          </span>
                          <span className="flex-1 min-w-0 text-[12.5px] text-stone-600 truncate">
                            {item.source === 'trial' && <span className="mr-1.5 text-[10.5px] font-bold text-violet-700 bg-violet-50 ring-1 ring-inset ring-violet-200 rounded px-1">무료 체험</span>}
                            {msgPreview || '(메시지 없음)'}
                          </span>
                          <span className="flex gap-1 shrink-0">
                            {CARRIERS.map((c) => {
                              const r = rows.find((x) => x.carrier === c);
                              const cls = !r ? 'bg-stone-100 text-stone-400'
                                : r.received || r.result === 'pass' ? 'bg-emerald-50 text-emerald-700'
                                  : r.result === 'blocked' ? 'bg-rose-50 text-rose-700'
                                    : 'bg-amber-50 text-amber-700';
                              return <i key={c} className={`not-italic w-[22px] h-[22px] rounded-[7px] grid place-items-center text-[9.5px] font-extrabold ${cls}`}>{c === 'LGU' ? 'LG' : c}</i>;
                            })}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>

                        {isExpanded && historyDetail && (
                          <div className="grid md:grid-cols-[1fr_190px] gap-3 px-3.5 py-3 border-t border-stone-100 bg-stone-50">
                            <div className="bg-white border border-stone-200 rounded-[10px] px-3 py-2.5 text-xs text-stone-700 whitespace-pre-wrap break-keep [overflow-wrap:anywhere] max-h-[140px] overflow-y-auto leading-relaxed">
                              {historyDetail.test.message_content_lms || historyDetail.test.message_content_sms || '(메시지 없음)'}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              {historyDetail.results.map((r: any, idx: number) => {
                                const chip = r.received ? ['받았어요', 'bg-emerald-50 text-emerald-700 ring-emerald-200']
                                  : r.result === 'blocked' ? ['막혔어요', 'bg-rose-50 text-rose-700 ring-rose-200']
                                    : r.result === 'failed' ? ['전달 실패', 'bg-rose-50 text-rose-700 ring-rose-200']
                                      : r.result === 'timeout' ? ['결과 없음', 'bg-amber-50 text-amber-800 ring-amber-200']
                                        : ['확인 중', 'bg-stone-100 text-stone-500 ring-transparent'];
                                return (
                                  <div key={idx} className="flex items-center justify-between text-xs font-semibold">
                                    <span>{carrierLabel(r.carrier)}</span>
                                    <span className={`inline-flex items-center gap-1.5 h-[24px] px-2 rounded-full text-[11px] font-bold ring-1 ring-inset ${chip[1]}`}>
                                      <span className="w-1.5 h-1.5 rounded-full bg-current" />{chip[0]}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {historyTotalPages > 1 && (
                  <div className="flex justify-center items-center gap-2 mt-4">
                    {historyPage > 1 && (
                      <button type="button" onClick={() => fetchHistory(historyPage - 1)} className="h-8 px-3 text-[12.5px] rounded-lg border border-stone-200 bg-white hover:bg-stone-50">이전</button>
                    )}
                    <span className="text-[12.5px] text-stone-500 tabular-nums">{historyPage} / {historyTotalPages}</span>
                    {historyPage < historyTotalPages && (
                      <button type="button" onClick={() => fetchHistory(historyPage + 1)} className="h-8 px-3 text-[12.5px] rounded-lg border border-stone-200 bg-white hover:bg-stone-50">다음</button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 아래 버튼 */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-stone-100 bg-stone-50 flex-wrap">
          {activeTab === 'history' ? (
            <button type="button" onClick={onClose} className="ml-auto h-[42px] px-5 rounded-[11px] bg-stone-900 hover:bg-black text-white text-sm font-bold">닫기</button>
          ) : (<>
            <span className="mr-auto text-[11.5px] text-stone-500">
              {status === 'testing' ? <>남은 시간 <b className="tabular-nums">{countdown}</b>초 · 최대 60초</> : ''}
            </span>
            {status === 'ready' && (<>
              <button type="button" onClick={onClose} className="h-[42px] px-3 rounded-[11px] text-stone-600 hover:bg-stone-200 text-[13.5px]">취소</button>
              {!(error && errorKind === 'trial') && (
                <button type="button" onClick={startTest} className="h-[42px] px-5 rounded-[11px] bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold inline-flex items-center gap-2 shadow-[0_6px_16px_-8px_rgba(245,158,11,0.8)]">
                  <Play className="w-4 h-4" fill="currentColor" />{error ? '다시 시도' : '검사 시작'}
                </button>
              )}
            </>)}
            {status === 'testing' && (
              <button type="button" onClick={onClose} className="h-[42px] px-4 rounded-[11px] border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-[13.5px] font-semibold">창 닫고 계속 쓰기</button>
            )}
            {status === 'completed' && (<>
              <button type="button" onClick={resetForRetest} className="h-[42px] px-4 rounded-[11px] border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-[13.5px] font-semibold inline-flex items-center gap-1.5">
                <RotateCcw className="w-[15px] h-[15px]" strokeWidth={2.2} />다시 검사
              </button>
              {verdict === 'block' ? (
                <button type="button" onClick={() => { if (onEdit) onEdit(); else onClose(); }} className="h-[42px] px-5 rounded-[11px] bg-stone-900 hover:bg-black text-white text-sm font-bold">글 고치러 가기</button>
              ) : (
                <button type="button" onClick={onClose} className="h-[42px] px-5 rounded-[11px] bg-stone-900 hover:bg-black text-white text-sm font-bold">확인</button>
              )}
            </>)}
          </>)}
        </div>
      </div>
    </div>
  );
}
