import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  AlertCircle, AlertTriangle, ArrowLeft, BarChart3, Check, ChevronDown, ChevronUp, Clock,
  Download, Edit2, Eye, EyeOff, FolderOpen, LayoutTemplate, Loader2, Lock, Mail, PenLine,
  RefreshCw, Send, Server, Settings, ShieldCheck, Smartphone, Sparkles,
  Trash2, TrendingUp, Users, Wand2, X,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';
import { DateTimeField, isoToLocalInput, localInputToIso } from '../components/DateTimeField';
import { takeEventDraft, EVENT_EMAIL_DRAFT_KEY } from '../components/EventCampaignModal';
import ImageToCopyButton from '../components/ImageToCopyButton';
// ★ D225+ (2026-05-28 Harold 명시): Email 발송 이력 모달 신설
import EmailEventsModal from '../components/email/EmailEventsModal';
// 비주얼 빌더 에디터
import EmailVisualEditor from '../components/email/EmailVisualEditor';
import EmailTemplateGalleryModal from '../components/email/EmailTemplateGalleryModal';
// ★ 2026-07-13 디자인 3.0 — 캠페인 단위 design(테마·프리헤더) 타입
import type { EmailDesign } from '../utils/email-themes';
import EmailAnalyticsModal from '../components/email/EmailAnalyticsModal';
import TargetExtractModal, { type ExtractedTarget } from '../components/TargetExtractModal';
import { createSection, type Section } from '../utils/dm-section-defaults';
import { STUDIO_EMAIL_DRAFT_KEY } from '../lib/studio-draft';
import AssetLibraryPickerModal, { type PickedAsset } from '../components/assets/AssetLibraryPickerModal';
import type { EmailCampaign, CampaignStatus } from '../components/email/email-campaign-types';

// ★ 2026-07-02(3) 빠른 시작 7카드 제거 — 시작 방식은 [템플릿에서 시작]/[비주얼로 만들기] 2개 + 프롬프트 AI 생성으로 통일 (Harold 확정)

// AI 생성 진행 단계 (시각 효과 — 700ms 간격)
const EMAIL_GEN_STEPS = ['요청 의도 분석', '브랜드 톤 반영', '제목 3안 작성', '본문 구성', '블록 합성', '최종 점검'];

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

// EmailCampaign / CampaignStatus = ../components/email/email-campaign-types (분석 모달과 공유)

// 편집 모달 상태 — 캠페인 필드 + AI 생성 부가(제목 3안·AI 플래그)
interface EditingCampaign extends Partial<EmailCampaign> {
  subjects?: string[];
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

// ★ 2026-07-02(3) EMPTY_CAMPAIGN_FORM 제거 — 신규 진입은 템플릿/비주얼/프롬프트 전부 비주얼 편집기.
//   레거시 HTML 폼은 기존 HTML 전용 캠페인 수정(openEditor 폴백)에만 쓰인다.

// ════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ════════════════════════════════════════════════════════════════════

export default function EmailCampaignsPage() {
  const navigate = useNavigate();
  const customerGate = useCustomerDataGate(localStorage.getItem('token'));
  const [showDataGate, setShowDataGate] = useState(false);
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

  // 테스트 발송 영역 (작은 모달로 접음 — 가로 큰 카드 제거)
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);

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
  // ★ 2026-07-22 테스트발송 — 완성된 이 캠페인을 직접 입력 최대 3개 주소로 발송(영업/자체 점검). SMTP 연동 + 완성 캠페인만. (광고) 없음·통계 미반영·발송 무과금.
  const [campaignTest, setCampaignTest] = useState<EmailCampaign | null>(null);
  const [campaignTestEmails, setCampaignTestEmails] = useState<string[]>(['', '', '']);
  const [campaignTestSending, setCampaignTestSending] = useState(false);
  // ★ 2026-07-22 완성 이메일 HTML 내보내기 — 완성분만(서버가 완성 여부 재검증). 크레딧 없이 산출물 추출 방어.
  const [htmlExporting, setHtmlExporting] = useState<string | null>(null);
  // AI 캠페인 발송 확정 30크레딧 확인
  const [creditConfirm, setCreditConfirm] = useState<{ campaign: EmailCampaign; payload: any; desc: string } | null>(null);
  // 비주얼 빌더 에디터 (sections 기반)
  const [visualEditor, setVisualEditor] = useState<{ sections: Section[]; name?: string; subject?: string; isAd?: boolean; aiGenerated?: boolean; campaignId?: string; completed?: boolean; design?: EmailDesign | null } | null>(null);
  // ★ 2026-07-02 캠페인 목록 페이징 — 2열 × 2줄 = 페이지당 4카드 (Harold 확정)
  const CAMPAIGN_PAGE_SIZE = 4;
  const [campaignPage, setCampaignPage] = useState(1);
  // 템플릿 갤러리 모달 (즉시·무료 골격)
  const [showGallery, setShowGallery] = useState(false);
  // 성과 분석 대시보드 모달
  const [showAnalytics, setShowAnalytics] = useState(false);

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

  // ★ 2026-07-22 테스트발송 — 완성된 캠페인 자체를 직접 입력 주소로 발송. (SMTP 점검용 handleTestSend와 별개)
  const openCampaignTest = (c: EmailCampaign) => {
    setCampaignTestEmails(['', '', '']);
    setCampaignTest(c);
  };
  const handleCampaignTestSend = async () => {
    if (!campaignTest) return;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails = campaignTestEmails.map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) {
      showToast('보낼 이메일 주소를 1개 이상 입력해주세요', 'warning');
      return;
    }
    if (emails.some((e) => !emailPattern.test(e))) {
      showToast('이메일 형식이 올바르지 않은 주소가 있습니다', 'warning');
      return;
    }
    setCampaignTestSending(true);
    try {
      const res = await fetch(`/api/email/campaigns/${campaignTest.id}/test-send`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        showToast(`테스트발송 완료 — ${data.sent}건 발송 (수신함·스팸 폴더 확인)`, 'success');
        setCampaignTest(null);
      } else {
        showToast(data.error || '테스트발송 실패', 'error');
      }
    } catch (e: any) {
      showToast(e?.message || '테스트발송 중 오류', 'error');
    } finally {
      setCampaignTestSending(false);
    }
  };

  // ★ 2026-07-22 완성 이메일을 HTML 파일로 저장 — 서버가 완성 여부 재검증(크레딧 없이 추출 차단). 인증 헤더 필요라 fetch→Blob 다운로드.
  const handleExportHtml = async (c: EmailCampaign) => {
    if (htmlExporting) return;
    setHtmlExporting(c.id);
    try {
      const res = await fetch(`/api/email/campaigns/${c.id}/export-html`, { headers: authHeaders() });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || ct.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        if (handle503(data)) return;
        showToast(data.error || 'HTML 내보내기 실패', 'error');
        return;
      }
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const safe = (c.name || 'email').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'email';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}.html`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('HTML 저장 완료', 'success');
    } catch (e: any) {
      showToast(e?.message || 'HTML 내보내기 중 오류', 'error');
    } finally {
      setHtmlExporting(null);
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
      if (!isUpdate && editing.aiGenerated) body.ai_generated = true; // AI 생성 캠페인 마킹 (표시·통계용 — 과금은 완성 50크레딧으로 일원화)

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

  // 편집기 열기 — 비주얼 섹션 있으면 비주얼 에디터, 아니면 HTML 폼 (수정 버튼·placeholder 안내 공용)
  const openEditor = (c: EmailCampaign) => {
    if (c.sections && c.sections.length) {
      setVisualEditor({ sections: c.sections as Section[], name: c.name, subject: c.subject, isAd: c.isAd, aiGenerated: c.aiGenerated, campaignId: c.id, completed: c.completed, design: c.design ?? null });
    } else {
      setEditing(c);
    }
  };

  const openRecipientsModal = (c: EmailCampaign) => {
    // ★ 2026-07-02(3) 미완성 = 발송 진입 차단 (버튼 미노출 + 함수 가드 + 백엔드 CAMPAIGN_NOT_COMPLETED 3중)
    if (!c.completed) {
      showToast('완성 저장(50크레딧) 후 발송할 수 있습니다. 편집기에서 [완성 저장]을 눌러주세요.', 'warning');
      openEditor(c);
      return;
    }
    // 미입력 자리([…직접 입력…]) 잔존 = 발송 차단 (AI 임의 혜택 룰). 편집기로 유도해 채우게 한다.
    if (c.hasPlaceholder) {
      showToast('직접 입력이 필요한 자리가 남아 있습니다. 편집에서 채운 뒤 발송해주세요.', 'error');
      openEditor(c);
      return;
    }
    setRecipientsModal({ campaign: c });
  };

  // ──────────────── AI 원샷 생성 (1클릭 = AI 자동 흐름 + 편집 모드 진입) ────────────────
  // ★ 2026-07-02(3) 편집기 통일 (Harold 확정) — 레거시 HTML 폼(/ai/generate) 대신
  //   블록 생성(/ai/generate-sections) → 비주얼 편집기로 진입. 시작 방식 = 템플릿/비주얼/프롬프트 전부 비주얼 편집기 1개.
  const handleAiGenerate = async (opts: { prompt?: string }) => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    if (genStep !== null) return; // 중복 방지
    if (!opts.prompt?.trim()) {
      showToast('만들고 싶은 이메일을 한 줄로 입력해주세요.', 'warning');
      return;
    }
    setGenStep(0);
    // 진행 단계 시각 효과 — 700ms 간격으로 마지막 직전까지 전진
    genTimer.current = setInterval(() => {
      setGenStep((s) => (s === null ? 0 : Math.min(s + 1, EMAIL_GEN_STEPS.length - 1)));
    }, 700);
    try {
      const res = await fetch('/api/email/ai/generate-sections', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ prompt: opts.prompt.trim(), is_ad: aiAsAd }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { showToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (handle503(data)) return;
      if (data.success && data.data) {
        const g = data.data;
        setAiPrompt('');
        setVisualEditor({
          sections: (g.sections || []) as Section[],
          name: g.name || '',
          subject: (g.subjects && g.subjects[0]) || '',
          isAd: aiAsAd,
          aiGenerated: true,
          // ★ 2026-07-13 — AI 프리헤더 회생(design.preheader로 수용 — 옛 흐름은 버렸음)
          design: g.preheader ? { preheader: String(g.preheader).slice(0, 90) } : null,
        });
        showToast('AI 생성 완료 — 비주얼 편집기에서 확인하고 다듬어주세요. (3 크레딧)', 'success');
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

  // ★ 2026-07-07(4) 행사 캠페인 — EventCampaignModal이 생성해둔 이메일 초안 자동 적용 (30분 TTL, 1회 소비)
  useEffect(() => {
    const d = takeEventDraft<{ data?: any; isAd?: boolean }>(EVENT_EMAIL_DRAFT_KEY);
    if (!d?.data) return;
    const g = d.data;
    setVisualEditor({
      sections: (g.sections || []) as Section[],
      name: g.name || '행사 캠페인 이메일',
      subject: (g.subjects && g.subjects[0]) || '',
      isAd: d.isAd !== false,
      aiGenerated: true,
      design: g.preheader ? { preheader: String(g.preheader).slice(0, 90) } : null,
    });
    showToast('행사 캠페인 이메일 초안을 불러왔습니다 — 이미지만 올리고 다듬어주세요.', 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-07-19 P4: 이미지 스튜디오 소재 → 히어로 이미지 이메일 새 초안 (라이브러리 클릭 → 이메일 만들기)
  useEffect(() => {
    const d = takeEventDraft<{ imageUrl?: string; name?: string | null }>(STUDIO_EMAIL_DRAFT_KEY);
    if (!d?.imageUrl) return;
    try {
      const gallery = createSection('gallery', 0, { images: [{ url: d.imageUrl }], layout: 'list_1xN', full_bleed: true });
      setVisualEditor({
        sections: [gallery] as Section[],
        name: '스튜디오 소재 이메일',
        subject: '',
        isAd: true,
        aiGenerated: false,
        design: null,
      });
      showToast('스튜디오 소재로 이메일을 시작했어요 — 제목·문구만 더해주세요.', 'success');
    } catch {
      // 초안 손상 = 조용히 무시
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-07-19 P4: 라이브러리에서 시작 — 저장 소재 다중 선택 → 이미지 섹션 이메일
  const [startLibOpen, setStartLibOpen] = useState(false);
  const startFromLibrary = (assets: PickedAsset[]) => {
    const urls = assets.map((a) => a.url).filter(Boolean);
    if (urls.length === 0) return;
    const gallery = createSection('gallery', 0, { images: urls.map((u) => ({ url: u })), layout: 'list_1xN', full_bleed: true });
    setVisualEditor({
      sections: [gallery] as Section[],
      name: '라이브러리 소재 이메일',
      subject: '',
      isAd: true,
      aiGenerated: false,
      design: null,
    });
    showToast(`라이브러리 소재 ${urls.length}장으로 이메일을 시작했어요 — 제목·문구만 더해주세요.`, 'success');
  };

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
        const excluded = Number(data.excludedOptOut) > 0 ? ` · 수신거부 이력 ${Number(data.excludedOptOut)}건 제외` : '';
        if (data.scheduled) {
          showToast(`예약 완료 — ${new Date(data.scheduledAt).toLocaleString('ko-KR')} 발송 (대상 ${data.total}명${excluded})`, 'success');
          setSendingId(null);
          await loadAll();
        } else {
          showToast(`발송 시작 — 대상 ${data.total}명${excluded} (진행 상황 자동 갱신)`, 'success');
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

  // RecipientsModal → 발송 확정.
  // ★ 2026-07-02 Harold 확정 크레딧 모델: 발송 = 무료(고객 SMTP). 단 미완성 캠페인은
  //   완성(50크레딧, 캠페인당 1회) 확인 모달 → /complete → 발송으로 이어간다 (1클릭 흐름).
  const handleProceedSend = (campaign: EmailCampaign, payload: any, total: number) => {
    setRecipientsModal(null);
    const sched = payload.mode === 'scheduled';
    const desc = `${total.toLocaleString()}명에게 ${sched ? '예약' : '즉시'} 발송합니다.${campaign.isAd ? ' (광고성 — "(광고)" + 수신거부 링크 자동 부착)' : ''} 발신 = ${campaign.fromEmail}`;
    if (!campaign.completed) {
      // 미완성 = 완성 50크레딧 고지 후 완성+발송 연속 처리
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

  // ★ 2026-07-12 예약 발송 취소 — scheduled → draft 복귀 (완성 크레딧은 유지, 재발송·재예약 자유)
  const handleCancelSchedule = (c: EmailCampaign) => {
    setConfirmState({
      mode: 'warning',
      title: '예약 발송 취소',
      description: `${c.scheduledAt ? new Date(c.scheduledAt).toLocaleString('ko-KR') + ' 예약된 ' : ''}"${c.name}" 발송을 취소합니다. 캠페인은 초안으로 돌아가며 언제든 다시 발송·예약할 수 있습니다.`,
      confirmLabel: '예약 취소',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/email/campaigns/${c.id}/cancel-schedule`, { method: 'POST', headers: authHeaders() });
          const data = await res.json();
          if (handle503(data)) return;
          if (data.success) {
            showToast('예약이 취소되었습니다 — 캠페인은 초안 상태로 보관됩니다.', 'success');
            await loadAll();
          } else {
            showToast(data.error || '예약 취소 실패', 'error');
            await loadAll(); // 이미 발송 시작 등 상태 변화 반영
          }
        } catch (e: any) {
          showToast(e?.message || '예약 취소 중 오류', 'error');
        }
      },
    });
  };

  // ★ 2026-07-02 완성(50크레딧) 처리 후 발송 — 멱등이라 중복 차감 0
  const completeAndSend = async (campaign: EmailCampaign, payload: any) => {
    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}/complete`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { showToast('크레딧이 부족합니다. 충전 후 발송해주세요.', 'warning'); return; }
      if (!data.success) { showToast(data.error || '완성 처리 실패', 'error'); return; }
      setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? { ...c, completed: true } : c)));
      await doSend({ ...campaign, completed: true }, payload);
    } catch (e: any) {
      showToast(e?.message || '완성 처리 중 오류', 'error');
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
    <div className="min-h-screen bg-violet-950 text-white">
      {/* 상단 헤더 — D222+ Phase 3 보라 톤 다운 */}
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">Email 캠페인</h1>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">회사 SMTP 직접 등록 → 본인 도메인 발신 + 광고 자동 합성 + 오픈/클릭 트래킹</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            {smtpConfigured && smtpConfig?.isConfigured && (
              <>
                <button
                  onClick={() => setSmtpFormOpen(true)}
                  className="text-xs flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/25 transition-colors"
                  title="SMTP 설정 — 수정 / 영구 제거"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                  <span className="font-medium">발송 가능</span>
                  <span className="hidden lg:inline text-emerald-200/50 font-mono">{smtpConfig.host}</span>
                </button>
                <button
                  onClick={() => setTestModalOpen(true)}
                  className="text-xs text-cyan-200 hover:bg-cyan-500/15 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors border border-cyan-400/20"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">테스트 발송</span>
                </button>
              </>
            )}
            {campaigns.length > 0 && (
              <button
                onClick={() => setShowAnalytics(true)}
                className="text-xs bg-gradient-to-r from-indigo-500/40 to-violet-500/40 hover:from-indigo-500/60 hover:to-violet-500/60 text-indigo-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-indigo-400/30"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                분석
              </button>
            )}
            <button onClick={loadAll} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors" aria-label="새로고침">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">새로고침</span>
            </button>
            {/* ★ 2026-07-02(3) 시작 버튼(템플릿/비주얼)은 아래 AI 카드 안 시작 허브로 이동 — 헤더 정리.
                [신규 캠페인](레거시 HTML 폼) 진입 제거 — 레거시 폼은 기존 HTML 전용 캠페인 수정(openEditor 폴백)에만 유지 */}
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

        {/* SMTP 상태·테스트 발송은 헤더의 칩·작은 모달로 이동 — 가로 큰 배너/카드 제거 */}

        {/* ★ 2026-07-02(3): AI 원샷 생성 — 자연어 프롬프트 1개만 (빠른 시작 카드 제거, 결과는 비주얼 편집기로) */}
        {smtpConfigured && (
          <div className="bg-gradient-to-br from-fuchsia-600/20 via-purple-600/15 to-indigo-600/20 border border-fuchsia-400/30 rounded-2xl p-5">
            {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4" />}
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
              <ImageToCopyButton
                label="이미지"
                onExtracted={(t) => setAiPrompt((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))}
                disabled={genStep !== null}
                className="px-3 py-2.5 rounded-xl border border-violet-400/40 bg-violet-500/10 text-violet-100 text-sm font-medium hover:bg-violet-500/20 disabled:opacity-40 inline-flex items-center gap-1.5 whitespace-nowrap"
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
            <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer w-fit">
              <input type="checkbox" checked={aiAsAd} onChange={(e) => setAiAsAd(e.target.checked)} disabled={genStep !== null} className="rounded" />
              광고성 이메일로 만들기 (발송 시 "(광고)" + 수신거부 링크 자동 부착)
            </label>
            {/* ★ 2026-07-02(3) 시작 허브 — [템플릿에서 시작]/[비주얼로 만들기] + ★2026-07-19 P4 [라이브러리에서 시작] */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
              <button
                onClick={() => setShowGallery(true)}
                disabled={genStep !== null}
                className="group flex items-center gap-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/25 hover:border-emerald-400/50 rounded-xl p-3.5 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md shrink-0">
                  <LayoutTemplate className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">템플릿에서 시작</div>
                  <div className="text-[10px] text-white/45 mt-0.5">완성된 골격을 한 번에 — 크레딧 0, 바로 편집</div>
                </div>
              </button>
              <button
                onClick={() => setVisualEditor({ sections: [], isAd: true, aiGenerated: false })}
                disabled={genStep !== null}
                className="group flex items-center gap-3 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-400/25 hover:border-violet-400/50 rounded-xl p-3.5 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">비주얼로 만들기</div>
                  <div className="text-[10px] text-white/45 mt-0.5">빈 캔버스에서 블록 직접 조립</div>
                </div>
              </button>
              <button
                onClick={() => setStartLibOpen(true)}
                disabled={genStep !== null}
                className="group flex items-center gap-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/25 hover:border-amber-400/50 rounded-xl p-3.5 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md shrink-0">
                  <FolderOpen className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">라이브러리에서 시작</div>
                  <div className="text-[10px] text-white/45 mt-0.5">저장 소재 다중 선택 → 이미지 이메일</div>
                </div>
              </button>
            </div>
            {/* ★ 2026-07-19 P4: 라이브러리 다중 선택 → 이미지 섹션 이메일 */}
            <AssetLibraryPickerModal
              open={startLibOpen}
              onClose={() => setStartLibOpen(false)}
              multiSelect
              onPick={(a) => startFromLibrary([a])}
              onPickMany={startFromLibrary}
            />
            <div className="text-[10px] text-white/30 italic mt-3">
              Data source — 회사 Brand Voice 학습 결과 자동 반영 · 구체 혜택은 직접 입력
            </div>
          </div>
        )}

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
        ) : (() => {
          // ★ 2026-07-02 Harold 지시 — 2열 그리드 + 페이징뷰(페이지당 10건). 삭제로 페이지 수가 줄면 안전 범위로 보정.
          const totalCampaignPages = Math.max(1, Math.ceil(campaigns.length / CAMPAIGN_PAGE_SIZE));
          const safeCampaignPage = Math.min(campaignPage, totalCampaignPages);
          const pagedCampaigns = campaigns.slice((safeCampaignPage - 1) * CAMPAIGN_PAGE_SIZE, safeCampaignPage * CAMPAIGN_PAGE_SIZE);
          return (
          <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {pagedCampaigns.map((c) => (
              <div key={c.id} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-base font-bold text-white">{c.name}</span>
                  <StatusBadge status={c.status} />
                  {(c.resendGeneration ?? 0) > 0 && <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-full font-medium">재발송</span>}
                  {c.isAd && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full font-medium">광고성</span>}
                  {c.status === 'draft' && !c.completed && <span className="text-[10px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full font-medium" title="완성 저장(50크레딧) 후 발송이 열립니다">완성 전</span>}
                  {c.status === 'draft' && c.hasPlaceholder && <span className="text-[10px] bg-orange-500/25 text-orange-200 px-1.5 py-0.5 rounded-full font-medium">직접 입력 필요</span>}
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
                  {c.sentAt && <><span>·</span><span>발송 일자 {new Date(c.sentAt).toLocaleString('ko-KR')}</span></>}
                  {c.status === 'scheduled' && c.scheduledAt && <><span>·</span><span className="text-amber-300">예약 {new Date(c.scheduledAt).toLocaleString('ko-KR')}</span></>}
                </div>
                <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
                  {/* ★ 2026-07-02(3) Harold 지시 — 발송 버튼은 완성 저장(50크레딧) 후에만 생성. 임시저장(미완성) = 발송 버튼 자체 미노출 */}
                  {(c.status === 'draft' || c.status === 'failed') && c.completed && (
                    <button
                      onClick={() => openRecipientsModal(c)}
                      disabled={sendingId === c.id || !smtpConfigured}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-500/30 hover:bg-blue-500/50 disabled:opacity-40 text-blue-100 border border-blue-400/30 px-2.5 py-1.5 rounded-lg"
                    >
                      <Send className="w-3 h-3" />
                      {sendingId === c.id ? '발송 중...' : '발송'}
                    </button>
                  )}
                  {(c.status === 'draft' || c.status === 'failed') && !c.completed && (
                    <button
                      onClick={() => openEditor(c)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold bg-violet-500/20 hover:bg-violet-500/35 text-violet-200 border border-violet-400/30 px-2.5 py-1.5 rounded-lg"
                      title="편집기에서 완성 저장(50크레딧)하면 발송 버튼이 열립니다"
                    >
                      <Lock className="w-3 h-3" /> 완성 저장 후 발송
                    </button>
                  )}
                  {/* ★ 2026-07-12 예약 취소 — 취소 수단 부재 봉합 (취소 = 초안 복귀, 완성 크레딧 유지) */}
                  {c.status === 'scheduled' && (
                    <button
                      onClick={() => handleCancelSchedule(c)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border border-amber-400/30 px-2.5 py-1.5 rounded-lg"
                      title="예약을 취소하고 초안으로 되돌립니다 (완성 상태 유지 — 다시 발송·예약 가능)"
                    >
                      <X className="w-3 h-3" /> 예약 취소
                    </button>
                  )}
                  {c.sentCount > 0 && (
                    <button
                      onClick={() => setEventsModal({ id: c.id, name: c.name })}
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-300 border border-emerald-400/20 hover:bg-emerald-500/10 px-2.5 py-1.5 rounded-lg"
                    >
                      <Eye className="w-3 h-3" /> 이력
                    </button>
                  )}
                  {c.status === 'completed' && c.sentCount > 0 && (
                    <>
                      <button
                        onClick={() => setInsightModal({ campaign: c })}
                        className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300 border border-fuchsia-400/20 hover:bg-fuchsia-500/10 px-2.5 py-1.5 rounded-lg"
                      >
                        <Sparkles className="w-3 h-3" /> AI 진단
                      </button>
                      <button
                        onClick={() => setNonOpenerModal({ campaign: c })}
                        className="inline-flex items-center gap-1 text-[11px] text-cyan-300 border border-cyan-400/20 hover:bg-cyan-500/10 px-2.5 py-1.5 rounded-lg"
                      >
                        <RefreshCw className="w-3 h-3" /> 미수신자 재발송
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => openEditor(c)}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-300 border border-indigo-400/20 hover:bg-indigo-500/10 px-2.5 py-1.5 rounded-lg"
                  >
                    <Edit2 className="w-3 h-3" /> 수정
                  </button>
                  {smtpConfigured && c.completed && (
                    <button
                      onClick={() => openCampaignTest(c)}
                      className="inline-flex items-center gap-1 text-[11px] text-teal-300 border border-teal-400/20 hover:bg-teal-500/10 px-2.5 py-1.5 rounded-lg"
                      title="이 이메일을 직접 입력한 주소(최대 3개)로 테스트 발송합니다 — 광고 표기 없음"
                    >
                      <Send className="w-3 h-3" /> 테스트발송
                    </button>
                  )}
                  {c.completed && (
                    <button
                      onClick={() => handleExportHtml(c)}
                      disabled={htmlExporting === c.id}
                      className="inline-flex items-center gap-1 text-[11px] text-sky-300 border border-sky-400/20 hover:bg-sky-500/10 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                      title="완성된 이메일을 HTML 파일로 저장합니다"
                    >
                      {htmlExporting === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} HTML 저장
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteCampaign(c)}
                    className="inline-flex items-center gap-1 text-[11px] text-rose-300 border border-rose-400/20 hover:bg-rose-500/10 px-2.5 py-1.5 rounded-lg"
                  >
                    <Trash2 className="w-3 h-3" /> 삭제
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 페이저 — 이전 / 숫자 / 다음 (1페이지뿐이면 숨김) */}
          {totalCampaignPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-4 flex-wrap">
              <button
                onClick={() => setCampaignPage(Math.max(1, safeCampaignPage - 1))}
                disabled={safeCampaignPage <= 1}
                className="px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                이전
              </button>
              {Array.from({ length: totalCampaignPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setCampaignPage(p)}
                  className={`w-8 h-8 text-[11px] rounded-lg border transition-colors ${
                    p === safeCampaignPage
                      ? 'bg-violet-600 border-violet-500 text-white font-bold'
                      : 'border-white/15 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setCampaignPage(Math.min(totalCampaignPages, safeCampaignPage + 1))}
                disabled={safeCampaignPage >= totalCampaignPages}
                className="px-3 py-1.5 text-[11px] rounded-lg border border-white/15 text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                다음
              </button>
              <span className="ml-2 text-[10px] text-white/35">{campaigns.length}건 중 {safeCampaignPage}/{totalCampaignPages}페이지</span>
            </div>
          )}
          </>
          );
        })()}
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
          onClear={smtpConfig?.isConfigured ? () => { setSmtpFormOpen(false); handleClearSmtp(); } : undefined}
          isUpdate={smtpConfig?.isConfigured || false}
        />
      )}

      {/* 테스트 발송 — 작은 모달 (가로 큰 카드 대체) */}
      {testModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><Send className="w-4 h-4 text-cyan-300" /> 테스트 발송</h3>
              <button onClick={() => setTestModalOpen(false)} disabled={testSending} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 disabled:opacity-40" aria-label="닫기"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-white/50">회사 admin 본인 이메일에 테스트 발송 → SMTP 설정 정상 동작 확인 (스팸 폴더도 확인)</p>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !testSending && testEmail.trim()) handleTestSend(); }}
                placeholder="테스트 수신 이메일 (예: admin@example.com)"
                className="w-full px-3 py-2 bg-violet-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
              />
              <button
                onClick={handleTestSend}
                disabled={testSending || !testEmail.trim()}
                className="w-full px-4 py-2 bg-cyan-500/30 hover:bg-cyan-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-cyan-100 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5"
              >
                {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {testSending ? '발송 중...' : '테스트 발송'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-07-22 테스트발송 — 완성된 이 캠페인을 직접 입력 최대 3개 주소로 발송(영업/자체 점검). (광고) 없음·통계 미반영. */}
      {campaignTest && (
        <div className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-3 border-b border-white/10">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Send className="w-4 h-4 text-teal-300" /> 테스트발송</h3>
                <p className="text-[11px] text-white/50 mt-1 truncate">{campaignTest.name}</p>
              </div>
              <button onClick={() => setCampaignTest(null)} disabled={campaignTestSending} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 disabled:opacity-40 shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-white/50">이 이메일을 입력한 주소로 그대로 보냅니다 (최대 3개). 광고 표기 없이 발송되며 통계에 반영되지 않습니다.</p>
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="email"
                  value={campaignTestEmails[i]}
                  onChange={(e) => setCampaignTestEmails((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !campaignTestSending) handleCampaignTestSend(); }}
                  placeholder={`받는 사람 ${i + 1}${i === 0 ? ' (필수)' : ' (선택)'}`}
                  className="w-full px-3 py-2 bg-violet-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-teal-400/50"
                />
              ))}
              <button
                onClick={handleCampaignTestSend}
                disabled={campaignTestSending || campaignTestEmails.every((e) => !e.trim())}
                className="w-full px-4 py-2 bg-teal-500/30 hover:bg-teal-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-teal-100 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5"
              >
                {campaignTestSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {campaignTestSending ? '발송 중...' : '테스트발송'}
              </button>
            </div>
          </div>
        </div>
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

      {/* 미수신자 재발송 모달 (주: 이메일 무료 재발송 / 부: SMS 유료 상위 옵션) */}
      {nonOpenerModal && (
        <NonOpenerModal
          campaign={nonOpenerModal.campaign}
          authHeaders={authHeaders}
          onClose={() => setNonOpenerModal(null)}
          onToast={showToast}
          onGoSms={() => navigate('/dashboard')}
          onReload={loadAll}
        />
      )}

      {/* ★ 2026-07-02 캠페인 완성 50크레딧 확인 — 확인 시 완성(멱등) 후 발송 연속 처리 */}
      <CreditConfirmModal
        open={!!creditConfirm}
        source="email-campaign-complete"
        onConfirm={() => { if (creditConfirm) { const cc = creditConfirm; setCreditConfirm(null); completeAndSend(cc.campaign, cc.payload); } }}
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

      {/* 템플릿 갤러리 — 1클릭 무료 골격 → 비주얼 에디터 */}
      {showGallery && (
        <EmailTemplateGalleryModal
          onPick={(sections, label, design) => setVisualEditor({ sections, name: label, subject: label, isAd: true, aiGenerated: false, design: design ?? null })}
          onClose={() => setShowGallery(false)}
          authHeaders={authHeaders}
        />
      )}

      {/* 성과 분석 대시보드 — 1클릭 액션은 기존 진단/미오픈 모달 재사용 */}
      {showAnalytics && (
        <EmailAnalyticsModal
          campaigns={campaigns}
          authHeaders={authHeaders}
          onClose={() => setShowAnalytics(false)}
          onOpenInsight={(c) => { setShowAnalytics(false); setInsightModal({ campaign: c }); }}
          onOpenNonOpener={(c) => { setShowAnalytics(false); setNonOpenerModal({ campaign: c }); }}
          onToast={showToast}
        />
      )}

      {/* 비주얼 빌더 에디터 */}
      {visualEditor && (
        <EmailVisualEditor
          initialSections={visualEditor.sections}
          initialName={visualEditor.name}
          initialSubject={visualEditor.subject}
          initialIsAd={visualEditor.isAd}
          initialDesign={visualEditor.design}
          aiGenerated={visualEditor.aiGenerated}
          campaignId={visualEditor.campaignId}
          completed={visualEditor.completed}
          authHeaders={authHeaders}
          onClose={() => setVisualEditor(null)}
          onSaved={() => { loadAll(); }}
          onToast={showToast}
        />
      )}

      {/* ConfirmModal */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />
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
  onClear?: () => void;
  isUpdate: boolean;
}

function SmtpFormModal({ form, setForm, presetKey, setPresetKey, showPassword, setShowPassword, saving, onSave, onClose, onClear, isUpdate }: SmtpFormModalProps) {
  const currentPreset = SMTP_PRESETS.find((p) => p.key === presetKey);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
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

        <div className="sticky bottom-0 bg-violet-900/40 border-t border-white/10 px-6 py-3 flex items-center justify-between gap-2">
          <div>
            {isUpdate && onClear && (
              <button onClick={onClear} className="px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 rounded-lg flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> 영구 제거
              </button>
            )}
          </div>
          <div className="flex gap-2">
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

  // 1클릭 자동 다듬기 기본 지시 — 사실·혜택 보존(임의 혜택 생성 0)
  const ONE_CLICK_REFINE = '문장을 더 매끄럽고 자연스럽게 다듬어주세요. 상품·혜택·금액·할인율·날짜·숫자·링크 등 사실은 절대 바꾸지 말고, 원본에 없는 정보는 추가하지 마세요.';
  const handleRefine = async (instructionOverride?: string) => {
    const instruction = (instructionOverride ?? refineInstruction).trim();
    if (!instruction) { onToast('어떻게 다듬을지 입력해주세요.', 'warning'); return; }
    if (!editing.subject?.trim() || !editing.htmlBody?.trim()) { onToast('제목과 본문이 필요합니다.', 'warning'); return; }
    setRefining(true);
    try {
      const res = await fetch('/api/email/ai/refine', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ subject: editing.subject, html_body: editing.htmlBody, instruction }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success && data.data) {
        setEditing({ ...editing, subject: data.data.subject, htmlBody: data.data.htmlBody });
        if (!instructionOverride) setRefineInstruction('');
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
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
          {/* ★ 2026-07-12 프리헤더 입력 제거 — 저장 통로가 없어 입력해도 사라지던 거짓 UI.
              비주얼 캠페인은 렌더러가 본문 첫 텍스트로 프리헤더를 자동 생성한다. */}
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
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-[11px] text-fuchsia-200 font-semibold">
                <Wand2 className="w-3.5 h-3.5" /> AI 다듬기 (1 크레딧)
              </div>
              <button
                onClick={() => handleRefine(ONE_CLICK_REFINE)}
                disabled={refining || !editing.subject?.trim() || !editing.htmlBody?.trim()}
                className="px-2.5 py-1 bg-gradient-to-r from-fuchsia-500/50 to-purple-500/50 hover:from-fuchsia-500/70 hover:to-purple-500/70 disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg flex items-center gap-1 whitespace-nowrap"
                title="지시 입력 없이 AI가 전체 문장을 매끄럽게 다듬어요 (사실·혜택 보존)"
              >
                {refining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                한 번에 다듬기
              </button>
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
                onClick={() => handleRefine()}
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
  const [tab, setTab] = useState<'customers' | 'direct' | 'ai'>('customers');
  const [mode, setMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  // AI 정밀 타겟 — 타겟 추출로 확정한 filter를 발송 대상으로 held
  const [extractOpen, setExtractOpen] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedTarget | null>(null);

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

  const total = tab === 'customers' ? (preview?.total || 0) : tab === 'ai' ? (extracted?.channelEligibleCount || 0) : directCount;

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
    } else if (tab === 'ai') {
      if (!extracted) { onToast('먼저 타겟을 추출해주세요.', 'warning'); return; }
      payload.target = { type: 'filter', filter: extracted.filter };
    } else {
      payload.recipients = recipientsText.split(/[,\n;]+/).map((e) => ({ email: e.trim() })).filter((r) => r.email.includes('@'));
    }
    onProceed(payload, total);
  };

  const riskColor = { low: 'text-emerald-300', medium: 'text-amber-300', high: 'text-rose-300' };
  const riskLabel = { low: '낮음', medium: '주의', high: '높음' };
  const statusIcon = (s: string) => s === 'pass' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : s === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;

  return (
    <>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
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
            <button onClick={() => setTab('ai')} className={`flex-1 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === 'ai' ? 'bg-blue-500/40 text-white' : 'text-white/50 hover:text-white'}`}>
              <Sparkles className="w-3.5 h-3.5" /> AI 정밀 타겟
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
          ) : tab === 'ai' ? (
            <div className="space-y-3">
              <div className="text-[11px] text-white/50">자연어로 조건을 입력하면 이메일 보낼 대상을 정확히 추출합니다. 조건에 맞고 이메일 수신 가능한 고객만 발송됩니다.</div>
              {extracted ? (
                <div className="bg-emerald-500/10 border border-emerald-400/25 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/70">추출된 타겟 (이메일 발송 가능)</span>
                    <span className="text-lg font-bold text-emerald-300">{extracted.channelEligibleCount.toLocaleString()}명</span>
                  </div>
                  {extracted.explanation && <p className="text-[11px] text-white/50">{extracted.explanation}</p>}
                  <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200">조건 다시 추출</button>
                </div>
              ) : (
                <button onClick={() => setExtractOpen(true)} className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> AI 타겟 추출
                </button>
              )}
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
            <DateTimeField
              value={localInputToIso(scheduledAt)}
              onChange={(iso) => setScheduledAt(isoToLocalInput(iso))}
              tone="dark"
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
    <TargetExtractModal
      show={extractOpen}
      channel="email"
      onClose={() => setExtractOpen(false)}
      onApply={(t) => { setExtracted(t); setExtractOpen(false); }}
    />
    </>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
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
// 미수신자 재발송 모달 (주: 이메일 무료 재발송 / 부: SMS 유료 상위 옵션)
// ════════════════════════════════════════════════════════════════════

interface NonOpenerModalProps {
  campaign: EmailCampaign;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onGoSms: () => void;
  onReload: () => void;
}

interface NonOpenerResult {
  matched: Array<{ phone: string; name: string | null }>;
  unmatchedCount: number;
  totalNonOpeners: number;
  resendEligible: number;
  resendable: boolean;
  resendBlockReason: string | null;
}

function NonOpenerModal({ campaign, authHeaders, onClose, onToast, onGoSms, onReload }: NonOpenerModalProps) {
  // ★ 훅은 전부 조기 return 위에 (2026-07-06 훅 개수 불일치 백지 사고 방지)
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<NonOpenerResult | null>(null);
  const [subject, setSubject] = useState(campaign.subject);
  const [phase, setPhase] = useState<'view' | 'confirm'>('view');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/email/campaigns/${campaign.id}/non-openers`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
          setResult({
            matched: data.matched,
            unmatchedCount: data.unmatchedCount,
            totalNonOpeners: data.totalNonOpeners,
            resendEligible: data.resendEligible ?? 0,
            resendable: !!data.resendable,
            resendBlockReason: data.resendBlockReason ?? null,
          });
          if (data.subject) setSubject(data.subject);
        } else if (data.code === 'DB_MIGRATION_PENDING') {
          onToast('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', 'warning'); onClose();
        } else {
          onToast(data.error || '미오픈자 조회 실패', 'error'); onClose();
        }
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

  const doResend = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}/resend-non-openers`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ subject: subject.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        onToast(`미수신자 ${Number(data.total).toLocaleString()}명에게 재발송을 시작했습니다 (무료).`, 'success');
        onReload();
        onClose();
      } else if (data.code === 'DB_MIGRATION_PENDING') {
        onToast('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
        setPhase('view');
      } else {
        onToast(data.error || '재발송 실패', 'error');
        setPhase('view');
      }
    } catch (e: any) {
      onToast(e?.message || '재발송 중 오류', 'error');
      setPhase('view');
    } finally {
      setSending(false);
    }
  };

  const LARGE_VOLUME = 10000;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[2000]">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900 border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><RefreshCw className="w-5 h-5 text-cyan-300" /> 미수신자 재발송</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-white/50">{campaign.name} — 이메일을 열지 않은 고객에게 다시 보냅니다.</div>
          {loading ? (
            <div className="py-12 flex justify-center text-white/50"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : result && phase === 'view' ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-white/50">미오픈</div>
                  <div className="text-lg font-bold text-white">{result.totalNonOpeners.toLocaleString()}</div>
                </div>
                <div className="bg-cyan-500/10 border border-cyan-400/25 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-white/50">재발송 대상</div>
                  <div className="text-lg font-bold text-cyan-300">{result.resendEligible.toLocaleString()}</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-white/50">전화 매칭</div>
                  <div className="text-lg font-bold text-white/60">{result.matched.length.toLocaleString()}</div>
                </div>
              </div>

              <div className="bg-cyan-500/10 border border-cyan-400/25 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white flex items-center gap-1.5"><Mail className="w-4 h-4 text-cyan-300" /> 이메일로 재발송</div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold">무료</span>
                </div>
                <div className="text-[11px] text-white/60">안 열어본 {result.resendEligible.toLocaleString()}명에게 같은 내용을 다시 보냅니다. 제목을 바꾸면 열람률이 오릅니다.</div>
                <div>
                  <label className="text-[10px] text-white/40">제목 (바꿔서 재발송 권장)</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-sm text-white placeholder-white/30"
                    placeholder="이메일 제목"
                  />
                </div>
                <button
                  disabled={!result.resendable || result.resendEligible === 0}
                  onClick={() => setPhase('confirm')}
                  className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" /> {result.resendEligible.toLocaleString()}명에게 재발송
                </button>
                {!result.resendable && result.resendBlockReason && (
                  <div className="text-[11px] text-amber-300/80">{result.resendBlockReason}</div>
                )}
              </div>

              <div className="border-t border-white/10 pt-3">
                <div className="text-[11px] text-white/40 mb-2">더 확실히 닿고 싶으면 — 문자로 (유료)</div>
                {result.matched.length > 0 ? (
                  <div className="flex gap-2">
                    <button onClick={copyPhones} className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-white/70">전화번호 {result.matched.length}건 복사</button>
                    <button onClick={onGoSms} className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-white/70 flex items-center justify-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> SMS 발송하러 가기</button>
                  </div>
                ) : (
                  <div className="text-[11px] text-white/40">전화번호가 매칭되는 미오픈 고객이 없습니다.</div>
                )}
              </div>

              <div className="text-[10px] text-white/30 italic">Data source — email_events delivered 후 미오픈(수신거부·반송 제외) · 전화 매칭은 고객DB</div>
            </>
          ) : result && phase === 'confirm' ? (
            <>
              <div className="bg-slate-800/60 border border-white/10 rounded-xl p-4 space-y-2">
                <div className="text-sm text-white">미수신자 <strong className="text-cyan-300">{result.resendEligible.toLocaleString()}명</strong>에게 재발송합니다.</div>
                <div className="text-[11px] text-white/50 break-words">제목: {subject.trim() || campaign.subject}</div>
                <div className="text-[11px] text-emerald-300">비용 0원 — 이메일 발송은 회사 SMTP로 나가며 무료입니다.</div>
                {result.resendEligible >= LARGE_VOLUME && (
                  <div className="text-[11px] text-amber-300 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> 대량 발송입니다. 발신 도메인 평판에 영향을 줄 수 있어 재발송은 1회로 제한됩니다.</div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPhase('view')} disabled={sending} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-white/70 disabled:opacity-40">뒤로</button>
                <button onClick={doResend} disabled={sending} className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 disabled:opacity-40 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {sending ? '발송 시작 중...' : '재발송 확정'}
                </button>
              </div>
            </>
          ) : null}
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
