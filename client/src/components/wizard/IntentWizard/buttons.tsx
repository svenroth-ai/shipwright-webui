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

export function WzOutline({ children, style, ...rest }: Props) {
  return (
    <button
      type="button"
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
