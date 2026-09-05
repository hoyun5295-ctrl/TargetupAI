/**
 * 대행발송 이메일 접수 · 허용 발신자 CT 계약 (★2026-08-27 §18-13 · 서수란 접수 cmtb5y3pv02qwjnotttqxen6a)
 *
 *   ① 발신 주소 정규화 = 주소만 추출 + lower. plus-tag 보존(접으면 위조 방향으로만 넓어진다)
 *   ② 청구 계정 지정 대조 = 표시명 또는 로그인 ID **정확 일치**(정규화 후)만.
 *      부분 일치·유사 일치 없음 — 돈 귀속에서 "비슷해서 골랐다"는 오귀속 사고다.
 *   ③ 일치 0 = not_found · 일치 2+ = ambiguous(자동 선택 없음 · 반려)
 *   ④ 회신 안내 목록 = "표시명 (로그인ID)" · 표시명 없으면 로그인 ID
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSenderEmail, normalizeBillingTargetKey, matchBillingTarget, describeBillingTargets,
  senderKeyClash, type SenderCandidate,
} from '../agency-send-email';

const cand = (over: Partial<SenderCandidate>): SenderCandidate => ({
  senderId: 's1', companyId: 'c1', userId: 'u1', label: null, loginId: 'login1', userName: null, ...over,
});

describe('허용 발신자 — 주소 정규화', () => {
  it('표시명 붙은 형태에서 주소만 추출하고 lower로 접는다. plus-tag는 보존한다', () => {
    expect(normalizeSenderEmail('"안지현" <JiHyun+ad@Company.co.kr>')).toBe('jihyun+ad@company.co.kr');
    expect(normalizeSenderEmail('  suran@invitocorp.com ')).toBe('suran@invitocorp.com');
    expect(normalizeSenderEmail('주소아님')).toBe('');
  });
});

describe('청구 계정 지정 대조(matchBillingTarget) — §18-13', () => {
  const KUMKANG = cand({ senderId: 'a', userId: 'u-kumkang', label: '금강', loginId: 'kumkang1' });
  const SHINHWAN = cand({ senderId: 'b', userId: 'u-shinhwan', label: '신환', loginId: 'shinhwan1' });
  const NO_LABEL = cand({ senderId: 'c', userId: 'u-plain', label: null, loginId: 'plain77' });

  it('표시명 정확 일치로 1개를 고른다(공백·대소문자는 접는다)', () => {
    const m = matchBillingTarget([KUMKANG, SHINHWAN], '금 강');
    expect(m.outcome).toBe('matched');
    if (m.outcome === 'matched') expect(m.candidate.userId).toBe('u-kumkang');
  });

  it('로그인 ID로도 고를 수 있다(표시명 없는 행의 유일한 지정 키)', () => {
    const m = matchBillingTarget([KUMKANG, NO_LABEL], 'PLAIN77');
    expect(m.outcome).toBe('matched');
    if (m.outcome === 'matched') expect(m.candidate.userId).toBe('u-plain');
  });

  it('일치 0 = not_found. 부분 일치는 일치가 아니다(돈 귀속 · 유사 매칭 금지)', () => {
    expect(matchBillingTarget([KUMKANG, SHINHWAN], '동국').outcome).toBe('not_found');
    expect(matchBillingTarget([KUMKANG, SHINHWAN], '금').outcome).toBe('not_found');
    expect(matchBillingTarget([KUMKANG, SHINHWAN], '').outcome).toBe('not_found');
  });

  it('일치 2+ = ambiguous(표시명이 겹치는 불량 데이터 · 자동 선택 없이 반려)', () => {
    const dup = cand({ senderId: 'd', userId: 'u-dup', label: '금강', loginId: 'other9' });
    expect(matchBillingTarget([KUMKANG, dup], '금강').outcome).toBe('ambiguous');
  });

  it('회신 안내 목록 = "표시명 (로그인ID)" · 표시명 없으면 로그인 ID', () => {
    expect(describeBillingTargets([KUMKANG, NO_LABEL])).toBe('금강 (kumkang1), plain77');
  });

  it('정규화 키 = 공백 제거 + lower(등록 라우트의 겹침 예방과 같은 한 벌)', () => {
    expect(normalizeBillingTargetKey(' Kum Kang1 ')).toBe(normalizeBillingTargetKey('kumkang1'));
    expect(normalizeBillingTargetKey(null)).toBe('');
  });
});

describe('활성 집합 지정 키 겹침(senderKeyClash) — 등록 POST·재활성 PATCH 공용 (★0827 Codex 1R)', () => {
  it('표시명끼리·로그인 ID끼리 겹치면 막는다', () => {
    expect(senderKeyClash([{ label: '금강', loginId: 'a1' }], { label: '금 강', loginId: 'b2' })).toBe(true);
    expect(senderKeyClash([{ label: null, loginId: 'a1' }], { label: null, loginId: 'A1' })).toBe(true);
    expect(senderKeyClash([{ label: '금강', loginId: 'a1' }], { label: '신환', loginId: 'b2' })).toBe(false);
  });

  it('교차 겹침(내 표시명 = 남의 로그인 ID)도 막는다 — 재활성 우회 시나리오의 뿌리', () => {
    // A(login=alpha, label=beta)를 재활성하려는데 B(login=beta, label=alpha)가 활성이면
    // alpha·beta 어느 지정값도 두 후보와 일치(ambiguous)라 그 주소의 접수가 전부 반려된다.
    expect(senderKeyClash([{ label: 'alpha', loginId: 'beta' }], { label: 'beta', loginId: 'alpha' })).toBe(true);
    expect(senderKeyClash([{ label: null, loginId: 'beta' }], { label: 'beta', loginId: 'c3' })).toBe(true);
  });

  it('기존 집합이 비어 있으면(첫 등록·단독 재활성) 겹침이 없다', () => {
    expect(senderKeyClash([], { label: '금강', loginId: 'a1' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// MMS 이미지 첨부 규격 (★2026-08-28 서수란 접수 cmtclkuhe04iujnotbi3xbuu3)
//   메일 접수 MMS 개통: 규격(JPG 실체·300KB·3장)이면 접수, 벗어나면 파일별 사유 반려.
//   판정은 확장자·MIME이 아니라 파일 첫 바이트(SOI)다 — 무인증 입구의 위장 파일 방어.
// ─────────────────────────────────────────────────────────────
import { isImageAttachment, mailImageName, validateMailMmsImages } from '../agency-send-email';
import { isJpegBuffer } from '../mms-image-util';
import fs from 'fs';
import path from 'path';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 1)]);
const att = (filename: string, content: Buffer, contentType = '') => ({ filename, content, contentType, size: content.length });

describe('이미지 첨부 판정(isImageAttachment) — 표 파일과 가른다', () => {
  it('contentType image/* 또는 이미지 확장자면 이미지 후보다', () => {
    expect(isImageAttachment(att('a.jpg', JPG))).toBe(true);
    expect(isImageAttachment(att('사진.PNG', PNG))).toBe(true);
    expect(isImageAttachment({ filename: 'x.bin', contentType: 'image/jpeg', content: JPG })).toBe(true);
  });
  it('표·문서 파일은 이미지 후보가 아니다', () => {
    expect(isImageAttachment(att('명단.xlsx', Buffer.alloc(10)))).toBe(false);
    expect(isImageAttachment(att('요청서.csv', Buffer.alloc(10)))).toBe(false);
    expect(isImageAttachment(att('문서.pdf', Buffer.alloc(10)))).toBe(false);
  });
});

describe('MMS 규격 검사(validateMailMmsImages)', () => {
  it('규격 안(JPG 실체 · 300KB 이하 · 3장 이하) = 통과', () => {
    const r = validateMailMmsImages([att('a.jpg', JPG), att('b.jpg', JPG), att('c.jpg', JPG)]);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  it('PNG는 파일별 사유로 반려된다', () => {
    const r = validateMailMmsImages([att('a.jpg', JPG), att('포스터.png', PNG)]);
    expect(r.ok).toBe(false);
    expect(r.reasons.join('\n')).toContain('포스터.png');
    expect(r.reasons.join('\n')).toContain('JPG 파일만');
  });
  it('확장자만 jpg인 위장 파일(내용 PNG)도 반려된다 — 실체 판정', () => {
    const r = validateMailMmsImages([att('위장.jpg', PNG)]);
    expect(r.ok).toBe(false);
    expect(r.reasons.join('\n')).toContain('위장.jpg');
  });
  it('300KB 초과는 실측 KB와 함께 반려되고, 변환 출구(화면 접수)를 안내한다', () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(310 * 1024, 1)]);
    const r = validateMailMmsImages([att('큰사진.jpg', big)]);
    expect(r.ok).toBe(false);
    expect(r.reasons.join('\n')).toContain('큰사진.jpg');
    expect(r.reasons.join('\n')).toContain('300KB 이하');
    expect(r.reasons.join('\n')).toContain('화면 접수');
  });
  it('4장은 장수 사유로 반려된다', () => {
    const r = validateMailMmsImages([att('a.jpg', JPG), att('b.jpg', JPG), att('c.jpg', JPG), att('d.jpg', JPG)]);
    expect(r.ok).toBe(false);
    expect(r.reasons.join('\n')).toContain('최대 3장');
  });
  it('파일명 없는 첨부는 순번으로 부른다', () => {
    expect(mailImageName({ content: JPG }, 1)).toBe('이미지 2');
  });
  it('JPG 실체 판정은 SOI 바이트다', () => {
    expect(isJpegBuffer(JPG)).toBe(true);
    expect(isJpegBuffer(PNG)).toBe(false);
    expect(isJpegBuffer(Buffer.alloc(0))).toBe(false);
  });
});

describe('메일 워커 배선 (소스 계약) — MMS 개통이 되돌아가지 않는다', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '../agency-send-mail-worker.ts'), 'utf8');

  it('이미지 무조건 반려(has_image)가 되살아나지 않았다 — 규격 게이트만 있다', () => {
    expect(worker).not.toMatch(/'has_image'/);
    expect(worker).toMatch(/validateMailMmsImages\(imageAtts\)/);
    expect(worker).toMatch(/'mms_image_invalid'/);
  });
  it('이미지 파일명 칸만 있고 첨부 0장이면 반려한다(첨부 없는 이미지 지정 = 기대와 다른 발송)', () => {
    expect(worker).toMatch(/form\.imageFileName && imageAtts\.length === 0/);
    expect(worker).toMatch(/'image_not_attached'/);
  });
  it('저장은 발송 계정 확정 뒤이고, 반려 시 저장 파일을 지운다(고아 방지)', () => {
    // ★2026-09-05 §21-4 계정 확정이 단위별로 옮겨졌다(auth 상속 금지). 앵커도 그 자리로 옮긴다 —
    //   lastAcct 대입이 "이 단위의 계정이 확정된 지점"이고, 이미지 저장은 그보다 뒤여야 한다.
    const saveAt = worker.indexOf('saveMmsImageBuffer(unitAcct.companyId');
    const acctAt = worker.indexOf('lastAcct = unitAcct;');
    expect(acctAt).toBeGreaterThan(0);
    expect(saveAt).toBeGreaterThan(acctAt);
    expect(worker).toMatch(/savedImagePaths\.splice\(0\)/);
  });
  it('접수 코어에는 화면 접수와 같은 형태(절대경로 배열)로 넘긴다', () => {
    // 다중이면 이미지가 애초에 반려되므로 그 경로에서만 빈 배열이다. 무조건 빈 배열 고정은 여전히 금지.
    expect(worker).toMatch(/mmsImagePaths: multi \? \[\] : savedImagePaths/);
    expect(worker, 'SMS·LMS 전용 시절의 빈 배열 고정이 되살아났다').not.toMatch(/mmsImagePaths: \[\],/);
  });
  it('접수 완료 회신에 이미지 순서를 적는다(이 회신이 유일한 확인 자리다)', () => {
    expect(worker).toMatch(/imageNames: multi \? \[\] : savedImageNames/);
    expect(worker).toMatch(/이 순서로 붙습니다/);
  });
  it('★0905 다중 접수에는 이미지를 받지 않는다(첨부 순서로 귀속을 정할 수 없다)', () => {
    expect(worker).toMatch(/multi && imageAtts\.length > 0/);
    expect(worker).toMatch(/'multi_form_with_image'/);
    // 판정이 저장보다 앞이어야 고아 파일 정리에 기대지 않는다
    expect(worker.indexOf("'multi_form_with_image'")).toBeLessThan(worker.indexOf('saveMmsImageBuffer(unitAcct.companyId'));
  });
  it('★0905 이미지 파일명 칸 검사는 단건·다중 공통이다(Codex 1R ② — 다중에서 건너뛰면 이미지가 빠진 채 발송된다)', () => {
    const check = worker.indexOf("'image_not_attached'");
    const multiOnlyBlock = worker.indexOf('if (!multi) {');
    expect(check).toBeGreaterThan(0);
    expect(multiOnlyBlock).toBeGreaterThan(0);
    expect(check, '검사가 다중 전용 분기 안으로 들어갔다').toBeLessThan(multiOnlyBlock);
  });
  it('★0905 재시도 회신은 재발송본임을 밝힌다(스냅샷을 복원하지 않으므로 침묵하면 안 된다)', () => {
    expect(worker).toMatch(/처음 보내드린 접수 완료 안내가 도달하지 못해/);
  });
  it('★0905 한 메일의 요청서는 같은 회사여야 한다(intake 원장의 회사 칸이 하나뿐이다)', () => {
    expect(worker).toMatch(/'multi_company_not_allowed'/);
    expect(worker).toMatch(/mailCompanyId !== unitAcct\.companyId/);
  });
  it('★0905 메일 안 같은 요청서 두 장은 DB로 못 잡으므로 계획 단계에서 대조한다', () => {
    expect(worker).toMatch(/'duplicate_in_mail'/);
    expect(worker).toMatch(/plans\.find\(\(p\) => p\.dupKey === dupKey\)/);
  });
  it('★0905 재시도 회신은 request_ids 전량을 읽는다(첫 건만 읽으면 N건 중 1건만 말한다)', () => {
    expect(worker).toMatch(/id = ANY\(\$1::uuid\[\]\)/);
    expect(worker, 'request_ids[0]만 읽던 회귀가 되살아났다').not.toMatch(/row\.request_ids\[0\]/);
  });
  it('신규 반려 코드는 슈퍼관리자 라벨표에 등재됐다(미등재 = 화면이 코드를 그대로 보여준다)', () => {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../../frontend/src/components/admin/AgencyMailIntakePanel.tsx'), 'utf8');
    expect(panel).toMatch(/mms_image_invalid/);
    expect(panel).toMatch(/image_not_attached/);
    // ★2026-08-27 발송 ID 지정 판정 + ★2026-09-05 §21-4 다중 접수
    for (const code of [
      'billing_target_required', 'billing_target_not_found', 'billing_target_ambiguous', 'billing_target_mismatch',
      'too_many_forms', 'duplicate_in_mail', 'multi_form_with_image', 'multi_company_not_allowed', 'claim_exhausted',
    ]) {
      expect(panel.includes(code), `${code} 라벨 미등재 — 화면이 코드를 그대로 노출한다`).toBe(true);
    }
  });
});
