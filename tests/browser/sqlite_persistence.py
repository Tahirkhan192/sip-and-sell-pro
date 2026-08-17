"""Phase 2B — real browser OPFS persistence proof.

Requires an app served with VITE_ENABLE_LOCAL_SQLITE=true (see README note at
the bottom). Fails if the local database falls back to memory.

Steps: init in worker -> write probe -> close worker -> reload page ->
new worker -> reopen same OPFS database -> read probe.
"""

import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("APP_URL", "http://localhost:8091")

WRITE = """async () => {
  const status = await import('/src/data/local/status.ts');
  const db = await import('/src/data/local/db.ts');
  const before = await status.initLocalDatabase();
  const value = 'probe-' + Date.now();
  await db.probePersistence('write', 'phase2b', value);
  await db.closeLocalDb();
  return { value, before, worker: db.workerStatus() };
}"""

READ = """async () => {
  const status = await import('/src/data/local/status.ts');
  const db = await import('/src/data/local/db.ts');
  const after = await status.initLocalDatabase();
  const probe = await db.probePersistence('read', 'phase2b');
  return { probe, after, worker: db.workerStatus() };
}"""


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        await page.goto(f"{BASE}/auth", wait_until="networkidle")
        wrote = await page.evaluate(WRITE)

        # Full page reload — new document, new worker.
        await page.reload(wait_until="networkidle")
        read = await page.evaluate(READ)

        # And a brand-new page. The OPFS SAH Pool is single-writer per origin,
        # so the first page must release it before the next one opens it.
        await page.evaluate("async () => { const db = await import('/src/data/local/db.ts'); await db.closeLocalDb(); }")
        await page.close()
        page2 = await context.new_page()
        await page2.goto(f"{BASE}/auth", wait_until="networkidle")
        read2 = await page2.evaluate(READ)

        report = {
            "probe_before": wrote["value"],
            "probe_after_reload": read["probe"],
            "probe_after_new_page": read2["probe"],
            "device_before": wrote["before"]["deviceId"],
            "device_after": read["after"]["deviceId"],
            "schema_before": wrote["before"]["schemaVersion"],
            "schema_after": read["after"]["schemaVersion"],
            "storage": read["after"]["storage"],
            "persistent": read["after"]["persistent"],
            "vfs": read["after"]["vfs"],
            "database": read["after"]["databaseName"],
            "worker": read["worker"],
            "sqlite": read["after"]["sqliteVersion"],
            "tables": read["after"]["tableCount"],
            "business_rows": read["after"]["totalRows"],
        }
        print(json.dumps(report, indent=2))

        checks = {
            "probe survived reload": report["probe_after_reload"] == report["probe_before"],
            "probe survived new page": report["probe_after_new_page"] == report["probe_before"],
            "device id survived": report["device_before"] == report["device_after"]
            and bool(report["device_before"]),
            "schema version survived": report["schema_before"] == report["schema_after"] == 2,
            "storage is opfs": report["storage"] == "opfs",
            "persistent is true": report["persistent"] is True,
            "runs in a worker": report["worker"]["kind"] == "worker",
            "no business rows written": report["business_rows"] == 0,
        }
        for name, ok in checks.items():
            print(("PASS  " if ok else "FAIL  ") + name)

        await browser.close()
        return 0 if all(checks.values()) else 1


sys.exit(asyncio.run(main()))
