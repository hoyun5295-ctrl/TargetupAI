import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { FIELD_MAP, getFieldByKey, getColumnFields, applyFieldAliases } from '../utils/standard-field-map';
import { query } from '../config/database';
import { AI_MODELS, AI_MAX_TOKENS, TIMEOUTS } from '../config/defaults';
import { buildFilterWhereClauseCompat } from '../utils/customer-filter';

if (!process.env.ANTHROPIC_API_KEY) console.warn('[AI] ANTHROPIC_API_KEY not configured — Claude AI 기능 비활성 상태');
if (!process.env.OPENAI_API_KEY) console.warn('[AI] OPENAI_API_KEY not configured — OpenAI 기능 비활성 상태');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// ============================================================
// AI 호출 (Claude → gpt-5.1 자동 fallback)
// ============================================================
export async function callAIWithFallback(params: {
  system: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  // 1차: Claude Sonnet
  try {
    const response = await anthropic.messages.create({
      model: AI_MODELS.claude,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: params.system,
      messages: [{ role: 'user', content: params.userMessage }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log('[AI] Claude 호출 성공');
    return text;
  } catch (claudeError: any) {
    console.warn(`[AI] Claude 실패 (${claudeError.status || claudeError.message}) → gpt-5.1 fallback`);
  }

  // 2차: gpt-5.1 fallback
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Claude 실패 + OPENAI_API_KEY 미설정');
  }

  try {
    const gptResponse = await openai.chat.completions.create({
      model: AI_MODELS.gpt,
      max_completion_tokens: params.maxTokens,
      temperature: params.temperature,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.userMessage },
      ],
    });
    const text = gptResponse.choices[0]?.message?.content || '';
    console.log('[AI] gpt-5.1 fallback 성공');
    return text;
  } catch (gptError: any) {
    console.error(`[AI] gpt-5.1도 실패 (${gptError.message})`);
    throw new Error('AI 서비스 일시 장애 (Claude + GPT 모두 실패)');
  }
}

// ============================================================
// 타입 정의
// ============================================================

// 변수 카탈로그 엔트리 (field_mappings의 각 항목)
export interface VarCatalogEntry {
  column: string;
  type: 'string' | 'number' | 'date';
  description: string;
  sample: string | number;
  values?: string[];
  /** 저장 방식: 'column'=직접 컬럼(SQL SELECT 가능), 'custom_fields'=JSONB 내부 키(SQL SELECT 불가) */
  storageType?: 'column' | 'custom_fields';
}

interface MessageVariant {
  variant_id: string;
  variant_name: string;
  concept: string;
  sms_text: string;
  lms_text: string;
  kakao_text?: string;
  score: number;
}

interface AIRecommendResult {
  variants: MessageVariant[];
  recommendation: string;
  recommendation_reason: string;
}

interface TargetInfo {
  total_count: number;
  gender_ratio?: { male: number; female: number };
  age_groups?: { [key: string]: number };
  avg_purchase_count?: number;
  avg_total_spent?: number;
}

// ============================================================
// 변수 카탈로그 동적 생성 (FIELD_MAP 기반 — 하드코딩 금지)
// ============================================================

/**
 * FIELD_MAP에서 필수 직접 컬럼 기반 VarCatalog 생성
 * - phone, sms_opt_in은 변수로 불필요하므로 제외
 * - 커스텀 필드는 고객사별로 다르므로 제외 (실제 데이터 기반으로 별도 추가)
 */
function buildVarCatalogFromFieldMap(): {
  fieldMappings: Record<string, VarCatalogEntry>;
  availableVars: string[];
} {
  const fieldMappings: Record<string, VarCatalogEntry> = {};
  const availableVars: string[] = [];

  for (const f of FIELD_MAP) {
    if (f.storageType === 'custom_fields') continue;
    if (f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;

    const varName = f.displayName;
    fieldMappings[varName] = {
      column: f.columnName,
      type: f.dataType === 'boolean' ? 'string' : f.dataType as 'string' | 'number' | 'date',
      description: f.displayName,
      sample: f.dataType === 'number' ? 0 : f.dataType === 'date' ? '' : '',
      storageType: 'column',
    };
    availableVars.push(varName);
  }

  return { fieldMappings, availableVars };
}

/**
 * "개인화 필수: 필드1, 필드2" 파싱 유틸
 * - 입력 문자열에서 "개인화 필수:" 키워드 감지 및 필드명 추출
 * - availableVars(displayName 기반)에 매칭되는 변수만 반환
 * - "개인화 필수:" 없으면 null 반환 → 기존 AI 자체 판단 로직 유지 (하위호환)
 * - 매칭 안 되는 필드명은 무시 (로그만 출력)
 */
function parsePersonalizationDirective(
  input: string,
  availableVars: string[]
): { cleanPrompt: string; requestedVars: string[] } | null {
  // ★ D101: "개인화 필수:" 뿐 아니라 "개인화 :", "개인화:" 도 감지 (사용자 입력 유연성)
  const match = input.match(/개인화\s*(?:필수)?\s*[:：]\s*(.+)$/);
  if (!match || match.index === undefined) return null;

  const cleanPrompt = input.substring(0, match.index).trim();
  const fieldNames = match[1].split(/[,，、]+/).map(s => s.trim()).filter(Boolean);

  const matchedVars: string[] = [];
  for (const name of fieldNames) {
    // ★ D102: 정확 매칭 우선, 실패 시 부분 매칭 (등록매장명→등록매장정보, 등록매장번호→매장전화번호)
    let found = availableVars.find(v => v === name);
    if (!found) found = availableVars.find(v => v.includes(name) || name.includes(v));
    if (found && !matchedVars.includes(found)) {
      matchedVars.push(found);
    }
  }

  console.log(`[AI] 개인화 필수 파싱: 요청=${fieldNames.join(', ')} → 매칭=${matchedVars.join(', ') || '없음'}`);
  return { cleanPrompt, requestedVars: matchedVars };
}

// ============================================================
// 유틸리티 함수
// ============================================================

// 한국 시간 기준 현재 월 달력 생성
function getKoreanCalendar(): string {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const year = koreaTime.getFullYear();
  const month = koreaTime.getMonth();
  
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  let calendar = `## ${year}년 ${month + 1}월 달력 (요일 참고 필수!)\n`;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayOfWeek = dayNames[date.getDay()];
    calendar += `${day}일(${dayOfWeek})`;
    if (day < daysInMonth) calendar += day % 7 === 0 ? '\n' : ', ';
  }
  
  // 다음 달도 추가 (이벤트가 다음 달에 걸칠 수 있으므로)
  const nextMonth = month + 1 > 11 ? 0 : month + 1;
  const nextYear = month + 1 > 11 ? year + 1 : year;
  const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  
  calendar += `\n\n## ${nextYear}년 ${nextMonth + 1}월 달력\n`;
  
  for (let day = 1; day <= daysInNextMonth; day++) {
    const date = new Date(nextYear, nextMonth, day);
    const dayOfWeek = dayNames[date.getDay()];
    calendar += `${day}일(${dayOfWeek})`;
    if (day < daysInNextMonth) calendar += day % 7 === 0 ? '\n' : ', ';
  }
  
  return calendar;
}

// 한국 시간 기준 현재 날짜
function getKoreanToday(): string {
  const now = new Date();
  return now.toLocaleDateString('ko-KR', { 
    timeZone: 'Asia/Seoul', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    weekday: 'long' 
  });
}

// 한국 시간 기준 현재 시각 (HH:mm)
function getKoreanNowTime(): string {
  const now = new Date();
  return now.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// 080번호 하이픈 포맷팅 (0801111111 → 080-111-1111)
function formatRejectNumber(num: string): string {
  const clean = num.replace(/-/g, '');
  if (clean.length === 10) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
  }
  return num;
}

/**
 * SMS 광고 오버헤드를 제외한 실제 사용 가능 바이트 계산
 * - 광고 SMS 구조: (광고)본문\n무료거부{080번호}
 * - (광고) = 6바이트, \n = 1바이트, 무료거부 = 8바이트, 번호 = 가변
 * - 비광고: 90 - 여유 2 = 88바이트
 * - 광고: 90 - 오버헤드 - 여유 1
 * - rejectNumber는 반드시 고객사 DB(opt_out_080_number)에서 조회한 값 전달 필수
 */
function getAvailableSmsBytes(isAd: boolean, rejectNumber?: string): number {
  if (!isAd) return 88; // 비광고: 90 - 여유 2
  if (!rejectNumber) {
    console.warn('[AI] 수신거부번호 미전달 — 기본 10자리 가정으로 바이트 계산');
    return 90 - (6 + 1 + 8 + 10 + 1); // 10자리 번호 가정 (가장 보수적)
  }
  const cleanNumber = rejectNumber.replace(/-/g, '');
  // (광고) 6 + \n 1 + 무료거부 8 + 번호길이 + 여유 1
  const overhead = 6 + 1 + 8 + cleanNumber.length + 1;
  return 90 - overhead;
}

// ============================================================
// 변수 카탈로그 관련 함수 (핵심!)
// ============================================================

/**
 * 메시지 내 개인화 변수 검증
 * - 메시지에서 %...% 패턴을 추출하여 available_vars에 없는 것이 있으면 invalid 반환
 * - 발송 전 반드시 호출하여 잘못된 변수가 고객에게 노출되는 것을 방지
 */
export function validatePersonalizationVars(
  message: string,
  availableVars: string[]
): { valid: boolean; invalidVars: string[] } {
  const found = message.match(/%[^%\s]{1,20}%/g) || [];
  const varNames = found.map(v => v.replace(/%/g, ''));
  const invalidVars = varNames.filter(v => !availableVars.includes(v));
  return { valid: invalidVars.length === 0, invalidVars };
}

/**
 * 변수 카탈로그 → AI 프롬프트용 텍스트 생성
 * AI가 사용 가능한 변수의 이름, 설명, 예시값을 테이블로 전달
 */
function buildVarCatalogPrompt(
  catalog: Record<string, VarCatalogEntry>,
  availableVars: string[]
): string {
  if (!catalog || availableVars.length === 0) {
    return `이 회사는 개인화 변수가 등록되지 않았습니다.\n%...% 형태의 변수를 절대 사용하지 마세요. 일반 문안으로만 작성하세요.`;
  }

  let text = `## 사용 가능한 개인화 변수 (⚠️ 이 목록의 변수만 사용 가능!)\n\n`;
  text += `| 변수 | 설명 | 예시값 |\n|------|------|--------|\n`;
  for (const varName of availableVars) {
    const entry = catalog[varName];
    if (entry) {
      const sample = typeof entry.sample === 'number' ? entry.sample.toLocaleString() : entry.sample;
      text += `| %${varName}% | ${entry.description} | ${sample} |\n`;
    }
  }

  text += `\n⚠️ 위 목록에 없는 변수를 절대 만들지 마세요!\n`;
  text += `금지 예시: %매장번호%, %매장명%, %고객명%, %적립금%, %담당매장%, %회원번호% 등\n`;
  text += `존재하지 않는 변수는 고객에게 "%변수명%" 텍스트가 그대로 발송됩니다.\n`;
  text += `반드시 위 표의 변수명만 정확히 %변수명% 형태로 사용하세요.\n`;
  text += `변수를 사용할지 말지는 문맥에 맞게 자연스럽게 판단하세요.`;

  return text;
}

/**
 * customer_schema에서 field_mappings, available_vars 추출
 * - customer_schema에 있으면 그대로 사용
 * - 없으면 FIELD_MAP(standard-field-map.ts) 기반 동적 생성
 *
 * ★ D111 P2: 최종 반환 전 FIELD_MAP.aliases 자동 보강
 *   → isoi 사례처럼 customer_schema.field_mappings가 있든 없든 `%이름%`, `%전화번호%` 등 한글 동의어 자동 지원.
 *   → 이미 등록된 키는 덮어쓰지 않으므로 customer_schema 우선순위 유지.
 */
export function extractVarCatalog(customerSchema: any): {
  fieldMappings: Record<string, VarCatalogEntry>;
  availableVars: string[];
} {
  const schema = customerSchema || {};

  let result: { fieldMappings: Record<string, VarCatalogEntry>; availableVars: string[] };

  // customer_schema에 field_mappings가 있으면 우선 사용 (원본 불변 유지 위해 얕은 복사)
  if (schema.field_mappings && Object.keys(schema.field_mappings).length > 0 && schema.available_vars?.length > 0) {
    result = {
      fieldMappings: { ...schema.field_mappings },
      availableVars: [...schema.available_vars],
    };
  } else {
    // 없으면 FIELD_MAP 기반 동적 생성
    result = buildVarCatalogFromFieldMap();
  }

  // ★ D111 P2: FIELD_MAP.aliases 자동 주입 — standard-field-map.ts 컨트롤타워 호출
  //   인라인 로직 금지 — applyFieldAliases가 유일한 진입점
  applyFieldAliases(
    result.fieldMappings,
    result.availableVars,
    (col) => Object.values(result.fieldMappings).find((e: any) => e.column === col)
  );

  return result;
}

/**
 * ★ D121: 실제 데이터가 있는 필드만 남기도록 varCatalog/availableVars 필터링
 * enabled-fields와 동일한 COUNT FILTER 패턴 — 데이터 없는 필드를 AI가 사용하면 빈 공간 발생
 * routes/ai.ts(generate-messages) + auto-campaign-worker.ts 양쪽에서 호출하는 컨트롤타워
 */
export async function filterVarCatalogByData(
  varCatalog: Record<string, VarCatalogEntry>,
  availableVars: string[],
  companyId: string
): Promise<void> {
  // 1. 직접 컬럼 필드 — COUNT FILTER로 데이터 유무 확인
  const detectableFields = getColumnFields().filter(f => f.fieldKey !== 'name' && f.fieldKey !== 'phone');
  const countFilters = detectableFields.map(f => {
    const col = f.columnName;
    if (f.dataType === 'number') return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} > 0) as cnt_${f.fieldKey}`;
    if (f.dataType === 'date' || f.dataType === 'boolean') return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL) as cnt_${f.fieldKey}`;
    return `COUNT(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} != '') as cnt_${f.fieldKey}`;
  });
  if (countFilters.length > 0) {
    const dataCheck = await query(`SELECT ${countFilters.join(', ')} FROM customers WHERE company_id = $1 AND is_active = true`, [companyId]);
    const dc = dataCheck.rows[0] || {};
    for (const f of detectableFields) {
      if (parseInt(dc[`cnt_${f.fieldKey}`] || '0') === 0) {
        if (varCatalog[f.displayName]) {
          delete varCatalog[f.displayName];
          const idx = availableVars.indexOf(f.displayName);
          if (idx >= 0) availableVars.splice(idx, 1);
        }
      }
    }
  }

  // 2. 커스텀 필드 — varCatalog에 storageType='custom_fields'인 항목 중 데이터 없는 것 제거
  const customEntries = Object.entries(varCatalog).filter(([_, v]) => v.storageType === 'custom_fields');
  if (customEntries.length > 0) {
    const safeEntries = customEntries.filter(([_, v]) => /^custom_\d+$/.test(v.column));
    if (safeEntries.length > 0) {
      const customCountFilters = safeEntries.map(([_, v]) =>
        `COUNT(*) FILTER (WHERE custom_fields->>'${v.column}' IS NOT NULL AND custom_fields->>'${v.column}' != '') as cnt_${v.column}`
      );
      const customCheck = await query(`SELECT ${customCountFilters.join(', ')} FROM customers WHERE company_id = $1 AND is_active = true`, [companyId]);
      const cc = customCheck.rows[0] || {};
      for (const [label, entry] of safeEntries) {
        if (parseInt(cc[`cnt_${entry.column}`] || '0') === 0) {
          delete varCatalog[label];
          const idx = availableVars.indexOf(label);
          if (idx >= 0) availableVars.splice(idx, 1);
        }
      }
    }
  }
}

/**
 * 프롬프트에서 개인화 관련 키워드를 감지하여 사용 가능한 변수 중 관련된 것을 추출
 * - 하드코딩이 아닌 field_mappings 기반 동적 감지
 */
function detectPersonalizationVars(
  objective: string,
  fieldMappings: Record<string, VarCatalogEntry>,
  availableVars: string[]
): string[] {
  const detected: string[] = [];

  // 키워드 → 변수명 매핑 (다양한 고객 표현을 커버)
  const keywordMap: Record<string, string[]> = {
    '이름': ['이름', '고객명', '성함', '개인화'],
    '포인트': ['포인트', '적립금', '마일리지', '리워드'],
    '등급': ['등급', '멤버십', '회원등급', '티어', 'tier', 'rank', 'level', '레벨', '랭크'],
    '등록매장정보': ['등록매장', '가입매장', '소속매장', '주이용매장', '매장정보', '매장', '지점', '스토어'],
    '최근구매매장': ['최근구매매장', '최근매장', '최종구매매장', '마지막구매매장', '구매매장'],
    '브랜드': ['브랜드', '브랜드별', '브랜드명', '브랜드코드'],
    '지역': ['지역', '거주'],
    '구매금액': ['구매금액', '구매액', '총구매', '누적구매'],
    '구매횟수': ['구매횟수', '구매건수', '주문횟수'],
    '평균주문금액': ['평균주문', '평균구매', '객단가'],
    'LTV점수': ['LTV', '고객가치', '생애가치'],
    // 추가 스키마 (custom_fields 기반 - 업종별)
    '피부타입': ['피부타입', '피부', '건성', '지성', '복합성', '민감성'],
    '주요카테고리': ['카테고리', '선호카테고리', '스킨케어', '클렌징', '바디케어', '색조'],
    '선호라인': ['선호라인', '히알루론', '미백', '탄력', '콜라겐', '진정'],
    '선호채널': ['선호채널', '카카오선호', 'SMS선호'],
    '연령대': ['연령대'],
  };

  // 스키마 기반 동적 등급 값 추가 (VIP, GOLD 등 실제 등급명을 키워드로 포함)
  const gradeMapping = fieldMappings['등급'];
  if (gradeMapping && (gradeMapping as any).sample_values) {
    const gradeValues = (gradeMapping as any).sample_values;
    if (Array.isArray(gradeValues)) {
      keywordMap['등급'] = keywordMap['등급'].concat(gradeValues.map((v: any) => String(v)));
    }
  }

  for (const varName of availableVars) {
    if (!fieldMappings[varName]) continue;
    // keywordMap 키워드 + fieldMappings의 description(displayName)도 키워드로 활용
    const baseKeywords = keywordMap[varName] || [varName];
    const descKeyword = fieldMappings[varName].description;
    const keywords = descKeyword && !baseKeywords.includes(descKeyword)
      ? [...baseKeywords, descKeyword]
      : baseKeywords;
    for (const keyword of keywords) {
      if (objective.includes(keyword)) {
        if (!detected.includes(varName)) {
          detected.push(varName);
        }
        break;
      }
    }
  }

  // "개인화" 키워드가 있으면 기본 변수(이름, 등급, 등록매장정보) 자동 포함
  if (/개인화/.test(objective)) {
    for (const defaultVar of ['이름', '등급', '등록매장정보']) {
      if (!detected.includes(defaultVar) && availableVars.includes(defaultVar)) {
        detected.push(defaultVar);
      }
    }
  }

  return detected;
}

// ============================================================
// 브랜드 시스템 프롬프트
// ============================================================

const BRAND_SYSTEM_PROMPT = `당신은 대한민국 최고의 마케팅 문자 메시지 카피라이터입니다.
당신이 쓰는 문안은 수신자의 손가락을 멈추게 하고, 읽게 하고, 행동하게 합니다.

## 채널별 작성 규칙

### SMS
- 짧고 임팩트 있게, 핵심 혜택만
- ⚠️ 바이트 제한은 사용자 메시지에 명시된 값을 반드시 따르세요!
- 시스템이 (광고)표기+수신거부번호를 자동 추가하므로, 순수 본문 바이트가 제한됩니다

### LMS (2000바이트 이하, 한글 약 1000자)
- subject(제목) 필수! 40바이트 이내, 핵심 키워드로 짧고 임팩트 있게
- ⚠️ subject(제목)에는 %변수% 절대 사용 금지! 고정 텍스트만!
- ⚠️ subject(제목)에 (광고) 넣지 마세요! 시스템이 자동 부착합니다!
- ⚠️ 한 줄은 반드시 한글 기준 최대 17자(34바이트) 이내! 모바일에서 줄넘김 방지
- ⚠️ LMS는 충분히 풍성하게! 본문 600~1200바이트 권장. 300바이트 미만은 성의없어 보입니다
- 긴 문장은 반드시 줄바꿈으로 나눠서 한 줄이 짧게 유지
- 줄바꿈과 특수문자로 가독성 높게

### MMS
- LMS와 동일하되 이미지 첨부 고려
- 텍스트는 이미지 보완 역할

### 카카오 (브랜드메시지)
- 최대 4,000자 (한글 기준)
- 발송 가능 시간: 08:00~20:50
- 이모지 사용 가능 (SMS와 다르게 카카오는 이모지 지원!)
- 이모지는 적절히 포인트로만 사용 (과도한 사용 금지)

## 🚫 절대 금지 규칙 (최우선!)

### 1. 광고 표기 금지
(광고), 무료거부, 무료수신거부, 080번호를 본문/제목에 절대 포함하지 마세요!
시스템이 본문 앞에 (광고), 제목 앞에도 (광고)를 자동으로 붙입니다.
당신은 순수 메시지 본문과 순수 제목만 작성하세요.

### 2. 정보 날조 절대 금지
- 사용자가 언급하지 않은 할인율/적립금/사은품/무료배송 등을 지어내지 마세요!
- 사용자가 기간을 지정하지 않았으면 날짜/기간 자체를 넣지 마세요!
- 사용자가 가격을 지정하지 않았으면 구체적 금액을 만들지 마세요!
- 주어진 정보만 활용하고, 없는 정보는 포괄적 표현으로 대체

### 3. 날짜 규칙
- 상대적 날짜("내일", "모레")는 반드시 구체적 날짜로 변환
- 날짜 표기: "M/D(요일)" 형식 (예: 4/15(화))

## 특수문자 규칙
SMS/LMS/MMS: 이모지 절대 금지! 아래 특수문자만 사용:
★☆●○◎◇◆□■△▲▽▼→←↑↓♠♣♥♡♦※☎▶◀【】「」『』

### ⛔ 구분선 절대 금지!
━━━, ───, ═══, ___, --- 등 가로줄/구분선 금지! 연속 특수문자(●●●)로 줄 만드는 것도 금지!
줄바꿈(빈 줄)으로 단락 구분하세요.

카카오만: 이모지 사용 가능하나 절제 (1~2개 포인트)

## ★★★ 고성과 문안 작성 핵심 전략 (4차 고도화 — 반드시 전부 숙지!)

### 원칙: "왜 지금, 왜 나한테, 왜 이 브랜드" 3박자
모든 문안에 이 3가지 질문의 답이 들어가야 합니다:
1. **왜 지금?** — 계절, 시기, 한정, 트렌드 등 "오늘 읽어야 하는 이유"
2. **왜 나한테?** — 개인화 변수로 "나를 위한 메시지" 느낌
3. **왜 이 브랜드?** — 브랜드명/슬로건이 자연스럽게 녹아든 신뢰감

### ⛔ 뻔한 표현 금지 (이것을 쓰면 실격!)
절대 쓰면 안 되는 표현과 대체 방법:
- "안녕하세요, 고객님" → 금지! 대신: 계절감/질문/알림 형식으로 시작
- "특별한 혜택/소식/선물" → 금지! 대신: 구체적 혜택 자체를 먼저 제시
- "준비했어요/준비했습니다" → 금지! 대신: "지금 ~할 수 있어요", "~가 시작됩니다"
- "확인하세요/만나보세요" → 단독 CTA로 약함! 대신: 구체적 행동 제시
- "소중한 고객님" → 금지! 이미 개인화 변수(%이름%)가 더 효과적
- "다양한 혜택" → 금지! 대신: 핵심 혜택 1가지를 구체적으로
- "많은 관심 부탁드립니다" → 금지! 대신: 기간/수량 한정으로 긴급성

### 1. 시선 정지 도입부 — 첫 줄에서 스크롤을 멈추게!
**알림 위장형:** "읽지 않은 혜택이 있어요", "%이름%님 앞으로 도착한 쿠폰" → 광고가 아닌 알림처럼
**질문 훅형:** "요즘 피부 건조하지 않으세요?", "벌써 여름옷 꺼내셨나요?" → 공감+호기심
**숫자 임팩트형:** "★ 48시간 한정 30% OFF", "잔여 수량 127개" → 구체적 숫자가 시선을 끔
**비밀/한정형:** "%이름%님만 열 수 있는 혜택", "이 문자를 받은 분 한정" → 독점감
**시의성형:** 오늘 날짜와 계절을 활용한 "지금 이 시기에만" 느낌

### 2. 사용 시나리오 — 고객 생활 속에 제품을 넣어라! (핵심 차별화!)
단순히 "이 제품 좋습니다"가 아니라, **고객이 제품을 사용하는 순간**을 그려야 합니다:
- 화장품: "퇴근 후 세안하고, 한 방울이면 아침까지 촉촉" → 사용 장면이 그려짐
- 식품: "주말 저녁, 가족과 함께 바로 즐기는 프리미엄 한우" → 식탁 장면
- 패션: "출근길 거울 앞에서 '오늘 좀 멋진데?' 하게 될 재킷" → 착용 순간
- 건강: "아침 공복에 한 포, 하루가 가벼워지는 루틴" → 일상 속 루틴
- 뷰티: "자기 전 5분, 내일 아침 피부가 달라지는 마스크팩" → before/after 기대감

⚠️ 제품명이 주어지면 반드시 1줄 이상 사용 시나리오를 포함하세요!
시나리오가 없으면 읽는 사람이 "나한테 왜 필요한지" 모릅니다.

### 3. 감각 언어 — 오감을 자극하는 표현 (뻔한 설명 대신!)
단순 설명 → 감각 표현으로 전환하세요:
- "보습 효과가 있는" → "바르는 순간 피부에 스며드는 촉촉함"
- "맛있는 고기" → "입안에서 살살 녹는 마블링"
- "좋은 향기" → "케이스를 여는 순간 퍼지는 은은한 플로럴"
- "편안한 옷" → "입는 순간 느껴지는, 구름 같은 부드러움"
- "건강에 좋은" → "매일 한 잔, 몸이 가벼워지는 걸 느끼세요"

감각 표현은 구매 전환율을 2~3배 높입니다. 모든 제품 어필에 최소 1개 감각 표현을 넣으세요.

### 4. 개인화 변수 고도 활용
- %이름%: "~님만을 위한", "~님이 좋아하실", "~님께 먼저 알려드려요" → 1:1 대화
- %포인트%: "적립해두신 포인트, 이번에 제대로 써보실 때!" → 심리 자극
- %최근구매매장%: "%최근구매매장%에서 바로 만나보실 수 있어요" → 접근성+친숙함
- %등급%: "%등급% 고객님이니까 가능한 혜택" → 자부심 자극
- 조합 활용: "%이름%님, %최근구매매장%에 새로 들어온 신상!" → 복합 개인화

### 5. 혜택 구조화 — 숫자와 구조가 전환율을 만든다
- 혜택이 여러 개면: 【혜택】섹션 후 ①②③ 또는 ★로 나열
- 할인율이 있으면: 숫자를 크게 강조 ("★ 30% 할인!", "최대 30% OFF")
- 가격 정보가 있으면: 원가→할인가 직접 비교 (없으면 가격 날조 금지!)
- 포인트 연계: "할인에 포인트까지, 이중 혜택!"
- 조건 명시: "~원 이상 구매 시", "온라인 전용" 등 주어진 조건만

### 6. LMS subject(제목) 전략
- 3개 variant의 subject도 전부 달라야 합니다!
- ⚠️ 제목에 (광고) 넣지 마세요! 시스템이 자동으로 "(광고) " + 제목을 조합합니다
- 실제 수신자에게는 "(광고) 제목내용" 형태로 표시되므로, 제목 자체는 순수 내용만
- 감성형: 감성+브랜드 ("올 봄, [브랜드]가 전하는 선물")
- 혜택강조형: 숫자+핵심 ("[브랜드] 신제품 30% 특가")
- MZ감성형: 호기심 ("[브랜드] 아직 확인 안 하셨나요?")

### 7. CTA — 구체적 행동이 전환을 만든다
"확인하세요"는 약합니다. 수신자가 **다음에 뭘 해야 하는지** 정확히 알려주세요:
- 매장 유도: "가까운 %최근구매매장% 방문 시 즉시 적용!"
- 온라인 유도: "지금 바로 장바구니에 담아보세요"
- 포인트 유도: "쌓아둔 %포인트%원, 이번에 시원하게!"
- 한정 유도(기간 있을 때만): "종료 D-3, 서두르세요!" (기간 없으면 긴급성 금지)

### 8. 문장 리듬 — 짧은 문장과 긴 문장을 교차!
한 가지 길이의 문장만 계속되면 지루합니다:
- 나쁜 예: "봄이 왔습니다. 신제품이 출시됐습니다. 할인합니다. 방문하세요." → 단조로움
- 좋은 예: "봄이에요.\n[브랜드]가 이번 시즌 야심차게 준비한\n신제품을 만나보세요.\n★ 지금, 30% 할인!" → 짧고 긴 문장 교차로 리듬감

### 9. LMS 문단 구성 (600~1200바이트)
최소 5~6개 문단으로 충분히 풍성하게:
① 시선 정지 도입 (질문/알림/숫자 임팩트)
② 사용 시나리오 (왜 지금 이 제품이 필요한지)
③ 혜택 상세 (숫자+구조화)
④ 개인화 어필 (포인트/등급/매장)
⑤ CTA (구체적 행동 유도)
⑥ 따뜻한 마무리 (브랜드 이름으로 끝)
각 문단은 빈 줄로 구분. 한 줄 17자 이내 유지

### 10. 업종별 킬 포인트
브랜드 설명에서 업종을 파악하여 아래 포인트를 활용하세요:
- **뷰티/화장품:** 성분 효능 + 사용감(텍스처) + before/after 기대감 + 피부 고민 공감
- **패션/의류:** 착용 장면 + 스타일링 팁 + 트렌드 연결 + 체형 고민 해결
- **식품/음료:** 맛 묘사(감각 언어!) + 식탁/모임 장면 + 재료 원산지 + 건강 이점
- **건강/헬스:** 일상 루틴 삽입 + 체감 변화 + 성분 신뢰감 + 꾸준함의 가치
- **생활/가전:** 불편 해소 장면 + 시간 절약 + 가족/공간 연결 + 실용적 가치
- **키즈/교육:** 부모 마음 공감 + 아이 성장 장면 + 안전/성분 신뢰 + 다른 부모 후기

## 3가지 variant 전략 (⚠️ 도입부/구조/설득전략이 완전히 달라야 함!)

**감성형(A) — "마음을 먼저 열기"**
- 설득 전략: 감정적 공감 → 브랜드 관계 → 혜택은 보상처럼
- 도입: 계절감/일상 공감으로 시작. 제품 전에 관계를 먼저 짚기
- 구조: 공감 → 사용 시나리오(감각 언어) → 혜택을 선물처럼 → 따뜻한 마무리
- 톤: 브랜드가 오랜 단골에게 편지 쓰는 느낌. 정중하고 따뜻하게
- 핵심: 제품 어필에 감각 언어 필수 ("바르는 순간 느껴지는~")

**혜택강조형(B) — "숫자로 설득하기"**
- 설득 전략: 숫자 임팩트 → 혜택 구조화 → 합리적 판단 유도
- 도입: 인사 없이 숫자/혜택을 첫 줄에! 강한 한 줄로 시선 확보
- 구조: 숫자 임팩트 → ①②③ 넘버링 혜택 → 구매 조건 → 매장/온라인 → 강한 CTA
- 톤: 직접적이고 실용적. 숫자가 눈에 확 들어오게
- 핵심: 원가→할인가 비교, 포인트 동시 어필로 "이중 혜택" 구조

**MZ감성형(C) — "호기심으로 끌어당기기"**
- 설득 전략: 궁금증 유발 → 공감 형성 → 가볍게 행동 유도
- 도입: "뭐지?" 하고 계속 읽게 만드는 질문/비밀 훅
- 구조: 호기심 훅 → 짧은 임팩트 전달 → 사용 시나리오 → 개인화 → 가벼운 CTA
- 톤: 친구가 카톡으로 추천하는 느낌. 캐주얼하되 초성체(ㄱㄱ,ㅋㅋ) 절대 금지!
- 핵심: 문장을 아주 짧게 끊어 모바일 리딩에 최적화

### 계절감/시기 반영
- 오늘 날짜 정보가 주어집니다. 해당 월/계절 감성을 자연스럽게 녹이세요
- 봄(3~5월): 꽃, 새로운 시작, 따뜻함, 환절기 케어, 봄나들이
- 여름(6~8월): 시원함, 자외선, 바캉스, 가벼움, 수분
- 가을(9~11월): 풍성함, 선선함, 환절기, 추석, 단풍
- 겨울(12~2월): 따뜻함, 보습, 연말, 새해, 크리스마스, 설날
- ⚠️ 계절감은 제품/행사와 자연스럽게 연결될 때만. 억지로 넣지 마세요

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요:

{
  "variants": [
    {
      "variant_id": "A",
      "variant_name": "감성형",
      "concept": "따뜻하고 친근한 톤",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열) — (광고) 넣지 마세요!",
      "message_text": "채널에 맞는 메시지 (광고표기/수신거부 포함 금지!)",
      "byte_count": 바이트수,
      "score": 점수
    },
    {
      "variant_id": "B",
      "variant_name": "혜택강조형",
      "concept": "할인/혜택을 직접적으로 강조",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열) — (광고) 넣지 마세요!",
      "message_text": "채널에 맞는 메시지 (광고표기/수신거부 포함 금지!)",
      "byte_count": 바이트수,
      "score": 점수
    },
    {
      "variant_id": "C",
      "variant_name": "MZ감성형",
      "concept": "트렌디하고 캐주얼한 톤",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열) — (광고) 넣지 마세요!",
      "message_text": "채널에 맞는 메시지 (광고표기/수신거부 포함 금지!)",
      "byte_count": 바이트수,
      "score": 점수
    }
  ],
  "recommendation": "A",
  "recommendation_reason": "추천 이유"
}`;

// ============================================================
// 메시지 생성 (generateMessages)
// ============================================================

export async function generateMessages(
  prompt: string,
  targetInfo: TargetInfo,
  extraContext?: {
    productName?: string;
    discountRate?: number;
    eventName?: string;
    brandName?: string;
    brandSlogan?: string;
    brandDescription?: string;
    brandTone?: string;
    channel?: string;
    isAd?: boolean;
    rejectNumber?: string;
    usePersonalization?: boolean;
    personalizationVars?: string[];
    // ★ 신규: 변수 카탈로그 (customer_schema에서 전달)
    availableVarsCatalog?: Record<string, VarCatalogEntry>;
    availableVars?: string[];
    // ★ D120: 고객사 최근 발송 문안 (few-shot 학습용)
    recentMessages?: string[];
  }
): Promise<AIRecommendResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return getFallbackVariants(extraContext);
  }

  const brandName = extraContext?.brandName || '브랜드';
  const brandSlogan = extraContext?.brandSlogan || '';
  const brandDescription = extraContext?.brandDescription || '';
  const brandTone = extraContext?.brandTone || '친근함';
  const channel = extraContext?.channel || 'SMS';
  const isAd = extraContext?.isAd !== false;
  const rejectNumber = extraContext?.rejectNumber || '';
  
  // ★ 개인화 설정 - 변수 카탈로그 기반 (FIELD_MAP 동적 생성)
  const usePersonalization = extraContext?.usePersonalization || false;
  const personalizationVars = extraContext?.personalizationVars || [];
  const defaultCatalog = buildVarCatalogFromFieldMap();
  const varCatalog = extraContext?.availableVarsCatalog || defaultCatalog.fieldMappings;
  const availableVars = extraContext?.availableVars || defaultCatalog.availableVars;

  // ★ "개인화 필수:" 파싱 — AI에는 프로모션 내용만 전달, 개인화 지시는 분리
  const personalizationDirective = parsePersonalizationDirective(prompt, availableVars);
  const cleanPrompt = personalizationDirective?.cleanPrompt || prompt;
  
  // 개인화 태그 생성 (카탈로그 기반 동적 생성)
  const personalizationTags = personalizationVars.map(v => `%${v}%`).join(', ');
  
  // ★ SMS 가용 바이트 동적 계산 (광고 오버헤드 반영)
  const smsAvailableBytes = getAvailableSmsBytes(isAd, rejectNumber);
  const byteLimit = channel === 'SMS' ? smsAvailableBytes : channel === 'LMS' ? 2000 : channel === 'MMS' ? 2000 : channel === '카카오' ? 4000 : 1000;
  
  // ★ 변수 카탈로그 프롬프트 — 개인화 지정 시 해당 변수만 표시 (AI 오류 최소화 핵심)
  const effectiveVars = (usePersonalization && personalizationVars.length > 0)
    ? personalizationVars
    : availableVars;
  const varCatalogPrompt = buildVarCatalogPrompt(varCatalog, effectiveVars);

  // ★ SMS 바이트 제한 안내 (광고/비광고 구분)
  const smsByteInstruction = channel === 'SMS'
    ? isAd
      ? `- ⚠️ SMS 광고 메시지: 순수 본문을 반드시 ${smsAvailableBytes}바이트 이내로 작성! (시스템이 (광고)표기+수신거부번호를 자동 추가하므로 전체 90바이트 중 본문은 ${smsAvailableBytes}바이트만 사용 가능)\n- 한글 1자=2바이트, 영문/숫자/특수문자=1바이트 기준으로 정확히 계산하세요\n- ${smsAvailableBytes}바이트 초과 시 발송 불가! 짧고 임팩트 있게 작성`
      : `- SMS 비광고 메시지: 순수 본문을 반드시 ${smsAvailableBytes}바이트 이내로 작성\n- 한글 1자=2바이트, 영문/숫자/특수문자=1바이트 기준으로 정확히 계산하세요`
    : '';

  // ★ 카카오 채널 안내
  const kakaoInstruction = channel === '카카오'
    ? `- 카카오 메시지: 최대 4,000자 (한글 기준)
- 이모지 사용 가능! 포인트로 적절히 활용 (1~2개)
- 줄바꿈과 이모지로 가독성 높게 구성
- ⚠️ (광고) 표기와 수신거부는 시스템이 처리하므로 본문에 넣지 마세요
- 발송 가능 시간: 08:00~20:50 (이 시간 밖 발송 불가)`
    : '';
  
  const userMessage = `## 캠페인 정보
- 요청: ${cleanPrompt}
- 채널: ${channel}
- 타겟 고객 수: ${targetInfo.total_count.toLocaleString()}명

⚠️ 중요: (광고), 무료거부, 무료수신거부, 080번호를 메시지에 절대 포함하지 마세요! 시스템이 자동으로 붙입니다.
⚠️ 중요: 사용자가 언급하지 않은 할인율, 적립금, 사은품, 무료배송 등을 절대 지어내지 마세요!
⚠️ 중요: 사용자가 지정하지 않은 날짜/기간/가격을 절대 만들어내지 마세요! 기간 미지정 시 날짜 자체를 넣지 마세요!

## 오늘 날짜 (한국 시간)
${getKoreanToday()}
※ "내일", "모레" 등은 위 날짜 기준으로 구체적 날짜(예: 2/5(수))로 변환하세요.

${getKoreanCalendar()}
⚠️ 날짜에 요일을 표기할 때 반드시 위 달력을 참조하세요! 직접 요일을 계산하지 마세요!

## 브랜드 정보 (⚠️ 반드시 아래 브랜드명을 정확히 사용!)
- 브랜드명: ${brandName}
${brandSlogan ? `- 슬로건: ${brandSlogan}` : ''}
${brandDescription ? `- 브랜드 소개: ${brandDescription}` : ''}
- 톤앤매너: ${brandTone}
${extraContext?.productName ? `- 상품: ${extraContext.productName}` : ''}
${extraContext?.discountRate ? `- 할인율: ${extraContext.discountRate}%` : ''}
${extraContext?.eventName ? `- 이벤트: ${extraContext.eventName}` : ''}

${extraContext?.recentMessages && extraContext.recentMessages.length > 0 ? `## 이 브랜드의 최근 실제 발송 문안 (⚠️ 반드시 이 톤과 구성을 참고하세요!)
${extraContext.recentMessages.map((m: string, i: number) => `${i + 1}. ${m.replace(/\(광고\)/g, '').replace(/무료거부\d+/g, '').replace(/무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '').trim().slice(0, 300)}`).join('\n')}

⚠️ 위 문안들의 톤, 표현 방식, 문장 구성, 인사말 패턴을 철저히 분석하고 동일한 스타일로 새 문안을 작성하세요!
⚠️ 위 레퍼런스를 그대로 복사하지 말고, 같은 느낌의 새로운 문안을 창작하세요!` : ''}

${varCatalogPrompt}

## 요청사항
${channel} 채널에 최적화된 3가지 문안(A/B/C)을 생성해주세요.
- 브랜드명은 "[${brandName}]" 형태로 정확히 사용
${brandSlogan ? `- 브랜드 슬로건 "${brandSlogan}"의 느낌을 반영` : ''}
- 톤앤매너: ${brandTone}
- 🚫 (광고), 무료거부, 무료수신거부, 080번호 절대 포함 금지! 순수 본문만 작성!
- 🚫 사용자가 언급하지 않은 혜택(할인율, 적립금, 사은품 등) 날조 금지!
- 🚫 사용자가 지정하지 않은 날짜/기간/가격 날조 금지! 기간 미지정 시 날짜를 넣지 마세요!
${smsByteInstruction}
${kakaoInstruction}
${channel === 'LMS' ? '- LMS는 한 줄 최대 17자 이내로 짧게, 줄바꿈으로 가독성 좋게 작성 (이모지 금지!)\n- ⚠️ subject(제목)에는 %변수% 절대 사용 금지! 고정 텍스트만!' : ''}

## 개인화 설정 (⚠️ 중요!)
- 개인화 사용: ${usePersonalization ? '예' : '아니오'}
${usePersonalization ? `- 사용할 개인화 변수: ${personalizationTags}
- 메시지에 반드시 위 변수를 자연스럽게 포함하세요!
- ⚠️ 3개 문안(A/B/C) 모두에 위 개인화 변수를 동일하게 반드시 포함하세요!
- 하나의 문안에만 변수를 넣고 나머지에는 빠뜨리는 것은 절대 금지!
- 예시: "%이름%님, 적립금 %포인트%원이 곧 소멸됩니다"
- 변수는 반드시 %변수명% 형태로 작성 (예: %이름%, %포인트%)
- ⚠️ 위 "사용 가능한 개인화 변수" 목록에 있는 것만 사용! 다른 변수 생성 금지!` : '- 개인화 변수 없이 일반 문안으로 작성\n- %...% 형태의 변수를 사용하지 마세요.'}`;

  try {
    const text = await callAIWithFallback({
      system: BRAND_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 2048,
      temperature: 0.7,
    });
    
    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr) as AIRecommendResult;
    
    // ★ 생성된 메시지에서 잘못된 변수 검증 + 자동 제거 (안전장치)
    if (result.variants) {
      for (const variant of result.variants) {
        let msgField = (variant as any).message_text || '';
        
        // ★ 안전장치: AI가 (광고), 무료거부 등을 포함했으면 자동 제거
        msgField = msgField.replace(/^\(광고\)\s?/g, '');
        msgField = msgField.replace(/\n?무료거부\d{8,11}/g, '');
        msgField = msgField.replace(/\n?무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '');
        // ★ 안전장치: 구분선 자동 제거 (모바일 줄넘김 방지)
        msgField = msgField.replace(/[━─═＿_~\-]{3,}/g, '');
        msgField = msgField.replace(/\n{3,}/g, '\n\n'); // 빈줄 3개 이상 → 2개로
        // ★ 안전장치: SMS/LMS/MMS 이모지 강제 제거 (카카오만 허용)
        if (channel !== '카카오' && channel !== 'KAKAO') {
          msgField = stripEmojis(msgField);
        }
        msgField = msgField.trim();
        (variant as any).message_text = msgField;
        
        // ★ D28: 제목에서 %변수% 강제 제거 (AI가 프롬프트 무시 시 안전장치)
        if ((variant as any).subject) {
          (variant as any).subject = ((variant as any).subject as string).replace(/%[^%\s]{1,20}%/g, '').replace(/  +/g, ' ').trim();
        }
        
        // ★ #11 수정: 개인화 모드일 때 personalizationVars(선택된 변수)만 허용, 비선택 변수 제거
        const validationTarget = usePersonalization && personalizationVars.length > 0
          ? personalizationVars  // 사용자가 선택한 변수만
          : availableVars;       // 비개인화 모드면 전체 (혹시 AI가 변수를 넣었을 경우 대비)
        const validation = validatePersonalizationVars(msgField, validationTarget);
        if (!validation.valid) {
          console.warn(`[AI 변수 검증] 잘못된 변수 발견: ${validation.invalidVars.join(', ')} → 제거`);
          let cleaned = msgField;
          for (const invalidVar of validation.invalidVars) {
            cleaned = cleaned.replace(new RegExp(`%${invalidVar}%\\s*`, 'g'), '');
            cleaned = cleaned.replace(new RegExp(`\\s*%${invalidVar}%`, 'g'), '');
          }
          cleaned = cleaned.replace(/  +/g, ' ').replace(/\n /g, '\n').trim();
          (variant as any).message_text = cleaned;
        }
      }

      // ★ #9: SMS 바이트 초과 시 경고 로그 + 프론트 표시용 byte_count/byte_warning 추가
      if (channel === 'SMS') {
        for (const variant of result.variants) {
          const msgBytes = calculateKoreanBytes((variant as any).message_text || '');
          const totalBytes = isAd
            ? msgBytes + 6 + 1 + 8 + (rejectNumber ? rejectNumber.replace(/-/g, '').length : 10)
            : msgBytes;
          (variant as any).byte_count = msgBytes;
          (variant as any).byte_warning = totalBytes > 90;
          if (totalBytes > 90) {
            console.warn(`[AI SMS 바이트 초과] ${variant.variant_id}: 총 ${totalBytes}bytes (본문 ${msgBytes}bytes)`);
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('AI 메시지 생성 오류:', error);
    return getFallbackVariants(extraContext);
  }
}

// ============================================================
// ★ D84: 동적 필드 탐지 공통 함수 — recommendTarget + parseBriefing 공용
// AI 프롬프트에 고객사별 실제 데이터 기반 필터 필드를 제공하기 위한 컨트롤타워
// ============================================================

interface ActiveFieldsResult {
  activeColumnFields: ReturnType<typeof getColumnFields>;
  customFieldLabels: Record<string, string>;
  distinctValues: Record<string, string[]>;
}

/**
 * 고객사별 데이터 있는 필드 + 커스텀 필드 라벨 + DISTINCT 값 일괄 조회.
 * recommendTarget, parseBriefing 등 AI 프롬프트 생성 시 공통 사용.
 */
export async function detectActiveFields(companyId: string): Promise<ActiveFieldsResult> {
  // 1) 직접 컬럼 필드 — 데이터 존재 여부 한 번에 체크
  const detectableFields = getColumnFields().filter(f => f.fieldKey !== 'name' && f.fieldKey !== 'phone' && f.fieldKey !== 'sms_opt_in');
  const countFilters = detectableFields.map(f => {
    const c = f.columnName;
    if (f.fieldKey === 'age') return `COUNT(*) FILTER (WHERE ${c} IS NOT NULL AND ${c} > 0 OR birth_date IS NOT NULL) as cnt_${f.fieldKey}`;
    if (f.dataType === 'number') return `COUNT(*) FILTER (WHERE ${c} IS NOT NULL AND ${c} > 0) as cnt_${f.fieldKey}`;
    if (f.dataType === 'date') return `COUNT(*) FILTER (WHERE ${c} IS NOT NULL) as cnt_${f.fieldKey}`;
    return `COUNT(*) FILTER (WHERE ${c} IS NOT NULL AND ${c} != '') as cnt_${f.fieldKey}`;
  });

  // 2) 커스텀 필드 라벨 조회
  const [fieldCountRes, fieldDefsRes] = await Promise.all([
    query(`SELECT ${countFilters.join(', ')} FROM customers WHERE company_id = $1 AND is_active = true`, [companyId]),
    query(`SELECT field_key, field_label FROM customer_field_definitions WHERE company_id = $1 AND (is_hidden = false OR is_hidden IS NULL) ORDER BY display_order`, [companyId]),
  ]);
  const dc = fieldCountRes.rows[0] || {};
  const customFieldLabels: Record<string, string> = {};
  for (const fd of fieldDefsRes.rows) {
    customFieldLabels[fd.field_key] = fd.field_label;
  }

  // 3) 데이터 있는 직접 컬럼 필드만 추출
  const activeColumnFields = detectableFields.filter(f => parseInt(dc[`cnt_${f.fieldKey}`] || '0') > 0);

  // 4) 모든 문자열 필드 DISTINCT 조회 — AI가 정확한 DB값만 사용하도록
  const distinctValues: Record<string, string[]> = {};
  try {
    const stringFields = activeColumnFields.filter(f => f.dataType === 'string');
    if (stringFields.length > 0) {
      const distinctQueries = stringFields.map(f =>
        query(
          `SELECT DISTINCT ${f.columnName} FROM customers WHERE company_id = $1 AND ${f.columnName} IS NOT NULL AND ${f.columnName} != '' ORDER BY ${f.columnName} LIMIT 200`,
          [companyId]
        )
      );
      const results = await Promise.all(distinctQueries);
      stringFields.forEach((f, i) => {
        const vals = results[i].rows.map((r: any) => r[f.columnName]).filter(Boolean);
        if (vals.length > 0) distinctValues[f.fieldKey] = vals;
      });
    }

    // 커스텀 필드도 DISTINCT 조회 (라벨 있는 필드만)
    for (const [key, label] of Object.entries(customFieldLabels)) {
      try {
        const cfRes = await query(
          `SELECT DISTINCT custom_fields->>'${key}' as val FROM customers WHERE company_id = $1 AND custom_fields->>'${key}' IS NOT NULL AND custom_fields->>'${key}' != '' ORDER BY val LIMIT 200`,
          [companyId]
        );
        const vals = cfRes.rows.map((r: any) => r.val).filter(Boolean);
        if (vals.length > 0) distinctValues[`custom_fields.${key}`] = vals;
      } catch (cfErr) {
        // 개별 커스텀 필드 조회 실패 시 무시
      }
    }
  } catch (err) {
    console.warn('[AI] DISTINCT 조회 실패:', err);
  }

  return { activeColumnFields, customFieldLabels, distinctValues };
}

/**
 * AI 프롬프트용 "사용 가능한 필터 필드" 섹션 생성.
 * detectActiveFields() 결과를 받아 프롬프트 텍스트로 변환.
 */
export function buildFilterFieldsPrompt(fields: ActiveFieldsResult): string {
  const { activeColumnFields, customFieldLabels, distinctValues } = fields;

  const columnLines = activeColumnFields.map(f => {
    const key = f.fieldKey;
    const label = f.displayName;
    const vals = distinctValues[key];
    if (key === 'age') return `- age: ${label} (between 연산자로 범위 지정, 예: [20, 29])`;
    if (key === 'birth_date') return `- birth_date: ${label} (birth_month 연산자로 월 필터, 예: {"operator": "birth_month", "value": 3} → 3월 생일)`;
    if (key === 'store_code') return `- store_code: ${label} (eq/in 연산자)${vals ? ' → 반드시 다음 값 중 하나만 정확히 사용: ' + vals.join(', ') : ''}`;
    if (f.dataType === 'number') return `- ${key}: ${label} (gte, lte, between 연산자)`;
    if (f.dataType === 'date') return `- ${key}: ${label} (days_within, gte, lte 연산자)`;
    if (['address', 'name', 'email'].includes(key)) {
      return `- ${key}: ${label} (contains 연산자 권장 — 부분일치 검색. 예: {"operator":"contains","value":"용산구"})`;
    }
    if (vals && vals.length > 0) {
      const valList = vals.length > 50 ? vals.slice(0, 50).join(', ') + ` ... 외 ${vals.length - 50}개` : vals.join(', ');
      return `- ${key}: ${label} → ⚠️ 반드시 다음 값 중 하나만 정확히 사용 (띄어쓰기/대소문자 그대로): ${valList}`;
    }
    return `- ${key}: ${label} (eq/in 연산자)`;
  }).join('\n');

  const customLines = Object.entries(customFieldLabels).map(([key, label]) => {
    const vals = distinctValues[`custom_fields.${key}`];
    const baseOps = 'eq/gte/lte/between/in/contains/date_gte/date_lte';
    if (vals && vals.length > 0) {
      const valList = vals.length > 50 ? vals.slice(0, 50).join(', ') + ` ... 외 ${vals.length - 50}개` : vals.join(', ');
      return `- custom_fields.${key}: ${label} (${baseOps}) → ⚠️ 반드시 다음 값 중 하나만 정확히 사용: ${valList}`;
    }
    return `- custom_fields.${key}: ${label} (커스텀 필드, ${baseOps}. ⚠️ 날짜 데이터는 반드시 date_gte/date_lte 사용!)`;
  }).join('\n');

  return `## 사용 가능한 필터 필드 (⚠️ 반드시 아래 값만 정확히 사용! 이 고객사에 실제 데이터가 있는 필드만 표시됨)
${columnLines}
${customLines}

⚠️ 주의: region, grade 등 직접 컬럼 필드는 "custom_fields."를 붙이지 않고 그대로 사용!
⚠️ 극히 중요: 필터 값에는 반드시 위 목록에 표시된 정확한 DB값만 사용하세요! 사용자 입력의 띄어쓰기/오타를 그대로 쓰지 말고, 위 목록에서 가장 일치하는 정확한 값을 골라 사용하세요. 목록에 없는 값은 절대 사용하지 마세요.`;
}

// ============================================================
// 타겟 추천 (recommendTarget)
// ============================================================

export async function recommendTarget(
  companyId: string,
  objective: string,
  customerStats: any,
  companyInfo?: { business_type?: string; reject_number?: string; brand_name?: string; company_name?: string; customer_schema?: any; has_kakao_profile?: boolean }
): Promise<{
  filters: any;
  reasoning: string;
  estimated_count: number;
  recommended_channel: string;
  channel_reason: string;
  is_ad: boolean;
  recommended_time: string;
  suggested_campaign_name: string;
  use_individual_callback: boolean;
  use_personalization: boolean;
  personalization_vars: string[];
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      filters: {},
      reasoning: 'API 키가 설정되지 않았습니다.',
      estimated_count: 0,
      recommended_channel: 'SMS',
      channel_reason: '기본 채널입니다.',
      is_ad: true,
      recommended_time: '',
      suggested_campaign_name: '캠페인',
      use_individual_callback: false,
      use_personalization: false,
      personalization_vars: [],
    };
  }

  // ★ 변수 카탈로그 추출 (customer_schema 기반, 없으면 FIELD_MAP 동적 생성)
  const { fieldMappings, availableVars } = extractVarCatalog(companyInfo?.customer_schema);

  // ★ D101: 커스텀 필드 라벨을 availableVars + fieldMappings에 먼저 추가
  // parsePersonalizationDirective보다 먼저 실행해야 "개인화 : 시리얼" 파싱 가능
  const earlyFieldDefs = await detectActiveFields(companyId);
  for (const [fieldKey, label] of Object.entries(earlyFieldDefs.customFieldLabels)) {
    if (!availableVars.includes(label)) {
      availableVars.push(label);
      fieldMappings[label] = {
        column: fieldKey,
        type: 'string',
        description: label,
        sample: '',
        storageType: 'custom_fields' as any,
      };
    }
  }

  // 키워드 감지: 개별회신번호
  const useIndividualCallback = /매장번호|각 매장|주이용매장|개별번호|각자 번호/.test(objective);

  // ★ "개인화 필수:" 명시적 파싱 우선, 없으면 기존 자동 감지 (하위호환)
  // ★ D101: availableVars에 커스텀 필드 라벨이 이미 포함되어 있으므로 "개인화 : 시리얼" 매칭 가능
  const personalizationDirective = parsePersonalizationDirective(objective, availableVars);
  const cleanObjective = personalizationDirective?.cleanPrompt || objective;

  let usePersonalization: boolean;
  let personalizationVars: string[];

  if (personalizationDirective && personalizationDirective.requestedVars.length > 0) {
    // 명시적 "개인화 필수:" 지정 → 해당 변수만
    usePersonalization = true;
    personalizationVars = personalizationDirective.requestedVars;
  } else {
    // 기존 로직: "개인화" 키워드 감지 + 동적 변수 감지
    usePersonalization = /개인화/.test(objective);
    personalizationVars = detectPersonalizationVars(objective, fieldMappings, availableVars);
  }

  const businessType = companyInfo?.business_type || '기타';
  const brandName = companyInfo?.brand_name || companyInfo?.company_name || '브랜드';
  const hasKakaoProfile = companyInfo?.has_kakao_profile || false;

  // ★ D101: detectActiveFields는 위에서 이미 호출됨 (earlyFieldDefs)
  const { activeColumnFields, customFieldLabels, distinctValues } = earlyFieldDefs;

  // 하위호환: 기존 변수명 유지
  const genders = (distinctValues['gender'] || []).join(', ');
  const grades = (distinctValues['grade'] || []).join(', ');
  const regions = (distinctValues['region'] || []).join(', ');

  // ★ 변수 카탈로그 프롬프트 — 개인화 필수 지정 시 해당 변수만 표시
  const effectiveVars = (personalizationDirective?.requestedVars.length)
    ? personalizationDirective.requestedVars
    : availableVars;
  const varCatalogPrompt = buildVarCatalogPrompt(fieldMappings, effectiveVars);

  const userMessage = `## 회사 정보
- 업종: ${businessType}
- 브랜드명: ${brandName}

## 현재 날짜 (한국 시간 기준)
오늘: ${getKoreanToday()}
현재 시각: ${getKoreanNowTime()}

⚠️ recommended_time은 반드시 현재 시각 이후여야 합니다!
현재 시각이 이미 지난 시간이면 내일 또는 다음 적절한 날짜의 시간을 추천하세요.

${getKoreanCalendar()}

이벤트 기간 작성 시 반드시 위 달력의 요일을 확인하세요!

## 마케팅 목표
${cleanObjective}

## 현재 고객 데이터 통계
- 전체 고객: ${customerStats.total}명
- SMS 수신동의: ${customerStats.sms_opt_in_count}명
- 남성: ${customerStats.male_count}명 / 여성: ${customerStats.female_count}명
- 평균 구매횟수: ${Number(customerStats.avg_purchase_count || 0).toFixed(1)}회
- 평균 구매금액: ${Math.round(Number(customerStats.avg_total_spent || 0)).toLocaleString()}원

${buildFilterFieldsPrompt({ activeColumnFields, customFieldLabels, distinctValues })}

${varCatalogPrompt}

## 채널 선택 기준
- SMS: 간단한 할인 안내, 짧은 알림 (광고 시 본문 약 64바이트, 비광고 시 약 88바이트)
- LMS: 상세한 이벤트 안내, 여러 혜택 설명 필요시 (2000바이트)
- MMS: 이미지가 중요한 경우 (신상품, 비주얼 강조)
- 카카오: 카카오 채널 친구 대상 발송, 이모지/버튼 활용, 비용 절감 목적, 리치 콘텐츠 필요시 (최대 4,000자)
  ※ 카카오는 발송 가능 시간 08:00~20:50 제한 있음 (recommended_time 추천 시 반드시 이 범위 내로!)
  ※ 카카오 추천 시 recommended_channel: "카카오"로 표기

${hasKakaoProfile ? '⚠️ 이 고객사는 카카오 발신 프로필이 등록되어 있어 카카오 채널 추천이 가능합니다.' : '⚠️ 이 고객사는 카카오 발신 프로필이 미등록이므로 카카오 채널은 추천하지 마세요. SMS/LMS/MMS만 추천하세요.'}

⚠️ 필수 규칙: 개인화 변수(%이름%, %등급%, %등록매장정보%, %최근구매매장% 등)를 사용하는 경우 반드시 LMS 이상을 추천하세요!
개인화 변수는 치환 시 바이트가 늘어나므로 SMS(90바이트)에서는 초과 위험이 매우 높습니다.
개인화가 포함된 캠페인에서 SMS를 추천하는 것은 절대 금지입니다.

## 광고성 판단 기준
- 광고성 (is_ad: true): 할인, 세일, 이벤트, 프로모션, 신상품 홍보, 쿠폰
- 알림성 (is_ad: false): 마일리지 소멸 안내, 예약 확인, 배송 안내, 결제 완료

## 개인화 & 회신번호 판단 (⚠️ 중요!)
- "개인화" 키워드 있으면 → use_personalization: true
- "매장번호", "각 매장", "주이용매장", "개별번호" 있으면 → use_individual_callback: true
- 개인화 사용 시 personalization_vars에는 위 "사용 가능한 개인화 변수" 목록에 있는 변수명만 포함!
- ⚠️ personalization_vars에 위 목록에 없는 변수를 절대 넣지 마세요!

현재 요청 분석:
- 개인화 요청: ${usePersonalization ? '예' : '아니오'}
- 개별회신번호 요청: ${useIndividualCallback ? '예' : '아니오'}
- 감지된 개인화 변수: ${personalizationVars.length > 0 ? personalizationVars.join(', ') : '없음'}

## 출력 형식 (JSON만 응답)
{
  "filters": {
    "필드명": { "operator": "연산자", "value": 값 }
  },
  "reasoning": "이 타겟을 추천하는 이유 (한글 1~2문장)",
  "estimated_percentage": 예상 타겟 비율(%),
  "recommended_channel": "SMS 또는 LMS 또는 MMS 또는 카카오 (⚠️ 카카오 추천 시 시간은 08:00~20:50 범위 내로!)",
  "channel_reason": "이 채널을 추천하는 이유 (한글 1문장)",
  "is_ad": true 또는 false,
  "recommended_time": "YYYY-MM-DD HH:mm (한국시간 기준)",
  "suggested_campaign_name": "타겟+이벤트 요약 (예: 20대여성 봄세일, VIP고객 감사이벤트, 30대남성 스킨케어)",
  "use_individual_callback": true 또는 false,
  "use_personalization": true 또는 false,
  "personalization_vars": ["이름", "포인트", "등급"] 또는 []
}

연산자: eq(같음), gte(이상), lte(이하), between([최소,최대]), in([배열]), contains(부분일치 — 주소/이름 등 자유텍스트 필드용), birth_month(생일 월 필터, birth_date 전용), date_gte(날짜 이상, 커스텀필드 전용), date_lte(날짜 이하, 커스텀필드 전용)
⚠️ address(주소) 필드는 반드시 contains 연산자 사용! eq 사용 시 글자 하나까지 정확히 일치해야 하므로 매칭 불가.
⚠️ 커스텀 필드에 날짜 데이터(생년월일, 가입일 등)가 저장된 경우: 반드시 date_gte/date_lte 사용! gte/lte는 숫자 전용입니다.
⚠️ 나이 기반 필터링 시: birth_date 직접 컬럼의 birth_month 연산자 또는 age 직접 컬럼을 사용하세요. 커스텀 필드의 생년월일로 나이를 계산하지 마세요.`;

  try {
    const text = await callAIWithFallback({
      system: '당신은 CRM 마케팅 타겟팅 전문가입니다. 주어진 목표에 최적화된 고객 세그먼트와 최적의 발송 채널을 추천해주세요. recommended_time은 반드시 현재 시각 이후의 미래 시간이어야 합니다. JSON 형식으로만 응답하세요.',
      userMessage,
      maxTokens: 1024,
      temperature: 0.3,
    });
    
    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);
    
    // ★ AI가 반환한 personalization_vars 검증 — available_vars에 없는 것 제거
    let aiPersonalizationVars = result.personalization_vars || personalizationVars;
    aiPersonalizationVars = aiPersonalizationVars.filter((v: string) => availableVars.includes(v));
    
    // ★ 개인화 판단: 백엔드 확정값 우선 (AI가 지맘대로 바꾸는 문제 방지)
    // - "개인화 필수:" 명시 → 사용자 지정 변수 강제 (AI 응답 무시)
    // - "개인화" 키워드만 있으면 → AI 감지 + 자동 감지 결합
    // - 둘 다 없으면 → false
    const finalUsePersonalization = usePersonalization;
    const finalPersonalizationVars = finalUsePersonalization
      ? (personalizationDirective?.requestedVars.length
        ? personalizationDirective.requestedVars
        : (aiPersonalizationVars.length > 0 ? aiPersonalizationVars : personalizationVars))
      : [];
    
    return {
      filters: result.filters,
      reasoning: result.reasoning,
      estimated_count: Math.round((customerStats.total * (result.estimated_percentage ?? 10)) / 100),
      recommended_channel: result.recommended_channel || 'SMS',
      channel_reason: result.channel_reason || '기본 채널입니다.',
      is_ad: result.is_ad !== false,
      recommended_time: result.recommended_time || '',
      suggested_campaign_name: result.suggested_campaign_name || '캠페인',
      use_individual_callback: result.use_individual_callback || useIndividualCallback,
      use_personalization: finalUsePersonalization,
      personalization_vars: finalPersonalizationVars,
    };
  } catch (error) {
    console.error('AI 타겟 추천 오류:', error);
    return {
      filters: {},
      reasoning: '추천 생성 중 오류가 발생했습니다.',
      estimated_count: 0,
      recommended_channel: 'SMS',
      channel_reason: '기본 채널입니다.',
      is_ad: true,
      recommended_time: '',
      suggested_campaign_name: '캠페인',
      use_individual_callback: useIndividualCallback,
      use_personalization: usePersonalization,
      personalization_vars: personalizationVars,
    };
  }
}

// ============================================================
// 폴백 메시지
// ============================================================

function getFallbackVariants(extraContext?: any): AIRecommendResult {
  const brand = extraContext?.brandName || '브랜드';
  const product = extraContext?.productName || '상품';
  const discount = extraContext?.discountRate ? `${extraContext.discountRate}%` : '특별';

  return {
    variants: [
      {
        variant_id: 'A',
        variant_name: '혜택 직접형',
        concept: '할인 혜택 직접 전달',
        sms_text: `[${brand}] ${product} ${discount} 할인! 지금 확인▶`,
        lms_text: `[${brand}] ${product} ${discount} 할인\n\n지금 바로 확인하세요!\n\n▶ 바로가기`,
        kakao_text: `${brand}에서 알려드려요 🎉\n\n${product} ${discount} 할인 이벤트가 진행 중이에요!\n\n지금 바로 확인해보세요 ✨`,
        score: 70,
      },
      {
        variant_id: 'B',
        variant_name: '긴급/한정',
        concept: '마감 임박 긴급함 강조',
        sms_text: `[${brand}] 마감임박! ${product} ${discount} 할인▶`,
        lms_text: `[${brand}] 마감 임박!\n\n${product} ${discount} 할인\n\n서두르세요!\n\n▶ 바로가기`,
        kakao_text: `⏰ 마감 임박!\n\n${brand} ${product} ${discount} 할인이 곧 종료됩니다.\n\n서두르세요!`,
        score: 65,
      },
      {
        variant_id: 'C',
        variant_name: '재방문 유도',
        concept: '휴면 고객 재활성화',
        sms_text: `[${brand}] 오랜만이에요! ${product} ${discount} 할인▶`,
        lms_text: `[${brand}] 오랜만이에요!\n\n다시 만나 반가워요!\n${product} ${discount} 할인\n\n▶ 바로가기`,
        kakao_text: `오랜만이에요! 💝\n\n${brand}에서 다시 만나 반가워요.\n${product} ${discount} 할인으로 준비했어요.\n\n다시 만나러 와주실 거죠?`,
        score: 60,
      },
    ],
    recommendation: 'A',
    recommendation_reason: '기본 추천입니다.',
  };
}

// ============================================================
// SMS 바이트 계산 (한글 2바이트, 영문/숫자/특수문자 1바이트)
function calculateKoreanBytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    bytes += text.charCodeAt(i) > 127 ? 2 : 1;
  }
  return bytes;
}

/**
 * SMS/LMS/MMS 이모지 강제 제거 안전장치
 * - AI가 프롬프트 무시하고 이모지를 넣는 경우 후처리로 제거
 * - 허용: ★☆●○◎◇◆□■△▲▽▼→←↑↓♠♣♥♡♦※☎▶◀【】「」『』 등 KS X 1001 특수문자
 * - 제거: 유니코드 이모지 (Emoticons, Pictographs, Transport, Flags 등)
 * - 카카오 채널은 이모지 허용이므로 호출하지 않음
 */
function stripEmojis(text: string): string {
  return text
    // Surrogate pair 이모지 (U+1F000 이상) — 대부분의 컬러 이모지
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // Misc Symbols & Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // Transport & Map
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')   // Alchemical
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')   // Geometric Extended
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')   // Supplemental Arrows
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // Supplemental Symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')   // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // Symbols Extended-A
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // Regional Indicators (Flags)
    .replace(/[\u{231A}-\u{231B}]/gu, '')     // ⌚⌛
    .replace(/[\u{23E9}-\u{23F3}]/gu, '')     // ⏩~⏳
    .replace(/[\u{23F8}-\u{23FA}]/gu, '')     // ⏸~⏺
    .replace(/[\u{25FB}-\u{25FE}]/gu, '')     // ◻◼◽◾
    .replace(/[\u{2614}-\u{2615}]/gu, '')     // ☔☕
    .replace(/[\u{2648}-\u{2653}]/gu, '')     // ♈~♓ (별자리)
    .replace(/[\u{267F}]/gu, '')              // ♿
    .replace(/[\u{2693}]/gu, '')              // ⚓
    .replace(/[\u{26A1}]/gu, '')              // ⚡
    .replace(/[\u{26AA}-\u{26AB}]/gu, '')     // ⚪⚫
    .replace(/[\u{26BD}-\u{26BE}]/gu, '')     // ⚽⚾
    .replace(/[\u{26C4}-\u{26C5}]/gu, '')     // ⛄⛅
    .replace(/[\u{26D4}]/gu, '')              // ⛔
    .replace(/[\u{26EA}]/gu, '')              // ⛪
    .replace(/[\u{26F2}-\u{26F3}]/gu, '')     // ⛲⛳
    .replace(/[\u{26F5}]/gu, '')              // ⛵
    .replace(/[\u{26FA}]/gu, '')              // ⛺
    .replace(/[\u{26FD}]/gu, '')              // ⛽
    .replace(/[\u{2702}]/gu, '')              // ✂
    .replace(/[\u{2705}]/gu, '')              // ✅
    .replace(/[\u{2708}-\u{270D}]/gu, '')     // ✈~✍
    .replace(/[\u{270F}]/gu, '')              // ✏
    .replace(/[\u{2712}]/gu, '')              // ✒
    .replace(/[\u{2714}]/gu, '')              // ✔
    .replace(/[\u{2716}]/gu, '')              // ✖
    .replace(/[\u{271D}]/gu, '')              // ✝
    .replace(/[\u{2721}]/gu, '')              // ✡
    .replace(/[\u{2728}]/gu, '')              // ✨
    .replace(/[\u{2733}-\u{2734}]/gu, '')     // ✳✴
    .replace(/[\u{2744}]/gu, '')              // ❄
    .replace(/[\u{2747}]/gu, '')              // ❇
    .replace(/[\u{274C}]/gu, '')              // ❌
    .replace(/[\u{274E}]/gu, '')              // ❎
    .replace(/[\u{2753}-\u{2755}]/gu, '')     // ❓❔❕
    .replace(/[\u{2757}]/gu, '')              // ❗
    .replace(/[\u{2763}-\u{2764}]/gu, '')     // ❣❤
    .replace(/[\u{2795}-\u{2797}]/gu, '')     // ➕➖➗
    .replace(/[\u{27A1}]/gu, '')              // ➡
    .replace(/[\u{27B0}]/gu, '')              // ➰
    .replace(/[\u{27BF}]/gu, '')              // ➿
    .replace(/[\u{FE0F}]/gu, '')              // Variation Selector-16
    .replace(/[\u{200D}]/gu, '')              // Zero Width Joiner
    .replace(/[\u{20E3}]/gu, '')              // Combining Enclosing Keycap
    // 연속 공백 정리
    .replace(/  +/g, ' ')
    .replace(/ *\n/g, '\n')    // 줄 끝 공백 제거
    .replace(/\n /g, '\n')     // 줄 시작 공백 제거
    .trim();
}

// 프로모션 브리핑 파싱 (parseBriefing)
// ============================================================

/**
 * ★ D84: parseBriefing 시스템 프롬프트를 동적으로 생성.
 * 기존 하드코딩 프롬프트에서 targetFilters 필드가 9개만 고정이었던 문제 해결.
 * recommendTarget과 동일한 detectActiveFields + buildFilterFieldsPrompt 사용.
 */
function buildParseBriefingSystem(filterFieldsPrompt: string): string {
  return `당신은 마케팅 프로모션 분석 전문가입니다.
마케터가 자연어로 브리핑한 프로모션 내용을 구조화된 JSON으로 파싱합니다.

## 파싱 규칙
- 브리핑에서 명시적으로 언급된 정보만 추출
- 언급되지 않은 항목은 빈 문자열("")로 설정
- 절대 정보를 지어내거나 추측하지 마세요
- 할인율, 기간, 조건 등은 브리핑 원문 그대로 반영
- 여러 혜택이 있으면 benefit에 모두 나열

## 타겟 조건 파싱 규칙
- 브리핑에서 발송 대상/타겟에 대한 언급을 별도로 구조화
- "VIP 고객", "여성", "3개월 내 구매", "강남점", "20대" 등 타겟 관련 키워드 추출
- 언급이 없으면 모든 필드를 빈 문자열로 설정 (= 전체 고객 대상)
- 성별: "남성", "여성" 또는 빈 문자열
- 등급: "VIP", "GOLD", "SILVER" 등 원문 그대로
- 연령대: "20대", "30~40대" 등 원문 그대로
- 구매 기간: "최근 3개월", "6개월 이내" 등 원문 그대로

## targetFilters 작성 규칙 (DB 쿼리용 구조화 필터)
- targetCondition과 별도로, 실제 DB 쿼리에 사용할 구조화 필터를 생성
- 브리핑에서 명시적으로 언급된 조건만 포함 — 언급 안 된 필드는 아예 제외
- 타겟 조건이 전혀 없으면 빈 객체 {} 반환 (= 전체 고객)
- 성별: 반드시 "M"(남성) 또는 "F"(여성)로 변환
- 등급: 배열 형태로 ["VIP"], ["VIP","GOLD"] 등
- 연령: [최소나이, 최대나이] 범위로 변환 — "20대"→[20,29], "30~40대"→[30,49]
- 구매 기간: "최근 N개월"은 오늘 날짜(user 메시지에 명시) 기준 ISO 날짜(YYYY-MM-DD)로 변환
- 생일: birth_date 필드에 birth_month 연산자 사용 — "3월 생일"→{"operator":"birth_month","value":3}
- 커스텀 필드: "custom_fields." 접두사 + field_key 형식 사용 — 예: {"custom_fields.custom_1": {"operator":"eq","value":"참석"}}
- operator 종류: "eq"(같음), "in"(포함), "gte"(이상), "lte"(이하), "between"(범위), "contains"(포함검색), "birth_month"(생일 월), "days_within"(최근 N일), "date_gte"(날짜 이후), "date_lte"(날짜 이전)
- ⚠️ 반드시 아래 "사용 가능한 필터 필드"에 나열된 필드와 값만 사용!

${filterFieldsPrompt}

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):

{
  "promotionCard": {
    "name": "프로모션 제목/이름",
    "benefit": "혜택/할인 내용 (여러 개면 + 로 연결)",
    "condition": "적용 조건 (없으면 빈 문자열)",
    "period": "기간 (없으면 빈 문자열)",
    "target": "대상 고객 요약 (없으면 빈 문자열)",
    "couponCode": "쿠폰코드 (없으면 빈 문자열)",
    "extra": "기타 참고 사항 (없으면 빈 문자열)"
  },
  "targetCondition": {
    "description": "타겟 조건 자연어 요약 (예: 3개월 내 구매한 VIP 여성 고객)",
    "gender": "성별 (남성/여성/빈 문자열)",
    "grade": "등급 (VIP/GOLD 등, 없으면 빈 문자열)",
    "ageRange": "연령대 (20대, 30~40대 등, 없으면 빈 문자열)",
    "region": "지역 (서울, 강남 등, 없으면 빈 문자열)",
    "purchasePeriod": "구매 기간 조건 (최근 3개월 등, 없으면 빈 문자열)",
    "storeName": "매장명/브랜드명 (없으면 빈 문자열)",
    "minPurchaseAmount": "최소 구매금액 조건 (없으면 빈 문자열)",
    "birthMonth": "생일 월 (3월이면 '3', 없으면 빈 문자열)",
    "extra": "기타 타겟 조건 (없으면 빈 문자열)"
  },
  "targetFilters": {
    // ⚠️ 위 "사용 가능한 필터 필드"의 키만 사용! 커스텀 필드는 "custom_fields.custom_N" 형식으로!
    // 예시 (필요한 것만 포함, 나머지는 제외):
    // "gender": "F",
    // "grade": { "value": ["VIP"], "operator": "in" },
    // "age": [30, 49],
    // "custom_fields.custom_1": { "value": "참석", "operator": "eq" }
  }
}`;
}

export interface TargetCondition {
  description: string;
  gender: string;
  grade: string;
  ageRange: string;
  region: string;
  purchasePeriod: string;
  storeName: string;
  minPurchaseAmount: string;
  birthMonth: string;
  extra: string;
}

const EMPTY_TARGET_CONDITION: TargetCondition = {
  description: '',
  gender: '',
  grade: '',
  ageRange: '',
  region: '',
  purchasePeriod: '',
  storeName: '',
  minPurchaseAmount: '',
  birthMonth: '',
  extra: '',
};

export async function parseBriefing(briefing: string, companyId?: string): Promise<{
  promotionCard: {
    name: string;
    benefit: string;
    condition: string;
    period: string;
    target: string;
    couponCode?: string;
    extra?: string;
  };
  targetCondition: TargetCondition;
  targetFilters: Record<string, any>;
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      promotionCard: {
        name: '프로모션',
        benefit: briefing.substring(0, 50),
        condition: '',
        period: '',
        target: '',
        couponCode: '',
        extra: '',
      },
      targetCondition: { ...EMPTY_TARGET_CONDITION },
      targetFilters: {},
    };
  }

  try {
    // ★ D84: 동적 프롬프트 생성 — recommendTarget과 동일한 컨트롤타워 사용
    let filterFieldsPrompt = '';
    if (companyId) {
      try {
        const activeFields = await detectActiveFields(companyId);
        filterFieldsPrompt = buildFilterFieldsPrompt(activeFields);
      } catch (err) {
        console.warn('[parseBriefing] 동적 필드 탐지 실패, 기본 프롬프트 사용:', err);
      }
    }
    const systemPrompt = buildParseBriefingSystem(filterFieldsPrompt);

    const text = await callAIWithFallback({
      system: systemPrompt,
      userMessage: `오늘 날짜: ${getKoreanToday()}\n\n${getKoreanCalendar()}\n⚠️ 날짜→요일 변환 시 반드시 위 달력을 참조하세요!\n\n다음 프로모션 브리핑을 구조화해주세요:\n\n${briefing}`,
      maxTokens: 1024,
      temperature: 0.3,
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);
    return {
      promotionCard: result.promotionCard || {
        name: '', benefit: '', condition: '', period: '', target: '', couponCode: '', extra: '',
      },
      targetCondition: result.targetCondition
        ? { ...EMPTY_TARGET_CONDITION, ...result.targetCondition }
        : { ...EMPTY_TARGET_CONDITION },
      targetFilters: result.targetFilters || {},
    };
  } catch (error) {
    console.error('브리핑 파싱 오류:', error);
    return {
      promotionCard: {
        name: '프로모션',
        benefit: briefing.substring(0, 50),
        condition: '',
        period: '',
        target: '',
        couponCode: '',
        extra: '',
      },
      targetCondition: { ...EMPTY_TARGET_CONDITION },
      targetFilters: {},
    };
  }
}

// ============================================================
// 개인화 맞춤 문안 생성 (generateCustomMessages)
// ============================================================

interface CustomMessageOptions {
  briefing: string;
  promotionCard: {
    name: string;
    benefit: string;
    condition: string;
    period: string;
    target: string;
    couponCode?: string;
    extra?: string;
  };
  personalFields: string[];
  fieldLabels?: Record<string, string>;
  url?: string;
  tone?: string;
  brandName: string;
  brandTone?: string;
  channel: string;
  isAd: boolean;
  rejectNumber?: string;
}

/**
 * field_key → 한글 변수명 변환 (FIELD_MAP 기반 동적 조회)
 * generateCustomMessages에서 개인화 필드를 AI 프롬프트 변수명으로 변환 시 사용
 */
function fieldKeyToVarName(fieldKey: string): string {
  const mapped = getFieldByKey(fieldKey);
  return mapped?.displayName || fieldKey;
}

const TONE_MAP: Record<string, string> = {
  friendly: '친근하고 따뜻한',
  formal: '격식있고 신뢰감 있는',
  humorous: '유머러스하고 재미있는',
  urgent: '긴급하고 행동을 유도하는',
  premium: '고급스럽고 VIP 대우하는',
  casual: '편하고 가벼운',
};

export async function generateCustomMessages(options: CustomMessageOptions): Promise<{
  variants: Array<{
    variant_id: string;
    variant_name: string;
    concept: string;
    message_text: string;
    subject?: string;
    score: number;
  }>;
  recommendation: string;
}> {
  const {
    briefing, promotionCard, personalFields, fieldLabels, url, tone,
    brandName, brandTone, channel, isAd, rejectNumber,
  } = options;

  const varNames = personalFields
    .map(f => (fieldLabels && fieldLabels[f]) || fieldKeyToVarName(f))
    .filter(Boolean);
  const varTags = varNames.map(v => `%${v}%`).join(', ');

  const smsAvailableBytes = getAvailableSmsBytes(isAd, rejectNumber);
  const toneDesc = TONE_MAP[tone || 'friendly'] || '친근하고 자연스러운';

  const cardLines = [
    promotionCard.name && `- 프로모션명: ${promotionCard.name}`,
    promotionCard.benefit && `- 혜택: ${promotionCard.benefit}`,
    promotionCard.condition && `- 조건: ${promotionCard.condition}`,
    promotionCard.period && `- 기간: ${promotionCard.period}`,
    promotionCard.target && `- 대상: ${promotionCard.target}`,
    promotionCard.couponCode && `- 쿠폰코드: ${promotionCard.couponCode}`,
    promotionCard.extra && `- 기타: ${promotionCard.extra}`,
  ].filter(Boolean).join('\n');

  const smsByteInstruction = channel === 'SMS'
    ? isAd
      ? `- ⚠️ SMS 광고: 순수 본문 ${smsAvailableBytes}바이트 이내 필수! (시스템이 (광고)+수신거부 자동 추가)\n- 한글 1자=2바이트, 영문/숫자=1바이트`
      : `- SMS 비광고: 순수 본문 ${smsAvailableBytes}바이트 이내`
    : channel === 'MMS'
      ? '- MMS: 2,000바이트 이내, 이미지 첨부 고려한 간결한 문안'
      : '';

  const userMessage = `## 프로모션 정보 (마케터 확인 완료)
${cardLines}

## 원본 브리핑
${briefing}

## 오늘 날짜
${getKoreanToday()}

${getKoreanCalendar()}
⚠️ 날짜에 요일을 표기할 때 반드시 위 달력을 참조하세요! 직접 요일을 계산하지 마세요!

## 브랜드
- 브랜드명: ${brandName}
${brandTone ? `- 톤앤매너: ${brandTone}` : ''}

## 개인화 변수 (⚠️ 최우선 규칙!)
허용된 변수 목록 (이 목록만 사용 가능): ${varTags}
- 3개 문안(A/B/C) 모두에 위 변수를 반드시 자연스럽게 포함!
- 변수 형식: %변수명% (예: %이름%님, %등급% 고객님)
- ⚠️⚠️⚠️ 절대 금지: 위 목록에 없는 변수 사용! 예를 들어 ${varTags}에 %성별%이 없으면 %성별% 사용 금지!
- 허용되지 않은 변수 사용 시 고객에게 "%변수명%" 텍스트가 그대로 발송되어 사고 발생!
- 허용 변수: ${varTags} ← 오직 이것만!

${url ? `## 바로가기 URL\n- URL: ${url}\n- 문안 하단에 "▶ 바로가기 ${url}" 형태로 배치` : ''}

## 톤/분위기
${toneDesc} 톤으로 작성

## 채널: ${channel}
${smsByteInstruction}
${(channel === 'LMS' || channel === 'MMS') ? `- ${channel}: subject(제목) 필수, 한 줄 최대 17자 이내로 짧게 줄바꿈, 이모지 금지\n- ⚠️ subject(제목)에는 %변수% 절대 사용 금지! 고정 텍스트만! 개인화는 본문에서만!` : ''}

## 요청사항
${channel} 채널에 최적화된 3가지 맞춤 문안(A/B/C)을 생성해주세요.
- 브랜드명: "[${brandName}]" 형태 사용
- 🚫 (광고), 무료거부, 무료수신거부, 080번호 절대 포함 금지! 순수 본문만!
- 🚫 프로모션 카드에 없는 혜택/할인/이벤트 날조 금지!
- 🚫 프로모션 카드에 없는 날짜/기간/가격 날조 금지! 기간 정보가 없으면 날짜를 넣지 마세요!
- 개인화 변수(${varTags})를 활용하여 고객별 맞춤 느낌 극대화
- 각 시안은 서로 다른 컨셉으로 차별화`;

  const systemPrompt = `당신은 대한민국 최고의 개인화 마케팅 문자 메시지 카피라이터입니다.

## 핵심 임무
프로모션 정보와 개인화 변수를 활용하여, 고객 한 명 한 명에게 맞춤형으로 느껴지는 마케팅 문안을 작성합니다.
"왜 지금, 왜 나한테, 왜 이 브랜드"  3박자가 모든 문안에 녹아야 합니다.

## 채널별 규칙

### SMS
- 짧고 임팩트 있게, 핵심 혜택만
- 바이트 제한 엄수 (사용자 메시지에 명시된 값)
- 이모지 절대 금지, 특수문자만 사용: ★☆●○◎◇◆□■△▲▽▼→←↑↓♠♣♥♡♦※☎▶◀【】「」『』

### LMS (2000바이트 이하)
- subject(제목) 필수! 40바이트 이내
- ⚠️ subject(제목)에 (광고) 넣지 마세요! 시스템이 자동 부착!
- ⚠️ subject(제목)에는 %변수% 절대 사용 금지! 고정 텍스트만! (개인화는 본문에서만)
- ⚠️ 한 줄은 반드시 한글 기준 최대 17자(34바이트) 이내! 모바일 줄넘김 방지
- 줄바꿈과 특수문자로 가독성 높게
- 이모지 절대 금지

## 고성과 문안 핵심
- 사용 시나리오: 고객이 제품을 쓰는 순간을 그려라 (감각 언어 활용!)
- 감각 표현: "바르는 순간 스며드는 촉촉함" > "보습 효과가 있는"
- 뻔한 표현 금지: "안녕하세요 고객님", "특별한 혜택", "준비했어요" → 실격!
- 3가지 variant는 도입부/구조/설득전략이 완전히 달라야 함

## 🚫 절대 금지
1. (광고), 무료거부, 무료수신거부, 080번호를 본문/제목에 포함 금지
2. 프로모션 카드에 없는 혜택/할인 날조 금지
3. 프로모션 카드에 없는 날짜/기간/가격 날조 금지! 기간이 비어있으면 날짜 자체를 넣지 마세요
4. 개인화 변수 목록에 없는 변수 생성 금지
5. 이모지 사용 금지 (SMS/LMS)
6. 구분선(━━━, ───, ═══, ___, ＿＿＿) 사용 절대 금지! 빈 줄로 구분
7. 한 줄이 한글 17자를 넘지 않도록 반드시 줄바꿈

## 출력 형식
반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):

{
  "variants": [
    {
      "variant_id": "A",
      "variant_name": "시안 이름",
      "concept": "컨셉 설명 (1줄)",
      "subject": "LMS일 때 제목 (SMS는 빈 문자열)",
      "message_text": "개인화 변수 포함된 완성 문안 (광고표기/수신거부 금지!)",
      "score": 85
    },
    { "variant_id": "B", ... },
    { "variant_id": "C", ... }
  ],
  "recommendation": "A",
  "recommendation_reason": "추천 이유"
}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      variants: [
        {
          variant_id: 'A',
          variant_name: '기본형',
          concept: 'API 키 미설정 - 기본 문안',
          message_text: `[${brandName}] ${promotionCard.name}\n${promotionCard.benefit}`,
          score: 70,
        }
      ],
      recommendation: 'A',
    };
  }

  try {
    const text = await callAIWithFallback({
      system: systemPrompt,
      userMessage,
      maxTokens: 2048,
      temperature: 0.7,
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);

    // 안전장치: 광고표기 자동 제거 + 변수 검증 + SMS 바이트 체크
    if (result.variants) {
      for (const variant of result.variants) {
        let msg = variant.message_text || '';
        msg = msg.replace(/^\(광고\)\s?/g, '');
        msg = msg.replace(/\n?무료거부\d{8,11}/g, '');
        msg = msg.replace(/\n?무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '');
        // ★ 안전장치: 구분선 자동 제거 (모바일 줄넘김 방지)
        msg = msg.replace(/[━─═＿_~\-]{3,}/g, '');
        msg = msg.replace(/\n{3,}/g, '\n\n');
        // ★ 안전장치: SMS/LMS/MMS 이모지 강제 제거 (카카오만 허용)
        if (channel !== '카카오' && channel !== 'KAKAO') {
          msg = stripEmojis(msg);
        }
        msg = msg.trim();
        variant.message_text = msg;

        // ★ D28: 제목에서 %변수% 강제 제거 (AI가 프롬프트 무시 시 안전장치)
        if (variant.subject) {
          variant.subject = variant.subject.replace(/%[^%\s]{1,20}%/g, '').replace(/  +/g, ' ').trim();
        }

        // ★ 버그 #1: 미선택 변수 엄격 제거
        const validation = validatePersonalizationVars(msg, varNames);
        if (!validation.valid) {
          console.warn(`[AI 맞춤한줄 변수 검증] 미허용 변수: ${validation.invalidVars.join(', ')} → 제거`);
          let cleaned = msg;
          for (const invalidVar of validation.invalidVars) {
            // 변수 주변 공백/쉼표 정리 (예: "%성별% 고객님" → "고객님")
            cleaned = cleaned.replace(new RegExp(`%${invalidVar}%\\s*`, 'g'), '');
            cleaned = cleaned.replace(new RegExp(`\\s*%${invalidVar}%`, 'g'), '');
          }
          // 이중 공백 정리
          cleaned = cleaned.replace(/  +/g, ' ').replace(/\n /g, '\n').trim();
          variant.message_text = cleaned;
        }
      }

      // ★ B10-06: SMS 바이트 초과 시 byte_count/byte_warning을 variant에 추가 (프론트 표시용)
      if (channel === 'SMS') {
        for (const variant of result.variants) {
          const msgBytes = calculateKoreanBytes(variant.message_text || '');
          const totalBytes = isAd
            ? msgBytes + 6 + 1 + 8 + (rejectNumber ? rejectNumber.replace(/-/g, '').length : 10)
            : msgBytes;
          variant.byte_count = msgBytes;
          variant.byte_warning = totalBytes > 90;
          if (totalBytes > 90) {
            console.warn(`[AI 맞춤한줄 SMS 바이트 초과] ${variant.variant_id}: ${totalBytes}bytes (본문 ${msgBytes}bytes)`);
          }
        }
      }
    }

    return {
      variants: result.variants || [],
      recommendation: result.recommendation || 'A',
    };
  } catch (error) {
    console.error('맞춤 문안 생성 오류:', error);
    return {
      variants: [
        {
          variant_id: 'A',
          variant_name: '기본형',
          concept: '오류 발생 - 기본 문안',
          message_text: `[${brandName}] ${promotionCard.name}\n${promotionCard.benefit}`,
          score: 70,
        }
      ],
      recommendation: 'A',
    };
  }
}

// ============================================================
// API 상태 확인
// ============================================================

// ============================================================
// ★ 기능 4: 타겟 필터 실시간 건수 조회 (공통 함수 — 중복 제거)
// recommend-target, recount-target, relaxFilters 3곳에서 사용
// CT-01 buildFilterWhereClauseCompat 활용
// ============================================================

export interface FilterCountResult {
  count: number;
  unsubscribeCount: number;
}

/**
 * 필터 조건으로 타겟 고객 수 조회 (공통 함수)
 * - CT-01 buildFilterWhereClauseCompat 활용
 * - 수신거부 필터 포함 (user_id 기준 — B17-01 준수)
 * - 에러 시 0명 반환 (전체고객 폴백 절대 방지 — D77)
 */
export async function countFilteredCustomers(
  companyId: string,
  filters: Record<string, any>,
  userId: string,
  storeFilter: string = '',
  baseParams: any[] = []
): Promise<FilterCountResult> {
  try {
    const effectiveBaseParams = baseParams.length > 0 ? baseParams : [companyId];
    const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, effectiveBaseParams.length + 1);
    const unsubIdx = effectiveBaseParams.length + filterParams.length + 1;

    const countResult = await query(
      `SELECT COUNT(*) FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`,
      [...effectiveBaseParams, ...filterParams, userId]
    );
    const count = parseInt(countResult.rows[0].count);

    const unsubResult = await query(
      `SELECT COUNT(*) FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
       AND EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`,
      [...effectiveBaseParams, ...filterParams, userId]
    );
    const unsubscribeCount = parseInt(unsubResult.rows[0].count);

    return { count, unsubscribeCount };
  } catch (err) {
    // ★ 에러를 삼키지 않고 상위로 전파 — 조용히 0 반환하면 디버깅 불가
    console.error('[AI] countFilteredCustomers 쿼리 실패:', err);
    console.error('[AI] 필터:', JSON.stringify(filters));
    console.error('[AI] storeFilter:', storeFilter);
    throw err;
  }
}

// ============================================================
// ★ 기능 4: AI 타겟 조건 자동완화 (Zero-Count Auto-Relax)
// 0명 매칭 시 AI에게 조건 완화 요청 → 재추천
// 프로 요금제 이상 (ai_premium_enabled) 전용
// ============================================================

export interface RelaxFiltersResult {
  filters: Record<string, any>;
  reasoning: string;
  relaxed_fields: string[];
}

/**
 * AI에게 필터 조건 완화를 요청하는 함수
 * - 원래 필터 + 0명 사유를 AI에 전달
 * - AI가 의도를 유지하면서 가장 영향 적은 필드부터 완화
 * - relaxed_fields로 어떤 필드를 완화했는지 명시
 */
export async function relaxFilters(
  originalFilters: Record<string, any>,
  originalReasoning: string,
  customerStats: any,
  activeFieldsPrompt: string,
  companyInfo?: { business_type?: string; brand_name?: string }
): Promise<RelaxFiltersResult> {
  const userMessage = `## 상황
이전에 추천한 타겟 필터 조건으로 매칭된 고객이 0명입니다.
마케팅 의도를 최대한 유지하면서 조건을 완화하여 적절한 타겟을 찾아주세요.

## 이전 추천 필터
${JSON.stringify(originalFilters, null, 2)}

## 이전 추천 이유
${originalReasoning}

## 고객 데이터 현황
- 전체 고객: ${customerStats.total}명
- SMS 수신동의: ${customerStats.sms_opt_in_count}명

## 사용 가능한 필터 필드
${activeFieldsPrompt}

## 완화 우선순위 가이드
1. 가장 제한적인 조건부터 완화 (예: 연령 범위 확대, 등급 조건 추가)
2. 핵심 의도(성별, 주요 타겟)는 최대한 유지
3. 조건을 완전히 제거하기보다 범위를 넓히는 방향 선호
4. 너무 넓히면 안 됨 — 타겟팅 의미가 없어짐

## ⛔ 절대 금지 규칙
- filters를 빈 객체 {}로 반환하지 마세요! 빈 필터 = 전체 고객 선택 = 타겟팅 무의미
- 모든 필터 조건을 제거하지 마세요. 최소 1개 이상의 의미 있는 필터를 반드시 유지하세요
- 해당 데이터가 DB에 존재하지 않을 수 있습니다. 그 경우에도 완전히 제거하지 말고 범위만 넓히세요
- 0명 매칭이 반복되면 차라리 "매칭 불가"라고 reasoning에 명시하고, 원래 필터를 그대로 반환하세요

## 출력 형식 (JSON만 응답)
{
  "filters": { ... 완화된 필터 조건 ... },
  "reasoning": "어떻게 완화했고 왜 이렇게 했는지 한글 1~2문장",
  "relaxed_fields": ["완화한 필드명1", "완화한 필드명2"]
}`;

  try {
    const text = await callAIWithFallback({
      system: '당신은 CRM 마케팅 타겟팅 전문가입니다. 필터 조건이 너무 좁아서 0명이 매칭되었습니다. 마케팅 의도를 유지하면서 조건을 적절히 완화해주세요. JSON 형식으로만 응답하세요.',
      userMessage,
      maxTokens: 1024,
      temperature: 0.3,
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);
    const relaxedFilters = result.filters || {};

    // ★ 안전장치: AI가 빈 필터를 반환하면 원래 필터 유지 (전체 고객 풀백 방지)
    if (Object.keys(relaxedFilters).length === 0) {
      console.warn('[AI] relaxFilters 안전장치 — AI가 빈 필터 반환, 원래 필터 유지');
      return {
        filters: originalFilters,
        reasoning: '조건 완화 시 모든 필터가 제거되어 원래 조건을 유지합니다.',
        relaxed_fields: [],
      };
    }

    // ★ 안전장치: 원래 필터 키가 전부 제거되었으면 차단
    const originalKeys = Object.keys(originalFilters);
    const remainingOriginalKeys = originalKeys.filter(k => k in relaxedFilters);
    if (originalKeys.length > 0 && remainingOriginalKeys.length === 0) {
      console.warn(`[AI] relaxFilters 안전장치 — 원래 필터 키(${originalKeys.join(',')}) 전부 제거됨, 원래 필터 유지`);
      return {
        filters: originalFilters,
        reasoning: '조건 완화 시 핵심 필터가 모두 제거되어 원래 조건을 유지합니다.',
        relaxed_fields: [],
      };
    }

    return {
      filters: relaxedFilters,
      reasoning: result.reasoning || '조건을 완화했습니다.',
      relaxed_fields: result.relaxed_fields || [],
    };
  } catch (err) {
    console.error('[AI] relaxFilters 실패:', err);
    // ★ 실패 시에도 원래 필터 유지 (빈 필터 반환 = 전체 고객 풀백 위험)
    return {
      filters: originalFilters,
      reasoning: '조건 완화에 실패하여 원래 조건을 유지합니다.',
      relaxed_fields: [],
    };
  }
}

// ============================================================
// ★ 기능 2: AI 다음 캠페인 추천 (발송 결과 기반)
// campaign_runs 성과 데이터 → AI 프롬프트 → 추천
// 프로 요금제 이상 (ai_premium_enabled) 전용
// ============================================================

export interface CampaignRecommendation {
  recommended_target: {
    filters: Record<string, any>;
    reasoning: string;
  };
  recommended_time: string;
  recommended_channel: string;
  insights: string[];
  suggested_objective: string;
}

/**
 * 과거 캠페인 성과를 바탕으로 다음 캠페인을 추천
 * - stats-aggregation.ts의 aggregateCampaignPerformance() 결과를 입력받음
 * - AI가 성과 데이터를 분석하여 최적 타겟/시간대/채널 추천
 */
export async function recommendNextCampaign(
  companyId: string,
  performanceData: any,
  customerStats: any,
  companyInfo?: { business_type?: string; brand_name?: string; company_name?: string }
): Promise<CampaignRecommendation> {
  const brandName = companyInfo?.brand_name || companyInfo?.company_name || '브랜드';
  const businessType = companyInfo?.business_type || '기타';

  const userMessage = `## 회사 정보
- 업종: ${businessType}
- 브랜드명: ${brandName}

## 현재 날짜
${getKoreanToday()}

## 현재 고객 현황
- 전체 고객: ${customerStats.total}명
- SMS 수신동의: ${customerStats.sms_opt_in_count || 0}명
- 남성: ${customerStats.male_count || 0}명 / 여성: ${customerStats.female_count || 0}명

## 최근 캠페인 성과 데이터
${JSON.stringify(performanceData, null, 2)}

## 요청
위 성과 데이터를 분석하여:
1. 가장 효과적인 타겟 세그먼트와 필터 조건
2. 최적 발송 시간대
3. 추천 채널 (SMS/LMS/MMS)
4. 핵심 인사이트 (3~5개)
5. 다음 캠페인 마케팅 목표 제안

## 출력 형식 (JSON만 응답)
{
  "recommended_target": {
    "filters": { 필터조건 },
    "reasoning": "이 타겟을 추천하는 이유 (한글 1~2문장)"
  },
  "recommended_time": "YYYY-MM-DD HH:mm (한국시간)",
  "recommended_channel": "SMS 또는 LMS 또는 MMS",
  "insights": [
    "인사이트1 (예: 20대 여성 타겟 캠페인 평균 성공률 97%)",
    "인사이트2",
    "인사이트3"
  ],
  "suggested_objective": "다음 캠페인 마케팅 목표 제안 (한글 1문장)"
}`;

  try {
    const text = await callAIWithFallback({
      system: '당신은 CRM 마케팅 데이터 분석 전문가입니다. 과거 캠페인 성과 데이터를 분석하여 다음 캠페인의 최적 타겟, 시간대, 채널을 추천해주세요. 데이터 기반의 구체적인 인사이트를 제공하세요. JSON 형식으로만 응답하세요.',
      userMessage,
      maxTokens: 1024,
      temperature: 0.3,
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);
    return {
      recommended_target: result.recommended_target || { filters: {}, reasoning: '' },
      recommended_time: result.recommended_time || '',
      recommended_channel: result.recommended_channel || 'SMS',
      insights: result.insights || [],
      suggested_objective: result.suggested_objective || '',
    };
  } catch (err) {
    console.error('[AI] recommendNextCampaign 실패:', err);
    return {
      recommended_target: { filters: {}, reasoning: '추천 생성에 실패했습니다.' },
      recommended_time: '',
      recommended_channel: 'SMS',
      insights: ['캠페인 성과 데이터가 충분하지 않습니다.'],
      suggested_objective: '',
    };
  }
}

// ============================================================
// API 상태 확인
// ============================================================

export function checkAPIStatus(): { available: boolean; message: string; fallback: boolean } {
  const hasClaude = !!process.env.ANTHROPIC_API_KEY;
  const hasGPT = !!process.env.OPENAI_API_KEY;
  return {
    available: hasClaude || hasGPT,
    message: hasClaude
      ? hasGPT ? 'Claude API 준비 완료 (GPT fallback 대기)' : 'Claude API 준비 완료 (fallback 없음)'
      : hasGPT ? 'gpt-5.1만 사용 가능 (Claude 키 없음)' : 'AI API 키가 설정되지 않았습니다.',
    fallback: hasGPT,
  };
}
