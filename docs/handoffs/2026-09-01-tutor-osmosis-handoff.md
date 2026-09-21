# Handoff — Osmosis

You test Ben on his uploaded notes. Tags and subtags, a question bank that isn't document-oriented, recorded attempts, your own bootstrap, a document viewer, Desmos integration and a graph engine. You run against a SQL database rather than a live session, and there's no FSRS yet.

This is a proposal from the tutor — the fourth component of a four-part system. It's asking you to become the place every question in that system lives.

**The framing that makes this tractable: it's the same engine with a different item source.** You already store items, present them, and record what happened. What changes is where items come from and who's listening for the result. This is repurposing, not rebuilding.

---

## What the tutor got wrong

Stated up front, because an earlier draft of this document asked you to confirm things that aren't true, and it would have wasted your first move correcting them.

**Assumed and false:** that FSRS or an equivalent retention model exists; that live request/response is available; that you administer tests in the sense the tutor needs.

**Assumed and true, and better than expected:** the question bank being non-document-oriented — items as first-class objects with their own identity is exactly the shape the requests below need, and it's the expensive thing to retrofit. Recorded attempts, likewise: it's the substrate for §5 and for any retention model later.

**Not known about, and it changed the design:** Desmos and the graph engine mean you can carry a category of item the tutor cannot express in a chat transcript at all — plotted functions, interactive figures, titration curves. An earlier draft mentioned this in passing and then designed around it anyway. §3 has been rewritten because of it: the app is now the primary question surface rather than a workaround for a transcript problem.

---

## The four-part split

| Component | Owns |
|---|---|
| **Engine** | Where Ben is in each course, what it expects. Reads D2L. Live |
| **Mycelium** | What's inside the material — sections in PDFs, chunks, terms, derived prerequisites |
| **Tutor** | Teaching, and diagnosis — not *what does he know* but *why did that go wrong* |
| **Osmosis** (you) | Items and retention |

**The boundary rule all four follow:** no component reaches around another. The tutor never calls D2L, never parses a PDF, and never schedules retention. Anything missing gets added to a component's published surface rather than fetched sideways. That's why this document exists instead of the tutor quietly building its own item store — that option was considered and rejected, because a shim built to be temporary becomes permanent.

---

## Sequencing

Ordered by what unblocks what, not by importance.

```
1. Live request/response   ← everything else sits behind this
        ↓
2. Ingestion  +  3. Delivery
        ↓
4. Rich outcomes
        ↓
5. Scheduling        6. Retrospective audit
        ↓
7. Retention model (later)
```

---

## 1. Live request/response

**The architectural change, and the prerequisite for everything below.**

Right now a session is Ben and a database. What the tutor needs is a third participant: mid-conversation, the tutor asks you for a question, the app renders it, Ben answers there, you return what happened — while the conversation is still going.

Nothing else in this document is possible before this, and it's the reason it's first rather than the most interesting.

**This requirement has not shrunk.** If an earlier conversation suggested probes might be asynchronous-only and that live I/O could be deferred, that was wrong and is retracted — §3 explains why. Live request/response is the prerequisite, exactly as sequenced here.

**How much of a lift this is, is the single most useful thing you can tell the tutor back.** The whole build plan assumes it's the longest pole. If it isn't, the ordering changes.

---

## 2. Ingestion — items the tutor writes

The tutor authors questions and needs to file them with enough metadata that §5 and §6 are possible later.

What each item carries:

- **What it's about** — see §8 on identity
- **What rung it can support** — the tutor's claim ladder runs `can_state` → `can_apply` → `can_discriminate` → `can_explain_why` → `can_transfer`, and an item written to test one rung can't evidence a higher one
- **What error it's testing**, when it's testing one
- **Where it came from** — tutor-authored vs. textbook-sourced. This looks like bookkeeping and is load-bearing; see §6
- **What each wrong option means** — see §4

---

## 3. Delivery — the Osmosis app is the primary question surface

**Correcting an earlier version of this document**, which described this as a workaround for a Claude Code transcript problem. That framing was too small and it conflated two independent things: *where a question renders* and *when it happens*.

Four cells, not two:

| | **Live** (mid-session, tutor waiting) | **Delayed** (async) |
|---|---|---|
| **Osmosis app** | tutor sends via MCP → renders in the app → Ben answers → result returns → tutor sends the next | Ben opens the app later and does what's due |
| **Claude Code** | quick free-response check inside a node | — |

**The top-left is the primary loop**, and it's most of the volume.

### 3.1 Why the app, and not the chat

**The transcript problem.** In Claude Code, tool calls are visible. A question written inline shows Ben the answer key, which breaks commit-before-reveal — the intervention that reliably reduces overreliance where transparency and explanation don't (Buçinca et al. 2021). The study where a tutor harmed learning by 17% was the one where students could just ask for the answer.

**But the bigger reason is what the app can render and a transcript can't.** Your graph engine and Desmos integration mean a question can be *drawn* — a plotted function, an interactive figure, a titration curve. That's a category of item the tutor cannot express at all in chat. This was flagged in an earlier draft as "something the tutor didn't know to ask for," and then the design ignored it. It shouldn't have.

**And it recovers the distractor diagnostics.** The chat fallback is free-response, which preserves the commitment but throws away multiple-choice entirely — and per §4, which option was chosen *is* the diagnosis. App rendering gets that back.

### 3.2 The live loop, concretely

The clearest case is **Phase 1 probing**, which is a genuine back-and-forth: the tutor is bracketing the edge of what Ben knows, escalating sharply on a hit and narrowing on a miss until it has both a floor and a ceiling. Each question depends on the last answer. Five to ten minutes, ten to twenty items.

```
tutor  --MCP-->  Osmosis     "here is the next item"
                 Osmosis  →  app renders it
                 Ben      →  answers in the app
                 Osmosis  →  outcome: which option, or "I don't know"
tutor  <--------  reads it, chooses the next item
```

Ben has the app open beside the session. The tutor never sees the item's answer key in its own transcript, and the question can carry a rendered graph.

### 3.3 What stays in Claude Code

Only the **in-node check** — step 6 of the teaching loop, immediately after consolidation, confirming the node landed. One question, free-response, minimal. It shouldn't require switching surfaces mid-node.

Everything else is yours: Phase 1 probes, discriminating items, retention probes, and the 48h consolidation check.

### 3.4 The trap: rendering surface is not evidence weight

**An item that ran through Osmosis during the teaching session is still in-session evidence.**

The tutor's claim ladder is gated on *elapsed time and a sleep boundary*, not on which surface the question appeared on. A live app-rendered probe answered ten minutes after teaching measures working memory exactly as much as an inline question would.

This is worth stating because your involvement will feel like it should count for more, and it doesn't. The tutor enforces this on its own side — a probe that didn't cross a sleep boundary is downgraded regardless of label — so nothing is required from you. But if you're modelling item weight, don't infer it from delivery.

### 3.5 The fallback while this is being built

Free-response in chat and textbook problems. Preserves commit-before-reveal, loses everything in §4. The error taxonomy runs degraded until live delivery exists, which is why it's sequenced first.

---

## 4. Outcomes — the diagnosis is in *which* wrong answer

**The request most likely to be surprising, and the one the tutor's reason for existing depends on.**

Items in this system aren't "a question plus three plausible wrong options." Each wrong option is the *correct* claim, mutated at exactly the one point a specific wrong model would get it wrong. Someone who thinks X picks B. Someone who thinks Y picks C.

**So the option chosen is the diagnosis.** Pass/fail discards the entire reason the item was built that way.

Three distinctions the tutor needs at answer time:

**Which option** — not just whether it was right.

**"I don't know" as a third outcome, not a wrong answer.** Not knowing and holding a confident wrong model need opposite responses — one needs teaching, the other a specific correction. Collapsing them loses the difference at the only moment it's cleanly observable.

**Confidence at commitment**, where it's cheap to collect. Errors made with *high* confidence are more likely to be corrected afterward, not less — so confidence × correctness classifies the error at capture time far more reliably than inferring it later.

Anything else cheap to capture is welcome. Latency, revision behaviour, time-to-first-keystroke — the tutor will find uses for signal it doesn't currently know it wants.

**One with a deadline:** if a wrong answer is a wrong *method* rather than a wrong result, record **which method** was misapplied. Low value now, unrecoverable later — it's the raw material for measuring which topics actually get confused with which, a metric that doesn't exist off the shelf and has to be built from response history. Answers recorded without it are permanently unusable for that.

---

## 5. Scheduling — intervals as a function

**You own scheduling. The tutor never schedules.** It supplies a target and a reason; when the item resurfaces is your call.

What it supplies is a **ratio of a retention interval**, not a fixed gap. The well-replicated finding (Cepeda et al. 2008) is that the optimal first gap is ~20–40% of how long the material needs to last, dropping to 5–10% for year-long targets:

| Needs to last until | Optimal first gap |
|---|---|
| Tomorrow's quiz | hours |
| A test in two weeks | 3–6 days |
| A final in three months | 2.5–5 weeks |
| Next spring's follow-on course | months |

The retention target comes from the engine, which publishes assessment dates. The tutor reads them and hands you an interval.

**Two things to design around:**

**A section usually has more than one retention target** — Thursday's chapter test *and* December's cumulative final. Averaging them produces the standard cram failure. The tutor's working rule is that the far target sets the schedule and the near one adds an extra pass, but the right handling is a retention question and therefore yours.

**Sub-floor probes are normal, not errors.** The tutor enforces a separate overnight floor on its own side, governing whether a probe may *promote a claim* — a probe two hours after teaching measures working memory, not retention, whatever the schedule says. That needs nothing from you. But it means you'll sometimes be asked to schedule something a few hours out, and that's intentional: it still runs, still yields signal, it just can't advance anything.

**Stale vs. never-had-it must stay distinguishable.** A failure on something previously passed means *resurface it sooner*. A failure on something never learned means *go teach it*. The tutor explicitly classifies retrieval failures as **not its problem** — they're yours — so it needs to know which it's looking at.

**A retention model can come later.** Simple scheduling against a supplied interval is usable immediately; FSRS or an equivalent improves it. Sequenced last for that reason, not because it doesn't matter.

---

## 6. Retrospective audit — covering a hole nothing else can

This one needs its justification, because it looks like scope creep for a testing app and isn't.

**Most items in this system will be LLM-authored**, and the literature on that is uncomfortable. AI-written multiple-choice items leak the answer through surface cues — the correct option repeats stem words in roughly **80% of items versus 35%** for teacher-written ones, and the correct option tends to be longest. There's a measurable accuracy gap exploitable from option length alone.

The nasty part: **neither human raters nor AI models can reliably distinguish AI-written items from human-written ones by inspection.** The flaw is invisible. Ben answers correctly, the system records that he knows it, and what was measured was reading comprehension.

The standard fix is a human reviewer. **This system's only human is Ben**, who can't review a question he's about to answer — and passive human review of AI drafts has been shown to *increase* item flaws rather than reduce them.

So the check has to be **retrospective and statistical**, which is exactly what you're positioned to do and nothing else is:

- **Which distractors nobody ever picks.** A dead distractor means the item is easier than it looks and its difficulty is wrong.
- **Which items fail to separate knowing from not-knowing.** No discrimination, or negative discrimination, means noise.
- **Whether tutor-authored items pass at higher rates than textbook-sourced items of matched difficulty.** This is the one that catches leakage — invisible per-item, visible in aggregate. It's why §2 asks for provenance.
- **Retiring what's broken**, automatically.

The tutor sees one answer at a time. You see the distribution.

---

## 7. Identity — what an item points at

Your tags and subtags may already be most of this. The question is what convention makes them carry it.

**The join key across the whole system:**

```
(textbook_slug, section)     e.g. ("ebbing11e", "15.6")
```

Strings, never floats — `"8.10" ≠ 8.1` and they don't sort lexically. **Deliberately no course and no term:** retention and content are term-independent, so a section a follow-on course revisits next spring is the *same thing* with the same retention state. Putting a course or term in the key breaks the thing the project exists for.

Two ways the tutor needs this to stretch:

**Finer than a section.** The tutor works at *node* grain — one teachable idea, several per section. "Knows §8.3" isn't decomposable and so can't be usefully wrong; "can apply §8.3 but can't tell it apart from §8.4" is the failure that wrecks a cumulative final. Node keys are minted by the tutor and are stable strings — mycelium's extracted terms turned out to shift between extraction runs, so they're a hint rather than an identifier.

**Wider than a textbook.** A stated goal is that this teaches things with no course attached — an advanced CS or maths topic Ben picks up alone. Those have no `textbook_slug`. The tutor's guess is a learner-named topic slug in the same position, but that's a guess.

**The question:** what does an item need to point at, such that a section revisited in a different course next year is the same thing, a node inside a section is addressable, and a self-directed topic fits the same shape? If your existing tag hierarchy handles it with a convention, that's better than a new scheme.

---

## 8. What the tutor promises

- **Never schedules.** Supplies retention targets and reasons; when is yours.
- **Never models decay.** Entirely yours.
- **Never reaches around you** to store items or track retention itself.
- **Tags what it sends** — target, error under test, provenance — so §6 is possible.
- **Treats your outcomes as authority** on retention, including when they contradict its own confidence. Calibrating tutor claims against your results is one of the few external checks on a system that would otherwise grade its own homework.

---

## 9. Degradation, if you want to know what's at stake

What the tutor loses at each stage, so partial delivery is plannable:

| Missing | Consequence |
|---|---|
| Live I/O (§1) | Everything below. Free-response only |
| App delivery (§3) | No multiple-choice at all, and no rendered/graphed items. Chat free-response only, which is the compromise §3 exists to remove |
| Rich outcomes (§4) | Error classification degrades to inference from free text. Diagnosis is the tutor's whole job, so this is the sharpest loss |
| Scheduling (§5) | Claims cap at `can_apply`. Nothing advances. The system becomes a good conversation with a memory |
| Audit (§6) | Nothing fails immediately — item quality degrades silently, which is worse in a specific way: the data accumulating in the meantime is suspect and there's no way to tell how much |

---

## 10. Counter-proposals expected

Several of the above are the tutor guessing at things you're better placed to decide — identity, how multiple retention targets resolve, what's cheap to capture at answer time, whether a retention model should come earlier than §7 suggests.

**If a request is wrong for your architecture, the right response is a counter-proposal, not compliance.** The boundary rule cuts both ways: the tutor doesn't get to specify your internals any more than you get to specify its pedagogy. The engine chat pushed back on one of these requests and was right, and the spec is better for it.

The two most useful things to send back: **a scope estimate on §1**, and **whether your tag hierarchy can carry §7 with a convention.** Everything else can follow.
