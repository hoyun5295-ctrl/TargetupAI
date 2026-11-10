/**
 * C104 · 같은 사실 = 같은 입력 — 계약 시험(★ 2026-11-05 설계서 docs/2026-11-05-c104-same-fact-same-input-design.md §6)
 *
 * R58 = 같은 함수를 불러도 입력이 다르면 두 벌(켜기 관문이 칸 글로 · 켜기 검증이 나갈 판으로 판정 · 세는 자리가 계보 · 재진입 없이 셈).
 * 대상은 소스에서 기계로 뽑는다(손 등재 표 = 이유 붙은 허용 목록만).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { intakeGraceHeldText } from '../journey-intake-grace';
import { journeyGraceHeldText } from '../../../../frontend/src/utils/journey-cap-copy';
import { AB_STEP_COPY_LOCKED_MESSAGE, AB_STEP_COPY_LOCKED_DRAFT_MESSAGE, abStepCopyLockedMessage } from '../journey-builder';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const load = (dir: string) => walk(join(PKG, dir)).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const backend = load('backend/src');
const frontend = load('frontend/src');
const read = (rel: string) => {
  const f = [...backend, ...frontend].find((x) => x.rel === rel);
  if (!f) throw new Error(`파일 없음 ${rel}`);
  return f.text;
};

/** 위치를 감싼 함수 · 주소 본문(가장 가까운 앞 머리 ~ 다음 머리) */
const enclosing = (text: string, idx: number): { name: string; body: string } => {
  const heads = [...text.matchAll(/^(?:export )?(?:async )?function (\w+)|^router\.\w+\(/gm)].map((m) => ({ at: m.index!, name: m[1] || 'router' }));
  const h = heads.filter((x) => x.at <= idx).pop() ?? { at: 0, name: '(파일 머리)' };
  const end = heads.find((x) => x.at > idx)?.at ?? text.length;
  return { name: h.name, body: text.slice(h.at, end) };
};

/** 여는 괄호 다음부터 짝 괄호까지 = 인자 글 · 최상위 쉼표로 나눈 인자 목록 */
const callArgs = (text: string, openParen: number): { raw: string; args: string[] } => {
  let depth = 0;
  let i = openParen;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; if (depth === 0) break; }
  }
  const raw = text.slice(openParen + 1, i);
  const args: string[] = [];
  let d = 0; let cur = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[' || ch === '{') d += 1;
    if (ch === ')' || ch === ']' || ch === '}') d -= 1;
    if (ch === ',' && d === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return { raw, args };
};

/** 위치를 감싼 가장 가까운 `const 이름 = (` 화살표 함수 이름(컴포넌트 안 처리기) */
const enclosingConst = (text: string, idx: number): string => {
  const heads = [...text.slice(0, idx).matchAll(/\n\s*const (\w+) = (?:async )?\(/g)];
  return heads.length > 0 ? heads[heads.length - 1][1] : '';
};
/** 감싼 함수 안 선언 → 식(`const|let 이름 = 식;` · `for (const 이름 of 식) {`) · 없으면 null(함수 인자 · 바깥 값) */
const declOf = (body: string, id: string): string | null => {
  const m = new RegExp(`(?:const|let)\\s+${id}\\s*(?::[^=;]+)?=\\s*([^;]+);`).exec(body)
    || new RegExp(`for \\((?:const|let) ${id} of ([\\s\\S]*?)\\) \\{`).exec(body);
  return m ? m[1].trim() : null;
};
const NOT_ROOT = new Set(['String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'await', 'new', 'null', 'undefined', 'true', 'false', 'typeof', 'void']);
/** 식의 뿌리 식별자(속성 이름 · 객체 키 · 문자열 · 화살표 인자 · 전역 제외) */
const rootsOf = (expr: string): string[] => {
  const noStr = expr.replace(/`[^`]*`|'[^']*'|"[^"]*"/g, "''");
  const arrow = new Set([...noStr.matchAll(/\(\s*(\w+)\s*\)\s*=>|(\w+)\s*=>/g)].map((m) => m[1] || m[2]));
  const out = new Set<string>();
  for (const m of noStr.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)(?!\s*:(?!:))/g)) {
    const id = m[1];
    if (NOT_ROOT.has(id) || arrow.has(id)) continue;
    if (noStr[m.index! + id.length] === '(') continue;   // 함수 호출 이름
    out.add(id);
  }
  return [...out];
};
const RAW_TEXT = /message_template|\bs\.message\b|\.messageTemplate/;
/** 그 값의 출처 = 'send'(나갈 판 CT) · 'raw'(칸 행 글) · 'other' · 'param'(선언 없음) */
const traceText = (body: string, expr: string, depth = 0): 'send' | 'raw' | 'other' | 'param' => {
  if (expr.includes('stepSendVersions(')) return 'send';
  if (RAW_TEXT.test(expr)) return 'raw';
  if (depth > 4) return 'other';
  const verdicts = rootsOf(expr).map((id) => { const d = declOf(body, id); return d == null ? 'param' as const : traceText(body, d, depth + 1); });
  if (verdicts.includes('raw')) return 'raw';
  if (verdicts.includes('send')) return 'send';
  return verdicts.length > 0 && verdicts.every((v) => v === 'param') ? 'param' : 'other';
};
/** 판정 인자(첫 인자)가 나갈 판 CT 에서 왔는가 */
const judgeArgVerdict = (body: string, firstArg: string): 'send' | 'raw' | 'other' | 'param' => traceText(body, firstArg);
/** 대상 인자가 진입 입력 CT 결과(`const X = await journeyEntryInputs(` 의 X.필드 · 또는 X 자체)에서 왔는가 */
const fromEntryInputs = (body: string, arg: string, field: 'scopeSql' | 'consent' | 'reentry' | null, depth = 0): boolean => {
  const a = arg.trim();
  const isCt = (id: string) => /^await journeyEntryInputs\(/.test(declOf(body, id) ?? '');
  if (field == null) return /^\w+$/.test(a) && isCt(a);
  const m = new RegExp(`^(\\w+)\\.${field}$`).exec(a);
  if (m) return isCt(m[1]);
  if (/^\w+$/.test(a) && depth < 3) { const d = declOf(body, a); return d != null && fromEntryInputs(body, d, field, depth + 1); }
  return false;
};

describe('C1 R58 · 칸 글 판정 = 나갈 판(stepSendVersions) 입력 · 칸 행 글 직접 읽기 0', () => {
  const JUDGE = /\b(journeyCopyIssue|hasUneditedPlaceholder|hasUneditedJourneyPlaceholder)\(/g;
  const ALLOW: Record<string, string> = {
    'backend/src/utils/journey-builder.ts#hasUneditedPlaceholder': '판정 함수 자체(이름만 감싼다)',
    'backend/src/utils/journey-builder.ts#assertStepCopySendable': '사람이 고친 기본 문안 자체를 판정(★ C104 G3 A/B 칸은 기본 문안 고침이 막혀 고친 칸 = 나갈 글)',
  };
  const files = backend.filter((f) => /^backend\/src\/(utils\/journey-[^/]+|routes\/ai)\.ts$/.test(f.rel));
  const sites: Array<{ key: string; name: string; body: string; args: string }> = [];
  for (const f of files) {
    for (const m of f.text.matchAll(JUDGE)) {
      const lineStart = f.text.lastIndexOf('\n', m.index!) + 1;
      const line = f.text.slice(lineStart, f.text.indexOf('\n', m.index!));
      if (/^\s*(\/\/|\*|import\b)/.test(line) || /(export )?function \w+\(/.test(line.slice(0, m.index! - lineStart + m[0].length))) continue;
      const enc = enclosing(f.text, m.index!);
      const ca = callArgs(f.text, m.index! + m[0].length - 1);
      sites.push({ key: `${f.rel}#${enc.name}`, name: enc.name, body: enc.body, args: ca.args[0] ?? '' });
    }
  }
  it('판정 자리가 있다(소스 추출 · 켜기 관문 · 켜기 검증 · 실행기 · 보류 관문 · 담당자 안내 · 채우기)', () => {
    const names = new Set(sites.map((s) => s.key));
    expect(names.has('backend/src/utils/journey-builder.ts#activationBlockCore')).toBe(true);
    expect(names.has('backend/src/utils/journey-builder.ts#fillJourneyCopyFacts')).toBe(true);
    expect(names.has('backend/src/utils/journey-pretest-validator.ts#validateJourneyForActivation')).toBe(true);
    expect(sites.length).toBeGreaterThanOrEqual(8);
  });
  it('판정 인자 = 나갈 판 CT(stepSendVersions) 결과에서 온 값(선언을 따라 올라가 출처 확인 · 칸 행 글 · 별칭 0)', () => {
    const bad = sites.filter((s) => !ALLOW[s.key])
      .map((s) => ({ s, v: judgeArgVerdict(s.body, s.args) }))
      .filter(({ v }) => v !== 'send')
      .map(({ s, v }) => `${s.key}: ${v} · ${s.args.slice(0, 80)}`);
    expect(bad).toEqual([]);
  });
  it('반례 = 칸 글 별칭 · 다른 출처는 잡는다(출처 추적 자체의 시험)', () => {
    const alias = `const versions = stepSendVersions(step, null, rows);\n  const body = String(s.message || '').trim();\n  if (hasUneditedPlaceholder(body)) return 1;`;
    expect(judgeArgVerdict(alias, 'body')).toBe('raw');
    const alias2 = `const t = row.message_template;\n  const b = t.trim();`;
    expect(judgeArgVerdict(alias2, '{ bodies: [b], subjects: [null] }')).toBe('raw');
    const other = `const versions = stepSendVersions(step, null, rows);\n  const b = await readSomething();`;
    expect(judgeArgVerdict(other, 'b')).toBe('other');
    const ok = `for (const ver of stepSendVersions({ message_template: s.message ?? null, subject: null }, null, abRows)) {\n  const body = String(ver.body || '').trim();`;
    expect(judgeArgVerdict(ok, '{ bodies: [body], subjects: [ver.subject] }')).toBe('send');
  });
  it('허용 목록은 실제로 쓰인다(죽은 허용 0)', () => {
    const used = new Set(sites.map((s) => s.key));
    expect(Object.keys(ALLOW).filter((k) => !used.has(k))).toEqual([]);
  });
  it('켜기 관문 판 목록 = 켜기 검증과 같은 규칙(카카오 칸만 판 없음) · 판마다 원인 · 판 표시', () => {
    const b = read('backend/src/utils/journey-builder.ts');
    const core = enclosing(b, b.indexOf('async function activationBlockCore(')).body;
    expect(core).toContain("const abRows = channel === 'kakao' ? [] : (abByStep.get(String(s.id)) ?? []);");
    expect(core).toContain('for (const ver of stepSendVersions({ message_template: s.message ?? null, subject: s.subject ?? null }, null, abRows)) {');
    expect(read('backend/src/utils/journey-pretest-validator.ts')).toContain("step.channel === 'kakao' ? [] : await loadStepVariantRows(step.step_id),");
  });
});

describe('C2 R58 · 여정 대상 세기 입력 = 진입 입력 CT(journeyEntryInputs) 결과 값', () => {
  // 함수 → [여정 id 위치, (인자 위치 · 진입 입력 CT 의 어느 값인가 · null = 묶음 자체)]
  type F = 'scopeSql' | 'consent' | 'reentry' | null;
  const SPEC: Record<string, { jid: number; need: Array<[number, F]> }> = {
    selectJourneyTargetCustomerIds: { jid: 4, need: [[5, 'reentry'], [6, 'scopeSql'], [7, 'consent']] },
    countJourneyTargets: { jid: 3, need: [[4, 'scopeSql'], [5, 'consent'], [6, 'reentry']] },
    countJourneyTargetCustomers: { jid: 3, need: [[4, 'scopeSql'], [5, 'consent'], [6, 'reentry']] },
    countJourneyTargetsWithGrace: { jid: 3, need: [[4, null]] },
    averageTargetScores: { jid: 3, need: [[4, 'scopeSql'], [5, 'consent'], [6, 'reentry']] },
    storeCallbackExposure: { jid: 4, need: [[5, 'scopeSql'], [6, 'consent'], [7, 'reentry']] },
  };
  const ALLOW_FILE: Record<string, string> = {
    'backend/src/utils/journey-target-extractor.ts': '추출 파일 내부 위임(countJourneyTargetCustomers → countJourneyTargets · 인자를 그대로 넘긴다)',
  };
  const sites: string[] = [];
  const passed: string[] = [];
  for (const f of backend) {
    if (ALLOW_FILE[f.rel]) continue;
    for (const m of f.text.matchAll(/\b(selectJourneyTargetCustomerIds|countJourneyTargets|countJourneyTargetCustomers|countJourneyTargetsWithGrace|averageTargetScores|storeCallbackExposure)\(/g)) {
      const lineStart = f.text.lastIndexOf('\n', m.index!) + 1;
      const head = f.text.slice(lineStart, m.index!);
      if (/^\s*(\/\/|\*)/.test(head) || /\bimport\b|function\s*$|\{\s*$/.test(head) && !/=\s*$|\(\s*$|await\s*$/.test(head)) continue;
      const spec = SPEC[m[1]];
      const { args } = callArgs(f.text, m.index! + m[0].length - 1);
      if (args.length <= spec.jid) continue;
      const jid = args[spec.jid];
      if (jid === 'undefined') continue;   // 여정 없음(만들기 전 미리보기 · 표본 고객)
      const enc = enclosing(f.text, m.index!);
      const tag = `${f.rel}#${enc.name}:${m[1]}`;
      const miss = spec.need.filter(([at, field]) => !fromEntryInputs(enc.body, args[at] ?? '', field)).map(([at]) => `인자 ${at} = ${args[at] ?? '(없음)'}`);
      if (miss.length > 0) sites.push(`${tag} — ${miss.join(' · ')}`);
      else passed.push(tag);
    }
  }
  it('여정 id 를 넘기는 세기 자리 = 진입 감시 · 옵션 dryRun · 시뮬레이터 · 대상 목록 · 미등록 매장번호가 잡힌다(소스 추출)', () => {
    const joined = passed.join('\n');
    expect(joined).toContain('backend/src/utils/journey-trigger-watcher.ts#processJourneyTrigger:selectJourneyTargetCustomerIds');
    expect(joined).toContain('backend/src/utils/journey-simulator.ts#simulateJourney:countJourneyTargetsWithGrace');
    expect(joined).toContain('backend/src/utils/journey-simulator.ts#simulateJourney:averageTargetScores');
    expect(joined).toContain('backend/src/utils/journey-activation.ts');
    expect(passed.filter((p) => p.startsWith('backend/src/routes/ai.ts')).length).toBeGreaterThanOrEqual(4);
  });
  it('그 자리마다 범위 · 동의 · 재진입 인자 = 감싼 함수의 journeyEntryInputs 결과 값(선언을 따라 올라가 출처 확인)', () => {
    expect(sites).toEqual([]);
  });
  it('반례 = 다른 객체의 같은 이름 값 · 결과를 버린 자리는 잡는다(출처 추적 자체의 시험)', () => {
    const body = `const entry = await journeyEntryInputs(companyId, jid);\n  const other = { scopeSql: '', consent: undefined };\n  const scope = entry.scopeSql;\n  const fake = other.scopeSql;`;
    expect(fromEntryInputs(body, 'entry.scopeSql', 'scopeSql')).toBe(true);
    expect(fromEntryInputs(body, 'scope', 'scopeSql')).toBe(true);
    expect(fromEntryInputs(body, 'other.scopeSql', 'scopeSql')).toBe(false);
    expect(fromEntryInputs(body, 'fake', 'scopeSql')).toBe(false);
    expect(fromEntryInputs(body, "''", 'scopeSql')).toBe(false);
    expect(fromEntryInputs(body, 'entry', null)).toBe(true);
    expect(fromEntryInputs(body, 'other', null)).toBe(false);
  });
  it('진입 입력 CT = 여정 행 재진입 · 계보 · 작성자 범위 · 작성자 동의(실제 진입과 같은 넷)', () => {
    const ext = read('backend/src/utils/journey-target-extractor.ts');
    const ct = enclosing(ext, ext.indexOf('export async function journeyEntryInputs(')).body;
    for (const s of ['lineageIds: await lineageJourneyIds(journeyId)', 'scopeSql: await getJourneyOwnerScopeSql(companyId, journeyId),', 'consent: await journeyOwnerConsent(companyId, journeyId),', 'SELECT allow_reentry, reentry_cooldown_days, trigger_event FROM journeys', 'floorDays: reentryFloorDays(row.trigger_event)']) {   // ★ 1110 C123(R87) 시작 사건 = 재진입 최솟값
      expect(ct).toContain(s);
    }
  });
  it('유예 갈라 세기 = 이관 유예 조각 함수 그대로(같은 식) · 유예를 끈 대상 SQL 위에서', () => {
    const ext = read('backend/src/utils/journey-target-extractor.ts');
    const fn = enclosing(ext, ext.indexOf('export async function countJourneyTargetsWithGrace(')).body;
    expect(fn).toContain("const ready = buildIntakeGraceClause('c', params, graceDays) ?? 'TRUE';");
    expect(fn).toContain('graceDays > 0 ? { ...filters, intake_grace_days: 0 } : filters');
    expect(fn).toContain('COUNT(*) FILTER (WHERE NOT (${ready}))::int AS held');
  });
});

describe('C1 화면 R58 · 여정 화면의 채울 자리 판정 = 나갈 글(abSendCopies) 입력', () => {
  it('여정 화면에서 혜택 · 링크 자리 판정(hasBenefitPlaceholder · hasUrlPlaceholder)을 부르는 memo · 함수마다 abSendCopies 를 부른다(소스 추출)', () => {
    const files = frontend.filter((f) => f.rel.startsWith('frontend/src/components/journey/'));
    const sites: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/\b(hasBenefitPlaceholder|hasUrlPlaceholder)\b(?!\s*[,}])/g)) {
        const line = f.text.slice(f.text.lastIndexOf('\n', m.index!) + 1, f.text.indexOf('\n', m.index!));
        if (/^\s*(import|\/\/|\*)/.test(line)) continue;
        const head = Math.max(f.text.lastIndexOf('useMemo(', m.index!), f.text.lastIndexOf('function ', m.index!));
        sites.push(`${f.rel}:${f.text.slice(head, m.index!).includes('abSendCopies(') ? 'ok' : '칸 글'}`);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(sites.filter((x) => !x.endsWith(':ok'))).toEqual([]);
  });
  it('A/B 목록 그리기 = abSendCopies(판 글이 비면 칸 글 · 서버 applyVariantToStep 와 같은 규칙)', () => {
    const list = read('frontend/src/components/journey/JourneyAbCopyList.tsx');
    expect(list).toContain('{abSendCopies(variants, baseBody, baseSubject).map((c, i) => (');
    expect(list).toContain("return list.map((v) => ({ body: v.message_template || baseBody || '', subject: v.subject || baseSubject || '' }));");
  });
  it('A/B 창의 쓰기(POST · DELETE)는 모두 writeFetch 하나 · 요청이 끝나면(성공 · 실패 모두) 부모에 알림(소스 추출 · 알림 = 효과가 생기는 쓰기 자리)', () => {
    const ed = read('frontend/src/components/journey/JourneyVariantsEditor.tsx');
    const ALLOW: Record<string, string> = { 'auto-generate': 'AI 후보만 만든다(저장 0 · 넣기는 AI 판 넣기 갈래 = writeFetch)' };
    const writes: string[] = [];
    for (const m of ed.matchAll(/method: '(POST|DELETE)'/g)) {
      const call = ed.lastIndexOf('etch(', m.index!);   // fetch( · writeFetch( 둘 다
      const head = ed.slice(Math.max(0, call - 6), call);
      const url = ed.slice(call, m.index!);
      writes.push(Object.keys(ALLOW).some((k) => url.includes(k)) ? 'allow' : head.endsWith('writeF') ? 'ok' : `직접 fetch @${m.index}`);
    }
    expect(writes.filter((w) => w === 'ok')).toHaveLength(5);
    expect(writes.filter((w) => w !== 'ok' && w !== 'allow')).toEqual([]);
    expect(ed).toContain('try { return await fetch(url, init); } finally { onCopyChangedRef.current?.(); }');
    expect(ed).not.toMatch(/afterCopyWrite|loadedOnce/);
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    expect(ws.match(/onCopyChanged=\{onVariantsCopyChanged\}/g) || []).toHaveLength(2);
    expect(ws).toContain("const onVariantsCopyChanged = () => { if (journeyId) void load(journeyId, false, 'sync'); };");
  });
  it('A/B 창을 여는 길 = openVariants 하나(그 밖 setVariantsOpen 은 닫기 null 뿐 · 고친 칸 글이 있으면 열지 않음)', () => {
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    const opens = [...ws.matchAll(/setVariantsOpen\(([^)]*)\)/g)].map((m) => ({ arg: m[1].trim(), fn: enclosingConst(ws, m.index!) }));
    expect(opens.filter((o) => o.arg !== 'null' && o.fn !== 'openVariants')).toEqual([]);
    const fn = ws.slice(ws.indexOf('const openVariants = (id: string) => {'), ws.indexOf('\n  };', ws.indexOf('const openVariants = (id: string) => {')));
    expect(fn).toContain("Object.keys(patchOf(id)).some((k) => k === 'messageTemplate' || k === 'subject')");
    expect((ws.match(/openVariants\(selRaw\.id\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('C3 G3 · A/B 칸 = 상태 무관 잠금 · 문구 한 쌍(화면 · 서버 같은 글)', () => {
  it('화면 abCopyLocked 에 상태 조건 0 · 서버 A/B 잠금에 상태 조건 0', () => {
    const list = read('frontend/src/components/journey/JourneyAbCopyList.tsx');
    const fn = list.slice(list.indexOf('export function abCopyLocked('), list.indexOf('\n}\n', list.indexOf('export function abCopyLocked(')));
    expect(fn).not.toMatch(/status|active/);
    const b = read('backend/src/utils/journey-builder.ts');
    const upd = enclosing(b, b.indexOf('export async function updateJourneyStep(')).body;
    const lockAt = upd.indexOf("'AB_STEP_COPY_LOCKED'");
    const lockIf = upd.slice(upd.lastIndexOf('if (', upd.lastIndexOf('loadVariantRowsByStep([stepId], run)', lockAt)), lockAt);
    expect(lockIf).not.toMatch(/status\s*===/);
  });
  it('문구 = 화면 · 서버 같은 글 · 같은 판정(켜짐 = 옛 글 · 그 밖 = 초안 글)', () => {
    const list = read('frontend/src/components/journey/JourneyAbCopyList.tsx');
    expect(list).toContain(`export const AB_STEP_COPY_LOCKED_MESSAGE = '${AB_STEP_COPY_LOCKED_MESSAGE}';`);
    expect(list).toContain(`export const AB_STEP_COPY_LOCKED_DRAFT_MESSAGE = '${AB_STEP_COPY_LOCKED_DRAFT_MESSAGE}';`);
    expect(list).toContain("return status === 'active' ? AB_STEP_COPY_LOCKED_MESSAGE : AB_STEP_COPY_LOCKED_DRAFT_MESSAGE;");
    expect(list).toContain('{abStepCopyLockedMessage(journeyStatus)}');
    expect(abStepCopyLockedMessage('active')).toBe('A/B 문안이 있는 칸은 A/B 창에서 고치거나 모양 바꾸기로 고쳐 주세요.');
    expect(abStepCopyLockedMessage('draft')).toBe('A/B 문안이 있는 칸은 A/B 창에서 고쳐 주세요. A/B 문안을 모두 지우면 이 칸 문안으로 나가요.');
    expect(abStepCopyLockedMessage('paused')).toBe(abStepCopyLockedMessage('draft'));
  });
  it('잠긴 A/B 칸에서도 「혜택 · 링크」 줄이 보인다(SC-13)', () => {
    const studio = read('frontend/src/components/journey/JourneyStepStudio.tsx');
    expect(studio).not.toContain('{!copyLock && factsRow && (');
    expect(studio).toContain('{factsRow && (');
  });
});

describe('C4 G2 · 혜택 · 링크 넣기 = 초안 · 멈춘 여정 A/B 판까지 · 켜진 여정 = 남은 판 수를 말한다', () => {
  const b = read('backend/src/utils/journey-builder.ts');
  const fill = enclosing(b, b.indexOf('export async function fillJourneyCopyFacts(')).body;
  it('초안 · 멈춤 = journey_step_variants 갱신(같은 잠금 · 같은 run) · 켜진 여정 = 갱신 0 + variantsLeft', () => {
    expect(fill).toContain('UPDATE journey_step_variants SET message_template = $3, subject = $4 WHERE id = $1::uuid AND step_id = $2::uuid');
    const activeAt = fill.indexOf("if (journey.status === 'active') {");
    const elseAt = fill.indexOf('} else {', activeAt);
    expect(activeAt).toBeGreaterThan(-1);
    expect(fill.slice(activeAt, elseAt)).not.toContain('UPDATE journey_step_variants');
    expect(fill.slice(activeAt, elseAt)).toContain('variantsLeft += 1');
    expect(fill).toContain('return { steps: out, variantsLeft };');
  });
  it('주소가 variantsLeft 를 싣고 화면이 그 수를 말한다(거짓 「모두 넣었어요」 0)', () => {
    expect(read('backend/src/routes/ai.ts')).toContain('return res.json({ success: true, steps: out.steps, variantsLeft: out.variantsLeft });');
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    expect(ws).toContain('const left = Number(r.data?.variantsLeft) || 0;');
    expect(ws).toContain('if (left > 0) toast.warning(`${done} A/B 문안 ${left}개는 A/B 창에서 넣어 주세요.`);');
  });
});

describe('C5 G6 · 이관 유예로 빠진 수 = 문구 CT 한 쌍 · 시작 카드 · 시뮬레이터가 부른다', () => {
  it('화면 · 서버 같은 글(손으로 쓴 기대 글)', () => {
    const want = '등록한 지 7일이 안 된 155명은 지금 빠져 있어요. 7일이 지난 뒤에도 조건에 맞으면 들어와요.';
    expect(intakeGraceHeldText(7, 155)).toBe(want);
    expect(journeyGraceHeldText(7, 155)).toBe(want);
    expect(journeyGraceHeldText(7, 1084)).toBe(intakeGraceHeldText(7, 1084));
    expect(intakeGraceHeldText(7, 1084)).toContain('1,084명');
  });
  it('시작 카드 · 시뮬레이터 · 옵션 dryRun 이 부른다', () => {
    expect(read('frontend/src/components/journey/workspace/JourneyStartCard.tsx')).toContain('journeyGraceHeldText(count.graceDays ?? 0, count.graceHeld ?? 0)');
    expect(read('backend/src/utils/journey-simulator.ts')).toContain('if (!approximate && graceHeld > 0) warnings.push(intakeGraceHeldText(graceDays, graceHeld));');
    expect(read('backend/src/routes/ai.ts')).toContain('graceHeld: grace?.graceHeld ?? 0, graceDays: grace?.graceDays ?? 0 });');
    expect(read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx')).toContain('graceHeld: Number(r.data.graceHeld) || 0, graceDays: Number(r.data.graceDays) || 0');
  });
  it('시뮬레이터 = 사건형 · 이어받기 근사 표시(시작 카드와 같은 판정 STANDING_COUNT_TRIGGERS)', () => {
    expect(read('backend/src/utils/journey-simulator.ts')).toContain("const approximate = !STANDING_COUNT_TRIGGERS.has(String(journey.trigger_event || ''));");
    expect(read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx')).toContain("sim.data.approximate ? '들어올 고객(최근 사건 기준)' : '들어올 고객'");
  });
});

describe('G4 · 지도 칸 미리보기 = 나갈 판', () => {
  it('A/B 판이 있으면 「A/B N개 · 」 + 첫 판 글(stepSendVersions)', () => {
    const map = read('backend/src/utils/journey-lifecycle-map.ts');
    expect(map).toContain("const ab = s.channel === 'kakao' ? [] : (abByStep.get(String(s.id)) ?? []);");
    expect(map).toContain('s.preview = `A/B ${ab.length}개 · ${first.body.slice(0, 60)}`;');
  });
});

describe('G7 · 점검 판 = 같은 칸 · 같은 판 · 같은 원인만 합친다', () => {
  it('관문 결과 = 구조(칸 · 판 · 원인) · 합치기 키 = 켜기 검증 실패 항목 key(원인:판)', () => {
    const chk = read('backend/src/utils/journey-check.ts');
    expect(chk).toContain('const dupKey = `${issue.cause}:${issue.variantId ?? \'main\'}`;');
    expect(chk).toContain("const base = { key: `${f.reason}:${f.variantId ?? 'main'}`, variantId: f.variantId };");
    expect(chk).toContain("const dup = (steps[stepId] ?? []).some((i) => i.level === 'fix' && i.key === dupKey);");
  });
});
