# Testing the Matcher with Bryan and Kai

Test three things separately: the encoder, feature construction, and the final
learned ranking. A working matrix multiplication is not evidence of good matches.

Ready-to-review packets from the broader-data experiment:

- [40 training cases, blind](../data/generated/coverage-v2-01/review-training.md)
- [40 challenge cases, blind](../data/generated/coverage-v2-01/review-challenge.md)

Each has a companion JSONL for individual judgments. Do not open the separate
draft answer key or model results until Bryan and Kai have reviewed independently.
All labels remain synthetic drafts until actual human review. Generated files are
local and gitignored; they are not automatically available on Kai's laptop.

## 1. Inspect a Known Pair

The local report `artifacts/italy-inspection.md` shows Jane's two selected facts
against John's three selected facts. That gives six cosine values, not one
similarity per person. The inspector also prints the 71 inputs and the saved
network's score. Reproduce it using the command in `ml/README.md`.

Observed example (not invented scores):

| Comparison | Cosine |
| --- | ---: |
| Jane's affordable Italy aspiration fact vs John's train-and-hostel experience | 0.7911 |
| Jane's regional food interest vs John's regional food/independent travel interest | 0.7303 |
| Jane's Italy aspiration fact vs John's general regional food/travel interest | 0.3439 |

The final Jane -> John research score was 0.2820, below the pilot's 0.5 threshold,
despite the intended positive annotation. Do not change the annotation just to
agree with the model or tune on this case and continue to call it held out.
The vector components and cosine values are not probabilities or consent.

## 2. Agree on Expectations Before Running

Independently annotate 30-50 varied fictional pairs. Preserve detail, source
support, current intent, and explicit willingness. Discuss disagreements before
looking at model outputs. Write labels as positive, supported mismatch, or
unknown; missing information is not a negative.

| Case | What we should check |
| --- | --- |
| Same meaning, different words | A paraphrase should not radically change ranking. |
| Shared keyword, different goal | Italy travel advice should not match a football-only conversation just because both mention Italy. |
| Experience complements aspiration | A willing experienced traveler should be useful to someone explicitly seeking firsthand advice. |
| Two beginners | Could be positive for learning together, but unknown for a request for firsthand experience. |
| A new specific interest added | One relevant connection should not disappear because profiles contain other interests. |
| No connected social account | Onboarding facts alone should still support a match. |
| Explicit preference history | Compare otherwise similar candidates with different styles; useful past feedback should matter when relevant to today's context. |
| Missing or unrelated feedback | A missing rating must not become a dislike; unrelated historical interests should not dominate. |
| Unapproved social extraction | The fact must be absent from the features and inspection text. |
| Boundary, missing openness, or insufficient facts | The current offline scorer must abstain. |

Behavioral expectations are hypotheses to measure, not guarantees of this early
checkpoint. Some will currently fail. Record failures rather than adjusting
thresholds until every example appears to pass.

## 3. Change One Thing at a Time

Keep a base fictional case and a separate copy with one controlled change. When
changing a fact, also update its synthetic source answer/caption and quote so
the evidence remains truthful. When changing a goal, keep its onboarding answer
and normalized profile goal consistent. Do not override approval or call real
posts synthetic to make validation pass.

Inspect each case separately using `python -m ml.inspect_pair --dataset ...`.
Compare selected facts, role flags, individual similarities, history features,
and final scores. For invariance cases such as adding a duplicate fact, expect
unchanged features. For preference cases, inspect ranking changes rather than
demanding an arbitrary score like 0.9. A high cosine alone cannot distinguish
"visited" from "wants to visit" reliably; inspect the role fields too.

## 4. Protect the Evaluation Set

Keep all versions of a person, related scenario variants, and historical partners
in one split. Do not use the same sentence templates to claim independent
generalization. Reserve newly written families for final evaluation before
training. Data used to discover a failure becomes development data if we tune
against it; create a fresh held-out set afterward.

Compare neural results to the cosine and logistic baselines. Look at false
positives, held-out ranking, subgroup coverage (onboarding-only/history-missing),
and the effect of posts/history on identical cases. Do not claim personalized
matching unless cases actually require personal history and the history-enabled
model improves on those cases without compromising boundaries.

## 5. Keep Engineering Tests Separate

```bash
.venv-ml/bin/python -m pytest ml/tests -q
```

These tests check schema/ownership/time validation, exclusion of unapproved
facts, duplicate handling, split leakage, feature consistency, and checkpoint
reloads. Their deterministic encoder test double tests the code, not real
semantic quality. The inspection report above was run separately with the real
MiniLM encoder and actual saved checkpoint.

No real-world matching quality, social-platform integration, consent flow, badge
behavior, or Quest tracking has been validated by these offline tests.
