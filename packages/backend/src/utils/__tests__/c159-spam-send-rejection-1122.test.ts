// replaces: none
/**
 * C159 접수 거절 사유를 스팸 검사를 쓰는 전 기능에 표시(★ 2026-11-22 · 설계서 docs/2026-11-22-c159-spam-send-rejection-all-flows-design.md)
 *   C158 은 대행발송에서만 접수 거절(차단된 URL 9407 등)을 반려 + 사유로 바꿨다. 같은 판정을 자동 검사 공용 입구 · 여정 · AI 한줄로 칩으로 넓힌다.
 *   K1 판정 = 결과 행 전부가 접수 거절일 때만(설계 Codex 1R #1) · 반려 문장의 정본 꼴과 사유 뽑기
 *   K2 공용 검사 고리 둘 = 등록 성공 뒤의 반려도 사유를 안별 결과까지 싣는다(설계 Codex 1R #2)
 *   K3 말하는 자리 = 글자 반려 문장은 그대로 · 접수 거절은 사유(자동마케팅 · 보류 회복 · 플래너)
 *   K4 화면 = 칩 · 안내 줄 · 서버 머리의 거울
 *   K5 배선(구문 트리) = 판정을 부르는 자리 다섯 · 값 범위 무변경 · 반려를 글자 문장으로 고정해 말하는 자리 0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { stripComments } from './helpers/producer-scan';
import { gatewayRejectionReason } from '../sms-result-map';
import {
  SPAM_REJECTED_PREFIX, SPAM_REJECTED_DEFAULT_TEXT, SPAM_SEND_REJECTED_PREFIX, sendRejectionText, spamSendRejectionReason, isCharsRejection,
  runSpamVariantWithRegenerate, sequenceSpamVariants, spamVerdictOf, spamRejectionOf, toSpamCheckRecord,
} from '../spam-test-queue';
import { decideSpamOutcome, operatorCharsReason, operatorRejectedReason, heldRejectedNotice, refreshHeldResults } from '../continuous-operator-policy';
import { plannerCharsReason, plannerSendRejectedReason } from '../planner-reasons';
import { plannerRejectedReason, plannerViewRejectedReason } from '../planner-copy';
import { SEND_REJECTED_PREFIX, isSendRejectionText, sendRejectionReasonOf } from '../../../../frontend/src/utils/ai-line';
import { askSpamNote } from '../../../../frontend/src/utils/ai-ask';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => read(join(BE, rel));
const fe = (rel: string) => read(join(FE, rel));
function sourceFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => /\.tsx?$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.(test|spec|verify)\.tsx?$/.test(f) && !/(^|\/)(dist|dist-old|node_modules)\//.test(f));
}
/** 함수 선언 본문 글(구문 트리 · 주석 뺌) */
function fnBody(rel: string, name: string): string {
  const src = be(rel);
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
  let out = '';
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) out = n.body.getText(sf);
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return stripComments(out);
}

/** 1122 운영 꼴 = 차단된 주소로 접수 거절된 검사의 반려 문장 */
const URL_REASON = '문안에 든 주소(URL)가 발송 차단 대상';
const URL_REJECTION = '검사 문자를 보내지 못했어요: 문안에 든 주소(URL)가 발송 차단 대상.';
const CHARS_REJECTION = `${SPAM_REJECTED_PREFIX}: 2번째 줄`;   // 등록 반려가 실제로 만드는 꼴(위치 뒤에 마침표 없음 · spam-test-queue enqueueSpamTest)
const FAILED3 = ['SKT', 'KT', 'LGU'].map((carrier) => ({ carrier, messageType: 'LMS', result: 'failed' }));

describe('K1 판정 = 결과 행 전부가 접수 거절일 때만 · 반려 문장의 정본 꼴', () => {
  it('세 통신사 행이 모두 발송 실패 · 9407 = 사유(1122 운영 꼴)', () => {
    expect(gatewayRejectionReason([{ failed: true, code: 9407 }, { failed: true, code: 9407 }, { failed: true, code: 9407 }])).toBe(URL_REASON);
  });
  it('통과 · 시간 초과 · 확인 중 행이 하나라도 있으면 null(늦게 도착할 수 있는 문자가 남은 검사를 접수 거절로 굳히지 않는다)', () => {
    expect(gatewayRejectionReason([{ failed: true, code: 9407 }, { failed: false }, { failed: true, code: 9407 }])).toBeNull();
    expect(gatewayRejectionReason([{ failed: true, code: 9407 }, { failed: false, code: null }])).toBeNull();
    expect(gatewayRejectionReason([])).toBeNull();
    expect(gatewayRejectionReason([{ failed: true, code: null }])).toBeNull();          // 큐 행을 못 읽음
    expect(gatewayRejectionReason([{ failed: true, code: 9407 }, { failed: true, code: 9409 }])).toBeNull();   // 문안 탓이 아닌 거절이 섞임
    expect(gatewayRejectionReason([{ failed: true, code: 4000 }])).toBeNull();          // 통신사 실패
  });
  it('정본 문장 = 머리 + 「: 」 + 사유 + 「.」 · 사유 뽑기는 그 꼴에서만 · 글자 반려와 섞이지 않는다', () => {
    expect(SPAM_SEND_REJECTED_PREFIX).toBe('검사 문자를 보내지 못했어요');
    expect(sendRejectionText(URL_REASON)).toBe(URL_REJECTION);
    expect(spamSendRejectionReason(URL_REJECTION)).toBe(URL_REASON);
    expect(spamSendRejectionReason(CHARS_REJECTION)).toBe('');
    expect(spamSendRejectionReason(null)).toBe('');
    expect(isCharsRejection(URL_REJECTION)).toBe(false);
    expect(isCharsRejection(CHARS_REJECTION)).toBe(true);
    expect(isCharsRejection(SPAM_REJECTED_DEFAULT_TEXT)).toBe(true);
  });
});

describe('K2 공용 검사 고리 둘 = 등록 성공 뒤의 반려 사유가 안별 결과까지 간다', () => {
  /** 접수 거절로 닫힌 검사를 돌려주는 가짜 검사(등록은 성공) */
  const rejectedTest = () => {
    const calls: string[] = [];
    const run = async (id: string) => { calls.push(id); return { enqueued: true, spamResult: 'rejected', carrierResults: FAILED3, rejection: URL_REJECTION }; };
    return { run, calls };
  };
  it('안마다 도는 고리 — 반려 + 사유 그대로(기본 글자 문장으로 덮이지 않는다) · 다시 검사 · 재생성 0', async () => {
    const t = rejectedTest();
    let regen = 0;
    const out = await runSpamVariantWithRegenerate({
      variant: { variantId: 'A', messageText: '겨울 세일 https://bit.ly/x' }, maxRetries: 2, runTest: t.run,
      regenerate: async () => { regen += 1; return { messageText: '다른 글' }; },
    });
    expect(out.result.spamResult).toBe('rejected');
    expect(out.result.rejection).toBe(URL_REJECTION);
    expect(out.result.carrierResults).toEqual(FAILED3);
    expect(t.calls).toEqual(['A']);
    expect(regen).toBe(0);
    expect(out.regenerateCount).toBe(0);
    // 판정 · 사유 읽기 · 저장 꼴이 그 값을 그대로 낸다(소비처가 읽는 길)
    expect(spamVerdictOf(out.result, 1)).toBe('rejected');
    expect(spamRejectionOf(out.result)).toBe(URL_REJECTION);
    expect(toSpamCheckRecord(out.result)).toEqual({ result: 'rejected', rejection: URL_REJECTION });
  });
  it('안마다 도는 고리 — 옛 갈래 그대로: 등록 실패의 글자 반려 = 그 문장 · 차단 뒤 재생성해 통과 = 사유 없음(앞 회차 사유가 남지 않는다)', async () => {
    const chars = await runSpamVariantWithRegenerate({
      variant: { variantId: 'A', messageText: '글' }, maxRetries: 0,
      runTest: async () => ({ enqueued: false, spamResult: 'rejected', carrierResults: [], rejection: CHARS_REJECTION }),
    });
    expect(chars.result.spamResult).toBe('rejected');
    expect(chars.result.rejection).toBe(CHARS_REJECTION);
    let n = 0;
    const regen = await runSpamVariantWithRegenerate({
      variant: { variantId: 'B', messageText: '첫 글' }, maxRetries: 1,
      runTest: async () => { n += 1; return n === 1 ? { enqueued: true, spamResult: 'blocked', carrierResults: [] } : { enqueued: true, spamResult: 'pass', carrierResults: [] }; },
      regenerate: async () => ({ messageText: '고친 글' }),
    });
    expect(regen.result.spamResult).toBe('pass');
    expect(regen.result.rejection).toBeUndefined();
    expect(regen.result.messageText).toBe('고친 글');
    expect(regen.regenerateCount).toBe(1);
  });
  it('첫 통과에서 멈추는 고리 — 반려 + 사유 그대로 · 다음 안은 이어서 검사한다', async () => {
    const seq = await sequenceSpamVariants({
      variants: [{ variantId: 'A', messageText: '주소가 든 글' }, { variantId: 'B', messageText: '주소가 없는 글' }],
      maxRetries: 0,
      runTest: async (v) => (v.variantId === 'A'
        ? { spamResult: 'rejected', carrierResults: FAILED3, rejection: URL_REJECTION }
        : { spamResult: 'pass', carrierResults: [] }),
    });
    expect(seq.variants[0].spamResult).toBe('rejected');
    expect(seq.variants[0].rejection).toBe(URL_REJECTION);
    expect(seq.passedVariantId).toBe('B');
  });
});

describe('K3 말하는 자리 = 글자 반려 문장은 그대로 · 접수 거절은 사유', () => {
  it('자동마케팅 제안 사유 · 다시 검사 사유', () => {
    expect(operatorRejectedReason(URL_REJECTION)).toBe('검사 문자를 보내지 못했어요: 문안에 든 주소(URL)가 발송 차단 대상. 문안을 고쳐 주세요');
    expect(operatorRejectedReason(CHARS_REJECTION)).toBe('문자로 보낼 수 없는 글자가 있어 검사하지 못했어요: 2번째 줄. 문안에서 그 글자를 빼 주세요');
    expect(operatorRejectedReason(CHARS_REJECTION)).toBe(operatorCharsReason('2번째 줄'));
    expect(operatorRejectedReason(null)).toBe(operatorCharsReason(null));
    // 회차 판정: 접수 거절 = 담당자 검토 + 사유 · 글자 반려 = 옛 문장 그대로(넷째 인자가 없던 옛 호출도 그대로)
    expect(decideSpamOutcome('rejected', 0, '', URL_REJECTION)).toEqual({ status: 'admin_review', autoExecuteBlocked: true, reason: '검사 문자를 보내지 못했어요: 문안에 든 주소(URL)가 발송 차단 대상. 문안을 고쳐 주세요' });
    expect(decideSpamOutcome('rejected', 0, '2번째 줄', CHARS_REJECTION).reason).toBe(operatorCharsReason('2번째 줄'));
    expect(decideSpamOutcome('rejected', 0, '2번째 줄').reason).toBe(operatorCharsReason('2번째 줄'));
  });
  it('자동마케팅 보류 회복 — 사유는 안에 붙는다: 앞 안 차단 + 뒤 안 접수 거절 = 차단 그대로 · 뒤 안 = 반려 + 사유(검사 중으로 남지 않는다)', () => {
    const held = [
      { index: 0, testId: 't-a', fp: 'fa', result: 'blocked' },
      { index: 1, testId: 't-b', fp: 'fb', result: 'pending' },
      { index: 2, testId: 't-c', fp: 'fc', result: 'pending' },
      { index: 3, fp: 'fd', result: 'pending' },   // 검사 번호 없는 안 = 손대지 않는다
    ];
    const out = refreshHeldResults(held, [
      { testId: 't-a', outcome: 'blocked', rejection: null },
      { testId: 't-b', outcome: 'error', rejection: URL_REJECTION },
      { testId: 't-c', outcome: 'error', rejection: null },   // 사유 없는 장애 = 종전 값 그대로
    ]);
    expect(out).toEqual([
      { index: 0, testId: 't-a', fp: 'fa', result: 'blocked' },
      { index: 1, testId: 't-b', fp: 'fb', result: 'rejected', rejection: URL_REJECTION },
      { index: 2, testId: 't-c', fp: 'fc', result: 'pending' },
      { index: 3, fp: 'fd', result: 'pending' },
    ]);
    // 옛 호출(사유 칸 없음) = 옛 결과 그대로
    expect(refreshHeldResults(held, [{ testId: 't-b', outcome: 'pass' }])?.[1]).toEqual({ index: 1, testId: 't-b', fp: 'fb', result: 'pass' });
    // 결말이 「결과를 받지 못함」이고 반려 안이 있을 때의 회차 안내
    expect(heldRejectedNotice('겨울 재구매', URL_REJECTION)).toBe("'겨울 재구매' 이번 회차 문안의 검사 문자를 보내지 못해 담당자 검토로 두었어요: 문안에 든 주소(URL)가 발송 차단 대상. 문안을 고친 뒤 제안 상세에서 승인해 주세요. 자동마케팅은 그대로 돌아가요.");
  });
  it('보류 회복 본문 — 종결할 때 안마다 판정하고(기다리는 회차는 건너뛴 뒤) 안별 결과를 종결 표식과 같이 저장한다 · 결말의 차례는 그대로', () => {
    const body = fnBody('utils/continuous-operator.ts', 'recoverHeldProposals');
    const wait = body.indexOf('if (waiting && !old) continue;');
    const judge = body.indexOf('spamGatewayRejectionOf(x.testId)');
    const result = body.indexOf("const result = waiting ? 'late' : read.some((x) => x.outcome === 'blocked') ? 'blocked' : 'error';");
    expect(wait).toBeGreaterThan(-1);
    expect(judge).toBeGreaterThan(wait);          // 기다리는 회차에서는 큐 표를 읽지 않는다
    expect(result).toBeGreaterThan(judge);        // 결말의 차례 식은 한 글자도 안 바뀌었다
    expect(body).toMatch(/refreshHeldResults\(row\.sc\?\.results, settledRead\)/);
    expect(body).toMatch(/\}, query, settledResults\)\) out\.settled\+\+;/);
    expect(body).toMatch(/result === 'error' && heldRejection[\s\S]*heldRejectedNotice\(name, heldRejection\)/);
  });
  it('플래너 — 발송 당일 · 준비 문장', () => {
    expect(plannerRejectedReason(URL_REJECTION, 'send')).toBe('검사 문자를 보내지 못해 오늘 발송을 보류했습니다: 문안에 든 주소(URL)가 발송 차단 대상. 문안을 고쳐 주세요.');
    expect(plannerRejectedReason(URL_REJECTION, 'prepare')).toBe('검사 문자를 보내지 못해 문안을 준비하지 못했습니다: 문안에 든 주소(URL)가 발송 차단 대상. 혜택 문구나 문안을 고쳐 주세요.');
    expect(plannerSendRejectedReason(URL_REASON, 'send')).toBe(plannerRejectedReason(URL_REJECTION, 'send'));
    // 글자 반려 = 옛 문장 그대로
    expect(plannerRejectedReason(CHARS_REJECTION, 'send')).toBe('문자로 보낼 수 없는 글자가 있어 오늘 발송을 보류했습니다: 2번째 줄. 문안에서 그 글자를 빼 주세요.');
    expect(plannerRejectedReason(CHARS_REJECTION, 'prepare')).toBe(plannerCharsReason('2번째 줄', 'prepare'));
    expect(plannerRejectedReason(SPAM_REJECTED_DEFAULT_TEXT, 'send')).toBe(plannerCharsReason('', 'send'));
  });
  it('재확인 보기에 싣는 사유 = 고정 문장만(구현 Codex 1R) — 글자 반려의 위치 문장(표본 고객 값이 섞일 수 있다)은 나가지 않는다', () => {
    // 검사 글 = 표본 고객 값으로 치환한 글 → 위치 문장에 「문제 글자 앞 글」로 고객 이름이 들어갈 수 있다
    const withName = `${SPAM_REJECTED_PREFIX}: 본문 1번째 줄 「김합성님, 」 뒤`;
    const view = plannerViewRejectedReason(withName, 'prepare');
    expect(view).toBe('문자로 보낼 수 없는 글자가 있어 문안을 준비하지 못했습니다. 혜택 문구나 문안에서 그 글자를 빼 주세요.');
    expect(view).not.toContain('김합성');
    expect(plannerRejectedReason(withName, 'prepare')).toContain('김합성');   // 로그인한 담당자 화면의 사유(옛 그대로)에는 위치가 있다
    // 접수 거절 = 사유 표의 문장 · 모르는 꼴의 반려 문장 = 싣지 않는다
    expect(plannerViewRejectedReason(URL_REJECTION, 'prepare')).toBe('검사 문자를 보내지 못해 문안을 준비하지 못했습니다: 문안에 든 주소(URL)가 발송 차단 대상. 혜택 문구나 문안을 고쳐 주세요.');
    expect(plannerViewRejectedReason('홍길동님의 글이 90바이트를 넘어요', 'prepare')).toBeNull();
  });
  it('새 고객 문장에 우리 쪽 원인 단정 · 검사 방식 낱말 · 줄표 0', () => {
    const lines = [
      URL_REJECTION, operatorRejectedReason(URL_REJECTION), heldRejectedNotice('이름', URL_REJECTION),
      plannerRejectedReason(URL_REJECTION, 'send'), plannerRejectedReason(URL_REJECTION, 'prepare'),
    ];
    for (const l of lines) expect(l).not.toMatch(/장비|장애|시스템|오류|게이트웨이|링크가드|9407|—|–/);
  });
});

describe('K4 화면 = 칩 · 안내 줄 · 서버 머리의 거울', () => {
  it('화면의 머리 글 = 서버의 머리 글(글자 그대로) · 사유 뽑기', () => {
    expect(SEND_REJECTED_PREFIX).toBe(SPAM_SEND_REJECTED_PREFIX);
    expect(isSendRejectionText(URL_REJECTION)).toBe(true);
    expect(isSendRejectionText(operatorRejectedReason(URL_REJECTION))).toBe(true);   // 제안 카드가 다시 검사 사유로 가른다
    expect(isSendRejectionText(operatorRejectedReason(CHARS_REJECTION))).toBe(false);
    expect(isSendRejectionText(undefined)).toBe(false);
    expect(sendRejectionReasonOf(URL_REJECTION)).toBe(URL_REASON);
    expect(sendRejectionReasonOf(CHARS_REJECTION)).toBe('');
    expect(sendRejectionReasonOf(sendRejectionText(URL_REASON))).toBe(spamSendRejectionReason(sendRejectionText(URL_REASON)));
  });
  it('한 줄로 묻기 안내 줄 — 접수 거절이면 사유 · 실제 발송도 막힌다는 것 · 그 밖 warn 은 옛 문장', () => {
    const fp = 'fp-1';
    expect(askSpamNote({ state: 'warn', fp, message: URL_REJECTION }, fp)).toBe('도착 확인 문자를 보내지 못했어요: 문안에 든 주소(URL)가 발송 차단 대상. 그대로 보내면 발송에서도 막혀요.');
    expect(askSpamNote({ state: 'warn', fp }, fp)).toBe('도착 확인 결과를 아직 받지 못한 통신사가 있어요.');
    expect(askSpamNote({ state: 'checking', fp, message: URL_REJECTION }, fp)).toBe('도착 확인 결과를 아직 받지 못한 통신사가 있어요.');
    // 글이 바뀌었으면(지문 다름) 옛 검사의 사유를 말하지 않는다
    expect(askSpamNote({ state: 'warn', fp: 'other', message: URL_REJECTION }, fp)).toBe('이 글로는 도착 확인을 하지 않았어요.');
  });
  it('카드 칩 · 발송 확인 창 · 제안 카드 · 재확인 판이 그 값을 쓴다', () => {
    const cards = fe('components/ai-line/LineResultCards.tsx');
    // 칩 = 짧은 글(줄바꿈 없는 알약 · 폭 320 에서 넘치지 않게) · 사유 = 카드 아래 한 줄
    expect(cards).toMatch(/case 'warn': if \(sendRejectionReasonOf\(chip\.message\)\) return \{[^}]*text: '보내지 못했어요', note: `\$\{sendRejectionReasonOf\(chip\.message\)\}\. 문안을 고친 뒤 다시 검사해 주세요\.` \};/);
    expect(cards).toMatch(/\{view\.note && \(\s*<p className="[^"]*break-keep">\{view\.note\}<\/p>\s*\)\}/);
    expect(cards).toMatch(/\.\.\.\(r\.rejection \? \{ message: r\.rejection \} : \{\}\)/);
    const line = fe('pages/AiLinePage.tsx');
    const warnAt = line.indexOf("if (chip.state === 'warn' && sendRejectionReasonOf(chip.message))");
    expect(warnAt).toBeGreaterThan(-1);
    expect(line.indexOf("if (chip.state === 'warn') return '스팸 검사 결과를 받지 못했어요.", warnAt)).toBeGreaterThan(warnAt);   // 사유가 먼저
    expect(fe('components/automarketing/ProposalDecisionCard.tsx')).toMatch(/proposal\.copyCheck === 'rejected' && isSendRejectionText\(proposal\.copyCheckReason\)/);
    expect(fe('components/admin/ProposalTrialTab.tsx')).toMatch(/rejected: '보낼 수 없는 글',/);
    const panel = fe('components/planner/PlannerRecheckPanel.tsx');
    expect(panel).toMatch(/key === 'proposal' \? view\.proposal\.reason : view\.current\.reason/);
  });
});

describe('K5 배선 = 판정을 부르는 자리 다섯 · 값 범위 무변경 · 글자 문장 고정 0', () => {
  it('판정 함수(spamGatewayRejectionOf)를 부르는 자리 = 다섯(공용 입구 · 대행 보류 갈래 · 자동마케팅 보류 회복 · 여정 기다림 · 칩 보기)', () => {
    const hits: string[] = [];
    for (const f of sourceFiles(BE)) {
      const code = stripComments(read(join(BE, f)));
      const n = (code.match(/spamGatewayRejectionOf\(/g) || []).length - (/export async function spamGatewayRejectionOf\(/.test(code) ? 1 : 0);
      for (let i = 0; i < n; i++) hits.push(f);
    }
    expect(hits.sort()).toEqual([
      'utils/agency-send-worker.ts', 'utils/continuous-operator.ts', 'utils/journey-pretest-validator.ts', 'utils/spam-test-queue.ts', 'utils/spam-test-view.ts',
    ]);
    expect(fnBody('utils/agency-send-worker.ts', 'sendRejectionOfTests')).toMatch(/spamGatewayRejectionOf\(/);
    expect(fnBody('utils/journey-pretest-validator.ts', 'pollSpamResult')).toMatch(/outcome === 'error' \? await spamGatewayRejectionOf\(testId\) : null/);
    expect(fnBody('utils/spam-test-view.ts', 'spamCheckView')).toMatch(/state === 'warn' \? await spamGatewayRejectionOf\(testId\) : null/);
  });
  it('공용 입구 = 검사 완료 판정이 failed 일 때만 읽고 반려 + 사유로 돌려준다 · 대행의 「검사 뒤 장애」 자리에는 자체 읽기가 없다', () => {
    const q = stripComments(be('utils/spam-test-queue.ts'));
    expect(q).toMatch(/if \(verdict === 'failed'\) \{\s*const sendRejection = await spamGatewayRejectionOf\(enqueueResult\.testId!\);\s*if \(sendRejection\) return \{ enqueued: true, spamResult: 'rejected', carrierResults, rejection: sendRejection \};/);
    const round = fnBody('utils/agency-send-worker.ts', 'runSpamRound');
    expect(round).toContain("if (verdict === 'error') return { verdict, passed: false, finalContent: original, rounds, detail };");
    expect(round.match(/sendRejectionOfTests\(/g)?.length).toBe(1);   // 보류 묶음 갈래 하나
  });
  it('판정 함수 = 결과 행 전부를 읽고(실패 행만이 아니다) 실패가 아닌 행이 있으면 큐 표를 읽지 않는다', () => {
    const body = fnBody('utils/spam-test-queue.ts', 'spamGatewayRejectionOf');
    expect(body).toMatch(/FROM spam_filter_test_results WHERE test_id = \$1`/);
    expect(body).not.toMatch(/AND result = \$2/);
    const guard = body.indexOf('rows.rows.some((r: any) => r.result !== SPAM_RESULT.FAILED)) return null;');
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf('fetchSpamQtmsgRows(testId)')).toBeGreaterThan(guard);
    expect(body).toMatch(/return reason \? sendRejectionText\(reason\) : null;/);
  });
  it('값 범위 무변경 — 저장된 검사를 읽는 함수는 큐 표를 읽지 않는다(재사용 · 엿보기 · 회복이 쓰는 값 그대로)', () => {
    for (const fn of ['readSpamTestOutcome', 'spamTestOutcomeOf', 'spamCheckFor']) {
      const body = fnBody('utils/spam-test-queue.ts', fn);
      expect(body, fn).not.toMatch(/spamGatewayRejectionOf|fetchSpamQtmsgRows|mysqlQuery/);
    }
    expect(fnBody('utils/spam-test-queue.ts', 'spamTestOutcomeOf')).toContain("return results.every((r) => r.result === SPAM_RESULT.PASS) ? 'pass' : 'error';");
  });
  it('칩 보기 = 접수 거절이면 늦은 보고 창을 열지 않는다(이어 읽기 · 같은 날 재사용에 묶지 않는다)', () => {
    const body = fnBody('utils/spam-test-view.ts', 'spamCheckView');
    expect(body).toContain("lateOpen: state === 'warn' && !rejection ? (await readSpamTestOutcome(testId)).lateOpen : false,");
    expect(body).toContain('...(rejection ? { rejection } : {}),');
  });
  it('반려를 말하는 자리가 글자 문장으로 고정해 말하지 않는다 — 플래너 · 자동마케팅 모두 가르는 함수 하나를 지난다', () => {
    for (const f of ['planner-copy.ts', 'planner-executor.ts', 'planner-recheck.ts', 'planner-review.ts']) {
      const code = stripComments(be(`utils/${f}`));
      expect(code, f).not.toMatch(/plannerCharsReason\(spamRejectionPlaces\(check\.rejection\)/);
      expect(code, f).toMatch(/plannerRejectedReason\(check\.rejection, '(send|prepare)'\)/);
    }
    const op = stripComments(be('utils/continuous-operator.ts'));
    expect(op).not.toMatch(/operatorCharsReason\([^)]*spamRejectionPlaces\(/);
    expect(op).toContain('decideSpamOutcome(finalResult, regenCount, spamRejectionPlaces(rejection), rejection)');
    expect(op).toMatch(/operatorRejectedReason\(typeof recheck\?\.rejection === 'string' \? recheck\.rejection : null\)/);
    // 사유 사전은 순수 모듈 그대로(검사 · DB 모듈을 불러오지 않는다)
    expect(be('utils/planner-reasons.ts')).not.toMatch(/from '\.\/spam-test-queue'|from '\.\.\/config\/database'/);
  });
  it('플래너 재확인 — 새 문안이 반려면 사유를 남기고 · 고친 글의 반려 사유만 보기에 싣는다(차단 · 그 밖 실패 = null)', () => {
    const src = stripComments(be('utils/planner-recheck.ts'));
    expect(src).toContain("if (check.verdict === 'rejected') proposalReason = plannerViewRejectedReason(check.rejection, 'prepare');");
    expect(src).toContain('proposalError, proposalReason, proposalDraft: null');
    // 보기에 나가는 값 = 고정 문장(viewReason) · 위치 문장(copy_error.reason)은 보기 함수가 읽지 않는다(구현 Codex 1R)
    expect(src).toContain("viewReason: plannerViewRejectedReason(check.rejection, 'prepare') } });");
    const viewFn = fnBody('utils/planner-recheck.ts', 'copyRejectedReason');
    expect(viewFn).toMatch(/e\.viewReason/);
    expect(viewFn).not.toMatch(/e\.reason\b/);
    expect(src).toContain("reason: curState === 'fail' ? copyRejectedReason(p) : null");
    expect(src).toContain("reason: prState === 'failed' ? (p.recheck.proposalReason || null) : null");
  });
  it('여정 — 접수 거절 경보는 코드 회귀 문구를 쓰지 않는다 · 켜기 검증은 사유를 그대로 싣는다', () => {
    const body = fnBody('utils/journey-pretest-notifier.ts', 'alertPretestRejected');
    expect(body).toMatch(/const send = !isCharsRejection\(rejection\);/);
    expect(body).toMatch(/send\s*\?\s*'여정 발송 전 검사 문자가 접수 거절됐습니다\(그 칸 문안의 주소 · 길이 확인 필요\)\.'/);
    expect(stripComments(be('utils/journey-pretest-validator.ts'))).toMatch(/\.\.\.\(spamScore\.error \? \{ error: spamScore\.error \} : \{\}\)/);
  });
});
