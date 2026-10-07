# -*- coding: utf-8 -*-
"""
전송자격인증 재접수 — 한줄로 1007 로그 증빙 이미지(H49 · H50 · H51 = 본인확인기관 연동 뒤 3.4 ② · ③ · 3.5 ②)만 그린다.
그리는 방식 · 가림 규칙은 make_hanjul_evidence_images.py 와 같다. 이번에 더하는 가림 = 요청번호(인증 건 번호 32자) 앞 8자리만.
계정은 모두 당사 직원 계정이라 가리지 않는다(1003 표에 고객사로 올라 있던 sgbaek 은 당사 직원 계정 · Harold 1006).

실행(저장소 루트에서): python docs/transmission-cert/resubmit-1006/evidence/make_hanjul_1007_images.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_hanjul_evidence_images as HJ  # noqa: E402  (가림 함수 연결 · 출력 폴더 설정)
import hanjul_1007_blocks as K  # noqa: E402

M = HJ.M
HJ.CUSTOMER_TOKENS = [t for t in HJ.CUSTOMER_TOKENS if t != 'sgbaek']
REQ_RE = re.compile(r'\b([0-9a-f]{8})[0-9a-f]{24}\b')
_base_mask = HJ.mask_line


def mask_line(line):
    return REQ_RE.sub(lambda m: m.group(1) + '*' * 24, _base_mask(line))


M.mask_line = mask_line

COMMON = '계정은 모두 당사 직원 계정입니다. 이름은 첫 글자만, 휴대폰 번호는 가운데 자리를 가려 조회했고, 요청번호는 앞 8자리만 · 접속 IP 는 끝자리를 가렸습니다.'

SPECS = [
    {
        'file': 'H49_3.4-2_본인확인기관_인증이력.png',
        'badge': '3.4 ②',
        'title': '본인확인기관(한국모바일인증) 인증 이력: 계정 · 구분 · 상태 · 인증 이름 · 번호 · 요청번호',
        'target': HJ.TARGET,
        'how': '운영 DB의 본인인증 이력을 읽기 전용으로 조회',
        'collected': K.COLLECTED,
        'sections': [
            ('본인인증 이력 전체 (2026-10-06 운영 개시 이후 전부)', K.IDENTITY_HISTORY),
        ],
        'note': '담당자가 본인확인기관 인증을 마치면 확인된 이름 · 휴대폰 번호가 이 이력에 남고, 그 번호가 계정의 인증번호 수신 번호가 됩니다(H50). '
                '요청번호는 본인확인기관에 보낸 요청번호와 같은 값입니다. 「다시 시작」은 인증 창을 다시 연 경우, 「중단」은 인증 창을 닫아 끝내지 않은 경우입니다. '
                '중복확인값 「있음」은 본인확인기관이 주는 중복가입 확인값을 원문 없이 해시로 저장했다는 표시입니다. ' + COMMON,
    },
    {
        'file': 'H50_3.4-2_3.5-2_인증번호_수신번호_본인확인연계.png',
        'badge': '3.4 ② · 3.5 ②',
        'title': '계정별 인증번호 수신 번호 = 본인확인으로 확인된 번호',
        'target': HJ.TARGET,
        'how': '운영 DB의 계정 정보와 본인인증 이력을 읽기 전용으로 조회',
        'collected': K.COLLECTED,
        'sections': [
            ('본인확인 운영 계정별 현재 상태 (인증번호 수신 번호 · 마지막 본인인증 · 대조 결과)', K.ACCOUNT_STATE),
        ],
        'note': '로그인 인증번호와 발신 인증번호는 모두 이 수신 번호로 보냅니다. 「일치」는 계정의 연락처와 인증번호 수신 번호가 마지막 본인확인 번호와 같다는 뜻이며, '
                '가리기 전 번호끼리 서버에서 대조했습니다. 이용자 화면에는 번호를 직접 입력하거나 바꾸는 칸이 없습니다. ' + COMMON,
    },
    {
        'file': 'H51_3.4-3_본인인증_등록변경_감사기록.png',
        'badge': '3.4 ③',
        'title': '본인인증으로 수신 번호를 등록 · 변경한 감사 기록: 일시 · 계정 · 변경 전후 번호 · 요청번호',
        'target': HJ.TARGET,
        'how': '운영 DB의 감사 기록을 읽기 전용으로 조회',
        'collected': K.COLLECTED,
        'sections': [
            ('본인인증 시작 · 완료 · 실패 감사 기록 전체', K.IDENTITY_AUDIT),
        ],
        'note': '처음 등록과 담당자 번호 변경 모두 본인확인기관 인증을 거쳐야 하며, 시작 · 완료 · 실패가 감사 기록에 남습니다. 이 기간 실패 기록은 0건입니다. '
                '2026-10-06 21:42 ~ 21:44 다섯 줄에 요청번호가 없는 것은 감사 기록에 요청번호를 함께 남기도록 고치기(같은 날 밤) 전 기록이기 때문입니다. ' + COMMON,
    },
]


def main():
    for spec in SPECS:
        path, size = M.render(spec)
        print(f'{os.path.basename(path)}  {size[0]}x{size[1]}')


if __name__ == '__main__':
    main()
