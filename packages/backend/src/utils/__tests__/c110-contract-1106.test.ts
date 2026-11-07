// replaces: none
/**
 * C110 계약 시험(★ 2026-11-06 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §7 · §8 계약 줄)
 *   R69 광고 관문 = 공용 발송 입구를 부르는 모든 파일 · 옛 피로도 판정을 부르던 모든 파일이 관문 CT 를 지난다(소스에서 기계로 뽑는다)
 *   R47 여정 건너뜀 = 운영 크레딧 예약 앞 · R1 효과 산식 한 벌 · R56 같은 말(화면 사본 · 「홀드아웃」 · 「비교군」 0) · R7 꺼짐도 로그
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { AD_BRANCHES, AD_BRANCH_LABEL } from '../ad-send-gate-core';

const BACKEND_SRC = resolve(__dirname, '../..');
const FRONTEND_SRC = resolve(__dirname, '../../../../frontend/src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}
const rel = (p: string) => relative(BACKEND_SRC, p).replace(/\\/g, '/');
/** 주석 줄을 뺀 코드(// · * 로 시작하는 줄 · 줄 끝 // 주석) */
const codeOf = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
const backend = sourceFiles(BACKEND_SRC).map((p) => ({ p: rel(p), src: readFileSync(p, 'utf8') }));

describe('R69 광고 관문 — 발송 입구마다', () => {
  it('공용 발송 입구(createDirectSendCampaign)를 부르는 파일마다 관문 · 원장 묶음이 있다', () => {
    const callers = backend.filter((f) => f.p !== 'utils/direct-send-core.ts' && /await\s+createDirectSendCampaign\(/.test(codeOf(f.src)));
    expect(callers.map((f) => f.p).sort()).toEqual([
      'routes/campaigns.ts', 'routes/dm.ts', 'utils/agency-send-worker.ts', 'utils/continuous-operator.ts', 'utils/planner-executor.ts',
    ]);
    for (const f of callers) {
      const code = codeOf(f.src);
      expect(/gateStaging\(|gatePhones\(/.test(code), `${f.p} 관문 없음`).toBe(true);
      const calls = code.split('createDirectSendCampaign(').length - 1;
      const batches = (code.match(/adGateBatchId:/g) || []).length;
      expect(batches, `${f.p} createDirectSendCampaign 호출마다 adGateBatchId`).toBeGreaterThanOrEqual(calls - (f.p === 'routes/campaigns.ts' ? 0 : 0));
    }
  });

  it('원장 잇기 = 원장을 쓴 판정일 때만(대조군 · 우선순위를 안 쓰는 회사 = 잇기 UPDATE 0 · 1106 Harold)', () => {
    for (const p of ['routes/campaigns.ts', 'routes/dm.ts', 'utils/agency-send-worker.ts', 'utils/continuous-operator.ts', 'utils/planner-executor.ts']) {
      const code = codeOf(backend.find((f) => f.p === p)!.src);
      for (const m of code.matchAll(/adGateBatchId:\s*([^,\n]+)/g)) expect(/[Mm]arked/.test(m[1]), `${p} adGateBatchId = ${m[1]}`).toBe(true);
    }
    for (const p of ['routes/campaigns.ts', 'utils/auto-campaign-worker.ts']) {
      const code = codeOf(backend.find((f) => f.p === p)!.src);
      const lines = code.split('\n');
      lines.forEach((l, i) => {
        if (/await linkAdMarksSafe\(/.test(l)) expect(/[Mm]arked/.test(lines.slice(Math.max(0, i - 2), i + 1).join(' ')), `${p}:${i + 1}`).toBe(true);
      });
    }
    const ex = codeOf(backend.find((f) => f.p === 'utils/journey-executor.ts')!.src);
    expect(ex).toContain('adGateBatch: adGate?.marked ? adGateBatch : null');
    // ★ 1107 Harold — 잇기 실패가 발송을 멈추지 않는다: 입구는 던지지 않는 linkAdMarksSafe 만 부른다(던지는 linkAdMarks = 관문 CT 안에서만)
    const direct = backend.filter((f) => f.p !== 'utils/ad-send-gate.ts' && /\blinkAdMarks\(/.test(codeOf(f.src))).map((f) => f.p);
    expect(direct).toEqual([]);
    // ★ C113 구현 1R 구조 — 입구의 잇기 = 소유 CT(AdHold.handoff · 판정이 원장을 썼을 때만 묶음이 있다) · 여정만 실린 번호 단위로 바로 부른다
    const safeCallers = backend.filter((f) => /linkAdMarksSafe\(/.test(codeOf(f.src)) && f.p !== 'utils/ad-send-gate.ts').map((f) => f.p).sort();
    expect(safeCallers).toEqual(['utils/journey-executor.ts']);
    expect(codeOf(backend.find((f) => f.p === 'utils/direct-send-core.ts')!.src)).not.toContain('AD_GATE_LINK_FAILED');
  });

  it('피로도 배열 판정(getFatigueBlockedSet) = HEAD 의 입구 그대로(★ C113 D23 · 관문 CT 는 피로도를 보지 않는다)', () => {
    const users = backend.filter((f) => /getFatigueBlockedSet\(/.test(codeOf(f.src))).map((f) => f.p).sort();
    expect(users).toEqual(['routes/campaigns.ts', 'utils/auto-campaign-worker.ts', 'utils/fatigue-guard.ts', 'utils/journey-executor.ts']);
  });

  it('피로도를 기록하는 광고 발송 자리마다 관문이 있다(직접 동기 · AI · 자동 캠페인 · 여정 · 처리기 = 적재 표 경로가 관문을 지난 뒤)', () => {
    const recorders = backend.filter((f) => /recordFatigueSends\(/.test(codeOf(f.src)) && f.p !== 'utils/fatigue-guard.ts').map((f) => f.p).sort();
    expect(recorders).toEqual(['routes/campaigns.ts', 'utils/auto-campaign-worker.ts', 'utils/direct-send-processor.ts', 'utils/journey-executor.ts']);
    for (const p of recorders.filter((x) => x !== 'utils/direct-send-processor.ts')) {
      expect(/gatePhones\(/.test(codeOf(backend.find((f) => f.p === p)!.src)), `${p} 관문 없음`).toBe(true);
    }
  });

  it('동기 직접 발송 = 예약 날 계산 수가 관문 뒤 목록(빠진 번호가 아닌 행 · 번호가 빈 행 포함)과 같은 기준(구현 3R · 4R)', () => {
    const camp = codeOf(backend.find((f) => f.p === 'routes/campaigns.ts')!.src);
    expect(camp).toContain("return filteredRecipients.filter((r: any) => { const k = normalizePhone(String(r.phone || '')); return !k || ok.has(k); }).length;");
    expect(camp).toContain("filteredRecipients = filteredRecipients.filter((r: any) => !gate.excluded.has(normalizePhone(String(r.phone || ''))));");
  });

  it('적재 표 경로의 관문은 건수 확정(countStagingFiltered) 앞', () => {
    for (const p of ['routes/campaigns.ts', 'routes/dm.ts', 'utils/agency-send-worker.ts']) {
      const code = codeOf(backend.find((f) => f.p === p)!.src);
      const gate = code.indexOf("mode: 'commit'");
      const count = code.indexOf('countStagingFiltered(', gate);
      expect(gate, `${p} commit 관문`).toBeGreaterThan(0);
      expect(count, `${p} 관문 뒤 건수`).toBeGreaterThan(gate);
    }
  });
});

describe('R47 · R7 · R1 · R56', () => {
  const executor = codeOf(backend.find((f) => f.p === 'utils/journey-executor.ts')!.src);

  it('R47 여정 광고 관문 건너뜀 = 수신거부 뒤 · 운영 크레딧 예약 앞', () => {
    const unsub = executor.indexOf("reason: 'unsubscribed'");
    const gate = executor.indexOf('adGate?.excluded.get(');
    const credit = executor.indexOf('reserveJourneyOperationCredit(head');
    expect(unsub).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(unsub);
    expect(credit).toBeGreaterThan(gate);
    // ★ C113 D23 — 피로도 건너뜀 = HEAD 자리 그대로(회신번호 확인 뒤 · 카카오 막힘 앞 · c113-free-head 가 자리 고정) · 관문 건너뜀만 크레딧 앞
    expect(executor.includes("reason: 'fatigue_capped' }")).toBe(true);
  });

  it('R7 대조군 비율 읽기 실패 = 로그를 남긴다', () => {
    const ledger = backend.find((f) => f.p === 'utils/journey-entry-ledger.ts')!.src;
    const fn = ledger.slice(ledger.indexOf('export async function getJourneyHoldoutPct'));
    const body = fn.slice(0, fn.indexOf('\n}\n') > 0 ? fn.indexOf('\n}\n') : fn.indexOf('\r\n}\r\n'));
    expect(/catch \(e: any\) \{[\s\S]*console\.warn\(/.test(body)).toBe(true);
  });

  it('R1 효과 산식 한 벌 — ROI 귀속 · 여정 대조군 비교가 effect-measure 를 부른다', () => {
    const roi = codeOf(backend.find((f) => f.p === 'utils/automarketing-roi.ts')!.src);
    expect(roi.includes('ordersAfterAnchors(')).toBe(true);
    expect(roi.includes('JOIN cdp_events e ON e.company_id = $1::uuid')).toBe(false);   // 옛 문장 두 벌 없음
    const stats = codeOf(backend.find((f) => f.p === 'utils/journey-stats.ts')!.src);
    expect(stats.includes('journeyHoldoutEffect(')).toBe(true);
    expect(stats.includes('purchasedSinceEntrySql')).toBe(false);
  });

  it('원장(ad_send_marks) 조회 · 갱신마다 회사 조건(정리 워커 DELETE 제외 · 구현 8R)', () => {
    for (const p of ['utils/ad-send-gate.ts', 'utils/effect-measure.ts', 'utils/customer-timeline.ts']) {
      const code = codeOf(backend.find((f) => f.p === p)!.src);
      // 원장 별칭마다 그 별칭의 회사 조건을 따로 본다(바깥 캠페인 조건이 원장 조건 누락을 가리지 않게 · 구현 9R)
      for (const stmt of code.matchAll(/`([^`]*ad_send_marks[^`]*)`/g)) {
        const sql = stmt[1];
        if (/^\s*DELETE/.test(sql)) continue;
        for (const ref of sql.matchAll(/(?:FROM|UPDATE)\s+ad_send_marks(?:\s+(?!WHERE|SET|JOIN|ON|LIMIT|ORDER)(\w+))?/g)) {
          const alias = ref[1];
          const cond = alias ? new RegExp(`\\b${alias}\\.company_id\\s*=`) : /(?<![\w.])company_id\s*=/;
          expect(cond.test(sql), `${p}: 원장${alias ? `(${alias})` : ''} 회사 조건 없음 · ${sql.trim().slice(0, 80)}`).toBe(true);
        }
      }
    }
  });

  it('R56 화면 갈래 사본 = 서버 표', () => {
    const copy = readFileSync(join(FRONTEND_SRC, 'utils/ad-branch.ts'), 'utf8');
    const arr = copy.match(/AD_BRANCHES = \[([^\]]+)\]/)![1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(arr).toEqual([...AD_BRANCHES]);
    for (const b of AD_BRANCHES) expect(copy.includes(`${b}: '${AD_BRANCH_LABEL[b]}'`), b).toBe(true);
  });

  it('R56 같은 값 이름 하나 — 고객에게 보이는 글자에 「홀드아웃」 · 「비교군」 0', () => {
    const targets = [
      join(FRONTEND_SRC, 'pages/JourneyStatsPage.tsx'), join(FRONTEND_SRC, 'pages/JourneysPage.tsx'),
      join(FRONTEND_SRC, 'components/performance/EffectProofCard.tsx'), join(FRONTEND_SRC, 'pages/Settings.tsx'),
      join(BACKEND_SRC, 'utils/customer-timeline.ts'), join(BACKEND_SRC, 'utils/effect-measure-core.ts'),
    ];
    for (const p of targets) {
      const code = codeOf(readFileSync(p, 'utf8')).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(/홀드아웃|비교군/.test(code), p).toBe(false);
    }
  });
});
