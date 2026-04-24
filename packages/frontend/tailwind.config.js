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
      }
    },
  },
  plugins: [],
}
