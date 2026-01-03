// src/minisite/Producer.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Persistence keys
 * - sb:producers = array of producers
 * - sb:demoProducerId = producerId of the permanent demo row
 */
const LS_PRODUCERS = "sb:producers";
const LS_DEMO_ID = "sb:demoProducerId";

function pad5(n) {
  return String(n).padStart(5, "0");
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadProducers() {
  const raw = localStorage.getItem(LS_PRODUCERS);
  const parsed = raw ? safeParse(raw) : null;
  return Array.isArray(parsed) ? parsed : [];
}

function saveProducers(list) {
  localStorage.setItem(LS_PRODUCERS, JSON.stringify(Array.isArray(list) ? list : []));
}

function loadDemoProducerId() {
  try {
    return String(localStorage.getItem(LS_DEMO_ID) || "").trim();
  } catch {
    return "";
  }
}

function saveDemoProducerId(id) {
  try {
    localStorage.setItem(LS_DEMO_ID, String(id || ""));
  } catch {}
}

function newProducerId(existingIds) {
  let tries = 0;
  while (tries < 2000) {
    const id = pad5(Math.floor(10000 + Math.random() * 90000));
    if (!existingIds.has(id)) return id;
    tries++;
  }
  return pad5(Date.now() % 100000);
}

function normalizeProducer(p) {
  return {
    producerId: String(p?.producerId || "").trim(),
    name: String(p?.name || "").trim(),
    company: String(p?.company || "").trim(),
    email: String(p?.email || "").trim(),
    date: String(p?.date || "").trim(),
    createdAt: String(p?.createdAt || "").trim(),
    isDemo: !!p?.isDemo,
  };
}

export default function Producer() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    date: "",
  });

  const [producers, setProducers] = useState(() => loadProducers().map(normalizeProducer));
  const [demoProducerId, setDemoProducerId] = useState(() => loadDemoProducerId());

  // persist producers
  useEffect(() => {
    saveProducers(producers);
  }, [producers]);

  // ensure a demo producer exists (permanent)
  useEffect(() => {
    // if we already have a demo id and it exists, keep it
    const existing = producers.find((p) => p.producerId === demoProducerId);
    if (demoProducerId && existing) return;

    // otherwise try to find any row flagged demo
    const foundDemo = producers.find((p) => p.isDemo);
    if (foundDemo?.producerId) {
      setDemoProducerId(foundDemo.producerId);
      saveDemoProducerId(foundDemo.producerId);
      return;
    }

    // otherwise create one
    const existingIds = new Set(producers.map((p) => p.producerId));
    const id = newProducerId(existingIds);

    const demoRow = normalizeProducer({
      producerId: id,
      name: "Demo Producer",
      company: "Smart Bridge",
      email: "demo@smartbridge.local",
      date: "",
      createdAt: new Date().toISOString(),
      isDemo: true,
    });

    setProducers((prev) => [demoRow, ...prev]);
    setDemoProducerId(id);
    saveDemoProducerId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingIds = useMemo(() => new Set(producers.map((p) => p.producerId)), [producers]);

  const canCreate = form.name.trim() && form.company.trim() && form.email.trim();

  const handleCreate = () => {
    if (!canCreate) return;

    const producerId = newProducerId(existingIds);

    const row = normalizeProducer({
      producerId,
      name: form.name,
      company: form.company,
      email: form.email,
      date: form.date || "",
      createdAt: new Date().toISOString(),
      isDemo: false,
    });

    setProducers((prev) => [row, ...prev]);

    setForm({
      name: "",
      company: "",
      email: "",
      date: "",
    });
  };

  const goProjects = (producerId) => {
    navigate(`/producer/${encodeURIComponent(producerId)}/projects`);
  };

  const demoRow = producers.find((p) => p.producerId === demoProducerId);

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Producer</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Create producer entries. Click an ID to open Projects. Demo Producer is persistent.
        </div>
      </div>

      {/* DEMO SHORTCUT */}
      <div
        style={{
          marginBottom: 14,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 14,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8, textTransform: "uppercase" }}>Demo</div>
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 900, color: "#0f172a" }}>
            {demoRow ? (
              <>
                {demoRow.name} <span style={{ opacity: 0.6 }}>·</span>{" "}
                <span style={{ fontFamily: "monospace" }}>{demoRow.producerId}</span>
              </>
            ) : (
              <span style={{ opacity: 0.7 }}>Creating…</span>
            )}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
            Use this to create all test projects so you don&apos;t lose track of projectIds.
          </div>
        </div>

        <button
          type="button"
          onClick={() => demoProducerId && goProjects(demoProducerId)}
          disabled={!demoProducerId}
          style={primaryBtn(!demoProducerId)}
        >
          Open Demo Projects
        </button>
      </div>

      {/* CREATE FORM */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Create Producer</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <label style={{ fontSize: 12 }}>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              style={inputStyle()}
              placeholder="Producer name"
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Company
            <input
              value={form.company}
              onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))}
              style={inputStyle()}
              placeholder="Company"
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Email
            <input
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              style={inputStyle()}
              placeholder="name@company.com"
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              style={inputStyle()}
            />
          </label>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
          <button type="button" onClick={handleCreate} disabled={!canCreate} style={primaryBtn(!canCreate)}>
            Create Producer
          </button>

          <div style={{ fontSize: 12, opacity: 0.65, alignSelf: "center" }}>
            (Saved to localStorage for now)
          </div>
        </div>
      </div>

      {/* PRODUCER LIST */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Producers</div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <div style={tableHeader()}>
            <div>ID</div>
            <div>Name</div>
            <div>Company</div>
            <div>Email</div>
            <div>Date</div>
          </div>

          {producers.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, opacity: 0.7 }}>No producers yet.</div>
          ) : (
            producers.map((p) => (
              <div key={p.producerId} style={tableRow()}>
                <button type="button" onClick={() => goProjects(p.producerId)} style={idBtn(p.isDemo)}>
                  {p.producerId}
                </button>
                <div style={{ fontWeight: p.isDemo ? 900 : 600 }}>{p.name}</div>
                <div>{p.company}</div>
                <div>{p.email}</div>
                <div>{p.date || "—"}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- styles ---------- */

function inputStyle() {
  return {
    width: "100%",
    marginTop: 6,
    padding: "10px 10px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 13,
  };
}

function primaryBtn(disabled) {
  return {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #111827",
    background: disabled ? "#e5e7eb" : "#111827",
    color: disabled ? "#6b7280" : "#f9fafb",
    fontSize: 13,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  };
}

function tableHeader() {
  return {
    display: "grid",
    gridTemplateColumns: "120px 1.2fr 1.2fr 1.6fr 140px",
    gap: 10,
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 800,
    color: "#6b7280",
    background: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
  };
}

function tableRow() {
  return {
    display: "grid",
    gridTemplateColumns: "120px 1.2fr 1.2fr 1.6fr 140px",
    gap: 10,
    padding: "12px",
    fontSize: 13,
    borderBottom: "1px solid #f3f4f6",
    alignItems: "center",
  };
}

function idBtn(isDemo) {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: isDemo ? "rgba(16,185,129,0.10)" : "#fff",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 12,
  };
}
