import React, { useState } from 'react';

interface AddressBookModalProps {
  show: boolean;
  onClose: () => void;
  directRecipients: { phone: string; name: string; extra1: string; extra2: string; extra3: string }[];
  setDirectRecipients: React.Dispatch<React.SetStateAction<{ phone: string; name: string; extra1: string; extra2: string; extra3: string }[]>>;
  setToast: (t: { show: boolean; type: 'error' | 'success'; message: string }) => void;
}

export default function AddressBookModal({
  show,
  onClose,
  directRecipients,
  setDirectRecipients,
  setToast,
}: AddressBookModalProps) {
  const [addressGroups, setAddressGroups] = useState<{group_name: string, count: number}[]>([]);
  const [addressSaveMode, setAddressSaveMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addressFileHeaders, setAddressFileHeaders] = useState<string[]>([]);
  const [addressFileData, setAddressFileData] = useState<any[]>([]);
  const [addressColumnMapping, setAddressColumnMapping] = useState<{[key: string]: string}>({});
  const [addressViewGroup, setAddressViewGroup] = useState<string | null>(null);
  const [addressViewContacts, setAddressViewContacts] = useState<any[]>([]);
  const [addressViewSearch, setAddressViewSearch] = useState('');
  const [addressPage, setAddressPage] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // 모달 열릴 때 그룹 로드
  React.useEffect(() => {
    if (show && !loaded) {
      const token = localStorage.getItem('token');
      fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (data.success) setAddressGroups(data.groups || []);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
    if (!show) {
      setLoaded(false);
      setAddressSaveMode(false);
      setNewGroupName('');
      setAddressFileData([]);
      setAddressColumnMapping({});
      setAddressViewGroup(null);
      setAddressViewContacts([]);
      setAddressViewSearch('');
      setAddressPage(0);
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-[750px] max-h-[85vh] overflow-hidden">
        <div className="px-6 py-4 border-b bg-amber-50 flex justify-between items-center">
          <h3 className="text-lg font-bold text-amber-700">📒 주소록</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* 파일 업로드 영역 */}
          {!addressSaveMode && (
            <div className="mb-4 p-4 border-2 border-dashed border-amber-300 rounded-lg text-center bg-amber-50">
              <label className="cursor-pointer">
                <div className="text-amber-600 mb-2">📁 파일을 선택하여 주소록 등록</div>
                <div className="text-xs text-gray-400 mb-3">Excel, CSV 파일 지원</div>
                <span className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 inline-block">파일 선택</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append('file', file);
                    try {
                      const token = localStorage.getItem('token');
                      const res = await fetch('/api/upload/parse?includeData=true', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
                      const data = await res.json();
                      if (data.success) {
                        setAddressFileHeaders(data.headers || []);
                        setAddressFileData(data.allData || data.preview || []);
                        setAddressSaveMode(true);
                      }
                    } catch (err) {
                      alert('파일 파싱 실패');
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}

          {/* 현재 수신자 저장 버튼 */}
          {directRecipients.length > 0 && !addressSaveMode && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-700 mb-2">현재 수신자 {directRecipients.length}명을 주소록으로 저장하시겠습니까?</div>
              <button
                onClick={() => setAddressSaveMode(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >💾 주소록으로 저장</button>
            </div>
          )}

          {/* 저장 모드 - 컬럼 매핑 */}
          {addressSaveMode && addressFileData.length > 0 && (
            <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="text-sm font-medium text-amber-700 mb-3">📋 컬럼 매핑 ({addressFileData.length}건)</div>
              <div className="space-y-2 mb-4">
                {[
                  { key: 'phone', label: '수신번호 *', required: true },
                  { key: 'name', label: '이름' },
                  { key: 'extra1', label: '기타1' },
                  { key: 'extra2', label: '기타2' },
                  { key: 'extra3', label: '기타3' },
                ].map((field) => (
                  <div key={field.key} className="flex items-center gap-3">
                    <span className={`w-24 text-sm ${field.required ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{field.label}</span>
                    <span className="text-gray-400">→</span>
                    <select
                      className="flex-1 px-3 py-2 border rounded-lg text-sm"
                      value={addressColumnMapping[field.key] || ''}
                      onChange={(e) => setAddressColumnMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      <option value="">-- 컬럼 선택 --</option>
                      {addressFileHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-600 w-24">그룹명 *</span>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="예: VIP고객, 이벤트참여자"
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!addressColumnMapping.phone) {
                      alert('수신번호 컬럼을 선택하세요');
                      return;
                    }
                    if (!newGroupName.trim()) {
                      alert('그룹명을 입력하세요');
                      return;
                    }
                    const contacts = addressFileData.map((row: any) => ({
                      phone: row[addressColumnMapping.phone] || '',
                      name: row[addressColumnMapping.name] || '',
                      extra1: row[addressColumnMapping.extra1] || '',
                      extra2: row[addressColumnMapping.extra2] || '',
                      extra3: row[addressColumnMapping.extra3] || '',
                    }));
                    const token = localStorage.getItem('token');
                    const res = await fetch('/api/address-books', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ groupName: newGroupName, contacts })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setToast({show: true, type: 'success', message: data.message});
                      setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                      setAddressSaveMode(false);
                      setNewGroupName('');
                      setAddressFileData([]);
                      setAddressColumnMapping({});
                      const groupRes = await fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } });
                      const groupData = await groupRes.json();
                      if (groupData.success) setAddressGroups(groupData.groups || []);
                    } else {
                      alert(data.error || '저장 실패');
                    }
                  }}
                  className="flex-1 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >💾 주소록 저장</button>
                <button
                  onClick={() => { setAddressSaveMode(false); setAddressFileData([]); setAddressColumnMapping({}); setNewGroupName(''); }}
                  className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400"
                >취소</button>
              </div>
            </div>
          )}

          {/* 현재 수신자 저장 모드 */}
          {addressSaveMode && addressFileData.length === 0 && directRecipients.length > 0 && (
            <div className="mb-4 p-4 bg-green-50 rounded-lg border-2 border-green-200">
              <div className="text-sm text-green-700 mb-2 font-medium">그룹명을 입력하세요 ({directRecipients.length}명)</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="예: VIP고객, 이벤트참여자"
                  className="flex-1 px-3 py-2 border rounded-lg"
                />
                <button
                  onClick={async () => {
                    if (!newGroupName.trim()) {
                      alert('그룹명을 입력하세요');
                      return;
                    }
                    const token = localStorage.getItem('token');
                    const res = await fetch('/api/address-books', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ groupName: newGroupName, contacts: directRecipients })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setToast({show: true, type: 'success', message: data.message});
                      setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                      setAddressSaveMode(false);
                      setNewGroupName('');
                      const groupRes = await fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } });
                      const groupData = await groupRes.json();
                      if (groupData.success) setAddressGroups(groupData.groups || []);
                    } else {
                      alert(data.error || '저장 실패');
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >저장</button>
                <button
                  onClick={() => { setAddressSaveMode(false); setNewGroupName(''); }}
                  className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400"
                >취소</button>
              </div>
            </div>
          )}

          {/* 그룹 목록 */}
          {!addressSaveMode && (
            <>
              <div className="text-sm font-medium text-gray-600 mb-2">저장된 주소록</div>
              {addressGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-4xl mb-2">📭</div>
              <div>저장된 주소록이 없습니다</div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {addressGroups.slice(addressPage * 5, addressPage * 5 + 5).map((group) => (
                  <div key={group.group_name} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100">
                      <div>
                        <div className="font-medium">{group.group_name}</div>
                        <div className="text-sm text-gray-500">{group.count}명</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            if (addressViewGroup === group.group_name) {
                              setAddressViewGroup(null);
                              setAddressViewContacts([]);
                              setAddressViewSearch('');
                            } else {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/address-books/${encodeURIComponent(group.group_name)}`, {
                                headers: { Authorization: `Bearer ${token}` }
                              });
                              const data = await res.json();
                              if (data.success) {
                                setAddressViewGroup(group.group_name);
                                setAddressViewContacts(data.contacts || []);
                                setAddressViewSearch('');
                              }
                            }
                          }}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm"
                        >{addressViewGroup === group.group_name ? '닫기' : '조회'}</button>
                        <button
                          onClick={async () => {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/address-books/${encodeURIComponent(group.group_name)}`, {
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            const data = await res.json();
                            if (data.success) {
                              setDirectRecipients(data.contacts.map((c: any) => ({
                                phone: c.phone,
                                name: c.name || '',
                                extra1: c.extra1 || '',
                                extra2: c.extra2 || '',
                                extra3: c.extra3 || ''
                              })));
                              onClose();
                              setAddressViewGroup(null);
                              setAddressViewContacts([]);
                              setToast({show: true, type: 'success', message: `${data.contacts.length}명 불러오기 완료`});
                              setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                            }
                          }}
                          className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 text-sm"
                        >불러오기</button>
                        <button
                          onClick={async () => {
                            if (!confirm(`"${group.group_name}" 주소록을 삭제하시겠습니까?`)) return;
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/address-books/${encodeURIComponent(group.group_name)}`, {
                              method: 'DELETE',
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            const data = await res.json();
                            if (data.success) {
                              setAddressGroups(prev => prev.filter(g => g.group_name !== group.group_name));
                              if (addressViewGroup === group.group_name) {
                                setAddressViewGroup(null);
                                setAddressViewContacts([]);
                              }
                              setToast({show: true, type: 'success', message: '삭제되었습니다'});
                              setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                            }
                          }}
                          className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
                        >삭제</button>
                      </div>
                    </div>
                    {addressViewGroup === group.group_name && (
                      <div className="p-3 border-t bg-white">
                        <div className="flex gap-2 mb-2">
                          <input
                            type="text"
                            placeholder="번호 또는 이름으로 검색"
                            value={addressViewSearch}
                            onChange={(e) => setAddressViewSearch(e.target.value)}
                            className="flex-1 px-3 py-1.5 border rounded text-sm"
                          />
                        </div>
                        <div className="max-h-[200px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="px-2 py-1 text-left">번호</th>
                                <th className="px-2 py-1 text-left">이름</th>
                                <th className="px-2 py-1 text-left">기타1</th>
                                <th className="px-2 py-1 text-left">기타2</th>
                                <th className="px-2 py-1 text-left">기타3</th>
                              </tr>
                            </thead>
                            <tbody>
                              {addressViewContacts
                                .filter(c => !addressViewSearch || 
                                  c.phone?.includes(addressViewSearch) || 
                                  c.name?.includes(addressViewSearch) ||
                                  c.extra1?.includes(addressViewSearch) ||
                                  c.extra2?.includes(addressViewSearch) ||
                                  c.extra3?.includes(addressViewSearch))
                                .slice(0, 10)
                                .map((c, i) => (
                                  <tr key={i} className="border-t hover:bg-gray-50">
                                    <td className="px-2 py-1">{c.phone}</td>
                                    <td className="px-2 py-1">{c.name || '-'}</td>
                                    <td className="px-2 py-1">{c.extra1 || '-'}</td>
                                    <td className="px-2 py-1">{c.extra2 || '-'}</td>
                                    <td className="px-2 py-1">{c.extra3 || '-'}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {addressViewContacts.filter(c => !addressViewSearch || 
                            c.phone?.includes(addressViewSearch) || 
                            c.name?.includes(addressViewSearch)).length > 10 && (
                            <div className="text-center text-xs text-gray-400 py-2">
                              상위 10건만 표시 (전체 {addressViewContacts.filter(c => !addressViewSearch || c.phone?.includes(addressViewSearch) || c.name?.includes(addressViewSearch)).length}건)
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {addressGroups.length > 5 && (
                <div className="flex justify-center items-center gap-2 mt-3">
                  <button
                    onClick={() => setAddressPage(p => Math.max(0, p - 1))}
                    disabled={addressPage === 0}
                    className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >◀</button>
                  <span className="text-sm text-gray-600">{addressPage + 1} / {Math.ceil(addressGroups.length / 5)}</span>
                  <button
                    onClick={() => setAddressPage(p => Math.min(Math.ceil(addressGroups.length / 5) - 1, p + 1))}
                    disabled={addressPage >= Math.ceil(addressGroups.length / 5) - 1}
                    className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >▶</button>
                </div>
              )}
            </>
            )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
          >닫기</button>
        </div>
      </div>
    </div>
  );
}
