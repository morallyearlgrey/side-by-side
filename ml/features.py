"""One feature path for both fitting and scoring. Labels never enter it."""

import re
import unicodedata

import numpy as np

from .validation import require

ENCODER_ID = "sentence-transformers/all-MiniLM-L6-v2"
FEATURE_VERSION = "directional-semantic-v1"
ROLES = ("interested", "experienced", "wants_to_try", "learning", "can_share")
MODES = ("learn", "share", "exchange_stories", "collaborate", "find_activity_partner", "casual_chat")
ABLATIONS = ("onboarding_only", "with_posts", "with_history")
HISTORY_CHANNELS = (("conversation_useful", True), ("conversation_useful", False),
                    ("would_talk_again", True), ("would_talk_again", False))


def normalized(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def fact_text(fact):
    return ". ".join(value for value in
                     (fact["topic"], fact["details"], fact["motivation"]) if value)


def approved_facts(profile, mode):
    seen = set()
    result = []
    for fact in profile["facts"]:
        if fact["confirmation"] != "confirmed" or not fact["matching_allowed"]:
            continue
        # A mixed-evidence fact may depend on the post. Do not leak it into the ablation.
        if mode == "onboarding_only" and any(e["source_type"] == "owned_post" for e in fact["evidence"]):
            continue
        key = (fact["relationship"], normalized(fact_text(fact)))
        if key not in seen:
            result.append(fact)
            seen.add(key)
    return sorted(result, key=lambda f: (f["relationship"], normalized(fact_text(f))))


def eligibility_reason(viewer, candidate, mode):
    # Free-text boundaries cannot safely be interpreted by a similarity threshold.
    if viewer["avoid_topics"] or candidate["avoid_topics"]:
        return "boundary_review_required"
    if not candidate["open_to_discussing"]:
        return "candidate_openness_missing"
    if not approved_facts(viewer, mode) or not approved_facts(candidate, mode):
        return "insufficient_approved_facts"
    return None


def feature_names():
    names = [f"role_cosine:{a}:{b}" for a in ROLES for b in ROLES]
    names += [f"{side}_has:{role}" for side in ("viewer", "candidate") for role in ROLES]
    names += [f"mode:{mode}" for mode in MODES]
    names += ["goal_candidate_max", "goal_candidate_top3_mean", "facts_cross_max",
              "candidate_intent_viewer_max", "preference_cosine", "openness_cosine",
              "viewer_intent_present", "candidate_intent_present", "viewer_preferences_present",
              "candidate_preferences_present", "viewer_facts_present", "candidate_facts_present",
              "viewer_openness_present", "candidate_openness_present"]
    for outcome, value in HISTORY_CHANNELS:
        names += [f"history:{outcome}:{value}:{kind}" for kind in
                  ("similarity", "preference_similarity", "context_fit", "present")]
    return names


class TextEncoder:
    def __init__(self, device="cpu", revision="main", batch_size=32):
        from huggingface_hub import HfApi
        from sentence_transformers import SentenceTransformer

        self.revision = revision if re.fullmatch(r"[0-9a-f]{40}", revision) else HfApi().model_info(
            ENCODER_ID, revision=revision, token=False).sha
        self.model = SentenceTransformer(
            ENCODER_ID, revision=self.revision, device=device, trust_remote_code=False,
            token=False, model_kwargs={"use_safetensors": True})
        self.model.max_seq_length = 256
        self.model.eval()
        self.batch_size = batch_size
        self.dimension = self.model.get_sentence_embedding_dimension()
        self.cache = {"": np.zeros(self.dimension, dtype=np.float32)}

    def encode(self, texts):
        missing = sorted(set(texts) - self.cache.keys())
        if missing:
            vectors = self.model.encode(missing, batch_size=self.batch_size,
                                        normalize_embeddings=True, convert_to_numpy=True,
                                        show_progress_bar=False)
            self.cache.update(zip(missing, vectors))
        return np.asarray([self.cache[text] for text in texts], dtype=np.float32)

    def metadata(self):
        return {"id": ENCODER_ID, "revision": self.revision, "dimension": self.dimension,
                "max_seq_length": 256, "normalize_embeddings": True}


class FeatureBuilder:
    def __init__(self, bundle, encoder, mode="with_history", top_k=6):
        require(mode in ABLATIONS, "Unknown feature ablation")
        require(top_k > 0, "top_k must be positive")
        self.profiles = {p["profile_version_id"]: p for p in bundle["profiles"]}
        self.feedback = {h["feedback_id"]: h for h in bundle["feedback"]}
        self.encoder = encoder
        self.mode = mode
        self.top_k = top_k

    def vector(self, text):
        return self.encoder.encode([text or ""])[0]

    def select(self, profile, query):
        facts = approved_facts(profile, self.mode)
        if not facts:
            return [], np.empty((0, self.encoder.dimension), dtype=np.float32)
        embeddings = self.encoder.encode([fact_text(f) for f in facts])
        order = np.argsort(-(embeddings @ query), kind="stable")[:self.top_k]
        return [facts[i] for i in order], embeddings[order]

    def intent(self, profile, goal=None):
        return " | ".join(dict.fromkeys(value for value in
                          (goal, profile["current_goal"], profile["conversation_intent"]) if value))

    def warm(self, pairs):
        texts = {""}
        for profile in self.profiles.values():
            texts.update(fact_text(f) for f in approved_facts(profile, self.mode))
            texts.add(self.intent(profile))
            texts.add(" | ".join(profile["conversation_preferences"]))
            texts.add(" | ".join(profile["open_to_discussing"]))
        for pair in pairs:
            texts.add(self.intent(self.profiles[pair["viewer_profile_version_id"]], pair["context"]["goal"]))
        texts.update(h["context"] for h in self.feedback.values())
        self.encoder.encode(sorted(texts))

    def build(self, pair):
        viewer = self.profiles[pair["viewer_profile_version_id"]]
        candidate = self.profiles[pair["candidate_profile_version_id"]]
        viewer_intent = self.intent(viewer, pair["context"]["goal"])
        candidate_intent = self.intent(candidate)
        query = self.vector(viewer_intent)
        vf, ve = self.select(viewer, query)
        cf, ce = self.select(candidate, query)
        values = []
        for a in ROLES:
            va = ve[[i for i, fact in enumerate(vf) if fact["relationship"] == a]]
            for b in ROLES:
                cb = ce[[i for i, fact in enumerate(cf) if fact["relationship"] == b]]
                values.append(float((va @ cb.T).max()) if len(va) and len(cb) else 0.0)
        values.extend(float(any(f["relationship"] == role for f in facts))
                      for facts in (vf, cf) for role in ROLES)
        values.extend(float(pair["context"]["mode"] == mode) for mode in MODES)
        goal_scores = np.sort(ce @ query)[::-1] if len(ce) else np.array([])
        preferences = [" | ".join(p["conversation_preferences"]) for p in (viewer, candidate)]
        openness = [" | ".join(p["open_to_discussing"]) for p in (viewer, candidate)]
        values.extend([
            float(goal_scores[0]) if len(goal_scores) else 0.0,
            float(goal_scores[:3].mean()) if len(goal_scores) else 0.0,
            float((ve @ ce.T).max()) if len(ve) and len(ce) else 0.0,
            float((ve @ self.vector(candidate_intent)).max()) if len(ve) else 0.0,
            float(self.vector(preferences[0]) @ self.vector(preferences[1])),
            float(self.vector(openness[0]) @ self.vector(openness[1])),
            *map(float, (bool(viewer_intent), bool(candidate_intent), bool(preferences[0]),
                         bool(preferences[1]), bool(vf), bool(cf), bool(openness[0]), bool(openness[1])))
        ])
        for outcome, expected in HISTORY_CHANNELS:
            similarities, styles, relevance = [], [], []
            if self.mode == "with_history":
                # Validation enforces ownership/time; acceptance and absent ratings are not dislikes.
                for ref in pair["prior_feedback_ids"]:
                    history = self.feedback[ref]
                    if history["outcomes"][outcome] is not expected:
                        continue
                    old_candidate = self.profiles[history["candidate_profile_version_id"]]
                    context = self.vector(history["context"])
                    _, old_vectors = self.select(old_candidate, context)
                    if len(ce) and len(old_vectors):
                        weight = max(0.0, float(query @ context))
                        similarities.append(float((ce @ old_vectors.T).max()) * weight)
                        old_style = self.vector(" | ".join(old_candidate["conversation_preferences"]))
                        styles.append(float(self.vector(preferences[1]) @ old_style) * weight)
                        relevance.append(weight)
            values.extend([max(similarities, default=0.0), max(styles, default=0.0),
                           max(relevance, default=0.0), float(bool(similarities))])
        result = np.asarray(values, dtype=np.float32)
        require(result.shape == (len(feature_names()),) and np.isfinite(result).all(), "Invalid feature vector")
        return result

    def matrix(self, pairs):
        self.warm(pairs)
        return np.stack([self.build(pair) for pair in pairs])
