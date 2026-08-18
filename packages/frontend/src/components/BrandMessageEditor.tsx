/**
 * BrandMessageEditor — 브랜드메시지 작성 에디터
 *
 * 소비처 1곳: 직접발송 헤더의 브랜드메시지 모달(BrandSendModal) → `POST /api/campaigns/brand-send`.
 * (★2026-08-18 실측 정정 — 옛 주석의 "KakaoRcsPage 브랜드 탭"은 이미 없어진 소비처였다)
 *
 * 여기 검사는 **입력을 미리 막아주는 거울**이고 최종 판정자는 백엔드 CT-12
 * (`utils/brand-message.ts` buildBrandQueuePayload)다 — 규격 값을 고칠 땐 양쪽을 같이 고친다.
 *
 * ★ 2026-07-31 재작성 — 화이트 고급형 + 죽은 분기 제거.
 *   ①톤: 회색 테두리(border) 대신 얇은 링·옅은 그림자·서브 서페이스로 층을 만든다.
 *     경계선을 줄이고 여백을 늘리는 쪽이 밀도가 낮아 보이고, 그게 고급스러움이다.
 *   ②죽은 분기 제거: 지원 유형이 TEXT·IMAGE·WIDE 셋으로 확정됐는데(발송 스펙 확보분)
 *     커머스·캐러셀·동영상·아이템리스트 입력 블록이 그대로 남아 있었다. `needVideo` 같은
 *     플래그가 어느 유형에도 없어 **절대 렌더되지 않는 코드**였다. 누르면 실패할 컨트롤을
 *     남겨두는 것과 같은 부류라 걷어낸다(발송 payload는 지원 3종 기준으로 무변경).
 */
import { useState } from 'react';
import { Image as ImageIcon, PanelTop, Plus, X, Ticket, MessageSquareReply, Ban, Loader2, Send } from 'lucide-react';
import BrandMessagePreview from './BrandMessagePreview';
import { FIELD_CLASS, PANEL_CLASS, SourceCaption } from './shared/SendWorkspaceShell';

// ============================================================
// 상수 (프론트 컨트롤타워 — 백엔드 CT-12와 동기)
// ============================================================
// ★ 2026-07-30 발송경로 재구축 — 발송 스펙이 확보된 TEXT·IMAGE·WIDE만 노출한다.
//   나머지 유형은 백엔드 CT-12가 입구에서 거부하므로 화면에도 두지 않는다(실패할 버튼 노출 금지).
// 값의 원천은 백엔드 CT-12(`utils/brand-message.ts` BUBBLE_TYPES)이고 그쪽이 최종 판정자다.
// 여기 표는 **입력 단계에서 미리 막아주는 거울**이다 — 두 벌이라 갈릴 수 있으므로 값을 고칠 때는
// 반드시 양쪽을 같이 고친다(근거 = IMC-Agent 매뉴얼 v2.3.1 §4.4.1 · §6.10.3.3 · §6.10.7.2).
export const BUBBLE_TYPES = [
  { code: 'TEXT', label: '텍스트', maxMsg: 1300, maxNewline: 99, maxBtn: 5, couponMaxBtn: 4, couponDescMax: 12, needImage: false, needHeader: false, desc: '텍스트 + 버튼' },
  { code: 'IMAGE', label: '이미지', maxMsg: 1300, maxNewline: 29, maxBtn: 5, couponMaxBtn: 4, couponDescMax: 12, needImage: true, needHeader: false, desc: '이미지 + 텍스트 + 버튼' },
  { code: 'WIDE', label: '와이드', maxMsg: 76, maxNewline: 5, maxBtn: 2, couponMaxBtn: 2, couponDescMax: 18, needImage: true, needHeader: false, desc: '가로 배너 + 짧은 텍스트' },
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
}

/** 유형 카드의 미니 구조도 — 이모지 대신 실제 말풍선 배치를 보여준다 */
function TypeThumb({ code, active }: { code: string; active: boolean }) {
  const bar = active ? 'bg-violet-200' : 'bg-slate-200';
  const img = active ? 'bg-violet-300' : 'bg-slate-300';
  return (
    <div className={`w-full h-[38px] rounded-lg p-1.5 flex flex-col gap-1 justify-center ${active ? 'bg-violet-50' : 'bg-slate-50'}`}>
      {code === 'IMAGE' && <div className={`h-3 w-full rounded ${img}`} />}
      {code === 'WIDE' && <div className={`h-4 w-full rounded ${img}`} />}
      <div className={`h-1 w-full rounded-full ${bar}`} />
      {code !== 'WIDE' && <div className={`h-1 w-2/3 rounded-full ${bar}`} />}
    </div>
  );
}

/** 접이식 선택 섹션 — 회색 박스 대신 얇은 링 카드 */
function Collapsible({ icon, title, children, defaultOpen }: {
  icon: React.ReactNode; title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-sm overflow-hidden">
      <summary className="px-4 py-3 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50/70 transition inline-flex items-center gap-2 w-full list-none">
        <span className="text-slate-400">{icon}</span>
        <span>{title}</span>
        <span className="ml-auto text-[11px] text-slate-300 group-open:hidden">펼치기</span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100">{children}</div>
    </details>
  );
}

export default function BrandMessageEditor({ profiles, onSend, sending }: BrandMessageEditorProps) {
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

  // 이미지
  const [imageUrl, setImageUrl] = useState('');
  const [imageLink, setImageLink] = useState('');

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

  /** 보내기 전에 걸리는 것 — 첫 한 줄만 알려주고 버튼을 잠근다 */
  const blockReason = (() => {
    if (mode === 'template') return templateCode.trim() ? '' : '';
    const msg = message.trim();
    if (msg.length > selectedType.maxMsg) return `본문이 ${selectedType.maxMsg}자를 넘었습니다`;
    if ((msg.match(/\n/g) || []).length > selectedType.maxNewline) return `줄바꿈은 최대 ${selectedType.maxNewline}개입니다`;
    if (selectedType.needImage && !imageUrl.trim()) return `${selectedType.label} 유형은 이미지가 필요합니다`;
    if (buttons.length > effectiveMaxBtn) {
      return hasCoupon
        ? `쿠폰을 함께 쓰면 버튼은 최대 ${effectiveMaxBtn}개입니다`
        : `버튼은 최대 ${effectiveMaxBtn}개입니다`;
    }
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      const spec = BUTTON_TYPES.find(t => t.code === b.type);
      if (!spec) return `${i + 1}번째 버튼은 지금 사용할 수 없는 종류입니다 — 다시 선택해주세요`;
      if (!b.name.trim()) return `${i + 1}번째 버튼의 버튼명을 입력해주세요`;
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
      if ((couponForm === 'free' || couponForm === 'up') && [...couponValue.trim()].length > 7) {
        return '쿠폰 이름은 7자까지 입력할 수 있습니다';
      }
      const desc = couponDesc.trim();
      if (!desc) return '쿠폰 설명을 입력해주세요';
      if ([...desc].length > selectedType.couponDescMax) return `쿠폰 설명은 최대 ${selectedType.couponDescMax}자입니다`;
      if (!couponUrl.trim()) return '쿠폰을 누르면 이동할 주소를 입력해주세요';
    }
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

  // 발송 — payload 키는 백엔드 CT-12 계약 그대로 유지한다(표현만 바뀌었다)
  const handleSend = () => {
    const data: any = {
      mode,
      bubbleType,
      senderKey,
      targeting,
      isAd,
      message: message || undefined,
      header: header || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
      resendType,
      resendFrom: resendFrom || undefined,
      resendMessage: resendMessage || undefined,
      resendTitle: resendTitle || undefined,
      unsubscribePhone: unsubPhone || undefined,
      unsubscribeAuth: unsubAuth || undefined,
    };

    if (imageUrl) data.image = { img_url: imageUrl, img_link: imageLink || undefined };
    // 쿠폰 클릭 URL은 매뉴얼 §6.10.7의 평면 키(url_mobile)다 — 옛 `link: {url_mobile}` 래핑은
    // 규격 밖 키라 클릭이 전달되지 않았다(2026-08-18 정정).
    if (couponTitle) data.coupon = { title: couponTitle, description: couponDesc, url_mobile: couponUrl || undefined };
    if (mode === 'template') data.templateCode = templateCode;

    onSend(data);
  };

  const previewData = {
    bubbleType,
    message: message || undefined,
    header: header || undefined,
    imageUrl: imageUrl || undefined,
    buttons: buttons.length > 0 ? buttons : undefined,
    couponTitle: couponTitle || undefined,
    isAd,
    unsubPhone: unsubPhone || undefined,
    profileName: selectedProfile?.profile_name,
  };

  const canSend = !sending && !!senderKey && !blockReason
    && (mode === 'template' ? !!templateCode : !!message.trim());

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
      {/* ── 좌측: 작성 ───────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-5">
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

        {/* 유형 선택 */}
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-2">메시지 유형</label>
          <div className="grid grid-cols-3 gap-2.5">
            {BUBBLE_TYPES.map(t => {
              const active = bubbleType === t.code;
              return (
                <button key={t.code} type="button" onClick={() => { setBubbleType(t.code); setButtons([]); }}
                  className={`p-2.5 rounded-2xl text-left transition shadow-sm ${
                    active
                      ? 'bg-white ring-2 ring-violet-500 shadow-violet-500/10'
                      : 'bg-white ring-1 ring-slate-200/80 hover:ring-slate-300'
                  }`}>
                  <TypeThumb code={t.code} active={active} />
                  <div className={`text-[13px] font-semibold mt-2 ${active ? 'text-violet-700' : 'text-slate-700'}`}>{t.label}</div>
                  <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 발신 프로필 · 타겟팅 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">발신 프로필</label>
            <select value={senderKey} onChange={(e) => setSenderKey(e.target.value)} className={FIELD_CLASS}>
              <option value="">선택하세요</option>
              {profiles.map(p => (
                <option key={p.id} value={p.profile_key}>{p.profile_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">타겟팅</label>
            <select value={targeting} onChange={(e) => setTargeting(e.target.value)} className={FIELD_CLASS}>
              {TARGETING_OPTIONS.map(t => (
                <option key={t.code} value={t.code}>{t.label} — {t.desc}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 광고 여부 */}
        <label className="inline-flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
          <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500/40" />
          광고 메시지 <span className="text-slate-400 text-[12px]">— 수신거부 표시가 필요합니다</span>
        </label>

        {/* 기본형: 템플릿 코드 */}
        {mode === 'template' && (
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">템플릿 코드</label>
            <input type="text" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}
              className={FIELD_CLASS} placeholder="사전 등록한 템플릿 코드" />
          </div>
        )}

        {/* 본문 */}
        {mode === 'free' && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label className="text-[13px] font-semibold text-slate-700">본문</label>
              <span className="text-[11px] text-slate-400 tabular-nums">{message.length} / {selectedType.maxMsg}</span>
            </div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={selectedType.maxMsg}
              rows={selectedType.maxMsg > 100 ? 7 : 3}
              className={`${FIELD_CLASS} resize-none leading-relaxed`} placeholder="보낼 내용을 입력하세요" />
          </div>
        )}

        {/* 이미지 */}
        {selectedType.needImage && (
          <div className={PANEL_CLASS}>
            <div className="flex items-center gap-2 mb-2.5">
              <ImageIcon size={14} strokeWidth={1.9} className="text-slate-400" />
              <span className="text-[13px] font-semibold text-slate-700">이미지</span>
              <span className="text-[11px] text-rose-500">필수</span>
            </div>
            <div className="space-y-2">
              <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
                className={FIELD_CLASS} placeholder="이미지 URL (jpg·png · 5MB 이하 · 800x400)" />
              <input type="text" value={imageLink} onChange={(e) => setImageLink(e.target.value)}
                className={FIELD_CLASS} placeholder="클릭 시 이동 URL (선택)" />
              {imageUrl && (
                <img src={imageUrl} alt="" className="w-full max-h-40 object-cover rounded-xl ring-1 ring-slate-200"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
            </div>
          </div>
        )}

        {/* 버튼 */}
        {selectedType.maxBtn > 0 && mode === 'free' && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-[13px] font-semibold text-slate-700">
                버튼 <span className="text-slate-400 font-normal">
                  최대 {effectiveMaxBtn}개{hasCoupon && selectedType.couponMaxBtn < selectedType.maxBtn ? ' (쿠폰 사용 시)' : ''}
                </span>
              </label>
              {buttons.length < effectiveMaxBtn && (
                <button type="button" onClick={addButton}
                  className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg text-violet-600 hover:bg-violet-50 transition">
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
                      // 버튼명이 정해진 유형(채널추가·비즈니스폼)은 고를 때 바로 채워 넣는다 — 다시 묻지 않는다.
                      setButtons(buttons.map((b, i) => i === idx
                        ? { ...b, type: next, ...(spec?.fixedName ? { name: spec.fixedName } : {}) }
                        : b));
                    }}
                    className={`${FIELD_CLASS} w-28 shrink-0 px-2.5 py-1.5 text-xs`}>
                    {/* 대상 범위를 바꿔 지금은 못 쓰는 유형이 남아 있어도 선택칸이 비지 않게 그대로 보여준다
                        — 무엇이 걸렸는지는 발송 버튼 아래 한 줄이 알려준다 */}
                    {(availableButtonTypes.some(bt => bt.code === btn.type)
                      ? availableButtonTypes
                      : [...availableButtonTypes, BUTTON_TYPES.find(bt => bt.code === btn.type)!].filter(Boolean)
                    ).map(bt => <option key={bt.code} value={bt.code}>{bt.label}</option>)}
                  </select>
                  <input type="text" value={btn.name} onChange={(e) => updateButton(idx, 'name', e.target.value)}
                    className={`${FIELD_CLASS} flex-1 px-2.5 py-1.5 text-xs`} placeholder="버튼명" />
                  {BUTTON_TYPES.find(t => t.code === btn.type)?.needUrl && (
                    <input type="text" value={btn.url_mobile || ''} onChange={(e) => updateButton(idx, 'url_mobile', e.target.value)}
                      className={`${FIELD_CLASS} flex-1 px-2.5 py-1.5 text-xs`} placeholder="URL" />
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

        {/* 선택 항목 */}
        <div className="space-y-2.5">
          {mode === 'free' && (
            <Collapsible icon={<Ticket size={14} strokeWidth={1.9} />} title="쿠폰 (선택)">
              {/* 쿠폰 제목은 카카오가 정한 5형식만 통과한다 — 자유 입력으로 받으면 반드시 거절되므로
                  형식을 고르고 값만 넣게 한다(틀릴 수 없는 입력) */}
              <select value={couponForm} onChange={(e) => { setCouponForm(e.target.value as any); setCouponValue(''); }}
                className={FIELD_CLASS}>
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
                  className={FIELD_CLASS}
                  placeholder={
                    couponForm === 'amount' ? '할인 금액 (숫자만)'
                    : couponForm === 'percent' ? '할인율 1~100'
                    : '쿠폰 이름 (7자 이내)'
                  } />
              )}
              {hasCoupon && (
                <>
                  {!!couponTitle && (
                    <p className="text-[11px] text-slate-400 px-1">표시될 제목 — {couponTitle}</p>
                  )}
                  <input type="text" value={couponDesc} onChange={(e) => setCouponDesc(e.target.value)}
                    maxLength={selectedType.couponDescMax} className={FIELD_CLASS}
                    placeholder={`쿠폰 설명 (최대 ${selectedType.couponDescMax}자)`} />
                  <input type="text" value={couponUrl} onChange={(e) => setCouponUrl(e.target.value)}
                    className={FIELD_CLASS} placeholder="쿠폰을 누르면 이동할 주소" />
                </>
              )}
            </Collapsible>
          )}

          <Collapsible icon={<MessageSquareReply size={14} strokeWidth={1.9} />} title="대체 발송 (선택)">
            <select value={resendType} onChange={(e) => setResendType(e.target.value)} className={FIELD_CLASS}>
              <option value="NO">대체발송 없음</option>
              <option value="SM">SMS로 대체</option>
              <option value="LM">LMS로 대체</option>
            </select>
            {resendType !== 'NO' && (
              <>
                <input type="text" value={resendFrom} onChange={(e) => setResendFrom(e.target.value)}
                  className={FIELD_CLASS} placeholder="대체발송 발신번호 (비우면 기본 회신번호)" />
                {resendType === 'LM' && (
                  <input type="text" value={resendTitle} onChange={(e) => setResendTitle(e.target.value)}
                    className={FIELD_CLASS} placeholder="LMS 제목 (필수)" />
                )}
                <textarea value={resendMessage} onChange={(e) => setResendMessage(e.target.value)} rows={2}
                  className={`${FIELD_CLASS} resize-none`} placeholder="대체발송 메시지 (빈칸이면 본문 재사용)" />
              </>
            )}
          </Collapsible>

          {isAd && (
            <Collapsible icon={<Ban size={14} strokeWidth={1.9} />} title="수신거부 080" defaultOpen>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={unsubPhone} onChange={(e) => setUnsubPhone(e.target.value)}
                  className={FIELD_CLASS} placeholder="080 번호" />
                <input type="text" value={unsubAuth} onChange={(e) => setUnsubAuth(e.target.value)}
                  className={FIELD_CLASS} placeholder="인증번호" />
              </div>
            </Collapsible>
          )}
        </div>

        {/* 발송 */}
        <button type="button" onClick={handleSend} disabled={!canSend}
          className="w-full py-3.5 rounded-2xl text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-500/25 disabled:opacity-40 disabled:shadow-none inline-flex items-center justify-center gap-2 transition">
          {sending
            ? <><Loader2 size={16} className="animate-spin" /> 발송 중...</>
            : <><Send size={15} strokeWidth={2} /> 브랜드메시지 발송</>}
        </button>
        {!senderKey && (
          <p className="text-[11px] text-slate-400 text-center -mt-2">발신 프로필을 선택하면 발송할 수 있습니다.</p>
        )}
        {/* 무엇 때문에 못 보내는지 한 줄로 — 눌러도 반응 없는 버튼을 만들지 않는다 */}
        {!!senderKey && !!blockReason && (
          <p className="text-[11px] text-rose-500 text-center -mt-2">{blockReason}</p>
        )}
      </div>

      {/* ── 우측: 미리보기 ───────────────────────────────────────── */}
      <div className="w-full lg:w-[320px] shrink-0">
        <div className="lg:sticky lg:top-0">
          <h3 className="text-[13px] font-semibold text-slate-700 mb-2.5 inline-flex items-center gap-1.5">
            <PanelTop size={13} strokeWidth={1.9} className="text-slate-400" />
            미리보기
          </h3>
          <BrandMessagePreview {...previewData} />
          <SourceCaption>카카오 브랜드메시지 규격 (텍스트·이미지·와이드)</SourceCaption>
        </div>
      </div>
    </div>
  );
}
