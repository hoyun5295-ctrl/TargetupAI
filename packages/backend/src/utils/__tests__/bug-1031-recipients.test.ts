/**
 * 1031 접수 둘(카드 C85 · 설계서 docs/2026-10-31-target-date-addressbook-append-design.md §4)
 *   A cmvujgxpe = 추천 타겟 리스트 날짜 칸 = 글자(R16) · B cmvuih2n = 주소록 불러오기 = 지금 명단에 더하기(R31).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveConditionColumns } from '../operator-recipients';
import { FIELD_MAP } from '../standard-field-map';

const FRONT = resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const BACK = resolve(__dirname, '..', '..');
const read = (root: string, p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');
const load = async () => import('../../../../frontend/src/utils/recipient-paste');

describe('A 추천 타겟 리스트 날짜 칸 = 글자(R16)', () => {
  it('FIELD_MAP date 칸 조건 = ::text 로 읽는다 · 그 밖 칸은 그대로', () => {
    const cols = resolveConditionColumns(
      { birth_date: { operator: 'birth_month', value: 11 }, recent_purchase_date: { operator: 'gte', value: '2026-10-01' }, points: { operator: 'gte', value: 1 } },
      FIELD_MAP,
    );
    const by = Object.fromEntries(cols.map((c) => [c.key, c.select]));
    expect(by.birth_date).toBe('c.birth_date::text AS birth_date');
    expect(by.recent_purchase_date).toBe('c.recent_purchase_date::text AS recent_purchase_date');
    expect(by.points).toBe('c.points AS points');
  });
  it('여정 대상 최근구매일 = 글자 그대로(서버 시간대 기대 0)', () => {
    const ai = read(BACK, 'routes/ai.ts');
    expect(ai).toContain('SELECT name, phone, grade, gender, region, age, points, recent_purchase_date::text AS recent_purchase_date');
    expect(ai).toContain('recent_purchase: r.recent_purchase_date || null,');
    expect(ai).not.toMatch(/new Date\(r\.recent_purchase_date\)/);
  });
});

describe('B 주소록 불러오기 = 지금 명단에 더하기(R31)', () => {
  it('planAppendBy = planAppend 와 같은 판정 · 줄 객체 그대로 · 순서 · 숫자 비교', async () => {
    const { planAppendBy, planAppend } = await load();
    const a = { phone: '010-1234-5678', name: '가' };
    const b = { phone: '01099998888', name: '나' };
    const c = { phone: '01099998888', name: '다' };
    const on = planAppendBy([a, b, c], ['01012345678'], true, (r) => r.phone);
    expect(on.add).toEqual([b]);
    expect(on.add[0]).toBe(b);
    expect(on.dup).toBe(2);
    const off = planAppendBy([a, b, c], ['01012345678'], false, (r) => r.phone);
    expect(off.add).toEqual([a, b, c]);
    expect(off.dup).toBe(2);
    expect(planAppend(['010-1234-5678', '01099998888', '01099998888'], ['01012345678'], true))
      .toEqual({ add: ['01099998888'], dup: 2 });
    expect(planAppendBy([], ['01012345678'], true, (r: { phone: string }) => r.phone)).toEqual({ add: [], dup: 0 });
  });
  it('주소록 창: 명단 쓰기 = 더하기 한 곳(바꾸기 0) · 두 갈래가 그것을 부른다 · 버튼 글 = 더하기', () => {
    const m = read(FRONT, 'components/AddressBookModal.tsx');
    const code = m.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    // 명단 쓰기 = 갱신 함수 한 곳(appendUpdater · 판정 = 그 순간 prev) · 미리 세기 · flushSync 0(Codex C85 1R · 2R)
    expect(code.match(/setDirectRecipients\(/g)).toHaveLength(1);
    expect(code).toContain('setDirectRecipients(appendUpdater(rows, dedupOnAdd, (r) => r.phone, (plan) => {');
    expect(code).not.toMatch(/listRef|planAppendBy\(|flushSync/);
    // 알림 · 창 닫힘 = 반영 뒤 효과가 갱신 함수의 판정을 읽는다(같은 이어짐에서 noticeSeq 를 함께 올림)
    const add = code.slice(code.indexOf('const addToList = (rows: Contact5[], label: string, onAdded: () => void) => {'), code.indexOf('}, [noticeSeq]);'));
    expect(add).toContain('setNoticeSeq((n) => n + 1);');
    expect(add.indexOf('setNoticeSeq((n) => n + 1);')).toBeGreaterThan(add.indexOf('setDirectRecipients(appendUpdater('));
    expect(add).toMatch(/React\.useEffect\(\(\) => \{\s*const n = noticeRef\.current;/);
    const body = add.slice(0, add.indexOf('React.useEffect('));
    expect(body).not.toMatch(/onAdded\(\)|showSuccess\(|showError\(/);   // 알림 · 창 닫힘을 반영 전에 하지 않는다
    expect(add).toContain('n.onAdded();');
    expect(m).not.toMatch(/setDirectRecipients\((data\.contacts|allContacts)/);
    expect(code.match(/addToList\(/g)?.length).toBe(2);   // 한 그룹 + 여러 그룹
    expect(code).toContain("addToList(rows, '', onClose);");
    expect(m).toContain('발송 목록에 더하기');
    expect(m).toContain("'고른 1개 더하기'");
    expect(m).not.toMatch(/발송 목록으로 불러오기|합쳐서 불러오기|고른 1개 불러오기/);
  });
  it('판정 = 그 순간 명단(Codex C85 1R · 2R): 그리기 전 비움이 앞에 쌓여 있어도 주소록 줄이 들어가고 판정 수 = 반영된 수 · 0 = 같은 배열', async () => {
    const { appendUpdater } = await load();
    // React 갱신 큐 흉내(같은 우선순위 = 쌓인 순서대로 적용): rendered = 마지막으로 그린 값 · queue = 아직 안 그린 갱신
    type Row = { phone: string };
    let rendered: Row[] = [{ phone: '01011112222' }];
    const queue: Array<(prev: Row[]) => Row[]> = [];
    const render = () => { for (const u of queue.splice(0)) rendered = u(rendered); };
    let seen: { add: Row[]; dup: number } | null = null;
    queue.push(() => []);   // 보내기 접수 뒤 명단 비움(아직 안 그림)
    queue.push(appendUpdater([{ phone: '010-1111-2222' }], true, (r) => r.phone, (p) => { seen = p; }));
    render();
    expect(rendered).toEqual([{ phone: '010-1111-2222' }]);
    expect(seen!.add).toHaveLength(1);
    const before = rendered;
    queue.push(appendUpdater([{ phone: '01011112222' }], true, (r) => r.phone, (p) => { seen = p; }));
    render();
    expect(seen).toEqual({ add: [], dup: 1 });
    expect(rendered).toBe(before);
  });
  it('여는 곳의 중복 규칙: 알림톡 = 그 창 [중복제거] · 직접발송 = 안 넘김(붙여넣기 planAppend(..., false) 와 같음)', () => {
    expect(read(FRONT, 'components/AlimtalkSendModal.tsx')).toContain('dedupOnAdd={dedupEnabled}');
    expect(read(FRONT, 'pages/Dashboard.tsx')).not.toContain('dedupOnAdd');
    expect(read(FRONT, 'components/DirectSendPanel.tsx')).toContain('planAppend(check.phones, directRecipients.map((r: any) => r?.phone), false)');
  });
});
