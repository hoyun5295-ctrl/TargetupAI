import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'production' && obfuscatorPlugin({
      // ★ B-0718-1 (2026-07-18): 동적 import 보유 파일 난독화 제외 — stringArray(threshold 0.5=확률적)가
      //   import('./pages/X') 경로 문자열을 암호화하면 rollup이 청크를 못 만들거나(전 고객 다운 사고),
      //   청크가 있어도 그 지점만 런타임 원시 경로 요청으로 깨진다(로컬 19/38 실측). exclude 실동작은
      //   같은 코드 3회 반복 빌드로 검증(0718). 라우트 경로명은 비밀 아님(청크 파일명으로 어차피 노출).
      //   주의(플러그인 실코드): exclude 지정 = 기본값 "대체"(병합 아님) — node_modules 반드시 동반 나열.
      // ★ B-0825-5 (2026-08-25): vite 내부 가상 모듈 제외. 플러그인 기본 include가 `/\.(jsx?|tsx?|cjs|mjs)$/`라
      //   `vite/modulepreload-polyfill.js`까지 난독화 대상이 되는데, 회차에 따라 그 처리에서 파서가 깨져
      //   빌드가 215ms 만에 죽었다(`@postConstruct ... Invalid or unexpected token`). 같은 커밋이 20:23 성공 →
      //   21:58 실패 → 재시도 성공으로 갈렸다(소스·설정 md5, 패키지 버전, 난독화기 단독 동작 전부 동일 확인).
      //   vite가 만드는 내부 폴리필이라 난독화할 가치가 0이다. 매칭은 anymatch가 모듈 id에 정규식을 그대로 건다.
      exclude: [/node_modules/, /\.nuxt/, /App\.tsx$/, /lazy-page\.tsx$/, /modulepreload-polyfill/],
      // ★ 2026-06-15: 빌드 멈춤(2707모듈 "transformed" 직후 render 단계 hang/OOM) 해결 — 무거운 변환만 제거.
      //   원인: splitStrings(모든 문자열 5자 분할) + stringArrayCallsTransform/체인 래퍼를 전체 번들에 적용 = 매우 무거움.
      //   유지(보호 핵심): hex 식별자 난독화 + base64 문자열배열(rotate/shuffle/indexShift) + console 제거 + compact + simplify.
      //   제거(빌드 비용 폭증분): splitStrings / stringArrayCallsTransform / numbersToExpressions / 체인 래퍼, 래퍼/threshold 축소.
      options: {
        // ★ B-0825-5 (2026-08-25): **빌드를 결정적으로 만든다.** seed 미지정(0)이면 난독화가 회차마다 다른
        //   결과를 내서 같은 커밋이 어떤 회차에는 죽는다. 그래서 "로컬에서 됐다"가 서버를 대표하지 못했다
        //   (0718 전 고객 다운의 뿌리와 같은 비결정성). 실측 = 시드 없이 두 번 = 다름 / 고정 두 번 = 동일.
        //   ⛔ 이 값을 지우거나 0으로 되돌리면 비결정 빌드로 돌아간다. 값 자체에 의미는 없다(날짜를 썼을 뿐).
        //   ⚠ 나쁜 시드를 고정하면 **항상** 실패하지만 첫 빌드에서 즉시 드러난다 — 그때는 값만 바꾼다.
        seed: 20260825,
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: false,
        renameGlobals: false,
        selfDefending: false,
        simplify: true,
        splitStrings: false,
        stringArray: true,
        stringArrayCallsTransform: false,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: false,
        stringArrayWrappersParametersMaxCount: 2,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.5,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
      },
    }),
  ].filter(Boolean),
  build: {
    sourcemap: false,
    // ★ 2026-07-17 축 A(M1) — vendor 분리. ★ Codex 확인 라운드 정정: vendor는 "전 화면 공용" 패키지만
    //   명시(엔트리가 vendor를 즉시 로드하므로 여기 섞이면 로그인 첫 화면이 lazy 전용 라이브러리까지
    //   내려받는다). 나머지(recharts·@dnd-kit 등 lazy 페이지 전용)는 rollup 기본 분할에 맡겨
    //   그 라우트 청크와 함께 필요할 때만 로드 — 의존성 트리를 추측 열거할 필요도 없다.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          const m = id.replace(/\\/g, '/').match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
          const pkg = m?.[1];
          if (!pkg) return;
          // (lucide-react 제외 — Codex 정정: 아이콘은 페이지별 tree-shake 모듈이라 vendor에 묶으면
          //  35개 lazy 페이지의 아이콘 전부가 로그인 첫 로드에 실린다. rollup 기본 분할에 맡긴다)
          const APP_WIDE = ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler', 'zustand', 'axios'];
          if (APP_WIDE.includes(pkg)) return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}))
