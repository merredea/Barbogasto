import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setUnauthorizedHandler } from "./api";

/** Simulación mínima de XMLHttpRequest para probar el transporte del escaneo. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  withCredentials = false;
  status = 0;
  responseText = "";
  timeout = 0;
  headers: Record<string, string> = {};
  body: unknown = null;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  respond(status: number, payload: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(payload);
    this.onload?.();
  }
}

function lastXHR() {
  const xhr = FakeXHR.instances.at(-1);
  if (!xhr) throw new Error("No se ha creado la petición");
  return xhr;
}

describe("api.scan", () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {});
  });

  it("informa del progreso real de subida, avisa al pasar a lectura y resuelve el ticket", async () => {
    const progress: number[] = [];
    let reading = 0;
    const promise = api.scan(new Blob(["img"]), "key-1", {
      onUploadProgress: (fraction) => progress.push(fraction),
      onReading: () => reading++,
    });
    const xhr = lastXHR();
    expect(xhr.headers["Idempotency-Key"]).toBe("key-1");
    expect(xhr.withCredentials).toBe(true);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    xhr.upload.onload?.();
    expect(reading).toBe(1);
    xhr.respond(200, { merchant: "Bar Txoko", items: [] });
    await expect(promise).resolves.toMatchObject({ merchant: "Bar Txoko" });
    expect(progress).toEqual([0.25, 1]);
  });

  it("ignora eventos de progreso sin total computable", async () => {
    const progress: number[] = [];
    const promise = api.scan(new Blob(["img"]), "key-2", { onUploadProgress: (fraction) => progress.push(fraction) });
    const xhr = lastXHR();
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });
    xhr.upload.onload?.();
    xhr.respond(200, { merchant: null, items: [] });
    await promise;
    expect(progress).toEqual([]);
  });

  it("no exige hooks: resuelve sin ellos", async () => {
    const promise = api.scan(new Blob(["img"]), "key-3");
    lastXHR().respond(200, { merchant: null, items: [] });
    await expect(promise).resolves.toMatchObject({ items: [] });
  });

  it("rechaza con ApiError y su mensaje cuando el servidor falla (p.ej. límite diario)", async () => {
    const promise = api.scan(new Blob(["img"]), "key-4");
    lastXHR().respond(429, { error: "limite", message: "Se ha alcanzado el límite diario de lecturas. Introduce el gasto manualmente." });
    const caught = await promise.catch((error) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(429);
    expect(caught.code).toBe("limite");
    expect(caught.message).toContain("límite diario");
  });

  it("avisa de sesión caducada y rechaza en un 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const promise = api.scan(new Blob(["img"]), "key-5");
    lastXHR().respond(401, { error: "auth", message: "Sesión caducada." });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("rechaza con mensaje de red si la subida falla", async () => {
    const promise = api.scan(new Blob(["img"]), "key-6");
    lastXHR().onerror?.();
    const caught = await promise.catch((error) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.code).toBe("red");
    expect(caught.message).toContain("conectar");
  });

  it("rechaza con mensaje claro si la lectura tarda demasiado", async () => {
    const promise = api.scan(new Blob(["img"]), "key-7");
    lastXHR().ontimeout?.();
    const caught = await promise.catch((error) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.code).toBe("red");
    expect(caught.message).toContain("tardando demasiado");
  });
});
