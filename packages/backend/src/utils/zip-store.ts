/**
 * zip-store.ts — 저장(무압축) ZIP 작성기 — 순수 · 외부 의존성 0 (2026-09-14 · 우커머스 플러그인 zip 배포)
 *
 * 왜 직접 쓰는가: zip 라이브러리가 의존성에 없고(archiver·adm-zip 없음), 플러그인은 텍스트 파일 몇 개라 압축이 필요 없다.
 * 새 의존성은 서버 npm install 단계를 요구해 배포 함정이 된다(0826 mailparser 누락 = API 다운 전례).
 *
 * 형식(PKWARE APPNOTE): 로컬 파일 헤더(0x04034b50) + 데이터 · 중앙 디렉터리(0x02014b50) · EOCD(0x06054b50).
 * 파일명은 UTF-8(플래그 비트 11) · 방식 0(store) · 시각은 DOS 형식(UTC 기준 · 2초 단위).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** 슬래시 경로(예 hanjullo-woocommerce/plugin.php). 역슬래시·상위 참조·절대 경로 금지 */
  name: string;
  data: Buffer;
  mtime?: Date;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getUTCFullYear());
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

function assertName(name: string): void {
  if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some((seg) => seg === '..' || seg === '')) {
    throw new Error(`zip 항목 이름이 올바르지 않습니다: ${name}`);
  }
}

/** 항목 배열 → zip 바이트. 같은 입력·같은 mtime 이면 같은 바이트(결정적 · 캐시·검증에 유리). */
export function buildStoredZip(entries: readonly ZipEntry[]): Buffer {
  if (!entries.length) throw new Error('zip 항목이 없습니다.');
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  for (const e of entries) {
    assertName(e.name);
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const { time, date } = dosDateTime(e.mtime ?? now);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flags: UTF-8 names
    local.writeUInt16LE(0, 8);             // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // local header offset

    locals.push(local, nameBuf, e.data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + e.data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
