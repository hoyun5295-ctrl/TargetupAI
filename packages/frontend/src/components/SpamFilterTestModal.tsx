import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { formatPhoneNumber, replaceDirectVars, buildAdSubjectFront } from '../utils/formatDate';

interface SpamFilterTestModalProps {
  onClose: () => void;
  messageContentSms?: string;
  messageContentLms?: string;
  callbackNumber: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  isAd?: boolean;
  firstRecipient?: Record<string, any>;
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
}

export default function SpamFilterTestModal({
  onClose,
  messageContentSms,
  messageContentLms,
  callbackNumber,
  messageType,
  subject,
  isAd,
  firstRecipient
}: SpamFilterTestModalProps) {
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<'ready' | 'testing' | 'completed'>('ready');
  const [testId, setTestId] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [countdown, setCountdown] = useState(60);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'test' | 'history'>('test');
  const [history, setHistory] = useState<TestHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<{ test: any; results: TestResult[] } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 서버 시작 시간 기준 타이머용
  const serverCreatedAtRef = useRef<number | null>(null);

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

  // 모달 열릴 때 active 테스트 확인
  useEffect(() => {
    checkActiveTest();
    return () => clearTimers();
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
    if (!callbackNumber) { setError('발신번호가 선택되지 않았습니다.'); return; }
    if (!messageContentSms && !messageContentLms) { setError('메시지를 입력해주세요.'); return; }
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
        if (res.status === 409) setError(data.message || data.error || '이미 진행 중인 테스트가 있습니다.');
        else setError(data.error || '테스트 요청에 실패했습니다.');
        setStatus('ready'); return;
      }
      setTestId(data.testId);
      setTotalCount(data.totalCount);

      // 서버 시간 = 지금
      serverCreatedAtRef.current = Date.now();

      // 폴링 + 서버 시간 기반 카운트다운
      startPolling(data.testId);
      startServerBasedCountdown();

    } catch (err) { setError('네트워크 오류가 발생했습니다.'); setStatus('ready'); }
  };

  const pollResults = async (id: string) => {
    try {
      const res = await fetch(`/api/spam-filter/tests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.results) setResults(data.results);
      if (data.test?.status === 'completed') {
        clearTimers();
        setStatus('completed');
      }
    } catch (err) { console.error('폴링 오류:', err); }
  };

  const carrierLabel = (c: string) => c === 'LGU' ? 'LG U+' : c;

  const statusIcon = (r: TestResult) => {
    if (status === 'ready') return <span className="text-gray-400">—</span>;
    if (r.received) return <span className="text-green-500 font-bold text-lg">✅</span>;
    if (status === 'completed') {
      if (r.result === 'blocked') return <span className="text-red-500 font-bold text-lg">🚫</span>;
      if (r.result === 'failed') return <span className="text-red-500 font-bold text-lg">❌</span>;
      if (r.result === 'timeout') return <span className="text-yellow-500 font-bold text-lg">⚠️</span>;
      return <span className="text-gray-400 font-bold text-lg">❓</span>;
    }
    return <span className="animate-pulse text-yellow-500 text-lg">⏳</span>;
  };

  const statusText = (r: TestResult) => {
    if (status === 'ready') return '대기';
    if (r.received) return '수신 완료';
    if (status === 'completed') {
      if (r.result === 'blocked') return '스팸 차단';
      if (r.result === 'failed') return '발송 실패';
      if (r.result === 'timeout') return '시간 초과';
      return '판정 중';
    }
    return '확인 중...';
  };

  const receivedCount = results.filter(r => r.received).length;
  const blockedCount = status === 'completed' ? results.filter(r => r.result === 'blocked').length : 0;
  const timeoutCount = status === 'completed' ? results.filter(r => r.result === 'timeout').length : 0;
  const failedCount = status === 'completed' ? results.filter(r => r.result === 'failed').length : 0;

  // ★ D97: 미리보기 변수 치환 — replaceDirectVars 컨트롤타워 사용 (인라인 금지)
  const rawPreview = messageContentSms || messageContentLms || '';
  const previewMessage = firstRecipient
    ? replaceDirectVars(rawPreview, firstRecipient, callbackNumber)
    : rawPreview;


  // 로딩 중 표시
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-2xl shadow-2xl p-8 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          <span className="text-gray-600">테스트 상태 확인 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center"><span className="text-xl">🛡️</span></div>
            <div>
              <h3 className="font-bold text-gray-800 text-lg">스팸필터 점검</h3>
              <p className="text-xs text-gray-500">통신사별 SMS/LMS 수신 여부를 확인합니다</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {status === 'testing' && (
              <div className="flex items-center gap-2 bg-yellow-100 px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-yellow-700">{countdown}초</span>
              </div>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex border-b bg-white">
          <button
            onClick={() => setActiveTab('test')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === 'test' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >🛡️ 스팸필터 점검</button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >📋 내 테스트 이력</button>
        </div>

        {activeTab === 'test' ? (
        <div className="p-5">
          <div className="flex gap-5">
            <div className="flex-shrink-0">
              <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-blue-400 to-indigo-600 shadow-lg shadow-blue-200">
                <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col w-[240px]" style={{ height: '380px' }}>
                  <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                    <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                    <span className="text-[11px] font-bold text-blue-600">{formatPhoneNumber(callbackNumber) || '회신번호'}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-blue-50/30 to-white">
                    <div className="flex gap-2 mt-1">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.7] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                        {subject && (messageType === 'LMS' || messageType === 'MMS') && (
                          <div className="font-bold text-gray-800 mb-1 pb-1 border-b border-gray-100">{buildAdSubjectFront(subject, messageType, isAd ?? false)}</div>
                        )}
                        {previewMessage || '메시지 없음'}
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                    <span className="text-[10px] text-gray-400">{messageType}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              {status !== 'ready' && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${status === 'completed' ? blockedCount > 0 ? 'bg-red-50 text-red-700' : timeoutCount > 0 || failedCount > 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                  {status === 'testing' && (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full" />
                      <span>테스트폰 수신 확인 중... ({receivedCount}/{results.length})</span>
                    </div>
                  )}
                  {status === 'completed' && blockedCount === 0 && timeoutCount === 0 && failedCount === 0 && <div>✅ 전체 수신 성공! ({receivedCount}/{results.length}건)</div>}
                  {status === 'completed' && (blockedCount > 0 || timeoutCount > 0 || failedCount > 0) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {blockedCount > 0 && <span>🚫 스팸차단 {blockedCount}건</span>}
                      {timeoutCount > 0 && <span>⚠️ 시간초과 {timeoutCount}건</span>}
                      {failedCount > 0 && <span>❌ 발송실패 {failedCount}건</span>}
                      <span className="text-gray-500">(수신 {receivedCount}/{results.length}건)</span>
                    </div>
                  )}
                </div>
              )}

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50">
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600">통신사</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-600">SMS</th>
                    <th className="text-center px-3 py-2.5 font-medium text-gray-600">LMS</th>
                  </tr></thead>
                  <tbody>
                    {['SKT', 'KT', 'LGU'].map((carrier) => {
                      const smsR = results.find(r => r.carrier === carrier && r.message_type === 'SMS');
                      const lmsR = results.find(r => r.carrier === carrier && r.message_type === 'LMS');
                      return (
                        <tr key={carrier} className="border-t">
                          <td className="px-3 py-3 font-medium text-gray-700">{carrierLabel(carrier)}</td>
                          <td className="px-3 py-3 text-center">
                            {smsR ? <div className="flex flex-col items-center">{statusIcon(smsR)}<span className="text-[10px] text-gray-500 mt-0.5">{statusText(smsR)}</span></div> : <span className="text-gray-300 text-xs">{messageContentSms ? '—' : '미발송'}</span>}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {lmsR ? <div className="flex flex-col items-center">{statusIcon(lmsR)}<span className="text-[10px] text-gray-500 mt-0.5">{statusText(lmsR)}</span></div> : <span className="text-gray-300 text-xs">{messageContentLms ? '—' : '미발송'}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-[11px] text-gray-400 space-y-0.5">
                <div>• 통신사별 테스트폰에 실제 발송하여 수신 여부를 확인합니다</div>
                <div>• 입력한 메시지 원문 그대로 발송됩니다</div>
                <div>• 결과는 100% 보장이 아닌 참고용입니다</div>
              </div>

              {error && <div className="mt-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
            </div>
          </div>
        </div>

        ) : (
        /* 이력 탭 */
        <div className="p-5">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
              <span className="ml-2 text-gray-500 text-sm">이력 조회 중...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">스팸필터 테스트 이력이 없습니다</div>
          ) : (
            <>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {history.map((item) => {
                  const isExpanded = expandedHistoryId === item.id;
                  const receivedCnt = Number(item.received_count);
                  const totalCnt = Number(item.total_count);
                  const blockedCnt = totalCnt - receivedCnt;
                  const allPass = item.status === 'completed' && receivedCnt === totalCnt;
                  const msgPreview = (item.message_content_lms || item.message_content_sms || '').slice(0, 60);

                  return (
                    <div key={item.id} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => fetchHistoryDetail(item.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${allPass ? 'bg-green-100' : 'bg-red-100'}`}>
                          {allPass ? '✅' : '🚫'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">
                              {new Date(item.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${allPass ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                              {allPass ? '전체 정상' : `차단 ${blockedCnt}건`}
                            </span>
                            <span className="text-[10px] text-gray-400">{receivedCnt}/{totalCnt}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5 truncate">{msgPreview || '(메시지 없음)'}</div>
                        </div>
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>

                      {isExpanded && historyDetail && (
                        <div className="border-t bg-gray-50 px-4 py-3">
                          {/* 문안 표시 */}
                          <div className="mb-3 p-2.5 bg-white rounded border text-xs text-gray-700 whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
                            {historyDetail.test.message_content_lms || historyDetail.test.message_content_sms || '(메시지 없음)'}
                          </div>
                          {/* 통신사별 결과 */}
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-500">
                              <th className="text-left py-1 font-medium">통신사</th>
                              <th className="text-center py-1 font-medium">유형</th>
                              <th className="text-center py-1 font-medium">판정</th>
                            </tr></thead>
                            <tbody>
                              {historyDetail.results.map((r: any, idx: number) => (
                                <tr key={idx} className="border-t border-gray-200">
                                  <td className="py-1.5 text-gray-700 font-medium">{r.carrier === 'LGU' ? 'LG U+' : r.carrier}</td>
                                  <td className="py-1.5 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.message_type === 'SMS' ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-600'}`}>{r.message_type}</span>
                                  </td>
                                  <td className="py-1.5 text-center">
                                    {r.received ? <span className="text-green-600 font-medium">✅ 정상</span>
                                      : r.result === 'blocked' ? <span className="text-red-600 font-medium">🚫 차단</span>
                                      : r.result === 'failed' ? <span className="text-red-500">❌ 실패</span>
                                      : r.result === 'timeout' ? <span className="text-yellow-600">⚠️ 시간초과</span>
                                      : <span className="text-gray-400">대기</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {historyTotalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-3">
                  <button onClick={() => fetchHistory(historyPage - 1)} disabled={historyPage <= 1} className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40">이전</button>
                  <span className="text-sm text-gray-500">{historyPage} / {historyTotalPages}</span>
                  <button onClick={() => fetchHistory(historyPage + 1)} disabled={historyPage >= historyTotalPages} className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-40">다음</button>
                </div>
              )}
            </>
          )}
        </div>
        )}

        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          {activeTab === 'history' ? (
            <button onClick={onClose} className="px-6 py-2.5 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium transition-colors">닫기</button>
          ) : (<>
            {status === 'ready' && (<>
              <button onClick={onClose} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">취소</button>
              <button onClick={startTest} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2">🛡️ 점검 시작</button>
            </>)}
            {status === 'testing' && <button onClick={onClose} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">백그라운드로 전환</button>}
            {status === 'completed' && (<>
              <button onClick={resetForRetest} className="px-5 py-2.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium flex items-center gap-1.5">
                <span className="text-sm">🔄</span> 재테스트
              </button>
              <button onClick={onClose} className="px-6 py-2.5 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium transition-colors">확인</button>
            </>)}
          </>)}
        </div>
      </div>
    </div>
  );
}
