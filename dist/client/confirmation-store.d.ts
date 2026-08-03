import { z } from "zod";
declare const pendingSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"add">;
    expiresAt: z.ZodString;
    stateVersion: z.ZodString;
    reference: z.ZodString;
    slug: z.ZodString;
    offerId: z.ZodNumber;
    quantityBefore: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"remove">;
    expiresAt: z.ZodString;
    stateVersion: z.ZodString;
    reference: z.ZodString;
    cartItemId: z.ZodNumber;
    quantityBefore: z.ZodNumber;
}, z.core.$strict>], "kind">;
export type PendingConfirmation = z.infer<typeof pendingSchema>;
export type PendingConfirmationInput = Omit<Extract<PendingConfirmation, {
    kind: "add";
}>, "expiresAt"> | Omit<Extract<PendingConfirmation, {
    kind: "remove";
}>, "expiresAt">;
export declare class ConfirmationStore {
    private readonly file;
    private readonly lock;
    private readonly mutationLock;
    constructor(environment?: NodeJS.ProcessEnv);
    private load;
    create(pending: PendingConfirmationInput, ttlMs?: number): {
        confirmationToken: string;
        expiresAt: string;
    };
    take(token: string): PendingConfirmation;
    withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
}
export {};
