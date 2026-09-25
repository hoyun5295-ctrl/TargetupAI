/**
 * ★ 2026-09-25 직접입력 창 통일(문자 발송 · 알림톡 · 브랜드메시지) 계약 — Harold 목업 v2 승인.
 *
 *  1. 번호 읽기 규칙은 세 창의 원래 식 그대로 공용 유틸로 옮겼다(결과가 같아야 한다).
 *  2. 창이 입력하는 동안 보여 주는 검수와 실제 더하기가 같은 함수를 쓴다(보인 수 = 더해진 수).
 *  3. 알림톡 붙여넣기 = 더하기(예전 = 통째 교체) · 칸 목록·자동 연결·목록 칸 = 명단 전체 칸.
 *  4. 문자 발송 더하기 규칙은 그대로(여러 줄 = 전부 더함 · 한 건씩 = 한 줄) · 브랜드 = 원래 Set 식.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(resolve(FRONT, p), 'utf8').replace(/\r\n/g, '\n');
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(`시작 표식 없음: ${a}`);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error(`끝 표식 없음: ${b}`);
  return src.slice(i, j);
};
const load = async () => import('../../../../frontend/src/utils/recipient-paste');
const loadFmt = async () => import('../../../../frontend/src/utils/formatDate');

describe('1. 번호 읽기 — 원래 식과 같은 결과', () => {
  it('브랜드 — 옛 normalizePhones(공백·쉼표·세미콜론 · 숫자만 9~11자리)와 같다 · 못 읽은 토막은 따로 센다', async () => {
    const { normalizeBrandPhones, checkBrandPaste } = await load();
    const oldNormalize = (raw: string) => raw.split(/[\s,;\n\r\t]+/).map((v) => v.replace(/[^0-9]/g, '')).filter((v) => v.length >= 9 && v.length <= 11);
    const samples = [
      '01012345678\n010-9876-5432, 01011112222;01033334444',
      '  010 1234 5678  ',
      '홍길동 01055556666 12345 010123456789',
      '',
      '\t021234567\r\n0311234567',
    ];
    for (const s of samples) expect(normalizeBrandPhones(s)).toEqual(oldNormalize(s));
    expect(checkBrandPaste('홍길동 01055556666 12345').invalid).toEqual(['홍길동', '12345']);
  });

  it('알림톡 — 옛 parseDirectInput 구분 규칙 그대로 + 10자리 미만은 형식 오류(옛 규칙은 0101234 도 번호로 셌다)', async () => {
    const { checkAlimtalkPaste } = await load();
    const { normalizePhoneKr } = await loadFmt();
    const oldParse = (t: string) => t.split(/[\n\r,;]+/).map((s) => s.trim()).filter(Boolean).map((raw) => normalizePhoneKr(raw)).filter(Boolean);
    const samples = ['010-1234-5678\n01098765432,01012345678;abc', '+82 10 1111 2222', '\n\n', '1588-1234\n010 5555 6666', '010-12-34\n01033334444'];
    for (const s of samples) expect(checkAlimtalkPaste(s).phones).toEqual(oldParse(s).filter((p) => p.length >= 10));
    expect(checkAlimtalkPaste('01012345678\nabc\n010-12-34').invalid).toEqual(['abc', '010-12-34']);
  });

  it('문자 발송 — 옛 [등록](한 줄에 하나 · normalizePhoneKr · 10자리 이상)과 같다', async () => {
    const { checkDirectSendPaste } = await load();
    const { normalizePhoneKr } = await loadFmt();
    const oldParse = (t: string) => t.split('\n').map((l) => l.trim()).filter((l) => l).map((line) => normalizePhoneKr(line)).filter((p) => p && p.length >= 10);
    const samples = ['01012345678\n01087654321\n01011112222', '010-12-34\n01055556666', '01055556666, 01077778888', ' \n'];
    for (const s of samples) expect(checkDirectSendPaste(s).phones).toEqual(oldParse(s));
    expect(checkDirectSendPaste('010-12-34\n01055556666').invalid).toEqual(['010-12-34']);
  });

  it('planAppend — 중복제거 켜짐 = 지금 명단·이번 입력 안의 중복을 뺀다 · 꺼짐 = 전부 더하고 겹친 수만 센다 · 비교는 숫자만', async () => {
    const { planAppend } = await load();
    expect(planAppend(['01012345678', '01012345678', '01099998888'], ['010-1234-5678'], true)).toEqual({ add: ['01099998888'], dup: 2 });
    expect(planAppend(['01012345678', '01012345678', '01099998888'], ['010-1234-5678'], false)).toEqual({ add: ['01012345678', '01012345678', '01099998888'], dup: 2 });
    expect(planAppend([], ['01012345678'], true)).toEqual({ add: [], dup: 0 });
  });
});

describe('2. 공용 직접입력 창', () => {
  const m = read('components/direct-send/RecipientDirectInputModal.tsx');
  it('ESC 는 이 창만 닫는다(캡처 단계 · 뒤의 발송 창으로 안 번짐) · 열 때마다 새로 시작', () => {
    expect(m).toContain("if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }");
    expect(m).toContain("document.addEventListener('keydown', onKey, true);");
    const reset = between(m, '// 열 때마다 새로 시작한다', '}, [open]);');
    for (const x of ["setText('');", 'setValues({});', 'setAdded([]);', "setRowError('');"]) expect(reset).toContain(x);
  });
  it('보인 수로만 더한다 — 추가할 게 0이면 버튼이 잠기고, 더한 뒤 창을 닫는다 · 창은 명단을 직접 바꾸지 않는다', () => {
    const submit = between(m, 'const submitPaste = () => {', '};');
    expect(submit).toContain('if (preview.add === 0) return;');
    expect(submit.indexOf('onSubmitPaste(text);')).toBeLessThan(submit.indexOf('onClose();'));
    expect(m).toContain('disabled={preview.add === 0}');
    expect(m).not.toMatch(/setRecipients|setDirectRecipients|setPhones/);
  });
  it('두 번째 방식은 rows 를 줄 때만 · 잠김 이유가 있으면 잠근다 · 겹침 2100(브랜드 창 2000 위)', () => {
    expect(m).toContain('{rows && (');
    expect(m).toContain('disabled={!rowsUsable}');
    const css = read('styles/direct-send.css');
    expect(css).toContain('.rdi-back { position: fixed; inset: 0; z-index: 2100;');
  });
});

describe('3. 알림톡 창', () => {
  const a = read('components/AlimtalkSendModal.tsx');
  it('수신자 열 입력칸이 없고 [직접입력] 탭이 창을 연다', () => {
    expect(a).not.toContain('parseDirectInput');
    expect(a).not.toContain('aria-label="수신번호 직접 입력"');
    expect(a).toContain("onClick={() => { setInputMode('direct'); setDirectInputOpen(true); }}");
    expect(a).toMatch(/<RecipientDirectInputModal\s+open=\{directInputOpen\}/);
  });
  it('붙여넣기 = 지금 명단에 더한다(통째 교체 아님) · 검수와 더하기가 같은 planPaste', () => {
    const plan = between(a, 'const planPaste = (text: string) => {', '};');
    expect(plan).toContain('planAppend(check.phones, recipients.map((r) => r?.phone), dedupEnabled)');
    const submit = between(a, 'const submitDirectPaste = (text: string) => {', '};\n');
    expect(submit).toContain('const { plan } = planPaste(text);');
    expect(submit).toContain('setRecipients([...recipients, ...plan.add.map((phone) => ({ phone }))]);');
    const preview = between(a, 'const previewDirectPaste = (text: string): PastePreview => {', '};\n');
    expect(preview).toContain('const { check, plan } = planPaste(text);');
    // 통째 교체는 파일 매핑 적용(applyMapping) 한 곳만 남는다
    expect((a.match(/setRecipients\(dedup\);/g) || []).length).toBe(1);
    expect(between(a, 'const applyMapping = () => {', 'setShowMapping(false);')).toContain('setRecipients(dedup);');
  });
  it('한 건씩 — 칸 = 템플릿 변수 · 값은 변수 이름 칸 · 빈 칸·잘못된 번호·(중복제거 켜짐) 이미 있는 번호는 막는다', () => {
    const add = between(a, 'const addDirectRow = (values: Record<string, string>): RowAddResult => {', '  };\n');
    expect(add).toContain("if (!phone || phone.length < 10) return { ok: false, error: '수신번호를 확인해 주세요(10자리 이상 숫자)' };");
    expect(add).toContain('const empty = directRowFields.find(');
    expect(add).toContain('if (dedupEnabled && planAppend([phone], recipients.map((r) => r?.phone), true).add.length === 0) {');
    expect(add).toContain('directRowFields.forEach((f) => { entry[f.key] = String(values[f.key]).trim(); });');
    expect(a).toContain("? '템플릿을 고르면 변수와 함께 한 건씩 넣을 수 있어요'");
    expect(a).toContain("templateVarCount === 0 ? '이 템플릿은 변수가 없어서 번호만 넣으면 돼요'");
  });

  it('Codex 1R — 한 건씩 칸 = 지금 연결 기준(@@칸@@ 이면 그 칸 · 비면 변수 이름 칸 · 같은 값이면 칸 없음 · 같은 칸은 하나)', () => {
    const f = between(a, 'const directRowFields = useMemo(() => {', '}, [kakaoSelectedTemplate?.content, kakaoTemplateVars]);');
    expect(f).toContain("if (mapped.startsWith('@@') && mapped.endsWith('@@')) key = mapped.slice(2, -2);");
    expect(f).toContain("else if (mapped.trim() === '') key = inner;");
    expect(f).toContain('else continue;');
    expect(f).toContain('const same = out.find((f) => f.key === key);');
  });

  it('Codex 2R 범위 밖(같은 뿌리) — 템플릿을 고를 때 자동 연결도 정확한 칸 이름 먼저, 없을 때만 라벨(공용 훅)', () => {
    const p = read('components/alimtalk/AlimtalkChannelPanel.tsx');
    const pick = between(p, 'const fieldKey = (', ')?.key;');
    expect(pick).toContain('customerFieldOptions.find((f) => f.key === inner)');
    expect(pick).toContain('|| customerFieldOptions.find((f) => f.label === inner)');
    expect(p).not.toMatch(/f\.key === inner \|\| f\.label === inner/);
  });

  it('Codex 1R — 자동 연결은 정확히 같은 이름을 먼저, 없을 때만 라벨·별칭', () => {
    const m = between(a, 'const matched = fields.find((f) => f === inner)', ';');
    expect(m).toContain('|| fields.find((f) => FIELD_LABEL_MAP[f] === inner || (FIELD_NAME_ALIASES[f] || []).includes(inner))');
  });
  it('칸 목록·자동 연결·목록 칸 = 명단 전체 칸(첫 줄만 보지 않는다)', () => {
    expect(a).toContain('const recipientFieldKeys = useMemo(() => {');
    expect(a).toContain('for (const k of Object.keys(r || {})) if (k !== \'phone\') seen.add(k);');
    expect(between(a, 'const dynamicFieldOptions = useMemo(() => {', '}, [recipientFieldKeys, customerFieldOptions]);')).toContain('recipientFieldKeys.map(');
    expect(a).toContain('const previewColumns = recipientFieldKeys;');
    expect(a).toContain('const fields = recipientFieldKeys;');
    expect(a).not.toMatch(/Object\.keys\(recipients\[0\]\)/);
    expect(a).not.toMatch(/const sample = recipients\[0\];/);
  });
});

describe('4. 브랜드 창', () => {
  const b = read('components/BrandSendModal.tsx');
  it('수신자 열 입력칸이 없고 [직접입력] 탭이 창을 연다 · 토글 없이 붙여넣기만', () => {
    expect(b).not.toContain('aria-label="수신번호 직접 입력"');
    expect(b).toContain("if (t.key === 'manual') setDirectInputOpen(true);");
    const use = between(b, '<RecipientDirectInputModal', '/>');
    expect(use).toContain('tone="violet"');
    expect(use).not.toContain('rows=');
  });
  it('더하기·중복 식은 원래 그대로(Set + 이미 담긴 번호 빼기) · 검수와 더하기가 같은 planDraft', () => {
    const plan = between(b, 'const planDraft = (text: string) => {', '};');
    expect(plan).toContain('const added = Array.from(new Set(check.phones)).filter((p) => !existing.has(p));');
    expect(between(b, 'const addFromDraft = (text: string) => {', 'setAddNotice(\n')).toContain('setRecipients([...phones, ...added]);');
    expect(between(b, 'const previewDraft = (text: string): PastePreview => {', '};\n')).toContain('planDraft(text)');
    expect(b).not.toMatch(/const normalizePhones = /);
    expect(b).toContain('const parsed = normalizeBrandPhones(text);');
  });
  it('더한 결과 안내는 방식과 무관하게 보인다(파일 읽기 중단 안내가 가려지지 않게)', () => {
    expect(b).toContain('{!isTarget && addNotice && <p className="text-[11.5px] text-violet-600 px-0.5 m-0">{addNotice}</p>}');
  });
});

describe('5. 문자 발송(직접발송) 창 — 더하기 규칙 그대로 · 모양만 공용 창', () => {
  const d = read('components/DirectSendPanel.tsx');
  it('여러 줄 = 유효한 번호를 전부 더한다(중복은 보낼 때 [중복제거]) · 한 건씩 = 한 줄 · 처음 방식 = 문구 변수 유무', () => {
    expect(d).not.toContain('directInputText');
    const submit = between(d, 'const onSubmitPaste = (text: string) => {', '};\n');
    expect(submit).toContain('checkDirectSendPaste(text).phones');
    expect(submit).toContain('setDirectRecipients(prev => [...prev, ...newRecipients]);');
    const row = between(d, 'const onAddRow = (values: Record<string, string>): RowAddResult => {', 'return { ok: true, phone };');
    expect(row).toContain('setDirectRecipients(prev => [...prev, entry]);');
    expect(row).toContain("entry[f] = f === 'callback' ? normalizePhoneKr(val) : val;");
    expect(d).toContain('initial: usedVars.length > 0,');
    expect(d).toContain("rows={directSendChannel === 'sms' ? {");
    expect(between(d, 'const previewPaste = (text: string): PastePreview => {', '};\n')).toContain('checkDirectSendPaste(text)');
  });
});
