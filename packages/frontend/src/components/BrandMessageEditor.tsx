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
 */
import { useRef, useState } from 'react';
import {
  Image as ImageIcon, PanelTop, Plus, X, Ticket, MessageSquareReply, Ban, Loader2, Send,
  FolderOpen, Upload, Sparkles, ChevronDown,
} from 'lucide-react';
import BrandMessagePreview from './BrandMessagePreview';
import AssetLibraryPickerModal, { type PickedAsset } from './assets/AssetLibraryPickerModal';
import { FIELD_CLASS, FIELD_CLASS_INDIGO, PANEL_CLASS, SourceCaption } from './shared/SendWorkspaceShell';

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

/** 라이브러리·업로드 응답의 상대 URL(공개 서빙)을 카카오가 내려받을 절대 URL로 */
const toAbsoluteUrl = (u: string): string => {
  try { return new URL(u, window.location.origin).toString(); } catch { return u; }
};

/**
 * ★ 2026-08-21 강조색을 호출자가 고른다. 직접발송 진입 = violet(기존 그대로), 직접 타겟 발송 진입 = indigo(콘솔 톤).
 *   색 값은 이 표 하나만 갖고, 아래 JSX는 이름만 부른다(조립 문자열 0 = Tailwind 스캐너가 읽는다).
 *   AI 배지·안내 칩은 액센트와 무관하게 violet 고정 — 앱 전체에서 AI 정체성 색이다.
 */
export type EditorAccent = 'violet' | 'indigo';
const ACCENT = {
  violet: {
    field: FIELD_CLASS,
    thumbBar: 'bg-violet-200', thumbImg: 'bg-violet-300', thumbBg: 'bg-violet-50',
    cardOn: 'bg-white ring-2 ring-violet-500 shadow-violet-500/10',
    cardText: 'text-violet-700',
    specOn: 'bg-violet-50 text-violet-600',
    check: 'text-violet-600 focus:ring-violet-500/40',
    link: 'text-violet-600 hover:bg-violet-50',
    actPrimary: 'ring-1 ring-violet-200 text-violet-700 bg-gradient-to-b from-white to-violet-50 hover:ring-violet-300',
    actIcon: 'text-violet-500',
    send: 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-violet-500/25',
    sumAccent: 'text-violet-600',
  },
  indigo: {
    field: FIELD_CLASS_INDIGO,
    thumbBar: 'bg-indigo-200', thumbImg: 'bg-indigo-300', thumbBg: 'bg-indigo-50',
    cardOn: 'bg-white ring-2 ring-indigo-600 shadow-indigo-500/10',
    cardText: 'text-indigo-700',
    specOn: 'bg-indigo-50 text-indigo-600',
    check: 'text-indigo-600 focus:ring-indigo-500/40',
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
export const BUBBLE_TYPES = [
  { code: 'TEXT', label: '텍스트', maxMsg: 1300, maxNewline: 99, maxBtn: 5, couponMaxBtn: 4, couponDescMax: 12, maxBtnName: 14, needImage: false, needHeader: false, desc: '텍스트 + 버튼', spec1: '본문 1,300자', spec2: '버튼 5개' },
  { code: 'IMAGE', label: '이미지', maxMsg: 1300, maxNewline: 29, maxBtn: 5, couponMaxBtn: 4, couponDescMax: 12, maxBtnName: 14, needImage: true, needHeader: false, desc: '이미지 + 텍스트 + 버튼', spec1: '이미지 필수', spec2: '본문 1,300자' },
  { code: 'WIDE', label: '와이드', maxMsg: 76, maxNewline: 5, maxBtn: 2, couponMaxBtn: 2, couponDescMax: 18, maxBtnName: 8, needImage: true, needHeader: false, desc: '가로 배너 + 짧은 텍스트', spec1: '가로 배너', spec2: '본문 76자' },
] as const;

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
}

/** 유형 카드의 미니 구조도 — 이모지 대신 실제 말풍선 배치를 보여준다 */
function TypeThumb({ code, active, accent }: { code: string; active: boolean; accent: EditorAccent }) {
  const a = ACCENT[accent];
  const bar = active ? a.thumbBar : 'bg-slate-200';
  const img = active ? a.thumbImg : 'bg-slate-300';
  return (
    <div className={`w-full h-[38px] rounded-lg p-1.5 flex flex-col gap-1 justify-center ${active ? a.thumbBg : 'bg-slate-50'}`}>
      {code === 'IMAGE' && <div className={`h-3 w-full rounded ${img}`} />}
      {code === 'WIDE' && <div className={`h-4 w-full rounded ${img}`} />}
      <div className={`h-1 w-full rounded-full ${bar}`} />
      {code !== 'WIDE' && <div className={`h-1 w-2/3 rounded-full ${bar}`} />}
    </div>
  );
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

export default function BrandMessageEditor({ profiles, onSend, sending, accent = 'violet', recipientCount }: BrandMessageEditorProps) {
  const a = ACCENT[accent];
  const FIELD = a.field;
  const [mode, setMode] = useState<'free' | 'template'>('free');
  const [bubbleType, setBubbleType] = useState('TEXT');
  const [senderKey, setSenderKey] = useState('');
  const [targeting, setTargeting] = useState('I');
  const [isAd, setIsAd] = useState(true);

  // 메시지 내용
  const [message, setMessage] = useState('');
  const [header] = useState('');   // 지원 3종은 헤더를 쓰지 않는다(스펙 확보 시 입력 배선)

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
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * ★Codex 1R H4 수용 — 이미지 소스 세대. 업로드 중에 라이브러리 선택·URL 입력·제거가 일어나면
   * 세대를 올려, 늦게 도착한 업로드 응답이 사용자의 마지막 선택을 덮지 못하게 한다
   * (BrandSendModal의 reqSeqRef와 같은 패턴).
   */
  const imageSeqRef = useRef(0);

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

  // 수신거부
  const [unsubPhone, setUnsubPhone] = useState('');
  const [unsubAuth, setUnsubAuth] = useState('');

  // 기본형(템플릿)
  const [templateCode, setTemplateCode] = useState('');

  const selectedType = BUBBLE_TYPES.find(t => t.code === bubbleType) || BUBBLE_TYPES[0];
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

  // 이미지 입력 — 상태를 바꾸는 모든 통로가 세대를 올린다(진행 중 업로드 응답 무효화)
  // ★2026-09-02 URL 직접 입력 제거: img_url에는 카카오 콘텐츠 서버 업로드본만 실을 수 있어
  //   임의 주소는 애초에 발송이 안 된다. 라이브러리·업로드 둘 다 서버가 카카오로 올려 준다.
  const applyPickedAsset = (asset: PickedAsset) => {
    imageSeqRef.current++;
    setUploading(false);
    setImageUrl(toAbsoluteUrl(asset.url));
    setImageAssetId(asset.id);
    setImageKind(asset.kind);
    setImageName(asset.filename || '라이브러리 이미지');
    setImageError('');
  };

  const handleUploadFile = async (file: File | null) => {
    if (!file) return;
    const seq = ++imageSeqRef.current;
    setUploading(true);
    setImageError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: fd,
      });
      const data = await res.json();
      if (seq !== imageSeqRef.current) return;   // 그 사이 다른 이미지를 골랐다 — 이 응답은 버린다
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '업로드하지 못했습니다.'));
      setImageUrl(toAbsoluteUrl(String(data.url || '')));
      setImageAssetId(String(data.assetId || ''));
      setImageKind('uploaded');
      setImageName(String(data.filename || file.name));
    } catch (e: any) {
      if (seq === imageSeqRef.current) setImageError(e?.message || '업로드하지 못했습니다.');
    } finally {
      if (seq === imageSeqRef.current) setUploading(false);
    }
  };

  const clearImage = () => {
    imageSeqRef.current++;
    setUploading(false);
    setImageUrl(''); setImageLink(''); setImageAssetId(''); setImageKind(''); setImageName('');
    setImageError('');
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
      unsubscribePhone: unsubPhone || undefined,
      unsubscribeAuth: unsubAuth || undefined,
    };

    if (mode === 'free') {
      data.message = message || undefined;
      data.header = header || undefined;
      data.buttons = buttons.length > 0 ? buttons : undefined;
      // 쿠폰 클릭 URL은 매뉴얼 §6.10.7의 평면 키(url_mobile)다 — 옛 `link: {url_mobile}` 래핑은
      // 규격 밖 키라 클릭이 전달되지 않았다(2026-08-18 정정).
      if (couponTitle) data.coupon = { title: couponTitle, description: couponDesc, url_mobile: couponUrl || undefined };
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

  const previewData = {
    bubbleType,
    message: message || undefined,
    header: header || undefined,
    imageUrl: (imageUrl && selectedType.needImage) ? imageUrl : undefined,
    buttons: buttons.length > 0 ? buttons : undefined,
    couponTitle: couponTitle || undefined,
    isAd,
    unsubPhone: unsubPhone || undefined,
    profileName: selectedProfile?.profile_name,
    aiNoticeText: noticeActive ? AI_IMAGE_NOTICE : undefined,
  };

  const canSend = !sending && !!senderKey && !blockReason
    && (mode === 'template' ? !!templateCode : !!message.trim());

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

          {/* 유형 선택 — 카드에 규격 힌트를 같이 보여준다(고르고 나서야 76자를 아는 구조 금지) */}
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-2">메시지 유형</label>
            <div className="grid grid-cols-3 gap-2.5">
              {BUBBLE_TYPES.map(t => {
                const active = bubbleType === t.code;
                return (
                  <button key={t.code} type="button" onClick={() => { setBubbleType(t.code); setButtons([]); }}
                    className={`p-2.5 rounded-2xl text-left transition shadow-sm ${
                      active
                        ? a.cardOn
                        : 'bg-white ring-1 ring-slate-200/80 hover:ring-slate-300'
                    }`}>
                    <TypeThumb code={t.code} active={active} accent={accent} />
                    <div className={`text-[13px] font-semibold mt-2 ${active ? a.cardText : 'text-slate-700'}`}>{t.label}</div>
                    <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{t.desc}</div>
                    <div className="flex gap-1 flex-wrap mt-1.5">
                      {[t.spec1, t.spec2].map(s => (
                        <span key={s} className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${active ? a.specOn : 'bg-slate-50 text-slate-400'}`}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 발신 프로필 · 타겟팅 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">발신 프로필</label>
              <select value={senderKey} onChange={(e) => setSenderKey(e.target.value)} className={FIELD}>
                <option value="">선택하세요</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.profile_key}>{p.profile_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">타겟팅</label>
              <select value={targeting} onChange={(e) => setTargeting(e.target.value)} className={FIELD}>
                {TARGETING_OPTIONS.map(t => (
                  <option key={t.code} value={t.code}>{t.label}: {t.desc}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 광고 여부 */}
          <label className="inline-flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)}
              className={`w-4 h-4 rounded border-slate-300 ${a.check}`} />
            광고 메시지 <span className="text-slate-400 text-[12px]">(수신거부 표시가 필요합니다)</span>
          </label>

          {/* 기본형: 템플릿 코드 */}
          {mode === 'template' && (
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">템플릿 코드</label>
              <input type="text" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}
                className={FIELD} placeholder="사전 등록한 템플릿 코드" />
            </div>
          )}

          {/* 본문 — 카운터가 글자·줄바꿈·AI 문구 몫까지 미리 계산한다 */}
          {mode === 'free' && (
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
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="flex flex-col items-center gap-1.5 px-2 py-4 rounded-xl bg-white ring-1 ring-slate-200/80 text-[12px] font-semibold text-slate-600 hover:ring-slate-300 hover:text-slate-800 transition shadow-sm disabled:opacity-50">
                      {uploading
                        ? <Loader2 size={17} strokeWidth={1.8} className="text-slate-400 animate-spin" />
                        : <Upload size={17} strokeWidth={1.8} className="text-slate-400" />}
                      {uploading ? '올리는 중...' : '파일 업로드'}
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
                    onChange={(e) => { handleUploadFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                  <p className="text-[11px] text-slate-400 text-center mt-2.5">
                    jpg·png · 업로드 2MB 이하 · 권장 800×400
                  </p>
                </div>
              )}
              {imageError && <p className="text-[11px] text-rose-500 mt-2 px-1">{imageError}</p>}
            </div>
          )}

          {/* 버튼 */}
          {selectedType.maxBtn > 0 && mode === 'free' && (
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
                {buttons.map((btn, idx) => (
                  <div key={idx} className="flex gap-2 items-center rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 p-2">
                    <select value={btn.type}
                      onChange={(e) => {
                        const next = e.target.value;
                        const spec = BUTTON_TYPES.find(t => t.code === next);
                        // 버튼명이 정해진 유형(채널추가)은 고를 때 바로 채워 넣는다 — 다시 묻지 않는다.
                        setButtons(buttons.map((b, i) => i === idx
                          ? { ...b, type: next, ...(spec?.fixedName ? { name: spec.fixedName } : {}) }
                          : b));
                      }}
                      className={`${FIELD} w-28 shrink-0 px-2.5 py-1.5 text-xs`}>
                      {/* 대상 범위를 바꿔 지금은 못 쓰는 유형이 남아 있어도 선택칸이 비지 않게 그대로 보여준다
                          — 무엇이 걸렸는지는 발송 버튼 아래 한 줄이 알려준다 */}
                      {(availableButtonTypes.some(bt => bt.code === btn.type)
                        ? availableButtonTypes
                        : [...availableButtonTypes, BUTTON_TYPES.find(bt => bt.code === btn.type)!].filter(Boolean)
                      ).map(bt => <option key={bt.code} value={bt.code}>{bt.label}</option>)}
                    </select>
                    <input type="text" value={btn.name} onChange={(e) => updateButton(idx, 'name', e.target.value)}
                      maxLength={selectedType.maxBtnName}
                      className={`${FIELD} flex-1 px-2.5 py-1.5 text-xs`} placeholder="버튼명" />
                    {BUTTON_TYPES.find(t => t.code === btn.type)?.needUrl && (
                      <input type="text" value={btn.url_mobile || ''} onChange={(e) => updateButton(idx, 'url_mobile', e.target.value)}
                        className={`${FIELD} flex-1 px-2.5 py-1.5 text-xs`} placeholder="URL" />
                    )}
                    <button type="button" onClick={() => removeButton(idx)}
                      className="shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-white transition">
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                ))}
                {buttons.length === 0 && (
                  <p className="text-[11px] text-slate-400 px-1">버튼 없이 보낼 수 있습니다.</p>
                )}
              </div>
            </div>
          )}

          {/* 선택 항목 — 접힌 상태에서도 현재 값이 보인다 */}
          <div className="space-y-2.5">
            {mode === 'free' && (
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

            {isAd && (
              <Collapsible icon={<Ban size={14} strokeWidth={1.9} />} title="수신거부 080" defaultOpen
                stateText={unsubPhone.trim() ? unsubPhone.trim() : '미입력'} stateSet={!!unsubPhone.trim()}>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={unsubPhone} onChange={(e) => setUnsubPhone(e.target.value)}
                    className={FIELD} placeholder="080 번호" />
                  <input type="text" value={unsubAuth} onChange={(e) => setUnsubAuth(e.target.value)}
                    className={FIELD} placeholder="인증번호" />
                </div>
              </Collapsible>
            )}
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
      <div className="w-full lg:w-[320px] shrink-0 p-5 sm:p-6 lg:pl-0">
        <div className="lg:sticky lg:top-5">
          <h3 className="text-[13px] font-semibold text-slate-700 mb-2.5 inline-flex items-center gap-1.5">
            <PanelTop size={13} strokeWidth={1.9} className="text-slate-400" />
            미리보기
          </h3>
          <BrandMessagePreview {...previewData} />
          <SourceCaption>카카오 브랜드메시지 규격 (텍스트·이미지·와이드)</SourceCaption>
          {noticeActive && (
            <div className="mt-3 px-3 py-2.5 rounded-xl bg-white ring-1 ring-slate-900/5 shadow-sm text-[11.5px] text-slate-500 leading-relaxed">
              <span className="font-semibold text-violet-700">AI 생성 이미지 안내</span><br />
              심사 기준에 맞춰 본문 끝에 안내 문구가 자동으로 들어가며, 미리보기와 실제 발송이 같습니다.
            </div>
          )}
        </div>
      </div>

      {/* 이미지 라이브러리 픽커 — 공용 컴포넌트 재사용 + AI 생성 배지 */}
      <AssetLibraryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={applyPickedAsset}
        showKindBadge
      />
    </div>
  );
}
