#!/usr/bin/env python3
"""Drive the running Moneypit dev server in a real browser and screenshot it.

Unit and e2e tests cover the CLI, not the web UI. This is the harness for
looking at the actual pages — checking a report, verifying a UI change, or
reading numbers off a screen.

Run it with a Python env that has Playwright installed
(`pip install playwright && playwright install chromium`):

    python scripts/driver.py

By default it loads the dashboard and writes one screenshot. Pass a *script* —
a file of one-command-per-line steps — to drive further:

    python scripts/driver.py steps.txt

Step commands (blank lines and `#` comments ignored):

    goto PATH               navigate, e.g. /reports/tax?year=2025
    click SELECTOR          click the first match, then wait for the page to settle
    fill SELECTOR VALUE     type into an input
    select SELECTOR VALUE   pick an <option> by value
    key KEYNAME             press a key, e.g. Escape
    wait MS                 pause
    shot NAME               viewport screenshot to OUT/NAME.png
    fullshot NAME           whole-page screenshot (viewport grown to fit) to OUT/NAME.png
    text SELECTOR           print the element's text content
    table SELECTOR          print every matching <table> as tab-separated rows
    box SELECTOR            print the element's bounding rect
    eval JS                 run JS in the page and print it; `return` the value

Selectors are Playwright selectors: CSS, `text=Run Rules`, `role=link[name=Reports]`.

Options: --url, --book, --out, --width, --height, --headed, --keep-open.

`--book <id>` sets the bookId cookie before loading, so the run targets that
book regardless of what the dev server's last visitor selected. The dev server
runs against the real database; use the Demo book for anything that mutates.

Navigation in this app is client-side (SvelteKit), so after a click the URL can
change *after* the network goes idle. `click` waits for both; if a step still
races, add `wait 500` before the shot. Pages you can `goto` directly:

    /  /accounts  /accounts/<id>  /transactions  /transactions/<id>  /categorize
    /merge  /import  /activity  /tax/2025  /reports/tax?year=2025
    /reports/expenses?range=custom&year=2025  /reports/net-worth
"""

from __future__ import annotations

import argparse
import shlex
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

DEFAULT_URL = "http://localhost:5180"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("script", nargs="?", help="file of driver steps (see module docstring)")
    parser.add_argument("--url", default=DEFAULT_URL, help="dev server origin")
    parser.add_argument("--book", help="book id to select (sets the bookId cookie)")
    parser.add_argument("--out", default="screenshots", help="screenshot directory")
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--keep-open", action="store_true", help="hold the browser open until Enter")
    return parser.parse_args(argv)


def unquote(text: str) -> str:
    """Drop one wrapping quote pair. JS bodies can't go through shlex — it would
    eat the quotes inside the snippet — but they still get wrapped like every
    other step argument."""
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def read_steps(path: str | None) -> list[str]:
    if not path:
        return []
    lines = Path(path).read_text().splitlines()
    return [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]


def settle(page) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(250)


def screenshot(page, out: Path, name: str, shot_index: list[int], full_page: bool) -> None:
    shot_index[0] += 1
    path = out / f"{name or f'step-{shot_index[0]:02d}'}.png"
    if full_page:
        # The page body doesn't scroll — <main> does — so Playwright's own
        # full_page capture stops at the viewport. Grow the viewport to the
        # content height instead, then put it back.
        viewport = page.viewport_size
        content_height = page.evaluate(
            "() => Math.max(document.documentElement.scrollHeight, document.querySelector('main')?.scrollHeight ?? 0)"
        )
        page.set_viewport_size({"width": viewport["width"], "height": max(viewport["height"], content_height + 40)})
        page.wait_for_timeout(250)
        page.screenshot(path=str(path))
        page.set_viewport_size(viewport)
    else:
        page.screenshot(path=str(path))
    print(f"  shot → {path}")


def dump_tables(page, selector: str) -> None:
    """Print every matching table as tab-separated rows — the way to read
    numbers off a report without squinting at a screenshot."""
    tables = page.locator(selector).evaluate_all(
        """els => els.map(el => Array.from(el.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('th, td')).map(c => c.innerText.trim().replace(/\\s+/g, ' '))))"""
    )
    print(f"  table {selector} → {len(tables)} tables")
    for i, rows in enumerate(tables):
        if i:
            print()
        for row in rows:
            print("    " + "\t".join(row))


def run_step(page, step: str, base_url: str, out: Path, shot_index: list[int]) -> None:
    command, _, rest = step.partition(" ")
    rest = rest.strip()

    if command == "goto":
        page.goto(base_url + rest if rest.startswith("/") else rest)
        settle(page)
    elif command == "wait":
        page.wait_for_timeout(int(rest))
    elif command == "key":
        page.keyboard.press(rest)
        settle(page)
    elif command == "eval":
        # Wrapped in an arrow so multi-statement bodies work.
        print(f"  eval → {page.evaluate(f'() => {{ {unquote(rest)} }}')!r}")
    elif command == "shot":
        screenshot(page, out, rest, shot_index, full_page=False)
    elif command == "fullshot":
        screenshot(page, out, rest, shot_index, full_page=True)
    elif command in {"click", "text", "box", "table"}:
        selector = shlex.split(rest)[0]
        if command == "table":
            dump_tables(page, selector)
            return
        locator = page.locator(selector).first
        if command == "click":
            url_before = page.url
            locator.click()
            # Client-side navigation can land after the network goes idle.
            try:
                page.wait_for_url(lambda url: url != url_before, timeout=2000)
            except PlaywrightTimeoutError:
                pass  # the click didn't navigate; that's fine
            settle(page)
            if page.url != url_before:
                print(f"  → {urlparse(page.url).path}")
        elif command == "text":
            print(f"  text {selector} → {locator.inner_text()!r}")
        else:
            print(f"  box {selector} → {locator.bounding_box()}")
    elif command in {"fill", "select"}:
        selector, value = shlex.split(rest)[:2]
        locator = page.locator(selector).first
        if command == "fill":
            locator.fill(value)
        else:
            locator.select_option(value)
        settle(page)
    else:
        raise ValueError(f"unknown step: {step!r}")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    steps = read_steps(args.script)
    base_url = args.url.rstrip("/")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    console_errors: list[str] = []
    failed = False

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not args.headed)  # system Chrome; no download needed
        context = browser.new_context(viewport={"width": args.width, "height": args.height})
        if args.book:
            context.add_cookies([{"name": "bookId", "value": args.book, "url": base_url}])
        page = context.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))

        print(f"loading {base_url}/")
        page.goto(base_url + "/")
        settle(page)
        screenshot(page, out, "00-load", [0], full_page=False)

        shot_index = [0]
        for step in steps:
            print(f"step: {step}")
            try:
                run_step(page, step, base_url, out, shot_index)
            except Exception as err:  # keep going; a later step may still be informative
                print(f"  FAILED: {err}")
                failed = True

        if console_errors:
            print(f"console errors ({len(console_errors)}):")
            for text in console_errors[:10]:
                print(f"  {text}")
            failed = True
        else:
            print("console errors: none")

        if args.keep_open:
            input("press Enter to close the browser… ")

        browser.close()

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
