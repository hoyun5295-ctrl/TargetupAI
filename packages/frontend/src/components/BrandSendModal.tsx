/**
 * BrandSendModal — 브랜드메시지 발송 풀 화면 (★ 2026-07-29 신설)
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
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Megaphone, PencilLine, Upload, Sparkles, Lock, Loader2, Trash2 } from 'lucide-react';
import BrandMessageEditor from './BrandMessageEditor';

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
}

const normalizePhones = (raw: string): string[] =>
  raw
    .split(/[\s,;\n\r\t]+/)
    .map((v) => v.replace(/[^0-9]/g, ''))
    .filter((v) => v.length >= 9 && v.length <= 11);

export default function BrandSendModal({
  show, onClose, profiles, initialRecipients, isAiTargetLocked, onLockedFeature, onSend, sending,
}: BrandSendModalProps) {
  const [mode, setMode] = useState<RecipientMode>('manual');
  const [manualText, setManualText] = useState('');
  const [phones, setPhones] = useState<string[]>([]);

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
    const seeded = (initialRecipients || [])
      .map((p) => String(p).replace(/[^0-9]/g, ''))
      .filter(Boolean);
    setPhones(seeded);
    setManualText(seeded.join('\n'));
    setMode('manual');
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
  const setRecipients = (list: string[], text?: string) => {
    reqSeqRef.current++;          // 진행 중인 추출 응답을 무효화한다
    setAiApplying(false);
    setPhones(list);
    setManualText(text ?? list.join('\n'));
  };

  const applyManual = (v: string) => setRecipients(normalizePhones(v), v);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setRecipients(normalizePhones(text));
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
      setRecipients(list);
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

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-violet-50/60">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-violet-600" strokeWidth={1.75} />
            <div>
              <h2 className="text-base font-bold text-gray-900">브랜드메시지 발송</h2>
              <p className="text-xs text-gray-500">발신프로필이 연동돼 있으면 전화번호로 바로 보냅니다. 템플릿 검수는 필요 없습니다.</p>
            </div>
          </div>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border hover:bg-gray-50">
            <X size={14} strokeWidth={1.75} /><span>창닫기</span>
          </button>
        </div>

        {/* 채널 미연동 안내 — 요금제가 아니라 기술적 전제라 문구를 구분한다 */}
        {!hasProfile && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            카카오 채널 연동(발신프로필 등록)이 필요합니다. 발신프로필이 등록되면 요금제와 무관하게 바로 사용할 수 있습니다.
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          {/* 좌측 — 수신자 */}
          <div className="w-[380px] shrink-0 border-r flex flex-col min-h-0">
            <div className="flex border-b">
              {modeTabs.map((t) => (
                <button key={t.key}
                  onClick={() => { if (t.locked) { onLockedFeature('AI 타겟추출', '베이직'); return; } setMode(t.key); }}
                  className={`flex-1 px-3 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1 border-b-2 transition ${
                    mode === t.key ? 'border-violet-500 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  <t.icon size={13} strokeWidth={1.75} />
                  <span>{t.label}</span>
                  {t.locked && <Lock size={11} strokeWidth={2} className="text-gray-400" />}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {mode === 'manual' && (
                <>
                  <p className="text-xs text-gray-500">번호를 줄바꿈·쉼표로 구분해 붙여넣으세요.</p>
                  <textarea value={manualText} onChange={(e) => applyManual(e.target.value)} rows={14}
                    placeholder={'01012345678\n01087654321'}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-violet-500 outline-none" />
                </>
              )}

              {mode === 'file' && (
                <label className="flex flex-col items-center justify-center gap-2 px-4 py-10 border-2 border-dashed border-violet-300 rounded-lg cursor-pointer text-sm text-violet-600 hover:bg-violet-50">
                  <Upload size={20} strokeWidth={1.75} />
                  <span>파일을 선택하세요 (CSV·TXT)</span>
                  <span className="text-[11px] text-gray-400">번호만 골라 읽습니다</span>
                  <input type="file" accept=".csv,.txt,text/plain" className="hidden"
                    onChange={(e) => { handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                </label>
              )}

              {mode === 'ai' && (
                <>
                  <p className="text-xs text-gray-500">찾을 대상을 한 줄로 쓰세요. 연동된 고객DB에서 조건을 만들어 대상을 뽑습니다.</p>
                  <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={3}
                    placeholder="예) 최근 3개월 구매 없는 VIP 고객"
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-violet-500 outline-none" />
                  <button onClick={runAiTarget} disabled={aiLoading}
                    className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                    {aiLoading ? <><Loader2 size={14} className="animate-spin" /> 추출 중...</> : <><Sparkles size={14} /> 타겟 추출</>}
                  </button>
                  {aiError && <p className="text-xs text-rose-600">{aiError}</p>}
                  {aiResult && (
                    <div className="px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-800 space-y-2">
                      <p className="font-semibold">대상 {aiResult.matchCount.toLocaleString()}명</p>
                      {/* 어떤 조건으로 뽑았는지 보여준다 — 근거 없이 담으면 사람이 검증할 수 없다 */}
                      {aiResult.explanation && <p className="text-violet-700 leading-relaxed">{aiResult.explanation}</p>}
                      <button onClick={applyAiTarget} disabled={aiApplying || aiResult.matchCount === 0}
                        className="w-full py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-xs font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                        {aiApplying
                          ? <><Loader2 size={12} className="animate-spin" /> 불러오는 중...</>
                          : <>리스트에 담기 ({aiResult.matchCount.toLocaleString()}명)</>}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="border-t px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-gray-600">수신자 <span className="font-bold text-violet-600">{phones.length.toLocaleString()}</span>명</p>
              {phones.length > 0 && (
                <button onClick={() => setRecipients([])}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-rose-500">
                  <Trash2 size={12} strokeWidth={1.75} /> 비우기
                </button>
              )}
            </div>
          </div>

          {/* 우측 — 메시지 (기존 에디터 재사용. 새로 만들면 두 벌이 되고 반드시 갈라진다) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <BrandMessageEditor
              profiles={profiles}
              sending={!!sending}
              onSend={(payload: any) => {
                if (!canSend) return;
                return onSend({ ...payload, phones });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
