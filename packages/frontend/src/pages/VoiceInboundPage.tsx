import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Mic, MicOff, Phone, RefreshCw } from 'lucide-react';

// ★ D178 (2026-05-19): 인바운드 AI 음성 응답 페이지
//   영구 원칙 — 사용자 능동 클릭(인바운드) + 회사 admin 명시 활성 + 트랜스크립트 사후 확인

interface VoiceStatus {
  enabled: boolean;
  clovaConfigured: { stt: boolean; tts: boolean };
}

interface CallRecord {
  id: string;
  callerPhone: string;
  customerId: string | null;
  transcript: string;
  aiResponse: string;
  durationMs: number;
  status: string;
  createdAt: string;
}

export default function VoiceInboundPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [statusRes, callsRes] = await Promise.all([
        fetch('/api/voice/status', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/voice/calls?limit=50', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const statusData = await statusRes.json();
      const callsData = await callsRes.json();
      if (statusData.success) setStatus(statusData);
      if (callsData.success) setCalls(callsData.calls || []);
    } catch (e) {
      console.error('음성 AI 조회 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleToggle = async () => {
    if (!status) return;
    if (!status.enabled && !confirm('인바운드 음성 AI 응답을 활성하시겠습니까? 활성 후 자사몰 사용자가 한줄로 inbound 번호로 통화 시 AI가 자동 응답합니다.')) return;
    setToggling(true);
    try {
      const res = await fetch('/api/voice/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      const data = await res.json();
      if (data.success) await loadAll();
      else alert(data.error || '토글 실패');
    } catch (e: any) {
      alert(e?.message || '토글 중 오류');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-violet-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Phone className="w-5 h-5 text-violet-600" />
          <h1 className="text-lg font-bold text-gray-800">인바운드 AI 음성 응답</h1>
          <span className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
          <div className="ml-auto">
            <button onClick={loadAll} className="text-xs text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* 영구 원칙 안내 */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>영구 원칙:</strong> 사용자가 자사몰에서 "전화 문의" 능동 클릭 시점에만 AI 응답이 작동합니다 (Phase 1 인바운드 한정).
            외향 발신은 미지원 (Phase 2 후순위). AI는 회사 CDP 데이터에 저장된 사실만 응답합니다 (추측/창작 X).
            모든 통화 트랜스크립트는 본 페이지에서 사후 확인 가능합니다.
          </div>
        </div>

        {loading && (
          <div className="bg-white border rounded-xl p-12 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {/* 활성/비활성 토글 카드 */}
        {!loading && status && (
          <div className="bg-white border rounded-xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  {status.enabled ? <Mic className="w-5 h-5 text-emerald-600" /> : <MicOff className="w-5 h-5 text-gray-400" />}
                  <h2 className="text-base font-bold text-gray-800">인바운드 음성 AI {status.enabled ? '활성' : '비활성'}</h2>
                </div>
                <div className="text-xs text-gray-600 leading-relaxed">
                  현재 상태: <strong>{status.enabled ? '인바운드 음성 응답 활성' : '비활성 (default)'}</strong><br />
                  Clova STT: {status.clovaConfigured.stt ? '✓ 환경변수 설정됨' : '✗ NAVER_CLOVA_STT_* 환경변수 미설정'}<br />
                  Clova TTS: {status.clovaConfigured.tts ? '✓ 환경변수 설정됨' : '✗ NAVER_CLOVA_TTS_* 환경변수 미설정'}
                </div>
              </div>
              <button
                onClick={handleToggle}
                disabled={toggling}
                className={`px-5 py-2.5 text-sm font-medium rounded-lg disabled:opacity-40 ${
                  status.enabled
                    ? 'bg-white border border-rose-300 hover:bg-rose-50 text-rose-700'
                    : 'bg-violet-600 hover:bg-violet-700 text-white'
                }`}
              >
                {toggling ? '처리 중...' : status.enabled ? '비활성으로 전환' : '활성으로 전환'}
              </button>
            </div>
            {(!status.clovaConfigured.stt || !status.clovaConfigured.tts) && (
              <div className="mt-3 bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-800">
                ★ Naver Clova 환경변수가 미설정 상태입니다. 관리자에게 NAVER_CLOVA_STT_INVOKE_URL / NAVER_CLOVA_STT_SECRET / NAVER_CLOVA_TTS_CLIENT_ID / NAVER_CLOVA_TTS_CLIENT_SECRET 등록을 요청해주세요.
              </div>
            )}
          </div>
        )}

        {/* 통화 이력 */}
        {!loading && (
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-base font-bold text-gray-800 mb-3">최근 통화 이력 (트랜스크립트 사후 확인)</h2>
            {calls.length === 0 ? (
              <div className="text-sm text-gray-500 py-12 text-center">
                아직 인바운드 통화 이력이 없습니다.<br />
                <span className="text-xs text-gray-400 mt-2 block">활성 후 자사몰 사용자가 한줄로 inbound 번호로 통화하면 본 영역에 표시됩니다.</span>
              </div>
            ) : (
              <div className="space-y-2">
                {calls.map((c) => {
                  const expanded = expandedCall === c.id;
                  return (
                    <div key={c.id} className="border rounded-lg">
                      <button
                        onClick={() => setExpandedCall(expanded ? null : c.id)}
                        className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 text-left"
                      >
                        <Phone className="w-4 h-4 text-violet-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">
                            {c.callerPhone}
                            {c.customerId && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">회원 식별</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5 truncate">{c.transcript.slice(0, 60)}{c.transcript.length > 60 ? '...' : ''}</div>
                        </div>
                        <div className="text-xs text-gray-400 shrink-0">
                          {c.durationMs > 0 ? `${(c.durationMs / 1000).toFixed(1)}초` : '-'} · {new Date(c.createdAt).toLocaleString('ko-KR')}
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t bg-gray-50 p-4 space-y-3 text-xs">
                          <div>
                            <div className="font-bold text-gray-700 mb-1">고객 발화 (STT)</div>
                            <div className="bg-white border rounded p-2 text-gray-700 whitespace-pre-wrap">{c.transcript}</div>
                          </div>
                          <div>
                            <div className="font-bold text-gray-700 mb-1">AI 응답 (CDP 데이터 활용)</div>
                            <div className="bg-violet-50 border border-violet-200 rounded p-2 text-violet-900 whitespace-pre-wrap">{c.aiResponse}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
