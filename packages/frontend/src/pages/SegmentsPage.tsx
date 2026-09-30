/**
 * ★ D220+ Task 6 (2026-05-27 신설) — 일반 segment 관리 메뉴
 *
 * 🎯 목적
 *   - saved_segments 통합 관리 메뉴 (기존 AI 한줄로 발송 안 단순 prompt 저장 → 정식 segment 자산화)
 *   - 자연어 → CT-97 → CT-01 호환 filter_jsonb 변환 + saved_segments INSERT
 *   - 모든 발송 흐름 안 재활용 가능 (Braze/Salesforce 동급 자산)
 *
 * 영구 룰 정합 (D215+ design_quality_minimum_journey_level):
 *   - 보라 톤 (violet 그라데이션 + 액센트) — D222+ Phase 3 정정
 *   - sticky 헤더 + Sparkles 아이콘 + BETA 배지
 *   - 자연어 입력 카드 (Sparkles + 빠른 시작 예시 4건)
 *   - segment 목록 카드 매트릭스 (확장 토글 시 매칭 수 + 샘플 5건)
 *   - ConfirmModal + useToast (native dialog 0건)
 *   - Source caption 의무
 *   - 모바일 반응형 (grid-cols-1 md:grid-cols-2)
 *
 * 영구 룰 정합:
 *   - no_target_auto_relax (D171) — 0건 매칭 자동 완화 X
 *   - ai_no_arbitrary_benefit — segment 안 구체 혜택 X
 *   - no_model_name_ui_exposure — UI 모델명 0건
 */

import { useEffect, useState } from 'react';
import ZoneFrame from '../components/zone/ZoneFrame';
import { AI_MEMORY_TABS } from '../components/zone/zone-tabs';
import {
  Sparkles, Target, Plus, Trash2, Edit3, Eye, EyeOff,
  Users, RefreshCw, AlertCircle, Check, X,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';

interface SavedSegment {
  id: string;
  name: string;
  emoji: string;
  segment_type: 'hanjullo' | 'custom';
  prompt: string | null;
  selected_fields: string[] | null;
  briefing: string | null;
  url: string | null;
  channel: string | null;
  is_ad: boolean;
  filter_jsonb: Record<string, { operator: string; value: any }> | null;
  last_used_at: string | null;
  created_at: string;
}

interface PreviewResult {
  matchCount: number | null;
  samples: Array<{
    id: string;
    phone: string;
    name: string | null;
    gender: string | null;
    region: string | null;
    last_purchase_date: string | null;
    total_purchase_amount: number | null;
  }>;
  message?: string;
}

const EXAMPLES = [
  '30일 안 구매하지 않은 30대 여성',
  'VIP 등급 + 누적 구매 100만원 이상',
  '서울 거주 + 최근 3개월 안 1회 이상 구매한 고객',
  '결혼기념일이 이번 달인 고객',
];

export default function SegmentsPage() {
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 신규 segment 생성
  const [createOpen, setCreateOpen] = useState(false);
  const [nlInput, setNlInput] = useState('');
  const [nlGenerating, setNlGenerating] = useState(false);
  const [nlResult, setNlResult] = useState<{
    filter: any;
    explanation: string;
    matchCount: number;
    samples: PreviewResult['samples'];
  } | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  // 미리보기
  const [previews, setPreviews] = useState<Record<string, PreviewResult>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<SavedSegment | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ★ 2026-08-22 자체 우하단 토스트 폐기 → 공용 알림(ToastProvider) 사용.
  //   우하단은 도움말 런처 자리다. 화면마다 알림을 따로 만들면 그 자리에서 겹친다.
  const toast = useToast();

  useEffect(() => {
    loadSegments();
  }, []);

  function showToast(type: 'success' | 'error', message: string) {
    toast[type](message);
  }

  async function loadSegments() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/saved-segments', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || '세그먼트 목록 조회 실패');
        return;
      }
      setSegments(data.segments || []);
    } catch (e: any) {
      setError(e?.message || '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!nlInput.trim()) {
      setNlError('조건을 자연어로 입력해주세요.');
      return;
    }
    setNlGenerating(true);
    setNlError(null);
    setNlResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/saved-segments/generate-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ naturalLanguage: nlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNlError(data?.error || 'AI 변환 실패');
        return;
      }
      setNlResult({
        filter: data.filter,
        explanation: data.explanation,
        matchCount: data.matchCount,
        samples: data.samples || [],
      });
    } catch (e: any) {
      setNlError(e?.message || 'AI 변환 실패');
    } finally {
      setNlGenerating(false);
    }
  }

  async function handleSave() {
    if (!nlResult || !newName.trim()) {
      showToast('error', '세그먼트 이름을 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/saved-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newName.trim(),
          emoji: '🎯',
          segmentType: 'custom',
          prompt: nlInput.trim(),
          filter: nlResult.filter,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data?.error || '저장 실패');
        return;
      }
      showToast('success', '세그먼트가 저장되었습니다.');
      setCreateOpen(false);
      setNlInput('');
      setNewName('');
      setNlResult(null);
      loadSegments();
    } catch (e: any) {
      showToast('error', e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/saved-segments/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data?.error || '삭제 실패');
        return;
      }
      showToast('success', '삭제되었습니다.');
      setDeleteTarget(null);
      loadSegments();
    } catch (e: any) {
      showToast('error', e?.message || '삭제 실패');
    } finally {
      setDeleting(false);
    }
  }

  async function handlePreview(seg: SavedSegment) {
    if (previews[seg.id]) {
      setExpanded((prev) => ({ ...prev, [seg.id]: !prev[seg.id] }));
      return;
    }
    setPreviewLoading((prev) => ({ ...prev, [seg.id]: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/saved-segments/${seg.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data?.error || '미리보기 실패');
        return;
      }
      setPreviews((prev) => ({
        ...prev,
        [seg.id]: {
          matchCount: data.matchCount,
          samples: data.samples || [],
          message: data.message,
        },
      }));
      setExpanded((prev) => ({ ...prev, [seg.id]: true }));
    } catch (e: any) {
      showToast('error', e?.message || '미리보기 실패');
    } finally {
      setPreviewLoading((prev) => ({ ...prev, [seg.id]: false }));
    }
  }

  return (
    <ZoneFrame
      moduleId="ai-memory"
      tabs={AI_MEMORY_TABS}
      activeTab="segments"
      stamp={{ text: '다시 읽기', onRefresh: loadSegments, loading }}
      command={{
        facts: [{ label: '저장 세그먼트', value: loading ? '—' : `${segments.length.toLocaleString()}개` }],
        note: '자연어 → 검증된 필터 · 매칭 수 즉시 확인 · 발송 흐름에서 재활용',
        primary: { label: '신규 세그먼트', icon: Plus, tone: 'indigo', onClick: () => { setCreateOpen(true); setNlInput(''); setNewName(''); setNlResult(null); setNlError(null); } },
      }}
    >
      <div className="space-y-4">
        {loading && (
          <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center gap-3 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-violet-700" />
            <div className="text-sm">세그먼트 로딩 중...</div>
          </div>
        )}

        {error && !loading && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-800 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && segments.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
            <Target className="w-12 h-12 mx-auto mb-3 text-slate-400" />
            <p className="text-sm mb-1">저장된 세그먼트가 없습니다.</p>
            <p className="text-[11px] text-slate-400">자연어로 조건을 입력하면 AI가 자동으로 변환합니다.</p>
          </div>
        )}

        {!loading && !error && segments.length > 0 && (
          <div className="space-y-3">
            {segments.map((seg) => {
              const isExpanded = expanded[seg.id];
              const isLoading = previewLoading[seg.id];
              const preview = previews[seg.id];
              return (
                <div key={seg.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="p-4 flex items-start gap-3">
                    <div className="text-2xl flex-shrink-0">{seg.emoji || '🎯'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-slate-900">{seg.name}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${seg.segment_type === 'custom' ? 'bg-violet-100 text-violet-800 border border-violet-200' : 'bg-cyan-100 text-cyan-800 border border-cyan-200'}`}>
                          {seg.segment_type === 'custom' ? '자유 필터' : 'AI 한줄로'}
                        </span>
                        {seg.filter_jsonb && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold">
                            필터 검증됨
                          </span>
                        )}
                      </div>
                      {seg.prompt && (
                        <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{seg.prompt}</p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        {seg.last_used_at
                          ? `마지막 사용: ${new Date(seg.last_used_at).toLocaleString('ko-KR')}`
                          : `생성: ${new Date(seg.created_at).toLocaleString('ko-KR')}`}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handlePreview(seg)}
                        disabled={isLoading}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                        title={isExpanded ? '미리보기 닫기' : '매칭 수 + 샘플 확인'}
                      >
                        {isLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : isExpanded ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(seg)}
                        className="p-2 rounded-lg hover:bg-rose-100 text-slate-500 hover:text-rose-700"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* 미리보기 영역 (확장 토글) */}
                  {isExpanded && preview && (
                    <div className="px-4 pb-4 border-t border-slate-200 pt-3 space-y-2.5">
                      {preview.message && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-[11px] text-amber-800">{preview.message}</p>
                        </div>
                      )}
                      {preview.matchCount !== null && (
                        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <Users className="w-5 h-5 text-emerald-700 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] text-emerald-800">매칭 결과</p>
                            <p className="text-xl font-bold text-emerald-900">{preview.matchCount.toLocaleString()}명</p>
                          </div>
                        </div>
                      )}
                      {preview.samples.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-violet-50 p-3">
                          <p className="text-[10px] text-slate-500 mb-2 font-medium">샘플 5건</p>
                          <div className="space-y-1">
                            {preview.samples.map((s) => (
                              <div key={s.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-slate-100">
                                <span className="text-slate-700 font-mono w-28 truncate">{s.phone}</span>
                                <span className="text-slate-500 w-16 truncate">{s.name || '-'}</span>
                                <span className="text-slate-400 w-8">{s.gender || '-'}</span>
                                <span className="text-slate-400 w-16 truncate">{s.region || '-'}</span>
                                <span className="text-slate-400 ml-auto truncate">{s.last_purchase_date || '-'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {preview.matchCount === 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-[11px] text-amber-800">
                            매칭되는 고객이 0명입니다. 조건을 더 넓혀주세요. (자동 완화는 마케팅 의도 보호를 위해 차단됩니다)
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Source caption */}
        {!loading && (
          <p className="text-[10px] text-slate-400 italic text-center pt-2">
            Data source: saved_segments + CT-01 customer-filter (whitelist 필드 + parameter binding) + CT-97 자연어 변환 (단 1 오차 X)
          </p>
        )}
      </div>

      {/* 신규 세그먼트 모달 */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">신규 세그먼트 생성</h2>
                  <p className="text-[10px] text-slate-500">자연어 → AI 변환 → 매칭 수 즉시 확인</p>
                </div>
              </div>
              <button onClick={() => setCreateOpen(false)} className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {/* 빠른 시작 예시 */}
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5">💡 빠른 시작 예시</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((p) => (
                    <button
                      key={p}
                      onClick={() => setNlInput(p)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* 자연어 입력 */}
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">조건 자연어 입력</label>
                <textarea
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  placeholder="예: 30일 안 구매하지 않은 30대 여성"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-violet-400"
                  rows={3}
                  disabled={nlGenerating}
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={handleGenerate}
                    disabled={!nlInput.trim() || nlGenerating}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 text-white rounded-lg text-xs font-semibold"
                  >
                    {nlGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {nlGenerating ? 'AI 변환 중...' : 'AI 변환'}
                  </button>
                </div>
              </div>

              {/* 오류 */}
              {nlError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-700 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-rose-900">{nlError}</p>
                </div>
              )}

              {/* 결과 카드 */}
              {nlResult && (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-start gap-3">
                      <Users className="w-6 h-6 text-emerald-700 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-[10px] text-emerald-800">매칭 결과</p>
                        <p className="text-2xl font-bold text-emerald-900">{nlResult.matchCount.toLocaleString()}명</p>
                        <p className="text-[11px] text-emerald-900 mt-1.5 leading-relaxed">
                          <span className="font-semibold">AI 해석:</span> {nlResult.explanation}
                        </p>
                      </div>
                    </div>
                  </div>

                  {nlResult.samples.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[10px] text-slate-500 mb-2 font-medium">샘플 5건 미리보기</p>
                      <div className="space-y-1">
                        {nlResult.samples.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-slate-100">
                            <span className="text-slate-700 font-mono w-28 truncate">{s.phone}</span>
                            <span className="text-slate-500 w-16 truncate">{s.name || '-'}</span>
                            <span className="text-slate-400 w-8">{s.gender || '-'}</span>
                            <span className="text-slate-400 w-16 truncate">{s.region || '-'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 저장 */}
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                    <p className="text-[11px] text-violet-900 mb-2">이 세그먼트를 저장하면 발송 시 재활용할 수 있습니다.</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="세그먼트 이름 (예: 30일 미구매 30대 여성)"
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-violet-400"
                        disabled={saving}
                      />
                      <button
                        onClick={handleSave}
                        disabled={!newName.trim() || saving}
                        className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 text-white rounded-lg text-xs font-semibold"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {saving ? '저장 중...' : '저장'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl w-full max-w-md p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-700" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-slate-900 mb-1">세그먼트 삭제</h3>
                <p className="text-[11px] text-slate-600">
                  "<span className="text-slate-900 font-semibold">{deleteTarget.name}</span>" 세그먼트를 삭제하시겠습니까?
                </p>
                <p className="text-[10px] text-slate-400 mt-1">발송 흐름에 활용 중이면 추출 결과가 달라질 수 있습니다.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 bg-rose-200 hover:bg-rose-200 text-rose-900 rounded-lg text-xs font-semibold disabled:opacity-40"
              >
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

    </ZoneFrame>
  );
}
