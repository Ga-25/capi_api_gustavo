// server.js (ESM) - cole e rode no Render
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(cors()); // em produção restrinja o origin
app.use(express.json());

// variáveis (defina no Render)
const PIXEL_ID = process.env.PIXEL_ID;                      // primary
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;              // primary token
const BACKUP_PIXEL_ID = process.env.BACKUP_PIXEL_ID || "";  // opcional
const BACKUP_ACCESS_TOKEN = process.env.BACKUP_ACCESS_TOKEN || ""; // opcional
const API_VERSION = process.env.API_VERSION || "v19.0";
const TEST_EVENT_CODE = process.env.TEST_EVENT_CODE || null; // opcional

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sendToPixel(pixelId, token, payload) {
  if (!pixelId || !token) return { skipped: true, reason: "missing_pixel_or_token" };
  const url = `https://graph.facebook.com/${API_VERSION}/${pixelId}/events?access_token=${token}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await resp.json();
  return json;
}

app.post("/event", async (req, res) => {
  try {
    const { event_name = "CustomEvent", event_id, event_source_url = "", user = {}, custom_data = {} } = req.body;

    // NÃO envie PageView do servidor por padrão (evita alerta de "PageView não desduplicado")
    if (event_name && event_name.toLowerCase() === "pageview") {
      return res.json({ ok: true, skipped: "server_pageview_skipped" });
    }

    // montar user_data com hash (conforme exigência do Meta)
    const user_data = {};
    if (user.email) user_data.em = sha256(String(user.email).trim().toLowerCase());
    if (user.phone) user_data.ph = sha256(String(user.phone).replace(/\D/g, ""));
    if (user.name)  user_data.fn = sha256(String(user.name).trim().toLowerCase());
    if (user.fbp) user_data.fbp = user.fbp;
    if (user.fbc) user_data.fbc = user.fbc;

    user_data.client_user_agent = req.headers["user-agent"] || "";
    user_data.client_ip_address = req.headers["x-forwarded-for"]
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : req.socket.remoteAddress;

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: event_id || `srv_${Date.now()}`,
          event_source_url,
          action_source: "website",
          user_data,
          custom_data
        }
      ]
    };

    if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

    // envia para pixel primário
    const primaryResp = await sendToPixel(PIXEL_ID, ACCESS_TOKEN, payload);

    // envia para pixel backup (opcional)
    let backupResp = null;
    if (BACKUP_PIXEL_ID && BACKUP_ACCESS_TOKEN) {
      backupResp = await sendToPixel(BACKUP_PIXEL_ID, BACKUP_ACCESS_TOKEN, payload);
    }

    // resposta para debug
    return res.json({ ok: true, primary: primaryResp, backup: backupResp });
  } catch (err) {
    console.error("Erro CAPI:", err);
    return res.status(500).json({ error: "Erro ao enviar evento para CAPI", details: String(err) });
  }
});

app.get("/", (req, res) => res.send("CAPI running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API rodando na porta ${PORT}`));