/*
 * Shared wizard buttons (A08). Solid controls over the photo backdrop — token
 * colours only, no palette/hex classes (no-hardcoded-colours guard).
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

const base: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 14,
  fontWeight: 600,
  padding: "10px 18px",
  borderRadius: 10,
  cursor: "pointer",
  border: "1px solid transparent",
};

// WzPrimary rides #fff on var(--accent) (readable under both on-photo token
// arms), so it needs no `.wz-outline` reset hook — WzPrimary's test asserts that
// absence. className flows through ...rest (no hard-coded className to merge).
export function WzPrimary({ children, style, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        ...base,
        background: "var(--accent)",
        color: "#fff",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function WzOutline({ children, style, className, ...rest }: Props) {
  return (
    <button
      type="button"
      // `wz-outline` is the on-photo rule-2 reset hook: this is a SOLID
      // var(--card) reading surface, so --ink must stay dark. Without the class
      // .on-photo rule-1 flips --ink white → white-on-white "Back" button.
      className={className ? `wz-outline ${className}` : "wz-outline"}
      style={{
        ...base,
        background: "var(--card)",
        color: "var(--ink)",
        borderColor: "var(--line-strong)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
