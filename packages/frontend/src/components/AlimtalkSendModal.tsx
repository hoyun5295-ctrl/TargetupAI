/**
 * 알림톡 발송 전용 풀 화면 모달 (D162-4 신규)
 *
 * Harold님 명시 의도 — 직접발송 모달에서 알림톡 채널을 squeeze하던 사고 영구 종결.
 * 알림톡 전용 큰 모달로 분리해 좌측 채널 패널 + 우측 수신자/변수 매칭/발송 영역이 충분한 공간에서 동작.
 * ALIMTALK-DESIGN.md §6-3-D 매뉴얼 정합 (발신프로필 + 템플릿 + 변수 매핑 + 부달 + 단가).
 *
 * 진입 경로:
 *  1) Dashboard 메뉴 "알림톡 발송" 클릭 → 본 모달 직접 진입
 *  2) Dashboard.tsx의 showAlimtalkSend state로 노출 관리
 *
 * 수신자 영역은 단순 직접입력(textarea) + 파일 업로드. DirectSendPanel의 복잡한 컬럼 매핑은 차후 통합.
 * 발송 흐름은 기존 DirectSendPanel의 handleAlimtalkSend와 동일 — onSendConfirm callback으로 위임.
 */

import { useState, useMemo } from 'react';
import { Bell, X, Contact } from 'lucide-react';
import AlimtalkChannelPanel, {
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import AlimtalkVariableMappingPanel from './alimtalk/AlimtalkVariableMappingPanel';
import AddressBookModal from './AddressBookModal';
import { normalizePhoneKr } from '../utils/formatDate';

export interface AlimtalkSendModalProps {
  show: boolean;
  onClose: () => void;

  // 데이터
  alimtalkSenders: AlimtalkSenderProfile[];
  alimtalkTemplates: AlimtalkTemplate[];
  customerFieldOptions: { key: string; label: string }[];

  // 알림톡 채널 state (Dashboard에서 관리)
  alimtalkProfileId: string;
  setAlimtalkProfileId: (id: string) => void;
  kakaoSelectedTemplate: any;
  setKakaoSelectedTemplate: (t: any) => void;
  kakaoTemplateVars: Record<string, string>;
  setKakaoTemplateVars: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  alimtalkFallback: 'N' | 'S' | 'L' | 'A' | 'B';
  setAlimtalkFallback: (f: 'N' | 'S' | 'L' | 'A' | 'B') => void;
  alimtalkNextContents: string;
  setAlimtalkNextContents: (v: string) => void;

  // 발송 핸들러 — Dashboard에서 위임받아 SendConfirm 모달 진입
  onSendConfirm: (data: {
    show: boolean;
    type: 'immediate';
    count: number;
    unsubscribeCount: number;
    duplicateCount: number;
    from: 'alimtalk';
    msgType: '알림톡';
    recipients: any[];
    selectedTemplate: any;
    variableMap: Record<string, string>;
    fallback: 'N' | 'S' | 'L' | 'A' | 'B';
    nextContents: string;
    profileId: string;
  }) => void;

  setToast: (t: { show: boolean; type: 'success' | 'error' | 'warning'; message: string }) => void;
}

export default function AlimtalkSendModal({
  show,
  onClose,
  alimtalkSenders,
  alimtalkTemplates,
  customerFieldOptions,
  alimtalkProfileId,
  setAlimtalkProfileId,
  kakaoSelectedTemplate,
  setKakaoSelectedTemplate,
  kakaoTemplateVars,
  setKakaoTemplateVars,
  alimtalkFallback,
  setAlimtalkFallback,
  alimtalkNextContents,
  setAlimtalkNextContents,
  onSendConfirm,
  setToast,
}: AlimtalkSendModalProps) {
  // 수신자 영역 — 알림톡 전용 state (직접발송 directRecipients와 격리)
  const [inputMode, setInputMode] = useState<'direct' | 'file' | 'address'>('direct');
  const [directInput, setDirectInput] = useState('');
  const [recipients, setRecipients] = useState<any[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [unsubFilterEnabled, setUnsubFilterEnabled] = useState(true);
  const [sending, setSending] = useState(false);
  // ★ D162-4 (2026-05-15) 2차: 주소록 진입 — Harold님 명시 정합. AddressBookModal 재사용 (recipients/setRecipients 위임).
  const [showAddressBook, setShowAddressBook] = useState(false);

  // AlimtalkChannelPanel 통합 state
  const channelState: AlimtalkChannelState = useMemo(
    () => ({
      profileId: alimtalkProfileId,
      templateCode: kakaoSelectedTemplate?.template_code || '',
      templateId: kakaoSelectedTemplate?.id || '',
      variableMap: kakaoTemplateVars,
      nextType: alimtalkFallback,
      nextContents: alimtalkNextContents,
    }),
    [
      alimtalkProfileId,
      kakaoSelectedTemplate,
      kakaoTemplateVars,
      alimtalkFallback,
      alimtalkNextContents,
    ],
  );

  const handleChannelChange = (v: AlimtalkChannelState) => {
    setAlimtalkProfileId(v.profileId);
    const nextTpl = alimtalkTemplates.find((t) => t.id === v.templateId) || null;
    setKakaoSelectedTemplate(nextTpl);
    setKakaoTemplateVars(v.variableMap);
    setAlimtalkFallback(v.nextType);
    setAlimtalkNextContents(v.nextContents);
  };

  // 직접입력 파싱 — 한 줄에 하나씩, 콤마/탭/공백 무시
  const parseDirectInput = () => {
    const lines = directInput
      .split(/[\n\r,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = lines
      .map((raw) => {
        const phone = normalizePhoneKr(raw);
        return phone ? { phone } : null;
      })
      .filter(Boolean) as any[];
    if (parsed.length === 0) {
      setToast({ show: true, type: 'error', message: '유효한 수신번호를 입력해주세요.' });
      return;
    }
    // 중복 제거
    const dedup = dedupEnabled
      ? Array.from(new Map(parsed.map((r) => [r.phone, r])).values())
      : parsed;
    setRecipients(dedup);
    setToast({
      show: true,
      type: 'success',
      message: `${dedup.length}건 ${dedupEnabled && dedup.length !== parsed.length ? `(중복 ${parsed.length - dedup.length}건 제거)` : ''} 추가됨`,
    });
  };

  // 파일 업로드 — 단순화 (phone 컬럼 자동 인식)
  const handleFileUpload = async (file: File) => {
    setFileLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/upload/parse?includeData=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        setToast({ show: true, type: 'error', message: data.error || '파일 파싱 실패' });
        return;
      }
      const allData: any[] = data.allData || data.preview || [];
      const headers: string[] = data.headers || [];
      const phoneCol =
        headers.find((h) => /휴대폰|전화|핸드폰|연락처|phone|mobile|hp/i.test(h)) || headers[0];
      if (!phoneCol) {
        setToast({ show: true, type: 'error', message: '수신번호 컬럼을 찾을 수 없습니다.' });
        return;
      }
      const parsed = allData
        .map((row) => {
          const phone = normalizePhoneKr(row[phoneCol]);
          if (!phone) return null;
          return { ...row, phone };
        })
        .filter(Boolean) as any[];
      const dedup = dedupEnabled
        ? Array.from(new Map(parsed.map((r) => [r.phone, r])).values())
        : parsed;
      setRecipients(dedup);
      setToast({
        show: true,
        type: 'success',
        message: `${dedup.length}건 업로드 완료${dedupEnabled && dedup.length !== parsed.length ? ` (중복 ${parsed.length - dedup.length}건 제거)` : ''}`,
      });
    } catch {
      setToast({ show: true, type: 'error', message: '파일 업로드 중 오류가 발생했습니다.' });
    } finally {
      setFileLoading(false);
    }
  };

  // 발송 — 직접발송과 동일 검증 + onSendConfirm 위임
  const handleSend = async () => {
    if (sending) return;
    if (recipients.length === 0) {
      setToast({ show: true, type: 'error', message: '수신자를 먼저 추가해주세요.' });
      return;
    }
    if (!kakaoSelectedTemplate) {
      setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요.' });
      return;
    }
    if (!['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate.status)) {
      setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다.' });
      return;
    }
    if (
      ['A', 'B'].includes(alimtalkFallback) &&
      !alimtalkNextContents.trim()
    ) {
      setToast({ show: true, type: 'error', message: '대체 문구를 입력해주세요.' });
      return;
    }
    setSending(true);
    try {
      const token = localStorage.getItem('token');
      const phones = recipients.map((r) => r.phone);
      let unsubCount = 0;
      let dupCount = 0;
      if (unsubFilterEnabled) {
        const checkRes = await fetch('/api/unsubscribes/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ phones }),
        });
        const checkData = await checkRes.json();
        unsubCount = checkData.unsubscribeCount || 0;
        dupCount = checkData.duplicateCount || 0;
      }
      onSendConfirm({
        show: true,
        type: 'immediate',
        count: recipients.length - unsubCount - dupCount,
        unsubscribeCount: unsubCount,
        duplicateCount: dupCount,
        from: 'alimtalk',
        msgType: '알림톡',
        recipients,
        selectedTemplate: kakaoSelectedTemplate,
        variableMap: kakaoTemplateVars,
        fallback: alimtalkFallback,
        nextContents: alimtalkNextContents,
        profileId: alimtalkProfileId,
      });
    } finally {
      setSending(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] h-[92vh] flex flex-col overflow-hidden"
        style={{ animation: 'zoomIn 0.2s ease-out' }}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Bell size={20} className="text-blue-600" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-gray-900">알림톡 발송</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                승인된 템플릿으로 즉시 발송합니다. 카카오톡 알림톡 전용 화면입니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        {/* 본문 — 2-col grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
          {/* 좌측: 알림톡 채널 */}
          <div className="p-5 overflow-y-auto border-r border-gray-100">
            <AlimtalkChannelPanel
              senders={alimtalkSenders}
              templates={alimtalkTemplates}
              customerFieldOptions={customerFieldOptions}
              value={channelState}
              onChange={handleChannelChange}
            />
          </div>

          {/* 우측: 수신자 + 변수 매칭 */}
          <div className="p-5 overflow-y-auto bg-gray-50/40 space-y-4">
            {/* 변수 매칭 */}
            <AlimtalkVariableMappingPanel
              selectedTemplate={kakaoSelectedTemplate}
              variableMap={kakaoTemplateVars}
              onVariableMapChange={(next) => setKakaoTemplateVars(next)}
              customerFieldOptions={customerFieldOptions}
              sampleRecipient={recipients[0] || null}
              recipientCount={recipients.length}
            />

            {/* 수신자 영역 */}
            <div className="bg-white rounded-2xl border-2 border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">👥</span>
                  <span className="text-sm font-semibold text-gray-800">수신자</span>
                  <span className="ml-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[11px] font-medium">
                    총 {recipients.length.toLocaleString()}건
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5"
                      checked={dedupEnabled}
                      onChange={(e) => setDedupEnabled(e.target.checked)}
                    />
                    <span className="text-gray-600">중복제거</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5"
                      checked={unsubFilterEnabled}
                      onChange={(e) => setUnsubFilterEnabled(e.target.checked)}
                    />
                    <span className="text-gray-600">수신거부제거</span>
                  </label>
                </div>
              </div>

              {/* ★ D162-4 (2026-05-15) 2차: 입력 방식 탭 — 직접입력 / 파일등록 / 주소록 3개로 확장.
                  Harold님 명시 "주소록에서 가져와서 보내는것도 추가" 정합. AddressBookModal 재사용으로 동작 일관성. */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setInputMode('direct')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                    inputMode === 'direct'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  직접입력
                </button>
                <label
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center cursor-pointer transition ${
                    inputMode === 'file'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {fileLoading ? '파일 분석중...' : '파일등록'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setInputMode('file');
                        handleFileUpload(f);
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setInputMode('address');
                    setShowAddressBook(true);
                  }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition inline-flex items-center justify-center gap-1 ${
                    inputMode === 'address'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Contact size={13} strokeWidth={1.75} />
                  <span>주소록</span>
                </button>
              </div>

              {/* 직접입력 영역 */}
              {inputMode === 'direct' && (
                <div className="space-y-2">
                  <textarea
                    value={directInput}
                    onChange={(e) => setDirectInput(e.target.value)}
                    rows={8}
                    placeholder={
                      '수신번호를 한 줄에 하나씩 입력 (또는 콤마/세미콜론 구분)\n예시:\n01012345678\n010-2345-6789'
                    }
                    className="w-full border border-gray-200 rounded-lg p-2 text-xs font-mono resize-y focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                  <button
                    type="button"
                    onClick={parseDirectInput}
                    className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition"
                  >
                    수신자로 추가
                  </button>
                </div>
              )}

              {/* 수신자 목록 */}
              {recipients.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">
                      수신번호 (최근 {Math.min(recipients.length, 50)}건 표시)
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecipients([])}
                      className="text-[11px] text-red-500 hover:text-red-600"
                    >
                      전체삭제
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {recipients.slice(0, 50).map((r, idx) => (
                          <tr
                            key={`${r.phone}-${idx}`}
                            className="border-b border-gray-100 last:border-0"
                          >
                            <td className="px-3 py-1 font-mono text-gray-700">{r.phone}</td>
                            <td className="px-3 py-1 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setRecipients((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-[11px] text-gray-400 hover:text-red-500"
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 — 발송 버튼 */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white shrink-0">
          <button
            type="button"
            onClick={handleSend}
            disabled={
              sending ||
              recipients.length === 0 ||
              !kakaoSelectedTemplate ||
              !['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status)
            }
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-base transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Bell size={18} strokeWidth={2} />
            <span>
              {sending
                ? '발송 준비중...'
                : recipients.length === 0
                  ? '수신자를 추가해주세요'
                  : !kakaoSelectedTemplate
                    ? '템플릿을 선택해주세요'
                    : `${recipients.length.toLocaleString()}명에게 알림톡 발송하기`}
            </span>
          </button>
        </div>

        <style>{`
          @keyframes zoomIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>

      {/* ★ D162-4 (2026-05-15) 2차: 주소록 모달 — Harold님 명시 정합. recipients/setRecipients position에 위임 → 그룹 선택 시 자동 박힘. */}
      <AddressBookModal
        show={showAddressBook}
        onClose={() => setShowAddressBook(false)}
        directRecipients={recipients}
        setDirectRecipients={setRecipients}
        setToast={setToast}
      />
    </div>
  );
}
