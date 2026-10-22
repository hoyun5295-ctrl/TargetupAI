/**
 * oneline-demo-set.ts — 한줄 CT 시연 세트(★ 2026-10-22 · 설계서 docs/2026-10-22-oneline-ct-design.md §11-7 · 1021 시연 명령을 CT 흐름으로)
 *
 * 실제 부품 그대로 = ② 판단(구성 고르기 + 초안 · AI 1회) → ④ 페이지 읽기(비연동 회사 · 상품 · 사진 사본) → 재료(사람이 확인한 혜택 · 마감 · 후기 · 가격)
 *   → 첫 화면 그림(스튜디오 헤드라인) → ⑤ 요리(문구 AI 1회 · 구성 5종 조립 · 품질 관문) → DM 뷰어 렌더.
 * 결과 = 장면마다 PNG 한 장(왼쪽 = 이번 DM 390폭 전체 · 오른쪽 = 같은 업종 직원 실물 DM)을 그 회사 이미지 경로에 저장하고 주소를 찍는다.
 *
 * 지킴: 시연 회사(크레딧제 미적용)로만 · DM 초안 DB 쓰기 0(그림 파일만) · 웹 프로세스 재기동 0.
 *   실패(판단 · 읽기 · 그림 · 실물 캡처 · 저장) = 그 장면 불합격 + 종료 코드 1.
 *
 * 실행(운영 서버 · packages/backend):
 *   npx ts-node --transpile-only scripts/oneline-demo-set.ts <회사 id> scripts/data/oneline-demo-scenes.json
 * 장면 = { name, line, page?(상품 · 행사 페이지 주소), prices?{상품 이름: [정가, 판매가]}, categories?{상품 이름: 종류},
 *   benefit?, periodDays?, couponCode?, proof?[{body,author,rating}], store?{address,business_hours,phone}, brand?(장면 브랜드 이름), layout?, exemplar? }
 */
import 'dotenv/config';
import fs from 'fs';
import puppeteer, { type Browser } from 'puppeteer';
import sharp, { type OverlayOptions } from 'sharp';
import { pool } from '../src/config/database';
import { lineTemplateBrand } from '../src/utils/line-template-run';
import { getCompanyBrandKitRaw } from '../src/utils/dm/dm-brand-kit';
import { linePinnedPrimary, mergeLineBrandKit } from '../src/utils/line-mall-cards';
import { renderDmViewerHtml } from '../src/utils/dm/dm-viewer';
import { pickLineHeadlines, sanitizeLineHeadlineTitle } from '../src/utils/line-headline';
import { makeLineHeadlineImage } from '../src/utils/line-headline-make';
import { getTemplate } from '../src/utils/image-studio-templates';
import { getBrandBasicInfo } from '../src/utils/brand-basic-info';
import { writeTempBuffer, moveTempToPermanent } from '../src/utils/image-studio';
import { PUBLIC_BASE } from '../src/utils/sales-outreach-produce';
import { readBrandPage } from '../src/utils/brand-page-reader';
import { lineBannerOf } from '../src/utils/line-template-page';
import { lineFingerprint } from '../src/utils/one-line-steps';
import { kstDatePlus } from '../src/utils/line-template-example';
import { runLineJudge, draftLineCook, buildLineCookDm, getLineComposition } from '../src/utils/one-line-ct';
import { compositionBlocking, type LineCompositionId } from '../src/utils/line-compositions';

interface Scene {
  name: string; line: string; page?: string; brand?: string;
  prices?: Record<string, [number, number | null]>; categories?: Record<string, string>;
  benefit?: string; periodDays?: number; couponCode?: string;
  proof?: Array<{ body: string; author?: string; rating: number }>;
  store?: { address?: string; business_hours?: string; phone?: string };
  composition?: LineCompositionId; layout?: 'page' | 'slides'; poster?: boolean; exemplar?: string;
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

/** 두 장을 나란히(위 정렬 · 회색 바탕 · 가운데 80px 띄움) */
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
      const fails: string[] = [];
      const brandName = s.brand || brand.brandName;
      // ② 판단(AI 1회 · 시연 회사 = 차감 0)
      const judge = await runLineJudge({ companyId, line: s.line, lineFp: lineFingerprint(s.line), productNames: [] }).catch((e) => { fails.push(`판단 ${e?.message}`); return null; });
      const compId = s.composition || judge?.pick || 'spotlight';
      const comp = getLineComposition(compId)!;
      console.log(`${s.name} · 판단 = ${comp.label}(${judge?.source ?? '없음'}) · ${judge?.reason ?? ''}`);
      // ④ 페이지 읽기(비연동 회사 · 상품 이름 · 사진 사본 · 링크 · 사진 · 가격은 읽지 않는다 → 장면의 가격 = 담당자가 적은 값)
      let page: Awaited<ReturnType<typeof readBrandPage>> | null = null;
      if (s.page) page = await readBrandPage(companyId, s.page).catch((e) => { fails.push(`페이지 읽기 ${e?.message}`); return null; });
      const products = (page?.products || []).map((p) => {
        const pr = s.prices?.[p.name];
        return { name: p.name, price: pr ? pr[0] : 0, ...(pr && pr[1] ? { discount_price: pr[1] } : {}), image_url: p.imageUrl, link_url: p.url };
      });
      const banner = page ? lineBannerOf(page) : null;
      const moodFromPage = (page?.images || []).map((im) => im.url).filter((u) => u !== banner).slice(0, 3);
      // 첫 화면 그림(스튜디오 헤드라인 · 실패 = 불합격)
      let hero: string | null = null;
      if (s.poster !== false) {
        try {
          const picks = await pickLineHeadlines({
            companyId, companyName: brandName || String(basic?.company_name || ''), industry: String(basic?.industry_code || '') || null,
            line: s.line, productNames: products.map((p) => p.name), hasPhoto: products.length > 0,
          });
          const tpl = getTemplate(picks.picks[0]?.id || '');
          const title = sanitizeLineHeadlineTitle(picks.title);
          if (tpl && title) {
            hero = (await makeLineHeadlineImage({ companyId, template: tpl, texts: { title }, productImage: products[0]?.image_url || null })).url;
            console.log(`  첫 화면 = ${tpl.name}(${picks.source}) · 「${title}」`);
          } else fails.push('헤드라인 템플릿 · 글 없음');
        } catch (e: any) { fails.push(`헤드라인 ${e?.message}`); }
      }
      const periodEnd = s.periodDays ? kstDatePlus(Date.now(), s.periodDays) : null;
      const drafts = judge?.drafts?.[compId];
      const rich = {
        points: (drafts?.points || []).map((p) => ({ title: p.title, body: p.body, image: null })),
        usage: compId === 'spotlight' ? (drafts?.steps || []).map((p) => ({ title: p.title, body: p.body, image: null })) : [],
        mood: moodFromPage, couponCode: s.couponCode || null, store: s.store || null, benefitNote: null,
        categories: products.map((p) => s.categories?.[p.name] ?? null),
      };
      const input = {
        composition: comp, channel: 'dm' as const, companyId, line: s.line, ...brand, brandName,
        pinnedPrimary: pin, cards: products, cardCategories: rich.categories,
        heroUpload: hero || banner, heroAsIs: !!hero, proof: (s.proof || []).map((r) => ({ body: r.body, author: r.author || '구매 고객', rating: r.rating })),
        page: null, benefitAnswer: s.benefit ?? null, periodEnd, link: s.page || PUBLIC_BASE, rich,
      };
      // 막는 칸이 비었으면(실제 화면이 만들기를 막는 경우) 불합격
      const block = compositionBlocking(comp, {
        brandName, poster: input.heroUpload ? { url: input.heroUpload } : null, products: products.map((p) => ({ ...p, price: p.price || null })),
        points: rich.points, steps: rich.usage, mood: rich.mood, proof: input.proof, benefit: input.benefitAnswer, periodEnd, periodLabel: null, link: input.link, store: rich.store, couponCode: rich.couponCode,
      });
      if (block.length > 0) fails.push(`막는 칸 비어 있음 ${block.map((b) => b.key).join(',')}`);
      let dmHtml = '';
      try {
        const cook = await draftLineCook(input, { source: 'oneline-demo-set' });
        const dm = buildLineCookDm(cook);
        const slides = s.layout === 'slides' && dm.pages.length >= 3;
        dmHtml = renderDmViewerHtml({
          title: s.name, store_name: brandName, layout_mode: slides ? 'slides' : 'scroll',
          pages: slides ? dm.pages.map((secs, i) => ({ id: `p${i}`, name: `${i + 1}장`, sections: secs })) : [{ id: 'p0', name: '1장', sections: dm.sections }],
          sections: dm.sections, brand_kit: mergeLineBrandKit(kitRaw, { ...dm.brandKitPatch }, pin), short_code: '',
        } as any, '');
        console.log(`  구역 ${dm.sections.map((x) => x.type).join('>')}`);
      } catch (e: any) { fails.push(`요리 ${e?.message}`); }
      if (dmHtml) {
        const mine = await shoot(browser, { html: dmHtml });
        const real = s.exemplar ? await shoot(browser, { url: `https://hlj.kr/${s.exemplar}` }).catch((e) => { fails.push(`실물 캡처 ${e?.message}`); return null; }) : null;
        const png = await sideBySide(mine, real);
        const tempId = writeTempBuffer(companyId, png, { kind: 'source', ext: 'png', mime: 'image/png', width: null, height: null });
        const moved = moveTempToPermanent(companyId, tempId);
        if (!moved) fails.push('저장 실패');
        else console.log(`  보기 = ${PUBLIC_BASE}${moved.url}`);
      }
      console.log(`  ${Math.round((Date.now() - t0) / 1000)}초`);
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
