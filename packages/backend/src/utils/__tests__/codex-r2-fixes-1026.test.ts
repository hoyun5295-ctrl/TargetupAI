/**
 * ★ 2026-10-26 Codex 적대 2라운드 지적의 잠금 — 첫 발행 잠금 · 다듬기 저장 판 · 거두기 실패 = 던짐 · 플래너 검사 멈춤 표시 · AI 칸 글.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { aiStr } from '../ai-json';

const BE = resolve(__dirname, '../..');
const code = (rel: string) => readFileSync(resolve(BE, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('첫 발행 = DM 단위 잠금 안에서 판정 → 발행 → 정산', () => {
  it('발행 문 · 보내기 두 입구가 같은 잠금 · 보내기는 잠금 안에서 판정을 다시 본다', () => {
    const core = code('utils/dm/dm-publish-core.ts');
    const iLock = core.indexOf('return withDmPublishLock(dmId, async () => {');
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(core.indexOf('const due = await publishFeeDueStrict(companyId, dmId);'));
    expect(iLock).toBeLessThan(core.indexOf('await publishDmWithPrizes('));
    const dm = code('routes/dm.ts');
    const send = dm.slice(dm.indexOf("dmRouter.post('/:id/send-to-target'"));
    const sLock = send.indexOf('const pubOut = await withDmPublishLock(req.params.id, async () => {');
    expect(sLock).toBeGreaterThan(-1);
    // ★ 1026 Codex 3R — 잠금 안 = 엄격 판정(조회 실패 = 503 · 면제와 실패를 섞지 않는다)
    const gateNow = send.indexOf('try { gateNow = await publishFeeDueStrict(companyId, req.params.id); } catch { return { unknown: true as const }; }');
    expect(gateNow).toBeGreaterThan(sLock);
    expect(gateNow).toBeLessThan(send.indexOf('const pub = await publishDmWithPrizes(req.params.id, companyId);'));
    expect(send).toContain("code: 'PUBLISH_STATE_CHANGED'");
    expect(send).toContain("code: 'PUBLISH_STATE_UNKNOWN'");
    expect(code('utils/keyed-lock.ts')).toContain("return withKeyedLock('dm-publish', uuidLockKey(dmId), fn);");
  });
});

describe('DM 다듬기 = 저장 · 되돌리기 모두 저장 판 조건', () => {
  it('읽은 판으로 저장 · 그 저장이 만든 판으로 되돌림 · 판 충돌 = 409', () => {
    const q = code('utils/dm/dm-quick-action.ts');
    expect(q).toContain('{ baseVersion: (cur as any).save_version || undefined }');
    expect(q).toContain('await updateDm(campaignId, companyId, prev as any, { baseVersion: savedVersion });');
    expect(q).toContain("throw new UserFacingError(409, 'DM_CHANGED',");
  });
});

describe('거두기 실패 = 던진다(경보가 닿게)', () => {
  it('임시 그림 지우기 = 없는 파일만 넘어간다 · 헤드라인 거두기 = 기다리고 던진다', () => {
    const st = code('utils/image-studio.ts');
    expect(st).toContain("catch (e: any) { if (e?.code !== 'ENOENT') throw e; }");
    expect(st).not.toMatch(/fs\.unlinkSync\(f\.absPath\); \} catch \{/);
    const r = code('routes/image-studio.ts');
    expect(r).toContain('undo: dropStrict,');
    const at = r.indexOf('const dropStrict = async () => {');
    expect(at).toBeGreaterThan(-1);
    const d = r.slice(at, r.indexOf('};', at));
    expect(d).toContain('const r = await deleteAsset(companyId, assetId);');
    // ★ 1026 Codex 3R — 파일을 못 지워도 소재 행은 거둔다(각각 시도 · 끝에 첫 오류)
    expect(d.indexOf('firstErr = e;')).toBeLessThan(d.indexOf('const r = await deleteAsset('));
    expect(d.trimEnd().endsWith('if (firstErr) throw firstErr;')).toBe(true);
  });
});

describe('플래너 고친 글 검사 멈춤 = 「검사 중」 이 아니다', () => {
  it('상한에 닿는 장애 = fail + 다시 저장 안내 · 그 전 = 대기 + 사유', () => {
    const p = code('utils/planner-copy.ts');
    expect(p).toContain("? { copy: { ...cur, spam: 'fail', checkedAt: at }, copy_error: { reason: EDITED_COPY_CHECK_STALLED, at } }");
    expect(p).toContain('failsNow + 1 >= PLANNER_COPY_RETRY_LIMIT');
    // ★ 1026 Codex 3R — 그 판정을 쓴 리비전일 때만(지난 리비전 실패 수로 새 문안을 멈추지 않는다)
    expect(p).toContain('{ eventRevision: { eventId, revision } }).catch(() => false);');
    expect(code('utils/planner-touchpoint.ts')).toContain("AND EXISTS (SELECT 1 FROM planner_events e WHERE e.id = $5::uuid AND e.company_id = $2::uuid AND COALESCE((e.meta->>'revision')::int, 0) = $6::int)");
  });
});

// ★ 1026 Codex 3R — 같은 뿌리 두 번째(글자 꼴만 막고 「걷는 판정이 최종 글을 보는가」를 안 봤다) → 정산 직전 판정 = 최종 결과
describe('정산 직전 판정 = 정규화가 끝난 최종 결과에 실제 내용', () => {
  it('여정 후보 = 빈 후보 거름 · 여정 만들기 = 본문 있는 문자 칸 · 자사몰 진단 · 인앱 생성 = 빈 결과면 502(0원)', () => {
    expect(code('utils/journey-ai-generator.ts')).toContain('.filter((c) => c.message.trim().length > 0)');
    expect(code('utils/journey-builder.ts')).toContain("accept: (r) => Array.isArray(r) && r.some((s: any) => s.stepType === 'message' && !!String(s.messageTemplate || '').trim()),");
    const before = (src: string, guard: string, settle: string) => {
      const g = src.indexOf(guard), s = src.indexOf(settle);
      expect(g, guard).toBeGreaterThan(-1);
      expect(s, settle).toBeGreaterThan(g);
    };
    const cdp = code('utils/cdp-fusion-explainer.ts');
    before(cdp, 'if (result.factors.length === 0 && !result.topInsight.trim() && result.recommendations.length === 0) {', "source: 'cdp-fusion-explainer', idempotencyKey");
    expect(cdp).not.toContain('.map(String)');
    // ★ 4R — 블록에만 글이 있는 정상 결과는 받는다(템플릿 거름 뒤 블록으로 합성한 제목 · 본문까지 본다)
    const ig = code('utils/inapp-ai-generator.ts');
    before(ig, 'const fromBlocks = composeFlatFromBlocks(message.content_blocks || []);', "source: 'inapp-ai-generator', idempotencyKey");
    expect(ig.indexOf('message.content_blocks = filterBlocksForTemplate(')).toBeLessThan(ig.indexOf('const fromBlocks = composeFlatFromBlocks('));
    before(ig, "!String(fromBlocks.title || '').trim() && !String(fromBlocks.body || '').trim()) {", "source: 'inapp-ai-generator', idempotencyKey");
  });
  it('AI JSON 을 읽는 파일에 .map(String) 0(배열 원소도 aiStr)', () => {
    const files = ['utils/cdp-fusion-explainer.ts', 'utils/inapp-explainer.ts', 'utils/performance-explainer.ts', 'utils/multi-goal-decisioning.ts', 'utils/inapp-ai-generator.ts', 'utils/journey-ai-generator.ts', 'utils/event-image-extract.ts', 'utils/alimtalk-ai-matcher.ts'];
    for (const f of files) expect(code(f), f).not.toContain('.map(String)');
  });
});

describe('aiStr — AI JSON 칸 = 글일 때만', () => {
  it('글 · 숫자 = 그대로 · 객체 · 배열 · 참거짓 · 없음 = fallback', () => {
    expect(aiStr('가을 세일')).toBe('가을 세일');
    expect(aiStr(30)).toBe('30');
    expect(aiStr({})).toBe('');
    expect(aiStr([], '기본')).toBe('기본');
    expect(aiStr(true)).toBe('');
    expect(aiStr(undefined, 'x')).toBe('x');
    expect(aiStr(NaN)).toBe('');
  });
});
