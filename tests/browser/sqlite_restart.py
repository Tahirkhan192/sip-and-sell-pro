"""Phase 2B — browser *restart* persistence proof (persistent profile)."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("APP_URL", "http://localhost:8091")
PROFILE = os.environ.get("PROFILE_DIR", "/tmp/browser/kdf-profile")
WRITE = """async () => { const s = await import('/src/data/local/status.ts'); const d = await import('/src/data/local/db.ts');
  const st = await s.initLocalDatabase(); const v='restart-'+Date.now(); await d.probePersistence('write','restart',v); await d.closeLocalDb(); return {v, device: st.deviceId}; }"""
READ = """async () => { const s = await import('/src/data/local/status.ts'); const d = await import('/src/data/local/db.ts');
  const st = await s.initLocalDatabase(); const p = await d.probePersistence('read','restart'); await d.closeLocalDb(); return {p, device: st.deviceId, storage: st.storage, persistent: st.persistent}; }"""

async def session(pw, script):
    ctx = await pw.chromium.launch_persistent_context(PROFILE, headless=True, viewport={"width":1280,"height":1800})
    page = await ctx.new_page()
    await page.goto(f"{BASE}/auth", wait_until="networkidle")
    out = await page.evaluate(script)
    await ctx.close()
    return out

async def main():
    async with async_playwright() as pw:
        a = await session(pw, WRITE)
        b = await session(pw, READ)  # browser fully closed and relaunched
        print(json.dumps({"wrote": a, "read": b}, indent=2))
        ok = b["p"] == a["v"] and b["device"] == a["device"] and b["storage"] == "opfs" and b["persistent"]
        print("PASS browser restart persistence" if ok else "FAIL browser restart persistence")
        return 0 if ok else 1
sys.exit(asyncio.run(main()))
