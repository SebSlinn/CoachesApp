//services/accountErrors.js
// The database refuses with 'CODE: detail'. Turn that into words for the screens.
// Shared by groups.js, sponsorship.js, logSharing.js and registers.js. Zero imports.

const ERROR_TEXT = {
  NOT_ALLOWED: 'You don\'t have permission to do that.',
  RATE_LIMIT: 'That limit has been reached for now. Try again later.',
  GUARDIAN_REQUIRED: 'An under-18 needs at least one guardian: an adult already in SwimZone.',
  GUARDIAN_NOT_ADULT: 'The guardian needs to sign in and add their date of birth (18 or over) first.',
  DOB_REQUIRED: 'Enter your child\'s date of birth to accept.',
  ALREADY_SET: 'A date of birth is already recorded. Ask SwimZone to correct it.',
  LAST_GUARDIAN: 'An under-18 must keep at least one guardian. Add another guardian first.',
  LAST_TEAM_MANAGER: 'A group must keep at least one Team Manager. Make someone else a Team Manager first.',
  USER_NOT_FOUND: 'There\'s no SwimZone account with that email.',
  ALREADY_REGISTERED: 'This person already has a SwimZone account. Send them the group\'s invite link instead.',
  ALREADY_SPONSORED: 'That group already has sponsorship.',
  INVITE_INVALID: 'This invite link isn\'t valid, or it has expired. Ask the group for a new one.',
  NOT_FOUND: 'That no longer exists — it may already have been dealt with.',
  SIGNUP_CLOSED: null,   // the detail says what to do
  NOT_A_MEMBER: 'Only members of the register\'s groups can be on it. Invite them to the group first.',
  NOT_IN: 'Tick them in before signing them out.',
  SIGNED_OUT: 'They\'re already signed out. Undo the sign-out first.',
  CLOSED: 'This register is closed. Reopen it first.',
  STILL_IN: null,  // the detail says how many
  CARD_IN_USE: 'That card is already linked to someone else. Unlink it from them first.',
  INVALID: null,   // the detail says what's wrong
}

// { message: 'CODE: detail' } → { code, message, detail }
export function parseAccountError(pError) {
  const mText = pError?.message || ''
  const mMatch = mText.match(/^([A-Z_]+):\s*([\s\S]*)$/)
  if (!mMatch) return { code: 'UNKNOWN', message: mText || 'Something went wrong.', detail: mText }
  const [, mCode, mDetail] = mMatch
  return { code: mCode, message: ERROR_TEXT[mCode] || mDetail, detail: mDetail }
}

// Convenience for screens: the message to show, or null.
export const errorText = (pError) => (pError ? parseAccountError(pError).message : null)
