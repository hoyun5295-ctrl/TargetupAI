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
import { Megaphone, PencilLine, Upload, Sparkles, Lock, Loader2, Trash2, Users, UserPlus, X, Search } from 'lucide-react';
import BrandMessageEditor from './BrandMessageEditor';
import SendWorkspaceShell, { WorkspaceNotice, FIELD_CLASS } from './shared/SendWorkspaceShell';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';

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
  /** 잠금 시 부모가 PlanUpgradeModal을 띄운다 */
  onLockedFeature: (feature: string, requiredPlan: string) => void;
  /** 실제 발송 — BrandMessageEditor가 만든 payload에 수신자를 얹어 부모가 보낸다 */
  onSend: (payload: any) => Promise<void> | void;
  sending?: boolean;
  /**
   * ★ 2026-08-21 진입 출처. 기본 'direct'(직접발송 패널, violet · 수신자 3방식 그대로).
   *   'target' = 직접 타겟 발송에서 추출된 수신자를 들고 넘어온 경우: 인디고(콘솔 톤) + 수신자 입력 3방식을 숨기고
   *   **가져온 목록만** 보여준다(빼기만 가능). 알림톡 인계와 같은 "리스트 그대로 가져가기" 축.
   */
  entry?: 'direct' | 'target';
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
  entry = 'direct',
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

  // AI 타겟추출
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ matchCount: number; explanation: string; filter: any } | null>(null);
  const [aiApplying, setAiApplying] = useState(false);
  /** 요청 세대 — 늦게 도착한 응답이 그 사이 바뀐 리스트를 덮어쓰는 것을 막는다(일괄발급 bulkReqSeqRef와 같은 방식) */
  const reqSeqRef = useRef(0);

  /**
   * ★ 2026-07-29 열릴 때 **전 상태를 되돌린다**(적대검증 high 수용).
   *   이 모달은 Dashboard에 계속 마운트된 채 show만 토글된다. 초기화하는 주인이 없으면
   *   직전 발송의 수신자가 그대로 남아, 빈 목록으로 다시 열어도 발송 가능 상태가 된다 = 오발송.
   *   진행 중이던 요청도 세대를 올려 무효화한다.
   */
  useEffect(() => {
    if (!show) return;
    reqSeqRef.current++;
    const seeded = Array.from(new Set(
      (initialRecipients || []).map((p) => String(p).replace(/[^0-9]/g, '')).filter(Boolean),
    ));
    setPhones(seeded);
    setSeededCount(seeded.length);
    setListQuery('');
    setDraft(''); setAddNotice('');
    setMode('manual');
    setPending(null);
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
    reqSeqRef.current++;          // 진행 중인 추출 응답을 무효화한다
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
    const text = await file.text();
    const parsed = normalizePhones(text);
    const existing = new Set(phones);
    const added = Array.from(new Set(parsed)).filter((p) => !existing.has(p));
    setRecipients([...phones, ...added]);
    setAddNotice(`파일에서 ${added.length.toLocaleString()}명 추가${parsed.length - added.length > 0 ? ` · 중복 ${(parsed.length - added.length).toLocaleString()}건 제외` : ''}`);
    setMode('manual');   // 결과를 눈으로 확인하고 고칠 수 있게 직접입력으로 되돌린다
  };

  const runAiTarget = async () => {
    if (isAiTargetLocked) { onLockedFeature('AI 타겟추출', '베이직'); return; }
    if (!aiPrompt.trim()) { setAiError('찾을 대상을 한 줄로 입력해 주세요.'); return; }
    const seq = ++reqSeqRef.current;
    setAiLoading(true); setAiError(''); setAiResult(null);
    try {
      const res = await fetch('/api/customers/generate-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ naturalLanguage: aiPrompt.trim() }),
      });
      const data = await res.json();
      if (seq !== reqSeqRef.current) return;   // 그 사이 닫혔거나 리스트를 손댔다 — 이 응답은 버린다
      if (!res.ok) throw new Error(data?.error || '타겟 추출에 실패했습니다.');
      // 1단계는 **조건과 대상 수만** 확정한다. 수신자는 아래 [리스트에 담기]가 전량을 받아온다 —
      // samples는 5건짜리 미리보기라 그걸 수신자로 쓰면 3,000명 대상이 5명에게만 나간다.
      setAiResult({
        matchCount: Number(data?.matchCount) || 0,
        explanation: String(data?.explanation || ''),
        filter: data?.filter ?? null,
      });
    } catch (e: any) {
      if (seq === reqSeqRef.current) setAiError(e?.message || '타겟 추출에 실패했습니다.');
    } finally {
      if (seq === reqSeqRef.current) setAiLoading(false);
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

  // ── 좌측 패널(수신자) · target 진입 = 가져온 목록만 ──────────────────────
  //   직접 타겟 발송에서 조건으로 뽑은 대상이 곧 수신자다. 여기서 번호를 더 넣는 길을 열면
  //   "조건 = 대상"이 깨져 발송 결과와 추출 조건이 어긋난다 → 빼기만 둔다.
  const removedCount = Math.max(0, seededCount - phones.length);
  const visiblePhones = listQuery.trim()
    ? phones.filter((p) => p.includes(listQuery.replace(/[^0-9]/g, '')))
    : phones;
  const targetAside = (
    <>
      <div className="shrink-0 px-4 pt-4">
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
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        <div className={`h-9 flex items-center gap-2 px-3 rounded-lg bg-white ring-1 ring-slate-200 focus-within:ring-2 ${A.focus} transition`}>
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="text"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="수신번호 검색"
            className="w-full min-w-0 bg-transparent border-0 p-0 text-[12.5px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-0"
          />
        </div>

        {phones.length === 0 ? (
          <p className="text-[12px] text-slate-500 text-center py-10">수신자가 모두 제외됐습니다. 창을 닫고 타겟을 다시 가져오세요.</p>
        ) : (
          <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50/70 border-b border-slate-100 text-[11px] text-slate-400">
              {listQuery.trim()
                ? `검색 ${visiblePhones.length.toLocaleString()}건`
                : phones.length > RECIPIENT_EDIT_LIMIT
                  ? `앞 ${RECIPIENT_EDIT_LIMIT.toLocaleString()}건 표시 · 전체 ${phones.length.toLocaleString()}명 발송`
                  : `수신번호 ${phones.length.toLocaleString()}건`}
            </div>
            <div className="max-h-[52vh] overflow-y-auto divide-y divide-slate-50">
              {visiblePhones.slice(0, RECIPIENT_EDIT_LIMIT).map((p) => (
                <div key={p} className="flex items-center justify-between gap-2 px-3.5 py-1.5 group">
                  <span className="font-mono text-[12px] text-slate-600">{p}</span>
                  <button type="button" onClick={() => setRecipients(phones.filter((x) => x !== p))}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-300 hover:text-rose-500 transition shrink-0"
                    aria-label={`${p} 제외`} title="이 번호 제외">
                    <X size={13} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
              {listQuery.trim() && visiblePhones.length === 0 && (
                <p className="text-[12px] text-slate-400 text-center py-6">일치하는 번호가 없습니다</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white/70 px-4 py-3">
        <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
          <Users size={13} strokeWidth={1.9} className="text-slate-300" />
          수신자 <span className={`font-bold ${A.count} tabular-nums`}>{phones.length.toLocaleString()}</span>명
        </p>
      </div>
    </>
  );

  // ── 좌측 패널(수신자) · direct 진입 = 3방식 입력 ────────────────────────
  const aside = isTarget ? targetAside : (
    <>
      {/* 세그먼트 탭 — 밑줄 대신 알약형. 회색 선을 줄이면 화면이 정돈돼 보인다 */}
      <div className="shrink-0 px-4 pt-4">
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100/80">
          {modeTabs.map((t) => {
            const active = mode === t.key;
            return (
              <button key={t.key} type="button"
                onClick={() => { if (t.locked) { onLockedFeature('AI 타겟추출', '베이직'); return; } setMode(t.key); }}
                className={`flex-1 px-2 py-2 rounded-lg text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
                  active ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <t.icon size={13} strokeWidth={1.9} className={active ? 'text-violet-500' : ''} />
                <span>{t.label}</span>
                {t.locked && <Lock size={10} strokeWidth={2.2} className="text-slate-300" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {mode === 'manual' && (
          <>
            {/* 입력 → [수신자로 추가] → 목록. 실시간 파싱이 아니라 명시적으로 담는다(알림톡과 같은 축) */}
            <textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); if (addNotice) setAddNotice(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addFromDraft(); } }}
              rows={5}
              placeholder={'번호를 줄바꿈·쉼표로 구분해 입력하세요\n01012345678\n010-8765-4321'}
              className={`${FIELD_CLASS} resize-none leading-relaxed font-mono text-[12.5px]`}
            />
            <button
              type="button"
              onClick={addFromDraft}
              disabled={!draft.trim()}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-violet-700 bg-violet-50 ring-1 ring-violet-100 hover:bg-violet-100 disabled:opacity-40 disabled:hover:bg-violet-50 inline-flex items-center justify-center gap-1.5 transition"
            >
              <UserPlus size={14} strokeWidth={2} /> 수신자로 추가
            </button>
            {addNotice && <p className="text-[11px] text-violet-600">{addNotice}</p>}
            {aiResult?.explanation && phones.length > 0 && (
              <p className="text-[11px] text-slate-500 bg-slate-50/80 ring-1 ring-slate-900/5 rounded-lg px-2.5 py-1.5 leading-relaxed">
                {aiResult.explanation}
              </p>
            )}

            {phones.length > 0 && (
              <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-slate-50/70 border-b border-slate-100">
                  <span className="text-[11px] text-slate-400">
                    수신번호 {phones.length > RECIPIENT_EDIT_LIMIT
                      ? `(앞 ${RECIPIENT_EDIT_LIMIT.toLocaleString()}건 표시 · 전체 ${phones.length.toLocaleString()}명 발송)`
                      : `${phones.length.toLocaleString()}건`}
                  </span>
                  <button type="button" onClick={() => { setRecipients([]); setAddNotice(''); }}
                    className="text-[11px] text-slate-400 hover:text-rose-500 transition shrink-0">
                    전체삭제
                  </button>
                </div>
                <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-50">
                  {phones.slice(0, RECIPIENT_EDIT_LIMIT).map((p, i) => (
                    <div key={`${p}-${i}`} className="flex items-center justify-between gap-2 px-3.5 py-1.5 group">
                      <span className="font-mono text-[12px] text-slate-600">{p}</span>
                      <button type="button" onClick={() => removeAt(i)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-300 hover:text-rose-500 transition shrink-0"
                        aria-label={`${p} 삭제`}>
                        <X size={13} strokeWidth={2.2} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'file' && (
          <label className="flex flex-col items-center justify-center gap-2 px-4 py-12 rounded-2xl bg-white ring-1 ring-dashed ring-violet-200 cursor-pointer text-sm text-violet-600 hover:ring-violet-300 hover:bg-violet-50/40 transition shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Upload size={18} strokeWidth={1.9} className="text-white" />
            </div>
            <span className="font-medium text-slate-700">파일을 선택하세요</span>
            <span className="text-[11px] text-slate-400">CSV · TXT: 번호만 골라 읽습니다</span>
            <input type="file" accept=".csv,.txt,text/plain" className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
        )}

        {mode === 'ai' && (
          <>
            <p className="text-[11px] text-slate-400">찾을 대상을 한 줄로 쓰세요. 연동된 고객DB에서 조건을 만들어 대상을 뽑습니다.</p>
            <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={3}
              placeholder="예) 최근 3개월 구매 없는 VIP 고객"
              className={`${FIELD_CLASS} resize-none`} />
            <button type="button" onClick={runAiTarget} disabled={aiLoading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-500/25 disabled:opacity-40 disabled:shadow-none inline-flex items-center justify-center gap-1.5 transition">
              {aiLoading ? <><Loader2 size={14} className="animate-spin" /> 추출 중...</> : <><Sparkles size={14} /> 타겟 추출</>}
            </button>
            {aiError && <p className="text-xs text-rose-600">{aiError}</p>}
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
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white/70 px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
          <Users size={13} strokeWidth={1.9} className="text-slate-300" />
          수신자 <span className="font-bold text-violet-600 tabular-nums">{phones.length.toLocaleString()}</span>명
        </p>
        {phones.length > 0 && (
          <button type="button" onClick={() => { setRecipients([]); setAddNotice(''); }}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500 transition">
            <Trash2 size={12} strokeWidth={1.9} /> 비우기
          </button>
        )}
      </div>
    </>
  );

  // 확인 다이얼로그에 적을 유형 — payload가 화면 선택값을 그대로 갖고 있다
  const pendingTypeLabel = pending
    ? `브랜드메시지 ${pending.mode === 'template' ? '기본형' : String(pending.bubbleType || 'TEXT')}`
    : '';

  return (
    <SendWorkspaceShell
      show={show}
      onClose={onClose}
      title="브랜드메시지 발송"
      subtitle={isTarget
        ? `추출된 ${phones.length.toLocaleString()}명에게 브랜드메시지를 발송합니다`
        : '발신프로필이 연동돼 있으면 전화번호로 바로 보냅니다. 템플릿 검수는 필요 없습니다.'}
      icon={<Megaphone size={19} strokeWidth={1.9} className="text-white" />}
      accent={accent}
      notice={!hasProfile ? (
        <WorkspaceNotice>
          카카오 채널 연동(발신프로필 등록)이 필요합니다. 발신프로필이 등록되면 요금제와 무관하게 바로 사용할 수 있습니다.
        </WorkspaceNotice>
      ) : undefined}
      aside={aside}
      maxW="max-w-7xl"
    >
      {/* 우측 — 메시지 (기존 에디터 재사용. 새로 만들면 두 벌이 되고 반드시 갈라진다)
          ★2026-09-01 패딩 래퍼 제거 — 에디터가 자기 패딩과 하단 고정 발송 바(sticky)를 소유한다.
          여기서 패딩을 두르면 발송 바가 스크롤 바닥에서 떠 보인다. */}
      <BrandMessageEditor
        profiles={profiles}
        sending={!!sending}
        accent={accent}
        recipientCount={phones.length}
        onSend={(payload: any) => {
          if (!canSend) return;
          // 바로 보내지 않는다 — 건수를 보여주고 확인을 받는다(문자·알림톡과 같은 계약)
          setPending(payload);
        }}
      />

      <ConfirmDialogShell
        show={!!pending}
        tone={accent}
        icon={<Megaphone size={18} strokeWidth={1.9} className="text-white" />}
        title="지금 바로 발송합니다"
        subtitle="광고성 메시지입니다. 누르는 즉시 나가며 회수할 수 없습니다."
        cancelLabel="취소"
        onCancel={() => setPending(null)}
        confirmLabel="즉시 발송"
        onConfirm={async () => {
          const payload = pending;
          if (!payload) return;
          setPending(null);
          await onSend({ ...payload, phones });
        }}
        busy={!!sending}
        busyLabel="접수 중..."
        confirmDisabled={phones.length === 0}
      >
        <DialogHeadline label="발송 대상" value={phones.length} unit="명" tone={accent} />
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
    </SendWorkspaceShell>
  );
}
