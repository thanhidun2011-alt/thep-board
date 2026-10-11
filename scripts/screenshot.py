"""Chụp screenshot web đang chạy (cần `npm run dev`, cổng 8787) bằng Edge có sẵn trên máy.

Ví dụ:
  .\\.venv\\Scripts\\python scripts\\screenshot.py "#/HPG" shots\\hpg.png
  .\\.venv\\Scripts\\python scripts\\screenshot.py "#/HPG/peers" shots\\m.png --mobile --theme light
"""
import argparse

from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument("path", help='phần hash, ví dụ "#/HPG/peers"')
p.add_argument("out")
p.add_argument("--mobile", action="store_true", help="giả lập điện thoại 390px")
p.add_argument("--theme", choices=["dark", "light"], default="dark")
p.add_argument("--base", default="http://127.0.0.1:8787/")
p.add_argument("--wait", type=int, default=3000, help="ms chờ thêm sau khi tải xong")
args = p.parse_args()

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge")
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844} if args.mobile else {"width": 1600, "height": 1000},
        device_scale_factor=2 if args.mobile else 1,
        is_mobile=args.mobile,
        has_touch=args.mobile,
    )
    ctx.add_init_script(f"localStorage.setItem('theme', '{args.theme}')")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.goto(args.base + args.path, wait_until="networkidle")
    page.wait_for_timeout(args.wait)
    # Báo các phần tử làm tràn ngang trang
    overflow = page.evaluate("""() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')]
        .filter(el => el.getBoundingClientRect().right > w + 1)
        .slice(0, 8).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '') + ' right=' + Math.round(el.getBoundingClientRect().right));
    }""")
    page.screenshot(path=args.out, full_page=True)
    browser.close()

print("saved", args.out)
if overflow:
    print("tràn ngang:", *overflow, sep="\n  ")
if errors:
    print("lỗi JS:", *errors, sep="\n  ")
