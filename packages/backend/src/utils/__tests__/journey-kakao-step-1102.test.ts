/**
 * 알림톡 칸 판정 CT(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-14 · 3-0 CT-J5) — 결정 표 · 배선.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const q = vi.fn();
const imc = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => q(...a) }));
vi.mock('../kakao-template-guard', () => ({
  getImcTemplateStatusSafe: (...a: any[]) => imc(...a),
  decideKakaoTemplateSendable: (s: string | null) => (s === 'R' ? { sendable: false, reason: '카카오 활성 대기' } : { sendable: true }),
}));
import { kakaoStepVerdict } from '../journey-kakao-step';

const tpl = (over: Record<string, any> = {}) => ({ id: 't1', template_code: 'C1', content: '#{이름}님 주문 #{주문번호}', buttons: [], status: 'APPROVED', ...over });
const step = (over: Record<string, any> = {}) => ({ step_order: 2, alimtalk_template_code: 'C1', alimtalk_variable_map: { '#{이름}': '@@name@@', '#{주문번호}': '@@order_no@@' }, ...over });

describe('kakaoStepVerdict 결정 표', () => {
  beforeEach(() => { q.mockReset(); imc.mockReset(); imc.mockResolvedValue('A'); });
  it('코드 없음 = 막음(조회 0)', async () => {
    const v = await kakaoStepVerdict('c', step({ alimtalk_template_code: '' }));
    expect(v.block?.reason).toBe('alimtalk_template_code_empty');
    expect(q).not.toHaveBeenCalled();
  });
  it('회사 템플릿 없음 = 막음(조회 = 회사 격리)', async () => {
    q.mockResolvedValue({ rows: [] });
    const v = await kakaoStepVerdict('c', step());
    expect(v.block?.reason).toBe('alimtalk_template_not_found');
    expect(q.mock.calls[0][0]).toContain('t.company_id = $2::uuid');
    expect(q.mock.calls[0][1]).toEqual(['C1', 'c']);
  });
  it('미승인 = 막음', async () => {
    q.mockResolvedValue({ rows: [tpl({ status: 'REQUESTED' })] });
    expect((await kakaoStepVerdict('c', step())).block?.reason).toBe('alimtalk_template_not_approved');
  });
  it('카카오 활성 대기 = 막음', async () => {
    q.mockResolvedValue({ rows: [tpl()] });
    imc.mockResolvedValue('R');
    expect((await kakaoStepVerdict('c', step())).block?.reason).toBe('alimtalk_template_inactive');
  });
  it('변수 연결 = 실제로 보내는 템플릿 본문 기준(칸 글이 아님 · D21)', async () => {
    q.mockResolvedValue({ rows: [tpl()] });
    const v = await kakaoStepVerdict('c', step({ alimtalk_variable_map: { '#{이름}': '@@name@@' } }));
    expect(v.block?.reason).toBe('alimtalk_variable_unmapped');
    expect(v.block?.userText).toContain('#{주문번호}');
    expect(v.row?.id).toBe('t1');
  });
  it('다 갖춤 = 통과 · 행을 준다', async () => {
    q.mockResolvedValue({ rows: [tpl()] });
    const v = await kakaoStepVerdict('c', step());
    expect(v.block).toBeNull();
    expect(v.row?.template_code).toBe('C1');
  });
});

describe('CT-J5 배선 — 알림톡 칸 판정은 journey-kakao-step 밖 0(켜기 · 켜기 검증 · 실행기가 같은 함수)', () => {
  const ROOT = join(__dirname, '..', '..');
  const files: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue; }
      if (!/\.ts$/.test(name) || /\.(test|pg|verify)\.ts$/.test(name)) continue;
      files.push({ rel: relative(ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n') });
    }
  };
  walk(ROOT);
  const JOURNEY = (rel: string) => /^utils\/journey-/.test(rel);
  it('여정 파일에서 템플릿 표 조회 · 카카오 활성 판정 · 변수 연결 판정 = CT 밖 0', () => {
    const bad = files.filter((f) => JOURNEY(f.rel) && f.rel !== 'utils/journey-kakao-step.ts'
      && /FROM\s+kakao_templates|decideKakaoTemplateSendable\(|getImcTemplateStatusSafe\(|findUnfilledAlimtalkVars\(|#\\\{\(\[\^\}\]\+\)\\\}/.test(f.text)).map((f) => f.rel);
    expect(bad).toEqual([]);
  });
  it('켜기(activationBlockReason) · 켜기 검증 · 실행기 = kakaoStepVerdict 를 부른다', () => {
    const get = (rel: string) => files.find((f) => f.rel === rel)!.text;
    const b = get('utils/journey-builder.ts');
    const gate = b.slice(b.indexOf('async function activationBlockCore('), b.indexOf('\n}\n', b.indexOf('async function activationBlockCore(')));   // ★ C104 G1 관문 본체
    expect(gate).toContain('await kakaoStepVerdict(companyId,');
    expect(get('utils/journey-pretest-validator.ts')).toContain('await kakaoStepVerdict(companyId, step)');
    expect(get('utils/journey-executor.ts')).toContain('await kakaoStepVerdict(head.company_id, step)');
  });
});
