import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ItemRange } from '../lib/pdf-items';

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;          // 1-based
  ranges: ItemRange[];         // paragraph ranges for this page
  paragraphIds: string[];      // sec{n}-p{m}, same length as ranges, in document order
  scale?: number;              // default 1.25 — readable at 960px wide viewport
}

/**
 * Renders one PDF page. Skeleton mounts with known dimensions from
 * `page.getViewport()`. An IntersectionObserver triggers the actual
 * `page.render()` + TextLayer hydration when the skeleton enters viewport ±1.
 *
 * After render:
 * - `<canvas>` holds the raster image.
 * - `<div class="pf-pdf-text-layer">` holds pdfjs's <span>s, each tagged
 *   with `data-pid` matching the paragraph it belongs to.
 */
export function PdfPage({ doc, pageNumber, ranges, paragraphIds, scale = 1.25 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eagerly fetch page dimensions so the skeleton has correct height (prevents
  // layout jank as pages lazily fill in).
  useEffect(() => {
    let cancelled = false;
    doc.getPage(pageNumber).then((page: PDFPageProxy) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setDims({ width: viewport.width, height: viewport.height });
    }).catch(() => {
      // doc may be destroyed during pdfRuntime swap; safe to swallow.
    });
    return () => { cancelled = true; };
  }, [doc, pageNumber, scale]);

  // IntersectionObserver: render when the skeleton is within viewport ±1 page.
  useEffect(() => {
    if (!rootRef.current || rendered) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRendered(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: '200% 0px' },   // trigger when within 2 viewport heights
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [rendered]);

  // Actual render + text layer hydration. Runs when `rendered` flips true.
  useEffect(() => {
    if (!rendered || !dims || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;
    let textLayer: InstanceType<typeof TextLayer> | null = null;
    let detachSelection: (() => void) | null = null;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.scale(dpr, dpr);

        renderTask = page.render({ canvasContext: ctx, viewport });
        try {
          await renderTask.promise;
        } catch (e: any) {
          if (e?.name === 'RenderingCancelledException') return;  // expected
          throw e;
        }
        if (cancelled) return;

        const container = textLayerRef.current!;
        container.innerHTML = '';
        // pdfjs's TextLayer sizes the container as
        //   width: calc(var(--scale-factor) * pageWidth px);
        // Without this variable the container (and the span positions
        // inside it) stays at the PDF's native 1× size while the canvas
        // scales up — leaving selection hit-testing misaligned with the
        // rendered glyphs. Keep the CSS var in sync with our scale.
        container.style.setProperty('--scale-factor', String(scale));
        const textContent = await page.getTextContent();
        if (cancelled) return;

        textLayer = new TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        // Selection enhancement: append the `.endOfContent` sentinel and
        // toggle a `.selecting` class on the container during an active
        // drag. CSS expands the sentinel to fill the whole layer while
        // selecting, bridging gaps between absolutely-positioned text
        // spans so multi-line and cross-column drags produce a continuous
        // selection instead of patchy fragments.
        const endOfContent = document.createElement('div');
        endOfContent.className = 'endOfContent';
        container.appendChild(endOfContent);
        const onPointerDown = (e: PointerEvent) => {
          if (e.button !== 0) return;
          container.classList.add('selecting');
          const onUp = () => {
            container.classList.remove('selecting');
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
          };
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        };
        container.addEventListener('pointerdown', onPointerDown);
        detachSelection = () => {
          container.removeEventListener('pointerdown', onPointerDown);
          container.classList.remove('selecting');
        };

        // Tag each span with data-pid via monotonic pointer walk: spans and
        // ranges are both in item-index order, so a single pass suffices.
        const spans = textLayer.textDivs;
        // Invariant: pdfjs TextLayer emits one <span> per text item where
        // `typeof item.str === 'string'` — same filter as parsePdf. If pdfjs
        // ever changes this mapping, ranges would point past the span array
        // and data-pid tagging would drift. Warn loudly in dev.
        const lastEnd = ranges.length > 0 ? ranges[ranges.length - 1].endIdx : 0;
        if (spans.length < lastEnd) {
          console.warn(
            '[PaperFlow] PdfPage span/range alignment drift on page',
            pageNumber, '— spans:', spans.length, 'expected ≥', lastEnd,
            '(pdfjs version may have changed text-item filter)',
          );
        }
        let rIdx = 0;
        for (let i = 0; i < spans.length; i++) {
          while (rIdx < ranges.length && i >= ranges[rIdx].endIdx) rIdx++;
          if (rIdx < ranges.length && i >= ranges[rIdx].startIdx) {
            spans[i].setAttribute('data-pid', paragraphIds[rIdx]);
          }
        }

        // Notify ViewerApp that this page's text layer is now in the DOM so
        // any pending highlights can be registered against the new spans.
        if (!cancelled) {
          const scroll = rootRef.current?.closest<HTMLElement>('[data-reader-scroll]');
          scroll?.dispatchEvent(new CustomEvent('pf-textlayer-ready', { bubbles: false }));
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[PaperFlow] PdfPage render failed page', pageNumber, err);
        setError(err instanceof Error ? err.message : 'Render failed');
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      detachSelection?.();
    };
  }, [rendered, dims, doc, pageNumber, scale, ranges, paragraphIds]);

  return (
    <div
      ref={rootRef}
      className="pf-pdf-page"
      data-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={{
        position: 'relative',
        width: dims?.width,
        height: dims?.height,
        margin: '0 auto 16px',
        background: 'var(--paper)',
      }}
    >
      <canvas
        ref={canvasRef}
        className="pf-pdf-canvas"
        aria-hidden="true"
        role="presentation"
      />
      <div
        ref={textLayerRef}
        className="pf-pdf-text-layer textLayer"
      />
      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 12,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--foxglove)',
          background: 'color-mix(in oklch, var(--foxglove) 8%, var(--paper-soft))',
        }}>
          Failed to render page {pageNumber}: {error}
        </div>
      )}
    </div>
  );
}
