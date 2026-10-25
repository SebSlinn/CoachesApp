// Open sign-up: root's switch, a parent creating their own account, a parent adding their child.
// Goes through ISignupRepository via the RepositoryFactory; the database and the self-signup
// Edge Function enforce every rule (switch on, new email, adult parent, under 18, daily limits).
import { getSignupRepository } from '../repositories/RepositoryFactory'
import { isEmail, ageOn } from './signupLabels'

const repo = () => getSignupRepository()
const bad = (m) => ({ data: null, error: { message: 'INVALID: ' + m } })

export const isSignupOpen = async () => repo().isOpen()
export const setSignupOpen = async (pOpen) => repo().setOpen(pOpen)
export const getRecentSignups = async (pDays = 30) => repo().recent(pDays)

// pPerson: { fullName, email, website (the hidden bot trap) }
export const signUp = async (pPerson = {}) => {
  const fullName = (pPerson.fullName || '').trim()
  const email = (pPerson.email || '').trim().toLowerCase()
  if (!fullName) return bad('your name is needed')
  if (!isEmail(email)) return bad('a valid email is needed')
  return repo().signUp({ fullName, email, website: pPerson.website || '' })
}

// pChild: { fullName, email, dateOfBirth: 'YYYY-MM-DD' }
export const addMyChild = async (pChild = {}) => {
  const fullName = (pChild.fullName || '').trim()
  const email = (pChild.email || '').trim().toLowerCase()
  const age = ageOn(pChild.dateOfBirth)
  if (!fullName) return bad('your child\'s name is needed')
  if (!isEmail(email)) return bad('a valid email for your child is needed (e.g. you+name@gmail.com)')
  if (age == null || age < 0) return bad('your child\'s date of birth is needed')
  if (age >= 18) return bad('only under-18s are added this way — adults sign up themselves')
  return repo().addChild({ fullName, email, dateOfBirth: pChild.dateOfBirth })
}

export { errorText } from './accountErrors'
