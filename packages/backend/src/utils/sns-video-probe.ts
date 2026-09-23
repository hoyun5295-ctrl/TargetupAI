/**
 * sns-video-probe.ts — SNS 영상 판독 · moov 앞당김 CT (2026-09-23 1차-B)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-7 · docs/2026-09-23-sns-1b-design.md §3-1·§3-3 · 불변 21·22.
 *
 * 하는 일 둘.
 *   ① **판독** — MP4·MOV(ISO-BMFF) 상자를 읽어 길이·표시 크기(회전 반영)·코덱 표식·초당 프레임·moov 위치를 꺼낸다.
 *      화면과 저장이 "이 영상을 이 채널이 받는가"를 올리기 전에 말할 수 있게 한다.
 *   ② **moov 앞당김** — 인스타·Threads 규격이 "moov atom at the front" 를 요구한다. 휴대폰 촬영본은 moov 가
 *      뒤에 있는 경우가 흔하다. 상자 순서만 바꾸고 청크 위치표(stco·co64)를 그만큼 민다.
 *
 * ⛔ 불변 21 = **영상·음성 바이트는 한 바이트도 바꾸지 않는다.** 다시 인코딩하지 않는다(ffmpeg 0).
 * ⛔ 불변 22 = **못 읽은 값은 null.** 모름을 불합격으로 만들지 않는다 — 판정은 확인된 위반만 막는다.
 * ⛔ 판독은 절대 던지지 않는다. 깨진 파일이면 hasMoov=false 로 돌아온다(호출부가 사유를 말한다).
 */

import { promises as fsp } from 'fs';

export interface SnsVideoProbe {
  /** ftyp 브랜드 기준. QuickTime(`qt  `)이면 mov. 모르면 null */
  container: 'mp4' | 'mov' | null;
  hasMoov: boolean;
  /** moov 가 첫 mdat 보다 앞인가. moov 가 없으면 false */
  fastStart: boolean;
  /** moov 가 압축돼 있는가(cmov) — 앞당길 수 없고 채널도 대개 거부한다 */
  compressedMoov: boolean;
  durationSec: number | null;
  /** **표시 크기**(회전 행렬 반영). 세로 촬영본은 width < height 로 나온다 */
  width: number | null;
  height: number | null;
  /** 첫 영상 트랙의 표본 표식(avc1·avc3 = H264 / hvc1·hev1 = HEVC) */
  videoCodec: string | null;
  audioCodec: string | null;
  fps: number | null;
}

interface TopBox { type: string; start: number; size: number; headerSize: number }

/** moov 를 메모리에 올릴 상한. 15분 영상의 위치표도 수 MB 다 — 이보다 크면 비정상 파일로 본다. */
const MOOV_MAX_BYTES = 64 * 1024 * 1024;

const EMPTY: SnsVideoProbe = {
  container: null, hasMoov: false, fastStart: false, compressedMoov: false,
  durationSec: null, width: null, height: null, videoCodec: null, audioCodec: null, fps: null,
};

// ───────────────────────── 상자 읽기 ─────────────────────────

/** buf 안 [from, to) 구간의 자식 상자들. 크기가 깨진 상자를 만나면 거기서 멈춘다. */
function childBoxes(buf: Buffer, from: number, to: number): Array<{ type: string; start: number; body: number; end: number }> {
  const out: Array<{ type: string; start: number; body: number; end: number }> = [];
  let p = from;
  while (p + 8 <= to) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      if (p + 16 > to) break;
      const big = buf.readBigUInt64BE(p + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < header || p + size > to) break;
    out.push({ type, start: p, body: p + header, end: p + size });
    p += size;
  }
  return out;
}

function find(buf: Buffer, from: number, to: number, type: string) {
  return childBoxes(buf, from, to).find((b) => b.type === type) ?? null;
}

/** 16.16 고정소수 */
function fixed(buf: Buffer, at: number): number {
  return buf.readInt32BE(at) / 65536;
}

interface TrackInfo {
  handler: string | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
}

function readTrack(moov: Buffer, trak: { body: number; end: number }): TrackInfo {
  const info: TrackInfo = { handler: null, width: null, height: null, codec: null, fps: null };

  const tkhd = find(moov, trak.body, trak.end, 'tkhd');
  if (tkhd) {
    const version = moov.readUInt8(tkhd.body);
    // v0: 4(ver/flags)+4+4+4+4+4 = 24 → reserved 8 → layer·alt·volume·reserved 8 → matrix 36 → width·height
    // v1: 4+8+8+4+4+8 = 36 → 이하 같다
    const base = tkhd.body + (version === 1 ? 36 : 24) + 8 + 8;
    if (base + 36 + 8 <= tkhd.end) {
      const a = fixed(moov, base);
      const b = fixed(moov, base + 4);
      const w = fixed(moov, base + 36);
      const h = fixed(moov, base + 40);
      // 90·270도 = a≈0 이고 |b|≈1 → 표시할 때 가로·세로가 바뀐다
      const rotated = Math.abs(a) < 0.01 && Math.abs(Math.abs(b) - 1) < 0.01;
      if (w > 0 && h > 0) {
        info.width = Math.round(rotated ? h : w);
        info.height = Math.round(rotated ? w : h);
      }
    }
  }

  const mdia = find(moov, trak.body, trak.end, 'mdia');
  if (!mdia) return info;

  const hdlr = find(moov, mdia.body, mdia.end, 'hdlr');
  if (hdlr && hdlr.body + 12 <= hdlr.end) info.handler = moov.toString('latin1', hdlr.body + 8, hdlr.body + 12);

  let timescale: number | null = null;
  const mdhd = find(moov, mdia.body, mdia.end, 'mdhd');
  if (mdhd) {
    const version = moov.readUInt8(mdhd.body);
    const at = mdhd.body + (version === 1 ? 20 : 12);
    if (at + 4 <= mdhd.end) timescale = moov.readUInt32BE(at) || null;
  }

  const minf = find(moov, mdia.body, mdia.end, 'minf');
  const stbl = minf ? find(moov, minf.body, minf.end, 'stbl') : null;
  if (!stbl) return info;

  const stsd = find(moov, stbl.body, stbl.end, 'stsd');
  if (stsd && stsd.body + 16 <= stsd.end) {
    // stsd = ver/flags 4 · entry_count 4 · 첫 항목(size 4 · 표식 4)
    info.codec = moov.toString('latin1', stsd.body + 12, stsd.body + 16);
  }

  const stts = find(moov, stbl.body, stbl.end, 'stts');
  if (stts && timescale) {
    const n = moov.readUInt32BE(stts.body + 4);
    let samples = 0;
    let ticks = 0;
    for (let i = 0; i < n && stts.body + 8 + i * 8 + 8 <= stts.end; i++) {
      const count = moov.readUInt32BE(stts.body + 8 + i * 8);
      const delta = moov.readUInt32BE(stts.body + 12 + i * 8);
      samples += count;
      ticks += count * delta;
    }
    if (samples > 0 && ticks > 0) info.fps = Math.round((samples / (ticks / timescale)) * 100) / 100;
  }
  return info;
}

/** moov 상자 하나(머리 포함)를 읽어 값을 채운다. 어디서 깨지든 읽은 데까지만 돌려준다. */
function readMoov(moov: Buffer, headerSize: number, into: SnsVideoProbe): void {
  const top = childBoxes(moov, headerSize, moov.length);
  if (top.some((b) => b.type === 'cmov')) into.compressedMoov = true;

  const mvhd = top.find((b) => b.type === 'mvhd');
  if (mvhd) {
    const version = moov.readUInt8(mvhd.body);
    const tsAt = mvhd.body + (version === 1 ? 20 : 12);
    if (tsAt + (version === 1 ? 12 : 8) <= mvhd.end) {
      const timescale = moov.readUInt32BE(tsAt);
      const duration = version === 1 ? Number(moov.readBigUInt64BE(tsAt + 4)) : moov.readUInt32BE(tsAt + 4);
      if (timescale > 0 && duration > 0) into.durationSec = Math.round((duration / timescale) * 1000) / 1000;
    }
  }

  for (const trak of top.filter((b) => b.type === 'trak')) {
    const t = readTrack(moov, trak);
    if (t.handler === 'vide' && into.videoCodec === null) {
      into.videoCodec = t.codec;
      into.width = t.width;
      into.height = t.height;
      into.fps = t.fps;
    } else if (t.handler === 'soun' && into.audioCodec === null) {
      into.audioCodec = t.codec;
    }
  }
}

function containerFromFtyp(buf: Buffer, body: number, end: number): 'mp4' | 'mov' | null {
  if (body + 4 > end) return null;
  return buf.toString('latin1', body, body + 4) === 'qt  ' ? 'mov' : 'mp4';
}

// ───────────────────────── 판독 ─────────────────────────

/** 메모리에 있는 파일 전체를 판독한다(테스트·작은 파일용). */
export function probeSnsVideoBuffer(buf: Buffer): SnsVideoProbe {
  const out: SnsVideoProbe = { ...EMPTY };
  try {
    const top = childBoxes(buf, 0, buf.length);
    const ftyp = top.find((b) => b.type === 'ftyp');
    if (ftyp) out.container = containerFromFtyp(buf, ftyp.body, ftyp.end);
    const moov = top.find((b) => b.type === 'moov');
    const mdat = top.find((b) => b.type === 'mdat');
    if (!moov) return out;
    out.hasMoov = true;
    out.fastStart = !mdat || moov.start < mdat.start;
    readMoov(buf.subarray(moov.start, moov.end), moov.body - moov.start, out);
  } catch {
    /* 읽은 데까지만 */
  }
  return out;
}

/** 파일의 최상위 상자 목록 — 머리 16바이트씩만 읽는다(300MB 를 메모리에 올리지 않는다). */
async function topBoxes(fh: fsp.FileHandle, fileSize: number): Promise<TopBox[]> {
  const out: TopBox[] = [];
  const head = Buffer.alloc(16);
  let p = 0;
  while (p + 8 <= fileSize) {
    const { bytesRead } = await fh.read(head, 0, 16, p);
    if (bytesRead < 8) break;
    let size = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    let headerSize = 8;
    if (size === 1) {
      if (bytesRead < 16) break;
      const big = head.readBigUInt64BE(8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(big);
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - p;
    }
    if (size < headerSize || p + size > fileSize) break;
    out.push({ type, start: p, size, headerSize });
    p += size;
  }
  return out;
}

async function readRange(fh: fsp.FileHandle, start: number, size: number): Promise<Buffer> {
  const buf = Buffer.alloc(size);
  let got = 0;
  while (got < size) {
    const { bytesRead } = await fh.read(buf, got, size - got, start + got);
    if (bytesRead <= 0) break;
    got += bytesRead;
  }
  return got === size ? buf : buf.subarray(0, got);
}

/** 디스크의 영상 파일을 판독한다. moov 만 메모리에 올린다. */
export async function probeSnsVideoFile(absPath: string): Promise<SnsVideoProbe> {
  const out: SnsVideoProbe = { ...EMPTY };
  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(absPath, 'r');
    const { size } = await fh.stat();
    const top = await topBoxes(fh, size);
    const ftyp = top.find((b) => b.type === 'ftyp');
    if (ftyp) {
      const buf = await readRange(fh, ftyp.start, Math.min(ftyp.size, 64));
      out.container = containerFromFtyp(buf, ftyp.headerSize, buf.length);
    }
    const moov = top.find((b) => b.type === 'moov');
    const mdat = top.find((b) => b.type === 'mdat');
    if (!moov) return out;
    out.hasMoov = true;
    out.fastStart = !mdat || moov.start < mdat.start;
    if (moov.size > MOOV_MAX_BYTES) return out;
    readMoov(await readRange(fh, moov.start, moov.size), moov.headerSize, out);
  } catch {
    /* 읽은 데까지만 */
  } finally {
    await fh?.close().catch(() => undefined);
  }
  return out;
}

// ───────────────────────── moov 앞당김 ─────────────────────────

export class SnsVideoRelocateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SnsVideoRelocateError';
    this.code = code;
  }
}

/** 상자 안의 stco·co64 위치값을 전부 고친다. moov 속 위치표만 파일 위치를 담는다. */
function patchChunkOffsets(moov: Buffer, shift: (offset: number) => number): void {
  const walk = (from: number, to: number) => {
    for (const b of childBoxes(moov, from, to)) {
      if (b.type === 'trak' || b.type === 'mdia' || b.type === 'minf' || b.type === 'stbl') {
        walk(b.body, b.end);
      } else if (b.type === 'stco') {
        const n = moov.readUInt32BE(b.body + 4);
        for (let i = 0; i < n; i++) {
          const at = b.body + 8 + i * 4;
          if (at + 4 > b.end) break;
          const next = shift(moov.readUInt32BE(at));
          if (next > 0xffffffff) throw new SnsVideoRelocateError('OFFSET_OVERFLOW', '영상 위치표를 고치지 못했어요.');
          moov.writeUInt32BE(next, at);
        }
      } else if (b.type === 'co64') {
        const n = moov.readUInt32BE(b.body + 4);
        for (let i = 0; i < n; i++) {
          const at = b.body + 8 + i * 8;
          if (at + 8 > b.end) break;
          moov.writeBigUInt64BE(BigInt(shift(Number(moov.readBigUInt64BE(at)))), at);
        }
      }
    }
  };
  walk(8, moov.length);
}

async function copyRange(src: fsp.FileHandle, dst: fsp.FileHandle, start: number, size: number): Promise<void> {
  const CHUNK = 1024 * 1024;
  const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size)));
  let done = 0;
  while (done < size) {
    const want = Math.min(buf.length, size - done);
    const { bytesRead } = await src.read(buf, 0, want, start + done);
    if (bytesRead <= 0) throw new SnsVideoRelocateError('SHORT_READ', '영상 파일을 끝까지 읽지 못했어요.');
    await dst.write(buf, 0, bytesRead);
    done += bytesRead;
  }
}

/**
 * moov 를 ftyp 바로 뒤로 옮긴 파일을 `outPath` 에 쓴다. 이미 앞이면 아무것도 쓰지 않고 `moved:false`.
 *
 * 새 순서 = ftyp → moov(위치표 보정) → 원래 moov 앞에 있던 상자들 → 원래 moov 뒤에 있던 상자들.
 * 원래 moov 앞(ftyp 뒤)에 있던 바이트는 전부 moov 크기만큼 뒤로 밀리고, moov 뒤에 있던 바이트는 제자리다.
 * 그래서 위치값 o 는 `o < moov 시작` 이면 +moov 크기, 아니면 그대로다.
 */
export async function relocateMoovToFront(inPath: string, outPath: string): Promise<{ moved: boolean }> {
  const src = await fsp.open(inPath, 'r');
  try {
    const { size } = await src.stat();
    const top = await topBoxes(src, size);
    const moov = top.find((b) => b.type === 'moov');
    const firstMdat = top.find((b) => b.type === 'mdat');
    if (!moov) throw new SnsVideoRelocateError('NO_MOOV', '영상 정보를 찾지 못했어요. 다른 파일로 올려 주세요.');
    if (!firstMdat || moov.start < firstMdat.start) return { moved: false };
    if (moov.size > MOOV_MAX_BYTES) throw new SnsVideoRelocateError('MOOV_TOO_LARGE', '영상 정보가 너무 커서 처리하지 못했어요.');
    const covered = top.reduce((s, b) => s + b.size, 0);
    if (covered !== size) throw new SnsVideoRelocateError('BROKEN_BOXES', '영상 파일 구조를 읽지 못했어요. 다른 파일로 올려 주세요.');

    const ftyp = top[0]?.type === 'ftyp' ? top[0] : null;
    const moovBuf = await readRange(src, moov.start, moov.size);
    if (childBoxes(moovBuf, moov.headerSize, moovBuf.length).some((b) => b.type === 'cmov')) {
      throw new SnsVideoRelocateError('COMPRESSED_MOOV', '압축된 영상 정보는 처리할 수 없어요. 편집 앱에서 다시 내보내 주세요.');
    }
    if (moov.headerSize !== 8) throw new SnsVideoRelocateError('LARGE_MOOV_HEADER', '영상 정보를 처리하지 못했어요.');

    patchChunkOffsets(moovBuf, (o) => (o < moov.start ? o + moov.size : o));

    const dst = await fsp.open(outPath, 'w');
    try {
      if (ftyp) await copyRange(src, dst, ftyp.start, ftyp.size);
      await dst.write(moovBuf, 0, moovBuf.length);
      for (const b of top) {
        if (b === ftyp || b === moov) continue;
        await copyRange(src, dst, b.start, b.size);
      }
    } finally {
      await dst.close();
    }
    return { moved: true };
  } finally {
    await src.close();
  }
}
