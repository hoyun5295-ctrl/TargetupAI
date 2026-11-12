/**
 * C130 ① 수신거부 줄 겹침 안내 — 배선 계약(★ 2026-11-13 · 설계서 §5 T1-4 · T1-7 · 구문 트리 · 기계 추출)
 *
 *   T1-4 = 글자 정리 알림(agencyCharNotice · charLines)이 있는 자리 집합 ⊆ 수신거부 알림이 있는 자리 집합 ·
 *          담당자 문자(buildPassedNotify · buildReapprovalNotify) 호출 전부 optOutLine · 접수 완료 회신 전부 charNotes.
 *   T1-7 = 담당자 문자의 판정 글 = 그 함수에서 테스트 문자를 만든 글(buildSample 에 넘긴 current_content) ·
 *          테스트 문자를 다시 만들지 않는 자리는 지금 행의 current_content.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { agencyOptOutSmsLine } from '../agency-send-optout';

const SRC = join(__dirname, '..', '..');
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .map((f) => String(f).replace(/\\/g, '/'))
  .filter((f) => /\.ts$/.test(f) && !/__tests__\//.test(f));
const parsed = new Map<string, ts.SourceFile>();
const sf = (f: string) => {
  let s = parsed.get(f);
  if (!s) { s = ts.createSourceFile(f, readFileSync(join(SRC, f), 'utf8'), ts.ScriptTarget.Latest, true); parsed.set(f, s); }
  return s;
};
type Call = { file: string; node: ts.CallExpression; fn: ts.Node | null };
const isFn = (n: ts.Node) => ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);
/** 가장 바깥이 아닌 「가장 가까운 이름 있는 함수 또는 라우트 핸들러」 — 인자 콜백(map 등) 안이면 그 밖으로 올라간다 */
const owner = (n: ts.Node): ts.Node | null => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (!isFn(p)) continue;
    const parent = p.parent;
    // 배열 메서드 · buildApproveTexts 같은 호출 인자 콜백은 건너뛴다(라우트 핸들러 = router.x(경로, 핸들러) 는 멈춘다)
    if (parent && ts.isCallExpression(parent) && parent.arguments.includes(p as any)) {
      const callee = parent.expression.getText();
      if (/^router\.|^app\./.test(callee)) return p;
      continue;
    }
    return p;
  }
  return null;
};
const callsOf = (name: string): Call[] => {
  const out: Call[] = [];
  for (const f of files) {
    const s = sf(f);
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push({ file: f, node: n, fn: owner(n) });
      ts.forEachChild(n, walk);
    };
    walk(s);
  }
  return out;
};
const contains = (root: ts.Node, pred: (n: ts.Node) => boolean): boolean => {
  let hit = false;
  const walk = (n: ts.Node): void => { if (hit) return; if (pred(n)) { hit = true; return; } ts.forEachChild(n, walk); };
  walk(root);
  return hit;
};
const callsName = (name: string) => (n: ts.Node) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;
const objProp = (call: ts.CallExpression, prop: string): ts.Expression | null => {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  for (const p of arg.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === prop) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === prop) return p.name;
  }
  return null;
};

describe('T1-4 확인 자리 배선', () => {
  it('수신거부 알림을 만드는 자리 = 6곳(미리보기 · 접수 코어 · 재시도 회신 · 문안 수정 · 고객 상세 · 직원 상세)', () => {
    const at = callsOf('agencyOptOutNotice').filter((c) => c.file !== 'utils/agency-send-optout.ts');
    expect(at.map((c) => c.file).sort()).toEqual([
      'routes/admin.ts', 'routes/agency-send.ts', 'routes/agency-send.ts',
      'utils/agency-send-change.ts', 'utils/agency-send-intake.ts', 'utils/agency-send-mail-worker.ts',
    ]);
  });

  it('글자 정리 알림(agencyCharNotice)이 있는 함수마다 수신거부 알림도 있다(만들거나 · 받아서 싣거나)', () => {
    const at = callsOf('agencyCharNotice').filter((c) => c.file !== 'utils/agency-send-chars.ts');
    expect(at.length).toBeGreaterThanOrEqual(3);
    for (const c of at) {
      expect(c.fn, `${c.file} 함수 밖`).not.toBeNull();
      const ok = contains(c.fn!, callsName('agencyOptOutNotice'))
        || contains(c.fn!, (n) => (ts.isShorthandPropertyAssignment(n) || ts.isPropertyAssignment(n)) && n.name.getText() === 'optOutNotice');
      expect(ok, `${c.file}:${sf(c.file).getLineAndCharacterOfPosition(c.node.getStart()).line + 1}`).toBe(true);
    }
    // 받아서 싣는 쪽(toAnalysisView)은 부르는 곳마다 안내를 넘긴다
    for (const c of callsOf('toAnalysisView')) expect(c.node.arguments.length, c.file).toBe(2);
  });

  it('글자 정리 알림이 실리는 배열 · 객체 = 수신거부 알림도 같은 배열 · 객체에 실린다(계산만 하고 빠뜨리면 빨강)', () => {
    const at = callsOf('agencyCharNotice').filter((c) => c.file !== 'utils/agency-send-chars.ts');
    for (const c of at) {
      const where = `${c.file}:${sf(c.file).getLineAndCharacterOfPosition(c.node.getStart()).line + 1}`;
      const p = c.node.parent;
      if (ts.isSpreadElement(p) && ts.isArrayLiteralExpression(p.parent)) {
        // 같은 배열의 다른 펼침 = 그 함수에서 agencyOptOutNotice 로 만든 변수
        const others = p.parent.elements.filter((e) => e !== p && ts.isSpreadElement(e) && ts.isIdentifier(e.expression)).map((e) => ((e as ts.SpreadElement).expression as ts.Identifier).text);
        const made = others.some((name) => contains(c.fn!, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name
          && !!n.initializer && contains(n.initializer, callsName('agencyOptOutNotice'))));
        expect(made, where).toBe(true);
      } else if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent)) {
        const has = p.parent.properties.some((x) => (ts.isShorthandPropertyAssignment(x) || ts.isPropertyAssignment(x)) && x.name.getText() === 'optOutNotice');
        expect(has, where).toBe(true);
      } else {
        throw new Error(`${where}: 글자 정리 알림이 배열 펼침 · 객체 칸이 아닌 꼴로 실린다 = 이 계약을 그 꼴에 맞게 넓힌다`);
      }
    }
  });

  it('수신거부 알림 값은 계산한 함수 안에서 실제로 쓰인다(변수에 담고 버리면 빨강)', () => {
    const at = callsOf('agencyOptOutNotice').filter((c) => c.file !== 'utils/agency-send-optout.ts');
    for (const c of at) {
      const where = `${c.file}:${sf(c.file).getLineAndCharacterOfPosition(c.node.getStart()).line + 1}`;
      let decl: ts.VariableDeclaration | null = null;
      for (let p: ts.Node = c.node.parent; p && p !== c.fn; p = p.parent) {
        if (ts.isVariableDeclaration(p)) { decl = p; break; }
        if (ts.isPropertyAssignment(p) || ts.isCallExpression(p)) break;   // 객체 칸에 바로 실리거나 · 다른 호출(Map.set 등)의 인자
      }
      if (!decl) continue;
      const name = (decl.name as ts.Identifier).text;
      let uses = 0;
      const walk = (n: ts.Node): void => { if (ts.isIdentifier(n) && n.text === name && n !== decl!.name) uses += 1; ts.forEachChild(n, walk); };
      walk(c.fn!);
      expect(uses, `${where} ${name}`).toBeGreaterThan(0);
    }
  });

  it('담당자 문자 = buildPassedNotify · buildReapprovalNotify 호출 전부 optOutLine 을 싣고 · 그 값은 agencyOptOutSmsLine 에서 온다', () => {
    const notify = [...callsOf('buildPassedNotify'), ...callsOf('buildReapprovalNotify')].filter((c) => c.file !== 'utils/agency-send-notify.ts');
    expect(notify.length).toBe(8);   // 승인 요청 2자리 · 재승인 2자리 × (text · perPhoneTexts)
    for (const c of notify) {
      const v = objProp(c.node, 'optOutLine');
      expect(v, `${c.file}:${sf(c.file).getLineAndCharacterOfPosition(c.node.getStart()).line + 1}`).not.toBeNull();
      expect(contains(c.fn!, callsName('agencyOptOutSmsLine'))).toBe(true);
    }
    // charLines 를 싣는 호출 ⊆ optOutLine 을 싣는 호출
    for (const c of notify.filter((x) => objProp(x.node, 'charLines'))) expect(objProp(c.node, 'optOutLine')).not.toBeNull();
  });

  it('고객 상세 문안 저장 = 저장 응답의 안내로 상자를 바꾼다(뒤따르는 조회에 기대지 않는다 · Codex 구현 1R)', () => {
    const change = readFileSync(join(SRC, 'utils', 'agency-send-change.ts'), 'utf8');
    expect(change).toMatch(/\.\.\.optOut\], optOutNotice: optOut \};/);
    const route = readFileSync(join(SRC, 'routes', 'agency-send.ts'), 'utf8');
    expect(route).toContain('optOutNotice: out.optOutNotice || []');
    const fe = readFileSync(join(SRC, '..', '..', 'frontend', 'src', 'components', 'agency', 'AgencySendDetail.tsx'), 'utf8');
    const save = fe.slice(fe.indexOf('const doSaveContent = async'), fe.indexOf('const doReschedule = async'));
    expect(save).toMatch(/optOutNotice: oo \} = await updateAgencyContent\(/);
    expect(save.indexOf('setOptOutNotice(oo)')).toBeGreaterThan(save.indexOf('apply(saved)'));
    expect(save.slice(0, save.indexOf('} catch'))).not.toMatch(/refresh\(\)/);
  });

  it('접수 완료 회신 = buildAcceptedReply 호출 전부 charNotes 를 싣는다(첫 회신 = 코어 notice · 재시도 = 지금 글로 다시 계산)', () => {
    const acc = callsOf('buildAcceptedReply');
    expect(acc.length).toBe(2);
    for (const c of acc) expect(objProp(c.node, 'charNotes'), c.file).not.toBeNull();
  });
});

describe('T1-7 담당자 문자의 판정 글 = 테스트 문자를 만든 글', () => {
  it('agencyOptOutSmsLine 의 content = 같은 함수 buildSample 에 넘긴 current_content · 없으면 row.current_content', () => {
    const at = callsOf('agencyOptOutSmsLine').filter((c) => c.file !== 'utils/agency-send-optout.ts');
    expect(at.length).toBe(4);
    for (const c of at) {
      const content = objProp(c.node, 'content')!.getText();
      let sampled: string | null = null;
      const walk = (n: ts.Node): void => {
        if (callsName('buildSample')(n)) {
          const a = (n as ts.CallExpression).arguments[0];
          if (a && ts.isObjectLiteralExpression(a)) {
            const p = a.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText() === 'current_content') as ts.PropertyAssignment | undefined;
            if (p) sampled = p.initializer.getText();
          } else if (a && ts.isIdentifier(a)) sampled = `${a.text}.current_content`;
        }
        ts.forEachChild(n, walk);
      };
      walk(c.fn!);
      const line = sf(c.file).getLineAndCharacterOfPosition(c.node.getStart()).line + 1;
      expect(content, `${c.file}:${line}`).toBe(sampled ?? 'row.current_content');
    }
  });

  it('판정 = 그 글 기준(수정 전 「수신거부」 · 수정 뒤 「무료수신거부」 = 알림 0 · 반대 = 1)', () => {
    expect(agencyOptOutSmsLine({ content: '세일 안내\n무료수신거부 0800000000', isAd: true })).toBe('');
    expect(agencyOptOutSmsLine({ content: '세일 안내\n수신거부 0800000000', isAd: true })).not.toBe('');
    expect(agencyOptOutSmsLine({ content: '세일 안내\n수신거부 0800000000', isAd: false })).toBe('');
  });
});
