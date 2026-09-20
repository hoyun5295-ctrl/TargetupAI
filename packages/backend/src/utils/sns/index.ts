/**
 * sns/index.ts — 어댑터 등록 진입점 (2026-09-20 S1)
 *
 * 어댑터는 파일 하단에서 `registerSnsAdapter` 를 호출한다(import 부작용).
 * 여기를 한 번 import 하면 레지스트리가 채워진다 — 라우트·워커는 이 파일만 import 한다.
 * **선언 순서 = 화면 칩 순서**(§3-3 · 1차-A 는 인스타 먼저).
 */

import './instagram';
import './threads';
import './facebook-page';   // 1차-B · available:false 스켈레톤
import './x';               // 1차-B · available:false 스켈레톤(metered)

export * from './adapter';
