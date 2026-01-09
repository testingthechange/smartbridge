≈// server/index.js (or wherever you mount routes)
import publishMiniSite from "./routes/publishMiniSite.js";

app.use("/api", express.json({ limit: "10mb" }));
app.use("/api", publishMiniSite);
