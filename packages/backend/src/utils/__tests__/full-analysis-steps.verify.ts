// 순수 단계 로직 검증 (DB-free — config/database import 없음)
import assert from 'node:assert';
import { ANALYSIS_STEPS, stepProgress, stepLabel } from '../full-analysis-steps';

assert.equal(ANALYSIS_STEPS.length, 9);
assert.equal(stepProgress(0), 0);
assert.equal(stepProgress(9), 100);
assert.equal(Math.round(stepProgress(3)), 33);
assert.equal(stepLabel(1), '성과 진단');
assert.equal(stepLabel(99), 'PDF 생성'); // 범위 초과 → 마지막
assert.equal(stepLabel(0), '성과 진단'); // step<1 → 첫 단계
console.log('full-analysis-steps pure: PASS');
