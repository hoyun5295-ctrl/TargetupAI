// components/admin/AgentDeployWizard.tsx
// 싱크에이전트 배포 위저드 — 서수란 팀장이 OS를 평범한 말로 고르면 내보낼 버전을 알려준다.
// 룰표는 백엔드 CT(utils/agent-build-tiers) 단일 진실원. 프론트는 endpoint로 받아 렌더만(매핑 인라인 X).
// 슈퍼관리자(화이트 톤) 안에 들어가므로 라이트 + violet 액센트로 맞춤.
// 설계서: docs/superpowers/specs/2026-06-16-sync-agent-build-tiers-design.md
import { useEffect, useState } from 'react';
import {
  Monitor, Server, Database, Download, ArrowLeft, RotateCcw,
  CheckCircle2, ShieldAlert, Sparkles, PackageCheck, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useToast } from '../ToastProvider';

type PlatformId = 'windows' | 'linux';
interface Platform { id: PlatformId; label: string; }
interface OsTier { id: string; platform: PlatformId; label: string; supported: boolean; rangeMessage?: string; buildTier?: string | null; }
interface DbOption { id: string; driver: string; label: string; notes: string[]; }
type BuildState = 'blocked' | 'candidate' | 'verified';
interface ResolveResult {
  supported: boolean;
  state: BuildState;
  buildTier: string | null;
  driver: string | null;
  packageKey: string | null;
  packageFile: string | null;
  node: number | null;
  runtimeBundle: boolean;
  mode: 'thick' | 'thin' | 'na';
  nativeClient: string | null;
  dbNotes: string[];
  connectionProfile: string;
  installSummary: string[];
  rangeMessage?: string;
}

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const STEP_LABELS = ['플랫폼', 'OS 버전', 'DB', '결과'];

function WizardCard({
  icon: Icon, title, subtitle, onClick, danger,
}: { icon: LucideIcon; title: string; subtitle?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-4 rounded-2xl border p-5 text-left transition-all ${
        danger
          ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
          : 'border-gray-200 bg-white hover:border-violet-400 hover:bg-violet-50 hover:shadow-md'
      }`}
    >
      <span
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow ${
          danger ? 'from-amber-500 to-orange-600' : 'from-violet-500 to-fuchsia-600'
        }`}
      >
        <Icon className="h-6 w-6 text-white" />
      </span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold text-gray-900">{title}</span>
        {subtitle && <span className="mt-0.5 block text-xs text-gray-500">{subtitle}</span>}
      </span>
      <ChevronRight className="h-5 w-5 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-500" />
    </button>
  );
}

export default function AgentDeployWizard() {
  const toast = useToast();
  const [boot, setBoot] = useState<{ platforms: Platform[]; osTiers: OsTier[]; dbOptions: DbOption[]; verifiedCombos: string[] } | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [platform, setPlatform] = useState<PlatformId | null>(null);
  const [osTier, setOsTier] = useState<OsTier | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/sync/build-tiers', { headers: authHeader() });
        const data = await res.json();
        if (data.success) setBoot({ platforms: data.platforms, osTiers: data.osTiers, dbOptions: data.dbOptions, verifiedCombos: data.verifiedCombos || [] });
        else toast.error('빌드 티어 정보를 불러오지 못했습니다.');
      } catch {
        toast.error('빌드 티어 정보를 불러오지 못했습니다.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => { setStep(1); setPlatform(null); setOsTier(null); setResult(null); };

  const pickPlatform = (p: PlatformId) => { setPlatform(p); setOsTier(null); setResult(null); setStep(2); };

  const pickOsTier = (t: OsTier) => {
    setOsTier(t);
    if (!t.supported) {
      setResult({ supported: false, state: 'blocked', buildTier: null, driver: null, packageKey: null, packageFile: null, node: null, runtimeBundle: false, mode: 'na', nativeClient: null, dbNotes: [], connectionProfile: '', installSummary: [], rangeMessage: t.rangeMessage });
      setStep(4);
    } else {
      setStep(3);
    }
  };

  const pickDb = async (d: DbOption) => {
    if (!platform || !osTier) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ platform, osTier: osTier.id, db: d.id });
      const res = await fetch(`/api/admin/sync/build-tiers/resolve?${qs.toString()}`, { headers: authHeader() });
      const data = await res.json();
      if (data.success) { setResult(data.result); setStep(4); }
      else toast.error(data.error || '빌드를 결정하지 못했습니다.');
    } catch {
      toast.error('빌드를 결정하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const downloadBuild = async (packageKey: string) => {
    try {
      const res = await fetch(`/api/admin/sync/build-tiers/download/${packageKey}`, { headers: authHeader() });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        toast.error(data.error || '다운로드에 실패했습니다.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sync-agent-${packageKey}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('다운로드에 실패했습니다.');
    }
  };

  const back = () => {
    if (step === 4) { setResult(null); setStep(osTier && !osTier.supported ? 2 : 3); }
    else if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  };

  const osList = boot?.osTiers.filter((t) => t.platform === platform) || [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
      {/* 헤더 */}
      <div className="flex items-center gap-3 border-b border-gray-200 pb-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow">
          <PackageCheck className="h-5 w-5 text-white" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-gray-900">싱크에이전트 배포</h2>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">BETA</span>
          </div>
          <p className="text-xs text-gray-500">고객사 OS를 고르면 내보낼 버전과 설치 방법을 알려드립니다.</p>
        </div>
      </div>

      {/* 단계 진행 */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  active ? 'bg-violet-600 text-white' : done ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-400'
                }`}
              >
                {n}
              </span>
              <span className={`text-xs ${active ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
              {i < STEP_LABELS.length - 1 && <span className="h-px w-4 bg-gray-200 md:w-8" />}
            </div>
          );
        })}
      </div>

      {/* 본문 */}
      <div className="mt-6 min-h-[200px]">
        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(boot?.platforms || []).map((p) => (
              <WizardCard
                key={p.id}
                icon={p.id === 'windows' ? Monitor : Server}
                title={p.label}
                subtitle={p.id === 'windows' ? '서버 / PC Windows' : '서버 Linux'}
                onClick={() => pickPlatform(p.id)}
              />
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {osList.map((t) => (
              <WizardCard
                key={t.id}
                icon={platform === 'windows' ? Monitor : Server}
                title={t.label}
                subtitle={t.supported ? undefined : '지원 범위 밖'}
                danger={!t.supported}
                onClick={() => pickOsTier(t)}
              />
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(boot?.dbOptions || []).map((d) => (
              <WizardCard key={d.id} icon={Database} title={d.label} onClick={() => pickDb(d)} />
            ))}
            {loading && <p className="col-span-full text-sm text-gray-400">빌드 결정 중…</p>}
          </div>
        )}

        {step === 4 && result && (
          result.supported ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
                <div className="flex items-center gap-2 text-violet-700">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-xs font-semibold">이 OS용으로 내보낼 버전</span>
                </div>
                <p className="mt-2 text-lg font-bold text-gray-900">{osTier?.label} 전용</p>
                {result.runtimeBundle && (
                  <p className="mt-1 text-xs text-emerald-600">필요한 런타임이 폴더에 모두 들어 있어 추가 설치 없이 실행됩니다.</p>
                )}
                {result.state === 'verified' ? (
                  <p className="mt-1 text-xs font-semibold text-emerald-600">실연결 검증 완료된 버전입니다.</p>
                ) : (
                  <p className="mt-1 text-xs text-amber-600">검증 전(베타) — 직원 테스트용입니다. 실연결 확인 후 정식 버전으로 표기됩니다.</p>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />설치 방법
                </h4>
                <ol className="space-y-2">
                  {result.installSummary.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="font-semibold text-violet-600">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {result.dbNotes.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
                    <Database className="h-4 w-4" />DB 연결 주의사항
                  </h4>
                  <ul className="space-y-1">
                    {result.dbNotes.map((n, i) => (
                      <li key={i} className="text-sm text-amber-700">· {n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => result.packageKey && downloadBuild(result.packageKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition-opacity hover:opacity-90"
                >
                  <Download className="h-4 w-4" />이 버전 다운로드
                </button>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  <RotateCcw className="h-4 w-4" />처음부터
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
                <div className="flex items-center gap-2 text-amber-800">
                  <ShieldAlert className="h-5 w-5" />
                  <span className="text-sm font-semibold">지원 범위 밖</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-amber-700">{result.rangeMessage}</p>
              </div>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <RotateCcw className="h-4 w-4" />처음부터
              </button>
            </div>
          )
        )}
      </div>

      {/* 하단: 이전 + 출처 */}
      <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
        {step > 1 ? (
          <button onClick={back} className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700">
            <ArrowLeft className="h-3.5 w-3.5" />이전
          </button>
        ) : (
          <span />
        )}
        <span className="text-[10px] italic text-gray-400">기준: 사내 빌드 티어 룰표</span>
      </div>
    </div>
  );
}
