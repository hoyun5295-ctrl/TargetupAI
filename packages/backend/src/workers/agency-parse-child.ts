/**
 * ★ 2026-09-26 한줄로 V2 S1-H03 — 대행 요청서·명단 엑셀 파싱 자식 프로세스
 *
 * 부모 = utils/agency-send-parse-isolated.ts (요청 1건 = 프로세스 1개 · 결과를 한 번 보내고 끝난다).
 * DB·네트워크를 모른다. 파서는 agency-send-form 그대로다(값이 종전과 같아야 한다).
 * 순서: 기동 → { type: 'ready' } → 부모가 { formBuf, listBuf } → { type: 'result', form, list } → 종료.
 *
 * ⛔ 파서 경로(normalize → standard-field-map)가 DB 설정 모듈을 끌어오는데, 그 모듈은 불러오는 순간
 *   PG·MySQL에 연결한다(config/database.ts). 파싱은 DB를 쓰지 않으므로 이 프로세스에서는 **연결 없는 빈 모듈**로
 *   먼저 채운 뒤 파서를 불러온다(업로드마다 DB 연결이 열리지 않게). 그래서 파서는 import가 아니라 아래 require다.
 */
const dbUnavailable = () => { throw new Error('agency-parse-child: DB 사용 불가'); };
const dbPath = require.resolve('../config/database');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, children: [], paths: [],
  exports: { __esModule: true, query: dbUnavailable, mysqlQuery: dbUnavailable, mysqlBillingQuery: dbUnavailable },
} as any;

const { parseAgencyRequestForm, parseAgencyRecipientList } =
  require('../utils/agency-send-form') as typeof import('../utils/agency-send-form');

const toBuffer = (v: any): Buffer | null =>
  v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null;

process.once('message', (msg: any) => {
  const formBuf = toBuffer(msg?.formBuf);
  const listBuf = toBuffer(msg?.listBuf);
  const form = formBuf ? parseAgencyRequestForm(formBuf) : null;
  let list: ReturnType<typeof parseAgencyRecipientList> | null = null;
  if (listBuf) {
    try { list = parseAgencyRecipientList(listBuf); } catch { list = null; }
  }
  process.send!({ type: 'result', form, list }, () => process.exit(0));
});

process.send!({ type: 'ready' });
