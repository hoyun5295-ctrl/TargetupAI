// index.html 을 프레임마다 찍어 mp4 로 굽는다(1920×1080 · 30fps · H.264 + AAC · -14 LUFS)
// 영상:        node render.js                     (music.wav 가 있으면 소리를 붙인다)
// 일부만:      node render.js --from 20 --to 66     (→ out/part-20-66.mp4 · 소리 없음)
// 정지 화면:   node render.js --stills 1,3.2,5.5    (→ stills/)
// 일꾼 수:     --workers 6(기본 = CPU 절반 · 구간을 나눠 동시에 찍고 이어 붙인다)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const puppeteer = require(path.resolve(__dirname, '../../../packages/backend/node_modules/puppeteer'));

const FPS = 30;
const FF = execFileSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

async function openPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto('file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/'));
  await page.evaluate(() => window.ready);
  return page;
}

function run(args) {
  return new Promise((res, rej) => {
    const p = spawn(FF, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg code=${c}`))));
  });
}

async function segment(page, f0, f1, file, tag) {
  const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), file],
    { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((r) => ff.on('close', r));
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    await page.evaluate((s) => window.seek(s), f / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - f0) % 150 === 0) console.log(`${tag} ${f - f0}/${f1 - f0} · ${((f - f0) / Math.max(1, (Date.now() - t0) / 1000)).toFixed(1)} fps`);
  }
  ff.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`${tag} ffmpeg code=${code}`);
}

const launch = () => puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });

(async () => {
  const browser = await launch();
  try {
    const stills = arg('--stills');
    if (stills) {
      const page = await openPage(browser);
      const dir = path.join(__dirname, 'stills');
      fs.mkdirSync(dir, { recursive: true });
      for (const t of stills.split(',').map(Number)) {
        await page.evaluate((s) => window.seek(s), t);
        await page.screenshot({ path: path.join(dir, `t${t.toFixed(2).padStart(7, '0')}.png`) });
      }
      console.log(`정지 화면 ${stills.split(',').length}장 → ${dir}`);
      return;
    }
    const probe = await openPage(browser);
    const total = await probe.evaluate(() => window.total());
    await probe.close();
    const from = Number(arg('--from', 0));
    const to = Math.min(Number(arg('--to', total)), total);
    const F0 = Math.round(from * FPS), F1 = Math.round(to * FPS);
    const workers = Math.max(1, Number(arg('--workers', Math.max(1, Math.floor(os.cpus().length / 2)))));
    const per = Math.ceil((F1 - F0) / workers);
    const parts = [];
    for (let k = 0; k < workers; k++) {
      const a = F0 + k * per, b = Math.min(F1, a + per);
      if (a < b) parts.push({ a, b, file: path.join(OUT, `seg-${String(k).padStart(2, '0')}.mp4`) });
    }
    console.log(`프레임 ${F1 - F0}장 · 일꾼 ${parts.length}`);
    // 일꾼마다 브라우저를 따로 띄운다(한 브라우저의 여러 탭이 동시에 찍으면 뒤쪽 탭이 밀린다)
    await Promise.all(parts.map(async (s, k) => {
      const b = await launch();
      try {
        const page = await openPage(b);
        await segment(page, s.a, s.b, s.file, `#${k}`);
      } finally {
        await b.close();
      }
    }));
    const list = path.join(OUT, 'list.txt');
    fs.writeFileSync(list, parts.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'));
    const whole = from === 0 && to === total;
    const video = path.join(OUT, whole ? 'video.mp4' : `part-${from}-${to}.mp4`);
    await run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
    parts.forEach((s) => fs.unlinkSync(s.file));
    const music = path.join(__dirname, 'music.wav');
    if (whole && fs.existsSync(music)) {
      const final = path.join(__dirname, '한줄로AI-소개영상.mp4');
      await run(['-y', '-loglevel', 'error', '-i', video, '-i', music, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', final]);
      console.log(`완성: ${final}`);
    } else {
      console.log(`완성(소리 없음): ${video}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
