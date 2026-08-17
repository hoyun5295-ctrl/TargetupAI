import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, Plus, Search, Smartphone } from 'lucide-react';
// ★ 2026-07-03 에이전트(QTmsg) 전용 회사 게이팅 — 요금제 가드 면제 + 알림톡 탭만 + 로그아웃 버튼
import { useAuthStore, isAgentOnlyCompany } from '../stores/authStore';
import RcsTemplateFormModal from '../components/RcsTemplateFormModal';
// ★ D130: 알림톡 통합 관리 (IMC 연동)
import AlimtalkManagementSection from '../components/alimtalk/AlimtalkManagementSection';
// 브랜드 템플릿 관리 (기본형 발송용 템플릿 등록·검수)
import BrandTemplateManagementSection from '../components/alimtalk/BrandTemplateManagementSection';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import EmptyState from '../components/console/EmptyState';
import RowActions from '../components/console/RowActions';
import StatusPill from '../components/console/StatusPill';
import {
  kcx,
  CUI_BTN_GHOST,
  CUI_BTN_PRIMARY,
  CUI_CARD,
  CUI_CARDS,
  CUI_CARD_META,
  CUI_CARD_TITLE,
  CUI_CELL_META,
  CUI_CELL_NAME,
  CUI_CHIPS,
  CUI_CHIP_COUNT_OFF,
  CUI_CHIP_COUNT_ON,
  CUI_CHIP_OFF,
  CUI_CHIP_ON,
  CUI_FIELD,
  CUI_FIELD_INPUT,
  CUI_HEADER,
  CUI_LOADING,
  CUI_ONLY_DESKTOP,
  CUI_PAGE,
  CUI_PANEL,
  CUI_SCROLL_X,
  CUI_SPINNER,
  CUI_SUBTITLE,
  CUI_TAB_BASE,
  CUI_TAB_COUNT_OFF,
  CUI_TAB_COUNT_ON,
  CUI_TAB_INK,
  CUI_TAB_OFF,
  CUI_TAB_ON,
  CUI_TABS,
  CUI_TD,
  CUI_TD_STICKY,
  CUI_TH,
  CUI_TH_RIGHT,
  CUI_TH_STICKY,
  CUI_THEAD,
  CUI_TITLE,
  CUI_TOAST_ERROR,
  CUI_TOAST_SUCCESS,
  CUI_TOTAL,
  CUI_TOTAL_NUM,
  CUI_TR,
  CUI_WRAP,
  type CuiPillTone,
} from '../utils/console-ui';

function getToken(): string {
  return localStorage.getItem('token') || '';
}

type Tab = 'alimtalk' | 'brand' | 'rcs';

const STATUS_BADGE: Record<string, { label: string; tone: CuiPillTone }> = {
  pending: { label: '승인대기', tone: 'amber' },
  approved: { label: '승인', tone: 'green' },
  rejected: { label: '반려', tone: 'rose' },
  dormant: { label: '휴면', tone: 'neutral' },
};

/** RCS 상태 필터 — 값이 ''이면 전체 */
const RCS_FILTERS = [
  { value: '', label: '전체' },
  { value: 'pending', label: '승인대기' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '반려' },
] as const;

export default function KakaoRcsPage() {
  const navigate = useNavigate();
  // ★ 2026-07-03 에이전트 전용 회사: 요금제 가드 면제 + 알림톡 탭만 노출 + 헤더 = 로그아웃
  const { user, logout } = useAuthStore();
  const isAgentOnly = isAgentOnlyCompany(user);
  const [activeTab, setActiveTab] = useState<Tab>('alimtalk');
  const [loading, setLoading] = useState(false);

  // ★ 2026-07-29 브랜드메시지 요금제 게이팅 폐지 (Harold 확정) — 모든 요금제에서 모든 기능을 쓴다.
  //   그 전에는 ENTERPRISE만 통과해 임직원 요금제까지 막혀 있었다. 잠금 상태·잠금 모달·플랜 조회를
  //   함께 지웠다 — 게이트를 없앴는데 장치가 남으면 다음 사람이 제한이 있는 줄 안다.
  //   남은 게이트는 **채널 연동 여부**(`companies.kakao_enabled`)뿐이고, 그건 요금제가 아니라
  //   발신프로필이 있어야 나가는 기술적 전제라 유지한다.

  // 알림톡 탭은 D130 `<AlimtalkManagementSection />`이 전담 — 상태는 해당 컴포넌트 내부에서 관리.
  // 브랜드메시지 탭용 프로필 목록만 KakaoRcsPage에서 유지.
  const [profiles, setProfiles] = useState<any[]>([]);

  // ★ 2026-08-17 탭 건수 — 각 섹션이 목록을 소유하므로 건수만 위로 올려 받는다(표시 전용).
  const [alimtalkCount, setAlimtalkCount] = useState<number | null>(null);
  const [brandCount, setBrandCount] = useState<number | null>(null);

  // RCS
  // ★ 2026-08-17: 목록을 status 없이 한 번만 받아 **클라이언트에서 거른다**.
  //   전에는 필터를 누를 때마다 재조회했고, 그래서 상태별 건수를 화면에 띄울 수 없었다
  //   (응답이 이미 걸러진 결과였다). 엔드포인트는 LIMIT 없이 회사 전체를 돌려주므로
  //   한 번 받아 거르는 쪽이 요청도 줄고 건수도 정확하다.
  const [rcsTemplates, setRcsTemplates] = useState<any[]>([]);
  const [rcsFilter, setRcsFilter] = useState('');
  const [rcsSearch, setRcsSearch] = useState('');
  const [showRcsForm, setShowRcsForm] = useState(false);
  const [editingRcs, setEditingRcs] = useState<any>(null);

  // 삭제 확인 — 공용 ConfirmModal CT (native dialog 영구 금지)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [toast, setToast] = useState({ show: false, type: '' as 'success' | 'error', message: '' });

  useEffect(() => {
    if (!toast.show) return;
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(t);
  }, [toast.show]);

  // RCS 템플릿 조회 (전체)
  const fetchRcsTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/companies/rcs-templates', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setRcsTemplates(data.templates || []);
    } catch { /* ignore */ }
  }, []);

  // 프로필 조회 (브랜드 템플릿 탭 전달용)
  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/alimtalk/senders', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setProfiles(data.profiles);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRcsTemplates(), fetchProfiles()])
      .finally(() => setLoading(false));
  }, [fetchRcsTemplates, fetchProfiles]);

  // RCS 템플릿 삭제 (알림톡은 Section 내부에서 담당)
  const deleteRcsTemplate = (id: string, name: string) => {
    setConfirm({
      mode: 'danger',
      title: '템플릿 삭제',
      description: `'${name}' 템플릿을 삭제할까요?\n\n승인대기 상태만 삭제할 수 있습니다.`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/companies/rcs-templates/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          const data = await res.json();
          if (data.success) {
            setToast({ show: true, type: 'success', message: '삭제되었습니다' });
            fetchRcsTemplates();
          } else {
            setToast({ show: true, type: 'error', message: data.error || '삭제 실패' });
          }
        } catch {
          setToast({ show: true, type: 'error', message: '서버 오류' });
        }
      },
    });
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  // ★ 2026-07-03 에이전트 전용 회사 = 알림톡 템플릿만 (브랜드메시지·RCS 탭 숨김)
  const tabs = useMemo(
    () => [
      { key: 'alimtalk' as Tab, label: '알림톡 템플릿', count: alimtalkCount },
      ...(isAgentOnly
        ? []
        : [
            { key: 'brand' as Tab, label: '브랜드 템플릿', count: brandCount },
            { key: 'rcs' as Tab, label: 'RCS 템플릿', count: rcsTemplates.length },
          ]),
    ],
    [isAgentOnly, alimtalkCount, brandCount, rcsTemplates.length],
  );

  // ── 탭 밑줄 — 활성 탭 위치로 미끄러진다 ─────────────────────
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [ink, setInk] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current[activeTab];
      if (el) setInk({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTab, tabs.length]);

  // ── RCS 목록 거르기 + 상태별 건수 ─────────────────────────
  const rcsCounts = useMemo(() => {
    const map: Record<string, number> = { '': rcsTemplates.length };
    for (const f of RCS_FILTERS) {
      if (!f.value) continue;
      map[f.value] = rcsTemplates.filter(t => t.status === f.value).length;
    }
    return map;
  }, [rcsTemplates]);

  const filteredRcs = useMemo(() => {
    const kw = rcsSearch.trim().toLowerCase();
    return rcsTemplates.filter(t => {
      if (rcsFilter && t.status !== rcsFilter) return false;
      if (kw && !String(t.template_name || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [rcsTemplates, rcsFilter, rcsSearch]);

  /** 상태별 액션 — 대표(0번)는 파괴적이지 않은 것으로 둔다 */
  const rcsActions = (t: any) => {
    if (!['pending', 'rejected'].includes(t.status)) return [];
    return [
      { label: '수정', onClick: () => { setEditingRcs(t); setShowRcsForm(true); } },
      { label: '삭제', onClick: () => deleteRcsTemplate(t.id, t.template_name), danger: true },
    ];
  };

  return (
    <div className={CUI_PAGE}>
      {/* ── 헤더 ─────────────────────────────── */}
      <header className={CUI_HEADER}>
        <div className={CUI_WRAP}>
          <div className="h-[62px] flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className={CUI_TITLE}>{isAgentOnly ? '카카오 템플릿 관리' : '카카오 & RCS'}</h1>
              <p className={`${CUI_SUBTITLE} truncate`}>
                {isAgentOnly ? '알림톡 템플릿을 등록하고 검수 상태를 관리합니다' : '템플릿을 등록하고 검수 상태를 관리합니다'}
              </p>
            </div>

            {isAgentOnly ? (
              // ★ 2026-07-03 에이전트 전용 회사 — 대시보드 진입점 제거
              // ★ 2026-07-20 Harold 확정 3메뉴: 카카오 템플릿(현재)·발송결과·발신번호 등록 — /manage 축소 탭으로 연결
              <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                <button onClick={() => navigate('/manage?tab=stats')} className={CUI_BTN_GHOST}>
                  발송결과
                </button>
                <button onClick={() => navigate('/manage?tab=callbacks')} className={CUI_BTN_GHOST}>
                  발신번호 등록
                </button>
                <button onClick={() => { logout(); navigate('/login'); }} className={kcx(CUI_BTN_GHOST, 'pl-2.5')}>
                  <LogOut className="w-[15px] h-[15px]" />
                  로그아웃
                </button>
              </div>
            ) : (
              <button onClick={() => navigate('/')} className={kcx(CUI_BTN_GHOST, 'pl-2.5 shrink-0')}>
                <ArrowLeft className="w-[15px] h-[15px]" />
                대시보드
              </button>
            )}
          </div>

          {/* ── 탭 ─────────────────────────────── */}
          <nav className={CUI_TABS} role="tablist" aria-label="템플릿 종류">
            {tabs.map(tab => {
              const on = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  ref={el => { tabRefs.current[tab.key] = el; }}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActiveTab(tab.key)}
                  className={kcx(CUI_TAB_BASE, on ? CUI_TAB_ON : CUI_TAB_OFF)}
                >
                  <span>{tab.label}</span>
                  {tab.count !== null && tab.count !== undefined && (
                    <span className={on ? CUI_TAB_COUNT_ON : CUI_TAB_COUNT_OFF}>{tab.count}</span>
                  )}
                </button>
              );
            })}
            <span className={CUI_TAB_INK} style={{ width: ink.width, transform: `translateX(${ink.left}px)` }} />
          </nav>
        </div>
      </header>

      {/* ── 컨텐츠 ─────────────────────────────── */}
      <main className={`${CUI_WRAP} pb-24`}>

        {/* ═══ 알림톡 템플릿 탭 (D130 — IMC 연동 통합 섹션) ═══ */}
        {activeTab === 'alimtalk' && <AlimtalkManagementSection onCount={setAlimtalkCount} />}

        {/* ═══ 브랜드 템플릿 탭 ═══ */}
        {/* ★ 2026-07-31 '발송' 서브탭 제거 — 이 페이지는 템플릿 관리다.
            브랜드메시지 발송은 직접발송 헤더의 브랜드메시지 모달이 유일한 경로다(입구를 둘로 두면 갈라진다). */}
        {activeTab === 'brand' && (
          <BrandTemplateManagementSection profiles={profiles} setToast={setToast} onCount={setBrandCount} />
        )}

        {/* ═══ RCS 템플릿 탭 ═══ */}
        {activeTab === 'rcs' && (
          <div className="pt-7">
            {/* 툴바 */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className={CUI_CHIPS}>
                {RCS_FILTERS.map(f => {
                  const on = rcsFilter === f.value;
                  return (
                    <button
                      key={f.value || 'all'}
                      onClick={() => setRcsFilter(f.value)}
                      className={on ? CUI_CHIP_ON : CUI_CHIP_OFF}
                    >
                      {f.label}
                      <span className={on ? CUI_CHIP_COUNT_ON : CUI_CHIP_COUNT_OFF}>{rcsCounts[f.value] ?? 0}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className={`${CUI_FIELD} flex-1 lg:w-56 lg:flex-none`}>
                  <Search className="w-[14px] h-[14px] text-neutral-400 shrink-0" />
                  <input
                    value={rcsSearch}
                    onChange={e => setRcsSearch(e.target.value)}
                    placeholder="템플릿명 검색"
                    className={CUI_FIELD_INPUT}
                  />
                </div>
                <button
                  onClick={() => { setEditingRcs(null); setShowRcsForm(true); }}
                  className={CUI_BTN_PRIMARY}
                >
                  <Plus className="w-[15px] h-[15px]" />
                  템플릿 등록 요청
                </button>
              </div>
            </div>

            {loading ? (
              <div className={`${CUI_LOADING} mt-5`}>
                <span className={CUI_SPINNER} />
                불러오는 중
              </div>
            ) : filteredRcs.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  icon={Smartphone}
                  title={rcsTemplates.length === 0 ? '등록된 RCS 템플릿이 없습니다' : '조건에 맞는 템플릿이 없습니다'}
                  description={
                    rcsTemplates.length === 0
                      ? '템플릿을 등록하면 검수를 거쳐 발송에 사용할 수 있습니다.'
                      : '상태 필터나 검색어를 바꿔보세요.'
                  }
                  actionLabel={rcsTemplates.length === 0 ? '템플릿 등록 요청' : undefined}
                  onAction={rcsTemplates.length === 0 ? () => { setEditingRcs(null); setShowRcsForm(true); } : undefined}
                />
              </div>
            ) : (
              <>
                {/* 데스크톱 표 */}
                <div className={`${CUI_PANEL} ${CUI_ONLY_DESKTOP} mt-5`}>
                  <div className={CUI_SCROLL_X}>
                    <table className="w-full min-w-[760px]">
                      <thead className={CUI_THEAD}>
                        <tr>
                          <th className={CUI_TH}>템플릿명</th>
                          <th className={CUI_TH}>메시지 유형</th>
                          <th className={CUI_TH}>상태</th>
                          <th className={CUI_TH_RIGHT}>등록일</th>
                          <th className={CUI_TH_STICKY}>관리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRcs.map(t => {
                          const badge = STATUS_BADGE[t.status] || STATUS_BADGE.pending;
                          const actions = rcsActions(t);
                          return (
                            <tr key={t.id} className={CUI_TR}>
                              <td className={CUI_TD}><span className={CUI_CELL_NAME}>{t.template_name}</span></td>
                              <td className={CUI_TD}><span className="text-[13.5px] text-neutral-800">{t.message_type}</span></td>
                              <td className={CUI_TD}><StatusPill label={badge.label} tone={badge.tone} /></td>
                              <td className={`${CUI_TD} text-right`}><span className={CUI_CELL_META}>{formatDate(t.created_at)}</span></td>
                              <td className={CUI_TD_STICKY}>
                                {actions.length > 0 ? <RowActions actions={actions} /> : <span className="text-[13px] text-neutral-300">-</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 모바일 카드 */}
                <div className={`${CUI_CARDS} mt-5`}>
                  {filteredRcs.map(t => {
                    const badge = STATUS_BADGE[t.status] || STATUS_BADGE.pending;
                    const actions = rcsActions(t);
                    return (
                      <div key={t.id} className={CUI_CARD}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className={CUI_CARD_TITLE}>{t.template_name}</div>
                            <div className="mt-0.5 text-[12px] text-neutral-500">{t.message_type}</div>
                          </div>
                          <StatusPill label={badge.label} tone={badge.tone} />
                        </div>
                        <div className={CUI_CARD_META}>
                          <span className="tabular-nums">{formatDate(t.created_at)}</span>
                        </div>
                        {actions.length > 0 && (
                          <div className="mt-3">
                            <RowActions actions={actions} align="start" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <span className={CUI_TOTAL}>총 <b className={CUI_TOTAL_NUM}>{filteredRcs.length}</b>건</span>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* ═══ 모달들 ═══ */}
      {/* ★ D130: 알림톡 관련 모달(등록/수정/Wizard/알림수신자)은 AlimtalkManagementSection 내부에서 관리 */}

      {showRcsForm && (
        <RcsTemplateFormModal
          template={editingRcs}
          onClose={() => { setShowRcsForm(false); setEditingRcs(null); }}
          onSuccess={() => {
            setShowRcsForm(false);
            setEditingRcs(null);
            fetchRcsTemplates();
            setToast({ show: true, type: 'success', message: '저장되었습니다' });
          }}
        />
      )}

      {/* 삭제 확인 — 공용 CT (인라인 모달 폐기 2026-08-17) */}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      {/* Toast */}
      {toast.show && (
        <div className={toast.type === 'success' ? CUI_TOAST_SUCCESS : CUI_TOAST_ERROR} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
