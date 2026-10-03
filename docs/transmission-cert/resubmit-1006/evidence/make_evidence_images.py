# -*- coding: utf-8 -*-
"""
전송자격인증 재접수 — 로그 증빙 이미지 생성기 (2026-10-03)

무엇을 하나
  운영 서버에서 받은 출력(gateway_1003_blocks.py · 글자 그대로)을 항목별로 한 장씩 이미지로 만든다.

지키는 것
  1. **값을 고치지 않는다.** 줄은 원문 그대로 싣는다. 표의 일부만 실을 때는 줄 단위로 고르고 「발췌」라고 적는다.
  2. **가림은 길이를 그대로 둔 채 별표로만 한다** — 고객사 식별값과 외부 주소의 끝자리. 가렸다는 사실을 이미지 아래에 적는다.
     우리 서버 주소와 시험 계정은 가리지 않는다(무엇이 무엇을 막았는지가 증빙의 내용이다).
  3. **화면 갈무리를 흉내 내지 않는다.** 이것은 「로그 원문 발췌」 문서다. 머리에 항목 · 수집 일시 · 수집 방법을 적는다.
  4. 날짜는 실제 수집 일시다.

실행(저장소 루트에서): python docs/transmission-cert/resubmit-1006/evidence/make_evidence_images.py
출력: docs/transmission-cert/resubmit-1006/evidence-images/engine/*.png
"""
import os
import re
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gateway_1003_blocks as B  # noqa: E402

OUT_DIR = os.path.join(HERE, '..', 'evidence-images', 'engine')
FONT_DIR = r'C:\Windows\Fonts'

MONO = ImageFont.truetype(os.path.join(FONT_DIR, 'consola.ttf'), 17)
MONO_KO = ImageFont.truetype(os.path.join(FONT_DIR, 'malgun.ttf'), 16)
TITLE = ImageFont.truetype(os.path.join(FONT_DIR, 'malgunbd.ttf'), 25)
BADGE = ImageFont.truetype(os.path.join(FONT_DIR, 'malgunbd.ttf'), 15)
META = ImageFont.truetype(os.path.join(FONT_DIR, 'malgun.ttf'), 15)
SECTION = ImageFont.truetype(os.path.join(FONT_DIR, 'malgunbd.ttf'), 16)

CELL_W = int(round(MONO.getlength('M')))
LINE_H = 24
MAX_COLS = 150
PAD = 36

INK = (31, 35, 40)
MUTED = (87, 96, 106)
RULE = (208, 215, 222)
PANEL = (246, 248, 250)
ACCENT = (15, 110, 86)
WHITE = (255, 255, 255)

# ── 가림 ────────────────────────────────────────────────────────────────
OWN_IP_PREFIXES = ('58.227.193.',)          # 우리 서버 — 가리지 않는다
IP_RE = re.compile(r'\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\b')

# 고객사 식별값 — 같은 길이의 별표로(앞 두 글자 · 뒤 두 글자만 남긴다)
CUSTOMER_TOKENS = ['thewc01', 'eternal01', 'eternal02', 'itensms03']
# 그 밖의 고객사 이름 조각(같은 표시 폭으로)
FIXED_MASKS = {
    '아이티앤': '아******',          # 한글 4자(8칸) → 한글 1자 + 별표 6개(8칸)
    'api-rabd-api-01': 'api-r**d-api-01',
    'rabd-api-01 API ingress': 'r**d-api-01 API ingress',
}


def mask_ip(match):
    head, tail = match.group(1), match.group(2)
    if head in OWN_IP_PREFIXES:
        return match.group(0)
    return head + '*' * len(tail)


def mask_line(line):
    line = IP_RE.sub(mask_ip, line)
    for token in CUSTOMER_TOKENS:
        line = line.replace(token, token[:2] + '*' * (len(token) - 4) + token[-2:])
    for raw, masked in FIXED_MASKS.items():
        line = line.replace(raw, masked)
    return line


# ── 글자 폭 ────────────────────────────────────────────────────────────
def cell_width(ch):
    return 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1


def display_width(text):
    return sum(cell_width(ch) for ch in text)


def wrap_line(line, max_cols):
    """긴 줄은 자르지 않고 접는다 — 이어지는 줄은 들여 쓴다."""
    if display_width(line) <= max_cols:
        return [line]
    out, cur, width = [], '', 0
    indent = '    '
    limit = max_cols
    for ch in line:
        w = cell_width(ch)
        if width + w > limit:
            out.append(cur)
            cur, width = indent, len(indent)
        cur += ch
        width += w
    if cur.strip():
        out.append(cur)
    return out


def draw_mono(draw, x, y, text, fill=INK):
    col = 0
    for ch in text:
        w = cell_width(ch)
        if ch != ' ':
            if w == 2:
                glyph_w = MONO_KO.getlength(ch)
                draw.text((x + col * CELL_W + (2 * CELL_W - glyph_w) / 2, y - 4), ch, font=MONO_KO, fill=fill)
            else:
                draw.text((x + col * CELL_W, y), ch, font=MONO, fill=fill)
        col += w


# ── 한 장 그리기 ────────────────────────────────────────────────────────
def render(spec):
    """spec = {file, badge, title, how, collected, sections:[(제목 또는 None, 원문)], note?}"""
    sections = []
    for heading, raw in spec['sections']:
        lines = []
        for line in raw.split('\n'):
            lines.extend(wrap_line(mask_line(line.rstrip()), MAX_COLS))
        sections.append((heading, lines))

    cols = max(60, max(display_width(l) for _, ls in sections for l in ls))
    body_w = cols * CELL_W + 40
    width = body_w + PAD * 2

    meta_lines = [
        f"대상: {spec.get('target', '비토 게이트웨이(발송 엔진)')}      수집: {spec['collected']}",
        f"수집 방법: {spec['how']}",
    ]
    foot_lines = [
        '운영 서버에서 조회한 출력을 그대로 옮긴 로그 원문 발췌입니다. 값은 고치지 않았습니다.',
        '고객사 식별값과 외부 주소의 끝자리는 같은 길이의 별표로 가렸습니다.',
    ]
    if spec.get('note'):
        foot_lines.insert(0, spec['note'])

    height = PAD + 34 + 14 + 40 + len(meta_lines) * 24 + 18
    for heading, lines in sections:
        if heading:
            height += 34
        height += 24 + len(lines) * LINE_H + 22
    height += 6 + len(foot_lines) * 23 + PAD

    img = Image.new('RGB', (width, height), WHITE)
    d = ImageDraw.Draw(img)
    y = PAD

    badge = spec['badge']
    bw = int(BADGE.getlength(badge)) + 22
    d.rounded_rectangle((PAD, y, PAD + bw, y + 30), radius=6, fill=ACCENT)
    d.text((PAD + 11, y + 5), badge, font=BADGE, fill=WHITE)
    y += 34 + 14
    d.text((PAD, y), spec['title'], font=TITLE, fill=INK)
    y += 40
    for line in meta_lines:
        d.text((PAD, y), line, font=META, fill=MUTED)
        y += 24
    y += 6
    d.line((PAD, y, width - PAD, y), fill=RULE, width=1)
    y += 12

    for heading, lines in sections:
        if heading:
            d.text((PAD, y + 6), heading, font=SECTION, fill=INK)
            y += 34
        box_h = 24 + len(lines) * LINE_H
        d.rounded_rectangle((PAD, y, width - PAD, y + box_h), radius=8, fill=PANEL, outline=RULE)
        ty = y + 12
        for line in lines:
            draw_mono(d, PAD + 20, ty, line)
            ty += LINE_H
        y += box_h + 22

    y += 6
    for line in foot_lines:
        d.text((PAD, y), line, font=META, fill=MUTED)
        y += 23

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, spec['file'])
    img.save(path, 'PNG', optimize=True)
    return path, img.size


SQL_HOW = '운영 DB의 감사 기록 · 접속 이력을 읽기 전용으로 조회'
SERVER_HOW = '게이트웨이 서버에서 관리자 권한으로 설정 · 로그를 읽기 전용으로 조회'
KIND_NOTE = '「기록 종류별 월별 건수」 표에서 해당 종류의 줄만 발췌했습니다(열: 종류 · 대상 · 첫 기록일 · 마지막 기록일 · 8월 · 9월 · 10월 건수).'


def kind_table(rows):
    return B.Q1_KIND_HEADER + '\n' + rows


SPECS = [
    {
        'file': 'E01_2.2-1_방화벽_정책.png',
        'badge': '2.2 ① · 3.1 ①',
        'title': '방화벽 정책: 포트별 허용 출발지와 접속 제한',
        'how': SERVER_HOW, 'collected': B.COLLECTED['S1'],
        'sections': [
            ('방화벽 상태와 정책 목록', B.UFW_STATUS),
            ('방화벽 · 침입 차단 · 감사 수집 서비스 가동 상태', B.SERVICES),
        ],
    },
    {
        'file': 'E02_2.2-1_미등록_출발지_거부.png',
        'badge': '2.2 ①',
        'title': '미등록 출발지 차단: 허용 IP를 바꾼 뒤 옛 출발지의 접속이 거부된 기록',
        'how': SQL_HOW + ' + 게이트웨이 프로세스 로그', 'collected': B.COLLECTED['Q2'] + ' · ' + B.COLLECTED['S1'],
        'sections': [
            ('① 시험 계정의 허용 IP 변경 기록 (처리 일시 · 처리자 · 대상 계정 · 바꾼 허용 IP)',
             B.Q2_ALLOWED_IP_HEADER + '\n' + B.Q2_ALLOWED_IP_TEST97),
            ('② 그 뒤 옛 출발지에서 들어온 접속의 거부 기록 (날짜 · 계정 · 출발지 · 사유 · 건수 · 처음 · 마지막)',
             B.Q2_OCT_DENIED),
            ('③ 게이트웨이 프로세스 로그: 허용 목록에 없는 출발지 거부 (최근 5일 · 마지막 세 줄과 건수)',
             B.IP_DENIED_JOURNAL),
        ],
    },
    {
        'file': 'E03_2.2-3_허용IP_변경_이력.png',
        'badge': '2.2 ③',
        'title': '허용 IP 등록 · 변경 이력: 처리 일시 · 처리자 · 대상 계정 · 바꾼 값',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q2'],
        'sections': [
            ('접속 계정의 허용 IP 변경 기록 (최근 15건)', B.Q2_ALLOWED_IP_HEADER + '\n' + B.Q2_ALLOWED_IP_CHANGES),
            ('접속 계정 변경 · 중지 · 삭제 기록 건수', kind_table(B.Q1_ROWS_ACCOUNT_CHANGE)),
        ],
        'note': KIND_NOTE,
    },
    {
        'file': 'E04_2.2-5_접속_이력.png',
        'badge': '2.2 ⑤',
        'title': '접속 이력: 발송 접속(Agent)과 연동(API) 요청을 창구별 · 결과별로 기록',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'],
        'sections': [
            ('월별 접속 이력 (월 · 창구 · 사건 · 결과 · 건수 · 출발지 수)', B.Q1_ACCESS_MONTHLY),
            ('거부된 접속 (사유별)', B.Q1_DENIED_REASONS),
        ],
    },
    {
        'file': '보류_E05_2.2-1_허용IP_지정_현황.png',
        'badge': '2.2 ①',
        'title': '접속 계정의 허용 IP 지정 현황',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'] + ' · ' + B.COLLECTED['Q2'],
        'sections': [
            ('접속 계정 수 (전체 · 사용 중 · 허용 IP 지정됨 · 허용 IP 없음)', B.Q1_ALLOWED_IP_COUNT),
            ('허용 IP가 비어 있는 사용 중 계정', B.Q2_NO_IP_ACCOUNTS),
        ],
    },
    {
        'file': 'E06_3.1-4_방화벽_변경_이력.png',
        'badge': '3.1 ④',
        'title': '방화벽 정책 변경 이력: 서버에 남은 관리자 명령 기록',
        'how': SERVER_HOW, 'collected': B.COLLECTED['S1'],
        'sections': [
            ('방화벽 명령 실행 기록 (일시 · 실행 계정 · 명령)', B.UFW_COMMAND_LOG),
            ('방화벽 정책 파일의 마지막 수정 시각', B.UFW_FILES),
        ],
    },
    {
        'file': 'E07_3.1-4_서버_접속_명령_기록.png',
        'badge': '3.1 ④',
        'title': '서버 접속 · 명령 수집 기록 (감사 기록에 적재)',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'],
        'sections': [
            ('서버 접속 · 명령 기록 (종류 · 첫 기록 · 마지막 기록 · 건수)', B.Q1_SERVER_AUDIT),
            ('월별 건수', kind_table(B.Q1_ROWS_SERVER)),
        ],
        'note': KIND_NOTE,
    },
    {
        'file': 'E08_3.1-4_관리사이트_로그인_기록.png',
        'badge': '3.1 ④',
        'title': '관리 사이트 로그인 기록: 비밀번호 확인 · 2차 인증 · 실패 · 로그아웃',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'],
        'sections': [
            ('관리자 로그인 기록 건수', kind_table(B.Q1_ROWS_ADMIN_LOGIN)),
            ('관리자 계정', B.Q1_ADMINS),
        ],
        'note': KIND_NOTE,
    },
    {
        'file': 'E09_3.1-4_서버_관리자_접속_이력.png',
        'badge': '3.1 ④',
        'title': '서버 관리자 접속 이력: 계정 · 출발지 · 접속과 종료 시각',
        'how': SERVER_HOW, 'collected': B.COLLECTED['S1'],
        'sections': [('서버 접속 이력 (최근 20건)', B.LAST_LOGINS)],
    },
    {
        'file': 'E10_3.4-6_인증수단_관리_기록.png',
        'badge': '3.4 ⑥ · 3.5 ⑤',
        'title': '발송 요청 인증수단 관리: 접속 토큰 · 설치 묶음 · 인증서 · 등록 절차의 기록',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'] + ' · ' + B.COLLECTED['Q2'],
        'sections': [
            ('인증수단 발급 · 재발급 · 회수 기록 건수', kind_table(B.Q1_ROWS_CREDENTIALS)),
            ('토큰 재발급과 계정 중지 기록 원문 (2026-09-20 이후)', B.Q2_TOKEN_EVENTS),
        ],
        'note': KIND_NOTE,
    },
    {
        'file': 'E11_3.5-5_발신번호_관리_기록.png',
        'badge': '3.5 ⑤',
        'title': '고객사 허용 발신번호 관리: 등록 · 정책 설정 기록',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'],
        'sections': [('발신번호 등록 · 정책 설정 기록 건수', kind_table(B.Q1_ROWS_SENDER_NUMBER))],
        'note': KIND_NOTE,
    },
    {
        'file': 'E12_4.1-2_계정_발급_기록.png',
        'badge': '4.1 ②',
        'title': '계정 최초 발급 기록: 고객사 등록 · 발송 계정 생성 · 접속 계정 발급',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'],
        'sections': [('발급 기록 (종류 · 대상 · 건수 · 첫 기록 · 마지막 기록)', B.Q1_ISSUED)],
    },
    {
        'file': 'E13_4.1-5_감사기록_보관_범위.png',
        'badge': '4.1 ⑤ · 4.2 ⑤',
        'title': '감사 기록 보관 범위와 조회 권한',
        'how': SQL_HOW, 'collected': B.COLLECTED['Q1'],
        'sections': [
            ('감사 기록 (가장 오래된 기록 · 가장 최근 기록 · 전체 건수)', B.Q1_RETENTION),
            ('관리자 계정 (감사 기록 조회는 admin 등급 계정만)', B.Q1_ADMINS),
        ],
    },
    {
        'file': 'E14_4.1-5_백업_기록.png',
        'badge': '4.1 ⑤ · 4.2 ⑤',
        'title': 'DB 백업: 매일 암호화 백업 · 외부 서버 전송 · 백업 감시',
        'how': SERVER_HOW, 'collected': B.COLLECTED['S1'],
        'sections': [
            ('백업 예약 (매일 03:30 백업 · 08:30 감시)', B.BACKUP_CRON),
            ('최근 백업 실행 기록', B.BACKUP_RUN_LOG),
            ('백업 감시 기록', B.BACKUP_MONITOR_LOG),
            ('백업 폴더', B.BACKUP_DIR),
        ],
    },
]


def main():
    for spec in SPECS:
        path, size = render(spec)
        print(f'{os.path.basename(path)}  {size[0]}x{size[1]}')


if __name__ == '__main__':
    main()
