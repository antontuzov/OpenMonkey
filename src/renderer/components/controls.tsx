import type { ReactNode } from "react";

/** A labelled row: a title, an explanation and the control that changes it. */
export const SettingRow: React.FC<{ title: string; copy?: string; children: ReactNode }> = ({
  title,
  copy,
  children,
}) => (
  <div className="row">
    <div>
      <p className="row-title">{title}</p>
      {copy && <p className="row-copy">{copy}</p>}
    </div>
    <div className="flex items-center gap-2.5 shrink-0">{children}</div>
  </div>
);

/** A switch that names itself, so a screen reader says what it turns on. */
export const Toggle: React.FC<{ on: boolean; label: string; onChange: () => void; disabled?: boolean }> = ({
  on,
  label,
  onChange,
  disabled,
}) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={`toggle ${on ? "toggle-on" : ""} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
  />
);
