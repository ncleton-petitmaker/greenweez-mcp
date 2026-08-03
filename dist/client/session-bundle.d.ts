import { z } from "zod";
declare const cookieSchema: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodString;
    domain: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    expires: z.ZodOptional<z.ZodNumber>;
    httpOnly: z.ZodOptional<z.ZodBoolean>;
    secure: z.ZodOptional<z.ZodBoolean>;
    sameSite: z.ZodOptional<z.ZodEnum<{
        Lax: "Lax";
        None: "None";
        Strict: "Strict";
    }>>;
}, z.core.$strict>;
export type PortableCookie = z.infer<typeof cookieSchema>;
export interface SessionBundlePaths {
    bundleFile: string;
    keyFile: string;
}
export declare function sessionBundlePaths(environment?: NodeJS.ProcessEnv): SessionBundlePaths;
export declare function writeEncryptedSessionBundle(rawCookies: unknown, environment?: NodeJS.ProcessEnv): void;
export declare function readEncryptedSessionBundle(environment?: NodeJS.ProcessEnv): PortableCookie[];
export declare function sessionBundleExists(environment?: NodeJS.ProcessEnv): boolean;
export {};
