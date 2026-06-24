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
export interface ImcResponse<T = any> {
    code: string;
    message: string;
    data?: T;
}
export declare class ImcApiError extends Error {
    code: string;
    httpStatus: number;
    responseBody: any;
    constructor(code: string, httpStatus: number, responseBody: any, message: string);
}
/** 외부에서 명시적으로 reset하고 싶을 때 (env 교체 후 재초기화용) */
export declare function resetImcClient(): void;
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
}
/**
 * SenderData — IMC 실 응답 필드 (11_04_55, 11_05_12 스펙 대조 완료 D131).
 * 실제 응답 예시 (D131 운영 서버 실측):
 *   { senderKey, uuid:"@invitocorp", name, status:"A", block, dormant,
 *     profileStatus:"A", category, alimtalk, brandMessage, bizchat, brandtalk,
 *     unsubscribePhoneNumber, unsubscribeAuthNumber, topSenderKey, topSenderKeyYn,
 *     customSenderKey, createdAt, modifiedAt, channelKey, businessProfile,
 *     commitalCompanyName, businessType, marketingAgreeFileUrl }
 */
export interface SenderData {
    senderKey: string;
    uuid?: string;
    name?: string;
    status: string;
    profileStatus?: string;
    phoneNumber?: string;
    categoryCode?: string;
    category?: string;
    customSenderKey?: string;
    topSenderKey?: string;
    topSenderKeyYn?: 'Y' | 'N';
    alimtalk?: boolean;
    brandMessage?: boolean;
    bizchat?: boolean;
    brandtalk?: boolean;
    block?: boolean;
    dormant?: boolean;
    businessProfile?: boolean;
    businessType?: string | null;
    channelKey?: string | null;
    commitalCompanyName?: string | null;
    unsubscribePhoneNumber?: string;
    unsubscribeAuthNumber?: string;
    marketingAgreeFileUrl?: string;
    registeredAt?: string;
    updatedAt?: string;
    createdAt?: string;
    modifiedAt?: string;
    yellowId?: string;
    [key: string]: any;
}
export declare function requestSenderToken(body: SenderTokenRequest): Promise<ImcResponse>;
export declare function createSender(body: SenderCreateRequest): Promise<ImcResponse<SenderData>>;
/**
 * 발신프로필 목록 조회 — IMC 공식 파라미터 (11_04_55_발신프로필 목록 조회.txt 대조 D131)
 *   정식 필드: name, profileStatus, senderKey, status, uuid, customSenderKey,
 *             block, dormant, alimtalk, brandMessage, category, categoryCode,
 *             page(0~), size(1~100)
 *   과거 잘못된 필드명(count, yellowId)을 IMC 스펙에 맞춰 교정.
 */
export declare function listSenders(params?: {
    name?: string;
    profileStatus?: string;
    senderKey?: string;
    status?: string;
    uuid?: string;
    customSenderKey?: string;
    block?: boolean;
    dormant?: boolean;
    alimtalk?: boolean;
    brandMessage?: boolean;
    category?: string;
    categoryCode?: string;
    page?: number;
    size?: number;
}): Promise<ImcResponse<{
    list: SenderData[];
    total?: number;
}>>;
export declare function getSender(senderKey: string): Promise<ImcResponse<SenderData>>;
export declare function updateSenderUnsubscribe(senderKey: string, body: {
    unsubscribePhoneNumber: string;
    unsubscribeAuthNumber: string;
}): Promise<ImcResponse>;
export declare function updateCustomSenderKey(senderKey: string, customSenderKey: string): Promise<ImcResponse>;
export declare function releaseSenderDormant(senderKey: string): Promise<ImcResponse>;
export declare function checkBrandTargeting(senderKey: string): Promise<ImcResponse<{
    available: boolean;
}>>;
export declare function applyBrandTargeting(senderKey: string, body: any): Promise<ImcResponse>;
export interface CategoryNode {
    code: string;
    parentCode?: string;
    level: 1 | 2 | 3;
    name: string;
}
export declare function listSenderCategories(): Promise<ImcResponse<CategoryNode[]>>;
export declare function getSenderCategory(categoryCode: string): Promise<ImcResponse<CategoryNode>>;
export type AlimtalkMessageType = 'BA' | 'EX' | 'AD' | 'MI';
export type AlimtalkEmphasizeType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';
export type AlimtalkButtonType = 'WL' | 'AL' | 'DS' | 'BK' | 'MD' | 'BF' | 'BC' | 'AC' | 'PD';
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
export declare function createAlimtalkTemplate(senderKey: string, body: AlimtalkTemplateCreateRequest): Promise<ImcResponse<{
    templateCode: string;
}>>;
export declare function updateAlimtalkTemplate(senderKey: string, templateCode: string, body: Partial<AlimtalkTemplateCreateRequest>): Promise<ImcResponse>;
export declare function getAlimtalkTemplate(senderKey: string, templateCode: string): Promise<ImcResponse<AlimtalkTemplateData>>;
export declare function listAlimtalkTemplates(params?: {
    page?: number;
    count?: number;
    templateName?: string;
    status?: string;
}): Promise<ImcResponse<{
    list: AlimtalkTemplateData[];
    total?: number;
}>>;
export declare function getRecentlyModifiedAlimtalkTemplates(params?: {
    since?: string;
    page?: number;
    count?: number;
}): Promise<ImcResponse<{
    list: AlimtalkTemplateData[];
}>>;
export declare function deleteAlimtalkTemplate(senderKey: string, templateCode: string): Promise<ImcResponse>;
export declare function requestInspection(senderKey: string, templateCode: string, comment?: string): Promise<ImcResponse>;
export declare function requestInspectionWithFile(senderKey: string, templateCode: string, comment: string, fileBuffer: Buffer, fileName: string): Promise<ImcResponse>;
export declare function cancelInspection(senderKey: string, templateCode: string): Promise<ImcResponse>;
export declare function releaseTemplateDormant(senderKey: string, templateCode: string): Promise<ImcResponse>;
export declare function updateCustomCode(senderKey: string, templateCode: string, customTemplateCode: string): Promise<ImcResponse>;
export declare function updateExposure(senderKey: string, templateCode: string, showYn: 'Y' | 'N'): Promise<ImcResponse>;
export declare function updateServiceMode(senderKey: string, templateCode: string, mode: 'PRD' | 'STG'): Promise<ImcResponse>;
/**
 * IMC 실 스펙 검증 (10_56_14, 10_56_22):
 *   등록 body 필수: alarmUserKey(고객사 발번, required), name, phoneNumber, activeYn
 *   수정/삭제 URL path: /alarm-users/{alarmUserKey}  ← id 아님, Key
 */
export interface AlarmUser {
    alarmUserKey: string;
    name: string;
    phoneNumber: string;
    activeYn: 'Y' | 'N';
}
export declare function listAlarmUsers(params?: {
    name?: string;
    phoneNumber?: string;
    activeYn?: 'Y' | 'N';
    page?: number;
    count?: number;
}): Promise<ImcResponse<{
    list: AlarmUser[];
    total?: number;
}>>;
export declare function createAlarmUser(body: AlarmUser): Promise<ImcResponse<AlarmUser>>;
export declare function updateAlarmUser(alarmUserKey: string, body: Omit<Partial<AlarmUser>, 'alarmUserKey'>): Promise<ImcResponse>;
export declare function deleteAlarmUser(alarmUserKey: string): Promise<ImcResponse>;
export type ChatBubbleType = 'TEXT' | 'IMAGE' | 'WIDE' | 'WIDE_ITEM_LIST' | 'CAROUSEL_FEED' | 'PREMIUM_VIDEO' | 'COMMERCE' | 'CAROUSEL_COMMERCE';
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
    list: {
        title: string;
        description?: string;
        imageUrl?: string;
    }[];
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
export declare function createBrandTemplate(senderKey: string, body: BrandMessageTemplateRequest): Promise<ImcResponse<{
    templateKey: string;
}>>;
export declare function updateBrandBasicTemplate(senderKey: string, body: Partial<BrandMessageTemplateRequest>): Promise<ImcResponse>;
export declare function getBrandTemplate(senderKey: string, templateKey: string): Promise<ImcResponse<any>>;
export declare function listBrandTemplates(params?: {
    senderKey?: string;
    page?: number;
    count?: number;
}): Promise<ImcResponse<{
    list: any[];
}>>;
export declare function deleteBrandTemplate(senderKey: string, templateKey: string): Promise<ImcResponse>;
export interface ImageUploadResult {
    imageName: string;
    imageUrl: string;
}
export declare const uploadAlimtalkTemplateImage: (buf: Buffer, name: string) => Promise<ImcResponse<ImageUploadResult>>;
export declare const uploadAlimtalkHighlightImage: (buf: Buffer, name: string) => Promise<ImcResponse<ImageUploadResult>>;
export declare const uploadBrandDefaultImage: (buf: Buffer, name: string) => Promise<ImcResponse<ImageUploadResult>>;
export declare const uploadBrandWideImage: (buf: Buffer, name: string) => Promise<ImcResponse<ImageUploadResult>>;
export declare const uploadBrandWideListFirstImage: (buf: Buffer, name: string) => Promise<ImcResponse<ImageUploadResult>>;
export declare const uploadBrandWideListImages: (files: {
    buffer: Buffer;
    name: string;
}[]) => Promise<ImcResponse<{
    list: ImageUploadResult[];
}>>;
export declare const uploadBrandCarouselFeedImages: (files: {
    buffer: Buffer;
    name: string;
}[]) => Promise<ImcResponse<{
    list: ImageUploadResult[];
}>>;
export declare const uploadBrandCarouselCommerceImages: (files: {
    buffer: Buffer;
    name: string;
}[]) => Promise<ImcResponse<{
    list: ImageUploadResult[];
}>>;
export declare const uploadMarketingAgreeFile: (senderKey: string, buf: Buffer, name: string) => Promise<ImcResponse<ImageUploadResult>>;
export interface TemplateCategoryItem {
    code: string;
    name: string;
    /** 대분류 이름 (예: "회원", "구매", "예약") — 실제 IMC 응답에 포함됨 */
    groupName?: string;
    /** 카테고리 포함 대상 설명 (UX 가이드용) */
    inclusion?: string;
    /** 카테고리 제외 대상 설명 (UX 가이드용) */
    exclusion?: string;
}
export declare function listTemplateCategories(): Promise<ImcResponse<TemplateCategoryItem[]>>;
export declare function getTemplateCategory(categoryCode: string): Promise<ImcResponse<TemplateCategoryItem>>;
//# sourceMappingURL=alimtalk-api.d.ts.map