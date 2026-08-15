import plugin from 'tailwindcss/plugin';

/**
 * ★ 2026-08-15 등장 애니메이션(`animate-in …`) 자체 구현 — 의존성 0.
 *
 * 사고: 코드 108곳이 `animate-in fade-in zoom-in duration-200` 문법을 쓰고 있었는데
 *   그 문법의 출처인 `tailwindcss-animate` 플러그인이 **설치돼 있지 않았다**(package.json 실측).
 *   클래스는 붙어 있으나 CSS가 생성되지 않아 **전부 무효** — 모달·카드가 애니메이션 없이 즉시 나타났고,
 *   "적어 뒀으니 동작한다"고 믿는 상태가 오래 유지됐다.
 *
 * 왜 플러그인을 설치하지 않는가: 배포 스크립트(`scripts/safe-build.sh`)는 `node_modules/typescript`가
 *   있으면 `npm install`을 건너뛴다. devDependency를 새로 추가하면 서버에 설치되지 않아
 *   config의 require가 깨지고 **빌드 전체가 실패**한다(atomic 패턴이라 사이트는 살아 있지만 배포가 막힌다).
 *   그래서 이미 설치된 `tailwindcss/plugin`만으로 필요한 유틸리티를 직접 만든다.
 *
 * 구현은 tailwindcss-animate와 같은 계약이다 — `animate-in`이 keyframe(enter)을 걸고,
 * `fade-in`·`zoom-in`·`slide-in-from-*`는 그 keyframe이 읽는 CSS 변수를 세팅한다.
 * 그래서 **기존 코드를 한 줄도 고치지 않고** 그대로 살아난다.
 */

const ANIMATION_SCALE = {
  DEFAULT: '0', 0: '0', 50: '.5', 75: '.75', 90: '.9', 95: '.95', 100: '1', 105: '1.05', 110: '1.1', 125: '1.25', 150: '1.5',
};

const ANIMATION_OPACITY = {
  DEFAULT: '0', 0: '0', 5: '.05', 10: '.1', 20: '.2', 25: '.25', 40: '.4', 50: '.5', 60: '.6', 75: '.75', 80: '.8', 90: '.9', 95: '.95', 100: '1',
};

/** 이동 거리 — 숫자는 spacing 스케일(1 = 0.25rem), 기본값은 100%(화면 밖) */
const ANIMATION_TRANSLATE = {
  DEFAULT: '100%', 0: '0px', 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem', 6: '1.5rem', 8: '2rem', 12: '3rem', 16: '4rem', 24: '6rem',
  '1/2': '50%', full: '100%',
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        // D137 리디자인 — 직접발송 패널 전용 stone-150 (Tailwind 기본 100↔200 사이 톤)
        stone: {
          150: '#EFEDEB',
        },
      },
      // 확인 다이얼로그 전용 진입 모션 (shared/ConfirmDialogShell)
      keyframes: {
        'dialog-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'backdrop-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        'backdrop-in': 'backdrop-in 160ms ease-out',
      },
    },
  },
  plugins: [
    plugin(({ addUtilities, matchUtilities, theme }) => {
      // enter/exit keyframe — 변수를 읽어 한 번에 합성한다(각 유틸리티가 변수만 바꾼다)
      addUtilities({
        '@keyframes enter': {
          from: {
            opacity: 'var(--tw-enter-opacity, 1)',
            transform:
              'translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0) ' +
              'scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), var(--tw-enter-scale, 1)) ' +
              'rotate(var(--tw-enter-rotate, 0))',
          },
        },
        '@keyframes exit': {
          to: {
            opacity: 'var(--tw-exit-opacity, 1)',
            transform:
              'translate3d(var(--tw-exit-translate-x, 0), var(--tw-exit-translate-y, 0), 0) ' +
              'scale3d(var(--tw-exit-scale, 1), var(--tw-exit-scale, 1), var(--tw-exit-scale, 1)) ' +
              'rotate(var(--tw-exit-rotate, 0))',
          },
        },
        '.animate-in': {
          animationName: 'enter',
          animationDuration: '150ms',
          animationFillMode: 'both',
          '--tw-enter-opacity': 'initial',
          '--tw-enter-scale': 'initial',
          '--tw-enter-rotate': 'initial',
          '--tw-enter-translate-x': 'initial',
          '--tw-enter-translate-y': 'initial',
        },
        '.animate-out': {
          animationName: 'exit',
          animationDuration: '150ms',
          animationFillMode: 'both',
          '--tw-exit-opacity': 'initial',
          '--tw-exit-scale': 'initial',
          '--tw-exit-rotate': 'initial',
          '--tw-exit-translate-x': 'initial',
          '--tw-exit-translate-y': 'initial',
        },
        '.fill-mode-none': { animationFillMode: 'none' },
        '.fill-mode-forwards': { animationFillMode: 'forwards' },
        '.fill-mode-backwards': { animationFillMode: 'backwards' },
        '.fill-mode-both': { animationFillMode: 'both' },
        '.running': { animationPlayState: 'running' },
        '.paused': { animationPlayState: 'paused' },
      });

      matchUtilities(
        { 'fade-in': (v) => ({ '--tw-enter-opacity': v }), 'fade-out': (v) => ({ '--tw-exit-opacity': v }) },
        { values: ANIMATION_OPACITY },
      );
      matchUtilities(
        { 'zoom-in': (v) => ({ '--tw-enter-scale': v }), 'zoom-out': (v) => ({ '--tw-exit-scale': v }) },
        { values: ANIMATION_SCALE },
      );
      matchUtilities(
        {
          'slide-in-from-top': (v) => ({ '--tw-enter-translate-y': `-${v}` }),
          'slide-in-from-bottom': (v) => ({ '--tw-enter-translate-y': v }),
          'slide-in-from-left': (v) => ({ '--tw-enter-translate-x': `-${v}` }),
          'slide-in-from-right': (v) => ({ '--tw-enter-translate-x': v }),
          'slide-out-to-top': (v) => ({ '--tw-exit-translate-y': `-${v}` }),
          'slide-out-to-bottom': (v) => ({ '--tw-exit-translate-y': v }),
          'slide-out-to-left': (v) => ({ '--tw-exit-translate-x': `-${v}` }),
          'slide-out-to-right': (v) => ({ '--tw-exit-translate-x': v }),
        },
        { values: ANIMATION_TRANSLATE },
      );

      // duration-*·ease-*·delay-*는 Tailwind 기본이 transition 축만 세팅한다.
      // 애니메이션에도 같은 클래스가 먹어야 코드(`animate-in duration-300`)가 의도대로 돈다.
      // 서로 다른 속성이라 기존 transition 사용처에는 영향이 없다(추가만 된다).
      matchUtilities({ duration: (v) => ({ animationDuration: v }) }, { values: theme('transitionDuration') });
      matchUtilities({ delay: (v) => ({ animationDelay: v }) }, { values: theme('transitionDelay') });
      matchUtilities({ ease: (v) => ({ animationTimingFunction: v }) }, { values: theme('transitionTimingFunction') });
    }),
  ],
}
