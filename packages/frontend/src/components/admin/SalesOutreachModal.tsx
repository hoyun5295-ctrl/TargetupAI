/**
 * ★ 2026-08-24 AI 영업 아웃리치 모달 (슈퍼관리자 ceo 전용 · 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-4)
 * ★ 2026-09-05 개정 = docs/2026-09-05-ai-sales-outreach-refinement-design.md §9 (중복 409 · 다시 읽기 · 재료 전문 · 제목 편집 · 폭 토글 ·
 *   산출물별 다시 만들기 · 메일 재조립 · 발송 잠금 사유 · 실패 상세 · 숨기기 · 근거 패널 계측 · 검색·상태 칩·더 보기 · 검수 메일 발송(B-15) · 추가 정보 입력)
 *
 * 톤 = 부모 화면(AdminDashboard 라이트 리터럴 · 블루 강조) 그대로. CUI/바이올렛 미사용(0824 도움말 탭 선례).
 * 산출물 미리보기 구역만 다크 액자(bg-slate-950) — 흰 이메일 카드가 라이트 지면에서 경계를 잃는 물리 문제의 해법.
 * 모달 1창 4단계: 입력 → 분석 → 읽은 것 확인(사람 게이트) → 제작·검토·발송.
 *
 * 규율: portal + ESC 캡처 stopPropagation / 껍데기에 transform·backdrop-filter 0 / 백드롭 클릭 닫힘 0 /
 *   긴 작업은 close 차단 없이 서버 잡 + 2초 폴링("닫아도 계속됩니다") / 진행 표시는 실제 상태만(타이머 연출 0) /
 *   발송·DM·이미지 재생성은 확인 모달 1회 경유 / 성공 통지 = toast · 오류·경고 = 배너 / 모델명·내부 용어 0 /
 *   서버 숫자만 표시(placeholder 문자열을 프론트가 복제하지 않는다) / 늦은 응답 폐기(요청 순번).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, RefreshCw, Send, Check, ExternalLink, Pencil, Upload, Download, List, Search, EyeOff, Eye, Mail, ChevronDown, ChevronUp, Smartphone, Monitor, Trash2, CheckSquare, Square } from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../ConfirmModal';
import { useToast } from '../ToastProvider';

interface IndustryOption { code: string; label: string }

interface OutreachAsset { kind: string; payload: any; created_at: string; regen_count?: number }

interface OutreachJob {
  id: string;
  company_name: string;
  industry_category: string | null;
  homepage_url: string;
  stage: string;
  stage_results?: Record<string, any> | null;
  /** ★ v3 selectedList = 다중 선택(≤3 · 누른 순서) · selected = 대표 1건(옛 기록 호환) */
  event_quote?: { candidates?: any[]; selected?: any; selectedList?: any[] } | null;
  brand_profile?: {
    siteTitle?: string; excerpt?: string; eventTextFull?: string | null; imageCandidates?: string[]; selectedImageUrl?: string | null;
    crawledAt?: string; brand?: { primaryColor?: string | null; colorSource?: string | null }; subPageUrl?: string | null; extraNotes?: string | null;
    /** ★ v3 홈 첫 화면 캡처(375×900 공개 사본 · 제안 메일 대조 왼쪽) */
    homeCaptureUrl?: string | null;
    media?: { stats?: Record<string, number>; gallery?: any[]; products?: any[] } | null;
    /** ★ 0905(3) 검토에서 고른 재료(서버 저장값 · 없으면 전량) */
    mediaSelection?: { products?: string[]; gallery?: string[] } | null;

    /** ★ 2026-09-06 S1 재료 v2(서버가 센 값 · 화면은 표시만) */
    materials?: { v?: number; source?: 'static' | 'render' | 'mixed'; counts?: Record<string, number>; proof?: { reviewTotal?: number | null; rating?: number | null; rankLabel?: string | null }; eventCards?: any[] } | null;
  } | null;
  fail_stage?: string | null;
  fail_reason?: string | null;
  fail_detail?: string | null;
  mail_result?: string | null;
  mail_sent_at?: string | null;
  mail_confirmed_at?: string | null;
  forwarded_at?: string | null;
  preview_code?: string | null;
  purged_at?: string | null;
  created_at?: string;
  assets?: OutreachAsset[];
  sendLock?: { locked: boolean; reasons: string[] } | null;
  /** ★ 0905(3) 품질 경고(서버가 센 것 · 잠금이 아니다 · 발송을 막지 않는다) */
  quality?: { warnings: Array<{ code: string; value?: number }> } | null;
  /** ★ 2026-09-06 S4 열람(서버 집계 · 문장은 서버 완성 · 화면은 표시만) */
  views?: {
    dm?: { viewers: number; opens: number; lastAt: string | null; afterForward: number } | null;
    preview?: { total: number; human: number; bot: number; afterForward: number; lastAt: string | null } | null;
    unread3d?: boolean; recontact?: boolean; sentences?: string[];
  } | null;
  /** ★ S4 같은 주소(중복 키)로 등록된 다른 건 수(미파기) */
  dup_count?: number;
}

const ACTIVE_STAGES = ['queued', 'crawling', 'analyzing', 'producing_copy', 'producing_image', 'producing_dm', 'producing_email'];
const STAGE_LABEL: Record<string, string> = {
  queued: '대기 중',
  crawling: '홈페이지 읽는 중',
  analyzing: '행사 정보 정리 중',
  awaiting_confirm: '확인 대기',
  producing_copy: '문안 만드는 중',
  producing_image: '이미지·재료 만드는 중',
  producing_dm: '모바일 DM 만드는 중',
  producing_email: '제안 메일 조립 중',
  ready: '검토 대기',
  sent: '발송됨',
  failed: '실패',
};
const SEND_LOCK_LABEL: Record<string, string> = {
  SENDER_NOT_CONFIGURED: '영업 발신 계정이 설정되지 않았습니다',
  UNSUB_NOTICE_MISSING: '수신거부 안내 문구가 확정되지 않았습니다',
  NO_EMAIL: '조립된 메일이 없습니다',
  PLACEHOLDER_REMAINS: '직접 채울 자리(혜택 안내)가 남아 있습니다',
  UNSUB_NOT_APPLIED: '수신거부 문구가 반영되기 전의 메일입니다',
  // ★ 2026-09-06 S2 재료 게이트(상품·배너·행사 중 둘 이상 미달) — 산출물을 확인한 뒤 해제할 수 있다
  MATERIAL_THIN: '홈페이지에서 읽은 재료가 얇습니다(상품·배너·행사 중 둘 이상 부족). 산출물을 확인한 뒤 해제할 수 있습니다',
};
// ★ 0905(3) 품질 경고 라벨 — 서버 코드 → 문구(숫자는 서버 value만 쓴다)
const QUALITY_LABEL: Record<string, (v?: number) => string> = {
  NO_PRODUCTS: () => '상품을 하나도 실측하지 못해 상품 묶음이 없습니다',
  FEW_PRODUCTS: (v) => `실측 통과 상품이 ${v ?? 0}개라 상품 묶음이 한 개 이하입니다`,
  FEW_GALLERY: (v) => `선명한 사진이 ${v ?? 0}장이라 갤러리가 비었습니다`,
  CTA_ALL_HOME: () => '버튼이 전부 홈페이지 첫 화면으로만 갑니다(코너 링크를 못 찾았습니다)',
  NO_LEGAL: () => '홈페이지에서 사업자 표기·고객센터 번호를 찾지 못했습니다',
  FEW_SECTIONS: (v) => `모바일 DM 구성이 ${v ?? 0}섹션으로 짧습니다`,
  NO_BRAND_EMAIL: () => '이메일 시안 블록이 비어 있습니다',
  NO_LOOK: () => '구도·배경면이 하나도 실리지 않았습니다',
  // ★ 2026-09-06 S2
  HERO_FALLBACK: () => '메인 헤드라인을 만들지 못해 업체명으로 채웠습니다(행사 내용을 직접 붙여넣고 다시 만들면 나아집니다)',
  // ★ 2026-09-06 S3 발행 DM 캡처 채점(경고 · 발송을 막지 않습니다)
  VISION_NO_HERO_IMAGE: () => '캡처 확인: 첫 화면에 폭 100% 이미지가 보이지 않습니다',
  VISION_NO_PRICE_PAIR: () => '캡처 확인: 상품 카드에 정가·판매가 쌍이 보이지 않습니다',
  VISION_NO_CTA_BAR: () => '캡처 확인: 브랜드 색 풀폭 버튼이 보이지 않습니다',
  VISION_DUP_IMAGE: () => '캡처 확인: 같은 이미지가 두 번 이상 나옵니다',
  VISION_TEXT_UNREADABLE: () => '캡처 확인: 이미지 위 글자가 배경과 겹쳐 읽기 어렵습니다',
  VISION_GRAY_BOX: () => '캡처 확인: 회색 빈 상자(이미지 자리 비움)가 있습니다',
  VISION_NUMBER_LEAK: () => '캡처 확인: 생성 이미지 안에 숫자·퍼센트·원 표기가 보입니다',
  VISION_FEW_SECTIONS: () => '캡처 확인: 구획이 9개 미만이거나 13개를 넘습니다',
  // ★ 2026-09-06 v3 채점 12항목 · 브랜드 색 폴백 · 블록 최소 요건(전부 경고 · 발송을 막지 않습니다)
  VISION_UNCAPTIONED_IMAGE: () => '캡처 확인: 설명 글자가 없는 이미지 블록이 있습니다',
  VISION_NO_FIRST_HEADLINE: () => '캡처 확인: 첫 화면에 읽을 수 있는 헤드라인이 없습니다',
  VISION_COLOR_MIXED: () => '캡처 확인: 버튼·밴드·태그의 강조색이 한 계열이 아닙니다',
  VISION_TEXT_CLIPPED: () => '캡처 확인: 잘리거나 겹쳐 끝이 보이지 않는 글자가 있습니다',
  BRAND_COLOR_FALLBACK: () => '홈페이지에서 브랜드 색을 읽지 못해 무채색 주색으로 만들었습니다',
  BLOCK_MINIMA_SHORT: (v) => `블록 ${v ?? 0}곳의 글자·상품 수가 최소 요건에 못 미칩니다(경고만)`,
};
/** ★ v3 사람 수정 사유 5값(서버 화이트리스트와 같은 값 · 학습 원장) */
const EDIT_REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'no_text', label: '설명 글자가 없음' }, { value: 'duplicate', label: '중복' }, { value: 'blurry', label: '흐림·품질' }, { value: 'wrong', label: '내용 틀림' }, { value: 'tone', label: '톤이 다름' },
];
const SECTION_TYPE_LABEL: Record<string, string> = {
  header: '머리말', hero: '메인', text_card: '텍스트 카드', product_carousel: '상품 묶음', gallery: '갤러리', coupon: '쿠폰',
  countdown: '카운트다운', cta: '버튼', footer: '꼬리말', promo_code: '프로모션 코드', reviews: '후기', store_info: '매장 정보',
};
/** 서버(sales-outreach-review.sectionKeysOf)와 같은 규칙 — 같은 type 안 1-based 순번 */
function sectionKeysOf(list: any[]): string[] {
  const ord: Record<string, number> = {};
  return list.map((sec) => { const t = String(sec?.type || ''); ord[t] = (ord[t] || 0) + 1; return `${t}#${ord[t]}`; });
}
function sectionSnippet(sec: any): string {
  const pr = sec?.props || {};
  const t = pr.headline || pr.title || pr.tag || pr.discount_label || pr.urgency_text || (Array.isArray(pr.buttons) ? pr.buttons.map((b: any) => b?.label).filter(Boolean).join(' · ') : '') || '';
  return String(t).slice(0, 28);
}
const GROUP_CHIPS: Array<{ key: string; label: string }> = [
  { key: '', label: '전체' }, { key: 'active', label: '진행 중' }, { key: 'awaiting_confirm', label: '확인 대기' },
  { key: 'ready', label: '검토 대기' }, { key: 'sent', label: '발송됨' }, { key: 'failed', label: '실패' },
];
/** ★ 2026-09-06 S4 열람 보조 칩(상태 칩과 겹쳐 쓴다) */
const VIEW_CHIPS: Array<{ key: string; label: string }> = [
  { key: '', label: '열람 전체' }, { key: 'viewed', label: '열람 있음' }, { key: 'unread3d', label: '3일 무열람' },
];
const LIST_PAGE = 50;
/** 목록 "같은 주소 N건 보기" 검색어 = 호스트(www 제거) */
function hostOfUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('token');
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

function latestAssetOf(job: OutreachJob | null, kind: string): any | null {
  if (!job?.assets) return null;
  const list = job.assets.filter((a) => a.kind === kind);
  return list.length ? list[list.length - 1].payload : null;
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).slice(0, 16).replace('T', ' ');
}

export default function SalesOutreachModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [job, setJob] = useState<OutreachJob | null>(null);
  // 자사 수신함 목록(OUTREACH_MAIL_TO) · 검수 허용 도메인 · 발송 ENV 상태 — 확인 모달·잠금 문구가 사실대로 적는다
  const [mailTo, setMailTo] = useState<string[]>([]);
  const [testDomains, setTestDomains] = useState<string[]>([]);
  const [lastSummary, setLastSummary] = useState<OutreachJob | null>(null);
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // 입력 단계
  const [companyName, setCompanyName] = useState('');
  const [industryCode, setIndustryCode] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [dupState, setDupState] = useState<{ existingJobId: string; existingStage?: string } | null>(null);

  // 확인 단계 선택 — ★ v3 행사는 다중 선택(≤3 · 누른 순서 = DM 등장 순서) · 'manual' 은 직접 붙여넣기 · 'none' 은 선택 0
  const [eventChoice, setEventChoice] = useState<string>('none'); // 'none' | 'manual'
  const [eventPicks, setEventPicks] = useState<number[]>([]);
  const [manualEventText, setManualEventText] = useState('');
  const [imageChoice, setImageChoice] = useState<string>('');     // '' = 이미지 없이
  const [materialOpen, setMaterialOpen] = useState(false);
  const [recrawlUrl, setRecrawlUrl] = useState('');

  // 검토 단계
  const [reviewTab, setReviewTab] = useState<'email' | 'copy' | 'dm' | 'image' | 'materials'>('email');
  // ★ 0905(3) 검수 축 — 재료 재선택(우리 사본 URL 목록 · 순서 = 배열) · 블록 숨기기(type#n 키)
  const [matProducts, setMatProducts] = useState<string[]>([]);
  const [matGallery, setMatGallery] = useState<string[]>([]);
  const matDirtyRef = useRef(false);
  const [hiddenDm, setHiddenDm] = useState<string[]>([]);
  const [hiddenEmail, setHiddenEmail] = useState<string[]>([]);
  const hiddenDirtyRef = useRef<{ dm: boolean; email: boolean }>({ dm: false, email: false });
  const [copyDraft, setCopyDraft] = useState('');
  const [copyEditing, setCopyEditingState] = useState(false);
  const editingRef = useRef(false);
  const setCopyEditing = (v: boolean) => { editingRef.current = v; setCopyEditingState(v); };
  const [subjectDraft, setSubjectDraft] = useState('');
  const [subjectEditing, setSubjectEditing] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<600 | 375>(600);
  const [testTo, setTestTo] = useState('');
  // ★ v3 회신 문장 편집(60자 · 저장 = 메일 재조립) · DM 탭 폭 토글 · 사람 수정 사유(학습 원장 · 기본 = 사유 안 남김)
  const [replyDraft, setReplyDraft] = useState('');
  const [replyEditing, setReplyEditing] = useState(false);
  const [dmWidth, setDmWidth] = useState<375 | 600>(375);
  const [editReason, setEditReason] = useState('');

  // 대량 업로드 · 진행 목록(0824 Harold: 일괄 등록 + 진행률 + 이력 + 건별 산출물 링크·메일 미리보기)
  const [listMode, setListMode] = useState(false);
  const [jobsList, setJobsList] = useState<OutreachJob[]>([]);
  const [listQ, setListQ] = useState('');
  const [listGroup, setListGroup] = useState('');
  const [listHasMore, setListHasMore] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  // ★ 2026-09-06 S4 열람 칩 · [정리] 다중선택(sent 제외)
  const [listView, setListView] = useState('');
  const [cleanupMode, setCleanupMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{ accepted: number; rejected: Array<{ label: string; reason: string }>; overflow?: number } | null>(null);

  // 요청 순번(늦은 응답 폐기) · 언마운트 abort · 목록 활성 판정 ref
  const reqSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const listActiveRef = useRef(false);
  const listFilterRef = useRef({ q: '', group: '', view: '' });
  listFilterRef.current = { q: listQ, group: listGroup, view: listView };

  // ESC 닫기(캡처 단계 · 부모로 전파 차단) — 확인 모달이 떠 있으면 그쪽이 우선
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmState) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, confirmState]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const loadJob = useCallback(async (id: string) => {
    const seq = ++reqSeq.current;
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    try {
      const r = await authFetch(`/api/sales-outreach/jobs/${id}`, { signal: ctrl.signal });
      const d = await r.json();
      if (seq !== reqSeq.current) return; // 늦은 응답 폐기
      if (r.ok) {
        setJob(d);
        const copyAsset = latestAssetOf(d, 'copy');
        if (copyAsset?.body && !editingRef.current) setCopyDraft(String(copyAsset.body));
        const emailAsset = latestAssetOf(d, 'email_html');
        if (emailAsset?.subject) setSubjectDraft((cur) => (cur === '' || !subjectEditing ? String(emailAsset.subject) : cur));
        if (!recrawlUrl && d?.homepage_url) setRecrawlUrl(String(d.homepage_url));
        const media = d?.brand_profile?.media || null;
        if (media && !matDirtyRef.current) {
          const sel = d?.brand_profile?.mediaSelection || null;
          const allP = (Array.isArray(media.products) ? media.products : []).map((x: any) => String(x.image_url));
          const allG = (Array.isArray(media.gallery) ? media.gallery : []).map((x: any) => String(x.url));
          setMatProducts(Array.isArray(sel?.products) ? sel.products.filter((u: string) => allP.includes(u)) : allP);
          setMatGallery(Array.isArray(sel?.gallery) ? sel.gallery.filter((u: string) => allG.includes(u)) : allG);
        }
        const ov = d?.stage_results?.section_overrides || {};
        const dmA = latestAssetOf(d, 'dm');
        const emA = latestAssetOf(d, 'email_html');
        const dmKeys = sectionKeysOf(Array.isArray(dmA?.sectionsBase) ? dmA.sectionsBase : Array.isArray(dmA?.sections) ? dmA.sections : []);
        const emKeys = sectionKeysOf(Array.isArray(emA?.brandSectionsBase) ? emA.brandSectionsBase : Array.isArray(emA?.brandSections) ? emA.brandSections : []);
        // 저장된 키 중 현재 산출물에 있는 것만 시딩한다(재생성으로 순번이 사라진 키가 남으면 서버가 UNKNOWN_KEY로 전량 거절한다)
        if (!hiddenDirtyRef.current.dm) setHiddenDm((Array.isArray(ov?.dm?.hidden) ? ov.dm.hidden : []).filter((k: string) => dmKeys.includes(k)));
        if (!hiddenDirtyRef.current.email) setHiddenEmail((Array.isArray(ov?.email?.hidden) ? ov.email.hidden : []).filter((k: string) => emKeys.includes(k)));
      } else if (d?.code === 'DB_MIGRATION_PENDING') {
        setNotice(d.error || '준비 중입니다.');
      }
    } catch { /* abort 또는 네트워크 — 다음 폴링에서 회복 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 업종 목록 + 최근 실행 이어받기 + 접근 정보(mount 1회)
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch('/api/admin/industry-codes');
        const d = await r.json();
        if (Array.isArray(d?.industries)) setIndustries(d.industries);
      } catch { /* 목록 실패 = 셀렉트 비활성(폴백 축이라 치명 아님) */ }
      try {
        const r = await authFetch('/api/sales-outreach/access');
        const d = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(d?.mailTo)) setMailTo(d.mailTo.map((x: unknown) => String(x)));
        if (r.ok && Array.isArray(d?.testDomains)) setTestDomains(d.testDomains.map((x: unknown) => String(x)));
      } catch { /* 문구 폴백 */ }
      try {
        const r = await authFetch('/api/sales-outreach/jobs/latest');
        const d = await r.json();
        if (r.ok && d?.job) {
          setLastSummary(d.job);
          // 진행 중이거나 확인·검토 대기 건은 그대로 이어받는다(화면을 닫아도 잡은 계속 돈다)
          if (d.job.stage && d.job.stage !== 'sent') await loadJob(d.job.id);
        }
      } catch { /* 최근 건 없음 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 진행 중 잡 2초 폴링 — 실제 상태만 그린다(연출 타이머 0)
  useEffect(() => {
    if (!job?.id || !ACTIVE_STAGES.includes(job.stage)) return;
    const t = setInterval(() => { loadJob(job.id); }, 2000);
    return () => clearInterval(t);
  }, [job?.id, job?.stage, loadJob]);

  // 목록 — 첫 페이지 로드(필터 반영) / 더 보기(커서) / 폴링은 첫 페이지만 id upsert
  const loadJobsList = useCallback(async (opts?: { append?: boolean; silent?: boolean; q?: string }) => {
    const { group, view } = listFilterRef.current;
    const q = opts?.q !== undefined ? opts.q : listFilterRef.current.q;
    if (!opts?.silent) setListBusy(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (group) params.set('group', group);
      if (view) params.set('view', view);
      params.set('limit', String(LIST_PAGE));
      if (opts?.append) {
        const last = jobsList[jobsList.length - 1];
        if (last?.created_at) params.set('before', String(last.created_at));
      }
      const r = await authFetch(`/api/sales-outreach/jobs?${params.toString()}`);
      const d = await r.json();
      if (!r.ok || !Array.isArray(d?.jobs)) return;
      const rows: OutreachJob[] = d.jobs;
      if (opts?.append) {
        setJobsList((cur) => {
          const ids = new Set(cur.map((j) => j.id));
          return [...cur, ...rows.filter((j) => !ids.has(j.id))];
        });
        setListHasMore(rows.length >= LIST_PAGE);
      } else if (opts?.silent) {
        // 앞부분만 갱신 · 뒤쪽 누적분 유지
        setJobsList((cur) => {
          const map = new Map(rows.map((j) => [j.id, j] as const));
          const merged = cur.map((j) => map.get(j.id) || j);
          const known = new Set(merged.map((j) => j.id));
          return [...rows.filter((j) => !known.has(j.id)), ...merged];
        });
      } else {
        setJobsList(rows);
        setListHasMore(rows.length >= LIST_PAGE);
      }
    } catch { /* 다음 폴링에서 회복 */ } finally {
      if (!opts?.silent) setListBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsList]);

  useEffect(() => {
    listActiveRef.current = jobsList.some((j) => ACTIVE_STAGES.includes(j.stage));
  }, [jobsList]);

  // 목록 폴링(5초) — 진행 중 건이 있을 때만 · 첫 페이지 upsert
  useEffect(() => {
    if (!listMode) return;
    loadJobsList();
    const t = setInterval(() => { if (listActiveRef.current) loadJobsList({ silent: true }); }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listMode, listGroup, listView]);

  const downloadTemplate = async () => {
    try {
      const r = await authFetch('/api/sales-outreach/template.xlsx');
      if (!r.ok) { setNotice('양식 다운로드에 실패했습니다.'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AI영업_업체목록_양식.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch { setNotice('양식 다운로드에 실패했습니다.'); }
  };

  const handleBulkFile = async (file: File | null) => {
    if (!file) return;
    setBulkBusy(true);
    setNotice(null);
    setBulkSummary(null);
    try {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/sales-outreach/jobs/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice(d?.error || '일괄 등록에 실패했습니다.');
        if (Array.isArray(d?.rejected) && d.rejected.length) {
          setBulkSummary({ accepted: 0, rejected: d.rejected.map((x: any) => ({ label: x.label || `${x.line}행`, reason: x.reason })), overflow: Number(d.rejectedOverflow) || 0 });
        }
        return;
      }
      setBulkSummary({ accepted: d.accepted || 0, rejected: Array.isArray(d.rejected) ? d.rejected : [], overflow: Number(d.rejectedOverflow) || 0 });
      toast.success(`${d.accepted || 0}곳을 등록했습니다. 순서대로 자동 처리됩니다.`);
      setListMode(true);
    } catch {
      setNotice('업로드 요청에 실패했습니다. 네트워크를 확인해주세요.');
    } finally {
      setBulkBusy(false);
    }
  };

  /** POST 공통 — 성공 true · 실패 배너. 응답 본문이 필요하면 raw 사용. */
  const callAction = async (path: string, body?: any): Promise<{ ok: boolean; data: any }> => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await authFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice(d?.error || '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
        return { ok: false, data: d };
      }
      return { ok: true, data: d };
    } catch {
      setNotice('요청에 실패했습니다. 네트워크를 확인해주세요.');
      return { ok: false, data: null };
    } finally {
      setBusy(false);
    }
  };

  const resetInputState = () => {
    setEventChoice('none');
    setEventPicks([]);
    setReplyEditing(false);
    setEditReason('');
    setManualEventText('');
    setImageChoice('');
    setMaterialOpen(false);
    setCopyEditing(false);
    setSubjectEditing(false);
    setSubjectDraft('');
    setRecrawlUrl('');
    setTestTo('');
    setDupState(null);
    matDirtyRef.current = false; setMatProducts([]); setMatGallery([]);
    hiddenDirtyRef.current = { dm: false, email: false }; setHiddenDm([]); setHiddenEmail([]);
    setReviewTab('email');
  };

  const startAnalysis = async (force = false) => {
    setBusy(true);
    setNotice(null);
    setDupState(null);
    try {
      const r = await authFetch('/api/sales-outreach/jobs', {
        method: 'POST',
        body: JSON.stringify({ companyName, industryCategory: industryCode || null, homepageUrl, extraNotes: extraNotes.trim() || null, force }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && d?.reason === 'DUPLICATE' && d?.existingJobId) {
          setDupState({ existingJobId: String(d.existingJobId), existingStage: d.existingStage ? String(d.existingStage) : undefined });
          setNotice('이미 등록된 업체입니다. 기존 건을 열거나 그래도 새로 만들 수 있습니다.');
          return;
        }
        setNotice(d?.error || '등록에 실패했습니다.');
        return;
      }
      resetInputState();
      await loadJob(d.jobId);
    } catch {
      setNotice('요청에 실패했습니다. 네트워크를 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelection = async () => {
    if (!job) return;
    const body: any = { imageUrl: imageChoice || null, industryCategory: industryCode || undefined };
    // ★ v3 다중 선택 배열(누른 순서) · 직접 붙여넣기 우선 · 선택 0 = 행사 없음
    if (eventChoice === 'manual') body.manualEventText = manualEventText;
    else if (eventPicks.length) { body.eventIndexes = eventPicks; body.eventIndex = eventPicks[0]; }
    else body.eventIndex = null;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/confirm`, body);
    if (res.ok) {
      const warnings: string[] = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
      if (warnings.length) setNotice(warnings.join(' ')); else toast.success('제작을 시작했습니다. 창을 닫아도 계속 진행됩니다.');
      await loadJob(job.id);
    }
  };

  const recrawl = async () => {
    if (!job) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/recrawl`, { homepageUrl: recrawlUrl.trim() || null });
    if (res.ok) { toast.success('홈페이지를 다시 읽습니다.'); setEventChoice('none'); setEventPicks([]); setImageChoice(''); await loadJob(job.id); }
  };
  /** ★ v3 행사 체크(누른 순서 유지 · 최대 3) */
  const toggleEventPick = (i: number) => {
    setEventChoice('none');
    setEventPicks((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : cur.length >= 3 ? cur : [...cur, i]));
  };
  /** ★ v3 회신 문장 저장(0~60자 · 비우면 기본 문장 · 메일 재조립 AI 0) */
  const saveReply = async () => {
    if (!job) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/reply-line`, { text: replyDraft.trim() });
    if (res.ok) { setReplyEditing(false); toast.success('회신 문장을 반영해 메일을 다시 조립합니다.'); await loadJob(job.id); }
  };
  /** ★ v3 레시피 승격(학습 원장 · 원문 0 · 같은 건 1회) */
  const promoteRecipe = () => {
    if (!job) return;
    setConfirmState({
      mode: 'warning',
      title: '이 건의 제작 레시피를 학습 저장소에 올립니다',
      description: '재료 수 · 블록 순서 · 블록별 출처 · 판정 · 사람 수정 통계만 올라갑니다(문구·이미지 원문은 올라가지 않습니다). 같은 건은 한 번만 올릴 수 있습니다.',
      confirmLabel: '승격',
      onConfirm: async () => {
        const r = await callAction(`/api/sales-outreach/jobs/${job.id}/promote-recipe`);
        if (r.ok) toast.success('레시피를 올렸습니다.');
      },
    });
  };

  const sendMail = () => {
    if (!job) return;
    setConfirmState({
      mode: 'warning',
      title: '자사 수신함으로 발송합니다',
      description: mailTo.length
        ? `조립된 제안 메일을 회사 수신함 ${mailTo.length}명(${mailTo.join(', ')})에게 보냅니다. 수신함에서 확인 후 업체에 전달하는 흐름입니다.`
        : '조립된 제안 메일을 회사 수신함으로 1통 발송합니다. 수신함에서 확인 후 업체에 전달하는 흐름입니다.',
      confirmLabel: '발송',
      onConfirm: async () => {
        setBusy(true);
        setNotice(null);
        try {
          const r = await authFetch(`/api/sales-outreach/jobs/${job.id}/send`, { method: 'POST' });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            setNotice(d?.error || '발송에 실패했습니다.');
          } else if (d.outcome === 'sent') {
            toast.success(`발송되었습니다: ${d.detail || d.to || '회사 수신함'}. 수신함 도착을 확인해주세요.`);
          } else if (d.outcome === 'rejected') {
            setNotice('수신 주소가 거부되었습니다. 수신함 주소 설정을 확인해주세요.');
          } else {
            setNotice(d.detail || '발송 결과를 확인하지 못했습니다. 수신함을 직접 확인해주세요.');
          }
          await loadJob(job.id);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const sendTest = async () => {
    if (!job) return;
    const to = testTo.trim();
    if (!to) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/test-send`, { to });
    if (res.ok) {
      if (res.data?.outcome === 'sent') toast.success(`검수 메일을 보냈습니다: ${res.data.to}`);
      else if (res.data?.outcome === 'rejected') setNotice('검수 메일 수신 주소가 거부되었습니다.');
      else setNotice(res.data?.detail || '검수 메일 발송 결과를 확인하지 못했습니다.');
      await loadJob(job.id);
    }
  };

  const saveCopy = async () => {
    if (!job) return;
    setCopyEditing(false);
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/copy`, { body: copyDraft });
    if (res.ok) {
      toast.success('문안을 저장했습니다. 메일을 다시 조립하고 있습니다.');
      await loadJob(job.id);
    } else {
      setCopyEditing(true);
    }
  };

  const saveSubject = async () => {
    if (!job) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/subject`, { subject: subjectDraft });
    if (res.ok) { setSubjectEditing(false); toast.success('제목을 저장했습니다.'); await loadJob(job.id); }
  };

  const rebuildEmail = async () => {
    if (!job) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/rebuild-email`);
    if (res.ok) { toast.success('메일을 다시 조립하고 있습니다.'); await loadJob(job.id); }
  };

  // ★ 0905(3) C4-2 고른 재료로 다시 만들기(확인 모달 1회 · 이미지 단계 없이 DM·시안만 · 제목·서두 보존)
  const applyMaterials = () => {
    if (!job) return;
    setConfirmState({
      mode: 'warning',
      title: '고른 재료로 다시 만듭니다',
      description: `상품 ${matProducts.length}개 · 사진 ${matGallery.length}장으로 모바일 DM과 이메일 시안을 다시 만들고 메일을 재조립합니다. 제목·서두·문안은 그대로 둡니다. 기존 모바일 DM 링크는 새 메일이 조립된 뒤 닫힙니다.`,
      confirmLabel: '다시 만들기',
      onConfirm: async () => {
        const res = await callAction(`/api/sales-outreach/jobs/${job.id}/materials`, { products: matProducts, gallery: matGallery, reason: editReason || undefined });
        if (res.ok) { matDirtyRef.current = false; toast.success('고른 재료로 다시 만들고 있습니다. 창을 닫아도 계속 진행됩니다.'); await loadJob(job.id); }
      },
    });
  };
  // ★ 0905(3) C4-3 블록 숨기기 반영(DM = 재발행 · 이메일 = 재조립 · AI 호출 0 · 다음 재생성 뒤에도 같은 순번에 다시 적용)
  const applyHidden = (kind: 'dm' | 'email') => {
    if (!job) return;
    const hidden = kind === 'dm' ? hiddenDm : hiddenEmail;
    const run = async () => {
      const res = await callAction(`/api/sales-outreach/jobs/${job.id}/sections`, { kind, hidden, reason: editReason || undefined });
      if (res.ok) { hiddenDirtyRef.current[kind] = false; toast.success(kind === 'dm' ? '모바일 DM을 다시 발행하고 있습니다.' : '이메일 시안을 다시 조립하고 있습니다.'); await loadJob(job.id); }
    };
    if (kind === 'dm') {
      setConfirmState({
        mode: 'warning',
        title: '숨김을 반영해 모바일 DM을 다시 발행합니다',
        description: `블록 ${hidden.length}개를 뺀 모바일 DM이 새로 발행되고 메일이 다시 조립됩니다. 기존 모바일 DM 링크는 새 메일이 조립된 뒤 닫힙니다.`,
        confirmLabel: '반영',
        onConfirm: run,
      });
      return;
    }
    run();
  };
  const toggleHidden = (kind: 'dm' | 'email', key: string) => {
    hiddenDirtyRef.current[kind] = true;
    const set = kind === 'dm' ? setHiddenDm : setHiddenEmail;
    set((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };
  const moveMat = (kind: 'products' | 'gallery', url: string, dir: -1 | 1) => {
    matDirtyRef.current = true;
    const set = kind === 'products' ? setMatProducts : setMatGallery;
    set((cur) => {
      const i = cur.indexOf(url); const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = cur.slice(); [next[i], next[j]] = [next[j], next[i]]; return next;
    });
  };
  const toggleMat = (kind: 'products' | 'gallery', url: string) => {
    matDirtyRef.current = true;
    const set = kind === 'products' ? setMatProducts : setMatGallery;
    set((cur) => (cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url]));
  };

  const regenerate = (kind: 'copy' | 'image' | 'dm' | 'email') => {
    if (!job) return;
    const run = async () => {
      const res = await callAction(`/api/sales-outreach/jobs/${job.id}/regenerate`, { kind });
      if (res.ok) { toast.success('다시 만들고 있습니다. 창을 닫아도 계속 진행됩니다.'); await loadJob(job.id); }
    };
    if (kind === 'dm' || kind === 'image') {
      setConfirmState({
        mode: 'warning',
        title: kind === 'dm' ? '모바일 DM을 다시 만듭니다' : '대표 이미지를 다시 만듭니다',
        description: kind === 'dm'
          ? '새 모바일 DM이 발행되고 메일이 다시 조립됩니다. 기존 모바일 DM 링크는 새 메일이 조립된 뒤 닫힙니다.'
          : '새 이미지로 모바일 DM과 메일이 다시 만들어집니다. 기존 모바일 DM 링크는 새 메일이 조립된 뒤 닫힙니다.',
        confirmLabel: '다시 만들기',
        onConfirm: run,
      });
      return;
    }
    run();
  };

  const dismissJob = async () => {
    if (!job) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/dismiss`);
    if (res.ok) { toast.success('목록에서 숨겼습니다(기록은 남습니다).'); await loadJob(job.id); }
  };

  // ★ 2026-09-06 S4 삭제 — 커스텀 모달 2클릭(native dialog 0) · 서버가 진행 중·발송 중을 거절(409) · 파기 숫자는 서버 응답
  const deleteJob = () => {
    if (!job) return;
    const sent = job.stage === 'sent';
    setConfirmState({
      mode: 'danger',
      title: `${job.company_name} 건을 삭제합니다`,
      description: (sent ? '보낸 메일은 회수되지 않습니다. ' : '') + '공개 산출물 링크와 모바일 DM 링크가 즉시 닫히고 이미지 사본이 지워집니다. 목록에서 사라지며 기록만 남습니다.',
      confirmLabel: '링크 닫고 삭제',
      onConfirm: async () => {
        const r = await callAction(`/api/sales-outreach/jobs/${job.id}/delete`);
        if (r.ok) {
          toast.success(`삭제했습니다 · 모바일 DM ${Number(r.data?.dmsStopped) || 0}건 중지 · 파일 ${Number(r.data?.filesDeleted) || 0}개 삭제`);
          setJob(null); setLastSummary(null); resetInputState(); setListMode(true);
        }
      },
    });
  };
  const toggleSelected = (id: string) => setSelectedIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const deleteSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setConfirmState({
      mode: 'danger',
      title: `선택한 ${ids.length}건을 삭제합니다`,
      description: '각 건의 공개 산출물 링크와 모바일 DM 링크가 즉시 닫히고 이미지 사본이 지워집니다. 진행 중인 건은 서버가 건너뜁니다. 발송된 건은 여기서 지울 수 없습니다.',
      confirmLabel: '링크 닫고 삭제',
      onConfirm: async () => {
        const r = await callAction('/api/sales-outreach/jobs/delete-bulk', { ids });
        if (r.ok) {
          const deleted = Array.isArray(r.data?.deleted) ? r.data.deleted.length : 0;
          const skipped: Array<{ id: string; reason: string }> = Array.isArray(r.data?.skipped) ? r.data.skipped : [];
          toast.success(`${deleted}건 삭제${skipped.length ? ` · ${skipped.length}건 제외` : ''}`);
          if (skipped.length) setNotice(`제외된 건: ${skipped.slice(0, 3).map((x) => x.reason).join(' / ')}${skipped.length > 3 ? ` 외 ${skipped.length - 3}건` : ''}`);
          setSelectedIds(new Set()); setCleanupMode(false);
          await loadJobsList();
        }
      },
    });
  };

  // ★ 2026-09-06 S2 재료 부족 잠금 해제 — 커스텀 모달 2클릭(native dialog 0) · 서버가 ready 에서만 받는다
  const overrideMaterialGate = () => {
    if (!job) return;
    const m: any = sr.material || {};
    const c: any = m.counts || {};
    setConfirmState({
      mode: 'warning',
      title: '재료 부족 잠금을 해제합니다',
      description: `홈페이지에서 읽은 재료가 상품 ${Number(c.products) || 0}개 · 배너 ${Number(c.banners) || 0}장 · 행사 ${Number(c.events) || 0}건입니다. 산출물을 눈으로 확인했을 때만 해제하세요. 다시 읽기를 하면 다시 잠깁니다.`,
      confirmLabel: '확인했으니 해제',
      onConfirm: async () => {
        const res = await callAction(`/api/sales-outreach/jobs/${job.id}/material-override`);
        if (res.ok) { toast.success('재료 부족 잠금을 해제했습니다.'); await loadJob(job.id); }
      },
    });
  };

  const retry = async () => {
    if (!job) return;
    const res = await callAction(`/api/sales-outreach/jobs/${job.id}/retry`);
    if (res.ok) { toast.success('다시 시도합니다.'); await loadJob(job.id); }
  };

  // ── 단계 판정 ──
  const stage = job?.stage || '';
  const step: 1 | 2 | 3 | 4 = !job ? 1
    : ['queued', 'crawling', 'analyzing'].includes(stage) ? 2
    : stage === 'awaiting_confirm' ? 3
    : 4;
  const failed = stage === 'failed';
  const producing = stage.startsWith('producing_');
  const sr: Record<string, any> = job?.stage_results || {};

  const candidates: any[] = Array.isArray(job?.event_quote?.candidates) ? job!.event_quote!.candidates! : [];
  const imageCandidates: string[] = Array.isArray(job?.brand_profile?.imageCandidates) ? job!.brand_profile!.imageCandidates! : [];
  const crawlUnavailable = sr.crawling === 'unavailable';
  const analyzeUnavailable = sr.analyzing === 'unavailable';
  // ★ 2026-09-06 S1 재료 v2(brand_profile.materials · 서버가 센 값만 · 프론트가 배열 길이를 다시 세지 않는다)
  const materials: any = job?.brand_profile?.materials || null;
  const readModeLabel: string | null = materials
    ? (materials.source === 'render' ? '화면을 그려서 읽음' : materials.source === 'mixed' ? '바로 읽기 + 화면을 그려서 읽음' : '바로 읽음')
    : null;
  const renderFailed = sr.rendering === 'unavailable' || sr.rendering === 'no_content';
  const legacyExcerptOnly = !!job?.brand_profile?.excerpt && !job?.brand_profile?.eventTextFull;

  const emailAsset = latestAssetOf(job, 'email_html');
  const dmAsset = latestAssetOf(job, 'dm');
  const imageAsset = latestAssetOf(job, 'studio_image');
  const copyAsset = latestAssetOf(job, 'copy');
  const previewUrl = job?.preview_code ? `${window.location.origin}/api/outreach/v/${job.preview_code}` : null;
  const sendLock = job?.sendLock || null;
  const placeholderCount = Number(emailAsset?.placeholderCount) || 0;
  const strippedTotal = (Number(dmAsset?.benefitStripped) || 0) + (Number(emailAsset?.brandStripped) || 0);
  const regenSeq: Record<string, number> = sr.regen_seq || {};
  const testSends: any[] = Array.isArray(sr.test_sends) ? sr.test_sends.slice(-3).reverse() : [];
  const chain = sr.chain && typeof sr.chain === 'object' ? sr.chain : null;
  const meta = sr.analyzing_meta && typeof sr.analyzing_meta === 'object' ? sr.analyzing_meta : null;
  const mediaStats = imageAsset?.media && typeof imageAsset.media === 'object' ? imageAsset.media : null;
  // ★ 0905(3) 검수 축 파생값 — 서버 값만
  const mediaAll = job?.brand_profile?.media || null;
  const mediaProducts: any[] = Array.isArray(mediaAll?.products) ? mediaAll!.products! : [];
  const mediaGallery: any[] = Array.isArray(mediaAll?.gallery) ? mediaAll!.gallery! : [];
  const hasMaterials = mediaProducts.length + mediaGallery.length > 0;
  // 재료 탭을 보던 중 재료가 없는 건으로 넘어가면 탭 버튼이 사라진다 → 기본 탭으로
  useEffect(() => { if (reviewTab === 'materials' && !hasMaterials) setReviewTab('email'); }, [reviewTab, hasMaterials]);
  const quality: Array<{ code: string; value?: number }> = Array.isArray(job?.quality?.warnings) ? job!.quality!.warnings : [];
  const qualityText = (w: { code: string; value?: number }): string => {
    if (w.code === 'NO_PRODUCTS' && mediaProducts.length > 0) return `상품을 모두 제외해 상품 묶음이 없습니다(실측 통과 ${mediaProducts.length}개 · 재료 탭에서 되돌릴 수 있습니다)`;
    if (w.code === 'FEW_PRODUCTS' && mediaProducts.length > Number(w.value)) return `상품을 ${mediaProducts.length - Number(w.value)}개 제외해 상품 묶음이 한 개 이하입니다`;
    if (w.code === 'FEW_GALLERY' && mediaGallery.length > Number(w.value)) return `사진을 제외해 갤러리가 비었습니다(실측 통과 ${mediaGallery.length}장)`;
    return (QUALITY_LABEL[w.code] || (() => w.code))(w.value);
  };
  const dmBaseSections: any[] = Array.isArray(dmAsset?.sectionsBase) ? dmAsset.sectionsBase : Array.isArray(dmAsset?.sections) ? dmAsset.sections : [];
  const emailBaseSections: any[] = Array.isArray(emailAsset?.brandSectionsBase) ? emailAsset.brandSectionsBase : Array.isArray(emailAsset?.brandSections) ? emailAsset.brandSections : [];
  const savedHidden = (kind: 'dm' | 'email'): string[] => (Array.isArray(sr.section_overrides?.[kind]?.hidden) ? sr.section_overrides[kind].hidden : []);
  const hiddenChanged = (kind: 'dm' | 'email') => {
    const a = (kind === 'dm' ? hiddenDm : hiddenEmail).slice().sort().join('|');
    const b = savedHidden(kind).slice().sort().join('|');
    return a !== b;
  };
  const materialsSeq = Number(regenSeq.materials) || 0;
  const materialsSaved = job?.brand_profile?.mediaSelection || null;
  const materialsChanged = (() => {
    const savedP = Array.isArray(materialsSaved?.products) ? materialsSaved!.products! : mediaProducts.map((x: any) => String(x.image_url));
    const savedG = Array.isArray(materialsSaved?.gallery) ? materialsSaved!.gallery! : mediaGallery.map((x: any) => String(x.url));
    return savedP.join('|') !== matProducts.join('|') || savedG.join('|') !== matGallery.join('|');
  })();
  /** 블록 숨김 목록(공용) — 저장된 섹션(override 적용 전)을 type#n으로 그린다 */
  const hiddenList = (kind: 'dm' | 'email', base: any[]) => {
    if (!base.length) return null;
    const keys = sectionKeysOf(base);
    const cur = kind === 'dm' ? hiddenDm : hiddenEmail;
    return (
      <div className="mt-3 bg-white/5 rounded-xl p-3 text-left">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-white/60">블록 숨기기 · 체크한 블록을 빼고 다시 {kind === 'dm' ? '발행' : '조립'}합니다(머리말·꼬리말 제외 · 3개 이상 남김){Number(regenSeq.sections) > 0 ? ` · ${Number(regenSeq.sections)}/10회` : ''}</span>
          {stage === 'ready' && (
            <span className="flex items-center gap-1.5">
              {/* ★ v3 사유(학습 원장 · 선택) */}
              <select value={editReason} onChange={(e) => setEditReason(e.target.value)} className="px-2 py-1.5 rounded-lg text-[11px] bg-white/10 text-white/80 border border-white/20 outline-none">
                <option value="">사유 안 남김</option>
                {EDIT_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button onClick={() => applyHidden(kind)} disabled={busy || !hiddenChanged(kind)} className={smallBtnDark}>
                <EyeOff className="w-3.5 h-3.5" /> 숨김 반영{cur.length ? ` (${cur.length})` : ''}
              </button>
            </span>
          )}
        </div>
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {base.map((sec, i) => {
            const key = keys[i];
            const protectedType = sec?.type === 'header' || sec?.type === 'footer';
            const on = cur.includes(key);
            return (
              <li key={key} className={`text-[11px] rounded-lg px-2 py-1 ${on ? 'bg-rose-500/20 text-rose-100' : 'text-white/75'}`}>
                <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                  <input type="checkbox" checked={on} disabled={protectedType || stage !== 'ready'} onChange={() => toggleHidden(kind, key)} className="accent-rose-400" />
                  <span className="shrink-0">{SECTION_TYPE_LABEL[String(sec?.type)] || String(sec?.type)} {key.split('#')[1]}</span>
                  <span className="truncate text-white/45">{sectionSnippet(sec)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const stepChip = (n: 1 | 2 | 3 | 4, label: string) => {
    const isDone = step > n || (n === 4 && stage === 'sent');
    const isActive = step === n;
    return (
      <div key={n} className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          failed && isActive ? 'bg-rose-100 text-rose-700'
          : isDone ? 'bg-emerald-100 text-emerald-700'
          : isActive ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-400'
        }`}>
          {isDone ? <Check className="w-4 h-4" /> : n}
        </span>
        <span className={`text-sm ${isActive ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
      </div>
    );
  };

  const smallBtn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40';
  const smallBtnDark = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/80 hover:text-white border border-white/20 disabled:opacity-40';

  const regenButton = (kind: 'copy' | 'image' | 'dm' | 'email', label: string, dark = false) => (
    <button onClick={() => regenerate(kind)} disabled={busy || stage !== 'ready' || (regenSeq[kind] || 0) >= 5}
      className={dark ? smallBtnDark : smallBtn} title={(regenSeq[kind] || 0) >= 5 ? '최대 5회까지 다시 만들 수 있습니다' : undefined}>
      <RefreshCw className="w-3.5 h-3.5" /> {label}{regenSeq[kind] ? ` (${regenSeq[kind]}/5)` : ''}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-2 md:p-4">
      <div className="w-full max-w-[1100px] bg-white rounded-2xl border border-gray-200/70 shadow-2xl max-h-[94vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-4 md:px-6 py-4 border-b border-gray-200/70 flex items-center justify-between shrink-0 gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">AI 영업</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">업체 홈페이지를 읽고 맞춤 제안 세트를 만들어 검수 후 회사 수신함으로 보냅니다</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setListMode(!listMode); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${
                listMode ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <List className="w-4 h-4" /> {listMode ? '단건 등록' : '진행 목록'}
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 스테퍼(단건 흐름 전용 — 목록 화면에서는 숨긴다) */}
        {!listMode && (
          <div className="px-4 md:px-6 py-3 border-b border-gray-200/70 flex items-center gap-4 md:gap-6 shrink-0 flex-wrap">
            {stepChip(1, '입력')}
            {stepChip(2, '분석')}
            {stepChip(3, '읽은 것 확인')}
            {stepChip(4, '제작·검토·발송')}
            {job && ACTIVE_STAGES.includes(stage) && (
              <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                {STAGE_LABEL[stage] || '처리 중'} · 창을 닫아도 계속 진행됩니다
              </span>
            )}
          </div>
        )}

        {/* 알림(오류·경고) */}
        {notice && (
          <div className="mx-4 md:mx-6 mt-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 shrink-0 flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700 shrink-0"><X className="w-4 h-4" /></button>
          </div>
        )}
        {/* 일괄 등록 결과 요약 — "전체 몇 곳 중 몇 곳 입력 OK" */}
        {bulkSummary && (
          <div className="mx-4 md:mx-6 mt-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 shrink-0">
            전체 {bulkSummary.accepted + bulkSummary.rejected.length + (bulkSummary.overflow || 0)}곳 중 {bulkSummary.accepted}곳 입력 OK
            {bulkSummary.rejected.length > 0 && ` · 제외 ${bulkSummary.rejected.length + (bulkSummary.overflow || 0)}곳`}
            {bulkSummary.rejected.length > 0 && (
              <ul className="mt-1 text-xs text-blue-600 space-y-0.5">
                {bulkSummary.rejected.slice(0, 6).map((r, i) => <li key={i}>{r.label}: {r.reason}</li>)}
                {bulkSummary.rejected.length + (bulkSummary.overflow || 0) > 6 && <li>외 {bulkSummary.rejected.length + (bulkSummary.overflow || 0) - 6}건</li>}
              </ul>
            )}
          </div>
        )}

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
          {/* 진행 목록(이력) — 검색 · 상태 칩 · 진행률 + 건별 산출물 링크 + 상세 진입 + 더 보기 */}
          {listMode && (() => {
            const total = jobsList.length;
            const activeN = jobsList.filter((j) => ACTIVE_STAGES.includes(j.stage)).length;
            const confirmN = jobsList.filter((j) => j.stage === 'awaiting_confirm').length;
            const readyN = jobsList.filter((j) => j.stage === 'ready').length;
            const sentN = jobsList.filter((j) => j.stage === 'sent').length;
            const failedN = jobsList.filter((j) => j.stage === 'failed').length;
            const processed = total - activeN;
            const pct = total ? Math.round((processed / total) * 100) : 0;
            const chip = (j: OutreachJob) => {
              const dismissed = !!j.stage_results?.dismissed_at;
              if (j.stage === 'failed') return <span className={`text-[11px] px-2 py-0.5 rounded-full ${dismissed ? 'bg-gray-100 text-gray-400' : 'bg-rose-100 text-rose-700'}`}>{dismissed ? '실패(숨김)' : '실패'}</span>;
              if (j.stage === 'awaiting_confirm') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">확인 대기</span>;
              if (j.stage === 'ready') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">검토 대기</span>;
              if (j.stage === 'sent') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">발송됨</span>;
              const c = j.stage_results?.chain;
              return (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> {j.stage === 'queued' && c ? `대기 ${c.index}/${c.total}` : (STAGE_LABEL[j.stage] || '진행 중')}
                </span>
              );
            };
            return (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm font-semibold text-gray-900">불러온 {total}곳 · 자동 처리 완료 {processed}곳 ({pct}%)</div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                      {activeN > 0 && <span>진행 중 {activeN}</span>}
                      {confirmN > 0 && <span className="text-amber-700 font-medium">확인 대기 {confirmN}</span>}
                      {readyN > 0 && <span className="text-blue-700">검토 대기 {readyN}</span>}
                      {sentN > 0 && <span className="text-emerald-700">발송됨 {sentN}</span>}
                      {failedN > 0 && <span className="text-rose-700">실패 {failedN}</span>}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input value={listQ} onChange={(e) => setListQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') loadJobsList(); }}
                        placeholder="업체명 또는 홈페이지로 검색 (Enter)"
                        className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {GROUP_CHIPS.map((g) => (
                        <button key={g.key} onClick={() => setListGroup(g.key)}
                          className={`px-2.5 py-1 rounded-full text-xs border ${listGroup === g.key ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* ★ 2026-09-06 S4 열람 보조 칩 + [정리] 다중선택 */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1 flex-wrap">
                      {VIEW_CHIPS.map((g) => (
                        <button key={g.key} onClick={() => setListView(g.key)}
                          className={`px-2.5 py-1 rounded-full text-xs border inline-flex items-center gap-1 ${listView === g.key ? 'bg-slate-800 text-white border-slate-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {g.key !== '' && <Eye className="w-3 h-3" />} {g.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      {cleanupMode && selectedIds.size > 0 && (
                        <button onClick={deleteSelected} disabled={busy}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium disabled:opacity-40">
                          <Trash2 className="w-3.5 h-3.5" /> 선택 {selectedIds.size}건 삭제
                        </button>
                      )}
                      <button onClick={() => { setCleanupMode(!cleanupMode); setSelectedIds(new Set()); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${cleanupMode ? 'border-rose-300 text-rose-700 bg-rose-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        <Trash2 className="w-3.5 h-3.5" /> {cleanupMode ? '정리 끝내기' : '정리'}
                      </button>
                    </div>
                  </div>
                </div>
                {total === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-gray-400 bg-gray-50 rounded-2xl">
                    {listBusy ? '불러오는 중입니다.' : '조건에 맞는 업체가 없습니다. 단건 등록 또는 엑셀 업로드로 시작해주세요.'}
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm divide-y divide-gray-100">
                    {jobsList.map((j) => {
                      const pv = j.preview_code && !j.purged_at ? `${window.location.origin}/api/outreach/v/${j.preview_code}` : null;
                      const dismissed = !!j.stage_results?.dismissed_at;
                      const selectable = cleanupMode && j.stage !== 'sent' && !ACTIVE_STAGES.includes(j.stage);
                      const dmViewers = Number(j.views?.dm?.viewers) || 0;
                      const pvHuman = Number(j.views?.preview?.human) || 0;
                      const dup = Number(j.dup_count) || 0;
                      return (
                        <div key={j.id} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${dismissed ? 'opacity-60' : ''} ${selectedIds.has(j.id) ? 'bg-rose-50/60' : ''}`}>
                          {cleanupMode && (
                            <button onClick={() => { if (selectable) toggleSelected(j.id); }} disabled={!selectable}
                              className={`shrink-0 ${selectable ? 'text-rose-600' : 'text-gray-300'}`} aria-label={selectable ? '선택' : '선택 불가'}>
                              {selectedIds.has(j.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                              {j.company_name} {chip(j)}
                              {/* ★ 2026-09-06 S4 열람 2단(DM 열람 기기 · 산출물 페이지 사람 열람) · 서버 집계 */}
                              {(j.stage === 'sent' || dmViewers + pvHuman > 0) && (
                                <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${dmViewers + pvHuman > 0 ? 'bg-slate-100 text-slate-700' : 'bg-gray-50 text-gray-400'}`} title="모바일 DM 열람 기기 · 산출물 페이지 사람 열람">
                                  <Eye className="w-3 h-3" /> {dmViewers} · {pvHuman}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 truncate">
                              {j.homepage_url}
                              {j.created_at ? ` · ${String(j.created_at).slice(0, 10)}` : ''}
                              {j.stage === 'failed' && j.fail_reason ? ` · ${j.fail_reason}` : ''}
                              {j.stage === 'sent' && j.mail_result ? ` · 발송 ${j.mail_result === 'sent' ? '완료' : j.mail_result}` : ''}
                            </div>
                            {(j.views?.unread3d || dup > 0) && (
                              <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap mt-0.5">
                                {j.views?.unread3d && <span className="text-amber-700">업체 전달 뒤 3일 무열람 · 재접촉 후보</span>}
                                {dup > 0 && (
                                  <button onClick={() => { const h = hostOfUrl(j.homepage_url); setListQ(h); loadJobsList({ q: h }); }} className="text-gray-500 hover:text-blue-600 hover:underline">
                                    같은 주소 {dup}건 더 보기
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {pv && (
                            <a href={pv} target="_blank" rel="noreferrer"
                              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">
                              <ExternalLink className="w-3.5 h-3.5" /> 산출물 페이지
                            </a>
                          )}
                          <button onClick={() => { resetInputState(); loadJob(j.id); setListMode(false); }}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium">
                            {j.stage === 'awaiting_confirm' ? '확인하기' : j.stage === 'ready' ? '검토·발송' : '열기'}
                          </button>
                        </div>
                      );
                    })}
                    {listHasMore && (
                      <div className="px-4 py-3 text-center">
                        <button onClick={() => loadJobsList({ append: true })} disabled={listBusy}
                          className="px-4 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                          {listBusy ? '불러오는 중' : '더 보기'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-gray-400 italic">Data source: 등록된 업체별 자동 제작 진행 기록</p>
              </div>
            );
          })()}

          {/* 직전 실행 요약(재실행 경고 축) */}
          {!listMode && step === 1 && lastSummary && (
            <div className="mb-4 px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200/70 text-xs text-gray-500">
              최근 실행: {lastSummary.company_name} · {STAGE_LABEL[lastSummary.stage] || lastSummary.stage}
              {lastSummary.created_at ? ` · ${String(lastSummary.created_at).slice(0, 10)}` : ''}
              {lastSummary.stage !== 'sent' && (
                <button onClick={() => loadJob(lastSummary.id)} className="ml-2 text-blue-600 hover:underline">이어서 보기</button>
              )}
            </div>
          )}

          {/* ① 입력 */}
          {!listMode && step === 1 && (
            <div className="max-w-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">업체명</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="예: 힐링뷰티"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">업종 <span className="text-gray-400 font-normal">(선택 · 홈페이지에서 못 읽으면 이 값을 씁니다)</span></label>
                <select value={industryCode} onChange={(e) => setIndustryCode(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">선택 안 함</option>
                  {industries.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">홈페이지 주소</label>
                <input value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)}
                  placeholder="예: www.brand.co.kr"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <button onClick={() => setNotesOpen(!notesOpen)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
                  {notesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} 추가 정보 <span className="text-gray-400 text-xs">(선택 · 담당자 이름·요청 사항·행사 메모)</span>
                </button>
                {notesOpen && (
                  <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value.slice(0, 2000))} rows={4}
                    placeholder="예: 담당자 김OO 과장 · 9월 신상 중심으로 · 세일 언급은 피해주세요"
                    className="mt-2 w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                )}
                {notesOpen && <p className="mt-1 text-[11px] text-gray-400">{extraNotes.length}/2000 · 여기 적은 내용은 문안·DM·메일 제작 재료로 함께 쓰입니다(혜택 숫자는 홈페이지에 있는 것만 반영됩니다).</p>}
              </div>
              {dupState ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => { const id = dupState.existingJobId; resetInputState(); loadJob(id); }} disabled={busy}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    기존 건 열기{dupState.existingStage ? ` (${STAGE_LABEL[dupState.existingStage] || dupState.existingStage})` : ''}
                  </button>
                  <button onClick={() => startAnalysis(true)} disabled={busy}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                    그래도 새로 만들기
                  </button>
                </div>
              ) : (
                <button onClick={() => startAnalysis(false)} disabled={busy || !companyName.trim() || !homepageUrl.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  읽기 시작
                </button>
              )}

              {/* 대량 등록 — 엑셀 양식(옆에 작성 예시 포함)으로 한 번에 최대 20곳 */}
              <div className="mt-6 pt-5 border-t border-gray-200/70">
                <div className="text-sm font-medium text-gray-700 mb-1">여러 업체 한번에 등록</div>
                <p className="text-xs text-gray-500 mb-3">엑셀 양식을 받아 작성한 뒤 올리면 한 번에 최대 20곳을 순서대로 자동 처리합니다. 진행 상황은 [진행 목록]에서 봅니다.</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                    <Download className="w-4 h-4" /> 엑셀 양식 받기
                  </button>
                  <label className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm cursor-pointer ${
                    bulkBusy ? 'bg-blue-300 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}>
                    {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    엑셀 업로드
                    <input type="file" accept=".xlsx,.xls" className="hidden" disabled={bulkBusy}
                      onChange={(e) => { handleBulkFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 italic">Data source: 입력한 홈페이지를 읽고 AI가 분석합니다</p>
            </div>
          )}

          {/* ② 분석 중 */}
          {!listMode && step === 2 && job && (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <div className="text-sm font-medium text-gray-900">{STAGE_LABEL[stage] || '분석 중'}</div>
              <div className="text-xs text-gray-500">{job.company_name} · {job.homepage_url}</div>
              {chain && stage === 'queued' && <div className="text-xs text-gray-400">일괄 등록 {chain.total}건 중 {chain.index}번째 · 앞 건이 끝나면 시작됩니다</div>}
              <div className="text-xs text-gray-400">창을 닫아도 분석은 계속됩니다. 다시 열면 이어서 보입니다.</div>
            </div>
          )}

          {/* ③ 읽은 것 확인 */}
          {!listMode && step === 3 && job && (
            <div className="space-y-5">
              {/* ★ 2026-09-06 S1 홈페이지에서 읽은 재료 — 전폭 한 줄(서버가 센 숫자만 · 값이 없는 칸은 그리지 않는다) */}
              {materials && materials.counts && (
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h3 className="text-sm font-semibold text-gray-900">홈페이지에서 읽은 재료</h3>
                    <span className="text-[11px] text-gray-400">
                      {readModeLabel}
                      {renderFailed ? ' · 화면 그리기는 실패해 바로 읽은 내용으로 진행했습니다' : ''}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
                    <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700">
                      상품 {Number(materials.counts.products) || 0}개{Number(materials.counts.discountPairs) > 0 ? ` · 할인가 있는 것 ${Number(materials.counts.discountPairs)}개` : ''}
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700">배너 후보 {Number(materials.counts.banners) || 0}장</span>
                    <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700">본문 {(Number(materials.counts.textChars) || 0).toLocaleString()}자</span>
                    {materials.proof?.reviewTotal ? <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">리뷰 {Number(materials.proof.reviewTotal).toLocaleString()}건</span> : null}
                    {materials.proof?.rating ? <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">평점 {materials.proof.rating}</span> : null}
                    {materials.proof?.rankLabel ? <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">{String(materials.proof.rankLabel)}</span> : null}
                  </div>
                  {renderFailed && sr.rendering_detail && (
                    <p className="mt-2 text-[11px] text-amber-600">화면 그리기 실패 사유: {String(sr.rendering_detail)}</p>
                  )}
                  {Number(materials.counts.products) === 0 && Number(materials.counts.banners) === 0 && (
                    <p className="mt-2 text-[11px] text-amber-600">상품·배너를 하나도 읽지 못했습니다. 주소를 확인해 다시 읽거나 행사 내용을 직접 붙여넣어 주세요.</p>
                  )}
                  {sr.material?.verdict === 'thin' && (
                    <p className="mt-2 text-[11px] text-amber-700">
                      재료가 얇습니다(상품 4개 · 배너 2장 · 행사 1건 중 둘 이상 미달). 제작은 진행되지만 발송은 잠기고, 검토 화면에서 산출물을 확인한 뒤 해제할 수 있습니다.
                    </p>
                  )}
                  {/* ★ v3 이벤트 목록 카드 수 · 브랜드 색 폴백 1줄(서버 값만) */}
                  {Number(materials.counts.eventCards) > 0 && (
                    <p className="mt-2 text-[11px] text-indigo-700">이벤트 목록 페이지에서 행사 카드 {Number(materials.counts.eventCards)}건(제목 · 기간 · 배너 · 링크)을 읽었습니다. 아래에서 최대 3개를 고르면 그 순서로 모바일 DM에 실립니다.</p>
                  )}
                  {job.brand_profile?.brand?.colorSource === 'neutral' && (
                    <p className="mt-2 text-[11px] text-amber-700">홈페이지에서 브랜드 색을 읽지 못했습니다. 무채색 주색으로 제작됩니다.</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 행사 후보 */}
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">홈페이지에서 읽은 행사</h3>
                  {(crawlUnavailable || analyzeUnavailable) && (
                    <div className="mb-3 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-2">
                      <div>
                        {crawlUnavailable
                          ? '홈페이지를 읽지 못했습니다(접속 차단 또는 시간 초과). 주소를 고쳐 다시 읽거나, 아래에 행사 내용을 직접 붙여넣거나, 행사 없이 진행할 수 있습니다.'
                          : '행사 분석이 일시적으로 실패했습니다. 다시 읽거나, 직접 입력하거나, 행사 없이 진행할 수 있습니다.'}
                        {(sr.crawling_detail || sr.analyzing_detail) && <span className="block mt-1 text-[11px] text-amber-600">사유: {String(sr.crawling_detail || sr.analyzing_detail)}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <input value={recrawlUrl} onChange={(e) => setRecrawlUrl(e.target.value)} placeholder={job.homepage_url}
                          className="flex-1 px-2.5 py-1.5 border border-amber-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-amber-400" />
                        <button onClick={recrawl} disabled={busy} className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs disabled:opacity-40">
                          <RefreshCw className="w-3.5 h-3.5" /> 다시 읽기
                        </button>
                      </div>
                    </div>
                  )}
                  {/* ★ v3 행사 카드 격자 — 다중 선택(≤3 · 누른 순서 = DM 등장 순서 · 1·2번은 DM 블록 · 3번은 마지막 버튼 목적지) · 카드 후보(origin card)는 배너·제목·기간·상세 링크 · 옛 후보는 인용문 행 */}
                  {candidates.length > 0 && (
                    <p className="mb-2 text-[11px] text-gray-500">행사를 최대 3개까지 고를 수 있습니다. 누른 순서대로 모바일 DM에 실립니다(1·2번은 블록 · 3번은 마지막 버튼). {eventPicks.length ? `${eventPicks.length}개 선택` : '아무것도 고르지 않으면 서버 기본 선택으로 시작합니다'}.</p>
                  )}
                  <div className={`grid gap-2 ${candidates.some((c) => c?.origin === 'card') ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                    {candidates.map((c, i) => {
                      const on = eventPicks.includes(i);
                      const order = eventPicks.indexOf(i);
                      const full = !on && eventPicks.length >= 3;
                      const isCard = c?.origin === 'card';
                      return (
                        <label key={i} title={full ? '행사는 3개까지 담깁니다' : undefined}
                          className={`relative block rounded-xl border text-sm overflow-hidden ${on ? 'border-blue-500 bg-blue-50' : full ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed' : 'border-gray-200 hover:bg-gray-50 cursor-pointer'}`}>
                          {isCard && c.bannerUrl && (
                            <img src={String(c.bannerUrl)} alt="" loading="lazy" className="w-full aspect-[16/7] object-cover bg-gray-100" />
                          )}
                          <div className="p-3">
                            <div className="flex items-start gap-2">
                              <input type="checkbox" className="mt-0.5 accent-blue-600" checked={on} disabled={full || eventChoice === 'manual'} onChange={() => toggleEventPick(i)} />
                              <span className="text-gray-800 min-w-0">{isCard ? String(c.title || c.quote) : `"${c.quote}"`}</span>
                              {on && <span className="ml-auto shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] flex items-center justify-center font-semibold">{order + 1}</span>}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              {isCard && c.periodRaw && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{String(c.periodRaw)}</span>}
                              {!isCard && c.endDate && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">종료 {c.endDate}</span>}
                              {isCard && <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">이벤트 목록 카드</span>}
                              {!isCard && c.sourceUrl && c.sourceUrl !== job.homepage_url && c.sourceUrl !== 'manual' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">행사 페이지에서</span>}
                              {c.benefitLicensed
                                ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">혜택 문구 인용 가능</span>
                                : <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">혜택 숫자는 직접 입력 자리로</span>}
                              {isCard && c.detailUrl && <a href={String(c.detailUrl)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" /> 상세</a>}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 space-y-2">
                    <label className={`block p-3 rounded-lg border cursor-pointer text-sm ${
                      eventChoice === 'none' && eventPicks.length === 0 ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="radio" name="so-event" className="mr-2" checked={eventChoice === 'none' && eventPicks.length === 0}
                        onChange={() => { setEventChoice('none'); setEventPicks([]); }} />
                      행사 없음 · 브랜드 일반형으로 제작
                    </label>
                    <label className={`block p-3 rounded-lg border cursor-pointer text-sm ${
                      eventChoice === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="radio" name="so-event" className="mr-2" checked={eventChoice === 'manual'}
                        onChange={() => { setEventChoice('manual'); setEventPicks([]); }} />
                      행사 내용 직접 붙여넣기
                    </label>
                    {eventChoice === 'manual' && (
                      <textarea value={manualEventText} onChange={(e) => setManualEventText(e.target.value)}
                        rows={4} placeholder="홈페이지의 행사 안내 문구를 그대로 붙여넣어 주세요"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    )}
                  </div>
                  {meta && (
                    <p className="mt-3 text-[11px] text-gray-400">후보 {Number(meta.rawCandidates) || 0}건 중 {Number(meta.matched) || 0}건이 원문과 일치했습니다{Number(meta.markerDropped) ? ` · 종료 표현으로 제외 ${meta.markerDropped}건` : ''}{job.brand_profile?.subPageUrl ? ' · 행사 페이지 1곳을 함께 읽었습니다' : ''}</p>
                  )}
                  {(job.brand_profile?.eventTextFull || job.brand_profile?.excerpt) && (
                    <div className="mt-3">
                      <button onClick={() => setMaterialOpen(!materialOpen)} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800">
                        {materialOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        읽은 내용 전체 보기{legacyExcerptOnly ? ' (600자 발췌 기반)' : ` (${String(job.brand_profile?.eventTextFull || '').length}자)`}
                      </button>
                      {materialOpen && (
                        <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-[11px] text-gray-600 bg-gray-50 rounded-lg p-3 border border-gray-200/70">
                          {String(job.brand_profile?.eventTextFull || job.brand_profile?.excerpt || '')}
                        </pre>
                      )}
                    </div>
                  )}
                  {job.brand_profile?.extraNotes && (
                    <p className="mt-2 text-[11px] text-gray-500">담당자 추가 정보: {String(job.brand_profile.extraNotes).slice(0, 200)}{String(job.brand_profile.extraNotes).length > 200 ? '…' : ''}</p>
                  )}
                </div>

                {/* 이미지 후보 */}
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">대표 이미지</h3>
                  <p className="text-xs text-gray-500 mb-3">선택한 1장을 다듬어 포스터에 씁니다. 고른 사진에 인물이 있으면 제작 단계에서 제외되고 사유가 표시됩니다.</p>
                  {imageCandidates.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-gray-400 bg-gray-50 rounded-lg">
                      가져올 이미지를 찾지 못했습니다. 생성 이미지로만 제작합니다.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {imageCandidates.map((url) => (
                        <button key={url} onClick={() => setImageChoice(imageChoice === url ? '' : url)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 ${
                            imageChoice === url ? 'border-blue-500' : 'border-transparent hover:border-gray-300'
                          }`}>
                          <img src={url} alt="후보 이미지" className="w-full h-full object-cover" loading="lazy" />
                          {imageChoice === url && (
                            <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-gray-400">선택하지 않으면 생성 이미지로만 제작합니다. 갤러리·상품 이미지는 제작 단계에서 홈페이지 원본을 실측해 선명한 것만 씁니다.</p>
                  {industries.length > 0 && (
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-gray-500 mb-1">업종 확인</label>
                      <select value={industryCode || job.industry_category || ''} onChange={(e) => setIndustryCode(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">선택 안 함</option>
                        {industries.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={confirmSelection} disabled={busy || (eventChoice === 'manual' && !manualEventText.trim())}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  이 조합으로 제작 시작
                </button>
                {!crawlUnavailable && !analyzeUnavailable && (
                  <button onClick={recrawl} disabled={busy} className={smallBtn}><RefreshCw className="w-3.5 h-3.5" /> 다시 읽기</button>
                )}
                <span className="text-[10px] text-gray-400 italic">Data source: 홈페이지 원문과 대조해 확인된 행사만 보입니다</span>
              </div>
            </div>
          )}

          {/* ④ 제작·검토·발송 */}
          {!listMode && step === 4 && job && (
            <div className="space-y-4">
              {failed && (
                <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm text-rose-800">
                      {job.fail_reason || '처리에 실패했습니다.'}
                      <span className="ml-2 text-xs text-rose-400">({STAGE_LABEL[job.fail_stage || ''] || job.fail_stage}{job.fail_stage && sr[job.fail_stage] === 'unavailable' ? ' · 일시 장애' : ''})</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={retry} disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm hover:bg-rose-100 disabled:opacity-40">
                        <RefreshCw className="w-3.5 h-3.5" /> 재시도
                      </button>
                      {(job.fail_stage === 'crawling' || job.fail_stage === 'analyzing' || job.fail_stage === 'queued') && (
                        <button onClick={recrawl} disabled={busy} className={smallBtn}><RefreshCw className="w-3.5 h-3.5" /> 주소 바꿔 다시 읽기</button>
                      )}
                      {!sr.dismissed_at && (
                        <button onClick={dismissJob} disabled={busy} className={smallBtn}><EyeOff className="w-3.5 h-3.5" /> 숨기기</button>
                      )}
                      <button onClick={deleteJob} disabled={busy} className={`${smallBtn} text-rose-700 border-rose-200 hover:bg-rose-50`}><Trash2 className="w-3.5 h-3.5" /> 삭제</button>
                    </div>
                  </div>
                  {job.fail_detail && <p className="mt-1.5 text-[11px] text-gray-500 break-all">상세: {job.fail_detail}</p>}
                  {(job.fail_stage === 'crawling' || job.fail_stage === 'analyzing' || job.fail_stage === 'queued') && (
                    <input value={recrawlUrl} onChange={(e) => setRecrawlUrl(e.target.value)} placeholder={job.homepage_url}
                      className="mt-2 w-full px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs bg-white outline-none focus:ring-2 focus:ring-rose-300" />
                  )}
                </div>
              )}
              {producing && (
                <div className="px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {STAGE_LABEL[stage]} · 창을 닫아도 계속 진행됩니다{sr.regen?.from ? ' · 다시 만드는 중' : ''}
                </div>
              )}

              {(stage === 'ready' || stage === 'sent') && (
                <>
                  <div className="flex items-center gap-1 border-b border-gray-200/70 overflow-x-auto">
                    {([['email', '제안 메일'], ['copy', '문안'], ['dm', '모바일 DM'], ['image', '이미지'], ...(hasMaterials ? [['materials', '재료']] as const : [])] as ReadonlyArray<readonly [typeof reviewTab, string]>).map(([k, label]) => (
                      <button key={k} onClick={() => setReviewTab(k)}
                        className={`px-4 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${
                          reviewTab === k ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* 서버 숫자 2줄 — 직접 채울 자리(amber) · 기계가 걷어낸 수(emerald) */}
                  {(placeholderCount > 0 || strippedTotal > 0 || Number(copyAsset?.placeholders) > 0) && (
                    <div className="space-y-1">
                      {placeholderCount > 0 && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">직접 채울 자리 {placeholderCount}곳이 메일에 남아 있습니다. 문안·제목을 고친 뒤 메일을 다시 조립하면 사라집니다.</p>}
                      {strippedTotal > 0 && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">홈페이지에 없는 혜택 표현 {strippedTotal}곳을 모바일 DM·이메일 시안에서 자동으로 걷어냈습니다.</p>}
                    </div>
                  )}

                  {/* ★ 0905(3) 품질 경고 — 서버가 센 것 · 잠금이 아니다(발송을 막지 않는다) · 바로가기 */}
                  {quality.length > 0 && (
                    <div className="text-xs rounded-lg px-3 py-2 bg-sky-50 border border-sky-200 text-sky-900 space-y-1">
                      <p className="font-medium">보내기 전에 볼 것 {quality.length}건 · 발송은 막지 않습니다</p>
                      {quality.map((w) => (
                        <div key={w.code} className="flex items-center justify-between gap-2 flex-wrap">
                          <span>{qualityText(w)}</span>
                          {(w.code === 'NO_PRODUCTS' || w.code === 'FEW_PRODUCTS' || w.code === 'FEW_GALLERY') && hasMaterials && <button onClick={() => setReviewTab('materials')} className="text-blue-600 hover:underline">재료 보기</button>}
                          {(w.code === 'CTA_ALL_HOME' || w.code === 'FEW_SECTIONS' || w.code === 'NO_LOOK' || w.code === 'BLOCK_MINIMA_SHORT' || w.code.startsWith('VISION_')) && <button onClick={() => setReviewTab('dm')} className="text-blue-600 hover:underline">모바일 DM 보기</button>}
                          {w.code === 'NO_BRAND_EMAIL' && stage === 'ready' && <button onClick={() => regenerate('email')} className="text-blue-600 hover:underline">제목·서두·이메일 시안 다시 생성</button>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4">
                    {/* 미리보기 — 다크 액자(흰 산출물의 경계 확보) */}
                    <div className="bg-slate-950 rounded-2xl p-3 md:p-4 min-h-[420px]">
                      {reviewTab === 'email' && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {subjectEditing ? (
                              <>
                                <input value={subjectDraft} onChange={(e) => setSubjectDraft(e.target.value.slice(0, 40))}
                                  className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg text-sm bg-white outline-none" />
                                <span className="text-[11px] text-white/40">{subjectDraft.length}/40</span>
                                <button onClick={saveSubject} disabled={busy || !subjectDraft.trim()} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs disabled:opacity-40">저장</button>
                                <button onClick={() => { setSubjectEditing(false); setSubjectDraft(String(emailAsset?.subject || '')); }} className="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:text-white">취소</button>
                              </>
                            ) : (
                              <>
                                <span className="text-sm text-white/90 font-medium truncate flex-1 min-w-0">{emailAsset?.subject ? `제목: ${emailAsset.subject}` : '제목 없음'}</span>
                                {stage === 'ready' && emailAsset?.subject && (
                                  <button onClick={() => { setSubjectDraft(String(emailAsset.subject)); setSubjectEditing(true); }} className={smallBtnDark}><Pencil className="w-3.5 h-3.5" /> 제목 편집</button>
                                )}
                              </>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                              <button onClick={() => setPreviewWidth(600)} className={`p-1.5 rounded-lg ${previewWidth === 600 ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`} title="데스크탑 폭"><Monitor className="w-4 h-4" /></button>
                              <button onClick={() => setPreviewWidth(375)} className={`p-1.5 rounded-lg ${previewWidth === 375 ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`} title="모바일 폭"><Smartphone className="w-4 h-4" /></button>
                            </div>
                          </div>
                          {/* ★ v3 회신 유도 문장(마지막 카드 마지막 줄 · 60자 · 저장 = 재조립 AI 0) */}
                          {emailAsset?.html && (
                            <div className="flex items-center gap-2 flex-wrap text-[11px] text-white/70">
                              {replyEditing ? (
                                <>
                                  <input value={replyDraft} onChange={(e) => setReplyDraft(e.target.value.slice(0, 60))} placeholder="비우면 기본 문장으로 돌아갑니다"
                                    className="flex-1 min-w-[220px] px-3 py-1.5 rounded-lg text-xs bg-white text-gray-800 outline-none" />
                                  <span className="text-white/40">{replyDraft.length}/60</span>
                                  <button onClick={saveReply} disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs disabled:opacity-40">저장하고 재조립</button>
                                  <button onClick={() => setReplyEditing(false)} className="px-2 py-1.5 rounded-lg text-white/70 hover:text-white">취소</button>
                                </>
                              ) : (
                                <>
                                  <span className="truncate min-w-0">회신 문장: {sr.reply_line?.text ? String(sr.reply_line.text) : '기본 문장(이미지 2장과 자사몰 주소 회신 요청)'}</span>
                                  {stage === 'ready' && <button onClick={() => { setReplyDraft(String(sr.reply_line?.text || '')); setReplyEditing(true); }} className={smallBtnDark}><Pencil className="w-3.5 h-3.5" /> 회신 문장 편집</button>}
                                </>
                              )}
                            </div>
                          )}
                          {emailAsset?.html ? (
                            <iframe title="제안 메일 미리보기" srcDoc={emailAsset.html} sandbox=""
                              className="bg-white rounded-xl border-0 mx-auto block h-[60vh] min-h-[420px] transition-all"
                              style={{ width: '100%', maxWidth: previewWidth }} />
                          ) : <div className="text-white/40 text-sm p-8 text-center">조립된 메일이 없습니다</div>}
                          {stage === 'ready' && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {regenButton('email', '제목·서두·이메일 시안 다시 생성', true)}
                              <button onClick={rebuildEmail} disabled={busy} className={smallBtnDark}><RefreshCw className="w-3.5 h-3.5" /> 메일 재조립</button>
                            </div>
                          )}
                          {hiddenList('email', emailBaseSections)}
                        </div>
                      )}
                      {reviewTab === 'copy' && (
                        <div className="max-w-[640px] mx-auto">
                          {copyEditing ? (
                            <>
                              <textarea value={copyDraft} onChange={(e) => setCopyDraft(e.target.value)} rows={10}
                                className="w-full px-3 py-2 rounded-xl text-sm bg-white outline-none" />
                              <div className="mt-2 flex gap-2">
                                <button onClick={saveCopy} disabled={busy}
                                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm">저장하고 메일 재조립</button>
                                <button onClick={() => { setCopyEditing(false); setCopyDraft(String(copyAsset?.body || '')); }}
                                  className="px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white">취소</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="bg-white rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap">{String(copyAsset?.body || '문안이 없습니다')}</div>
                              {Number(copyAsset?.placeholders) > 0 && <p className="mt-2 text-xs text-amber-300">직접 채울 자리 {Number(copyAsset.placeholders)}곳이 있습니다. 문안 수정으로 채워주세요.</p>}
                              {stage === 'ready' && (
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                  <button onClick={() => setCopyEditing(true)} className={smallBtnDark}><Pencil className="w-3.5 h-3.5" /> 문안 수정</button>
                                  {regenButton('copy', 'AI로 다시 생성', true)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {reviewTab === 'dm' && (
                        <div className="text-center">
                          {/* ★ 0905(3) C4-1 검토 화면 안에서 본다 — 정규 뷰어 URL을 sandbox iframe으로(이메일 탭 선례 · 스크립트 0 = 열람 통계 오염 0) */}
                          {/* ★ v3 폭 토글(375 = 담당자 손 안 · 600 = 데스크탑) */}
                          <div className="mb-2 flex items-center justify-end gap-1">
                            <button onClick={() => setDmWidth(600)} className={`p-1.5 rounded-lg ${dmWidth === 600 ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`} title="데스크탑 폭"><Monitor className="w-4 h-4" /></button>
                            <button onClick={() => setDmWidth(375)} className={`p-1.5 rounded-lg ${dmWidth === 375 ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`} title="모바일 폭"><Smartphone className="w-4 h-4" /></button>
                          </div>
                          {dmAsset?.viewerUrl || dmAsset?.dmUrl ? (
                            <iframe title="모바일 DM 미리보기" src={String(dmAsset.viewerUrl || dmAsset.dmUrl)} sandbox=""
                              className="bg-white rounded-xl border-0 mx-auto block h-[60vh] min-h-[420px] transition-all" style={{ width: '100%', maxWidth: dmWidth }} />
                          ) : <div className="text-white/40 text-sm py-12">모바일 DM이 없습니다</div>}
                          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                            {dmAsset?.dmUrl && (
                              <a href={dmAsset.dmUrl} target="_blank" rel="noreferrer" className={smallBtnDark}><ExternalLink className="w-3.5 h-3.5" /> 새 창에서 열기</a>
                            )}
                            {stage === 'ready' && regenButton('dm', '모바일 DM 다시 만들기', true)}
                          </div>
                          {dmAsset?.dmUrl && <p className="mt-2 text-[11px] text-white/40 break-all">{dmAsset.dmUrl}</p>}
                          {Array.isArray(dmAsset?.sectionTypes) && dmAsset.sectionTypes.length > 0 && (
                            <p className="mt-1 text-[11px] text-white/40">구성 {dmAsset.sectionTypes.length}섹션{dmAsset.look ? ` · 구도 ${Number(dmAsset.look.treatments) || 0} · 배경면 ${Number(dmAsset.look.backgrounds) || 0}` : ''}{Number(dmAsset.hiddenApplied) > 0 ? ` · 숨김 ${Number(dmAsset.hiddenApplied)}` : ''}</p>
                          )}
                          {dmAsset?.hiddenSkipped && <p className="mt-2 text-[11px] text-amber-300">구성이 바뀌어 저장된 숨김을 적용하지 않았습니다. 아래 목록에서 다시 골라 반영해주세요.</p>}
                          {hiddenList('dm', dmBaseSections)}
                        </div>
                      )}
                      {reviewTab === 'image' && (
                        <div className="text-center">
                          {imageAsset?.url ? (
                            <img src={imageAsset.url} alt="대표 이미지" className="max-w-[480px] w-full mx-auto rounded-xl" />
                          ) : <div className="text-white/40 text-sm p-8">이미지가 없습니다</div>}
                          {imageAsset?.category && <p className="mt-2 text-[11px] text-white/40">템플릿 {imageAsset.category} · {imageAsset.kind === 'event' ? '행사형' : '제품형'}{imageAsset.usedCutout ? ' · 선택 이미지 누끼 사용' : ''}</p>}
                          {stage === 'ready' && <div className="mt-4 flex justify-center">{regenButton('image', '이미지 다시 만들기', true)}</div>}
                        </div>
                      )}
                      {reviewTab === 'materials' && (
                        <div className="text-left">
                          {/* ★ 0905(3) C4-2 재료 다시 고르기 — 실측 통과 사본만(서버 화이트리스트) · 체크 = 남긴다 · 화살표 = 순서(첫 상품·첫 사진이 앞 묶음·히어로) */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-[11px] text-white/60">실측을 통과한 재료입니다. 빼거나 순서를 바꾼 뒤 [고른 재료로 다시 만들기]를 누르면 모바일 DM·이메일 시안이 이 재료로 다시 만들어집니다.</p>
                            {stage === 'ready' && (
                              <button onClick={applyMaterials} disabled={busy || !materialsChanged || (matProducts.length + matGallery.length === 0) || materialsSeq >= 5} className={smallBtnDark}
                                title={materialsSeq >= 5 ? '최대 5회까지 다시 고를 수 있습니다' : undefined}>
                                <RefreshCw className="w-3.5 h-3.5" /> 고른 재료로 다시 만들기{materialsSeq ? ` (${materialsSeq}/5)` : ''}
                              </button>
                            )}
                          </div>
                          {stage === 'ready' && (
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/60">
                              다시 고르는 사유(선택 · 학습에 쓰입니다)
                              <select value={editReason} onChange={(e) => setEditReason(e.target.value)} className="px-2 py-1 rounded-lg bg-white/10 text-white/80 border border-white/20 outline-none">
                                <option value="">사유 안 남김</option>
                                {EDIT_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                          )}
                          <h5 className="mt-3 text-xs font-semibold text-white/80">상품 {matProducts.length}/{mediaProducts.length}</h5>
                          {mediaProducts.length === 0 && <p className="text-[11px] text-white/40 mt-1">실측을 통과한 상품이 없습니다.</p>}
                          <ul className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {[...matProducts.map((u) => mediaProducts.find((x: any) => String(x.image_url) === u)).filter(Boolean), ...mediaProducts.filter((x: any) => !matProducts.includes(String(x.image_url)))].map((x: any) => {
                              const u = String(x.image_url); const on = matProducts.includes(u); const idx = matProducts.indexOf(u);
                              return (
                                <li key={u} className={`rounded-xl overflow-hidden border ${on ? 'border-blue-400 bg-white' : 'border-white/10 bg-white/5 opacity-60'}`}>
                                  <img src={u} alt="" className="w-full aspect-square object-cover" />
                                  <div className="p-2 text-[11px]">
                                    <div className={`truncate ${on ? 'text-gray-800' : 'text-white/70'}`}>{String(x.name || '')}</div>
                                    <div className={on ? 'text-gray-500' : 'text-white/40'}>{x.discount_price ? `${Number(x.discount_price).toLocaleString()}원 · 정가 ${Number(x.price || 0).toLocaleString()}원` : x.price ? `${Number(x.price).toLocaleString()}원` : ''}{x.width ? ` · ${x.width}px` : ''}</div>
                                    {/* ★ v3 카드 원문 사실(뱃지 · 평점 · 리뷰 수 · 할인율 · 수상) — 서버가 상세·목록에서 읽은 값만 */}
                                    {(Array.isArray(x.badges) && x.badges.length > 0 || x.rating || x.review_count || x.discount_rate || (Array.isArray(x.awards) && x.awards.length > 0)) && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {(Array.isArray(x.badges) ? x.badges : []).slice(0, 4).map((b: string) => <span key={b} className={`px-1 rounded ${on ? 'bg-gray-100 text-gray-600' : 'bg-white/10 text-white/60'}`}>{b}</span>)}
                                        {x.discount_rate ? <span className={`px-1 rounded ${on ? 'bg-rose-50 text-rose-600' : 'bg-white/10 text-white/60'}`}>{Number(x.discount_rate)}%</span> : null}
                                        {x.rating ? <span className={`px-1 rounded ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-white/10 text-white/60'}`}>평점 {x.rating}{x.review_count ? ` (${Number(x.review_count).toLocaleString()})` : ''}</span> : null}
                                        {(Array.isArray(x.awards) ? x.awards : []).slice(0, 1).map((a: string) => <span key={a} className={`px-1 rounded truncate max-w-full ${on ? 'bg-amber-50 text-amber-700' : 'bg-white/10 text-white/60'}`}>{a}</span>)}
                                      </div>
                                    )}
                                    <div className="mt-1 flex items-center gap-1">
                                      <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={on} disabled={stage !== 'ready'} onChange={() => toggleMat('products', u)} className="accent-blue-500" /><span className={on ? 'text-gray-700' : 'text-white/60'}>{on ? '남김' : '제외'}</span></label>
                                      {on && <span className="ml-auto flex gap-0.5"><button onClick={() => moveMat('products', u, -1)} disabled={idx <= 0 || stage !== 'ready'} className="px-1 rounded bg-gray-100 text-gray-600 disabled:opacity-30">←</button><button onClick={() => moveMat('products', u, 1)} disabled={idx >= matProducts.length - 1 || stage !== 'ready'} className="px-1 rounded bg-gray-100 text-gray-600 disabled:opacity-30">→</button></span>}
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          <h5 className="mt-4 text-xs font-semibold text-white/80">사진 {matGallery.length}/{mediaGallery.length}</h5>
                          {mediaGallery.length === 0 && <p className="text-[11px] text-white/40 mt-1">실측을 통과한 사진이 없습니다.</p>}
                          <ul className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[...matGallery.map((u) => mediaGallery.find((x: any) => String(x.url) === u)).filter(Boolean), ...mediaGallery.filter((x: any) => !matGallery.includes(String(x.url)))].map((x: any) => {
                              const u = String(x.url); const on = matGallery.includes(u); const idx = matGallery.indexOf(u);
                              return (
                                <li key={u} className={`rounded-xl overflow-hidden border ${on ? 'border-blue-400 bg-white' : 'border-white/10 bg-white/5 opacity-60'}`}>
                                  <img src={u} alt="" className="w-full aspect-[4/3] object-cover" />
                                  <div className="p-1.5 text-[11px] flex items-center gap-1">
                                    <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={on} disabled={stage !== 'ready'} onChange={() => toggleMat('gallery', u)} className="accent-blue-500" /><span className={on ? 'text-gray-700' : 'text-white/60'}>{x.width && x.height ? `${x.width}×${x.height}` : (on ? '남김' : '제외')}</span></label>
                                    {on && <span className="ml-auto flex gap-0.5"><button onClick={() => moveMat('gallery', u, -1)} disabled={idx <= 0 || stage !== 'ready'} className="px-1 rounded bg-gray-100 text-gray-600 disabled:opacity-30">←</button><button onClick={() => moveMat('gallery', u, 1)} disabled={idx >= matGallery.length - 1 || stage !== 'ready'} className="px-1 rounded bg-gray-100 text-gray-600 disabled:opacity-30">→</button></span>}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          <p className="mt-3 text-[11px] text-white/40">사진·상품 이미지는 업체 홈페이지 원본의 사본이며, 메일 푸터에 활용 고지가 붙습니다(인물 사진은 자동 제외).</p>
                        </div>
                      )}
                    </div>

                    {/* 근거 패널(화면에만 있는 것 · 메일에 안 들어감) */}
                    <div className="space-y-3">
                      {/* ★ 2026-09-06 S4 열람 — 문장은 서버가 완성(새 테이블 0 · 식별자 0) */}
                      {Array.isArray(job.views?.sentences) && job.views!.sentences!.length > 0 && (
                        <div className={`rounded-2xl border shadow-sm p-4 ${job.views?.unread3d ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200/70'}`}>
                          <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> 담당자 열람</h4>
                          <div className="space-y-1 text-[12px] text-gray-700">
                            {job.views!.sentences!.map((t, i) => <p key={i}>{t}</p>)}
                          </div>
                        </div>
                      )}
                      <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                        <h4 className="text-xs font-semibold text-gray-500 mb-2">읽은 근거</h4>
                        {/* ★ v3 다중 선택(선택 순서 = DM 등장 순서) · 옛 기록은 selected 1건 */}
                        {Array.isArray(job.event_quote?.selectedList) && job.event_quote!.selectedList!.length > 1 ? (
                          <ol className="text-sm text-gray-700 space-y-0.5 list-decimal pl-5">
                            {job.event_quote!.selectedList!.map((c: any, i: number) => <li key={i}>{c.origin === 'card' ? String(c.title || c.quote) : `"${c.quote}"`}{c.periodRaw ? <span className="text-gray-400"> · {String(c.periodRaw)}</span> : null}</li>)}
                          </ol>
                        ) : job.event_quote?.selected ? (
                          <p className="text-sm text-gray-700">{job.event_quote.selected.origin === 'card' ? String(job.event_quote.selected.title || job.event_quote.selected.quote) : `"${job.event_quote.selected.quote}"`}</p>
                        ) : (
                          <p className="text-sm text-gray-400">행사 없이 일반형으로 제작했습니다.</p>
                        )}
                        {dmAsset?.bannerFallback && <p className="mt-1 text-[11px] text-gray-500">이벤트 카드가 없어 홈 배너의 글자를 읽어 행사 카드로 세웠습니다(면허 없음 · 수치는 원문 재대조 통과분만).</p>}
                        {imageAsset?.skippedReason && (
                          <p className="mt-2 text-xs text-amber-600">{imageAsset.skippedReason}</p>
                        )}
                        <div className="mt-2 space-y-1 text-[11px] text-gray-500">
                          {meta && <p>후보 {Number(meta.rawCandidates) || 0}건 중 {Number(meta.matched) || 0}건이 원문과 일치 · 재료 {Number(meta.materialChars) || 0}자</p>}
                          {mediaStats && <p>선명한 이미지 {Number(mediaStats.galleryPassed) || 0}장 · 상품 {Number(mediaStats.productsPassed) || 0}개를 홈페이지에서 실측해 사본으로 썼습니다</p>}
                          {readModeLabel && <p>홈페이지 읽기 방식: {readModeLabel}{renderFailed ? ' (화면 그리기 실패 · 바로 읽은 내용으로 진행)' : ''}</p>}
                          {imageAsset?.mediaError && <p className="text-amber-600">재료 이미지 수집이 실패해 생성 이미지 중심으로 만들었습니다.</p>}
                          {/* 참조 골격·예시 — asset에 기록된 사실만 말한다(지어내지 않는다) */}
                          {dmAsset?.structureRef && (
                            <p>참조 골격 {Number(dmAsset.structureRef.sampleCount) || 0}건 중 1건을 모바일 DM 구성 힌트로 참고했습니다.
                              {Array.isArray(dmAsset.structureRef.pruned) && dmAsset.structureRef.pruned.length > 0 ? ` 재료가 비어 구성 ${dmAsset.structureRef.pruned.length}개를 뺐습니다.` : ''}
                            </p>
                          )}
                          {Number(dmAsset?.exemplarCount) > 0 && <p>실물 예시 {Number(dmAsset.exemplarCount)}건(DM{Number(dmAsset.exemplarTotal) > 0 ? ` · 원천 ${Number(dmAsset.exemplarTotal)}건` : ''}){Number(emailAsset?.exemplarCount) > 0 ? ` · ${Number(emailAsset.exemplarCount)}건(이메일${Number(emailAsset.exemplarTotal) > 0 ? ` · 원천 ${Number(emailAsset.exemplarTotal)}건` : ''})` : ''}의 구성·톤을 프롬프트에 실어 참고했습니다.</p>}
                          {copyAsset?.sampleTrained === false && <p className="text-gray-400">양식 샘플 학습 전(기본형)으로 제작되었습니다.</p>}
                          {imageAsset?.templateId && <p>이미지 템플릿: {imageAsset.category}{imageAsset.regenCount ? ` · ${imageAsset.regenCount}번째 재생성` : ''}</p>}
                          {/* ★ 2026-09-06 S3 스튜디오 활용은 장수가 아니라 칸 수로 보인다(문구 3칸 · 누끼 경로 · 배너) */}
                          {imageAsset?.posterTexts && (
                            <p>
                              포스터 문구 {['label', 'title', 'subtitle'].filter((k) => imageAsset.posterTexts?.[k]).length}칸 반영
                              {imageAsset.cutoutSource === 'alpha_png' ? ' · 홈페이지 누끼 PNG 직접 합성' : imageAsset.cutoutSource === 'rembg' ? ' · 배경 제거 합성' : ''}
                              {imageAsset.bannerUrl ? ' · 16:9 배너 1장(실측 배너 0장 폴백)' : ''}
                              {imageAsset.posterRegenerated ? ' · 숫자 유출 검출로 배경 1회 재생성' : ''}
                            </p>
                          )}
                          {chain && <p>일괄 등록 {chain.total}건 중 {chain.index}번째</p>}
                          {/* ★ v3 관측 1줄 — 서버가 센 AI 호출 수 · 자동 재조립 · 사람 재생성(값이 없으면 안 그린다) */}
                          {sr.ai_cost && typeof sr.ai_cost === 'object' && Number(sr.ai_cost.calls) > 0 && (
                            <p>이 건에 쓴 AI 호출 {Number(sr.ai_cost.calls)}회 · 자동 재조립 {Number(sr.auto_seq?.dm) || 0}/1{Array.isArray(dmAsset?.autoRetry?.reasons) && dmAsset.autoRetry.reasons.length ? `(${dmAsset.autoRetry.reasons.join(', ')})` : ''} · 모바일 DM 사람 재생성 {Number(regenSeq.dm) || 0}/5</p>
                          )}
                          {Number(dmAsset?.eventCards) > 0 && <p>행사 카드 {Number(dmAsset.eventCards)}건을 모바일 DM 블록으로 세웠습니다(설명 없는 이미지 블록 0).</p>}
                          {Array.isArray(dmAsset?.blockGate?.short) && dmAsset.blockGate.short.length > 0 && <p className="text-amber-600">블록 최소 요건 미달 {dmAsset.blockGate.short.length}곳(경고만 · 삭제하지 않았습니다)</p>}
                          {sr.mail_last && <p className={sr.mail_last.outcome === 'sent' ? 'text-emerald-700' : 'text-amber-700'}>직전 발송 {fmtDateTime(sr.mail_last.at)} · {sr.mail_last.outcome}{Array.isArray(sr.mail_last.rejected) && sr.mail_last.rejected.length ? ` · 거부 ${sr.mail_last.rejected.join(', ')}` : ''}</p>}
                        </div>
                        {job.brand_profile?.homeCaptureUrl && (
                          <div className="mt-3 flex items-start gap-2">
                            <img src={String(job.brand_profile.homeCaptureUrl)} alt="" className="w-14 rounded-md border border-gray-200 bg-gray-50" />
                            <p className="text-[11px] text-gray-500">담당자 홈 첫 화면 캡처(375폭) · 제안 메일 1막 대조의 왼쪽 그림입니다.</p>
                          </div>
                        )}
                      </div>
                      {/* ★ v3 담당자가 열 주소 2줄(모바일 DM · 공개 샘플) + 복사 · 레시피 승격 */}
                      {(dmAsset?.dmUrl || previewUrl) && (
                        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4 space-y-2">
                          <h4 className="text-xs font-semibold text-gray-500">담당자가 열 주소</h4>
                          {dmAsset?.dmUrl && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="shrink-0 text-gray-400 w-16">모바일 DM</span>
                              <a href={String(dmAsset.dmUrl)} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-blue-600 hover:underline">{String(dmAsset.dmUrl)}</a>
                              <button onClick={() => { navigator.clipboard?.writeText(String(dmAsset.dmUrl)).then(() => toast.success('주소를 복사했습니다.')).catch(() => {}); }} className="shrink-0 text-gray-500 hover:text-gray-800">복사</button>
                            </div>
                          )}
                          {previewUrl && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="shrink-0 text-gray-400 w-16">공개 샘플</span>
                              <a href={previewUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-blue-600 hover:underline">{previewUrl}</a>
                              <button onClick={() => { navigator.clipboard?.writeText(previewUrl).then(() => toast.success('주소를 복사했습니다.')).catch(() => {}); }} className="shrink-0 text-gray-500 hover:text-gray-800">복사</button>
                            </div>
                          )}
                          {(stage === 'ready' || stage === 'sent') && dmAsset?.recipe && (
                            <button onClick={promoteRecipe} disabled={busy} className={`${smallBtn} mt-1`}><Upload className="w-3.5 h-3.5" /> 이 건의 레시피를 학습에 올리기</button>
                          )}
                        </div>
                      )}
                      {/* 검수 메일 — 우리 담당자에게 먼저(허용 도메인만) */}
                      <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4 space-y-2">
                        <h4 className="text-xs font-semibold text-gray-500 flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> 검수 메일 보내기</h4>
                        <p className="text-[11px] text-gray-400">발송본과 같은 메일을 담당자에게 먼저 보내 확인받습니다{testDomains.length ? ` (${testDomains.map((d) => '@' + d).join(', ')} 주소만)` : ''}. 발송 상태는 바뀌지 않습니다.</p>
                        <div className="flex items-center gap-2">
                          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={testDomains[0] ? `이름@${testDomains[0]}` : '담당자 이메일'}
                            onKeyDown={(e) => { if (e.key === 'Enter') sendTest(); }}
                            className="flex-1 min-w-0 px-2.5 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500" />
                          <button onClick={sendTest} disabled={busy || !testTo.trim() || !emailAsset?.html}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-xs disabled:opacity-40">보내기</button>
                        </div>
                        {testSends.length > 0 && (
                          <ul className="text-[11px] text-gray-500 space-y-0.5">
                            {testSends.map((t, i) => <li key={i}>{fmtDateTime(t.at)} · {t.to} · {t.outcome === 'sent' ? '도착' : t.outcome === 'rejected' ? '거부' : '미확인'}</li>)}
                          </ul>
                        )}
                      </div>

                      <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4 space-y-2">
                        {stage === 'ready' && (
                          <>
                            <button onClick={sendMail} disabled={busy || !!sendLock?.locked}
                              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                              <Send className="w-4 h-4" /> 자사 메일로 보내기
                            </button>
                            {sendLock?.locked && (
                              <div className="text-xs text-amber-700 space-y-1">
                                {sendLock.reasons.map((r) => (
                                  <div key={r} className="flex items-center justify-between gap-2 flex-wrap">
                                    <span>{SEND_LOCK_LABEL[r] || r}</span>
                                    {r === 'UNSUB_NOT_APPLIED' && <button onClick={rebuildEmail} disabled={busy} className="text-blue-600 hover:underline">메일 재조립</button>}
                                    {r === 'PLACEHOLDER_REMAINS' && <button onClick={() => { setReviewTab('copy'); setCopyEditing(true); }} className="text-blue-600 hover:underline">문안 수정</button>}
                                    {r === 'MATERIAL_THIN' && <button onClick={overrideMaterialGate} disabled={busy} className="text-blue-600 hover:underline">확인했으니 해제</button>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {job.mail_result && job.mail_result !== 'sent' && (
                              <p className="text-xs text-amber-600">직전 발송이 확인되지 않았습니다({job.mail_result === 'rejected' ? '수신 거부' : job.mail_result === 'sending' ? '진행 중' : '결과 미확인'}). 다시 시도할 수 있습니다.</p>
                            )}
                          </>
                        )}
                        {stage === 'sent' && (
                          <>
                            <div className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                              <Check className="w-4 h-4" /> 발송됨{job.mail_sent_at ? ` · ${fmtDateTime(job.mail_sent_at)}` : ''}
                            </div>
                            {!job.mail_confirmed_at && (
                              <button onClick={async () => { const r = await callAction(`/api/sales-outreach/jobs/${job.id}/mail-confirmed`); if (r.ok) { toast.success('수신 확인을 기록했습니다.'); await loadJob(job.id); } }}
                                disabled={busy}
                                className="w-full px-4 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                                수신함에서 확인했습니다
                              </button>
                            )}
                            {!job.forwarded_at && (
                              <button onClick={async () => { const r = await callAction(`/api/sales-outreach/jobs/${job.id}/forwarded`); if (r.ok) { toast.success('업체 전달을 기록했습니다.'); await loadJob(job.id); } }}
                                disabled={busy}
                                className="w-full px-4 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                                업체에 전달했습니다
                              </button>
                            )}
                            {job.forwarded_at && <p className="text-xs text-gray-400">업체 전달 표시됨 · 공개 샘플 기간이 연장되었습니다.</p>}
                          </>
                        )}
                        <button onClick={() => { setJob(null); setLastSummary(job); setCompanyName(''); setHomepageUrl(''); setIndustryCode(''); setExtraNotes(''); resetInputState(); }}
                          className="w-full px-4 py-2 rounded-lg border border-blue-200 text-sm text-blue-600 hover:bg-blue-50">
                          새 업체 시작
                        </button>
                        {/* ★ 2026-09-06 S4 삭제 액션 1개(sent 허용 · 링크 닫고 삭제 · 서버 파기 숫자) */}
                        <button onClick={deleteJob} disabled={busy}
                          className="w-full px-4 py-2 rounded-lg border border-rose-200 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40 flex items-center justify-center gap-1.5">
                          <Trash2 className="w-4 h-4" /> 이 건 삭제
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>,
    document.body,
  );
}
