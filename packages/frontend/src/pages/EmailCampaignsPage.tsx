import ZoneFrame from '../components/zone/ZoneFrame';
import { zoneModule } from '../constants/ai-operator-modules';
import { Package, FolderOpen as ZFolderOpen } from 'lucide-react';
import { MK_LINE_EXTRA_BTN } from '../utils/make-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
// ★ 2026-09-14 T5·T6 AI 자동제작 — 상단 카드띠(입구) · ?edit={campaignId} 딥링크(완성본 착지) · 생성 금액 단일 출처
import AiBuildEntryStrip from '../components/ai-build/AiBuildEntryStrip';
import { useAiAutoBuildEnabled } from '../utils/ai-build';
import { AI_GENERATE_COSTS } from '../constants/credit';
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
// ★ 2026-09-27 만들기 개편 — 발송 대상 창은 결과 화면·보내기 창도 쓰므로 공용 파일로 옮겼다(원본 그대로)
import RecipientsModal from '../components/email/EmailRecipientsModal';
// ★ 2026-09-27 만들기 개편 — 첫 화면(만들기 카드 · 다른 방법 접힘 · 카드칩 · 상세 창) · 수정 화면(EmailEditScreen · DM 과 같은 칸) · 보내기 창
import { Layers } from 'lucide-react';
import EmailEditScreen from '../components/make/EmailEditScreen';
import { newAttemptToken, appendToOneLine } from '../utils/one-line';   // ★ 2026-10-05 한줄로 시그니처
import EmailDetailModal from '../components/make/EmailDetailModal';
import MakeSendModal from '../components/make/MakeSendModal';
import SmtpConnectModal from '../components/email/SmtpConnectModal';
import { ListHead, EmailChip, Meter, fmtDate } from '../components/make/HomeParts';
import { emailChipStatus, emailCoverOf, type ChipStatus } from '../utils/make-flow';
import '../styles/make.css';

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

// ★ 2026-07-02(3) EMPTY_CAMPAIGN_FORM 제거 — 신규 진입은 템플릿/비주얼/프롬프트 전부 비주얼 편집기.
//   레거시 HTML 폼은 기존 HTML 전용 캠페인 수정(openEditor 폴백)에만 쓰인다.

// ════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ════════════════════════════════════════════════════════════════════

export default function EmailCampaignsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ★ 2026-09-14 T5 딥링크(/email-campaigns?edit=<campaignId>) — AI 자동제작 완성본 착지. 마운트 때 한 번 읽고 URL 에서 지운다(새로고침이 되풀이하지 않게).
  const [editEntryId] = useState(() => String(searchParams.get('edit') || '').trim() || null);
  const editEntryHandled = useRef(false);
  const autoBuild = useAiAutoBuildEnabled();
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

  // SMTP 설정 영역 — 창·입력·저장은 공용 SmtpConnectModal 소유(★2026-10-03 이관)
  const [smtpFormOpen, setSmtpFormOpen] = useState(false);
  // ★ 2026-10-03 담당자도 읽는 연결 상태(/api/email/status) — 관리 권한 · 공개 발신 이름(관리자 전용 /smtp-config 는 담당자에게 403)
  const [smtpCanManage, setSmtpCanManage] = useState(true);
  const [smtpFromName, setSmtpFromName] = useState('');

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
  const [visualEditor, setVisualEditor] = useState<{ sections: Section[]; name?: string; subject?: string; isAd?: boolean; aiGenerated?: boolean; campaignId?: string; completed?: boolean; design?: EmailDesign | null; fromName?: string; hasPlaceholder?: boolean; line?: { text: string; gapBenefit: boolean } | null } | null>(null);
  // ★ 2026-07-02 캠페인 목록 페이징 — 2열 × 2줄 = 페이지당 4카드 (Harold 확정)
  const CAMPAIGN_PAGE_SIZE = 4;
  const [campaignPage, setCampaignPage] = useState(1);
  // 템플릿 갤러리 모달 (즉시·무료 골격)
  const [showGallery, setShowGallery] = useState(false);
  // 성과 분석 대시보드 모달
  const [showAnalytics, setShowAnalytics] = useState(false);
  // ★ 2026-09-27 만들기 개편 — 첫 화면 상태 · 진입 값(?other=1 다른 방법 펼침 · blank 빈 화면 · ?pair= 같은 재료 DM)
  //   ★ 2026-10-03 ?smtp=1(회사 메일 연결 창) 진입 폐지 — 보내기 창이 연결 창을 직접 띄운다(같은 페이지 안 이동은 다시 열리지 않아 무반응이었다)
  const [entryOther] = useState(() => String(searchParams.get('other') || '').trim() || null);
  const [pairDmId] = useState(() => String(searchParams.get('pair') || '').trim() || null);
  // ★ 2026-09-30 AI 존 보정: 접힌 "다른 방법" 패널 폐지 — ?other=1 로 오면 명령 카드([광고성]·[이미지])·시작 카드가 처음부터 보인다
  const [listFilter, setListFilter] = useState<'all' | ChipStatus>('all');
  const [listQuery, setListQuery] = useState('');
  const [listSort, setListSort] = useState('recent');
  const [listLimit, setListLimit] = useState(24);
  const [detail, setDetail] = useState<EmailCampaign | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [pageSend, setPageSend] = useState<EmailCampaign | null>(null);

  const token = () => localStorage.getItem('token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  // ────────────────────────────────────────────────────────────────
  // 데이터 로드
  // ────────────────────────────────────────────────────────────────

  const handle503 = (data: any): boolean => {
    if (data?.code === 'DB_MIGRATION_PENDING') {
      setError(data.error || 'DB 마이그레이션 필요. 운영자에게 문의해주세요.');
      showToast('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
      return true;
    }
    if (data?.code === 'SMTP_ENCRYPTION_KEY_MISSING') {
      setError(data.error || 'SMTP 암호화 키 미설정. 운영자에게 문의해주세요.');
      showToast('SMTP 암호화 키 미설정. 운영자에게 .env 등록 요청 의무', 'warning');
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

      if (statusData.success) {
        setSmtpConfigured(!!statusData.smtp_configured);
        setSmtpCanManage(statusData.can_manage !== false);
        setSmtpFromName(String(statusData.from_name || ''));
      }
      if (configData.success && configData.config) setSmtpConfig(configData.config);
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
        showToast(`테스트 발송 완료. ${testEmail} 수신 확인해주세요 (스팸 폴더도 확인)`, 'success');
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
        showToast(`테스트발송 완료. ${data.sent}건 발송 (수신함·스팸 폴더 확인)`, 'success');
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
      setVisualEditor({ sections: c.sections as Section[], name: c.name, subject: c.subject, isAd: c.isAd, aiGenerated: c.aiGenerated, campaignId: c.id, completed: c.completed, design: c.design ?? null, fromName: c.fromName, hasPlaceholder: c.hasPlaceholder });
    } else {
      setEditing(c);
    }
  };

  // ★ 2026-09-14 T5 딥링크 — 목록이 한 번 로드된 뒤 그 캠페인을 단건 조회해 편집기로 연다(목록 50건 밖이어도 열린다). 없으면 안내만.
  useEffect(() => {
    if (!editEntryId || editEntryHandled.current || loading) return;
    editEntryHandled.current = true;
    setSearchParams({}, { replace: true });
    (async () => {
      try {
        const r = await fetch(`/api/email/campaigns/${encodeURIComponent(editEntryId)}`, { headers: authHeaders() });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.success || !d?.campaign) { showToast('이 캠페인을 열 수 없습니다. 캠페인을 만든 계정으로 로그인했는지 확인해 주세요.', 'error'); return; }
        openEditor(d.campaign as EmailCampaign);
      } catch {
        showToast('캠페인을 불러오지 못했습니다. 새로고침해 주세요.', 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editEntryId, loading]);

  // ★ 2026-09-27 만들기 개편 S11 — 복제(초안 · 차감 0)
  const handleClone = async (c: EmailCampaign) => {
    if (cloningId) return;
    setCloningId(c.id);
    try {
      const res = await fetch(`/api/email/campaigns/${c.id}/clone`, { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data?.success) { showToast('복제했어요. "복사본"으로 추가됐어요.', 'success'); await loadAll(); }
      else showToast(data?.error || '복제하지 못했어요.', 'error');
    } catch (e: any) {
      showToast(e?.message || '복제하지 못했어요.', 'error');
    } finally {
      setCloningId(null);
    }
  };
  const entryHandled = useRef(false);
  useEffect(() => {
    if (entryHandled.current || loading) return;
    entryHandled.current = true;
    if (entryOther === 'blank') setVisualEditor({ sections: [], isAd: true, aiGenerated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
  // ★ 2026-10-05 한줄로 시그니처 — 한 줄 입구 표시 + 시도 토큰(서버가 스위치를 본다 · 스위치 밖이면 응답 그대로).
  //   line = 처음 적은 한 줄(혜택을 넣어 새로 만들 때도 다시 입력하지 않는다).
  const handleAiGenerate = async (opts: { prompt?: string; line?: string }) => {
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
        body: JSON.stringify({ prompt: opts.prompt.trim(), is_ad: aiAsAd, one_line: true, attempt_token: newAttemptToken() }),
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
          line: g.one_line?.enabled ? { text: (opts.line ?? opts.prompt).trim(), gapBenefit: g.one_line.gaps?.benefit === true } : null,
        });
        showToast('AI 생성 완료. 비주얼 편집기에서 확인하고 다듬어주세요. (3 크레딧)', 'success');
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
    showToast('행사 캠페인 이메일 초안을 불러왔습니다. 이미지만 올리고 다듬어주세요.', 'success');
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
      showToast('스튜디오 소재로 이메일을 시작했어요. 제목·문구만 더해주세요.', 'success');
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
    showToast(`라이브러리 소재 ${urls.length}장으로 이메일을 시작했어요. 제목·문구만 더해주세요.`, 'success');
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
          showToast(`예약 완료: ${new Date(data.scheduledAt).toLocaleString('ko-KR')} 발송 (대상 ${data.total}명${excluded})`, 'success');
          setSendingId(null);
          await loadAll();
        } else {
          showToast(`발송 시작: 대상 ${data.total}명${excluded} (진행 상황 자동 갱신)`, 'success');
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
    const desc = `${total.toLocaleString()}명에게 ${sched ? '예약' : '즉시'} 발송합니다.${campaign.isAd ? ' (광고성, "(광고)" + 수신거부 링크 자동 부착)' : ''} 발신 = ${campaign.fromEmail}`;
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
            showToast('예약이 취소되었습니다. 캠페인은 초안 상태로 보관됩니다.', 'success');
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

  const emailOneLine = zoneModule('email').oneLine!;
  const sentCampaignCount = campaigns.filter((c) => c.sentCount > 0).length;
  return (
    <ZoneFrame
      moduleId="email"
      links={campaigns.length > 0 ? [{ label: '자세히 분석', icon: BarChart3, onClick: () => setShowAnalytics(true) }] : []}
      more={smtpConfigured && smtpConfig?.isConfigured ? [
        { label: `회사 메일 설정 · ${smtpConfig.fromEmail}`, icon: Settings, onClick: () => setSmtpFormOpen(true) },
        { label: '연결 점검(내 메일로 보내 보기)', icon: Send, onClick: () => setTestModalOpen(true) },
      ] : []}
      command={{
        line: {
          value: aiPrompt,
          onChange: setAiPrompt,
          onSubmit: () => handleAiGenerate({ prompt: aiPrompt }),
          placeholder: emailOneLine.placeholder,
          verb: emailOneLine.verb,
          icon: Wand2,
          busy: genStep !== null,
          credit: `${AI_GENERATE_COSTS['email-ai-generate']}크레딧`,
          extra: (
            <>
              <label className={`${MK_LINE_EXTRA_BTN} cursor-pointer select-none ${aiAsAd ? '!border-amber-300 !bg-amber-50 !text-amber-900' : ''}`} title='광고성 이메일로 만들기: 발송 시 "(광고)" + 수신거부 링크 자동 부착'>
                <input type="checkbox" checked={aiAsAd} onChange={(e) => setAiAsAd(e.target.checked)} disabled={genStep !== null} className="rounded accent-amber-500" />
                광고성
              </label>
              <ImageToCopyButton
                label="이미지"
                onExtracted={(t) => setAiPrompt((prev) => appendToOneLine(prev, t))}
                disabled={genStep !== null}
                className={MK_LINE_EXTRA_BTN}
              />
            </>
          ),
        },
      }}
      kpis={[
        { label: '보낸 메일', value: sentCampaignCount.toLocaleString() },
        { label: '평균 오픈율', value: campaigns.length ? `${stats.openRate.toFixed(1)}%` : '—' },
        { label: '클릭률', value: campaigns.length ? `${stats.clickRate.toFixed(1)}%` : '—' },
        { label: '반송률', value: campaigns.length ? `${stats.bounceRate.toFixed(1)}%` : '—' },
      ]}
      stamp={{ text: '다시 읽기', onRefresh: loadAll, loading }}
      start={{
        items: [
          { icon: Package, title: '재료로 만들기', desc: '행사 주소·사진만 넣으면 완성', tint: 'from-blue-400 to-cyan-500', featured: true, badge: '추천', onClick: () => navigate('/quick-campaign?channel=email'), disabled: genStep !== null },
          { icon: Layers, title: '블록으로 직접', desc: '빈 캔버스에서 블록을 직접 조립해요', tint: 'from-violet-400 to-fuchsia-500', onClick: () => setVisualEditor({ sections: [], isAd: true, aiGenerated: false }), disabled: genStep !== null },
          { icon: LayoutTemplate, title: '템플릿에서', desc: '완성된 골격을 한 번에 · 크레딧 0', tint: 'from-emerald-400 to-teal-500', onClick: () => setShowGallery(true), disabled: genStep !== null },
          { icon: ZFolderOpen, title: '라이브러리에서', desc: '저장 소재를 골라 이미지 이메일로', tint: 'from-amber-400 to-orange-500', onClick: () => setStartLibOpen(true), disabled: genStep !== null },
        ],
      }}
      blocks={[
        ...(error ? [{ text: error, tone: 'rose' as const }] : []),
        ...(!smtpConfigured && !loading ? [smtpCanManage
          ? { text: '보내려면 회사 메일 연결이 필요해요. 만들기와 미리보기는 지금 돼요.', actionLabel: '회사 메일 연결하기', onAction: () => setSmtpFormOpen(true) }
          : { text: '보내려면 회사 메일 연결이 필요해요. 회사 관리자에게 연결을 요청해 주세요. 만들기와 미리보기는 지금 돼요.' }] : []),
      ]}
    >
      <div className="space-y-5">
        {/* ★ 2026-07-19 P4: 라이브러리 다중 선택 → 이미지 섹션 이메일 · ★0930 명령 카드 더보기에서도 열리므로 접힌 패널 밖에 둔다(Codex R1) */}
        <AssetLibraryPickerModal
          open={startLibOpen}
          onClose={() => setStartLibOpen(false)}
          multiSelect
          onPick={(a) => startFromLibrary([a])}
          onPickMany={startFromLibrary}
        />
        {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4" />}
        <div className="text-[10px] text-slate-400 italic -mt-1">Data source: 회사 Brand Voice 학습 결과 자동 반영 · 구체 혜택은 직접 입력</div>

        {/* ★ 2026-09-27 만들기 개편 — 내 이메일 = 요약 한 줄 + 상태 거름 칩 + 찾기·정렬 + 받은편지함 모양 카드칩(목업 마 ③) · 누르면 상세 창 · 초안 = 이어서 고치기 */}
        {(() => {
          const rate = (c: EmailCampaign) => (c.sentCount > 0 ? c.openCount / c.sentCount : -1);
          const rows = campaigns.map((c) => ({ c, st: emailChipStatus(c) }));
          const cnt: Record<string, number> = { all: rows.length };
          rows.forEach(({ st }) => { cnt[st] = (cnt[st] || 0) + 1; });
          const q = listQuery.trim().toLowerCase();
          let shown = rows.filter(({ c, st }) => (listFilter === 'all' || st === listFilter) && (!q || `${c.name} ${c.subject}`.toLowerCase().includes(q)));
          if (listSort === 'open') shown = shown.slice().sort((a, b) => rate(b.c) - rate(a.c));
          else if (listSort === 'title') shown = shown.slice().sort((a, b) => (a.c.name || '').localeCompare(b.c.name || '', 'ko'));
          const sentCampaigns = campaigns.filter((c) => c.sentCount > 0).length;
          return (
            <section className="pt-3">
              <ListHead
                title="내 이메일"
                filters={[
                  { key: 'all' as const, label: '전체', count: cnt.all || 0 },
                  { key: 'draft' as const, label: '초안', count: cnt.draft || 0 },
                  { key: 'scheduled' as const, label: '예약', count: cnt.scheduled || 0 },
                  { key: 'sent' as const, label: '보냄', count: cnt.sent || 0 },
                  { key: 'failed' as const, label: '보내지 못함', count: cnt.failed || 0 },
                ]}
                filter={listFilter === 'stopped' ? 'all' : listFilter}
                onFilter={(f) => { setListFilter(f); setListLimit(24); }}
                query={listQuery}
                onQuery={setListQuery}
                sort={listSort}
                onSort={setListSort}
                sortOptions={[{ value: 'recent', label: '최근 순' }, { value: 'open', label: '오픈율 높은 순' }, { value: 'title', label: '이름 순' }]}
              />
              {loading ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 mt-4 flex justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : campaigns.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 py-12 px-5 text-center">
                  <div className="text-[15px] font-bold text-slate-900">아직 만든 이메일이 없어요</div>
                  <div className="text-[13px] text-slate-500 mt-1.5">사진과 글만 넣으면 첫 이메일이 완성돼요.</div>
                  <button type="button" onClick={() => navigate('/quick-campaign?channel=email')} className="mt-4 h-10 px-5 rounded-xl text-[13.5px] font-bold text-white bg-indigo-600 hover:bg-indigo-700">만들기</button>
                </div>
              ) : shown.length === 0 ? (
                <div className="py-14 text-center text-[13px] text-slate-400">조건에 맞는 이메일이 없어요.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
                  {shown.slice(0, listLimit).map(({ c, st }) => (
                    <EmailChip
                      key={c.id}
                      from={c.fromName}
                      subject={c.subject}
                      cover={emailCoverOf(c.sections as any)}
                      status={st}
                      title={c.name}
                      meta={st === 'draft' ? `${fmtDate(c.createdAt)} 만듦${c.completed ? ' · 완성' : ''}`
                        : st === 'scheduled' ? `${c.scheduledAt ? new Date(c.scheduledAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} 예약`
                          : st === 'failed' ? <span className="text-rose-700">보내지 못했어요 · 다시 보내기</span>
                            : c.status === 'sending' ? `보내는 중 · ${c.sentCount.toLocaleString()}명`
                              : `${fmtDate(c.sentAt)} · ${c.sentCount.toLocaleString()}명`}
                      metric={st === 'sent' && c.sentCount > 0 ? <Meter label={`오픈 ${((c.openCount / c.sentCount) * 100).toFixed(1)}% · 클릭 ${((c.clickCount / c.sentCount) * 100).toFixed(1)}%`} pct={(c.openCount / c.sentCount) * 100} /> : undefined}
                      onOpen={() => { if (st === 'draft') openEditor(c); else setDetail(c); }}
                    />
                  ))}
                </div>
              )}
              {shown.length > listLimit && (
                <div className="flex justify-center mt-5"><button type="button" onClick={() => setListLimit((v) => v + 24)} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-600 border border-slate-300 hover:bg-slate-100">더 보기 ({(shown.length - listLimit).toLocaleString()})</button></div>
              )}
              <div className="text-[10px] text-slate-400 italic mt-4">Data source: email_campaigns + email_events 누적 집계</div>
            </section>
          );
        })()}
      </div>

      {/* ★ 2026-09-27 만들기 개편 — 보낸 이메일 상세 창(성과·발송 이력·받은 사람별·AI 진단) */}
      {detail && (
        <EmailDetailModal
          campaign={detail}
          cover={emailCoverOf(detail.sections as any)}
          authHeaders={authHeaders}
          onClose={() => setDetail(null)}
          onEdit={() => { const c = detail; setDetail(null); openEditor(c); }}
          onTest={() => { const c = detail; setDetail(null); openCampaignTest(c); }}
          onExportHtml={() => { void handleExportHtml(detail); }}
          exporting={htmlExporting === detail.id}
          onClone={() => { void handleClone(detail); }}
          cloning={cloningId === detail.id}
          onDelete={() => { const c = detail; setDetail(null); handleDeleteCampaign(c); }}
          onInsight={() => { const c = detail; setDetail(null); setInsightModal({ campaign: c }); }}
          onNonOpener={() => { const c = detail; setDetail(null); setNonOpenerModal({ campaign: c }); }}
          onSend={() => { const c = detail; setDetail(null); setPageSend(c); }}
          onCancelSchedule={() => { const c = detail; setDetail(null); handleCancelSchedule(c); }}
          onOpenEvents={() => { const c = detail; setDetail(null); setEventsModal({ id: c.id, name: c.name }); }}
        />
      )}
      <MakeSendModal
        open={!!pageSend}
        onClose={() => setPageSend(null)}
        channel="email"
        dm={null}
        email={pageSend ? { id: pageSend.id, name: pageSend.name, subject: pageSend.subject, isAd: pageSend.isAd, completed: !!pageSend.completed, hasPlaceholder: pageSend.hasPlaceholder } : null}
        onSent={() => { const id = pageSend?.id; void loadAll(); if (id) pollCampaign(id); }}
        onSmtpChanged={() => { void loadAll(); }}
      />

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

      {/* SMTP 설정 모달 — 공용 창(★2026-10-03) · 영구 제거 확인 창은 이 화면 소유 */}
      <SmtpConnectModal
        open={smtpFormOpen}
        onClose={() => setSmtpFormOpen(false)}
        onSaved={() => { void loadAll(); }}
        onClear={smtpConfig?.isConfigured ? () => { setSmtpFormOpen(false); handleClearSmtp(); } : undefined}
      />

      {/* 테스트 발송 — 작은 모달 (가로 큰 카드 대체) */}
      {testModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Send className="w-4 h-4 text-cyan-700" /> 테스트 발송</h3>
              <button onClick={() => setTestModalOpen(false)} disabled={testSending} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100 disabled:opacity-40" aria-label="닫기"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">회사 admin 본인 이메일에 테스트 발송 → SMTP 설정 정상 동작 확인 (스팸 폴더도 확인)</p>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !testSending && testEmail.trim()) handleTestSend(); }}
                placeholder="테스트 수신 이메일 (예: admin@example.com)"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-cyan-300"
              />
              <button
                onClick={handleTestSend}
                disabled={testSending || !testEmail.trim()}
                className="w-full px-4 py-2 bg-cyan-100 hover:bg-cyan-200 disabled:opacity-40 disabled:cursor-not-allowed text-cyan-900 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5"
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
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-3 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Send className="w-4 h-4 text-teal-700" /> 테스트발송</h3>
                <p className="text-[11px] text-slate-500 mt-1 truncate">{campaignTest.name}</p>
              </div>
              <button onClick={() => setCampaignTest(null)} disabled={campaignTestSending} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">이 이메일을 입력한 주소로 그대로 보냅니다 (최대 3개). 광고 표기 없이 발송되며 통계에 반영되지 않습니다.</p>
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="email"
                  value={campaignTestEmails[i]}
                  onChange={(e) => setCampaignTestEmails((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !campaignTestSending) handleCampaignTestSend(); }}
                  placeholder={`받는 사람 ${i + 1}${i === 0 ? ' (필수)' : ' (선택)'}`}
                  className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-300"
                />
              ))}
              <button
                onClick={handleCampaignTestSend}
                disabled={campaignTestSending || campaignTestEmails.every((e) => !e.trim())}
                className="w-full px-4 py-2 bg-teal-100 hover:bg-teal-200 disabled:opacity-40 disabled:cursor-not-allowed text-teal-900 text-sm font-medium rounded-lg flex items-center justify-center gap-1.5"
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
          <div className="w-full max-w-sm bg-violet-50 border border-fuchsia-200 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">AI가 이메일을 만들고 있어요</div>
                <div className="text-[11px] text-slate-500">잠시만 기다려주세요</div>
              </div>
            </div>
            <div className="space-y-2">
              {EMAIL_GEN_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {i < (genStep ?? 0) ? (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : i === (genStep ?? 0) ? (
                    <Loader2 className="w-4 h-4 text-fuchsia-700 animate-spin shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0" />
                  )}
                  <span className={i <= (genStep ?? 0) ? 'text-slate-800' : 'text-slate-400'}>{step}</span>
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
      {/* ★ 2026-09-27 만들기 개편 — 수정 화면 = EmailEditScreen(DM 수정 화면과 같은 칸 · 같은 고치는 방법 · 옛 편집기 기능 전부) */}
      {visualEditor && (
        <EmailEditScreen
          initialSections={visualEditor.sections}
          initialName={visualEditor.name}
          initialSubject={visualEditor.subject}
          initialIsAd={visualEditor.isAd}
          initialDesign={visualEditor.design}
          aiGenerated={visualEditor.aiGenerated}
          campaignId={visualEditor.campaignId}
          completed={visualEditor.completed}
          fromName={visualEditor.fromName || smtpConfig?.fromName || smtpFromName || ''}
          hasPlaceholder={visualEditor.hasPlaceholder}
          pairDmId={pairDmId}
          authHeaders={authHeaders}
          lineAssist={visualEditor.line || null}
          onRegenerateWithBenefit={(benefit) => {
            // ★ 2026-10-05 결과에 혜택 자리가 없을 때만 오는 길 — 새 이메일로 만든다(지금 이메일은 저장된 채 그대로 · 생성비 1회)
            const line = visualEditor.line?.text || '';
            setVisualEditor(null);
            void handleAiGenerate({ prompt: `${line}\n[혜택] ${benefit}`, line });
          }}
          onClose={() => setVisualEditor(null)}
          onSaved={() => { loadAll(); }}
          onToast={showToast}
        />
      )}

      {/* ConfirmModal */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />
    </ZoneFrame>
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
      <div className="bg-violet-50 border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            {editing.aiGenerated && <Sparkles className="w-4 h-4 text-fuchsia-700" />}
            {editing.id ? '캠페인 수정' : editing.aiGenerated ? 'AI 생성 이메일: 확인 후 발송' : '신규 Email 캠페인'}
          </h3>
          <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">캠페인 이름 (회사 admin 내부 식별용)</label>
            <input
              type="text"
              value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="VIP 5월 재구매 안내"
              className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">제목 (수신자 노출 subject)</label>
            <input
              type="text"
              value={editing.subject || ''}
              onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
              placeholder="VIP 회원님께 드리는 5월 특별 안내"
              className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              maxLength={200}
            />
            {(editing.subject || '').length > 40 && (
              <div className="text-[10px] text-amber-700 mt-1">제목 {(editing.subject || '').length}자. 모바일 수신함에서 40자 이후가 잘릴 수 있어요.</div>
            )}
            {/* AI 제목 3안 칩 */}
            {subjects.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[10px] text-slate-400 self-center">AI 제안:</span>
                {subjects.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setEditing({ ...editing, subject: s })}
                    className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${editing.subject === s ? 'bg-fuchsia-100 border-fuchsia-300 text-slate-900' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}
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
              <label className="text-xs text-slate-600 block mb-1">발신자 이름 (선택)</label>
              <input
                type="text"
                value={editing.fromName || ''}
                onChange={(e) => setEditing({ ...editing, fromName: e.target.value })}
                placeholder="SMTP 설정 default 활용"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">발신 이메일 (선택)</label>
              <input
                type="email"
                value={editing.fromEmail || ''}
                onChange={(e) => setEditing({ ...editing, fromEmail: e.target.value })}
                placeholder="SMTP 설정 default 활용"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              />
            </div>
          </div>
          {/* AI 다듬기 (1 크레딧) */}
          <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-[11px] text-fuchsia-800 font-semibold">
                <Wand2 className="w-3.5 h-3.5" /> AI 다듬기 (1 크레딧)
              </div>
              <button
                onClick={() => handleRefine(ONE_CLICK_REFINE)}
                disabled={refining || !editing.subject?.trim() || !editing.htmlBody?.trim()}
                className="px-2.5 py-1 bg-gradient-to-r from-fuchsia-50 to-purple-50 hover:from-fuchsia-50 hover:to-purple-50 disabled:opacity-40 text-slate-900 text-[11px] font-semibold rounded-lg flex items-center gap-1 whitespace-nowrap"
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
                className="flex-1 px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-fuchsia-300 disabled:opacity-50"
              />
              <button
                onClick={() => handleRefine()}
                disabled={refining || !refineInstruction.trim()}
                className="px-3 py-2 bg-fuchsia-200 hover:bg-fuchsia-200 disabled:opacity-40 text-slate-900 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                다듬기
              </button>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-600">HTML 본문</label>
              <button onClick={() => setShowPreview((v) => !v)} className="text-[11px] text-slate-500 hover:text-slate-900 flex items-center gap-1">
                {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showPreview ? 'HTML 코드 보기' : '미리보기'}
              </button>
            </div>
            {showPreview ? (
              <iframe
                title="이메일 미리보기"
                srcDoc={editing.htmlBody || ''}
                className="w-full h-72 bg-white rounded-lg border border-slate-200"
                sandbox=""
              />
            ) : (
              <textarea
                value={editing.htmlBody || ''}
                onChange={(e) => setEditing({ ...editing, htmlBody: e.target.value })}
                placeholder="<p>안녕하세요, {{이름}}님</p>"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-xs font-mono resize-y h-72 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              />
            )}
            <div className="text-[10px] text-slate-400 mt-1">{`{{이름}}`} = 발송 시 고객 이름 자동 치환 · 수신거부 링크는 발송 시 자동 부착</div>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">텍스트 본문 (선택, HTML 미지원 클라이언트 대응)</label>
            <textarea
              value={editing.textBody || ''}
              onChange={(e) => setEditing({ ...editing, textBody: e.target.value })}
              placeholder="안녕하세요, {{이름}}님"
              className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-xs resize-y h-20 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
            />
          </div>
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <input
              type="checkbox"
              id="campaign_is_ad"
              checked={!!editing.isAd}
              onChange={(e) => setEditing({ ...editing, isAd: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="campaign_is_ad" className="text-xs text-amber-900">
              <strong>광고성 이메일</strong>: 체크 시 "(광고)" prefix + 수신거부 링크 자동 부착 (정보통신망법 의무).
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 bg-violet-50 border-t border-slate-200 px-6 py-3 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-white rounded-lg">취소</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg flex items-center gap-2"
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
      <div className="bg-violet-50 border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-5 h-5 text-fuchsia-700" /> AI 성과 진단</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-slate-500">{campaign.name}</div>
          {loading ? (
            <div className="py-12 flex justify-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <>
              {stats && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '오픈율', value: stats.openRatePct != null ? `${stats.openRatePct}%` : '—', sub: `${stats.uniqueOpeners}명` },
                    { label: '클릭율', value: stats.clickRatePct != null ? `${stats.clickRatePct}%` : '—', sub: `${stats.uniqueClickers}명` },
                    { label: '발송', value: stats.sentCount.toLocaleString(), sub: `반송 ${stats.bounceCount}` },
                  ].map((m, i) => (
                    <div key={i} className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                      <div className="text-[10px] text-slate-500">{m.label}</div>
                      <div className="text-lg font-bold text-slate-900">{m.value}</div>
                      <div className="text-[10px] text-slate-400">{m.sub}</div>
                    </div>
                  ))}
                </div>
              )}
              {insight && (
                <>
                  <div className="bg-gradient-to-br from-fuchsia-50 to-purple-50 border border-fuchsia-200 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-[11px] text-fuchsia-800 font-semibold mb-1.5"><TrendingUp className="w-3.5 h-3.5" /> 핵심 발견</div>
                    <p className="text-sm text-slate-800 leading-relaxed">{insight.topInsight}</p>
                  </div>
                  {insight.suggestions.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 font-semibold">다음 캠페인 개선 제안</div>
                      {insight.suggestions.map((s, i) => (
                        <div key={i} className="bg-white border border-slate-200 rounded-xl p-3">
                          <div className="text-sm font-semibold text-emerald-700 mb-0.5">{s.title}</div>
                          <div className="text-xs text-slate-600 leading-relaxed">{s.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="text-[10px] text-slate-400 italic">Data source: 실측 오픈/클릭 이벤트 (email_events)</div>
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
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-cyan-700" /> 미수신자 재발송</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-slate-500">{campaign.name}: 이메일을 열지 않은 고객에게 다시 보냅니다.</div>
          {loading ? (
            <div className="py-12 flex justify-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : result && phase === 'view' ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-slate-500">미오픈</div>
                  <div className="text-lg font-bold text-slate-900">{result.totalNonOpeners.toLocaleString()}</div>
                </div>
                <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-slate-500">재발송 대상</div>
                  <div className="text-lg font-bold text-cyan-700">{result.resendEligible.toLocaleString()}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                  <div className="text-[10px] text-slate-500">전화 매칭</div>
                  <div className="text-lg font-bold text-slate-500">{result.matched.length.toLocaleString()}</div>
                </div>
              </div>

              <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Mail className="w-4 h-4 text-cyan-700" /> 이메일로 재발송</div>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">무료</span>
                </div>
                <div className="text-[11px] text-slate-500">안 열어본 {result.resendEligible.toLocaleString()}명에게 같은 내용을 다시 보냅니다. 제목을 바꾸면 열람률이 오릅니다.</div>
                <div>
                  <label className="text-[10px] text-slate-400">제목 (바꿔서 재발송 권장)</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-900 placeholder-slate-400"
                    placeholder="이메일 제목"
                  />
                </div>
                <button
                  disabled={!result.resendable || result.resendEligible === 0}
                  onClick={() => setPhase('confirm')}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" /> {result.resendEligible.toLocaleString()}명에게 재발송
                </button>
                {!result.resendable && result.resendBlockReason && (
                  <div className="text-[11px] text-amber-700">{result.resendBlockReason}</div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="text-[11px] text-slate-400 mb-2">더 확실히 닿고 싶으면: 문자로 (유료)</div>
                {result.matched.length > 0 ? (
                  <div className="flex gap-2">
                    <button onClick={copyPhones} className="flex-1 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600">전화번호 {result.matched.length}건 복사</button>
                    <button onClick={onGoSms} className="flex-1 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center justify-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> SMS 발송하러 가기</button>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">전화번호가 매칭되는 미오픈 고객이 없습니다.</div>
                )}
              </div>

              <div className="text-[10px] text-slate-400 italic">Data source: email_events delivered 후 미오픈(수신거부·반송 제외) · 전화 매칭은 고객DB</div>
            </>
          ) : result && phase === 'confirm' ? (
            <>
              <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="text-sm text-slate-900">미수신자 <strong className="text-cyan-700">{result.resendEligible.toLocaleString()}명</strong>에게 재발송합니다.</div>
                <div className="text-[11px] text-slate-500 break-words">제목: {subject.trim() || campaign.subject}</div>
                <div className="text-[11px] text-emerald-700">비용 0원: 이메일 발송은 회사 SMTP로 나가며 무료입니다.</div>
                {result.resendEligible >= LARGE_VOLUME && (
                  <div className="text-[11px] text-amber-700 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> 대량 발송입니다. 발신 도메인 평판에 영향을 줄 수 있어 재발송은 1회로 제한됩니다.</div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPhase('view')} disabled={sending} className="flex-1 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-600 disabled:opacity-40">뒤로</button>
                <button onClick={doResend} disabled={sending} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5">
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
    draft: { label: '초안', cls: 'bg-slate-100 text-slate-600' },
    scheduled: { label: '예약', cls: 'bg-amber-100 text-amber-700' },
    sending: { label: '발송 중', cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
    completed: { label: '완료', cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
    failed: { label: '실패', cls: 'bg-rose-100 text-rose-700 border border-rose-200' },
  };
  const e = map[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
