import { Router, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { cellToString } from '../utils/normalize';

const router = Router();

router.use(authenticate);

// GET /api/address-books/groups - 그룹 목록 조회 (사용자별 격리)
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // ★ 사용자별 격리: company_admin은 회사 전체, company_user는 본인 것만
    const userType = req.user?.userType;
    const userFilter = userType === 'company_user' && userId ? ' AND user_id = $2' : '';
    const params = userType === 'company_user' && userId ? [companyId, userId] : [companyId];

    const result = await query(
      `SELECT group_name, COUNT(*) as count, MAX(created_at) as created_at
       FROM address_books
       WHERE company_id = $1${userFilter}
       GROUP BY group_name
       ORDER BY MAX(created_at) DESC`,
      params
    );

    return res.json({ success: true, groups: result.rows });
  } catch (error) {
    console.error('주소록 그룹 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/address-books/:groupName - 그룹 연락처 조회
router.get('/:groupName', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName } = req.params;

    const userType = req.user?.userType;
    const userFilter = userType === 'company_user' && userId ? ' AND user_id = $3' : '';
    const params = userType === 'company_user' && userId ? [companyId, groupName, userId] : [companyId, groupName];

    const result = await query(
      `SELECT id, phone, name, extra1, extra2, extra3
       FROM address_books
       WHERE company_id = $1 AND group_name = $2${userFilter}
       ORDER BY created_at`,
      params
    );

    return res.json({ success: true, contacts: result.rows });
  } catch (error) {
    console.error('주소록 연락처 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/address-books - 주소록 저장 (user_id 포함)
// ★ 2026-06-08: 주소록 전체 10만건 cap (전 요금제 공통 — 요금제의 '관리 가능 DB'=고객 DB 업로드와는 별개 기능).
//   null=통과, 문자열=차단 사유. 회사 단위 address_books 누적 기준.
const ADDRESS_BOOK_LIMIT = 100000;
async function checkAddressBookLimit(companyId: string, addCount: number): Promise<string | null> {
  const cntRes = await query(`SELECT COUNT(*)::int AS cnt FROM address_books WHERE company_id = $1`, [companyId]);
  const current = Number(cntRes.rows[0]?.cnt) || 0;
  if (current + addCount > ADDRESS_BOOK_LIMIT) {
    return `주소록은 최대 ${ADDRESS_BOOK_LIMIT.toLocaleString()}건까지만 등록할 수 있습니다. (현재 ${current.toLocaleString()}건)`;
  }
  return null;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName, contacts } = req.body;

    if (!groupName || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: '그룹명과 연락처가 필요합니다.' });
    }

    // 기존 그룹명 중복 체크 (같은 사용자 내에서만)
    const existCheck = await query(
      `SELECT COUNT(*) FROM address_books WHERE company_id = $1 AND group_name = $2 AND user_id = $3`,
      [companyId, groupName, userId]
    );
    if (parseInt(existCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: '이미 존재하는 그룹명입니다.' });
    }

    const limitErr = await checkAddressBookLimit(companyId, contacts.length);
    if (limitErr) return res.status(403).json({ error: limitErr, code: 'ADDRESS_BOOK_LIMIT' });

    let insertCount = 0;
    for (const contact of contacts) {
      const phone = String(contact.phone || '').replace(/\D/g, '');
      if (phone.length >= 10) {
        // ★ D150-3 (2026-05-09) PDF #5: cellToString 컨트롤타워(normalize.ts) 사용 — 인라인 safeStr 폐기
        await query(
          `INSERT INTO address_books (company_id, user_id, group_name, phone, name, extra1, extra2, extra3)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [companyId, userId, groupName, phone, cellToString(contact.name), cellToString(contact.extra1), cellToString(contact.extra2), cellToString(contact.extra3)]
        );
        insertCount++;
      }
    }

    return res.json({ success: true, message: `${insertCount}건 저장 완료`, insertCount });
  } catch (error) {
    console.error('주소록 저장 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ============================================================
// ★ D219+ Part 2 (2026-05-27) — 박과장님 신고 영역 정정
//   1. GET /:groupName/export — xlsx 다운로드
//   2. POST /:groupName/append — 기존 그룹에 contacts 추가 (중복 phone skip)
// ============================================================

// GET /api/address-books/:groupName/export - 그룹 contacts xlsx 다운로드
router.get('/:groupName/export', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName } = req.params;
    const userType = req.user?.userType;
    const userFilter = userType === 'company_user' && userId ? ' AND user_id = $3' : '';
    const params = userType === 'company_user' && userId ? [companyId, groupName, userId] : [companyId, groupName];

    const result = await query(
      `SELECT phone, name, extra1, extra2, extra3
       FROM address_books
       WHERE company_id = $1 AND group_name = $2${userFilter}
       ORDER BY created_at`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '주소록을 찾을 수 없거나 내용이 없습니다.' });
    }

    // xlsx 변환 — 컬럼 라벨 한국어 명시
    const rows = result.rows.map((r: any) => ({
      '번호': r.phone || '',
      '이름': r.name || '',
      '기타1': r.extra1 || '',
      '기타2': r.extra2 || '',
      '기타3': r.extra3 || '',
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    // 컬럼 너비 정합 (가독성)
    (worksheet as any)['!cols'] = [
      { wch: 14 }, // 번호
      { wch: 12 }, // 이름
      { wch: 16 }, // 기타1
      { wch: 16 }, // 기타2
      { wch: 16 }, // 기타3
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, '주소록');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `${groupName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return res.send(buffer);
  } catch (error) {
    console.error('주소록 다운로드 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/address-books/:groupName/append - 기존 그룹에 contacts 추가 (중복 phone skip)
router.post('/:groupName/append', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName } = req.params;
    const { contacts } = req.body as { contacts: Array<{ phone: string; name?: string; extra1?: string; extra2?: string; extra3?: string }> };

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: '추가할 연락처가 필요합니다.' });
    }

    const limitErrA = await checkAddressBookLimit(companyId, contacts.length);
    if (limitErrA) return res.status(403).json({ error: limitErrA, code: 'ADDRESS_BOOK_LIMIT' });

    // 기존 그룹 존재 검증 (본인 그룹만 추가 가능 — company_user 격리)
    const userType = req.user?.userType;
    const ownerFilter = userType === 'company_user' && userId ? ' AND user_id = $3' : '';
    const ownerParams = userType === 'company_user' && userId ? [companyId, groupName, userId] : [companyId, groupName];

    const groupCheck = await query(
      `SELECT COUNT(*)::int AS cnt FROM address_books
        WHERE company_id = $1 AND group_name = $2${ownerFilter}`,
      ownerParams,
    );
    if (groupCheck.rows[0].cnt === 0) {
      return res.status(404).json({ error: '존재하지 않는 그룹입니다.' });
    }

    // 기존 phone 매트릭스 — 중복 차단 (본 그룹 안)
    const existingRes = await query(
      `SELECT phone FROM address_books
        WHERE company_id = $1 AND group_name = $2${ownerFilter}`,
      ownerParams,
    );
    const existingPhones = new Set<string>(
      existingRes.rows.map((r: any) => String(r.phone || '')),
    );

    let appendedCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;

    for (const contact of contacts) {
      const phone = String(contact.phone || '').replace(/\D/g, '');
      if (phone.length < 10) {
        invalidCount++;
        continue;
      }
      if (existingPhones.has(phone)) {
        duplicateCount++;
        continue;
      }
      existingPhones.add(phone); // 본 batch 안 중복 차단
      await query(
        `INSERT INTO address_books (company_id, user_id, group_name, phone, name, extra1, extra2, extra3)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          companyId,
          userId,
          groupName,
          phone,
          cellToString(contact.name),
          cellToString(contact.extra1),
          cellToString(contact.extra2),
          cellToString(contact.extra3),
        ],
      );
      appendedCount++;
    }

    return res.json({
      success: true,
      message: `${appendedCount}건 추가 완료 (중복 ${duplicateCount}건 / 무효 ${invalidCount}건 제외)`,
      appendedCount,
      duplicateCount,
      invalidCount,
    });
  } catch (error) {
    console.error('주소록 추가 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// DELETE /api/address-books/:groupName - 그룹 삭제
router.delete('/:groupName', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName } = req.params;

    // ★ 본인 주소록만 삭제 가능 (admin은 전체 삭제 가능)
    const userType = req.user?.userType;
    const userFilter = userType === 'company_user' && userId ? ' AND user_id = $3' : '';
    const params = userType === 'company_user' && userId ? [companyId, groupName, userId] : [companyId, groupName];

    await query(
      `DELETE FROM address_books WHERE company_id = $1 AND group_name = $2${userFilter}`,
      params
    );

    return res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('주소록 삭제 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
