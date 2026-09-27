import type { PropsWithChildren } from 'react';
export function GradientText({ children, size = 42, align = 'left' }: PropsWithChildren<{ size?: number; align?: 'left' | 'center' }>) {
  return <span style={{ display: 'block', fontFamily: 'Neue Montreal, Helvetica Neue, Arial, sans-serif', fontSize: `clamp(${Math.round(size * .72)}px, 5vw, ${size}px)`, fontWeight: 400, lineHeight: 1.08, letterSpacing: '-.055em', textAlign: align, background: 'linear-gradient(110deg,#FFE6DC 12%,#FCB187 70%,#FF6D29)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }}>{children}</span>;
}
