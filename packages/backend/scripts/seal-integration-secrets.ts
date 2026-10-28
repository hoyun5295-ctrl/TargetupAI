/**
 * seal-integration-secrets.ts — 몰 연동 자격 다시 쓰기(★ 2026-10-28 자사몰 대비 K8 · 설계서 §3 DML-2 · 되돌림 DML-2R)
 *
 * 왜: 배포 뒤 새로 쓰는 자격은 행 생성 CT 가 암호화하지만, 이미 저장된 행은 평문이다. 행마다 읽기 이중 CT 로 읽어 암호문으로 다시 쓴다.
 *   --reverse = 같은 키로 풀어 평문으로 다시 쓴다(secret-box 가 없는 판으로 코드를 되돌려야 할 때만 · 설계서 §5 되돌림 최저판).
 *
 * 실행(운영 서버 · 키 CDP_SECRET_BOX_KEY 를 .env 에 넣고 앱을 다시 띄운 뒤 · DDL-2 뒤):
 *   cd packages/backend && npx ts-node scripts/seal-integration-secrets.ts            (다시 쓰기)
 *   cd packages/backend && npx ts-node scripts/seal-integration-secrets.ts --reverse  (되돌림)
 *
 * 하는 일: company_integrations 행마다 access_token · refresh_token · webhook_secret · meta 비밀 키를 한 행씩 바꾼다.
 *   행을 읽은 때와 값이 같을 때만 쓴다(그 사이 앱이 새 토큰을 쓰면 0행 = 건너뜀 · 다음 실행이 다시 본다).
 * 출력: 행 수 · 바꾼 행 · 건너뛴 행 · 실패 행(행 id 만 · 비밀 값 0). 실패 0 이 될 때까지 다시 친다.
 */
import 'dotenv/config';
import { resealIntegrationSecrets } from '../src/utils/secret-box-reseal';

async function main(): Promise<number> {
  const reverse = process.argv.slice(2).includes('--reverse');
  const r = await resealIntegrationSecrets(reverse);
  if (r.webhookLeftPlain) console.warn('webhook_secret 칸이 짧습니다(DDL-2 전) — 웹훅 비밀은 평문으로 두었습니다. DDL-2 뒤 다시 실행하세요.');
  console.log(`${reverse ? '되돌림(평문)' : '다시 쓰기(암호문)'} · 행 ${r.rows} · 바꿈 ${r.changed} · 그 사이 바뀌어 건너뜀 ${r.skipped} · 실패 ${r.failed.length}${r.failed.length ? ` (${r.failed.join(', ')})` : ''}`);
  return r.failed.length > 0 || r.skipped > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err?.message || err); process.exit(1); });
