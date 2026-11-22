// replaces: none
/**
 * C158 대행발송 — 검사 문자가 접수 거절(차단된 URL)됐는데 「검사 장비 문제」로 읽던 판정 · 문구(★ 2026-11-22)
 *   운영 실측(1122 · 96,866건 LMS · 12:00 발송 건): 검사 문자 9행 전부 결과 코드 9407(차단된 URL · MySQL 실측) → 결과 표 failed → 판정 error →
 *   10:04 · 10:24 · 10:44 세 번 재검사 뒤 「장비 문제 · 문안 문제는 아닙니다」 문자 · 다시 진행(11:29:56) 뒤에도 19분 대기(11:49:10 검사).
 *   K1 문안 사유 접수 거절 = 사유 문장(순수 · 코드 표) · 그 밖 = null(종전 판정)
 *   K2 대행발송 검사 회차 = 장애 갈래 앞에서 접수 거절을 반려로 · 마감이 글자 반려와 접수 거절을 가른다
 *   K3 고객이 읽는 글에 「장비 문제」 0(기계 추출 · 백엔드 + 화면 전 소스)
 *   K4 사람이 다시 진행 · 문안을 고치면 장애 셈 · 대기를 새로(조각 한 곳)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { stripComments } from './helpers/producer-scan';
import { GATEWAY_CONTENT_REJECT_TEXT, GATEWAY_REJECT_CODES, gatewayRejectionFromCodes } from '../sms-result-map';
import { SPAM_REJECTED_PREFIX, SPAM_REJECTED_DEFAULT_TEXT, isCharsRejection } from '../spam-test-queue';
import { buildTestErrorNotify, buildSendRejectedNotify, buildUnsupportedCharsNotify } from '../agency-send-notify';
import { unrecoveredSpamErrorSql } from '../agency-send-worker';

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

describe('K1 문안 사유 접수 거절 = 사유 문장', () => {
  it('1122 운영 꼴 = 세 통신사 행이 모두 9407 → 주소가 차단 대상이라는 사유', () => {
    const why = gatewayRejectionFromCodes([9407, 9407, 9407]);
    expect(why).toBe('문안에 든 주소(URL)가 발송 차단 대상');
  });
  it('코드를 못 읽은 행 · 문안 탓이 아닌 거절 · 통신사 실패가 섞이면 null(종전 판정 그대로)', () => {
    expect(gatewayRejectionFromCodes([])).toBeNull();
    expect(gatewayRejectionFromCodes([9407, null])).toBeNull();
    expect(gatewayRejectionFromCodes([9407, 9409])).toBeNull();   // 중복 접수 = 문안 탓 아님
    expect(gatewayRejectionFromCodes([9404])).toBeNull();          // 수신번호 형식 = 검사 번호 쪽
    expect(gatewayRejectionFromCodes([4000, 4000, 4000])).toBeNull(); // 전송 시간 초과 = 통신사
  });
  it('사유 표의 코드는 전부 접수 거절 코드 안 · 사유 글에 우리 쪽 원인 말 0', () => {
    for (const [code, text] of Object.entries(GATEWAY_CONTENT_REJECT_TEXT)) {
      expect(GATEWAY_REJECT_CODES).toContain(Number(code));
      expect(text).toMatch(/^문안/);
      expect(text).not.toMatch(/장비|장애|오류|시스템/);
    }
    expect(Object.keys(GATEWAY_CONTENT_REJECT_TEXT).map(Number).sort()).toEqual([9401, 9402, 9407]);
  });
  it('글자 반려 문장인가 — 머리가 글자 반려 문장일 때만(사유가 비면 옛 기본 = 글자 반려)', () => {
    expect(isCharsRejection(`${SPAM_REJECTED_PREFIX}: 3번째 줄`)).toBe(true);
    expect(isCharsRejection(SPAM_REJECTED_DEFAULT_TEXT)).toBe(true);
    expect(isCharsRejection(null)).toBe(true);
    expect(isCharsRejection('문안에 든 주소(URL)가 발송 차단 대상')).toBe(false);
  });
});

describe('K2 대행발송 — 접수 거절 = 반려(다시 검사 0 · 사유를 알린다)', () => {
  it('검사 회차가 장애로 끝내기 전에 접수 거절 사유를 읽고, 있으면 반려로 돌려준다', () => {
    const body = fnBody('utils/agency-send-worker.ts', 'runSpamRound');
    const errAt = body.indexOf(`if (verdict === 'error')`);
    expect(errAt).toBeGreaterThan(-1);
    const branch = body.slice(errAt, body.indexOf(`if (verdict === 'rejected')`, errAt));
    expect(branch).toMatch(/sendRejectionOfTests\(Object\.values\(result\.testIds/);
    expect(branch).toMatch(/verdict: 'rejected'[\s\S]*rejection:/);
  });
  it('보류로 남겼다가 장애로 굳은 검사도 같은 판정을 먼저 지난다(Codex 1R #1) — 검사를 본 뒤 장애로 끝내는 두 자리가 한 곳을 부른다', () => {
    const body = fnBody('utils/agency-send-worker.ts', 'runSpamRound');
    const heldAt = body.indexOf(`held.verdict === 'error'`);
    expect(heldAt).toBeGreaterThan(-1);
    const heldBranch = body.slice(heldAt, body.indexOf('while (rounds < MAX_TEST_ROUNDS)', heldAt));
    expect(heldBranch).toMatch(/sendRejectionOfTests\(held\.testIds\)/);
    expect(heldBranch.indexOf('sendRejectionOfTests(')).toBeLessThan(heldBranch.indexOf(`verdict: 'error'`));
    expect(body.match(/sendRejectionOfTests\(/g)?.length).toBe(2);
    expect(fnBody('utils/agency-send-worker.ts', 'sendRejectionOfTests')).toMatch(/spamGatewayRejectionOf\(/);
    // 보류 판정이 읽은 검사 번호를 돌려준다(그 검사에서 사유를 읽는다)
    expect(fnBody('utils/agency-send-worker.ts', 'heldSpamBatch')).toMatch(/testIds: tests\.rows\.map/);
  });
  it('접수 거절 사유 읽기 = 큐 행 읽기 CT(폴링 · 결과 창과 같은 곳) · 못 읽으면 null', () => {
    const body = fnBody('utils/spam-test-queue.ts', 'spamGatewayRejectionOf');
    expect(body).toMatch(/fetchSpamQtmsgRows\(/);
    expect(body).toMatch(/gatewayRejectionFromCodes\(/);
    expect(body).toMatch(/catch[\s\S]*return null/);
  });
  it('마감 = 글자 반려는 옛 사건 · 옛 안내 그대로, 접수 거절은 제 사건 · 제 안내', () => {
    const body = fnBody('utils/agency-send-worker.ts', 'settleSpamRejected');
    expect(body).toMatch(/isCharsRejection\(/);
    expect(body).toMatch(/'spam_rejected_chars'/);
    expect(body).toMatch(/'spam_rejected'/);
    expect(body).toMatch(/buildUnsupportedCharsNotify\(/);
    expect(body).toMatch(/buildSendRejectedNotify\(/);
    expect(body).not.toMatch(/settleSpamCheckError\(/);   // 반려는 장애 셈 · 15분 대기에 들어가지 않는다
  });
  it('접수 거절 안내 문자 = 사유를 말한다 · 글자 반려 글 · 우리 쪽 원인 말 0', () => {
    const text = buildSendRejectedNotify({ label: '겨울 세일', reason: '문안에 든 주소(URL)가 발송 차단 대상' });
    expect(text).toContain('사유: 문안에 든 주소(URL)가 발송 차단 대상');
    expect(text).toContain('겨울 세일');
    expect(text).not.toMatch(/장비|글자|문안 문제는 아닙니다/);
    // 글자 반려 안내는 그대로(위치를 말한다)
    expect(buildUnsupportedCharsNotify({ label: '겨울 세일', places: '3번째 줄' })).toContain('위치: 3번째 줄');
  });
  it('진행 기록 화면 = 새 사건의 글이 있다(없으면 「진행 상황을 기록했습니다」로 뭉개진다)', () => {
    const log = fe('components/agency/AgencyEventLog.tsx');
    expect(log).toMatch(/spam_rejected: '/);
    expect(log).toMatch(/e\.kind === 'spam_rejected'/);
    expect(log).toMatch(/reason === 'send_rejected'/);
  });
});

describe('K3 고객이 읽는 글에 「장비 문제」 0', () => {
  it('검사를 마치지 못해 멈춘 안내 = 원인을 단정하지 않는다(장비 · 「문안 문제는 아닙니다」 0) · 다시 진행 길은 그대로', () => {
    const text = buildTestErrorNotify({ label: '겨울 세일' });
    expect(text).not.toMatch(/장비|문안 문제는 아닙니다/);
    expect(text).toContain('스팸 검사를 마치지 못해 진행을 멈췄습니다');
    expect(text).toContain('다시 진행하시면 검사를 다시 시작합니다');
  });
  it('백엔드 · 화면 전 소스의 글(주석 뺌)에 「장비 문제」 · 「검사 장비」 0', () => {
    const hits: string[] = [];
    for (const [root, tag] of [[BE, 'backend'], [FE, 'frontend']] as const) {
      for (const f of sourceFiles(root)) {
        const code = stripComments(read(join(root, f)));
        if (/장비 문제|검사 장비/.test(code)) hits.push(`${tag}/${f}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('K4 사람이 다시 진행 · 문안을 고치면 장애 셈 · 대기를 새로', () => {
  it('회복 안 된 장애 조각 = 그 장애 뒤에 사람의 다시 진행 · 문안 수정이 있으면 세지 않는다(셈 · 집기 대기가 같은 조각)', () => {
    const sql = unrecoveredSpamErrorSql('se');
    expect(sql).toMatch(/spam_check_recovered/);
    expect(sql).toMatch(/kind IN \('rescheduled', 'content_edited'\)/);
    expect(sql).toMatch(/\.id > se\.id/);
    const worker = stripComments(be('utils/agency-send-worker.ts'));
    // 셈과 집기 대기 둘 다 이 조각을 쓴다(따로 적은 자리 0)
    expect(worker.match(/spam_check_recovered/g)?.length).toBeGreaterThan(0);
    expect(fnBody('utils/agency-send-worker.ts', 'spamErrorBackoffSql')).toMatch(/unrecoveredSpamErrorSql\(/);
    expect(fnBody('utils/agency-send-worker.ts', 'countUnrecoveredSpamErrors')).toMatch(/unrecoveredSpamErrorSql\(/);
  });
  it('그 두 사건은 변경과 같은 트랜잭션에서 남는다(Codex 1R #2) — 커밋 앞 · 실패를 삼키지 않는 기록 · 커밋 뒤 기록 0', () => {
    for (const [fn, kind] of [['editAgencyContentTx', 'content_edited'], ['rescheduleAgencyRequestTx', 'rescheduled']] as const) {
      const body = fnBody('utils/agency-send-change.ts', fn);
      const at = body.indexOf(`logEventTx(client, input.requestId, '${kind}'`);
      expect(at, `${fn} 이 ${kind} 를 트랜잭션 안에서 남긴다`).toBeGreaterThan(-1);
      const commitAt = body.indexOf(`client.query('COMMIT')`, at);
      expect(commitAt, `${kind} 기록 뒤에 커밋`).toBeGreaterThan(at);
      expect(body.slice(0, at)).toMatch(/client\.query\('BEGIN'\)/);
    }
    // 실패를 삼키는 기록 함수(logEvent)로는 이 파일에서 아무 사건도 남기지 않는다
    expect(stripComments(be('utils/agency-send-change.ts'))).not.toMatch(/\blogEvent\(/);
  });
});
