import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { AlertCircle, ArrowLeft, BookOpen, FileText, Loader2, Search, Sparkles } from 'lucide-react';

// ★ D181 (2026-05-19): Anthropic Citations 페이지
//   사용자 자연어 질문 → 회사 데이터 documents → AI 응답 + 근거 인용
//   영구 원칙 #4 사용자 신뢰 본질 — "AI가 제시한 근거 표시"

interface CitationSpan {
  citedText: string;
  documentIndex: number;
  documentTitle: string;
  startCharIndex?: number;
  endCharIndex?: number;
}

interface CitedAnswer {
  text: string;
  citations: CitationSpan[];
  document_titles: string[];
}

const EXAMPLE_QUESTIONS = [
  '최근 30일 중 가장 성과가 좋았던 캠페인은?',
  '우리 회사 VIP 고객의 평균 구매 빈도는?',
  '어떤 채널이 클릭률이 가장 높았나요?',
  '최근 학습된 메시지 톤 패턴을 알려주세요',
];

export default function AiExplainPage() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<CitedAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  const handleAsk = async (q?: string) => {
    const finalQuestion = (q ?? question).trim();
    if (finalQuestion.length < 5) {
      setError('질문을 5자 이상 입력해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    setAnswer(null);
    if (q) setQuestion(q);
    try {
      const res = await fetch('/api/ai/operator/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ question: finalQuestion }),
      });
      const data = await res.json();
      if (data.success) {
        setAnswer({
          text: data.text,
          citations: data.citations || [],
          document_titles: data.document_titles || [],
        });
      } else {
        setError(data.error || '분석 실패');
      }
    } catch (e: any) {
      setError(e?.message || '요청 중 오류');
    } finally {
      setLoading(false);
    }
  };

  // 인용을 document별로 그룹화
  const citationsByDoc = new Map<number, CitationSpan[]>();
  if (answer) {
    for (const c of answer.citations) {
      const arr = citationsByDoc.get(c.documentIndex) || [];
      arr.push(c);
      citationsByDoc.set(c.documentIndex, arr);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <BookOpen className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-800">AI에게 질문 (근거 인용)</h1>
          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>근거 인용 답변:</strong> AI가 본 회사의 데이터(회사 정보 + 30일 캠페인 history + 학습 메모리 + 고객 통계)만 참고하여 답변하고, 응답 옆에 근거 출처를 인용합니다.
            추측 / 창작 없음 — 회사 데이터에 없는 영역은 "정보 없음"으로 답변합니다.
          </div>
        </div>

        {/* 질문 입력 */}
        <div className="bg-white border rounded-xl p-4">
          <label className="text-xs font-medium text-gray-600 block mb-2">질문</label>
          <div className="flex gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="자연어로 본 회사 데이터에 대해 질문해주세요"
              className="flex-1 px-3 py-2 border rounded-lg text-sm resize-none h-20"
              maxLength={500}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk();
              }}
            />
            <button
              onClick={() => handleAsk()}
              disabled={loading || question.trim().length < 5}
              className="px-5 self-stretch bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? '분석 중' : '질문'}
            </button>
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Ctrl+Enter로 빠른 전송</div>

          {/* 예시 질문 */}
          {!answer && !loading && (
            <div className="mt-3 pt-3 border-t">
              <div className="text-[11px] text-gray-500 mb-2">예시 질문</div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleAsk(q)}
                    className="text-[11px] px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-full"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">{error}</div>}

        {loading && (
          <div className="bg-white border rounded-xl p-12 flex flex-col items-center text-gray-500 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <div className="text-sm">AI가 회사 데이터를 분석 중입니다...</div>
          </div>
        )}

        {/* 응답 */}
        {answer && !loading && (
          <>
            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <div className="text-sm font-bold text-gray-800">AI 응답</div>
                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">근거 {answer.citations.length}건 인용</span>
              </div>
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{answer.text}</div>
            </div>

            {/* 인용 근거 */}
            {answer.citations.length > 0 && (
              <div className="bg-white border rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <div className="text-sm font-bold text-gray-800">근거 출처 ({answer.document_titles.length}개 문서 / {answer.citations.length}건 인용)</div>
                </div>
                <div className="space-y-3">
                  {answer.document_titles.map((title, idx) => {
                    const citations = citationsByDoc.get(idx) || [];
                    if (citations.length === 0) return null;
                    return (
                      <div key={idx} className="border-l-2 border-emerald-300 pl-3">
                        <div className="text-xs font-bold text-emerald-700 mb-1.5">📄 {title}</div>
                        <div className="space-y-1.5">
                          {citations.map((c, i) => (
                            <div key={i} className="text-xs text-gray-600 bg-emerald-50/50 rounded p-2 italic">
                              "{c.citedText}"
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={() => { setAnswer(null); setQuestion(''); }}
              className="text-xs text-gray-600 hover:text-gray-800 underline"
            >
              새 질문 하기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
