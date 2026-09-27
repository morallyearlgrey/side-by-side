export function TabMaterial() {
  return <div className="sbs-tab-material"><style>{`
    .sbs-tab-material{position:absolute;inset:0;pointer-events:none;border-radius:28px;background:linear-gradient(135deg,#453027AA,#161316DE);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);box-shadow:0 18px 55px #0009,inset 0 1px 0 #FFE6DC3B;overflow:hidden}
    .sbs-tab-material::before{content:'';position:absolute;inset:0;padding:1px;border-radius:inherit;background:conic-gradient(from var(--sbs-nav-angle),#FF6D29,#FCB187 8%,transparent 20%,transparent 73%,#FF6D29 94%);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:sbs-nav-chase 9s linear infinite}
    @property --sbs-nav-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
    @keyframes sbs-nav-chase{to{--sbs-nav-angle:360deg}}
    @media(prefers-reduced-motion:reduce){.sbs-tab-material::before{animation:none}}
  `}</style></div>;
}
