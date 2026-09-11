import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3000);

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "http://localhost:5500";

const TEXT_MODEL =
  process.env.TEXT_MODEL || "gpt-5.6-luna";

const IMAGE_MODEL =
  process.env.IMAGE_MODEL || "gpt-image-2";

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "⚠️ OPENAI_API_KEY wurde nicht gefunden. Bitte .env prüfen."
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN
  })
);

app.use(
  express.json({
    limit: "2mb"
  })
);

app.get("/", (req, res) => {
  res.json({
    name: "AI Builder V4 Backend",
    version: "4.0.0",
    status: "online",
    endpoints: {
      health: "GET /api/health",
      chat: "POST /api/chat",
      image: "POST /api/image"
    }
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "AI Builder V4",
    model: TEXT_MODEL,
    imageModel: IMAGE_MODEL,
    time: new Date().toISOString()
  });
});

function cleanFiles(files) {
  if (!files || typeof files !== "object") {
    return {};
  }

  const result = {};

  for (const [filename, content] of Object.entries(files)) {
    if (typeof content !== "string") {
      continue;
    }

    result[String(filename).slice(0, 150)] =
      content.slice(0, 30000);
  }

  return result;
}

function buildProjectContext(files) {
  const safeFiles = cleanFiles(files);

  const names = Object.keys(safeFiles);

  if (names.length === 0) {
    return "Das Projekt enthält momentan keine Dateien.";
  }

  let output = "AKTUELLE PROJEKTDATEIEN:\n\n";

  for (const filename of names) {
    output += `--- ${filename} ---\n`;
    output += safeFiles[filename];
    output += "\n\n";
  }

  return output;
}

function getModeInstructions(mode) {
  switch (mode) {
    case "code":
      return `
Der Benutzer möchte programmieren.

Erzeuge möglichst direkt nutzbaren Code.
Wenn mehrere Dateien benötigt werden, erkläre klar,
welche Dateien erstellt oder verändert werden müssen.

Achte auf:
- vollständigen Code
- keine erfundenen Dateien
- funktionierende Imports
- verständliche Struktur
- keine unnötigen Abhängigkeiten
`;

    case "image":
      return `
Der Benutzer möchte ein Bild oder einen Bild-Prompt.

Erstelle eine klare Bildbeschreibung.
Wenn tatsächlich ein Bild über den Bild-Endpunkt erzeugt
werden soll, gib zusätzlich einen passenden imagePrompt zurück.
`;

    case "3d":
      return `
Der Benutzer möchte etwas mit 3D erstellen.

Bevorzuge browserbasierte Lösungen.
Wenn sinnvoll, darf Three.js verwendet werden.
Erkläre kurz, welche Dateien benötigt werden.
`;

    case "plan":
      return `
Der Benutzer möchte einen Plan für ein Projekt.

Strukturiere den Plan übersichtlich:
1. Ziel
2. Dateien
3. Funktionen
4. Umsetzung
5. nächste Schritte
`;

    default:
      return `
Behandle die Anfrage als normale AI-Builder-Anfrage.
Wenn Programmierung gewünscht ist, darfst du vollständigen Code liefern.
`;
  }
}

function buildSystemPrompt({
  mode,
  projectName,
  files
}) {
  return `
Du bist der KI-Kern von "AI Builder V4".

Du hilfst dem Benutzer dabei, Webseiten, Apps,
Tools und andere Softwareprojekte zu erstellen,
zu verbessern und zu reparieren.

PROJEKTNAME:
${projectName || "Unbenanntes Projekt"}

ARBEITSMODUS:
${mode || "auto"}

${getModeInstructions(mode)}

WICHTIGE REGELN:

1. Antworte auf Deutsch, sofern der Benutzer Deutsch schreibt.

2. Wenn der Benutzer nach Code fragt, liefere echten,
   vollständigen Code und keine Pseudocode-Platzhalter.

3. Wenn vorhandene Dateien übergeben wurden,
   berücksichtige diese bei Änderungen.

4. Zerstöre vorhandene Funktionen nicht ohne Grund.

5. Wenn eine Änderung mehrere Dateien betrifft,
   erwähne alle betroffenen Dateien.

6. Schreibe keine API-Schlüssel in Frontend-Code.

7. Verwende möglichst einfache Lösungen,
   die direkt in einem normalen Browser funktionieren.

8. Bei HTML/CSS/JavaScript darfst du CDN-Bibliotheken
   verwenden, wenn sie sinnvoll sind.

9. Wenn der Benutzer einen Fehler beheben möchte,
   erkläre kurz die Ursache und gib die korrigierte Lösung.

10. Erfinde keine Ergebnisse von Tools, die nicht ausgeführt wurden.

AKTUELLE DATEIEN:

${buildProjectContext(files)}
`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      mode = "auto",
      projectName = "AI Builder Projekt",
      files = {}
    } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        ok: false,
        error: "message fehlt"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY ist nicht konfiguriert."
      });
    }

    const systemPrompt = buildSystemPrompt({
      mode,
      projectName,
      files
    });

    const response = await openai.responses.create({
      model: TEXT_MODEL,
      instructions: systemPrompt,
      input: message
    });

    const reply =
      response.output_text ||
      "Die KI hat keine Textantwort zurückgegeben.";

    res.json({
      ok: true,
      reply,
      model: TEXT_MODEL,
      mode
    });
  } catch (error) {
    console.error("CHAT ERROR:", error);

    res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Beim Verarbeiten der Anfrage ist ein Fehler aufgetreten."
    });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    const {
      prompt,
      size = "1024x1024"
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        ok: false,
        error: "prompt fehlt"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY ist nicht konfiguriert."
      });
    }

    const result = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size
    });

    const image =
      result?.data?.[0]?.b64_json ||
      null;

    if (!image) {
      return res.status(500).json({
        ok: false,
        error: "Die Bild-KI hat kein Bild zurückgegeben."
      });
    }

    res.json({
      ok: true,
      image: `data:image/png;base64,${image}`,
      model: IMAGE_MODEL
    });
  } catch (error) {
    console.error("IMAGE ERROR:", error);

    res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Beim Erstellen des Bildes ist ein Fehler aufgetreten."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "API-Endpunkt nicht gefunden"
  });
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    ok: false,
    error: "Interner Serverfehler"
  });
});

app.listen(PORT, () => {
  console.log("");
  console.log("======================================");
  console.log("       AI BUILDER V4 BACKEND");
  console.log("======================================");
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Text:   ${TEXT_MODEL}`);
  console.log(`Image:  ${IMAGE_MODEL}`);
  console.log("======================================");
  console.log("");
});
