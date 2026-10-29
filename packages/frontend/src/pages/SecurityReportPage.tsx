/**
 * SecurityReportPage — 보안 점검 기록(C) (★2026-10-29 Harold · 설계 docs/2026-10-29-customer-security-notice-ack-design.md §2-3)
 *
 * 경로 = /security-report(로그인 필요 · 에이전트 전용 회사 허용 목록에 포함 · App.tsx AGENT_ALLOWED_PATHS).
 * 문구 = constants/security-report.ts 한 곳. 연 순간 「점검 기록 열람」 기록 · 「확인했습니다」 = 서버 204 뒤에만 확인 표시(실패 = 알림 · 그대로).
 * 다시 볼 입구 = B 카드 · 설정 화면 한 줄 · 카카오&RCS 한 줄(설계서 §4 결정 3).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import { useAuthStore, isAgentOnlyCompany } from '../stores/authStore';
import { SecuritySeal, postNoticeEvent, markNoticeAcked, currentLoginMark } from '../components/SecurityNoticeCard';
import {
  SECURITY_NOTICE_ID, SECURITY_ITEMS, SECURITY_CUSTOMER_ITEM, SECURITY_TIMELINE, SECURITY_CVES, SECURITY_CVE_REST,
} from '../constants/security-report';

export default function SecurityReportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const home = isAgentOnlyCompany(user) ? '/kakao-rcs' : '/dashboard';
  const [acked, setAcked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void postNoticeEvent(SECURITY_NOTICE_ID, 'report').catch(() => {}); }, []);

  const ack = async () => {
    if (saving || acked) return;
    setSaving(true);
    const loginMark = currentLoginMark();
    try {
      const status = await postNoticeEvent(SECURITY_NOTICE_ID, 'ack');
      // 성공 = 누른 순간 로그인의 공지 카드에도 알린다 · 기간이 끝난 공지(400) = 남길 확인이 없다 → 확인 표시만
      if (status === 204) markNoticeAcked(loginMark, SECURITY_NOTICE_ID);
      if (status === 204 || status === 400) setAcked(true);
      else toast.error('확인을 저장하지 못했습니다. 다시 눌러 주세요.');
    } catch {
      toast.error('확인을 저장하지 못했습니다. 다시 눌러 주세요.');
    } finally {
      setSaving(false);
    }
  };

  const items = [...SECURITY_ITEMS.map((i) => ({ title: i.title, chip: i.chip, applied: i.state === 'applied', detail: i.detail })),
    { title: SECURITY_CUSTOMER_ITEM.title, chip: SECURITY_CUSTOMER_ITEM.chip, applied: false, detail: SECURITY_CUSTOMER_ITEM.detail }];

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => goBackOr(navigate, home)}
            aria-label="뒤로"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="text-[17px] font-extrabold tracking-[-0.02em] text-slate-900">한줄로</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 py-6 sm:px-4 sm:py-10">
        <article className="overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-slate-200 px-5 py-7 sm:px-11 sm:py-10">
            <div className="flex items-center gap-4">
              <SecuritySeal size={60} />
              <div>
                <h1 className="text-[24px] font-bold tracking-[-0.03em] text-slate-900 sm:text-[26px]">보안 점검 기록</h1>
                <p className="mt-1.5 break-keep text-sm text-slate-600">2026년 10월 PHP, Node.js 취약점 공지에 대한 한줄로의 점검과 조치</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-[14px] bg-emerald-50 py-3 pl-3.5 pr-4 ring-1 ring-inset ring-emerald-200">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-emerald-600"><Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /></span>
              <div>
                <b className="block text-[15px] tracking-[-0.01em] text-emerald-900">조치 완료, 고객사 할 일 없음</b>
                <span className="text-[12.5px] text-emerald-700">지금처럼 쓰시면 됩니다</span>
              </div>
            </div>
          </div>

          <div className="grid gap-9 px-5 py-8 sm:px-11 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-11">
            <section aria-labelledby="sr-timeline">
              <h2 id="sr-timeline" className="mb-3.5 text-xs font-semibold text-slate-500">진행 기록</h2>
              <ol className="relative">
                <span className="absolute bottom-2 left-[7px] top-2 w-0.5 bg-slate-200" aria-hidden="true" />
                {SECURITY_TIMELINE.map((t, i) => (
                  <li key={i} className="relative pb-5 pl-8 last:pb-0">
                    <span className={`absolute left-0 top-[3px] flex h-4 w-4 items-center justify-center rounded-full ${t.final ? 'bg-emerald-600 shadow-[0_0_0_4px_rgba(5,150,105,0.14)]' : 'bg-white ring-2 ring-inset ring-emerald-600'}`} aria-hidden="true">
                      {t.final ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} /> : <i className="h-2 w-2 rounded-full bg-emerald-600" />}
                    </span>
                    <time className="font-mono text-xs text-slate-500">{t.at}</time>
                    <b className="mt-0.5 block text-[14.5px] font-semibold tracking-[-0.012em] text-slate-900">{t.title}</b>
                    <span className="mt-0.5 block break-keep text-[13px] leading-relaxed text-slate-600">{t.detail}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="sr-items" className="min-w-0">
              <h2 id="sr-items" className="mb-1 text-xs font-semibold text-slate-500">점검 항목</h2>
              <ul>
                {items.map((it) => (
                  <li key={it.title} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-slate-100 py-4 first:border-t-0">
                    <span className="text-[15px] font-semibold tracking-[-0.012em] text-slate-900">{it.title}</span>
                    <span className={`inline-flex h-6 items-center gap-1.5 self-start whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${it.applied ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
                      <i className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />{it.chip}
                    </span>
                    <span className="col-span-2 break-keep text-[13.5px] leading-relaxed text-slate-600">{it.detail}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 rounded-[14px] bg-slate-50 px-4 py-4 ring-1 ring-inset ring-slate-200 sm:px-5">
                <p className="pb-2 text-[12.5px] font-semibold text-slate-900">이번 Node.js 보안 업데이트가 고친 고위험 항목</p>
                {SECURITY_CVES.map((c) => (
                  <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 text-[12.5px] text-slate-700 sm:grid-cols-[136px_minmax(0,1fr)_auto]">
                    <span className="font-mono">{c.id}</span>
                    <span className="col-start-1 row-start-2 text-slate-500 sm:col-start-auto sm:row-start-auto sm:text-slate-700">{c.what}</span>
                    <span className="row-start-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800 ring-1 ring-inset ring-rose-200 sm:row-start-auto">고위험</span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 pt-1.5 text-[12.5px] text-slate-500">
                  <span>{SECURITY_CVE_REST}</span>
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">함께 적용</span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[14px] bg-[#0c1a33] px-5 py-4 text-slate-300">
                <div>
                  <b className="text-[15px] tracking-[-0.01em] text-white">궁금한 점은 고객센터로 문의해 주세요</b>
                  <span className="block text-[13px]">점검 기록은 이 화면에 계속 남겨 둡니다</span>
                </div>
                <button
                  type="button"
                  onClick={() => void ack()}
                  disabled={saving || acked}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-[14.5px] font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1a33] disabled:opacity-60"
                >
                  {acked ? <><Check className="h-4 w-4" strokeWidth={3} />확인했습니다</> : saving ? '저장 중' : '확인했습니다'}
                </button>
              </div>
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
