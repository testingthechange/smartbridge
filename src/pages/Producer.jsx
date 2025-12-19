import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

function pad5(n) {
  return String(n).padStart(5, "0");
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

export default function Producer() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    date: "",
  });

  const [producers, setProducers] = useState([]);

  const existingIds = useMemo(
    () => new Set(producers.map((p) => p.producerId)),
    [producers]
  );

  const canCreate =
    form.name.trim() && form.company.trim() && form.email.trim();

  const handleCreate = () => {
    if (!canCreate) return;

    const producerId = newProducerId(existingIds);

    const row = {
      producerId,
      name: form.name.trim(),
      company: form.company.trim(),
      email: form.email.trim(),
      date: form.date || "",
      createdAt: new Date().toISOString(),
    };

    setProducers((prev) => [row, ...prev]);

    setForm({
      name: "",
      company: "",
      email: "",
      date: "",
    });
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>
          Producer
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Create producer entries. Click an ID to open Projects.
        </div>
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
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Create Producer
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          <label style={{ fontSize: 12 }}>
            Name
            <input
              value={form.name}
              onChange={(e) =>
                setForm((p) => ({ ...p, name: e.target.value }))
              }
              style={inputStyle()}
              placeholder="Producer name"
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Company
            <input
              value={form.company}
              onChange={(e) =>
                setForm((p) => ({ ...p, company: e.target.value }))
              }
              style={inputStyle()}
              placeholder="Company"
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Email
            <input
              value={form.email}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
              style={inputStyle()}
              placeholder="name@company.com"
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) =>
                setForm((p) => ({ ...p, date: e.target.value }))
              }
              style={inputStyle()}
            />
          </label>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={primaryBtn(!canCreate)}
          >
            Create Producer
          </button>

          <div style={{ fontSize: 12, opacity: 0.65, alignSelf: "center" }}>
            (UI only — persistence comes later)
          </div>
        </div>
      </div>

      {/* PRODUCER LIST */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          Producers
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div style={tableHeader()}>
            <div>ID</div>
            <div>Name</div>
            <div>Company</div>
            <div>Email</div>
            <div>Date</div>
          </div>

          {producers.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, opacity: 0.7 }}>
              No producers yet.
            </div>
          ) : (
            producers.map((p) => (
              <div key={p.producerId} style={tableRow()}>
                <button
                  type="button"
                  onClick={() =>
                    // ✅ FIX: go to producer-scoped Projects page
                    navigate(`/producer/${encodeURIComponent(p.producerId)}/projects`)
                  }
                  style={idBtn()}
                >
                  {p.producerId}
                </button>
                <div>{p.name}</div>
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
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
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

function idBtn() {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 12,
  };
}
