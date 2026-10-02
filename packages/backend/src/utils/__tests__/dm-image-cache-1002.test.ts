/**
 * DM 이미지 서빙 — 브라우저 캐시 지시 (★2026-10-02 · B-1002-2)
 *
 * 실측(1002): DM 화면이 이미지 100장 이상을 한꺼번에 불러 nginx 요청 제한(api_zone)에 걸렸고, fail2ban 이 고객사 공인 IP 를
 *   1시간 차단했다(회사 PC 전부 `ERR_CONNECTION_TIMED_OUT`). nginx 접속 로그의 304 = 화면을 열 때마다 이미지 전부를 다시 물은 요청.
 * 응답에 캐시 지시가 없었다(같은 파일의 폰트 · 인앱 이미지 서빙에는 있다) → 하루 캐시를 준다. 두 번째 열람부터는 요청이 오지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dm = readFileSync(join(__dirname, '../../routes/dm.ts'), 'utf8');
const at = dm.indexOf("dmPublicRouter.get('/images/:companyId/:filename'");
const handler = dm.slice(at, dm.indexOf('\n});', at));

describe('DM 이미지 서빙(/api/dm/v/images/:companyId/:filename)', () => {
  it('이미지를 보내기 직전에 하루 캐시를 싣는다(인앱 이미지 서빙과 같은 값)', () => {
    expect(at).toBeGreaterThan(0);
    expect(handler).toContain("res.setHeader('Cache-Control', 'public, max-age=86400');");
    const cdp = readFileSync(join(__dirname, '../../routes/cdp.ts'), 'utf8');
    const inapp = cdp.slice(cdp.indexOf("router.get('/inapp/image/:companyId/:filename'"));
    expect(inapp.slice(0, inapp.indexOf('\n});'))).toContain("res.setHeader('Cache-Control', 'public, max-age=86400');");
  });
  it('캐시 지시는 검사(경로 조작 · 없는 파일)를 통과한 뒤 · 보내는 줄 바로 앞에만 있다 — 400·404 응답은 캐시되지 않는다', () => {
    const cache = handler.indexOf("res.setHeader('Cache-Control'");
    const send = handler.indexOf('res.sendFile(');
    expect(cache).toBeGreaterThan(handler.lastIndexOf('res.status(400)'));
    expect(cache).toBeGreaterThan(handler.indexOf("res.status(404).send('Not found')"));
    expect(cache).toBeLessThan(send);
    expect(handler.match(/Cache-Control/g)).toHaveLength(1);
    // 캐시 지시와 보내는 줄 사이에 다른 응답이 끼지 않는다
    expect(handler.slice(cache, send)).not.toContain('res.status(');
  });
  it('보내는 것은 그대로다 — 표시 기준 변환본(CT) · 비율 맞춤 변형', () => {
    expect(handler).toContain('res.sendFile(await getServePath(filePath, parseFitOption(req.query)));');
  });
});
