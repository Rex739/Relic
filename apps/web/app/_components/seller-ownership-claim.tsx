"use client";

import { Check, Copy, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  browserOwnerMismatchMessage,
  ownershipChallengeBytes,
  ownershipChallengeFilename,
  ownershipErrorMessage,
  studioOwnershipProviderNotice,
  studioSigningCommand,
  type SellerClaimSubmission,
  type SellerOwnershipChallenge,
} from "../../lib/seller-ownership";
import { readJsonResponse } from "../../lib/http-json";
import { useRelicWallet } from "./relic-wallet-provider";

type Method = "browser" | "studio";

export function SellerOwnershipClaim() {
  const wallet = useRelicWallet();
  const router = useRouter();
  const [importSelected, setImportSelected] = useState(false);
  const [chainId, setChainId] = useState<56 | 97>(97);
  const [agentId, setAgentId] = useState("");
  const [submission, setSubmission] = useState<SellerClaimSubmission | null>(
    null,
  );
  const [challenge, setChallenge] = useState<SellerOwnershipChallenge | null>(
    null,
  );
  const [method, setMethod] = useState<Method | null>(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (verified) router.replace("/account/mylistings");
  }, [router, verified]);

  const request = async <T,>(url: string, options: RequestInit) => {
    const response = await fetch(url, options);
    const payload = await readJsonResponse<{ data?: T; error?: unknown }>(
      response,
    );
    if (!response.ok || payload?.data === undefined)
      throw new Error(
        ownershipErrorMessage(payload, `Relic returned ${response.status}`),
      );
    return payload.data;
  };

  const findAgent = async () => {
    setBusy(true);
    setError(null);
    setVerified(false);
    setChallenge(null);
    setMethod(null);
    try {
      const data = await request<SellerClaimSubmission>(
        "/api/operator/agent-submissions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId,
            externalAgentId: agentId.trim(),
          }),
        },
      );
      setSubmission(data);
      setVerified(data.ownershipVerifiedAt !== null);
    } catch (caught) {
      setSubmission(null);
      setError(
        caught instanceof Error ? caught.message : "Agent lookup failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const chooseMethod = async (selected: Method) => {
    if (submission === null) return;
    setBusy(true);
    setError(null);
    setMethod(selected);
    setSignature("");
    setCopied(false);
    try {
      const data = await request<SellerOwnershipChallenge>(
        `/api/operator/agent-submissions/${encodeURIComponent(submission.id)}/ownership-challenges`,
        { method: "POST" },
      );
      setChallenge(data);
    } catch (caught) {
      setChallenge(null);
      setError(
        caught instanceof Error ? caught.message : "Challenge creation failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (candidateSignature: string) => {
    if (submission === null || challenge === null) return;
    setBusy(true);
    setError(null);
    try {
      await request<{ verified: true }>(
        `/api/operator/agent-submissions/${encodeURIComponent(submission.id)}/ownership-verification`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challengeId: challenge.id,
            signature: candidateSignature.trim(),
          }),
        },
      );
      setVerified(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Ownership verification failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyWithBrowserWallet = async () => {
    if (challenge === null) return;
    if (!wallet.authenticated || wallet.address === null) {
      setError("Connect your Relic wallet before using browser verification.");
      return;
    }
    if (
      wallet.address.toLowerCase() !== challenge.expectedOwner.toLowerCase()
    ) {
      setError(
        browserOwnerMismatchMessage(
          submission?.externalAgentId ?? "",
          challenge.expectedOwner,
        ),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const provider = await wallet.getProvider();
      const signed = (await provider.request({
        method: "personal_sign",
        params: [challenge.message, wallet.address],
      })) as string;
      await verify(signed);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Wallet signature failed",
      );
      setBusy(false);
    }
  };

  const downloadChallenge = () => {
    if (submission === null || challenge === null) return;
    ownershipChallengeBytes(challenge.message);
    const blob = new Blob([challenge.message], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = ownershipChallengeFilename(
      submission.externalAgentId,
      challenge.id,
    );
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (verified)
    return (
      <section className="seller-claim-success" aria-live="polite">
        <p className="eyebrow">Ownership verified</p>
        <h2>{submission?.name ?? `Agent #${submission?.externalAgentId}`}</h2>
        <p>
          Your agent has been added. Taking you to My listings while Relic
          checks its registered service in the background.
        </p>
      </section>
    );

  if (!importSelected)
    return (
      <section className="seller-import-choice">
        <span className="overline">ERC-8004 agent</span>
        <h2>Import an existing agent</h2>
        <p>
          Bring in any ERC-8004 agent, including one made with BNB Agent
          Studio. Relic will ask the current owner to sign a verification
          message—no transaction is required.
        </p>
        <button
          className="primary-button"
          onClick={() => setImportSelected(true)}
          type="button"
        >
          Import ERC-8004 agent
        </button>
      </section>
    );

  return (
    <section className="seller-claim-flow">
      <div>
        <p className="eyebrow">Seller ownership</p>
        <h2>Import an ERC-8004 agent</h2>
        <p>
          Find its registered identity, then prove control of the current
          owner. This owner check is a signature only—Relic will not request a
          transaction or access to the agent's hosting account.
        </p>
      </div>

      <div className="seller-claim-fields">
        <label>
          Network
          <select
            value={chainId}
            onChange={(event) =>
              setChainId(Number(event.target.value) as 56 | 97)
            }
          >
            <option value={97}>BSC Testnet</option>
            <option value={56}>BNB Chain</option>
          </select>
        </label>
        <label>
          ERC-8004 Agent ID
          <input
            inputMode="numeric"
            pattern="[0-9]+"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            placeholder="2016"
          />
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !/^\d+$/.test(agentId.trim())}
          onClick={() => void findAgent()}
        >
          {busy ? "Checking live registry…" : "Find agent"}
        </button>
      </div>

      {submission === null ? null : (
        <div className="seller-agent-found" aria-live="polite">
          <div>
            <p className="eyebrow">Agent found</p>
            <h3>{submission.name ?? `Agent #${submission.externalAgentId}`}</h3>
          </div>
          <dl>
            <div>
              <dt>Agent ID</dt>
              <dd>{submission.externalAgentId}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{submission.chainId === 97 ? "BSC Testnet" : "BNB Chain"}</dd>
            </div>
            <div>
              <dt>Current owner</dt>
              <dd className="technical-value">{submission.currentOwner}</dd>
            </div>
          </dl>
          <p>
            Choose how the current owner will sign the verification message.
          </p>
          <div className="seller-verification-methods">
            <button
              type="button"
              className="primary-button seller-verification-primary"
              onClick={() => void chooseMethod("studio")}
            >
              <span>Verify with BNB Agent Studio</span>
              <small>Recommended for this agent owner</small>
            </button>
            <button
              type="button"
              className="secondary-button seller-verification-secondary"
              onClick={() => void chooseMethod("browser")}
            >
              <span>Use browser wallet instead</span>
              <small>Only if the owner wallet is connected here</small>
            </button>
          </div>
        </div>
      )}

      {challenge === null || method === null ? null : (
        <div className="seller-challenge-panel">
          <div className="seller-challenge-header">
            <div>
              <p className="eyebrow">Single-use challenge</p>
              <h3>
                {method === "browser" ? "Browser wallet" : "BNB Agent Studio"}
              </h3>
            </div>
            <span>
              Expires {new Date(challenge.expiresAt).toLocaleTimeString()}
            </span>
          </div>
          <p>
            Expected owner:{" "}
            <span className="technical-value">{challenge.expectedOwner}</span>
          </p>
          {method === "browser" ? (
            <>
              <p>
                Browser verification uses your currently connected Relic wallet.
                If the owner is a different Studio wallet, use the Studio method
                without changing your Relic login.
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void verifyWithBrowserWallet()}
              >
                {busy ? "Verifying…" : "Sign verification message"}
              </button>
            </>
          ) : (
            <>
              <p>{studioOwnershipProviderNotice}</p>
              <ol className="seller-studio-steps">
                <li>
                  <strong>Download the single-use challenge.</strong>
                  <span>
                    Keep its filename unchanged in your Downloads folder.
                  </span>
                </li>
                <li>
                  <strong>Open Terminal in your Agent Studio folder.</strong>
                  <span>
                    Use the folder containing <code>studio.toml</code>.
                  </span>
                </li>
                <li>
                  <strong>Copy and run the terminal command below.</strong>
                  <span>
                    Terminal will privately ask for your Agent Studio wallet
                    password. Your typing will be hidden. Relic never receives
                    or stores that password.
                  </span>
                </li>
                <li>
                  <strong>Copy only the returned 0x signature.</strong>
                  <span>Paste it into the Signature field, then verify.</span>
                </li>
              </ol>
              <aside className="seller-password-notice" role="note">
                <strong>Your wallet password stays on your computer.</strong>
                <span>
                  Enter it only in Terminal when prompted—never paste it into
                  Relic. The command removes it from the shell after signing.
                </span>
              </aside>
              <div className="seller-studio-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={downloadChallenge}
                >
                  <Download aria-hidden="true" size={16} strokeWidth={2} />
                  Download challenge
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (submission === null) return;
                    void navigator.clipboard
                      .writeText(
                        studioSigningCommand(
                          submission.externalAgentId,
                          challenge.id,
                        ),
                      )
                      .then(() => setCopied(true));
                  }}
                >
                  {copied ? (
                    <Check aria-hidden="true" size={16} strokeWidth={2} />
                  ) : (
                    <Copy aria-hidden="true" size={16} strokeWidth={2} />
                  )}
                  {copied ? "Terminal command copied" : "Copy terminal command"}
                </button>
              </div>
              <pre>
                {studioSigningCommand(
                  submission?.externalAgentId ?? agentId.trim(),
                  challenge.id,
                )}
              </pre>
              <p>
                Run this from the Agent Studio folder containing
                <code> studio.toml</code>. Paste only the returned 0x signature
                below.
              </p>
              <label>
                Signature
                <textarea
                  rows={4}
                  value={signature}
                  onChange={(event) => setSignature(event.target.value)}
                  placeholder="0x…"
                />
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !/^0x[0-9a-fA-F]+$/.test(signature.trim())}
                onClick={() => void verify(signature)}
              >
                {busy ? "Verifying current owner…" : "Verify ownership"}
              </button>
            </>
          )}
        </div>
      )}

      {error === null ? null : (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
