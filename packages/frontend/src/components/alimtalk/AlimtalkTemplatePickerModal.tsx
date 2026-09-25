/**
 * AlimtalkTemplatePickerModal — 알림톡 템플릿 고르기 창 (★2026-09-25 Harold 목업 v2 승인)
 *
 * 템플릿을 받는 화면 예시로 보여 주고 고른다. 예시는 공용 패널과 같은 값(`buildAlimtalkPreviewProps`)으로 그린다.
 * ⛔ 승인 템플릿만 고를 수 있다 — 판정은 공용 패널과 같은 한 벌(`isApprovedAlimtalkTemplate`).
 *    승인 전 템플릿은 [승인 전] 탭에서 흐리게 보이고 눌리지 않는다(보내기 버튼이 막는 규칙과 같다).
 * ⛔ 이 창은 고른 템플릿만 돌려준다. 변수 자동 매핑·대체문안 규칙은 호출부가 공용 로직(`handleSelectTemplate`)으로 적용한다.
 * 겹침: 문서 몸통으로 포털(z 2100 · 확인 창 등급). 배경 클릭으로 닫히지 않는다(0704 룰). 닫기 = 고르기 · 닫기 · ESC.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Search, X } from 'lucide-react';
import AlimtalkPreview from './AlimtalkPreview';
import {
  buildAlimtalkPreviewProps,
  extractVariables,
  isApprovedAlimtalkTemplate,
  type AlimtalkTemplate,
} from './AlimtalkChannelPanel';

interface Props {
  open: boolean;
  templates: AlimtalkTemplate[];
  /** 지금 고른 발신프로필 — 그 프로필의 템플릿만 보인다(공용 패널과 같은 범위) */
  profileId: string;
  selectedId: string;
  onPick: (t: AlimtalkTemplate) => void;
  onClose: () => void;
}

export default function AlimtalkTemplatePickerModal({ open, templates, profileId, selectedId, onPick, onClose }: Props) {
  const [tab, setTab] = useState<'approved' | 'pending'>('approved');
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setTab('approved');
    setQuery('');
    setFocusId(selectedId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, selectedId]);

  const mine = useMemo(() => templates.filter((t) => !profileId || t.profile_id === profileId), [templates, profileId]);
  const approved = useMemo(() => mine.filter((t) => isApprovedAlimtalkTemplate(t)), [mine]);
  const pending = useMemo(() => mine.filter((t) => !isApprovedAlimtalkTemplate(t)), [mine]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = tab === 'approved' ? approved : pending;
    if (!q) return base;
    return base.filter((t) => `${t.template_name} ${t.content}`.toLowerCase().includes(q));
  }, [tab, approved, pending, query]);

  if (!open) return null;
  const focus = approved.find((t) => t.id === focusId) || null;

  return createPortal(
    <div className="ds-scope ks-picker-back" role="dialog" aria-modal="true" aria-labelledby="ks-at-picker-title">
      <div className="ks-picker" style={{ ['--ks-accent' as any]: '#F59E0B' }}>
        <div className="ks-picker__head">
          <span className="ks-picker__ic" style={{ background: '#F59E0B' }}><Bell size={18} strokeWidth={2} /></span>
          <div className="min-w-0">
            <b id="ks-at-picker-title">알림톡 템플릿 고르기</b>
            <small>받는 사람에게 보이는 모습 그대로예요 · 승인 {approved.length}개{pending.length > 0 ? ` · 승인 전 ${pending.length}개` : ''}</small>
          </div>
          <button type="button" className="ks-pop__x ml-auto" onClick={onClose} aria-label="닫기"><X size={18} strokeWidth={2} /></button>
        </div>

        <div className="ks-picker__tools">
          <button type="button" className={`ks-chipf ${tab === 'approved' ? 'on' : ''}`} onClick={() => setTab('approved')}>승인 {approved.length}</button>
          {pending.length > 0 && (
            <button type="button" className={`ks-chipf ${tab === 'pending' ? 'on' : ''}`} onClick={() => setTab('pending')}>승인 전 {pending.length}</button>
          )}
          <label className="ks-picker__search">
            <Search size={14} strokeWidth={1.9} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 내용 검색" aria-label="템플릿 검색" />
          </label>
        </div>

        <div className="ks-picker__grid">
          {shown.length === 0 ? (
            <div className="ks-picker__empty">
              {mine.length === 0
                ? '이 발신프로필에 등록된 템플릿이 없어요. 관리 메뉴의 알림톡 템플릿에서 등록하고 승인을 받으면 여기에 보여요.'
                : query.trim()
                  ? `"${query.trim()}" 과 맞는 템플릿이 없어요`
                  : tab === 'approved'
                    ? '승인된 템플릿이 아직 없어요. 승인이 끝나면 여기에서 고를 수 있어요.'
                    : '승인을 기다리는 템플릿이 없어요'}
            </div>
          ) : (
            shown.map((t) => {
              const ok = isApprovedAlimtalkTemplate(t);
              const vars = extractVariables(t.content).length;
              const btns = Array.isArray(t.buttons) ? t.buttons.length : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={!ok}
                  className={`ks-card ${ok && focusId === t.id ? 'on' : ''}`}
                  onClick={() => setFocusId(t.id)}
                  onDoubleClick={() => { if (ok) { onPick(t); onClose(); } }}
                  aria-pressed={focusId === t.id}
                >
                  <div className="ks-card__view" aria-hidden>
                    <AlimtalkPreview {...buildAlimtalkPreviewProps(t)} />
                  </div>
                  <div className="ks-card__meta">
                    <b title={t.template_name}>{t.template_name}</b>
                    <small>{`변수 ${vars}개 · 버튼 ${btns}개${t.category ? ` · ${t.category}` : ''}`}</small>
                    <div className="ks-tags">
                      {ok ? <span className="ok">승인</span> : <span className="wait">승인 전 · 고를 수 없음</span>}
                      {selectedId === t.id && <span>지금 쓰는 중</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="ks-picker__foot">
          <p className="ks-note">승인된 템플릿만 보낼 수 있어요. 카드를 두 번 누르면 바로 골라져요.</p>
          <button type="button" className="ks-picker__cancel" onClick={onClose}>닫기</button>
          <button
            type="button"
            className="ks-picker__ok"
            style={{ background: '#F59E0B' }}
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
