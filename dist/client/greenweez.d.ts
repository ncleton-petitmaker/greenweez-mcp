import { z } from "zod";
import type { BrowserGateway } from "./camoufox.js";
import { ConfirmationStore } from "./confirmation-store.js";
import { type AddPreview, type MutationResult, type PublicCart, type RemovePreview } from "./cart.js";
declare const searchSchema: z.ZodObject<{
    query: z.ZodString;
    page: z.ZodNumber;
    total: z.ZodNumber;
    products: z.ZodArray<z.ZodObject<{
        reference: z.ZodString;
        name: z.ZodString;
        brand: z.ZodNullable<z.ZodString>;
        price: z.ZodNullable<z.ZodString>;
        unitPrice: z.ZodNullable<z.ZodString>;
        url: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
declare const detailSchema: z.ZodObject<{
    reference: z.ZodString;
    name: z.ZodString;
    brand: z.ZodNullable<z.ZodString>;
    price: z.ZodNullable<z.ZodString>;
    unitPrice: z.ZodNullable<z.ZodString>;
    url: z.ZodString;
    description: z.ZodString;
    ingredients: z.ZodNullable<z.ZodString>;
    allergens: z.ZodNullable<z.ZodString>;
    nutrition: z.ZodNullable<z.ZodString>;
    origin: z.ZodNullable<z.ZodString>;
    delivery: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type SearchResult = z.infer<typeof searchSchema>;
export type ProductDetail = z.infer<typeof detailSchema>;
export declare class GreenweezClient {
    private readonly browser;
    private readonly cartClient;
    constructor(browser: BrowserGateway, confirmations?: ConfirmationStore);
    search(query: string, page: number): Promise<SearchResult>;
    product(reference: string, slug: string): Promise<ProductDetail>;
    cart(): Promise<PublicCart>;
    previewAddToCart(reference: string, slug: string): Promise<AddPreview>;
    previewRemoveFromCart(reference: string): Promise<RemovePreview>;
    confirmAddToCart(confirmationToken: string): Promise<MutationResult>;
    confirmRemoveFromCart(confirmationToken: string): Promise<MutationResult>;
}
export {};
