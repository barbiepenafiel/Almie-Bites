/**
 * Save a page section as an A4 PDF that looks like the printed page.
 * Each "block" is captured with the browser's own rendering (html-to-image)
 * and placed top-to-bottom; a block that doesn't fit starts a new page, and
 * only blocks taller than a whole page are split. Elements with the
 * `no-print` class (buttons, filters) are left out, just like when printing.
 */
export async function exportBlocksToPdf(blocks: HTMLElement[], filename: string, footer: string) {
  const [{ toPng }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const footerSpace = 18;
  const contentW = pageW - margin * 2;
  const usableH = pageH - margin * 2 - footerSpace;
  const gap = 10;

  const filter = (node: Node) => !(node instanceof HTMLElement && node.classList.contains("no-print"));
  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  let y = margin;
  for (const block of blocks) {
    if (!block || block.offsetHeight === 0) continue;
    const dataUrl = await toPng(block, { pixelRatio: 2, backgroundColor: "#ffffff", filter, cacheBust: true });
    const img = await loadImage(dataUrl);
    const scale = contentW / img.width; // pt per image px
    const h = img.height * scale;

    if (h <= usableH) {
      if (y + h > margin + usableH && y > margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.addImage(dataUrl, "PNG", margin, y, contentW, h);
      y += h + gap;
      continue;
    }

    // Taller than a page: slice it into page-sized strips.
    if (y > margin) {
      pdf.addPage();
      y = margin;
    }
    const slicePx = Math.floor(usableH / scale);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    const ctx = canvas.getContext("2d")!;
    for (let sy = 0; sy < img.height; sy += slicePx) {
      const sh = Math.min(slicePx, img.height - sy);
      canvas.height = sh;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, sh);
      ctx.drawImage(img, 0, sy, img.width, sh, 0, 0, img.width, sh);
      if (sy > 0) {
        pdf.addPage();
        y = margin;
      }
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, y, contentW, sh * scale);
      y += sh * scale + gap;
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text(footer, margin, pageH - margin + 6);
    pdf.text(`Page ${p} of ${pages}`, pageW - margin, pageH - margin + 6, { align: "right" });
  }
  pdf.save(filename);
}
