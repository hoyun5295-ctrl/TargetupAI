import { useState, useEffect } from 'react';
import {
  Rocket, X, FileText, Phone, Clock, Calendar, Zap, AlertTriangle,
  Bot, Smartphone, Loader2,
} from 'lucide-react';
import { highlightVars, mergeAndHighlightVars } from '../utils/highlightVars';
import { formatPhoneNumber, buildAdMessageFront, buildAdSubjectFront } from '../utils/formatDate';
import MmsImagePreview from './shared/MmsImagePreview';

interface AiCampaignSendModalProps {
  onClose: () => void;
  onSend: (data: {
    campaignName: string;
    sendTimeOption: 'ai' | 'now' | 'custom';
    customSendTime: string;
    selectedCallback: string;
    useIndividualCallback: boolean;
    individualCallbackColumn?: string;
    subject?: string;
  }) => void;
  isSending: boolean;
  messageText: string;
  selectedChannel: string;
  suggestedCampaignName: string;
  recommendedTime: string;
  targetDescription: string;
  targetCount: number;
  callbackNumbers: { id: string; phone: string; label: string; is_default: boolean }[];
  defaultCallback: string;
  defaultUseIndividual: boolean;
  isAd: boolean;
  optOutNumber: string;
  phoneFields?: string[];  // D103: 전화번호 필드 목록
  mmsImages?: { url: string }[];
  subject?: string;
  usePersonalization?: boolean;
  sampleCustomer?: Record<string, string>;
}

export default function AiCampaignSendModal({
  onClose,
  onSend,
  isSending,
  messageText,
  selectedChannel,
  suggestedCampaignName,
  recommendedTime,
  targetDescription,
  targetCount,
  callbackNumbers,
  defaultCallback,
  defaultUseIndividual,
  isAd,
  optOutNumber,
  mmsImages,
  subject,
  usePersonalization,
  sampleCustomer,
  phoneFields,
}: AiCampaignSendModalProps) {
  const [campaignName, setCampaignName] = useState(suggestedCampaignName || '');
  const [sendTimeOption, setSendTimeOption] = useState<'ai' | 'now' | 'custom'>('ai');
  const [customSendTime, setCustomSendTime] = useState('');
  const [selectedCallback, setSelectedCallback] = useState(defaultCallback);
  const [useIndividualCallback, setUseIndividualCallback] = useState(defaultUseIndividual);
  const [individualCallbackColumn, setIndividualCallbackColumn] = useState(
    defaultUseIndividual ? (phoneFields?.[0] || 'store_phone') : ''
  );
  // B-D75-01: LMS/MMS 제목 수정 가능하도록 state 관리
  const [editSubject, setEditSubject] = useState(subject || '');
  // 검수리스트 UX: 머지 미리보기 토글
  const [showMergedPreview, setShowMergedPreview] = useState(false);
  // 신규 — alert 대체 inline error state
  const [error, setError] = useState('');

  useEffect(() => {
    if (!recommendedTime) setSendTimeOption('now');
  }, [recommendedTime]);

  const handleSend = () => {
    if (!campaignName.trim()) {
      setError('캠페인명을 입력해주세요');
      return;
    }
    if (!selectedCallback && !useIndividualCallback) {
      setError('회신번호를 선택해주세요');
      return;
    }
    if (sendTimeOption === 'custom' && !customSendTime) {
      setError('발송 시간을 선택해주세요');
      return;
    }
    setError('');
    onSend({
      campaignName,
      sendTimeOption,
      customSendTime,
      selectedCallback,
      useIndividualCallback,
      // D103: 개별회신번호 선택 시 동적 컬럼 전달
      individualCallbackColumn: useIndividualCallback ? individualCallbackColumn : undefined,
      subject: (selectedChannel === 'LMS' || selectedChannel === 'MMS') ? editSubject : undefined,
    });
  };

  // D93: 발송 확인창 — %변수% 원본 + 하이라이트
  const getPreviewMessage = () => {
    // D102: buildAdMessageFront 컨트롤타워 사용
    return buildAdMessageFront(messageText || '', selectedChannel, isAd, optOutNumber);
  };

  // AI 추천시간 과거 여부
  const isRecommendedTimePast = () => {
    if (!recommendedTime) return false;
    const t = recommendedTime;
    let d: Date | null = null;
    if (t.includes('T') || t.match(/^\d{4}-\d{2}-\d{2}/)) d = new Date(t);
    else {
      const m = t.match(/(\d+)월\s*(\d+)일.*?(\d{1,2}):?(\d{2})?/);
      if (m) d = new Date(new Date().getFullYear(), parseInt(m[1]) - 1, parseInt(m[2]), parseInt(m[3]), parseInt(m[4] || '0'));
    }
    return d ? d.getTime() <= Date.now() : false;
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[55]">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none">

        {/* sticky 헤더 */}
        <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-bold text-lg">AI 추천 결과 — 메시지 & 발송</h3>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-400/30 rounded">BETA</span>
              </div>
              <div className="text-xs text-white/50 mt-0.5">캠페인 정보를 확인하고 발송합니다</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors shrink-0" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 overflow-y-auto flex-1">
          <div className="flex gap-5 max-md:flex-col">

            {/* 좌측: 폰 미리보기 */}
            <div className="shrink-0 mx-auto">
              <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-violet-400 to-fuchsia-500 shadow-lg shadow-violet-500/30">
                <div className="bg-slate-900 rounded-[1.6rem] overflow-hidden flex flex-col w-[260px]" style={{ height: '440px' }}>
                  {/* 폰 헤더 — 다크 톤 */}
                  <div className="px-4 py-2.5 bg-gradient-to-r from-slate-950 to-violet-950/30 flex justify-between items-center shrink-0 border-b border-white/5">
                    <span className="text-[11px] text-white/40 font-medium">문자메시지</span>
                    <span className="text-[11px] font-bold text-violet-300">
                      {useIndividualCallback ? '수신자별' : formatPhoneNumber(selectedCallback) || '회신번호'}
                    </span>
                  </div>
                  {/* LMS/MMS 제목 — amber 액센트 */}
                  {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && editSubject && (
                    <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-400/20 shrink-0">
                      <span className="text-[11px] font-bold text-amber-300">{buildAdSubjectFront(editSubject, selectedChannel, isAd)}</span>
                    </div>
                  )}
                  {/* 메시지 영역 — 화이트 (실제 폰 시각 보존) */}
                  <div className="flex-1 overflow-y-auto p-3 bg-white">
                    {usePersonalization && sampleCustomer && Object.keys(sampleCustomer).length > 0 && (
                      <div className="flex items-center gap-1 mb-2 px-1">
                        <button
                          onClick={() => setShowMergedPreview(false)}
                          className={`flex-1 text-[10px] py-1 rounded transition-colors ${!showMergedPreview ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-gray-50 text-gray-400'}`}
                          title="개인화 변수가 어디에 들어갈지 강조 표시"
                        >변수 강조</button>
                        <button
                          onClick={() => setShowMergedPreview(true)}
                          className={`flex-1 text-[10px] py-1 rounded transition-colors ${showMergedPreview ? 'bg-violet-100 text-violet-800 font-bold' : 'bg-gray-50 text-gray-400'}`}
                          title="첫 고객 데이터로 실제 치환된 결과 미리보기"
                        >머지 결과</button>
                      </div>
                    )}
                    {mmsImages && mmsImages.length > 0 && (
                      <MmsImagePreview images={mmsImages} size="full" compact />
                    )}
                    <div className="flex gap-2 mt-1">
                      <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                        <Smartphone className="w-3.5 h-3.5 text-violet-600" />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm p-3 shadow-sm border text-[12px] leading-[1.7] whitespace-pre-wrap break-all text-gray-700 max-w-[95%] bg-white border-gray-100">
                        {showMergedPreview && sampleCustomer
                          ? mergeAndHighlightVars(getPreviewMessage(), sampleCustomer)
                          : highlightVars(getPreviewMessage()) || '메시지 없음'}
                      </div>
                    </div>
                  </div>
                  {/* 하단 — 다크 톤 */}
                  <div className="px-3 py-2 border-t border-white/5 bg-slate-950 text-center shrink-0">
                    <span className="text-[10px] text-white/40">{selectedChannel}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 우측: 발송 설정 */}
            <div className="flex-1 min-w-0 space-y-5">

              {/* 에러 안내 — inline (alert 정정) */}
              {error && (
                <div className="rounded-lg bg-rose-500/10 border border-rose-400/30 px-3 py-2.5 flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
                  <span className="text-sm text-rose-300">{error}</span>
                </div>
              )}

              {/* 캠페인명 */}
              <div>
                <label className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-violet-300" />
                  캠페인명
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="캠페인명을 입력하세요"
                  className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/30 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all"
                />
              </div>

              {/* LMS/MMS 제목 — amber 액센트 */}
              {(selectedChannel === 'LMS' || selectedChannel === 'MMS') && (
                <div>
                  <label className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-300" />
                    LMS 제목
                  </label>
                  <div className="relative">
                    {isAd && (
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-amber-300 font-medium pointer-events-none select-none">(광고) </span>
                    )}
                    <input
                      type="text"
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      placeholder={isAd ? "제목 입력" : "LMS 제목을 입력하세요"}
                      style={isAd ? { paddingLeft: '56px' } : {}}
                      maxLength={40}
                      className="w-full bg-white/5 border border-amber-400/30 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/30 focus:border-amber-400/60 focus:ring-2 focus:ring-amber-500/20 focus:outline-none transition-all"
                    />
                  </div>
                  <div className="text-xs text-white/40 mt-1 text-right">{editSubject.length}/40자</div>
                </div>
              )}

              {/* 회신번호 */}
              <div>
                <label className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-violet-300" />
                  회신번호
                </label>
                <select
                  value={useIndividualCallback ? `__col__${individualCallbackColumn}` : selectedCallback}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith('__col__')) {
                      setUseIndividualCallback(true);
                      setSelectedCallback('');
                      setIndividualCallbackColumn(val.replace('__col__', ''));
                    } else {
                      setUseIndividualCallback(false);
                      setSelectedCallback(val);
                      setIndividualCallbackColumn('');
                    }
                  }}
                  className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all"
                >
                  <option value="" className="bg-slate-900">회신번호 선택</option>
                  {/* D103: phoneFields 기반 동적 표시 */}
                  {phoneFields && phoneFields.length > 0 && (
                    <optgroup label="수신자별 회신번호 컬럼" className="bg-slate-900">
                      {phoneFields.map(k => (
                        <option key={k} value={`__col__${k}`} className="bg-slate-900">{k === 'store_phone' ? '매장전화번호' : k} (수신자별)</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="등록된 회신번호" className="bg-slate-900">
                    {callbackNumbers.map((cb) => (
                      <option key={cb.id} value={cb.phone} className="bg-slate-900">
                        {cb.phone ? `${cb.phone}${cb.label ? ` (${cb.label})` : ''}` : cb.label}{cb.is_default ? ' (기본)' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {useIndividualCallback && individualCallbackColumn && (
                  <p className="text-xs text-violet-300 mt-1">각 수신자의 <strong>{individualCallbackColumn === 'store_phone' ? '매장전화번호' : individualCallbackColumn}</strong> 값으로 발송됩니다</p>
                )}
              </div>

              {/* 발송시간 */}
              <div>
                <label className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-violet-300" />
                  발송시간
                </label>
                <div className="space-y-2">
                  {/* AI 추천시간 */}
                  {recommendedTime && (
                    <label
                      onClick={() => setSendTimeOption('ai')}
                      className={`block p-3 border rounded-xl cursor-pointer transition-all ${
                        sendTimeOption === 'ai'
                          ? 'border-violet-400/50 bg-violet-500/10 shadow-md shadow-violet-500/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sendTimeOption === 'ai' ? 'border-violet-400' : 'border-white/30'}`}>
                            {sendTimeOption === 'ai' && <div className="w-2 h-2 rounded-full bg-violet-400" />}
                          </div>
                          <Bot className="w-4 h-4 text-violet-300" />
                          <span className="font-medium text-sm text-white/90">AI 추천시간</span>
                        </div>
                        <span className="text-sm text-white/60">{recommendedTime}</span>
                      </div>
                      {isRecommendedTimePast() && (
                        <div className="text-xs text-amber-300 mt-1 ml-6 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          과거 시간이므로 다음날로 자동 보정됩니다
                        </div>
                      )}
                    </label>
                  )}

                  {/* 즉시 발송 */}
                  <label
                    onClick={() => setSendTimeOption('now')}
                    className={`block p-3 border rounded-xl cursor-pointer transition-all ${
                      sendTimeOption === 'now'
                        ? 'border-violet-400/50 bg-violet-500/10 shadow-md shadow-violet-500/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sendTimeOption === 'now' ? 'border-violet-400' : 'border-white/30'}`}>
                        {sendTimeOption === 'now' && <div className="w-2 h-2 rounded-full bg-violet-400" />}
                      </div>
                      <Zap className="w-4 h-4 text-amber-300" />
                      <span className="font-medium text-sm text-white/90">즉시 발송</span>
                      <span className="text-xs text-white/40">지금 바로</span>
                    </div>
                  </label>

                  {/* 예약 발송 */}
                  <label
                    onClick={() => setSendTimeOption('custom')}
                    className={`block p-3 border rounded-xl cursor-pointer transition-all ${
                      sendTimeOption === 'custom'
                        ? 'border-violet-400/50 bg-violet-500/10 shadow-md shadow-violet-500/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sendTimeOption === 'custom' ? 'border-violet-400' : 'border-white/30'}`}>
                        {sendTimeOption === 'custom' && <div className="w-2 h-2 rounded-full bg-violet-400" />}
                      </div>
                      <Calendar className="w-4 h-4 text-cyan-300" />
                      <span className="font-medium text-sm text-white/90">예약 발송</span>
                    </div>
                    {sendTimeOption === 'custom' && (
                      <div className="ml-6 flex items-center gap-2 flex-wrap">
                        <input
                          type="date"
                          className="bg-white/5 border border-white/15 text-white rounded-lg px-3 py-1.5 text-sm focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all [color-scheme:dark]"
                          value={customSendTime?.split('T')[0] || ''}
                          min={new Date().toISOString().split('T')[0]}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const time = customSendTime?.split('T')[1] || '09:00';
                            setCustomSendTime(`${e.target.value}T${time}`);
                          }}
                        />
                        <select
                          value={parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9') >= 12 ? 'PM' : 'AM'}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const currentHour = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                            const hour12 = currentHour === 0 ? 12 : currentHour > 12 ? currentHour - 12 : currentHour;
                            let hour24 = e.target.value === 'PM' ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
                            const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                            const minute = customSendTime?.split('T')[1]?.split(':')[1] || '00';
                            setCustomSendTime(`${date}T${hour24.toString().padStart(2, '0')}:${minute}`);
                          }}
                          className="bg-white/5 border border-white/15 text-white rounded-lg px-2 py-1.5 text-sm focus:border-violet-400/50 focus:outline-none"
                        >
                          <option value="AM" className="bg-slate-900">오전</option>
                          <option value="PM" className="bg-slate-900">오후</option>
                        </select>
                        <input
                          type="number" min="1" max="12"
                          value={(() => { const h = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9'); return h === 0 ? 12 : h > 12 ? h - 12 : h; })()}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            let h12 = Math.min(12, Math.max(1, parseInt(e.target.value) || 1));
                            const cur = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                            const isPM = cur >= 12;
                            let h24 = isPM ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12);
                            const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                            const min = customSendTime?.split('T')[1]?.split(':')[1] || '00';
                            setCustomSendTime(`${date}T${h24.toString().padStart(2, '0')}:${min}`);
                          }}
                          className="w-12 bg-white/5 border border-white/15 text-white rounded-lg px-2 py-1.5 text-sm text-center focus:border-violet-400/50 focus:outline-none"
                        />
                        <span className="text-lg font-bold text-white/40">:</span>
                        <input
                          type="number" min="0" max="59"
                          value={parseInt(customSendTime?.split('T')[1]?.split(':')[1] || '0')}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            let min = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                            const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                            const hour = customSendTime?.split('T')[1]?.split(':')[0] || '09';
                            setCustomSendTime(`${date}T${hour}:${min.toString().padStart(2, '0')}`);
                          }}
                          className="w-12 bg-white/5 border border-white/15 text-white rounded-lg px-2 py-1.5 text-sm text-center focus:border-violet-400/50 focus:outline-none"
                        />
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div className="text-[10px] text-white/30 italic">
                Data source — AI 추천 (자율 진단 + 발송 흐름)
              </div>
            </div>
          </div>
        </div>

        {/* 하단 발송 버튼 */}
        <div className="px-5 py-4 border-t border-white/10 bg-slate-950/50 backdrop-blur-sm flex items-center justify-between shrink-0 gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/40">발송 대상</span>
            <span className="font-bold text-violet-300 text-lg">{targetCount?.toLocaleString()}명</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-5 py-2.5 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
              취소
            </button>
            <button
              onClick={handleSend}
              disabled={isSending}
              className="px-8 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg font-medium transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/30"
            >
              {isSending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 발송 중...</>
              ) : (
                <><Rocket className="w-4 h-4" /> 발송하기</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
