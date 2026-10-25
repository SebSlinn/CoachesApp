//services/signupLabels.js
// Words and small checks for open sign-up. Zero imports.

// The message root can copy and send to parents (link filled in).
export function parentInstructions(pLink, pClubLinkHint = 'the club\'s invite link') {
  return [
    'Joining SwimZone',
    '',
    `1. Open ${pLink} and enter your name and email.`,
    '2. Check your email (and spam) for a message from SwimZone. Click the link and choose a password.',
    '3. You\'re in. On the Dashboard, add your own date of birth (needed to look after a child\'s account).',
    '4. Press "Add my child" for each child: their name, date of birth, and an email for them.',
    '   No email of their own? Use yours with +name before the @, e.g. you+sam@gmail.com — it still arrives in your inbox.',
    '   Each child gets an email to set their own password; you can manage their account either way.',
    `5. Open ${pClubLinkHint} and choose to join yourself or your child into the squad.`,
    '',
    'Questions: ask your coach.',
  ].join('\n')
}

export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())

// 'YYYY-MM-DD' → age in whole years on pToday, or null.
export function ageOn(pDob, pToday = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(pDob || ''))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let a = pToday.getFullYear() - y
  if (pToday.getMonth() + 1 < mo || (pToday.getMonth() + 1 === mo && pToday.getDate() < d)) a -= 1
  return a
}
