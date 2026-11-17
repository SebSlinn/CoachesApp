// components/ThemePicker.jsx
// Choose light / dark screens for this device (styles/theme.js). "Match this device" follows the
// phone or computer's own setting and is the default.
import { useTheme } from '../context/ThemeContext.jsx';
import { THEME_CHOICES } from '../services/themeService.js';

export default function ThemePicker({ style }) {
  const { choice, setChoice } = useTheme();
  return (
    <select value={choice} onChange={(e) => setChoice(e.target.value)}
      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14, ...style }}>
      {THEME_CHOICES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}
