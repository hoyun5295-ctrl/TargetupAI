/**
 * 여정 V.3 — Codex 적대 1라운드 정정 고정(2026-10-20 · 서버 A1~A9 · 화면 B1~B8)
 *
 * 서버
 *   A2 새 모양 켜기 도중 사람 멈춤 → 같은 계보 잠금 · 원본이 멈췄으면 복제본을 켜지 않는다 · 멈춤도 같은 잠금
 *   A3 되살리기 = 그 실행의 다음 칸에 사람이 건 그날 정지 기록이 있으면 되살리지 않는다(보수)
 *   A4 「전체 고객」 해제도 병합 결과로 검사 · A6 휴면 복귀 기준 = 새 고객을 받는 판만
 *   A7 조건 닫힘(FALSE) 때 앞 조건 값이 호출자 배열에 남지 않는다 · A8 charged = 실제 차감 결말 · A9 켜기는 늘 한 트랜잭션
 * 화면
 *   B1 늦은 조회 응답 무시 · B2 칸 넣기/빼기 성공분 즉시 정리 · 결과 모름 = 서버 칸 수 대조 · B4 실패 뒤 sync(안 보낸 값 유지)
 *   B3 켜기 확인 창 = 포털 · 작업 화면 위 · 창 잡기 단계 Esc · B5 저장 중 화면 잠금 · B6 최신 값에 합침 · 요청 때 본문일 때만
 *   B7 칸마다 알림 토글 · A/B 새 부품 · B8 받는 모습 응답 무효화
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
const ROUTE = () => fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf-8');
const FE = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf-8');

vi.mock('../../config/database', () => { const query = vi.fn(); return { query, pool: { connect: vi.fn() } }; });

describe('A7 조건 닫힘 = 앞 조건 값을 남기지 않는다', () => {
  it('알 수 없는 칸이 뒤에 오면 FALSE · 호출자 배열은 그대로(쓰지 않는 $n 0)', async () => {
    const { applyCustomerConditions } = await import('../journey-target-extractor');
    const params: any[] = ['company'];
    const out = applyCustomerConditions([{ field: 'grade', op: '==', value: 'VIP' }, { field: 'nope', op: '==', value: 1 } as any], 'AND', params);
    expect(out).toBe('FALSE');
    expect(params).toEqual(['company']);
  });
  it('전부 옮길 수 있으면 값은 순서대로 붙고 번호는 호출자 배열 뒤에 이어진다', async () => {
    const { applyCustomerConditions } = await import('../journey-target-extractor');
    const params: any[] = ['company', 'x'];
    const out = applyCustomerConditions([{ field: 'grade', op: '==', value: 'VIP' }, { field: 'region', op: 'in', value: ['서울', '경기'] }], 'AND', params);
    expect(out).toBe('(c.grade = $3 AND c.region IN ($4, $5))');
    expect(params).toEqual(['company', 'x', 'VIP', '서울', '경기']);
  });
});

describe('A3 되살리기 보수 판정', () => {
  it('자동 멈춤 기록 + 다음 칸에 사람 그날 정지 기록 없음(여정 전체 정지 링크 제외)일 때만', async () => {
    const { RESUME_REVIVE_SQL } = await import('../journey-resume');
    expect(RESUME_REVIVE_SQL).toContain('l.pause_reason = ANY($2::text[])');
    expect(RESUME_REVIVE_SQL).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM journey_step_pause_logs m/);
    expect(RESUME_REVIVE_SQL).toContain("m.pause_reason = 'manager_manual'");
    expect(RESUME_REVIVE_SQL).toContain("COALESCE(m.pause_trigger_source, '') <> 'manager_link_journey'");
    expect(RESUME_REVIVE_SQL).toContain('s.step_order > e.current_step_order');
    // 기록 테이블 시각 칸(created_at · paused_at)에 기대지 않는다(칸 이름이 마이그레이션과 조회문에서 다르다 · 실측 전)
    expect(RESUME_REVIVE_SQL).not.toMatch(/created_at|paused_at/);
  });
});

describe('A2 · A9 켜기 · 멈춤 = 같은 계보 잠금 · 한 트랜잭션', () => {
  let db: any;
  beforeEach(async () => {
    db = await import('../../config/database');
    db.query.mockReset();
    db.pool.connect.mockReset();
  });
  it('사람 멈춤은 트랜잭션 안에서 계보 잠금을 잡은 뒤 멈춘다', async () => {
    const calls: string[] = [];
    db.query.mockImplementation(async (sql: string) => (/information_schema/.test(sql) ? { rows: [{ n: 2 }] } : { rows: [] }));
    db.pool.connect.mockResolvedValue({ query: async (sql: string) => { calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return { rows: /RETURNING j\.id/.test(sql) ? [{ id: 'a' }] : [] }; }, release: () => undefined });
    const lin: any = await import('../journey-lineage');
    lin.resetLineageCache?.(true);
    const ids = await lin.pauseJourneyLineage('c', 'j', '담당자가 일시정지');
    expect(ids).toEqual(['a']);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toMatch(/^SELECT pg_advisory_xact_lock/);
    expect(calls.some((c) => c.startsWith('UPDATE journeys j'))).toBe(true);
    expect(calls[calls.length - 1]).toBe('COMMIT');
  });
  it('새 모양 켜기 = 원본이 멈췄으면 같은 잠금 안에서 그만둔다(켜기 UPDATE 없음 · 되돌림)', () => {
    const b = SRC('journey-builder.ts');
    const fn = b.slice(b.indexOf('export async function activateJourney('), b.indexOf('// 활성화 종결 직후 = step snapshot 보존'));
    expect(fn).toContain('opts: { requireActiveSource?: string } = {}');
    const lock = fn.indexOf('await lockLineageEntry(actClient, journeyId);');
    const src = fn.indexOf('if (opts.requireActiveSource) {');
    const upd = fn.indexOf("status = 'active',");
    expect(lock).toBeGreaterThan(0);
    expect(src).toBeGreaterThan(lock);
    expect(upd).toBeGreaterThan(src);
    expect(fn).toContain("if (String(src.rows[0]?.status || '') !== 'active') sourceStopped = true;");
    expect(SRC('journey-reshape.ts')).toContain('requireActiveSource: journeyId');
    expect(SRC('journey-activation.ts')).toContain('activateJourney(companyId, journeyId, userId, { requireActiveSource: opts.requireActiveSource })');
  });
  it('A9 — 계보 컬럼 유무와 무관하게 BEGIN · 보정 실패는 던진다(삼키지 않는다)', () => {
    const b = SRC('journey-builder.ts');
    const fn = b.slice(b.indexOf('export async function activateJourney('), b.indexOf('// 활성화 종결 직후 = step snapshot 보존'));
    expect(fn).toContain('const actClient = await pool.connect();');
    expect(fn).not.toContain("closeOthers ? await pool.connect()");
    expect(fn).not.toContain('옛 단일 문장 경로 · 켜기는 유지');
    expect(fn).toContain("await actClient.query(inheritConflict ? 'ROLLBACK' : 'COMMIT');");
  });
  it('A1 — 운영 크레딧은 확인이 아니라 그 자리 차감(별도 시험 journey-v3-credit-out)', () => {
    expect(SRC('journey-executor.ts')).toContain('!(await reserveJourneyOperationCredit(exec, new Date()))');
  });
});

describe('A4 · A6 · A8', () => {
  it('A4 「전체 고객」 해제 요청도 병합 결과로 검사', () => {
    expect(ROUTE()).toContain("if (('customer_conditions' in body || 'all_customers' in body) && cur.trigger_event === 'custom'");
  });
  it('A4 짝 — 옛 상시 여정(조건 0 · 신호 키 없음)은 화면도 「전체 고객」(사실 그대로)', async () => {
    const { formFromJourney } = await import('../../../../frontend/src/utils/journey-start-form');
    expect(formFromJourney({ trigger_event: 'custom', trigger_filters: {} }).all_customers).toBe(true);
    expect(formFromJourney({ trigger_event: 'custom', trigger_filters: { all_customers: false } }).all_customers).toBe(false);
    expect(formFromJourney({ trigger_event: 'custom', trigger_filters: { customer_conditions: [{ field: 'grade', op: '==', value: 'A' }] } }).all_customers).toBe(false);
  });
  it('A6 휴면 복귀 기준일 = 새 고객을 받는 판만(진입 열림 조각)', () => {
    const w = SRC('journey-trigger-watcher.ts');
    const fn = w.slice(w.indexOf('async function loadDormantReturnDays'), w.indexOf('async function loadDormantReturnDays') + 900);
    expect(fn).toContain('${await entryOpenClause()}');
  });
  it('A8 charged = 차감 결말(받음 · 이미 받음만 금액 · 미적용 · 실패 = 0)', () => {
    const a = SRC('journey-activation.ts');
    expect(a).toContain("charged = outcome === 'deducted' || outcome === 'duplicate' ? getCreditCost('journey-activate') : 0;");
  });
});

describe('화면 B1~B8', () => {
  const ws = FE('components/journey/workspace/JourneyWorkspace.tsx');
  it('B1 늦은 조회 응답 = 요청 순번 + 지금 여정이 같을 때만 · 상세가 지금 여정일 때만 저장', () => {
    expect(ws).toContain('const current = () => seq === loadSeq.current && jid === journeyIdRef.current;');
    expect(ws).toContain('if (!current()) return;');
    expect(ws).toContain("const ready = !!detail && String(detail.journey?.id || '') === String(journeyId || '');");
    expect(ws).toContain('if (!journeyId || !ready || dirtyCount === 0 || saving) return;');
  });
  it('B2 칸 빼기 · 넣기 = 성공하면 바로 대기 목록에서 지운다(결과 모름 판정은 2R 에서 내용 지문으로 · journey-v3-codex-r2)', () => {
    expect(ws).toContain('setDeleteIds((m) => { const n = new Set(m); n.delete(id); return n; });');
    expect(ws).toContain('if (r?.ok) { dropNew(n.tempId); continue; }');
    expect(ws).not.toContain("toast.error(r.data?.error || '칸을 넣지 못했어요.'); await afterSaved(");
  });
  it('B4 실패 뒤 다시 읽기는 sync(서버 기준만 · 안 보낸 고친 값 유지)', () => {
    expect(ws).toContain("if (mode === 'open') { setInitialForm(f); setForm(f); }");
    expect(ws).toContain("await load(jid, false, 'sync');");
    expect(ws).toContain("await load(journeyId, false, 'sync');");
  });
  it('B5 저장하는 동안 화면을 막는다', () => {
    expect(ws).toContain('const blocking = reshaping || saving || detaching;');   // 1020 V.3 18: detach also locks
  });
  it('B6 고친 값은 최신 값 위에 · AI 응답은 요청 때 본문 그대로일 때만', () => {
    expect(ws).toContain('const base = d[id] || originalOf(id);');
    expect(ws).toContain("if (bodyNow(id) !== sentBody) { toast.warning('AI가 다듬는 동안 문안을 고쳐서 넣지 않았어요. 다시 눌러 주세요.'); return; }");
  });
  it('B7 칸마다 새 알림 토글 · A/B 편집기', () => {
    expect(ws).toContain('key={`n:${selRaw.id}:${String(selRaw.notify_manager_on_pretest)}`}');
    expect(ws).toContain('key={`v:${selRaw.id}`}');
  });
  it('B3 켜기 확인 창 = 작업 화면(z-60) · 다시 켜기 창(z-80) 위(z-90) · 키 처리는 공용 껍데기(2R · 화면 맨 위 창만)', () => {
    const m = FE('components/journey/JourneyActivationConfirmModal.tsx');
    expect(m).toContain('zIndexClassName="z-[90]"');
    expect(m).toContain('<JourneyModalShell open onClose={onClose}');
  });
  it('B8 받는 모습 = 입력이 바뀌면 지난 응답 · 진행 중 요청 무효 · 빈 문안 · 실패에 지난 결과 없음', () => {
    const p = FE('components/journey/PhoneComposer.tsx');
    expect(p).toContain('useEffect(() => { reqSeq.current++; setServer(null); setServerErr(null); setServerBusy(false); }, [resetKey, body, subject, channel, isAd, journeyId]);');
    const open = p.slice(p.indexOf('const openSee = async () => {'), p.indexOf('const openSee = async () => {') + 400);
    expect(open.indexOf('setServer(null);')).toBeLessThan(open.indexOf("if (!journeyId || !(body || '').trim())"));
  });
});
