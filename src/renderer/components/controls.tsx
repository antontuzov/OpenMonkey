import type { ReactNode } from "react";

/**
 * A labelled row: a title, an explanation and the control that changes it.
 *
 * `dynamic` marks a row whose title is data rather than a setting — the date of a
 * backup, the name of a file — so the search sweep can leave it alone: there is
 * nothing to index under a name the app cannot know in advance.
 */
export const SettingRow: React.FC<{
  title: string;
  copy?: string;
  dynamic?: boolean;
  children: ReactNode;
}> = ({ title, copy, dynamic, children }) => (
  <div className="row">
    <div>
      <p className="row-title" data-dynamic={dynamic ? "1" : undefined}>
        {title}
      </p>
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
