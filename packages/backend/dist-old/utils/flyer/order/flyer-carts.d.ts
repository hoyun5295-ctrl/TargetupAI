/**
 * ★ CT-F19 — 전단AI 장바구니 컨트롤타워
 *
 * Phase 3: 전단지 뷰어에서 상품 장바구니 담기 → 주문 연결
 * - 로그인 불필요: phone (tracking URL에서 식별) 기반
 * - flyer_id + phone 당 장바구니 1개 (UNIQUE 제약)
 * - 장바구니 아이템은 JSONB로 관리
 */
export interface CartItem {
    productName: string;
    price: number;
    quantity: number;
    imageUrl?: string;
    category?: string;
    unit?: string;
}
export interface Cart {
    id: string;
    companyId: string;
    flyerId: string;
    phone: string;
    items: CartItem[];
    createdAt: string;
    updatedAt: string;
}
export declare function getOrCreateCart(companyId: string, flyerId: string, phone: string): Promise<Cart>;
export declare function updateCartItems(flyerId: string, phone: string, items: CartItem[]): Promise<Cart | null>;
export declare function addItemToCart(companyId: string, flyerId: string, phone: string, item: CartItem): Promise<Cart>;
export declare function clearCart(flyerId: string, phone: string): Promise<void>;
export declare function calculateCartTotal(items: CartItem[]): number;
//# sourceMappingURL=flyer-carts.d.ts.map