/**
 * email-structure-prompt.ts — 이메일 생성 프롬프트에 붙는 참조 골격 통계 블록 (2026-09-03 · 설계서 §5-8)
 *
 * 순수 함수. 입력은 stats뿐이라 브랜드명·URL·문구·시퀀스 원문이 들어올 자리가 없다(불변 2).
 * 없으면 '' — 기존 시스템 프롬프트(EMAIL_BLOCKS_SYSTEM)와 문자 단위로 같아진다(불변 5).
 * A6 구조 통계 블록(copy-prompt-composer.ts)과 같은 형태: 통계만, 복제 대상 없음.
 */
import { buildSkeletonContent, type SkeletonStats } from '../dm/dm-structure-resolve';

export function renderStructureBlock(stats: SkeletonStats | null | undefined): string {
  if (!stats || !stats.n || stats.n <= 0) return '';
  return [
    '',
    `## 같은 채널 참조 골격 ${stats.n}건의 구성 통계 (구성 지침 · 실물 아님 · 위 블록 type만 사용)`,
    buildSkeletonContent(stats, 'EMAIL'),
    '- 위는 구성 통계일 뿐이다. 블록 type만 고르고 문구·혜택·상품·수치는 [행사 내용]에 있는 것만 쓴다.',
  ].join('\n');
}
