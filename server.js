// Filmabend — schlanker statischer Server ohne Abhängigkeiten.
// Liefert vorkomprimierte JSON (gzip) direkt aus, WebP-Poster-Sheets,
// und die App selbst. Kein Datenbank-Addon nötig -> minimale Railway-Kosten.
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const STATE_DIR = process.env.STATE_DIR || path.join(ROOT, "user-state");
const PORT = process.env.PORT || 8080;
fs.mkdirSync(STATE_DIR, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
};

// index.html einmal einlesen (klein, ändert sich nicht zur Laufzeit)
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"));

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(PUB, safe);
  if (!full.startsWith(PUB)) return send(res, 403, "forbidden");

  const isGz = full.endsWith(".json.gz");
  const tryPath = full;
  fs.stat(tryPath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "not found");
    const ext = isGz ? ".json" : path.extname(full);
    const headers = {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (isGz) headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers);
    fs.createReadStream(tryPath).pipe(res);
  });
}

// --- winzige, dateibasierte Speicherung des Geschmacksprofils pro Gerät/Browser ---
// Kein Postgres-Addon nötig -> hält die Railway-Kosten minimal. Reicht locker für
// persönliche Nutzung; echte Accounts (Login, Freunde) sind der nächste Ausbauschritt.
function parseCookies(req) {
  const h = req.headers.cookie || "";
  const out = {};
  h.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function uidFromReq(req, res) {
  const cookies = parseCookies(req);
  let uid = cookies.fa_uid;
  if (!uid || !/^[a-f0-9]{32}$/.test(uid)) {
    uid = crypto.randomBytes(16).toString("hex");
    res.setHeader(
      "Set-Cookie",
      `fa_uid=${uid}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`
    );
  }
  return uid;
}
function readBody(req, maxBytes, cb) {
  let data = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > maxBytes) {
      req.destroy();
      return;
    }
    data.push(c);
  });
  req.on("end", () => cb(Buffer.concat(data)));
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);

  if (url === "/api/state" && req.method === "GET") {
    const uid = uidFromReq(req, res);
    const file = path.join(STATE_DIR, uid + ".json");
    fs.readFile(file, (err, buf) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (err) return res.end("null");
      res.end(buf);
    });
    return;
  }
  if (url === "/api/state" && req.method === "POST") {
    const uid = uidFromReq(req, res);
    readBody(req, 2 * 1024 * 1024, (buf) => {
      try {
        JSON.parse(buf.toString("utf8")); // validieren
        fs.writeFile(path.join(STATE_DIR, uid + ".json"), buf, () => {
          res.setHeader("Content-Type", "application/json");
          res.end('{"ok":true}');
        });
      } catch (e) {
        send(res, 400, '{"ok":false}', { "Content-Type": "application/json" });
      }
    });
    return;
  }

  if (url === "/" || url === "/index.html") {
    // gzip on the fly for the (small) HTML if the client accepts it
    const ae = req.headers["accept-encoding"] || "";
    if (ae.includes("gzip")) {
      zlib.gzip(INDEX, (e, gz) => {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Encoding": "gzip",
          "Cache-Control": "no-cache",
        });
        res.end(gz);
      });
    } else {
      send(res, 200, INDEX, { "Content-Type": "text/html; charset=utf-8" });
    }
    return;
  }

  if (url === "/health") return send(res, 200, "ok");

  if (url.startsWith("/data/") || url.startsWith("/sheets/")) {
    return serveStatic(req, res, url);
  }

  send(res, 404, "not found");
});

server.listen(PORT, () => console.log("Filmabend server on :" + PORT));
