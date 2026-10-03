# -*- coding: utf-8 -*-
"""
전송자격인증 재접수 — 한줄로 로그 증빙 이미지 생성기 (2026-10-03)

그리는 방식 · 원칙은 make_evidence_images.py(엔진)와 같다 — 그 파일의 render 를 그대로 쓴다.
  1. 값을 고치지 않는다(hanjul_1003_blocks.py = 받은 출력 글자 그대로).
  2. 가림은 같은 표시 폭의 별표로만 — 고객사 계정 · 회사 이름 · 내부 식별번호(UUID) · 외부 주소 끝자리.
     우리 직원 계정(ceo · suran · hoyun · psy5868 · eunji_admin · jihyun_admin)은 가리지 않는다(누가 처리했는지가 증빙이다).
  3. 모바일 본인인증 연동 뒤 다시 조회할 항목(3.4 ② · ③ · 3.5 ② · 번호 등록 현황)은 만들지 않는다.

실행(저장소 루트에서): python docs/transmission-cert/resubmit-1006/evidence/make_hanjul_evidence_images.py
출력: docs/transmission-cert/resubmit-1006/evidence-images/hanjul/*.png
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_evidence_images as M  # noqa: E402
import hanjul_1003_blocks as H  # noqa: E402

M.OUT_DIR = os.path.join(HERE, '..', 'evidence-images', 'hanjul')
M.MAX_COLS = 340   # 예외 대장 · 감사 기록 상세가 넓다(한글 사유 포함 약 300칸) — 표 줄을 접지 않는다

# 고객사 계정 — 긴 것부터 바꾼다(앞부분이 같은 계정이 서로를 깨지 않게)
CUSTOMER_TOKENS = sorted([
    'lululemon44117', 'shadmin', 'gwss', 'laprairie01', 'lpcom', 'toun28', 'shiseido7',
    'dp26', 'soongsil', 'ACEMKT', 'louisquatorze1', 'jessinewyork01', 'dp76', 'woorim',
    'sgbaek', 'bhappy4', 'keli', 'espayment01', 'isae',
], key=len, reverse=True)
# 회사 이름 — 한글 한 자 = 두 칸. 첫 글자만 남기고 같은 폭의 별표로
FIXED_MASKS = {
    '이새에프앤씨': '이**********',
    '이새에프엔씨': '이**********',
    '한국시세이도': '한**********',
}
UUID_RE = re.compile(r'\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b')


def mask_token(token):
    if len(token) <= 4:
        return token[0] + '*' * (len(token) - 1)
    return token[:2] + '*' * (len(token) - 4) + token[-2:]


def mask_ip_hanjul(match):
    # 루프백(127.x) · 전체 주소(0.0.0.0)는 고객 식별값이 아니라 「서버 내부 전용 · 모든 주소에서 듣는다」는 사실 자체다 — 가리지 않는다
    head = match.group(1)
    if head.startswith('127.') or head == '0.0.0.':
        return match.group(0)
    return M.mask_ip(match)


def mask_line(line):
    line = M.IP_RE.sub(mask_ip_hanjul, line)
    line = UUID_RE.sub(lambda m: m.group(1) + '-****-****-****-************', line)
    for token in CUSTOMER_TOKENS:
        line = line.replace(token, mask_token(token))
    for raw, masked in FIXED_MASKS.items():
        line = line.replace(raw, masked)
    return line


M.mask_line = mask_line

TARGET = '한줄로(hanjul.ai)'
SQL_HOW = '운영 DB의 감사 기록 · 예외 대장을 읽기 전용으로 조회'
UUID_NOTE = '내부 식별번호(UUID)는 앞 8자리만 남기고 같은 길이의 별표로 가렸습니다.'
KIND_NOTE = '「기록 종류별 월별 건수」 전체 표입니다(열: 기록 종류 · 첫 기록일 · 7월 · 8월 · 9월 · 10월 건수 · 10월은 3일 09:47까지).'
SERVER_HOW = '한줄로 서버 확인 스크립트 실행 출력(읽기 전용 · 방화벽 구간은 root)'

SPECS = [
    {
        'file': 'H01_2.2-1_국외IP_차단.png',
        'badge': '2.2 ① · ④',
        'title': '국외 IP 차단: 국내 대역 적재 · 날짜별 감지와 차단 · 차단 기록 원문',
        'sections': [
            ('국내 IP 대역 적재 현황 (국가 · 출처 · 대역 수 · 마지막 갱신)', H.GEO_CIDRS),
            ('국외 출발지 접속: 날짜별 감지(차단 전 · 기록만) · 차단 건수 (9월 이후)', H.GEO_DAILY),
            ('국외 출발지 접속 차단 기록 원문 (일시 · 종류 · 계정 · 출발지 · 상세)', H.GEO_BLOCKED_RAW),
        ],
    },
    {
        'file': 'H02_2.2-3_허용IP_예외_대장과_이력.png',
        'badge': '2.2 ③ · ④',
        'title': '허용 IP(예외) 대장과 등록 이력: 사유 · 승인자 · 승인 일시 · 허용 만료 · 유효',
        'sections': [
            ('예외 대장 (등록 일시 · 범위 · 고객사 · 계정 · 허용 대역 · 사유 · 승인자 · 승인 일시 · 허용 만료 · 유효)', H.EXCEPTIONS),
            ('국내 대역 교체 · 예외 허용 감사 기록 (일시 · 종류 · 처리자 · 상세)', H.EXCEPTION_AUDIT),
        ],
        'note': UUID_NOTE,
    },
    {
        # ★1003 보류 해제 — 등록 범위를 바로잡은 고객사 1곳의 재확인 결과를 함께 싣는다
        'file': 'H03_2.2-5_연동경로_출발지_대조.png',
        'badge': '2.2 ⑤',
        'title': '연동 경로(API · 싱크에이전트) 출발지 대조: 월별 기록과 등록 뒤 재확인',
        'collected': H.COLLECTED + ' · ' + H.ISAE_RECHECK_COLLECTED,
        'sections': [
            ('등록되지 않은 출발지에서 온 연동 호출: 월별 (월 · 종류 · 경로 · 등록 여부 · 건수 · 고객사 수 · 출발지 수)', H.MACHINE),
            ('출발지를 회사 에이전트 범위로 다시 등록(10/03 10:00:37)한 고객사: 그날 미등록 출발지 기록 (종류 · 상세 · 출발지 · 시각)', H.ISAE_RECHECK_DETECTED),
            ('같은 고객사 싱크에이전트: 마지막 하트비트 · 마지막 동기화 (등록 뒤에도 연동이 계속됨)', H.ISAE_RECHECK_AGENT),
        ],
        'note': '마지막 미등록 기록은 등록 직전(10:00:16)입니다. 이 기록은 같은 출발지를 1시간에 한 번만 남기며, 등록 뒤 11:00 하트비트 · 11:30 동기화 호출에서는 미등록 기록이 생기지 않았습니다(그 사이 서버 프로세스 재기동 없음).',
    },
    {
        'file': 'H04_3.4-1_다중인증_기록.png',
        'badge': '3.4 ①',
        'title': '다중인증(로그인 인증번호): 월별 요청 · 성공 · 실패 · 잠김과 기록 원문',
        'sections': [
            ('월별 다중인증 (요청 · 성공 · 실패 · 잠김 · 인증한 계정 수)', H.MFA_MONTHLY),
            ('다중인증 기록 원문 (최근 20건 · 일시 · 종류 · 계정 · 출발지)', H.MFA_RAW),
        ],
    },
    {
        'file': 'H05_3.5-1_발신인증_기록.png',
        'badge': '3.5 ①',
        'title': '추가 인증(발신 인증): 월별 요청 · 성공과 기록 원문',
        'sections': [
            ('월별 발신 인증 (요청 · 성공 · 인증한 계정 수)', H.SENDER_AUTH_MONTHLY),
            ('발신 인증 기록 원문 (최근 20건 · 일시 · 종류 · 계정 · 출발지)', H.SENDER_AUTH_RAW),
        ],
    },
    {
        'file': 'H06_4.1-2_계정_발급_기록.png',
        'badge': '4.1 ②',
        'title': '회원가입(계정 발급) 기록: 발급자 · 대상 계정 · 고객사',
        'sections': [
            ('계정 발급 기록 (일시 · 종류 · 발급자 · 상세)', H.ISSUED),
            ('계정 생성일 기준 월별 발급 수 (발급 기록 도입 전 계정의 근거)', H.ACCOUNT_MONTHLY),
        ],
        'note': UUID_NOTE,
    },
    {
        'file': 'H07_4.1-5_감사기록_보관_범위.png',
        'badge': '4.1 ⑤ · 4.2 ⑤',
        'title': '감사 기록 보관 범위: 가장 오래된 기록부터 지금까지 전량 보관',
        'sections': [
            ('감사 기록 (가장 오래된 기록 · 가장 최근 기록 · 전체 건수)', H.RETENTION),
            ('월별 건수', H.RETENTION_MONTHLY),
        ],
    },
    {
        'file': 'H08_4.1_기록_종류별_월별_건수.png',
        'badge': '4.1 · 4.2',
        'title': '감사 기록 종류: 어떤 행위가 언제부터 기록되는가',
        'sections': [('기록 종류별 첫 기록일과 월별 건수 (2026-07 이후)', H.KINDS)],
        'note': KIND_NOTE,
    },
    {
        'file': 'H10_2.2-2_예외_승인_통과_기록.png',
        'badge': '2.2 ② · ③',
        'title': '예외 승인 통과 기록: 차단 시행 뒤 예외 대역으로 들어온 접속',
        'collected': H.EXEMPT_PASS_COLLECTED,
        'sections': [
            ('차단 시행 뒤 국외 판정 접속 중 통과한 기록 전부 (일시 · 계정 · 출발지 · 예외 승인 통과 · 예외 조회 실패)', H.EXEMPT_PASS),
        ],
        'note': '2026-10-02 등록한 예외(계정 범위 · 사유 · 승인자 기록)로 통과한 접속입니다. 예외 조회 실패로 통과한 건은 없습니다.',
    },
    {
        'file': 'H09_4.3_월간_로그_점검_자료.png',
        'badge': '4.3',
        'title': '월간 로그 점검 자료: 9월 · 10월 로그인 · 차단 · 제한 · 대량 처리',
        'sections': [
            ('점검 대상 월별 집계 (10월은 3일 09:47까지)', H.REVIEW_MONTHLY),
            ('로그인 실패가 몰린 계정 (월별 상위 10 · 5회 이상)', H.REVIEW_FAIL_TOP),
            ('차단 · 잠김 · 제한 · 대량 처리 기록 원문 (9월 이후)', H.REVIEW_BLOCK_RAW),
        ],
    },
    # ── 수집 B(서버 확인 스크립트) — 2026-10-03 추가 ──
    {
        'file': 'H11_3.1-1_방화벽_정책.png',
        'badge': '3.1 ① · ④',
        'title': '방화벽: 정책 · 외부로 열린 포트 · 정책 변경 명령 기록',
        'how': SERVER_HOW,
        'collected': H.SERVER_COLLECTED,
        'sections': [
            ('방화벽 상태와 정책 · 서비스 가동 · 정책 파일 마지막 수정 (root)', H.SERVER_FW),
            ('외부로 열린 포트 (듣고 있는 주소)', H.SERVER_PORTS),
            ('서버 저널에 남은 방화벽 명령 (최근 400일 · 실행 계정 · 일시 · 명령)', H.SERVER_FW_CMDS),
        ],
        'note': '3000 · 9001~9011 은 방화벽에서 명시 차단, 3001 · 23388 은 허용 목록에 없어 기본 차단입니다. 데이터베이스(5432 · 3306 · 6379)는 서버 내부 주소(127.0.0.1)에만 열려 있습니다.',
    },
    {
        'file': 'H12_3.1-4_서버_관리자_접속_이력.png',
        'badge': '3.1 ④',
        'title': '서버 관리자 접속 이력: 계정 · 출발지 · 접속과 종료 시각',
        'how': SERVER_HOW,
        'collected': H.SERVER_COLLECTED,
        'sections': [('서버 관리자 접속 이력 (최근 30건)', H.SERVER_ADMIN_LOGIN)],
    },
    {
        'file': 'H13_4.2-5_서버로그_보관_설정.png',
        'badge': '4.1 ⑤ · 4.2 ⑤',
        'title': '서버 로그 1년 보관 설정과 로그 폴더 접근 권한',
        'how': SERVER_HOW,
        'collected': H.SERVER_COLLECTED,
        'sections': [
            ('로그 보관 설정 (앱 로그 · 웹 서버 로그 · 시스템 저널)', H.SERVER_LOG_RETENTION),
            ('로그 폴더 접근 권한 · 데이터베이스 내부 전용', H.SERVER_LOG_PERMS),
        ],
    },
    {
        'file': 'H14_4.1-5_백업_실행과_감시.png',
        'badge': '4.1 ⑤ · 4.2 ⑤',
        'title': '백업: 매일 암호화 · 외부 서버 전송 · 감시와 실패 경보',
        'how': '한줄로 서버 확인 명령 실행 출력(읽기 전용 · root)',
        'collected': H.SERVER_BACKUP2_COLLECTED,
        'sections': [
            ('백업 예약 · 최근 실행 기록 · 서버에 남은 백업 · 마지막 성공 표식', H.SERVER_BACKUP2),
            ('백업 감시 예약 · 감시 기록 · 경보 보낼 곳 설정 여부', H.SERVER_BACKUP_MONITOR2),
            ('백업 · 감시 스크립트에서 경보를 보내는 줄 (백업 실패 · 중간 중단 · 26시간 넘게 성공 없음)', H.SERVER_ALERT_HOOKS),
            ('경보 보낼 곳 설정 직후 시험 발송 (2026-10-03 12:08)', H.SERVER_ALERT_TEST),
        ],
        'note': '경보는 담당자 휴대폰 문자로 갑니다. 12:08 시험 문자는 담당자 휴대폰에서 수신을 확인했습니다.',
    },
    {
        'file': 'H16_4.1_발송_기록_보관.png',
        'badge': '1.1 · 4.1',
        'title': '발송 기록 보관: 월별 문자 발송 기록 (2026년 2월분부터)',
        'how': '운영 발송 데이터베이스의 월별 발송 기록 표 목록과 행 수를 읽기 전용으로 조회',
        'collected': H.SEND_LOG_COLLECTED,
        'sections': [
            ('월별 발송 기록 표 (가장 오래된 달 · 가장 최근 달 · 표 수)', H.SEND_LOG_RANGE),
            ('달마다 남아 있는 발송 기록 (표 수 · 행 수)', H.SEND_LOG_MONTHS),
        ],
        'note': '이 표는 발송 회선(11개)마다 한 달에 하나씩 쌓이며, 2026년 2월분부터 지운 달이 없습니다. 행 수는 데이터베이스 통계의 추정값입니다.',
    },
]


def main():
    for spec in SPECS:
        spec.setdefault('target', TARGET)
        spec.setdefault('how', SQL_HOW)
        spec.setdefault('collected', H.COLLECTED)
        path, size = M.render(spec)
        print(f'{os.path.basename(path)}  {size[0]}x{size[1]}')


if __name__ == '__main__':
    main()
