import { z } from 'zod';

/**
 * Auth contract. Anything that exchanges JSON for an auth concern goes here so
 * the operator UI and any 3rd-party client share one schema source.
 */

export const Email = z.string().email().max(254).transform((s) => s.toLowerCase().trim());
export const Password = z.string().min(12).max(256);
/** 6-digit TOTP code, no padding tolerance. */
export const TotpCode = z.string().regex(/^\d{6}$/);

export const LoginRequest = z.object({
  email: Email,
  password: Password,
  /** Required iff the user has TOTP enrolled; ignored otherwise. */
  totp: TotpCode.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().nullable(),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const LogoutResponse = z.object({ ok: z.literal(true) });
export type LogoutResponse = z.infer<typeof LogoutResponse>;

export const RequestPasswordResetRequest = z.object({ email: Email });
export type RequestPasswordResetRequest = z.infer<typeof RequestPasswordResetRequest>;

/** Response is intentionally symmetric — never leak whether the email exists. */
export const RequestPasswordResetResponse = z.object({ ok: z.literal(true) });
export type RequestPasswordResetResponse = z.infer<typeof RequestPasswordResetResponse>;

export const CompletePasswordResetRequest = z.object({
  token: z.string().min(20).max(200),
  password: Password,
});
export type CompletePasswordResetRequest = z.infer<typeof CompletePasswordResetRequest>;

export const CompletePasswordResetResponse = z.object({ ok: z.literal(true) });
export type CompletePasswordResetResponse = z.infer<typeof CompletePasswordResetResponse>;

export const EnrollTotpResponse = z.object({
  /** Base32 secret for the user to enter into their authenticator app. */
  secret: z.string(),
  /** otpauth:// URI for QR rendering. */
  otpauthUri: z.string().url(),
});
export type EnrollTotpResponse = z.infer<typeof EnrollTotpResponse>;

export const ConfirmTotpRequest = z.object({ code: TotpCode });
export type ConfirmTotpRequest = z.infer<typeof ConfirmTotpRequest>;

export const ConfirmTotpResponse = z.object({ ok: z.literal(true) });
export type ConfirmTotpResponse = z.infer<typeof ConfirmTotpResponse>;

export const Theme = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof Theme>;

export const UpdatePreferencesRequest = z.object({
  theme: Theme.optional(),
});
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>;

export const UpdatePreferencesResponse = z.object({
  ok: z.literal(true),
  preferences: z.object({ theme: Theme }),
});
export type UpdatePreferencesResponse = z.infer<typeof UpdatePreferencesResponse>;
