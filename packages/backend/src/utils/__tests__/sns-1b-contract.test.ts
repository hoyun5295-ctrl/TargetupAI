/**
 * SNS 1차-B 구조 계약 (2026-09-23 · docs/2026-09-23-sns-1b-design.md §3-6 · §3-8 · 불변 23·24·25)
 *
 * 워커·라우트는 DB 를 타서 단위로 돌리기 어렵다 — 그래서 **실행되는 SQL·호출 순서**를 소스에서 잠근다
 * (sns-contract.test.ts 워커 계약과 같은 방식). 주석이 아니라 코드 조각을 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WORKER = readFileSync(resolve(__dirname, '../sns-publish-worker.ts'), 'utf8');
const RECON = readFileSync(resolve(__dirname, '../sns-reconcile-worker.ts'), 'utf8');
const TOKEN = readFileSync(resolve(__dirname, '../sns-token-worker.ts'), 'utf8');
const ACCOUNTS = readFileSync(resolve(__dirname, '../sns-accounts.ts'), 'utf8');
const ROUTE = readFileSync(resolve(__dirname, '../../routes/sns.ts'), 'utf8');

/** 주석 줄을 뺀 코드만(주석에 같은 낱말이 있어도 통과하지 않게) */
function code(src: string): string {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

describe('D1 — 처리 대기는 워커를 붙들지 않고, 재개 선점이 다시 잡는다(불변 24)', () => {
  const w = code(WORKER);

  it('tick 안에서 기다리는 반복이 없다', () => {
    expect(w).not.toMatch(/for \(;;\)/);
    expect(w).not.toMatch(/setTimeout\(r, \d/);
  });

  it('재개 선점 = submitted · 게시 id 없음 · 컨테이너 있음 · next_attempt_at 도래', () => {
    const claim = w.slice(w.indexOf(`SET status = 'claimed', lock_token`));
    expect(claim).toMatch(/status = 'submitted'\s+AND platform_post_id IS NULL\s+AND container_id IS NOT NULL\s+AND next_attempt_at IS NOT NULL\s+AND next_attempt_at <= NOW\(\)/);
  });

  it('⛔ 게시 호출 직전 기록이 next_attempt_at 을 비운다 — 게시까지 간 행은 재개 대상이 아니다(이중 게시 차단)', () => {
    expect(w).toMatch(/stage = 'publish_called', next_attempt_at = NULL/);
  });

  it('준비 안 된 컨테이너는 submitted 로 두고 채널 간격만큼 미룬다', () => {
    expect(w).toMatch(/status = 'submitted', stage = 'container_processing'[\s\S]{0,200}next_attempt_at = NOW\(\) \+ \(\$4 \|\| ' seconds'\)::interval/);
    expect(w).toMatch(/pollIntervalSec/);
  });
});

describe('D3 — 컨테이너 실패 상한', () => {
  it('3회째 실패는 다시 만들지 않고 닫는다', () => {
    const w = code(WORKER);
    expect(w).toMatch(/CONTAINER_FAIL_LIMIT = 3/);
    expect(w).toMatch(/attempts >= CONTAINER_FAIL_LIMIT[\s\S]{0,300}status = 'failed'/);
  });
});

describe('B4 · 불변 25 — 1회용 refresh token 은 행 잠금 안에서만', () => {
  it('사용 직전 갱신은 계정 행을 FOR UPDATE 로 잡고, 잡은 뒤 만료를 다시 본다', () => {
    const fn = code(ACCOUNTS).slice(code(ACCOUNTS).indexOf('export async function ensureFreshSnsToken'));
    expect(fn).toMatch(/FOR UPDATE/);
    expect(fn.indexOf('FOR UPDATE')).toBeLessThan(fn.indexOf('adapter.refreshToken('));
    expect(fn).toMatch(/lockedExp > Date\.now\(\)/);
  });

  it('발행·대조 워커가 게시·확인 직전에 그 함수를 부른다 · 토큰 워커는 scheduled 채널만 돈다', () => {
    expect(code(WORKER)).toMatch(/ensureFreshSnsToken\(account, adapter\)/);
    expect(code(RECON)).toMatch(/ensureFreshSnsToken\(account, adapter\)/);
    expect(code(TOKEN)).toMatch(/tokenRefresh !== 'scheduled'\) continue/);
  });
});

describe('불변 23 — 실비 채널 월 상한 · 개방 판정', () => {
  const w = code(WORKER);

  it('월 상한은 컨테이너(업로드)를 만들기 전에 센다', () => {
    const cap = w.indexOf('meteredMonthCount(row.platform)');
    const create = w.indexOf('adapter.createPost(req)');
    expect(cap).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(create);
  });

  it('워커도 개방 판정 함수를 다시 부른다(ENV 가 그 사이 비면 보내지 않는다)', () => {
    expect(w).toMatch(/snsChannelAvailable\(adapter, row\.company_id\)/);
  });

  it('실비 채널은 삭제 감지(반복 과금)에서 빠진다', () => {
    expect(code(RECON)).toMatch(/capabilities\.metered\) continue/);
  });
});

describe('라우트 — 조각 업로드 · 저장 판정 · 연결 확장', () => {
  const r = code(ROUTE);

  it('조각은 octet-stream 원본으로만 받고 조각 크기에 묶인다', () => {
    expect(r).toMatch(/router\.put\(\s*'\/media\/uploads\/:id\/chunks\/:index',\s*raw\(\{ type: 'application\/octet-stream', limit: SNS_UPLOAD_CHUNK_BYTES \+ 1024 \}\)/);
  });

  it('저장은 게시물 행을 만들기 전에 채널별 수용·영상 판정을 끝낸다', () => {
    // ★ 2026-09-24 저장은 CT(sns-compose.ts composeSnsPost)로 옮겼다 — 라우트는 CT 만 부른다.
    const route = r.slice(r.indexOf(`router.post('/posts'`), r.indexOf(`router.post('/posts/:id/publish'`));
    expect(route).toMatch(/composeSnsPost\(/);
    expect(route).not.toMatch(/INSERT INTO sns_posts/);
    const COMPOSE = code(readFileSync(resolve(__dirname, '../sns-compose.ts'), 'utf8'));
    const post = COMPOSE.slice(COMPOSE.indexOf('export async function composeSnsPost'));
    const insert = post.indexOf('INSERT INTO sns_posts');
    expect(insert).toBeGreaterThan(-1);
    expect(post.indexOf('snsMediaBlockReason(')).toBeGreaterThan(-1);
    expect(post.indexOf('snsMediaBlockReason(')).toBeLessThan(insert);
    expect(post.indexOf('planSnsVideoFit(')).toBeLessThan(insert);
    expect(post.indexOf('snsChannelAvailable(')).toBeLessThan(insert);
  });

  it('PKCE verifier 는 1회용 state 행에만 두고 소비와 함께 꺼낸다', () => {
    expect(r).toMatch(/statePayload\.code_verifier = verifier/);
    expect(r).toMatch(/RETURNING state_nonce, created_by, payload/);
    expect(r).toMatch(/exchangeToken\(creds\.credentials, code, \{ codeVerifier \}\)/);
  });

  it('로그인 1회에 계정 N개 채널은 행을 N개 만든다', () => {
    expect(r).toMatch(/if \(adapter\.fetchAccounts\)/);
    expect(r).toMatch(/for \(const item of list\)[\s\S]{0,200}upsertPendingAccount/);
  });

  it('권한 회수 = 사람 id 채널은 meta.profile.owner_user_id 로 찾는다(회사 조건 없이 한 행으로 좁히지 않는다)', () => {
    expect(r).toMatch(/meta->'profile'->>'owner_user_id' = \$2/);
  });

  it('서명 서빙은 서명 속 미디어로 파일을 고른다(D2 · 영상 원본)', () => {
    expect(r).toMatch(/resolveSnsServeFile\(\{ companyId: payload\.companyId, targetId: payload\.targetId, media: m\.rows\[0\] \}\)/);
    expect(r).not.toMatch(/\$\{payload\.targetId\}\.jpg/);
  });
});
