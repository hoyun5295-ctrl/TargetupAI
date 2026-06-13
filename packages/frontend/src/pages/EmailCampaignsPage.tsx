import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, Cake, Check, ChevronDown, ChevronUp, Clock,
  Crown, Edit2, Eye, EyeOff, Loader2, Lock, Mail, Moon, Newspaper, Package, PenLine, Plus,
  RefreshCw, Repeat, Send, Server, Settings, ShieldCheck, ShoppingCart, Smartphone, Sparkles,
  Trash2, TrendingUp, Users, Wand2, X, Zap,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';
// ★ D225+ (2026-05-28 Harold 명시): Email 발송 이력 모달 신설
import EmailEventsModal from '../components/email/EmailEventsModal';

// ★ 2026-06-13: AI 빠른 시작 7 시나리오 (백엔드 EMAIL_SCENARIO_PRESETS key와 1:1)
const EMAIL_QUICK_STARTS: Array<{ key: string; label: string; desc: string; icon: typeof Mail; grad: string }> = [
  { key: 'cart', label: '장바구니 리마인드', desc: '결제 미완료 고객 재유도', icon: ShoppingCart, grad: 'from-rose-500 to-pink-500' },
  { key: 'dormant', label: '휴면 재활성', desc: '오랜만에 다시 부르기', icon: Moon, grad: 'from-indigo-500 to-violet-500' },
  { key: 'vip', label: 'VIP 감사', desc: '우수 고객 전용 인사', icon: Crown, grad: 'from-amber-500 to-orange-500' },
  { key: 'new', label: '신상품 안내', desc: '새 상품·서비스 소개', icon: Package, grad: 'from-emerald-500 to-teal-500' },
  { key: 'repurchase', label: '재구매 유도', desc: '재구매 시점 환기', icon: Repeat, grad: 'from-cyan-500 to-blue-500' },
  { key: 'birthday', label: '생일 축하', desc: '생일 고객 축하 인사', icon: Cake, grad: 'from-fuchsia-500 to-pink-500' },
  { key: 'newsletter', label: '뉴스레터', desc: '브랜드 소식 정기 발송', icon: Newspaper, grad: 'from-sky-500 to-indigo-500' },
];

// AI 생성 진행 단계 (시각 효과 — 700ms 간격)
const EMAIL_GEN_STEPS = ['요청 의도 분석', '브랜드 톤 반영', '제목 3안 작성', '본문 구성', 'HTML 합성', '최종 점검'];

// ════════════════════════════════════════════════════════════════════
// ★ D215+ (2026-05-25) Email 캠페인 전면 재작성 — SMTP relay 흐름
//   영구 룰 정합:
//   - 모델명 사용자 노출 X
//   - native dialog X (ConfirmModal + useToast 의무)
//   - 비밀번호 평문 표시 X (type='password' + 마스킹)
//   - DB ALTER 503 응답 처리 (DB_MIGRATION_PENDING)
//   - SMTP 암호화 키 미설정 503 응답 처리 (SMTP_ENCRYPTION_KEY_MISSING)
//   - 모바일 반응형 default
// ════════════════════════════════════════════════════════════════════

type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed';

interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  fromName: string;
  fromEmail: string;
  isAd: boolean;
  aiGenerated?: boolean;
  scheduledAt: string | null;
  sentAt: string | null;
  status: CampaignStatus;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  createdAt: string;
}

// 편집 모달 상태 — 캠페인 필드 + AI 생성 부가(제목 3안·프리헤더·AI 플래그)
interface EditingCampaign extends Partial<EmailCampaign> {
  subjects?: string[];
  preheader?: string;
  aiGenerated?: boolean;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  secure: boolean;
  fromEmail: string;
  fromName: string | null;
  isConfigured: boolean;
}

// 4 표준 SMTP 가이드 (회사 admin 진입 단순화)
const SMTP_PRESETS = [
  {
    key: 'gmail',
    label: 'Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    hint: '2단계 인증 + 앱 비밀번호 발급 의무 (Google 계정 안 보안 → 앱 비밀번호)',
    docs: 'https://support.google.com/accounts/answer/185833',
  },
  {
    key: 'naver_works',
    label: 'Naver Works',
    host: 'smtp.worksmobile.com',
    port: 587,
    secure: false,
    hint: 'Naver Works 관리자 → 발신 메일 보안 설정 → SMTP 활성',
    docs: 'https://guide.worksmobile.com/kr/mail/external-smtp/',
  },
  {
    key: 'office365',
    label: 'Office 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Microsoft 365 계정 + 앱 비밀번호 또는 OAuth 인증',
    docs: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission',
  },
  {
    key: 'custom',
    label: '자체 메일 서버',
    host: '',
    port: 587,
    secure: false,
    hint: '회사 본인 메일 서버 정보 직접 입력 (host/port/user/password)',
    docs: null,
  },
];

const EMPTY_SMTP_FORM = {
  host: '',
  port: 587,
  user: '',
  password: '',
  secure: false,
  from_email: '',
  from_name: '',
};

const EMPTY_CAMPAIGN_FORM: Partial<EmailCampaign> = {
  name: '',
  subject: '',
  htmlBody: '<p>안녕하세요,</p>',
  textBody: null,
  fromName: '',
  fromEmail: '',
  isAd: false,
};

// ════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ════════════════════════════════════════════════════════════════════

export default function EmailCampaignsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    toast[type](message);
  };

  const [loading, setLoading] = useState(true);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpConfig, setSmtpConfig] = useState<SmtpConfig | null>(null);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // SMTP 설정 영역
  const [smtpFormOpen, setSmtpFormOpen] = useState(false);
  const [smtpForm, setSmtpForm] = useState(EMPTY_SMTP_FORM);
  const [smtpFormSaving, setSmtpFormSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [presetKey, setPresetKey] = useState<string>('gmail');

  // 테스트 발송 영역
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);

  // 캠페인 신설/수정 모달
  const [editing, setEditing] = useState<EditingCampaign | null>(null);
  const [campaignSaving, setCampaignSaving] = useState(false);

  // ★ 2026-06-13: AI 원샷 생성 영역
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAsAd, setAiAsAd] = useState(true);
  const [genStep, setGenStep] = useState<number | null>(null); // null=비진행, 0~5=진행 단계
  const genTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 캠페인 발송 진행 상태
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [recipientsModal, setRecipientsModal] = useState<{ campaign: EmailCampaign } | null>(null);
  // ★ D225+ (2026-05-28): 발송 이력 모달 — sentCount > 0 영역 시 활성
  const [eventsModal, setEventsModal] = useState<{ id: string; name: string } | null>(null);
  // ★ 2026-06-13: AI 성과 진단 / 미오픈자 SMS 모달
  const [insightModal, setInsightModal] = useState<{ campaign: EmailCampaign } | null>(null);
  const [nonOpenerModal, setNonOpenerModal] = useState<{ campaign: EmailCampaign } | null>(null);
  // AI 캠페인 발송 확정 30크레딧 확인
  const [creditConfirm, setCreditConfirm] = useState<{ campaign: EmailCampaign; payload: any; desc: string } | null>(null);

  const token = () => localStorage.getItem('token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  // ────────────────────────────────────────────────────────────────
  // 데이터 로드
  // ────────────────────────────────────────────────────────────────

  const handle503 = (data: any): boolean => {
    if (data?.code === 'DB_MIGRATION_PENDING') {
      setError(data.error || 'DB 마이그레이션 필요 — 운영자에게 문의해주세요.');
      showToast('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
      return true;
    }
    if (data?.code === 'SMTP_ENCRYPTION_KEY_MISSING') {
      setError(data.error || 'SMTP 암호화 키 미설정 — 운영자에게 문의해주세요.');
      showToast('SMTP 암호화 키 미설정 — 운영자에게 .env 등록 요청 의무', 'warning');
      return true;
    }
    return false;
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, configRes, listRes] = await Promise.all([
        fetch('/api/email/status', { headers: authHeaders() }),
        fetch('/api/email/smtp-config', { headers: authHeaders() }),
        fetch('/api/email/campaigns?limit=50', { headers: authHeaders() }),
      ]);
      const [statusData, configData, listData] = await Promise.all([
        statusRes.json(), configRes.json(), listRes.json(),
      ]);

      if (handle503(statusData) || handle503(configData) || handle503(listData)) return;

      if (statusData.success) setSmtpConfigured(!!statusData.smtp_configured);
      if (configData.success && configData.config) {
        setSmtpConfig(configData.config);
        if (configData.config.isConfigured) {
          setSmtpForm({
            host: configData.config.host || '',
            port: configData.config.port || 587,
            user: configData.config.user || '',
            password: '',  // 평문 응답 X — 마스킹
            secure: !!configData.config.secure,
            from_email: configData.config.fromEmail || '',
            from_name: configData.config.fromName || '',
          });
        }
      }
      if (listData.success) setCampaigns(listData.campaigns || []);
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
      showToast(e?.message || '조회 중 오류', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // ────────────────────────────────────────────────────────────────
  // SMTP 설정 저장 / 삭제 / 테스트
  // ────────────────────────────────────────────────────────────────

  const applyPreset = (key: string) => {
    const preset = SMTP_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setPresetKey(key);
    setSmtpForm((prev) => ({
      ...prev,
      host: preset.host || prev.host,
      port: preset.port,
      secure: preset.secure,
    }));
  };

  const handleSaveSmtp = async () => {
    if (!smtpForm.host.trim() || !smtpForm.port || !smtpForm.user.trim() || !smtpForm.password.trim() || !smtpForm.from_email.trim()) {
      showToast('host / port / user / password / from_email 필수', 'warning');
      return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(smtpForm.from_email)) {
      showToast('from_email 형식 오류', 'warning');
      return;
    }
    setSmtpFormSaving(true);
    try {
      const res = await fetch('/api/email/smtp-config', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(smtpForm),
      });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        showToast('SMTP 설정 저장 완료', 'success');
        setSmtpForm((prev) => ({ ...prev, password: '' }));  // 비밀번호 즉시 폐기
        setSmtpFormOpen(false);
        await loadAll();
      } else {
        showToast(data.error || 'SMTP 설정 저장 실패', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'SMTP 설정 저장 중 오류', 'error');
    } finally {
      setSmtpFormSaving(false);
    }
  };

  const handleClearSmtp = () => {
    setConfirmState({
      mode: 'danger',
      title: 'SMTP 설정 영구 제거',
      description: '회사 SMTP 정보 (host/port/user/password/from) 모두 영구 제거됩니다. Email 캠페인 발송 불가 상태로 전환. 재설정 시 다시 입력 의무.',
      confirmLabel: '영구 제거',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/email/smtp-config', { method: 'DELETE', headers: authHeaders() });
          const data = await res.json();
          if (handle503(data)) return;
          if (data.success) {
            showToast('SMTP 설정 영구 제거 완료', 'success');
            setSmtpForm(EMPTY_SMTP_FORM);
            await loadAll();
          } else {
            showToast(data.error || 'SMTP 설정 제거 실패', 'error');
          }
        } catch (e: any) {
          showToast(e?.message || 'SMTP 설정 제거 중 오류', 'error');
        }
      },
    });
  };

  const handleTestSend = async () => {
    if (!testEmail.trim()) {
      showToast('테스트 수신 이메일 입력 의무', 'warning');
      return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(testEmail)) {
      showToast('이메일 형식 오류', 'warning');
      return;
    }
    setTestSending(true);
    try {
      const res = await fetch('/api/email/smtp-test', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ to_email: testEmail }),
      });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        showToast(`테스트 발송 완료 — ${testEmail} 수신 확인해주세요 (스팸 폴더도 확인)`, 'success');
      } else {
        showToast(data.error || '테스트 발송 실패', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || '테스트 발송 중 오류', 'error');
    } finally {
      setTestSending(false);
    }
  };

  // ────────────────────────────────────────────────────────────────
  // 캠페인 저장 / 삭제 / 발송
  // ────────────────────────────────────────────────────────────────

  const handleSaveCampaign = async () => {
    if (!editing?.name?.trim() || !editing?.subject?.trim() || !editing?.htmlBody?.trim()) {
      showToast('이름 / 제목 / HTML 본문 필수', 'warning');
      return;
    }
    setCampaignSaving(true);
    try {
      const isUpdate = !!editing.id;
      const url = isUpdate ? `/api/email/campaigns/${editing.id}` : '/api/email/campaigns';
      const method = isUpdate ? 'PATCH' : 'POST';
      const body: any = {
        name: editing.name,
        subject: editing.subject,
        html_body: editing.htmlBody,
        is_ad: !!editing.isAd,
      };
      if (editing.textBody) body.text_body = editing.textBody;
      if (editing.fromName) body.from_name = editing.fromName;
      if (editing.fromEmail) body.from_email = editing.fromEmail;
      if (!isUpdate && editing.aiGenerated) body.ai_generated = true; // AI 생성 캠페인 마킹 (발송 시 30크레딧 분기)

      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        showToast(isUpdate ? '캠페인 수정 완료' : '캠페인 생성 완료', 'success');
        setEditing(null);
        await loadAll();
      } else {
        showToast(data.error || '저장 실패', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || '저장 중 오류', 'error');
    } finally {
      setCampaignSaving(false);
    }
  };

  const handleDeleteCampaign = (c: EmailCampaign) => {
    setConfirmState({
      mode: 'danger',
      title: '캠페인 삭제',
      description: `"${c.name}" 캠페인을 영구 삭제합니다. 통계 + 이벤트 이력도 함께 제거됩니다.`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/email/campaigns/${c.id}`, { method: 'DELETE', headers: authHeaders() });
          const data = await res.json();
          if (data.success) {
            showToast('캠페인 삭제 완료', 'success');
            await loadAll();
          } else {
            showToast(data.error || '삭제 실패', 'error');
          }
        } catch (e: any) {
          showToast(e?.message || '삭제 중 오류', 'error');
        }
      },
    });
  };

  const openRecipientsModal = (c: EmailCampaign) => {
    setRecipientsModal({ campaign: c });
  };

  // ──────────────── AI 원샷 생성 (1클릭 = AI 자동 흐름 + 편집 모드 진입) ────────────────
  const handleAiGenerate = async (opts: { scenario?: string; prompt?: string }) => {
    if (genStep !== null) return; // 중복 방지
    if (!opts.scenario && !opts.prompt?.trim()) {
      showToast('만들고 싶은 이메일을 한 줄로 입력하거나 빠른 시작을 골라주세요.', 'warning');
      return;
    }
    setGenStep(0);
    // 진행 단계 시각 효과 — 700ms 간격으로 마지막 직전까지 전진
    genTimer.current = setInterval(() => {
      setGenStep((s) => (s === null ? 0 : Math.min(s + 1, EMAIL_GEN_STEPS.length - 1)));
    }, 700);
    try {
      const res = await fetch('/api/email/ai/generate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ scenario: opts.scenario, prompt: opts.prompt?.trim() || undefined, is_ad: aiAsAd }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { showToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (handle503(data)) return;
      if (data.success && data.data) {
        const g = data.data;
        setAiPrompt('');
        setEditing({
          ...EMPTY_CAMPAIGN_FORM,
          name: g.name,
          subject: (g.subjects && g.subjects[0]) || '',
          subjects: g.subjects || [],
          preheader: g.preheader || '',
          htmlBody: g.htmlBody,
          textBody: g.textBody || null,
          isAd: aiAsAd,
          aiGenerated: true,
          fromEmail: smtpConfig?.fromEmail || '',
          fromName: smtpConfig?.fromName || '한줄로AI',
        });
        showToast('AI 생성 완료 — 내용을 확인하고 다듬어주세요. (3 크레딧)', 'success');
      } else {
        showToast(data.error || 'AI 생성 실패', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || 'AI 생성 중 오류', 'error');
    } finally {
      if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; }
      setGenStep(null);
    }
  };

  useEffect(() => () => { if (genTimer.current) clearInterval(genTimer.current); }, []);

  // ──────────────── 발송 진행 (수신자 모달 → 확인 → POST → 폴링) ────────────────
  const pollCampaign = (campaignId: string) => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/email/campaigns/${campaignId}`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success && data.campaign) {
          setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? { ...c, ...data.campaign } : c)));
          if (data.campaign.status !== 'sending') { clearInterval(t); setSendingId((id) => (id === campaignId ? null : id)); }
        }
      } catch { /* 폴링 실패는 다음 주기 재시도 */ }
    }, 3000);
    // 안전망 — 5분 후 폴링 종료
    setTimeout(() => clearInterval(t), 5 * 60 * 1000);
  };

  const doSend = async (campaign: EmailCampaign, payload: any) => {
    setSendingId(campaign.id);
    setRecipientsModal(null);
    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}/send`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { showToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); setSendingId(null); return; }
      if (handle503(data)) { setSendingId(null); return; }
      if (data.success) {
        if (data.scheduled) {
          showToast(`예약 완료 — ${new Date(data.scheduledAt).toLocaleString('ko-KR')} 발송 (대상 ${data.total}명)`, 'success');
          setSendingId(null);
          await loadAll();
        } else {
          showToast(`발송 시작 — 대상 ${data.total}명 (진행 상황 자동 갱신)`, 'success');
          pollCampaign(campaign.id);
        }
      } else {
        showToast(data.error || '발송 실패', 'error');
        setSendingId(null);
      }
    } catch (e: any) {
      showToast(e?.message || '발송 중 오류', 'error');
      setSendingId(null);
    }
  };

  // RecipientsModal → 발송 확정. AI 캠페인이면 30크레딧 확인 모달, 아니면 일반 확인 모달.
  const handleProceedSend = (campaign: EmailCampaign, payload: any, total: number) => {
    setRecipientsModal(null);
    const sched = payload.mode === 'scheduled';
    const desc = `${total.toLocaleString()}명에게 ${sched ? '예약' : '즉시'} 발송합니다.${campaign.isAd ? ' (광고성 — "(광고)" + 수신거부 링크 자동 부착)' : ''} 발신 = ${campaign.fromEmail}`;
    if (campaign.aiGenerated) {
      // AI 생성 캠페인 = 발송 확정 시 30크레딧 (최초 1회). CreditConfirmModal 의무.
      setCreditConfirm({ campaign, payload, desc });
    } else {
      setConfirmState({
        mode: campaign.isAd ? 'warning' : 'info',
        title: '캠페인 발송 확인',
        description: desc,
        confirmLabel: sched ? '예약' : '발송',
        onConfirm: () => doSend(campaign, payload),
      });
    }
  };

  // ────────────────────────────────────────────────────────────────
  // 통계 요약
  // ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const sent = campaigns.reduce((acc, c) => acc + (c.sentCount || 0), 0);
    const opens = campaigns.reduce((acc, c) => acc + (c.openCount || 0), 0);
    const clicks = campaigns.reduce((acc, c) => acc + (c.clickCount || 0), 0);
    const bounces = campaigns.reduce((acc, c) => acc + (c.bounceCount || 0), 0);
    return {
      total: campaigns.length,
      active: campaigns.filter((c) => c.status === 'completed' || c.status === 'sending').length,
      sent,
      openRate: sent > 0 ? (opens / sent) * 100 : 0,
      clickRate: sent > 0 ? (clicks / sent) * 100 : 0,
      bounceRate: sent > 0 ? (bounces / sent) * 100 : 0,
    };
  }, [campaigns]);

  // ════════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════════

  return (
    // ★ D222+ Phase 3 (2026-05-27): 다크 → 보라 그라데이션 톤 다운
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      {/* 상단 헤더 — D222+ Phase 3 보라 톤 다운 */}
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">Email 캠페인</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">회사 SMTP 직접 등록 → 본인 도메인 발신 + 광고 자동 합성 + 오픈/클릭 트래킹</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={loadAll} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors" aria-label="새로고침">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">새로고침</span>
            </button>
            <button
              onClick={() => setEditing({ ...EMPTY_CAMPAIGN_FORM, fromEmail: smtpConfig?.fromEmail || '', fromName: smtpConfig?.fromName || '한줄로AI' })}
              disabled={!smtpConfigured}
              className="text-xs bg-gradient-to-r from-blue-500/40 to-sky-500/40 hover:from-blue-500/60 hover:to-sky-500/60 disabled:opacity-40 disabled:cursor-not-allowed text-blue-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-blue-400/30"
              title={smtpConfigured ? undefined : 'SMTP 설정 완료 후 활용 가능'}
            >
              <Plus className="w-3.5 h-3.5" />
              신규 캠페인
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {error && (
          <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* SMTP 설정 미완료 안내 */}
        {!smtpConfigured && !loading && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-4 md:p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-100 mb-1">SMTP 설정 미완료 — Email 캠페인 발송 불가</h3>
                <p className="text-xs text-amber-200/80 mb-3">
                  회사 admin 본인 메일 서버 (Google Workspace / Naver Works / Office 365 / 자체 메일 서버) SMTP 정보 등록 후 발송 가능합니다.
                  발신 도메인 = 회사 본인 도메인 = 한줄로 부담 0 + SPF/DKIM/DMARC 회사 본인 책임.
                </p>
                <button
                  onClick={() => setSmtpFormOpen(true)}
                  className="text-xs bg-amber-500/30 hover:bg-amber-500/50 text-amber-100 px-3 py-2 rounded-lg font-medium flex items-center gap-1.5"
                >
                  <Settings className="w-3.5 h-3.5" />
                  SMTP 설정 시작
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SMTP 설정 완료 안내 + 펼침 토글 */}
        {smtpConfigured && smtpConfig?.isConfigured && (
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-xl p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <ShieldCheck className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-[240px]">
                <h3 className="text-sm font-bold text-emerald-100">SMTP 설정 완료 — 발송 가능 상태</h3>
                <div className="text-xs text-emerald-200/80 mt-1">
                  <span className="font-mono">{smtpConfig.host}:{smtpConfig.port}</span> · 발신 <span className="font-mono">{smtpConfig.fromEmail}</span>
                  {smtpConfig.fromName && <span> ({smtpConfig.fromName})</span>}
                  · {smtpConfig.secure ? 'SSL/TLS' : 'STARTTLS'}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSmtpFormOpen(true)}
                  className="text-xs text-cyan-300 hover:bg-cyan-500/10 px-3 py-1.5 rounded flex items-center gap-1"
                >
                  <Edit2 className="w-3 h-3" /> 수정
                </button>
                <button
                  onClick={handleClearSmtp}
                  className="text-xs text-rose-300 hover:bg-rose-500/10 px-3 py-1.5 rounded flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 영구 제거
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 테스트 발송 영역 (SMTP 설정 완료 시 표시) */}
        {smtpConfigured && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Send className="w-4 h-4 text-cyan-300" /> 테스트 발송
            </h3>
            <p className="text-xs text-white/50 mb-3">회사 admin 본인 이메일에 테스트 발송 → SMTP 설정 정상 동작 확인</p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="테스트 수신 이메일 (예: admin@example.com)"
                className="flex-1 min-w-[200px] px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
              />
              <button
                onClick={handleTestSend}
                disabled={testSending || !testEmail.trim()}
                className="px-4 py-2 bg-cyan-500/30 hover:bg-cyan-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-cyan-100 text-sm font-medium rounded-lg flex items-center gap-1.5"
              >
                {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {testSending ? '발송 중...' : '테스트 발송'}
              </button>
            </div>
          </div>
        )}

        {/* ★ 2026-06-13: AI 원샷 생성 — 자연어 입력 + 빠른 시작 7 카드 (SMTP 완료 시) */}
        {smtpConfigured && (
          <div className="bg-gradient-to-br from-fuchsia-600/20 via-purple-600/15 to-indigo-600/20 border border-fuchsia-400/30 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/20">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">AI로 이메일 만들기</div>
                <div className="text-[11px] text-white/50">한 줄만 입력하면 제목·본문·HTML까지 한 번에 (3 크레딧)</div>
              </div>
            </div>
            <div className="flex flex-col md:flex-row gap-2 mb-3">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && genStep === null) handleAiGenerate({ prompt: aiPrompt }); }}
                placeholder="예: 여름 신상 입고 안내, VIP 고객에게 정중한 톤으로"
                disabled={genStep !== null}
                className="flex-1 px-4 py-2.5 bg-violet-950/50 border border-white/15 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/60 disabled:opacity-50"
              />
              <button
                onClick={() => handleAiGenerate({ prompt: aiPrompt })}
                disabled={genStep !== null || !aiPrompt.trim()}
                className="px-5 py-2.5 bg-gradient-to-r from-fuchsia-500 to-purple-500 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {genStep !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {genStep !== null ? '생성 중...' : 'AI 생성'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-white/60 mb-3 cursor-pointer w-fit">
              <input type="checkbox" checked={aiAsAd} onChange={(e) => setAiAsAd(e.target.checked)} disabled={genStep !== null} className="rounded" />
              광고성 이메일로 만들기 (발송 시 "(광고)" + 수신거부 링크 자동 부착)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {EMAIL_QUICK_STARTS.map((qs) => (
                <button
                  key={qs.key}
                  onClick={() => handleAiGenerate({ scenario: qs.key })}
                  disabled={genStep !== null}
                  className="group bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 rounded-xl p-3 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${qs.grad} flex items-center justify-center mb-2 shadow-md`}>
                    <qs.icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-xs font-semibold text-white leading-tight">{qs.label}</div>
                  <div className="text-[10px] text-white/45 mt-0.5 leading-tight">{qs.desc}</div>
                </button>
              ))}
            </div>
            <div className="text-[10px] text-white/30 italic mt-3">
              Data source — 회사 Brand Voice 학습 결과 자동 반영 · 구체 혜택은 직접 입력
            </div>
          </div>
        )}

        {/* 안내 카드 — 영구 원칙 */}
        <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 text-xs text-amber-100 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>영구 원칙:</strong> 광고성 캠페인 = "(광고)" prefix + 수신거부 링크 자동 부착 (정보통신망법).
            수신자 0건 = 발송 차단 (Zero-Count). 발송 시점 = 즉시 confirm 모달 의무.
            발신 도메인 = 회사 본인 SMTP (SPF/DKIM/DMARC 회사 admin 본인 책임).
          </div>
        </div>

        {/* 통계 요약 (캠페인 있는 경우) */}
        {campaigns.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: '총 캠페인', value: stats.total.toLocaleString(), icon: Mail },
              { label: '활성', value: stats.active.toLocaleString(), icon: ShieldCheck },
              { label: '총 발송', value: stats.sent.toLocaleString(), icon: Send },
              { label: '오픈율', value: `${stats.openRate.toFixed(1)}%`, icon: Eye },
              { label: '클릭률', value: `${stats.clickRate.toFixed(1)}%`, icon: Eye },
              { label: '반송률', value: `${stats.bounceRate.toFixed(1)}%`, icon: AlertCircle },
            ].map((metric, idx) => (
              <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <metric.icon className="w-3 h-3 text-white/40" />
                  <span className="text-[10px] text-white/50">{metric.label}</span>
                </div>
                <div className="text-lg font-bold text-white">{metric.value}</div>
              </div>
            ))}
          </div>
        )}
        {campaigns.length > 0 && (
          <div className="text-[10px] text-white/30 italic">Data source — email_campaigns + email_events 누적 통계</div>
        )}

        {/* 캠페인 목록 */}
        {loading ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex justify-center text-white/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-sm text-white/50">
            아직 등록된 캠페인이 없습니다.
            {smtpConfigured ? ' "신규 캠페인" 버튼을 눌러 시작해주세요.' : ' SMTP 설정 후 진입 가능합니다.'}
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-base font-bold text-white">{c.name}</span>
                      <StatusBadge status={c.status} />
                      {c.isAd && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full font-medium">광고성</span>}
                    </div>
                    <div className="text-xs text-white/70 mb-2">제목: {c.subject}</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-white/50">
                      <span>발송 <strong className="text-indigo-300">{c.sentCount.toLocaleString()}</strong></span>
                      <span>·</span>
                      <span>오픈 <strong className="text-emerald-300">{c.openCount.toLocaleString()}</strong> ({c.sentCount > 0 ? ((c.openCount / c.sentCount) * 100).toFixed(1) : 0}%)</span>
                      <span>·</span>
                      <span>클릭 <strong className="text-cyan-300">{c.clickCount.toLocaleString()}</strong> ({c.sentCount > 0 ? ((c.clickCount / c.sentCount) * 100).toFixed(1) : 0}%)</span>
                      <span>·</span>
                      <span>반송 <strong className="text-rose-300">{c.bounceCount.toLocaleString()}</strong></span>
                      <span>·</span>
                      <span>수신거부 <strong className="text-white/50">{c.unsubscribeCount.toLocaleString()}</strong></span>
                    </div>
                    {c.sentAt && (
                      <div className="text-[10px] text-white/40 mt-1">발송 일자: {new Date(c.sentAt).toLocaleString('ko-KR')}</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {(c.status === 'draft' || c.status === 'failed') && (
                      <button
                        onClick={() => openRecipientsModal(c)}
                        disabled={sendingId === c.id || !smtpConfigured}
                        className="text-[11px] bg-blue-500/30 hover:bg-blue-500/50 disabled:opacity-40 text-blue-100 px-2.5 py-1 rounded flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        {sendingId === c.id ? '발송 중...' : '발송'}
                      </button>
                    )}
                    {/* ★ D225+ (2026-05-28): 발송 이력 보기 — sentCount > 0 영역 시 활성 */}
                    {c.sentCount > 0 && (
                      <button
                        onClick={() => setEventsModal({ id: c.id, name: c.name })}
                        className="text-[11px] text-emerald-300 hover:bg-emerald-500/10 px-2.5 py-1 rounded flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" /> 이력
                      </button>
                    )}
                    {/* ★ 2026-06-13: 완료 캠페인 — AI 성과 진단 + 미오픈자 SMS */}
                    {c.status === 'completed' && c.sentCount > 0 && (
                      <>
                        <button
                          onClick={() => setInsightModal({ campaign: c })}
                          className="text-[11px] text-fuchsia-300 hover:bg-fuchsia-500/10 px-2.5 py-1 rounded flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" /> AI 진단
                        </button>
                        <button
                          onClick={() => setNonOpenerModal({ campaign: c })}
                          className="text-[11px] text-cyan-300 hover:bg-cyan-500/10 px-2.5 py-1 rounded flex items-center gap-1"
                        >
                          <Smartphone className="w-3 h-3" /> 미오픈 SMS
                        </button>
                      </>
                    )}
                    <button onClick={() => setEditing(c)} className="text-[11px] text-indigo-300 hover:bg-indigo-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                      <Edit2 className="w-3 h-3" /> 수정
                    </button>
                    <button onClick={() => handleDeleteCampaign(c)} className="text-[11px] text-rose-300 hover:bg-rose-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> 삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ★ D225+ 발송 이력 모달 */}
      {eventsModal && (
        <EmailEventsModal
          campaignId={eventsModal.id}
          campaignName={eventsModal.name}
          onClose={() => setEventsModal(null)}
          token={localStorage.getItem('token') || ''}
          onToast={(msg, type) => {
            if (type === 'success') toast.success(msg);
            else if (type === 'error') toast.error(msg);
            else if (type === 'warning') toast.warning(msg);
            else toast.info(msg);
          }}
        />
      )}

      {/* SMTP 설정 모달 */}
      {smtpFormOpen && (
        <SmtpFormModal
          form={smtpForm}
          setForm={setSmtpForm}
          presetKey={presetKey}
          setPresetKey={applyPreset}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          saving={smtpFormSaving}
          onSave={handleSaveSmtp}
          onClose={() => setSmtpFormOpen(false)}
          isUpdate={smtpConfig?.isConfigured || false}
        />
      )}

      {/* 캠페인 신설/수정 모달 */}
      {editing && (
        <CampaignFormModal
          editing={editing}
          setEditing={setEditing}
          saving={campaignSaving}
          onSave={handleSaveCampaign}
          authHeaders={authHeaders}
          onToast={showToast}
        />
      )}

      {/* 발송 수신자 모달 (2탭 — 고객DB / 직접 입력 + 즉시/예약 + 발송 전 AI 진단) */}
      {recipientsModal && (
        <RecipientsModal
          campaign={recipientsModal.campaign}
          authHeaders={authHeaders}
          onProceed={(payload, total) => handleProceedSend(recipientsModal.campaign, payload, total)}
          onClose={() => setRecipientsModal(null)}
          onToast={showToast}
        />
      )}

      {/* AI 성과 진단 모달 */}
      {insightModal && (
        <InsightModal
          campaign={insightModal.campaign}
          authHeaders={authHeaders}
          onClose={() => setInsightModal(null)}
          onToast={showToast}
        />
      )}

      {/* 미오픈자 SMS 크로스 채널 모달 */}
      {nonOpenerModal && (
        <NonOpenerModal
          campaign={nonOpenerModal.campaign}
          authHeaders={authHeaders}
          onClose={() => setNonOpenerModal(null)}
          onToast={showToast}
          onGoSms={() => navigate('/dashboard')}
        />
      )}

      {/* AI 캠페인 발송 확정 30크레딧 확인 */}
      <CreditConfirmModal
        open={!!creditConfirm}
        source="email-ai-publish"
        onConfirm={() => { if (creditConfirm) { const cc = creditConfirm; setCreditConfirm(null); doSend(cc.campaign, cc.payload); } }}
        onCancel={() => setCreditConfirm(null)}
      />

      {/* AI 생성 진행 오버레이 */}
      {genStep !== null && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm bg-violet-950/80 border border-fuchsia-400/30 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">AI가 이메일을 만들고 있어요</div>
                <div className="text-[11px] text-white/50">잠시만 기다려주세요</div>
              </div>
            </div>
            <div className="space-y-2">
              {EMAIL_GEN_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {i < (genStep ?? 0) ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : i === (genStep ?? 0) ? (
                    <Loader2 className="w-4 h-4 text-fuchsia-300 animate-spin shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-white/20 shrink-0" />
                  )}
                  <span className={i <= (genStep ?? 0) ? 'text-white/90' : 'text-white/40'}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ConfirmModal */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SMTP 설정 모달
// ════════════════════════════════════════════════════════════════════

interface SmtpFormModalProps {
  form: typeof EMPTY_SMTP_FORM;
  setForm: (form: typeof EMPTY_SMTP_FORM) => void;
  presetKey: string;
  setPresetKey: (key: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  isUpdate: boolean;
}

function SmtpFormModal({ form, setForm, presetKey, setPresetKey, showPassword, setShowPassword, saving, onSave, onClose, isUpdate }: SmtpFormModalProps) {
  const currentPreset = SMTP_PRESETS.find((p) => p.key === presetKey);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-300" />
            {isUpdate ? 'SMTP 설정 수정' : 'SMTP 설정 등록'}
          </h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 표준 SMTP 가이드 */}
          <div>
            <label className="text-xs font-bold text-white/80 block mb-2">메일 서버 선택 (자동 입력 활용)</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SMTP_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => setPresetKey(preset.key)}
                  className={`text-xs px-2 py-2 rounded-lg border transition-colors ${
                    presetKey === preset.key
                      ? 'bg-blue-500/30 border-blue-400/60 text-white'
                      : 'bg-violet-900/50 border-white/10 text-white/70 hover:bg-white/5'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {currentPreset && (
              <div className="text-[10px] text-white/50 mt-2 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  {currentPreset.hint}
                  {currentPreset.docs && (
                    <> · <a href={currentPreset.docs} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">공식 가이드</a></>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* SMTP 정보 입력 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr,120px] gap-3">
            <div>
              <label className="text-xs text-white/70 block mb-1">SMTP 서버 (host)</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              />
            </div>
            <div>
              <label className="text-xs text-white/70 block mb-1">포트 (port)</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value, 10) || 587 })}
                placeholder="587"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-white/70 block mb-1">사용자 (user) — 보통 이메일 주소</label>
            <input
              type="text"
              value={form.user}
              onChange={(e) => setForm({ ...form, user: e.target.value })}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
            />
          </div>

          <div>
            <label className="text-xs text-white/70 block mb-1 flex items-center gap-1">
              <Lock className="w-3 h-3" /> 비밀번호 (password) — 앱 비밀번호 권장 (Google 2단계 인증 영역)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={isUpdate ? '변경 시에만 새 비밀번호 입력' : '앱 비밀번호 (16자)'}
                className="w-full px-3 py-2 pr-10 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-1"
                aria-label={showPassword ? '비밀번호 숨김' : '비밀번호 표시'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-white/40 mt-1">서버 저장 시 AES-256-GCM 암호화 — 평문 응답/로그 X</div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="smtp_secure"
              checked={form.secure}
              onChange={(e) => setForm({ ...form, secure: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="smtp_secure" className="text-xs text-white/80">
              SSL/TLS 직접 연결 (포트 465 영역). 미체크 = STARTTLS (포트 587 default).
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/70 block mb-1">발신 이메일 (from_email)</label>
              <input
                type="email"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                placeholder="noreply@example.com"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              />
            </div>
            <div>
              <label className="text-xs text-white/70 block mb-1">발신자 이름 (from_name, 선택)</label>
              <input
                type="text"
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                placeholder="브랜드명 또는 회사명"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-violet-900/40 border-t border-white/10 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/70 hover:bg-white/5 rounded-lg">취소</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-sky-500 hover:from-blue-600 hover:to-sky-600 disabled:opacity-40 text-white text-sm font-bold rounded-lg flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? '저장 중...' : isUpdate ? '수정 저장' : 'SMTP 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 캠페인 신설/수정 모달
// ════════════════════════════════════════════════════════════════════

interface CampaignFormModalProps {
  editing: EditingCampaign;
  setEditing: (c: EditingCampaign | null) => void;
  saving: boolean;
  onSave: () => void;
  authHeaders: () => Record<string, string>;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

function CampaignFormModal({ editing, setEditing, saving, onSave, authHeaders, onToast }: CampaignFormModalProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refining, setRefining] = useState(false);
  const subjects = editing.subjects || [];

  const handleRefine = async () => {
    if (!refineInstruction.trim()) { onToast('어떻게 다듬을지 입력해주세요.', 'warning'); return; }
    if (!editing.subject?.trim() || !editing.htmlBody?.trim()) { onToast('제목과 본문이 필요합니다.', 'warning'); return; }
    setRefining(true);
    try {
      const res = await fetch('/api/email/ai/refine', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ subject: editing.subject, html_body: editing.htmlBody, instruction: refineInstruction.trim() }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success && data.data) {
        setEditing({ ...editing, subject: data.data.subject, htmlBody: data.data.htmlBody });
        setRefineInstruction('');
        onToast('AI가 다듬었습니다. (1 크레딧)', 'success');
      } else {
        onToast(data.error || 'AI 다듬기 실패', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || 'AI 다듬기 중 오류', 'error');
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            {editing.aiGenerated && <Sparkles className="w-4 h-4 text-fuchsia-300" />}
            {editing.id ? '캠페인 수정' : editing.aiGenerated ? 'AI 생성 이메일 — 확인 후 발송' : '신규 Email 캠페인'}
          </h3>
          <button onClick={() => setEditing(null)} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <div>
            <label className="text-xs text-white/70 block mb-1">캠페인 이름 (회사 admin 내부 식별용)</label>
            <input
              type="text"
              value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="VIP 5월 재구매 안내"
              className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs text-white/70 block mb-1">제목 (수신자 노출 subject)</label>
            <input
              type="text"
              value={editing.subject || ''}
              onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
              placeholder="VIP 회원님께 드리는 5월 특별 안내"
              className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              maxLength={200}
            />
            {(editing.subject || '').length > 40 && (
              <div className="text-[10px] text-amber-300 mt-1">제목 {(editing.subject || '').length}자 — 모바일 수신함에서 40자 이후가 잘릴 수 있어요.</div>
            )}
            {/* AI 제목 3안 칩 */}
            {subjects.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[10px] text-white/40 self-center">AI 제안:</span>
                {subjects.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setEditing({ ...editing, subject: s })}
                    className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${editing.subject === s ? 'bg-fuchsia-500/30 border-fuchsia-400/50 text-white' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'}`}
                  >
                    {s.length > 24 ? s.slice(0, 24) + '…' : s}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 프리헤더 (AI 생성 시) */}
          {(editing.aiGenerated || editing.preheader) && (
            <div>
              <label className="text-xs text-white/70 block mb-1">프리헤더 (수신함 미리보기 — 제목 옆 회색 글씨)</label>
              <input
                type="text"
                value={editing.preheader || ''}
                onChange={(e) => setEditing({ ...editing, preheader: e.target.value })}
                placeholder="수신함에서 제목과 함께 보이는 한 줄"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
                maxLength={100}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/70 block mb-1">발신자 이름 (선택)</label>
              <input
                type="text"
                value={editing.fromName || ''}
                onChange={(e) => setEditing({ ...editing, fromName: e.target.value })}
                placeholder="SMTP 설정 default 활용"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-xs text-white/70 block mb-1">발신 이메일 (선택)</label>
              <input
                type="email"
                value={editing.fromEmail || ''}
                onChange={(e) => setEditing({ ...editing, fromEmail: e.target.value })}
                placeholder="SMTP 설정 default 활용"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              />
            </div>
          </div>
          {/* AI 다듬기 (1 크레딧) */}
          <div className="bg-fuchsia-500/10 border border-fuchsia-400/25 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] text-fuchsia-200 font-semibold">
              <Wand2 className="w-3.5 h-3.5" /> AI 다듬기 (1 크레딧)
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                type="text"
                value={refineInstruction}
                onChange={(e) => setRefineInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !refining) handleRefine(); }}
                placeholder="예: 더 친근한 말투로, 버튼 문구 강조"
                disabled={refining}
                className="flex-1 px-3 py-2 bg-violet-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50 disabled:opacity-50"
              />
              <button
                onClick={handleRefine}
                disabled={refining || !refineInstruction.trim()}
                className="px-3 py-2 bg-fuchsia-500/40 hover:bg-fuchsia-500/60 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                다듬기
              </button>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-white/70">HTML 본문</label>
              <button onClick={() => setShowPreview((v) => !v)} className="text-[11px] text-white/50 hover:text-white flex items-center gap-1">
                {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showPreview ? 'HTML 코드 보기' : '미리보기'}
              </button>
            </div>
            {showPreview ? (
              <iframe
                title="이메일 미리보기"
                srcDoc={editing.htmlBody || ''}
                className="w-full h-72 bg-white rounded-lg border border-white/10"
                sandbox=""
              />
            ) : (
              <textarea
                value={editing.htmlBody || ''}
                onChange={(e) => setEditing({ ...editing, htmlBody: e.target.value })}
                placeholder="<p>안녕하세요, {{이름}}님</p>"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-xs font-mono resize-y h-72 text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
              />
            )}
            <div className="text-[10px] text-white/40 mt-1">{`{{이름}}`} = 발송 시 고객 이름 자동 치환 · 수신거부 링크는 발송 시 자동 부착</div>
          </div>
          <div>
            <label className="text-xs text-white/70 block mb-1">텍스트 본문 (선택 — HTML 미지원 클라이언트 대응)</label>
            <textarea
              value={editing.textBody || ''}
              onChange={(e) => setEditing({ ...editing, textBody: e.target.value })}
              placeholder="안녕하세요, {{이름}}님"
              className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-xs resize-y h-20 text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50"
            />
          </div>
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-400/30 rounded-lg p-3">
            <input
              type="checkbox"
              id="campaign_is_ad"
              checked={!!editing.isAd}
              onChange={(e) => setEditing({ ...editing, isAd: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="campaign_is_ad" className="text-xs text-amber-100">
              <strong>광고성 이메일</strong> — 체크 시 "(광고)" prefix + 수신거부 링크 자동 부착 (정보통신망법 의무).
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 bg-violet-900/40 border-t border-white/10 px-6 py-3 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-white/70 hover:bg-white/5 rounded-lg">취소</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-sky-500 hover:from-blue-600 hover:to-sky-600 disabled:opacity-40 text-white text-sm font-bold rounded-lg flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? '저장 중...' : editing.id ? '수정 저장' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 수신자 입력 모달 (발송 직전)
// ════════════════════════════════════════════════════════════════════

interface RecipientsModalProps {
  campaign: EmailCampaign;
  authHeaders: () => Record<string, string>;
  onProceed: (payload: any, total: number) => void;
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

interface PrecheckResult {
  codeChecks: Array<{ key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
  spamRisk: { riskLevel: 'low' | 'medium' | 'high'; reasons: string[]; suggestions: string[] };
}

function RecipientsModal({ campaign, authHeaders, onProceed, onClose, onToast }: RecipientsModalProps) {
  const [tab, setTab] = useState<'customers' | 'direct'>('customers');
  const [mode, setMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');

  // 고객DB 탭
  const [grades, setGrades] = useState<Array<{ grade: string; count: number }>>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ total: number; gradeBreakdown: Array<{ grade: string; count: number }> } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 직접 입력 탭
  const [recipientsText, setRecipientsText] = useState('');
  const directCount = recipientsText.split(/[,\n;]+/).filter((e) => e.trim().includes('@')).length;

  // 발송 전 AI 진단
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [prechecking, setPrechecking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email/recipients/grades', { headers: authHeaders() });
        const data = await res.json();
        if (data.success) setGrades(data.grades || []);
      } catch { /* 등급 조회 실패 = 전체 발송만 */ }
    })();
  }, []);

  // 고객DB 미리보기 (등급 선택 변경 시)
  useEffect(() => {
    if (tab !== 'customers') return;
    let alive = true;
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/email/recipients/preview', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ grades: selectedGrades.length > 0 ? selectedGrades : undefined }),
        });
        const data = await res.json();
        if (alive && data.success) setPreview({ total: data.total, gradeBreakdown: data.gradeBreakdown || [] });
      } catch { /* 미리보기 실패 — 발송 시 재검증 */ }
      finally { if (alive) setPreviewLoading(false); }
    })();
    return () => { alive = false; };
  }, [tab, selectedGrades]);

  const total = tab === 'customers' ? (preview?.total || 0) : directCount;

  const handlePrecheck = async () => {
    setPrechecking(true);
    try {
      const res = await fetch('/api/email/ai/precheck', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ campaign_id: campaign.id }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success) { setPrecheck({ codeChecks: data.codeChecks, spamRisk: data.spamRisk }); onToast('발송 전 진단 완료 (1 크레딧)', 'success'); }
      else onToast(data.error || '진단 실패', 'error');
    } catch (e: any) {
      onToast(e?.message || '진단 중 오류', 'error');
    } finally {
      setPrechecking(false);
    }
  };

  const toggleGrade = (g: string) => {
    setSelectedGrades((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  const handleProceed = () => {
    if (total === 0) { onToast('발송 대상이 0건입니다.', 'warning'); return; }
    if (mode === 'scheduled') {
      if (!scheduledAt) { onToast('예약 시각을 선택해주세요.', 'warning'); return; }
      if (new Date(scheduledAt).getTime() < Date.now() + 60 * 1000) { onToast('예약 시각은 현재보다 1분 이상 이후여야 합니다.', 'warning'); return; }
    }
    const payload: any = { mode };
    if (mode === 'scheduled') payload.scheduled_at = new Date(scheduledAt).toISOString();
    if (tab === 'customers') {
      payload.target = { type: 'customers', grades: selectedGrades.length > 0 ? selectedGrades : undefined };
    } else {
      payload.recipients = recipientsText.split(/[,\n;]+/).map((e) => ({ email: e.trim() })).filter((r) => r.email.includes('@'));
    }
    onProceed(payload, total);
  };

  const riskColor = { low: 'text-emerald-300', medium: 'text-amber-300', high: 'text-rose-300' };
  const riskLabel = { low: '낮음', medium: '주의', high: '높음' };
  const statusIcon = (s: string) => s === 'pass' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : s === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-300" /> 발송 대상 선택
          </h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-white/60">
            캠페인: <strong className="text-white">{campaign.name}</strong>
            {campaign.isAd && <span className="ml-2 text-amber-300">(광고성 — "(광고)" + 수신거부 자동 부착)</span>}
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-violet-950/40 rounded-lg p-1">
            <button onClick={() => setTab('customers')} className={`flex-1 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === 'customers' ? 'bg-blue-500/40 text-white' : 'text-white/50 hover:text-white'}`}>
              <Users className="w-3.5 h-3.5" /> 고객DB에서 선택
            </button>
            <button onClick={() => setTab('direct')} className={`flex-1 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === 'direct' ? 'bg-blue-500/40 text-white' : 'text-white/50 hover:text-white'}`}>
              <PenLine className="w-3.5 h-3.5" /> 직접 입력
            </button>
          </div>

          {tab === 'customers' ? (
            <div className="space-y-3">
              <div className="text-[11px] text-white/50">등급을 고르면 해당 등급만, 비우면 전체 고객에게 발송합니다. 이메일 없음·수신거부·무효 고객은 자동 제외됩니다.</div>
              {grades.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {grades.map((g) => (
                    <button
                      key={g.grade}
                      onClick={() => toggleGrade(g.grade)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${selectedGrades.includes(g.grade) ? 'bg-blue-500/30 border-blue-400/50 text-white' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'}`}
                    >
                      {g.grade} <span className="text-white/40">({g.count.toLocaleString()})</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="bg-cyan-500/10 border border-cyan-400/25 rounded-lg p-3 flex items-center justify-between">
                <span className="text-xs text-white/70">발송 대상 (수신 가능)</span>
                <span className="text-lg font-bold text-cyan-300">
                  {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : `${total.toLocaleString()}명`}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                placeholder="수신 이메일 (콤마/세미콜론/줄바꿈 구분)&#10;예: user1@example.com, user2@example.com"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-y h-28 focus:outline-none focus:border-blue-400/50"
              />
              <div className="text-xs text-cyan-300">유효 이메일: <strong>{directCount.toLocaleString()}건</strong></div>
            </div>
          )}

          {/* 즉시 / 예약 */}
          <div className="flex gap-2">
            <button onClick={() => setMode('immediate')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${mode === 'immediate' ? 'bg-blue-500/30 border-blue-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}>즉시 발송</button>
            <button onClick={() => setMode('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 ${mode === 'scheduled' ? 'bg-blue-500/30 border-blue-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}><Clock className="w-3.5 h-3.5" /> 예약 발송</button>
          </div>
          {mode === 'scheduled' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-blue-400/50 [color-scheme:dark]"
            />
          )}

          {/* 발송 전 AI 진단 */}
          <div className="border-t border-white/10 pt-3">
            <button
              onClick={handlePrecheck}
              disabled={prechecking}
              className="text-xs text-fuchsia-300 hover:text-fuchsia-200 flex items-center gap-1.5 disabled:opacity-50"
            >
              {prechecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              발송 전 AI 진단 (스팸 위험 · 광고 표기 · 모바일 잘림 — 1 크레딧)
            </button>
            {precheck && (
              <div className="mt-3 space-y-2 bg-violet-950/40 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white/60">스팸 위험</span>
                  <span className={`font-bold ${riskColor[precheck.spamRisk.riskLevel]}`}>{riskLabel[precheck.spamRisk.riskLevel]}</span>
                </div>
                {precheck.spamRisk.reasons.length > 0 && (
                  <ul className="text-[11px] text-white/60 list-disc list-inside space-y-0.5">
                    {precheck.spamRisk.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
                {precheck.spamRisk.suggestions.length > 0 && (
                  <div className="text-[11px] text-emerald-300/80">
                    제안: {precheck.spamRisk.suggestions.join(' · ')}
                  </div>
                )}
                <div className="border-t border-white/10 pt-2 space-y-1">
                  {precheck.codeChecks.map((c) => (
                    <div key={c.key} className="flex items-start gap-1.5 text-[11px]">
                      {statusIcon(c.status)}
                      <span className="text-white/70">{c.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-violet-900/40 border-t border-white/10 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/70 hover:bg-white/5 rounded-lg">취소</button>
          <button
            onClick={handleProceed}
            disabled={total === 0}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-sky-500 hover:from-blue-600 hover:to-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            {mode === 'scheduled' ? '예약' : '발송'} ({total.toLocaleString()}명)
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// AI 성과 진단 모달
// ════════════════════════════════════════════════════════════════════

interface InsightModalProps {
  campaign: EmailCampaign;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

function InsightModal({ campaign, authHeaders, onClose, onToast }: InsightModalProps) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [insight, setInsight] = useState<{ topInsight: string; suggestions: Array<{ title: string; description: string }> } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email/ai/insight', {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ campaign_id: campaign.id }),
        });
        const data = await res.json();
        if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); onClose(); return; }
        if (data?.code === 'NO_DATA') { onToast('집계할 발송·이벤트 데이터가 없습니다.', 'warning'); onClose(); return; }
        if (data.success) { setStats(data.stats); setInsight(data.insight); }
        else { onToast(data.error || '성과 진단 실패', 'error'); onClose(); }
      } catch (e: any) { onToast(e?.message || '성과 진단 중 오류', 'error'); onClose(); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-fuchsia-300" /> AI 성과 진단</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-white/50">{campaign.name}</div>
          {loading ? (
            <div className="py-12 flex justify-center text-white/50"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <>
              {stats && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '오픈율', value: stats.openRatePct != null ? `${stats.openRatePct}%` : '—', sub: `${stats.uniqueOpeners}명` },
                    { label: '클릭율', value: stats.clickRatePct != null ? `${stats.clickRatePct}%` : '—', sub: `${stats.uniqueClickers}명` },
                    { label: '발송', value: stats.sentCount.toLocaleString(), sub: `반송 ${stats.bounceCount}` },
                  ].map((m, i) => (
                    <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                      <div className="text-[10px] text-white/50">{m.label}</div>
                      <div className="text-lg font-bold text-white">{m.value}</div>
                      <div className="text-[10px] text-white/40">{m.sub}</div>
                    </div>
                  ))}
                </div>
              )}
              {insight && (
                <>
                  <div className="bg-gradient-to-br from-fuchsia-500/15 to-purple-500/15 border border-fuchsia-400/25 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-[11px] text-fuchsia-200 font-semibold mb-1.5"><TrendingUp className="w-3.5 h-3.5" /> 핵심 발견</div>
                    <p className="text-sm text-white/90 leading-relaxed">{insight.topInsight}</p>
                  </div>
                  {insight.suggestions.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-white/60 font-semibold">다음 캠페인 개선 제안</div>
                      {insight.suggestions.map((s, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <div className="text-sm font-semibold text-emerald-300 mb-0.5">{s.title}</div>
                          <div className="text-xs text-white/70 leading-relaxed">{s.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="text-[10px] text-white/30 italic">Data source — 실측 오픈/클릭 이벤트 (email_events)</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 미오픈자 SMS 크로스 채널 모달
// ════════════════════════════════════════════════════════════════════

interface NonOpenerModalProps {
  campaign: EmailCampaign;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onGoSms: () => void;
}

function NonOpenerModal({ campaign, authHeaders, onClose, onToast, onGoSms }: NonOpenerModalProps) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ matched: Array<{ phone: string; name: string | null }>; unmatchedCount: number; totalNonOpeners: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/email/campaigns/${campaign.id}/non-openers`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success) setResult({ matched: data.matched, unmatchedCount: data.unmatchedCount, totalNonOpeners: data.totalNonOpeners });
        else { onToast(data.error || '미오픈자 조회 실패', 'error'); onClose(); }
      } catch (e: any) { onToast(e?.message || '조회 중 오류', 'error'); onClose(); }
      finally { setLoading(false); }
    })();
  }, []);

  const copyPhones = () => {
    if (!result || result.matched.length === 0) return;
    navigator.clipboard.writeText(result.matched.map((m) => m.phone).join(', '))
      .then(() => onToast(`${result.matched.length}건 전화번호 복사 완료`, 'success'))
      .catch(() => onToast('복사 실패', 'error'));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><Smartphone className="w-5 h-5 text-cyan-300" /> 미오픈자 SMS 재발송</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-white/50">{campaign.name} — 이메일을 열지 않은 고객을 SMS로 다시 만나보세요.</div>
          {loading ? (
            <div className="py-12 flex justify-center text-white/50"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : result && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-white/50">미오픈</div>
                  <div className="text-lg font-bold text-white">{result.totalNonOpeners.toLocaleString()}</div>
                </div>
                <div className="bg-cyan-500/10 border border-cyan-400/25 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-white/50">전화 매칭</div>
                  <div className="text-lg font-bold text-cyan-300">{result.matched.length.toLocaleString()}</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-white/50">번호 없음</div>
                  <div className="text-lg font-bold text-white/60">{result.unmatchedCount.toLocaleString()}</div>
                </div>
              </div>
              {result.matched.length > 0 ? (
                <>
                  <div className="bg-violet-950/40 rounded-lg p-3 max-h-40 overflow-y-auto text-[11px] text-white/70 space-y-1">
                    {result.matched.slice(0, 50).map((m, i) => (
                      <div key={i} className="flex justify-between"><span>{m.name || '(이름 없음)'}</span><span className="text-white/50">{m.phone}</span></div>
                    ))}
                    {result.matched.length > 50 && <div className="text-white/40 text-center pt-1">외 {result.matched.length - 50}건</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={copyPhones} className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-white/80">전화번호 복사</button>
                    <button onClick={onGoSms} className="flex-1 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5"><Zap className="w-3.5 h-3.5" /> SMS 발송하러 가기</button>
                  </div>
                </>
              ) : (
                <div className="text-center text-sm text-white/50 py-6">전화번호가 매칭되는 미오픈 고객이 없습니다.</div>
              )}
              <div className="text-[10px] text-white/30 italic">Data source — delivered 후 미오픈 수신자 ↔ 고객DB 전화 매칭</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 상태 badge
// ════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, { label: string; cls: string }> = {
    draft: { label: '초안', cls: 'bg-white/10 text-white/70' },
    scheduled: { label: '예약', cls: 'bg-amber-500/20 text-amber-300' },
    sending: { label: '발송 중', cls: 'bg-blue-500/20 text-blue-300 border border-blue-400/30' },
    completed: { label: '완료', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
    failed: { label: '실패', cls: 'bg-rose-500/20 text-rose-300 border border-rose-400/30' },
  };
  const e = map[status] || { label: status, cls: 'bg-white/10 text-white/70' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
