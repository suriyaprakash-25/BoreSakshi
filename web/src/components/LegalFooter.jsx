import { Link } from "react-router-dom";
import { useI18n } from "../i18n.jsx";

export default function LegalFooter() {
  const { t } = useI18n();
  return (
    <p className="legal-footer">
      <Link to="/privacy">{t("footer.privacy")}</Link>
      <span aria-hidden="true"> · </span>
      <Link to="/terms">{t("footer.terms")}</Link>
    </p>
  );
}
