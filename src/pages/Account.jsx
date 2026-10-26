// src/pages/Account.jsx — /account
// Your own account: names (the public name others see on results you add, "Added
// by …"), date of birth (private; add once, corrections via SwimZone), sign-in
// (email, last sign-in, change password), qualifications and zone colours.
// Self-edit only — RLS (sz_users_self_update) allows a user to change just their
// own users row; the date of birth goes through set_my_date_of_birth.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, getAccountStatus, getMyDateOfBirth, setMyDateOfBirth } from '../services/users';
import { setPassword } from '../services/auth';
import ZoneSchemePicker from '../components/ZoneSchemePicker.jsx';
import { getMyQualifications, addQualification, removeQualification, errorText } from '../services/groups';

export default function Account() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [publicName, setPublicName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getProfile(user.id).then(({ data }) => {
      if (cancelled || !data) return;
      setEmail(data.email || user.email || '');
      setFullName(data.full_name || '');
      setPublicName(data.public_name || '');
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [user]);

  async function save() {
    setSaving(true); setStatus('');
    const { error } = await updateProfile(user.id, { fullName: fullName.trim(), publicName: publicName.trim() });
    setSaving(false);
    setStatus(error ? ('Could not save: ' + (error.message || 'unknown error')) : 'Saved.');
  }

  const shownAs = publicName.trim() || fullName.trim() || 'a user';
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14, boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: 13, fontWeight: 600, margin: '18px 0 6px' };
  const help = { fontSize: 12, color: '#999', margin: '4px 0 0' };

  if (!user) return null;
  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Account</h2>
        <button onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      {!loaded ? <p style={{ color: '#999' }}>Loading…</p> : (
        <>
          <label style={label}>Email</label>
          <input style={{ ...input, background: '#f5f5f5', color: '#666' }} value={email} readOnly />
          <p style={help}>Your sign-in email. Never shown to other users.</p>

          <label style={label}>Full name</label>
          <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Al Slinn" />

          <label style={label}>Public name</label>
          <input style={input} value={publicName} onChange={(e) => setPublicName(e.target.value)} placeholder="e.g. Coach Al" />
          <p style={help}>The name others see on results you add (e.g. “Added by …”). Leave blank to use your full name. Your email is never shown.</p>

          <p style={{ fontSize: 13, margin: '18px 0 0' }}>Others will see you as <strong>{shownAs}</strong>.</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#30b0c7', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {status && <span style={{ fontSize: 13, color: status.startsWith('Could not') ? '#c00' : '#060' }}>{status}</span>}
          </div>

          <DateOfBirth label={label} help={help} input={input} />

          <SignIn user={user} label={label} help={help} input={input} />

          <Qualifications userId={user.id} label={label} help={help} input={input} />

          <label style={label}>Zone colours</label>
          <ZoneSchemePicker />
          <p style={help}>How zones are coloured on the Classifier and Set Builder. Changes take effect straight away and follow you to any device you sign in on. Your sets and results are not changed.</p>
        </>
      )}
    </div>
  );
}

const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const fmtWhen = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// Date of birth: private (only you and a guardian see it; coaches see an age). Added once;
// a mistake is corrected by SwimZone (root), so a junior can't make themselves an adult.
function DateOfBirth({ label, help, input }) {
  const [dob, setDob] = useState(undefined);      // undefined = loading, null = none
  const [junior, setJunior] = useState(false);
  const [entry, setEntry] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [d, st] = await Promise.all([getMyDateOfBirth(), getAccountStatus()]);
    setDob(d.error ? null : d.data);
    setJunior(!!st.data?.is_junior);
  };
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true); setMsg(null);
    const { error } = await setMyDateOfBirth(entry);
    setBusy(false);
    if (error) { setMsg(String(error.message || '').replace(/^[A-Z_]+:\s*/, '')); return; }
    setEntry(''); load();
  }

  return (
    <>
      <label style={label}>Date of birth</label>
      {dob === undefined && <p style={help}>Loading…</p>}
      {dob && <p style={{ fontSize: 14, margin: 0 }}>{fmtDate(dob)}</p>}
      {dob === null && junior && <p style={help}>Not recorded yet — your parent or guardian adds it.</p>}
      {dob === null && !junior && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input, flex: 1 }} type="date" value={entry} onChange={(e) => setEntry(e.target.value)} aria-label="Your date of birth" />
          <button onClick={add} disabled={busy || !entry}>{busy ? 'Saving…' : 'Add'}</button>
        </div>
      )}
      {msg && <p style={{ ...help, color: '#c00' }}>{msg}</p>}
      <p style={help}>Private: only you{junior ? ' and your guardian' : ''} can see it — coaches see your age, not the date. Needed to look after a child's account. It can only be added once; if it's wrong, ask SwimZone to correct it.</p>
    </>
  );
}

// Sign-in: the email you sign in with, when you last signed in, and a new password.
function SignIn({ user, label, help, input }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function change() {
    setMsg(null);
    if (pw !== pw2) { setMsg({ err: true, text: "The two passwords don't match." }); return; }
    setBusy(true);
    const { error } = await setPassword(pw);
    setBusy(false);
    if (error) {
      const t = /reauth|recent/i.test(error.message || '')
        ? 'For safety, sign out and back in, then change it straight away (or use "Forgot password?" on the sign-in page).'
        : error.message;
      setMsg({ err: true, text: t });
      return;
    }
    setPw(''); setPw2(''); setMsg({ err: false, text: 'Password changed. Use the new one next time you sign in.' });
  }

  return (
    <>
      <label style={label}>Signing in</label>
      <p style={{ fontSize: 13, margin: 0, color: '#999' }}>
        Last signed in {fmtWhen(user.last_sign_in_at)} · account created {fmtDate(user.created_at)}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input style={{ ...input, flex: 1, minWidth: 160 }} type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="New password (8+ characters)" autoComplete="new-password" />
        <input style={{ ...input, flex: 1, minWidth: 160 }} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
          placeholder="Type it again" autoComplete="new-password" />
        <button onClick={change} disabled={busy || pw.length < 8 || !pw2}>{busy ? 'Saving…' : 'Change password'}</button>
      </div>
      {msg && <p style={{ ...help, color: msg.err ? '#c00' : '#060' }}>{msg.text}</p>}
      <p style={help}>To change your sign-in email, ask SwimZone. Forgotten your password? Sign out and use "Forgot password?" on the sign-in page.</p>
    </>
  );
}

// Coaching / team-manager qualifications. Shown to people on the join screen of
// any group where you're staff; self-declared until SwimZone verifies them.
function Qualifications({ userId, label, help, input }) {
  const [list, setList] = useState([]);
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState(null);

  const load = async () => setList((await getMyQualifications(userId)).data || []);
  useEffect(() => { load(); }, [userId]);

  async function add() {
    setError(null);
    const { error: e } = await addQualification({ title, issuer, expiresOn: expires || null });
    if (e) { setError(errorText(e)); return; }
    setTitle(''); setIssuer(''); setExpires(''); load();
  }
  async function remove(id) {
    const { error: e } = await removeQualification(id);
    if (e) setError(errorText(e)); else load();
  }

  return (
    <>
      <label style={label}>Qualifications</label>
      {list.length === 0 && <p style={help}>None added.</p>}
      {list.map((q) => (
        <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, margin: '4px 0' }}>
          <span>{q.title}{q.issuer ? ` (${q.issuer})` : ''}{q.expires_on ? `, until ${new Date(q.expires_on).toLocaleDateString()}` : ''}</span>
          <span style={{ fontSize: 12, color: q.verified_at ? '#060' : '#999' }}>{q.verified_at ? 'verified' : 'self-declared'}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => remove(q.id)}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <input style={{ ...input, flex: 2, minWidth: 180 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Swim England Coach Level 2" />
        <input style={{ ...input, flex: 1, minWidth: 120 }} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issued by" />
        <input style={{ ...input, flex: 1, minWidth: 140 }} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} title="Expires (optional)" />
        <button onClick={add} disabled={!title.trim()}>Add</button>
      </div>
      {error && <p style={{ ...help, color: '#c00' }}>{error}</p>}
      <p style={help}>Shown on the join screen of groups where you're a coach, Team Manager or other staff, so members and parents know who they're joining. Includes safeguarding and DBS if you want to list them.</p>
    </>
  );
}
