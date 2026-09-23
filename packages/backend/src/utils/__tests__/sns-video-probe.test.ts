/**
 * SNS 영상 판독 CT (2026-09-23 1차-B · docs/2026-09-23-sns-1b-design.md §3-3 · 불변 21·22)
 *
 * 잠그는 것
 *   1. 길이·표시 크기(회전 반영)·코덱 표식·초당 프레임을 상자에서 읽는다
 *   2. moov 가 mdat 뒤에 있으면 fastStart=false
 *   3. moov 앞당김은 **영상 바이트를 바꾸지 않는다** — 위치표만 밀고, 밀린 위치에서 같은 바이트가 읽힌다
 *   4. 못 읽는 값은 null(모름 ≠ 불합격)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { probeSnsVideoBuffer, probeSnsVideoFile, relocateMoovToFront } from '../sns-video-probe';

// ───────────── 합성 MP4 조립기(테스트 전용) ─────────────
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
}
function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function u16(n: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16BE(n, 0); return b; }
function zeros(n: number): Buffer { return Buffer.alloc(n); }
function fixed16(n: number): Buffer { return u32(Math.round(n * 65536) >>> 0); }
/** 3x3 행렬(16.16 · u,v,w 는 2.30 이지만 테스트는 0/1 만 쓴다) */
function matrix(a: number, b: number, c: number, d: number): Buffer {
  return Buffer.concat([fixed16(a), fixed16(b), u32(0), fixed16(c), fixed16(d), u32(0), u32(0), u32(0), u32(0x40000000)]);
}

function mvhd(timescale: number, duration: number): Buffer {
  return box('mvhd', u32(0), u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), zeros(10),
    matrix(1, 0, 0, 1), zeros(24), u32(2));
}
function tkhd(width: number, height: number, m: Buffer): Buffer {
  return box('tkhd', u32(0x00000003), u32(0), u32(0), u32(1), u32(0), u32(0), zeros(8), u16(0), u16(0), u16(0), u16(0),
    m, fixed16(width), fixed16(height));
}
function mdhd(timescale: number, duration: number): Buffer {
  return box('mdhd', u32(0), u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
}
function hdlr(kind: string): Buffer {
  return box('hdlr', u32(0), u32(0), Buffer.from(kind, 'ascii'), zeros(12), Buffer.from('h\0', 'ascii'));
}
function stsd(fourcc: string): Buffer {
  return box('stsd', u32(0), u32(1), box(fourcc, zeros(78)));
}
function stts(count: number, delta: number): Buffer {
  return box('stts', u32(0), u32(1), u32(count), u32(delta));
}
function stco(offsets: number[]): Buffer {
  return box('stco', u32(0), u32(offsets.length), ...offsets.map(u32));
}
function trak(opts: { kind: 'vide' | 'soun'; fourcc: string; w: number; h: number; m?: Buffer; ts: number; dur: number; samples: number; offsets: number[] }): Buffer {
  const stbl = box('stbl', stsd(opts.fourcc), stts(opts.samples, Math.round(opts.dur / opts.samples)), stco(opts.offsets));
  return box('trak',
    tkhd(opts.w, opts.h, opts.m ?? matrix(1, 0, 0, 1)),
    box('mdia', mdhd(opts.ts, opts.dur), hdlr(opts.kind), box('minf', stbl)));
}
function ftyp(major = 'isom'): Buffer {
  return box('ftyp', Buffer.from(major, 'ascii'), u32(0x200), Buffer.from('isomavc1', 'ascii'));
}

/** [ftyp][mdat][moov] — 휴대폰 촬영본처럼 moov 가 뒤에 있는 파일. 청크 위치는 mdat 안을 가리킨다. */
function buildMoovLast(): { file: Buffer; samples: Buffer[] } {
  const f = ftyp();
  const samples = [Buffer.from('FRAME-A-FRAME-A'), Buffer.from('FRAME-B-FRAME-B'), Buffer.from('AUDIO-1')];
  const mdat = box('mdat', ...samples);
  const base = f.length + 8;
  const offA = base;
  const offB = base + samples[0].length;
  const offC = base + samples[0].length + samples[1].length;
  const moov = box('moov',
    mvhd(1000, 12_500),
    trak({ kind: 'vide', fourcc: 'avc1', w: 1080, h: 1920, ts: 30000, dur: 375_000, samples: 375, offsets: [offA, offB] }),
    trak({ kind: 'soun', fourcc: 'mp4a', w: 0, h: 0, ts: 48000, dur: 600_000, samples: 586, offsets: [offC] }));
  return { file: Buffer.concat([f, mdat, moov]), samples };
}

function readStcoOffsets(file: Buffer): number[] {
  const out: number[] = [];
  let i = file.indexOf('stco', 0, 'ascii');
  while (i >= 0) {
    const count = file.readUInt32BE(i + 8);
    for (let k = 0; k < count; k++) out.push(file.readUInt32BE(i + 12 + k * 4));
    i = file.indexOf('stco', i + 4, 'ascii');
  }
  return out;
}

describe('영상 판독', () => {
  it('길이 · 크기 · 코덱 · 초당 프레임을 상자에서 읽는다', () => {
    const { file } = buildMoovLast();
    const p = probeSnsVideoBuffer(file);
    expect(p.hasMoov).toBe(true);
    expect(p.durationSec).toBeCloseTo(12.5, 3);
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
    expect(p.videoCodec).toBe('avc1');
    expect(p.audioCodec).toBe('mp4a');
    expect(p.fps).toBeCloseTo(30, 1);
    expect(p.container).toBe('mp4');
  });

  it('moov 가 mdat 뒤면 fastStart=false · 앞이면 true', () => {
    const { file } = buildMoovLast();
    expect(probeSnsVideoBuffer(file).fastStart).toBe(false);
    const f = ftyp();
    const moov = box('moov', mvhd(1000, 5000));
    expect(probeSnsVideoBuffer(Buffer.concat([f, moov, box('mdat', zeros(10))])).fastStart).toBe(true);
  });

  it('90도 회전 행렬이면 표시 크기의 가로·세로가 바뀐다', () => {
    const f = ftyp();
    const moov = box('moov', mvhd(600, 6000),
      trak({ kind: 'vide', fourcc: 'hvc1', w: 1920, h: 1080, m: matrix(0, 1, -1, 0), ts: 600, dur: 6000, samples: 300, offsets: [0] }));
    const p = probeSnsVideoBuffer(Buffer.concat([f, moov, box('mdat', zeros(4))]));
    expect(p.width).toBe(1080);
    expect(p.height).toBe(1920);
    expect(p.videoCodec).toBe('hvc1');
  });

  it('QuickTime 브랜드면 mov 로 본다', () => {
    const f = ftyp('qt  ');
    const p = probeSnsVideoBuffer(Buffer.concat([f, box('moov', mvhd(600, 600)), box('mdat', zeros(4))]));
    expect(p.container).toBe('mov');
  });

  it('⛔ 못 읽는 값은 null — 모름을 불합격으로 만들지 않는다', () => {
    const p = probeSnsVideoBuffer(Buffer.concat([ftyp(), box('mdat', zeros(4))]));
    expect(p.hasMoov).toBe(false);
    expect(p.durationSec).toBeNull();
    expect(p.width).toBeNull();
    expect(p.videoCodec).toBeNull();
    // 상자가 깨져도 던지지 않는다
    expect(() => probeSnsVideoBuffer(Buffer.from('not a video at all'))).not.toThrow();
  });

  it('압축된 moov 는 표식으로 알린다(앞당길 수 없다)', () => {
    const p = probeSnsVideoBuffer(Buffer.concat([ftyp(), box('mdat', zeros(4)), box('moov', box('cmov', zeros(8)))]));
    expect(p.compressedMoov).toBe(true);
  });
});

describe('⛔ moov 앞당김 — 영상 바이트는 한 바이트도 바뀌지 않는다(불변 21)', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-probe-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('순서가 ftyp → moov → mdat 이 되고, 밀린 위치에서 같은 표본이 읽힌다', async () => {
    const { file, samples } = buildMoovLast();
    const src = path.join(dir, 'in.mp4');
    const dst = path.join(dir, 'out.mp4');
    fs.writeFileSync(src, file);

    const r = await relocateMoovToFront(src, dst);
    expect(r.moved).toBe(true);

    const out = fs.readFileSync(dst);
    expect(out.length).toBe(file.length);   // 크기 그대로(순서만 바뀐다)
    const p = await probeSnsVideoFile(dst);
    expect(p.fastStart).toBe(true);
    expect(p.durationSec).toBeCloseTo(12.5, 3);

    const before = readStcoOffsets(file);
    const after = readStcoOffsets(out);
    const moovSize = file.length - file.indexOf('moov', 0, 'ascii') + 4;
    expect(after).toEqual(before.map((o) => o + moovSize));
    // 위치표가 가리키는 바이트가 원래 표본과 같다
    expect(out.subarray(after[0], after[0] + samples[0].length).equals(samples[0])).toBe(true);
    expect(out.subarray(after[1], after[1] + samples[1].length).equals(samples[1])).toBe(true);
    expect(out.subarray(after[2], after[2] + samples[2].length).equals(samples[2])).toBe(true);
  });

  it('이미 앞에 있으면 옮기지 않는다', async () => {
    const f = ftyp();
    const src = path.join(dir, 'fast.mp4');
    fs.writeFileSync(src, Buffer.concat([f, box('moov', mvhd(1000, 1000)), box('mdat', zeros(8))]));
    const r = await relocateMoovToFront(src, path.join(dir, 'fast-out.mp4'));
    expect(r.moved).toBe(false);
  });

  it('압축된 moov 는 거절한다', async () => {
    const src = path.join(dir, 'cmov.mp4');
    fs.writeFileSync(src, Buffer.concat([ftyp(), box('mdat', zeros(4)), box('moov', box('cmov', zeros(8)))]));
    await expect(relocateMoovToFront(src, path.join(dir, 'cmov-out.mp4'))).rejects.toThrow();
  });
});
