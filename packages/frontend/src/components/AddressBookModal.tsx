import React, { useState } from 'react';
import { cellToString } from '../utils/formatDate';

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

  // ★ D144 P3 (2026-05-06): 다중 선택 + 직접 입력
  const [selectedGroupNames, setSelectedGroupNames] = useState<Set<string>>(new Set());
  const [directInputMode, setDirectInputMode] = useState(false);
  const [directInputRows, setDirectInputRows] = useState<{ phone: string; name: string; extra1: string; extra2: string; extra3: string }[]>(
    Array.from({ length: 5 }, () => ({ phone: '', name: '', extra1: '', extra2: '', extra3: '' }))
  );

  // ★ D185 (2026-05-20): 사용자 신고 — 대량 업로드(130,962건+) 시 로딩 안내 영역 누락 사고
  //   업로드 4 영역(직접입력 등록 / 파일 파싱 / 컬럼 매핑 저장 / 현재 수신자 저장) 영역에 로딩 오버레이 적용
  //   업로드 중 영역 = 모달 close 영역 차단 (중간 X 사고 영구 안전망)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingMsg, setUploadingMsg] = useState('주소록을 처리 중입니다...');

  // ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 기존 그룹에 번호 추가 모드
  //   null = 신규 그룹 신설 모드 / string = 기존 그룹명 (append endpoint 호출 분기)
  const [appendingGroupName, setAppendingGroupName] = useState<string | null>(null);


  // ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 그룹 단위 xlsx 다운로드
  const handleDownloadGroup = async (groupName: string) => {
    try {
      setIsUploading(true);
      setUploadingMsg(`${groupName} 다운로드 중...`);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/address-books/${encodeURIComponent(groupName)}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '다운로드 실패' }));
        setToast({ show: true, type: 'error', message: errData.error || '다운로드 실패' });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${groupName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setToast({ show: true, type: 'success', message: `${groupName} 다운로드 완료` });
      setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
    } catch (err: any) {
      setToast({ show: true, type: 'error', message: `다운로드 오류: ${err?.message || err}` });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
    } finally {
      setIsUploading(false);
    }
  };

  // ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 기존 그룹 안 번호 추가 모드 진입
  const handleStartAppend = (groupName: string) => {
    setAppendingGroupName(groupName);
    setNewGroupName(groupName); // 표시용 (read-only)
    setDirectInputMode(true);
    setDirectInputRows(Array.from({ length: 5 }, () => ({ phone: '', name: '', extra1: '', extra2: '', extra3: '' })));
  };

  // 업로드 중 영역 close 차단 영역 (사용자가 중간 X 영역 사고 차단)
  const safeOnClose = () => {
    if (isUploading) return;
    onClose();
  };

  const toggleGroupSelection = (groupName: string) => {
    setSelectedGroupNames(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName); else next.add(groupName);
      return next;
    });
  };

  const handleLoadMultipleGroups = async () => {
    if (selectedGroupNames.size === 0) return;
    const token = localStorage.getItem('token');
    const allContacts: { phone: string; name: string; extra1: string; extra2: string; extra3: string }[] = [];
    const seenPhones = new Set<string>();
    for (const groupName of selectedGroupNames) {
      try {
        const res = await fetch(`/api/address-books/${encodeURIComponent(groupName)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.contacts)) {
          for (const c of data.contacts) {
            const phone = String(c.phone || '').trim();
            if (!phone || seenPhones.has(phone)) continue;
            seenPhones.add(phone);
            allContacts.push({
              // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
              phone, name: cellToString(c.name), extra1: cellToString(c.extra1), extra2: cellToString(c.extra2), extra3: cellToString(c.extra3)
            });
          }
        }
      } catch (e) { /* 한 그룹 실패해도 다음 진행 */ }
    }
    setDirectRecipients(allContacts);
    setSelectedGroupNames(new Set());
    onClose();
    setToast({ show: true, type: 'success', message: `${selectedGroupNames.size}개 그룹 ${allContacts.length}명 불러오기 완료 (중복 제거)` });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

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
      // ★ D144 P3: 다중 선택 + 직접 입력 reset
      setSelectedGroupNames(new Set());
      setDirectInputMode(false);
      setDirectInputRows(Array.from({ length: 5 }, () => ({ phone: '', name: '', extra1: '', extra2: '', extra3: '' })));
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-xl shadow-2xl w-[750px] max-h-[85vh] overflow-hidden relative">
        {/* ★ D185: 업로드 영역 로딩 오버레이 (모달 본체 absolute 영역) */}
        {isUploading && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex items-center justify-center z-[70] rounded-xl">
            <div className="text-center px-8">
              <div className="inline-block w-14 h-14 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-5"></div>
              <div className="text-base font-semibold text-gray-800 mb-2">{uploadingMsg}</div>
              <div className="text-xs text-gray-500">창을 닫지 마세요. 처리가 완료되면 자동으로 안내됩니다.</div>
            </div>
          </div>
        )}
        <div className="px-6 py-4 border-b bg-amber-50 flex justify-between items-center">
          <h3 className="text-lg font-bold text-amber-700">📒 주소록</h3>
          <button
            onClick={safeOnClose}
            disabled={isUploading}
            className="text-gray-500 hover:text-gray-700 text-xl disabled:opacity-30 disabled:cursor-not-allowed"
            title={isUploading ? '업로드 처리 중에는 닫을 수 없습니다' : '닫기'}
          >✕</button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* ★ D144 P3-(a): 직접 입력 모드 토글 + 폼 */}
          {!addressSaveMode && !directInputMode && (
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => setDirectInputMode(true)}
                className="flex-1 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
              >✏️ 직접 입력으로 등록</button>
            </div>
          )}

          {/* 직접 입력 폼 */}
          {directInputMode && (
            <div className="mb-4 p-4 bg-emerald-50 rounded-lg border border-emerald-200">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-emerald-700">✏️ 직접 입력 ({directInputRows.filter(r => r.phone.trim()).length}건 입력)</div>
                <button
                  onClick={() => setDirectInputRows(prev => [...prev, { phone: '', name: '', extra1: '', extra2: '', extra3: '' }])}
                  className="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700"
                >+ 행 추가</button>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left text-xs">번호 *</th>
                      <th className="px-2 py-1 text-left text-xs">이름</th>
                      <th className="px-2 py-1 text-left text-xs">기타1</th>
                      <th className="px-2 py-1 text-left text-xs">기타2</th>
                      <th className="px-2 py-1 text-left text-xs">기타3</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {directInputRows.map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-1 py-1">
                          <input type="text" value={row.phone}
                            onChange={(e) => setDirectInputRows(prev => prev.map((r, i) => i === idx ? { ...r, phone: e.target.value } : r))}
                            placeholder="01012345678"
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={row.name}
                            onChange={(e) => setDirectInputRows(prev => prev.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))}
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={row.extra1}
                            onChange={(e) => setDirectInputRows(prev => prev.map((r, i) => i === idx ? { ...r, extra1: e.target.value } : r))}
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={row.extra2}
                            onChange={(e) => setDirectInputRows(prev => prev.map((r, i) => i === idx ? { ...r, extra2: e.target.value } : r))}
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={row.extra3}
                            onChange={(e) => setDirectInputRows(prev => prev.map((r, i) => i === idx ? { ...r, extra3: e.target.value } : r))}
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-1 py-1 text-center">
                          {directInputRows.length > 1 && (
                            <button
                              onClick={() => setDirectInputRows(prev => prev.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700 text-sm"
                              title="삭제"
                            >×</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* ★ D219+ Part 2 (2026-05-27) 박과장님 신고: appendingGroupName 시 기존 그룹 안내 + 그룹명 read-only */}
              {appendingGroupName && (
                <div className="mt-3 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-800">
                  📌 기존 그룹 <b>"{appendingGroupName}"</b> 에 번호를 추가합니다. (중복 번호는 자동 제외)
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm text-gray-600 w-20">그룹명 *</span>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => !appendingGroupName && setNewGroupName(e.target.value)}
                  placeholder="예: VIP고객"
                  readOnly={!!appendingGroupName}
                  className={`flex-1 px-3 py-2 border rounded-lg text-sm ${appendingGroupName ? 'bg-gray-100 cursor-not-allowed text-gray-600' : ''}`}
                />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={async () => {
                    const valid = directInputRows.filter(r => r.phone.trim().replace(/\D/g, '').length >= 10);
                    if (valid.length === 0) { alert('유효한 번호를 1건 이상 입력하세요'); return; }
                    if (!appendingGroupName && !newGroupName.trim()) { alert('그룹명을 입력하세요'); return; }
                    const token = localStorage.getItem('token');
                    setIsUploading(true);
                    setUploadingMsg(`주소록 ${appendingGroupName ? '추가' : '등록'} 중... ${valid.length.toLocaleString()}건 잠시만 기다려주세요`);
                    try {
                      // ★ D219+ Part 2 박과장님 신고: appendingGroupName 분기 — append endpoint 호출
                      const url = appendingGroupName
                        ? `/api/address-books/${encodeURIComponent(appendingGroupName)}/append`
                        : '/api/address-books';
                      const body = appendingGroupName
                        ? { contacts: valid }
                        : { groupName: newGroupName.trim(), contacts: valid };
                      const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify(body)
                      });
                      const data = await res.json();
                      if (data.success) {
                        setToast({ show: true, type: 'success', message: data.message });
                        setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                        setDirectInputMode(false);
                        setAppendingGroupName(null);
                        setNewGroupName('');
                        setDirectInputRows(Array.from({ length: 5 }, () => ({ phone: '', name: '', extra1: '', extra2: '', extra3: '' })));
                        const groupRes = await fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } });
                        const groupData = await groupRes.json();
                        if (groupData.success) setAddressGroups(groupData.groups || []);
                      } else { alert(data.error || '저장 실패'); }
                    } catch (err: any) {
                      alert(`네트워크 오류: ${err?.message || err}`);
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={isUploading}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >💾 {appendingGroupName ? '번호 추가 저장' : '주소록 저장'}</button>
                <button
                  onClick={() => {
                    setDirectInputMode(false);
                    setAppendingGroupName(null);
                    setNewGroupName('');
                    setDirectInputRows(Array.from({ length: 5 }, () => ({ phone: '', name: '', extra1: '', extra2: '', extra3: '' })));
                  }}
                  className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400"
                >취소</button>
              </div>
            </div>
          )}

          {/* 파일 업로드 영역 */}
          {!addressSaveMode && !directInputMode && (
            <div className="mb-4 p-4 border-2 border-dashed border-amber-300 rounded-lg text-center bg-amber-50">
              <label className="cursor-pointer">
                <div className="text-amber-600 mb-2">📁 파일을 선택하여 주소록 등록</div>
                <div className="text-xs text-gray-400 mb-3">Excel, CSV 파일 지원</div>
                <span className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 inline-block">파일 선택</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={isUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append('file', file);
                    setIsUploading(true);
                    setUploadingMsg(`파일을 분석하고 있습니다... (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
                    try {
                      const token = localStorage.getItem('token');
                      const res = await fetch('/api/upload/parse?includeData=true', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
                      const data = await res.json();
                      if (data.success) {
                        setAddressFileHeaders(data.headers || []);
                        setAddressFileData(data.allData || data.preview || []);
                        setAddressSaveMode(true);
                      } else {
                        alert(data.error || '파일 파싱 실패');
                      }
                    } catch (err: any) {
                      alert(`파일 파싱 실패: ${err?.message || err}`);
                    } finally {
                      setIsUploading(false);
                      e.target.value = '';
                    }
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
                      // ★ D150-3 (2026-05-09) PDF #5: 엑셀 0 값 보존
                      phone: cellToString(row[addressColumnMapping.phone]),
                      name: cellToString(row[addressColumnMapping.name]),
                      extra1: cellToString(row[addressColumnMapping.extra1]),
                      extra2: cellToString(row[addressColumnMapping.extra2]),
                      extra3: cellToString(row[addressColumnMapping.extra3]),
                    }));
                    const token = localStorage.getItem('token');
                    setIsUploading(true);
                    setUploadingMsg(`주소록 등록 중... ${contacts.length.toLocaleString()}건 처리에 수십초~수분 소요됩니다`);
                    try {
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
                    } catch (err: any) {
                      alert(`네트워크 오류: ${err?.message || err}`);
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={isUploading}
                  className="flex-1 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >💾 주소록 저장</button>
                <button
                  onClick={() => { setAddressSaveMode(false); setAddressFileData([]); setAddressColumnMapping({}); setNewGroupName(''); }}
                  disabled={isUploading}
                  className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    setIsUploading(true);
                    setUploadingMsg(`주소록 저장 중... ${directRecipients.length.toLocaleString()}건 잠시만 기다려주세요`);
                    try {
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
                    } catch (err: any) {
                      alert(`네트워크 오류: ${err?.message || err}`);
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={isUploading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >저장</button>
                <button
                  onClick={() => { setAddressSaveMode(false); setNewGroupName(''); }}
                  className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400"
                >취소</button>
              </div>
            </div>
          )}

          {/* 그룹 목록 */}
          {!addressSaveMode && !directInputMode && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-600">저장된 주소록</div>
                {/* ★ D144 P3-(b): 다중 선택 일괄 불러오기 */}
                {selectedGroupNames.size > 0 && (
                  <button
                    onClick={handleLoadMultipleGroups}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                  >
                    📥 선택 {selectedGroupNames.size}개 그룹 일괄 불러오기 (중복 제거)
                  </button>
                )}
              </div>
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
                      <div className="flex items-center gap-2">
                        {/* ★ D144 P3-(b): 다중 선택 체크박스 */}
                        <input
                          type="checkbox"
                          checked={selectedGroupNames.has(group.group_name)}
                          onChange={() => toggleGroupSelection(group.group_name)}
                          className="w-4 h-4 cursor-pointer accent-blue-600"
                          title="다중 선택"
                        />
                        <div>
                          <div className="font-medium">{group.group_name}</div>
                          <div className="text-sm text-gray-500">{group.count}명</div>
                        </div>
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
                                // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
                                phone: c.phone,
                                name: cellToString(c.name),
                                extra1: cellToString(c.extra1),
                                extra2: cellToString(c.extra2),
                                extra3: cellToString(c.extra3)
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
                        {/* ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 추가 버튼 */}
                        <button
                          onClick={() => handleStartAppend(group.group_name)}
                          disabled={isUploading}
                          className="px-3 py-1 bg-violet-100 text-violet-700 rounded hover:bg-violet-200 text-sm disabled:opacity-40"
                          title="기존 그룹에 번호 추가"
                        >+ 추가</button>
                        {/* ★ D219+ Part 2 (2026-05-27): 박과장님 신고 — 다운로드 버튼 (xlsx) */}
                        <button
                          onClick={() => handleDownloadGroup(group.group_name)}
                          disabled={isUploading}
                          className="px-3 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 text-sm disabled:opacity-40"
                          title="Excel 다운로드"
                        >↓ 다운로드</button>
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
