/**
 * ★ CT: 알림톡 템플릿 조회 칸 목록 (2026-09-28 한줄로 V2 차수 4 R087)
 *
 * 목록·엑셀·상세가 `SELECT t.*` 로 검수 증빙 바이너리(inspection_evidence_data · 행당 최대 5MB)까지 읽고 JS에서 버렸다.
 * 칸을 코드에 손으로 적으면 새 칸이 생길 때마다 화면에서 조용히 빠진다 → **실제 표의 칸 전부에서 바이너리만 뺀 목록**을
 * information_schema 에서 한 번 읽어 쓴다(프로세스 캐시). 읽기에 실패하면 옛 방식(t.*)으로 돌아간다 — 응답 모양은 같다.
 */
import { query } from '../config/database';

const EXCLUDED = new Set(['inspection_evidence_data']);
let cached: string | null = null;

/** `t."id", t."company_id", …` (별칭 t 기준 · 증빙 바이너리 제외). 실패하면 't.*' */
export async function kakaoTemplateSelectColumns(): Promise<string> {
  if (cached) return cached;
  try {
    const r = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kakao_templates'
        ORDER BY ordinal_position`,
    );
    const cols = (r.rows as any[]).map((x) => String(x.column_name)).filter((c) => !EXCLUDED.has(c));
    if (cols.length === 0) return 't.*';
    cached = cols.map((c) => `t."${c.replace(/"/g, '""')}"`).join(', ');
    return cached;
  } catch {
    return 't.*';
  }
}

/** 응답에서 증빙 바이너리를 뺀다(폴백 t.* 일 때의 안전망) */
export function stripTemplateBinary<T extends Record<string, any>>(row: T): T {
  if (!row || !('inspection_evidence_data' in row)) return row;
  const { inspection_evidence_data: _bin, ...rest } = row as any;
  return rest as T;
}
