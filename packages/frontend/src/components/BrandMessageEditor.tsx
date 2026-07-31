/**
 * BrandMessageEditor — 브랜드메시지 작성 에디터
 *
 * 소비처 2곳: 직접발송 헤더의 브랜드메시지 모달(BrandSendModal) · KakaoRcsPage 브랜드 탭.
 * 두 곳이 같은 화면을 봐야 하므로 여기 하나만 고친다.
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
export const BUBBLE_TYPES = [
  { code: 'TEXT', label: '텍스트', maxMsg: 1300, maxBtn: 5, needImage: false, needHeader: false, desc: '텍스트 + 버튼' },
  { code: 'IMAGE', label: '이미지', maxMsg: 1300, maxBtn: 5, needImage: true, needHeader: false, desc: '이미지 + 텍스트 + 버튼' },
  { code: 'WIDE', label: '와이드', maxMsg: 76, maxBtn: 2, needImage: true, needHeader: false, desc: '가로 배너 + 짧은 텍스트' },
] as const;

export const BUTTON_TYPES = [
  { code: 'WL', label: '웹링크' },
  { code: 'AL', label: '앱링크' },
  { code: 'BK', label: '봇키워드' },
  { code: 'MD', label: '메시지전달' },
  { code: 'BF', label: '비즈니스폼' },
  { code: 'BC', label: '상담톡전환' },
  { code: 'BT', label: '봇전환' },
  { code: 'AC', label: '채널추가' },
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

  // 쿠폰
  const [couponTitle, setCouponTitle] = useState('');
  const [couponDesc, setCouponDesc] = useState('');
  const [couponUrl, setCouponUrl] = useState('');

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

  // 버튼 추가/삭제
  const addButton = () => {
    if (buttons.length >= selectedType.maxBtn) return;
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
    if (couponTitle) data.coupon = { title: couponTitle, description: couponDesc || undefined, link: couponUrl ? { url_mobile: couponUrl } : undefined };
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

  const canSend = !sending && !!senderKey && (mode === 'template' ? !!templateCode : !!message.trim());

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
              <label className="text-[13px] font-semibold text-slate-700">버튼 <span className="text-slate-400 font-normal">최대 {selectedType.maxBtn}개</span></label>
              {buttons.length < selectedType.maxBtn && (
                <button type="button" onClick={addButton}
                  className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg text-violet-600 hover:bg-violet-50 transition">
                  <Plus size={13} strokeWidth={2.2} /> 버튼 추가
                </button>
              )}
            </div>
            <div className="space-y-2">
              {buttons.map((btn, idx) => (
                <div key={idx} className="flex gap-2 items-center rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 p-2">
                  <select value={btn.type} onChange={(e) => updateButton(idx, 'type', e.target.value)}
                    className={`${FIELD_CLASS} w-28 shrink-0 px-2.5 py-1.5 text-xs`}>
                    {BUTTON_TYPES.map(bt => <option key={bt.code} value={bt.code}>{bt.label}</option>)}
                  </select>
                  <input type="text" value={btn.name} onChange={(e) => updateButton(idx, 'name', e.target.value)}
                    className={`${FIELD_CLASS} flex-1 px-2.5 py-1.5 text-xs`} placeholder="버튼명" />
                  {(btn.type === 'WL' || btn.type === 'AL') && (
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
              <input type="text" value={couponTitle} onChange={(e) => setCouponTitle(e.target.value)}
                className={FIELD_CLASS} placeholder="쿠폰 타이틀" />
              <input type="text" value={couponDesc} onChange={(e) => setCouponDesc(e.target.value)}
                className={FIELD_CLASS} placeholder="쿠폰 설명 (선택)" />
              <input type="text" value={couponUrl} onChange={(e) => setCouponUrl(e.target.value)}
                className={FIELD_CLASS} placeholder="쿠폰 URL (선택)" />
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
