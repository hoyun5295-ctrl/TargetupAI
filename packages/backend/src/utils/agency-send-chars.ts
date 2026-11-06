/**
 * agency-send-chars.ts — 대행 접수 글 준비 CT(★ 2026-11-06 C109 · B-1106-1 · 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §2-3 · D1 · D5)
 *
 * 왜 있나
 *   대행 문안 · 제목 · 명단 값은 접수에서 글자를 보지 않았다. 보낼 수 없는 글자가 든 접수가 검사 입구에서 반려되고,
 *   그 반려가 「검사 장비 문제 · 문안 문제는 아닙니다」로 읽혀 같은 글을 세 번 다시 검사했다(뿌리 R68 · 쓰는 자리에서 판정).
 * 규칙(Harold 추천안 ① · ③)
 *   - 뺌 · 바꿈 글자(이모지 · 보이지 않는 글자 · 바꿈 표 글자) = 적용하고 위치를 알린다
 *   - 막음 글자(바꿀 글자가 없는 글자) = 위치를 적어 반려
 *   - 명단 값 = 같은 규칙(행 = 명단 순서 1부터 · 칸 = 문안 항목 이름)
 *   - 변수 토큰(%이름%) 안의 보낼 수 없는 글자 = 막음으로 반려(토큰 · 매핑 · 수신자 키를 함께 바꾸지 않는다)
 *   - 정리 후 빈 문안 · 빈 제목 = 반려
 * 쓰는 곳 = 접수 공용 createRequestCore(화면 · 원스텝 · 메일 마지막 문) · 원스텝 · 메일 분석 analyzeOneStep(읽은 직후) · 문안 수정(agency-send-change).
 * ⛔ 판정 = 글자 CT 하나(message-sanitizer smsCharAction · 뿌리 R1) · 문장에 그 글자를 넣지 않는다(P4).
 */
import { scanSmsText, cleanSmsTextAll, describeSmsCharFindings } from './message-sanitizer';
import { findVarTokens } from './var-tokens';

/** 정리 알림(이력 두 종류의 재료) — 문안 · 제목 줄 / 명단 고친 칸 수 · 예 */
export interface AgencyCharNotes {
  content: string[];
  recipients: { count: number; examples: string[] };
}
export const EMPTY_AGENCY_CHAR_NOTES: AgencyCharNotes = { content: [], recipients: { count: 0, examples: [] } };

export type AgencyCharReject = { ok: false; status: 400; code: 'UNSUPPORTED_CHARS'; error: string };

const RECIPIENT_PLACE_MAX = 20;
const RECIPIENT_EXAMPLE_MAX = 3;
const REJECT_TAIL = '그 글자를 빼거나 바꿔 다시 보내 주세요.';
const REJECT_TAIL_SAVE = '그 글자를 빼거나 바꿔 다시 저장해 주세요.';

function reject(error: string): AgencyCharReject {
  return { ok: false, status: 400, code: 'UNSUPPORTED_CHARS', error };
}

/**
 * 문안 · 제목 준비(순수) — 막음 · 토큰 안 글자 · 정리 후 빈 값 = 반려 · 그 밖 = 정리된 글 + 알림 줄.
 *   at = 부르는 자리(접수 = 요청서 · 화면 접수 · 저장 = 접수된 건의 문안 고치기) · 반려 문장의 동사만 다르다.
 */
export function prepareAgencyCopy(input: { content?: string | null; subject?: string | null }, at: 'intake' | 'save' = 'intake'):
  | { ok: true; content: string; subject: string; lines: string[] }
  | AgencyCharReject {
  const verb = at === 'save' ? '저장하지 못했습니다' : '접수하지 못했습니다';
  const tail = at === 'save' ? REJECT_TAIL_SAVE : REJECT_TAIL;
  const rawContent = String(input.content ?? '');
  const rawSubject = String(input.subject ?? '');
  const tokenPlaces: string[] = [];
  for (const [label, text] of [['문안', rawContent], ['제목', rawSubject]] as const) {
    for (const t of findVarTokens(text)) {
      const sc = scanSmsText(t.name);
      if (sc.findings.length > 0) tokenPlaces.push(...describeSmsCharFindings(sc.findings, { where: `${label} 변수 %${cleanSmsTextAll(t.name)}%`, max: 3 }));
    }
  }
  if (tokenPlaces.length > 0) {
    return reject(`문안 항목(변수) 이름에 문자로 보낼 수 없는 글자가 있어 ${verb}: ${tokenPlaces.join(', ')}. 항목 이름에서 그 글자를 빼고 다시 ${at === 'save' ? '저장해' : '보내'} 주세요.`);
  }
  const cs = scanSmsText(rawContent);
  const ss = scanSmsText(rawSubject);
  const blockPlaces = [
    ...describeSmsCharFindings(cs.findings.filter((f) => f.action === 'block'), { multiline: cs.multiline, max: 5 }),
    ...describeSmsCharFindings(ss.findings.filter((f) => f.action === 'block'), { where: '제목', multiline: ss.multiline, max: 3 }),
  ];
  if (blockPlaces.length > 0) return reject(`문안에 문자로 보낼 수 없는 글자가 있어 ${verb}: ${blockPlaces.join(', ')}. ${tail}`);
  // ★ Codex 구현 1R #1 — 문안 = 저장될 최종 글(정리 + 앞뒤 공백 제거)을 여기서 한 번 확정한다(분석 반환 · 메일 중복 지문 · SQL 비교 · 저장이 같은 글)
  const content = cleanSmsTextAll(rawContent).trim();
  const subject = cleanSmsTextAll(rawSubject);
  if (rawContent.trim() && !content) return reject('문안에 문자로 보낼 수 있는 글자가 없습니다. 문안을 확인해 주세요.');
  if (rawSubject.trim() && !subject.trim()) return reject('제목에 문자로 보낼 수 있는 글자가 없습니다. 제목을 확인해 주세요.');
  // ★ Codex 구현 1R #2 — 정리가 변수 토큰을 만들거나(「%(보이지 않는 글자)이름%」 → 「%이름%」) 없애거나 바꾸면 반려
  //   (화면 · 분석은 원문의 토큰으로 매핑 · 수신자 값을 정했다 → 새 토큰은 값 없이 빈칸으로 나간다)
  const tokensOf = (t: string) => findVarTokens(t).map((x) => x.name).join('\u0000');
  for (const [label, raw, clean] of [['문안', rawContent, content], ['제목', rawSubject, subject]] as const) {
    if (tokensOf(raw) === tokensOf(clean)) continue;
    const made = [...new Set(findVarTokens(clean).map((x) => `%${x.name}%`))].join(' ') || '(항목 표시)';
    return reject(`${label}의 문안 항목(변수) 표시 안팎에 문자로 보낼 수 없는 글자가 있어 ${verb}: ${made}. 항목 표시 둘레의 그 글자를 빼고 다시 ${at === 'save' ? '저장해' : '보내'} 주세요.`);
  }
  const lines = [
    ...describeSmsCharFindings(cs.findings, { multiline: cs.multiline, max: 5 }),
    ...describeSmsCharFindings(ss.findings, { where: '제목', multiline: ss.multiline, max: 3 }),
  ];
  return { ok: true, content, subject, lines };
}

/**
 * 명단 값 정리기(행마다 부른다 · 원스텝 분석은 명단을 읽는 고리 안에서 · 접수 코어는 수신자 배열에서).
 *   clean = 문자열 값의 뺌 · 바꿈을 적용한 새 vars(바뀐 게 없으면 같은 객체) · 막음은 모아 두었다가 done() 이 반려.
 *   ponytail: 객체 값(JSON 으로 저장되는 값)은 보지 않는다 — 엑셀 · CSV 명단 값은 글 · 숫자 · 날짜뿐이다.
 */
export function createAgencyRecipientCleaner() {
  let count = 0;
  const examples: string[] = [];
  const blocked: string[] = [];
  let blockedTotal = 0;
  return {
    clean<V extends Record<string, any> | null | undefined>(vars: V, rowNo: number): V {
      if (!vars || typeof vars !== 'object') return vars;
      let next: Record<string, any> | null = null;
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v !== 'string' || !v) continue;
        const sc = scanSmsText(v);
        if (sc.findings.length === 0) continue;
        const where = `명단 ${rowNo}행 ${cleanSmsTextAll(k)} 칸`;
        const blocks = sc.findings.filter((f) => f.action === 'block');
        if (blocks.length > 0) {
          blockedTotal += 1;
          if (blocked.length < RECIPIENT_PLACE_MAX) blocked.push(describeSmsCharFindings(blocks, { where, multiline: sc.multiline, max: 1 })[0]);
          continue;
        }
        count += 1;
        if (examples.length < RECIPIENT_EXAMPLE_MAX) examples.push(describeSmsCharFindings(sc.findings, { where, multiline: sc.multiline, max: 1 })[0]);
        next = next ?? { ...vars };
        next[k] = cleanSmsTextAll(v);
      }
      return (next ?? vars) as V;
    },
    done(): { ok: true; recipients: { count: number; examples: string[] } } | AgencyCharReject {
      if (blockedTotal > 0) {
        const more = blockedTotal > blocked.length ? `, 외 ${blockedTotal - blocked.length}곳` : '';
        return reject(`명단에 문자로 보낼 수 없는 글자가 있어 접수하지 못했습니다: ${blocked.join(', ')}${more}. ${REJECT_TAIL}`);
      }
      return { ok: true, recipients: { count, examples } };
    },
  };
}

/** 접수 코어용 한 번에(문안 · 제목 · 수신자 배열 · 행 번호 = 배열 순서 1부터) */
export function prepareAgencyText<R extends { vars?: Record<string, any> | null }>(input: {
  content?: string | null; subject?: string | null; recipients?: R[] | null;
}): { ok: true; content: string; subject: string; recipients: R[]; notes: AgencyCharNotes } | AgencyCharReject {
  const copy = prepareAgencyCopy(input);
  if (!copy.ok) return copy;
  const cleaner = createAgencyRecipientCleaner();
  const recipients = (input.recipients || []).map((r, i) => {
    if (!r || typeof r !== 'object') return r;
    const vars = cleaner.clean(r.vars, i + 1);
    return vars === r.vars ? r : { ...r, vars };
  });
  const rec = cleaner.done();
  if (!rec.ok) return rec;
  return { ok: true, content: copy.content, subject: copy.subject, recipients, notes: { content: copy.lines, recipients: rec.recipients } };
}

/** 두 단계(분석 · 코어) 알림 합치기 — 코어의 다시 보기(정리된 글 = 빈 결과)가 분석 알림을 덮지 않는다 */
export function mergeAgencyCharNotes(a: AgencyCharNotes | null | undefined, b: AgencyCharNotes | null | undefined): AgencyCharNotes {
  const x = a ?? EMPTY_AGENCY_CHAR_NOTES;
  const y = b ?? EMPTY_AGENCY_CHAR_NOTES;
  return {
    content: [...new Set([...(x.content || []), ...(y.content || [])])],
    recipients: {
      count: (Number(x.recipients?.count) || 0) + (Number(y.recipients?.count) || 0),
      examples: [...(x.recipients?.examples || []), ...(y.recipients?.examples || [])].slice(0, RECIPIENT_EXAMPLE_MAX),
    },
  };
}

/**
 * 승인 요청 문자 줄(순수 · ★ 2026-11-06 C109 D1 · 구조체크 S7) — 가장 최근 content_cleaned · recipients_cleaned 이력의 줄(각 한 줄 · 첫 위치 + 외 n곳).
 *   버전으로 읽지 않는다(다듬기가 버전을 올린다) · 사람이 문안을 고치면 빈 content_cleaned 가 옛 줄을 덮는다.
 */
export function agencyCharPassedLines(content: { lines?: unknown } | null | undefined, recipients: { count?: unknown; lines?: unknown } | null | undefined): string[] {
  const out: string[] = [];
  const cl = Array.isArray(content?.lines) ? (content!.lines as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : [];
  if (cl.length > 0) out.push(`보낼 수 없는 글자를 빼고 보냅니다: ${cl[0]}${cl.length > 1 ? `, 외 ${cl.length - 1}곳` : ''}`);
  const rl = Array.isArray(recipients?.lines) ? (recipients!.lines as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : [];
  const rc = Number(recipients?.count) || rl.length;
  if (rc > 0 && rl.length > 0) out.push(`명단에서 보낼 수 없는 글자를 빼고 보냅니다: ${rl[0]}${rc > 1 ? `, 외 ${rc - 1}곳` : ''}`);
  return out;
}

/** 사람이 보는 알림 줄(화면 접수 성공 자리 · 원스텝 확인 화면 · 회신 메일) */
export function agencyCharNotice(notes: AgencyCharNotes | null | undefined, done: '접수했습니다' | '저장했습니다' = '접수했습니다'): string[] {
  const n = notes ?? EMPTY_AGENCY_CHAR_NOTES;
  const out: string[] = [];
  if (n.content.length > 0) out.push(`문자로 보낼 수 없는 글자를 빼고 ${done}: ${n.content.join(', ')}`);
  if (n.recipients.count > 0) out.push(`명단 ${n.recipients.count}곳에서 보낼 수 없는 글자를 뺐습니다(예: ${n.recipients.examples.join(', ')})`);
  return out;
}
