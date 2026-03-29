import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, Button, Select, TabBar, Textarea } from '../components/ui';

interface Flyer { id: string; title: string; short_code: string | null; status: string; store_name: string; }
type MsgType = 'SMS' | 'LMS' | 'MMS';

function calcBytes(text: string): number {
  let b = 0;
  for (let i = 0; i < text.length; i++) b += text.charCodeAt(i) > 127 ? 2 : 1;
  return b;
}

export default function SendPage({ token }: { token: string }) {
  const [msgType, setMsgType] = useState<MsgType>('SMS');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isAd, setIsAd] = useState(true);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [selectedFlyer, setSelectedFlyer] = useState('');
  const [showFlyerPreview, setShowFlyerPreview] = useState(false);
  const [phones, setPhones] = useState('');
  const [senderNumbers, setSenderNumbers] = useState<string[]>([]);
  const [callback, setCallback] = useState('');
  const [optOutNumber] = useState('080');
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const headers = { Authorization: `Bearer ${token}` };
  const maxBytes = msgType === 'SMS' ? 90 : 2000;

  useEffect(() => {
    (async () => {
      const [fRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/flyer/flyers`, { headers }).catch(() => null),
        fetch(`${API_BASE}/api/companies/sender-numbers`, { headers }).catch(() => null),
      ]);
      if (fRes?.ok) { const d = await fRes.json(); setFlyers(d.filter((f: Flyer) => f.status === 'published' && f.short_code)); }
      if (sRes?.ok) { const d = await sRes.json(); const n = (d.senderNumbers || d || []).map((s: any) => s.phone_number || s); setSenderNumbers(n); if (n.length > 0) setCallback(n[0]); }
    })();
  }, [token]);

  useEffect(() => {
    if (!selectedFlyer) return;
    const f = flyers.find(fl => fl.id === selectedFlyer);
    if (f?.short_code) {
      const url = `https://hanjul-flyer.kr/${f.short_code}`;
      if (!message.includes(url)) setMessage(prev => prev ? `${prev}\n${url}` : url);
    }
  }, [selectedFlyer]);

  const byteCount = useMemo(() => {
    let full = message;
    if (isAd) {
      const suffix = msgType === 'SMS' ? `\n무료거부${optOutNumber.replace(/-/g, '')}` : `\n무료수신거부 ${optOutNumber}`;
      full = '(광고) ' + full + suffix;
    }
    return calcBytes(full);
  }, [message, isAd, msgType, optOutNumber]);

  const phoneCount = useMemo(() => phones.split(/[\n,;]+/).filter(p => p.trim().replace(/-/g, '').length >= 10).length, [phones]);
  const selectedFlyerData = flyers.find(f => f.id === selectedFlyer);

  const handleSend = async () => {
    if (!phones.trim()) { setAlert({ show: true, title: '수신자 필요', message: '수신자 전화번호를 입력해주세요.', type: 'error' }); return; }
    if (!message.trim()) { setAlert({ show: true, title: '메시지 필요', message: '메시지를 입력해주세요.', type: 'error' }); return; }
    if (!callback) { setAlert({ show: true, title: '발신번호 필요', message: '발신번호를 선택해주세요.', type: 'error' }); return; }
    if ((msgType === 'LMS' || msgType === 'MMS') && !subject.trim()) { setAlert({ show: true, title: '제목 필요', message: '제목을 입력해주세요.', type: 'error' }); return; }
    const phoneList = phones.split(/[\n,;]+/).map(p => p.trim().replace(/-/g, '')).filter(p => p.length >= 10);
    if (phoneList.length === 0) { setAlert({ show: true, title: '입력 오류', message: '유효한 전화번호가 없습니다.', type: 'error' }); return; }
    if (msgType === 'SMS' && byteCount > 90) { setAlert({ show: true, title: '바이트 초과', message: `SMS는 90byte까지입니다. (현재 ${byteCount}byte)\nLMS로 전환해주세요.`, type: 'error' }); return; }

    setSending(true);
    try {
      let sendMsg = message;
      if (isAd) { sendMsg = `(광고) ${message}\n${msgType === 'SMS' ? `무료거부${optOutNumber.replace(/-/g, '')}` : `무료수신거부 ${optOutNumber}`}`; }
      const res = await fetch(`${API_BASE}/api/campaigns/direct-send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipients: phoneList.map(p => ({ phone: p })), message: sendMsg, subject: (msgType === 'LMS' || msgType === 'MMS') ? subject : undefined, callback, messageType: msgType }),
      });
      if (res.ok) { const d = await res.json(); setAlert({ show: true, title: '발송 완료', message: `${d.totalSent || phoneList.length}건 발송 요청되었습니다.`, type: 'success' }); setPhones(''); }
      else { const e = await res.json(); setAlert({ show: true, title: '발송 실패', message: e.error || '발송 실패', type: 'error' }); }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
    finally { setSending(false); }
  };

  return (
    <>
      <div className="flex gap-6">
        {/* ═══ 좌측: 메시지 작성 ═══ */}
        <div className="w-[400px] flex-shrink-0 space-y-3">
          <TabBar tabs={[{ key: 'SMS', label: 'SMS' }, { key: 'LMS', label: 'LMS' }, { key: 'MMS', label: 'MMS' }]} value={msgType} onChange={(v) => setMsgType(v as MsgType)} />

          <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
            {(msgType === 'LMS' || msgType === 'MMS') && (
              <div className="px-4 pt-4">
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="제목 (필수)"
                  className="w-full px-3 py-2 border border-brand-200 bg-brand-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder:text-brand-500/50" />
              </div>
            )}

            <div className="p-4">
              <div className="relative">
                {isAd && <span className="absolute left-0 top-0 text-sm text-brand-600 font-semibold pointer-events-none select-none">(광고) </span>}
                <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="전송하실 내용을 입력하세요."
                  style={isAd ? { textIndent: '42px' } : {}}
                  className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed text-text ${msgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`} />
              </div>
              {isAd && <p className="text-sm text-brand-600 mt-1">{msgType === 'SMS' ? `무료거부${optOutNumber.replace(/-/g, '')}` : `무료수신거부 ${optOutNumber}`}</p>}
              {msgType === 'MMS' && (
                <div className="mt-3 pt-3 border-t border-border rounded-lg p-3 bg-warn-50">
                  <span className="text-xs text-warn-500 font-medium">MMS 이미지 첨부 (준비 중)</span>
                </div>
              )}
            </div>

            <div className="px-4 py-2 bg-bg border-t border-border flex items-center justify-end">
              <span className="text-xs text-text-muted">
                <span className={`font-bold ${byteCount > maxBytes ? 'text-error-500' : 'text-success-600'}`}>{byteCount}</span>
                <span className="text-text-muted">/{maxBytes}byte</span>
              </span>
            </div>

            <div className="px-4 py-3 border-t border-border">
              <Select value={callback} onChange={e => setCallback(e.target.value)}>
                <option value="">회신번호 선택</option>
                {senderNumbers.map(n => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>

            <div className="px-4 py-3 border-t border-border">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={isAd} onChange={e => setIsAd(e.target.checked)} className="w-4 h-4 rounded border-border-strong text-primary-600 focus:ring-primary-500" />
                <span className="text-sm text-text">광고문구 자동 삽입</span>
                <span className="text-xs text-text-muted">(광고) + 무료수신거부</span>
              </label>
            </div>

            <div className="px-4 py-3 border-t border-border">
              <Button className="w-full" size="lg" disabled={sending || !phones.trim() || !message.trim()} onClick={handleSend}>
                {sending ? '발송 중...' : `발송하기${phoneCount > 0 ? ` (${phoneCount}건)` : ''}`}
              </Button>
            </div>
          </div>
        </div>

        {/* ═══ 우측 ═══ */}
        <div className="flex-1 min-w-0 space-y-4">
          <SectionCard title="전단지 선택" action={
            selectedFlyerData?.short_code
              ? <Button size="sm" variant="secondary" onClick={() => setShowFlyerPreview(true)}>미리보기</Button>
              : undefined
          }>
            {flyers.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-3">발행된 전단지가 없습니다. 전단제작에서 먼저 만들어주세요.</p>
            ) : (
              <>
                <Select value={selectedFlyer} onChange={e => setSelectedFlyer(e.target.value)}>
                  <option value="">전단지를 선택하세요 (선택사항)</option>
                  {flyers.map(f => <option key={f.id} value={f.id}>{f.title}{f.store_name ? ` — ${f.store_name}` : ''}</option>)}
                </Select>
                {selectedFlyerData?.short_code && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="text-xs bg-primary-50 text-primary-600 px-2.5 py-1 rounded-md flex-1 truncate font-mono">hanjul-flyer.kr/{selectedFlyerData.short_code}</code>
                    <button onClick={() => { navigator.clipboard.writeText(`https://hanjul-flyer.kr/${selectedFlyerData.short_code}`); }}
                      className="text-xs text-primary-600 hover:text-primary-700 font-semibold">복사</button>
                  </div>
                )}
              </>
            )}
          </SectionCard>

          <SectionCard title="수신자" action={phoneCount > 0 ? <span className="text-xs font-semibold text-success-600">{phoneCount}건</span> : undefined}>
            <Textarea value={phones} onChange={e => setPhones(e.target.value)}
              placeholder={"전화번호를 입력하세요\n(줄바꿈 또는 쉼표로 구분)\n\n01012345678\n01098765432"}
              rows={10} className="font-mono text-xs" />
            {phoneCount > 0 && (
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-success-600 font-semibold">{phoneCount}건 입력됨</span>
                <button onClick={() => setPhones('')} className="text-xs text-text-muted hover:text-error-500 transition-colors">전체 삭제</button>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* 전단지 미리보기 모달 */}
      {showFlyerPreview && selectedFlyerData?.short_code && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowFlyerPreview(false)}>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowFlyerPreview(false)} className="absolute -top-4 -right-4 w-9 h-9 bg-surface rounded-full shadow-elevated flex items-center justify-center text-text-secondary hover:text-text z-10">✕</button>
            <div className="bg-gray-900 rounded-[2.5rem] p-3 shadow-modal">
              <div className="bg-surface rounded-[2rem] overflow-hidden" style={{ width: 375, height: 720 }}>
                <div className="bg-bg px-5 py-2 flex items-center text-[10px] text-text-muted border-b border-border">
                  hanjul-flyer.kr/{selectedFlyerData.short_code}
                </div>
                <iframe src={`${API_BASE}/api/flyer/p/${selectedFlyerData.short_code}`} className="w-full border-0" style={{ height: 692 }} title="전단지 미리보기" />
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
