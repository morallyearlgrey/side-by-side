import { motion, useReducedMotion } from 'framer-motion';
import type { PropsWithChildren } from 'react';

export function GlowPanel({ children }: PropsWithChildren) {
  const reducedMotion = useReducedMotion();
  return <motion.div className="sbs-glass-panel" initial={reducedMotion ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
    <style>{`
      .sbs-glass-panel{position:relative;box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding:clamp(18px,4vw,38px);border-radius:30px;background:linear-gradient(135deg,#FFE6DC12,#45302744 45%,#161316D9);backdrop-filter:blur(30px) saturate(1.3);-webkit-backdrop-filter:blur(30px) saturate(1.3);box-shadow:0 25px 90px #0008,inset 0 1px 0 #FFE6DC40;isolation:isolate}
      .sbs-glass-panel::before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:conic-gradient(from var(--sbs-angle),transparent 0%,#FFE6DC 9%,#FF6D29 16%,transparent 26%,transparent 73%,#FCB187 84%,transparent 93%);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;animation:sbs-border 8s linear infinite}
      .sbs-glass-panel::after{content:'';position:absolute;width:35%;height:20%;top:-8%;left:-8%;background:#FF6D29;filter:blur(75px);opacity:.2;z-index:-1;pointer-events:none}
      @property --sbs-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
      @keyframes sbs-border{to{--sbs-angle:360deg}}
      @media(prefers-reduced-motion:reduce){.sbs-glass-panel::before{animation:none}}
    `}</style>{children}
  </motion.div>;
}
