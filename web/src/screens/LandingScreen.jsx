// LandingScreen.jsx — public entry (/). Built around the questions a first-time visitor
// asks, in order: what is this and what do I get (hero + example result), why believe
// it (proof strip), why it matters (problem), how it works (the four-step loop), how to
// read a result, how the estimate is made, what we promise, and where to start.
// Every number shown is real: the example is the model's actual output for Madurai, and
// the accuracy figures come from the held-out validation in docs/ml-data-and-training-plan.md.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  MapPin, HardHat, ArrowRight, ChevronRight, ChevronDown, Droplets, Waves, Layers,
  TrendingDown, Coins, NotebookPen, Smartphone, ScanSearch, ShieldCheck, Scale,
  Database, BrainCircuit, Target, Ban, CheckCircle2, XCircle, Sprout, Mic, WifiOff,
  BadgeCheck, Languages, MessageCircleQuestion, Gift, UserCheck, RotateCcw, TriangleAlert,
} from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import LegalFooter from "../components/LegalFooter.jsx";
import { getLedger } from "../api.js";
import { useI18n } from "../i18n.jsx";
import { metres } from "../helpBot.js";

// The groundwater model's real answer for Madurai (9.9252, 78.1198), model gw-eeeb4ff29109.
const EXAMPLE = {
  pre: { depthM: 6.44, lowM: 3.64, highM: 10.96 },
  post: { depthM: 5.98, lowM: 3.12, highM: 10.6 },
  chance: 0.79,
  rock: "Migmatite-Gneiss Complex",
};

// Fade sections in as they scroll into view. Content stays visible without JS, with
// reduced motion, or where IntersectionObserver is missing.
function useReveal(rootRef) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!root || reduced || !("IntersectionObserver" in window)) return undefined;
    setEnabled(true);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    root.querySelectorAll("[data-reveal]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [rootRef]);
  return enabled;
}

export default function LandingScreen() {
  const { t } = useI18n();
  const [ledger, setLedger] = useState(null);
  const rootRef = useRef(null);
  const reveal = useReveal(rootRef);
  useEffect(() => { getLedger().then(setLedger).catch(() => {}); }, []);

  return (
    <div className={`lp${reveal ? " lp-js" : ""}`} ref={rootRef}>
      <AppHeader subtitle={t("brand.tagline")} />

      <main>
        <Hero t={t} />
        <ProofStrip t={t} />
        <Problem t={t} />
        <HowItWorks t={t} />
        <ReadYourResult t={t} />
        <UnderTheHood t={t} />
        <Promises t={t} ledger={ledger} />
        <Audiences t={t} />
        <Faq t={t} />
        <FinalCta t={t} />
      </main>

      <footer className="lp-footer">
        BoreSakshi · MSME Idea Hackathon 6.0
        <LegalFooter />
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

function Hero({ t }) {
  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <Contours />
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow"><Droplets size={16} strokeWidth={2.2} /> {t("land.eyebrow")}</p>
          <h1 id="lp-title" className="lp-h1">{t("land.h1")}</h1>
          <p className="lp-lead">{t("land.lead")}</p>
          <div className="lp-cta">
            <Link to="/map" className="btn btn-primary lp-btn-lg">
              <MapPin size={19} strokeWidth={2.2} /> {t("land.ctaCheck")}
            </Link>
            <Link to="/signin" className="btn lp-btn-outline lp-btn-lg">
              <HardHat size={19} strokeWidth={2.2} /> {t("land.ctaOperator")}
            </Link>
          </div>
          <ul className="lp-chips">
            <li><Gift size={15} strokeWidth={2.2} /> {t("land.chipFree")}</li>
            <li><UserCheck size={15} strokeWidth={2.2} /> {t("land.chipNoAccount")}</li>
            <li><Languages size={15} strokeWidth={2.2} /> {t("land.chipLang")}</li>
          </ul>
        </div>

        <div className="lp-hero-visual">
          <GroundScene t={t} />
          <ExampleCard t={t} />
        </div>
      </div>
    </section>
  );
}

// Decorative topographic contour lines behind the dark bands.
function Contours() {
  return (
    <svg className="lp-contours" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path
          key={i}
          d={`M-50 ${120 + i * 70} C 200 ${60 + i * 70}, 380 ${200 + i * 66}, 620 ${130 + i * 70} S 1000 ${40 + i * 74}, 1260 ${150 + i * 66}`}
        />
      ))}
      {[0, 1, 2].map((i) => <ellipse key={`e${i}`} cx="980" cy="120" rx={70 + i * 46} ry={34 + i * 24} />)}
    </svg>
  );
}

// A hand-drawn cross-section: the farmer's field, the ground below it, and the water
// level moving between May (deeper) and November (shallower). The borewell reaching
// into hard rock is what the ledger checks with real drilling results.
function GroundScene({ t }) {
  return (
    <figure className="lp-scene">
      <svg viewBox="0 0 520 440" role="img" aria-label={t("land.visualAlt")}>
        <defs>
          <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#123a5e" />
            <stop offset="1" stopColor="#2d7aa3" />
          </linearGradient>
          <pattern id="lp-grit" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="4" r="1.4" fill="#8f7149" />
            <circle cx="10" cy="10" r="1.1" fill="#8f7149" />
          </pattern>
          <clipPath id="lp-below">
            <path d="M0 192 C 120 184, 240 200, 360 190 S 480 186, 520 194 L520 440 L0 440 Z" />
          </clipPath>
        </defs>

        {/* sky, sun, far hills */}
        <rect width="520" height="160" fill="url(#lp-sky)" />
        <circle cx="70" cy="52" r="20" fill="#ffd27a" opacity="0.92" />
        <path d="M0 132 C 70 96, 130 112, 200 100 S 330 84, 400 104 S 480 96, 520 110 L520 160 L0 160 Z" fill="#245f80" opacity="0.7" />

        {/* soil, weathered rock, hard rock */}
        <path d="M0 140 C 80 128, 160 146, 260 136 S 440 126, 520 138 L520 440 L0 440 Z" fill="#c9a067" />
        <path d="M0 192 C 120 184, 240 200, 360 190 S 480 186, 520 194 L520 440 L0 440 Z" fill="#a8875a" />
        <path d="M0 192 C 120 184, 240 200, 360 190 S 480 186, 520 194 L520 440 L0 440 Z" fill="url(#lp-grit)" opacity="0.55" />
        <path d="M0 302 C 100 292, 220 312, 330 300 S 470 294, 520 304 L520 440 L0 440 Z" fill="#56636f" />

        {/* water: the saturated zone rises after the monsoon and falls by May */}
        <g clipPath="url(#lp-below)">
          <g className="lp-water">
            <rect x="0" y="228" width="520" height="80" fill="#22c3c9" opacity="0.42" />
            <path d="M0 228 q 26 -5 52 0 t 52 0 t 52 0 t 52 0 t 52 0 t 52 0 t 52 0 t 52 0 t 52 0 t 52 0" fill="none" stroke="#9ff3f5" strokeWidth="2" />
          </g>
        </g>
        {/* water held in cracks of the hard rock */}
        <g stroke="#3ad3d8" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85">
          <path d="M40 318 l 34 26 l -10 28 l 30 30" />
          <path d="M210 312 l -18 34 l 26 22" />
          <path d="M300 322 l 40 30 l 28 -8 l 34 40" />
          <path d="M470 316 l -24 40 l 22 30" />
        </g>
        <g stroke="#3f4a54" strokeWidth="1.6" fill="none" opacity="0.8">
          <path d="M120 330 l 22 30 l -8 34" />
          <path d="M250 380 l 30 18" />
          <path d="M420 350 l 18 22" />
        </g>

        {/* surface: grass, crops, tree */}
        <path d="M0 140 C 80 128, 160 146, 260 136 S 440 126, 520 138" fill="none" stroke="#5cb85c" strokeWidth="6" />
        <g stroke="#3f9a45" strokeWidth="2.4" strokeLinecap="round">
          {[30, 52, 74, 96, 118].map((x) => (
            <g key={x}>
              <path d={`M${x} 134 l -5 -12`} />
              <path d={`M${x} 134 l 0 -15`} />
              <path d={`M${x} 134 l 5 -12`} />
            </g>
          ))}
        </g>
        <rect x="497" y="106" width="5" height="28" fill="#7a5a3a" />
        <circle cx="500" cy="98" r="14" fill="#3f9a45" />

        {/* seasonal water levels */}
        <line x1="0" y1="228" x2="520" y2="228" stroke="#bff7f8" strokeWidth="1.6" strokeDasharray="7 6" />
        <line x1="0" y1="258" x2="520" y2="258" stroke="#d6ecff" strokeWidth="1.6" strokeDasharray="7 6" />
        <text x="12" y="222" className="lp-svg-label">{t("land.vis.post")}</text>
        <text x="12" y="276" className="lp-svg-label">{t("land.vis.pre")}</text>

        {/* layer names */}
        <text x="508" y="178" textAnchor="end" className="lp-svg-label lp-svg-soft">{t("land.vis.soil")}</text>
        <text x="508" y="212" textAnchor="end" className="lp-svg-label lp-svg-soft">{t("land.vis.weathered")}</text>
        <text x="508" y="426" textAnchor="end" className="lp-svg-label lp-svg-soft">{t("land.vis.rock")}</text>

        {/* the farmer's pin and the depth it reports */}
        <ellipse cx="250" cy="138" rx="16" ry="5" className="lp-pin-pulse" />
        <path d="M250 136 C 238 118, 232 110, 232 100 a18 18 0 1 1 36 0 c0 10 -6 18 -18 36 z" fill="#00d2d3" stroke="#06111f" strokeWidth="1.5" />
        <circle cx="250" cy="100" r="6.5" fill="#06111f" />
        <text x="226" y="106" textAnchor="end" className="lp-svg-label lp-svg-strong">{t("land.vis.land")}</text>
        <g stroke="#ffffff" strokeWidth="2" fill="none">
          <line x1="250" y1="146" x2="250" y2="252" />
          <path d="M244 246 l 6 9 l 6 -9" />
          {[166, 186, 206, 226].map((y) => <line key={y} x1="246" y1={y} x2="254" y2={y} />)}
        </g>
        <text x="262" y="200" className="lp-svg-label">{t("land.vis.depth")}</text>

        {/* a borewell goes much deeper; real drilling results check it */}
        <g stroke="#e6edf3" strokeWidth="2.4" strokeLinecap="round">
          <line x1="366" y1="134" x2="380" y2="96" />
          <line x1="394" y1="134" x2="380" y2="96" />
        </g>
        <rect x="377" y="134" width="6" height="168" fill="#e6edf3" />
        <line x1="380" y1="302" x2="380" y2="398" stroke="#e6edf3" strokeWidth="3" strokeDasharray="6 6" />
        <circle cx="380" cy="404" r="5" fill="#3ad3d8" />
        <text x="380" y="62" textAnchor="middle" className="lp-svg-label lp-svg-strong">{t("land.vis.bore1")}</text>
        <text x="380" y="80" textAnchor="middle" className="lp-svg-label">{t("land.vis.bore2")}</text>
      </svg>
    </figure>
  );
}

function ExampleCard({ t }) {
  return (
    <aside className="lp-example" aria-label={t("land.card.kicker")}>
      <p className="lp-example-kicker"><MapPin size={14} strokeWidth={2.4} /> {t("land.card.kicker")}</p>
      <div className="lp-example-row">
        <span className="lp-example-icon"><Droplets size={18} strokeWidth={2.2} /></span>
        <div>
          <strong>{t("gw.depth", { m: metres(EXAMPLE.pre.depthM) })}</strong>
          <span>{t("gw.pre")}</span>
          <span className="lp-nowrap">{t("gw.likely", { low: metres(EXAMPLE.pre.lowM), high: metres(EXAMPLE.pre.highM) })}</span>
        </div>
      </div>
      <div className="lp-example-row">
        <span className="lp-example-icon"><Waves size={18} strokeWidth={2.2} /></span>
        <div>
          <strong>{Math.round(EXAMPLE.chance * 100)}%</strong>
          <span>{t("gw.chance")}</span>
        </div>
      </div>
      <p className="lp-example-note">{t("land.card.note")}</p>
    </aside>
  );
}

/* ---------------------------------------------------------------- proof */

function ProofStrip({ t }) {
  const stats = [1, 2, 3, 4];
  return (
    <section className="lp-proof-wrap" aria-label={t("land.trustKicker")}>
      <div className="lp-wrap">
        <ul className="lp-proof">
          {stats.map((n) => (
            <li key={n}>
              <strong>{t(`land.stat${n}Num`)}</strong>
              <span>{t(`land.stat${n}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- shared */

function SectionHead({ kicker, title, lead, tone, id, dark }) {
  return (
    <header className={`lp-head${dark ? " lp-head-dark" : ""}`} data-reveal>
      <span className={`lp-kicker${tone ? ` lp-kicker-${tone}` : ""}`}>{kicker}</span>
      <h2 id={id}>{title}</h2>
      {lead && <p>{lead}</p>}
    </header>
  );
}

/* ---------------------------------------------------------------- problem */

function Problem({ t }) {
  const items = [
    [TrendingDown, "p1"],
    [Coins, "p2"],
    [NotebookPen, "p3"],
  ];
  return (
    <section className="lp-section" aria-labelledby="lp-problem">
      <div className="lp-wrap">
        <SectionHead id="lp-problem" kicker={t("land.problemKicker")} title={t("land.problemTitle")} tone="warn" />
        <div className="lp-grid-3">
          {items.map(([Icon, key]) => (
            <article key={key} className="lp-card lp-problem" data-reveal>
              <span className="lp-icon lp-icon-warn"><Icon size={22} strokeWidth={2.2} /></span>
              <h3>{t(`land.${key}Title`)}</h3>
              <p>{t(`land.${key}Body`)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- how it works */

function HowItWorks({ t }) {
  const steps = [
    { icon: Smartphone, role: "farmer", n: 1 },
    { icon: ScanSearch, role: "app", n: 2 },
    { icon: HardHat, role: "operator", n: 3 },
    { icon: ShieldCheck, role: "reviewer", n: 4 },
  ];
  return (
    <section className="lp-section lp-section-tint" aria-labelledby="lp-how" id="how-it-works">
      <div className="lp-wrap">
        <SectionHead id="lp-how" kicker={t("land.howKicker")} title={t("land.howTitle")} lead={t("land.howLead")} />
        <ol className="lp-steps">
          {steps.map(({ icon: Icon, role, n }) => (
            <li key={n} className={`lp-step lp-step-${role}`} data-reveal>
              <div className="lp-step-top">
                <span className="lp-step-n" aria-hidden="true">{n}</span>
                <span className="lp-role">{t(`land.role.${role}`)}</span>
              </div>
              <span className="lp-icon lp-icon-lg"><Icon size={26} strokeWidth={2.2} /></span>
              <h3>{t(`land.step${n}Title`)}</h3>
              <p>{t(`land.step${n}Body`)}</p>
              {n < 4 && <ChevronRight className="lp-step-arrow" size={22} strokeWidth={2.4} aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <div className="lp-loop" data-reveal>
          <span className="lp-loop-line" aria-hidden="true" />
          <p><RotateCcw size={16} strokeWidth={2.4} /> {t("land.howLoop")}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- read your result */

function ReadYourResult({ t }) {
  const notes = [1, 2, 3, 4, 5];
  return (
    <section className="lp-section" aria-labelledby="lp-read">
      <div className="lp-wrap">
        <SectionHead id="lp-read" kicker={t("land.readKicker")} title={t("land.readTitle")} />
        <div className="lp-read">
          <div className="lp-result" data-reveal aria-hidden="true">
            <div className="lp-result-head">
              <span className="lp-icon"><Droplets size={20} strokeWidth={2.2} /></span>
              <div>
                <span className="lp-result-kicker">{t("gw.title")}</span>
                <strong>{t("land.card.kicker")}</strong>
              </div>
            </div>
            <div className="lp-result-grid">
              <ResultStat n={1} icon={Droplets} value={t("gw.depth", { m: metres(EXAMPLE.pre.depthM) })} label={t("gw.pre")}
                sub={t("gw.likely", { low: metres(EXAMPLE.pre.lowM), high: metres(EXAMPLE.pre.highM) })} subN={3} />
              <ResultStat n={2} icon={Droplets} value={t("gw.depth", { m: metres(EXAMPLE.post.depthM) })} label={t("gw.post")}
                sub={t("gw.likely", { low: metres(EXAMPLE.post.lowM), high: metres(EXAMPLE.post.highM) })} />
              <ResultStat n={4} icon={Waves} value={`${Math.round(EXAMPLE.chance * 100)}%`} label={t("gw.chance")} />
              <ResultStat icon={Layers} value={EXAMPLE.rock} label={t("gw.rock")} />
            </div>
            <p className="lp-result-warn">
              <span className="lp-badge" aria-hidden="true">5</span>
              <TriangleAlert size={16} strokeWidth={2.2} /> {t("gw.notBorewell")}
            </p>
          </div>

          <ol className="lp-notes">
            {notes.map((n) => (
              <li key={n} data-reveal>
                <span className="lp-badge" aria-hidden="true">{n}</span>
                <div>
                  <h3>{t(`land.read${n}Title`)}</h3>
                  <p>{t(`land.read${n}Body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function ResultStat({ n, icon: Icon, value, label, sub, subN }) {
  return (
    <div className="lp-result-stat">
      {n && <span className="lp-badge lp-badge-corner">{n}</span>}
      <Icon size={17} strokeWidth={2.2} className="lp-result-stat-icon" />
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && (
        <em>
          {sub}
          {subN && <span className="lp-badge lp-badge-inline">{subN}</span>}
        </em>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- under the hood */

function UnderTheHood({ t }) {
  const steps = [
    [Database, 1],
    [BrainCircuit, 2],
    [Target, 3],
    [Ban, 4],
  ];
  return (
    <section className="lp-band" aria-labelledby="lp-hood">
      <Contours />
      <div className="lp-wrap">
        <SectionHead id="lp-hood" kicker={t("land.hoodKicker")} title={t("land.hoodTitle")} dark />
        <ol className="lp-pipeline">
          {steps.map(([Icon, n]) => (
            <li key={n} data-reveal>
              <span className="lp-icon lp-icon-dark"><Icon size={22} strokeWidth={2.2} /></span>
              <h3>{t(`land.hood${n}Title`)}</h3>
              <p>{t(`land.hood${n}Body`)}</p>
              {n < 4 && <ChevronRight className="lp-pipe-arrow" size={22} strokeWidth={2.4} aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- promises */

function Promises({ t, ledger }) {
  const accuracy = ledger?.accuracyPct;
  return (
    <section className="lp-section" aria-labelledby="lp-trust">
      <div className="lp-wrap">
        <SectionHead id="lp-trust" kicker={t("land.trustKicker")} title={t("land.trustTitle")} tone="mint" />
        <div className="lp-promises">
          <div className="lp-card lp-will" data-reveal>
            <h3><CheckCircle2 size={20} strokeWidth={2.2} /> {t("land.willTitle")}</h3>
            <ul>
              {[1, 2, 3, 4].map((n) => <li key={n}><CheckCircle2 size={17} strokeWidth={2.2} /> {t(`land.will${n}`)}</li>)}
            </ul>
          </div>
          <div className="lp-card lp-wont" data-reveal>
            <h3><XCircle size={20} strokeWidth={2.2} /> {t("land.wontTitle")}</h3>
            <ul>
              {[1, 2, 3, 4].map((n) => <li key={n}><XCircle size={17} strokeWidth={2.2} /> {t(`land.wont${n}`)}</li>)}
            </ul>
          </div>
          <Link to="/ledger" className="lp-ledger-card" data-reveal>
            <span className="lp-icon lp-icon-dark"><Scale size={22} strokeWidth={2.2} /></span>
            {accuracy != null && <strong className="lp-ledger-num">{accuracy}%</strong>}
            <span className="lp-ledger-label">{t("land.statLabel")}</span>
            <span className="lp-ledger-sub">{ledger?.scored ? t("land.statSub", { count: ledger.scored }) : t("land.statEmpty")}</span>
            <span className="lp-ledger-link">{t("land.ledgerLink")} <ArrowRight size={16} strokeWidth={2.4} /></span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- audiences */

function Audiences({ t }) {
  return (
    <section className="lp-section lp-section-tint" aria-labelledby="lp-for">
      <div className="lp-wrap">
        <SectionHead id="lp-for" kicker={t("land.forKicker")} title={t("land.forTitle")} />
        <div className="lp-audiences">
          <article className="lp-card lp-audience" data-reveal>
            <span className="lp-icon lp-icon-lg"><Sprout size={26} strokeWidth={2.2} /></span>
            <h3>{t("land.farmerTitle")}</h3>
            <ul>
              <li><MapPin size={17} strokeWidth={2.2} /> {t("land.farmer1")}</li>
              <li><Languages size={17} strokeWidth={2.2} /> {t("land.farmer2")}</li>
              <li><MessageCircleQuestion size={17} strokeWidth={2.2} /> {t("land.farmer3")}</li>
            </ul>
            <Link to="/map" className="btn btn-primary lp-btn-lg">
              <MapPin size={19} strokeWidth={2.2} /> {t("land.ctaCheck")}
            </Link>
          </article>
          <article className="lp-card lp-audience" data-reveal>
            <span className="lp-icon lp-icon-lg lp-icon-navy"><HardHat size={26} strokeWidth={2.2} /></span>
            <h3>{t("land.operatorTitle")}</h3>
            <ul>
              <li><Mic size={17} strokeWidth={2.2} /> {t("land.operator1")}</li>
              <li><WifiOff size={17} strokeWidth={2.2} /> {t("land.operator2")}</li>
              <li><BadgeCheck size={17} strokeWidth={2.2} /> {t("land.operator3")}</li>
            </ul>
            <Link to="/signup" className="btn lp-btn-navy lp-btn-lg">
              <HardHat size={19} strokeWidth={2.2} /> {t("land.ctaRegister")}
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- faq */

function Faq({ t }) {
  // Same checked answers the help assistant gives, so the two never disagree.
  const items = [
    [t("help.q.accuracy"), t("help.a.accuracy")],
    [t("help.q.borewell"), t("help.a.borewell")],
    [t("help.q.noestimate"), t("help.a.noestimate")],
    [t("help.q.data"), t("help.a.data")],
    [t("land.faqCost"), t("help.a.cost")],
    [t("land.faqPrivacy"), t("help.a.privacy")],
  ];
  return (
    <section className="lp-section" aria-labelledby="lp-faq">
      <div className="lp-wrap lp-wrap-narrow">
        <SectionHead id="lp-faq" kicker={t("land.faqKicker")} title={t("land.faqTitle")} />
        <div className="lp-faq" data-reveal>
          {items.map(([question, answer]) => (
            <details key={question}>
              <summary>
                <span>{question}</span>
                <ChevronDown size={20} strokeWidth={2.4} aria-hidden="true" />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- final */

function FinalCta({ t }) {
  return (
    <section className="lp-section lp-final-wrap" aria-labelledby="lp-final">
      <div className="lp-wrap">
        <div className="lp-final" data-reveal>
          <Contours />
          <h2 id="lp-final">{t("land.finalTitle")}</h2>
          <p>{t("land.finalLead")}</p>
          <div className="lp-cta lp-cta-center">
            <Link to="/map" className="btn btn-primary lp-btn-lg">
              <MapPin size={19} strokeWidth={2.2} /> {t("land.ctaCheck")}
            </Link>
            <Link to="/signin" className="btn lp-btn-outline lp-btn-lg">
              <HardHat size={19} strokeWidth={2.2} /> {t("land.ctaOperator")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
