/**
 * purge-retired-demo-company.ts — 은퇴한 시연 회사 완전 삭제(★ 2026-10-10 Harold 지시 "목록에서도 아예 없애기")
 *
 * 지우는 대상 = 회사 행 + 그 회사 데이터 전부. 표 목록은 DB 가 정한다(손으로 적은 표 목록 없음):
 *   ① companies 의 그 행  ② company_id 칸이 있는 모든 표의 그 회사 행
 *   ③ ①② 행을 외래키로 가리키는 행(삭제 규칙 NO ACTION · RESTRICT · CASCADE · 재귀) — SET NULL · SET DEFAULT 는 DB 가 비우므로 지우지 않는다.
 *
 * 지킴(하나라도 어기면 아무것도 안 한다):
 *   - 대상 회사 = is_demo true + 회사 코드 HJDEMO_ 로 시작(시드 --rebuild 가 붙인 은퇴 표식) + 로그인 hanjulai 없음 + 지금 .env 싱크 키의 회사가 아님
 *   - 지울 행 중 company_id 가 이 회사가 아닌 행(다른 회사 · 빈 값)이 하나라도 있으면 중단(다른 회사 데이터 0)
 *   - 지울 행이 외래키로 가리키는 대상이 삭제 집합 밖이면 중단(다른 회사 사용자 · 자산에 걸친 행 = 소유 증명 실패 · company_id 없는 표 포함 · Codex 1R)
 *   - 자기참조 · 순환 외래키(지우는 규칙)가 걸리면 중단(연쇄 삭제가 점검 · 백업 밖 행을 지울 수 있다 · Codex 1R)
 *   - 여러 칸 외래키가 지울 행을 가리키면 중단(이 스크립트가 다루지 않는 모양)
 *   - 실행은 --apply --expect=<점검 총 건수> 일 때만 · REPEATABLE READ 한 트랜잭션 · 회사 행 FOR UPDATE 뒤 자격을 다시 확인 ·
 *     다시 센 수 ≠ expect 면 중단 · 그 사이 다른 쪽이 행을 바꾸면 직렬화 오류로 전부 되돌린다(세기 · 백업 · 삭제가 같은 시점을 본다)
 *   - 지우기 전에 지울 행 전부를 실행마다 새 파일(독점 생성 · 권한 600 · JSON 한 줄씩)로 남긴다 · 표마다 지운 수 = 센 수가 아니면 롤백
 *
 * 실행(운영 서버 · packages/backend):
 *   점검: npx ts-node scripts/purge-retired-demo-company.ts <회사 id>
 *   삭제: npx ts-node scripts/purge-retired-demo-company.ts <회사 id> --apply --expect=<점검 총 건수>
 */
import 'dotenv/config';
import os from 'os';
import path from 'path';
import pool from '../src/config/database';
import { loadFkCatalog, planDeletion, printDeletePlan, backupThenDelete, qi, type DeleteRoot } from '../src/utils/fk-delete-plan';
import { parseSyntheticSyncKeys } from '../src/utils/demo-data';

const RETIRED_CODE_PREFIX = 'HJDEMO_';
const DEMO_LOGIN_ID = 'hanjulai';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const companyId = (args.find((a) => !a.startsWith('--')) || '').trim();
  const apply = args.includes('--apply');
  const expectArg = args.find((a) => a.startsWith('--expect='));
  const expect = expectArg ? Number(expectArg.split('=')[1]) : NaN;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) throw new Error('회사 id(uuid)를 첫 인자로 주세요.');
  if (apply && !Number.isInteger(expect)) throw new Error('--apply 에는 --expect=<점검 총 건수> 가 필요합니다.');

  const client = await pool.connect();
  try {
    // ── 트랜잭션 · 잠금 먼저, 그다음 자격 확인(확인과 삭제 사이에 자격이 바뀌지 않게 · Codex 1R)
    await client.query(apply ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
    if (apply) {
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SELECT id FROM companies WHERE id = $1::uuid FOR UPDATE`, [companyId]);
    }
    // ── 대상 확인
    const c = await client.query(`SELECT id, company_code, is_demo, api_key FROM companies WHERE id = $1::uuid`, [companyId]);
    if (c.rows.length === 0) throw new Error('회사가 없습니다.');
    const co = c.rows[0];
    if (co.is_demo !== true) throw new Error('시연 회사가 아닙니다. 중단합니다.');
    if (!String(co.company_code || '').startsWith(RETIRED_CODE_PREFIX)) throw new Error(`은퇴 표식(${RETIRED_CODE_PREFIX}) 회사가 아닙니다. 중단합니다.`);
    const login = await client.query(`SELECT 1 FROM users WHERE company_id = $1::uuid AND login_id = $2 LIMIT 1`, [companyId, DEMO_LOGIN_ID]);
    if (login.rows.length) throw new Error(`${DEMO_LOGIN_ID} 계정이 아직 이 회사에 있습니다. 중단합니다.`);
    // 매일 합성 데이터 워커가 쓰는 키(시연 키 + SYNTHETIC_SYNC_KEYS)의 회사면 지우지 않는다
    if (parseSyntheticSyncKeys().some((k) => k.apiKey === String(co.api_key || ''))) throw new Error('지금 매일 합성 데이터 워커가 쓰는 회사입니다. 중단합니다.');

    // ── 삭제 계획(공용 CT utils/fk-delete-plan · DB 카탈로그가 정한다) — 시작 표 = 회사 행 + company_id 칸이 있는 모든 표
    const catalog = await loadFkCatalog(client);
    const roots = new Map<string, DeleteRoot>([['companies', { pred: `${qi('id')} = $1::uuid`, depth: 0, via: '대상 회사' }]]);
    for (const t of catalog.hasCompanyId) if (t !== 'companies') roots.set(t, { pred: `${qi('company_id')} = $1::uuid`, depth: 1, via: 'company_id' });
    const p = await planDeletion(client, catalog, roots, companyId);
    printDeletePlan(p, `지울 대상: 회사 ${companyId} (${co.company_code})`);
    if (p.foreignTotal > 0 || p.blocking) {
      await client.query('ROLLBACK');
      throw new Error('삭제 집합 밖을 가리키는 행 · 순환 외래키 · 다루지 않는 외래키가 있어 지우지 않습니다. 위 목록을 그대로 보내 주세요.');
    }
    if (!apply) {
      await client.query('ROLLBACK');
      console.log(`\n점검만 했습니다(쓰기 0). 지우려면: npx ts-node scripts/purge-retired-demo-company.ts ${companyId} --apply --expect=${p.total}`);
      return;
    }
    if (p.total !== expect) {
      await client.query('ROLLBACK');
      throw new Error(`다시 센 총 건수(${p.total})가 --expect(${expect})와 달라 지우지 않습니다.`);
    }

    // ── 백업(지우기 전 · 권한 600) → 깊은 표부터 지우기 → 표마다 지운 수 = 센 수(어긋나면 throw → 아래 catch 가 전부 되돌린다)
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupPath = path.join(os.homedir(), `demo-purge-${companyId}-${stamp}.jsonl`);
    await backupThenDelete(client, p, companyId, backupPath);
    const left = await client.query(`SELECT COUNT(*)::int AS n FROM companies WHERE id = $1::uuid`, [companyId]);
    if (Number(left.rows[0].n) !== 0) {
      await client.query('ROLLBACK');
      throw new Error('회사 행이 남아 전부 되돌렸습니다.');
    }
    await client.query('COMMIT');
    console.log(`\n지웠습니다: 총 ${p.total}행 · 백업 파일 ${backupPath}(권한 600 · 확인 뒤 지우세요)`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('은퇴한 시연 회사 삭제 실패:', err?.message || err);
  process.exit(1);
});
