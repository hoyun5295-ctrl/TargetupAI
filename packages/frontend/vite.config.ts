import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'production' && obfuscatorPlugin({
      // ★ 2026-06-15: 빌드 멈춤(2707모듈 "transformed" 직후 render 단계 hang/OOM) 해결 — 무거운 변환만 제거.
      //   원인: splitStrings(모든 문자열 5자 분할) + stringArrayCallsTransform/체인 래퍼를 전체 번들에 적용 = 매우 무거움.
      //   유지(보호 핵심): hex 식별자 난독화 + base64 문자열배열(rotate/shuffle/indexShift) + console 제거 + compact + simplify.
      //   제거(빌드 비용 폭증분): splitStrings / stringArrayCallsTransform / numbersToExpressions / 체인 래퍼, 래퍼/threshold 축소.
      options: {
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
