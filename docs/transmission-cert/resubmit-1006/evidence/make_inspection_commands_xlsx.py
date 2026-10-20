# -*- coding: utf-8 -*-
"""전송자격인증 현장 실사(2026-10-22) 로그 명령집 엑셀 생성기.

엑셀 칸 하나에 여러 줄을 넣고 복사하면 앞뒤에 " 가 붙고 안의 " 가 "" 로 바뀐다(2026-10-21 이 PC 엑셀 실측).
그래서 명령은 전부 한 줄이다. SQL 은 bash here-string(<<< "...") 으로 넘긴다.
  - SQL 안에 " $ ` ! 를 쓰지 않는다(바깥 큰따옴표가 깨지거나 셸이 바꾼다) → 별칭은 따옴표 없는 한글_밑줄.
  - 한국 시각 = docker exec -e PGTZ=Asia/Seoul (SET 줄을 따로 찍지 않게).
조회는 전부 SELECT 다. 실행: python make_inspection_commands_xlsx.py
"""
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT = Path(__file__).resolve().parent.parent / '실사_로그_명령집_20261022.xlsx'

HANJUL_PSQL = 'docker exec -i -e PGTZ=Asia/Seoul targetup-postgres psql -U targetup -d targetup -P pager=off -P border=2'
GW_PSQL = 'docker exec -i -e PGTZ=Asia/Seoul bito-bench-postgres psql -U bito -d bito_gateway -P pager=off -P border=2'
MYSQL = "docker exec -i targetup-mysql sh -c 'MYSQL_PWD=\"$MYSQL_ROOT_PASSWORD\" exec mysql -uroot -t smsdb'"

H_ADMIN = '한줄로 서버(.62) · administrator'
H_ROOT = '한줄로 서버(.62) · root 셸'
G_INVITO = '게이트웨이 서버(.65) · invito'
G_ROOT = '게이트웨이 서버(.65) · root 셸'

OLD = '10-03 실행분'
NEW = '새로 씀 · 10-21 컬럼 확인'
NEW_RAW = '새로 씀'


def one_line(sql: str) -> str:
    s = re.sub(r'\s+', ' ', sql).strip()
    for ch in '"$`!':
        assert ch not in s, f'SQL 안에 {ch} 가 있다: {s[:80]}'
    return s


def pg(prefix: str, sql: str) -> str:
    return f'{prefix} <<< "{one_line(sql)}"'


def my(sql: str) -> str:
    return f'{MYSQL} <<< "{one_line(sql)}"'


ROWS = []  # (번호, 항목, 로그, 위치, 명령, 근거, 메모)


def add(no, item, title, where, cmd, basis, memo=''):
    assert '\n' not in cmd, f'{no} 명령이 여러 줄이다'
    ROWS.append((no, item, title, where, cmd, basis, memo))


# ───────────────────────────── 한줄로 ─────────────────────────────
add('H-1', '4.1 · 4.2', '감사 기록 보관 범위 · 월별 건수', H_ADMIN, pg(HANJUL_PSQL, """
SELECT MIN(created_at) AS 가장_오래된_기록, MAX(created_at) AS 가장_최근_기록, COUNT(*) AS 전체_건수 FROM audit_logs;
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, COUNT(*) AS 건수 FROM audit_logs GROUP BY 1 ORDER BY 1;
"""), OLD, '지우는 기능이 없다는 근거 = 가장 오래된 기록이 서비스 초기(2026-02-11)부터 남아 있음')

add('H-2', '4.1 · 4.2', '기록 종류별 첫 기록일 · 월별 건수', H_ADMIN, pg(HANJUL_PSQL, """
SELECT action AS 기록_종류, to_char(MIN(created_at), 'YYYY-MM-DD') AS 첫_기록일,
       COUNT(*) FILTER (WHERE created_at >= '2026-08-01' AND created_at < '2026-09-01') AS 건수_8월,
       COUNT(*) FILTER (WHERE created_at >= '2026-09-01' AND created_at < '2026-10-01') AS 건수_9월,
       COUNT(*) FILTER (WHERE created_at >= '2026-10-01') AS 건수_10월
  FROM audit_logs GROUP BY action ORDER BY action;
"""), OLD, '어떤 로그가 언제부터 남는지 한 장으로 보여 줄 때')

add('H-3', '4.1', '로그인 성공 · 실패 · 차단 · 동시 접속 원문 + 로그인 차단 대장', H_ADMIN, pg(HANJUL_PSQL, """
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(u.login_id, s.login_id, a.details->>'loginId') AS 계정,
       host(a.ip_address) AS 출발지_IP, left(a.user_agent, 40) AS 브라우저
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('login_success','login_fail','login_blocked','logout','login_session_conflict','login_takeover')
 ORDER BY a.created_at DESC LIMIT 30;
SELECT blocked_at AS 차단_시각, login_id AS 계정, host(ip_address) AS 출발지_IP, reason AS 사유, fail_count AS 실패_수,
       expires_at AS 만료, unblocked_at AS 해제, unblock_reason AS 해제_사유
  FROM login_blocks ORDER BY blocked_at DESC LIMIT 20;
"""), NEW, '로그인 차단 = 같은 IP · 아이디 5회 실패 시 30분 자동 차단')

add('H-4', '4.1', '화면(페이지) 접속 기록', H_ADMIN, pg(HANJUL_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, COUNT(*) AS 화면_접속_기록, COUNT(DISTINCT user_id) AS 계정_수
  FROM audit_logs WHERE action = 'page_view' GROUP BY 1 ORDER BY 1;
SELECT a.created_at AS 일시, COALESCE(u.login_id, s.login_id) AS 계정, a.details->>'path' AS 화면, host(a.ip_address) AS 출발지_IP
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action = 'page_view' ORDER BY a.created_at DESC LIMIT 20;
"""), NEW, '2026-09-12부터 기록 · 같은 사람 · 같은 화면 60초 안은 1건')

add('H-5', '4.2', '개인정보 조회 · 등록 · 수정 · 내보내기 · 삭제 기록', H_ADMIN, pg(HANJUL_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, action AS 종류, details->>'kind' AS 대상, COUNT(*) AS 요청_수
  FROM audit_logs
 WHERE action IN ('privacy_view','privacy_edit','privacy_export','privacy_purge','customer_delete','customer_bulk_delete','customer_delete_all','customer_delete_by_user')
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT a.created_at AS 일시, a.action AS 종류, a.details->>'kind' AS 대상, a.details->>'count' AS 건수,
       COALESCE(u.login_id, s.login_id) AS 계정, host(a.ip_address) AS 출발지_IP
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('privacy_view','privacy_edit','privacy_export','privacy_purge','customer_delete_all')
 ORDER BY a.created_at DESC LIMIT 20;
"""), NEW, '조회 · 수정은 2026-09-12부터 · 내보내기는 2026-08-20부터')

add('H-6', '2.1 · 4.1 ②', '계정 발급(회원가입) · 고객사 등록 기록 + 월별 계정 생성 수', H_ADMIN, pg(HANJUL_PSQL, """
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(s.login_id, u.login_id) AS 발급자, a.details AS 상세
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('user_account_created', 'company_created') ORDER BY a.created_at;
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, COUNT(*) AS 생성된_계정
  FROM users WHERE COALESCE(is_system, false) = false GROUP BY 1 ORDER BY 1;
"""), OLD, '가입이 아니라 법인 계약 뒤 당사 발급 · 발급 기록은 2026-10-02부터, 그 전 계정은 생성일')

add('H-7', '2.1 · 3.4 ②', '본인확인기관(한국모바일인증) 인증 이력', H_ADMIN, pg(HANJUL_PSQL, """
SELECT v.created_at AS 시작, u.login_id AS 계정, v.purpose AS 구분, v.status AS 상태, v.provider AS 인증기관,
       left(v.verified_name, 1) || '**' AS 인증_이름,
       left(v.verified_phone, 3) || '****' || right(v.verified_phone, 4) AS 인증_번호,
       left(v.provider_tx_id, 8) AS 요청번호_앞8, v.verified_at AS 완료, v.ip_address AS 접속_IP
  FROM identity_verifications v LEFT JOIN users u ON u.id = v.user_id
 ORDER BY v.created_at DESC LIMIT 30;
"""), NEW, '이름 첫 글자 · 번호 가운데 · 요청번호 앞 8자리만 나온다 · 운영 개시 2026-10-06')

add('H-8', '2.1', '발신번호 등록 신청 · 심사 / 계정별 배정 / 회선 정책 변경', H_ADMIN, pg(HANJUL_PSQL, """
SELECT r.created_at AS 신청, c.company_name AS 고객사, u.login_id AS 신청자, r.phone AS 발신번호, r.status AS 결과,
       s.login_id AS 심사자, r.reviewed_at AS 심사_일시, r.reject_reason AS 반려_사유
  FROM sender_registrations r LEFT JOIN companies c ON c.id = r.company_id
  LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN super_admins s ON s.id = r.reviewed_by
 ORDER BY r.created_at DESC LIMIT 30;
SELECT a.created_at AS 배정_일시, c.company_name AS 고객사, n.phone AS 발신번호, u.login_id AS 대상_계정,
       COALESCE(s.login_id, b.login_id) AS 배정한_관리자
  FROM callback_number_assignments a JOIN callback_numbers n ON n.id = a.callback_number_id
  LEFT JOIN companies c ON c.id = n.company_id LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN super_admins s ON s.id = a.assigned_by LEFT JOIN users b ON b.id = a.assigned_by
 ORDER BY a.created_at DESC LIMIT 30;
SELECT a.created_at AS 일시, COALESCE(s.login_id, u.login_id) AS 처리자, a.details AS 회선_정책_변경_내용
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action = 'sender_line_policy_update' ORDER BY a.created_at DESC LIMIT 20;
"""), NEW, '')

add('H-9', '2.2 ① · ④', '국외 IP 차단 — 국내 대역 · 날짜별 감지와 차단 · 차단 원문', H_ADMIN, pg(HANJUL_PSQL, """
SELECT country_code AS 국가, source AS 출처, COUNT(*) AS 대역_수, MAX(updated_at) AS 마지막_갱신
  FROM geo_allow_cidrs GROUP BY 1, 2 ORDER BY 3 DESC;
SELECT to_char(created_at, 'YYYY-MM-DD') AS 날짜,
       COUNT(*) FILTER (WHERE action = 'foreign_access_detected') AS 감지_예외통과_포함,
       COUNT(*) FILTER (WHERE action = 'foreign_access_blocked') AS 차단
  FROM audit_logs WHERE action IN ('foreign_access_detected', 'foreign_access_blocked') AND created_at >= '2026-09-01'
 GROUP BY 1 ORDER BY 1;
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(u.login_id, s.login_id, a.details->>'loginId') AS 계정,
       host(a.ip_address) AS 출발지_IP, a.details AS 상세
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action = 'foreign_access_blocked' ORDER BY a.created_at DESC LIMIT 30;
"""), OLD, '탐지 2026-08-28 · 차단 2026-10-01')

add('H-10', '2.2 ③', '허용 IP(예외) 대장 — 사유 · 승인자 · 허용 기간 + 허용 · 해제 이력', H_ADMIN, pg(HANJUL_PSQL, """
SELECT x.created_at AS 등록_일시, x.scope AS 범위, c.company_name AS 고객사, u.login_id AS 계정, x.cidr AS 허용_대역,
       x.reason AS 사유, s.login_id AS 승인자, x.approved_at AS 승인_일시, x.expires_at AS 허용_만료, x.is_active AS 유효
  FROM access_origin_allowlist x LEFT JOIN companies c ON c.id = x.company_id
  LEFT JOIN users u ON u.id = x.user_id LEFT JOIN super_admins s ON s.id = x.approved_by
 ORDER BY x.created_at;
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(s.login_id, u.login_id) AS 처리자, a.details AS 상세
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('access_origin_exception_granted', 'access_origin_exception_revoked', 'geo_cidrs_replaced')
 ORDER BY a.created_at;
"""), OLD, '회수는 지우지 않고 유효=false 로 남긴다')

add('H-11', '2.2 ⑤', '연동 경로(API · 싱크에이전트) 출발지 대조 기록 — 월별', H_ADMIN, pg(HANJUL_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, action AS 종류, details->>'scope' AS 경로,
       details->>'registered' AS 등록_여부, COUNT(*) AS 건수, COUNT(DISTINCT target_id) AS 고객사_수,
       COUNT(DISTINCT ip_address) AS 출발지_수
  FROM audit_logs WHERE action IN ('machine_origin_detected', 'machine_origin_blocked')
 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3;
"""), OLD, '사람은 국가로, 기계(API · 싱크)는 등록한 출발지로 통제')

add('H-12', '2.3', '입금 명의 보류 · 고객사 소명 · 처리 결과', H_ADMIN, pg(HANJUL_PSQL, """
SELECT d.created_at AS 신청, c.company_name AS 고객사, d.amount AS 금액, left(d.depositor_name, 1) || '**' AS 입금자,
       d.held_reason AS 보류_사유, d.held_at AS 보류_시각, d.explanation_note AS 고객사_소명, d.status AS 결과,
       d.confirmed_at AS 처리_일시, d.admin_note AS 관리자_메모
  FROM deposit_requests d LEFT JOIN companies c ON c.id = d.company_id
 WHERE d.held_at IS NOT NULL OR d.held_reason IS NOT NULL ORDER BY d.created_at DESC LIMIT 20;
SELECT a.created_at AS 일시, COALESCE(s.login_id, u.login_id) AS 처리자, a.details AS 처리_내용
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action = 'deposit_hold_resolved' ORDER BY a.created_at;
"""), NEW, '입금자 이름은 첫 글자만')

add('H-13', '3.4 ① · ③', '다중인증 요청 · 성공 · 실패 · 잠김 + 원문 + 수신 번호 변경 · 본인인증 기록', H_ADMIN, pg(HANJUL_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월,
       COUNT(*) FILTER (WHERE action = 'mfa_challenge') AS 인증_요청, COUNT(*) FILTER (WHERE action = 'mfa_success') AS 인증_성공,
       COUNT(*) FILTER (WHERE action = 'mfa_fail') AS 인증_실패, COUNT(*) FILTER (WHERE action = 'mfa_locked') AS 잠김,
       COUNT(DISTINCT user_id) FILTER (WHERE action = 'mfa_success') AS 인증한_계정_수
  FROM audit_logs WHERE action IN ('mfa_challenge', 'mfa_success', 'mfa_fail', 'mfa_locked') GROUP BY 1 ORDER BY 1;
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(u.login_id, a.details->>'loginId') AS 계정, host(a.ip_address) AS 출발지_IP
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
 WHERE a.action IN ('mfa_challenge', 'mfa_success', 'mfa_fail', 'mfa_locked') ORDER BY a.created_at DESC LIMIT 20;
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(s.login_id, u.login_id) AS 처리자, t.login_id AS 대상_계정
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
  LEFT JOIN users t ON t.id = a.target_id
 WHERE a.action IN ('mfa_phone_changed', 'identity_verify_start', 'identity_verified', 'identity_verify_fail')
 ORDER BY a.created_at DESC LIMIT 40;
"""), OLD, '5회 실패 = 잠김 · 인증번호는 평문 저장 안 함')

add('H-14', '3.5 ①', '발신 인증(추가 인증) 요청 · 성공 + 원문', H_ADMIN, pg(HANJUL_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월,
       COUNT(*) FILTER (WHERE action = 'sender_auth_challenge') AS 인증_요청,
       COUNT(*) FILTER (WHERE action = 'sender_auth_success') AS 인증_성공,
       COUNT(DISTINCT user_id) FILTER (WHERE action = 'sender_auth_success') AS 인증한_계정_수
  FROM audit_logs WHERE action IN ('sender_auth_challenge', 'sender_auth_success') GROUP BY 1 ORDER BY 1;
SELECT a.created_at AS 일시, a.action AS 종류, u.login_id AS 계정, host(a.ip_address) AS 출발지_IP
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
 WHERE a.action IN ('sender_auth_challenge', 'sender_auth_success') ORDER BY a.created_at DESC LIMIT 20;
"""), OLD, '인증 유지 8시간')

add('H-15', '3.2 · 3.3 · 4.2', '직원 계정 목록 · 생성 · 등급 변경 · 사용 중지 · 비밀번호 변경 이력', H_ADMIN, pg(HANJUL_PSQL, """
SELECT login_id AS 직원_계정, name AS 이름, role AS 등급, is_active AS 사용, created_at AS 생성, last_login_at AS 마지막_로그인
  FROM super_admins ORDER BY created_at;
SELECT a.created_at AS 일시, a.action AS 종류, s.login_id AS 처리자, a.details AS 상세
  FROM audit_logs a LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('admin_account_created','admin_account_disabled','admin_account_enabled','admin_role_changed','admin_password_changed','totp_enrolled')
 ORDER BY a.created_at DESC LIMIT 40;
"""), NEW, '등급 = super 대표 · lead 지원팀장 · support 지원팀원 · 비밀번호 변경 기록에 비밀번호 값은 없다(코드 확인)')

add('H-16', '3.1 ④ · 3.3 ③ · 4.3', '운영 기록 대장 — 로그 점검 · 방화벽 정책 변경 · 접근권한 점검', H_ADMIN, pg(HANJUL_PSQL, """
SELECT c.created_at AS 작성, c.details->>'kind' AS 종류, c.details->>'system' AS 대상_시스템,
       left(c.details->>'title', 40) AS 제목, c.details->'recorder'->>'name' AS 작성자,
       f.created_at AS 확인_일시, fs.name AS 확인자, v.created_at AS 무효_처리
  FROM audit_logs c
  LEFT JOIN audit_logs f ON f.action = 'ops_record_confirmed' AND f.target_type = 'ops_record' AND f.target_id = c.target_id
  LEFT JOIN super_admins fs ON fs.id = f.user_id
  LEFT JOIN audit_logs v ON v.action = 'ops_record_voided' AND v.target_type = 'ops_record' AND v.target_id = c.target_id
 WHERE c.action = 'ops_record_created' AND c.target_type = 'ops_record' AND c.created_at >= '2026-10-01'
 ORDER BY c.created_at;
"""), NEW_RAW, '화면(슈퍼관리자 → 보안 · 인증 → 운영 기록 대장)이 더 읽기 쉽다. 이건 지울 수 없는 감사 기록으로 쌓인다는 원본. 종류 log_review 로그 점검 · firewall_change 방화벽 변경 · access_review 접근권한 점검')

add('H-17', '4.3', '월간 로그 점검 자료(점검 때 보는 집계) + 로그인 실패 몰린 계정', H_ADMIN, pg(HANJUL_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 점검_대상_월,
       COUNT(*) FILTER (WHERE action = 'login_success') AS 로그인_성공, COUNT(*) FILTER (WHERE action = 'login_fail') AS 로그인_실패,
       COUNT(*) FILTER (WHERE action = 'login_blocked') AS 로그인_차단, COUNT(*) FILTER (WHERE action = 'login_session_conflict') AS 동시_접속_감지,
       COUNT(*) FILTER (WHERE action = 'mfa_locked') AS 인증_잠김, COUNT(*) FILTER (WHERE action = 'foreign_access_blocked') AS 국외_차단,
       COUNT(*) FILTER (WHERE action = 'machine_origin_blocked') AS 기계_접속_차단, COUNT(*) FILTER (WHERE action = 'account_restricted') AS 계정_제한,
       COUNT(*) FILTER (WHERE action = 'company_terminated') AS 회사_해지, COUNT(*) FILTER (WHERE action = 'privacy_export') AS 개인정보_내보내기,
       COUNT(*) FILTER (WHERE action = 'customer_delete_all') AS 고객_전체삭제, COUNT(*) FILTER (WHERE action = 'admin_role_changed') AS 직원_등급_변경,
       COUNT(*) FILTER (WHERE action = 'admin_account_created') AS 직원_계정_생성
  FROM audit_logs WHERE created_at >= '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT * FROM (
  SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, details->>'loginId' AS 계정, COUNT(*) AS 실패_수,
         COUNT(DISTINCT ip_address) AS 출발지_수,
         ROW_NUMBER() OVER (PARTITION BY date_trunc('month', created_at) ORDER BY COUNT(*) DESC) AS rn
    FROM audit_logs WHERE action = 'login_fail' AND created_at >= '2026-09-01'
   GROUP BY date_trunc('month', created_at), details->>'loginId' HAVING COUNT(*) >= 5
) t WHERE rn <= 10 ORDER BY 월, 실패_수 DESC;
"""), OLD, '')

add('H-18', '5.1', '계정 제한 · 정지 · 고객사 해지 조치와 고지 결과', H_ADMIN, pg(HANJUL_PSQL, """
SELECT a.created_at AS 일시, a.action AS 종류, COALESCE(s.login_id, u.login_id) AS 처리자, a.details AS 사유_잠근계정_끊은세션_고지
  FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('account_restricted', 'company_terminated', 'kakao_profile_disabled')
 ORDER BY a.created_at DESC LIMIT 20;
"""), NEW, '')

add('H-19', '5.2', '금칙어 규칙 · 월별 탐지 · 차단 · 원문 · 규칙 변경 이력', H_ADMIN, pg(HANJUL_PSQL, """
SELECT name AS 규칙, mode AS 모드, jsonb_array_length(elements) AS 조합_요소_수, is_active AS 사용, created_at AS 등록, updated_at AS 마지막_수정
  FROM spam_block_rules ORDER BY created_at;
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, mode AS 규칙_모드, action_taken AS 처리,
       COUNT(*) AS 발송_요청_수, SUM(affected_rows) AS 걸린_건수
  FROM spam_block_hits GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT h.created_at AS 일시, r.name AS 규칙, c.company_name AS 고객사, h.send_source AS 발송_경로, h.action_taken AS 처리,
       h.affected_rows AS 건수, h.content_sample AS 문안_표본_숫자가림
  FROM spam_block_hits h LEFT JOIN spam_block_rules r ON r.id = h.rule_id LEFT JOIN companies c ON c.id = h.company_id
 ORDER BY h.created_at DESC LIMIT 20;
SELECT a.created_at AS 일시, a.action AS 종류, s.login_id AS 처리자, a.details AS 상세
  FROM audit_logs a LEFT JOIN super_admins s ON s.id = a.user_id
 WHERE a.action IN ('spam_block_rule_create', 'spam_block_rule_update', 'spam_block_rule_mode') ORDER BY a.created_at;
"""), NEW, '모드 detect = 탐지(기록만) · block = 차단 · 키워드 · URL · 전화번호 2~5개 조합')

add('H-20a', '4.1', '발송 이력 — 발송 DB 월별 로그 표 보관 범위', H_ADMIN, my("""
SELECT RIGHT(table_name, 6) AS log_month, COUNT(*) AS log_tables, SUM(table_rows) AS rows_estimate
  FROM information_schema.tables
 WHERE table_schema = 'smsdb' AND table_name LIKE 'SMSQ_SEND_%' AND RIGHT(table_name, 7) REGEXP '^_[0-9]{6}'
 GROUP BY 1 ORDER BY 1;
"""), NEW_RAW, '접속 방식(컨테이너 안 MYSQL_ROOT_PASSWORD)이 맞는지는 「오늘 리허설」 R-3 · 접속 거부면 화면 공유를 잠깐 멈추고 비밀번호 입력')

add('H-20b', '4.1', '발송 이력 — 최근 발송 원문 10건(수신번호 가림 · 본문 없음)', H_ADMIN, my("""
SELECT seqno, CONCAT(LEFT(dest_no, 3), '****', RIGHT(dest_no, 4)) AS dest_masked, call_back, msg_type,
       sendreq_time, mobsend_time, repmsg_recvtm, status_code, mob_company
  FROM SMSQ_SEND_1_202610 ORDER BY seqno DESC LIMIT 10;
"""), NEW_RAW, 'SMSQ_SEND_1_202610 자리는 H-20a 결과에서 이번 달 표 하나로 바꿔 넣는다(셀 복사 뒤 터미널에서 고침)')

add('H-21a', '3.1 ①', '방화벽 정책 · 서비스 가동 · 정책 파일 수정 시각', H_ROOT,
    "ufw status verbose; systemctl is-active ufw fail2ban; stat -c '%y  %n' /etc/ufw/user.rules /etc/ufw/after.rules", OLD)
add('H-21b', '3.1 ④', '방화벽 변경 명령 기록(서버 인증 로그)', H_ROOT,
    "zgrep -h -a 'COMMAND=.*ufw ' /var/log/auth.log* 2>/dev/null | sort | tail -60", OLD,
    '변경 내역 전체는 운영 기록 대장(H-16)의 방화벽 정책 변경')
add('H-21c', '3.1 ④', '서버 관리자 접속 이력(최근 30건)', H_ROOT, 'last -n 30 -F -i | head -34', OLD)
add('H-21d', '3.1 ①', '외부로 열린 포트', H_ROOT, "ss -tlnH | awk '{print $4}' | sort -u", OLD)
add('H-21e', '3.1 ① · 4.1 ⑤', 'DB 컨테이너가 서버 안(127.0.0.1)에만 열림', H_ADMIN,
    "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'", NEW_RAW)
add('H-21f', '3.1 ①', '침입 차단(SSH 반복 실패 차단) 현황', H_ROOT, 'fail2ban-client status sshd', NEW_RAW,
    '감시 대상 이름이 sshd 가 아니면 fail2ban-client status 로 목록부터')

add('H-22a', '4.1 ⑤ · 4.2', '앱 로그 회전 설정 · 가장 오래된 파일 · 개수 · 용량 · 폴더 권한', H_ADMIN,
    "pm2 conf pm2-logrotate | grep -E 'retain|compress|max_size|rotateInterval'; ls -ltr ~/.pm2/logs | sed -n '2,6p'; "
    "echo \"파일 수: $(ls ~/.pm2/logs | wc -l) / 용량: $(du -sh ~/.pm2/logs | cut -f1)\"; ls -ld ~/.pm2/logs", OLD,
    '400일 · 매일 회전 · 압축')
add('H-22b', '4.1 ⑤ · 4.2', '웹 서버 로그 · 시스템 저널 1년 보관 설정과 가장 오래된 기록', H_ROOT,
    "grep -E '^\\s*(daily|weekly|rotate|compress)' /etc/logrotate.d/nginx; ls -tr /var/log/nginx | head -3; "
    "grep -E '^(SystemMaxUse|MaxRetentionSec)' /etc/systemd/journald.conf; journalctl --disk-usage; journalctl --no-pager -o short-iso | head -1",
    OLD, '웹 서버 400회분 · 저널 1년 · 12G · 설정일 2026-09-12')
add('H-22c', '4.2', 'DB 서버 로그(최근 24시간 · 마지막 30줄)', H_ADMIN,
    'docker logs --since 24h targetup-postgres 2>&1 | tail -30', NEW_RAW)
add('H-22d', '4.2', 'DB 컨테이너 로그 설정', H_ADMIN,
    "docker inspect targetup-postgres --format '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}'", NEW_RAW,
    '설정이 비어 있으면(제한 없음) 잘리지 않고 남는다')

add('H-23', '4.1 ⑤', '백업 예약 · 실행 기록 · 서버 보관분 · 마지막 성공 · 감시 기록 · 경보 설정 여부', H_ADMIN,
    "crontab -l | grep -i backup; tail -12 /home/administrator/backups/cron.log; ls -lt /home/administrator/backups | sed -n '2,9p'; "
    "stat -c '%y  LAST_SUCCESS' /home/administrator/backups/LAST_SUCCESS; tail -8 /home/administrator/backups/monitor.log; "
    "grep -c '^ALERT_CMD=.\\+' /home/administrator/backups/.env", OLD,
    '마지막 숫자 1 = 경보 보낼 곳 설정됨(값은 안 찍는다)')

add('H-24', '2.2 · 3.4 · 3.5', '통제 시행 스위치(운영 설정 파일의 해당 줄만)', H_ADMIN,
    "grep -E '^(GEO_BLOCK_ENFORCE_FROM|ORIGIN_ALLOWLIST_ENFORCE_FROM|MFA_ENFORCE_FROM|MFA_PILOT_LOGIN_IDS|SENDER_AUTH_ENFORCE_FROM|"
    "SENDER_AUTH_PILOT_LOGIN_IDS|SENDER_AUTH_FAIL_CLOSED|IDENTITY_VERIFY_ENFORCE_FROM|IDENTITY_VERIFY_PILOT_LOGIN_IDS|IDENTITY_VERIFY_PROVIDER)=' "
    "/home/administrator/targetup-app/packages/backend/.env", OLD,
    '비밀번호 · 키 줄은 고르지 않는다. 값은 시행일과 계정 명단뿐 · ⛔ 실사 중에 cat .env 는 절대 치지 않는다')

# ───────────────────────────── 게이트웨이 ─────────────────────────────
add('G-1', '4.1 · 4.2', '감사 기록 보관 범위 · 월별 건수', G_INVITO, pg(GW_PSQL, """
SELECT MIN(created_at) AS 가장_오래된_기록, MAX(created_at) AS 가장_최근_기록, COUNT(*) AS 전체_건수 FROM audit_log;
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, COUNT(*) AS 건수 FROM audit_log GROUP BY 1 ORDER BY 1;
"""), OLD, '2026-06-15부터 · 지우는 코드 없음')

add('G-2', '4.1 · 4.2', '기록 종류별 첫 기록일 · 마지막 기록일 · 월별 건수', G_INVITO, pg(GW_PSQL, """
SELECT action AS 기록_종류, target_type AS 대상, to_char(MIN(created_at), 'YYYY-MM-DD') AS 첫_기록일,
       to_char(MAX(created_at), 'YYYY-MM-DD') AS 마지막_기록일,
       COUNT(*) FILTER (WHERE created_at >= '2026-08-01' AND created_at < '2026-09-01') AS 건수_8월,
       COUNT(*) FILTER (WHERE created_at >= '2026-09-01' AND created_at < '2026-10-01') AS 건수_9월,
       COUNT(*) FILTER (WHERE created_at >= '2026-10-01') AS 건수_10월
  FROM audit_log GROUP BY action, target_type ORDER BY action, target_type;
"""), OLD)

add('G-3', '2.2 ① · ③', '접속 계정별 허용 IP 지정 현황 · 변경 사유 · 허용 만료일', G_INVITO, pg(GW_PSQL, """
SELECT COUNT(*) AS 전체_계정, COUNT(*) FILTER (WHERE is_active) AS 사용_중,
       COUNT(*) FILTER (WHERE is_active AND COALESCE(array_length(allowed_ips, 1), 0) > 0) AS 사용중_허용IP_지정,
       COUNT(*) FILTER (WHERE is_active AND COALESCE(array_length(allowed_ips, 1), 0) = 0) AS 사용중_허용IP_없음
  FROM agent_account;
SELECT agent_id AS 계정, is_active AS 사용, COALESCE(array_length(allowed_ips, 1), 0) AS 허용_IP_수,
       allowed_ips_reason AS 변경_사유, allowed_ips_expires_at AS 허용_만료일, updated_at AS 마지막_수정
  FROM agent_account ORDER BY is_active DESC, agent_id;
"""), '첫 표 10-03 실행분 · 둘째 표 새로 씀', 'IP 자체는 안 찍고 개수만 · 사유 · 만료일 칸은 2026-10-03 배포분 · 오늘 리허설 R-2 로 컬럼 확인')

add('G-4', '2.2 ① · ⑤ · 4.1', '접속 이력 — 월별 · 창구별 · 거부 사유 · 거부 원문', G_INVITO, pg(GW_PSQL, """
SELECT to_char(date_trunc('month', first_seen_at), 'YYYY-MM') AS 월, channel AS 창구, event_type AS 사건, outcome AS 결과,
       SUM(event_count) AS 건수, COUNT(DISTINCT remote_ip) AS 출발지_수
  FROM account_access_event GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
SELECT reason AS 거부_사유, channel AS 창구, SUM(event_count) AS 건수, COUNT(DISTINCT remote_ip) AS 출발지_수,
       MIN(first_seen_at) AS 처음, MAX(last_seen_at) AS 마지막
  FROM account_access_event WHERE outcome = 'denied' GROUP BY 1, 2 ORDER BY 3 DESC;
SELECT last_seen_at AS 일시, channel AS 창구, agent_id AS 계정, remote_ip AS 출발지_IP, reason AS 거부_사유, event_count AS 건수
  FROM account_access_event WHERE outcome = 'denied' ORDER BY last_seen_at DESC LIMIT 20;
"""), OLD, '10월 초 거부 급증 = 사내 시험 서버 옛 에이전트(물어보면 답 시트)')

add('G-5', '2.2 ③', '접속 계정 변경 이력(허용 IP 등록 · 변경 · 만료)', G_INVITO, pg(GW_PSQL, """
SELECT a.created_at AS 일시, a.action AS 종류, u.username AS 처리자, a.target_id AS 대상_계정,
       (a.detail ? 'allowed_ips') AS 허용IP_변경_포함, a.detail->'allowed_ips' AS 바꾼_허용IP
  FROM audit_log a LEFT JOIN admin_user u ON u.id = a.admin_user_id
 WHERE a.target_type = 'agent_account' AND a.action IN ('UPDATE','ACTIVATE','DEACTIVATE','SET_RESTRICTIONS','HARD_DELETE','ALLOWED_IPS_EXPIRED')
 ORDER BY a.created_at DESC LIMIT 40;
"""), OLD)

add('G-6', '3.1 ④', '서버 접속 · 명령 수집 기록 + 관리 사이트 로그인 기록', G_INVITO, pg(GW_PSQL, """
SELECT action AS 종류, to_char(MIN(created_at), 'YYYY-MM-DD HH24:MI') AS 첫_기록, to_char(MAX(created_at), 'YYYY-MM-DD HH24:MI') AS 마지막_기록,
       COUNT(*) AS 건수
  FROM audit_log WHERE target_type = 'server' OR action LIKE 'SERVER\\_%' GROUP BY 1 ORDER BY 1;
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 월, action AS 종류, COUNT(*) AS 건수
  FROM audit_log WHERE action LIKE 'ADMIN\\_LOGIN%' OR action = 'ADMIN_LOGOUT' GROUP BY 1, 2 ORDER BY 1, 2;
"""), OLD, '07/31 ~ 09/26 공백 있음(물어보면 답 시트)')

add('G-7', '3.4 ⑥ · 3.5 ⑤', '발송 요청 인증수단(토큰 · 설치 묶음) · 고객사 허용 발신번호 관리', G_INVITO, pg(GW_PSQL, """
SELECT a.created_at AS 일시, a.action AS 종류, a.target_type AS 대상, u.username AS 처리자, a.target_id AS 대상_식별값
  FROM audit_log a LEFT JOIN admin_user u ON u.id = a.admin_user_id
 WHERE a.action IN ('ROTATE_TOKEN','ISSUE_INSTALL_BUNDLE','SAVE_INSTALL_APPROVAL','AGENT_CREDENTIAL_ACK','UPSERT_CUSTOMER_SENDER_NUMBER',
                    'BULK_UPSERT_CUSTOMER_SENDER_NUMBER','UPDATE_CUSTOMER_SENDER_NUMBER','DEACTIVATE_CUSTOMER_SENDER_NUMBER','SET_SENDER_NUMBER_POLICY')
 ORDER BY a.created_at DESC LIMIT 40;
SELECT verification_status AS 승인_상태, is_active AS 사용, COUNT(*) AS 번호_수, MIN(created_at) AS 첫_등록, MAX(created_at) AS 최근_등록
  FROM customer_sender_number GROUP BY 1, 2 ORDER BY 1, 2;
"""), OLD)

add('G-8', '2.1 · 4.1 ②', '계정 최초 발급 기록(고객사 등록 · 발송 계정 생성 · 연결 마법사)', G_INVITO, pg(GW_PSQL, """
SELECT a.created_at AS 일시, a.action AS 종류, a.target_type AS 대상, u.username AS 발급자, a.target_id AS 대상_식별값
  FROM audit_log a LEFT JOIN admin_user u ON u.id = a.admin_user_id
 WHERE (a.action = 'CREATE' AND a.target_type IN ('reseller', 'sender_account')) OR a.action = 'CONNECT_WIZARD'
 ORDER BY a.created_at;
"""), OLD)

add('G-9', '3.2 · 4.1 ⑤ · 4.2 ⑤', '관리자 계정과 감사 기록 조회 권한', G_INVITO, pg(GW_PSQL, """
SELECT username AS 계정, role AS 등급, is_active AS 사용, last_login_at AS 마지막_로그인 FROM admin_user ORDER BY username;
"""), OLD, '감사 기록 조회 = admin 계정 하나')

add('G-10', '4.3', '월간 로그 점검 자료', G_INVITO, pg(GW_PSQL, """
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS 점검_대상_월,
       COUNT(*) FILTER (WHERE action = 'ADMIN_LOGIN') AS 관리자_로그인, COUNT(*) FILTER (WHERE action = 'ADMIN_LOGIN_FAILED') AS 관리자_로그인_실패,
       COUNT(*) FILTER (WHERE action = 'ADMIN_LOGIN_BLOCKED') AS 관리자_로그인_차단, COUNT(*) FILTER (WHERE action = 'HARD_DELETE') AS 삭제,
       COUNT(*) FILTER (WHERE action = 'ROTATE_TOKEN') AS 토큰_재발급,
       COUNT(*) FILTER (WHERE action IN ('TOPUP', 'ADJUST_BALANCE', 'WALLET_TRANSFER')) AS 잔액_변경
  FROM audit_log WHERE created_at >= '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT to_char(date_trunc('month', first_seen_at), 'YYYY-MM') AS 점검_대상_월, SUM(event_count) FILTER (WHERE outcome = 'ok') AS 접속_성공,
       SUM(event_count) FILTER (WHERE outcome = 'denied') AS 접속_거부, SUM(event_count) FILTER (WHERE outcome = 'error') AS 접속_오류,
       COUNT(DISTINCT remote_ip) FILTER (WHERE outcome = 'denied') AS 거부된_출발지_수
  FROM account_access_event WHERE first_seen_at >= '2026-09-01' GROUP BY 1 ORDER BY 1;
"""), OLD)

add('G-11', '4.1', '발송 이력 — 보관 범위 · 최근 하루 집계 · 최근 원문 10건', G_INVITO, pg(GW_PSQL, """
SELECT MIN(created_at) AS 가장_오래된_발송_기록, MAX(created_at) AS 가장_최근_발송_기록 FROM message_request;
SELECT agent_id AS 발송_계정, msg_type AS 유형, norm_status AS 상태, COUNT(*) AS 건수
  FROM message_request WHERE created_at >= now() - interval '1 day' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT id, created_at AS 요청, agent_id AS 발송_계정, left(phone, 3) || '****' || right(phone, 4) AS 수신번호, callback AS 발신번호,
       msg_type AS 유형, norm_status AS 상태, report_code_raw AS 결과_코드, report_time AS 결과_시각
  FROM message_request ORDER BY id DESC LIMIT 10;
"""), NEW_RAW, '전체 집계는 큰 표를 다 훑어서 하지 않는다(날짜 범위로만) · 오늘 리허설 R-2 로 컬럼 확인')

add('G-12a', '3.1 ①', '방화벽 정책 · 서비스(방화벽 · 침입 차단 · 감사 수집) 가동 · 정책 파일 수정 시각', G_ROOT,
    "ufw status numbered; systemctl is-active ufw fail2ban auditd; stat -c '%y  %n' /etc/ufw/user.rules /etc/ufw/after.rules", OLD,
    '9443 LIMIT Anywhere 줄 = 출처 판정은 앱 허용 목록(G-3)이 한다 · 둘을 한 쌍으로 보여 준다')
add('G-12b', '3.1 ④', '방화벽 변경 명령 기록', G_ROOT,
    "zgrep -h -a 'COMMAND=.*ufw ' /var/log/auth.log* 2>/dev/null | sort | tail -60", OLD,
    '09/24 변경은 이 기록에 없다 → 운영 기록 대장(H-16)으로 보완')
add('G-12c', '3.1 ④', '서버 관리자 접속 이력(최근 30건)', G_ROOT, 'last -n 30 -F -i | head -34', OLD)
add('G-12d', '3.1 ①', '외부로 열린 포트', G_ROOT, "ss -tlnH | awk '{print $4}' | sort -u", OLD)
add('G-12e', '3.1 ① · 4.1 ⑤', 'DB 컨테이너가 서버 안(127.0.0.1)에만 열림', G_INVITO,
    "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'", NEW_RAW,
    '이름과 달리 bito-bench-postgres 가 운영 DB')

add('G-13a', '4.1 ⑤ · 4.2', '시스템 저널 · 웹 서버 로그 1년 보관 설정 · 가장 오래된 기록', G_ROOT,
    "grep -E '^(SystemMaxUse|MaxRetentionSec)' /etc/systemd/journald.conf; journalctl --disk-usage; journalctl --no-pager -o short-iso | head -1; "
    "grep -E '^\\s*(daily|weekly|rotate|compress)' /etc/logrotate.d/nginx", OLD, '설정일 2026-10-03 · 그 전은 08/22 이후분만 남아 있다')
add('G-13b', '2.2 ① · 4.2', '엔진 로그의 미등록 출발지 거부 줄(최근 30일 · 마지막 5줄)', G_ROOT,
    "journalctl -u bito-gateway --no-pager -o short-iso --since '30 days ago' | grep 'IP allowlist denied' | tail -5", OLD)
add('G-13c', '4.2', 'DB 서버 로그(최근 24시간 · 마지막 30줄)', G_INVITO,
    'docker logs --since 24h bito-bench-postgres 2>&1 | tail -30', NEW_RAW)

add('G-14', '4.1 ⑤', 'DB 백업 보관분 · 마지막 성공 · 실행 기록 · 감시 기록 · 경보 설정 여부', G_ROOT,
    "ls -lt /opt/bito-gateway/backups | sed -n '2,10p'; stat -c '%y  LAST_SUCCESS' /opt/bito-gateway/backups/LAST_SUCCESS; "
    "tail -10 /opt/bito-gateway/backups/cron.log; tail -6 /opt/bito-gateway/backups/monitor.log; grep -c '^ALERT_CMD=.\\+' /opt/bito-gateway/backups/.env",
    OLD, '매일 03:30 암호화 · 외부 서버 전송 · 감시 08:30')

# ───────────────────────────── 다른 시트 ─────────────────────────────
REHEARSAL = [
    ('R-1', H_ADMIN, '새 조회가 쓰는 한줄로 표 컬럼 확인', '(실행 완료 10-21)', '10개 표 · 쓰는 컬럼 전부 있음(Harold 실행 출력)'),
    ('R-2', G_INVITO, '새 조회가 쓰는 게이트웨이 표 컬럼 확인', pg(GW_PSQL, """
SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols FROM information_schema.columns
 WHERE table_name IN ('agent_account','message_request') GROUP BY table_name ORDER BY table_name;
"""), 'G-3 의 allowed_ips_reason · allowed_ips_expires_at, G-11 의 phone · callback · norm_status · report_code_raw · report_time 이 보이면 된다'),
    ('R-3', H_ADMIN, '발송 DB 접속 방식 확인(환경변수 이름만 · 값은 안 나온다)',
     "docker inspect targetup-mysql --format '{{range .Config.Env}}{{println (index (split . \"=\") 0)}}{{end}}'",
     'MYSQL_ROOT_PASSWORD 가 보이면 H-20a 를 바로 한 번 돌려 본다. 접속 거부면 내일 H-20 만 화면 공유를 멈추고 비밀번호 입력'),
    ('R-4', '-', '「명령집」 시트를 위에서부터 한 번씩', '-', '오류 난 번호만 알려 주면 그 줄만 고친다'),
]

FIND = [
    ('2.1 계정관리(발급 · 본인확인 · 발신번호 · 회선)', 'H-6 · H-7 · H-8', 'G-8'),
    ('2.2 국외 이용자(차단 · 예외 · 모든 경로)', 'H-9 · H-10 · H-11 · H-24', 'G-3 · G-4 · G-5 · G-13b'),
    ('2.3 부정사용(입금 명의 보류 · 소명)', 'H-12', '-'),
    ('3.1 방화벽(정책 · 변경 이력 · 관리자 접속)', 'H-16 · H-21', 'G-6 · G-12'),
    ('3.2 · 3.3 접근권한(등급 · 변경 · 점검)', 'H-15 · H-16', 'G-9'),
    ('3.4 다중인증', 'H-7 · H-13 · H-24', 'G-7'),
    ('3.5 추가인증(발신 인증)', 'H-14 · H-24', 'G-7'),
    ('4.1 이용자 로그', 'H-1 ~ H-7 · H-20', 'G-1 · G-2 · G-4 · G-11'),
    ('4.2 시스템 로그(관리 · 개인정보 · 서버 · DB)', 'H-5 · H-15 · H-22', 'G-1 · G-13'),
    ('4.1 ⑤ · 4.2 ⑤ 삭제 · 변조 방지 · 백업', 'H-1 · H-21e · H-22 · H-23', 'G-9 · G-12e · G-13 · G-14'),
    ('4.3 로그 점검(월 1회 · 기록 · 후속조치)', 'H-16 · H-17', 'G-10'),
    ('5.1 조치 및 결과 확인', 'H-18', '-'),
    ('5.2 금칙어', 'H-19', '-'),
    ('화면으로 보여 주기(가림이 이미 들어가 있다)', '슈퍼관리자 sys.hanjullo.com → 보안 · 인증: 감사 로그 · 국외 접근 이력 · 운영 기록 대장 · 본인인증 현황 · 로그인 차단 · 금칙어 차단 · 직원 계정 · 권한', '게이트웨이 관리 콘솔 → 감사 기록 · Agent 수정 창(허용 IP 사유 · 만료일)'),
]

QA = [
    ('한줄로 감사 기록은 언제부터', '2026-02-11부터 남아 있다. 지우는 기능이 없다.', 'H-1'),
    ('게이트웨이 감사 기록은 언제부터', '2026-06-15부터. 지우는 코드가 없다.', 'G-1'),
    ('게이트웨이 서버 접속 · 명령 수집', '07/31 16:33 ~ 09/26 22:31 이 비어 있다. 9/26 재개 뒤 연속. 9월 점검(운영 기록 대장)에 이상 · 후속 조치로 적었다.', 'G-6 · H-16'),
    ('게이트웨이 저널', '1년 보관 설정은 10/03. 그 전 기본 상한에 잘려 08/22 이전은 없다.', 'G-13a'),
    ('10월 초 게이트웨이 접속 거부 급증', '사내 시험 서버의 옛 시험 에이전트가 허용 IP 변경 뒤 옛 출발지로 재접속. 외부 공격 아님. 10/03 12:12 정지 · 재조회로 멈춘 것 확인(4.3 후속조치 사례).', 'G-4'),
    ('국외 차단은 언제부터', '탐지 2026-08-28 · 차단 2026-10-01. 막힌 것 상당수는 고객사 보안 프록시 출구 → 사유 · 승인자를 붙여 예외 등록.', 'H-9 · H-10'),
    ('회원가입 로그', '개인 · 외국인 가입 없음. 법인 계약 뒤 당사가 발급. 발급 기록은 2026-10-02부터, 그 전 계정은 생성일로 확인.', 'H-6'),
    ('9월 로그 점검', '대장이 생긴 10/03 뒤 처음 실시. 작성 10/04 서수란 · 확인 10/05 대표. 실시일을 과거로 적지 않았다.', 'H-16'),
    ('본인확인', '한국모바일인증 운영 개시 2026-10-06.', 'H-7'),
    ('구글 OTP 는 뭔가', '직원의 관리자 사이트 접속용. 고객 다중인증은 휴대폰 인증번호(H-13).', 'H-13 · H-15'),
]

HEAD_FILL = PatternFill('solid', fgColor='1F3A5F')
HEAD_FONT = Font(bold=True, color='FFFFFF')
WRAP = Alignment(wrap_text=True, vertical='top')
CMD_FONT = Font(name='Consolas', size=10)


def sheet(ws, headers, rows, widths, cmd_col=None):
    ws.append(headers)
    for c in ws[1]:
        c.fill, c.font, c.alignment = HEAD_FILL, HEAD_FONT, Alignment(vertical='center', wrap_text=True)
    for r in rows:
        ws.append(list(r))
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = WRAP
        if cmd_col:
            row[cmd_col - 1].font = CMD_FONT
    ws.freeze_panes = 'A2'


def main():
    wb = Workbook()
    ws = wb.active
    ws.title = '명령집'
    sheet(ws, ['번호', '심사 항목', '어떤 로그', '실행 위치', '명령 (칸 클릭 → Ctrl+C → 터미널에 붙여넣기 · 붙이면 바로 실행된다)', '근거', '메모'],
          ROWS, [8, 14, 34, 24, 110, 16, 40], cmd_col=5)
    sheet(wb.create_sheet('오늘 리허설'), ['번호', '실행 위치', '무엇', '명령', '보는 것'], REHEARSAL, [6, 24, 34, 110, 50], cmd_col=4)
    sheet(wb.create_sheet('항목별 찾기'), ['심사 항목', '한줄로', '게이트웨이'], FIND, [44, 60, 50])
    sheet(wb.create_sheet('물어보면 답'), ['질문이 나올 곳', '사실(10/03 · 10/05 수집 기준 · 내일 건수는 그 뒤로 늘어 있다)', '보여 줄 번호'], QA, [30, 100, 16])
    wb.save(OUT)

    # 자가 검증 — 명령 칸은 전부 한 줄 · 수식으로 읽히는 값 없음
    from openpyxl import load_workbook
    chk = load_workbook(OUT)
    n = 0
    for name, col in (('명령집', 5), ('오늘 리허설', 4)):
        for row in chk[name].iter_rows(min_row=2):
            v = row[col - 1].value or ''
            assert '\n' not in v and not str(v).startswith('='), f'{name} {row[0].value}'
            n += 1
    print(f'저장: {OUT} · 명령 칸 {n}개 · 전부 한 줄')


if __name__ == '__main__':
    sys.exit(main())
