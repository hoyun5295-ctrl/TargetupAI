import { useState, useEffect, useMemo, useRef } from 'react';
import { API_BASE } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, Button, Select, TabBar, Textarea, Badge } from '../components/ui';

interface Flyer { id: string; title: string; short_code: string | null; status: string; store_name: string; }
interface Recipient { phone: string; name?: string; extra1?: string; extra2?: string; extra3?: string; }
interface AddressGroup { group_name: string; count: number; }
type MsgType = 'SMS' | 'LMS' | 'MMS';
type RecipientMode = 'direct' | 'file' | 'address';

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
  const [senderNumbers, setSenderNumbers] = useState<string[]>([]);
  const [callback, setCallback] = useState('');
  const [optOutNumber] = useState('080');
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  // 수신자
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('direct');
  const [directPhones, setDirectPhones] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  // 파일 업로드
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileData, setFileData] = useState<any[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // 주소록
  const [addressGroups, setAddressGroups] = useState<AddressGroup[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };
  const maxBytes = msgType === 'SMS' ? 90 : 2000;

  // 데이터 로드
  useEffect(() => {
    (async () => {
      const [fRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/flyer/flyers`, { headers }).catch(() => null),
        fetch(`${API_BASE}/api/companies/callback-numbers`, { headers }).catch(() => null),
      ]);
      if (fRes?.ok) { const d = await fRes.json(); setFlyers(d.filter((f: Flyer) => f.status === 'published' && f.short_code)); }
      if (sRes?.ok) { const d = await sRes.json(); const nums = (d.numbers || d || []).map((cb: any) => cb.phone || cb.phone_number || cb); setSenderNumbers(nums); if (nums.length > 0) setCallback(nums[0]); }
    })();
  }, [token]);

  // 주소록 로드 (탭 전환 시)
  useEffect(() => {
    if (recipientMode === 'address' && addressGroups.length === 0) {
      setAddressLoading(true);
      fetch(`${API_BASE}/api/address-books/groups`, { headers })
        .then(r => r.ok ? r.json() : [])
        .then(d => setAddressGroups(d.groups || d || []))
        .catch(() => {})
        .finally(() => setAddressLoading(false));
    }
  }, [recipientMode]);

  // 전단지 선택 → URL 삽입
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

  // 직접입력 모드의 수신자 수
  const directPhoneCount = useMemo(() => directPhones.split(/[\n,;]+/).filter(p => p.trim().replace(/-/g, '').length >= 10).length, [directPhones]);

  // 전체 수신자 수
  const totalRecipientCount = recipientMode === 'direct' ? directPhoneCount : recipients.length;

  const selectedFlyerData = flyers.find(f => f.id === selectedFlyer);

  // ── 파일 업로드 ──
  const handleFileSelect = async (file: File) => {
    setFileLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/upload/parse?includeData=true`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setFileHeaders(data.headers);
        setFileData(data.allData || data.preview);
        setShowMapping(true);
        setColumnMapping({});
      } else {
        setAlert({ show: true, title: '파일 오류', message: data.error || '파일 파싱에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '파일 업로드 중 오류가 발생했습니다.', type: 'error' });
    } finally { setFileLoading(false); }
  };

  // 컬럼 매핑 적용
  const handleMappingApply = () => {
    if (!columnMapping.phone) {
      setAlert({ show: true, title: '매핑 오류', message: '수신번호 컬럼을 선택해주세요.', type: 'error' });
      return;
    }
    const mapped: Recipient[] = fileData.map(row => ({
      phone: String(row[columnMapping.phone] || '').trim().replace(/-/g, ''),
      name: columnMapping.name ? String(row[columnMapping.name] || '').trim() : '',
      extra1: columnMapping.extra1 ? String(row[columnMapping.extra1] || '').trim() : '',
      extra2: columnMapping.extra2 ? String(row[columnMapping.extra2] || '').trim() : '',
      extra3: columnMapping.extra3 ? String(row[columnMapping.extra3] || '').trim() : '',
    })).filter(r => r.phone.length >= 10);

    setRecipients(mapped);
    setShowMapping(false);
    setAlert({ show: true, title: '매핑 완료', message: `${mapped.length}건의 수신자가 등록되었습니다.`, type: 'success' });
  };

  // 주소록 선택
  const handleAddressSelect = async (groupName: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/address-books/${encodeURIComponent(groupName)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const contacts = (data.contacts || data || []).map((c: any) => ({
          phone: String(c.phone || '').trim().replace(/-/g, ''),
          name: c.name || '',
          extra1: c.extra1 || '',
          extra2: c.extra2 || '',
          extra3: c.extra3 || '',
        })).filter((r: Recipient) => r.phone.length >= 10);

        setRecipients(contacts);
        setAlert({ show: true, title: '주소록 불러오기', message: `"${groupName}" 그룹에서 ${contacts.length}건 불러왔습니다.`, type: 'success' });
      }
    } catch {
      setAlert({ show: true, title: '오류', message: '주소록 불러오기에 실패했습니다.', type: 'error' });
    }
  };

  // 발송
  const handleSend = async () => {
    let phoneList: { phone: string }[];
    if (recipientMode === 'direct') {
      phoneList = directPhones.split(/[\n,;]+/).map(p => ({ phone: p.trim().replace(/-/g, '') })).filter(r => r.phone.length >= 10);
    } else {
      phoneList = recipients.map(r => ({ phone: r.phone }));
    }

    if (phoneList.length === 0) { setAlert({ show: true, title: '수신자 필요', message: '수신자를 추가해주세요.', type: 'error' }); return; }
    if (!message.trim()) { setAlert({ show: true, title: '메시지 필요', message: '메시지를 입력해주세요.', type: 'error' }); return; }
    if (!callback) { setAlert({ show: true, title: '발신번호 필요', message: '발신번호를 선택해주세요.', type: 'error' }); return; }
    if ((msgType === 'LMS' || msgType === 'MMS') && !subject.trim()) { setAlert({ show: true, title: '제목 필요', message: '제목을 입력해주세요.', type: 'error' }); return; }
    if (msgType === 'SMS' && byteCount > 90) { setAlert({ show: true, title: '바이트 초과', message: `SMS는 90byte까지입니다. (현재 ${byteCount}byte)\nLMS로 전환해주세요.`, type: 'error' }); return; }

    setSending(true);
    try {
      let sendMsg = message;
      if (isAd) { sendMsg = `(광고) ${message}\n${msgType === 'SMS' ? `무료거부${optOutNumber.replace(/-/g, '')}` : `무료수신거부 ${optOutNumber}`}`; }
      const res = await fetch(`${API_BASE}/api/campaigns/direct-send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipients: phoneList, message: sendMsg, subject: (msgType === 'LMS' || msgType === 'MMS') ? subject : undefined, callback, messageType: msgType }),
      });
      if (res.ok) { const d = await res.json(); setAlert({ show: true, title: '발송 완료', message: `${d.totalSent || phoneList.length}건 발송 요청되었습니다.`, type: 'success' }); setDirectPhones(''); setRecipients([]); }
      else { const e = await res.json(); setAlert({ show: true, title: '발송 실패', message: e.error || '발송 실패', type: 'error' }); }
    } catch { setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' }); }
    finally { setSending(false); }
  };

  const MAPPING_FIELDS = [
    { key: 'phone', label: '수신번호', required: true },
    { key: 'name', label: '이름', required: false },
    { key: 'extra1', label: '기타1', required: false },
    { key: 'extra2', label: '기타2', required: false },
    { key: 'extra3', label: '기타3', required: false },
  ];

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
                <span className={`font-bold ${byteCount > maxBytes ? 'text-error-500' : 'text-success-600'}`}>{byteCount}</span>/{maxBytes}byte
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
              <Button className="w-full" size="lg" disabled={sending || totalRecipientCount === 0 || !message.trim()} onClick={handleSend}>
                {sending ? '발송 중...' : `발송하기${totalRecipientCount > 0 ? ` (${totalRecipientCount}건)` : ''}`}
              </Button>
            </div>
          </div>
        </div>

        {/* ═══ 우측 ═══ */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* 전단지 선택 */}
          <SectionCard title="전단지 선택" action={
            selectedFlyerData?.short_code ? <Button size="sm" variant="secondary" onClick={() => setShowFlyerPreview(true)}>미리보기</Button> : undefined
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
                    <button onClick={() => { navigator.clipboard.writeText(`https://hanjul-flyer.kr/${selectedFlyerData.short_code}`); }} className="text-xs text-primary-600 hover:text-primary-700 font-semibold">복사</button>
                  </div>
                )}
              </>
            )}
          </SectionCard>

          {/* 수신자 */}
          <div className="bg-surface border border-border rounded-xl shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">수신자</h3>
              {totalRecipientCount > 0 && <Badge variant="success">{totalRecipientCount}건</Badge>}
            </div>

            {/* 3탭: 직접입력 / 파일등록 / 주소록 */}
            <div className="px-5 pt-4">
              <TabBar
                tabs={[
                  { key: 'direct' as RecipientMode, label: '직접 입력' },
                  { key: 'file' as RecipientMode, label: '파일 등록' },
                  { key: 'address' as RecipientMode, label: '주소록' },
                ]}
                value={recipientMode}
                onChange={(v) => setRecipientMode(v as RecipientMode)}
              />
            </div>

            <div className="p-5">
              {/* 직접 입력 */}
              {recipientMode === 'direct' && (
                <>
                  <Textarea value={directPhones} onChange={e => setDirectPhones(e.target.value)}
                    placeholder={"전화번호를 입력하세요\n(줄바꿈 또는 쉼표로 구분)\n\n01012345678\n01098765432"}
                    rows={8} className="font-mono text-xs" />
                  {directPhoneCount > 0 && (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-success-600 font-semibold">{directPhoneCount}건 입력됨</span>
                      <button onClick={() => setDirectPhones('')} className="text-xs text-text-muted hover:text-error-500 transition-colors">전체 삭제</button>
                    </div>
                  )}
                </>
              )}

              {/* 파일 등록 */}
              {recipientMode === 'file' && (
                <>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} />

                  {recipients.length === 0 ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-border hover:border-primary-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors bg-bg/50 hover:bg-primary-50/30"
                    >
                      {fileLoading ? (
                        <p className="text-sm text-text-secondary">파일 처리 중...</p>
                      ) : (
                        <>
                          <div className="w-12 h-12 bg-bg rounded-xl flex items-center justify-center mx-auto mb-3 text-2xl">📁</div>
                          <p className="text-sm font-medium text-text mb-1">엑셀/CSV 파일을 클릭하여 선택하세요</p>
                          <p className="text-xs text-text-muted">.xlsx, .xls, .csv 지원</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-text">{recipients.length}건 등록됨</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>다시 업로드</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRecipients([])}>초기화</Button>
                        </div>
                      </div>
                      {/* 미리보기 테이블 */}
                      <div className="bg-bg rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-border/30 sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-text-secondary">#</th>
                              <th className="text-left px-3 py-2 font-semibold text-text-secondary">전화번호</th>
                              <th className="text-left px-3 py-2 font-semibold text-text-secondary">이름</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recipients.slice(0, 20).map((r, i) => (
                              <tr key={i} className="border-t border-border/30">
                                <td className="px-3 py-1.5 text-text-muted">{i + 1}</td>
                                <td className="px-3 py-1.5 font-mono text-text">{r.phone}</td>
                                <td className="px-3 py-1.5 text-text-secondary">{r.name || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {recipients.length > 20 && <p className="text-xs text-text-muted text-center py-2">... 외 {recipients.length - 20}건</p>}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 주소록 */}
              {recipientMode === 'address' && (
                <>
                  {addressLoading ? (
                    <p className="text-sm text-text-muted text-center py-6">주소록 불러오는 중...</p>
                  ) : addressGroups.length === 0 ? (
                    <div className="text-center py-6">
                      <div className="w-12 h-12 bg-bg rounded-xl flex items-center justify-center mx-auto mb-3 text-2xl">📒</div>
                      <p className="text-sm text-text-muted">저장된 주소록이 없습니다</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {addressGroups.map(g => (
                        <button key={g.group_name} onClick={() => handleAddressSelect(g.group_name)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-bg hover:bg-primary-50/50 rounded-lg transition-colors text-left group">
                          <div>
                            <p className="text-sm font-medium text-text group-hover:text-primary-600">{g.group_name}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="neutral">{g.count}건</Badge>
                            <span className="text-xs text-text-muted group-hover:text-primary-600">선택</span>
                          </div>
                        </button>
                      ))}
                      {recipients.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-success-600">{recipients.length}건 선택됨</span>
                            <Button size="sm" variant="ghost" onClick={() => setRecipients([])}>초기화</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 컬럼 매핑 모달 ═══ */}
      {showMapping && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]">
          <div className="bg-surface rounded-2xl shadow-modal max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text">컬럼 매핑</h3>
              <p className="text-xs text-text-muted mt-1">파일의 컬럼을 수신자 정보에 매핑해주세요</p>
            </div>

            <div className="p-6 space-y-4">
              {MAPPING_FIELDS.map(field => (
                <div key={field.key} className="flex items-center gap-4">
                  <label className="w-24 text-sm font-medium text-text flex-shrink-0">
                    {field.label} {field.required && <span className="text-error-500">*</span>}
                  </label>
                  <select value={columnMapping[field.key] || ''} onChange={e => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                    className="flex-1 px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-surface">
                    <option value="">선택 안 함</option>
                    {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}

              {/* 미리보기 */}
              {fileData.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-text-secondary mb-2">데이터 미리보기 (상위 3건)</p>
                  <div className="bg-bg rounded-lg overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr>{fileHeaders.slice(0, 6).map(h => <th key={h} className="text-left px-2 py-1.5 font-semibold text-text-muted whitespace-nowrap">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {fileData.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-t border-border/30">
                            {fileHeaders.slice(0, 6).map(h => <td key={h} className="px-2 py-1.5 text-text-secondary whitespace-nowrap">{String(row[h] || '').substring(0, 20)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowMapping(false)}>취소</Button>
              <Button onClick={handleMappingApply}>매핑 적용 ({fileData.length}건)</Button>
            </div>
          </div>
        </div>
      )}

      {/* 전단지 미리보기 모달 */}
      {showFlyerPreview && selectedFlyerData?.short_code && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowFlyerPreview(false)}>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowFlyerPreview(false)} className="absolute -top-4 -right-4 w-9 h-9 bg-surface rounded-full shadow-elevated flex items-center justify-center text-text-secondary hover:text-text z-10">✕</button>
            <div className="bg-gray-900 rounded-[2.5rem] p-3 shadow-modal">
              <div className="bg-surface rounded-[2rem] overflow-hidden" style={{ width: 375, height: 720 }}>
                <div className="bg-bg px-5 py-2 flex items-center text-[10px] text-text-muted border-b border-border">hanjul-flyer.kr/{selectedFlyerData.short_code}</div>
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
