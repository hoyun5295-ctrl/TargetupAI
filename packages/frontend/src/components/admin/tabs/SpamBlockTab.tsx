/**
 * SpamBlockTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import ListPager, { pageSlice } from '../../shared/ListPager';
import { resolveSpamRuleSourceLabel, resolveSpamHitSourceLabel } from '../../../constants/spam-block-labels';

export interface SpamBlockTabProps {
  loadSpamBlock: () => Promise<void>;
  loadSpamHits: (page: number) => Promise<void>;
  setSpamBusy: Dispatch<SetStateAction<boolean>>;
  setSpamElements: Dispatch<SetStateAction<{ type: string; value: string; }[]>>;
  setSpamModeBusyId: Dispatch<SetStateAction<string | null>>;
  setSpamRuleName: Dispatch<SetStateAction<string>>;
  setSpamRulesPage: Dispatch<SetStateAction<number>>;
  setSpamSim: Dispatch<any>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  spamBlockNotice: string;
  spamBusy: boolean;
  spamElements: { type: string; value: string; }[];
  spamHits: any[];
  spamHitsPage: number;
  spamHitsTotal: number;
  spamModeBusyId: string | null;
  spamRuleName: string;
  spamRules: any[];
  spamRulesPage: number;
  spamSim: any;
}

export default function SpamBlockTab(props: SpamBlockTabProps) {
  const { loadSpamBlock, loadSpamHits, setSpamBusy, setSpamElements, setSpamModeBusyId, setSpamRuleName, setSpamRulesPage, setSpamSim, showAlert, showConfirm, spamBlockNotice, spamBusy, spamElements, spamHits, spamHitsPage, spamHitsTotal, spamModeBusyId, spamRuleName, spamRules, spamRulesPage, spamSim } = props;

  const spamElementsPayload = () => spamElements.filter((e) => e.value.trim()).map((e) => ({ type: e.type, value: e.value.trim() }));

  // ★ 규칙을 등록하기 전에 실제 발송 문안으로 돌려본다 — 정상 문자가 잡히는지 눈으로 본다
  const handleSpamSimulate = async () => {
    setSpamBusy(true);
    setSpamSim(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/spam-block/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ elements: spamElementsPayload(), days: 7 }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '시뮬레이션에 실패했습니다.', 'error'); return; }
      setSpamSim(data);
    } finally { setSpamBusy(false); }
  };

  const handleSpamCreate = async () => {
    if (!spamRuleName.trim()) { showAlert('확인', '규칙 이름을 입력해주세요.', 'error'); return; }
    setSpamBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/spam-block/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: spamRuleName.trim(), elements: spamElementsPayload() }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '규칙 생성에 실패했습니다.', 'error'); return; }
      setSpamRuleName('');
      setSpamElements([{ type: 'keyword', value: '' }, { type: 'keyword', value: '' }]);
      setSpamSim(null);
      await loadSpamBlock();
      showAlert('성공', '규칙이 탐지로 등록되었습니다. 결과 로그에서 무엇이 걸리는지 확인한 뒤 목록에서 차단으로 전환하세요.', 'success');
    } finally { setSpamBusy(false); }
  };
  const handleSpamModeChange = (r: any) => {
    const next = r.mode === 'block' ? 'detect' : 'block';
    const message = next === 'block'
      ? `「${r.name}」을 차단으로 전환합니다.\n\n이 조합에 걸리는 문자 발송은 차감 전에 중지되고 발송자에게 안내가 표시됩니다. 최근 발송 문안으로 오탐 확인을 마친 규칙만 전환하세요.`
      : `「${r.name}」을 탐지로 전환합니다.\n\n이 조합에 걸려도 발송은 그대로 나가고 결과 로그에만 남습니다.`;
    showConfirm(next === 'block' ? '차단으로 전환' : '탐지로 전환', message, async () => {
      setSpamModeBusyId(r.id);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/admin/spam-block/rules/${r.id}/mode`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ mode: next }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) { showAlert('오류', data?.error || '전환에 실패했습니다.', 'error'); return; }
        await loadSpamBlock();
        showAlert('성공', next === 'block' ? '차단으로 전환했습니다. 지금부터 이 조합의 문자 발송이 중지됩니다.' : '탐지로 전환했습니다.', 'success');
      } finally { setSpamModeBusyId(null); }
    });
  };
  return (
    <>
    {(
          <div className="space-y-6">
            {/* ★0827 차단 체계 선언 — 심사(5.2)는 "발송 요청 시 자동 차단"이 화면에서 읽히는지를 본다. */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-white">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-gray-400">발송 요청 필터링 정책</div>
                  <h3 className="mt-1 text-base font-bold">금칙어 · 악성 URL 자동 차단</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
                    모든 문자(SMS · LMS · MMS) 발송 요청은 요금 차감과 큐 적재 전에 차단정보와 대조합니다.
                    <span className="font-semibold text-white"> 차단</span>으로 둔 조합에 걸린 문안은 <span className="font-semibold text-white">발송이 중지</span>되고
                    발송자에게 안내가 표시되며, 그 사실이 차단 결과 로그에 남습니다.
                    <span className="font-semibold text-white"> 탐지</span>로 둔 조합은 발송을 막지 않고 기록만 합니다.
                  </p>
                </div>
                <div className="shrink-0 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-center">
                  <div className="text-[10px] text-gray-400">발송 차단 중인 차단정보</div>
                  <div className="text-base font-bold text-white tabular-nums">
                    {spamRules.filter((r) => r.is_active && r.mode === 'block').length}<span className="ml-0.5 text-xs font-semibold text-gray-400">건</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-500">탐지 {spamRules.filter((r) => r.is_active && r.mode !== 'block').length}건 · 문자 발송 전 경로</div>
                </div>
              </div>
              {spamBlockNotice && (
                <div className="mt-4 rounded-lg border border-rose-400/40 bg-rose-500/15 px-4 py-3">
                  <div className="text-[10px] font-semibold text-rose-300">차단 시 발송자에게 표시되는 안내</div>
                  <p className="mt-1 text-xs leading-relaxed text-rose-100">{spamBlockNotice}</p>
                  <div className="mt-1 text-[10px] text-gray-500 italic">Data source: 서버 차단 응답 문구</div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-semibold text-gray-900">차단정보 등록</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                키워드 · URL · 전화번호를 <span className="font-medium">2~5개 조합</span>으로 만듭니다. 요소가 <span className="font-medium">전부 맞을 때만</span> 걸립니다.
                단일 키워드는 정상 문자를 막기 때문에 등록되지 않습니다.
              </p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                새 규칙은 <span className="font-medium text-gray-700">탐지</span>로 시작합니다. <span className="font-medium text-gray-700">최근 발송 문안으로 오탐을 먼저 확인</span>한 뒤 목록에서 차단으로 전환하세요.
                정상 문안이 걸리는 조합을 차단으로 두면 그 고객사의 발송이 실제로 멈춥니다.
              </p>

              <div className="mt-4 space-y-3">
                <input type="text" value={spamRuleName} onChange={(e) => setSpamRuleName(e.target.value)}
                  placeholder="규칙 이름 (예: 무직자 당일대출 스팸)"
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/30 outline-none" />

                {spamElements.map((el, i) => (
                  <div key={i} className="flex gap-2">
                    <select value={el.type}
                      onChange={(e) => setSpamElements(spamElements.map((x, xi) => xi === i ? { ...x, type: e.target.value } : x))}
                      className="w-32 px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/30 outline-none">
                      <option value="keyword">키워드</option>
                      <option value="url">URL</option>
                      <option value="phone">전화번호</option>
                    </select>
                    <input type="text" value={el.value}
                      onChange={(e) => setSpamElements(spamElements.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x))}
                      placeholder={el.type === 'url' ? 'bit.ly' : el.type === 'phone' ? '010-0000-0000' : '무직자'}
                      className="flex-1 px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                    {spamElements.length > 2 && (
                      <button type="button" onClick={() => setSpamElements(spamElements.filter((_, xi) => xi !== i))}
                        className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">삭제</button>
                    )}
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  {spamElements.length < 5 && (
                    <button type="button" onClick={() => setSpamElements([...spamElements, { type: 'keyword', value: '' }])}
                      className="whitespace-nowrap px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">요소 추가</button>
                  )}
                  <button type="button" onClick={handleSpamSimulate} disabled={spamBusy || spamElementsPayload().length < 2}
                    className="whitespace-nowrap px-4 py-2 text-xs font-medium border border-emerald-200 text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 disabled:opacity-50">
                    {spamBusy ? '확인 중…' : '최근 발송 문안으로 오탐 확인'}
                  </button>
                  <button type="button" onClick={handleSpamCreate} disabled={spamBusy || spamElementsPayload().length < 2}
                    className="whitespace-nowrap px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg">
                    차단정보 등록
                  </button>
                </div>

                {spamSim && (
                  <div className={`rounded-lg border px-4 py-3 text-xs ${spamSim.matchedCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                    <p className="font-medium">
                      최근 {spamSim.scannedDays}일 발송 문안 {spamSim.scanned}건 중 <span className="font-bold">{spamSim.matchedCount}건</span> 일치
                    </p>
                    {spamSim.matchedCount > 0 && (
                      <>
                        <p className="mt-1 text-[11px]">아래 문안이 정상이라면 조합을 더 좁혀주세요.</p>
                        <ul className="mt-2 space-y-1">
                          {spamSim.samples?.map((sm: any, i: number) => (
                            <li key={i} className="bg-white/70 rounded px-2 py-1 text-[11px] text-gray-700 truncate">{sm.sample}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">차단정보 목록</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2 text-left">이름</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">조합</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">출처</th>
                      <th className="whitespace-nowrap px-4 py-2 text-right">탐지</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {spamRules.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">등록된 차단정보가 없습니다. 차단정보가 없으면 발송은 그대로 나갑니다.</td></tr>
                    )}
                    {pageSlice(spamRules, spamRulesPage).map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(r.elements || []).map((el: any, i: number) => (
                              <span key={i} className="px-2 py-0.5 text-[11px] bg-gray-100 text-gray-700 rounded">
                                {el.type === 'url' ? 'URL' : el.type === 'phone' ? '번호' : '키워드'} · {el.value}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{resolveSpamRuleSourceLabel(r.source)}</td>
                        <td className="px-4 py-2 text-right text-xs text-gray-700">{r.hit_count}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className={`px-2 py-0.5 text-[11px] rounded ${!r.is_active ? 'bg-gray-100 text-gray-500' : r.mode === 'block' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                              {!r.is_active ? '사용 안 함' : r.mode === 'block' ? '발송 차단' : '탐지만'}
                            </span>
                            {r.is_active && (
                              <button type="button" onClick={() => handleSpamModeChange(r)} disabled={spamModeBusyId === r.id}
                                className={`whitespace-nowrap px-2.5 py-1 text-[11px] font-medium rounded-lg border disabled:opacity-50 ${r.mode === 'block' ? 'border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100'}`}>
                                {spamModeBusyId === r.id ? '전환 중…' : r.mode === 'block' ? '탐지로 전환' : '차단으로 전환'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPager page={spamRulesPage} total={spamRules.length} onPage={setSpamRulesPage} />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">탐지 · 차단 결과 로그</h3>
                <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 금칙어 탐지 · 차단 기록</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2 text-left">시각</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">규칙</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">고객사</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">경로</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">처리</th>
                      <th className="whitespace-nowrap px-4 py-2 text-right">건수</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">문안</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {spamHits.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-xs">탐지 이력이 없습니다.</td></tr>
                    )}
                    {spamHits.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-2 text-xs text-gray-500">{new Date(h.created_at).toLocaleString('ko-KR')}</td>
                        <td className="px-4 py-2 text-xs text-gray-900">{h.rule_name || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-700">{h.company_name || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{resolveSpamHitSourceLabel(h.send_source)}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 text-[11px] rounded whitespace-nowrap ${h.action_taken === 'block' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                            {h.action_taken === 'block' ? '발송 차단' : h.mode === 'block' ? '탐지 · 차단 규칙' : '탐지'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-gray-700">{h.affected_rows}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">{h.content_sample}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPager page={spamHitsPage} total={spamHitsTotal} onPage={(p) => { void loadSpamHits(p); }} />
            </div>
          </div>
        )}
    </>
  );
}
