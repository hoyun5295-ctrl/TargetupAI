import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/auto-capture/index.ts',
  output: {
    file: 'dist/iife/hanjul.min.js',
    format: 'iife',
    name: 'Hanjullo',
    sourcemap: true,
    banner: '/*! @hanjullo/sdk v0.3.10 — Auto-Capture IIFE | (c) Hanjullo (TargetUp) | MIT */',
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
      outDir: undefined,
    }),
    terser({
      format: { comments: /^\!/ },
      compress: { drop_console: false },
    }),
  ],
  treeshake: {
    moduleSideEffects: false,
  },
};
