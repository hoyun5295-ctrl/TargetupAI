/**
 * 알림톡 직접발송 「실패 시 문자」 창 [저장] — 종류 · 대체문안 · 제목이 한 번의 변경으로 들어간다(★ 2026-11-11 긴급 · 접수 1111 15:27 박성용)
 *
 * 증상 = 창에서 「대체 안함」 · 「대체문안 작성」을 골라 [저장]해도 「원문 그대로」에 고정 → 「LMS 제목을 넣어 주세요」로 발송이 막혔다.
 * 원인 = 알림톡 채널 훅(useAlimtalkChannel)의 낱개 setter(setNextType · setNextContents · setNextSubject)는 **그릴 때의 value 를 펼쳐** onChange 로 넘긴다.
 *   1105 C107 D-01 창의 [저장]이 셋을 이어 불러, 뒤의 두 호출이 옛 종류 · 옛 문안을 다시 실었다(부모는 받은 값 전부를 그대로 넣는다 = 마지막 호출이 이긴다).
 * 처방 = 훅에 한 번에 바꾸는 setNextAll 을 두고 창의 [저장]은 그것 하나만 부른다.
 * 계약 = 그 훅을 쓰는 화면에서 한 함수가 낱개 변경 함수를 둘 이상 부르지 않는다(구문 트리 · 훅을 부르는 파일을 기계로 뽑는다).
 */
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import React from '../../../../frontend/node_modules/react';
import { renderToString } from '../../../../frontend/node_modules/react-dom/server';
import { useAlimtalkChannel, createEmptyAlimtalkState, type AlimtalkChannelState } from '../../../../frontend/src/components/alimtalk/AlimtalkChannelPanel';

const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');

/** 훅을 실제로 한 번 그려 돌려준 것을 꺼낸다(서버 렌더 = 효과는 돌지 않는다 · setter 는 그릴 때 값으로 닫힌 함수 그대로) */
function hookFor(value: AlimtalkChannelState, onChange: (v: AlimtalkChannelState) => void): ReturnType<typeof useAlimtalkChannel> {
  let out: ReturnType<typeof useAlimtalkChannel> | null = null;
  const Probe = () => { out = useAlimtalkChannel({ senders: [], templates: [], value, onChange }); return null; };
  renderToString(React.createElement(Probe));
  return out!;
}
/** 부모(AlimtalkSendModal handleChannelChange)와 같은 받기 = 받은 값 전부를 그대로 넣는다 → 같은 손짓의 여러 호출은 마지막 것이 남는다 */
const lastOf = (calls: AlimtalkChannelState[]) => calls[calls.length - 1];

describe('실패 시 문자 창 [저장] = 한 번의 변경', () => {
  const START: AlimtalkChannelState = { ...createEmptyAlimtalkState(), profileId: 'p1', templateCode: 'T1', templateId: 't1', nextType: 'L', nextContents: '', nextSubject: '' };

  it('setNextAll = onChange 한 번 · 세 값이 같이 들어가고 나머지 칸은 그대로', () => {
    const calls: AlimtalkChannelState[] = [];
    const ch = hookFor(START, (v) => calls.push(v));
    ch.setNextAll({ nextType: 'N', nextContents: '', nextSubject: '' });
    expect(calls).toEqual([{ ...START, nextType: 'N', nextContents: '', nextSubject: '' }]);
    calls.length = 0;
    ch.setNextAll({ nextType: 'B', nextContents: '쿠폰이 곧 만료돼요.', nextSubject: '쿠폰 만료 안내' });
    expect(calls).toEqual([{ ...START, nextType: 'B', nextContents: '쿠폰이 곧 만료돼요.', nextSubject: '쿠폰 만료 안내' }]);
  });

  it('왜 필요한가 — 낱개 setter 셋을 이어 부르면 마지막 호출이 옛 종류 · 옛 문안을 싣는다(1105 ~ 1111 의 결함 그대로)', () => {
    const calls: AlimtalkChannelState[] = [];
    const ch = hookFor(START, (v) => calls.push(v));
    ch.setNextType('B'); ch.setNextContents('쿠폰이 곧 만료돼요.'); ch.setNextSubject('쿠폰 만료 안내');
    expect(calls.map((c) => c.nextType)).toEqual(['B', 'L', 'L']);
    expect(lastOf(calls)).toMatchObject({ nextType: 'L', nextContents: '', nextSubject: '쿠폰 만료 안내' });   // 종류 · 문안은 저장되지 않고 제목만 남았다
  });
});

describe('계약 — 알림톡 채널 훅을 쓰는 화면에서 한 함수가 낱개 변경 함수를 둘 이상 부르지 않는다', () => {
  const SINGLE = new Set(['setNextType', 'setNextContents', 'setNextSubject', 'setProfileId', 'handleSelectTemplate', 'setNextAll']);
  const files = (readdirSync(FE, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => /\.tsx?$/.test(f) && !/node_modules\//.test(f));
  const parse = (rel: string) => ts.createSourceFile(rel, readFileSync(join(FE, rel), 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const callsNamed = (root: ts.Node, name: string): ts.CallExpression[] => {
    const out: ts.CallExpression[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
      ts.forEachChild(n, walk);
    };
    walk(root);
    return out;
  };
  // 훅을 부르는 파일 = 기계 추출(새 화면이 훅을 쓰면 저절로 대상)
  const users = files.filter((f) => callsNamed(parse(f), 'useAlimtalkChannel').length > 0).sort();

  it('훅을 부르는 파일이 뽑힌다(뽑기가 죽으면 아래가 빈 통과가 된다)', () => {
    expect(users).toEqual(['components/AlimtalkSendModal.tsx', 'components/alimtalk/AlimtalkChannelPanel.tsx']);
  });

  it('한 함수 몸통 안의 낱개 변경 호출 ≤ 1', () => {
    const found: string[] = [];
    for (const f of users) {
      const sf = parse(f);
      const perFn = new Map<ts.Node, string[]>();
      const walk = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression;
          const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
          if (SINGLE.has(name)) {
            let fn: ts.Node = n.parent;
            while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
            perFn.set(fn, [...(perFn.get(fn) || []), name]);
            found.push(`${f}:${name}`);
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(sf);
      for (const [fn, names] of perFn) {
        const line = fn ? sf.getLineAndCharacterOfPosition(fn.getStart(sf)).line + 1 : 0;
        expect(names, `${f}:${line} 한 함수에서 ${names.join(' · ')} — 한 번에 바꾸는 setNextAll 을 쓴다`).toHaveLength(1);
      }
    }
    // 창의 [저장] = setNextAll 한 번
    expect(found).toContain('components/AlimtalkSendModal.tsx:setNextAll');
    expect(found.filter((x) => x.startsWith('components/AlimtalkSendModal.tsx:setNext')).sort()).toEqual(['components/AlimtalkSendModal.tsx:setNextAll']);
  });
});
