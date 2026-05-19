/**
 * ★ CT-32: Naver Clova Speech (STT) + Voice (TTS) 클라이언트 — D178 (2026-05-19)
 *
 * 🎯 목적
 *   인바운드 AI 음성 응답 — 자사몰 SMS/카카오 받은 사용자가 "전화 문의" 클릭 시
 *   한줄로 inbound 번호로 연결 → STT(Clova Speech) → Opus 4.7 + CDP 데이터 응답 → TTS(Clova Voice) → 응답.
 *
 * 📋 Naver Clova 표준 (NCloud 콘솔 발급)
 *   - Clova Speech (STT): https://clovaspeech-gw.ncloud.com/external/v1
 *   - Clova Voice (TTS):  https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts
 *
 * 🔐 환경변수 (Harold .env)
 *   - NAVER_CLOVA_STT_SECRET     (Clova Speech invoke URL secret)
 *   - NAVER_CLOVA_STT_INVOKE_URL (Clova Speech invoke URL)
 *   - NAVER_CLOVA_TTS_CLIENT_ID  (Clova Voice client id)
 *   - NAVER_CLOVA_TTS_CLIENT_SECRET
 *
 * ⛔ 영구 원칙 정합
 *   - 인바운드만 박음 (사용자 능동 클릭 → 동의 friction 0건). 외향 음성 AI는 Phase 2 후순위.
 *   - 회사 admin이 활성/비활성 토글 박음 (default OFF, 명시 활성 시만 동작)
 *   - 음성 트랜스크립트 사후 확인 박음 (사용자 신뢰 영구 원칙 #4 정합)
 *   - Opus 4.7로 응답 박음 (모델 분리 룰 정합, 기존 Sonnet 4.6 흐름 영향 0건)
 */

const STT_INVOKE_URL = process.env.NAVER_CLOVA_STT_INVOKE_URL || '';
const STT_SECRET = process.env.NAVER_CLOVA_STT_SECRET || '';
const TTS_CLIENT_ID = process.env.NAVER_CLOVA_TTS_CLIENT_ID || '';
const TTS_CLIENT_SECRET = process.env.NAVER_CLOVA_TTS_CLIENT_SECRET || '';
const TTS_URL = 'https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface SttResult {
  text: string;
  confidence: number;
  duration_ms: number;
}

export interface TtsOptions {
  speaker?: string;       // 'nara' (default 여성) / 'jinho' (남성) / 'minyoung' / etc.
  speed?: number;         // -5 ~ 5 (0 = 표준)
  pitch?: number;         // -5 ~ 5 (0 = 표준)
  volume?: number;        // -5 ~ 5 (0 = 표준)
  format?: 'mp3' | 'wav';
}

// ════════════════════════════════════════════════════════════════════
// STT — 음성 → 텍스트
// ════════════════════════════════════════════════════════════════════

/**
 * Clova Speech로 음성 파일(URL 또는 binary)을 텍스트 변환.
 * - 본 함수는 외부 음성 인프라(Twilio/NCloud SIP/통신사) 연동 시 호출
 * - 실 인프라 박은 후 audio URL 또는 binary 박은 후 호출
 */
export async function transcribeAudio(audioUrl: string, lang: string = 'ko-KR'): Promise<SttResult> {
  if (!STT_INVOKE_URL || !STT_SECRET) {
    throw new Error('Naver Clova STT 환경변수가 설정되지 않았습니다.');
  }
  const res = await fetch(`${STT_INVOKE_URL}/recognizer/url`, {
    method: 'POST',
    headers: {
      'X-CLOVASPEECH-API-KEY': STT_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: audioUrl,
      language: lang,
      completion: 'sync',
    }),
  });
  if (!res.ok) {
    const err = await safeText(res);
    throw new Error(`Clova STT 호출 실패 (${res.status}): ${err}`);
  }
  const data = await res.json() as any;
  return {
    text: data?.text || '',
    confidence: data?.confidence || 0,
    duration_ms: data?.segments?.[0]?.end || 0,
  };
}

// ════════════════════════════════════════════════════════════════════
// TTS — 텍스트 → 음성
// ════════════════════════════════════════════════════════════════════

/**
 * Clova Voice로 텍스트를 음성(MP3/WAV)로 변환.
 * - 반환: audio binary (Buffer) — caller가 자사몰 응답 또는 통신사 SIP에 박음
 */
export async function synthesizeSpeech(text: string, options: TtsOptions = {}): Promise<Buffer> {
  if (!TTS_CLIENT_ID || !TTS_CLIENT_SECRET) {
    throw new Error('Naver Clova TTS 환경변수가 설정되지 않았습니다.');
  }
  const params = new URLSearchParams({
    speaker: options.speaker || 'nara',
    speed: String(options.speed ?? 0),
    pitch: String(options.pitch ?? 0),
    volume: String(options.volume ?? 0),
    format: options.format || 'mp3',
    text: text.slice(0, 2000), // Clova Voice 텍스트 한도
  });
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': TTS_CLIENT_ID,
      'X-NCP-APIGW-API-KEY': TTS_CLIENT_SECRET,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await safeText(res);
    throw new Error(`Clova TTS 호출 실패 (${res.status}): ${err}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function isClovaConfigured(): { stt: boolean; tts: boolean } {
  return {
    stt: !!STT_INVOKE_URL && !!STT_SECRET,
    tts: !!TTS_CLIENT_ID && !!TTS_CLIENT_SECRET,
  };
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return '<응답 본문 파싱 실패>'; }
}
