/** Auth error codes meaning the user (or every session of theirs) no longer exists on the server. */
const GONE_CODES: ReadonlySet<string> = new Set(['user_not_found', 'session_not_found', 'refresh_token_not_found']);

type AuthErrorLike = Readonly<{ code?: string | undefined; status?: number | undefined }>;

/**
 * After a delete request whose response was lost, the server is asked who the caller is. Only an
 * explicit "this user/session does not exist" counts as deleted; network or server errors mean
 * "unknown", and the app keeps the account state so the user can retry.
 */
export function accountGoneFromAuthError(error: AuthErrorLike | null): boolean {
  return error !== null && error.code !== undefined && GONE_CODES.has(error.code);
}
