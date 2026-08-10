/**
 * components/cdp/CdpActiveCustomersTable.tsx — 자사몰 활성 고객 표 (★2026-08-10 Phase 5)
 *
 * `CdpSettingsPage`의 "자사몰 활성 고객" 모달 내용물을 그대로 옮긴 것이다.
 *
 * ⛔ 이 표는 **고객 이름·전화번호**를 그린다. 권한 판정은 여기서 하지 않는다 —
 *   서버가 관리자 전용으로 막고(`GET /api/cdp/active-customers` 403), 페이지가 진입점과 조회를 함께 막는다.
 *   여기에 또 하나의 판정을 두면 세 곳이 서로 다른 기준을 갖게 된다.
 */

import { Users } from 'lucide-react';
import { SOURCE_LABEL, CHANNEL_LABEL, CHANNEL_COLOR, formatWon } from '../../utils/cdp-display';
import type { CdpActiveCustomers } from './cdp-analytics-types';

export default function CdpActiveCustomersTable({ data }: { data: CdpActiveCustomers | null }) {
  if (!data || data.topCustomers.length === 0) {
    return <div className="text-sm text-white/50 py-10 text-center">아직 자사몰 활성 고객 데이터가 없습니다.</div>;
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-semibold">자사몰 활성 Customer Top {data.topCustomers.length}</h2>
        <span className="ml-auto text-[10px] text-white/40">
          30일 활성 전체 {data.totalActiveCustomers.toLocaleString()}명 · 비회원 이벤트 {data.anonymousEventCount.toLocaleString()}건
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/5 border-b border-white/10">
            <tr className="text-left text-white/60">
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium text-center">primary source</th>
              <th className="px-3 py-2 font-medium text-center">채널</th>
              <th className="px-3 py-2 font-medium text-right">30일 이벤트</th>
              <th className="px-3 py-2 font-medium text-right">30일 매출</th>
              <th className="px-3 py-2 font-medium text-right">최근 활동</th>
            </tr>
          </thead>
          <tbody>
            {data.topCustomers.map((c) => (
              <tr key={c.customerId} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-3 py-2">
                  <div className="text-white/80">{c.customerName || '-'}</div>
                  <div className="text-[10px] text-white/40 font-mono">{c.customerPhone || ''} · {c.customerGrade || ''}</div>
                </td>
                <td className="px-3 py-2 text-center">
                  {c.primarySource ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">
                      {SOURCE_LABEL[c.primarySource] || c.primarySource}
                    </span>
                  ) : '-'}
                </td>
                <td className="px-3 py-2 text-center">
                  {c.preferredChannel ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${CHANNEL_COLOR[c.preferredChannel]}30`, color: CHANNEL_COLOR[c.preferredChannel] }}>
                      {CHANNEL_LABEL[c.preferredChannel] || c.preferredChannel}
                    </span>
                  ) : '-'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-cyan-300">{c.events30d.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-300">{c.revenue30d > 0 ? formatWon(c.revenue30d) : '-'}</td>
                <td className="px-3 py-2 text-right text-[10px] text-white/50">{c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
