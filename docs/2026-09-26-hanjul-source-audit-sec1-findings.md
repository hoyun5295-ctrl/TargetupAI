# 한줄로 소스 전수점검 · 부분 ① 발송·돈 발견 상세 (2026-09-26)

> 장부 = [2026-09-25-hanjul-source-audit.md](2026-09-25-hanjul-source-audit.md) §2-2(확인 판정은 장부가 소유). 이 파일은 에이전트 보고 원문(시나리오·근거·소비처)을 보존한다.
> 워크플로 `wf_d2ad0d24-907` · 에이전트 14(미독 청크 2 · 흐름 6 · 횡단 6) · 경로는 packages/backend/src 기준.

## F01 [critical·data] 직접발송 알림톡의 선불 차감·환불이 알림톡 단가(KAKAO)가 아니라 클라이언트가 보낸 msgType(LMS) 단가로 된다

- 위치: `packages/backend/src/routes/campaigns.ts:2360` · 출처: flow:F3-kakao · 등재: BUGS.md 미등재. docs/2026-08-17-rcs-integration-design.md:448에 '알림톡 직접발송 차감 축이 msgType(LMS)로 떨어진다 — 의도 미확인' 메모만 있다. DECISIONS에 관련 결정 없음.
- 시나리오: 선불 고객사(cost_per_kakao 7.5원, cost_per_lms 27원)가 알림톡 창에서 1만 건을 보낸다. 프론트는 msgType='LMS'를 강제로 싣고(Dashboard.tsx:626·793) 서버는 이 값을 그대로 차감 축으로 쓴다. 차감액은 1만×27=270,000원이다. 9,000건이 카카오 성공(1800)이어도 sweeper는 성공분을 '정당 과금'으로 유지하므로 성공 9,000건이 243,000원으로 남는다. 알림톡 단가로는 67,500원이라 고객이 175,500원을 더 낸다. 같은 알림톡이 여정 경로에서는 KAKAO 단가로 깎이고(journey-executor.ts:805·1025) 후불 청구는 SMSQ msg_type K를 KAKAO로 매긴다. 결국 같은 발송이 경로와 과금 방식에 따라 다른 값을 낸다. 화면(잔액 모달 '카카오톡' 단가 · 결과 모달 예상비용)은 KAKAO 단가를 보여 준다. 반대로 API로 msgType='SMS'를 보내면 알림톡과 LMS 대체발송이 모두 SMS 단가로 깎여 회사가 덜 받는다.
- 근거: campaigns.ts:2360 `const directDeductType = isBrandOnlyChannel(directChannel) ? 'BRAND' : directMsgResolved.messageType;`. 대량 경로 direct-send-core.ts:109 `const deductAxes = resolveRefundAxes(directChannel, spec.msgType);` → billing-types.ts:155 `return [{ type: String(messageType || 'SMS'), scope: 'all' }];`. billing-types.ts:114 `CHARGEABLE_MESSAGE_TYPES = ['SMS', 'LMS', 'MMS']`라 알림톡을 KAKAO로 받을 방법이 없다. Dashboard.tsx:626 `msgType: isAlimtalk ? 'LMS' : directMsgType,` / 여정 journey-executor.ts:805 `const prepaidMsgType = msgType === 'KAKAO' ? 'KAKAO' : ...` / ResultsModal.tsx:547 `if (isAlimtalkChannel(c)) return sum + success * perKakao;` / billing-types.ts:262 KAKAO smsqCode 'K'(후불).
- 소비처: mysql-refund-sweeper.ts:254-266·298-323: 환불 단가를 차감 원장(LMS)에서 되살려 성공분 과금을 그대로 유지하고, 단가를 바로잡는 경로는 없다. direct-send-worker.ts:586 미적재 환불과 campaigns.ts:2823 알림톡 미적재 환불도 같은 LMS 축을 쓴다. prepaid.ts:153 resolveChargeUnitPriceDetailed는 KAKAO 축(unit-price.ts:94 cost_per_kakao)을 지원하지만 직접발송 알림톡은 그 축에 도달하지 않는다. /direct-send/commit(campaigns.ts:1740)도 /direct-send(campaigns.ts:2009)도 알림톡일 때 유형을 바꾸지 않는다.

## F02 [critical·defect] 브랜드 이미지 preflight 예외가 적재 try 밖에서 나면 선차감 전액이 환불되지 않는다

- 위치: `packages/backend/src/utils/direct-send-worker.ts:430` · 출처: sweep:S-D-workers · 등재: B-0727-1과 같은 계열(워커 예외 시 미환불). 당시 수정은 적재 루프만 try로 감쌌고, preflight는 2026-09-02에 try 밖에 새로 들어가 재발했다. 이 재발은 BUGS.md에 등재되어 있지 않다.
- 시나리오: 선불 고객사가 staging 직접발송(kakao 또는 both 채널, 이미지 첨부)으로 N건을 보낸다. commit(routes/campaigns.ts:1823-1836)은 preflight 없이 createDirectSendCampaign으로 N건×단가를 전액 선차감한다. 워커 processCampaign이 430행 prepareBrandAttachmentForSend를 부르고, 카카오 이미지 등록이 일시 실패하거나(brand-image-resolver.ts:247 '이미지를 카카오에 등록하지 못했습니다. 잠시 후 다시 시도해주세요') 자산 조회에서 DB 오류가 나면(brand-message.ts:1708) 예외가 482행 try 앞에서 던져진다. 이 예외는 runDirectSendOnce의 catch(309-316행)로 가서 send_phase='failed'와 failure만 적는다. NOT_LOADED 환불도 refundPending 기록도 없다. 결과: 한 건도 나가지 않았는데 고객사가 N건 값을 모두 낸다(1만 건 LMS면 약 26만 원). 예약 발송이면 status가 'scheduled'로 남는다. 그 상태에서 사용자가 취소해도 큐 대기 행이 0건이라 환불이 0원이다. prepareFieldMappings, dedup/unsub staging DELETE처럼 try 앞에서 실행되는 다른 단계가 던져도 같은 경로로 간다.
- 근거: 430-437행 `const brandPreflight = !skipLoad && (cfg.sendChannel === 'kakao' || cfg.sendChannel === 'both') ? await prepareBrandAttachmentForSend({...})` — try는 482행에서야 시작한다. 427-428행 주석은 '이미 선차감된 건은 기존 미적재 환불 축(아래 refundAxes)이 되돌린다'고 적었지만 실제로는 그 블록까지 가지 않는다. 바깥 catch(310-315행)는 `UPDATE campaigns SET send_phase = 'failed', send_config = jsonb_set(..., '{failure}', ...)`만 하고 환불 호출이 없다.
- 소비처: mysql-refund-sweeper.ts:236 `if (camp.send_phase == null || camp.send_phase === 'sent')` — 'failed'는 환불 대상이 아님. direct-send-worker.ts:124-131은 send_config.refundPending이 있는 캠페인만 재시도하는데, catch가 이 값을 쓰지 않음. campaign-lifecycle.ts:91-100(cleanup)과 666-676(syncCampaignResults direct)은 MySQL 실패 행 수로만 FAIL 환불을 하므로 행 0건이면 0원. campaign-lifecycle.ts:242-256 cancelCampaign은 대기 행 수만 환불(0). direct-send-worker.ts:286-287의 C-10 정산은 send_phase='queued'만 집음. 다른 consumer 중 send_phase='failed'를 환불하는 곳은 grep 결과 없음(direct-send-core.ts:142·198은 refundPending을 함께 기록하는 별도 경로).

## F03 [critical·defect] 공개 결제 리턴 콜백을 다시 보내면, 이미 충전된 결제인데도 결제 상태를 확인하지 않고 망취소를 보낸다

- 위치: `routes/payments.ts:169` · 출처: sweep:S-C-charge-payment · 등재: 미등재. BUGS.md에서 netCancel·망취소·authToken·payments.ts·inicis를 grep하면 B-0902-2(CORS 500·XSS)와 그 추가 과제 ②(A-03: 남의 pending을 failed로 뒤집음)만 나온다. 이번 건은 completed 결제의 PG 취소라 다른 결함이다. 망취소 분기는 C-14 이전부터 있었지만, C-14가 추가한 UNTRUSTED_AUTH_URL 조기 반환 때문에 이니시스 응답과 무관하게 이 분기에 확실히 들어가는 경로가 새로 생겼다.
- 시나리오: 선불 고객사 사용자가 카드로 1억 원(prepare 상한)을 결제한다. 첫 /inicis/return에서 승인이 되고 잔액 +1억, payments.status='completed'가 된다. 그 직후 사용자가 개발자도구에 남은 자기 리턴 form 본문(mid·orderNumber·authToken·netCancelUrl)을 그대로 두고 authUrl만 이니시스가 아닌 주소(예: https://x.com)로 바꿔 /inicis/return에 다시 POST한다. 로그인이 필요 없는 경로다. approveInicisPayment가 C-14 검사에서 UNTRUSTED_AUTH_URL(success:false)를 돌려주면 라우트는 payments 상태를 보지 않고, 우리 signKey로 서명한 망취소를 진짜 netCancelUrl로 보낸다. 요청에는 원래 authToken과 올바른 mid가 실린다. authUrl을 그대로 두고 다시 보내 이니시스가 재사용 토큰을 거절해도 같은 분기로 들어간다. finalizePaymentFailure는 status='pending' 조건이라 completed 행을 건드리지 않는다. 이니시스가 망취소를 받아들이는 시간 안이면 카드 승인은 취소되고 잔액 1억은 그대로 남는다. 망취소는 승인된 거래를 가맹점이 되돌리는 용도라 받아들여질 가능성이 높다. 결국 고객사는 돈을 내지 않고 발송 잔액을 얻고 회사가 그 금액을 잃는다. payments 행이 completed로 남고 이니시스와 대사하는 작업이 없어 이 차이를 잡지 못한다.
- 근거: payments.ts:167-173 `const approval = await approveInicisPayment(callback); if (!approval.success) { if (callback.netCancelUrl) { await netCancelInicisPayment(callback.netCancelUrl, callback); }` — 호출 전에 payments 상태를 조회하지 않는다. inicis-client.ts:244-252 `if (!isTrustedInicisUrl(callback.authUrl)) { ... return { success: false, resultCode: 'UNTRUSTED_AUTH_URL', ...` — fetch 없이 실패를 돌려줘 위 분기로 들어간다. inicis-client.ts:313-331 netCancelInicisPayment가 callback.mid·callback.authToken과 config.signKey로 만든 verification을 신뢰 주소 netCancelUrl에 POST한다. payment-processor.ts:253 finalizePaymentFailure는 `WHERE pg_order_id = $5 ... AND status = 'pending'`이라 completed 행은 0건 갱신으로 끝난다.
- 소비처: payments.ts:117-219의 /inicis/return 전체를 읽었다. 인증 미들웨어(282행 router.use(authenticate))보다 앞에 있어 공개 경로다. app.ts:262·275 PG_CALLBACK_CORS_RE가 이 경로의 CORS 검사를 빼 준다. payment-processor.ts:113-129 finalizePaymentSuccess의 completed 멱등 분기는 approval.success일 때만 닿으므로 이 실패 분기를 막지 못한다. 저장소 전체에서 `FROM payments`·`UPDATE payments`를 grep했더니 payments.ts·payment-processor.ts뿐이고 pending·completed를 이니시스와 대사하는 워커는 없다. inicis-url-guard.test.ts 1-105행도 주소 검사만 잠그고 망취소 호출 조건(결제 상태)은 검증하지 않는다.

## F04 [critical·defect] 선불 알림톡 직접발송이 알림톡 단가가 아니라 LMS 단가로 차감된다

- 위치: `utils/direct-send-core.ts:109` · 출처: flow:F2-direct-send · 등재: BUGS.md 미등재. docs/2026-08-17-rcs-integration-design.md:448에 '알림톡 직접발송의 차감 축 확인 — 의도된 것인지 미확인' 메모만 있다.
- 시나리오: 선불 고객이 알림톡 창(AlimtalkSendModal)에서 1만 건을 보내면 Dashboard가 commit에 msgType 'LMS', sendChannel 'alimtalk'을 실어 보낸다. 차감 축이 LMS로 정해져 cost_per_lms(기본 27원) × 1만 = 27만 원이 빠진다. 단가표와 잔액 모달이 보여 주는 알림톡 단가(cost_per_kakao, 기본 7.5원)로는 7.5만 원이라 약 19.5만 원을 더 받는다. 성공분은 환불 대상이 아니어서 그대로 확정된다. 요금제 무료 제공도 알림톡 몫(free_alimtalk_qty)이 아니라 LMS 몫이 깎인다. 동기 /direct-send(직접타겟발송 알림톡)와 마케팅 플래너 알림톡(planner-executor.ts:730)도 같은 축이다. 같은 큐 행(msg_type 'K')을 후불은 KAKAO 단가로 청구하고 여정 알림톡은 KAKAO로 차감한다. 선불 직접발송만 3.6배 비싸다.
- 근거: direct-send-core.ts:109 `const deductAxes = resolveRefundAxes(directChannel, spec.msgType);` → billing-types.ts:155 `return [{ type: String(messageType || 'SMS'), scope: 'all' }];`(alimtalk 분기 없음) · Dashboard.tsx:626 `msgType: isAlimtalk ? 'LMS' : directMsgType,` · campaigns.ts:2360 `const directDeductType = isBrandOnlyChannel(directChannel) ? 'BRAND' : directMsgResolved.messageType;` · 대조: journey-executor.ts:805 `const prepaidMsgType = msgType === 'KAKAO' ? 'KAKAO' : ...` · billing-types.ts:262 `{ key: 'KAKAO', label: '카카오알림톡', companyPriceColumn: 'cost_per_kakao', ... smsqCode: 'K' }` · free-messaging.ts:41 `{ key: 'KAKAO', label: '알림톡', planColumn: 'free_alimtalk_qty' }`(22줄 주석: key는 prepaidDeduct(messageType)과 같은 값) · sms-queue.ts:1186 알림톡 행 `'K'`
- 소비처: prepaid.ts:153 resolveChargeUnitPriceDetailed(c, messageType)가 'LMS'면 cost_per_lms를 고른다(unit-price.ts:93-96). mysql-refund-sweeper.ts:237은 같은 LMS 축으로 실패분만 환불하고, 성공분의 단가 차액을 되돌리는 경로는 전체 grep에서 찾지 못했다(cost_per_kakao를 쓰는 곳은 utils 중 config/defaults뿐). 프론트 BalanceModals.tsx:159는 '카카오톡' 단가로 cost_per_kakao를 보여 준다.

## F05 [critical·data] 여정 발송 선불 차감에 환불 경로가 하나도 없어, 통신사 실패분도 영구 과금된다

- 위치: `utils/journey-executor.ts:1025` · 출처: sweep:S-A-prepaid · 등재: 미등재(BUGS.md를 여정·journey·환불로 grep한 결과 0건)
- 시나리오: 선불 회사의 여정이 LMS 1,000건을 보냈고 결번·수신불가 등으로 30건이 통신사 실패로 확정됐다. 같은 문자를 캠페인으로 보냈다면 sync·sweeper가 FAIL 항아리로 30건 값을 돌려준다. 여정은 차감이 reference_type='journey', reference_id=journey_id로만 남는데, 이 원장을 읽어 환불하는 코드가 저장소 어디에도 없다. 그래서 30건 × 단가가 매번 고객 부담으로 남고, 여정이 도는 날마다 쌓인다. 시스템이 스스로 세운 불변식 '차감 = 성공 + 순환불'(refund-calc.ts:73-77)을 여정만 어긴다.
- 근거: journey-executor.ts:1025 `const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, exec.journey_id, exec.created_by || undefined, 'journey');` · 저장소 전체 prepaidRefund 호출부를 grep한 결과 referenceType 'journey'로 부르는 곳이 0건이다(prepaid.ts:96 주석에만 등장). · mysql-refund-sweeper.ts:257/263 `reference_type = 'campaign' AND reference_id = $2`(차감은 campaign 축만 읽는다)
- 소비처: mysql-refund-sweeper.ts:118-131, 254-266: 여정 단계 캠페인(journey-step-campaign.ts:85, status 'sending')도 후보에 들어가지만, 차감을 reference_type='campaign'·단계 campaign_id로만 찾는다. 그래서 차감 0건으로 계산되고 calcRefundParts의 fail도 min(0, fail)=0이 되어 환불이 나가지 않는다. campaign-lifecycle.ts:591-602 직접발송 동기화는 send_type IN ('direct','operator')만 다룬다(send-type-axis.ts:61). journey는 AI 블록(campaign_runs)에도 속하지 않는다. 설령 FAIL 환불을 부르더라도 prepaid.ts:390 상한(차감 0)에 걸려 0원이다.

## F06 [critical·data] 선불 회사가 여정으로 보낸 문자는 통신사 실패분이 영영 환불되지 않는다

- 위치: `utils/journey-executor.ts:1025` · 출처: flow:F4-scheduled-auto · 등재: 미등재(BUGS.md에 여정 환불·journey-executor 환불 항목 없음)
- 시나리오: 선불 회사가 장바구니 이탈 여정으로 한 달에 LMS(30원) 3,000건을 보냈고 결번·단말 오류 같은 통신사 실패가 5%(150건) 났다고 하자. 직접발송·AI 발송이라면 FAIL 환불로 4,500원이 돌아온다. 여정은 한 푼도 돌려받지 못해 고객사가 실패분까지 낸다. 알림톡 여정도 같다. 여정 캠페인은 원장상 차감이 0으로 보여 불변식 점검이 '초과환불 잔존' 거짓 경보 문자를 6시간마다 보낸다(minor 참조).
- 근거: journey-executor.ts:1025 `prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, exec.journey_id, exec.created_by || undefined, 'journey')` — 차감이 reference_type='journey', reference_id=journey_id로 남는다. 환불 쪽은 mysql-refund-sweeper.ts:261-266 `WHERE ... type = 'deduct' AND reference_type = 'campaign' AND reference_id = $2`(=step 캠페인 id)라 차감 건수가 0이 된다. prepaid.ts:326 `loadDeductLedger(client, companyId, referenceType, campaignId, ...)`, 390 `Math.min(additionalRefund, totalDeducted - alreadyRefunded)`라 상한도 0이다.
- 소비처: mysql-refund-sweeper.ts:118-131: 후보 SELECT가 send_type을 가리지 않고 'sending'을 포함해 여정 step 캠페인(journey-step-campaign.ts:85 status 'sending')을 집는다. 그러나 254-298에서 dedTotal=0, deductedCount=0이 되고, 311-329 calcRefundParts는 차감 0이라 환불도 0이다. campaign-lifecycle.ts:436-447(AI 블록)은 campaign_runs가 있어야 하고, 591-600(직접 블록)은 send_type IN (direct, operator)만 본다. send-type-axis.ts의 DIRECT_PIPELINE_SEND_TYPES=['direct','operator']라 여정은 두 블록 모두에서 빠진다. prepaidRefund 호출부 7개 파일(campaigns·lifecycle·direct-send-worker·core·sweeper·brand-message·auto-campaign-worker) 중 여정 경로는 없다. campaign-sync-worker.ts:112-116 notifyJourneyResultsToManagers는 알림만 보낸다.

## F07 [critical·data] 후불 회사의 여정 발송이 청구 수량에서 통째로 빠진다(무료 발송)

- 위치: `utils/send-usage-aggregation.ts:593` · 출처: flow:F4-scheduled-auto · 등재: 미등재
- 시나리오: 후불 회사(103사 축)가 여정(생일·장바구니 이탈·one_shot)으로 한 달에 LMS 3,000건을 보내 성공했다고 하자. 거래내역서와 청구서의 수량은 0건이라 한줄로가 3,000건 발송비 전액을 청구하지 못한다. 선불은 발송 때 차감되지만 후불은 prepaidDeduct가 금액 0으로 곧바로 돌아온다. 그래서 여정은 후불 회사에게 과금 경로가 하나도 없다.
- 근거: send-usage-aggregation.ts:576-583 `FROM campaign_runs cr ... AND cr.status = 'completed'`, 593 `AND c2.send_type IN (${DIRECT_PIPELINE_SEND_TYPES_SQL})` + 595 `c2.status = 'completed'`, 616-618 레거시 축도 같은 send_type·completed 조건이다. 여정 캠페인은 journey-step-campaign.ts:85 `'sending', NOW(), NOW(), $10::uuid, $11, 'journey'`이고 campaign_runs 행이 없다. prepaid.ts:121-126 `if (pre.rows[0].billing_type !== 'prepaid') { ... return { ok: true, amount: 0 }; }`.
- 소비처: send-usage-aggregation.ts:750·1824: 청구서(buildBillingUsageRows)와 사용량(buildCompanyUsageByDay)이 모두 selectBillingSendIds 한 곳만 쓴다. partitionBillingSendIds(535-554)에도 여정 축이 없다. routes/billing.ts와 utils/billing-*.ts를 grep하면 'journey'와 reference_type 참조가 0건이다. INSERT INTO campaign_runs를 grep하면 campaigns.ts 4곳과 auto-campaign-worker 1곳뿐이고 여정은 없다. journey-step-campaign.ts:8-10 주석은 '발송 시 prepaidDeduct로 즉시 차감'을 정산 근거로 삼는데, 이 전제는 후불에서 성립하지 않는다.

## F08 [high·defect] 차감을 커밋한 뒤 첫 큐 적재가 커밋되기 전에 프로세스가 죽으면 차감액이 영구히 환불되지 않는다(자동 복구 경로 없음)

- 위치: `packages/backend/src/routes/campaigns.ts:1131` · 출처: flow:F1-campaign-send · 등재: 미등재(BUGS.md에서 재시작·차감·적재를 grep해 0건)
- 시나리오: 선불 회사가 LMS 20,000명 AI 캠페인을 즉시 발송한다. 1131에서 prepaidDeduct가 커밋된다(예: 20,000×30원=600,000원). 1185 bulkInsertSmsQueue의 첫 5,000행 배치(BATCH_SIZES.smsSend=5000)가 커밋되기 전에 PM2가 재시작된다(배포 reload, max_memory_restart 1700M, 다른 요청의 uncaughtException→process.exit). 이때 캠페인은 status 'draft', 실행 행은 'sending', MySQL은 0행이다. 결과 동기화는 MySQL 실적이 있어야 움직이고, sweeper는 draft를 후보에서 빼며 처리수가 0이면 미적재도 0으로 본다. refundPending 기록도 없어서 600,000원이 영구히 환불되지 않는다. 'both' 채널은 문자 적재를 마친 뒤 브랜드 INSERT(1193) 전에 죽어도 같다. BRAND 축은 처리수가 0이라 브랜드 차감 전액이 같은 이유로 남는다. draft는 목록에서 빠지므로 사용자는 실패로 알고 새 캠페인으로 다시 보낸다. 결과적으로 한 번 발송에 두 번 비용을 낸다. 부분 적재 뒤에 죽은 경우는 동기화가 completed로 올리고 sweeper가 미적재분을 환불하므로 복구된다. 영구 손실은 0행 적재(축 단위)에서만 생긴다.
- 근거: campaigns.ts:1131 `const sendDeduct = await prepaidDeduct(companyId, filteredCustomers.length, deductType, id, userId, 'campaign', ...)` → 1185 `aiSmsInserted = await bulkInsertSmsQueue(...)` 사이에 상태 표시가 없고(캠페인은 1259에서야 status를 바꿈) · refund-calc.ts:88 `const notLoaded = processed > 0 ? Math.max(0, covered - processed) : 0;` · mysql-refund-sweeper.ts:127 `AND c.status IN (${SWEEPABLE_CAMPAIGN_STATUS_SQL})`(= sending·completed·failed) · app.ts:549-552 `process.on('uncaughtException', ... process.exit(1)` · SIGINT/SIGTERM 처리 없음
- 소비처: campaign-lifecycle.ts:436-448·494(AI 동기화는 success/fail/pending>0일 때만 상태와 환불을 처리함) · campaign-sweep-scope.ts:26(draft 제외) · mysql-refund-sweeper.ts:236-306(처리수 0이면 미적재 0) · campaign-lifecycle.ts:41-45(cleanupScheduled는 status='scheduled'만 봄) · direct-send-worker.ts:117-131(refundPending이 있어야 재시도하는데 이 경로는 기록하지 않음) · system-monitor-worker.ts 머리주석(차감 뒤 미적재 감지 없음) · campaigns.ts:116-118(목록이 draft를 뺌) · ecosystem.config.js:38 max_memory_restart · app.ts grep 결과 SIGINT/SIGTERM 핸들러 없음. 막아 주는 방어 코드 없음

## F09 [high·defect] 큐 적재가 끝난 뒤 예외가 나면 catch가 캠페인을 failed로 덮고 '자동 환불'이라고 안내한다. 예약 발송분은 취소할 수 없는 상태로 예약 시각에 전량 나간다

- 위치: `packages/backend/src/routes/campaigns.ts:1334` · 출처: flow:F1-campaign-send · 등재: 미등재(BUGS.md에서 '자동 환불됩니다'·취소 불가를 grep해 0건)
- 시나리오: 예약 AI 캠페인 10,000명이 1185·1193에서 전량 적재된다. 그 뒤 1246·1259 UPDATE나 1270 SELECT가 PG 풀 대기 초과(max 20, connectionTimeoutMillis 5000) 같은 일시 오류로 throw한다. catch는 적재가 완료됐으므로 미적재 환불 0을 계산하고, `UPDATE campaigns SET status='failed'`를 실행하며, failCampaignRun으로 'scheduled' 실행 행을 'failed'로 바꾼다. 응답은 500 '발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.'이다. 실제로는 큐 10,000행이 예약 시각을 기다리고 있고 환불은 없다. cancelCampaign은 scheduled·draft만 받으므로 사용자(POST /:id/cancel)도 관리자(manage-scheduled·admin)도 취소할 수 없다. 결국 예약 시각에 전량 발송된다. Dashboard는 오류 문구를 토스트로 띄우고 발송 모달을 연 채로 둔다. 그래서 사용자가 다시 누르면 새 캠페인이 만들어져 또 차감·적재되고, 수신자 10,000명이 같은 문자를 두 번 받으며 고객사는 두 번 낸다. 즉시 발송도 같은 안내 때문에 중복 재발송을 부른다. 완료된 캠페인을 재발송해 target_count가 바뀌면 protect_completed_target_count 트리거도 1259에서 같은 catch로 떨어진다.
- 근거: campaigns.ts:1297-1340 catch: `for (const axis of resolveRefundAxes(...)) { const aiNotLoaded = Math.max(0, filteredCustomers.length - loadedOf(axis.type)); if (aiNotLoaded <= 0) continue; ...}` → 1334 `UPDATE campaigns SET status = 'failed' ... WHERE id = $1` → 1339 `await failCampaignRun(campaignRun.id, ...)` → 1340 `'발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.'`. 적재 여부(aiSentCount>0)와 관계없이 같은 종결을 한다
- 소비처: campaign-lifecycle.ts:216-221(`if (!queueOnly && camp.status !== 'scheduled' && camp.status !== 'draft') return '취소 가능한 상태가 아닙니다'`) · manage-scheduled.ts:110·admin.ts:2419도 같은 cancelCampaign(queueOnly 아님) · campaign-lifecycle.ts:130-139(failCampaignRun이 scheduled 행도 failed로 바꿈) · campaign-sync-worker.ts:401-402(failed 복원은 발송 기준 시각 +10분 뒤라 예약 전에는 풀리지 않음) · cancelled-queue-sweeper.ts:28(cancelled만 큐를 지움) · mysql-refund-sweeper(failed도 후보라 돈은 결국 수렴하므로 결함의 본질은 취소 불가·중복 발송) · frontend Dashboard.tsx:1882-1890(서버 error 문구를 그대로 토스트로 띄우고 모달 유지)

## F10 [high·defect] 대행발송 취소(queueOnly)를 적재 워커가 보지 못해 '이미 발송' 오판과 늦게 적재된 조각의 미환불이 생긴다

- 위치: `packages/backend/src/utils/direct-send-worker.ts:491` · 출처: sweep:S-D-workers · 등재: BUGS.md에 미등재. B-0828-1이 queueOnly를 도입했다. C-10은 status='cancelled' 취소만 적재 워커에 연결했고 queueOnly 경로는 다루지 않았다.
- 시나리오: (a) 직접발송 워커가 다른 대량 캠페인을 적재하느라 바빠서 대행발송 캠페인이 send_phase='queued'로 대기하는 중에 담당자가 취소한다. cancelCampaign(queueOnly)은 대기 0건·픽업 0건이라 alreadySent=true를 돌려준다. campaignMayHaveSent는 phase 'queued'에도 true라서 접수가 원래 상태로 되돌려지고 '이미 발송이 끝나 취소할 수 없습니다'(409) 응답이 나간다. 그 뒤 워커가 전량을 적재해 예약 시각에 발송하고 과금한다. 취소를 요청한 고객사가 실제로 발송·과금을 당한다. (b) 적재 도중(processing)에 취소하면 그때까지 적재된 E건은 삭제되고 CANCEL 환불 E건이 나간다. 접수는 cancelled가 된다. 그러나 queueOnly는 캠페인 status를 바꾸지 않으므로 워커는 나머지 L건을 계속 적재한다. 대조 워커가 5분 안에 다시 중화해 L건을 지우지만, 환불은 prepaidRefund(L, CANCEL, forceKeyedPot)이다. 이 호출은 CANCEL 항아리의 누적 목표라서 max(0, L−E)만 나간다. 예: 2만 건 중 1만 건 적재 시점에 취소하면 첫 회 1만 건 환불, 늦게 적재된 1만 건 삭제분은 0원이다. 1만 건 값이 영구 미환불이다. 이후 cleanup이 sent_count를 0으로 덮고 sweeper도 처리수 0이라 notLoaded=0이 되어, 이 차이를 잡는 경로가 없다.
- 근거: direct-send-worker.ts:490-494 `const cancelCheck = await query(`SELECT status ...`); if (cancelCheck.rows[0]?.status === 'cancelled') { ... break; }` — 적재 중단 조건이 status 하나뿐이다. campaign-lifecycle.ts:381-388 `if (queueOnly) { return { success: true, alreadySent: totalCancelCount === 0 && alreadyPickedUp === 0, ... } }` — 상태를 바꾸지 않는다. campaign-lifecycle.ts:349-351 주석 '취소 환불은 캠페인당 한 번뿐이라 그 항아리가 비어 있음이 보장된다' + `{ refundKey: REFUND_KEYS.CANCEL, forceKeyedPot: true }`. 반면 agency-send-worker.ts:1327 주석은 'queueOnly 중화는 캠페인 상태를 바꾸지 않아, 늦게 적재된 조각까지 여기서 막는다'로, 같은 캠페인을 여러 번 중화한다고 전제한다. agency-send-campaign.ts:80-81 `return !!found.id && found.phase !== 'preparing';`는 queued도 '나갔을 수 있음'으로 본다.
- 소비처: agency-send-cancel.ts:92-123: queueOnly로 취소하고, alreadySent이면서 campaignMayHaveSent이면 되돌린 뒤 ALREADY_SENT를 응답. agency-send-worker.ts:1323-1331: 대조가 cancelled 접수의 live 캠페인을 매 tick 다시 중화. campaign-lifecycle.ts:262-270: 기존 의무를 덮어쓰지 않음(첫 의무가 이미 소진·해제됐으면 새 L건으로 기록). direct-send-worker.ts:87-90: 재시도도 같은 CANCEL 누적 목표라 추가 0원. direct-send-worker.ts:641-656: fin UPDATE는 status != 'cancelled' 조건이라 정상 종결되고 settle(keepCount)을 타지 않음. mysql-refund-sweeper.ts:305-306: processed가 적재 기록(E+L)이거나 0이어서 notLoaded=0.

## F11 [high·data] 여정 알림톡(KAKAO 축) 발송의 실패분이 선불에서 영구히 환불되지 않고, 해당 step 캠페인마다 '초과환불 잔존' 거짓 경보가 난다

- 위치: `packages/backend/src/utils/journey-executor.ts:1025` · 출처: flow:F3-kakao · 등재: BUGS.md 미등재(grep '여정.*환불' 0건).
- 시나리오: 선불 고객사의 여정 알림톡 step이 하루 1,000명에게 나가고 150명이 카카오 실패(7xxx, 대체 N 또는 대체도 실패)한다. 차감은 큐 적재 직후 1건씩 reference_type='journey', reference_id=journey_id로 기록된다. 반면 결과 정산 쪽은 전부 reference_type='campaign'·reference_id=캠페인ID로 원장을 찾는다. 그래서 150×cost_per_kakao가 매일 돌아오지 않는다(여정 SMS step도 같다). sweeper는 이 step 캠페인(status 'sending')을 매번 후보로 집는다. 차감 원장 0건으로 불변식 gap=−성공수가 되어, 성공 2건 이상인 step 캠페인마다 '환불 불변식 위반 — 초과환불 잔존' 경보를 보낸다.
- 근거: journey-executor.ts:1025 `const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, exec.journey_id, exec.created_by || undefined, 'journey');` / journey-step-campaign.ts:85 step 캠페인 `status 'sending'`, message_type LMS / mysql-refund-sweeper.ts:261-265 `WHERE ... reference_type = 'campaign' AND reference_id = $2` / refund-calc.ts:67 차감 0이면 `cappedFail = Math.min(0, fail) = 0` / refund-calc.ts:98 `return (deducted + free) - (success + netRefunded + freeLost);` → −success.
- 소비처: prepaidRefund를 부르는 전 파일을 grep했다(routes/campaigns.ts, spam-filter.ts, auto-campaign-worker.ts, brand-message.ts, campaign-lifecycle.ts, copy-label-sweeper.ts, direct-send-core.ts, direct-send-worker.ts, mysql-refund-sweeper.ts). 'journey' reference_type으로 환불하는 호출은 0건이다. campaign-lifecycle.ts:544·673의 FAIL 환불도 reference 'campaign'이라 prepaid.ts:326·390에서 차감 0 → 환불 0이다. campaign-sync-worker.ts는 여정 완료 알림만 하고 환불하지 않는다.

## F12 [high·data] 카카오 실패 대체발송(k_oriseq 자식행)의 부모 실패가 즉시 FAIL 환불되고 30분 뒤에야 회수되며, 대체분은 부모 채널 단가(BRAND·KAKAO)로 남는다

- 위치: `packages/backend/src/utils/mysql-refund-sweeper.ts:311` · 출처: flow:F3-kakao · 등재: BUGS.md 미등재(웹 선불 축). 관련: DECISIONS D81(대체분=문자 단가), B-0904-5(에이전트 RSRM 축만 정정), B-0727-2 ⓐ(다른 원인의 '30분 reverse까지 일시 초과'를 수용한 기록).
- 시나리오: 예1(알림톡): 선불 알림톡 10만 건, 기본 전환 'L'. 2만 건이 카카오 실패(7xxx)해 에이전트가 같은 app_etc1로 LMS 자식행(1000)을 만든다. sweeper의 'all' 집계는 fail=20,000(부모)·success=100,000(80,000 K + 20,000 L)이다. processed=120,000>차감이라 미적재는 0이다. FAIL 항아리로 min(차감, 20,000)=20,000건×단가가 30초 안에 환불되는데, 그 2만 명은 LMS를 이미 받았다. 초과분은 prepaidReverseOverRefund가 '캠페인 전체 대기 0 + 발송 기준 30분 경과' 뒤에야 회수한다. 분할·예약 대량이면 수 시간 동안 잔액이 부풀고, 고객이 그 잔액으로 다시 발송하면 회수가 하한 없이 차감되어(prepaid.ts:516) 잔액이 음수가 된다. 예2(브랜드): 직접발송 kakao 채널은 기본 'SM' 대체(direct-send-processor.ts:188)다. 1만 건 중 비친구 3,000건이 실패해 SMS 대체로 나가면, 선불은 수렴 후에도 1만×BRAND 단가만 남는다. D81(대체분=SMS·LMS 단가)과 후불 청구(L/S 자식행=문자 단가)는 7,000×BRAND + 3,000×SMS다. /brand-send의 LMS 대체(LM)는 BRAND<LMS라 회사가 덜 받고, SMS 대체는 고객이 더 낸다. 여정 알림톡의 LMS 대체는 KAKAO 단가로 나간다.
- 근거: qtmsg-manual.txt:252-254 'Agent주관의 경우에는 카톡과 다른 DB record로서 6(SMS) 또는 1000(LMS/MMS)로 입력된다. 해당 record에 원래 카톡문자 순번값은 k_oriseq에 저장' / results.ts:637 '대체발송 성공분은 k_oriseq>0 행으로 같은 집계에 잡힌다' / sms-queue.ts:517-526 scope 'all'은 app_etc1 전 행을 센다(부모·자식 구분 없음) / refund-calc.ts:63-67 `const processed = Math.max(sent, success + fail + pending);` `const cappedFail = Math.min(deducted, fail);` / mysql-refund-sweeper.ts:337 `if (axisPending === 0 && (axisSuccess + axisFail) > 0 && ageMs > 30 * 60 * 1000)` / prepaid.ts:516-517 `UPDATE companies SET balance = balance - $1` (하한 없음) / brand-message.ts:1929 전 수신자 BRAND 차감.
- 소비처: sms-result-map.ts:272-279 classifyMsgChannel과 stats-aggregation.ts:376-393은 대체분(substitute_lms/sms)을 화면·엑셀에서만 나눈다. 환불·차감 경로(mysql-refund-sweeper.ts:238-241, direct-send-worker.ts:201-211 countCampaignRows)는 k_oriseq로 거르지 않는다. send-usage-aggregation.ts:760-769 후불 청구는 msg_type별(L/S→문자 단가)로 매겨 D81과 일치하지만 선불 축에는 대체분을 문자 단가로 차감하는 경로가 없다(grep 'substitute'·'k_oriseq' 결과 차감 호출 0건). reverse는 prepaid.ts:509-527에서 차감−성공−대기로 수렴은 한다.

## F13 [high·speed] 클릭 0건 캠페인과 채널 성과 교차 덮어쓰기 때문에 학습 누적이 30초마다 24시간 동안 반복된다

- 위치: `packages/backend/src/utils/mysql-refund-sweeper.ts:576` · 출처: sweep:S-D-workers · 등재: BUGS.md에 미등재. 591-592행 D216+ 주석이 channel_performance 반복을 고쳤다고 적었지만, 클릭 0 경로와 교차 덮어쓰기 경로는 남아 있다.
- 시나리오: 완료 캠페인의 클릭이 0건이면(링크 없는 문자, 발송 직후 등) recordCampaignLearning이 shouldRecordCampaignLearning=false로 아무것도 쓰지 않고 return한다. ai_company_memory 행이 없으니 NOT EXISTS가 계속 참이고, 이 캠페인은 24시간 동안 30초마다(하루 2,880회) 후보로 다시 뽑힌다. 뽑힐 때마다 SELECT 목록의 상관 서브쿼리가 그 회사의 message_click 이벤트를 기간 제한 없이 전부 훑어 COUNT한다. campaign_id는 JSON 속성 필터라 인덱스를 못 탄다. 클릭 이벤트가 많은 회사일수록 캠페인 수 × 전 기간 이벤트 스캔이 30초마다 반복된다. 또 같은 회사·같은 채널에 클릭률 10% 미만 캠페인이 둘 있으면, channel_performance 행의 metadata.last_campaign_id를 서로 덮어써 두 캠페인이 매 사이클 다시 후보가 된다. 결과는 30초마다 upsert 2회와 memory_value 뒤집힘이 24시간 이어지는 것이다. 이 작업은 환불 sweep과 같은 runOnce(_running 가드) 안에서 돌기 때문에, 길어지면 다음 30초 환불 사이클이 통째로 skip된다.
- 근거: 576-581행 `COALESCE((SELECT COUNT(*)::int FROM cdp_events e WHERE e.company_id = c.company_id AND e.event_name = 'message_click' AND e.properties->>'campaign_id' = c.id::text), 0) AS click_count` — 기간 조건 없음. 589-600행 `NOT EXISTS (... m.metadata->>'campaign_id' = c.id::text OR m.metadata->>'last_campaign_id' = c.id::text)`. 386행 `const learningRes = await accumulateCampaignLearning();`가 매 runOnce에서 무조건 실행된다.
- 소비처: company-memory.ts:251 `if (!shouldRecordCampaignLearning({...})) return;`, ai-memory-text.ts:37-40 `if (input.clickCount <= 0) return false;` — 클릭 0이면 행을 쓰지 않음. company-memory.ts:285-305: channel_performance memoryKey는 `channel_${channel}` 하나이고 metadata.last_campaign_id만 기록. company-memory.ts:99-103: `ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET ... metadata = ai_company_memory.metadata || EXCLUDED.metadata`라서 last_campaign_id가 덮어써짐. SCHEMA.md:2869: 인덱스는 (company_id, event_name, occurred_at)뿐.

## F14 [high·defect] 최소과금 일괄 발행이 해지 회사와 수동 정산 회사에도 정액 청구서를 만든다

- 위치: `routes/billing.ts:2121` · 출처: sweep:S-B-postpaid-billing · 등재: 미등재(BUGS.md에서 '해지'·최소과금 grep 결과 해당 항목 없음)
- 시나리오: 최소과금 50,000원(공급가)으로 등록된 후불 회사가 8월에 해지된다(admin DELETE /companies/:id → status='terminated'). 이때 company_billing_settings.min_charge_supply는 그대로 남는다. 10/1 운영자가 최소과금 모달에서 9월 [일괄 발행]을 누르면 목록 쿼리가 이 회사를 다시 포함한다. 해지 회사는 사용량이 0이라 '실사용 ≤ 최소과금' 검사를 통과하고, 공급가 50,000원 + VAT 5,000원 = 55,000원 청구서가 새로 생긴다. 이 일은 해지 뒤 매달 반복된다. manual_billing=true 회사(우리 시스템으로 발행하지 않고 사람이 따로 청구하는 회사)도 같은 경로로 정액 청구서가 생겨, 수기 청구와 겹치는 이중 청구가 된다.
- 근거: routes/billing.ts:2121-2125 `SELECT s.company_id, c.company_name FROM company_billing_settings s JOIN companies c ... WHERE s.min_charge_supply IS NOT NULL` — status·manual_billing 조건이 없다. billing-issue.ts:991-1005 issueMinimumChargeBilling은 min_charge_supply와 `billing_type !== 'postpaid'`만 확인하고 c.status·manual_billing은 보지 않는다. billing-issue.ts:1184 `if (usageSupply > minCharge)`에서 사용량 0은 통과한다. 반면 일괄발급은 billing-bulk.ts:141 `.filter((r) => r.manual_billing !== true && r.min_charge_supply == null && r.status !== 'terminated')`로 두 회사를 명시적으로 뺀다.
- 소비처: 프론트 MinimumChargeModal.tsx:80-94 issueAll은 월만 보내고 회사별 제외 장치가 없다. GET /minimum-charge(routes/billing.ts:2061-2071)도 status를 내려주지 않아 화면에서 해지 여부를 알 수 없다. admin.ts:2083-2088 해지 처리는 status만 바꾸고 min_charge_supply를 지우지 않는다. 해지 회사를 막는 방어는 plan 월정액>0(1042)과 고정료 있는 활성 080 매핑(1096) 둘뿐이다. 둘 다 최소과금 회사의 일반적인 상태와 무관해 대부분 그대로 통과한다.

## F15 [high·data] 테스트 발송 환불이 고정 zero-uuid와 TEST 누적 항아리를 쓰기 때문에, 회사별 두 번째 사건부터 환불이 0원이 된다

- 위치: `routes/campaigns.ts:385` · 출처: sweep:S-A-prepaid · 등재: B-0727-2 ⓒ(BUGS.md:1486 '테스트 발송이 고정 zero-uuid를 공유하는 문제는 그대로') — 등재됐지만 코드에 그대로 남아 있음
- 시나리오: 담당자 3명에게 'both' 테스트 발송을 한다. 잔액이 LMS 3건분뿐이라 LMS 차감은 성공하고 BRAND 차감은 실패한다. 보상 환불은 prepaidRefund(3, LMS, TEST_REF, TEST 키, 누적)로 나간다. 이 회사의 첫 사건이면 3건이 환불된다. 두 번째 사건부터는 같은 TEST_REF·TEST 항아리에 이미 3건이 있어 목표 3건 − 기존 3건 = 0원이 되고, ok:true로 돌아오므로 경보도 없다. 그래서 사건마다 LMS 3건 값이 고객 손실로 남는다. 적재 실패 환불(489행)도 같은 구조로, 이 회사가 과거에 환불받은 최대 건수를 넘는 몫만 돌려받는다.
- 근거: campaigns.ts:373 `const TEST_REF = '00000000-0000-0000-0000-000000000000';` · 385 `prepaidRefund(companyId, managerContacts.length, doneType, TEST_REF, ..., 'test', { refundKey: REFUND_KEYS.TEST })` · 489 동일 · prepaid.ts:363-364 `useKeyedPot = ... !!opts.refundKey ...; potAlready = useKeyedPot ? refundedForKey : alreadyRefunded;` · 381-384 누적 목표 − potAlready
- 소비처: prepaid.ts:349-357: 기존 환불을 company+type+reference_type='test'+reference_id=TEST_REF, 즉 회사의 전 기간 테스트 환불로 합산한다. 386-387 `additionalRefund <= 0`이면 `{refunded:0, ok:true}`를 돌려준다. 호출부(386·490)는 ok만 보고 경보를 보내므로 0원 환불은 감지되지 않는다. 캠페인 레코드가 없어 sweeper·재시도 대상도 아니다. campaigns.ts:479-480 주석도 이 구조를 인정한다.

## F16 [high·data] 담당자 브랜드메시지 테스트 행이 app_etc1=사용자ID로 적재되어 후불 테스트 청구 집계와 테스트 결과 화면에서 빠진다

- 위치: `routes/campaigns.ts:458` · 출처: sweep:S-F-spam-test · 등재: docs/2026-09-25-hanjul-source-audit.md S1-H06(BUGS.md 미등재 · 코드 그대로)
- 시나리오: 후불 회사가 kakao 또는 both 채널로 담당자 테스트를 보내면 BRAND 행이 테스트 테이블에 app_etc1=userId로 들어간다. 정산 집계는 테스트분을 app_etc1='test'로만 읽으므로 이 발송은 0원 청구된다. 같은 동작의 선불 회사는 BRAND 단가로 차감되어 결제방식별로 금액이 어긋난다. test-stats 결과 목록에도 나오지 않는다.
- 근거: campaigns.ts:451-458 `await insertBrandQueue([testSendTable], [{ ..., companyId }], testBillId);`(testBillId = userId, :410). sms-queue.ts:1065 `appEtc1 || null, // app_etc1`. send-usage-aggregation.ts:778·:1852 `app_etc1 = 'test' AND app_etc2 = ?`.
- 소비처: send-usage-aggregation.ts:772-787·1852-1863의 테스트 청구는 app_etc1='test' 조건뿐이다. 일반 발송 집계(:749-760)는 회사 라인 테이블 × 발송 ID(selectBillingSendIds) 기준이라 테스트 테이블의 사용자 UUID 행을 잡지 못한다. campaigns.ts:1423 test-stats도 같은 조건이다. 선불 차감은 :379 prepaidDeduct(BRAND)에서 일어난다.

## F17 [high·data] 담당자 테스트 발송 환불이 회사 평생 누적 'test' 항아리와 비교되어, 두 번째 실패부터 환불이 삼켜진다

- 위치: `routes/campaigns.ts:489` · 출처: sweep:S-F-spam-test · 등재: B-0727-2 ⑥·ⓒ('테스트 발송이 고정 zero-uuid를 공유하는 문제는 그대로(요청별 reference 필요)')
- 시나리오: 선불 회사가 both 채널로 담당자 테스트를 보낸다. SMS 축 차감은 성공하고 BRAND 축은 잔액 부족으로 실패해 385행에서 SMS 차감분 회수 환불을 부른다. 이 회사가 과거에 SMS 테스트 환불을 X원 받은 적이 있으면 potAlready=X가 이번 목표(인원×단가) 이상이 되어 additionalRefund≤0, 즉 0원 환불이 된다. 402를 돌려주고 발송도 안 했는데 SMS 차감은 남는다. 적재 실패 환불(489행)도 같아서, 첫 실패만 환불되고 그 뒤 같은 규모 이하의 실패는 누적 환불액에 먹혀 환불되지 않는다.
- 근거: campaigns.ts:373 `const TEST_REF = '00000000-0000-0000-0000-000000000000';`. :385·:489 `prepaidRefund(companyId, axisFail, axis.type, TEST_REF, '테스트 발송 실패 자동 환불', 'test', { refundKey: REFUND_KEYS.TEST })`. prepaid.ts:363-384 `potAlready = useKeyedPot ? refundedForKey : alreadyRefunded`, cumulative 모드는 `targetTotalRefund = requestedRefund`, `additionalRefund = targetTotalRefund - potAlready`.
- 소비처: prepaid.ts:349-357은 기존 환불을 company+reference_type+reference_id(+message_type, refund_key)로 합산한다. TEST_REF가 모든 요청에 공통이라 이 합이 회사 평생 누적이 된다. mode를 넘기지 않아 cumulative로 동작한다(:381-383). 테스트 발송 환불을 보전하는 sweeper는 없다(utils/*refund* grep 0건).

## F18 [high·data] 직접발송 staging(전화번호·이름·변수값)이 발송되지 않은 시도마다 영구히 쌓인다

- 위치: `routes/campaigns.ts:1664` · 출처: flow:F2-direct-send · 등재: 후보 R013(docs/2026-09-25-hanjul-source-audit-candidates.md:23) · BUGS.md 미등재
- 시나리오: 사용자가 [전송하기]를 누르면 확인 창이 뜨기 전에 수신자 5만 행이 staging에 들어간다. 이후 확인 창에서 취소하거나, 잔액 부족 402·발신 인증 중단·알림톡 템플릿 거절 400·브라우저 종료가 나면 그 5만 행은 지울 주체가 없어 영구히 남는다. 시도마다 개인정보 행이 누적되고, 용량 문서 실측 기준 이미 233만 행·842MB다.
- 근거: 프론트 DirectSendPanel.tsx:664-716 stageAndConfirm은 확인 창(onSendConfirm) 전에 /direct-send/stage를 반복 호출한다. 이 라우트의 staging 삭제는 워커 종결 한 곳뿐이다(direct-send-worker.ts:694 `DELETE FROM campaign_send_staging WHERE staging_id = $1`). 잔액 부족 시에는 캠페인만 지운다(direct-send-core.ts:157 `DELETE FROM campaigns WHERE id = $1`). docs/FEATURE-INFRA-CAPACITY.md:50 `campaign_send_staging | 842 MB | ... | 2,333,223` · 255 '정리 주기가 있는지 미확인'
- 소비처: 전체 grep 결과 `DELETE FROM campaign_send_staging`는 dm.ts·agency-send-worker.ts·continuous-operator.ts·planner-audience.ts·direct-send-worker.ts에만 있고, 모두 자기 stagingId만 지운다. created_at 기준 정리 작업은 app.ts·workers·services 어디에도 없다.

## F19 [high·defect] 대량 직접발송(commit) 경로가 개별 회신번호의 등록 여부를 검사하지 않고 적재한다

- 위치: `routes/campaigns.ts:1779` · 출처: flow:F2-direct-send · 등재: 미등재
- 시나리오: 직접발송 화면에서 엑셀 '매장전화' 열을 개별 회신번호로 고른다. 그중 일부 번호가 발신번호 관리에 없거나 다른 사용자에게 배정된 번호라고 하자. 동기 경로(/direct-send)라면 filterByIndividualCallback이 그 행을 빼고 확인 창을 띄운다. 그런데 실제 직접발송 화면이 쓰는 commit 경로는 그 행까지 차감하고 큐에 싣는다. 결과는 미등록 발신번호로의 발송(발신번호 사전등록제 위반)이고, 통신사가 막으면 받는 사람은 못 받는다. API로는 등록되지 않은 임의 번호를 행마다 넣어 보낼 수도 있다.
- 근거: campaigns.ts:1779 `if (!useIndividualCallback && callback) { ... senderCheck ... }`(개별 모드는 검사 자체를 건너뜀). 1757-1763은 발신 인증 세션만 본다(sender-auth.ts:268 개별이면 SENDER_AUTH_ANY_CALLBACK). direct-send-processor.ts:153 `const recipientCallback = resolveCustomerCallback(r, p.useIndividualCallback, p.callback);` → callback-filter.ts:238-239 `if (useIndividualCallback && customer.callback) return normalizePhone(customer.callback);`. 대조: 동기 경로 campaigns.ts:2169 `const cbResult = await filterByIndividualCallback(validRecipients, companyId, cbUserId);` 뒤 2177 확인 모달.
- 소비처: direct-send-core.ts:6 계약 주석에 '검증(라인그룹·회신번호 등록·알림톡 게이트)은 호출부(commit/autosend)가 선행한다'고 적혀 있다. 워커·프로세서·bulkInsertSmsQueue(sms-queue.ts:1382-1462)에는 등록 검사가 없다. 대행발송은 agency-send-worker.ts:1067-1083에서 스스로 재검증한다. 프론트 DirectSendPanel.tsx:614는 빈 값만 막고, 678은 열 값을 그대로 staging callback에 싣는다. Dashboard.tsx:624-655 commitBody에는 confirmCallbackExclusion도 없다.

## F20 [high·defect] 동기 /direct-send 경로에 야간 광고 발송 차단(D-2)이 없다

- 위치: `routes/campaigns.ts:2021` · 출처: flow:F2-direct-send · 등재: 미등재
- 시나리오: KST 22:30에 직접타겟발송(Dashboard executeTargetSend) 또는 AI 운영자 승인 발송에서 광고 체크를 켜고 즉시 발송한다(또는 23:00 예약). commit 경로라면 NIGHT_AD_RESTRICTED 400으로 막히는 요청인데, 여기서는 그대로 차감·적재·발송된다. 21시~08시 광고 전송이 수신자에게 도달한다(정보통신망법 야간 광고 제한 위반 발송).
- 근거: campaigns.ts:2021 `const finalIsAd = adEnabled === true;`. 예약은 2048 `validateScheduledAt(scheduledAt, { allowNull: false })`(과거·미래만 검사)뿐이다. 1892-2551 사이에 isSendableHourKst/SEND_HOURS 판정이 없다(grep: campaigns.ts의 SEND_HOURS는 import와 주석뿐). direct-send-core.ts:86-98 게이트 주석은 '직접발송·DM 발송·자율발송 공통 길목(1곳 = 전 경로)'이라고 적지만, 이 라우트는 createDirectSendCampaign을 지나지 않는다.
- 소비처: Dashboard.tsx:786-805가 `adEnabled: isTargetAlimtalk ? false : adTextEnabled`로 /direct-send를 부르고, AiOperatorPage.tsx:692도 같은 라우트를 부른다. 프론트(Dashboard·DirectSendPanel)에서 야간 판정은 grep 0건이다. campaign-validation.ts:43-83 validateScheduledAt에도 시간대 검사가 없다.

## F21 [high·speed] 예약 수신자 목록이 페이지마다 캠페인 전 대기 행(본문 포함)을 임시테이블로 실체화

- 위치: `routes/campaigns.ts:3007` · 출처: sweep:S-E-mysql-queue · 등재: 미등재
- 시나리오: 8만 건 LMS 예약 캠페인을 예약 모달에서 클릭하거나 스크롤해 다음 50건을 볼 때마다 smsSelectAll이 `SELECT * FROM (UNION ALL 16개 라이브) _u ORDER BY idx LIMIT 50 OFFSET n`을 실행한다. 이 형태는 일치하는 8만 행과 msg_contents 전체를 임시테이블에 모은 뒤 정렬한다. 같은 패턴을 관리자 상세에서 페이지당 10초 넘게 걸린다고 실측해 smsSelectPagedAll로 고쳤는데 사용자 화면은 그대로다. 요청마다 MySQL 공용 풀(10개, 발송 INSERT와 공유)의 연결 하나를 10초 넘게 붙잡는다.
- 근거: campaigns.ts:3007-3012 `smsSelectAll(recipientTables, 'seqno as idx, dest_no as phone, call_back as callback, msg_contents as message', `app_etc1 = ? AND status_code = 100${searchCondition}`, searchParams, `ORDER BY seqno LIMIT ${limit} OFFSET ${offset}`)`. sms-queue.ts:398 `const sql = safeSuffix ? `SELECT * FROM (${unions}) AS _u ${safeSuffix}` : unions;`. admin.ts:3464-3466 주석: 기존 smsSelectAll은 8만 행과 LMS 본문을 임시테이블로 실체화한 뒤 정렬해 페이지당 수 초가 걸렸다(에이치피오 87,049 예약 상세 10초 이상).
- 소비처: 프론트 ScheduledCampaignModal.tsx:86(캠페인 클릭), 203(검색), 273(더 보기 offset 증가)이 매번 이 엔드포인트를 부른다. admin.ts:3467은 smsSelectPagedAll로 이미 전환됐다. 3112(비예약 분기)도 같은 호출이지만 대기 행이 적어 영향이 작다.

## F22 [high·defect] C-05 수신자 삭제 환불이 적재 중 캠페인에서 '아직 안 들어간 행' 전부를 환불

- 위치: `routes/campaigns.ts:3198` · 출처: sweep:S-E-mysql-queue · 등재: C-05 수정이 새로 만든 결함 (C-05·A-04와 인접, 미등재)
- 시나리오: 직접발송 워커가 50만 건 예약을 적재하는 중(status='scheduled', send_phase='processing', 10만 건 적재)에 사용자가 예약 모달에서 수신자 1명을 삭제하는 경우. kept = 현재 대기 10만 − 1이므로 prepaidRefund(keepCount)의 목표가 '차감 50만 − 10만 + 1'이 되고, 약 40만 건분 금액이 NOT_LOADED로 즉시 환불된다. 워커는 나머지 40만 건을 계속 적재하고 예약 시각에 모두 발송한다. 고객사는 실제로 나간 40만 건 값을 돌려받아 그 잔액으로 다른 발송을 할 수 있다. 선불 sweeper가 발송이 끝나고 대기 0 + 30분이 지난 뒤에야 초과분을 회수하며, 그때 잔액이 음수로 갈 수 있다. 타임아웃 환불이 있거나 원장 해석에 실패하면 회수 자체가 건너뛰어진다.
- 근거: campaigns.ts:3143-3146 `... AND status = 'scheduled'`(send_phase 확인 없음) → 3198-3204 `const axisWaiting = await smsCountAll(delTables, `app_etc1 = ? AND status_code = 100${scopeWhere}`, [campaignId]); ... const kept = Math.max(0, axisWaiting - axisPhone); await prepaidRefund(companyId, 0, axis.type, campaignId, ..., { refundKey: REFUND_KEYS.NOT_LOADED, keepCount: kept });`. prepaid.ts:375-377: 환불 건수 = 차감 + 무료 − keepCount.
- 소비처: direct-send-worker.ts:598-605의 종결 미적재 환불은 NOT_LOADED 항아리 누적과 비교하므로 이미 넘친 항아리에 추가하지도 되돌리지도 않는다. mysql-refund-sweeper.ts:337-341 prepaidReverseOverRefund는 `axisPending === 0 && (s+f) > 0 && age > 30분`일 때만 회수하고, prepaid.ts:504-507은 타임아웃 환불이 있으면 skip한다. campaigns.ts:3227-3233은 target_count도 현재 대기 수로 덮는다. 적재 중 수신자 목록은 GET /:id/recipients(3007)가 적재된 행으로 보여 주므로 삭제가 가능하다.

## F23 [high·data] C-05 신규 부작용: 직접발송 워커가 예약 캠페인을 적재하는 도중에 수신자를 삭제하면, 아직 적재되지 않은 수십만 건까지 환불된다

- 위치: `routes/campaigns.ts:3201` · 출처: sweep:S-A-prepaid · 등재: 미등재(C-05 수정이 만든 신규 결함 · A-02(적재 전 excluded_phones 경로)와는 다른 분기)
- 시나리오: 선불 회사가 10만 건 예약 직접발송을 접수했다. 캠페인은 INSERT 때부터 status='scheduled'다. 워커가 1만 건씩 적재해 3만 건을 넣은 시점에 사용자가 예약 모달에서 수신자 1명을 삭제한다. 대기 행은 3만 건이므로 kept=29,999로 계산된다. keepCount 목표는 '차감 10만 − 29,999 = 70,001건'이 되어 약 70,001×단가가 즉시 환불된다(LMS 26.4원이면 약 185만 원). 워커는 나머지 7만 건을 계속 적재하고, 이 7만 건은 예약 시각에 모두 발송된다. 고객은 나갈 문자 7만 건 값을 잔액으로 돌려받아 다른 발송에 쓸 수 있다. 되돌리는 경로는 발송 뒤 대기 0 + 30분 경과 시점의 sweeper 회수뿐이다. 그 사이 잔액을 써 버렸다면 회수 후 잔액이 음수(미수)가 된다.
- 근거: campaigns.ts:3144 `... AND status = 'scheduled'` 외에는 send_phase 검사가 없다. · 3198-3204 `const axisWaiting = await smsCountAll(... status_code = 100 ...)` → `const kept = Math.max(0, axisWaiting - axisPhone);` → `prepaidRefund(companyId, 0, axis.type, campaignId, ..., { refundKey: REFUND_KEYS.NOT_LOADED, keepCount: kept })` · prepaid.ts:375-379 `keepRefundCount = Math.min(ledger.deductedCount, Math.max(0, ledger.deductedCount + ledger.freeCount - ...keepCount))` · direct-send-spec.ts:105 `spec.scheduled ? 'scheduled' : 'sending'`
- 소비처: direct-send-worker.ts:483-558: 적재는 CHUNK(1만) 단위 루프이고 status를 건드리지 않는다. 종결(641-656)에서 fin UPDATE가 성공하면 NOT_LOADED 환불 대상은 total−sent(적재 완료면 0)라서 과환불을 되돌리지 않는다. mysql-refund-sweeper.ts:337-341: prepaidReverseOverRefund는 axisPending===0 && 30분 경과 뒤에만 초과분을 회수한다. prepaid.ts:516-519: 회수 UPDATE에 잔액 하한이 없어 음수가 될 수 있다. ScheduledCampaignModal.tsx:324에 실제 삭제 UI가 있다. C-05 주석(3169-3170)은 에이전트 픽업과의 겹침만 검토했고 워커 적재 중인 경우는 다루지 않는다.

## F24 [high·defect] 예약 문안 수정이 직접발송 워커의 적재 전·적재 중 캠페인에 반영되지 않아 옛 문안이 발송됨

- 위치: `routes/campaigns.ts:3379` · 출처: sweep:S-E-mysql-queue · 등재: 미등재 (A-02는 수신자 삭제의 적재 전 경로만 다룸)
- 시나리오: 대시보드 직접발송(commit → staging → direct-send-worker)으로 대량 예약을 건 직후, 적재가 끝나기 전에(send_phase preparing·queued·processing, status='scheduled') 예약 모달에서 문안을 고치는 경우. ①큐에 아직 한 행도 없으면 PG의 message_content만 바꾸고 '문안이 수정되었습니다 (발송 시 적용)'이라고 응답한다. 하지만 워커는 선점할 때 읽어 둔 send_config.message로 적재하므로 전원이 옛 문안을 받는다. ②일부만 적재됐으면 적재된 행만 새 문안으로 바뀌고 나머지 청크는 옛 문안으로 들어가 수신자 일부가 옛 문안을 받는다(오발송). /reschedule도 같은 뿌리로 나머지 청크를 옛 시각(cfg.scheduledAt)에 넣는다(화면 호출은 0건).
- 근거: campaigns.ts:3327-3330 `... AND status = 'scheduled'`(send_phase 가드 없음) → 3379-3386 `if (recipients.length === 0) { await query(`UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3 ...`); return res.json({ success: true, message: '문안이 수정되었습니다 (발송 시 적용)' }); }`. direct-send-worker.ts:394 `const cfg: any = c.send_config || {};`(선점 때 한 번 읽음), 541 `message: cfg.message || '', subject: cfg.subject || ''`. 청크마다 send_config를 다시 읽지 않는다.
- 소비처: 프론트 ScheduledCampaignModal.tsx:551이 PUT /api/campaigns/:id/message를 호출한다(문안 수정 창). direct-send-spec.ts:105는 예약 직접발송을 status 'scheduled'로 만든다. direct-send-worker.ts:384·558을 보면 적재 중에도 status는 그대로 'scheduled'다. campaigns.ts 전체에 send_phase 검사는 1871(진행률 조회)뿐이다.

## F25 [high·defect] 결제 콜백 재전송 시 상태를 확인하지 않고 재승인한 뒤 망취소해서, 이미 충전된 결제의 카드 대금만 취소될 수 있다

- 위치: `routes/payments.ts:167` · 출처: chunk:s1-01 · 등재: A-03(B-0902-2, 콜백이 pending을 failed로 뒤집음)과 뿌리가 인접하지만, completed 결제의 망취소 재전송 경로는 미등재(BUGS.md에서 망취소·netCancel 검색 0건)
- 시나리오: 고객사가 10만원을 카드 결제한다. 첫 /inicis/return 요청에서 승인이 되고 payments가 completed로 바뀌며 잔액이 +100,000원 된다. 같은 콜백 본문(resultCode 0000, authToken, authUrl, netCancelUrl, orderNumber)이 한 번 더 POST되면(브라우저 재제출이나 중복 전송, 또는 고객이 자기 결제 폼을 고의로 재전송) 라우트는 결제 상태를 보지 않고 approveInicisPayment를 다시 부른다. 이니시스가 이미 쓴 authToken의 재승인을 거절하면 success=false 분기로 가서 같은 authToken으로 netCancelInicisPayment를 호출해 승인 거래를 망취소한다. finalizePaymentFailure는 status='pending' 행만 바꾸므로 completed 결제와 잔액 +100,000원은 그대로 남는다. 그러면 회사는 10만원을 못 받고 고객 잔액만 늘어난다. 재승인 거절과 망취소 수락은 이니시스의 동작이라 코드만으로는 확정할 수 없는 조건부 시나리오다.
- 근거: payments.ts:167-173 `const approval = await approveInicisPayment(callback); if (!approval.success) { if (callback.netCancelUrl) { await netCancelInicisPayment(callback.netCancelUrl, callback); } const fail = await finalizePaymentFailure({...` — 그 앞(128-165)에 payments 상태 조회가 없다. payment-processor.ts:253 `WHERE pg_order_id = $5 AND pg_provider = 'inicis' AND status = 'pending'`(completed 결제는 되돌리지 않는다). 멱등 분기인 payment-processor.ts:114 `if (pending.status === 'completed')`는 승인이 성공했을 때만 도달한다.
- 소비처: routes/payments.ts:120-219를 전부 읽었다. orderId 추출 → 결과코드 분기 → approve → netCancel/finalize 순서이고 중복 여부를 먼저 거르는 곳이 없다. inicis-client.ts:220-310의 approveInicisPayment는 mid와 authUrl 호스트만 검사하고 `json.resultCode === '0000'`일 때만 success로 본다. inicis-client.ts:313-318의 netCancelInicisPayment는 호스트만 검사한다. C-14(호스트 검사)는 이니시스 주소만 강제할 뿐 재전송은 막지 못한다.

## F26 [high·data] 발송결과 상세·발송내역·엑셀이 '지금 기준 당월·전월' LOG만 봐서 지난달 이전 캠페인은 0건

- 위치: `routes/results.ts:718` · 출처: sweep:S-E-mysql-queue · 등재: 미등재 (B-0914-1 '범위 밖' 기록에 results.ts 상세 3경로 합집합 스캔 메모만 있음)
- 시나리오: 7/20에 발송한 캠페인(QTmsg 라인 1~11 → SMSQ_SEND_N_202607로 이관)을 9/26에 발송결과 화면에서 기간을 7월로 두고 열면, 목록·요약 카운트는 sentTables 경로와 PG 캐시로 정상 표시된다(예: 성공 10,000). 그런데 수신자별 발송내역(/messages)은 0건이고 CSV 다운로드(/export, 슈퍼관리자 export 포함)는 헤더만 나온다. 실패사유·통신사 분포(/campaigns/:id)도 비어 나온다. 매달 1일이 지날 때마다 '전전월 이전' 캠페인이 전부 이렇게 된다. 고객사는 과거 발송의 수신자별 증빙을 받을 수 없다.
- 근거: sms-queue.ts:863-876 `const ym = now...; const prevYm = ...; for (const suffix of [ym, prevYm]) { const logTable = `${live}_${suffix}`; ...}`. results.ts:718 `const msgTables = await getCompanySmsTablesWithLogs(companyId, userId);`, 980 export 동일, 560 차트 동일. campaign-sms-export.ts:72 동일. sms-queue.ts:623-625 주석은 '캠페인 조회는 그 기간이면 충분하다'고 가정한다.
- 소비처: 프론트 ResultsModal.tsx:471-483 기간 입력(type=date)에 min 제한이 없다. 249에서 /messages, 268에서 /export를 호출한다. 목록·요약 카운트는 stats-aggregation.ts:271-287 resolveCampaignTableGroups(기록 라인의 전 LOG)와 PG result_final을 써서 정상이므로 화면끼리 숫자가 어긋난다. admin 상세(admin.ts:3428)만 getCampaignSmsTables(발송월 ±1)를 쓴다.

## F27 [high·data] 발송내역 조회(/campaigns/:id/messages)가 캠페인 소유를 확인하지 않아 다른 고객사의 수신번호·본문을 읽을 수 있다

- 위치: `routes/results.ts:724` · 출처: flow:F6-result-sync · 등재: 미등재
- 시나리오: A사 사용자가 B사 캠페인 UUID를 알면(공유 화면·로그·전 직원 등) GET /api/v1/results/campaigns/<B사 UUID>/messages?page=1&limit=100을 호출할 수 있다. PG 조회(c.company_id=A)가 0행이어도 404를 내지 않는다. sendChannel이 기본값 'sms'로 잡혀 그대로 진행된다. A사 조회 합집합(getCompanySmsTablesWithLogs)에는 시스템 전체의 활성 bulk·bito 라인과 그 LOG가 들어 있고 WHERE는 app_etc1=?뿐이다. 그래서 B사 캠페인의 dest_no(수신번호)·call_back·msg_contents·결과가 페이지 단위로 반환되고 total도 함께 나온다. 같은 파일의 상세(:576)와 엑셀(:957)은 404로 막는데 이 경로만 빠져 있다.
- 근거: results.ts:724-731 `const campResult = await query(... WHERE c.id = $1 AND c.company_id = $2`, [id, companyId]);` :731 `const sendChannel = campResult.rows[0]?.send_channel || 'sms';`에 rows.length===0 검사가 없다. :747 `let smsWhere = 'WHERE app_etc1 = ?';` :770-775 msgTables 전체에 UNION을 건다. sms-queue.ts:827 `const allBulk = await getAllBulkSmsTables();` :834 `const allBito = await getBitoSmsTables();`는 타사 라인까지 합집합에 넣는다.
- 소비처: app.ts:455 `app.use('/api/v1/results', resultsRoutes)`와 results.ts:88 `router.use(authenticate)`만 있고 소유 검사 미들웨어는 없다. 같은 라우터의 /campaigns/:id(:574-578)와 /campaigns/:id/export(:953-957)는 404로 막는다. Redis 카운트 캐시 키도 요청 회사 기준(:787)이라 방어가 되지 않는다. id가 UUID 형식이어야 PG 캐스트 오류가 나지 않는다는 점이 유일한 조건이다.

## F28 [high·speed] 발송내역 CSV가 1만 건 청크마다 캠페인 전체 UNION을 다시 실체화·정렬(O(N²/청크))

- 위치: `routes/results.ts:1015` · 출처: sweep:S-E-mysql-queue · 등재: 미등재
- 시나리오: 30만 건 캠페인의 발송내역을 엑셀로 받으면 30번의 청크 쿼리가 나간다. 청크마다 `(SELECT … msg_contents … WHERE app_etc1=?) UNION ALL …(약 37개 테이블) ORDER BY sendreq_time, dest_no LIMIT 10000 OFFSET k`를 실행해, 매번 30만 행과 본문 전체를 임시테이블에 모아 정렬한다. 8만 건 기준 실측(페이지당 10초 이상)을 적용하면 8만 건 export도 90초 이상 걸리고, 그동안 MySQL 공용 풀 연결 하나를 연속으로 점유한다. 동시 export가 몇 건만 겹쳐도 발송 적재가 풀을 기다린다. 진행 중 캠페인이면 LIVE→LOG 이동 때문에 OFFSET 청크 사이에서 행이 중복되거나 빠진다.
- 근거: results.ts:982-985 `subqueries.push(`(SELECT ${smsFields} FROM ${t} WHERE app_etc1 = ?${smsStatusWhere})`)`(내부 LIMIT 없음) → 1015-1018 `${baseSql} ORDER BY sendreq_time ASC, dest_no ASC LIMIT ? OFFSET ?`를 while 루프에서 chunkOffset += rows.length로 반복. campaign-sms-export.ts:73-99도 동일(슈퍼관리자 export). 같은 파일의 /messages(769-775)는 테이블별 내부 LIMIT로 이미 고쳐져 있다.
- 소비처: 프론트 ResultsModal.tsx:268이 /api/v1/results/campaigns/:id/export를 호출한다. admin.ts:3528이 streamCampaignSmsCsv를 호출한다. 병목 원인(UNION + 외부 ORDER BY = 전량 임시테이블)은 sms-queue.ts:403-411 주석과 admin.ts:3464-3466 실측에 적혀 있다.

## F29 [high·defect] 테스트폰 앱 인증 토큰에 소스에 박힌 기본값이 있어, 환경변수가 없으면 누구나 테스트폰을 등록하고 결과를 위조할 수 있다

- 위치: `routes/spam-filter.ts:23` · 출처: sweep:S-F-spam-test · 등재: docs/2026-09-25-hanjul-source-audit.md S1-H09(BUGS.md 미등재 · 운영 ENV 설정 여부 미확인)
- 시나리오: 운영 ENV에 SPAM_APP_TOKEN이 없으면(설정 여부는 확인하지 못함) 외부인이 소스의 기본 토큰으로 POST /api/spam-filter/devices에 자기 번호를 등록할 수 있다(is_active=true로 UPSERT). 그 뒤 모든 고객사의 수동·자동 스팸 검사가 그 번호로도 발송된다. 문안은 해당 회사 첫 고객의 이름·항목으로 치환되므로 다른 고객사의 고객 데이터가 노출된다. spamSendCount가 기기 수에 비례하므로 선불 회사는 검사마다 1대분을 더 차감당하고, 후불 회사는 결과 행이 늘어 그만큼 더 청구된다. /report로 차단 판정된 검사를 PASS로 위조할 수도 있다.
- 근거: spam-filter.ts:23 `const SPAM_APP_TOKEN = process.env.SPAM_APP_TOKEN || 'spam-hanjul-secret-2026';`. :818-842 /devices는 토큰만 비교한 뒤 `ON CONFLICT (device_id) DO UPDATE SET ... is_active = true`. :145-160 /test는 `WHERE is_active = true`인 기기 전부로 발송하고 `spamSendCount = devices.rows.length * messageTypes.length`로 차감 건수를 정한다.
- 소비처: app.ts:403 `app.use('/api/spam-filter', spamFilterRoutes)`는 인증 미들웨어 없이 마운트되어 있고, /report·/devices는 토큰 비교만 한다. spam-test-queue.ts:159-172 자동 검사도 is_active 기기 전부를 대상으로 삼는다. .env를 제외한 저장소에서 SPAM_APP_TOKEN 설정 흔적은 spam-filter.ts와 감사 문서뿐이다(grep).

## F30 [high·data] 유료 스팸 검사가 테스트 문자 적재에 실패해도 선불 차감을 되돌리지 않는다(수동 경로와 큐 경로 모두)

- 위치: `routes/spam-filter.ts:213` · 출처: sweep:S-F-spam-test · 등재: B-0925-4(수동 경로만 등재 · spam-test-queue 큐 경로는 미등재)
- 시나리오: 선불 회사가 스팸 검사를 하면 prepaidDeduct가 기기 3대 × 단가를 차감한다. 그다음 insertTestSmsQueue가 MySQL 오류(예: B-0925-1의 ETIMEDOUT)로 예외를 던지면 바깥 catch는 500만 돌려주고 환불하지 않는다. 한 통도 안 나갔는데 차감이 남고, 사용자가 다시 시도할 때마다 또 차감된다. 후불은 루프가 먼저 넣은 결과 행 1개가 stale 정리로 timeout이 되어 1건이 청구된다. 큐 경로(여정 runStepSpamTest, skipPrepaid:false)도 같다. enqueue 때 차감하고, executeSpamTest가 적재 중 예외를 만나면 completed만 기록할 뿐 환불하지 않는다. 이 경우 결과 행이 NULL이라 후불에는 청구되지 않고 선불만 부담한다.
- 근거: spam-filter.ts:213 `const spamDeduct = await prepaidDeduct(companyId, spamSendCount, spamDeductType, testId, userId, 'spam');`. :263-270 `} catch (sendErr) { if (trialMode && sentCount === 0) { ... } throw sendErr; }`는 체험만 되돌린다. :8 prepaidRefund는 import만 하고 쓰지 않는다. spam-test-queue.ts:201에서 차감하고, :494-500 catch는 `UPDATE spam_filter_tests SET status = 'completed'`만 한다.
- 소비처: spam 참조로 환불하는 prepaidRefund 호출은 저장소에 0건이다(grep). 환불 sweeper(utils/*refund*)에도 'spam'·'test'·spam_filter 참조가 없다(grep 0건). 그래서 다른 경로가 보전하지 않는다. send-usage-aggregation.ts:1872의 후불 집계는 result NOT NULL 기준이다.

## F31 [high·data] 적재 중에 대행 취소를 하면 적재가 멈추지 않고, 뒤 조각은 CANCEL 항아리 누적 목표에 삼켜져 환불이 모자란다

- 위치: `utils/agency-send-cancel.ts:92` · 출처: flow:F5-agency-send · 등재: 미등재(A-04 환불 목표 혼재와 인접하지만, 원인은 queueOnly 취소가 캠페인 상태를 바꾸지 않아 C-10 감지·정산이 대행 경로에서 돌지 않는 것)
- 시나리오: 대행발송 30만 건(LMS 30원)이 예약되고, 직접발송 워커가 1만 건씩 적재한다. 10만 건이 적재된 시점에 담당자가 취소한다. cancelCampaign(queueOnly)는 대기 10만 건을 지우고 CANCEL 항아리로 10만 건을 환불하지만, 캠페인 status는 'scheduled' 그대로다. 접수는 cancelled로 확정된다. 직접발송 워커의 취소 감지는 status='cancelled'만 보므로 나머지 20만 건을 계속 적재하고, fin에서 status='scheduled'·send_phase='sent'로 끝낸다. 전량 적재라 미적재 환불은 0이고, C-10 취소 정산(keepCount)도 타지 않는다. 다음 대조 tick의 neutralizeCampaign이 cancelCampaign을 다시 불러 20만 건을 지운다. 이때 refundPendingCancel은 기존 의무(10만)를 덮지 않고, prepaidRefund(20만, CANCEL, forceKeyedPot)는 항아리 누적 목표 20만에서 기존 10만을 뺀 10만 건만 추가로 환불한다. 결과는 차감 30만·환불 20만·발송 0이다. 고객사가 10만×30원=300만원을 더 낸다. 예약 시각 뒤 cleanupScheduledCampaigns가 sent_count=0·failed로 덮고, sweeper는 처리수 0이면 미적재를 0으로 보며, 불변식 경보는 성공+실패>0일 때만 울린다. 그래서 영구 미환불이고 경보도 없다. 대조 tick이 늦어져 예약 시각 전에 못 돌면, 취소 뒤에 적재된 조각이 그대로 발송된다.
- 근거: agency-send-cancel.ts:92-96 `cancelCampaign(campaignId, opts.companyId, { ... queueOnly: true })`. campaign-lifecycle.ts:381-388 queueOnly는 상태 UPDATE(:394) 전에 반환한다. direct-send-worker.ts:490-491 `if (cancelCheck.rows[0]?.status === 'cancelled') { ... break; }`. campaign-lifecycle.ts:266-268 기존 refundPendingCancel 보존. :347-351 `prepaidRefund(companyId, cancelCount, ..., { refundKey: REFUND_KEYS.CANCEL, forceKeyedPot: true })`. prepaid.ts:363-364 `useKeyedPot ... potAlready = useKeyedPot ? refundedForKey`, :384 `additionalRefund = targetTotalRefund - potAlready`.
- 소비처: agency-send-worker.ts:1323-1325 대조는 mustNotSend+live이면 neutralizeCampaign을 부른다. agency-send-campaign.ts:107-109 이 경로도 queueOnly라 status가 cancelled가 되지 않는다. direct-send-worker.ts:641-656 fin은 `status != 'cancelled'`라 성공하고, :657-683 취소 정산 분기에 들어가지 않는다. direct-send-worker.ts:42-98 retryPendingCancelRefunds도 같은 CANCEL 항아리 누적 목표라 모자란 몫을 채우지 못한다. campaign-lifecycle.ts:67-87 cleanup은 sent_count를 MySQL 실측 0으로 덮고, refund-calc.ts:63-64 `notLoaded = processed > 0 ? ... : 0`이다. mysql-refund-sweeper.ts:336 불변식 감시는 `(axisSuccess + axisFail) > 0`일 때만 돈다.

## F32 [high·defect] 적재 전(send_phase='queued') 대행 예약을 취소하면 '이미 발송이 끝났다'며 거절하고, 예약은 그대로 나간다

- 위치: `utils/agency-send-cancel.ts:108` · 출처: flow:F5-agency-send · 등재: 미등재(B-0828-1이 queueOnly·alreadySent를 도입하면서 생긴 부작용 · C-10 수정 범위 밖)
- 시나리오: 고객사 A가 대행발송 5만 건(LMS)을 14:00 예약으로 승인했다. 12:00에 워커가 캠페인을 만들면(send_phase='queued') 접수는 곧바로 'queued'(예약 완료)가 된다. 이때 직접발송 워커는 다른 고객사의 100만 건을 적재하는 중이라(running 가드 · 캠페인 하나를 끝까지 처리한다) A의 캠페인은 queued로 기다린다. 12:03에 A 담당자가 취소를 누른다. cancelCampaign(queueOnly)는 대기 0건·픽업 0건을 보고 alreadySent=true를 돌려준다. 그런데 campaignMayHaveSent는 phase가 'queued'여도 true라서 접수를 queued로 되돌리고 409 「이미 발송이 끝나 취소할 수 없습니다」로 답한다. 실제로는 한 통도 적재되지 않았다. 직접발송 워커가 풀리면 캠페인 status가 'cancelled'가 아니므로 5만 건을 전부 적재하고, 14:00에 고객에게 나가며 5만 건이 과금된다. 담당자는 이미 나갔다고 안내받았으니 다시 취소하지 않는다. 취소 마무리 워커(agency-send-worker.ts:1449)도 같은 판정이라, 남아 있던 cancelling 건을 queued로 되돌려 취소 의사를 버린다. 적재를 막 선점한 processing 초입(정제 DELETE 중 · 첫 청크 전)에서도 같다.
- 근거: agency-send-cancel.ts:108 `if (result.success && result.alreadySent && campaignMayHaveSent(attempt)) {` → :110-121 되돌리고 `code: 'ALREADY_SENT', error: '이미 발송이 끝나 취소할 수 없습니다.'`. agency-send-campaign.ts:80-81 `return !!found.id && found.phase !== 'preparing';`(queued·processing도 true). campaign-lifecycle.ts:384 `alreadySent: totalCancelCount === 0 && alreadyPickedUp === 0`. 테스트 agency-worker-residuals.test.ts:185 `expect(campaignMayHaveSent({ id: 'c', phase: 'queued' })).toBe(true);`가 이 결함을 계약으로 고정하고 있다.
- 소비처: direct-send-worker.ts:286-291 due는 `send_phase = 'queued'`를 전부 집고, :384-386에서 processing으로 선점한 뒤 :483-560에서 적재한다. 적재를 멈추는 조건은 :490-491의 `status === 'cancelled'` 하나인데, queueOnly 취소는 상태를 바꾸지 않는다(campaign-lifecycle.ts:381-388 조기 반환). direct-send-worker.ts:262-264 `if (running) return;` 때문에 앞 캠페인을 적재하는 동안 queued가 계속 대기한다. 대조 워커 D(agency-send-worker.ts:1315)는 cancelled·expired·test_failed만 회수하므로, queued로 되돌아간 접수는 대상이 아니다.

## F33 [high·defect] 스팸 검사 실패·시간 초과를 통과로 읽어, 당일 검사 없이 예약·발송된다

- 위치: `utils/agency-send-worker.ts:370` · 출처: flow:F5-agency-send · 등재: B-0823-1 (가) — 등재됐지만 코드에 그대로 남아 있다
- 시나리오: 발송 2시간 전 재검사(워커 B) 때 스팸 필터 테스트 큐 적재가 실패('failed')하거나 결과 대기가 만료('timeout')된다. runSpamRound는 `!== 'blocked'`이면 passed=true를 돌려준다. finalTestRow는 final_test_at=NOW()를 찍고 곧바로 dispatchToPipeline으로 가, 통신사 검사를 한 번도 통과하지 못한 문안을 전 수신자에게 예약하고 선차감한다. 워커 A도 같은 판정이다. 당일 접수면 여기서 final_test_at이 찍혀 재검사 없이 적재까지 간다. 통신사 차단 문안이면 고객이 못 받고 과금만 남을 수 있다(불변 2 위반).
- 근거: agency-send-worker.ts:369-371 `const v = result.variants[0]; if (v?.spamResult !== 'blocked') { return { passed: true, ... } }`. spam-test-queue.ts:673-675 `spamResult = 'failed'`, :591/:600 `resolve('timeout')`.
- 소비처: agency-send-worker.ts:642-653 passed이면 final_test_at을 찍고 `dispatchToPipeline(target, finalContent, token)`을 부른다. :488-494 워커 A도 passed이면 당일 건에 final_test_at을 찍는다. agency-send-state.ts:420-425 isQueueDue는 final_test_at만 보고 적재로 보낸다. 다른 방어는 없다.

## F34 [high·defect] 달 중간에 선불↔후불을 바꾸면 그 달 청구가 이중 청구되거나 통째로 빠진다

- 위치: `utils/billing-issue.ts:255` · 출처: sweep:S-B-postpaid-billing · 등재: 미등재(BUGS.md에서 billing_type·선불·후불 전환 grep 결과 해당 항목 없음)
- 시나리오: (가) 7/15에 관리자가 선불을 후불로 전환(PATCH /companies/:id/billing-type)한다. 7/1~7/14에 선불로 LMS 10,000건을 보냈다면 건당 25원 기준 250,000원이 잔액에서 이미 빠졌다. 8/1 일괄발급(7/1~7/31)은 지금의 billing_type만 보고 7월 전체 성공분을 집계하므로 같은 10,000건이 후불 청구서에 다시 실린다. 고객은 공급가 250,000원과 VAT를 두 번 낸다. (나) 반대로 7/15에 후불을 선불로 바꾸면 7월 발행이 PREPAID_COMPANY_NOT_BILLABLE로 막히고, listUnbilledPostpaid의 billing_type='postpaid' 조건 때문에 일괄발급 목록에서도 빠진다. 7/1~7/14 후불 발송분은 한 푼도 청구되지 않는다. 에이전트 발송ID의 billing_type을 달 중간에 바꿔도 postpaidSendIds가 발행 시점 값으로 정해지므로 같은 일이 생긴다.
- 근거: billing-issue.ts:255 `if (String(ledger.companyPriceRow?.billing_type) === 'prepaid') { throw ... PREPAID_COMPANY_NOT_BILLABLE` — 발행 시점의 현재 값 하나로만 판정한다. send-usage-aggregation.ts:576-622 selectBillingSendIds는 발송 당시 결제방식을 전혀 보지 않고 기간 안 완료 발송을 전부 담는다(balance_transactions·billing_type 조건 grep 0건). prepaid.ts:121 `if (pre.rows[0].billing_type !== 'prepaid') { ... return { ok: true, amount: 0 } }` — 차감 여부는 발송 시점 값으로 정해진다. admin.ts:3657-3668은 진행·예약 캠페인만 확인하고 `UPDATE companies SET billing_type = $1`을 아무 때나 허용한다. billing-ledger.ts:125 `if (String(r.billing_type) !== 'postpaid') continue;` — 발송ID도 발행 시점 값이다.
- 소비처: billing-bulk.ts:96 listUnbilledPostpaid는 `c.billing_type = 'postpaid'`(현재 값)로 대상을 고른다. filterBillableCompanies와 runBulkJob→issueBilling도 같은 판정을 쓰므로 막아 주는 경로가 없다. free-messaging.ts:66-68 주석은 '결제방식을 월말까지 못 바꾸게 강제하는 장치가 없으므로'라며 달 중간 전환을 현실 시나리오로 인정하고 무료 제공 축만 식으로 닫았다. 사용량 축에는 같은 처리가 없다. routes/billing.ts /preview도 같은 집계를 써서 경고하지 않는다.

## F35 [high·defect] 예약 시각이 지난 뒤(상태 전환 전) 취소가 허용돼 이미 나간 분이 후불 청구에서 빠지고, 선불 실패·중단분은 어느 환불 경로에도 안 걸린다

- 위치: `utils/campaign-lifecycle.ts:229` · 출처: flow:F6-result-sync · 등재: B-0828-1 관련(대행발송 경로만 queueOnly로 해결). 일반 예약 취소 경로는 미등재.
- 시나리오: 후불 고객사가 LMS 30,000건을 10:00에 예약한다. 10:00부터 에이전트가 발송을 시작하지만 PG 상태는 정리 워커(1분 주기)가 돌 때까지 'scheduled'다. 10:00:30에 사용자(또는 슈퍼관리자)가 취소를 누르면 15분 게이트는 0<diff<15만 막으므로 통과한다. 대기(100) 18,000건은 삭제되고, 픽업된 2,000건은 9999로 바뀌며, 상태는 'cancelled'가 된다. 이미 성공한 10,000건은 청구 선택기가 status='completed'만 고르기 때문에 어느 달 청구에도 실리지 않는다(10,000×LMS 단가 영구 미청구). 선불이라면 취소 환불은 삭제한 100 상태 행만 돌려준다. 9999로 멈춰 나가지 않은 2,000건과 취소 전에 확정된 통신사 실패분은 'cancelled'라서 스위퍼·결과 동기화 대상에서 빠진다. 결과적으로 고객이 영구히 돈을 더 낸다.
- 근거: campaign-lifecycle.ts:229 `if (diffMinutes < 15 && diffMinutes > 0) { return ... tooLate }`는 발송 시각 이후를 막지 않는다(:228 isGhostSchedule은 계산만 하고 쓰지 않는다). :300-302는 픽업분을 `SET status_code = 9999`로 바꾼다. :346-352 환불은 cancelCount(100 상태)만 대상이다. :394-403은 `status = 'cancelled'`로 바꾼다. send-usage-aggregation.ts:583 `AND cr.status = 'completed'`, :595 `AND c2.status = 'completed'`, :618 `AND c3.status = 'completed'`. campaign-sweep-scope.ts:25 `['sending', 'completed', 'failed']`에는 cancelled가 없다.
- 소비처: routes/campaigns.ts:2960-2963 사용자 취소는 skipTimeCheck 없이 cancelCampaign만 부르고 별도의 시각·상태 가드가 없다. admin.ts:2410-2424는 status='scheduled'만 확인하고 skipTimeCheck=true다. scheduled-cleanup-worker.ts:14 `CLEANUP_INTERVAL_MS = 60 * 1000`이라 발송 시작 후 최대 1분 이상 'scheduled'가 남는다. cancelled-queue-sweeper.ts는 삭제·9999 마킹만 하고 환불하지 않는다. 같은 파일 :188-191(queueOnly 주석)이 'cancelled로 바꾸면 이미 나간 발송이 청구에서 사라진다'고 스스로 적어 두었지만, 이 처리는 대행발송 경로에만 적용됐다.

## F36 [high·defect] 재대조 워커가 일부만 보이는 MySQL 실측으로 sent_count를 낮춰 덮어쓰고, 선불 스위퍼가 그 차이를 '미적재'로 과환불한다

- 위치: `utils/campaign-sync-worker.ts:476` · 출처: flow:F6-result-sync · 등재: B-0914-1 관련. 등재된 것은 0건 덮어쓰기(후불 표시)와 그 가드뿐이다. 부분 누락 때 sent_count를 하향 덮어써서 생기는 선불 미적재 과환불은 미등재다(Codex 2R은 '라인그룹 비활성·삭제' 잔여 경로만 인정).
- 시나리오: 선불 고객사 A가 라인그룹 {SMSQ_SEND_4,5,6}으로 LMS 30,000건을 보낸다. 라운드로빈으로 테이블마다 1만 건씩 들어가고, sentTables=[4,5,6], sent_count=30,000이 된다. 발송 후 14일 안에 슈퍼관리자가 6번이 든 라인그룹을 비활성화하거나 sms_tables에서 6을 뺀다(admin.ts:5607-5617에서 할 수 있다). 그러면 조회 합집합에서 6이 빠진다. 스위퍼가 PG success/fail을 4·5번 몫(약 2만)으로 갱신하므로 6h 확정 조건이 영원히 채워지지 않는다. 72h 탈출구 재대조가 aggTotal=20,000(>0)을 읽는데, 0건 가드는 0일 때만 막으므로 그대로 sent_count=20,000으로 덮고 result_final=true로 굳힌다. 다음 스위퍼 사이클에서 처리수=max(20,000, 20,000), 미적재=30,000−20,000=10,000으로 계산돼 NOT_LOADED 환불 10,000건×LMS 단가(예: 30원이면 30만 원)가 나간다. 실제로는 발송·과금이 끝난 문자 값이다. 초과 회수 한도는 '부담−성공(부분 성공 1.9만)=1.1만'이라 순환불 1.1만 이하로 판정돼 회수가 0건이다. 불변식 gap도 0이라 경보가 뜨지 않는다. 결과적으로 A사는 약 9,500건분을 더 돌려받고, 6번 테이블의 실제 실패분은 반대로 영구히 환불되지 않는다.
- 근거: campaign-sync-worker.ts:430 `const tables = await getCompanySmsTablesWithLogs(camp.company_id);`에서 sentTables를 읽지만(395·443) 가드에만 쓰고 조회 합집합에는 넣지 않는다. :434 `const sentCount = (counts?.total || 0);` :476-482 `SET status = $2, sent_count = $3, ...`는 하향 덮어쓰기다. sms-table-split.ts:153 `if (Math.max(0, Number(i.aggTotal) || 0) > 0) return false;`는 0건만 보류한다. sms-queue.ts:767-769 `WHERE group_type = 'bulk' AND is_active = true`는 비활성 라인을 합집합에서 뺀다. mysql-refund-sweeper.ts:246 `const axisSentCount = axis.scope === 'all' ? Number(camp.sent_count || 0) : 0;` :305-306 `const processed = Math.max(axisSentCount, ...); const notLoaded = ... coveredCount - processed`
- 소비처: mysql-refund-sweeper.ts:118-131은 prepaid·completed·14일 후보를 고르고, result_final과 무관하게 다시 처리한다. :311-323 calcRefundParts의 notLoaded는 prepaidRefund의 NOT_LOADED 키로 간다. prepaid.ts:363-393은 키 항아리 기준으로 차액을 지급하며 상한은 차감 총액뿐이다. :337-346 회수 한도 maxLegit=부담−부분 성공이라 초과로 보지 않는다. refund-calc.ts:63-64에는 sent_count 하한만 있다. 다른 쓰기 경로는 반대로 sent_count를 보호한다. 스위퍼 :219는 `GREATEST(COALESCE(sent_count, 0), $4::int)`, lifecycle :523·653은 `COALESCE(NULLIF(sent_count, 0), ...)`이다. 재대조만 이 원칙을 어긴다. 이를 막는 방어 코드는 없다.

## F37 [high·defect] 워커 적재 루프 앞뒤 구간의 예외가 환불 없이 send_phase='failed'로 굳는다(B-0727-1 잔여)

- 위치: `utils/direct-send-worker.ts:482` · 출처: flow:F2-direct-send · 등재: B-0727-1 잔여(BUGS.md:1505-1515 — 수정 ①이 적재 루프만 try로 감쌌다. 1503줄 0727 실측은 failed 0건)
- 시나리오: 선불 고객이 10만 건 즉시발송을 커밋하면 10만 건이 먼저 차감된다. 워커가 queued를 processing으로 선점한 뒤 try 밖 구간(sentTables UPDATE · getCompanySmsTables · prepareFieldMappings · 수신거부/중복 정제 DELETE)에서 PG 풀 대기가 5초를 넘기면(connectionTimeoutMillis 5000) 예외가 난다. 예외는 processCampaign 밖으로 나가고, 바깥 catch는 send_phase='failed'와 사유만 적는다. 결과는 0건 발송, 10만 건 차감 전액 영구 미환불, status 'sending' 고정이다. 브랜드(kakao/both) commit에서 카카오 이미지 등록 실패(BrandImageResolveError)가 나도 같은 길로 간다. 427-428줄 주석('미적재 환불 축이 되돌린다')은 사실과 다르다. 적재 뒤 구간(596 statusBeforeRefund · 641 fin UPDATE)에서 예외가 나면 적재분은 실제로 나간다. 그런데 send_phase가 'failed'라 후불 집계와 선불 sweeper에서 빠지고, 미적재분은 환불되지 않는다. C-10이 596줄 조회를 try 밖에 하나 더 추가했다.
- 근거: try 밖: 412 `: await getCompanySmsTables(companyId, userId);` · 414 sentTables UPDATE · 419 `await prepareFieldMappings(companyId)` · 431 `await prepareBrandAttachmentForSend(...)` · 453-470 정제 DELETE · 482 `try {`(루프만) · 596 `await query(\`SELECT status FROM campaigns WHERE id = $1\`...)` · 641 fin UPDATE. 바깥 catch 309-316: `SET send_phase = 'failed', send_config = jsonb_set(... '{failure}', $2::jsonb) ... WHERE id = $1 AND send_phase IS DISTINCT FROM 'sent' AND status IS DISTINCT FROM 'cancelled'`(환불·refundPending 없음)
- 소비처: mysql-refund-sweeper.ts:236 `if (camp.send_phase == null || camp.send_phase === 'sent')`에 따라 'failed'는 환불 대상이 아니다. 워커 retryPendingRefunds(124-131)는 send_config.refundPending이 있어야 집는데 catch가 쓰지 않는다. C-11 recover(271-275)는 'processing'만 집는다. preparing 감시(331-361)는 'preparing'만 본다. campaign-lifecycle의 타임아웃 환불은 현재 코드에 없다(grep 확인). 따라서 이 상태를 되살리는 경로가 없다.

## F38 [high·defect] 커밋 뒤 staging에 덧붙인 행이 차감 없이 발송된다(워커가 total로 자르지 않고 stage가 커밋된 stagingId를 막지 않음)

- 위치: `utils/direct-send-worker.ts:556` · 출처: flow:F2-direct-send · 등재: 미등재
- 시나리오: 선불 고객이 수신자 10,001명 staging으로 commit한다(10,001건 차감). 워커가 앞 1만 건을 적재하는 동안(워커가 다른 회사 대형 캠페인을 처리 중이면 수 분) 같은 stagingId로 /direct-send/stage에 9,999행을 더 넣는다. 두 번째 청크는 LIMIT 10,000이라 원래 1행과 추가 9,999행을 모두 읽어 적재한다. 결과적으로 9,999건이 차감 없이 발송되고 수신거부·중복 정제도 거치지 않는다. 캠페인마다 반복할 수 있다. stagingId를 알면 타사 staging에도 행을 넣을 수 있다. 워커 SELECT에 company_id 조건이 없어 타사 캠페인이 그 번호들로 발송되고 타사가 차감을 부담한다.
- 근거: campaigns.ts:1647 `const stagingId = incoming || randomUUID();`(소유·커밋 여부 확인 없이 1664 INSERT). worker 483 `while (processed < total) {` · 514-517 `... WHERE staging_id = $1 AND id > $3::bigint ORDER BY id ASC LIMIT $2`(company_id 없음, 남은 건수로 자르지 않음) · 556 `processed += chunkRes.rows.length;` · 581 `const failed = Math.max(0, total - sent);`(초과 적재는 0으로 사라짐)
- 소비처: commit은 countStagingFiltered로 한 번만 센다(campaigns.ts:1823). 차감은 spec.total 고정이다(direct-send-core.ts:113). 정제는 processed===0일 때 한 번뿐이다(worker 451). fin(641-655)은 sent_count=sent를 그대로 기록한다. 선불 sweeper·prepaidReverseOverRefund는 환불·초과환불 회수만 하고 초과 발송분을 추가 차감하지 않는다. 후불은 MySQL 성공 기준 청구라 영향이 없다.

## F39 [high·speed] 여정 실행기가 전 회사를 합쳐 5분에 100건만 처리해 대량 여정 발송이 몇 시간씩 밀린다

- 위치: `utils/journey-executor.ts:182` · 출처: flow:F4-scheduled-auto · 등재: 미등재
- 시나리오: 한 회사가 one_shot 여정 1만 명을 켜면 1만 건이 같은 next_run_at으로 적재되는데 실행기는 5분에 100건만 처리한다. 발송 완료까지 500분(8시간 20분)이 걸리고 21시 이후분은 다음날 08시로 밀린다. 그동안 다른 모든 회사의 여정 step(장바구니 이탈처럼 시의성 있는 발송)도 next_run_at 순서로 뒤에 줄을 서서 몇 시간씩 늦게 나간다. 발송 창 13시간 × 시간당 1,200건이면 플랫폼 전체 여정 처리량은 하루 약 15,600건이 상한이다. wait·condition step도 이 100칸을 차지한다.
- 근거: journey-executor.ts:163-183 `WHERE e.status = 'active' AND j.status = 'active' ... ORDER BY e.next_run_at ASC LIMIT 100`을 한 번만 조회하고 돌아간다. 236-240 `const intervalMs = 5 * 60 * 1000; setInterval(...)`. 155-158 workerRunning 가드 때문에 겹쳐 돌지도 않는다.
- 소비처: runJourneyExecutor 호출부를 grep하면 app.ts:641 startJourneyExecutor 하나뿐이고 즉시 실행이나 반복 소진 루프는 없다. journey-anchor-scheduler.ts:161·191-203(date_anchor)과 254·274-287(one_shot)은 대상 전원(최대 JOURNEY_COUNT_CAP=100,000, journey-target-extractor.ts:770)을 한 번에 execution으로 적재한다. journey-executor.ts:494-501 skipped_hours가 21시 이후분을 다음날 08시로 몰아 아침에 한꺼번에 도래시킨다.

## F40 [high·defect] 여정 문자 적재가 bulkInsertSmsQueue 반환값을 버린다. 적재에 실패해도 '발송'으로 기록하고 차감하며, 재시도하지 않는다

- 위치: `utils/journey-executor.ts:962` · 출처: sweep:S-A-prepaid · 등재: 미등재
- 시나리오: MySQL 일시 장애·연결 초과·행 INSERT 오류로 여정 SMS/LMS 1건의 큐 적재가 실패한다. bulkInsertSmsQueue는 예외를 삼키고 0을 돌려주므로 catch(969행 이하)에 들어가지 않는다. 그 결과 journey_step_logs에 'sent'가 기록되고, 선불 1건이 차감되며, 다음 단계로 넘어간다. 고객은 문자를 받지 못하고(발송 누락), 선불 회사는 보내지 않은 문자 값을 낸다. 이 실패를 위해 설계된 '5분 뒤 1회 재시도'(979-995행)와 자동 정지는 SMS 경로에서 한 번도 돌지 않는다.
- 근거: journey-executor.ts:962 `await bulkInsertSmsQueue(tables, [row], true, { companyId: exec.company_id, source: 'journey' });` — 반환값을 쓰지 않는다. · sms-queue.ts:1444-1454 `} catch (batchErr: any) { console.error(...) // 실패 batch는 미집계 → 호출부에서 환불 처리 }` → 1462 `return sentCount;` · journey-executor.ts:1017-1025 적재 직후 step_log 'sent'를 기록하고 prepaidDeduct를 부른다
- 소비처: sms-queue.ts:1382-1463: bulkInsertSmsQueue는 배치 실패 시 throw하지 않고 적재 수만 돌려준다. 다른 호출부(campaigns.ts:1185·2604, auto-campaign-worker.ts:1063)는 모두 반환값으로 미적재 수를 계산한다. 알림톡 분기(923행 insertAlimtalkQueue)는 실패 시 throw하므로 catch를 탄다. 따라서 이 결함은 SMS/LMS/MMS 여정에만 해당한다. 여정 차감을 되돌리는 경로는 앞 항목대로 없다.

## F41 [high·defect] 여정 문자 적재 실패(반환 0)를 성공으로 처리해 선불 차감·'sent' 기록 뒤 재시도도 하지 않음

- 위치: `utils/journey-executor.ts:962` · 출처: sweep:S-E-mysql-queue · 등재: 미등재 (sms-queue.ts:1297 주석에서만 언급)
- 시나리오: 여정 SMS/LMS/MMS 단계가 도는 중에 MySQL이 잠깐 끊기거나(재기동·연결 끊김·잠금 대기 초과) INSERT가 거절되는 경우 → bulkInsertSmsQueue는 배치 오류를 삼키고 0을 돌려준다. 여정은 반환값을 보지 않으므로 catch의 '5분 뒤 1회 재시도' 분기를 타지 않는다. 대신 journey_step_logs에 'sent'를 쓰고 prepaidDeduct(1건)로 선불 고객사 잔액을 깎은 뒤 다음 단계로 넘어간다. 결과: 장애 구간에 도는 실행마다 고객(수신자)은 문자를 못 받고, 고객사는 건당 단가를 더 낸다. 이 차감은 reference_type='journey'라 선불 sweeper가 잡지도 않아 영구히 남는다.
- 근거: journey-executor.ts:962 `await bulkInsertSmsQueue(tables, [row], true, { companyId: exec.company_id, source: 'journey' });`(반환값 버림) → 1017-1025 `INSERT INTO journey_step_logs ... 'sent'` 뒤 `prepaidDeduct(exec.company_id, 1, prepaidMsgType, exec.journey_id, ..., 'journey')`. sms-queue.ts:1444-1454 `} catch (batchErr) { console.error(...) // 실패 batch는 미집계 → 호출부에서 환불 처리 }`(throw 없음). sms-queue.ts:1297 주석도 '여정은 반환값을 안 본다'고 적어 둠.
- 소비처: journey-executor.ts:969-1012 catch(재시도·일시정지)는 throw가 날 때만 탄다. 알림톡 분기(insertAlimtalkQueue)는 AlimtalkQueueInsertError를 던져 이 catch를 타므로 멀쩡하고 문자 분기만 해당한다. mysql-refund-sweeper.ts:254-266은 reference_type='campaign'인 차감만 읽는다. 같은 CT를 쓰는 agency-send-worker.ts:229-234와 direct-send-processor.ts:161은 반환값을 확인한다.

## F42 [high·waste] 학습 누적이 클릭 0 캠페인을 24시간 동안 30초마다 다시 뽑아 cdp_events를 전수 COUNT하고, LIMIT 100이 막혀 뒤 캠페인은 학습되지 않는다

- 위치: `utils/mysql-refund-sweeper.ts:564` · 출처: chunk:s1-01 · 등재: 미등재(BUGS.md에서 accumulateCampaignLearning 검색 0건)
- 시나리오: 완료된 캠페인(발송 10건 이상) 대부분은 단축 URL이 없어 클릭이 0이다. recordCampaignLearning은 클릭 0이면 아무것도 쓰지 않고 반환하므로 ai_company_memory에 행이 생기지 않는다. 그래서 NOT EXISTS가 계속 참이 되어, 같은 캠페인이 24시간 동안 30초마다(2,880회) 다시 선택된다. 선택될 때마다 그 회사의 message_click 이벤트 전체를 `properties->>'campaign_id'`로 걸러 COUNT한다(인덱스는 company_id, event_name까지만 탄다). 24시간 안에 이런 캠페인이 100건을 넘으면 `ORDER BY sent_at DESC LIMIT 100`을 최신 무클릭 캠페인이 매번 채워서, 더 앞선 클릭 있는 캠페인은 영영 학습되지 않는다. 또 같은 채널에서 클릭률 10% 미만인 캠페인이 2건 이상이면 channel_performance 한 행의 last_campaign_id를 서로 덮어써, 매 사이클 번갈아 재학습(UPSERT)한다. 학습을 안 해도 learned++가 올라가 로그가 30초마다 찍힌다.
- 근거: mysql-refund-sweeper.ts:576-581 `COALESCE((SELECT COUNT(*)::int FROM cdp_events e WHERE e.company_id = c.company_id AND e.event_name = 'message_click' AND e.properties->>'campaign_id' = c.id::text), 0)`, 589-600 NOT EXISTS(metadata campaign_id / last_campaign_id), 602 `LIMIT 100`, 626 `learned++`(실제 기록 여부와 무관). 386행에서 runOnce(30초, 46행)마다 무조건 호출한다. company-memory.ts:251 `if (!shouldRecordCampaignLearning(...)) return;`, ai-memory-text.ts:39 `if (input.clickCount <= 0) return false;`, company-memory.ts:285-304 memoryKey `channel_${channel}` 하나에 metadata.last_campaign_id를 덮어쓴다(addMemory 99-103 ON CONFLICT DO UPDATE, metadata || EXCLUDED).
- 소비처: company-memory.ts:89-117 addMemory(ON CONFLICT UPSERT로 덮어씀)와 249-306 recordCampaignLearning, ai-memory-text.ts:37-41 게이트를 읽었다. status/SCHEMA.md:2869의 cdp_events 인덱스는 (company_id, event_name, occurred_at DESC)뿐이라 campaign_id 조건은 인덱스로 거르지 못한다. 이 함수는 runOnce 안에서만 호출되고, 학습되지 못한 캠페인을 걸러내는 다른 장치는 없다.

## F43 [high·defect] 분할발송 시각 계산이 자정을 넘긴 배치를 이월하지 않아 광고 문자가 00:00~07:59(KST)에 나간다

- 위치: `utils/send-time-util.ts:43` · 출처: chunk:s1-01 · 등재: 미등재(BUGS.md에서 calcSplitSendTime·분할 야간 검색 0건)
- 시나리오: 광고 직접발송 3만 명을 20:00에 예약하고 분할을 1분 100건으로 잡는다. 배치 0~59는 20:00~20:59, 배치 60~239는 21:00~23:59로 계산되어 kstHour가 21 이상이라 다음날 08:00~10:59로 이월된다. 그런데 배치 240~299는 다음날 00:00~00:59로 계산되고, kstHour가 0이라 `kstHour >= sendEndHour`에 걸리지 않아 그대로 큐 sendreq_time에 적재된다. 그 결과 수신자 6,000명이 자정~01시에 광고 문자를 받는다(야간 광고 전송 제한 위반, 민원 발생). 오후 5시 시작에 1분 100건이면 42,000명 이상, 20시 시작이면 24,000명 이상부터 이 일이 생긴다. 접수 단계의 야간 광고 검사는 시작 시각만 본다.
- 근거: send-time-util.ts:39-52 `const kstHour = parseInt(result.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false })); if (kstHour >= sendEndHour) { ... 다음날 이월 }` — 새벽(0~start 미만)은 처리하지 않는다. shiftToSendableHour 주석(58-66행)도 'calcSplitSendTime은 endHour 초과만 처리(새벽 미처리)'라고 적고 있다. SEND_HOURS = {start: 8, end: 21}(config/defaults.ts:210-215).
- 소비처: direct-send-worker.ts:526-530이 예약·즉시 분할 모두 `calcSplitSendTime(base, Math.floor(globalIndex / cfg.splitCount))` 결과를 그대로 sendTime으로 쓴다. campaigns.ts:2426-2434, 2488-2499(레거시 직접발송의 문자·브랜드)도 같다. direct-send-core.ts:89-97의 야간 광고 차단은 `effectiveAt = scheduledAt 또는 now` 한 시각만 isSendableHourKst로 검사하고 분할 종료 시각은 보지 않는다. 프론트 SplitSendPopover.tsx:10-11은 1~9999건/분(프리셋 100/500/1000/3000)을 허용하고, 끝나는 시각 계산은 '안내용 추정'일 뿐 막지 않는다. 브랜드 행은 buildBrandQueuePayload의 발송 창 검사로 throw되지만 SMS/LMS/MMS 행은 막는 곳이 없다.

## F44 [high·defect] 분할 발송 회차가 자정을 넘기면 00~07시에 광고 문자가 그대로 나간다

- 위치: `utils/send-time-util.ts:43` · 출처: flow:F4-scheduled-auto · 등재: RISKS.md R31 '분할발송 시간 오버플로우 → 심야/새벽 발송' — '해결'로 표기돼 있지만 코드는 21~23시만 이월하고 자정 이후는 그대로다
- 시나리오: 20:00 예약, 분할 3,000건/분, 수신자 100만 명이면 334회차가 된다. 60~239회차(21:00~23:59)는 다음날 08:00~10:59로 이월된다. 240~333회차(00:00~01:33, 약 28만 건)는 이월되지 않아 새벽 0~1시에 광고 문자로 나간다(야간 광고 제한 위반·수신자 민원). 프리셋 100건/분이면 20:00 시작 기준 2.4만 명부터 생긴다. 즉시 분할(현재 시각 기준)도 같다. 화면은 '발송 가능 시간을 넘기면 다음 날 아침에 이어서 보내요'라고 안내한다.
- 근거: send-time-util.ts:36 `result.setMinutes(result.getMinutes() + batchIndex);` 이후 43 `if (kstHour >= sendEndHour) {`만 이월한다. 결과 시각이 다음날 0~7시(kstHour < sendStartHour)인 경우를 처리하는 분기가 없어 그 시각을 그대로 반환한다(51 `return result;`).
- 소비처: direct-send-worker.ts:525-531: 예약·즉시 분할 모두 `toKoreaTimeStr(calcSplitSendTime(...))`를 그대로 sendTime으로 적재한다. campaigns.ts:2428·2434(문자), 2490·2499(카카오)도 같다. direct-send-core.ts:89-97 야간 광고 게이트는 시작 시각(effectiveAt) 하나만 본다. 프런트 SplitSendPopover.tsx 프리셋은 100/500/1000/3000이고 상한은 9999다. 적재 뒤 sendreq_time을 다시 검사하는 곳은 없다.

## F45 [high·defect] 큐 워커의 멈춘 검사 정리 코드가 실행되지 않아, active 행 하나가 남으면 자동 스팸검사 큐 전체가 멈춘다

- 위치: `utils/spam-test-queue.ts:252` · 출처: chunk:s1-02 · 등재: 없음(BUGS.md에서 spam-test-queue·processSpamTestQueue·SpamTestQueue grep: 샘플 고객 범위(265줄)·080 문구(344줄)·agency timeout 통과 해석(1395줄)만 있고 이 결함은 없음)
- 시나리오: (1) PM2 재시작(배포) 순간 큐 검사가 active 상태였거나(검사 1건은 최대 60초 동안 active), (2) 폴링 안의 MySQL 조회가 90초 동안 계속 실패하면 active 행이 영원히 남는다. 원인은 두 가지다. 폴링 setInterval은 메모리에만 있어 재시작하면 사라지고, 안전 타이머(492줄)는 interval만 끄고 상태를 completed로 바꾸지 않는다. 그 뒤 processSpamTestQueue는 매 3초마다 active 행을 보고 바로 return한다. 바로 아래의 stale 정리도 status='active'인 행만 고르므로, active 행이 하나라도 있으면 이미 return한 뒤라 절대 실행되지 않는다(사실상 죽은 코드). 결과: auto-campaign-worker·continuous-operator·planner-executor·agency-send-worker·여정 사전검사의 스팸검사가 모두 queued에 쌓이고, 호출자는 90초(waitForTestCompletion) 또는 30초(여정 pollSpamResult) 뒤 timeout을 받는다. 그 결과 (가) 연속운영자 리마인드·제안이 admin_review로 떨어져 자동 발송이 나가지 않고, (나) 여정 사전검사는 선불 차감(테스트폰 수×단가, skipPrepaid:false)을 하고도 실패한다. 큐는 누군가 수동 스팸검사를 요청하거나 그 사용자가 active-test·tests/:id를 조회할 때까지 막혀 있다. 야간·주말이면 수 시간 이어질 수 있다. 풀린 뒤에는 기다리던 호출자가 이미 떠난 queued 검사들이 테스트폰으로 차례로 실제 발송된다(헛발송·헛차감).
- 근거: 252-257: `const activeTest = await query(\`SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1\`); if (activeTest.rows.length > 0) { return; }` → 260-262: `SELECT id FROM spam_filter_tests WHERE status = 'active' AND created_at < NOW() - INTERVAL ...` (앞에서 이미 return해 도달하지 못함) / 492: `setTimeout(() => { clearInterval(pollInterval); }, TIMEOUTS.spamFilterSafety);` (completed 전환 없음)
- 소비처: app.ts:102,575 — startSpamTestQueueWorker만 부르고, 기동 시 active를 정리하는 코드 없음(app.ts에서 spam grep 결과 4줄). 방어 경로는 routes/spam-filter.ts:64-82(수동 검사 POST 때 created_at 60초 초과 active 정리), :566-606(해당 사용자의 active-test 조회), :778-801(tests/:id 조회)뿐이며 모두 사람의 HTTP 요청이 있어야 돈다. spam-test-queue.ts:568 waitForTestCompletion은 90초 뒤 'timeout'. continuous-operator-policy.ts:52-69는 pass가 아니면 admin_review·autoExecuteBlocked. continuous-operator.ts:2541은 spamPassed=false면 리마인드를 올리지 않음. journey-pretest-validator.ts:286-302는 skipPrepaid:false로 유료 차감 후 30초만 폴링.

## F46 [high·defect] 스팸 검사 큐 워커의 stale 정리가 도달 불가이고, 시간 초과를 적재 시각(created_at) 기준으로 재서 대기한 검사가 곧바로 timeout으로 확정된다

- 위치: `utils/spam-test-queue.ts:252` · 출처: sweep:S-F-spam-test · 등재: 미등재(연관: B-0823-1 timeout을 통과로 읽는 문제가 이 결함으로 더 자주 발동한다)
- 시나리오: ① 자동 검사가 실행 중일 때 PM2가 재기동되면 폴링 setInterval이 사라지고 행은 'active'로 남는다. processSpamTestQueue는 active 행이 있으면 매 tick마다 바로 return하므로 그 아래 stale 정리 코드에 영영 닿지 못한다. 그래서 누군가 수동 스팸 검사(POST /spam-filter/test, 전역 정리 포함)를 할 때까지 모든 queued 자동 검사가 멈춘다. 그동안 autoSpamTestWithRegenerate는 적재 90초 뒤 'timeout'을 돌려준다. 대행발송 runSpamRound는 이를 통과로 읽어 검사 없이 발송하고, 연속운영 리마인드는 승격되지 않는다. ② 큐가 밀려 60초 넘게 기다린 검사는 active로 바뀐 뒤 첫 폴링(5초 뒤)에서 elapsed=now−created_at>60s가 되어, 실제 판정 없이 전 행이 TIMEOUT으로 확정된다. 수동 /test의 전역 stale 정리도 같은 created_at 기준이라, 막 시작한 큐 검사를 timeout으로 닫는다. 호출자는 이미 timeout으로 버렸는데도 queued 행은 나중에 실행되어 테스트폰 3대로 발송된다. 후불 회사는 result가 NOT NULL인 이 행들을 스팸 사용량으로 청구받는다.
- 근거: spam-test-queue.ts:252-257 `SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1` → `return;`. 그 다음 :260-262 stale 조회 `WHERE status = 'active' AND created_at < NOW() - INTERVAL ...`는 active 행이 없을 때만 실행되어 항상 빈 결과다. :293-296 active 전환은 status만 바꾸고 created_at은 그대로다. :469-470 `const elapsed = Date.now() - new Date(activeCheck.rows[0].created_at).getTime(); if (elapsed > TIMEOUTS.spamFilterTest)`(60초). spam-filter.ts:65-67 전역 stale 정리도 created_at 기준 60초다.
- 소비처: app.ts:575 startSpamTestQueueWorker 외에 기동 시 복구 코드는 없다(app.ts spam grep). 나머지 정리 경로는 spam-filter.ts:65-82(수동 /test 요청), :566-607(/active-test, 본인 user_id만), :754-801(/tests/:id)로 모두 사람의 요청에 의존한다. waitForTestCompletion(:568-601)은 적재 시점부터 90초 뒤 'timeout'을 돌려준다. agency-send-worker.ts:370은 `v?.spamResult !== 'blocked'`면 통과로 본다. send-usage-aggregation.ts:1872는 `result IS NOT NULL`을 success로 세어 후불 청구에 넣는다.

## F47 [high·defect] 큐 검사의 타임아웃을 활성화 시각이 아니라 등록(created_at) 시각으로 재서, 오래 기다린 검사가 첫 폴링에서 거짓 BLOCKED로 확정된다

- 위치: `utils/spam-test-queue.ts:469` · 출처: chunk:s1-02 · 등재: 없음
- 시나리오: 큐 워커는 active 행이 하나라도 있으면(다른 고객사의 수동 검사 포함, 수동 검사는 spam-filter.ts에서 바로 'active'로 넣는다) 다음 검사를 꺼내지 않는다. 그래서 수동 검사 1건이 60초 타임아웃까지 active로 남아 있거나, 앞선 큐 검사가 차단 판정(25초 grace 포함, 약 40초)을 받는 동안 자동 검사가 55초 넘게 queued로 기다리는 일이 생긴다. 이 검사가 활성화되면 첫 폴링(5초 뒤)에서 이통사 성공(QTmsg 6/1000)이 처음 확인된 행은 qtmsgSuccessTime만 기록되고 판정은 미뤄진다. 그런데 같은 틱에서 elapsed(created_at 기준)가 60초를 넘었으므로 남은 행이 곧바로 `qtmsgSuccessTime.has → BLOCKED`로 확정된다. KT는 앱 리포트에 12~15초가 걸려(파일 29줄 주석) 정상 문안도 거의 확실히 '스팸 차단'이 된다. 이 결과는 waitForTestCompletion(90초 한도)을 거쳐 그대로 'blocked'로 전달된다. 이어서 (가) auto-campaign-worker가 캠페인 문안을 AI 재생성본으로 바꾸고(UPDATE auto_campaigns.generated_message_content) 담당자에게 '차단' 알림을 보낸다. (나) agency-send-worker가 고객의 대행 문안을 refineForSpam으로 고친다. (다) 연속운영자 제안은 admin_review로 자동 발송이 막힌다. 수동 검사 경로의 stale 정리(spam-filter.ts:64-68)도 created_at 60초 기준이라, 막 활성화된 이 검사를 TIMEOUT으로 닫아 버릴 수 있다.
- 근거: 469-479: `const elapsed = Date.now() - new Date(activeCheck.rows[0].created_at).getTime(); if (elapsed > TIMEOUTS.spamFilterTest) { ... const finalResult = qtmsgSuccessTime.has(rowKey) ? SPAM_RESULT.BLOCKED : SPAM_RESULT.TIMEOUT;` / 427-431: 첫 성공 확인 시 `qtmsgSuccessTime.set(rowKey, Date.now()); result = null;` / 252-256: active가 하나라도 있으면 return(수동 검사 포함)
- 소비처: routes/spam-filter.ts:183-205 — 수동 검사는 status 'active'로 바로 INSERT해 큐 워커를 막는다. routes/spam-filter.ts:64-82 — stale 정리가 created_at < NOW()-60초 기준. auto-campaign-worker.ts:1306-1396 — blocked면 regenerateCallback → 문안 UPDATE, :1400-1447 — '차단' 알림 발송. agency-send-worker.ts:369-391 — blocked면 refineForSpam으로 문안 수정. continuous-operator-policy.ts:65-69 — pass가 아니면 admin_review. 활성화 시각을 따로 기록하는 컬럼이나 방어 코드 없음(processSpamTestQueue 293-296은 status만 바꿈).

## F48 [high·defect] 배치 결과 판정이 판정 대기(NULL) 통신사를 버려서, 한 통신사만 통과해도 전체를 'pass'로 확정한다

- 위치: `utils/spam-test-queue.ts:532` · 출처: sweep:S-F-spam-test · 등재: 미등재(BUGS.md·0925 감사 문서에서 getSpamTestBatchResults·pollSpamResult를 grep한 결과 0건)
- 시나리오: 여정 활성화 검증이나 발송 2시간 전 재검(runStepSpamTest)에서 KT만 차단하는 문안을 검사하면, SKT 앱 리포트는 몇 초 만에 pass로 기록된다. KT 행은 QTmsg 성공 뒤 25초 유예 동안 result가 NULL로 남는다. 이때 getSpamTestBatchResults가 NULL을 filter(Boolean)으로 버리고 ['pass']만 보므로 overallResult='pass'가 된다. pollSpamResult는 이를 끝난 것으로 보고 allPassed=true를 돌려준다. 결과로 여정이 활성화되거나 pretest_pass로 기록되고, 실발송에서 KT 가입 수신자는 통신사 스팸 차단으로 문자를 받지 못한다. 선불 차감은 그대로 남는다. 한 통신사만 막는 상황이 바로 스팸 검사가 잡아야 하는 경우인데, 차단 판정(유예 25초 이상)이 통과 리포트(수 초)보다 항상 늦어서 이 경로에서는 사실상 잡히지 않는다.
- 근거: spam-test-queue.ts:532-544 `if (test.status === 'completed' || test.status === 'active') { const allResults = carrierResults.map(r => r.result).filter(Boolean); ... } else if (allResults.every(r => r === SPAM_RESULT.PASS)) { overallResult = 'pass'; }` — status가 active이고 NULL 행이 남아 있어도 pass로 판정한다
- 소비처: getSpamTestBatchResults의 소비처는 journey-pretest-validator.ts 하나뿐이다(packages 전체 grep). 같은 파일 :226-243 pollSpamResult는 `v.overallResult !== 'pending'`이면 끝난 것으로 보고, carrierResults 중 blocked·failed만 실패로 세며 NULL은 무시해 allPassed=true를 낸다. :148-177 validator는 r.ok면 통과시킨다. journey-pretest-notifier.ts:88-99는 r1.ok면 'notified'로 기록하고 pretest_pass 안내를 보낸다. autoSpamTestWithRegenerate는 waitForTestCompletion(status='completed'가 될 때까지 대기)을 쓰므로 이 결함과 무관하다.

## F49 [high·data] 자동 스팸 검사(auto_ai)가 선불은 차감 0원인데 후불은 정산에서 청구되어, 같은 검사가 결제방식에 따라 과금이 갈린다

- 위치: `utils/spam-test-queue.ts:670` · 출처: sweep:S-F-spam-test · 등재: docs/2026-08-22-agency-send-design.md §14-7(Harold 결정 대기 · BUGS.md 미등재. 설계서는 이 경로를 '무과금'으로 적었지만 후불 청구는 실제로 발생한다)
- 시나리오: 자동발송·연속운영·플래너·대행발송은 autoSpamTestWithRegenerate로 검사한다(테스트폰 3대 × 차단 시 최대 3회). 선불 회사는 skipPrepaid:true라 차감이 0원이고 선불 정산서 발행도 막혀 있어 어떤 경로로도 과금되지 않는다. 후불 회사는 send-usage-aggregation이 trial만 빼고 auto_ai 행을 SPAM_SMS/SPAM_LMS로 집계해 일반 단가로 월 청구서에 올린다. 예를 들어 자동발송 1건에서 재생성이 2회 나면 후불 회사는 9행 × 단가를 내고, 같은 동작을 한 선불 회사는 0원이다. spam-filter.ts:209의 정책 주석은 '전 플랜 항상 과금'이고 대행발송 설계서는 이 경로를 '무과금'으로 알고 있어, 어느 쪽이 맞든 한쪽 고객군은 틀린 금액을 낸다.
- 근거: spam-test-queue.ts:670 `skipPrepaid: true, // 프로 이상: 무료`. send-usage-aggregation.ts:1883 `AND ${spamBillableTestSql('t')}`, spam-trial.ts:26 `COALESCE(${alias}.source, 'manual') <> 'trial'`(auto_ai는 청구 대상에 들어감). billing-issue.ts:286-289 스팸 단가 = 일반 SMS/LMS 단가. spam-filter.ts:209 `프로 이상 스팸필터 테스트 무료 전면 폐지 — 전 플랜 항상 과금(현금/후불)`.
- 소비처: 호출부 auto-campaign-worker.ts:309·:1306, continuous-operator.ts:1036·:2527, planner-executor.ts:309, agency-send-worker.ts:356이 모두 autoSpamTestWithRegenerate를 거쳐 skipPrepaid:true로 고정된다. 'spam' prepaidDeduct는 spam-filter.ts:213과 spam-test-queue.ts:201(여정 runStepSpamTest, skipPrepaid:false)뿐이다(grep). 선불 회사 정산서 발행은 billing-issue.ts:255-261에서 차단된다. 후불 집계는 send-usage-aggregation.ts:791-808·1866-1897에서 확인했다.

## medium 이하 한 줄 목록 (140건 · 미확인)

| 위치 | 제목 | 출처 |
|---|---|---|
| utils/spam-test-queue.ts:185 | 결과 행·차감보다 'queued' 행을 먼저 넣어, 워커가 결과 행 0개나 일부만 있는 상태로 검사를 실행할 수 있음(차감 후 미발송 timeout) | chunk:s1-02 |
| utils/spam-test-queue.ts:229 | 차감 뒤 결과 행 INSERT가 실패해도 환불 없이 오류만 반환하고 queued 행이 남아 나중에 일부만 발송됨 | chunk:s1-02 |
| utils/spam-test-queue.ts:398 | QTmsg 로그 테이블을 현재 월(_YYYYMM)만 조회해 월말 경계 검사의 결과를 놓치고 timeout 처리 | chunk:s1-02 |
| utils/sms-result-map.ts:132 | 7305(성공불확실)가 매핑 표에서는 pending인데 PENDING_CODES에 없어 집계·환불 산식에서는 실패로 셈(표시는 대기) | chunk:s1-02 |
| utils/spam-test-queue.ts:517 | getSpamTestBatchResults가 변형마다 결과를 따로 조회(N+1)하고, 여정 pollSpamResult가 이를 1초마다 반복 호출 | chunk:s1-02 |
| utils/payment-processor.ts:137 | 금액 대조가 TotPrice가 없거나 0이면 그냥 통과(fail-open)하고, 승인 응답의 MOID를 orderId와 대조하지 않음 | sweep:S-C-charge-payment |
| routes/payments.ts:201 | 망취소 반환값(false)을 무시하고 경보도 없음: 확정 실패와 망취소 실패가 겹치면 카드는 청구됐는데 잔액은 0이고 행은 failed | sweep:S-C-charge-payment |
| utils/inicis-client.ts:275 | authUrl·netCancelUrl fetch에 타임아웃이 없어 이니시스가 멈추면 리턴 요청이 길게 매달림 | sweep:S-C-charge-payment |
| utils/payment-processor.ts:173 | 결제 확정 때 billing_type을 다시 확인하지 않아, prepare 뒤 후불로 바뀐 회사에도 balance가 더해짐 | sweep:S-C-charge-payment |
| routes/balance.ts:196 | 무통장입금 요청 금액의 타입·정수·상한 검증이 없음(소수·초고액·문자열 금액 접수) | sweep:S-C-charge-payment |
| routes/payments.ts:296 | 카드결제 prepare 금액의 정수 검증이 없어 소수 금액 주문이 생성됨 | sweep:S-C-charge-payment |
| routes/admin.ts:3721 | 수동 잔액 조정에서 amount가 문자열이면 balance_before가 문자열 연결로 잘못 기록되고, 잔액 UPDATE와 원장 INSERT가 트랜잭션 밖에 있음 | sweep:S-C-charge-payment |
| utils/agent-charge-reconciler.ts:43 | 불확실 해소를 confirmed로 처리해 seqNo 없이 registered가 된 요청에 걸린 주문은 영구히 processing에 남음(고객 화면에 '처리 중' 고착) | sweep:S-C-charge-payment |
| utils/agent-charge-reconciler.ts:48 | 가장 오래된 20건만 고정으로 확인해, 게이트웨이에 끝내 반영되지 않는 요청이 20건 쌓이면 그 뒤 요청은 영영 fulfilled로 넘어가지 않음 | sweep:S-C-charge-payment |
| utils/agent-charge-core.ts:52 | 링크 승인 때 발송ID가 지금도 주문 회사 소유인지 확인하지 않음(매핑이 바뀌면 다른 회사 지갑에 충전됨) | sweep:S-C-charge-payment |
| utils/ai-credit-recharge.ts:153 | 후불 AI 크레딧 승인 때 회사 billing_type을 다시 확인하지 않음 | sweep:S-C-charge-payment |
| routes/balance.ts:102 | 잔액 이력 조회 limit에 상한이 없어 큰 값을 주면 전체 이력을 한 번에 읽음 | sweep:S-C-charge-payment |
| utils/agency-send-mail-worker.ts:1066 | 이메일 접수 커밋 뒤 1차 검사를 바로 기동하지 않아(kickFirstTest 없음) 40분 리드타임에서 최대 5분의 승인 시간이 줄어든다 | flow:F5-agency-send |
| utils/agency-send-worker.ts:1323 | 대조가 종결 접수의 live 캠페인을 30일 동안 매 tick 다시 중화한다(MySQL 카운트·DELETE·UPDATE 반복) | flow:F5-agency-send |
| utils/agency-send-worker.ts:1202 | 잔액 부족 같은 배관 거절 때 만료까지 5분마다 전체 명단을 staging에 다시 복사하고, 사유 안내 없이 '승인 후 미발송'만 통지한다 | flow:F5-agency-send |
| utils/agency-send-worker.ts:1182 | 활성화 실패로 failed가 된 캠페인의 staging 행이 영구히 남는다(purgeOrphanStaging은 캠페인이 없을 때만 지운다) | flow:F5-agency-send |
| routes/agency-send.ts:801 | 예외 경로로 staging이 남은 만료 건의 시각을 바꾸면 dispatch_key가 비워져 그 staging이 고아가 된다 | flow:F5-agency-send |
| utils/agency-send-campaign.ts:81 | 활성화 실패(failed·미발송) 캠페인도 '나갔을 수 있음'으로 판정되어, 만료 건을 취소하면 '이미 발송이 끝나'로 잘못 안내한다 | flow:F5-agency-send |
| utils/agency-send-worker.ts:1537 | 'sent' 전이가 예약 시각만 봐서, 직접발송 워커 적체로 아직 적재되지 않은 건도 sent가 되어 취소할 수 없다 | flow:F5-agency-send |
| utils/agency-send-worker.ts:447 | 1차 검사 BATCH 5건을 순차로 돌려 뒤 행의 lock_at이 30분을 넘기면 lock 복구가 되돌려, 스팸 테스트가 중복 발송된다 | flow:F5-agency-send |
| utils/agency-send-intake.ts:292 | mmsImagePaths가 이 회사 소유 경로인지 검증하지 않는다(서버 절대경로를 클라이언트 값 그대로 받음 · 발송 배관 공통) | flow:F5-agency-send |
| utils/billing-issue.ts:190 | 일반 발행과 일괄발급에 '끝나지 않은 기간' 차단이 없다. 최소과금(983-989)에만 있어서, 당월을 발행하면 그 뒤 월말까지의 발송이 기간 겹침 차단 때문에 영구 미청구가 된다 | sweep:S-B-postpaid-billing |
| routes/billing.ts:746 | 수정세금계산서 중복 검사가 ready·submitted만 본다. 발행 완료(issued)나 failed가 된 전액 취소(사유 4·6)를 같은 원본에 다시 만들 수 있고, 원본 대비 누적 음수를 검사하지 않는다 | sweep:S-B-postpaid-billing |
| routes/billing.ts:2632 | POST /:id/reissue가 최소과금 정액 장(EXTRA_BASE_FEE)도 삭제 뒤 issueBilling(사용량 발행)으로 다시 만들어 정액보다 적게 청구될 수 있다 | sweep:S-B-postpaid-billing |
| utils/billing-issue.ts:1183 | 최소과금의 '사용량 ≤ 최소과금' 판정이 같은 기간의 수량 조정(billing_qty_adjustments)을 반영하지 않는다 | sweep:S-B-postpaid-billing |
| utils/billing-issue.ts:580 | 080_base 자동 생성이 전사 UNIQUE(period_month,kind,source_ref)에 ON CONFLICT DO NOTHING을 건다. 달 중간에 번호가 다른 회사로 이관되면 새 회사의 그 달 고정료 근거 행이 조용히 생기지 않는다 | sweep:S-B-postpaid-billing |
| routes/billing.ts:2321 | PUT /:id/status가 paid·confirmed를 draft로 되돌리는 것을 막지 않는다. 되돌린 뒤에는 삭제 가드의 isIssued 판정을 우회할 수 있다 | sweep:S-B-postpaid-billing |
| routes/billing.ts:2699 | /preview(발행 드라이런)가 080·수기 추가 항목, 080_base 고정료, 수량 조정을 계산하지 않아 미리보기 금액과 실제 발행 금액이 다르다 | sweep:S-B-postpaid-billing |
| utils/send-usage-aggregation.ts:581 | AI 캠페인은 청구 포함 여부를 run.sent_at(적재 종료 시각, campaigns.ts:1250)으로, 수량은 큐 sendreq_time으로 정한다. 즉시 발송 적재가 월 경계를 넘기면 앞달 sendreq_time 행이 어느 달에도 청구되지 않는다 | sweep:S-B-postpaid-billing |
| utils/ai-credit-recharge.ts:139 | 후불 충전 요청 승인이 현재 billing_type을 확인하지 않는다. 요청 뒤 선불로 바뀐 회사의 승인분은 billed=false로 남고 발행이 선불 차단에 걸려 영구 미청구가 된다 | sweep:S-B-postpaid-billing |
| routes/campaigns.ts:1514 | 테스트 결과 화면의 스팸 비용을 LIMIT 100 목록에서만 합산한다(B-0925-5) | sweep:S-F-spam-test |
| routes/admin.ts:3205 | 슈퍼관리자 테스트 상세의 스팸 목록이 무료 체험 행을 구분하거나 제외하지 않는다 | sweep:S-F-spam-test |
| routes/spam-filter.ts:85 | 사용자별 진행 중 검사 확인이 잠금 없이 조회한 뒤 삽입해, 동시 요청이면 이중 차감될 수 있다 | sweep:S-F-spam-test |
| routes/spam-filter.ts:310 | 결과 조회가 당월 로그 테이블만 봐서 월말에 걸친 검사를 timeout으로 오판한다(spam-test-queue.ts:400 동일) | sweep:S-F-spam-test |
| routes/spam-filter.ts:36 | 스팸 검사 발신번호가 회사에 등록된 회신번호인지 확인하지 않는다 | sweep:S-F-spam-test |
| routes/spam-filter.ts:526 | 앱 리포트가 통신사·유형으로만 결과 행을 갱신해, 같은 통신사 기기가 2대면 잘못 매칭된다 | sweep:S-F-spam-test |
| utils/send-usage-aggregation.ts:1872 | 스팸 검사의 failed·timeout(전달 실패·미판정) 행도 청구 성공으로 집계한다 | sweep:S-F-spam-test |
| utils/spam-test-queue.ts:216 | 결과 행을 적재 전에 미리 만들어, 부분 적재 실패 때 NULL 행이 남고 선불만 과금된다 | sweep:S-F-spam-test |
| routes/spam-filter.ts:759 | /tests/:id가 t.*(first_recipient 고객 정보 포함)를 같은 회사 다른 분류코드 사용자에게도 반환한다 | sweep:S-F-spam-test |
| utils/monthly-usage.ts:105 | 사용금액 표시가 폐지된 '프로 이상 테스트·스팸 무료' 규칙으로 비용을 뺀다 | sweep:S-F-spam-test |
| routes/campaigns.ts:1421 | test-stats가 기간 안 테스트 행 전체를 LIMIT 없이 읽고 메모리에서 정렬한다 | sweep:S-F-spam-test |
| packages/backend/src/routes/campaigns.ts:489 | 브랜드·문자 테스트 발송 실패 환불이 고정 zero-uuid 참조를 공유해 두 번째 이후 실패 환불이 0원이 된다(B-0727-2 ⓒ 잔존) | flow:F3-kakao |
| packages/backend/src/utils/sms-queue.ts:1176 | insertAlimtalkQueue가 8192폭 비토 라인에도 1024자 상한을 하드코딩한다. 초과하면 SENDER_KEY가 빠져 9999로 전량 실패한다 | flow:F3-kakao |
| packages/backend/src/utils/direct-send-processor.ts:196 | 직접발송·AI 브랜드 조립에 etcJsonMax를 넘기지 않아 비토 라인에서도 1024 한도가 걸린다. 캐러셀 등은 청크가 전량 미적재된다 | flow:F3-kakao |
| packages/backend/src/routes/campaigns.ts:3786 | /brand-send 예약(reservedDate) 발송이 즉시 status='completed'로 기록된다. 예약 취소 게이트(scheduled/draft)를 통과하지 못해 취소할 수 없다 | flow:F3-kakao |
| packages/backend/src/routes/alimtalk.ts:125 | IMC 웹훅은 HMAC·IP 환경값이 없으면 무인증으로 통과한다(10MB). kakao_webhook_events 보존·정리 정책이 없다 | flow:F3-kakao |
| packages/backend/src/utils/prepaid.ts:516 | prepaidReverseOverRefund 회수가 잔액 하한 없이 차감돼 음수 잔액이 생길 수 있다 | flow:F3-kakao |
| packages/backend/src/utils/brand-message.ts:1929 | /brand-send 동기 경로에서 차감 커밋 뒤 첫 배치 적재 전에 재시작하면, 처리수 0이라 sweeper 산식이 손대지 않아 영구 미환불된다 | flow:F3-kakao |
| packages/backend/src/utils/sms-result-map.ts:132 | 7305(성공불확실·30일 대기)가 PENDING_CODES에 없어 실패로 집계되고 즉시 환불된다. 14일 창 밖 성공은 회수되지 않는다 | flow:F3-kakao |
| packages/backend/src/utils/alimtalk-webhook-handler.ts:199 | IMC 리포트 웹훅은 저장만 하고 결과·정산에 반영하지 않는다(Phase 2 TODO). 알림톡 결과는 SMSQ 경로에만 의존한다 | flow:F3-kakao |
| utils/mysql-refund-sweeper.ts:426 | '타임아웃 실패 환불' 기록 경로가 2026-07-06에 제거됐는데 reverseTimeoutRefundIfRecovered가 30초마다 헛조회한다 | chunk:s1-01 |
| utils/mysql-refund-sweeper.ts:172 | (회사,사용자) 그룹마다 사실상 같은 전 라인+LOG 테이블 UNION 집계를 반복한다(회사 단위로 묶으면 1회로 충분) | chunk:s1-01 |
| utils/sms-queue.ts:855 | 집계 LOG가 당월·전월뿐이라 같은 campaign id를 2개월 뒤 재발송하면 이전 회차 실패가 FAIL 누적 항아리를 선점해 새 회차 실패 환불이 삼켜진다. 과거 scheduled_at이 남아 있으면 sweeper 후보에서도 빠진다(mysql-refund-sweeper.ts:129) | chunk:s1-01 |
| utils/scheduled-cleanup-worker.ts:23 | setInterval 1분 정리 작업에 중첩 실행 가드가 없어 60초 넘는 정리가 겹쳐 돈다 | chunk:s1-01 |
| utils/send-usage-aggregation.ts:782 | 테스트 발송 청구가 msg_type 'S'가 아니면 전부 TEST_LMS로 분류돼 테스트 MMS가 LMS 단가로 청구된다(1857행도 같다) | chunk:s1-01 |
| utils/send-usage-aggregation.ts:778 | 브랜드 테스트(campaigns.ts:451-458, app_etc1=userId)는 app_etc1='test' 조건에 안 걸려 후불 청구에서 빠진다 | chunk:s1-01 |
| utils/send-usage-aggregation.ts:619 | 레거시·미완 phase 직접발송의 분할이 월 경계를 넘으면, 다음 달 발송분은 캠페인 기준일이 전월이라 어느 달 청구에도 실리지 않는다 | chunk:s1-01 |
| utils/send-usage-aggregation.ts:170 | 청구 테이블이 is_active 라인그룹만 모아서, 비활성화된 그룹 전용 라인의 과거 발송분이 청구에서 빠진다 | chunk:s1-01 |
| utils/sms-queue.ts:1176 | 비토 라인 k_etc_json 실제 폭(8192) 대신 1024를 하드코딩해 넘으면 SENDER_KEY를 넣지 않는다(9999 실패) | chunk:s1-01 |
| utils/sms-queue.ts:249 | invalidateLineGroupCache가 companyUsers:, all-bulk, all-bito 캐시를 비우지 않아 라인 변경 뒤 TTL 동안 집계·큐 작업 테이블이 낡은 값을 쓴다 | chunk:s1-01 |
| utils/payment-processor.ts:137 | 승인 응답에 totPrice가 없거나 0이면 금액 위변조 검증을 건너뛰고(fail-open), MOID와 orderId 대조도 없다 | chunk:s1-01 |
| utils/prepaid.ts:49 | loadDeductLedger가 BRAND 축에도 message_type NULL 행을 합산한다. sweeper(BRAND는 NULL 제외, mysql-refund-sweeper.ts:254-259)와 원장 축이 다르다 | chunk:s1-01 |
| utils/message-sanitizer.ts:25 | EMOJI_RANGES 0x2600-0x27BF가 ★☆✓☎♥ 같은 EUC-KR 표기 가능 문자를 지워, SPECIAL_CHAR_MAP의 해당 치환이 실행되지 않는 코드가 된다 | chunk:s1-01 |
| packages/backend/src/routes/campaigns.ts:959 | 중복 발송 방지가 SELECT 뒤 INSERT(잠금·유니크 없음)라 같은 캠페인에 동시 요청이 오면 둘 다 통과해 이중 차감·이중 적재된다(프론트 isSending·retryRef 가드만 있음) | flow:F1-campaign-send |
| packages/backend/src/routes/campaigns.ts:860 | 발송 게이트가 'sending'만 막아 cancelled·failed 캠페인도 API로 재발송된다. 캠페인 단위 NOT_LOADED·CANCEL 환불 항아리가 앞 실행의 환불을 삼켜 두 번째 실행의 0행 적재·취소 환불이 0원이 된다(sweeper도 처리수 0·cancelled라 못 고침) | flow:F1-campaign-send |
| packages/backend/src/routes/campaigns.ts:1259 | 완료 캠페인을 재발송해 대상 수가 바뀌면 protect_completed_target_count 트리거가 적재 뒤 UPDATE를 막고, 요청이 catch(failed 처리)로 떨어진다 | flow:F1-campaign-send |
| packages/backend/src/routes/campaigns.ts:3297 | 예약 시간 변경이 브랜드 발송 가능 시간(08:00~20:50)을 다시 검사하지 않고 F행 sendreq_time만 옮긴다. 금지 시각으로 옮기면 브랜드분이 카카오 3022로 폐기된다 | flow:F1-campaign-send |
| packages/backend/src/routes/campaigns.ts:3594 | draft 삭제가 차감 원장이 걸린 실행 행과 캠페인까지 하드 삭제한다(크래시로 남은 캠페인의 흔적이 사라짐) | flow:F1-campaign-send |
| packages/backend/src/utils/campaign-lifecycle.ts:521 | AI 결과 동기화가 캠페인 status를 현재 상태 조건 없이 'completed'로 덮는다(실행 행이 남은 cancelled 캠페인을 되살릴 수 있음) | flow:F1-campaign-send |
| packages/backend/src/routes/campaigns.ts:1133 | prepaidDeduct의 DB 오류(ok:false)도 402 insufficientBalance로 응답해 잔액 부족으로 잘못 안내한다 | flow:F1-campaign-send |
| packages/backend/src/routes/campaigns.ts:1221 | 피로도 카운터가 미적재 수신자까지 발송으로 기록해 이후 광고 발송에서 그 사람들을 잘못 제외한다 | flow:F1-campaign-send |
| packages/backend/src/utils/sms-queue.ts:1444 | 배치 INSERT 오류를 커밋 여부를 따지지 않고 전부 미적재로 센다. 타임아웃 뒤 커밋되면 발송과 환불이 함께 일어난다(30분 뒤 reverse가 회수하기 전까지 잔액 과다) | flow:F1-campaign-send |
| packages/backend/src/utils/mysql-refund-sweeper.ts:320 | 48시간 안의 캠페인마다 30초마다 no-op prepaidRefund·prepaidReverseOverRefund 트랜잭션(companies FOR UPDATE)을 반복해 같은 회사의 발송 차감과 행 잠금을 두고 경합한다 | flow:F1-campaign-send |
| packages/backend/src/utils/scheduled-cleanup-worker.ts:23 | 1분 주기 cleanupScheduledCampaigns에 겹침 방지 플래그가 없다(한 번에 60초를 넘기면 같은 캠페인을 동시에 집계·갱신) | sweep:S-D-workers |
| packages/backend/src/utils/alimtalk-jobs.ts:730 | 템플릿 동기화에 겹침 방지가 없다. 알림 수신자가 없는 회사의 승인 템플릿은 alarm_notified_status가 NULL로 남아 IMC를 무기한 재조회한다(ORDER 없는 LIMIT 100 · 5분이 넘으면 담당자 알림 중복) | sweep:S-D-workers |
| packages/backend/src/utils/mysql-refund-sweeper.ts:428 | '타임아웃 실패 환불'은 2026-07-06에 생성이 제거됐는데 reverse 조회가 30초마다 헛돈다 | sweep:S-D-workers |
| packages/backend/src/utils/direct-send-worker.ts:244 | C-10 취소 정산 keepCount가 1회 실측이다. 라이브 큐에 결과만 도착하고 이력으로 옮겨지기 전인 성공 행은 세지 않아 과다 환불될 수 있고, 취소 캠페인은 초과 환불 회수 경로가 없다 | sweep:S-D-workers |
| packages/backend/src/utils/direct-send-worker.ts:273 | C-11 끊긴 적재 recover가 updated_at<10분을 조건으로 쓴다. mysql-refund-sweeper가 결과 갱신 때마다 updated_at=NOW()를 찍어서 즉시발송 캠페인의 정리·미적재 환불이 결과가 안정될 때까지 밀린다 | sweep:S-D-workers |
| packages/backend/src/utils/cancelled-queue-sweeper.ts:39 | 취소 캠페인의 잔존 대기 행을 삭제만 하고 환불하지 않는다(cancelled는 sweeper·sync 대상 밖 · 직접발송 적재 워커 정산 밖 경로에서 생긴 잔존분은 미환불) | sweep:S-D-workers |
| packages/backend/src/utils/agent-charge-reconciler.ts:39 | 게이트웨이에 영구 미반영인 요청이 오래된 순 상위 20을 차지하면 뒤 요청은 끝내 검사되지 않는다(표시 상태 기아) | sweep:S-D-workers |
| packages/backend/src/utils/direct-send-worker.ts:46 | 5초마다 campaigns에 send_config ? 'refundPending*' JSONB 키 조회 2회와 send_phase 조회 3회를 한다. 저장소에는 해당 인덱스 정의가 없다 | sweep:S-D-workers |
| packages/backend/src/utils/campaign-sync-worker.ts:304 | 여정 결과 LMS를 적재한 뒤 markNotified UPDATE가 실패하면 다음 5분 주기에 같은 LMS가 다시 나간다 | sweep:S-D-workers |
| utils/auto-campaign-worker.ts:1125 | 자동발송: 차감 뒤 예외(개별회신 조회·080 조회·알림톡 비정형 오류)면 markFailed만 하고 환불·의무 기록이 없음(캠페인 'sending'·적재 0이라 sweeper도 미환불) | sweep:S-A-prepaid |
| utils/auto-campaign-worker.ts:1072 | 자동발송: 개별회신번호로 제외된 고객분 차감이 적재 0건(failed)일 때 환불되지 않음(failCount가 filtered 기준 · sweeper는 처리수 0이면 미적재 0) | sweep:S-A-prepaid |
| routes/campaigns.ts:1161 | AI 캠페인 재발송(서버가 cancelled·draft 재발송을 막지 않음) 시 CANCEL 항아리를 캠페인 전체가 공유해 두 번째 both 보상·예약 취소 환불이 0원이 됨(campaign-lifecycle.ts:349 '캠페인당 1회' 전제 붕괴 · 현재 UI 경로는 없음) | sweep:S-A-prepaid |
| utils/spam-test-queue.ts:494 | 큐 스팸 테스트 실행 실패 시 선차감 환불 경로 없음('spam' 환불 호출부 0건 · POST /test는 BUGS.md:108과 같은 부류) | sweep:S-A-prepaid |
| utils/mysql-refund-sweeper.ts:352 | 여정 단계 캠페인(차감 원장이 'journey'라 캠페인 차감 0)을 불변식 검사해 '초과환불 잔존' 거짓 경보가 캠페인마다 6시간 간격으로 최대 14일 반복 | sweep:S-A-prepaid |
| utils/journey-executor.ts:950 | 여정 문자 적재 행 msg_type에 'SMS'/'LMS'/'MMS' 원문을 넣음(다른 경로는 toQtmsgType S/L/M) — bulkInsertSmsQueue의 MMS 라인 분리(r[3]==='M')가 무력화됨 | sweep:S-A-prepaid |
| routes/campaigns.ts:3182 | 적재 중인 예약에서 아직 적재되지 않은 번호를 삭제하면 '삭제되었습니다'로 끝나지만, 그 번호는 뒤에 적재돼 발송됨 | sweep:S-A-prepaid |
| routes/admin.ts:3708 | 수동 잔액 조정이 잔액 UPDATE와 원장 INSERT를 트랜잭션 없이 따로 커밋함(INSERT 실패 시 이력 없는 잔액 변동 · amount가 문자열이면 balance_before가 문자열 연결로 기록됨) | sweep:S-A-prepaid |
| utils/campaign-lifecycle.ts:84 | 예약 정리 UPDATE에 status='scheduled' 조건이 없어 발송 시각 이후 취소된 캠페인을 completed로 덮는다. 이후 sweeper가 미적재로 한 번 더 환불하고, 30분 뒤 회수된다 | flow:F4-scheduled-auto |
| utils/scheduled-cleanup-worker.ts:23 | 1분 setInterval에 실행 중 가드가 없어, 한 번 실행이 60초를 넘기면(D227 사례 30~40초) 정리 작업이 겹쳐 쌓인다 | flow:F4-scheduled-auto |
| utils/mysql-refund-sweeper.ts:355 | 선불 여정 step 캠페인은 원장상 차감 0·성공 N이라 '환불 불변식 위반 — 초과환불 잔존' 거짓 경보 문자가 캠페인마다 6시간 주기로 14일간 나간다 | flow:F4-scheduled-auto |
| utils/cancelled-queue-sweeper.ts:39 | 취소 캠페인에 남은 대기 행을 환불 없이 삭제한다. cancelCampaign이 직접발송 워커의 마지막 청크 fin보다 늦게 cancelled를 쓰는 경합에서 그 행들은 차감만 되고 발송도 환불도 안 된다 | flow:F4-scheduled-auto |
| routes/campaigns.ts:3305 | 예약 시각 변경이 send_config.scheduledAt을 고치지 않고 적재 단계(queued·processing)도 보지 않아, 이후 적재분이 옛 시각에 나간다. 새 시각의 야간 광고 검사도 없다(API 전용, 화면 호출 없음) | flow:F4-scheduled-auto |
| routes/campaigns.ts:3380 | 적재 전(queued) 예약에서 문안을 고치면 PG만 바뀌고, 워커는 send_config.message(옛 문안)로 보낸다(API 전용) | flow:F4-scheduled-auto |
| utils/campaign-lifecycle.ts:219 | 분할 예약은 첫 회차 시각 뒤 정리 워커가 completed로 바꿔, 다음날 아침으로 이월된 남은 회차를 사용자도 슈퍼관리자도 취소할 수 없다(admin.ts:2410 역시 scheduled만 허용) | flow:F4-scheduled-auto |
| routes/campaigns.ts:2960 | POST /:id/cancel에 company_user 본인 캠페인 확인이 없어, 같은 회사 다른 사용자의 예약을 취소할 수 있다(DELETE /:id는 3560에서 확인함) | flow:F4-scheduled-auto |
| utils/continuous-operator.ts:1688 | createDirectSendCampaign 커밋 뒤, campaign_id 마커 전에 프로세스가 죽으면 30분 뒤 '발송 준비 중단'으로 admin_review로 내려간다. 담당자가 재승인하면 같은 대상에게 두 번 발송된다 | flow:F4-scheduled-auto |
| utils/journey-executor.ts:1017 | 큐 INSERT 커밋 뒤 step_log 'sent' 기록 전에 재시작되면 멱등 가드(461)가 비어 같은 고객에게 재발송·재차감된다(좁은 창) | flow:F4-scheduled-auto |
| utils/direct-send-processor.ts:350 | 피로도 카운터가 예약 발송을 적재일(오늘 KST)로 기록하고 취소해도 되돌리지 않는다. 일부만 적재된 청크도 전원을 기록해, 받지 않은 고객이 다른 광고 발송에서 제외된다 | flow:F4-scheduled-auto |
| utils/continuous-operator.ts:1419 | 자율 발송 패스가 운영자 최대 100건의 AI 생성·스팸 실테스트를 순차로 끝낸 뒤에야 돌아서, 예약 발송 시각이 수십 분 이상 밀릴 수 있다 | flow:F4-scheduled-auto |
| utils/auto-campaign-worker.ts:1127 | (봉인 상태·재가동 시) 차감 뒤 예외는 markFailed만 하고 환불하지 않는다. campaign_runs도 없어 처리 수 0이라 sweeper도 미적재를 환불하지 못한다 | flow:F4-scheduled-auto |
| utils/journey-executor.ts:1092 | 여정 발송 창이 8~21시로 하드코딩돼 있어 SEND_HOURS 환경설정과 따로 논다 | flow:F4-scheduled-auto |
| routes/results.ts:724 | /messages·/export에 company_user 본인 캠페인 제한이 없어 같은 회사 다른 사용자의 발송내역·수신번호를 열람할 수 있음(상세 :570만 제한) | flow:F6-result-sync |
| routes/results.ts:718 | 발송내역·엑셀·상세 분포가 NOW 기준 당월·전월 LOG만 봐서 전전월 이전 캠페인은 0행으로 나옴(상단 카운트는 sentTables 축이라 서로 불일치) | flow:F6-result-sync |
| routes/results.ts:710 | /messages의 limit 상한이 없어 대량 limit이면 캠페인 전 행(본문 포함)을 메모리에 적재함 — 단일 PM2 OOM 위험 | flow:F6-result-sync |
| routes/results.ts:251 | /campaigns의 limit 상한이 없어 한 요청이 수천 캠페인의 MySQL 집계를 유발함 | flow:F6-result-sync |
| routes/results.ts:101 | 요약 기본 월이 toISOString(UTC) 기준이라 KST 매월 1일 00~09시에는 전월로 표시됨 | flow:F6-result-sync |
| utils/campaign-sync-worker.ts:259 | 여정 결과 알림의 '2시간 경과 시 대기 포함 발송' 분기가 조회 창(2시간)과 같아 도달하지 못함 — 대기가 남은 묶음의 알림이 영구 누락됨 | flow:F6-result-sync |
| utils/sms-result-map.ts:132 | 7305(성공불확실)는 행 표시가 '대기'인데 PENDING_CODES에 없어 집계·환불에서는 실패로 셈 | flow:F6-result-sync |
| utils/campaign-sync-worker.ts:415 | 0건 보류 캠페인이 하한 없는 72h 갈래에서 영구히 매시간 재조회됨(보류 건이 늘수록 MySQL 부하 누적) | flow:F6-result-sync |
| utils/campaign-lifecycle.ts:84 | 예약 정리가 sent_count를 MySQL 실측으로 덮어씀. 라인이 누락되면 0/failed로 굳어 status≠completed가 되고 후불 청구에서 빠짐(B-0914-1 잔여 경로) | flow:F6-result-sync |
| routes/campaigns.ts:1707 | commit 경로에 kakao_enabled 확인·MMS 이미지 필수(validateMmsPayload)·본문 링크 결함 검사가 없다(동기 경로와 불일치 · API로만 도달) | flow:F2-direct-send |
| utils/direct-send-processor.ts:154 | 클라이언트가 보낸 MMS 이미지 절대경로를 회사 소유·경로 검증 없이 큐 file_name1~3에 싣는다(동기 경로 campaigns.ts:2443도 같음) | flow:F2-direct-send |
| utils/direct-send-worker.ts:630 | 적재 0건이나 일부만으로 끝난 예약 캠페인(끊긴 적재 정리 포함)이 status='scheduled'로 남아 나머지가 발송되지 않는다는 사실이 화면에 드러나지 않는다 | flow:F2-direct-send |
| utils/direct-send-worker.ts:286 | 워커가 전 회사 캠페인을 한 줄로 순차 처리해, 대형 캠페인 적재 중에는 다른 회사 즉시발송·대행·플래너 발송이 수 분 대기한다 | flow:F2-direct-send |
| routes/campaigns.ts:2551 | 동기 /direct-send가 차감 뒤 첫 적재 전에 재시작되면 전액 미환불(sweeper는 처리수 0이면 미적재 0으로 계산 · status 'sending' 고정) | flow:F2-direct-send |
| routes/campaigns.ts:2940 | 동기 경로에서 적재가 끝난 뒤 후처리만 실패해도 status='failed'와 500('자동 환불') 응답이 나간다. 예약 취소가 불가해지고 사용자가 재발송해 중복 발송될 위험이 있다 | flow:F2-direct-send |
| utils/direct-send-core.ts:46 | 중복제거를 끈 채 수신거부 번호가 중복되면 count(DISTINCT)와 워커 삭제(해당 번호 전 행)가 어긋나, 확인 창·차감 건수가 실제 발송보다 크다(미적재 환불로 사후 보정) | flow:F2-direct-send |
| utils/direct-send-core.ts:90 | 야간 광고 게이트가 시작 시각만 본다. 20:5x에 커밋한 즉시 대량 광고의 뒤 청크가 21시 이후 NOW()로 적재된다 | flow:F2-direct-send |
| routes/campaigns.ts:1778 | commit 알림톡에서 useIndividualCallback=true이고 callback이 비어 있으면 회신번호 검증 없이 빈 회신번호로 적재된다(대체문자 실패 · API로만 도달) | flow:F2-direct-send |
| routes/campaigns.ts:1692 | /direct-send/count와 countStagingFiltered의 중복·수신거부 집계에 company_id 조건이 없다(타사 stagingId를 넣으면 그 staging 통계가 새어 나감) | flow:F2-direct-send |
| utils/direct-send-worker.ts:286 | 할 일이 없어도 5초마다 campaigns 조회를 여러 번 돈다(후보 R208) | flow:F2-direct-send |
| routes/campaigns.ts:1393 | test-stats가 fromDate/toDate 형식 검증 없이 월 루프를 돌아 임의 범위(0001~9999)면 수십만 번 `SELECT 1 FROM SMSQ_SEND_*_YYYYMM`를 순차 실행(인증 사용자 DoS) | sweep:S-E-mysql-queue |
| utils/journey-executor.ts:950 | 여정 문자 행 msg_type에 'SMS'/'LMS'/'MMS' 원문 적재 — toQtmsgType를 거치지 않아 S/L/M 계약 위반이고, MMS 레인 분리 판정(r[3]==='M')도 빗나감 | sweep:S-E-mysql-queue |
| utils/campaign-sync-worker.ts:304 | 여정 결과 안내 LMS 적재가 0건이어도 result_notified_at을 찍어 안내가 영구 유실(같은 형태: system-alert.ts:175가 적재 0이어도 쿨다운 마킹 → 돈 불변식 경보 억제) | sweep:S-E-mysql-queue |
| routes/campaigns.ts:3297 | /reschedule이 적재 전·중 직접발송 캠페인의 나머지 청크를 워커의 옛 cfg.scheduledAt에 적재(화면 호출은 0건, API로만 닿음) | sweep:S-E-mysql-queue |
| routes/campaigns.ts:3229 | 수신자 삭제가 target_count를 '현재 대기 행 수'로 덮음 — 적재 중이면 대상 수가 과소 기록됨 | sweep:S-E-mysql-queue |
| utils/sms-queue.ts:700 | getCampaignSmsTables가 sent_at(직접발송은 적재 시각) ±1개월 LOG만 봄 — stats-table-scope.ts:7(Codex 2R)이 지적한 '선예약 직접발송 창 밖 LOG' 결함이 슈퍼관리자 상세에 남음 | sweep:S-E-mysql-queue |
| utils/journey-executor.ts:898 | 공유 step 캠페인의 sentTables를 실행마다 현재 라인으로 덮어써, 하루 중 라인 재배정 시 앞선 행의 라인이 기록 경로 통계에서 빠짐 | sweep:S-E-mysql-queue |
| routes/results.ts:710 | /messages의 limit·page에 상한이 없음 — limit=1000000이면 캠페인 전 행(본문 포함)을 한 응답으로 Node 메모리에 올리고, 숫자가 아니면 `LIMIT NaN`으로 SQL 오류 | sweep:S-E-mysql-queue |
| utils/expired-pending-sweeper.ts:35 | 1분마다 인덱스 없는 조건(rsv1·status_code·mobsend_time)으로 전 bulk LIVE 테이블을 풀스캔(COUNT·GROUP BY·UPDATE·재COUNT 최대 4회) | sweep:S-E-mysql-queue |
| utils/sms-queue.ts:476 | smsBatchAggByGroup의 `app_etc1 IN` 집계에 인덱스 힌트가 없음 — 정산에서 실측한 옵티마이저 풀스캔(12.9초, send-usage-aggregation.ts:247-255) 조건이 30초 선불 sweeper·동기화 집계에도 성립할 수 있음 | sweep:S-E-mysql-queue |
| routes/campaigns.ts:3011 | 예약 수신자 페이지 정렬 키 seqno는 테이블마다 독립 — 여러 라인에 분산된 캠페인은 동률 seqno 때문에 페이지 경계에서 중복·누락, 음수 offset이면 SQL 오류 | sweep:S-E-mysql-queue |
