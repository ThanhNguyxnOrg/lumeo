import asyncio
import os
import shutil
from playwright.async_api import async_playwright
import http.server
import socketserver
import threading

PORT = 9988
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
        context = await browser.new_context(viewport={"width": 1280, "height": 850})
        page = await context.new_page()

        # Mock chrome storage API
        await page.add_init_script("""
            window.chrome = {
                storage: {
                    local: {
                        get: (keys, cb) => {
                            const res = {
                                fontSize: 24,
                                bottomOffset: 16,
                                subtitleOrder: "translation-top",
                                subShadowStyle: "glow",
                                subBackgroundOpacity: 80,
                                highContrast: false,
                                layoutPreset: "stacked"
                            };
                            if (typeof cb === 'function') cb(res);
                            return Promise.resolve(res);
                        },
                        set: (items, cb) => {
                            if (typeof cb === 'function') cb();
                            return Promise.resolve();
                        },
                        remove: (keys, cb) => {
                            if (typeof cb === 'function') cb();
                            return Promise.resolve();
                        }
                    }
                }
            };
        """)

        await page.goto(f"http://localhost:{PORT}/options.html")
        await page.wait_for_timeout(500)

        # Click Subtitle Style tab
        await page.click('[data-tab="subtitles"]')
        await page.wait_for_timeout(300)

        # Check that 16:9 cinema mock player exists
        cinema_player = page.locator(".cinema-mock-player")
        assert await cinema_player.count() > 0, "Cinema mock player missing"

        # Check subtitle preview box
        sub = page.locator("#previewSubBox")
        assert await sub.count() > 0, "Preview subtitle box missing"

        # Check reset position button
        reset_btn = page.locator("#btnResetPosition")
        assert await reset_btn.count() > 0, "Reset position button missing"

        os.makedirs("tests/screenshots", exist_ok=True)
        await page.screenshot(path="tests/screenshots/options_cinema_subtitles.png", full_page=True)

        # Toggle high contrast
        await page.click("#highContrast")
        await page.wait_for_timeout(200)

        await page.screenshot(path="tests/screenshots/options_high_contrast.png", full_page=True)

        artifact_dir = "C:/Users/Admin/.gemini/antigravity-ide/brain/48a31c48-2072-440f-b518-257733928efc"
        shutil.copy("tests/screenshots/options_cinema_subtitles.png", f"{artifact_dir}/options_cinema_subtitles.png")
        shutil.copy("tests/screenshots/options_high_contrast.png", f"{artifact_dir}/options_high_contrast.png")
        print("Options page screenshots captured successfully!")

        await browser.close()

asyncio.run(run())
