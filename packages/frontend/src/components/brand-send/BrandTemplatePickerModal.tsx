/**
 * BrandTemplatePickerModal — 브랜드메시지 등록 템플릿 고르기 창 (★2026-09-25 Harold 목업 v2 승인)
 *
 * 예전에는 기본형(템플릿) 발송에서 템플릿 코드를 손으로 적었다. 관리 메뉴에서 등록한 템플릿을
 * 받는 화면 그대로(`BrandMessagePreview` · 값 = `brandTemplatePreviewProps`) 보여 주고 고르게 한다.
 *   목록 = `GET /api/alimtalk/brand-templates`(회사 · 사용 중 · 최근 수정 순). 새 서버 입구를 만들지 않는다.
 *   고르면 호출부가 템플릿 코드(= `template_key` · 발송 큐 `k_template_code`)와 그 템플릿의 발신프로필을 넣는다.
 *
 * ⛔ 고를 수 없는 템플릿(흐리게 · 이유 표시) — 보내는 쪽이 싣지 못하는 것은 고르는 단계에서 막는다:
 *   - 변수가 있는 템플릿 — 이 창의 기본형 발송은 템플릿 코드만 싣는다(`BrandMessageEditor` handleSend).
 *     ★Codex 1R: `variables` 칸만 보면 샌다 — 등록 화면이 그 칸을 보내지 않아 늘 빈 목록이다.
 *     그래서 본문·머리글·부가 설명·버튼·첨부·캐러셀·쿠폰 어디든 `#{...}` 가 있으면 막는다.
 *   - 발송이 열리지 않은 유형 — 기본형 발송은 시험 계정 허용 없이 유형을 검사한다(백엔드 buildBrandQueuePayload).
 *   - 발신프로필을 이 창에서 쓸 수 없는 템플릿 — 템플릿은 등록한 발신프로필로만 보낼 수 있다.
 * 겹침: 문서 몸통으로 포털(z 2100). 배경 클릭으로 닫히지 않는다(0704 룰). 닫기 = 고르기 · 닫기 · ESC.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Library, Loader2, Search, X } from 'lucide-react';
import BrandMessagePreview from '../BrandMessagePreview';
import { BRAND_SPEC } from '../../constants/brand-message-spec';
import { brandTemplatePreviewProps, type BrandTemplateRow } from './brandTemplatePreview';

interface Props {
  open: boolean;
  /** 이 창에서 쓸 수 있는 발신프로필 키 — 템플릿의 발신프로필이 여기 없으면 고를 수 없다 */
  profileKeys: string[];
  selectedKey: string;
  /** 지금 창의 광고 표기 — 미리보기에만 쓴다 */
  isAd: boolean;
  accentHex: string;
  onPick: (t: BrandTemplateRow) => void;
  onClose: () => void;
}

const VAR_TOKEN_RE = /#\{[^}]+\}/;
/**
 * 값 안의 **문자열마다** 변수 표기가 있는가 — 배열·객체는 따라 들어간다.
 * ★Codex 2R: JSON 으로 합쳐 검사하면 `#{ 안내` 같은 닫히지 않은 글이 JSON 의 닫는 `}` 와 짝을 이뤄 변수로 오인됐다.
 */
function hasVarInStrings(v: unknown, depth = 0): boolean {
  if (v === null || v === undefined || depth > 8) return false;
  if (typeof v === 'string') return VAR_TOKEN_RE.test(v);
  if (Array.isArray(v)) return v.some((x) => hasVarInStrings(x, depth + 1));
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => hasVarInStrings(x, depth + 1));
  return false;
}

/** 템플릿 어디에든 변수 표기(`#{...}`)가 있는가 — 칸 목록(variables)과 실제 글·버튼·첨부를 모두 본다 */
export function brandTemplateHasVariables(t: BrandTemplateRow): boolean {
  if (Array.isArray(t.variables) && t.variables.length > 0) return true;
  return [
    t.content, t.header, t.additional_content, t.buttons,
    t.attachment ?? t.attachment_json, t.carousel ?? t.carousel_json, t.coupon,
  ].some((v) => hasVarInStrings(v));
}

export function brandTemplateBlockReason(t: BrandTemplateRow, profileKeys: string[]): string {
  if (brandTemplateHasVariables(t)) return '변수가 있어 이 창에서는 값을 채울 수 없어요';
  if (!BRAND_SPEC[t.chat_bubble_type]?.opened) return '이 유형은 등록 템플릿 발송이 아직 열리지 않았어요';
  if (!t.profile_key || !profileKeys.includes(t.profile_key)) return '이 발신프로필로는 보낼 수 없어요';
  return '';
}
const blockOf = brandTemplateBlockReason;

export default function BrandTemplatePickerModal({ open, profileKeys, selectedKey, isAd, accentHex, onPick, onClose }: Props) {
  const [rows, setRows] = useState<BrandTemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [focusKey, setFocusKey] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTypeFilter('');
    setQuery('');
    setFocusKey(selectedKey);
    setLoading(true);
    setError('');
    fetch('/api/alimtalk/brand-templates', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !d?.success) throw new Error(d?.error || '템플릿 목록을 불러오지 못했어요.');
        setRows(Array.isArray(d.templates) ? d.templates : []);
      })
      .catch((e: any) => { if (alive) setError(e?.message || '템플릿 목록을 불러오지 못했어요.'); })
      .finally(() => { if (alive) setLoading(false); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { alive = false; document.removeEventListener('keydown', onKey, true); };
  }, [open, selectedKey]);

  const types = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((t) => m.set(t.chat_bubble_type, (m.get(t.chat_bubble_type) || 0) + 1));
    return Array.from(m.entries());
  }, [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((t) => (!typeFilter || t.chat_bubble_type === typeFilter)
      && (!q || `${t.manage_name} ${t.template_key} ${t.custom_template_code || ''} ${t.content || ''}`.toLowerCase().includes(q)));
  }, [rows, typeFilter, query]);

  if (!open) return null;
  const focus = rows.find((t) => t.template_key === focusKey && !blockOf(t, profileKeys)) || null;

  return createPortal(
    <div className="ds-scope ks-picker-back" role="dialog" aria-modal="true" aria-labelledby="ks-bt-picker-title">
      <div className="ks-picker" style={{ ['--ks-accent' as any]: accentHex }}>
        <div className="ks-picker__head">
          <span className="ks-picker__ic" style={{ background: accentHex }}><Library size={18} strokeWidth={2} /></span>
          <div className="min-w-0">
            <b id="ks-bt-picker-title">등록 템플릿 고르기</b>
            <small>{loading ? '불러오는 중…' : `관리 메뉴에서 등록한 템플릿 ${rows.length}개 · 받는 사람에게 보이는 모습 그대로예요`}</small>
          </div>
          <button type="button" className="ks-pop__x ml-auto" onClick={onClose} aria-label="닫기"><X size={18} strokeWidth={2} /></button>
        </div>

        <div className="ks-picker__tools">
          <button type="button" className={`ks-chipf ${!typeFilter ? 'on' : ''}`} onClick={() => setTypeFilter('')}>전체 {rows.length}</button>
          {types.map(([code, n]) => (
            <button key={code} type="button" className={`ks-chipf ${typeFilter === code ? 'on' : ''}`} onClick={() => setTypeFilter(code)}>
              {BRAND_SPEC[code]?.label || code} {n}
            </button>
          ))}
          <label className="ks-picker__search">
            <Search size={14} strokeWidth={1.9} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 코드 · 내용 검색" aria-label="템플릿 검색" />
          </label>
        </div>

        <div className="ks-picker__grid">
          {loading ? (
            <div className="ks-picker__empty"><Loader2 size={18} className="animate-spin inline-block mr-1.5 -mt-0.5" />템플릿을 불러오고 있어요</div>
          ) : error ? (
            <div className="ks-picker__empty">{error}</div>
          ) : shown.length === 0 ? (
            <div className="ks-picker__empty">
              {rows.length === 0
                ? '등록된 브랜드메시지 템플릿이 없어요. 관리 메뉴의 브랜드메시지 템플릿에서 등록하면 여기에 보여요.'
                : '조건에 맞는 템플릿이 없어요'}
            </div>
          ) : (
            shown.map((t) => {
              const block = blockOf(t, profileKeys);
              const on = !block && focusKey === t.template_key;
              return (
                <button
                  key={t.id || t.template_key}
                  type="button"
                  disabled={!!block}
                  className={`ks-card ${on ? 'on' : ''}`}
                  onClick={() => setFocusKey(t.template_key)}
                  onDoubleClick={() => { if (!block) { onPick(t); onClose(); } }}
                  aria-pressed={on}
                  title={block || undefined}
                >
                  <div className="ks-card__view" aria-hidden>
                    <BrandMessagePreview {...brandTemplatePreviewProps(t, isAd)} />
                  </div>
                  <div className="ks-card__meta">
                    <b title={t.manage_name}>{t.manage_name || t.template_key}</b>
                    <small>{`${BRAND_SPEC[t.chat_bubble_type]?.label || t.chat_bubble_type} · ${t.profile_name || '발신프로필 없음'} · ${t.custom_template_code || t.template_key}`}</small>
                    <div className="ks-tags">
                      {block ? <span className="wait">{block}</span> : <span className="ok">고를 수 있어요</span>}
                      {selectedKey === t.template_key && <span>지금 쓰는 중</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="ks-picker__foot">
          <p className="ks-note">고르면 템플릿 코드 · 발신프로필 · 메시지 유형이 함께 맞춰지고, 직접 넣은 이미지는 비워져요(이미지도 템플릿 것을 써요). 템플릿 본문은 고칠 수 없어요. 카드를 두 번 누르면 바로 골라져요.</p>
          <button type="button" className="ks-picker__cancel" onClick={onClose}>닫기</button>
          <button
            type="button"
            className="ks-picker__ok"
            style={{ background: accentHex }}
            disabled={!focus}
            onClick={() => { if (focus) { onPick(focus); onClose(); } }}
          >
            <Check size={15} strokeWidth={2.4} />
            {focus ? '이 템플릿으로 보내기' : '템플릿을 골라 주세요'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
