/**
 * 인앱 「구워 보내기」 시험 — 서버가 우리 SDK 로 그린 완성 화면을 그림으로 찍을 수 있는가(2026-11-08 · Harold 「시험부터」)
 *
 * 접수(1108 Harold): 업체 앱을 다시 빌드하라고 할 수 없다 · 그런데 종류(카드 · 통짜 · 띠 …)가 설치된 앱에 적용되지 않는다.
 *   방식 = 이미 연동된 앱은 「그림 + 버튼」을 그린다 → 서버가 웹과 같은 그림(SDK 그리기)을 찍어 그 그림을 보낸다.
 * 이 시험 = 운영과 같은 서빙(getActiveMessagesForCustomerV2 · 웹뷰 판 = 모든 종류) → 운영 웹뷰 페이지(/api/cdp/inapp/webview)를
 *   서버 크롬(outreach-render 와 같은 실행 파일)에 휴대폰 크기로 띄움 → 장마다 웹과 같은 카드(N-card) · 앱에 보낼 판(N-app = 닫기 줄 · 쪽 번호 · 버튼 숨김) 두 가지로 찍는다.
 *
 * ⛔ 운영 코드 변경 0 · 읽기만(메시지 고르기 = 조회 · 기록 0) · AI 0 · 돈 0 · 산출 /tmp/inapp-bake-trial(PNG + 걸린 시간).
 *   일회성 시험 스크립트(채택되면 운영 워커로 다시 만든다).
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/inapp-bake-trial.ts [제목 앞글자(기본 헬로윈파티)]
 *   --from <served.json> = DB 없이 그 메시지로 찍기만(로컬 확인용 · DB 모듈을 불러오지 않는다)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const OUT = '/tmp/inapp-bake-trial';
const BASE = process.env.INAPP_BAKE_BASE || 'https://app.hanjul.ai';
const CHROME = process.env.OUTREACH_RENDER_CHROME
  || (fs.existsSync('/opt/hanjul-chrome/current/chrome-linux64/chrome') ? '/opt/hanjul-chrome/current/chrome-linux64/chrome' : undefined);
const FROM_AT = process.argv.indexOf('--from');
const FROM = FROM_AT >= 0 ? process.argv[FROM_AT + 1] : '';
const TITLE = (FROM_AT === 2 ? '' : process.argv[2]) || '헬로윈파티';
const VIEW = { width: 390, height: 844, deviceScaleFactor: 3 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 운영 서빙 그대로 고른 메시지(웹뷰 판 caps) · --from 이면 파일 */
async function loadServed(): Promise<Record<string, any> | null> {
  if (FROM) return JSON.parse(fs.readFileSync(FROM, 'utf8'));
  const { query } = await import('../src/config/database');
  const { getActiveMessagesForCustomerV2, parseInAppClientCaps } = await import('../src/utils/inapp-message');
  const r = await query(
    `SELECT id, company_id, title FROM cdp_inapp_messages WHERE title LIKE $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
    [`${TITLE}%`],
  );
  if (!r.rows.length) { console.log(`활성 메시지 없음: ${TITLE}`); return null; }
  const { id, company_id: companyId, title } = r.rows[0];
  console.log(`대상 ${title} (${id})`);

  // 운영 서빙 그대로 · 웹뷰 판 = 모든 종류를 그리는 클라이언트(틀 · 통짜 · 띠 지우지 않음)
  const served = await getActiveMessagesForCustomerV2({
    companyId, channel: 'app', anonymousId: 'inapp-bake-trial', clientCaps: parseInAppClientCaps('webview'),
  });
  const msg = served.find((m: any) => String(m.id) === String(id));
  if (!msg) {
    console.log(`서빙 목록에 없음(받은 ${served.length}건) — 대상 고르기 조건(대상 고객 · 표시 기간 · 요일 · 시간) 때문일 수 있음 · 여기서 멈춤`);
    return null;
  }
  return msg as Record<string, any>;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const msg = await loadServed();
  if (!msg) return;
  fs.writeFileSync(path.join(OUT, 'served.json'), JSON.stringify(msg, null, 2));

  const browser = await puppeteer.launch({
    headless: true, executablePath: CHROME,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--lang=ko-KR'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEW);
    // 앱 다리 흉내(RN 꼴) + 미리 넣는 메시지(앱이 injectedJavaScriptBeforeContentLoaded 로 넣는 것과 같은 값)
    await page.evaluateOnNewDocument((payload: string) => {
      const w: any = window;
      w.__hjlEvents = [];
      w.ReactNativeWebView = { postMessage: (s: string) => { w.__hjlEvents.push(String(s)); } };
      w.__HJL_INAPP__ = JSON.parse(payload);
    }, JSON.stringify({ message: msg, serverNow: new Date().toISOString() }));

    const t0 = Date.now();
    await page.goto(`${BASE}/api/cdp/inapp/webview`, { waitUntil: 'networkidle0', timeout: 30_000 });
    let state = '';
    for (let i = 0; i < 75 && !state; i++) {
      const ev: string[] = await page.evaluate(() => (window as any).__hjlEvents || []);
      if (ev.some((e) => e.includes('"ready"'))) state = 'ready';
      else if (ev.some((e) => e.includes('"failed"'))) state = 'failed';
      else await sleep(200);
    }
    console.log(`그리기 ${state || '시간 초과'} ${Date.now() - t0}ms`);
    await sleep(600); // 들어오는 움직임이 끝나게
    await page.screenshot({ path: path.join(OUT, '0-full.png') });

    const frame = await page.$('[data-hjl-frame]');
    if (!frame) { console.log('틀([data-hjl-frame]) 없음 — 화면 전체만 저장'); return; }
    const count: number = await page.evaluate(() => {
      const rail = document.querySelector('[data-hjl-carousel]') as HTMLElement | null;
      return rail ? rail.children.length : 1;
    });
    // 앱에 보낼 판 = 앱이 따로 그리는 것(닫기 줄 · 쪽 번호 · 버튼 · 바닥 줄)을 숨긴 카드 · 비교용 = 웹과 같은 카드 그대로
    const HIDE = '[data-hjl-part="card-close-row"],[data-hjl-part="pager"],[data-hjl-part="cta-host"],[data-hjl-part="foot"]{display:none!important}';
    for (let s = 0; s < count; s++) {
      if (s > 0) {
        // 쪽 넘김 = 사람이 누르는 버튼 그대로(가로 넘김 칸의 scrollLeft 는 넘김 상태를 바꾸지 않았다 · 로컬 시험 1108)
        await page.click('[data-hjl-part="next"]');
        await sleep(900);
      }
      const t1 = Date.now();
      // 요소 찍기(elementHandle.screenshot)는 화면 밖까지 다시 그리며 넘김 위치를 처음으로 되돌렸다(로컬 1108 · 세 장 같은 그림) → 보이는 화면을 상자로 자른다
      const shot = async (file: string) => {
        const box = await frame.boundingBox();
        if (!box) throw new Error('틀 상자 없음');
        await page.screenshot({ path: path.join(OUT, file), clip: box, captureBeyondViewport: false });
      };
      await shot(`${s + 1}-card.png`);
      const style = await page.addStyleTag({ content: HIDE });
      await sleep(150);
      await shot(`${s + 1}-app.png`);
      await style.evaluate((n: Element) => n.remove());
      console.log(`장 ${s + 1}/${count} 찍음 ${Date.now() - t1}ms`);
    }
    const ev: string[] = await page.evaluate(() => (window as any).__hjlEvents || []);
    console.log(`다리 사건 = ${ev.map((e) => { try { return JSON.parse(e).type; } catch { return '?'; } }).join(', ')}`);
  } finally {
    await browser.close();
  }
  console.log(`끝 → ${OUT}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
