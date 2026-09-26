"""Pinned local textual entailment: source quotes -> a confirmed experience claim."""

import hashlib
import json
import time

import torch

from .validation import require

MODEL_ID = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
MODEL_REVISION = "eb8b17b1983bca679126ea69b12b5d28c5fe9b9a"
LABELS = {0: "entailment", 1: "neutral", 2: "contradiction"}


class EvidenceVerifier:
    def __init__(self, *, device="cpu", max_tokens=512, max_quotes=16):
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        require(device in ("cpu", "cuda", "mps"), "Unsupported evidence device")
        require(device != "cuda" or torch.cuda.is_available(), "CUDA unavailable")
        require(device != "mps" or torch.backends.mps.is_available(), "Apple GPU unavailable")
        require(16 <= max_tokens <= 512 and max_quotes > 0, "Invalid evidence input limits")
        self.device, self.max_tokens, self.max_quotes = device, max_tokens, max_quotes
        self.cache = {}
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION,
            local_files_only=True, token=False, trust_remote_code=False, use_fast=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, revision=MODEL_REVISION,
            local_files_only=True, token=False, trust_remote_code=False, use_safetensors=True,
            dtype=torch.float32).to(device).eval()
        self.model.requires_grad_(False)
        require(self.model.config.id2label == LABELS, "Unexpected entailment label order")

    def metadata(self):
        return {"id": MODEL_ID, "revision": MODEL_REVISION, "device": self.device,
                "dtype": "float32", "max_tokens": self.max_tokens, "max_quotes": self.max_quotes,
                "labels": LABELS, "weights_frozen": True, "network_inference": False,
                "warning": "Textual support, not verification of real-world truth or expertise."}

    def check(self, claim, quotes):
        require(isinstance(claim, str) and claim.strip(), "Evidence claim cannot be blank")
        require(isinstance(quotes, list) and all(isinstance(q, str) and q.strip() for q in quotes),
                "Evidence quotes must be nonempty text")
        quotes = list(dict.fromkeys(quotes))
        key = hashlib.sha256(json.dumps([claim, quotes], ensure_ascii=True).encode()).hexdigest()
        started = time.perf_counter()
        if key in self.cache:
            return {**self.cache[key], "cache_hit": True, "elapsed_seconds": time.perf_counter() - started}
        result = {"support_score": None, "contradiction_score": None, "quote_scores": [],
                  "abstain_reason": None, "input_sha256": key, "cache_hit": False}
        if not quotes or len(quotes) > self.max_quotes:
            result["abstain_reason"] = "evidence_quote_limit"
        else:
            for quote in quotes:
                # No truncation: dropping a qualification or negation is not acceptable.
                tokens = self.tokenizer(quote, claim, truncation=False, return_tensors="pt")
                if tokens["input_ids"].shape[1] > self.max_tokens:
                    result["abstain_reason"] = "evidence_exceeds_token_limit"
                    break
                with torch.inference_mode():
                    logits = self.model(**{k: v.to(self.device) for k, v in tokens.items()}).logits.float()
                    if logits.shape != (1, 3) or not torch.isfinite(logits).all():
                        result["abstain_reason"] = "invalid_evidence_logits"
                        break
                    values = torch.softmax(logits, dim=-1)[0].tolist()
                result["quote_scores"].append(dict(zip(LABELS.values(), values)))
            if result["abstain_reason"] is None:
                result["support_score"] = max(p["entailment"] for p in result["quote_scores"])
                result["contradiction_score"] = max(p["contradiction"] for p in result["quote_scores"])
        result["elapsed_seconds"] = time.perf_counter() - started
        self.cache[key] = result
        return dict(result)
