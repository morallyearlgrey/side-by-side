import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { SpaceCanvas } from '@/components/SpaceCanvas';
import { SketchfabPreview } from '@/components/SketchfabPreview';

export function OnboardingIntro({ onStart }: { onStart: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = !!useReducedMotion();
  const { scrollYProgress } = useScroll({ container: ref });
  const planetY = useTransform(scrollYProgress, [0, .5], [reducedMotion ? 0 : -90, reducedMotion ? 0 : 260]);
  const planetRotate = useTransform(scrollYProgress, [0, .5], [0, reducedMotion ? 0 : 35]);
  return <div className="sbs-intro" ref={ref}><style>{`
    .sbs-intro{height:100vh;overflow-y:auto;scroll-snap-type:y proximity;background:#161316;color:#FFE6DC;font-family:'Neue Montreal','Helvetica Neue',Arial,sans-serif}
    .sbs-intro::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 50% 50%,#45302788,transparent 45%),radial-gradient(ellipse at 100% 30%,#FF6D2925,transparent 42%);pointer-events:none;animation:sbs-intro-flow 16s ease-in-out infinite alternate}
    @keyframes sbs-intro-flow{to{transform:translate(-8%,5%) scale(1.1)}}
    .sbs-intro section{height:100vh;min-height:670px;position:relative;scroll-snap-align:start;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:36px 20px;overflow:hidden}
    .sbs-intro .eyebrow{color:#FCB187;font-size:11px;letter-spacing:.25em;text-transform:uppercase}
    .sbs-intro h1,.sbs-intro h2{font-weight:400;letter-spacing:-.065em;line-height:1.08;margin:16px 0;max-width:760px}
    .sbs-intro h1{font-size:clamp(44px,8vw,104px)}.sbs-intro h2{font-size:clamp(40px,6vw,74px)}
    .sbs-intro p{font-size:18px;color:#BABABA;line-height:1.6;max-width:520px;margin:0}
    .sbs-intro .orb{width:min(700px,90vw);height:470px;margin-top:-30px;filter:drop-shadow(0 0 55px #FF6D2944)}
    .sbs-intro .orb .sbs-model-preview{height:100%!important}
    .sbs-intro .astronaut{height:360px;width:380px;max-width:100%;filter:drop-shadow(0 0 36px #FF6D2944)}
    .sbs-intro .glass-button{cursor:pointer;color:#FFE6DC;border:1px solid #FCB18799;border-radius:999px;padding:16px 28px;font:inherit;font-size:16px;background:#45302788;backdrop-filter:blur(24px);margin-top:30px;box-shadow:0 0 30px #FF6D292A}
    .sbs-intro .glass-button:hover{background:#FF6D29;color:#161316}.sbs-intro .glass-button:focus-visible{outline:2px solid #FFE6DC;outline-offset:3px}
    .sbs-intro .scroll{position:absolute;bottom:35px;color:#FCB187;font-size:11px;letter-spacing:.2em}
    @media(max-width:600px){.sbs-intro .orb{height:330px;margin-top:0}.sbs-intro .astronaut{height:300px}.sbs-intro section{min-height:600px}}
    @media(prefers-reduced-motion:reduce){.sbs-intro,.sbs-intro::before{animation:none;scroll-behavior:auto}}
  `}</style>
    <section><motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}><span className="eyebrow">Welcome to your orbit</span><h1>Every connection starts somewhere.</h1><p>Let’s discover the things that make you, you.</p></motion.div><motion.div className="orb" style={{ y: planetY, rotate: planetRotate }}><SketchfabPreview model="mars" height={470} /></motion.div><span className="scroll">SCROLL TO MEET COMET ↓</span></section>
    <section><motion.div className="astronaut" initial={{ opacity: 0, y: 70 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}><SpaceCanvas scene="astronaut" height={360} reducedMotion={reducedMotion} /></motion.div><motion.div initial={{ opacity: 0, y: 25 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}><span className="eyebrow">Your companion in the cosmos</span><h2>Hi, I’m <span style={{ color: '#FF6D29' }}>Comet.</span></h2><p>I’ll help you create a profile from your own words. You’ll review every detail before it is used for matching.</p><button className="glass-button" onClick={onStart}>Begin my journey ↗</button></motion.div></section>
  </div>;
}
