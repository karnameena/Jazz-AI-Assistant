// On-demand real document creation, isolated from the legacy Jazz actions.
// Artifacts live temporarily in memory and are accessed with unguessable IDs.
import crypto from "node:crypto";
import fs from "node:fs";

const STORE = new Map();
const MAX_ARTIFACTS = 12;
const TTL_MS = 20 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 7 * 1024 * 1024;

export function detectArtifactIntent(raw) {
  const message = String(raw || "").trim();
  if (!/^(?:(?:hey\s+jazz[,!]?\s*)|(?:please\s+))*\b(?:create|generate|make|prepare|write|export|build)\b/i.test(message)) return null;
  const scope = message.slice(0, 170);
  if (/\b(?:pdf)\b/i.test(scope)) return "pdf";
  if (/\b(?:word|docx)\b/i.test(scope)) return "docx";
  if (/\b(?:excel|xlsx|spreadsheet)\b/i.test(scope)) return "xlsx";
  return null;
}

function documentTitle(request) {
  const named = String(request).match(/\b(?:titled|named|title\s*:)\s*["']?([^"'\n.]{3,75})/i);
  if (named) return named[1].trim();
  const item = String(request).replace(/^(?:hey\s+jazz[,!]?\s*)?(?:please\s+)?(?:create|generate|make|prepare|write|export|build)\s+(?:me\s+)?(?:an?\s+)?/i, "")
    .replace(/\b(?:in|as)\s+(?:a\s+)?(?:PDF|Word|Excel|DOCX|XLSX)\b/ig, "").trim();
  return item.slice(0, 76) || "Jazz Document";
}

function cleanup() {
  const now = Date.now();
  for (const [id, item] of STORE) if (item.expiresAt <= now) STORE.delete(id);
  while (STORE.size >= MAX_ARTIFACTS) STORE.delete(STORE.keys().next().value);
}

function safeFilename(request, kind) {
  const base = documentTitle(request).toLowerCase()
    .replace(/[^a-z0-9 ]+/g,"").trim().replace(/\s+/g,"-").slice(0, 65);
  return (base || "jazz-document") + "." + kind;
}

function storeArtifact(request, kind, buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ARTIFACT_BYTES)
    throw new Error("Document generation returned an empty or oversized file.");
  cleanup();
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + TTL_MS;
  STORE.set(id, {filename: safeFilename(request, kind), buffer, mime, expiresAt});
  return {kind, filename: STORE.get(id).filename, url: "/api/artifacts/" + id, bytes: buffer.length,
    expiresAt: new Date(expiresAt).toISOString()};
}

export function getArtifact(id) {
  cleanup();
  return /^[0-9a-f-]{36}$/.test(String(id || "")) ? STORE.get(id) || null : null;
}

function getFontCandidate() {
  const candidates = [process.env.JAZZ_DOCUMENT_FONT_PATH, "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/Nirmala.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

async function renderPdf(title, content) {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({size:"A4", margin: 54, bufferPages: true, info: {Title:title, Creator:"Jazz AI Assistant"}});
  const chunks = [];
  const completed = new Promise((resolve,reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const font = getFontCandidate();
  if (font) doc.font(font);
  doc.fontSize(20).fillColor("#203454").text(title, {align:"left"});
  doc.moveDown(0.7);
  doc.fontSize(10).fillColor("#65748a").text("Prepared with Jazz AI Assistant");
  doc.moveDown(1);
  const lines = String(content).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {doc.moveDown(0.5);continue;}
    if (/^#{1,3}\s+/.test(line)) {
      doc.moveDown(0.4).fillColor("#23476d").fontSize(14).text(line.replace(/^#+\s*/,""));
      doc.moveDown(0.2);
    } else {
      doc.fillColor("#26394d").fontSize(10.5).text(line.replace(/\*\*/g,""), {lineGap: 3});
    }
  }
  const pageCount = doc.bufferedPageRange().count;
  for (let page = 0; page < pageCount; page++) {
    doc.switchToPage(page);
    doc.fontSize(9).fillColor("#738096").text("Jazz AI Assistant  •  Page " + (page + 1) + " of " + pageCount,
      54, 790, {width:486, align:"center", lineBreak:false});
  }
  doc.end();
  return completed;
}

async function renderDocx(title, content) {
  const {Document, Packer, Paragraph, TextRun, HeadingLevel} = await import("docx");
  const children = [new Paragraph({text:title, heading: HeadingLevel.TITLE, spacing:{after:280}})];
  for (const raw of String(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,3}\s+/.test(line))
      children.push(new Paragraph({text:line.replace(/^#+\s*/,""),heading:HeadingLevel.HEADING_2,spacing:{before:240,after:100}}));
    else children.push(new Paragraph({children:[new TextRun({text:line.replace(/\*\*/g,""),size:22})],
      spacing:{after:line?130:60}}));
  }
  const doc = new Document({creator:"Jazz AI Assistant",title,sections:[{properties:{},children}]});
  return Buffer.from(await Packer.toBuffer(doc));
}

function parseProvidedTable(request) {
  const lines = String(request).split(/\r?\n/).filter(line => line.includes("|"));
  if (lines.length < 2) return null;
  const cells = line => line.split("|").map(x => x.trim()).filter((x, i, arr) => i !== 0 || x).filter((x,i,arr)=>i !== arr.length-1 || x);
  const rows = lines.map(cells).filter(row => row.length > 1 && !row.every(x => /^:?-{2,}:?$/.test(x)));
  return rows.length > 1 ? rows.slice(0, 150) : null;
}

async function renderXlsx(title, request) {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "Jazz AI Assistant";
  book.created = new Date();
  const sheet = book.addWorksheet("Data", {views:[{state:"frozen",ySplit:1}]});
  const table = parseProvidedTable(request);
  const expense = /\b(expense|budget|spending)\b/i.test(request);
  if (table) {
    table.forEach(row => sheet.addRow(row.map(cell => /^[=+\-@]/.test(cell) ? "'" + cell : cell)));
  } else if (expense) {
    sheet.addRow(["Date","Category","Description","Amount (INR)","Notes"]);
    for (let row = 2; row <= 26; row++) sheet.addRow(["","","","", ""]);
    sheet.getCell("C28").value = "Total";
    sheet.getCell("D28").value = {formula:"SUM(D2:D26)"};
    sheet.getColumn(4).numFmt = '"₹"#,##0.00';
  } else {
    sheet.addRow(["Item","Description","Quantity","Unit Price","Total"]);
    for (let row = 2; row <= 26; row++) {
      sheet.addRow(["","","","",{formula:"IF(OR(C"+row+"=\"\",D"+row+"=\"\"),\"\",C"+row+"*D"+row+")"}]);
    }
    sheet.getCell("D28").value = "Total";
    sheet.getCell("E28").value = {formula:"SUM(E2:E26)"};
  }
  sheet.name = title.slice(0, 31).replace(/[\[\]*?:/\\]/g,"") || "Data";
  sheet.getRow(1).font = {bold:true,color:{argb:"FFFFFFFF"}};
  sheet.getRow(1).fill = {type:"pattern",pattern:"solid",fgColor:{argb:"FF24486C"}};
  sheet.getRow(1).height = 23;
  sheet.columns.forEach((column,index) => {column.width = index === 1 || index === 2 ? 30 : 19;});
  sheet.autoFilter = {from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};
  const data = await book.xlsx.writeBuffer();
  return Buffer.from(data);
}

export async function maybeGenerateArtifact(message, generateText) {
  const kind = detectArtifactIntent(message);
  if (!kind) return null;
  const title = documentTitle(message);
  let buffer;
  if (kind === "xlsx") buffer = await renderXlsx(title, message);
  else {
    const prompt = "Draft the actual content requested below. Write a complete professional document with " +
      "meaningful titled sections and concrete, accurate information when known. " +
      "Do not invent personal details or statistics. Return only the document body in readable Markdown, " +
      "without prefaces or claims that files were generated. User request: " + message;
    const content = String(await generateText(prompt) || "").trim();
    if (!content) throw new Error("The local model returned no document content.");
    buffer = kind === "pdf" ? await renderPdf(title, content) : await renderDocx(title, content);
  }
  const mime = kind === "pdf" ? "application/pdf" : kind === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const artifact = storeArtifact(message, kind, buffer, mime);
  const name = kind === "pdf" ? "PDF" : kind === "docx" ? "Word document" : "Excel spreadsheet";
  return {mode:"artifact-generation", artifact,
    assistant: "**Your " + name + " is ready.**\n\n[Download " + artifact.filename + "](" + artifact.url + ")\n\n" +
      "The download link expires in 20 minutes. Generated files are not stored permanently."};
}
