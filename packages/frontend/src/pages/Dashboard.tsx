import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customersApi, campaignsApi, aiApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import ResultsModal from '../components/ResultsModal';
import CustomerDBModal from '../components/CustomerDBModal';
import { Users, CheckCircle, UserCircle, Star, Send, TrendingUp, Rocket, Upload, Calendar, BarChart3, Settings, Ban, LogOut, Sparkles, Clock, LayoutGrid, Lightbulb, PieChart, FileText, Activity } from 'lucide-react';

interface Stats {
  total: string;
  sms_opt_in_count: string;
  male_count: string;
  female_count: string;
  vip_count: string;
  monthly_sent: number;
  success_rate: string;
  monthly_budget: number;
  monthly_cost: number;
  sms_sent: number;
  lms_sent: number;
  mms_sent: number;
  kakao_sent: number;
  cost_per_sms: number;
  cost_per_lms: number;
  cost_per_mms: number;
  cost_per_kakao: number;
  age_under20: string;
  age_20s: string;
  age_30s: string;
  age_40s: string;
  age_50s: string;
  age_60plus: string;
  use_db_sync: boolean;
  use_file_upload: boolean;
}

interface PlanInfo {
  plan_name: string;
  plan_code: string;
  trial_expires_at: string;
  is_trial_expired: boolean;
}

// 캘린더 모달 컴포넌트
function CalendarModal({ onClose, token }: { onClose: () => void; token: string | null }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    fetchCampaigns();
  }, [year, month]);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`/api/campaigns?year=${year}&month=${month + 1}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('캠페인 조회 에러:', error);
    }
  };

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const getCampaignsForDay = (day: number) => {
    const currentDay = new Date(year, month, day);
    return campaigns.filter((c) => {
      // 이벤트 기간이 유효하면 그 범위 체크
      if (c.event_start_date && c.event_end_date) {
        const startStr = c.event_start_date.slice(0, 10); // "2026-02-09"
        const endStr = c.event_end_date.slice(0, 10);     // "2026-02-13"
        const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (endStr >= startStr) {
          return currentStr >= startStr && currentStr <= endStr;
        }
      }
      // 없거나 유효하지 않으면 scheduled_at 또는 created_at 기준
      const dateStr = c.scheduled_at || c.created_at;
      const date = new Date(dateStr);
      return date.getDate() === day && date.getMonth() === month && date.getFullYear() === year;
    });
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-200 text-gray-600',
    scheduled: 'bg-pink-200 text-pink-700',
    sending: 'bg-yellow-200 text-yellow-700',
    completed: 'bg-amber-200 text-amber-700',
    failed: 'bg-red-200 text-red-700',
    cancelled: 'bg-gray-300 text-gray-500',
  };
  const statusLabels: Record<string, string> = {
    draft: '준비', scheduled: '예약', sending: '진행', completed: '완료', failed: '실패', cancelled: '취소',
  };

  // 날짜 클릭 핸들러
  const handleDateClick = (day: number) => {
    setSelectedDate(day);
    setSelectedCampaign(null); // 캠페인 선택 초기화
  };

  // 캠페인 클릭 핸들러
  const handleCampaignClick = (campaign: any, e: React.MouseEvent) => {
    e.stopPropagation(); // 날짜 클릭 이벤트 전파 방지
    setSelectedCampaign(campaign);
  };

  // 선택된 날짜의 캠페인 목록
  const selectedDateCampaigns = selectedDate ? getCampaignsForDay(selectedDate) : [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[650px] overflow-hidden">
        {/* 헤더 */}
        <div className="flex justify-between items-center p-4 border-b bg-gray-50">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="px-3 py-1 hover:bg-gray-200 rounded">←</button>
          <h2 className="text-lg font-bold">{year}년 {month + 1}월</h2>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="px-3 py-1 hover:bg-gray-200 rounded">→</button>
          <button onClick={onClose} className="ml-4 text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="flex">
          {/* 캘린더 */}
          <div className="flex-1 p-4">
            {/* 상태 색상 가이드 */}
            <div className="flex items-center gap-4 mb-3 pb-2 border-b text-xs">
              <span className="text-gray-500">상태:</span>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-amber-200"></span>
                <span className="text-gray-600">완료</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-pink-200"></span>
                <span className="text-gray-600">예약</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-gray-300"></span>
                <span className="text-gray-600">취소</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-yellow-200"></span>
                <span className="text-gray-600">진행</span>
              </div>
            </div>
            {/* 요일 헤더 - 색상 적용 */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['일','월','화','수','목','금','토'].map((d, idx) => (
                <div 
                  key={d} 
                  className={`text-center text-xs font-medium ${
                    idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-gray-500'
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>
            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 gap-1">
              {blanks.map(i => <div key={`b-${i}`} className="h-20 bg-gray-50 rounded" />)}
              {days.map(day => {
                const dayCampaigns = getCampaignsForDay(day);
                const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
                const isSelected = selectedDate === day;
                const dayOfWeek = new Date(year, month, day).getDay();
                
                const getEventPosition = (c: any) => {
                  if (!c.event_start_date || !c.event_end_date) return 'single';
                  const startStr = c.event_start_date.slice(0, 10);
                  const endStr = c.event_end_date.slice(0, 10);
                  const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  if (endStr < startStr) return 'single';
                  if (currentStr === startStr && currentStr === endStr) return 'single';
                  if (currentStr === startStr) return 'start';
                  if (currentStr === endStr) return 'end';
                  return 'middle';
                };

                const getBarStyle = (position: string) => {
                  switch (position) {
                    case 'start': return 'rounded-l rounded-r-none';
                    case 'middle': return 'rounded-none';
                    case 'end': return 'rounded-r rounded-l-none';
                    default: return 'rounded';
                  }
                };
                
                return (
                  <div 
                    key={day} 
                    onClick={() => handleDateClick(day)}
                    className={`h-20 border rounded p-1 text-xs cursor-pointer transition-all hover:bg-gray-50 overflow-visible flex flex-col ${
                      isToday ? 'border-blue-500 border-2 bg-blue-50' : 
                      isSelected ? 'border-purple-500 border-2 bg-purple-50' : 'border-gray-200'
                    }`}
                  >
                    {/* 날짜 숫자 - 요일별 색상 */}
                    <div className={`font-medium text-center ${
                      isToday ? 'text-blue-600' : 
                      dayOfWeek === 0 ? 'text-red-500' : 
                      dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-700'
                    }`}>
                      {day}
                    </div>
                    {/* 캠페인 목록 - 연결 바 */}                    {/* 캠페인 목록 - 연결 바 */}
{dayCampaigns.slice(0, 2).map(c => {
  const position = getEventPosition(c);
  const barMargin = position === 'start' ? '-mr-2' : position === 'end' ? '-ml-2' : position === 'middle' ? '-mx-2' : '';
  return (
    <div 
      key={c.id} 
      onClick={(e) => handleCampaignClick(c, e)} 
      className={`truncate cursor-pointer px-1 mt-0.5 hover:opacity-80 h-5 leading-5 text-[11px] ${statusColors[c.status] || 'bg-gray-100'} ${getBarStyle(position)} ${barMargin}`}
      style={{ zIndex: position === 'start' ? 2 : 1 }}
    >
      {(() => {
  if (position === 'single') return c.campaign_name;
  if (!c.event_start_date || !c.event_end_date) return '';
  const startStr = c.event_start_date.slice(0, 10);
  const endStr = c.event_end_date.slice(0, 10);
  const startDay = parseInt(startStr.split('-')[2]);
  const endDay = parseInt(endStr.split('-')[2]);
  const middleDay = Math.round((startDay + endDay) / 2);
  return day === middleDay ? c.campaign_name : '';
})()}
    </div>
  );
})}
                    {dayCampaigns.length > 2 && (
                      <div className="text-gray-400 mt-0.5 hover:text-purple-600">+{dayCampaigns.length - 2}개 더</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 우측 패널 - 날짜 선택 또는 캠페인 상세 */}
          <div className="w-72 border-l bg-gray-50 flex flex-col max-h-[580px]">
            {selectedCampaign ? (
              // 캠페인 상세 보기
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-bold text-base leading-tight">{selectedCampaign.campaign_name}</h3>
                  <button onClick={() => setSelectedCampaign(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
                
                <div className="space-y-3 text-sm">
                  {/* 상태 */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">상태</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[selectedCampaign.status]}`}>
                      {statusLabels[selectedCampaign.status]}
                      {selectedCampaign.status === 'cancelled' && selectedCampaign.cancelled_by_type === 'super_admin' && (
                        <span className="ml-1 text-red-500">(관리자)</span>
                      )}
                    </span>
                  </div>
                  
                  {/* 취소 사유 (관리자 취소 시) */}
                  {selectedCampaign.status === 'cancelled' && selectedCampaign.cancel_reason && (
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-16">취소사유</span>
                      <span className="text-red-600 text-xs flex-1">{selectedCampaign.cancel_reason}</span>
                    </div>
                  )}
                  
                  {/* 채널 */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">채널</span>
                    <span className="font-medium">{selectedCampaign.message_type}</span>
                  </div>
                  
                  {/* 대상 */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">대상</span>
                    <span className="font-medium">{selectedCampaign.target_count?.toLocaleString()}명</span>
                  </div>
                  
                  {/* 예약시간 */}
                  {selectedCampaign.scheduled_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16">예약</span>
                      <span className="font-medium text-blue-600">
                        {new Date(selectedCampaign.scheduled_at).toLocaleString('ko-KR', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                  
                  {/* 발송시간 */}
                  {selectedCampaign.sent_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16">발송</span>
                      <span className="font-medium">
                        {new Date(selectedCampaign.sent_at).toLocaleString('ko-KR', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                  
                  {/* 메시지 미리보기 */}
                  {selectedCampaign.message_content && (
                    <div className="pt-3 border-t">
                      <div className="text-gray-500 mb-2">💬 메시지</div>
                      <div className="bg-white rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap border max-h-24 overflow-y-auto">
                        {selectedCampaign.message_content}
                      </div>
                    </div>
                  )}
                  
                  {/* 발송 결과 */}
                  {(selectedCampaign.status === 'completed' || selectedCampaign.status === 'sending') && (
                    <div className="pt-3 border-t">
                      <div className="text-gray-500 mb-2">📊 발송 결과</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white rounded p-2 border">
                          <div className="font-bold text-gray-700">{selectedCampaign.sent_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">발송</div>
                        </div>
                        <div className="bg-green-50 rounded p-2 border border-green-200">
                          <div className="font-bold text-green-600">{selectedCampaign.success_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">성공</div>
                        </div>
                        <div className="bg-red-50 rounded p-2 border border-red-200">
                          <div className="font-bold text-red-600">{selectedCampaign.fail_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">실패</div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* 버튼 */}
                  <div className="pt-4 space-y-2">
                    <button className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium transition-colors">
                      ✏️ 편집
                    </button>
                    <button className="w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors">
                      📋 복제
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedDate ? (
              // 날짜 선택 - 캠페인 목록
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">
                    {month + 1}월 {selectedDate}일
                    <span className="text-gray-400 font-normal ml-1">
                      ({['일','월','화','수','목','금','토'][new Date(year, month, selectedDate).getDay()]})
                    </span>
                  </h3>
                  <button onClick={() => setSelectedDate(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
                
                {selectedDateCampaigns.length > 0 ? (
                  <div className="space-y-2">
                    {selectedDateCampaigns.map(c => (
                      <div 
                        key={c.id}
                        onClick={() => setSelectedCampaign(c)}
                        className="p-3 bg-white rounded-lg border hover:border-purple-400 cursor-pointer transition-colors"
                      >
                        <div className="font-medium text-sm mb-1 truncate">{c.campaign_name}</div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${statusColors[c.status]}`}>
                            {statusLabels[c.status]}
                          </span>
                          <span className="text-gray-400">{c.message_type}</span>
                          <span className="text-gray-400">{c.target_count?.toLocaleString()}명</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8">
                    <div className="text-3xl mb-2">📭</div>
                    <p>이 날짜에 캠페인이 없습니다</p>
                  </div>
                )}
              </div>
            ) : (
              // 기본 상태
              <div className="flex-1 flex items-center justify-center text-center text-gray-400 p-4">
                <div>
                  <div className="text-4xl mb-3">📅</div>
                  <p className="text-sm">날짜나 캠페인을<br/>선택해주세요</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [stats, setStats] = useState<Stats | null>(null);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'target' | 'campaign' | 'send'>('target');
  const [showCalendar, setShowCalendar] = useState(false);
  const [aiCampaignPrompt, setAiCampaignPrompt] = useState('');
  const [showAiResult, setShowAiResult] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiStep, setAiStep] = useState(1);
  const [selectedChannel, setSelectedChannel] = useState('SMS');
  const [showLmsConfirm, setShowLmsConfirm] = useState(false);
  const [pendingBytes, setPendingBytes] = useState(0);
  const [showSmsConvert, setShowSmsConvert] = useState<{show: boolean, from: 'direct' | 'target', currentBytes: number, smsBytes: number, count: number}>({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0});
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState<number>(1000);
  const [isAd, setIsAd] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successCampaignId, setSuccessCampaignId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [sendTimeOption, setSendTimeOption] = useState<'ai' | 'now' | 'custom'>('now');
  const [successSendInfo, setSuccessSendInfo] = useState<string>('');  // 성공 모달용 발송 정보
  const [customSendTime, setCustomSendTime] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testCooldown, setTestCooldown] = useState(false);
  const [testSentResult, setTestSentResult] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [showCustomerDB, setShowCustomerDB] = useState(false);
  // 5개 카드 모달 state
  const [showRecentCampaigns, setShowRecentCampaigns] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showDirectTargeting, setShowDirectTargeting] = useState(false);
  // 직접 타겟 설정 관련 state
   // 직접 타겟 설정 관련 state
   const [targetPhoneField, setTargetPhoneField] = useState('phone');
   const [targetSmsOptIn, setTargetSmsOptIn] = useState(true);
   const [targetCount, setTargetCount] = useState(0);
   const [targetCountLoading, setTargetCountLoading] = useState(false);
   const [targetSchemaFields, setTargetSchemaFields] = useState<{name: string, label: string, type: string}[]>([]);
   // 동적 필터 state
   const [enabledFields, setEnabledFields] = useState<any[]>([]);
   const [targetFilters, setTargetFilters] = useState<Record<string, string>>({});
   const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
   const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });
  const [showTemplates, setShowTemplates] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showTodayStats, setShowTodayStats] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  // 모달용 데이터
  const [recentCampaigns, setRecentCampaigns] = useState<any[]>([]);
  const [scheduledCampaigns, setScheduledCampaigns] = useState<any[]>([]);
  const [selectedScheduled, setSelectedScheduled] = useState<any>(null);
  const [scheduledRecipients, setScheduledRecipients] = useState<any[]>([]);
  const [scheduledRecipientsTotal, setScheduledRecipientsTotal] = useState(0);
  const [scheduledSearch, setScheduledSearch] = useState('');
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [editScheduleTime, setEditScheduleTime] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{show: boolean, phone: string, idx: number | null}>({show: false, phone: '', idx: null});
  const [messagePreview, setMessagePreview] = useState<{show: boolean, phone: string, message: string}>({show: false, phone: '', message: ''});
  const [messageEditModal, setMessageEditModal] = useState(false);
  const [editMessage, setEditMessage] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [messageEditProgress, setMessageEditProgress] = useState(0);
  const [messageEditing, setMessageEditing] = useState(false);
  // 파일 업로드 관련
  const [uploadedFile, setUploadedFile] = useState<any>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [filePreview, setFilePreview] = useState<any[]>([]);
  const [fileTotalRows, setFileTotalRows] = useState(0);
  const [fileId, setFileId] = useState('');
  const [showUploadResult, setShowUploadResult] = useState(false);
  const [uploadResult, setUploadResult] = useState({ insertCount: 0, duplicateCount: 0 });
  const [showPlanLimitError, setShowPlanLimitError] = useState(false);
  const [planLimitInfo, setPlanLimitInfo] = useState<any>(null);
  const [uploadProgress, setUploadProgress] = useState({ total: 0, processed: 0, percent: 0 });
  const [showDirectSend, setShowDirectSend] = useState(false);
  const [showTargetSend, setShowTargetSend] = useState(false);
  // 직접타겟발송 관련 state
  const [targetMsgType, setTargetMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [targetSubject, setTargetSubject] = useState('');
  const [targetMessage, setTargetMessage] = useState('');
  const [targetRecipients, setTargetRecipients] = useState<any[]>([]);
  const [targetSending, setTargetSending] = useState(false);
  const [targetListPage, setTargetListPage] = useState(0);
  const [targetListSearch, setTargetListSearch] = useState('');
  const [showTargetPreview, setShowTargetPreview] = useState(false);
  // 직접발송 관련 state
  const [directMsgType, setDirectMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [directSubject, setDirectSubject] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [directRecipients, setDirectRecipients] = useState<any[]>([]);
  const [directSearchQuery, setDirectSearchQuery] = useState('');
  const [reserveEnabled, setReserveEnabled] = useState(false);
  const [reserveDateTime, setReserveDateTime] = useState('');
  const [showReservePicker, setShowReservePicker] = useState(false);
  // 직접발송 실행 함수
  const executeDirectSend = async () => {
    setDirectSending(true);
    try {
      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          msgType: directMsgType,
          subject: directSubject,
          message: getFullMessage(directMessage),
          callback: useIndividualCallback ? null : selectedCallback,
          useIndividualCallback: useIndividualCallback,
          recipients: directRecipients.map((r: any) => ({ ...r, callback: r.callback || null })),
          adEnabled: adTextEnabled,
          scheduled: reserveEnabled,
          scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
          splitEnabled: splitEnabled,
          splitCount: splitEnabled ? splitCount : null
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({show: true, type: 'success', message: data.message});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
        // 모달 유지, 입력 필드만 초기화
        setDirectMessage('');
        setDirectSubject('');
        setDirectRecipients([]);
        setDirectMsgType('SMS');
        setReserveEnabled(false);
        setReserveDateTime('');
        loadRecentCampaigns();
      } else {
        setToast({show: true, type: 'error', message: data.error});
        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      }
    } catch (err) {
      setToast({show: true, type: 'error', message: '발송 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    } finally {
      setDirectSending(false);
    }
    setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
  };
  
  // 직접타겟추출 발송 함수
  const executeTargetSend = async () => {
    setTargetSending(true);
    try {
      const token = localStorage.getItem('token');
      // 변수 치환 처리
      const recipientsWithMessage = targetRecipients.map((r: any) => ({
        phone: r.phone,
        name: r.name || '',
        grade: r.grade || '',
        region: r.region || '',
        amount: r.total_purchase_amount || '',
        callback: r.callback || null,
        message: (adTextEnabled ? '(광고)' : '') + 
          targetMessage
            .replace(/%이름%/g, r.name || '')
            .replace(/%등급%/g, r.grade || '')
            .replace(/%지역%/g, r.region || '')
            .replace(/%구매금액%/g, r.total_purchase_amount || '') +
          (adTextEnabled ? (targetMsgType === 'SMS' ? `\n무료거부${optOutNumber.replace(/-/g, '')}` : `\n무료수신거부 ${formatRejectNumber(optOutNumber)}`) : '')
      }));

      const res = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          msgType: targetMsgType,
          subject: targetSubject,
          message: targetMessage,
          callback: useIndividualCallback ? null : selectedCallback,
          useIndividualCallback: useIndividualCallback,
          recipients: recipientsWithMessage.map(r => ({ phone: r.phone, name: '', var1: '', var2: '', var3: '', callback: r.callback || null })),
          adEnabled: adTextEnabled,
          scheduled: reserveEnabled,
          scheduledAt: reserveEnabled && reserveDateTime ? new Date(reserveDateTime).toISOString() : null,
          splitEnabled: splitEnabled,
          splitCount: splitEnabled ? splitCount : null,
          customMessages: recipientsWithMessage.map(r => ({ ...r, callback: r.callback || null }))
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({show: true, type: 'success', message: data.message});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
        setShowTargetSend(false);
        setTargetRecipients([]);
        setTargetMessage('');
        setTargetSubject('');
        loadRecentCampaigns();
      } else {
        setToast({show: true, type: 'error', message: data.error});
        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      }
    } catch (err) {
      setToast({show: true, type: 'error', message: '발송 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    } finally {
      setTargetSending(false);
    }
    setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
  };
  
  const [mmsImages, setMmsImages] = useState<File[]>([]);
  const [directInputMode, setDirectInputMode] = useState<'file' | 'direct' | 'address'>('file');
  const [showAddressBook, setShowAddressBook] = useState(false);
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
  const [directFileHeaders, setDirectFileHeaders] = useState<string[]>([]);
  const [directFilePreview, setDirectFilePreview] = useState<any[]>([]);
  const [directFileData, setDirectFileData] = useState<any[]>([]);
  const [directColumnMapping, setDirectColumnMapping] = useState<{[key: string]: string}>({});
  const [directFileLoading, setDirectFileLoading] = useState(false);
  const [directMappingLoading, setDirectMappingLoading] = useState(false);
  const [directLoadingProgress, setDirectLoadingProgress] = useState(0);
  const [directSending, setDirectSending] = useState(false);
  const [directShowMapping, setDirectShowMapping] = useState(false);
  const [showDirectInput, setShowDirectInput] = useState(false);
  const [directInputText, setDirectInputText] = useState('');
  const [callbackNumbers, setCallbackNumbers] = useState<{id: string, phone: string, label: string, is_default: boolean}[]>([]);
  const [selectedCallback, setSelectedCallback] = useState('');
  const [useIndividualCallback, setUseIndividualCallback] = useState(false);
  const [sendConfirm, setSendConfirm] = useState<{show: boolean, type: 'immediate' | 'scheduled', count: number, unsubscribeCount: number, dateTime?: string, from?: 'direct' | 'target'}>({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});

  // 전화번호 포맷팅 함수
  const formatPhoneNumber = (phone: string) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    
    // 휴대폰 11자리: 010-XXXX-XXXX
    if (cleaned.length === 11 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    // 휴대폰 10자리 (구형): 01X-XXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    // 서울 02 지역번호 (9자리): 02-XXX-XXXX
    if (cleaned.length === 9 && cleaned.startsWith('02')) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
    }
    // 서울 02 지역번호 (10자리): 02-XXXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('02')) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
    }
    // 대표번호 8자리 (15XX, 16XX, 18XX): 1XXX-XXXX
    if (cleaned.length === 8 && cleaned.startsWith('1')) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    }
    // 기타 지역번호 10자리: 0XX-XXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    // 기타 지역번호 11자리: 0XX-XXXX-XXXX
    if (cleaned.length === 11 && cleaned.startsWith('0')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    // 그 외는 원본 반환
    return phone;
  };
  const [selectedRecipients, setSelectedRecipients] = useState<Set<number>>(new Set());
  const [showDirectPreview, setShowDirectPreview] = useState(false);
  const [adTextEnabled, setAdTextEnabled] = useState(true);
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error', message: string}>({show: false, type: 'success', message: ''});
  const [optOutNumber, setOptOutNumber] = useState('080-000-0000');
  const [fileUploading, setFileUploading] = useState(false);
  const [columnMapping, setColumnMapping] = useState<{[key: string]: string | null}>({});
  const [mappingStep, setMappingStep] = useState<'upload' | 'mapping' | 'confirm'>('upload');
  // 타겟 필터
  const [filter, setFilter] = useState({
    gender: '',
    minAge: '',
    maxAge: '',
    grade: '',
    smsOptIn: true,
  });

  // 타겟 결과
  const [targetResult, setTargetResult] = useState<any>(null);

  // 캠페인 설정
  const [campaign, setCampaign] = useState({
    campaignName: '',
    messageType: 'SMS',
    messageContent: '',
    isAd: false,
  });

  // AI 관련 상태
  const [aiLoading, setAiLoading] = useState(false);
  const [showPromptAlert, setShowPromptAlert] = useState(false);
  const [aiObjective, setAiObjective] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMessages, setAiMessages] = useState<any[]>([]);
  const [showAiTarget, setShowAiTarget] = useState(false);
  const [showAiMessage, setShowAiMessage] = useState(false);
  const [campaignContext, setCampaignContext] = useState(''); // 타겟→메시지 연결용

  useEffect(() => {
    loadStats();
    loadRecentCampaigns();
    loadScheduledCampaigns();
  }, []);
// 자동입력 변수를 수신자 중 가장 긴 값으로 치환하여 최대 바이트 메시지 생성
const getMaxByteMessage = (msg: string, recipients: any[], variableMap: Record<string, string>) => {
  let result = msg;
  // variableMap: { '%이름%': 'name', '%등급%': 'grade', ... }
  Object.entries(variableMap).forEach(([variable, field]) => {
    if (!result.includes(variable)) return;
    // 수신자 중 해당 필드의 가장 긴 값 찾기
    let maxValue = '';
    recipients.forEach((r: any) => {
      const val = String(r[field] || '');
      if (val.length > maxValue.length) maxValue = val;
    });
    // 수신자가 없거나 값이 없으면 기본 최대값 사용
    if (!maxValue) {
      const defaults: Record<string, string> = {
        '%이름%': '홍길동어머니', '%등급%': 'VVIP', '%지역%': '경기도 성남시',
        '%구매금액%': '99,999,999원', '%기타1%': '가나다라마바사', '%기타2%': '가나다라마바사', '%기타3%': '가나다라마바사',
      };
      maxValue = defaults[variable] || '가나다라마바';
    }
    result = result.replace(new RegExp(variable.replace(/%/g, '%'), 'g'), maxValue);
  });
  return result;
};
  // 바이트 초과 시 자동 LMS 전환 (SMS→LMS만, LMS→SMS 복귀는 수동)
  useEffect(() => {
    // 자동입력 변수를 최대 길이 값으로 치환
    const directVarMap: Record<string, string> = {
      '%이름%': 'name', '%기타1%': 'extra1', '%기타2%': 'extra2', '%기타3%': 'extra3',
    };
    let fullMsg = getMaxByteMessage(directMessage, directRecipients, directVarMap);
    if (adTextEnabled) {
      const optOutText = directMsgType === 'SMS'
        ? `무료거부${optOutNumber.replace(/-/g, '')}`
        : `무료수신거부 ${optOutNumber}`;
      fullMsg = `(광고) ${fullMsg}\n${optOutText}`;
    }
    // 한글 2byte, 영문/숫자 1byte 계산
    let bytes = 0;
    for (let i = 0; i < fullMsg.length; i++) {
      const char = fullMsg.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    // SMS에서 90바이트 초과 시 LMS 전환 확인 모달
    if (directMsgType === 'SMS' && bytes > 90 && !showLmsConfirm) {
      setPendingBytes(bytes);
      setShowLmsConfirm(true);
    }
  }, [directMessage, directMsgType, adTextEnabled, optOutNumber, directRecipients]);

  // 타겟발송 메시지 실시간 바이트 체크
  useEffect(() => {
    if (!showTargetSend) return;
    // 자동입력 변수를 최대 길이 값으로 치환
    const targetVarMap: Record<string, string> = {
      '%이름%': 'name', '%등급%': 'grade', '%지역%': 'region', '%구매금액%': 'total_purchase_amount',
    };
    let fullMsg = getMaxByteMessage(targetMessage, targetRecipients, targetVarMap);
    if (adTextEnabled) {
      const optOutText = targetMsgType === 'SMS'
        ? `무료거부${optOutNumber.replace(/-/g, '')}`
        : `무료수신거부 ${optOutNumber}`;
      fullMsg = `(광고)${fullMsg}\n${optOutText}`;
    }
    let bytes = 0;
    for (let i = 0; i < fullMsg.length; i++) {
      const char = fullMsg.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    if (targetMsgType === 'SMS' && bytes > 90 && !showLmsConfirm) {
      setPendingBytes(bytes);
      setShowLmsConfirm(true);
    }
  }, [targetMessage, targetMsgType, adTextEnabled, optOutNumber, showTargetSend, targetRecipients]);

  const loadStats = async () => {
    try {
      const response = await customersApi.stats();
      setStats(response.data.stats);
      
      // 플랜 정보 조회
      const token = localStorage.getItem('token');
      const planRes = await fetch('/api/companies/my-plan', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (planRes.ok) {
        const planData = await planRes.json();
        setPlanInfo(planData);
      }
    } catch (error) {
      console.error('통계 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };
  // 최근 캠페인 로드
  const loadRecentCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns?limit=5', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRecentCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('최근 캠페인 로드 실패:', error);
    }
  };

  // 예약 대기 캠페인 로드
  const loadScheduledCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns?status=scheduled', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setScheduledCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('예약 캠페인 로드 실패:', error);
    }
  };

  // 직접 타겟 설정 - 스키마 로드
  // 직접 타겟 설정 - 스키마 로드 (기존 유지)
  const loadTargetSchema = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/schema', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.fields) {
        setTargetSchemaFields(data.fields);
      }
    } catch (error) {
      console.error('스키마 로드 실패:', error);
    }
  };

  // 동적 필터 - 활성 필드 로드
  const loadEnabledFields = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEnabledFields(data.fields || []);
        setFilterOptions(data.options || {});
      }
    } catch (error) {
      console.error('필드 로드 실패:', error);
    }
  };

  // 동적 필터 → API 포맷 변환
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    for (const [fieldKey, value] of Object.entries(targetFilters)) {
      if (!value) continue;
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;

      // 특수 필드 변환
      if (fieldKey === 'age_group') {
        const ageVal = parseInt(value);
        if (ageVal >= 60) { filters['age'] = { operator: 'gte', value: 60 }; }
        else { filters['age'] = { operator: 'between', value: [ageVal, ageVal + 9] }; }
        continue;
      }
      if (fieldKey === 'last_purchase_date' || fieldKey === 'first_purchase_date' || fieldKey === 'last_visit_date') {
        const dbCol = fieldKey === 'last_purchase_date' ? 'recent_purchase_date' : fieldKey;
        filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
        continue;
      }

      const dbFieldMap: Record<string, string> = { 'opt_in_sms': 'sms_opt_in' };
      const dbField = dbFieldMap[fieldKey] || fieldKey;

      if (field.data_type === 'string') {
        filters[dbField] = { operator: 'eq', value };
      } else if (field.data_type === 'number') {
        filters[dbField] = { operator: 'gte', value: Number(value) };
      } else if (field.data_type === 'date') {
        filters[dbField] = { operator: 'days_within', value: parseInt(value) };
      } else if (field.data_type === 'boolean') {
        filters[dbField] = { operator: 'eq', value: value === 'true' };
      }
    }
    return filters;
  };

  // 직접 타겟 설정 - 필터 카운트
  const loadTargetCount = async () => {
    setTargetCountLoading(true);
    try {
      const token = localStorage.getItem('token');
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/filter-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters, smsOptIn: targetSmsOptIn })
      });
      const data = await res.json();
      setTargetCount(data.count || 0);
    } catch (error) {
      console.error('카운트 조회 실패:', error);
    } finally {
      setTargetCountLoading(false);
    }
  };

  // 직접 타겟 설정 - 타겟 추출 후 발송화면 이동
  const handleTargetExtract = async () => {
    if (targetCount === 0) {
      setToast({show: true, type: 'error', message: '추출할 대상이 없습니다'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      return;
    }
    try {
      const token = localStorage.getItem('token');
      
      // 080 수신거부번호 로드
      const settingsRes = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.reject_number) {
          setOptOutNumber(settingsData.reject_number);
        }
      }
      
      // 회신번호 로드
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
        const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
        if (defaultCb) setSelectedCallback(defaultCb.phone);
      }
      
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dynamicFilters,
          smsOptIn: targetSmsOptIn,
          phoneField: targetPhoneField
        })
      });
      const data = await res.json();
      if (data.success && data.recipients) {
        const recipients = data.recipients.map((r: any) => ({
          phone: r.phone,
          name: r.name || '',
          grade: r.grade || '',
          region: r.region || '',
          amount: r.total_purchase_amount ? Math.floor(r.total_purchase_amount).toLocaleString() + '원' : '',
          callback: r.callback || ''
        }));
        setTargetRecipients(recipients);
        setShowDirectTargeting(false);
        setShowTargetSend(true);
        setToast({show: true, type: 'success', message: `${data.count}명 추출 완료`});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
      }
    } catch (error) {
      console.error('타겟 추출 실패:', error);
      setToast({show: true, type: 'error', message: '타겟 추출 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    }
  };

  // 직접 타겟 설정 - 필터 초기화
  const resetTargetFilters = () => {
    setTargetFilters({});
    setTargetSmsOptIn(true);
    setTargetCount(0);
  };

  const handleExtractTarget = async () => {
    try {
      const params: any = {};
      if (filter.gender) params.gender = filter.gender;
      if (filter.minAge) params.minAge = filter.minAge;
      if (filter.maxAge) params.maxAge = filter.maxAge;
      if (filter.grade) params.grade = filter.grade;
      if (filter.smsOptIn) params.smsOptIn = 'true';

      console.log('API 호출 params:', params);
      const response = await customersApi.list({ ...params, limit: 100 });
      setTargetResult(response.data);
    } catch (error) {
      console.error('타겟 추출 실패:', error);
    }
  };

  // AI 타겟 추천
  const handleAiRecommendTarget = async () => {
    if (!aiObjective.trim()) {
      alert('마케팅 목표를 입력해주세요');
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.recommendTarget({ objective: aiObjective });
      const result = response.data;
      console.log('AI 응답:', result);
      console.log('적용할 gender:', result.filters?.gender?.value);

      // 추천된 필터 적용
      if (result.filters) {
        const newFilter = { ...filter };
        if (result.filters.gender?.value) newFilter.gender = result.filters.gender.value;
        if (result.filters.age?.value) {
          newFilter.minAge = result.filters.age.value[0]?.toString() || '';
          newFilter.maxAge = result.filters.age.value[1]?.toString() || '';
        }
        if (result.filters.grade?.value) newFilter.grade = result.filters.grade.value;
        setFilter(newFilter);
        console.log('설정된 필터:', newFilter);
      }
      
      // 캠페인 컨텍스트 저장 (메시지 생성에 사용)
      setCampaignContext(aiObjective);
      
      alert(`AI 추천 완료!\n\n${result.reasoning}\n\n예상 타겟: ${result.estimated_count.toLocaleString()}명${result.unsubscribe_count > 0 ? `\n수신거부 제외: ${result.unsubscribe_count.toLocaleString()}명` : ''}`);
      setShowAiTarget(false);
      setAiObjective('');
    } catch (error) {
      console.error('AI 타겟 추천 실패:', error);
      alert('AI 추천 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  };
// AI 캠페인 생성 (프롬프트 한 방)
const handleAiCampaignGenerate = async () => {
  if (!aiCampaignPrompt.trim()) {
    setShowPromptAlert(true);
    return;
  }
  setAiLoading(true);
  try {
    // 1. 타겟 + 채널 추천 받기
    const response = await aiApi.recommendTarget({ objective: aiCampaignPrompt });
    const result = response.data;
    
    // AI 결과 저장
    setAiResult({
      target: {
        description: result.reasoning || '추천 타겟',
        count: result.estimated_count || 0,
        unsubscribeCount: result.unsubscribe_count || 0,
        filters: result.filters || {},
      },
      recommendedChannel: result.recommended_channel || 'SMS',
      channelReason: result.channel_reason || '간단한 안내 메시지에 적합합니다.',
      recommendedTime: result.recommended_time || '',
      suggestedCampaignName: result.suggested_campaign_name || '',
      useIndividualCallback: result.use_individual_callback || false,
      usePersonalization: result.use_personalization || false,
      personalizationVars: result.personalization_vars || [],
    });
    
    // 추천 채널로 기본 설정
    setSelectedChannel(result.recommended_channel || 'SMS');
    setIsAd(result.is_ad !== false);
    
    // 개별회신번호 자동 설정
    if (result.use_individual_callback) {
      setUseIndividualCallback(true);
    }
  
    // 팝업 열기
    setShowAiResult(true);
    setAiStep(1);
  } catch (error) {
    console.error('AI 캠페인 생성 실패:', error);
    alert('AI 추천 중 오류가 발생했습니다.');
  } finally {
    setAiLoading(false);
  }
};

// AI 메시지 생성 (채널 선택 후)
const handleAiGenerateChannelMessage = async () => {
  setAiLoading(true);
  try {
    const response = await aiApi.generateMessage({
      prompt: aiCampaignPrompt,
      brandName: user?.company?.name || '브랜드',
      channel: selectedChannel,
      usePersonalization: aiResult?.usePersonalization || false,
      personalizationVars: aiResult?.personalizationVars || [],
    });
    
    // 메시지 결과 저장
    setAiResult((prev: any) => ({
      ...prev,
      messages: response.data.variants || [],
    }));
    
    // 2단계로 이동
    setAiStep(2);
  } catch (error) {
    console.error('AI 메시지 생성 실패:', error);
    alert('메시지 생성 중 오류가 발생했습니다.');
  } finally {
    setAiLoading(false);
  }
};

  // AI 메시지 생성
  const handleAiGenerateMessage = async () => {
    const prompt = aiPrompt.trim() || campaignContext;
    if (!prompt) {
      alert('메시지 요청 내용을 입력해주세요');
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.generateMessage({
        prompt: prompt,
        brandName: user?.company?.name || '브랜드',
      });
      setAiMessages(response.data.variants || []);
    } catch (error) {
      console.error('AI 메시지 생성 실패:', error);
      alert('AI 메시지 생성 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  };

  // AI 메시지 선택
  const handleSelectAiMessage = (message: any) => {
    const text = campaign.messageType === 'SMS' ? message.sms_text : message.lms_text;
    setCampaign({ ...campaign, messageContent: text });
    setShowAiMessage(false);
    setAiMessages([]);
    setAiPrompt('');
  };

  const handleCreateCampaign = async () => {
    if (!campaign.campaignName || !campaign.messageContent) {
      alert('캠페인명과 메시지 내용을 입력하세요');
      return;
    }

    try {
      await campaignsApi.create({
        ...campaign,
        targetFilter: filter,
      });
      alert('캠페인이 생성되었습니다');
      setActiveTab('send');
    } catch (error: any) {
      alert(error.response?.data?.error || '캠페인 생성 실패');
    } finally {
      setIsSending(false);
    }
  };
// AI 캠페인 발송 확정
const handleAiCampaignSend = async () => {
  if (isSending) return; // 중복 클릭 방지
  
  // 회신번호 검증
  if (!selectedCallback && !useIndividualCallback) {
    alert('회신번호를 선택해주세요');
    return;
  }
  
  setIsSending(true);
  try {
    // 선택된 메시지 가져오기 (첫번째 메시지 사용, 나중에 라디오 선택값으로 변경 가능)
    const selectedMsg = aiResult?.messages?.[0];
    if (!selectedMsg) {
      alert('메시지를 선택해주세요');
      setIsSending(false);
      return;
    }

    // 발송시간 계산
    let scheduledAt: string | null = null;
    if (sendTimeOption === 'ai' && aiResult?.recommendedTime) {
      // AI 추천시간 파싱 (예: "2024-02-01 19:00" 또는 "2월 1일 오후 7시")
      const timeStr = aiResult.recommendedTime;
      // ISO 형식이면 그대로, 아니면 파싱 시도
      if (timeStr.includes('T') || timeStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        scheduledAt = timeStr;
      } else {
        // 한국어 형식 파싱 시도 (예: "2월 1일 19:00")
        const match = timeStr.match(/(\d+)월\s*(\d+)일.*?(\d{1,2}):?(\d{2})?/);
        if (match) {
          const year = new Date().getFullYear();
          const month = parseInt(match[1]) - 1;
          const day = parseInt(match[2]);
          const hour = parseInt(match[3]);
          const minute = parseInt(match[4] || '0');
          scheduledAt = new Date(year, month, day, hour, minute).toISOString();
        }
      }
    } else if (sendTimeOption === 'custom' && customSendTime) {
      scheduledAt = new Date(customSendTime).toISOString();
    }
    // 'now'면 scheduledAt은 null (즉시 발송)

    // 이벤트 기간 파싱 (AI 메시지에서 추출 시도)
    let eventStartDate: string | null = null;
    let eventEndDate: string | null = null;
    
    // 메시지 내용에서 이벤트 기간 추출 시도
    const msgText = selectedMsg.message_text || '';
    // 여러 형식 지원: "X월 X일 ~ X일", "X월 X일 ~ X월 X일", "X/X ~ X/X"
    let eventMatch = msgText.match(/(\d+)월\s*(\d+)일.*?~\s*(\d+)월\s*(\d+)일/); // 2월 13일 ~ 2월 15일
    if (!eventMatch) {
      eventMatch = msgText.match(/(\d+)월\s*(\d+)일.*?~\s*(\d+)일/); // 2월 13일 ~ 15일
      if (eventMatch) {
        // 끝나는 월이 없으면 시작 월과 같음
        eventMatch = [eventMatch[0], eventMatch[1], eventMatch[2], eventMatch[1], eventMatch[3]];
      }
    }
    if (!eventMatch) {
      eventMatch = msgText.match(/(\d+)\/(\d+).*?~\s*(\d+)\/(\d+)/); // 2/13 ~ 2/15
    }
    
    if (eventMatch) {
      const year = new Date().getFullYear();
      const startMonth = parseInt(eventMatch[1]) - 1;
      const startDay = parseInt(eventMatch[2]);
      const endMonth = parseInt(eventMatch[3]) - 1;
      const endDay = parseInt(eventMatch[4]);
      eventStartDate = `${year}-${String(startMonth + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
      eventEndDate = `${year}-${String(endMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    }

    // AI 추천 캠페인명 우선 사용, 없으면 메시지에서 추출
const msgContent = selectedMsg.message_text || '';
const nameMatch = msgContent.match(/\][\s]*(.+?)[\s]*[\n\r]/);
const extractedName = nameMatch ? nameMatch[1].replace(/[^\w가-힣\s]/g, '').trim().slice(0, 30) : `캠페인_${new Date().toLocaleDateString('ko-KR')}`;
const autoName = aiResult?.suggestedCampaignName || extractedName;

const campaignData = {
  campaignName: autoName,
      messageType: selectedChannel,
      messageContent: selectedMsg.message_text,
      targetFilter: aiResult?.target?.filters || {},
      isAd: true,
      scheduledAt: scheduledAt,
      eventStartDate: eventStartDate,
      eventEndDate: eventEndDate,
      callback: useIndividualCallback ? null : selectedCallback,
      useIndividualCallback: useIndividualCallback,
    };

    console.log('=== 발송 디버깅 ===');
    console.log('sendTimeOption:', sendTimeOption);
    console.log('scheduledAt:', scheduledAt);
    console.log('campaignData:', campaignData);

    const response = await campaignsApi.create(campaignData);

    // 캠페인 발송 API 호출 (예약/즉시 모두)
    const campaignId = response.data.campaign?.id;
    if (campaignId) {
      await campaignsApi.send(campaignId);
    }
    
    // 모달 닫기
    setShowPreview(false);
    setShowAiResult(false);
    setAiStep(1);
    setAiCampaignPrompt('');
    // 성공 모달용 발송 정보 저장 (초기화 전에!)
    const sendInfoText = sendTimeOption === 'now' ? '즉시 발송 완료' : 
                         sendTimeOption === 'ai' ? `예약 완료 (${aiResult?.recommendedTime || 'AI 추천'})` :
                         `예약 완료 (${customSendTime ? new Date(customSendTime).toLocaleString('ko-KR') : ''})`;
    setSuccessSendInfo(sendInfoText);
    
    setSendTimeOption('ai');
    setCustomSendTime('');
    
    setSuccessCampaignId(response.data.campaign?.id || '');
    setShowSuccess(true);
    
  } catch (error: any) {
    console.error('캠페인 생성 실패:', error);
    alert(error.response?.data?.error || '캠페인 생성에 실패했습니다.');
  } finally {
    setIsSending(false);
  }
};

  // 담당자 사전수신
  const handleTestSend = async () => {
    setTestSending(true);
    setTestSentResult(null);
    try {
      const selectedMsg = aiResult?.messages?.[0];
      if (!selectedMsg) {
        alert('메시지를 선택해주세요');
        setTestSending(false);
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messageContent: selectedMsg.message_text,
          messageType: selectedChannel,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const contactList = data.contacts?.map((c: any) => `${c.name}(${c.phone})`).join(', ') || '';
        setTestSentResult(`✅ ${data.message}\n${contactList}`);
      } else {
        setTestSentResult(`❌ ${data.error}`);
      }
    } catch (error) {
      setTestSentResult('❌ 테스트 발송 실패');
    } finally {
      setTestSending(false);
      setTestCooldown(true);
      setTimeout(() => {
        setTestCooldown(false);
        setTestSentResult(null);
      }, 10000);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  // 바이트 계산 함수 (한글 2byte, 영문/숫자 1byte)
  const calculateBytes = (text: string) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    return bytes;
  };

  // 광고문구 포함된 최종 메시지
  // 080번호 하이픈 포맷팅 (0801111111 → 080-111-1111)
  const formatRejectNumber = (num: string) => {
    const clean = num.replace(/-/g, '');
    if (clean.length === 10) {
      return `${clean.slice(0,3)}-${clean.slice(3,6)}-${clean.slice(6)}`;
    }
    return num;
  };

  const getFullMessage = (msg: string) => {
    if (!adTextEnabled) return msg;
    const optOutText = directMsgType === 'SMS' 
      ? `무료거부${optOutNumber.replace(/-/g, '')}` 
      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
    return `(광고)${msg}\n${optOutText}`;
  };

  const messageBytes = calculateBytes(getFullMessage(directMessage));
  
  const maxBytes = directMsgType === 'SMS' ? 90 : 2000;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* AI 프롬프트 입력 안내 모달 */}
      {showPromptAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-800">AI 캠페인 생성</h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                원하는 캠페인 내용을 입력하세요.<br/>
                <span className="text-emerald-700 font-medium">타겟 선정부터 메시지 작성, 발송 시간까지</span><br/>
                AI가 자동으로 설계해드립니다.
              </p>
            </div>
            <div className="p-4 bg-gray-50 border-t">
              <div className="text-sm text-gray-500 mb-4">
                <p className="font-medium mb-2">💡 입력 예시:</p>
                <ul className="space-y-1 text-gray-600">
                  <li>• 30대 여성 VIP에게 봄 신상품 20% 할인 안내</li>
                  <li>• 3개월 미구매 고객에게 재방문 쿠폰 발송</li>
                  <li>• 생일 고객에게 축하 메시지 보내기</li>
                </ul>
              </div>
              <button
                onClick={() => setShowPromptAlert(false)}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors"
              >
                확인
              </button>
            </div>
          </div>
          </div>
      )}
      {/* 토스트 알림 */}
      {toast.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-bounce">
          <div className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${
            toast.type === 'success' 
              ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white' 
              : 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
          }`}>
            <span className="text-2xl">{toast.type === 'success' ? '✅' : '❌'}</span>
            <span className="font-medium text-lg">{toast.message}</span>
          </div>
        </div>
      )}
      {/* 헤더 */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
          <h1 className="text-xl font-bold text-gray-800">한줄로</h1>
            <p className="text-sm text-gray-500">{user?.company?.name}</p>
          </div>
          <div className="flex items-center gap-4">
          <button
              onClick={async () => {
                setShowDirectSend(true);
                try {
                  const token = localStorage.getItem('token');
                  
                  // 회사 설정에서 080 번호 가져오기
                  const settingsRes = await fetch('/api/companies/settings', {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  if (settingsRes.ok) {
                    const settingsData = await settingsRes.json();
                    if (settingsData.reject_number) {
                      setOptOutNumber(settingsData.reject_number);
                    }
                  }
                  
                  const res = await fetch('/api/companies/callback-numbers', {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  const data = await res.json();
                  if (data.success) {
                    setCallbackNumbers(data.numbers || []);
                    const defaultCb = data.numbers?.find((n: any) => n.is_default);
                    if (defaultCb) setSelectedCallback(defaultCb.phone);
                  }
                } catch (err) {
                  console.error('회신번호 로드 실패:', err);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              <span className="text-sm font-medium">직접발송</span>
            </button>
            <button
              onClick={() => setShowCalendar(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Calendar className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">캘린더</span>
            </button>
            <button
              onClick={() => setShowResults(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <BarChart3 className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">발송결과</span>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">설정</span>
            </button>
            <button
              onClick={() => navigate('/unsubscribes')}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Ban className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">수신거부</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">로그아웃</span>
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* 통계 카드 */}
        {/* 통계 + AI 프롬프트 영역 */}
        <div className="flex gap-6 mb-8">
          {/* 좌측: 통계 카드 */}
          <div className="w-72 space-y-4">
            {/* 플랜 정보 */}
            <div 
              onClick={() => navigate('/pricing')}
              className="flex items-center justify-between p-3 bg-white/50 rounded-xl cursor-pointer hover:bg-white/80 transition-all"
            >
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-800">{planInfo?.plan_name || '로딩...'}</span>
                {planInfo?.plan_code === 'FREE' && !planInfo?.is_trial_expired && (
                  <span className="text-orange-500 ml-1 text-xs">
                    D-{Math.max(0, Math.ceil((new Date(planInfo.trial_expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))}
                  </span>
                )}
                {planInfo?.plan_code === 'FREE' && planInfo?.is_trial_expired && (
                  <span className="text-red-500 ml-1 text-xs">만료</span>
                )}
              </div>
              <span className="text-green-700 text-xs font-medium">요금제 안내 →</span>
            </div>
                        {/* 고객 현황 */}
                        <div className="bg-white/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400 font-medium">고객 현황</span>
                <button onClick={() => setShowCustomerDB(true)} className="text-green-700 text-xs font-medium hover:text-green-800 transition-colors">DB 정보조회 →</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{parseInt(stats?.total || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">전체</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-green-700">{parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">수신동의</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{parseInt(stats?.male_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">남성</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{parseInt(stats?.female_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">여성</div>
                </div>
              </div>
            </div>

            {/* 발송 현황 */}
            <div className="bg-white/50 rounded-xl p-4">
              <div className="text-xs text-gray-400 font-medium mb-3">발송 현황</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{(stats?.monthly_sent || 0).toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">이번 달</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{stats?.success_rate || '0'}%</div>
                  <div className="text-xs text-gray-400 mt-1">성공률</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-amber-600">{parseInt(stats?.vip_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">VIP</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">-</div>
                  <div className="text-xs text-gray-400 mt-1">30일 매출</div>
                </div>
              </div>
            </div>

            
            </div>

{/* 우측: AI 프롬프트 입력 */}
          <div className="flex-1 bg-green-50 rounded-xl p-6 border border-green-200">
          <h3 className="text-xl font-bold text-gray-800 mb-2">AI 자동화 마케팅</h3>
            <p className="text-sm text-gray-500 mb-5">
              한 줄이면 충분합니다. 타겟 선정부터 메시지 작성, 발송 시간까지 AI가 자동으로 설계해드립니다.
            </p>
            <textarea
              value={aiCampaignPrompt}
              onChange={(e) => setAiCampaignPrompt(e.target.value)}
              className="w-full p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
              rows={4}
              placeholder="예: 30대 여성 VIP 고객에게 봄 신상품 20% 할인 안내 문자 보내줘"
            />
            {/* 3분할 메뉴 카드 */}
            <div className="grid grid-cols-3 gap-4 mt-6">
              {/* 고객 DB 업로드 - 슬레이트 블루 */}
              <button 
                onClick={() => setShowFileUpload(true)}
                className="p-6 bg-slate-600 hover:bg-slate-700 rounded-xl transition-all hover:shadow-lg group text-right h-[140px] flex flex-col justify-between"
              >
                <div>
                  <div className="text-lg font-bold text-white mb-1">고객 DB 업로드</div>
                  <div className="text-sm text-slate-200">엑셀/CSV로 고객 추가</div>
                </div>
                <div className="text-2xl text-slate-300 self-end">→</div>
              </button>

              {/* 직접 타겟 설정 - 금색 */}
              <button 
                onClick={() => { setShowDirectTargeting(true); loadEnabledFields(); }}
                className="p-6 bg-amber-500 hover:bg-amber-600 rounded-xl transition-all hover:shadow-lg group text-right h-[140px] flex flex-col justify-between"
              >
                <div>
                  <div className="text-lg font-bold text-white mb-1">직접 타겟 설정</div>
                  <div className="text-sm text-amber-100">원하는 고객을 직접 필터링</div>
                </div>
                <div className="text-2xl text-amber-200 self-end">→</div>
              </button>

              {/* AI 추천 발송 - 초록 */}
              <button 
                onClick={handleAiCampaignGenerate}
                disabled={aiLoading}
                className="p-6 bg-green-700 hover:bg-green-800 rounded-xl transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-right h-[140px] flex flex-col justify-between relative"
              >
                <div className="absolute -top-2 right-3 bg-white text-green-700 text-xs font-bold px-2 py-0.5 rounded-full shadow">
                  MAIN
                </div>
                {aiLoading ? (
                  <>
                    <div>
                      <div className="text-lg font-bold text-white mb-1">AI 분석 중...</div>
                      <div className="text-sm text-green-200">잠시만 기다려주세요</div>
                    </div>
                    <div className="text-2xl text-green-300 self-end animate-pulse">⏳</div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-lg font-bold text-white mb-1">AI 추천 발송</div>
                      <div className="text-sm text-green-200">자연어로 AI가 자동 설계</div>
                    </div>
                    <div className="text-2xl text-green-300 self-end">→</div>
                  </>
                )}
              </button>
            </div>

            {/* AI 안내문구 */}
            <p className="text-xs text-gray-400 text-right mt-2 mb-0">
              AI는 실수할 수 있습니다. 발송 전 미리보기에서 내용을 꼭 확인해주세요.
            </p>
          </div>
        </div>

        {/* 탭 */}
        <div className="bg-transparent rounded-lg -mt-6 mb-8">
        <div className="flex border-b hidden">
            <button
              onClick={() => setActiveTab('target')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'target'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              1. 타겟 추출
            </button>
            <button
              onClick={() => setActiveTab('campaign')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'campaign'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              2. 캠페인 설정
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'send'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              3. 발송
            </button>
            </div>

            <div className="px-4 pt-1 pb-4">
             {/* 타겟 추출 탭 */}
            {activeTab === 'target' && (
              <div>
{/* 5개 기능 카드 */}
<div className="grid grid-cols-5 gap-4">
                  {/* 최근 캠페인 */}
                  <div onClick={() => { loadRecentCampaigns(); setShowRecentCampaigns(true); }} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <BarChart3 className="w-8 h-8 mx-auto mb-3 text-green-700" />
                    <div className="font-semibold text-gray-800 mb-1">최근 캠페인</div>
                    <div className="text-xs text-gray-500 mb-3">최근 발송 내역</div>
                    <div className="text-xl font-bold text-green-700">{recentCampaigns.length}건</div>
                  </div>

                  {/* 추천 템플릿 */}
                  <div onClick={() => setShowTemplates(true)} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <FileText className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <div className="font-semibold text-gray-800 mb-1">추천 템플릿</div>
                    <div className="text-xs text-gray-500 mb-3">원클릭 적용</div>
                    <div className="text-xl font-bold text-amber-600">8개</div>
                  </div>

                  {/* 고객 인사이트 */}
                  <div onClick={() => setShowInsights(true)} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <Users className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">고객 인사이트</div>
                    <div className="text-xs text-gray-500 mb-3">세그먼트 분포</div>
                    <div className="text-xl font-bold text-green-700">5개</div>
                  </div>

                  {/* 오늘의 통계 */}
                  <div onClick={() => setShowTodayStats(true)} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <Activity className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">오늘의 통계</div>
                    <div className="text-xs text-gray-500 mb-3">발송량/성공률</div>
                    <div className="text-xl font-bold text-green-700">{(stats?.monthly_sent || 0).toLocaleString()}건</div>
                  </div>

                  {/* 예약 대기 */}
                  <div onClick={() => { loadScheduledCampaigns(); setShowScheduled(true); }} className="bg-transparent border border-gray-200 rounded-xl p-6 min-h-[140px] cursor-pointer hover:border-amber-400 hover:shadow-md transition-all text-center">
                    <Clock className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <div className="font-semibold text-gray-800 mb-1">예약 대기</div>
                    <div className="text-xs text-gray-500 mb-3">곧 발송될 캠페인</div>
                    <div className="text-xl font-bold text-amber-600">{scheduledCampaigns.length}건</div>
                  </div>
                </div>
              </div>
            )}
            {/* 캠페인 설정 탭 */}
            {activeTab === 'campaign' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">캠페인 설정</h3>
                
                {/* 캠페인 컨텍스트 표시 */}
                {campaignContext && (
                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <span className="text-sm text-purple-700">
                      📌 마케팅 목표: {campaignContext}
                    </span>
                  </div>
                )}

                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      캠페인명 *
                    </label>
                    <input
                      type="text"
                      value={campaign.campaignName}
                      onChange={(e) => setCampaign({ ...campaign, campaignName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="예: 1월 VIP 프로모션"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      메시지 유형
                    </label>
                    <select
                      value={campaign.messageType}
                      onChange={(e) => setCampaign({ ...campaign, messageType: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="SMS">SMS (단문)</option>
                      <option value="LMS">LMS (장문)</option>
                      <option value="MMS">MMS (사진)</option>
                      <option value="KAKAO">카카오 알림톡</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        메시지 내용 *
                      </label>
                      <button
                        onClick={() => setShowAiMessage(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm font-medium flex items-center gap-1"
                      >
                        ✨ AI 문구 생성
                      </button>
                    </div>
                    <textarea
                      value={campaign.messageContent}
                      onChange={(e) => setCampaign({ ...campaign, messageContent: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg h-32"
                      placeholder="메시지 내용을 입력하세요..."
                    />
                    <div className="text-right text-sm text-gray-500 mt-1">
                      {campaign.messageContent.length}/90자 (SMS 기준)
                    </div>
                  </div>

                  {/* AI 메시지 생성 모달 */}
                  {showAiMessage && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                        <h4 className="text-lg font-semibold mb-4">✨ AI 문구 생성</h4>
                        
                        {aiMessages.length === 0 ? (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              어떤 메시지를 보내고 싶은지 설명해주세요.
                            </p>
                            <textarea
                              value={aiPrompt || campaignContext}
                              onChange={(e) => setAiPrompt(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg h-24 mb-4"
                              placeholder="예: 신규 고객 대상 20% 할인 쿠폰 안내"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setShowAiMessage(false);
                                  setAiPrompt('');
                                }}
                                className="flex-1 px-4 py-2 border rounded-lg text-gray-600"
                              >
                                취소
                              </button>
                              <button
                                onClick={handleAiGenerateMessage}
                                disabled={aiLoading}
                                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                              >
                                {aiLoading ? '생성 중...' : 'AI 문구 생성'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              AI가 생성한 문구 중 하나를 선택하세요.
                            </p>
                            <div className="space-y-4 mb-4">
                              {aiMessages.map((msg, idx) => (
                                <div
                                  key={idx}
                                  className="border rounded-lg p-4 hover:border-purple-500 cursor-pointer"
                                  onClick={() => handleSelectAiMessage(msg)}
                                >
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="font-medium text-purple-600">
                                      {msg.variant_id}. {msg.variant_name}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                      점수: {msg.score}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-600 mb-2">{msg.concept}</p>
                                  <div className="bg-gray-50 p-2 rounded text-sm">
                                    {campaign.messageType === 'SMS' ? msg.sms_text : msg.lms_text}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                setAiMessages([]);
                                setAiPrompt('');
                              }}
                              className="w-full px-4 py-2 border rounded-lg text-gray-600"
                            >
                              다시 생성하기
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={campaign.isAd}
                        onChange={(e) => setCampaign({ ...campaign, isAd: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">광고성 메시지 (앞에 [광고] 자동 추가)</span>
                    </label>
                  </div>

                  <button
                    onClick={handleCreateCampaign}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    캠페인 생성
                  </button>
                </div>
              </div>
            )}

            {/* 발송 탭 */}
            {activeTab === 'send' && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📤</div>
                <h3 className="text-lg font-semibold mb-2">발송 준비 완료</h3>
                <p className="text-gray-500 mb-6">
                  캠페인 목록에서 발송할 캠페인을 선택하세요
                </p>
                <button
                  onClick={() => alert('캠페인 목록 페이지로 이동 (개발 예정)')}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium"
                >
                  캠페인 발송하기
                </button>
              </div>
            )}
          </div>
        </div>
{/* AI 캠페인 결과 팝업 */}
{showAiResult && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className={`bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto ${aiStep === 2 ? 'w-[960px]' : 'w-[600px]'}`}>
              
              {/* 헤더 */}
              <div className="p-6 border-b bg-green-50">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span>✨</span> AI 추천 결과 {aiStep === 1 ? '- 타겟 & 채널' : '- 메시지 & 발송'}
                  </h3>
                  <button onClick={() => { setShowAiResult(false); setAiStep(1); }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                </div>
              </div>

              {/* Step 1: 타겟 + 채널 선택 */}
              {aiStep === 1 && (
                <div className="p-6 space-y-6">
                  {/* 타겟 요약 */}
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600 mb-1">📌 추출된 타겟</div>
                    <div className="font-semibold text-gray-800">{aiResult?.target?.description || '추천 타겟'}</div>
<div className="text-blue-600 font-bold text-lg mt-1">{aiResult?.target?.count?.toLocaleString() || 0}명</div>
                  </div>

                  {/* 채널 추천 */}
                  <div>
                    <div className="text-sm text-gray-600 mb-2">📱 AI 추천 채널</div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                    <div className="font-semibold text-purple-800">{aiResult?.recommendedChannel || 'SMS'} 추천</div>
                    <div className="text-sm text-purple-600 mt-1">"{aiResult?.channelReason || '추천 채널입니다'}"</div>
                    </div>
{/* 광고성 여부 */}
<div className="flex items-center justify-between bg-yellow-50 rounded-lg p-4 mb-4">
                    <div>
                      <div className="font-semibold text-gray-800">📢 광고성 메시지</div>
                      <div className="text-sm text-gray-500">
                        {isAd ? '(광고) 표기 + 무료거부번호 필수 포함' : '알림성 메시지 (표기 불필요)'}
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={isAd} 
                        onChange={(e) => setIsAd(e.target.checked)}
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                  </div>
                    <div className="text-sm text-gray-600 mb-2">채널 선택</div>
                    <div className="grid grid-cols-4 gap-2">
                      {['SMS', 'LMS', 'MMS', '카카오'].map((ch) => (
                        <button
                          key={ch}
                          onClick={() => setSelectedChannel(ch)}
                          className={`p-3 rounded-lg border-2 text-center font-medium transition-all ${
                            selectedChannel === ch
                              ? 'border-purple-500 bg-purple-50 text-purple-700'
                              : 'border-gray-200 hover:border-gray-300 text-gray-600'
                          }`}
                        >
                          {ch === 'SMS' && '📱 '}
                          {ch === 'LMS' && '📝 '}
                          {ch === 'MMS' && '🖼️ '}
                          {ch === '카카오' && '💬 '}
                          {ch}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 다음 버튼 */}
                  <button
                    onClick={handleAiGenerateChannelMessage}
                    disabled={aiLoading}
                    className="w-full py-4 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiLoading ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        메시지 생성 중...
                      </>
                    ) : (
                      <>다음: 문구 생성 →</>
                    )}
                  </button>
                </div>
              )}

              {/* Step 2: 메시지 + 발송시간 */}
              {aiStep === 2 && (
                <div className="p-6 space-y-6">
                  {/* 선택된 채널 표시 */}
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>선택된 채널:</span>
                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
                  </div>

                  {/* 메시지 3안 - 모던 폰 UI */}
                  <div>
                    <div className="text-sm text-gray-600 mb-3">💬 {selectedChannel} 메시지 추천 (택1)</div>
                    <div className="grid grid-cols-3 gap-5">
                      {aiResult?.messages?.length > 0 ? (
                        aiResult.messages.map((msg: any, idx: number) => (
                          <label key={msg.variant_id || idx} className="cursor-pointer group">
                            <input type="radio" name="message" className="hidden" defaultChecked={idx === 0} />
                            {/* 모던 폰 프레임 */}
                            <div className="rounded-[1.8rem] p-[3px] transition-all bg-gray-300 group-has-[:checked]:bg-gradient-to-b group-has-[:checked]:from-purple-400 group-has-[:checked]:to-purple-600 group-has-[:checked]:shadow-lg group-has-[:checked]:shadow-purple-200 hover:bg-gray-400">
                              <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                                {/* 상단 - 타입명 */}
                                <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                                  <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                                  <span className="text-[11px] font-bold text-purple-600">{msg.variant_id}. {msg.variant_name}</span>
                                </div>
                                {/* 메시지 영역 - 스크롤 */}
                                <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                                  <div className="flex gap-2">
                                    <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.6] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                                      {aiResult?.usePersonalization ? (() => {
                                        const sampleData: Record<string, string> = { '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점', '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '평균주문금액': '43,750', 'LTV점수': '85' };
                                        let text = msg.message_text || '';
                                        Object.entries(sampleData).forEach(([k, v]) => { text = text.replace(new RegExp(`%${k}%`, 'g'), v); });
                                        return text;
                                      })() : msg.message_text}
                                    </div>
                                  </div>
                                </div>
                                {/* 하단 바이트 */}
                                <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                                  <span className="text-[10px] text-gray-400">{msg.byte_count || '?'} / {selectedChannel === 'SMS' ? 90 : 2000} bytes</span>
                                </div>
                              </div>
                            </div>
                          </label>
                        ))
                      ) : (
                        <div className="col-span-3 text-center py-8 text-gray-400">
                          메시지를 불러오는 중...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 발송시간 */}
                  <div>
                    <div className="text-base font-semibold text-gray-700 mb-4">⏰ 발송시간</div>
                    <div className="flex gap-3 items-stretch">
                      <label 
                        onClick={() => setSendTimeOption('ai')}
                        className={`flex-1 p-3 border-2 rounded-xl cursor-pointer text-center flex flex-col justify-center ${sendTimeOption === 'ai' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                      >
                        <div className="font-bold text-base">🤖 AI 추천시간</div>
                        <div className="text-sm text-gray-500 mt-1">{aiResult?.recommendedTime || '최적 시간'}</div>
                      </label>
                      <label 
                        onClick={() => setSendTimeOption('now')}
                        className={`flex-1 p-3 border-2 rounded-xl cursor-pointer text-center flex flex-col justify-center ${sendTimeOption === 'now' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                      >
                        <div className="font-bold text-base">⚡ 즉시 발송</div>
                        <div className="text-sm text-gray-500 mt-1">지금 바로</div>
                      </label>
                      <label 
                        onClick={() => setSendTimeOption('custom')}
                        className={`flex-[1.5] p-3 border-2 rounded-xl cursor-pointer text-center ${sendTimeOption === 'custom' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                      >
                        <div className="font-bold text-base mb-2">📅 직접 선택</div>
                        <div className="flex flex-col gap-2 w-full">
                          <input 
                            type="date" 
                            className="border-2 rounded-lg px-3 py-1.5 text-sm w-full text-center"
                            value={customSendTime?.split('T')[0] || ''}
                            min={new Date().toISOString().split('T')[0]}
                            onClick={(e) => { e.stopPropagation(); setSendTimeOption('custom'); }}
                            onChange={(e) => {
                              const time = customSendTime?.split('T')[1] || '09:00';
                              setCustomSendTime(`${e.target.value}T${time}`);
                            }}
                          />
                          <div className="flex items-center justify-center gap-2">
                            <select
                              value={parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9') >= 12 ? 'PM' : 'AM'}
                              onClick={(e) => { e.stopPropagation(); setSendTimeOption('custom'); }}
                              onChange={(e) => {
                                const currentHour = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                                const hour12 = currentHour === 0 ? 12 : currentHour > 12 ? currentHour - 12 : currentHour;
                                let hour24 = e.target.value === 'PM' 
                                  ? (hour12 === 12 ? 12 : hour12 + 12) 
                                  : (hour12 === 12 ? 0 : hour12);
                                const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                                const minute = customSendTime?.split('T')[1]?.split(':')[1] || '00';
                                setCustomSendTime(`${date}T${hour24.toString().padStart(2, '0')}:${minute}`);
                              }}
                              className="border-2 rounded-lg px-2 py-1.5 text-sm font-medium"
                            >
                              <option value="AM">오전</option>
                              <option value="PM">오후</option>
                            </select>
                            <input
                              type="number"
                              min="1"
                              max="12"
                              value={(() => {
                                const hour = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                                return hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                              })()}
                              onClick={(e) => { e.stopPropagation(); setSendTimeOption('custom'); }}
                              onChange={(e) => {
                                let hour12 = Math.min(12, Math.max(1, parseInt(e.target.value) || 1));
                                const currentHour = parseInt(customSendTime?.split('T')[1]?.split(':')[0] || '9');
                                const isPM = currentHour >= 12;
                                let hour24 = isPM ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
                                const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                                const minute = customSendTime?.split('T')[1]?.split(':')[1] || '00';
                                setCustomSendTime(`${date}T${hour24.toString().padStart(2, '0')}:${minute}`);
                              }}
                              className="w-12 border-2 rounded-lg px-2 py-1.5 text-sm text-center"
                            />
                            <span className="text-lg font-bold text-gray-400">:</span>
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={parseInt(customSendTime?.split('T')[1]?.split(':')[1] || '0')}
                              onClick={(e) => { e.stopPropagation(); setSendTimeOption('custom'); }}
                              onChange={(e) => {
                                let minute = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                const date = customSendTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                                const hour = customSendTime?.split('T')[1]?.split(':')[0] || '09';
                                setCustomSendTime(`${date}T${hour}:${minute.toString().padStart(2, '0')}`);
                              }}
                              className="w-12 border-2 rounded-lg px-2 py-1.5 text-sm text-center"
                            />
                          </div>
                        </div>
                      </label>
                    </div>
                    </div>

{/* 회신번호 선택 */}
<div>
  <div className="text-base font-semibold text-gray-700 mb-3">📞 회신번호</div>
  <div className="flex gap-3 items-center">
    <select
      value={useIndividualCallback ? '__individual__' : selectedCallback}
      onChange={(e) => {
        if (e.target.value === '__individual__') {
          setUseIndividualCallback(true);
          setSelectedCallback('');
        } else {
          setUseIndividualCallback(false);
          setSelectedCallback(e.target.value);
        }
      }}
      className="flex-1 border-2 rounded-lg px-4 py-3 text-sm focus:border-purple-400 focus:outline-none"
    >
      <option value="">회신번호 선택</option>
      <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
      {callbackNumbers.map((cb) => (
        <option key={cb.id} value={cb.phone}>
          {cb.label || cb.phone} {cb.is_default && '(기본)'}
        </option>
      ))}
    </select>
    {useIndividualCallback && (
      <span className="text-sm text-blue-600">💡 각 고객의 주이용매장 회신번호로 발송</span>
    )}
  </div>
</div>

{/* 하단 버튼 */}
{testSentResult && (
                    <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap mb-3 ${testSentResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {testSentResult}
                    </div>
                  )}
                  <div className="flex gap-3 pt-4 border-t">
                    <button
                      onClick={() => setAiStep(1)}
                      className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center gap-2"
                    >
                      ← 채널변경
                    </button>
                    <button
  onClick={handleTestSend}
  disabled={testSending || testCooldown}
  className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
>
{testSending ? '📱 발송 중...' : testCooldown ? '⏳ 10초 대기' : '📱 담당자 테스트'}
</button>
<button 
  onClick={() => setShowPreview(true)}
  className="flex-1 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
>
  👁️ 미리보기
</button>
<button 
  onClick={handleAiCampaignSend}
  disabled={isSending}
  className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800 flex items-center justify-center gap-2"
>
{isSending ? '⏳ 발송 중...' : '🚀 발송하기'}
</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* 미리보기 모달 */}
        {showPreview && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className={`bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto ${aiStep === 2 ? 'w-[960px]' : 'w-[600px]'}`}>
              <div className="p-6 border-b bg-green-50">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">📱 발송 미리보기</h3>
                  <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                {/* 타겟 정보 */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">📌 발송 대상</div>
                  <div className="font-semibold">{aiResult?.target?.description || '타겟 고객'}</div>
                  <div className="text-blue-600 font-bold">{aiResult?.target?.count?.toLocaleString() || 0}명</div>
                  {aiResult?.target?.unsubscribeCount > 0 && (
                    <div className="text-rose-500 text-sm mt-1">수신거부 제외: {aiResult?.target?.unsubscribeCount?.toLocaleString()}명</div>
                  )}
                </div>

                {/* 채널 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">채널:</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
                </div>

                {/* 회신번호 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">📞 회신번호:</span>
                  <span className="font-medium">
                    {useIndividualCallback ? '개별회신번호 (고객별 매장)' : (selectedCallback || '미선택')}
                  </span>
                </div>

                {/* 메시지 미리보기 - 개인화 샘플 */}
                <div>
                  <div className="text-sm text-gray-600 mb-2">💬 메시지 내용</div>
                  {aiResult?.usePersonalization && aiResult?.personalizationVars?.length > 0 ? (
                    <div>
                      <div className="text-xs text-purple-600 mb-2">✨ 개인화 적용 예시 (상위 3명 샘플)</div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점', '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '평균주문금액': '43,750', 'LTV점수': '85' },
                          { '이름': '이영희', '포인트': '8,200', '등급': 'GOLD', '매장명': '홍대점', '지역': '경기', '구매금액': '180,000', '구매횟수': '5', '평균주문금액': '36,000', 'LTV점수': '62' },
                          { '이름': '박지현', '포인트': '25,800', '등급': 'VIP', '매장명': '부산센텀점', '지역': '부산', '구매금액': '520,000', '구매횟수': '12', '평균주문금액': '43,300', 'LTV점수': '91' },
                        ].map((sample, idx) => {
                          let msg = aiResult?.messages?.[0]?.message_text || '';
                          Object.entries(sample).forEach(([varName, value]) => {
                            msg = msg.replace(new RegExp(`%${varName}%`, 'g'), value);
                          });
                          return (
                            <div key={idx} className="rounded-2xl border-2 border-gray-200 overflow-hidden bg-white">
                              <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-500 text-center">샘플 {idx + 1}</div>
                              <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap bg-gray-50" style={{ minHeight: '120px', maxHeight: '200px', overflowY: 'auto' }}>
                                {msg}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-100 rounded-lg p-4 whitespace-pre-wrap text-sm">
                      {aiResult?.messages?.[0]?.message_text || '메시지 없음'}
                    </div>
                  )}
                </div>

                {/* 발송 시간 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">⏰ 발송시간:</span>
                  <span className="font-medium">
                    {sendTimeOption === 'ai' ? (aiResult?.recommendedTime || 'AI 추천시간') : 
                     sendTimeOption === 'now' ? '즉시 발송' : 
                     customSendTime ? new Date(customSendTime).toLocaleString('ko-KR') : '직접 선택'}
                  </span>
                </div>
              </div>

              <div className="p-6 border-t space-y-3">
                {testSentResult && (
                  <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap ${testSentResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {testSentResult}
                  </div>
                )}
                {testSentResult && (
                  <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap mb-3 ${testSentResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {testSentResult}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowPreview(false); setTestSentResult(null); }}
                    className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
                  >
                    ← 돌아가기
                  </button>
                  <button
                    onClick={handleTestSend}
                    disabled={testSending || testCooldown}
                    className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                  >
                    {testSending ? '📱 발송 중...' : testCooldown ? '⏳ 10초 대기' : '📱 담당자 사전수신'}
                  </button>
                  <button
                    onClick={handleAiCampaignSend}
                    disabled={isSending}
                    className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800"
                  >
                    {isSending ? '⏳ 발송 중...' : '🚀 발송 확정'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* 캠페인 확정 성공 모달 */}
        {showSuccess && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[400px] text-center p-8">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">캠페인이 확정되었습니다!</h3>
               <div className="bg-green-50 rounded-lg p-4 mb-6 text-left">
               <div className="text-sm text-gray-600 space-y-1">
                  <div>📱 채널: <span className="font-medium">{selectedChannel}</span></div>
                  <div>👥 대상: <span className="font-medium">{aiResult?.target?.count?.toLocaleString() || 0}명</span></div>
                  {aiResult?.target?.unsubscribeCount > 0 && (
                    <div>🚫 수신거부 제외: <span className="font-medium text-rose-500">{aiResult?.target?.unsubscribeCount?.toLocaleString()}명</span></div>
                  )}
                  <div>⏰ 발송: <span className="font-medium">{successSendInfo}</span></div>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSuccess(false);
                    setShowCalendar(true);
                  }}
                  className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
                >
                  📅 캘린더 확인
                </button>
                <button
                  onClick={() => setShowSuccess(false)}
                  className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        )}
        {showResults && <ResultsModal onClose={() => setShowResults(false)} token={localStorage.getItem('token')} />}
        {showCustomerDB && <CustomerDBModal onClose={() => setShowCustomerDB(false)} token={localStorage.getItem('token')} />}
        {showCalendar && <CalendarModal onClose={() => setShowCalendar(false)} token={localStorage.getItem('token')} />}
        
        {/* 최근 캠페인 모달 */}
        {showRecentCampaigns && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-hidden">
              <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">📊 최근 캠페인</h3>
                <button onClick={() => setShowRecentCampaigns(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                {recentCampaigns.length > 0 ? (
                  <div className="space-y-3">
                    {recentCampaigns.map((c: any) => (
                      <div key={c.id} className="p-4 border rounded-lg hover:border-blue-400 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-semibold text-gray-800">{c.campaign_name}</div>
                          <span className={`px-2 py-1 rounded text-xs ${
                            c.status === 'completed' ? 'bg-amber-100 text-amber-700' :
                            c.status === 'scheduled' ? 'bg-pink-100 text-pink-700' :
                            c.status === 'sending' ? 'bg-yellow-100 text-yellow-700' :
                            c.status === 'cancelled' ? 'bg-gray-200 text-gray-500' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {c.status === 'completed' ? '완료' : c.status === 'scheduled' ? '예약' : c.status === 'sending' ? '발송중' : c.status === 'cancelled' ? '취소' : '준비'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 space-y-1">
                          <div>
                            {c.send_type === 'direct' ? '📤' : '🤖'} 
                            <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${c.send_type === 'direct' ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700'}`}>
                              {c.send_type === 'direct' ? '직접' : 'AI'}
                            </span>
                            <span className="ml-2">📱 {c.message_type} · 👥 {c.target_count?.toLocaleString()}명</span>
                          </div>
                          <div>✅ 성공 {c.success_count?.toLocaleString() || 0} · ❌ 실패 {c.fail_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString('ko-KR')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">최근 캠페인이 없습니다</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 추천 템플릿 모달 */}
        {showTemplates && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b bg-purple-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">📝 추천 템플릿</h3>
                <button onClick={() => setShowTemplates(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-2 gap-4">
                  <div onClick={() => { setAiCampaignPrompt('VIP 고객에게 감사 인사 문자 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">💎</div>
                    <div className="font-semibold text-gray-800 mb-1">VIP 감사 인사</div>
                    <div className="text-sm text-gray-500">VIP 고객에게 감사 메시지 발송</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('생일인 고객에게 축하 쿠폰 문자 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">🎂</div>
                    <div className="font-semibold text-gray-800 mb-1">생일 축하</div>
                    <div className="text-sm text-gray-500">생일 고객에게 축하 쿠폰 발송</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('신상품 출시 안내 문자 전체 고객에게 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">🆕</div>
                    <div className="font-semibold text-gray-800 mb-1">신상품 안내</div>
                    <div className="text-sm text-gray-500">신상품 출시 소식 전체 발송</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('30대 여성 고객에게 봄 시즌 할인 이벤트 문자 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">🌸</div>
                    <div className="font-semibold text-gray-800 mb-1">시즌 할인</div>
                    <div className="text-sm text-gray-500">타겟 고객 시즌 프로모션</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('3개월 이상 미구매 고객에게 재방문 유도 문자 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">🔄</div>
                    <div className="font-semibold text-gray-800 mb-1">재방문 유도</div>
                    <div className="text-sm text-gray-500">휴면 고객 활성화</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('포인트 소멸 예정 고객에게 사용 안내 문자 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">💰</div>
                    <div className="font-semibold text-gray-800 mb-1">포인트 소멸 안내</div>
                    <div className="text-sm text-gray-500">포인트 만료 전 알림</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('설날 연휴 배송 안내 문자 전체 고객에게 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">📦</div>
                    <div className="font-semibold text-gray-800 mb-1">배송 안내</div>
                    <div className="text-sm text-gray-500">연휴/이벤트 배송 공지</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('마스크팩 좋아하는 고객에게 1+1 이벤트 문자 보내줘'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">🎁</div>
                    <div className="font-semibold text-gray-800 mb-1">1+1 이벤트</div>
                    <div className="text-sm text-gray-500">카테고리별 프로모션</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
                            {/* 파일 업로드 캠페인 모달 */}
        {/* 직접 타겟 설정 모달 */}
        {showDirectTargeting && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[95vh] overflow-hidden">
              {/* 헤더 */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">직접 타겟 설정</h3>
                  <p className="text-sm text-gray-500 mt-0.5">필터 조건으로 대상 고객을 선택하세요</p>
                </div>
                <button 
                  onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 필터 영역 */}
              <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
                {/* 수신번호 필드 선택 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">수신번호 필드</label>
                  <select 
                    value={targetPhoneField}
                    onChange={(e) => setTargetPhoneField(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white text-gray-700"
                  >
                    <option value="phone">phone (전화번호)</option>
                    <option value="mobile">mobile</option>
                    <option value="phone_number">phone_number</option>
                  </select>
                </div>

                <div className="border-t border-gray-100"></div>

                {/* 필터 조건 헤더 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">필터 조건</span>
                    {Object.keys(targetFilters).length > 0 && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        {Object.values(targetFilters).filter(v => v).length}개 적용
                      </span>
                    )}
                  </div>
                  <button onClick={resetTargetFilters} className="text-xs text-green-600 hover:text-green-700 font-medium">초기화</button>
                </div>

                {/* 아코디언 필터 */}
                {enabledFields.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    필터 항목을 로딩 중...
                  </div>
                ) : (
                  (() => {
                    const CAT_LABELS: Record<string, string> = {
                      basic: '📋 기본정보', segment: '🏷️ 등급/세그먼트', purchase: '💰 구매/거래',
                      loyalty: '⭐ 충성도/활동', store: '🏪 소속/채널', preference: '❤️ 선호/관심',
                      marketing: '📱 마케팅수신', custom: '🔧 커스텀'
                    };
                    // 필터 대상에서 제외할 필드 (식별용/수신동의는 별도 처리)
                    const SKIP_FIELDS = ['name', 'phone', 'email', 'address', 'opt_in_sms', 'opt_in_date', 'opt_out_date'];
                    const filterableFields = enabledFields.filter((f: any) => !SKIP_FIELDS.includes(f.field_key));
                    
                    // 연령대 프리셋
                    const AGE_OPTIONS = [
                      { label: '20대', value: '20' }, { label: '30대', value: '30' },
                      { label: '40대', value: '40' }, { label: '50대', value: '50' },
                      { label: '60대 이상', value: '60' },
                    ];
                    // 금액 프리셋
                    const AMOUNT_OPTIONS = [
                      { label: '5만원 이상', value: '50000' }, { label: '10만원 이상', value: '100000' },
                      { label: '50만원 이상', value: '500000' }, { label: '100만원 이상', value: '1000000' },
                      { label: '500만원 이상', value: '5000000' },
                    ];
                    // 일수 프리셋
                    const DAYS_OPTIONS = [
                      { label: '7일 이내', value: '7' }, { label: '30일 이내', value: '30' },
                      { label: '90일 이내', value: '90' }, { label: '180일 이내', value: '180' },
                      { label: '1년 이내', value: '365' },
                    ];

                    const renderInput = (field: any) => {
                      const val = targetFilters[field.field_key] || '';
                      const set = (v: string) => setTargetFilters(prev => {
                        if (!v) { const next = {...prev}; delete next[field.field_key]; return next; }
                        return {...prev, [field.field_key]: v};
                      });
                      const selectClass = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm bg-white";

                      // 연령대 특수 처리
                      if (field.field_key === 'age_group') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 문자열 + DB 옵션 → 드롭다운
                      if (field.data_type === 'string' && filterOptions[field.field_key]?.length) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {filterOptions[field.field_key].map((opt: string) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        );
                      }

                      // 금액 필드 → 프리셋 드롭다운
                      if (field.data_type === 'number' && ['total_purchase_amount', 'avg_order_value'].includes(field.field_key)) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {AMOUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 숫자 필드 → 직접 입력
                      if (field.data_type === 'number') {
                        return (
                          <input type="number" value={val} onChange={e => set(e.target.value)}
                            placeholder="이상" className={selectClass} />
                        );
                      }

                      // 날짜 필드 → 일수 드롭다운
                      if (field.data_type === 'date') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {DAYS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 불리언
                      if (field.data_type === 'boolean') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            <option value="true">예</option>
                            <option value="false">아니오</option>
                          </select>
                        );
                      }

                      // 기본: 텍스트 입력
                      return (
                        <input type="text" value={val} onChange={e => set(e.target.value)}
                          placeholder="입력" className={selectClass} />
                      );
                    };

                    return (
                      <div className="space-y-2">
                        {Object.entries(CAT_LABELS).map(([cat, label]) => {
                          const catFields = filterableFields.filter((f: any) => f.category === cat);
                          if (catFields.length === 0) return null;
                          const activeCount = catFields.filter((f: any) => targetFilters[f.field_key]).length;
                          const isExpanded = expandedCats[cat] ?? false;

                          return (
                            <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-700">{label}</span>
                                  <span className="text-xs text-gray-400">({catFields.length})</span>
                                  {activeCount > 0 && (
                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-semibold">{activeCount}</span>
                                  )}
                                </div>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {isExpanded && (
                                <div className="p-4 bg-white grid grid-cols-2 gap-3 border-t border-gray-100">
                                  {catFields.map((field: any) => (
                                    <div key={field.field_key}>
                                      <label className="block text-xs text-gray-500 mb-1.5">{field.display_name}</label>
                                      {renderInput(field)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}

                {/* 수신동의 */}
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input 
                    type="checkbox" 
                    id="targetSmsOptIn" 
                    checked={targetSmsOptIn}
                    onChange={(e) => setTargetSmsOptIn(e.target.checked)}
                    className="w-4 h-4 text-green-600 rounded focus:ring-green-500" 
                  />
                  <label htmlFor="targetSmsOptIn" className="text-sm text-gray-700">수신동의 고객만 포함</label>
                </div>

                {/* 조회 버튼 */}
                <button
                  onClick={loadTargetCount}
                  disabled={targetCountLoading}
                  className="w-full py-2.5 border border-green-600 text-green-700 rounded-lg hover:bg-green-50 transition-colors font-medium disabled:opacity-50"
                >
                  {targetCountLoading ? '조회 중...' : '대상 인원 조회'}
                </button>
              </div>

              {/* 푸터 - 대상 인원 + 버튼 */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">대상 인원</div>
                      <div className="text-2xl font-bold text-green-700">
                        {targetCountLoading ? '...' : targetCount.toLocaleString()}
                        <span className="text-base font-normal text-gray-500 ml-1">명</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                      className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleTargetExtract}
                      disabled={targetCount === 0}
                      className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Users className="w-4 h-4" />
                      타겟 추출
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showFileUpload && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[90vh] overflow-hidden">
              
              {/* Step 1: 파일 업로드 */}
              {mappingStep === 'upload' && (
                <>
                  <div className="p-4 border-b bg-gradient-to-r from-green-50 to-emerald-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span>📤</span> 파일 업로드 캠페인 생성
                    </h3>
                    <button onClick={() => { 
                      setShowFileUpload(false); 
                      setUploadedFile(null);
                      setFileHeaders([]);
                      setFilePreview([]);
                      setFileTotalRows(0);
                      setFileId('');
                      setMappingStep('upload');
                      setColumnMapping({});
                    }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
                    {!fileHeaders.length ? (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-400 transition-colors relative">
                        {fileUploading && (
                          <div className="absolute inset-0 bg-white bg-opacity-90 flex flex-col items-center justify-center rounded-xl z-10">
                            <div className="text-4xl mb-4 animate-bounce">📊</div>
                            <div className="text-lg font-semibold text-green-600">파일 분석 중...</div>
                            <div className="text-sm text-gray-500 mt-2">잠시만 기다려주세요</div>
                          </div>
                        )}
                        <div className="text-4xl mb-4">📁</div>
                        <p className="text-gray-600 mb-2">엑셀 또는 CSV 파일을 드래그하거나 클릭하여 업로드</p>
                        <p className="text-sm text-gray-400 mb-4">지원 형식: .xlsx, .xls, .csv</p>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setUploadedFile(file);
                              setFileUploading(true);
                              const formData = new FormData();
                              formData.append('file', file);
                              try {
                                const res = await fetch('/api/upload/parse', {
                                  method: 'POST',
                                  body: formData
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setFileHeaders(data.headers);
                                  setFilePreview(data.preview);
                                  setFileTotalRows(data.totalRows);
                                  setFileId(data.fileId);
                                } else {
                                  alert(data.error || '파일 처리 실패');
                                }
                              } catch (err) {
                                alert('파일 업로드 중 오류가 발생했습니다.');
                              } finally {
                                setFileUploading(false);
                              }
                            }
                          }}
                          className="hidden"
                          id="file-upload"
                        />
                        <label
                          htmlFor="file-upload"
                          className={`inline-block px-6 py-3 text-white rounded-lg transition-colors ${fileUploading ? 'bg-gray-400 cursor-wait' : 'bg-green-600 cursor-pointer hover:bg-green-700'}`}
                        >
                          {fileUploading ? '⏳ 파일 분석 중...' : '파일 선택'}
                        </label>
                        <div className="mt-6 bg-gray-50 rounded-lg p-4 text-left">
                          <h4 className="font-semibold text-gray-700 mb-2">📋 업로드 안내</h4>
                          <ul className="text-sm text-gray-600 space-y-1">
                            <li>• 첫 번째 행은 컬럼명으로 인식됩니다</li>
                            <li>• 전화번호 컬럼은 필수입니다</li>
                            <li>• AI가 자동으로 컬럼을 매핑합니다</li>
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">📄</span>
                            <div>
                              <div className="font-semibold text-gray-800">{uploadedFile?.name}</div>
                              <div className="text-sm text-gray-500">총 {fileTotalRows.toLocaleString()}건의 데이터</div>
                            </div>
                          </div>
                          <button onClick={() => { setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); }} className="text-gray-400 hover:text-red-500">✕ 다시 선택</button>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-3">📋 감지된 컬럼 ({fileHeaders.length}개)</h4>
                          <div className="flex flex-wrap gap-2">
                            {fileHeaders.map((h, i) => (
                              <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">{h}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-3">👀 데이터 미리보기 (상위 5건)</h4>
                          <div className="overflow-x-auto border rounded-lg">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  {fileHeaders.map((h, i) => (
                                    <th key={i} className="px-3 py-2 text-left font-medium text-gray-600 border-b whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {filePreview.map((row: any, rowIdx) => (
                                  <tr key={rowIdx} className="hover:bg-gray-50">
                                    {fileHeaders.map((_, colIdx) => (
                                      <td key={colIdx} className="px-3 py-2 border-b text-gray-700 whitespace-nowrap">{row[fileHeaders[colIdx]] ?? '-'}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              setFileUploading(true);
                              const res = await fetch('/api/upload/mapping', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ headers: fileHeaders })
                              });
                              const data = await res.json();
                              if (data.success) {
                                setColumnMapping(data.mapping);
                                setMappingStep('mapping');
                              } else {
                                alert(data.error || '매핑 실패');
                              }
                            } catch (err) {
                              alert('매핑 중 오류가 발생했습니다.');
                            } finally {
                              setFileUploading(false);
                            }
                          }}
                          disabled={fileUploading}
                          className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 flex items-center justify-center gap-2 text-lg disabled:opacity-50"
                        >
                          {fileUploading ? (<><span className="animate-spin">⏳</span>AI가 컬럼을 분석하고 있습니다...</>) : (<><span>🤖</span>AI 자동 매핑 시작</>)}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Step 2: AI 매핑 결과 */}
              {mappingStep === 'mapping' && (
                <>
                  <div className="p-4 border-b bg-green-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span>🤖</span> AI 매핑 결과
                    </h3>
                    <button onClick={() => { setShowFileUpload(false); setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); setMappingStep('upload'); setColumnMapping({}); }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div className="text-center">
                        <div className="font-semibold text-gray-800">{uploadedFile?.name}</div>
                        <div className="text-sm text-gray-500">총 {fileTotalRows.toLocaleString()}건의 데이터</div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-700 mb-3">📋 컬럼 매핑 (수정 가능)</h4>
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {Object.entries(columnMapping).map(([header, dbCol]) => (
                          <div key={header} className="grid grid-cols-[1fr_40px_1fr] items-center p-3 bg-white rounded-lg border gap-2">
                          <span className="text-sm font-medium text-gray-700">{header}</span>
                          <span className="text-gray-400 text-center">→</span>
                          <select
                            value={dbCol || ''}
                            onChange={(e) => setColumnMapping({...columnMapping, [header]: e.target.value || null})}
                            className={`px-3 py-2 rounded-lg border text-sm w-full ${dbCol ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-300'}`}
                          >
                              <option value="">매핑 안함</option>
                              <option value="phone">📱 전화번호</option>
                              <option value="name">👤 이름</option>
                              <option value="gender">⚧ 성별</option>
                              <option value="birth_year">🎂 출생연도</option>
                              <option value="birth_month_day">🎁 생일(월-일)</option>
                              <option value="birth_date">📅 생년월일 전체</option>
                              <option value="grade">⭐ 등급</option>
                              <option value="region">📍 지역</option>
                              <option value="sms_opt_in">✅ 수신동의</option>
                              <option value="email">📧 이메일</option>
                              <option value="total_purchase">💰 총구매액</option>
                              <option value="last_purchase_date">📅 최근구매일</option>
                              <option value="purchase_count">🛒 구매횟수</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                    {!Object.values(columnMapping).includes('phone') && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 flex items-center gap-2">
                        <span>⚠️</span>
                        <span>전화번호 컬럼을 매핑해주세요 (필수)</span>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button onClick={() => setMappingStep('upload')} className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50">← 이전</button>
                      <button
                        onClick={async () => {
                          setUploadProgress({ total: 0, processed: 0, percent: 0 });
                          
                          // 진행률 폴링 시작
                          const progressInterval = setInterval(async () => {
                            try {
                              const pRes = await fetch(`/api/upload/progress/${fileId}`);
                              const pData = await pRes.json();
                              setUploadProgress(pData);
                            } catch (e) {}
                          }, 1000);
                          
                          try {
                            setFileUploading(true);
                            const res = await fetch('/api/upload/save', {
                              method: 'POST',
                              headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${localStorage.getItem('token')}`
                              },
                              body: JSON.stringify({ 
                                fileId, 
                                mapping: columnMapping
                              })
                            });
                            const data = await res.json();
                            if (data.success) {
                              setShowFileUpload(false);
                              setUploadedFile(null);
                              setFileHeaders([]);
                              setFilePreview([]);
                              setFileTotalRows(0);
                              setFileId('');
                              setMappingStep('upload');
                              setColumnMapping({});
                              setUploadResult({ insertCount: data.insertCount, duplicateCount: data.duplicateCount });
                              setShowUploadResult(true);
                              clearInterval(progressInterval);
                            } else {
                              clearInterval(progressInterval);
                              if (data.code === 'PLAN_LIMIT_EXCEEDED') {
                                setPlanLimitInfo(data);
                                setShowPlanLimitError(true);
                                setShowFileUpload(false);
                              } else {
                                alert(data.error || '저장 실패');
                              }
                            }
                          } catch (err) {
                            clearInterval(progressInterval);
                            alert('저장 중 오류가 발생했습니다.');
                          } finally {
                            setFileUploading(false);
                          }
                        }}
                        disabled={!Object.values(columnMapping).includes('phone') || fileUploading}
                        className="flex-1 py-4 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {fileUploading ? (
                          <>
                            <span className="animate-spin">⏳</span>
                            저장 중... {uploadProgress.percent > 0 ? `${uploadProgress.percent}%` : '준비 중'}
                          </>
                        ) : (
                          <>
                            <span>💾</span>
                            고객 데이터 저장 ({fileTotalRows.toLocaleString()}건)
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>
        )}
        {/* 고객 인사이트 모달 */}
        {showInsights && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden">
              <div className="p-4 border-b bg-green-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">👥 고객 인사이트</h3>
                <button onClick={() => setShowInsights(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[80vh] space-y-6">
                {/* 전체 고객 */}
                <div className="p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl text-center">
                  <div className="text-sm text-gray-500 mb-2">전체 고객</div>
                  <div className="text-4xl font-bold text-gray-800">{parseInt(stats?.total || '0').toLocaleString()}명</div>
                  <div className="text-sm text-green-600 mt-2">수신동의: {parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}명</div>
                </div>

                {/* 성별별 현황 */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">성별별 현황</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg text-center">
                      <div className="text-2xl mb-2">👨</div>
                      <div className="text-2xl font-bold text-blue-600">{parseInt(stats?.male_count || '0').toLocaleString()}명</div>
                      <div className="text-xs text-gray-500 mt-1">남성</div>
                    </div>
                    <div className="p-4 bg-pink-50 rounded-lg text-center">
                      <div className="text-2xl mb-2">👩</div>
                      <div className="text-2xl font-bold text-pink-600">{parseInt(stats?.female_count || '0').toLocaleString()}명</div>
                      <div className="text-xs text-gray-500 mt-1">여성</div>
                    </div>
                  </div>
                </div>

                {/* 연령대별 고객분포 */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">연령대별 고객분포</div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-purple-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-purple-600">{parseInt(stats?.age_under20 || '0').toLocaleString()}명</div>
                        <div className="text-xs text-gray-500 mt-1">~19세</div>
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-indigo-600">{parseInt(stats?.age_20s || '0').toLocaleString()}명</div>
                        <div className="text-xs text-gray-500 mt-1">20대</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-cyan-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-cyan-600">{parseInt(stats?.age_30s || '0').toLocaleString()}명</div>
                        <div className="text-xs text-gray-500 mt-1">30대</div>
                      </div>
                      <div className="p-4 bg-teal-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-teal-600">{parseInt(stats?.age_40s || '0').toLocaleString()}명</div>
                        <div className="text-xs text-gray-500 mt-1">40대</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-orange-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-orange-600">{parseInt(stats?.age_50s || '0').toLocaleString()}명</div>
                        <div className="text-xs text-gray-500 mt-1">50대</div>
                      </div>
                      <div className="p-4 bg-red-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-red-600">{parseInt(stats?.age_60plus || '0').toLocaleString()}명</div>
                        <div className="text-xs text-gray-500 mt-1">60대 이상</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 고객등급별 현황 */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">고객등급별 현황</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-yellow-50 rounded-lg text-center">
                      <div className="text-2xl mb-2">⭐</div>
                      <div className="text-2xl font-bold text-yellow-600">{parseInt(stats?.vip_count || '0').toLocaleString()}명</div>
                      <div className="text-xs text-gray-500 mt-1">VIP</div>
                    </div>
                    <div className="p-4 bg-gray-100 rounded-lg text-center">
                      <div className="text-2xl mb-2">👤</div>
                      <div className="text-2xl font-bold text-gray-600">{(parseInt(stats?.total || '0') - parseInt(stats?.vip_count || '0')).toLocaleString()}명</div>
                      <div className="text-xs text-gray-500 mt-1">일반</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 오늘의 통계 모달 */}
        {showTodayStats && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b bg-orange-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">📈 이번 달 통계</h3>
                <button onClick={() => setShowTodayStats(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
                {/* 상단 요약 카드 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl text-center">
                    <div className="text-sm text-gray-500 mb-2">이번 달 총 발송</div>
                    <div className="text-4xl font-bold text-orange-600">{(stats?.monthly_sent || 0).toLocaleString()}건</div>
                  </div>
                  <div className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl text-center">
                    <div className="text-sm text-gray-500 mb-2">이번 달 사용금액</div>
                    <div className="text-4xl font-bold text-green-600">{(stats?.monthly_cost || 0).toLocaleString()}원</div>
                    <div className="text-xs text-gray-400 mt-1">예산: {(stats?.monthly_budget || 0).toLocaleString()}원</div>
                  </div>
                </div>

                {/* 상세 지표 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg text-center">
                    <div className="text-2xl mb-2">✅</div>
                    <div className="text-2xl font-bold text-blue-600">{stats?.success_rate || '0'}%</div>
                    <div className="text-xs text-gray-500">평균 성공률</div>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg text-center">
                    <div className="text-2xl mb-2">📊</div>
                    <div className="text-2xl font-bold text-purple-600">{recentCampaigns.length}건</div>
                    <div className="text-xs text-gray-500">진행된 캠페인</div>
                  </div>
                </div>

                {/* 채널별 통계 */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">채널별 발송</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">📱 SMS</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.sms_sent || 0).toLocaleString()}건</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_sms || 9.9}원)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">📨 LMS</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.lms_sent || 0).toLocaleString()}건</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_lms || 27}원)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">🖼️ MMS</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.mms_sent || 0).toLocaleString()}건</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_mms || 50}원)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">💬 카카오톡</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.kakao_sent || 0).toLocaleString()}건</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_kakao || 7.5}원)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
{/* 업로드 결과 모달 */}
{showUploadResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">저장 완료!</h3>
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">신규 추가</span>
                  <span className="font-bold text-blue-600">{uploadResult.insertCount.toLocaleString()}건</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">업데이트</span>
                  <span className="font-bold text-green-600">{uploadResult.duplicateCount.toLocaleString()}건</span>
                </div>
              </div>
              <button
                onClick={() => { setShowUploadResult(false); window.location.reload(); }}
                className="w-full py-3 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 플랜 초과 에러 모달 */}
      {showPlanLimitError && planLimitInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-red-50 to-orange-50 border-b">
              <div className="text-center">
                <div className="text-5xl mb-3">⚠️</div>
                <h3 className="text-xl font-bold text-gray-800">고객 DB 한도 초과</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">현재 플랜</span>
                  <span className="font-semibold text-gray-800">{planLimitInfo.planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">최대 고객 수</span>
                  <span className="font-semibold text-gray-800">{Number(planLimitInfo.maxCustomers).toLocaleString()}명</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">현재 고객 수</span>
                  <span className="font-semibold text-blue-600">{Number(planLimitInfo.currentCount).toLocaleString()}명</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">업로드 시도</span>
                  <span className="font-semibold text-orange-600">+{Number(planLimitInfo.requestedCount).toLocaleString()}명</span>
                </div>
                <div className="border-t pt-3 flex justify-between">
                  <span className="text-gray-600">추가 가능</span>
                  <span className="font-bold text-red-600">{Number(planLimitInfo.availableCount).toLocaleString()}명</span>
                </div>
              </div>
              <p className="text-sm text-gray-600 text-center mb-4">
                플랜을 업그레이드하시면 더 많은 고객을 관리할 수 있습니다.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPlanLimitError(false)}
                  className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
                >
                  닫기
                </button>
                <button
                  onClick={() => {
                    setShowPlanLimitError(false);
                    navigate('/pricing');
                  }}
                  className="flex-1 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800"
                >
                  요금제 안내
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        {/* 예약 대기 모달 */}
        {showScheduled && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b bg-red-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">⏰ 예약 대기 {scheduledCampaigns.length > 0 && `(${scheduledCampaigns.length}건)`}</h3>
                <button onClick={() => { setShowScheduled(false); setSelectedScheduled(null); }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
              </div>
              <div className="flex h-[70vh]">
                {/* 좌측: 캠페인 목록 */}
                <div className="w-[320px] border-r overflow-y-auto p-3 space-y-2">
                  {scheduledCampaigns.length > 0 ? (
                    scheduledCampaigns.map((c: any) => (
                      <div 
                        key={c.id} 
                        onClick={async () => {
                          setSelectedScheduled(c);
                          setScheduledLoading(true);
                          setScheduledSearch('');
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/campaigns/${c.id}/recipients`, {
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            const data = await res.json();
                            if (data.success) {
                              setScheduledRecipients(data.recipients || []);
                              setScheduledRecipientsTotal(data.total || 0);
                              setEditScheduleTime(c.scheduled_at ? new Date(c.scheduled_at).toISOString().slice(0, 16) : '');
                            }
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setScheduledLoading(false);
                          }
                        }}
                        className={`p-3 border rounded-lg cursor-pointer transition-all ${selectedScheduled?.id === c.id ? 'border-red-400 bg-red-50' : 'hover:border-gray-400'}`}
                      >
                        <div className="font-semibold text-gray-800 text-sm truncate">{c.campaign_name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          📱 {c.message_type} · 👥 {c.target_count?.toLocaleString()}명
                        </div>
                        <div className="text-xs text-blue-600 mt-1">
                          ⏰ {c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
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
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                const token = localStorage.getItem('token');
                                const res = await fetch(`/api/campaigns/${selectedScheduled.id}/cancel`, {
                                  method: 'POST',
                                  headers: { Authorization: `Bearer ${token}` }
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setToast({ show: true, type: 'success', message: '예약이 취소되었습니다' });
                                  setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                                  setScheduledCampaigns(prev => prev.filter(c => c.id !== selectedScheduled.id));
                                  setSelectedScheduled(null);
                                } else {
                                  setToast({ show: true, type: 'error', message: data.error || '취소 실패' });
                                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                                }
                              }}
                              disabled={selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000}
                              className={`px-3 py-1.5 rounded text-sm ${
                                selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000
                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                  : 'bg-red-500 text-white hover:bg-red-600'
                              }`}
                            >예약취소</button>
                            <button
                              onClick={() => {
                                setEditMessage(selectedScheduled?.message_template || selectedScheduled?.message_content || '');
                                setEditSubject(selectedScheduled?.message_subject || selectedScheduled?.subject || '');
                                setMessageEditModal(true);
                              }}
                              disabled={selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000}
                              className={`px-3 py-1.5 rounded text-sm ${
                                selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000
                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                  : 'bg-amber-500 text-white hover:bg-amber-600'
                              }`}
                            >문안수정</button>
                          </div>
                        </div>
                        {/* 예약 시간 수정 */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">예약시간:</span>
                          <input
                            type="datetime-local"
                            value={editScheduleTime}
                            onChange={(e) => setEditScheduleTime(e.target.value)}
                            className="border rounded px-2 py-1 text-sm"
                          />
                          <button
                            onClick={async () => {
                              if (!editScheduleTime) return;
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/campaigns/${selectedScheduled.id}/reschedule`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ scheduledAt: new Date(editScheduleTime).toISOString() })
                              });
                              const data = await res.json();
                              if (data.success) {
                                setToast({ show: true, type: 'success', message: '예약 시간이 변경되었습니다' });
                                setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                                setScheduledCampaigns(prev => prev.map(c => 
                                  c.id === selectedScheduled.id ? { ...c, scheduled_at: editScheduleTime } : c
                                ));
                                setSelectedScheduled({ ...selectedScheduled, scheduled_at: editScheduleTime });
                              } else {
                                setToast({ show: true, type: 'error', message: data.error || '변경 실패' });
                                setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                              }
                            }}
                            disabled={selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000}
                            className={`px-3 py-1 rounded text-sm ${
                              selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                            >시간변경</button>
                            {selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000 && (
                              <span className="text-xs text-amber-600 ml-2">⚠️ 15분 이내 변경 불가</span>
                            )}
                          </div>
                        </div>
                      
                      {/* 수신자 검색 */}
                      <div className="p-3 border-b flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="🔍 번호 검색"
                          value={scheduledSearch}
                          onChange={(e) => setScheduledSearch(e.target.value)}
                          className="flex-1 border rounded px-3 py-2 text-sm"
                        />
                        <span className="text-sm text-gray-500">
                          총 {scheduledRecipientsTotal.toLocaleString()}명
                          {scheduledRecipientsTotal > 1000 && ' (최대 1000명 표시)'}
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
                                .filter(r => !scheduledSearch || r.phone?.includes(scheduledSearch))
                                .map((r: any) => (
                                  <tr key={r.idx} className="border-t hover:bg-gray-50">
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
                        const res = await fetch(`/api/campaigns/${selectedScheduled.id}/recipients/${deleteConfirm.idx}`, {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        const data = await res.json();
                        if (data.success) {
                          setScheduledRecipients(prev => prev.filter(x => x.idx !== deleteConfirm.idx));
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
                      disabled={selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000}
                      className={`flex-1 py-3.5 font-medium transition-colors ${
                        selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-red-500 text-white hover:bg-red-600'
                      }`}
                    >삭제</button>
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
                    <div className="bg-gray-100 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed max-h-[400px] overflow-y-auto">
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
                    <p className="text-sm text-amber-600 mt-1">변수: %이름%, %등급%, %지역%</p>
                  </div>
                  <div className="p-4 space-y-4">
                    {(selectedScheduled?.message_type === 'LMS' || selectedScheduled?.message_type === 'MMS') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2"
                          placeholder="제목 입력"
                        />
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
                        {new TextEncoder().encode(editMessage).length} bytes
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
        )}
      </main>
    {/* 업로드 결과 모달 */}
    {showUploadResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">저장 완료!</h3>
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">신규 추가</span>
                  <span className="font-bold text-blue-600">{uploadResult.insertCount.toLocaleString()}건</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">중복 (스킵)</span>
                  <span className="font-bold text-orange-500">{uploadResult.duplicateCount.toLocaleString()}건</span>
                </div>
              </div>
              <button
                onClick={() => { setShowUploadResult(false); window.location.reload(); }}
                className="w-full py-3 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 직접발송 모달 */}
      {/* 직접 타겟 발송 모달 */}
      {showTargetSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="px-6 py-4 border-b flex justify-between items-center bg-green-50">
              <div>
                <h3 className="text-xl font-bold text-gray-800">직접 타겟 발송</h3>
                <p className="text-base text-gray-500 mt-1">추출된 <span className="font-bold text-emerald-600">{targetRecipients.length.toLocaleString()}명</span>에게 메시지를 발송합니다</p>
              </div>
              <button 
                onClick={() => { setShowTargetSend(false); setTargetRecipients([]); setTargetMessage(''); setTargetSubject(''); }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* 본문 */}
            <div className="px-6 py-5 flex gap-5">
              {/* 좌측: 메시지 작성 */}
              <div className="w-[400px]">
                {/* SMS/LMS/MMS 탭 */}
                <div className="flex mb-3 bg-gray-100 rounded-lg p-1">
                  <button 
                    onClick={() => setTargetMsgType('SMS')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${targetMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    SMS
                  </button>
                  <button 
                    onClick={() => setTargetMsgType('LMS')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${targetMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    LMS
                  </button>
                  <button 
                    onClick={() => setTargetMsgType('MMS')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${targetMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    MMS
                  </button>
                </div>

                {/* 메시지 작성 영역 */}
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS 제목 */}
                  {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={targetSubject}
                        onChange={(e) => setTargetSubject(e.target.value)}
                        placeholder="제목 (필수)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                      />
                    </div>
                  )}
                  
                  {/* 메시지 입력 */}
                  <div className="p-4">
                    <div className="relative">
                      {adTextEnabled && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                      )}
                      <textarea
                        value={targetMessage}
                        onChange={(e) => setTargetMessage(e.target.value)}
                        placeholder="전송하실 내용을 입력하세요."
                        style={adTextEnabled ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${targetMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* 무료거부 표기 */}
                    {adTextEnabled && (
                      <div className="text-sm text-orange-600 mt-1">
                        {targetMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
                      </div>
                    )}
                    {/* 특수문자/이모지 안내 */}
                    <div className="text-xs text-gray-400 mt-2">
                      ⚠️ 이모지(😀)·특수문자는 LMS 전환 또는 발송 실패 원인이 될 수 있습니다
                    </div>
                  </div>
                  
                  {/* 버튼들 + 바이트 표시 */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                      <button className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                      <button className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">문자저장</button>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      <span className={`font-bold ${(() => {
                        const optOutText = targetMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                        const fullMsg = adTextEnabled ? `(광고)${targetMessage}\n${optOutText}` : targetMessage;
                        const bytes = calculateBytes(fullMsg);
                        const max = targetMsgType === 'SMS' ? 90 : 2000;
                        return bytes > max ? 'text-red-500' : 'text-emerald-600';
                      })()}`}>
                        {(() => {
                          const optOutText = targetMsgType === 'SMS' 
                            ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                            : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                          const fullMsg = adTextEnabled ? `(광고)${targetMessage}\n${optOutText}` : targetMessage;
                          return calculateBytes(fullMsg);
                        })()}
                      </span>/{targetMsgType === 'SMS' ? 90 : 2000}byte
                    </span>
                  </div>
                  
                  {/* 회신번호 선택 */}
                  <div className="px-3 py-1.5 border-t">
                    <select 
                      value={useIndividualCallback ? '__individual__' : selectedCallback}
                      onChange={(e) => {
                        if (e.target.value === '__individual__') {
                          setUseIndividualCallback(true);
                          setSelectedCallback('');
                        } else {
                          setUseIndividualCallback(false);
                          setSelectedCallback(e.target.value);
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">회신번호 선택</option>
                      <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
                      {callbackNumbers.map((cb) => (
                        <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                      </option>
                      ))}
                    </select>
                    {useIndividualCallback && (
                      <p className="text-xs text-blue-600 mt-1">💡 각 고객의 주이용매장 회신번호로 발송됩니다</p>
                    )}
                  </div>

                  {/* 자동입력 드롭다운 */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                      <select 
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            setTargetMessage(prev => prev + e.target.value);
                          }
                        }}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">변수 선택</option>
                        <option value="%이름%">이름</option>
                        <option value="%등급%">등급</option>
                        <option value="%지역%">지역</option>
                        <option value="%구매금액%">구매금액</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* 미리보기 + 스팸필터 버튼 */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => {
                          if (!targetMessage.trim()) {
                            alert('메시지를 입력해주세요');
                            return;
                          }
                          setDirectMessage(targetMessage);
                          setDirectMsgType(targetMsgType);
                          setDirectSubject(targetSubject);
                          setShowDirectPreview(true);
                        }}
                        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        📄 미리보기
                      </button>
                      <button 
                        onClick={() => {
                          const toast = document.createElement('div');
                          toast.innerHTML = `
                            <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px 32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:9999;text-align:center;">
                              <div style="font-size:48px;margin-bottom:12px;">🚧</div>
                              <div style="font-size:16px;font-weight:bold;color:#374151;margin-bottom:8px;">준비 중인 기능입니다</div>
                              <div style="font-size:14px;color:#6B7280;">스팸필터테스트는 곧 업데이트됩니다</div>
                            </div>
                            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;" onclick="this.parentElement.remove()"></div>
                          `;
                          document.body.appendChild(toast);
                          setTimeout(() => toast.remove(), 2000);
                        }}
                        className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        🛡️ 스팸필터테스트
                      </button>
                    </div>
                  </div>
                  
                  {/* 예약/분할/광고 옵션 - 3분할 2줄 */}
                  <div className="px-3 py-2 border-t">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                      {/* 예약전송 */}
                      <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={reserveEnabled}
                            onChange={(e) => {
                              setReserveEnabled(e.target.checked);
                              if (e.target.checked) setShowReservePicker(true);
                            }}
                            className="rounded w-4 h-4" 
                          />
                          <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                        </label>
                        <div 
                          className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                          onClick={() => reserveEnabled && setShowReservePicker(true)}
                        >
                          {reserveDateTime 
                            ? new Date(reserveDateTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '예약시간 선택'}
                        </div>
                      </div>
                      {/* 분할전송 */}
                      <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded w-4 h-4"
                            checked={splitEnabled}
                            onChange={(e) => setSplitEnabled(e.target.checked)}
                          />
                          <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                        </label>
                        <div className="mt-1.5 flex items-center justify-center gap-1">
                          <input 
                            type="number" 
                            className="w-14 border rounded px-1.5 py-1 text-xs text-center" 
                            placeholder="1000"
                            value={splitCount}
                            onChange={(e) => setSplitCount(Number(e.target.value) || 1000)}
                            disabled={!splitEnabled}
                          />
                          <span className="text-xs text-gray-500">건/분</span>
                        </div>
                      </div>
                      {/* 광고/080 */}
                      <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={adTextEnabled}
                            onChange={(e) => setAdTextEnabled(e.target.checked)}
                            className="rounded w-4 h-4"
                          />
                          <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>광고표기</span>
                        </label>
                        <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 수신거부</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* 전송하기 버튼 */}
                  <div className="px-3 py-2 border-t">
                    <button 
                      onClick={async () => {
                        if (targetRecipients.length === 0) {
                          alert('수신자가 없습니다');
                          return;
                        }
                        if (!targetMessage.trim()) {
                          alert('메시지를 입력해주세요');
                          return;
                        }
                        if (!selectedCallback && !useIndividualCallback) {
                          alert('회신번호를 선택해주세요');
                          return;
                        }
                        if (useIndividualCallback && targetRecipients.some((r: any) => !r.callback)) {
                          alert('개별회신번호가 없는 고객이 있습니다.\n일반 회신번호를 선택하거나 고객 데이터를 확인해주세요.');
                          return;
                        }
                        if ((targetMsgType === 'LMS' || targetMsgType === 'MMS') && !targetSubject.trim()) {
                          alert('제목을 입력해주세요');
                          return;
                        }

                        // 바이트 계산
                        const optOutText = targetMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                        const fullMsg = adTextEnabled ? `(광고)${targetMessage}\n${optOutText}` : targetMessage;
                        const msgBytes = calculateBytes(fullMsg);

                        // SMS인데 90바이트 초과 시 예쁜 모달로 전환 안내
                        if (targetMsgType === 'SMS' && msgBytes > 90) {
                          setPendingBytes(msgBytes);
                          setShowLmsConfirm(true);
                          return;
                        }

                        // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
                        if (targetMsgType !== 'SMS') {
                          const smsOptOut = `무료거부${optOutNumber.replace(/-/g, '')}`;
                          const smsFullMsg = adTextEnabled ? `(광고)${targetMessage}\n${smsOptOut}` : targetMessage;
                          const smsBytes = calculateBytes(smsFullMsg);
                          if (smsBytes <= 90) {
                            setShowSmsConvert({show: true, from: 'target', currentBytes: msgBytes, smsBytes, count: targetRecipients.length});
                            return;
                          }
                        }

                        // 수신거부 체크
                        const token = localStorage.getItem('token');
                        const phones = targetRecipients.map((r: any) => r.phone);
                        const checkRes = await fetch('/api/unsubscribes/check', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ phones })
                        });
                        const checkData = await checkRes.json();
                        const unsubCount = checkData.unsubscribeCount || 0;

                        // 발송 확인 모달
                        setSendConfirm({
                          show: true,
                          type: reserveEnabled ? 'scheduled' : 'immediate',
                          count: targetRecipients.length - unsubCount,
                          unsubscribeCount: unsubCount,
                          dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
                          from: 'target'
                        });
                        return;
                      }}
                      disabled={targetSending}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition-colors disabled:opacity-50"
                    >
                      {targetSending ? '발송 중...' : '전송하기'}
                    </button>
                  </div>
                </div>
              </div>
              
                        
              {/* 우측: 수신자 목록 */}
              <div className="flex-1 flex flex-col">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-800">수신자 목록</span>
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                      총 {targetRecipients.length.toLocaleString()}건
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="🔍 수신번호 검색"
                      value={targetListSearch}
                      onChange={(e) => { setTargetListSearch(e.target.value); setTargetListPage(0); }}
                      className="border rounded-lg px-3 py-1.5 text-sm w-48"
                    />
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked className="rounded" />
                      중복제거
                    </label>
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked className="rounded" />
                      수신거부제거
                    </label>
                  </div>
                </div>

                {/* 테이블 */}
                <div className="flex-1 border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">수신번호</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">이름</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">등급</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">지역</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">구매금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filtered = targetListSearch 
                          ? targetRecipients.filter(r => r.phone.includes(targetListSearch))
                          : targetRecipients;
                        const pageSize = 15;
                        const start = targetListPage * pageSize;
                        return filtered.slice(start, start + pageSize).map((r, idx) => (
                          <tr key={idx} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-2 font-mono">{r.phone}</td>
                            <td className="px-4 py-2">{r.name || '-'}</td>
                            <td className="px-4 py-2">{r.grade || '-'}</td>
                            <td className="px-4 py-2">{r.region || '-'}</td>
                            <td className="px-4 py-2">{r.amount || '-'}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* 페이징 */}
                <div className="mt-3 flex justify-center items-center gap-2">
                  {(() => {
                    const filtered = targetListSearch 
                      ? targetRecipients.filter(r => r.phone.includes(targetListSearch))
                      : targetRecipients;
                    const totalPages = Math.ceil(filtered.length / 15);
                    if (totalPages <= 1) return null;
                    
                    return (
                      <>
                        <button 
                          onClick={() => setTargetListPage(p => Math.max(0, p - 1))}
                          disabled={targetListPage === 0}
                          className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                        >
                          이전
                        </button>
                        <span className="text-sm text-gray-600">
                          {targetListPage + 1} / {totalPages} 페이지
                        </span>
                        <button 
                          onClick={() => setTargetListPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={targetListPage >= totalPages - 1}
                          className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                        >
                          다음
                        </button>
                      </>
                    );
                  })()}
                </div>

                {/* 하단 버튼 */}
                <div className="mt-3 flex justify-between items-center">
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">중복제거</button>
                    <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">선택삭제</button>
                    <button 
                      onClick={() => setTargetRecipients([])}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                    >
                      전체삭제
                    </button>
                  </div>
                  <button 
                    onClick={() => { setShowTargetSend(false); setShowDirectTargeting(true); }}
                    className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    🔄 타겟 재설정
                  </button>
                </div>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* 예약전송 달력 모달 (공용) */}
      {showReservePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[360px] overflow-hidden">
            <div className="bg-blue-50 px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-blue-700">📅 예약 시간 설정</h3>
            </div>
            <div className="p-5">
              {/* 빠른 선택 */}
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">빠른 선택</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '1시간 후', hours: 1 },
                    { label: '3시간 후', hours: 3 },
                    { label: '내일 오전 9시', tomorrow: 9 },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => {
                        const d = new Date();
                        if (opt.hours) {
                          d.setHours(d.getHours() + opt.hours);
                        } else if (opt.tomorrow) {
                          d.setDate(d.getDate() + 1);
                          d.setHours(opt.tomorrow, 0, 0, 0);
                        }
                        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                        setReserveDateTime(local);
                      }}
                      className="py-2 px-2 text-xs border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* 직접 선택 */}
              <div>
                <div className="flex gap-4">
                  {/* 날짜 */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2">날짜</div>
                    <input
                      type="date"
                      value={reserveDateTime?.split('T')[0] || ''}
                      onChange={(e) => {
                        const time = reserveDateTime?.split('T')[1] || '09:00';
                        setReserveDateTime(`${e.target.value}T${time}`);
                      }}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                  {/* 시간 */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2">시간</div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={parseInt(reserveDateTime?.split('T')[1]?.split(':')[0] || '9')}
                        onChange={(e) => {
                          let hour = Math.min(23, Math.max(0, parseInt(e.target.value) || 0));
                          const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                          const minute = reserveDateTime?.split('T')[1]?.split(':')[1] || '00';
                          setReserveDateTime(`${date}T${hour.toString().padStart(2, '0')}:${minute}`);
                        }}
                        className="w-14 border-2 border-gray-200 rounded-lg px-2 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none"
                      />
                      <span className="text-lg font-bold text-gray-400">:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={parseInt(reserveDateTime?.split('T')[1]?.split(':')[1] || '0')}
                        onChange={(e) => {
                          let minute = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                          const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                          const hour = reserveDateTime?.split('T')[1]?.split(':')[0] || '09';
                          setReserveDateTime(`${date}T${hour}:${minute.toString().padStart(2, '0')}`);
                        }}
                        className="w-14 border-2 border-gray-200 rounded-lg px-2 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* 선택된 시간 표시 */}
              {reserveDateTime && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
                  <span className="text-sm text-gray-600">예약 시간: </span>
                  <span className="text-sm font-bold text-blue-700">
                    {new Date(reserveDateTime).toLocaleString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t flex gap-2">
              <button
                onClick={() => {
                  setShowReservePicker(false);
                  setReserveEnabled(false);
                  setReserveDateTime('');
                }}
                className="flex-1 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!reserveDateTime) {
                    alert('예약 시간을 선택해주세요');
                    return;
                  }
                  setShowReservePicker(false);
                }}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {showDirectSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
            {/* 본문 */}
            <div className="px-6 py-5 flex gap-5">
              {/* 좌측: 메시지 작성 */}
              <div className="w-[400px]">
                {/* SMS/LMS/MMS 탭 */}
                <div className="flex mb-3 bg-gray-100 rounded-lg p-1">
                  <button 
                    onClick={() => setDirectMsgType('SMS')}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${directMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    SMS
                  </button>
                  <button 
                    onClick={() => setDirectMsgType('LMS')}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${directMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    LMS
                  </button>
                  <button 
                    onClick={() => setDirectMsgType('MMS')}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${directMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    MMS
                  </button>
                </div>

                {/* 메시지 작성 영역 */}
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS 제목 */}
                  {(directMsgType === 'LMS' || directMsgType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={directSubject}
                        onChange={(e) => setDirectSubject(e.target.value)}
                        placeholder="제목 (필수)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                      />
                    </div>
                  )}
                  
                  {/* 메시지 입력 */}
                  <div className="p-4">
                    <div className="relative">
                      {adTextEnabled && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                      )}
                      <textarea
                        value={directMessage}
                        onChange={(e) => setDirectMessage(e.target.value)}
                        placeholder="전송하실 내용을 입력하세요."
                        style={adTextEnabled ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${directMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* 무료거부 표기 */}
                    {adTextEnabled && (
                      <div className="text-sm text-orange-600 mt-1">
                        {directMsgType === 'SMS' 
                          ? `무료거부${optOutNumber.replace(/-/g, '')}` 
                          : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
                      </div>
                    )}
                    {/* 특수문자/이모지 안내 */}
                    <div className="text-xs text-gray-400 mt-2">
                      ⚠️ 이모지(😀)·특수문자는 LMS 전환 또는 발송 실패 원인이 될 수 있습니다
                    </div>
                    
                    {/* MMS 이미지 미리보기 */}
                    {directMsgType === 'MMS' && mmsImages.length > 0 && (
                      <div className="flex gap-2 mt-2 pt-2 border-t">
                        {mmsImages.map((img, idx) => (
                          <div key={idx} className="relative w-16 h-16">
                            <img src={URL.createObjectURL(img)} alt="" className="w-full h-full object-cover rounded" />
                            <button 
                              onClick={() => setMmsImages(mmsImages.filter((_, i) => i !== idx))}
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* 버튼들 + 바이트 표시 */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                      <button className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                      <button className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">문자저장</button>
                      {directMsgType === 'MMS' && (
                        <label className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100 cursor-pointer">
                          이미지
                          <input 
                            type="file" 
                            accept="image/*" 
                            multiple 
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.target.files || []);
                              if (mmsImages.length + files.length > 3) {
                                alert('이미지는 최대 3개까지 첨부 가능합니다.');
                                return;
                              }
                              setMmsImages([...mmsImages, ...files]);
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      <span className={`font-bold ${messageBytes > maxBytes ? 'text-red-500' : 'text-emerald-600'}`}>{messageBytes}</span>/{maxBytes}byte
                    </span>
                  </div>
                  
                  {/* 회신번호 선택 */}
                  <div className="px-3 py-1.5 border-t">
                    <select 
                      value={useIndividualCallback ? '__individual__' : selectedCallback}
                      onChange={(e) => {
                        if (e.target.value === '__individual__') {
                          setUseIndividualCallback(true);
                          setSelectedCallback('');
                        } else {
                          setUseIndividualCallback(false);
                          setSelectedCallback(e.target.value);
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">회신번호 선택</option>
                      <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
                      {callbackNumbers.map((cb) => (
                        <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                      </option>
                      ))}
                    </select>
                    {useIndividualCallback && (
                      <p className="text-xs text-blue-600 mt-1">💡 각 고객의 주이용매장 회신번호로 발송됩니다</p>
                    )}
                  </div>

                  {/* 자동입력 버튼 */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                      <div className="flex gap-2 flex-1">
                        <button onClick={() => setDirectMessage(prev => prev + '%이름%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">이름</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%기타1%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">기타1</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%기타2%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">기타2</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%기타3%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">기타3</button>
                      </div>
                    </div>
                  </div>
                  
                  {/* 미리보기 + 스팸필터 버튼 */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => {
                          if (!directMessage.trim()) {
                            alert('메시지를 입력해주세요');
                            return;
                          }
                          setShowDirectPreview(true);
                        }}
                        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        📄 미리보기
                      </button>
                      <button 
                        onClick={() => {
                          const toast = document.createElement('div');
                          toast.innerHTML = `
                            <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px 32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:9999;text-align:center;">
                              <div style="font-size:48px;margin-bottom:12px;">🚧</div>
                              <div style="font-size:16px;font-weight:bold;color:#374151;margin-bottom:8px;">준비 중인 기능입니다</div>
                              <div style="font-size:14px;color:#6B7280;">스팸필터테스트는 곧 업데이트됩니다</div>
                            </div>
                            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;" onclick="this.parentElement.remove()"></div>
                          `;
                          document.body.appendChild(toast);
                          setTimeout(() => toast.remove(), 2000);
                        }}
                        className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        🛡️ 스팸필터테스트
                      </button>
                    </div>
                  </div>
                  
                  {/* 예약/분할/광고 옵션 - 3분할 2줄 */}
                  <div className="px-3 py-2 border-t">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {/* 예약전송 */}
                      <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={reserveEnabled}
                            onChange={(e) => {
                              setReserveEnabled(e.target.checked);
                              if (e.target.checked) setShowReservePicker(true);
                            }}
                            className="rounded w-4 h-4" 
                          />
                          <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                        </label>
                        <div 
                          className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                          onClick={() => reserveEnabled && setShowReservePicker(true)}
                        >
                          {reserveDateTime 
                            ? new Date(reserveDateTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '예약시간 선택'}
                        </div>
                      </div>
                      {/* 분할전송 */}
                      <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded w-4 h-4"
                            checked={splitEnabled}
                            onChange={(e) => setSplitEnabled(e.target.checked)}
                          />
                          <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                        </label>
                        <div className="mt-1.5 flex items-center justify-center gap-1">
                          <input 
                            type="number" 
                            className="w-14 border rounded px-1.5 py-1 text-xs text-center" 
                            placeholder="1000"
                            value={splitCount}
                            onChange={(e) => setSplitCount(Number(e.target.value) || 1000)}
                            disabled={!splitEnabled}
                          />
                          <span className="text-xs text-gray-500">건/분</span>
                        </div>
                      </div>
                      {/* 광고/080 */}
                      <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={adTextEnabled}
                            onChange={(e) => setAdTextEnabled(e.target.checked)}
                            className="rounded w-4 h-4"
                          />
                          <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>광고표기</span>
                        </label>
                        <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 수신거부</div>
                      </div>
                      </div>
                  </div>
                  
                  {/* 전송하기 버튼 */}
                  <div className="px-3 py-2 border-t">
                    <button 
                      onClick={async () => {
                        // 유효성 검사
                        if (directRecipients.length === 0) {
                          alert('수신자를 추가해주세요');
                          return;
                        }
                        if (!directMessage.trim()) {
                          alert('메시지를 입력해주세요');
                          return;
                        }
                        if (!selectedCallback && !useIndividualCallback) {
                          alert('회신번호를 선택해주세요');
                          return;
                        }
                        if (useIndividualCallback && directRecipients.some((r: any) => !r.callback)) {
                          alert('개별회신번호가 없는 수신자가 있습니다.\n일반 회신번호를 선택해주세요.');
                          return;
                        }
                        if ((directMsgType === 'LMS' || directMsgType === 'MMS') && !directSubject.trim()) {
                          alert('제목을 입력해주세요');
                          return;
                        }

                        // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
                        if (directMsgType !== 'SMS') {
                          const smsOptOut = `무료거부${optOutNumber.replace(/-/g, '')}`;
                          const smsFullMsg = adTextEnabled ? `(광고)${directMessage}\n${smsOptOut}` : directMessage;
                          const smsBytes = calculateBytes(smsFullMsg);
                          if (smsBytes <= 90) {
                            setShowSmsConvert({show: true, from: 'direct', currentBytes: messageBytes, smsBytes, count: directRecipients.length});
                            return;
                          }
                        }

                        // 수신거부 체크
                        const token = localStorage.getItem('token');
                        const phones = directRecipients.map((r: any) => r.phone);
                        const checkRes = await fetch('/api/unsubscribes/check', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ phones })
                        });
                        const checkData = await checkRes.json();
                        const unsubCount = checkData.unsubscribeCount || 0;

                        setSendConfirm({
                          show: true,
                          type: reserveEnabled ? 'scheduled' : 'immediate',
                          count: directRecipients.length - unsubCount,
                          unsubscribeCount: unsubCount,
                          dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
                          from: 'direct'
                        });
                        return;
                      }}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition-colors"
                    >
                      전송하기
                    </button>
                  </div>
                </div>
              </div>
              
              {/* 우측: 수신자 목록 */}
              <div className="flex-1 flex flex-col">
                {/* 입력 방식 탭 + 체크박스 */}
                <div className="flex items-center gap-3 mb-4">
                  <button 
                    onClick={() => setShowDirectInput(true)}
                    className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'direct' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
                  >✏️ 직접입력</button>
                  <label 
                    className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium cursor-pointer hover:bg-gray-50 ${directInputMode === 'file' ? 'bg-amber-50 border-amber-400 text-amber-700' : ''} ${directFileLoading ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {directFileLoading ? '⏳ 파일 분석중...' : '📁 파일등록'}
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        setDirectFileLoading(true);
                        const formData = new FormData();
                        formData.append('file', file);
                        
                        try {
                          const res = await fetch('/api/upload/parse', {
                            method: 'POST',
                            body: formData
                          });
                          const data = await res.json();
                          if (data.success) {
                            setDirectFileHeaders(data.headers);
                            setDirectFilePreview(data.preview);
                            setDirectFileData(data.allData || data.preview);
                            setDirectInputMode('file');
                            setDirectShowMapping(true);
                            setDirectColumnMapping({});
                          } else {
                            alert(data.error || '파일 파싱 실패');
                          }
                        } catch (err) {
                          alert('파일 업로드 중 오류가 발생했습니다.');
                        } finally {
                          setDirectFileLoading(false);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                     onClick={async () => {
                       const token = localStorage.getItem('token');
                       const res = await fetch('/api/address-books/groups', {
                         headers: { Authorization: `Bearer ${token}` }
                       });
                       const data = await res.json();
                       if (data.success) {
                         setAddressGroups(data.groups || []);
                       }
                       setShowAddressBook(true);
                     }}
                     className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'address' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
                   >📒 주소록</button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer ml-2">
                    <input type="checkbox" defaultChecked className="rounded w-4 h-4" />
                    <span className="font-medium">중복제거</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded w-4 h-4" />
                    <span className="font-medium">수신거부제거</span>
                  </label>
                  <div className="flex-1"></div>
                  <button 
                    onClick={() => setShowDirectSend(false)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <span>✕</span> 창닫기
                  </button>
                </div>
                
                {/* 수신자 테이블 */}
                <div className="border-2 rounded-xl overflow-hidden flex-1 flex flex-col">
                  <div className="bg-gray-50 px-4 py-3 flex justify-between items-center border-b">
                  <span className="text-sm font-medium">
                      총 <span className="text-emerald-600 font-bold text-lg">{directRecipients.length.toLocaleString()}</span> 건
                      {directRecipients.length > 10 && !directSearchQuery && (
                        <span className="text-gray-400 text-xs ml-2">(상위 10개 표시)</span>
                      )}
                    </span>
                    <input
                      type="text"
                      placeholder="🔍 수신번호 검색"
                      value={directSearchQuery}
                      onChange={(e) => setDirectSearchQuery(e.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm w-52"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full">
                    <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 w-10">
                            <input 
                              type="checkbox" 
                              className="rounded w-4 h-4"
                              checked={directRecipients.length > 0 && selectedRecipients.size === directRecipients.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedRecipients(new Set(directRecipients.map((_, i) => i)));
                                } else {
                                  setSelectedRecipients(new Set());
                                }
                              }}
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">수신번호</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">이름</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">기타1</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">기타2</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">기타3</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {directRecipients.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-24 text-center text-gray-400">
                              <div className="text-4xl mb-2">📋</div>
                              <div className="text-sm">파일을 업로드하거나 직접 입력해주세요</div>
                            </td>
                          </tr>
                        ) : (
                          directRecipients
                            .map((r, idx) => ({ ...r, originalIdx: idx }))
                            .filter(r => !directSearchQuery || String(r.phone || '').includes(directSearchQuery))
                            .slice(0, directSearchQuery ? 100 : 10)
                            .map((r) => (
                            <tr key={r.originalIdx} className="hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <input 
                                  type="checkbox" 
                                  className="rounded w-4 h-4"
                                  checked={selectedRecipients.has(r.originalIdx)}
                                  onChange={(e) => {
                                    const newSet = new Set(selectedRecipients);
                                    if (e.target.checked) newSet.add(r.originalIdx);
                                    else newSet.delete(r.originalIdx);
                                    setSelectedRecipients(newSet);
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3 text-sm">{r.phone}</td>
                              <td className="px-4 py-3 text-sm">{r.name || '-'}</td>
                              <td className="px-4 py-3 text-sm">{r.extra1 || '-'}</td>
                              <td className="px-4 py-3 text-sm">{r.extra2 || '-'}</td>
                              <td className="px-4 py-3 text-sm">{r.extra3 || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                {/* 하단 버튼 - 전송하기와 높이 맞춤 */}
                <div className="flex gap-3 mt-4">
                  <button 
                    onClick={async () => {
                      const seen = new Set();
                      const unique = directRecipients.filter(r => {
                        if (seen.has(r.phone)) return false;
                        seen.add(r.phone);
                        return true;
                      });
                      const removed = directRecipients.length - unique.length;
                      setDirectRecipients(unique);
                      setSelectedRecipients(new Set());
                      if (removed > 0) alert(`${removed}건 중복 제거됨`);
                      else alert('중복 없음');
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >중복제거</button>
                  <button 
                    onClick={() => {
                      if (selectedRecipients.size === 0) {
                        alert('선택된 항목이 없습니다');
                        return;
                      }
                      const newList = directRecipients.filter((_, idx) => !selectedRecipients.has(idx));
                      setDirectRecipients(newList);
                      setSelectedRecipients(new Set());
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >선택삭제</button>
                  <button 
                    onClick={() => {
                      if (directRecipients.length === 0) return;
                      if (confirm('전체 삭제하시겠습니까?')) {
                        setDirectRecipients([]);
                        setSelectedRecipients(new Set());
                      }
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >전체삭제</button>
                  <div className="flex-1"></div>
                  <button 
                    onClick={() => {
                      setDirectRecipients([]);
                      setDirectMessage('');
                      setDirectSubject('');
                      setMmsImages([]);
                      setSelectedRecipients(new Set());
                      setSelectedCallback('');
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >🔄 초기화</button>
                </div>
              </div>
            </div>
            {/* 파일 매핑 모달 */}
            {directShowMapping && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[550px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">📁 컬럼 매핑</h3>
                    <button onClick={() => setDirectShowMapping(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  
                  <div className="p-6">
                    {/* 매핑 안내 */}
                    <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
                      💡 아래 필수 항목에 <strong>엑셀의 어떤 컬럼</strong>을 매핑할지 선택해주세요.
                    </div>
                    
                    {/* 헤더 */}
                    <div className="flex items-center gap-4 mb-3 px-4">
                      <span className="w-28 text-xs font-bold text-gray-500">필수 항목</span>
                      <span className="w-8 text-center text-xs text-gray-400">→</span>
                      <span className="flex-1 text-xs font-bold text-gray-500">엑셀 컬럼 선택</span>
                    </div>
                    
                    {/* 매핑 선택 - 5개만 */}
                    <div className="space-y-3">
                      {/* 수신번호 (필수) */}
                      <div className="flex items-center gap-4 p-4 bg-red-50 rounded-xl border-2 border-red-200">
                        <span className="w-28 text-sm font-bold text-red-700">📱 수신번호 *</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border-2 border-red-300 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
                          value={directColumnMapping.phone || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, phone: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 이름 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">👤 이름</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.name || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, name: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 기타1 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">1️⃣ 기타1</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra1 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra1: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 기타2 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">2️⃣ 기타2</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra2 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra2: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 기타3 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">3️⃣ 기타3</span>
                        <span className="w-8 text-center text-gray-400">→</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra3 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra3: e.target.value})}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                    <span className="text-sm text-gray-600">📊 총 <strong>{directFileData.length.toLocaleString()}</strong>건</span>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setDirectShowMapping(false)}
                        className="px-6 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
                      >취소</button>
                      <button 
                        onClick={async () => {
                          if (!directColumnMapping.phone) {
                            alert('수신번호는 필수입니다.');
                            return;
                          }
                          
                          setDirectMappingLoading(true);
                          setDirectLoadingProgress(0);
                          
                          // 비동기로 처리하여 UI 업데이트 허용
                          await new Promise(resolve => setTimeout(resolve, 10));
                          
                          const total = directFileData.length;
                          const chunkSize = 5000;
                          const mapped: any[] = [];
                          
                          for (let i = 0; i < total; i += chunkSize) {
                            const chunk = directFileData.slice(i, i + chunkSize);
                            const processed = chunk.map(row => {
                              let phone = String(row[directColumnMapping.phone] || '').replace(/-/g, '').trim();
                              if (phone.length === 10 && phone.startsWith('1')) {
                                phone = '0' + phone;
                              }
                              return {
                                phone,
                                name: row[directColumnMapping.name] || '',
                                extra1: row[directColumnMapping.extra1] || '',
                                extra2: row[directColumnMapping.extra2] || '',
                                extra3: row[directColumnMapping.extra3] || ''
                              };
                            }).filter(r => r.phone && r.phone.length >= 10);
                            
                            mapped.push(...processed);
                            setDirectLoadingProgress(Math.min(100, Math.round((i + chunkSize) / total * 100)));
                            await new Promise(resolve => setTimeout(resolve, 10));
                          }
                          
                          setDirectRecipients(mapped);
                          setDirectMappingLoading(false);
                          setDirectShowMapping(false);
                        }}
                        disabled={!directColumnMapping.phone || directMappingLoading}
                        className="px-8 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {directMappingLoading ? `처리중... ${directLoadingProgress}%` : '등록하기'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* 직접입력 모달 */}
            {showDirectInput && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">✏️ 직접입력</h3>
                    <button onClick={() => setShowDirectInput(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                  </div>
                  
                  <div className="p-6">
                    <div className="mb-3 text-sm text-gray-600">
                      전화번호를 한 줄에 하나씩 입력해주세요.
                    </div>
                    <textarea
                      value={directInputText}
                      onChange={(e) => setDirectInputText(e.target.value)}
                      placeholder="01012345678&#10;01087654321&#10;01011112222"
                      className="w-full h-[250px] border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  
                  <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button 
                      onClick={() => setShowDirectInput(false)}
                      className="px-6 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
                    >취소</button>
                    <button 
                      onClick={() => {
                        const lines = directInputText.split('\n').map(l => l.trim()).filter(l => l);
                        const newRecipients = lines.map(phone => ({
                          phone: phone.replace(/-/g, ''),
                          name: '',
                          extra1: '',
                          extra2: '',
                          extra3: ''
                        }));
                        setDirectRecipients([...directRecipients, ...newRecipients]);
                        setDirectInputText('');
                        setShowDirectInput(false);
                        setDirectInputMode('direct');
                      }}
                      className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
                    >
                      등록
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            </div>
        </div>
      )}
      {/* 주소록 모달 */}
      {showAddressBook && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[750px] max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b bg-amber-50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-amber-700">📒 주소록</h3>
              <button onClick={() => setShowAddressBook(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
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
                          const res = await fetch('/api/upload/parse', { method: 'POST', body: formData });
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
                                  setShowAddressBook(false);
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
                onClick={() => setShowAddressBook(false)}
                className="w-full py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
              >닫기</button>
            </div>
          </div>
        </div>
      )}
      {/* LMS 전환 확인 모달 */}
      {showLmsConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-xl shadow-2xl w-[400px] overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-amber-50 to-orange-50 border-b">
              <div className="text-center">
                <div className="text-5xl mb-3">📝</div>
                <h3 className="text-lg font-bold text-gray-800">메시지 길이 초과</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="text-center mb-4">
                <div className="text-3xl font-bold text-red-500 mb-1">{pendingBytes} <span className="text-lg text-gray-400">/ 90 byte</span></div>
                <div className="text-gray-600">SMS 제한을 초과했습니다</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <div className="text-sm text-blue-800">
                  <div className="font-medium mb-1">💡 LMS로 전환하시겠습니까?</div>
                  <div className="text-blue-600">LMS는 최대 2,000byte까지 발송 가능합니다</div>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowLmsConfirm(false);
                  }}
                  className="flex-1 py-3 border-2 border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
                >SMS 유지 (수정)</button>
                <button
                  onClick={() => {
                    if (showTargetSend) {
                      setTargetMsgType('LMS');
                    } else {
                      setDirectMsgType('LMS');
                    }
                    setShowLmsConfirm(false);
                  }}
                  className="flex-1 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800"
                  >LMS 전환</button>
                  </div>
                </div>
              </div>
            </div>
          )}
    
          {/* SMS 전환 비용절감 모달 */}
          {showSmsConvert.show && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
              <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
                <div className="p-6 bg-gradient-to-r from-blue-50 to-emerald-50 border-b">
                  <div className="text-center">
                    <div className="text-5xl mb-3">💰</div>
                    <h3 className="text-lg font-bold text-gray-800">비용 절감 안내</h3>
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-center mb-4">
                    <div className="text-sm text-gray-600 mb-2">SMS로 발송하면 비용이 절감됩니다!</div>
                    <div className="flex items-center justify-center gap-3 text-lg">
                      <span className="text-gray-500">{showSmsConvert.currentBytes}byte</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-bold text-emerald-600">{showSmsConvert.smsBytes}byte</span>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="text-sm text-gray-600 mb-3 text-center">예상 비용 비교 ({showSmsConvert.count.toLocaleString()}건 기준)</div>
                    <div className="flex justify-between items-center">
                      <div className="text-center flex-1">
                        <div className="text-xs text-gray-500 mb-1">LMS (27원/건)</div>
                        <div className="text-lg font-bold text-gray-700">{(showSmsConvert.count * 27).toLocaleString()}원</div>
                      </div>
                      <div className="text-2xl text-gray-300 px-4">→</div>
                      <div className="text-center flex-1">
                        <div className="text-xs text-gray-500 mb-1">SMS (10원/건)</div>
                        <div className="text-lg font-bold text-emerald-600">{(showSmsConvert.count * 10).toLocaleString()}원</div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-200 text-center">
                      <span className="text-sm text-gray-600">절감 금액: </span>
                      <span className="text-lg font-bold text-red-500">{((showSmsConvert.count * 27) - (showSmsConvert.count * 10)).toLocaleString()}원</span>
                    </div>
                  </div>
    
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0})}
                      className="flex-1 py-3 border-2 border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
                    >LMS 유지</button>
                    <button
                      onClick={() => {
                        if (showSmsConvert.from === 'target') {
                          setTargetMsgType('SMS');
                        } else {
                          setDirectMsgType('SMS');
                        }
                        setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0});
                      }}
                      className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
                      >SMS 전환</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
        
              {/* 예약전송 날짜/시간 선택 모달 (공용) */}
              {showReservePicker && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
                  <div className="bg-white rounded-xl shadow-2xl w-[460px] overflow-hidden">
                    <div className="bg-blue-50 px-6 py-5 border-b">
                      <h3 className="text-xl font-bold text-blue-700">📅 예약 시간 설정</h3>
                    </div>
                    <div className="p-6">
                      {/* 빠른 선택 */}
                      <div className="mb-5">
                        <div className="text-sm text-gray-500 mb-2">빠른 선택</div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: '1시간 후', hours: 1 },
                            { label: '3시간 후', hours: 3 },
                            { label: '내일 오전 9시', tomorrow: 9 },
                          ].map((opt) => (
                            <button
                              key={opt.label}
                              onClick={() => {
                                const d = new Date();
                                if (opt.hours) {
                                  d.setHours(d.getHours() + opt.hours);
                                } else if (opt.tomorrow) {
                                  d.setDate(d.getDate() + 1);
                                  d.setHours(opt.tomorrow, 0, 0, 0);
                                }
                                const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                                setReserveDateTime(local);
                              }}
                              className="py-2 px-2 text-xs border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* 직접 선택 */}
                      <div>
                        <div className="flex gap-4">
                          {/* 날짜 */}
                          <div className="flex-1">
                            <div className="text-xs text-gray-500 mb-2">날짜</div>
                            <input
                              type="date"
                              value={reserveDateTime?.split('T')[0] || ''}
                              onChange={(e) => {
                                const time = reserveDateTime?.split('T')[1] || '09:00';
                                setReserveDateTime(`${e.target.value}T${time}`);
                              }}
                              min={new Date().toISOString().split('T')[0]}
                              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                            />
                          </div>
                          {/* 시간 */}
                          <div className="flex-1">
                            <div className="text-xs text-gray-500 mb-2">시간</div>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="12"
                                value={(() => {
                                  const h = parseInt(reserveDateTime?.split('T')[1]?.split(':')[0] || '9');
                                  if (h === 0) return 12;
                                  if (h > 12) return h - 12;
                                  return h;
                                })()}
                                onChange={(e) => {
                                  let hour12 = Math.min(12, Math.max(1, parseInt(e.target.value) || 1));
                                  const currentHour = parseInt(reserveDateTime?.split('T')[1]?.split(':')[0] || '9');
                                  const isPM = currentHour >= 12;
                                  let hour24 = isPM ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
                                  const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                                  const minute = reserveDateTime?.split('T')[1]?.split(':')[1] || '00';
                                  setReserveDateTime(`${date}T${hour24.toString().padStart(2, '0')}:${minute}`);
                                }}
                                className="w-12 border-2 border-gray-200 rounded-lg px-1 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none"
                              />
                              <span className="text-lg font-bold text-gray-400">:</span>
                              <input
                                type="number"
                                min="0"
                                max="59"
                                value={parseInt(reserveDateTime?.split('T')[1]?.split(':')[1] || '0')}
                                onChange={(e) => {
                                  let minute = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                  const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                                  const hour = reserveDateTime?.split('T')[1]?.split(':')[0] || '09';
                                  setReserveDateTime(`${date}T${hour}:${minute.toString().padStart(2, '0')}`);
                                }}
                                className="w-12 border-2 border-gray-200 rounded-lg px-1 py-2.5 text-sm text-center focus:border-blue-400 focus:outline-none"
                              />
                              <select
                                value={parseInt(reserveDateTime?.split('T')[1]?.split(':')[0] || '9') >= 12 ? 'PM' : 'AM'}
                                onChange={(e) => {
                                  const currentHour = parseInt(reserveDateTime?.split('T')[1]?.split(':')[0] || '9');
                                  const hour12 = currentHour === 0 ? 12 : (currentHour > 12 ? currentHour - 12 : currentHour);
                                  const isPM = e.target.value === 'PM';
                                  let hour24 = isPM ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
                                  const date = reserveDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
                                  const minute = reserveDateTime?.split('T')[1]?.split(':')[1] || '00';
                                  setReserveDateTime(`${date}T${hour24.toString().padStart(2, '0')}:${minute}`);
                                }}
                                className="border-2 border-gray-200 rounded-lg px-2 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                              >
                                <option value="AM">오전</option>
                                <option value="PM">오후</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* 선택된 시간 표시 */}
                      {reserveDateTime && (
                        <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
                          <span className="text-sm text-gray-600">예약 시간: </span>
                          <span className="text-sm font-bold text-blue-700">
                            {new Date(reserveDateTime).toLocaleString('ko-KR', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex border-t">
                      <button
                        onClick={() => {
                          setReserveEnabled(false);
                          setReserveDateTime('');
                          setShowReservePicker(false);
                        }}
                        className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => {
                          if (!reserveDateTime) {
                            const toast = document.createElement('div');
                            toast.innerHTML = `
                              <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;" onclick="this.parentElement.remove()">
                                <div style="background:white;padding:0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:380px;overflow:hidden;" onclick="event.stopPropagation()">
                                  <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);padding:24px;text-align:center;">
                                    <div style="font-size:48px;margin-bottom:8px;">⏰</div>
                                    <div style="font-size:18px;font-weight:bold;color:#92400e;">시간을 선택해주세요</div>
                                  </div>
                                  <div style="padding:24px;text-align:center;">
                                    <div style="color:#6b7280;margin-bottom:20px;">예약 시간을 먼저 선택해주세요.</div>
                                    <button onclick="this.closest('[style*=position]').parentElement.remove()" style="width:100%;padding:12px;background:#f59e0b;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer;">확인</button>
                                  </div>
                                </div>
                              </div>
                            `;
                            document.body.appendChild(toast);
                            return;
                          }
                          const reserveTime = new Date(reserveDateTime);
                          const now = new Date();
                          if (reserveTime <= now) {
                            const toast = document.createElement('div');
                            toast.innerHTML = `
                              <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;" onclick="this.parentElement.remove()">
                                <div style="background:white;padding:0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:400px;overflow:hidden;" onclick="event.stopPropagation()">
                                  <div style="background:linear-gradient(135deg,#fee2e2,#fecaca);padding:24px;text-align:center;">
                                    <div style="font-size:48px;margin-bottom:8px;">🚫</div>
                                    <div style="font-size:18px;font-weight:bold;color:#dc2626;">예약 불가</div>
                                  </div>
                                  <div style="padding:24px;text-align:center;">
                                    <div style="color:#374151;font-weight:500;margin-bottom:8px;">현재 시간보다 이전으로는 예약할 수 없습니다.</div>
                                    <div style="color:#6b7280;margin-bottom:20px;">예약 시간을 다시 선택해주세요.</div>
                                    <button onclick="this.closest('[style*=position]').parentElement.remove()" style="width:100%;padding:12px;background:#dc2626;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer;">확인</button>
                                  </div>
                                </div>
                              </div>
                            `;
                            document.body.appendChild(toast);
                            return;
                          }
                          setShowReservePicker(false);
                        }}
                        className="flex-1 py-3 bg-blue-500 text-white hover:bg-blue-600 font-medium"
                      >
                        확인
                      </button>
                    </div>
                  </div>
                </div>
              )}
        
              {/* 미리보기 모달 (공용) */}
      {showDirectPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
            <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-lg">📄 메시지 미리보기</h3>
              <button onClick={() => setShowDirectPreview(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
            </div>
            
            <div className="p-6 flex justify-center">
              {/* 모던 폰 프레임 */}
              <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-200">
                <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col w-[280px]" style={{ height: '420px' }}>
                  {/* 상단 - 회신번호 */}
                  <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                    <span className="text-[11px] text-gray-400 font-medium">문자메시지</span>
                    <span className="text-[11px] font-bold text-emerald-600">{formatPhoneNumber(selectedCallback) || '회신번호'}</span>
                  </div>
                  {/* LMS/MMS 제목 */}
                  {(directMsgType === 'LMS' || directMsgType === 'MMS') && directSubject && (
                    <div className="px-4 py-2 bg-orange-50 border-b border-orange-200">
                      <span className="text-sm font-bold text-orange-700">{directSubject}</span>
                    </div>
                  )}
                  {/* 메시지 영역 - 스크롤 */}
                  <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-xs">📱</div>
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[13px] leading-[1.7] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                        {getFullMessage(directMessage)
                          .replace(/%이름%/g, (showTargetSend ? targetRecipients[0]?.name : directRecipients[0]?.name) || '홍길동')
                          .replace(/%등급%/g, (showTargetSend ? targetRecipients[0]?.grade : '') || 'VIP')
                          .replace(/%지역%/g, (showTargetSend ? targetRecipients[0]?.region : '') || '서울')
                          .replace(/%구매금액%/g, (showTargetSend ? targetRecipients[0]?.amount : '') || '100,000원')
                          .replace(/%기타1%/g, directRecipients[0]?.extra1 || '기타1')
                          .replace(/%기타2%/g, directRecipients[0]?.extra2 || '기타2')
                          .replace(/%기타3%/g, directRecipients[0]?.extra3 || '기타3')
                        }
                      </div>
                    </div>
                  </div>
                  {/* 하단 바이트 */}
                  <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                    <span className="text-[10px] text-gray-400">{messageBytes} / {directMsgType === 'SMS' ? 90 : 2000} bytes · {directMsgType}</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* 치환 안내 */}
            {(directMessage.includes('%이름%') || directMessage.includes('%기타') || directMessage.includes('%등급%') || directMessage.includes('%지역%') || directMessage.includes('%구매금액%')) && (
              <div className="mx-6 mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 text-center">
                💡 자동입력 변수는 첫 번째 수신자 정보로 표시됩니다
                {(!directRecipients[0] && !targetRecipients[0]) && ' (샘플 데이터)'}
              </div>
            )}
            
            <div className="p-4 border-t bg-gray-50 flex justify-center">
              <button 
                onClick={() => setShowDirectPreview(false)}
                className="px-12 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 발송 확인 모달 */}
      {sendConfirm.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
            <div className={`px-6 py-4 border-b ${sendConfirm.type === 'immediate' ? 'bg-emerald-50' : 'bg-blue-50'}`}>
              <h3 className={`text-lg font-bold ${sendConfirm.type === 'immediate' ? 'text-emerald-700' : 'text-blue-700'}`}>
                {sendConfirm.type === 'immediate' ? '⚡ 즉시 발송' : '📅 예약 발송'}
              </h3>
            </div>
            <div className="p-6">
              <p className="text-gray-700 mb-4">
                {sendConfirm.type === 'immediate' 
                  ? '메시지를 즉시 발송하시겠습니까?' 
                  : '메시지를 예약 발송하시겠습니까?'}
              </p>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">발송 건수</span>
                  <span className="font-bold text-emerald-600">{sendConfirm.count.toLocaleString()}건</span>
                </div>
                {sendConfirm.unsubscribeCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">수신거부 제외</span>
                    <span className="font-bold text-rose-500">{sendConfirm.unsubscribeCount.toLocaleString()}건</span>
                  </div>
                )}
                {sendConfirm.type === 'scheduled' && sendConfirm.dateTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">예약 시간</span>
                    <span className="font-bold text-blue-600">
                      {new Date(sendConfirm.dateTime).toLocaleString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">메시지 타입</span>
                  <span className="font-medium">{directMsgType}</span>
                </div>
                {sendConfirm.type === 'scheduled' && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <span>⚠️</span> 예약 취소는 발송 15분 전까지 가능합니다
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0})}
                disabled={directSending}
                className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={sendConfirm.from === 'target' ? executeTargetSend : executeDirectSend}
                disabled={directSending}
                className={`flex-1 py-3 text-white font-medium ${sendConfirm.type === 'immediate' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-500 hover:bg-blue-600'} disabled:opacity-50`}
              >
                {directSending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">⏳</span> 처리중...
                  </span>
                ) : (
                  sendConfirm.type === 'immediate' ? '즉시 발송' : '예약 발송'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 하단 링크 */}
      <div className="max-w-7xl mx-auto px-4 py-6 mt-8 border-t border-gray-200 text-center text-xs text-gray-400 space-x-3">
        <a href="/privacy" target="_blank" className="hover:text-gray-600 transition">개인정보처리방침</a>
        <span>|</span>
        <a href="/terms" target="_blank" className="hover:text-gray-600 transition">이용약관</a>
        <span>|</span>
        <span>© 2026 INVITO</span>
      </div>
    </div>
  );
}