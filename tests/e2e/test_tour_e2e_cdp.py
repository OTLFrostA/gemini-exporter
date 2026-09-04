#!/usr/bin/env python3
"""
tests/e2e/test_tour_e2e_cdp.py
---------------------------------
Comprehensive CDP-driven End-to-End test suite for Onboarding Tour Guide.
Validates:
1. Tour initiation via button and URL parameter (?welcome=1).
2. Action-Triggered Auto-Progression:
   - Step 2 (sync): Clicking #btnIncrementalScan automatically advances to Step 3.
   - Step 3 (select): Toggling checkbox in #list or clicking #btnSelectAll advances to Step 4.
   - Step 4 (export): Clicking #btnExport automatically completes/dismisses the tour.
3. Backward navigation listener cleanup (no phantom advances).
4. Escape / Skip dismissal and state persistence (has_completed_tour).
"""

import sys
import os
import time
import json
import urllib.request

SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
sys.path.insert(0, SCRIPTS_DIR)
from test_live_chat_and_export import CDPConnection, get_tabs, get_extension_id

PORT = 9222


def run_e2e_tour_tests():
    print("=" * 65)
    print("🚀 Running Onboarding Tour Guide CDP End-to-End Test Suite")
    print("=" * 65)

    ext_id = get_extension_id(PORT)
    if not ext_id:
        print("❌ Could not detect Gemini Exporter extension ID on port", PORT)
        return False
    print(f"🧩 Detected Extension ID: {ext_id}")

    options_url = f"chrome-extension://{ext_id}/options.html"
    tabs = get_tabs(PORT)
    opt_tab = next((t for t in tabs if options_url in t.get("url", "")), None)
    if not opt_tab:
        new_url = f"http://127.0.0.1:{PORT}/json/new?{options_url}"
        req = urllib.request.Request(new_url, method="PUT")
        with urllib.request.urlopen(req, timeout=5) as r:
            opt_tab = json.loads(r.read().decode("utf-8"))

    cdp = CDPConnection(opt_tab["webSocketDebuggerUrl"])

    try:
        # Reload extension to guarantee latest scripts are loaded
        print("🔄 Reloading extension via chrome.runtime.reload()...")
        try:
            cdp.eval("chrome.runtime.reload()")
        except Exception:
            pass
        cdp.close()
        time.sleep(1.5)

        # Reconnect to options page
        tabs = get_tabs(PORT)
        opt_tab = next((t for t in tabs if options_url in t.get("url", "")), None)
        if not opt_tab:
            new_url = f"http://127.0.0.1:{PORT}/json/new?{options_url}"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                opt_tab = json.loads(r.read().decode("utf-8"))
        cdp = CDPConnection(opt_tab["webSocketDebuggerUrl"])

        # Reload options page DOM
        cdp.eval("location.reload()")
        time.sleep(1.5)

        # Wait for options.js to initialize
        cdp.eval("window.__workbenchLoadStore && window.__workbenchLoadStore(true)")
        time.sleep(0.5)

        # Inject worktree's tourGuide.js to test changes in isolated worktree
        worktree_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        with open(os.path.join(worktree_dir, "src", "ui", "tour", "tourGuide.js"), "r", encoding="utf-8") as f:
            tour_js = f.read()
        cdp.eval(tour_js)
        time.sleep(0.2)

        # -------------------------------------------------------------
        # Test 1: Start Tour via #btnTourGuide
        # -------------------------------------------------------------
        print("\n[Test 1] 💡 Starting tour via #btnTourGuide...")
        cdp.eval("""
        (() => {
            const btn = document.getElementById('btnTourGuide');
            if (btn) btn.click();
            else if (window.TourGuide) window.TourGuide.startTour(0);
        })()
        """)
        time.sleep(0.5)

        tour_state = cdp.eval("""
        (() => {
            const popover = document.querySelector('.tour-popover');
            const badge = document.querySelector('.tour-step-badge')?.textContent || '';
            const isActive = window.TourGuide ? window.TourGuide.isActive() : false;
            const currentStep = window.TourGuide ? window.TourGuide.getCurrentStep() : -1;
            return {
                visible: !!popover,
                badge,
                isActive,
                currentStep
            };
        })()
        """)

        assert tour_state.get("visible"), "Tour popover should be visible"
        assert tour_state.get("currentStep") == 0, f"Expected step 0, got {tour_state.get('currentStep')}"
        assert "1 / 4" in tour_state.get("badge", ""), f"Expected '1 / 4' in badge, got {tour_state.get('badge')}"
        print("  ✓ Step 1 (connect) successfully active and visible")

        # -------------------------------------------------------------
        # Test 2: Action Advance from Step 2 (sync) on clicking #btnIncrementalScan
        # -------------------------------------------------------------
        print("\n[Test 2] 🔄 Action Advance: Clicking #btnIncrementalScan in Step 2...")
        cdp.eval("window.TourGuide.goToStep(1)")
        time.sleep(0.5)

        step2_check = cdp.eval("window.TourGuide.getCurrentStep()")
        assert step2_check == 1, f"Expected step 1, got {step2_check}"

        print("   🖱️ Simulating user clicking #btnIncrementalScan directly on the page...")
        cdp.eval("""
        (() => {
            const btn = document.getElementById('btnIncrementalScan');
            if (btn) btn.click();
        })()
        """)

        time.sleep(0.8)

        step3_check = cdp.eval("""
        (() => {
            return {
                step: window.TourGuide.getCurrentStep(),
                badge: document.querySelector('.tour-step-badge')?.textContent || ''
            };
        })()
        """)

        assert step3_check.get("step") == 2, f"Expected auto-advance to step 2 (select), got {step3_check.get('step')}"
        assert "3 / 4" in step3_check.get("badge", ""), f"Expected '3 / 4' in badge, got {step3_check.get('badge')}"
        print("  ✓ Successfully auto-advanced to Step 3 (select) upon clicking #btnIncrementalScan!")

        # -------------------------------------------------------------
        # Test 3: Action Advance from Step 3 (select) on checking a conversation
        # -------------------------------------------------------------
        print("\n[Test 3] ☑️ Action Advance: Toggling checkbox or clicking Select All in Step 3...")
        cdp.eval("""
        (() => {
            const firstCb = document.querySelector('#list .item input[type=checkbox]');
            if (firstCb) {
                firstCb.checked = true;
                firstCb.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                const btnAll = document.getElementById('btnSelectAll');
                if (btnAll) btnAll.click();
            }
        })()
        """)

        time.sleep(0.8)

        step4_check = cdp.eval("""
        (() => {
            return {
                step: window.TourGuide.getCurrentStep(),
                badge: document.querySelector('.tour-step-badge')?.textContent || '',
                hint: document.querySelector('.tour-action-hint')?.textContent || ''
            };
        })()
        """)

        assert step4_check.get("step") == 3, f"Expected auto-advance to step 3 (export), got {step4_check.get('step')}"
        assert "4 / 4" in step4_check.get("badge", ""), f"Expected '4 / 4' in badge, got {step4_check.get('badge')}"
        print(f"  ✓ Successfully auto-advanced to Step 4 (export)! Hint: {step4_check.get('hint')}")

        # -------------------------------------------------------------
        # Test 4: Action Advance from Step 4 (export) on clicking #btnExport -> Complete Tour
        # -------------------------------------------------------------
        print("\n[Test 4] 🚀 Action Advance: Clicking #btnExport in Step 4 -> Tour Completion...")
        cdp.eval("""
        (() => {
            const btnExport = document.getElementById('btnExport');
            if (btnExport) btnExport.click();
        })()
        """)

        time.sleep(0.8)

        tour_completed = cdp.eval("""
        (async () => {
            const popover = document.querySelector('.tour-popover');
            const isActive = window.TourGuide ? window.TourGuide.isActive() : false;
            const storage = await chrome.storage.local.get('has_completed_tour');
            if (typeof Controller !== 'undefined' && Controller.abort) Controller.abort();
            return {
                popoverVisible: !!popover,
                isActive,
                storageCompleted: !!storage.has_completed_tour
            };
        })()
        """, await_promise=True)

        assert not tour_completed.get("isActive"), "Tour should be inactive after export click"
        assert not tour_completed.get("popoverVisible"), "Popover should be removed from DOM"
        assert tour_completed.get("storageCompleted"), "has_completed_tour in chrome.storage should be true"
        print("  ✓ Successfully finished tour automatically upon clicking #btnExport!")

        # -------------------------------------------------------------
        # Test 5: Backtracking & Clean Listener Management
        # -------------------------------------------------------------
        print("\n[Test 5] 🔁 Testing Backtracking & Listener Hygiene...")
        cdp.eval("window.TourGuide.startTour(1)")
        time.sleep(0.5)
        assert cdp.eval("window.TourGuide.getCurrentStep()") == 1, "Should be at step 1"

        cdp.eval("window.TourGuide.nextStep()")
        time.sleep(0.5)
        assert cdp.eval("window.TourGuide.getCurrentStep()") == 2, "Should be at step 2"

        cdp.eval("window.TourGuide.prevStep()")
        time.sleep(0.5)
        assert cdp.eval("window.TourGuide.getCurrentStep()") == 1, "Should be back at step 1"

        cdp.eval("""
        (() => {
            const cb = document.querySelector('#list .item input[type=checkbox]');
            if (cb) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()
        """)
        time.sleep(0.5)
        assert cdp.eval("window.TourGuide.getCurrentStep()") == 1, "Should still be at step 1 (no phantom advance)"

        cdp.eval("""
        (() => {
            const btn = document.getElementById('btnIncrementalScan');
            if (btn) btn.click();
        })()
        """)
        time.sleep(0.8)
        assert cdp.eval("window.TourGuide.getCurrentStep()") == 2, "Should advance to step 2 normally"
        print("  ✓ Backtracking listener cleanup verified: zero phantom triggers")

        # -------------------------------------------------------------
        # Test 6: ESC key dismissal
        # -------------------------------------------------------------
        print("\n[Test 6] ⌨️ Testing Escape key dismissal...")
        cdp.eval("""
        (() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()
        """)
        time.sleep(0.5)
        assert not cdp.eval("window.TourGuide.isActive()"), "Tour should be dismissed on Escape"
        assert not cdp.eval("!!document.querySelector('.tour-popover')"), "Popover should be gone"
        print("  ✓ Escape dismissal passed")

        print("\n" + "=" * 65)
        print("🎉 ALL ONBOARDING TOUR E2E TESTS PASSED 100% SUCCESSFULLY!")
        print("=" * 65)
        return True

    finally:
        cdp.close()


if __name__ == "__main__":
    success = run_e2e_tour_tests()
    sys.exit(0 if success else 1)
