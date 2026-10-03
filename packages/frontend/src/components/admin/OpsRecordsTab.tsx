/**
 * OpsRecordsTab — 운영 기록 대장 (★2026-10-03 전송자격인증 3.1 ④ · 3.3 · 4.3)
 *
 * 로그 점검 · 방화벽 정책 변경 · 접근권한 점검을 시스템 기록으로 남긴다. 한줄로와 비토 게이트웨이를 한 대장에서 다룬다.
 * 판정 · 저장은 서버 CT(`backend utils/ops-records.ts`)가 한다. 이 화면은 입력을 받아 보내고 목록을 그린다.
 *
 * ⛔ 화면 규율
 *  1. 작성 시각은 서버가 정한다 — 화면에 작성일 칸이 없다.
 *  2. 고치기 · 지우기 버튼이 없다. 정정은 「정정 기록 쓰기」로 새 기록을 남긴다.
 *  3. 작성자는 자기 기록을 확인할 수 없다(버튼이 안 보이고 서버도 거절한다).
 *  4. 네이티브 dialog 를 쓰지 않는다. 톤 = 부모 화면(슈퍼관리자 라이트).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AUDIT_ACTION_LABEL } from '../../constants/audit-action-labels';

type Kind = 'log_review' | 'firewall_change' | 'access_review';
type System = 'hanjul' | 'gateway' | 'common';

const KIND_LABEL: Record<Kind, string> = {
  log_review: '로그 점검',
  firewall_change: '방화벽 정책 변경',
  access_review: '접근권한 점검',
};
const KIND_HINT: Record<Kind, string> = {
  log_review: '월 1회 이상 이용자 · 시스템 로그를 점검하고 이상 여부와 후속 조치를 남깁니다.',
  firewall_change: '방화벽 정책을 바꾼 일시 · 내용 · 사유와 근거를 남깁니다.',
  access_review: '관리자 · 직원 계정의 권한이 업무에 맞는지 점검한 결과를 남깁니다.',
};
const SYSTEM_LABEL: Record<System, string> = {
  hanjul: '한줄로',
  gateway: '비토 게이트웨이',
  common: '공통',
};

interface Meta {
  canRead: boolean;
  canWrite: boolean;
  me: { id: string; loginId: string; name: string } | null;
  currentMonth: string;
  /** 서버 시각 — 「지금」 기본값과 입력 상한의 기준 */
  serverNow?: string;
}

interface Summary {
  month: string;
  counts: Record<string, number>;
  failConcentration: Array<{ loginId: string; fails: number; ips: number }>;
  generatedAt: string;
}

interface OpsRecord {
  id: string;
  createdAt: string;
  kind: Kind;
  system: System;
  period: string | null;
  occurredAt: string | null;
  title: string;
  content: string;
  reason: string | null;
  anomaly: boolean | null;
  followUp: string | null;
  evidence: string | null;
  supersedes: string | null;
  summary: Summary | null;
  recorder: { loginId: string; name: string } | null;
  confirmedAt: string | null;
  confirmer: { loginId: string; name: string } | null;
  confirmComment: string | null;
}

interface FormState {
  kind: Kind;
  system: System;
  period: string;
  occurredAt: string;
  title: string;
  content: string;
  reason: string;
  anomaly: boolean;
  followUp: string;
  evidence: string;
  supersedes: string | null;
}

const authHeaders = (json = false): Record<string, string> => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
};
const fmtMonth = (m: string | null) => (m && /^\d{4}-\d{2}$/.test(m) ? `${m.slice(0, 4)}년 ${Number(m.slice(5))}월` : '');

/**
 * 서버 시각과 이 브라우저 시계의 차이(ms). ★Codex 2R — 「지금」을 브라우저 시계로 만들면, 시계가 서버보다 빠른 PC 에서
 * 기본값 그대로 저장해도 서버가 「미래 변경 일시」로 거절한다. 서버가 알려 준 시각에 맞춰 쓴다.
 */
let serverClockOffsetMs = 0;
/** ★Codex 3R — 서버 시각을 실제로 받았는가. 못 받았으면 「지금」을 만들지 않는다(차이 0 을 맞춘 것으로 치지 않는다) */
let serverClockSynced = false;

/**
 * datetime-local 의 기본값 · 상한 — 한국 시각 「지금」(서버 시계 기준 · 분 단위로 버린다).
 * 서버 시각을 못 받았으면 빈 값 — 기본값을 비워 직접 고르게 하고 상한도 걸지 않는다(판정은 서버가 한다).
 */
const nowLocalInput = () => {
  if (!serverClockSynced) return '';
  const d = new Date(Date.now() + serverClockOffsetMs + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
};

const emptyForm = (kind: Kind, month: string): FormState => ({
  kind, system: 'hanjul', period: month, occurredAt: nowLocalInput(),
  title: '', content: '', reason: '', anomaly: false, followUp: '', evidence: '', supersedes: null,
});

const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const labelCls = 'mb-1.5 block text-xs font-semibold text-gray-600';

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SummaryTable({ summary }: { summary: Summary }) {
  const rows = Object.entries(summary.counts);
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {rows.map(([action, n]) => (
          <div key={action} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-gray-600">{AUDIT_ACTION_LABEL[action] || action}</span>
            <span className={`tabular-nums font-semibold ${n > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{n.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-600">
        <span className="font-semibold text-gray-700">로그인 실패가 몰린 계정(5회 이상)</span>
        {summary.failConcentration.length === 0 ? (
          <span className="ml-2 text-gray-500">없음</span>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {summary.failConcentration.map((f) => (
              <li key={f.loginId} className="tabular-nums">{f.loginId || '(아이디 없음)'} · 실패 {f.fails}회 · 출발지 {f.ips}곳</li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-[10px] italic text-gray-400">Data source: 감사 기록 · {fmtMonth(summary.month)} · 집계 {fmtDateTime(summary.generatedAt)}</p>
    </div>
  );
}

export default function OpsRecordsTab() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [records, setRecords] = useState<OpsRecord[]>([]);
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [systemFilter, setSystemFilter] = useState<'all' | System>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<OpsRecord | null>(null);
  const [confirmComment, setConfirmComment] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/ops-records/meta', { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '권한을 확인하지 못했습니다.');
      const serverMs = d?.serverNow ? new Date(d.serverNow).getTime() : NaN;
      if (Number.isFinite(serverMs)) {
        serverClockOffsetMs = serverMs - Date.now();
        serverClockSynced = true;
      } else {
        serverClockSynced = false;
      }
      setMeta(d);
    } catch (e: any) {
      setError(e?.message || '권한을 확인하지 못했습니다.');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (kindFilter !== 'all') params.set('kind', kindFilter);
      if (systemFilter !== 'all') params.set('system', systemFilter);
      const r = await fetch(`/api/admin/ops-records?${params}`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '운영 기록을 불러오지 못했습니다.');
      setRecords(d.records || []);
    } catch (e: any) {
      setError(e?.message || '운영 기록을 불러오지 못했습니다.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [kindFilter, systemFilter]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { if (meta?.canRead) load(); }, [meta, load]);

  // 한줄로 로그 점검이면 그 달의 점검 자료를 미리 보여 준다(저장할 때는 서버가 다시 센다)
  useEffect(() => {
    setPreview(null);
    if (!form || form.kind !== 'log_review' || form.system !== 'hanjul' || !/^\d{4}-\d{2}$/.test(form.period)) return;
    let alive = true;
    setPreviewLoading(true);
    fetch(`/api/admin/ops-records/log-review-summary?month=${form.period}`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json();
        if (alive && r.ok) setPreview(d.summary);
      })
      .catch(() => { /* 미리보기 실패는 저장을 막지 않는다 */ })
      .finally(() => { if (alive) setPreviewLoading(false); });
    return () => { alive = false; };
  }, [form?.kind, form?.system, form?.period]);

  const openForm = (kind: Kind, base?: OpsRecord) => {
    const f = emptyForm(kind, meta?.currentMonth || '');
    if (base) {
      f.system = base.system;
      f.period = base.period || f.period;
      f.title = `${base.title} (정정)`;
      f.supersedes = base.id;
    }
    setFormError(null);
    setForm(f);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const body: Record<string, any> = {
        kind: form.kind, system: form.system, title: form.title, content: form.content, evidence: form.evidence,
        supersedes: form.supersedes,
      };
      if (form.kind === 'firewall_change') {
        // 입력은 한국 시각 — 서버에는 시간대를 붙여 보낸다
        body.occurredAt = form.occurredAt ? `${form.occurredAt}:00+09:00` : '';
        body.reason = form.reason;
      } else {
        body.period = form.period;
        body.anomaly = form.anomaly;
        body.followUp = form.followUp;
      }
      const r = await fetch('/api/admin/ops-records', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '기록을 남기지 못했습니다.');
      setForm(null);
      setNotice(`${KIND_LABEL[form.kind]} 기록을 남겼습니다. 다른 관리자가 확인하면 완료됩니다.`);
      await load();
    } catch (e: any) {
      setFormError(e?.message || '기록을 남기지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const submitConfirm = async () => {
    if (!confirmTarget) return;
    setConfirmError(null);
    try {
      const r = await fetch(`/api/admin/ops-records/${confirmTarget.id}/confirm`, {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify({ comment: confirmComment }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '확인을 남기지 못했습니다.');
      setConfirmTarget(null);
      setConfirmComment('');
      setNotice('확인을 남겼습니다.');
      await load();
    } catch (e: any) {
      setConfirmError(e?.message || '확인을 남기지 못했습니다.');
    }
  };

  const counts = useMemo(() => ({
    total: records.length,
    pending: records.filter((r) => !r.confirmedAt).length,
    anomaly: records.filter((r) => r.anomaly).length,
  }), [records]);

  if (meta && !meta.canRead) {
    return (
      <div className="rounded-2xl border border-gray-200/70 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
        운영 기록 대장을 볼 수 있는 등급이 아닙니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">운영 기록 대장</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-500">
              로그 점검 · 방화벽 정책 변경 · 접근권한 점검을 남깁니다. 작성 시각은 서버가 정하고, 남긴 기록은 고칠 수 없습니다.
              정정은 새 기록으로 남기고, 다른 관리자가 확인해야 완료됩니다.
            </p>
          </div>
          {meta?.canWrite && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => openForm(k)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-blue-400 hover:text-blue-700"
                >
                  + {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: '기록', value: counts.total },
            { label: '확인 대기', value: counts.pending },
            { label: '이상 있음', value: counts.anomaly },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-gray-50 px-4 py-3">
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented
            value={kindFilter}
            onChange={setKindFilter}
            options={[{ value: 'all', label: '전체' }, ...(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
          />
          <Segmented
            value={systemFilter}
            onChange={setSystemFilter}
            options={[{ value: 'all', label: '모든 시스템' }, ...(Object.keys(SYSTEM_LABEL) as System[]).map((s) => ({ value: s, label: SYSTEM_LABEL[s] }))]}
          />
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">닫기</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
              <tr>
                <th className="px-4 py-3">작성 시각</th>
                <th className="px-4 py-3">종류</th>
                <th className="px-4 py-3">시스템</th>
                <th className="px-4 py-3">대상</th>
                <th className="px-4 py-3">요지</th>
                <th className="px-4 py-3">작성자</th>
                <th className="px-4 py-3">확인</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">불러오는 중입니다.</td></tr>
              )}
              {!loading && records.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">아직 남긴 기록이 없습니다.</td></tr>
              )}
              {!loading && records.map((r) => {
                const mine = !!meta?.me && r.recorder?.loginId === meta.me.loginId;
                const open = expanded === r.id;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r}
                    open={open}
                    onToggle={() => setExpanded(open ? null : r.id)}
                    canConfirm={!!meta?.canWrite && !r.confirmedAt && !mine}
                    onConfirm={() => { setConfirmTarget(r); setConfirmComment(''); setConfirmError(null); }}
                    canCorrect={!!meta?.canWrite}
                    onCorrect={() => openForm(r.kind, r)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h3 className="text-base font-bold text-gray-900">{KIND_LABEL[form.kind]} 기록{form.supersedes ? ' (정정)' : ''}</h3>
              <p className="mt-1 text-xs text-gray-500">{KIND_HINT[form.kind]} 작성 시각은 저장하는 순간의 서버 시각으로 남습니다.</p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <span className={labelCls}>대상 시스템</span>
                <Segmented
                  value={form.system}
                  onChange={(v) => setForm({ ...form, system: v })}
                  options={(Object.keys(SYSTEM_LABEL) as System[]).map((s) => ({ value: s, label: SYSTEM_LABEL[s] }))}
                />
              </div>
              {form.kind === 'firewall_change' ? (
                <div>
                  <label className={labelCls}>변경 일시(실제로 바꾼 때 · 한국 시각)</label>
                  <input type="datetime-local" className={inputCls} value={form.occurredAt} max={nowLocalInput() || undefined}
                    onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
                </div>
              ) : (
                <div>
                  <label className={labelCls}>점검 대상 월</label>
                  <input type="month" className={inputCls} value={form.period} max={meta?.currentMonth}
                    onChange={(e) => setForm({ ...form, period: e.target.value })} />
                </div>
              )}
              <div>
                <label className={labelCls}>요지</label>
                <input className={inputCls} value={form.title} maxLength={120}
                  placeholder={form.kind === 'firewall_change' ? '접속 포트에 고객사 출발지 1곳 허용' : '2026년 9월 로그 점검'}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              {form.kind === 'log_review' && form.system === 'hanjul' && (
                <div>
                  <span className={labelCls}>점검 자료(서버 집계)</span>
                  {previewLoading && <p className="text-xs text-gray-400">집계하는 중입니다.</p>}
                  {!previewLoading && preview && <SummaryTable summary={preview} />}
                  {!previewLoading && !preview && <p className="text-xs text-gray-400">점검 대상 월을 고르면 그 달의 집계가 나옵니다.</p>}
                </div>
              )}
              <div>
                <label className={labelCls}>{form.kind === 'firewall_change' ? '변경 내용' : '점검 내용'}</label>
                <textarea className={`${inputCls} min-h-[96px]`} value={form.content} maxLength={4000}
                  onChange={(e) => setForm({ ...form, content: e.target.value })} />
              </div>
              {form.kind === 'firewall_change' ? (
                <div>
                  <label className={labelCls}>변경 사유</label>
                  <textarea className={`${inputCls} min-h-[64px]`} value={form.reason} maxLength={1000}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </div>
              ) : (
                <>
                  <div>
                    <span className={labelCls}>이상 여부</span>
                    <Segmented
                      value={form.anomaly ? 'yes' : 'no'}
                      onChange={(v) => setForm({ ...form, anomaly: v === 'yes' })}
                      options={[{ value: 'no', label: '이상 없음' }, { value: 'yes', label: '이상 있음' }]}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>후속 조치{form.anomaly ? '' : '(이상이 없으면 비워 둡니다)'}</label>
                    <textarea className={`${inputCls} min-h-[64px]`} value={form.followUp} maxLength={2000}
                      onChange={(e) => setForm({ ...form, followUp: e.target.value })} />
                  </div>
                </>
              )}
              <div>
                <label className={labelCls}>근거{form.kind === 'firewall_change' || form.system === 'gateway' ? '' : '(선택)'}</label>
                <textarea className={`${inputCls} min-h-[64px]`} value={form.evidence} maxLength={2000}
                  placeholder={form.kind === 'firewall_change' ? '서버 명령 기록 2026-09-08 21:26 · 서버 원장' : '조회한 기록과 수치 요약'}
                  onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
              </div>
              {formError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">취소</button>
              <button type="button" onClick={save} disabled={saving}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
                {saving ? '남기는 중' : '기록 남기기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="px-6 pb-2 pt-5">
              <h3 className="text-base font-bold text-gray-900">기록 확인</h3>
              <p className="mt-1 text-sm text-gray-600">{KIND_LABEL[confirmTarget.kind]} · {confirmTarget.title}</p>
              <p className="mt-1 text-xs text-gray-500">작성 {confirmTarget.recorder?.name || ''} · {fmtDateTime(confirmTarget.createdAt)}</p>
            </div>
            <div className="px-6 py-3">
              <label className={labelCls}>확인 의견(선택)</label>
              <textarea className={`${inputCls} min-h-[72px]`} value={confirmComment} maxLength={500}
                onChange={(e) => setConfirmComment(e.target.value)} />
              {confirmError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{confirmError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={() => setConfirmTarget(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">취소</button>
              <button type="button" onClick={submitConfirm} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">확인 남기기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ r, open, onToggle, canConfirm, onConfirm, canCorrect, onCorrect }: {
  r: OpsRecord; open: boolean; onToggle: () => void;
  canConfirm: boolean; onConfirm: () => void; canCorrect: boolean; onCorrect: () => void;
}) {
  const target = r.kind === 'firewall_change' ? `변경 ${fmtDateTime(r.occurredAt)}` : fmtMonth(r.period);
  return (
    <>
      <tr className="cursor-pointer align-top transition hover:bg-gray-50" onClick={onToggle}>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">{fmtDateTime(r.createdAt)}</td>
        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">{KIND_LABEL[r.kind] || r.kind}</td>
        <td className="whitespace-nowrap px-4 py-3 text-gray-600">{SYSTEM_LABEL[r.system] || r.system}</td>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">{target}</td>
        <td className="px-4 py-3 text-gray-800">
          {r.anomaly && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">이상 있음</span>}
          {r.supersedes && <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">정정</span>}
          {r.title}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-gray-600">{r.recorder?.name || '-'}</td>
        <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {r.confirmedAt ? (
            <span className="text-xs text-emerald-700">{r.confirmer?.name} · {fmtDateTime(r.confirmedAt)}</span>
          ) : canConfirm ? (
            <button type="button" onClick={onConfirm} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700">확인하기</button>
          ) : (
            <span className="text-xs text-gray-400">확인 대기</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60">
          <td colSpan={7} className="px-6 py-4">
            <dl className="grid gap-3 text-sm md:grid-cols-[120px_1fr]">
              <dt className="text-xs font-semibold text-gray-500">{r.kind === 'firewall_change' ? '변경 내용' : '점검 내용'}</dt>
              <dd className="whitespace-pre-wrap text-gray-800">{r.content}</dd>
              {r.reason && (<><dt className="text-xs font-semibold text-gray-500">변경 사유</dt><dd className="whitespace-pre-wrap text-gray-800">{r.reason}</dd></>)}
              {r.kind !== 'firewall_change' && (<><dt className="text-xs font-semibold text-gray-500">이상 여부</dt><dd className="text-gray-800">{r.anomaly ? '이상 있음' : '이상 없음'}</dd></>)}
              {r.followUp && (<><dt className="text-xs font-semibold text-gray-500">후속 조치</dt><dd className="whitespace-pre-wrap text-gray-800">{r.followUp}</dd></>)}
              {r.evidence && (<><dt className="text-xs font-semibold text-gray-500">근거</dt><dd className="whitespace-pre-wrap text-gray-800">{r.evidence}</dd></>)}
              {r.summary && (<><dt className="text-xs font-semibold text-gray-500">점검 자료</dt><dd><SummaryTable summary={r.summary} /></dd></>)}
              {r.confirmComment && (<><dt className="text-xs font-semibold text-gray-500">확인 의견</dt><dd className="whitespace-pre-wrap text-gray-800">{r.confirmComment}</dd></>)}
              <dt className="text-xs font-semibold text-gray-500">기록 번호</dt>
              <dd className="font-mono text-xs text-gray-500">{r.id}{r.supersedes ? ` · 정정 대상 ${r.supersedes}` : ''}</dd>
            </dl>
            {canCorrect && (
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={onCorrect} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-400 hover:text-blue-700">정정 기록 쓰기</button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
