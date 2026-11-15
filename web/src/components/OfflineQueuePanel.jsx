import { Trash2, UploadCloud } from "lucide-react";
import { useI18n } from "../i18n.jsx";
import { useOperatorData } from "../operatorData.jsx";

export default function OfflineQueuePanel() {
  const { t } = useI18n();
  const { queued, syncing, syncStop, syncQueue, discardQueued } = useOperatorData();
  if (!queued.length) return null;

  function discard(localId) {
    if (window.confirm(t("queue.discardConfirm"))) discardQueued(localId);
  }

  return (
    <div className="op-ledger-note offline-queue">
      <div className="offline-queue-head">
        <strong>{t("queue.title", { count: queued.length })}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={syncQueue} disabled={syncing}>
          <UploadCloud size={15} /> {t(syncing ? "queue.sending" : "queue.send")}
        </button>
      </div>
      {syncStop === "signin" && <p>{t("queue.signIn")}</p>}
      {syncStop === "offline" && <p>{t("queue.offline")}</p>}
      <ul>
        {queued.map((entry) => (
          <li key={entry.localId}>
            <span>{entry.payload.placeName || entry.payload.drillingDate} · {entry.payload.depthFt} ft</span>
            {entry.lastError && <span className="op-error">{entry.lastError}</span>}
            <button type="button" className="op-mic" title={t("queue.discard")} onClick={() => discard(entry.localId)}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
