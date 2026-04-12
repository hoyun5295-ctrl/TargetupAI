/**
 * ★ 한줄전단 POS Agent — 메인 엔트리포인트
 *
 * 실행 흐름:
 * 1. 설정 로드 (agent-config.json)
 * 2. 서버 등록 (agent_key 인증)
 * 3. POS DB 연결
 * 4. 스키마 없으면 → 스���마 읽기 → AI 분석 요청
 * 5. 스케줄러 시작 (판매/회원/재고/하트비트)
 */

import os from 'os';
import { loadConfig, getConfig } from './config';
import { logger } from './logger';
import { registerAgent, requestSchemaAnalysis, fetchConfig as fetchServerConfig } from './server-client';
import { connect, disconnect, isConnected } from './db-connector';
import { readSchema, collectSamples } from './schema-reader';
import { startScheduler, stopScheduler, setSchemaMapping } from './scheduler';

async function main() {
  logger.info('=========================================');
  logger.info('한줄전단 POS Agent v1.0.0 시작');
  logger.info(`호스트: ${os.hostname()}`);
  logger.info('=========================================');

  // 1. 설정 로드
  const config = loadConfig();
  if (!config.agentKey) {
    logger.error('agent_key가 설정되지 않았습니다. agent-config.json에 agentKey를 입력하세요.');
    process.exit(1);
  }

  // 2. 서버 등록
  logger.info('서버 등록 중...');
  const regResult = await registerAgent({
    hostname: os.hostname(),
    pos_type: config.db.type,
  });

  if (!regResult.ok) {
    logger.error(`서버 등록 실패: ${regResult.error}`);
    logger.error('agent_key를 확인하세요.');
    process.exit(1);
  }

  let schemaMapping = regResult.data?.schemaMapping;
  logger.info('서버 등록 완료');

  // 3. POS DB 연결
  logger.info(`POS DB 연결 중... (${config.db.type} ${config.db.host}:${config.db.port}/${config.db.database})`);
  const connected = await connect();

  if (!connected) {
    logger.error('POS DB 연결 실패 — DB 설정을 확인하세요.');
    logger.error('agent-config.json의 db 섹션을 수정하고 다시 실행하세요.');
    process.exit(1);
  }

  // 4. 스키마 매핑 없으면 → AI 분석
  if (!schemaMapping) {
    logger.info('스키마 매핑 없음 — AI 자동 분석 시작');

    // 스키마 읽기
    const tables = await readSchema();
    if (tables.length === 0) {
      logger.error('POS DB에 테이블이 없습니다.');
      process.exit(1);
    }

    // ���플 수집
    const samples = await collectSamples(tables);

    // 서버에 AI 분석 요청
    logger.info('��버에 AI 스키마 분석 요청 중... (30초 이상 소요될 수 있습니다)');
    const analysisResult = await requestSchemaAnalysis({
      dbType: config.db.type,
      tables,
      samples,
    });

    if (!analysisResult.ok || !analysisResult.data?.mapping) {
      logger.error(`AI 분석 실패: ${analysisResult.error}`);
      logger.error('스키마를 수동으�� 확인해주세요.');
      process.exit(1);
    }

    schemaMapping = analysisResult.data.mapping;
    logger.info(`AI 분석 완료 — confidence: ${schemaMapping.confidence}%`);

    if (schemaMapping.confidence < 50) {
      logger.warn('AI 확신도가 낮습니다 (50% 미만). 매핑 결과를 확인해주세요.');
      logger.warn(`회원: ${schemaMapping.memberTable}, 판매: ${schemaMapping.salesTable}`);
      if (schemaMapping.notes?.length) {
        schemaMapping.notes.forEach((n: string) => logger.warn(`  - ${n}`));
      }
    }

    if (schemaMapping.phoneFormat === 'masked') {
      logger.warn('⚠️ 전화번호가 마스킹되어 있습니다. POS 업체에 마스킹 해제를 요청하세요.');
    } else if (schemaMapping.phoneFormat === 'encrypted') {
      logger.warn('⚠️ 전화번호가 암호화되어 있습니다. 복호화 키가 필요합니다.');
    }
  }

  // 5. 스케줄러 시작
  setSchemaMapping(schemaMapping);
  startScheduler();

  logger.info('POS Agent 정상 가동 중');
  logger.info('Ctrl+C로 종료');

  // 종료 핸들러
  process.on('SIGINT', () => {
    logger.info('종료 신호 수신...');
    stopScheduler();
    disconnect();
    logger.info('POS Agent ��료');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopScheduler();
    disconnect();
    process.exit(0);
  });

  // 프로세스 유지
  process.stdin.resume();
}

main().catch(err => {
  logger.error('치명적 오류:', err.message);
  process.exit(1);
});
