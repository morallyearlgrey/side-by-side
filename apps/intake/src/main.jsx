import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  LockKeyhole,
  Pencil,
  RotateCw,
} from "lucide-react";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  EMPTY,
  EXPERIENCE_OPTIONS,
  FIELDS,
  VERSION,
  validateAnswers,
} from "../shared/form.mjs";
import "./style.css";

const STEPS = ["Your world", "Your next connection", "Review & permission"];

function OrbitProgress({ step }) {
  return (
    <div className="orbit-progress" data-step={step} aria-hidden="true">
      <span className="orbit-core" />
      <div className="orbit-tilt">
        <div className="orbit-plane">
          <span className="orbit-ring" />
          <span className="orbit-turn">
            <i className="orbit-dot" />
          </span>
        </div>
      </div>
    </div>
  );
}

function PosterArt() {
  return (
    <div className="poster-art" aria-hidden="true">
      <img
        src="/art/lunar-light.jpg"
        width="1200"
        height="675"
        alt=""
        fetchPriority="high"
      />
      <span className="poster-orbit orbit-one">
        <i />
      </span>
      <span className="poster-orbit orbit-two">
        <i />
      </span>
    </div>
  );
}

function useMobileViewport(ref) {
  useEffect(() => {
    const site = ref.current;
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 767px)");
    let timer;
    let frame;
    function centerField() {
      const field = document.activeElement;
      if (!mobile.matches || !field?.matches(".field input, .field textarea"))
        return;
      field.scrollIntoView({ block: "center", behavior: "instant" });
      // iOS scrollIntoView uses the layout viewport, which can extend behind its keyboard.
      if (viewport && viewport.scale === 1) {
        const bounds = field.getBoundingClientRect();
        const actionHeight =
          site.querySelector(".form-actions")?.getBoundingClientRect().height ||
          0;
        const available = viewport.height - actionHeight - 16;
        const target =
          viewport.offsetTop + Math.max(12, (available - bounds.height) / 2);
        window.scrollBy({ top: bounds.top - target, behavior: "instant" });
      }
    }
    function positionActions() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset =
          viewport && viewport.scale === 1 && mobile.matches
            ? Math.max(
                0,
                window.innerHeight - viewport.height - viewport.offsetTop,
              )
            : 0;
        site.style.setProperty("--keyboard-inset", `${inset}px`);
      });
    }
    function settleFocus() {
      positionActions();
      clearTimeout(timer);
      timer = setTimeout(centerField, 260);
    }
    site.addEventListener("focusin", settleFocus);
    window.addEventListener("resize", settleFocus);
    viewport?.addEventListener("resize", settleFocus);
    viewport?.addEventListener("scroll", positionActions);
    positionActions();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      site.removeEventListener("focusin", settleFocus);
      window.removeEventListener("resize", settleFocus);
      viewport?.removeEventListener("resize", settleFocus);
      viewport?.removeEventListener("scroll", positionActions);
      site.style.removeProperty("--keyboard-inset");
    };
  }, [ref]);
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      sidebyside<span className="brand-dot">.</span>
    </div>
  );
}

function App() {
  const [mode, setMode] = useState("loading");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({
    ...EMPTY,
    experience_preference: "",
  });
  const [errors, setErrors] = useState({});
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [website, setWebsite] = useState("");
  const request = useRef(null);
  const heading = useRef(null);
  const firstRender = useRef(true);
  const site = useRef(null);
  useMobileViewport(site);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    fetch("/api/config", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((config) =>
        setMode(
          ["live", "preview"].includes(config.mode) ? config.mode : "closed",
        ),
      )
      .catch(() => setMode("closed"))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, receipt]);

  useEffect(() => {
    if (receipt || !Object.values(answers).some(Boolean)) return;
    const preventLoss = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [answers, receipt]);

  function update(key, value) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    request.current = null;
  }

  function navigate(next) {
    const changeStep = () => {
      setStep(next);
      setFailure("");
      setErrors({});
    };
    if (document.startViewTransition) {
      document
        .startViewTransition(() => flushSync(changeStep))
        .finished.catch(() => {});
    } else changeStep();
  }

  function next() {
    const all = validateAnswers(answers);
    const relevant = Object.fromEntries(
      Object.entries(all).filter(
        ([key]) =>
          FIELDS.find((field) => field.key === key)?.step === step ||
          (step === 1 && key === "experience_preference"),
      ),
    );
    setErrors(relevant);
    if (Object.keys(relevant).length) {
      requestAnimationFrame(() =>
        document.getElementById(Object.keys(relevant)[0])?.focus(),
      );
    } else navigate(step + 1);
  }

  async function submit() {
    if (!consent || pending || !["live", "preview"].includes(mode)) return;
    if (Object.keys(validateAnswers(answers)).length) return navigate(0);
    setPending(true);
    setFailure("");
    request.current ||= {
      request_id: crypto.randomUUID(),
      version: VERSION,
      consent_version: CONSENT_VERSION,
      consent: true,
      answers,
      website,
    };
    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.current),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "We could not confirm your submission. Please retry.",
        );
      if (
        !(
          (mode === "preview" &&
            result.saved === false &&
            result.mode === "preview") ||
          (mode === "live" && result.saved === true && result.receipt_id)
        )
      )
        throw new Error("We could not confirm your submission. Please retry.");
      setReceipt(result);
    } catch (error) {
      setFailure(
        error.name === "TimeoutError" || error instanceof TypeError
          ? "We could not confirm your submission. Please retry; your answers are still here."
          : error.message,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={`site ${receipt ? "is-complete" : "has-actions"}`}
      ref={site}
    >
      <div className="film-grain" aria-hidden="true" />
      <header className="header">
        <div className="header-brand">
          <Brand />
          <div className="event">
            <span className="event-dot" />
            HackGT pilot
          </div>
        </div>
        <div className="header-progress">
          <OrbitProgress step={receipt ? 3 : step} />
          <span>0{receipt ? 3 : step + 1} / 03</span>
        </div>
      </header>
      <div
        className={`status-strip ${mode === "preview" ? "preview" : ""}`}
        role="status"
      >
        {mode === "loading"
          ? "Checking pilot availability..."
          : mode === "preview"
            ? "Local preview. Nothing you enter will be saved or sent to a model."
            : mode === "live"
              ? "Private, opt-in matching experiment. No account needed."
              : "The pilot is not accepting responses yet. Nothing will be submitted."}
      </div>
      <main className="workspace">
        <aside className="sidebar">
          <PosterArt />
          <div className="intro-copy">
            <span className="eyebrow">A little more connected</span>
            <h1>
              Your next
              <br />
              conversation.
            </h1>
            <p className="intro">
              A few thoughtful answers.
              <br />
              Someone with something in common.
            </p>
          </div>
          <nav aria-label="Form progress">
            <ol className="steps">
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  className={`${index === step && !receipt ? "current" : ""} ${index < step || receipt ? "done" : ""}`}
                  aria-current={index === step && !receipt ? "step" : undefined}
                >
                  <span className="step-number">
                    {index < step || receipt ? (
                      <Check size={14} />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          </nav>
          <p className="private-note">
            <LockKeyhole size={15} />
            <span>
              Your answers stay private to the project team. No public profile.
            </span>
          </p>
        </aside>

        <section className="form-area" aria-label="HackGT matching intake">
          {receipt ? (
            <div className="completion" key="complete">
              <div className="completion-check">
                <Check size={28} />
              </div>
              <span className="eyebrow">
                {receipt.saved ? "Response received" : "Preview complete"}
              </span>
              <h2 ref={heading} tabIndex={-1}>
                {receipt.saved
                  ? `Thanks, ${answers.display_name.trim()}.`
                  : "You are ready for the real thing."}
              </h2>
              <p>
                {receipt.saved
                  ? "The team can now include your answers in the private matching evaluation. This is not a live match or an introduction."
                  : "The full form works. Your answers were not saved, and no matching model was called."}
              </p>
              {receipt.saved ? (
                <>
                  <div className="receipt">
                    <span className="eyebrow">Your private receipt</span>
                    <code>{receipt.receipt_id}</code>
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            receipt.receipt_id,
                          );
                          setCopied(true);
                        } catch {
                          setCopied(false);
                        }
                      }}
                    >
                      <Copy size={16} />
                      {copied ? "Copied" : "Copy receipt"}
                    </button>
                  </div>
                  <p className="hint">
                    Keep this receipt. Ask the SidebySide team at HackGT to
                    delete your response by sharing it with them.
                  </p>
                </>
              ) : (
                <button
                  className="primary"
                  onClick={() => {
                    setReceipt(null);
                    setConsent(false);
                    request.current = null;
                    navigate(0);
                  }}
                >
                  <RotateCw size={17} />
                  Review again
                </button>
              )}
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                step < 2 ? next() : void submit();
              }}
            >
              <div className="step-content">
                <div className="form-heading" key={`heading-${step}`}>
                  <span className="eyebrow">0{step + 1} / 03</span>
                  <h2 ref={heading} tabIndex={-1}>
                    {STEPS[step]}
                  </h2>
                  <p>
                    {step === 0
                      ? "The details make the difference. Tell us what makes these things yours."
                      : step === 1
                        ? "Not just shared interests. The conversation you actually want to have."
                        : "Make sure this sounds like you. You decide whether to submit it."}
                  </p>
                </div>
                <div className="form-body" key={step}>
                  {step < 2 ? (
                    <>
                      {FIELDS.filter(
                        (field) =>
                          field.step === step && field.key !== "boundaries",
                      ).map((field) => (
                        <StableField
                          key={field.key}
                          field={field}
                          value={answers[field.key]}
                          error={errors[field.key]}
                          onChange={(value) => update(field.key, value)}
                        />
                      ))}
                      {step === 1 && (
                        <>
                          <fieldset className="preference">
                            <legend>Who would help with that goal?</legend>
                            <div className="radio-options">
                              {EXPERIENCE_OPTIONS.map(
                                ([value, label, hint], index) => (
                                  <label
                                    key={value}
                                    className={`radio-option ${answers.experience_preference === value ? "selected" : ""}`}
                                  >
                                    <input
                                      type="radio"
                                      id={
                                        index === 0
                                          ? "experience_preference"
                                          : `preference-${value}`
                                      }
                                      name="experience_preference"
                                      value={value}
                                      checked={
                                        answers.experience_preference === value
                                      }
                                      onChange={() =>
                                        update("experience_preference", value)
                                      }
                                      aria-describedby="preference-error"
                                    />
                                    <span>
                                      <strong>{label}</strong>
                                      <small>{hint}</small>
                                    </span>
                                  </label>
                                ),
                              )}
                            </div>
                            <span id="preference-error" className="field-error">
                              {errors.experience_preference}
                            </span>
                          </fieldset>
                          <StableField
                            field={FIELDS.find(
                              (field) => field.key === "boundaries",
                            )}
                            value={answers.boundaries}
                            error={errors.boundaries}
                            onChange={(value) => update("boundaries", value)}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {[0, 1].map((section) => (
                        <section className="review-section" key={section}>
                          <div className="review-heading">
                            <h3>{STEPS[section]}</h3>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => navigate(section)}
                              disabled={pending}
                            >
                              <Pencil size={14} />
                              Edit
                              <span className="sr-only"> {STEPS[section]}</span>
                            </button>
                          </div>
                          <dl>
                            {FIELDS.filter(
                              (field) => field.step === section,
                            ).map((field) => (
                              <div key={field.key}>
                                <dt>{field.label}</dt>
                                <dd>
                                  {answers[field.key].trim() || "Not specified"}
                                </dd>
                              </div>
                            ))}
                            {section === 1 && (
                              <div>
                                <dt>Conversation preference</dt>
                                <dd>
                                  {
                                    EXPERIENCE_OPTIONS.find(
                                      ([value]) =>
                                        value === answers.experience_preference,
                                    )?.[1]
                                  }
                                </dd>
                              </div>
                            )}
                          </dl>
                        </section>
                      ))}
                      <div className="consent-section">
                        <div className="privacy-title">
                          <LockKeyhole size={18} />
                          <h3>Your answers, your permission</h3>
                        </div>
                        <p>
                          Only the project team will see your answers and
                          suggested pairings. We will not publish them, contact
                          other participants for you, or use them to train a
                          model.
                        </p>
                        <label className="consent">
                          <input
                            type="checkbox"
                            checked={consent}
                            disabled={pending}
                            onChange={(event) =>
                              setConsent(event.target.checked)
                            }
                          />
                          <span>{CONSENT_TEXT}</span>
                        </label>
                        <p className="hint">
                          Please leave out contact details, passwords, health
                          information, and other sensitive details. Submitting
                          does not create an app account.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="honey" aria-hidden="true">
                <label>
                  Website
                  <input
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </label>
              </div>
              {failure && (
                <div className="error-banner" role="alert">
                  {failure}
                </div>
              )}
              <footer className="form-actions">
                {step > 0 ? (
                  <button
                    type="button"
                    className="back"
                    onClick={() => navigate(step - 1)}
                    disabled={pending}
                  >
                    <ArrowLeft size={17} />
                    Back
                  </button>
                ) : (
                  <span className="time">About 4 minutes</span>
                )}
                {step < 2 ? (
                  <button className="primary" type="submit">
                    {step === 1 ? "Review answers" : "Continue"}
                    <ArrowRight size={17} />
                  </button>
                ) : (
                  <button
                    className="primary"
                    type="submit"
                    disabled={
                      !consent || pending || !["live", "preview"].includes(mode)
                    }
                  >
                    {pending
                      ? "Submitting..."
                      : failure
                        ? "Retry submission"
                        : mode === "preview"
                          ? "Finish preview"
                          : "Submit response"}
                    {pending ? (
                      <RotateCw className="spin" size={17} />
                    ) : (
                      <ChevronRight size={17} />
                    )}
                  </button>
                )}
              </footer>
            </form>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <span>sidebyside. / HackGT</span>
        <span>Thoughtful connections start with a conversation.</span>
      </footer>
    </div>
  );
}

function StableField({ field, value, error, onChange }) {
  const props = {
    id: field.key,
    name: field.key,
    value,
    required: field.min > 0,
    maxLength: field.max,
    "aria-invalid": !!error,
    "aria-describedby": `${field.key}-hint${error ? ` ${field.key}-error` : ""}`,
    onChange: (event) => onChange(event.target.value),
  };
  return (
    <div className="field">
      <label htmlFor={field.key}>
        {field.label}
        {field.min === 0 && <span className="optional">Optional</span>}
      </label>
      <p id={`${field.key}-hint`} className="hint">
        {field.hint || "A first name or nickname is enough. No email needed."}
      </p>
      <div className="field-control">
        {field.short ? (
          <input {...props} autoComplete="nickname" />
        ) : (
          <textarea {...props} rows={field.key === "boundaries" ? 3 : 4} />
        )}
      </div>
      <div className="field-footer">
        <span id={`${field.key}-error`} className="field-error">
          {error || ""}
        </span>
        {!field.short && (
          <span className="counter">
            {value.length} / {field.max}
          </span>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
