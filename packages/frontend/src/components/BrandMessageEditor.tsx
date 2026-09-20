/**
 * BrandMessageEditor — 브랜드메시지 작성 에디터
 *
 * 소비처 1곳: 직접발송 헤더의 브랜드메시지 모달(BrandSendModal) → `POST /api/campaigns/brand-send`.
 * (★2026-08-18 실측 정정 — 옛 주석의 "KakaoRcsPage 브랜드 탭"은 이미 없어진 소비처였다)
 *
 * 여기 검사는 **입력을 미리 막아주는 거울**이고 최종 판정자는 백엔드 CT-12
 * (`utils/brand-message.ts` buildBrandQueuePayload)다 — 규격 값을 고칠 땐 양쪽을 같이 고친다.
 *
 * ★ 2026-09-01 전면 재작성 (Harold 승인 목업 = docs/mockups/2026-09-01-brand-send-redesign-mockup.html)
 *   ①이미지 입력: 라이브러리 선택(공용 픽커) + 파일 업로드. (URL 직접 입력은 2026-09-02 제거 —
 *     카카오는 콘텐츠 서버 업로드본만 받는다. 서버가 발송 직전 올려 준다 = brand-image-resolver)
 *     라이브러리 선택은 `asset_id`를 payload에 함께 실어 백엔드가 AI 생성 여부를 판정한다(전략 A).
 *   ②AI 생성 이미지 표시: kind='generated' 이미지를 고르면 발송 시 본문 끝에
 *     `*AI로 생성된 이미지입니다`가 자동으로 붙는다(카카오 브랜드 메시지 가이드 4-2 · 백엔드 CT-12가
 *     부착 소유). 화면은 그 몫(코드포인트 16자 + 줄바꿈 1)을 카운터·미리보기·차단 사유에 미리 반영한다.
 *   ③유형 카드에 규격 힌트, 접이식 항목에 현재 설정값 요약, 하단 고정 발송 바(요약 동반).
 *   톤 = 화이트 고급형 유지(2026-07-31 Harold 확정 · SendWorkspaceShell 계열).
 *
 * ★ 2026-07-31 재작성분에서 유지하는 것 — 죽은 분기 없음(지원 3종만 노출), 쿠폰 5형식 선택 입력.
 *
 * ★ 2026-09-20 발송 창 개편 1차 (Harold 승인 목업 v2.1)
 *   ①유형 카드 나열 → 한 줄 버튼 + 작은 선택 창(`brand-send/BrandTypePickerModal`)
 *   ②발신 프로필·타겟팅 = 기본 select → 선택 목록(`brand-send/BrandPickMenu`). 글자 잘림 접수의 뿌리가
 *     기본 select였다(닫힌 상태의 글자는 줄바꿈이 안 된다)
 *   ③수신거부 080 = 설정값 고정 또는 하이픈 자동 입력. 접이식에서 광고 줄로 올렸다
 *   ④3종 규격 사본 표 삭제 → `constants/brand-message-spec.ts` 단일 사본
 *   ⑤미리보기 = 실수신 화면 기준((광고) 이름 앞 · 수신거부 안내는 말풍선 아래)
 */
import { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon, PanelTop, Plus, X, Ticket, MessageSquareReply, Loader2, Send,
  FolderOpen, Upload, Sparkles, ChevronDown, Target, Lock,
} from 'lucide-react';
import BrandMessagePreview from './BrandMessagePreview';
import AssetLibraryPickerModal from './assets/AssetLibraryPickerModal';
import { FIELD_CLASS, FIELD_CLASS_INDIGO, PANEL_CLASS, SourceCaption } from './shared/SendWorkspaceShell';
import BrandPickMenu from './brand-send/BrandPickMenu';
import BrandTypePickerModal, { BrandTypeThumb, brandTypeChips } from './brand-send/BrandTypePickerModal';
import { BRAND_SPEC, BRAND_TYPE_ORDER, type BrandSpec } from '../constants/brand-message-spec';
import BrandRichSections from './brand-send/BrandRichSections';
import { initialRich, linkReason, normalizeLinkInput, richBlockReason, richPayload, type RichState } from './brand-send/brandRich';
import { brandImageHint } from './brand-send/brandImageSpec';
import { useBrandImageGuard } from './brand-send/useBrandImageGuard';
import type { PreviewRich } from './BrandMessagePreview';
import { format080Input, isValid080Number } from '../utils/formatDate';

/**
 * ★ AI 생성 이미지 안내 문구 — 값의 원천은 백엔드 CT-12(`BRAND_AI_IMAGE_NOTICE`)다.
 *   여기 사본은 카운터·미리보기·중복 판정용 거울이라 **두 값이 갈리면 안 된다**(백엔드 테스트가
 *   문구 소모 16자를 계약으로 고정하고 있다 — 바꿀 때는 양쪽 + 그 테스트를 같이 고친다).
 */
export const AI_IMAGE_NOTICE = '*AI로 생성된 이미지입니다';
/** 문구가 본문에서 먹는 몫 — 줄바꿈 1자 + 문구 15자 = 코드포인트 16 */
const AI_NOTICE_COST = [...`\n${AI_IMAGE_NOTICE}`].length;
/** 멱등 인정 = 말미의 독립 줄일 때만 — 백엔드 NOTICE_TAIL_RE와 같은 판정(본문 중간 언급은 부착 대상) */
const NOTICE_TAIL_RE = new RegExp(`(?:^|\\n)${AI_IMAGE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const noticeAtEnd = (s: string): boolean => NOTICE_TAIL_RE.test(s.trimEnd());

/** 코드포인트 글자 수 — 백엔드 charLen과 같은 자(이모지 서로게이트 쌍 = 1자) */
const cpLen = (s: string): number => [...s].length;
const nlCount = (s: string): number => (s.match(/\n/g) || []).length;

/**
 * ★ 2026-08-21 강조색을 호출자가 고른다. 직접발송 진입 = violet(기존 그대로), 직접 타겟 발송 진입 = indigo(콘솔 톤).
 *   색 값은 이 표 하나만 갖고, 아래 JSX는 이름만 부른다(조립 문자열 0 = Tailwind 스캐너가 읽는다).
 *   AI 배지·안내 칩은 액센트와 무관하게 violet 고정 — 앱 전체에서 AI 정체성 색이다.
 */
export type EditorAccent = 'violet' | 'indigo';
const ACCENT = {
  violet: {
    field: FIELD_CLASS,
    typeBtn: 'ring-1 ring-violet-200 bg-gradient-to-b from-white to-violet-50 hover:ring-violet-300',
    typeChange: 'text-violet-700 ring-1 ring-violet-200',
    switchOn: 'bg-violet-600',
    link: 'text-violet-600 hover:bg-violet-50',
    actPrimary: 'ring-1 ring-violet-200 text-violet-700 bg-gradient-to-b from-white to-violet-50 hover:ring-violet-300',
    actIcon: 'text-violet-500',
    send: 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-violet-500/25',
    sumAccent: 'text-violet-600',
  },
  indigo: {
    field: FIELD_CLASS_INDIGO,
    typeBtn: 'ring-1 ring-indigo-200 bg-gradient-to-b from-white to-indigo-50 hover:ring-indigo-300',
    typeChange: 'text-indigo-700 ring-1 ring-indigo-200',
    switchOn: 'bg-indigo-600',
    link: 'text-indigo-600 hover:bg-indigo-50',
    actPrimary: 'ring-1 ring-indigo-200 text-indigo-700 bg-gradient-to-b from-white to-indigo-50 hover:ring-indigo-300',
    actIcon: 'text-indigo-500',
    send: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/25',
    sumAccent: 'text-indigo-600',
  },
} as const;

// ============================================================
// 상수 (프론트 컨트롤타워 — 백엔드 CT-12와 동기)
// ============================================================
// ★ 2026-07-30 발송경로 재구축 — 발송 스펙이 확보된 TEXT·IMAGE·WIDE만 노출한다.
//   나머지 유형은 백엔드 CT-12가 입구에서 거부하므로 화면에도 두지 않는다(실패할 버튼 노출 금지).
// 값의 원천은 백엔드 CT-12(`utils/brand-message.ts` BUBBLE_TYPES)이고 그쪽이 최종 판정자다.
// 여기 표는 **입력 단계에서 미리 막아주는 거울**이다 — 두 벌이라 갈릴 수 있으므로 값을 고칠 때는
// 반드시 양쪽을 같이 고친다(근거 = IMC-Agent 매뉴얼 v2.3.1 §4.4.1 · §6.10.3.3 · §6.10.7.2).
// maxBtnName = attachment_method.pdf §3.4 (TEXT·IMAGE 14자 / 그외 8자) — ★2026-09-01 거울에 추가.
// ★ 2026-09-20 손으로 적던 3종 사본 표를 없앴다 — 규격 값은 `constants/brand-message-spec.ts`
//   (백엔드 CT-12에서 뽑은 사본 · 파리티 테스트가 어긋남을 잡는다) 한 곳에서만 읽는다.
//   노출 유형 = 그 사본의 `opened`(발송이 열린 유형)뿐이다. 실패할 버튼 노출 금지 원칙은 그대로다.
const toEditorType = (s: BrandSpec) => ({
  code: s.code, label: s.label,
  maxMsg: s.maxMessage, maxNewline: s.maxNewline,
  maxBtn: s.maxButtons, minBtn: s.minButtons, couponMaxBtn: s.couponMaxButtons, couponDescMax: s.couponDescMax,
  maxBtnName: s.maxButtonName, needImage: s.requireImage,
  /** 캐러셀은 버튼·쿠폰을 카드가 갖는다 — 말풍선 단위 버튼·쿠폰 입력을 그리지 않는다 */
  isCarousel: !!s.carousel,
});
/** 발송이 열린 유형(전 고객) — 시험 계정에게만 열리는 유형은 서버가 따로 알려준다(아래 trialTypes) */
export const BUBBLE_TYPES = BRAND_TYPE_ORDER.filter((code) => BRAND_SPEC[code].opened).map((code) => toEditorType(BRAND_SPEC[code]));

/**
 * 버튼 타입 — 필수 입력과 사용 조건은 매뉴얼 §6.10.3.2가 정한다.
 * `needUrl` = 화면에 URL 칸을 띄울지 / `targetingOnly` = 그 대상 범위에서만 고를 수 있는 버튼.
 */
/**
 * ⛔ **여기 없는 유형은 화면에 내지 않는다** — 실패할 버튼을 노출하지 않는다는 이 파일의 원칙 그대로다.
 *   ★2026-08-18 제외분:
 *   - `AL`(앱링크) = 매뉴얼 §6.10.3.2가 스킴·URL 중 **2개 이상**을 요구하는데 입력칸이 URL 하나뿐이라
 *     무엇을 넣어도 서버가 거절한다. iOS·Android 스킴 입력칸이 생기면 되살린다.
 *   - `BF`(비즈니스폼) = `biz_form_key` 입력칸이 없어 항상 거절된다.
 *   두 유형은 노출해 두면 "발송 버튼은 눌리는데 서버가 막는" 막다른 길이 된다.
 */
export const BUTTON_TYPES = [
  { code: 'WL', label: '웹링크', needUrl: true, fixedName: undefined as string | undefined, targetingOnly: undefined as readonly string[] | undefined },
  { code: 'BK', label: '봇키워드', needUrl: false, fixedName: undefined, targetingOnly: undefined },
  { code: 'MD', label: '메시지전달', needUrl: false, fixedName: undefined, targetingOnly: undefined },
  { code: 'BC', label: '상담톡전환', needUrl: false, fixedName: undefined, targetingOnly: undefined },
  { code: 'BT', label: '봇전환', needUrl: false, fixedName: undefined, targetingOnly: undefined },
  // 채널추가는 마케팅 수신동의(M·N) 대상에서만 쓸 수 있다 — 채널 친구(I)에는 붙일 수 없다.
  { code: 'AC', label: '채널추가', needUrl: false, fixedName: '채널 추가', targetingOnly: ['M', 'N'] as readonly string[] },
];

export const TARGETING_OPTIONS = [
  { code: 'I', label: '채널 친구', desc: '광고주 지정 대상 중 채널 친구만' },
  { code: 'M', label: '마수동 전체', desc: '마케팅 수신동의 전체' },
  { code: 'N', label: '비친구만', desc: '마수동 중 채널 친구 제외' },
];

// ============================================================
// 인터페이스
// ============================================================
interface Button { name: string; type: string; url_mobile?: string; url_pc?: string; }

interface BrandMessageEditorProps {
  profiles: { id: string; profile_key: string; profile_name: string }[];
  onSend: (data: any) => void;
  sending: boolean;
  /** 강조색. 기본 violet(직접발송). 직접 타겟 발송 진입은 indigo */
  accent?: EditorAccent;
  /** 발송 바 요약에 적을 수신자 수 — 부모(BrandSendModal)가 넘긴다. 없으면 표기 생략 */
  recipientCount?: number;
  /**
   * ★ 2026-09-20 설정에 등록된 080 수신거부 번호(`/api/companies/settings` reject_number · 사용자 값 우선).
   *   유효한 080 번호면 **그 값을 그대로 쓰고 입력칸을 잠근다** — 다른 번호로 보내면 080 수신거부
   *   자동 등록(콜백 매칭)과 어긋난다. 없거나 080 형식이 아니면 직접 입력(하이픈 자동)으로 받는다.
   */
  defaultUnsubPhone?: string;
}

/**
 * 접이식 선택 섹션 — 접힌 상태에서도 현재 설정값이 보인다(★2026-09-01 목업 승인).
 * "펼치기"만 있던 옛 형태는 대체발송을 켰는지 접으면 알 수 없었다.
 */
function Collapsible({ icon, title, stateText, stateSet, children, defaultOpen }: {
  icon: React.ReactNode; title: string;
  /** 접힌 상태에 보여줄 현재 값 요약 (예: "사용 안 함" / "SMS로 대체") */
  stateText?: string;
  /** true면 요약을 설정됨 톤(emerald)으로 */
  stateSet?: boolean;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-sm overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer hover:bg-slate-50/70 transition flex items-center gap-2.5 list-none">
        <span className="text-slate-400 shrink-0">{icon}</span>
        <span className="text-sm font-medium text-slate-700">{title}</span>
        {stateText && (
          <span className={`ml-auto text-[11px] ${stateSet ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
            {stateText}
          </span>
        )}
        <ChevronDown size={14} strokeWidth={2} className={`${stateText ? '' : 'ml-auto '}text-slate-300 shrink-0 transition-transform group-open:rotate-180`} />
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100">{children}</div>
    </details>
  );
}

export default function BrandMessageEditor({ profiles, onSend, sending, accent = 'violet', recipientCount, defaultUnsubPhone }: BrandMessageEditorProps) {
  const a = ACCENT[accent];
  const FIELD = a.field;
  const [mode, setMode] = useState<'free' | 'template'>('free');
  const [bubbleType, setBubbleType] = useState('TEXT');
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  /**
   * ★2026-09-20 시험 개방 — 실측 전인 5종은 **시험 계정에게만** 보인다(서버 CT-12 `BUBBLE_TYPE_TRIAL` ·
   *   `GET /api/campaigns/brand-send/capabilities`). 조회가 실패하면 빈 배열 = 열린 유형만 그린다.
   *   최종 판정은 발송 시 서버가 다시 한다 — 이 값은 화면에 무엇을 그릴지 정할 뿐이다.
   */
  const [trialTypes, setTrialTypes] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/campaigns/brand-send/capabilities', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && Array.isArray(d?.trialTypes)) setTrialTypes(d.trialTypes.map(String)); })
      .catch(() => { /* 시험 유형 없음으로 둔다 */ });
    return () => { alive = false; };
  }, []);
  const availableCodes = BRAND_TYPE_ORDER.filter((code) => BRAND_SPEC[code].opened || trialTypes.includes(code));
  /** 5종이 더하는 입력(헤더·아이템·동영상·커머스·캐러셀) — 상태·검사·payload는 brandRich가 소유한다 */
  const [rich, setRich] = useState<RichState>(() => initialRich('TEXT'));
  const [senderKey, setSenderKey] = useState('');
  const [targeting, setTargeting] = useState('I');
  const [isAd, setIsAd] = useState(true);

  // 메시지 내용
  const [message, setMessage] = useState('');

  // 버튼
  const [buttons, setButtons] = useState<Button[]>([]);

  // 이미지 — ★2026-09-01 라이브러리·업로드·URL 3방식. assetId·kind는 라이브러리/업로드에서만 채워진다.
  //   URL을 손으로 고치면 근거가 사라지므로 둘을 비운다(모르는 이미지를 AI라고 표시하지 않는다).
  const [imageUrl, setImageUrl] = useState('');
  const [imageLink, setImageLink] = useState('');
  const [imageAssetId, setImageAssetId] = useState('');
  const [imageKind, setImageKind] = useState('');       // 'generated' | 'uploaded' | ... | ''(출처 모름)
  const [imageName, setImageName] = useState('');       // 표시용 파일명
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * ★2026-09-20 이미지 입구 = `useBrandImageGuard`(자리형 입력 BrandImageSlot과 같은 입구).
   *   고르는 순간 실제 크기를 재서 규격 밖이면 경고 창을 띄운다(자동 맞춤 · 다른 이미지 선택).
   *   업로드 호출과 「늦게 온 응답 버리기」(옛 imageSeqRef · Codex 1R H4)도 그 훅이 소유한다.
   */
  const imageGuard = useBrandImageGuard({
    kind: 'main',
    label: '이미지',
    onAccept: (img) => {
      setImageUrl(img.url);
      setImageAssetId(img.assetId);
      setImageKind(img.kind);
      setImageName(img.name);
    },
    onPickAnother: () => setPickerOpen(true),
  });

  // 쿠폰 — 제목은 카카오가 정한 5형식만 되므로 자유 입력 대신 형식 선택 + 값으로 받는다.
  //   (근거 = IMC Developer Portal brand/send/free coupon.title "사용 가능한 쿠폰 제목")
  const [couponForm, setCouponForm] = useState<'' | 'amount' | 'percent' | 'shipping' | 'free' | 'up'>('');
  const [couponValue, setCouponValue] = useState('');
  const [couponDesc, setCouponDesc] = useState('');
  const [couponUrl, setCouponUrl] = useState('');

  /**
   * 쿠폰 값 파싱 — **입력을 고쳐 쓰지 않는다.**
   * 예전에는 숫자 아닌 글자를 전부 지워서 '1만원'이 '1원 할인 쿠폰'이 되고 '1.5'가 '15%'가 됐다.
   * 사용자가 넣은 혜택값이 다른 값으로 바뀌어 나가는 것이라, 지우지 말고 **거절**해야 한다.
   * 숫자 서식도 로케일에 맡기지 않는다(toLocaleString은 환경에 따라 1.000·공백 구분자를 만든다).
   */
  const couponNumber = (() => {
    const v = couponValue.trim();
    if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(v)) return null;      // 숫자 또는 정확한 천단위 쉼표만
    const n = Number(v.replace(/,/g, ''));
    return Number.isSafeInteger(n) ? n : null;
  })();
  const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const couponTitle = (() => {
    const v = couponValue.trim();
    switch (couponForm) {
      case 'amount': return couponNumber !== null ? `${groupDigits(couponNumber)}원 할인 쿠폰` : '';
      case 'percent': return couponNumber !== null ? `${couponNumber}% 할인 쿠폰` : '';
      case 'shipping': return '배송비 할인 쿠폰';
      case 'free': return v ? `${v} 무료 쿠폰` : '';
      case 'up': return v ? `${v} UP 쿠폰` : '';
      default: return '';
    }
  })();

  // 대체 발송 — SMS/LMS만(브랜드는 MMS 대체 불가). LMS는 제목 필수.
  const [resendType, setResendType] = useState('NO');
  const [resendFrom, setResendFrom] = useState('');
  const [resendMessage, setResendMessage] = useState('');
  const [resendTitle, setResendTitle] = useState('');

  // 수신거부 — 설정값이 유효하면 그것으로 고정, 아니면 직접 입력(하이픈 자동 · props 주석)
  const [unsubPhone, setUnsubPhone] = useState('');
  const [unsubAuth, setUnsubAuth] = useState('');
  const lockedUnsub = isValid080Number(defaultUnsubPhone || '') ? format080Input(defaultUnsubPhone || '') : '';
  const effUnsub = lockedUnsub || unsubPhone.trim();
  // 080 줄은 광고이거나 마수동·비친구 대상일 때 보인다 — M·N은 광고 여부와 무관하게 번호가 필수다(매뉴얼 §2.2.2)
  const showUnsub = isAd || targeting !== 'I';

  // 기본형(템플릿)
  const [templateCode, setTemplateCode] = useState('');

  const selectedType = toEditorType(BRAND_SPEC[bubbleType] || BRAND_SPEC.TEXT);
  const selectedProfile = profiles.find(p => p.profile_key === senderKey);

  // 쿠폰을 함께 쓰면 버튼 상한이 줄어든다 (매뉴얼 §6.10.3.3)
  const hasCoupon = couponForm !== '';
  const effectiveMaxBtn = hasCoupon ? selectedType.couponMaxBtn : selectedType.maxBtn;
  // 대상 범위에 따라 고를 수 있는 버튼이 달라진다 (채널추가 = M·N 전용)
  const availableButtonTypes = BUTTON_TYPES.filter(
    bt => !bt.targetingOnly || bt.targetingOnly.includes(targeting)
  );

  /**
   * ★ AI 안내 문구 활성 판정 — 백엔드 부착 조건의 거울.
   * 라이브러리에서 고른 kind='generated' + 자유형 + 이미지 유형 + 본문 있음 + 아직 문구 없음일 때만.
   * (백엔드는 asset_id·URL로 다시 판정한다 — 여기 값은 카운터·미리보기·사전 차단용)
   */
  const noticeActive = mode === 'free'
    && selectedType.needImage
    && !!imageUrl
    && imageKind === 'generated'
    && !!message.trim()
    && !noticeAtEnd(message);

  const msgLen = cpLen(message.trim());
  const msgNl = nlCount(message.trim());
  const effLen = msgLen + (noticeActive ? AI_NOTICE_COST : 0);
  const effNl = msgNl + (noticeActive ? 1 : 0);
  const lenOver = effLen > selectedType.maxMsg;
  const nlOver = effNl > selectedType.maxNewline;

  /** 보내기 전에 걸리는 것 — 첫 한 줄만 알려주고 버튼을 잠근다 */
  const blockReason = (() => {
    // 수신거부 080 — 백엔드 CT-12 거절 사유의 거울(080 시작 · 10~11자리 / M·N 대상은 필수)
    if (showUnsub && !lockedUnsub && unsubPhone.trim() && !isValid080Number(unsubPhone)) {
      return '수신거부 번호는 080으로 시작하는 10~11자리 번호여야 합니다';
    }
    if (targeting !== 'I' && !effUnsub) {
      return '마수동·비친구 대상 발송은 수신거부 080 번호가 필요합니다';
    }
    if (mode === 'template') {
      // 기본형은 자유형 본문을 payload에서 제외하므로(Codex 1R H3) 대체발송 문안 폴백이 없다 —
      // 백엔드가 같은 이유로 거절하기 전에 여기서 먼저 알려준다.
      if (resendType !== 'NO' && !resendMessage.trim()) {
        return '기본형 발송의 대체발송 문안을 입력해주세요 (템플릿 본문은 대체발송에 쓸 수 없습니다)';
      }
      if (resendType === 'LM' && !resendTitle.trim()) return 'LMS 대체발송은 제목이 필요합니다';
      return '';
    }
    if (lenOver) {
      // 문구 몫 때문이면 이유까지 — "쓰지도 않은 글자" 오류로 보이면 사용자는 원인을 모른다(§4-7-②)
      return noticeActive && msgLen <= selectedType.maxMsg
        ? `AI 생성 이미지 안내 문구를 포함하면 본문 글자 수를 넘습니다. 본문을 ${effLen - selectedType.maxMsg}자 줄여 주세요`
        : `본문이 ${selectedType.maxMsg}자를 넘었습니다`;
    }
    if (nlOver) {
      return noticeActive && msgNl <= selectedType.maxNewline
        ? 'AI 생성 이미지 안내 문구를 포함하면 줄바꿈 수를 넘습니다. 본문 줄바꿈을 줄여 주세요'
        : `줄바꿈은 최대 ${selectedType.maxNewline}개입니다`;
    }
    if (selectedType.needImage && !imageUrl.trim()) return `${selectedType.label} 유형은 이미지가 필요합니다`;
    // 본문이 없는 유형은 AI 생성 이미지 안내 문구를 붙일 자리가 없다 — 서버도 같은 이유로 거절한다
    if (selectedType.needImage && selectedType.maxMsg === 0 && imageKind === 'generated') {
      return `${selectedType.label} 유형에는 AI로 만든 이미지를 쓸 수 없습니다. 직접 올린 이미지를 사용해 주세요`;
    }
    if (selectedType.needImage) {
      const ilr = linkReason(imageLink, '이미지 클릭 주소는');
      if (ilr) return ilr;
    }
    const richReason = richBlockReason(bubbleType, rich, BUTTON_TYPES.filter((t) => t.needUrl).map((t) => t.code));
    if (richReason) return richReason;
    if (!selectedType.isCarousel && buttons.length < selectedType.minBtn) {
      return `${selectedType.label} 유형은 버튼이 최소 ${selectedType.minBtn}개 필요합니다`;
    }
    if (buttons.length > effectiveMaxBtn) {
      return hasCoupon
        ? `쿠폰을 함께 쓰면 버튼은 최대 ${effectiveMaxBtn}개입니다`
        : `버튼은 최대 ${effectiveMaxBtn}개입니다`;
    }
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      const spec = BUTTON_TYPES.find(t => t.code === b.type);
      if (!spec) return `${i + 1}번째 버튼은 지금 사용할 수 없는 종류입니다. 다시 선택해주세요`;
      if (!b.name.trim()) return `${i + 1}번째 버튼의 버튼명을 입력해주세요`;
      if (cpLen(b.name.trim()) > selectedType.maxBtnName) {
        return `${i + 1}번째 버튼명은 최대 ${selectedType.maxBtnName}자입니다`;
      }
      if (spec?.needUrl && !(b.url_mobile || '').trim()) return `${i + 1}번째 버튼의 링크를 입력해주세요`;
      const blr = spec?.needUrl ? linkReason(b.url_mobile || '', `${i + 1}번째 버튼의 링크는`) : '';
      if (blr) return blr;
      if (spec?.targetingOnly && !spec.targetingOnly.includes(targeting)) {
        return `${spec.label} 버튼은 지금 선택한 대상 범위에서는 쓸 수 없습니다`;
      }
    }
    if (hasCoupon) {
      if (couponForm === 'amount' || couponForm === 'percent') {
        if (couponNumber === null) return '쿠폰 값은 숫자로 입력해주세요';
        if (couponForm === 'percent' && !(couponNumber >= 1 && couponNumber <= 100)) {
          return '할인율은 1~100 사이로 입력해주세요';
        }
        if (couponForm === 'amount' && !(couponNumber >= 1 && couponNumber <= 99999999)) {
          return '할인 금액은 1원~99,999,999원 사이로 입력해주세요';
        }
      }
      if (!couponTitle) return '쿠폰 값을 입력해주세요';
      if ((couponForm === 'free' || couponForm === 'up') && cpLen(couponValue.trim()) > 7) {
        return '쿠폰 이름은 7자까지 입력할 수 있습니다';
      }
      const desc = couponDesc.trim();
      if (!desc) return '쿠폰 설명을 입력해주세요';
      if (cpLen(desc) > selectedType.couponDescMax) return `쿠폰 설명은 최대 ${selectedType.couponDescMax}자입니다`;
      if (!couponUrl.trim()) return '쿠폰을 누르면 이동할 주소를 입력해주세요';
      const clr = linkReason(couponUrl, '쿠폰 주소는');
      if (clr) return clr;
    }
    // LMS 대체발송 제목 — 백엔드 거절 문구와 같은 문장으로 미리 막는다(실패할 버튼 노출 금지)
    if (resendType === 'LM' && !resendTitle.trim()) return 'LMS 대체발송은 제목이 필요합니다';
    return '';
  })();

  // 버튼 추가/삭제
  const addButton = () => {
    if (buttons.length >= effectiveMaxBtn) return;
    setButtons([...buttons, { name: '', type: 'WL', url_mobile: '' }]);
  };
  const removeButton = (idx: number) => setButtons(buttons.filter((_, i) => i !== idx));
  const updateButton = (idx: number, field: string, value: string) => {
    setButtons(buttons.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  };

  // 이미지 입력 — ★2026-09-02 URL 직접 입력 제거: img_url에는 카카오 콘텐츠 서버 업로드본만 실을 수 있어
  //   임의 주소는 애초에 발송이 안 된다. 라이브러리·업로드 둘 다 서버가 카카오로 올려 준다.
  //   고르기·올리기는 imageGuard가 맡는다(규격 검사 포함) — 여기는 제거만 갖는다.
  const clearImage = () => {
    imageGuard.reset();
    setImageUrl(''); setImageLink(''); setImageAssetId(''); setImageKind(''); setImageName('');
  };

  // 발송 — payload 키는 백엔드 CT-12 계약 그대로 유지한다(★2026-09-01 image.asset_id만 추가).
  // ★Codex 1R H3 수용 — payload를 **모드별로 투영**한다. 옛 코드는 모드와 무관하게 message·buttons·
  //   coupon을 실어, 자유형에서 쓰다 기본형으로 전환하면 화면에 안 보이는 문안이 대체발송(SMS/LMS)
  //   폴백으로 실발송될 수 있었다. 기본형은 템플릿 관련 값만 싣는다.
  const handleSend = () => {
    const data: any = {
      mode,
      bubbleType,
      senderKey,
      targeting,
      isAd,
      resendType,
      resendFrom: resendFrom || undefined,
      resendMessage: resendMessage || undefined,
      resendTitle: resendTitle || undefined,
      // 080 줄이 화면에 보일 때만 싣는다 — 안 보이는 값이 따라 나가지 않게(이미지와 같은 원칙)
      unsubscribePhone: showUnsub ? (effUnsub || undefined) : undefined,
      unsubscribeAuth: showUnsub ? (unsubAuth.trim() || undefined) : undefined,
    };

    if (mode === 'free') {
      // 본문·말풍선 버튼은 그 유형이 쓸 때만 싣는다(유형을 바꾸며 남은 값이 따라 나가지 않게)
      data.message = selectedType.maxMsg > 0 ? (message || undefined) : undefined;
      data.buttons = !selectedType.isCarousel && buttons.length > 0 ? buttons : undefined;
      Object.assign(data, richPayload(bubbleType, rich));
      // 쿠폰 클릭 URL은 매뉴얼 §6.10.7의 평면 키(url_mobile)다 — 옛 `link: {url_mobile}` 래핑은
      // 규격 밖 키라 클릭이 전달되지 않았다(2026-08-18 정정).
      if (couponTitle && !selectedType.isCarousel) data.coupon = { title: couponTitle, description: couponDesc, url_mobile: couponUrl || undefined };
    } else {
      data.templateCode = templateCode;
    }

    // ★2026-09-01 이미지는 이미지 유형에서만 싣는다 — 옛 코드는 유형을 바꿔도 남은 imageUrl을
    //   그대로 실어 TEXT 발송에 이미지가 따라갔다(화면에 입력칸도 없는 값이 나가는 상태).
    if (imageUrl && selectedType.needImage) {
      data.image = {
        img_url: imageUrl,
        img_link: imageLink || undefined,
        asset_id: imageAssetId || undefined,   // AI 생성 판정용(전략 A) — 카카오 전문에는 안 실린다
      };
    }

    onSend(data);
  };

  const richSpec = BRAND_SPEC[bubbleType];
  const previewRich: PreviewRich | undefined = mode === 'free' && richSpec ? {
    additional: richSpec.maxAdditional > 0 ? rich.additional : undefined,
    items: richSpec.maxItems > 0 ? rich.items.map((it) => ({ imageUrl: it.image?.url, title: it.title })) : undefined,
    video: richSpec.requireVideo ? { thumbUrl: rich.video.thumb?.url } : undefined,
    commerce: richSpec.requireCommerce && !richSpec.carousel ? rich.commerce : undefined,
    carousel: richSpec.carousel ? {
      intro: richSpec.carousel.allowIntro && rich.introOn
        ? { imageUrl: rich.intro.image?.url, header: rich.intro.header, content: rich.intro.content } : undefined,
      cards: rich.cards.map((c) => ({
        imageUrl: c.image?.url, header: c.header, message: c.message, additional: c.additional,
        commerce: richSpec.requireCommerce ? c.commerce : undefined,
        buttons: c.buttons.map((b) => b.name),
      })),
      tail: rich.tailOn,
    } : undefined,
  } : undefined;

  const previewData = {
    bubbleType,
    message: selectedType.maxMsg > 0 ? (message || undefined) : undefined,
    header: mode === 'free' && richSpec && richSpec.maxHeader > 0 && !richSpec.carousel ? (rich.header || undefined) : undefined,
    imageUrl: (imageUrl && selectedType.needImage) ? imageUrl : undefined,
    buttons: !selectedType.isCarousel && buttons.length > 0 ? buttons : undefined,
    couponTitle: !selectedType.isCarousel ? (couponTitle || undefined) : undefined,
    isAd,
    profileName: selectedProfile?.profile_name,
    aiNoticeText: noticeActive ? AI_IMAGE_NOTICE : undefined,
    rich: previewRich,
  };

  // 본문이 없는 유형(와이드 리스트·커머스·캐러셀)은 본문 없이 보낸다 — 나머지는 본문이 있어야 한다
  const canSend = !sending && !!senderKey && !blockReason
    && (mode === 'template' ? !!templateCode : (selectedType.maxMsg === 0 || !!message.trim()));

  // 발송 바 요약 — 무엇이 어떻게 나가는지 누르기 전에 한 줄로 보인다
  const summaryParts: string[] = [];
  if (typeof recipientCount === 'number') summaryParts.push(`수신자 ${recipientCount.toLocaleString()}명`);
  summaryParts.push(mode === 'template' ? '기본형(템플릿)' : `${selectedType.label}형`);
  summaryParts.push(isAd ? '(광고) 표기' : '광고 표기 없음');
  if (resendType === 'SM') summaryParts.push('실패 시 SMS 대체');
  if (resendType === 'LM') summaryParts.push('실패 시 LMS 대체');

  return (
    <div className="flex flex-col lg:flex-row min-h-full">
      {/* ── 좌측: 작성 ───────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 p-5 sm:p-6 space-y-5">
          {/* 발송 방식 */}
          <div className="flex gap-1 p-1 rounded-xl bg-slate-100/80 w-fit">
            {([['free', '자유형 발송'], ['template', '기본형 (템플릿)']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMode(k)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  mode === k ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* ★2026-09-20 설정 바 — 유형·발신 프로필·타겟팅을 한 줄 높이의 선택 버튼 3개로.
              유형 카드는 작성 화면에 펼치지 않는다(8종이면 화면의 큰 몫을 먹는다). 「변경」이 작은 창을 띄우고,
              규격 힌트는 버튼 안에서 계속 보인다(고르고 나서야 76자를 아는 구조 금지 원칙 유지).
              폭이 좁아지면 줄바꿈으로 흡수한다 — 가로 스크롤을 만들지 않는다(min-w-0 · LESSONS_FRONTEND 0828). */}
          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-0 flex-[1.35_1_220px]">
              <span className="block text-[12px] font-semibold text-slate-600 mb-1.5">메시지 유형</span>
              <button type="button" onClick={() => setTypePickerOpen(true)} aria-haspopup="dialog"
                className={`w-full h-10 flex items-center gap-2 pl-1.5 pr-2 rounded-xl text-left shadow-sm transition ${a.typeBtn}`}>
                <BrandTypeThumb code={selectedType.code} active accent={accent} compact />
                <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
                  <span className="shrink-0 text-[13px] font-semibold text-slate-800">{selectedType.label}</span>
                  <span className="min-w-0 truncate text-[11px] text-slate-500">
                    {brandTypeChips(BRAND_SPEC[selectedType.code]).join(' · ')}
                  </span>
                </span>
                {availableCodes.length > 1 && (
                  <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white ${a.typeChange}`}>변경</span>
                )}
              </button>
            </div>
            <div className="min-w-0 flex-[1_1_170px]">
              <BrandPickMenu
                label="발신 프로필"
                accent={accent}
                value={senderKey}
                onChange={setSenderKey}
                options={profiles.map((p) => ({ value: p.profile_key, title: p.profile_name }))}
                leading={(sel) => (
                  <span className={`shrink-0 w-6 h-6 rounded-lg grid place-items-center text-[11px] font-bold ${
                    sel ? 'bg-[#FEE500] text-[#3C1E1E]' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {sel ? sel.title.slice(0, 1) : '?'}
                  </span>
                )}
              />
            </div>
            <div className="min-w-0 flex-[1_1_150px]">
              <BrandPickMenu
                label="타겟팅"
                accent={accent}
                alignRight
                value={targeting}
                onChange={setTargeting}
                options={TARGETING_OPTIONS.map((t) => ({
                  value: t.code, title: t.label, tag: t.code,
                  desc: t.code === 'I' ? t.desc : `${t.desc} · 수신거부 080 번호가 필요합니다`,
                }))}
                leading={() => <Target size={15} strokeWidth={1.9} className="shrink-0 text-slate-400 ml-0.5" />}
              />
            </div>
          </div>

          {/* 광고 여부 + 수신거부 080 — 한 줄. 080은 설정값이 있으면 그대로 쓰고(잠금), 없으면 하이픈 자동 입력 */}
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5">
              <button type="button" role="switch" aria-checked={isAd} onClick={() => setIsAd(!isAd)}
                className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-700 select-none">
                <span className={`relative w-8 h-[18px] rounded-full transition-colors ${isAd ? a.switchOn : 'bg-slate-300'}`}>
                  <span className={`absolute top-[2.5px] left-[2.5px] w-[13px] h-[13px] rounded-full bg-white shadow transition-transform ${isAd ? 'translate-x-[14px]' : ''}`} />
                </span>
                광고 메시지
              </button>
              {showUnsub && (
                <>
                  <span className="hidden sm:block w-px h-5 bg-slate-200" />
                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="text-[12px] font-semibold text-slate-600 whitespace-nowrap">수신거부 080</span>
                    {lockedUnsub ? (
                      <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white ring-1 ring-slate-200 text-[13px] font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                        <Lock size={12} strokeWidth={2} className="text-slate-400" />
                        {lockedUnsub}
                        <span className="text-[10.5px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">설정값</span>
                      </span>
                    ) : (
                      <input type="text" inputMode="numeric" value={unsubPhone}
                        onChange={(e) => setUnsubPhone(format080Input(e.target.value))}
                        className={`${FIELD} !w-[148px] !py-0 h-8 !text-[13px] tabular-nums`} placeholder="080-000-0000" />
                    )}
                    <input type="text" value={unsubAuth} onChange={(e) => setUnsubAuth(e.target.value)}
                      className={`${FIELD} !w-[120px] !py-0 h-8 !text-[13px] tabular-nums`} placeholder="인증번호 (선택)" />
                  </div>
                </>
              )}
            </div>
            {showUnsub && (
              <p className="text-[11px] text-slate-500 mt-1.5 px-1">
                {lockedUnsub
                  ? '설정에 등록된 080 번호를 그대로 씁니다. 번호는 설정의 「080 수신거부번호」에서 바꿀 수 있습니다.'
                  : '숫자만 입력하면 하이픈이 자동으로 들어갑니다. 예) 0807198700 → 080-719-8700'}
              </p>
            )}
          </div>

          {/* 기본형: 템플릿 코드 */}
          {mode === 'template' && (
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">템플릿 코드</label>
              <input type="text" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}
                className={FIELD} placeholder="사전 등록한 템플릿 코드" />
            </div>
          )}

          {/* 5종이 더하는 입력 — 헤더·동영상·아이템·커머스·캐러셀. 무엇이 보이는지는 규격이 정한다 */}
          {mode === 'free' && (
            <BrandRichSections
              code={bubbleType}
              value={rich}
              onChange={setRich}
              fieldClass={FIELD}
              panelClass={PANEL_CLASS}
              accentText={a.sumAccent}
              buttonTypes={availableButtonTypes.map((t) => ({ code: t.code, label: t.label, needUrl: t.needUrl, fixedName: t.fixedName }))}
            />
          )}

          {/* 본문 — 카운터가 글자·줄바꿈·AI 문구 몫까지 미리 계산한다. 본문을 쓰지 않는 유형에서는 그리지 않는다 */}
          {mode === 'free' && selectedType.maxMsg > 0 && (
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[13px] font-semibold text-slate-700">본문</label>
                <span className="text-[11px] tabular-nums flex items-center gap-2.5">
                  <span className={nlOver ? 'text-rose-500 font-bold' : 'text-slate-400'}>
                    줄바꿈 {effNl} / {selectedType.maxNewline}
                  </span>
                  <span className={lenOver ? 'text-rose-500 font-bold' : 'text-slate-400'}>
                    {msgLen.toLocaleString()}
                    {noticeActive && <span className="text-violet-600 font-semibold">+{AI_NOTICE_COST}</span>}
                    {' '}/ {selectedType.maxMsg.toLocaleString()}
                  </span>
                </span>
              </div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={selectedType.maxMsg}
                rows={selectedType.maxMsg > 100 ? 7 : 3}
                className={`${FIELD} resize-none leading-relaxed ${lenOver || nlOver ? 'ring-2 ring-rose-400/60' : ''}`}
                placeholder="보낼 내용을 입력하세요" />
              {noticeActive && (
                <div className="flex items-start gap-2 mt-2 px-3 py-2.5 rounded-xl bg-violet-50 ring-1 ring-violet-100">
                  <Sparkles size={14} strokeWidth={1.9} className="text-violet-500 shrink-0 mt-0.5" />
                  <span className="text-[12px] text-violet-700 leading-relaxed">
                    AI로 만든 이미지라서 발송할 때 본문 끝에 <b className="font-bold">{AI_IMAGE_NOTICE}</b> 안내가
                    자동으로 들어갑니다 <span className="text-violet-700/60">(본문 {AI_NOTICE_COST}자 사용)</span>
                  </span>
                </div>
              )}
              {mode === 'free' && imageKind === 'generated' && selectedType.needImage && !!imageUrl && !message.trim() && (
                <p className="text-[11px] text-slate-400 mt-1.5 px-1">
                  본문을 입력하면 AI 생성 이미지 안내 문구가 발송 시 자동으로 추가됩니다.
                </p>
              )}
            </div>
          )}

          {/* 이미지 — ★2026-09-01 라이브러리 선택(전략 A) · 업로드 · URL 3방식 */}
          {selectedType.needImage && (
            <div className={PANEL_CLASS}>
              <div className="flex items-center gap-2 mb-2.5">
                <ImageIcon size={14} strokeWidth={1.9} className="text-slate-400" />
                <span className="text-[13px] font-semibold text-slate-700">이미지</span>
                <span className="text-[11px] text-rose-500">필수</span>
              </div>

              {imageUrl ? (
                <div className="space-y-2.5">
                  {/* 선택된 이미지 카드 */}
                  <div className="flex gap-3.5 items-stretch bg-white rounded-2xl p-3 ring-1 ring-slate-900/5 shadow-sm">
                    <div className="w-[124px] shrink-0 rounded-xl overflow-hidden bg-slate-100 ring-1 ring-slate-200 self-stretch min-h-[64px] max-h-[80px]">
                      <img src={imageUrl} alt="" className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800 truncate">
                          {imageName || '외부 이미지'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">{imageUrl}</div>
                      </div>
                      <div className="flex gap-1.5 mt-1.5">
                        {imageKind === 'generated' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white px-2 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500">
                            <Sparkles size={9} strokeWidth={2.4} /> AI 생성
                          </span>
                        )}
                        {imageKind === 'uploaded' && (
                          <span className="inline-flex items-center text-[10px] font-semibold text-slate-500 px-2 py-0.5 rounded-full bg-slate-100">
                            직접 업로드
                          </span>
                        )}
                        {!imageKind && (
                          <span className="inline-flex items-center text-[10px] font-semibold text-slate-400 px-2 py-0.5 rounded-full bg-slate-100">
                            주소 입력
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0 justify-center">
                      <button type="button" onClick={() => setPickerOpen(true)}
                        className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-900/5 hover:bg-slate-100 transition">
                        교체
                      </button>
                      <button type="button" onClick={clearImage}
                        className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-600 px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-900/5 hover:bg-rose-50 transition">
                        제거
                      </button>
                    </div>
                  </div>

                  {/* 기본형에서 AI 이미지를 고른 경우 — 본문을 템플릿이 소유해 자동 부착이 안 된다 */}
                  {mode === 'template' && imageKind === 'generated' && (
                    <div className="px-3 py-2.5 rounded-xl bg-amber-50/80 ring-1 ring-amber-200/70 text-[11.5px] leading-relaxed text-amber-900">
                      기본형(템플릿) 발송은 본문을 등록된 템플릿이 갖고 있어 안내 문구를 자동으로 넣을 수 없습니다.
                      템플릿 본문에 AI 생성 이미지 안내가 들어 있는지 확인해 주세요.
                    </div>
                  )}

                  <input type="text" value={imageLink} onChange={(e) => setImageLink(e.target.value)}
                    onBlur={(e) => setImageLink(normalizeLinkInput(e.target.value))}
                    className={FIELD} placeholder="클릭 시 이동 URL (선택)" />
                </div>
              ) : (
                <div>
                  {/* 빈 상태 — 라이브러리·업로드 2가지. 라이브러리가 첫 자리다(스튜디오 AI 생성물이 거기 쌓인다) */}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setPickerOpen(true)}
                      className={`flex flex-col items-center gap-1.5 px-2 py-4 rounded-xl bg-white text-[12px] font-semibold transition shadow-sm ${a.actPrimary}`}>
                      <FolderOpen size={17} strokeWidth={1.8} className={a.actIcon} />
                      라이브러리에서 선택
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={imageGuard.busy}
                      className="flex flex-col items-center gap-1.5 px-2 py-4 rounded-xl bg-white ring-1 ring-slate-200/80 text-[12px] font-semibold text-slate-600 hover:ring-slate-300 hover:text-slate-800 transition shadow-sm disabled:opacity-50">
                      {imageGuard.busy
                        ? <Loader2 size={17} strokeWidth={1.8} className="text-slate-400 animate-spin" />
                        : <Upload size={17} strokeWidth={1.8} className="text-slate-400" />}
                      {imageGuard.busy ? '확인 중...' : '파일 업로드'}
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden"
                    onChange={(e) => { imageGuard.pickFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                  <p className="text-[11px] text-slate-400 text-center mt-2.5">
                    {brandImageHint('main')}
                  </p>
                </div>
              )}
              {imageGuard.error && <p className="text-[11px] text-rose-500 mt-2 px-1">{imageGuard.error}</p>}
            </div>
          )}

          {/* 버튼 */}
          {selectedType.maxBtn > 0 && !selectedType.isCarousel && mode === 'free' && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-[13px] font-semibold text-slate-700">
                  버튼 <span className="text-slate-400 font-normal">
                    최대 {effectiveMaxBtn}개{hasCoupon && selectedType.couponMaxBtn < selectedType.maxBtn ? ' (쿠폰 사용 시)' : ''} · 버튼명 {selectedType.maxBtnName}자
                  </span>
                </label>
                {buttons.length < effectiveMaxBtn && (
                  <button type="button" onClick={addButton}
                    className={`inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg ${a.link} transition`}>
                    <Plus size={13} strokeWidth={2.2} /> 버튼 추가
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {/* ⛔ 이 줄은 **격자**로 나눈다. 공용 입력칸 클래스(FIELD)에는 `w-full`·`px-3.5 py-2.5 text-sm` 이 들어 있어서,
                    뒤에 `w-28`·`px-2.5` 를 덧붙여도 이기지 못한다(Tailwind 는 클래스 적힌 순서가 아니라 생성된 CSS 순서로 정한다 —
                    `w-full` 이 `w-28` 보다 뒤). 0920 에 flex + `w-28` 로 두었다가 종류 선택칸이 줄 전체를 차지하고
                    버튼명·URL 칸이 패널 밖으로 밀려났다(Harold 캡처 · 커머스). 덮어쓸 값은 `!` 로 적는다(BrandRichSections 의 카드 버튼 줄과 같은 방식). */}
                {buttons.map((btn, idx) => {
                  const needUrl = !!BUTTON_TYPES.find(t => t.code === btn.type)?.needUrl;
                  return (
                  <div key={idx} className="grid grid-cols-[112px_minmax(0,1fr)_minmax(0,1.3fr)_28px] gap-1.5 items-center rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 p-2">
                    <select value={btn.type}
                      onChange={(e) => {
                        const next = e.target.value;
                        const spec = BUTTON_TYPES.find(t => t.code === next);
                        // 버튼명이 정해진 유형(채널추가)은 고를 때 바로 채워 넣는다 — 다시 묻지 않는다.
                        setButtons(buttons.map((b, i) => i === idx
                          ? { ...b, type: next, ...(spec?.fixedName ? { name: spec.fixedName } : {}) }
                          : b));
                      }}
                      className={`${FIELD} !px-2.5 !py-1.5 !text-xs`}>
                      {/* 대상 범위를 바꿔 지금은 못 쓰는 유형이 남아 있어도 선택칸이 비지 않게 그대로 보여준다
                          — 무엇이 걸렸는지는 발송 버튼 아래 한 줄이 알려준다 */}
                      {(availableButtonTypes.some(bt => bt.code === btn.type)
                        ? availableButtonTypes
                        : [...availableButtonTypes, BUTTON_TYPES.find(bt => bt.code === btn.type)!].filter(Boolean)
                      ).map(bt => <option key={bt.code} value={bt.code}>{bt.label}</option>)}
                    </select>
                    <input type="text" value={btn.name} onChange={(e) => updateButton(idx, 'name', e.target.value)}
                      maxLength={selectedType.maxBtnName}
                      className={`${FIELD} !px-2.5 !py-1.5 !text-xs ${needUrl ? '' : 'col-span-2'}`} placeholder="버튼명" />
                    {needUrl && (
                      <input type="text" value={btn.url_mobile || ''} onChange={(e) => updateButton(idx, 'url_mobile', e.target.value)}
                        onBlur={(e) => updateButton(idx, 'url_mobile', normalizeLinkInput(e.target.value))}
                        className={`${FIELD} !px-2.5 !py-1.5 !text-xs`} placeholder="URL (https://…)" />
                    )}
                    <button type="button" onClick={() => removeButton(idx)} aria-label="버튼 삭제"
                      className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-white transition">
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                  );
                })}
                {buttons.length === 0 && (
                  <p className="text-[11px] text-slate-400 px-1">버튼 없이 보낼 수 있습니다.</p>
                )}
              </div>
            </div>
          )}

          {/* 선택 항목 — 접힌 상태에서도 현재 값이 보인다 */}
          <div className="space-y-2.5">
            {mode === 'free' && !selectedType.isCarousel && (
              <Collapsible icon={<Ticket size={14} strokeWidth={1.9} />} title="쿠폰"
                stateText={hasCoupon ? (couponTitle || '입력 중') : '사용 안 함'} stateSet={hasCoupon}>
                {/* 쿠폰 제목은 카카오가 정한 5형식만 통과한다 — 자유 입력으로 받으면 반드시 거절되므로
                    형식을 고르고 값만 넣게 한다(틀릴 수 없는 입력) */}
                <select value={couponForm} onChange={(e) => { setCouponForm(e.target.value as any); setCouponValue(''); }}
                  className={FIELD}>
                  <option value="">쿠폰 사용 안 함</option>
                  <option value="amount">○○원 할인 쿠폰</option>
                  <option value="percent">○○% 할인 쿠폰</option>
                  <option value="shipping">배송비 할인 쿠폰</option>
                  <option value="free">○○ 무료 쿠폰</option>
                  <option value="up">○○ UP 쿠폰</option>
                </select>
                {hasCoupon && couponForm !== 'shipping' && (
                  <input type="text" value={couponValue} onChange={(e) => setCouponValue(e.target.value)}
                    maxLength={couponForm === 'free' || couponForm === 'up' ? 7 : 11}
                    inputMode={couponForm === 'amount' || couponForm === 'percent' ? 'numeric' : 'text'}
                    className={FIELD}
                    placeholder={
                      couponForm === 'amount' ? '할인 금액 (숫자만)'
                      : couponForm === 'percent' ? '할인율 1~100'
                      : '쿠폰 이름 (7자 이내)'
                    } />
                )}
                {hasCoupon && (
                  <>
                    {!!couponTitle && (
                      <p className="text-[11px] text-slate-400 px-1">표시될 제목: {couponTitle}</p>
                    )}
                    <input type="text" value={couponDesc} onChange={(e) => setCouponDesc(e.target.value)}
                      maxLength={selectedType.couponDescMax} className={FIELD}
                      placeholder={`쿠폰 설명 (최대 ${selectedType.couponDescMax}자)`} />
                    <input type="text" value={couponUrl} onChange={(e) => setCouponUrl(e.target.value)}
                      onBlur={(e) => setCouponUrl(normalizeLinkInput(e.target.value))}
                      className={FIELD} placeholder="쿠폰을 누르면 이동할 주소" />
                  </>
                )}
              </Collapsible>
            )}

            <Collapsible icon={<MessageSquareReply size={14} strokeWidth={1.9} />} title="대체 발송"
              stateText={resendType === 'SM' ? 'SMS로 대체' : resendType === 'LM' ? 'LMS로 대체' : '사용 안 함'}
              stateSet={resendType !== 'NO'}>
              <select value={resendType} onChange={(e) => setResendType(e.target.value)} className={FIELD}>
                <option value="NO">대체발송 없음</option>
                <option value="SM">SMS로 대체</option>
                <option value="LM">LMS로 대체</option>
              </select>
              {resendType !== 'NO' && (
                <>
                  <input type="text" value={resendFrom} onChange={(e) => setResendFrom(e.target.value)}
                    className={FIELD} placeholder="대체발송 발신번호 (비우면 기본 회신번호)" />
                  {resendType === 'LM' && (
                    <input type="text" value={resendTitle} onChange={(e) => setResendTitle(e.target.value)}
                      className={FIELD} placeholder="LMS 제목 (필수)" />
                  )}
                  <textarea value={resendMessage} onChange={(e) => setResendMessage(e.target.value)} rows={2}
                    className={`${FIELD} resize-none`} placeholder="대체발송 메시지 (빈칸이면 본문 재사용)" />
                  {noticeActive && (
                    <p className="text-[11px] text-slate-400 px-1">
                      AI 생성 이미지 안내 문구는 문자 대체발송에는 들어가지 않습니다.
                    </p>
                  )}
                </>
              )}
            </Collapsible>
          </div>
        </div>

        {/* ── 하단 고정 발송 바 — 무엇이 나가는지 요약과 함께 ── */}
        <div className="sticky bottom-0 z-10 border-t border-slate-100 bg-white/95 backdrop-blur-sm px-5 sm:px-6 py-3.5">
          {!!senderKey && !!blockReason && (
            <p className="text-[11.5px] text-rose-600 bg-rose-50 ring-1 ring-rose-200/60 rounded-xl px-3 py-2 mb-2.5 leading-relaxed">
              {blockReason}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-[12px] text-slate-500 leading-relaxed">
              {summaryParts.map((s, i) => (
                <span key={s}>
                  {i > 0 && <span className="text-slate-300 mx-1.5">·</span>}
                  {i === 0 && typeof recipientCount === 'number'
                    ? <b className="text-slate-800 font-bold">{s}</b>
                    : s}
                </span>
              ))}
              {noticeActive && (
                <>
                  <span className="text-slate-300 mx-1.5">·</span>
                  <span className={`font-semibold ${a.sumAccent}`}>AI 이미지 안내 포함</span>
                </>
              )}
            </div>
            <button type="button" onClick={handleSend} disabled={!canSend}
              className={`shrink-0 px-6 py-3 rounded-2xl text-sm font-bold text-white ${a.send} shadow-lg disabled:opacity-40 disabled:shadow-none inline-flex items-center justify-center gap-2 transition`}>
              {sending
                ? <><Loader2 size={16} className="animate-spin" /> 발송 중...</>
                : <><Send size={15} strokeWidth={2} /> 브랜드메시지 발송</>}
            </button>
          </div>
          {!senderKey && (
            <p className="text-[11px] text-slate-400 mt-1.5">발신 프로필을 선택하면 발송할 수 있습니다.</p>
          )}
        </div>
      </div>

      {/* ── 우측: 미리보기 ───────────────────────────────────────── */}
      <div className="w-full lg:w-[clamp(292px,29vw,392px)] shrink-0 p-5 lg:border-l lg:border-slate-100 lg:bg-slate-50/50">
        <div className="lg:sticky lg:top-5">
          <div className="flex items-baseline justify-between gap-2 mb-2.5">
            <h3 className="text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5">
              <PanelTop size={13} strokeWidth={1.9} className="text-slate-400" />
              미리보기
            </h3>
            <span className="text-[11px] text-slate-500">받는 사람 화면 그대로</span>
          </div>
          <BrandMessagePreview {...previewData} />
          <SourceCaption>카카오톡 실수신 화면 기준 · 입력값 실시간 반영</SourceCaption>
          {noticeActive && (
            <div className="mt-3 px-3 py-2.5 rounded-xl bg-white ring-1 ring-slate-900/5 shadow-sm text-[11.5px] text-slate-500 leading-relaxed">
              <span className="font-semibold text-violet-700">AI 생성 이미지 안내</span><br />
              심사 기준에 맞춰 본문 끝에 안내 문구가 자동으로 들어가며, 미리보기와 실제 발송이 같습니다.
            </div>
          )}
        </div>
      </div>

      {/* 유형 선택 창 — 발송이 열린 유형만 넘긴다 */}
      <BrandTypePickerModal
        show={typePickerOpen}
        accent={accent}
        codes={availableCodes}
        trialCodes={trialTypes}
        value={bubbleType}
        onPick={(code) => { setBubbleType(code); setButtons([]); setRich(initialRich(code)); setTypePickerOpen(false); }}
        onClose={() => setTypePickerOpen(false)}
      />

      {/* 이미지 라이브러리 픽커 — 공용 컴포넌트 재사용 + AI 생성 배지 */}
      <AssetLibraryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={imageGuard.pickAsset}
        showKindBadge
      />
      {imageGuard.modal}
    </div>
  );
}
