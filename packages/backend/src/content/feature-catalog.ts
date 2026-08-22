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
  /** 어디서 시작하는가. path는 실제 라우트, via는 그 화면에서 누르는 것 */
  entry: { path: string; via: string };
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
  { key: 'send', label: '보내기', jobs: ['send-direct', 'send-target', 'schedule-send', 'send-alimtalk', 'check-spam', 'auto-spam-test', 'ai-operator'] },
  { key: 'create', label: '만들기', jobs: ['write-copy-ai', 'mobile-dm', 'image-studio', 'email-campaign', 'inapp-message', 'push-campaign', 'quick-campaign'] },
  { key: 'automate', label: '자동으로 돌리기', jobs: ['auto-marketing', 'journeys', 'marketing-planner', 'marketing-calendar', 'auto-send-legacy'] },
  { key: 'results', label: '결과 보기', jobs: ['check-results', 'performance', 'predictive', 'ai-explain', 'send-calendar'] },
  { key: 'agency', label: '맡기기·진단', jobs: ['marketing-diagnosis', 'campaign-agency', 'ai-memory', 'voice-inbound'] },
];

/** stub 공통 만료일. 이 날짜가 지나면 게이트 7번이 실패한다. 본문을 채우거나 날짜를 옮기는 커밋이 필요하다 */
export const STUB_UNTIL = '2026-11-30';

const stub = (
  id: string, title: string, goal: string, keywords: string[], entry: FeatureJob['entry'],
  planKey: FeatureKey | null, creditSource: string | null, sourceFile: string, related: string[] = [],
): FeatureJob => ({
  id, title, goal, keywords, steps: [], blockers: [], entry, planKey, creditSource, related,
  status: 'stub', stubUntil: STUB_UNTIL, sourceFile,
});

// ────────────────────────────────────────────────────────────────────
// 1단계 본문 12개 — 첫 고객사가 계약 후 2주에 밟는 동선
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
    entry: { path: '/dashboard', via: '"DB 현황" 카드의 "고객 DB 업로드"' },
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
    keywords: ['문자 보내기', '직접발송', '바로 보내기', 'SMS', 'LMS', 'MMS', '단체 문자', '번호 입력', '문자 발송', '광고 문자'],
    steps: [
      '상단 메뉴 "직접발송"을 누릅니다',
      '오른쪽 "수신번호"에 번호를 "직접입력"하거나 "파일 선택"으로 올리거나 "주소록"에서 고릅니다',
      '왼쪽에서 "발신번호"를 고르고 내용을 씁니다. 광고면 "광고표기"를 켜고, 이름처럼 사람마다 다른 값은 "변수 삽입"으로 넣습니다',
      '"미리보기"로 확인하고, 광고 문자는 "스팸필터테스트"로 한 번 걸러 봅니다',
      '"수신거부제거"와 "중복제거"를 누른 뒤 발송 버튼을 누르면 확인 창이 뜨고, 확인하면 나갑니다',
    ],
    blockers: [
      { symptom: '발송 버튼이 눌리지 않습니다', fix: '발신번호가 선택됐는지, 수신번호가 한 건이라도 있는지, 내용이 비어 있지 않은지 확인하세요' },
      { symptom: '광고 문자인데 맨 앞에 (광고)가 안 붙습니다', fix: '"광고표기"를 켜면 (광고)와 무료수신거부 문구가 자동으로 붙습니다' },
      { symptom: '글자 수가 넘어 LMS로 바뀌었습니다', fix: 'SMS는 90바이트까지입니다. 넘으면 LMS로 나가고 단가가 다릅니다' },
    ],
    entry: { path: '/dashboard', via: '상단 메뉴 "직접발송"' },
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
      { symptom: '성공률이 낮습니다', fix: '없는 번호·수신거부 번호가 섞인 경우가 대부분입니다. 보내기 전 "수신거부제거"를 누르세요' },
    ],
    entry: { path: '/dashboard', via: '상단 메뉴 "발송결과"' },
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
      { symptom: '수신거부한 고객에게 문자가 나갔습니다', fix: '보내기 직전에 "수신거부제거"를 눌러야 목록에서 빠집니다. 예약 발송도 나가는 시점에 다시 거릅니다' },
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
    entry: { path: '/dashboard', via: '"직접 타겟 발송" 카드' },
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
    entry: { path: '/dashboard', via: '"직접 타겟 발송" 카드 → 발송 화면의 "AI 문구 생성"' },
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
    entry: { path: '/dashboard', via: '"DB 현황" 카드의 "상세보기" → 고객 행 클릭' },
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
    entry: { path: '/dashboard', via: '"직접발송" 안 "예약전송"' },
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
];

// ────────────────────────────────────────────────────────────────────
// stub 전수 — 본문은 없지만 목록·진입점·요금제 키는 있다. 만료일이 지나면 빌드가 실패한다
// ────────────────────────────────────────────────────────────────────

const STUBS: FeatureJob[] = [
  stub('manage-accounts', '직원 계정 관리하기', '같이 쓸 직원을 초대하고 권한을 나눈다',
    ['직원 추가', '계정 추가', '사용자 초대', '권한', '관리 메뉴', '담당자 추가'],
    { path: '/manage', via: '상단 메뉴 "관리"' }, null, null, 'frontend/src/App.tsx(/manage)', ['sender-register']),
  stub('ai-column-mapping', 'AI로 컬럼 맞추기', '파일 제목 행을 표준 항목에 AI가 자동으로 맞춘다',
    ['컬럼 매핑', '항목 맞추기', '열 맞추기', '자동 매핑', 'AI 매핑', '제목 행', '필드 매칭'],
    { path: '/dashboard', via: '"고객 DB 업로드" 안 "AI로 컬럼 맞추기"' }, 'ai_mapping', 'ai-column-mapper', 'backend/src/utils/ai-column-mapper.ts', ['upload-customers']),
  stub('connect-shop', '우리 몰과 연결하기', '자사몰 주문·행동이 고객 기록에 자동으로 들어온다',
    ['자사몰', '카페24', '고도몰', '네이버', '쇼핑몰 연동', '연동', '자동 수집'],
    { path: '/cdp-settings', via: '대시보드 "AI Operator" → "자사몰 연동"' }, 'ai_cdp', null, 'docs/FEATURE-CDP-INTEGRATION.md', ['upload-customers', 'view-customer']),
  stub('segments', '고객 묶음 저장하기', '자주 쓰는 조건을 저장해 두고 다시 꺼내 쓴다',
    ['세그먼트', '고객 그룹', '묶음', '조건 저장', '그룹 만들기', '타겟 저장'],
    { path: '/segments', via: '직접 타겟 설정에서 조건을 저장' }, 'target_send', 'ai-segment-generator', 'frontend/src/App.tsx(/segments)', ['send-target']),
  stub('check-spam', '보내기 전 스팸 확인하기', '실제 휴대폰 3대에 보내 스팸함에 걸리는지 미리 본다',
    ['스팸', '스팸필터', '스팸 테스트', '차단 확인', '스팸함', '필터 테스트'],
    { path: '/dashboard', via: '"직접발송" 안 "스팸필터테스트"' }, 'spam_filter', null, 'frontend/src/components/DirectSendPanel.tsx(스팸필터테스트)', ['send-direct', 'write-copy-ai']),
  stub('auto-spam-test', '발송 전 자동 스팸 검사', '보낼 때마다 스팸 검사를 자동으로 거친다',
    ['자동 스팸', '자동 검사', '스팸 자동', '발송 전 검사', '자동 필터'],
    { path: '/dashboard', via: '"직접발송" 발송 직전 자동' }, 'auto_spam_test', null, 'backend/src/utils/plan-guard.ts(auto_spam_test)', ['check-spam']),
  stub('ai-operator', '한 줄로 캠페인 맡기기', '목표를 한 줄 적으면 대상·문안·시간을 AI가 정해 준다',
    ['AI Operator', '오퍼레이터', '한 줄', '자연어', '알아서 캠페인', 'AI 자동발송', '맞춤 캠페인'],
    { path: '/ai-operator', via: '대시보드 "AI Operator" 카드' }, 'ai_premium', 'orchestrate', 'frontend/src/pages/AiOperatorPage.tsx', ['auto-marketing', 'write-copy-ai']),
  stub('mobile-dm', '모바일 DM 만들기', '사진과 버튼이 있는 모바일 페이지를 만들어 링크로 보낸다',
    ['모바일 DM', 'DM', '카드형', '링크 페이지', '이미지 메시지', '랜딩', '모바일 페이지'],
    { path: '/dm-builder', via: '대시보드 "AI Operator" → "모바일 DM"' }, 'mobile_dm', 'dm-builder', 'frontend/src/App.tsx(/dm-builder)', ['image-studio', 'send-direct']),
  stub('image-studio', '이미지 만들기', '상품 사진으로 배경·소재 이미지를 AI가 만든다',
    ['이미지', '사진 생성', '배경', '소재', '이미지 스튜디오', 'AI 이미지', '썸네일'],
    { path: '/image-studio', via: '대시보드 "AI Operator" → "이미지 스튜디오"' }, 'ai_premium', 'image-studio-generate', 'docs/FEATURE-IMAGE-STUDIO.md', ['mobile-dm', 'quick-campaign']),
  stub('email-campaign', '이메일 캠페인 보내기', '이메일을 만들어 보내고 열람·클릭을 본다',
    ['이메일', '메일 발송', '뉴스레터', 'email', '메일 캠페인', '이메일 추적'],
    { path: '/email-campaigns', via: '대시보드 "AI Operator" → "Email 캠페인"' }, 'ai_premium', 'email-campaign-complete', 'frontend/src/App.tsx(/email-campaigns)', ['write-copy-ai', 'performance']),
  stub('inapp-message', '자사몰 안에 띄우기', '자사몰 방문자에게 배너·팝업을 띄운다',
    ['인앱', '팝업', '배너', '자사몰 팝업', '사이트 안에', '인앱 메시지'],
    { path: '/inapp-messages', via: '대시보드 "AI Operator" → "인앱메시지"' }, 'ai_cdp', 'inapp-publish', 'frontend/src/App.tsx(/inapp-messages)', ['connect-shop']),
  stub('quick-campaign', '전 채널 초안 한 번에', '행사 내용과 이미지 하나로 문자·DM·이메일 초안이 한 번에 나온다',
    ['원클릭', '한 번에', '전 채널', '빠른 캠페인', '행사 초안', '원클릭 캠페인'],
    { path: '/quick-campaign', via: '대시보드 "AI Operator" → "원클릭 캠페인"' }, 'ai_premium', 'one-step-interview', 'frontend/src/App.tsx(/quick-campaign)', ['write-copy-ai', 'image-studio']),
  stub('journeys', '사건 자동화 만들기', '가입·구매 같은 사건이 생기면 정해진 순서로 메시지가 나간다',
    ['여정', '자동화', '시나리오', '가입하면 보내기', '구매 후', '순서대로', '여정 빌더', '자동발송'],
    { path: '/ai-journeys', via: '대시보드 "AI Operator" → "여정 자동화"' }, 'auto_campaign', 'journey-activate', 'docs/FEATURE-JOURNEY.md', ['auto-marketing', 'marketing-planner']),
  stub('marketing-planner', '한 달 계획 맡기기', '월간 행사 계획을 적으면 AI가 대행한다',
    ['플래너', '월간 계획', '한 달', '대행', '마케팅 플래너', '월 계획'],
    { path: '/marketing-planner', via: '대시보드 "AI Operator" → "마케팅 플래너"' }, 'ai_premium', 'planner-monthly-agency', 'docs/FEATURE-MARKETING-PLANNER.md', ['journeys', 'campaign-agency']),
  stub('marketing-calendar', '마케팅 달력 보기', '행사와 발송 계획을 달력에서 본다',
    ['마케팅 캘린더', '달력', '행사 달력', '일정', '캘린더 설계'],
    { path: '/marketing-calendar', via: '주소로 직접 이동' }, 'ai_premium', 'marketing-calendar', 'frontend/src/App.tsx(/marketing-calendar)', ['marketing-planner']),
  stub('performance', '성과와 다음 수 보기', '최근 30일 성과와 다음에 할 캠페인을 추천받는다',
    ['성과', '리포트', '성과 리포트', '30일', '분석', '다음 추천', '성과 보기'],
    { path: '/performance', via: '대시보드 "AI Operator" → "성과리포트"' }, 'ai_premium', 'performance-explainer', 'frontend/src/App.tsx(/performance)', ['check-results', 'predictive']),
  stub('predictive', '이탈·구매 예측 보기', '누가 떠날 것 같고 누가 살 것 같은지 AI가 점수를 매긴다',
    ['예측', '이탈', '구매 예측', '점수', 'AI 예측', '떠날 고객'],
    { path: '/predictive', via: '대시보드 "AI Operator" → "AI 자율 예측"' }, 'ai_premium', 'predictive-daily', 'frontend/src/App.tsx(/predictive)', ['performance', 'send-target']),
  stub('ai-explain', '왜 이런 결과인지 묻기', '내 회사 수치에 대해 근거와 함께 답을 받는다',
    ['왜', '이유', '설명', '수치 질문', '몇 명', '얼마나', 'AI 설명'],
    { path: '/ai-explain', via: '주소로 직접 이동' }, 'ai_premium', 'performance-explainer', 'frontend/src/App.tsx(/ai-explain)', ['performance', 'view-customer']),
  stub('send-calendar', '날짜별 발송 보기', '어느 날 무엇을 보냈는지 달력으로 본다',
    ['발송 달력', '캘린더', '날짜별', '언제 보냈나', '발송 일정'],
    { path: '/calendar', via: '주소로 직접 이동' }, 'basic_send', null, 'frontend/src/App.tsx(/calendar)', ['check-results']),
  stub('marketing-diagnosis', '마케팅 진단 받기', '몇 가지 질문에 답하면 우리 마케팅 상태와 첫 과제가 나온다',
    ['진단', '마케팅 진단', '문진', '상태 점검', '첫 과제', '체크'],
    { path: '/diagnosis', via: '주소로 직접 이동' }, null, null, 'docs/FEATURE-MARKETING-DIAGNOSIS.md', ['campaign-agency']),
  stub('campaign-agency', '캠페인 대행 신청하기', '캠페인을 맡기면 제안서와 실행을 받는다',
    ['대행', '맡기기', '대신 해주세요', '캠페인 대행', '제안서', '에이전시'],
    { path: '/campaign-agency', via: '상단 메뉴 "캠페인 대행"' }, null, null, 'docs/2026-07-09-crm-campaign-agency-implementation.md', ['marketing-planner', 'marketing-diagnosis']),
  stub('ai-memory', 'AI가 배운 것 보기', 'AI가 우리 회사에 대해 누적한 것을 확인한다',
    ['AI 메모리', '학습', '기억', '누적', 'AI가 아는 것'],
    { path: '/ai-memory', via: '대시보드 "AI Operator" → "AI 메모리"' }, 'ai_premium', null, 'frontend/src/App.tsx(/ai-memory)', ['auto-marketing']),
  stub('voice-inbound', '전화 문의 기록 보기', '고객이 건 전화를 AI가 받고 기록한 내용을 본다',
    ['전화', '음성', '인바운드', '통화 기록', '전화 문의', 'ARS'],
    { path: '/voice-inbound', via: '주소로 직접 이동' }, null, null, 'frontend/src/App.tsx(/voice-inbound)', ['view-customer']),
  stub('push-campaign', '앱 푸시 보내기', '앱 알림으로 메시지를 보낸다',
    ['푸시', '앱 알림', '푸시 알림', '앱 메시지', '푸시 캠페인', '알림 보내기'],
    { path: '/push-campaigns', via: '주소로 직접 이동' }, 'ai_premium', null, 'frontend/src/App.tsx(/push-campaigns)', ['send-direct']),
  stub('ai-usage', 'AI 사용량 보기', '어디에 크레딧을 얼마나 썼는지 추세를 본다',
    ['사용량', 'AI 사용량', '크레딧 사용', '얼마나 썼나', '사용 내역'],
    { path: '/ai-usage', via: '주소로 직접 이동' }, null, null, 'frontend/src/pages/AiUsagePage.tsx', ['credits-and-plan']),
  stub('ai-batches', 'AI 묶음 작업 보기', '한 번에 처리한 AI 작업 묶음의 진행을 본다',
    ['배치', '묶음 작업', '대량 처리', 'AI 작업 현황', '작업 진행', '한꺼번에'],
    { path: '/ai-batches', via: '주소로 직접 이동' }, 'ai_premium', null, 'frontend/src/App.tsx(/ai-batches)', ['ai-usage']),
  stub('auto-send-legacy', '옛 자동발송 안내', '옛 자동발송은 여정 빌더로 합쳐졌다',
    ['자동발송', '옛 자동발송', '매달 발송', '정기 발송', '반복 발송', '주기 발송'],
    { path: '/auto-send', via: '주소로 직접 이동(안내만)' }, 'auto_campaign', null, 'frontend/src/pages/AutoSendPage.tsx', ['journeys']),
];

/** 전체 카탈로그(불변) */
export const FEATURE_CATALOG: readonly FeatureJob[] = Object.freeze([...READY, ...STUBS]);

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
