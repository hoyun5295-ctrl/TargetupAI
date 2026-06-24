"use strict";
/**
 * CT-16: 휴머스온 IMC 관리 API 호출 컨트롤타워 (유일 진입점)
 *
 * ALIMTALK-DESIGN.md §5-2 기준.
 *
 * 담당: 관리 API (발신프로필 / 알림톡·브랜드 템플릿 / 알림수신자 / 카테고리 / 이미지 업로드)
 * **발송 API는 담당하지 않는다** — 발송은 CT-04 sms-queue.ts의 insertAlimtalkQueue/insertKakaoQueue/insertKakaoBasicQueue → QTmsg Agent 경유.
 *
 * Phase 0 대응:
 *   - 환경변수(IMC_API_KEY / IMC_BASE_URL_*) 미설정 시에도 서버 부팅 가능.
 *   - 최초 API 호출 시점에 Lazy init하면서 env 누락을 명확한 에러로 표출.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadMarketingAgreeFile = exports.uploadBrandCarouselCommerceImages = exports.uploadBrandCarouselFeedImages = exports.uploadBrandWideListImages = exports.uploadBrandWideListFirstImage = exports.uploadBrandWideImage = exports.uploadBrandDefaultImage = exports.uploadAlimtalkHighlightImage = exports.uploadAlimtalkTemplateImage = exports.ImcApiError = void 0;
exports.resetImcClient = resetImcClient;
exports.requestSenderToken = requestSenderToken;
exports.createSender = createSender;
exports.listSenders = listSenders;
exports.getSender = getSender;
exports.updateSenderUnsubscribe = updateSenderUnsubscribe;
exports.updateCustomSenderKey = updateCustomSenderKey;
exports.releaseSenderDormant = releaseSenderDormant;
exports.checkBrandTargeting = checkBrandTargeting;
exports.applyBrandTargeting = applyBrandTargeting;
exports.listSenderCategories = listSenderCategories;
exports.getSenderCategory = getSenderCategory;
exports.createAlimtalkTemplate = createAlimtalkTemplate;
exports.updateAlimtalkTemplate = updateAlimtalkTemplate;
exports.getAlimtalkTemplate = getAlimtalkTemplate;
exports.listAlimtalkTemplates = listAlimtalkTemplates;
exports.getRecentlyModifiedAlimtalkTemplates = getRecentlyModifiedAlimtalkTemplates;
exports.deleteAlimtalkTemplate = deleteAlimtalkTemplate;
exports.requestInspection = requestInspection;
exports.requestInspectionWithFile = requestInspectionWithFile;
exports.cancelInspection = cancelInspection;
exports.releaseTemplateDormant = releaseTemplateDormant;
exports.updateCustomCode = updateCustomCode;
exports.updateExposure = updateExposure;
exports.updateServiceMode = updateServiceMode;
exports.listAlarmUsers = listAlarmUsers;
exports.createAlarmUser = createAlarmUser;
exports.updateAlarmUser = updateAlarmUser;
exports.deleteAlarmUser = deleteAlarmUser;
exports.createBrandTemplate = createBrandTemplate;
exports.updateBrandBasicTemplate = updateBrandBasicTemplate;
exports.getBrandTemplate = getBrandTemplate;
exports.listBrandTemplates = listBrandTemplates;
exports.deleteBrandTemplate = deleteBrandTemplate;
exports.listTemplateCategories = listTemplateCategories;
exports.getTemplateCategory = getTemplateCategory;
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
class ImcApiError extends Error {
    code;
    httpStatus;
    responseBody;
    constructor(code, httpStatus, responseBody, message) {
        super(`[IMC ${code}] ${message}`);
        this.code = code;
        this.httpStatus = httpStatus;
        this.responseBody = responseBody;
        this.name = 'ImcApiError';
    }
}
exports.ImcApiError = ImcApiError;
// ════════════════════════════════════════════════════════════
// 환경별 클라이언트 (Lazy init)
// ════════════════════════════════════════════════════════════
let _client = null;
let _apiKey = null;
function resolveBaseURL() {
    const env = process.env.IMC_ENV || 'STG';
    const url = env === 'PRD' ? process.env.IMC_BASE_URL_PRD : process.env.IMC_BASE_URL_STG;
    if (!url) {
        throw new Error(`[IMC] 환경변수가 설정되지 않았습니다 — IMC_BASE_URL_${env}=? .env 확인 필요`);
    }
    return url.replace(/\/$/, '');
}
function resolveApiKey() {
    const env = process.env.IMC_ENV || 'STG';
    const key = env === 'PRD' ? process.env.IMC_API_KEY : process.env.IMC_API_KEY_SANDBOX;
    if (!key) {
        throw new Error(`[IMC] 환경변수가 설정되지 않았습니다 — IMC_API_KEY${env === 'PRD' ? '' : '_SANDBOX'}=? .env 확인 필요`);
    }
    return key;
}
function getClient() {
    if (_client)
        return _client;
    const baseURL = resolveBaseURL();
    _apiKey = resolveApiKey();
    _client = axios_1.default.create({
        baseURL,
        headers: {
            'x-imc-api-key': _apiKey,
            'Content-Type': 'application/json',
        },
        timeout: 30_000,
    });
    _client.interceptors.response.use((res) => res, (err) => {
        const code = err.response?.data?.code || 'UNKNOWN';
        const message = err.response?.data?.message || err.message;
        throw new ImcApiError(String(code), err.response?.status || 500, err.response?.data, message);
    });
    return _client;
}
/** 외부에서 명시적으로 reset하고 싶을 때 (env 교체 후 재초기화용) */
function resetImcClient() {
    _client = null;
    _apiKey = null;
}
function getApiKey() {
    if (_apiKey)
        return _apiKey;
    getClient();
    return _apiKey;
}
async function requestSenderToken(body) {
    const res = await getClient().post('/kakao-management/api/v1/sender/token', body);
    return res.data;
}
async function createSender(body) {
    const res = await getClient().post('/kakao-management/api/v1/sender', body);
    return res.data;
}
/**
 * 발신프로필 목록 조회 — IMC 공식 파라미터 (11_04_55_발신프로필 목록 조회.txt 대조 D131)
 *   정식 필드: name, profileStatus, senderKey, status, uuid, customSenderKey,
 *             block, dormant, alimtalk, brandMessage, category, categoryCode,
 *             page(0~), size(1~100)
 *   과거 잘못된 필드명(count, yellowId)을 IMC 스펙에 맞춰 교정.
 */
async function listSenders(params = {}) {
    const res = await getClient().get('/kakao-management/api/v1/sender', { params });
    return res.data;
}
async function getSender(senderKey) {
    const res = await getClient().get(`/kakao-management/api/v1/sender/${senderKey}`);
    return res.data;
}
async function updateSenderUnsubscribe(senderKey, body) {
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/unsubscribe`, body);
    return res.data;
}
async function updateCustomSenderKey(senderKey, customSenderKey) {
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/custom-sender-key`, { customSenderKey });
    return res.data;
}
async function releaseSenderDormant(senderKey) {
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/release`);
    return res.data;
}
async function checkBrandTargeting(senderKey) {
    const res = await getClient().get(`/kakao-management/api/v1/sender/${senderKey}/brand-message/check`);
    return res.data;
}
async function applyBrandTargeting(senderKey, body) {
    const res = await getClient().post(`/kakao-management/api/v1/sender/${senderKey}/brand-message`, body);
    return res.data;
}
async function listSenderCategories() {
    const res = await getClient().get('/kakao-management/api/v1/sender/category');
    return res.data;
}
async function getSenderCategory(categoryCode) {
    const res = await getClient().get(`/kakao-management/api/v1/sender/category/${categoryCode}`);
    return res.data;
}
/**
 * 버튼/퀵리플라이 필드명 camelCase → snake_case 변환 (IMC 문서 규약).
 * Frontend ButtonEditor/QuickReplyEditor는 camelCase 타입을 쓰므로 IMC 전송 직전에 변환.
 * 이미 snake_case가 세팅된 필드는 그대로 유지(idempotent).
 *
 * IMC 실 스펙 (10_57_49_문자 관리.txt):
 *   buttonList[i]: { name, type, url_mobile, url_pc, scheme_android, scheme_ios,
 *                    chat_extra, chat_event, biz_form_id, plugin_id, relay_id,
 *                    oneclick_id, product_id, tel_number, map_address,
 *                    map_coordinates, target }
 *   quickReplyList[i]: buttonList와 유사 + biz_form_id
 */
function toImcButton(b) {
    if (!b || typeof b !== 'object')
        return b;
    const pick = (camel, snake) => b[snake] !== undefined ? b[snake] : b[camel];
    const out = {};
    if (b.name !== undefined)
        out.name = b.name;
    if (b.type !== undefined)
        out.type = b.type;
    const map = [
        ['urlMobile', 'url_mobile'],
        ['urlPc', 'url_pc'],
        ['schemeAndroid', 'scheme_android'],
        ['schemeIos', 'scheme_ios'],
        ['chatExtra', 'chat_extra'],
        ['chatEvent', 'chat_event'],
        ['bizFormId', 'biz_form_id'],
        ['pluginId', 'plugin_id'],
        ['relayId', 'relay_id'],
        ['oneclickId', 'oneclick_id'],
        ['productId', 'product_id'],
        ['telNumber', 'tel_number'],
        ['mapAddress', 'map_address'],
        ['mapCoordinates', 'map_coordinates'],
    ];
    for (const [camel, snake] of map) {
        const v = pick(camel, snake);
        if (v !== undefined && v !== null && v !== '')
            out[snake] = v;
    }
    if (b.target !== undefined)
        out.target = b.target;
    return out;
}
/** IMC 전송 직전 body 정규화: buttonList/quickReplyList 각 항목을 snake_case 변환 */
function normalizeTemplateBodyForImc(body) {
    const out = { ...body };
    if (Array.isArray(body.buttonList)) {
        out.buttonList = body.buttonList.map(toImcButton);
    }
    if (Array.isArray(body.quickReplyList)) {
        out.quickReplyList = body.quickReplyList.map(toImcButton);
    }
    return out;
}
async function createAlimtalkTemplate(senderKey, body) {
    const normalized = normalizeTemplateBodyForImc(body);
    try {
        console.log(`[alimtalk][createTemplate] senderKey=${senderKey} payload=${JSON.stringify(normalized).slice(0, 2000)}`);
        // ★ D139 #2 (0425): templateRepresentLink 전달 여부 명시 로그
        //   직원 보고 "대표링크 IMC 미전달" 진단 — 페이로드에 실제 포함되었는지 확정 가능.
        const repLink = normalized.templateRepresentLink;
        if (repLink && typeof repLink === 'object') {
            console.log(`[alimtalk][createTemplate] templateRepresentLink 포함 | ${JSON.stringify(repLink)}`);
        }
        else {
            console.log(`[alimtalk][createTemplate] templateRepresentLink 없음 (사용자가 체크박스 OFF or Mobile URL 미입력)`);
        }
    }
    catch {
        /* noop */
    }
    const res = await getClient().post(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template`, normalized);
    // D131: sender 카테고리와 동일한 이중 래핑 대응 (D130 블로커 §2-1).
    //   IMC가 `{code,message,data:{data:{templateCode}}}` 형태로 내려주는 경우가 있어
    //   routes/alimtalk.ts 의 `r.data.templateCode` 접근이 undefined → 400 반환 이슈.
    //   여기서 unwrap하여 소비부 코드 단순화 + 실제 응답 구조도 로깅.
    const data = res.data;
    try {
        console.log(`[alimtalk][createTemplate] response=${JSON.stringify(data).slice(0, 1500)}`);
        // ★ D139 #2 (0425): IMC 응답에 templateRepresentLink 포함 여부 검증 로그
        //   IMC가 페이로드를 받았으면 보통 응답 data에 echo back. 누락 시 IMC 측 무시 의심.
        const respRepLink = data?.data?.templateRepresentLink ?? data?.templateRepresentLink;
        if (respRepLink) {
            console.log(`[alimtalk][createTemplate] IMC 응답 templateRepresentLink 확인됨 | ${JSON.stringify(respRepLink)}`);
        }
        else if (normalized.templateRepresentLink) {
            console.warn(`[alimtalk][createTemplate] ⚠ 페이로드에 templateRepresentLink 보냈으나 응답에 누락 — IMC 측 처리 확인 필요`);
        }
    }
    catch {
        /* noop */
    }
    if (data && data.data && typeof data.data === 'object' && !data.data.templateCode
        && data.data.data && typeof data.data.data === 'object' && data.data.data.templateCode) {
        data.data = data.data.data;
    }
    return data;
}
async function updateAlimtalkTemplate(senderKey, templateCode, body) {
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`, normalizeTemplateBodyForImc(body));
    return res.data;
}
async function getAlimtalkTemplate(senderKey, templateCode) {
    const res = await getClient().get(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`);
    return res.data;
}
async function listAlimtalkTemplates(params = {}) {
    const res = await getClient().get('/kakao-management/api/v1/alimtalk/template/list', { params });
    return res.data;
}
async function getRecentlyModifiedAlimtalkTemplates(params = {}) {
    const res = await getClient().get('/kakao-management/api/v1/alimtalk/template/last-modified', { params });
    return res.data;
}
async function deleteAlimtalkTemplate(senderKey, templateCode) {
    const res = await getClient().delete(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`);
    return res.data;
}
async function requestInspection(senderKey, templateCode, comment) {
    const res = await getClient().post(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment`, { comment });
    return res.data;
}
async function requestInspectionWithFile(senderKey, templateCode, comment, fileBuffer, fileName) {
    // ★ IMC 실제 스펙 검증 (10_57_41_문자 관리.txt):
    //   URL: POST /sender/{senderKey}/alimtalk/template/{templateKey}/comment/file
    //   multipart fields: comment (string, required), attachment (binary, required)
    const form = new form_data_1.default();
    form.append('comment', comment);
    form.append('attachment', fileBuffer, fileName);
    const res = await getClient().post(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment/file`, form, { headers: { ...form.getHeaders(), 'x-imc-api-key': getApiKey() } });
    return res.data;
}
async function cancelInspection(senderKey, templateCode) {
    // ★ IMC 실제 스펙 검증 (10_58_01_문자 관리.txt):
    //   URL: PUT /sender/{senderKey}/alimtalk/template/{templateKey}/comment/cancel
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment/cancel`);
    return res.data;
}
async function releaseTemplateDormant(senderKey, templateCode) {
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/release`);
    return res.data;
}
async function updateCustomCode(senderKey, templateCode, customTemplateCode) {
    const res = await getClient().patch(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/custom-code`, { customTemplateCode });
    return res.data;
}
async function updateExposure(senderKey, templateCode, showYn) {
    // ★ IMC 실제 스펙 검증 (10_58_41_문자 관리.txt):
    //   URL: PATCH /sender/{senderKey}/alimtalk/template/{templateKey}/show-yn
    //   body field: showYn (우리 옛 이름 exposureYn은 틀림)
    const res = await getClient().patch(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/show-yn`, { showYn });
    return res.data;
}
async function updateServiceMode(senderKey, templateCode, mode) {
    const res = await getClient().patch(`/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/service-mode`, { serviceMode: mode });
    return res.data;
}
async function listAlarmUsers(params = {}) {
    const res = await getClient().get('/kakao-management/api/v1/alimtalk/template/alarm-users', { params });
    return res.data;
}
async function createAlarmUser(body) {
    const res = await getClient().post('/kakao-management/api/v1/alimtalk/template/alarm-users', body);
    return res.data;
}
async function updateAlarmUser(alarmUserKey, body) {
    const res = await getClient().put(`/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserKey}`, body);
    return res.data;
}
async function deleteAlarmUser(alarmUserKey) {
    const res = await getClient().delete(`/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserKey}`);
    return res.data;
}
async function createBrandTemplate(senderKey, body) {
    const res = await getClient().post(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template`, body);
    return res.data;
}
async function updateBrandBasicTemplate(senderKey, body) {
    const res = await getClient().put(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template`, body);
    return res.data;
}
async function getBrandTemplate(senderKey, templateKey) {
    const res = await getClient().get(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`);
    return res.data;
}
async function listBrandTemplates(params = {}) {
    const res = await getClient().get('/kakao-management/api/v1/brand-message/template/list', { params });
    return res.data;
}
async function deleteBrandTemplate(senderKey, templateKey) {
    const res = await getClient().delete(`/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`);
    return res.data;
}
async function uploadSingleImage(endpoint, fileBuffer, fileName) {
    const form = new form_data_1.default();
    form.append('image', fileBuffer, fileName);
    const res = await getClient().post(endpoint, form, {
        headers: { ...form.getHeaders(), 'x-imc-api-key': getApiKey() },
    });
    const data = res.data;
    // ★ D142+ E (2026-04-29) PDF 0428 알림톡 #1-1/#2: "카카오 응답에 이미지 정보가 없습니다" 근본 수정.
    //   IMC가 `{code,message,data:{data:{imageUrl,imageName}}}` 이중 래핑 응답 케이스 확인됨 (D131 sender/template과 동일 패턴).
    //   uploadSingleImage가 unwrap 없이 res.data 그대로 반환 → frontend `data.imc.data.imageUrl` → undefined → 에러 throw.
    //   해결: data.data.imageUrl 없는데 data.data.data.imageUrl 있으면 unwrap.
    if (data && data.data && typeof data.data === 'object' && !data.data.imageUrl
        && data.data.data && typeof data.data.data === 'object' && data.data.data.imageUrl) {
        console.log(`[alimtalk][uploadImage] 이중 래핑 unwrap: ${endpoint}`);
        data.data = data.data.data;
    }
    // 운영 진단용 raw 로그
    try {
        console.log(`[alimtalk][uploadImage] ${endpoint} code=${data?.code} hasImageUrl=${!!data?.data?.imageUrl} hasImageName=${!!data?.data?.imageName} rawSnippet=${JSON.stringify(data).slice(0, 500)}`);
    }
    catch { /* noop */ }
    return data;
}
async function uploadMultipleImages(endpoint, files, fieldName = 'images') {
    const form = new form_data_1.default();
    for (const f of files)
        form.append(fieldName, f.buffer, f.name);
    const res = await getClient().post(endpoint, form, {
        headers: { ...form.getHeaders(), 'x-imc-api-key': getApiKey() },
    });
    const data = res.data;
    // ★ D142+ E (2026-04-29): 다중 이미지도 동일 unwrap 패턴 — data.list 없는데 data.data.list 있으면 승격.
    if (data && data.data && typeof data.data === 'object' && !Array.isArray(data.data.list)
        && data.data.data && typeof data.data.data === 'object' && Array.isArray(data.data.data.list)) {
        console.log(`[alimtalk][uploadImage(multi)] 이중 래핑 unwrap: ${endpoint}`);
        data.data = data.data.data;
    }
    try {
        console.log(`[alimtalk][uploadImage(multi)] ${endpoint} code=${data?.code} listCount=${data?.data?.list?.length || 0}`);
    }
    catch { /* noop */ }
    return data;
}
// 알림톡용 (2개)
const uploadAlimtalkTemplateImage = (buf, name) => uploadSingleImage('/kakao-management/api/v1/attach/alimtalk/template', buf, name);
exports.uploadAlimtalkTemplateImage = uploadAlimtalkTemplateImage;
const uploadAlimtalkHighlightImage = (buf, name) => uploadSingleImage('/kakao-management/api/v1/attach/alimtalk/item-highlight', buf, name);
exports.uploadAlimtalkHighlightImage = uploadAlimtalkHighlightImage;
// 브랜드메시지용 (6개)
const uploadBrandDefaultImage = (buf, name) => uploadSingleImage('/kakao-management/api/v1/attach/brand-message/default', buf, name);
exports.uploadBrandDefaultImage = uploadBrandDefaultImage;
const uploadBrandWideImage = (buf, name) => uploadSingleImage('/kakao-management/api/v1/attach/brand-message/wide', buf, name);
exports.uploadBrandWideImage = uploadBrandWideImage;
const uploadBrandWideListFirstImage = (buf, name) => uploadSingleImage('/kakao-management/api/v1/attach/brand-message/wide-list/first', buf, name);
exports.uploadBrandWideListFirstImage = uploadBrandWideListFirstImage;
const uploadBrandWideListImages = (files) => uploadMultipleImages('/kakao-management/api/v1/attach/brand-message/wide-list', files);
exports.uploadBrandWideListImages = uploadBrandWideListImages;
const uploadBrandCarouselFeedImages = (files) => uploadMultipleImages('/kakao-management/api/v1/attach/brand-message/carousel-feed', files);
exports.uploadBrandCarouselFeedImages = uploadBrandCarouselFeedImages;
const uploadBrandCarouselCommerceImages = (files) => uploadMultipleImages('/kakao-management/api/v1/attach/brand-message/carousel-commerce', files);
exports.uploadBrandCarouselCommerceImages = uploadBrandCarouselCommerceImages;
// 마케팅 동의 증적자료 (발신프로필 단위, 1개)
const uploadMarketingAgreeFile = (senderKey, buf, name) => uploadSingleImage(`/kakao-management/api/v1/attach/marketing-agree/${senderKey}`, buf, name);
exports.uploadMarketingAgreeFile = uploadMarketingAgreeFile;
async function listTemplateCategories() {
    const res = await getClient().get('/kakao-management/api/v1/template/category');
    return res.data;
}
async function getTemplateCategory(categoryCode) {
    const res = await getClient().get(`/kakao-management/api/v1/template/category/${categoryCode}`);
    return res.data;
}
//# sourceMappingURL=alimtalk-api.js.map