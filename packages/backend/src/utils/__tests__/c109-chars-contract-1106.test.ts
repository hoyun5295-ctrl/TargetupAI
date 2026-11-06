/**
 * C109 · B-1106-1 「문자로 보낼 수 없는 글자」 판정 자리 전체 — 계약 시험(★ 2026-11-06 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §9)
 *   K1 = 발송 정리 옛 출력 그대로(구현 전 실제 출력을 뜬 fixtures/c109-sanitize-unsendable-golden.json)
 *   K2 = 분류 CT 표 · 지우는 자리가 CT 를 지난다(R1)
 *   K3 = 위치 문장(그 글자를 넣지 않는다)
 *   K8 = 정리된 글은 검사 입구가 막을 글자를 가질 수 없다(전 코드 포인트 성질)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  smsCharAction, scanSmsText, cleanSmsTextAll, describeSmsCharFindings, smsTextBlockReason, assertSmsTextSendable,
  sanitizeUnsendableForSms, sanitizeForSms,
} from '../message-sanitizer';
import { isSmsEncodableChar, unsupportedSmsCharCodes } from '../sms-charset';
import { stripEmojis } from '../copy-exit-guards';
import { sanitizeSmsText } from '../auto-notify-message';
import { protectLinkTokens, mapOutsideLinkMasks } from '../brand-link-core';
import { prepareAgencyCopy, prepareAgencyText, agencyCharNotice, mergeAgencyCharNotes, agencyCharPassedLines } from '../agency-send-chars';
import { journeyCopyIssue } from '../send-placeholder-gate';
import { operatorFinalCopyAt, finalCopyCleared } from '../operator-final-copy';
import { operatorCharsReason, decideSpamOutcome } from '../continuous-operator-policy';

const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'c109-sanitize-unsendable-golden.json'), 'utf8')) as {
  ranges: Array<[number, number]>; unchanged: number; changed: Record<string, { s: string; e: string[]; r: string[] }>;
  whole: Array<{ t: string; out: any }>;
};

describe('K1 발송 정리 옛 출력 그대로(구현 전 실제 출력 대조)', () => {
  it('글자마다 sanitized · removedEmojis · replacedChars 가 옛 출력과 같다(바뀌지 않던 글자는 그대로)', () => {
    let unchanged = 0;
    const diffs: string[] = [];
    for (const [a, b] of golden.ranges) for (let cp = a; cp <= b; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const out = sanitizeUnsendableForSms('가' + ch + '나');
      const want = golden.changed[cp.toString(16)];
      if (!want) {
        if (out.sanitized === '가' + ch + '나' && out.removedEmojis.length === 0 && out.replacedChars.length === 0 && !out.hadChanges) unchanged++;
        else diffs.push(cp.toString(16));
        continue;
      }
      if (out.sanitized !== want.s || JSON.stringify(out.removedEmojis) !== JSON.stringify(want.e) || JSON.stringify(out.replacedChars) !== JSON.stringify(want.r)) diffs.push(cp.toString(16));
    }
    expect(diffs.slice(0, 10)).toEqual([]);
    expect(unchanged).toBe(golden.unchanged);
  });
  it('여러 글자 글 · 빈 값 · 경고 문장 · 배열이 옛 출력과 같다', () => {
    for (const w of golden.whole) expect(sanitizeUnsendableForSms(w.t)).toEqual(w.out);
  });
});

describe('K2(R1) 분류 CT 표', () => {
  const act = (cp: number) => smsCharAction(String.fromCodePoint(cp));
  it('이모지 = 뺌 · 별 이모지 U+2B50 = 뺌 · U+200B = 빈 글자로 바꿈 · U+00A0 = 공백 · é = 막음 · ★ = 그대로', () => {
    expect(act(0x1f60a)).toEqual({ action: 'remove', kind: 'emoji' });
    expect(act(0x2b50)).toEqual({ action: 'remove', kind: 'emoji' });
    expect(act(0x200d)).toEqual({ action: 'remove', kind: 'combining' });
    expect(act(0x200b)).toEqual({ action: 'replace', to: '' });
    expect(act(0x00a0)).toEqual({ action: 'replace', to: ' ' });
    expect(act(0x00e9)).toEqual({ action: 'block' });
    expect(act(0x2605)).toEqual({ action: 'keep' });
    expect(act(0xac00)).toEqual({ action: 'keep' });
  });
  it('scanSmsText = 뺌만 빠지고 바꿈 적용 · 막음은 남는다(= 발송 정리와 같은 글)', () => {
    const t = '여름 세일😊\n카페 café 좋아요';
    const s = scanSmsText(t);
    expect(s.cleaned).toBe('여름 세일\n카페 café 좋아요');
    expect(s.cleaned).toBe(sanitizeUnsendableForSms(t).sanitized);
    expect(s.findings.map((f) => [f.code, f.action, f.line, f.before])).toEqual([
      ['U+1F60A', 'remove', 1, '여름 세일'], ['U+00E9', 'block', 2, '카페 caf'], ['U+00A0', 'replace', 2, '카페 caf'],   // 앞 글자 = 보낼 수 있는 글자만
    ]);
  });
  it('sanitizeForSms(AI 글) = 막음 글자도 뺀다 · 옛 정규화(이모지 범위 먼저 · ★ 지움 · 따옴표 바꿈)는 그대로', () => {
    const out = sanitizeForSms('café ★ “할인”');
    expect(out.sanitized).toBe('caf  "할인"');
  });
});

describe('K3 위치 문장', () => {
  it('줄 · 앞 글자 · 이름 · 코드 · 그 글자를 넣지 않는다', () => {
    const s = scanSmsText('첫 줄\n여름 세일😊 지금');
    const lines = describeSmsCharFindings(s.findings, { multiline: s.multiline });
    expect(lines).toEqual(["2번째 줄 '여름 세일' 뒤 이모지(U+1F60A)"]);
    for (const l of lines) expect(unsupportedSmsCharCodes(l)).toEqual([]);
  });
  it('한 줄 칸 이름(where) · 맨 앞 · 외 n곳', () => {
    const s = scanSmsText('😊a😊b😊c😊d😊e😊f');
    const lines = describeSmsCharFindings(s.findings, { where: '명단 3행 이름 칸', max: 2 });
    expect(lines[0]).toBe('명단 3행 이름 칸 맨 앞 이모지(U+1F60A)');
    expect(lines[1]).toBe("명단 3행 이름 칸 'a' 뒤 이모지(U+1F60A)");
    expect(lines[2]).toBe('외 4곳');
  });
  it('사람 글 저장 관문 = 뺌 · 바꿈 · 막음 전부 · 400 UNSUPPORTED_CHARS', () => {
    expect(smsTextBlockReason([{ label: '본문', text: '좋은 글' }])).toBeNull();
    const r = smsTextBlockReason([{ label: '본문', text: '여름 세일😊' }, { label: '제목', text: 'café' }]);
    expect(r).toBe("문자로 보낼 수 없는 글자가 있어요: 본문 '여름 세일' 뒤 이모지(U+1F60A), 제목 'caf' 뒤 보낼 수 없는 글자(U+00E9). 그 글자를 빼고 다시 저장해 주세요.");
    expect(() => assertSmsTextSendable([{ label: '본문', text: '​' }])).toThrow(expect.objectContaining({ status: 400, code: 'UNSUPPORTED_CHARS' }));
  });
});

describe('K8 정리된 글은 검사 입구가 막을 글자를 가질 수 없다(도달 불가 증명 · 전 코드 포인트)', () => {
  it('U+0000 ~ U+2FFFF · U+E0000 ~ U+E007F 의 모든 글자에서 cleanSmsTextAll 결과 = 보낼 수 있는 글자만', () => {
    const bad: string[] = [];
    const ranges: Array<[number, number]> = [[0x0000, 0x2ffff], [0xe0000, 0xe007f]];
    for (const [a, b] of ranges) for (let cp = a; cp <= b; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const out = cleanSmsTextAll('가' + String.fromCodePoint(cp) + '나');
      if (unsupportedSmsCharCodes(out).length > 0) bad.push(cp.toString(16));
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it('검사 입구 판정과 같은 isSmsEncodableChar 를 쓴다(정리 결과 각 글자 = 보낼 수 있음)', () => {
    for (const ch of Array.from(cleanSmsTextAll('😊é​ ★가A\n'))) expect(isSmsEncodableChar(ch) || ch === '\n').toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// ★ 구현 단계 계약(K2 기계 추출 · K4 자리 · K5 · K6 · K7) — 설계서 §9
// ════════════════════════════════════════════════════════════════════
const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const codeOnly = (s: string) => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
const sliceFn = (s: string, head: string, tail?: string) => {
  const a = s.indexOf(head);
  if (a < 0) throw new Error(`없음: ${head}`);
  const b = tail ? s.indexOf(tail, a + head.length) : -1;
  return s.slice(a, b > a ? b : undefined);
};
function walkTs(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walkTs(p, out); continue; }
    if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
}

describe('K2(R1) 기계 추출 — 글자 범위로 글을 지우는 자리 = 글자 CT + 이유 붙은 예외뿐', () => {
  it('backend src 에서 이모지 · 기호 범위를 쓰는 파일 목록', () => {
    const RANGE = /\\u\{1F|\\u\{2[67]|0x1F[0-9A-Fa-f]{3}|0x2600|\\uD83[CDE]|\\u26[0-9A-Fa-f]{2}-|\\u27[0-9A-Fa-f]{2}|Extended_Pictographic/;
    const hits = walkTs(SRC).filter((p) => RANGE.test(codeOnly(readFileSync(p, 'utf8')))).map((p) => p.slice(SRC.length + 1).replace(/\\/g, '/')).sort();
    expect(hits).toEqual([
      'utils/auto-notify-message.ts',        // 꾸밈 기호 제거 그대로 + 끝에 글자 CT(cleanSmsTextAll · 아래 시험)
      'utils/brand-voice-validator.ts',      // 목소리 판정만(글을 바꾸지 않는다)
      'utils/message-sanitizer.ts',          // 글자 CT 본체
      'utils/one-line-ct/ai.ts',             // AI 한줄로 칸 값 = 문자 · DM · 이메일 공용(문자로 나가는 글은 출구 CT · 검사 입구가 본다)
      'utils/sales-outreach-naver-store.ts', // 영업 수집 상품 이름 정리(문자 아님)
      'utils/sns-caption-rules.ts',          // SNS(문자 아님)
      'utils/training-logger.ts',            // 이모지 수 세기만(글을 바꾸지 않는다)
    ]);
  });
  it('지우는 자리 넷이 CT 를 지난다(동작 · 소스)', () => {
    expect(stripEmojis('여름⭐ 세일​ café 😊')).toBe('여름 세일 caf');
    expect(read('utils/copy-exit-guards.ts')).toMatch(/subject = stripEmojis\(subject\)/);
    expect(sliceFn(read('services/ai.ts'), 'export function stripIncompatibleEmojis(', '\n}\n')).toContain('cleanSmsTextAll(text)');
    expect(sanitizeSmsText('▶ 안내 ⭐ café​ 끝')).toBe('안내 caf 끝');
  });
  it('출구 CT 는 감춘 링크 자리를 지우지 않는다(사용자 영역 글자 · bug-1031-link 계약과 같은 뿌리)', () => {
    const m = protectLinkTokens('보러 가기 😊\n{{LINK:공식몰}}');
    const kept = mapOutsideLinkMasks(m.text, cleanSmsTextAll);
    expect(m.restore(kept)).toBe('보러 가기 \n{{LINK:공식몰}}');
    expect(read('utils/copy-exit-guards.ts')).toContain('msgField = stripEmojis(msgField, { keepLinkMasks: true });');
  });
});

describe('K5(R68) 쓰는 자리 판정 — 대행 글 준비 CT', () => {
  it('뺌 · 바꿈 = 적용 + 알림 · 막음 = 위치 반려 · 토큰 안 글자 = 반려 · 정리 후 빈 값 = 반려', () => {
    const ok = prepareAgencyCopy({ content: '첫 줄\n여름 세일😊 %이름%님', subject: '안내​' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.content).toBe('첫 줄\n여름 세일 %이름%님');
      expect(ok.subject).toBe('안내');
      expect(ok.lines).toEqual(["2번째 줄 '여름 세일' 뒤 이모지(U+1F60A)", "제목 '안내' 뒤 보이지 않는 글자(U+200B)"]);
    }
    const blk = prepareAgencyCopy({ content: '첫 줄\n카페 café', subject: '' });
    expect(blk.ok).toBe(false);
    if (!blk.ok) {
      expect(blk.status).toBe(400);
      expect(blk.code).toBe('UNSUPPORTED_CHARS');
      expect(blk.error).toBe("문안에 문자로 보낼 수 없는 글자가 있어 접수하지 못했습니다: 2번째 줄 '카페 caf' 뒤 보낼 수 없는 글자(U+00E9). 그 글자를 빼거나 바꿔 다시 보내 주세요.");
    }
    const tok = prepareAgencyCopy({ content: '%고객😊%님 안녕하세요' });
    expect(tok.ok).toBe(false);
    if (!tok.ok) { expect(tok.error).toContain('문안 항목(변수) 이름'); expect(unsupportedSmsCharCodes(tok.error)).toEqual([]); }
    const empty = prepareAgencyCopy({ content: '😊🎉' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe('문안에 문자로 보낼 수 있는 글자가 없습니다. 문안을 확인해 주세요.');
    expect(prepareAgencyCopy({ content: '' }).ok).toBe(true);   // 빈 문안 = 접수 코어의 빈 값 판정이 본다
    // ★ Codex 구현 1R #1 — 반환 문안 = 저장될 최종 글(정리 + 앞뒤 공백 제거) · 메일 중복 지문 · SQL 비교 · 저장이 같은 글
    const tail = prepareAgencyCopy({ content: '안녕 ​' });
    expect(tail.ok && tail.content).toBe('안녕');
    const coreSide = prepareAgencyText({ content: String('안녕 ​').trim(), recipients: [] });
    expect(coreSide.ok && coreSide.content).toBe('안녕');
    // ★ Codex 구현 1R #2 — 정리가 변수 토큰을 만들면 반려(원문은 토큰이 아니라 매핑 · 값이 없다)
    const made = prepareAgencyCopy({ content: '%​이름%님 안녕하세요' });
    expect(made.ok).toBe(false);
    if (!made.ok) { expect(made.code).toBe('UNSUPPORTED_CHARS'); expect(made.error).toContain('%이름%'); expect(unsupportedSmsCharCodes(made.error)).toEqual([]); }
    expect(prepareAgencyCopy({ content: '%이름%님 😊 안녕하세요' }).ok).toBe(true);   // 토큰 밖 이모지 = 그대로 정리
    // 접수된 건의 문안 고치기 = 「저장」 동사(접수라고 말하지 않는다)
    const save = prepareAgencyCopy({ content: '가을 신상 입고 café' }, 'save');
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.error).toBe("문안에 문자로 보낼 수 없는 글자가 있어 저장하지 못했습니다: 1번째 줄 '상 입고 caf' 뒤 보낼 수 없는 글자(U+00E9). 그 글자를 빼거나 바꿔 다시 저장해 주세요.");
    expect(read('utils/agency-send-change.ts')).toContain("prepareAgencyCopy({ content: body, subject }, 'save')");
  });
  it('명단 값 = 같은 규칙(행 = 순서 1부터 · 칸 이름) · 막음 = 반려(20곳 + 외 n곳) · 바뀐 것 없으면 같은 객체', () => {
    const r = prepareAgencyText({ content: '%이름%님', recipients: [{ phone: '01000000000', vars: { 이름: '가' } }, { phone: '01000000001', vars: { 이름: '나😊', 등급: 'VIP' } }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipients[1].vars).toEqual({ 이름: '나', 등급: 'VIP' });
      expect(r.recipients[0]).toBe((r.recipients as any)[0]);
      expect(r.notes.recipients).toEqual({ count: 1, examples: ["명단 2행 이름 칸 '나' 뒤 이모지(U+1F60A)"] });
      expect(agencyCharNotice(r.notes)).toEqual(["명단 1곳에서 보낼 수 없는 글자를 뺐습니다(예: 명단 2행 이름 칸 '나' 뒤 이모지(U+1F60A))"]);
    }
    const many = Array.from({ length: 23 }, (_, i) => ({ phone: `0100000${String(i).padStart(4, '0')}`, vars: { 이름: `é${i}` } }));
    const b = prepareAgencyText({ content: '%이름%님', recipients: many });
    expect(b.ok).toBe(false);
    if (!b.ok) { expect(b.error).toContain('명단 1행 이름 칸 맨 앞 보낼 수 없는 글자(U+00E9)'); expect(b.error).toContain(', 외 3곳.'); }
  });
  it('두 단계 알림 합치기 · 승인 요청 줄', () => {
    const m = mergeAgencyCharNotes({ content: ['a'], recipients: { count: 2, examples: ['x'] } }, { content: [], recipients: { count: 0, examples: [] } });
    expect(m).toEqual({ content: ['a'], recipients: { count: 2, examples: ['x'] } });
    expect(agencyCharPassedLines({ lines: ['A', 'B'] }, { count: 3, lines: ['X'] })).toEqual(['보낼 수 없는 글자를 빼고 보냅니다: A, 외 1곳', '명단에서 보낼 수 없는 글자를 빼고 보냅니다: X, 외 2곳']);
    expect(agencyCharPassedLines({ lines: [] }, null)).toEqual([]);
  });
  it('쓰는 자리가 판정을 부른다(소스 · 접수 코어 맨 앞 · 원스텝 분석 읽은 직후 · 문안 수정 · 다듬은 글)', () => {
    const intake = read('utils/agency-send-intake.ts');
    const core = sliceFn(intake, 'export async function createRequestCore(', 'export function kickFirstTest(');
    expect(core.indexOf('prepareAgencyText(')).toBeGreaterThan(0);
    expect(core.indexOf('prepareAgencyText(')).toBeLessThan(core.indexOf('const body = String(content'));
    expect(core.indexOf('await logCharCleanedTx(client, request.id, charNotes);')).toBeLessThan(core.indexOf("if (own) await client.query('COMMIT');"));
    const an = sliceFn(intake, 'export async function analyzeOneStep(', 'export async function hasApprovalRequestedColumn(');
    expect(an.indexOf('prepareAgencyCopy(')).toBeLessThan(an.indexOf('extractAgencyVars(formContent)'));
    expect(an).toContain('recipientCleaner.clean(vars, rowIdx + 1)');
    expect(an).toContain('content: formContent.trim()');
    const change = read('utils/agency-send-change.ts');
    expect(change.indexOf('prepareAgencyCopy(')).toBeLessThan(change.indexOf('buildSlotPlan(body)'));
    expect(change).toContain("{ forceContent: true, contentOnly: true }");
    expect(read('utils/agency-send-worker.ts')).toContain('const refinedText = cleanSmsTextAll(refined.content);');
    expect(read('routes/agency-send.ts')).toContain('}, client, { ...pre, charNotes: analysis.charNotes });');
    expect(read('utils/agency-send-mail-worker.ts')).toContain('}, txClient, { ...pres[i], charNotes: p.analysis.charNotes });');
    // 정리 알림 = 서버가 만든 사전값만(화면 요청 본문의 charNotes 는 받지 않는다 · 승인 요청 문자 줄에 실린다)
    expect(core).toContain('mergeAgencyCharNotes(pre?.charNotes, prep.notes)');
    expect(core).not.toContain('input?.charNotes');
  });
  it('사람 글 저장 자리가 관문을 부른다(소스)', () => {
    const op = read('utils/continuous-operator.ts');
    expect(sliceFn(op, 'export async function registerOperator(', 'export async function updateOperator(')).toContain('assertSmsTextSendable(');
    expect(sliceFn(op, 'export async function updateOperator(', '\n}\n')).toContain('assertSmsTextSendable(');
    expect(sliceFn(op, 'export function normalizeFixedCopyInput(', '\n}\n')).toContain('assertSmsTextSendable(');
    const ap = sliceFn(op, 'export async function approveProposal(', 'export async function recheckOpenProposals(');
    expect(ap.indexOf('smsTextBlockReason(')).toBeLessThan(ap.indexOf("'{approvedFp}'"));
    expect(ap.indexOf('approvedFinal.charIssue')).toBeLessThan(ap.indexOf("'{approvedFp}'"));
    const rt = sliceFn(op, 'export async function startProposalSpamRetest(', 'async function runProposalSpamRetest(');
    expect(rt.indexOf('smsTextBlockReason(')).toBeLessThan(rt.indexOf("'{spamRetest}'"));
    const ac = read('routes/auto-campaigns.ts');
    expect(sliceFn(ac, "router.put('/:id', async", "router.put('/:id/generated-message'")).toContain('smsTextBlockReason(');
    expect(sliceFn(ac, "router.put('/:id/generated-message'", 'router.post(')).toContain('smsTextBlockReason(');
    expect(sliceFn(read('utils/planner-event.ts'), 'export async function savePlannerEvent(', "await client.query('BEGIN');")).toContain('smsTextBlockReason(');
    expect(sliceFn(read('utils/planner-copy.ts'), 'export async function editPlannerCopy(', 'export async function runPlannerCopyPass(')).toContain('smsTextBlockReason(');
  });
  it('CT-J10 = 막음 글자만 UNSUPPORTED_CHARS(뺌 · 바꿈 글자는 0 · 발송 정리가 고친다)', () => {
    const ctx = { knownVarNames: new Set<string>(['이름']), cartJourney: false };
    const blk = journeyCopyIssue({ bodies: ['%이름%님 café 오세요'], subjects: [null] }, ctx);
    expect(blk?.code).toBe('UNSUPPORTED_CHARS');
    expect(blk?.message).toBe("문자로 보낼 수 없는 글자가 있어요: 본문 '이름%님 caf' 뒤 보낼 수 없는 글자(U+00E9). 그 글자를 빼거나 바꿔 주세요.");   // 앞 글자 = 보낼 수 있는 글자 최대 8자
    expect(journeyCopyIssue({ bodies: ['%이름%님 😊 오세요​'], subjects: ['제목⭐'] }, ctx)).toBeNull();
  });
});

describe('K6(P6) 나가는 글 = 혜택 · 조립 뒤 글자 판정', () => {
  const pj = { channel: { recommended: 'LMS' }, messages: [{ body: '가을 행사 [혜택] 받으세요', subject: '가을 행사' }] };
  it('혜택에 막음 글자 → charIssue · 발송 관문은 지문과 관계없이 막는다 · 정책 사유 = 같은 문장', () => {
    const ctx = { benefit: '카페 café 쿠폰', opt080: '0801234567', callback: '0212345678' };
    const f = operatorFinalCopyAt(pj, 0, ctx)!;
    expect(f.charIssue).toBe("본문 '사 카페 caf' 뒤 보낼 수 없는 글자(U+00E9)");   // 앞 글자 = 보낼 수 있는 글자 최대 8자
    const passed = { ...pj, spamCheck: { fp: f.fingerprint }, approvedFp: f.fingerprint };
    const gate = finalCopyCleared(passed, f);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe(operatorCharsReason(f.charIssue));
    expect(decideSpamOutcome('rejected', 0, f.charIssue)).toEqual({ status: 'admin_review', autoExecuteBlocked: true, reason: operatorCharsReason(f.charIssue) });
    const clean = operatorFinalCopyAt(pj, 0, { ...ctx, benefit: '쿠폰 10%' })!;
    expect(clean.charIssue).toBeNull();
  });
  it('목록 응답 copyCheck = charIssue 를 지문보다 먼저(소스) · 시스템 재검사는 글자 문제 글을 다시 검사하지 않는다', () => {
    const op = read('utils/continuous-operator.ts');
    const list = sliceFn(op, "const copyCheck: 'passed' | 'rechecking' | 'blocked' | 'rejected'", 'return { ...mapRowToProposal(row)');
    expect(list.indexOf("send.charIssue ? 'rejected'")).toBeLessThan(list.indexOf("'passed'\n"));
    expect(op).toContain('final.placeholderLeft || final.charIssue || finalCopyCleared(pj, final).ok) continue;');
  });
});

describe('K4 자리 단위 — 검사 공용 함수를 부르는 자리마다 rejected 갈래 · 장애 안내를 부르지 않는다', () => {
  it('대행 = 반려 마감(장애 셈 0 · 장비 안내 0) · 표본 = rendered', () => {
    const w = read('utils/agency-send-worker.ts');
    const settle = sliceFn(w, 'async function settleSpamRejected(', '\n}\n');
    expect(settle).not.toContain('buildTestErrorNotify');
    expect(settle).not.toContain("'spam_check_error'");
    expect(settle).toContain('buildUnsupportedCharsNotify(');
    expect(w).toContain("if (verdict === 'rejected') { await settleSpamRejected(row, token, 'first', rejection); continue; }");
    expect(w).toContain("if (verdict === 'rejected') { await settleSpamRejected(target, token, 'final', rejection); return; }");
    expect(sliceFn(w, 'async function runSpamRound(', 'async function settleSpamCheckError(')).toContain('rendered: true,');
  });
  it('플래너 실행 · 검토 · 재확인 · 사전 준비 = 반려 갈래(장비 문구 0)', () => {
    const ex = read('utils/planner-executor.ts');
    const branch = sliceFn(ex, "if (check.verdict === 'rejected') {", '\n  }\n');
    expect(branch).not.toContain('spamCheckDown');
    expect(branch).toContain("end('locked'");
    expect(sliceFn(read('utils/planner-review.ts'), "if (check.verdict === 'rejected') {", "return 'fail';")).toContain("status: 'locked'");
    expect(read('utils/planner-recheck.ts')).toContain("if (check.verdict === 'rejected') {");
    expect((read('utils/planner-copy.ts').match(/plannerCharsReason\(spamRejectionPlaces\(check\.rejection\), 'prepare'\)/g) || []).length).toBe(2);
  });
  it('여정 사전 검사 = 장애 기록 + 경보 · held 0 · 검사 입력 = 렌더 뒤 정리 + rendered', () => {
    const n = read('utils/journey-pretest-notifier.ts');
    expect((n.match(/alertPretestRejected\(b, /g) || []).length).toBe(3);
    const weekly = sliceFn(n, "if (verdict === 'rejected') alertPretestRejected(b, tests.map((t) => t.error)", 'await holdCurrent(b, summary, snapId, body);');
    expect(weekly).toContain("if (verdict === 'error' || verdict === 'rejected') { await recordIfCurrent(b, snapId, { status: 'error', noticeDone: true }); return; }");
    const v = read('utils/journey-pretest-validator.ts');
    const inp = sliceFn(v, 'async function stepSpamInput(', '\n}\n');
    expect(inp).toContain('const message = cleanSmsTextAll(rendered.message);');
    expect(inp).toContain('rendered: true,');
  });
  it('자동 마케팅 = 판정 + 사유 한 값으로 저장하는 자리(회차 결과 · 화면 검사 · 직접 쓴 문안 · 시스템 재검사)', () => {
    const op = read('utils/continuous-operator.ts');
    expect(op).toContain('index: idx, ...toSpamCheckRecord(v as any), regenerated');
    expect(op).toContain("...toSpamCheckRecord(result === 'rejected' ? { spamResult: 'rejected', rejection } : result), carriers");
    expect(op).toContain('async function recordFixedCopySpam(operatorId: string, hash: string, record: SpamCheckRecord)');
    expect(op).toContain("? { result: 'rejected', rejection: spamRejectionOf(check.variant) }");
    expect(read('utils/auto-campaign-worker.ts')).toContain('spamCheck: toSpamCheckRecord(finalVariant)');
  });
});
