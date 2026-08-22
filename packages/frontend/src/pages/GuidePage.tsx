/**
 * GuidePage — 기능 안내 화면 /guide · /guide/:jobId (★ 2026-08-22 신설)
 *
 * **원고 0장·스크린샷 0장.** 도움말 봇과 같은 카탈로그를 그리기만 한다(단일 원장). 여기에만 있고 봇은 모르는 설명이 생기면 결함이다.
 * 톤 = 라이트 인디고(읽고 검색하고 공유하는 조회 화면). 옛 정적 매뉴얼(3개월 정지)의 푸터 링크가 여기로 온다.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Lock, Search } from 'lucide-react';
import { CUI_FIELD, CUI_FIELD_INPUT, CUI_PAGE, CUI_WRAP } from '../utils/console-ui';
import HelpJobCard from '../components/help/HelpJobCard';
import { fetchHelpCatalog, fetchHelpJob, type HelpJob } from '../components/help/help-api';
import {
  GUIDE_BACK, GUIDE_CARD, GUIDE_CARD_GOAL, GUIDE_CARD_TITLE, GUIDE_DETAIL, GUIDE_GRID, GUIDE_GROUP, GUIDE_GROUP_TITLE, GUIDE_HERO,
  HELP_LOCK, HELP_SKELETON, HELP_SOURCE, HELP_STUB,
} from '../components/help/help-ui';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export default function GuidePage() {
  const { jobId } = useParams<{ jobId?: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<{ groups: { key: string; label: string; jobs: string[] }[]; jobs: HelpJob[] } | null>(null);
  const [detail, setDetail] = useState<{ job: HelpJob; related: HelpJob[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [q, setQ] = useState('');
  const [openRelated, setOpenRelated] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      if (jobId) {
        const d = await fetchHelpJob(jobId);
        if (!alive) return;
        if (!d) { setDenied(true); setLoading(false); return; }
        setDetail(d);
      } else {
        const c = await fetchHelpCatalog();
        if (!alive) return;
        if (!c) { setDenied(true); setLoading(false); return; }
        setData(c);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [jobId]);

  const byId = useMemo(() => new Map((data?.jobs || []).map((j) => [j.id, j])), [data]);
  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq || !data) return null;
    return data.jobs.filter((j) => norm(j.title).includes(nq) || norm(j.goal).includes(nq) || j.keywords.some((k) => norm(k).includes(nq)));
  }, [q, data]);

  return (
    <div className={CUI_PAGE}>
      <div className={`${CUI_WRAP} py-8 md:py-10`}>
        {denied ? (
          <div className={GUIDE_DETAIL}>
            <p className="text-[15px] font-semibold text-neutral-900">요금제 사용 중인 계정에서 열립니다</p>
            <p className="text-[13px] text-neutral-500">요금제 안내에서 지금 열려 있는 기능을 확인할 수 있습니다.</p>
            <Link to="/pricing" className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-600">요금제 안내<ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
        ) : loading ? (
          <div className="space-y-3"><div className={HELP_SKELETON} /><div className={HELP_SKELETON} /><div className={HELP_SKELETON} /></div>
        ) : detail ? (
          <div className="space-y-6">
            <Link to="/guide" className={GUIDE_BACK}><ArrowLeft className="w-4 h-4" />전체 안내</Link>
            <div className={GUIDE_DETAIL}>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[22px] font-bold tracking-[-0.03em] text-neutral-900">{detail.job.title}</h1>
                  {detail.job.locked && <span className={HELP_LOCK}><Lock className="w-3 h-3" strokeWidth={2.2} />지금 요금제에서는 잠김</span>}
                  {detail.job.status === 'stub' && <span className={HELP_STUB}>안내 준비 중</span>}
                </div>
                <p className="mt-2 text-[14px] text-neutral-600">{detail.job.goal}</p>
              </div>
              <HelpJobCard job={detail.job} open onToggle={() => undefined} showGuideLink={false} />
              {detail.related.length > 0 && (
                <div>
                  <p className="text-[13px] font-semibold text-neutral-900 mb-2">함께 보는 기능</p>
                  <div className="space-y-2">
                    {detail.related.map((r) => (
                      <HelpJobCard key={r.id} job={r} open={openRelated === r.id} onToggle={() => setOpenRelated(openRelated === r.id ? null : r.id)} />
                    ))}
                  </div>
                </div>
              )}
              <p className={HELP_SOURCE}>Data source: 기능 안내 원장</p>
            </div>
          </div>
        ) : data ? (
          <>
            <div className={GUIDE_HERO}>
              <div className="flex items-center gap-2 text-indigo-600"><BookOpen className="w-5 h-5" strokeWidth={2} /><span className="text-[12.5px] font-semibold">기능 안내</span></div>
              <h1 className="mt-2 text-[24px] md:text-[28px] font-bold tracking-[-0.03em] text-neutral-900">무엇을 하고 싶으신가요</h1>
              <p className="mt-2 text-[14px] text-neutral-600">하려는 일을 고르면 시작 위치와 순서, 막히는 지점을 알려 드립니다. 오른쪽 아래 도움말에서 바로 물어볼 수도 있습니다.</p>
              <label className={`${CUI_FIELD} mt-5 max-w-md bg-white`}>
                <Search className="w-4 h-4 text-neutral-400" strokeWidth={2} aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 예약, 엑셀, 수신거부" aria-label="기능 검색" className={CUI_FIELD_INPUT} />
              </label>
            </div>

            {filtered ? (
              <section className={GUIDE_GROUP}>
                <h2 className={GUIDE_GROUP_TITLE}>검색 결과 {filtered.length}건</h2>
                {filtered.length === 0 ? (
                  <p className="text-[13px] text-neutral-500">맞는 기능이 없습니다. 다른 말로 찾아보거나 오른쪽 아래 도움말에 물어보세요.</p>
                ) : (
                  <div className={GUIDE_GRID}>{filtered.map((j) => <Card key={j.id} job={j} onClick={() => navigate(`/guide/${j.id}`)} />)}</div>
                )}
              </section>
            ) : (
              data.groups.map((g) => {
                const jobs = g.jobs.map((id) => byId.get(id)).filter(Boolean) as HelpJob[];
                if (jobs.length === 0) return null;
                return (
                  <section key={g.key} className={GUIDE_GROUP}>
                    <h2 className={GUIDE_GROUP_TITLE}>{g.label}</h2>
                    <div className={GUIDE_GRID}>{jobs.map((j) => <Card key={j.id} job={j} onClick={() => navigate(`/guide/${j.id}`)} />)}</div>
                  </section>
                );
              })
            )}
            <p className={`${HELP_SOURCE} mt-8`}>Data source: 기능 안내 원장</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Card({ job, onClick }: { job: HelpJob; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={GUIDE_CARD}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={GUIDE_CARD_TITLE}>{job.title}</span>
        {job.locked && <span className={HELP_LOCK}><Lock className="w-3 h-3" strokeWidth={2.2} />잠김</span>}
        {job.status === 'stub' && <span className={HELP_STUB}>준비 중</span>}
      </div>
      <p className={GUIDE_CARD_GOAL}>{job.goal}</p>
    </button>
  );
}
