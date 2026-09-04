// components/email/EmailVisualEditor.tsx
// 이메일 비주얼 에디터 — 블록(Section[])을 비주얼로 편집 + 이미지 업로드 + 실시간 미리보기 + AI 생성 + 저장.
// DM 섹션 편집기(SectionPropsEditor)·이미지 업로더(ImageUploader 내장)·헬퍼를 차용(props 기반이라 스토어 불요).
// 렌더는 백엔드 단일 진실원(POST /api/email/render-preview). 다크 + violet 톤.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown, ArrowUp, Copy, Eye, GripVertical, Loader2, Monitor, Palette, Plus, Save, Sparkles, Trash2, Type, Wand2, X,
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SectionPropsEditor from '../dm/panels/SectionPropsEditor';
// ★ 2026-07-02 완성(50크레딧) 사전 고지 — 환불 없는 돈이라 확인 모달 의무
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
// ★ 2026-07-13 디자인 3.0 — 테마 8종 1클릭 + 구도/배경면 픽커 + 프리헤더 (캠페인 단위 design)
import EmailDesignThemeModal from './EmailDesignThemeModal';
// ★ 2026-08-27 서체 지정(임은지 접수) — DM_FONT_CATALOG 단일 소스 · 캠페인 design만 패치
import EmailFontModal from './EmailFontModal';
import {
  EMAIL_TREATMENT_OPTIONS, EMAIL_BACKGROUND_OPTIONS, emailMotifLabel, type EmailDesign,
} from '../../utils/email-themes';
import {
  createSection, normalizeOrder, resequence, moveWithin, SECTION_META, type Section,
} from '../../utils/dm-section-defaults';
import type { SectionType } from '../../utils/dm-section-defaults';

// 이메일에서 렌더 가능한 블록(백엔드 EMAIL_BLOCK_WHITELIST 미러 — 추가 메뉴용).
const EMAIL_BLOCK_TYPES: SectionType[] = [
  'header', 'hero', 'text_card', 'product_carousel', 'gallery',
  'coupon', 'promo_code', 'cta', 'store_info', 'sns', 'reviews', 'footer',
];

// ★ 2026-07-12 블록 스타일 공통 컨트롤 — 렌더러가 실제 소비하는 타입에만 노출(죽은 컨트롤 금지, LESSONS_FRONTEND 07-10).
//   정렬 = 백엔드 EMAIL_ALIGN_AWARE 미러(section.align → props.align 주입 대상).
//   강조색 = 이메일 렌더러가 primary 파생(버튼·쿠폰·태그·코드·SNS칩·카운트다운·상품 할인가·웹사이트 링크)을 쓰는 타입.
const EMAIL_ALIGN_AWARE = new Set<SectionType>(['hero', 'header', 'text_card']);
const EMAIL_ACCENT_AWARE = new Set<SectionType>([
  'text_card', 'cta', 'coupon', 'promo_code', 'sns', 'store_info', 'product_carousel',
]);
// ★ 2026-07-13 배경면(리듬) 노출 대상 — 렌더러가 밴드 래핑을 소비하는 본문 타입만(죽은 컨트롤 금지)
const EMAIL_BAND_AWARE = new Set<SectionType>([
  'text_card', 'cta', 'coupon', 'promo_code', 'product_carousel', 'reviews',
]);
// ★ 2026-09-04 포인트 장식(모티프) 노출 대상 — 렌더러 motifHtml을 실제로 그리는 타입만(죽은 컨트롤 금지).
//   백엔드 EMAIL_MOTIF_SECTIONS 미러 · 계약 = email/__tests__/email-editor-parity.test.ts
const EMAIL_MOTIF_AWARE = new Set<SectionType>(['hero', 'text_card']);

/** ★ 2026-08-27 미리보기 PC 폭 — 발송 셸의 모바일 분기(@media max-width:600px)보다 넓게 잡아
 *  데스크탑 레이아웃(분할 구도의 2열 등)이 확실히 걸리게 한다. */
const PREVIEW_PC_WIDTH = 680;
/** 패널 실폭(360px 컨테이너에서 좌측 보더 1px 제외) 대비 축소율 — 가로 스크롤 없이 전체가 보인다. */
const PREVIEW_PC_SCALE = 359 / PREVIEW_PC_WIDTH;

// 개인화 변수(Liquid 토큰) — ★ 2026-07-02 Harold 지시: 하드코딩이 아니라 회사 실데이터 필드만 노출.
//   실제 목록은 GET /api/email/personalization-vars (CT-58 실측 프로필 — 데이터 70%+ 채워진 필드)에서 로드.
//   아래는 조회 실패 시에만 쓰는 fallback (편집 중단 0).
interface EmailVar { field: string; token: string; label: string }
const DEFAULT_EMAIL_VARS: EmailVar[] = [
  { field: 'name', token: '{{ customer.name }}', label: '회원명' },
  { field: 'grade', token: '{{ customer.grade }}', label: '등급' },
  { field: 'points', token: '{{ customer.points }}', label: '포인트' },
  { field: 'region', token: '{{ customer.region }}', label: '지역' },
  { field: 'recent_purchase_store', token: '{{ customer.recent_purchase_store }}', label: '최근 매장' },
  { field: 'total_purchase_amount', token: '{{ customer.total_purchase_amount }}', label: 'LTV' },
  { field: 'purchase_count', token: '{{ customer.purchase_count }}', label: '구매 횟수' },
];

export interface EmailVisualEditorProps {
  initialSections: Section[];
  initialName?: string;
  initialSubject?: string;
  initialIsAd?: boolean;
  /** ★ 2026-07-13 캠페인 단위 디자인(테마·아트디렉션·프리헤더) — 저장·미리보기 동승 */
  initialDesign?: EmailDesign | null;
  aiGenerated?: boolean;
  campaignId?: string;
  /** ★ 2026-07-02 완성(50크레딧 납부) 여부 — true면 발송 해금 + 저장 무료 (PC 미리보기는 항상 허용) */
  completed?: boolean;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export default function EmailVisualEditor({
  initialSections, initialName, initialSubject, initialIsAd, initialDesign, aiGenerated,
  campaignId, completed, authHeaders, onClose, onSaved, onToast,
}: EmailVisualEditorProps) {
  const [sections, setSections] = useState<Section[]>(() => normalizeOrder(initialSections || []));
  const [selectedId, setSelectedId] = useState<string | null>(initialSections?.[0]?.id || null);
  const [name, setName] = useState(initialName || 'AI 비주얼 이메일');
  const [subject, setSubject] = useState(initialSubject || '');
  const [isAd, setIsAd] = useState(initialIsAd ?? true);
  const [addOpen, setAddOpen] = useState(false);
  // ★ 2026-07-13 디자인 3.0 — 캠페인 단위 design (테마 1클릭·프리헤더·구도/배경은 섹션 필드)
  const [design, setDesign] = useState<EmailDesign | null>(initialDesign ?? null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);

  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  // ★ 2026-08-26 미리보기 스크롤 보존(임은지 접수 cmt9ggaj301vajnotaks523h7) — 편집할 때마다 srcDoc이
  //   바뀌면서 iframe이 문서를 새로 만들어 스크롤이 항상 맨 위로 갔다. 하단 블록을 고치는 내내 다시
  //   내려야 했던 원인. srcDoc iframe은 부모와 같은 출처라 위치를 읽고 되돌릴 수 있다.
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewScrollY = useRef(0);
  // ★ 2026-08-27 미리보기 폭 토글(임은지 접수 cmtb65jft02y5jnot96pjwvjo) — 패널이 360px 고정이라
  //   발송 HTML의 @media (max-width:600px)가 **항상** 걸려 모바일 레이아웃만 보였다. 라벨은 "실제 발송 HTML"이라
  //   사용자는 그게 발송 모습이라고 믿는다. 기본값은 현행(모바일)이라 회귀 0.
  const [previewWidth, setPreviewWidth] = useState<'mobile' | 'pc'>('mobile');
  const handlePreviewLoad = () => {
    const win = previewFrameRef.current?.contentWindow;
    if (!win) return;
    try {
      if (previewScrollY.current > 0) win.scrollTo(0, previewScrollY.current);
      // 문서가 매번 새로 생기므로 리스너도 그 문서와 함께 사라진다(중복 누적 없음).
      win.addEventListener('scroll', () => { previewScrollY.current = win.scrollY; }, { passive: true });
    } catch {
      // 접근 불가 환경 = 복원 생략(옛 동작 그대로). 미리보기가 깨지지는 않는다.
    }
  };
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  // ★ 2026-07-14 Harold 지시 — 행사·상품 정보 붙여넣기 → 상품 카드 자동 구성 + 내용 재창조
  //   (백엔드 기존 파이프: 상품 추출→가격·URL verbatim 검증→og:image 채움. 기재 혜택만 원문 그대로)
  const [aiEventText, setAiEventText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [improving, setImproving] = useState(false);
  const [pcPreviewOpen, setPcPreviewOpen] = useState(false);
  // 개인화 미리보기 — 샘플 고객(VIP/일반/신규) 토글
  const [previewSample, setPreviewSample] = useState<'none' | 'VIP' | '일반' | '신규'>('none');
  const [sampleCustomers, setSampleCustomers] = useState<Array<{ label: string; customer: Record<string, any> }>>([]);
  // ★ 2026-07-02 개인화 변수 — 회사 실데이터 필드(CT-58)만 노출. 조회 실패 시 fallback.
  const [emailVars, setEmailVars] = useState<EmailVar[]>(DEFAULT_EMAIL_VARS);
  // ★ 2026-07-02 완성(50크레딧) 상태 — 미완성 = 발송 잠금 (임시저장은 무료·무제한, PC 미리보기는 항상 허용)
  const [completedState, setCompletedState] = useState(!!completed);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    fetch('/api/email/personalization-vars', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.vars) && d.vars.length > 0) setEmailVars(d.vars);
      })
      .catch(() => { /* fallback 목록 유지 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-08-28 ESC 닫기(임은지 접수 cmtcic3gr03wdjnotwmk8ofk0) — 닫기 버튼이 헤더 밖으로 밀려 잘리면
  //   화면을 닫을 방법이 아예 없어 새로고침·뒤로가기를 눌러야 했다. 버튼 폭은 헤더 구조로 고쳤고(아래),
  //   키보드 탈출구도 함께 둔다(다른 모달 20여 곳의 관례).
  //   편집기는 잃을 것이 많은 화면이라 두 가지를 막는다: ①한글 입력 조합 취소로 눌린 ESC(isComposing)
  //   ②편집 내용이 있는데 즉시 닫히는 것(있으면 커스텀 확인 모달로 되묻는다 · native dialog 금지).
  const initialSnapshotRef = useRef<string | null>(null);
  if (initialSnapshotRef.current === null) {
    initialSnapshotRef.current = JSON.stringify({ name, subject, isAd, sections, design });
  }
  const isDirty = () => JSON.stringify({ name, subject, isAd, sections, design }) !== initialSnapshotRef.current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      // 위에 열린 것이 있으면 그쪽이 먼저 닫힌다(자식 모달은 자기 ESC를 갖는다). 저장 중에는 무시.
      if (themeOpen || fontOpen || pcPreviewOpen || addOpen || confirmState || saving) return;
      if (!isDirty()) { onClose(); return; }
      setConfirmState({
        mode: 'warning',
        title: '편집 중인 내용이 있습니다',
        description: '저장하지 않고 닫으면 지금까지 편집한 내용이 사라집니다.',
        confirmLabel: '저장하지 않고 닫기',
        cancelLabel: '계속 편집',
        onConfirm: () => { onClose(); },
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeOpen, fontOpen, pcPreviewOpen, addOpen, confirmState, saving, name, subject, isAd, sections, design]);

  const selected = useMemo(() => sections.find((s) => s.id === selectedId) || null, [sections, selectedId]);

  // 변수 칩 삽입용 — 마지막으로 포커스된 입력칸 추적(공용 SectionPropsEditor 무수정).
  const lastFocusedField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const trackFieldFocus = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement) lastFocusedField.current = t;
    else if (t instanceof HTMLInputElement && ['text', 'email', 'url', 'search', ''].includes(t.type)) lastFocusedField.current = t;
  };

  // 변수 토큰을 커서 위치에 삽입(React onChange 발화 — 네이티브 setter + input 이벤트). 입력칸 없으면 클립보드 폴백.
  const insertVarToken = (token: string, label: string) => {
    const active = document.activeElement;
    let el: HTMLInputElement | HTMLTextAreaElement | null = null;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) el = active;
    else if (lastFocusedField.current && document.contains(lastFocusedField.current)) el = lastFocusedField.current;
    if (!el) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(token).then(
          () => onToast(`${label} 변수 복사됨. 입력칸에 붙여넣으세요`, 'info'),
          () => onToast('직접 입력해주세요: ' + token, 'warning'),
        );
      } else onToast('직접 입력해주세요: ' + token, 'info');
      return;
    }
    const target = el;
    const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + token + target.value.slice(end);
    if (setter) setter.call(target, next); else target.value = next;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + token.length;
    requestAnimationFrame(() => { try { target.focus(); target.setSelectionRange(caret, caret); } catch { /* 일부 input type은 캐럿 설정 미지원 */ } });
  };

  // ── 실시간 미리보기 (debounce 500ms, 백엔드 렌더러 단일 진실원) ──
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const sample = previewSample !== 'none' ? sampleCustomers.find((c) => c.label === previewSample)?.customer : null;
        const res = await fetch('/api/email/render-preview', {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ sections, design: design || undefined, sampleCustomer: sample || undefined }),
        });
        const data = await res.json();
        if (data.success) setPreviewHtml(data.html || '');
      } catch { /* 미리보기 실패는 다음 변경 때 재시도 */ }
      finally { setPreviewLoading(false); }
    }, 500);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, previewSample, design]);

  // 미리보기 샘플 고객 로드 (VIP/일반/신규) — 개인화 미리보기 토글용
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email/preview-customers', { headers: authHeaders() });
        const data = await res.json();
        if (data.success && Array.isArray(data.customers)) {
          setSampleCustomers(data.customers.map((c: any) => ({ label: String(c.label), customer: c.customer || {} })));
        }
      } catch { /* 샘플 고객 실패는 '변수 그대로' 폴백 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 블록 조작 ──
  const updateSelected = (patch: Record<string, any>) => {
    if (!selectedId) return;
    setSections((prev) => prev.map((s) => {
      if (s.id !== selectedId) return s;
      let next = { ...s, props: { ...(s.props as any), ...patch } } as Section;
      // ★ 2026-07-13 DM 교훈(타이포 구도 함정) — 이미지 미사용 구도에 이미지가 들어오면 기본 구도로 자동 전환
      //   (안 그러면 업로드해도 화면에 안 나와 "안 된다" 신고가 된다)
      if (typeof patch.image_url === 'string' && patch.image_url.trim() && s.type === 'hero' && (s as any).treatment === 'typographic') {
        next = { ...next, treatment: 'classic' } as Section;
      }
      return next;
    }));
  };

  // 섹션 최상위 필드(display_condition 등) 갱신 — props가 아닌 Section 레벨
  const updateSelectedSection = (patch: Partial<Section>) => {
    if (!selectedId) return;
    setSections((prev) => prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  };

  const addBlock = (type: SectionType) => {
    setAddOpen(false);
    setSections((prev) => {
      const next = normalizeOrder([...prev, createSection(type, prev.length)]);
      const added = next[next.length - 1];
      setSelectedId(added.id);
      return next;
    });
  };

  // 화살표 이동도 드래그와 **같은 함수**(moveWithin)를 쓴다 — 이동 로직이 두 벌이면 한쪽만 고쳐진다.
  // ⛔ 인덱스는 setSections 안에서 최신 상태로 구한다. 밖에서 구하면 연속 클릭 때 두 번째가 옛 순서를 본다.
  const moveBlock = (id: string, dir: -1 | 1) => {
    setSections((prev) => {
      const arr = prev.slice().sort((a, b) => a.order - b.order);
      const from = arr.findIndex((s) => s.id === id);
      if (from < 0) return prev;
      return moveWithin(arr, from, from + dir); // 경계(맨 위·맨 아래)는 moveWithin이 판정한다
    });
  };

  const deleteBlock = (id: string) => {
    setSections((prev) => normalizeOrder(prev.filter((s) => s.id !== id)));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // 드래그앤드롭 순서 변경 (@dnd-kit — DM SectionList과 동일 패턴, 라이브러리 추가 0)
  // ⛔ 옮긴 뒤에는 `resequence`다(★2026-08-25 접수 임은지). `normalizeOrder`는 옛 order로 다시 정렬해
  //   방금 한 이동을 그대로 되돌린다 — 드래그도 화살표도 안 먹던 원인이 이 한 줄이었다.
  const reorder = (from: number, to: number) => {
    setSections((prev) => moveWithin(prev, from, to));
  };

  const duplicateBlock = (id: string) => {
    setSections((prev) => {
      const arr = prev.slice().sort((a, b) => a.order - b.order);
      const i = arr.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const copy: Section = JSON.parse(JSON.stringify(arr[i]));
      copy.id = 'dup-' + Date.now() + '-' + copy.type;
      arr.splice(i + 1, 0, copy);
      // 복사본은 원본과 order가 같다 — 정렬에 기대지 않고 끼워 넣은 자리 그대로 번호를 다시 매긴다
      const next = resequence(arr);
      setSelectedId(copy.id);
      return next;
    });
  };

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const arr = sections.slice().sort((a, b) => a.order - b.order);
    const from = arr.findIndex((s) => s.id === String(active.id));
    const to = arr.findIndex((s) => s.id === String(over.id));
    reorder(from, to);
  };

  // ── AI 생성 (전체 블록 교체) ──
  const handleAi = async () => {
    // ★ 2026-07-14 — 행사·상품 정보 단독 입력도 생성 가능(백엔드 기지원). 프롬프트/행사문 둘 다 비면 안내.
    if (aiBusy) return;
    if (!aiPrompt.trim() && !aiEventText.trim()) { onToast('만들고 싶은 이메일 한 줄 또는 행사·상품 정보를 넣어주세요.', 'warning'); return; }
    setAiBusy(true);
    try {
      const res = await fetch('/api/email/ai/generate-sections', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({
          prompt: aiPrompt.trim(), is_ad: isAd,
          ...(aiEventText.trim() ? { event_text: aiEventText.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success && data.data) {
        const g = data.data;
        setSections(normalizeOrder(g.sections || []));
        setSelectedId(g.sections?.[0]?.id || null);
        if (!name || name === 'AI 비주얼 이메일') setName(g.name || name);
        if (!subject) setSubject((g.subjects && g.subjects[0]) || '');
        // ★ 2026-07-13 — AI 프리헤더 회생(옛 흐름은 버렸음). 테마 등 기존 design은 보존.
        if (g.preheader) setDesign((d) => ({ ...(d || {}), preheader: String(g.preheader).slice(0, 90) }));
        setAiPrompt('');
        onToast(
          aiEventText.trim()
            ? 'AI가 행사·상품 정보로 이메일을 만들었어요. 상품 카드·가격·링크는 넣어주신 원문 기준입니다. (3 크레딧)'
            : 'AI가 비주얼 이메일을 만들었어요. 이미지를 채우고 다듬어주세요. (3 크레딧)',
          'success',
        );
      } else {
        onToast(data.error || 'AI 생성 실패', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || 'AI 생성 중 오류', 'error');
    } finally {
      setAiBusy(false);
    }
  };

  // ── 1클릭 AI 개선 (블록 카피만 다듬기, 1크레딧 — 사실·혜택·변수 보존) ──
  const handleImprove = async () => {
    if (improving) return;
    if (sections.length === 0) { onToast('먼저 블록을 추가하거나 AI로 만들어주세요.', 'warning'); return; }
    setImproving(true);
    try {
      const res = await fetch('/api/email/ai/refine-sections', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ sections }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success && Array.isArray(data.data?.sections)) {
        setSections(normalizeOrder(data.data.sections));
        onToast(data.changed === false ? '다듬을 텍스트가 없어요.' : 'AI가 카피를 다듬었어요. (1 크레딧)', data.changed === false ? 'info' : 'success');
      } else {
        onToast(data.error || 'AI 개선 실패', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || 'AI 개선 중 오류', 'error');
    } finally {
      setImproving(false);
    }
  };

  // ── 저장 (sections → 백엔드가 html_body 렌더) ──
  //   ★ 2026-07-02 Harold 확정 크레딧 모델: 임시저장 = 무료·무제한(발송 잠금) /
  //   완성 저장 = 50크레딧 1회(확인 모달 고지 후) → 발송 해금. 발송 자체는 무료(고객 SMTP).
  //   ★ 2026-07-02(3) Harold 지시 — PC 미리보기는 편집 중에도 항상 허용(잠금은 발송에만).
  const persistCampaign = async (): Promise<string | null> => {
    if (!name.trim() || !subject.trim()) { onToast('이름과 제목을 입력해주세요.', 'warning'); return null; }
    if (sections.length === 0) { onToast('블록을 1개 이상 추가해주세요.', 'warning'); return null; }
    const isUpdate = !!campaignId;
    const url = isUpdate ? `/api/email/campaigns/${campaignId}` : '/api/email/campaigns';
    // ★ 2026-07-13 — design(테마·아트디렉션·프리헤더) 동승 규약 (Codex 4R):
    //   값 있음 = 저장 / 원래 있었는데 사용자가 비움(기본 룩) = null로 명시 초기화 /
    //   처음부터 없음 = key 자체 생략(무변경 저장이 design 컬럼·타 클라이언트 테마에 무영향).
    const body: any = { name: name.trim(), subject: subject.trim(), is_ad: isAd, sections };
    if (design) body.design = design;
    else if (initialDesign) body.design = null;
    if (!isUpdate && aiGenerated) body.ai_generated = true;
    const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.success) { onToast(data.error || '저장 실패', 'error'); return null; }
    return String(campaignId || data.campaign?.id || '') || null;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const savedId = await persistCampaign();
      if (savedId) {
        onToast(
          completedState
            ? '저장 완료'
            : '임시저장 완료. 발송은 완성 저장(50크레딧) 후 열립니다.',
          'success',
        );
        onSaved();
        onClose();
      }
    } catch (e: any) {
      onToast(e?.message || '저장 중 오류', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = () => {
    if (!name.trim() || !subject.trim()) { onToast('이름과 제목을 입력해주세요.', 'warning'); return; }
    if (sections.length === 0) { onToast('블록을 1개 이상 추가해주세요.', 'warning'); return; }
    setConfirmState({
      mode: 'warning',
      title: '캠페인 완성 (50크레딧)',
      description: '완성 저장 시 50크레딧이 차감됩니다 (캠페인당 1회 · 환불 없음).\n이후 이 캠페인의 수정·재저장·발송·수신/오픈/클릭 이력 관리는 추가 차감 없이 무제한입니다.',
      confirmLabel: '50크레딧 차감하고 완성',
      cancelLabel: '취소',
      onConfirm: async () => {
        setSaving(true);
        try {
          const savedId = await persistCampaign();
          if (!savedId) return;
          const res = await fetch(`/api/email/campaigns/${savedId}/complete`, { method: 'POST', headers: authHeaders() });
          const data = await res.json();
          if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 완성해주세요.', 'warning'); return; }
          if (!data.success) { onToast(data.error || '완성 처리 실패', 'error'); return; }
          setCompletedState(true);
          onToast('캠페인 완성. 이제 발송할 수 있습니다.', 'success');
          onSaved();
          onClose();
        } catch (e: any) {
          onToast(e?.message || '완성 처리 중 오류', 'error');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const ordered = useMemo(() => sections.slice().sort((a, b) => a.order - b.order), [sections]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* 헤더 — ★ 2026-08-28 닫기 버튼 유실 정정(임은지 접수 cmtcic3gr03wdjnotwmk8ofk0).
            [근본] 버튼이 전부 shrink-0인데 입력 두 개에 min-w-0이 없었다. flex 아이템의 min-width 기본값이
            auto라 input은 자기 콘텐츠 폭 아래로 줄지 않는다 = 툴바 총 폭이 모달(max-w-6xl)을 넘고,
            부모의 overflow-hidden에 마지막 자식인 닫기 버튼부터 잘렸다. 완성 저장을 마친 캠페인은
            버튼이 [임시저장]+[완성 저장 · 50] 둘에서 [저장] 하나로 줄어 폭이 남아 닫기가 보였다(접수자 관찰과 일치).
            [구조] 좌측 입력 묶음 = flex-1 min-w-0(줄어드는 쪽) / 우측 액션 묶음 = shrink-0(줄지 않는 쪽).
            이제 폭이 모자라면 제목 칸이 줄지 닫기 버튼이 밀려나지 않는다. 라벨은 lg 미만에서 접어 폭을 번다. */}
        <div className="flex items-center gap-2 px-4 md:px-5 py-3 border-b border-white/10 bg-slate-900/80">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <input
              value={name} onChange={(e) => setName(e.target.value)} placeholder="캠페인 이름"
              className="bg-transparent text-sm font-semibold text-white border-b border-white/10 focus:border-violet-400 focus:outline-none px-1 py-0.5 w-40 min-w-0"
            />
            <input
              value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="이메일 제목"
              className="flex-1 min-w-0 bg-transparent text-sm text-white/90 border-b border-white/10 focus:border-violet-400 focus:outline-none px-1 py-0.5"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer shrink-0">
              <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="rounded" />광고성
            </label>
            <button
              onClick={() => setThemeOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 shrink-0"
              title="디자인 테마 8종: 색·서체·조판을 1클릭으로 바꿉니다 (문안은 그대로)"
            >
              <Palette className="w-4 h-4" /><span className="hidden lg:inline">테마</span>
            </button>
            {/* ★ 2026-08-27 서체 지정(임은지 접수) — DM 퀵바 [서체]와 같은 자리를 이메일에도. 렌더러는 이미 읽고 있었다. */}
            <button
              type="button"
              onClick={() => setFontOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 shrink-0"
              title="이 캠페인 전체 글꼴을 바꿉니다 (문안은 그대로)"
            >
              <Type className="w-4 h-4" /><span className="hidden lg:inline">서체</span>
            </button>
            <button
              onClick={() => setPcPreviewOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 shrink-0"
              title="PC(데스크탑) 폭으로 크게 미리보기"
            >
              {/* ★ 2026-07-02(3) Harold 지시 — PC 미리보기는 편집 중(완성 전)에도 항상 사용. 잠금은 발송에만 유지 */}
              <Monitor className="w-4 h-4" /><span className="hidden lg:inline">PC 미리보기</span>
            </button>
            <button onClick={handleImprove} disabled={improving || sections.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/15 px-3 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-40 shrink-0" title="AI가 블록 카피를 매끄럽게 다듬어요 (1 크레딧 · 사실·혜택 보존)">
              {improving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}<span className="hidden lg:inline">AI로 개선</span>
            </button>
            {completedState ? (
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 shrink-0">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}저장
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50 shrink-0" title="무료 (발송은 잠긴 상태로 보관됩니다)">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}<span className="hidden lg:inline">임시저장</span>
                </button>
                <button onClick={handleComplete} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 shrink-0" title="50크레딧 1회, 이후 수정·발송·이력 무제한 무료">
                  <Save className="w-4 h-4" />완성 저장 · 50
                </button>
              </>
            )}
            <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 shrink-0" aria-label="닫기" title="닫기 (ESC)"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 좌: 블록 리스트 + 추가 + AI */}
          <div className="w-60 shrink-0 border-r border-white/10 flex flex-col bg-slate-900/60">
            {/* ★ 2026-07-13 프리헤더 — 수신함에서 제목 옆에 보이는 미리보기 문구 (비우면 본문 첫 문장 자동) */}
            <div className="p-3 border-b border-white/10 space-y-1.5">
              <div className="text-[11px] font-semibold text-white/60">프리헤더 · 수신함 미리보기</div>
              <input
                value={design?.preheader || ''}
                maxLength={90}
                onChange={(e) => {
                  const v = e.target.value;
                  setDesign((d) => {
                    const next: EmailDesign = { ...(d || {}) };
                    if (v.trim()) next.preheader = v;
                    else delete next.preheader;
                    return Object.keys(next).length > 0 ? next : null;
                  });
                }}
                placeholder="비우면 본문 첫 문장이 자동 표시"
                className="w-full text-xs bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
              />
            </div>
            <div className="p-3 border-b border-white/10 space-y-2">
              <div className="text-[11px] font-semibold text-white/60">AI로 만들기</div>
              <textarea
                value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2}
                placeholder="예: 여름 신상 안내, VIP에게 정중한 톤"
                className="w-full text-xs bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50 resize-none"
              />
              {/* ★ 2026-07-14 Harold 지시 — 행사·상품 정보 붙여넣기 = 상품 카드(가격·링크·이미지) 자동 구성 + 내용 재창조 */}
              <textarea
                value={aiEventText} onChange={(e) => setAiEventText(e.target.value)} rows={5}
                placeholder={'행사·상품 정보 붙여넣기 (선택)\n예)\n글로우 파운데이션 30ml\n85,000원 → 15% 72,250원\nhttps://store.example.com/products/123\n\n행사 문구·기간도 함께 넣으면 내용에 반영돼요'}
                className="w-full text-xs bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50 resize-none"
              />
              <button onClick={handleAi} disabled={aiBusy || (!aiPrompt.trim() && !aiEventText.trim())} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}{aiBusy ? '생성 중...' : 'AI 생성 (3크레딧)'}
              </button>
              <div className="text-[10px] text-white/35 leading-relaxed">상품 이름·가격·링크를 넣으면 상품 카드가 자동으로 만들어져요. 가격·혜택은 넣어주신 원문 그대로만 사용됩니다.</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {ordered.map((s, i) => (
                      <SortableBlockRow
                        key={s.id}
                        section={s}
                        selected={selectedId === s.id}
                        isFirst={i === 0}
                        isLast={i === ordered.length - 1}
                        onSelect={() => setSelectedId(s.id)}
                        onUp={() => moveBlock(s.id, -1)}
                        onDown={() => moveBlock(s.id, 1)}
                        onDuplicate={() => duplicateBlock(s.id)}
                        onDelete={() => deleteBlock(s.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              {ordered.length === 0 && <div className="text-[11px] text-white/40 px-2 py-4 text-center">블록을 추가하거나 AI로 만들어보세요.</div>}
            </div>
            <div className="p-2 border-t border-white/10 relative">
              <button onClick={() => setAddOpen((v) => !v)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/5">
                <Plus className="w-3.5 h-3.5" />블록 추가
              </button>
              {addOpen && (
                <div className="absolute bottom-12 left-2 right-2 bg-slate-800 border border-white/15 rounded-xl shadow-2xl p-1.5 max-h-72 overflow-y-auto z-10">
                  {EMAIL_BLOCK_TYPES.map((t) => (
                    <button key={t} onClick={() => addBlock(t)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/80 hover:bg-violet-500/20 text-left">
                      <span>{SECTION_META[t]?.icon || '▫️'}</span><span>{SECTION_META[t]?.label || t}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 중: 선택 블록 속성 편집 (DM 섹션 편집기 차용) */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 bg-slate-950/40">
            {selected ? (
              <div className="max-w-md mx-auto">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">{SECTION_META[selected.type]?.icon}</span>
                  <span className="text-sm font-semibold text-white">{SECTION_META[selected.type]?.label} 편집</span>
                </div>
                {/* ★ 2026-07-12 블록 스타일 — 정렬(렌더러 소비 타입만) + 강조색(primary 파생 소비 타입만)
                    ★ 2026-07-13 — 구도(EMAIL_TREATMENT_OPTIONS 타입만) + 배경면(EMAIL_BAND_AWARE 타입만) */}
                {(EMAIL_ALIGN_AWARE.has(selected.type) || EMAIL_ACCENT_AWARE.has(selected.type)
                  || !!EMAIL_TREATMENT_OPTIONS[selected.type] || EMAIL_BAND_AWARE.has(selected.type)
                  || EMAIL_MOTIF_AWARE.has(selected.type)) && (
                  <div className="mb-4 pb-4 border-b border-white/10 space-y-2.5">
                    <div className="text-[11px] font-semibold text-white/60">블록 스타일</div>
                    {EMAIL_TREATMENT_OPTIONS[selected.type] && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-white/60 shrink-0">구도</span>
                        <select
                          value={(selected as any).treatment || 'classic'}
                          onChange={(e) => updateSelectedSection({ treatment: e.target.value } as Partial<Section>)}
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-1.5 py-1 text-white max-w-[170px]"
                        >
                          {EMAIL_TREATMENT_OPTIONS[selected.type].map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {/* ★ 2026-08-27 분할 구도 안내(임은지 접수) — "글자가 이미지 오른쪽으로 빠졌다"는 설정 실수가
                        아니라 이 구도의 정의다. 고르는 자리에서 알려 준다. */}
                    {selected.type === 'hero' && (selected as any).treatment === 'split' && (
                      <div className="text-[10px] leading-relaxed text-amber-300/80">
                        분할 구도는 넓은 화면에서 이미지가 왼쪽, 글자가 오른쪽으로 나갑니다. 좁은 화면에서만 위아래로 쌓입니다. 오른쪽 미리보기에서 PC 폭으로 확인하세요.
                      </div>
                    )}
                    {EMAIL_BAND_AWARE.has(selected.type) && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-white/60 shrink-0">배경면</span>
                        <select
                          value={(selected as any).background || 'none'}
                          onChange={(e) => updateSelectedSection({ background: (e.target.value === 'none' ? undefined : e.target.value) } as Partial<Section>)}
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-1.5 py-1 text-white max-w-[170px]"
                        >
                          {EMAIL_BACKGROUND_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {/* ★ 2026-07-13 헤드라인 강조(마커펜/밑줄) — 렌더러 emphasizeHead 소비 타입만 */}
                    {(selected.type === 'hero' || selected.type === 'text_card') && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/60">헤드라인 강조</span>
                        <div className="flex gap-1">
                          {([['', '없음'], ['marker', '마커'], ['underline', '밑줄']] as const).map(([v, lbl]) => (
                            <button
                              key={v || 'none'}
                              type="button"
                              onClick={() => updateSelected({ headline_emphasis: v || undefined })}
                              className={`px-2 h-7 text-[11px] rounded-lg border transition-colors ${
                                ((selected.props as any)?.headline_emphasis || '') === v
                                  ? 'bg-violet-500/40 border-violet-400/60 text-white font-bold'
                                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* ★ 2026-09-04 포인트 장식(남지현 접수) — 테마가 붙이는 제목 위 표식을 이 블록만 끈다.
                        "자동"은 테마를 따른다(기존 캠페인 무변화). 지금 무엇이 붙는지 옆에 밝혀 둔다 —
                        접수 원문이 "자동으로 숫자가 붙는데 제거 불가"였고, 정체를 모르면 끌 생각도 못 한다. */}
                    {EMAIL_MOTIF_AWARE.has(selected.type) && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-white/60 shrink-0">
                          포인트 장식
                          <span className="text-white/35 ml-1">(테마: {emailMotifLabel(design?.art_direction?.accentMotif)})</span>
                        </span>
                        <div className="flex gap-1 shrink-0">
                          {([['', '자동'], ['none', '숨김']] as const).map(([v, lbl]) => (
                            <button
                              key={v || 'auto'}
                              type="button"
                              onClick={() => updateSelectedSection({ motif: (v || undefined) as Section['motif'] })}
                              className={`px-2.5 h-7 text-[11px] rounded-lg border transition-colors ${
                                (selected.motif || '') === v
                                  ? 'bg-violet-500/40 border-violet-400/60 text-white font-bold'
                                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {EMAIL_ALIGN_AWARE.has(selected.type) && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/60">정렬</span>
                        <div className="flex gap-1">
                          {([['left', '좌'], ['center', '중'], ['right', '우']] as const).map(([a, lbl]) => (
                            <button
                              key={a}
                              type="button"
                              onClick={() => updateSelectedSection({ align: a })}
                              className={`w-9 h-7 text-[11px] rounded-lg border transition-colors ${
                                (selected.align || 'center') === a
                                  ? 'bg-violet-500/40 border-violet-400/60 text-white font-bold'
                                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {EMAIL_ACCENT_AWARE.has(selected.type) && (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/60">버튼·강조색</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={selected.accent_color || '#4f46e5'}
                            onChange={(e) => updateSelectedSection({ accent_color: e.target.value })}
                            className="w-9 h-7 p-0 rounded-lg border border-white/15 bg-transparent cursor-pointer"
                            aria-label="강조색 선택"
                          />
                          {selected.accent_color && (
                            <button
                              type="button"
                              onClick={() => updateSelectedSection({ accent_color: undefined })}
                              className="text-[10px] text-white/50 hover:text-white underline"
                              title="직접 지정을 지우고 브랜드 색으로 돌아갑니다"
                            >
                              브랜드색
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="text-white" onFocus={trackFieldFocus}>
                  <SectionPropsEditor section={selected} onUpdate={updateSelected} />
                </div>

                {/* 개인화 — 변수 칩(편리한 삽입) + 조건부 표시(수신자별 맞춤) */}
                <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                  <div className="text-[11px] font-semibold text-white/60">개인화</div>
                  <div>
                    <div className="text-[10px] text-white/40 mb-1.5">입력칸을 클릭한 뒤 변수를 누르면 커서 위치에 삽입됩니다. 발송 시 수신자 정보로 자동 치환돼요.</div>
                    <div className="flex flex-wrap gap-1">
                      {emailVars.map((v) => (
                        <button
                          key={v.token}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertVarToken(v.token, v.label)}
                          className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-violet-500/20 hover:border-violet-400/40"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={!!selected.display_condition}
                        onChange={(e) => updateSelectedSection({ display_condition: e.target.checked ? { field: 'grade', op: 'eq', value: '' } : undefined })}
                        className="rounded"
                      />
                      특정 고객에게만 표시 (조건부)
                    </label>
                    {selected.display_condition && (
                      <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                        <select
                          value={selected.display_condition.field}
                          onChange={(e) => updateSelectedSection({ display_condition: { ...selected.display_condition!, field: e.target.value } })}
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-1.5 py-1 text-white"
                        >
                          {/* ★ 2026-07-02 조건 필드 = 회사 실데이터 변수 목록과 동일 소스 (이름은 조건 대상에서 제외) */}
                          {emailVars.filter((v) => v.field !== 'name').map((v) => <option key={v.field} value={v.field}>{v.label}</option>)}
                        </select>
                        <select
                          value={selected.display_condition.op}
                          onChange={(e) => updateSelectedSection({ display_condition: { ...selected.display_condition!, op: e.target.value as 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' } })}
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-1.5 py-1 text-white"
                        >
                          <option value="eq">같음</option>
                          <option value="ne">다름</option>
                          <option value="gte">이상</option>
                          <option value="lte">이하</option>
                          <option value="gt">초과</option>
                          <option value="lt">미만</option>
                          <option value="contains">포함</option>
                        </select>
                        <input
                          value={selected.display_condition.value}
                          onChange={(e) => updateSelectedSection({ display_condition: { ...selected.display_condition!, value: e.target.value } })}
                          placeholder="값 (예: VIP)"
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-white placeholder-white/30 w-24"
                        />
                      </div>
                    )}
                    <div className="text-[10px] text-white/30 mt-1.5">미리보기 오른쪽에서 VIP/일반/신규로 결과를 확인하세요.</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-white/40">왼쪽에서 블록을 선택하면 여기서 편집합니다.</div>
            )}
          </div>

          {/* 우: 실시간 미리보기 (백엔드 렌더 = 실제 발송 HTML) */}
          <div className="w-[360px] shrink-0 border-l border-white/10 flex flex-col bg-slate-900/60">
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 text-[11px] text-white/60">
              <Eye className="w-3.5 h-3.5" />미리보기 (실제 발송 HTML)
              {previewLoading && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
            </div>
            {sampleCustomers.length > 0 && (
              <div className="px-2 py-2 border-b border-white/10 flex flex-wrap gap-1">
                <button onClick={() => setPreviewSample('none')} className={`flex-1 min-w-[60px] text-[10px] px-1.5 py-1 rounded ${previewSample === 'none' ? 'bg-violet-500/30 border border-violet-400/40 text-white' : 'bg-slate-900/60 border border-white/10 text-white/50'}`}>변수 그대로</button>
                {sampleCustomers.map((c) => (
                  <button key={c.label} onClick={() => setPreviewSample(c.label as 'VIP' | '일반' | '신규')} className={`flex-1 min-w-[44px] text-[10px] px-1.5 py-1 rounded ${previewSample === c.label ? 'bg-violet-500/30 border border-violet-400/40 text-white' : 'bg-slate-900/60 border border-white/10 text-white/50'}`}>{c.label}</button>
                ))}
              </div>
            )}
            <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-1">
              <span className="text-[10px] text-white/40 mr-auto">보이는 폭</span>
              <button
                type="button"
                onClick={() => setPreviewWidth('mobile')}
                className={`text-[10px] px-2 py-1 rounded ${previewWidth === 'mobile' ? 'bg-violet-500/30 border border-violet-400/40 text-white' : 'bg-slate-900/60 border border-white/10 text-white/50'}`}
              >모바일</button>
              <button
                type="button"
                onClick={() => setPreviewWidth('pc')}
                className={`text-[10px] px-2 py-1 rounded ${previewWidth === 'pc' ? 'bg-violet-500/30 border border-violet-400/40 text-white' : 'bg-slate-900/60 border border-white/10 text-white/50'}`}
              >PC</button>
            </div>
            <div className="flex-1 overflow-hidden bg-white">
              <iframe
                ref={previewFrameRef}
                onLoad={handlePreviewLoad}
                title="이메일 미리보기"
                srcDoc={previewHtml}
                className="border-0"
                style={previewWidth === 'pc'
                  // 680px 문서를 패널 폭에 맞춰 축소해 보여준다. 높이는 축소분만큼 늘려 아래 여백을 없앤다.
                  ? { width: PREVIEW_PC_WIDTH, height: `${(100 / PREVIEW_PC_SCALE).toFixed(2)}%`, transform: `scale(${PREVIEW_PC_SCALE})`, transformOrigin: 'top left' }
                  : { width: '100%', height: '100%' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* PC(데스크탑) 폭 전체화면 미리보기 — 실제 발송 HTML */}
      {pcPreviewOpen && (
        <div className="fixed inset-0 z-[130] bg-slate-950/90 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm text-white/80"><Monitor className="w-4 h-4" /> PC 미리보기: 데스크탑 폭 (실제 발송 HTML)</div>
            <button onClick={() => setPcPreviewOpen(false)} className="text-white/60 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-auto p-4 md:p-8 flex justify-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-full max-w-[680px] bg-white rounded-lg shadow-2xl overflow-hidden">
              <iframe title="PC 미리보기" srcDoc={previewHtml} className="w-full border-0" style={{ height: '82vh' }} />
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-07-13 디자인 테마 8종 — 1클릭 적용(문안 무변), 기본 룩 복귀 지원 */}
      {themeOpen && (
        <EmailDesignThemeModal
          current={design}
          onApply={(d) => setDesign(d)}
          onReset={() => setDesign((cur) => (cur?.preheader ? { preheader: cur.preheader } : null))}
          onClose={() => setThemeOpen(false)}
        />
      )}

      {/* ★ 2026-08-27 서체 지정 — 캠페인 design만 패치(브랜드킷 무변경 = DM·인앱 영향 0) */}
      {fontOpen && (
        <EmailFontModal
          current={design}
          onApply={(d) => setDesign(d)}
          onReset={() => setDesign((cur) => {
            if (!cur) return null;
            const { font_family: _f, font_display: _d, ...rest } = cur;
            return Object.keys(rest).length > 0 ? rest : null;
          })}
          onClose={() => setFontOpen(false)}
        />
      )}

      {/* ★ 2026-07-02 완성(50크레딧) 사전 고지 확인 모달 */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

// 좌측 블록 행 — @dnd-kit 드래그 핸들 + 위/아래(모바일 대비) + 복제 + 삭제
function SortableBlockRow({
  section, selected, isFirst, isLast, onSelect, onUp, onDown, onDuplicate, onDelete,
}: {
  section: Section;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group flex items-center gap-1 rounded-lg px-1.5 py-1.5 cursor-pointer border ${selected ? 'bg-violet-500/20 border-violet-400/50' : 'border-transparent hover:bg-white/5'}`}
    >
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title="드래그하여 순서 변경"
        aria-label="드래그 핸들"
        className="shrink-0 text-white/30 hover:text-white/70 cursor-grab active:cursor-grabbing touch-none px-0.5"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      <span className="text-sm shrink-0">{SECTION_META[section.type]?.icon || '▫️'}</span>
      <span className="flex-1 text-xs text-white/80 truncate">{SECTION_META[section.type]?.label || section.type}</span>
      <button onClick={(e) => { e.stopPropagation(); onUp(); }} disabled={isFirst} className="text-white/30 hover:text-white disabled:opacity-30 p-0.5" aria-label="위로"><ArrowUp className="w-3 h-3" /></button>
      <button onClick={(e) => { e.stopPropagation(); onDown(); }} disabled={isLast} className="text-white/30 hover:text-white disabled:opacity-30 p-0.5" aria-label="아래로"><ArrowDown className="w-3 h-3" /></button>
      <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="text-white/30 hover:text-violet-300 p-0.5" aria-label="복제"><Copy className="w-3 h-3" /></button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-white/30 hover:text-rose-400 p-0.5" aria-label="삭제"><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}
