# -*- coding: utf-8 -*-
"""
전송자격인증 재접수 — 한줄로 1005 로그 증빙 이미지(H31 · H48)만 그린다.
그리는 방식 · 가림 규칙은 make_hanjul_evidence_images.py 와 같다(그 모듈의 가림 표에 이번 고객사 · 고객 측 입금자만 더한다).
H01~H21 은 다시 그리지 않는다.

실행(저장소 루트에서): python docs/transmission-cert/resubmit-1006/evidence/make_hanjul_1005_images.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_hanjul_evidence_images as HJ  # noqa: E402  (가림 함수 연결 · 출력 폴더 설정)
import hanjul_1005_blocks as K  # noqa: E402

M = HJ.M
# 고객사 이름 · 고객 측 입금자 = 첫 글자만 남기고 같은 폭(한글 두 칸)의 별표. 당사 시험 계정 · 대표 본인 · 직원 계정은 가리지 않는다(누가 · 무엇을 시험했는지가 증빙이다).
HJ.FIXED_MASKS.update({
    '주식회사 베이컨': '주' + '*' * 13,
    '최규삼': '최****',
})
# H48 대상 계정 중 고객사 계정 · 소속을 확인하지 않은 계정 = 앞 2 · 뒤 2자리만(H01~H21 과 같은 규칙). 당사 직원 · 대표 시험 계정(ceo · suran · jihyun_admin · hoyun · psy5868)은 그대로
HJ.CUSTOMER_TOKENS = sorted(set(HJ.CUSTOMER_TOKENS) | {
    'espayment1', 'espayment2', 'espayment3', 'espayment4', 'ncitssms',
    'idlooksms', 'idlook01', 'idlookcs2', 'test001', 'invito01',
}, key=len, reverse=True)

SPECS = [
    {
        'file': 'H31_2.3-2_명의확인_처리기록.png',
        'badge': '2.3 ② · ③',
        'title': '명의 확인(입금 보류) 처리 기록 원문과 9월 건 대조',
        'target': HJ.TARGET,
        'how': '운영 DB의 감사 기록 · 입금 신청 · 잔액 원장을 읽기 전용으로 조회',
        'collected': K.COLLECTED,
        'sections': [
            ('명의 확인 처리 감사 기록 전체 (처리 일시 · 처리자 · 고객사 · 입금자 · 보류 사유 · 소명 · 결과 · 메모)', K.DEPOSIT_HOLD_RESOLVED),
            ('2번 기록 대조 1: 그 고객사의 입금 신청 (신청 · 보류 · 종결 시각)', K.DEPOSIT_HOLD_CASE_REQUEST),
            ('2번 기록 대조 2: 같은 기간 잔액 원장 (차감 제외)', K.DEPOSIT_HOLD_CASE_LEDGER),
        ],
        'note': '1번은 당사 시험 계정(입금자 = 대표 본인)으로 보류 · 소명 · 처리 기능을 점검한 건입니다. '
                '2번은 고객사 입금으로, 보류(9/18 15:35) 7분 뒤 같은 금액이 관리자 수동 충전(사유 「무통장입금」)으로 먼저 들어가 「이미 충전됨」으로 반려했습니다. '
                '이 사례 뒤 명의 확인 대기 건이 있으면 수동 충전을 시스템이 거부합니다(2026-10-05). '
                '고객사 이름 · 고객 측 입금자 이름은 첫 글자만 남기고 같은 폭의 별표로 가렸습니다.',
    },
    {
        'file': 'H48_3.4-3_인증번호_수신번호_변경기록.png',
        'badge': '3.4 ③',
        'title': '인증번호 수신 번호 등록 · 변경 기록: 일시 · 처리자 · 대상 계정 · 변경 전후',
        'target': HJ.TARGET,
        'how': '운영 DB의 감사 기록을 읽기 전용으로 조회',
        'collected': K.COLLECTED,
        'sections': [
            ('인증번호 수신 번호 등록 · 변경 기록 (최근 20건)', K.MFA_PHONE_CHANGED),
        ],
        'note': '수신 번호는 당사 관리자만 등록 · 변경하며(이용자 화면에는 변경 기능이 없음), 바꿀 때마다 처리자 · 대상 계정 · 변경 전후 번호가 감사 기록에 남습니다. '
                '번호는 기록할 때 가운데 자리를 가려 저장합니다. 빈 칸은 번호가 없는 상태입니다. '
                '해제기기는 번호를 바꾸면서 무효로 처리한 기존 인증 신뢰 수입니다.',
    },
]


def main():
    for spec in SPECS:
        path, size = M.render(spec)
        print(f'{os.path.basename(path)}  {size[0]}x{size[1]}')


if __name__ == '__main__':
    main()
