/**
 * BrandSendModal — 브랜드메시지 발송 풀 화면 (★ 2026-07-29 신설 / 2026-07-31 셸 교체)
 *
 * 왜 알림톡 모달과 따로인가:
 *   알림톡은 **검수 승인된 템플릿을 골라야만** 발송이 성립한다(템플릿이 없으면 보낼 방법이 없다).
 *   브랜드메시지는 **발신프로필만 있으면 전화번호로 바로** 나간다 — 자유형은 템플릿 코드를 요구하지 않고,
 *   기본형의 '템플릿'도 문안 검수가 아니라 변수 치환 발송 방식이다.
 *   그래서 진입 성격이 다르다: 알림톡 버튼 = 문안 고르러 가기 / 브랜드 버튼 = 이 수신자에게 바로 쓰기.
 *
 * 수신자 3방식 — 직접발송과 같은 축이되 세 번째만 다르다:
 *   직접입력 · 파일등록 = 전체 개방
 *   AI 타겟추출(주소록 자리) = 유료 요금제. 게이팅은 스팸필터·AI 다듬기와 **같은 기준**을 쓴다
 *   (새 축을 만들지 않는다). 잠긴 회사가 누르면 기존 PlanUpgradeModal이 그대로 뜬다.
 *
 * 타겟 추출은 `POST /api/customers/generate-from-text`를 재사용한다 —
 * 이미 `requirePlanFeature('ai_messaging')`로 게이팅된 CT다. 새 엔드포인트를 만들지 않는다.
 *
 * ★ 2026-07-31 셸을 `shared/SendWorkspaceShell`로 교체(화이트 고급형). 발송 로직·상태는 무변경 —
 *   바뀐 것은 표현뿐이다.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Megaphone, PencilLine, Upload, Sparkles, Lock, Loader2, Trash2, Users, UserPlus, X, Search } from 'lucide-react';
import BrandMessageEditor from './BrandMessageEditor';
import { WorkspaceNotice } from './shared/SendWorkspaceShell';
import KakaoSendHeader from './kakao-send/KakaoSendHeader';
import '../styles/direct-send.css';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';
import { BRAND_SPEC } from '../constants/brand-message-spec';

type RecipientMode = 'manual' | 'file' | 'ai';

export interface BrandSendModalProps {
  show: boolean;
  onClose: () => void;
  /** 발신프로필 목록. 비어 있으면 채널 연동 안내를 띄운다(요금제가 아니라 기술적 전제다) */
  profiles: any[];
  /** 직접발송에서 넘어올 때 이미 입력해 둔 수신자 */
  initialRecipients?: string[];
  /** AI 타겟추출 잠금 — 스팸필터·AI 다듬기와 같은 기준을 부모가 그대로 넘긴다 */
  isAiTargetLocked: boolean;
  /** 잠금 시 부모가 공통 안내 창(PlanFeatureModal)을 띄운다 — 기능 id(constants/plan-feature-intros.ts) */
  onLockedFeature: (featureId: string) => void;
  /** 실제 발송 — BrandMessageEditor가 만든 payload에 수신자를 얹어 부모가 보낸다 */
  onSend: (payload: any) => Promise<void> | void;
  sending?: boolean;
  /**
   * ★ 2026-08-21 진입 출처. 기본 'direct'(직접발송 패널, violet · 수신자 3방식 그대로).
   *   'target' = 직접 타겟 발송에서 추출된 수신자를 들고 넘어온 경우: 인디고(콘솔 톤) + 수신자 입력 3방식을 숨기고
   *   **가져온 목록만** 보여준다(빼기만 가능). 알림톡 인계와 같은 "리스트 그대로 가져가기" 축.
   */
  entry?: 'direct' | 'target';
  /**
   * ★ 2026-09-20 설정에 등록된 080 수신거부 번호 — 부모(Dashboard)가 `/api/companies/settings`에서
   *   이미 받아 둔 값을 그대로 넘긴다(문자 직접발송과 같은 값). 편집기가 이 값으로 080 칸을 채워 잠근다.
   */
  optOutNumber?: string;
  /** ★ 2026-09-25 머리의 채널 전환(문자 발송 · 알림톡 발송) — 주면 버튼이 보인다. phones = 지금 명단(넘겨 쓰도록) */
  onSwitchChannel?: (to: 'sms' | 'alimtalk', phones: string[]) => void;
}

/**
 * ★ 2026-08-04 Harold 지정 — 화면에 펼치는 수신자 상한.
 *
 * AI 타겟추출은 조건에 맞는 대상을 **전량** 담는다(발송이 번호 배열을 그대로 받는 구조).
 * 그런데 그 전량을 textarea에 부으면 타이핑 한 번마다 목록 전체를 다시 파싱해 수만 명에서 멈춘다.
 * 데이터(phones)는 그대로 두고 **렌더만** 바꾼다 — 상한을 넘으면 편집 대신 확인용 목록을 보여준다.
 * 화면과 실제 발송 대상이 갈리지 않도록, 담긴 총 인원과 추출 조건을 함께 적는다.
 */
const RECIPIENT_EDIT_LIMIT = 1000;

const normalizePhones = (raw: string): string[] =>
  raw
    .split(/[\s,;\n\r\t]+/)
    .map((v) => v.replace(/[^0-9]/g, ''))
    .filter((v) => v.length >= 9 && v.length <= 11);

export default function BrandSendModal({
  show, onClose, profiles, initialRecipients, isAiTargetLocked, onLockedFeature, onSend, sending,
  entry = 'direct', optOutNumber, onSwitchChannel,
}: BrandSendModalProps) {
  const isTarget = entry === 'target';
  const accent = isTarget ? 'indigo' : 'violet';
  /** 강조색 표 — 좌측 수신자 패널에서 색이 드러나는 자리만. 값은 여기 하나만 갖는다 */
  const A = isTarget
    ? { count: 'text-indigo-600', badge: 'bg-indigo-600', focus: 'focus-within:ring-indigo-500/50' }
    : { count: 'text-violet-600', badge: 'bg-gradient-to-br from-violet-500 to-fuchsia-500', focus: 'focus-within:ring-violet-500/50' };
  const [mode, setMode] = useState<RecipientMode>('manual');
  /** target 진입: 넘어온 원래 인원(제외 수 표시용) + 목록 검색어 */
  const [seededCount, setSeededCount] = useState(0);
  const [listQuery, setListQuery] = useState('');
  /** 입력 중인 번호 — [수신자로 추가]를 눌러야 확정 목록(phones)에 들어간다(알림톡과 같은 축) */
  const [draft, setDraft] = useState('');
  const [addNotice, setAddNotice] = useState('');
  const [phones, setPhones] = useState<string[]>([]);
  /**
   * ★ 2026-08-15 발송 확인 — 이 화면만 확인 없이 바로 나갔다(Harold 지적).
   *   문자·알림톡은 건수를 보여주는 확인 단계를 거치는데 브랜드만 버튼 한 번에 발송돼,
   *   광고성 메시지가 몇 명에게 나가는지 못 보고 누르는 구조였다. payload를 잡아 두고 확인 후 넘긴다.
   */
  const [pending, setPending] = useState<any | null>(null);
  /**
   * ★ 2026-09-25 확인 창을 연 순간의 명단(Codex 10R·11R). 확인 창의 건수와 실제 발송은 **이 명단만** 쓴다.
   *   확인 창이 떠 있는 동안 늦게 끝난 담기나 키보드로 닿는 뒤쪽 버튼이 화면 명단을 바꿔도, 나가는 것은 확인한 명단이다
   *   (문자·알림톡 = 명단을 먼저 적재하고 확인 창은 그 적재분만 확정하는 것과 같은 계약).
   */
  const [pendingPhones, setPendingPhones] = useState<string[]>([]);

  // AI 타겟추출
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ matchCount: number; explanation: string; filter: any } | null>(null);
  const [aiApplying, setAiApplying] = useState(false);
  /** 명단 세대 — 늦게 도착한 담기·파일 읽기 응답이 그 사이 바뀐 리스트를 덮어쓰는 것을 막는다(일괄발급 bulkReqSeqRef와 같은 방식) */
  const reqSeqRef = useRef(0);
  /**
   * ★ 2026-09-25 추출 세대 — 타겟 추출은 명단을 바꾸지 않으므로(조건·대상 수만) 명단 세대와 따로 센다.
   *   한 세대를 같이 쓰면 명단을 고칠 때 진행 중인 추출이 버려지고 [추출 중]이 멈춘 채 남았다(finally 가 세대가 달라 안 내림).
   */
  const aiSeqRef = useRef(0);

  /**
   * ★ 2026-07-29 열릴 때 **전 상태를 되돌린다**(적대검증 high 수용).
   *   이 모달은 Dashboard에 계속 마운트된 채 show만 토글된다. 초기화하는 주인이 없으면
   *   직전 발송의 수신자가 그대로 남아, 빈 목록으로 다시 열어도 발송 가능 상태가 된다 = 오발송.
   *   진행 중이던 요청도 세대를 올려 무효화한다.
   */
  useEffect(() => {
    if (!show) return;
    reqSeqRef.current++;
    aiSeqRef.current++;
    const seeded = Array.from(new Set(
      (initialRecipients || []).map((p) => String(p).replace(/[^0-9]/g, '')).filter(Boolean),
    ));
    setPhones(seeded);
    setSeededCount(seeded.length);
    setListQuery('');
    setDraft(''); setAddNotice('');
    setMode('manual');
    setPending(null); setPendingPhones([]);
    setAiPrompt(''); setAiError(''); setAiResult(null);
    setAiLoading(false); setAiApplying(false);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasProfile = (profiles || []).length > 0;
  const canSend = hasProfile && phones.length > 0;

  /**
   * ★ 사람이 수신자를 바꾸는 **유일한 통로**. 여기서만 세대를 올린다.
   *
   * 경로마다 손으로 무효화를 적으면 반드시 하나를 빠뜨린다 — 실제로 `비우기`와 `파일등록`이
   * 빠져서, AI 추출 중에 목록을 비워도 늦게 온 응답이 지운 수신자를 되살렸다(적대검증 실측).
   * 그건 오발송이다. 그래서 변경 경로를 하나로 좁힌다.
   */
  const setRecipients = (list: string[]) => {
    reqSeqRef.current++;          // 진행 중인 담기·파일 읽기 응답을 무효화한다(타겟 추출은 명단을 안 바꿔 따로 센다 · aiSeqRef)
    setAiApplying(false);
    setPhones(list);
  };

  /**
   * 입력창의 번호를 확정 목록에 **더한다**(덮어쓰지 않는다).
   * 여러 곳에서 모은 번호를 이어 붙일 수 있어야 해서 병합이 기본이고, 이미 담긴 번호는 조용히 버리지 않고
   * 몇 건이 중복이었는지 알린다 — 넣었는데 수가 안 늘면 사용자는 버튼이 고장난 줄로 읽는다.
   */
  const addFromDraft = () => {
    const parsed = normalizePhones(draft);
    if (parsed.length === 0) {
      setAddNotice(draft.trim() ? '유효한 번호를 찾지 못했습니다 (9~11자리 숫자).' : '번호를 입력해 주세요.');
      return;
    }
    const existing = new Set(phones);
    const added = Array.from(new Set(parsed)).filter((p) => !existing.has(p));
    const dupes = parsed.length - added.length;
    setRecipients([...phones, ...added]);
    setDraft('');
    setAddNotice(
      added.length === 0
        ? `이미 담긴 번호입니다 (중복 ${dupes.toLocaleString()}건).`
        : `${added.length.toLocaleString()}명 추가${dupes > 0 ? ` · 중복 ${dupes.toLocaleString()}건 제외` : ''}`,
    );
  };

  const removeAt = (idx: number) => setRecipients(phones.filter((_, i) => i !== idx));

  const handleFile = async (file: File | null) => {
    if (!file) return;
    // ★ 2026-09-25 읽는 동안 명단이 바뀌면(삭제·추가·AI 담기·창 닫힘) 이 읽기 결과는 버린다 — AI 추출과 같은 세대 규칙.
    //   읽기 전 명단(phones)에 합치면 그 사이 지운 번호가 되살아나 발송된다(Codex 4R 범위 밖 지적 · Harold "같은 문제면 같이").
    const seq = reqSeqRef.current;
    const text = await file.text();
    if (seq !== reqSeqRef.current) {
      setAddNotice('파일을 읽는 동안 명단이 바뀌어 이번 파일은 넣지 않았어요. 다시 올려 주세요.');
      return;
    }
    const parsed = normalizePhones(text);
    const existing = new Set(phones);
    const added = Array.from(new Set(parsed)).filter((p) => !existing.has(p));
    setRecipients([...phones, ...added]);
    setAddNotice(`파일에서 ${added.length.toLocaleString()}명 추가${parsed.length - added.length > 0 ? ` · 중복 ${(parsed.length - added.length).toLocaleString()}건 제외` : ''}`);
    setMode('manual');   // 결과를 눈으로 확인하고 고칠 수 있게 직접입력으로 되돌린다
  };

  const runAiTarget = async () => {
    if (isAiTargetLocked) { onLockedFeature('ai-target'); return; }
    if (!aiPrompt.trim()) { setAiError('찾을 대상을 한 줄로 입력해 주세요.'); return; }
    const seq = ++aiSeqRef.current;
    // 새 추출은 앞 조건으로 진행 중이던 담기를 무효로 한다(명단 세대) — 버린 담기의 진행 표시도 여기서 내린다
    reqSeqRef.current++;
    setAiApplying(false);
    setAiLoading(true); setAiError(''); setAiResult(null);
    try {
      const res = await fetch('/api/customers/generate-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ naturalLanguage: aiPrompt.trim() }),
      });
      const data = await res.json();
      if (seq !== aiSeqRef.current) return;   // 그 사이 창이 닫혔거나 새 추출을 시작했다 — 이 응답은 버린다
      if (!res.ok) throw new Error(data?.error || '타겟 추출에 실패했습니다.');
      // 1단계는 **조건과 대상 수만** 확정한다. 수신자는 아래 [리스트에 담기]가 전량을 받아온다 —
      // samples는 5건짜리 미리보기라 그걸 수신자로 쓰면 3,000명 대상이 5명에게만 나간다.
      setAiResult({
        matchCount: Number(data?.matchCount) || 0,
        explanation: String(data?.explanation || ''),
        filter: data?.filter ?? null,
      });
    } catch (e: any) {
      if (seq === aiSeqRef.current) setAiError(e?.message || '타겟 추출에 실패했습니다.');
    } finally {
      if (seq === aiSeqRef.current) setAiLoading(false);
    }
  };

  /** 추출된 조건으로 **대상 전량**을 받아 수신자 리스트에 그대로 싣는다(눈으로 확인·수정 가능). */
  const applyAiTarget = async () => {
    if (!aiResult || !aiResult.filter || aiResult.matchCount === 0) return;
    const seq = ++reqSeqRef.current;
    setAiApplying(true); setAiError('');
    try {
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ dynamicFilters: aiResult.filter, smsOptIn: true, phoneField: 'phone' }),
      });
      const data = await res.json();
      // 늦게 도착한 응답이 그 사이 사람이 고친 리스트를 덮으면, 지운 고객이 되살아나 발송된다.
      if (seq !== reqSeqRef.current) return;
      if (!res.ok || !data?.success) throw new Error(data?.error || '대상을 불러오지 못했습니다.');
      const list: string[] = (data.recipients || [])
        .map((r: any) => String(r?.phone || '').replace(/[^0-9]/g, ''))
        .filter(Boolean);
      if (list.length === 0) throw new Error('조건에 맞는 수신자가 없습니다.');
      // 검증을 통과한 응답도 **같은 통로**로 넣는다 — 여기만 예외로 두면 다음 사람이 직접 set을 또 만든다.
      //   (세대가 함께 올라가 그 뒤 남아 있던 다른 요청도 무효가 된다)
      //   추출은 조건으로 뽑은 **대상 집합**이라 기존 목록에 더하지 않고 그것으로 바꾼다(조건 = 대상).
      setRecipients(Array.from(new Set(list)));
      setAddNotice(`조건에 맞는 ${list.length.toLocaleString()}명을 담았습니다.`);
      setMode('manual');   // 리스트를 눈으로 보고 지우거나 더할 수 있게 직접입력으로 넘긴다
    } catch (e: any) {
      if (seq === reqSeqRef.current) setAiError(e?.message || '대상을 불러오지 못했습니다.');
    } finally {
      if (seq === reqSeqRef.current) setAiApplying(false);
    }
  };

  const modeTabs = useMemo(() => ([
    { key: 'manual' as RecipientMode, label: '직접입력', icon: PencilLine, locked: false },
    { key: 'file' as RecipientMode, label: '파일등록', icon: Upload, locked: false },
    { key: 'ai' as RecipientMode, label: 'AI 타겟추출', icon: Sparkles, locked: isAiTargetLocked },
  ]), [isAiTargetLocked]);
  // ★ 2026-09-25 카카오 발송 창 틀(Harold 목업 v2) — 수신자 열을 직접발송과 같은 모양으로(탭 · 합계 · 검색 · 10줄 목록 · 선택삭제).
  //   수신자를 바꾸는 길은 위 setRecipients 하나 그대로다(늦게 온 AI 응답 무효화 포함). 여기는 보여 주는 방식만 다르다.
  const [listPage, setListPage] = useState(0);
  const [listSelected, setListSelected] = useState<Set<number>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const dropInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { setListSelected(new Set()); setListPage(0); }, [phones]);
  // ESC 닫기 — 옛 공용 틀(SendWorkspaceShell)이 하던 일 그대로. 안쪽 풍선·고르기 창은 캡처 단계에서 먼저 잡는다.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, onClose]);

  const removedCount = Math.max(0, seededCount - phones.length);
  const LIST_PAGE_SIZE = 10;
  const listDigits = listQuery.replace(/[^0-9]/g, '');
  const listFiltered = phones.map((p, idx) => ({ p, idx })).filter((r) => !listDigits || r.p.includes(listDigits));
  const listTotalPages = Math.max(1, Math.ceil(listFiltered.length / LIST_PAGE_SIZE));
  const listCurrentPage = Math.min(listPage, listTotalPages - 1);
  const listPageItems = listFiltered.slice(listCurrentPage * LIST_PAGE_SIZE, (listCurrentPage + 1) * LIST_PAGE_SIZE);
  // ★Codex 3R — 선택 범위 = 지금 보이는 목록(검색 결과). 머리 체크박스가 숨은 줄까지 고르면 선택 제외가 안 보이는 번호를 지운다
  const listVisibleIdx = listFiltered.map((r) => r.idx);
  const listAllVisibleChecked = listVisibleIdx.length > 0 && listVisibleIdx.every((i) => listSelected.has(i));

  const recipientsPanel = (
    <section className="ds-recipients ks-recipients">
      {isTarget ? (
        // target 진입 = 가져온 목록만. 번호를 더 넣는 길을 열면 "조건 = 대상"이 깨진다 → 빼기만 둔다.
        <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-sm px-4 py-3 flex items-center gap-3">
          <div className={`h-9 w-9 rounded-xl ${A.badge} text-white grid place-items-center shrink-0`}>
            <Users size={16} strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">직접 타겟 발송에서 가져온 수신자</p>
            <p className="text-[11.5px] text-slate-500 mt-0.5">
              추출된 {seededCount.toLocaleString()}명{removedCount > 0 ? ` · ${removedCount.toLocaleString()}명 제외` : ''} · 여기서는 빼기만 할 수 있습니다
            </p>
          </div>
        </div>
      ) : (
        <div className="ds-rtab-group">
          {modeTabs.map((t) => (t.key === 'file' ? (
            <label key={t.key} className={`ds-rtab ds-rtab--label ${mode === 'file' ? 'ds-rtab--on' : ''}`}>
              <t.icon size={17} strokeWidth={1.75} />
              <span>{t.label}</span>
              <input type="file" accept=".csv,.txt,text/plain" className="hidden"
                onChange={(e) => { handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
            </label>
          ) : (
            <button key={t.key} type="button"
              className={`ds-rtab ${mode === t.key ? 'ds-rtab--on' : ''}`}
              onClick={() => { if (t.locked) { onLockedFeature('ai-target'); return; } setMode(t.key); }}>
              <t.icon size={17} strokeWidth={1.75} />
              <span>{t.label}</span>
              {t.locked && <Lock size={12} strokeWidth={2.2} className="text-slate-300" />}
            </button>
          )))}
        </div>
      )}

      {!isTarget && mode === 'manual' && (
        <>
          {/* 입력 → [수신자로 추가] → 목록. 실시간 파싱이 아니라 명시적으로 담는다(알림톡과 같은 축) */}
          <div className="ks-direct">
            <textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); if (addNotice) setAddNotice(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addFromDraft(); } }}
              placeholder={'번호를 줄바꿈·쉼표로 구분해 넣어 주세요\n01012345678'}
              aria-label="수신번호 직접 입력"
            />
            <button type="button" onClick={addFromDraft} disabled={!draft.trim()}>수신자로 추가</button>
          </div>
          {addNotice && <p className="text-[11.5px] text-violet-600 px-0.5 m-0">{addNotice}</p>}
          {aiResult?.explanation && phones.length > 0 && (
            <p className="text-[11px] text-slate-500 bg-slate-50/80 ring-1 ring-slate-900/5 rounded-lg px-2.5 py-1.5 leading-relaxed m-0">
              {aiResult.explanation}
            </p>
          )}
        </>
      )}

      {!isTarget && mode === 'file' && (
        <p className="ks-note">CSV · TXT 파일에서 번호만 골라 목록에 더해요. 위 [파일등록]을 누르거나 아래 칸에 끌어다 놓으세요.</p>
      )}

      {!isTarget && mode === 'ai' && (
        <div className="rounded-2xl ring-1 ring-violet-200/70 bg-violet-50/30 p-3 space-y-2">
          <p className="text-[11.5px] text-slate-500 m-0">찾을 대상을 한 줄로 쓰세요. 연동된 고객DB에서 조건을 만들어 대상을 뽑습니다.</p>
          <div className="ks-direct">
            <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="예) 최근 3개월 구매 없는 VIP 고객" aria-label="찾을 대상" />
            <button type="button" onClick={runAiTarget} disabled={aiLoading} style={{ background: '#7C3AED' }}>
              {aiLoading ? <><Loader2 size={13} className="animate-spin inline-block mr-1 -mt-0.5" />추출 중</> : '타겟 추출'}
            </button>
          </div>
          {aiError && <p className="text-xs text-rose-600 m-0">{aiError}</p>}
          {aiResult && (
              <div className="px-3.5 py-3 rounded-2xl bg-white ring-1 ring-violet-200/70 shadow-sm text-xs space-y-2">
                <p className="font-semibold text-slate-800">대상 {aiResult.matchCount.toLocaleString()}명</p>
                {/* 어떤 조건으로 뽑았는지 보여준다 — 근거 없이 담으면 사람이 검증할 수 없다 */}
                {aiResult.explanation && <p className="text-slate-500 leading-relaxed">{aiResult.explanation}</p>}
                <button type="button" onClick={applyAiTarget} disabled={aiApplying || aiResult.matchCount === 0}
                  className="w-full py-2 rounded-lg text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-40 inline-flex items-center justify-center gap-1.5 transition">
                  {aiApplying
                    ? <><Loader2 size={12} className="animate-spin" /> 불러오는 중...</>
                    : <>리스트에 담기 ({aiResult.matchCount.toLocaleString()}명)</>}
                </button>
              </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="ds-count-wrap">
          <span className="ds-count-label">총</span>
          <span className="ds-count-num">{phones.length.toLocaleString()}</span>
          <span className="ds-count-label">명</span>
        </div>
        <div className="ds-search-wrap">
          <Search size={15} strokeWidth={1.75} />
          <input type="text" className="ds-search-in" placeholder="수신번호 검색" value={listQuery}
            onChange={(e) => { setListQuery(e.target.value); setListPage(0); setListSelected(new Set()); }} />
        </div>
      </div>

      <div className="ds-list-frame">
        <div className="ds-list-head">
          <label className="flex items-center cursor-pointer">
            <input type="checkbox" className="ds-chk ds-chk--lg ds-chk--purple"
              checked={listAllVisibleChecked}
              disabled={listVisibleIdx.length === 0}
              onChange={(e) => setListSelected(e.target.checked
                ? new Set([...listSelected, ...listVisibleIdx])
                : new Set([...listSelected].filter((i) => !listVisibleIdx.includes(i))))}
              aria-label="전체 선택" />
          </label>
          <span>수신번호</span>
          <span />
        </div>
        {phones.length === 0 ? (
          <div className="ds-list-empty">
            {isTarget ? (
              <p className="m-auto text-[12.5px] text-slate-500 text-center">수신자가 모두 제외됐습니다. 창을 닫고 타겟을 다시 가져오세요.</p>
            ) : (
              <>
                <div
                  className={`ds-dropzone ds-t w-full ${dragActive ? 'ds-dropzone--active' : ''}`}
                  onClick={() => dropInputRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setDragActive(false);
                    handleFile(e.dataTransfer?.files?.[0] || null);
                  }}
                >
                  <div>
                    <div className="text-[14px] font-semibold text-stone-800">번호를 넣거나 파일을 올려 주세요</div>
                    <div className="text-[12.5px] text-stone-500 mt-1">CSV · TXT에서 번호만 골라 읽어요{isAiTargetLocked ? '' : ' · AI 타겟추출로 바로 뽑을 수도 있어요'}</div>
                  </div>
                  <div className="flex items-center justify-center flex-wrap gap-x-2 gap-y-1 mt-1">
                    <span className="ds-btn-sec px-4 pointer-events-none whitespace-nowrap border border-violet-200 bg-violet-50 text-violet-700">
                      <Upload size={14} strokeWidth={1.75} />
                      <span>파일 선택</span>
                    </span>
                    <span className="text-[12px] text-stone-400 whitespace-nowrap">또는 여기로 드래그</span>
                  </div>
                </div>
                <input ref={dropInputRef} type="file" accept=".csv,.txt,text/plain" className="hidden"
                  onChange={(e) => { handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
              </>
            )}
          </div>
        ) : (
          <>
            <div className="ds-list-body">
              {listPageItems.length === 0 ? (
                <div className="py-12 text-center text-stone-400 text-[13px]">"{listQuery}" 검색 결과가 없어요</div>
              ) : (
                listPageItems.map(({ p, idx }) => (
                  <div key={`${p}-${idx}`} className="ds-list-row">
                    <label className="flex items-center cursor-pointer">
                      <input type="checkbox" className="ds-chk ds-chk--purple" checked={listSelected.has(idx)}
                        onChange={(e) => {
                          const next = new Set(listSelected);
                          if (e.target.checked) next.add(idx); else next.delete(idx);
                          setListSelected(next);
                        }}
                        aria-label={`${p} 선택`} />
                    </label>
                    <span className="ds-num text-stone-800 font-medium">{p}</span>
                    <span />
                  </div>
                ))
              )}
            </div>
            {listTotalPages > 1 && (
              <div className="ds-page">
                <button type="button" onClick={() => setListPage((n) => Math.max(0, n - 1))} disabled={listCurrentPage === 0}>이전</button>
                <span className="ds-page-num">{listCurrentPage + 1} / {listTotalPages}</span>
                <button type="button" onClick={() => setListPage((n) => Math.min(listTotalPages - 1, n + 1))} disabled={listCurrentPage >= listTotalPages - 1}>다음</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="ds-bottom-actions">
        <div className="flex items-center gap-1">
          <button type="button" className="ds-ter ds-ter--danger ds-t" disabled={listSelected.size === 0}
            onClick={() => { setRecipients(phones.filter((_, i) => !listSelected.has(i))); }}>
            <Trash2 size={13} strokeWidth={1.75} />
            <span>{isTarget ? '선택 제외' : '선택삭제'}</span>
          </button>
          {!isTarget && (
            <button type="button" className="ds-ter ds-ter--danger ds-t" disabled={phones.length === 0}
              onClick={() => { setRecipients([]); setAddNotice(''); }}>
              <X size={13} strokeWidth={1.75} />
              <span>전체삭제</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );

  // 확인 다이얼로그에 적을 유형 — payload가 화면 선택값을 그대로 갖고 있다
  //   유형은 규격 사본의 한글 이름으로 적는다 — 내부 코드(CAROUSEL_FEED 등)를 화면에 내지 않는다
  const pendingTypeLabel = pending
    ? `브랜드메시지 ${pending.mode === 'template' ? '기본형' : (BRAND_SPEC[String(pending.bubbleType || 'TEXT')]?.label || '텍스트')}`
    : '';

  if (!show) return null;

  return createPortal(
    // 겹침 2000 = 옛 공용 틀과 같은 층(요금제 안내 · 확인 창 2100이 이 위에 뜬다)
    <div
      className="ds-scope ds-backdrop"
      style={{ zIndex: 2000 }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="ds-modal" role="dialog" aria-modal="true" aria-label="브랜드메시지 발송">
        <KakaoSendHeader
          channel="brand"
          title="브랜드메시지 발송"
          subtitle={isTarget
            ? `추출된 ${phones.length.toLocaleString()}명에게 브랜드메시지를 발송합니다`
            : '검수 없이 바로 보내요 · 발신프로필이 연동돼 있으면 전화번호로 도착해요'}
          onSwitch={onSwitchChannel ? (to) => onSwitchChannel(to === 'alimtalk' ? 'alimtalk' : 'sms', phones) : undefined}
          onClose={onClose}
        />
        {!hasProfile && (
          <div className="shrink-0 px-6 pt-3">
            <WorkspaceNotice>
              카카오 채널 연동(발신프로필 등록)이 필요합니다. 발신프로필이 등록되면 요금제와 무관하게 바로 사용할 수 있습니다.
            </WorkspaceNotice>
          </div>
        )}
        <BrandMessageEditor
        profiles={profiles}
        sending={!!sending}
        accent={accent}
        recipientCount={phones.length}
        defaultUnsubPhone={optOutNumber}
        onSend={(payload: any) => {
          if (!canSend) return;
          // ★ 2026-09-25 확인을 기다리는 동안은 새 보내기를 받지 않는다(Codex 12R) — 확인 창은 포커스를 옮기지 않아
          //   Enter 가 뒤쪽 보내기 버튼으로 다시 들어가면 떠 둔 명단이 그 사이 바뀐 명단으로 교체됐다(건수가 같으면 알 수 없음).
          if (pending) return;
          // 바로 보내지 않는다 — 건수를 보여주고 확인을 받는다(문자·알림톡과 같은 계약)
          // ★ 2026-09-25 확인 창을 연 순간의 명단을 떠 둔다 — 건수 표시와 발송은 이 명단만 쓴다(Codex 10R·11R)
          setPendingPhones(phones.slice());
          setPending(payload);
        }}
          recipientsPanel={recipientsPanel}
        />
      </div>

      <ConfirmDialogShell
        show={!!pending}
        tone={accent}
        icon={<Megaphone size={18} strokeWidth={1.9} className="text-white" />}
        title="지금 바로 발송합니다"
        subtitle="광고성 메시지입니다. 누르는 즉시 나가며 회수할 수 없습니다."
        cancelLabel="취소"
        onCancel={() => { setPending(null); setPendingPhones([]); }}
        confirmLabel="즉시 발송"
        onConfirm={async () => {
          const payload = pending;
          const sendPhones = pendingPhones;
          if (!payload) return;
          setPending(null); setPendingPhones([]);
          await onSend({ ...payload, phones: sendPhones });
        }}
        busy={!!sending}
        busyLabel="접수 중..."
        confirmDisabled={pendingPhones.length === 0}
      >
        <DialogHeadline label="발송 대상" value={pendingPhones.length} unit="명" tone={accent} />
        <div className="mt-3">
          <DialogRow label="메시지 유형" value={pendingTypeLabel} />
          <DialogRow
            label="광고 표기"
            value={pending?.isAd === false ? '표기 안 함' : '(광고) 표기'}
            accent={pending?.isAd === false ? 'amber' : 'slate'}
          />
          {pending?.resendType && pending.resendType !== 'NO' && (
            <DialogRow label="실패 시 대체발송" value={pending.resendType === 'LM' ? 'LMS' : 'SMS'} />
          )}
        </div>
        <DialogCaution tone="rose">
          발송이 시작되면 중간에 멈추거나 되돌릴 수 없습니다. 문구와 수신자를 다시 한번 확인해 주세요.
        </DialogCaution>
      </ConfirmDialogShell>
    </div>,
    document.body,
  );
}