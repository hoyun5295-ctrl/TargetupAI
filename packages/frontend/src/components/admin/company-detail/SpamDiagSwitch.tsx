/**
 * SpamDiagSwitch — 슈퍼관리자 회사 상세 「막힌 부분 다시 확인」 회사 스위치(★ 2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §9)
 *   스팸 검사가 막혔을 때 의심 부분을 뺀 글을 막힌 통신사로 한 통 보내 보는 확인(요금 없음)을 이 회사에 연다.
 *   값은 자기 GET 으로 읽고 PATCH 로 쓴다(회사 편집 상태 타입을 넓히지 않는다) · 칸이 없으면(DB 준비 전) 스위치를 잠근다.
 *   끄면 새 확인만 멈춘다 · 의심 부분 안내는 그대로 보인다.
 */
import { useEffect, useState } from 'react';

type AlertFn = (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
type Loaded = { enabled: boolean; ready: boolean } | 'error' | null;

export default function SpamDiagSwitch({ companyId, showAlert }: { companyId: string; showAlert: AlertFn }) {
  const [state, setState] = useState<Loaded>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setState(null);
    const token = localStorage.getItem('token');
    fetch(`/api/admin/companies/${companyId}/spam-diag`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (alive) setState(res.ok ? { enabled: data.enabled === true, ready: data.ready === true } : 'error');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [companyId]);

  const loaded = state !== null && state !== 'error' ? state : null;
  const disabled = busy || !loaded || !loaded.ready;

  const toggle = async (next: boolean) => {
    if (disabled || !loaded) return;
    setBusy(true);
    setState({ ...loaded, enabled: next });
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/companies/${companyId}/spam-diag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ ...loaded, enabled: !next });   // 서버가 거절하면 되돌린다
        showAlert('오류', data?.error || '막힌 부분 다시 확인 스위치 저장 실패', 'error');
      } else {
        setState({ ...loaded, enabled: data.enabled === true });
        showAlert('완료', data?.message || '막힌 부분 다시 확인 스위치 저장 완료', 'success');
      }
    } catch (err: any) {
      setState({ ...loaded, enabled: !next });
      showAlert('오류', err?.message || '네트워크 오류', 'error');
    } finally {
      setBusy(false);
    }
  };

  const note = state === 'error' ? '상태를 읽지 못했습니다. 창을 다시 열어 주세요.'
    : loaded && !loaded.ready ? 'DB 준비 전입니다(companies.spam_diag_enabled 칸 추가 뒤 켤 수 있습니다).' : '';

  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800">막힌 부분 다시 확인</span>
            <span className="text-xs bg-amber-500 text-white px-1.5 py-0.5 rounded">NEW</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            ON = 스팸 검사가 막히면 의심 부분(글 속 주소 등)을 뺀 글을 막힌 통신사로 한 통 보내 원인을 좁힙니다. 요금은 받지 않습니다. 고객 발신번호로 나가는 발송이라 회사 단위로 켭니다.
            OFF = 새 확인은 나가지 않습니다. 막혔을 수 있는 부분 안내는 그대로 보입니다.
          </p>
          {note && <p className="text-xs text-amber-700 mt-1">{note}</p>}
        </div>
        <label className={`relative inline-flex items-center ml-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={loaded?.enabled === true}
            disabled={disabled}
            onChange={(e) => { void toggle(e.target.checked); }}
            className="sr-only peer"
            aria-label="막힌 부분 다시 확인"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
        </label>
      </div>
    </div>
  );
}
