import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import AlertModal from '../components/AlertModal';

interface Flyer { id: string; title: string; short_code: string | null; status: string; }

export default function SendPage({ token }: { token: string }) {
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [selectedFlyer, setSelectedFlyer] = useState<string>('');
  const [phones, setPhones] = useState('');
  const [callbackNumber, setCallbackNumber] = useState('');
  const [senderNumbers, setSenderNumbers] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const headers = { Authorization: `Bearer ${token}` };

  // 발행된 전단지 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/flyer/flyers`, { headers });
        if (res.ok) {
          const all = await res.json();
          setFlyers(all.filter((f: Flyer) => f.status === 'published' && f.short_code));
        }
      } catch {}
    })();
  }, [token]);

  // 발신번호 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/companies/sender-numbers`, { headers });
        if (res.ok) {
          const data = await res.json();
          const nums = (data.senderNumbers || data || []).map((s: any) => s.phone_number || s);
          setSenderNumbers(nums);
          if (nums.length > 0) setCallbackNumber(nums[0]);
        }
      } catch {}
    })();
  }, [token]);

  // 전단지 선택 시 메시지 자동 생성
  useEffect(() => {
    if (!selectedFlyer) { setMessage(''); return; }
    const f = flyers.find(fl => fl.id === selectedFlyer);
    if (f && f.short_code) {
      setMessage(`(광고) ${f.title}\n▶ https://hanjul-flyer.kr/${f.short_code}\n무료수신거부 080`);
    }
  }, [selectedFlyer, flyers]);

  const handleSend = async () => {
    if (!selectedFlyer) { setAlert({ show: true, title: '선택 필요', message: '발송할 전단지를 선택해주세요.', type: 'error' }); return; }
    if (!phones.trim()) { setAlert({ show: true, title: '입력 필요', message: '수신자 전화번호를 입력해주세요.', type: 'error' }); return; }
    if (!callbackNumber) { setAlert({ show: true, title: '선택 필요', message: '발신번호를 선택해주세요.', type: 'error' }); return; }

    const phoneList = phones.split(/[\n,;]+/).map(p => p.trim().replace(/-/g, '')).filter(p => p.length >= 10);
    if (phoneList.length === 0) { setAlert({ show: true, title: '입력 오류', message: '유효한 전화번호가 없습니다.', type: 'error' }); return; }

    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/campaigns/direct-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recipients: phoneList.map(p => ({ phone: p })),
          message: message,
          callback: callbackNumber,
          messageType: message.length > 90 ? 'LMS' : 'SMS',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAlert({ show: true, title: '발송 완료', message: `${data.totalSent || phoneList.length}건 발송 요청되었습니다.`, type: 'success' });
        setPhones('');
      } else {
        const err = await res.json();
        setAlert({ show: true, title: '발송 실패', message: err.error || '발송에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-6">메시지 발송</h2>

      <div className="max-w-2xl space-y-4">
        {/* 전단지 선택 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">전단지 선택</h3>
          {flyers.length === 0 ? (
            <p className="text-sm text-gray-500">발행된 전단지가 없습니다. 먼저 전단제작에서 전단지를 만들고 발행해주세요.</p>
          ) : (
            <select value={selectedFlyer} onChange={e => setSelectedFlyer(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">전단지를 선택하세요</option>
              {flyers.map(f => <option key={f.id} value={f.id}>{f.title} (hanjul-flyer.kr/{f.short_code})</option>)}
            </select>
          )}
        </div>

        {/* 발신번호 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">발신번호</h3>
          {senderNumbers.length === 0 ? (
            <p className="text-sm text-gray-500">등록된 발신번호가 없습니다. 설정에서 발신번호를 등록해주세요.</p>
          ) : (
            <select value={callbackNumber} onChange={e => setCallbackNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {senderNumbers.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>

        {/* 수신자 입력 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">수신자 전화번호</h3>
          <textarea
            value={phones}
            onChange={e => setPhones(e.target.value)}
            placeholder="전화번호를 입력하세요 (줄바꿈 또는 쉼표로 구분)&#10;예: 01012345678&#10;01098765432"
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{phones.split(/[\n,;]+/).filter(p => p.trim().replace(/-/g, '').length >= 10).length}건 입력됨</p>
        </div>

        {/* 메시지 미리보기 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-3">발송 메시지</h3>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{new TextEncoder().encode(message).length}byte · {message.length > 90 ? 'LMS' : 'SMS'}</p>
        </div>

        {/* 발송 버튼 */}
        <button
          onClick={handleSend}
          disabled={sending || !selectedFlyer || !phones.trim()}
          className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? '발송 중...' : '발송하기'}
        </button>
      </div>

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
