/**
 * Sync Agent v1.5.0 설치 매뉴얼 생성 스크립트
 * 출력: SyncAgent_설치매뉴얼_v1_5.docx
 *
 * ⚠️ 설계 원칙 (Harold님 지시):
 *   - 내부 기술 스택(AI 모델명, 폴백 체인, 프롬프트 캐싱 등) 노출 금지
 *   - 서버 DB 스키마(테이블명, 컬럼명, 내부 식별자, API 엔드포인트) 노출 금지
 *   - 사용자가 Agent를 설치/운영하는 데 필요한 정보만 포함
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require('docx');

const FONT_BODY = '맑은 고딕';
const FONT_HEAD = '맑은 고딕';
const FONT_CODE = 'Consolas';

const COLOR_HEAD = '1F4E79';
const COLOR_SUBHEAD = '2E75B6';
const COLOR_WARN_BG = 'FFF4E5';
const COLOR_WARN_BORDER = 'F59E0B';
const COLOR_INFO_BG = 'EFF6FF';
const COLOR_INFO_BORDER = '3B82F6';
const COLOR_CODE_BG = 'F3F4F6';
const COLOR_TABLE_HEAD_BG = 'E5E7EB';
const COLOR_BORDER = 'CBD5E1';

const border = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER };
const borders = { top: border, bottom: border, left: border, right: border };

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 320 },
    children: [new TextRun({ text, font: FONT_BODY, size: 22, ...opts })],
  });
}

function h1Page(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, font: FONT_HEAD, size: 36, bold: true, color: COLOR_HEAD })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
    children: [new TextRun({ text, font: FONT_HEAD, size: 28, bold: true, color: COLOR_SUBHEAD })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: FONT_HEAD, size: 24, bold: true, color: '374151' })],
  });
}

function code(text) {
  const lines = text.split('\n');
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: COLOR_CODE_BG, type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: lines.map(line => new Paragraph({
              spacing: { after: 0, line: 280 },
              children: [new TextRun({ text: line || ' ', font: FONT_CODE, size: 20 })],
            })),
          }),
        ],
      }),
    ],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80, line: 320 },
    children: [new TextRun({ text, font: FONT_BODY, size: 22 })],
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    spacing: { after: 80, line: 320 },
    children: [new TextRun({ text, font: FONT_BODY, size: 22 })],
  });
}

function noticeBox(type, text) {
  const bg = type === 'warn' ? COLOR_WARN_BG : COLOR_INFO_BG;
  const icon = type === 'warn' ? '⚠️ ' : (type === 'success' ? '✅ ' : 'ℹ️ ');
  const borderColor = type === 'warn' ? COLOR_WARN_BORDER : COLOR_INFO_BORDER;
  const noticeBorder = { style: BorderStyle.SINGLE, size: 12, color: borderColor };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: { top: border, bottom: border, right: border, left: noticeBorder },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 180, right: 180 },
            children: [new Paragraph({
              spacing: { after: 0, line: 320 },
              children: [new TextRun({ text: icon + text, font: FONT_BODY, size: 22 })],
            })],
          }),
        ],
      }),
    ],
  });
}

function makeTable(columnWidths, headerRow, bodyRows) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerRow.map((text, i) => new TableCell({
          borders,
          width: { size: columnWidths[i], type: WidthType.DXA },
          shading: { fill: COLOR_TABLE_HEAD_BG, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            spacing: { after: 0 },
            children: [new TextRun({ text, font: FONT_HEAD, size: 22, bold: true })],
          })],
        })),
      }),
      ...bodyRows.map(row => new TableRow({
        children: row.map((cellContent, i) => new TableCell({
          borders,
          width: { size: columnWidths[i], type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: Array.isArray(cellContent) ? cellContent : [new Paragraph({
            spacing: { after: 0 },
            children: [new TextRun({ text: String(cellContent), font: FONT_BODY, size: 22 })],
          })],
        })),
      })),
    ],
  });
}

function hSpacer(lines = 1) {
  const arr = [];
  for (let i = 0; i < lines; i++) {
    arr.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: '', size: 22 })] }));
  }
  return arr;
}

// ─── 표지 ────────────────────────────────────
const coverPage = [
  ...hSpacer(6),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Sync Agent', font: FONT_HEAD, size: 96, bold: true, color: COLOR_HEAD })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: '설치 및 설정 매뉴얼', font: FONT_HEAD, size: 52, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: '한줄로 데이터 동기화 에이전트', font: FONT_BODY, size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 1400 },
    children: [new TextRun({ text: 'Windows / Linux 듀얼 지원', font: FONT_BODY, size: 28, italics: true })],
  }),
  ...hSpacer(10),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'INVITO (인비토)', font: FONT_HEAD, size: 32, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: '버전 1.5.0 | 2026년 4월', font: FONT_BODY, size: 24, color: '4B5563' })],
  }),
];

// ─── 1. 개요 ──────────────────────────────────
const ch1 = [
  h1Page('1. 개요'),
  body('Sync Agent는 고객사 로컬 DB(POS, ERP, CRM 등)의 고객 및 구매 데이터를 한줄로로 자동 동기화하는 에이전트입니다. 설치 후 별도의 작업 없이 자동으로 데이터가 동기화되며, 한줄로 관리자 페이지에서 상태를 확인할 수 있습니다.'),
  body('고객 테이블의 컬럼을 한 번의 클릭으로 한줄로 표준 필드에 자동 매핑하는 기능을 제공하여, 설치 시간을 크게 단축시켰습니다.'),

  h2('1.1 시스템 요구사항'),
  makeTable([2000, 3600, 3760],
    ['항목', 'Windows', 'Linux'],
    [
      ['OS', 'Windows 10/11, Server 2016+', 'Ubuntu 20.04+, CentOS 7+, RHEL 7+, Debian 10+'],
      ['CPU', 'x64 (64비트)', 'x64 (64비트)'],
      ['메모리', '512MB 이상', '512MB 이상'],
      ['디스크', '200MB 이상', '200MB 이상'],
      ['네트워크', 'HTTPS(443) 아웃바운드 허용', 'HTTPS(443) 아웃바운드 허용'],
      ['권한', '관리자 권한 (서비스 설치 시)', 'root 권한 (서비스 설치 시)'],
    ]
  ),

  h2('1.2 지원 데이터베이스'),
  makeTable([2200, 1400, 5760],
    ['DB', '기본 포트', '비고'],
    [
      ['MSSQL', '1433', '한국 POS/ERP 주력'],
      ['MySQL / MariaDB', '3306', '중소형 시스템'],
      ['Oracle', '1521', '대기업/공공'],
      ['PostgreSQL', '5432', '최신 시스템'],
      ['Excel / CSV', '—', '파일 기반 업로드'],
    ]
  ),
];

// ─── 2. 사전 준비 ──────────────────────────────
const ch2 = [
  h1Page('2. 사전 준비'),

  h2('2.1 한줄로 접속 정보 발급'),
  body('설치 전 한줄로 담당자에게 아래 정보를 요청하세요:'),
  bullet('API Key — Agent 인증용 키'),
  bullet('API Secret — Agent 인증용 시크릿'),
  bullet('서버 URL — 한줄로 서버 주소'),
  ...hSpacer(),
  noticeBox('warn', 'API Key/Secret은 고객사별로 고유하며 외부 유출 시 데이터 변조 위험이 있습니다. 관리자 외 타인에게 공유하지 마세요.'),

  h2('2.2 고객사 DB 읽기 전용 계정 생성'),
  body('Sync Agent는 고객사 DB에 읽기(SELECT) 전용으로 접속합니다. 보안을 위해 전용 읽기 계정을 생성해주세요.'),

  h3('MSSQL'),
  code(`CREATE LOGIN sync_reader WITH PASSWORD = 'secure_password';
USE [고객DB];
CREATE USER sync_reader FOR LOGIN sync_reader;
GRANT SELECT ON [고객테이블] TO sync_reader;
GRANT SELECT ON [구매테이블] TO sync_reader;`),
  ...hSpacer(),

  h3('MySQL / MariaDB'),
  code(`CREATE USER 'sync_reader'@'localhost' IDENTIFIED BY 'secure_password';
GRANT SELECT ON 고객DB.고객테이블 TO 'sync_reader'@'localhost';
GRANT SELECT ON 고객DB.구매테이블 TO 'sync_reader'@'localhost';
FLUSH PRIVILEGES;`),
  ...hSpacer(),

  h3('Oracle'),
  code(`CREATE USER sync_reader IDENTIFIED BY secure_password;
GRANT CONNECT TO sync_reader;
GRANT SELECT ON 스키마.고객테이블 TO sync_reader;
GRANT SELECT ON 스키마.구매테이블 TO sync_reader;`),
  ...hSpacer(),

  h3('PostgreSQL'),
  code(`CREATE ROLE sync_reader WITH LOGIN PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE 고객db TO sync_reader;
GRANT USAGE ON SCHEMA public TO sync_reader;
GRANT SELECT ON 고객테이블, 구매테이블 TO sync_reader;`),

  h2('2.3 방화벽 확인'),
  body('Agent가 접속해야 하는 네트워크 경로를 확인하세요:'),
  makeTable([2400, 2400, 2400, 2160],
    ['출발', '도착', '포트', '프로토콜'],
    [
      ['Agent 서버', '한줄로 서버', '443', 'HTTPS (아웃바운드)'],
      ['Agent 서버', '고객사 DB', 'DB 포트', 'TCP (인바운드)'],
    ]
  ),
];

// ─── 3. Windows 설치 ──────────────────────────
const ch3 = [
  h1Page('3. Windows 설치'),

  h2('3.1 설치 파일 다운로드'),
  body('담당자에게 전달받은 설치 파일을 준비합니다:'),
  bullet('SyncAgent-Setup-1.5.0.exe (약 20MB)'),

  h2('3.2 설치 프로그램 실행'),
  body('SyncAgent-Setup-1.5.0.exe를 더블클릭하여 실행합니다. 설치 경로를 선택하고(기본: C:\\Program Files\\SyncAgent), "설치" 버튼을 클릭합니다.'),
  body('설치 옵션에서 "Windows 서비스로 등록" 체크박스를 선택하면 부팅 시 자동 시작됩니다.'),

  h2('3.3 설치 마법사 (초기 설정)'),
  body('설치 완료 후 설치 마법사가 자동으로 실행됩니다. 또는 수동으로 실행할 수 있습니다:'),
  code('sync-agent.exe --setup'),
  ...hSpacer(),
  body('브라우저에서 http://localhost:9876 이 자동으로 열리며, 5단계 위저드를 따라 설정합니다:'),

  h3('Step 1: API 연결'),
  body('한줄로 서버 URL, API Key, API Secret을 입력하고 "연결 테스트" 버튼으로 확인합니다.'),

  h3('Step 2: DB 설정'),
  body('고객사 DB 접속 정보를 입력합니다(DB 타입, 호스트, 포트, DB명, 사용자, 비밀번호). "접속 테스트" 버튼으로 연결을 확인합니다.'),

  h3('Step 3: 테이블 선택'),
  body('DB 접속 성공 시 테이블 목록이 자동으로 표시됩니다. 고객 테이블과 구매 테이블을 선택합니다. 이후 각 테이블별로 증분 동기화에 사용할 수정일시(timestamp) 컬럼을 지정합니다. 자동 감지된 컬럼이 표시되며, 필요 시 수동으로 변경할 수 있습니다.'),

  h3('Step 4: 컬럼 매핑'),
  body('고객사 DB의 컬럼명을 한줄로 표준 필드에 매핑합니다.'),
  noticeBox('info', '[AI 자동 매핑 실행] 버튼을 클릭하면, 한줄로 서버가 컬럼명을 분석하여 적절한 표준 필드에 자동으로 매핑해줍니다. 결과는 매핑 테이블에 자동으로 채워지며, 필요 시 수동으로 수정할 수 있습니다.'),
  ...hSpacer(),
  body('표준 필드에 매핑되지 않은 컬럼은 커스텀 필드 슬롯(custom_1~custom_15)에 자동 배정되며, 라벨을 지정할 수 있습니다.'),
  noticeBox('warn', 'phone(전화번호) 필드 매핑은 필수입니다. 매핑되지 않으면 동기화가 불가합니다.'),
  noticeBox('info', 'AI 자동 매핑 시 컬럼명 목록만 서버로 전송되며, 실제 고객 데이터(이름·전화번호 등의 샘플 값)는 외부로 전송되지 않습니다.'),

  h3('Step 5: 동기화 설정'),
  body('Agent 이름 등 기본 설정을 확인합니다. 동기화 주기(고객 6시간, 구매 6시간, Heartbeat 1시간)는 표준 값으로 자동 설정되며, 변경이 필요한 경우 한줄로 담당자에게 요청하시면 됩니다.'),
  noticeBox('info', '설정 완료 시 config.enc 파일이 AES-256-GCM으로 암호화 저장됩니다.'),

  h2('3.4 Windows 서비스 등록'),
  body('관리자 권한의 PowerShell에서 실행합니다:'),
  code('sync-agent.exe --install-service'),
  ...hSpacer(),
  body('서비스가 등록되면 PC 부팅 시 자동으로 Sync Agent가 시작됩니다. 실패 시 60초 후 자동 재시작(최대 3회).'),

  h3('서비스 관리 명령'),
  makeTable([4000, 5360],
    ['명령', '설명'],
    [
      ['sync-agent --service-status', '서비스 상태 확인'],
      ['sc start SyncAgent', '서비스 시작'],
      ['sc stop SyncAgent', '서비스 중지'],
      ['sync-agent --uninstall-service', '서비스 제거 (관리자 권한)'],
    ]
  ),
];

// ─── 4. Linux 설치 ────────────────────────────
const ch4 = [
  h1Page('4. Linux 설치'),

  h2('4.1 바이너리 배포'),
  body('담당자에게 전달받은 바이너리 파일을 서버에 업로드합니다:'),
  code(`# 바이너리를 /opt/sync-agent/ 디렉토리에 배치
sudo mkdir -p /opt/sync-agent
sudo cp sync-agent /opt/sync-agent/
sudo chmod 755 /opt/sync-agent/sync-agent

# 필요 디렉토리 생성
sudo mkdir -p /opt/sync-agent/{data,logs,temp}`),
  ...hSpacer(),
  body('또는 배포 tarball을 사용할 수 있습니다:'),
  code(`tar -xzf SyncAgent-1.5.0-linux-x64.tar.gz
cd sync-agent-1.5.0-linux-x64
sudo bash install.sh`),

  h2('4.2 설치 마법사 (초기 설정)'),
  body('Linux에서는 터미널 기반 CLI 설치 마법사가 자동으로 실행됩니다. 브라우저나 포트 개방이 필요 없습니다:'),
  code(`cd /opt/sync-agent
sudo ./sync-agent --setup
# 또는 CLI 강제 실행
sudo ./sync-agent --setup-cli`),
  ...hSpacer(),
  body('터미널에서 대화형으로 5단계 설정을 진행합니다:'),

  h3('Step 1: API 연결'),
  body('한줄로 서버 URL, API Key, API Secret을 입력합니다.'),

  h3('Step 2: DB 접속 설정'),
  body('DB 종류를 번호로 선택한 후 호스트, 포트, DB명, 사용자, 비밀번호를 입력합니다. 입력 완료 후 자동으로 접속 테스트가 수행됩니다. 실패 시 재입력할 수 있습니다.'),

  h3('Step 3: 테이블 선택'),
  body('DB 접속 후 테이블 목록이 번호와 함께 표시됩니다. 고객 테이블과 구매 테이블을 각각 번호로 선택합니다. 이후 각 테이블별로 증분 동기화 기준이 되는 수정일시(timestamp) 컬럼을 지정합니다.'),

  h3('Step 4: 컬럼 매핑'),
  body('컬럼 매핑 시작 시 다음 질문이 표시됩니다:'),
  code('? AI 자동 매핑을 사용하시겠습니까? (Y/n)'),
  ...hSpacer(),
  body('"Y"를 입력하면 한줄로 서버가 자동 매핑 결과를 반환합니다. "N"을 입력하면 로컬 규칙 기반 매핑이 실행됩니다.'),
  body('결과가 표 형태로 표시됩니다. 매핑이 올바르면 "n"을 입력하여 그대로 진행합니다. 수정이 필요하면 "y"를 입력하여 컬럼 번호를 선택하고, 매핑 대상 필드를 번호로 지정합니다.'),
  noticeBox('warn', 'phone(전화번호) 필드 매핑은 필수입니다. 매핑되지 않으면 동기화가 불가합니다.'),

  h3('Step 5: 동기화 설정'),
  body('Agent 이름을 설정합니다. 동기화 주기는 표준 값으로 자동 설정되며, 확인하면 config.enc가 AES-256-GCM으로 암호화 저장됩니다.'),
  noticeBox('success', 'CLI 마법사는 브라우저나 포트 개방 없이 SSH 터미널에서 바로 실행할 수 있어 보안상 안전합니다.'),

  h3('웹 UI 마법사 (선택사항)'),
  body('데스크톱 환경이 있는 경우 웹 UI 마법사를 강제로 실행할 수 있습니다:'),
  code('./sync-agent --setup-web'),
  ...hSpacer(),
  body('SSH 터널링으로 원격 접속도 가능합니다:'),
  code(`ssh -L 9876:localhost:9876 user@서버IP
# 로컬 브라우저에서 http://localhost:9876 접속`),

  h2('4.3 systemd 서비스 등록'),
  body('root 권한으로 서비스를 등록합니다:'),
  code('sudo ./sync-agent --install-service'),
  ...hSpacer(),
  body('이 명령은 다음 작업을 수행합니다:'),
  bullet('/etc/systemd/system/sync-agent.service unit 파일 생성'),
  bullet('systemctl daemon-reload 실행'),
  bullet('서비스 활성화 (부팅 시 자동 시작)'),
  bullet('서비스 즉시 시작'),
  ...hSpacer(),
  body('서비스 설정: 실패 시 60초 후 자동 재시작, 10분 내 최대 3회 시도.'),

  h3('서비스 관리 명령'),
  makeTable([4000, 5360],
    ['명령', '설명'],
    [
      ['sync-agent --service-status', '서비스 상태 확인'],
      ['sudo systemctl status sync-agent', '상세 상태 확인'],
      ['sudo systemctl start sync-agent', '서비스 시작'],
      ['sudo systemctl stop sync-agent', '서비스 중지'],
      ['sudo systemctl restart sync-agent', '서비스 재시작'],
      ['journalctl -u sync-agent -f', '실시간 로그 확인'],
      ['journalctl -u sync-agent -n 100', '최근 로그 100줄 확인'],
      ['sudo sync-agent --uninstall-service', '서비스 제거'],
    ]
  ),
];

// ─── 5. 설정 파일 구조 ─────────────────────────
const ch5 = [
  h1Page('5. 설정 파일 구조'),

  h2('5.1 파일 위치'),
  makeTable([2400, 3480, 3480],
    ['파일', 'Windows', 'Linux'],
    [
      ['암호화 설정', 'data\\config.enc', 'data/config.enc'],
      ['암호화 키', 'data\\agent.key', 'data/agent.key'],
      ['동기화 상태', 'data\\sync_state.json', 'data/sync_state.json'],
      ['오프라인 큐', 'data\\queue.db', 'data/queue.db'],
      ['로그', 'logs\\sync-YYYY-MM-DD.log', 'logs/sync-YYYY-MM-DD.log'],
    ]
  ),

  h2('5.2 설정 우선순위'),
  body('Agent는 다음 순서로 설정을 로드합니다:'),
  numbered('.env 파일 (개발/테스트 모드)'),
  numbered('data/config.enc + data/agent.key (프로덕션 — AES-256-GCM 암호화)'),
  numbered('data/config.json (레거시 — 감지 시 자동으로 enc로 마이그레이션 후 삭제)'),
  ...hSpacer(),
  noticeBox('warn', 'config.enc와 agent.key 파일은 절대 외부에 유출되지 않도록 관리하세요. 이 파일에 DB 접속 정보와 API 키가 암호화되어 저장됩니다.'),

  h2('5.3 환경 변수 (.env) — 개발/테스트용'),
  body('개발 환경에서는 .env 파일로 직접 설정할 수 있습니다:'),
  noticeBox('warn', '.env 파일은 개발/테스트 전용입니다. 운영(프로덕션) 환경에서는 반드시 설치 마법사를 통해 생성된 config.enc(AES-256-GCM 암호화)를 사용하세요.'),
  ...hSpacer(),
  code(`SYNC_SERVER_URL=https://example.com
SYNC_API_KEY=your-api-key
SYNC_API_SECRET=your-api-secret
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pos_db
DB_USER=sync_reader
DB_PASSWORD=secure_password`),
];

// ─── 6. 동기화 동작 확인 ─────────────────────────
const ch6 = [
  h1Page('6. 동기화 동작 확인'),

  h2('6.1 최초 실행'),
  body('Agent가 처음 시작되면 다음 순서로 동작합니다:'),
  numbered('한줄로 서버에 Agent 등록 (최초 1회)'),
  numbered('전체 동기화 실행 (고객 + 구매 데이터 전체 전송, 배치 처리)'),
  numbered('이후 설정된 주기에 따라 증분 동기화 자동 반복'),

  h2('6.2 로그 확인'),
  body('Windows'),
  code('type logs\\sync-%date:~0,4%-%date:~5,2%-%date:~8,2%.log'),
  ...hSpacer(),
  body('Linux'),
  code(`tail -f logs/sync-$(date +%Y-%m-%d).log

# 또는 systemd 저널
journalctl -u sync-agent -f`),

  h2('6.3 정상 동작 확인 포인트'),
  bullet('Heartbeat 로그: 주기적으로 "Heartbeat 전송 성공" 메시지'),
  bullet('동기화 로그: 설정 주기마다 "동기화 완료" + 건수 표시'),
  bullet('한줄로 대시보드: 관리자 페이지에서 Agent 상태가 녹색(정상)으로 표시'),

  h2('6.4 동기화 주기'),
  makeTable([2400, 2200, 4760],
    ['데이터', '기본 주기', '비고'],
    [
      ['고객 정보', '6시간', '변경 빈도 낮음'],
      ['구매 내역', '6시간', '실시간 요구 낮음'],
      ['Heartbeat', '1시간', 'Agent 생존 확인'],
      ['큐 재전송', '30분', '네트워크 복구 시 자동 전송'],
    ]
  ),
  ...hSpacer(),
  noticeBox('info', '동기화 주기는 표준 값으로 고정되어 있습니다. 변경이 필요한 경우 한줄로 담당자에게 문의하세요. 변경된 설정은 다음 동기화 시 Agent에 자동 반영됩니다(별도 재시작 불필요).'),

  h2('6.5 고객 DB 수동 변경 제한'),
  body('싱크 에이전트로 동기화 중인 회사는 한줄로 웹 UI에서 고객 DB를 수동으로 변경할 수 없습니다. 수동 변경 시 다음 동기화에서 소스 DB 데이터로 덮어써져 변경 내용이 유실되기 때문입니다.'),

  h3('제한되는 기능'),
  bullet('고객 DB 엑셀 업로드'),
  bullet('고객 개별 추가 / 수정 / 삭제'),
  bullet('고객 전체 삭제'),

  h3('정상 이용 가능'),
  bullet('직접발송 수신자 엑셀 (일회성 발송 목록)'),
  bullet('수신거부 번호 엑셀 업로드'),
  bullet('AI 분석 / 발송 / 조회'),
  ...hSpacer(),
  noticeBox('info', '고객 정보 변경은 귀사의 DB 서버에서 직접 수정하시면, 다음 동기화 시 한줄로에 자동 반영됩니다.'),
];

// ─── 7. 자동 업데이트 ───────────────────────────
const ch7 = [
  h1Page('7. 자동 업데이트'),
  body('Sync Agent는 주기적으로 한줄로 서버에서 최신 버전을 확인하고, 새 버전이 있으면 자동으로 업데이트합니다.'),

  h2('7.1 업데이트 흐름'),
  numbered('Heartbeat 시 서버에서 최신 버전 확인'),
  numbered('새 버전 감지 시 바이너리 다운로드 (temp 폴더)'),
  numbered('SHA-256 체크섬 검증'),
  numbered('OS별 교체 스크립트 생성 → 현재 바이너리 백업 → 새 버전 적용 → Agent 재시작'),
  ...hSpacer(),
  body('업데이트 실패 시 자동 롤백됩니다. 강제 업데이트 플래그가 설정된 경우 즉시 업데이트가 진행됩니다.'),

  h2('7.2 수동 업데이트'),
  body('필요 시 사용자가 직접 업데이트할 수도 있습니다:'),
  code(`# 1. 새 버전 다운로드 (담당자 제공 URL 사용)
# 2. 서비스 중지
sudo systemctl stop sync-agent   # Linux
# 또는 sc stop SyncAgent           # Windows

# 3. 바이너리 교체
sudo cp sync-agent-new /opt/sync-agent/sync-agent

# 4. 서비스 시작
sudo systemctl start sync-agent`),
];

// ─── 8. CLI 명령 요약 ──────────────────────────
const ch8 = [
  h1Page('8. CLI 명령 요약'),
  makeTable([4200, 5160],
    ['명령', '설명'],
    [
      ['sync-agent', 'Agent 실행 (동기화 시작)'],
      ['sync-agent --setup', '설치 마법사 실행 (Windows: 웹 UI, Linux: CLI 자동 감지)'],
      ['sync-agent --setup-web', '웹 UI 마법사 강제 실행 (브라우저)'],
      ['sync-agent --setup-cli', 'CLI 마법사 강제 실행 (터미널)'],
      ['sync-agent --edit-config', '설정 편집 (대화형 CLI)'],
      ['sync-agent --show-config', '현재 설정 조회 (민감정보 마스킹)'],
      ['sync-agent --install-service', 'OS 서비스로 등록 (자동 시작)'],
      ['sync-agent --uninstall-service', 'OS 서비스 제거'],
      ['sync-agent --service-status', '서비스 상태 확인'],
    ]
  ),
  ...hSpacer(),
  body('Windows에서는 sync-agent.exe, Linux에서는 ./sync-agent 로 실행합니다.'),

  h2('8.1 sync-agent --edit-config 주요 메뉴'),
  body('설정 편집 시 다음 섹션을 수정할 수 있습니다:'),
  bullet('서버 정보 (URL, API Key, API Secret)'),
  bullet('DB 접속 정보 (호스트, 포트, 계정, 비밀번호)'),
  bullet('테이블 및 timestamp 컬럼 변경'),
  bullet('컬럼 매핑 (AI 자동 매핑 재실행 포함)'),
  bullet('커스텀 필드 라벨 편집'),
  bullet('Agent 이름 변경'),
];

// ─── 9. 오프라인 내성 ──────────────────────────
const ch9 = [
  h1Page('9. 오프라인 내성 (네트워크 단절 시 동작)'),
  body('Sync Agent는 네트워크 장애 시에도 데이터 손실 없이 동작합니다.'),

  h2('9.1 오프라인 큐 (queue.db)'),
  body('한줄로 서버에 접속할 수 없을 때, 동기화 데이터는 로컬 큐(data/queue.db)에 자동 저장됩니다. 네트워크가 복구되면 30분 주기로 큐에 쌓인 데이터를 자동 재전송합니다. 전송 성공 시 큐에서 삭제됩니다.'),

  h2('9.2 동기화 상태 (sync_state.json)'),
  body('data/sync_state.json은 마지막 동기화 시각, Agent ID, 총 동기화 건수 등을 기록합니다. 이 파일이 손상되거나 삭제되면 Agent는 다음 실행 시 전체 동기화(Full Sync)를 자동으로 수행합니다. 데이터 손실은 없으며, 최초 실행과 동일하게 전체 데이터를 다시 동기화합니다.'),

  h2('9.3 장애 알림'),
  body('Heartbeat 3회 연속 실패, 동기화 5회 연속 실패, 또는 DB 접속 장애 시 설정된 이메일로 자동 알림이 발송됩니다.'),
];

// ─── 10. 트러블슈팅 ───────────────────────────
const ch10 = [
  h1Page('10. 트러블슈팅 (FAQ)'),

  h2('Q1. DB 접속이 실패합니다.'),
  body('→ DB 서버가 실행 중인지 확인합니다. 호스트/포트/계정 정보가 정확한지 sync-agent --edit-config로 확인합니다. 방화벽에서 Agent 서버 → DB 서버 간 해당 포트(예: MySQL 3306)가 허용되어 있는지 확인합니다. Oracle의 경우 TNS 설정이 필요할 수 있습니다.'),

  h2('Q2. 한줄로 서버에 접속할 수 없습니다 (API 오류).'),
  body('→ 방화벽에서 HTTPS(443) 아웃바운드가 허용되어 있는지 확인합니다. API Key/Secret이 만료되지 않았는지 한줄로 담당자에게 확인합니다. sync-agent --show-config로 현재 서버 URL이 정확한지 확인합니다.'),

  h2('Q3. 한글이 깨져서 동기화됩니다.'),
  body('→ MySQL 이중 인코딩 문제일 수 있습니다. Agent는 최초 연결 시 자동으로 이중 인코딩을 감지하고 보정합니다. 문제가 지속되면 logs 폴더의 로그 파일에서 "이중 인코딩 확정" 또는 "정상 인코딩" 메시지를 확인하세요.'),

  h2('Q4. 동기화가 멈춰 있습니다 (Heartbeat만 전송).'),
  body('→ 증분 동기화 기준 컬럼(timestamp)이 잘못 설정되어 있을 수 있습니다. sync-agent --edit-config로 고객/구매 테이블의 timestamp 컬럼이 실제 DB 컬럼명과 일치하는지 확인하세요. 변경된 데이터가 없으면 정상적으로 건수 0으로 표시됩니다.'),

  h2('Q5. 설정을 변경하고 싶습니다 (DB 주소, 매핑 등).'),
  body('→ sync-agent --edit-config 명령으로 설정을 부분 수정할 수 있습니다. 서버/DB/동기화/매핑/커스텀 필드 라벨/Agent 섹션별로 수정 가능합니다. 수정 후 서비스 재시작이 필요합니다.'),

  h2('Q6. 전체 재동기화를 하고 싶습니다.'),
  body('→ data/sync_state.json 파일을 삭제하고 Agent를 재시작하면 최초 실행과 동일하게 전체 동기화가 수행됩니다. 기존 데이터는 서버에서 UPSERT로 처리되므로 중복 문제는 없습니다.'),

  h2('Q7. AI 자동 매핑이 실패합니다.'),
  body('→ 네트워크 연결 상태를 확인합니다. AI 매핑 호출에 일시적 제한이 있을 경우 자동으로 로컬 규칙 기반 매핑으로 대체됩니다. 매핑 결과가 만족스럽지 않으면 매핑 테이블에서 직접 수동 수정할 수 있으며, sync-agent --edit-config에서도 언제든 재실행 가능합니다.'),

  h2('Q8. 한줄로 웹 UI에서 고객 DB를 엑셀로 업로드할 수 없다는 모달이 나옵니다.'),
  body('→ 정상 동작입니다. 싱크 에이전트로 동기화 중인 회사는 한줄로 UI에서 고객 DB를 수동으로 변경할 수 없습니다. 변경 내용이 다음 동기화 시 소스 DB 데이터로 덮어써지는 것을 방지하기 위함입니다. 고객 정보 변경은 귀사의 DB 서버에서 직접 수정하시면 다음 동기화에 자동 반영됩니다.'),

  h2('Q9. 매장전화번호(store_phone)가 null로 저장됩니다.'),
  body('→ v1.4.0 이하에서 발생하던 문제로, v1.5.0에서 해결되었습니다. Agent를 v1.5.0으로 업그레이드하시면 유선번호(02, 031, 1588 등)와 휴대폰 모두 정상 저장됩니다. 이미 null로 저장된 기존 데이터는 다음 동기화 시 자동 갱신됩니다.'),
];

// ─── 11. 제거 및 재설치 ────────────────────────
const ch11 = [
  h1Page('11. 제거 및 재설치'),

  h2('11.1 Windows 완전 제거'),
  numbered('제어판 → 프로그램 제거에서 "Sync Agent"를 선택하여 제거합니다. 서비스 중지 및 레지스트리 정리가 자동으로 수행됩니다.'),
  numbered('제거 시 설정 파일(data 폴더)과 로그(logs 폴더) 보존 여부를 묻습니다. 재설치 예정이면 "아니오"를 선택하여 설정을 유지하세요.'),

  h2('11.2 Linux 완전 제거'),
  code(`# 서비스 제거
sudo ./sync-agent --uninstall-service

# 전체 삭제
sudo rm -rf /opt/sync-agent

# 설정 유지하려면 data 폴더를 백업한 후 삭제
sudo cp -r /opt/sync-agent/data ~/sync-agent-backup
sudo rm -rf /opt/sync-agent`),

  h2('11.3 재설치'),
  body('기존 설정을 유지한 채 재설치하면 data 폴더(config.enc, agent.key, sync_state.json)가 그대로 유지되어 설치 마법사를 다시 실행할 필요 없습니다. 완전 초기화가 필요하면 data 폴더를 삭제한 후 --setup으로 재설정하세요.'),

  h2('11.4 버전 업그레이드'),
  body('자동 업데이트를 통해 최신 버전으로 자동 업그레이드됩니다. 수동 업그레이드가 필요한 경우:'),
  numbered('서비스 중지 (systemctl stop / sc stop)'),
  numbered('새 바이너리로 교체 (data 폴더는 그대로 유지)'),
  numbered('서비스 재시작'),
];

// ─── 12. 버전 히스토리 ───────────────────────
const ch12 = [
  h1Page('12. 버전 히스토리'),

  h2('v1.5.0 (2026년 4월)'),
  bullet('AI 자동 컬럼 매핑 기능 추가 — 설치 시간 대폭 단축'),
  bullet('동기화 주기 표준화 (고객 6시간, 구매 6시간, Heartbeat 1시간)'),
  bullet('매장전화번호 정규화 개선 — 유선번호(02, 031, 1588 등) 인식률 향상'),
  bullet('네트워크 사용량 최적화'),
  bullet('설정 편집(--edit-config)에 AI 매핑 재실행 옵션 추가'),

  h2('v1.4.0 (2026년 3월)'),
  bullet('표준 필드 + 커스텀 필드(15 슬롯) 체계 도입'),
  bullet('매장 관련 필드 추가 (store_phone, registration_type 등)'),
  bullet('커스텀 필드 라벨 등록'),
  bullet('이메일 정규화 추가'),

  h2('v1.3.0 (2026년 2월)'),
  bullet('--edit-config CLI 추가'),
  bullet('테이블별 timestamp 컬럼 분리'),
  bullet('한글 인코딩 깨짐 해결'),
  bullet('대량 동기화 안정성 개선'),

  h2('v1.2.0 (2026년 2월)'),
  bullet('CLI 설치 마법사 (Linux 헤드리스 대응)'),
  bullet('OS 자동 감지'),
  bullet('NSIS 설치파일 + Linux zip 배포'),

  h2('v1.1.0 (2026년 2월)'),
  bullet('Oracle/PostgreSQL/Excel/CSV 지원'),
  bullet('자동 업데이트'),
  bullet('듀얼 OS'),
  bullet('AES-256-GCM 설정 암호화'),
  bullet('이메일 알림'),

  h2('v1.0.0 (2026년 2월)'),
  bullet('최초 릴리스'),

  ...hSpacer(2),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1000, after: 200 },
    children: [new TextRun({ text: '— 문서 끝 —', font: FONT_BODY, size: 22, italics: true, color: '6B7280' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: '© 2026 INVITO Co., Ltd. All rights reserved.', font: FONT_BODY, size: 20, color: '9CA3AF' })],
  }),
];

// ─── 문서 생성 ────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT_BODY, size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: FONT_HEAD, color: COLOR_HEAD },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT_HEAD, color: COLOR_SUBHEAD },
        paragraph: { spacing: { before: 300, after: 140 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: FONT_HEAD, color: '374151' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ],
      },
      {
        reference: 'numbers',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 0 },
          children: [new TextRun({ text: 'Sync Agent v1.5.0 설치 매뉴얼', font: FONT_BODY, size: 18, color: '9CA3AF' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
          children: [
            new TextRun({ text: 'INVITO — Sync Agent v1.5.0 · ', font: FONT_BODY, size: 18, color: '9CA3AF' }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: 18, color: '9CA3AF' }),
            new TextRun({ text: ' / ', font: FONT_BODY, size: 18, color: '9CA3AF' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_BODY, size: 18, color: '9CA3AF' }),
          ],
        })],
      }),
    },
    children: [
      ...coverPage,
      ...ch1, ...ch2, ...ch3, ...ch4, ...ch5, ...ch6,
      ...ch7, ...ch8, ...ch9, ...ch10, ...ch11, ...ch12,
    ],
  }],
});

const outputPath = path.join(__dirname, 'SyncAgent_설치매뉴얼_v1_5.docx');
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  const stat = fs.statSync(outputPath);
  console.log(`✅ 매뉴얼 생성 완료: ${outputPath}`);
  console.log(`   파일 크기: ${(stat.size / 1024).toFixed(1)} KB`);
}).catch(err => {
  console.error('❌ 문서 생성 실패:', err);
  process.exit(1);
});
