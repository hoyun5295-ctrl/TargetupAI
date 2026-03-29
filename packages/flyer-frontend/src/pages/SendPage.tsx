import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../App';
import AlertModal from '../components/AlertModal';

interface Flyer { id: string; title: string; short_code: string | null; status: string; store_name: string; }

type MsgType = 'SMS' | 'LMS' | 'MMS';
type RecipientTab = 'direct' | 'file';

// EUC-KR 바이트 계산
function calcSmsBytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    bytes += text.charCodeAt(i) > 127 ? 2 : 1;
  }
  return bytes;
}

export default function SendPage({ token }: { token: string }) {
  // 메시지
  const [msgType, setMsgType] = useState<MsgType>('SMS');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isAd, setIsAd] = useState(true);

  // 전단지
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [selectedFlyer, setSelectedFlyer] = useState<string>('');
  const [showFlyerPreview, setShowFlyerPreview] = useState(false);

  // 수신자
  const [recipientTab, setRecipientTab] = useState<RecipientTab>('direct');
  const [phones, setPhones] = useState('');

  // 발신번호
  const [senderNumbers, setSenderNumbers] = useState<string[]>([]);
  const [callbackNumber, setCallbackNumber] = useState('');

  // 발송
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const headers = { Authorization: `Bearer ${token}` };

  // 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        const [flyerRes, snRes] = await Promise.all([
          fetch(`${API_BASE}/api/flyer/flyers`, { headers }),
          fetch(`${API_BASE}/api/companies/sender-numbers`, { headers }),
        ]);
        if (flyerRes.ok) {
          const all = await flyerRes.json();
          setFlyers(all.filter((f: Flyer) => f.status === 'published' && f.short_code));
        }
        if (snRes.ok) {
          const data = await snRes.json();
          const nums = (data.senderNumbers || data || []).map((s: any) => s.phone_number || s);
          setSenderNumbers(nums);
          if (nums.length > 0) setCallbackNumber(nums[0]);
        }
      } catch {}
    })();
  }, [token]);

  // 전단지 선택 시 URL 자동삽입
  useEffect(() => {
    if (!selectedFlyer) return;
    const f = flyers.find(fl => fl.id === selectedFlyer);
    if (f?.short_code) {
      const url = `https://hanjul-flyer.kr/${f.short_code}`;
      if (!message.includes(url)) {
        setMessage(prev => prev ? `${prev}\n${url}` : url);
      }
    }
  }, [selectedFlyer]);

  // 바이트 계산
  const byteCount = useMemo(() => calcSmsBytes(message), [message]);
  const phoneCount = useMemo(() =>
    phones.split(/[\n,;]+/).filter(p => p.trim().replace(/-/g, '').length >= 10).length
  , [phones]);

  // 선택된 전단지 정보
  const selectedFlyerData = flyers.find(f => f.id === selectedFlyer);

  // 미리보기 메시지 생성
  const previewMessage = useMemo(() => {
    let msg = message;
    if (isAd && !msg.startsWith('(광고)')) {
      msg = `(광고)${subject ? ` ${subject}\n` : ' '}${msg}`;
      if (!msg.includes('무료수신거부')) msg += '\n무료수신거부 080';
    }
    return msg;
  }, [message, subject, isAd]);

  // 발송
  const handleSend = async () => {
    if (!phones.trim()) { setAlert({ show: true, title: '수신자 필요', message: '수신자 전화번호를 입력해주세요.', type: 'error' }); return; }
    if (!message.trim()) { setAlert({ show: true, title: '메시지 필요', message: '발송할 메시지를 입력해주세요.', type: 'error' }); return; }
    if (!callbackNumber) { setAlert({ show: true, title: '발신번호 필요', message: '발신번호를 선택해주세요.', type: 'error' }); return; }

    const phoneList = phones.split(/[\n,;]+/).map(p => p.trim().replace(/-/g, '')).filter(p => p.length >= 10);
    if (phoneList.length === 0) { setAlert({ show: true, title: '입력 오류', message: '유효한 전화번호가 없습니다.', type: 'error' }); return; }

    setSending(true);
    try {
      const sendMessage = isAd ? previewMessage : message;
      const res = await fetch(`${API_BASE}/api/campaigns/direct-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recipients: phoneList.map(p => ({ phone: p })),
          message: sendMessage,
          subject: (msgType === 'LMS' || msgType === 'MMS') ? subject : undefined,
          callback: callbackNumber,
          messageType: msgType,
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
    } finally { setSending(false); }
  };

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-5">메시지 발송</h2>

      <div className="flex gap-6">
        {/* ═══ 좌측: 폰 미리보기 + 메시지 편집 ═══ */}
        <div className="w-[340px] flex-shrink-0 space-y-4">
          {/* 폰 프레임 미리보기 */}
          <div className="flex justify-center">
            <div className="relative w-[280px]">
              {/* 폰 외곽 */}
              <div className="bg-gray-800 rounded-[2.2rem] p-[10px] shadow-xl">
                {/* 상단 노치 */}
                <div className="absolute top-[14px] left-1/2 -translate-x-1/2 w-20 h-[22px] bg-gray-800 rounded-b-2xl z-10" />
                {/* 스크린 */}
                <div className="bg-gray-100 rounded-[1.8rem] overflow-hidden">
                  {/* 상태바 */}
                  <div className="bg-white px-5 pt-10 pb-2 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs">📱</div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-800">{callbackNumber || '발신번호'}</p>
                        <p className="text-[9px] text-gray-400">{msgType}</p>
                      </div>
                    </div>
                  </div>
                  {/* 메시지 영역 */}
                  <div className="px-4 py-3 min-h-[320px] max-h-[380px] overflow-y-auto">
                    {previewMessage ? (
                      <div className="flex justify-start">
                        <div className="bg-white rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm max-w-[220px] border border-gray-200">
                          {(msgType === 'LMS' || msgType === 'MMS') && subject && (
                            <p className="text-[11px] font-bold text-gray-800 mb-1 pb-1 border-b border-gray-100">{subject}</p>
                          )}
                          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap break-all">{previewMessage}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-center text-[11px] text-gray-300 mt-16">메시지를 입력하면<br/>미리보기가 표시됩니다</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 메시지 타입 탭 */}
          <div className="bg-gray-100 rounded-lg p-1 flex gap-0.5">
            {(['SMS', 'LMS', 'MMS'] as MsgType[]).map(t => (
              <button key={t} onClick={() => setMsgType(t)} className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${msgType === t ? 'bg-white shadow text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
                {t}
              </button>
            ))}
          </div>

          {/* 제목 (LMS/MMS) */}
          {(msgType === 'LMS' || msgType === 'MMS') && (
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="제목을 입력하세요"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          )}

          {/* 메시지 입력 */}
          <div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="메시지 내용을 입력하세요"
              rows={msgType === 'SMS' ? 5 : 7}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
            />
            <div className="flex justify-between mt-1 px-1">
              <span className={`text-xs ${byteCount > (msgType === 'SMS' ? 90 : 2000) ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                {byteCount} / {msgType === 'SMS' ? '90' : '2,000'} byte
              </span>
              {msgType === 'SMS' && byteCount > 90 && (
                <button onClick={() => setMsgType('LMS')} className="text-xs text-blue-500 hover:text-blue-700">LMS로 전환</button>
              )}
            </div>
          </div>

          {/* MMS 이미지 */}
          {msgType === 'MMS' && (
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center bg-white">
              <p className="text-xs text-gray-400">MMS 이미지 업로드 (준비 중)</p>
            </div>
          )}
        </div>

        {/* ═══ 우측: 전단지 선택 + 수신자 + 발송 설정 ═══ */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* 전단지 선택 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-3">전단지 선택</h3>
            {flyers.length === 0 ? (
              <p className="text-sm text-gray-400">발행된 전단지가 없습니다. 전단제작에서 먼저 만들어주세요.</p>
            ) : (
              <div className="flex gap-2">
                <select value={selectedFlyer} onChange={e => setSelectedFlyer(e.target.value)} className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">전단지를 선택하세요 (선택사항)</option>
                  {flyers.map(f => <option key={f.id} value={f.id}>{f.title}{f.store_name ? ` — ${f.store_name}` : ''}</option>)}
                </select>
                {selectedFlyerData?.short_code && (
                  <button onClick={() => setShowFlyerPreview(true)} className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-600 font-medium transition-colors whitespace-nowrap">
                    미리보기
                  </button>
                )}
              </div>
            )}
            {selectedFlyerData?.short_code && (
              <p className="text-xs text-blue-500 mt-2">
                URL: https://hanjul-flyer.kr/{selectedFlyerData.short_code}
              </p>
            )}
          </div>

          {/* 수신자 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-3">수신자</h3>
            {/* 탭 */}
            <div className="flex gap-1 mb-3">
              <button onClick={() => setRecipientTab('direct')} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${recipientTab === 'direct' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>직접 입력</button>
              <button onClick={() => setRecipientTab('file')} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${recipientTab === 'file' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>파일 업로드</button>
            </div>

            {recipientTab === 'direct' ? (
              <div>
                <textarea
                  value={phones}
                  onChange={e => setPhones(e.target.value)}
                  placeholder="전화번호를 입력하세요 (줄바꿈 또는 쉼표로 구분)&#10;01012345678&#10;01098765432"
                  rows={5}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono bg-gray-50"
                />
                <p className="text-xs text-gray-400 mt-1.5">{phoneCount}건 입력됨</p>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center bg-gray-50">
                <div className="text-2xl mb-2">📁</div>
                <p className="text-sm text-gray-500 mb-1">엑셀/CSV 파일을 드래그하거나 클릭하세요</p>
                <p className="text-xs text-gray-400">준비 중</p>
              </div>
            )}
          </div>

          {/* 발송 설정 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-700 mb-3">발송 설정</h3>
            <div className="space-y-3">
              {/* 발신번호 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">발신번호</label>
                {senderNumbers.length === 0 ? (
                  <p className="text-sm text-gray-400">등록된 발신번호가 없습니다.</p>
                ) : (
                  <select value={callbackNumber} onChange={e => setCallbackNumber(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    {senderNumbers.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                )}
              </div>
              {/* 광고문구 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isAd} onChange={e => setIsAd(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm text-gray-700">광고문구 자동 삽입</span>
                <span className="text-xs text-gray-400">(광고) + 무료수신거부</span>
              </label>
            </div>
          </div>

          {/* 발송 버튼 */}
          <button
            onClick={handleSend}
            disabled={sending || !phones.trim() || !message.trim()}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            {sending ? '발송 중...' : `발송하기${phoneCount > 0 ? ` (${phoneCount}건)` : ''}`}
          </button>
        </div>
      </div>

      {/* ═══ 전단지 미리보기 모달 ═══ */}
      {showFlyerPreview && selectedFlyerData?.short_code && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowFlyerPreview(false)}>
          <div className="relative" onClick={e => e.stopPropagation()}>
            {/* 닫기 */}
            <button onClick={() => setShowFlyerPreview(false)} className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-500 hover:text-gray-800 z-10">
              ✕
            </button>
            {/* 폰 프레임 */}
            <div className="bg-gray-900 rounded-[2.5rem] p-[12px] shadow-2xl">
              <div className="bg-white rounded-[2rem] overflow-hidden" style={{ width: 375, height: 720 }}>
                {/* 상태바 */}
                <div className="bg-gray-100 px-5 py-2 flex justify-between items-center text-[10px] text-gray-500">
                  <span>hanjul-flyer.kr</span>
                  <span>{selectedFlyerData.title}</span>
                </div>
                {/* iframe */}
                <iframe
                  src={`${API_BASE}/api/flyer/p/${selectedFlyerData.short_code}`}
                  className="w-full border-0"
                  style={{ height: 690 }}
                  title="전단지 미리보기"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
