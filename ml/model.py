"""Small directional relevance head over frozen semantic comparison features."""

import copy
import random

import numpy as np
import torch
from torch import nn

from .validation import require


class Matcher(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.network = nn.Sequential(nn.Linear(input_dim, 64), nn.ReLU(), nn.Dropout(0.1),
                                     nn.Linear(64, 16), nn.ReLU(), nn.Linear(16, 1))

    def forward(self, features):
        return self.network(features).squeeze(-1)


def fit(x_train, y_train, x_val, y_val, device="cpu", seed=42, epochs=100, patience=12, batch_size=32):
    require(epochs > 0 and patience > 0 and batch_size > 0, "Training limits must be positive")
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if device == "cuda":
        require(torch.cuda.is_available(), "CUDA requested but unavailable; refusing silent CPU fallback")
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)
    model = Matcher(x_train.shape[1]).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-3)
    loss_fn = nn.BCEWithLogitsLoss()
    tx, ty = torch.tensor(x_train, device=device), torch.tensor(y_train, dtype=torch.float32, device=device)
    vx, vy = torch.tensor(x_val, device=device), torch.tensor(y_val, dtype=torch.float32, device=device)
    best, best_epoch, stale, best_state = float("inf"), 0, 0, None
    log = []
    generator = torch.Generator().manual_seed(seed)
    for epoch in range(1, epochs + 1):
        model.train()
        total = 0.0
        for ids in torch.randperm(len(tx), generator=generator).split(batch_size):
            ids = ids.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(tx[ids]), ty[ids])
            require(torch.isfinite(loss).item(), "Nonfinite training loss")
            loss.backward()
            optimizer.step()
            total += loss.item() * len(ids)
        model.eval()
        with torch.inference_mode():
            validation_loss = loss_fn(model(vx), vy).item()
        require(np.isfinite(validation_loss), "Nonfinite validation loss")
        log.append({"epoch": epoch, "training_loss": total / len(tx), "validation_loss": validation_loss})
        if validation_loss < best - 1e-5:
            best, best_epoch, stale = validation_loss, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            stale += 1
        if stale >= patience:
            break
    model.load_state_dict(best_state)
    model.eval()
    return model, {"best_epoch": best_epoch, "best_validation_loss": best, "epochs": log}


def predict_scores(model, features, device="cpu"):
    model.eval()
    with torch.inference_mode():
        return torch.sigmoid(model(torch.tensor(features, dtype=torch.float32, device=device))).cpu().numpy()
