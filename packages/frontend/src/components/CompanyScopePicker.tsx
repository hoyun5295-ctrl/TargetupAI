/**
 * ★ 2026-07-31 업체 선택 + 청구 귀속 선택 (080 번호 매핑 · 부가서비스 수기 입력 공용)
 *
 * 왜 컴포넌트로 뽑았나 — 같은 선택을 탭마다 따로 만들면 곧 갈라진다(한쪽만 검색이 되고,
 * 한쪽만 사용자별을 지원하는 상태). 귀속은 청구가 어느 장으로 가는지를 정하는 축이라
 * 두 화면이 다르게 동작하면 그대로 오청구가 된다.
 *
 * 구성:
 *  - 업체는 **검색**으로 고른다(드롭다운은 140사에서 못 찾는다). 선택 후에는 칩으로 접힌다.
 *  - 귀속은 `고객사 전체` / `사용자별` 두 갈래. 전체 = 회사 공통 장, 사용자별 = 그 계정 장.
 *  - 계정 목록은 서버 한 곳(`/company-users/:id`)에서만 받는다 — 화면마다 따로 조회하면
 *    활성·시스템 계정 판정이 갈라진다.
 *
 * 슈퍼관리자 내부 도구 — AdminDashboard 라이트 톤 미러(주변 모달과 같은 톤 유지).
 */
import { useEffect, useMemo, useState } from 'react';
// ★ 업체 검색은 이미 있는 공용 컴포넌트를 쓴다(D144 P11 — 소속회사·발송통계 필터와 같은 것).
//   여기서 검색 입력을 새로 짜면 같은 동작이 두 벌이 되고 곧 한쪽만 고쳐진다.
import SearchableSelect from './SearchableSelect';

export interface CompanyOpt { id: string; company_name: string }
interface UserOpt { id: string; name: string | null; login_id: string }

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export default function CompanyScopePicker({
  companies, companyId, userId, onChange, disabled, label = '회사',
}: {
  companies: CompanyOpt[];
  companyId: string;
  userId: string | null;
  onChange: (next: { companyId: string; userId: string | null }) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userErr, setUserErr] = useState<string | null>(null);

  const selected = useMemo(
    () => companies.find((c) => c.id === companyId) || null,
    [companies, companyId],
  );

  const options = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.company_name })),
    [companies],
  );

  // 회사가 바뀌면 계정 목록을 새로 받는다. 이전 회사의 계정이 남아 있으면 남의 회사 계정으로 저장될 수 있다.
  useEffect(() => {
    if (!companyId) { setUsers([]); setUserErr(null); return; }
    let alive = true;
    setUsersLoading(true); setUserErr(null);
    // 기존 엔드포인트(routes/billing.ts:193)는 **배열을 그대로** 돌려준다. 같은 경로를 새로 만들면
    // Express가 먼저 등록된 쪽만 실행해 죽은 코드가 되므로, 응답 모양을 여기서 맞춘다.
    fetch(`/api/admin/billing/company-users/${companyId}`, { headers: auth() })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (Array.isArray(d)) setUsers(d as UserOpt[]);
        else { setUsers([]); setUserErr(d?.error || '계정 목록을 불러오지 못했습니다.'); }
      })
      .catch(() => { if (alive) { setUsers([]); setUserErr('계정 목록을 불러오지 못했습니다.'); } })
      .finally(() => { if (alive) setUsersLoading(false); });
    return () => { alive = false; };
  }, [companyId]);

  const scope: 'company' | 'user' = userId ? 'user' : 'company';

  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium text-gray-600">{label}</label>

      {/* 회사를 바꾸면 귀속 계정을 반드시 비운다 — 안 비우면 이전 회사 계정 id가 남아 저장된다. */}
      <SearchableSelect
        options={options}
        value={companyId}
        onChange={(v) => onChange({ companyId: v, userId: null })}
        placeholder="업체명 검색"
        className={disabled ? 'pointer-events-none opacity-60' : ''}
      />

      {/* 귀속 — 회사를 고른 뒤에만 의미가 있다 */}
      {selected && (
        <div className="grid gap-2 rounded-lg bg-gray-50 border border-gray-200 p-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs font-medium text-gray-600">청구 귀속</span>
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                checked={scope === 'company'}
                disabled={disabled}
                onChange={() => onChange({ companyId, userId: null })}
                className="accent-violet-600"
              />
              고객사 전체
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                checked={scope === 'user'}
                disabled={disabled || users.length === 0}
                onChange={() => onChange({ companyId, userId: users[0]?.id || null })}
                className="accent-violet-600"
              />
              사용자별
            </label>
            {usersLoading && <span className="text-xs text-gray-400">계정 불러오는 중…</span>}
            {!usersLoading && users.length === 0 && !userErr && (
              <span className="text-xs text-gray-400">등록된 계정이 없어 고객사 전체로만 청구됩니다.</span>
            )}
            {userErr && <span className="text-xs text-rose-500">{userErr}</span>}
          </div>

          {scope === 'user' && users.length > 0 && (
            <select
              value={userId || ''}
              disabled={disabled}
              onChange={(e) => onChange({ companyId, userId: e.target.value || null })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name || u.login_id} ({u.login_id})</option>
              ))}
            </select>
          )}

          <p className="text-[11px] text-gray-500">
            {scope === 'company'
              ? '고객사 전체: 계정별로 발행하는 회사에서는 공통 청구서에 실립니다.'
              : '사용자별: 계정별로 발행하는 회사에서 그 계정의 청구서에만 실립니다.'}
          </p>
        </div>
      )}
    </div>
  );
}
