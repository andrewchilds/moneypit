/**
 * Browser-side PDF loading with pdf.js. Imported lazily so the worker and
 * renderer only load on pages that show a document.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from '$lib/documentFigures';

type PdfJs = typeof import('pdfjs-dist');

let lib: Promise<PdfJs> | null = null;

export async function loadPdfjs(): Promise<PdfJs> {
	if (!lib) {
		lib = (async () => {
			const [pdfjs, worker] = await Promise.all([
				import('pdfjs-dist'),
				import('pdfjs-dist/build/pdf.worker.min.mjs?url')
			]);
			pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
			return pdfjs;
		})();
	}
	return lib;
}

export async function openPdf(url: string): Promise<PDFDocumentProxy> {
	const pdfjs = await loadPdfjs();
	return pdfjs.getDocument({ url }).promise;
}

/**
 * Text items on a page as rectangles in fractions of the page, top-left
 * origin, so they line up with the rendered canvas at any zoom.
 */
export async function pageTextItems(page: PDFPageProxy): Promise<TextItem[]> {
	const pdfjs = await loadPdfjs();
	const viewport = page.getViewport({ scale: 1 });
	const content = await page.getTextContent();
	const items: TextItem[] = [];
	for (const item of content.items) {
		if (!('str' in item) || !item.str.trim()) continue;
		const tx = pdfjs.Util.transform(viewport.transform, item.transform);
		const fontHeight = Math.hypot(tx[2], tx[3]);
		if (fontHeight === 0) continue;
		// item.width is already in page units at scale 1
		const w = item.width / viewport.width;
		const h = (fontHeight * 1.1) / viewport.height;
		items.push({
			text: item.str,
			x: tx[4] / viewport.width,
			y: (tx[5] - fontHeight * 0.85) / viewport.height,
			w,
			h
		});
	}
	return items;
}

/** All text on a page, for detecting the form type. */
export async function pageText(page: PDFPageProxy): Promise<string> {
	const content = await page.getTextContent();
	return content.items
		.map((item) => ('str' in item ? item.str : ''))
		.join(' ');
}

/** First-page text of a file the user picked, or '' for images and failures. */
export async function sniffFileText(file: File): Promise<string> {
	if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return '';
	try {
		const pdfjs = await loadPdfjs();
		const data = new Uint8Array(await file.arrayBuffer());
		const doc = await pdfjs.getDocument({ data }).promise;
		const page = await doc.getPage(1);
		const text = await pageText(page);
		await doc.loadingTask.destroy();
		return text;
	} catch {
		return '';
	}
}
