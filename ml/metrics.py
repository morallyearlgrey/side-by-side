"""Validation-selected thresholds and query-level ranking metrics."""

from collections import defaultdict

import numpy as np
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score, log_loss,
                             ndcg_score, precision_score, recall_score, roc_auc_score)


def choose_threshold(labels, scores):
    candidates = np.unique(np.concatenate(([0.5], scores)))
    return float(max(candidates, key=lambda threshold: (
        f1_score(labels, scores >= threshold, zero_division=0),
        precision_score(labels, scores >= threshold, zero_division=0),
        -abs(threshold - 0.5))))


def evaluate(pairs, labels, scores, threshold):
    predictions = scores >= threshold
    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    result = {"examples": len(labels), "positives": int(sum(labels)), "threshold": threshold,
              "f1": float(f1_score(labels, predictions, zero_division=0)),
              "precision": float(precision_score(labels, predictions, zero_division=0)),
              "recall": float(recall_score(labels, predictions, zero_division=0)),
              "false_positive_rate": float(matrix[0, 1] / max(1, matrix[0].sum())),
              "confusion_matrix_tn_fp_fn_tp": matrix.ravel().tolist(),
              "log_loss": float(log_loss(labels, np.clip(scores, 1e-7, 1 - 1e-7), labels=[0, 1])),
              "roc_auc": float(roc_auc_score(labels, scores)) if len(set(labels)) > 1 else None,
              "average_precision": float(average_precision_score(labels, scores)) if sum(labels) else None}
    queries = defaultdict(list)
    for i, pair in enumerate(pairs):
        key = (pair["viewer_profile_version_id"], pair["as_of"], pair["context"]["mode"], pair["context"]["goal"])
        queries[key].append(i)
    ndcg, sizes = [], []
    for ids in queries.values():
        # All-positive pools cannot test discrimination. Unknown labels are never negatives.
        if len(ids) > 1 and len(set(labels[ids])) > 1:
            ndcg.append(ndcg_score([labels[ids]], [scores[ids]], k=3))
            sizes.append(len(ids))
    result["ranking"] = {"ndcg_at_3": float(np.mean(ndcg)) if ndcg else None,
                         "eligible_queries": len(ndcg), "total_queries": len(queries),
                         "mean_candidate_pool": float(np.mean(sizes)) if sizes else None}
    return result
