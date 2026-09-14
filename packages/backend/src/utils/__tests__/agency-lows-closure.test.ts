/**
 * ★2026-09-13(3) 대행발송·싱크 등재분(low) 닫음 계약
 *
 *  대행 ① 거절·중단된 시도의 staging 잔여 · ② 목록·상세·운영 화면의 회신번호 표시 · ③ 시각·문안 변경 때 회신번호 재검증
 *       ④ 화면 접수 본문 상한을 숨기지 않는다 · ⑥ 직접발송 워커 OFFSET 페이지 · ⑧ 저장 컬럼 없는 메일이 tick을 멈추던 것
 *  싱크 ③ 토글이 1회 노출 시크릿을 지우던 것 · ④ 재발급 감사 기록
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const worker = read('../agency-send-worker.ts');
const intake = read('../agency-send-intake.ts');
const route = read('../../routes/agency-send.ts');
const approveRoute = read('../../routes/agency-approve.ts');
const admin = read('../../routes/admin.ts');
const app = read('../../app.ts');
const directWorker = read('../direct-send-worker.ts');
const mailWorker = read('../agency-send-mail-worker.ts');
const adminDashboard = read('../../../../frontend/src/pages/AdminDashboard.tsx');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + 1);
  expect(i, a).toBeGreaterThanOrEqual(0);
  expect(j, b).toBeGreaterThan(i);
  return s.slice(i, j);
};

describe('대행 ① staging 잔여', () => {
  it('거절돼 캠페인이 없는 시도는 approved로 되돌리기 전에 이 시도 키의 staging을 지운다(캠페인 부재를 같은 문장에서 다시 건다)', () => {
    const seg = between(worker, "// 캠페인이 없다 = 이번 시도는 아무것도 만들지 못했다.", "await logEvent(row.id, 'dispatch_retry', { code, message");
    expect(seg).toMatch(/DELETE FROM campaign_send_staging s\s+WHERE s\.staging_id = \$1::uuid\s+AND NOT EXISTS \(SELECT 1 FROM campaigns c WHERE c\.staging_id = \$1::uuid\)/);
    expect(seg.indexOf('DELETE FROM campaign_send_staging')).toBeLessThan(seg.indexOf("setStatus(row.id, 'approved'"));
  });

  it('대조는 캠페인 없이 종결된(취소·만료·문안 확인) 시도의 staging을 잠금이 빈 때만 치운다', () => {
    const rec = between(worker, 'async function runReconcile(', '// ① 나가면 안 되는데 살아 있다');
    expect(rec).toMatch(/if \(!found\.id\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(mustNotSend\) await purgeOrphanStaging\(row\.dispatch_key, row\.company_id\);\s*continue;/);
    const purge = between(worker, 'async function purgeOrphanStaging(', '\n}\n');
    expect(purge).toMatch(/NOT EXISTS \(SELECT 1 FROM campaigns c WHERE c\.staging_id = \$1::uuid\)/);
    // 시도 잠금과 같은 이름(접두어 + 시도 키 문자열)이다. uuid 파라미터를 text로 한 번 더 바꿔 타입 추론 충돌을 피한다
    expect(purge).toMatch(/pg_try_advisory_xact_lock\(hashtext\(\$3::text \|\| \$1::uuid::text\)\)/);
    expect(purge).toMatch(/\[dispatchKey, companyId, ATTEMPT_LOCK_PREFIX\]/);
  });
});

describe('멈춘 시도 인수: 접수 행을 잠그는 트랜잭션 + 배관 활성화가 같은 접수 행 잠금으로 소유권을 다시 본다(Codex 적대 1R·2R high)', () => {
  it('인수 트랜잭션은 접수 행을 인수 조건으로 먼저 잠그고, 그 뒤 캠페인을 잠가 읽으며, 없음·preparing이면 staging을 지운다', () => {
    const fn = between(worker, 'async function takeOverStuckAttempt(', '\n}\n');
    expect(fn).toMatch(/WHERE id = \$1::uuid AND lock_token = \$2::uuid AND status = 'final_testing'\s*AND requested_at <= NOW\(\) - \(\$3::int \* INTERVAL '1 minute'\)\s*AND lock_at < NOW\(\) - \(\$4::int \* INTERVAL '1 minute'\)\s*FOR UPDATE/);
    expect(fn.indexOf("await client.query('BEGIN')")).toBeLessThan(fn.indexOf('FROM agency_send_requests'));
    expect(fn.indexOf('FROM agency_send_requests')).toBeLessThan(fn.indexOf('FROM campaigns'));
    expect(fn).toMatch(/ORDER BY created_at DESC LIMIT 1 FOR UPDATE/);
    expect(fn).toMatch(/const found = classifyAttemptCampaign\(camp\.rows\[0\]\);/);
    expect(fn).toMatch(/if \(dispatchKey && \(!found\.id \|\| found\.phase === 'preparing'\)\) \{\s*await client\.query\(`DELETE FROM campaign_send_staging WHERE staging_id = \$1::uuid`/);
    expect(fn).toMatch(/await client\.query\('COMMIT'\);/);
    expect(fn).toMatch(/await client\.query\('ROLLBACK'\)\.catch/);
    expect(fn).toMatch(/client\.release\(\);/);
    expect(fn).not.toMatch(/pg_try_advisory/);
  });

  it('배관 활성화: 대행 시도는 접수 행을 FOR SHARE로 잠그며 토큰을 다시 보고, 다른 호출부는 종전 문장 그대로다', () => {
    expect(worker).toMatch(/activationGuard: \{\s*sql: 'EXISTS \(SELECT 1 FROM agency_send_requests a WHERE a\.id = \$2::uuid AND a\.lock_token = \$3::uuid FOR SHARE\)',\s*params: \[row\.id, token\],/);
    const core = read('../direct-send-core.ts');
    expect(core).toMatch(/UPDATE campaigns SET send_phase = 'queued', updated_at = NOW\(\) WHERE id = \$1 AND send_phase = 'preparing'\$\{guard \? ` AND \$\{guard\.sql\}` : ''\}`/);
    expect(core).toMatch(/\[campaignId, \.\.\.\(guard \? guard\.params : \[\]\)\]/);
    // 조건이 거짓이면 기존 실패 분기(phase 재확인 → preparing 중화·환불 의무)로 간다
    expect(core).toMatch(/if \(activated\.rowCount !== 1\) throw new Error/);
    expect(core).toMatch(/\} else if \(phaseAfter === 'preparing'\) \{/);
  });
});

// 모듈을 테스트 안에서 처음 불러온다. 전체 스위트 부하(pre-push)에서 첫 import가 5초를 넘길 수 있어 상한을 넉넉히 둔다
describe('대행 ② 회신번호 종류 표시', { timeout: 30_000 }, () => {
  it('규칙: 빈 번호는 대표 번호로 세고, 한 종류면 그 번호를 준다', async () => {
    const { countCallbackKinds } = await import('../agency-send-intake');
    expect(countCallbackKinds([null, null], '0212345678')).toEqual({ callbackKinds: 1, callbackSole: '0212345678' });
    expect(countCallbackKinds(['0311111111', null], '0212345678')).toEqual({ callbackKinds: 2, callbackSole: null });
    expect(countCallbackKinds(['0311111111', '0311111111'], '0212345678')).toEqual({ callbackKinds: 1, callbackSole: '0311111111' });
    expect(countCallbackKinds([], '0212345678')).toEqual({ callbackKinds: 0, callbackSole: null });
  });

  it('접수 코어가 종류를 돌려주고 received 이력에 싣는다(세 입구 모두)', () => {
    expect(intake).toMatch(/\| \{ ok: true; request: any; callbackKinds: AgencyCallbackKinds \}/);
    expect(intake).toMatch(/const callbackKinds = countCallbackKinds\(rows\.map\(\(r\) => r\.callback\), callback\);/);
    expect(intake).toMatch(/return \{ ok: true, request, callbackKinds \};/);
    expect(between(intake, "await logEvent(request.id, 'received', {", '});')).toContain('...callbackKinds');
    expect(route).toMatch(/via: 'one-step', \.\.\.createdKinds\[i\]/);
    expect(between(mailWorker, "await logEvent(requestRows[i].id, 'received', {", '});')).toContain('...requestKinds[i]');
  });

  it('목록·상세·단건 응답·운영 상세·승인 화면이 같은 CT를 읽는다(승인 라우트에 조회 SQL을 두지 않는다)', () => {
    expect(route).toMatch(/const kinds = await loadAgencyCallbackKinds\(r\.rows\);/);
    expect(route).not.toMatch(/request: toPublic\((?!withCallbackKinds)/);
    expect(route).not.toMatch(/\.map\(toPublic\)/);
    expect(admin).toMatch(/const callbackKinds = \(await loadAgencyCallbackKinds\(\[row\]\)\)\.get\(row\.id\);/);
    expect(approveRoute).toContain('loadAgencyCallbackKinds([row])');
    expect(approveRoute).not.toMatch(/COUNT\(DISTINCT/);
  });

  it('CT는 스냅숏을 먼저 읽고, 컬럼이 생기기 전 접수는 세지 않으며, 나머지만 수신자 행을 센다', async () => {
    vi.resetModules();
    const seen: string[] = [];
    vi.doMock('../../config/database', () => ({
      query: async (sql: string, p: any[]) => {
        if (sql.includes('FROM agency_send_events')) {
          seen.push(`snap:${p[0].join(',')}`);
          return { rows: [{ request_id: 'a', payload: { callbackKinds: 3, callbackSole: null } }] };
        }
        if (sql.includes('information_schema')) return { rows: [{ ok: 1 }] };
        if (sql.includes('FROM agency_send_recipients r')) {
          seen.push(`count:${p[0].join(',')}`);
          return { rows: [{ request_id: 'c', n: 1, sole: '0311111111' }] };
        }
        return { rows: [] };
      },
      default: { query: async () => ({ rows: [{ ok: 1 }] }), connect: async () => { throw new Error('x'); } },
      pool: { query: async () => ({ rows: [{ ok: 1 }] }) },
    }));
    const { loadAgencyCallbackKinds } = await import('../agency-send-intake');
    const out = await loadAgencyCallbackKinds([
      { id: 'a', callback_number: '0212345678', created_at: '2026-09-14T00:00:00+09:00' },
      { id: 'b', callback_number: '0212345678', created_at: '2026-09-01T00:00:00+09:00' },
      { id: 'c', callback_number: '0212345678', created_at: '2026-09-12T12:00:00+09:00' },
    ]);
    vi.doUnmock('../../config/database');
    expect(out.get('a')).toEqual({ callbackKinds: 3, callbackSole: null });
    expect(out.get('b')).toEqual({ callbackKinds: 1, callbackSole: '0212345678' });
    expect(out.get('c')).toEqual({ callbackKinds: 1, callbackSole: '0311111111' });
    expect(seen).toEqual(['snap:a,b,c', 'count:c']);
  });
});

describe('대행 ③ 시각·문안 변경 때 회신번호 재검증', { timeout: 30_000 }, () => {
  for (const marker of ["router.post('/:id/content'", "router.post('/:id/reschedule'"]) {
    it(`${marker}: 두 벌 발송 판정 앞에서 같은 CT로 막는다`, () => {
      const s = route.indexOf(marker);
      const seg = route.slice(s, route.indexOf('router.', s + marker.length));
      const at = seg.indexOf('await rejectUnregisteredCallbacks(req.params.id, r.rows[0], res)');
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(seg.indexOf('await attemptBlocksChange('));
      expect(seg).toMatch(/SELECT [^`]*company_id, created_by, callback_number/);
    });
  }

  it('발송 직전 재검증과 라우트가 같은 CT이고, 문장도 접수와 같은 CT다', () => {
    expect(worker).toMatch(/const \{ rowCallbacks, missing \} = await findUnregisteredRequestCallbacks\(row\);/);
    expect(worker).not.toMatch(/getRegisteredCallbackSet\(/);
    expect(route).toMatch(/error: unregisteredCallbackError\(missing\)/);
    expect(intake).toMatch(/return \{ ok: false, status: 400, error: unregisteredCallbackError\(unregisteredRows\) \};/);
  });

  it('CT 행위: 고객별 번호와 대표 번호를 함께 보고, 미등록만 돌려준다', async () => {
    vi.resetModules();
    vi.doMock('../../config/database', () => ({
      query: async (sql: string) => {
        if (sql.includes('SELECT DISTINCT callback')) return { rows: [{ callback: '0311111111' }, { callback: '0322222222' }] };
        return { rows: [] };
      },
      default: { query: async () => ({ rows: [{ ok: 1 }] }) },
      pool: { query: async () => ({ rows: [{ ok: 1 }] }) },
    }));
    vi.doMock('../callback-filter', () => ({
      getRegisteredCallbackSet: async () => new Set(['0311111111']),
      isCallbackRegistered: () => true,
    }));
    const { findUnregisteredRequestCallbacks } = await import('../agency-send-intake');
    const r = await findUnregisteredRequestCallbacks({ id: 'x', company_id: 'c', created_by: 'u', callback_number: '02-1234-5678' });
    vi.doUnmock('../../config/database');
    vi.doUnmock('../callback-filter');
    expect(r.rowCallbacks).toEqual(['0311111111', '0322222222']);
    expect(r.missing.sort()).toEqual(['0212345678', '0322222222']);
  });
});

describe('대행 ④ 화면 접수 본문 상한', () => {
  it('상한은 그대로 두고, 넘으면 대행발송 경로에 한해 사유와 다른 입구를 알려 준다', () => {
    const globalAt = app.indexOf('app.use(express.json({ limit: LIMITS.requestBodySize }));');
    const handlerAt = app.indexOf("app.use('/api/agency-send', (err: any");
    expect(globalAt).toBeGreaterThan(0);
    expect(handlerAt).toBeGreaterThan(globalAt);
    const handler = app.slice(handlerAt, app.indexOf('});', handlerAt));
    expect(handler).toMatch(/entity\.too\.large/);
    expect(handler).toMatch(/code: 'BODY_TOO_LARGE'/);
    expect(read('../../config/defaults.ts')).toMatch(/requestBodySize: '50mb'/);
  });
});

describe('대행 ⑥ 직접발송 워커 키 기준 페이지', () => {
  it('청크 조회에 OFFSET이 없고 직전 청크의 마지막 id 뒤를 읽으며, 재시작 때만 한 번 자리를 찾는다', () => {
    const loop = between(directWorker, 'while (processed < total) {', 'const recipients: ChunkRecipient[]');
    expect(loop).not.toMatch(/LIMIT \$2 OFFSET \$3/);
    expect(loop).toMatch(/WHERE staging_id = \$1 AND id > \$3::bigint ORDER BY id ASC LIMIT \$2/);
    expect(loop).toMatch(/if \(lastId === null && processed > 0\) \{[\s\S]*ORDER BY id ASC LIMIT 1 OFFSET \$2[\s\S]*\[stagingId, processed - 1\]/);
    expect(loop).toMatch(/lastId = String\(chunkRes\.rows\[chunkRes\.rows\.length - 1\]\.id\);/);
    // 전역 순번·진행 수는 종전 그대로 processed 기준이다
    expect(directWorker).toMatch(/const globalIndex = processed \+ i;/);
    expect(directWorker).toMatch(/processed \+= chunkRes\.rows\.length;/);
  });
});

describe('대행 ⑧ 저장 컬럼 없는 메일이 tick을 멈추지 않는다', () => {
  it('고객별 회신번호 저장 컬럼 부재는 스키마 부재 판정보다 먼저 보고, 그 메일만 넘기고 계속한다(재시도 계단에 태우지 않는다)', () => {
    const c = between(mailWorker, 'await processMessage({ client: pop, mailbox, octets, now }, u.seq, u.uidl);', '// 통 단위 격리');
    expect(c).toMatch(/if \(isRecipientCallbackColumnMissing\(err\)\) \{[\s\S]*continue;\s*\}\s*if \(isMissingRelation\(err\)\) return;/);
    // 코어가 던지는 문장과 판정 문자열이 같다
    expect(intake).toContain('column "callback" of relation "agency_send_recipients" does not exist');
    expect(mailWorker).toContain('column "callback" of relation "agency_send_recipients" does not exist');
  });
});

describe('싱크 ③④', () => {
  it('재발급은 감사 기록을 남기고 키·시크릿 원문은 싣지 않는다', () => {
    const seg = between(admin, "router.post('/companies/:id/sync-keys/regenerate'", 'res.json({');
    expect(seg).toMatch(/action: 'sync_key_regenerate'/);
    expect(seg).toMatch(/details: \{ apiKeyTail: newApiKey\.slice\(-4\) \}/);
    expect(between(seg, 'await recordAuditLog({', '});')).not.toMatch(/newApiSecret|hashSecret/);
  });

  it('사용 토글은 방금 받은 1회 노출 시크릿을 지우지 않는다(같은 키일 때만)', () => {
    const seg = between(adminDashboard, 'const handleSyncToggle = async', '// 슈퍼관리자 고객 목록 로드');
    expect(seg).toMatch(/prev\.api_secret && prev\.api_key === data\.syncKeys\?\.api_key \? \{ api_secret: prev\.api_secret \} : \{\}/);
  });
});

afterEach(() => {
  vi.doUnmock('../../config/database');
  vi.doUnmock('../callback-filter');
});
