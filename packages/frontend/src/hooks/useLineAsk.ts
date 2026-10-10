import { useCallback, useRef, useState } from 'react';
import { fetchLineAnswer, fetchOneLineGaps, readPartOf, readsInLine, type LineAskAnswer, type LineAskMenu, type OneLineGapsResult } from '../utils/one-line';
import { askHelp, type HelpAskResult } from '../components/help/help-api';

/**
 * ★ 2026-10-10 한 줄 묻기(설계서 docs/2026-10-10-oneline-ask-design.md §5) — 한 줄 입구 하나를 감싼다.
 *   질문이면 답을 열고 true(호출부는 만들지 않는다) · 만들기 · 판정 실패 · 스위치 밖 = false(호출부가 지금처럼 만든다).
 *   - 판정은 서버(AI 0 · 무과금) · 판정하는 동안 같은 입구를 다시 눌러도 한 번만(judging · Enter 두 번에 두 번 생성 0).
 *   - 답 읽기가 실패해도 자동으로 만들지 않는다(질문 문장에 크레딧이 나가지 않게) — 「읽지 못했어요」 + [이 문장 그대로 만들기].
 *   - 「어떻게」 질문 = 기존 도움말 답(무료 · 요금제 회사만 · 실패 = 안내만).
 */
export interface LineAskState {
  line: string;
  loading: boolean;
  answer: LineAskAnswer | null;
  help: HelpAskResult | null;
  error: string | null;
}

export function useLineAsk(menu: LineAskMenu) {
  const [ask, setAsk] = useState<LineAskState | null>(null);
  const [judging, setJudging] = useState(false);
  const busy = useRef(false);
  // 사진에서 읽은 글 조각(최대 5) — 판정에서 뺀다(사진 속 「어떤 스타일이 좋을까?」가 질문으로 잡히지 않게) · 자기 조각을 따로 들고 있는 화면(DM · 이메일)은 gaps 를 넘긴다
  const reads = useRef<string[]>([]);
  const noteRead = useCallback((text: string) => {
    const r = readPartOf(text);
    if (r) reads.current = [...reads.current.filter((x) => x !== r), r].slice(-5);
  }, []);

  const route = useCallback(async (line: string, opts: { reads?: string[]; gaps?: OneLineGapsResult | null } = {}): Promise<boolean> => {
    const t = String(line || '').trim();
    if (!t) return false;
    if (busy.current) return true;   // 판정 중 두 번째 제출은 삼킨다
    busy.current = true;
    setJudging(true);
    // 옛 답은 판정을 시작할 때 닫는다 — 판정을 기다리는 동안 옛 카드로 또 하나를 만들지 않게 · 만들기로 가도 지난 질문의 답이 남지 않게
    setAsk(null);
    try {
      const g = opts.gaps !== undefined ? opts.gaps : await fetchOneLineGaps(t, opts.reads ?? readsInLine(t, reads.current), menu);
      if (!g || !g.askEnabled || g.intent !== 'ask') return false;
      setAsk({ line: t, loading: true, answer: null, help: null, error: null });
      if (g.askTopic === 'how') {
        try {
          const h = await askHelp(t, window.location.pathname);
          setAsk({ line: t, loading: false, answer: null, help: h, error: null });
        } catch {
          setAsk({ line: t, loading: false, answer: null, help: null, error: '사용법 답을 읽지 못했어요. 잠시 뒤 다시 물어봐 주세요.' });
        }
      } else {
        try {
          const a = await fetchLineAnswer(menu, t);
          setAsk({ line: t, loading: false, answer: a, help: null, error: null });
        } catch {
          setAsk({ line: t, loading: false, answer: null, help: null, error: '답을 읽지 못했어요. 잠시 뒤 다시 물어봐 주세요.' });
        }
      }
      return true;
    } finally {
      busy.current = false;
      setJudging(false);
    }
  }, [menu]);

  const close = useCallback(() => setAsk(null), []);
  /** 답 카드가 1장 이상 열려 있는가(시작 카드를 숨길지) */
  const hasCards = !!ask?.answer && ask.answer.cards.length > 0;
  return { ask, judging, route, close, hasCards, noteRead };
}
