import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { BATCH_LIMIT } from "../shared/pilot.mjs";
import { EXPERIENCE_OPTIONS, FIELDS } from "../shared/form.mjs";
import "./dashboard.css";

const stamp = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function Dashboard() {
  const [session, setSession] = useState(null),
    [preview, setPreview] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [tab, setTab] = useState("responses"),
    [data, setData] = useState(null),
    [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState({}),
    [matchRun, setMatchRun] = useState(null),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const controllers = useRef(new Set()),
    generation = useRef(0),
    details = useRef(null);
  const ids = Object.keys(selected);

  function signOut(message = "") {
    generation.current += 1;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    setSession(null);
    setData(null);
    setDetail(null);
    setSelected({});
    setMatchRun(null);
    setPassword("");
    setSearch("");
    setQuery("");
    setPage(1);
    setBusy(false);
    setLoading(false);
    setError(message);
    setNotice("");
  }
  async function request(
    action,
    { body, token = session?.access_token, signal } = {},
  ) {
    const controller = new AbortController();
    controllers.current.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 15000);
    try {
      const response = await fetch(`/api/admin?${action}`, {
        method: body === undefined ? "GET" : "POST",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (token && [401, 403].includes(response.status))
          signOut("Your organizer session ended. Sign in again.");
        throw new Error(result.error || "The request could not be completed.");
      }
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controllers.current.delete(controller);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((c) => setPreview(c.mode === "preview"))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => signOut("For your privacy, please sign in again."),
      session.expires_in * 1000,
    );
    const leave = () => signOut();
    window.addEventListener("pagehide", leave);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", leave);
    };
  }, [session]);
  useEffect(() => {
    if (!session || tab !== "responses") return;
    const controller = new AbortController(),
      current = generation.current;
    setLoading(true);
    setError("");
    setData(null);
    setDetail(null);
    request(
      `action=responses&page=${page}&search=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted && current === generation.current)
          setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === generation.current)
          setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [session, page, query, refresh, tab]);
  useEffect(() => {
    if (detail && window.matchMedia("(max-width: 760px)").matches)
      details.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [detail]);
  useEffect(() => {
    if (!session || tab !== "matching" || preview) return;
    let active = true;
    const refreshReadiness = () =>
      request("action=session")
        .then((result) => {
          if (active)
            setSession((current) => current && { ...current, matching: result.matching });
        })
        .catch(() => {});
    refreshReadiness();
    const timer = setInterval(refreshReadiness, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.access_token, tab, preview]);
  useEffect(() => {
    if (
      !session || preview || !matchRun?.batch_id ||
      !["pending", "running"].includes(matchRun.status)
    ) return;
    let active = true;
    const poll = () =>
      request(`action=batch-status&id=${encodeURIComponent(matchRun.batch_id)}`)
        .then((result) => {
          if (active) setMatchRun((current) => current?.batch_id === result.batch_id
            ? { ...current, ...result }
            : current);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.access_token, preview, matchRun?.batch_id, matchRun?.status]);

  async function login(event, demo = false) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const result = demo
        ? await request("action=session", { token: "fictional-preview-only" })
        : await request("action=login", {
            body: { email, password },
            token: null,
          });
      if (current === generation.current)
        setSession(
          demo
            ? {
                ...result,
                access_token: "fictional-preview-only",
                expires_in: 900,
              }
            : result,
        );
    } catch (e) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setPassword("");
      }
    }
  }
  function toggle(row) {
    setNotice("");
    setSelected((current) => {
      const next = { ...current };
      if (next[row.receipt_id]) delete next[row.receipt_id];
      else if (Object.keys(next).length < BATCH_LIMIT && row.eligible)
        next[row.receipt_id] = row.payload.answers.display_name;
      return next;
    });
  }
  async function batch() {
    setBusy(true);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      const result = await request("action=batch", { body: { ids } });
      if (current !== generation.current) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `sidebyside-private-batch-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "Private batch downloaded. No inference was run. Keep it with the project team.",
      );
    } catch (e) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function runMatching() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request("action=match", { body: { ids } });
      setMatchRun({
        ...result,
        names: Object.fromEntries(Object.entries(selected)),
      });
      setNotice("The private model worker is scoring the selected answers.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dashboard">
      <header className="dash-header">
        <a href="/" className="dash-brand">
          <img src="/art/lunar-light.jpg" alt="" />
          sidebyside<span>.</span>
        </a>
        <span className="dash-private">
          <LockKeyhole size={14} /> Organizer / Private pilot
        </span>
        {session && (
          <button
            className="dash-icon"
            title="Sign out"
            aria-label="Sign out"
            onClick={() => signOut()}
          >
            <LogOut size={19} />
          </button>
        )}
      </header>
      {preview && (
        <p className="dash-demo">
          Fictional preview. No real responses, account access, or model calls.
        </p>
      )}
      {!session ? (
        <main className="dash-login">
          <span className="dash-kicker">The people behind the pilot</span>
          <h1>Organizer access</h1>
          <p>
            Sign in with your approved SidebySide account. Participant responses
            stay private.
          </p>
          {preview ? (
            <button
              className="dash-primary"
              onClick={() => login(null, true)}
              disabled={busy}
            >
              Open fictional dashboard <ArrowRight size={18} />
            </button>
          ) : (
            <form onSubmit={login}>
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="dash-primary" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          {error && (
            <p className="dash-error" role="alert">
              {error}
            </p>
          )}
          <a href="/">Back to the intake form</a>
        </main>
      ) : (
        <main className="dash-main">
          <div className="dash-title">
            <div>
              <span className="dash-kicker">HackGT pilot</span>
              <h1>Pilot dashboard</h1>
            </div>
            <p>{session.user.email}</p>
          </div>
          <nav className="dash-tabs" aria-label="Organizer views">
            {["responses", "matching"].map((value) => (
              <button
                key={value}
                aria-current={tab === value ? "page" : undefined}
                onClick={() => {
                  setTab(value);
                  setError("");
                  setNotice("");
                }}
              >
                {value === "responses"
                  ? "Responses"
                  : `Matching batch (${ids.length})`}
              </button>
            ))}
          </nav>
          {error && (
            <p role="alert" className="dash-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="dash-notice">
              {notice}
            </p>
          )}
          {tab === "responses" ? (
            <>
              <div className="dash-tools">
                <form
                  role="search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setQuery(search.trim());
                    setRefresh((v) => v + 1);
                  }}
                >
                  <label className="dash-search">
                    <Search size={18} />
                    <input
                      aria-label="Search responses"
                      placeholder="Search names, interests, goals"
                      maxLength={80}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <button className="dash-button" type="submit">
                    Search
                  </button>
                </form>
                <button
                  className="dash-icon"
                  title="Refresh responses"
                  aria-label="Refresh responses"
                  disabled={loading}
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              <div className="dash-count">
                <span>
                  {loading
                    ? "Loading responses…"
                    : data
                      ? `${data.total} ${query ? "matching " : ""}responses`
                      : "Responses unavailable"}
                </span>
                <span>
                  {ids.length} / {BATCH_LIMIT} selected
                </span>
              </div>
              <div className={`dash-workspace ${detail ? "has-detail" : ""}`}>
                <section
                  aria-label="Participant responses"
                  className="dash-list"
                  aria-busy={loading}
                >
                  {loading && (
                    <p className="dash-empty" role="status">
                      Loading private responses…
                    </p>
                  )}
                  {data?.rows.length === 0 && (
                    <p className="dash-empty">
                      {query
                        ? "No responses match this search."
                        : "No responses yet. Share the intake link to get started."}
                    </p>
                  )}
                  {data?.rows.map((row) => (
                    <div
                      className={`dash-person ${detail?.receipt_id === row.receipt_id ? "is-current" : ""}`}
                      key={row.receipt_id}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.payload.answers.display_name}`}
                        checked={!!selected[row.receipt_id]}
                        disabled={
                          !row.eligible ||
                          (!selected[row.receipt_id] &&
                            ids.length >= BATCH_LIMIT)
                        }
                        onChange={() => toggle(row)}
                      />
                      <button
                        className="dash-person-open"
                        onClick={() => setDetail(row)}
                      >
                        <strong>{row.payload.answers.display_name}</strong>
                        <span>
                          {stamp(row.created_at)} ·{" "}
                          {row.eligible
                            ? "Evaluation consented"
                            : "Needs review"}
                        </span>
                        <p>{row.payload.answers.current_goal}</p>
                      </button>
                      <ArrowRight size={16} aria-hidden="true" />
                    </div>
                  ))}
                  {data && data.total > 0 && (
                    <div className="dash-pager">
                      <button
                        className="dash-icon"
                        title="Previous page"
                        aria-label="Previous page"
                        disabled={page === 1 || loading}
                        onClick={() => setPage((v) => v - 1)}
                      >
                        <ArrowLeft size={18} />
                      </button>
                      <span>
                        Page {data.page} of{" "}
                        {Math.max(1, Math.ceil(data.total / data.page_size))}
                      </span>
                      <button
                        className="dash-icon"
                        title="Next page"
                        aria-label="Next page"
                        disabled={
                          page * data.page_size >= data.total || loading
                        }
                        onClick={() => setPage((v) => v + 1)}
                      >
                        <ArrowRight size={18} />
                      </button>
                    </div>
                  )}
                </section>
                <section
                  ref={details}
                  className="dash-detail"
                  aria-label="Response details"
                >
                  {detail ? (
                    <>
                      <div className="dash-detail-title">
                        <div>
                          <span className="dash-kicker">Original response</span>
                          <h2>{detail.payload.answers.display_name}</h2>
                        </div>
                        <button
                          className="dash-icon"
                          aria-label="Close response"
                          title="Close response"
                          onClick={() => setDetail(null)}
                        >
                          <X size={19} />
                        </button>
                      </div>
                      <p className="dash-receipt">
                        Receipt {detail.receipt_id}
                      </p>
                      <p className="dash-consent">
                        <LockKeyhole size={15} /> Private evaluation only. No
                        training or public sharing.
                      </p>
                      {FIELDS.filter((f) => f.key !== "display_name").map(
                        (field) => (
                          <div className="dash-answer" key={field.key}>
                            <h3>{field.label}</h3>
                            <p>
                              {detail.payload.answers[field.key] ||
                                "Not provided"}
                            </p>
                          </div>
                        ),
                      )}
                      <div className="dash-answer">
                        <h3>Experience preference</h3>
                        <p>
                          {EXPERIENCE_OPTIONS.find(
                            ([key]) =>
                              key ===
                              detail.payload.answers.experience_preference,
                          )?.[1] || "Not provided"}
                        </p>
                      </div>
                      <button
                        className="dash-button"
                        disabled={
                          !detail.eligible ||
                          (!selected[detail.receipt_id] &&
                            ids.length >= BATCH_LIMIT)
                        }
                        onClick={() => toggle(detail)}
                      >
                        {selected[detail.receipt_id] ? (
                          <Check size={18} />
                        ) : (
                          <Users size={18} />
                        )}
                        {selected[detail.receipt_id]
                          ? "Remove from batch"
                          : "Select for batch"}
                      </button>
                    </>
                  ) : (
                    <div className="dash-empty-detail">
                      <Users size={30} />
                      <h2>Response details</h2>
                      <p>
                        Choose a response to review interests, goals, and
                        conversation boundaries.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <section className="dash-batch">
              <div className="dash-batch-heading">
                <span className="dash-kicker">Private evaluation</span>
                <h2>Selected participants</h2>
                <p>
                  Select 2–{BATCH_LIMIT} participants. Their original answers
                  and consent stay attached to the batch.
                </p>
              </div>
              <div className="dash-metrics">
                <div>
                  <strong>{ids.length}</strong>
                  <span>Participants selected</span>
                </div>
                <div>
                  <strong>{ids.length * Math.max(0, ids.length - 1)}</strong>
                  <span>Directional comparisons planned</span>
                </div>
              </div>
              <ul className="dash-selected">
                {Object.entries(selected).map(([id, name]) => (
                  <li key={id}>
                    <span>{name}</span>
                    <button
                      className="dash-icon"
                      title={`Remove ${name}`}
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        setSelected((current) => {
                          const next = { ...current };
                          delete next[id];
                          return next;
                        })
                      }
                    >
                      <X size={17} />
                    </button>
                  </li>
                ))}
              </ul>
              {ids.length === 0 && (
                <p className="dash-empty">
                  No participants selected. Choose responses first.
                </p>
              )}
              <div className="dash-batch-actions">
                <button
                  className="dash-button"
                  onClick={batch}
                  disabled={ids.length < 2 || busy}
                >
                  <Download size={18} />
                  {busy ? "Preparing…" : "Download private batch"}
                </button>
                <button
                  className="dash-primary"
                  onClick={runMatching}
                  disabled={ids.length < 2 || busy || !session.matching?.available ||
                    ["pending", "running"].includes(matchRun?.status)}
                  aria-describedby="model-status"
                >
                  {matchRun && ["pending", "running"].includes(matchRun.status)
                    ? "Matching…"
                    : "Run matching"} <ArrowRight size={18} />
                </button>
              </div>
              <div className="dash-model" id="model-status">
                <span className="dash-status-dot" />
                <div>
                  <h3>{session.matching?.available
                    ? "Private RunPod worker connected"
                    : "Model host not connected"}</h3>
                  <p>{session.matching?.reason || "The worker reports the pinned model ready."}</p>
                </div>
              </div>
              {matchRun ? (
                <div className="dash-results" aria-live="polite">
                  {matchRun.status === "pending" || matchRun.status === "running" ? (
                    <>
                      <h3>Matching evaluation in progress</h3>
                      <p>The worker compares both directions for each selected pair. This may take a few minutes.</p>
                    </>
                  ) : matchRun.status === "succeeded" ? (
                    <>
                      <h3>Ranked pair candidates</h3>
                      <p>Sorted by the weaker of two directional raw model scores. These are relative ranking scores, not probabilities or confirmed mutual connections.</p>
                      <ol className="dash-ranked-pairs">
                        {(matchRun.result?.pairs || []).map((pair) => (
                          <li key={pair.participant_ids.join(":")}>
                            <strong>{pair.participant_ids.map((id) => matchRun.names?.[id] || "Participant").join(" + ")}</strong>
                            <span>Pair score {Number(pair.pair_score).toFixed(3)}</span>
                            <small>
                              Directions {pair.participant_ids.map((id, index) => {
                                const other = pair.participant_ids[1 - index];
                                return Number(pair.directional_scores?.[`${id}:${other}`]).toFixed(3);
                              }).join(" / ")}
                            </small>
                          </li>
                        ))}
                      </ol>
                      {(matchRun.result?.abstentions || []).length > 0 && (
                        <p>{matchRun.result.abstentions.length} pair(s) were withheld because the model could not score them.</p>
                      )}
                      <p>Model: {matchRun.model_provenance?.model_id} · {matchRun.model_provenance?.pipeline_version}</p>
                    </>
                  ) : (
                    <>
                      <h3>{matchRun.status === "cancelled" ? "Evaluation cancelled" : "Evaluation unavailable"}</h3>
                      <p>{matchRun.error_code || "The private worker could not complete this batch."}</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="dash-results">
                  <h3>No model results yet.</h3>
                  <p>Only responses with the new RunPod-specific consent can be scored. Each pair is evaluated in both directions; results stay private to organizers.</p>
                </div>
              )}
              <p className="dash-footnote">
                Responses are private to the project team. Get separate mutual
                permission before sharing details or introducing participants.
                Downloaded copies need to be removed when someone withdraws.
              </p>
            </section>
          )}
        </main>
      )}
    </div>
  );
}
