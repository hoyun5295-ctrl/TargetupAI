/**
 * AgencyMailIntakePanel — 대행발송 이메일 접수 관제 (★2026-08-26 §18 · 슈퍼관리자 탭)
 *
 * 반려·격리된 메일은 접수 원장에 행이 없어 **여기가 유일한 노출면**이다(설계서 §18-2).
 * 데이터 = 기존 GET /api/admin/agency-send 응답의 mailIntake 키(새 라우트 없음).
 * 사람을 부르는 축은 경보(시스템 알림)가 지고, 이 화면은 경보를 받고 확인하러 오는 자리다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2, RefreshCw } from 'lucide-react';
import TablePagination from '../common/TablePagination';

/** 반려·오류 목록 한 페이지 건수 — 슈퍼관리자 다른 목록과 같은 수로 맞춘다. */
const MAIL_PER_PAGE = 10;

interface MailState { mailbox: string; last_ok_at: string | null; login_fail_count: number; paused_at: string | null; paused_reason: string | null }
interface RejectedRow { uidl: string; from_email: string | null; reason: string | null; reply_status: string | null; claimed_at: string; company_name: string | null }
interface MailIntake {
  state: MailState[];
  counts: Array<{ status: string; c: number }>;
  replyFailed: number;
  unregisteredToday: number;
  recentRejected: RejectedRow[];
}

const REASON_LABEL: Record<string, string> = {
  unregistered: '미등록 발신자',
  ambiguous_sender: '허용 주소 중복(설정 확인)',
  owner_inactive: '귀속 사용자 비활성',
  auto_submitted: '자동 발신 메일(무시)',
  duplicate_message: '같은 메일 재수신',
  duplicate_request: '같은 요청서 중복',
  daily_sender_limit: '주소 일일 상한 초과',
  daily_company_limit: '회사 일일 상한 초과',
  not_allowed: '대행발송 미개통 계정',
  too_large: '메일 용량 초과',
  attachments_invalid: '첨부 구성 오류',
  attachments_too_large: '첨부 용량 초과',
  too_many_files: '첨부 개수 초과',
  has_image: '이미지 첨부(옛 반려 · 지금은 규격이면 접수)',
  mms_image_invalid: '이미지 규격 위반(JPG·300KB·3장)',
  image_not_attached: '이미지 파일명만 있고 첨부 없음',
  zip_not_allowed: '압축 파일',
  form_not_identified: '요청서 파일 식별 실패',
  form_invalid: '요청서·명단 검증 실패',
  headerless_with_vars: '무헤더 명단 + 문안 항목',
  callback_column_mode: '회신번호 열 방식(화면 안내)',
  phone_column_ambiguous: '수신자 열 판별 실패',
  callback_invalid: '회신번호 오류',
  core_rejected: '접수 검증 반려',
};

const STATUS_KO: Record<string, string> = {
  claimed: '처리 중', accepted: '접수됨', rejected: '반려', failed: '오류(재시도)',
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '기록 없음');

export default function AgencyMailIntakePanel() {
  const [data, setData] = useState<MailIntake | null>(null);
  // ★2026-09-02 페이징 — 반려 목록을 전량 그려 화면이 길어지던 것을 10건씩 끊는다.
  //   새로고침으로 건수가 줄어 현재 페이지가 범위를 넘으면 표시값만 마지막 페이지로 당긴다.
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/agency-send', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || '현황을 불러오지 못했습니다.');
      setData(body.mailIntake || null);
    } catch (e: any) {
      setError(e?.message || '현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const countOf = (status: string) => data?.counts.find((c) => c.status === status)?.c || 0;

  const rejected = data?.recentRejected || [];
  const safePage = Math.min(page, Math.max(1, Math.ceil(rejected.length / MAIL_PER_PAGE)));
  const pagedRejected = rejected.slice((safePage - 1) * MAIL_PER_PAGE, safePage * MAIL_PER_PAGE);

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Inbox className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">대행발송 메일 접수</h2>
            <p className="text-xs text-gray-500">반려·격리 메일은 접수 목록에 없어서 이 화면이 유일한 확인 자리입니다.</p>
          </div>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100" aria-label="새로고침">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !data ? (
        <div className="py-14 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : error ? (
        <div className="px-6 py-8 text-sm text-rose-600">{error}</div>
      ) : !data ? (
        <div className="px-6 py-8 text-sm text-gray-500">
          이메일 접수가 아직 준비되지 않았습니다(DB 마이그레이션 전이거나 워커 미가동). 배포와 DDL 실행 뒤 다시 확인해 주세요.
        </div>
      ) : (
        <div className="p-6 space-y-5">
          {/* 폴링 상태 — "메일 0통"과 "폴링 실패"를 가르는 자리 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 p-3.5">
              <div className="text-[11.5px] font-medium text-gray-500">마지막 성공 폴링</div>
              <div className="mt-1 text-[15px] font-bold tabular-nums text-gray-900">{fmt(data.state[0]?.last_ok_at || null)}</div>
              {data.state[0]?.paused_at && (
                <div className="mt-1 text-[11.5px] font-semibold text-rose-600">정지됨: {data.state[0]?.paused_reason || '수동 재개 필요'}</div>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 p-3.5">
              <div className="text-[11.5px] font-medium text-gray-500">접수됨 / 반려</div>
              <div className="mt-1 text-[15px] font-bold tabular-nums text-gray-900">
                {countOf('accepted').toLocaleString()} / {countOf('rejected').toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3.5">
              <div className="text-[11.5px] font-medium text-gray-500">회신 실패·미확정</div>
              <div className={`mt-1 text-[15px] font-bold tabular-nums ${data.replyFailed > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{data.replyFailed.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3.5">
              <div className="text-[11.5px] font-medium text-gray-500">미등록 발신(24시간)</div>
              <div className={`mt-1 text-[15px] font-bold tabular-nums ${data.unregisteredToday > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{data.unregisteredToday.toLocaleString()}</div>
            </div>
          </div>

          {/* 반려·오류 최근 20 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800">반려·오류 최근 20건</h3>
            {data.recentRejected.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">반려된 메일이 없습니다.</p>
            ) : (
              <>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4 font-medium">받은 시각</th>
                      <th className="py-2 pr-4 font-medium">보낸 주소</th>
                      <th className="py-2 pr-4 font-medium">회사</th>
                      <th className="py-2 pr-4 font-medium">사유</th>
                      <th className="py-2 font-medium">회신</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRejected.map((r) => (
                      <tr key={r.uidl} className="border-b border-gray-100">
                        <td className="py-2 pr-4 tabular-nums text-gray-600 whitespace-nowrap">{fmt(r.claimed_at)}</td>
                        <td className="py-2 pr-4 text-gray-800 max-w-[220px] truncate">{r.from_email || '(주소 없음)'}</td>
                        <td className="py-2 pr-4 text-gray-600 max-w-[140px] truncate">{r.company_name || ''}</td>
                        <td className="py-2 pr-4 text-gray-800">{REASON_LABEL[r.reason || ''] || r.reason || STATUS_KO.rejected}</td>
                        <td className="py-2 text-gray-600">{r.reply_status === 'sent' ? '보냄' : r.reply_status === 'skipped' ? '안 보냄' : r.reply_status || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                total={rejected.length}
                page={safePage}
                perPage={MAIL_PER_PAGE}
                onChange={setPage}
                unit="건"
                accent="indigo"
              />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
