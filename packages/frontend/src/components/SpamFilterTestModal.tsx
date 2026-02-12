import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

interface SpamFilterTestModalProps {
  onClose: () => void;
  messageContentSms?: string;   // SMS 메시지 (광고+수신거부 포함된 최종본)
  messageContentLms?: string;   // LMS 메시지 (광고+수신거부 포함된 최종본)
  callbackNumber: string;       // 발신번호
  messageType: 'SMS' | 'LMS' | 'MMS';  // 현재 선택된 타입
}

interface TestResult {
  carrier: string;
  message_type: string;
  received: boolean;
  received_at: string | null;
}

export default function SpamFilterTestModal({
  onClose,
  messageContentSms,
  messageContentLms,
  callbackNumber,
  messageType
}: SpamFilterTestModalProps) {
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<'ready' | 'testing' | 'completed'>('ready');
  const [testId, setTestId] = useState<string | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [countdown, setCountdown] = useState(60);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // 클린업
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // 테스트 시작
  const startTest = async () => {
    if (!callbackNumber) {
      setError('발신번호가 선택되지 않았습니다.');
      return;
    }
    if (!messageContentSms && !messageContentLms) {
      setError('메시지를 입력해주세요.');
      return;
    }

    setStatus('testing');
    setError('');
    setCountdown(60);

    try {
      const res = await fetch('/api/spam-filter/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          callbackNumber,
          messageContentSms: messageContentSms || null,
          messageContentLms: messageContentLms || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setError(`${data.message || '잠시 후 다시 시도해주세요.'}`);
        } else if (res.status === 409) {
          setError('이미 진행 중인 테스트가 있습니다.');
        } else {
          setError(data.error || '테스트 요청에 실패했습니다.');
        }
        setStatus('ready');
        return;
      }

      setTestId(data.testId);
      setTotalCount(data.totalCount);

      // 폴링 시작 (2초 간격)
      pollRef.current = setInterval(() => pollResults(data.testId), 2000);

      // 카운트다운 시작
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            // 타임아웃
            if (pollRef.current) clearInterval(pollRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            setStatus('completed');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err) {
      setError('네트워크 오류가 발생했습니다.');
      setStatus('ready');
    }
  };

  // 결과 폴링
  const pollResults = async (id: string) => {
    try {
      const res = await fetch(`/api/spam-filter/tests/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.results) {
        setResults(data.results);
      }

      // 모두 완료되었으면 폴링 중지
      if (data.test?.status === 'completed') {
        if (pollRef.current) clearInterval(pollRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);
        setStatus('completed');
      }
    } catch (err) {
      console.error('폴링 오류:', err);
    }
  };

  // 통신사 한글명
  const carrierLabel = (c: string) => {
    switch (c) {
      case 'SKT': return 'SKT';
      case 'KT': return 'KT';
      case 'LGU': return 'LG U+';
      default: return c;
    }
  };

  // 수신 상태 아이콘
  const statusIcon = (result: TestResult) => {
    if (status === 'ready') return <span className="text-gray-400">—</span>;
    if (result.received) return <span className="text-green-500 font-bold text-lg">✅</span>;
    if (status === 'completed') return <span className="text-red-500 font-bold text-lg">❌</span>;
    return <span className="animate-pulse text-yellow-500 text-lg">⏳</span>;
  };

  // 수신 상태 텍스트
  const statusText = (result: TestResult) => {
    if (status === 'ready') return '대기';
    if (result.received) return '수신 완료';
    if (status === 'completed') return '스팸 차단';
    return '확인 중...';
  };

  // 수신 통계
  const receivedCount = results.filter(r => r.received).length;
  const blockedCount = status === 'completed' ? results.filter(r => !r.received).length : 0;

  // 미리보기 메시지 (SMS 우선, 없으면 LMS)
  const previewMessage = messageContentSms || messageContentLms || '';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* 헤더 */}
        <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-xl">🛡️</span>
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-lg">스팸필터 점검</h3>
              <p className="text-xs text-gray-500">통신사별 SMS/LMS 수신 여부를 확인합니다</p>
            </div>
          </div>
          {status === 'testing' && (
            <div className="flex items-center gap-2 bg-yellow-100 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-yellow-700">{countdown}초</span>
            </div>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* 본문 */}
        <div className="p-5">
          <div className="flex gap-5">
            {/* 왼쪽: 핸드폰 미리보기 */}
            <div className="w-[220px] flex-shrink-0">
              <div className="bg-gray-900 rounded-[24px] p-2 shadow-lg">
                <div className="bg-white rounded-[18px] overflow-hidden">
                  {/* 폰 상단 */}
                  <div className="bg-gray-100 px-3 py-2 text-center">
                    <div className="text-[10px] text-gray-500">발신</div>
                    <div className="text-xs font-bold text-gray-700">{callbackNumber || '미선택'}</div>
                  </div>
                  {/* 메시지 영역 */}
                  <div className="p-3 min-h-[280px] max-h-[280px] overflow-y-auto bg-gray-50">
                    <div className="bg-white rounded-lg p-2.5 shadow-sm border text-xs leading-relaxed whitespace-pre-wrap break-all text-gray-700">
                      {previewMessage || '메시지 없음'}
                    </div>
                  </div>
                  {/* 폰 하단 */}
                  <div className="bg-gray-100 px-3 py-2 text-center">
                    <div className="text-[10px] text-gray-400">{messageType}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 오른쪽: 결과 영역 */}
            <div className="flex-1">
              {/* 상태 요약 */}
              {status !== 'ready' && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  status === 'completed' 
                    ? blockedCount > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                    : 'bg-yellow-50 text-yellow-700'
                }`}>
                  {status === 'testing' && (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full" />
                      <span>테스트폰 수신 확인 중... ({receivedCount}/{results.length})</span>
                    </div>
                  )}
                  {status === 'completed' && blockedCount === 0 && (
                    <div>✅ 전체 수신 성공! ({receivedCount}/{results.length}건)</div>
                  )}
                  {status === 'completed' && blockedCount > 0 && (
                    <div>⚠️ {blockedCount}건 스팸 차단 감지 (수신 {receivedCount}/{results.length}건)</div>
                  )}
                </div>
              )}

              {/* 결과 테이블 */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600">통신사</th>
                      <th className="text-center px-3 py-2.5 font-medium text-gray-600">SMS</th>
                      <th className="text-center px-3 py-2.5 font-medium text-gray-600">LMS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['SKT', 'KT', 'LGU'].map((carrier) => {
                      const smsResult = results.find(r => r.carrier === carrier && r.message_type === 'SMS');
                      const lmsResult = results.find(r => r.carrier === carrier && r.message_type === 'LMS');
                      return (
                        <tr key={carrier} className="border-t">
                          <td className="px-3 py-3 font-medium text-gray-700">{carrierLabel(carrier)}</td>
                          <td className="px-3 py-3 text-center">
                            {smsResult ? (
                              <div className="flex flex-col items-center">
                                {statusIcon(smsResult)}
                                <span className="text-[10px] text-gray-500 mt-0.5">{statusText(smsResult)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-300 text-xs">{messageContentSms ? '—' : '미발송'}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {lmsResult ? (
                              <div className="flex flex-col items-center">
                                {statusIcon(lmsResult)}
                                <span className="text-[10px] text-gray-500 mt-0.5">{statusText(lmsResult)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-300 text-xs">{messageContentLms ? '—' : '미발송'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 안내 문구 */}
              <div className="mt-3 text-[11px] text-gray-400 space-y-0.5">
                <div>• 통신사별 테스트폰에 실제 발송하여 수신 여부를 확인합니다</div>
                <div>• 수신거부번호가 점검용 번호로 자동 치환됩니다</div>
                <div>• 결과는 100% 보장이 아닌 참고용입니다</div>
              </div>

              {/* 에러 메시지 */}
              {error && (
                <div className="mt-3 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          {status === 'ready' && (
            <>
              <button
                onClick={onClose}
                className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={startTest}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                🛡️ 점검 시작
              </button>
            </>
          )}
          {status === 'testing' && (
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              백그라운드로 전환
            </button>
          )}
          {status === 'completed' && (
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium transition-colors"
            >
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
