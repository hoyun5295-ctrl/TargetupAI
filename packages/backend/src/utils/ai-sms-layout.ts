/**
 * ai-sms-layout.ts — ★ 2026-11-20 AI 가 쓴 문자 글의 꼴 정리 한 곳(설계서 docs/2026-11-20-staff-tickets-four-design.md P6 · 뿌리 R102 · 순수)
 *
 * 왜: AI 한줄로 접수(1120 · 서버 실측 spam_filter_tests 07:34 → 07:36) — 다듬기가 「…확인해 보세요 ▶」 줄을 새로 써 주소와 갈라 놓고
 *   「알려드려요 ★ 이번 주말」처럼 강조 표시를 문장 가운데 넣었다 · 생성 · 다듬기 둘 다 링크를 마크다운 `[글](주소)` 로 써 그 글자가 시험 폰까지 나갔다.
 *   출구가 사실(숫자 · 혜택 · 주소 있음)만 보고 꼴은 보지 않았다.
 *
 * 규칙(차례 그대로):
 *   1. 마크다운 링크 `[글](주소)` → 실제 목적지(주소)를 글자 그대로 남긴다 — 글 = 주소 · 글 = 주소에서 scheme 만 뗀 것 · 글 = 다른 링크 → 주소 / 글이 링크가 아니면 → 「글 주소」.
 *      주소 뒤 경계 = 링크 판정기에 묻는다(판정기가 「주소 + 뒤 글」을 그 주소 하나로 읽지 않으면 띄움).
 *   2. 짝 맞은 굵게 `**글**` · `__글__` → 글. **표시는 낱말 경계에서만 지운다**(여는 표시 = 줄 머리 · 공백 뒤 / 닫는 표시 = 공백 · 줄 끝 · 문장 부호 앞).
 *   3. 줄 끝 가리킴 표시(▶ ▷ ☞ ➜ ➡ → ») + 다음 빈 아닌 줄이 링크로 시작 → 표시를 그 링크 줄 앞으로(표시만 있던 줄은 지운다).
 *   4. 문장 끝(요 · 다 · 죠 뒤 [.!?~]* · 또는 [.!?]) 뒤 공백 + 강조 표시 + 공백 → 표시 앞을 줄바꿈으로. 문장 끝이 아니면 그대로(「만족도 ★★★★★」).
 *   5. 줄 머리 · 줄 끝 공백 · 탭 지움 · 줄 안 겹 공백 하나로(이모지가 지워진 자리).
 *   ★ Codex 구현 5R(같은 부류 다섯 번째 · 구조 처방) — 규칙 2 ~ 5 는 공백으로 갈린 덩어리 **안의 글자를 바꾸지 않는다**(공백 · 줄바꿈 · 덩어리 경계의 표시만).
 *     옛: 굵게 규칙이 덩어리 안 글자를 지우고, 주소를 지키는 일을 링크 판정기의 정확도(감춤)에 맡겨 판정기가 잘못 읽는 꼴마다 새 반례가 났다.
 *   마지막 = 목적지 보존 확인(textLinks 한 곳) — 정리 전 목적지가 정리 뒤 하나라도 없으면 원문 그대로.
 *
 * 출구(AI 글만) = 생성 출구(copy-exit-guards · 링크 단계 뒤) · 다듬기(services/ai validateAndNormalizeRefinedCandidates) · sanitizeForSms(AI 출력 전용).
 *   ⛔ 사람이 쓴 글(직접발송 · 대행 원문 · 알림 · 회사 리마인드 입력)에는 부르지 않는다(고객 문안 불변).
 */
import { linkSpans, textLinks, MD_LINK_RE } from './voice-form-slots';

const LINKISH_RE = /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/i;
const POINTER = '▶▷☞➜➡→»';
const EMPHASIS = '★☆●○◆◇■□※♥♡▶▷';

/** 규칙 1 — 마크다운 링크 풀기(실제 목적지 보존) */
function unwrapMarkdownLinks(text: string): string {
  return String(text ?? '').replace(MD_LINK_RE, (m: string, label: string, href: string, at: number, all: string) => {
    const l = label.trim();
    const out = l === href || `https://${l}` === href || `http://${l}` === href || LINKISH_RE.test(l)
      ? href   // 글 = 주소 · scheme 뗀 주소 · 다른 링크 = 표시 글을 버리고 목적지
      : `${l} ${href}`;
    // 경계 = 링크 판정기(linkSpans · 한 곳)에 묻는다 — 주소 + 같은 줄 뒤 글을 판정기가 정확히 그 주소로 읽지 않으면 띄운다
    //   (「…](주소)를」 · 「…](주소),혜택」 · 「…](주소)**」 → 띄움 / 「…](주소). 」 = 판정기가 끝 부호를 떼므로 그대로 · Codex 구현 1R #2 · 2R)
    const tail = all.slice(at + m.length).split('\n')[0];
    return !tail || /^\s/.test(tail) || readsAsLink(href, tail) ? out : `${out} `;
  });
}

/** 판정기가 「주소 + 뒤 글」을 정확히 그 주소 하나로 읽는가 */
function readsAsLink(href: string, tail: string): boolean {
  const sp = linkSpans(href + tail)[0];
  return !!sp && sp.start === 0 && sp.end === href.length;
}

/**
 * 규칙 2 — 덩어리 가장자리의 짝 맞은 굵게 표시만 지운다: 여는 표시 = 덩어리 머리(줄 머리 · 공백 뒤) · 닫는 표시 = 덩어리 끝(바로 뒤가 공백 · 줄 끝).
 *   덩어리 안(「?tag=__vip__」 · 「/__VIP__/」 · 「__sale__.png」)은 경계가 아니라 그대로 · 닫는 표시 뒤 문장 부호 허용 없음(「**할인**!」 = 정리 안 함 · Codex 구현 6R)
 */
const BOLD_RE = /(^|[ \t])(\*\*|__)([^\n]+?)\2(?=[ \t]|$)/gm;

/** AI 가 쓴 문자 글의 꼴 정리(규칙 1 ~ 5) */
export function tidyAiSmsLayout(text: string): string {
  const raw = String(text ?? '');
  let t = unwrapMarkdownLinks(raw);
  // 규칙 2 — 낱말 경계의 굵게 표시
  t = t.replace(BOLD_RE, '$1$3');
  // 규칙 4 — 문장 끝 뒤 강조 표시 = 줄 머리로
  t = t.replace(new RegExp(`((?:요|다|죠)[.!?~]*|[.!?])[ \\t]+([${EMPHASIS}])(?=[ \\t]+\\S)`, 'g'), '$1\n$2');
  // 규칙 5 — 줄 머리 · 줄 끝 공백 · 줄 안 겹 공백
  const lines = t.split('\n').map((l) => l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '').replace(/[ \t]{2,}/g, ' '));
  // 규칙 3 — 줄 끝 가리킴 표시 + 다음 빈 아닌 줄이 링크로 시작(판정기가 줄 첫 글자부터 링크로 읽음)
  const pointerEnd = new RegExp(`[ \\t]*([${POINTER}])[ \\t]*$`);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(pointerEnd);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    if (j >= lines.length || linkSpans(lines[j])[0]?.start !== 0) continue;
    lines[j] = `${m[1]} ${lines[j]}`;
    lines[i] = lines[i].replace(pointerEnd, '');
    if (lines[i].trim() === '') { lines.splice(i, 1); i -= 1; }
  }
  const out = lines.join('\n');
  // 목적지 보존 확인(이 CT 한 곳) — 목적지 읽기 = voice-form-slots textLinks(마크다운이든 맨 글이든 같은 읽기 · 다시 쓰기 대조와 같은 함수)
  //   정리 전 목적지가 정리 뒤 글자 그대로 하나라도 없으면 정리하지 않은 원문을 돌려준다
  const got = new Set(textLinks(out));
  return textLinks(raw).every((u) => got.has(u)) ? out : raw;
}
