/**
 * esbuild 번들 설정
 * TypeScript 전체 → 단일 dist/bundle.js로 번들링
 * pkg로 exe 변환 전 단계
 */

const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [path.resolve(__dirname, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.resolve(__dirname, 'dist/bundle.js'),
  format: 'cjs',
  sourcemap: false,
  minify: false, // 디버깅 편의

  // Node.js 내장 모듈은 번들에서 제외
  external: [
    'mssql',       // C++ 바인딩 포함
    'mysql2',      // 네이티브 소켓
    'oracledb',    // 선택적
    'pg',          // 선택적
    'xlsx',        // 선택적 (Excel)
    'papaparse',   // 선택적 (CSV)
    'nodemailer',  // 선택적 (알림)
    'cpu-features', // mssql 의존
    'ssh2',        // mssql 의존
  ],

  // sql.js WASM은 번들에 포함시키지 않고 런타임 로드
  // node-cron, axios, zod 등 순수 JS는 번들에 포함

  define: {
    'process.env.NODE_ENV': '"production"',
  },

  // 로깅
  logLevel: 'info',
};

async function build() {
  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('👀 Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log('✅ Bundle 완료: dist/bundle.js');
    }
  } catch (error) {
    console.error('❌ 빌드 실패:', error);
    process.exit(1);
  }
}

build();
