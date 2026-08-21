/**
 * TargetRecipientsModal — 타겟 추출 발송툴 공용 "추출 대상 리스트 확인" 모달.
 *   2026-07-09 신설(Harold 명시): 타겟 추출을 하는 모든 AI 발송툴(AI Operator·이메일·인앱·DM·AI 캠페인·직접타겟·여정)에서
 *   "추출된 타겟 N명"을 누르면 → 어떤 조건으로 뽑혔는지 + 실제 추출 리스트를 15명씩 페이징으로 확인.
 *
 *   데이터 원천은 페이지 로더 1개(fetchPage)로 통일한다 (no_inline_duplication):
 *     - 메모리 보유 툴(대시보드 직접타겟·AI 캠페인) = arrayPager(recipients)로 감싸 클라 페이징.
 *     - 조회형 툴(AI Operator preview-recipients·이메일/인앱/DM targets/recipients) = 서버 페이징 fetchPage.
 *   대상자 수·리스트는 AI 추정이 아닌 실제 DB 조회 결과만 사용한다 (feedback_no_arbitrary_constants).
 *
 *   다크 모달 z-[2000](다른 모달 안에서 열려도 위) + createPortal(backdrop-filter 조상 탈출) + 모바일 반응형 + Source caption.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Target, X, Users, Sparkles, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

export interface TargetRecipient {
  phone?: string | null;
  name?: string | null;
  grade?: string | null;
  gender?: string | null;
  region?: string | null;
  age?: number | null;
  [k: string]: any;
}

export interface TargetPage {
  recipients: TargetRecipient[];
  total: number;
}

export type TargetPageLoader = (page: number, pageSize: number) => Promise<TargetPage>;

/** 메모리 보유 배열 → 페이지 로더 (클라 슬라이싱) */
export function arrayPager(recipients: TargetRecipient[]): TargetPageLoader {
  const list = Array.isArray(recipients) ? recipients : [];
  return async (page: number, pageSize: number) => ({
    recipients: list.slice((page - 1) * pageSize, page * pageSize),
    total: list.length,
  });
}

interface Props {
  show: boolean;
  onClose: () => void;
  /** 모달 제목 (기본 "추출 타겟 상세") */
  title?: string;
  /** 사용자가 입력한 목표/자연어 (있으면 표시) */
  objective?: string | null;
  /** AI가 해석한 추출 조건 / explanation (있으면 표시) */
  criteria?: string | null;
  /** 채널 라벨 (있으면 칩 표시) */
  channelLabel?: string | null;
  /** 전체 모수 (있으면 % 계산) */
  totalCount?: number | null;
  /** 페이지 로더 (메모리 배열은 arrayPager로 감싸 전달) */
  fetchPage?: TargetPageLoader | null;
  /** Data source 캡션 (기본값 있음) */
  sourceLabel?: string;
  pageSize?: number;
  /** ★ 2026-07-10 자동마케팅 [타겟확인]: 추출 조건에 쓰인 필드 동적 컬럼 — 미전달 시 기존 렌더 불변 */
  extraColumns?: { key: string; label: string }[] | null;
}

const PAGE_SIZE_DEFAULT = 15;

function maskPhone(raw?: string | null): string {
  if (!raw) return '-';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 7) return String(raw);
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-****-${tail}`;
}

function genderLabel(g?: string | null): string {
  if (!g) return '-';
  const v = String(g).trim().toUpperCase();
  if (v === 'M' || v === '남' || v === '남성' || v === 'MALE') return '남';
  if (v === 'F' || v === '여' || v === '여성' || v === 'FEMALE') return '여';
  return String(g);
}

const val = (v: any): string => {
  if (v === null || v === undefined || v === '') return '-';
  return String(v);
};

export default function TargetRecipientsModal({
  show, onClose, title = '추출 타겟 상세', objective, criteria, channelLabel,
  totalCount, fetchPage, sourceLabel = '실제 발송 대상 조회 (customer-filter)', pageSize = PAGE_SIZE_DEFAULT,
  extraColumns,
}: Props) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TargetRecipient[]>([]);
  const [total, setTotal] = useState(0);

  // fetchPage 최신값을 ref로 — 인라인 함수 identity 변화로 인한 재조회 루프 방지
  const loaderRef = useRef<TargetPageLoader | null>(null);
  loaderRef.current = fetchPage || null;

  // 열릴 때 1페이지로 리셋
  useEffect(() => {
    if (show) { setPage(1); setError(null); }
  }, [show]);

  // ESC 닫기 + body 스크롤 잠금
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [show, onClose]);

  // show / page 변경 시 조회
  useEffect(() => {
    if (!show) return;
    const loader = loaderRef.current;
    if (!loader) { setRows([]); setTotal(0); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    loader(page, pageSize)
      .then((res) => {
        if (!alive) return;
        setRows(Array.isArray(res.recipients) ? res.recipients : []);
        setTotal(Number.isFinite(res.total) ? res.total : (res.recipients?.length || 0));
      })
      .catch((e) => {
        if (!alive) return;
        setRows([]);
        setError(e instanceof Error ? e.message : '대상 리스트를 불러오지 못했습니다.');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [show, page, pageSize]);

  if (!show) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const pct = totalCount && totalCount > 0 ? ((total / totalCount) * 100).toFixed(1) : null;

  // 표시할 부가 컬럼 (데이터 있는 것만) — 연락처는 항상 표시
  const has = (key: keyof TargetRecipient) => rows.some((r) => r[key] !== null && r[key] !== undefined && r[key] !== '');
  // ★ 조건 필드 동적 컬럼 — 기본 컬럼(이름·연락처) 뒤에 추가 렌더. 자동 감지 컬럼과 겹치면 조건 컬럼이 대신한다(중복 방지).
  const extras = (extraColumns || []).filter((c) => c && c.key && c.key !== 'phone' && c.key !== 'name');
  const extraKeys = new Set(extras.map((c) => c.key));
  const extraVal = (r: TargetRecipient, key: string): string => {
    if (key === 'gender') return genderLabel(r[key]);
    const v = r[key];
    if (typeof v === 'number') return v.toLocaleString();
    return val(v);
  };
  const showGrade = has('grade') && !extraKeys.has('grade');
  const showGender = has('gender') && !extraKeys.has('gender');
  const showRegion = has('region') && !extraKeys.has('region');
  const showAge = has('age') && !extraKeys.has('age');

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden max-md:max-h-[92vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-slate-950 via-rose-950/30 to-slate-950 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/20 shrink-0">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-base truncate">{title}</h3>
              <div className="text-xs text-white/50 mt-0.5 flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {total.toLocaleString()}명</span>
                {pct && <span>· 전체 {totalCount!.toLocaleString()}명 중 {pct}%</span>}
                {channelLabel && <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/70">{channelLabel}</span>}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors shrink-0" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 조건 영역 */}
        {(objective || criteria) && (
          <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02] space-y-2 shrink-0">
            {objective && (
              <div>
                <div className="text-[10px] font-semibold tracking-wider uppercase text-fuchsia-300/80 mb-0.5">입력한 목표</div>
                <p className="text-sm text-white/85 leading-relaxed">{objective}</p>
              </div>
            )}
            {criteria && (
              <div>
                <div className="text-[10px] font-semibold tracking-wider uppercase text-violet-300/80 mb-0.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> 추출 조건
                </div>
                <p className="text-sm text-white/75 leading-relaxed">{criteria}</p>
              </div>
            )}
          </div>
        )}

        {/* 리스트 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[220px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/50 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-violet-300" />
              <span className="text-sm">추출 대상을 불러오는 중...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-rose-400" />
              <span className="text-sm text-rose-300">{error}</span>
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <Users className="w-6 h-6 text-white/30" />
              <span className="text-sm text-white/50">조건에 맞는 대상이 0명입니다.</span>
              <span className="text-xs text-white/30">조건을 넓히거나 고객 데이터를 확인해주세요.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-[11px] text-white/45 border-b border-white/10">
                    <th className="py-2 pr-2 font-medium w-10">#</th>
                    <th className="py-2 px-2 font-medium">고객명</th>
                    {showGrade && <th className="py-2 px-2 font-medium whitespace-nowrap">등급</th>}
                    {showGender && <th className="py-2 px-2 font-medium whitespace-nowrap">성별</th>}
                    {showAge && <th className="py-2 px-2 font-medium whitespace-nowrap">나이</th>}
                    {showRegion && <th className="py-2 px-2 font-medium whitespace-nowrap">지역</th>}
                    <th className="py-2 px-2 font-medium whitespace-nowrap">연락처</th>
                    {extras.map((c) => (
                      <th key={c.key} className="py-2 px-2 font-medium whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.phone || ''}-${startIdx + i}`} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="py-2 pr-2 text-white/40 tabular-nums">{startIdx + i + 1}</td>
                      <td className="py-2 px-2 text-white/90">{val(r.name)}</td>
                      {showGrade && <td className="py-2 px-2 text-white/70 whitespace-nowrap">{val(r.grade)}</td>}
                      {showGender && <td className="py-2 px-2 text-white/70 whitespace-nowrap">{genderLabel(r.gender)}</td>}
                      {showAge && <td className="py-2 px-2 text-white/70 tabular-nums whitespace-nowrap">{val(r.age)}</td>}
                      {showRegion && <td className="py-2 px-2 text-white/70 whitespace-nowrap">{val(r.region)}</td>}
                      <td className="py-2 px-2 text-white/70 tabular-nums whitespace-nowrap">{maskPhone(r.phone)}</td>
                      {extras.map((c) => (
                        <td key={c.key} className="py-2 px-2 text-white/70 tabular-nums whitespace-nowrap">{extraVal(r, c.key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 푸터 — 페이징 + Source caption */}
        <div className="px-5 py-3 border-t border-white/10 shrink-0">
          {!loading && !error && total > 0 && (
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs text-white/50 tabular-nums">
                {startIdx + 1}–{Math.min(startIdx + pageSize, total)} / {total.toLocaleString()}명
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="이전 페이지"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-white/70 tabular-nums px-1">{page} / {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="다음 페이지"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <div className="text-[10px] text-white/30 italic">Data source: {sourceLabel} · 연락처 중간자리 마스킹</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
