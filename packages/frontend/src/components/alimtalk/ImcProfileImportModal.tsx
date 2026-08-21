/**
 * IMC 계정 → 한줄로 회사 이관 모달 (슈퍼관리자 전용)
 *
 * ★ 2026-08-04 신설. 백엔드 엔드포인트 셋은 0714~0730에 이미 만들어져 있었는데 **화면이 없어서**
 *   그동안 이관을 할 때마다 사람이 토큰을 들고 직접 호출해야 했다(0730 아이올리, 0804 메트로시티).
 *   같은 작업이 반복되므로 화면에 붙인다. 새 API·새 로직은 만들지 않는다.
 *
 * 흐름 = 딜러 이관(다우 → 휴머스온) 후 우리 쪽에 자산을 들여오는 순서 그대로다.
 *   ① IMC 계정에서 채널명으로 발신프로필을 찾는다
 *      — ★ 옛 senderKey로 조회하면 `4011 찾을 수 없음`이 나온다(이관 시 키가 새로 발급되기 때문).
 *        그래서 판정 수단은 키 조회가 아니라 **이름 검색**이다(0730 실측).
 *   ② 그 프로필을 대상 회사에 연결한다(`/senders/import`)
 *   ③ 그 senderKey의 템플릿을 가져온다(`/templates/import`) — 미리보기(dryRun)를 먼저 보고 반영한다.
 *      템플릿 가져오기는 ②가 끝나 있어야 동작한다(서버가 연결 여부를 먼저 본다).
 */

import { useEffect, useMemo, useState } from 'react';
// ★ 회사가 141개라 기본 select로는 눈으로 못 찾는다 — 검색 가능한 공용 CT를 쓴다(신규 구현 금지).
import SearchableSelect from '../SearchableSelect';

interface Company {
  id: string;
  company_name: string;
}

interface Props {
  companies: Company[];
  onClose: () => void;
  /** 연결·가져오기가 실제로 반영됐을 때 — 부모가 목록을 새로 읽는다. */
  onDone: (message: string) => void;
  /**
   * `full`(기본, 발신프로필 화면) = IMC 검색 → 프로필 연결 → 템플릿 가져오기.
   * `templateOnly`(템플릿 화면) = **이미 연결된 프로필**을 골라 템플릿만 가져온다.
   *   프로필이 이미 있는데 템플릿만 다시 받아야 하는 경우(딜러 이관이 프로필 먼저 끝나는 일이 잦다)를
   *   위해 둔다. 이때 `/senders/import`는 부르지 않는다 — 이미 연결된 키는 409로 막히기 때문이다.
   */
  mode?: 'full' | 'templateOnly';
}

function getToken() {
  return localStorage.getItem('token') || '';
}

/** IMC 목록 항목 — 계정별로 내려오는 키 이름이 갈려 폴백으로 읽는다(원문은 아래 raw로 함께 보여준다). */
function pickSenderKey(it: any): string {
  return String(it?.senderKey || it?.sender_key || '').trim();
}
function pickLabel(it: any): string {
  return String(it?.senderName || it?.name || it?.yellowId || it?.channelName || '(이름 없음)');
}
function pickStatus(it: any): string {
  return String(it?.status || it?.senderStatus || it?.state || '-');
}

export default function ImcProfileImportModal({ companies, onClose, onDone, mode = 'full' }: Props) {
  const templateOnly = mode === 'templateOnly';
  /** templateOnly 전용 — 선택한 회사에 **이미 연결된** 발신프로필(우리 DB) */
  const [linkedProfiles, setLinkedProfiles] = useState<any[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rawBody, setRawBody] = useState<any>(null);

  /** 연결 완료된 senderKey — 여기 값이 있어야 템플릿 가져오기가 열린다(서버 계약과 같은 순서). */
  const [linkedKey, setLinkedKey] = useState('');
  const [linkedLabel, setLinkedLabel] = useState('');
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  /** templateOnly — 회사를 고르면 그 회사에 연결된 프로필을 우리 DB에서 읽는다(IMC 호출 없음). */
  useEffect(() => {
    if (!templateOnly || !companyId) { setLinkedProfiles([]); return; }
    let alive = true;
    setProfilesLoading(true); setError('');
    (async () => {
      try {
        const res = await fetch('/api/alimtalk/senders', { headers: { Authorization: `Bearer ${getToken()}` } });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok || data?.success === false) throw new Error(data?.error || '발신프로필 조회 실패');
        const mine = (data.profiles || []).filter((p: any) => String(p.company_id) === companyId);
        setLinkedProfiles(mine);
      } catch (e: any) {
        if (alive) setError(e?.message || '발신프로필 조회 실패');
      } finally {
        if (alive) setProfilesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [templateOnly, companyId]);

  const search = async () => {
    if (!keyword.trim()) { setError('찾을 채널명을 입력해주세요'); return; }
    setSearching(true); setError(''); setItems([]); setSearched(false); setRawBody(null);
    try {
      const res = await fetch(`/api/alimtalk/senders/imc?name=${encodeURIComponent(keyword.trim())}&size=100`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setRawBody(data);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || `IMC 조회 실패 (code ${data?.imcCode || '-'})`);
      }
      const list: any[] = data?.imc?.data?.list || [];
      setItems(list);
      setSearched(true);
    } catch (e: any) {
      setError(e?.message || 'IMC 조회 실패');
    } finally {
      setSearching(false);
    }
  };

  const linkProfile = async (it: any) => {
    const senderKey = pickSenderKey(it);
    if (!companyId) { setError('연결할 회사를 먼저 선택해주세요'); return; }
    if (!senderKey) { setError('이 항목에 senderKey가 없습니다. 아래 원문에서 확인이 필요합니다'); return; }
    setWorking(true); setError('');
    try {
      const res = await fetch('/api/alimtalk/senders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ companyId, senderKey, profileName: pickLabel(it) }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(data?.error || '연결 실패');
      setLinkedKey(senderKey);
      setLinkedLabel(pickLabel(it));
      setPreview(null);
      onDone(`발신프로필 연결 완료: ${pickLabel(it)}`);
    } catch (e: any) {
      setError(e?.message || '연결 실패');
    } finally {
      setWorking(false);
    }
  };

  const importTemplates = async (dryRun: boolean) => {
    if (!linkedKey) return;
    setWorking(true); setError('');
    try {
      const res = await fetch('/api/alimtalk/templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ companyId, senderKey: linkedKey, dryRun }),
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(data?.error || '템플릿 가져오기 실패');
      setPreview({ ...data, dryRun });
      if (!dryRun) onDone(`템플릿 가져오기 완료: ${linkedLabel}`);
    } catch (e: any) {
      setError(e?.message || '템플릿 가져오기 실패');
    } finally {
      setWorking(false);
    }
  };

  const companyName = companies.find((c) => c.id === companyId)?.company_name || '';
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.company_name })),
    [companies],
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[70]" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {templateOnly ? 'IMC에서 템플릿 가져오기' : 'IMC 계정에서 가져오기'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {templateOnly
                ? '이미 연결된 발신프로필을 골라 그 프로필의 템플릿을 IMC에서 들여옵니다.'
                : '딜러 이관(다우 → 휴머스온)이 끝난 발신프로필과 템플릿을 우리 회사로 들여옵니다.'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* 1단계 — 대상 회사 + 채널명 검색.
            ★ 스크롤 컨테이너 **밖**에 둔다. 안에 두면 회사 검색 드롭다운이 `overflow-y-auto`에 잘려
            목록이 두 줄만 보인다(0804 실측). 여기 두면 아래 스크롤 영역 위로 펼쳐진다. */}
        <div className="px-6 pt-4 shrink-0">
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">
              {templateOnly ? '1. 회사와 발신프로필' : '1. 대상 회사와 채널명'}
            </p>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-[220px]">
                <SearchableSelect
                  options={companyOptions}
                  value={companyId}
                  onChange={(v) => { setCompanyId(v); setLinkedKey(''); setPreview(null); }}
                  placeholder="회사명 입력해 검색"
                />
              </div>
              {!templateOnly && (
                <>
                  <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                    placeholder="채널명 일부 (예: 메트로시티)"
                    className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <button onClick={search} disabled={searching}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                    {searching ? '검색 중...' : '검색'}
                  </button>
                </>
              )}
            </div>

            {templateOnly ? (
              <div className="mt-3">
                {!companyId ? (
                  <p className="text-[11px] text-gray-400">회사를 먼저 고르면 연결된 발신프로필이 나옵니다.</p>
                ) : profilesLoading ? (
                  <p className="text-[11px] text-gray-400">발신프로필을 불러오는 중...</p>
                ) : linkedProfiles.length === 0 ? (
                  <p className="text-[11px] text-amber-600">
                    이 회사에 연결된 발신프로필이 없습니다. 발신프로필 관리 화면의 [IMC에서 가져오기]로 먼저 연결해 주세요.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {linkedProfiles.map((p: any) => {
                      const k = String(p.profile_key || '');
                      const on = k === linkedKey;
                      return (
                        <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50">
                          <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{p.profile_name}</span>
                          <span className="text-[10px] text-gray-400 shrink-0">{p.yellow_id || '-'}</span>
                          <span className="text-[10px] font-mono text-gray-400 shrink-0 truncate max-w-[160px]">{k}</span>
                          <button
                            onClick={() => { setLinkedKey(k); setLinkedLabel(String(p.profile_name || '')); setPreview(null); }}
                            disabled={on}
                            className="shrink-0 px-2.5 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-40">
                            {on ? '선택됨' : '선택'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 mt-2">
                옛 senderKey로는 찾을 수 없습니다. 딜러 이관 시 키가 새로 발급되어 이전 키 조회는 `4011`이 됩니다. 채널명으로 찾습니다.
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
          )}

          {/* 2단계 — 검색 결과에서 연결 */}
          {searched && (
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-700 mb-2">2. 발신프로필 연결 ({items.length}건)</p>
              {items.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  그 이름으로 우리 IMC 계정에 보이는 프로필이 없습니다. 이관이 아직 안 끝났거나 채널명이 다릅니다.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {items.map((it, i) => {
                    const key = pickSenderKey(it);
                    const isLinked = key && key === linkedKey;
                    return (
                      <div key={`${key}-${i}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50">
                        <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{pickLabel(it)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 shrink-0">{pickStatus(it)}</span>
                        <span className="text-[10px] font-mono text-gray-400 shrink-0 truncate max-w-[180px]">{key || 'key 없음'}</span>
                        <button onClick={() => linkProfile(it)} disabled={working || isLinked || !companyId}
                          className="shrink-0 px-2.5 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-40">
                          {isLinked ? '연결됨' : '연결'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => setShowRaw((v) => !v)} className="mt-2 text-[11px] text-gray-400 hover:text-gray-600">
                {showRaw ? '원문 접기' : 'IMC 원문 보기'}
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-52 overflow-auto rounded bg-gray-900 text-gray-100 p-3 text-[10px] leading-relaxed">
                  {JSON.stringify(rawBody, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* 3단계 — 템플릿 가져오기 */}
          {linkedKey && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <p className="text-xs font-semibold text-violet-700 mb-1">
                3. 템플릿 가져오기: {companyName} · {linkedLabel}
              </p>
              <p className="text-[11px] text-gray-500 mb-3">
                미리보기로 건수를 먼저 확인하고 반영합니다. 회사 안에 같은 코드가 이미 있으면 건너뜁니다.
              </p>
              <div className="flex gap-2">
                <button onClick={() => importTemplates(true)} disabled={working}
                  className="px-3 py-1.5 text-xs rounded bg-white border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40">
                  {working ? '조회 중...' : '미리보기'}
                </button>
                <button onClick={() => importTemplates(false)} disabled={working || !preview}
                  className="px-3 py-1.5 text-xs rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                  실제 반영
                </button>
              </div>
              {preview && (
                <pre className="mt-3 max-h-52 overflow-auto rounded bg-white border border-violet-200 p-3 text-[11px] leading-relaxed text-gray-700">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">닫기</button>
        </div>
      </div>
    </div>
  );
}
