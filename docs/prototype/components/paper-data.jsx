// Mock paper content — plausible ML research paper
window.PAPER = {
  id: "arxiv-2402-18413",
  title: "Contextual Residuals: A Lightweight Memory for Long-Horizon Transformers",
  authors: ["Ayesha Khan", "Marcus Voigt", "Li-Yan Chen", "Priya Raghavan"],
  affiliations: ["MILA, Université de Montréal", "ETH Zürich"],
  venue: "arXiv:2402.18413v2  [cs.LG]  14 Feb 2026",
  abstract: "We introduce Contextual Residuals, a drop-in memory module that lets transformer decoders recall information across windows an order of magnitude longer than their nominal context. The mechanism stores a low-rank residual per chunk and interleaves retrieval into the usual attention pass with negligible compute overhead. On LongBench-v2 we match a 128k context baseline at 16k tokens of attention, and on SWE-bench Verified we improve by +6.4 pp. We analyze the method's failure modes on repetition-sensitive tasks and offer a simple scheduler that recovers most of the gap.",
  summary: `# Contextual Residuals — at a glance

The authors propose a small, low-rank memory module that lives alongside a transformer's attention. Instead of widening the attention window to 128k tokens, they store one cheap residual per past chunk and inject it back as a bias to attention logits at inference time. The attention matrix never grows.

On LongBench-v2 this 16k-attention model recovers **94 %** of the quality gap to a 128k baseline while spending one-eighth of the attention FLOPs. On SWE-bench Verified the same recipe lifts task accuracy by +6.4 pp.

![Method overview — chunk residuals stored and injected as attention bias](https://picsum.photos/seed/contextual-residuals-method/720/360)

## Why it matters

The framing here is unusually sharp: long-range failure is treated as a *signal-preservation* problem, not an *attention-window* problem. If preceding layers have already averaged away the thing you'd need to retrieve, widening attention is the wrong lever. A cheap per-chunk residual, re-injected later, is the right one.

For your thesis on cost/latency as the remaining moat, this matters because it weakens the brute-force-context argument for frontier capability.

## Concretely

- **Cheap to add** — the residual head is ~1.8 % extra parameters and adds no attention cost.
- **Honest about failure** — repetition-sensitive sub-tasks (count-the-occurrences) are where the low-rank projection loses signal; §3.3's scheduler patches this but feels heuristic.
- **Drop-in** — the recipe slots into a Llama-3.1-8B checkpoint at the 16k context length without retraining attention from scratch.

![LongBench-v2 per-task scores — Contextual Residuals close the gap](https://picsum.photos/seed/contextual-residuals-results/720/300)

The next thing to verify is whether the scheduler generalises beyond repetition-sensitive tasks, and whether the same residual recipe survives the agentic-trace setting that Xu et al. (2025) used to push back on retrieval-only approaches.`,
  outline: [
    { id: "abs", label: "Abstract", page: 1, level: 0 },
    { id: "intro", label: "1 Introduction", page: 1, level: 0 },
    { id: "related", label: "2 Related Work", page: 3, level: 0 },
    { id: "related-1", label: "2.1 Retrieval-augmented LMs", page: 3, level: 1 },
    { id: "related-2", label: "2.2 Long-context attention", page: 4, level: 1 },
    { id: "method", label: "3 Method", page: 5, level: 0 },
    { id: "method-1", label: "3.1 Chunk residuals", page: 5, level: 1 },
    { id: "method-2", label: "3.2 Retrieval as attention bias", page: 6, level: 1 },
    { id: "method-3", label: "3.3 Training objective", page: 7, level: 1 },
    { id: "exp", label: "4 Experiments", page: 8, level: 0 },
    { id: "exp-1", label: "4.1 LongBench-v2", page: 8, level: 1 },
    { id: "exp-2", label: "4.2 SWE-bench Verified", page: 10, level: 1 },
    { id: "ablate", label: "5 Ablations", page: 11, level: 0 },
    { id: "disc", label: "6 Discussion", page: 13, level: 0 },
    { id: "conc", label: "7 Conclusion", page: 14, level: 0 },
    { id: "refs", label: "References", page: 15, level: 0 },
  ],
  paragraphs: [
    {
      id: "p1", section: "1 Introduction",
      text: "Transformer decoders struggle to carry information beyond their attention window. Recent long-context variants address this by widening attention itself — scaling to 128k or more tokens — but pay a quadratic cost in practice and degrade badly on tasks that require selective recall.",
    },
    {
      id: "p2", section: "1 Introduction",
      text: "We argue a different decomposition. Attention is already an excellent short-range associative memory; it fails long-range chiefly because the signal it would need to retrieve has been averaged away by preceding layers. If we can cheaply store a residual per chunk and reintroduce it at inference, we recover much of the long-range recall without expanding the attention window at all.",
      important: true,
    },
    {
      id: "p3", section: "1 Introduction",
      text: "Our contribution is threefold. (1) We introduce Contextual Residuals, a low-rank chunk-level memory that adds 1.8 % parameters and no attention cost. (2) We show it matches a 128k-token baseline on LongBench-v2 while attending over only 16k tokens per forward pass. (3) We analyze where the method breaks — repetition-sensitive sub-tasks — and present a scheduler that recovers most of the gap.",
    },
    {
      id: "p4", section: "2.1 Retrieval-augmented LMs",
      text: "Prior work on retrieval-augmented language models falls broadly into two camps: external kNN over hidden states (Khandelwal et al., 2020) and learned memory banks jointly trained with the model (Wu et al., 2022). Our design inherits the cheap-lookup quality of the former and the end-to-end differentiability of the latter.",
    },
    {
      id: "p5", section: "3.1 Chunk residuals",
      text: "Given hidden states h ∈ ℝⁿˣᵈ for a chunk of n tokens, we project them through a low-rank encoder φ : ℝⁿˣᵈ → ℝᵏ with k ≪ d. The projected residual r = φ(h) is stored in an append-only cache indexed by position. At retrieval time, the decoder reads the top-m residuals by cosine similarity and adds them as an additive bias to the attention logits.",
    },
    {
      id: "p6", section: "3.2 Retrieval as attention bias",
      text: "Rather than concatenating retrieved material to the input — which would grow the attention window and reintroduce the cost we are trying to avoid — we inject it directly into the attention mechanism. For each query q_i we compute a bias b_i = ⟨q_i, W r⟩ and add it to the attention logit for the corresponding retrieved chunk. This keeps the attention matrix the same shape.",
    },
    {
      id: "p7", section: "4.1 LongBench-v2",
      text: "On LongBench-v2 we evaluate against a Llama-3.1-8B baseline extended to 128k with RoPE-θ scaling. Our method, trained from the 16k checkpoint, closes 94 % of the quality gap while requiring 1/8th the attention FLOPs per token. Table 2 reports per-task scores.",
      important: true,
    },
    {
      id: "p8", section: "5 Ablations",
      text: "Removing the residual projection φ and storing raw hidden states performs comparably at low m but collapses beyond m = 16 — we attribute this to noise accumulation from the unprojected high-variance dimensions. Increasing k past 64 yields diminishing returns.",
    },
    {
      id: "p9", section: "6 Discussion",
      text: "The central limitation is repetition-sensitive tasks: when a correct answer requires noticing that a token appeared exactly three times at specific offsets, our low-rank residual averages the signal away. The scheduler in § 3.3 mitigates this by deferring retrieval on such sub-tasks, but a cleaner solution is future work.",
    },
  ],
  figures: [
    { id: "fig1", label: "Figure 1", caption: "Overview of Contextual Residuals. A chunk of hidden states is projected through φ, stored, and later injected as an additive bias to attention logits.", page: 2 },
    { id: "fig2", label: "Figure 2", caption: "LongBench-v2 per-task scores. Contextual Residuals (ours) close 94 % of the gap to a 128k-token baseline.", page: 9 },
  ],
  // Pre-populated research context
  memory: {
    whyItMatters: "If Contextual Residuals works at scale, it weakens the argument that frontier labs need to brute-force context-length to ship capable agents. That directly affects your thesis on latency/cost as the remaining moat.",
    role: "Background — a candidate alternative to the long-context route your survey discusses in §2.",
    judgment: "Plausible but unverified on agentic traces. The 94 % claim is on LongBench, not on repeated-lookup tasks; §6 admits this honestly.",
    linked: [
      { title: "Landmark Attention", why: "Same residual-per-chunk intuition, but discrete landmarks.", role: "Ancestor" },
      { title: "RAG is not enough (Xu 2025)", why: "Counter-evidence: cheap retrieval doesn't close the agentic gap.", role: "Counter" },
      { title: "Your Oct notes — 'memory moats'", why: "You asked exactly this question three weeks ago.", role: "Prior" },
    ],
    nextActions: [
      "Compare against §4.2 of Xu 2025 on agentic-trace benchmarks.",
      "Ask whether the scheduler generalises to non-repetition tasks.",
      "Re-read the residual projection construction in §3.1 — the φ choice feels under-motivated.",
    ],
  },
};
