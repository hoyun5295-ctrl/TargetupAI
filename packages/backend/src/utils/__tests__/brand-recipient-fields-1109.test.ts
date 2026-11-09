/**
 * ★ 2026-11-09 브랜드메시지 발송 창 · 받는 사람 명단에 항목 칸(설계 = docs/2026-11-09-brand-recipient-fields-design.md)
 *   뿌리 R86 = 같은 명단을 받는 창 가운데 하나가 보기 모양을 좁게 들고 있어 들어오는 문마다 칸을 버린다.
 *   R85(넓힘) = 칸이 늘어도 표 그릇이 받는다(표 안 가로 · 세로 한 그릇 · 붙는 머리).
 * 대상은 소스에서 기계로 뽑는다(손 등재 표는 분류표 하나 · 표에 없는 새 자리 = 실패).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  recipientFieldLabels, rowFields, fieldsByPhone, firstFilledRecord, recipientSeeds, pickNameKey, RECIPIENT_ROW_INTERNAL_KEYS,
} from '../../../../frontend/src/utils/recipient-paste';
import { extractionRowsToTable, extractionFieldTable } from '../../../../frontend/src/utils/customerFilterBuild';
import { stripComments } from './helpers/producer-scan';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const src = (rel: string) => stripComments(readFileSync(join(PKG, rel), 'utf8').replace(/\r\n/g, '\n'));
/** 여는 괄호 위치부터 짝 괄호까지 인자 글 */
const argsAt = (text: string, openIdx: number): string => {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return '';
};
/** 컴포넌트 안 함수 단위(두 칸 들여쓴 const 선언 하나 = 단위 하나) — 위치가 든 단위 이름과 몸 */
const unitsOf = (text: string) => {
  const heads = [...text.matchAll(/\n {2}const (\w+)\b/g)].map((m) => ({ name: m[1], at: m.index! }));
  return heads.map((h, i) => ({ ...h, body: text.slice(h.at, heads[i + 1]?.at ?? text.length) }));
};
const unitAt = (units: ReturnType<typeof unitsOf>, pos: number) => [...units].reverse().find((u) => u.at < pos);

describe('R86-a 칸 이름 · 값 판정 한 곳', () => {
  it('이름 칸 → 「이름」 · 번호 칸 뺌 · 나머지는 머리 그대로 · 처음 나온 순서', () => {
    const rows = [{ 휴대폰: '010-0000-0001', 고객명: '가', 등급: 'VIP', 지역: '서울' }];
    const labels = recipientFieldLabels(rows, { phoneKey: '휴대폰', nameKey: '고객명' });
    expect([...labels.entries()]).toEqual([['고객명', '이름'], ['등급', '등급'], ['지역', '지역']]);
    expect(rowFields(rows[0], labels)).toEqual({ 이름: '가', 등급: 'VIP', 지역: '서울' });
  });

  it('행마다 키가 달라도 같은 키 = 모든 줄 같은 칸(원천 하나에 한 번 정함 · Codex 설계 1R #1)', () => {
    const rows = [{ phone: '01000000001', name: '고객A', 이름: '담당A' }, { phone: '01000000002', 이름: '담당B' }];
    const labels = recipientFieldLabels(rows, { phoneKey: 'phone', nameKey: 'name' });
    expect(rowFields(rows[0], labels)).toEqual({ 이름: '고객A', '이름 2': '담당A' });
    expect(rowFields(rows[1], labels)).toEqual({ '이름 2': '담당B' });
  });

  it('겹친 칸 이름 = 뒤 키에 2 · 3(값이 조용히 덮이지 않는다)', () => {
    const labels = recipientFieldLabels([{ p: '01000000001', a: '1', b: '2', c: '3' }], {
      phoneKey: 'p', nameKey: null, labelOf: () => '메모',
    });
    expect([...labels.values()]).toEqual(['메모', '메모 2', '메모 3']);
  });

  it('내부 키는 상수로만 뺀다 · 사용자 머리 「_회원번호」는 남는다(Codex 설계 1R #2)', () => {
    expect([...RECIPIENT_ROW_INTERNAL_KEYS].sort()).toEqual(['_templateVars', 'originalIdx']);
    const row = { phone: '01000000001', _회원번호: 'M-1', _templateVars: { a: 1 }, originalIdx: 3 };
    const labels = recipientFieldLabels([row], { phoneKey: 'phone', nameKey: null });
    expect(rowFields(row, labels)).toEqual({ _회원번호: 'M-1' });
  });

  it('빈 값(없음 · 공백만) 뺌 · 0 은 남김 · 빈 값 줄도 칸 이름 자리는 같다', () => {
    const rows = [{ p: '01000000001', 구매: 0, 메모: '  ' }, { p: '01000000002', 구매: '', 메모: '안내' }];
    const labels = recipientFieldLabels(rows, { phoneKey: 'p', nameKey: null });
    expect([...labels.values()]).toEqual(['구매', '메모']);
    expect(rowFields(rows[0], labels)).toEqual({ 구매: '0' });
    expect(rowFields(rows[1], labels)).toEqual({ 메모: '안내' });
  });

  it('keys 를 주면 그 키만 · labelOf 로 이름(문자 인계 = 이름 · 회신번호 · 기타1~3)', () => {
    const row = { phone: '01000000001', name: '가', extra1: 'VIP', 등급: 'VIP', _templateVars: {} };
    const labels = recipientFieldLabels([row], {
      phoneKey: 'phone', nameKey: 'name', keys: ['name', 'callback', 'extra1'],
      labelOf: (k) => ({ name: '이름', callback: '회신번호', extra1: '기타1' } as Record<string, string>)[k],
    });
    expect(rowFields(row, labels)).toEqual({ 이름: '가', 기타1: 'VIP' });
  });

  it('파일 행 + 직접입력 행이 섞인 원천 = 같은 칸 이름', () => {
    const rows = [{ phone: '01000000001', 고객명: '가', 등급: 'A' }, { phone: '01000000002', name: '나' }];
    const labels = recipientFieldLabels(rows, { phoneKey: 'phone', nameKey: 'name' });
    expect(rowFields(rows[0], labels)).toEqual({ 고객명: '가', 등급: 'A' });
    expect(rowFields(rows[1], labels)).toEqual({ 이름: '나' });
  });

  it('fieldsByPhone 같은 번호 여러 줄 = 값이 있는 첫 줄 통째 · 빈 줄은 막지 않는다(Codex 구현 1R #1 · 중복 허용 주소록)', () => {
    // 주소록 창 갱신 = 지금 명단 빈 줄(toAddrRow) + 불러온 줄 — 앞의 빈 줄이 주소록 값을 막으면 안 된다
    const rows = [
      { phone: '01000000003', name: '', extra1: '', extra2: '', extra3: '' },
      { phone: '01000000003', name: '가', extra1: 'VIP', extra2: '', extra3: '' },
      { phone: '01000000003', name: '나', extra1: '', extra2: '서울', extra3: '' },
    ];
    const labels = recipientFieldLabels(rows, { phoneKey: 'phone', nameKey: 'name', labelOf: (k) => ({ extra1: '기타1', extra2: '기타2' } as Record<string, string>)[k] });
    expect(fieldsByPhone(rows, (r) => String(r.phone), labels)).toEqual({ '01000000003': { 이름: '가', 기타1: 'VIP' } });
  });

  it('같은 번호 다른 사람 = 칸을 섞지 않는다(앞 줄 이름 + 뒤 줄 지역 조합 0 · Codex 구현 2R)', () => {
    const rows = [{ 번호: '01000000004', 이름: 'A', 지역: '' }, { 번호: '01000000004', 이름: 'B', 지역: '서울' }];
    const labels = recipientFieldLabels(rows, { phoneKey: '번호', nameKey: '이름' });
    expect(fieldsByPhone(rows, (r) => String(r.번호), labels)).toEqual({ '01000000004': { 이름: 'A' } });
    expect(firstFilledRecord({ 이름: 'A' }, { 이름: 'B', 지역: '서울' })).toEqual({ 이름: 'A' });
    expect(firstFilledRecord({}, { 이름: 'B', 지역: '서울' })).toEqual({ 이름: 'B', 지역: '서울' });
    expect(firstFilledRecord(undefined, {})).toEqual({});
  });

  it('fieldsByPhone = 번호별 · 같은 번호 두 번 = 앞 값 · 10자리 미만 건너뜀', () => {
    const rows = [
      { 번호: '010-0000-0001', 등급: 'A' },
      { 번호: '01000000001', 등급: 'B' },
      { 번호: '0101234', 등급: 'C' },
      { 번호: '01000000002', 등급: '' },
    ];
    const labels = recipientFieldLabels(rows, { phoneKey: '번호', nameKey: null });
    const out = fieldsByPhone(rows, (r) => String(r.번호 ?? '').replace(/\D/g, ''), labels);
    expect(out).toEqual({ '01000000001': { 등급: 'A' }, '01000000002': {} });
  });
});

describe('R86-a 인계 행 · 이름 칸 키', () => {
  it('recipientSeeds = 묶음 하나에 칸 이름 한 번 · 번호 빈 행 뺌', () => {
    const rows = [{ phone: '01000000001', name: '가', extra1: 'VIP' }, { phone: '', name: '나' }];
    expect(recipientSeeds(rows, (r) => String(r.phone ?? ''), { phoneKey: 'phone', nameKey: 'name', labelOf: (k) => ({ extra1: '기타1' } as Record<string, string>)[k] }))
      .toEqual([{ phone: '01000000001', fields: { 이름: '가', 기타1: 'VIP' } }]);
  });
  it('pickNameKey = name 키 먼저 · 없으면 머리 이름(고객명 · 성함 …)', () => {
    expect(pickNameKey([{ phone: '1', 고객명: '가' }, { phone: '2', name: '나' }])).toBe('name');
    expect(pickNameKey([{ phone: '1', 성함: '가' }])).toBe('성함');
    expect(pickNameKey([{ phone: '1', 등급: 'A' }])).toBeNull();
  });
  it('타겟추출 표 = 원행과 같은 길이 · 같은 순서(번호를 원행 i 에서 읽어도 짝이 맞는다)', () => {
    const raw = [{ phone: '01000000002', name: '나', gender: 'F' }, { phone: '01000000001', name: '가', gender: 'M' }];
    const meta = [
      { field_key: 'phone', display_name: '휴대폰', variable: '%휴대폰%', data_type: 'string', category: 'basic' },
      { field_key: 'name', display_name: '고객명', variable: '%고객명%', data_type: 'string', category: 'basic' },
      { field_key: 'gender', display_name: '성별', variable: '%성별%', data_type: 'string', category: 'basic' },
    ];
    const t = extractionRowsToTable(raw, meta);
    expect(t.data.length).toBe(raw.length);
    const out = fieldsByPhone(t.data, (_, i) => raw[i].phone, recipientFieldLabels(t.data, { phoneKey: t.mapping.phone ?? '', nameKey: t.mapping.name ?? null }));
    expect(out['01000000002'].이름).toBe('나');
    expect(out['01000000001'].이름).toBe('가');
    expect(Object.keys(out['01000000001'])).toEqual(['이름', '성별']);
  });
  it('extractionFieldTable = 추출 표 + meta 에 이름 항목이 없으면 원행 이름 보존(Codex 구현 1R #2)', () => {
    const raw = [{ phone: '01000000001', name: '가', gender: 'F' }];
    const gender = { field_key: 'gender', display_name: '성별', variable: '%성별%', data_type: 'string', category: 'basic' };
    const phone = { field_key: 'phone', display_name: '휴대폰', variable: '%휴대폰%', data_type: 'string', category: 'basic' };
    const nameM = { field_key: 'name', display_name: '고객명', variable: '%고객명%', data_type: 'string', category: 'basic' };
    const view = (t: ReturnType<typeof extractionFieldTable>) => fieldsByPhone(t.rows, (_, i) => raw[i].phone, recipientFieldLabels(t.rows, { phoneKey: t.phoneKey, nameKey: t.nameKey }));
    // 조건 항목만 받은 meta(이름 · 번호 항목 없음)
    expect(view(extractionFieldTable(raw, [gender]))).toEqual({ '01000000001': { 이름: '가', 성별: '여성' } });
    // 항목 목록 전체 = 표 그대로(이름 = 항목 이름 칸)
    expect(view(extractionFieldTable(raw, [phone, nameM, gender]))).toEqual({ '01000000001': { 이름: '가', 성별: '여성' } });
  });
});

describe('R86-b 브랜드 창 — 명단을 바꾸는 자리 전수', () => {
  const modal = src('frontend/src/components/BrandSendModal.tsx');
  const units = unitsOf(modal);
  const OPEN_HEAD = 'useEffect(() => {\n    if (!show) return;\n    reqSeqRef.current++;';
  const openStart = modal.indexOf(OPEN_HEAD);
  const openEnd = modal.indexOf('}, [show]);', openStart);

  it('R86-b1 setPhones 쓰기 = setRecipients · updateRecipients 몸 · 창 열기 effect 세 자리뿐', () => {
    expect(openStart).toBeGreaterThan(0);
    const owners = [...modal.matchAll(/\bsetPhones\(/g)].map((m) => {
      const pos = m.index!;
      if (pos > openStart && pos < openEnd) return 'open';
      const u = unitAt(units, pos)!;
      return u.name === 'setRecipients' || u.name === 'updateRecipients' ? u.name : `분류 없음(${u.name})`;
    });
    expect(owners.sort()).toEqual(['open', 'setRecipients', 'updateRecipients']);
  });

  it('R86-b2 setRecipients · updateRecipients 호출 자리 = 분류표와 같다 · 원천 행을 받는 자리 = 칸 CT 를 부른다', () => {
    // 분류표(이 표에 없는 새 자리 = 빨강). rows = 원천 행을 받는다 → 같은 함수 안 fieldsByPhone 호출 / none = 원천 행 없음(붙여넣기 · 지우기)
    const TABLE: Record<string, { kind: 'rows' | 'none'; count: number }> = {
      'addFromDraft:setRecipients': { kind: 'none', count: 1 },
      'addFromColumn:setRecipients': { kind: 'rows', count: 1 },
      'setAddrRows:updateRecipients': { kind: 'rows', count: 1 },
      'handleTargetExtracted:setRecipients': { kind: 'rows', count: 1 },
      'recipientsPanel:setRecipients': { kind: 'none', count: 2 },   // 선택삭제 · 전체삭제
    };
    const seen: Record<string, number> = {};
    for (const m of modal.matchAll(/\b(setRecipients|updateRecipients)\(/g)) {
      const u = unitAt(units, m.index!)!;
      if (u.name === m[1]) continue;   // 정의
      const key = `${u.name}:${m[1]}`;
      seen[key] = (seen[key] || 0) + 1;
      expect(TABLE[key], `분류표에 없는 명단 쓰기 자리: ${key}`).toBeDefined();
      if (TABLE[key].kind === 'rows') expect(u.body, key).toMatch(/\bfieldsByPhone\(/);
    }
    expect(seen).toEqual(Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, v.count])));
    // 지우기 두 자리 = 원천 행 없음(인자 그대로)
    const panel = units.find((u) => u.name === 'recipientsPanel')!.body;
    const args = [...panel.matchAll(/\bsetRecipients\(/g)].map((m) => argsAt(panel, m.index! + 'setRecipients'.length).replace(/\s+/g, ' '));
    expect(args).toEqual(['phones.filter((_, i) => !listSelected.has(i))', '[]']);
  });

  it('R86-b3 창 열기 = 인계 행의 fields 로 칸 · 옛 이름 상태 잔존 0', () => {
    const body = modal.slice(openStart, openEnd);
    expect(body).toContain('if (p) seededFields[p] = firstFilledRecord(seededFields[p], r?.fields ?? {});');
    expect(body).toContain('setFields(seededFields);');
    expect(modal).not.toMatch(/\bsetNames\b|\bmergeNames\b|\bnamesByPhone\b|\bnames\[/);
    expect(src('frontend/src/utils/recipient-paste.ts')).not.toMatch(/\bnamesByPhone\b/);
    // 합치기 = 값이 있는 묶음 통째 우선(칸을 섞지 않는다 · 공용 규칙) · 빠진 번호 걷기
    expect(modal).toContain('next[p] = firstFilledRecord(prev[p], f);');
    expect(modal).toMatch(/useEffect\(\(\) => \{\s*setFields\(\(prev\) => \{\s*const keep = new Set\(phones\);[\s\S]*?\}, \[phones\]\);/);
  });
});

describe('R86-c · d · e 인계 · 타겟추출 · 발송 값', () => {
  const modal = src('frontend/src/components/BrandSendModal.tsx');
  const dash = src('frontend/src/pages/Dashboard.tsx');

  it('R86-c 대시보드 인계 = 빈 배열이 아니면 recipientSeeds(칸을 싣는 CT)', () => {
    const args = [...dash.matchAll(/\bsetBrandInitialRecipients\(/g)].map((m) => argsAt(dash, m.index! + 'setBrandInitialRecipients'.length).trim());
    const seeds = args.filter((a) => a !== '[]');
    expect(seeds.length).toBe(3);
    for (const a of seeds) expect(a, a).toMatch(/^recipientSeeds\(/);
  });

  it('R86-d 타겟추출 = 추출 창이 넘긴 meta 로 추출 표 CT extractionFieldTable(창 안 · 직접 타겟 인계 둘 다)', () => {
    expect(modal).toContain('onExtracted={(ext, meta) => { void handleTargetExtracted(ext, meta); }}');
    expect(modal).toContain('const t = extractionFieldTable(raw, meta);');
    expect(dash).toContain('const t = extractionFieldTable(raw, targetFieldsMeta);');
    expect(modal + dash).not.toMatch(/extractionRowsToTable\(/);   // 브랜드 길은 CT 하나로만
  });

  it('R86-e 발송 payload 에 칸 0(번호만 · C117 B2-d 그대로)', () => {
    expect(modal).toContain('await onSend({ ...payload, phones: sendPhones });');
    for (const m of modal.matchAll(/\bonSend\(/g)) expect(argsAt(modal, m.index! + 'onSend'.length)).not.toMatch(/fields/);
  });
});

describe('R85-f 명단 표 그릇(칸이 늘어도 받는다)', () => {
  const css = readFileSync(join(PKG, 'frontend/src/styles/direct-send.css'), 'utf8').replace(/\r\n/g, '\n');
  it('한 그릇 = 가로 · 세로 스크롤 · 머리는 위에 붙음 · 머리와 줄 = 같은 격자 · 같은 최소 폭', () => {
    expect(css).toMatch(/\.ks-recipients \.ks-list-scroll \{[^}]*overflow:\s*auto/);
    expect(css).toMatch(/\.ks-recipients \.ks-list-scroll > \.ds-list-head \{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.ks-recipients \.ks-list-scroll \.ds-list-head,\s*\.ks-recipients \.ks-list-scroll \.ds-list-row \{[^}]*grid-template-columns:[^;]*var\(--ks-cols[^}]*min-width:[^;]*var\(--ks-cols/);
    expect(src('frontend/src/components/BrandSendModal.tsx')).toMatch(/className="ks-list-scroll" style=\{\{ '--ks-cols': fieldCols\.length \}/);
  });
});
