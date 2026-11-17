import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export interface BrowserConsoleEntry {
  type: string;
  text: string;
}

export interface BrowserNetworkResponse {
  url: string;
  status: number;
  method?: string;
}

export class RealChromeBrowser {
  private chromeProc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private userDataDir: string = "";
  public consoleErrors: BrowserConsoleEntry[] = [];
  public pageExceptions: string[] = [];
  public apiResponses: BrowserNetworkResponse[] = [];

  public async launch(port = 9222): Promise<void> {
    this.userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "manajerku-chrome-e2e-")
    );

    this.chromeProc = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.userDataDir}`,
        "--window-size=1440,900",
        "about:blank",
      ],
      { stdio: "ignore" }
    );

    // Wait for Chrome DevTools endpoint to become ready
    let wsUrl = "";
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) {
          const targets = (await res.json()) as Array<{
            type: string;
            webSocketDebuggerUrl?: string;
          }>;
          const pageTarget = targets.find(
            (t) => t.type === "page" && t.webSocketDebuggerUrl
          );
          if (pageTarget?.webSocketDebuggerUrl) {
            wsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!wsUrl) {
      throw new Error("Failed to connect to Google Chrome DevTools Protocol.");
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) =>
        reject(new Error(`WebSocket error: ${String(e)}`))
      );
      ws.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data));
        if (typeof data.id === "number" && this.pending.has(data.id)) {
          const handler = this.pending.get(data.id)!;
          this.pending.delete(data.id);
          if (data.error) {
            handler.reject(new Error(data.error.message || "CDP Error"));
          } else {
            handler.resolve(data.result);
          }
        } else if (data.method === "Runtime.consoleAPICalled") {
          const type = data.params?.type || "log";
          const args = (data.params?.args || [])
            .map((a: { value?: unknown; description?: string }) =>
              a.value !== undefined ? String(a.value) : a.description || ""
            )
            .join(" ");
          if (type === "error") {
            this.consoleErrors.push({ type, text: args });
          }
        } else if (data.method === "Runtime.exceptionThrown") {
          const desc =
            data.params?.exceptionDetails?.exception?.description ||
            data.params?.exceptionDetails?.text ||
            "Unknown Page Exception";
          this.pageExceptions.push(desc);
        } else if (data.method === "Network.responseReceived") {
          const url = data.params?.response?.url || "";
          const status = data.params?.response?.status || 0;
          if (url.includes("/api/v1/")) {
            this.apiResponses.push({ url, status });
          }
        }
      });
    });

    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.setViewport(1440, 900);
  }

  public async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.ws) throw new Error("Browser WebSocket is not connected.");
    const id = ++this.msgId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  public async setViewport(
    width: number,
    height: number,
    mobile = false
  ): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
  }

  public async goto(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
    await this.waitForDomIdle(800);
  }

  public async reload(): Promise<void> {
    await this.send("Page.reload", { ignoreCache: true });
    await this.waitForDomIdle(800);
  }

  public async clearCookies(): Promise<void> {
    await this.send("Network.clearBrowserCookies");
  }

  public async waitForDomIdle(ms = 500): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  public async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.send<{
      exceptionDetails?: {
        exception?: { description?: string };
        text?: string;
      };
      result?: { value?: T };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        `Browser JS Eval Error: ${
          res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text
        }`
      );
    }
    return res?.result?.value as T;
  }

  public async getBodyText(): Promise<string> {
    return (await this.evaluate<string>("document.body ? document.body.innerText : ''")) || "";
  }

  public async waitForText(
    expectedSubstring: string,
    timeoutMs = 25000
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const text = await this.getBodyText();
      if (text.includes(expectedSubstring)) {
        return text;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const finalBody = await this.getBodyText();
    throw new Error(
      `Timed out waiting for text "${expectedSubstring}" in browser DOM. Current visible text snippet: ${finalBody.slice(
        0,
        1800
      )}`
    );
  }

  public async clickButtonByText(
    buttonTextSubstring: string,
    exact = false
  ): Promise<boolean> {
    const clicked = await this.evaluate<boolean>(`
      (() => {
        const target = ${JSON.stringify(buttonTextSubstring)};
        const isExact = ${JSON.stringify(exact)};
        const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const match = elements.find((el) => {
          if (el.disabled) return false;
          const txt = (el.textContent || '').trim();
          return isExact ? txt === target : txt.includes(target);
        });
        if (!match) return false;
        match.scrollIntoView({ block: 'center' });
        match.click();
        return true;
      })()
    `);
    await this.waitForDomIdle(450);
    return clicked;
  }

  public async fillInputByPlaceholder(
    placeholderSubstring: string,
    value: string
  ): Promise<boolean> {
    const filled = await this.evaluate<boolean>(`
      (() => {
        const target = ${JSON.stringify(placeholderSubstring.toLowerCase())};
        const val = ${JSON.stringify(value)};
        const inputs = Array.from(document.querySelectorAll('input, textarea'));
        const input = inputs.find((el) =>
          ((el.getAttribute('placeholder') || '').toLowerCase()).includes(target)
        );
        if (!input) return false;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, val);
        } else {
          input.value = val;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    await this.waitForDomIdle(200);
    return filled;
  }

  public async fillInputByLabel(
    labelTextSubstring: string,
    value: string
  ): Promise<boolean> {
    const filled = await this.evaluate<boolean>(`
      (() => {
        const target = ${JSON.stringify(labelTextSubstring.toLowerCase())};
        const val = ${JSON.stringify(value)};
        const labels = Array.from(document.querySelectorAll('label'));
        const label = labels.find((l) => (l.textContent || '').toLowerCase().includes(target));
        if (!label) return false;
        let input = label.htmlFor ? document.getElementById(label.htmlFor) : null;
        if (!input) {
          const container = label.parentElement;
          input = container?.querySelector('input, textarea') || label.querySelector('input, textarea');
        }
        if (!input) return false;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, val);
        } else {
          input.value = val;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    await this.waitForDomIdle(200);
    return filled;
  }

  public async selectOptionByLabelOrIndex(
    selectIndex: number,
    optionValueOrText: string
  ): Promise<boolean> {
    const selected = await this.evaluate<boolean>(`
      (() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const sel = selects[${selectIndex}];
        if (!sel) return false;
        const target = ${JSON.stringify(optionValueOrText)};
        const opt = Array.from(sel.options).find(
          (o) => o.value === target || (o.textContent || '').includes(target)
        );
        if (!opt) return false;
        const nativeSelectSetter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          'value'
        )?.set;
        if (nativeSelectSetter) {
          nativeSelectSetter.call(sel, opt.value);
        } else {
          sel.value = opt.value;
        }
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    await this.waitForDomIdle(250);
    return selected;
  }

  public async takeScreenshot(fileName: string): Promise<string> {
    const dir = path.join(process.cwd(), "docs", "screenshots");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, fileName);
    const res = await this.send<{ data?: string }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    if (res?.data) {
      fs.writeFileSync(filePath, Buffer.from(res.data, "base64"));
    }
    return filePath;
  }

  public async close(): Promise<void> {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    } catch {
      // ignore
    }
    if (this.chromeProc) {
      const pid = this.chromeProc.pid;
      try {
        if (pid && process.platform === "win32") {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
        } else {
          this.chromeProc.kill("SIGKILL");
        }
      } catch {
        // ignore
      }
      this.chromeProc = null;
    }
  }
}
