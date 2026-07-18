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
