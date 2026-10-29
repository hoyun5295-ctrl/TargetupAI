/**
 * 싱크에이전트 키 발급 = 설치 서버 공인 IP 필수 · 출발지 등록 한 번에 (★ 2026-10-29 · 설계서 docs/2026-10-29-sync-key-origin-required-design.md §5-1 · §5-3 · 뿌리 R29)
 *
 * 운영은 기계 출발지 통제 시행 중이라 등록 안 된 IP 의 에이전트는 싱크 API 가 전부 403 이고, 마법사는 AI 매핑 403 을 로컬 매핑으로 말없이 넘긴다.
 * 키 발급(재발급 라우트)과 출발지 등록(국외 접근 통제 화면)이 따로라 빠뜨리면 조용히 막혔다 → 발급 CT 한 곳에서 IP 를 받아 같은 트랜잭션에 등록.
 * 주소 = 문서용 대역(203.0.113.0/24 · 2001:db8::/32 · 도달 불가).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAgentOriginIp } from '../geo-access';

const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + 1);
  expect(i, a).toBeGreaterThanOrEqual(0);
  expect(j, b).toBeGreaterThan(i);
  return s.slice(i, j);
};

describe('parseAgentOriginIp — 공인 IP 한 개 → 표준 꼴 + CIDR(설계서 §2-2)', () => {
  it('빈 값 · 대역은 사유와 함께 거절', () => {
    expect(parseAgentOriginIp('')).toEqual({ ok: false, reason: '설치 서버의 공인 IP를 입력해주세요.' });
    expect(parseAgentOriginIp('   ')).toEqual({ ok: false, reason: '설치 서버의 공인 IP를 입력해주세요.' });
    expect(parseAgentOriginIp(undefined)).toEqual({ ok: false, reason: '설치 서버의 공인 IP를 입력해주세요.' });
    expect(parseAgentOriginIp('203.0.113.0/24')).toEqual({ ok: false, reason: 'IP 하나만 입력해주세요. 대역은 국외 접근 통제 화면에서 등록합니다.' });
  });

  it.each(['abc', '256.1.1.1', '1.2.3', '1:2:3:4:5:6:7:8:9', '::', 'fe80::1%eth0', '[::1]', '203.0.113.10:443', 'a@203.0.113.10'])('형식 아님: %s', (s) => {
    expect(parseAgentOriginIp(s)).toEqual({ ok: false, reason: 'IP 주소 형식이 아닙니다.' });
  });

  it.each(['192.168.0.10', '10.0.0.1', '127.0.0.1', '172.16.5.4', '169.254.1.1', 'fe80::1', '::1', '0:0:0:0:0:0:0:1', '::FFFF:192.168.0.10', '::ffff:10.0.0.1', '010.001.002.003', 'fd00::1'])(
    '사설 · 루프백(표준 꼴로 판정): %s',
    (s) => {
      expect(parseAgentOriginIp(s)).toEqual({ ok: false, reason: '사설 주소입니다. 설치 서버가 밖으로 나갈 때 쓰는 공인 IP를 입력해주세요.' });
    },
  );

  it('IPv4 = 10진 자리로 다시 써서 /32 · 앞뒤 공백 무시', () => {
    expect(parseAgentOriginIp('203.0.113.10')).toEqual({ ok: true, ip: '203.0.113.10', cidr: '203.0.113.10/32' });
    expect(parseAgentOriginIp(' 203.0.113.10 ')).toEqual({ ok: true, ip: '203.0.113.10', cidr: '203.0.113.10/32' });
    expect(parseAgentOriginIp('203.000.113.010')).toEqual({ ok: true, ip: '203.0.113.10', cidr: '203.0.113.10/32' });
  });

  it.each(['::ffff:203.0.113.10', '::FFFF:203.0.113.10', '0:0:0:0:0:ffff:cb00:710a', '::ffff:CB00:710A'])('IPv4-mapped = IPv4 로(요청 꼴과 같은 계열): %s', (s) => {
    expect(parseAgentOriginIp(s)).toEqual({ ok: true, ip: '203.0.113.10', cidr: '203.0.113.10/32' });
  });

  it('IPv6 = 표준 꼴(소문자 · 0 줄임) /128', () => {
    expect(parseAgentOriginIp('2001:DB8:0:0:0:0:0:1')).toEqual({ ok: true, ip: '2001:db8::1', cidr: '2001:db8::1/128' });
    expect(parseAgentOriginIp('2001:db8::1')).toEqual({ ok: true, ip: '2001:db8::1', cidr: '2001:db8::1/128' });
  });
});

describe('발급 · 조회 라우트 = CT 를 부르기만(설계서 §2-5)', () => {
  const admin = read('../../routes/admin.ts');

  it('재발급 라우트는 issueSyncAgentKeys 에 본문 originIp 를 넘기고 결과만 옮긴다', () => {
    const seg = between(admin, "router.post('/companies/:id/sync-keys/regenerate'", "router.put('/companies/:id/sync-keys'");
    expect(seg).toMatch(/await issueSyncAgentKeys\(\{ companyId: req\.params\.id, originIp: req\.body\?\.originIp, actorUserId: req\.user\?\.userId, req \}\)/);
    expect(seg).toMatch(/if \(!r\.ok\) return res\.status\(r\.status\)\.json\(\{ error: r\.error, code: r\.code \}\)/);
    expect(seg).not.toMatch(/randomBytes|hashSecret|UPDATE companies|INSERT INTO/);
    expect(seg).toMatch(/isInvalidCidrError\(error\)/);
  });

  it('admin.ts 는 싱크 자격 칸을 직접 쓰지 않는다 · 출발지 INSERT 도 CT 로', () => {
    expect(admin).not.toMatch(/SET\s+api_key\b/);
    expect(admin).not.toMatch(/INSERT INTO access_origin_allowlist/);
    const geo = between(admin, "router.post('/geo/exceptions'", "router.delete('/geo/exceptions/:id'");
    expect(geo).toMatch(/await insertOriginException\(query, \{/);
  });

  it('접속 허용 IP 조회 라우트는 listAgentOrigins 만 부른다', () => {
    const seg = between(admin, "router.get('/companies/:id/sync-origins'", "router.post('/companies/:id/sync-keys/regenerate'");
    expect(seg).toMatch(/res\.json\(await listAgentOrigins\(req\.params\.id, req\.user\?\.userId\)\)/);
    expect(seg).not.toMatch(/FROM access_origin_allowlist/);
  });
});

describe('싱크 탭 화면(설계서 §2-6)', () => {
  const tab = read('../../../../frontend/src/components/admin/company-detail/tabs/CompanySyncTab.tsx');

  it('재발급 요청 본문 = originIp · 빈 칸이면 확인 버튼 잠김 · 실패는 알리고 칸을 남긴다 · 성공일 때만 닫는다', () => {
    const fn = between(tab, 'const handleSyncRegenerate = async', '// SyncAgent use_db_sync 토글');
    expect(fn).toMatch(/body: JSON\.stringify\(\{ originIp: originIp\.trim\(\) \}\)/);
    expect(fn).toMatch(/'Content-Type': 'application\/json'/);
    expect(fn).toMatch(/await fetchAuthJson\(`\/api\/admin\/companies\/\$\{editCompany\.id\}\/sync-keys\/regenerate`, \{[\s\S]*?\}, ORIGIN_REQUEST_TIMEOUT_MS\)/);
    expect(fn).toMatch(/showAlert\('재발급 실패', data\.error \|\| '키를 발급하지 못했습니다\.'/);
    const okBranch = between(fn, 'if (res.ok && data) {', '} else if (!data) {');
    // 본문을 못 읽음(본문 읽기 시간 넘김 = fetchAuthJson data null) = 결과 불명 → 다시 조회(Codex 구현 2R)
    expect(between(fn, '} else if (!data) {', '} else {')).toMatch(/showAlert\('재발급 실패', ISSUE_OUTCOME_UNKNOWN, 'error'\);\s*loadOrigins\(\);/);
    expect(okBranch).toMatch(/setShowSyncRegenConfirm\(false\)/);
    expect(okBranch).toMatch(/loadOrigins\(\)/);
    expect(between(fn, '} finally {', '};')).not.toMatch(/setShowSyncRegenConfirm/);
    expect(tab).toMatch(/onClick=\{handleSyncRegenerate\} disabled=\{!originIp\.trim\(\)/);
  });

  it('발급 버튼 = 조회 성공 뒤 canIssue 일 때만 · 아니면 이유 한 줄', () => {
    expect(tab).toMatch(/!originsState \? null : !originsState\.canIssue \? \(/);
    expect(tab).toContain('키 발급은 국외 접근 통제를 바꿀 수 있는 등급만 할 수 있습니다.');
  });

  it('접속 허용 IP 칸 = 흐림 감싸기 밖 · 회수 = 국외 접근 통제 회수 라우트 · 실패 = 다시 불러오기 · 시행 두 문구', () => {
    const dimmed = between(tab, "{/* API Key 영역 */}", "{/* 접속 허용 IP");
    expect(dimmed).not.toMatch(/sync-origins|geo\/exceptions/);
    expect(tab).toMatch(/fetchAuthJson\(`\/api\/admin\/companies\/\$\{editCompany\.id\}\/sync-origins`, \{\}, ORIGIN_REQUEST_TIMEOUT_MS\)/);
    expect(tab).toMatch(/fetchAuthJson\(`\/api\/admin\/geo\/exceptions\/\$\{id\}`, \{\s*method: 'DELETE'/);
    expect(tab).toContain('접속 허용 IP를 불러오지 못했습니다.');
    expect(tab).toContain('다시 불러오기');
    expect(tab).toContain('출발지 통제가 켜져 있어 등록되지 않은 곳의 싱크에이전트 접속은 막힙니다.');
    expect(tab).toContain('지금은 기록만 하고 막지 않지만, 통제가 켜지면 막힙니다.');
    expect(tab).not.toMatch(/window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(/);
    // 이번 요청 셋(조회 · 발급 · 회수)은 상한 있는 fetchAuthJson(본문 읽기까지) · 사용 토글(옛 fetch)은 이번 범위 밖
    expect(between(tab, 'const loadOrigins = useCallback', '// SyncAgent use_db_sync 토글')).not.toMatch(/\bfetch\(/);
  });

  it('조회 = 불러오기 하나 = 차례 하나(첫 await 전에 받고 돌아올 때마다 확인 · 늦게 온 옛 응답은 아무것도 안 바꿈 · Codex 구현 1R)', () => {
    const load = between(tab, 'const loadOrigins = useCallback(async () => {', '}, [editCompany.id]);');
    const turnAt = load.indexOf('const turn = ++originsTurn.current;');
    expect(turnAt).toBeGreaterThan(0);
    expect(turnAt).toBeLessThan(load.indexOf('await '));
    const afterAwait = load.slice(load.indexOf('await '));
    expect(afterAwait.indexOf('if (turn !== originsTurn.current) return;')).toBeGreaterThan(0);
    expect(afterAwait.indexOf('if (turn !== originsTurn.current) return;')).toBeLessThan(afterAwait.indexOf('setOriginsState(data)'));
    expect(between(load, '} catch (error) {', 'setOriginsError(true)')).toMatch(/if \(turn !== originsTurn\.current\) return;/);
    expect(between(load, '} finally {', '}\n')).toMatch(/if \(turn === originsTurn\.current\) setOriginsLoading\(false\)/);
  });

  it('탭이 다시 만들어지거나 닫힌 뒤 늦게 온 발급 · 회수 응답은 부모 상태(키 · 시크릿 · 알림 · 로딩)를 안 바꾼다(Codex 구현 2R)', () => {
    expect(tab).toMatch(/useEffect\(\(\) => \{\s*alive\.current = true;\s*return \(\) => \{ alive\.current = false; \};\s*\}, \[\]\);/);
    for (const name of ['const handleSyncRegenerate = async', 'const handleRevokeOrigin = async']) {
      const fn = between(tab, name, '\n};\n');
      const afterAwait = fn.slice(fn.indexOf('ORIGIN_REQUEST_TIMEOUT_MS);'));
      expect(afterAwait.trimStart().slice('ORIGIN_REQUEST_TIMEOUT_MS);'.length).trimStart().startsWith('if (!alive.current) return;'), name).toBe(true);
      expect(between(fn, '} catch (error) {', 'console.error')).toMatch(/if \(!alive\.current\) return;/);
    }
    expect(between(tab, 'const handleSyncRegenerate = async', '\n};\n')).toMatch(/\} finally \{\s*if \(alive\.current\) setSyncLoading\(false\);/);
    expect(between(tab, 'const handleRevokeOrigin = async', '\n};\n')).toMatch(/if \(alive\.current\) loadOrigins\(\);/);
  });

  it('불러오는 동안 발급 · 회수 버튼 잠금 · 상태 주인(회사)이 바뀌면 key 로 다시 만든다', () => {
    expect(tab).toMatch(/onClick=\{\(\) => setShowSyncRegenConfirm\(true\)\} disabled=\{originsLoading\}/);
    expect(tab).toMatch(/disabled=\{!originIp\.trim\(\) \|\| originsLoading\}/);
    expect(tab).toMatch(/onClick=\{\(\) => handleRevokeOrigin\(o\.id\)\} disabled=\{revoking \|\| originsLoading\}/);
    expect(read('../../../../frontend/src/components/admin/company-detail/CompanyDetailModal.tsx')).toMatch(/<CompanySyncTab key=\{editCompany\.id\} /);
  });
});
