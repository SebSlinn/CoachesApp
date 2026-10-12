// src/pages/Account.jsx — /account
// Your own account: set the public name others see on results you add ("Added
// by …"), and your full name. Email is sign-in only and never shown to others.
// Self-edit only — RLS (sz_users_self_update) allows a user to change just their
// own users row; date of birth is locked by a trigger, not editable here.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile } from '../services/users';

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
        </>
      )}
    </div>
  );
}
