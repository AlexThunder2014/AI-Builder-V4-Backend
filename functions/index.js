import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import OpenAI from "openai";

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

const REGION = "europe-west1";

const TEXT_MODEL = "gpt-5.6-luna";
const IMAGE_MODEL = "gpt-image-2";

function corsHeaders(req, res) {
  const origin = req.headers.origin;

  res.set("Access-Control-Allow-Origin", origin || "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

function handleOptions(req, res) {
  corsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }

  return false;
}

function cleanFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.slice(0, 20).map((file) => ({
    name: String(file?.name || "").slice(0, 200),
    content: String(file?.content || "").slice(0, 12000)
  }));
}

function buildProjectContext(files) {
  const safeFiles = cleanFiles(files);

  if (safeFiles.length === 0) {
    return "Es wurden keine Projektdateien übergeben.";
  }

  return safeFiles
    .map(
      (file) =>
        `--- DATEI: ${file.name} ---\n${file.content}\n--- ENDE DATEI ---`
    )
    .join("\n\n");
}

function buildInstructions(files) {
  return `
Du bist der KI-Programmierassistent von AI Builder V4.

Du hilfst beim Programmieren, Erklären, Verbessern und Planen von Webseiten
und Softwareprojekten.

Antworte auf Deutsch, sofern der Nutzer Deutsch schreibt.

Wenn der Nutzer Code möchte:
- Gib vollständigen, funktionierenden Code aus.
- Verwende keine Platzhalter wie "...".
- Erkläre kurz, was geändert wurde.
- Wenn sinnvoll, nenne den Dateinamen.

Wenn bestehender Code übergeben wurde:
- Analysiere zuerst den vorhandenen Code.
- Ändere nur das, was notwendig ist.
- Versuche bestehende Funktionen zu erhalten.

Projektdateien:
${buildProjectContext(files)}
`;
}

function extractText(response) {
  if (!response) {
    return "";
  }

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  if (Array.isArray(response.output)) {
    const parts = [];

    for (const item of response.output) {
      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (typeof content.text === "string") {
          parts.push(content.text);
        }
      }
    }

    return parts.join("\n");
  }

  return "";
}

export const api = onRequest(
  {
    region: REGION,
    secrets: [OPENAI_API_KEY],
    maxInstances: 10,
    invoker: "public"
  },
  async (req, res) => {
    if (handleOptions(req, res)) {
      return;
    }

    corsHeaders(req, res);

    res.status(404).json({
      ok: false,
      error: "API-Endpunkt nicht gefunden."
    });
  }
);

export const health = onRequest(
  {
    region: REGION,
    secrets: [OPENAI_API_KEY],
    maxInstances: 10,
    invoker: "public"
  },
  async (req, res) => {
    if (handleOptions(req, res)) {
      return;
    }

    corsHeaders(req, res);

    res.json({
      ok: true,
      service: "AI Builder V4 Backend",
      region: REGION,
      message: "Backend läuft."
    });
  }
);

export const chat = onRequest(
  {
    region: REGION,
    secrets: [OPENAI_API_KEY],
    maxInstances: 10,
    invoker: "public"
  },
  async (req, res) => {
    if (handleOptions(req, res)) {
      return;
    }

    corsHeaders(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({
          ok: false,
          error: "Nur POST wird unterstützt."
        });
      }

      const body = req.body || {};

      const message = String(body.message || "").trim();
      const files = body.files || [];
      const mode = String(body.mode || "auto");

      if (!message) {
        return res.status(400).json({
          ok: false,
          error: "Keine Nachricht übergeben."
        });
      }

      const client = new OpenAI({
        apiKey: OPENAI_API_KEY.value()
      });

      const instructions = buildInstructions(files);

      const response = await client.responses.create({
        model: TEXT_MODEL,
        instructions,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Modus: ${mode}\n\nNutzeranfrage:\n${message}`
              }
            ]
          }
        ]
      });

      const reply = extractText(response);

      return res.json({
        ok: true,
        reply: reply || "Ich konnte keine Antwort erzeugen."
      });
    } catch (error) {
      console.error("Chat-Fehler:", error);

      return res.status(500).json({
        ok: false,
        error: "Beim Verarbeiten der Anfrage ist ein Fehler aufgetreten."
      });
    }
  }
);

export const image = onRequest(
  {
    region: REGION,
    secrets: [OPENAI_API_KEY],
    maxInstances: 5,
    invoker: "public"
  },
  async (req, res) => {
    if (handleOptions(req, res)) {
      return;
    }

    corsHeaders(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({
          ok: false,
          error: "Nur POST wird unterstützt."
        });
      }

      const body = req.body || {};
      const prompt = String(body.prompt || "").trim();

      if (!prompt) {
        return res.status(400).json({
          ok: false,
          error: "Kein Bild-Prompt übergeben."
        });
      }

      const client = new OpenAI({
        apiKey: OPENAI_API_KEY.value()
      });

      const result = await client.images.generate({
        model: IMAGE_MODEL,
        prompt
      });

      const imageData = result?.data?.[0];

      if (!imageData) {
        return res.status(500).json({
          ok: false,
          error: "Das Bild konnte nicht erzeugt werden."
        });
      }

      return res.json({
        ok: true,
        imageUrl: imageData.url || null,
        image: imageData.b64_json || null
      });
    } catch (error) {
      console.error("Bild-Fehler:", error);

      return res.status(500).json({
        ok: false,
        error: "Beim Erzeugen des Bildes ist ein Fehler aufgetreten."
      });
    }
  }
);
