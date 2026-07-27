/**
 * 비대화형 DB 접속 진단 (`--test-db`)
 *
 * 왜 있나 (2026-07-28):
 *  1) 티어 × 드라이버 조합 검증. 설치 마법사는 대화형 readline이라 스크립트로 답을 흘려넣으면
 *     프롬프트보다 먼저 도착한 줄이 버려져 입력이 밀린다 — 실행마다 결과가 달라 재현이 안 된다.
 *     검증이 비싸면 결국 아무도 안 하게 되고, 미검증 산출물이 고객에게 나간다(2026-07-27 사고).
 *  2) 현장 진단. 고객사에서 접속이 안 될 때 마법사 5단계를 다 타지 않고 한 줄로 원인을 본다.
 *
 * 하는 일은 마법사 Step 2·3과 같다 — 접속 → 테이블 목록 → 컬럼 목록.
 * 접속 로직을 새로 쓰지 않고 createDbConnector를 그대로 쓴다(마법사와 다른 코드로 검증하면 검증이 아니다).
 *
 * 하지 않는 일: 설정 저장·에이전트 기동·한줄로 API 호출. 읽기만 한다.
 *
 * 사용:
 *   sync-agent --test-db --type mysql --host 10.0.0.5 --port 3306 --db shop --user readonly --pass '****'
 *   sync-agent --test-db --type postgres --host db --port 5432 --db shop --user ro --pass-env DBPW --ssl
 *
 * 출력: 사람이 읽는 요약 + 마지막에 기계용 한 줄 `__TEST_DB__ {json}`.
 *   로그(winston)가 같은 콘솔로 나오므로 파서는 이 표식만 본다.
 * 종료 코드: 0 = 접속·조회 성공 / 1 = 실패 / 2 = 인자 오류.
 */

import { createDbConnector } from '../db';
import type { DbConnectionConfig, DbType } from '../db/types';
import { initLogger } from '../logger';

const MARKER = '__TEST_DB__';
const SUPPORTED: DbType[] = ['mysql', 'mssql', 'oracle', 'postgres'];

interface TestDbResult {
  ok: boolean;
  driver?: string;
  host?: string;
  database?: string;
  tls?: boolean;
  tables?: number;
  table?: string | null;
  columns?: number;
  primaryKey?: string | null;
  elapsedMs?: number;
  /** 실패 시 어느 단계에서 멈췄는지 — connect / tables / columns */
  stage?: 'args' | 'connect' | 'tables' | 'columns';
  error?: string;
}

/** `--flag value` 형태 한 개를 읽는다. 값이 없으면 undefined. */
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return undefined;
  const v = argv[i + 1];
  return v.startsWith('--') ? undefined : v;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.indexOf(flag) >= 0;
}

function emit(result: TestDbResult): void {
  console.log('');
  if (result.ok) {
    console.log(`  [OK] ${result.driver} ${result.host}/${result.database} (TLS ${result.tls ? 'on' : 'off'})`);
    console.log(`       테이블 ${result.tables}개 / '${result.table}' 컬럼 ${result.columns}개` +
      (result.primaryKey ? ` / PK ${result.primaryKey}` : ' / PK 없음'));
    console.log(`       소요 ${result.elapsedMs}ms`);
  } else {
    console.log(`  [FAIL] ${result.stage} 단계에서 실패`);
    console.log(`         ${result.error}`);
  }
  // 기계용 한 줄. 비밀번호는 어디에도 싣지 않는다.
  console.log(`${MARKER} ${JSON.stringify(result)}`);
}

export async function runTestDb(argv: string[]): Promise<void> {
  // 커넥터가 winston으로 info를 쏟아내면 사람이 읽는 요약이 묻힌다. 에러만 남긴다.
  // 로그 파일을 못 만드는 폴더(읽기전용 등)에서도 진단은 돌아야 하므로 실패를 삼킨다.
  try {
    initLogger({ level: 'error' });
  } catch {
    /* 로깅 없이 진행 */
  }

  const type = (flagValue(argv, '--type') || '').toLowerCase() as DbType;
  const host = flagValue(argv, '--host');
  const portRaw = flagValue(argv, '--port');
  const database = flagValue(argv, '--db');
  const username = flagValue(argv, '--user');
  // 비밀번호를 명령줄에 그대로 쓰면 프로세스 목록에 남는다. 환경변수 경로를 함께 둔다.
  const passEnvName = flagValue(argv, '--pass-env');
  const password = passEnvName
    ? (process.env[passEnvName] || '')
    : (flagValue(argv, '--pass') || '');
  const ssl = hasFlag(argv, '--ssl');
  const sslCaPath = flagValue(argv, '--ssl-ca');
  const wantTable = flagValue(argv, '--table');
  const queryTimeout = parseInt(flagValue(argv, '--timeout') || '15000', 10);

  const missing: string[] = [];
  if (!SUPPORTED.includes(type)) missing.push(`--type (${SUPPORTED.join('|')})`);
  if (!host) missing.push('--host');
  if (!portRaw) missing.push('--port');
  if (!database) missing.push('--db');
  if (!username) missing.push('--user');

  if (missing.length > 0) {
    emit({ ok: false, stage: 'args', error: `필수 인자 누락: ${missing.join(', ')}` });
    console.log('');
    console.log('  예) sync-agent --test-db --type mysql --host 10.0.0.5 --port 3306 \\');
    console.log('        --db shop --user readonly --pass-env DBPW [--ssl] [--ssl-ca /path/ca.pem] [--table members]');
    process.exit(2);
    return;
  }

  const port = parseInt(portRaw as string, 10);
  if (!Number.isFinite(port) || port <= 0) {
    emit({ ok: false, stage: 'args', error: `--port 값이 숫자가 아닙니다: ${portRaw}` });
    process.exit(2);
    return;
  }

  const config: DbConnectionConfig = {
    type,
    host: host as string,
    port,
    database: database as string,
    username: username as string,
    password,
    queryTimeout: Number.isFinite(queryTimeout) ? queryTimeout : 15000,
    ssl,
    sslCaPath: sslCaPath || undefined,
  };

  const started = Date.now();
  const connector = createDbConnector(config);
  let stage: TestDbResult['stage'] = 'connect';

  try {
    const connected = await connector.testConnection();
    if (!connected) {
      throw new Error('testConnection()이 false를 돌려줬습니다 (자격증명·권한·방화벽 확인)');
    }

    stage = 'tables';
    const tables = await connector.getTables();

    // 테이블 0개를 성공으로 보고하지 않는다. 붙기는 붙었는데 아무것도 안 보이는 상태는
    // 현장에서 대부분 권한(읽기 권한 미부여)이나 스키마 지정 오류다. 그걸 [OK]로 답하면
    // 담당자가 엉뚱한 곳을 뒤진다. 마법사도 이 상태에서는 테이블을 못 고른다.
    if (tables.length === 0) {
      throw new Error(
        '접속은 됐지만 테이블이 하나도 보이지 않습니다 — 계정 읽기 권한 또는 DB/스키마 지정을 확인하세요.',
      );
    }

    if (wantTable && !tables.includes(wantTable)) {
      throw new Error(`--table '${wantTable}' 이(가) 목록에 없습니다 (조회된 ${tables.length}개 중)`);
    }
    const target = wantTable || tables[0];

    stage = 'columns';
    const cols = await connector.getColumns(target);
    const columns = cols.length;
    const primaryKey = cols.find((c) => c.isPrimaryKey)?.name || null;

    emit({
      ok: true,
      driver: type,
      host: config.host,
      database: config.database,
      tls: ssl,
      tables: tables.length,
      table: target,
      columns,
      primaryKey,
      elapsedMs: Date.now() - started,
    });
    await connector.disconnect().catch(() => undefined);
    process.exit(0);
  } catch (error) {
    emit({
      ok: false,
      stage,
      driver: type,
      host: config.host,
      database: config.database,
      tls: ssl,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    await connector.disconnect().catch(() => undefined);
    process.exit(1);
  }
}
