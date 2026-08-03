import type { BrowserGateway } from "./camoufox.js";
import { ConfirmationStore } from "./confirmation-store.js";
export interface PublicCartItem {
    reference: string;
    slug: string;
    name: string;
    brand: string | null;
    quantity: number;
    unitPriceEur: number;
    quantityAvailable: number;
    status: string;
}
export interface PublicCart {
    totalItems: number;
    items: PublicCartItem[];
}
export interface ProductForCart {
    reference: string;
    slug: string;
    name: string;
    brand: string | null;
    price: string | null;
    url: string;
}
export interface AddPreview {
    action: "add_one";
    confirmationToken: string;
    expiresAt: string;
    product: ProductForCart;
    quantityBefore: number;
    quantityAfter: number;
}
export interface RemovePreview {
    action: "remove_line";
    confirmationToken: string;
    expiresAt: string;
    item: PublicCartItem;
    quantityBefore: number;
    quantityAfter: 0;
}
export interface MutationResult {
    applied: true;
    verified: true;
    responseReconciled: boolean;
    action: "add_one" | "remove_line";
    cart: PublicCart;
}
export declare class GreenweezCartClient {
    private readonly browser;
    private readonly confirmations;
    constructor(browser: BrowserGateway, confirmations?: ConfirmationStore);
    private rawCart;
    getCart(): Promise<PublicCart>;
    previewAdd(product: ProductForCart): Promise<AddPreview>;
    previewRemove(reference: string): Promise<RemovePreview>;
    confirm(token: string, expectedKind: "add" | "remove"): Promise<MutationResult>;
}
