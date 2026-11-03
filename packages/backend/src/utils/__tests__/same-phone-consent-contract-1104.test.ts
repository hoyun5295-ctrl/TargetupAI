/**
 * 같은 번호 여러 원본 행 · 거부 우선 — 배선 계약(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §6 C1)
 * 대상은 소스에서 기계로 뽑는다: 고객 업서트 CT(createCustomerUpsertBuilder)를 부르는 파일 중 같은 번호를 한 행으로 접는 파일.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const read = (p: string) => fs.readFileSync(p, 'utf8');
const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, '/');

/** 같은 번호를 한 행으로 접는 자리(첫 행만 남김) */
const DEDUPE = /\b(seenPhones|seenInBatch)\.has\(/;

describe('C1 같은 번호를 접는 입구 = 거부 우선 판정을 지난다', () => {
  const callers = files.filter((f) => !f.endsWith('customer-upsert.ts') && /createCustomerUpsertBuilder\(/.test(read(f)));

  it('업서트 CT 를 부르는 파일을 소스에서 뽑았다(0 이면 추출이 깨진 것)', () => {
    expect(callers.map(rel).sort()).toEqual(['routes/customers.ts', 'routes/sync.ts', 'routes/upload.ts']);
  });

  for (const f of callers) {
    const src = read(f);
    if (!DEDUPE.test(src)) continue;
    it(`${rel(f)} — 같은 번호 접기가 있으면 foldByPhone 으로 모으고 keptRowConsent 로 남긴 행의 동의를 정한다`, () => {
      const FOLD = /\b(foldByPhone|foldMappedRowsByPhone)\(/;
      expect(src).toMatch(FOLD);
      expect(src).toMatch(/\bkeptRowConsent\(/);
      // 모으기는 첫 행만 남기는 접기보다 앞이다(둘째 행부터의 거부가 버려지지 않게)
      const iFold = src.search(FOLD);
      const iDedupe = src.search(DEDUPE);
      expect(iFold).toBeGreaterThan(-1);
      expect(iFold).toBeLessThan(iDedupe);
    });
  }

  it('C3 수신동의 기본값 = 업서트와 같은 트랜잭션 · 업서트 반환 행(새로 넣은 행만) · CT 밖 백필 SQL 직접 호출 0', () => {
    const sites: string[] = [];
    for (const f of files) {
      if (f.endsWith('customer-upsert.ts')) continue;
      const src = read(f);
      expect(src, `${rel(f)} 가 백필 SQL 을 직접 부른다`).not.toMatch(/\b(buildSmsOptInBackfill|buildSmsOptInUnknownDefault)\(/);
      const re = /await applySmsOptInDefaults\(run, companyId, ([A-Za-z_][A-Za-z0-9_]*)\.rows,/g;
      const good = src.match(re) || [];
      // 호출 = 주석 줄 밖의 「applySmsOptInDefaults(」(import 줄에는 괄호가 없다)
      const calls = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').match(/\bapplySmsOptInDefaults\(/g)?.length ?? 0;
      expect(good.length, `${rel(f)} 의 applySmsOptInDefaults 호출이 모두 업서트 반환 행을 넘기지 않는다`).toBe(calls);
      for (let i = 0; i < good.length; i++) sites.push(rel(f));
      // 같은 트랜잭션: 호출마다 그 앞 가장 가까운 withTransaction( 이 그 호출을 감싸는 콜백이어야 한다(그 사이에 콜백을 닫는 「});」 없음)
      let m: RegExpExecArray | null;
      const r2 = new RegExp(re.source, 'g');
      while ((m = r2.exec(src))) {
        const before = src.slice(0, m.index);
        const iTx = before.lastIndexOf('withTransaction(async (run)');
        expect(iTx, `${rel(f)} 호출이 withTransaction 밖`).toBeGreaterThan(-1);
        expect(before.slice(iTx)).not.toMatch(/\n\s*\}\);/);
      }
    }
    // 부르는 곳 = 한 명 추가 · 일괄 추가(청크 · 한 행) · 싱크(청크 · 한 행) · 업로드(청크 · 한 행) = 7
    expect(sites.sort()).toEqual(['routes/customers.ts', 'routes/customers.ts', 'routes/customers.ts', 'routes/sync.ts', 'routes/sync.ts', 'routes/upload.ts', 'routes/upload.ts']);
  });

  it('같은 번호를 접는 파일은 셋(싱크 · 업로드 · 일괄 추가 = customers.ts)', () => {
    expect(callers.filter((f) => DEDUPE.test(read(f))).map(rel).sort()).toEqual(['routes/customers.ts', 'routes/sync.ts', 'routes/upload.ts']);
  });
});

describe('C4 싱크 고객 적재 = 1.7.6 세대 갈래(설계서 3-2 ⑤ · ⑦ · ⑧)', () => {
  const s = read(path.join(SRC, 'routes/sync.ts'));
  const block = s.slice(s.indexOf("router.post('/customers'"), s.indexOf("router.post('/purchases'"));
  it('고객 적재 블록을 소스에서 뽑았다', () => {
    expect(block.length).toBeGreaterThan(1000);
    expect(block).toMatch(/upsertBuilder\.runBatch\(/);
  });
  it('고객 행을 쓰는 트랜잭션마다 첫 문장 = guardSyncLoadChunk(회사 잠금 · 섞인 회사)', () => {
    const tx = block.match(/withTransaction\(async \(run\) => \{\n/g)?.length ?? 0;
    const guarded = block.match(/withTransaction\(async \(run\) => \{\n\s*await guardSyncLoadChunk\(run, companyId, !!gen\);/g)?.length ?? 0;
    expect(tx).toBeGreaterThan(0);
    expect(guarded).toBe(tx);
    expect(block.match(/upsertBuilder\.runBatch\(/g)?.length).toBe(tx);
  });
  it('1.7.6 요청은 공용 기본값을 부르지 않는다 · 근거 커밋(recordLoadEvidence)이 고객 행 쓰기보다 앞', () => {
    const calls = block.split('\n').filter((l) => /\bapplySmsOptInDefaults\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(calls.length).toBeGreaterThan(0);
    for (const l of calls) expect(l, l.trim()).toMatch(/if \(!gen\) await applySmsOptInDefaults\(/);
    const iEvidence = block.search(/recordLoadEvidence\(run, companyId, gen\.agentId, gen\.passId, gen\.batch, evidenceFold!\)/);
    expect(block).toMatch(/const evidenceFold = gen \? loadEvidenceFold\(customers, req\.body\.consentEvidence\) : null;/);
    expect(iEvidence).toBeGreaterThan(-1);
    expect(iEvidence).toBeLessThan(block.search(/upsertBuilder\.runBatch\(/));
  });
});

describe('C2 세대 표 · 싱크 수신거부 SQL = 정해진 CT 한 곳씩(설계서 §6 C2)', () => {
  it('세대 표 셋(sync_consent_passes · stage · marks)을 SQL 로 읽고 쓰는 파일 = same-phone-consent.ts 하나', () => {
    const SQL = /\b(FROM|INTO|UPDATE|JOIN)\s+sync_consent_(passes|stage|marks)\b/i;
    expect(files.filter((f) => SQL.test(read(f))).map(rel)).toEqual(['utils/same-phone-consent.ts']);
  });
  it("source 'sync' 수신거부를 넣고 지우는 SQL = sync-unsubscribes.ts 하나", () => {
    const SQL = /\bphone,\s*'sync'|\bsource\s*=\s*'sync'/;
    const code = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    const hit = files.filter((f) => /\bunsubscribes\b/.test(code(f)) && SQL.test(code(f))).map(rel);
    expect(hit).toEqual(['utils/sync-unsubscribes.ts']);
  });
  it('원격 릴리스(sync_releases)를 고르고 끄는 SQL = sync-releases.ts 하나(회사 지정 > 티어 > 전역 · 3-2 ⑩)', () => {
    const SQL = /\b(FROM|INTO|UPDATE)\s+sync_releases\b/i;
    expect(files.filter((f) => SQL.test(read(f))).map(rel)).toEqual(['utils/sync-releases.ts']);
  });
  it('싱크 에이전트 삭제(sync_agents DELETE) = 세대 폐기 CT 안 하나 · 라우트는 retireSyncAgent 로만', () => {
    const DEL = /DELETE\s+FROM\s+sync_agents\b/i;
    expect(files.filter((f) => DEL.test(read(f))).map(rel)).toEqual(['utils/same-phone-consent.ts']);
    expect(read(path.join(SRC, 'routes/admin-sync.ts'))).toMatch(/\bretireSyncAgent\(/);
  });
});
