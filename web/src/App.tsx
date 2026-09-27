import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, maxUint256, zeroAddress, type Address } from "viem";
import {
  contract,
  loadDeployment,
  switchNetwork,
  type Deployment,
} from "./config";
import {
  amount,
  errorText,
  isAvailable,
  parseAmount,
  readSnapshot,
  short,
  transact,
  type Key,
  type Snapshot,
  type TxUpdate,
} from "./chain";

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="16" cy="8" r="5" />
      <path d="m12 12-8 8H2v-4l9-9m-4 8 2 2" />
    </svg>
  );
}
function KeyArt() {
  return (
    <svg
      className="key-art"
      viewBox="0 0 180 180"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="90" cy="90" r="76" />
      <circle cx="90" cy="90" r="57" />
      <path d="M116 49a25 25 0 0 1 0 50 25 25 0 0 1-14-4l-44 44H40v-18l44-44a25 25 0 0 1 32-28Z" />
      <circle cx="116" cy="73" r="8" />
      <path d="m62 117 10 10m-20 0 10 10" />
    </svg>
  );
}
function expiry(value: bigint) {
  if (!value) return "—";
  const d = new Date(Number(value) * 1000);
  return Number.isNaN(d.getTime())
    ? `${value} Unix seconds`
    : d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC";
}
function AddressLink({
  value,
  config,
}: {
  value: Address;
  config: Deployment;
}) {
  return (
    <a
      className="address"
      href={`${config.network.explorer}/address/${value}`}
      target="_blank"
      rel="noreferrer"
      title={value}
      aria-label={`View address ${value} on explorer`}
    >
      {short(value)} <span aria-hidden="true">↗</span>
    </a>
  );
}

export default function App() {
  const [config, setConfig] = useState<Deployment>();
  const [configError, setConfigError] = useState("");
  const [account, setAccount] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [page, setPage] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [tx, setTx] = useState<TxUpdate>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<bigint>();
  const [quote, setQuote] = useState(0n);
  const [days, setDays] = useState("1");
  const [price, setPrice] = useState("");
  const [approved, setApproved] = useState("");
  const [destination, setDestination] = useState("");
  const [until, setUntil] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const generation = useRef(0);
  const context = useRef(0);
  const editor = useRef<HTMLElement>(null);
  const lock = useRef(false);

  useEffect(() => {
    loadDeployment()
      .then(setConfig)
      .catch((e) => setConfigError(errorText(e)));
  }, []);
  const refresh = useCallback(async () => {
    if (!config) return;
    const request = ++generation.current;
    setReading(true);
    try {
      const result = await readSnapshot(
        config,
        account,
        page,
        chain === config.chainId ? window.ethereum : undefined,
      );
      if (request !== generation.current) return;
      setSnapshot(result);
      setReadError("");
      if (result.page !== page) setPage(result.page);
    } catch (e) {
      if (request === generation.current) setReadError(errorText(e));
    } finally {
      if (request === generation.current) setReading(false);
    }
  }, [config, account, chain, page]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const invalidate = () => {
      context.current++;
      generation.current++;
      setSnapshot(undefined);
      setApproved("");
      setSelected(undefined);
      setActionError("");
    };
    const accountsChanged = (...values: unknown[]) => {
      invalidate();
      const valuesArray = values[0] as Address[];
      setAccount(valuesArray[0]);
    };
    const chainChanged = (...values: unknown[]) => {
      invalidate();
      setChain(Number(values[0]));
    };
    const disconnected = () => {
      invalidate();
      setAccount(undefined);
      setChain(undefined);
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, []);

  async function connect() {
    setActionError("");
    if (!window.ethereum) {
      setActionError(
        "No browser wallet found. Open this page in an Ethereum wallet browser or install a browser wallet, then reload.",
      );
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      context.current++;
      setAccount(accounts[0]);
      setChain(Number(chainId));
      setSnapshot(undefined);
      setApproved("");
      if (!accounts[0])
        throw Error(
          "No account shared. Connect an account in your wallet and try again.",
        );
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setConnecting(false);
    }
  }
  async function changeNetwork() {
    if (!window.ethereum || !config) return;
    setConnecting(true);
    setActionError("");
    try {
      await switchNetwork(window.ethereum, config);
      setChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setConnecting(false);
    }
  }
  const wrongChain = !!account && chain !== config?.chainId;
  const ready =
    !!config &&
    !!account &&
    !wrongChain &&
    !!snapshot &&
    !readError &&
    !reading &&
    !busy;
  const key = snapshot?.keys.find((k) => k.id === selected);
  const owner =
    !!key && !!account && key.owner.toLowerCase() === account.toLowerCase();
  const validDays =
    /^\d+$/.test(days) &&
    Number(days) >= 1 &&
    Number(days) <= Number(snapshot?.maxDays ?? 30n);
  const cost = validDays ? quote * BigInt(days) : 0n;
  const quoteKey = `${account}:${selected}:${quote}:${days}`;
  const rentalEligible =
    !!key &&
    !owner &&
    isAvailable(key) &&
    validDays &&
    quote > 0n &&
    key.price <= quote &&
    cost <= maxUint256;
  const canPay = rentalEligible && !!snapshot && snapshot.balance >= cost;
  const canRent =
    canPay && snapshot!.allowance >= cost && approved === quoteKey;

  async function act(
    target: "RentableNFT" | "LaunchToken",
    method: string,
    args: readonly unknown[],
    onSuccess?: () => void,
  ) {
    if (!ready || !config || !account || !window.ethereum || lock.current)
      return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    setTx(undefined);
    const session = context.current;
    try {
      await transact(
        config,
        window.ethereum,
        account,
        target,
        method,
        args,
        setTx,
      );
      if (context.current === session) {
        onSuccess?.();
        await refresh();
      }
      setTx(
        (previous) =>
          previous && {
            ...previous,
            message: `${method === "approve" ? "Approval" : "Transaction"} confirmed. Check the state status below for the latest read.`,
          },
      );
    } catch (e) {
      setActionError(errorText(e));
      setTx((previous) =>
        previous?.hash
          ? {
              ...previous,
              phase: "failed",
              message:
                "Confirmation did not complete. Check the transaction before retrying.",
            }
          : undefined,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function selectKey(k: Key) {
    setSelected(k.id);
    setQuote(k.price);
    setDays("1");
    setPrice(k.price ? amount(k.price, snapshot!.decimals) : "");
    setApproved("");
    setDestination("");
    setUntil("");
    setAcknowledged(false);
    setFieldError("");
    requestAnimationFrame(() => {
      editor.current?.scrollIntoView({ block: "nearest" });
      editor.current?.focus({ preventScroll: true });
    });
  }
  function list() {
    setFieldError("");
    try {
      const value = parseAmount(price, snapshot!.decimals);
      void act("RentableNFT", "list", [selected, value]);
    } catch (e) {
      setFieldError(errorText(e));
      document.getElementById("price")?.focus();
    }
  }
  function manage(method: "setUser" | "safeTransferFrom") {
    setFieldError("");
    if (!isAddress(destination) || destination === zeroAddress) {
      setFieldError("Enter a valid, nonzero Ethereum address.");
      document.getElementById("destination")?.focus();
      return;
    }
    if (method === "setUser") {
      const expires = Math.floor(new Date(until + "Z").getTime() / 1000);
      if (!Number.isFinite(expires) || expires <= Date.now() / 1000) {
        setFieldError("Choose a future expiry in UTC.");
        document.getElementById("until")?.focus();
        return;
      }
      void act("RentableNFT", "setUser", [
        selected,
        destination,
        BigInt(expires),
      ]);
    } else {
      void act("RentableNFT", "safeTransferFrom", [
        account,
        destination,
        selected,
      ]);
    }
  }

  return (
    <>
      <a className="skip" href="#market">
        Skip to marketplace
      </a>
      <div className="shell">
        <header className="header">
          <a href="#" className="brand" aria-label="Lease home">
            <span className="brand-mark" aria-hidden="true">
              L<span>↗</span>
            </span>
            <span>
              lease<span className="brand-period">.</span>
            </span>
          </a>
          <div className="header-right">
            <span className="network-pill">
              <span aria-hidden="true" className="dot" />
              {config?.network.name || "Network"}{" "}
              <span className="testnet">testnet</span>
            </span>
            <button
              className={!account ? "button primary" : "button"}
              onClick={
                account
                  ? () => {
                      context.current++;
                      setAccount(undefined);
                      setSnapshot(undefined);
                      setSelected(undefined);
                      setApproved("");
                    }
                  : connect
              }
              disabled={connecting || busy || !config}
            >
              {connecting
                ? "Connecting…"
                : account
                  ? `Disconnect ${short(account)}`
                  : "Connect wallet"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </header>
        <main>
          <section className="hero" aria-labelledby="hero-heading">
            <div className="intro">
              <p className="eyebrow">A little ownership. More possibility.</p>
              <h1 id="hero-heading">
                Own the key.
                <br />
                <span>Share the access.</span>
              </h1>
              <p>
                Mint a Lease Key. Set a daily price. Let someone else use it
                while ownership stays with you.
              </p>
              <div className="hero-notes">
                <span>Free to mint</span>
                <span>Rent with LEAS</span>
                <span>1–30 days</span>
              </div>
            </div>
            <div className="mint-card">
              <div className="card-top">
                <span className="eyebrow">Your next key</span>
                <span className="edition">LKEY / ERC-4907</span>
              </div>
              <KeyArt />
              <div className="mint-copy">
                <h2>Make it yours.</h2>
                <p>Up to 3 keys per wallet, for life.</p>
              </div>
              <button
                className="button mint-button"
                disabled={
                  !ready ||
                  snapshot!.minted >= snapshot!.maxMints ||
                  snapshot!.total >= snapshot!.maxSupply
                }
                onClick={() => void act("RentableNFT", "mint", [])}
              >
                Mint a free key <span aria-hidden="true">↗</span>
              </button>
              <p className="mint-note">
                {!account
                  ? "Connect your wallet to mint · gas fees apply"
                  : snapshot
                    ? `${snapshot.minted} of ${snapshot.maxMints} minted by this wallet · gas fees apply`
                    : "Checking mint eligibility…"}
              </p>
            </div>
          </section>

          <section
            className="wallet-strip"
            aria-label="Market and wallet overview"
          >
            <div>
              <span className="label">Keys minted</span>
              <strong>
                {snapshot ? snapshot.total.toLocaleString() : "—"}{" "}
                <small>
                  / {snapshot?.maxSupply.toLocaleString() || "3,000"}
                </small>
              </strong>
            </div>
            <div>
              <span className="label">Your balance</span>
              <strong className="amount">
                {account && snapshot
                  ? amount(snapshot.balance, snapshot.decimals)
                  : "—"}{" "}
                <small>LEAS</small>
              </strong>
            </div>
            <div>
              <span className="label">Rental allowance</span>
              <strong className="amount">
                {account && snapshot
                  ? amount(snapshot.allowance, snapshot.decimals)
                  : "—"}{" "}
                <small>LEAS</small>
              </strong>
            </div>
            <div className="currency-note">
              <span className="mini-icon" aria-hidden="true">
                ↗
              </span>
              <p>
                Need LEAS? Swap Sepolia ETH in the launch pool using a
                compatible Uniswap v4 interface.{" "}
                <a href="#deployment">View pool details</a>
              </p>
            </div>
          </section>

          {configError && (
            <div role="alert" className="notice error">
              {configError}{" "}
              <button className="text-button" onClick={() => location.reload()}>
                Reload configuration
              </button>
            </div>
          )}
          {wrongChain && (
            <div className="notice warning">
              <div>
                <strong>Wallet is on the wrong network</strong>
                <p>
                  Switch to {config?.network.name} to use these contracts.
                  Current wallet chain: {chain}.
                </p>
              </div>
              <button
                className="button"
                onClick={changeNetwork}
                disabled={connecting || busy}
              >
                Switch to {config?.network.name}
              </button>
            </div>
          )}
          <div role="alert">
            {actionError && (
              <div className="notice error">
                {actionError}
                <button
                  className="text-button"
                  onClick={() => setActionError("")}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
          <div role="status" aria-live="polite">
            {tx && (
              <div className="notice transaction">
                <span>{tx.message}</span>
                {tx.hash && config && (
                  <a
                    href={`${config.network.explorer}/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                )}
              </div>
            )}
          </div>

          <section
            id="market"
            className="market"
            aria-labelledby="market-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">The marketplace</p>
                <h2 id="market-heading">Find your next access.</h2>
              </div>
              <button
                className="button quiet"
                onClick={() => void refresh()}
                disabled={!config || reading || busy}
              >
                {reading ? "Refreshing…" : "Refresh state"}{" "}
                <span aria-hidden="true">↻</span>
              </button>
            </div>
            <div className="market-meta">
              <p>All keys · 25 per page</p>
              <p role="status">
                {readError
                  ? "State unavailable · actions disabled"
                  : reading
                    ? "Reading contracts…"
                    : snapshot
                      ? `Live contract views · block ${snapshot.block.toLocaleString()}`
                      : "Connecting to public RPC…"}
              </p>
            </div>
            {readError && (
              <div role="alert" className="notice error">
                <span>Could not refresh contract state. {readError}</span>
                <button
                  className="text-button"
                  disabled={reading}
                  onClick={() => void refresh()}
                >
                  Retry reads
                </button>
              </div>
            )}
            <div className="market-grid">
              <div className="table-panel" aria-busy={reading}>
                <p className="table-hint">
                  Scroll the table horizontally for all details. Select a key
                  number to continue.
                </p>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Lease Keys table. Scroll horizontally for all columns."
                  tabIndex={0}
                >
                  <table>
                    <caption className="sr-only">
                      Lease Keys with current owners, daily listing prices,
                      users and expiry dates
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Key</th>
                        <th scope="col">Owner</th>
                        <th scope="col">Price / day</th>
                        <th scope="col">Current user</th>
                        <th scope="col">Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot?.keys.map((k) => (
                        <tr
                          key={k.id.toString()}
                          className={selected === k.id ? "selected" : ""}
                        >
                          <th scope="row">
                            <button
                              className="row-button key-number"
                              aria-label={`Select key ${k.id}`}
                              aria-pressed={selected === k.id}
                              onClick={() => selectKey(k)}
                              disabled={busy || reading}
                            >
                              <KeyIcon />#{k.id.toString().padStart(3, "0")}
                            </button>
                            <span className="row-state">
                              {k.user !== zeroAddress
                                ? "In use"
                                : isAvailable(k)
                                  ? "Available"
                                  : "Unlisted"}
                            </span>
                          </th>
                          <td>
                            <AddressLink value={k.owner} config={config!} />
                            {account?.toLowerCase() ===
                              k.owner.toLowerCase() && (
                              <span className="row-state">You</span>
                            )}
                          </td>
                          <td>
                            <span className="price-value">
                              {k.price
                                ? amount(k.price, snapshot.decimals)
                                : "—"}
                            </span>
                            {k.price > 0n && (
                              <span className="row-state">LEAS</span>
                            )}
                          </td>
                          <td>
                            {k.user === zeroAddress ? (
                              <span className="muted">No active user</span>
                            ) : (
                              <AddressLink value={k.user} config={config!} />
                            )}
                          </td>
                          <td className="expiry">{expiry(k.expires)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!snapshot?.keys.length && (
                  <div className="empty">
                    <span className="empty-key" aria-hidden="true">
                      <KeyIcon />
                    </span>
                    <h3>
                      {reading
                        ? "Reading the key collection…"
                        : readError
                          ? "The market is taking a moment."
                          : snapshot
                            ? "A fresh set of possibilities."
                            : "Loading the market…"}
                    </h3>
                    <p>
                      {snapshot && !readError
                        ? "No keys have been minted yet. Connect a wallet and mint the first one."
                        : "Keys will appear here after the contract reads complete."}
                    </p>
                  </div>
                )}
                <nav className="pagination" aria-label="Token pages">
                  <span>
                    {snapshot?.total
                      ? `${snapshot.page * 25 + 1}–${Math.min((snapshot.page + 1) * 25, Number(snapshot.total))} of ${snapshot.total}`
                      : "0 keys"}
                  </span>
                  <div>
                    <button
                      className="button compact"
                      disabled={!snapshot || page === 0 || reading || busy}
                      onClick={() => {
                        setPage((p) => p - 1);
                        setSelected(undefined);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      className="button compact"
                      disabled={
                        !snapshot ||
                        BigInt((page + 1) * 25) >= snapshot.total ||
                        reading ||
                        busy
                      }
                      onClick={() => {
                        setPage((p) => p + 1);
                        setSelected(undefined);
                      }}
                    >
                      Next
                    </button>
                  </div>
                </nav>
              </div>

              <aside
                className="editor"
                ref={editor}
                tabIndex={-1}
                aria-labelledby="editor-heading"
              >
                <p className="eyebrow">
                  {key ? `Lease Key #${key.id}` : "A key to get started"}
                </p>
                <h3 id="editor-heading">
                  {!key
                    ? "Make room for access."
                    : owner
                      ? "Manage your key."
                      : "Make it a short stay."}
                </h3>
                {!key ? (
                  <>
                    <div className="editor-symbol" aria-hidden="true">
                      ↗
                    </div>
                    <p>
                      Select a key to see its rental price or manage a listing
                      you own.
                    </p>
                    <ol className="steps">
                      <li>
                        <span>01</span>Choose an available key
                      </li>
                      <li>
                        <span>02</span>Approve the LEAS cost
                      </li>
                      <li>
                        <span>03</span>Rent for 1–30 days
                      </li>
                    </ol>
                    <p className="subtle">
                      Ownership stays with the owner. Your access lasts until
                      the rental expires.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="editor-info">
                      {key.user !== zeroAddress
                        ? "In use until " +
                          expiry(key.expires) +
                          ". Existing access cannot be shortened."
                        : key.price > 0n
                          ? "This key has a live listing."
                          : "This key is not listed for rent."}
                    </p>
                    {!account && (
                      <p className="inline-hint">
                        Connect your wallet to list or rent a key.
                      </p>
                    )}
                    {owner ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          list();
                        }}
                      >
                        <label htmlFor="price">
                          Daily price <span>LEAS</span>
                        </label>
                        <input
                          id="price"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="e.g. 10"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          aria-invalid={!!fieldError}
                          aria-describedby="field-error"
                          disabled={busy}
                        />
                        <p className="subtle">
                          Paid directly to your wallet when someone rents.
                        </p>
                        <div className="button-stack">
                          <button
                            className="button solid"
                            type="submit"
                            disabled={!ready}
                          >
                            {key.price > 0n ? "Update listing" : "List key"}
                          </button>
                          <button
                            className="button"
                            type="button"
                            disabled={!ready || key.price === 0n}
                            onClick={() =>
                              void act("RentableNFT", "unlist", [key.id])
                            }
                          >
                            Unlist key
                          </button>
                        </div>
                      </form>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (canRent)
                            void act(
                              "RentableNFT",
                              "rent",
                              [key.id, BigInt(days), quote],
                              () => setApproved(""),
                            );
                        }}
                      >
                        <label htmlFor="days">
                          Rental duration <span>days</span>
                        </label>
                        <input
                          id="days"
                          type="number"
                          min="1"
                          max={Number(snapshot?.maxDays ?? 30n)}
                          step="1"
                          value={days}
                          onChange={(e) => {
                            setDays(e.target.value);
                            setApproved("");
                          }}
                          aria-invalid={!validDays}
                          aria-describedby="days-hint"
                          disabled={busy}
                        />
                        <p
                          id="days-hint"
                          className={!validDays ? "field-error" : "subtle"}
                        >
                          {!validDays
                            ? "Enter a whole number from 1 to 30."
                            : "Starts when the rental transaction confirms."}
                        </p>
                        <dl className="quote">
                          <div>
                            <dt>Reviewed daily price</dt>
                            <dd>{amount(quote, snapshot!.decimals)} LEAS</dd>
                          </div>
                          <div>
                            <dt>Maximum total</dt>
                            <dd>{amount(cost, snapshot!.decimals)} LEAS</dd>
                          </div>
                        </dl>
                        {key.price !== quote && (
                          <div className="inline-hint">
                            The listing price changed. Your reviewed maximum
                            stays fixed.
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                setQuote(key.price);
                                setApproved("");
                              }}
                            >
                              Review latest price
                            </button>
                          </div>
                        )}
                        {rentalEligible && !canPay && (
                          <p className="inline-hint">
                            Your LEAS balance is below the rental cost. Add
                            LEAS, then refresh.
                          </p>
                        )}
                        {!isAvailable(key) && (
                          <p className="inline-hint">
                            {key.user !== zeroAddress
                              ? "This key is in use. Wait until expiry or choose another key."
                              : "Choose a key with an active listing to rent."}
                          </p>
                        )}
                        <div className="button-stack">
                          <button
                            className="button"
                            type="button"
                            disabled={!ready || !canPay}
                            onClick={() =>
                              void act(
                                "LaunchToken",
                                "approve",
                                [
                                  contract(config!, "RentableNFT").address,
                                  cost,
                                ],
                                () => setApproved(quoteKey),
                              )
                            }
                          >
                            {approved === quoteKey
                              ? "1. LEAS approved ✓"
                              : "1. Approve LEAS"}
                          </button>
                          <button
                            className="button solid"
                            type="submit"
                            disabled={!ready || !canRent}
                          >
                            2. Rent key
                          </button>
                        </div>
                        <p className="subtle">
                          Two wallet confirmations. Approval lets the rental
                          contract spend up to{" "}
                          {amount(cost, snapshot!.decimals)} LEAS; rent pays the
                          current owner. Gas is paid in Sepolia ETH.
                        </p>
                      </form>
                    )}
                    {owner && (
                      <details className="advanced">
                        <summary>Transfer or assign access</summary>
                        <p className="subtle">
                          A transfer changes ownership and clears the listing.
                          Active usage survives transfers. Free access also
                          cannot be revoked before expiry.
                        </p>
                        <label htmlFor="destination">Recipient address</label>
                        <input
                          id="destination"
                          placeholder="0x…"
                          value={destination}
                          onChange={(e) => {
                            setDestination(e.target.value);
                            setAcknowledged(false);
                          }}
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={!!fieldError}
                          aria-describedby="field-error"
                          disabled={busy}
                        />
                        <label htmlFor="until">Access expiry (UTC)</label>
                        <input
                          id="until"
                          type="datetime-local"
                          value={until}
                          onChange={(e) => {
                            setUntil(e.target.value);
                            setAcknowledged(false);
                          }}
                          disabled={busy}
                        />
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={acknowledged}
                            onChange={(e) => setAcknowledged(e.target.checked)}
                            disabled={busy}
                          />
                          I reviewed the recipient and understand that this
                          action cannot be undone.
                        </label>
                        <div className="button-stack">
                          <button
                            className="button"
                            disabled={
                              !ready ||
                              !acknowledged ||
                              key.user !== zeroAddress
                            }
                            onClick={() => manage("setUser")}
                          >
                            Assign free access
                          </button>
                          <button
                            className="button"
                            disabled={!ready || !acknowledged}
                            onClick={() => manage("safeTransferFrom")}
                          >
                            Transfer ownership
                          </button>
                        </div>
                      </details>
                    )}
                    <p id="field-error" role="alert" className="field-error">
                      {fieldError}
                    </p>
                  </>
                )}
              </aside>
            </div>
          </section>

          <section className="how-it-works" aria-label="How Lease works">
            <div>
              <span className="eyebrow">01 / Keep ownership</span>
              <h3>Yours to keep. Theirs to use.</h3>
              <p>
                Renting grants temporary access to a key. It never transfers
                ownership of your NFT.
              </p>
            </div>
            <div>
              <span className="eyebrow">02 / Pay directly</span>
              <h3>No middle balance.</h3>
              <p>
                LEAS goes straight from the renter to the current owner. The
                rental contract holds no funds.
              </p>
            </div>
            <div>
              <span className="eyebrow">03 / Protect the stay</span>
              <h3>Access has its own clock.</h3>
              <p>
                Paid access lasts until expiry, even if the owner transfers or
                unlists the key. This differs from the ERC-4907 reference
                behavior.
              </p>
            </div>
          </section>
          {config && (
            <details id="deployment" className="deployment">
              <summary>
                Deployment & pool details{" "}
                <span>
                  {config.network.name} · chain {config.chainId}
                </span>
              </summary>
              <p>
                LEAS comes from swapping Sepolia ETH in the launch pool. This
                page has no swap control. Pool: native ETH / LEAS, fee 0.3%,
                tick spacing 60, no hook.
              </p>
              <p>
                Payment token is read from RentableNFT.token() and checked
                against the deployment. ABI hashes, RPC chain and nonempty
                contract code must verify before signing.
              </p>
              <dl>
                {config.contracts.map((c) => (
                  <div key={c.name}>
                    <dt>{c.name}</dt>
                    <dd>
                      <a
                        href={`${config.network.explorer}/address/${c.address}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.address} ↗
                      </a>
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>Uniswap v4 PoolManager</dt>
                  <dd>
                    <a
                      href={`${config.network.explorer}/address/${config.network.uniswapV4.poolManager}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {config.network.uniswapV4.poolManager} ↗
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Deployment source</dt>
                  <dd>{config.sourceCommit}</dd>
                </div>
                <div>
                  <dt>Attestation</dt>
                  <dd>{config.attestationHash}</dd>
                </div>
                <div>
                  <dt>Public RPCs</dt>
                  <dd>{config.network.rpcUrls.join(" · ")}</dd>
                </div>
              </dl>
              <p>
                <a href="./imd-deployment.json">View deployment manifest</a> ·{" "}
                {config.network.faucets.map((f, i) => (
                  <a
                    className="faucet"
                    key={f}
                    href={f}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Sepolia faucet {i + 1} ↗
                  </a>
                ))}
              </p>
              {account && (
                <p>
                  Connected wallet: <span className="address">{account}</span>
                </p>
              )}
              <button
                className="button"
                disabled={!ready || snapshot?.allowance === 0n}
                onClick={() =>
                  void act(
                    "LaunchToken",
                    "approve",
                    [contract(config, "RentableNFT").address, 0n],
                    () => setApproved(""),
                  )
                }
              >
                Revoke rental allowance
              </button>
              <p className="subtle">
                A failed rental can leave an unused approval. Revoke it here
                with a wallet transaction.
              </p>
            </details>
          )}
        </main>
        <footer>
          <a className="footer-brand" href="#">
            lease.
          </a>
          <p>Shared access. Clear terms.</p>
          <span>Built on Sepolia · Test tokens only</span>
        </footer>
      </div>
    </>
  );
}
