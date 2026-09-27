import { router } from 'expo-router';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { AprilTagArtwork } from '@/features/tags/AprilTagArtwork';
import { SketchfabPreview } from '@/components/SketchfabPreview';
import { RotatableObject } from '@/components/RotatableObject';

const fadeIn = { initial: { opacity: 0, y: 36 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, amount: .2 }, transition: { duration: .7, ease: 'easeOut' as const } };

export function HomeExperience() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const reducedMotion = !!useReducedMotion();
  const { scrollYProgress } = useScroll({ container: scrollRef });
  const heroY = useTransform(scrollYProgress, [0, .16], [0, reducedMotion ? 0 : 260]);
  const heroScale = useTransform(scrollYProgress, [0, .16], [1.12, reducedMotion ? 1.12 : 1.85]);
  const pairY = useTransform(scrollYProgress, [.12, .58], [reducedMotion ? 0 : 100, reducedMotion ? 0 : -100]);
  const leftRotate = useTransform(scrollYProgress, [.12, .58], [reducedMotion ? 0 : -9, reducedMotion ? 0 : 11]);
  const rightRotate = useTransform(scrollYProgress, [.12, .58], [reducedMotion ? 0 : 12, reducedMotion ? 0 : -8]);
  return <div className="sbs-home" ref={scrollRef}>
    <style>{`
      .sbs-home{height:100vh;overflow-y:auto;overflow-x:hidden;color:#FFE6DC;background:#161316;font-family:'Neue Montreal','Helvetica Neue',Arial,sans-serif;scroll-behavior:smooth;padding-bottom:130px}
      .sbs-home *{box-sizing:border-box}
      .sbs-home::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 48% 18%,#45302770,transparent 45%),radial-gradient(ellipse at 90% 70%,#FF6D2915,transparent 36%);animation:sbs-breathe 15s ease-in-out infinite alternate}
      @keyframes sbs-breathe{from{transform:scale(1) translateY(0)}to{transform:scale(1.12) translateY(-3%)}}
      .sbs-home section{position:relative;z-index:1}
      .sbs-home .eyebrow{font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#FCB187;font-weight:600}
      .sbs-home .gradient{background:linear-gradient(112deg,#FFE6DC 18%,#FCB187 64%,#FF6D29 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
      .sbs-home h1,.sbs-home h2,.sbs-home h3,.sbs-home p{margin:0}
      .sbs-home p{color:#BABABA;line-height:1.65}
      .sbs-home .hero{min-height:min(100vh,900px);display:flex;flex-direction:column;align-items:center;text-align:center;padding:clamp(50px,9vh,100px) 24px 80px;overflow:hidden}
      .sbs-home .hero h1{font-size:clamp(72px,12vw,168px);font-weight:500;letter-spacing:-.095em;line-height:.93;position:relative;z-index:2}
      .sbs-home .hero h2{font-size:clamp(26px,4.5vw,54px);font-weight:400;letter-spacing:-.05em;position:relative;z-index:2;margin-top:20px}
      .sbs-home .hero p{max-width:550px;margin-top:18px;font-size:18px;position:relative;z-index:2}
      .sbs-home .hero-planet{width:min(860px,100vw);height:540px;margin-top:-12px;position:relative;filter:drop-shadow(0 0 55px #FF6D2933);will-change:transform}
      .sbs-home .hero-planet .sbs-model-preview,.sbs-home .pair-visual .sbs-model-preview,.sbs-home .device-card .sbs-model-preview{height:100%!important}
      .sbs-home .hero-planet::after{content:'';position:absolute;left:17%;right:17%;bottom:16%;height:6px;border-radius:50%;background:#FF6D29;filter:blur(16px);box-shadow:0 0 65px 23px #FF6D2955}
      .sbs-home .section-inner{max-width:1160px;margin:auto;padding:100px 30px}
      .sbs-home .statement{min-height:600px;display:grid;align-items:center;text-align:center}
      .sbs-home .statement h2{font-size:clamp(38px,6vw,76px);font-weight:400;letter-spacing:-.07em;line-height:1.1;max-width:870px;margin:26px auto}
      .sbs-home .statement p{font-size:20px;max-width:620px;margin:auto}
      .sbs-home .pair{min-height:820px;text-align:center}
      .sbs-home .pair h2,.sbs-home .model h2,.sbs-home .devices h2{font-size:clamp(38px,6vw,72px);line-height:1.05;letter-spacing:-.065em;font-weight:400;margin:16px 0 24px}
      .sbs-home .pair-visual{height:390px;position:relative;margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:26px}
      .sbs-home .pair-actions{display:flex;gap:clamp(50px,22vw,300px);align-items:center;justify-content:center;position:relative;margin-top:12px}
      .sbs-home button{cursor:pointer;border:1px solid #FCB18777;border-radius:999px;background:#45302766;color:#FFE6DC;backdrop-filter:blur(22px);padding:16px 24px;font:inherit;transition:transform .2s,background .2s,border-color .2s}
      .sbs-home button:hover{transform:translateY(-3px);background:#FF6D29;border-color:#FCB187}
      .sbs-home button:focus-visible{outline:2px solid #FFE6DC;outline-offset:3px}
      .sbs-home .model{min-height:730px;display:flex;align-items:center;overflow:hidden}
      .sbs-home .model-grid{display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center}
      .sbs-home .model p{font-size:18px;max-width:540px}
      .sbs-home .model .technical{margin-top:28px;display:grid;gap:12px}
      .sbs-home .model .technical div{padding:18px 20px;border:1px solid #FCB18722;border-radius:20px;background:#16131677;backdrop-filter:blur(12px)}
      .sbs-home .wave{height:340px;border-radius:50%;background:radial-gradient(ellipse at 45% 75%,#FFE6DC 0,#FCB187 9%,#FF6D29 25%,#802D0D 45%,transparent 70%);filter:blur(13px);box-shadow:0 70px 130px #FF6D2955;animation:sbs-wave 8s ease-in-out infinite alternate}
      @keyframes sbs-wave{from{transform:rotate(-9deg) scale(.95)}to{transform:rotate(9deg) scale(1.12)}}
      .sbs-home .devices{text-align:center}
      .sbs-home .device-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px;align-items:center}
      .sbs-home .device-card{min-height:360px;display:flex;justify-content:center;align-items:center;background:transparent}
      .sbs-home .device-card .tag{display:flex;justify-content:center}
      .sbs-home .sbs-rotatable-object:focus{outline:none}
      .sbs-home .sbs-rotatable-object:focus-visible{filter:drop-shadow(0 0 12px #FF6D29A8)}
      .sbs-home .devices p{max-width:720px;margin:36px auto 0;font-size:18px}
      .sbs-home .simple{margin:90px auto 0;max-width:820px;border:1px solid #FCB18755;border-radius:30px;padding:34px;background:#45302755;backdrop-filter:blur(25px)}
      .sbs-home .simple h3{font-size:27px;letter-spacing:-.04em;margin-bottom:10px;font-weight:500}
      .sbs-home .credits{margin:55px auto 0;max-width:820px;text-align:left;color:#BABABA;font-size:12px}
      .sbs-home .credits summary{cursor:pointer;color:#FCB187;list-style:none}
      .sbs-home .credits summary::-webkit-details-marker{display:none}
      .sbs-home .credits p{font-size:12px;margin-top:12px}
      @media(max-width:700px){.sbs-home .hero{min-height:760px}.sbs-home .hero-planet{height:360px;margin-top:20px}.sbs-home .section-inner{padding:75px 24px}.sbs-home .statement{min-height:490px}.sbs-home .pair{min-height:650px}.sbs-home .pair-visual{height:230px;gap:10px}.sbs-home .pair-actions{gap:20px;margin-top:20px}.sbs-home .pair-actions button{font-size:13px;padding:14px}.sbs-home .model-grid,.sbs-home .device-grid{grid-template-columns:1fr}.sbs-home .model-grid{gap:30px}.sbs-home .wave{height:210px;order:-1}.sbs-home .device-grid{gap:20px}.sbs-home .device-card{min-height:260px}.sbs-home .device-card:first-child{height:260px;overflow:hidden}}
      @media(max-width:700px){.sbs-home::before,.sbs-home .wave{animation:none}.sbs-home .hero-planet{filter:none}.sbs-home .simple,.sbs-home .model .technical div{backdrop-filter:none}}
      @media(max-width:380px){.sbs-home .hero h1{font-size:58px}.sbs-home .pair-actions{gap:8px}.sbs-home .pair-actions button{padding:12px 9px;font-size:12px}}
      @media(prefers-reduced-motion:reduce){.sbs-home,.sbs-home::before,.sbs-home .wave{animation:none!important;scroll-behavior:auto}}
    `}</style>
    <section className="hero"><span className="eyebrow">A universe of real connection</span><h1 className="gradient">sidebyside</h1><h2>Your people. Closer than you think.</h2><p>Meet the people around you through the things that make you, you.</p><motion.div className="hero-planet" style={{ y: heroY, scale: heroScale }}><SketchfabPreview model="mars" height={540} /></motion.div></section>
    <section className="statement"><motion.div className="section-inner" {...fadeIn}><span className="eyebrow">Why we exist</span><h2>Less scrolling. <span className="gradient">More showing up.</span></h2><p>SidebySide makes it easier to discover people nearby with shared interests, then gives you a reason to put the phone away and meet naturally.</p></motion.div></section>
    <section className="pair section-inner"><motion.div {...fadeIn}><span className="eyebrow">Choose your orbit</span><h2>Start somewhere <span className="gradient">real.</span></h2><p>Find a conversation near you, or shape the profile people can connect with.</p></motion.div><motion.div className="pair-visual" style={{ y: pairY }}><motion.div style={{ rotate: leftRotate }}><SketchfabPreview model="planet" height={390} /></motion.div><motion.div style={{ rotate: rightRotate }}><SketchfabPreview model="venus" height={390} /></motion.div></motion.div><div className="pair-actions"><button onClick={() => router.push('/(tabs)/connect')}>Find connections ↗</button><button onClick={() => router.push('/(tabs)/profile')}>Edit profile ↗</button></div></section>
    <section className="model"><div className="section-inner model-grid"><motion.div {...fadeIn}><span className="eyebrow">Built on UCF’s Newton supercomputer</span><h2>A powerful model. <span className="gradient">A more human hello.</span></h2><p>We calibrated our matching policy and evaluated a pinned, 4-billion-parameter Qwen3 reranker on Newton. The system looks beyond shared keywords: it weighs the conversation each person actually wants, checks that the reason to connect is supported by approved profile details, and can hold back a suggestion when the evidence is thin.</p><div className="technical"><div><b>01 · Discover nearby</b><p>Opt-in location or a native Bluetooth encounter brings possible connections into view.</p></div><div><b>02 · Match with evidence</b><p>Qwen3 assesses conversational relevance; DeBERTa checks firsthand claims, and MiniLM compares conversation style. In a controlled Newton evaluation, the evidence-gated system recommended 19 of 21 supported synthetic pairs and deferred all 24 unknown cases. Those are development results, not a real-world success rate.</p></div><div><b>03 · Let both people decide</b><p>A recommendation reaches both people as a private invitation. Agreed profile details and a connection in Matches follow only when both accept.</p></div></div></motion.div><motion.div className="wave" {...fadeIn} aria-hidden="true" /></div></section>
    <section className="devices section-inner"><motion.div {...fadeIn}><span className="eyebrow">A connection you can see</span><h2>Meet Comet <span className="gradient">in the real world.</span></h2></motion.div><div className="device-grid"><motion.div className="device-card" {...fadeIn}><RotatableObject label="Rotate VR glasses illustration"><SketchfabPreview model="glasses" height={360} /></RotatableObject></motion.div><motion.div className="device-card" {...fadeIn}><RotatableObject label="Rotate Comet Charm AprilTag"><div className="tag"><AprilTagArtwork tagId={3} size={180} /></div></RotatableObject></motion.div></div><p>With supported Meta glasses, a visible Comet Charm AprilTag can identify an opted-in account during an authorized encounter. The 3D glasses model is a visual reference, not a model of Meta hardware. Your own Charm ID appears in Connect.</p><div className="simple"><h3>No glasses or Comet Charm?</h3><p>Turn on location discovery in the website or mobile app. The native mobile app also supports Bluetooth discovery when both people enable it.</p></div><details className="credits"><summary>Visual credits</summary><p>Mars model reference by v7x; Planet by dubson, Venus by butcher.cnd, VR glasses concept by taigo, and Connect black hole by rubykamen on Sketchfab. The latter four are CC BY. The black hole image has its background removed and color warmed.</p></details></section>
  </div>;
}
