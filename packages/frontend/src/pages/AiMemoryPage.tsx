import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Brain, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

// ★ D181 (2026-05-19): AI 회사별 메모리 관리 페이지 (Anthropic Memory tool 패턴)
//   영구 원칙 #4 사용자 신뢰 — 회사 admin이 학습 메모리 검토 + 삭제 + 직접 입력 가능
//   영구 원칙 #6 — "시간 지날수록 정확도↑" (회사별 누적 학습)

type MemoryType =
  | 'success_pattern'
  | 'customer_insight'
  | 'brand_tone_evolution'
  | 'channel_performance'
  | 'compliance_learning';

interface MemoryEntry {
  id: string;
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: string;
  importance: number;
  source: string;
  metadata: Record<string, unknown>;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt: string;
}

const MEMORY_TYPE_META: Record<MemoryType, { label: string; description: string; gradient: string }> = {
  success_pattern: {
    label: '성공 패턴',
    description: '클릭률 높은 캠페인 패턴 (자동 누적)',
    gradient: 'from-emerald-400 to-teal-500',
  },
  customer_insight: {
    label: '고객 인사이트',
    description: '고객군 행동 분석 (직접 입력 가능)',
    gradient: 'from-blue-400 to-cyan-500',
  },
  brand_tone_evolution: {
    label: '브랜드 톤 진화',
    description: '시간별 톤 변화 추적',
    gradient: 'from-violet-400 to-purple-500',
  },
  channel_performance: {
    label: '채널 성과',
    description: '채널별 평균 클릭/전환 (자동 누적)',
    gradient: 'from-amber-400 to-orange-500',
  },
  compliance_learning: {
    label: '컴플라이언스 학습',
    description: '광고 차단 단어 패턴 (직접 입력 권장)',
    gradient: 'from-rose-400 to-pink-500',
  },
};

const MEMORY_TYPE_ORDER: MemoryType[] = [
  'success_pattern',
  'channel_performance',
  'customer_insight',
  'brand_tone_evolution',
  'compliance_learning',
];

export default function AiMemoryPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<MemoryType | 'all'>('all');
  const [editing, setEditing] = useState<{ memoryType: MemoryType; memoryKey: string; memoryValue: string; importance: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const token = () => localStorage.getItem('token');
  const isAdmin = user?.userType === 'company_admin';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filterType === 'all'
        ? '/api/ai/operator/memory?limit=200'
        : `/api/ai/operator/memory?type=${filterType}&limit=200`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) {
        setMemories(data.memories || []);
      } else {
        setError(data.error || '조회 실패');
      }
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterType]);

  const handleSave = async () => {
    if (!editing || !editing.memoryKey.trim() || !editing.memoryValue.trim()) {
      alert('Key와 Value는 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/operator/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          memory_type: editing.memoryType,
          memory_key: editing.memoryKey,
          memory_value: editing.memoryValue,
          importance: editing.importance,
          source: 'admin_input',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditing(null);
        await load();
      } else {
        alert(data.error || '저장 실패');
      }
    } catch (e: any) {
      alert(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 메모리를 삭제하시겠습니까? AI가 더 이상 이 패턴을 참고하지 않습니다.')) return;
    try {
      const res = await fetch(`/api/ai/operator/memory/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await load();
      else alert(data.error || '삭제 실패');
    } catch (e: any) {
      alert(e?.message || '삭제 중 오류');
    }
  };

  // 타입별 그룹화
  const byType = new Map<MemoryType, MemoryEntry[]>();
  for (const m of memories) {
    const arr = byType.get(m.memoryType) || [];
    arr.push(m);
    byType.set(m.memoryType, arr);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Brain className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-800">AI 학습 메모리</h1>
              <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">회사별 누적 학습 5종 (성공 패턴 / 고객 인사이트 / 톤 / 채널 / 규제) — 시간 지날수록 정확도↑</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={load} className="text-xs text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            {isAdmin && (
              <button
                onClick={() => setEditing({ memoryType: 'customer_insight', memoryKey: '', memoryValue: '', importance: 7 })}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                직접 입력
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>영구 원칙:</strong> AI는 본 메모리를 시스템 프롬프트에 포함하여 회사별 맞춤 응답을 생성합니다.
            성공 패턴 / 채널 성과는 캠페인 종료 시 자동 누적되며, 고객 인사이트 / 컴플라이언스 학습은 직접 입력하실 수 있습니다.
            모든 메모리는 회사 관리자가 검토 + 삭제 가능합니다 (사용자 신뢰 원칙).
          </div>
        </div>

        {/* 타입 필터 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border ${filterType === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            전체 ({memories.length})
          </button>
          {MEMORY_TYPE_ORDER.map((type) => {
            const count = byType.get(type)?.length || 0;
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium border ${filterType === type ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
              >
                {MEMORY_TYPE_META[type].label} ({count})
              </button>
            );
          })}
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">{error}</div>}

        {loading && (
          <div className="bg-white border rounded-xl p-12 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && memories.length === 0 && (
          <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-500">
            아직 누적된 학습 메모리가 없습니다.
            <br />
            <span className="text-xs text-gray-400 mt-2 block">캠페인을 발송하시면 성공 패턴 / 채널 성과가 자동으로 누적됩니다.</span>
          </div>
        )}

        {!loading && MEMORY_TYPE_ORDER.map((type) => {
          const arr = byType.get(type) || [];
          if (filterType !== 'all' && filterType !== type) return null;
          if (arr.length === 0) return null;
          const meta = MEMORY_TYPE_META[type];
          return (
            <div key={type} className="bg-white border rounded-xl overflow-hidden">
              <div className={`p-4 bg-gradient-to-r ${meta.gradient} text-white`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold">{meta.label}</div>
                    <div className="text-xs opacity-90 mt-0.5">{meta.description}</div>
                  </div>
                  <div className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{arr.length}건</div>
                </div>
              </div>
              <div className="divide-y">
                {arr.map((m) => (
                  <div key={m.id} className="p-4 flex items-start gap-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{m.memoryKey}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">중요도 {m.importance}</span>
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{m.source}</span>
                      </div>
                      <div className="text-xs text-gray-600 whitespace-pre-wrap">{m.memoryValue}</div>
                      <div className="text-[10px] text-gray-400 mt-1">
                        최근 접근 {new Date(m.lastAccessedAt).toLocaleString('ko-KR')} · 생성 {new Date(m.createdAt).toLocaleDateString('ko-KR')}
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded"
                        title="삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 직접 입력 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-600" />
              메모리 직접 입력
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">타입</label>
                <select
                  value={editing.memoryType}
                  onChange={(e) => setEditing({ ...editing, memoryType: e.target.value as MemoryType })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  {MEMORY_TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>{MEMORY_TYPE_META[t].label} — {MEMORY_TYPE_META[t].description}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Key (짧은 식별자, 200자 이내)</label>
                <input
                  type="text"
                  value={editing.memoryKey}
                  onChange={(e) => setEditing({ ...editing, memoryKey: e.target.value })}
                  placeholder="예: VIP 고객 재구매 패턴"
                  maxLength={200}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Value (상세 내용)</label>
                <textarea
                  value={editing.memoryValue}
                  onChange={(e) => setEditing({ ...editing, memoryValue: e.target.value })}
                  placeholder="예: VIP 등급 고객은 화요일 오후 2시 알림톡 발송 시 클릭률 18%로 가장 높음"
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none h-24"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">중요도 (1~10, 높을수록 AI가 우선 참고)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={editing.importance}
                  onChange={(e) => setEditing({ ...editing, importance: Math.max(1, Math.min(10, parseInt(e.target.value) || 5)) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg disabled:opacity-40">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
