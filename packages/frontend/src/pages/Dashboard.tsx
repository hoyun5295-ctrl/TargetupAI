import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customersApi, campaignsApi, aiApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { formatDateTime, formatDate } from '../utils/formatDate';
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

// Ķ���� ��� ������Ʈ
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
        headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
      });
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('ķ���� ��ȸ ����:', error);
    }
  };

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const getCampaignsForDay = (day: number) => {
    const currentDay = new Date(year, month, day);
    return campaigns.filter((c) => {
      // �̺�Ʈ �Ⱓ�� ��ȿ�ϸ� �� ���� üũ
      if (c.event_start_date && c.event_end_date) {
        const startStr = c.event_start_date.slice(0, 10); // "2026-02-09"
        const endStr = c.event_end_date.slice(0, 10);     // "2026-02-13"
        const currentStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (endStr >= startStr) {
          return currentStr >= startStr && currentStr <= endStr;
        }
      }
      // ���ų� ��ȿ���� ������ scheduled_at �Ǵ� created_at ����
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
    scheduled: 'bg-blue-200 text-blue-700',
    sending: 'bg-orange-200 text-orange-700',
    completed: 'bg-green-200 text-green-700',
    failed: 'bg-red-200 text-red-700',
    cancelled: 'bg-gray-200 text-gray-400',
  };
  const statusLabels: Record<string, string> = {
    draft: '�غ�', scheduled: '����', sending: '����', completed: '�Ϸ�', failed: '����', cancelled: '���',
  };

  // ��¥ Ŭ�� �ڵ鷯
  const handleDateClick = (day: number) => {
    setSelectedDate(day);
    setSelectedCampaign(null); // ķ���� ���� �ʱ�ȭ
  };

  // ķ���� Ŭ�� �ڵ鷯
  const handleCampaignClick = (campaign: any, e: React.MouseEvent) => {
    e.stopPropagation(); // ��¥ Ŭ�� �̺�Ʈ ���� ����
    setSelectedCampaign(campaign);
  };

  // ���õ� ��¥�� ķ���� ���
  const selectedDateCampaigns = selectedDate ? getCampaignsForDay(selectedDate) : [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[650px] overflow-hidden">
        {/* ��� */}
        <div className="flex justify-between items-center p-4 border-b bg-gray-50">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="px-3 py-1 hover:bg-gray-200 rounded">��</button>
          <h2 className="text-lg font-bold">{year}�� {month + 1}��</h2>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="px-3 py-1 hover:bg-gray-200 rounded">��</button>
          <button onClick={onClose} className="ml-4 text-gray-500 hover:text-gray-700 text-xl">?</button>
        </div>

        <div className="flex">
          {/* Ķ���� */}
          <div className="flex-1 p-4">
            {/* ���� ���� ���̵� */}
            <div className="flex items-center gap-4 mb-3 pb-2 border-b text-xs">
              <span className="text-gray-500">����:</span>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-green-200"></span>
                <span className="text-gray-600">�Ϸ�</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-blue-200"></span>
                <span className="text-gray-600">����</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-gray-200"></span>
                <span className="text-gray-600">���</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-orange-200"></span>
                <span className="text-gray-600">����</span>
              </div>
            </div>
            {/* ���� ��� - ���� ���� */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['��','��','ȭ','��','��','��','��'].map((d, idx) => (
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
            {/* ��¥ �׸��� */}
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
                    {/* ��¥ ���� - ���Ϻ� ���� */}
                    <div className={`font-medium text-center ${
                      isToday ? 'text-blue-600' : 
                      dayOfWeek === 0 ? 'text-red-500' : 
                      dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-700'
                    }`}>
                      {day}
                    </div>
                    {/* ķ���� ��� - ���� �� */}                    {/* ķ���� ��� - ���� �� */}
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
                      <div className="text-gray-400 mt-0.5 hover:text-purple-600">+{dayCampaigns.length - 2}�� ��</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ���� �г� - ��¥ ���� �Ǵ� ķ���� �� */}
          <div className="w-72 border-l bg-gray-50 flex flex-col max-h-[580px]">
            {selectedCampaign ? (
              // ķ���� �� ����
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-bold text-base leading-tight">{selectedCampaign.campaign_name}</h3>
                  <button onClick={() => setSelectedCampaign(null)} className="text-gray-400 hover:text-gray-600 text-sm">?</button>
                </div>
                
                <div className="space-y-3 text-sm">
                  {/* ���� */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">����</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[selectedCampaign.status]}`}>
                      {statusLabels[selectedCampaign.status]}
                      {selectedCampaign.status === 'cancelled' && selectedCampaign.cancelled_by_type === 'super_admin' && (
                        <span className="ml-1 text-red-500">(������)</span>
                      )}
                    </span>
                  </div>
                  
                  {/* ��� ���� (������ ��� ��) */}
                  {selectedCampaign.status === 'cancelled' && selectedCampaign.cancel_reason && (
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-16">��һ���</span>
                      <span className="text-red-600 text-xs flex-1">{selectedCampaign.cancel_reason}</span>
                    </div>
                  )}
                  
                  {/* ä�� */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">ä��</span>
                    <span className="font-medium">{selectedCampaign.message_type}</span>
                  </div>
                  
                  {/* ��� */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">���</span>
                    <span className="font-medium">{selectedCampaign.target_count?.toLocaleString()}��</span>
                  </div>
                  
                  {/* ����ð� */}
                  {selectedCampaign.scheduled_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16">����</span>
                      <span className="font-medium text-blue-600">
                        {new Date(selectedCampaign.scheduled_at).toLocaleString('ko-KR', {
                          timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                  
                  {/* �߼۽ð� */}
                  {selectedCampaign.sent_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16">�߼�</span>
                      <span className="font-medium">
                        {new Date(selectedCampaign.sent_at).toLocaleString('ko-KR', {
                          timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                  
                  {/* �޽��� �̸����� */}
                  {selectedCampaign.message_content && (
                    <div className="pt-3 border-t">
                      <div className="text-gray-500 mb-2">?? �޽���</div>
                      <div className="bg-white rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap border max-h-24 overflow-y-auto">
                        {selectedCampaign.message_content}
                      </div>
                    </div>
                  )}
                  
                  {/* �߼� ��� */}
                  {(selectedCampaign.status === 'completed' || selectedCampaign.status === 'sending') && (
                    <div className="pt-3 border-t">
                      <div className="text-gray-500 mb-2">?? �߼� ���</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white rounded p-2 border">
                          <div className="font-bold text-gray-700">{selectedCampaign.sent_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">�߼�</div>
                        </div>
                        <div className="bg-green-50 rounded p-2 border border-green-200">
                          <div className="font-bold text-green-600">{selectedCampaign.success_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">����</div>
                        </div>
                        <div className="bg-red-50 rounded p-2 border border-red-200">
                          <div className="font-bold text-red-600">{selectedCampaign.fail_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">����</div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* ��ư */}
                  <div className="pt-4 space-y-2">
                    <button className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium transition-colors">
                      ?? ����
                    </button>
                    <button className="w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors">
                      ?? ����
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedDate ? (
              // ��¥ ���� - ķ���� ���
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">
                    {month + 1}�� {selectedDate}��
                    <span className="text-gray-400 font-normal ml-1">
                      ({['��','��','ȭ','��','��','��','��'][new Date(year, month, selectedDate).getDay()]})
                    </span>
                  </h3>
                  <button onClick={() => setSelectedDate(null)} className="text-gray-400 hover:text-gray-600 text-sm">?</button>
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
                          <span className="text-gray-400">{c.target_count?.toLocaleString()}��</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8">
                    <div className="text-3xl mb-2">??</div>
                    <p>�� ��¥�� ķ������ �����ϴ�</p>
                  </div>
                )}
              </div>
            ) : (
              // �⺻ ����
              <div className="flex-1 flex items-center justify-center text-center text-gray-400 p-4">
                <div>
                  <div className="text-4xl mb-3">??</div>
                  <p className="text-sm">��¥�� ķ������<br/>�������ּ���</p>
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
  const [balanceInfo, setBalanceInfo] = useState<{billingType: string, balance: number, costPerSms: number, costPerLms: number, costPerMms: number, costPerKakao: number} | null>(null);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [chargeStep, setChargeStep] = useState<'select' | 'deposit'>('select');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [showInsufficientBalance, setShowInsufficientBalance] = useState<{show: boolean, balance: number, required: number} | null>(null);
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
  const [smsOverrideAccepted, setSmsOverrideAccepted] = useState(false);
  const [showSmsConvert, setShowSmsConvert] = useState<{show: boolean, from: 'direct' | 'target', currentBytes: number, smsBytes: number, count: number}>({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0});
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState<number>(1000);
  const [isAd, setIsAd] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successCampaignId, setSuccessCampaignId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [sendTimeOption, setSendTimeOption] = useState<'ai' | 'now' | 'custom'>('now');
  const [successSendInfo, setSuccessSendInfo] = useState<string>('');  // ���� ��޿� �߼� ����
  const [customSendTime, setCustomSendTime] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testCooldown, setTestCooldown] = useState(false);
  const [testSentResult, setTestSentResult] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [showCustomerDB, setShowCustomerDB] = useState(false);
  // 5�� ī�� ��� state
  const [showRecentCampaigns, setShowRecentCampaigns] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showDirectTargeting, setShowDirectTargeting] = useState(false);
  // ���� Ÿ�� ���� ���� state
   // ���� Ÿ�� ���� ���� state
   const [targetPhoneField, setTargetPhoneField] = useState('phone');
   const [targetSmsOptIn, setTargetSmsOptIn] = useState(true);
   const [targetCount, setTargetCount] = useState(0);
   const [targetCountLoading, setTargetCountLoading] = useState(false);
   const [targetSchemaFields, setTargetSchemaFields] = useState<{name: string, label: string, type: string}[]>([]);
   // ���� ���� state
   const [enabledFields, setEnabledFields] = useState<any[]>([]);
   const [targetFilters, setTargetFilters] = useState<Record<string, string>>({});
   const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
   const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });
  const [showTemplates, setShowTemplates] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showTodayStats, setShowTodayStats] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  // ��޿� ������
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
  // ���� ���ε� ����
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
  // ����Ÿ�ٹ߼� ���� state
  const [targetMsgType, setTargetMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [targetSubject, setTargetSubject] = useState('');
  const [targetMessage, setTargetMessage] = useState('');
  const [targetRecipients, setTargetRecipients] = useState<any[]>([]);
  const [targetSending, setTargetSending] = useState(false);
  const [targetListPage, setTargetListPage] = useState(0);
  const [targetListSearch, setTargetListSearch] = useState('');
  const [showTargetPreview, setShowTargetPreview] = useState(false);
  // �����߼� ���� state
  const [directMsgType, setDirectMsgType] = useState<'SMS' | 'LMS' | 'MMS'>('SMS');
  const [directSubject, setDirectSubject] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [directRecipients, setDirectRecipients] = useState<any[]>([]);
  const [directSearchQuery, setDirectSearchQuery] = useState('');
  const [reserveEnabled, setReserveEnabled] = useState(false);
  const [reserveDateTime, setReserveDateTime] = useState('');
  const [showReservePicker, setShowReservePicker] = useState(false);
  // �����߼� ���� �Լ�
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
          splitCount: splitEnabled ? splitCount : null,
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath)
        })
      });
      const data = await res.json();
      if (res.status === 402 && data.insufficientBalance) {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setShowInsufficientBalance({show: true, balance: data.balance, required: data.requiredAmount});
        setDirectSending(false);
        return;
      }
      if (data.success) {
        setToast({show: true, type: 'success', message: data.message});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
        if (balanceInfo?.billingType === 'prepaid') {
          const balanceRes = await fetch('/api/balance', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
          if (balanceRes.ok) setBalanceInfo(await balanceRes.json());
        }
        // ��� ����, �Է� �ʵ常 �ʱ�ȭ
        setDirectMessage('');
        setDirectSubject('');
        setDirectRecipients([]);
        setDirectMsgType('SMS');
        setReserveEnabled(false);
        setReserveDateTime('');
        loadRecentCampaigns();
        loadScheduledCampaigns();
      } else {
        setToast({show: true, type: 'error', message: data.error});
        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      }
    } catch (err) {
      setToast({show: true, type: 'error', message: '�߼� ����'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    } finally {
      setDirectSending(false);
    }
    setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
  };
  
  // ����Ÿ������ �߼� �Լ�
  const executeTargetSend = async () => {
    setTargetSending(true);
    try {
      const token = localStorage.getItem('token');
      // ���� ġȯ ó��
      const recipientsWithMessage = targetRecipients.map((r: any) => ({
        phone: r.phone,
        name: r.name || '',
        grade: r.grade || '',
        region: r.region || '',
        amount: r.total_purchase_amount || '',
        callback: r.callback || null,
        message: (adTextEnabled ? '(����)' : '') + 
          targetMessage
            .replace(/%�̸�%/g, r.name || '')
            .replace(/%���%/g, r.grade || '')
            .replace(/%����%/g, r.region || '')
            .replace(/%���űݾ�%/g, r.total_purchase_amount || '')
            .replace(/%ȸ�Ź�ȣ%/g, r.callback || '') +
          (adTextEnabled ? (targetMsgType === 'SMS' ? `\n����ź�${optOutNumber.replace(/-/g, '')}` : `\n������Űź� ${formatRejectNumber(optOutNumber)}`) : '')
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
          customMessages: recipientsWithMessage.map(r => ({ ...r, callback: r.callback || null })),
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath)
        })
      });
      const data = await res.json();
      if (res.status === 402 && data.insufficientBalance) {
        setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
        setShowInsufficientBalance({show: true, balance: data.balance, required: data.requiredAmount});
        setTargetSending(false);
        return;
      }
      if (data.success) {
        setToast({show: true, type: 'success', message: data.message});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
        if (balanceInfo?.billingType === 'prepaid') {
          const balanceRes = await fetch('/api/balance', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
          if (balanceRes.ok) setBalanceInfo(await balanceRes.json());
        }
        setShowTargetSend(false);
        setTargetRecipients([]);
        setTargetMessage('');
        setTargetSubject('');
        loadRecentCampaigns();
        loadScheduledCampaigns();
      } else {
        setToast({show: true, type: 'error', message: data.error});
        setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      }
    } catch (err) {
      setToast({show: true, type: 'error', message: '�߼� ����'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    } finally {
      setTargetSending(false);
    }
    setSendConfirm({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});
  };
  
  // MMS �̹��� (���� ���ε� ���)
  const [mmsUploadedImages, setMmsUploadedImages] = useState<{serverPath: string; url: string; filename: string; size: number}[]>([]);
  const [mmsUploading, setMmsUploading] = useState(false);
  const [showMmsUploadModal, setShowMmsUploadModal] = useState(false);

  // MMS �̹��� ���� ���� ���ε� �Լ�
  const handleMmsSlotUpload = async (file: File, slotIndex: number) => {
    // ����: JPG��
    if (!file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
      setToast({ show: true, type: 'error', message: 'JPG ���ϸ� ���ε� �����մϴ� (PNG/GIF ������)' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return;
    }
    // ����: 300KB
    if (file.size > 300 * 1024) {
      setToast({ show: true, type: 'error', message: `${(file.size / 1024).toFixed(0)}KB ? 300KB ���ϸ� �����մϴ�` });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return;
    }

    setMmsUploading(true);
    try {
      const formData = new FormData();
      formData.append('images', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/mms-images/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success && data.images.length > 0) {
        setMmsUploadedImages(prev => {
          const updated = [...prev];
          updated[slotIndex] = data.images[0];
          return updated;
        });
      } else {
        setToast({ show: true, type: 'error', message: data.error || '���ε� ����' });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      }
    } catch {
      setToast({ show: true, type: 'error', message: '�̹��� ���ε� �� ���� �߻�' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
    } finally {
      setMmsUploading(false);
    }
  };

  // MMS �̹��� ���� ���ε� �Լ� �� ��� �������� ����
  const handleMmsImageUpload = (files: FileList | null, sendType: 'ai' | 'target' | 'direct') => {
    setShowMmsUploadModal(true);
  };

  // MMS �̹��� ���� �Լ� (���� ���)
  const handleMmsImageRemove = async (index: number) => {
    const img = mmsUploadedImages[index];
    if (img) {
      try {
        const token = localStorage.getItem('token');
        await fetch(img.url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      } catch { /* ���� ���� �����ص� UI������ ���� */ }
    }
    setMmsUploadedImages(prev => prev.filter((_, i) => i !== index));
  };
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
  const [showSpecialChars, setShowSpecialChars] = useState<'target' | 'direct' | null>(null);
  const [showTemplateBox, setShowTemplateBox] = useState<'target' | 'direct' | null>(null);
  const [templateList, setTemplateList] = useState<any[]>([]);
  const [showTemplateSave, setShowTemplateSave] = useState<'target' | 'direct' | null>(null);
  const [templateSaveName, setTemplateSaveName] = useState('');
  const [directInputText, setDirectInputText] = useState('');
  const [callbackNumbers, setCallbackNumbers] = useState<{id: string, phone: string, label: string, is_default: boolean}[]>([]);
  const [selectedCallback, setSelectedCallback] = useState('');
  const [useIndividualCallback, setUseIndividualCallback] = useState(false);
  const [sendConfirm, setSendConfirm] = useState<{show: boolean, type: 'immediate' | 'scheduled', count: number, unsubscribeCount: number, dateTime?: string, from?: 'direct' | 'target'}>({show: false, type: 'immediate', count: 0, unsubscribeCount: 0});

  // ��ȭ��ȣ ������ �Լ�
  const formatPhoneNumber = (phone: string) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    
    // �޴��� 11�ڸ�: 010-XXXX-XXXX
    if (cleaned.length === 11 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    // �޴��� 10�ڸ� (����): 01X-XXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('01')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    // ���� 02 ������ȣ (9�ڸ�): 02-XXX-XXXX
    if (cleaned.length === 9 && cleaned.startsWith('02')) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
    }
    // ���� 02 ������ȣ (10�ڸ�): 02-XXXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('02')) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
    }
    // ��ǥ��ȣ 8�ڸ� (15XX, 16XX, 18XX): 1XXX-XXXX
    if (cleaned.length === 8 && cleaned.startsWith('1')) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    }
    // ��Ÿ ������ȣ 10�ڸ�: 0XX-XXX-XXXX
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    // ��Ÿ ������ȣ 11�ڸ�: 0XX-XXXX-XXXX
    if (cleaned.length === 11 && cleaned.startsWith('0')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    // �� �ܴ� ���� ��ȯ
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
  // Ÿ�� ����
  const [filter, setFilter] = useState({
    gender: '',
    minAge: '',
    maxAge: '',
    grade: '',
    smsOptIn: true,
  });

  // Ÿ�� ���
  const [targetResult, setTargetResult] = useState<any>(null);

  // ķ���� ����
  const [campaign, setCampaign] = useState({
    campaignName: '',
    messageType: 'SMS',
    messageContent: '',
    isAd: false,
  });

  // AI ���� ����
  const [aiLoading, setAiLoading] = useState(false);
  const [showPromptAlert, setShowPromptAlert] = useState(false);
  const [aiObjective, setAiObjective] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMessages, setAiMessages] = useState<any[]>([]);
  const [showAiTarget, setShowAiTarget] = useState(false);
  const [showAiMessage, setShowAiMessage] = useState(false);
  const [campaignContext, setCampaignContext] = useState(''); // Ÿ�١�޽��� �����

  useEffect(() => {
    loadStats();
    loadRecentCampaigns();
    loadScheduledCampaigns();
  }, []);
// �ڵ��Է� ������ ������ �� ���� �� ������ ġȯ�Ͽ� �ִ� ����Ʈ �޽��� ����
const getMaxByteMessage = (msg: string, recipients: any[], variableMap: Record<string, string>) => {
  let result = msg;
  // variableMap: { '%�̸�%': 'name', '%���%': 'grade', ... }
  Object.entries(variableMap).forEach(([variable, field]) => {
    if (!result.includes(variable)) return;
    // ������ �� �ش� �ʵ��� ���� �� �� ã��
    let maxValue = '';
    recipients.forEach((r: any) => {
      const val = String(r[field] || '');
      if (val.length > maxValue.length) maxValue = val;
    });
    // �����ڰ� ���ų� ���� ������ �⺻ �ִ밪 ���
    if (!maxValue) {
      const defaults: Record<string, string> = {
        '%�̸�%': 'ȫ�浿��Ӵ�', '%���%': 'VVIP', '%����%': '��⵵ ������',
        '%���űݾ�%': '99,999,999��', '%��Ÿ1%': '�����ٶ󸶹ٻ�', '%��Ÿ2%': '�����ٶ󸶹ٻ�', '%��Ÿ3%': '�����ٶ󸶹ٻ�',
        '%ȸ�Ź�ȣ%': '07012345678',
      };
      maxValue = defaults[variable] || '�����ٶ󸶹�';
    }
    result = result.replace(new RegExp(variable.replace(/%/g, '%'), 'g'), maxValue);
  });
  return result;
};
  // ����Ʈ �ʰ� �� �ڵ� LMS ��ȯ (SMS��LMS��, LMS��SMS ���ʹ� ����)
  useEffect(() => {
    // �޽��� ���� �� �������̵� ����
    setSmsOverrideAccepted(false);
    // �ڵ��Է� ������ �ִ� ���� ������ ġȯ
    const directVarMap: Record<string, string> = {
      '%�̸�%': 'name', '%��Ÿ1%': 'extra1', '%��Ÿ2%': 'extra2', '%��Ÿ3%': 'extra3', '%ȸ�Ź�ȣ%': 'callback',
    };
    let fullMsg = getMaxByteMessage(directMessage, directRecipients, directVarMap);
    if (adTextEnabled) {
      const optOutText = directMsgType === 'SMS'
        ? `����ź�${optOutNumber.replace(/-/g, '')}`
        : `������Űź� ${optOutNumber}`;
      fullMsg = `(����) ${fullMsg}\n${optOutText}`;
    }
    // �ѱ� 2byte, ����/���� 1byte ���
    let bytes = 0;
    for (let i = 0; i < fullMsg.length; i++) {
      const char = fullMsg.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    // SMS���� 90����Ʈ �ʰ� �� LMS ��ȯ Ȯ�� ���
    if (directMsgType === 'SMS' && bytes > 90 && !showLmsConfirm) {
      setPendingBytes(bytes);
      setShowLmsConfirm(true);
    }
  }, [directMessage, directMsgType, adTextEnabled, optOutNumber, directRecipients]);

  // Ÿ�ٹ߼� �޽��� �ǽð� ����Ʈ üũ
  useEffect(() => {
    if (!showTargetSend) return;
    setSmsOverrideAccepted(false);
    // �ڵ��Է� ������ �ִ� ���� ������ ġȯ
    const targetVarMap: Record<string, string> = {
      '%�̸�%': 'name', '%���%': 'grade', '%����%': 'region', '%���űݾ�%': 'total_purchase_amount', '%ȸ�Ź�ȣ%': 'callback',
    };
    let fullMsg = getMaxByteMessage(targetMessage, targetRecipients, targetVarMap);
    if (adTextEnabled) {
      const optOutText = targetMsgType === 'SMS'
        ? `����ź�${optOutNumber.replace(/-/g, '')}`
        : `������Űź� ${optOutNumber}`;
      fullMsg = `(����)${fullMsg}\n${optOutText}`;
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
      
      // �÷� ���� ��ȸ
      const token = localStorage.getItem('token');
      const planRes = await fetch('/api/companies/my-plan', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (planRes.ok) {
        const planData = await planRes.json();
        setPlanInfo(planData);
      }

      // �ܾ� ���� ��ȸ
      const balanceRes = await fetch('/api/balance', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json();
        setBalanceInfo(balanceData);
      }
    } catch (error) {
      console.error('��� �ε� ����:', error);
    } finally {
      setLoading(false);
    }
  };
  // �ֱ� ķ���� �ε�
  const loadRecentCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const campaigns = (data.campaigns || []).filter((c: any) => c.status !== 'draft');
      setRecentCampaigns(campaigns.slice(0, 5));
    } catch (error) {
      console.error('�ֱ� ķ���� �ε� ����:', error);
    }
  };

  // ���� ��� ķ���� �ε�
  const loadScheduledCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns?status=scheduled', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setScheduledCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('���� ķ���� �ε� ����:', error);
    }
  };

  // ���� Ÿ�� ���� - ��Ű�� �ε�
  // ���� Ÿ�� ���� - ��Ű�� �ε� (���� ����)
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
      console.error('��Ű�� �ε� ����:', error);
    }
  };

  // SMS ���ø� �ε�
  const loadTemplates = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sms-templates', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setTemplateList(data.templates || []);
    } catch (error) {
      console.error('���ø� �ε� ����:', error);
    }
  };

  // SMS ���ø� ����
  const saveTemplate = async (name: string, content: string, msgType: string, subject: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ templateName: name, messageType: msgType, subject: subject || null, content })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '���ڰ� �����Կ� ����Ǿ����ϴ�.' });
        setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
        return true;
      } else {
        setToast({ show: true, type: 'error', message: data.error || '���� ����' });
        setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
        return false;
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '���� �� ���� �߻�' });
      setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
      return false;
    }
  };

  // SMS ���ø� ����
  const deleteTemplate = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sms-templates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setTemplateList(prev => prev.filter(t => t.id !== id));
        setToast({ show: true, type: 'success', message: '�����Ǿ����ϴ�.' });
        setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
      }
    } catch (error) {
      console.error('���ø� ���� ����:', error);
    }
  };

  // ���� ���� - Ȱ�� �ʵ� �ε�
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
      console.error('�ʵ� �ε� ����:', error);
    }
  };

  // ���� ���� �� API ���� ��ȯ
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    for (const [fieldKey, value] of Object.entries(targetFilters)) {
      if (!value) continue;
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;

      // Ư�� �ʵ� ��ȯ
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

  // ���� Ÿ�� ���� - ���� ī��Ʈ
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
      console.error('ī��Ʈ ��ȸ ����:', error);
    } finally {
      setTargetCountLoading(false);
    }
  };

  // ���� Ÿ�� ���� - Ÿ�� ���� �� �߼�ȭ�� �̵�
  const handleTargetExtract = async () => {
    if (targetCount === 0) {
      setToast({show: true, type: 'error', message: '������ ����� �����ϴ�'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      return;
    }
    try {
      const token = localStorage.getItem('token');
      
      // 080 ���Űźι�ȣ �ε�
      const settingsRes = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.reject_number) {
          setOptOutNumber(settingsData.reject_number);
        }
      }
      
      // ȸ�Ź�ȣ �ε�
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
          amount: r.total_purchase_amount ? Math.floor(r.total_purchase_amount).toLocaleString() + '��' : '',
          callback: r.callback || ''
        }));
        setTargetRecipients(recipients);
        setShowDirectTargeting(false);
        setShowTargetSend(true);
        setToast({show: true, type: 'success', message: `${data.count}�� ���� �Ϸ�`});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
      }
    } catch (error) {
      console.error('Ÿ�� ���� ����:', error);
      setToast({show: true, type: 'error', message: 'Ÿ�� ���� ����'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    }
  };

  // ���� Ÿ�� ���� - ���� �ʱ�ȭ
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

      console.log('API ȣ�� params:', params);
      const response = await customersApi.list({ ...params, limit: 100 });
      setTargetResult(response.data);
    } catch (error) {
      console.error('Ÿ�� ���� ����:', error);
    }
  };

  // AI Ÿ�� ��õ
  const handleAiRecommendTarget = async () => {
    if (!aiObjective.trim()) {
      alert('������ ��ǥ�� �Է����ּ���');
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.recommendTarget({ objective: aiObjective });
      const result = response.data;
      console.log('AI ����:', result);
      console.log('������ gender:', result.filters?.gender?.value);

      // ��õ�� ���� ����
      if (result.filters) {
        const newFilter = { ...filter };
        if (result.filters.gender?.value) newFilter.gender = result.filters.gender.value;
        if (result.filters.age?.value) {
          newFilter.minAge = result.filters.age.value[0]?.toString() || '';
          newFilter.maxAge = result.filters.age.value[1]?.toString() || '';
        }
        if (result.filters.grade?.value) newFilter.grade = result.filters.grade.value;
        setFilter(newFilter);
        console.log('������ ����:', newFilter);
      }
      
      // ķ���� ���ؽ�Ʈ ���� (�޽��� ������ ���)
      setCampaignContext(aiObjective);
      
      alert(`AI ��õ �Ϸ�!\n\n${result.reasoning}\n\n���� Ÿ��: ${result.estimated_count.toLocaleString()}��${result.unsubscribe_count > 0 ? `\n���Űź� ����: ${result.unsubscribe_count.toLocaleString()}��` : ''}`);
      setShowAiTarget(false);
      setAiObjective('');
    } catch (error) {
      console.error('AI Ÿ�� ��õ ����:', error);
      alert('AI ��õ �� ������ �߻��߽��ϴ�.');
    } finally {
      setAiLoading(false);
    }
  };
// AI ķ���� ���� (������Ʈ �� ��)
const handleAiCampaignGenerate = async () => {
  if (!aiCampaignPrompt.trim()) {
    setShowPromptAlert(true);
    return;
  }
  setAiLoading(true);
  try {
    // 1. Ÿ�� + ä�� ��õ �ޱ�
    const response = await aiApi.recommendTarget({ objective: aiCampaignPrompt });
    const result = response.data;
    
    // AI ��� ����
    setAiResult({
      target: {
        description: result.reasoning || '��õ Ÿ��',
        count: result.estimated_count || 0,
        unsubscribeCount: result.unsubscribe_count || 0,
        filters: result.filters || {},
      },
      recommendedChannel: result.recommended_channel || 'SMS',
      channelReason: result.channel_reason || '������ �ȳ� �޽����� �����մϴ�.',
      recommendedTime: result.recommended_time || '',
      suggestedCampaignName: result.suggested_campaign_name || '',
      useIndividualCallback: result.use_individual_callback || false,
      usePersonalization: result.use_personalization || false,
      personalizationVars: result.personalization_vars || [],
    });
    
    // ��õ ä�η� �⺻ ����
    setSelectedChannel(result.recommended_channel || 'SMS');
    setIsAd(result.is_ad !== false);
    
    // ����ȸ�Ź�ȣ �ڵ� ����
    if (result.use_individual_callback) {
      setUseIndividualCallback(true);
    }
  
    // �˾� ����
    setShowAiResult(true);
    setAiStep(1);
  } catch (error) {
    console.error('AI ķ���� ���� ����:', error);
    alert('AI ��õ �� ������ �߻��߽��ϴ�.');
  } finally {
    setAiLoading(false);
  }
};

// AI �޽��� ���� (ä�� ���� ��)
const handleAiGenerateChannelMessage = async () => {
  setAiLoading(true);
  try {
    const response = await aiApi.generateMessage({
      prompt: aiCampaignPrompt,
      brandName: user?.company?.name || '�귣��',
      channel: selectedChannel,
      usePersonalization: aiResult?.usePersonalization || false,
      personalizationVars: aiResult?.personalizationVars || [],
    });
    
    // �޽��� ��� ����
    setAiResult((prev: any) => ({
      ...prev,
      messages: response.data.variants || [],
    }));
    
    // 2�ܰ�� �̵�
    setAiStep(2);
  } catch (error) {
    console.error('AI �޽��� ���� ����:', error);
    alert('�޽��� ���� �� ������ �߻��߽��ϴ�.');
  } finally {
    setAiLoading(false);
  }
};

  // AI �޽��� ����
  const handleAiGenerateMessage = async () => {
    const prompt = aiPrompt.trim() || campaignContext;
    if (!prompt) {
      alert('�޽��� ��û ������ �Է����ּ���');
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.generateMessage({
        prompt: prompt,
        brandName: user?.company?.name || '�귣��',
      });
      setAiMessages(response.data.variants || []);
    } catch (error) {
      console.error('AI �޽��� ���� ����:', error);
      alert('AI �޽��� ���� �� ������ �߻��߽��ϴ�.');
    } finally {
      setAiLoading(false);
    }
  };

  // AI �޽��� ����
  const handleSelectAiMessage = (message: any) => {
    const text = campaign.messageType === 'SMS' ? message.sms_text : message.lms_text;
    setCampaign({ ...campaign, messageContent: text });
    setShowAiMessage(false);
    setAiMessages([]);
    setAiPrompt('');
  };

  const handleCreateCampaign = async () => {
    if (!campaign.campaignName || !campaign.messageContent) {
      alert('ķ���θ�� �޽��� ������ �Է��ϼ���');
      return;
    }

    try {
      await campaignsApi.create({
        ...campaign,
        targetFilter: filter,
      });
      alert('ķ������ �����Ǿ����ϴ�');
      setActiveTab('send');
    } catch (error: any) {
      alert(error.response?.data?.error || 'ķ���� ���� ����');
    } finally {
      setIsSending(false);
    }
  };
// AI ķ���� �߼� Ȯ��
const handleAiCampaignSend = async () => {
  if (isSending) return; // �ߺ� Ŭ�� ����
  
  // ȸ�Ź�ȣ ����
  if (!selectedCallback && !useIndividualCallback) {
    alert('ȸ�Ź�ȣ�� �������ּ���');
    return;
  }
  
  setIsSending(true);
  try {
    // ���õ� �޽��� �������� (ù��° �޽��� ���, ���߿� ���� ���ð����� ���� ����)
    const selectedMsg = aiResult?.messages?.[0];
    if (!selectedMsg) {
      alert('�޽����� �������ּ���');
      setIsSending(false);
      return;
    }

    // �߼۽ð� ���
    let scheduledAt: string | null = null;
    if (sendTimeOption === 'ai' && aiResult?.recommendedTime) {
      // AI ��õ�ð� �Ľ� (��: "2024-02-01 19:00" �Ǵ� "2�� 1�� ���� 7��")
      const timeStr = aiResult.recommendedTime;
      // ISO �����̸� �״��, �ƴϸ� �Ľ� �õ�
      if (timeStr.includes('T') || timeStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        scheduledAt = timeStr;
      } else {
        // �ѱ��� ���� �Ľ� �õ� (��: "2�� 1�� 19:00")
        const match = timeStr.match(/(\d+)��\s*(\d+)��.*?(\d{1,2}):?(\d{2})?/);
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
    // 'now'�� scheduledAt�� null (��� �߼�)

    // �̺�Ʈ �Ⱓ �Ľ� (AI �޽������� ���� �õ�)
    let eventStartDate: string | null = null;
    let eventEndDate: string | null = null;
    
    // �޽��� ���뿡�� �̺�Ʈ �Ⱓ ���� �õ�
    const msgText = selectedMsg.message_text || '';
    // ���� ���� ����: "X�� X�� ~ X��", "X�� X�� ~ X�� X��", "X/X ~ X/X"
    let eventMatch = msgText.match(/(\d+)��\s*(\d+)��.*?~\s*(\d+)��\s*(\d+)��/); // 2�� 13�� ~ 2�� 15��
    if (!eventMatch) {
      eventMatch = msgText.match(/(\d+)��\s*(\d+)��.*?~\s*(\d+)��/); // 2�� 13�� ~ 15��
      if (eventMatch) {
        // ������ ���� ������ ���� ���� ����
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

    // AI ��õ ķ���θ� �켱 ���, ������ �޽������� ����
const msgContent = selectedMsg.message_text || '';
const nameMatch = msgContent.match(/\][\s]*(.+?)[\s]*[\n\r]/);
const extractedName = nameMatch ? nameMatch[1].replace(/[^\w��-�R\s]/g, '').trim().slice(0, 30) : `ķ����_${formatDate(new Date().toISOString())}`;
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
      mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
    };

    console.log('=== �߼� ����� ===');
    console.log('sendTimeOption:', sendTimeOption);
    console.log('scheduledAt:', scheduledAt);
    console.log('campaignData:', campaignData);

    const response = await campaignsApi.create(campaignData);

    // ķ���� �߼� API ȣ�� (����/��� ���)
    const campaignId = response.data.campaign?.id;
    if (campaignId) {
      await campaignsApi.send(campaignId);
    }
    
    // ��� �ݱ�
    setShowPreview(false);
    setShowAiResult(false);
    setAiStep(1);
    setAiCampaignPrompt('');
    // ���� ��޿� �߼� ���� ���� (�ʱ�ȭ ����!)
    const sendInfoText = sendTimeOption === 'now' ? '��� �߼� �Ϸ�' : 
                         sendTimeOption === 'ai' ? `���� �Ϸ� (${aiResult?.recommendedTime || 'AI ��õ'})` :
                         `���� �Ϸ� (${customSendTime ? formatDateTime(customSendTime) : ''})`;
    setSuccessSendInfo(sendInfoText);
    
    setSendTimeOption('ai');
    setCustomSendTime('');
    
    setSuccessCampaignId(response.data.campaign?.id || '');
    setShowSuccess(true);
    loadRecentCampaigns();
    loadScheduledCampaigns();
    
  } catch (error: any) {
    console.error('ķ���� ���� ����:', error);
    if (error.response?.status === 402 && error.response?.data?.insufficientBalance) {
      setShowInsufficientBalance({show: true, balance: error.response.data.balance, required: error.response.data.requiredAmount});
    } else {
      alert(error.response?.data?.error || 'ķ���� ������ �����߽��ϴ�.');
    }
  } finally {
    setIsSending(false);
  }
};

  // ����� ��������
  const handleTestSend = async () => {
    setTestSending(true);
    setTestSentResult(null);
    try {
      const selectedMsg = aiResult?.messages?.[0];
      if (!selectedMsg) {
        alert('�޽����� �������ּ���');
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
          mmsImagePaths: mmsUploadedImages.map(img => img.serverPath),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const contactList = data.contacts?.map((c: any) => `${c.name}(${c.phone})`).join(', ') || '';
        setTestSentResult(`? ${data.message}\n${contactList}`);
      } else {
        setTestSentResult(`? ${data.error}`);
      }
    } catch (error) {
      setTestSentResult('? �׽�Ʈ �߼� ����');
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
        <div className="text-gray-500">�ε� ��...</div>
      </div>
    );
  }

  // ����Ʈ ��� �Լ� (�ѱ� 2byte, ����/���� 1byte)
  const calculateBytes = (text: string) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
    }
    return bytes;
  };

  // SMS 90����Ʈ�� �߸� �޽��� ��ȯ
  const truncateToSmsBytes = (text: string, maxBytes: number = 90) => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      bytes += char > 127 ? 2 : 1;
      if (bytes > maxBytes) return text.substring(0, i);
    }
    return text;
  };

  // ������� ���Ե� ���� �޽���
  // 080��ȣ ������ ������ (0801111111 �� 080-111-1111)
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
      ? `����ź�${optOutNumber.replace(/-/g, '')}` 
      : `������Űź� ${formatRejectNumber(optOutNumber)}`;
    return `(����)${msg}\n${optOutText}`;
  };

  const messageBytes = calculateBytes(getFullMessage(directMessage));
  
  const maxBytes = directMsgType === 'SMS' ? 90 : 2000;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* AI ������Ʈ �Է� �ȳ� ��� */}
      {showPromptAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-800">AI ķ���� ����</h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                ���ϴ� ķ���� ������ �Է��ϼ���.<br/>
                <span className="text-emerald-700 font-medium">Ÿ�� �������� �޽��� �ۼ�, �߼� �ð�����</span><br/>
                AI�� �ڵ����� �����ص帳�ϴ�.
              </p>
            </div>
            <div className="p-4 bg-gray-50 border-t">
              <div className="text-sm text-gray-500 mb-4">
                <p className="font-medium mb-2">?? �Է� ����:</p>
                <ul className="space-y-1 text-gray-600">
                  <li>? 30�� ���� VIP���� �� �Ż�ǰ 20% ���� �ȳ�</li>
                  <li>? 3���� �̱��� ������� ��湮 ���� �߼�</li>
                  <li>? ���� ������� ���� �޽��� ������</li>
                </ul>
              </div>
              <button
                onClick={() => setShowPromptAlert(false)}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors"
              >
                Ȯ��
              </button>
            </div>
          </div>
          </div>
      )}
      {/* �佺Ʈ �˸� */}
      {toast.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-bounce">
          <div className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${
            toast.type === 'success' 
              ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white' 
              : 'bg-gradient-to-r from-red-500 to-rose-500 text-white'
          }`}>
            <span className="text-2xl">{toast.type === 'success' ? '?' : '?'}</span>
            <span className="font-medium text-lg">{toast.message}</span>
          </div>
        </div>
      )}
      {/* ��� */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="cursor-pointer" onClick={() => window.location.reload()}>
          <h1 className="text-xl font-bold text-gray-800">���ٷ�</h1>
            <p className="text-sm text-gray-500">{user?.company?.name}{(user as any)?.department ? ` �� ${(user as any).department}` : ''}</p>
          </div>
          <div className="flex items-center gap-4">
          <button
              onClick={async () => {
                setShowDirectSend(true);
                try {
                  const token = localStorage.getItem('token');
                  
                  // ȸ�� �������� 080 ��ȣ ��������
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
                  console.error('ȸ�Ź�ȣ �ε� ����:', err);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              <span className="text-sm font-medium">�����߼�</span>
            </button>
            <button
              onClick={() => setShowCalendar(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Calendar className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Ķ����</span>
            </button>
            <button
              onClick={() => setShowResults(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <BarChart3 className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">�߼۰��</span>
            </button>
            <button
              onClick={() => navigate('/unsubscribes')}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Ban className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">���Űź�</span>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">����</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">�α׾ƿ�</span>
            </button>
          </div>
        </div>
      </header>

      {/* ���� */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* ��� ī�� */}
        {/* ��� + AI ������Ʈ ���� */}
        <div className="flex gap-6 mb-8">
          {/* ����: ��� ī�� */}
          <div className="w-72 space-y-4">
            {/* �÷� ���� */}
            <div 
              onClick={() => navigate('/pricing')}
              className="flex items-center justify-between p-3 bg-white/50 rounded-xl cursor-pointer hover:bg-white/80 transition-all"
            >
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-800">{planInfo?.plan_name || '�ε�...'}</span>
                {planInfo?.plan_code === 'FREE' && !planInfo?.is_trial_expired && (
                  <span className="text-orange-500 ml-1 text-xs">
                    D-{Math.max(0, Math.ceil((new Date(planInfo.trial_expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))}
                  </span>
                )}
                {planInfo?.plan_code === 'FREE' && planInfo?.is_trial_expired && (
                  <span className="text-red-500 ml-1 text-xs">����</span>
                )}
              </div>
              <span className="text-green-700 text-xs font-medium">����� �ȳ� ��</span>
            </div>
                        {/* ��� ��Ȳ */}
                        <div className="bg-white/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400 font-medium">��� ��Ȳ</span>
                <button onClick={() => setShowCustomerDB(true)} className="text-green-700 text-xs font-medium hover:text-green-800 transition-colors">DB ������ȸ ��</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{parseInt(stats?.total || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">��ü</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-green-700">{parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">���ŵ���</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{parseInt(stats?.male_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">����</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{parseInt(stats?.female_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">����</div>
                </div>
              </div>
            </div>

            {/* �߼� ��Ȳ */}
            <div className="bg-white/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400 font-medium">�߼� ��Ȳ</span>
                {balanceInfo?.billingType === 'prepaid' && (
                  <button onClick={() => setShowBalanceModal(true)} className="text-green-700 text-xs font-medium hover:text-green-800 transition-colors">�ܾ� ��Ȳ ��</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{(stats?.monthly_sent || 0).toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">�̹� ��</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">{stats?.success_rate || '0'}%</div>
                  <div className="text-xs text-gray-400 mt-1">������</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-amber-600">{parseInt(stats?.vip_count || '0').toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-1">VIP</div>
                </div>
                <div className="text-center p-2">
                  <div className="text-xl font-bold text-gray-800">-</div>
                  <div className="text-xs text-gray-400 mt-1">30�� ����</div>
                </div>
              </div>
              </div>

            
                        </div>

{/* ����: AI ������Ʈ �Է� */}
          <div className="flex-1 bg-green-50 rounded-xl p-6 border border-green-200">
          <h3 className="text-xl font-bold text-gray-800 mb-2">AI �ڵ�ȭ ������</h3>
            <p className="text-sm text-gray-500 mb-5">
              �� ���̸� ����մϴ�. Ÿ�� �������� �޽��� �ۼ�, �߼� �ð����� AI�� �ڵ����� �����ص帳�ϴ�.
            </p>
            <textarea
              value={aiCampaignPrompt}
              onChange={(e) => setAiCampaignPrompt(e.target.value)}
              className="w-full p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
              rows={4}
              placeholder="��: 30�� ���� VIP ������� �� �Ż�ǰ 20% ���� �ȳ� ���� ������"
            />
            {/* 3���� �޴� ī�� */}
            <div className="grid grid-cols-3 gap-4 mt-6">
              {/* ��� DB ���ε� - ������Ʈ ��� */}
              <button 
                onClick={() => setShowFileUpload(true)}
                className="p-6 bg-slate-600 hover:bg-slate-700 rounded-xl transition-all hover:shadow-lg group text-right h-[140px] flex flex-col justify-between"
              >
                <div>
                  <div className="text-lg font-bold text-white mb-1">��� DB ���ε�</div>
                  <div className="text-sm text-slate-200">����/CSV�� ��� �߰�</div>
                </div>
                <div className="text-2xl text-slate-300 self-end">��</div>
              </button>

              {/* ���� Ÿ�� ���� - �ݻ� */}
              <button 
                onClick={() => { setShowDirectTargeting(true); loadEnabledFields(); }}
                className="p-6 bg-amber-500 hover:bg-amber-600 rounded-xl transition-all hover:shadow-lg group text-right h-[140px] flex flex-col justify-between"
              >
                <div>
                  <div className="text-lg font-bold text-white mb-1">���� Ÿ�� ����</div>
                  <div className="text-sm text-amber-100">���ϴ� ����� ���� ���͸�</div>
                </div>
                <div className="text-2xl text-amber-200 self-end">��</div>
              </button>

              {/* AI ��õ �߼� - �ʷ� */}
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
                      <div className="text-lg font-bold text-white mb-1">AI �м� ��...</div>
                      <div className="text-sm text-green-200">��ø� ��ٷ��ּ���</div>
                    </div>
                    <div className="text-2xl text-green-300 self-end animate-pulse">?</div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-lg font-bold text-white mb-1">AI ��õ �߼�</div>
                      <div className="text-sm text-green-200">�ڿ���� AI�� �ڵ� ����</div>
                    </div>
                    <div className="text-2xl text-green-300 self-end">��</div>
                  </>
                )}
              </button>
            </div>

            {/* AI �ȳ����� */}
            <p className="text-xs text-gray-400 text-right mt-2 mb-0">
              AI�� �Ǽ��� �� �ֽ��ϴ�. �߼� �� �̸����⿡�� ������ �� Ȯ�����ּ���.
            </p>
          </div>
        </div>

        {/* �� */}
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
              1. Ÿ�� ����
            </button>
            <button
              onClick={() => setActiveTab('campaign')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'campaign'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              2. ķ���� ����
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'send'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              3. �߼�
            </button>
            </div>

            <div className="px-4 pt-1 pb-4">
             {/* Ÿ�� ���� �� */}
            {activeTab === 'target' && (
              <div>
{/* 5�� ��� ī�� */}
<div className="grid grid-cols-5 gap-4">
                  {/* �ֱ� ķ���� */}
                  <div onClick={() => { loadRecentCampaigns(); setShowRecentCampaigns(true); }} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <BarChart3 className="w-8 h-8 mx-auto mb-3 text-green-700" />
                    <div className="font-semibold text-gray-800 mb-1">�ֱ� ķ����</div>
                    <div className="text-xs text-gray-500 mb-3">�ֱ� �߼� ����</div>
                    <div className="text-xl font-bold text-green-700">{recentCampaigns.length}��</div>
                  </div>

                  {/* ��õ ���ø� */}
                  <div onClick={() => setShowTemplates(true)} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <FileText className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <div className="font-semibold text-gray-800 mb-1">��õ ���ø�</div>
                    <div className="text-xs text-gray-500 mb-3">��Ŭ�� ����</div>
                    <div className="text-xl font-bold text-amber-600">8��</div>
                  </div>

                  {/* ��� �λ���Ʈ */}
                  <div onClick={() => setShowInsights(true)} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <Users className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">��� �λ���Ʈ</div>
                    <div className="text-xs text-gray-500 mb-3">���׸�Ʈ ����</div>
                    <div className="text-xl font-bold text-green-700">5��</div>
                  </div>

                  {/* ������ ��� */}
                  <div onClick={() => setShowTodayStats(true)} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <Activity className="w-8 h-8 mx-auto mb-3 text-green-600" />
                    <div className="font-semibold text-gray-800 mb-1">������ ���</div>
                    <div className="text-xs text-gray-500 mb-3">�߼۷�/������</div>
                    <div className="text-xl font-bold text-green-700">{(stats?.monthly_sent || 0).toLocaleString()}��</div>
                  </div>

                  {/* ���� ��� */}
                  <div onClick={() => { loadScheduledCampaigns(); setShowScheduled(true); }} className="bg-white/50 shadow-sm rounded-xl p-6 min-h-[140px] cursor-pointer hover:shadow-lg transition-all text-center">
                    <Clock className="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <div className="font-semibold text-gray-800 mb-1">���� ���</div>
                    <div className="text-xs text-gray-500 mb-3">�� �߼۵� ķ����</div>
                    <div className="text-xl font-bold text-amber-600">{scheduledCampaigns.length}��</div>
                  </div>
                </div>
              </div>
            )}
            {/* ķ���� ���� �� */}
            {activeTab === 'campaign' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">ķ���� ����</h3>
                
                {/* ķ���� ���ؽ�Ʈ ǥ�� */}
                {campaignContext && (
                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <span className="text-sm text-purple-700">
                      ?? ������ ��ǥ: {campaignContext}
                    </span>
                  </div>
                )}

                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      ķ���θ� *
                    </label>
                    <input
                      type="text"
                      value={campaign.campaignName}
                      onChange={(e) => setCampaign({ ...campaign, campaignName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="��: 1�� VIP ���θ��"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      �޽��� ����
                    </label>
                    <select
                      value={campaign.messageType}
                      onChange={(e) => setCampaign({ ...campaign, messageType: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="SMS">SMS (�ܹ�)</option>
                      <option value="LMS">LMS (�幮)</option>
                      <option value="MMS">MMS (����)</option>
                      <option value="KAKAO">īī�� �˸���</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        �޽��� ���� *
                      </label>
                      <button
                        onClick={() => setShowAiMessage(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm font-medium flex items-center gap-1"
                      >
                        ? AI ���� ����
                      </button>
                    </div>
                    <textarea
                      value={campaign.messageContent}
                      onChange={(e) => setCampaign({ ...campaign, messageContent: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg h-32"
                      placeholder="�޽��� ������ �Է��ϼ���..."
                    />
                    <div className="text-right text-sm text-gray-500 mt-1">
                      {campaign.messageContent.length}/90�� (SMS ����)
                    </div>
                  </div>

                  {/* AI �޽��� ���� ��� */}
                  {showAiMessage && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                        <h4 className="text-lg font-semibold mb-4">? AI ���� ����</h4>
                        
                        {aiMessages.length === 0 ? (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              � �޽����� ������ ������ �������ּ���.
                            </p>
                            <textarea
                              value={aiPrompt || campaignContext}
                              onChange={(e) => setAiPrompt(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg h-24 mb-4"
                              placeholder="��: �ű� ��� ��� 20% ���� ���� �ȳ�"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setShowAiMessage(false);
                                  setAiPrompt('');
                                }}
                                className="flex-1 px-4 py-2 border rounded-lg text-gray-600"
                              >
                                ���
                              </button>
                              <button
                                onClick={handleAiGenerateMessage}
                                disabled={aiLoading}
                                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                              >
                                {aiLoading ? '���� ��...' : 'AI ���� ����'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              AI�� ������ ���� �� �ϳ��� �����ϼ���.
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
                                      ����: {msg.score}
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
                              �ٽ� �����ϱ�
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
                      <span className="text-sm text-gray-700">����� �޽��� (�տ� [����] �ڵ� �߰�)</span>
                    </label>
                  </div>

                  <button
                    onClick={handleCreateCampaign}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    ķ���� ����
                  </button>
                </div>
              </div>
            )}

            {/* �߼� �� */}
            {activeTab === 'send' && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">??</div>
                <h3 className="text-lg font-semibold mb-2">�߼� �غ� �Ϸ�</h3>
                <p className="text-gray-500 mb-6">
                  ķ���� ��Ͽ��� �߼��� ķ������ �����ϼ���
                </p>
                <button
                  onClick={() => alert('ķ���� ��� �������� �̵� (���� ����)')}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium"
                >
                  ķ���� �߼��ϱ�
                </button>
              </div>
            )}
          </div>
        </div>
{/* AI ķ���� ��� �˾� */}
{showAiResult && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className={`bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto ${aiStep === 2 ? 'w-[960px]' : 'w-[600px]'}`}>
              
              {/* ��� */}
              <div className="p-6 border-b bg-green-50">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span>?</span> AI ��õ ��� {aiStep === 1 ? '- Ÿ�� & ä��' : '- �޽��� & �߼�'}
                  </h3>
                  <button onClick={() => { setShowAiResult(false); setAiStep(1); }} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                </div>
              </div>

              {/* Step 1: Ÿ�� + ä�� ���� */}
              {aiStep === 1 && (
                <div className="p-6 space-y-6">
                  {/* Ÿ�� ��� */}
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600 mb-1">?? ����� Ÿ��</div>
                    <div className="font-semibold text-gray-800">{aiResult?.target?.description || '��õ Ÿ��'}</div>
<div className="text-blue-600 font-bold text-lg mt-1">{aiResult?.target?.count?.toLocaleString() || 0}��</div>
                  </div>

                  {/* ä�� ��õ */}
                  <div>
                    <div className="text-sm text-gray-600 mb-2">?? AI ��õ ä��</div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                    <div className="font-semibold text-purple-800">{aiResult?.recommendedChannel || 'SMS'} ��õ</div>
                    <div className="text-sm text-purple-600 mt-1">"{aiResult?.channelReason || '��õ ä���Դϴ�'}"</div>
                    </div>
{/* ����� ���� */}
<div className="flex items-center justify-between bg-yellow-50 rounded-lg p-4 mb-4">
                    <div>
                      <div className="font-semibold text-gray-800">?? ����� �޽���</div>
                      <div className="text-sm text-gray-500">
                        {isAd ? '(����) ǥ�� + ����źι�ȣ �ʼ� ����' : '�˸��� �޽��� (ǥ�� ���ʿ�)'}
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
                    <div className="text-sm text-gray-600 mb-2">ä�� ����</div>
                    <div className="grid grid-cols-4 gap-2">
                      {['SMS', 'LMS', 'MMS', 'īī��'].map((ch) => (
                        <button
                          key={ch}
                          onClick={() => setSelectedChannel(ch)}
                          className={`p-3 rounded-lg border-2 text-center font-medium transition-all ${
                            selectedChannel === ch
                              ? 'border-purple-500 bg-purple-50 text-purple-700'
                              : 'border-gray-200 hover:border-gray-300 text-gray-600'
                          }`}
                        >
                          {ch === 'SMS' && '?? '}
                          {ch === 'LMS' && '?? '}
                          {ch === 'MMS' && '??? '}
                          {ch === 'īī��' && '?? '}
                          {ch}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ���� ��ư */}
                  <button
                    onClick={handleAiGenerateChannelMessage}
                    disabled={aiLoading}
                    className="w-full py-4 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiLoading ? (
                      <>
                        <span className="animate-spin">?</span>
                        �޽��� ���� ��...
                      </>
                    ) : (
                      <>����: ���� ���� ��</>
                    )}
                  </button>
                </div>
              )}

              {/* Step 2: �޽��� + �߼۽ð� */}
              {aiStep === 2 && (
                <div className="p-6 space-y-6">
                  {/* ���õ� ä�� ǥ�� */}
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>���õ� ä��:</span>
                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
                  </div>

                  {/* �޽��� 3�� - ��� �� UI */}
                  <div>
                    <div className="text-sm text-gray-600 mb-3">?? {selectedChannel} �޽��� ��õ (��1)</div>
                    <div className="grid grid-cols-3 gap-5">
                      {aiResult?.messages?.length > 0 ? (
                        aiResult.messages.map((msg: any, idx: number) => (
                          <label key={msg.variant_id || idx} className="cursor-pointer group">
                            <input type="radio" name="message" className="hidden" defaultChecked={idx === 0} />
                            {/* ��� �� ������ */}
                            <div className="rounded-[1.8rem] p-[3px] transition-all bg-gray-300 group-has-[:checked]:bg-gradient-to-b group-has-[:checked]:from-purple-400 group-has-[:checked]:to-purple-600 group-has-[:checked]:shadow-lg group-has-[:checked]:shadow-purple-200 hover:bg-gray-400">
                              <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col" style={{ height: '420px' }}>
                                {/* ��� - Ÿ�Ը� */}
                                <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                                  <span className="text-[11px] text-gray-400 font-medium">���ڸ޽���</span>
                                  <span className="text-[11px] font-bold text-purple-600">{msg.variant_id}. {msg.variant_name}</span>
                                </div>
                                {/* �޽��� ���� - ��ũ�� */}
                                <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-purple-50/30 to-white">
                                  <div className="flex gap-2">
                                    <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 text-xs">??</div>
                                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[12px] leading-[1.6] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                                      {aiResult?.usePersonalization ? (() => {
                                        const sampleData: Record<string, string> = { '�̸�': '��μ�', '����Ʈ': '12,500', '���': 'VIP', '�����': '������', '����': '����', '���űݾ�': '350,000', '����Ƚ��': '8', '����ֹ��ݾ�': '43,750', 'LTV����': '85' };
                                        let text = msg.message_text || '';
                                        Object.entries(sampleData).forEach(([k, v]) => { text = text.replace(new RegExp(`%${k}%`, 'g'), v); });
                                        return text;
                                      })() : msg.message_text}
                                    </div>
                                  </div>
                                </div>
                                {/* �ϴ� ����Ʈ */}
                                <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                                  <span className="text-[10px] text-gray-400">{msg.byte_count || '?'} / {selectedChannel === 'SMS' ? 90 : 2000} bytes</span>
                                </div>
                              </div>
                            </div>
                          </label>
                        ))
                      ) : (
                        <div className="col-span-3 text-center py-8 text-gray-400">
                          �޽����� �ҷ����� ��...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* MMS �̹��� ÷�� */}
                  <div>
                    <div className="text-base font-semibold text-gray-700 mb-3">??? �̹��� ÷�� (MMS)</div>
                    <div
                      onClick={() => setShowMmsUploadModal(true)}
                      className="border-2 border-dashed border-gray-200 rounded-xl p-4 bg-gray-50/50 cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-all"
                    >
                      {mmsUploadedImages.length > 0 ? (
                        <div className="flex items-center gap-3">
                          {mmsUploadedImages.map((img, idx) => (
                            <img key={idx} src={img.url} alt="" className="w-16 h-16 object-cover rounded-lg border shadow-sm" crossOrigin="use-credentials" />
                          ))}
                          <div className="text-sm text-purple-600 font-medium">?? {mmsUploadedImages.length}�� ÷�ε� (Ŭ���Ͽ� ����)</div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-2">
                          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                            <span className="text-xl">??</span>
                          </div>
                          <div className="text-sm text-gray-500">Ŭ���Ͽ� �̹����� ÷���ϸ� MMS�� �߼۵˴ϴ�</div>
                          <div className="text-xs text-gray-400">JPG�� �� 300KB ���� �� �ִ� 3��</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* �߼۽ð� */}
                  <div>
                    <div className="text-base font-semibold text-gray-700 mb-4">? �߼۽ð�</div>
                    <div className="flex gap-3 items-stretch">
                      <label 
                        onClick={() => setSendTimeOption('ai')}
                        className={`flex-1 p-3 border-2 rounded-xl cursor-pointer text-center flex flex-col justify-center ${sendTimeOption === 'ai' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                      >
                        <div className="font-bold text-base">?? AI ��õ�ð�</div>
                        <div className="text-sm text-gray-500 mt-1">{aiResult?.recommendedTime || '���� �ð�'}</div>
                      </label>
                      <label 
                        onClick={() => setSendTimeOption('now')}
                        className={`flex-1 p-3 border-2 rounded-xl cursor-pointer text-center flex flex-col justify-center ${sendTimeOption === 'now' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                      >
                        <div className="font-bold text-base">? ��� �߼�</div>
                        <div className="text-sm text-gray-500 mt-1">���� �ٷ�</div>
                      </label>
                      <label 
                        onClick={() => setSendTimeOption('custom')}
                        className={`flex-[1.5] p-3 border-2 rounded-xl cursor-pointer text-center ${sendTimeOption === 'custom' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                      >
                        <div className="font-bold text-base mb-2">?? ���� ����</div>
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
                              <option value="AM">����</option>
                              <option value="PM">����</option>
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

{/* ȸ�Ź�ȣ ���� */}
<div>
  <div className="text-base font-semibold text-gray-700 mb-3">?? ȸ�Ź�ȣ</div>
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
      <option value="">ȸ�Ź�ȣ ����</option>
      <option value="__individual__">?? ����ȸ�Ź�ȣ (����� �����ȣ)</option>
      {callbackNumbers.map((cb) => (
        <option key={cb.id} value={cb.phone}>
          {cb.label || cb.phone} {cb.is_default && '(�⺻)'}
        </option>
      ))}
    </select>
    {useIndividualCallback && (
      <span className="text-sm text-blue-600">?? �� ����� ���̿���� ȸ�Ź�ȣ�� �߼�</span>
    )}
  </div>
</div>

{/* �ϴ� ��ư */}
{testSentResult && (
                    <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap mb-3 ${testSentResult.startsWith('?') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {testSentResult}
                    </div>
                  )}
                  <div className="flex gap-3 pt-4 border-t">
                    <button
                      onClick={() => setAiStep(1)}
                      className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center gap-2"
                    >
                      �� ä�κ���
                    </button>
                    <button
  onClick={handleTestSend}
  disabled={testSending || testCooldown}
  className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
>
{testSending ? '?? �߼� ��...' : testCooldown ? '? 10�� ���' : '?? ����� �׽�Ʈ'}
</button>
<button 
  onClick={() => setShowPreview(true)}
  className="flex-1 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
>
  ??? �̸�����
</button>
<button 
  onClick={handleAiCampaignSend}
  disabled={isSending}
  className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800 flex items-center justify-center gap-2"
>
{isSending ? '? �߼� ��...' : '?? �߼��ϱ�'}
</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* �̸����� ��� */}
        {showPreview && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className={`bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto ${aiStep === 2 ? 'w-[960px]' : 'w-[600px]'}`}>
              <div className="p-6 border-b bg-green-50">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">?? �߼� �̸�����</h3>
                  <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                {/* Ÿ�� ���� */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">?? �߼� ���</div>
                  <div className="font-semibold">{aiResult?.target?.description || 'Ÿ�� ���'}</div>
                  <div className="text-blue-600 font-bold">{aiResult?.target?.count?.toLocaleString() || 0}��</div>
                  {aiResult?.target?.unsubscribeCount > 0 && (
                    <div className="text-rose-500 text-sm mt-1">���Űź� ����: {aiResult?.target?.unsubscribeCount?.toLocaleString()}��</div>
                  )}
                </div>

                {/* ä�� */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">ä��:</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
                </div>

                {/* ȸ�Ź�ȣ */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">?? ȸ�Ź�ȣ:</span>
                  <span className="font-medium">
                    {useIndividualCallback ? '����ȸ�Ź�ȣ (����� ����)' : (selectedCallback || '�̼���')}
                  </span>
                </div>

                {/* �޽��� �̸����� - ����ȭ ���� */}
                <div>
                  <div className="text-sm text-gray-600 mb-2">?? �޽��� ����</div>
                  {aiResult?.usePersonalization && aiResult?.personalizationVars?.length > 0 ? (
                    <div>
                      <div className="text-xs text-purple-600 mb-2">? ����ȭ ���� ���� (���� 3�� ����)</div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { '�̸�': '��μ�', '����Ʈ': '12,500', '���': 'VIP', '�����': '������', '����': '����', '���űݾ�': '350,000', '����Ƚ��': '8', '����ֹ��ݾ�': '43,750', 'LTV����': '85' },
                          { '�̸�': '�̿���', '����Ʈ': '8,200', '���': 'GOLD', '�����': 'ȫ����', '����': '���', '���űݾ�': '180,000', '����Ƚ��': '5', '����ֹ��ݾ�': '36,000', 'LTV����': '62' },
                          { '�̸�': '������', '����Ʈ': '25,800', '���': 'VIP', '�����': '�λ꼾����', '����': '�λ�', '���űݾ�': '520,000', '����Ƚ��': '12', '����ֹ��ݾ�': '43,300', 'LTV����': '91' },
                        ].map((sample, idx) => {
                          let msg = aiResult?.messages?.[0]?.message_text || '';
                          Object.entries(sample).forEach(([varName, value]) => {
                            msg = msg.replace(new RegExp(`%${varName}%`, 'g'), value);
                          });
                          return (
                            <div key={idx} className="rounded-2xl border-2 border-gray-200 overflow-hidden bg-white">
                              <div className="bg-gray-100 px-3 py-1.5 text-xs text-gray-500 text-center">���� {idx + 1}</div>
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
                      {aiResult?.messages?.[0]?.message_text || '�޽��� ����'}
                    </div>
                  )}
                </div>

                {/* MMS �̹��� �̸����� */}
                {mmsUploadedImages.length > 0 && (
                  <div>
                    <div className="text-sm text-gray-600 mb-2">??? ÷�� �̹��� ({mmsUploadedImages.length}��)</div>
                    <div className="flex gap-3 mb-2">
                      {mmsUploadedImages.map((img, idx) => (
                        <img
                          key={idx}
                          src={img.url}
                          alt={`MMS ${idx + 1}`}
                          className="w-20 h-20 object-cover rounded-lg border shadow-sm"
                          crossOrigin="use-credentials"
                        />
                      ))}
                    </div>
                    <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
                      ?? ���� ���� ȭ���� ����� �� �޴��� ������ ���� �ٸ��� ���� �� �ֽ��ϴ�
                    </div>
                  </div>
                )}

                {/* �߼� �ð� */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">? �߼۽ð�:</span>
                  <span className="font-medium">
                    {sendTimeOption === 'ai' ? (aiResult?.recommendedTime || 'AI ��õ�ð�') : 
                     sendTimeOption === 'now' ? '��� �߼�' : 
                     customSendTime ? formatDateTime(customSendTime) : '���� ����'}
                  </span>
                </div>
              </div>

              <div className="p-6 border-t space-y-3">
                {testSentResult && (
                  <div className={`p-3 rounded-lg text-sm whitespace-pre-wrap mb-3 ${testSentResult.startsWith('?') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {testSentResult}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowPreview(false); setTestSentResult(null); }}
                    className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
                  >
                    �� ���ư���
                  </button>
                  <button
                    onClick={handleTestSend}
                    disabled={testSending || testCooldown}
                    className="flex-1 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                  >
                    {testSending ? '?? �߼� ��...' : testCooldown ? '? 10�� ���' : '?? ����� ��������'}
                  </button>
                  <button
                    onClick={() => {
                      const toast = document.createElement('div');
                      toast.innerHTML = `
                        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px 32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:9999;text-align:center;">
                          <div style="font-size:48px;margin-bottom:12px;">??</div>
                          <div style="font-size:16px;font-weight:bold;color:#374151;margin-bottom:8px;">�غ� ���� ����Դϴ�</div>
                          <div style="font-size:14px;color:#6B7280;">���������׽�Ʈ�� �� ������Ʈ�˴ϴ�</div>
                        </div>
                        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;" onclick="this.parentElement.remove()"></div>
                      `;
                      document.body.appendChild(toast);
                      setTimeout(() => toast.remove(), 2000);
                    }}
                    className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    ??? ��������
                  </button>
                  <button
                    onClick={handleAiCampaignSend}
                    disabled={isSending}
                    className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800"
                  >
                    {isSending ? '? �߼� ��...' : '?? �߼� Ȯ��'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* ķ���� Ȯ�� ���� ��� */}
        {showSuccess && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[400px] text-center p-8">
              <div className="text-6xl mb-4">??</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">ķ������ Ȯ���Ǿ����ϴ�!</h3>
               <div className="bg-green-50 rounded-lg p-4 mb-6 text-left">
               <div className="text-sm text-gray-600 space-y-1">
                  <div>?? ä��: <span className="font-medium">{selectedChannel}</span></div>
                  <div>?? ���: <span className="font-medium">{aiResult?.target?.count?.toLocaleString() || 0}��</span></div>
                  {aiResult?.target?.unsubscribeCount > 0 && (
                    <div>?? ���Űź� ����: <span className="font-medium text-rose-500">{aiResult?.target?.unsubscribeCount?.toLocaleString()}��</span></div>
                  )}
                  <div>? �߼�: <span className="font-medium">{successSendInfo}</span></div>
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
                  ?? Ķ���� Ȯ��
                </button>
                <button
                  onClick={() => setShowSuccess(false)}
                  className="flex-1 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800"
                >
                  Ȯ��
                </button>
              </div>
            </div>
          </div>
        )}
        {showResults && <ResultsModal onClose={() => setShowResults(false)} token={localStorage.getItem('token')} />}
        {showCustomerDB && <CustomerDBModal onClose={() => setShowCustomerDB(false)} token={localStorage.getItem('token')} />}
        {showCalendar && <CalendarModal onClose={() => setShowCalendar(false)} token={localStorage.getItem('token')} />}

        {/* MMS �̹��� ���ε� ��� */}
        {showMmsUploadModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
            <div className="bg-white rounded-2xl shadow-2xl w-[520px] overflow-hidden animate-in fade-in zoom-in">
              {/* ��� */}
              <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xl">???</span>
                  <h3 className="font-bold text-lg text-gray-800">MMS �̹��� ÷��</h3>
                </div>
                <button onClick={() => setShowMmsUploadModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">?</button>
              </div>

              {/* �԰� �ȳ� */}
              <div className="px-6 py-3 bg-blue-50 border-b">
                <div className="text-sm font-semibold text-blue-700 mb-1">?? �̹��� �԰� �ȳ�</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-600">
                  <div>? ���� ����: <span className="font-bold">JPG/JPEG��</span> ����</div>
                  <div>? �ִ� �뷮: <span className="font-bold">300KB ����</span> (����� ����)</div>
                  <div>? �ִ� ���: <span className="font-bold">3��</span> (����� ����)</div>
                  <div>? PNG/GIF: ����� ���� ���� (������)</div>
                </div>
              </div>

              {/* 3ĭ ���� */}
              <div className="p-6">
                <div className="grid grid-cols-3 gap-4">
                  {[0, 1, 2].map(slotIdx => {
                    const img = mmsUploadedImages[slotIdx];
                    return (
                      <div key={slotIdx} className="aspect-square relative">
                        {img ? (
                          /* ���ε� �Ϸ� ���� */
                          <div className="w-full h-full rounded-xl border-2 border-green-300 bg-green-50 overflow-hidden relative group">
                            <img
                              src={img.url}
                              alt={`�̹��� ${slotIdx + 1}`}
                              className="w-full h-full object-cover"
                              crossOrigin="use-credentials"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                              <button
                                onClick={() => handleMmsImageRemove(slotIdx)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg"
                              >��</button>
                            </div>
                            <div className="absolute bottom-1 right-1 bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                              {(img.size / 1024).toFixed(0)}KB
                            </div>
                            <div className="absolute top-1 left-1 bg-green-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                              {slotIdx + 1}
                            </div>
                          </div>
                        ) : (
                          /* �� ���� */
                          <label className={`w-full h-full rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-all ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="text-3xl text-gray-300 mb-2">+</div>
                            <div className="text-xs text-gray-400 font-medium">�̹��� {slotIdx + 1}</div>
                            <div className="text-[10px] text-gray-300 mt-1">JPG �� 300KB</div>
                            <input
                              type="file"
                              accept=".jpg,.jpeg"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleMmsSlotUpload(file, slotIdx);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                {mmsUploading && (
                  <div className="flex items-center justify-center gap-2 mt-4 text-sm text-amber-600">
                    <span className="animate-spin">?</span> �̹��� ���ε� ��...
                  </div>
                )}
              </div>

              {/* �ȳ� + Ȯ�� */}
              <div className="px-6 pb-6 space-y-3">
                <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3 text-center">
                  ?? ���� ���� ȭ���� ����� �� �޴��� ������ ���� �ٸ��� ���� �� �ֽ��ϴ�
                </div>
                <button
                  onClick={() => {
                    setShowMmsUploadModal(false);
                    // �̹����� ������ �ڵ� MMS ��ȯ
                    if (mmsUploadedImages.length > 0) {
                      setTargetMsgType('MMS');
                      setDirectMsgType('MMS');
                      setSelectedChannel('MMS');
                    }
                  }}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors"
                >
                  {mmsUploadedImages.length > 0 ? `? ${mmsUploadedImages.length}�� ÷�� �Ϸ�` : 'Ȯ��'}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* �ֱ� ķ���� ��� */}
        {showRecentCampaigns && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-hidden">
              <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">?? �ֱ� ķ����</h3>
                <button onClick={() => setShowRecentCampaigns(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
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
                            {c.status === 'completed' ? '�Ϸ�' : c.status === 'scheduled' ? '����' : c.status === 'sending' ? '�߼���' : c.status === 'cancelled' ? '���' : '�غ�'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 space-y-1">
                          <div>
                            {c.send_type === 'direct' ? '??' : '??'} 
                            <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${c.send_type === 'direct' ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700'}`}>
                              {c.send_type === 'direct' ? '����' : 'AI'}
                            </span>
                            <span className="ml-2">?? {c.message_type} �� ?? {c.target_count?.toLocaleString()}��</span>
                          </div>
                          <div>? ���� {c.success_count?.toLocaleString() || 0} �� ? ���� {c.fail_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">{formatDateTime(c.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">�ֱ� ķ������ �����ϴ�</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ��õ ���ø� ��� */}
        {showTemplates && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b bg-purple-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">?? ��õ ���ø�</h3>
                <button onClick={() => setShowTemplates(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-2 gap-4">
                  <div onClick={() => { setAiCampaignPrompt('VIP ������� ���� �λ� ���� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">VIP ���� �λ�</div>
                    <div className="text-sm text-gray-500">VIP ������� ���� �޽��� �߼�</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('������ ������� ���� ���� ���� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">���� ����</div>
                    <div className="text-sm text-gray-500">���� ������� ���� ���� �߼�</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('�Ż�ǰ ��� �ȳ� ���� ��ü ������� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">�Ż�ǰ �ȳ�</div>
                    <div className="text-sm text-gray-500">�Ż�ǰ ��� �ҽ� ��ü �߼�</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('30�� ���� ������� �� ���� ���� �̺�Ʈ ���� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">���� ����</div>
                    <div className="text-sm text-gray-500">Ÿ�� ��� ���� ���θ��</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('3���� �̻� �̱��� ������� ��湮 ���� ���� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">��湮 ����</div>
                    <div className="text-sm text-gray-500">�޸� ��� Ȱ��ȭ</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('����Ʈ �Ҹ� ���� ������� ��� �ȳ� ���� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">����Ʈ �Ҹ� �ȳ�</div>
                    <div className="text-sm text-gray-500">����Ʈ ���� �� �˸�</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('���� ���� ��� �ȳ� ���� ��ü ������� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">��� �ȳ�</div>
                    <div className="text-sm text-gray-500">����/�̺�Ʈ ��� ����</div>
                  </div>
                  <div onClick={() => { setAiCampaignPrompt('����ũ�� �����ϴ� ������� 1+1 �̺�Ʈ ���� ������'); setShowTemplates(false); }} className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="font-semibold text-gray-800 mb-1">1+1 �̺�Ʈ</div>
                    <div className="text-sm text-gray-500">ī�װ���� ���θ��</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
                            {/* ���� ���ε� ķ���� ��� */}
        {/* ���� Ÿ�� ���� ��� */}
        {showDirectTargeting && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[95vh] overflow-hidden">
              {/* ��� */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">���� Ÿ�� ����</h3>
                  <p className="text-sm text-gray-500 mt-0.5">���� �������� ��� ����� �����ϼ���</p>
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

              {/* ���� ���� */}
              <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
                {/* ���Ź�ȣ �ʵ� ���� */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">���Ź�ȣ �ʵ�</label>
                  <select 
                    value={targetPhoneField}
                    onChange={(e) => setTargetPhoneField(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white text-gray-700"
                  >
                    <option value="phone">phone (��ȭ��ȣ)</option>
                    <option value="mobile">mobile</option>
                    <option value="phone_number">phone_number</option>
                  </select>
                </div>

                <div className="border-t border-gray-100"></div>

                {/* ���� ���� ��� */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">���� ����</span>
                    {Object.keys(targetFilters).length > 0 && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        {Object.values(targetFilters).filter(v => v).length}�� ����
                      </span>
                    )}
                  </div>
                  <button onClick={resetTargetFilters} className="text-xs text-green-600 hover:text-green-700 font-medium">�ʱ�ȭ</button>
                </div>

                {/* ���ڵ�� ���� */}
                {enabledFields.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    ���� �׸��� �ε� ��...
                  </div>
                ) : (
                  (() => {
                    const CAT_LABELS: Record<string, string> = {
                      basic: '?? �⺻����', segment: '??? ���/���׸�Ʈ', purchase: '?? ����/�ŷ�',
                      loyalty: '? �漺��/Ȱ��', store: '?? �Ҽ�/ä��', preference: '?? ��ȣ/����',
                      marketing: '?? �����ü���', custom: '?? Ŀ����'
                    };
                    // ���� ��󿡼� ������ �ʵ� (�ĺ���/���ŵ��Ǵ� ���� ó��)
                    const SKIP_FIELDS = ['name', 'phone', 'email', 'address', 'opt_in_sms', 'opt_in_date', 'opt_out_date'];
                    const filterableFields = enabledFields.filter((f: any) => !SKIP_FIELDS.includes(f.field_key));
                    
                    // ���ɴ� ������
                    const AGE_OPTIONS = [
                      { label: '20��', value: '20' }, { label: '30��', value: '30' },
                      { label: '40��', value: '40' }, { label: '50��', value: '50' },
                      { label: '60�� �̻�', value: '60' },
                    ];
                    // �ݾ� ������
                    const AMOUNT_OPTIONS = [
                      { label: '5���� �̻�', value: '50000' }, { label: '10���� �̻�', value: '100000' },
                      { label: '50���� �̻�', value: '500000' }, { label: '100���� �̻�', value: '1000000' },
                      { label: '500���� �̻�', value: '5000000' },
                    ];
                    // �ϼ� ������
                    const DAYS_OPTIONS = [
                      { label: '7�� �̳�', value: '7' }, { label: '30�� �̳�', value: '30' },
                      { label: '90�� �̳�', value: '90' }, { label: '180�� �̳�', value: '180' },
                      { label: '1�� �̳�', value: '365' },
                    ];

                    const renderInput = (field: any) => {
                      const val = targetFilters[field.field_key] || '';
                      const set = (v: string) => setTargetFilters(prev => {
                        if (!v) { const next = {...prev}; delete next[field.field_key]; return next; }
                        return {...prev, [field.field_key]: v};
                      });
                      const selectClass = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm bg-white";

                      // ���ɴ� Ư�� ó��
                      if (field.field_key === 'age_group') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">��ü</option>
                            {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // ���ڿ� + DB �ɼ� �� ��Ӵٿ�
                      if (field.data_type === 'string' && filterOptions[field.field_key]?.length) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">��ü</option>
                            {filterOptions[field.field_key].map((opt: string) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        );
                      }

                      // �ݾ� �ʵ� �� ������ ��Ӵٿ�
                      if (field.data_type === 'number' && ['total_purchase_amount', 'avg_order_value'].includes(field.field_key)) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">��ü</option>
                            {AMOUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // ���� �ʵ� �� ���� �Է�
                      if (field.data_type === 'number') {
                        return (
                          <input type="number" value={val} onChange={e => set(e.target.value)}
                            placeholder="�̻�" className={selectClass} />
                        );
                      }

                      // ��¥ �ʵ� �� �ϼ� ��Ӵٿ�
                      if (field.data_type === 'date') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">��ü</option>
                            {DAYS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // �Ҹ���
                      if (field.data_type === 'boolean') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">��ü</option>
                            <option value="true">��</option>
                            <option value="false">�ƴϿ�</option>
                          </select>
                        );
                      }

                      // �⺻: �ؽ�Ʈ �Է�
                      return (
                        <input type="text" value={val} onChange={e => set(e.target.value)}
                          placeholder="�Է�" className={selectClass} />
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

                {/* ���ŵ��� */}
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input 
                    type="checkbox" 
                    id="targetSmsOptIn" 
                    checked={targetSmsOptIn}
                    onChange={(e) => setTargetSmsOptIn(e.target.checked)}
                    className="w-4 h-4 text-green-600 rounded focus:ring-green-500" 
                  />
                  <label htmlFor="targetSmsOptIn" className="text-sm text-gray-700">���ŵ��� ����� ����</label>
                </div>

                {/* ��ȸ ��ư */}
                <button
                  onClick={loadTargetCount}
                  disabled={targetCountLoading}
                  className="w-full py-2.5 border border-green-600 text-green-700 rounded-lg hover:bg-green-50 transition-colors font-medium disabled:opacity-50"
                >
                  {targetCountLoading ? '��ȸ ��...' : '��� �ο� ��ȸ'}
                </button>
              </div>

              {/* Ǫ�� - ��� �ο� + ��ư */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">��� �ο�</div>
                      <div className="text-2xl font-bold text-green-700">
                        {targetCountLoading ? '...' : targetCount.toLocaleString()}
                        <span className="text-base font-normal text-gray-500 ml-1">��</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                      className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                    >
                      ���
                    </button>
                    <button
                      onClick={handleTargetExtract}
                      disabled={targetCount === 0}
                      className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Users className="w-4 h-4" />
                      Ÿ�� ����
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
              
              {/* Step 1: ���� ���ε� */}
              {mappingStep === 'upload' && (
                <>
                  <div className="p-4 border-b bg-gradient-to-r from-green-50 to-emerald-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span>??</span> ���� ���ε� ķ���� ����
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
                    }} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
                    {!fileHeaders.length ? (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-400 transition-colors relative">
                        {fileUploading && (
                          <div className="absolute inset-0 bg-white bg-opacity-90 flex flex-col items-center justify-center rounded-xl z-10">
                            <div className="text-4xl mb-4 animate-bounce">??</div>
                            <div className="text-lg font-semibold text-green-600">���� �м� ��...</div>
                            <div className="text-sm text-gray-500 mt-2">��ø� ��ٷ��ּ���</div>
                          </div>
                        )}
                        <div className="text-4xl mb-4">??</div>
                        <p className="text-gray-600 mb-2">���� �Ǵ� CSV ������ �巡���ϰų� Ŭ���Ͽ� ���ε�</p>
                        <p className="text-sm text-gray-400 mb-4">���� ����: .xlsx, .xls, .csv</p>
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
                                  alert(data.error || '���� ó�� ����');
                                }
                              } catch (err) {
                                alert('���� ���ε� �� ������ �߻��߽��ϴ�.');
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
                          {fileUploading ? '? ���� �м� ��...' : '���� ����'}
                        </label>
                        <div className="mt-6 bg-gray-50 rounded-lg p-4 text-left">
                          <h4 className="font-semibold text-gray-700 mb-2">?? ���ε� �ȳ�</h4>
                          <ul className="text-sm text-gray-600 space-y-1">
                            <li>? ù ��° ���� �÷������� �νĵ˴ϴ�</li>
                            <li>? ��ȭ��ȣ �÷��� �ʼ��Դϴ�</li>
                            <li>? AI�� �ڵ����� �÷��� �����մϴ�</li>
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">??</span>
                            <div>
                              <div className="font-semibold text-gray-800">{uploadedFile?.name}</div>
                              <div className="text-sm text-gray-500">�� {fileTotalRows.toLocaleString()}���� ������</div>
                            </div>
                          </div>
                          <button onClick={() => { setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); }} className="text-gray-400 hover:text-red-500">? �ٽ� ����</button>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-3">?? ������ �÷� ({fileHeaders.length}��)</h4>
                          <div className="flex flex-wrap gap-2">
                            {fileHeaders.map((h, i) => (
                              <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">{h}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-3">?? ������ �̸����� (���� 5��)</h4>
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
                                alert(data.error || '���� ����');
                              }
                            } catch (err) {
                              alert('���� �� ������ �߻��߽��ϴ�.');
                            } finally {
                              setFileUploading(false);
                            }
                          }}
                          disabled={fileUploading}
                          className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 flex items-center justify-center gap-2 text-lg disabled:opacity-50"
                        >
                          {fileUploading ? (<><span className="animate-spin">?</span>AI�� �÷��� �м��ϰ� �ֽ��ϴ�...</>) : (<><span>??</span>AI �ڵ� ���� ����</>)}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Step 2: AI ���� ��� */}
              {mappingStep === 'mapping' && (
                <>
                  <div className="p-4 border-b bg-green-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span>??</span> AI ���� ���
                    </h3>
                    <button onClick={() => { setShowFileUpload(false); setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); setMappingStep('upload'); setColumnMapping({}); }} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-center gap-3">
                      <span className="text-2xl">??</span>
                      <div className="text-center">
                        <div className="font-semibold text-gray-800">{uploadedFile?.name}</div>
                        <div className="text-sm text-gray-500">�� {fileTotalRows.toLocaleString()}���� ������</div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-700 mb-3">?? �÷� ���� (���� ����)</h4>
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {Object.entries(columnMapping).map(([header, dbCol]) => (
                          <div key={header} className="grid grid-cols-[1fr_40px_1fr] items-center p-3 bg-white rounded-lg border gap-2">
                          <span className="text-sm font-medium text-gray-700">{header}</span>
                          <span className="text-gray-400 text-center">��</span>
                          <select
                            value={dbCol || ''}
                            onChange={(e) => setColumnMapping({...columnMapping, [header]: e.target.value || null})}
                            className={`px-3 py-2 rounded-lg border text-sm w-full ${dbCol ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-300'}`}
                          >
                              <option value="">���� ����</option>
                              <option value="phone">?? ��ȭ��ȣ</option>
                              <option value="name">?? �̸�</option>
                              <option value="gender">? ����</option>
                              <option value="birth_year">?? �������</option>
                              <option value="birth_month_day">?? ����(��-��)</option>
                              <option value="birth_date">?? ������� ��ü</option>
                              <option value="grade">? ���</option>
                              <option value="region">?? ����</option>
                              <option value="sms_opt_in">? ���ŵ���</option>
                              <option value="email">?? �̸���</option>
                              <option value="total_purchase">?? �ѱ��ž�</option>
                              <option value="last_purchase_date">?? �ֱٱ�����</option>
                              <option value="purchase_count">?? ����Ƚ��</option>
                              <option value="callback">?? ȸ�Ź�ȣ(�����ȣ)</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                    {!Object.values(columnMapping).includes('phone') && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 flex items-center gap-2">
                        <span>??</span>
                        <span>��ȭ��ȣ �÷��� �������ּ��� (�ʼ�)</span>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button onClick={() => setMappingStep('upload')} className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50">�� ����</button>
                      <button
                        onClick={async () => {
                          setUploadProgress({ total: 0, processed: 0, percent: 0 });
                          
                          // ����� ���� ����
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
                                alert(data.error || '���� ����');
                              }
                            }
                          } catch (err) {
                            clearInterval(progressInterval);
                            alert('���� �� ������ �߻��߽��ϴ�.');
                          } finally {
                            setFileUploading(false);
                          }
                        }}
                        disabled={!Object.values(columnMapping).includes('phone') || fileUploading}
                        className="flex-1 py-4 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {fileUploading ? (
                          <>
                            <span className="animate-spin">?</span>
                            ���� ��... {uploadProgress.percent > 0 ? `${uploadProgress.percent}%` : '�غ� ��'}
                          </>
                        ) : (
                          <>
                            <span>??</span>
                            ��� ������ ���� ({fileTotalRows.toLocaleString()}��)
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
        {/* ��� �λ���Ʈ ��� */}
        {showInsights && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden">
              <div className="p-4 border-b bg-green-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">?? ��� �λ���Ʈ</h3>
                <button onClick={() => setShowInsights(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[80vh] space-y-6">
                {/* ��ü ��� */}
                <div className="p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl text-center">
                  <div className="text-sm text-gray-500 mb-2">��ü ���</div>
                  <div className="text-4xl font-bold text-gray-800">{parseInt(stats?.total || '0').toLocaleString()}��</div>
                  <div className="text-sm text-green-600 mt-2">���ŵ���: {parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}��</div>
                </div>

                {/* ������ ��Ȳ */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">������ ��Ȳ</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg text-center">
                      <div className="text-2xl mb-2">??</div>
                      <div className="text-2xl font-bold text-blue-600">{parseInt(stats?.male_count || '0').toLocaleString()}��</div>
                      <div className="text-xs text-gray-500 mt-1">����</div>
                    </div>
                    <div className="p-4 bg-pink-50 rounded-lg text-center">
                      <div className="text-2xl mb-2">??</div>
                      <div className="text-2xl font-bold text-pink-600">{parseInt(stats?.female_count || '0').toLocaleString()}��</div>
                      <div className="text-xs text-gray-500 mt-1">����</div>
                    </div>
                  </div>
                </div>

                {/* ���ɴ뺰 ������� */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">���ɴ뺰 �������</div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-purple-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-purple-600">{parseInt(stats?.age_under20 || '0').toLocaleString()}��</div>
                        <div className="text-xs text-gray-500 mt-1">~19��</div>
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-indigo-600">{parseInt(stats?.age_20s || '0').toLocaleString()}��</div>
                        <div className="text-xs text-gray-500 mt-1">20��</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-cyan-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-cyan-600">{parseInt(stats?.age_30s || '0').toLocaleString()}��</div>
                        <div className="text-xs text-gray-500 mt-1">30��</div>
                      </div>
                      <div className="p-4 bg-teal-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-teal-600">{parseInt(stats?.age_40s || '0').toLocaleString()}��</div>
                        <div className="text-xs text-gray-500 mt-1">40��</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-orange-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-orange-600">{parseInt(stats?.age_50s || '0').toLocaleString()}��</div>
                        <div className="text-xs text-gray-500 mt-1">50��</div>
                      </div>
                      <div className="p-4 bg-red-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-red-600">{parseInt(stats?.age_60plus || '0').toLocaleString()}��</div>
                        <div className="text-xs text-gray-500 mt-1">60�� �̻�</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* �����޺� ��Ȳ */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">�����޺� ��Ȳ</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-yellow-50 rounded-lg text-center">
                      <div className="text-2xl mb-2">?</div>
                      <div className="text-2xl font-bold text-yellow-600">{parseInt(stats?.vip_count || '0').toLocaleString()}��</div>
                      <div className="text-xs text-gray-500 mt-1">VIP</div>
                    </div>
                    <div className="p-4 bg-gray-100 rounded-lg text-center">
                      <div className="text-2xl mb-2">??</div>
                      <div className="text-2xl font-bold text-gray-600">{(parseInt(stats?.total || '0') - parseInt(stats?.vip_count || '0')).toLocaleString()}��</div>
                      <div className="text-xs text-gray-500 mt-1">�Ϲ�</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ������ ��� ��� */}
        {showTodayStats && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b bg-orange-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">?? �̹� �� ���</h3>
                <button onClick={() => setShowTodayStats(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
                {/* ��� ��� ī�� */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl text-center">
                    <div className="text-sm text-gray-500 mb-2">�̹� �� �� �߼�</div>
                    <div className="text-4xl font-bold text-orange-600">{(stats?.monthly_sent || 0).toLocaleString()}��</div>
                  </div>
                  <div className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl text-center">
                    <div className="text-sm text-gray-500 mb-2">�̹� �� ���ݾ�</div>
                    <div className="text-4xl font-bold text-green-600">{(stats?.monthly_cost || 0).toLocaleString()}��</div>
                    <div className="text-xs text-gray-400 mt-1">����: {(stats?.monthly_budget || 0).toLocaleString()}��</div>
                  </div>
                </div>

                {/* �� ��ǥ */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg text-center">
                    <div className="text-2xl mb-2">?</div>
                    <div className="text-2xl font-bold text-blue-600">{stats?.success_rate || '0'}%</div>
                    <div className="text-xs text-gray-500">��� ������</div>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg text-center">
                    <div className="text-2xl mb-2">??</div>
                    <div className="text-2xl font-bold text-purple-600">{recentCampaigns.length}��</div>
                    <div className="text-xs text-gray-500">����� ķ����</div>
                  </div>
                </div>

                {/* ä�κ� ��� */}
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">ä�κ� �߼�</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">?? SMS</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.sms_sent || 0).toLocaleString()}��</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_sms || 9.9}��)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">?? LMS</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.lms_sent || 0).toLocaleString()}��</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_lms || 27}��)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">??? MMS</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.mms_sent || 0).toLocaleString()}��</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_mms || 50}��)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <span className="font-medium">?? īī����</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-700">{(stats?.kakao_sent || 0).toLocaleString()}��</span>
                        <span className="text-xs text-gray-400 ml-2">(@{stats?.cost_per_kakao || 7.5}��)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
{/* ���ε� ��� ��� */}
{showUploadResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="text-6xl mb-4">??</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">���� �Ϸ�!</h3>
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">�ű� �߰�</span>
                  <span className="font-bold text-blue-600">{uploadResult.insertCount.toLocaleString()}��</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">������Ʈ</span>
                  <span className="font-bold text-green-600">{uploadResult.duplicateCount.toLocaleString()}��</span>
                </div>
              </div>
              <button
                onClick={() => { setShowUploadResult(false); window.location.reload(); }}
                className="w-full py-3 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
              >
                Ȯ��
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* �÷� �ʰ� ���� ��� */}
      {showPlanLimitError && planLimitInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-red-50 to-orange-50 border-b">
              <div className="text-center">
                <div className="text-5xl mb-3">??</div>
                <h3 className="text-xl font-bold text-gray-800">��� DB �ѵ� �ʰ�</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">���� �÷�</span>
                  <span className="font-semibold text-gray-800">{planLimitInfo.planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">�ִ� ��� ��</span>
                  <span className="font-semibold text-gray-800">{Number(planLimitInfo.maxCustomers).toLocaleString()}��</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">���� ��� ��</span>
                  <span className="font-semibold text-blue-600">{Number(planLimitInfo.currentCount).toLocaleString()}��</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">���ε� �õ�</span>
                  <span className="font-semibold text-orange-600">+{Number(planLimitInfo.requestedCount).toLocaleString()}��</span>
                </div>
                <div className="border-t pt-3 flex justify-between">
                  <span className="text-gray-600">�߰� ����</span>
                  <span className="font-bold text-red-600">{Number(planLimitInfo.availableCount).toLocaleString()}��</span>
                </div>
              </div>
              <p className="text-sm text-gray-600 text-center mb-4">
                �÷��� ���׷��̵��Ͻø� �� ���� ����� ������ �� �ֽ��ϴ�.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPlanLimitError(false)}
                  className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
                >
                  �ݱ�
                </button>
                <button
                  onClick={() => {
                    setShowPlanLimitError(false);
                    navigate('/pricing');
                  }}
                  className="flex-1 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800"
                >
                  ����� �ȳ�
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        {/* ���� ��� ��� */}
        {showScheduled && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] overflow-hidden">
              <div className="p-4 border-b bg-red-50 flex justify-between items-center">
                <h3 className="font-bold text-lg">? ���� ��� {scheduledCampaigns.length > 0 && `(${scheduledCampaigns.length}��)`}</h3>
                <button onClick={() => { setShowScheduled(false); setSelectedScheduled(null); }} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
              </div>
              <div className="flex h-[70vh]">
                {/* ����: ķ���� ��� */}
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
                          ?? {c.message_type} �� ?? {c.target_count?.toLocaleString()}��
                        </div>
                        <div className="text-xs text-blue-600 mt-1">
                          ? {c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500 text-center py-8 text-sm">����� ķ������ �����ϴ�</p>
                  )}
                </div>
                
                {/* ����: �� & ������ */}
                <div className="flex-1 flex flex-col">
                  {selectedScheduled ? (
                    <>
                      {/* ���: ķ���� ���� */}
                      <div className="p-4 border-b bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-bold text-lg">{selectedScheduled.campaign_name}</div>
                            <div className="text-sm text-gray-500 mt-1">
                              {selectedScheduled.message_type} �� {selectedScheduled.target_count?.toLocaleString()}��
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
                                  setToast({ show: true, type: 'success', message: '������ ��ҵǾ����ϴ�' });
                                  setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                                  setScheduledCampaigns(prev => prev.filter(c => c.id !== selectedScheduled.id));
                                  setSelectedScheduled(null);
                                } else {
                                  setToast({ show: true, type: 'error', message: data.error || '��� ����' });
                                  setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                                }
                              }}
                              disabled={selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000}
                              className={`px-3 py-1.5 rounded text-sm ${
                                selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000
                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                  : 'bg-red-500 text-white hover:bg-red-600'
                              }`}
                            >�������</button>
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
                            >���ȼ���</button>
                          </div>
                        </div>
                        {/* ���� �ð� ���� */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">����ð�:</span>
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
                                setToast({ show: true, type: 'success', message: '���� �ð��� ����Ǿ����ϴ�' });
                                setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                                setScheduledCampaigns(prev => prev.map(c => 
                                  c.id === selectedScheduled.id ? { ...c, scheduled_at: editScheduleTime } : c
                                ));
                                setSelectedScheduled({ ...selectedScheduled, scheduled_at: editScheduleTime });
                              } else {
                                setToast({ show: true, type: 'error', message: data.error || '���� ����' });
                                setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                              }
                            }}
                            disabled={selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000}
                            className={`px-3 py-1 rounded text-sm ${
                              selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                            >�ð�����</button>
                            {selectedScheduled?.scheduled_at && (new Date(selectedScheduled.scheduled_at).getTime() - Date.now()) < 15 * 60 * 1000 && (
                              <span className="text-xs text-amber-600 ml-2">?? 15�� �̳� ���� �Ұ�</span>
                            )}
                          </div>
                        </div>
                      
                      {/* ������ �˻� */}
                      <div className="p-3 border-b flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="?? ��ȣ �˻�"
                          value={scheduledSearch}
                          onChange={(e) => setScheduledSearch(e.target.value)}
                          className="flex-1 border rounded px-3 py-2 text-sm"
                        />
                        <span className="text-sm text-gray-500">
                          �� {scheduledRecipientsTotal.toLocaleString()}��
                          {scheduledRecipientsTotal > 1000 && ' (�ִ� 1000�� ǥ��)'}
                        </span>
                      </div>
                      
                      {/* ������ ��� */}
                      <div className="flex-1 overflow-y-auto">
                        {scheduledLoading ? (
                          <div className="flex items-center justify-center h-full text-gray-500">
                            <span className="animate-spin mr-2">?</span> �ε���...
                          </div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left">��ȣ</th>
                                <th className="px-3 py-2 text-left">ȸ�Ź�ȣ</th>
                                <th className="px-3 py-2 text-center">�޽���</th>
                                <th className="px-3 py-2 text-center w-16">����</th>
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
                                      >�󼼺���</button>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        onClick={() => setDeleteConfirm({show: true, phone: r.phone, idx: r.idx})}
                                        className="text-red-500 hover:text-red-700"
                                      >???</button>
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
                      �� ķ������ �����ϼ���
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* ���� Ȯ�� ��� */}
            {deleteConfirm.show && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[360px] overflow-hidden">
                  <div className="p-6 text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">???</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">������ ����</h3>
                    <p className="text-gray-600 mb-1">���� ��ȣ�� �����Ͻðڽ��ϱ�?</p>
                    <p className="text-xl font-bold text-red-600 mb-4">{deleteConfirm.phone}</p>
                    <p className="text-sm text-gray-400">������ ��ȣ�� �� ���࿡�� �߼۵��� �ʽ��ϴ�.</p>
                  </div>
                  <div className="flex border-t">
                    <button
                      onClick={() => setDeleteConfirm({show: false, phone: '', idx: null})}
                      className="flex-1 py-3.5 text-gray-600 hover:bg-gray-50 font-medium transition-colors"
                    >���</button>
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
                          setToast({ show: true, type: 'success', message: '�����Ǿ����ϴ�' });
                          setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                        } else {
                          setToast({ show: true, type: 'error', message: data.error || '���� ����' });
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
                    >����</button>
                  </div>
                </div>
              </div>
            )}
            {/* �޽��� �󼼺��� ��� */}
            {messagePreview.show && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-bold text-blue-700">?? �޽��� ����</h3>
                      <p className="text-sm text-blue-600 mt-1">{messagePreview.phone}</p>
                    </div>
                    <button 
                      onClick={() => setMessagePreview({show: false, phone: '', message: ''})}
                      className="text-gray-500 hover:text-gray-700 text-xl"
                    >?</button>
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
                    >Ȯ��</button>
                  </div>
                </div>
              </div>
            )}
            {/* ���� ���� ��� */}
            {messageEditModal && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
                  <div className="p-4 border-b bg-amber-50">
                    <h3 className="text-lg font-bold text-amber-700">?? ���� ����</h3>
                    <p className="text-sm text-amber-600 mt-1">����: %�̸�%, %���%, %����%, %ȸ�Ź�ȣ%</p>
                  </div>
                  <div className="p-4 space-y-4">
                    {(selectedScheduled?.message_type === 'LMS' || selectedScheduled?.message_type === 'MMS') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">����</label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2"
                          placeholder="���� �Է�"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">�޽��� ����</label>
                      <textarea
                        value={editMessage}
                        onChange={(e) => setEditMessage(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 h-40 resize-none"
                        placeholder="�޽��� ���� �Է�"
                      />
                      <div className="text-right text-sm text-gray-500 mt-1">
                        {new TextEncoder().encode(editMessage).length} bytes
                      </div>
                    </div>
                    {messageEditing && (
                      <div className="bg-blue-50 rounded-lg p-3">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-blue-700">���� ��...</span>
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
                    >���</button>
                    <button
                      onClick={async () => {
                        if (!editMessage.trim()) {
                          setToast({ show: true, type: 'error', message: '�޽����� �Է����ּ���' });
                          setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                          return;
                        }
                        
                        setMessageEditing(true);
                        setMessageEditProgress(0);
                        
                        // ����� ����
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
                            setToast({ show: true, type: 'success', message: data.message || `${data.updatedCount?.toLocaleString()}�� ���� ���� �Ϸ�` });
                            setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                            setMessageEditModal(false);
                            // ķ���� ���� ������Ʈ
                            setSelectedScheduled({ ...selectedScheduled, message_template: editMessage, message_subject: editSubject });
                          } else {
                            setToast({ show: true, type: 'error', message: data.error || '���� ����' });
                            setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                          }
                        } catch (err) {
                          clearInterval(progressInterval);
                          setToast({ show: true, type: 'error', message: '���� ����' });
                          setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                        } finally {
                          setMessageEditing(false);
                        }
                      }}
                      disabled={messageEditing}
                      className="flex-1 py-3.5 bg-amber-500 text-white hover:bg-amber-600 font-medium disabled:opacity-50"
                    >{messageEditing ? '���� ��...' : '�����ϱ�'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    {/* ���ε� ��� ��� */}
    {showUploadResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="text-6xl mb-4">??</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">���� �Ϸ�!</h3>
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-600">�ű� �߰�</span>
                  <span className="font-bold text-blue-600">{uploadResult.insertCount.toLocaleString()}��</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-600">�ߺ� (��ŵ)</span>
                  <span className="font-bold text-orange-500">{uploadResult.duplicateCount.toLocaleString()}��</span>
                </div>
              </div>
              <button
                onClick={() => { setShowUploadResult(false); window.location.reload(); }}
                className="w-full py-3 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
              >
                Ȯ��
              </button>
            </div>
          </div>
        </div>
      )}
      {/* �����߼� ��� */}
      {/* ���� Ÿ�� �߼� ��� */}
      {showTargetSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
            {/* ��� */}
            <div className="px-6 py-4 border-b flex justify-between items-center bg-green-50">
              <div>
                <h3 className="text-xl font-bold text-gray-800">���� Ÿ�� �߼�</h3>
                <p className="text-base text-gray-500 mt-1">����� <span className="font-bold text-emerald-600">{targetRecipients.length.toLocaleString()}��</span>���� �޽����� �߼��մϴ�</p>
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
            {/* ���� */}
            <div className="px-6 py-5 flex gap-5">
              {/* ����: �޽��� �ۼ� */}
              <div className="w-[400px]">
                {/* SMS/LMS/MMS �� */}
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

                {/* �޽��� �ۼ� ���� */}
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS ���� */}
                  {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={targetSubject}
                        onChange={(e) => setTargetSubject(e.target.value)}
                        placeholder="���� (�ʼ�)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                      />
                    </div>
                  )}
                  
                  {/* �޽��� �Է� */}
                  <div className="p-4">
                    <div className="relative">
                      {adTextEnabled && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(����) </span>
                      )}
                      <textarea
                        value={targetMessage}
                        onChange={(e) => setTargetMessage(e.target.value)}
                        placeholder="�����Ͻ� ������ �Է��ϼ���."
                        style={adTextEnabled ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${targetMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* ����ź� ǥ�� */}
                    {adTextEnabled && (
                      <div className="text-sm text-orange-600 mt-1">
                        {targetMsgType === 'SMS' 
                          ? `����ź�${optOutNumber.replace(/-/g, '')}` 
                          : `������Űź� ${formatRejectNumber(optOutNumber)}`}
                      </div>
                    )}
                    {/* Ư������/�̸��� �ȳ� */}
                    <div className="text-xs text-gray-400 mt-2">
                      ?? �̸���(??)��Ư�����ڴ� LMS ��ȯ �Ǵ� �߼� ���� ������ �� �� �ֽ��ϴ�
                    </div>
                  </div>
                  
                  {/* ��ư�� + ����Ʈ ǥ�� */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setShowSpecialChars('target')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">Ư������</button>
                      <button onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">������</button>
                      <button onClick={() => { if (!targetMessage.trim()) { setToast({show: true, type: 'error', message: '������ �޽����� ���� �Է����ּ���.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">��������</button>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      <span className={`font-bold ${(() => {
                        const optOutText = targetMsgType === 'SMS' 
                          ? `����ź�${optOutNumber.replace(/-/g, '')}` 
                          : `������Űź� ${formatRejectNumber(optOutNumber)}`;
                        const fullMsg = adTextEnabled ? `(����)${targetMessage}\n${optOutText}` : targetMessage;
                        const bytes = calculateBytes(fullMsg);
                        const max = targetMsgType === 'SMS' ? 90 : 2000;
                        return bytes > max ? 'text-red-500' : 'text-emerald-600';
                      })()}`}>
                        {(() => {
                          const optOutText = targetMsgType === 'SMS' 
                            ? `����ź�${optOutNumber.replace(/-/g, '')}` 
                            : `������Űź� ${formatRejectNumber(optOutNumber)}`;
                          const fullMsg = adTextEnabled ? `(����)${targetMessage}\n${optOutText}` : targetMessage;
                          return calculateBytes(fullMsg);
                        })()}
                      </span>/{targetMsgType === 'SMS' ? 90 : 2000}byte
                    </span>
                  </div>
                  
                  {/* ȸ�Ź�ȣ ���� */}
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
                      <option value="">ȸ�Ź�ȣ ����</option>
                      <option value="__individual__">?? ����ȸ�Ź�ȣ (����� �����ȣ)</option>
                      {callbackNumbers.map((cb) => (
                        <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '?' : ''}
                      </option>
                      ))}
                    </select>
                    {useIndividualCallback && (
                      <p className="text-xs text-blue-600 mt-1">?? �� ����� ���̿���� ȸ�Ź�ȣ�� �߼۵˴ϴ�</p>
                    )}
                  </div>

                  {/* �ڵ��Է� ��Ӵٿ� */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">�ڵ��Է�</span>
                      <select 
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            setTargetMessage(prev => prev + e.target.value);
                          }
                        }}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">���� ����</option>
                        <option value="%�̸�%">�̸�</option>
                        <option value="%���%">���</option>
                        <option value="%����%">����</option>
                        <option value="%���űݾ�%">���űݾ�</option>
                        <option value="%ȸ�Ź�ȣ%">ȸ�Ź�ȣ</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* MMS �̹��� ���ε� ���� */}
                  {(targetMsgType === 'MMS' || mmsUploadedImages.length > 0) && (
                    <div className="px-3 py-2 border-t bg-amber-50/50 cursor-pointer hover:bg-amber-100/50 transition-colors" onClick={() => setShowMmsUploadModal(true)}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-600">??? MMS �̹���</span>
                        {mmsUploadedImages.length > 0 ? (
                          <div className="flex items-center gap-1">
                            {mmsUploadedImages.map((img, idx) => (
                              <img key={idx} src={img.url} alt="" className="w-10 h-10 object-cover rounded border" crossOrigin="use-credentials" />
                            ))}
                            <span className="text-xs text-purple-600 ml-1">?? ����</span>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600">Ŭ���Ͽ� �̹��� ÷�� ��</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* �̸����� + �������� ��ư */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => {
                          if (!targetMessage.trim()) {
                            alert('�޽����� �Է����ּ���');
                            return;
                          }
                          setDirectMessage(targetMessage);
                          setDirectMsgType(targetMsgType);
                          setDirectSubject(targetSubject);
                          setShowDirectPreview(true);
                        }}
                        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        ?? �̸�����
                      </button>
                      <button 
                        onClick={() => {
                          const toast = document.createElement('div');
                          toast.innerHTML = `
                            <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px 32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:9999;text-align:center;">
                              <div style="font-size:48px;margin-bottom:12px;">??</div>
                              <div style="font-size:16px;font-weight:bold;color:#374151;margin-bottom:8px;">�غ� ���� ����Դϴ�</div>
                              <div style="font-size:14px;color:#6B7280;">���������׽�Ʈ�� �� ������Ʈ�˴ϴ�</div>
                            </div>
                            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;" onclick="this.parentElement.remove()"></div>
                          `;
                          document.body.appendChild(toast);
                          setTimeout(() => toast.remove(), 2000);
                        }}
                        className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        ??? ���������׽�Ʈ
                      </button>
                    </div>
                  </div>
                  
                  {/* ����/����/���� �ɼ� - 3���� 2�� */}
                  <div className="px-3 py-2 border-t">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                      {/* �������� */}
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
                          <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>��������</span>
                        </label>
                        <div 
                          className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                          onClick={() => reserveEnabled && setShowReservePicker(true)}
                        >
                          {reserveDateTime 
                            ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '����ð� ����'}
                        </div>
                      </div>
                      {/* �������� */}
                      <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded w-4 h-4"
                            checked={splitEnabled}
                            onChange={(e) => setSplitEnabled(e.target.checked)}
                          />
                          <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>��������</span>
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
                          <span className="text-xs text-gray-500">��/��</span>
                        </div>
                      </div>
                      {/* ����/080 */}
                      <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={adTextEnabled}
                            onChange={(e) => setAdTextEnabled(e.target.checked)}
                            className="rounded w-4 h-4"
                          />
                          <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>����ǥ��</span>
                        </label>
                        <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 ���Űź�</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* �����ϱ� ��ư */}
                  <div className="px-3 py-2 border-t">
                    <button 
                      onClick={async () => {
                        if (targetRecipients.length === 0) {
                          alert('�����ڰ� �����ϴ�');
                          return;
                        }
                        if (!targetMessage.trim()) {
                          alert('�޽����� �Է����ּ���');
                          return;
                        }
                        if (!selectedCallback && !useIndividualCallback) {
                          alert('ȸ�Ź�ȣ�� �������ּ���');
                          return;
                        }
                        if (useIndividualCallback && targetRecipients.some((r: any) => !r.callback)) {
                          alert('����ȸ�Ź�ȣ�� ���� ����� �ֽ��ϴ�.\n�Ϲ� ȸ�Ź�ȣ�� �����ϰų� ��� �����͸� Ȯ�����ּ���.');
                          return;
                        }
                        if ((targetMsgType === 'LMS' || targetMsgType === 'MMS') && !targetSubject.trim()) {
                          alert('������ �Է����ּ���');
                          return;
                        }

                        // ����Ʈ ���
                        const optOutText = targetMsgType === 'SMS' 
                          ? `����ź�${optOutNumber.replace(/-/g, '')}` 
                          : `������Űź� ${formatRejectNumber(optOutNumber)}`;
                        const fullMsg = adTextEnabled ? `(����)${targetMessage}\n${optOutText}` : targetMessage;
                        const msgBytes = calculateBytes(fullMsg);

                        // SMS�ε� 90����Ʈ �ʰ� �� ���� ��޷� ��ȯ �ȳ�
                        if (targetMsgType === 'SMS' && msgBytes > 90 && !smsOverrideAccepted) {
                          setPendingBytes(msgBytes);
                          setShowLmsConfirm(true);
                          return;
                        }

                        // LMS/MMS�ε� SMS�� ������ �Ǵ� ��� ��� ���� �ȳ�
                        if (targetMsgType !== 'SMS') {
                          const smsOptOut = `����ź�${optOutNumber.replace(/-/g, '')}`;
                          const smsFullMsg = adTextEnabled ? `(����)${targetMessage}\n${smsOptOut}` : targetMessage;
                          const smsBytes = calculateBytes(smsFullMsg);
                          if (smsBytes <= 90) {
                            setShowSmsConvert({show: true, from: 'target', currentBytes: msgBytes, smsBytes, count: targetRecipients.length});
                            return;
                          }
                        }

                        // ���Űź� üũ
                        const token = localStorage.getItem('token');
                        const phones = targetRecipients.map((r: any) => r.phone);
                        const checkRes = await fetch('/api/unsubscribes/check', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ phones })
                        });
                        const checkData = await checkRes.json();
                        const unsubCount = checkData.unsubscribeCount || 0;

                        // �߼� Ȯ�� ���
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
                      {targetSending ? '�߼� ��...' : '�����ϱ�'}
                    </button>
                  </div>
                </div>
              </div>
              
                        
              {/* ����: ������ ��� */}
              <div className="flex-1 flex flex-col">
                {/* ��� */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-800">������ ���</span>
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                      �� {targetRecipients.length.toLocaleString()}��
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="?? ���Ź�ȣ �˻�"
                      value={targetListSearch}
                      onChange={(e) => { setTargetListSearch(e.target.value); setTargetListPage(0); }}
                      className="border rounded-lg px-3 py-1.5 text-sm w-48"
                    />
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked className="rounded" />
                      �ߺ�����
                    </label>
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      <input type="checkbox" defaultChecked className="rounded" />
                      ���Űź�����
                    </label>
                  </div>
                </div>

                {/* ���̺� */}
                <div className="flex-1 border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">���Ź�ȣ</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">�̸�</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">���</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">����</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">���űݾ�</th>
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

                {/* ����¡ */}
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
                          ����
                        </button>
                        <span className="text-sm text-gray-600">
                          {targetListPage + 1} / {totalPages} ������
                        </span>
                        <button 
                          onClick={() => setTargetListPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={targetListPage >= totalPages - 1}
                          className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                        >
                          ����
                        </button>
                      </>
                    );
                  })()}
                </div>

                {/* �ϴ� ��ư */}
                <div className="mt-3 flex justify-between items-center">
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">�ߺ�����</button>
                    <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">���û���</button>
                    <button 
                      onClick={() => setTargetRecipients([])}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                    >
                      ��ü����
                    </button>
                  </div>
                  <button 
                    onClick={() => { setShowTargetSend(false); setShowDirectTargeting(true); }}
                    className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    ?? Ÿ�� �缳��
                  </button>
                </div>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* �������� �޷� ��� (����) */}
      {showReservePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[360px] overflow-hidden">
            <div className="bg-blue-50 px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-blue-700">?? ���� �ð� ����</h3>
            </div>
            <div className="p-5">
              {/* ���� ���� */}
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">���� ����</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '1�ð� ��', hours: 1 },
                    { label: '3�ð� ��', hours: 3 },
                    { label: '���� ���� 9��', tomorrow: 9 },
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
              {/* ���� ���� */}
              <div>
                <div className="flex gap-4">
                  {/* ��¥ */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2">��¥</div>
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
                  {/* �ð� */}
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-2">�ð�</div>
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
              {/* ���õ� �ð� ǥ�� */}
              {reserveDateTime && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
                  <span className="text-sm text-gray-600">���� �ð�: </span>
                  <span className="text-sm font-bold text-blue-700">
                    {new Date(reserveDateTime).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
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
                ���
              </button>
              <button
                onClick={() => {
                  if (!reserveDateTime) {
                    alert('���� �ð��� �������ּ���');
                    return;
                  }
                  setShowReservePicker(false);
                }}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Ȯ��
              </button>
            </div>
          </div>
        </div>
      )}

      {showDirectSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
            {/* ���� */}
            <div className="px-6 py-5 flex gap-5">
              {/* ����: �޽��� �ۼ� */}
              <div className="w-[400px]">
                {/* SMS/LMS/MMS �� */}
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

                {/* �޽��� �ۼ� ���� */}
                <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {/* LMS/MMS ���� */}
                  {(directMsgType === 'LMS' || directMsgType === 'MMS') && (
                    <div className="px-4 pt-3">
                      <input
                        type="text"
                        value={directSubject}
                        onChange={(e) => setDirectSubject(e.target.value)}
                        placeholder="���� (�ʼ�)"
                        className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                      />
                    </div>
                  )}
                  
                  {/* �޽��� �Է� */}
                  <div className="p-4">
                    <div className="relative">
                      {adTextEnabled && (
                        <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(����) </span>
                      )}
                      <textarea
                        value={directMessage}
                        onChange={(e) => setDirectMessage(e.target.value)}
                        placeholder="�����Ͻ� ������ �Է��ϼ���."
                        style={adTextEnabled ? { textIndent: '42px' } : {}}
                        className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${directMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                      />
                    </div>
                    {/* ����ź� ǥ�� */}
                    {adTextEnabled && (
                      <div className="text-sm text-orange-600 mt-1">
                        {directMsgType === 'SMS' 
                          ? `����ź�${optOutNumber.replace(/-/g, '')}` 
                          : `������Űź� ${formatRejectNumber(optOutNumber)}`}
                      </div>
                    )}
                    {/* Ư������/�̸��� �ȳ� */}
                    <div className="text-xs text-gray-400 mt-2">
                      ?? �̸���(??)��Ư�����ڴ� LMS ��ȯ �Ǵ� �߼� ���� ������ �� �� �ֽ��ϴ�
                    </div>
                    
                    {/* MMS �̹��� �̸����� */}
                    {(directMsgType === 'MMS' || mmsUploadedImages.length > 0) && (
                      <div className="mt-2 pt-2 border-t cursor-pointer hover:bg-amber-50/50 transition-colors rounded-lg p-2" onClick={() => setShowMmsUploadModal(true)}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-600">??? MMS �̹���</span>
                          {mmsUploadedImages.length > 0 ? (
                            <div className="flex items-center gap-1">
                              {mmsUploadedImages.map((img, idx) => (
                                <img key={idx} src={img.url} alt="" className="w-10 h-10 object-cover rounded border" crossOrigin="use-credentials" />
                              ))}
                              <span className="text-xs text-purple-600 ml-1">?? ����</span>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-600">Ŭ���Ͽ� �̹��� ÷�� ��</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* ��ư�� + ����Ʈ ǥ�� */}
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setShowSpecialChars('direct')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">Ư������</button>
                      <button onClick={() => { loadTemplates(); setShowTemplateBox('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">������</button>
                      <button onClick={() => { if (!directMessage.trim()) { setToast({show: true, type: 'error', message: '������ �޽����� ���� �Է����ּ���.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">��������</button>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      <span className={`font-bold ${messageBytes > maxBytes ? 'text-red-500' : 'text-emerald-600'}`}>{messageBytes}</span>/{maxBytes}byte
                    </span>
                  </div>
                  
                  {/* ȸ�Ź�ȣ ���� */}
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
                      <option value="">ȸ�Ź�ȣ ����</option>
                      <option value="__individual__">?? ����ȸ�Ź�ȣ (����� �����ȣ)</option>
                      {callbackNumbers.map((cb) => (
                        <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '?' : ''}
                      </option>
                      ))}
                    </select>
                    {useIndividualCallback && (
                      <p className="text-xs text-blue-600 mt-1">?? �� ����� ���̿���� ȸ�Ź�ȣ�� �߼۵˴ϴ�</p>
                    )}
                  </div>

                  {/* �ڵ��Է� ��ư */}
                  <div className="px-3 py-1.5 border-t bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-700 whitespace-nowrap">�ڵ��Է�</span>
                      <div className="flex gap-2 flex-1">
                        <button onClick={() => setDirectMessage(prev => prev + '%�̸�%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">�̸�</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%ȸ�Ź�ȣ%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-blue-50 font-medium text-blue-700">ȸ�Ź�ȣ</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%��Ÿ1%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">��Ÿ1</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%��Ÿ2%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">��Ÿ2</button>
                        <button onClick={() => setDirectMessage(prev => prev + '%��Ÿ3%')} className="flex-1 py-2 text-sm bg-white border rounded-lg hover:bg-gray-100 font-medium">��Ÿ3</button>
                      </div>
                    </div>
                  </div>
                  
                  {/* �̸����� + �������� ��ư */}
                  <div className="px-3 py-1.5 border-t">
                    <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => {
                          if (!directMessage.trim()) {
                            alert('�޽����� �Է����ּ���');
                            return;
                          }
                          setShowDirectPreview(true);
                        }}
                        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        ?? �̸�����
                      </button>
                      <button 
                        onClick={() => {
                          const toast = document.createElement('div');
                          toast.innerHTML = `
                            <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px 32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:9999;text-align:center;">
                              <div style="font-size:48px;margin-bottom:12px;">??</div>
                              <div style="font-size:16px;font-weight:bold;color:#374151;margin-bottom:8px;">�غ� ���� ����Դϴ�</div>
                              <div style="font-size:14px;color:#6B7280;">���������׽�Ʈ�� �� ������Ʈ�˴ϴ�</div>
                            </div>
                            <div style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;" onclick="this.parentElement.remove()"></div>
                          `;
                          document.body.appendChild(toast);
                          setTimeout(() => toast.remove(), 2000);
                        }}
                        className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        ??? ���������׽�Ʈ
                      </button>
                    </div>
                  </div>
                  
                  {/* ����/����/���� �ɼ� - 3���� 2�� */}
                  <div className="px-3 py-2 border-t">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {/* �������� */}
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
                          <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>��������</span>
                        </label>
                        <div 
                          className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                          onClick={() => reserveEnabled && setShowReservePicker(true)}
                        >
                          {reserveDateTime 
                            ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '����ð� ����'}
                        </div>
                      </div>
                      {/* �������� */}
                      <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded w-4 h-4"
                            checked={splitEnabled}
                            onChange={(e) => setSplitEnabled(e.target.checked)}
                          />
                          <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>��������</span>
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
                          <span className="text-xs text-gray-500">��/��</span>
                        </div>
                      </div>
                      {/* ����/080 */}
                      <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={adTextEnabled}
                            onChange={(e) => setAdTextEnabled(e.target.checked)}
                            className="rounded w-4 h-4"
                          />
                          <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>����ǥ��</span>
                        </label>
                        <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 ���Űź�</div>
                      </div>
                      </div>
                  </div>
                  
                  {/* �����ϱ� ��ư */}
                  <div className="px-3 py-2 border-t">
                    <button 
                      onClick={async () => {
                        // ��ȿ�� �˻�
                        if (directRecipients.length === 0) {
                          alert('�����ڸ� �߰����ּ���');
                          return;
                        }
                        if (!directMessage.trim()) {
                          alert('�޽����� �Է����ּ���');
                          return;
                        }
                        if (!selectedCallback && !useIndividualCallback) {
                          alert('ȸ�Ź�ȣ�� �������ּ���');
                          return;
                        }
                        if (useIndividualCallback && directRecipients.some((r: any) => !r.callback)) {
                          alert('����ȸ�Ź�ȣ�� ���� �����ڰ� �ֽ��ϴ�.\n�Ϲ� ȸ�Ź�ȣ�� �������ּ���.');
                          return;
                        }
                        if ((directMsgType === 'LMS' || directMsgType === 'MMS') && !directSubject.trim()) {
                          alert('������ �Է����ּ���');
                          return;
                        }

                        // SMS ����Ʈ �ʰ� �� LMS ��ȯ ���
                        if (directMsgType === 'SMS' && messageBytes > 90 && !smsOverrideAccepted) {
                          setPendingBytes(messageBytes);
                          setShowLmsConfirm(true);
                          return;
                        }

                        // LMS/MMS�ε� SMS�� ������ �Ǵ� ��� ��� ���� �ȳ�
                        if (directMsgType !== 'SMS') {
                          const smsOptOut = `����ź�${optOutNumber.replace(/-/g, '')}`;
                          const smsFullMsg = adTextEnabled ? `(����)${directMessage}\n${smsOptOut}` : directMessage;
                          const smsBytes = calculateBytes(smsFullMsg);
                          if (smsBytes <= 90) {
                            setShowSmsConvert({show: true, from: 'direct', currentBytes: messageBytes, smsBytes, count: directRecipients.length});
                            return;
                          }
                        }

                        // ���Űź� üũ
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
                      �����ϱ�
                    </button>
                  </div>
                </div>
              </div>
              
              {/* ����: ������ ��� */}
              <div className="flex-1 flex flex-col">
                {/* �Է� ��� �� + üũ�ڽ� */}
                <div className="flex items-center gap-3 mb-4">
                  <button 
                    onClick={() => setShowDirectInput(true)}
                    className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'direct' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
                  >?? �����Է�</button>
                  <label 
                    className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium cursor-pointer hover:bg-gray-50 ${directInputMode === 'file' ? 'bg-amber-50 border-amber-400 text-amber-700' : ''} ${directFileLoading ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {directFileLoading ? '? ���� �м���...' : '?? ���ϵ��'}
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
                            alert(data.error || '���� �Ľ� ����');
                          }
                        } catch (err) {
                          alert('���� ���ε� �� ������ �߻��߽��ϴ�.');
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
                   >?? �ּҷ�</button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer ml-2">
                    <input type="checkbox" defaultChecked className="rounded w-4 h-4" />
                    <span className="font-medium">�ߺ�����</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded w-4 h-4" />
                    <span className="font-medium">���Űź�����</span>
                  </label>
                  <div className="flex-1"></div>
                  <button 
                    onClick={() => setShowDirectSend(false)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <span>?</span> â�ݱ�
                  </button>
                </div>
                
                {/* ������ ���̺� */}
                <div className="border-2 rounded-xl overflow-hidden flex-1 flex flex-col">
                  <div className="bg-gray-50 px-4 py-3 flex justify-between items-center border-b">
                  <span className="text-sm font-medium">
                      �� <span className="text-emerald-600 font-bold text-lg">{directRecipients.length.toLocaleString()}</span> ��
                      {directRecipients.length > 10 && !directSearchQuery && (
                        <span className="text-gray-400 text-xs ml-2">(���� 10�� ǥ��)</span>
                      )}
                    </span>
                    <input
                      type="text"
                      placeholder="?? ���Ź�ȣ �˻�"
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
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">���Ź�ȣ</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">�̸�</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">ȸ�Ź�ȣ</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">��Ÿ1</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">��Ÿ2</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">��Ÿ3</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {directRecipients.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-24 text-center text-gray-400">
                              <div className="text-4xl mb-2">??</div>
                              <div className="text-sm">������ ���ε��ϰų� ���� �Է����ּ���</div>
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
                              <td className="px-4 py-3 text-sm font-mono text-xs text-gray-600">{r.callback || '-'}</td>
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
                
                {/* �ϴ� ��ư - �����ϱ�� ���� ���� */}
                <div className="flex gap-3 mt-4">
                  <button 
                    onClick={() => {
                      if (selectedRecipients.size === 0) {
                        alert('���õ� �׸��� �����ϴ�');
                        return;
                      }
                      const newList = directRecipients.filter((_, idx) => !selectedRecipients.has(idx));
                      setDirectRecipients(newList);
                      setSelectedRecipients(new Set());
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >���û���</button>
                  <button 
                    onClick={() => {
                      if (directRecipients.length === 0) return;
                      if (confirm('��ü �����Ͻðڽ��ϱ�?')) {
                        setDirectRecipients([]);
                        setSelectedRecipients(new Set());
                      }
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >��ü����</button>
                  <div className="flex-1"></div>
                  <button 
                    onClick={() => {
                      setDirectRecipients([]);
                      setDirectMessage('');
                      setDirectSubject('');
                      setMmsUploadedImages([]);
                      setSelectedRecipients(new Set());
                      setSelectedCallback('');
                    }}
                    className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                  >?? �ʱ�ȭ</button>
                </div>
              </div>
            </div>
            {/* ���� ���� ��� */}
            {directShowMapping && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[550px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">?? �÷� ����</h3>
                    <button onClick={() => setDirectShowMapping(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  
                  <div className="p-6">
                    {/* ���� �ȳ� */}
                    <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
                      ?? �Ʒ� �ʼ� �׸� <strong>������ � �÷�</strong>�� �������� �������ּ���.
                    </div>
                    
                    {/* ��� */}
                    <div className="flex items-center gap-4 mb-3 px-4">
                      <span className="w-28 text-xs font-bold text-gray-500">�ʼ� �׸�</span>
                      <span className="w-8 text-center text-xs text-gray-400">��</span>
                      <span className="flex-1 text-xs font-bold text-gray-500">���� �÷� ����</span>
                    </div>
                    
                    {/* ���� ���� - 5���� */}
                    <div className="space-y-3">
                      {/* ���Ź�ȣ (�ʼ�) */}
                      <div className="flex items-center gap-4 p-4 bg-red-50 rounded-xl border-2 border-red-200">
                        <span className="w-28 text-sm font-bold text-red-700">?? ���Ź�ȣ *</span>
                        <span className="w-8 text-center text-gray-400">��</span>
                        <select
                          className="flex-1 border-2 border-red-300 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
                          value={directColumnMapping.phone || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, phone: e.target.value})}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* �̸� */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">?? �̸�</span>
                        <span className="w-8 text-center text-gray-400">��</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.name || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, name: e.target.value})}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* ��Ÿ1 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">1?? ��Ÿ1</span>
                        <span className="w-8 text-center text-gray-400">��</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra1 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra1: e.target.value})}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* ��Ÿ2 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">2?? ��Ÿ2</span>
                        <span className="w-8 text-center text-gray-400">��</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra2 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra2: e.target.value})}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* ��Ÿ3 */}
                      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <span className="w-28 text-sm font-bold text-gray-700">3?? ��Ÿ3</span>
                        <span className="w-8 text-center text-gray-400">��</span>
                        <select
                          className="flex-1 border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={directColumnMapping.extra3 || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, extra3: e.target.value})}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* ȸ�Ź�ȣ (�����ȣ) */}
                      <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
                        <span className="w-28 text-sm font-bold text-blue-700">?? ȸ�Ź�ȣ</span>
                        <span className="w-8 text-center text-gray-400">��</span>
                        <select
                          className="flex-1 border border-blue-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={directColumnMapping.callback || ''}
                          onChange={(e) => setDirectColumnMapping({...directColumnMapping, callback: e.target.value})}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {directFileHeaders.map((h, i) => (
                            <option key={i} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                    <span className="text-sm text-gray-600">?? �� <strong>{directFileData.length.toLocaleString()}</strong>��</span>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setDirectShowMapping(false)}
                        className="px-6 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-100"
                      >���</button>
                      <button 
                        onClick={async () => {
                          if (!directColumnMapping.phone) {
                            alert('���Ź�ȣ�� �ʼ��Դϴ�.');
                            return;
                          }
                          
                          setDirectMappingLoading(true);
                          setDirectLoadingProgress(0);
                          
                          // �񵿱�� ó���Ͽ� UI ������Ʈ ���
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
                                extra3: row[directColumnMapping.extra3] || '',
                                callback: directColumnMapping.callback ? String(row[directColumnMapping.callback] || '').replace(/-/g, '').trim() : ''
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
                        {directMappingLoading ? `ó����... ${directLoadingProgress}%` : '����ϱ�'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Ư������ ��� */}
            {showSpecialChars && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowSpecialChars(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b bg-purple-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">? Ư������</h3>
                    <button onClick={() => setShowSpecialChars(null)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-8 gap-1.5">
                      {['��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','?','?','��','��','��','��','?','?','?','��','?','?','?','?','?','?','?','?','??','??','??','?','?','?','?','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��','��'].map((char, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            if (showSpecialChars === 'target') setTargetMessage(prev => prev + char);
                            else setDirectMessage(prev => prev + char);
                            setShowSpecialChars(null);
                          }}
                          className="w-10 h-10 flex items-center justify-center text-lg border rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
                        >
                          {char}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-3 text-center">?? �Ϻ� Ư�����ڴ� LMS �ڵ� ��ȯ�� �� �ֽ��ϴ�</p>
                  </div>
                </div>
              </div>
            )}

            {/* ������ ��� */}
            {showTemplateBox && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowTemplateBox(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-h-[70vh] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b bg-amber-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">?? ������</h3>
                    <button onClick={() => setShowTemplateBox(null)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-[50vh]">
                    {templateList.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <div className="text-4xl mb-3">??</div>
                        <div className="text-sm">����� ���ڰ� �����ϴ�</div>
                        <div className="text-xs mt-1">�޽��� �ۼ� �� '��������'�� �����ּ���</div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {templateList.map((t: any) => (
                          <div key={t.id} className="border rounded-xl p-4 hover:border-amber-300 hover:bg-amber-50/30 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-medium text-sm text-gray-800">{t.template_name}</div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{t.message_type}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                                  className="text-gray-300 hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                >???</button>
                              </div>
                            </div>
                            <div className="text-xs text-gray-500 mb-3 line-clamp-2 whitespace-pre-wrap">{t.content}</div>
                            <button
                              onClick={() => {
                                if (showTemplateBox === 'target') {
                                  setTargetMessage(t.content);
                                  if (t.subject) setTargetSubject(t.subject);
                                  if (t.message_type) setTargetMsgType(t.message_type);
                                } else {
                                  setDirectMessage(t.content);
                                  if (t.subject) setDirectSubject(t.subject);
                                  if (t.message_type) setDirectMsgType(t.message_type);
                                }
                                setShowTemplateBox(null);
                                setToast({ show: true, type: 'success', message: '���ڰ� ����Ǿ����ϴ�.' });
                                setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
                              }}
                              className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
                            >�����ϱ�</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* �������� ��� */}
            {showTemplateSave && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setShowTemplateSave(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">?? ���� ����</h3>
                    <button onClick={() => setShowTemplateSave(null)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  <div className="p-6">
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">������ �̸�</label>
                      <input
                        type="text"
                        value={templateSaveName}
                        onChange={(e) => setTemplateSaveName(e.target.value)}
                        placeholder="��: VIP ���� �ȳ�, �� �Ż�ǰ ȫ��"
                        className="w-full border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        autoFocus
                      />
                    </div>
                    <div className="mb-4 p-3 bg-gray-50 rounded-xl">
                      <div className="text-xs text-gray-400 mb-1">����� ���� �̸�����</div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">
                        {showTemplateSave === 'target' ? targetMessage : directMessage}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowTemplateSave(null)}
                        className="flex-1 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50"
                      >���</button>
                      <button
                        onClick={async () => {
                          if (!templateSaveName.trim()) {
                            setToast({ show: true, type: 'error', message: '�̸��� �Է����ּ���.' });
                            setTimeout(() => setToast({ show: false, type: 'error', message: '' }), 3000);
                            return;
                          }
                          const content = showTemplateSave === 'target' ? targetMessage : directMessage;
                          const msgType = showTemplateSave === 'target' ? targetMsgType : directMsgType;
                          const subject = showTemplateSave === 'target' ? targetSubject : directSubject;
                          const ok = await saveTemplate(templateSaveName.trim(), content, msgType, subject);
                          if (ok) setShowTemplateSave(null);
                        }}
                        className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-colors"
                      >?? �����ϱ�</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* �����Է� ��� */}
            {showDirectInput && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
                <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
                  <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg">?? �����Է�</h3>
                    <button onClick={() => setShowDirectInput(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
                  </div>
                  
                  <div className="p-6">
                    <div className="mb-3 text-sm text-gray-600">
                      ��ȭ��ȣ�� �� �ٿ� �ϳ��� �Է����ּ���.
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
                    >���</button>
                    <button 
                      onClick={() => {
                        const lines = directInputText.split('\n').map(l => l.trim()).filter(l => l);
                        const newRecipients = lines.map(phone => ({
                          phone: phone.replace(/-/g, ''),
                          name: '',
                          extra1: '',
                          extra2: '',
                          extra3: '',
                          callback: ''
                        }));
                        setDirectRecipients([...directRecipients, ...newRecipients]);
                        setDirectInputText('');
                        setShowDirectInput(false);
                        setDirectInputMode('direct');
                      }}
                      className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
                    >
                      ���
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            </div>
        </div>
      )}
      {/* �ּҷ� ��� */}
      {showAddressBook && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[750px] max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b bg-amber-50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-amber-700">?? �ּҷ�</h3>
              <button onClick={() => setShowAddressBook(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {/* ���� ���ε� ���� */}
              {!addressSaveMode && (
                <div className="mb-4 p-4 border-2 border-dashed border-amber-300 rounded-lg text-center bg-amber-50">
                  <label className="cursor-pointer">
                    <div className="text-amber-600 mb-2">?? ������ �����Ͽ� �ּҷ� ���</div>
                    <div className="text-xs text-gray-400 mb-3">Excel, CSV ���� ����</div>
                    <span className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 inline-block">���� ����</span>
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
                          alert('���� �Ľ� ����');
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}

              {/* ���� ������ ���� ��ư */}
              {directRecipients.length > 0 && !addressSaveMode && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <div className="text-sm text-blue-700 mb-2">���� ������ {directRecipients.length}���� �ּҷ����� �����Ͻðڽ��ϱ�?</div>
                  <button
                    onClick={() => setAddressSaveMode(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                  >?? �ּҷ����� ����</button>
                </div>
              )}

              {/* ���� ��� - �÷� ���� */}
              {addressSaveMode && addressFileData.length > 0 && (
                <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="text-sm font-medium text-amber-700 mb-3">?? �÷� ���� ({addressFileData.length}��)</div>
                  <div className="space-y-2 mb-4">
                    {[
                      { key: 'phone', label: '���Ź�ȣ *', required: true },
                      { key: 'name', label: '�̸�' },
                      { key: 'extra1', label: '��Ÿ1' },
                      { key: 'extra2', label: '��Ÿ2' },
                      { key: 'extra3', label: '��Ÿ3' },
                    ].map((field) => (
                      <div key={field.key} className="flex items-center gap-3">
                        <span className={`w-24 text-sm ${field.required ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{field.label}</span>
                        <span className="text-gray-400">��</span>
                        <select
                          className="flex-1 px-3 py-2 border rounded-lg text-sm"
                          value={addressColumnMapping[field.key] || ''}
                          onChange={(e) => setAddressColumnMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                        >
                          <option value="">-- �÷� ���� --</option>
                          {addressFileHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm text-gray-600 w-24">�׷�� *</span>
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="��: VIP���, �̺�Ʈ������"
                      className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!addressColumnMapping.phone) {
                          alert('���Ź�ȣ �÷��� �����ϼ���');
                          return;
                        }
                        if (!newGroupName.trim()) {
                          alert('�׷���� �Է��ϼ���');
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
                          alert(data.error || '���� ����');
                        }
                      }}
                      className="flex-1 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                    >?? �ּҷ� ����</button>
                    <button
                      onClick={() => { setAddressSaveMode(false); setAddressFileData([]); setAddressColumnMapping({}); setNewGroupName(''); }}
                      className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400"
                    >���</button>
                  </div>
                </div>
              )}

              {/* ���� ������ ���� ��� */}
              {addressSaveMode && addressFileData.length === 0 && directRecipients.length > 0 && (
                <div className="mb-4 p-4 bg-green-50 rounded-lg border-2 border-green-200">
                  <div className="text-sm text-green-700 mb-2 font-medium">�׷���� �Է��ϼ��� ({directRecipients.length}��)</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="��: VIP���, �̺�Ʈ������"
                      className="flex-1 px-3 py-2 border rounded-lg"
                    />
                    <button
                      onClick={async () => {
                        if (!newGroupName.trim()) {
                          alert('�׷���� �Է��ϼ���');
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
                          alert(data.error || '���� ����');
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >����</button>
                    <button
                      onClick={() => { setAddressSaveMode(false); setNewGroupName(''); }}
                      className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400"
                    >���</button>
                  </div>
                </div>
              )}

              {/* �׷� ��� */}
              {!addressSaveMode && (
                <>
                  <div className="text-sm font-medium text-gray-600 mb-2">����� �ּҷ�</div>
                  {addressGroups.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-4xl mb-2">??</div>
                  <div>����� �ּҷ��� �����ϴ�</div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {addressGroups.slice(addressPage * 5, addressPage * 5 + 5).map((group) => (
                      <div key={group.group_name} className="border rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100">
                          <div>
                            <div className="font-medium">{group.group_name}</div>
                            <div className="text-sm text-gray-500">{group.count}��</div>
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
                            >{addressViewGroup === group.group_name ? '�ݱ�' : '��ȸ'}</button>
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
                                  setToast({show: true, type: 'success', message: `${data.contacts.length}�� �ҷ����� �Ϸ�`});
                                  setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                                }
                              }}
                              className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 text-sm"
                            >�ҷ�����</button>
                            <button
                              onClick={async () => {
                                if (!confirm(`"${group.group_name}" �ּҷ��� �����Ͻðڽ��ϱ�?`)) return;
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
                                  setToast({show: true, type: 'success', message: '�����Ǿ����ϴ�'});
                                  setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
                                }
                              }}
                              className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
                            >����</button>
                          </div>
                        </div>
                        {addressViewGroup === group.group_name && (
                          <div className="p-3 border-t bg-white">
                            <div className="flex gap-2 mb-2">
                              <input
                                type="text"
                                placeholder="��ȣ �Ǵ� �̸����� �˻�"
                                value={addressViewSearch}
                                onChange={(e) => setAddressViewSearch(e.target.value)}
                                className="flex-1 px-3 py-1.5 border rounded text-sm"
                              />
                            </div>
                            <div className="max-h-[200px] overflow-y-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100 sticky top-0">
                                  <tr>
                                    <th className="px-2 py-1 text-left">��ȣ</th>
                                    <th className="px-2 py-1 text-left">�̸�</th>
                                    <th className="px-2 py-1 text-left">��Ÿ1</th>
                                    <th className="px-2 py-1 text-left">��Ÿ2</th>
                                    <th className="px-2 py-1 text-left">��Ÿ3</th>
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
                                  ���� 10�Ǹ� ǥ�� (��ü {addressViewContacts.filter(c => !addressViewSearch || c.phone?.includes(addressViewSearch) || c.name?.includes(addressViewSearch)).length}��)
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
                      >��</button>
                      <span className="text-sm text-gray-600">{addressPage + 1} / {Math.ceil(addressGroups.length / 5)}</span>
                      <button
                        onClick={() => setAddressPage(p => Math.min(Math.ceil(addressGroups.length / 5) - 1, p + 1))}
                        disabled={addressPage >= Math.ceil(addressGroups.length / 5) - 1}
                        className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >��</button>
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
              >�ݱ�</button>
            </div>
          </div>
        </div>
      )}
      {/* LMS ��ȯ Ȯ�� ��� */}
      {showLmsConfirm && (() => {
        // ���� Ȱ�� �߼� ����� Ǯ �޽��� ���
        const activeMsg = showTargetSend ? targetMessage : directMessage;
        const activeMsgType = showTargetSend ? targetMsgType : directMsgType;
        const activeRecipients = showTargetSend ? targetRecipients : directRecipients;
        const activeVarMap: Record<string, string> = showTargetSend
          ? { '%�̸�%': 'name', '%���%': 'grade', '%����%': 'region', '%���űݾ�%': 'total_purchase_amount', '%ȸ�Ź�ȣ%': 'callback' }
          : { '%�̸�%': 'name', '%��Ÿ1%': 'extra1', '%��Ÿ2%': 'extra2', '%��Ÿ3%': 'extra3', '%ȸ�Ź�ȣ%': 'callback' };
        let fullMsg = getMaxByteMessage(activeMsg, activeRecipients, activeVarMap);
        
        const optOutText = activeMsgType === 'SMS'
          ? `����ź�${optOutNumber.replace(/-/g, '')}`
          : `������Űź� ${optOutNumber}`;
        if (adTextEnabled) {
          fullMsg = `(����) ${fullMsg}\n${optOutText}`;
        }

        const truncated = truncateToSmsBytes(fullMsg, 90);
        const truncatedBytes = calculateBytes(truncated);
        const isOptOutCut = adTextEnabled && !truncated.includes(optOutText);
        const isAdBlocked = adTextEnabled && isOptOutCut;

        return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-xl shadow-2xl w-[440px] overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-amber-50 to-orange-50 border-b">
              <div className="text-center">
                <div className="text-5xl mb-3">??</div>
                <h3 className="text-lg font-bold text-gray-800">�޽��� ���� �ʰ�</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="text-center mb-4">
                <div className="text-3xl font-bold text-red-500 mb-1">{pendingBytes} <span className="text-lg text-gray-400">/ 90 byte</span></div>
                <div className="text-gray-600">SMS ������ �ʰ��߽��ϴ�</div>
              </div>

              {/* �߸� �޽��� �̸����� */}
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-500 mb-1.5">SMS �߼� �� ���� ���� ({truncatedBytes}/90 byte)</div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                  {truncated}
                  <span className="text-red-400 bg-red-50 px-0.5">������(�߸�)</span>
                </div>
              </div>

              {/* ���� ���� ���Űź� �߸� ��� */}
              {isAdBlocked && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <span className="text-red-500 text-lg leading-none mt-0.5">?</span>
                    <div>
                      <div className="text-sm font-semibold text-red-700">���Űź� ��ȣ�� �߸��ϴ�</div>
                      <div className="text-xs text-red-600 mt-0.5">
                        ���� ���ڴ� ���Űź� ��ȣ�� �ݵ�� �����ؾ� �մϴ� (������Ÿ��� ��50��).<br/>
                        SMS�� �߼��� �� �����ϴ�. LMS�� ��ȯ���ּ���.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* �񱤰� �߸� ��� */}
              {!isAdBlocked && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 text-lg leading-none mt-0.5">??</span>
                    <div className="text-xs text-amber-700">
                      SMS�� �߼��ϸ� 90����Ʈ ���� ������ �߷��� ���ŵ˴ϴ�.
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <div className="text-sm text-blue-800">
                  <div className="font-medium mb-1">?? LMS�� ��ȯ�Ͻðڽ��ϱ�?</div>
                  <div className="text-blue-600">LMS�� �ִ� 2,000byte���� �߼� �����մϴ�</div>
                </div>
              </div>
              <div className="flex gap-3">
                {isAdBlocked ? (
                  <button
                    disabled
                    className="flex-1 py-3 border-2 border-gray-200 rounded-lg text-gray-400 font-medium cursor-not-allowed bg-gray-50"
                  >SMS �߼� �Ұ�</button>
                ) : (
                  <button
                    onClick={() => {
                      setSmsOverrideAccepted(true);
                      setShowLmsConfirm(false);
                    }}
                    className="flex-1 py-3 border-2 border-amber-300 rounded-lg text-amber-700 font-medium hover:bg-amber-50"
                  >SMS ���� (�߸� �߼�)</button>
                )}
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
                  >LMS ��ȯ</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    
          {/* SMS ��ȯ ������� ��� */}
          {showSmsConvert.show && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
              <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
                <div className="p-6 bg-gradient-to-r from-blue-50 to-emerald-50 border-b">
                  <div className="text-center">
                    <div className="text-5xl mb-3">??</div>
                    <h3 className="text-lg font-bold text-gray-800">��� ���� �ȳ�</h3>
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-center mb-4">
                    <div className="text-sm text-gray-600 mb-2">SMS�� �߼��ϸ� ����� �����˴ϴ�!</div>
                    <div className="flex items-center justify-center gap-3 text-lg">
                      <span className="text-gray-500">{showSmsConvert.currentBytes}byte</span>
                      <span className="text-gray-400">��</span>
                      <span className="font-bold text-emerald-600">{showSmsConvert.smsBytes}byte</span>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="text-sm text-gray-600 mb-3 text-center">���� ��� �� ({showSmsConvert.count.toLocaleString()}�� ����)</div>
                    <div className="flex justify-between items-center">
                      <div className="text-center flex-1">
                        <div className="text-xs text-gray-500 mb-1">LMS (27��/��)</div>
                        <div className="text-lg font-bold text-gray-700">{(showSmsConvert.count * 27).toLocaleString()}��</div>
                      </div>
                      <div className="text-2xl text-gray-300 px-4">��</div>
                      <div className="text-center flex-1">
                        <div className="text-xs text-gray-500 mb-1">SMS (10��/��)</div>
                        <div className="text-lg font-bold text-emerald-600">{(showSmsConvert.count * 10).toLocaleString()}��</div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-200 text-center">
                      <span className="text-sm text-gray-600">���� �ݾ�: </span>
                      <span className="text-lg font-bold text-red-500">{((showSmsConvert.count * 27) - (showSmsConvert.count * 10)).toLocaleString()}��</span>
                    </div>
                  </div>
    
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowSmsConvert({show: false, from: 'direct', currentBytes: 0, smsBytes: 0, count: 0})}
                      className="flex-1 py-3 border-2 border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
                    >LMS ����</button>
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
                      >SMS ��ȯ</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
        
              {/* �������� ��¥/�ð� ���� ��� (����) */}
              {showReservePicker && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
                  <div className="bg-white rounded-xl shadow-2xl w-[460px] overflow-hidden">
                    <div className="bg-blue-50 px-6 py-5 border-b">
                      <h3 className="text-xl font-bold text-blue-700">?? ���� �ð� ����</h3>
                    </div>
                    <div className="p-6">
                      {/* ���� ���� */}
                      <div className="mb-5">
                        <div className="text-sm text-gray-500 mb-2">���� ����</div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: '1�ð� ��', hours: 1 },
                            { label: '3�ð� ��', hours: 3 },
                            { label: '���� ���� 9��', tomorrow: 9 },
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
                      {/* ���� ���� */}
                      <div>
                        <div className="flex gap-4">
                          {/* ��¥ */}
                          <div className="flex-1">
                            <div className="text-xs text-gray-500 mb-2">��¥</div>
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
                          {/* �ð� */}
                          <div className="flex-1">
                            <div className="text-xs text-gray-500 mb-2">�ð�</div>
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
                                <option value="AM">����</option>
                                <option value="PM">����</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                      {/* ���õ� �ð� ǥ�� */}
                      {reserveDateTime && (
                        <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
                          <span className="text-sm text-gray-600">���� �ð�: </span>
                          <span className="text-sm font-bold text-blue-700">
                            {new Date(reserveDateTime).toLocaleString('ko-KR', {
                              timeZone: 'Asia/Seoul',
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
                        ���
                      </button>
                      <button
                        onClick={() => {
                          if (!reserveDateTime) {
                            const toast = document.createElement('div');
                            toast.innerHTML = `
                              <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;" onclick="this.parentElement.remove()">
                                <div style="background:white;padding:0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);width:380px;overflow:hidden;" onclick="event.stopPropagation()">
                                  <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);padding:24px;text-align:center;">
                                    <div style="font-size:48px;margin-bottom:8px;">?</div>
                                    <div style="font-size:18px;font-weight:bold;color:#92400e;">�ð��� �������ּ���</div>
                                  </div>
                                  <div style="padding:24px;text-align:center;">
                                    <div style="color:#6b7280;margin-bottom:20px;">���� �ð��� ���� �������ּ���.</div>
                                    <button onclick="this.closest('[style*=position]').parentElement.remove()" style="width:100%;padding:12px;background:#f59e0b;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer;">Ȯ��</button>
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
                                    <div style="font-size:48px;margin-bottom:8px;">??</div>
                                    <div style="font-size:18px;font-weight:bold;color:#dc2626;">���� �Ұ�</div>
                                  </div>
                                  <div style="padding:24px;text-align:center;">
                                    <div style="color:#374151;font-weight:500;margin-bottom:8px;">���� �ð����� �������δ� ������ �� �����ϴ�.</div>
                                    <div style="color:#6b7280;margin-bottom:20px;">���� �ð��� �ٽ� �������ּ���.</div>
                                    <button onclick="this.closest('[style*=position]').parentElement.remove()" style="width:100%;padding:12px;background:#dc2626;color:white;border:none;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer;">Ȯ��</button>
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
                        Ȯ��
                      </button>
                    </div>
                  </div>
                </div>
              )}
        
              {/* �̸����� ��� (����) */}
      {showDirectPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
            <div className="p-4 border-b bg-emerald-50 flex justify-between items-center">
              <h3 className="font-bold text-lg">?? �޽��� �̸�����</h3>
              <button onClick={() => setShowDirectPreview(false)} className="text-gray-500 hover:text-gray-700 text-xl">?</button>
            </div>
            
            <div className="p-6 flex justify-center">
              {/* ��� �� ������ */}
              <div className="rounded-[1.8rem] p-[3px] bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-200">
                <div className="bg-white rounded-[1.6rem] overflow-hidden flex flex-col w-[280px]" style={{ height: '420px' }}>
                  {/* ��� - ȸ�Ź�ȣ */}
                  <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100 flex justify-between items-center shrink-0 border-b">
                    <span className="text-[11px] text-gray-400 font-medium">���ڸ޽���</span>
                    <span className="text-[11px] font-bold text-emerald-600">{formatPhoneNumber(selectedCallback) || 'ȸ�Ź�ȣ'}</span>
                  </div>
                  {/* LMS/MMS ���� */}
                  {(directMsgType === 'LMS' || directMsgType === 'MMS') && directSubject && (
                    <div className="px-4 py-2 bg-orange-50 border-b border-orange-200">
                      <span className="text-sm font-bold text-orange-700">{directSubject}</span>
                    </div>
                  )}
                  {/* MMS �̹��� */}
                  {mmsUploadedImages.length > 0 && (
                    <div className="shrink-0">
                      {mmsUploadedImages.map((img, idx) => (
                        <img key={idx} src={img.url} alt="" className="w-full h-auto max-h-[140px] object-cover" crossOrigin="use-credentials" />
                      ))}
                    </div>
                  )}
                  {/* �޽��� ���� - ��ũ�� */}
                  <div className="flex-1 overflow-y-auto p-3 bg-gradient-to-b from-emerald-50/30 to-white">
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-xs">??</div>
                      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[13px] leading-[1.7] whitespace-pre-wrap text-gray-700 max-w-[95%]">
                        {(() => {
                          const mergedMsg = getFullMessage(directMessage)
                            .replace(/%�̸�%/g, (showTargetSend ? targetRecipients[0]?.name : directRecipients[0]?.name) || 'ȫ�浿')
                            .replace(/%���%/g, (showTargetSend ? targetRecipients[0]?.grade : '') || 'VIP')
                            .replace(/%����%/g, (showTargetSend ? targetRecipients[0]?.region : '') || '����')
                            .replace(/%���űݾ�%/g, (showTargetSend ? targetRecipients[0]?.amount : '') || '100,000��')
                            .replace(/%��Ÿ1%/g, directRecipients[0]?.extra1 || '��Ÿ1')
                            .replace(/%��Ÿ2%/g, directRecipients[0]?.extra2 || '��Ÿ2')
                            .replace(/%��Ÿ3%/g, directRecipients[0]?.extra3 || '��Ÿ3');
                          return mergedMsg;
                        })()}
                      </div>
                    </div>
                  </div>
                  {/* �ϴ� ����Ʈ - ������ �޽��� ���� */}
                  <div className="px-3 py-2 border-t bg-gray-50 text-center shrink-0">
                    {(() => {
                      const mergedMsg = getFullMessage(directMessage)
                        .replace(/%�̸�%/g, (showTargetSend ? targetRecipients[0]?.name : directRecipients[0]?.name) || 'ȫ�浿')
                        .replace(/%���%/g, (showTargetSend ? targetRecipients[0]?.grade : '') || 'VIP')
                        .replace(/%����%/g, (showTargetSend ? targetRecipients[0]?.region : '') || '����')
                        .replace(/%���űݾ�%/g, (showTargetSend ? targetRecipients[0]?.amount : '') || '100,000��')
                        .replace(/%��Ÿ1%/g, directRecipients[0]?.extra1 || '��Ÿ1')
                        .replace(/%��Ÿ2%/g, directRecipients[0]?.extra2 || '��Ÿ2')
                        .replace(/%��Ÿ3%/g, directRecipients[0]?.extra3 || '��Ÿ3');
                      const mergedBytes = calculateBytes(mergedMsg);
                      const limit = directMsgType === 'SMS' ? 90 : 2000;
                      const isOver = mergedBytes > limit;
                      return <span className={`text-[10px] ${isOver ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{mergedBytes} / {limit} bytes �� {directMsgType}{isOver ? ' ?? �ʰ�' : ''}</span>;
                    })()}
                  </div>
                </div>
              </div>
            </div>
            
            {/* MMS �̹��� �ȳ� */}
            {mmsUploadedImages.length > 0 && (
              <div className="mx-6 mb-2 p-3 bg-amber-50 rounded-lg text-xs text-amber-700 text-center">
                ?? ���� ���� ȭ���� ����� �� �޴��� ������ ���� �ٸ��� ���� �� �ֽ��ϴ�
              </div>
            )}

            {/* ġȯ �ȳ� */}
            {(directMessage.includes('%�̸�%') || directMessage.includes('%��Ÿ') || directMessage.includes('%���%') || directMessage.includes('%����%') || directMessage.includes('%���űݾ�%') || directMessage.includes('%ȸ�Ź�ȣ%')) && (
              <div className="mx-6 mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 text-center">
                ?? �ڵ��Է� ������ ù ��° ������ ������ ǥ�õ˴ϴ�
                {(!directRecipients[0] && !targetRecipients[0]) && ' (���� ������)'}
              </div>
            )}
            
            <div className="p-4 border-t bg-gray-50 flex justify-center">
              <button 
                onClick={() => setShowDirectPreview(false)}
                className="px-12 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold"
              >
                Ȯ��
              </button>
            </div>
          </div>
        </div>
      )}

      {/* �߼� Ȯ�� ��� */}
      {sendConfirm.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
            <div className={`px-6 py-4 border-b ${sendConfirm.type === 'immediate' ? 'bg-emerald-50' : 'bg-blue-50'}`}>
              <h3 className={`text-lg font-bold ${sendConfirm.type === 'immediate' ? 'text-emerald-700' : 'text-blue-700'}`}>
                {sendConfirm.type === 'immediate' ? '? ��� �߼�' : '?? ���� �߼�'}
              </h3>
            </div>
            <div className="p-6">
              <p className="text-gray-700 mb-4">
                {sendConfirm.type === 'immediate' 
                  ? '�޽����� ��� �߼��Ͻðڽ��ϱ�?' 
                  : '�޽����� ���� �߼��Ͻðڽ��ϱ�?'}
              </p>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">�߼� �Ǽ�</span>
                  <span className="font-bold text-emerald-600">{sendConfirm.count.toLocaleString()}��</span>
                </div>
                {sendConfirm.unsubscribeCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">���Űź� ����</span>
                    <span className="font-bold text-rose-500">{sendConfirm.unsubscribeCount.toLocaleString()}��</span>
                  </div>
                )}
                {sendConfirm.type === 'scheduled' && sendConfirm.dateTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">���� �ð�</span>
                    <span className="font-bold text-blue-600">
                      {new Date(sendConfirm.dateTime).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
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
                  <span className="text-gray-500">�޽��� Ÿ��</span>
                  <span className="font-medium">{directMsgType}</span>
                </div>
                {sendConfirm.type === 'scheduled' && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <span>??</span> ���� ��Ҵ� �߼� 15�� ������ �����մϴ�
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
                ���
              </button>
              <button
                onClick={sendConfirm.from === 'target' ? executeTargetSend : executeDirectSend}
                disabled={directSending}
                className={`flex-1 py-3 text-white font-medium ${sendConfirm.type === 'immediate' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-500 hover:bg-blue-600'} disabled:opacity-50`}
              >
                {directSending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">?</span> ó����...
                  </span>
                ) : (
                  sendConfirm.type === 'immediate' ? '��� �߼�' : '���� �߼�'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* �ܾ� ��Ȳ ��� */}
      {showBalanceModal && balanceInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={() => setShowBalanceModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            {/* ��� */}
            <div className="p-5 bg-gradient-to-r from-emerald-50 to-green-50 border-b">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-xl">??</div>
                <div>
                  <div className="text-sm text-gray-500">���� �ܾ�</div>
                  <div className={`text-2xl font-bold ${balanceInfo.balance < 10000 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {balanceInfo.balance.toLocaleString()}��
                  </div>
                </div>
              </div>
              {balanceInfo.balance < 10000 && (
                <div className="mt-2 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1.5 flex items-center gap-1">
                  <span>??</span> �ܾ��� �����մϴ�. ���� �� �߼����ּ���.
                </div>
              )}
            </div>
            {/* �߼� ���� �Ǽ� */}
            <div className="p-5">
              <div className="text-xs text-gray-400 font-medium mb-3">�߼� ���� �Ǽ�</div>
              <div className="space-y-2.5">
                {[
                  { label: 'SMS', price: balanceInfo.costPerSms },
                  { label: 'LMS', price: balanceInfo.costPerLms },
                  ...(balanceInfo.costPerMms && balanceInfo.costPerMms > 0 ? [{ label: 'MMS' as const, price: balanceInfo.costPerMms }] : []),
                  ...(balanceInfo.costPerKakao && balanceInfo.costPerKakao > 0 ? [{ label: 'īī����' as const, price: balanceInfo.costPerKakao }] : []),
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">{item.label}</span>
                      <span className="text-xs text-gray-400">@{item.price}��</span>
                    </div>
                    <span className="text-sm font-bold text-gray-800">
                      {item.price > 0 ? `${Math.floor(balanceInfo.balance / item.price).toLocaleString()}��` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* �ϴ� ��ư */}
            <div className="px-5 pb-5 space-y-2">
            <button
                onClick={() => { setShowBalanceModal(false); setChargeStep('select'); setDepositSuccess(false); setShowChargeModal(true); }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors text-sm"
              >
                ?? �ܾ� �����ϱ�
              </button>
              <button
                onClick={() => setShowBalanceModal(false)}
                className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors"
              >
                �ݱ�
              </button>
            </div>
          </div>
        </div>
      )}

      {/* �ܾ� ���� ��� */}
      {showChargeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[65]">
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            
            {/* ���� ��� ���� */}
            {chargeStep === 'select' && (
              <>
                <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-xl">??</div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">�ܾ� ����</h3>
                      <p className="text-xs text-gray-500">���� ����� �������ּ���</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  {/* ī����� - �غ��� */}
                  <div className="relative p-4 rounded-xl border border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed">
                    <div className="absolute top-2 right-2 bg-gray-400 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">�غ� ��</div>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center text-lg">??</div>
                      <div>
                        <div className="text-sm font-semibold text-gray-500">ī�����</div>
                        <div className="text-xs text-gray-400">�ſ�ī�� / üũī�� ��� ����</div>
                      </div>
                    </div>
                  </div>
                  {/* ������� - �غ��� */}
                  <div className="relative p-4 rounded-xl border border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed">
                    <div className="absolute top-2 right-2 bg-gray-400 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">�غ� ��</div>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center text-lg">??</div>
                      <div>
                        <div className="text-sm font-semibold text-gray-500">�������</div>
                        <div className="text-xs text-gray-400">�߱޵� ���·� �Ա� �� �ڵ� ����</div>
                      </div>
                    </div>
                  </div>
                  {/* �������Ա� */}
                  <button
                    onClick={() => { setChargeStep('deposit'); setDepositAmount(''); setDepositorName(''); setDepositSuccess(false); }}
                    className="w-full p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center text-lg">??</div>
                      <div>
                        <div className="text-sm font-semibold text-gray-800">�������Ա�</div>
                        <div className="text-xs text-gray-500">������ü �� �Ա� Ȯ�� ��û</div>
                      </div>
                      <div className="ml-auto text-emerald-500 text-sm">��</div>
                    </div>
                  </button>
                </div>
                <div className="px-5 pb-5">
                  <button onClick={() => setShowChargeModal(false)} className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">
                    �ݱ�
                  </button>
                </div>
              </>
            )}

            {/* �������Ա� �� */}
            {chargeStep === 'deposit' && !depositSuccess && (
              <>
                <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setChargeStep('select')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-100 text-gray-500 transition-colors">��</button>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">�������Ա�</h3>
                      <p className="text-xs text-gray-500">�Ʒ� ���·� �Ա� �� ��û���ּ���</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {/* �Ա� ���� �ȳ� */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                    <div className="text-xs text-blue-500 font-medium mb-2">�Ա� ����</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-gray-800">������� 585-028893-01-011</div>
                        <div className="text-xs text-gray-500 mt-0.5">������: �ֽ�ȸ�� �κ���</div>
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText('585-028893-01-011'); }}
                        className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-600 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        ����
                      </button>
                    </div>
                  </div>
                  {/* �Ա� �ݾ� */}
                  <div>
                    <label className="text-xs text-gray-500 font-medium mb-1.5 block">�Ա� �ݾ� *</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={depositAmount}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          setDepositAmount(v);
                        }}
                        placeholder="�ݾ��� �Է����ּ���"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 pr-10"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">��</span>
                    </div>
                    {depositAmount && (
                      <div className="text-xs text-gray-400 mt-1 text-right">{Number(depositAmount).toLocaleString()}��</div>
                    )}
                  </div>
                                    {/* �Ա��ڸ� */}
                  <div>
                    <label className="text-xs text-gray-500 font-medium mb-1.5 block">�Ա��ڸ� *</label>
                    <input
                      type="text"
                      value={depositorName}
                      onChange={e => setDepositorName(e.target.value)}
                      placeholder="�Ա��ڸ��� �Է����ּ���"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-2">
                  <button
                    onClick={async () => {
                      if (!depositAmount || Number(depositAmount) < 1000) return alert('1,000�� �̻� �Է����ּ���.');
                      if (!depositorName.trim()) return alert('�Ա��ڸ��� �Է����ּ���.');
                      setDepositSubmitting(true);
                      try {
                        const res = await fetch('/api/balance/deposit-request', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}` },
                          body: JSON.stringify({ amount: Number(depositAmount), depositorName: depositorName.trim() }),
                        });
                        if (res.ok) {
                          setDepositSuccess(true);
                        } else {
                          const err = await res.json();
                          alert(err.error || '��û ����');
                        }
                      } catch (e) { alert('��Ʈ��ũ ����'); }
                      setDepositSubmitting(false);
                    }}
                    disabled={depositSubmitting || !depositAmount || !depositorName.trim()}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors text-sm"
                  >
                    {depositSubmitting ? '��û ��...' : `${Number(depositAmount || 0).toLocaleString()}�� �Ա� Ȯ�� ��û`}
                  </button>
                  <button onClick={() => setChargeStep('select')} className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">
                    �ڷ�
                  </button>
                </div>
              </>
            )}

            {/* ��û �Ϸ� */}
            {chargeStep === 'deposit' && depositSuccess && (
              <>
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">?</div>
                  <h3 className="text-lg font-bold text-gray-800 mb-2">�Ա� Ȯ�� ��û �Ϸ�</h3>
                  <p className="text-sm text-gray-500 mb-1">�����ڰ� �Ա� Ȯ�� �� �ܾ��� �����˴ϴ�.</p>
                  <p className="text-sm text-gray-500">������ ���� 1�ð� �̳� ó���˴ϴ�.</p>
                  <div className="mt-4 bg-gray-50 rounded-xl p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">��û �ݾ�</span>
                      <span className="font-bold text-emerald-700">{Number(depositAmount).toLocaleString()}��</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">�Ա��ڸ�</span>
                      <span className="font-medium text-gray-700">{depositorName}</span>
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <button onClick={() => setShowChargeModal(false)} className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium transition-colors text-sm">
                    Ȯ��
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* �ܾ� ���� ��� */}
      {showInsufficientBalance?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-6 bg-gradient-to-r from-red-50 to-orange-50 border-b flex items-center gap-3">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-2xl">??</div>
              <div>
                <h3 className="text-lg font-bold text-red-700">�ܾ��� �����մϴ�</h3>
                <p className="text-sm text-red-500">���� �� �ٽ� �õ����ּ���</p>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-sm">���� �ܾ�</span>
                  <span className="text-lg font-bold text-red-600">{(showInsufficientBalance.balance || 0).toLocaleString()}��</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-sm">�߼� ���</span>
                  <span className="text-lg font-bold text-gray-800">{(showInsufficientBalance.required || 0).toLocaleString()}��</span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">���� �ݾ�</span>
                    <span className="text-lg font-bold text-orange-600">
                      {((showInsufficientBalance.required || 0) - (showInsufficientBalance.balance || 0)).toLocaleString()}��
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={() => setShowInsufficientBalance(null)}
                className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium transition-colors"
              >
                Ȯ��
              </button>
            </div>
          </div>
        </div>
      )}

      {/* �ϴ� ��ũ */}
      <div className="max-w-7xl mx-auto px-4 py-6 mt-8 border-t border-gray-200 text-center text-xs text-gray-400 space-x-3">
        <a href="/privacy" target="_blank" className="hover:text-gray-600 transition">��������ó����ħ</a>
        <span>|</span>
        <a href="/terms" target="_blank" className="hover:text-gray-600 transition">�̿���</a>
        <span>|</span>
        <span>�� 2026 INVITO</span>
      </div>
    </div>
  );
}
