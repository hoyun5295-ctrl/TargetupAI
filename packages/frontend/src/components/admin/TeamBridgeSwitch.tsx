/**
 * ★ 2026-11-26 Team 한줄로로 데이터 주기 — 슈퍼관리자 회사 목록의 「Team」 표 · 켜기 · 끄기 창.
 * 판정 · 저장 = 백엔드 CT utils/team-bridge.ts(라우트 /api/admin/team-bridge). 사용구분(웹 · 에이전트)은 그대로 둔다.
 * Team 한줄로는 별개 플랫폼이다 — 켜면 Team 운영 관리자가 이 회사를 Team 업체로 열 수 있고, 대행 성과지표가 Team 으로 간다.
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminDetailModal, AdminPill, ADMIN_BTN, ADMIN_BTN_PRIMARY, ADMIN_BTN_SM } from './ui/admin-ui';

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem('token');
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` };
}

/** 켠 회사 id 집합 — 못 읽으면 null(표를 달지 않고 단추도 숨긴다) */
export function useTeamBridgeIds() {
  const [ids, setIds] = useState<Set<string> | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/team-bridge/companies', { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.companyIds)) throw new Error(data.error || 'Team 연동 상태를 읽지 못했습니다.');
      setIds(new Set<string>(data.companyIds.map(String)));
    } catch {
      setIds(null);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ids, reload };
}

export function TeamBridgePill({ on }: { on: boolean }) {
  return on ? <AdminPill tone="green">Team</AdminPill> : null;
}

export function TeamBridgeButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ADMIN_BTN_SM}>
      {on ? 'Team 끄기' : 'Team 켜기'}
    </button>
  );
}

export function TeamBridgeModal({
  company,
  on,
  onClose,
  onDone,
  showAlert,
}: {
  company: { id: string; company_name: string };
  on: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/team-bridge/companies/${company.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ enabled: !on }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.enabled !== 'boolean') throw new Error(data.error || 'Team 연동 상태를 바꾸지 못했습니다.');
      await onDone();
      // 안내 = 서버가 저장한 결과(제출 때 화면 값이 아니다)
      showAlert(data.enabled ? 'Team 켬' : 'Team 끔', data.enabled ? `${company.company_name} 의 데이터를 Team 한줄로로 줍니다.` : `${company.company_name} 의 데이터를 Team 한줄로로 더는 주지 않습니다.`, 'success');
    } catch (e: any) {
      showAlert('오류', e?.message || 'Team 연동 상태를 바꾸지 못했습니다.', 'error');
      setBusy(false);
    }
  }

  return (
    <AdminDetailModal
      title={`${on ? 'Team 한줄로 데이터 끄기' : 'Team 한줄로로 데이터 주기'} · ${company.company_name}`}
      onClose={() => { if (!busy) onClose(); }}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={ADMIN_BTN} disabled={busy} onClick={onClose}>취소</button>
          <button type="button" className={ADMIN_BTN_PRIMARY} disabled={busy} onClick={() => void submit()}>
            {busy ? '바꾸는 중…' : on ? '끄기' : '켜기'}
          </button>
        </div>
      }
    >
      <p className="text-[13px] text-gray-700 leading-relaxed">
        {on
          ? 'Team 한줄로가 이 회사의 값을 더는 받지 못합니다. 이미 Team 업체로 연 곳은 Team 관리 화면에 「한줄로AI 데이터 꺼짐」으로 보입니다. 사용구분(웹 · 에이전트)과 발송은 그대로입니다.'
          : 'Team 한줄로(캠페인 대행 · 별개 플랫폼)의 운영 관리자가 이 회사를 Team 업체로 열 수 있게 됩니다. 사용구분(웹 · 에이전트)과 발송은 그대로이고, 발송은 지금처럼 한줄로AI 에서만 합니다.'}
      </p>
    </AdminDetailModal>
  );
}
