// 배포 원장 판정(★ 2026-10-27 설계서 docs/2026-10-27-real-pg-test-deploy-ledger-design.md §3)
// 원장 = status/DEPLOY-LEDGER.md. 이 파일은 그 글을 읽어 판정만 한다(쓰기 0 · git 0 · 순수 함수).
//   parseLedger           = 머리 · §0 카드 · §1 대기 항목 · SQL 블록(§1 · §2)
//   requiredSteps         = 범위의 누적 변경이 정하는 배포 단계(OPS §2-2 분기)
//   advanceDeployedHead   = 받은 확인 출력(받은 순서)으로 deployed_head 를 올려도 되는가
//   cardState             = 카드 표시(배포 대기 · 코드 반영 · 배포 완료) · 원장을 쓸 때마다 전 카드 재계산

/** 확인 출력 꼬리표(원장 머리 「이번 창 확인 출력」에 받은 순서대로 적는다) */
export const EVIDENCE = ['backend-install', 'frontend-install', 'backend-build', 'frontend-build', 'reload', 'restart-env', 'uptime'];

const SECTION = { head: '## 머리', cards: '## §0 카드', pending: '## §1 대기', applied: '## §2 덤프 뒤 적용분' };
const SECTION_NAME = { preamble: '첫 절 앞', head: '머리', cards: '§0 카드', pending: '§1 대기', applied: '§2 덤프 뒤 적용분' };
const QUOTE = ['안내 인용', /^> /];
/** 절마다 블록 밖에 둘 수 있는 줄 꼴(이 밖의 줄 = 실패 · 앞 공백도 꼴 밖) */
const LINE_FORMS = {
  preamble: [['제목', /^# \S/], QUOTE],
  head: [['머리 칸', /^- ([^:]+):\s*(.*)$/], QUOTE],
  cards: [['표 머리', /^\|\s*카드\s*\|\s*커밋\s*\|$/], ['표 구분', /^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/], ['카드 줄', /^\|\s*(C\d+)\s*\|([^|]*)\|$/], QUOTE],
  pending: [['항목 머리', /^### ([A-Za-z0-9_-]+) · (.+)$/], ['항목 칸', /^- ([^:]+):\s*(.*)$/], QUOTE],
  applied: [['빈 절 표시', /^\(.*\)$/], QUOTE],
};
const FENCE_OPEN = /^```sql (ddl|dml):([A-Za-z0-9_-]+)\s*$/;

export function parseLedger(text) {
  const lines = text.split(/\r?\n/);
  const out = { head: {}, cards: [], items: [], blocks: [] };
  let section = null;
  let item = null;
  let block = null;
  const seenItem = new Set();
  const seenBlock = new Set();
  lines.forEach((line, i) => {
    const at = `${i + 1}행`;
    if (block) {
      if (line.trim() === '```') {
        out.blocks.push({ ...block, sql: block.lines.join('\n') });
        block = null;
      } else {
        block.lines.push(line);
      }
      return;
    }
    if (line.startsWith('```')) {
      const m = FENCE_OPEN.exec(line);
      if (!m) throw new Error(`원장 ${at}: 블록 머리는 \`\`\`sql ddl:<id> 또는 \`\`\`sql dml:<id> 꼴이어야 한다`);
      if (section !== 'pending' && section !== 'applied') throw new Error(`원장 ${at}: SQL 블록은 §1 · §2 안에만 둔다`);
      if (seenBlock.has(m[2])) throw new Error(`원장 ${at}: 블록 id 두 번 = ${m[2]}`);
      seenBlock.add(m[2]);
      if (section === 'pending' && m[2] !== item?.id) throw new Error(`원장 ${at}: §1 블록 id(${m[2]}) 는 그 항목 id(${item?.id ?? '없음'}) 와 같아야 한다`);
      block = { kind: m[1], id: m[2], section, lines: [], line: i + 1 };
      return;
    }
    if (line.startsWith('## ')) {
      section = Object.entries(SECTION).find(([, h]) => line.trim() === h)?.[0] ?? null;
      if (!section) throw new Error(`원장 ${at}: 모르는 절 머리 = ${line.trim()}`);
      item = null;
      return;
    }
    // 블록 밖 줄 = 빈 줄이거나 그 절의 허용 꼴 하나여야 한다(허용 목록 · 꼴이 틀린 줄을 조용히 건너뛰면 카드 · 항목이 계산에서 사라진다 · Codex 구현 R1 #6 · R2 #1)
    if (!line.trim()) return;
    const kind = LINE_FORMS[section ?? 'preamble'].find(([, re]) => re.test(line));
    if (!kind) throw new Error(`원장 ${at}: ${SECTION_NAME[section ?? 'preamble']} 에 둘 수 없는 줄(허용 = ${LINE_FORMS[section ?? 'preamble'].map(([k]) => k).join(' · ')}) = ${line.slice(0, 40)}`);
    const [k, re] = kind;
    const m = re.exec(line);
    if (k === '머리 칸') {
      out.head[m[1].trim()] = m[2].trim();
    } else if (k === '카드 줄') {
      const commits = m[2].trim() === '미커밋' ? [] : m[2].split(/[·,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (commits.length === 0 && m[2].trim() !== '미커밋') throw new Error(`원장 ${at}: 커밋 칸이 비었다(「미커밋」으로 적는다)`);
      if (commits.some((c) => !/^[0-9a-f]{7,40}$/.test(c))) throw new Error(`원장 ${at}: 커밋 칸은 해시 또는 「미커밋」 = ${m[2].trim()}`);
      if (out.cards.some((c) => c.card === m[1])) throw new Error(`원장 ${at}: 카드 두 번 = ${m[1]}`);
      out.cards.push({ card: m[1], commits });
    } else if (k === '항목 머리') {
      if (seenItem.has(m[1])) throw new Error(`원장 ${at}: 항목 id 두 번 = ${m[1]}`);
      seenItem.add(m[1]);
      item = { id: m[1], title: m[2].trim(), fields: {} };
      out.items.push(item);
    } else if (k === '항목 칸') {
      if (!item) throw new Error(`원장 ${at}: 항목 머리 없이 칸이 나왔다`);
      if (Object.prototype.hasOwnProperty.call(item.fields, m[1].trim())) throw new Error(`원장 ${at}: ${item.id} 의 「${m[1].trim()}」 칸이 두 번`);
      item.fields[m[1].trim()] = m[2].trim();
    }
  });
  if (block) throw new Error(`원장 ${block.line}행: 블록이 닫히지 않았다(${block.kind}:${block.id})`);
  for (const it of out.items) {
    const cards = (it.fields['카드'] || '').split(/[·,\s]+/).filter(Boolean);
    if (!cards.length) throw new Error(`원장 항목 ${it.id}: 「카드」 칸이 없다`);
    for (const c of cards) if (!out.cards.some((x) => x.card === c)) throw new Error(`원장 항목 ${it.id}: §0 에 없는 카드 = ${c}`);
  }
  for (const b of out.blocks) {
    if (/\bCONCURRENTLY\b/i.test(b.sql)) {
      if (b.kind !== 'ddl') throw new Error(`원장 블록 ${b.id}: CONCURRENTLY 는 dml 에 올 수 없다`);
      if (statementCount(b.sql) !== 1) throw new Error(`원장 블록 ${b.id}: CONCURRENTLY 블록은 그 문장 하나만 든다`);
    }
  }
  return out;
}

/** 세미콜론으로 끝나는 문장 수(주석 · 문자열 · $$ 본문 안은 세지 않는다 · 블록 판정용) */
export function statementCount(sql) {
  const s = sql.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, '$$').replace(/'(?:[^']|'')*'/g, "''");
  return s.split(';').filter((p) => p.trim()).length;
}

export function headHash(value) {
  const m = /^([0-9a-f]{7,40})\b/.exec(value || '');
  return m ? m[1] : null;
}

/** 범위의 누적 변경 → 필요한 단계(OPS §2-2 분기 그대로) */
export function requiredSteps({ changedFiles, newEnvNames = [], hasEnvItem = false }) {
  const steps = [];
  const any = (prefix) => changedFiles.some((f) => f.startsWith(prefix));
  if (changedFiles.includes('packages/backend/package.json')) steps.push('backend-install');
  if (changedFiles.includes('packages/frontend/package.json')) steps.push('frontend-install');
  const backend = any('packages/backend/');
  if (backend) steps.push('backend-build');
  if (any('packages/frontend/')) steps.push('frontend-build');
  const envChange = newEnvNames.length > 0 || hasEnvItem;
  if (backend || envChange) steps.push(envChange ? 'restart-env' : 'restart', 'uptime');
  return steps;
}

/**
 * 필요한 단계의 출력이 받은 순서로 다 있으면 올린다.
 * restart = reload 또는 restart-env 둘 다 인정 · restart-env = reload 불인정(env 를 다시 안 읽는다) ·
 * 재시작이 백엔드 build 보다 먼저면 그 재시작 불인정(옛 코드로 다시 뜬 것) · uptime 은 인정된 재시작 뒤.
 */
export function advanceDeployedHead(required, evidence) {
  const unknown = evidence.filter((e) => !EVIDENCE.includes(e));
  if (unknown.length) return { advance: false, missing: [], problems: [`모르는 확인 꼬리표 = ${unknown.join(', ')}`] };
  const at = (tok, from = 0) => evidence.indexOf(tok, from);
  const missing = [];
  const problems = [];
  const pair = (install, build) => {
    if (required.includes(install) && at(install) < 0) missing.push(install);
    if (!required.includes(build)) return -1;
    const b = at(build);
    if (b < 0) { missing.push(build); return -1; }
    if (required.includes(install) && at(install) > b) problems.push(`${install} 이 ${build} 뒤에 왔다`);
    return b;
  };
  const backendBuild = pair('backend-install', 'backend-build');
  pair('frontend-install', 'frontend-build');
  const restart = required.find((r) => r === 'restart' || r === 'restart-env');
  if (restart) {
    const accepted = restart === 'restart-env' ? ['restart-env'] : ['reload', 'restart-env'];
    const hits = accepted.map((t) => at(t, backendBuild + 1)).filter((i) => i >= 0);   // build 없으면 처음부터
    if (hits.length) {
      if (at('uptime', Math.min(...hits) + 1) < 0) missing.push('uptime');
    } else if (backendBuild >= 0 && accepted.some((t) => at(t) >= 0)) {
      problems.push('재시작이 백엔드 build 보다 먼저 왔다(옛 코드로 뜬 것 · 다시 재시작)');
    } else if (restart === 'restart-env' && at('reload') >= 0) {
      problems.push('env 가 바뀐 배포는 reload 가 아니라 restart --update-env 여야 한다');
    } else {
      missing.push(restart);
    }
  }
  return { advance: missing.length === 0 && problems.length === 0, missing, problems };
}

/** 카드 표시 · isAncestor(commit) = deployed_head 의 조상인가 · openItems = 그 카드의 §1 항목 수 */
export function cardState({ commits, isAncestor, openItems, lastCommit }) {
  if (commits.length === 0) return { state: '배포 대기', text: '배포 대기 · 미커밋' };
  const deployed = commits.filter((c) => isAncestor(c)).length;
  if (deployed < commits.length) {
    return { state: '배포 대기', text: deployed === 0 ? '배포 대기' : `배포 대기 · 일부 반영 ${deployed}/${commits.length}` };
  }
  if (openItems > 0) return { state: '코드 반영', text: `코드 반영(${lastCommit ?? commits[commits.length - 1]}) · 남은 단계 ${openItems}` };
  return { state: '배포 완료', text: '배포 완료' };
}

/** 원장 하나로 전 카드를 다시 계산한다(원장을 쓸 때마다 · STATUS 줄은 이 결과의 사본) */
export function recomputeCards(ledger, isAncestor) {
  return ledger.cards.map((c) => {
    const openItems = ledger.items.filter((it) => (it.fields['카드'] || '').split(/[·,\s]+/).includes(c.card)).length;
    return { card: c.card, ...cardState({ commits: c.commits, isAncestor, openItems }) };
  });
}
