#!/usr/bin/env node
/*
 * publish.js — turn plain-text public-domain books into standalone HTML readers.
 *
 *   1. Put each book in  books/<slug>/  with a  meta.json  and a  source.txt
 *   2. Run:  node publish.js
 *   3. Open  dist/index.html  (the library) or  dist/<slug>.html  (one book)
 *
 * No dependencies. Each generated reader is a single self-contained HTML file:
 * the text, styles and script are all inlined, so it works offline and on a
 * phone, and can be hosted on any static server (or just double-clicked).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const BOOKS_DIR = path.join(ROOT, "books");
const SRC_DIR = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "dist");

const READER_TPL = read(path.join(SRC_DIR, "reader.template.html"));
const LIBRARY_TPL = read(path.join(SRC_DIR, "library.template.html"));

// ---------------------------------------------------------------------------
// chapter detection
// ---------------------------------------------------------------------------

// Default: a short line that opens with a "chapter word", in several languages.
const DEFAULT_HEADING =
  /^\s*(CANTO|RAPSODIA|CAP[IÍ]TULO|LIBRO|PARTE|SECCI[OÓ]N|ACTO|ESCENA|CHAPTER|BOOK|PART|CANTICA)\b.{0,60}$/i;

// Strip the Project Gutenberg license header/footer if present.
function stripGutenberg(text) {
  const start = text.match(/\*\*\* *START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*\*\*/i);
  const end = text.match(/\*\*\* *END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*\*\*/i);
  let out = text;
  if (start) out = out.slice(start.index + start[0].length);
  if (end) {
    const endInStripped = out.match(/\*\*\* *END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*\*\*/i);
    if (endInStripped) out = out.slice(0, endInStripped.index);
  }
  return out;
}

function splitChapters(text, meta) {
  const heading = meta.chapterPattern ? new RegExp(meta.chapterPattern, "i") : DEFAULT_HEADING;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const chapters = [];
  let front = [];
  let cur = null;

  const isHeading = (line) => {
    const t = line.trim();
    if (!t || t.length > 70) return false;
    return heading.test(t);
  };

  for (const line of lines) {
    if (isHeading(line)) {
      if (cur) chapters.push(cur);
      cur = { title: line.trim().replace(/\s+/g, " "), body: [] };
    } else if (cur) {
      cur.body.push(line);
    } else {
      front.push(line);
    }
  }
  if (cur) chapters.push(cur);

  // Front matter that has real content becomes its own opening "chapter".
  const frontText = front.join("\n").trim();
  if (frontText) {
    chapters.unshift({ title: meta.frontTitle || "Comienzo", body: front });
  }

  // If no headings matched at all, keep the whole thing as one chapter.
  if (chapters.length === 0) {
    chapters.push({ title: meta.title, body: lines });
  }
  return chapters;
}

// ---------------------------------------------------------------------------
// text -> HTML
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function bodyToHtml(bodyLines, meta) {
  const text = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return "";
  const blocks = text.split(/\n\s*\n/);
  const html = [];

  for (let block of blocks) {
    block = block.replace(/^\n+|\n+$/g, "");
    if (!block.trim()) continue;

    // scene break
    if (/^\s*([*_—-]\s*){3,}\s*$/.test(block)) {
      html.push("<hr>");
      continue;
    }
    if (meta.verse) {
      // keep line breaks inside a stanza
      html.push('<p class="verse">' + esc(block) + "</p>");
    } else {
      html.push("<p>" + esc(block.replace(/\s*\n\s*/g, " ")) + "</p>");
    }
  }
  return html.join("\n");
}

function countWords(chapters) {
  return chapters.reduce((n, ch) => {
    const words = ch.body.join(" ").trim().split(/\s+/).filter(Boolean).length;
    return n + words;
  }, 0);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function buildBook(slug) {
  const dir = path.join(BOOKS_DIR, slug);
  const metaPath = path.join(dir, "meta.json");
  const srcPath = path.join(dir, "source.txt");
  if (!fs.existsSync(metaPath) || !fs.existsSync(srcPath)) {
    console.warn(`  ! skipping ${slug}: needs meta.json and source.txt`);
    return null;
  }

  const meta = JSON.parse(read(metaPath));
  meta.slug = meta.slug || slug;
  meta.title = meta.title || slug;

  const raw = stripGutenberg(read(srcPath));
  const chapters = splitChapters(raw, meta).map((ch) => ({
    title: ch.title,
    html: bodyToHtml(ch.body, meta),
    body: ch.body,
  }));

  const words = countWords(chapters);

  const bookData = {
    slug: meta.slug,
    title: meta.title,
    author: meta.author || "",
    translator: meta.translator || "",
    language: meta.language || "es",
    year: meta.year || "",
    description: meta.description || "",
    cover: meta.cover || "📖",
    coverBg: meta.coverBg || "#9a5b34",
    chapters: chapters.map((c) => ({ title: c.title, html: c.html })),
  };

  const html = READER_TPL
    .replace(/__TITLE__/g, esc(meta.title))
    .replace("__BOOK_DATA__", JSON.stringify(bookData));

  fs.writeFileSync(path.join(OUT_DIR, meta.slug + ".html"), html);
  console.log(`  ✓ ${meta.slug}.html — ${chapters.length} chapters, ~${words.toLocaleString("en")} words`);

  return {
    slug: meta.slug,
    title: meta.title,
    author: meta.author || "",
    translator: meta.translator || "",
    description: meta.description || "",
    cover: meta.cover || "📖",
    coverBg: meta.coverBg || "#9a5b34",
    chapterCount: chapters.length,
    words,
  };
}

function buildLibrary(cards) {
  let cfg = {};
  const cfgPath = path.join(ROOT, "library.json");
  if (fs.existsSync(cfgPath)) cfg = JSON.parse(read(cfgPath));

  const html = LIBRARY_TPL
    .replace("__LIBRARY_TITLE__", esc(cfg.title || "Biblioteca"))
    .replace("__LIBRARY_TAGLINE__", esc(cfg.tagline || "Libros de dominio público para leer en cualquier pantalla."))
    .replace("__BOOKS_DATA__", JSON.stringify(cards));

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
  console.log(`  ✓ index.html — ${cards.length} book(s)`);
}

function main() {
  if (!fs.existsSync(BOOKS_DIR)) {
    console.error("No books/ directory found.");
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const slugs = fs.readdirSync(BOOKS_DIR).filter((name) => {
    return fs.statSync(path.join(BOOKS_DIR, name)).isDirectory() && !name.startsWith(".");
  });

  console.log(`Publishing ${slugs.length} book(s) to dist/ …`);
  const cards = [];
  for (const slug of slugs.sort()) {
    const card = buildBook(slug);
    if (card) cards.push(card);
  }
  buildLibrary(cards);
  console.log("Done. Open dist/index.html");
}

function read(p) { return fs.readFileSync(p, "utf8"); }

main();
