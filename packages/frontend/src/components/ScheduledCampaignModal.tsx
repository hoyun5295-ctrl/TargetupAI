import React, { useState, useRef } from 'react';
import { calculateSmsBytes, buildAdSubjectFront, mmsServerPathToUrl } from '../utils/formatDate';
import { getMmsImagePath, getMmsImageDisplayName } from '../utils/mmsImage';

interface ScheduledCampaignModalProps {
  show: boolean;
  onClose: () => void;
  scheduledCampaigns: any[];
  setScheduledCampaigns: React.Dispatch<React.SetStateAction<any[]>>;
  setToast: (t: { show: boolean; type: 'error' | 'success'; message: string }) => void;
}

export default function ScheduledCampaignModal({
  show,
  onClose,
  scheduledCampaigns,
  setScheduledCampaigns,
  setToast,
}: ScheduledCampaignModalProps) {
  const [selectedScheduled, setSelectedScheduled] = useState<any>(null);
  const [scheduledRecipients, setScheduledRecipients] = useState<any[]>([]);
  const [scheduledRecipientsTotal, setScheduledRecipientsTotal] = useState(0);
  const [scheduledSearch, setScheduledSearch] = useState('');
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledHasMore, setScheduledHasMore] = useState(false);
  const [editScheduleTime, setEditScheduleTime] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{show: boolean, phone: string, idx: number | null}>({show: false, phone: '', idx: null});
  const [cancelConfirm, setCancelConfirm] = useState<{show: boolean, campaign: any}>({show: false, campaign: null});
  const [messagePreview, setMessagePreview] = useState<{show: boolean, phone: string, message: string}>({show: false, phone: '', message: ''});
  const [messageEditModal, setMessageEditModal] = useState(false);
  const [editMessage, setEditMessage] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [messageEditProgress, setMessageEditProgress] = useState(0);
  const [messageEditing, setMessageEditing] = useState(false);

  // ★ D111 P4: 캠페인 선택 race condition 차단 — 응답 도착 시점에 여전히 같은 캠페인이 선택돼 있는지 확인
  //   (이전 버그: A 클릭 → B 클릭 → A 응답이 B 후에 도착 → B 수신자를 A로 덮어쓰기)
  const latestSelectedIdRef = useRef<string | null>(null);

  const isWithin15Min = (scheduledAt: string | null) => {
    if (!scheduledAt) return false;
    return (new Date(scheduledAt).getTime() - Date.now()) < 15 * 60 * 1000;
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] overflow-hidden">
        <div className="p-4 border-b bg-red-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">⏰ 예약 대기 {scheduledCampaigns.length > 0 && `(${scheduledCampaigns.length}건)`}</h3>
          <button onClick={() => {
            // ★ D111 P4: 닫기 시 선택/수신자/ref 전부 초기화 (stale 데이터 잔존 방지)
            onClose();
            setSelectedScheduled(null);
            setScheduledRecipients([]);
            setScheduledRecipientsTotal(0);
            setScheduledHasMore(false);
            latestSelectedIdRef.current = null;
          }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        <div className="flex h-[70vh]">
          {/* 좌측: 캠페인 목록 */}
          <div className="w-[320px] border-r overflow-y-auto p-3 space-y-2">
            {scheduledCampaigns.length > 0 ? (
              scheduledCampaigns.map((c: any) => (
                <div 
                  key={c.id} 
                  onClick={async () => {
                    // ★ D111 P4: latest id 기록 + 선택 state 즉시 초기화 (이전 데이터 잔존 방지)
                    latestSelectedIdRef.current = c.id;
                    setSelectedScheduled(c);
                    setScheduledRecipients([]);
                    setScheduledRecipientsTotal(0);
                    setScheduledHasMore(false);
                    setScheduledLoading(true);
                    setScheduledSearch('');
                    try {
                      const token = localStorage.getItem('token');
                      const res = await fetch(`/api/campaigns/${c.id}/recipients?limit=50&offset=0`, {
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      const data = await res.json();
                      // ★ D111 P4: race guard — 응답 도착 시점에 다른 캠페인으로 이동했으면 무시
                      if (latestSelectedIdRef.current !== c.id) return;
                      if (data.success) {
                        setScheduledRecipients(data.recipients || []);
                        setScheduledRecipientsTotal(data.total || 0);
                        setScheduledHasMore(data.hasMore || false);
                        setEditScheduleTime(c.scheduled_at ? (() => { const d = new Date(c.scheduled_at); const pad = (n: number) => n.toString().padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; })() : '');
                      }
                    } catch (err) {
                      console.error(err);
                    } finally {
                      // latest와 같을 때만 로딩 해제
                      if (latestSelectedIdRef.current === c.id) setScheduledLoading(false);
                    }
                  }}
                  className={`p-3 border rounded-lg cursor-pointer transition-all ${selectedScheduled?.id === c.id ? 'border-red-400 bg-red-50' : 'hover:border-gray-400'}`}
                >
                  <div className="font-semibold text-gray-800 text-sm truncate">{c.campaign_name}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    📱 {c.message_type} · 👥 {c.target_count?.toLocaleString()}명
                    {c.status === 'draft' && <span className="ml-1 text-amber-600 font-medium">(미확정)</span>}
                  </div>
                  <div className="text-xs text-blue-600 mt-1">
                    ⏰ {c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center py-8 text-sm">예약된 캠페인이 없습니다</p>
            )}
          </div>
          
          {/* 우측: 상세 & 수신자 */}
          <div className="flex-1 flex flex-col">
            {selectedScheduled ? (
              <>
                {/* 상단: 캠페인 정보 */}
                <div className="p-4 border-b bg-gray-50">
                <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-bold text-lg">{selectedScheduled.campaign_name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {selectedScheduled.message_type} · {selectedScheduled.target_count?.toLocaleString()}명
                      </div>
                      {/* LMS/MMS 제목 표시 */}
                      {(selectedScheduled.message_type === 'LMS' || selectedScheduled.message_type === 'MMS') && (selectedScheduled.message_subject || selectedScheduled.subject) && (
                        <div className="text-sm text-blue-600 mt-1">
                          📋 제목: {buildAdSubjectFront(selectedScheduled.message_subject || selectedScheduled.subject || '', selectedScheduled.message_type, selectedScheduled.is_ad ?? false)}
                        </div>
                      )}
                      {/* 회신번호 표시 */}
                      {selectedScheduled.callback_number && (
                        <div className="text-sm text-gray-500 mt-1">
                          📞 회신번호: {selectedScheduled.callback_number}
                        </div>
                      )}
                      {/* ★ B7(0417 PDF #7): MMS 이미지 표시 */}
                      {(() => {
                        let mmsImages = selectedScheduled.mms_image_paths;
                        if (typeof mmsImages === 'string') {
                          try { mmsImages = JSON.parse(mmsImages); } catch { mmsImages = null; }
                        }
                        if (!Array.isArray(mmsImages) || mmsImages.length === 0) return null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-2 min-w-0 max-w-full">
                            {mmsImages.map((imgItem: any, idx: number) => {
                              const serverPath = getMmsImagePath(imgItem);
                              const filename = getMmsImageDisplayName(imgItem, `이미지${idx + 1}`);
                              const url = mmsServerPathToUrl(serverPath);
                              return (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={filename}
                                  title={filename}
                                  className="w-16 h-16 object-cover rounded border shrink-0"
                                />
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCancelConfirm({ show: true, campaign: selectedScheduled })}
                        disabled={isWithin15Min(selectedScheduled?.scheduled_at)}
                        className={`px-3 py-1.5 rounded text-sm ${
                          isWithin15Min(selectedScheduled?.scheduled_at)
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-red-500 text-white hover:bg-red-600'
                        }`}
                      >예약취소</button>
                    </div>
                  </div>
                </div>
              
              {/* 수신자 검색 */}
              <div className="p-3 border-b flex items-center gap-2">
                <input
                  type="text"
                  placeholder="🔍 번호 검색 (Enter)"
                  value={scheduledSearch}
                  onChange={(e) => setScheduledSearch(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && selectedScheduled) {
                      const campaignIdAtSearch = selectedScheduled.id;  // ★ D111 P4: closure 고정
                      setScheduledLoading(true);
                      try {
                        const token = localStorage.getItem('token');
                        const searchParam = scheduledSearch ? `&search=${encodeURIComponent(scheduledSearch)}` : '';
                        const res = await fetch(`/api/campaigns/${campaignIdAtSearch}/recipients?limit=50&offset=0${searchParam}`, {
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        const data = await res.json();
                        // ★ D111 P4: race guard
                        if (latestSelectedIdRef.current !== campaignIdAtSearch) return;
                        if (data.success) {
                          setScheduledRecipients(data.recipients || []);
                          setScheduledRecipientsTotal(data.total || 0);
                          setScheduledHasMore(data.hasMore || false);
                        }
                      } catch (err) { console.error(err); }
                      finally {
                        if (latestSelectedIdRef.current === campaignIdAtSearch) setScheduledLoading(false);
                      }
                    }
                  }}
                  className="flex-1 border rounded px-3 py-2 text-sm"
                />
                <span className="text-sm text-gray-500 shrink-0">
                  {scheduledRecipients.length} / {scheduledRecipientsTotal.toLocaleString()}명
                </span>
              </div>
              
              {/* 수신자 목록 */}
              <div className="flex-1 overflow-y-auto">
                {scheduledLoading ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    <span className="animate-spin mr-2">⏳</span> 로딩중...
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">번호</th>
                        <th className="px-3 py-2 text-left">회신번호</th>
                        <th className="px-3 py-2 text-center">메시지</th>
                        <th className="px-3 py-2 text-center w-16">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduledRecipients
                        .map((r: any) => (
                          <tr key={r.idx || r.phone} className="border-t hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs">{r.phone}</td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.callback || '-'}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => setMessagePreview({show: true, phone: r.phone, message: r.message || ''})}
                                className="px-2 py-1 bg-blue-100 text-blue-600 rounded text-xs hover:bg-blue-200"
                              >상세보기</button>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => setDeleteConfirm({show: true, phone: r.phone, idx: r.idx})}
                                className="text-red-500 hover:text-red-700"
                              >🗑️</button>
                            </td>
                          </tr>
                        ))}
                      {/* 더 보기 */}
                      {scheduledHasMore && (
                        <tr>
                          <td colSpan={4} className="py-3 text-center">
                            <button
                              onClick={async () => {
                                const campaignIdAtLoad = selectedScheduled.id;  // ★ D111 P4: closure 고정
                                try {
                                  const token = localStorage.getItem('token');
                                  const searchParam = scheduledSearch ? `&search=${encodeURIComponent(scheduledSearch)}` : '';
                                  const res = await fetch(`/api/campaigns/${campaignIdAtLoad}/recipients?limit=50&offset=${scheduledRecipients.length}${searchParam}`, {
                                    headers: { Authorization: `Bearer ${token}` }
                                  });
                                  const data = await res.json();
                                  // ★ D111 P4: 다른 캠페인으로 이동했으면 더보기 결과 무시
                                  if (latestSelectedIdRef.current !== campaignIdAtLoad) return;
                                  if (data.success) {
                                    setScheduledRecipients(prev => [...prev, ...(data.recipients || [])]);
                                    setScheduledHasMore(data.hasMore || false);
                                  }
                                } catch (err) { console.error(err); }
                              }}
                              className="px-6 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600 font-medium transition-colors"
                            >▼ 더 보기 ({scheduledRecipientsTotal - scheduledRecipients.length}건 남음)</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              ← 캠페인을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
    {/* 삭제 확인 모달 */}
    {deleteConfirm.show && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-2xl shadow-2xl w-[360px] overflow-hidden">
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🗑️</span>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">수신자 삭제</h3>
            <p className="text-gray-600 mb-1">다음 번호를 삭제하시겠습니까?</p>
            <p className="text-xl font-bold text-red-600 mb-4">{deleteConfirm.phone}</p>
            <p className="text-sm text-gray-400">삭제된 번호는 이 예약에서 발송되지 않습니다.</p>
          </div>
          <div className="flex border-t">
            <button
              onClick={() => setDeleteConfirm({show: false, phone: '', idx: null})}
              className="flex-1 py-3.5 text-gray-600 hover:bg-gray-50 font-medium transition-colors"
            >취소</button>
            <button
              onClick={async () => {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/campaigns/${selectedScheduled.id}/recipients/${encodeURIComponent(deleteConfirm.phone)}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.success) {
                  setScheduledRecipients(prev => prev.filter(x => x.phone !== deleteConfirm.phone));
                  setScheduledRecipientsTotal(data.remainingCount);
                  setScheduledCampaigns(prev => prev.map(c => 
                    c.id === selectedScheduled.id ? { ...c, target_count: data.remainingCount } : c
                  ));
                  setSelectedScheduled({ ...selectedScheduled, target_count: data.remainingCount });
                  setToast({ show: true, type: 'success', message: '삭제되었습니다' });
                  setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                } else {
                  setToast({ show: true, type: 'error', message: data.error || '삭제 실패' });
                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                }
                setDeleteConfirm({show: false, phone: '', idx: null});
              }}
              disabled={isWithin15Min(selectedScheduled?.scheduled_at)}
              className={`flex-1 py-3.5 font-medium transition-colors ${
                isWithin15Min(selectedScheduled?.scheduled_at)
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >삭제</button>
          </div>
        </div>
      </div>
    )}
    {/* 예약취소 확인 모달 */}
    {cancelConfirm.show && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden animate-in fade-in zoom-in duration-200">
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🚫</span>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">예약 취소</h3>
            <p className="text-gray-600 mb-1">다음 캠페인을 취소하시겠습니까?</p>
            <p className="text-sm font-bold text-red-600 mb-1">{cancelConfirm.campaign?.campaign_name}</p>
            <p className="text-xs text-gray-400">👥 {cancelConfirm.campaign?.target_count?.toLocaleString()}명 대상</p>
            <p className="text-xs text-red-400 mt-2">취소된 캠페인은 복구할 수 없습니다.</p>
          </div>
          <div className="flex border-t">
            <button
              onClick={() => setCancelConfirm({show: false, campaign: null})}
              className="flex-1 py-3.5 text-gray-600 hover:bg-gray-50 font-medium transition-colors"
            >돌아가기</button>
            <button
              onClick={async () => {
                const token = localStorage.getItem('token');
                const isDraft = cancelConfirm.campaign?.status === 'draft';
                // draft: DELETE로 삭제 / scheduled: POST cancel로 취소
                const res = isDraft
                  ? await fetch(`/api/campaigns/${cancelConfirm.campaign.id}`, {
                      method: 'DELETE',
                      headers: { Authorization: `Bearer ${token}` }
                    })
                  : await fetch(`/api/campaigns/${cancelConfirm.campaign.id}/cancel`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` }
                    });
                const data = await res.json();
                if (data.success) {
                  setToast({ show: true, type: 'success', message: isDraft ? '캠페인이 삭제되었습니다' : '예약이 취소되었습니다' });
                  setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                  setScheduledCampaigns(prev => prev.filter(c => c.id !== cancelConfirm.campaign.id));
                  setSelectedScheduled(null);
                } else {
                  setToast({ show: true, type: 'error', message: data.error || '취소 실패' });
                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                }
                setCancelConfirm({show: false, campaign: null});
              }}
              className="flex-1 py-3.5 bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
            >취소 확정</button>
          </div>
        </div>
      </div>
    )}
    {/* 메시지 상세보기 모달 */}
    {messagePreview.show && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
          <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-blue-700">💬 메시지 내용</h3>
              <p className="text-sm text-blue-600 mt-1">{messagePreview.phone}</p>
            </div>
            <button 
              onClick={() => setMessagePreview({show: false, phone: '', message: ''})}
              className="text-gray-500 hover:text-gray-700 text-xl"
            >✕</button>
          </div>
          <div className="p-4">
            {/* ★ D123 P7: 드래그 복사 가능하도록 select-text + cursor-text 명시 */}
            <div className="bg-gray-100 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed max-h-[400px] overflow-y-auto select-text cursor-text">
              {messagePreview.message}
            </div>
          </div>
          <div className="p-4 border-t">
            <button
              onClick={() => setMessagePreview({show: false, phone: '', message: ''})}
              className="w-full py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
            >확인</button>
          </div>
        </div>
      </div>
    )}
    {/* 문안 수정 모달 */}
    {messageEditModal && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
          <div className="p-4 border-b bg-amber-50">
            <h3 className="text-lg font-bold text-amber-700">✏️ 문안 수정</h3>
            <p className="text-sm text-amber-600 mt-1">변수: %이름%, %등급%, %지역%, %회신번호%</p>
          </div>
          <div className="p-4 space-y-4">
            {(selectedScheduled?.message_type === 'LMS' || selectedScheduled?.message_type === 'MMS') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <div className="relative">
                  {selectedScheduled?.is_ad && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                  )}
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={selectedScheduled?.is_ad ? "제목 입력" : "제목 입력"}
                    style={selectedScheduled?.is_ad ? { paddingLeft: '52px' } : {}}
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">메시지 내용</label>
              <textarea
                value={editMessage}
                onChange={(e) => setEditMessage(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 h-40 resize-none"
                placeholder="메시지 내용 입력"
              />
              <div className="text-right text-sm text-gray-500 mt-1">
                {/* ★ D95: 바이트 계산 — formatDate.ts 컨트롤타워 사용 */}
                {calculateSmsBytes(editMessage)} bytes
              </div>
            </div>
            {messageEditing && (
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-blue-700">수정 중...</span>
                  <span className="text-blue-700 font-bold">{messageEditProgress}%</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${messageEditProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex border-t">
            <button
              onClick={() => setMessageEditModal(false)}
              disabled={messageEditing}
              className="flex-1 py-3.5 text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50"
            >취소</button>
            <button
              onClick={async () => {
                if (!editMessage.trim()) {
                  setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' });
                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                  return;
                }
                // LMS/MMS는 제목 필수
                if ((selectedScheduled?.message_type === 'LMS' || selectedScheduled?.message_type === 'MMS') && !editSubject.trim()) {
                  setToast({ show: true, type: 'error', message: 'LMS/MMS는 제목이 필수입니다' });
                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                  return;
                }
                
                setMessageEditing(true);
                setMessageEditProgress(0);
                
                // 진행률 폴링
                const progressInterval = setInterval(async () => {
                  try {
                    const token = localStorage.getItem('token');
                    const res = await fetch(`/api/campaigns/${selectedScheduled.id}/message/progress`, {
                      headers: { Authorization: `Bearer ${token}` }
                    });
                    const data = await res.json();
                    setMessageEditProgress(data.percent || 0);
                  } catch (e) {}
                }, 500);
                
                try {
                  const token = localStorage.getItem('token');
                  const res = await fetch(`/api/campaigns/${selectedScheduled.id}/message`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ message: editMessage, subject: editSubject })
                  });
                  const data = await res.json();
                  
                  clearInterval(progressInterval);
                  setMessageEditProgress(100);
                  
                  if (data.success) {
                    setToast({ show: true, type: 'success', message: data.message || `${data.updatedCount?.toLocaleString()}건 문안 수정 완료` });
                    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                    setMessageEditModal(false);
                    // 캠페인 정보 업데이트
                    setSelectedScheduled({ ...selectedScheduled, message_template: editMessage, message_subject: editSubject });
                  } else {
                    setToast({ show: true, type: 'error', message: data.error || '수정 실패' });
                    setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                  }
                } catch (err) {
                  clearInterval(progressInterval);
                  setToast({ show: true, type: 'error', message: '수정 실패' });
                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                } finally {
                  setMessageEditing(false);
                }
              }}
              disabled={messageEditing}
              className="flex-1 py-3.5 bg-amber-500 text-white hover:bg-amber-600 font-medium disabled:opacity-50"
            >{messageEditing ? '수정 중...' : '수정하기'}</button>
          </div>
        </div>
      </div>
    )}
  </div>
  );
}
