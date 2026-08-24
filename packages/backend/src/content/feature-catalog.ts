/**
 * feature-catalog.ts — 기능 카탈로그 (★ 2026-08-22 신설)
 *
 * **이것은 매뉴얼이 아니라, 도움말 봇과 안내 화면(/guide)이 함께 읽는 단일 원장이다.**
 * 설계·불변 원칙·게이트 = docs/FEATURE-HELP-CATALOG.md (호출어 "도움말 봇" · "기능 카탈로그").
 *
 * 단위 = "고객이 하려는 일"(Job). 화면·요금제·크레딧은 그 일의 속성으로 매단다.
 *
 * ⛔ 집필 규약 (어기면 `feature-catalog-invariants.test.ts`가 빌드를 막는다)
 *   1. 요금제 이름(FREE/STARTER/…)·크레딧 숫자·원 단가를 **문자열로 적지 않는다.** 요금제 가부는 런타임
 *      `canUseFeature(planKey)`가, 크레딧 숫자는 `getCreditCost(creditSource)`가 만든다. 적는 순간 낡는다.
 *   2. 모델명·이모지·줄표·내부 코드명(D123·CT-12)·테이블명·"Modal"을 쓰지 않는다. 고객이 읽는 문장이다.
 *   3. 버튼 라벨을 따옴표로 인용할 때는 **화면에 실제 있는 문구**만 쓴다(2026-08-22 실측분).
 *   4. 사람이 쓰는 것은 goal · keywords · steps · blockers 넷뿐이다. 나머지는 기계가 대조한다.
 *   5. 정의가 없는 기능도 `status:'stub'`으로 등재하고 `stubUntil`을 준다. 그 날짜가 지나면 빌드가 스스로 실패한다.
 *
 * 파일은 하나다. 항목이 30개를 넘으면 그때 도메인별로 쪼갠다(12개를 8파일에 흩으면 껍데기 파일이 남는다).
 */
import type { FeatureKey } from '../utils/plan-guard';

export interface FeatureJob {
  /** 'send-direct' 같은 케밥 식별자 */
  id: string;
  /** 고객 언어 명사구. 14자 이내 */
  title: string;
  /** 이걸 하면 무엇이 끝나는가. 40자 이내 */
  goal: string;
  /** 사용자 어휘·구어·오탈자. 5개 이상. 우리 용어와 고객 용어의 간격을 이 필드가 메운다 */
  keywords: string[];
  /** 3~6줄. 순서대로 */
  steps: string[];
  /** 막히는 지점. 0~3개. 이것이 봇의 실제 답변 내용이다 */
  blockers: { symptom: string; fix: string }[];
  /**
   * 어디서 시작하는가.
   *   `path` = 실제 라우트(⛔ 쿼리를 붙이지 마라 — 불변식 1이 라우트 실존을 보고, `jobsForPath`가
   *            이 값을 현재 경로와 **문자열로** 비교한다. 쿼리를 붙이면 그 작업이 "이 화면 목록"에서 사라진다)
   *   `via`  = 그 화면에서 누르는 것
   *   `open` = 그 화면에서 **열려야 하는 모달·카드의 열쇠**(쿼리 문자열). 화면 자체가 목적지면 없다.
   *            ★2026-08-24 신설 — 대행 접수(남지현): 40개 중 10개가 `/dashboard`인데 실제 시작 지점은
   *            대시보드 위의 모달이라, 경로만으로는 "이 화면 열기"가 홈으로 가는 버튼이 됐다.
   */
  entry: { path: string; via: string; open?: string };
  /** 요금제 기능 키. null = 전 요금제 */
  planKey: FeatureKey | null;
  /** 크레딧이 드는 지점의 source 키(숫자 금지). null = 무료 */
  creditSource: string | null;
  /** 관련 작업 id. 최대 3 */
  related: string[];
  /** 본문이 있는가 */
  status: 'ready' | 'stub';
  /** stub 만료일 'YYYY-MM-DD'. ready면 null */
  stubUntil: string | null;
  /** 근거 코드 경로. 내부 전용 — 응답에 절대 싣지 않는다 */
  sourceFile: string;
}

/** 봇·화면으로 나가는 형태. 내부 필드는 타입에서 잘라낸다 */
export type PublicFeatureJob = Omit<FeatureJob, 'sourceFile' | 'status' | 'stubUntil'> & { status: 'ready' | 'stub' };

/** 대분류. 안내 화면의 목차이자 봇의 추천 묶음 */
export const JOB_GROUPS: { key: string; label: string; jobs: string[] }[] = [
  { key: 'start', label: '시작 준비', jobs: ['sender-register', 'credits-and-plan', 'manage-accounts', 'ai-usage', 'ai-batches'] },
  { key: 'customers', label: '고객 명단', jobs: ['upload-customers', 'ai-column-mapping', 'view-customer', 'manage-unsubscribes', 'connect-shop', 'segments'] },
  { key: 'send', label: '보내기', jobs: ['send-direct', 'send-target', 'schedule-send', 'send-alimtalk', 'check-spam', 'auto-spam-test', 'agency-send', 'ai-operator'] },
  { key: 'create', label: '만들기', jobs: ['write-copy-ai', 'mobile-dm', 'image-studio', 'email-campaign', 'inapp-message', 'push-campaign', 'quick-campaign'] },
  { key: 'automate', label: '자동으로 돌리기', jobs: ['auto-marketing', 'journeys', 'marketing-planner', 'marketing-calendar', 'auto-send-legacy'] },
  { key: 'results', label: '결과 보기', jobs: ['check-results', 'performance', 'predictive', 'ai-explain', 'send-calendar'] },
  { key: 'agency', label: '맡기기·진단', jobs: ['marketing-diagnosis', 'campaign-agency', 'ai-memory', 'voice-inbound'] },
];

/**
 * stub 공통 만료일. 2026-08-22(2) 27개를 전부 승격해 지금 stub은 0이다.
 * 새 기능을 본문 없이 등재할 때 `status: 'stub', stubUntil: STUB_UNTIL, steps: [], blockers: []`로 두면 게이트 7번이 만료를 잡는다.
 */
export const STUB_UNTIL = '2026-11-30';

// ────────────────────────────────────────────────────────────────────
// 본문 39개 = 1단계 12개(첫 고객사가 계약 후 2주에 밟는 동선) + 2026-08-22(2) 승격 27개
// ────────────────────────────────────────────────────────────────────

const READY: FeatureJob[] = [
  {
    id: 'sender-register',
    title: '발신번호 등록하기',
    goal: '문자에 찍힐 우리 회사 번호를 등록해 발송이 가능해진다',
    keywords: ['발신번호', '발신 번호', '보내는 번호', '회신번호', '회사 번호 등록', '번호 등록', '발신번호 없음', '발신번호가 없습니다'],
    steps: [
      '발신번호 등록은 통신사 규정상 본인 확인 서류가 필요해 담당자가 대신 등록합니다. 사용할 번호와 서류(통신서비스 이용증명원 등)를 담당자에게 보냅니다',
      '등록이 끝나면 상단 메뉴 "설정"의 "등록 회신번호"에서 번호를 확인합니다',
      '"직접발송" 화면의 "발신번호" 목록에 그 번호가 보이면 발송할 수 있습니다',
    ],
    blockers: [
      { symptom: '직접발송 화면에 "등록된 발신번호가 없습니다"라고 뜹니다', fix: '아직 등록 전입니다. 담당자에게 번호와 서류를 보내 등록을 요청하세요' },
      { symptom: '등록하고 싶은 번호가 목록에 안 보입니다', fix: '번호는 8~11자리 일반 번호만 가능합니다. 담당자에게 등록 상태를 확인하세요' },
    ],
    entry: { path: '/settings', via: '상단 메뉴 "설정" 안 "등록 회신번호"' },
    planKey: null,
    creditSource: null,
    related: ['send-direct', 'manage-accounts'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/Settings.tsx · frontend/src/pages/TermsPage.tsx(발신번호 조항)',
  },
  {
    id: 'upload-customers',
    title: '엑셀로 고객 명단 올리기',
    goal: '가진 고객 파일을 올려 이름·번호·구매 정보가 표준 항목으로 정리된다',
    keywords: ['엑셀 업로드', '고객 업로드', '명단 올리기', 'csv', 'xlsx', '고객 DB', '컬럼 맞추기', '파일 등록', '고객 등록', '주소록 올리기'],
    steps: [
      '대시보드 "DB 현황" 카드의 "고객 DB 업로드"를 누릅니다',
      '"파일"에서 엑셀(.xlsx, .xls) 또는 CSV를 고릅니다. 3만 건 단위로 나누면 안정적입니다',
      '"AI로 컬럼 맞추기"를 누르면 파일의 제목 행이 기본 항목(이름·전화번호·등급·구매 금액 등)에 자동으로 맞춰집니다. 틀린 칸은 직접 바꿉니다',
      '표준에 없는 열은 "직접 만든 항목"으로 저장됩니다',
      '"미리보기"로 확인한 뒤 올립니다. 같은 번호가 이미 있으면 충돌을 정리하는 화면이 이어집니다',
    ],
    blockers: [
      { symptom: '전화번호 열을 못 찾습니다', fix: '제목 행에 "전화번호" 또는 "휴대폰" 같은 이름이 있어야 합니다. 첫 줄이 제목인지 확인하세요' },
      { symptom: '업로드 뒤 고객 수가 파일 행 수보다 적습니다', fix: '같은 번호는 한 명으로 합쳐집니다. 번호가 비었거나 형식이 다른 행은 빠집니다' },
      { symptom: '날짜 열이 엉뚱하게 들어갔습니다', fix: '2026-08-22 또는 20260822 형식이면 안전합니다. 존재하지 않는 날짜(2월 30일)는 빠집니다' },
    ],
    entry: { path: '/dashboard', via: '"DB 현황" 카드의 "고객 DB 업로드"', open: 'upload=1' },
    planKey: 'customer_db',
    creditSource: 'ai-column-mapper',
    related: ['view-customer', 'send-target', 'manage-unsubscribes'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/FileUploadMappingModal.tsx · frontend/src/pages/Dashboard.tsx',
  },
  {
    id: 'send-direct',
    title: '주소록으로 첫 문자 보내기',
    goal: '번호를 넣고 내용을 써서 바로 문자가 나간다',
    keywords: ['문자 보내기', '직접발송', '바로 보내기', 'SMS', 'LMS', 'MMS', '단체 문자', '번호 입력', '문자 발송', '광고 문자', '문자 보내는 법', '문자 어떻게 보내'],
    steps: [
      '상단 메뉴 "직접발송"을 누릅니다',
      '오른쪽 "수신번호"에 번호를 "직접입력"하거나 "파일 선택"으로 올리거나 "주소록"에서 고릅니다',
      '왼쪽에서 "발신번호"를 고르고 내용을 씁니다. 광고면 "광고표기"를 켜고, 이름처럼 사람마다 다른 값은 "변수 삽입"으로 넣습니다',
      '"미리보기"로 확인하고, 광고 문자는 "스팸필터테스트"로 한 번 걸러 봅니다',
      '"수신거부제거"와 "중복제거"는 기본으로 켜져 있습니다. 그대로 발송 버튼을 누르면 확인 창이 뜨고, 확인하면 나갑니다(걸러내지 않으려면 체크를 푸세요)',
    ],
    blockers: [
      { symptom: '발송 버튼이 눌리지 않습니다', fix: '발신번호가 선택됐는지, 수신번호가 한 건이라도 있는지, 내용이 비어 있지 않은지 확인하세요' },
      { symptom: '광고 문자인데 맨 앞에 (광고)가 안 붙습니다', fix: '"광고표기"를 켜면 (광고)와 무료수신거부 문구가 자동으로 붙습니다' },
      { symptom: '글자 수가 넘어 LMS로 바뀌었습니다', fix: 'SMS는 90바이트까지입니다. 넘으면 LMS로 나가고 단가가 다릅니다' },
    ],
    entry: { path: '/dashboard', via: '상단 메뉴 "직접발송"', open: 'open=direct-send' },
    planKey: 'basic_send',
    creditSource: null,
    related: ['sender-register', 'schedule-send', 'check-results'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/DirectSendPanel.tsx',
  },
  {
    id: 'check-results',
    title: '발송 결과 보기',
    goal: '보낸 문자가 몇 건 성공했고 누구에게 안 갔는지 확인한다',
    keywords: ['발송결과', '발송 결과', '결과 조회', '성공률', '실패', '안 갔어요', '도착 확인', '발송 내역', '전송 결과'],
    steps: [
      '상단 메뉴 "발송결과"를 누릅니다',
      '"발송 내역"에서 기간을 고르고 목록에서 건을 찾습니다. 예약 건은 "예약 대기"로 표시됩니다',
      '"보기"를 누르면 수신번호마다 "성공"·"실패"·"대기"와 결과코드가 나옵니다',
      '실패가 많으면 결과코드를 보고 번호 오류인지 수신거부인지 가립니다',
    ],
    blockers: [
      { symptom: '방금 보냈는데 결과가 비어 있습니다', fix: '통신사 도착 확인까지 몇 분 걸립니다. 잠시 뒤 새로고침하세요' },
      { symptom: '성공률이 낮습니다', fix: '없는 번호·수신거부 번호가 섞인 경우가 대부분입니다. "수신거부제거"는 기본으로 켜져 있으니, 보내기 전 체크가 풀려 있지 않은지 확인하세요' },
    ],
    entry: { path: '/dashboard', via: '상단 메뉴 "발송결과"', open: 'results=1' },
    planKey: 'basic_send',
    creditSource: null,
    related: ['send-direct', 'manage-unsubscribes', 'view-customer'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/ResultsModal.tsx',
  },
  {
    id: 'manage-unsubscribes',
    title: '수신거부 확인하기',
    goal: '받기 싫다는 고객을 등록해 두면 어떤 발송에서도 자동으로 빠진다',
    keywords: ['수신거부', '수신 거부', '080', '거부 번호', '차단', '빼기', '무료수신거부', '수신거부 해제', '거부 목록'],
    steps: [
      '상단 메뉴 "수신거부"를 누릅니다',
      '"직접 추가"로 번호를 넣거나 "파일 업로드"로 여러 건을 올립니다. 파일은 "전화번호 열 선택"에서 어느 열이 번호인지 고릅니다',
      '"전화번호 검색"으로 등록 여부를 확인하고, 잘못 들어간 번호는 "수신거부 해제"로 뺍니다',
      '080 번호를 쓰면 고객이 직접 거부한 번호가 "080 연동"으로 자동으로 들어옵니다',
    ],
    blockers: [
      { symptom: '수신거부한 고객에게 문자가 나갔습니다', fix: '"수신거부제거"가 켜져 있어야 목록에서 빠집니다. 기본은 켜짐이니 체크가 풀려 있지 않은지 확인하세요. 예약 발송도 나가는 시점에 다시 거릅니다' },
      { symptom: '080 번호로 거부한 고객이 목록에 없습니다', fix: '"080 연동 테스트"로 연동 상태를 확인하세요. 연동 전 거부는 들어오지 않습니다' },
    ],
    entry: { path: '/unsubscribes', via: '상단 메뉴 "수신거부"' },
    planKey: 'basic_send',
    creditSource: null,
    related: ['send-direct', 'check-results', 'upload-customers'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/Unsubscribes.tsx',
  },
  {
    id: 'credits-and-plan',
    title: '요금제와 크레딧 이해하기',
    goal: '어떤 기능이 열려 있고 AI 기능에 무엇이 얼마나 드는지 안다',
    keywords: ['요금제', '크레딧', '플랜', '비용', '얼마', '한도', '잔여', '충전', '업그레이드', '가격'],
    steps: [
      '문자·알림톡 발송은 건당 단가로, AI 기능은 크레딧으로 씁니다. 둘은 따로입니다',
      '대시보드 "AI 크레딧 잔여" 카드에서 남은 크레딧을 봅니다. AI 기능 버튼마다 드는 크레딧이 표시됩니다',
      '상단 메뉴 "설정" 옆 요금제 안내에서 "요금제 비교"로 지금 열려 있는 기능을 확인하고, 필요하면 신청합니다',
      '"AI 사용량" 화면에서 어디에 얼마나 썼는지 추세를 봅니다',
    ],
    blockers: [
      { symptom: '버튼이 잠겨 있고 요금제 안내가 뜹니다', fix: '지금 요금제에 없는 기능입니다. 요금제 안내에서 어느 요금제부터 열리는지 확인하세요' },
      { symptom: 'AI 버튼을 눌렀는데 크레딧이 부족하다고 합니다', fix: '크레딧은 매달 요금제에 따라 채워지고, 부족하면 충전할 수 있습니다' },
    ],
    entry: { path: '/pricing', via: '대시보드 "AI 크레딧 잔여" 카드 또는 요금제 안내' },
    planKey: null,
    creditSource: null,
    related: ['write-copy-ai', 'sender-register'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/PricingPage.tsx · frontend/src/pages/AiUsagePage.tsx · frontend/src/constants/credit.ts',
  },
  {
    id: 'send-target',
    title: '조건으로 대상 골라 보내기',
    goal: '올려 둔 고객 중 조건에 맞는 사람만 뽑아 문자를 보낸다',
    keywords: ['타겟 발송', '타겟', '조건 발송', '세그먼트', '골라서 보내기', '필터', 'VIP만', '지역별', '연령대', '구매 고객만'],
    steps: [
      '대시보드 "직접 타겟 발송" 카드를 누릅니다',
      '"조건 자연어 입력"에 "강남 지역 30대 여성"처럼 말로 적거나, "필터 조건"에서 성별·연령대·지역·누적구매를 직접 고릅니다',
      '"대상 인원"과 "샘플 5건 미리보기"로 제대로 뽑혔는지 확인하고 "확인"을 누릅니다',
      '이어지는 발송 화면에서 "발신번호"를 고르고 내용을 씁니다. "자동입력 변수"로 이름·등급을 사람마다 다르게 넣을 수 있습니다',
      '"미리보기" 뒤 발송하거나 "예약전송"으로 시간을 정합니다',
    ],
    blockers: [
      { symptom: '대상 인원이 0명입니다', fix: '조건에 쓴 항목이 고객 파일에 있어야 합니다. 지역·등급 열 없이 올렸으면 그 조건은 0명이 됩니다' },
      { symptom: '조건을 말로 적었는데 엉뚱하게 해석됩니다', fix: '"AI 해석" 결과를 보고 "필터 조건"에서 직접 고치면 됩니다' },
    ],
    entry: { path: '/dashboard', via: '"직접 타겟 발송" 카드', open: 'open=target-send' },
    planKey: 'target_send',
    creditSource: null,
    related: ['upload-customers', 'write-copy-ai', 'schedule-send'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/DirectTargetFilterModal.tsx · frontend/src/components/TargetSendModal.tsx',
  },
  {
    id: 'write-copy-ai',
    title: 'AI로 문안 받기',
    goal: '행사 내용만 적으면 보낼 문안을 AI가 써 주고 다듬어 준다',
    keywords: ['AI 문안', '문구 생성', '문안 추천', '카피', '문자 내용 써줘', 'AI 추천', '다듬기', '꾸미기', '문장 생성', '자동 작성'],
    steps: [
      '"직접 타겟 발송"으로 대상을 고른 뒤 발송 화면에서 "AI 문구 생성"을 누릅니다. 행사 내용을 한 줄 적으면 문안이 만들어집니다',
      '직접발송 화면에서 이미 쓴 내용은 "AI 다듬기"로 자연스럽게 고칠 수 있습니다',
      '만들어진 문안은 그대로 쓰지 말고 혜택·기간·매장명이 맞는지 확인합니다. AI는 혜택 수치를 지어내지 않고 빈칸으로 둡니다',
      '마음에 들면 발송으로 이어갑니다',
    ],
    blockers: [
      { symptom: '문안에 [직접 작성해주세요] 같은 빈칸이 있습니다', fix: '혜택 숫자는 AI가 정하지 않습니다. 그 자리를 직접 채우지 않으면 발송이 막힙니다' },
      { symptom: 'AI 버튼이 잠겨 있습니다', fix: 'AI 문안은 요금제에 따라 열리고 크레딧을 씁니다. 요금제 안내를 확인하세요' },
    ],
    entry: { path: '/dashboard', via: '"직접 타겟 발송" 카드 → 발송 화면의 "AI 문구 생성"', open: 'open=target-send' },
    planKey: 'ai_messaging',
    creditSource: 'generate-messages',
    related: ['send-target', 'credits-and-plan', 'check-spam'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/Dashboard.tsx(AI 문구 생성) · frontend/src/components/DirectSendPanel.tsx(AI 다듬기)',
  },
  {
    id: 'view-customer',
    title: '고객 한 명 이력 보기',
    goal: '고객 한 명이 무엇을 받았고 무엇을 샀는지 시간순으로 본다',
    keywords: ['고객 조회', '고객 이력', '고객 360', '한 명 보기', '누가 뭘 받았나', '고객 상세', '활동 기록', '구매 이력', '고객 검색'],
    steps: [
      '대시보드 "DB 현황" 카드의 "상세보기"를 누릅니다',
      '목록에서 이름·전화번호로 찾거나 필터로 좁힙니다',
      '행을 누르면 그 고객의 활동 기록이 열립니다. 왼쪽은 요약과 기본 정보, 오른쪽은 받은 문자·구매·동의·자동화 기록이 날짜순입니다',
      '위쪽 검색칸에 내용을 적거나 기간·종류를 고르면 그 기록만 남습니다',
    ],
    blockers: [
      { symptom: '받은 메시지가 0건입니다', fix: '이 회사 계정에서 그 번호로 보낸 기록만 셉니다. 다른 계정이나 다른 시스템에서 보낸 것은 나오지 않습니다' },
      { symptom: '상세보기가 잠겨 있습니다', fix: '고객 조회 화면은 요금제에 따라 열립니다. 요금제 안내를 확인하세요' },
    ],
    entry: { path: '/dashboard', via: '"DB 현황" 카드의 "상세보기" → 고객 행 클릭', open: 'open=customer-db' },
    planKey: 'customer_db_view',
    creditSource: null,
    related: ['upload-customers', 'check-results', 'send-target'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/CustomerDBModal.tsx · frontend/src/components/customer360/',
  },
  {
    id: 'schedule-send',
    title: '예약해 두기',
    goal: '지금 써 두고 원하는 날짜·시간에 자동으로 나가게 한다',
    keywords: ['예약 발송', '예약', '시간 지정', '내일 아침에', '정해진 시간', '예약 취소', '스케줄', '나중에 보내기'],
    steps: [
      '"직접발송" 또는 "직접 타겟 발송"에서 내용까지 쓴 뒤 "예약전송"을 켭니다',
      '"예약시간 선택"에서 날짜와 시간을 고릅니다. 회사 설정의 발송 시작·종료 시간 안이어야 합니다',
      '발송 버튼을 누르면 확인 창에 예약 시각이 함께 뜹니다',
      '"발송결과"의 목록에 "예약 대기"로 보이고, 나가기 전이면 "예약 취소"로 되돌릴 수 있습니다',
    ],
    blockers: [
      { symptom: '예약 시간을 고를 수 없습니다', fix: '회사 설정의 "발송 시작시간"과 "발송 종료시간" 밖이거나, 휴일 발송이 꺼져 있으면 그 시간은 잠깁니다' },
      { symptom: '예약을 취소했는데 문자가 나갔습니다', fix: '나가기 시작한 뒤에는 취소가 되지 않습니다. 예약 시각 전에 취소해야 합니다' },
    ],
    entry: { path: '/dashboard', via: '"직접발송" 안 "예약전송"', open: 'open=direct-send' },
    planKey: 'basic_send',
    creditSource: null,
    related: ['send-direct', 'send-target', 'check-results'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/DirectSendPanel.tsx(예약전송) · frontend/src/pages/Settings.tsx(발송 정책)',
  },
  {
    id: 'send-alimtalk',
    title: '알림톡으로 보내기',
    goal: '검수된 템플릿으로 카카오 알림톡을 문자 대신 보낸다',
    keywords: ['알림톡', '카카오', '카톡', '템플릿', '검수', '카카오 발송', '브랜드메시지', '친구톡', '알림톡 발송'],
    steps: [
      '상단 메뉴 "카카오&RCS"의 "알림톡 템플릿"에서 쓸 템플릿이 "승인" 상태인지 확인합니다. 승인 전이면 먼저 검수를 거쳐야 합니다',
      '"직접발송" 화면 위쪽의 "알림톡 발송"을 누르면 알림톡 화면으로 바뀝니다',
      '템플릿을 고르고, 템플릿 안 변수(이름·주문번호 등)를 "템플릿 변수 매핑"에서 고객 항목과 맞춥니다',
      '수신번호를 넣고 발송합니다. 알림톡을 못 받는 번호는 문자로 대신 나갑니다',
    ],
    blockers: [
      { symptom: '"템플릿을 선택해주세요"에서 더 못 갑니다', fix: '승인된 템플릿이 있어야 합니다. "카카오&RCS"에서 상태가 "승인대기"나 "반려"면 아직 쓸 수 없습니다' },
      { symptom: '알림톡 대신 문자로 나갔습니다', fix: '카카오를 안 쓰는 번호나 알림톡 수신 차단 번호는 자동으로 문자로 대체됩니다. 발송결과에서 "알림톡 도착" 여부를 확인하세요' },
    ],
    entry: { path: '/kakao-rcs', via: '상단 메뉴 "카카오&RCS" → 템플릿 확인 → "직접발송"의 "알림톡 발송"' },
    planKey: 'ai_messaging',
    creditSource: null,
    related: ['send-direct', 'check-results', 'sender-register'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/KakaoRcsPage.tsx · frontend/src/components/DirectSendPanel.tsx(알림톡 발송)',
  },
  {
    id: 'auto-marketing',
    title: '자동 마케팅 켜기',
    goal: 'AI가 매일 고객 상태를 보고 캠페인을 제안하고 승인하면 나간다',
    keywords: ['자동 마케팅', '자동마케팅', '자동 캠페인', '매일 제안', 'AI 제안', '자동으로 보내기', '알아서', '자율 발송'],
    steps: [
      '대시보드 "AI Operator" 카드로 들어가 "자동 마케팅"을 누릅니다',
      '"시나리오로 시작"에서 준비된 시나리오를 고르거나 "자연어로 시작"에서 목표를 한 줄로 적습니다',
      '시작되면 AI가 매일 대상과 문안을 제안합니다. 제안을 승인해야 발송되고, 승인 없이는 나가지 않습니다',
      '"상태"와 "AI 학습 현황"에서 지금 무엇이 돌아가는지 봅니다. 성과가 검증된 목표는 여정으로 가져갈 수 있습니다',
    ],
    blockers: [
      { symptom: '시작 버튼이 잠겨 있습니다', fix: '자동 마케팅은 상위 요금제에서 열립니다. 요금제 안내를 확인하세요' },
      { symptom: '제안이 "대기 중"에서 안 넘어갑니다', fix: '고객 명단과 발신번호가 있어야 제안이 만들어집니다. 둘 중 하나가 비어 있으면 대기합니다' },
    ],
    entry: { path: '/continuous-operator', via: '대시보드 "AI Operator" → "자동 마케팅"' },
    planKey: 'auto_campaign',
    creditSource: 'continuous-operator',
    related: ['journeys', 'upload-customers', 'credits-and-plan'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/ContinuousOperatorPage.tsx · backend/src/utils/continuous-operator.ts',
  },
  // ────────────────────────────────────────────────────────────────────
  // 2026-08-22(2) 나머지 27개 승격 — 화면 코드를 읽고 썼다. 버튼 라벨은 화면 문구 그대로.
  //   진입 버튼이 없는 화면(주소로만 열림)은 그렇다고 적었다. 없는 버튼을 있다고 쓰는 것이 이 원장의 유일한 거짓말이다.
  // ────────────────────────────────────────────────────────────────────
  {
    id: 'manage-accounts',
    title: '직원 계정 관리하기',
    goal: '같이 쓸 직원을 초대하고 권한을 나눈다',
    keywords: ['직원 추가', '계정 추가', '사용자 초대', '권한', '관리 메뉴', '담당자 추가', '비밀번호 초기화', '사용자 관리'],
    steps: [
      '상단 메뉴 "관리"를 누르고 "사용자" 탭으로 갑니다',
      '"사용자 추가"를 눌러 아이디·비밀번호·이름을 넣습니다. 이메일·연락처·부서는 선택입니다',
      '"담당 분류 코드"를 고르면 그 직원은 그 코드의 고객만 봅니다. 비워 두면 전체를 봅니다',
      '목록의 "수정"으로 정보를 바꾸고, 비밀번호를 잊으면 "비번 초기화", 퇴사하면 "삭제"를 씁니다',
      '같은 화면의 "발신번호"·"예약캠페인"·"발송통계"·"고객DB"·"구매이력" 탭에서 회사 전체 현황을 봅니다',
    ],
    blockers: [
      { symptom: '상단 메뉴에 "관리"가 없습니다', fix: '회사 관리자 계정에서만 보입니다. 관리자에게 권한을 요청하세요' },
      { symptom: '"분류 코드가 등록되지 않았습니다"라고 뜹니다', fix: '분류 코드를 쓰지 않는 회사면 정상입니다. 직원은 전체 고객을 보게 됩니다' },
    ],
    entry: { path: '/manage', via: '상단 메뉴 "관리" → "사용자" 탭' },
    planKey: null,
    creditSource: null,
    related: ['sender-register', 'manage-unsubscribes'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/ManagePage.tsx · frontend/src/components/manage/UsersTab.tsx · frontend/src/components/DashboardHeader.tsx(isCompanyAdmin)',
  },
  {
    id: 'ai-column-mapping',
    title: 'AI로 컬럼 맞추기',
    goal: '파일 제목 행을 표준 항목에 AI가 자동으로 맞춘다',
    keywords: ['컬럼 매핑', '항목 맞추기', '열 맞추기', '자동 매핑', 'AI 매핑', '제목 행', '필드 매칭', '컬럼 맞추기'],
    steps: [
      '"고객 DB 업로드"에서 파일을 올리면 읽는 동안 컬럼을 자동으로 맞춥니다. 파일 첫 줄이 컬럼 이름이어야 합니다',
      '"찾은 컬럼"과 "미리보기"를 확인하고 "AI로 컬럼 맞추기"를 누르면 "컬럼 맞추기" 단계로 넘어갑니다',
      '"기본 항목"의 칸을 눌러 엑셀 컬럼을 고릅니다. AI가 맞춘 결과가 틀리면 여기서 바꿉니다',
      '기본 항목에 없는 컬럼은 "직접 만든 항목"에 이름을 붙여 저장합니다. 최대 15개입니다',
      '"아직 배정하지 않은 컬럼"이 비면 저장합니다',
    ],
    blockers: [
      { symptom: '"전화번호 컬럼을 맞춰야 저장할 수 있습니다"라고 뜹니다', fix: '전화번호는 필수입니다. "기본 항목"의 전화번호 칸에 엑셀의 번호 컬럼을 직접 고르세요' },
      { symptom: 'AI가 맞춘 항목이 틀렸습니다', fix: '"컬럼 맞추기" 단계에서 그 칸을 눌러 올바른 엑셀 컬럼으로 바꾸면 됩니다. 저장 전까지 몇 번이든 고칠 수 있습니다' },
    ],
    entry: { path: '/dashboard', via: '"고객 DB 업로드" 안 "AI로 컬럼 맞추기"', open: 'upload=1' },
    planKey: 'ai_mapping',
    creditSource: 'ai-column-mapper',
    related: ['upload-customers', 'view-customer'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/FileUploadMappingModal.tsx · backend/src/utils/ai-column-mapper.ts',
  },
  {
    id: 'connect-shop',
    title: '우리 몰과 연결하기',
    goal: '자사몰 주문·행동이 고객 기록에 자동으로 들어온다',
    keywords: ['자사몰', '카페24', '고도몰', '네이버', '쇼핑몰 연동', '연동', '자동 수집', '메이크샵', '아임웹', '스마트스토어'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "자사몰 연동" 카드를 누릅니다',
      '쓰는 몰을 고릅니다. 카페24·아임웹은 쇼핑몰 ID(사이트 코드)를 넣고 "연동하기"를 누르면 새 창에서 로그인과 동의를 거친 뒤 이 화면을 새로고침합니다',
      '네이버 스마트스토어·메이크샵·고도몰은 그 몰의 관리자에서 발급한 ID와 시크릿(또는 인증키)을 넣어 연동합니다',
      '직접 만든 몰이나 목록에 없는 몰은 "자체 호스팅 · 그 외 모든 몰"에서 webhook_secret을 발급받아 몰 서버에 저장합니다. 발급 화면을 닫으면 다시 볼 수 없으니 그 자리에서 저장하세요',
      '"수집 허용 도메인"에 몰 주소를 추가하고 "SDK 설치 스크립트"를 몰에 붙이면 방문·장바구니 같은 행동이 들어옵니다',
      '연동 뒤 확인 버튼으로 주문이 들어오는지 봅니다. 이후 "고객 한 명 이력 보기"에 구매와 행동이 쌓입니다',
    ],
    blockers: [
      { symptom: '"유료 요금제부터 이용 가능합니다"라고 뜹니다', fix: '자사몰 연동은 요금제에 따라 열립니다. 요금제 안내를 확인하세요' },
      { symptom: '도메인·앱 등록이나 키 발급 버튼이 눌리지 않습니다', fix: '등록과 발급은 회사 관리자 계정만 할 수 있습니다' },
      { symptom: '인앱 메시지가 네이버 스마트스토어에 안 뜹니다', fix: '네이버 스마트스토어는 데이터 연동만 되고 인앱 표시는 지원하지 않습니다' },
    ],
    entry: { path: '/cdp-settings', via: '대시보드 "AI Operator" → "자사몰 연동"' },
    planKey: 'ai_cdp',
    creditSource: null,
    related: ['upload-customers', 'view-customer', 'inapp-message'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/CdpSettingsPage.tsx',
  },
  {
    id: 'segments',
    title: '고객 묶음 저장하기',
    goal: '자주 쓰는 조건을 저장해 두고 다시 꺼내 쓴다',
    keywords: ['세그먼트', '고객 그룹', '묶음', '조건 저장', '그룹 만들기', '타겟 저장', '저장된 조건'],
    steps: [
      '대시보드 "AI Operator" → "AI 메모리"로 들어가 위쪽의 "세그먼트"를 누릅니다',
      '"신규 세그먼트 생성"의 "조건 자연어 입력"에 "30일 안 구매하지 않은 30대 여성"처럼 적고 생성합니다. "빠른 시작 예시"를 눌러도 됩니다',
      '"AI 해석"과 "매칭 결과" 인원, "샘플 5건 미리보기"로 제대로 뽑혔는지 확인합니다',
      '세그먼트 이름을 넣고 저장합니다. 저장한 조건은 발송할 때 다시 골라 쓸 수 있습니다',
      '목록에서 펼치면 지금 매칭되는 인원과 샘플을 다시 볼 수 있고, 안 쓰는 조건은 삭제합니다',
    ],
    blockers: [
      { symptom: '매칭 결과가 0명입니다', fix: '조건에 쓴 항목(지역·등급·구매일)이 올려 둔 고객 파일에 있어야 합니다. 없는 항목으로는 0명이 됩니다' },
      { symptom: '삭제하려니 발송에 영향이 있다고 합니다', fix: '그 세그먼트를 쓰는 발송이 있으면 추출 결과가 달라질 수 있다는 안내입니다. 확인 뒤 삭제하면 됩니다' },
    ],
    entry: { path: '/segments', via: '"AI 메모리" 화면 위쪽 "세그먼트"' },
    planKey: 'target_send',
    creditSource: 'ai-segment-generator',
    related: ['send-target', 'upload-customers'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/SegmentsPage.tsx · frontend/src/pages/AiMemoryPage.tsx(세그먼트 버튼)',
  },
  {
    id: 'check-spam',
    title: '보내기 전 스팸 확인하기',
    goal: '통신사별 실제 휴대폰에 먼저 보내 스팸함에 걸리는지 본다',
    keywords: ['스팸', '스팸필터', '스팸 테스트', '차단 확인', '스팸함', '필터 테스트', '스팸필터테스트', '통신사 차단'],
    steps: [
      '상단 메뉴 "직접발송"에서 수신번호를 먼저 올리고 발신번호와 내용을 채웁니다',
      '내용 아래 "스팸필터테스트"를 누르면 "스팸필터 점검" 창이 열립니다',
      '"점검 시작"을 누르면 통신사별 실제 휴대폰으로 같은 내용이 나가고, 통신사마다 정상인지 차단인지 표시됩니다',
      '기다리기 싫으면 "백그라운드로 전환"으로 닫아 두고, 결과는 "내 테스트 이력"에서 다시 봅니다',
      '차단이 나오면 문구를 고쳐 "재테스트"합니다. 결과는 참고용이라 실제 도착을 보장하지는 않습니다',
    ],
    blockers: [
      { symptom: '"발송리스트를 먼저 업로드해주세요"라고 뜹니다', fix: '수신번호가 한 건이라도 있어야 테스트가 됩니다. 번호를 넣은 뒤 다시 누르세요' },
      { symptom: '"이미 진행 중인 테스트가 있습니다"라고 뜹니다', fix: '테스트는 한 번에 하나만 돕니다. 앞 테스트가 끝난 뒤 다시 시작하세요' },
      { symptom: '버튼에 자물쇠가 있고 요금제 안내가 뜹니다', fix: '스팸 확인은 요금제에 따라 열립니다. 요금제 안내를 확인하세요' },
    ],
    entry: { path: '/dashboard', via: '"직접발송" 안 "스팸필터테스트"', open: 'open=direct-send' },
    planKey: 'spam_filter',
    creditSource: null,
    related: ['send-direct', 'auto-spam-test', 'write-copy-ai'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/DirectSendPanel.tsx(handleSpamFilter) · frontend/src/components/SpamFilterTestModal.tsx',
  },
  {
    id: 'auto-spam-test',
    title: '발송 전 자동 스팸 검사',
    goal: 'AI가 만든 문안은 나가기 전에 스팸 검사를 자동으로 거친다',
    keywords: ['자동 스팸', '자동 검사', '스팸 자동', '발송 전 검사', '자동 필터', 'AI 문안 스팸', '재생성'],
    steps: [
      '따로 켤 것은 없습니다. "자동 마케팅"과 "마케팅 플래너"가 문안을 확정하면 발송 전에 스스로 돌립니다',
      '확정된 문안을 통신사별 실제 휴대폰으로 먼저 보내 차단 여부를 봅니다',
      '차단되면 AI가 문안을 다시 쓰고 다시 검사합니다. 이것을 최대 두 번 반복합니다',
      '끝내 통과하지 못하면 자동으로 내보내지 않고 담당자 검토로 넘깁니다',
    ],
    blockers: [
      { symptom: '제안이 자동으로 나가지 않고 검토 대기로 남았습니다', fix: '두 번 다시 써도 차단된 문안입니다. 내용을 직접 고쳐 승인하거나 "보내기 전 스팸 확인하기"로 직접 확인하세요' },
    ],
    entry: { path: '/continuous-operator', via: '"자동 마케팅"이 문안을 확정할 때 자동으로' },
    planKey: 'auto_spam_test',
    creditSource: null,
    related: ['check-spam', 'auto-marketing', 'marketing-planner'],
    status: 'ready', stubUntil: null,
    sourceFile: 'backend/src/utils/spam-test-queue.ts(autoSpamTestWithRegenerate) · backend/src/utils/continuous-operator.ts · backend/src/utils/planner-executor.ts',
  },
  {
    id: 'ai-operator',
    title: '한 줄로 캠페인 맡기기',
    goal: '목표를 한 줄 적으면 대상·문안·시간을 AI가 정해 준다',
    keywords: ['AI Operator', '오퍼레이터', '한 줄', '자연어', '알아서 캠페인', 'AI 자동발송', '맞춤 캠페인', '제안서'],
    steps: [
      '대시보드 "AI Operator" 카드를 누릅니다',
      '입력칸에 "최근 30일 미구매 VIP에게 재구매 안내 보내줘"처럼 목표를 한 줄(5자 이상) 적고 제출합니다. 이미지 버튼으로 행사 이미지에서 문안을 불러올 수도 있습니다',
      'AI가 대상·문안·발송 시점을 담은 제안서를 만듭니다. 문안 후보 중 하나를 고르고 "(광고)" 표기와 제목을 확인합니다',
      '발송 시점을 "AI 추천 시점 사용"·"지금 즉시 발송"·"직접 시점 선택" 중에서 고릅니다. 발송 허용 시간은 08:00부터 21:00까지입니다',
      '"활용 가능 컬럼"에서 이름·등급 같은 고객 정보를 골라 문안에 녹일 수 있습니다',
      '"승인 후 발송 시작"을 누르면 나갑니다. 마음에 안 들면 "다시 생성"이나 수정 요청 한 줄로 고칩니다',
    ],
    blockers: [
      { symptom: '"조건에 맞는 고객이 없습니다"라고 뜹니다', fix: '목표에 쓴 조건에 해당하는 고객이 올려 둔 명단에 없습니다. 조건을 넓혀 다시 적으세요' },
      { symptom: '고객 데이터를 먼저 올리라는 창이 뜹니다', fix: '고객 명단이 비어 있으면 제안을 만들 수 없습니다. "엑셀로 고객 명단 올리기"부터 하세요' },
      { symptom: '"활용 가능 컬럼"이 비어 있습니다', fix: '고객 데이터가 있어야 개인화 컬럼이 표시됩니다' },
    ],
    entry: { path: '/ai-operator', via: '대시보드 "AI Operator" 카드' },
    planKey: 'ai_premium',
    creditSource: 'orchestrate',
    related: ['auto-marketing', 'write-copy-ai', 'upload-customers'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AiOperatorPage.tsx',
  },
  {
    id: 'mobile-dm',
    title: '모바일 DM 만들기',
    goal: '사진과 버튼이 있는 모바일 페이지를 만들어 링크로 보낸다',
    keywords: ['모바일 DM', 'DM', '카드형', '링크 페이지', '이미지 메시지', '랜딩', '모바일 페이지', 'DM 빌더'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "모바일 DM" 카드를 누릅니다',
      '"자연어 한 줄로 DM 자동 생성"에 만들 내용을 한 줄 적고 Enter를 누르면 AI가 섹션과 문구를 만들어 편집 화면으로 들어갑니다',
      '"빠른 시작"의 시나리오 카드를 누르면 그 주제로 바로 만들어집니다. "자유 시작"은 빈 캔버스, 이미지 업로드는 완성 이미지를 슬라이드 DM으로, "라이브러리 불러오기"는 저장 소재로 만듭니다',
      '편집 화면에서 카드 단위로 문구·이미지·버튼을 고칩니다. "AI 추천 액션"을 누르면 한 번에 정정됩니다',
      '발행하면 링크가 생깁니다. "복사"로 링크를 가져가거나 "타겟 고객에게 발송"으로 바로 문자에 실어 보냅니다',
      '"내 DM 현황"에서 만든 DM과 열람 반응을 봅니다',
    ],
    blockers: [
      { symptom: '"요금제 전용 기능" 안내가 뜹니다', fix: '모바일 DM은 요금제에 따라 열립니다. 요금제 안내를 확인하세요' },
      { symptom: '생성 버튼이 눌리지 않습니다', fix: '내용을 한 줄이라도 적어야 합니다. 이미지를 올리는 중에도 잠깁니다' },
      { symptom: '편집 중 나가려니 확인 창이 뜹니다', fix: '저장되지 않은 편집이 있다는 뜻입니다. "계속 편집"으로 돌아가 저장하거나 "나가기"로 버립니다' },
    ],
    entry: { path: '/dm-builder', via: '대시보드 "AI Operator" → "모바일 DM"' },
    planKey: 'mobile_dm',
    creditSource: 'dm-builder',
    related: ['image-studio', 'send-direct', 'quick-campaign'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/DmBuilderPage.tsx',
  },
  {
    id: 'image-studio',
    title: '이미지 만들기',
    goal: '상품 사진으로 배경·소재 이미지를 AI가 만든다',
    keywords: ['이미지', '사진 생성', '배경', '소재', '이미지 스튜디오', 'AI 이미지', '썸네일', '포스터', '배경 제거'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "이미지 스튜디오" 카드를 누릅니다',
      '"제품 포스터"(내 상품이 주인공)와 "행사 포스터"(행사명과 문구만으로) 중 하나를 고르고 템플릿을 고릅니다',
      '"포스터에 들어갈 문구"에 작은 라벨·헤드라인·부제를 적습니다. 예시 속 글자 자리에 그대로 새겨집니다. 혜택과 수치는 AI가 만들지 않으니 직접 적습니다',
      '제품 포스터면 상품 사진을 고르거나 올립니다. 배경은 자동으로 제거됩니다. "장면 힌트"는 선택입니다',
      '생성 버튼을 누르면 완성 포스터가 나옵니다. 저장하면 라이브러리에 들어가고, "AI 수정"으로 배경·무드를 바꾸거나 4K로 다시 받을 수 있습니다',
      '"이 소재로 바로 만들기"에서 인앱·DM·이메일로 이어 만들 수 있고, MMS로 보낼 때는 발송 화면의 "라이브러리에서 가져오기"로 첨부하면 규격에 맞게 자동 변환됩니다',
    ],
    blockers: [
      { symptom: '"크레딧이 부족합니다"라고 뜹니다', fix: '생성과 수정마다 크레딧이 듭니다. 충전한 뒤 다시 시도하세요' },
      { symptom: '"다른 생성이 진행 중입니다"라고 뜹니다', fix: '한 번에 하나만 만듭니다. 앞 생성이 끝난 뒤 다시 누르세요' },
      { symptom: '"이 상품은 이미지가 없어요"라고 뜹니다', fix: '사진이 없는 상품은 쓸 수 없습니다. 다른 상품을 고르거나 사진을 직접 올리세요' },
    ],
    entry: { path: '/image-studio', via: '대시보드 "AI Operator" → "이미지 스튜디오"' },
    planKey: 'ai_premium',
    creditSource: 'image-studio-generate',
    related: ['mobile-dm', 'quick-campaign', 'inapp-message'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/ImageStudioPage.tsx',
  },
  {
    id: 'email-campaign',
    title: '이메일 캠페인 보내기',
    goal: '이메일을 만들어 보내고 열람·클릭을 본다',
    keywords: ['이메일', '메일 발송', '뉴스레터', 'email', '메일 캠페인', '이메일 추적', 'SMTP', '오픈율'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "Email 캠페인" 카드를 누릅니다',
      '처음이면 메일 서버(SMTP)를 먼저 등록합니다. "메일 서버 선택"에서 쓰는 메일을 고르면 서버·포트가 채워지고, 사용자 이메일과 앱 비밀번호, 발신 이메일을 넣습니다. "테스트 발송"으로 내 메일에 도착하는지 확인합니다',
      '"AI로 이메일 만들기"에 한 줄 적으면 제목·본문이 만들어집니다. "템플릿에서 시작"·"비주얼로 만들기"·"라이브러리에서 시작"도 됩니다',
      '편집 화면에서 제목·본문을 다듬고 광고성이면 "광고성 이메일"을 켭니다. (광고) 표기와 수신거부 링크가 자동으로 붙습니다. 완성 저장을 해야 발송이 열립니다',
      '발송에서 등급을 고르거나 조건을 자연어로 추출하거나 이메일을 직접 넣고, "즉시 발송"이나 "예약 발송"을 고릅니다. 이메일 없음·수신거부·무효 고객은 자동으로 빠집니다',
      '목록에서 발송·오픈·클릭·반송을 보고, "미수신자 재발송"으로 안 연 사람에게 한 번 더 보낼 수 있습니다',
    ],
    blockers: [
      { symptom: '"SMTP 설정 미완료: Email 캠페인 발송 불가"라고 뜹니다', fix: '메일 서버를 먼저 등록해야 합니다. 등록 뒤 "테스트 발송"이 도착하면 발송이 열립니다' },
      { symptom: '목록에 "완성 전"이 붙어 있고 발송이 안 됩니다', fix: '초안 상태입니다. 편집 화면에서 완성 저장을 해야 발송 버튼이 열립니다' },
      { symptom: '"직접 입력 필요"가 붙어 있습니다', fix: '본문에 혜택 자리가 비어 있습니다. AI는 혜택을 정하지 않으니 그 자리를 직접 채우세요' },
    ],
    entry: { path: '/email-campaigns', via: '대시보드 "AI Operator" → "Email 캠페인"' },
    planKey: 'ai_premium',
    creditSource: 'email-campaign-complete',
    related: ['write-copy-ai', 'performance', 'image-studio'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/EmailCampaignsPage.tsx',
  },
  {
    id: 'inapp-message',
    title: '자사몰 안에 띄우기',
    goal: '자사몰 방문자에게 배너·팝업을 띄운다',
    keywords: ['인앱', '팝업', '배너', '자사몰 팝업', '사이트 안에', '인앱 메시지', '슬라이드', '웹 팝업'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "인앱메시지" 카드를 누릅니다. 이 카드는 회사 관리자 계정에만 보입니다',
      '"빠른 시작"에서 시나리오를 고르면 AI가 제목·본문·띄울 시점까지 만듭니다. "직접 만들기"에서는 "웹 자사몰 팝업"이나 "모바일 앱 인앱"을 골라 빈 편집기로 시작합니다',
      '편집 화면에서 제목·본문·형태(모달·슬라이드·토스트·플로팅)와 강조색을 정하고, 오른쪽 미리보기로 확인합니다',
      '띄울 조건을 정합니다. 페이지 로드·장바구니 담음·결제 시작·스크롤 도달·페이지 체류·이탈 의도 중에서 고르고, 세션당 1회 같은 빈도와 표시 시간대를 넣습니다',
      '등급·지역이나 자연어 조건으로 볼 사람을 좁힐 수 있습니다. 저장하면 자사몰에 표시되고 목록에서 표시·클릭·닫힘을 봅니다',
    ],
    blockers: [
      { symptom: '"표시할 쇼핑몰 연동 필요"라고 뜹니다', fix: '웹 자사몰에 띄우려면 먼저 "우리 몰과 연결하기"를 하고 몰에 SDK를 설치해야 합니다. "쇼핑몰 연동하러 가기"를 누르세요' },
      { symptom: '혜택 안내 자리가 비어 저장이 안 됩니다', fix: 'AI는 혜택을 정하지 않습니다. 그 자리를 회사 정책에 맞게 직접 쓴 뒤 저장하세요' },
      { symptom: '네이버 스마트스토어에는 뜨지 않습니다', fix: '네이버 스마트스토어는 데이터 연동만 되고 인앱 표시는 지원하지 않습니다' },
    ],
    entry: { path: '/inapp-messages', via: '대시보드 "AI Operator" → "인앱메시지"' },
    planKey: 'ai_cdp',
    creditSource: 'inapp-publish',
    related: ['connect-shop', 'image-studio', 'quick-campaign'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/InAppMessagesPage.tsx · frontend/src/constants/ai-operator-modules.ts(adminOnly)',
  },
  {
    id: 'quick-campaign',
    title: '전 채널 초안 한 번에',
    goal: '행사 내용 하나로 DM·이메일·인앱 초안이 한 번에 나온다',
    keywords: ['원클릭', '한 번에', '전 채널', '빠른 캠페인', '행사 초안', '원클릭 캠페인', '행사 캠페인', '이미지로 불러오기', '퀵 캠페인'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "원클릭 캠페인" 카드를 누르면 바로 입력 창이 열립니다',
      '"행사 내용"에 행사명·기간·대상·혜택을 자유롭게 붙여 넣습니다. 상품 목록이나 행사 안내 이미지를 올리면 AI가 보이는 내용을 읽어 대신 채워 줍니다',
      '만들 채널을 고릅니다. 모바일 DM·이메일·인앱 메시지 중 여러 개를 한 번에 고를 수 있습니다',
      '생성을 누르면 고른 채널마다 초안이 만들어집니다. 크레딧은 성공한 채널만 듭니다',
      '초안은 임시 보관되므로 창을 닫았다가 "새 캠페인 시작" 위의 재개 표시에서 이어서 다듬을 수 있습니다',
    ],
    blockers: [
      { symptom: '채널 하나에 자물쇠가 있어 고를 수 없습니다', fix: '그 채널이 지금 요금제에서 잠겨 있거나 준비가 안 된 것입니다. 다른 채널만 골라 만들 수 있습니다' },
      { symptom: '"이미지를 먼저 올려주세요"라고 뜹니다', fix: '이미지로 불러오기는 이미지를 올린 뒤에 눌러야 합니다' },
    ],
    entry: { path: '/quick-campaign', via: '대시보드 "AI Operator" → "원클릭 캠페인"' },
    planKey: 'ai_premium',
    creditSource: 'one-step-interview',
    related: ['write-copy-ai', 'image-studio', 'mobile-dm'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/QuickCampaignPage.tsx · frontend/src/components/EventCampaignModal.tsx',
  },
  {
    id: 'journeys',
    title: '사건 자동화 만들기',
    goal: '가입·구매 같은 사건이 생기면 정해진 순서로 메시지가 나간다',
    keywords: ['여정', '자동화', '시나리오', '가입하면 보내기', '구매 후', '순서대로', '여정 빌더', '자동발송', '생일 문자', '리마인드'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "여정 자동화" 카드를 누릅니다',
      '"마케팅 여정"·"정보 알림"·"날짜축 여정" 중 목적을 고릅니다. 목표를 한 줄 적거나 빠른 시작 카드를 누르면 AI가 단계(메시지·대기·조건)를 설계합니다',
      '"대화형 수정"에 "2단계 하루 늦추고 VIP만 보내줘"처럼 말로 고칩니다. 단계는 최대 7개입니다',
      '검토에서 "여정 이름"과 "회신번호"를 정합니다. 월간 예산과 단계당 비용 한도는 선택입니다. (광고) 표기·수신거부 번호·발송 가능 시간은 자동으로 맞춰집니다',
      '저장하면 초안이 되고 목록에서 활성화합니다. 활성화 전 "시뮬레이션 실행"으로 예상 발송 수와 비용을 보고, 켠 뒤에 생기는 사건부터 받습니다',
      '"오늘의 여정 기회"는 회사 데이터에서 비어 있는 여정을 찾아 권합니다',
    ],
    blockers: [
      { symptom: '"회사에 등록된 발신번호가 없습니다"라고 뜹니다', fix: '여정을 켜려면 발신번호가 있어야 합니다. "발신번호 등록하기"부터 하세요' },
      { symptom: '빠른 시작 카드가 잠겨 있습니다', fix: '그 여정이 쓰는 사건(구매·예약 등)이 고객 데이터에 아직 없다는 뜻입니다. 자사몰을 연결하거나 그 항목이 있는 명단을 올리세요' },
      { symptom: '활성화했는데 기존 고객에게는 안 나갑니다', fix: '여정은 켠 뒤에 생기는 사건부터 받습니다. 이미 가입한 고객에게 한 번 보내려면 "조건으로 대상 골라 보내기"를 쓰세요' },
    ],
    entry: { path: '/ai-journeys', via: '대시보드 "AI Operator" → "여정 자동화"' },
    planKey: 'auto_campaign',
    creditSource: 'journey-activate',
    related: ['auto-marketing', 'marketing-planner', 'sender-register'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/JourneysPage.tsx',
  },
  {
    id: 'marketing-planner',
    title: '한 달 계획 맡기기',
    goal: '월간 행사 계획을 적으면 AI가 대행한다',
    keywords: ['플래너', '월간 계획', '한 달', '대행', '마케팅 플래너', '월 계획', '행사 담기', '행사 일정'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "마케팅 플래너" 카드를 누릅니다',
      '날짜를 누르거나 행사 담기로 "행사명"·"시작일"·"종료일"을 넣습니다. "혜택 문구"는 직접 적습니다. AI가 대신 만들지 않습니다',
      '"채널과 시점"에서 문자·DM·이메일 등 채널과 보낼 시점을 고릅니다. 저장하면 "행사가 캘린더에 담겼습니다"가 뜹니다',
      '"실행 예정"에 채널별 발송 일정이 순서대로 섭니다. 항목을 누르면 실제 발송 문안과 발행된 소재, 대상을 봅니다',
      '"AI 추천으로 채우기"를 누르면 마케팅 달력으로 가서 1년치 행사를 AI가 설계해 줍니다',
    ],
    blockers: [
      { symptom: '채널이 잠겨 있어 고를 수 없습니다', fix: '그 채널이 지금 요금제에서 닫혀 있거나 발신번호·연동 같은 준비가 안 된 것입니다. 채널 옆 안내를 확인하세요' },
      { symptom: '"준비 중입니다"라고 뜨고 저장이 안 됩니다', fix: '잠시 후 다시 시도하세요. 계속 그러면 문의를 남겨 주세요' },
      { symptom: '저장했는데 크레딧이 안 빠집니다', fix: '정상입니다. 저장만으로는 차감되지 않고 채널 제작이 실행될 때 듭니다' },
    ],
    entry: { path: '/marketing-planner', via: '대시보드 "AI Operator" → "마케팅 플래너"' },
    planKey: 'ai_premium',
    creditSource: 'planner-monthly-agency',
    related: ['marketing-calendar', 'journeys', 'auto-marketing'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/MarketingPlannerPage.tsx',
  },
  {
    id: 'marketing-calendar',
    title: '마케팅 달력 보기',
    goal: '1년치 행사와 발송 계획을 AI가 설계해 달력에 담는다',
    keywords: ['마케팅 캘린더', '달력', '행사 달력', '일정', '캘린더 설계', '1년 계획', '연간 계획', '시즌'],
    steps: [
      '"마케팅 플래너" 위쪽의 "AI 추천으로 채우기"를 누르면 마케팅 캘린더로 갑니다',
      '설계를 시작하면 업종·시즌·회사 데이터로 1년치 캠페인을 AI가 만듭니다. 창을 닫지 말고 기다립니다',
      '달마다 발송일·대상을 확인하고 "혜택"을 직접 적습니다. 비워 두면 발송 2일 전에 입력 안내 문자가 가고, 안 넣으면 자동으로 나가지 않습니다',
      '마음에 안 드는 달은 다시 설계합니다. 고른 달을 등록하면 연 1회 캠페인이 되어 "자동 마케팅"에서 관리합니다',
      '"발송 안내 받을 담당자 연락처"를 넣어 두면 발송 2시간 전에 문안·대상·비용 안내와 승인 요청이 그 번호로 갑니다',
    ],
    blockers: [
      { symptom: '등록이 실패합니다', fix: '설계와 다시 설계는 매회, 등록은 건당 크레딧이 듭니다. 크레딧과 권한을 확인하세요' },
      { symptom: '등록한 캠페인이 발송일에 안 나갔습니다', fix: '혜택을 비운 채로는 자동 발송되지 않습니다. 발송 2일 전 안내 문자에 따라 혜택을 넣으세요' },
    ],
    entry: { path: '/marketing-calendar', via: '"마케팅 플래너" 위쪽 "AI 추천으로 채우기"' },
    planKey: 'ai_premium',
    creditSource: 'marketing-calendar',
    related: ['marketing-planner', 'auto-marketing'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/MarketingCalendarPage.tsx · frontend/src/pages/MarketingPlannerPage.tsx(진입 버튼)',
  },
  {
    id: 'performance',
    title: '성과와 다음 수 보기',
    goal: '최근 30일 성과와 다음에 할 캠페인을 추천받는다',
    keywords: ['성과', '리포트', '성과 리포트', '30일', '분석', '다음 추천', '성과 보기', '보고서', '매출', 'ROAS'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "성과리포트" 카드를 누릅니다',
      '위쪽 요약에서 발송 캠페인·지출·발송 후 7일 구매·귀속 매출을 보고, "Top 캠페인"에서 잘 된 것을 봅니다',
      '"AI 자율 진단 시작"을 누르면 최근 30일 성과의 원인과 1순위 권장이 나옵니다',
      '"채널 ROI 회복"·"시간대 최적화"·"최고 성과 복제"를 누르면 그 제안대로 캠페인이 설계되고, 검토 뒤에 보냅니다',
      '회사 보고용이 필요하면 "풀분석 보고서"에서 기간과 초점을 정해 "분석 실행"합니다. 보통 1~3분 걸리고 창을 닫아도 진행됩니다',
    ],
    blockers: [
      { symptom: '"발송 캠페인 없음. 첫 캠페인 발송 후 활성"이라고 뜹니다', fix: '성과는 발송이 있어야 생깁니다. 첫 발송 뒤에 다시 여세요' },
      { symptom: '"본 기능은 요금제 가입 후 이용 가능합니다"라고 뜹니다', fix: '성과 리포트는 요금제에 따라 열립니다. 요금제 안내를 확인하세요' },
      { symptom: '풀분석이 시작되지 않습니다', fix: '풀분석은 크레딧이 많이 듭니다. 잔여 크레딧을 확인하세요' },
    ],
    entry: { path: '/performance', via: '대시보드 "AI Operator" → "성과리포트"' },
    planKey: 'ai_premium',
    creditSource: 'performance-explainer',
    related: ['check-results', 'predictive', 'auto-marketing'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/PerformancePage.tsx',
  },
  {
    id: 'predictive',
    title: '이탈·구매 예측 보기',
    goal: '누가 떠날 것 같고 누가 살 것 같은지 AI가 점수를 매긴다',
    keywords: ['예측', '이탈', '구매 예측', '점수', 'AI 예측', '떠날 고객', '이탈 위험', '구매 가능성', 'LTV'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "AI 자율 예측" 카드를 누릅니다',
      '매일 1회 자동으로 분석됩니다. 따로 돌릴 것은 없고 필요하면 다시 계산 버튼을 누릅니다',
      '"AI가 발견한 고객 그룹"에서 위험·기회 그룹을 보고 "캠페인 만들기"를 누르면 그 그룹으로 캠페인이 시작됩니다',
      '"고객 목록"에서 고객마다 클릭·이탈 위험·구매 가능성·LTV·다음 구매·선호 채널을 봅니다. 이름·연락처·등급으로 검색합니다',
      '고객을 누르면 "왜 이렇게 예측했나"에서 영향 요인과 AI 1순위 권장을 봅니다',
    ],
    blockers: [
      { symptom: '"아직 뚜렷한 그룹을 찾지 못했습니다"라고 뜹니다', fix: '발송과 반응이 쌓여야 그룹이 나옵니다. 몇 번 보낸 뒤 다시 보세요' },
      { symptom: '숫자 옆에 "추정"이 붙어 있습니다', fix: '데이터가 적어 등급·활동으로 추정한 값입니다. 발송이 쌓이면 실제 데이터로 바뀝니다' },
    ],
    entry: { path: '/predictive', via: '대시보드 "AI Operator" → "AI 자율 예측"' },
    planKey: 'ai_premium',
    creditSource: 'predictive-daily',
    related: ['performance', 'send-target', 'view-customer'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/PredictiveDashboardPage.tsx',
  },
  {
    id: 'ai-explain',
    title: '왜 이런 결과인지 묻기',
    goal: '내 회사 수치에 대해 근거와 함께 답을 받는다',
    keywords: ['왜', '이유', '설명', '수치 질문', '몇 명', '얼마나', 'AI 설명', '근거', '질문하기'],
    steps: [
      '메뉴에 버튼이 없습니다. 주소창의 주소 끝을 /ai-explain 으로 바꿔 엽니다. 실험실 기능입니다',
      '"질문"에 5자 이상 적고 "질문"을 누릅니다. Ctrl+Enter로도 보냅니다. 예시 질문을 눌러도 됩니다',
      'AI가 회사 정보·30일 캠페인·학습 메모리·고객 통계만 참고해 답하고, 답 옆에 근거 출처를 인용합니다',
      '회사 데이터에 없는 것은 "정보 없음"으로 답합니다. 지어내지 않습니다',
    ],
    blockers: [
      { symptom: '"질문을 5자 이상 입력해주세요"라고 뜹니다', fix: '짧은 질문은 받지 않습니다. 무엇을 알고 싶은지 한 문장으로 적으세요' },
      { symptom: '답이 "정보 없음"입니다', fix: '그 내용이 회사 데이터에 없다는 뜻입니다. 발송과 고객 데이터가 쌓이면 답할 수 있는 범위가 넓어집니다' },
    ],
    entry: { path: '/ai-explain', via: '주소로 직접 이동(메뉴 없음 · 실험실)' },
    planKey: 'ai_premium',
    creditSource: 'performance-explainer',
    related: ['performance', 'view-customer', 'ai-memory'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AiExplainPage.tsx',
  },
  {
    id: 'send-calendar',
    title: '날짜별 발송 보기',
    goal: '어느 날 무엇을 보냈는지 달력으로 본다',
    keywords: ['발송 달력', '캘린더', '날짜별', '언제 보냈나', '발송 일정', '캠페인 캘린더', '월별 발송'],
    steps: [
      '메뉴에 버튼이 없습니다. 주소창의 주소 끝을 /calendar 로 바꿔 엽니다',
      '"이전달"·"다음달"로 달을 옮깁니다. 날짜 칸에 그날 캠페인이 상태 색(완료·예약·취소·진행중)으로 표시됩니다',
      '캠페인을 누르면 오른쪽에 상태·채널·대상·예약 시각이 열리고, 완료 건은 발송·성공·실패 수가 보입니다',
      '자세한 수신 결과는 상단 메뉴 "발송결과"에서 봅니다',
    ],
    blockers: [
      { symptom: '날짜에 캠페인이 안 보입니다', fix: '예약 시각이 있으면 그 날짜에, 없으면 만든 날짜에 표시됩니다. 다른 달에 있을 수 있습니다' },
      { symptom: '"편집"·"복제"를 눌러도 반응이 없습니다', fix: '이 화면은 보기 전용입니다. 예약 건 수정은 "발송결과"에서 하세요' },
    ],
    entry: { path: '/calendar', via: '주소로 직접 이동(메뉴 없음)' },
    planKey: 'basic_send',
    creditSource: null,
    related: ['check-results', 'schedule-send'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/CalendarPage.tsx',
  },
  {
    id: 'marketing-diagnosis',
    title: '마케팅 진단 받기',
    goal: '몇 가지 질문에 답하면 우리 마케팅 상태와 첫 과제가 나온다',
    keywords: ['진단', '마케팅 진단', '문진', '상태 점검', '첫 과제', '체크', '진단서', '체험'],
    steps: [
      '대시보드의 "우리 마케팅, 지금 진단받아 보세요" 카드에서 "진단 시작"을 누릅니다',
      '약 3분 동안 질문에 답합니다. 답변을 바탕으로 잘하는 것과 아쉬운 것을 짚은 진단서가 나옵니다',
      '진단서의 추천 기능과 첫 과제를 보고 "첫 발송 해보기"로 바로 이어갑니다',
      '로그인 전 사용자는 로그인 화면의 진단 링크에서 같은 진단을 받고 리포트를 신청할 수 있습니다',
    ],
    blockers: [
      { symptom: '대시보드에 진단 카드가 없습니다', fix: '이미 진단을 끝냈거나 대상이 아닌 계정입니다. 끝낸 진단은 카드 자리가 리포트 안내로 바뀝니다' },
      { symptom: '"체험이 진행 중이에요"라고 뜹니다', fix: '진단 뒤 체험 기간입니다. 남은 날짜가 카드에 표시되고 그동안 추천 기능을 써 볼 수 있습니다' },
    ],
    entry: { path: '/dashboard', via: '대시보드 "진단 시작" 카드', open: 'open=diagnosis' },
    planKey: null,
    creditSource: null,
    related: ['campaign-agency', 'send-direct', 'auto-marketing'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/components/marketing-diagnosis/DiagnosisHeroCard.tsx · frontend/src/pages/Dashboard.tsx · frontend/src/pages/DiagnosisPage.tsx(로그인 전 공개 진단)',
  },
  {
    id: 'campaign-agency',
    title: '캠페인 대행 신청하기',
    goal: '캠페인을 맡기면 제안서와 실행을 받는다',
    keywords: ['대행', '맡기기', '대신 해주세요', '캠페인 대행', '제안서', '에이전시', '설계 대행', '운영팀'],
    steps: [
      '상단 메뉴 "캠페인 대행"을 누릅니다',
      '"새 캠페인 대행 요청"에서 행사 내용·대상 상품·참고사항을 적고 행사 이미지를 올립니다. 이미지를 올리면 내용이 자동으로 채워집니다',
      '접수하면 운영팀이 확인하고 회사 데이터만으로 분석한 제안서를 준비합니다',
      '"접수 이력"에서 상태를 봅니다. 제안서가 전달되면 내려받아 확인하고 실행 여부를 정합니다',
    ],
    blockers: [
      { symptom: '상단 메뉴에 "캠페인 대행"이 없습니다', fix: '상위 요금제에서 열리는 서비스입니다. 요금제 안내를 확인하세요' },
      { symptom: '"필수 항목을 입력해 주세요"라고 뜹니다', fix: '행사명과 기간 같은 필수 칸이 비어 있습니다. 행사 종료일이 시작일보다 빠르면 접수되지 않습니다' },
    ],
    entry: { path: '/campaign-agency', via: '상단 메뉴 "캠페인 대행"' },
    planKey: null,
    creditSource: null,
    related: ['marketing-planner', 'marketing-diagnosis', 'ai-operator'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/CampaignAgencyPage.tsx · frontend/src/components/DashboardHeader.tsx(advancedAccess)',
  },
  {
    id: 'ai-memory',
    title: 'AI가 배운 것 보기',
    goal: 'AI가 우리 회사에 대해 누적한 것을 확인한다',
    keywords: ['AI 메모리', '학습', '기억', '누적', 'AI가 아는 것', '학습 메모리', '브랜드 학습', '톤'],
    steps: [
      '대시보드 "AI Operator"로 들어가 "AI 메모리" 카드를 누릅니다',
      '"AI 자율 진단"과 "5 학습 타입 분포", "AI 가장 자주 참고하는 학습 Top 10"에서 무엇이 쌓였는지 봅니다',
      '"자연어로 학습 메모리에 질문하기"에 "지난 30일 VIP에서 AI가 발견한 가장 강한 패턴은?"처럼 물어봅니다',
      '회사 관리자는 "직접 학습 추가"로 AI가 꼭 알아야 할 사실을 중요도와 함께 넣고, "오래된 학습 정리"로 낡은 것을 지웁니다',
      '위쪽 "세그먼트"·"AI 사용량" 버튼으로 관련 화면에 갑니다',
    ],
    blockers: [
      { symptom: '"회사 관리자 전용"이라고 뜨고 버튼이 잠겨 있습니다', fix: '학습 추가·정리·삭제는 회사 관리자만 합니다. 관리자에게 요청하세요' },
      { symptom: '"분석할 학습 데이터가 없습니다"라고 뜹니다', fix: 'AI 기능을 쓸수록 학습이 쌓입니다. 문안 생성·캠페인을 몇 번 돌린 뒤 다시 보세요' },
    ],
    entry: { path: '/ai-memory', via: '대시보드 "AI Operator" → "AI 메모리"' },
    planKey: 'ai_premium',
    creditSource: null,
    related: ['auto-marketing', 'segments', 'ai-usage'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AiMemoryPage.tsx',
  },
  {
    id: 'voice-inbound',
    title: '전화 문의 기록 보기',
    goal: '고객이 건 전화를 AI가 받고 기록한 내용을 본다',
    keywords: ['전화', '음성', '인바운드', '통화 기록', '전화 문의', 'ARS', '음성 응답', '통화 내용'],
    steps: [
      '메뉴에 버튼이 없습니다. 주소창의 주소 끝을 /voice-inbound 로 바꿔 엽니다. 실험실 기능입니다',
      '"활성으로 전환"을 누르면 고객이 자사몰에서 "전화 문의"를 눌러 건 전화에 AI가 응답합니다. 걸려 오는 전화만 받고 먼저 걸지는 않습니다',
      'AI는 연결된 고객 데이터에 있는 사실만 말합니다. 추측하지 않습니다',
      '"최근 통화 이력"에서 고객이 한 말과 AI 응답을 통화마다 확인합니다. 회원이 식별되면 표시가 붙습니다',
    ],
    blockers: [
      { symptom: '환경 설정이 미설정이라는 빨간 안내가 뜹니다', fix: '음성 인식·합성 설정이 서버에 없는 상태입니다. 운영자에게 설정 등록을 요청하세요' },
      { symptom: '통화 이력이 비어 있습니다', fix: '활성으로 바꾼 뒤 자사몰 사용자가 전화를 걸어야 쌓입니다' },
    ],
    entry: { path: '/voice-inbound', via: '주소로 직접 이동(메뉴 없음 · 실험실)' },
    planKey: null,
    creditSource: null,
    related: ['view-customer', 'connect-shop'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/VoiceInboundPage.tsx',
  },
  {
    id: 'push-campaign',
    title: '앱 푸시 보내기',
    goal: '자사몰 알림 구독자에게 브라우저 알림을 보낸다',
    keywords: ['푸시', '앱 알림', '푸시 알림', '앱 메시지', '푸시 캠페인', '알림 보내기', '웹 푸시', '브라우저 알림'],
    steps: [
      '메뉴에 버튼이 없습니다. 주소창의 주소 끝을 /push-campaigns 로 바꿔 엽니다. 실험실 기능입니다',
      '"활성 구독자" 수를 확인합니다. 자사몰에 알림 모듈을 설치하고 방문자가 알림을 허용해야 구독자가 생깁니다',
      '"새 Web Push 발송"에 제목(50자)과 본문(200자)을 적습니다. 누르면 갈 주소는 선택입니다',
      '발송 버튼을 누르면 확인 창이 뜨고, 확인하면 구독자 전원에게 나갑니다. "최근 발송 캠페인"에서 성공·실패를 봅니다',
    ],
    blockers: [
      { symptom: '발송 버튼이 잠겨 있고 "활성 구독자가 0건입니다"라고 뜹니다', fix: '구독자가 없으면 보낼 수 없습니다. 자사몰에 알림 모듈을 설치하고 방문자 동의를 먼저 받으세요' },
      { symptom: '"제목과 본문은 필수입니다"라고 뜹니다', fix: '둘 다 채워야 보낼 수 있습니다' },
    ],
    entry: { path: '/push-campaigns', via: '주소로 직접 이동(메뉴 없음 · 실험실)' },
    planKey: 'ai_cdp',
    creditSource: null,
    related: ['connect-shop', 'inapp-message'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/PushCampaignsPage.tsx',
  },
  {
    id: 'ai-usage',
    title: 'AI 사용량 보기',
    goal: '어디에 크레딧을 얼마나 썼는지 추세를 본다',
    keywords: ['사용량', 'AI 사용량', '크레딧 사용', '얼마나 썼나', '사용 내역', '비용 예측', '한도 알림'],
    steps: [
      '"AI 메모리" 화면 위쪽의 "AI 사용량"을 누릅니다. 대시보드 "AI 크레딧 잔여" 카드의 "사용 이력"은 차감 내역 창을 엽니다',
      '요약 카드에서 이번 달 호출과 전월 대비, 직전 30일 평균을 봅니다',
      '"자연어로 사용량 데이터에 질문하기"에 "이번 달 가장 비용이 많이 든 호출 출처는?"처럼 물어봅니다',
      '"한도 알림 설정"에서 임계 비율과 받을 채널을 켜 두면 한도에 가까워질 때 알림이 옵니다',
      '"자세히 분석"을 펼치면 출처별 호출·일별 비용·AI 추론 모드 분포가 나옵니다',
    ],
    blockers: [
      { symptom: '"AI 호출 한도 초과"라고 뜹니다', fix: '이번 달 한도를 다 썼습니다. 요금제와 크레딧 안내에서 충전이나 상향을 확인하세요' },
      { symptom: '"기능을 준비 중입니다"라고 뜹니다', fix: '잠시 후 다시 시도하세요. 계속되면 문의를 남겨 주세요' },
    ],
    entry: { path: '/ai-usage', via: '"AI 메모리" 화면 위쪽 "AI 사용량"' },
    planKey: null,
    creditSource: null,
    related: ['credits-and-plan', 'ai-memory'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AiUsagePage.tsx · frontend/src/pages/AiMemoryPage.tsx(진입 버튼)',
  },
  {
    id: 'ai-batches',
    title: 'AI 묶음 작업 보기',
    goal: '한 번에 처리한 AI 작업 묶음의 진행을 본다',
    keywords: ['배치', '묶음 작업', '대량 처리', 'AI 작업 현황', '작업 진행', '한꺼번에', '일괄 처리'],
    steps: [
      '메뉴에 버튼이 없습니다. 주소창의 주소 끝을 /ai-batches 로 바꿔 엽니다. 실험실 기능입니다',
      '직접 만들 것은 없습니다. 자동 마케팅이 대량 캠페인을 돌릴 때 AI 호출이 묶음으로 처리되고 여기에 쌓입니다',
      '묶음마다 제출됨·처리 중·완료·실패·만료 상태와 요청 수, 성공·에러 수를 봅니다',
      '처리 중인 묶음은 "상태 갱신"으로 바로 확인합니다. 대부분 1시간 안에 끝나고 길어도 24시간 안에 끝납니다',
    ],
    blockers: [
      { symptom: '"아직 처리된 batch가 없습니다"라고 뜹니다', fix: '자동 마케팅으로 대량 캠페인을 돌린 적이 없으면 비어 있는 것이 정상입니다' },
    ],
    entry: { path: '/ai-batches', via: '주소로 직접 이동(메뉴 없음 · 실험실)' },
    planKey: 'ai_premium',
    creditSource: null,
    related: ['ai-usage', 'auto-marketing'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AiBatchesPage.tsx',
  },
  {
    id: 'auto-send-legacy',
    title: '옛 자동발송 안내',
    goal: '옛 자동발송은 여정 자동화로 합쳐졌다',
    keywords: ['자동발송', '옛 자동발송', '매달 발송', '정기 발송', '반복 발송', '주기 발송', '매주 발송'],
    steps: [
      '옛 "자동발송" 메뉴는 없어졌고 그 기능은 "여정 자동화"로 합쳐졌습니다. 옛 주소로 들어가면 안내 화면만 나옵니다',
      '매주·매월 정시에 보내던 것은 "여정 자동화"의 "날짜축 여정"에서 매달 N일·매달 말일·매년 반복으로 만듭니다',
      '안내 화면의 "여정 빌더로 이동"을 누르면 바로 갑니다',
      '옛 자동발송으로 이미 돌고 있던 것은 끝날 때까지 그대로 나갑니다. 새로 만드는 것만 여정으로 합니다',
    ],
    blockers: [
      { symptom: '옛 자동발송을 새로 등록하려는데 안 됩니다', fix: '새 등록은 막혀 있습니다. "여정 자동화"에서 같은 내용을 만드세요' },
    ],
    entry: { path: '/auto-send', via: '옛 주소로 직접 이동(안내만)' },
    planKey: 'auto_campaign',
    creditSource: null,
    related: ['journeys'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AutoSendPage.tsx · frontend/src/components/journey/DateAnchorJourneyBuilder.tsx(반복 종류)',
  },
  // ★ 2026-08-22 대행발송(docs/2026-08-22-agency-send-design.md). 화면이 붙어 ready로 올렸다.
  //   steps는 실제 화면 순서, blockers는 코드가 실제로 내는 차단 문구에서 뽑았다.
  {
    id: 'agency-send',
    title: '대행발송 맡기기',
    goal: '명단과 문안을 맡기면 검사와 예약까지 대신 해 준다',
    keywords: ['대행발송', '대행 발송', '대신 보내기', '맡기기', '대행', '명단 보내기', '발송 대행', '요청 발송'],
    steps: [
      '상단 메뉴 "대행발송"을 누르고 "새 접수"를 누릅니다',
      '보낼 명단을 넣습니다. 엑셀이나 CSV를 올리거나 번호를 직접 붙여 넣습니다. 전화번호 열은 자동으로 골라 두니 다르면 바꿉니다',
      '문안과 제목을 쓰고, 필요하면 이미지를 넣습니다. 이름처럼 사람마다 다른 값은 퍼센트 기호로 감싸면 명단의 같은 이름 열에 자동으로 맞춰집니다',
      '보내는 번호와 보낼 시각, 테스트 문자를 받을 담당자 번호를 넣고 접수합니다',
      '검사를 마치면 담당자 번호로 문안이 그대로 옵니다. 확인한 뒤 목록에서 "승인하기"를 누르면 그 시각에 예약됩니다',
      '발송 2시간 전에 한 번 더 검사합니다. 그때 걸리면 예약을 취소하고 다듬은 문안으로 다시 승인을 받습니다',
    ],
    blockers: [
      { symptom: '"지금부터 3시간 뒤부터 정할 수 있습니다"라고 뜹니다', fix: '문안 검사와 승인, 발송 직전 재검사에 시간이 필요합니다. 더 뒤로 정하거나 급하면 직접발송을 쓰세요' },
      { symptom: '"등록되지 않은 보내는 번호입니다"라고 뜹니다', fix: '회사에 등록된 번호로만 보낼 수 있습니다. 발신번호 등록을 먼저 해 주세요' },
      { symptom: '승인했는데 발송되지 않았습니다', fix: '발송 2시간 전 검사에서 걸리면 예약이 취소되고 안내 문자가 갑니다. 다듬은 문안을 다시 승인해야 나갑니다' },
    ],
    entry: { path: '/agency-send', via: '상단 메뉴 "대행발송"' },
    planKey: null,
    creditSource: null,
    related: ['send-direct', 'check-spam', 'schedule-send'],
    status: 'ready', stubUntil: null,
    sourceFile: 'frontend/src/pages/AgencySendPage.tsx · frontend/src/components/agency/ · backend/src/utils/agency-send-worker.ts',
  },
];

/** 전체 카탈로그(불변) */
export const FEATURE_CATALOG: readonly FeatureJob[] = Object.freeze([...READY]);

/**
 * 문서화 대상이 아닌 라우트 — 사유와 함께. 게이트 2번(역방향 커버리지)이 이 목록 밖의 고객 라우트를 잡는다.
 * "나중에"를 여기 적지 않는다. 정의할 것이 없는 화면만 둔다.
 */
export const NOT_DOCUMENTED_ROUTES: Record<string, string> = {
  '/': '대시보드 진입(= /dashboard)',
  '/dashboard': '진입 화면 자체. 각 작업의 entry가 이 화면을 가리킨다',
  '/login': '로그인',
  '/terms': '약관',
  '/privacy': '개인정보처리방침',
  '/payment/result': '결제 결과 리다이렉트',
  '/cafe24/launch': '카페24 앱 진입 리다이렉트',
  '/journey-pause/:token': '고객이 받은 링크로 여는 일시중지 화면',
  '/onboarding': '기존 온보딩 마법사(봇이 딥링크로 부른다)',
  '/diagnosis': '로그인 전 공개 진단(로그인 화면 링크). 로그인 고객의 진입은 대시보드 카드(= marketing-diagnosis)',
  '/guide': '안내 화면 자체',
  '/guide/:jobId': '안내 화면 상세',
  '/admin': '슈퍼관리자',
  '/admin/ai-training': '슈퍼관리자',
  '/admin/alimtalk-senders': '슈퍼관리자',
  '/admin/best-copy': '슈퍼관리자',
  '/admin/campaign-agency': '슈퍼관리자',
  '/ai-journeys/:id': '여정 상세(= journeys)',
  '/ai-journeys/:id/stats': '여정 통계(= journeys)',
  '/marketing-planner/brief/:month': '플래너 월간 브리프(= marketing-planner)',
  '*': '404',
};

/** 봇·화면 응답용: 내부 필드를 떼어낸다 */
export function toPublicJob(j: FeatureJob): PublicFeatureJob {
  const { sourceFile: _s, stubUntil: _u, ...rest } = j;
  return rest;
}

export function findJob(id: string): FeatureJob | undefined {
  return FEATURE_CATALOG.find((j) => j.id === id);
}

/** 현재 화면(라우트)에서 시작하는 작업들. entry.path가 그 화면인 것 */
export function jobsForPath(path: string): FeatureJob[] {
  const p = normalizePath(path);
  return FEATURE_CATALOG.filter((j) => j.entry.path === p);
}

export function normalizePath(path: string): string {
  const p = String(path || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return p === '' ? '/' : p;
}

/** 소비처 0 (3단계 예약). 우리 AI 기능이 "그럴 땐 이 기능을 쓰세요"를 붙일 때 쓸 한 줄 */
export function getJobBrief(id: string): string | null {
  const j = findJob(id);
  if (!j) return null;
  return `${j.title}: ${j.goal}`;
}
