// LandingScreen.jsx — marketing entry (/). Explains the product in three
// sections (problem → solution → accountability ledger) with two clear CTAs:
// farmers go straight to the open map; operators go to sign up / sign in.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Droplets, MapPin, HardHat, ArrowRight, TrendingDown, Coins,
  Search, Database, Scale, ShieldCheck, CheckCircle2,
} from "lucide-react";
import AppHeader from "../components/AppHeader.jsx";
import { getLedger } from "../api.js";
import { useI18n } from "../i18n.jsx";
import LegalFooter from "../components/LegalFooter.jsx";

export default function LandingScreen() {
  const { t } = useI18n();
  const [ledger, setLedger] = useState(null);
  useEffect(() => { getLedger().then(setLedger).catch(() => { }); }, []);

  return (
    <div className="lp">
      <AppHeader subtitle={t("brand.tagline")} />

      <main className="lp-main op-anim">
        {/* hero */}
        <section className="lp-hero-split">
          <div className="lp-hero-text">
            <div className="lp-cta">
              <Link to="/map" className="btn btn-primary btn-lg">
                <MapPin size={19} strokeWidth={2.2} /> {t("land.ctaCheck")}
              </Link>
              <Link to="/signin" className="btn btn-ghost btn-lg">
                <HardHat size={19} strokeWidth={2.2} /> {t("land.ctaOperator")}
              </Link>
            </div>
            <p className="lp-cta-note">{t("land.note")}</p>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-orb lp-orb-1"></div>
            <div className="lp-orb lp-orb-2"></div>
          </div>
        </section>

        {/* 1) the problem */}
        <section className="lp-section">
          <div className="lp-section-head">
            <span className="lp-kicker lp-kicker-warn">{t("land.problemKicker")}</span>
            <h2>{t("land.problemTitle")}</h2>
          </div>
          <div className="lp-bento">
            <Feature icon={TrendingDown} tone="warn" isLarge title={t("land.p1Title")} body={t("land.p1Body")} />
            <Feature icon={Coins} tone="warn" title={t("land.p2Title")} body={t("land.p2Body")} />
            <Feature icon={Database} tone="warn" title={t("land.p3Title")} body={t("land.p3Body")} />
          </div>
        </section>

        {/* 2) the solution */}
        <section className="lp-section">
          <div className="lp-section-head">
            <span className="lp-kicker">{t("land.solutionKicker")}</span>
            <h2>{t("land.solutionTitle")}</h2>
          </div>
          <div className="lp-bento">
            <Feature icon={Search} isLarge title={t("land.s1Title")} body={t("land.s1Body")} />
            <Feature icon={HardHat} title={t("land.s2Title")} body={t("land.s2Body")} />
            <Feature icon={ShieldCheck} title={t("land.s3Title")} body={t("land.s3Body")} />
          </div>
        </section>

        {/* 3) the accountability ledger */}
        <section className="lp-section">
          <div className="lp-section-head">
            <span className="lp-kicker lp-kicker-mint">{t("land.trustKicker")}</span>
            <h2>{t("land.trustTitle")}</h2>
          </div>
          <div className="lp-ledger">
            <div className="lp-ledger-copy">
              <p>{t("land.trustIntro")}</p>
              <ul className="lp-checks">
                <li><CheckCircle2 size={17} strokeWidth={2.2} /> {t("land.check1")}</li>
                <li><CheckCircle2 size={17} strokeWidth={2.2} /> {t("land.check2")}</li>
                <li><ShieldCheck size={17} strokeWidth={2.2} /> {t("land.check3")}</li>
              </ul>
              <Link to="/ledger" className="btn btn-ghost">
                <Scale size={17} strokeWidth={2.2} /> {t("land.ledgerLink")} <ArrowRight size={16} strokeWidth={2.2} />
              </Link>
            </div>
            <Link to="/ledger" className="lp-ledger-stat" aria-label={t("land.ledgerLink")}>
              <div className="lp-stat-icon"><Scale size={22} strokeWidth={2} /></div>
              <div className="lp-stat-num">
                {ledger?.accuracyPct != null ? `${ledger.accuracyPct}%` : "—"}
              </div>
              <div className="lp-stat-label">{t("land.statLabel")}</div>
              <div className="lp-stat-sub">
                {ledger?.scored ? t("land.statSub", { count: ledger.scored }) : t("land.statEmpty")}
              </div>
            </Link>
          </div>
        </section>

        {/* closing CTA */}
        <section className="lp-final">
          <h2>{t("land.finalTitle")}</h2>
          <div className="lp-cta">
            <Link to="/map" className="btn btn-primary btn-lg">
              <MapPin size={19} strokeWidth={2.2} /> {t("land.ctaCheck")}
            </Link>
            <Link to="/signup" className="btn btn-ghost btn-lg">
              <HardHat size={19} strokeWidth={2.2} /> {t("land.ctaRegister")}
            </Link>
          </div>
        </section>

        <footer className="lp-footer">
          BoreSakshi · MSME Idea Hackathon 6.0
          <LegalFooter />
        </footer>
      </main>
    </div>
  );
}

function Feature({ icon: Icon, title, body, tone, isLarge }) {
  return (
    <div className={`lp-feature ${isLarge ? 'bento-large' : ''}`}>
      <div className={`lp-feature-icon ${tone === "warn" ? "warn" : ""}`}>
        <Icon size={26} strokeWidth={2.5} />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}
