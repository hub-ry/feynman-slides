// Pulling the text out of a lecture PDF, in the browser.
//
// This runs client-side deliberately. The alternative was a server-side
// parser, which would mean a native dependency and a build step for what is,
// in the end, one function - and the file never has to leave the machine to
// be read.
//
// One page becomes one source entry. Lecture decks are already divided into
// the units their author thought in, and a finding that can say "slide 12 of
// lecture-04 says otherwise" is worth more than one pointing at a wall of text.

const PDFJS = "/vendor/pdf.mjs";
let lib = null;

async function pdfjs() {
  if (!lib) {
    lib = await import(PDFJS);
    lib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";
  }
  return lib;
}

/**
 * Join one page's text items back into lines.
 *
 * pdf.js hands back positioned runs, not lines: a bullet and its text are
 * often separate items, and two columns interleave. Grouping by y before
 * sorting by x is what stops "Hash Tables" and "Lecture 4" from being welded
 * into one word.
 */
export function lines(items) {
  const rows = [];
  for (const it of items) {
    const text = it.str;
    if (!text) continue;
    const y = Math.round(it.transform[5]);
    const x = it.transform[4];
    // 3pt of slack: the same visual line is rarely the same y to the pixel.
    const row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (row) row.parts.push({ x, text });
    else rows.push({ y, parts: [{ x, text }] });
  }
  return rows
    .sort((a, b) => b.y - a.y)          // PDF y grows upward; reading order is down
    .map((r) =>
      r.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join("").replace(/\s+/g, " ").trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Extract one entry per page. `onProgress(done, total)` is called as it goes,
 * because a 60-page lecture deck takes long enough that silence reads as a
 * hang.
 */
export async function pdfToSources(file, onProgress) {
  const { getDocument } = await pdfjs();
  // The loading task, not the document, is what owns teardown in pdf.js 6 -
  // the document proxy has no destroy() - so it has to be held onto.
  const task = getDocument({
    data: await file.arrayBuffer(),
    // A lecture PDF is a local file the user chose. It has no business
    // fetching anything, so nothing is left for it to fetch.
    isEvalSupported: false,
    disableAutoFetch: true,
  });
  const doc = await task.promise;

  const name = file.name.replace(/\.pdf$/i, "");
  const pages = doc.numPages;   // read before destroy()
  const out = [];
  try {
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const text = lines((await page.getTextContent()).items);
      page.cleanup();
      // Image-only pages are normal in a scanned deck. Skipping them quietly
      // is better than filling the bin with blanks the critic has to read.
      if (text) out.push({ text, label: `${name} p${n}` });
      onProgress?.(n, pages);
    }
  } finally {
    await task.destroy();
  }
  return { sources: out, pages };
}
