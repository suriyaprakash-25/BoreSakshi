// LandingScreen.jsx — marketing entry (/welcome). Explains the product in three
// sections (problem → solution → accountability ledger) with two clear CTAs:
// farmers go straight to the open map; operators go to sign up / sign in.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Droplets, MapPin, HardHat, ArrowRight, TrendingDown, Coins,
  Satellite, Database, Cpu, Scale, ShieldCheck, CheckCircle2,
} from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { getLedger } from "../api.js";

export default function LandingScreen() {
  const [ledger, setLedger] = useState(null);
  useEffect(() => { getLedger().then(setLedger).catch(() => {}); }, []);

  return (
    <div className="lp">
      <AppHeader subtitle="Know before you drill" />

      <main className="lp-main op-anim">
        {/* hero */}
        <section className="lp-hero">
          <span className="lp-eyebrow"><Droplets size={15} strokeWidth={2.4} /> Groundwater intelligence for rural India</span>
          <h1 className="lp-h1">Know before you drill.</h1>
          <p className="lp-lead">
            A borewell is a ₹1.5–4 lakh bet made on guesswork. BoreSakshi turns real
            drilled outcomes into an AI prediction you can trust — success odds, depth
            and yield for any location, with our accuracy published in the open.
          </p>
          <div className="lp-cta">
            <Link to="/" className="btn btn-primary btn-lg">
              <MapPin size={19} strokeWidth={2.2} /> Check a location
            </Link>
            <Link to="/signin" className="btn btn-ghost btn-lg">
              <HardHat size={19} strokeWidth={2.2} /> I'm a rig operator
            </Link>
          </div>
          <p className="lp-cta-note">Checking a location is free and needs no account.</p>
        </section>

        {/* 1) the problem */}
        <section className="lp-section">
          <div className="lp-section-head">
            <span className="lp-kicker lp-kicker-warn">The problem</span>
            <h2>Every dry borehole costs a family a fortune</h2>
          </div>
          <div className="lp-cards">
            <Feature icon={TrendingDown} tone="warn"
              title="Drilled on guesswork"
              body="Water diviners and unverifiable survey firms decide where to drill. Nobody is held to account when the hole comes up dry." />
            <Feature icon={Coins} tone="warn"
              title="₹1.5–4 lakh per failure"
              body="A failed borewell is money a rural household often borrowed — gone in a day, with nothing to show for it." />
            <Feature icon={Database} tone="warn"
              title="The outcome vanishes"
              body="Depth, strata, yield, success or failure — the one dataset that could make prediction reliable is never recorded." />
          </div>
        </section>

        {/* 2) the solution */}
        <section className="lp-section">
          <div className="lp-section-head">
            <span className="lp-kicker">The solution</span>
            <h2>A verified-outcome network, feeding an AI engine</h2>
          </div>
          <div className="lp-cards">
            <Feature icon={HardHat}
              title="Operators log real jobs"
              body="Rig operators record each completed borewell in seconds — voice or tap — in exchange for free job reports and business tools." />
            <Feature icon={Satellite}
              title="Fused with earth data"
              body="Those verified logs combine with satellite, geology and rainfall signals — real ground truth, not just a static regional map." />
            <Feature icon={Cpu}
              title="A prediction for any point"
              body="Drop a pin and get success probability, a depth band, expected yield and a confidence level — a ₹500 check, not a ₹3 lakh gamble." />
          </div>
        </section>

        {/* 3) the accountability ledger */}
        <section className="lp-section">
          <div className="lp-section-head">
            <span className="lp-kicker lp-kicker-mint">Why trust us</span>
            <h2>The accountability ledger</h2>
          </div>
          <div className="lp-ledger">
            <div className="lp-ledger-copy">
              <p>
                Other tools predict and move on. <strong>We score every prediction
                against what was actually drilled</strong> — and publish the running
                accuracy for anyone to inspect. Hits and misses, no cherry-picking.
              </p>
              <ul className="lp-checks">
                <li><CheckCircle2 size={17} strokeWidth={2.2} /> Predicted vs. actual, matched within 5&nbsp;km</li>
                <li><CheckCircle2 size={17} strokeWidth={2.2} /> Updated live as operators log outcomes</li>
                <li><ShieldCheck size={17} strokeWidth={2.2} /> Public record — accountability, not marketing</li>
              </ul>
              <Link to="/ledger" className="btn btn-ghost">
                <Scale size={17} strokeWidth={2.2} /> See the live ledger <ArrowRight size={16} strokeWidth={2.2} />
              </Link>
            </div>
            <Link to="/ledger" className="lp-ledger-stat" aria-label="See the live accountability ledger">
              <div className="lp-stat-icon"><Scale size={22} strokeWidth={2} /></div>
              <div className="lp-stat-num">
                {ledger?.accuracyPct != null ? `${ledger.accuracyPct}%` : "—"}
              </div>
              <div className="lp-stat-label">live prediction accuracy</div>
              <div className="lp-stat-sub">
                {ledger?.scored ? `across ${ledger.scored} scored prediction${ledger.scored === 1 ? "" : "s"}` : "verified against real drills"}
              </div>
            </Link>
          </div>
        </section>

        {/* closing CTA */}
        <section className="lp-final">
          <h2>Two ways in</h2>
          <div className="lp-cta">
            <Link to="/" className="btn btn-primary btn-lg">
              <MapPin size={19} strokeWidth={2.2} /> Check a location
            </Link>
            <Link to="/signup" className="btn btn-ghost btn-lg">
              <HardHat size={19} strokeWidth={2.2} /> Register as an operator
            </Link>
          </div>
        </section>

        <footer className="lp-footer">
          BoreSakshi · a verified-outcome groundwater network · MSME Idea Hackathon 6.0
        </footer>
      </main>
    </div>
  );
}

function Feature({ icon: Icon, title, body, tone }) {
  return (
    <div className="lp-feature">
      <div className={`lp-feature-icon ${tone === "warn" ? "warn" : ""}`}>
        <Icon size={22} strokeWidth={2} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
