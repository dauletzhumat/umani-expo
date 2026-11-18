import { describe, expect, it } from '@jest/globals';

import { accountGoneFromAuthError } from './delete-outcome';

describe('accountGoneFromAuthError (was a deletion with a lost response applied?)', () => {
  it.each([
    [{ code: 'user_not_found', status: 403 }, true],
    [{ code: 'session_not_found', status: 403 }, true],
    [{ code: 'refresh_token_not_found', status: 400 }, true],
    [{ code: undefined, status: 0 }, false], // network failure: unknown, keep the account state
    [{ code: 'unexpected_failure', status: 500 }, false],
    [{ code: 'bad_jwt', status: 403 }, false],
  ] as const)('%p → %p', (error, gone) => {
    expect(accountGoneFromAuthError(error)).toBe(gone);
  });

  it('treats no error (user still exists) as not gone', () => {
    expect(accountGoneFromAuthError(null)).toBe(false);
  });
});
