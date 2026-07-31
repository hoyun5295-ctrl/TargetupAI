/**
 * ★ 2026-07-31 정산 메일 수신자 편집 (회사 레벨 / 계정 레벨 공용)
 *
 * 왜 이 화면이 생겼나 — 그전에는 담당자 이메일이 **칸 하나**였다. 그래서
 *  ① 거래내역서 받는 사람과 세금계산서 받는 사람이 다른 고객사를 표현할 수 없었고
 *  ② 여러 명이 받아야 하는 경우를 표현할 수 없었다.
 * 둘 다 "수신자가 컬럼 한 쌍"이라는 한 지점에서 막혀 있었다 → 행으로 바꾸고 이 편집기를 붙였다.
 *
 * 규칙:
 *  - 유형은 `거래내역서` / `세금계산서` 두 갈래. 둘 다 받는 사람은 양쪽에 각각 등록한다.
 *  - **대표는 유형당 1명.** 거래내역서 대표 = 컨펌 링크를 받는 사람, 세금계산서 대표 = 계산서가
 *    발행되는 주소. 나머지는 참조로 사본만 받는다(여러 명이 각각 컨펌하면 상태가 갈라진다).
 *  - native dialog 0 — 삭제는 2단 클릭 확인.
 *
 * 슈퍼관리자 내부 도구 — AdminDashboard 라이트 톤 미러.
 */
import { useMemo, useState } from 'react';

export interface BillingRecipient {
  id: string;
  user_id: string | null;
  doc_type: 'statement' | 'taxbill';
  email: string;
  name: string | null;
  is_primary: boolean;
  is_active: boolean;
}

const DOC_LABEL: Record<string, string> = { statement: '거래내역서', taxbill: '세금계산서' };
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function BillingRecipientsEditor({
  companyId, userId, recipients, onChanged, onError, compact,
}: {
  companyId: string;
  /** null = 회사 레벨(전체 발급·공통 장), 값 = 그 계정 장 */
  userId: string | null;
  recipients: BillingRecipient[];
  onChanged: (next: BillingRecipient[]) => void;
  onError: (msg: string) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { email: string; name: string }>>({
    statement: { email: '', name: '' },
    taxbill: { email: '', name: '' },
  });

  // 이 스코프(회사 레벨 / 특정 계정)의 행만 보여준다 — 축이 섞이면 누가 받는지 알 수 없게 된다.
  const mine = useMemo(
    () => recipients.filter((r) => String(r.user_id || '') === String(userId || '')),
    [recipients, userId],
  );

  const call = async (path: string, init: RequestInit) => {
    setBusy(true);
    try {
      const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...auth(), ...(init.headers || {}) } });
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(data?.error || '처리에 실패했습니다.');
      onChanged(Array.isArray(data?.recipients) ? data.recipients : recipients);
      return true;
    } catch (e: any) {
      onError(e?.message || '처리에 실패했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (docType: 'statement' | 'taxbill') => {
    const d = draft[docType];
    const email = (d?.email || '').trim();
    if (!EMAIL_RE.test(email)) { onError('이메일 형식을 확인해 주세요.'); return; }
    const already = mine.filter((r) => r.doc_type === docType);
    const ok = await call(`/api/admin/billing/company-billing-settings/${companyId}/recipients`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId, doc_type: docType, email, name: (d?.name || '').trim() || null,
        // ★ 2026-07-31 판정 기준은 "행이 없다"가 아니라 **"대표가 없다"**이다(Codex 적대검증 high).
        //   참조만 남은 상태에서 추가한 사람이 대표가 안 되면, 그 유형은 대표 없는 채로 발송된다.
        is_primary: !already.some((r) => r.is_primary),
      }),
    });
    if (ok) setDraft((p) => ({ ...p, [docType]: { email: '', name: '' } }));
  };

  const makePrimary = (r: BillingRecipient) =>
    call(`/api/admin/billing/company-billing-settings/${companyId}/recipients`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, doc_type: r.doc_type, email: r.email, name: r.name, is_primary: true }),
    });

  const remove = async (id: string) => {
    const ok = await call(`/api/admin/billing/company-billing-settings/${companyId}/recipients/${id}`, { method: 'DELETE' });
    if (ok) setAskDelete(null);
  };

  return (
    <div className={`grid gap-3 ${compact ? '' : 'mt-2'}`}>
      {(['statement', 'taxbill'] as const).map((docType) => {
        const rows = mine.filter((r) => r.doc_type === docType);
        const d = draft[docType] || { email: '', name: '' };
        return (
          <div key={docType} className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span className="text-xs font-semibold text-gray-700">{DOC_LABEL[docType]} 수신자</span>
              <span className="text-[11px] text-gray-400">
                {rows.length === 0 ? '미등록 — 이 유형은 발송되지 않습니다' : `${rows.length}명 · 대표 1명 + 참조 ${Math.max(0, rows.length - 1)}명`}
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                  {r.is_primary ? (
                    <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">대표</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => makePrimary(r)}
                      className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-violet-600 hover:border-violet-300 disabled:opacity-50"
                    >
                      참조
                    </button>
                  )}
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{r.email}</span>
                  {r.name && <span className="shrink-0 text-[11px] text-gray-400">{r.name}</span>}
                  {askDelete === r.id ? (
                    <span className="shrink-0 whitespace-nowrap">
                      <button type="button" disabled={busy} onClick={() => remove(r.id)} className="text-[11px] font-medium text-red-600 mr-1.5">삭제</button>
                      <button type="button" onClick={() => setAskDelete(null)} className="text-[11px] text-gray-500">취소</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setAskDelete(r.id)} className="shrink-0 text-[11px] text-gray-400 hover:text-red-600">삭제</button>
                  )}
                </div>
              ))}
            </div>

            {/* ★ 2026-07-31(2) 세금계산서도 복수 수신 개방(Harold) — 대표 주소로 팝빌 발행, 참조는 발행 확정 직후
                설치 SDK 실측 API(sendEmail 재전송)로 같은 계산서 메일을 받는다. 미검증 필드(addContactList)는 여전히 안 쓴다. */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-gray-100">
              <input
                type="email"
                value={d.email}
                disabled={busy}
                onChange={(e) => setDraft((p) => ({ ...p, [docType]: { ...d, email: e.target.value } }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(docType); } }}
                placeholder="이메일 추가"
                className="flex-1 min-w-[180px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
              <input
                type="text"
                value={d.name}
                disabled={busy}
                onChange={(e) => setDraft((p) => ({ ...p, [docType]: { ...d, name: e.target.value } }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(docType); } }}
                placeholder="이름 (선택)"
                className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => add(docType)}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-gray-500">
        거래내역서는 대표에게 컨펌 링크가 가고 참조는 같은 메일을 사본으로 받습니다(참조도 그 링크로 컨펌할 수 있습니다). 세금계산서는 대표 주소로 발행되고, 참조는 발행 직후 같은 계산서 메일을 받습니다.
      </p>
    </div>
  );
}
