/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 제작 단계 헬퍼 (이미지·DM·제안 메일 조립)
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-5·§15-6. 상태 전이는 sales-outreach-jobs가 소유하고
 * 이 파일은 산출물 하나를 만드는 순수 작업 함수만 둔다(성공 반환 또는 throw — 판정·기록은 호출부).
 *
 * 규율:
 * - 회사 컨텍스트 = OUTREACH_COMPANY_ID/OUTREACH_USER_ID(ENV 고정). 미설정 = 정직 거절(자동 폴백 금지).
 * - DM 발행 = CT 직접 호출(라우트 미경유 = 미차감 · dm.ts:765 주석 확정). 발행 전 회사 자기 확인(H14).
 * - 이미지 fetch도 SSRF 가드(https 강제·DNS 사설 차단·redirect 거부·image/*·10MB) — routes/image-studio.ts
 *   /ingest-product의 가드 규약과 동일(공용 라우트는 고객 축이라 손대지 않고 이 축 CT로 둔다 · 통합 = 별도 과제).
 * - vision 인물 판정 = 보조 신호. 'person' 확정만 제외(Harold 보강 ①), 판정 불능은 사람 선택을 존중.
 * - 메일 본문 = 전달용 완성본 한 벌. 내부 URL·토큰을 이 파일 함수의 인자로 받지 않는다(H2 — 손에 없으면 샐 수 없다).
 */
import * as fs from 'fs';
import * as net from 'net';
import * as dns from 'dns';
import * as https from 'https';
import { callAIWithFallback } from '../services/ai';
import { runInCreditBundle } from './ai-credit-context';
import { stripUnauthorizedBenefits } from './copy-benefit-detector';
import { getActiveStyleGuide } from './sales-outreach-style';
import {
  isStudioReady, writeTempBuffer, allocTempPath, writeTempMeta, findTempFile, moveTempToPermanent,
  removeBackground, composeImage, generatePoster, buildPosterPrompt, resolvePreset,
} from './image-studio';
import { STUDIO_TEMPLATES, type StudioTemplate, type TemplateCategory } from './image-studio-templates';
import { oneShotGenerate } from './dm/dm-ai';
import { createDm, publishDm } from './dm/dm-builder';
import { renderEmailSections, EMAIL_FOOTER_SLOT } from './email/email-section-renderer';
import type { Section } from './dm/dm-section-registry';
import { industryLabel } from './industry-codes';
import type { EventCandidate } from './sales-outreach-jobs';

// ===== 회사 컨텍스트 (ENV 고정 — §15-6) =====

export function getOutreachContext(): { companyId: string; userId: string } | null {
  const companyId = (process.env.OUTREACH_COMPANY_ID || '').trim();
  const userId = (process.env.OUTREACH_USER_ID || '').trim();
  return companyId && userId ? { companyId, userId } : null;
}

export const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');

/** 공개 샘플 페이지 수명(일) — 기산점은 메일 발송 성공 시각(H15). 상수 1곳 소유. */
export const OUTREACH_PREVIEW_DAYS = 30;

// ===== 이미지 수급 (SSRF 가드 fetch — H8) =====

function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6(::ffff:x.y.z.w)는 IPv4로 환원해 같은 판정기를 태운다 — prefix 몇 개만 나열하면
  // ::ffff:169.254.* 등 누락 범위가 그대로 통과한다(Codex 1R high).
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const low = ip.toLowerCase();
  return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

/** 가드 이미지 다운로드 — 실패는 null(사유 로그만). 리다이렉트는 SSRF 우회 경로라 거부.
 *  검증한 DNS 주소를 **연결에 고정**한다(host=검증 IP · servername/Host=원 호스트) — 검사 때 공인 IP,
 *  연결 때 사설 IP를 돌려주는 DNS 재해석(rebinding) 차단(Codex 2R high · dm-brand-extractor requestPinned와 같은 규약).
 *  타이머·누적 상한은 본문 소비가 끝날 때까지 유지한다(Codex 1R high). */
async function fetchImageGuarded(rawUrl: string): Promise<{ buffer: Buffer; mime: string; ext: string } | null> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase();
  let pinnedIp: string;
  try {
    const addrs = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
    if (addrs.length === 0 || addrs.some((ip) => isPrivateIp(ip))) return null;
    pinnedIp = addrs[0];
  } catch (err: any) {
    console.log('[sales-outreach] 이미지 호스트 해석 실패:', err?.message);
    return null;
  }

  const MAX_BYTES = 10 * 1024 * 1024;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { buffer: Buffer; mime: string; ext: string } | null) => {
      if (!settled) { settled = true; clearTimeout(wall); resolve(v); }
    };
    const req = https.request({
      host: pinnedIp,               // 연결은 검증된 IP로 고정
      servername: host,             // TLS SNI = 원 호스트(인증서 검증 유지)
      port: parsed.port ? Number(parsed.port) : 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Host: host, 'User-Agent': 'Mozilla/5.0 (compatible; HanjulBot/1.0)' },
      timeout: 10_000,              // 소켓 유휴 타임아웃
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 || status < 200) { res.resume(); req.destroy(); done(null); return; } // 리다이렉트 포함 거부
      const ctype = String(res.headers['content-type'] || '').toLowerCase();
      if (!ctype.startsWith('image/')) { res.resume(); req.destroy(); done(null); return; }
      const clen = Number(res.headers['content-length'] || 0);
      if (clen && clen > MAX_BYTES) { res.resume(); req.destroy(); done(null); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX_BYTES) { req.destroy(); done(null); return; } // 누적 상한 — 초과 즉시 끊는다
        chunks.push(c);
      });
      res.on('end', () => {
        const ext = ctype.includes('png') ? 'png' : ctype.includes('webp') ? 'webp' : 'jpeg';
        done({ buffer: Buffer.concat(chunks), mime: ctype, ext });
      });
      res.on('error', () => done(null));
    });
    // 벽시계 마감 — 유휴 타임아웃만으로는 느리게 흐르는 응답을 못 끊는다
    const wall = setTimeout(() => { req.destroy(); done(null); }, 20_000);
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', (err) => { console.log('[sales-outreach] 이미지 다운로드 실패:', err?.message); done(null); });
    req.end();
  });
}

// ===== vision 인물 판정 (보조 신호 — 4값 · H6) =====

export type PersonJudge = 'person' | 'none' | 'undetermined' | 'unavailable';

async function judgePersonInImage(base64: string, mime: string): Promise<PersonJudge> {
  try {
    const raw = await callAIWithFallback({
      system: '이미지에 실존 인물(사람의 얼굴이나 신체)이 보이는지만 판정한다. 마네킹·일러스트·조각상은 인물이 아니다. 답은 person, none, undetermined 세 단어 중 정확히 하나만 출력한다.',
      userMessage: '판정해라.',
      maxTokens: 10,
      temperature: 0,
      source: 'sales-outreach-person-check',
      images: [{ media_type: mime, data: base64 }],
    });
    const t = raw.trim().toLowerCase();
    if (t.includes('person')) return 'person';
    if (t.includes('none')) return 'none';
    return 'undetermined';
  } catch (err: any) {
    console.log('[sales-outreach] 인물 판정 불가(장애):', err?.message);
    return 'unavailable'; // 장애는 "판정 못함"과 다른 값 — 사람 선택을 존중하고 배지만
  }
}

// ===== 템플릿 선택 (업종 → 카테고리 · 결정적 — 재실행 동일 결과) =====

const INDUSTRY_TO_CATEGORY: Record<string, TemplateCategory> = {
  fashion: '패션', beauty: '뷰티', food: '카페·음료',
};

function pickTemplate(industry: string | null | undefined, seed: string, needProduct: boolean): StudioTemplate {
  const cat = (industry && INDUSTRY_TO_CATEGORY[industry]) || '세일·이벤트';
  const wantKind = needProduct ? 'product' : 'event';
  let pool = STUDIO_TEMPLATES.filter((t) => t.category === cat && (t.kind ?? 'product') === wantKind);
  if (pool.length === 0) pool = STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === wantKind);
  if (pool.length === 0) pool = STUDIO_TEMPLATES;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

// ===== 대표 이미지 제작 (수급→인물 보조판정→누끼→포스터→JPEG 공개 URL) =====

// rembg py 서비스가 단일 워커라 아웃리치는 동시 1건만(고객 스튜디오와 경합 최소화 — 회의 확정)
let imageInFlight = false;

export interface OutreachImageResult {
  publicUrl: string;      // 절대 URL(이메일 임베드용)
  usedCutout: boolean;
  personJudge: PersonJudge | null;
  skippedReason: string | null; // 선택 이미지를 못 쓴 사유(있으면 화면 표시)
  width: number;
  height: number;
}

export async function produceOutreachImage(input: {
  jobId: string;
  companyName: string;
  industry: string | null;
  selectedImageUrl: string | null;
}): Promise<OutreachImageResult> {
  const ctx = getOutreachContext();
  if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
  if (!isStudioReady()) throw new Error('이미지 생성 서비스가 준비되지 않았습니다.');
  if (imageInFlight) throw new Error('다른 이미지 제작이 진행 중입니다. 잠시 후 재시도해주세요.');
  imageInFlight = true;
  try {
    let cutout: { base64: string; mime: string } | null = null;
    let personJudge: PersonJudge | null = null;
    let skippedReason: string | null = null;

    if (input.selectedImageUrl) {
      const img = await fetchImageGuarded(input.selectedImageUrl);
      if (!img) {
        skippedReason = '선택한 이미지를 내려받지 못해 생성 이미지로만 제작했습니다.';
      } else {
        personJudge = await judgePersonInImage(img.buffer.toString('base64'), img.mime);
        if (personJudge === 'person') {
          // Harold 보강 ① — 인물 확정만 기계가 제외한다(마네킹·일러스트 오탐은 none으로 통과)
          skippedReason = '인물이 포함된 것으로 판정되어 해당 이미지는 사용하지 않았습니다.';
        } else {
          const srcTempId = writeTempBuffer(ctx.companyId, img.buffer, { kind: 'source', ext: img.ext, mime: img.mime, width: null, height: null });
          const src = findTempFile(ctx.companyId, srcTempId);
          if (!src) throw new Error('임시 저장소 기록에 실패했습니다.');
          const cut = allocTempPath(ctx.companyId, 'png');
          const { width, height } = await removeBackground(src.absPath, cut.absPath);
          if (Math.min(width, height) < 300) {
            // 해상도 게이트 — 저해상 누끼를 포스터 히어로로 쓰면 뭉갠다(디자이너 R9)
            skippedReason = '이미지 해상도가 낮아 생성 이미지로만 제작했습니다.';
          } else {
            writeTempMeta(ctx.companyId, cut.tempId, { kind: 'cutout', ext: 'png', mime: 'image/png', width, height });
            cutout = { base64: fs.readFileSync(cut.absPath).toString('base64'), mime: 'image/png' };
          }
        }
      }
    }

    const template = pickTemplate(input.industry, input.jobId, !!cutout);
    const preset = resolvePreset('poster');
    const prompt = buildPosterPrompt({
      template,
      preset,
      texts: { title: input.companyName }, // 사실 문구(업체명)만 verbatim — 혜택 수치 렌더 금지 축
      hasProduct: !!cutout,
    });
    const poster = await generatePoster(prompt, preset, cutout);

    const posterExt = poster.mime.includes('png') ? 'png' : 'jpeg';
    const posterTempId = writeTempBuffer(ctx.companyId, Buffer.from(poster.base64, 'base64'),
      { kind: 'poster', ext: posterExt, mime: poster.mime, prompt, presetKey: 'poster', channelSpec: 'poster', width: null, height: null });
    const posterFile = findTempFile(ctx.companyId, posterTempId);
    if (!posterFile) throw new Error('포스터 임시 저장에 실패했습니다.');

    // 이메일 삽입은 JPEG만(알파 PNG 직삽 금지 — 다크 클라이언트 흰 프린지·용량)
    const out = allocTempPath(ctx.companyId, 'jpeg');
    const composed = await composeImage({ bgPath: posterFile.absPath, cutoutPath: null, outPath: out.absPath, format: 'jpeg' });
    writeTempMeta(ctx.companyId, out.tempId, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: composed.width, height: composed.height });
    const moved = moveTempToPermanent(ctx.companyId, out.tempId);
    if (!moved) throw new Error('이미지 저장에 실패했습니다.');

    return {
      publicUrl: PUBLIC_BASE + moved.url,
      usedCutout: !!cutout,
      personJudge,
      skippedReason,
      width: composed.width,
      height: composed.height,
    };
  } finally {
    imageInFlight = false;
  }
}

// ===== 모바일 DM 제작·발행 (CT 직접 = 미차감 · H14 자기 확인) =====

export async function produceOutreachDm(input: {
  companyName: string;
  eventText: string;
  /** H14 게이트 — 호출부가 명시적으로 넘긴 값이 내부 전용 회사(ENV)와 일치할 때만 발행한다.
   *  함수가 스스로 ENV를 읽어 ENV와 비교하면 항상 참인 공허 게이트가 된다(Codex 1R high).
   *  미래의 호출부가 고객 companyId를 넘기는 실수를 이 비교가 잡는다. */
  companyId: string;
  userId: string;
}): Promise<{ dmId: string; dmUrl: string }> {
  const envCompanyId = (process.env.OUTREACH_COMPANY_ID || '').trim();
  const envUserId = (process.env.OUTREACH_USER_ID || '').trim();
  if (!envCompanyId || !envUserId) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
  if (String(input.companyId) !== envCompanyId || String(input.userId) !== envUserId) {
    throw new Error('내부 발행은 내부 전용 회사 계정으로만 가능합니다.');
  }

  const gen = await runInCreditBundle(() =>
    oneShotGenerate({
      prompt: `${input.companyName} 브랜드 소개와 행사 안내 모바일 페이지`,
      companyId: input.companyId,
      eventText: input.eventText,
    } as any),
  );
  const dm = await createDm(input.companyId, input.userId, {
    title: `[영업] ${input.companyName}`.slice(0, 200),
    sections: (gen as any).sections || [],
    pages: (gen as any).pages || [],
    layout_mode: (gen as any).layoutMode,
    brand_kit: (gen as any).brandKit || null,
    ai_prompt: input.eventText.slice(0, 2000),
    approval_status: 'draft',
  } as any);
  const published = await publishDm(String(dm.id), input.companyId);
  if (!published?.short_code) throw new Error('모바일 DM 발행 주소를 만들지 못했습니다.');
  const shortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
  const dmUrl = shortBase
    ? `${shortBase}/${published.short_code}`
    : `${PUBLIC_BASE}/api/dm/v/dm-${published.short_code}`;
  return { dmId: String(dm.id), dmUrl };
}

// ===== 제안 메일 조립 (전달용 완성본 1통 — 내부 URL 인자 없음) =====

/** 이메일 버튼 라벨 — VML 버튼 폭 230px 하드코딩 대응, 8자 상한을 서버가 강제(디자이너 R5) */
function assertButtonLabel(label: string): string {
  if (label.length > 8) throw new Error(`이메일 버튼 라벨은 8자 이내여야 합니다: ${label}`);
  return label;
}

export interface ProposalEmailInput {
  companyName: string;
  industry: string | null;
  selectedEvent: EventCandidate | null;
  copyBody: string;        // {{DM_LINK}} 치환 전 문안
  posterUrl: string | null; // 절대 URL
  dmUrl: string;            // hlj.kr (업체에 도달 가능한 유일한 링크 축 L1)
  previewUrl: string;       // 공개 샘플 페이지(L2 — 만료·noindex 있는 공개 URL, Harold 0824 "외부 공개 가능 주소")
  /** 수신거부 문구(§10 확정 전 = 빈 값) — 빈 값이면 발송 게이트가 잠긴다(H19). 조립 자체는 슬롯을 실재시킨다. */
  unsubscribeNotice: string;
}

export async function buildProposalEmail(input: ProposalEmailInput): Promise<{ subject: string; html: string; intro: string }> {
  const guide = getActiveStyleGuide();
  const licensedQuote = input.selectedEvent && input.selectedEvent.benefitLicensed ? input.selectedEvent.quote : '';

  // 제목·서두 — JSON 계약. 혜택 수치는 면허 인용 안에서만(생성 직후 즉시 통과).
  let subject = `${input.companyName} 맞춤 마케팅 시안이 도착했습니다`;
  let intro = '';
  try {
    const raw = await callAIWithFallback({
      system: [
        '너는 B2B 제안 메일의 제목과 서두를 쓰는 카피라이터다.',
        `구성: ${guide.email.structure.join(' → ')}`,
        `톤: ${guide.email.tone}`,
        ...guide.prohibitions.map((p) => `금지: ${p}`),
        '출력은 JSON 하나만: {"subject":"...","intro":"..."} (subject 40자 이내 · intro 2~3문장)',
      ].join('\n'),
      userMessage: [
        `업체: ${input.companyName} (업종: ${industryLabel(input.industry)})`,
        input.selectedEvent
          ? `그 업체 홈페이지에서 확인한 행사(원문 인용 · 이 안의 사실만 언급 가능):\n"${input.selectedEvent.quote}"`
          : '확인된 행사 없음: 브랜드 일반형 서두.',
      ].join('\n'),
      maxTokens: 500,
      temperature: 0.7,
      source: 'sales-outreach-email-intro',
    });
    const block = raw.match(/\{[\s\S]*\}/);
    const parsed = block ? JSON.parse(block[0]) : {};
    if (typeof parsed.subject === 'string' && parsed.subject.trim()) {
      subject = stripUnauthorizedBenefits(parsed.subject.trim().slice(0, 60), licensedQuote);
    }
    if (typeof parsed.intro === 'string' && parsed.intro.trim()) {
      intro = stripUnauthorizedBenefits(parsed.intro.trim().slice(0, 500), licensedQuote);
    }
  } catch (err: any) {
    console.log('[sales-outreach] 제목·서두 생성 실패(기본값 사용):', err?.message);
  }
  if (!intro) {
    intro = `${input.companyName}의 홈페이지를 살펴보고, 한줄로AI로 귀사 브랜드에 맞춘 마케팅 예시를 만들어 보았습니다. 아래에서 실물 그대로 확인하실 수 있습니다.`;
  }

  const copyForEmail = input.copyBody.replace(/\{\{DM_LINK\}\}/g, input.dmUrl);

  let order = 0;
  const sec = (type: string, props: Record<string, unknown>, extra?: Record<string, unknown>): Section => ({
    id: `so-${order}-${type}`,
    type,
    order: order++,
    visible: true,
    props,
    ...(extra || {}),
  } as unknown as Section);

  const sections: Section[] = [
    // 발신 신원 한 줄 — 얼굴 없는 포스터는 스팸으로 읽힌다(디자이너 레시피 #1)
    sec('header', { variant: 'logo', align: 'left', brand_name: '한줄로', brand_size: 'sm', show_brand_name: true }),
    // 첫 화면 색면 — 이미지 차단 클라이언트에서도 어두운 색면+흰 헤드라인이 남는다(headline_color 고정)
    sec('hero', {
      image_url: input.posterUrl || undefined,
      headline: `${input.companyName}를 위한 마케팅 시안`,
      sub_copy: '한줄로AI가 만든 예시(시안)입니다',
      align: 'center', height: 'lg', overlay_gradient: true, headline_color: '#ffffff', sub_copy_color: '#ffffff',
    }),
    sec('text_card', {
      tag: '귀사 홈페이지에서 확인했습니다',
      headline: input.selectedEvent ? '지금 진행 중인 소식에 맞춰 만들었습니다' : '귀사 브랜드에 맞춰 만들었습니다',
      body: [
        intro,
        input.selectedEvent ? `홈페이지에서 본 내용: "${input.selectedEvent.quote}"` : '',
      ].filter(Boolean).join('\n\n'),
      align: 'left', image_position: 'top',
    }, { treatment: 'lead' }),
    sec('text_card', {
      tag: 'AI 문안 예시',
      headline: '이 문안이 그대로 발송됩니다',
      body: copyForEmail,
      align: 'left', image_position: 'top',
    }),
    // 확인 링크 — 텍스트 링크 병행은 renderButton VML+HTML 이중 출력이 담당. 라벨 8자 서버 강제.
    sec('cta', {
      layout: 'stack',
      buttons: [
        { label: assertButtonLabel('산출물 보기'), url: input.previewUrl, style: 'primary' },
        { label: assertButtonLabel('DM 열어보기'), url: input.dmUrl, style: 'outline' },
      ],
    }, { treatment: 'bar' }),
    sec('text_card', {
      headline: '한줄로는 이렇게 도와드립니다',
      body: '한줄로는 문자·이메일·모바일 DM·인앱 메시지를 AI가 만들어 보내는 마케팅 자동화 서비스입니다. 이 메일의 이미지·문안·모바일 페이지 전부 한줄로AI가 귀사 홈페이지만 보고 만들었습니다.',
      align: 'left', image_position: 'top',
    }, { background: 'dark' }),
    sec('footer', {
      notes: [
        '본 메일의 모든 산출물은 한줄로AI로 제작된 예시(시안)입니다.',
        '귀사에 맞춤형 제안을 드리기 위하여 귀사의 이미지를 활용한 예시를 보여드렸습니다. 상업적 이용이 아닌 귀사 제안용으로만 사용되었음을 확약드립니다.',
        `본 안내는 ${new Date().toISOString().slice(0, 10)} 기준 홈페이지 내용을 참고했습니다.`,
        input.unsubscribeNotice, // §10 확정 전 빈 슬롯 — 발송 게이트(H19)는 호출부가 본다
      ].filter(Boolean).join('\n'),
      cs_phone: undefined,
      legal_text: '(주)인비토 · 한줄로(hanjul.ai)',
      show_unsubscribe_link: false,
    }),
  ];

  const html = renderEmailSections(sections, {
    design: {
      art_direction: { typeScale: 'bold', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
      preheader: `${input.companyName} 맞춤 시안 · 한줄로AI 제작 예시`,
    },
    publicBase: PUBLIC_BASE,
  }).replace(EMAIL_FOOTER_SLOT, '');

  return { subject, html, intro };
}
