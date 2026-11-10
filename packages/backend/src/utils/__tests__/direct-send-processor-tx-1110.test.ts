// ★ 2026-11-10 처리기 tx 갈래 — 세 채널 모두 QueueTxAbort 를 부분 수습하지 않고 던진다 · 피로도 = 커밋 뒤 · tx 를 넘기는 곳은 처리기 · 워커뿐(소스 계약)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const st = vi.hoisted(() => ({ throwAbort: false, fatigue: 0, smsOpts: [] as any[], brandTx: [] as any[], alimTx: [] as any[] }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
}));
vi.mock('../sms-queue', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { QueueTxAbort } = await import('../queue-load-tx');
  return {
    ...actual,
    getEtcJsonCapacity: vi.fn(async () => 1024),
    bulkInsertSmsQueue: vi.fn(async (_t: string[], rows: any[][], _u: boolean, _c: any, opts?: any) => { st.smsOpts.push(opts); if (st.throwAbort) throw new QueueTxAbort('x'); return rows.length; }),
    insertBrandQueue: vi.fn(async (_t: string[], rows: any[], _a?: string, _b?: string, tx?: any) => { st.brandTx.push(tx); if (st.throwAbort) throw new QueueTxAbort('x'); return rows.length; }),
    insertAlimtalkQueue: vi.fn(async (_t: string[], rows: any[], _a?: string, tx?: any) => { st.alimTx.push(tx); if (st.throwAbort) throw new QueueTxAbort('x'); return rows.length; }),
  };
});
vi.mock('../fatigue-guard', async (importOriginal) => ({ ...(await importOriginal<any>()), recordFatigueSends: vi.fn(async () => { st.fatigue++; }) }));

import { processSendChunk, type SendChunkParams } from '../direct-send-processor';
import { QueueTxAbort, type QueueTx } from '../queue-load-tx';

const base = (over: Partial<SendChunkParams>): SendChunkParams => ({
  companyId: 'c-1', campaignId: 'camp-1', companyTables: ['SMSQ_SEND_1'],
  recipients: [{ phone: '01000000001', sendTime: '' }], directFieldMappings: {},
  sendChannel: 'sms', msgType: 'LMS', message: '안내입니다', subject: '제목', callback: '0212345678',
  useIndividualCallback: false, finalIsAd: true, opt080: '0800000000', mmsImagePaths: [], useNow: true, scheduled: false,
  ...over,
} as SendChunkParams);
const fakeTx = () => { const hooks: Array<() => any> = []; const tx: QueueTx = { run: async () => [], afterCommit: (f) => { hooks.push(f); } }; return { tx, hooks }; };

beforeEach(() => { Object.assign(st, { throwAbort: false, fatigue: 0, smsOpts: [], brandTx: [], alimTx: [] }); });

describe('processSendChunk tx 갈래', () => {
  it('세 채널 모두 tx 를 큐 CT 에 넘기고 QueueTxAbort 는 그대로 던진다(부분 수습 0)', async () => {
    const { tx } = fakeTx();
    st.throwAbort = true;
    await expect(processSendChunk(base({ tx }))).rejects.toBeInstanceOf(QueueTxAbort);
    await expect(processSendChunk(base({ tx, sendChannel: 'kakao', kakaoSenderKey: 'k', kakaoBubbleType: 'TEXT' } as any))).rejects.toBeInstanceOf(QueueTxAbort);
    await expect(processSendChunk(base({ tx, sendChannel: 'alimtalk', alimtalkTemplateCode: 'T1', alimtalkNextType: 'N' } as any))).rejects.toBeInstanceOf(QueueTxAbort);
    expect(st.smsOpts[0]).toEqual({ tx });
    expect(st.brandTx[0]).toBe(tx);
    expect(st.alimTx[0]).toBe(tx);
  });
  it('피로도 = tx 면 커밋 뒤(바로 0 · 커밋 뒤 함수 1) · tx 없으면 지금처럼 바로', async () => {
    const { tx, hooks } = fakeTx();
    await processSendChunk(base({ tx }));
    expect(st.fatigue).toBe(0);
    expect(hooks.length).toBe(1);
    await hooks[0]();
    expect(st.fatigue).toBe(1);
    await processSendChunk(base({}));
    expect(st.smsOpts[1]).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(st.fatigue).toBe(2);
  });
});

describe('소스 계약 — tx 를 넘기는 곳', () => {
  it('세 큐 CT 에 tx 를 넘기는 파일 = 직접발송 처리기 하나 · 처리기에 tx 를 넘기는 파일 = 직접발송 워커 하나', () => {
    const SRC = join(__dirname, '..', '..');
    const files: string[] = [];
    (function walk(d: string) {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (e !== '__tests__' && e !== 'node_modules') walk(p); }
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
      }
    })(SRC);
    // 정의 파일(sms-queue.ts · 인자 이름 tx)은 부르는 곳이 아니다
    const passTx = files.filter((f) => !/[\\/]sms-queue\.ts$/.test(f) && /(bulkInsertSmsQueue|insertBrandQueue|insertAlimtalkQueue)\([^;]*\btx\b/.test(readFileSync(f, 'utf8')));
    expect(passTx.map((f) => f.replace(/\\/g, '/').split('/src/').pop())).toEqual(['utils/direct-send-processor.ts']);
    const procTx = files.filter((f) => /processSendChunk\(\{ \.\.\.chunkParams, tx \}\)/.test(readFileSync(f, 'utf8')));
    expect(procTx.map((f) => f.replace(/\\/g, '/').split('/src/').pop())).toEqual(['utils/direct-send-worker.ts']);
  });
});
