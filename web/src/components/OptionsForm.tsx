import { useId } from 'react';
import type { OptionSpec } from '../lib/types';

function visible(spec: OptionSpec, values: Record<string, unknown>, specs: OptionSpec[]) {
  if (!spec.showIf) return true;
  return Object.entries(spec.showIf).every(([k, allowed]) => {
    const dep = specs.find((s) => s.key === k);
    const v = values[k] ?? dep?.default;
    return allowed.map(String).includes(String(v));
  });
}

/** Renders server-declared settings. The server validates everything again. */
export function OptionsForm({ specs, values, onChange }: { specs: OptionSpec[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const base = useId();
  if (!specs.length) return <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>No settings needed — the best possible quality is applied automatically.</p>;
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="settings">
      {specs.filter((s) => visible(s, values, specs)).map((s) => {
        const id = `${base}-${s.key}`;
        const value = values[s.key] ?? s.default;
        const help = s.help ? <span className="help">{s.help}</span> : null;
        switch (s.type) {
          case 'select': {
            const choice = s.choices?.find((c) => String(c.value) === String(value));
            return (
              <div className="field" key={s.key}>
                <label htmlFor={id}>{s.label}</label>
                <select id={id} value={String(value ?? '')} onChange={(e) => set(s.key, e.target.value)}>
                  {s.choices?.map((c) => (
                    <option key={String(c.value)} value={String(c.value)}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {choice?.hint ? <span className="help">{choice.hint}</span> : help}
              </div>
            );
          }
          case 'toggle':
            return (
              <div className="field" key={s.key}>
                <label className="toggle" htmlFor={id}>
                  <input id={id} type="checkbox" role="switch" checked={Boolean(value)} onChange={(e) => set(s.key, e.target.checked)} />
                  <span>{s.label}</span>
                </label>
                {help}
              </div>
            );
          case 'range':
            return (
              <div className="field" key={s.key}>
                <label htmlFor={id}>{s.label}</label>
                <div className="range-row">
                  <input id={id} type="range" min={s.min} max={s.max} step={s.step ?? 1} value={Number(value ?? s.min ?? 0)} onChange={(e) => set(s.key, Number(e.target.value))} />
                  <output htmlFor={id}>
                    {String(value ?? '')}
                    {s.unit}
                  </output>
                </div>
                {help}
              </div>
            );
          case 'number':
            return (
              <div className="field" key={s.key}>
                <label htmlFor={id}>{s.label}</label>
                <input id={id} type="number" inputMode="decimal" min={s.min} max={s.max} step={s.step ?? 1} placeholder={s.placeholder} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => set(s.key, e.target.value === '' ? undefined : Number(e.target.value))} />
                {help}
              </div>
            );
          case 'color':
            return (
              <div className="field" key={s.key}>
                <label htmlFor={id}>{s.label}</label>
                <input id={id} type="color" value={String(value || '#ffffff')} onChange={(e) => set(s.key, e.target.value)} />
                {help}
              </div>
            );
          default:
            return (
              <div className="field" key={s.key}>
                <label htmlFor={id}>
                  {s.label}
                  {s.required ? '' : <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}
                </label>
                <input
                  id={id}
                  type={s.type === 'password' ? 'password' : 'text'}
                  autoComplete={s.type === 'password' ? 'new-password' : 'off'}
                  placeholder={s.placeholder}
                  value={value === undefined || value === null ? '' : String(value)}
                  onChange={(e) => set(s.key, e.target.value === '' ? undefined : e.target.value)}
                />
                {help}
              </div>
            );
        }
      })}
    </div>
  );
}

export function missingRequired(specs: OptionSpec[], values: Record<string, unknown>): string | null {
  const s = specs.find((x) => x.required && visible(x, values, specs) && (values[x.key] === undefined || values[x.key] === ''));
  return s ? `${s.label} is required.` : null;
}
