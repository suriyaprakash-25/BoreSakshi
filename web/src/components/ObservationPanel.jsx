import { useEffect, useState } from "react";
import { Droplets, Loader2, Plus, Waves, Wrench } from "lucide-react";
import toast from "react-hot-toast";
import { addBorewellObservation, getBorewellObservations } from "../api.js";
import { fmtDate } from "../metrics.js";

const TYPES = {
  WATER_LEVEL: { label: "Water level", icon: Droplets, field: "waterLevelFt", placeholder: "Depth to water (ft)" },
  YIELD: { label: "Yield", icon: Waves, field: "yieldLpm", placeholder: "Measured yield (LPM)" },
  MAINTENANCE: { label: "Maintenance", icon: Wrench, field: null, placeholder: "" },
};

export default function ObservationPanel({ borewellId }) {
  const [observations, setObservations] = useState([]);
  const [type, setType] = useState("WATER_LEVEL");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getBorewellObservations(borewellId)
      .then((items) => { if (active) setObservations(items); })
      .catch((error) => { if (active) toast.error(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [borewellId]);

  const selected = TYPES[type];

  async function submit(event) {
    event.preventDefault();
    const numeric = selected.field ? Number(value) : null;
    if (selected.field && (!value || !Number.isFinite(numeric) || numeric < 0)) {
      toast.error("Enter a valid measurement.");
      return;
    }
    if (!selected.field && !note.trim()) {
      toast.error("Enter a maintenance note.");
      return;
    }

    const payload = { type, note: note.trim() };
    if (selected.field) payload[selected.field] = numeric;

    setSaving(true);
    try {
      const created = await addBorewellObservation(borewellId, payload);
      setObservations((items) => [created, ...items]);
      setValue("");
      setNote("");
      toast.success("Observation added");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="observation-panel">
      <h3>Follow-up observations</h3>
      {loading ? (
        <div className="observation-loading"><Loader2 className="spin" size={16} /> Loading observations…</div>
      ) : (
        <ul className="observation-list">
          {observations.map((item) => (
            <li key={item.id}>
              <strong>{item.type.replace("_", " ")}</strong>
              <span>{fmtDate(item.observedAt)}</span>
              {item.waterLevelFt != null && <span>{item.waterLevelFt} ft water level</span>}
              {item.yieldLpm != null && <span>{item.yieldLpm} LPM</span>}
              {item.note && <span>{item.note}</span>}
            </li>
          ))}
        </ul>
      )}

      <form className="observation-form" onSubmit={submit}>
        <select className="op-input" value={type} onChange={(e) => { setType(e.target.value); setValue(""); }}>
          {Object.entries(TYPES).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
        </select>
        {selected.field && (
          <input
            className="op-input"
            type="number"
            min="0"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={selected.placeholder}
          />
        )}
        <input
          className="op-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={type === "MAINTENANCE" ? "Maintenance note" : "Optional note"}
        />
        <button className="btn btn-ghost btn-sm" disabled={saving}>
          <Plus size={14} strokeWidth={2.2} /> {saving ? "Saving…" : "Add"}
        </button>
      </form>
    </section>
  );
}
