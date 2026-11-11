/**
 * C128 직접발송 치환 = 올린 이름 우선(★ 2026-11-11 · 접수 1111 17:00 박성용 · 이새에프엔씨)
 *
 * 증상 = 엑셀에 고객명 「테스트」를 올려 직접발송했는데 실제 문자는 고객 DB(싱크 연동) 이름 「김아영」으로 나갔다.
 * 원인 = 공통 치환(replaceVariables 0단계 · D111 P2)이 「고객 DB 에 그 번호가 없거나 이름이 빈 때만」 올린 이름을 썼다.
 *   화면 미리보기(프론트 replaceDirectVars)는 올린 값 그대로라 본 것(테스트) ≠ 나간 것(김아영).
 * 처방 = 올린 이름이 있으면 그 이름 · 빈 값이면 옛 그대로(고객 DB 이름 · 없으면 빈 글).
 * 바뀌는 경우 = 「올린 이름과 고객 DB 이름이 둘 다 있고 서로 다른 번호」 하나뿐 — 나머지는 글자 그대로 같다(아래 「변화 0」 표).
 */
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { join } from 'path';
import { replaceVariables, prepareSendMessage } from '../messageUtils';
import { FIELD_MAP } from '../standard-field-map';
import { replaceDirectVars } from '../../../../frontend/src/utils/formatDate';

const MAP: any = { 고객명: { column: 'name', type: 'string' }, 이름: { column: 'name', type: 'string' }, 성함: { column: 'name', type: 'string' }, 등급: { column: 'grade', type: 'string' } };
const TPL = '%이름%님 / %고객명%님 / %성함%님 / 등급=%등급% / 기타1=%기타1%';
const DB = { phone: '01000000001', name: '김아영', grade: 'VIP', custom_fields: {} };
const up = (name: unknown) => ({ name: name as any, extra1: '엑셀값', extra2: '', extra3: '' });
const run = (customer: Record<string, any> | null, ab: any) => replaceVariables(TPL, customer, MAP, ab, { skipNumberFormatting: true });

describe('올린 이름이 있으면 그 이름이 나간다(본 것 = 나가는 것)', () => {
  it('고객 DB 에 그 번호가 있고 이름이 달라도 올린 이름 · 이름 아닌 칸(등급)은 고객 DB 그대로 · 기타 칸은 올린 값', () => {
    expect(run(DB, up('테스트'))).toBe('테스트님 / 테스트님 / 테스트님 / 등급=VIP / 기타1=엑셀값');
  });
  it('화면 미리보기와 같은 이름(프론트 replaceDirectVars = 올린 줄 그대로)', () => {
    const row = { phone: '01000000001', name: '테스트', extra1: '', extra2: '', extra3: '', callback: '' };
    expect(replaceVariables('%이름%님 안녕하세요', DB, MAP, row, { skipNumberFormatting: true })).toBe(replaceDirectVars('%이름%님 안녕하세요', row));
  });
  it('광고 표기까지 붙이는 길(prepareSendMessage)도 같은 이름', () => {
    const { message } = prepareSendMessage('%이름%님 안내', DB, MAP, { msgType: 'SMS', isAd: false, opt080Number: '', addressBookFields: up('테스트'), subject: '', skipNumberFormatting: true });
    expect(message).toBe('테스트님 안내');
  });
  it('숫자로 온 이름 칸(엑셀 셀 0)도 올린 값', () => {
    expect(replaceVariables('%이름%', DB, MAP, up(0), { skipNumberFormatting: true })).toBe('0');
  });
});

describe('변화 0 — 아래는 고치기 전과 글자 그대로 같다(기대값 = 옛 동작 리터럴)', () => {
  it('고객 DB 에 그 번호 없음(미가입 · 직접발송만 쓰는 회사의 보통 경우) = 올린 이름', () => {
    expect(run(null, up('테스트'))).toBe('테스트님 / 테스트님 / 테스트님 / 등급= / 기타1=엑셀값');
  });
  it('고객 DB 에 있으나 이름이 빈 값 = 올린 이름', () => {
    expect(run({ ...DB, name: '' }, up('테스트'))).toBe('테스트님 / 테스트님 / 테스트님 / 등급=VIP / 기타1=엑셀값');
    expect(run({ ...DB, name: '   ' }, up('테스트'))).toBe('테스트님 / 테스트님 / 테스트님 / 등급=VIP / 기타1=엑셀값');
  });
  it('올린 이름이 빈 값 = 고객 DB 이름(공백만 있는 칸 포함)', () => {
    expect(run(DB, up(''))).toBe('김아영님 / 김아영님 / 김아영님 / 등급=VIP / 기타1=엑셀값');
    expect(run(DB, up('   '))).toBe('김아영님 / 김아영님 / 김아영님 / 등급=VIP / 기타1=엑셀값');
    expect(run(DB, up(null))).toBe('김아영님 / 김아영님 / 김아영님 / 등급=VIP / 기타1=엑셀값');
  });
  it('올린 이름도 고객 DB 도 없음 = 빈 글', () => {
    expect(run(null, up(''))).toBe('님 / 님 / 님 / 등급= / 기타1=엑셀값');
  });
  it('올린 이름 = 고객 DB 이름', () => {
    expect(run(DB, up('김아영'))).toBe('김아영님 / 김아영님 / 김아영님 / 등급=VIP / 기타1=엑셀값');
  });
  it('주소록 칸을 넘기지 않는 길(AI 캠페인 · 자동발송 · 여정 · 테스트 발송 · 예약 수정) = 고객 DB 이름', () => {
    expect(replaceVariables('%이름%님 / %고객명%님', DB, MAP)).toBe('김아영님 / 김아영님');
  });
  it('스팸 검사 꼴(이름 빈 글 · 회신번호만) = 표본 고객 이름', () => {
    expect(replaceVariables('%이름%님 %회신번호%', DB, MAP, { callback: '0212345678', extra1: '', extra2: '', extra3: '', name: '' })).toBe('김아영님 0212345678');
  });
  it('대행발송 미리보기 꼴(고객 = 빈 객체) = 넘긴 값', () => {
    expect(replaceVariables('%이름%님', {}, MAP, up('홍길동'), { skipNumberFormatting: true })).toBe('홍길동님');
  });
});

describe('계약 — 이름 변수 글자 = 표준 필드 표의 이름 칸 라벨 전부 · 올린 이름을 넘기는 자리 = 직접발송뿐', () => {
  const SRC = join(__dirname, '..', '..');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  it('0단계가 바꾸는 이름 변수 = FIELD_MAP name 의 표시 이름 + 별칭(별칭이 늘면 이 시험이 실패한다)', () => {
    const f = FIELD_MAP.find((x: any) => x.fieldKey === 'name')!;
    const labels = [f.displayName, ...((f as any).aliases || [])].sort();
    expect(labels).toEqual(['고객명', '성함', '이름']);
    for (const l of labels) expect(run(DB, up('테스트')).includes('김아영'), l).toBe(false);
  });
  it('주소록 칸에 이름 값을 실어 치환 함수를 부르는 운영 파일(구문 트리) = 직접발송 동기 · 직접발송 워커 · 대행 미리보기 · DM 알림', () => {
    // 호출의 인자(객체 리터럴 · 옵션 안 addressBookFields)에 name 속성이 있고 그 값이 빈 글 리터럴이 아닌 자리를 파일별로 센다.
    const files = ['routes/campaigns.ts', 'routes/spam-filter.ts', 'services/ai-line-spam.ts', 'utils/direct-send-processor.ts', 'utils/agency-send-preview.ts', 'utils/dm/dm-alert-msg-type.ts', 'utils/spam-test-queue.ts'];
    const count: Record<string, number> = {};
    for (const rel of files) {
      const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true);
      let n = 0;
      const nameGiven = (o: ts.ObjectLiteralExpression): boolean => o.properties.some((p) =>
        ts.isPropertyAssignment(p) && p.name.getText(sf) === 'name' && !(ts.isStringLiteral(p.initializer) && p.initializer.text === ''));
      const walk = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && (x.expression.text === 'replaceVariables' || x.expression.text === 'prepareSendMessage')) {
          const a3 = x.arguments[3];
          if (a3 && ts.isObjectLiteralExpression(a3)) {
            if (x.expression.text === 'replaceVariables' && nameGiven(a3)) n++;
            const ab = a3.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'addressBookFields') as ts.PropertyAssignment | undefined;
            if (ab && (!ts.isObjectLiteralExpression(ab.initializer) || nameGiven(ab.initializer))) n++;
          } else if (a3 && x.expression.text === 'replaceVariables' && !ts.isObjectLiteralExpression(a3) && /AddressBookFields\(|slotValues/.test(a3.getText(sf))) n++;
        }
        ts.forEachChild(x, walk);
      };
      walk(sf);
      count[rel] = n;
    }
    expect(count).toEqual({
      'routes/campaigns.ts': 5,                 // 직접발송 동기: 문자 · 브랜드 · 알림톡 본문 · 대체문안 · 알림톡 변수
      'routes/spam-filter.ts': 0,               // 이름 빈 글
      'services/ai-line-spam.ts': 0,            // 이름 빈 글
      'utils/direct-send-processor.ts': 5,      // 직접발송 워커: 문자 · 브랜드 · 알림톡 본문 · 대체문안 · 알림톡 변수
      'utils/agency-send-preview.ts': 2,        // 고객 = 빈 객체(변화 0)
      'utils/dm/dm-alert-msg-type.ts': 1,       // 고객 = null(변화 0)
      'utils/spam-test-queue.ts': 0,            // 이름 빈 글
    });
  });
});
