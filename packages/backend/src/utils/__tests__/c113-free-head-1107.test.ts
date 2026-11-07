/**
 * C113 §0-0 · §2-O · §2-P 맨 앞 기준 계약 — 미가입(요금제 안 씀) · 직접발송만 쓰는 회사 = 배포 전 HEAD 와 같다.
 *   HEAD 원문(세션 저장 diff · C110 편집 원문)을 리터럴로 박고 지금 코드에 그대로 있는지 · 관문 호출이 관문 길(mode === 'gate' 로 좁힌 policy) 안에만 있는지 ·
 *   큐 편집 잠금 확인이 첫 await 전인지 · 관문 CT 가 피로도를 보지 않는지 기계로 본다.
 *   비교 = 공백 줄이기(들여쓰기만 바뀐 줄은 같은 줄 · 글자 · 차례는 그대로).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { stripComments } from './helpers/producer-scan';

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const has = (rel: string, block: string) => flat(read(rel)).includes(flat(block));

const HEAD_AI_FATIGUE = `let fatigueSkippedCount = 0;
if (campaign.is_ad) {
  const fatigueCap = await getFatigueCap(companyId);
  if (fatigueCap) {
    const blockedSet = await getFatigueBlockedSet(companyId, fatigueCap, filteredCustomers.map((c: any) => c.phone), { from: aiSendDay, to: aiSendDay });
    if (blockedSet.size > 0) {
      const beforeFatigue = filteredCustomers.length;
      filteredCustomers = filteredCustomers.filter((c: any) => !blockedSet.has(normalizePhone(c.phone)));
      fatigueSkippedCount = beforeFatigue - filteredCustomers.length;
    }
    if (filteredCustomers.length === 0) {
      return res.status(400).json({ error: \`발송 대상이 없습니다. (피로도 보호 \${fatigueSkippedCount}명 제외)\`, fatigueSkippedCount });
    }
  }
}`;

const HEAD_DIRECT_FATIGUE = `let directFatigueSkipped = 0;
    if (adEnabled === true) {
      const directFatigueCap = await getFatigueCap(companyId);
      if (directFatigueCap) {
        const dbRows = finalRecipients.filter((r: any) => r.id);
        if (dbRows.length > 0) {
          // ★ 2026-09-28 한줄로 V2 m076 후속 — 판정 창 = 나가는 첫날 ~ 마지막 날(예약·분할). 기록(recordFatigueSends)과 같은 날 계산.
          const directFatigueSpan = {
            from: toKoreaTimeStr(split ? splitSendTime(directSendBase, 0, split) : directSendBase).slice(0, 10),
            to: toKoreaTimeStr(split ? splitSendTime(directSendBase, finalRecipients.length - 1, split) : directSendBase).slice(0, 10),
          };
          const blockedSet = await getFatigueBlockedSet(companyId, directFatigueCap, dbRows.map((r: any) => String(r.phone || '')), directFatigueSpan);
          if (blockedSet.size > 0) {
            const beforeFatigue = finalRecipients.length;
            finalRecipients = finalRecipients.filter((r: any) => !r.id || !blockedSet.has(normalizePhone(String(r.phone || ''))));
            directFatigueSkipped = beforeFatigue - finalRecipients.length;
          }
        }
        if (finalRecipients.length === 0) {
          return res.status(400).json({ success: false, error: \`발송 대상이 없습니다. (피로도 보호 \${directFatigueSkipped}명 제외)\`, fatigueSkippedCount: directFatigueSkipped });
        }
      }
    }`;

const HEAD_AUTO_FATIGUE = `if (ac.is_ad) {
      const fatigueCap = await getFatigueCap(ac.company_id);
      if (fatigueCap) {
        const blockedSet = await getFatigueBlockedSet(ac.company_id, fatigueCap, customers.map((c: any) => String(c.phone || '')));
        if (blockedSet.size > 0) {
          const beforeFatigue = customers.length;
          customers = customers.filter((c: any) => !blockedSet.has(normalizePhone(String(c.phone || ''))));
          console.log(\`\${logPrefix} 피로도 보호 — \${beforeFatigue - customers.length}명 제외 (\${customers.length}명 남음)\`);
        }
        if (customers.length === 0) {
          console.log(\`\${logPrefix} 피로도 보호로 전원 제외 — 스킵\`);
          await markFailed(ac, '피로도 보호로 발송 대상 전원 제외');
          return;
        }
      }
    }`;

const HEAD_FATIGUE_SET_SQL = `\`SELECT phone FROM send_fatigue_daily
          WHERE company_id = $1::uuid AND phone = ANY($2::text[])
            AND day >= (COALESCE($5::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date) - ($3::int - 1))
            AND day <= COALESCE($6::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date)
          GROUP BY phone
         HAVING SUM(sent_count) >= $4::int\``;
const HEAD_FATIGUE_ONE_SQL = `\`SELECT 1 FROM send_fatigue_daily
        WHERE company_id = $1::uuid AND phone = $2
          AND day >= (COALESCE($5::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date) - ($3::int - 1))
          AND day <= COALESCE($6::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date)
       HAVING SUM(sent_count) >= $4::int\``;

describe('HEAD 원문이 지금 코드에 그대로(옛 길)', () => {
  it('AI 캠페인 피로도 블록 · 성공 문장 꼬리', () => {
    expect(has('routes/campaigns.ts', HEAD_AI_FATIGUE)).toBe(true);
    expect(read('routes/campaigns.ts')).toContain("${fatigueSkippedCount > 0 ? ` (피로도 보호 ${fatigueSkippedCount}명 제외)` : ''}");
  });
  it('직접 동기 피로도 블록(고객 DB id 행만 · 행 단위 면제 · 자리) · 성공 문장 꼬리', () => {
    expect(has('routes/campaigns.ts', HEAD_DIRECT_FATIGUE)).toBe(true);
    expect(read('routes/campaigns.ts')).toContain("${directFatigueSkipped > 0 ? ` (피로도 보호 ${directFatigueSkipped}명 제외)` : ''}");
    // 자리 = 기준 시각 바로 뒤 · 제목 검사(D91) 앞
    const s = read('routes/campaigns.ts');
    const at = s.indexOf('const directSendBase = scheduled && scheduledAt ? new Date(scheduledAt) : new Date();');
    expect(at).toBeGreaterThan(0);
    expect(s.indexOf('const directFatigueCap = await getFatigueCap(companyId);', at)).toBeGreaterThan(at);
    expect(s.indexOf('const directFatigueCap = await getFatigueCap(companyId);', at)).toBeLessThan(s.indexOf('// ★ D91: LMS/MMS 제목 필수 검증', at));
  });
  it('자동 캠페인 피로도 블록', () => {
    expect(has('utils/auto-campaign-worker.ts', HEAD_AUTO_FATIGUE)).toBe(true);
  });
  it('여정 피로도 두 줄 · 건너뜀 자리(회신번호 확인 뒤 · 카카오 막힘 앞)', () => {
    const s = read('utils/journey-executor.ts');
    expect(s).toContain('const fatigueCap = isAd ? await getFatigueCap(head.company_id) : null;');
    expect(s).toContain('const fatigueBlocked = fatigueCap ? await getFatigueBlockedSet(head.company_id, fatigueCap, phones) : new Set<string>();');
    const skip = s.indexOf("if (fatigueCap && fatigueBlocked.has(normalizePhone(String(customer.phone || '')))) return { kind: 'skip', reason: 'fatigue_capped' };");
    expect(skip).toBeGreaterThan(s.indexOf("if (!callbackNumber) return { kind: 'pause', reason: 'callback_number_empty'"));
    expect(skip).toBeLessThan(s.indexOf('if (kakaoBlock) return { kind: \'pause\', reason: kakaoBlock.reason'));
  });
  it('피로도 판정 SQL 두 문장', () => {
    expect(has('utils/fatigue-guard.ts', HEAD_FATIGUE_SET_SQL)).toBe(true);
    expect(has('utils/fatigue-guard.ts', HEAD_FATIGUE_ONE_SQL)).toBe(true);
    expect(read('utils/fatigue-guard.ts')).not.toContain('fatigueReachedSql');
  });
  it('건수 미리보기 · 서버 적재 확정 · DM · AI 한줄로 적재 = HEAD 응답 · 문장', () => {
    const c = read('routes/campaigns.ts');
    expect(c).toContain("if (countMode.mode === 'legacy') return res.json({ success: true, ...r, ...checks });");
    expect(c).toContain("if (total === 0) return res.status(400).json({ success: false, error: '정제 후 발송 대상이 없습니다 (전부 수신거부 또는 중복).' });");
    expect(flat(c)).toContain(flat("if (commitMode.mode === 'legacy') { return res.status(202).json({ success: true, campaignId, accepted, message: `${accepted}건 발송이 접수됐습니다. 진행 상황은 발송결과에서 확인하세요.`, }); }"));
    const d = read('routes/dm.ts');
    expect(d).toContain("return res.status(400).json({ error: '수신 가능한 대상이 0명입니다(수신거부 제외 후).', code: 'ZERO_MATCH' });");
    expect(d).toContain('if (!dmAdGate) return res.json({ success: true, campaignId, sent: sendCount, msgType });');
    expect(read('routes/ai.ts')).toContain(': { duplicates, callback: callbackExcluded },');
  });
  it('AI 실행 행 실패 = 옛 길 failCampaignRun 그 자체 · 관문 길 = 시작 잠금 안 「쥔 예약 해제 → failCampaignRun」', () => {
    const c = read('routes/campaigns.ts');
    expect(c).toContain('let failRunReleasingAd: (runId: string, reason: string) => Promise<void> = failCampaignRun;');
    // 쥔 동안만 시작 잠금 안 「해제 → 실패」 · 넘긴 뒤(큐 앞 handoff) = failCampaignRun 그대로(구현 1R #3)
    expect(flat(c)).toContain(flat(`failRunReleasingAd = (runId: string, reason: string) => (aiHold.holding
            ? withCampaignStartLock(id, async () => {
              await aiHold.settle();
              await failCampaignRun(runId, reason);
            })
            : failCampaignRun(runId, reason));`));
  });
  it('수신자 삭제 = HEAD 열쇠 · 409 문장 그대로', () => {
    const c = read('routes/campaigns.ts');
    expect(c).toContain('const deleteLockKey = `recipient-delete:${campaignId}`;');
    expect(c).toContain("return res.status(409).json({ success: false, error: '다른 수신자 삭제를 처리하고 있습니다. 잠시 후 다시 시도해주세요.' });");
  });
});

describe('관문 호출 = 관문 길 안에만(옛 길 = 관문 · 원장 · 잠금 0)', () => {
  const files: Array<{ rel: string; code: string }> = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === '__tests__' || f === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push({ rel: relative(SRC, p).replace(/\\/g, '/'), code: stripComments(readFileSync(p, 'utf8')) });
    }
  })(SRC);
  it('gatePhones · gateStaging 의 정책 = 두 길 판정이 좁힌 policy(관문 길에서만 있는 칸) · loadAdGatePolicy 로 바로 관문 0', () => {
    const bad: string[] = [];
    let calls = 0;
    for (const f of files) {
      if (f.rel === 'utils/ad-send-gate.ts') continue;
      for (const m of f.code.matchAll(/\b(gatePhones|gateStaging)\(\s*([^,]+),/g)) {
        calls++;
        if (!/^\w+\.policy$/.test(m[2].trim())) bad.push(`${f.rel}: ${m[1]}(${m[2].trim()}`);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(10);
    expect(bad).toEqual([]);
  });
  it('입구는 resolveAdGateMode 로 길을 가른다 · loadAdGatePolicy 는 화면 · 효과 증명 읽기만', () => {
    const readers = files.filter((f) => /\bloadAdGatePolicy\(/.test(f.code) && f.rel !== 'utils/ad-send-gate.ts').map((f) => f.rel).sort();
    expect(readers).toEqual(['routes/ai.ts', 'routes/companies.ts']);
    const ai = files.find((f) => f.rel === 'routes/ai.ts')!.code;
    expect(ai.split('loadAdGatePolicy(').length - 1).toBe(1);   // 효과 증명 하나
  });
  it('여정 관문 = 원장에 예약만(빠짐 줄 0 · D13 · R1)', () => {
    const j = files.find((f) => f.rel === 'utils/journey-executor.ts')!.code;
    expect(j).toContain("{ branch: 'journey', batchId: adGateBatch, reserve: true, recordExclusions: false }");
  });
  it('관문 CT 는 피로도를 보지 않는다(판정 · 대체 경로 · 원장 줄)', () => {
    const g = files.find((f) => f.rel === 'utils/ad-send-gate.ts')!.code;
    expect(g).not.toMatch(/getFatigueBlockedSet|getFatigueCap|fatigueCap|fatigueOnly|fatigueReachedSql/);
    expect(g).not.toMatch(/'fatigue'/);
  });
});

describe('큐 편집 잠금 = 맨 앞(첫 await 전) · 관문 길 발송은 INSERT 전에 잡음', () => {
  const c = read('routes/campaigns.ts');
  const code = stripComments(c);   // 주석 속 「await」 낱말이 첫 await 판정을 흐리지 않게
  const headOf = (marker: string) => {
    const at = code.indexOf(marker);
    expect(at, marker).toBeGreaterThan(0);
    return code.slice(at, code.indexOf('await ', at));
  };
  it('예약 변경 · 수신자 삭제의 첫 문장 = queue-edit 동기 확인', () => {
    expect(headOf("router.put('/:id/reschedule'")).toContain('if (isInflight(queueEditKey(req.params.id))) return res.status(409)');
    expect(headOf("router.delete('/:id/recipients/:idx'")).toContain('if (isInflight(queueEditKey(req.params.id))) return res.status(409)');
  });
  it('수신자 삭제 = HEAD 열쇠를 잡은 직후 queue-edit 재확인 · 유료 예약 변경 = 잡은 직후 recipient-delete 확인', () => {
    expect(flat(c)).toContain(flat("if (!tryAcquireInflight(deleteLockKey)) { return res.status(409).json({ success: false, error: '다른 수신자 삭제를 처리하고 있습니다. 잠시 후 다시 시도해주세요.' }); } // ★ C113 D11 ③ — 잡은 직후 같은 동기 구획 = 그 사이 유료 예약 변경이 큐 편집 잠금을 잡았으면 놓고 409(미가입 = 늘 거짓) if (isInflight(queueEditKey(campaignId))) {"));
    // 수신자 삭제 열쇠 = HEAD 원문(요청 표기 그대로) → 예약 변경은 표기와 무관하게 본다(구현 1R #2)
    expect(flat(c)).toContain(flat("if (!tryAcquireInflight(key)) return res.status(409).json({ success: false, error: '다른 변경을 처리하고 있습니다. 잠시 후 다시 시도해주세요.' }); if (isInflightUuid('recipient-delete:', campaignId)) {"));
  });
  it('직접 동기 = 원장을 쓴 관문 길만 미리 만든 id 로 잠금 → INSERT · 공용 입구 = 넘겨받은 묶음일 때만', () => {
    const lock = c.indexOf('tryAcquireInflight(directEditLock);');
    expect(lock).toBeGreaterThan(c.indexOf('const directPresetId = directAdGateMarked ? randomUUID() : null;'));
    expect(lock).toBeLessThan(c.indexOf('const campaignResult = await queryCampaignInsert('));
    const core = read('utils/direct-send-core.ts');
    expect(core).toContain('if (gate === undefined && spec.adGateBatchId) return createDirectSendCampaignGated(spec, ctx, training);');
    const pre = core.indexOf('const presetId = randomUUID();');
    expect(core.indexOf('tryAcquireInflight(editLock);', pre)).toBeGreaterThan(pre);
    expect(core.indexOf('tryAcquireInflight(editLock);', pre)).toBeLessThan(core.indexOf('await createDirectSendCampaign(spec, ctx, training, { presetId, hold })'));
    // 활성화 문장 바로 앞에서 넘김(그 뒤 실패 = 해제 0)
    const hand = core.indexOf('if (gate) gate.hold.pass();');
    expect(hand).toBeGreaterThan(0);
    expect(core.indexOf("`UPDATE campaigns SET send_phase = 'queued'", hand)).toBeGreaterThan(hand);
  });
});
