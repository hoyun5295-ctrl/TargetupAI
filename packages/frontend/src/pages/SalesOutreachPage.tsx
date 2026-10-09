/**
 * ★ 2026-10-09 AI 영업 페이지(설계서 docs/2026-10-09-outreach-redesign-design.md R10)
 *
 * /admin/outreach = 작업대(AI 존 틀) · /admin/outreach/:jobId = 상세(옛 모달을 페이지 모드로) · /admin/outreach/new = 등록.
 * 주소가 화면을 정하므로 브라우저 뒤로가기가 상세 → 작업대 → /admin 으로 돌아간다(옛 = 모달·덮개라 로그인 화면으로 빠졌다 · 서수란 접수).
 * 라우트는 super_admin · 실제 권한은 서버(isSalesOutreachOperator / assertOperator)가 소유한다.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import SalesOutreachWorkbench from '../components/admin/SalesOutreachWorkbench';
import SalesOutreachModal from '../components/admin/SalesOutreachModal';
import ZoneFrame from '../components/zone/ZoneFrame';
import { Megaphone } from 'lucide-react';
import type { ZoneCustomModule } from '../components/zone/zone-color';

const DETAIL_ZONE: ZoneCustomModule = {
  id: 'sales-outreach', label: 'AI 영업', description: '업체 홈페이지를 읽고 맞춤 제안 세트를 만들어 확인한 뒤 보냅니다', icon: Megaphone, gradient: 'from-sky-500 to-blue-600',
};

export default function SalesOutreachPage() {
  const { jobId } = useParams<{ jobId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navIds: string[] = Array.isArray((location.state as any)?.navIds) ? (location.state as any).navIds : [];

  // 상세 안에서 건이 바뀌어 주소를 맞춘 것(바꿔 끼우기)이면 다시 그리지 않는다 · 밖에서 주소가 바뀌면 새로 연다
  const synced = useRef<string | null>(null);
  const [detailKey, setDetailKey] = useState(jobId || 'new');
  useEffect(() => {
    if (jobId && jobId === synced.current) return;
    setDetailKey(jobId || 'new');
  }, [jobId]);

  const toWorkbench = () => navigate('/admin/outreach');

  if (!jobId) {
    return (
      <SalesOutreachWorkbench
        variant="page"
        onClose={() => navigate('/admin')}
        onOpenNew={() => navigate('/admin/outreach/new')}
        onOpenJob={(id, ids) => navigate(`/admin/outreach/${id}`, { state: { navIds: ids } })}
      />
    );
  }

  return (
    <ZoneFrame moduleId={DETAIL_ZONE} backTo="/admin/outreach" backLabel="작업대로" sub={jobId === 'new' ? '등록' : '상세'} width="desk">
      <SalesOutreachModal
        key={detailKey}
        variant="page"
        initialJobId={jobId === 'new' ? null : jobId}
        initialNavIds={navIds}
        onClose={toWorkbench}
        onOpenWorkbench={toWorkbench}
        onJobChange={(id) => { synced.current = id; navigate(`/admin/outreach/${id}`, { replace: true, state: location.state }); }}
      />
    </ZoneFrame>
  );
}
