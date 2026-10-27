/**
 * MallIntegrationMonitorTab — 자사몰 연동 감시 표 1단 (★ 2026-10-27 자사몰 대비 설계 K10 · 읽기만 · 행 버튼 0)
 *
 * 한 행 = 몰 하나. 문제(서버 분류 K7) · 마지막 수신 · 평소 간격 대비 · 토큰 만료 · 가져오기 · 모르는 주문 상태 글자(최근 7일).
 * 사람이 볼 것(조치 필요 · 분류 못 한 실패)이 먼저 온다(순서 = 서버). 행을 누르면 상세 창.
 * 판정은 서버가 한다 — 이 화면은 받은 값을 그린다(원인 → 낱말 표만 여기 · I11).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ListPager, { pageSlice } from '../shared/ListPager';
import {
  ADMIN_TABLE, ADMIN_THEAD, ADMIN_TH, ADMIN_TH_FIRST, ADMIN_TBODY, ADMIN_TD, ADMIN_TD_FIRST, ADMIN_NUM, ADMIN_TR_OPEN,
  AdminDetailModal, AdminDetailItem, AdminLongText, AdminPill, AdminTableEmpty, adminRowOpen,
} from './ui/admin-ui';

type Cause =
  | 'rate_limited' | 'network' | 'upstream_5xx' | 'cap_reached'
  | 'key_rejected' | 'permission' | 'ip_not_allowed' | 'address' | 'header_overflow' | 'token_rejected' | 'app_removed' | 'grace_over';

interface MonitorRow {
  id: string;
  companyId: string;
  companyName: string;
  provider: string;
  mallId: string;
  storeCode: string | null;
  status: string;
  problem: { kind: 'transient' | 'action'; cause: Cause } | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorAt: string | null;
  lastReceivedAt: string | null;
  received30d: number;
  gapRatio: number | null;
  lastSyncedAt: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  importProgress: { stage: string; customers: number; orders: number; doneAt: string | null } | null;
  memberReread: { page: number; doneAt: string | null; lastDoneAt: string | null } | null;
  unknownStatuses: Array<{ status: string; count: number }>;
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const fmt = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  : '-');

const PROVIDER_LABEL: Record<string, string> = {
  woocommerce: '우커머스', cafe24: '카페24', imweb: '아임웹', godo: '고도몰', makeshop: '메이크샵', naver_smart_store: '네이버', custom: '자체 호스팅',
};
/** 서버 원인(닫힌 목록) → 낱말 — 표에 없는 원인은 서버 계약 위반이라 원문을 그대로 보인다 */
const CAUSE_LABEL: Record<Cause, string> = {
  rate_limited: '호출 한도', network: '연결 끊김', upstream_5xx: '몰 서버 오류', cap_reached: '한 회차 상한',
  key_rejected: '키 거절', permission: '권한 없음', ip_not_allowed: '출발 IP 미등록', address: '몰 주소 문제',
  header_overflow: '응답 머리 초과', token_rejected: '토큰 거절', app_removed: '앱 삭제됨', grace_over: '유예 끝',
};
const STATUS_LABEL: Record<string, string> = {
  active: '연결됨', pending: '대기', pending_oauth: '승인 대기', token_expired: '토큰 만료',
};
const STAGE_LABEL: Record<string, string> = { customers: '회원 가져오는 중', orders: '주문 가져오는 중', done: '끝' };

function ProblemPill({ r }: { r: MonitorRow }) {
  if (r.problem?.kind === 'action') return <AdminPill tone="rose">{CAUSE_LABEL[r.problem.cause] || r.problem.cause}</AdminPill>;
  if (r.problem?.kind === 'transient') return <AdminPill tone="amber">{CAUSE_LABEL[r.problem.cause] || r.problem.cause}</AdminPill>;
  if (r.errorCode) return <AdminPill tone="rose">분류 못 한 실패 {r.errorCode}</AdminPill>;
  return <AdminPill tone="green">문제 없음</AdminPill>;
}

const gapText = (g: number | null) => (g == null ? '-' : g < 1.5 ? '평소대로' : `평소의 ${g.toLocaleString()}배`);
const importText = (p: MonitorRow['importProgress']) => (!p ? '-' : p.stage === 'done'
  ? `끝 · 회원 ${p.customers.toLocaleString()} · 주문 ${p.orders.toLocaleString()}`
  : `${STAGE_LABEL[p.stage] || p.stage} · 회원 ${p.customers.toLocaleString()} · 주문 ${p.orders.toLocaleString()}`);
const unknownText = (u: MonitorRow['unknownStatuses']) => (u.length === 0 ? '' : u.map((x) => `${x.status || '빈 값'} ${x.count.toLocaleString()}건`).join(' · '));

export default function MallIntegrationMonitorTab() {
  const [rows, setRows] = useState<MonitorRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<MonitorRow | null>(null);
  // 새로고침을 빨리 두 번 눌렀을 때 늦게 온 옛 응답이 새 화면을 덮지 않게
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/mall-integrations/monitor', { headers: authHeaders() });
      const d = await r.json();
      if (mySeq !== seq.current) return;
      if (!r.ok || !d?.success) throw new Error(d?.error || '자사몰 연동 현황을 불러오지 못했습니다.');
      setRows(Array.isArray(d.rows) ? d.rows : []);
    } catch (e: any) {
      if (mySeq !== seq.current) return;
      setError(e?.message || '자사몰 연동 현황을 불러오지 못했습니다.');
      setRows(null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = rows || [];
  const needs = list.filter((r) => r.problem?.kind === 'action' || (!r.problem && r.errorCode)).length;
  const waits = list.filter((r) => r.problem?.kind === 'transient').length;
  const unknownMalls = list.filter((r) => r.unknownStatuses.length > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">자사몰 연동 감시</h2>
          <p className="text-xs text-gray-500 mt-1">고객사 몰마다 연결 상태 · 마지막 수신 · 평소 간격 대비 · 가져오기 진행 · 몰 고유 주문 상태 글자를 봅니다. 조치가 필요한 몰이 먼저 옵니다</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-40">{loading ? '불러오는 중' : '새로고침'}</button>
      </div>

      {error && <div className="px-6 py-4 text-sm text-rose-600">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-5">
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">연결된 몰</div>
          <div className="text-2xl font-bold tracking-tight text-gray-900 mt-1 tabular-nums">{rows ? list.length.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">조치 필요</div>
          <div className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${needs > 0 ? 'text-rose-600' : 'text-gray-900'}`}>{rows ? needs.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">기다리면 풀림</div>
          <div className="text-2xl font-bold tracking-tight text-amber-600 mt-1 tabular-nums">{rows ? waits.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">모르는 주문 상태(7일)</div>
          <div className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${unknownMalls > 0 ? 'text-rose-600' : 'text-gray-900'}`}>{rows ? unknownMalls.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">곳</span></div>
        </div>
      </div>

      <div className="overflow-x-auto border-t">
        <table className={ADMIN_TABLE}>
          <thead className={ADMIN_THEAD}>
            <tr>
              <th className={ADMIN_TH_FIRST}>고객사</th>
              <th className={ADMIN_TH}>몰</th>
              <th className={ADMIN_TH}>상태</th>
              <th className={ADMIN_TH}>문제</th>
              <th className={ADMIN_TH}>마지막 수신</th>
              <th className={`${ADMIN_TH} ${ADMIN_NUM}`}>30일 수신</th>
              <th className={ADMIN_TH}>평소 대비</th>
              <th className={ADMIN_TH}>토큰 만료</th>
              <th className={ADMIN_TH}>가져오기</th>
              <th className={ADMIN_TH}>모르는 주문 상태</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {!rows && loading && <AdminTableEmpty colSpan={10}>불러오는 중입니다</AdminTableEmpty>}
            {rows && list.length === 0 && <AdminTableEmpty colSpan={10}>연결된 자사몰이 아직 없습니다</AdminTableEmpty>}
            {pageSlice(list, page).map((r) => (
              <tr key={r.id} className={ADMIN_TR_OPEN} {...adminRowOpen(() => setOpen(r))}>
                <td className={ADMIN_TD_FIRST}><AdminLongText text={r.companyName} max={160} rowOpens /></td>
                <td className={ADMIN_TD}>
                  <span className="text-gray-500">{PROVIDER_LABEL[r.provider] || r.provider}</span>{' '}
                  <AdminLongText text={r.mallId} max={180} rowOpens className="inline-block align-bottom" />
                </td>
                <td className={ADMIN_TD}>{STATUS_LABEL[r.status] || r.status}</td>
                <td className={ADMIN_TD}><ProblemPill r={r} /></td>
                <td className={ADMIN_TD}>{fmt(r.lastReceivedAt || r.lastSyncedAt)}</td>
                <td className={`${ADMIN_TD} ${ADMIN_NUM}`}>{r.received30d.toLocaleString()}</td>
                <td className={ADMIN_TD}>{gapText(r.gapRatio)}</td>
                <td className={ADMIN_TD}>{fmt(r.tokenExpiresAt)}</td>
                <td className={ADMIN_TD}><AdminLongText text={importText(r.importProgress)} max={200} rowOpens /></td>
                <td className={ADMIN_TD}>{r.unknownStatuses.length > 0 ? <AdminLongText text={unknownText(r.unknownStatuses)} max={200} rowOpens className="text-rose-700" /> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListPager page={page} total={list.length} onPage={setPage} />

      {open && (
        <AdminDetailModal title={`${open.companyName} · ${PROVIDER_LABEL[open.provider] || open.provider} ${open.mallId}`} onClose={() => setOpen(null)}>
          <dl>
            <AdminDetailItem label="상태">{STATUS_LABEL[open.status] || open.status}</AdminDetailItem>
            <AdminDetailItem label="문제"><ProblemPill r={open} /></AdminDetailItem>
            <AdminDetailItem label="마지막 실패">{open.errorCode ? `${open.errorCode} · ${open.errorMessage || ''} · ${fmt(open.errorAt)}` : '-'}</AdminDetailItem>
            <AdminDetailItem label="분류 코드">{open.storeCode || '회사 공용'}</AdminDetailItem>
            <AdminDetailItem label="연결">{fmt(open.connectedAt)}</AdminDetailItem>
            <AdminDetailItem label="마지막 수신">{fmt(open.lastReceivedAt)} · 30일 {open.received30d.toLocaleString()}건 · {gapText(open.gapRatio)}</AdminDetailItem>
            <AdminDetailItem label="마지막 수집">{fmt(open.lastSyncedAt)}</AdminDetailItem>
            <AdminDetailItem label="토큰 만료">{fmt(open.tokenExpiresAt)}</AdminDetailItem>
            <AdminDetailItem label="가져오기">{importText(open.importProgress)}</AdminDetailItem>
            <AdminDetailItem label="회원 재대조">{open.memberReread ? `${open.memberReread.doneAt ? '이번 바퀴 끝' : `${open.memberReread.page.toLocaleString()}쪽 읽는 중`} · 마지막 한 바퀴 ${fmt(open.memberReread.lastDoneAt)}` : '-'}</AdminDetailItem>
            <AdminDetailItem label="모르는 주문 상태">{open.unknownStatuses.length > 0 ? unknownText(open.unknownStatuses) : '-'}</AdminDetailItem>
          </dl>
        </AdminDetailModal>
      )}
    </div>
  );
}
