/**
 * ★ 2026-10-20 슈퍼관리자 표 칸 한 줄 잠금(Harold 「칸을 줄여 넣고 호버하면 전체 · 클릭하면 모달 · 승인은 모달에서」)
 *   규칙 소유 = frontend/src/components/admin/ui/admin-ui.tsx(ADMIN_TABLE_ONELINE · AdminLongText · AdminDetailModal).
 *   - 슈퍼관리자 표는 전부 한 줄 규칙을 쓰고, 넓어지면 표를 감싼 가로 스크롤 안에서만 민다(화면 가로 넘침 0)
 *   - 표 안에 승인 · 반려 · 거절 버튼 0(행 = 상세 창 · 처리는 창 안)
 *   - 긴 글 칸 = 정한 폭에서 말줄임 + 마우스 올리면 전문 + 누르면 전문 창 · 창은 배경 클릭으로 닫지 않는다
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => readFileSync(resolve(FRONT, rel), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
}
/** 관리자 폴더 밖이지만 슈퍼관리자 화면에서 열리는 표(발신프로필 · 에이전트 충전 · 정산표 · 080 청구 · 최소과금 · 수량 수정) */
const OUTSIDE = [
  'components/alimtalk/AlimtalkSendersSection.tsx', 'components/AgentChargePanel.tsx', 'components/SettlementOverviewModal.tsx',
  'components/Billing080Modal.tsx', 'components/MinimumChargeModal.tsx', 'components/QtyAdjustModal.tsx',
].map((rel) => resolve(FRONT, rel));
/** 슈퍼관리자 표 파일 = 관리자 폴더 전부 + 본체 + 밖에서 열리는 표 */
const ADMIN_FILES = [...walk(resolve(FRONT, 'components/admin')), resolve(FRONT, 'pages/AdminDashboard.tsx'), ...OUTSIDE]
  .map((p) => relative(FRONT, p).replace(/\\/g, '/'))
  .filter((rel) => rel !== 'components/admin/ui/admin-ui.tsx' && read(rel).includes('<table'));

/** 파일 안 표 하나씩 = 여는 줄 번호 · 여는 태그 · 표 본문(</table> 까지) */
function tables(src: string) {
  const lines = src.split('\n');
  const out: { line: number; open: string; body: string; before: string }[] = [];
  lines.forEach((l, i) => {
    if (!l.includes('<table')) return;
    const rest = lines.slice(i).join('\n');
    const end = rest.indexOf('</table>');
    out.push({
      line: i + 1,
      open: l.slice(l.indexOf('<table')),
      body: end >= 0 ? rest.slice(0, end) : rest,
      before: lines.slice(Math.max(0, i - 8), i).join('\n'),
    });
  });
  return out;
}

describe('슈퍼관리자 표 칸 한 줄(★1020)', () => {
  it('표 파일 목록이 비지 않는다(경로가 바뀌면 시험이 빈 채로 통과하지 않게)', () => {
    expect(ADMIN_FILES.length).toBeGreaterThanOrEqual(38);
    expect(ADMIN_FILES).toContain('components/admin/tabs/CallbacksTab.tsx');
    expect(ADMIN_FILES).toContain('components/alimtalk/AlimtalkSendersSection.tsx');
  });

  it('공용 규칙 = 머리 · 칸 한 줄 · ADMIN_TABLE 도 같은 규칙을 품는다', () => {
    const ui = read('components/admin/ui/admin-ui.tsx');
    expect(ui).toContain("export const ADMIN_TABLE_ONELINE = '[&_th]:whitespace-nowrap [&_td]:whitespace-nowrap';");
    expect(ui).toMatch(/export const ADMIN_TABLE = `[^`]*\$\{ADMIN_TABLE_ONELINE\}`;/);
  });

  it('모든 표가 한 줄 규칙을 쓴다', () => {
    const missing: string[] = [];
    for (const rel of ADMIN_FILES) {
      for (const t of tables(read(rel))) {
        if (!/ADMIN_TABLE_ONELINE|className=\{ADMIN_TABLE\}/.test(t.open)) missing.push(`${rel}:${t.line}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('모든 표가 가로 스크롤 상자 안에 있다(넓어져도 화면이 아니라 표 안에서만 민다 · overflow-hidden 은 자른다)', () => {
    const bad: string[] = [];
    for (const rel of ADMIN_FILES) {
      for (const t of tables(read(rel))) {
        if (!/overflow-x-auto|overflow-auto/.test(t.before)) bad.push(`${rel}:${t.line}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('표 안에 승인 · 반려 · 거절 버튼 0(행을 누르면 상세 창 · 처리는 창 안)', () => {
    const bad: string[] = [];
    // 버튼 속성 안 화살표(=>)의 「>」를 태그 끝으로 읽지 않게 — 닫는 </button> 을 넘지 않는 가장 짧은 범위에서 글자를 찾는다
    const BTN = /<button\b(?:(?!<\/button>)[\s\S])*?>\s*(승인|반려|거절)\s*<\/button>/g;
    for (const rel of ADMIN_FILES) {
      for (const t of tables(read(rel))) {
        if (BTN.test(t.body.replace(/\n\s*/g, ' '))) bad.push(`${rel}:${t.line}`);
        BTN.lastIndex = 0;
      }
    }
    expect(bad).toEqual([]);
  });

  it('행 상세 창 = 등록현황 관리 · 요금제 신청 · 템플릿 검수 · 발신프로필에서 처리(같은 처리 함수)', () => {
    const as = read('components/alimtalk/AlimtalkSendersSection.tsx');
    expect(as).toContain('{...adminRowOpen(() => setDetail(s))}');
    expect(as).toContain('setDetail(null); approveSender(s);');
    expect(as).toContain('setDetail(null); setRejectTarget(s); setRejectReason(\'\');');
    const cb = read('components/admin/tabs/CallbacksTab.tsx');
    expect(cb).toContain('adminRowOpen(() => openMgrDetail(mgr))');
    expect(cb).toContain('<AdminDetailModal');
    expect(cb).toContain('runMgrAction(() => handleApproveManager(mgrDetail.id))');
    expect(cb).toContain('runMgrAction(() => handleRejectManager(mgrDetail.id, mgrRejectReason))');
    const pr = read('components/admin/tabs/PlanRequestsTab.tsx');
    expect(pr).toContain('adminRowOpen(() => setDetail(req))');
    expect(pr).toContain('handleApproveRequest(id)');
    const tm = read('components/admin/modals/TemplateDetailModal.tsx');
    expect(tm).toContain('/api/admin/kakao-templates/${id}/approve');
    // RCS 는 0817 결정대로 승인 · 반려 없음(검수 주체 = RCS Biz Center) — 알림톡 목록에서 연 검수중만
    expect(tm).toContain("const reviewable = templateSubTab === 'alimtalk' && getAlimtalkTemplateStatus(templateDetail.status).label === '검수중';");
    expect(read('components/admin/tabs/TemplatesTab.tsx')).not.toContain('/approve');
  });

  it('긴 글 칸 = 말줄임 + 전문(title) + 누르면 전문 창 · 창은 포털 · 배경 클릭으로 닫지 않는다', () => {
    const ui = read('components/admin/ui/admin-ui.tsx');
    const long = ui.slice(ui.indexOf('export function AdminLongText'), ui.indexOf('function AdminModalShell'));
    expect(long).toContain('block truncate');
    expect(long).toContain('title={t}');
    expect(long).toContain('style={{ maxWidth: max }}');
    expect(long).toContain('e.stopPropagation(); setOpen(true);');
    const shell = ui.slice(ui.indexOf('function AdminModalShell'), ui.indexOf('export function AdminTextModal'));
    expect(shell).toContain('createPortal(');
    expect(shell).toContain('onClick={(e) => e.stopPropagation()}');
    expect(shell).not.toMatch(/onClick=\{onClose\}[^>]*fixed inset-0|fixed inset-0[^>]*onClick=\{onClose\}/);
    // 행 상세 창은 본체 알림 · 확인 창(z-[60]) 아래 — 처리 실패 알림이 상세 창 뒤에 깔리면 안 된다
    expect(read('pages/AdminDashboard.tsx')).toMatch(/modal\.type === 'alert' && \(\s*<div className="fixed inset-0[^"]*z-\[60\]"/);
    const detail = ui.slice(ui.indexOf('export function AdminDetailModal'), ui.indexOf('export function AdminDetailItem'));
    expect(detail).toContain('z="z-[55]"');
  });
});
