"""Build fictional, evidence-backed records without changing the v2 contract."""

from .validation import require


def fact(topic, role, details, source="answer"):
    return {"topic": topic, "role": role, "details": details, "source": source}


class DatasetBuilder:
    def __init__(self, dataset_id, seed):
        self.bundle = {"schema_version": 2, "dataset_id": dataset_id,
                       "training_basis": "synthetic_only", "profiles": [], "posts": [],
                       "feedback": [], "training_pairs": []}
        self.manifest = {"version": 1, "dataset_id": dataset_id, "seed": seed,
                         "user_groups": {}, "group_splits": {},
                         "limitation": "Synthetic draft judgments, not human outcomes. Training/validation use generated templates; test profiles are separately authored by the same assistant. No independent human validation."}
        self.cases = {}

    def profile(self, group, split, key, facts, goal, openness, preferences=()):
        user = group + "_" + key
        require(user not in self.manifest["user_groups"], "Duplicate synthetic user")
        require(group not in self.manifest["group_splits"] or
                self.manifest["group_splits"][group] == split, "Scenario crosses splits")
        self.manifest["user_groups"][user] = group
        self.manifest["group_splits"][group] = split
        profile = {"profile_version_id": user + "_v1", "user_id": user,
                   "data_origin": "synthetic", "valid_from": "2026-09-20T09:00:00Z",
                   "onboarding_answers": [], "current_goal": goal, "conversation_intent": goal,
                   "facts": [], "open_to_discussing": list(openness),
                   "conversation_preferences": list(preferences), "avoid_topics": []}

        def answer(key, question, text):
            ref = user + "_" + key
            profile["onboarding_answers"].append({"answer_id": ref,
                "question_key": question, "question_text": "What would you like to share?",
                "answer_text": text, "answered_at": "2026-09-20T08:00:00Z"})
            return ref

        for i, spec in enumerate(facts):
            text = spec["details"]
            source = spec.get("source", "answer")
            require(source in ("answer", "post"), "Unknown synthetic evidence source")
            require(spec["role"] != "can_share" or source == "answer",
                    "Willingness must be stated explicitly, not inferred from a post")
            if source == "post":
                ref = user + f"_post_{i}"
                self.bundle["posts"].append({"post_id": ref, "owner_user_id": user,
                    "data_origin": "synthetic", "posted_at": "2026-09-18T08:00:00Z",
                    "available_at": "2026-09-19T08:00:00Z", "caption": text, "image_ref": None})
            else:
                ref = answer(f"fact_{i}", "interests", text)
            profile["facts"].append({"fact_id": user + f"_fact_{i}", "topic": spec["topic"],
                "relationship": spec["role"], "details": text, "motivation": None,
                "evidence": [{"source_type": "owned_post" if source == "post" else "onboarding_answer",
                              "reference_id": ref, "channel": "caption" if source == "post" else "self_report",
                              "support": text}],
                "confirmation": "confirmed", "matching_allowed": True,
                "sharing_scope": "after_mutual_consent"})
        if goal:
            answer("goal", "goals", goal)
        if openness:
            answer("openness", "open_topics", " | ".join(openness))
        if preferences:
            answer("preferences", "conversation_style", " | ".join(preferences))
        self.bundle["profiles"].append(profile)
        return profile

    def feedback(self, viewer, candidate, context, useful, again, *, accepted=True):
        ref = f"feedback_{len(self.bundle['feedback']):04d}"
        self.bundle["feedback"].append({"feedback_id": ref, "data_origin": "synthetic",
            "viewer_profile_version_id": viewer["profile_version_id"],
            "candidate_profile_version_id": candidate["profile_version_id"],
            "observed_at": "2026-09-22T12:00:00Z", "context": context,
            "outcomes": {"connection_accepted": accepted, "conversation_useful": useful,
                         "would_talk_again": again},
            "explicit_comment": "Fictional rating for a controlled research example."})
        return ref


    def pair(self, viewer, candidate, mode, goal, label, reason, case, history=()):
        group = self.manifest["user_groups"][viewer["user_id"]]
        ref = f"{group}_pair_{len(self.bundle['training_pairs']):04d}"
        rubric = dict.fromkeys(("topic_fit", "intent_fit", "specific_bridge", "evidence_sufficient"), "yes")
        if label == 0:
            rubric["intent_fit"] = "no"
            rubric["specific_bridge"] = "no"
        elif label is None:
            rubric.update(intent_fit="unknown", specific_bridge="unknown", evidence_sufficient="unknown")
        self.bundle["training_pairs"].append({"example_id": ref, "data_origin": "synthetic",
            "as_of": "2026-09-25T12:00:00Z", "viewer_profile_version_id": viewer["profile_version_id"],
            "candidate_profile_version_id": candidate["profile_version_id"],
            "prior_feedback_ids": list(history), "context": {"mode": mode, "goal": goal},
            "label": {"relevant_connection": label, "source": "synthetic_draft",
                      "human_reviewed": False, "rubric": rubric, "reason": reason}})
        # Review categories are sidecar metadata, never prediction inputs.
        self.cases[ref] = {"family": group, "case": case,
                           "split": self.manifest["group_splits"][group]}
        return ref


def add_history_family(builder, group, split, topic, experience, styles, suffix="history"):
    """Paired viewers have identical non-history features, opposite earlier ratings."""
    goal = f"Find a conversation about {topic} in the format of the sessions I previously rated useful."
    people = {}
    for key in ("viewer_a", "viewer_b"):
        people[key] = builder.profile(group, split, suffix + "_" + key,
            [fact(topic, "interested", f"I enjoy {topic} and want another discussion.")], goal, [topic, goal])
    for key, style in (("a", styles[0]), ("b", styles[1])):
        for when in ("past", "now"):
            people[when + key] = builder.profile(group, split, suffix + "_" + when + key,
                [fact(topic, "experienced", experience),
                 fact(topic, "can_share", f"I am happy to explain my experience with {topic}.")],
                f"Talk with someone about {topic} and share what I have learned.", [topic], [style])
    for viewer_key, preferred in (("viewer_a", "a"), ("viewer_b", "b")):
        viewer = people[viewer_key]
        history = [builder.feedback(viewer, people["past" + key], goal, key == preferred, key == preferred)
                   for key in ("a", "b")]
        for key in ("a", "b"):
            builder.pair(viewer, people["now" + key], "learn", goal, int(key == preferred),
                "Draft conditional judgment: the viewer explicitly requests the format of useful past sessions; these fictional ratings distinguish the two formats. This is not evidence of actual human compatibility.",
                "history_counterfactual", history)
    return people
