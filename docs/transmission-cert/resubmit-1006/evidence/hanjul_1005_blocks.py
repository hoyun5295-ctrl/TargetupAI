# -*- coding: utf-8 -*-
"""
전송자격인증 재접수 — 한줄로 1005 수집 원문(받은 출력 글자 그대로 · 고치지 않는다).
가림은 생성기(make_hanjul_evidence_images.mask_line)가 그릴 때만 한다.
"""

COLLECTED = '2026-10-05 (한국 · 출력을 받은 시각 · Harold 실행 · .62)'

# 명의 확인 처리(입금 보류 해제) 감사 기록 전체 — action = deposit_hold_resolved
DEPOSIT_HOLD_RESOLVED = """-[ RECORD 1 ]+-----------------------------------------------------------------
processed_at | 2026-08-29 10:46:17
processed_by | ceo
company      | 테스트계정
depositor    | 유호윤
held_reason  | 입금자명이 계정에 등록된 명의와 일치하지 않아 확인이 필요합니다.
explanation  | 대표자명의로 이체했습니다
resolution   | rejected
admin_note   | 거절
-[ RECORD 2 ]+-----------------------------------------------------------------
processed_at | 2026-09-20 20:37:59
processed_by | ceo
company      | 주식회사 베이컨
depositor    | 최규삼
held_reason  | 입금자명이 계정에 등록된 명의와 일치하지 않아 확인이 필요합니다.
explanation  |
resolution   | rejected
admin_note   | 이미 충전됨"""

# 2번 기록 대조 — 그 고객사의 입금 신청(9/10 이후)과 같은 기간 잔액 원장(차감 제외)
DEPOSIT_HOLD_CASE_REQUEST = """  requested  |  amount  | depositor_name |  status  |    held     |   closed    | admin_note
-------------+----------+----------------+----------+-------------+-------------+-------------
 09-18 15:35 | 20000.00 | 최규삼         | rejected | 09-18 15:35 | 09-20 20:37 | 이미 충전됨
(1 row)"""

DEPOSIT_HOLD_CASE_LEDGER = """     at      |     type     |  amount  | payment_method |                        description
-------------+--------------+----------+----------------+-----------------------------------------------------------
 09-15 18:25 | charge       | 30000.00 |                | 카드결제 충전 (30,000원)
 09-16 18:00 | refund       |    75.90 | system         | 발송 실패 환불 (LMS 3건 × 25.3원)
 09-16 18:04 | refund       |    25.30 | system         | 발송 실패 환불 (sweep) (LMS 1건 × 25.3원)
 09-17 18:00 | refund       |    50.60 | system         | 발송 실패 환불 (sweep) (LMS 추가 2건 × 25.3원, 누적 5건)
 09-17 18:00 | refund       |    25.30 | system         | 발송 실패 환불 (sweep) (LMS 추가 1건 × 25.3원, 누적 6건)
 09-17 18:01 | refund       |    25.30 | system         | 발송 실패 환불 (sweep) (LMS 추가 1건 × 25.3원, 누적 7건)
 09-17 18:06 | refund       |    50.60 | system         | 발송 실패 환불 (sweep) (LMS 추가 2건 × 25.3원, 누적 3건)
 09-17 18:06 | refund       |    50.60 | system         | 발송 실패 환불 (sweep) (LMS 추가 2건 × 25.3원, 누적 9건)
 09-17 18:07 | refund       |    25.30 | system         | 발송 실패 환불 (sweep) (LMS 추가 1건 × 25.3원, 누적 4건)
 09-17 18:08 | refund       |    50.60 | system         | 발송 실패 환불 (sweep) (LMS 추가 2건 × 25.3원, 누적 11건)
 09-18 15:42 | admin_charge | 20000.00 | admin          | 무통장입금
 09-18 18:00 | refund       |    25.30 | system         | 발송 실패 환불 (LMS 1건 × 25.3원)
 09-19 18:08 | refund       |    25.30 | system         | 발송 실패 환불 (sweep) (LMS 1건 × 25.3원)
(13 rows)"""

# 인증번호 수신 번호 등록 · 변경 기록(최근 20건) — action = mfa_phone_changed · 번호는 기록할 때 가운데 자리를 가려 저장된다
MFA_PHONE_CHANGED = """      일시       |    처리자    |  대상계정  |    변경전     |    변경후     | 해제기기
------------------+--------------+------------+---------------+---------------+----------
 2026-10-03 12:26 | ceo          | invito01   |               |               | 0
 2026-09-25 21:01 | ceo          | psy5868    | 010-****-5868 |               | 2
 2026-09-24 07:18 | ceo          | test001    |               |               | 0
 2026-09-21 14:26 | suran        | espayment4 |               |               | 0
 2026-09-21 14:25 | suran        | espayment3 |               |               | 0
 2026-09-21 14:25 | suran        | espayment2 |               |               | 0
 2026-09-21 14:25 | suran        | espayment1 |               |               | 0
 2026-09-21 08:17 | ceo          | psy5868    | 010-****-8517 | 010-****-5868 | 1
 2026-09-21 08:16 | ceo          | psy5868    | 010-****-5868 | 010-****-8517 | 0
 2026-09-20 20:38 | ceo          | psy5868    | 010-****-8517 | 010-****-5868 | 4
 2026-09-19 16:23 | ceo          | psy5868    |               | 010-****-8517 | 0
 2026-09-19 16:10 | ceo          | psy5868    | 010-****-5868 |               | 9
 2026-09-18 10:16 | suran        | ncitssms   |               |               | 0
 2026-09-12 06:53 | ceo          | hoyun      | 010-****-8517 | 010-****-8517 | 1
 2026-09-12 06:50 | ceo          | psy5868    |               | 010-****-5868 | 0
 2026-09-12 06:49 | ceo          | suran      |               | 010-****-5257 | 0
 2026-09-12 06:48 | ceo          | hoyun      |               | 010-****-8517 | 0
 2026-09-11 10:49 | jihyun_admin | idlooksms  |               |               | 0
 2026-09-11 10:48 | jihyun_admin | idlook01   |               |               | 0
 2026-09-11 10:48 | jihyun_admin | idlookcs2  |               |               | 0
(20 rows)"""
