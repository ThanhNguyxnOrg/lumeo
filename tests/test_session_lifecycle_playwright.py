import asyncio
import os
import shutil
import http.server
import socketserver
import threading
from playwright.async_api import async_playwright

PORT = 9993
os.chdir("d:/Code/lumeo")

def start_server():
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        httpd.serve_forever()

server_thread = threading.Thread(target=start_server, daemon=True)
server_thread.start()

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        await page.goto(f"http://localhost:{PORT}/tests/mock_player.html")
        await page.wait_for_timeout(600)

        # 1. Verify YouTube player button is injected and IDLE
        yt_btn = page.locator(".ytp-lumeo-button")
        assert await yt_btn.count() > 0, "Lumeo button missing in right controls"
        has_translating = await page.evaluate("() => document.querySelector('.ytp-lumeo-button').classList.contains('is-translating')")
        assert not has_translating, "Button should be idle initially"

        # 2. Verify toggle session button in popover
        toggle_btn = page.locator("[data-lumeo-toggle-session]")
        assert await toggle_btn.count() > 0, "Toggle session button missing in popover"
        btn_text = await toggle_btn.text_content()
        assert "Start Translation" in btn_text, f"Expected 'Start Translation', got {btn_text}"

        os.makedirs("tests/screenshots", exist_ok=True)
        await page.screenshot(path="tests/screenshots/popover_idle_standby.png")

        # 3. Simulate starting translation
        await page.evaluate("""() => {
            window.testOverlayController.setSessionState({ isTranslating: true });
        }""")
        await page.wait_for_timeout(200)

        has_translating_now = await page.evaluate("() => document.querySelector('.ytp-lumeo-button').classList.contains('is-translating')")
        assert has_translating_now, "Button should have .is-translating"
        active_btn_text = await toggle_btn.text_content()
        assert "Stop Translation" in active_btn_text, f"Expected 'Stop Translation', got {active_btn_text}"

        await page.screenshot(path="tests/screenshots/popover_active_translating.png")

        # 4. Close popover via Esc key
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        popover_collapsed = await page.evaluate("() => window.testOverlayController.getRoot().classList.contains('is-side-collapsed')")
        assert popover_collapsed, "Popover should be collapsed on Esc"

        # Active subtitle overlay MUST STILL BE PRESENT and visible
        sub_count = await page.locator(".lumeo-video-sub").count()
        assert sub_count > 0, "Subtitle overlay must remain visible while translating!"

        # YouTube control button MUST STILL BE PRESENT and glowing
        assert await yt_btn.count() > 0, "YouTube button must NEVER be removed when closing popover!"
        assert await page.evaluate("() => document.querySelector('.ytp-lumeo-button').classList.contains('is-translating')"), "Glow must persist"

        await page.screenshot(path="tests/screenshots/subtitles_active_popover_closed.png")

        # 5. Stop session and clear subtitles
        await page.evaluate("""() => {
            window.testOverlayController.setSessionState({ isTranslating: false });
            window.testSubController.remove();
        }""")
        await page.wait_for_timeout(200)

        # YouTube button MUST STILL BE PRESENT in controls!
        assert await yt_btn.count() > 0, "YouTube button must NEVER be destroyed on session stop!"
        has_translating_end = await page.evaluate("() => document.querySelector('.ytp-lumeo-button').classList.contains('is-translating')")
        assert not has_translating_end, "Button should return to idle"

        await page.screenshot(path="tests/screenshots/session_stopped_button_permanent.png")

        # Copy to artifacts directory
        artifact_dir = "C:/Users/Admin/.gemini/antigravity-ide/brain/48a31c48-2072-440f-b518-257733928efc"
        for name in [
            "popover_idle_standby.png",
            "popover_active_translating.png",
            "subtitles_active_popover_closed.png",
            "session_stopped_button_permanent.png"
        ]:
            src = f"tests/screenshots/{name}"
            if os.path.exists(src):
                shutil.copy(src, f"{artifact_dir}/{name}")

        print("All automated verification steps passed successfully!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
