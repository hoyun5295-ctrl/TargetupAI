/**
 * 옛 로컬 큐 정리 (★ 1.7.2 로컬 큐 폐지)
 *
 * 1.7.1 까지는 전송 실패분을 data/queue.db(sql.js)에 담아 30분마다 다시 보냈다. 그런데 같은 실패에 대해
 * 커서도 멈춰 있어 다음 회차가 같은 행을 다시 읽었다 — 재시도 길이 둘이었고, 큐의 옛 값이 그 사이 들어간
 * 새 값(수신거부 포함)을 덮을 수 있었다(2026-10-04 싱크·자사몰 전수점검 S8). 이제 재시도는 커서가 소유한다.
 *
 * 남은 옛 큐는 다시 보내지 않는다(옛 값이다). 지우지 않고 이름만 바꿔 남긴다 — 현장 진단용.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger';

const logger = getLogger('queue');

export function retireLegacyQueueFile(dataDir: string = path.resolve(process.cwd(), 'data')): string | null {
  const file = path.join(dataDir, 'queue.db');
  try {
    if (!fs.existsSync(file)) return null;
    const retired = path.join(dataDir, `queue.db.retired-${Date.now()}`);
    fs.renameSync(file, retired);
    logger.info(`옛 로컬 큐 파일을 보관 처리했습니다(다시 보내지 않음): ${path.basename(retired)}`);
    return retired;
  } catch (error) {
    // 이름을 못 바꿔도 동작에는 영향이 없다 — 이 버전은 큐를 읽지 않는다.
    logger.warn('옛 로컬 큐 파일 보관 처리 실패(무시하고 계속)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
