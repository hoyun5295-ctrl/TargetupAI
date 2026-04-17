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

import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';

// ════════════════════════════════════════════════════════════
// 공통 타입
// ════════════════════════════════════════════════════════════

export interface ImcResponse<T = any> {
  code: string;
  message: string;
  data?: T;
}

export class ImcApiError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    public responseBody: any,
    message: string,
  ) {
    super(`[IMC ${code}] ${message}`);
    this.name = 'ImcApiError';
  }
}

// ════════════════════════════════════════════════════════════
// 환경별 클라이언트 (Lazy init)
// ════════════════════════════════════════════════════════════

let _client: AxiosInstance | null = null;
let _apiKey: string | null = null;

function resolveBaseURL(): string {
  const env = process.env.IMC_ENV || 'STG';
  const url =
    env === 'PRD' ? process.env.IMC_BASE_URL_PRD : process.env.IMC_BASE_URL_STG;
  if (!url) {
    throw new Error(
      `[IMC] 환경변수가 설정되지 않았습니다 — IMC_BASE_URL_${env}=? .env 확인 필요`,
    );
  }
  return url.replace(/\/$/, '');
}

function resolveApiKey(): string {
  const env = process.env.IMC_ENV || 'STG';
  const key =
    env === 'PRD' ? process.env.IMC_API_KEY : process.env.IMC_API_KEY_SANDBOX;
  if (!key) {
    throw new Error(
      `[IMC] 환경변수가 설정되지 않았습니다 — IMC_API_KEY${env === 'PRD' ? '' : '_SANDBOX'}=? .env 확인 필요`,
    );
  }
  return key;
}

function getClient(): AxiosInstance {
  if (_client) return _client;

  const baseURL = resolveBaseURL();
  _apiKey = resolveApiKey();

  _client = axios.create({
    baseURL,
    headers: {
      'x-imc-api-key': _apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });

  _client.interceptors.response.use(
    (res) => res,
    (err: AxiosError<any>) => {
      const code = (err.response?.data as any)?.code || 'UNKNOWN';
      const message = (err.response?.data as any)?.message || err.message;
      throw new ImcApiError(
        String(code),
        err.response?.status || 500,
        err.response?.data,
        message,
      );
    },
  );

  return _client;
}

/** 외부에서 명시적으로 reset하고 싶을 때 (env 교체 후 재초기화용) */
export function resetImcClient(): void {
  _client = null;
  _apiKey = null;
}

function getApiKey(): string {
  if (_apiKey) return _apiKey;
  getClient();
  return _apiKey!;
}

// ════════════════════════════════════════════════════════════
// 발신프로필 (Sender) — 11개
// ════════════════════════════════════════════════════════════

export interface SenderTokenRequest {
  yellowId: string;
  phoneNumber: string;
}

export interface SenderCreateRequest {
  token: string;
  yellowId: string;
  phoneNumber: string;
  categoryCode: string;
  topSenderKeyYn?: 'Y' | 'N';
  customSenderKey?: string;
}

export interface SenderData {
  senderKey: string;
  yellowId: string;
  status: string;
  phoneNumber?: string;
  categoryCode?: string;
  customSenderKey?: string;
  topSenderKeyYn?: 'Y' | 'N';
  unsubscribePhoneNumber?: string;
  unsubscribeAuthNumber?: string;
  registeredAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export async function requestSenderToken(
  body: SenderTokenRequest,
): Promise<ImcResponse> {
  const res = await getClient().post('/kakao-management/api/v1/sender/token', body);
  return res.data;
}

export async function createSender(
  body: SenderCreateRequest,
): Promise<ImcResponse<SenderData>> {
  const res = await getClient().post('/kakao-management/api/v1/sender', body);
  return res.data;
}

export async function listSenders(
  params: { page?: number; count?: number; yellowId?: string; status?: string } = {},
): Promise<ImcResponse<{ list: SenderData[]; total?: number }>> {
  const res = await getClient().get('/kakao-management/api/v1/sender', { params });
  return res.data;
}

export async function getSender(
  senderKey: string,
): Promise<ImcResponse<SenderData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}`,
  );
  return res.data;
}

export async function updateSenderUnsubscribe(
  senderKey: string,
  body: { unsubscribePhoneNumber: string; unsubscribeAuthNumber: string },
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/unsubscribe`,
    body,
  );
  return res.data;
}

export async function updateCustomSenderKey(
  senderKey: string,
  customSenderKey: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/custom-sender-key`,
    { customSenderKey },
  );
  return res.data;
}

export async function releaseSenderDormant(
  senderKey: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/release`,
  );
  return res.data;
}

export async function checkBrandTargeting(
  senderKey: string,
): Promise<ImcResponse<{ available: boolean }>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/check`,
  );
  return res.data;
}

export async function applyBrandTargeting(
  senderKey: string,
  body: any,
): Promise<ImcResponse> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message`,
    body,
  );
  return res.data;
}

// ── 발신프로필 카테고리 (3단 트리)
export interface CategoryNode {
  code: string;
  parentCode?: string;
  level: 1 | 2 | 3;
  name: string;
}

export async function listSenderCategories(): Promise<
  ImcResponse<CategoryNode[]>
> {
  const res = await getClient().get('/kakao-management/api/v1/sender/category');
  return res.data;
}

export async function getSenderCategory(
  categoryCode: string,
): Promise<ImcResponse<CategoryNode>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/category/${categoryCode}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 알림톡 템플릿 — 13개
// ════════════════════════════════════════════════════════════

export type AlimtalkMessageType = 'BA' | 'EX' | 'AD' | 'MI';
export type AlimtalkEmphasizeType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';

export type AlimtalkButtonType =
  | 'WL'
  | 'AL'
  | 'DS'
  | 'BK'
  | 'MD'
  | 'BF'
  | 'BC'
  | 'AC'
  | 'PD';

export interface AlimtalkButton {
  name: string;
  type: AlimtalkButtonType;
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  target?: 'out' | 'in';
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
  pluginId?: string;
  relayId?: string;
  oneclickId?: string;
  productId?: string;
  telNumber?: string;
  mapAddress?: string;
  mapCoordinates?: string;
}

export type AlimtalkQuickReplyType = 'WL' | 'AL' | 'BK' | 'MD' | 'BF';

export interface AlimtalkQuickReply {
  name: string;
  type: AlimtalkQuickReplyType;
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
}

export interface AlimtalkItemHighlight {
  title: string;
  description: string;
  imageUrl?: string;
}

export interface AlimtalkItemListEntry {
  title: string;
  description: string;
}

export interface AlimtalkItemSummary {
  title: string;
  description: string;
}

export interface AlimtalkItem {
  list: AlimtalkItemListEntry[];
  summary?: AlimtalkItemSummary;
}

export interface AlimtalkRepresentLink {
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
}

export interface AlimtalkTemplateCreateRequest {
  templateKey: string;
  manageName: string;
  customTemplateCode?: string;
  serviceMode?: 'PRD' | 'STG';
  templateMessageType: AlimtalkMessageType;
  templateEmphasizeType: AlimtalkEmphasizeType;
  templateContent: string;
  templatePreviewMessage?: string;
  templateExtra?: string;
  templateImageName?: string;
  templateImageUrl?: string;
  templateTitle?: string;
  templateSubtitle?: string;
  templateHeader?: string;
  templateItemHighlight?: AlimtalkItemHighlight;
  templateItem?: AlimtalkItem;
  templateRepresentLink?: AlimtalkRepresentLink;
  categoryCode: string;
  securityFlag?: boolean;
  buttonList?: AlimtalkButton[];
  quickReplyList?: AlimtalkQuickReply[];
  alarmPhoneNumber?: string;
}

export interface AlimtalkTemplateData extends AlimtalkTemplateCreateRequest {
  templateCode: string;
  status: string;
  reviewedAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export async function createAlimtalkTemplate(
  senderKey: string,
  body: AlimtalkTemplateCreateRequest,
): Promise<ImcResponse<{ templateCode: string }>> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template`,
    body,
  );
  return res.data;
}

export async function updateAlimtalkTemplate(
  senderKey: string,
  templateCode: string,
  body: Partial<AlimtalkTemplateCreateRequest>,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`,
    body,
  );
  return res.data;
}

export async function getAlimtalkTemplate(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse<AlimtalkTemplateData>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`,
  );
  return res.data;
}

export async function listAlimtalkTemplates(
  params: {
    page?: number;
    count?: number;
    templateName?: string;
    status?: string;
  } = {},
): Promise<ImcResponse<{ list: AlimtalkTemplateData[]; total?: number }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/alimtalk/template/list',
    { params },
  );
  return res.data;
}

export async function getRecentlyModifiedAlimtalkTemplates(
  params: { since?: string; page?: number; count?: number } = {},
): Promise<ImcResponse<{ list: AlimtalkTemplateData[] }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/alimtalk/template/last-modified',
    { params },
  );
  return res.data;
}

export async function deleteAlimtalkTemplate(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().delete(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}`,
  );
  return res.data;
}

export async function requestInspection(
  senderKey: string,
  templateCode: string,
  comment?: string,
): Promise<ImcResponse> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment`,
    { comment },
  );
  return res.data;
}

export async function requestInspectionWithFile(
  senderKey: string,
  templateCode: string,
  comment: string,
  fileBuffer: Buffer,
  fileName: string,
): Promise<ImcResponse> {
  const form = new FormData();
  form.append('comment', comment);
  form.append('file', fileBuffer, fileName);
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment-with-file`,
    form,
    { headers: { ...form.getHeaders(), 'x-imc-api-key': getApiKey() } },
  );
  return res.data;
}

export async function cancelInspection(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/comment-cancel`,
  );
  return res.data;
}

export async function releaseTemplateDormant(
  senderKey: string,
  templateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/release`,
  );
  return res.data;
}

export async function updateCustomCode(
  senderKey: string,
  templateCode: string,
  customTemplateCode: string,
): Promise<ImcResponse> {
  const res = await getClient().patch(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/custom-code`,
    { customTemplateCode },
  );
  return res.data;
}

export async function updateExposure(
  senderKey: string,
  templateCode: string,
  exposureYn: 'Y' | 'N',
): Promise<ImcResponse> {
  const res = await getClient().patch(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/exposure`,
    { exposureYn },
  );
  return res.data;
}

export async function updateServiceMode(
  senderKey: string,
  templateCode: string,
  mode: 'PRD' | 'STG',
): Promise<ImcResponse> {
  const res = await getClient().patch(
    `/kakao-management/api/v1/sender/${senderKey}/alimtalk/template/${templateCode}/service-mode`,
    { serviceMode: mode },
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 알림톡 검수 알림 수신자 — 4개
// ════════════════════════════════════════════════════════════

export interface AlarmUser {
  alarmUserId?: string;
  name: string;
  phoneNumber: string;
  activeYn: 'Y' | 'N';
}

export async function listAlarmUsers(
  params: {
    name?: string;
    phoneNumber?: string;
    activeYn?: 'Y' | 'N';
    page?: number;
    count?: number;
  } = {},
): Promise<ImcResponse<{ list: AlarmUser[]; total?: number }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/alimtalk/template/alarm-users',
    { params },
  );
  return res.data;
}

export async function createAlarmUser(
  body: Omit<AlarmUser, 'alarmUserId'>,
): Promise<ImcResponse<{ alarmUserId: string }>> {
  const res = await getClient().post(
    '/kakao-management/api/v1/alimtalk/template/alarm-users',
    body,
  );
  return res.data;
}

export async function updateAlarmUser(
  alarmUserId: string,
  body: Partial<AlarmUser>,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserId}`,
    body,
  );
  return res.data;
}

export async function deleteAlarmUser(
  alarmUserId: string,
): Promise<ImcResponse> {
  const res = await getClient().delete(
    `/kakao-management/api/v1/alimtalk/template/alarm-users/${alarmUserId}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 브랜드메시지 템플릿 — 5개 (검수 없음, 즉시 ACTIVE)
// ════════════════════════════════════════════════════════════

export type ChatBubbleType =
  | 'TEXT'
  | 'IMAGE'
  | 'WIDE'
  | 'WIDE_ITEM_LIST'
  | 'CAROUSEL_FEED'
  | 'PREMIUM_VIDEO'
  | 'COMMERCE'
  | 'CAROUSEL_COMMERCE';

export interface BrandAttachmentImage {
  imgUrl: string;
  imgLink?: string;
}

export interface BrandAttachmentVideo {
  videoUrl: string;
  thumbnailUrl?: string;
}

export interface BrandAttachmentCommerce {
  title: string;
  regularPrice?: string;
  discountRate?: string;
  discountPrice?: string;
  [key: string]: any;
}

export interface BrandAttachmentItem {
  list: { title: string; description?: string; imageUrl?: string }[];
}

export interface BrandAttachment {
  image?: BrandAttachmentImage;
  video?: BrandAttachmentVideo;
  commerce?: BrandAttachmentCommerce;
  item?: BrandAttachmentItem;
}

export interface BrandCarouselEntry {
  title: string;
  description?: string;
  imageUrl?: string;
  [key: string]: any;
}

export interface BrandCarousel {
  head?: any;
  list: BrandCarouselEntry[];
  tail?: any;
}

export interface BrandMessageTemplateRequest {
  templateKey: string;
  customTemplateCode?: string;
  manageName: string;
  chatBubbleType: ChatBubbleType;
  adult?: 'Y' | 'N';
  header?: string;
  content?: string;
  additionalContent?: string;
  attachment?: BrandAttachment;
  carousel?: BrandCarousel;
  buttons?: AlimtalkButton[];
  coupon?: any;
}

export async function createBrandTemplate(
  senderKey: string,
  body: BrandMessageTemplateRequest,
): Promise<ImcResponse<{ templateKey: string }>> {
  const res = await getClient().post(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template`,
    body,
  );
  return res.data;
}

export async function updateBrandBasicTemplate(
  senderKey: string,
  body: Partial<BrandMessageTemplateRequest>,
): Promise<ImcResponse> {
  const res = await getClient().put(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template`,
    body,
  );
  return res.data;
}

export async function getBrandTemplate(
  senderKey: string,
  templateKey: string,
): Promise<ImcResponse<any>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`,
  );
  return res.data;
}

export async function listBrandTemplates(
  params: { senderKey?: string; page?: number; count?: number } = {},
): Promise<ImcResponse<{ list: any[] }>> {
  const res = await getClient().get(
    '/kakao-management/api/v1/brand-message/template/list',
    { params },
  );
  return res.data;
}

export async function deleteBrandTemplate(
  senderKey: string,
  templateKey: string,
): Promise<ImcResponse> {
  const res = await getClient().delete(
    `/kakao-management/api/v1/sender/${senderKey}/brand-message/template/${templateKey}`,
  );
  return res.data;
}

// ════════════════════════════════════════════════════════════
// 이미지 업로드 — 9개 (설계서 §3-7)
// ════════════════════════════════════════════════════════════

export interface ImageUploadResult {
  imageName: string;
  imageUrl: string;
}

async function uploadSingleImage(
  endpoint: string,
  fileBuffer: Buffer,
  fileName: string,
): Promise<ImcResponse<ImageUploadResult>> {
  const form = new FormData();
  form.append('image', fileBuffer, fileName);
  const res = await getClient().post(endpoint, form, {
    headers: { ...form.getHeaders(), 'x-imc-api-key': getApiKey() },
  });
  return res.data;
}

async function uploadMultipleImages(
  endpoint: string,
  files: { buffer: Buffer; name: string }[],
  fieldName = 'images',
): Promise<ImcResponse<{ list: ImageUploadResult[] }>> {
  const form = new FormData();
  for (const f of files) form.append(fieldName, f.buffer, f.name);
  const res = await getClient().post(endpoint, form, {
    headers: { ...form.getHeaders(), 'x-imc-api-key': getApiKey() },
  });
  return res.data;
}

// 알림톡용 (2개)
export const uploadAlimtalkTemplateImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/alimtalk/template',
    buf,
    name,
  );

export const uploadAlimtalkHighlightImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/alimtalk/item-highlight',
    buf,
    name,
  );

// 브랜드메시지용 (6개)
export const uploadBrandDefaultImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/brand-message/default',
    buf,
    name,
  );

export const uploadBrandWideImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/brand-message/wide',
    buf,
    name,
  );

export const uploadBrandWideListFirstImage = (buf: Buffer, name: string) =>
  uploadSingleImage(
    '/kakao-management/api/v1/attach/brand-message/wide-list/first',
    buf,
    name,
  );

export const uploadBrandWideListImages = (
  files: { buffer: Buffer; name: string }[],
) =>
  uploadMultipleImages(
    '/kakao-management/api/v1/attach/brand-message/wide-list',
    files,
  );

export const uploadBrandCarouselFeedImages = (
  files: { buffer: Buffer; name: string }[],
) =>
  uploadMultipleImages(
    '/kakao-management/api/v1/attach/brand-message/carousel-feed',
    files,
  );

export const uploadBrandCarouselCommerceImages = (
  files: { buffer: Buffer; name: string }[],
) =>
  uploadMultipleImages(
    '/kakao-management/api/v1/attach/brand-message/carousel-commerce',
    files,
  );

// 마케팅 동의 증적자료 (발신프로필 단위, 1개)
export const uploadMarketingAgreeFile = (
  senderKey: string,
  buf: Buffer,
  name: string,
) =>
  uploadSingleImage(
    `/kakao-management/api/v1/attach/marketing-agree/${senderKey}`,
    buf,
    name,
  );

// ════════════════════════════════════════════════════════════
// 템플릿 카테고리 — 2개 (알림톡 templateCategoryCode 6자리)
// ════════════════════════════════════════════════════════════

export interface TemplateCategoryItem {
  code: string;
  name: string;
}

export async function listTemplateCategories(): Promise<
  ImcResponse<TemplateCategoryItem[]>
> {
  const res = await getClient().get('/kakao-management/api/v1/template/category');
  return res.data;
}

export async function getTemplateCategory(
  categoryCode: string,
): Promise<ImcResponse<TemplateCategoryItem>> {
  const res = await getClient().get(
    `/kakao-management/api/v1/template/category/${categoryCode}`,
  );
  return res.data;
}
