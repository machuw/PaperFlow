import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArxivHtml, parseArxivApi, buildVenue, loadArxivPaper, pickImgBaseUrl } from '../../reader/lib/arxiv';

const htmlFixture = readFileSync(
  join(__dirname, '../fixtures/arxiv-html.html'), 'utf-8'
);
const apiFixture = readFileSync(
  join(__dirname, '../fixtures/arxiv-api.xml'), 'utf-8'
);
const realHtmlFixture = readFileSync(
  join(__dirname, '../fixtures/arxiv-html-real.html'), 'utf-8'
);

describe('parseArxivHtml', () => {
  const { outline, paragraphs } = parseArxivHtml(htmlFixture);

  it('extracts outline with correct levels', () => {
    expect(outline.map(o => ({ label: o.label, level: o.level }))).toEqual([
      { label: '1 Introduction', level: 0 },
      { label: '2 Related Work', level: 0 },
      { label: '2.1 Retrieval-augmented LMs', level: 1 },
      { label: '2.2 Long-context attention', level: 1 },
      { label: '3 Method', level: 0 },
    ]);
  });

  it('assigns unique stable ids to outline items', () => {
    const ids = outline.map(o => o.id);
    expect(new Set(ids).size).toBe(outline.length);
  });

  it('produces paragraphs with sec{idx}-p{n} ids', () => {
    const ids = paragraphs.map(p => p.id);
    expect(ids).toEqual([
      'sec0-p0', 'sec0-p1',              // 1 Introduction (level-0 idx 0)
      'sec1-p0', 'sec1-p1', 'sec1-p2',   // 2 Related (2.1 + 2.2, continuous)
      'sec2-p0',                          // 3 Method
    ]);
  });

  it('sets deepest sectionId for nested paragraphs', () => {
    const ragPara = paragraphs.find(p => p.text.startsWith('RAG systems'))!;
    expect(ragPara.section).toBe('2.1 Retrieval-augmented LMs');

    const mambaPara = paragraphs.find(p => p.text.startsWith('Mamba'))!;
    expect(mambaPara.section).toBe('2.2 Long-context attention');
  });
});

describe('parseArxivHtml — ar5iv real fixture', () => {
  const { outline, paragraphs } = parseArxivHtml(realHtmlFixture);

  it('extracts paragraphs wrapped in <div class="ltx_para">', () => {
    const texts = paragraphs.map(p => p.text);
    expect(texts).toContain('Long-context transformers x2 have become central to agentic workflows.');
    expect(texts).toContain('Retrieval concatenates external chunks into the prompt window.');
    expect(texts).toContain('Landmark tokens anchor long-range attention to discrete positions.');
  });

  it('produces outline entries for every <section[id]> including heading-less sections', () => {
    // S1, S2, S2.SS1, S2.SS2, bib → 5 items (bib has no heading but still surfaces as an entry)
    expect(outline).toHaveLength(5);
    const bibItem = outline[outline.length - 1];
    expect(bibItem.label).toBe('');
    expect(bibItem.level).toBe(0);
  });

  it('assigns sec{level0Idx}-p{n} ids with continuous counter across subsections', () => {
    // S1: 2 paragraphs + figure + equation + table = 5 block entries → sec0-p0..sec0-p4
    // S2 (has 2 subsections with paragraphs, no direct paragraphs): sec1-p0, sec1-p1, sec1-p2
    // bib: sec2-p0
    const ids = paragraphs.map(p => p.id);
    expect(ids).toEqual(['sec0-p0', 'sec0-p1', 'sec0-p2', 'sec0-p3', 'sec0-p4', 'sec1-p0', 'sec1-p1', 'sec1-p2', 'sec2-p0']);
  });

  it('deepest sectionId populates .section with subsection label', () => {
    const ragPara = paragraphs.find(p => p.text.startsWith('Retrieval concatenates'))!;
    expect(ragPara.section).toBe('2.1 Retrieval-augmented LMs');
    const landmarkPara = paragraphs.find(p => p.text.startsWith('Landmark tokens'))!;
    expect(landmarkPara.section).toBe('2.2 Landmark attention');
  });

  it('captures innerHTML of ltx_para paragraphs (preserves MathML)', () => {
    const first = paragraphs.find((p) => p.text.startsWith('Long-context transformers'));
    expect(first?.html).toBeTruthy();
    expect(first?.html).toContain('<math');
    expect(first?.html).toContain('<msup>');
    // text still plain
    expect(first?.text).toContain('Long-context transformers');
    expect(first?.text).not.toContain('<math');
  });

  it('leaves html undefined when the source is a bare <p> (no ltx_para wrapper)', () => {
    // Phase 1's arxiv-html.html fixture uses <section><p>...</p></section> —
    // no ltx_para. All paragraphs from that fixture should have html unset.
    const { paragraphs: bareParas } = parseArxivHtml(htmlFixture);
    expect(bareParas.every((p) => p.html === undefined)).toBe(true);
  });

  it('captures a <figure class="ltx_figure"> as its own paragraph-like block with html', () => {
    const fig = paragraphs.find((p) => p.html?.includes('<img class="ltx_graphics"'));
    expect(fig).toBeTruthy();
    expect(fig?.text).toContain('Architecture overview');
    expect(fig?.html).toContain('<figure');
    expect(fig?.html).toContain('Figure 1.');
  });

  it('captures a <div class="ltx_equation"> block with MathML preserved', () => {
    const eq = paragraphs.find((p) => p.html?.includes('ltx_equation'));
    expect(eq).toBeTruthy();
    expect(eq?.html).toContain('<math');
    expect(eq?.html).toContain('<mo>=</mo>');
    expect(eq?.text).toContain('y'); // textContent is symbol concat
  });

  it('captures a <figure class="ltx_table"> with nested table', () => {
    const tab = paragraphs.find((p) => p.html?.includes('ltx_table'));
    expect(tab).toBeTruthy();
    expect(tab?.html).toContain('<table');
    expect(tab?.html).toContain('Baseline');
    expect(tab?.html).toContain('Ours');
  });
});

describe('parseArxivApi', () => {
  const meta = parseArxivApi(apiFixture);

  it('extracts title', () => {
    expect(meta.title).toMatch(/Contextual Residuals/);
  });

  it('extracts authors as array', () => {
    expect(meta.authors).toEqual(['Khan, Y.', 'Voigt, R.']);
  });

  it('extracts abstract (trimmed)', () => {
    expect(meta.abstract).toMatch(/^We propose/);
  });

  it('extracts primaryCategory and publishedDate', () => {
    expect(meta.primaryCategory).toBe('cs.LG');
    expect(meta.publishedDate).toBe('2026-02-14');
  });
});

describe('buildVenue', () => {
  it('formats arXiv venue string', () => {
    expect(buildVenue('2402.18413', 'cs.LG', '2026-02-14')).toBe(
      'arXiv:2402.18413  [cs.LG]  14 Feb 2026'
    );
  });

  it('returns empty string when category missing', () => {
    expect(buildVenue('2402.18413', '', '2026-02-14')).toBe('');
  });
});

describe('loadArxivPaper', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      if (url.includes('/api/query')) {
        return Promise.resolve(new Response(apiFixture, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as any;
  });

  it('fetches html + api in parallel and returns Paper', async () => {
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error();
    expect(result.paper.id).toBe('2402.18413');
    expect(result.paper.title).toMatch(/Contextual Residuals/);
    expect(result.paper.authors).toEqual(['Khan, Y.', 'Voigt, R.']);
    expect(result.paper.outline.length).toBeGreaterThan(0);
    expect(result.paper.paragraphs.length).toBeGreaterThan(0);
    expect(result.paper.venue).toMatch(/^arXiv:2402\.18413/);
  });

  it('returns fallback-to-pdf when html 404s', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return Promise.resolve(new Response(apiFixture, { status: 200 }));
    }) as any;
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('fallback-pdf');
  });
});

describe('loadArxivPaper — discriminator', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      if (url.includes('/api/query')) {
        return Promise.resolve(new Response(apiFixture, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as any;
  });

  it('returns kind: ok when both HTML and API succeed', async () => {
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok');
  });

  it('returns kind: ok-partial when HTML succeeds but API fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      return Promise.resolve(new Response('rate limited', { status: 429 }));
    }) as any;
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok-partial');
    if (result.kind !== 'ok-partial') throw new Error();
    expect(result.paper.paragraphs.length).toBeGreaterThan(0);
    expect(result.paper.authors).toEqual([]);
  });
});

describe('parseArxivHtml img URL rewrite', () => {
  it('rewrites relative <img src> to absolute when baseUrl is supplied', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img class="ltx_graphics" src="figures/a.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/2402.18413v2' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="https://arxiv.org/html/2402.18413v2/figures/a.png"');
  });

  it('leaves absolute http/https <img src> alone', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="https://example.com/b.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="https://example.com/b.png"');
  });

  it('leaves data: <img src> alone', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="data:image/png;base64,iVBORw=="/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="data:image/png;base64,iVBORw=="');
  });

  it('skips rewriting when baseUrl is omitted (back-compat)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="figures/a.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="figures/a.png"');
  });

  it('resolves protocol-relative URLs using baseUrl scheme', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="//cdn.example.com/c.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="https://cdn.example.com/c.png"');
  });

  it('leaves non-http/https/data schemes (e.g. javascript:) unmodified', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="javascript:alert(1)"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    // src is not rewritten to absolute; the original literal remains
    expect(fig?.html).toContain('src="javascript:alert(1)"');
  });

  it('normalizes baseUrl that already ends in slash (no double slash in output)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img src="figures/a.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/2402.18413v2/' });
    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toContain('src="https://arxiv.org/html/2402.18413v2/figures/a.png"');
    expect(fig?.html).not.toContain('//figures');
  });

  it('preserves <table> structure (rows, cells, headers) through the DOMParser round-trip', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <table class="ltx_tabular">
          <tr><th>A</th><th>B</th></tr>
          <tr><td>1</td><td>2</td></tr>
          <tr><td><img src="figures/a.png"/></td><td>3</td></tr>
        </table>
      </section>`;
    const { paragraphs } = parseArxivHtml(html, { baseUrl: 'https://arxiv.org/html/x' });
    const table = paragraphs.find((p) => p.html?.includes('<table'));
    expect(table?.html).toBeTruthy();
    expect(table?.html).toContain('<th>A</th>');
    expect(table?.html).toContain('<th>B</th>');
    expect(table?.html).toContain('<td>1</td>');
    expect(table?.html).toContain('<td>2</td>');
    expect(table?.html).toContain('<td>3</td>');
    expect(table?.html).toContain('src="https://arxiv.org/html/x/figures/a.png"');
  });
});

describe('parseArxivHtml — rich-block descriptor prefix (TODO #9)', () => {
  it('prepends "[Figure <tag>]" to figure captions when ltx_tag is present', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F1">
          <img class="ltx_graphics" src="f.png"/>
          <figcaption class="ltx_caption"><span class="ltx_tag">Figure 1.</span> Architecture overview.</figcaption>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const fig = paragraphs.find((p) => p.html?.includes('<figure'));
    expect(fig?.text).toMatch(/^\[Figure 1\]/);
    expect(fig?.text).toContain('Architecture overview');
  });

  it('prepends "[Figure]" when no ltx_tag span is present', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_figure" id="S1.F2">
          <img class="ltx_graphics" src="f2.png"/>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const fig = paragraphs.find((p) => p.html?.includes('<figure'));
    expect(fig?.text).toMatch(/^\[Figure\]/);
  });

  it('prepends "[Equation]" to ltx_equation blocks', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_equation" id="S1.E1"><math><mi>y</mi><mo>=</mo><mi>x</mi></math></div>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const eq = paragraphs.find((p) => p.html?.includes('ltx_equation'));
    expect(eq?.text).toMatch(/^\[Equation\]/);
  });

  it('prepends "[Table <tag>]" when ltx_tag is present on a ltx_table figure', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure class="ltx_table" id="S1.T1">
          <table class="ltx_tabular"><tr><td>1</td></tr></table>
          <figcaption class="ltx_caption"><span class="ltx_tag">Table 1.</span> Results.</figcaption>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const tbl = paragraphs.find((p) => p.html?.includes('ltx_table'));
    expect(tbl?.text).toMatch(/^\[Table 1\]/);
    expect(tbl?.text).toContain('Results');
  });

  it('prepends "[Table]" to raw <table> (no ltx_table wrapper, no ltx_tag)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <table><tr><td>a</td></tr></table>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const tbl = paragraphs.find((p) => p.html?.includes('<table'));
    expect(tbl?.text).toMatch(/^\[Table\]/);
  });
});

describe('parseArxivHtml — ltx_para wrapping an image (appendix figure pattern)', () => {
  it('captures a <div class="ltx_para"> with no <p> but an <img> child as a block', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Appendix</h2>
        <div id="p1.2.p1" class="ltx_para"><img src="figs/079.png" alt="[Uncaptioned image]"/></div>
        <figure id="A0.F9" class="ltx_figure">
          <figcaption class="ltx_caption"><span class="ltx_tag">Figure 9.</span> Caption only.</figcaption>
        </figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const imgBlock = paragraphs.find((p) => p.html?.includes('079.png'));
    expect(imgBlock).toBeDefined();
    expect(imgBlock!.html).toContain('<img');
    expect(imgBlock!.html).toContain('ltx_para');
    // Caption is captured as a separate figure-block sibling.
    const captionBlock = paragraphs.find((p) => p.html?.includes('id="A0.F9"'));
    expect(captionBlock).toBeDefined();
    expect(captionBlock!.text).toMatch(/^\[Figure 9\]/);
  });

  it('still renders a body <p> inside ltx_para as a text paragraph (regression)', () => {
    // Normal ltx_para with <p> must still produce a plain text paragraph, not a block.
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_para"><p class="ltx_p">Body sentence.</p></div>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const para = paragraphs[0];
    expect(para.text).toBe('Body sentence.');
    expect(para.html).toBe('Body sentence.'); // innerHTML of the <p>
  });

  it('captures top-level ltx_para-with-img (outside any section[id])', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_para"><p class="ltx_p">Body.</p></div>
      </section>
      <div id="p1.2.p1" class="ltx_para"><img src="figs/079.png" alt="[Uncaptioned]"/></div>`;
    const { paragraphs } = parseArxivHtml(html);
    const rootImg = paragraphs.find((p) => p.html?.includes('079.png'));
    expect(rootImg).toBeDefined();
    expect(rootImg!.html).toContain('<img');
  });

  it('does NOT capture a top-level body-text ltx_para (with <p>) as a block', () => {
    // A bare ltx_para at document root that has a <p> is a body paragraph.
    // The float-catcher skips it (body paragraphs outside any section are rare
    // and our current design doesn't attempt to surface them).
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_para"><p class="ltx_p">Inside.</p></div>
      </section>
      <div class="ltx_para"><p class="ltx_p">Outside.</p></div>`;
    const { paragraphs } = parseArxivHtml(html);
    // Only the in-section paragraph appears.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].text).toBe('Inside.');
  });
});

describe('parseArxivHtml — appendix floats (top-level blocks outside any section)', () => {
  it('captures a loose <figure> at document root and attaches it to the last outline entry', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_para"><p class="ltx_p">Body text.</p></div>
      </section>
      <figure id="A0.F1" class="ltx_figure">
        <img src="app.png"/>
        <figcaption class="ltx_caption"><span class="ltx_tag">Figure 9.</span> Loose appendix figure.</figcaption>
      </figure>`;
    const { outline, paragraphs } = parseArxivHtml(html);
    const loose = paragraphs.find((p) => p.html?.includes('id="A0.F1"'));
    expect(loose).toBeDefined();
    expect(loose!.text).toMatch(/^\[Figure 9\]/);
    expect(loose!.text).toContain('Loose appendix figure');
    // Anchored to the last outline entry (the only one, in this fixture).
    expect(loose!.sectionId).toBe(outline[outline.length - 1].id);
  });

  it('does not double-capture nested floats (sub-panel inside an outer <figure>)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <div class="ltx_para"><p class="ltx_p">Body text.</p></div>
      </section>
      <figure id="A0.F1" class="ltx_figure">
        <figure id="A0.F1a" class="ltx_figure"><img src="a.png"/></figure>
        <figure id="A0.F1b" class="ltx_figure"><img src="b.png"/></figure>
      </figure>`;
    const { paragraphs } = parseArxivHtml(html);
    // Only the outer figure counts; inner panels ride inside its outerHTML.
    const outer = paragraphs.filter((p) => p.html?.includes('id="A0.F1"'));
    const innerA = paragraphs.filter((p) => p.html?.trim().startsWith('<figure id="A0.F1a"'));
    expect(outer).toHaveLength(1);
    expect(innerA).toHaveLength(0);
  });

  it('skips floats already captured as section[id] children (no duplication)', () => {
    const html = `
      <section class="ltx_section" id="S1">
        <h2 class="ltx_title">1 Intro</h2>
        <figure id="S1.F1" class="ltx_figure"><img src="x.png"/></figure>
      </section>`;
    const { paragraphs } = parseArxivHtml(html);
    const hits = paragraphs.filter((p) => p.html?.includes('id="S1.F1"'));
    expect(hits).toHaveLength(1);
  });
});

describe('parseArxivHtml — end-to-end HTML fidelity', () => {
  it('round-trips rich blocks with html set and plain paragraphs with html unset', () => {
    const { paragraphs } = parseArxivHtml(realHtmlFixture, {
      baseUrl: 'https://arxiv.org/html/test/v1',
    });

    const plainPara = paragraphs.find((p) => p.text.startsWith('Retrieval concatenates'));
    expect(plainPara?.html).toBeTruthy();
    expect(plainPara?.html).not.toContain('<figure');

    expect(paragraphs.some((p) => p.html?.includes('<figure'))).toBe(true);
    expect(paragraphs.some((p) => p.html?.includes('ltx_equation'))).toBe(true);
    expect(paragraphs.some((p) => p.html?.includes('<table'))).toBe(true);

    const fig = paragraphs.find((p) => p.html?.includes('<img'));
    expect(fig?.html).toMatch(/src="https:\/\/arxiv\.org\/html\/test\/v1\//);

    expect(paragraphs[0].id).toBe('sec0-p0');
    expect(paragraphs.map((p) => p.id)).toEqual([...new Set(paragraphs.map((p) => p.id))]);
  });
});

describe('loadArxivPaper — I4 HTML-OK / API-fail fallback', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/html/')) {
        return Promise.resolve(new Response(htmlFixture, { status: 200 }));
      }
      if (url.includes('/api/query')) {
        return Promise.resolve(new Response('rate limited', { status: 429 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }) as any;
  });

  it('returns ok-partial with partial Paper when HTML loads but API fails', async () => {
    const result = await loadArxivPaper('2402.18413');
    expect(result.kind).toBe('ok-partial');
    if (result.kind !== 'ok-partial') throw new Error();
    expect(result.paper.paragraphs.length).toBeGreaterThan(0);
    expect(result.paper.authors).toEqual([]);
    expect(result.paper.abstract).toBe('');
    expect(result.paper.title).toBeTruthy();
    expect(result.paper.venue).toBe('');
  });
});

describe('parseArxivApi — I3 feed-title scoping', () => {
  it('picks the <entry><title> value, not the outer <feed><title>', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: search_query=id_list:2402.18413</title>
  <entry>
    <id>http://arxiv.org/abs/2402.18413v2</id>
    <title>Contextual Residuals: A Lightweight Memory</title>
    <summary>We propose…</summary>
    <author><name>Khan, Y.</name></author>
    <published>2026-02-14T00:00:00Z</published>
    <category term="cs.LG"/>
  </entry>
</feed>`;
    const meta = parseArxivApi(xml);
    expect(meta.title).toBe('Contextual Residuals: A Lightweight Memory');
    expect(meta.title).not.toContain('ArXiv Query');
  });
});

describe('pickImgBaseUrl — ar5iv img-path convention detection', () => {
  it('returns parent /html/ when HTML has versioned-prefix src (modern ar5iv)', () => {
    const html = '<html><body><img src="2604.05015v1/x1.png"/></body></html>';
    expect(pickImgBaseUrl(html, '2604.05015')).toBe('https://arxiv.org/html');
  });

  it('returns /html/{id} when HTML has plain-name src (legacy ar5iv)', () => {
    const html = '<html><body><img src="x1.png"/></body></html>';
    expect(pickImgBaseUrl(html, '2409.10262')).toBe('https://arxiv.org/html/2409.10262');
  });

  it('escapes dots in id when matching versioned prefix', () => {
    // Should NOT match "26X4X05015v1/" (a random string that happens to share
    // the digit layout but not the dots).
    const html = '<html><body><img src="2699905015v1/x.png"/></body></html>';
    expect(pickImgBaseUrl(html, '2604.05015')).toBe('https://arxiv.org/html/2604.05015');
  });

  it('treats nested relative paths (e.g. extracted/...) as legacy (no versioned prefix)', () => {
    const html = '<html><body><img src="extracted/6234238/hydra.png"/></body></html>';
    expect(pickImgBaseUrl(html, '2409.10262')).toBe('https://arxiv.org/html/2409.10262');
  });

  it('detects versioned prefix with any version number', () => {
    const html = '<html><body><img src="2501.00001v3/fig.png"/></body></html>';
    expect(pickImgBaseUrl(html, '2501.00001')).toBe('https://arxiv.org/html');
  });
});
