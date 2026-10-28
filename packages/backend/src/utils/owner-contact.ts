/**
 * 주인 있는 기능의 담당자 통지 연락처 CT (★ 2026-10-28 B-1028-1 · 뿌리 대장 R1 · R3)
 *
 * **누가 받는가**를 이 함수 하나가 정한다 = ① 만든 계정(users.phone) ② 회사 대표 관리자(DB 원시값 user_type='admin') · 활성 · 비시스템 · 번호가 유효한 첫 행.
 * 쓰는 곳 = 자동마케팅 통지(`notifyOperatorAdmins` 번호 없는 통지) · 플래너 재확인 링크(받은 계정 = 링크 권한의 주인) · 여정 발송 2시간 전 안내 · 여정 발송 결과 안내.
 *   옛: 여정 두 안내는 회사 알림톡 검수 수신자 명단(kakao_alarm_users) 첫 행으로 보내 여정을 만든 담당자 대신 그 명단의 사람이 받았다(B-1028-1).
 *   따로 조회하면 정렬 · 거름이 달라 문자를 받은 계정과 기록한 계정이 갈린다(회의론자 B8). 조회 실패는 던진다(호출부가 접는다).
 * (옛 이름 = continuous-operator.ts `pickOperatorFallbackContact` · 본문 그대로 옮김)
 */
import { query } from '../config/database';

export async function pickOwnerContact(companyId: string, createdBy: string | null): Promise<{ userId: string; phone: string } | null> {
  const fb = await query(
    // ★ 2026-10-28 Codex 1R — 회사 조건은 두 후보 공통(옛: 관리자에게만 · 다른 회사 계정이 만든 계정 칸에 있으면 그 사람에게 갔다 · 테넌트 격리)
    `SELECT id, phone FROM users
      WHERE company_id = $2::uuid
        AND (($1::uuid IS NOT NULL AND id = $1::uuid) OR user_type = 'admin')
        AND is_active = true AND COALESCE(is_system, false) = false
      ORDER BY (id = $1::uuid) DESC, id ASC`,
    [createdBy || null, companyId],
  );
  for (const r of fb.rows as any[]) {
    const phone = String(r.phone || '').replace(/\D/g, '');
    if (/^01\d{8,9}$/.test(phone)) return { userId: String(r.id), phone };
  }
  return null;
}
