import { Router, Request, Response } from 'express';
import { logPrivacyExport } from '../utils/privacy-audit';
import * as XLSX from 'xlsx';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
// ★ 2026-09-27 한줄로 V2 R061 — 주소록 그룹 = (주인, 이름) · 주인 판정 CT
import { resolveTargetOwner, ownerClause } from '../utils/owner-scope';
import { cellToString } from '../utils/normalize';
import { insertAddressBookContacts, type AddressBookRow } from '../utils/address-book-insert';
// ★ 2026-09-14 박성용 접수(주소록 번호 앞 0 생략): 업로드 파서가 CSV·엑셀의 앞 0을 숫자로 떨어뜨린다.
//   저장·추가·조회·다운로드 네 곳이 같은 복원 규칙(휴대폰 10자리만 0 붙임)을 쓴다. 옛 저장분은 DB를 고치지 않고 읽을 때 붙인다.
import { normalizeAgencyPhone as normalizeBookPhone } from '../utils/normalize-phone';

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
    // ★ 2026-09-27 한줄로 V2 R061 — 그룹 = (주인, 이름). 이름은 사용자마다 따로 만들어지므로(생성 중복 검사도 사용자 단위)
    //   주인까지 묶어 돌려준다. 옛: 이름만으로 묶어 관리자 화면에서 다른 사용자의 같은 이름 그룹이 한 줄로 합쳐졌고,
    //   그 줄의 조회·추가·삭제가 여러 사람의 그룹에 한꺼번에 닿았다. owner_name = 관리자 화면 구분 표시용(담당자는 늘 본인이라 비움).
    const userType = req.user?.userType;
    const isUserScoped = userType === 'company_user' && !!userId;
    const userFilter = isUserScoped ? ' AND a.user_id = $2' : '';
    const params = isUserScoped ? [companyId, userId] : [companyId];

    const result = await query(
      `SELECT a.group_name, a.user_id AS owner_id, ${isUserScoped ? 'NULL' : 'MAX(u.name)'} AS owner_name,
              COUNT(*) as count, MAX(a.created_at) as created_at
       FROM address_books a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.company_id = $1${userFilter}
       GROUP BY a.group_name, a.user_id
       ORDER BY MAX(a.created_at) DESC`,
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

    // ★ 2026-09-27 한줄로 V2 R061 — 한 그룹 = (주인, 이름) · 담당자 = 본인 · 관리자 = 화면이 보낸 주인(owner)
    const params: any[] = [companyId, groupName];
    const userFilter = ownerClause(resolveTargetOwner(req, req.query.owner), params);

    // ★ 2026-09-28 한줄로 V2 R060 — 미리보기(조회) = 서버 검색 + 상위 N건 + 전체 건수(limit 이 있을 때).
    //   옛: 조회도 그룹 전체(최대 10만)를 받아 화면이 10건만 보여 줬다. 불러오기(발송 목록 채우기)는 전부 필요해 limit 없이 그대로다.
    const previewLimit = req.query.limit !== undefined ? Math.min(Math.max(parseInt(String(req.query.limit), 10) || 10, 1), 100) : null;
    if (previewLimit !== null) {
      const q = String(req.query.q || '').trim().slice(0, 50);
      let searchSql = '';
      if (q) {
        const digits = q.replace(/\D/g, '');
        params.push(`%${q}%`);
        const textIdx = params.length;
        const conds = [`name ILIKE $${textIdx}`, `extra1 ILIKE $${textIdx}`, `extra2 ILIKE $${textIdx}`, `extra3 ILIKE $${textIdx}`];
        if (digits) {
          params.push(`%${digits}%`);
          conds.push(`regexp_replace(phone, '\\D', '', 'g') LIKE $${params.length}`);
        }
        searchSql = ` AND (${conds.join(' OR ')})`;
      }
      params.push(previewLimit);
      const preview = await query(
        `SELECT id, phone, name, extra1, extra2, extra3, COUNT(*) OVER() AS total_count_all
         FROM address_books
         WHERE company_id = $1 AND group_name = $2${userFilter}${searchSql}
         ORDER BY created_at
         LIMIT $${params.length}`,
        params
      );
      const total = preview.rows.length > 0 ? Number(preview.rows[0].total_count_all) : 0;
      const contacts = preview.rows.map(({ total_count_all: _t, ...r }: any) => ({ ...r, phone: normalizeBookPhone(r.phone) }));
      return res.json({ success: true, contacts, total });
    }

    const result = await query(
      `SELECT id, phone, name, extra1, extra2, extra3
       FROM address_books
       WHERE company_id = $1 AND group_name = $2${userFilter}
       ORDER BY created_at`,
      params
    );

    const contacts = result.rows.map((r: any) => ({ ...r, phone: normalizeBookPhone(r.phone) }));
    return res.json({ success: true, contacts });
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

    // ★ 2026-09-26 한줄로 V2 R1-01 — 행을 먼저 모으고 적재 CT 한 문장으로(전부 저장 또는 전부 안 함 · 옛: 연락처마다 INSERT = 일부 저장)
    const rows: AddressBookRow[] = [];
    for (const contact of contacts) {
      const phone = normalizeBookPhone(contact.phone);
      if (phone.length >= 10) {
        // ★ D150-3 (2026-05-09) PDF #5: cellToString 컨트롤타워(normalize.ts) 사용 — 인라인 safeStr 폐기
        rows.push({ phone, name: cellToString(contact.name), extra1: cellToString(contact.extra1), extra2: cellToString(contact.extra2), extra3: cellToString(contact.extra3) });
      }
    }
    const insertCount = await insertAddressBookContacts({ companyId, userId, groupName, rows });

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
    // ★ 2026-09-27 한줄로 V2 R061 — 한 그룹 = (주인, 이름)
    const params: any[] = [companyId, groupName];
    const userFilter = ownerClause(resolveTargetOwner(req, req.query.owner), params);

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
      '번호': normalizeBookPhone(r.phone),
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
    // ★ 2026-08-18 전송자격인증 4.2 — 연락처가 나가는 경로다
    await logPrivacyExport({ req, kind: 'address_book', count: rows.length, targetId: groupName });

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
    // ★ 2026-09-27 한줄로 V2 R061 — 한 그룹 = (주인, 이름). 추가 행도 **그 그룹 주인** 이름으로 적재한다
    //   (옛: 관리자가 남의 그룹에 추가하면 관리자 id로 적재돼 같은 이름의 새 그룹이 갈라져 생겼다).
    const ownerId = resolveTargetOwner(req, req.query.owner);
    const ownerParams: any[] = [companyId, groupName];
    const ownerFilter = ownerClause(ownerId, ownerParams);

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
      existingRes.rows.map((r: any) => normalizeBookPhone(r.phone)),
    );

    let duplicateCount = 0;
    let invalidCount = 0;
    const rows: AddressBookRow[] = [];

    for (const contact of contacts) {
      const phone = normalizeBookPhone(contact.phone);
      if (phone.length < 10) {
        invalidCount++;
        continue;
      }
      if (existingPhones.has(phone)) {
        duplicateCount++;
        continue;
      }
      existingPhones.add(phone); // 본 batch 안 중복 차단
      rows.push({
        phone,
        name: cellToString(contact.name),
        extra1: cellToString(contact.extra1),
        extra2: cellToString(contact.extra2),
        extra3: cellToString(contact.extra3),
      });
    }
    // ★ 2026-09-26 한줄로 V2 R1-01 — 적재 CT 한 문장(전부 추가 또는 전부 안 함)
    const appendedCount = await insertAddressBookContacts({ companyId, userId: ownerId, groupName, rows });

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
    // ★ 2026-09-27 한줄로 V2 R061 — 한 그룹 = (주인, 이름). 옛: 관리자 삭제가 이름만으로 여러 사람의 같은 이름 그룹을 함께 지웠다.
    const params: any[] = [companyId, groupName];
    const userFilter = ownerClause(resolveTargetOwner(req, req.query.owner), params);

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
