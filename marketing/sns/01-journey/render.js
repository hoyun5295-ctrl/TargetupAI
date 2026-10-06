// index.html 을 프레임마다 찍어 mp4 로 굽는다(1080x1920 · 30fps · H.264 + AAC · -14 LUFS)
// 영상:  node render.js
// 표지:  node render.js --cover
// 확인용 정지 화면:  node render.js --stills 1,3.2,5.5  (→ stills/ 폴더)
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const puppeteer = require(path.resolve(__dirname, '../../../packages/backend/node_modules/puppeteer'));

const FPS = 30;
const DUR = 15;
const OUT = path.join(__dirname, '한줄로-여정설계-릴스.mp4');
const FF = execFileSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  if (process.argv.includes('--cover')) {
    await page.goto('file:///' + path.join(__dirname, 'cover.html').replace(/\\/g, '/'));
    await page.evaluate(() => document.fonts.ready);
    const png = path.join(__dirname, '한줄로-여정설계-표지.png');
    await page.screenshot({ path: png });
    await browser.close();
    console.log(`완성: ${png}`);
    return;
  }
  await page.goto('file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/'));
  await page.evaluate(() => window.ready);

  const i = process.argv.indexOf('--stills');
  if (i > 0) {
    const dir = path.join(__dirname, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of process.argv[i + 1].split(',').map(Number)) {
      await page.evaluate((s) => window.seek(s), t);
      await page.screenshot({ path: path.join(dir, `t${t.toFixed(2)}.png`) });
    }
    await browser.close();
    return;
  }

  const ff = spawn(FF, [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-i', path.join(__dirname, 'music.wav'),
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', OUT,
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  for (let f = 0; f < FPS * DUR; f++) {
    await page.evaluate((s) => window.seek(s), f / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log(code === 0 ? `완성: ${OUT}` : `ffmpeg 실패 code=${code}`);
})();
