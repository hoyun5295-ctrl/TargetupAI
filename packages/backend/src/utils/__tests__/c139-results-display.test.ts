/**
 * C139 — 발송결과 메시지 창 제목 + 여정 발송 건 변수 자리 표기(★ 2026-11-16 · 설계서 docs/2026-11-16-c139-results-display-design.md · 뿌리 R98)
 *
 * 기원
 *   접수 cmwilrt0m1(남지현) = 테스트발송내역에서 내용을 눌러도 제목이 안 보인다 → 발송결과의 메시지 내용 창(한 부품 · 여는 자리 넷)에 제목 자리가 없었다.
 *   접수 cmwilf3re1(임은지 · 서수란 댓글) = 여정 발송 건이 %이름% 이 아니라 한 고객 이름으로 보인다(목록 · 캘린더) →
 *     campaigns.message_content 를 다섯 생산자는 변수 자리가 남은 원문으로, 여정만 첫 고객에게 채운 글로 썼다(R98).
 *
 * 못 박는 것
 *   R98-1 캠페인 행을 만드는 문장 전부(소스에서 기계로) = 분류표 · 새 생산자는 분류 없이 못 들어온다.
 *   R98-2 여정 단계 캠페인 행의 대표 본문 = stepCampaignDisplayCopy 결과에 묶인다(렌더 결과에 닿으면 실패 · 구문 트리).
 *   R98-3 대표 본문 값 범위(손으로 쓴 기대값) + 렌더와 같은 차례(이름 자리만 다름) + 원문 기준 판정 반례.
 *   A-1 메시지 내용 창을 여는 자리 전부가 subject 를 싣는다 · A-2 받은 모양 판정 값 범위 · A-3 두 응답이 그 판정을 지난다 ·
 *   A-4 캠페인 제목 CT 값 범위 + 상세 창이 그 CT 만 쓴다 · A-5 상세 미리보기는 여정 캠페인에서 첫 줄 실제 글을 앞세우지 않는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { deliveredViewOf } from '../sms-result-map';
import { stepCampaignDisplayCopy } from '../journey-step-campaign';
import { journeySmsDisplayCopy, renderJourneySmsMessage } from '../journey-message-render';
import { campaignSubjectForDisplay } from '../../../../frontend/src/utils/formatDate';
import { isJourneySendType } from '../../../../frontend/src/utils/campaign-axis';
import { declarationsNamed } from './helpers/producer-scan';

const SRC = path.resolve(__dirname, '..', '..');
const FRONT = path.resolve(__dirname, '../../../../frontend/src');
const back = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const front = (rel: string) => fs.readFileSync(path.join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
const sfOf = (rel: string, text: string, tsx = false) => ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
/** 백엔드 src 의 시험 아닌 .ts 파일 전부(상대 경로 · / 구분) */
function backendFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); continue; }
      if (/\.ts$/.test(e.name) && !/\.(test|spec|verify)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(path.relative(SRC, p).split(path.sep).join('/'));
    }
  };
  walk(SRC);
  return out;
}
function walkNodes(root: ts.Node, visit: (n: ts.Node) => void): void { const w = (n: ts.Node) => { visit(n); ts.forEachChild(n, w); }; w(root); }
function calleeName(c: ts.CallExpression): string { const e = c.expression; return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ''; }
function prop(o: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return o.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === name);
}

const OPT = '080-1234-5678';

describe('R98-1 캠페인 행을 만드는 문장 전부 = 분류표', () => {
  // 생산자 · message_content 에 넣는 값의 뜻(근거 줄은 설계서 흐름 표 · 여정만 「보낸 꼴에서 고객 값만 넣지 않은 글」)
  const CLASSIFIED: Record<string, { count: number; why: string }> = {
    'routes/campaigns.ts': { count: 3, why: 'AI 캠페인 만들기(sanitizedContent 원문) · 직접발송(sanitizedMessage 원문) · 브랜드메시지(message 원문)' },
    'utils/auto-campaign-worker.ts': { count: 1, why: '자동발송 회차(ac.message_content · AI 생성 문안 · 폴백 = 원문)' },
    'utils/direct-send-spec.ts': { count: 3, why: 'CAMPAIGN_INSERT_SQL 한 문장(직접발송 배관 · spec 원문) + withCampaignId 의 문장 머리 글자 두 곳(문장이 아니라 고칠 자리 찾기 · 오류 문구)' },
    'utils/journey-step-campaign.ts': { count: 1, why: '여정 단계 캠페인 = representativeMessage = stepCampaignDisplayCopy(R98-2)' },
  };
  it('소스에서 뽑은 문장 수 = 표 · 표에 없는 파일 0', () => {
    const found: Record<string, number> = {};
    for (const f of backendFiles()) {
      // 대소문자 · 스키마 한정(public.) · 따옴표 이름까지(Codex 구현 1R 보강) · 동적으로 이어 붙인 표 이름은 이 꼴 밖(그런 문장은 지금 0 = 아래 동적 꼴 검사)
      const n = (back(f).match(/insert\s+into\s+(?:"?public"?\.)?"?campaigns"?\s*\(/gi) || []).length;
      if (n > 0) found[f] = n;
    }
    expect(Object.keys(found).sort(), '새 생산자 = 이 표에 분류(message_content 의 뜻)를 적고 들어온다').toEqual(Object.keys(CLASSIFIED).sort());
    for (const [f, c] of Object.entries(CLASSIFIED)) expect(found[f], `${f} · ${c.why}`).toBe(c.count);
  });
  it('표 이름을 이어 붙여 캠페인 행을 넣는 동적 문장 = 0(위 꼴 검사를 비껴가는 꼴)', () => {
    // `INSERT INTO ${…}` 의 식 이름에 campaign 이 들어가면(표 이름을 변수로 받는 캠페인 행 생산자) 분류표를 비껴간다
    //   한계(Codex 구현 2R 기록) = 식 이름에 campaign 이 없는 변수가 'campaigns' 값을 담는 꼴은 값 추적 없이 못 잡는다 · 지금 그런 문장은 없다(위 꼴 검사 = 분류표 대조가 1차 관문)
    const dyn: string[] = [];
    for (const f of backendFiles()) {
      for (const m of back(f).matchAll(/insert\s+into\s+\$\{([^}]*)\}/gi)) if (/campaign/i.test(m[1])) dyn.push(`${f}: ${m[0]}`);
    }
    expect(dyn).toEqual([]);
  });
});

describe('R98-2 여정 단계 캠페인 행 대표 본문 = stepCampaignDisplayCopy 결과(구문 트리)', () => {
  const rel = 'utils/journey-executor.ts';
  const sf = sfOf(rel, back(rel));
  it('pickStepCampaignForUnits 를 부르는 자리 전부의 representativeMessage = c.displayMessage(백엔드 src 전부 · 별칭 0)', () => {
    const calls: Array<{ f: string; call: ts.CallExpression; sf: ts.SourceFile }> = [];
    const aliases: string[] = [];
    for (const f of backendFiles()) {
      const s = sfOf(f, back(f));
      walkNodes(s, (n) => {
        if (ts.isCallExpression(n) && calleeName(n) === 'pickStepCampaignForUnits') calls.push({ f, call: n, sf: s });
        // 다른 이름으로 들여오거나 값으로 넘기면(별칭 · 간접 호출) 위 이름 찾기를 비껴간다 → 0 이어야 한다
        if (ts.isImportSpecifier(n) && (n.propertyName?.text === 'pickStepCampaignForUnits') && n.name.text !== 'pickStepCampaignForUnits') aliases.push(`${f}: import as ${n.name.text}`);
        // 부르는 자리(callee 자체) · 가져오기 · 정의만 뺀다 — 다른 호출의 인자로 넘기는 것도 값으로 씀(Codex 구현 2R 보강)
        const p = n.parent;
        const isCallee = !!p && ts.isCallExpression(p) && p.expression === n;
        if (ts.isIdentifier(n) && n.text === 'pickStepCampaignForUnits' && !isCallee && !ts.isImportSpecifier(p) && !ts.isFunctionDeclaration(p)) aliases.push(`${f}: 값으로 씀`);
      });
    }
    expect(aliases).toEqual([]);
    expect(calls.map((c) => c.f), '부르는 자리 = 실행기 하나').toEqual([rel]);
    for (const { call, sf: s } of calls) {
      const arg = call.arguments[0];
      expect(arg && ts.isObjectLiteralExpression(arg)).toBe(true);
      const p = prop(arg as ts.ObjectLiteralExpression, 'representativeMessage');
      expect(p && ts.isPropertyAssignment(p) ? p.initializer.getText(s) : null).toBe('c.displayMessage');
    }
  });
  it('sendUnits 를 부르는 자리 전부가 displayMessage 를 stepCampaignDisplayCopy 결과로 넘긴다(그 이름의 선언 = 하나)', () => {
    const sends: ts.CallExpression[] = [];
    walkNodes(sf, (n) => { if (ts.isCallExpression(n) && calleeName(n) === 'sendUnits') sends.push(n); });
    expect(sends.length).toBe(1);
    const cArg = sends[0].arguments[3];
    expect(cArg && ts.isObjectLiteralExpression(cArg)).toBe(true);
    const p = prop(cArg as ts.ObjectLiteralExpression, 'displayMessage');
    expect(p && ts.isShorthandPropertyAssignment(p)).toBe(true);
    const decls = declarationsNamed(sf, 'displayMessage').filter((d) => ts.isVariableDeclaration(d));
    expect(decls.length, 'displayMessage 선언 = 하나(가리기 · 다시 선언 0)').toBe(1);
    const init = (decls[0] as ts.VariableDeclaration).initializer;
    expect(init && ts.isCallExpression(init) ? calleeName(init) : null).toBe('stepCampaignDisplayCopy');
    // 그 호출 인자에 렌더 결과(.message · rows[ · sendRows[0].message)가 닿지 않는다
    expect(init!.getText(sf)).not.toMatch(/\.message\b|rows\[/);
  });
});

describe('R98-3 대표 본문 값 범위(손으로 쓴 기대값)', () => {
  it('문자 LMS = (광고) 머리 + 원문(변수 자리 그대로) + 개행 + 무료수신거부 080', () => {
    expect(journeySmsDisplayCopy({ template: '[시험몰]\n%고객명%님, 반갑습니다.', channel: 'lms', isAd: true, opt080Number: OPT }))
      .toBe('(광고) [시험몰]\n%고객명%님, 반갑습니다.\n무료수신거부 080-1234-5678');
  });
  it('문자 SMS = (광고) 붙임 머리 + 무료거부 숫자만', () => {
    expect(journeySmsDisplayCopy({ template: '%고객명%님 할인', channel: 'sms', isAd: true, opt080Number: OPT }))
      .toBe('(광고)%고객명%님 할인\n무료거부08012345678');
  });
  it('문자 칸은 저장된 광고 표시가 꺼져 있어도 광고(여정 문자 칸 = 늘 광고 · 렌더와 같은 판정)', () => {
    expect(journeySmsDisplayCopy({ template: '안내 %고객명%님', channel: 'lms', isAd: false, opt080Number: OPT }))
      .toBe('(광고) 안내 %고객명%님\n무료수신거부 080-1234-5678');
  });
  it('원문에 머리 · 꼬리가 이미 있으면 다시 붙이지 않는다', () => {
    expect(journeySmsDisplayCopy({ template: '(광고) 본문 %고객명%\n무료수신거부 080-9999-9999', channel: 'lms', isAd: true, opt080Number: OPT }))
      .toBe('(광고) 본문 %고객명%\n무료수신거부 080-9999-9999');
  });
  it('보낼 수 없는 글자(폭 없는 공백)는 렌더처럼 정리된다', () => {
    expect(journeySmsDisplayCopy({ template: '안내​ %고객명%님', channel: 'lms', isAd: true, opt080Number: OPT })).not.toContain('​');
  });
  it('Liquid · 변수 자리는 채우지 않는다 · 빈 원문 = 빈 값', () => {
    expect(journeySmsDisplayCopy({ template: '{{ company.name }} %고객명%님', channel: 'lms', isAd: true, opt080Number: OPT }))
      .toBe('(광고) {{ company.name }} %고객명%님\n무료수신거부 080-1234-5678');
    expect(journeySmsDisplayCopy({ template: '', channel: 'lms', isAd: true, opt080Number: OPT })).toBe('');
    expect(journeySmsDisplayCopy({ template: null, channel: 'lms', isAd: true, opt080Number: OPT })).toBe('');
  });
  it('알림톡 = 템플릿 원문 그대로(#{변수} · 글자 정리 · 광고 표기 없음) · 080 을 읽지 않는다', () => {
    expect(stepCampaignDisplayCopy({ isKakao: true, kakaoTemplateContent: '#{고객명}님 주문이 접수됐어요 😊', opt080Number: '' }))
      .toBe('#{고객명}님 주문이 접수됐어요 😊');
    expect(stepCampaignDisplayCopy({ isKakao: true, kakaoTemplateContent: null, opt080Number: '' })).toBe('');
    expect(stepCampaignDisplayCopy({ isKakao: false, template: '%고객명%님', channel: 'lms', isAd: true, opt080Number: OPT }))
      .toBe('(광고) %고객명%님\n무료수신거부 080-1234-5678');
  });

  const shared = {
    fieldMappings: { 고객명: { column: 'name', type: 'string' as const, description: '', sample: '', storageType: 'column' as const } },
    opt080Number: OPT,
    company: { name: '', brand_name: '' },
  };
  it('같은 원문 · 같은 080 의 렌더(고객 이름 리터럴)에서 이름을 변수 자리로 되돌리면 대표 본문과 같다', async () => {
    const template = '[시험몰]\n%고객명%님, 반갑습니다.\n이번 주 안내입니다.';
    const r = await renderJourneySmsMessage({ companyId: '00000000-0000-0000-0000-000000000000', createdBy: null, template, subject: '시험 제목', channel: 'lms', isAd: true, customer: { name: '가나다라' }, shared: shared as any, predictionsPreloaded: true });
    expect(r.message).toContain('가나다라');
    expect(r.message.replace('가나다라', '%고객명%')).toBe(journeySmsDisplayCopy({ template, channel: 'lms', isAd: true, opt080Number: OPT }));
  });
  it('반례 = 변수 값이 「무료수신거부」를 담는 고객은 받은 글(꼬리 없음)과 대표 본문(원문 기준 = 꼬리 있음)이 다르다', async () => {
    const template = '%고객명%님 안내';
    const r = await renderJourneySmsMessage({ companyId: '00000000-0000-0000-0000-000000000000', createdBy: null, template, subject: '시험', channel: 'lms', isAd: true, customer: { name: '무료수신거부상회' }, shared: shared as any, predictionsPreloaded: true });
    expect(r.message).toBe('(광고) 무료수신거부상회님 안내');
    expect(journeySmsDisplayCopy({ template, channel: 'lms', isAd: true, opt080Number: OPT })).toBe('(광고) %고객명%님 안내\n무료수신거부 080-1234-5678');
  });
});

describe('A-2 받은 모양 판정(deliveredViewOf) 값 범위', () => {
  const T = '(광고) 겨울 안내';
  it('장문 · 그림 = 제목 · 유형 · 본문은 옛 그대로', () => {
    expect(deliveredViewOf({ msg_type: 'L', title_str: `  ${T} `, status_code: 6 })).toEqual({ viewType: null, subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'M', title_str: T, status_code: 6 })).toEqual({ viewType: null, subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'L', title_str: null })).toEqual({ viewType: null, subject: '', viewContents: null });
  });
  it('단문 · 알림톡 · 브랜드(대체 아님) = 제목 없음', () => {
    expect(deliveredViewOf({ msg_type: 'S', title_str: '남은 제목', status_code: 6 })).toEqual({ viewType: null, subject: '', viewContents: null });
    expect(deliveredViewOf({ msg_type: 'K', title_str: '대체 제목', status_code: 7000, k_next_type: 'L' })).toEqual({ viewType: null, subject: '', viewContents: null });
    expect(deliveredViewOf({ msg_type: 'F', title_str: '대체 제목', status_code: 7000, k_next_type: 'B', k_next_contents: '대체 글' })).toEqual({ viewType: null, subject: '', viewContents: null });
  });
  it('알림톡 · 브랜드가 장문으로 대체(7831) = 문자 LMS · 제목 · 원문 그대로(L)면 본문 옛 그대로 · 대체 문안(B)이면 그 글', () => {
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7831, k_next_type: 'L', k_next_contents: null })).toEqual({ viewType: 'LMS', subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: '7831', k_next_type: 'B', k_next_contents: '대체 장문' })).toEqual({ viewType: 'LMS', subject: T, viewContents: '대체 장문' });
    expect(deliveredViewOf({ msg_type: 'F', title_str: T, status_code: 7831, k_next_type: 'B', k_next_contents: '브랜드 대체' })).toEqual({ viewType: 'LMS', subject: T, viewContents: '브랜드 대체' });
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7831, k_next_type: '', k_next_contents: '' })).toEqual({ viewType: 'LMS', subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7831, k_next_type: 'B', k_next_contents: '  ' })).toEqual({ viewType: 'LMS', subject: T, viewContents: null });
    // 대체 안 함(N) · 모르는 대체 유형 = 대체 문안을 쓰지 않는 유형(정규화 기본 = 원문 그대로 L) → 본문 옛 그대로
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7831, k_next_type: 'N', k_next_contents: '남은 글' })).toEqual({ viewType: 'LMS', subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7831, k_next_type: 'Z', k_next_contents: '남은 글' })).toEqual({ viewType: 'LMS', subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7831, k_next_type: 'b', k_next_contents: '소문자 유형' })).toEqual({ viewType: 'LMS', subject: T, viewContents: '소문자 유형' });
  });
  it('단문으로 대체(7830) = 문자 SMS · 제목 없음 · 대체 문안(A)이면 그 글', () => {
    expect(deliveredViewOf({ msg_type: 'K', title_str: T, status_code: 7830, k_next_type: 'A', k_next_contents: '대체 단문' })).toEqual({ viewType: 'SMS', subject: '', viewContents: '대체 단문' });
    expect(deliveredViewOf({ msg_type: 'K', title_str: '', status_code: 7830, k_next_type: 'S' })).toEqual({ viewType: 'SMS', subject: '', viewContents: null });
  });
  it('옛 분리 대체 줄(S · L + k_oriseq > 0) = 그 줄 유형 · 본문은 그 줄 글', () => {
    expect(deliveredViewOf({ msg_type: 'L', k_oriseq: 991, title_str: T, status_code: 6, k_next_type: 'B', k_next_contents: '안 씀' })).toEqual({ viewType: 'LMS', subject: T, viewContents: null });
    expect(deliveredViewOf({ msg_type: 'S', k_oriseq: 991, title_str: T, status_code: 6 })).toEqual({ viewType: 'SMS', subject: '', viewContents: null });
  });
  it('모르는 유형 · 빈 줄 = 아무것도 바꾸지 않는다', () => {
    expect(deliveredViewOf({})).toEqual({ viewType: null, subject: '', viewContents: null });
    expect(deliveredViewOf({ msg_type: 'X', title_str: T })).toEqual({ viewType: null, subject: '', viewContents: null });
  });
});

describe('A-3 두 응답이 받은 모양 판정을 지난다(구문 트리)', () => {
  const viewProps = (rel: string, names: string[]) => {
    const sf = sfOf(rel, back(rel));
    let viewCalls = 0;
    const hits: Record<string, string> = {};
    walkNodes(sf, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === 'deliveredViewOf') viewCalls++;
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && names.includes(n.name.text)) {
        const t = n.initializer.getText(sf);
        if (/^view\./.test(t)) hits[n.name.text] = t;
      }
    });
    return { viewCalls, hits };
  };
  it('테스트 목록(campaigns.ts) = viewType · subject · viewContent', () => {
    const r = viewProps('routes/campaigns.ts', ['viewType', 'subject', 'viewContent']);
    expect(r.viewCalls).toBe(1);
    expect(r.hits).toEqual({ viewType: 'view.viewType', subject: 'view.subject', viewContent: 'view.viewContents' });
  });
  it('발송 내역 줄(results.ts) = view_type · subject · view_contents · 원 칸은 응답에서 뺀다', () => {
    const r = viewProps('routes/results.ts', ['view_type', 'subject', 'view_contents']);
    expect(r.viewCalls).toBe(1);
    expect(r.hits).toEqual({ view_type: 'view.viewType', subject: 'view.subject', view_contents: 'view.viewContents' });
    expect(back('routes/results.ts')).toMatch(/messages\.map\(\(\{ title_str, k_next_contents, \.\.\.m \}: any\)/);
  });
});

describe('A-1 메시지 내용 창을 여는 자리 전부가 subject 를 싣는다 · 창이 그린다', () => {
  const rel = 'components/ResultsModal.tsx';
  const text = front(rel);
  const sf = sfOf(rel, text, true);
  it('setMsgDetailContent(객체) 전부 = subject 있음(지금 4)', () => {
    const objs: ts.ObjectLiteralExpression[] = [];
    walkNodes(sf, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === 'setMsgDetailContent' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) objs.push(n.arguments[0]);
    });
    expect(objs.length).toBe(4);
    for (const o of objs) expect(prop(o, 'subject'), o.getText(sf).slice(0, 80)).toBeTruthy();
  });
  it('받은 모양 값을 쓴다 = 테스트 목록 viewType · viewContent · 발송 내역 view_type · view_contents', () => {
    expect(text).toContain('content: t.viewContent ?? content, msgType: t.viewType ?? t.type, subject: t.subject');
    expect(text).toContain('content: m.view_contents ?? content,');
    expect(text).toContain('msgType: m.view_type ?? m.msg_type,');
  });
  it('채널통합조회 = 캠페인 제목 CT · 알림톡 · 브랜드 전용 캠페인은 빈 값', () => {
    expect(text).toContain("subject: (isAlimtalkChannel(c) || isBrandOnlyChannel(c)) ? '' : campaignSubjectForDisplay(c),");
  });
  it('문자 모양 창이 말풍선 맨 위에 subject 를 그린다(빈 값 = 줄 없음)', () => {
    expect(text).toContain('const { content, msgType, mmsImages, subject } = msgDetailContent;');
    expect(text).toMatch(/\{subject && \(\s*<div className="font-bold text-neutral-900 mb-1 pb-1 border-b border-neutral-200">\{subject\}<\/div>\s*\)\}\s*\{content\}/);
  });
});

describe('A-4 캠페인 제목 CT 값 범위 · 상세 창은 그 CT 만', () => {
  it('값 범위(손으로 쓴 기대값)', () => {
    expect(campaignSubjectForDisplay({ message_type: 'LMS', subject: '겨울 세일', is_ad: true })).toBe('(광고) 겨울 세일');
    expect(campaignSubjectForDisplay({ message_type: 'MMS', subject: '겨울 세일', is_ad: false })).toBe('겨울 세일');
    expect(campaignSubjectForDisplay({ message_type: 'LMS', subject: '겨울 세일', is_ad: true, ad_text: false })).toBe('겨울 세일');
    expect(campaignSubjectForDisplay({ message_type: 'LMS', subject: '(광고) 이미 붙음', is_ad: true })).toBe('(광고) 이미 붙음');
    expect(campaignSubjectForDisplay({ message_type: 'LMS', subject: null, message_subject: '원본 제목', is_ad: false })).toBe('원본 제목');
    expect(campaignSubjectForDisplay({ message_type: 'SMS', subject: '남은 제목', is_ad: true })).toBe('');
    expect(campaignSubjectForDisplay({ message_type: 'L', subject: '축약 유형', is_ad: true })).toBe('축약 유형');
    expect(campaignSubjectForDisplay({ message_type: 'LMS', subject: '', is_ad: true })).toBe('');
    expect(campaignSubjectForDisplay(null)).toBe('');
  });
  it('CampaignDetailModal = buildAdSubjectFront 직접 호출 0 · 제목 CT 호출 1 · 그 값을 정보 줄 · 미리보기 두 자리에서 쓴다', () => {
    const t = front('components/CampaignDetailModal.tsx');
    expect((t.match(/buildAdSubjectFront\(/g) || []).length).toBe(0);
    expect((t.match(/campaignSubjectForDisplay\(campaign\)/g) || []).length).toBe(1);
    expect((t.match(/\bdisplaySubject\b/g) || []).length).toBe(5);   // 선언 1 · 정보 줄 2 · 미리보기 2
  });
});

describe('A-5 상세 미리보기 = 여정 캠페인은 첫 줄 실제 글을 앞세우지 않는다', () => {
  it('formatCampaignMessageForDisplay 둘째 인자 = 여정이면 undefined · 그 밖 firstMessageContent', () => {
    const rel = 'components/CampaignDetailModal.tsx';
    const sf = sfOf(rel, front(rel), true);
    const calls: ts.CallExpression[] = [];
    walkNodes(sf, (n) => { if (ts.isCallExpression(n) && calleeName(n) === 'formatCampaignMessageForDisplay') calls.push(n); });
    expect(calls.length).toBe(1);
    const a = calls[0].arguments[1];
    expect(a && ts.isConditionalExpression(a)).toBe(true);
    const c = a as ts.ConditionalExpression;
    expect(c.condition.getText(sf)).toBe('isJourneySendType(campaign.send_type)');   // 판정 = campaign-axis CT(화면 리터럴 0 = brand-axis-invariants)
    expect(c.whenTrue.getText(sf)).toBe('undefined');
    expect(c.whenFalse.getText(sf)).toBe('firstMessageContent');
  });
  it('isJourneySendType 값 범위', () => {
    expect(isJourneySendType('journey')).toBe(true);
    expect(isJourneySendType(' journey ')).toBe(true);
    for (const v of ['direct', 'ai', 'auto', 'operator', '', null, undefined]) expect(isJourneySendType(v as any)).toBe(false);
  });
});
