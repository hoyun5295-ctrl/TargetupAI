/**
 * oneline-demo-set.ts — 한 줄 콘텐츠 시연 세트(★ 2026-10-21 · 설계서 docs/2026-10-21-oneline-content-design.md §3-9 · Harold 승인 ③)
 *
 * push 전에 서버 별도 작업 폴더(새 브랜치)에서 이 명령 하나로 결과물을 만들어 Harold 가 「됐다」를 판정한다.
 * 실제 부품 그대로 = 헤드라인 템플릿 판정(AI 1회) · 헤드라인 그림(스튜디오 생성) · 문구 AI(실물 예시 참고) · 템플릿 조립 · 품질 관문 · DM 뷰어 렌더.
 * 결과 = 장면마다 PNG 한 장(왼쪽 = 이번 DM 390폭 전체 · 오른쪽 = 같은 업종 직원 실물 DM 390폭 전체)을 그 회사 이미지 경로에 저장하고 주소를 찍는다.
 *
 * 지킴: 크레딧 차감 0 · DM 초안 DB 쓰기 0(그림 파일만 저장) · 웹 프로세스 재기동 0. 돈 경로(차감 · 멱등)는 배포 뒤 실제 화면 1건으로 따로 확인한다.
 *
 * 실행(운영 서버 · 별도 폴더 packages/backend):
 *   npx ts-node --transpile-only scripts/oneline-demo-set.ts <회사 id> <장면 파일.json>
 * 장면 파일 = 배열: [{ "name": "뷰티-신제품", "line": "…", "template": "new-launch", "layout": "page",
 *   "benefit": "…"(선택), "periodEnd": "YYYY-MM-DD"(선택), "link": "https://…"(선택),
 *   "products": [{ "name": "…", "price": 38000, "discount_price": 29900, "image_url": "https://…", "link_url": "https://…" }],
 *   "proof": [{ "body": "…", "author": "김**", "rating": 5 }], "poster": true, "exemplar": "SLk8T3v" }]
 */
import 'dotenv/config';
import fs from 'fs';
import puppeteer, { type Browser } from 'puppeteer';
import sharp, { type OverlayOptions } from 'sharp';
import { pool } from '../src/config/database';
import { getLineTemplate, rankLineTemplates, type LineLayout, type LineTemplateId } from '../src/utils/design-core/line-templates';
import { draftLineTemplate, buildLineTemplateDm, lineTemplateBrand } from '../src/utils/line-template-run';
import { getCompanyBrandKitRaw } from '../src/utils/dm/dm-brand-kit';
import { linePinnedPrimary, mergeLineBrandKit } from '../src/utils/line-mall-cards';
import { renderDmViewerHtml } from '../src/utils/dm/dm-viewer';
import { pickLineHeadlines, sanitizeLineHeadlineTitle } from '../src/utils/line-headline';
import { makeLineHeadlineImage } from '../src/utils/line-headline-make';
import { getTemplate } from '../src/utils/image-studio-templates';
import { getBrandBasicInfo } from '../src/utils/brand-basic-info';
import { writeTempBuffer, moveTempToPermanent } from '../src/utils/image-studio';
import { PUBLIC_BASE } from '../src/utils/sales-outreach-produce';

interface Scene {
  name: string; line: string; template?: LineTemplateId; layout?: LineLayout;
  benefit?: string; periodEnd?: string; link?: string;
  products?: Array<{ name: string; price: number; discount_price?: number; image_url: string; link_url?: string }>;
  proof?: Array<{ body: string; author?: string; rating: number }>;
  poster?: boolean; exemplar?: string;
}

const W = 390;

async function shoot(browser: Browser, target: { html?: string; url?: string }): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2 });
    // 스크롤 리빌을 끄면 화면 밖 구역도 처음부터 보인다(뷰어 계약 · reduced-motion = 즉시 표시)
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (target.url) {
      const res = await page.goto(target.url, { waitUntil: 'networkidle0', timeout: 45_000 });
      if (!res || !res.ok()) throw new Error(`실물 페이지 응답 ${res ? res.status() : '없음'}`);
    }
    else await page.setContent(String(target.html).replace('<head>', `<head><base href="${PUBLIC_BASE}/">`), { waitUntil: 'networkidle0', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 1500));
    return Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
  } finally {
    await page.close();
  }
}

/** 두 장을 나란히(위 정렬 · 흰 바탕 · 가운데 40px 띄움) */
async function sideBySide(left: Buffer, right: Buffer | null): Promise<Buffer> {
  const a = await sharp(left).metadata();
  const b = right ? await sharp(right).metadata() : null;
  const gap = 80;
  const width = (a.width || 780) + (b ? gap + (b.width || 780) : 0);
  const height = Math.max(a.height || 0, b?.height || 0);
  const parts: OverlayOptions[] = [{ input: left, left: 0, top: 0 }];
  if (right && b) parts.push({ input: right, left: (a.width || 780) + gap, top: 0 });
  return sharp({ create: { width, height, channels: 3, background: '#f1f5f9' } }).composite(parts).png().toBuffer();
}

async function main(): Promise<void> {
  const [companyId, file] = process.argv.slice(2);
  if (!companyId || !file) { console.log('사용: npx ts-node --transpile-only scripts/oneline-demo-set.ts <회사 id> <장면 파일.json>'); process.exit(1); }
  const scenes = JSON.parse(fs.readFileSync(file, 'utf8')) as Scene[];
  const kitRaw = (await getCompanyBrandKitRaw(companyId).catch(() => null)) as Record<string, unknown> | null;
  const brand = await lineTemplateBrand(companyId, kitRaw);
  const basic = await getBrandBasicInfo(companyId).catch(() => null);
  const pin = linePinnedPrimary(kitRaw);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const failed: string[] = [];
  try {
    for (const s of scenes) {
      const t0 = Date.now();
      // 실패 = 불합격으로 찍고 다음 장면(나란히 비교가 빠진 장면을 합격처럼 내지 않는다 · Codex R4)
      const fails: string[] = [];
      const tplId = s.template || (rankLineTemplates(s.line).find((r) => r.recommended)?.id ?? 'new-launch');
      const t = getLineTemplate(tplId)!;
      const products = s.products || [];
      // ① 헤드라인(스튜디오 템플릿 판정 → 그림) — 실패해도 계속(그때 표지 = 첫 상품 · 색면)
      let hero: string | null = null;
      if (s.poster !== false) {
        try {
          const picks = await pickLineHeadlines({
            companyId, companyName: brand.brandName || String(basic?.company_name || ''), industry: String(basic?.industry_code || '') || null,
            line: s.line, productNames: products.map((p) => p.name), hasPhoto: products.length > 0,
          });
          const tpl = getTemplate(picks.picks[0]?.id || '');
          const title = sanitizeLineHeadlineTitle(picks.title);
          if (tpl && title) {
            hero = (await makeLineHeadlineImage({ companyId, template: tpl, texts: { title }, productImage: products[0]?.image_url || null })).url;
            console.log(`  헤드라인 = ${tpl.name}(${picks.source}) · 「${title}」`);
          } else fails.push('헤드라인 템플릿 · 글 없음');
        } catch (e: any) { fails.push(`헤드라인 ${e?.message}`); }
      }
      // ② 문구 AI(실물 예시 참고) + 조립 + 품질 관문 — 실제 경로와 같은 함수
      const draft = await draftLineTemplate({
        template: t, channel: 'dm', companyId, line: s.line, ...brand, brandName: brand.brandName,
        pinnedPrimary: pin,
        cards: products.map((p) => ({ name: p.name, price: p.price, ...(p.discount_price ? { discount_price: p.discount_price } : {}), image_url: p.image_url, ...(p.link_url ? { link_url: p.link_url } : {}) })),
        textProducts: [], heroUpload: hero, heroAsIs: !!hero,
        proof: (s.proof || []).map((r) => ({ body: r.body, author: r.author || '구매 고객', rating: r.rating })),
        page: null, benefitAnswer: s.benefit ?? undefined, periodEnd: s.periodEnd || null, link: s.link || PUBLIC_BASE,
      }, { source: 'oneline-demo-set' }, { factsOnly: true });
      const dm = buildLineTemplateDm(draft, s.layout || 'page');
      const html = renderDmViewerHtml({
        title: s.name, store_name: brand.brandName, layout_mode: dm.layoutMode, pages: dm.pages, sections: dm.sections,
        brand_kit: mergeLineBrandKit(kitRaw, { ...dm.brandKitPatch }, pin), short_code: '',
      } as any, '');
      // ③ 찍기 + 실물 나란히 → 이 회사 이미지 경로
      const mine = await shoot(browser, { html });
      const real = s.exemplar ? await shoot(browser, { url: `https://hlj.kr/${s.exemplar}` }).catch((e) => { fails.push(`실물 캡처 ${e?.message}`); return null; }) : null;
      const png = await sideBySide(mine, real);
      const tempId = writeTempBuffer(companyId, png, { kind: 'source', ext: 'png', mime: 'image/png', width: null, height: null });
      const moved = moveTempToPermanent(companyId, tempId);
      console.log(`${s.name} · 템플릿 ${t.label} · 형태 ${dm.layoutMode} · 구역 ${dm.sections.map((x) => x.type).join('>')} · ${Math.round((Date.now() - t0) / 1000)}초`);
      if (!moved) fails.push('저장 실패');
      else console.log(`  보기 = ${PUBLIC_BASE}${moved.url}`);
      if (fails.length) { failed.push(s.name); console.log(`  불합격 = ${fails.join(' · ')}`); }
    }
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
  }
  if (failed.length) { console.log(`불합격 장면 ${failed.length}개 = ${failed.join(' · ')}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
